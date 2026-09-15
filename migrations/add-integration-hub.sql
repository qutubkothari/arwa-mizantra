CREATE TABLE IF NOT EXISTS public.integration_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_code VARCHAR(48) NOT NULL, connector_name VARCHAR(120) NOT NULL, market_profile VARCHAR(12) NOT NULL CHECK (market_profile IN ('INDIA','UAE','SHARED')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','TESTING','ACTIVE','PAUSED','ERROR')),
  secret_reference VARCHAR(240), configuration JSONB NOT NULL DEFAULT '{}'::jsonb, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, connector_code)
);
CREATE TABLE IF NOT EXISTS public.integration_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE, direction VARCHAR(12) NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),
  event_type VARCHAR(80) NOT NULL, idempotency_key VARCHAR(160) NOT NULL, payload_hash CHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','DELIVERED','FAILED','RETRYING','SKIPPED')),
  attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
  UNIQUE(tenant_id, connection_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_integration_events_queue ON public.integration_events(tenant_id,status,occurred_at DESC);
COMMENT ON TABLE public.integration_connections IS 'Connector configuration only; secret_reference points to an approved vault or client-managed credential store.';
