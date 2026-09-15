-- Inventory working-capital and SLOB control. This module never moves or writes off stock automatically.
CREATE TABLE IF NOT EXISTS inventory_working_capital_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  target_days_supply NUMERIC(10,2) NOT NULL DEFAULT 45 CHECK (target_days_supply >= 0),
  safety_stock_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (safety_stock_quantity >= 0),
  slow_moving_days INTEGER NOT NULL DEFAULT 90 CHECK (slow_moving_days > 0),
  obsolete_days INTEGER NOT NULL DEFAULT 365 CHECK (obsolete_days > slow_moving_days),
  annual_carrying_cost_pct NUMERIC(7,3) NOT NULL DEFAULT 20 CHECK (annual_carrying_cost_pct >= 0),
  unit_cost_override NUMERIC(18,4) CHECK (unit_cost_override IS NULL OR unit_cost_override >= 0),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_disposition_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  classification VARCHAR(20) NOT NULL CHECK (classification IN ('EXCESS','SLOW','OBSOLETE')),
  disposition_action VARCHAR(30) NOT NULL CHECK (disposition_action IN ('RETURN','TRANSFER','DISCOUNT','BUNDLE','CONSUME','RECYCLE','WRITE_OFF')),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  target_cash_release NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_cash_release >= 0),
  target_annual_carrying_cost_avoidance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_annual_carrying_cost_avoidance >= 0),
  rationale TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','EXECUTED','VERIFIED','REJECTED')),
  created_by UUID NOT NULL,
  approval_note TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  execution_evidence TEXT,
  executed_by UUID,
  executed_at TIMESTAMPTZ,
  verification_evidence TEXT,
  realized_cash_release NUMERIC(18,2),
  realized_carrying_cost_avoidance NUMERIC(18,2),
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_wc_policy_tenant ON inventory_working_capital_policies (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_disposition_tenant_status ON inventory_disposition_cases (tenant_id, status, created_at DESC);
