/**
 * UAE Labour Law Compliance Utilities
 * 
 * Implements calculations as per:
 * - UAE Labour Law (Federal Decree-Law No. 33 of 2021)
 * - WPS (Wage Protection System) compliance
 * - End of Service Benefits calculation
 */

import { EndOfServiceBenefits, WPSReport, Employee, Payslip } from '../types';

/**
 * Calculate End of Service Benefits (Gratuity) as per UAE Labour Law
 * 
 * Rules:
 * - Less than 1 year: No gratuity
 * - 1-5 years: 21 days' basic salary per year
 * - More than 5 years: 21 days for first 5 years + 30 days for each additional year
 * - Maximum: 2 years' basic salary
 * 
 * @param dateOfJoining - Employee joining date (YYYY-MM-DD)
 * @param dateOfLeaving - Employee leaving date (YYYY-MM-DD)
 * @param lastBasicSalary - Last drawn basic salary (monthly)
 * @returns End of service benefits calculation
 */
export function calculateEndOfServiceBenefits(
  dateOfJoining: string,
  dateOfLeaving: string,
  lastBasicSalary: number
): EndOfServiceBenefits {
  const joinDate = new Date(dateOfJoining);
  const leaveDate = new Date(dateOfLeaving);
  
  // Calculate years of service
  const diffTime = Math.abs(leaveDate.getTime() - joinDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const yearsOfService = diffDays / 365.25;
  
  let gratuityAmount = 0;
  let calculationDetails = '';
  
  if (yearsOfService < 1) {
    calculationDetails = 'Service less than 1 year - No gratuity payable';
  } else if (yearsOfService <= 5) {
    // 21 days per year for first 5 years
    const dailyWage = lastBasicSalary / 30;
    gratuityAmount = dailyWage * 21 * yearsOfService;
    calculationDetails = `${yearsOfService.toFixed(2)} years × 21 days × AED ${dailyWage.toFixed(2)}/day = AED ${gratuityAmount.toFixed(2)}`;
  } else {
    // 21 days for first 5 years + 30 days for remaining years
    const dailyWage = lastBasicSalary / 30;
    const firstFiveYears = dailyWage * 21 * 5;
    const remainingYears = yearsOfService - 5;
    const afterFiveYears = dailyWage * 30 * remainingYears;
    gratuityAmount = firstFiveYears + afterFiveYears;
    calculationDetails = `First 5 years: 5 × 21 days × AED ${dailyWage.toFixed(2)} = AED ${firstFiveYears.toFixed(2)}\n` +
                        `Remaining ${remainingYears.toFixed(2)} years: ${remainingYears.toFixed(2)} × 30 days × AED ${dailyWage.toFixed(2)} = AED ${afterFiveYears.toFixed(2)}\n` +
                        `Total: AED ${gratuityAmount.toFixed(2)}`;
  }
  
  // Cap at 2 years' salary
  const maxGratuity = lastBasicSalary * 24; // 2 years
  if (gratuityAmount > maxGratuity) {
    calculationDetails += `\nCapped at 2 years' salary: AED ${maxGratuity.toFixed(2)}`;
    gratuityAmount = maxGratuity;
  }
  
  return {
    employee_id: '',
    date_of_joining: dateOfJoining,
    date_of_leaving: dateOfLeaving,
    years_of_service: parseFloat(yearsOfService.toFixed(2)),
    last_basic_salary: lastBasicSalary,
    gratuity_amount: parseFloat(gratuityAmount.toFixed(2)),
    leave_encashment: 0, // To be calculated separately
    notice_pay: 0, // To be calculated separately
    total_benefits: parseFloat(gratuityAmount.toFixed(2)),
    calculation_details: calculationDetails
  };
}

/**
 * Calculate Leave Encashment for UAE
 * 
 * Rules:
 * - Annual Leave: 30 days per year after 1 year of service
 * - Unused leave can be encashed on termination
 * - Pro-rata calculation for incomplete years
 * 
 * @param dateOfJoining - Employee joining date
 * @param dateOfLeaving - Employee leaving date
 * @param unusedLeaveDays - Number of unused leave days
 * @param dailyWage - Daily wage rate
 * @returns Leave encashment amount
 */
export function calculateLeaveEncashment(
  dateOfJoining: string,
  dateOfLeaving: string,
  unusedLeaveDays: number,
  dailyWage: number
): number {
  const joinDate = new Date(dateOfJoining);
  const leaveDate = new Date(dateOfLeaving);
  
  const diffTime = Math.abs(leaveDate.getTime() - joinDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const yearsOfService = diffDays / 365.25;
  
  if (yearsOfService < 1) {
    return 0; // No leave encashment for service less than 1 year
  }
  
  return unusedLeaveDays * dailyWage;
}

/**
 * Generate WPS (Wage Protection System) SIF File
 * 
 * SIF Format specifications:
 * - Fixed-width text file format
 * - Required for salary payments through UAE banks
 * - Contains employee salary details in specific format
 * 
 * @param payslips - Array of payslips for the month
 * @param establishmentId - MOL Establishment ID
 * @param routingCode - Bank routing code
 * @returns WPS SIF file content
 */
export function generateWPSSIF(
  payslips: Payslip[],
  establishmentId: string,
  routingCode: string,
  month: string
): string {
  const employees = payslips.map(payslip => ({
    employee_id: payslip.employee_id,
    employee_name: '', // To be fetched from employee data
    card_number: '', // Bank card number
    bank_code: '', // Bank routing code
    salary_amount: payslip.net_salary,
    days_worked: payslip.paid_days
  }));
  
  const totalAmount = employees.reduce((sum, emp) => sum + emp.salary_amount, 0);
  
  // Generate SIF file content
  let sifContent = '';
  
  // Header Record (SCR)
  const recordCount = employees.length;
  const totalAmountFormatted = totalAmount.toFixed(2).padStart(15, '0');
  sifContent += `SCR${establishmentId.padEnd(14)}${routingCode.padEnd(8)}${month.replace('-', '')}${recordCount.toString().padStart(8, '0')}${totalAmountFormatted}\n`;
  
  // Detail Records (EDR)
  employees.forEach((emp, index) => {
    const recordNumber = (index + 1).toString().padStart(8, '0');
    const amount = emp.salary_amount.toFixed(2).padStart(15, '0');
    const daysWorked = emp.days_worked.toString().padStart(2, '0');
    
    sifContent += `EDR${recordNumber}${emp.employee_id.padEnd(14)}${emp.card_number.padEnd(16)}${emp.bank_code.padEnd(8)}${amount}${emp.employee_name.substring(0, 40).padEnd(40)}${daysWorked}\n`;
  });
  
  return sifContent;
}

/**
 * Validate Emirates ID
 * 
 * Emirates ID format: 784-YYYY-NNNNNNN-C
 * - 784: Country code for UAE
 * - YYYY: Year of birth
 * - NNNNNNN: Unique sequence number
 * - C: Check digit
 * 
 * @param emiratesId - Emirates ID to validate
 * @returns true if valid, false otherwise
 */
export function validateEmiratesId(emiratesId: string): boolean {
  // Remove hyphens and spaces
  const cleanId = emiratesId.replace(/[-\s]/g, '');
  
  // Check length (15 digits)
  if (cleanId.length !== 15) {
    return false;
  }
  
  // Check if starts with 784
  if (!cleanId.startsWith('784')) {
    return false;
  }
  
  // All characters should be digits
  if (!/^\d+$/.test(cleanId)) {
    return false;
  }
  
  return true;
}

/**
 * Calculate Annual Leave Entitlement for UAE
 * 
 * Rules:
 * - 30 calendar days per year after 1 year of service
 * - 2 days per month for the first year (pro-rata)
 * - Service less than 6 months: no leave entitlement
 * 
 * @param dateOfJoining - Employee joining date
 * @param asOfDate - Calculate leave as of this date (default: today)
 * @returns Number of leave days entitled
 */
export function calculateAnnualLeaveEntitlement(
  dateOfJoining: string,
  asOfDate: string = new Date().toISOString().split('T')[0]
): number {
  const joinDate = new Date(dateOfJoining);
  const currentDate = new Date(asOfDate);
  
  const diffTime = currentDate.getTime() - joinDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const monthsOfService = diffDays / 30.44; // Average days per month
  
  if (monthsOfService < 6) {
    return 0; // No leave for first 6 months
  } else if (monthsOfService < 12) {
    // Pro-rata: 2 days per month for first year
    return Math.floor(monthsOfService * 2);
  } else {
    // 30 days per year
    const years = Math.floor(monthsOfService / 12);
    const remainingMonths = monthsOfService % 12;
    return (years * 30) + Math.floor(remainingMonths * 2.5);
  }
}

/**
 * Calculate Sick Leave Entitlement for UAE
 * 
 * Rules:
 * - 90 days per year (after probation)
 * - First 15 days: Full pay
 * - Next 30 days: Half pay
 * - Remaining 45 days: Unpaid
 * 
 * @param dateOfJoining - Employee joining date
 * @param daysTaken - Sick leave days already taken this year
 * @returns Remaining sick leave breakdown
 */
export function calculateSickLeaveBalance(
  dateOfJoining: string,
  daysTaken: number
): {
  fullPay: number;
  halfPay: number;
  unpaid: number;
  total: number;
} {
  const joinDate = new Date(dateOfJoining);
  const currentDate = new Date();
  
  const diffTime = currentDate.getTime() - joinDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // No sick leave during probation (typically 6 months)
  if (diffDays < 180) {
    return { fullPay: 0, halfPay: 0, unpaid: 0, total: 0 };
  }
  
  const fullPayDays = Math.max(0, 15 - Math.min(daysTaken, 15));
  const halfPayDays = Math.max(0, 30 - Math.max(0, daysTaken - 15));
  const unpaidDays = Math.max(0, 45 - Math.max(0, daysTaken - 45));
  
  return {
    fullPay: fullPayDays,
    halfPay: halfPayDays,
    unpaid: unpaidDays,
    total: fullPayDays + halfPayDays + unpaidDays
  };
}

/**
 * Calculate Maternity Leave Entitlement for UAE
 * 
 * Rules:
 * - 60 days maternity leave
 * - First 45 days: Full pay
 * - Last 15 days: Half pay
 * - Additional 45 days unpaid (if needed for mother/child illness)
 * 
 * @returns Maternity leave entitlement
 */
export function getMaternityLeaveEntitlement(): {
  fullPay: number;
  halfPay: number;
  unpaidExtension: number;
  total: number;
} {
  return {
    fullPay: 45,
    halfPay: 15,
    unpaidExtension: 45,
    total: 60
  };
}

/**
 * Calculate Notice Period for UAE
 * 
 * Rules (Limited Term Contract):
 * - Minimum 30 days' notice
 * - Maximum 90 days' notice
 * - Notice can be given by either party
 * 
 * @param contractType - 'limited' or 'unlimited'
 * @param yearsOfService - Years of service
 * @returns Notice period in days
 */
export function calculateNoticePeriod(
  contractType: 'limited' | 'unlimited',
  yearsOfService: number
): number {
  if (contractType === 'limited') {
    return 30; // Minimum 30 days for limited contracts
  } else {
    // Unlimited contract notice periods (company policy)
    if (yearsOfService < 1) return 30;
    if (yearsOfService < 5) return 60;
    return 90;
  }
}

/**
 * Generate MOL WPS Report
 * 
 * Creates a comprehensive report for Ministry of Labour compliance
 * 
 * @param month - Report month (YYYY-MM)
 * @param payslips - Array of payslips
 * @param establishmentId - MOL Establishment ID
 * @returns WPS Report object
 */
export function generateMOLReport(
  month: string,
  payslips: Payslip[],
  establishmentId: string
): WPSReport {
  const employees = payslips.map(payslip => ({
    employee_id: payslip.employee_id,
    employee_name: '', // To be fetched
    card_number: '', // Bank card
    bank_code: '', // Bank code
    salary_amount: payslip.net_salary,
    days_worked: payslip.paid_days
  }));
  
  const totalAmount = employees.reduce((sum, emp) => sum + emp.salary_amount, 0);
  
  return {
    month,
    employer_id: establishmentId,
    routing_code: '', // To be provided
    employees,
    total_amount: totalAmount,
    file_content: '' // To be generated using generateWPSSIF
  };
}
