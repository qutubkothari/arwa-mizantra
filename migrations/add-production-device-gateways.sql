CREATE TABLE IF NOT EXISTS public.production_device_gateways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  gateway_code VARCHAR(80) NOT NULL, gateway_name VARCHAR(160) NOT NULL,
  protocol VARCHAR(24) NOT NULL CHECK (protocol IN ('HTTPS_WEBHOOK','MQTT','OPC_UA','MODBUS','FILE')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','TESTING','ACTIVE','PAUSED','ERROR')),
  endpoint_reference VARCHAR(240), secret_reference VARCHAR(240), field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  heartbeat_seconds INTEGER NOT NULL DEFAULT 300 CHECK (heartbeat_seconds BETWEEN 30 AND 86400),
  is_test_mode BOOLEAN NOT NULL DEFAULT TRUE, last_heartbeat_at TIMESTAMPTZ, last_event_at TIMESTAMPTZ,
  last_error TEXT, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, gateway_code)
);
CREATE INDEX IF NOT EXISTS idx_production_device_gateways_status ON public.production_device_gateways(tenant_id,status,updated_at DESC);
COMMENT ON TABLE public.production_device_gateways IS 'Device gateway registry. References only are stored for endpoints and secrets; credentials remain in an approved vault.';
