-- Secure, tenant-mapped CRM inbound channels.
-- Raw channel tokens are returned once and never stored; only SHA-256 hashes persist.
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.crm_inbound_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel_code VARCHAR(30) NOT NULL
    CHECK (channel_code IN ('WEBSITE','EMAIL','WHATSAPP','CAMPAIGN','API')),
  channel_name VARCHAR(160) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_by UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, channel_name)
);

CREATE TABLE IF NOT EXISTS public.crm_inbound_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.crm_inbound_channels(id) ON DELETE CASCADE,
  external_id VARCHAR(240) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED','CAPTURED','REUSED','REJECTED')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, channel_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_inbound_channels_tenant
  ON public.crm_inbound_channels (tenant_id, is_active, channel_code);
CREATE INDEX IF NOT EXISTS idx_crm_inbound_events_tenant
  ON public.crm_inbound_events (tenant_id, channel_id, received_at DESC);

ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS crm_capture_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS crm_capture_owner_id UUID;

COMMENT ON TABLE public.crm_inbound_channels IS
  'Tenant-mapped CRM intake channels. Only irreversible token hashes are stored.';
COMMENT ON COLUMN public.whatsapp_connections.crm_capture_enabled IS
  'When explicitly enabled, new inbound contacts are captured as CRM leads; repeat messages become CRM activities.';

COMMIT;
