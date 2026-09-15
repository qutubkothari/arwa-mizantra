-- SAP-style project earned-value and margin recovery control. Snapshots are evidence, not accounting entries.
CREATE TABLE IF NOT EXISTS project_control_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, as_of_date DATE NOT NULL,
  budget_at_completion NUMERIC(18,2) NOT NULL CHECK (budget_at_completion >= 0),
  planned_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (planned_value >= 0),
  earned_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (earned_value >= 0),
  actual_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),
  committed_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (committed_cost >= 0),
  contract_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  approved_change_orders NUMERIC(18,2) NOT NULL DEFAULT 0,
  billed_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (billed_value >= 0),
  cash_collected NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cash_collected >= 0),
  evidence_reference TEXT NOT NULL, created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, as_of_date)
);

CREATE TABLE IF NOT EXISTS project_margin_recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_id UUID REFERENCES project_control_snapshots(id),
  issue_category VARCHAR(30) NOT NULL CHECK (issue_category IN ('COST','SCHEDULE','SCOPE','BILLING','COLLECTION','PROCUREMENT','CHANGE_ORDER')),
  action_description TEXT NOT NULL, owner_reference TEXT NOT NULL, due_date DATE NOT NULL,
  target_margin_recovery NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_margin_recovery >= 0),
  target_cash_acceleration NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_cash_acceleration >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','EXECUTED','VERIFIED','CANCELLED')),
  created_by UUID NOT NULL, approval_note TEXT, approved_by UUID, approved_at TIMESTAMPTZ,
  execution_evidence TEXT, executed_by UUID, executed_at TIMESTAMPTZ,
  verification_evidence TEXT, realized_margin_recovery NUMERIC(18,2), realized_cash_acceleration NUMERIC(18,2),
  verified_by UUID, verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_control_snapshot_tenant ON project_control_snapshots (tenant_id, project_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_recovery_tenant_status ON project_margin_recovery_actions (tenant_id, status, due_date);
