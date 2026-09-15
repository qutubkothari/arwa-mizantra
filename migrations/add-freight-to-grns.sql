-- Add freight charges columns to grns table
-- Freight is copied from PO terms_and_conditions when GRN is created
ALTER TABLE public.grns
  ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Backfill existing GRNs from their linked PO freight data
UPDATE public.grns g
SET
  freight_amount = COALESCE(
    ((po.terms_and_conditions::jsonb)->>'freightAmount')::NUMERIC, 0
  ),
  freight_gst_amount = COALESCE(
    ((po.terms_and_conditions::jsonb)->>'freightGstAmount')::NUMERIC, 0
  )
FROM public.purchase_orders po
WHERE g.po_id = po.id
  AND po.terms_and_conditions IS NOT NULL
  AND po.terms_and_conditions::text LIKE '%freightAmount%';

-- Recalculate net_payable_amount to include freight for all affected GRNs
UPDATE public.grns
SET net_payable_amount = COALESCE(gross_amount, 0) + COALESCE(tax_amount, 0) + COALESCE(freight_amount, 0) + COALESCE(freight_gst_amount, 0) - COALESCE(debit_note_amount, 0)
WHERE (freight_amount > 0 OR freight_gst_amount > 0);
