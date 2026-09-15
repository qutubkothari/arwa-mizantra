import { redirect } from 'next/navigation';

export default function PayrollRedirectPage() {
  redirect('/dashboard/hr/management?section=management&tab=payroll');
}
