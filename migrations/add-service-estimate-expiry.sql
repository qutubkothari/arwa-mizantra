-- Enforce the commercial validity lifecycle for chargeable service estimates.
-- Existing data is preserved; only the permitted status set is extended.

ALTER TABLE public.service_estimates
  DROP CONSTRAINT IF EXISTS service_estimates_status_check;

ALTER TABLE public.service_estimates
  ADD CONSTRAINT service_estimates_status_check
  CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED','SUPERSEDED','CANCELLED'));

COMMENT ON COLUMN public.service_estimates.status IS
  'Commercial lifecycle: DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, EXPIRED, SUPERSEDED, CANCELLED';
