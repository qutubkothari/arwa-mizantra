-- Adds per-line commercial terms to PR and PO line items
--
-- Apply via Supabase SQL Editor or psql.

ALTER TABLE purchase_requisition_items
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS delivery_terms TEXT;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS delivery_terms TEXT;
