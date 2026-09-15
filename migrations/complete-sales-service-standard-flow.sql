-- Sales and Customer Service completion layer.
-- Extends the existing tables without replacing historical documents.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sales delivery / PGI controls ------------------------------------------------
ALTER TABLE public.dispatch_notes
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'PGI_POSTED',
  ADD COLUMN IF NOT EXISTS goods_issue_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS goods_issue_by UUID,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by UUID,
  ADD COLUMN IF NOT EXISTS proof_of_delivery_url TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

UPDATE public.dispatch_notes
SET status = 'PGI_POSTED', goods_issue_at = COALESCE(goods_issue_at, created_at)
WHERE status IS NULL OR status = 'DRAFT';

-- Delivery-related customer billing -------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billing_status VARCHAR(30) NOT NULL DEFAULT 'POSTED',
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_by UUID,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT;

CREATE TABLE IF NOT EXISTS public.sales_invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  sales_order_item_id UUID REFERENCES public.sales_order_items(id) ON DELETE RESTRICT,
  dispatch_item_id UUID REFERENCES public.dispatch_items(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL,
  item_description TEXT,
  quantity NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0),
  tax_percentage NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (tax_percentage >= 0),
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total NUMERIC(15,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_invoice_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  receipt_number VARCHAR(80) NOT NULL,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(50) NOT NULL,
  payment_reference VARCHAR(160),
  notes TEXT,
  received_by UUID NOT NULL,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_invoice_payments_receipt_unique UNIQUE (tenant_id, receipt_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoice_dispatch_active
  ON public.invoices(tenant_id, dispatch_note_id)
  WHERE dispatch_note_id IS NOT NULL AND COALESCE(billing_status, 'POSTED') <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON public.sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_payments_invoice ON public.sales_invoice_payments(tenant_id, invoice_id, created_at DESC);

-- Customer service execution / confirmation / billing -------------------------
ALTER TABLE public.service_tickets
  ADD COLUMN IF NOT EXISTS ship_name TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_status VARCHAR(30) NOT NULL DEFAULT 'NOT_BILLABLE',
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.service_parts_used
  ADD COLUMN IF NOT EXISTS warehouse_id UUID,
  ADD COLUMN IF NOT EXISTS stock_movement_id UUID,
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS issued_by UUID;

CREATE INDEX IF NOT EXISTS idx_service_parts_warehouse ON public.service_parts_used(warehouse_id);

CREATE TABLE IF NOT EXISTS public.service_confirmations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  confirmation_number VARCHAR(80) NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  service_assignment_id UUID REFERENCES public.service_assignments(id) ON DELETE RESTRICT,
  confirmation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  labor_hours NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (labor_hours >= 0),
  labor_rate NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (labor_rate >= 0),
  travel_cost NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (travel_cost >= 0),
  parts_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (parts_amount >= 0),
  other_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (other_amount >= 0),
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_percentage NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (tax_percentage >= 0),
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  work_performed TEXT NOT NULL,
  technician_remarks TEXT,
  customer_signoff_name TEXT,
  customer_signoff_at TIMESTAMPTZ,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancellation_reason TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_confirmations_number_unique UNIQUE (tenant_id, confirmation_number)
);

CREATE TABLE IF NOT EXISTS public.customer_service_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  invoice_number VARCHAR(80) NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  service_confirmation_id UUID REFERENCES public.service_confirmations(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0),
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  net_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (balance_amount >= 0),
  payment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  billing_status VARCHAR(30) NOT NULL DEFAULT 'POSTED',
  notes TEXT,
  created_by UUID NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_service_invoices_number_unique UNIQUE (tenant_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS public.customer_service_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES public.customer_service_invoices(id) ON DELETE RESTRICT,
  receipt_number VARCHAR(80) NOT NULL,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(50) NOT NULL,
  payment_reference VARCHAR(160),
  notes TEXT,
  received_by UUID NOT NULL,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_service_payments_receipt_unique UNIQUE (tenant_id, receipt_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_service_invoice_confirmation_active
  ON public.customer_service_invoices(tenant_id, service_confirmation_id)
  WHERE service_confirmation_id IS NOT NULL AND billing_status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_service_confirmations_ticket ON public.service_confirmations(tenant_id, service_ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_service_invoices_ticket ON public.customer_service_invoices(tenant_id, service_ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_service_payments_invoice ON public.customer_service_payments(tenant_id, invoice_id, created_at DESC);

COMMENT ON TABLE public.sales_invoice_items IS 'Delivery-related billing lines copied from dispatched sales-order quantities.';
COMMENT ON TABLE public.sales_invoice_payments IS 'Customer receipt history against sales billing documents; reversals are retained for audit.';
COMMENT ON TABLE public.service_confirmations IS 'Actual customer-service work, time, parts and customer sign-off; completed confirmations are immutable.';
COMMENT ON TABLE public.customer_service_invoices IS 'Accounts-receivable billing documents created from completed billable service confirmations.';
