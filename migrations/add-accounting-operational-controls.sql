-- Controlled treasury, opening-balance and statutory/reporting work queues.
-- These records are tenant-scoped and do not alter existing live subledger data.

CREATE TABLE IF NOT EXISTS public.accounting_payment_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_number VARCHAR(60) NOT NULL,
  run_date DATE NOT NULL,
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('PAYABLE', 'RECEIVABLE')),
  bank_account_id UUID REFERENCES public.accounting_bank_accounts(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED')),
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  narration TEXT,
  prepared_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  posted_by UUID,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, run_number)
);

CREATE TABLE IF NOT EXISTS public.accounting_payment_run_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_run_id UUID NOT NULL REFERENCES public.accounting_payment_runs(id) ON DELETE CASCADE,
  open_item_id UUID NOT NULL REFERENCES public.accounting_open_items(id),
  planned_amount NUMERIC(18,2) NOT NULL CHECK (planned_amount > 0),
  reference_number VARCHAR(100),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'POSTED', 'FAILED', 'CANCELLED')),
  payment_journal_id UUID REFERENCES public.accounting_journals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_run_id, open_item_id)
);

CREATE TABLE IF NOT EXISTS public.accounting_opening_balance_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  batch_number VARCHAR(60) NOT NULL,
  as_of_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'VALIDATED', 'POSTED', 'CANCELLED')),
  suspense_account_id UUID REFERENCES public.accounting_accounts(id),
  source_reference TEXT,
  prepared_by UUID,
  validated_by UUID,
  posted_by UUID,
  posted_journal_id UUID REFERENCES public.accounting_journals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, batch_number)
);

CREATE TABLE IF NOT EXISTS public.accounting_opening_balance_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opening_balance_batch_id UUID NOT NULL REFERENCES public.accounting_opening_balance_batches(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  description TEXT,
  debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  party_type VARCHAR(20),
  party_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);

CREATE TABLE IF NOT EXISTS public.accounting_statutory_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  return_type VARCHAR(40) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEWED', 'FILED', 'REVISED')),
  reference_number VARCHAR(100),
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  working_note TEXT,
  prepared_by UUID,
  reviewed_by UUID,
  filed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_to >= period_from)
);

CREATE TABLE IF NOT EXISTS public.accounting_report_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  report_code VARCHAR(60) NOT NULL,
  schedule_name VARCHAR(160) NOT NULL,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY')),
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_payment_runs_tenant ON public.accounting_payment_runs (tenant_id, status, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_opening_batches_tenant ON public.accounting_opening_balance_batches (tenant_id, as_of_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_accounting_statutory_returns_tenant ON public.accounting_statutory_returns (tenant_id, period_to DESC, status);
CREATE INDEX IF NOT EXISTS idx_accounting_report_schedules_tenant ON public.accounting_report_schedules (tenant_id, is_active, next_run_at);
