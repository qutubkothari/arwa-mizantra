-- Commercial release and ATP confirmation for the sales order-to-cash flow.

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS release_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_requested_by UUID,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_by UUID,
  ADD COLUMN IF NOT EXISTS release_remarks TEXT,
  ADD COLUMN IF NOT EXISTS availability_status VARCHAR(30) NOT NULL DEFAULT 'NOT_CHECKED',
  ADD COLUMN IF NOT EXISTS availability_checked_at TIMESTAMPTZ;

ALTER TABLE public.sales_order_items
  ADD COLUMN IF NOT EXISTS confirmed_quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(30) NOT NULL DEFAULT 'NOT_CHECKED',
  ADD COLUMN IF NOT EXISTS available_quantity_snapshot NUMERIC(15,3),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

UPDATE public.sales_orders
SET released_at = COALESCE(released_at, created_at),
    availability_status = CASE WHEN availability_status = 'NOT_CHECKED' THEN 'LEGACY_RELEASED' ELSE availability_status END
WHERE release_status = 'RELEASED';

CREATE INDEX IF NOT EXISTS idx_sales_orders_release_queue
  ON public.sales_orders(tenant_id, release_status, availability_status, order_date);
