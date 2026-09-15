-- Advanced warehouse optimization over existing bins and execution tasks.
CREATE TABLE IF NOT EXISTS public.warehouse_bin_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  bin_id UUID NOT NULL REFERENCES public.warehouse_bins(id) ON DELETE CASCADE,
  access_distance_meters NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (access_distance_meters >= 0),
  max_capacity_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (max_capacity_quantity >= 0),
  velocity_class VARCHAR(4) NOT NULL DEFAULT 'ANY' CHECK (velocity_class IN ('A','B','C','ANY')),
  handling_class VARCHAR(24) NOT NULL DEFAULT 'GENERAL' CHECK (handling_class IN ('GENERAL','FRAGILE','HAZMAT','COLD','BULK')),
  created_by UUID NOT NULL, updated_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, bin_id)
);
CREATE TABLE IF NOT EXISTS public.warehouse_task_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES public.warehouse_execution_tasks(id) ON DELETE RESTRICT,
  observed_minutes NUMERIC(12,2) NOT NULL CHECK (observed_minutes > 0),
  travel_meters NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (travel_meters >= 0),
  labour_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (labour_cost >= 0),
  exception_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (exception_cost >= 0),
  evidence_reference TEXT NOT NULL, observed_by UUID NOT NULL, observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, task_id)
);
CREATE TABLE IF NOT EXISTS public.warehouse_slotting_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  item_id UUID NOT NULL, current_bin_id UUID REFERENCES public.warehouse_bins(id) ON DELETE RESTRICT,
  recommended_bin_id UUID NOT NULL REFERENCES public.warehouse_bins(id) ON DELETE RESTRICT,
  rationale TEXT NOT NULL, monthly_moves NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (monthly_moves >= 0),
  annual_travel_reduction_meters NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (annual_travel_reduction_meters >= 0),
  target_annual_savings NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_annual_savings >= 0),
  realized_annual_savings NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (realized_annual_savings >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','IMPLEMENTED','VERIFIED','REJECTED','CANCELLED')),
  approval_note TEXT, implementation_evidence TEXT, verification_evidence TEXT,
  created_by UUID NOT NULL, approved_by UUID, implemented_by UUID, verified_by UUID,
  approved_at TIMESTAMPTZ, implemented_at TIMESTAMPTZ, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (current_bin_id IS NULL OR current_bin_id <> recommended_bin_id)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_observations_tenant ON public.warehouse_task_observations (tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_slotting_status ON public.warehouse_slotting_recommendations (tenant_id, status, created_at DESC);
