'use client';

import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import {
  Search,
  ShoppingCart,
  Package,
  Factory,
  CreditCard,
  DollarSign,
  Wrench,
  Users,
  FileText,
  Tag,
  Settings,
  Home,
  ClipboardList,
  BarChart2,
} from 'lucide-react';

interface CmdItem {
  id: string;
  label: string;
  subtitle?: string;
  icon: React.ReactNode;
  href: string;
  group: string;
}

const staticItems: CmdItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Home className="h-4 w-4" />, href: '/dashboard', group: 'Navigation' },
  { id: 'manager', label: 'Manager Approvals', icon: <ClipboardList className="h-4 w-4" />, href: '/dashboard/manager', group: 'Navigation' },
  { id: 'reports', label: 'Reports', subtitle: 'Operational report catalog and cockpit drill-downs', icon: <BarChart2 className="h-4 w-4" />, href: '/dashboard/reports', group: 'Navigation' },
  { id: 'projects', label: 'Projects', subtitle: 'Project master and lifecycle trail', icon: <ClipboardList className="h-4 w-4" />, href: '/dashboard/projects', group: 'Navigation' },

  // Purchase
  { id: 'vendors', label: 'Vendors', subtitle: 'Manage supplier information', icon: <ShoppingCart className="h-4 w-4" />, href: '/dashboard/purchase/vendors', group: 'Purchase' },
  { id: 'purchase-orders', label: 'Purchase Orders', subtitle: 'Create and manage POs', icon: <ShoppingCart className="h-4 w-4" />, href: '/dashboard/purchase/orders', group: 'Purchase' },
  { id: 'requisitions', label: 'Purchase Requisitions', icon: <ShoppingCart className="h-4 w-4" />, href: '/dashboard/purchase/requisitions', group: 'Purchase' },
  { id: 'grn', label: 'Goods Receipt Notes', icon: <Package className="h-4 w-4" />, href: '/dashboard/purchase/grn', group: 'Inventory' },
  { id: 'debit-notes', label: 'Debit Notes', icon: <ShoppingCart className="h-4 w-4" />, href: '/dashboard/purchase/debit-notes', group: 'Purchase' },

  // Inventory
  { id: 'stock-overview', label: 'Stock Overview', icon: <Package className="h-4 w-4" />, href: '/dashboard/inventory', group: 'Inventory' },
  { id: 'stock-master', label: 'Stock Master', icon: <Package className="h-4 w-4" />, href: '/dashboard/inventory/items', group: 'Inventory' },
  { id: 'low-stock-planning', label: 'Low Stock Planning', icon: <Package className="h-4 w-4" />, href: '/dashboard/inventory/low-stock', group: 'Inventory' },
  { id: 'stock-adjustments', label: 'Stock Adjustments', icon: <Package className="h-4 w-4" />, href: '/dashboard/inventory/stock-adjustments', group: 'Inventory' },
  { id: 'siv', label: 'Store Issue Voucher (SIV)', icon: <Package className="h-4 w-4" />, href: '/dashboard/inventory/siv', group: 'Inventory' },
  { id: 'srv', label: 'Store Return Voucher (SRV)', icon: <Package className="h-4 w-4" />, href: '/dashboard/inventory/srv', group: 'Inventory' },

  // Production
  { id: 'create-job-order', label: 'Create Job Order', subtitle: 'Plan BOM shortages, SIV issue, SRV receipt, and QC release', icon: <Factory className="h-4 w-4" />, href: '/dashboard/production/job-orders/smart-items', group: 'Production' },
  { id: 'job-orders', label: 'View Job Orders', subtitle: 'Track production, purchase, SIV, SRV, and QC status', icon: <Factory className="h-4 w-4" />, href: '/dashboard/production/job-orders', group: 'Production' },
  { id: 'subcontracting', label: 'Subcontracting / Outside Processing', subtitle: 'Vendor operations, WIP, scrap, and returns', icon: <Factory className="h-4 w-4" />, href: '/dashboard/production/subcontracting', group: 'Production' },
  { id: 'bom', label: 'Bill of Materials', icon: <Factory className="h-4 w-4" />, href: '/dashboard/bom', group: 'Production' },

  // Accounts
  { id: 'accounting', label: 'Accounts Control Centre', subtitle: 'Chart of accounts, journals, reports, banking and tax', icon: <CreditCard className="h-4 w-4" />, href: '/dashboard/accounts', group: 'Accounts' },
  { id: 'payables', label: 'Accounts Payable', icon: <CreditCard className="h-4 w-4" />, href: '/dashboard/accounts/payables', group: 'Accounts' },

  // Other modules
  { id: 'sales', label: 'Sales & Dispatch', icon: <DollarSign className="h-4 w-4" />, href: '/dashboard/sales', group: 'Sales' },
  { id: 'service', label: 'Service Tickets', icon: <Wrench className="h-4 w-4" />, href: '/dashboard/service', group: 'Service' },
  { id: 'hr-employees', label: 'Employee Self-Service', subtitle: 'Attendance, leave, payslips, and documents', icon: <Users className="h-4 w-4" />, href: '/dashboard/hr/employees', group: 'HR' },
  { id: 'hr-management', label: 'HR Management', subtitle: 'Employees, approvals, payroll, KPI, and configuration', icon: <Users className="h-4 w-4" />, href: '/dashboard/hr/management', group: 'HR' },
  { id: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" />, href: '/dashboard/documents', group: 'Documents' },
  { id: 'uid', label: 'UID Management', icon: <Tag className="h-4 w-4" />, href: '/dashboard/uid', group: 'UID' },
  { id: 'uid-trace', label: 'Trace UID', icon: <Tag className="h-4 w-4" />, href: '/dashboard/uid/trace', group: 'UID' },
  { id: 'uid-deployment', label: 'Deployment Tracking', icon: <Tag className="h-4 w-4" />, href: '/dashboard/uid/deployment', group: 'UID' },
  { id: 'quality', label: 'Quality Control', icon: <BarChart2 className="h-4 w-4" />, href: '/dashboard/quality', group: 'Quality' },
  { id: 'cost-of-quality', label: 'Cost of Poor Quality', subtitle: 'Declared NCR cost exposure and leakage', icon: <BarChart2 className="h-4 w-4" />, href: '/dashboard/quality/cost-of-quality', group: 'Quality' },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, href: '/dashboard/settings', group: 'Settings' },
  { id: 'settings-organization', label: 'Organization', subtitle: 'Company identity, address and regional defaults', icon: <Settings className="h-4 w-4" />, href: '/dashboard/settings/organization', group: 'Settings' },
  { id: 'settings-company-header', label: 'Company Header', subtitle: 'Letterhead header and footer templates', icon: <FileText className="h-4 w-4" />, href: '/dashboard/settings/company-header', group: 'Settings' },
  { id: 'settings-email-configuration', label: 'Email Configuration', subtitle: 'Module-wise sender addresses and reply-to routing', icon: <FileText className="h-4 w-4" />, href: '/dashboard/settings/email-configuration', group: 'Settings' },
  { id: 'master-data-governance', label: 'Master Data Governance', subtitle: 'Controlled customer, supplier, item, bank, tax and GL changes', icon: <Settings className="h-4 w-4" />, href: '/dashboard/settings/master-data-governance', group: 'Settings' },
  { id: 'settings-whatsapp', label: 'WhatsApp Business', subtitle: 'Governed WhatsApp connection, QR pairing and message ledger', icon: <Settings className="h-4 w-4" />, href: '/dashboard/settings/whatsapp', group: 'Settings' },
  { id: 'automation-controls', label: 'Automation & Communication', subtitle: 'Rules, escalations, branches and communication evidence', icon: <Settings className="h-4 w-4" />, href: '/dashboard/automation', group: 'Settings' },
];

let openPaletteFn: (() => void) | null = null;

export function openCommandPalette() {
  openPaletteFn?.();
}

/**
 * Global command palette — Cmd+K / Ctrl+K to open.
 * Provides instant navigation across all modules.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Register global open fn
  useEffect(() => {
    openPaletteFn = () => setOpen(true);
    return () => { openPaletteFn = null; };
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((s) => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;

  // Group items
  const groups = Array.from(new Set(staticItems.map((i) => i.group)));

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+5rem)] pt-4 sm:px-4 sm:pt-20">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-xl">
        <Command
          className="max-h-[calc(100dvh-6.5rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl sm:rounded-2xl"
          shouldFilter={true}
        >
          <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
            <Search className="h-5 w-5 text-gray-400 flex-shrink-0" />
            <Command.Input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              placeholder="Search modules, pages, actions…"
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500 font-mono">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-2 sm:max-h-[400px]">
            <Command.Empty className="py-8 text-center text-sm text-gray-400">
              No results found
            </Command.Empty>

            {groups.map((group) => {
              const items = staticItems.filter((i) => i.group === group);
              return (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-xs [&>[cmdk-group-heading]]:font-semibold [&>[cmdk-group-heading]]:text-gray-400 [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider"
                >
                  {items.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.label} ${item.subtitle ?? ''} ${item.group}`}
                      onSelect={() => handleSelect(item.href)}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-700 cursor-pointer aria-selected:bg-amber-50 aria-selected:text-amber-900 transition-colors"
                    >
                      <span className="flex-shrink-0 text-gray-400 aria-selected:text-amber-600">
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.label}</div>
                        {item.subtitle && (
                          <div className="text-xs text-gray-400 truncate">{item.subtitle}</div>
                        )}
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>

          <div className="border-t border-gray-100 px-4 py-2.5 flex items-center gap-4 text-xs text-gray-400 bg-gray-50">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-xs">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-xs">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-xs">ESC</kbd>
              close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
