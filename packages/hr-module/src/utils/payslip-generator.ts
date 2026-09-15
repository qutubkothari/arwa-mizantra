/**
 * Payslip Generator Utility
 * 
 * Generates professional payslips in HTML and PDF formats
 * with support for multiple regions (UAE, India, Global)
 */

import { Payslip, Employee, HRModuleConfig } from '../types';

/**
 * Generate HTML Payslip
 * 
 * @param payslip - Payslip data
 * @param employee - Employee details
 * @param config - HR module configuration
 * @returns HTML string of formatted payslip
 */
export function generatePayslipHTML(
  payslip: Payslip,
  employee: Employee,
  config: HRModuleConfig
): string {
  const { region, currency } = config;
  const currencySymbol = getCurrencySymbol(currency);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Payslip - ${employee.employee_name} - ${payslip.salary_month}</title>
  <style>
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 20px;
      color: #333;
    }
    
    .payslip-container {
      max-width: 800px;
      margin: 0 auto;
      border: 2px solid #2c3e50;
      padding: 0;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    
    .company-name {
      font-size: 28px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    
    .payslip-title {
      font-size: 20px;
      margin-top: 10px;
    }
    
    .employee-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      padding: 30px;
      background: #f8f9fa;
      border-bottom: 2px solid #e9ecef;
    }
    
    .info-row {
      display: flex;
      margin-bottom: 10px;
    }
    
    .info-label {
      font-weight: 600;
      width: 150px;
      color: #495057;
    }
    
    .info-value {
      color: #212529;
    }
    
    .salary-details {
      padding: 30px;
    }
    
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #2c3e50;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #667eea;
    }
    
    .salary-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    
    .salary-table th {
      background: #667eea;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    
    .salary-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #e9ecef;
    }
    
    .salary-table tr:hover {
      background: #f8f9fa;
    }
    
    .amount-col {
      text-align: right;
      font-weight: 600;
    }
    
    .subtotal-row {
      background: #e7f3ff;
      font-weight: 600;
    }
    
    .total-row {
      background: #667eea;
      color: white;
      font-size: 16px;
      font-weight: bold;
    }
    
    .net-salary {
      background: #28a745;
      color: white;
      padding: 20px;
      text-align: center;
      margin: 20px 0;
      border-radius: 5px;
    }
    
    .net-salary-label {
      font-size: 16px;
      margin-bottom: 5px;
    }
    
    .net-salary-amount {
      font-size: 32px;
      font-weight: bold;
    }
    
    .net-salary-words {
      font-size: 14px;
      margin-top: 5px;
      font-style: italic;
    }
    
    .footer {
      padding: 20px 30px;
      background: #f8f9fa;
      border-top: 2px solid #e9ecef;
      font-size: 12px;
      color: #6c757d;
    }
    
    .print-button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 30px;
      font-size: 16px;
      border-radius: 5px;
      cursor: pointer;
      margin: 20px 0;
    }
    
    .print-button:hover {
      background: #5568d3;
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: center;">
    <button class="print-button" onclick="window.print()">🖨️ Print Payslip</button>
  </div>
  
  <div class="payslip-container">
    <!-- Header -->
    <div class="header">
      <div class="company-name">Your Company Name</div>
      <div>Address Line 1, Address Line 2</div>
      <div class="payslip-title">SALARY SLIP - ${payslip.salary_month}</div>
    </div>
    
    <!-- Employee Information -->
    <div class="employee-info">
      <div>
        <div class="info-row">
          <div class="info-label">Employee Name:</div>
          <div class="info-value">${employee.employee_name}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Employee Code:</div>
          <div class="info-value">${employee.employee_code}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Designation:</div>
          <div class="info-value">${employee.designation}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Department:</div>
          <div class="info-value">${employee.department}</div>
        </div>
        ${region === 'INDIA' && employee.pan_number ? `
        <div class="info-row">
          <div class="info-label">PAN:</div>
          <div class="info-value">${employee.pan_number}</div>
        </div>
        ` : ''}
        ${region === 'UAE' && employee.labour_card_number ? `
        <div class="info-row">
          <div class="info-label">Labour Card:</div>
          <div class="info-value">${employee.labour_card_number}</div>
        </div>
        ` : ''}
      </div>
      <div>
        <div class="info-row">
          <div class="info-label">Salary Month:</div>
          <div class="info-value">${payslip.salary_month}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Days in Month:</div>
          <div class="info-value">${payslip.days_in_month}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Days Present:</div>
          <div class="info-value">${payslip.days_present}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Days Leave:</div>
          <div class="info-value">${payslip.days_leave}</div>
        </div>
        <div class="info-row">
          <div class="info-label">Paid Days:</div>
          <div class="info-value">${payslip.paid_days}</div>
        </div>
      </div>
    </div>
    
    <!-- Salary Details -->
    <div class="salary-details">
      <table class="salary-table">
        <thead>
          <tr>
            <th style="width: 50%">EARNINGS</th>
            <th style="width: 50%; text-align: right;">AMOUNT (${currencySymbol})</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Basic Salary</td>
            <td class="amount-col">${formatCurrency(payslip.basic_salary)}</td>
          </tr>
          <tr>
            <td>House Rent Allowance (HRA)</td>
            <td class="amount-col">${formatCurrency(payslip.hra)}</td>
          </tr>
          ${Object.entries(payslip.allowances).map(([key, value]) => `
          <tr>
            <td>${formatAllowanceName(key)}</td>
            <td class="amount-col">${formatCurrency(value)}</td>
          </tr>
          `).join('')}
          ${payslip.bonus > 0 ? `
          <tr>
            <td>Bonus</td>
            <td class="amount-col">${formatCurrency(payslip.bonus)}</td>
          </tr>
          ` : ''}
          ${payslip.incentive > 0 ? `
          <tr>
            <td>Incentive</td>
            <td class="amount-col">${formatCurrency(payslip.incentive)}</td>
          </tr>
          ` : ''}
          ${payslip.overtime_amount > 0 ? `
          <tr>
            <td>Overtime</td>
            <td class="amount-col">${formatCurrency(payslip.overtime_amount)}</td>
          </tr>
          ` : ''}
          ${payslip.arrears > 0 ? `
          <tr>
            <td>Arrears</td>
            <td class="amount-col">${formatCurrency(payslip.arrears)}</td>
          </tr>
          ` : ''}
          <tr class="subtotal-row">
            <td><strong>GROSS EARNINGS</strong></td>
            <td class="amount-col"><strong>${formatCurrency(payslip.gross_salary)}</strong></td>
          </tr>
        </tbody>
      </table>
      
      <table class="salary-table">
        <thead>
          <tr>
            <th style="width: 50%">DEDUCTIONS</th>
            <th style="width: 50%; text-align: right;">AMOUNT (${currencySymbol})</th>
          </tr>
        </thead>
        <tbody>
          ${region === 'INDIA' ? `
          ${payslip.pf_employee > 0 ? `
          <tr>
            <td>Provident Fund (PF)</td>
            <td class="amount-col">${formatCurrency(payslip.pf_employee)}</td>
          </tr>
          ` : ''}
          ${payslip.esi_employee > 0 ? `
          <tr>
            <td>Employee State Insurance (ESI)</td>
            <td class="amount-col">${formatCurrency(payslip.esi_employee)}</td>
          </tr>
          ` : ''}
          ${payslip.professional_tax > 0 ? `
          <tr>
            <td>Professional Tax</td>
            <td class="amount-col">${formatCurrency(payslip.professional_tax)}</td>
          </tr>
          ` : ''}
          ${payslip.tds > 0 ? `
          <tr>
            <td>Tax Deducted at Source (TDS)</td>
            <td class="amount-col">${formatCurrency(payslip.tds)}</td>
          </tr>
          ` : ''}
          ` : ''}
          ${payslip.loan_recovery > 0 ? `
          <tr>
            <td>Loan Recovery</td>
            <td class="amount-col">${formatCurrency(payslip.loan_recovery)}</td>
          </tr>
          ` : ''}
          ${Object.entries(payslip.other_deductions).map(([key, value]) => `
          <tr>
            <td>${formatAllowanceName(key)}</td>
            <td class="amount-col">${formatCurrency(value)}</td>
          </tr>
          `).join('')}
          <tr class="subtotal-row">
            <td><strong>TOTAL DEDUCTIONS</strong></td>
            <td class="amount-col"><strong>${formatCurrency(payslip.total_deductions)}</strong></td>
          </tr>
        </tbody>
      </table>
      
      ${region === 'INDIA' && (payslip.pf_employer > 0 || payslip.esi_employer > 0) ? `
      <table class="salary-table">
        <thead>
          <tr>
            <th colspan="2">EMPLOYER CONTRIBUTIONS (For Information Only)</th>
          </tr>
        </thead>
        <tbody>
          ${payslip.pf_employer > 0 ? `
          <tr>
            <td>Employer PF Contribution</td>
            <td class="amount-col">${formatCurrency(payslip.pf_employer)}</td>
          </tr>
          ` : ''}
          ${payslip.esi_employer > 0 ? `
          <tr>
            <td>Employer ESI Contribution</td>
            <td class="amount-col">${formatCurrency(payslip.esi_employer)}</td>
          </tr>
          ` : ''}
        </tbody>
      </table>
      ` : ''}
      
      <div class="net-salary">
        <div class="net-salary-label">NET SALARY</div>
        <div class="net-salary-amount">${currencySymbol} ${formatCurrency(payslip.net_salary)}</div>
        <div class="net-salary-words">${numberToWords(payslip.net_salary, currency)} Only</div>
      </div>
      
      ${payslip.hold_amount && payslip.hold_amount > 0 ? `
      <div style="background: #fff3cd; border: 2px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <strong>⚠️ Hold Amount:</strong> ${currencySymbol} ${formatCurrency(payslip.hold_amount)}<br>
        <strong>Amount Paid:</strong> ${currencySymbol} ${formatCurrency(payslip.amount_paid)}
      </div>
      ` : ''}
    </div>
    
    <!-- Footer -->
    <div class="footer">
      <p><strong>Note:</strong> This is a computer-generated payslip and does not require a signature.</p>
      <p>Generated on: ${new Date().toLocaleDateString()}</p>
      ${region === 'INDIA' ? `
      <p style="margin-top: 10px; font-size: 11px;">
        <strong>Statutory Compliance:</strong> PF & ESI contributions as per Government regulations. 
        TDS deducted as per Income Tax Act, 1961.
      </p>
      ` : ''}
      ${region === 'UAE' ? `
      <p style="margin-top: 10px; font-size: 11px;">
        <strong>WPS Compliance:</strong> Salary payment processed through Wage Protection System (WPS) 
        as per UAE Ministry of Labour regulations.
      </p>
      ` : ''}
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Helper: Get currency symbol
 */
function getCurrencySymbol(currency: string): string {
  const symbols: { [key: string]: string } = {
    'AED': 'AED',
    'INR': '₹',
    'USD': '$',
    'SAR': 'SAR',
    'OMR': 'OMR',
    'QAR': 'QAR'
  };
  return symbols[currency] || currency;
}

/**
 * Helper: Format currency amount
 */
function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Helper: Format allowance name (convert snake_case to Title Case)
 */
function formatAllowanceName(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Helper: Convert number to words
 */
function numberToWords(num: number, currency: string): string {
  if (num === 0) return 'Zero';
  
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  
  function convertLessThanThousand(n: number): string {
    if (n === 0) return '';
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + convertLessThanThousand(n % 100) : '');
  }
  
  let integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);
  
  let result = '';
  
  // For Indian numbering system (Lakhs, Crores)
  if (currency === 'INR') {
    if (integerPart >= 10000000) {
      result += convertLessThanThousand(Math.floor(integerPart / 10000000)) + ' Crore ';
      integerPart %= 10000000;
    }
    if (integerPart >= 100000) {
      result += convertLessThanThousand(Math.floor(integerPart / 100000)) + ' Lakh ';
      integerPart %= 100000;
    }
    if (integerPart >= 1000) {
      result += convertLessThanThousand(Math.floor(integerPart / 1000)) + ' Thousand ';
      integerPart %= 1000;
    }
    if (integerPart > 0) {
      result += convertLessThanThousand(integerPart);
    }
    
    result += ` Rupees`;
    
    if (decimalPart > 0) {
      result += ` and ${convertLessThanThousand(decimalPart)} Paisa`;
    }
  } else {
    // International numbering (Millions, Billions)
    if (integerPart >= 1000000000) {
      result += convertLessThanThousand(Math.floor(integerPart / 1000000000)) + ' Billion ';
      integerPart %= 1000000000;
    }
    if (integerPart >= 1000000) {
      result += convertLessThanThousand(Math.floor(integerPart / 1000000)) + ' Million ';
      integerPart %= 1000000;
    }
    if (integerPart >= 1000) {
      result += convertLessThanThousand(Math.floor(integerPart / 1000)) + ' Thousand ';
      integerPart %= 1000;
    }
    if (integerPart > 0) {
      result += convertLessThanThousand(integerPart);
    }
    
    const currencyName = currency === 'AED' ? 'Dirhams' : currency === 'USD' ? 'Dollars' : currency;
    result += ` ${currencyName}`;
    
    if (decimalPart > 0) {
      const subUnit = currency === 'AED' ? 'Fils' : currency === 'USD' ? 'Cents' : 'Cents';
      result += ` and ${convertLessThanThousand(decimalPart)} ${subUnit}`;
    }
  }
  
  return result.trim();
}

/**
 * Generate payslip as downloadable file
 * 
 * @param payslip - Payslip data
 * @param employee - Employee details
 * @param config - HR module configuration
 * @returns Base64 encoded HTML file
 */
export function generatePayslipFile(
  payslip: Payslip,
  employee: Employee,
  config: HRModuleConfig
): string {
  const html = generatePayslipHTML(payslip, employee, config);
  return Buffer.from(html).toString('base64');
}
