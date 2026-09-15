/**
 * India Statutory Compliance Utilities
 * 
 * Implements calculations as per:
 * - Employees' Provident Funds and Miscellaneous Provisions Act, 1952 (EPF)
 * - Employees' State Insurance Act, 1948 (ESI)
 * - Professional Tax (PT) - State-wise
 * - Income Tax Act, 1961 (TDS)
 */

import { Form16, PFChallan } from '../types';

/**
 * Calculate Employee Provident Fund (EPF)
 * 
 * Rules:
 * - Employee contribution: 12% of Basic + DA
 * - Employer contribution: 12% of Basic + DA
 * - Employer's 12% is split: 3.67% to EPF, 8.33% to EPS (max Rs. 1250)
 * - Wage ceiling: Rs. 15,000 for statutory calculation
 * - Voluntary contribution allowed above ceiling
 * 
 * @param basicSalary - Basic salary
 * @param da - Dearness Allowance (default 0)
 * @param options - Configuration options
 * @returns PF calculation breakdown
 */
export function calculatePF(
  basicSalary: number,
  da: number = 0,
  options: {
    wageRestriction?: boolean; // Apply Rs. 15,000 ceiling
    voluntaryPfRate?: number; // Employee VPF rate (if any)
  } = {}
): {
  pfWages: number;
  employeeShare: number;
  employerShare: number;
  epsShare: number;
  edliShare: number;
  totalEmployerContribution: number;
  voluntaryPf: number;
} {
  const { wageRestriction = true, voluntaryPfRate = 0 } = options;
  
  const pfWages = basicSalary + da;
  const statutoryWages = wageRestriction ? Math.min(pfWages, 15000) : pfWages;
  
  // Employee contribution: 12% of wages
  const employeeShare = Math.round(statutoryWages * 0.12);
  
  // Employer's 12% split
  const employerTotal = Math.round(statutoryWages * 0.12);
  
  // EPS: 8.33% of wages (max Rs. 1250)
  const epsShare = Math.min(Math.round(statutoryWages * 0.0833), 1250);
  
  // EPF: Employer's share minus EPS
  const employerShare = employerTotal - epsShare;
  
  // EDLI: 0.5% (administrative charge)
  const edliShare = Math.round(statutoryWages * 0.005);
  
  // Voluntary PF (if employee opts for higher contribution)
  const voluntaryPf = voluntaryPfRate > 0 ? Math.round(pfWages * (voluntaryPfRate / 100)) : 0;
  
  return {
    pfWages: statutoryWages,
    employeeShare,
    employerShare,
    epsShare,
    edliShare,
    totalEmployerContribution: employerTotal + edliShare,
    voluntaryPf
  };
}

/**
 * Calculate Employee State Insurance (ESI)
 * 
 * Rules:
 * - Applicable if gross wages <= Rs. 21,000 per month
 * - Employee contribution: 0.75% of gross wages
 * - Employer contribution: 3.25% of gross wages
 * - Covers medical benefits for employee and family
 * 
 * @param grossWages - Gross salary (all components)
 * @returns ESI calculation breakdown
 */
export function calculateESI(
  grossWages: number
): {
  isApplicable: boolean;
  grossWages: number;
  employeeShare: number;
  employerShare: number;
  totalContribution: number;
} | null {
  // ESI applicable only if gross wages <= Rs. 21,000
  if (grossWages > 21000) {
    return null;
  }
  
  const employeeShare = Math.round(grossWages * 0.0075);
  const employerShare = Math.round(grossWages * 0.0325);
  
  return {
    isApplicable: true,
    grossWages,
    employeeShare,
    employerShare,
    totalContribution: employeeShare + employerShare
  };
}

/**
 * Calculate Professional Tax (PT) - State-wise
 * 
 * Professional Tax varies by state. This implementation covers major states.
 * 
 * @param grossSalary - Gross monthly salary
 * @param state - State code (MH, KA, WB, TN, etc.)
 * @returns Professional tax amount
 */
export function calculateProfessionalTax(
  grossSalary: number,
  state: string
): number {
  const stateCode = state.toUpperCase();
  
  switch (stateCode) {
    case 'MH': // Maharashtra
      if (grossSalary <= 7500) return 0;
      if (grossSalary <= 10000) return 175;
      return 200; // Monthly (Rs. 2500 annually with Feb adjustment)
    
    case 'KA': // Karnataka
      if (grossSalary <= 15000) return 0;
      if (grossSalary <= 20000) return 150;
      return 200;
    
    case 'WB': // West Bengal
      if (grossSalary <= 8500) return 0;
      if (grossSalary <= 10000) return 110;
      if (grossSalary <= 15000) return 130;
      if (grossSalary <= 25000) return 150;
      if (grossSalary <= 40000) return 160;
      return 200;
    
    case 'TN': // Tamil Nadu
      if (grossSalary <= 3500) return 0;
      if (grossSalary <= 5000) return 16.67; // Rs. 200 annually
      if (grossSalary <= 7500) return 37.50; // Rs. 450 annually
      if (grossSalary <= 10000) return 62.50; // Rs. 750 annually
      return 166.67; // Rs. 2000 annually
    
    case 'GJ': // Gujarat
      if (grossSalary <= 5999) return 0;
      if (grossSalary <= 8999) return 20;
      if (grossSalary <= 11999) return 80;
      return 150;
    
    case 'AP': // Andhra Pradesh
    case 'TS': // Telangana
      if (grossSalary <= 15000) return 0;
      if (grossSalary <= 20000) return 150;
      return 200;
    
    case 'AS': // Assam
      if (grossSalary <= 10000) return 0;
      if (grossSalary <= 15000) return 150;
      if (grossSalary <= 25000) return 180;
      return 208;
    
    case 'MP': // Madhya Pradesh
      if (grossSalary <= 15000) return 0;
      if (grossSalary <= 18000) return 125;
      return 208.33; // Rs. 2500 annually
    
    default:
      return 0; // States without PT: Delhi, UP, HP, J&K, etc.
  }
}

/**
 * Calculate Tax Deducted at Source (TDS) - FY 2024-25 Rates
 * 
 * New Tax Regime (Default from FY 2023-24):
 * - Up to Rs. 3,00,000: Nil
 * - Rs. 3,00,001 to Rs. 6,00,000: 5%
 * - Rs. 6,00,001 to Rs. 9,00,000: 10%
 * - Rs. 9,00,001 to Rs. 12,00,000: 15%
 * - Rs. 12,00,001 to Rs. 15,00,000: 20%
 * - Above Rs. 15,00,000: 30%
 * 
 * @param annualIncome - Annual taxable income
 * @param regime - 'new' or 'old' tax regime
 * @param deductions - Deductions under old regime (80C, 80D, etc.)
 * @returns TDS calculation breakdown
 */
export function calculateTDS(
  annualIncome: number,
  regime: 'new' | 'old' = 'new',
  deductions: {
    section80C?: number;
    section80D?: number;
    section80G?: number;
    hra?: number;
    lta?: number;
  } = {}
): {
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  monthlyTDS: number;
} {
  let taxableIncome = annualIncome;
  
  if (regime === 'old') {
    // Apply deductions in old regime
    const totalDeductions = (deductions.section80C || 0) +
                          (deductions.section80D || 0) +
                          (deductions.section80G || 0) +
                          (deductions.hra || 0) +
                          (deductions.lta || 0);
    taxableIncome = Math.max(0, annualIncome - totalDeductions);
  }
  
  let taxBeforeRebate = 0;
  
  if (regime === 'new') {
    // New Tax Regime Slabs
    if (taxableIncome <= 300000) {
      taxBeforeRebate = 0;
    } else if (taxableIncome <= 600000) {
      taxBeforeRebate = (taxableIncome - 300000) * 0.05;
    } else if (taxableIncome <= 900000) {
      taxBeforeRebate = 15000 + (taxableIncome - 600000) * 0.10;
    } else if (taxableIncome <= 1200000) {
      taxBeforeRebate = 45000 + (taxableIncome - 900000) * 0.15;
    } else if (taxableIncome <= 1500000) {
      taxBeforeRebate = 90000 + (taxableIncome - 1200000) * 0.20;
    } else {
      taxBeforeRebate = 150000 + (taxableIncome - 1500000) * 0.30;
    }
  } else {
    // Old Tax Regime Slabs
    if (taxableIncome <= 250000) {
      taxBeforeRebate = 0;
    } else if (taxableIncome <= 500000) {
      taxBeforeRebate = (taxableIncome - 250000) * 0.05;
    } else if (taxableIncome <= 1000000) {
      taxBeforeRebate = 12500 + (taxableIncome - 500000) * 0.20;
    } else {
      taxBeforeRebate = 112500 + (taxableIncome - 1000000) * 0.30;
    }
  }
  
  // Rebate under Section 87A (if applicable)
  let rebate = 0;
  if (regime === 'new' && taxableIncome <= 700000) {
    rebate = Math.min(taxBeforeRebate, 25000);
  } else if (regime === 'old' && taxableIncome <= 500000) {
    rebate = Math.min(taxBeforeRebate, 12500);
  }
  
  let taxAfterRebate = taxBeforeRebate - rebate;
  
  // Surcharge (if income > Rs. 50 lakhs)
  let surcharge = 0;
  if (taxableIncome > 5000000 && taxableIncome <= 10000000) {
    surcharge = taxAfterRebate * 0.10;
  } else if (taxableIncome > 10000000 && taxableIncome <= 20000000) {
    surcharge = taxAfterRebate * 0.15;
  } else if (taxableIncome > 20000000 && taxableIncome <= 50000000) {
    surcharge = taxAfterRebate * 0.25;
  } else if (taxableIncome > 50000000) {
    surcharge = taxAfterRebate * 0.37;
  }
  
  // Health and Education Cess: 4%
  const cess = (taxAfterRebate + surcharge) * 0.04;
  
  const totalTax = Math.round(taxAfterRebate + surcharge + cess);
  const monthlyTDS = Math.round(totalTax / 12);
  
  return {
    taxableIncome,
    taxBeforeRebate: Math.round(taxBeforeRebate),
    rebate,
    surcharge: Math.round(surcharge),
    cess: Math.round(cess),
    totalTax,
    monthlyTDS
  };
}

/**
 * Calculate Gratuity - India
 * 
 * Rules:
 * - Applicable after 5 years of continuous service
 * - Formula: (Last drawn salary × 15 days × Years of service) / 26
 * - Maximum: Rs. 20,00,000
 * - Last drawn salary = Basic + DA
 * 
 * @param basicSalary - Last drawn basic salary
 * @param da - Dearness Allowance
 * @param yearsOfService - Years of continuous service
 * @returns Gratuity amount
 */
export function calculateGratuity(
  basicSalary: number,
  da: number,
  yearsOfService: number
): {
  isEligible: boolean;
  gratuityAmount: number;
  calculation: string;
} {
  if (yearsOfService < 5) {
    return {
      isEligible: false,
      gratuityAmount: 0,
      calculation: 'Not eligible - Service less than 5 years'
    };
  }
  
  const lastDrawnSalary = basicSalary + da;
  const gratuity = (lastDrawnSalary * 15 * yearsOfService) / 26;
  const gratuityAmount = Math.min(gratuity, 2000000); // Cap at Rs. 20 lakhs
  
  return {
    isEligible: true,
    gratuityAmount: Math.round(gratuityAmount),
    calculation: `(₹${lastDrawnSalary} × 15 days × ${yearsOfService} years) / 26 = ₹${Math.round(gratuity)}\nCapped at ₹20,00,000`
  };
}

/**
 * Generate Form 16 (TDS Certificate)
 * 
 * Form 16 is issued by employer to employee showing TDS deducted
 * 
 * @param employeeId - Employee ID
 * @param financialYear - Financial year (e.g., "2024-25")
 * @param quarterlyData - Quarterly income and TDS data
 * @returns Form 16 data structure
 */
export function generateForm16(
  employeeId: string,
  financialYear: string,
  pan: string,
  quarterlyData: Array<{
    quarter: number;
    income: number;
    tds: number;
  }>
): Form16 {
  const totalIncome = quarterlyData.reduce((sum, q) => sum + q.income, 0);
  const tdsDeducted = quarterlyData.reduce((sum, q) => sum + q.tds, 0);
  
  return {
    employee_id: employeeId,
    financial_year: financialYear,
    pan,
    total_income: totalIncome,
    deductions_under_80c: 0, // To be filled with actual deductions
    deductions_under_80d: 0,
    taxable_income: totalIncome, // After deductions
    tax_computed: 0, // To be calculated
    tds_deducted: tdsDeducted,
    quarters: quarterlyData
  };
}

/**
 * Generate PF ECR (Electronic Challan cum Return)
 * 
 * @param month - Month (YYYY-MM)
 * @param establishmentId - PF establishment ID
 * @param employees - Array of employee PF data
 * @returns PF Challan data
 */
export function generatePFChallan(
  month: string,
  establishmentId: string,
  employees: Array<{
    uan: string;
    name: string;
    grossWages: number;
    basicPlusDa: number;
    ncpDays: number;
  }>
): PFChallan {
  const employeeData = employees.map(emp => {
    const pf = calculatePF(emp.basicPlusDa, 0, { wageRestriction: true });
    
    return {
      uan: emp.uan,
      employee_name: emp.name,
      gross_wages: emp.grossWages,
      epf_wages: pf.pfWages,
      eps_wages: pf.pfWages,
      edli_wages: pf.pfWages,
      ee_share: pf.employeeShare,
      er_share: pf.employerShare,
      eps_share: pf.epsShare,
      ncp_days: emp.ncpDays
    };
  });
  
  return {
    month,
    establishment_id: establishmentId,
    employees: employeeData,
    total_ee_share: employeeData.reduce((sum, e) => sum + e.ee_share, 0),
    total_er_share: employeeData.reduce((sum, e) => sum + e.er_share, 0),
    total_eps_share: employeeData.reduce((sum, e) => sum + e.eps_share, 0)
  };
}

/**
 * Calculate Leave Encashment Tax (India)
 * 
 * Leave encashment is tax-exempt up to Rs. 3,00,000
 * 
 * @param leaveEncashmentAmount - Leave encashment amount
 * @returns Taxable and exempt amounts
 */
export function calculateLeaveEncashmentTax(
  leaveEncashmentAmount: number
): {
  exemptAmount: number;
  taxableAmount: number;
} {
  const exemptLimit = 300000;
  const exemptAmount = Math.min(leaveEncashmentAmount, exemptLimit);
  const taxableAmount = Math.max(0, leaveEncashmentAmount - exemptLimit);
  
  return {
    exemptAmount,
    taxableAmount
  };
}

/**
 * Calculate Bonus (India - Payment of Bonus Act, 1965)
 * 
 * Rules:
 * - Minimum: 8.33% of salary or Rs. 100 (whichever is higher)
 * - Maximum: 20% of salary
 * - Calculation ceiling: Rs. 7,000 or minimum wage (whichever is higher)
 * - Applicable if profit > Rs. 20 lakhs (companies), Rs. 5 lakhs (others)
 * 
 * @param basicPlusDa - Basic + DA
 * @param workingDays - Days worked in the year
 * @returns Bonus amount
 */
export function calculateBonus(
  basicPlusDa: number,
  workingDays: number = 365
): {
  minimumBonus: number;
  maximumBonus: number;
  recommendedBonus: number;
} {
  const calculationWage = Math.min(basicPlusDa, 7000);
  const annualWage = calculationWage * 12;
  const proportionateWage = (annualWage / 365) * workingDays;
  
  const minimumBonus = Math.max(Math.round(proportionateWage * 0.0833), 100);
  const maximumBonus = Math.round(proportionateWage * 0.20);
  
  return {
    minimumBonus,
    maximumBonus,
    recommendedBonus: minimumBonus // Default to minimum
  };
}
