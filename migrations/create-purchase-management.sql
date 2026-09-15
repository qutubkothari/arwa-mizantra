-- Migration: Create Vendors and Purchase tables
-- Description: Complete purchase management structure for vendor master, PRs, POs
-- Date: 2025-11-27
-- Per FRS Section 3.3

-- Create vendor status enum
DO $$ BEGIN
    CREATE TYPE vendor_status AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'PENDING_APPROVAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create vendor category enum
DO $$ BEGIN
    CREATE TYPE vendor_category AS ENUM ('RAW_MATERIAL', 'COMPONENTS', 'SUBCONTRACTOR', 'SERVICE', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create payment terms enum
DO $$ BEGIN
    CREATE TYPE payment_terms_type AS ENUM ('ADVANCE', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'COD', 'CUSTOM');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create PR/PO status enum
DO $$ BEGIN
    CREATE TYPE pr_po_status AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create vendors table
CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(200),
    tax_id VARCHAR(50),
    category vendor_category,
    rating DECIMAL(3,2) DEFAULT 0, -- Vendor quality rating (0-5)
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

CREATE INDEX IF NOT EXISTS idx_vendors_tenant ON vendors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendors_code ON vendors(code);
CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category);
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(is_active);

-- Create purchase_requisitions table
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

-- Create purchase_requisition_items table
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

-- Create purchase_orders table
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

-- Create purchase_order_items table
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

-- Create items master table (if not exists - for reference)
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

-- Create warehouses table (if not exists - for reference)
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

-- Add comments
COMMENT ON TABLE vendors IS 'Vendor master for purchase management with quality ratings';
COMMENT ON TABLE purchase_requisitions IS 'Internal purchase requisitions from departments';
COMMENT ON TABLE purchase_requisition_items IS 'Line items for purchase requisitions';
COMMENT ON TABLE purchase_orders IS 'Purchase orders issued to vendors';
COMMENT ON TABLE purchase_order_items IS 'Line items for purchase orders with pricing';
COMMENT ON TABLE items IS 'Item master for inventory and purchase management';
COMMENT ON TABLE warehouses IS 'Warehouse/location master for inventory storage';

COMMENT ON COLUMN vendors.rating IS 'Vendor quality rating (0-5) based on inspection results';
COMMENT ON COLUMN vendors.credit_limit IS 'Maximum credit limit allowed for vendor';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Purchase Management tables created successfully: vendors, PRs, POs, items, warehouses';
END $$;
