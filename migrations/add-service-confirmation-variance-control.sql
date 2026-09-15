-- Customer-authorized estimate variance control for chargeable service work.
-- Additive only: existing confirmations retain a zero variance and no approval evidence.

ALTER TABLE public.service_confirmations
  ADD COLUMN IF NOT EXISTS approved_estimate_id UUID REFERENCES public.service_estimates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_estimate_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimate_variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_reason TEXT,
  ADD COLUMN IF NOT EXISTS variance_approval_reference VARCHAR(255),
  ADD COLUMN IF NOT EXISTS variance_approval_attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS variance_approved_by UUID;

COMMENT ON COLUMN public.service_confirmations.estimate_variance_amount IS
  'Positive amount by which the confirmed service value exceeds the customer-approved estimate.';

COMMENT ON COLUMN public.service_confirmations.variance_approval_reference IS
  'Customer change-order or other authorization reference permitting an estimate overrun.';
