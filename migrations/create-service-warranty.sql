-- Migration: Create Service & Warranty Management tables
-- Description: Customer complaints, warranty validation, service assignments, spare parts tracking
-- Date: 2025-11-27
-- Per FRS Section 3.7: Service with warranty validation, technician assignment, spare parts linkage

-- Create service ticket status enum
DO $$ BEGIN
    CREATE TYPE service_ticket_status AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PARTS_PENDING', 'COMPLETED', 'CLOSED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create service ticket priority enum
DO $$ BEGIN
    CREATE TYPE service_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create service type enum
DO $$ BEGIN
    CREATE TYPE service_type AS ENUM ('WARRANTY', 'PAID', 'AMC', 'INSTALLATION', 'PREVENTIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create service_tickets table (centralized complaint logging)
CREATE TABLE IF NOT EXISTS service_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    uid VARCHAR(100), -- UID of the product (optional if general complaint)
    warranty_id UUID REFERENCES warranties(id),
    service_type service_type DEFAULT 'PAID',
    priority service_priority DEFAULT 'MEDIUM',
    status service_ticket_status DEFAULT 'OPEN',
    
    -- Complaint details
    complaint_date DATE NOT NULL,
    complaint_description TEXT NOT NULL,
    reported_by VARCHAR(200), -- Customer contact person
    contact_number VARCHAR(50),
    email VARCHAR(200),
    
    -- Product details
    product_name VARCHAR(200),
    model_number VARCHAR(100),
    serial_number VARCHAR(100),
    installation_date DATE,
    
    -- Location
    service_location TEXT, -- Where service needs to be performed
    
    -- Warranty validation
    is_under_warranty BOOLEAN DEFAULT false,
    warranty_valid_until DATE,
    
    -- Service details
    expected_completion_date DATE,
    actual_completion_date DATE,
    resolution_description TEXT,
    
    -- Costs
    estimated_cost DECIMAL(15,2) DEFAULT 0,
    actual_cost DECIMAL(15,2) DEFAULT 0,
    parts_cost DECIMAL(15,2) DEFAULT 0,
    labor_cost DECIMAL(15,2) DEFAULT 0,
    
    -- Approval for paid services
    quote_approved BOOLEAN DEFAULT false,
    approved_by UUID,
    approved_at TIMESTAMP,
    
    -- Closure
    closed_by UUID,
    closed_at TIMESTAMP,
    customer_feedback TEXT,
    customer_rating INTEGER, -- 1-5 rating
    
    created_by UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_tickets_tenant ON service_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_customer ON service_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_uid ON service_tickets(uid);
CREATE INDEX IF NOT EXISTS idx_service_tickets_warranty ON service_tickets(warranty_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_status ON service_tickets(status);
CREATE INDEX IF NOT EXISTS idx_service_tickets_priority ON service_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_service_tickets_type ON service_tickets(service_type);
CREATE INDEX IF NOT EXISTS idx_service_tickets_number ON service_tickets(ticket_number);

-- Create technicians table (can be linked to HR module later)
CREATE TABLE IF NOT EXISTS technicians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    technician_code VARCHAR(50) UNIQUE NOT NULL,
    technician_name VARCHAR(200) NOT NULL,
    employee_id UUID, -- Link to HR module if exists
    specialization TEXT, -- Areas of expertise
    contact_number VARCHAR(50),
    email VARCHAR(200),
    is_active BOOLEAN DEFAULT true,
    
    -- Performance metrics
    total_assignments INTEGER DEFAULT 0,
    completed_services INTEGER DEFAULT 0,
    average_rating DECIMAL(3,2) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_technicians_tenant ON technicians(tenant_id);
CREATE INDEX IF NOT EXISTS idx_technicians_code ON technicians(technician_code);
CREATE INDEX IF NOT EXISTS idx_technicians_active ON technicians(is_active);

-- Create service_assignments table (technician assignment & workflow)
CREATE TABLE IF NOT EXISTS service_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_ticket_id UUID NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES technicians(id),
    
    assigned_date TIMESTAMP NOT NULL,
    assigned_by UUID NOT NULL,
    
    scheduled_start_date DATE,
    scheduled_end_date DATE,
    
    actual_start_date TIMESTAMP,
    actual_end_date TIMESTAMP,
    
    status VARCHAR(50) DEFAULT 'ASSIGNED', -- ASSIGNED, ACCEPTED, IN_PROGRESS, COMPLETED, REASSIGNED
    
    work_notes TEXT, -- Technician's work log
    technician_remarks TEXT,
    
    travel_distance DECIMAL(10,2), -- KMs traveled
    travel_cost DECIMAL(15,2) DEFAULT 0,
    
    -- Customer feedback for this assignment
    customer_satisfaction INTEGER, -- 1-5 rating
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_assignments_ticket ON service_assignments(service_ticket_id);
CREATE INDEX IF NOT EXISTS idx_service_assignments_technician ON service_assignments(technician_id);
CREATE INDEX IF NOT EXISTS idx_service_assignments_status ON service_assignments(status);

-- Create service_parts_used table (spare parts & replacement with new UID linkage)
CREATE TABLE IF NOT EXISTS service_parts_used (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_ticket_id UUID NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
    service_assignment_id UUID REFERENCES service_assignments(id),
    
    part_id UUID NOT NULL, -- Link to items/inventory
    part_name VARCHAR(200) NOT NULL,
    part_code VARCHAR(100),
    
    -- Old part removed
    old_part_uid VARCHAR(100), -- UID of defective part removed
    old_part_condition VARCHAR(50), -- DEFECTIVE, WORN_OUT, DAMAGED, etc.
    
    -- New part installed
    new_part_uid VARCHAR(100), -- UID of new part installed (generates new UID in registry)
    new_part_batch VARCHAR(50),
    new_part_serial VARCHAR(50),
    
    quantity DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    total_cost DECIMAL(15,2) NOT NULL,
    
    -- Warranty for replaced part
    replacement_warranty_months INTEGER DEFAULT 6,
    replacement_warranty_start DATE,
    replacement_warranty_end DATE,
    
    charged_to_customer BOOLEAN DEFAULT true, -- false if under warranty
    
    notes TEXT,
    
    used_date TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_parts_ticket ON service_parts_used(service_ticket_id);
CREATE INDEX IF NOT EXISTS idx_service_parts_assignment ON service_parts_used(service_assignment_id);
CREATE INDEX IF NOT EXISTS idx_service_parts_old_uid ON service_parts_used(old_part_uid);
CREATE INDEX IF NOT EXISTS idx_service_parts_new_uid ON service_parts_used(new_part_uid);

-- Create service_history table (comprehensive service log for each UID)
CREATE TABLE IF NOT EXISTS service_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    uid VARCHAR(100) NOT NULL, -- Product UID
    service_ticket_id UUID NOT NULL REFERENCES service_tickets(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    
    service_date DATE NOT NULL,
    service_type service_type NOT NULL,
    
    issue_description TEXT,
    resolution_description TEXT,
    
    technician_id UUID REFERENCES technicians(id),
    technician_name VARCHAR(200),
    
    parts_replaced TEXT, -- Summary of parts replaced
    total_cost DECIMAL(15,2) DEFAULT 0,
    
    next_service_due_date DATE, -- For preventive maintenance
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_history_tenant ON service_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_history_uid ON service_history(uid);
CREATE INDEX IF NOT EXISTS idx_service_history_ticket ON service_history(service_ticket_id);
CREATE INDEX IF NOT EXISTS idx_service_history_customer ON service_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_history_date ON service_history(service_date);

-- Create service_feedback table (detailed customer feedback)
CREATE TABLE IF NOT EXISTS service_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_ticket_id UUID NOT NULL REFERENCES service_tickets(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    
    overall_rating INTEGER NOT NULL, -- 1-5
    technician_rating INTEGER, -- 1-5
    response_time_rating INTEGER, -- 1-5
    quality_rating INTEGER, -- 1-5
    
    feedback_text TEXT,
    suggestions TEXT,
    
    would_recommend BOOLEAN,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_feedback_ticket ON service_feedback(service_ticket_id);
CREATE INDEX IF NOT EXISTS idx_service_feedback_customer ON service_feedback(customer_id);

-- Create preventive_maintenance_schedule table
CREATE TABLE IF NOT EXISTS preventive_maintenance_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    uid VARCHAR(100) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    
    schedule_name VARCHAR(200) NOT NULL,
    frequency_days INTEGER NOT NULL, -- Every X days
    last_service_date DATE,
    next_service_date DATE NOT NULL,
    
    service_checklist TEXT, -- Tasks to perform
    
    is_active BOOLEAN DEFAULT true,
    
    -- Notifications
    notify_before_days INTEGER DEFAULT 7,
    last_notification_sent TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_schedule_tenant ON preventive_maintenance_schedule(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedule_uid ON preventive_maintenance_schedule(uid);
CREATE INDEX IF NOT EXISTS idx_pm_schedule_customer ON preventive_maintenance_schedule(customer_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedule_next_date ON preventive_maintenance_schedule(next_service_date);
CREATE INDEX IF NOT EXISTS idx_pm_schedule_active ON preventive_maintenance_schedule(is_active);

-- Add comments
COMMENT ON TABLE service_tickets IS 'Customer complaint/service request logging with warranty validation per FRS Section 3.7';
COMMENT ON TABLE technicians IS 'Service technicians with specialization and performance metrics';
COMMENT ON TABLE service_assignments IS 'Technician assignment and service workflow tracking';
COMMENT ON TABLE service_parts_used IS 'Spare parts used in service with old/new UID linkage for traceability';
COMMENT ON TABLE service_history IS 'Comprehensive service history for each product UID';
COMMENT ON TABLE service_feedback IS 'Customer feedback and ratings for service quality';
COMMENT ON TABLE preventive_maintenance_schedule IS 'Preventive maintenance scheduling for products';

COMMENT ON COLUMN service_tickets.is_under_warranty IS 'Auto-validated from warranties table by UID';
COMMENT ON COLUMN service_parts_used.old_part_uid IS 'UID of defective part removed during service';
COMMENT ON COLUMN service_parts_used.new_part_uid IS 'UID of replacement part installed (creates new UID entry)';
COMMENT ON COLUMN service_parts_used.charged_to_customer IS 'False if covered under warranty, true if paid service';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Service & Warranty Management tables created successfully with UID traceability and technician workflow';
END $$;
