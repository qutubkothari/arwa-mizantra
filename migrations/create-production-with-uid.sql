-- Migration: Create Production tables with UID assembly tracking
-- Description: Production orders with component-to-finished-product UID linkage
-- Date: 2025-11-27
-- Per FRS Section 3.3: UID-based linkage from components to final product

-- Create production order status enum
DO $$ BEGIN
    CREATE TYPE production_order_status AS ENUM ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'QC', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create production_orders table
CREATE TABLE IF NOT EXISTS production_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    item_id UUID NOT NULL, -- Finished product to manufacture
    bom_id UUID, -- Bill of Materials reference
    quantity DECIMAL(12,2) NOT NULL,
    produced_quantity DECIMAL(12,2) DEFAULT 0,
    status production_order_status DEFAULT 'DRAFT',
    plant_code VARCHAR(50),
    start_date DATE,
    end_date DATE,
    actual_start_date TIMESTAMP,
    actual_end_date TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'NORMAL',
    notes TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_orders_tenant ON production_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prod_orders_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_prod_orders_item ON production_orders(item_id);
CREATE INDEX IF NOT EXISTS idx_prod_orders_number ON production_orders(order_number);

-- Create production_order_components table (tracks component consumption)
CREATE TABLE IF NOT EXISTS production_order_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL, -- Component item
    required_quantity DECIMAL(12,2) NOT NULL,
    consumed_quantity DECIMAL(12,2) DEFAULT 0,
    component_uid VARCHAR(100), -- UID of component used
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_components_order ON production_order_components(production_order_id);
CREATE INDEX IF NOT EXISTS idx_prod_components_item ON production_order_components(item_id);
CREATE INDEX IF NOT EXISTS idx_prod_components_uid ON production_order_components(component_uid);

-- Create production_assemblies table (tracks finished products with UID hierarchy)
CREATE TABLE IF NOT EXISTS production_assemblies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    finished_product_uid VARCHAR(100) NOT NULL, -- UID of finished product
    component_uids JSONB, -- Array of component UIDs used in this assembly
    assembly_date TIMESTAMP DEFAULT NOW(),
    assembled_by UUID,
    qc_status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, PASSED, FAILED
    qc_date TIMESTAMP,
    qc_by UUID,
    qc_notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_assemblies_order ON production_assemblies(production_order_id);
CREATE INDEX IF NOT EXISTS idx_prod_assemblies_finished_uid ON production_assemblies(finished_product_uid);
CREATE INDEX IF NOT EXISTS idx_prod_assemblies_qc_status ON production_assemblies(qc_status);

-- Create production_stage_logs table (tracks workflow stages)
CREATE TABLE IF NOT EXISTS production_stage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL, -- DRAFT, RELEASED, IN_PROGRESS, QC, COMPLETED
    entered_at TIMESTAMP DEFAULT NOW(),
    entered_by UUID,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_prod_stage_logs_order ON production_stage_logs(production_order_id);

-- Add comments
COMMENT ON TABLE production_orders IS 'Manufacturing orders for finished products';
COMMENT ON TABLE production_order_components IS 'Components required and consumed for production order';
COMMENT ON TABLE production_assemblies IS 'Finished product assemblies with UID hierarchy tracking (component UIDs → finished product UID)';
COMMENT ON TABLE production_stage_logs IS 'Production workflow stage history';

COMMENT ON COLUMN production_assemblies.finished_product_uid IS 'UID of the finished product created in this assembly';
COMMENT ON COLUMN production_assemblies.component_uids IS 'JSON array of component UIDs used: ["UID-SAIF-KOL-RM-000001-A7", "UID-SAIF-KOL-RM-000002-B3"]';
COMMENT ON COLUMN production_order_components.component_uid IS 'UID of the component item consumed in production';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Production tables created successfully with UID assembly tracking enabled';
END $$;
