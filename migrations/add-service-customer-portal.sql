-- Customer self-service tracking links and customer updates.
CREATE TABLE IF NOT EXISTS service_customer_portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  revoked_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_customer_portal_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL DEFAULT 'COMMENT',
  customer_name TEXT,
  customer_email TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_customer_update_type_chk CHECK (update_type IN ('COMMENT', 'APPROVAL', 'QUERY'))
);

CREATE INDEX IF NOT EXISTS idx_service_portal_ticket ON service_customer_portal_tokens(tenant_id, service_ticket_id);
CREATE INDEX IF NOT EXISTS idx_service_portal_updates_ticket ON service_customer_portal_updates(tenant_id, service_ticket_id, created_at DESC);

