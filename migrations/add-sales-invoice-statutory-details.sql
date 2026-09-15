-- Indian statutory references recorded after a sales invoice is posted.
-- This is deliberately additive so it is safe for existing live invoices.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS irn text,
  ADD COLUMN IF NOT EXISTS irn_ack_number text,
  ADD COLUMN IF NOT EXISTS irn_ack_date date,
  ADD COLUMN IF NOT EXISTS eway_bill_number text,
  ADD COLUMN IF NOT EXISTS eway_bill_date date,
  ADD COLUMN IF NOT EXISTS eway_bill_valid_until date,
  ADD COLUMN IF NOT EXISTS statutory_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS statutory_exemption_reason text,
  ADD COLUMN IF NOT EXISTS statutory_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS statutory_updated_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_irn_unique
  ON public.invoices (tenant_id, upper(irn))
  WHERE irn IS NOT NULL AND btrim(irn) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_eway_bill_unique
  ON public.invoices (tenant_id, upper(eway_bill_number))
  WHERE eway_bill_number IS NOT NULL AND btrim(eway_bill_number) <> '';

COMMENT ON COLUMN public.invoices.irn IS 'Invoice Reference Number generated on the GST e-invoice portal.';
COMMENT ON COLUMN public.invoices.eway_bill_number IS 'E-way bill number generated outside SAK ERP and recorded for audit traceability.';
COMMENT ON COLUMN public.invoices.statutory_status IS 'PENDING, RECORDED, or NOT_APPLICABLE.';
