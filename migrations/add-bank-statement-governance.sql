BEGIN;

ALTER TABLE public.accounting_workflow_role_assignments
  DROP CONSTRAINT IF EXISTS accounting_workflow_role_assignments_workflow_role_check;
ALTER TABLE public.accounting_workflow_role_assignments
  ADD CONSTRAINT accounting_workflow_role_assignments_workflow_role_check CHECK (workflow_role IN (
    'JOURNAL_PREPARER','JOURNAL_REVIEWER','JOURNAL_APPROVER','JOURNAL_POSTER',
    'PAYMENT_PREPARER','PAYMENT_APPROVER','PAYMENT_POSTER',
    'BANK_RECONCILER','BANK_RECON_REVIEWER'
  ));

ALTER TABLE public.accounting_bank_accounts
  ADD COLUMN IF NOT EXISTS iban_masked VARCHAR(48),
  ADD COLUMN IF NOT EXISTS statement_format_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS reconciliation_owner_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.accounting_bank_statement_formats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  format_code VARCHAR(40) NOT NULL,
  format_name VARCHAR(140) NOT NULL,
  bank_name VARCHAR(180),
  date_format VARCHAR(30) NOT NULL DEFAULT 'YYYY-MM-DD',
  delimiter VARCHAR(4) NOT NULL DEFAULT ',',
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  direction_mode VARCHAR(24) NOT NULL DEFAULT 'DIRECTION' CHECK (direction_mode IN ('DIRECTION','SIGNED_AMOUNT','DEBIT_CREDIT')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, format_code)
);

CREATE TABLE IF NOT EXISTS public.accounting_bank_statement_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.accounting_bank_accounts(id) ON DELETE CASCADE,
  format_id UUID REFERENCES public.accounting_bank_statement_formats(id),
  statement_reference VARCHAR(120) NOT NULL,
  file_name VARCHAR(255),
  source_hash VARCHAR(64) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  opening_balance NUMERIC(18,2),
  closing_balance NUMERIC(18,2),
  imported_row_count INTEGER NOT NULL DEFAULT 0,
  skipped_row_count INTEGER NOT NULL DEFAULT 0,
  invalid_row_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'IMPORTED' CHECK (status IN ('IMPORTED','IN_RECONCILIATION','RECONCILED','REVIEWED','REJECTED')),
  imported_by UUID,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconciled_by UUID,
  reconciled_at TIMESTAMPTZ,
  reconciliation_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_to >= period_from),
  UNIQUE (tenant_id, bank_account_id, source_hash)
);

ALTER TABLE public.accounting_bank_transactions
  ADD COLUMN IF NOT EXISTS statement_batch_id UUID REFERENCES public.accounting_bank_statement_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_transaction_id VARCHAR(140),
  ADD COLUMN IF NOT EXISTS running_balance NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reconciled_by UUID,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_note TEXT,
  ADD COLUMN IF NOT EXISTS excluded_by UUID,
  ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_bank_external_transaction
  ON public.accounting_bank_transactions (tenant_id, bank_account_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_bank_statement_batches
  ON public.accounting_bank_statement_batches (tenant_id, bank_account_id, period_to DESC, status);
CREATE INDEX IF NOT EXISTS idx_accounting_bank_transactions_batch
  ON public.accounting_bank_transactions (tenant_id, statement_batch_id, reconciliation_status);

COMMIT;
