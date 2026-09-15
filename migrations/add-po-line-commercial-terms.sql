-- Add per-line commercial terms to purchase_order_items
-- (Line Payment Terms / Line Delivery Terms)
--
-- Run in Supabase SQL Editor.

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS delivery_terms TEXT;
