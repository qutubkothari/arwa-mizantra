-- Idempotent field-service mobile synchronization outbox.
CREATE TABLE IF NOT EXISTS service_mobile_sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  technician_id UUID,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  operation TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_created_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_mobile_sync_status_chk CHECK (status IN ('PENDING', 'APPLIED', 'FAILED')),
  CONSTRAINT service_mobile_sync_tenant_key_uk UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_service_mobile_sync_technician
  ON service_mobile_sync_events (tenant_id, technician_id, client_created_at DESC);

