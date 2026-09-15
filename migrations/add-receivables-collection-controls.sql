-- Customer receivables collection controls for product sales and customer service.
-- Adds a lightweight, auditable dunning/follow-up state without changing posted
-- invoice or receipt accounting values.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS collection_status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_follow_up_by UUID,
  ADD COLUMN IF NOT EXISTS next_follow_up_date DATE,
  ADD COLUMN IF NOT EXISTS promise_to_pay_date DATE,
  ADD COLUMN IF NOT EXISTS collection_notes TEXT;

ALTER TABLE public.customer_service_invoices
  ADD COLUMN IF NOT EXISTS collection_status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_follow_up_by UUID,
  ADD COLUMN IF NOT EXISTS next_follow_up_date DATE,
  ADD COLUMN IF NOT EXISTS promise_to_pay_date DATE,
  ADD COLUMN IF NOT EXISTS collection_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_collection_queue
  ON public.invoices(tenant_id, collection_status, next_follow_up_date, due_date)
  WHERE COALESCE(balance_amount, 0) > 0 AND COALESCE(billing_status, 'POSTED') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS idx_service_invoices_collection_queue
  ON public.customer_service_invoices(tenant_id, collection_status, next_follow_up_date, due_date)
  WHERE COALESCE(balance_amount, 0) > 0 AND COALESCE(billing_status, 'POSTED') <> 'CANCELLED';

COMMENT ON COLUMN public.invoices.collection_status IS
  'Collection follow-up state: NOT_STARTED, CONTACTED, PROMISED, DISPUTED, ESCALATED, or CLOSED.';
COMMENT ON COLUMN public.customer_service_invoices.collection_status IS
  'Collection follow-up state: NOT_STARTED, CONTACTED, PROMISED, DISPUTED, ESCALATED, or CLOSED.';
