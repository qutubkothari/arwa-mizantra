-- IFRS 15 contract revenue recognition. Tax-exclusive planning and evidence control; never posts journals.
CREATE TABLE IF NOT EXISTS revenue_recognition_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  contract_code VARCHAR(50) NOT NULL, customer_name VARCHAR(180) NOT NULL, customer_trn VARCHAR(40),
  contract_date DATE NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
  transaction_price_ex_tax NUMERIC(18,2) NOT NULL CHECK (transaction_price_ex_tax > 0),
  billed_amount_ex_tax NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (billed_amount_ex_tax >= 0),
  currency_code VARCHAR(8) NOT NULL DEFAULT 'AED', contract_evidence TEXT NOT NULL,
  receivable_account_id UUID REFERENCES accounting_accounts(id), contract_asset_account_id UUID REFERENCES accounting_accounts(id),
  contract_liability_account_id UUID REFERENCES accounting_accounts(id), revenue_account_id UUID REFERENCES accounting_accounts(id),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, contract_code), CHECK (end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS revenue_performance_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL REFERENCES revenue_recognition_contracts(id) ON DELETE CASCADE,
  obligation_code VARCHAR(50) NOT NULL, description TEXT NOT NULL,
  satisfaction_pattern VARCHAR(16) NOT NULL CHECK (satisfaction_pattern IN ('POINT_IN_TIME','OVER_TIME')),
  standalone_selling_price NUMERIC(18,2) NOT NULL CHECK (standalone_selling_price > 0),
  allocated_transaction_price NUMERIC(18,2), recognition_start_date DATE NOT NULL, recognition_end_date DATE NOT NULL,
  acceptance_criteria TEXT NOT NULL, created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, contract_id, obligation_code), CHECK (recognition_end_date >= recognition_start_date)
);
CREATE TABLE IF NOT EXISTS revenue_recognition_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  obligation_id UUID NOT NULL REFERENCES revenue_performance_obligations(id) ON DELETE CASCADE,
  recognition_date DATE NOT NULL, cumulative_progress_pct NUMERIC(5,2) NOT NULL CHECK (cumulative_progress_pct > 0 AND cumulative_progress_pct <= 100),
  prior_verified_progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0, claimed_revenue NUMERIC(18,2) NOT NULL CHECK (claimed_revenue > 0),
  performance_evidence TEXT NOT NULL, customer_acceptance_reference TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','VERIFIED','REJECTED')),
  created_by UUID NOT NULL, verified_by UUID, verification_note TEXT, finance_evidence TEXT, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, obligation_id, recognition_date)
);
CREATE INDEX IF NOT EXISTS idx_revenue_contract_tenant_status ON revenue_recognition_contracts (tenant_id, status, end_date);
CREATE INDEX IF NOT EXISTS idx_revenue_obligation_contract ON revenue_performance_obligations (tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_revenue_claim_tenant_status ON revenue_recognition_claims (tenant_id, status, recognition_date);
