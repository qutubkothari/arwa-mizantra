-- Prevent concurrent/retried GRN creation for the same supplier invoice on a PO.
-- This is separate from `grns` so it can be deployed safely even if historic
-- empty/double draft GRNs already exist and need manual review.
CREATE TABLE IF NOT EXISTS public.grn_invoice_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  invoice_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, po_id, invoice_key),
  CHECK (btrim(invoice_key) <> '')
);

CREATE INDEX IF NOT EXISTS idx_grn_invoice_locks_tenant_po
  ON public.grn_invoice_locks (tenant_id, po_id);

COMMENT ON TABLE public.grn_invoice_locks IS
  'Server-side idempotency reservation for GRN creation by tenant, PO, and normalized supplier invoice.';
