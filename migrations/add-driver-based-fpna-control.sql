-- Driver-based FP&A and rolling scenario control.
-- Read-only actual snapshots and planning outputs; never posts journals or overwrites budgets.
CREATE TABLE IF NOT EXISTS fpna_plan_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  cycle_code VARCHAR(40) NOT NULL, cycle_name VARCHAR(180) NOT NULL,
  actual_period_from DATE NOT NULL, actual_period_to DATE NOT NULL,
  forecast_months INTEGER NOT NULL DEFAULT 12 CHECK (forecast_months BETWEEN 3 AND 36),
  currency_code VARCHAR(8) NOT NULL DEFAULT 'AED', actual_snapshot JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CLOSED','CANCELLED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  closed_by UUID, closure_evidence TEXT, closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cycle_code), CHECK (actual_period_to >= actual_period_from)
);
CREATE TABLE IF NOT EXISTS fpna_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  cycle_id UUID NOT NULL REFERENCES fpna_plan_cycles(id) ON DELETE CASCADE,
  scenario_name VARCHAR(160) NOT NULL,
  scenario_type VARCHAR(16) NOT NULL CHECK (scenario_type IN ('BASE','UPSIDE','DOWNSIDE','STRESS','BOARD')),
  revenue_growth_pct NUMERIC(9,4) NOT NULL DEFAULT 0,
  gross_margin_pct NUMERIC(9,4) NOT NULL CHECK (gross_margin_pct BETWEEN 0 AND 100),
  opex_pct_of_revenue NUMERIC(9,4) NOT NULL CHECK (opex_pct_of_revenue BETWEEN 0 AND 100),
  dso_days NUMERIC(9,2) NOT NULL CHECK (dso_days >= 0), dpo_days NUMERIC(9,2) NOT NULL CHECK (dpo_days >= 0),
  inventory_days NUMERIC(9,2) NOT NULL CHECK (inventory_days >= 0), capex NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (capex >= 0),
  tax_rate_pct NUMERIC(9,4) NOT NULL DEFAULT 9 CHECK (tax_rate_pct BETWEEN 0 AND 100),
  confidence_pct NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence_pct BETWEEN 0 AND 100),
  projected_revenue NUMERIC(18,2) NOT NULL, projected_gross_profit NUMERIC(18,2) NOT NULL,
  projected_opex NUMERIC(18,2) NOT NULL, projected_ebitda NUMERIC(18,2) NOT NULL,
  projected_nwc NUMERIC(18,2) NOT NULL, working_capital_release NUMERIC(18,2) NOT NULL,
  projected_funding_need NUMERIC(18,2) NOT NULL, projected_free_cash NUMERIC(18,2) NOT NULL,
  confidence_adjusted_free_cash NUMERIC(18,2) NOT NULL,
  assumptions_evidence TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','REJECTED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  rejected_by UUID, rejection_reason TEXT, rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cycle_id, scenario_name)
);
CREATE INDEX IF NOT EXISTS idx_fpna_cycles_tenant_status ON fpna_plan_cycles (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fpna_scenarios_cycle ON fpna_scenarios (tenant_id, cycle_id, status);
