-- Migration: Create GRN tables with UID tracking
-- Description: Create complete GRN (Goods Receipt Note) structure with automatic UID assignment
-- Date: 2025-11-27
-- Prerequisites: tenants, users, vendors, items, purchase_orders, warehouses tables must exist

-- Create GRN status enum if not exists
DO $$ BEGIN
    CREATE TYPE grn_status AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create grns table
CREATE TABLE IF NOT EXISTS grns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    grn_number VARCHAR(50) UNIQUE NOT NULL,
    po_id UUID,
    vendor_id UUID NOT NULL,
    receipt_date DATE NOT NULL,
    invoice_number VARCHAR(50),
    invoice_date DATE,
    warehouse_id UUID,
    status grn_status DEFAULT 'DRAFT',
    notes TEXT,
    received_by UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for grns
CREATE INDEX IF NOT EXISTS idx_grn_tenant ON grns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_grn_po ON grns(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_vendor ON grns(vendor_id);
CREATE INDEX IF NOT EXISTS idx_grn_status ON grns(status);
CREATE INDEX IF NOT EXISTS idx_grn_number ON grns(grn_number);

-- Create grn_items table with UID support
CREATE TABLE IF NOT EXISTS grn_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grn_id UUID NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    po_item_id UUID,
    ordered_quantity DECIMAL(12,2),
    received_quantity DECIMAL(12,2) NOT NULL,
    accepted_quantity DECIMAL(12,2) NOT NULL,
    rejected_quantity DECIMAL(12,2) DEFAULT 0,
    unit_price DECIMAL(15,2),
    batch_number VARCHAR(50),
    expiry_date DATE,
    uid VARCHAR(100), -- Auto-generated UID for complete traceability
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for grn_items
CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_item ON grn_items(item_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_uid ON grn_items(uid);

-- Add comments for documentation
COMMENT ON TABLE grns IS 'Goods Receipt Notes - Records all incoming materials and products';
COMMENT ON TABLE grn_items IS 'Individual items received in each GRN with auto-generated UIDs';
COMMENT ON COLUMN grn_items.uid IS 'Auto-generated Unique Identification Number for complete traceability from vendor to customer (Format: UID-SAIF-KOL-RM-000001-A7)';
COMMENT ON COLUMN grn_items.batch_number IS 'Vendor batch/lot number for quality tracking';
COMMENT ON COLUMN grn_items.accepted_quantity IS 'Quantity accepted after quality inspection';
COMMENT ON COLUMN grn_items.rejected_quantity IS 'Quantity rejected due to quality issues';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'GRN tables created successfully with UID tracking enabled';
END $$;
