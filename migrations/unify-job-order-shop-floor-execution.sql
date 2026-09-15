BEGIN;

-- Unify the planning Job Order with the operator-facing Shop Floor order.
-- One production_job_order owns one production_orders execution record.
-- Routing confirmations update the same Job Order operation and final output.

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS job_order_id UUID
    REFERENCES public.production_job_orders(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_production_orders_job_order
  ON public.production_orders(tenant_id, job_order_id)
  WHERE job_order_id IS NOT NULL;

ALTER TABLE public.production_order_components
  ADD COLUMN IF NOT EXISTS job_order_material_id UUID
    REFERENCES public.job_order_materials(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_production_components_job_material
  ON public.production_order_components(job_order_material_id)
  WHERE job_order_material_id IS NOT NULL;

ALTER TABLE public.job_order_operations
  ADD COLUMN IF NOT EXISTS routing_id UUID
    REFERENCES public.production_routing(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rework_quantity NUMERIC(18,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_job_order_operations_routing
  ON public.job_order_operations(job_order_id, routing_id);

ALTER TABLE public.station_completions
  ADD COLUMN IF NOT EXISTS job_order_id UUID
    REFERENCES public.production_job_orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS job_order_operation_id UUID
    REFERENCES public.job_order_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rework_quantity NUMERIC(18,4) NOT NULL DEFAULT 0;

ALTER TABLE public.station_completions
  DROP CONSTRAINT IF EXISTS station_completion_nonnegative_rework,
  ADD CONSTRAINT station_completion_nonnegative_rework
    CHECK (rework_quantity >= 0) NOT VALID;

CREATE INDEX IF NOT EXISTS ix_station_completions_job_order
  ON public.station_completions(tenant_id, job_order_id, routing_id);

-- Link historical operation snapshots to their canonical route.
UPDATE public.job_order_operations operation
SET routing_id = route.id
FROM public.production_job_orders job,
     public.production_routing route
WHERE operation.job_order_id = job.id
  AND route.tenant_id = job.tenant_id
  AND route.bom_id = job.bom_id
  AND route.sequence_no = operation.sequence_number
  AND operation.routing_id IS NULL;

-- Repair workstation labels created by the earlier obsolete table lookup.
UPDATE public.job_order_operations operation
SET workstation_name = station.station_name
FROM public.work_stations station
WHERE operation.workstation_id = station.id
  AND operation.workstation_name IS DISTINCT FROM station.station_name;

-- Reuse any earlier execution record that already used the Job Order number.
UPDATE public.production_orders execution
SET job_order_id = job.id
FROM public.production_job_orders job
WHERE execution.tenant_id = job.tenant_id
  AND execution.order_number = job.job_order_number
  AND execution.job_order_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_job_order_execution_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  execution_status public.production_order_status;
BEGIN
  execution_status := CASE NEW.status::text
    WHEN 'IN_PROGRESS' THEN 'RELEASED'::public.production_order_status
    WHEN 'STORE_ISSUED' THEN 'RELEASED'::public.production_order_status
    WHEN 'COMPLETED' THEN 'COMPLETED'::public.production_order_status
    WHEN 'QC_COMPLETED' THEN 'COMPLETED'::public.production_order_status
    WHEN 'CANCELLED' THEN 'CANCELLED'::public.production_order_status
    WHEN 'STOPPED' THEN 'CANCELLED'::public.production_order_status
    ELSE 'DRAFT'::public.production_order_status
  END;

  INSERT INTO public.production_orders (
    tenant_id, order_number, item_id, bom_id, quantity, produced_quantity,
    status, start_date, end_date, actual_start_date, actual_end_date,
    priority, notes, created_by, job_order_id, created_at, updated_at
  ) VALUES (
    NEW.tenant_id, NEW.job_order_number, NEW.item_id, NEW.bom_id, NEW.quantity,
    COALESCE(NEW.completed_quantity, 0), execution_status,
    NEW.start_date::date, NEW.end_date::date, NEW.actual_start_date,
    NEW.actual_end_date, NEW.priority, NEW.notes, NEW.created_by, NEW.id,
    NEW.created_at, NOW()
  )
  ON CONFLICT (tenant_id, job_order_id) WHERE job_order_id IS NOT NULL
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    bom_id = EXCLUDED.bom_id,
    quantity = EXCLUDED.quantity,
    produced_quantity = GREATEST(
      COALESCE(public.production_orders.produced_quantity, 0),
      COALESCE(EXCLUDED.produced_quantity, 0)
    ),
    status = CASE
      WHEN public.production_orders.status = 'IN_PROGRESS'
       AND EXCLUDED.status = 'RELEASED' THEN 'IN_PROGRESS'::public.production_order_status
      ELSE EXCLUDED.status
    END,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    actual_start_date = COALESCE(public.production_orders.actual_start_date, EXCLUDED.actual_start_date),
    actual_end_date = EXCLUDED.actual_end_date,
    priority = EXCLUDED.priority,
    notes = EXCLUDED.notes,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_order_execution_order
  ON public.production_job_orders;
CREATE TRIGGER trg_sync_job_order_execution_order
AFTER INSERT OR UPDATE OF item_id, bom_id, quantity, completed_quantity,
  status, start_date, end_date, actual_start_date, actual_end_date,
  priority, notes
ON public.production_job_orders
FOR EACH ROW EXECUTE FUNCTION public.sync_job_order_execution_order();

-- Create an execution order for existing Job Orders as well.
INSERT INTO public.production_orders (
  tenant_id, order_number, item_id, bom_id, quantity, produced_quantity,
  status, start_date, end_date, actual_start_date, actual_end_date,
  priority, notes, created_by, job_order_id, created_at, updated_at
)
SELECT
  job.tenant_id, job.job_order_number, job.item_id, job.bom_id, job.quantity,
  COALESCE(job.completed_quantity, 0),
  CASE job.status::text
    WHEN 'IN_PROGRESS' THEN 'RELEASED'::public.production_order_status
    WHEN 'STORE_ISSUED' THEN 'RELEASED'::public.production_order_status
    WHEN 'COMPLETED' THEN 'COMPLETED'::public.production_order_status
    WHEN 'QC_COMPLETED' THEN 'COMPLETED'::public.production_order_status
    WHEN 'CANCELLED' THEN 'CANCELLED'::public.production_order_status
    WHEN 'STOPPED' THEN 'CANCELLED'::public.production_order_status
    ELSE 'DRAFT'::public.production_order_status
  END,
  job.start_date::date, job.end_date::date, job.actual_start_date,
  job.actual_end_date, job.priority, job.notes, job.created_by, job.id,
  job.created_at, NOW()
FROM public.production_job_orders job
WHERE job.bom_id IS NOT NULL
ON CONFLICT (tenant_id, job_order_id) WHERE job_order_id IS NOT NULL
DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_job_order_execution_component()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  material public.job_order_materials%ROWTYPE;
  execution_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.production_order_components
    WHERE job_order_material_id = OLD.id;
    RETURN OLD;
  END IF;

  material := NEW;
  SELECT id INTO execution_id
  FROM public.production_orders
  WHERE job_order_id = material.job_order_id
  LIMIT 1;

  IF execution_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.production_order_components (
    production_order_id, item_id, required_quantity, consumed_quantity,
    notes, job_order_material_id
  ) VALUES (
    execution_id, material.item_id, material.required_quantity,
    COALESCE(material.issued_quantity, 0), material.notes, material.id
  )
  ON CONFLICT (job_order_material_id) WHERE job_order_material_id IS NOT NULL
  DO UPDATE SET
    production_order_id = EXCLUDED.production_order_id,
    item_id = EXCLUDED.item_id,
    required_quantity = EXCLUDED.required_quantity,
    consumed_quantity = EXCLUDED.consumed_quantity,
    notes = EXCLUDED.notes;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_order_execution_component
  ON public.job_order_materials;
CREATE TRIGGER trg_sync_job_order_execution_component
AFTER INSERT OR UPDATE OR DELETE ON public.job_order_materials
FOR EACH ROW EXECUTE FUNCTION public.sync_job_order_execution_component();

INSERT INTO public.production_order_components (
  production_order_id, item_id, required_quantity, consumed_quantity,
  notes, job_order_material_id
)
SELECT execution.id, material.item_id, material.required_quantity,
  COALESCE(material.issued_quantity, 0), material.notes, material.id
FROM public.job_order_materials material
JOIN public.production_orders execution
  ON execution.job_order_id = material.job_order_id
ON CONFLICT (job_order_material_id) WHERE job_order_material_id IS NOT NULL
DO NOTHING;

CREATE OR REPLACE FUNCTION public.link_job_order_operation_to_routing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.routing_id IS NULL THEN
    SELECT route.id INTO NEW.routing_id
    FROM public.production_job_orders job
    JOIN public.production_routing route
      ON route.tenant_id = job.tenant_id
     AND route.bom_id = job.bom_id
     AND route.sequence_no = NEW.sequence_number
    WHERE job.id = NEW.job_order_id
    ORDER BY route.id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_job_order_operation_to_routing
  ON public.job_order_operations;
CREATE TRIGGER trg_link_job_order_operation_to_routing
BEFORE INSERT OR UPDATE OF job_order_id, sequence_number, routing_id
ON public.job_order_operations
FOR EACH ROW EXECUTE FUNCTION public.link_job_order_operation_to_routing();

CREATE OR REPLACE FUNCTION public.link_station_completion_to_job_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.job_order_id IS NULL THEN
    SELECT execution.job_order_id INTO NEW.job_order_id
    FROM public.production_orders execution
    WHERE execution.id = NEW.production_order_id;
  END IF;

  IF NEW.job_order_operation_id IS NULL AND NEW.job_order_id IS NOT NULL THEN
    SELECT operation.id INTO NEW.job_order_operation_id
    FROM public.job_order_operations operation
    WHERE operation.job_order_id = NEW.job_order_id
      AND (
        operation.routing_id = NEW.routing_id
        OR (operation.routing_id IS NULL AND operation.sequence_number = NEW.sequence_no)
      )
    ORDER BY (operation.routing_id = NEW.routing_id) DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_station_completion_to_job_order
  ON public.station_completions;
CREATE TRIGGER trg_link_station_completion_to_job_order
BEFORE INSERT OR UPDATE OF production_order_id, routing_id, sequence_no
ON public.station_completions
FOR EACH ROW EXECUTE FUNCTION public.link_station_completion_to_job_order();

CREATE OR REPLACE FUNCTION public.roll_up_station_completion_to_job_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  execution RECORD;
  route RECORD;
  prior_route_id UUID;
  good_qty NUMERIC := 0;
  reject_qty NUMERIC := 0;
  rework_qty NUMERIC := 0;
  runtime_hours NUMERIC := 0;
  active_count INTEGER := 0;
  input_target NUMERIC := 0;
  final_route_id UUID;
BEGIN
  IF NEW.job_order_id IS NULL OR NEW.job_order_operation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, tenant_id, bom_id, quantity, job_order_id
  INTO execution
  FROM public.production_orders
  WHERE id = NEW.production_order_id;

  SELECT id, sequence_no INTO route
  FROM public.production_routing
  WHERE id = NEW.routing_id;

  SELECT id INTO prior_route_id
  FROM public.production_routing
  WHERE tenant_id = execution.tenant_id
    AND bom_id = execution.bom_id
    AND sequence_no < route.sequence_no
  ORDER BY sequence_no DESC
  LIMIT 1;

  SELECT
    COALESCE(SUM(quantity_completed), 0),
    COALESCE(SUM(quantity_rejected), 0),
    COALESCE(SUM(rework_quantity), 0),
    COALESCE(SUM(actual_time_minutes), 0) / 60.0,
    COUNT(*) FILTER (WHERE status IN ('IN_PROGRESS', 'PAUSED'))
  INTO good_qty, reject_qty, rework_qty, runtime_hours, active_count
  FROM public.station_completions
  WHERE tenant_id = execution.tenant_id
    AND production_order_id = execution.id
    AND routing_id = route.id;

  IF prior_route_id IS NULL THEN
    input_target := execution.quantity;
  ELSE
    SELECT COALESCE(SUM(quantity_completed), 0)
    INTO input_target
    FROM public.station_completions
    WHERE tenant_id = execution.tenant_id
      AND production_order_id = execution.id
      AND routing_id = prior_route_id
      AND status = 'COMPLETED';
  END IF;

  UPDATE public.job_order_operations
  SET completed_quantity = good_qty,
      rejected_quantity = reject_qty,
      rework_quantity = rework_qty,
      actual_start_datetime = COALESCE(actual_start_datetime, NEW.start_time),
      actual_end_datetime = CASE
        WHEN active_count = 0 AND good_qty + reject_qty >= input_target AND input_target > 0
          THEN NEW.end_time
        ELSE NULL
      END,
      actual_duration_hours = runtime_hours,
      assigned_user_id = COALESCE(assigned_user_id, NEW.operator_id),
      status = CASE
        WHEN active_count > 0 AND NEW.status = 'PAUSED' THEN 'ON_HOLD'::public.operation_status
        WHEN active_count > 0 THEN 'IN_PROGRESS'::public.operation_status
        WHEN good_qty + reject_qty >= input_target AND input_target > 0
          THEN 'COMPLETED'::public.operation_status
        WHEN good_qty + reject_qty > 0 THEN 'IN_PROGRESS'::public.operation_status
        ELSE 'NOT_STARTED'::public.operation_status
      END,
      updated_at = NOW()
  WHERE id = NEW.job_order_operation_id;

  SELECT id INTO final_route_id
  FROM public.production_routing
  WHERE tenant_id = execution.tenant_id
    AND bom_id = execution.bom_id
  ORDER BY sequence_no DESC
  LIMIT 1;

  IF final_route_id = route.id THEN
    UPDATE public.production_job_orders
    SET completed_quantity = good_qty,
        rejected_quantity = reject_qty,
        actual_start_date = COALESCE(actual_start_date, NEW.start_time),
        updated_at = NOW()
    WHERE id = execution.job_order_id;

    UPDATE public.production_orders
    SET produced_quantity = good_qty,
        status = CASE
          WHEN active_count = 0 AND good_qty + reject_qty >= input_target AND input_target > 0
            THEN 'COMPLETED'::public.production_order_status
          ELSE 'IN_PROGRESS'::public.production_order_status
        END,
        updated_at = NOW()
    WHERE id = execution.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roll_up_station_completion_to_job_order
  ON public.station_completions;
CREATE TRIGGER trg_roll_up_station_completion_to_job_order
AFTER INSERT OR UPDATE OF status, quantity_completed, quantity_rejected,
  rework_quantity, actual_time_minutes, start_time, end_time
ON public.station_completions
FOR EACH ROW EXECUTE FUNCTION public.roll_up_station_completion_to_job_order();

-- Link historical confirmations and recalculate them through the new trigger.
UPDATE public.station_completions completion
SET job_order_id = execution.job_order_id,
    job_order_operation_id = operation.id
FROM public.production_orders execution,
     public.job_order_operations operation
WHERE completion.production_order_id = execution.id
  AND operation.job_order_id = execution.job_order_id
  AND operation.routing_id = completion.routing_id
  AND execution.job_order_id IS NOT NULL
  AND (completion.job_order_id IS NULL OR completion.job_order_operation_id IS NULL);

COMMENT ON COLUMN public.production_orders.job_order_id IS
  'Canonical Job Order that owns this operator-facing execution record.';
COMMENT ON COLUMN public.job_order_operations.routing_id IS
  'Canonical production_routing step used for Shop Floor execution.';
COMMENT ON COLUMN public.station_completions.rework_quantity IS
  'Quantity requiring rework, reported separately from good and rejected output.';

COMMIT;
