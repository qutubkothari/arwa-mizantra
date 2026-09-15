-- Append-only, tenant-scoped event ledger for Mizantra 2.0.
-- This records evidence and controlled actions; it never replaces the
-- transactional source-of-truth or grants permission to post transactions.
CREATE TABLE IF NOT EXISTS public.mizantra_operating_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  domain VARCHAR(60) NOT NULL DEFAULT 'OPERATIONS',
  severity VARCHAR(12) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  correlation_id VARCHAR(160),
  source_type VARCHAR(80),
  source_id VARCHAR(160),
  title TEXT NOT NULL,
  summary TEXT,
  route TEXT,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mizantra_operating_events_tenant_created
  ON public.mizantra_operating_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mizantra_operating_events_correlation
  ON public.mizantra_operating_events (tenant_id, correlation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mizantra_operating_events_source
  ON public.mizantra_operating_events (tenant_id, source_type, source_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
