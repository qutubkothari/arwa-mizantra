-- Dated capacity input for Advanced Production Planning (APS).
-- Additive and tenant-scoped: existing plans and operational records are unchanged.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.hr_holidays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  holiday_name VARCHAR(200) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  holiday_type VARCHAR(50) NOT NULL DEFAULT 'PUBLIC',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  UNIQUE (tenant_id, holiday_name, start_date)
);

CREATE INDEX IF NOT EXISTS idx_hr_holidays_tenant
  ON public.hr_holidays (tenant_id);

CREATE INDEX IF NOT EXISTS idx_hr_holidays_start_date
  ON public.hr_holidays (start_date);

COMMENT ON TABLE public.hr_holidays IS
  'Tenant holiday calendar used by HR and dated production-capacity planning.';
