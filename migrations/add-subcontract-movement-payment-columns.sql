-- Keep subcontract movement finance fields aligned with the document-trail
-- projection. Additive and safe for existing test/live schemas.
ALTER TABLE public.subcontract_movements
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) DEFAULT 'NOT_RECEIVED';

UPDATE public.subcontract_movements
SET paid_amount = 0
WHERE paid_amount IS NULL;
