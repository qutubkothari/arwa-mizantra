'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

/**
 * Override labels for specific path segments.
 * Add entries here whenever a route segment ID isn't human-readable.
 */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  purchase: 'Purchase',
  vendors: 'Vendors',
  orders: 'Purchase Orders',
  requisitions: 'Requisitions',
  grn: 'GRN',
  'debit-notes': 'Debit Notes',
  inventory: 'Inventory',
  items: 'Stock Master',
  import: 'Import',
  siv: 'SIV',
  srv: 'SRV',
  production: 'Production',
  'job-orders': 'Job Orders',
  'smart-items': 'Create Job Order',
  bom: 'BOM',
  accounts: 'Accounts',
  payables: 'Payables',
  sales: 'Sales',
  hr: 'HR',
  uid: 'UID Tracking',
  trace: 'Trace',
  deployment: 'Deployment',
  quality: 'Quality',
  service: 'Service',
  documents: 'Documents',
  settings: 'Settings',
  manager: 'Manager Approvals',
  'shop-floor': 'Shop Floor',
  'work-stations': 'Work Stations',
  debug: 'Debug',
  unauthorized: 'Unauthorized',
};

function toLabel(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // Convert kebab-case or camelCase to Title Case
  return segment
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Auto-generated breadcrumbs from the current pathname.
 * Mount this inside the dashboard layout header.
 */
export function Breadcrumbs({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Build cumulative hrefs
  const crumbs = segments.map((segment, idx) => ({
    label: toLabel(segment),
    href: '/' + segments.slice(0, idx + 1).join('/'),
    isLast: idx === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1 text-sm ${className}`}>
      <Link
        href="/dashboard"
        className="text-gray-400 hover:text-amber-700 transition-colors flex items-center"
        aria-label="Dashboard home"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" aria-hidden />
          {crumb.isLast ? (
            <span className="font-medium text-gray-700 truncate max-w-[180px]" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="text-gray-400 hover:text-amber-700 transition-colors truncate max-w-[140px]"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
