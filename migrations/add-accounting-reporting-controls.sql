-- Additive controls for the accounting core. Safe to run after add-accounting-core.sql.
ALTER TABLE public.accounting_accounts ADD COLUMN IF NOT EXISTS account_subtype VARCHAR(40);
ALTER TABLE public.accounting_accounts ADD COLUMN IF NOT EXISTS is_suspense_account BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.accounting_journals ADD COLUMN IF NOT EXISTS adjustment_type VARCHAR(20) CHECK (adjustment_type IN ('NONE','ACCRUAL','PREPAYMENT','RECLASSIFICATION','DEPRECIATION','PROVISION','REVERSAL'));
ALTER TABLE public.accounting_journals ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES public.accounting_journals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_suspense ON public.accounting_accounts (tenant_id, is_suspense_account, is_active);
CREATE INDEX IF NOT EXISTS idx_accounting_journals_reversal ON public.accounting_journals (tenant_id, reversal_of_id);
