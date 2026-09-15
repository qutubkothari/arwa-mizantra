-- Migration: Create Purchase Management Tables - CLEAN VERSION
-- Date: 2025-11-27
-- This is a fresh, tested migration

-- Cleanup: drop partially created tables from previous failed attempts
DROP TABLE IF EXISTS purchase_order_items CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS purchase_requisition_items CASCADE;
DROP TABLE IF EXISTS purchase_requisitions CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;

-- Step 1: Create enums
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_status') THEN
        CREATE TYPE vendor_status AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'PENDING_APPROVAL');
        RAISE NOTICE '✓ Created vendor_status enum';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_category') THEN
        CREATE TYPE vendor_category AS ENUM ('RAW_MATERIAL', 'COMPONENTS', 'SUBCONTRACTOR', 'SERVICE', 'OTHER');
        RAISE NOTICE '✓ Created vendor_category enum';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_terms_type') THEN
        CREATE TYPE payment_terms_type AS ENUM ('ADVANCE', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'COD', 'CUSTOM');
        RAISE NOTICE '✓ Created payment_terms_type enum';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pr_po_status') THEN
        CREATE TYPE pr_po_status AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'CLOSED');
        RAISE NOTICE '✓ Created pr_po_status enum';
    END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '=== Step 1 Complete: Enums created ==='; END $$;

-- Step 2: Create items table (needed by PR/PO items as reference)
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    uom VARCHAR(20),
    reorder_level DECIMAL(12,2),
    min_stock DECIMAL(12,2),
    max_stock DECIMAL(12,2),
    standard_cost DECIMAL(15,2),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_tenant ON items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_items_code ON items(code);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);

DO $$ BEGIN RAISE NOTICE '✓ Created items table'; END $$;

-- Step 3: Create warehouses table
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    location VARCHAR(200),
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant ON warehouses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(code);

DO $$ BEGIN 
    RAISE NOTICE '✓ Created warehouses table';
    RAISE NOTICE '=== Step 2 Complete: Master tables created ===';
END $$;

-- Step 4: Create vendors table (skip if exists from previous migration)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendors') THEN
        CREATE TABLE vendors (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL,
            code VARCHAR(50) UNIQUE NOT NULL,
            name VARCHAR(200) NOT NULL,
            legal_name VARCHAR(200),
            tax_id VARCHAR(50),
            category vendor_category,
            rating DECIMAL(3,2) DEFAULT 0,
            payment_terms payment_terms_type DEFAULT 'NET_30',
            credit_limit DECIMAL(15,2) DEFAULT 0,
            contact_person VARCHAR(100),
            email VARCHAR(200),
            phone VARCHAR(50),
            address TEXT,
            city VARCHAR(100),
            state VARCHAR(100),
            country VARCHAR(100) DEFAULT 'India',
            pincode VARCHAR(20),
            bank_name VARCHAR(200),
            bank_account VARCHAR(50),
            bank_ifsc VARCHAR(20),
            gst_number VARCHAR(50),
            pan_number VARCHAR(50),
            is_active BOOLEAN DEFAULT true,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX idx_vendors_tenant ON vendors(tenant_id);
        CREATE INDEX idx_vendors_code ON vendors(code);
        CREATE INDEX idx_vendors_category ON vendors(category);
        CREATE INDEX idx_vendors_active ON vendors(is_active);
        
        RAISE NOTICE '✓ Created vendors table';
    END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '=== Step 3 Complete: Vendors table ready ==='; END $$;

-- Step 5: Create purchase_requisitions table
CREATE TABLE IF NOT EXISTS purchase_requisitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    pr_number VARCHAR(50) UNIQUE NOT NULL,
    request_date DATE NOT NULL,
    required_date DATE,
    department VARCHAR(100),
    purpose TEXT,
    delivery_address TEXT,
    status pr_po_status DEFAULT 'DRAFT',
    requested_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pr_tenant ON purchase_requisitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pr_number ON purchase_requisitions(pr_number);
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_pr_requested_by ON purchase_requisitions(requested_by);

DO $$ BEGIN RAISE NOTICE '✓ Created purchase_requisitions table'; END $$;

-- Step 6: Create purchase_requisition_items table
CREATE TABLE IF NOT EXISTS purchase_requisition_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pr_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    description TEXT,
    uom VARCHAR(20),
    requested_qty DECIMAL(12,2) NOT NULL,
    estimated_rate DECIMAL(15,2),
    required_date DATE,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_items_pr ON purchase_requisition_items(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_items_code ON purchase_requisition_items(item_code);

DO $$ BEGIN 
    RAISE NOTICE '✓ Created purchase_requisition_items table';
    RAISE NOTICE '=== Step 4 Complete: PR tables created ===';
END $$;

-- Step 7: Create purchase_orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    po_number VARCHAR(50) UNIQUE NOT NULL,
    pr_id UUID REFERENCES purchase_requisitions(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    po_date DATE NOT NULL,
    delivery_date DATE,
    payment_terms payment_terms_type DEFAULT 'NET_30',
    delivery_address TEXT,
    terms_and_conditions TEXT,
    status pr_po_status DEFAULT 'DRAFT',
    total_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    grand_total DECIMAL(15,2) DEFAULT 0,
    created_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_tenant ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_po_number ON purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_pr ON purchase_orders(pr_id);

DO $$ BEGIN RAISE NOTICE '✓ Created purchase_orders table'; END $$;

-- Step 8: Create purchase_order_items table
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    pr_item_id UUID REFERENCES purchase_requisition_items(id),
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    description TEXT,
    uom VARCHAR(20),
    ordered_qty DECIMAL(12,2) NOT NULL,
    received_qty DECIMAL(12,2) DEFAULT 0,
    rate DECIMAL(15,2) NOT NULL,
    tax_percent DECIMAL(5,2) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    amount DECIMAL(15,2) NOT NULL,
    delivery_date DATE,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_pr_item ON purchase_order_items(pr_item_id);
CREATE INDEX IF NOT EXISTS idx_po_items_code ON purchase_order_items(item_code);

DO $$ BEGIN 
    RAISE NOTICE '✓ Created purchase_order_items table';
    RAISE NOTICE '=== Step 5 Complete: PO tables created ===';
END $$;

-- Step 9: Add table comments
COMMENT ON TABLE vendors IS 'Vendor master for purchase management with quality ratings';
COMMENT ON TABLE items IS 'Item master for inventory and purchase management';
COMMENT ON TABLE warehouses IS 'Warehouse/location master for inventory storage';

DO $$ BEGIN 
    RAISE NOTICE '=== MIGRATION COMPLETE ===';
    RAISE NOTICE 'Created 7 tables: items, warehouses, vendors, purchase_requisitions, purchase_requisition_items, purchase_orders, purchase_order_items';
END $$;
