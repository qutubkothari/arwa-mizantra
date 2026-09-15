-- Smart-production governance additions. Safe to rerun.
ALTER TABLE public.plant_assets
  ADD COLUMN IF NOT EXISTS work_station_id UUID;

ALTER TABLE public.plant_maintenance_work_orders
  ADD COLUMN IF NOT EXISTS planned_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planned_end TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_plant_assets_station
  ON public.plant_assets(tenant_id, work_station_id)
  WHERE work_station_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.production_procurement_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES public.production_programs(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.production_planning_runs(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(120) NOT NULL,
  purchase_requisition_id UUID,
  purchase_requisition_number VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'CREATED' CHECK(status IN('CREATING','CREATED','FAILED')),
  proposal_hash CHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, idempotency_key),
  UNIQUE(tenant_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_prod_procurement_conversion_program
  ON public.production_procurement_conversions(tenant_id, program_id, created_at DESC);

-- Older installations created the policy constraint before overlapped execution
-- was added to the planner UI.
ALTER TABLE public.production_stage_policies
  DROP CONSTRAINT IF EXISTS production_stage_policies_execution_mode_check;
ALTER TABLE public.production_stage_policies
  ADD CONSTRAINT production_stage_policies_execution_mode_check
  CHECK(execution_mode IN('SEQUENTIAL','PARALLEL','OVERLAPPED','SYNCHRONIZED'));
