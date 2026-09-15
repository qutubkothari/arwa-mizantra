import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class MigrationService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!
    );
  }

  async createHRTables() {
    const sql = `
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
    employee_code VARCHAR(50) NOT NULL,
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
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, employee_code)
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_code ON employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- Create attendance_records table
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id),
    attendance_date DATE NOT NULL,
    check_in_time TIMESTAMP,
    check_out_time TIMESTAMP,
    status attendance_status DEFAULT 'PRESENT',
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON attendance_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);

-- De-duplicate attendance to enable unique constraint for biometric import
WITH ranked_attendance AS (
        SELECT
                id,
                ROW_NUMBER() OVER (
                        PARTITION BY tenant_id, employee_id, attendance_date
                        ORDER BY created_at DESC, id DESC
                ) AS rn
        FROM attendance_records
)
DELETE FROM attendance_records ar
USING ranked_attendance r
WHERE ar.id = r.id
    AND r.rn > 1;

-- Unique index needed for upsert(onConflict: 'tenant_id,employee_id,attendance_date')
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_tenant_employee_date
    ON attendance_records(tenant_id, employee_id, attendance_date);

-- Create leave_requests table
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type leave_type NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INTEGER NOT NULL,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'PENDING',
    applied_at TIMESTAMP DEFAULT NOW(),
    approved_by UUID,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_tenant ON leave_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);

-- Holiday calendar
CREATE TABLE IF NOT EXISTS hr_holidays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  holiday_name VARCHAR(200) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  holiday_type VARCHAR(50) DEFAULT 'PUBLIC',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_holidays_tenant ON hr_holidays(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hr_holidays_start_date ON hr_holidays(start_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_holidays_tenant_name_start ON hr_holidays(tenant_id, holiday_name, start_date);

-- Create salary_components table
CREATE TABLE IF NOT EXISTS salary_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id),
    component_type salary_component_type NOT NULL,
    component_name VARCHAR(100) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    is_taxable BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_tenant ON salary_components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_employee ON salary_components(employee_id);

-- Create payroll_runs table
CREATE TABLE IF NOT EXISTS payroll_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    payroll_month VARCHAR(7) NOT NULL,
    run_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    remarks TEXT,
    created_by UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_tenant ON payroll_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_month ON payroll_runs(payroll_month);

-- Create payslips table
CREATE TABLE IF NOT EXISTS payslips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id),
    payslip_number VARCHAR(50) NOT NULL,
    salary_month VARCHAR(7) NOT NULL,
    gross_salary DECIMAL(15,2) NOT NULL,
    total_deductions DECIMAL(15,2) DEFAULT 0,
    net_salary DECIMAL(15,2) NOT NULL,
    attendance_days INTEGER NOT NULL,
    leave_days INTEGER DEFAULT 0,
    approved_by UUID,
    approved_at TIMESTAMP,
    released_by UUID,
    released_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, payslip_number)
);

CREATE INDEX IF NOT EXISTS idx_payslip_tenant ON payslips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payslip_employee ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslip_month ON payslips(salary_month);

-- Employee documents
CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    doc_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(255),
    file_url TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_tenant ON employee_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);

-- Employee merits & demerits
CREATE TABLE IF NOT EXISTS employee_merits_demerits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    record_type VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    points INTEGER,
    event_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chk_employee_merit_demerit_type CHECK (record_type IN ('MERIT', 'DEMERIT'))
);

CREATE INDEX IF NOT EXISTS idx_employee_merits_demerits_tenant ON employee_merits_demerits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_merits_demerits_employee ON employee_merits_demerits(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_merits_demerits_date ON employee_merits_demerits(event_date);
`;

    try {
      const { data, error } = await this.supabase.rpc('exec_sql', { sql });
      if (error) throw error;
      
      return { success: true, message: 'HR tables created successfully' };
    } catch (error) {
      console.error('HR Migration error:', error);
      throw new Error(`Migration failed: ${error.message}`);
    }
  }

  async createBomRoutingTable() {
    const sql = `
CREATE TABLE IF NOT EXISTS public.bom_routing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES public.bom_headers(id) ON DELETE CASCADE,
  operation_sequence INTEGER NOT NULL,
  operation_name VARCHAR(255),
  workstation_id UUID REFERENCES public.work_stations(id),
  cycle_time DECIMAL(10, 2),
  setup_time DECIMAL(10, 2),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_routing_bom_id ON public.bom_routing(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_routing_tenant_id ON public.bom_routing(tenant_id);

ALTER TABLE public.bom_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation_bom_routing ON public.bom_routing
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.bom_routing IS 'Stores routing/operation steps for BOMs';
COMMENT ON COLUMN public.bom_routing.operation_sequence IS 'Order in which operations are performed';
COMMENT ON COLUMN public.bom_routing.cycle_time IS 'Time in hours to complete the operation';
COMMENT ON COLUMN public.bom_routing.setup_time IS 'Setup time in hours for the operation';
`;

    try {
      const { data, error } = await this.supabase.rpc('exec_sql', { sql });
      if (error) throw error;
      
      return { success: true, message: 'BOM routing table created successfully' };
    } catch (error) {
      console.error('BOM Routing Migration error:', error);
      throw new Error(`Migration failed: ${error.message}`);
    }
  }

  async createSubcontractingTables() {
    const sql = `
CREATE TABLE IF NOT EXISTS public.subcontract_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  route_number VARCHAR(60) NOT NULL,
  name VARCHAR(255) NOT NULL,
  input_item_id UUID,
  output_item_id UUID,
  default_input_qty NUMERIC(18, 4) DEFAULT 0,
  default_output_qty NUMERIC(18, 4) DEFAULT 0,
  consumption_per_output_qty NUMERIC(18, 4) DEFAULT 0,
  expected_consumption_qty NUMERIC(18, 4) DEFAULT 0,
  expected_unused_qty NUMERIC(18, 4) DEFAULT 0,
  uom VARCHAR(50),
  status VARCHAR(30) DEFAULT 'ACTIVE',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, route_number)
);

CREATE TABLE IF NOT EXISTS public.subcontract_route_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  route_id UUID NOT NULL REFERENCES public.subcontract_routes(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  operation_name VARCHAR(255) NOT NULL,
  process_type VARCHAR(80) DEFAULT 'OUTSIDE_PROCESSING',
  vendor_id UUID,
  department VARCHAR(120),
  input_item_id UUID,
  output_item_id UUID,
  standard_yield_pct NUMERIC(8, 3) DEFAULT 100,
  scrap_tolerance_pct NUMERIC(8, 3) DEFAULT 0,
  qc_required BOOLEAN DEFAULT true,
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, route_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS public.subcontract_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_number VARCHAR(60) NOT NULL,
  route_id UUID REFERENCES public.subcontract_routes(id),
  source_warehouse_id UUID,
  output_warehouse_id UUID,
  input_item_id UUID,
  output_item_id UUID,
  planned_input_qty NUMERIC(18, 4) DEFAULT 0,
  planned_output_qty NUMERIC(18, 4) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'DRAFT',
  current_step_no INTEGER DEFAULT 1,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(tenant_id, order_number)
);

CREATE TABLE IF NOT EXISTS public.subcontract_order_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  route_step_id UUID,
  sequence_no INTEGER NOT NULL,
  operation_name VARCHAR(255) NOT NULL,
  process_type VARCHAR(80) DEFAULT 'OUTSIDE_PROCESSING',
  vendor_id UUID,
  department VARCHAR(120),
  input_item_id UUID,
  output_item_id UUID,
  planned_input_qty NUMERIC(18, 4) DEFAULT 0,
  planned_output_qty NUMERIC(18, 4) DEFAULT 0,
  issued_qty NUMERIC(18, 4) DEFAULT 0,
  received_qty NUMERIC(18, 4) DEFAULT 0,
  accepted_qty NUMERIC(18, 4) DEFAULT 0,
  rejected_qty NUMERIC(18, 4) DEFAULT 0,
  scrap_qty NUMERIC(18, 4) DEFAULT 0,
  unused_return_qty NUMERIC(18, 4) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'WAITING',
  processing_rate NUMERIC(18, 4) DEFAULT 0,
  processing_amount NUMERIC(18, 2) DEFAULT 0,
  tax_percent NUMERIC(8, 3) DEFAULT 0,
  tax_amount NUMERIC(18, 2) DEFAULT 0,
  payable_amount NUMERIC(18, 2) DEFAULT 0,
  paid_amount NUMERIC(18, 2) DEFAULT 0,
  invoice_number VARCHAR(120),
  invoice_date DATE,
  invoice_status VARCHAR(30) DEFAULT 'NOT_RECEIVED',
  payment_reference VARCHAR(120),
  payment_date DATE,
  issued_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, order_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS public.subcontract_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  order_step_id UUID REFERENCES public.subcontract_order_steps(id) ON DELETE CASCADE,
  movement_type VARCHAR(40) NOT NULL,
  item_id UUID,
  quantity NUMERIC(18, 4) DEFAULT 0,
  warehouse_id UUID,
  vendor_id UUID,
  reference_number VARCHAR(80),
  document_number VARCHAR(80),
  external_reference VARCHAR(120),
  from_warehouse_id UUID,
  to_warehouse_id UUID,
  consumed_qty NUMERIC(18, 4) DEFAULT 0,
  accepted_qty NUMERIC(18, 4) DEFAULT 0,
  rejected_qty NUMERIC(18, 4) DEFAULT 0,
  scrap_qty NUMERIC(18, 4) DEFAULT 0,
  unused_return_qty NUMERIC(18, 4) DEFAULT 0,
  processing_rate NUMERIC(18, 4) DEFAULT 0,
  processing_amount NUMERIC(18, 2) DEFAULT 0,
  tax_percent NUMERIC(8, 3) DEFAULT 0,
  tax_amount NUMERIC(18, 2) DEFAULT 0,
  payable_amount NUMERIC(18, 2) DEFAULT 0,
  invoice_number VARCHAR(120),
  invoice_date DATE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontract_routes_tenant ON public.subcontract_routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_steps_route ON public.subcontract_route_steps(route_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_orders_tenant ON public.subcontract_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_order_steps_order ON public.subcontract_order_steps(order_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_movements_order ON public.subcontract_movements(order_id);

ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS consumption_per_output_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS expected_consumption_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS expected_unused_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS document_number VARCHAR(80);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS external_reference VARCHAR(120);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS from_warehouse_id UUID;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS to_warehouse_id UUID;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS consumed_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS accepted_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS scrap_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS unused_return_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS processing_rate NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS processing_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(8, 3) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS payable_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(120);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) DEFAULT 'NOT_RECEIVED';
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(120);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS payment_date DATE;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS processing_rate NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS processing_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(8, 3) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS payable_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(120);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS invoice_date DATE;
`;

    try {
      const { error } = await this.supabase.rpc('exec_sql', { sql });
      if (error) throw error;
      return { success: true, message: 'Subcontracting tables created successfully' };
    } catch (error) {
      console.error('Subcontracting Migration error:', error);
      throw new Error(`Migration failed: ${error.message}`);
    }
  }
}
