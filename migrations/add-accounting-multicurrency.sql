-- Mizantra/test: auditable transaction-currency layer.
-- Ledger debit/credit remain the functional/base currency amounts; the
-- transaction amounts and rate are retained for document traceability.

CREATE TABLE IF NOT EXISTS public.accounting_exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rate_date DATE NOT NULL,
  from_currency_code VARCHAR(8) NOT NULL,
  to_currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(18,8) NOT NULL,
  source_reference VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, rate_date, from_currency_code, to_currency_code),
  CHECK (exchange_rate > 0),
  CHECK (from_currency_code <> '' AND to_currency_code <> '')
);

ALTER TABLE public.accounting_journals
  ADD COLUMN IF NOT EXISTS transaction_currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS foreign_total_debit NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS foreign_total_credit NUMERIC(18,2);

ALTER TABLE public.accounting_journal_lines
  ADD COLUMN IF NOT EXISTS foreign_debit NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS foreign_credit NUMERIC(18,2);

UPDATE public.accounting_journals
SET transaction_currency_code = COALESCE(NULLIF(transaction_currency_code, ''), 'INR'),
    exchange_rate = COALESCE(NULLIF(exchange_rate, 0), 1),
    foreign_total_debit = COALESCE(foreign_total_debit, total_debit),
    foreign_total_credit = COALESCE(foreign_total_credit, total_credit)
WHERE transaction_currency_code IS NULL
   OR exchange_rate IS NULL
   OR foreign_total_debit IS NULL
   OR foreign_total_credit IS NULL;

UPDATE public.accounting_journal_lines
SET foreign_debit = COALESCE(foreign_debit, debit),
    foreign_credit = COALESCE(foreign_credit, credit)
WHERE foreign_debit IS NULL OR foreign_credit IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_exchange_rates_lookup
  ON public.accounting_exchange_rates (tenant_id, from_currency_code, to_currency_code, rate_date DESC)
  WHERE is_active;

COMMENT ON TABLE public.accounting_exchange_rates IS 'Tenant rate master. Exchange rate converts transaction currency into functional INR ledger currency.';
