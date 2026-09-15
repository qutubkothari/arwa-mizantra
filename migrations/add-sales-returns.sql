-- Sales return control: receipt never changes sellable inventory until QC approves it.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.sales_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  return_number VARCHAR(80) NOT NULL, invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE, status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  reason TEXT NOT NULL, customer_reference TEXT, received_warehouse_id UUID REFERENCES public.warehouses(id),
  received_at TIMESTAMPTZ, received_by UUID, qc_at TIMESTAMPTZ, qc_by UUID, qc_notes TEXT,
  cancelled_at TIMESTAMPTZ, cancelled_by UUID, cancellation_reason TEXT,
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_returns_number_unique UNIQUE (tenant_id, return_number)
);
CREATE TABLE IF NOT EXISTS public.sales_return_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), sales_return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  invoice_item_id UUID REFERENCES public.sales_invoice_items(id) ON DELETE RESTRICT, item_id UUID NOT NULL,
  item_description TEXT, quantity NUMERIC(15,3) NOT NULL CHECK (quantity > 0), qc_accepted_quantity NUMERIC(15,3) NOT NULL DEFAULT 0 CHECK (qc_accepted_quantity >= 0), qc_rejected_quantity NUMERIC(15,3) NOT NULL DEFAULT 0 CHECK (qc_rejected_quantity >= 0), stock_movement_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_returns_invoice ON public.sales_returns(tenant_id, invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return ON public.sales_return_items(sales_return_id);
COMMENT ON TABLE public.sales_returns IS 'Customer returned-goods documents. Stock increases only after QC_APPROVED.';
