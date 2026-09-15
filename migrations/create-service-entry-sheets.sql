-- SAP-style service acceptance. Service Entry Sheets replace GRNs for service PO lines.
CREATE TABLE IF NOT EXISTS public.service_entry_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ses_number VARCHAR(60) NOT NULL,
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  service_period_start DATE,
  service_period_end DATE,
  completion_date DATE NOT NULL DEFAULT CURRENT_DATE,
  service_location TEXT,
  completion_notes TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, ses_number),
  CONSTRAINT service_entry_sheets_status_check CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
  CONSTRAINT service_entry_sheets_period_check CHECK (service_period_end IS NULL OR service_period_start IS NULL OR service_period_end >= service_period_start)
);

CREATE TABLE IF NOT EXISTS public.service_entry_sheet_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ses_id UUID NOT NULL REFERENCES public.service_entry_sheets(id) ON DELETE CASCADE,
  po_item_id UUID NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  item_code VARCHAR(120) NOT NULL,
  item_name TEXT NOT NULL,
  uom VARCHAR(30),
  ordered_qty NUMERIC(15,3) NOT NULL DEFAULT 0,
  accepted_qty NUMERIC(15,3) NOT NULL,
  rate NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  completion_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_entry_sheet_items_qty_check CHECK (accepted_qty > 0)
);

CREATE TABLE IF NOT EXISTS public.service_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  service_entry_sheet_id UUID NOT NULL REFERENCES public.service_entry_sheets(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(120) NOT NULL,
  invoice_date DATE NOT NULL,
  invoice_amount NUMERIC(15,2) NOT NULL,
  invoice_file_url TEXT,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sanctioned_by UUID,
  sanctioned_at TIMESTAMPTZ,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_by UUID,
  paid_at TIMESTAMPTZ,
  payment_reference VARCHAR(160),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, service_entry_sheet_id),
  CONSTRAINT service_invoices_status_check CHECK (status IN ('PENDING_APPROVAL','SANCTIONED','PARTIALLY_PAID','PAID','REJECTED')),
  CONSTRAINT service_invoices_amount_check CHECK (invoice_amount >= 0 AND paid_amount >= 0)
);

CREATE TABLE IF NOT EXISTS public.service_invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  service_invoice_id UUID NOT NULL REFERENCES public.service_invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL,
  payment_reference VARCHAR(160),
  notes TEXT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_by UUID,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  CONSTRAINT service_invoice_payments_amount_check CHECK (amount > 0)
);

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS service_accepted_qty NUMERIC(15,3) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ses_tenant_status ON public.service_entry_sheets(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ses_po ON public.service_entry_sheets(tenant_id, po_id);
CREATE INDEX IF NOT EXISTS idx_ses_items_po_item ON public.service_entry_sheet_items(tenant_id, po_item_id);
CREATE INDEX IF NOT EXISTS idx_service_invoices_tenant_status ON public.service_invoices(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_invoice_payments_invoice ON public.service_invoice_payments(tenant_id, service_invoice_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
