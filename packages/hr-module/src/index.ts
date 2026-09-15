/**
 * @sak-erp/hr-module
 * Standalone HR & Payroll Management System
 * 
 * A comprehensive, industry-standard HR module that can be integrated into any application.
 * Supports multi-region compliance (UAE, India, Global) with customizable workflows.
 */

// Export types
export * from './types';

// Export regional configs
export { UAEConfig } from './config/uae';
export { IndiaConfig } from './config/india';

// Export UAE compliance utilities
export {
  calculateEndOfServiceBenefits,
  calculateLeaveEncashment,
  generateWPSSIF,
  validateEmiratesId,
  calculateAnnualLeaveEntitlement,
  calculateSickLeaveBalance,
  getMaternityLeaveEntitlement,
  calculateNoticePeriod,
  generateMOLReport
} from './utils/uae-compliance';

// Export India compliance utilities
export {
  calculatePF,
  calculateESI,
  calculateProfessionalTax,
  calculateTDS,
  calculateGratuity,
  generateForm16,
  generatePFChallan,
  calculateLeaveEncashmentTax,
  calculateBonus
} from './utils/india-compliance';

// Export payslip generator
export {
  generatePayslipHTML,
  generatePayslipFile
} from './utils/payslip-generator';
