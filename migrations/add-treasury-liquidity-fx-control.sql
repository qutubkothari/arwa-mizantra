-- Treasury liquidity, funding and FX exposure control. Records decisions; never initiates bank or hedge transactions.
CREATE TABLE IF NOT EXISTS treasury_cash_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  bank_account_id UUID NOT NULL REFERENCES accounting_bank_accounts(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL, available_balance NUMERIC(18,2) NOT NULL,
  restricted_cash NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (restricted_cash >= 0),
  minimum_operating_buffer NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (minimum_operating_buffer >= 0),
  deposit_yield_pct NUMERIC(9,4) NOT NULL DEFAULT 0 CHECK (deposit_yield_pct >= 0),
  borrowing_cost_pct NUMERIC(9,4) NOT NULL DEFAULT 0 CHECK (borrowing_cost_pct >= 0),
  evidence_reference TEXT NOT NULL, created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, bank_account_id, as_of_date)
);
CREATE TABLE IF NOT EXISTS treasury_fx_exposures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  exposure_reference VARCHAR(100) NOT NULL, exposure_type VARCHAR(20) NOT NULL CHECK (exposure_type IN ('RECEIVABLE','PAYABLE','LOAN','PURCHASE','SALE')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('INFLOW','OUTFLOW')), currency_code VARCHAR(8) NOT NULL,
  foreign_amount NUMERIC(18,2) NOT NULL CHECK (foreign_amount > 0), base_amount_aed NUMERIC(18,2) NOT NULL CHECK (base_amount_aed >= 0),
  due_date DATE NOT NULL, hedged_amount_aed NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (hedged_amount_aed >= 0),
  evidence_reference TEXT NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, exposure_reference)
);
CREATE TABLE IF NOT EXISTS treasury_optimization_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('SWEEP','REPAY','INVEST','HEDGE','REFINANCE','NEGOTIATE_FEES')),
  action_description TEXT NOT NULL, owner_reference TEXT NOT NULL, due_date DATE NOT NULL,
  target_cash_release NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_cash_release >= 0),
  target_annual_savings NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_annual_savings >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','EXECUTED','VERIFIED','CANCELLED')),
  created_by UUID NOT NULL, approval_note TEXT, approved_by UUID, approved_at TIMESTAMPTZ,
  execution_evidence TEXT, executed_by UUID, executed_at TIMESTAMPTZ,
  verification_evidence TEXT, realized_cash_release NUMERIC(18,2), realized_annual_savings NUMERIC(18,2), verified_by UUID, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treasury_cash_tenant_date ON treasury_cash_positions (tenant_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_treasury_fx_tenant_due ON treasury_fx_exposures (tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_treasury_action_tenant_status ON treasury_optimization_actions (tenant_id, status, due_date);
