-- Migration: Create Inventory/Stores Management tables
-- Description: Comprehensive inventory tracking with UID linkage, warehouse locations, stock movements
-- Date: 2025-11-27
-- Per FRS Section 3.2: Raw, WIP, Finished, Demo, Service Spares categories with UID traceability

-- Create inventory category enum
DO $$ BEGIN
    CREATE TYPE inventory_category AS ENUM ('RAW_MATERIAL', 'WIP', 'FINISHED_GOODS', 'DEMO', 'SERVICE_SPARES', 'CONSUMABLES');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create stock movement type enum
DO $$ BEGIN
    CREATE TYPE stock_movement_type AS ENUM (
        'GRN_RECEIPT',          -- Received from vendor
        'PRODUCTION_ISSUE',     -- Issued to production
        'PRODUCTION_RETURN',    -- Returned from production
        'PRODUCTION_RECEIPT',   -- Received from production (finished goods)
        'SALES_ISSUE',          -- Issued to customer
        'DEMO_ISSUE',           -- Issued as demo
        'DEMO_RETURN',          -- Returned from demo
        'DEMO_SOLD',            -- Demo converted to sale
        'SERVICE_ISSUE',        -- Issued for service
        'TRANSFER',             -- Inter-warehouse transfer
        'ADJUSTMENT',           -- Stock adjustment
        'SCRAP'                 -- Scrapped/written off
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create or update warehouses table
DO $$ 
BEGIN
    -- Create table if it doesn't exist
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'warehouses') THEN
        CREATE TABLE warehouses (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL,
            warehouse_code VARCHAR(50) UNIQUE NOT NULL,
            warehouse_name VARCHAR(200) NOT NULL,
            location VARCHAR(200),
            plant_code VARCHAR(50),
            is_active BOOLEAN DEFAULT true,
            manager_id UUID,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    ELSE
        -- Add missing columns if table exists
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'warehouse_code') THEN
            ALTER TABLE warehouses ADD COLUMN warehouse_code VARCHAR(50) UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'warehouse_name') THEN
            ALTER TABLE warehouses ADD COLUMN warehouse_name VARCHAR(200) NOT NULL DEFAULT 'Main Warehouse';
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'plant_code') THEN
            ALTER TABLE warehouses ADD COLUMN plant_code VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'is_active') THEN
            ALTER TABLE warehouses ADD COLUMN is_active BOOLEAN DEFAULT true;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'manager_id') THEN
            ALTER TABLE warehouses ADD COLUMN manager_id UUID;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant ON warehouses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(warehouse_code);

-- Create storage locations table
CREATE TABLE IF NOT EXISTS storage_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_code VARCHAR(50) UNIQUE NOT NULL,
    location_name VARCHAR(200) NOT NULL,
    aisle VARCHAR(50),
    rack VARCHAR(50),
    bin VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_locations_warehouse ON storage_locations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_storage_locations_code ON storage_locations(location_code);

-- Create inventory_stock table (current stock levels)
CREATE TABLE IF NOT EXISTS inventory_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    item_id UUID NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    location_id UUID REFERENCES storage_locations(id),
    category inventory_category NOT NULL,
    quantity DECIMAL(12,2) DEFAULT 0,
    reserved_quantity DECIMAL(12,2) DEFAULT 0, -- Reserved for production/sales
    available_quantity DECIMAL(12,2) GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
    min_quantity DECIMAL(12,2) DEFAULT 0,
    max_quantity DECIMAL(12,2),
    reorder_point DECIMAL(12,2),
    last_movement_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, item_id, warehouse_id, location_id, category)
);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_tenant ON inventory_stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_item ON inventory_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_warehouse ON inventory_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_category ON inventory_stock(category);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_low_stock ON inventory_stock(available_quantity) WHERE available_quantity <= reorder_point;

-- Create stock_movements table (all inventory transactions)
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    movement_number VARCHAR(50) UNIQUE NOT NULL,
    movement_type stock_movement_type NOT NULL,
    item_id UUID NOT NULL,
    uid VARCHAR(100), -- UID being moved (if applicable)
    from_warehouse_id UUID REFERENCES warehouses(id),
    from_location_id UUID REFERENCES storage_locations(id),
    to_warehouse_id UUID REFERENCES warehouses(id),
    to_location_id UUID REFERENCES storage_locations(id),
    quantity DECIMAL(12,2) NOT NULL,
    reference_type VARCHAR(50), -- 'GRN', 'PRODUCTION_ORDER', 'SALES_ORDER', 'DEMO', 'SERVICE_TICKET'
    reference_id UUID, -- ID of the related document
    reference_number VARCHAR(50),
    batch_number VARCHAR(50),
    movement_date TIMESTAMP DEFAULT NOW(),
    notes TEXT,
    moved_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON stock_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_uid ON stock_movements(uid);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(movement_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);

-- Create demo_inventory table (demo stock tracking per FRS Section 3.2)
CREATE TABLE IF NOT EXISTS demo_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    demo_id VARCHAR(50) UNIQUE NOT NULL,
    uid VARCHAR(100) NOT NULL, -- Product UID issued as demo
    item_id UUID NOT NULL,
    issued_to_staff_id UUID NOT NULL,
    customer_name VARCHAR(200),
    customer_contact VARCHAR(100),
    issue_date DATE NOT NULL,
    expected_return_date DATE,
    actual_return_date DATE,
    status VARCHAR(50) DEFAULT 'ISSUED', -- ISSUED, RETURNED, SOLD, DAMAGED
    warehouse_id UUID REFERENCES warehouses(id),
    demo_expenses DECIMAL(15,2) DEFAULT 0, -- Travel, transport costs
    inspection_notes TEXT,
    converted_to_sale BOOLEAN DEFAULT false,
    sales_order_id UUID, -- If demo converted to sale
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_inventory_tenant ON demo_inventory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_demo_inventory_uid ON demo_inventory(uid);
CREATE INDEX IF NOT EXISTS idx_demo_inventory_staff ON demo_inventory(issued_to_staff_id);
CREATE INDEX IF NOT EXISTS idx_demo_inventory_status ON demo_inventory(status);
CREATE INDEX IF NOT EXISTS idx_demo_inventory_demo_id ON demo_inventory(demo_id);

-- Create stock_reservations table (for production/sales orders)
CREATE TABLE IF NOT EXISTS stock_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    item_id UUID NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    reserved_quantity DECIMAL(12,2) NOT NULL,
    reference_type VARCHAR(50) NOT NULL, -- 'PRODUCTION_ORDER', 'SALES_ORDER'
    reference_id UUID NOT NULL,
    reference_number VARCHAR(50),
    reserved_at TIMESTAMP DEFAULT NOW(),
    reserved_by UUID NOT NULL,
    expires_at TIMESTAMP,
    released BOOLEAN DEFAULT false,
    released_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_tenant ON stock_reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_item ON stock_reservations(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_warehouse ON stock_reservations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_reference ON stock_reservations(reference_type, reference_id);

-- Create inventory_alerts table (low stock, UID discrepancy alerts)
CREATE TABLE IF NOT EXISTS inventory_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    alert_type VARCHAR(50) NOT NULL, -- LOW_STOCK, UID_DISCREPANCY, EXPIRY_WARNING, NEGATIVE_STOCK
    item_id UUID NOT NULL,
    warehouse_id UUID REFERENCES warehouses(id),
    current_quantity DECIMAL(12,2),
    threshold_quantity DECIMAL(12,2),
    message TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, CRITICAL
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_by UUID,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_alerts_tenant ON inventory_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_item ON inventory_alerts(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_acknowledged ON inventory_alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_severity ON inventory_alerts(severity);

-- Add comments
COMMENT ON TABLE warehouses IS 'Physical warehouse locations (Kolkata, Visakhapatnam, etc.)';
COMMENT ON TABLE storage_locations IS 'Specific storage locations within warehouses (Aisle-Rack-Bin)';
COMMENT ON TABLE inventory_stock IS 'Current stock levels per item-warehouse-location with min/max thresholds';
COMMENT ON TABLE stock_movements IS 'Complete history of all stock transactions with UID tracking';
COMMENT ON TABLE demo_inventory IS 'Demo stock issued to staff with customer details and expense tracking';
COMMENT ON TABLE stock_reservations IS 'Reserved stock for production orders or sales orders';
COMMENT ON TABLE inventory_alerts IS 'Low stock and UID discrepancy alerts per FRS Section 3.2';

COMMENT ON COLUMN inventory_stock.available_quantity IS 'Auto-calculated: quantity - reserved_quantity';
COMMENT ON COLUMN stock_movements.uid IS 'UID of the specific item being moved (for UID-tracked items)';
COMMENT ON COLUMN demo_inventory.demo_expenses IS 'Travel, transport costs attributed to demo (auto-linked to sale if converted)';
COMMENT ON COLUMN stock_movements.movement_type IS 'Type of movement: GRN_RECEIPT, PRODUCTION_ISSUE, SALES_ISSUE, DEMO_ISSUE, etc.';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Inventory/Stores tables created successfully with UID tracking and demo management';
END $$;
