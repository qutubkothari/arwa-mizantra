-- Migration: Add po_advance_payments table for advance/pre-GRN payments against POs
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.po_advance_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  po_id           UUID NOT NULL REFERENCES public.purchase_orders(id),
  vendor_id       UUID REFERENCES public.vendors(id),
  amount          NUMERIC(14,2) NOT NULL,
  payment_method  TEXT NOT NULL DEFAULT 'NEFT',
  payment_reference TEXT,
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_notes   TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_advance_payments_tenant ON public.po_advance_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_po_advance_payments_po ON public.po_advance_payments(po_id);
CREATE INDEX IF NOT EXISTS idx_po_advance_payments_vendor ON public.po_advance_payments(vendor_id);
