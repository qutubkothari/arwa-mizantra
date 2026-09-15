-- Controlled bank-to-open-item cash application and working-capital evidence.
CREATE TABLE IF NOT EXISTS public.accounting_cash_application_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_transaction_id UUID NOT NULL REFERENCES public.accounting_bank_transactions(id) ON DELETE CASCADE,
  open_item_id UUID NOT NULL REFERENCES public.accounting_open_items(id) ON DELETE CASCADE,
  suggested_amount NUMERIC(18,2) NOT NULL CHECK (suggested_amount > 0),
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  match_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'SUGGESTED' CHECK (status IN ('SUGGESTED','APPLIED','REJECTED')),
  suggested_by UUID,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  settlement_id UUID REFERENCES public.accounting_settlements(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, bank_transaction_id, open_item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_application_one_applied_bank_line
  ON public.accounting_cash_application_suggestions (tenant_id, bank_transaction_id)
  WHERE status = 'APPLIED';
CREATE INDEX IF NOT EXISTS idx_cash_application_worklist
  ON public.accounting_cash_application_suggestions (tenant_id, status, confidence_score DESC, created_at DESC);

ALTER TABLE public.accounting_open_items
  ADD COLUMN IF NOT EXISTS collection_owner_id UUID,
  ADD COLUMN IF NOT EXISTS promise_to_pay_date DATE,
  ADD COLUMN IF NOT EXISTS dispute_status VARCHAR(20) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS dispute_note TEXT;

ALTER TABLE public.accounting_open_items DROP CONSTRAINT IF EXISTS accounting_open_items_dispute_status_check;
ALTER TABLE public.accounting_open_items ADD CONSTRAINT accounting_open_items_dispute_status_check
  CHECK (dispute_status IN ('NONE','RAISED','RESOLVED'));
