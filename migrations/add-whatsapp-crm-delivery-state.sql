BEGIN;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS crm_lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS crm_capture_error TEXT;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_crm_capture_pending
  ON public.whatsapp_messages (tenant_id, created_at)
  WHERE direction = 'INBOUND' AND crm_captured_at IS NULL;

COMMIT;
