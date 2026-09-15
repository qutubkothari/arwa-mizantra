-- IAS 37 provision and contingency control. Calculates recognition/disclosure previews only.
CREATE TABLE IF NOT EXISTS provision_control_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  case_code VARCHAR(50) NOT NULL, case_type VARCHAR(24) NOT NULL CHECK (case_type IN ('LEGAL','WARRANTY','ONEROUS_CONTRACT','DECOMMISSIONING','RESTRUCTURING','OTHER')),
  title VARCHAR(180) NOT NULL, description TEXT NOT NULL, obligating_event_date DATE NOT NULL,
  expected_settlement_date DATE NOT NULL, probability_pct NUMERIC(7,4) NOT NULL CHECK (probability_pct BETWEEN 0 AND 100),
  discount_rate_pct NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (discount_rate_pct BETWEEN 0 AND 100),
  recognition_threshold_pct NUMERIC(7,4) NOT NULL DEFAULT 50 CHECK (recognition_threshold_pct BETWEEN 0 AND 100),
  disclosure_threshold_pct NUMERIC(7,4) NOT NULL DEFAULT 5 CHECK (disclosure_threshold_pct BETWEEN 0 AND 100),
  owner_reference TEXT NOT NULL, source_evidence TEXT NOT NULL, next_review_date DATE NOT NULL,
  classification VARCHAR(24) CHECK (classification IN ('PROVISION','CONTINGENT_LIABILITY','REMOTE')),
  probability_weighted_exposure NUMERIC(18,2), present_value_exposure NUMERIC(18,2), recognized_amount NUMERIC(18,2),
  provision_expense_account_id UUID REFERENCES accounting_accounts(id), provision_liability_account_id UUID REFERENCES accounting_accounts(id),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SETTLED','CANCELLED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  actual_settlement_amount NUMERIC(18,2), settlement_evidence TEXT, settled_by UUID, settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, case_code), CHECK (expected_settlement_date >= obligating_event_date),
  CHECK (disclosure_threshold_pct <= recognition_threshold_pct)
);
CREATE TABLE IF NOT EXISTS provision_cashflow_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  case_id UUID NOT NULL REFERENCES provision_control_cases(id) ON DELETE CASCADE,
  scenario_label VARCHAR(120) NOT NULL, cashflow_amount NUMERIC(18,2) NOT NULL CHECK (cashflow_amount >= 0),
  probability_weight_pct NUMERIC(7,4) NOT NULL CHECK (probability_weight_pct > 0 AND probability_weight_pct <= 100),
  expected_payment_date DATE NOT NULL, estimate_evidence TEXT NOT NULL, created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (tenant_id, case_id, scenario_label)
);
CREATE TABLE IF NOT EXISTS provision_case_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  case_id UUID NOT NULL REFERENCES provision_control_cases(id) ON DELETE CASCADE,
  review_date DATE NOT NULL, revised_probability_pct NUMERIC(7,4) NOT NULL CHECK (revised_probability_pct BETWEEN 0 AND 100),
  revised_discount_rate_pct NUMERIC(7,4) NOT NULL CHECK (revised_discount_rate_pct BETWEEN 0 AND 100),
  revised_settlement_date DATE NOT NULL, next_review_date DATE NOT NULL,
  review_conclusion TEXT NOT NULL, review_evidence TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provision_case_tenant_status ON provision_control_cases (tenant_id, status, next_review_date);
CREATE INDEX IF NOT EXISTS idx_provision_cashflow_case ON provision_cashflow_scenarios (tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_provision_review_tenant_status ON provision_case_reviews (tenant_id, status, review_date);
