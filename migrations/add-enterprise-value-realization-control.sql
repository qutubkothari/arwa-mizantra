-- Enterprise value-realization control tower.
-- Governs benefit claims and finance verification; it never posts journals or changes operational records.
CREATE TABLE IF NOT EXISTS value_realization_initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  initiative_code VARCHAR(40) NOT NULL,
  title VARCHAR(180) NOT NULL,
  source_module VARCHAR(40) NOT NULL,
  source_reference VARCHAR(120),
  owner_reference TEXT NOT NULL,
  baseline_period_from DATE NOT NULL,
  baseline_period_to DATE NOT NULL,
  baseline_value NUMERIC(18,2) NOT NULL CHECK (baseline_value >= 0),
  baseline_evidence TEXT NOT NULL,
  target_benefit NUMERIC(18,2) NOT NULL CHECK (target_benefit > 0),
  implementation_investment NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (implementation_investment >= 0),
  target_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','CLOSED','CANCELLED')),
  created_by UUID NOT NULL,
  approved_by UUID,
  approval_note TEXT,
  approved_at TIMESTAMPTZ,
  closed_by UUID,
  closure_evidence TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, initiative_code)
);

CREATE TABLE IF NOT EXISTS value_realization_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  initiative_id UUID NOT NULL REFERENCES value_realization_initiatives(id) ON DELETE CASCADE,
  benefit_type VARCHAR(24) NOT NULL CHECK (benefit_type IN ('CASH_RELEASE','COST_SAVING','REVENUE_UPLIFT','RISK_AVOIDANCE')),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  claimed_amount NUMERIC(18,2) NOT NULL CHECK (claimed_amount > 0),
  confidence_pct NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence_pct >= 0 AND confidence_pct <= 100),
  measurement_method TEXT NOT NULL,
  source_reference VARCHAR(160) NOT NULL,
  evidence_reference TEXT NOT NULL,
  claim_fingerprint VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','VERIFIED','REJECTED')),
  created_by UUID NOT NULL,
  verified_amount NUMERIC(18,2),
  finance_evidence TEXT,
  verifier_note TEXT,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, claim_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_value_initiatives_tenant_status
  ON value_realization_initiatives (tenant_id, status, target_date);
CREATE INDEX IF NOT EXISTS idx_value_claims_tenant_status
  ON value_realization_claims (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_value_claims_initiative
  ON value_realization_claims (tenant_id, initiative_id, period_from, period_to);
