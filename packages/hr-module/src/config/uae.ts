/**
 * UAE/GCC Regional Configuration
 * 
 * Compliant with UAE Labour Law (Federal Decree-Law No. 33 of 2021)
 */

import { HRModuleConfig } from '../types';

export const UAEConfig: HRModuleConfig = {
  region: 'UAE',
  currency: 'AED',
  workWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
  
  features: {
    payroll: true,
    attendance: true,
    leave: true,
    performance: true,
    compliance: true
  },
  
  compliance: {
    wps: true,
    endOfServiceBenefits: {
      enabled: true,
      calculation: 'uae-labour-law'
    },
    visaTracking: true,
    gratuity: {
      enabled: true,
      formula: 'uae'
    }
  },
  
  leave: {
    types: [
      {
        code: 'ANNUAL',
        name: 'Annual Leave',
        max_days_per_year: 30,
        accrual_type: 'YEARLY',
        is_paid: true,
        is_carry_forward: true,
        max_carry_forward: 30,
        requires_approval: true,
        min_notice_days: 7
      },
      {
        code: 'SICK',
        name: 'Sick Leave',
        max_days_per_year: 90,
        accrual_type: 'YEARLY',
        is_paid: true, // Partially paid (15 days full, 30 days half)
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 0
      },
      {
        code: 'MATERNITY',
        name: 'Maternity Leave',
        max_days_per_year: 60,
        accrual_type: 'CUSTOM',
        is_paid: true, // 45 days full, 15 days half
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 30
      },
      {
        code: 'PATERNITY',
        name: 'Paternity Leave',
        max_days_per_year: 5,
        accrual_type: 'YEARLY',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 7
      },
      {
        code: 'HAJJ',
        name: 'Hajj Leave',
        max_days_per_year: 30,
        accrual_type: 'CUSTOM', // Once during employment
        is_paid: false,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 30
      },
      {
        code: 'EMERGENCY',
        name: 'Emergency Leave',
        max_days_per_year: 5,
        accrual_type: 'YEARLY',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 0
      },
      {
        code: 'BEREAVEMENT',
        name: 'Bereavement Leave',
        max_days_per_year: 5,
        accrual_type: 'YEARLY',
        is_paid: true,
        is_carry_forward: false,
        requires_approval: true,
        min_notice_days: 0
      },
      {
        code: 'UNPAID',
        name: 'Unpaid Leave',
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
    overtimeMultiplier: 1.25, // UAE: Normal OT = 1.25x, Holiday/Night OT = 1.5x
    minimumWage: undefined // No statutory minimum wage in UAE (varies by sector)
  }
};

/**
 * UAE Salary Components Template
 */
export const UAESalaryComponents = {
  basic: {
    name: 'Basic Salary',
    is_taxable: false, // No income tax in UAE
    is_mandatory: true,
    typical_percentage: 50 // Typically 50-60% of gross
  },
  hra: {
    name: 'Housing Allowance',
    is_taxable: false,
    is_mandatory: false,
    typical_percentage: 25 // Typically 20-30% of basic
  },
  transport: {
    name: 'Transport Allowance',
    is_taxable: false,
    is_mandatory: false,
    typical_amount: 1000 // Varies by company
  },
  food: {
    name: 'Food Allowance',
    is_taxable: false,
    is_mandatory: false,
    typical_amount: 500
  },
  telephone: {
    name: 'Telephone Allowance',
    is_taxable: false,
    is_mandatory: false,
    typical_amount: 300
  },
  education: {
    name: 'Education Allowance',
    is_taxable: false,
    is_mandatory: false,
    typical_amount: 2000 // For children's education
  }
};

/**
 * UAE Public Holidays (2024-25)
 * Note: Islamic holidays are based on lunar calendar and dates vary
 */
export const UAEPublicHolidays = [
  { date: '2024-01-01', name: 'New Year\'s Day' },
  { date: '2024-04-10', name: 'Eid Al Fitr (tentative)' },
  { date: '2024-04-11', name: 'Eid Al Fitr Holiday' },
  { date: '2024-04-12', name: 'Eid Al Fitr Holiday' },
  { date: '2024-06-15', name: 'Arafat Day (tentative)' },
  { date: '2024-06-16', name: 'Eid Al Adha (tentative)' },
  { date: '2024-06-17', name: 'Eid Al Adha Holiday' },
  { date: '2024-06-18', name: 'Eid Al Adha Holiday' },
  { date: '2024-07-07', name: 'Islamic New Year (tentative)' },
  { date: '2024-09-15', name: 'Prophet\'s Birthday (tentative)' },
  { date: '2024-12-02', name: 'Commemoration Day' },
  { date: '2024-12-03', name: 'UAE National Day' }
];

/**
 * End of Service Benefits Calculation Rules
 */
export const UAEEndOfServiceRules = {
  lessThan1Year: {
    gratuity: 0,
    description: 'No gratuity for service less than 1 year'
  },
  year1to5: {
    daysPerYear: 21,
    description: '21 days of basic salary per year for first 5 years'
  },
  moreThan5Years: {
    firstFiveYears: 21, // days per year
    afterFiveYears: 30, // days per year
    description: '21 days for first 5 years + 30 days for each additional year'
  },
  maximum: {
    years: 2,
    description: 'Maximum gratuity capped at 2 years of basic salary'
  },
  calculation: {
    formula: 'Daily wage = Basic Salary / 30',
    note: 'Only basic salary is considered for gratuity calculation'
  }
};

/**
 * WPS (Wage Protection System) Configuration
 */
export const WPSConfig = {
  enabled: true,
  reportFormat: 'SIF', // Standard Interface Format
  paymentDeadline: 10, // Payment within 10 days of salary due date
  penaltyForDelay: true,
  requirementsByCompanySize: {
    '1-49': 'Optional',
    '50+': 'Mandatory'
  }
};

/**
 * Notice Period Rules
 */
export const UAENoticePeriodRules = {
  limitedContract: {
    minimum: 30,
    maximum: 90,
    description: 'Notice period for limited term contracts'
  },
  unlimitedContract: {
    minimum: 30,
    maximum: 90,
    description: 'Notice period for unlimited contracts'
  },
  probation: {
    days: 14,
    description: 'Notice period during probation'
  }
};
