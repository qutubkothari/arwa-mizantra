-- Controlled customer dunning notices for overdue Sales and Service receivables.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.customer_dunning_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  notice_number VARCHAR(80) NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  notice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  dunning_level INTEGER NOT NULL CHECK (dunning_level BETWEEN 1 AND 3),
  due_by DATE NOT NULL,
  total_outstanding NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_outstanding >= 0),
  overdue_amount NUMERIC(15,2) NOT NULL CHECK (overdue_amount > 0),
  invoice_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'CANCELLED')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancellation_reason TEXT,
  CONSTRAINT customer_dunning_notice_number_unique UNIQUE (tenant_id, notice_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_dunning_notices_customer
  ON public.customer_dunning_notices(tenant_id, customer_id, notice_date DESC);

CREATE INDEX IF NOT EXISTS idx_customer_dunning_notices_status
  ON public.customer_dunning_notices(tenant_id, status, due_by);

COMMENT ON TABLE public.customer_dunning_notices IS
  'Formal collection reminders with an immutable snapshot of overdue Sales and Service receivables.';
