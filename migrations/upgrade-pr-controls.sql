BEGIN;

ALTER TABLE purchase_requisitions
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_approval_level INTEGER DEFAULT 0;

ALTER TABLE purchase_requisition_items
  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id);

CREATE TABLE IF NOT EXISTS purchase_requisition_approval_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  department VARCHAR(100),
  min_amount NUMERIC(15,2) DEFAULT 0,
  max_amount NUMERIC(15,2),
  sequence INTEGER NOT NULL DEFAULT 1,
  approver_user_id UUID REFERENCES users(id),
  approver_role_id UUID REFERENCES roles(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pr_approval_rule_has_approver CHECK (
    approver_user_id IS NOT NULL OR approver_role_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_pr_approval_rules_match
  ON purchase_requisition_approval_rules(tenant_id, department, min_amount, sequence)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS purchase_requisition_approval_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pr_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  approval_rule_id UUID REFERENCES purchase_requisition_approval_rules(id),
  approval_level INTEGER NOT NULL DEFAULT 0,
  action VARCHAR(30) NOT NULL,
  from_status VARCHAR(30),
  to_status VARCHAR(30),
  actor_id UUID NOT NULL REFERENCES users(id),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_approval_history_pr
  ON purchase_requisition_approval_history(tenant_id, pr_id, created_at);

NOTIFY pgrst, 'reload schema';

COMMIT;
