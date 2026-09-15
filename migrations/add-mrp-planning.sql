-- Test-safe material requirements planning runs. These plans never create procurement or stock movements.
CREATE TABLE IF NOT EXISTS mrp_planning_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'FAILED')),
  demand_orders INTEGER NOT NULL DEFAULT 0,
  material_lines INTEGER NOT NULL DEFAULT 0,
  shortage_lines INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mrp_planning_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES mrp_planning_runs(id) ON DELETE CASCADE,
  item_id UUID,
  item_code VARCHAR(100),
  item_name VARCHAR(255),
  gross_requirement NUMERIC(18,4) NOT NULL DEFAULT 0,
  issued_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  available_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  net_requirement NUMERIC(18,4) NOT NULL DEFAULT 0,
  supply_action VARCHAR(20) NOT NULL DEFAULT 'MONITOR' CHECK (supply_action IN ('MONITOR', 'BUY', 'BUILD')),
  demand_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mrp_runs_tenant_run_at ON mrp_planning_runs(tenant_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_mrp_lines_run_net ON mrp_planning_lines(run_id, net_requirement DESC);
