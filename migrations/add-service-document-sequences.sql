-- Atomic number ranges for customer-service documents.
-- Existing document numbers are retained; each range starts at the highest
-- suffix already present so deleted rows and concurrent users cannot reuse it.

CREATE TABLE IF NOT EXISTS public.service_document_sequences (
  document_type VARCHAR(40) PRIMARY KEY,
  last_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.service_document_sequences(document_type, last_number)
VALUES
  ('SERVICE_TICKET', COALESCE((SELECT MAX(right(ticket_number, 6)::BIGINT) FROM public.service_tickets WHERE ticket_number ~ '[0-9]{6}$'), 0)),
  ('TECHNICIAN', COALESCE((SELECT MAX(right(technician_code, 4)::BIGINT) FROM public.technicians WHERE technician_code ~ '[0-9]{4}$'), 0)),
  ('INSTALLED_ASSET', COALESCE((SELECT MAX(right(asset_number, 6)::BIGINT) FROM public.service_installed_assets WHERE asset_number ~ '[0-9]{6}$'), 0)),
  ('SERVICE_CONTRACT', COALESCE((SELECT MAX(right(contract_number, 6)::BIGINT) FROM public.service_contracts WHERE contract_number ~ '[0-9]{6}$'), 0)),
  ('SERVICE_CONFIRMATION', COALESCE((SELECT MAX(right(confirmation_number, 6)::BIGINT) FROM public.service_confirmations WHERE confirmation_number ~ '[0-9]{6}$'), 0)),
  ('SERVICE_INVOICE', COALESCE((SELECT MAX(right(invoice_number, 6)::BIGINT) FROM public.customer_service_invoices WHERE invoice_number ~ '[0-9]{6}$'), 0)),
  ('SERVICE_RECEIPT', COALESCE((SELECT MAX(right(receipt_number, 6)::BIGINT) FROM public.customer_service_payments WHERE receipt_number ~ '[0-9]{6}$'), 0))
ON CONFLICT (document_type) DO UPDATE
SET last_number = GREATEST(public.service_document_sequences.last_number, EXCLUDED.last_number),
    updated_at = NOW();

CREATE OR REPLACE FUNCTION public.next_service_document_number(p_document_type TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number BIGINT;
BEGIN
  IF p_document_type NOT IN (
    'SERVICE_TICKET',
    'TECHNICIAN',
    'INSTALLED_ASSET',
    'SERVICE_CONTRACT',
    'SERVICE_CONFIRMATION',
    'SERVICE_INVOICE',
    'SERVICE_RECEIPT'
  ) THEN
    RAISE EXCEPTION 'Unsupported service document type: %', p_document_type;
  END IF;

  INSERT INTO public.service_document_sequences(document_type, last_number)
  VALUES (p_document_type, 1)
  ON CONFLICT (document_type) DO UPDATE
    SET last_number = public.service_document_sequences.last_number + 1,
        updated_at = NOW()
  RETURNING last_number INTO v_number;

  RETURN v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.next_service_document_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_service_document_number(TEXT) TO service_role;

COMMENT ON TABLE public.service_document_sequences IS
  'Atomic number ranges for service tickets, technicians, installed assets, contracts, confirmations, invoices and receipts.';
