/**
 * India Regional Configuration
 * 
 * Compliant with Indian labour laws and statutory requirements
 */

import { HRModuleConfig } from '../types';

export const IndiaConfig: HRModuleConfig = {
  region: 'INDIA',
  currency: 'INR',
  workWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  
  features: {
    payroll: true,
    attendance: true,
    leave: true,
    performance: true,
    compliance: true
  },
  
  compliance: {
    pf: {
      enabled: true,
      employeeRate: 12,
      employerRate: 12
    },
    esi: {
      enabled: true,
      employeeRate: 0.75,
      employerRate: 3.25,
      wageLimit: 21000
    },
    professionalTax: {
      enabled: true,
      state: 'MH' // Default, should be configured per company
    },
    tds: {
      enabled: true,
      financialYear: '2024-25'
    },
    gratuity: {
      enabled: true,
      formula: 'india'
    }
  },
  
  leave: {
    types: [
      {
        code: 'EARNED',
        name: 'Earned Leave / Privilege Leave',
        max_days_per_year: 21,
        accrual_type: 'MONTHLY',
        is_paid: true,
        is_carry_forward: true,
        max_carry_forward: 45,
        requires_approval: true,
        min_notice_days: 7
      },
      {
        code: 'CASUAL',
        name: 'Casual Leave',
        max_days_per_year: 12,
        accrual_type: 'YEARLY',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 1
      },
      {
        code: 'SICK',
        name: 'Sick Leave',
        max_days_per_year: 12,
        accrual_type: 'YEARLY',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 0
      },
      {
        code: 'MATERNITY',
        name: 'Maternity Leave',
        max_days_per_year: 182, // 26 weeks
        accrual_type: 'CUSTOM',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 30
      },
      {
        code: 'PATERNITY',
        name: 'Paternity Leave',
        max_days_per_year: 15,
        accrual_type: 'YEARLY',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 7
      },
      {
        code: 'COMP_OFF',
        name: 'Compensatory Off',
        max_days_per_year: 30,
        accrual_type: 'CUSTOM',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 1
      },
      {
        code: 'LWP',
        name: 'Leave Without Pay',
        max_days_per_year: 30,
        accrual_type: 'CUSTOM',
        is_paid: false,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 7
      }
    ]
  },
  
  payroll: {
    paymentCycle: 'MONTHLY',
    overtimeMultiplier: 2.0, // Double pay for overtime as per Factories Act
    minimumWage: undefined // Varies by state and sector
  }
};

/**
 * India Salary Components Template
 */
export const IndiaSalaryComponents = {
  basic: {
    name: 'Basic Salary',
    is_taxable: true,
    is_mandatory: true,
    typical_percentage: 40, // Typically 40-50% of CTC
    pf_applicable: true,
    esi_applicable: true
  },
  hra: {
    name: 'House Rent Allowance',
    is_taxable: true, // Partially exempt under Section 10(13A)
    is_mandatory: false,
    typical_percentage: 40, // 40-50% of basic
    pf_applicable: false,
    esi_applicable: true,
    tax_exemption: 'Least of: Actual HRA, 50% of Basic (metro)/40% (non-metro), Rent - 10% of Basic'
  },
  da: {
    name: 'Dearness Allowance',
    is_taxable: true,
    is_mandatory: false,
    typical_percentage: 0, // Common in government/PSUs
    pf_applicable: true,
    esi_applicable: true
  },
  lta: {
    name: 'Leave Travel Allowance',
    is_taxable: false, // Exempt under Section 10(5)
    is_mandatory: false,
    typical_amount: 20000, // Annual
    pf_applicable: false,
    esi_applicable: false
  },
  medical: {
    name: 'Medical Allowance',
    is_taxable: false, // Exempt up to Rs. 15,000
    is_mandatory: false,
    typical_amount: 15000, // Annual
    pf_applicable: false,
    esi_applicable: false
  },
  special: {
    name: 'Special Allowance',
    is_taxable: true,
    is_mandatory: false,
    typical_percentage: 20, // Balance amount to reach CTC
    pf_applicable: false,
    esi_applicable: true
  },
  telephone: {
    name: 'Telephone Allowance',
    is_taxable: true,
    is_mandatory: false,
    typical_amount: 2000, // Monthly
    pf_applicable: false,
    esi_applicable: true
  },
  transport: {
    name: 'Transport/Conveyance Allowance',
    is_taxable: false, // Exempt up to Rs. 1,600/month or actual
    is_mandatory: false,
    typical_amount: 1600, // Monthly
    pf_applicable: false,
    esi_applicable: true
  }
};

/**
 * India Public Holidays (2024-25) - Tentative
 * Varies by state and company policy
 */
export const IndiaPublicHolidays = [
  { date: '2024-01-26', name: 'Republic Day' },
  { date: '2024-03-08', name: 'Maha Shivaratri' },
  { date: '2024-03-25', name: 'Holi' },
  { date: '2024-04-11', name: 'Eid-ul-Fitr' },
  { date: '2024-04-17', name: 'Ram Navami' },
  { date: '2024-04-21', name: 'Mahavir Jayanti' },
  { date: '2024-04-29', name: 'Good Friday' },
  { date: '2024-05-23', name: 'Buddha Purnima' },
  { date: '2024-06-17', name: 'Eid-ul-Adha' },
  { date: '2024-07-17', name: 'Muharram' },
  { date: '2024-08-15', name: 'Independence Day' },
  { date: '2024-08-26', name: 'Janmashtami' },
  { date: '2024-09-16', name: 'Milad-un-Nabi' },
  { date: '2024-10-02', name: 'Gandhi Jayanti' },
  { date: '2024-10-12', name: 'Dussehra' },
  { date: '2024-10-31', name: 'Diwali' },
  { date: '2024-11-01', name: 'Diwali (Balipratipada)' },
  { date: '2024-11-15', name: 'Guru Nanak Jayanti' },
  { date: '2024-12-25', name: 'Christmas' }
];

/**
 * State-wise Minimum Wages (Sample - 2024)
 * Should be updated regularly as per government notifications
 */
export const IndiaMinimumWages = {
  'MH': { // Maharashtra
    unskilled: 12600,
    semiskilled: 13800,
    skilled: 15300,
    highlySkilled: 17100
  },
  'DL': { // Delhi
    unskilled: 16792,
    semiskilled: 18499,
    skilled: 20362,
    highlySkilled: 22405
  },
  'KA': { // Karnataka
    unskilled: 14800,
    semiskilled: 16200,
    skilled: 17800,
    highlySkilled: 19500
  },
  'TN': { // Tamil Nadu
    unskilled: 11100,
    semiskilled: 12200,
    skilled: 13400,
    highlySkilled: 14700
  },
  'GJ': { // Gujarat
    unskilled: 10500,
    semiskilled: 11500,
    skilled: 12700,
    highlySkilled: 14000
  }
};

/**
 * Professional Tax Slabs by State
 */
export const ProfessionalTaxSlabs = {
  'MH': { // Maharashtra
    slabs: [
      { min: 0, max: 7500, tax: 0 },
      { min: 7501, max: 10000, tax: 175 },
      { min: 10001, max: Infinity, tax: 200 }
    ],
    annual_max: 2500
  },
  'KA': { // Karnataka
    slabs: [
      { min: 0, max: 15000, tax: 0 },
      { min: 15001, max: 20000, tax: 150 },
      { min: 20001, max: Infinity, tax: 200 }
    ]
  },
  'WB': { // West Bengal
    slabs: [
      { min: 0, max: 8500, tax: 0 },
      { min: 8501, max: 10000, tax: 110 },
      { min: 10001, max: 15000, tax: 130 },
      { min: 15001, max: 25000, tax: 150 },
      { min: 25001, max: 40000, tax: 160 },
      { min: 40001, max: Infinity, tax: 200 }
    ]
  }
};

/**
 * PF Rules
 */
export const PFRules = {
  applicability: {
    employee_threshold: 20, // Mandatory if 20+ employees
    wage_ceiling: 15000, // Statutory ceiling
    voluntary_above_ceiling: true
  },
  contribution: {
    employee: 12, // % of Basic + DA
    employer: 12, // % split: 3.67% EPF + 8.33% EPS
    eps_ceiling: 1250, // Maximum EPS per month
    vpf_allowed: true // Voluntary PF allowed
  },
  administration: {
    due_date: 15, // 15th of next month
    uan_required: true,
    ecr_filing: 'Monthly',
    portal: 'EPFO Unified Portal'
  }
};

/**
 * ESI Rules
 */
export const ESIRules = {
  applicability: {
    wage_ceiling: 21000, // ESI applicable if gross <= Rs. 21,000
    employee_threshold: 10 // Mandatory if 10+ employees
  },
  contribution: {
    employee: 0.75, // % of gross wages
    employer: 3.25 // % of gross wages
  },
  benefits: {
    medical: 'Full medical care for employee and family',
    sickness: 'Sickness benefit at 70% of wages',
    maternity: '26 weeks full wages',
    disablement: 'Disablement benefit',
    dependents: 'Dependents benefit'
  },
  administration: {
    due_date: 15, // 15th of next month
    esic_registration: 'Required',
    portal: 'ESIC Portal'
  }
};

/**
 * TDS Rules (FY 2024-25)
 */
export const TDSRules = {
  new_regime: {
    slabs: [
      { min: 0, max: 300000, rate: 0 },
      { min: 300001, max: 600000, rate: 5 },
      { min: 600001, max: 900000, rate: 10 },
      { min: 900001, max: 1200000, rate: 15 },
      { min: 1200001, max: 1500000, rate: 20 },
      { min: 1500001, max: Infinity, rate: 30 }
    ],
    rebate_87a: {
      applicable_upto: 700000,
      amount: 25000
    }
  },
  old_regime: {
    slabs: [
      { min: 0, max: 250000, rate: 0 },
      { min: 250001, max: 500000, rate: 5 },
      { min: 500001, max: 1000000, rate: 20 },
      { min: 1000001, max: Infinity, rate: 30 }
    ],
    rebate_87a: {
      applicable_upto: 500000,
      amount: 12500
    },
    deductions: {
      section_80c: { max: 150000 },
      section_80d: { max: 25000 }, // 50000 for senior citizens
      section_80g: { type: 'Donations' },
      hra_exemption: true,
      lta_exemption: true
    }
  },
  surcharge: [
    { min: 5000001, max: 10000000, rate: 10 },
    { min: 10000001, max: 20000000, rate: 15 },
    { min: 20000001, max: 50000000, rate: 25 },
    { min: 50000001, max: Infinity, rate: 37 }
  ],
  cess: 4 // Health and Education Cess
};

/**
 * Gratuity Rules (Payment of Gratuity Act, 1972)
 */
export const GratuityRules = {
  eligibility: {
    minimum_service: 5, // years
    exception: 'On death or disablement, no minimum service required'
  },
  calculation: {
    formula: '(Last drawn salary × 15 days × Years of service) / 26',
    components: 'Basic + DA',
    maximum: 2000000 // Rs. 20 lakhs
  },
  payment: {
    timeline: '30 days from becoming payable',
    tax: {
      exempt_limit: 2000000,
      taxable: 'Amount exceeding Rs. 20 lakhs'
    }
  }
};

/**
 * Bonus Rules (Payment of Bonus Act, 1965)
 */
export const BonusRules = {
  applicability: {
    employee_threshold: 20,
    salary_limit: 21000 // Monthly
  },
  calculation: {
    minimum: 8.33, // % or Rs. 100
    maximum: 20, // %
    wage_ceiling: 7000, // Calculation ceiling
    profit_sharing: true
  },
  payment: {
    timeline: 'Within 8 months of financial year end'
  }
};

/**
 * Maternity Benefit Rules
 */
export const MaternityRules = {
  duration: {
    first_two_children: 26, // weeks
    after_two_children: 12 // weeks
  },
  wages: {
    rate: 100, // % of average daily wage
    calculation: 'Based on last 3 months average'
  },
  notice: {
    before_delivery: 8, // weeks
    after_delivery: 6 // weeks
  }
};
