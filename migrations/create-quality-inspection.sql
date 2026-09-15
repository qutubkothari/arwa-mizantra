-- Migration: Create Quality & Inspection Management tables
-- Description: Incoming, in-process, final inspections with NCR tracking and quality analytics
-- Date: 2025-11-27
-- Per FRS Section 3.5: Quality/Inspection with NCR logging and vendor/process analytics

-- Create inspection type enum
DO $$ BEGIN
    CREATE TYPE inspection_type AS ENUM ('INCOMING', 'IN_PROCESS', 'FINAL', 'AUDIT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create inspection status enum
DO $$ BEGIN
    CREATE TYPE inspection_status AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'CONDITIONAL_PASS', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create NCR status enum
DO $$ BEGIN
    CREATE TYPE ncr_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACTION_PLANNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create quality_inspections table (centralized inspection records)
CREATE TABLE IF NOT EXISTS quality_inspections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    inspection_number VARCHAR(50) UNIQUE NOT NULL,
    inspection_type inspection_type NOT NULL,
    inspection_date DATE NOT NULL,
    status inspection_status DEFAULT 'PENDING',
    
    -- Reference data
    grn_id UUID, -- For incoming inspection
    production_order_id UUID, -- For in-process/final inspection
    uid VARCHAR(100), -- UID being inspected
    item_id UUID NOT NULL,
    item_name VARCHAR(200),
    item_code VARCHAR(100),
    
    -- Vendor/supplier info (for incoming)
    vendor_id UUID,
    vendor_name VARCHAR(200),
    batch_number VARCHAR(50),
    lot_number VARCHAR(50),
    
    -- Quantity
    inspected_quantity DECIMAL(12,2) NOT NULL,
    accepted_quantity DECIMAL(12,2) DEFAULT 0,
    rejected_quantity DECIMAL(12,2) DEFAULT 0,
    
    -- Inspector details
    inspector_id UUID NOT NULL,
    inspector_name VARCHAR(200),
    
    -- Inspection results
    overall_result VARCHAR(50), -- PASS, FAIL, CONDITIONAL
    defect_count INTEGER DEFAULT 0,
    defect_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    
    -- Documentation
    inspection_checklist TEXT, -- Checklist used
    observations TEXT,
    remarks TEXT,
    
    -- Approval
    approved_by UUID,
    approved_at TIMESTAMP,
    
    -- NCR generation
    ncr_generated BOOLEAN DEFAULT false,
    ncr_id UUID,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_inspections_tenant ON quality_inspections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_type ON quality_inspections(inspection_type);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_status ON quality_inspections(status);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_grn ON quality_inspections(grn_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_po ON quality_inspections(production_order_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_uid ON quality_inspections(uid);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_vendor ON quality_inspections(vendor_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_date ON quality_inspections(inspection_date);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_number ON quality_inspections(inspection_number);

-- Create inspection_parameters table (detailed parameter checks)
CREATE TABLE IF NOT EXISTS inspection_parameters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inspection_id UUID NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
    
    parameter_name VARCHAR(200) NOT NULL,
    parameter_type VARCHAR(50), -- VISUAL, DIMENSIONAL, FUNCTIONAL, CHEMICAL, etc.
    
    specification VARCHAR(200), -- Expected value/range
    measured_value VARCHAR(200), -- Actual measured value
    unit_of_measure VARCHAR(50),
    
    tolerance_min DECIMAL(15,4),
    tolerance_max DECIMAL(15,4),
    
    result VARCHAR(50), -- PASS, FAIL, NA
    deviation DECIMAL(15,4), -- Deviation from spec
    
    remarks TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_parameters_inspection ON inspection_parameters(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_parameters_result ON inspection_parameters(result);

-- Create inspection_defects table (defect logging)
CREATE TABLE IF NOT EXISTS inspection_defects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inspection_id UUID NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
    
    defect_code VARCHAR(50),
    defect_description TEXT NOT NULL,
    defect_category VARCHAR(100), -- VISUAL, DIMENSIONAL, FUNCTIONAL, COSMETIC, etc.
    severity VARCHAR(50), -- CRITICAL, MAJOR, MINOR
    
    location VARCHAR(200), -- Where defect was found
    quantity_affected DECIMAL(12,2),
    
    root_cause TEXT,
    corrective_action TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_defects_inspection ON inspection_defects(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_defects_category ON inspection_defects(defect_category);
CREATE INDEX IF NOT EXISTS idx_inspection_defects_severity ON inspection_defects(severity);

-- Create ncr (Non-Conformance Reports) table
CREATE TABLE IF NOT EXISTS ncr (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    ncr_number VARCHAR(50) UNIQUE NOT NULL,
    inspection_id UUID REFERENCES quality_inspections(id),
    
    ncr_date DATE NOT NULL,
    status ncr_status DEFAULT 'OPEN',
    
    -- Non-conformance details
    nonconformance_type VARCHAR(100), -- MATERIAL, PROCESS, PRODUCT, DOCUMENTATION
    description TEXT NOT NULL,
    
    -- Reference data
    item_id UUID,
    item_name VARCHAR(200),
    uid VARCHAR(100),
    vendor_id UUID,
    production_order_id UUID,
    
    quantity_affected DECIMAL(12,2),
    
    -- Root cause analysis
    root_cause TEXT,
    immediate_action TEXT,
    containment_action TEXT,
    
    -- Corrective action
    corrective_action_plan TEXT,
    corrective_action_owner UUID,
    corrective_action_due_date DATE,
    corrective_action_completed_date DATE,
    
    -- Preventive action
    preventive_action_plan TEXT,
    preventive_action_owner UUID,
    
    -- Verification
    verification_required BOOLEAN DEFAULT true,
    verification_date DATE,
    verified_by UUID,
    verification_remarks TEXT,
    
    -- Closure
    closure_date DATE,
    closed_by UUID,
    closure_remarks TEXT,
    
    -- Cost impact
    cost_impact DECIMAL(15,2) DEFAULT 0,
    
    raised_by UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ncr_tenant ON ncr(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ncr_status ON ncr(status);
CREATE INDEX IF NOT EXISTS idx_ncr_inspection ON ncr(inspection_id);
CREATE INDEX IF NOT EXISTS idx_ncr_vendor ON ncr(vendor_id);
CREATE INDEX IF NOT EXISTS idx_ncr_date ON ncr(ncr_date);
CREATE INDEX IF NOT EXISTS idx_ncr_number ON ncr(ncr_number);
CREATE INDEX IF NOT EXISTS idx_ncr_type ON ncr(nonconformance_type);

-- Create quality_parameters_master table (standard quality parameters per item)
CREATE TABLE IF NOT EXISTS quality_parameters_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    item_id UUID NOT NULL,
    item_name VARCHAR(200),
    
    parameter_name VARCHAR(200) NOT NULL,
    parameter_type VARCHAR(50),
    inspection_stage VARCHAR(50), -- INCOMING, IN_PROCESS, FINAL
    
    specification VARCHAR(200),
    unit_of_measure VARCHAR(50),
    tolerance_min DECIMAL(15,4),
    tolerance_max DECIMAL(15,4),
    
    is_critical BOOLEAN DEFAULT false,
    testing_method TEXT,
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_parameters_master_tenant ON quality_parameters_master(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quality_parameters_master_item ON quality_parameters_master(item_id);
CREATE INDEX IF NOT EXISTS idx_quality_parameters_master_stage ON quality_parameters_master(inspection_stage);
CREATE INDEX IF NOT EXISTS idx_quality_parameters_master_active ON quality_parameters_master(is_active);

-- Create vendor_quality_rating table (vendor quality performance)
CREATE TABLE IF NOT EXISTS vendor_quality_rating (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    vendor_name VARCHAR(200),
    
    rating_period_start DATE NOT NULL,
    rating_period_end DATE NOT NULL,
    
    -- Inspection statistics
    total_inspections INTEGER DEFAULT 0,
    passed_inspections INTEGER DEFAULT 0,
    failed_inspections INTEGER DEFAULT 0,
    
    pass_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    
    -- Defect statistics
    total_defects INTEGER DEFAULT 0,
    critical_defects INTEGER DEFAULT 0,
    major_defects INTEGER DEFAULT 0,
    minor_defects INTEGER DEFAULT 0,
    
    defect_rate DECIMAL(5,2) DEFAULT 0, -- PPM (parts per million)
    
    -- NCR statistics
    total_ncrs INTEGER DEFAULT 0,
    open_ncrs INTEGER DEFAULT 0,
    
    -- Overall rating
    quality_score DECIMAL(5,2) DEFAULT 0, -- 0-100 scale
    rating_grade VARCHAR(10), -- A+, A, B, C, D, F
    
    remarks TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_quality_rating_tenant ON vendor_quality_rating(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_quality_rating_vendor ON vendor_quality_rating(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_quality_rating_period ON vendor_quality_rating(rating_period_start, rating_period_end);

-- Create process_quality_metrics table (process performance tracking)
CREATE TABLE IF NOT EXISTS process_quality_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    
    process_name VARCHAR(200) NOT NULL,
    process_id UUID, -- Link to production processes
    metric_date DATE NOT NULL,
    
    -- Production statistics
    units_produced INTEGER DEFAULT 0,
    units_inspected INTEGER DEFAULT 0,
    units_passed INTEGER DEFAULT 0,
    units_failed INTEGER DEFAULT 0,
    units_reworked INTEGER DEFAULT 0,
    
    -- Quality metrics
    first_pass_yield DECIMAL(5,2) DEFAULT 0, -- Percentage
    overall_yield DECIMAL(5,2) DEFAULT 0, -- Percentage after rework
    defect_rate DECIMAL(5,2) DEFAULT 0, -- Defects per unit
    
    -- Defect analysis
    total_defects INTEGER DEFAULT 0,
    defect_types JSONB, -- JSON object with defect categories and counts
    
    -- Downtime
    quality_related_downtime INTEGER DEFAULT 0, -- Minutes
    
    remarks TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_quality_metrics_tenant ON process_quality_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_process_quality_metrics_process ON process_quality_metrics(process_name);
CREATE INDEX IF NOT EXISTS idx_process_quality_metrics_date ON process_quality_metrics(metric_date);

-- Create quality_alerts table (automated quality alerts)
CREATE TABLE IF NOT EXISTS quality_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    
    alert_type VARCHAR(100) NOT NULL, -- HIGH_DEFECT_RATE, NCR_OVERDUE, LOW_VENDOR_SCORE, etc.
    severity VARCHAR(50), -- LOW, MEDIUM, HIGH, CRITICAL
    
    title VARCHAR(200) NOT NULL,
    description TEXT,
    
    reference_id UUID, -- ID of related record (inspection, NCR, vendor, etc.)
    reference_type VARCHAR(50), -- INSPECTION, NCR, VENDOR, PROCESS
    
    triggered_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP,
    acknowledged_by UUID,
    
    resolved_at TIMESTAMP,
    resolved_by UUID,
    resolution_notes TEXT,
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_alerts_tenant ON quality_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quality_alerts_type ON quality_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_quality_alerts_severity ON quality_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_quality_alerts_active ON quality_alerts(is_active);
CREATE INDEX IF NOT EXISTS idx_quality_alerts_triggered ON quality_alerts(triggered_at);

-- Add comments
COMMENT ON TABLE quality_inspections IS 'Incoming, in-process, and final inspection records with UID linkage per FRS Section 3.5';
COMMENT ON TABLE inspection_parameters IS 'Detailed quality parameter measurements for each inspection';
COMMENT ON TABLE inspection_defects IS 'Defect logging with categorization and severity';
COMMENT ON TABLE ncr IS 'Non-Conformance Reports with root cause analysis and corrective actions';
COMMENT ON TABLE quality_parameters_master IS 'Standard quality parameters defined per item and inspection stage';
COMMENT ON TABLE vendor_quality_rating IS 'Vendor quality performance analytics with scoring';
COMMENT ON TABLE process_quality_metrics IS 'Process quality metrics including first pass yield and defect rates';
COMMENT ON TABLE quality_alerts IS 'Automated quality alerts for proactive quality management';

COMMENT ON COLUMN quality_inspections.uid IS 'UID of product/component being inspected for traceability';
COMMENT ON COLUMN quality_inspections.defect_rate IS 'Percentage of defects found (rejected_qty / inspected_qty * 100)';
COMMENT ON COLUMN ncr.verification_required IS 'Whether verification of corrective action is needed before closure';
COMMENT ON COLUMN vendor_quality_rating.quality_score IS 'Composite quality score (0-100) based on pass rate, defect rate, and NCR count';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Quality & Inspection tables created successfully with NCR tracking and analytics';
END $$;
