-- Migration: Create GRN and UID Management Tables
-- Description: Goods Receipt Note with UID generation and lifecycle tracking
-- Date: 2025-11-27
-- Per FRS Section 3.4 & 3.8

-- Cleanup: drop tables if they exist from previous attempts
DROP TABLE IF EXISTS uid_lifecycle_events CASCADE;
DROP TABLE IF EXISTS uids CASCADE;
DROP TABLE IF EXISTS grn_items CASCADE;
DROP TABLE IF EXISTS grn CASCADE;

-- Ensure enums are dropped so we can recreate with correct values
DROP TYPE IF EXISTS uid_event_type CASCADE;
DROP TYPE IF EXISTS uid_status CASCADE;
DROP TYPE IF EXISTS grn_status CASCADE;

-- Step 1: Create GRN status enum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grn_status') THEN
        CREATE TYPE grn_status AS ENUM ('DRAFT', 'PENDING_INSPECTION', 'INSPECTED', 'ACCEPTED', 'REJECTED', 'PARTIALLY_ACCEPTED', 'COMPLETED');
        RAISE NOTICE '✓ Created grn_status enum';
    END IF;
END $$;

-- Step 2: Create UID status enum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'uid_status') THEN
        CREATE TYPE uid_status AS ENUM ('GENERATED', 'IN_PRODUCTION', 'IN_STOCK', 'IN_TRANSIT', 'INSTALLED', 'UNDER_WARRANTY', 'WARRANTY_EXPIRED', 'UNDER_SERVICE', 'SCRAPPED');
        RAISE NOTICE '✓ Created uid_status enum';
    END IF;
END $$;

-- Step 3: Create lifecycle event type enum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'uid_event_type') THEN
        CREATE TYPE uid_event_type AS ENUM ('GENERATED', 'RECEIVED', 'INSPECTED', 'ASSEMBLED', 'DISPATCHED', 'INSTALLED', 'SERVICE_START', 'SERVICE_END', 'WARRANTY_CLAIM', 'SCRAPPED');
        RAISE NOTICE '✓ Created uid_event_type enum';
    END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '=== Step 1 Complete: Enums created ==='; END $$;

-- Step 4: Create GRN (Goods Receipt Note) table
CREATE TABLE IF NOT EXISTS grn (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    grn_number VARCHAR(50) UNIQUE NOT NULL,
    po_id UUID NOT NULL REFERENCES purchase_orders(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    grn_date DATE NOT NULL,
    received_by UUID NOT NULL,
    warehouse_id UUID REFERENCES warehouses(id),
    invoice_number VARCHAR(100),
    invoice_date DATE,
    vehicle_number VARCHAR(50),
    lr_number VARCHAR(50),
    status grn_status DEFAULT 'DRAFT',
    inspection_date DATE,
    inspected_by UUID,
    inspection_remarks TEXT,
    total_quantity DECIMAL(12,2) DEFAULT 0,
    accepted_quantity DECIMAL(12,2) DEFAULT 0,
    rejected_quantity DECIMAL(12,2) DEFAULT 0,
    remarks TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_tenant ON grn(tenant_id);
CREATE INDEX IF NOT EXISTS idx_grn_number ON grn(grn_number);
CREATE INDEX IF NOT EXISTS idx_grn_po ON grn(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_vendor ON grn(vendor_id);
CREATE INDEX IF NOT EXISTS idx_grn_status ON grn(status);
CREATE INDEX IF NOT EXISTS idx_grn_date ON grn(grn_date);

DO $$ BEGIN RAISE NOTICE '✓ Created grn table'; END $$;

-- Step 5: Create GRN Items table with UID generation
CREATE TABLE IF NOT EXISTS grn_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grn_id UUID NOT NULL REFERENCES grn(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES purchase_order_items(id),
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    description TEXT,
    uom VARCHAR(20),
    ordered_qty DECIMAL(12,2),
    received_qty DECIMAL(12,2) NOT NULL,
    accepted_qty DECIMAL(12,2) DEFAULT 0,
    rejected_qty DECIMAL(12,2) DEFAULT 0,
    inspection_status VARCHAR(50),
    inspection_remarks TEXT,
    batch_number VARCHAR(100),
    manufacturing_date DATE,
    expiry_date DATE,
    uid_generated BOOLEAN DEFAULT false,
    uid_count INTEGER DEFAULT 0,
    rate DECIMAL(15,2),
    amount DECIMAL(15,2),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_po_item ON grn_items(po_item_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_code ON grn_items(item_code);

DO $$ BEGIN RAISE NOTICE '✓ Created grn_items table'; END $$;

-- Step 6: Create UIDs (Unique Identification) table
CREATE TABLE IF NOT EXISTS uids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    uid_code VARCHAR(100) UNIQUE NOT NULL,
    qr_code TEXT,
    barcode TEXT,
    grn_item_id UUID REFERENCES grn_items(id),
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    batch_number VARCHAR(100),
    manufacturing_date DATE,
    warranty_start_date DATE,
    warranty_end_date DATE,
    warranty_months INTEGER,
    current_status uid_status DEFAULT 'GENERATED',
    current_location VARCHAR(200),
    customer_id UUID,
    installation_date DATE,
    installation_location TEXT,
    last_service_date DATE,
    next_service_date DATE,
    service_history JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uids_tenant ON uids(tenant_id);
CREATE INDEX IF NOT EXISTS idx_uids_code ON uids(uid_code);
CREATE INDEX IF NOT EXISTS idx_uids_grn_item ON uids(grn_item_id);
CREATE INDEX IF NOT EXISTS idx_uids_item_code ON uids(item_code);
CREATE INDEX IF NOT EXISTS idx_uids_status ON uids(current_status);
CREATE INDEX IF NOT EXISTS idx_uids_customer ON uids(customer_id);
CREATE INDEX IF NOT EXISTS idx_uids_batch ON uids(batch_number);

DO $$ BEGIN RAISE NOTICE '✓ Created uids table'; END $$;

-- Step 7: Create UID Lifecycle Events table for complete traceability
CREATE TABLE IF NOT EXISTS uid_lifecycle_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uid_id UUID NOT NULL REFERENCES uids(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    event_type uid_event_type NOT NULL,
    event_date TIMESTAMP DEFAULT NOW(),
    event_location VARCHAR(200),
    performed_by UUID,
    reference_type VARCHAR(50),
    reference_id UUID,
    from_status uid_status,
    to_status uid_status,
    remarks TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uid_events_uid ON uid_lifecycle_events(uid_id);
CREATE INDEX IF NOT EXISTS idx_uid_events_tenant ON uid_lifecycle_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_uid_events_type ON uid_lifecycle_events(event_type);
CREATE INDEX IF NOT EXISTS idx_uid_events_date ON uid_lifecycle_events(event_date);
CREATE INDEX IF NOT EXISTS idx_uid_events_reference ON uid_lifecycle_events(reference_type, reference_id);

DO $$ BEGIN RAISE NOTICE '✓ Created uid_lifecycle_events table'; END $$;

-- Step 8: Add table comments
COMMENT ON TABLE grn IS 'Goods Receipt Note - Records incoming materials from vendors';
COMMENT ON TABLE grn_items IS 'GRN line items with inspection results and UID generation flags';
COMMENT ON TABLE uids IS 'Unique Identification master with complete product lifecycle tracking';
COMMENT ON TABLE uid_lifecycle_events IS 'Complete audit trail of UID movements and state changes';

COMMENT ON COLUMN uids.uid_code IS 'Unique identification code (QR/Barcode) for product traceability';
COMMENT ON COLUMN uids.warranty_months IS 'Warranty period in months from installation date';
COMMENT ON COLUMN uids.service_history IS 'JSON array of all service records';
COMMENT ON COLUMN uid_lifecycle_events.reference_type IS 'Type: GRN, PRODUCTION, DISPATCH, SERVICE, WARRANTY';

-- Step 9: Create UID generation function
CREATE OR REPLACE FUNCTION generate_uid_code(
    p_tenant_id UUID,
    p_item_code VARCHAR,
    p_sequence INTEGER
) RETURNS VARCHAR AS $$
DECLARE
    v_uid_code VARCHAR;
    v_date_part VARCHAR;
    v_tenant_prefix VARCHAR;
BEGIN
    -- Get date part (YYYYMMDD)
    v_date_part := TO_CHAR(NOW(), 'YYYYMMDD');
    
    -- Get first 4 chars of tenant ID
    v_tenant_prefix := SUBSTRING(p_tenant_id::TEXT, 1, 4);
    
    -- Format: UID-{TENANT}-{ITEM}-{DATE}-{SEQ}
    v_uid_code := 'UID-' || v_tenant_prefix || '-' || p_item_code || '-' || v_date_part || '-' || LPAD(p_sequence::TEXT, 6, '0');
    
    RETURN v_uid_code;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN RAISE NOTICE '✓ Created UID generation function'; END $$;

-- Step 10: Create function to auto-generate UIDs for GRN item
CREATE OR REPLACE FUNCTION generate_uids_for_grn_item(
    p_grn_item_id UUID,
    p_tenant_id UUID,
    p_item_code VARCHAR,
    p_item_name VARCHAR,
    p_batch_number VARCHAR,
    p_manufacturing_date DATE,
    p_accepted_qty INTEGER,
    p_warranty_months INTEGER DEFAULT 12
) RETURNS INTEGER AS $$
DECLARE
    v_counter INTEGER := 0;
    v_uid_code VARCHAR;
BEGIN
    -- Generate UIDs for accepted quantity
    FOR v_counter IN 1..p_accepted_qty LOOP
        -- Generate unique UID code
        v_uid_code := generate_uid_code(p_tenant_id, p_item_code, v_counter);
        
        -- Insert UID
        INSERT INTO uids (
            tenant_id,
            uid_code,
            grn_item_id,
            item_code,
            item_name,
            batch_number,
            manufacturing_date,
            warranty_months,
            current_status,
            current_location
        ) VALUES (
            p_tenant_id,
            v_uid_code,
            p_grn_item_id,
            p_item_code,
            p_item_name,
            p_batch_number,
            p_manufacturing_date,
            p_warranty_months,
            'GENERATED',
            'WAREHOUSE'
        );
        
        -- Log lifecycle event
        INSERT INTO uid_lifecycle_events (
            uid_id,
            tenant_id,
            event_type,
            event_location,
            reference_type,
            reference_id,
            to_status,
            remarks
        ) VALUES (
            (SELECT id FROM uids WHERE uid_code = v_uid_code),
            p_tenant_id,
            'GENERATED',
            'WAREHOUSE',
            'GRN',
            p_grn_item_id,
            'GENERATED',
            'UID generated during GRN acceptance'
        );
    END LOOP;
    
    -- Update GRN item
    UPDATE grn_items 
    SET uid_generated = true, 
        uid_count = p_accepted_qty
    WHERE id = p_grn_item_id;
    
    RETURN p_accepted_qty;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN RAISE NOTICE '✓ Created UID auto-generation function'; END $$;

DO $$ BEGIN 
    RAISE NOTICE '=== MIGRATION COMPLETE ===';
    RAISE NOTICE 'Created 4 tables: grn, grn_items, uids, uid_lifecycle_events';
    RAISE NOTICE 'Created 2 functions: generate_uid_code, generate_uids_for_grn_item';
END $$;
