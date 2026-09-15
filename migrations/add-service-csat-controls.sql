-- Tenant-safe, one-response-per-ticket customer satisfaction controls.
ALTER TABLE public.service_feedback
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS recorded_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE public.service_feedback feedback
SET tenant_id = ticket.tenant_id
FROM public.service_tickets ticket
WHERE feedback.service_ticket_id = ticket.id
  AND feedback.tenant_id IS NULL;

ALTER TABLE public.service_feedback
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_feedback_ticket
  ON public.service_feedback(tenant_id, service_ticket_id);

CREATE INDEX IF NOT EXISTS idx_service_feedback_tenant_created
  ON public.service_feedback(tenant_id, created_at DESC);

ALTER TABLE public.service_feedback
  DROP CONSTRAINT IF EXISTS service_feedback_overall_rating_check,
  ADD CONSTRAINT service_feedback_overall_rating_check CHECK (overall_rating BETWEEN 1 AND 5),
  DROP CONSTRAINT IF EXISTS service_feedback_technician_rating_check,
  ADD CONSTRAINT service_feedback_technician_rating_check CHECK (technician_rating IS NULL OR technician_rating BETWEEN 1 AND 5),
  DROP CONSTRAINT IF EXISTS service_feedback_response_time_rating_check,
  ADD CONSTRAINT service_feedback_response_time_rating_check CHECK (response_time_rating IS NULL OR response_time_rating BETWEEN 1 AND 5),
  DROP CONSTRAINT IF EXISTS service_feedback_quality_rating_check,
  ADD CONSTRAINT service_feedback_quality_rating_check CHECK (quality_rating IS NULL OR quality_rating BETWEEN 1 AND 5);

COMMENT ON TABLE public.service_feedback IS
  'Tenant-scoped customer satisfaction response recorded once per completed service ticket.';
