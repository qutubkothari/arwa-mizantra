-- Additive Mizantra accounting subledgers. All records are tenant scoped.
CREATE TABLE IF NOT EXISTS public.accounting_parties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  party_type VARCHAR(12) NOT NULL CHECK (party_type IN ('CUSTOMER','SUPPLIER','EMPLOYEE','OTHER')),
  party_id UUID,
  party_code VARCHAR(80),
  party_name VARCHAR(180) NOT NULL,
  receivable_account_id UUID REFERENCES public.accounting_accounts(id),
  payable_account_id UUID REFERENCES public.accounting_accounts(id),
  credit_limit NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit_days INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accounting_open_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  party_id UUID REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  document_type VARCHAR(30) NOT NULL CHECK (document_type IN ('INVOICE','DEBIT_NOTE','CREDIT_NOTE','ADVANCE','JOURNAL')),
  document_id UUID,
  document_number VARCHAR(100) NOT NULL,
  document_date DATE NOT NULL,
  due_date DATE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('RECEIVABLE','PAYABLE')),
  original_amount NUMERIC(18,2) NOT NULL CHECK (original_amount >= 0),
  settled_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  status VARCHAR(14) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIAL','SETTLED','CANCELLED')),
  journal_id UUID REFERENCES public.accounting_journals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accounting_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  open_item_id UUID NOT NULL REFERENCES public.accounting_open_items(id) ON DELETE CASCADE,
  settlement_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(30),
  reference_number VARCHAR(100),
  journal_id UUID REFERENCES public.accounting_journals(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accounting_bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  bank_name VARCHAR(180) NOT NULL,
  account_name VARCHAR(180),
  account_number_masked VARCHAR(40),
  ifsc_or_swift VARCHAR(40),
  currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accounting_bank_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.accounting_bank_accounts(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  value_date DATE,
  reference_number VARCHAR(120),
  description TEXT,
  amount NUMERIC(18,2) NOT NULL,
  direction VARCHAR(4) NOT NULL CHECK (direction IN ('IN','OUT')),
  matched_journal_id UUID REFERENCES public.accounting_journals(id) ON DELETE SET NULL,
  reconciliation_status VARCHAR(14) NOT NULL DEFAULT 'UNMATCHED' CHECK (reconciliation_status IN ('UNMATCHED','MATCHED','EXCLUDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accounting_tax_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tax_code VARCHAR(40) NOT NULL,
  tax_name VARCHAR(120) NOT NULL,
  tax_type VARCHAR(20) NOT NULL CHECK (tax_type IN ('GST','VAT','SALES_TAX','WITHHOLDING','OTHER')),
  rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  input_account_id UUID REFERENCES public.accounting_accounts(id),
  output_account_id UUID REFERENCES public.accounting_accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, tax_code)
);

CREATE TABLE IF NOT EXISTS public.accounting_fixed_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_code VARCHAR(60) NOT NULL,
  asset_name VARCHAR(180) NOT NULL,
  asset_account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  depreciation_account_id UUID REFERENCES public.accounting_accounts(id),
  accumulated_depreciation_account_id UUID REFERENCES public.accounting_accounts(id),
  acquisition_date DATE NOT NULL,
  capitalization_date DATE,
  cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  residual_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL DEFAULT 60,
  depreciation_method VARCHAR(20) NOT NULL DEFAULT 'STRAIGHT_LINE',
  accumulated_depreciation NUMERIC(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(14) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISPOSED','FULLY_DEPRECIATED')),
  UNIQUE (tenant_id, asset_code)
);

CREATE TABLE IF NOT EXISTS public.accounting_budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  budget_name VARCHAR(180) NOT NULL,
  fiscal_year VARCHAR(20) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CLOSED')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, budget_name, fiscal_year)
);

CREATE TABLE IF NOT EXISTS public.accounting_budget_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  budget_id UUID NOT NULL REFERENCES public.accounting_budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  period_start DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  cost_center VARCHAR(80),
  UNIQUE (budget_id, account_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_accounting_open_items_tenant ON public.accounting_open_items (tenant_id, direction, status, due_date);
CREATE INDEX IF NOT EXISTS idx_accounting_settlements_item ON public.accounting_settlements (tenant_id, open_item_id, settlement_date);
CREATE INDEX IF NOT EXISTS idx_accounting_bank_tx_tenant ON public.accounting_bank_transactions (tenant_id, bank_account_id, transaction_date, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_accounting_assets_tenant ON public.accounting_fixed_assets (tenant_id, status, acquisition_date);
CREATE INDEX IF NOT EXISTS idx_accounting_budget_lines_tenant ON public.accounting_budget_lines (tenant_id, budget_id, period_start);
