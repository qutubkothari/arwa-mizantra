CREATE TABLE IF NOT EXISTS public.margin_control_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  signal_key VARCHAR(80) NOT NULL,
  title TEXT NOT NULL,
  source_module VARCHAR(40) NOT NULL,
  source_reference VARCHAR(120),
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','DISMISSED')),
  priority VARCHAR(12) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  expected_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  realised_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_margin_control_actions_tenant_status
  ON public.margin_control_actions (tenant_id, status, priority, created_at DESC);
