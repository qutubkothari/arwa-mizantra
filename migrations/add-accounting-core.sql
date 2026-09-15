-- Mizantra/test accounting foundation: tenant-scoped double-entry ledger.
-- Existing purchase/sales/service tables remain the operational subledgers;
-- these tables provide the auditable GL/control layer around them.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.accounting_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_code VARCHAR(40) NOT NULL,
  account_name VARCHAR(180) NOT NULL,
  account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_id UUID REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  is_control_account BOOLEAN NOT NULL DEFAULT FALSE,
  currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  opening_debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  opening_credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, account_code),
  CHECK (opening_debit >= 0 AND opening_credit >= 0)
);

CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_name VARCHAR(80) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','LOCKED')),
  closed_at TIMESTAMPTZ,
  closed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period_name),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.accounting_journals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_number VARCHAR(60) NOT NULL,
  journal_date DATE NOT NULL,
  source_type VARCHAR(50),
  source_id UUID,
  narration TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','REVERSED')),
  total_debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  posted_at TIMESTAMPTZ,
  posted_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, journal_number),
  CHECK (total_debit >= 0 AND total_credit >= 0)
);

CREATE TABLE IF NOT EXISTS public.accounting_journal_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES public.accounting_journals(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  description TEXT,
  debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  party_type VARCHAR(20),
  party_id UUID,
  cost_center VARCHAR(80),
  tax_code VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journal_id, line_number),
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_tenant ON public.accounting_accounts (tenant_id, account_type, is_active);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_tenant ON public.accounting_periods (tenant_id, start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_accounting_journals_tenant_date ON public.accounting_journals (tenant_id, journal_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account ON public.accounting_journal_lines (tenant_id, account_id, journal_id);

COMMENT ON TABLE public.accounting_accounts IS 'Tenant chart of accounts and control-account metadata.';
COMMENT ON TABLE public.accounting_journals IS 'Auditable double-entry journals; posted entries are immutable.';
