-- A service ticket can have several interim confirmations, but only one final
-- completed confirmation. This unique partial index closes the concurrency
-- gap where two users could finalize the same ticket at the same time.

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_confirmations_final_ticket
  ON public.service_confirmations(tenant_id, service_ticket_id)
  WHERE is_final = TRUE AND status = 'COMPLETED';

COMMENT ON INDEX public.uq_service_confirmations_final_ticket IS
  'Prevents more than one final completed service confirmation per ticket.';
