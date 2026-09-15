-- Structured service diagnosis / RCA / CAPA for auditable ticket closure.
-- Additive and backward-compatible: existing confirmations remain unchanged.

ALTER TABLE public.service_confirmations
  ADD COLUMN IF NOT EXISTS failure_category VARCHAR(40),
  ADD COLUMN IF NOT EXISTS root_cause TEXT,
  ADD COLUMN IF NOT EXISTS corrective_action TEXT,
  ADD COLUMN IF NOT EXISTS preventive_action TEXT;

COMMENT ON COLUMN public.service_confirmations.failure_category IS
  'Controlled technical failure classification captured at service confirmation.';
COMMENT ON COLUMN public.service_confirmations.root_cause IS
  'Technician root-cause analysis for the confirmed service work.';
COMMENT ON COLUMN public.service_confirmations.corrective_action IS
  'Corrective action performed to restore the equipment or service.';
COMMENT ON COLUMN public.service_confirmations.preventive_action IS
  'Recommended preventive action to reduce recurrence.';

