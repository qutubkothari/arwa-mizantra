-- Purchase Orders must support supplier-specific payment terms such as
-- "25% advance, balance within 30 days after delivery".
-- The old payment_terms_type enum only allowed fixed terms and rejected real PO text.

ALTER TABLE public.purchase_orders
  ALTER COLUMN payment_terms DROP DEFAULT,
  ALTER COLUMN payment_terms TYPE text USING payment_terms::text,
  ALTER COLUMN payment_terms SET DEFAULT 'NET_30';

