CREATE TABLE IF NOT EXISTS public.mizantra_management_brief_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  brief JSONB NOT NULL,
  health_score NUMERIC(5,2),
  decision_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_mizantra_brief_history_tenant_date ON public.mizantra_management_brief_snapshots (tenant_id, snapshot_date DESC);
NOTIFY pgrst, 'reload schema';
