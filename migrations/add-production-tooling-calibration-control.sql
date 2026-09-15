-- Tool/die/gauge life and calibration controls integrated with APS availability.
-- Additive only; no production completion, inventory or accounting posting occurs.
ALTER TABLE public.production_tool_resources
  ADD COLUMN IF NOT EXISTS serial_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS resource_type VARCHAR(20) NOT NULL DEFAULT 'TOOL',
  ADD COLUMN IF NOT EXISTS life_limit_cycles NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS cycles_used NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calibration_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_calibration_date DATE,
  ADD COLUMN IF NOT EXISTS next_calibration_due DATE,
  ADD COLUMN IF NOT EXISTS calibration_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE public.production_tool_resources
  DROP CONSTRAINT IF EXISTS production_tool_resource_type_check,
  ADD CONSTRAINT production_tool_resource_type_check
    CHECK (resource_type IN ('TOOL','PUNCH','DIE','MOULD','JIG','FIXTURE','GAUGE')) NOT VALID,
  DROP CONSTRAINT IF EXISTS production_tool_life_check,
  ADD CONSTRAINT production_tool_life_check
    CHECK (cycles_used >= 0 AND (life_limit_cycles IS NULL OR life_limit_cycles > 0)) NOT VALID,
  DROP CONSTRAINT IF EXISTS production_tool_calibration_status_check,
  ADD CONSTRAINT production_tool_calibration_status_check
    CHECK (calibration_status IN ('NOT_REQUIRED','VALID','DUE','FAILED')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.production_tool_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tool_resource_id UUID NOT NULL REFERENCES public.production_tool_resources(id) ON DELETE RESTRICT,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('USAGE','CALIBRATION','REPAIR','BLOCK','UNBLOCK')),
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cycle_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (cycle_quantity >= 0),
  result VARCHAR(20) CHECK (result IS NULL OR result IN ('PASS','FAIL','CONDITIONAL')),
  next_due_date DATE,
  evidence_reference TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','VERIFIED','REJECTED')),
  performed_by UUID NOT NULL,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  verification_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_tool_events
  ON public.production_tool_events (tenant_id, tool_resource_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_production_tools_calibration
  ON public.production_tool_resources (tenant_id, status, calibration_status, next_calibration_due);

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
  v_cycles NUMERIC;
  v_event UUID;
BEGIN
  IF p_cycle_quantity <= 0 OR btrim(coalesce(p_evidence_reference,'')) = '' THEN
    RAISE EXCEPTION 'Positive cycle quantity and evidence are required.';
  END IF;
  SELECT * INTO v_tool FROM public.production_tool_resources
  WHERE tenant_id = p_tenant_id AND id = p_tool_resource_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tool resource not found.'; END IF;
  IF v_tool.status <> 'AVAILABLE' THEN RAISE EXCEPTION 'Only an available tool can record production usage.'; END IF;
  v_cycles := v_tool.cycles_used + p_cycle_quantity;
  UPDATE public.production_tool_resources SET
    cycles_used = v_cycles,
    status = CASE WHEN life_limit_cycles IS NOT NULL AND v_cycles >= life_limit_cycles THEN 'BLOCKED' ELSE status END,
    block_reason = CASE WHEN life_limit_cycles IS NOT NULL AND v_cycles >= life_limit_cycles THEN 'Certified tool life exhausted' ELSE block_reason END,
    updated_by = p_performed_by,
    updated_at = NOW()
  WHERE id = v_tool.id;
  INSERT INTO public.production_tool_events
    (tenant_id,tool_resource_id,event_type,cycle_quantity,evidence_reference,status,performed_by,verified_by,verified_at,verification_note)
  VALUES
    (p_tenant_id,v_tool.id,'USAGE',p_cycle_quantity,btrim(p_evidence_reference),'VERIFIED',p_performed_by,p_performed_by,NOW(),'System-verified atomic life counter')
  RETURNING id INTO v_event;
  RETURN jsonb_build_object('event_id',v_event,'cycles_used',v_cycles,'blocked',v_tool.life_limit_cycles IS NOT NULL AND v_cycles >= v_tool.life_limit_cycles);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_production_tool_calibration(
  p_tenant_id UUID,
  p_event_id UUID,
  p_verified_by UUID,
  p_verification_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.production_tool_events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.production_tool_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id AND event_type = 'CALIBRATION' FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'RECORDED' THEN RAISE EXCEPTION 'Pending calibration record not found.'; END IF;
  IF v_event.performed_by = p_verified_by THEN RAISE EXCEPTION 'Independent calibration verification is required.'; END IF;
  IF btrim(coalesce(p_verification_note,'')) = '' THEN RAISE EXCEPTION 'Verification note is required.'; END IF;
  UPDATE public.production_tool_events SET status='VERIFIED',verified_by=p_verified_by,verified_at=NOW(),verification_note=btrim(p_verification_note)
  WHERE id=v_event.id;
  UPDATE public.production_tool_resources SET
    last_calibration_date=v_event.event_date,
    next_calibration_due=v_event.next_due_date,
    calibration_status=CASE WHEN v_event.result='PASS' THEN 'VALID' ELSE 'FAILED' END,
    status=CASE
      WHEN v_event.result='PASS' AND (life_limit_cycles IS NULL OR cycles_used < life_limit_cycles) THEN 'AVAILABLE'
      ELSE 'BLOCKED'
    END,
    block_reason=CASE
      WHEN v_event.result<>'PASS' THEN 'Calibration failed'
      WHEN life_limit_cycles IS NOT NULL AND cycles_used >= life_limit_cycles THEN 'Certified tool life exhausted'
      ELSE NULL
    END,
    updated_by=p_verified_by,
    updated_at=NOW()
  WHERE tenant_id=p_tenant_id AND id=v_event.tool_resource_id;
  RETURN jsonb_build_object('event_id',v_event.id,'tool_resource_id',v_event.tool_resource_id,'result',v_event.result,'status','VERIFIED');
END;
$$;

COMMENT ON TABLE public.production_tool_events IS
  'Auditable tool life and independently verified calibration evidence used by APS availability.';

REVOKE ALL ON FUNCTION public.record_production_tool_usage(UUID,UUID,NUMERIC,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_production_tool_usage(UUID,UUID,NUMERIC,UUID,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.verify_production_tool_calibration(UUID,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_production_tool_calibration(UUID,UUID,UUID,TEXT) TO service_role;
