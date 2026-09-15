-- Migration: Create HR & Payroll Management tables
-- Description: Employee master, attendance, leave, payroll, payslip, statutory compliance
-- Date: 2025-11-27
-- Per FRS Section 3.8

-- Create employee status enum
DO $$ BEGIN
    CREATE TYPE employee_status AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create attendance status enum
DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create leave type enum
DO $$ BEGIN
    CREATE TYPE leave_type AS ENUM ('CASUAL', 'SICK', 'EARNED', 'UNPAID', 'MATERNITY', 'PATERNITY', 'COMP_OFF');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create salary component type enum
DO $$ BEGIN
    CREATE TYPE salary_component_type AS ENUM ('BASIC', 'HRA', 'ALLOWANCE', 'BONUS', 'DEDUCTION', 'PF', 'ESI', 'TAX');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    employee_name VARCHAR(200) NOT NULL,
    designation VARCHAR(100),
    department VARCHAR(100),
    date_of_joining DATE,
    date_of_birth DATE,
    contact_number VARCHAR(50),
    email VARCHAR(200),
    address TEXT,
    status employee_status DEFAULT 'ACTIVE',
    biometric_id VARCHAR(50),
    linked_technician_id UUID REFERENCES technicians(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_code ON employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- Create attendance_records table
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    attendance_date DATE NOT NULL,
    check_in_time TIMESTAMP,
    check_out_time TIMESTAMP,
    status attendance_status DEFAULT 'PRESENT',
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);

-- Create leave_requests table
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type leave_type NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INTEGER NOT NULL,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CANCELLED
    applied_at TIMESTAMP DEFAULT NOW(),
    approved_by UUID,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_type ON leave_requests(leave_type);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);

-- Create salary_components table
CREATE TABLE IF NOT EXISTS salary_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    component_type salary_component_type NOT NULL,
    component_name VARCHAR(100) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    is_taxable BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_employee ON salary_components(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_type ON salary_components(component_type);

-- Create payroll_runs table
CREATE TABLE IF NOT EXISTS payroll_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    payroll_month VARCHAR(7) NOT NULL, -- YYYY-MM
    run_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, COMPLETED, APPROVED, REJECTED
    remarks TEXT,
    created_by UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_tenant ON payroll_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_month ON payroll_runs(payroll_month);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_runs(status);

-- Create payslips table
CREATE TABLE IF NOT EXISTS payslips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id),
    payslip_number VARCHAR(50) UNIQUE NOT NULL,
    salary_month VARCHAR(7) NOT NULL, -- YYYY-MM
    gross_salary DECIMAL(15,2) NOT NULL,
    total_deductions DECIMAL(15,2) DEFAULT 0,
    net_salary DECIMAL(15,2) NOT NULL,
    attendance_days INTEGER NOT NULL,
    leave_days INTEGER DEFAULT 0,
    approved_by UUID,
    approved_at TIMESTAMP,
    released_by UUID,
    released_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payslip_employee ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslip_month ON payslips(salary_month);
CREATE INDEX IF NOT EXISTS idx_payslip_number ON payslips(payslip_number);

-- Add comments
COMMENT ON TABLE employees IS 'Employee master for HR & Payroll, links to technicians for service module';
COMMENT ON TABLE attendance_records IS 'Attendance tracking (biometric/web) for payroll and compliance';
COMMENT ON TABLE leave_requests IS 'Leave management with approval workflow';
COMMENT ON TABLE salary_components IS 'Salary component configuration for each employee';
COMMENT ON TABLE payroll_runs IS 'Payroll run records for each month';
COMMENT ON TABLE payslips IS 'Payslip generation and release tracking';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'HR & Payroll Management tables created successfully with attendance, leave, payroll, and payslip tracking';
END $$;
