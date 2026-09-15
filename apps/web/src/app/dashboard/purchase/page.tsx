'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileText,
  PackageCheck,
  RefreshCw,
  Send,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { apiClient } from '../../../../lib/api-client';
import { ErpButton, ErpPageHeader, ErpStatusBadge } from '../../../components/ui/ErpPrimitives';

type PurchaseStats = {
  pendingPRs: number;
  submittedPRs: number;
  draftPRs: number;
  activePOs: number;
  pendingPOs: number;
  approvedPOs: number;
  activeVendors: number;
  pendingGRNs: number;
  completedGRNs: number;
  openActions: number;
};

const initialStats: PurchaseStats = {
  pendingPRs: 0,
  submittedPRs: 0,
  draftPRs: 0,
  activePOs: 0,
  pendingPOs: 0,
  approvedPOs: 0,
  activeVendors: 0,
  pendingGRNs: 0,
  completedGRNs: 0,
  openActions: 0,
};

function normalizedStatus(row: any) {
  return String(row?.workflow_status || row?.status || '').trim().toUpperCase();
}

function formatCount(value: number) {
  return Number(value || 0).toLocaleString('en-IN');
}

export default function PurchasePage() {
  const router = useRouter();
  const [stats, setStats] = useState<PurchaseStats>(initialStats);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);

      const [prs, pos, vendors, grns] = await Promise.all([
        apiClient.get('/purchase/requisitions').catch(() => []),
        apiClient.get('/purchase/orders').catch(() => []),
        apiClient.get('/purchase/vendors').catch(() => []),
        apiClient.get('/purchase/grn').catch(() => []),
      ]);

      const prList = Array.isArray(prs) ? prs : [];
      const poList = Array.isArray(pos) ? pos : [];
      const vendorList = Array.isArray(vendors) ? vendors : [];
      const grnList = Array.isArray(grns) ? grns : [];

      const draftPRs = prList.filter((pr: any) => normalizedStatus(pr) === 'DRAFT').length;
      const submittedPRs = prList.filter((pr: any) =>
        ['SUBMITTED', 'PENDING', 'AWAITING_APPROVAL'].includes(normalizedStatus(pr)),
      ).length;
      const pendingPOs = poList.filter((po: any) =>
        ['DRAFT', 'PENDING', 'SUBMITTED', 'AWAITING_APPROVAL'].includes(normalizedStatus(po)),
      ).length;
      const approvedPOs = poList.filter((po: any) =>
        ['APPROVED', 'PARTIAL', 'ISSUED'].includes(normalizedStatus(po)),
      ).length;
      const pendingGRNs = grnList.filter((grn: any) =>
        ['DRAFT', 'PENDING', 'SUBMITTED', 'IN_PROGRESS'].includes(normalizedStatus(grn)),
      ).length;

      setStats({
        draftPRs,
        submittedPRs,
        pendingPRs: draftPRs + submittedPRs,
        pendingPOs,
        approvedPOs,
        activePOs: approvedPOs,
        activeVendors: vendorList.filter((vendor: any) => vendor?.is_active !== false).length,
        pendingGRNs,
        completedGRNs: grnList.filter((grn: any) =>
          ['COMPLETED', 'DONE', 'RECEIVED'].includes(normalizedStatus(grn)),
        ).length,
        openActions: submittedPRs + pendingPOs + pendingGRNs,
      });
      setLastUpdated(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setLoading(false);
    }
  };

  const kpis = useMemo(
    () => [
      {
        label: 'Open Actions',
        value: stats.openActions,
        helper: 'PR, PO, and GRN items needing attention',
        icon: AlertTriangle,
        tone: stats.openActions > 0 ? 'warning' : 'success',
      },
      {
        label: 'PRs in Process',
        value: stats.pendingPRs,
        helper: `${formatCount(stats.submittedPRs)} awaiting approval · ${formatCount(stats.draftPRs)} draft`,
        icon: ClipboardList,
        tone: 'info',
      },
      {
        label: 'Active POs',
        value: stats.activePOs,
        helper: `${formatCount(stats.pendingPOs)} pending approval / release`,
        icon: FileText,
        tone: 'success',
      },
      {
        label: 'Pending GRNs',
        value: stats.pendingGRNs,
        helper: `${formatCount(stats.completedGRNs)} receipts completed`,
        icon: PackageCheck,
        tone: stats.pendingGRNs > 0 ? 'warning' : 'neutral',
      },
      {
        label: 'Active Suppliers',
        value: stats.activeVendors,
        helper: 'Approved vendor master scope',
        icon: Users,
        tone: 'neutral',
      },
    ],
    [stats],
  );

  const modules = [
    {
      title: 'Purchase Requisitions',
      label: 'Request to source',
      description: 'Create PRs, validate stock position, route approvals, and initiate RFQs.',
      icon: ClipboardList,
      path: '/dashboard/purchase/requisitions',
      status: `${formatCount(stats.pendingPRs)} open`,
      tone: 'info' as const,
    },
    {
      title: 'Purchase Orders',
      label: 'Commitment control',
      description: 'Create POs from approved PRs, manage quotations, documents, tax, and approvals.',
      icon: FileText,
      path: '/dashboard/purchase/orders',
      status: `${formatCount(stats.activePOs)} active`,
      tone: 'success' as const,
    },
    {
      title: 'Goods Receipt',
      label: 'GRN & receiving',
      description: 'Record receipts against POs, validate discrepancies, QC flow, and invoice readiness.',
      icon: PackageCheck,
      path: '/dashboard/purchase/grn',
      status: `${formatCount(stats.pendingGRNs)} pending`,
      tone: 'warning' as const,
    },
  ];

  const specialistWorkspaces = [
    { label: 'Supplier master', detail: `${formatCount(stats.activeVendors)} active suppliers`, path: '/dashboard/purchase/vendors' },
    { label: 'Strategic sourcing', detail: 'RFQ comparison and award controls', path: '/dashboard/purchase/strategic-sourcing' },
    { label: 'Spend intelligence', detail: 'Spend analysis and supplier insight', path: '/dashboard/purchase/spend-intelligence' },
    { label: 'Contract control', detail: 'Supplier agreements and price ceilings', path: '/dashboard/purchase/contracts' },
    { label: 'Import files', detail: 'Import purchase documentation', path: '/dashboard/purchase/import-files' },
    { label: 'Service entries', detail: 'Accept service-only purchase orders', path: '/dashboard/purchase/service-entries' },
    { label: 'Debit notes', detail: 'Supplier deductions and recovery', path: '/dashboard/purchase/debit-notes' },
  ];

  const workflow = [
    { label: 'PR', caption: 'Demand captured', icon: ClipboardList },
    { label: 'RFQ', caption: 'Supplier quote', icon: Send },
    { label: 'PO', caption: 'Commercial approval', icon: FileText },
    { label: 'GRN', caption: 'Goods received', icon: Truck },
    { label: 'AP', caption: 'Invoice payable', icon: CheckCircle2 },
  ];

  const actionQueue = [
    {
      label: 'PRs awaiting review',
      count: stats.submittedPRs,
      path: '/dashboard/purchase/requisitions',
      tone: stats.submittedPRs > 0 ? 'warning' : 'success',
    },
    {
      label: 'POs pending approval',
      count: stats.pendingPOs,
      path: '/dashboard/purchase/orders',
      tone: stats.pendingPOs > 0 ? 'warning' : 'success',
    },
    {
      label: 'Receipts pending GRN closure',
      count: stats.pendingGRNs,
      path: '/dashboard/purchase/grn',
      tone: stats.pendingGRNs > 0 ? 'warning' : 'success',
    },
  ];

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] space-y-5">
        <ErpPageHeader
          eyebrow="SAP-aligned procurement cockpit"
          title="Purchase Management"
          description="Control source-to-pay execution across requisitions, RFQs, purchase orders, goods receipt, and supplier governance."
          actions={
            <>
              <ErpButton variant="secondary" onClick={fetchStats} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </ErpButton>
              <ErpButton variant="primary" onClick={() => router.push('/dashboard/purchase/requisitions')}>
                <ClipboardList className="h-4 w-4" />
                New PR
              </ErpButton>
            </>
          }
        />

        <section className="rounded-xl border border-[#E8DCC4] bg-white shadow-sm">
          <div className="grid grid-cols-1 divide-y divide-[#E8DCC4] md:grid-cols-5 md:divide-x md:divide-y-0">
            {kpis.map((kpi) => {
              const Icon = kpi.icon;
              return (
                <button
                  key={kpi.label}
                  type="button"
                  onClick={() => {
                    if (kpi.label.includes('PR')) router.push('/dashboard/purchase/requisitions');
                    else if (kpi.label.includes('PO')) router.push('/dashboard/purchase/orders');
                    else if (kpi.label.includes('GRN')) router.push('/dashboard/purchase/grn');
                    else if (kpi.label.includes('Supplier')) router.push('/dashboard/purchase/vendors');
                  }}
                  className="group min-h-28 p-4 text-left transition hover:bg-[#FFFCF5]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">{kpi.label}</p>
                      <p className="mt-2 text-3xl font-bold tabular-nums text-[#2F241B]">
                        {loading ? '…' : formatCount(kpi.value)}
                      </p>
                    </div>
                    <span className="rounded-lg border border-[#E8DCC4] bg-[#FAF9F6] p-2 text-[#8B6F47] group-hover:bg-white">
                      <Icon className="h-5 w-5" />
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-[#7A6555]">{loading ? 'Loading procurement data…' : kpi.helper}</p>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E8DCC4] px-4 py-2 text-xs text-[#7A6555]">
            <span>Operational view · source-to-pay controls</span>
            <span>{lastUpdated ? `Last refreshed ${lastUpdated}` : 'Live data pending'}</span>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_22rem]">
          <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#4A3426]">Daily procurement</h2>
                <p className="text-xs text-[#7A6555]">Start the day from the three operational stages: request, commit, and receive.</p>
              </div>
              <ErpStatusBadge status="IN_PROGRESS" label={`${formatCount(stats.openActions)} open actions`} tone={stats.openActions ? 'warning' : 'success'} />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {modules.map((module) => {
                const Icon = module.icon;
                return (
                  <button
                    key={module.path}
                    type="button"
                    onClick={() => router.push(module.path)}
                    className="group rounded-lg border border-[#E8DCC4] bg-[#FFFCF5] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#B9975B] hover:bg-white hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className="rounded-xl bg-[#4A3426] p-2.5 text-white shadow-sm">
                        <Icon className="h-5 w-5" />
                      </span>
                      <ErpStatusBadge status={module.tone === 'warning' ? 'PENDING' : module.tone === 'success' ? 'APPROVED' : 'OPEN'} label={module.status} tone={module.tone} />
                    </div>
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[#8B6F47]">{module.label}</p>
                    <h3 className="mt-1 text-lg font-bold text-[#2F241B]">{module.title}</h3>
                    <p className="mt-2 min-h-10 text-sm leading-5 text-[#7A6555]">{module.description}</p>
                    <div className="mt-4 flex items-center text-sm font-semibold text-[#8B6F47]">
                      Open work center
                      <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                    </div>
                  </button>
                );
              })}
            </div>

            <details className="group mt-4 border-t border-[#E8DCC4] pt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-2 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]">
                <span>Specialist procurement workspaces</span>
                <span className="text-xs font-medium text-[#8B6F47] group-open:hidden">Show sourcing, suppliers, services and controls</span>
                <span className="hidden text-xs font-medium text-[#8B6F47] group-open:inline">Hide specialist workspaces</span>
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {specialistWorkspaces.map((workspace) => (
                  <button
                    key={workspace.path}
                    type="button"
                    onClick={() => router.push(workspace.path)}
                    className="rounded-lg border border-[#E8DCC4] bg-[#FAF9F6] px-3 py-2 text-left transition hover:border-[#B9975B] hover:bg-[#FFFCF5]"
                  >
                    <span className="block text-sm font-semibold text-[#4A3426]">{workspace.label}</span>
                    <span className="block text-xs text-[#7A6555]">{workspace.detail}</span>
                  </button>
                ))}
              </div>
            </details>
          </section>

          <aside className="space-y-5">
            <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#8B6F47]" />
                <h2 className="text-sm font-bold uppercase tracking-wide text-[#4A3426]">Action Required</h2>
              </div>
              <div className="space-y-2">
                {actionQueue.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => router.push(action.path)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#E8DCC4] bg-[#FAF9F6] px-3 py-3 text-left transition hover:border-[#B9975B] hover:bg-[#FFFCF5]"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-[#2F241B]">{action.label}</span>
                      <span className="text-xs text-[#7A6555]">Click to review</span>
                    </span>
                    <ErpStatusBadge
                      status={action.count > 0 ? 'PENDING' : 'DONE'}
                      label={loading ? '…' : formatCount(action.count)}
                      tone={action.tone as any}
                    />
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-[#E8DCC4] bg-[#2F241B] p-4 text-white shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wide text-[#F5EFE3]">SAP Standard Flow</h2>
              <div className="mt-4 space-y-3">
                {workflow.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.label} className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{index + 1}. {step.label}</p>
                        <p className="text-xs text-[#D8C8AA]">{step.caption}</p>
                      </div>
                      {index < workflow.length - 1 ? <ArrowRight className="h-4 w-4 text-[#B9975B]" /> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
