-- Execution-linked tooling intelligence. Additive, tenant scoped and safe to rerun.

ALTER TABLE public.production_tool_resources
  ADD COLUMN IF NOT EXISTS life_basis VARCHAR(24) NOT NULL DEFAULT 'STROKES',
  ADD COLUMN IF NOT EXISTS life_limit_value NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS life_used_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS life_uom VARCHAR(16) NOT NULL DEFAULT 'STROKES',
  ADD COLUMN IF NOT EXISTS replacement_minutes NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refurbishment_limit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refurbishments_done INTEGER NOT NULL DEFAULT 0;

UPDATE public.production_tool_resources
SET life_limit_value = COALESCE(life_limit_value, life_limit_cycles),
    life_used_value = CASE
      WHEN life_used_value = 0 THEN COALESCE(cycles_used, 0)
      ELSE life_used_value
    END
WHERE life_limit_cycles IS NOT NULL OR cycles_used <> 0;

ALTER TABLE public.production_tool_resources
  DROP CONSTRAINT IF EXISTS production_tool_life_basis_check,
  ADD CONSTRAINT production_tool_life_basis_check CHECK (
    life_basis IN ('KG_INPUT','GOOD_PIECES','TOTAL_PIECES','STROKES','RUN_HOURS','BATCHES')
  ) NOT VALID,
  DROP CONSTRAINT IF EXISTS production_tool_life_values_check,
  ADD CONSTRAINT production_tool_life_values_check CHECK (
    life_used_value >= 0
    AND (life_limit_value IS NULL OR life_limit_value > 0)
    AND replacement_minutes >= 0
    AND refurbishment_limit >= 0
    AND refurbishments_done >= 0
  ) NOT VALID;

ALTER TABLE public.production_tool_resources
  DROP CONSTRAINT IF EXISTS production_tool_resources_tenant_id_tool_code_work_station_id_key;
DROP INDEX IF EXISTS public.uq_production_tool_resource_scope;
DROP INDEX IF EXISTS public.uq_production_tool_resource_identity;
CREATE UNIQUE INDEX uq_production_tool_resource_identity
  ON public.production_tool_resources (tenant_id, tool_code, work_station_id, serial_number) NULLS NOT DISTINCT;

ALTER TABLE public.station_completions
  ADD COLUMN IF NOT EXISTS actual_input_quantity NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS actual_input_uom VARCHAR(16),
  ADD COLUMN IF NOT EXISTS actual_scrap_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS machine_strokes NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS batch_count NUMERIC(18,4);

CREATE TABLE IF NOT EXISTS public.production_tool_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  station_completion_id UUID NOT NULL REFERENCES public.station_completions(id) ON DELETE CASCADE,
  production_order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  routing_id UUID NOT NULL REFERENCES public.production_routing(id) ON DELETE RESTRICT,
  work_station_id UUID NOT NULL REFERENCES public.work_stations(id) ON DELETE RESTRICT,
  tool_resource_id UUID NOT NULL REFERENCES public.production_tool_resources(id) ON DELETE RESTRICT,
  tool_code VARCHAR(80) NOT NULL,
  life_basis VARCHAR(24) NOT NULL,
  life_uom VARCHAR(16) NOT NULL,
  planned_usage_value NUMERIC(18,4),
  actual_usage_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  assignment_source VARCHAR(20) NOT NULL DEFAULT 'AUTO',
  change_reason TEXT,
  evidence_reference TEXT,
  assigned_by UUID NOT NULL,
  removed_by UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_USE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (life_basis IN ('KG_INPUT','GOOD_PIECES','TOTAL_PIECES','STROKES','RUN_HOURS','BATCHES')),
  CHECK (planned_usage_value IS NULL OR planned_usage_value >= 0),
  CHECK (actual_usage_value >= 0),
  CHECK (assignment_source IN ('AUTO','OPERATOR','SUPERVISOR','IOT')),
  CHECK (status IN ('IN_USE','CHANGED','COMPLETED'))
);

CREATE INDEX IF NOT EXISTS idx_production_tool_assignment_completion
  ON public.production_tool_assignments (tenant_id, station_completion_id, installed_at);
CREATE INDEX IF NOT EXISTS idx_production_tool_assignment_resource
  ON public.production_tool_assignments (tenant_id, tool_resource_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_tool_assignment_active_code
  ON public.production_tool_assignments (tenant_id, station_completion_id, tool_code)
  WHERE status = 'IN_USE';

ALTER TABLE public.production_tool_events
  ADD COLUMN IF NOT EXISTS station_completion_id UUID REFERENCES public.station_completions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tool_assignment_id UUID REFERENCES public.production_tool_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_order_id UUID REFERENCES public.production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_id UUID REFERENCES public.production_routing(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_station_id UUID REFERENCES public.work_stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS life_basis VARCHAR(24),
  ADD COLUMN IF NOT EXISTS life_usage_value NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS life_uom VARCHAR(16),
  ADD COLUMN IF NOT EXISTS actual_input_quantity NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS actual_input_uom VARCHAR(16),
  ADD COLUMN IF NOT EXISTS good_quantity NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS rejected_quantity NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS scrap_quantity NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS machine_strokes NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS batch_count NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS change_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_production_tool_event_execution
  ON public.production_tool_events (tenant_id, work_station_id, event_date DESC);

CREATE OR REPLACE FUNCTION public.record_production_tool_usage(
  p_tenant_id UUID,
  p_tool_resource_id UUID,
  p_cycle_quantity NUMERIC,
  p_performed_by UUID,
  p_evidence_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tool public.production_tool_resources%ROWTYPE;
  v_used NUMERIC;
  v_event UUID;
BEGIN
  IF p_cycle_quantity <= 0 OR btrim(COALESCE(p_evidence_reference,'')) = '' THEN
    RAISE EXCEPTION 'Positive usage in the configured life unit and evidence are required.';
  END IF;
  SELECT * INTO v_tool FROM public.production_tool_resources
  WHERE tenant_id=p_tenant_id AND id=p_tool_resource_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tool resource not found.'; END IF;
  v_used := COALESCE(v_tool.life_used_value,0) + p_cycle_quantity;
  UPDATE public.production_tool_resources SET
    life_used_value=v_used,
    cycles_used=CASE WHEN v_tool.life_basis IN ('STROKES','GOOD_PIECES','TOTAL_PIECES') THEN v_used ELSE cycles_used END,
    status=CASE WHEN v_tool.life_limit_value IS NOT NULL AND v_used >= v_tool.life_limit_value THEN 'BLOCKED' ELSE status END,
    block_reason=CASE WHEN v_tool.life_limit_value IS NOT NULL AND v_used >= v_tool.life_limit_value THEN 'Certified tool life exhausted' ELSE block_reason END,
    updated_by=p_performed_by,updated_at=NOW()
  WHERE tenant_id=p_tenant_id AND id=p_tool_resource_id;
  INSERT INTO public.production_tool_events (
    tenant_id,tool_resource_id,event_type,cycle_quantity,evidence_reference,status,
    performed_by,verified_by,verified_at,verification_note,life_basis,
    life_usage_value,life_uom
  ) VALUES (
    p_tenant_id,p_tool_resource_id,'USAGE',
    CASE WHEN v_tool.life_basis IN ('STROKES','GOOD_PIECES','TOTAL_PIECES') THEN p_cycle_quantity ELSE 0 END,
    btrim(p_evidence_reference),'VERIFIED',p_performed_by,p_performed_by,NOW(),
    'Manual usage evidence',v_tool.life_basis,p_cycle_quantity,v_tool.life_uom
  ) RETURNING id INTO v_event;
  RETURN jsonb_build_object('event_id',v_event,'life_used_value',v_used,
    'life_uom',v_tool.life_uom,'blocked',v_tool.life_limit_value IS NOT NULL AND v_used >= v_tool.life_limit_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_station_operation_with_tooling(
  p_tenant_id UUID,
  p_completion_id UUID,
  p_user_id UUID,
  p_good_quantity NUMERIC,
  p_rejected_quantity NUMERIC,
  p_end_time TIMESTAMPTZ,
  p_actual_time_minutes NUMERIC,
  p_notes TEXT,
  p_actual_input_quantity NUMERIC,
  p_actual_input_uom TEXT,
  p_scrap_quantity NUMERIC,
  p_machine_strokes NUMERIC,
  p_batch_count NUMERIC,
  p_tool_usages JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion public.station_completions%ROWTYPE;
  v_usage JSONB;
  v_assignment public.production_tool_assignments%ROWTYPE;
  v_tool public.production_tool_resources%ROWTYPE;
  v_value NUMERIC;
  v_used NUMERIC;
  v_event UUID;
BEGIN
  SELECT * INTO v_completion
  FROM public.station_completions
  WHERE tenant_id = p_tenant_id AND id = p_completion_id
  FOR UPDATE;
  IF NOT FOUND OR v_completion.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'The production operation is no longer available for completion.';
  END IF;
  IF v_completion.operator_id <> p_user_id THEN
    RAISE EXCEPTION 'Only the assigned operator can complete this operation.';
  END IF;

  FOR v_usage IN SELECT value FROM jsonb_array_elements(COALESCE(p_tool_usages, '[]'::jsonb))
  LOOP
    v_value := COALESCE((v_usage->>'usage_value')::NUMERIC, 0);
    IF v_value < 0 THEN RAISE EXCEPTION 'Tool usage cannot be negative.'; END IF;
    SELECT * INTO v_assignment
    FROM public.production_tool_assignments
    WHERE tenant_id = p_tenant_id
      AND id = (v_usage->>'assignment_id')::UUID
      AND station_completion_id = p_completion_id
      AND status = 'IN_USE'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'An active tooling assignment was not found.'; END IF;

    SELECT * INTO v_tool
    FROM public.production_tool_resources
    WHERE tenant_id = p_tenant_id AND id = v_assignment.tool_resource_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The assigned tooling resource was not found.'; END IF;

    v_used := COALESCE(v_tool.life_used_value, 0) + v_value;
    UPDATE public.production_tool_resources SET
      life_used_value = v_used,
      cycles_used = CASE
        WHEN v_tool.life_basis IN ('STROKES','GOOD_PIECES','TOTAL_PIECES') THEN v_used
        ELSE cycles_used
      END,
      status = CASE
        WHEN v_tool.life_limit_value IS NOT NULL AND v_used >= v_tool.life_limit_value THEN 'BLOCKED'
        ELSE status
      END,
      block_reason = CASE
        WHEN v_tool.life_limit_value IS NOT NULL AND v_used >= v_tool.life_limit_value THEN 'Certified tool life exhausted'
        ELSE block_reason
      END,
      updated_by = p_user_id,
      updated_at = NOW()
    WHERE tenant_id = p_tenant_id AND id = v_tool.id;

    INSERT INTO public.production_tool_events (
      tenant_id, tool_resource_id, event_type, event_date, cycle_quantity,
      evidence_reference, status, performed_by, station_completion_id,
      tool_assignment_id, production_order_id, routing_id, work_station_id,
      life_basis, life_usage_value, life_uom, actual_input_quantity,
      actual_input_uom, good_quantity, rejected_quantity, scrap_quantity,
      machine_strokes, batch_count
    ) VALUES (
      p_tenant_id, v_tool.id, 'USAGE', p_end_time::DATE,
      CASE WHEN v_tool.life_basis IN ('STROKES','GOOD_PIECES','TOTAL_PIECES') THEN v_value ELSE 0 END,
      'Shop-floor completion ' || p_completion_id::TEXT, 'VERIFIED', p_user_id,
      p_completion_id, v_assignment.id, v_completion.production_order_id,
      v_completion.routing_id, v_completion.work_station_id, v_tool.life_basis,
      v_value, v_tool.life_uom, p_actual_input_quantity, p_actual_input_uom,
      p_good_quantity, p_rejected_quantity, p_scrap_quantity,
      p_machine_strokes, p_batch_count
    ) RETURNING id INTO v_event;

    UPDATE public.production_tool_assignments SET
      actual_usage_value = actual_usage_value + v_value,
      removed_at = p_end_time,
      removed_by = p_user_id,
      status = 'COMPLETED'
    WHERE tenant_id = p_tenant_id AND id = v_assignment.id;
  END LOOP;

  UPDATE public.station_completions SET
    quantity_completed = p_good_quantity,
    quantity_rejected = p_rejected_quantity,
    end_time = p_end_time,
    actual_time_minutes = p_actual_time_minutes,
    completed_by = p_user_id,
    notes = COALESCE(NULLIF(btrim(p_notes), ''), notes),
    actual_input_quantity = p_actual_input_quantity,
    actual_input_uom = NULLIF(upper(btrim(p_actual_input_uom)), ''),
    actual_scrap_quantity = COALESCE(p_scrap_quantity, 0),
    machine_strokes = p_machine_strokes,
    batch_count = p_batch_count,
    status = 'COMPLETED',
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id AND id = p_completion_id;

  RETURN (SELECT to_jsonb(sc) FROM public.station_completions sc WHERE sc.id = p_completion_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.change_station_operation_tool(
  p_tenant_id UUID,
  p_completion_id UUID,
  p_assignment_id UUID,
  p_replacement_tool_resource_id UUID,
  p_usage_value NUMERIC,
  p_reason TEXT,
  p_evidence_reference TEXT,
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion public.station_completions%ROWTYPE;
  v_assignment public.production_tool_assignments%ROWTYPE;
  v_tool public.production_tool_resources%ROWTYPE;
  v_replacement public.production_tool_resources%ROWTYPE;
  v_used NUMERIC;
  v_active INTEGER;
  v_new_assignment UUID;
BEGIN
  IF COALESCE(p_usage_value, -1) < 0 OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Actual outgoing usage and a tool-change reason are required.';
  END IF;
  SELECT * INTO v_completion FROM public.station_completions
  WHERE tenant_id=p_tenant_id AND id=p_completion_id FOR UPDATE;
  IF NOT FOUND OR v_completion.status <> 'IN_PROGRESS' OR v_completion.operator_id <> p_user_id THEN
    RAISE EXCEPTION 'Only the active operator can change tooling.';
  END IF;
  SELECT * INTO v_assignment FROM public.production_tool_assignments
  WHERE tenant_id=p_tenant_id AND id=p_assignment_id
    AND station_completion_id=p_completion_id AND status='IN_USE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active tooling assignment not found.'; END IF;
  SELECT * INTO v_tool FROM public.production_tool_resources
  WHERE tenant_id=p_tenant_id AND id=v_assignment.tool_resource_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outgoing tooling resource not found.'; END IF;
  SELECT * INTO v_replacement FROM public.production_tool_resources
  WHERE tenant_id=p_tenant_id AND id=p_replacement_tool_resource_id FOR UPDATE;
  IF NOT FOUND OR v_replacement.tool_code <> v_assignment.tool_code THEN
    RAISE EXCEPTION 'Replacement tooling must satisfy the same required tool code.';
  END IF;
  IF v_replacement.status <> 'AVAILABLE' OR v_replacement.available_quantity <= 0
    OR (v_replacement.valid_until IS NOT NULL AND v_replacement.valid_until < CURRENT_DATE)
    OR (v_replacement.life_limit_value IS NOT NULL AND v_replacement.life_used_value >= v_replacement.life_limit_value)
    OR (v_replacement.calibration_required AND (v_replacement.calibration_status <> 'VALID' OR v_replacement.next_calibration_due < CURRENT_DATE))
    OR (v_replacement.work_station_id IS NOT NULL AND v_replacement.work_station_id <> v_completion.work_station_id)
  THEN RAISE EXCEPTION 'Replacement tooling is not available or valid for this machine.'; END IF;
  SELECT COUNT(*) INTO v_active FROM public.production_tool_assignments
  WHERE tenant_id=p_tenant_id AND tool_resource_id=v_replacement.id AND status='IN_USE';
  IF v_active >= v_replacement.available_quantity THEN
    RAISE EXCEPTION 'All available units of the replacement tool are already in use.';
  END IF;

  v_used := COALESCE(v_tool.life_used_value,0) + p_usage_value;
  UPDATE public.production_tool_resources SET
    life_used_value=v_used,
    cycles_used=CASE WHEN v_tool.life_basis IN ('STROKES','GOOD_PIECES','TOTAL_PIECES') THEN v_used ELSE cycles_used END,
    status=CASE WHEN v_tool.life_limit_value IS NOT NULL AND v_used >= v_tool.life_limit_value THEN 'BLOCKED' ELSE status END,
    block_reason=CASE WHEN v_tool.life_limit_value IS NOT NULL AND v_used >= v_tool.life_limit_value THEN 'Certified tool life exhausted' ELSE block_reason END,
    updated_by=p_user_id,updated_at=NOW()
  WHERE tenant_id=p_tenant_id AND id=v_tool.id;

  INSERT INTO public.production_tool_events (
    tenant_id,tool_resource_id,event_type,event_date,cycle_quantity,evidence_reference,
    status,performed_by,station_completion_id,tool_assignment_id,production_order_id,
    routing_id,work_station_id,life_basis,life_usage_value,life_uom,change_reason
  ) VALUES (
    p_tenant_id,v_tool.id,'USAGE',CURRENT_DATE,
    CASE WHEN v_tool.life_basis IN ('STROKES','GOOD_PIECES','TOTAL_PIECES') THEN p_usage_value ELSE 0 END,
    COALESCE(NULLIF(btrim(p_evidence_reference),''),'Tool change '||p_completion_id::TEXT),
    'VERIFIED',p_user_id,p_completion_id,v_assignment.id,v_completion.production_order_id,
    v_completion.routing_id,v_completion.work_station_id,v_tool.life_basis,p_usage_value,
    v_tool.life_uom,btrim(p_reason)
  );
  UPDATE public.production_tool_assignments SET
    actual_usage_value=actual_usage_value+p_usage_value,removed_at=NOW(),removed_by=p_user_id,
    status='CHANGED',change_reason=btrim(p_reason),evidence_reference=NULLIF(btrim(p_evidence_reference),'')
  WHERE tenant_id=p_tenant_id AND id=v_assignment.id;

  INSERT INTO public.production_tool_assignments (
    tenant_id,station_completion_id,production_order_id,routing_id,work_station_id,
    tool_resource_id,tool_code,life_basis,life_uom,installed_at,assignment_source,
    change_reason,evidence_reference,assigned_by,status
  ) VALUES (
    p_tenant_id,p_completion_id,v_completion.production_order_id,v_completion.routing_id,
    v_completion.work_station_id,v_replacement.id,v_replacement.tool_code,
    v_replacement.life_basis,v_replacement.life_uom,NOW(),'OPERATOR',btrim(p_reason),
    NULLIF(btrim(p_evidence_reference),''),p_user_id,'IN_USE'
  ) RETURNING id INTO v_new_assignment;
  RETURN jsonb_build_object('assignment_id',v_new_assignment,'tool_resource_id',v_replacement.id,'tool_code',v_replacement.tool_code);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_station_operation_with_tooling(UUID,UUID,UUID,NUMERIC,NUMERIC,TIMESTAMPTZ,NUMERIC,TEXT,NUMERIC,TEXT,NUMERIC,NUMERIC,NUMERIC,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_station_operation_with_tooling(UUID,UUID,UUID,NUMERIC,NUMERIC,TIMESTAMPTZ,NUMERIC,TEXT,NUMERIC,TEXT,NUMERIC,NUMERIC,NUMERIC,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.change_station_operation_tool(UUID,UUID,UUID,UUID,NUMERIC,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_station_operation_tool(UUID,UUID,UUID,UUID,NUMERIC,TEXT,TEXT,UUID) TO service_role;

COMMENT ON TABLE public.production_tool_assignments IS
  'Physical tooling installed for a specific shop-floor operation, including replacements and actual life consumed.';
