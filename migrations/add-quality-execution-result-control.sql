-- Connect approved inspection-plan parameters to governed execution results.
ALTER TABLE public.inspection_parameters
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plan_parameter_id UUID REFERENCES public.quality_inspection_plan_parameters(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sequence_number INTEGER,
  ADD COLUMN IF NOT EXISTS data_type VARCHAR(16) NOT NULL DEFAULT 'TEXT'
    CHECK (data_type IN ('NUMERIC','TEXT','PASS_FAIL')),
  ADD COLUMN IF NOT EXISTS criticality VARCHAR(16) NOT NULL DEFAULT 'MAJOR'
    CHECK (criticality IN ('MINOR','MAJOR','CRITICAL')),
  ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evaluated_by UUID;

UPDATE public.inspection_parameters parameter
SET tenant_id = inspection.tenant_id
FROM public.quality_inspections inspection
WHERE parameter.inspection_id = inspection.id
  AND parameter.tenant_id IS NULL;

ALTER TABLE public.inspection_parameters
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_parameter_plan_execution
  ON public.inspection_parameters (inspection_id, plan_parameter_id)
  WHERE plan_parameter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inspection_parameters_tenant_result
  ON public.inspection_parameters (tenant_id, inspection_id, result);

COMMENT ON TABLE public.inspection_parameters IS
  'Execution results materialized from the approved inspection-plan snapshot; mandatory results are required before completion.';
