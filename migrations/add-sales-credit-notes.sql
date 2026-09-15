-- Controlled sales credit-note layer.
-- A credit note reduces an open customer receivable.  It deliberately does
-- not receive returned stock: stock must be received and QC-approved through
-- the separate sales-return process before any inventory is increased.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(15,2) NOT NULL DEFAULT 0
    CHECK (credited_amount >= 0);

CREATE TABLE IF NOT EXISTS public.sales_credit_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  credit_note_number VARCHAR(80) NOT NULL,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  credit_note_date DATE NOT NULL DEFAULT CURRENT_DATE,
  taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0),
  tax_percentage NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (tax_percentage >= 0),
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  net_amount NUMERIC(15,2) NOT NULL CHECK (net_amount > 0),
  reason TEXT NOT NULL,
  external_reference TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'POSTED',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancellation_reason TEXT,
  CONSTRAINT sales_credit_notes_number_unique UNIQUE (tenant_id, credit_note_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_credit_notes_invoice
  ON public.sales_credit_notes(tenant_id, invoice_id, credit_note_date DESC);

COMMENT ON TABLE public.sales_credit_notes IS
  'Controlled receivable credit documents. Stock is not adjusted by this document.';
