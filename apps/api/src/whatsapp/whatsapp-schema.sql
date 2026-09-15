CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_name TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'WAHA', status TEXT NOT NULL DEFAULT 'DISCONNECTED', phone_number TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE, automation_enabled BOOLEAN NOT NULL DEFAULT FALSE, opt_in_required BOOLEAN NOT NULL DEFAULT TRUE,
  connected_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(tenant_id, session_name)
);
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_name TEXT NOT NULL, contact_phone TEXT NOT NULL, contact_name TEXT, direction TEXT NOT NULL, message_text TEXT, media_type TEXT,
  waha_message_id TEXT, status TEXT NOT NULL DEFAULT 'QUEUED', sent_by UUID REFERENCES public.users(id), consent_checked BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(tenant_id, waha_message_id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_created ON public.whatsapp_messages(tenant_id, created_at DESC);
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS crm_lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS crm_capture_error TEXT;
