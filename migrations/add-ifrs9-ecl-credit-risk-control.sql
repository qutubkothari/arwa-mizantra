-- IFRS 9 expected-credit-loss control for trade receivables. Calculates impairment previews only.
CREATE TABLE IF NOT EXISTS credit_ecl_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  model_code VARCHAR(50) NOT NULL, model_name VARCHAR(180) NOT NULL, as_of_date DATE NOT NULL,
  stage_1_pd_pct NUMERIC(7,4) NOT NULL CHECK (stage_1_pd_pct BETWEEN 0 AND 100),
  stage_2_pd_pct NUMERIC(7,4) NOT NULL CHECK (stage_2_pd_pct BETWEEN 0 AND 100),
  stage_3_pd_pct NUMERIC(7,4) NOT NULL CHECK (stage_3_pd_pct BETWEEN 0 AND 100),
  lgd_pct NUMERIC(7,4) NOT NULL CHECK (lgd_pct BETWEEN 0 AND 100),
  forward_looking_factor NUMERIC(7,4) NOT NULL DEFAULT 1 CHECK (forward_looking_factor BETWEEN 0 AND 5),
  methodology_evidence TEXT NOT NULL, impairment_expense_account_id UUID REFERENCES accounting_accounts(id),
  loss_allowance_account_id UUID REFERENCES accounting_accounts(id),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CLOSED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, model_code)
);
CREATE TABLE IF NOT EXISTS credit_ecl_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  model_id UUID NOT NULL REFERENCES credit_ecl_models(id) ON DELETE CASCADE,
  open_item_id UUID NOT NULL REFERENCES accounting_open_items(id) ON DELETE CASCADE,
  party_id UUID REFERENCES accounting_parties(id), document_number VARCHAR(100) NOT NULL,
  due_date DATE, days_past_due INTEGER NOT NULL, stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 3),
  exposure_at_default NUMERIC(18,2) NOT NULL CHECK (exposure_at_default > 0),
  pd_pct NUMERIC(7,4) NOT NULL CHECK (pd_pct BETWEEN 0 AND 100), lgd_pct NUMERIC(7,4) NOT NULL CHECK (lgd_pct BETWEEN 0 AND 100),
  expected_credit_loss NUMERIC(18,2) NOT NULL CHECK (expected_credit_loss >= 0),
  original_stage INTEGER NOT NULL CHECK (original_stage BETWEEN 1 AND 3), original_ecl NUMERIC(18,2) NOT NULL,
  UNIQUE (tenant_id, model_id, open_item_id)
);
CREATE TABLE IF NOT EXISTS credit_ecl_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  assessment_id UUID NOT NULL REFERENCES credit_ecl_assessments(id) ON DELETE CASCADE,
  proposed_stage INTEGER NOT NULL CHECK (proposed_stage BETWEEN 1 AND 3),
  proposed_pd_pct NUMERIC(7,4) NOT NULL CHECK (proposed_pd_pct BETWEEN 0 AND 100),
  proposed_lgd_pct NUMERIC(7,4) NOT NULL CHECK (proposed_lgd_pct BETWEEN 0 AND 100),
  override_reason TEXT NOT NULL, override_evidence TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ecl_pending_override ON credit_ecl_overrides (tenant_id, assessment_id) WHERE status = 'PROPOSED';
CREATE INDEX IF NOT EXISTS idx_credit_ecl_model_tenant ON credit_ecl_models (tenant_id, status, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ecl_assessment_model ON credit_ecl_assessments (tenant_id, model_id, stage);
