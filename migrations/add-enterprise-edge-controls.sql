-- Enterprise control foundations: consolidation, warehouse execution and finite-capacity scheduling.
-- These tables do not post journals, move stock, or submit statutory filings.
CREATE TABLE IF NOT EXISTS enterprise_legal_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  entity_code VARCHAR(40) NOT NULL, entity_name VARCHAR(200) NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'AE', functional_currency CHAR(3) NOT NULL DEFAULT 'AED',
  tax_registration_number VARCHAR(40), ownership_percent NUMERIC(7,4) NOT NULL DEFAULT 100 CHECK (ownership_percent BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity_code)
);
CREATE TABLE IF NOT EXISTS enterprise_intercompany_register (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  source_entity_id UUID NOT NULL REFERENCES enterprise_legal_entities(id) ON DELETE RESTRICT,
  target_entity_id UUID NOT NULL REFERENCES enterprise_legal_entities(id) ON DELETE RESTRICT,
  document_type VARCHAR(40) NOT NULL, reference_number VARCHAR(120) NOT NULL, transaction_date DATE NOT NULL,
  amount NUMERIC(18,4) NOT NULL CHECK (amount >= 0), currency_code CHAR(3) NOT NULL DEFAULT 'AED',
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MATCHED','ELIMINATION_READY','ELIMINATED','DISPUTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(source_entity_id <> target_entity_id),
  UNIQUE(tenant_id, source_entity_id, target_entity_id, reference_number)
);
CREATE TABLE IF NOT EXISTS enterprise_consolidation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  period_from DATE NOT NULL, period_to DATE NOT NULL, reporting_currency CHAR(3) NOT NULL DEFAULT 'AED',
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','VALIDATED','APPROVED')),
  entity_count INTEGER NOT NULL DEFAULT 0, open_intercompany_count INTEGER NOT NULL DEFAULT 0,
  control_totals JSONB NOT NULL DEFAULT '{}'::jsonb, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(period_to >= period_from)
);
CREATE TABLE IF NOT EXISTS warehouse_bins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL, warehouse_id UUID NOT NULL,
  bin_code VARCHAR(60) NOT NULL, zone_code VARCHAR(40), barcode VARCHAR(120), bin_type VARCHAR(24) NOT NULL DEFAULT 'STORAGE',
  capacity_quantity NUMERIC(18,4), is_blocked BOOLEAN NOT NULL DEFAULT FALSE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id, warehouse_id, bin_code), UNIQUE(tenant_id, barcode)
);
CREATE TABLE IF NOT EXISTS warehouse_execution_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL, task_number VARCHAR(60) NOT NULL,
  task_type VARCHAR(20) NOT NULL CHECK(task_type IN ('RECEIVE','PUTAWAY','PICK','MOVE','COUNT')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED','EXCEPTION')),
  item_id UUID, quantity NUMERIC(18,4) NOT NULL CHECK(quantity > 0), from_bin_id UUID REFERENCES warehouse_bins(id) ON DELETE RESTRICT,
  to_bin_id UUID REFERENCES warehouse_bins(id) ON DELETE RESTRICT, reference_number VARCHAR(120), scanned_barcode VARCHAR(160),
  assigned_to UUID, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id, task_number)
);
CREATE TABLE IF NOT EXISTS production_capacity_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL, work_station_id UUID NOT NULL, work_date DATE NOT NULL,
  available_minutes INTEGER NOT NULL CHECK(available_minutes >= 0), planned_minutes INTEGER NOT NULL DEFAULT 0 CHECK(planned_minutes >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','FULL','OVERLOADED','BLOCKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, work_station_id, work_date)
);
CREATE TABLE IF NOT EXISTS production_schedule_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL, job_order_id UUID NOT NULL, work_station_id UUID NOT NULL,
  operation_code VARCHAR(60) NOT NULL, planned_start TIMESTAMPTZ NOT NULL, planned_end TIMESTAMPTZ NOT NULL,
  planned_minutes INTEGER NOT NULL CHECK(planned_minutes > 0), status VARCHAR(20) NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','RELEASED','IN_PROGRESS','COMPLETED','BLOCKED')),
  scheduling_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(planned_end > planned_start),
  UNIQUE(tenant_id, job_order_id, operation_code)
);
CREATE INDEX IF NOT EXISTS idx_enterprise_ic_status ON enterprise_intercompany_register(tenant_id,status,transaction_date);
CREATE INDEX IF NOT EXISTS idx_warehouse_tasks_status ON warehouse_execution_tasks(tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_capacity_slots_date ON production_capacity_slots(tenant_id,work_date,status);
CREATE INDEX IF NOT EXISTS idx_schedule_station_time ON production_schedule_operations(tenant_id,work_station_id,planned_start,planned_end);
