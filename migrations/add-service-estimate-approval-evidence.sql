-- Retain customer authorization evidence against the controlled service estimate decision.

ALTER TABLE public.service_estimates
  ADD COLUMN IF NOT EXISTS approval_attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS approval_recorded_by UUID;

COMMENT ON COLUMN public.service_estimates.approval_attachment_url IS
  'Customer PO, email, signed estimate, or other authorization evidence uploaded when the decision is recorded';

COMMENT ON COLUMN public.service_estimates.approval_recorded_by IS
  'ERP user who recorded the customer approval or rejection decision';
