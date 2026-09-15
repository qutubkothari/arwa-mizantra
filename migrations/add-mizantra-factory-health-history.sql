CREATE TABLE IF NOT EXISTS public.mizantra_factory_health_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  open_exceptions INTEGER NOT NULL DEFAULT 0,
  high_priority INTEGER NOT NULL DEFAULT 0,
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_mizantra_health_history_tenant_date ON public.mizantra_factory_health_snapshots (tenant_id, snapshot_date DESC);
NOTIFY pgrst, 'reload schema';
