/**
 * TypeScript Type Definitions for HR Module
 */

export type Region = 'UAE' | 'INDIA' | 'GLOBAL';
export type Currency = 'AED' | 'INR' | 'USD' | 'SAR' | 'OMR' | 'QAR';

/**
 * Employee Types
 */
export interface Employee {
  id: string;
  employee_code: string;
  employee_name: string;
  designation: string;
  department: string;
  contact_number: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  date_of_joining: string;
  date_of_birth?: string;
  nationality?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  marital_status?: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED';
  address?: string;
  
  // UAE Specific
  visa_number?: string;
  visa_expiry?: string;
  emirates_id?: string;
  emirates_id_expiry?: string;
  passport_number?: string;
  passport_expiry?: string;
  labour_card_number?: string;
  labour_card_expiry?: string;
  
  // India Specific
  pan_number?: string;
  aadhar_number?: string;
  uan_number?: string;
  pf_number?: string;
  esi_number?: string;
  
  reporting_manager_id?: string;
  probation_end_date?: string;
  confirmation_date?: string;
}

/**
 * Attendance Types
 */
export interface AttendanceRecord {
  id: string;
  employee_id: string;
  attendance_date: string;
  check_in_time?: string;
  check_out_time?: string;
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF';
  shift_id?: string;
  overtime_hours?: number;
  late_by_minutes?: number;
  early_by_minutes?: number;
  location?: string;
  remarks?: string;
}

export interface Shift {
  id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  grace_period_minutes: number;
  half_day_hours: number;
  full_day_hours: number;
}

/**
 * Leave Types
 */
export interface LeaveType {
  code: string;
  name: string;
  max_days_per_year: number;
  accrual_type: 'MONTHLY' | 'YEARLY' | 'JOINING_DATE' | 'CUSTOM';
  is_paid: boolean;
  is_carry_forward: boolean;
  max_carry_forward?: number;
  applicable_region?: Region;
  requires_approval: boolean;
  min_notice_days?: number;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approver_id?: string;
  approved_date?: string;
  rejection_reason?: string;
}

export interface LeaveBalance {
  employee_id: string;
  leave_type: string;
  year: number;
  opening_balance: number;
  accrued: number;
  taken: number;
  balance: number;
  encashed?: number;
  lapsed?: number;
}

/**
 * Payroll Types
 */
export interface SalaryComponent {
  id: string;
  employee_id: string;
  component_type: 'BASIC' | 'HRA' | 'ALLOWANCE' | 'DEDUCTION' | 'BONUS' | 'INCENTIVE';
  component_name: string;
  amount: number;
  is_taxable: boolean;
  is_percentage?: boolean;
  percentage_of?: string; // 'BASIC' or other component
  calculation_formula?: string;
}

export interface PayrollRun {
  id: string;
  payroll_month: string;
  run_date: string;
  status: 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'LOCKED';
  total_employees: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  processed_by?: string;
  locked_date?: string;
}

export interface Payslip {
  id: string;
  employee_id: string;
  payroll_run_id: string;
  salary_month: string;
  
  // Attendance
  days_in_month: number;
  days_present: number;
  days_absent: number;
  days_leave: number;
  paid_days: number;
  
  // Earnings
  basic_salary: number;
  hra: number;
  allowances: { [key: string]: number };
  bonus: number;
  incentive: number;
  overtime_amount: number;
  arrears: number;
  gross_salary: number;
  
  // Deductions
  pf_employee: number;
  pf_employer: number;
  esi_employee: number;
  esi_employer: number;
  professional_tax: number;
  tds: number;
  loan_recovery: number;
  other_deductions: { [key: string]: number };
  total_deductions: number;
  
  // Net
  net_salary: number;
  
  // Hold
  hold_amount?: number;
  amount_paid: number;
  
  status: 'DRAFT' | 'PROCESSED' | 'PAID';
  payment_date?: string;
  payment_mode?: 'BANK_TRANSFER' | 'CASH' | 'CHEQUE';
  payment_reference?: string;
}

/**
 * Statutory Compliance Types
 */
export interface StatutoryInfo {
  employee_id: string;
  
  // India
  pan_number?: string;
  uan_number?: string;
  pf_number?: string;
  esi_number?: string;
  pf_joining_date?: string;
  esi_joining_date?: string;
  pt_state?: string;
  
  // UAE
  labour_card_number?: string;
  wps_id?: string;
  mol_establishment_id?: string;
}

/**
 * Performance Types
 */
export interface KPIMetrics {
  employee_id: string;
  period: string;
  
  // Auto-calculated
  attendance_rate: number;
  punctuality_score: number;
  leave_utilization: number;
  overtime_hours: number;
  
  // Manual entry
  quality_score?: number;
  productivity_score?: number;
  teamwork_rating?: number;
  customer_satisfaction?: number;
  innovation_score?: number;
  
  overall_score?: number;
}

export interface MeritDemerit {
  id: string;
  employee_id: string;
  record_type: 'MERIT' | 'DEMERIT';
  title: string;
  description?: string;
  points: number;
  category: 'ATTENDANCE' | 'PERFORMANCE' | 'BEHAVIOR' | 'ACHIEVEMENT' | 'VIOLATION';
  event_date: string;
  created_by?: string;
}

export interface Appraisal {
  id: string;
  employee_id: string;
  appraisal_cycle: string;
  rating: number;
  self_rating?: number;
  manager_rating?: number;
  normalized_rating?: number;
  promotion_recommended: boolean;
  increment_percentage?: number;
  strengths?: string;
  areas_of_improvement?: string;
  goals_next_cycle?: string;
  status: 'PENDING' | 'SELF_SUBMITTED' | 'MANAGER_REVIEWED' | 'APPROVED';
}

/**
 * Configuration Types
 */
export interface HRModuleConfig {
  region: Region;
  currency: Currency;
  workWeek: string[];
  
  features: {
    payroll: boolean;
    attendance: boolean;
    leave: boolean;
    performance: boolean;
    compliance: boolean;
  };
  
  compliance: {
    // UAE
    wps?: boolean;
    endOfServiceBenefits?: {
      enabled: boolean;
      calculation: 'uae-labour-law';
    };
    visaTracking?: boolean;
    
    // India
    pf?: {
      enabled: boolean;
      employeeRate: number;
      employerRate: number;
    };
    esi?: {
      enabled: boolean;
      employeeRate: number;
      employerRate: number;
      wageLimit: number;
    };
    professionalTax?: {
      enabled: boolean;
      state: string;
    };
    tds?: {
      enabled: boolean;
      financialYear: string;
    };
    gratuity?: {
      enabled: boolean;
      formula: 'india' | 'uae' | 'custom';
    };
  };
  
  leave: {
    types: LeaveType[];
  };
  
  payroll: {
    paymentCycle: 'MONTHLY' | 'WEEKLY' | 'BI_WEEKLY';
    overtimeMultiplier: number;
    minimumWage?: number;
  };
}

/**
 * UAE Specific Types
 */
export interface EndOfServiceBenefits {
  employee_id: string;
  date_of_joining: string;
  date_of_leaving: string;
  years_of_service: number;
  last_basic_salary: number;
  gratuity_amount: number;
  leave_encashment: number;
  notice_pay: number;
  total_benefits: number;
  calculation_details: string;
}

export interface WPSReport {
  month: string;
  employer_id: string;
  routing_code: string;
  employees: Array<{
    employee_id: string;
    employee_name: string;
    card_number: string;
    bank_code: string;
    salary_amount: number;
    days_worked: number;
  }>;
  total_amount: number;
  file_content: string; // SIF format
}

/**
 * India Specific Types
 */
export interface Form16 {
  employee_id: string;
  financial_year: string;
  pan: string;
  total_income: number;
  deductions_under_80c: number;
  deductions_under_80d: number;
  taxable_income: number;
  tax_computed: number;
  tds_deducted: number;
  quarters: Array<{
    quarter: number;
    income: number;
    tds: number;
  }>;
}

export interface PFChallan {
  month: string;
  establishment_id: string;
  employees: Array<{
    uan: string;
    employee_name: string;
    gross_wages: number;
    epf_wages: number;
    eps_wages: number;
    edli_wages: number;
    ee_share: number;
    er_share: number;
    eps_share: number;
    ncp_days: number;
  }>;
  total_ee_share: number;
  total_er_share: number;
  total_eps_share: number;
}
