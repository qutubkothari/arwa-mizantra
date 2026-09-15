-- Migration: Create Sales & Dispatch Management tables
-- Description: Quotations, sales orders, dispatch, and warranty tracking with UID linkage
-- Date: 2025-11-27
-- Per FRS Section 3.6: Sales, dispatch, warranty documentation with UID tracking

-- Create quotation status enum
DO $$ BEGIN
    CREATE TYPE quotation_status AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'EXPIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create sales order status enum
DO $$ BEGIN
    CREATE TYPE sales_order_status AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_DISPATCH', 'DISPATCHED', 'DELIVERED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create warranty status enum
DO $$ BEGIN
    CREATE TYPE warranty_status AS ENUM ('ACTIVE', 'EXPIRED', 'CLAIMED', 'VOID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create or update customers table
DO $$ 
BEGIN
    -- Create table if it doesn't exist
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'customers') THEN
        CREATE TABLE customers (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL,
            customer_code VARCHAR(50) UNIQUE NOT NULL,
            customer_name VARCHAR(200) NOT NULL,
            customer_type VARCHAR(50) DEFAULT 'REGULAR',
            contact_person VARCHAR(200),
            email VARCHAR(200),
            phone VARCHAR(50),
            mobile VARCHAR(50),
            gst_number VARCHAR(50),
            pan_number VARCHAR(50),
            billing_address TEXT,
            shipping_address TEXT,
            city VARCHAR(100),
            state VARCHAR(100),
            country VARCHAR(100) DEFAULT 'India',
            pincode VARCHAR(20),
            credit_limit DECIMAL(15,2) DEFAULT 0,
            credit_days INTEGER DEFAULT 30,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    ELSE
        -- Add missing columns if table exists
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'customer_code') THEN
            ALTER TABLE customers ADD COLUMN customer_code VARCHAR(50) UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'customer_name') THEN
            ALTER TABLE customers ADD COLUMN customer_name VARCHAR(200) NOT NULL DEFAULT 'Unknown Customer';
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'customer_type') THEN
            ALTER TABLE customers ADD COLUMN customer_type VARCHAR(50) DEFAULT 'REGULAR';
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'contact_person') THEN
            ALTER TABLE customers ADD COLUMN contact_person VARCHAR(200);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'gst_number') THEN
            ALTER TABLE customers ADD COLUMN gst_number VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'pan_number') THEN
            ALTER TABLE customers ADD COLUMN pan_number VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'billing_address') THEN
            ALTER TABLE customers ADD COLUMN billing_address TEXT;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'shipping_address') THEN
            ALTER TABLE customers ADD COLUMN shipping_address TEXT;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'city') THEN
            ALTER TABLE customers ADD COLUMN city VARCHAR(100);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'state') THEN
            ALTER TABLE customers ADD COLUMN state VARCHAR(100);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'country') THEN
            ALTER TABLE customers ADD COLUMN country VARCHAR(100) DEFAULT 'India';
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'pincode') THEN
            ALTER TABLE customers ADD COLUMN pincode VARCHAR(20);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'credit_limit') THEN
            ALTER TABLE customers ADD COLUMN credit_limit DECIMAL(15,2) DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'credit_days') THEN
            ALTER TABLE customers ADD COLUMN credit_days INTEGER DEFAULT 30;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'is_active') THEN
            ALTER TABLE customers ADD COLUMN is_active BOOLEAN DEFAULT true;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(customer_type);

-- Create quotations table
CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    quotation_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    quotation_date DATE NOT NULL,
    valid_until DATE,
    status quotation_status DEFAULT 'DRAFT',
    total_amount DECIMAL(15,2) DEFAULT 0,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    net_amount DECIMAL(15,2) DEFAULT 0,
    payment_terms TEXT,
    delivery_terms TEXT,
    notes TEXT,
    terms_conditions TEXT,
    created_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP,
    rejected_reason TEXT,
    converted_to_so_id UUID,
    converted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotations_tenant ON quotations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_number ON quotations(quotation_number);

-- Create quotation_items table
CREATE TABLE IF NOT EXISTS quotation_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    item_description TEXT,
    quantity DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_percentage DECIMAL(5,2) DEFAULT 18,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    line_total DECIMAL(15,2) NOT NULL,
    delivery_days INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_item ON quotation_items(item_id);

-- Create sales_orders table
CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    so_number VARCHAR(50) UNIQUE NOT NULL,
    quotation_id UUID REFERENCES quotations(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    order_date DATE NOT NULL,
    expected_delivery_date DATE,
    status sales_order_status DEFAULT 'DRAFT',
    total_amount DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    net_amount DECIMAL(15,2) DEFAULT 0,
    advance_paid DECIMAL(15,2) DEFAULT 0,
    balance_amount DECIMAL(15,2) DEFAULT 0,
    payment_terms TEXT,
    delivery_terms TEXT,
    billing_address TEXT,
    shipping_address TEXT,
    notes TEXT,
    created_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_tenant ON sales_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_number ON sales_orders(so_number);

-- Create sales_order_items table
CREATE TABLE IF NOT EXISTS sales_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    item_description TEXT,
    quantity DECIMAL(12,2) NOT NULL,
    dispatched_quantity DECIMAL(12,2) DEFAULT 0,
    pending_quantity DECIMAL(12,2) GENERATED ALWAYS AS (quantity - dispatched_quantity) STORED,
    unit_price DECIMAL(15,2) NOT NULL,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_percentage DECIMAL(5,2) DEFAULT 18,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    line_total DECIMAL(15,2) NOT NULL,
    production_order_id UUID,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_so_items_so ON sales_order_items(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_so_items_item ON sales_order_items(item_id);

-- Create dispatch_notes table
CREATE TABLE IF NOT EXISTS dispatch_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    dn_number VARCHAR(50) UNIQUE NOT NULL,
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    dispatch_date DATE NOT NULL,
    transporter_name VARCHAR(200),
    vehicle_number VARCHAR(50),
    lr_number VARCHAR(50),
    lr_date DATE,
    delivery_address TEXT,
    notes TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_notes_tenant ON dispatch_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_notes_so ON dispatch_notes(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_notes_customer ON dispatch_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_notes_number ON dispatch_notes(dn_number);

-- Create dispatch_items table (with UID assignment)
CREATE TABLE IF NOT EXISTS dispatch_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispatch_note_id UUID NOT NULL REFERENCES dispatch_notes(id) ON DELETE CASCADE,
    sales_order_item_id UUID NOT NULL REFERENCES sales_order_items(id),
    item_id UUID NOT NULL,
    uid VARCHAR(100) NOT NULL, -- UID of the dispatched product (links to uid_registry)
    quantity DECIMAL(12,2) NOT NULL,
    batch_number VARCHAR(50),
    serial_number VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_items_dn ON dispatch_items(dispatch_note_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_items_so_item ON dispatch_items(sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_items_uid ON dispatch_items(uid);

-- Create warranties table (per FRS Section 3.6: warranty definition and tracking)
CREATE TABLE IF NOT EXISTS warranties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    warranty_number VARCHAR(50) UNIQUE NOT NULL,
    uid VARCHAR(100) NOT NULL, -- UID of the product under warranty
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id),
    dispatch_item_id UUID REFERENCES dispatch_items(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    item_id UUID NOT NULL,
    warranty_start_date DATE NOT NULL,
    warranty_duration_months INTEGER NOT NULL,
    warranty_end_date DATE NOT NULL,
    warranty_type VARCHAR(50) DEFAULT 'STANDARD', -- STANDARD, EXTENDED, CUSTOM
    covered_components TEXT, -- Components covered under warranty
    warranty_terms TEXT, -- Terms and conditions
    status warranty_status DEFAULT 'ACTIVE',
    claim_count INTEGER DEFAULT 0,
    last_service_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warranties_tenant ON warranties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warranties_uid ON warranties(uid);
CREATE INDEX IF NOT EXISTS idx_warranties_customer ON warranties(customer_id);
CREATE INDEX IF NOT EXISTS idx_warranties_status ON warranties(status);
CREATE INDEX IF NOT EXISTS idx_warranties_number ON warranties(warranty_number);
CREATE INDEX IF NOT EXISTS idx_warranties_end_date ON warranties(warranty_end_date);

-- Create warranty_claims table
CREATE TABLE IF NOT EXISTS warranty_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    claim_number VARCHAR(50) UNIQUE NOT NULL,
    warranty_id UUID NOT NULL REFERENCES warranties(id),
    uid VARCHAR(100) NOT NULL,
    claim_date DATE NOT NULL,
    issue_description TEXT NOT NULL,
    claim_type VARCHAR(50) DEFAULT 'REPAIR', -- REPAIR, REPLACEMENT, REFUND
    claim_status VARCHAR(50) DEFAULT 'SUBMITTED', -- SUBMITTED, APPROVED, REJECTED, COMPLETED
    resolution_date DATE,
    resolution_notes TEXT,
    service_cost DECIMAL(15,2) DEFAULT 0,
    parts_cost DECIMAL(15,2) DEFAULT 0,
    approved_by UUID,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_tenant ON warranty_claims(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_warranty ON warranty_claims(warranty_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_uid ON warranty_claims(uid);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims(claim_status);

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id),
    dispatch_note_id UUID REFERENCES dispatch_notes(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    invoice_date DATE NOT NULL,
    due_date DATE,
    total_amount DECIMAL(15,2) NOT NULL,
    tax_amount DECIMAL(15,2) NOT NULL,
    net_amount DECIMAL(15,2) NOT NULL,
    paid_amount DECIMAL(15,2) DEFAULT 0,
    balance_amount DECIMAL(15,2) NOT NULL,
    payment_status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, PARTIAL, PAID, OVERDUE
    notes TEXT,
    created_by UUID NOT NULL,
    synced_to_tally BOOLEAN DEFAULT false,
    tally_sync_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_so ON invoices(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);

-- Add comments
COMMENT ON TABLE customers IS 'Customer master with contact and credit details';
COMMENT ON TABLE quotations IS 'Sales quotations with approval workflow';
COMMENT ON TABLE sales_orders IS 'Confirmed sales orders from quotations or direct';
COMMENT ON TABLE dispatch_notes IS 'Dispatch/delivery challans with transporter details';
COMMENT ON TABLE dispatch_items IS 'Individual items dispatched with UID assignment (links product to customer)';
COMMENT ON TABLE warranties IS 'Warranty certificates with start date, duration, and coverage per FRS Section 3.6';
COMMENT ON TABLE warranty_claims IS 'Warranty claims and service requests';
COMMENT ON TABLE invoices IS 'Sales invoices with Tally integration';

COMMENT ON COLUMN dispatch_items.uid IS 'UID of the finished product dispatched to customer (completes UID traceability chain)';
COMMENT ON COLUMN warranties.warranty_start_date IS 'Warranty start date (typically dispatch/invoice date)';
COMMENT ON COLUMN warranties.warranty_duration_months IS 'Warranty period in months';
COMMENT ON COLUMN warranties.warranty_end_date IS 'Warranty expiry date (auto-calculated)';
COMMENT ON COLUMN warranties.covered_components IS 'Components/parts covered under warranty';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Sales & Dispatch tables created successfully with warranty tracking and UID assignment';
END $$;
