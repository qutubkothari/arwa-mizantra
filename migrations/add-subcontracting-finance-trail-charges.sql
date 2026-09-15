-- Finance fields shown in the subcontracting document trail and included in
-- the QC-approved supplier payable calculation.
ALTER TABLE public.subcontract_movements
  ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_amount NUMERIC(18,2) NOT NULL DEFAULT 0;

ALTER TABLE public.subcontract_order_steps
  ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_amount NUMERIC(18,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
