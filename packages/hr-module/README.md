# HR Module - Standalone Package

A comprehensive, industry-standard HR & Payroll Management system that can be integrated into any project.

## Features

### Core Modules
- **Employee Management** - Complete lifecycle from onboarding to exit
- **Attendance Management** - Biometric integration, shift management, overtime
- **Leave Management** - Multiple leave types, accrual rules, balance tracking
- **Payroll Processing** - Comprehensive salary calculation with statutory compliance
- **Performance Management** - KPI tracking, appraisals, merit/demerit system
- **Statutory Compliance** - PF, ESI, Professional Tax, TDS

### Regional Compliance
- **UAE/GCC Ready** - WPS compliance, end-of-service benefits, gratuity calculation
- **India Ready** - PF, ESI, PT, Form 16, TDS calculations
- **Multi-currency** support

## Installation

### As NPM Package
```bash
npm install @sak-erp/hr-module
# or
pnpm add @sak-erp/hr-module
```

### As Git Submodule
```bash
git submodule add https://github.com/your-org/hr-module.git packages/hr-module
```

## Usage

### 1. Basic Integration

```typescript
// In your Next.js app
import { HRModule } from '@sak-erp/hr-module';

export default function HRPage() {
  return (
    <HRModule 
      apiBaseUrl={process.env.NEXT_PUBLIC_API_URL}
      region="UAE" // or "INDIA" or "GLOBAL"
      features={{
        payroll: true,
        attendance: true,
        performance: true,
        compliance: true
      }}
    />
  );
}
```

### 2. Backend API Integration

```typescript
// In your NestJS/Express backend
import { HRController, HRService } from '@sak-erp/hr-module/backend';

@Module({
  imports: [HRModule.forRoot({
    region: 'UAE',
    currency: 'AED',
    compliance: {
      wps: true,
      endOfServiceBenefits: true
    }
  })],
})
export class AppModule {}
```

### 3. Database Setup

```bash
# Run migrations
npx @sak-erp/hr-module migrate

# Or use provided SQL files
psql -d your_database -f node_modules/@sak-erp/hr-module/migrations/schema.sql
```

## Configuration

### Environment Variables

```env
# Required
HR_MODULE_DB_URL=postgresql://user:pass@localhost:5432/hrdb
HR_MODULE_REGION=UAE
HR_MODULE_CURRENCY=AED

# Optional
HR_MODULE_BIOMETRIC_API=https://biometric-api.example.com
HR_MODULE_WPS_INTEGRATION=true
HR_MODULE_EMAIL_SERVICE=smtp://...
```

### Regional Settings

#### UAE/GCC Configuration
```typescript
{
  region: 'UAE',
  currency: 'AED',
  workWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'], // Fri-Sat weekend
  compliance: {
    wps: true, // Wage Protection System
    endOfServiceBenefits: {
      enabled: true,
      calculation: 'uae-labour-law' // 21 days for <5 years, 30 days for >5 years
    },
    gratuity: {
      enabled: true,
      formula: 'uae' // End of Service Gratuity as per UAE law
    },
    visaTracking: true,
    emiratesIdTracking: true
  },
  leave: {
    annual: 30, // 30 days annual leave as per UAE law
    sick: 90, // 90 days per year
    maternity: 60 // 60 days maternity leave
  }
}
```

#### India Configuration
```typescript
{
  region: 'INDIA',
  currency: 'INR',
  workWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], // Sat-Sun weekend
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
      state: 'MAHARASHTRA' // State-wise PT slabs
    },
    tds: {
      enabled: true,
      financialYear: '2024-25'
    },
    gratuity: {
      enabled: true,
      formula: 'india' // 15 days for every year
    }
  },
  leave: {
    casual: 12,
    sick: 12,
    earned: 15,
    maternity: 182 // 26 weeks
  }
}
```

## Features Deep Dive

### 1. Employee Management
- Complete employee lifecycle
- Document management
- Family details
- Emergency contacts
- Asset tracking
- Hierarchy management

### 2. Attendance System
- Multiple shift support
- Biometric integration
- GPS-based attendance (field employees)
- Overtime calculation
- Late/early tracking
- Attendance regularization
- Work from home tracking

### 3. Leave Management
- Multiple leave types with custom rules
- Leave balance tracking
- Leave accrual (monthly/yearly)
- Leave encashment
- Carry forward rules
- Approval workflows
- Calendar integration

### 4. Payroll Processing
- Comprehensive salary structures
- Multiple components (Basic, HRA, Allowances, Deductions)
- Statutory calculations (PF, ESI, PT, TDS)
- Loan/advance management
- Arrears processing
- Hold salary functionality
- Reimbursements
- Bonus/incentive processing

### 5. Performance Management
- KPI tracking
- Auto-calculated metrics (attendance, punctuality)
- Manual performance ratings
- Merit/demerit system
- Appraisal cycles
- 360-degree feedback
- Performance improvement plans

### 6. Compliance & Reports
#### UAE
- WPS report generation
- End of service benefits calculation
- Visa/Emirates ID expiry tracking
- Labour card management
- MOL compliance reports

#### India
- PF challan reports
- ESI challan reports
- PT returns
- Form 16 generation
- Form 12BB
- Gratuity register

### 7. Self Service Portals
- Employee Self Service (ESS)
  - View payslips
  - Apply leave
  - Regularize attendance
  - Update profile
  - Download documents
  
- Manager Self Service (MSS)
  - Team dashboard
  - Approve requests
  - Performance reviews
  - Team reports

## API Reference

### Employee APIs
```typescript
GET    /api/hr/employees
POST   /api/hr/employees
GET    /api/hr/employees/:id
PUT    /api/hr/employees/:id
DELETE /api/hr/employees/:id
GET    /api/hr/employees/:id/documents
POST   /api/hr/employees/:id/documents
```

### Attendance APIs
```typescript
GET    /api/hr/attendance
POST   /api/hr/attendance
GET    /api/hr/attendance/:employeeId/:month
POST   /api/hr/attendance/bulk-import
PUT    /api/hr/attendance/:id/regularize
```

### Leave APIs
```typescript
GET    /api/hr/leaves
POST   /api/hr/leaves
PUT    /api/hr/leaves/:id/approve
PUT    /api/hr/leaves/:id/reject
GET    /api/hr/leaves/balance/:employeeId
```

### Payroll APIs
```typescript
GET    /api/hr/payroll/salary-components
POST   /api/hr/payroll/salary-components
POST   /api/hr/payroll/process/:month
GET    /api/hr/payroll/payslips/:employeeId/:month
POST   /api/hr/payroll/generate-reports
```

### Performance APIs
```typescript
GET    /api/hr/performance/kpi/:employeeId/:month
POST   /api/hr/performance/merit-demerit
GET    /api/hr/performance/appraisals
POST   /api/hr/performance/appraisals
```

## Database Schema

The module requires the following tables:
- `employees` - Employee master data
- `employee_bank_details` - Bank information
- `employee_statutory_info` - PF, ESI, UAN, etc.
- `attendance` - Daily attendance records
- `leaves` - Leave applications
- `leave_balances` - Current leave balances
- `salary_components` - Salary structure
- `monthly_payroll` - Processed payroll records
- `payslips` - Generated payslips
- `merit_demerit` - Performance records
- `appraisals` - Appraisal cycles and ratings

SQL migration files are included in `migrations/` folder.

## Customization

### Custom Salary Components
```typescript
import { SalaryComponentType } from '@sak-erp/hr-module';

const customComponents = [
  {
    name: 'Housing Allowance',
    type: SalaryComponentType.ALLOWANCE,
    calculation: (basicSalary) => basicSalary * 0.25,
    taxable: true
  },
  {
    name: 'Transport Allowance',
    type: SalaryComponentType.ALLOWANCE,
    calculation: () => 1000, // Fixed amount
    taxable: false
  }
];
```

### Custom Leave Types
```typescript
const customLeaveTypes = [
  {
    code: 'HAJJ',
    name: 'Hajj Leave',
    maxDays: 30,
    accrual: 'once-in-lifetime',
    isPaid: true,
    applicableRegion: 'UAE'
  }
];
```

## Multi-tenancy Support

The module supports multi-tenancy out of the box:

```typescript
<HRModule 
  tenant={{
    id: 'company-123',
    name: 'Acme Corp',
    region: 'UAE',
    settings: {...}
  }}
/>
```

## Roadmap

- [ ] WhatsApp integration for notifications
- [ ] Mobile app (React Native)
- [ ] AI-powered resume screening
- [ ] Chatbot for employee queries
- [ ] Advanced analytics & BI
- [ ] Integration with popular HRMS (SAP, Workday)
- [ ] Blockchain-based certificates

## Support

- Documentation: https://docs.hr-module.com
- Issues: https://github.com/your-org/hr-module/issues
- Email: support@mizantra.ae

## License

MIT License - free for commercial use

## Contributing

Contributions welcome! Please read our contributing guidelines.

---

Built with ❤️ by SAK Solutions for the Manufacturing & HR industry
