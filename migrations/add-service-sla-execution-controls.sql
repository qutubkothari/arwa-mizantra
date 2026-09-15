-- Persist actual service response/resolution events for auditable SLA reporting.
ALTER TABLE public.service_tickets
  ADD COLUMN IF NOT EXISTS response_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Backfill the first technician response for historical assigned tickets.
UPDATE public.service_tickets ticket
SET response_acknowledged_at = assignment.first_response_at
FROM (
  SELECT service_ticket_id, MIN(COALESCE(actual_start_date, assigned_date, created_at)) AS first_response_at
  FROM public.service_assignments
  WHERE status IN ('ACCEPTED', 'IN_PROGRESS', 'COMPLETED')
  GROUP BY service_ticket_id
) assignment
WHERE ticket.id = assignment.service_ticket_id
  AND ticket.response_acknowledged_at IS NULL;

-- Historical completed documents did not carry a separate resolution timestamp.
UPDATE public.service_tickets
SET resolved_at = COALESCE(closed_at, actual_completion_date::TIMESTAMPTZ, updated_at)
WHERE status IN ('COMPLETED', 'CLOSED')
  AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_tickets_sla_monitoring
  ON public.service_tickets(tenant_id, status, response_due_at, resolution_due_at);

COMMENT ON COLUMN public.service_tickets.response_acknowledged_at IS
  'First technician acceptance or work-start timestamp; immutable SLA response event.';
COMMENT ON COLUMN public.service_tickets.resolved_at IS
  'Timestamp of final customer-signed service confirmation; used for SLA resolution measurement.';
