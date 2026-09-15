-- Continuous financial controls monitoring. Findings are evidence; the scanner never edits or posts transactions.
CREATE TABLE IF NOT EXISTS continuous_control_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  control_code VARCHAR(80) NOT NULL, control_name VARCHAR(200) NOT NULL,
  control_type VARCHAR(20) NOT NULL DEFAULT 'DETECTIVE' CHECK (control_type IN ('PREVENTIVE','DETECTIVE')),
  severity VARCHAR(20) NOT NULL DEFAULT 'HIGH' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, control_code)
);

CREATE TABLE IF NOT EXISTS continuous_control_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  control_code VARCHAR(80) NOT NULL, severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  source_table VARCHAR(80) NOT NULL, source_id VARCHAR(160) NOT NULL, source_reference VARCHAR(160), fingerprint VARCHAR(220) NOT NULL,
  finding_summary TEXT NOT NULL, exposure_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (exposure_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACCEPTED','REMEDIATED','VERIFIED','FALSE_POSITIVE')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), scan_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS control_remediation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  finding_id UUID NOT NULL REFERENCES continuous_control_findings(id) ON DELETE CASCADE,
  action_description TEXT NOT NULL, owner_reference TEXT NOT NULL, due_date DATE NOT NULL,
  target_loss_prevention NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_loss_prevention >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','EXECUTED','VERIFIED','CANCELLED')),
  created_by UUID NOT NULL, approval_note TEXT, approved_by UUID, approved_at TIMESTAMPTZ,
  execution_evidence TEXT, executed_by UUID, executed_at TIMESTAMPTZ,
  verification_evidence TEXT, realized_loss_prevention NUMERIC(18,2), verified_by UUID, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccm_definition_tenant ON continuous_control_definitions (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ccm_finding_tenant_status ON continuous_control_findings (tenant_id, status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ccm_action_tenant_status ON control_remediation_actions (tenant_id, status, due_date);
