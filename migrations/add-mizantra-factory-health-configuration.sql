CREATE TABLE IF NOT EXISTS public.mizantra_factory_health_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  factor_caps JSONB NOT NULL DEFAULT '{}'::jsonb,
  management_attention_threshold NUMERIC(5,2) NOT NULL DEFAULT 65 CHECK (management_attention_threshold >= 0 AND management_attention_threshold <= 100),
  critical_threshold NUMERIC(5,2) NOT NULL DEFAULT 40 CHECK (critical_threshold >= 0 AND critical_threshold <= 100),
  historical_observations_required INTEGER NOT NULL DEFAULT 14 CHECK (historical_observations_required BETWEEN 3 AND 90),
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_mizantra_factory_health_configuration_tenant
  ON public.mizantra_factory_health_configurations (tenant_id);

NOTIFY pgrst, 'reload schema';
