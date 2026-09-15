-- Factory-safe production controls for MSME execution.
-- Additive, rerunnable and data preserving. No historical transaction is changed.

BEGIN;

ALTER TABLE public.stock_reservations
  ADD COLUMN IF NOT EXISTS inventory_stock_id UUID REFERENCES public.inventory_stock(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reference_line_id UUID,
  ADD COLUMN IF NOT EXISTS allocation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_production_material_reservation
  ON public.stock_reservations
    (tenant_id, reference_type, reference_id, reference_line_id, inventory_stock_id)
  WHERE released = FALSE AND reference_type = 'PRODUCTION_JOB_ORDER';

ALTER TABLE public.production_operation_wip
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS transfer_group_id UUID;

ALTER TABLE public.station_completions
  ADD COLUMN IF NOT EXISTS rework_quantity NUMERIC(18,4) NOT NULL DEFAULT 0;

ALTER TABLE public.station_completions
  DROP CONSTRAINT IF EXISTS station_completion_nonnegative_rework;
ALTER TABLE public.station_completions
  ADD CONSTRAINT station_completion_nonnegative_rework
  CHECK (rework_quantity >= 0) NOT VALID;

ALTER TABLE public.job_order_materials
  ADD COLUMN IF NOT EXISTS supply_policy VARCHAR(24) NOT NULL DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS source_bom_item_id UUID REFERENCES public.bom_items(id) ON DELETE SET NULL;

ALTER TABLE public.production_operation_wip
  DROP CONSTRAINT IF EXISTS production_operation_wip_event_type_check;
ALTER TABLE public.production_operation_wip
  ADD CONSTRAINT production_operation_wip_event_type_check CHECK (
    event_type IN (
      'GOOD_OUTPUT','REJECTED','REWORK','TRANSFER','TRANSFER_IN',
      'CONSUMPTION','REVERSAL'
    )
  ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_wip_idempotency
  ON public.production_operation_wip(tenant_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.production_supply_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_job_order_id UUID NOT NULL REFERENCES public.production_job_orders(id) ON DELETE CASCADE,
  bom_item_id UUID REFERENCES public.bom_items(id) ON DELETE SET NULL,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  action_type VARCHAR(24) NOT NULL CHECK (
    action_type IN ('BUY','SUBCONTRACT','TRANSFER','PLANNER_REVIEW')
  ),
  required_quantity NUMERIC(18,4) NOT NULL CHECK (required_quantity > 0),
  required_by_date DATE,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTION_REQUIRED' CHECK (
    status IN ('ACTION_REQUIRED','DRAFT_CREATED','PENDING_APPROVAL','RELEASED',
               'PARTIALLY_RECEIVED','COMPLETED','CANCELLED')
  ),
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  source_document_type VARCHAR(40),
  source_document_id UUID,
  source_document_number VARCHAR(80),
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,parent_job_order_id,bom_item_id,item_id,action_type)
);

CREATE INDEX IF NOT EXISTS idx_production_supply_actions_worklist
  ON public.production_supply_actions(tenant_id,status,required_by_date);

CREATE TABLE IF NOT EXISTS public.production_creation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'CREATING' CHECK (
    status IN ('CREATING','COMPLETED','FAILED','ROLLED_BACK')
  ),
  root_job_order_id UUID REFERENCES public.production_job_orders(id) ON DELETE SET NULL,
  created_job_order_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  failure_message TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.production_supervisor_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  production_order_id UUID REFERENCES public.production_orders(id) ON DELETE CASCADE,
  job_order_id UUID REFERENCES public.production_job_orders(id) ON DELETE CASCADE,
  control_code VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  evidence_reference TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE','USED','REVOKED','EXPIRED')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by UUID NOT NULL REFERENCES public.users(id),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_override_active
  ON public.production_supervisor_overrides(tenant_id,production_order_id,control_code,status,expires_at);

-- Atomically reserve physical stock for every unissued Job Order material.
-- Partial reservations are allowed and returned as a shortage worklist; stock is never
-- moved and concurrent orders cannot reserve the same available quantity.
CREATE OR REPLACE FUNCTION public.reserve_production_job_materials(
  p_tenant_id UUID,
  p_job_order_id UUID,
  p_reserved_by UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material RECORD;
  v_stock RECORD;
  v_existing RECORD;
  v_required NUMERIC;
  v_take NUMERIC;
  v_reserved NUMERIC := 0;
  v_short NUMERIC := 0;
  v_lines INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_job_order_id::text, 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.production_job_orders
    WHERE tenant_id=p_tenant_id AND id=p_job_order_id
  ) THEN RAISE EXCEPTION 'Job Order not found for this tenant'; END IF;

  FOR v_material IN
    SELECT m.id,m.item_id,m.required_quantity,COALESCE(m.issued_quantity,0) issued_quantity,
           m.warehouse_id,m.input_warehouse_id,j.job_order_number
    FROM public.job_order_materials m
    JOIN public.production_job_orders j ON j.id=m.job_order_id
    WHERE j.tenant_id=p_tenant_id AND m.job_order_id=p_job_order_id
    ORDER BY m.id
  LOOP
    SELECT COALESCE(SUM(reserved_quantity),0) INTO v_reserved
    FROM public.stock_reservations
    WHERE tenant_id=p_tenant_id AND reference_type='PRODUCTION_JOB_ORDER'
      AND reference_id=p_job_order_id AND reference_line_id=v_material.id
      AND released=FALSE;
    v_required := GREATEST(0, v_material.required_quantity-v_material.issued_quantity-v_reserved);
    IF v_required <= 0 THEN CONTINUE; END IF;
    v_lines := v_lines + 1;

    FOR v_stock IN
      SELECT s.* FROM public.inventory_stock s
      WHERE s.tenant_id=p_tenant_id AND s.item_id=v_material.item_id
        AND (COALESCE(v_material.input_warehouse_id,v_material.warehouse_id) IS NULL
             OR s.warehouse_id=COALESCE(v_material.input_warehouse_id,v_material.warehouse_id))
        AND GREATEST(0,COALESCE(s.quantity,0)-COALESCE(s.reserved_quantity,0)) > 0
      ORDER BY s.updated_at NULLS LAST,s.id
      FOR UPDATE
    LOOP
      EXIT WHEN v_required <= 0;
      v_take := LEAST(v_required,GREATEST(0,COALESCE(v_stock.quantity,0)-COALESCE(v_stock.reserved_quantity,0)));
      IF v_take <= 0 THEN CONTINUE; END IF;

      SELECT * INTO v_existing FROM public.stock_reservations
      WHERE tenant_id=p_tenant_id AND reference_type='PRODUCTION_JOB_ORDER'
        AND reference_id=p_job_order_id AND reference_line_id=v_material.id
        AND inventory_stock_id=v_stock.id AND released=FALSE FOR UPDATE;
      IF FOUND THEN
        UPDATE public.stock_reservations
        SET reserved_quantity=reserved_quantity+v_take
        WHERE id=v_existing.id;
      ELSE
        INSERT INTO public.stock_reservations(
          tenant_id,item_id,warehouse_id,inventory_stock_id,reserved_quantity,
          reference_type,reference_id,reference_line_id,reference_number,
          reserved_by,allocation_metadata
        ) VALUES (
          p_tenant_id,v_material.item_id,v_stock.warehouse_id,v_stock.id,v_take,
          'PRODUCTION_JOB_ORDER',p_job_order_id,v_material.id,v_material.job_order_number,
          p_reserved_by,jsonb_build_object('source','FACTORY_HARDENING')
        );
      END IF;
      UPDATE public.inventory_stock
      SET reserved_quantity=COALESCE(reserved_quantity,0)+v_take,updated_at=NOW()
      WHERE id=v_stock.id;
      v_required := v_required-v_take;
    END LOOP;
    v_short := v_short+GREATEST(0,v_required);
  END LOOP;

  SELECT COALESCE(SUM(reserved_quantity),0) INTO v_reserved
  FROM public.stock_reservations
  WHERE tenant_id=p_tenant_id AND reference_type='PRODUCTION_JOB_ORDER'
    AND reference_id=p_job_order_id AND released=FALSE;
  RETURN jsonb_build_object(
    'job_order_id',p_job_order_id,'material_lines',v_lines,
    'reserved_quantity',v_reserved,'shortage_quantity',v_short,
    'fully_reserved',v_short <= 0
  );
END;
$$;

-- Release matching reservations as the physical SIV quantity is posted.
CREATE OR REPLACE FUNCTION public.consume_production_material_reservations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta NUMERIC;
  v_row RECORD;
  v_take NUMERIC;
BEGIN
  v_delta := GREATEST(0,COALESCE(NEW.issued_quantity,0)-COALESCE(OLD.issued_quantity,0));
  IF v_delta <= 0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.job_order_id::text || ':' || NEW.id::text, 0));
  FOR v_row IN
    SELECT * FROM public.stock_reservations
    WHERE reference_type='PRODUCTION_JOB_ORDER' AND reference_id=NEW.job_order_id
      AND reference_line_id=NEW.id AND released=FALSE
    ORDER BY reserved_at,id FOR UPDATE
  LOOP
    EXIT WHEN v_delta <= 0;
    v_take := LEAST(v_delta,v_row.reserved_quantity);
    UPDATE public.inventory_stock
      SET reserved_quantity=GREATEST(0,COALESCE(reserved_quantity,0)-v_take),updated_at=NOW()
      WHERE id=v_row.inventory_stock_id;
    IF v_take >= v_row.reserved_quantity THEN
      UPDATE public.stock_reservations SET released=TRUE,released_at=NOW() WHERE id=v_row.id;
    ELSE
      UPDATE public.stock_reservations SET reserved_quantity=reserved_quantity-v_take WHERE id=v_row.id;
    END IF;
    v_delta := v_delta-v_take;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consume_production_material_reservations ON public.job_order_materials;
CREATE TRIGGER trg_consume_production_material_reservations
AFTER UPDATE OF issued_quantity ON public.job_order_materials
FOR EACH ROW EXECUTE FUNCTION public.consume_production_material_reservations();

CREATE OR REPLACE FUNCTION public.release_deleted_job_order_reservations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT * FROM public.stock_reservations
    WHERE tenant_id=OLD.tenant_id AND reference_type='PRODUCTION_JOB_ORDER'
      AND reference_id=OLD.id AND released=FALSE FOR UPDATE
  LOOP
    UPDATE public.inventory_stock
      SET reserved_quantity=GREATEST(0,COALESCE(reserved_quantity,0)-v_row.reserved_quantity),updated_at=NOW()
      WHERE id=v_row.inventory_stock_id;
    UPDATE public.stock_reservations SET released=TRUE,released_at=NOW() WHERE id=v_row.id;
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_deleted_job_order_reservations ON public.production_job_orders;
CREATE TRIGGER trg_release_deleted_job_order_reservations
BEFORE DELETE ON public.production_job_orders
FOR EACH ROW EXECUTE FUNCTION public.release_deleted_job_order_reservations();

CREATE OR REPLACE FUNCTION public.allocate_completed_child_supply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_parent UUID; v_qty NUMERIC;
BEGIN
  IF OLD.status::text=NEW.status::text OR NEW.status::text NOT IN ('QC_COMPLETED','COMPLETED')
     OR NEW.parent_job_order_id IS NULL THEN RETURN NEW; END IF;
  v_parent:=NEW.parent_job_order_id;
  v_qty:=GREATEST(0,COALESCE(NEW.completed_quantity,NEW.quantity,0));
  UPDATE public.production_supply_pegging
    SET received_quantity=LEAST(planned_supply_quantity,v_qty),
        status=CASE WHEN stock_allocated_quantity+LEAST(planned_supply_quantity,v_qty)>=required_quantity
                    THEN 'AVAILABLE' ELSE 'PARTIALLY_AVAILABLE' END,
        updated_at=NOW()
  WHERE tenant_id=NEW.tenant_id AND child_job_order_id=NEW.id
    AND status NOT IN ('CONSUMED','CANCELLED');
  PERFORM public.reserve_production_job_materials(NEW.tenant_id,v_parent,NEW.created_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allocate_completed_child_supply ON public.production_job_orders;
CREATE TRIGGER trg_allocate_completed_child_supply
AFTER UPDATE OF status,completed_quantity ON public.production_job_orders
FOR EACH ROW EXECUTE FUNCTION public.allocate_completed_child_supply();

-- Serialize quantity validation at the database boundary. This protects against
-- two machines/operators completing the same available WIP at the same time.
CREATE OR REPLACE FUNCTION public.validate_station_completion_atomic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_route RECORD;
  v_policy RECORD;
  v_predecessors UUID[];
  v_previous UUID;
  v_pred UUID;
  v_current_good NUMERIC;
  v_current_processed NUMERIC;
  v_pred_good NUMERIC;
  v_new_processed NUMERIC;
  v_override UUID;
BEGIN
  IF NEW.status::text <> 'COMPLETED' OR OLD.status::text = 'COMPLETED' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.production_order_id::text, 0));
  SELECT * INTO v_order FROM public.production_orders
    WHERE tenant_id=NEW.tenant_id AND id=NEW.production_order_id FOR UPDATE;
  SELECT * INTO v_route FROM public.production_routing
    WHERE tenant_id=NEW.tenant_id AND id=NEW.routing_id;
  IF v_order.id IS NULL OR v_route.id IS NULL OR v_order.bom_id IS DISTINCT FROM v_route.bom_id
    THEN RAISE EXCEPTION 'Production order routing evidence is incomplete'; END IF;

  SELECT * INTO v_policy FROM public.production_stage_policies
    WHERE tenant_id=NEW.tenant_id AND routing_id=NEW.routing_id;
  SELECT COALESCE(array_agg(value::UUID),ARRAY[]::UUID[]) INTO v_predecessors
  FROM jsonb_array_elements_text(COALESCE(v_policy.predecessor_routing_ids,'[]'::jsonb));
  IF cardinality(v_predecessors)=0 AND COALESCE(v_policy.execution_mode,'SEQUENTIAL') <> 'PARALLEL' THEN
    SELECT id INTO v_previous FROM public.production_routing
      WHERE tenant_id=NEW.tenant_id AND bom_id=v_order.bom_id
        AND sequence_no<v_route.sequence_no ORDER BY sequence_no DESC LIMIT 1;
    IF v_previous IS NOT NULL THEN v_predecessors:=ARRAY[v_previous]; END IF;
  END IF;

  SELECT COALESCE(SUM(quantity_completed),0),
         COALESCE(SUM(quantity_completed+quantity_rejected),0)
    INTO v_current_good,v_current_processed
  FROM public.station_completions
  WHERE tenant_id=NEW.tenant_id AND production_order_id=NEW.production_order_id
    AND routing_id=NEW.routing_id AND status='COMPLETED' AND id<>NEW.id;
  IF v_current_good+COALESCE(NEW.quantity_completed,0)>v_order.quantity THEN
    RAISE EXCEPTION 'Completed quantity exceeds remaining production target';
  END IF;
  v_new_processed:=COALESCE(NEW.quantity_completed,0)+COALESCE(NEW.quantity_rejected,0);
  SELECT id INTO v_override FROM public.production_supervisor_overrides
  WHERE tenant_id=NEW.tenant_id AND production_order_id=NEW.production_order_id
    AND control_code='WIP_PREDECESSOR' AND status='ACTIVE' AND expires_at>NOW()
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  FOREACH v_pred IN ARRAY v_predecessors LOOP
    SELECT COALESCE(SUM(quantity_completed),0) INTO v_pred_good
    FROM public.station_completions
    WHERE tenant_id=NEW.tenant_id AND production_order_id=NEW.production_order_id
      AND routing_id=v_pred AND status='COMPLETED';
    IF v_override IS NULL AND v_current_processed+v_new_processed>v_pred_good THEN
      RAISE EXCEPTION 'Processed quantity exceeds available predecessor WIP (% available)',
        GREATEST(0,v_pred_good-v_current_processed);
    END IF;
  END LOOP;
  IF v_override IS NOT NULL THEN
    UPDATE public.production_supervisor_overrides
      SET status='USED',used_at=NOW() WHERE id=v_override;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_station_completion_atomic ON public.station_completions;
CREATE TRIGGER trg_validate_station_completion_atomic
BEFORE UPDATE OF status,quantity_completed,quantity_rejected ON public.station_completions
FOR EACH ROW EXECUTE FUNCTION public.validate_station_completion_atomic();

CREATE OR REPLACE FUNCTION public.record_station_completion_wip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_route RECORD;
  v_policy RECORD;
  v_predecessors UUID[];
  v_previous UUID;
  v_pred UUID;
  v_group UUID:=gen_random_uuid();
  v_processed NUMERIC:=COALESCE(NEW.quantity_completed,0)+COALESCE(NEW.quantity_rejected,0);
BEGIN
  IF NEW.status::text <> 'COMPLETED' OR OLD.status::text = 'COMPLETED' THEN RETURN NEW; END IF;
  SELECT * INTO v_order FROM public.production_orders WHERE id=NEW.production_order_id;
  SELECT * INTO v_route FROM public.production_routing WHERE id=NEW.routing_id;
  SELECT * INTO v_policy FROM public.production_stage_policies
    WHERE tenant_id=NEW.tenant_id AND routing_id=NEW.routing_id;
  SELECT COALESCE(array_agg(value::UUID),ARRAY[]::UUID[]) INTO v_predecessors
  FROM jsonb_array_elements_text(COALESCE(v_policy.predecessor_routing_ids,'[]'::jsonb));
  IF cardinality(v_predecessors)=0 AND COALESCE(v_policy.execution_mode,'SEQUENTIAL') <> 'PARALLEL' THEN
    SELECT id INTO v_previous FROM public.production_routing
      WHERE tenant_id=NEW.tenant_id AND bom_id=v_order.bom_id
        AND sequence_no<v_route.sequence_no ORDER BY sequence_no DESC LIMIT 1;
    IF v_previous IS NOT NULL THEN v_predecessors:=ARRAY[v_previous]; END IF;
  END IF;

  IF COALESCE(NEW.quantity_completed,0)>0 THEN
    INSERT INTO public.production_operation_wip(
      tenant_id,production_order_id,routing_id,item_id,batch_number,event_type,
      quantity,from_work_station_id,station_completion_id,evidence,created_by,idempotency_key
    ) VALUES (
      NEW.tenant_id,NEW.production_order_id,NEW.routing_id,v_order.item_id,
      NEW.id::text,'GOOD_OUTPUT',NEW.quantity_completed,NEW.work_station_id,NEW.id,
      jsonb_build_object('source','DATABASE_COMPLETION_TRIGGER'),NEW.operator_id,
      NEW.id::text||':GOOD_OUTPUT'
    ) ON CONFLICT (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;
  IF COALESCE(NEW.quantity_rejected,0)>0 THEN
    INSERT INTO public.production_operation_wip(
      tenant_id,production_order_id,routing_id,item_id,batch_number,event_type,
      quantity,from_work_station_id,station_completion_id,evidence,created_by,idempotency_key
    ) VALUES (
      NEW.tenant_id,NEW.production_order_id,NEW.routing_id,v_order.item_id,
      NEW.id::text,'REJECTED',NEW.quantity_rejected,NEW.work_station_id,NEW.id,
      jsonb_build_object('source','DATABASE_COMPLETION_TRIGGER'),NEW.operator_id,
      NEW.id::text||':REJECTED'
    ) ON CONFLICT (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;
  IF COALESCE(NEW.rework_quantity,0)>0 THEN
    INSERT INTO public.production_operation_wip(
      tenant_id,production_order_id,routing_id,item_id,batch_number,event_type,
      quantity,from_work_station_id,station_completion_id,evidence,created_by,idempotency_key
    ) VALUES (
      NEW.tenant_id,NEW.production_order_id,NEW.routing_id,v_order.item_id,
      NEW.id::text,'REWORK',NEW.rework_quantity,NEW.work_station_id,NEW.id,
      jsonb_build_object('source','DATABASE_COMPLETION_TRIGGER'),NEW.operator_id,
      NEW.id::text||':REWORK'
    ) ON CONFLICT (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;
  FOREACH v_pred IN ARRAY v_predecessors LOOP
    IF v_processed>0 THEN
      INSERT INTO public.production_operation_wip(
        tenant_id,production_order_id,routing_id,predecessor_routing_id,item_id,
        batch_number,event_type,quantity,from_work_station_id,to_work_station_id,
        station_completion_id,evidence,created_by,idempotency_key,transfer_group_id
      ) VALUES (
        NEW.tenant_id,NEW.production_order_id,v_pred,NEW.routing_id,v_order.item_id,
        NEW.id::text,'TRANSFER',v_processed,NULL,NEW.work_station_id,NEW.id,
        jsonb_build_object('source','DATABASE_COMPLETION_TRIGGER'),NEW.operator_id,
        NEW.id::text||':TRANSFER:'||v_pred::text,v_group
      ) ON CONFLICT (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      INSERT INTO public.production_operation_wip(
        tenant_id,production_order_id,routing_id,predecessor_routing_id,item_id,
        batch_number,event_type,quantity,to_work_station_id,station_completion_id,
        evidence,created_by,idempotency_key,transfer_group_id
      ) VALUES (
        NEW.tenant_id,NEW.production_order_id,NEW.routing_id,v_pred,v_order.item_id,
        NEW.id::text,'CONSUMPTION',v_processed,NEW.work_station_id,NEW.id,
        jsonb_build_object('source','DATABASE_COMPLETION_TRIGGER'),NEW.operator_id,
        NEW.id::text||':CONSUMPTION:'||v_pred::text,v_group
      ) ON CONFLICT (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_station_completion_wip ON public.station_completions;
CREATE TRIGGER trg_record_station_completion_wip
AFTER UPDATE OF status,quantity_completed,quantity_rejected ON public.station_completions
FOR EACH ROW EXECUTE FUNCTION public.record_station_completion_wip();

CREATE OR REPLACE FUNCTION public.record_station_rework_wip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order_item UUID; v_delta NUMERIC;
BEGIN
  v_delta:=GREATEST(0,COALESCE(NEW.rework_quantity,0)-COALESCE(OLD.rework_quantity,0));
  IF NEW.status::text<>'COMPLETED' OR v_delta<=0 THEN RETURN NEW; END IF;
  SELECT item_id INTO v_order_item FROM public.production_orders WHERE id=NEW.production_order_id;
  INSERT INTO public.production_operation_wip(
    tenant_id,production_order_id,routing_id,item_id,batch_number,event_type,
    quantity,from_work_station_id,station_completion_id,evidence,created_by,idempotency_key
  ) VALUES (
    NEW.tenant_id,NEW.production_order_id,NEW.routing_id,v_order_item,NEW.id::text,
    'REWORK',v_delta,NEW.work_station_id,NEW.id,
    jsonb_build_object('source','DATABASE_REWORK_TRIGGER'),NEW.operator_id,
    NEW.id::text||':REWORK'
  ) ON CONFLICT (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_station_rework_wip ON public.station_completions;
CREATE TRIGGER trg_record_station_rework_wip
AFTER UPDATE OF rework_quantity ON public.station_completions
FOR EACH ROW EXECUTE FUNCTION public.record_station_rework_wip();

CREATE OR REPLACE VIEW public.production_operation_wip_balance AS
SELECT tenant_id,production_order_id,routing_id,item_id,batch_number,
  SUM(CASE
    WHEN event_type IN ('GOOD_OUTPUT','REWORK') THEN quantity
    WHEN event_type IN ('TRANSFER','REVERSAL') THEN -quantity
    ELSE 0 END)::NUMERIC(18,4) available_quantity,
  MAX(created_at) last_movement_at
FROM public.production_operation_wip
GROUP BY tenant_id,production_order_id,routing_id,item_id,batch_number;

CREATE OR REPLACE VIEW public.production_factory_blockers AS
SELECT a.tenant_id,a.parent_job_order_id job_order_id,
       'SUPPLY_ACTION'::TEXT blocker_type,a.action_type::TEXT blocker_code,
       a.item_id,a.required_quantity,COALESCE(a.notes,'Supply action requires completion') detail,
       a.status,a.required_by_date
FROM public.production_supply_actions a
WHERE a.status NOT IN ('COMPLETED','CANCELLED')
UNION ALL
SELECT p.tenant_id,p.parent_job_order_id,'CHILD_SUPPLY',p.supply_policy,p.item_id,
       GREATEST(0,p.required_quantity-p.stock_allocated_quantity-p.received_quantity),
       'Child or scheduled supply is not yet available',p.status,p.required_by_date
FROM public.production_supply_pegging p
WHERE p.status NOT IN ('AVAILABLE','CONSUMED','CANCELLED');

REVOKE ALL ON FUNCTION public.reserve_production_job_materials(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_production_job_materials(UUID,UUID,UUID) TO service_role;

COMMIT;
