-- Explicit AP advance adjustment support.
-- Advances remain available until Accounts Payable applies an amount during payment.

ALTER TABLE public.grn_payment_entries
  ADD COLUMN IF NOT EXISTS entry_type VARCHAR(40) NOT NULL DEFAULT 'PAYMENT';

CREATE INDEX IF NOT EXISTS idx_grn_payment_entries_entry_type
  ON public.grn_payment_entries(entry_type);

UPDATE public.grn_payment_entries
SET entry_type = 'PAYMENT'
WHERE entry_type IS NULL OR entry_type = '';
