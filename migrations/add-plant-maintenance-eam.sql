-- Test-only foundation for internal plant maintenance (EAM).
-- Operational records only: no inventory reservation, payroll, or GL posting.
CREATE TABLE IF NOT EXISTS plant_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  asset_code VARCHAR(60) NOT NULL,
  asset_name VARCHAR(200) NOT NULL,
  asset_type VARCHAR(60),
  location_name VARCHAR(160),
  criticality VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (criticality IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','RETIRED')),
  manufacturer VARCHAR(160),
  model_number VARCHAR(120),
  serial_number VARCHAR(120),
  commissioned_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, asset_code)
);

CREATE TABLE IF NOT EXISTS plant_maintenance_work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  work_order_number VARCHAR(60) NOT NULL,
  asset_id UUID NOT NULL REFERENCES plant_assets(id) ON DELETE RESTRICT,
  work_type VARCHAR(20) NOT NULL CHECK (work_type IN ('PREVENTIVE','CORRECTIVE','BREAKDOWN','INSPECTION')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  planned_date DATE,
  reported_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  downtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (downtime_minutes >= 0),
  description TEXT,
  resolution_note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, work_order_number)
);

CREATE INDEX IF NOT EXISTS idx_plant_assets_tenant_status ON plant_assets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_plant_maintenance_work_orders_open ON plant_maintenance_work_orders(tenant_id, status, planned_date);
