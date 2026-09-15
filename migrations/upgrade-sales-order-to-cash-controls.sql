-- SAP-style order-to-cash control layer.
-- Backward-compatible: existing sales documents and values are retained.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS sales_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS billing_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(30) NOT NULL DEFAULT 'REGISTERED';

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS place_of_supply VARCHAR(120),
  ADD COLUMN IF NOT EXISTS incoterm VARCHAR(30),
  ADD COLUMN IF NOT EXISTS customer_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS revision_no INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS ordered_uom VARCHAR(30) NOT NULL DEFAULT 'NOS',
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS promised_date DATE;

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS customer_po_number VARCHAR(160),
  ADD COLUMN IF NOT EXISTS customer_po_date DATE,
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS place_of_supply VARCHAR(120),
  ADD COLUMN IF NOT EXISTS incoterm VARCHAR(30),
  ADD COLUMN IF NOT EXISTS release_status VARCHAR(30) NOT NULL DEFAULT 'RELEASED',
  ADD COLUMN IF NOT EXISTS credit_status VARCHAR(30) NOT NULL DEFAULT 'CLEAR',
  ADD COLUMN IF NOT EXISTS delivery_block BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS billing_block BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.sales_order_items
  ADD COLUMN IF NOT EXISTS ordered_uom VARCHAR(30) NOT NULL DEFAULT 'NOS',
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS promised_date DATE;

ALTER TABLE public.sales_invoice_items
  ADD COLUMN IF NOT EXISTS ordered_uom VARCHAR(30) NOT NULL DEFAULT 'NOS',
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(30);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS place_of_supply VARCHAR(120),
  ADD COLUMN IF NOT EXISTS tax_type VARCHAR(10) NOT NULL DEFAULT 'IGST',
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.sales_document_sequences (
  document_type VARCHAR(40) PRIMARY KEY,
  last_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.sales_document_sequences(document_type, last_number)
VALUES
  ('QUOTATION', COALESCE((SELECT MAX(NULLIF(regexp_replace(quotation_number, '\D', '', 'g'), '')::BIGINT) FROM public.quotations), 0)),
  ('SALES_ORDER', COALESCE((SELECT MAX(NULLIF(regexp_replace(so_number, '\D', '', 'g'), '')::BIGINT) FROM public.sales_orders), 0)),
  ('DISPATCH', COALESCE((SELECT MAX(NULLIF(regexp_replace(dn_number, '\D', '', 'g'), '')::BIGINT) FROM public.dispatch_notes), 0)),
  ('INVOICE', COALESCE((SELECT MAX(NULLIF(right(invoice_number, 6), '')::BIGINT) FROM public.invoices WHERE invoice_number ~ '[0-9]{6}$'), 0)),
  ('RECEIPT', COALESCE((SELECT MAX(NULLIF(right(receipt_number, 6), '')::BIGINT) FROM public.sales_invoice_payments WHERE receipt_number ~ '[0-9]{6}$'), 0)),
  ('CREDIT_NOTE', COALESCE((SELECT MAX(NULLIF(right(credit_note_number, 6), '')::BIGINT) FROM public.sales_credit_notes WHERE credit_note_number ~ '[0-9]{6}$'), 0)),
  ('SALES_RETURN', COALESCE((SELECT MAX(NULLIF(right(return_number, 6), '')::BIGINT) FROM public.sales_returns WHERE return_number ~ '[0-9]{6}$'), 0))
ON CONFLICT (document_type) DO UPDATE
SET last_number = GREATEST(public.sales_document_sequences.last_number, EXCLUDED.last_number),
    updated_at = NOW();

CREATE OR REPLACE FUNCTION public.next_sales_document_number(p_document_type TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number BIGINT;
BEGIN
  IF p_document_type NOT IN ('QUOTATION', 'SALES_ORDER', 'DISPATCH', 'INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'SALES_RETURN') THEN
    RAISE EXCEPTION 'Unsupported sales document type: %', p_document_type;
  END IF;

  INSERT INTO public.sales_document_sequences(document_type, last_number)
  VALUES (p_document_type, 1)
  ON CONFLICT (document_type) DO UPDATE
    SET last_number = public.sales_document_sequences.last_number + 1,
        updated_at = NOW()
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sales_document_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE RESTRICT,
  document_type VARCHAR(40) NOT NULL,
  document_id UUID,
  document_number VARCHAR(80),
  event_type VARCHAR(50) NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_by UUID,
  remarks TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_sales_document_events_order
  ON public.sales_document_events(tenant_id, sales_order_id, event_at, id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_control
  ON public.sales_orders(tenant_id, release_status, credit_status, status);

COMMENT ON TABLE public.sales_document_events IS
  'Immutable order-to-cash event log from quotation/order through PGI, billing, collection and return.';
COMMENT ON COLUMN public.sales_orders.release_status IS
  'Commercial release state. PGI requires RELEASED, clear credit and no delivery block.';
