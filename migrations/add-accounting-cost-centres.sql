-- Mizantra/test: governed cost-centre and project master for accounting.
-- Existing journal-line cost_center values remain valid historical data.
CREATE TABLE IF NOT EXISTS public.accounting_cost_centres (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  centre_code VARCHAR(80) NOT NULL,
  centre_name VARCHAR(180) NOT NULL,
  centre_type VARCHAR(20) NOT NULL DEFAULT 'COST_CENTER'
    CHECK (centre_type IN ('COST_CENTER', 'PROJECT', 'DEPARTMENT', 'PROFIT_CENTER')),
  parent_id UUID REFERENCES public.accounting_cost_centres(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, centre_code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_cost_centres_tenant
  ON public.accounting_cost_centres (tenant_id, is_active, centre_code);

COMMENT ON TABLE public.accounting_cost_centres IS
  'Tenant-scoped cost-centre, project, department and profit-centre master. Historical free-text journal values are preserved.';
