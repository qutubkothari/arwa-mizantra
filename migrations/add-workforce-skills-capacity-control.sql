-- Workforce skills, certification and capacity-risk control. Assessments require evidence and never change payroll.
CREATE TABLE IF NOT EXISTS workforce_skill_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  requirement_code VARCHAR(60) NOT NULL, skill_name VARCHAR(180) NOT NULL,
  department VARCHAR(100), designation VARCHAR(100), criticality VARCHAR(20) NOT NULL DEFAULT 'HIGH' CHECK (criticality IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  required_headcount INTEGER NOT NULL DEFAULT 1 CHECK (required_headcount > 0),
  minimum_proficiency INTEGER NOT NULL DEFAULT 3 CHECK (minimum_proficiency BETWEEN 1 AND 5),
  certification_required BOOLEAN NOT NULL DEFAULT FALSE,
  annual_risk_hours NUMERIC(12,2) NOT NULL DEFAULT 160 CHECK (annual_risk_hours >= 0),
  cost_per_gap_hour NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cost_per_gap_hour >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, requirement_code)
);

CREATE TABLE IF NOT EXISTS workforce_skill_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  requirement_id UUID NOT NULL REFERENCES workforce_skill_requirements(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  proficiency_level INTEGER NOT NULL CHECK (proficiency_level BETWEEN 1 AND 5),
  assessed_on DATE NOT NULL, certified_until DATE, evidence_reference TEXT NOT NULL,
  assessed_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, requirement_id, employee_id)
);

CREATE TABLE IF NOT EXISTS workforce_gap_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  requirement_id UUID NOT NULL REFERENCES workforce_skill_requirements(id) ON DELETE CASCADE,
  action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('TRAIN','CROSS_TRAIN','REDEPLOY','HIRE','CONTRACT','AUTOMATE')),
  affected_headcount INTEGER NOT NULL DEFAULT 1 CHECK (affected_headcount > 0),
  action_description TEXT NOT NULL, owner_reference TEXT NOT NULL, due_date DATE NOT NULL,
  target_annual_cost_avoidance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_annual_cost_avoidance >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','EXECUTED','VERIFIED','CANCELLED')),
  created_by UUID NOT NULL, approval_note TEXT, approved_by UUID, approved_at TIMESTAMPTZ,
  execution_evidence TEXT, executed_by UUID, executed_at TIMESTAMPTZ,
  verification_evidence TEXT, realized_annual_cost_avoidance NUMERIC(18,2), verified_by UUID, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workforce_requirement_tenant ON workforce_skill_requirements (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_workforce_assessment_tenant ON workforce_skill_assessments (tenant_id, requirement_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_workforce_gap_action_tenant ON workforce_gap_actions (tenant_id, status, due_date);
