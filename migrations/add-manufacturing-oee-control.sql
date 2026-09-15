-- Manufacturing OEE, downtime loss and verified recovery actions.
-- Read-only against station completions; never changes job orders or maintenance records.
CREATE TABLE IF NOT EXISTS public.manufacturing_shift_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  work_station_id UUID NOT NULL, work_date DATE NOT NULL, shift_code VARCHAR(30) NOT NULL,
  planned_production_minutes INTEGER NOT NULL CHECK(planned_production_minutes > 0),
  ideal_cycle_minutes NUMERIC(12,4) NOT NULL CHECK(ideal_cycle_minutes > 0),
  operating_cost_per_hour NUMERIC(18,2) NOT NULL DEFAULT 0, scrap_unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,work_station_id,work_date)
);
CREATE TABLE IF NOT EXISTS public.manufacturing_downtime_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  shift_id UUID NOT NULL REFERENCES public.manufacturing_shift_plans(id) ON DELETE CASCADE,
  loss_category VARCHAR(30) NOT NULL CHECK(loss_category IN ('BREAKDOWN','CHANGEOVER','MATERIAL','QUALITY','LABOUR','PLANNED','OTHER')),
  reason TEXT NOT NULL, downtime_minutes INTEGER NOT NULL CHECK(downtime_minutes > 0),
  evidence_reference TEXT, reported_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.manufacturing_loss_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  action_title VARCHAR(220) NOT NULL, loss_category VARCHAR(30) NOT NULL,
  owner_user_id UUID, target_date DATE, target_savings NUMERIC(18,2) NOT NULL CHECK(target_savings > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IMPLEMENTED','VERIFIED','CANCELLED')),
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  implemented_at TIMESTAMPTZ, realized_savings NUMERIC(18,2) NOT NULL DEFAULT 0,
  verified_by UUID, verified_at TIMESTAMPTZ, verification_evidence TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfg_shift_date ON public.manufacturing_shift_plans(tenant_id,work_date DESC,work_station_id);
CREATE INDEX IF NOT EXISTS idx_mfg_downtime_shift ON public.manufacturing_downtime_events(tenant_id,shift_id,loss_category);
CREATE INDEX IF NOT EXISTS idx_mfg_loss_actions ON public.manufacturing_loss_actions(tenant_id,status,target_date);
