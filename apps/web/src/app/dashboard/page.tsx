'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileText,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  WalletCards,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiClient } from '../../../lib/api-client';
import { getDefaultLandingPath, isAdminLike } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth.store';

export const dynamic = 'force-dynamic';

type Tone = 'neutral' | 'good' | 'warning' | 'danger';

type CockpitMetric = {
  key: string;
  label: string;
  value: number;
  displayValue?: string;
  tone: Tone;
  route?: string;
  helper?: string;
};

type CockpitException = {
  type: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'danger';
  route: string;
  value?: string;
};

type RoiOpportunity = {
  key: string;
  area: string;
  title: string;
  action: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
  count: number;
  amount?: number;
  route: string;
};

type CockpitData = {
  generatedAt: string;
  metrics: CockpitMetric[];
  summary: any;
  exceptions: CockpitException[];
  activity: Array<{
    type: string;
    number: string;
    status: string;
    amount?: number;
    date?: string;
    route: string;
  }>;
  aging: {
    purchaseOrders: Record<string, number>;
    grns: Record<string, number>;
  };
  moduleHealth: Array<{ module: string; status: string; route: string }>;
  roiOpportunities: RoiOpportunity[];
};

type MisData = {
  generatedBy?: string;
  grade?: string;
  riskScore?: number;
  executiveSummary?: string[];
  decisionsRequired?: string[];
};

const metricIcons: Record<string, any> = {
  approvals: ClipboardCheck,
  poExposure: ShoppingCart,
  invoiced: FileText,
  advance: WalletCards,
  stockRisk: PackageSearch,
  wip: Factory,
};

const toneClass: Record<Tone, string> = {
  neutral: 'border-[#D8C8AA] bg-white text-[#2F241B]',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  danger: 'border-red-200 bg-red-50 text-red-900',
};

function formatDate(value?: string) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatAmount(value?: number) {
  if (!value) return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function safeTextList(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (value && typeof value === 'object') {
    const text = [(value as any).summary, (value as any).title, (value as any).message, (value as any).description]
      .find((item) => typeof item === 'string' && item.trim());
    return text ? [text.trim()] : fallback;
  }
  return fallback;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse border border-[#E8DCC4] bg-white" />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse border border-[#E8DCC4] bg-white" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="h-80 animate-pulse border border-[#E8DCC4] bg-white" />
        <div className="h-80 animate-pulse border border-[#E8DCC4] bg-white" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isReady, hydrate } = useAuthStore();
  const [data, setData] = useState<CockpitData | null>(null);
  const [mis, setMis] = useState<MisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const load = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const cockpit = await apiClient.get<CockpitData>('/dashboard/cockpit');
      setData(cockpit);
      // The AI brief may call an external provider. Load it after the
      // operational dashboard is usable instead of blocking the whole page.
      void apiClient
        .get<MisData>('/dashboard/mis')
        .then(setMis)
        .catch(() => setMis(null));
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isReady) return;
    if (!apiClient.isAuthenticated()) {
      router.push('/login');
      return;
    }
    if (!isAdminLike(user)) {
      router.replace(getDefaultLandingPath(user));
      return;
    }
    load();
    const refreshTimer = window.setInterval(() => load(false), 5 * 60 * 1000);
    return () => window.clearInterval(refreshTimer);
  }, [isReady, router, user]);

  const agingData = useMemo(() => {
    const po = data?.aging?.purchaseOrders || {};
    const grn = data?.aging?.grns || {};
    return [
      { bucket: '0-7', po: po.current || 0, grn: grn.current || 0 },
      { bucket: '8-15', po: po.d8to15 || 0, grn: grn.d8to15 || 0 },
      { bucket: '16-30', po: po.d16to30 || 0, grn: grn.d16to30 || 0 },
      { bucket: '30+', po: po.over30 || 0, grn: grn.over30 || 0 },
    ];
  }, [data]);

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-4 text-[#2F241B]">
      <section className="border border-[#E8DCC4] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#E8DCC4] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Executive Cockpit</p>
            <h1 className="text-2xl font-bold">Operations Dashboard</h1>
            <p className="mt-1 text-sm text-[#6F5A45]">
              Live view of approvals, procurement, inventory, production, quality and accounts exposure.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/reports"
              className="inline-flex items-center gap-2 border border-[#C9B894] bg-white px-3 py-2 text-sm font-semibold text-[#3F2D20] hover:bg-[#FAF6ED]"
            >
              <BarChart3 className="h-4 w-4" />
              Reports
            </Link>
            <Link
              href="/dashboard/automation"
              className="inline-flex items-center gap-2 border border-[#C9B894] bg-white px-3 py-2 text-sm font-semibold text-[#3F2D20] hover:bg-[#FAF6ED]"
            >
              <Zap className="h-4 w-4" />
              Automation
            </Link>
            <button
              type="button"
              onClick={() => load()}
              className="inline-flex items-center gap-2 border border-[#8B6F47] bg-[#8B6F47] px-3 py-2 text-sm font-semibold text-white hover:bg-[#735A39]"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
        <div className="grid border-b border-[#E8DCC4] md:grid-cols-4">
          <div className="border-b border-[#E8DCC4] px-4 py-3 md:border-b-0 md:border-r">
            <div className="text-xs font-semibold uppercase text-[#7A6756]">PR Pending</div>
            <div className="mt-1 text-2xl font-bold">{data?.summary?.procurement?.pendingPRs ?? 0}</div>
          </div>
          <div className="border-b border-[#E8DCC4] px-4 py-3 md:border-b-0 md:border-r">
            <div className="text-xs font-semibold uppercase text-[#7A6756]">PO Pending</div>
            <div className="mt-1 text-2xl font-bold">{data?.summary?.procurement?.pendingPOs ?? 0}</div>
          </div>
          <div className="border-b border-[#E8DCC4] px-4 py-3 md:border-b-0 md:border-r">
            <div className="text-xs font-semibold uppercase text-[#7A6756]">GRN Pending QC</div>
            <div className="mt-1 text-2xl font-bold">{data?.summary?.inventory?.draftGRNs ?? 0}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase text-[#7A6756]">Last Refreshed</div>
            <div className="mt-1 text-sm font-semibold">{data?.generatedAt ? new Date(data.generatedAt).toLocaleString('en-IN') : '-'}</div>
          </div>
        </div>
      </section>

      {error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="border border-[#E8DCC4] bg-white">
          <div className="flex items-center justify-between border-b border-[#E8DCC4] px-4 py-3">
            <div><h2 className="font-bold">Today’s priorities</h2><p className="text-xs text-[#7A6756]">The few items that need an owner now.</p></div>
            <AlertTriangle className="h-5 w-5 text-[#B45309]" />
          </div>
          <div className="divide-y divide-[#EFE5D4]">
            {(data?.exceptions || []).slice(0, 4).map((item, index) => <Link key={`${item.type}-${index}`} href={item.route} className="grid gap-2 px-4 py-3 hover:bg-[#FAF6ED] sm:grid-cols-[120px_1fr_auto]"><span className="text-xs font-bold uppercase text-[#8B6F47]">{item.type}</span><span><b className="block text-sm">{item.title}</b><span className="text-xs text-[#6F5A45]">{item.detail}</span></span><ArrowRight className="h-4 w-4 self-center text-[#8B6F47]" /></Link>)}
            {!(data?.exceptions || []).length && <div className="flex items-center gap-2 px-4 py-7 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" />No critical exceptions right now.</div>}
          </div>
        </div>
        <div className="border border-[#E8DCC4] bg-white">
          <div className="flex items-center justify-between border-b border-[#E8DCC4] px-4 py-3"><div><h2 className="font-bold">Executive AI Brief</h2><p className="text-xs text-[#7A6756]">{mis?.generatedBy || 'MIS rules engine'}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${mis?.grade === 'High Risk' ? 'bg-red-100 text-red-800' : mis?.grade === 'Controlled' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{mis?.grade || 'Awaiting MIS'}</span></div>
          <ul className="space-y-2 p-4 text-sm text-[#4A392A]">{safeTextList(mis?.executiveSummary, ['MIS brief is not available yet.']).slice(0, 3).map((line, index) => <li key={index} className="flex gap-2"><span className="text-[#8B6F47]">•</span><span>{line}</span></li>)}</ul>
          <Link href="/dashboard/reports#ai-mis" className="mx-4 mb-4 inline-flex text-xs font-bold text-[#8B6F47] hover:underline">Open full management brief →</Link>
        </div>
      </section>

      <section className="border border-[#E8DCC4] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold">Open a workspace</h2><p className="text-xs text-[#7A6756]">Go directly to the focused module instead of working from the dashboard.</p></div><Link href="/dashboard/active-planner" className="text-sm font-bold text-[#8B6F47] hover:underline">Use Active Planner →</Link></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[{label:'Procurement',href:'/dashboard/purchase',detail:'PRs, POs and suppliers'},{label:'Inventory',href:'/dashboard/inventory',detail:'Stock, GRN and movements'},{label:'Production',href:'/dashboard/production',detail:'Planning and execution'},{label:'Accounts',href:'/dashboard/accounts',detail:'Cash, invoices and controls'},{label:'Sales',href:'/dashboard/sales',detail:'Quotes, orders and billing'},{label:'Quality',href:'/dashboard/quality',detail:'Inspection and CAPA'},{label:'Service',href:'/dashboard/service',detail:'Tickets and visits'},{label:'Reports',href:'/dashboard/reports',detail:'Management analysis'}].map((workspace)=><Link key={workspace.label} href={workspace.href} className="rounded border border-[#E8DCC4] px-3 py-2 hover:border-[#B08D57] hover:bg-[#FAF6ED]"><b className="block text-sm">{workspace.label}</b><span className="text-xs text-[#7A6756]">{workspace.detail}</span></Link>)}</div>
      </section>

      <details className="group border border-[#E8DCC4] bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-bold hover:bg-[#FAF6ED]"><span>Detailed operational dashboard</span><span className="text-xs font-medium text-[#8B6F47] group-open:hidden">Show metrics, aging and transaction flow</span><span className="hidden text-xs font-medium text-[#8B6F47] group-open:inline">Hide detailed view</span></summary>
        <div className="border-t border-[#E8DCC4] p-4">
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(data?.metrics || []).map((metric) => {
          const Icon = metricIcons[metric.key] || ShieldCheck;
          const body = (
            <div className={`min-h-[118px] border p-3 ${toneClass[metric.tone]}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold uppercase text-[#7A6756]">{metric.label}</p>
                  <p className="mt-2 text-2xl font-bold">{metric.displayValue ?? metric.value}</p>
                </div>
                <Icon className="h-5 w-5 shrink-0 text-[#8B6F47]" />
              </div>
              <p className="mt-3 line-clamp-2 text-xs text-[#6F5A45]">{metric.helper}</p>
            </div>
          );
          return metric.route ? (
            <Link key={metric.key} href={metric.route} className="block hover:shadow-sm">
              {body}
            </Link>
          ) : (
            <div key={metric.key}>{body}</div>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="border border-[#E8DCC4] bg-white">
          <div className="flex items-center justify-between border-b border-[#E8DCC4] px-4 py-3">
            <div>
              <h2 className="font-bold">Exception Worklist</h2>
              <p className="text-xs text-[#7A6756]">SAP-style action queue for approvals, stock risk and master-data hygiene.</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-[#B45309]" />
          </div>
          <div className="divide-y divide-[#EFE5D4]">
            {(data?.exceptions || []).length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                No critical exceptions right now.
              </div>
            ) : (
              data?.exceptions.map((item, index) => (
                <Link
                  key={`${item.type}-${index}`}
                  href={item.route}
                  className="grid gap-2 px-4 py-3 hover:bg-[#FAF6ED] sm:grid-cols-[150px_1fr_auto]"
                >
                  <div className="text-xs font-bold uppercase text-[#8B6F47]">{item.type}</div>
                  <div>
                    <div className="font-semibold">{item.title}</div>
                    <div className="text-sm text-[#6F5A45]">{item.detail}</div>
                  </div>
                  <div className="flex items-center gap-3 text-sm font-bold">
                    {item.value && <span>{item.value}</span>}
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="border border-[#E8DCC4] bg-white">
          <div className="border-b border-[#E8DCC4] px-4 py-3">
            <h2 className="font-bold">Document Aging</h2>
            <p className="text-xs text-[#7A6756]">Open PO and pending GRN aging buckets.</p>
          </div>
          <div className="h-72 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#F0E7D8" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fill: '#6F5A45', fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fill: '#6F5A45', fontSize: 12 }} />
                <Tooltip contentStyle={{ border: '1px solid #D8C8AA', borderRadius: 0 }} />
                <Bar dataKey="po" name="PO" fill="#8B6F47" />
                <Bar dataKey="grn" name="GRN" fill="#0F766E" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="border border-[#E8DCC4] bg-white">
        <div className="flex items-center justify-between border-b border-[#E8DCC4] px-4 py-3">
          <div>
            <h2 className="font-bold">ROI Opportunities</h2>
            <p className="text-xs text-[#7A6756]">Next-best actions ranked by operational and cash impact. Values are calculated from live ERP records.</p>
          </div>
          <ShieldCheck className="h-5 w-5 text-[#8B6F47]" />
        </div>
        {(data?.roiOpportunities || []).length === 0 ? (
          <div className="px-4 py-6 text-sm text-emerald-700">No ROI opportunities require attention right now.</div>
        ) : (
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {(data?.roiOpportunities || []).map((opportunity) => (
              <Link key={opportunity.key} href={opportunity.route} className="border border-[#E8DCC4] p-3 transition hover:border-[#B08D57] hover:bg-[#FAF6ED]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#8B6F47]">{opportunity.area}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${opportunity.priority === 'high' ? 'bg-red-100 text-red-800' : opportunity.priority === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                    {opportunity.priority}
                  </span>
                </div>
                <h3 className="mt-2 font-semibold">{opportunity.title}</h3>
                <p className="mt-1 text-sm text-[#6F5A45]">{opportunity.action}</p>
                <div className="mt-3 flex items-end justify-between gap-3 text-xs">
                  <span className="text-[#7A6756]">{opportunity.impact}</span>
                  <span className="shrink-0 font-bold text-[#8B6F47]">Open →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section id="ai-mis" className="border border-[#E8DCC4] bg-white">
        <div className="flex flex-col gap-2 border-b border-[#E8DCC4] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold">Executive AI Brief</h2>
            <p className="text-xs text-[#7A6756]">Daily management readout generated from current ERP transactions.</p>
          </div>
          <span className="text-xs font-semibold text-[#8B6F47]">{mis?.generatedBy || 'MIS rules engine'}</span>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${mis?.grade === 'High Risk' ? 'bg-red-100 text-red-800' : mis?.grade === 'Controlled' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {mis?.grade || 'Awaiting MIS'}
              </span>
              {typeof mis?.riskScore === 'number' && <span className="text-xs text-[#6F5A45]">Risk score {mis.riskScore}/100</span>}
            </div>
            <ul className="space-y-2 text-sm text-[#4A392A]">
              {safeTextList(mis?.executiveSummary, ['MIS brief is not available yet.']).slice(0, 4).map((line, index) => <li key={index} className="flex gap-2"><span className="text-[#8B6F47]">•</span><span>{line}</span></li>)}
            </ul>
          </div>
          <div className="border-l border-[#E8DCC4] pl-4">
            <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Decisions required</div>
            <ul className="mt-2 space-y-2 text-sm text-[#4A392A]">
              {safeTextList(mis?.decisionsRequired).slice(0, 4).map((line, index) => <li key={index}>• {line}</li>)}
              {!safeTextList(mis?.decisionsRequired).length && <li className="text-emerald-700">No management decisions are currently flagged.</li>}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="border border-[#E8DCC4] bg-white">
          <div className="border-b border-[#E8DCC4] px-4 py-3">
            <h2 className="font-bold">Sales Revenue Control</h2>
            <p className="text-xs text-[#7A6756]">Pipeline and customer cash exposure from live sales documents.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
            <Link href="/dashboard/sales?tab=quotations" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Open quotes</div><div className="mt-1 text-xl font-bold">{data?.summary?.sales?.openQuotations ?? 0}</div></Link>
            <Link href="/dashboard/sales?tab=quotations" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Quote value</div><div className="mt-1 text-xl font-bold">{formatAmount(data?.summary?.sales?.quoteValue)}</div></Link>
            <Link href="/dashboard/sales?tab=quotations" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Weighted pipeline</div><div className="mt-1 text-xl font-bold">{formatAmount(data?.summary?.sales?.weightedQuoteValue)}</div></Link>
            <Link href="/dashboard/sales?tab=billing" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Open invoices</div><div className="mt-1 text-xl font-bold">{data?.summary?.sales?.openInvoices ?? 0}</div></Link>
            <Link href="/dashboard/sales?tab=collections" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Receivables</div><div className="mt-1 text-xl font-bold">{formatAmount(data?.summary?.sales?.receivables)}</div></Link>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[#E8DCC4] px-4 py-3 text-xs">
            <Link href="/dashboard/sales" className={`rounded-full px-3 py-1 font-semibold ${data?.summary?.sales?.expiringQuotations ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>{data?.summary?.sales?.expiringQuotations ?? 0} quotes expiring in 7 days</Link>
            <Link href="/dashboard/sales" className={`rounded-full px-3 py-1 font-semibold ${data?.summary?.sales?.overdueInvoices ? 'bg-red-100 text-red-900' : 'bg-emerald-100 text-emerald-900'}`}>{data?.summary?.sales?.overdueInvoices ?? 0} overdue customer invoices</Link>
          </div>
        </div>
        <div className="border border-[#E8DCC4] bg-white">
          <div className="border-b border-[#E8DCC4] px-4 py-3">
            <h2 className="font-bold">Service Revenue Protection</h2>
            <p className="text-xs text-[#7A6756]">Open tickets and planned visits requiring operational follow-through.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <Link href="/dashboard/service?tab=tickets" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Open tickets</div><div className="mt-1 text-2xl font-bold">{data?.summary?.service?.openTickets ?? 0}</div><div className="mt-1 text-xs text-[#6F5A45]">SLA and customer risk</div></Link>
            <Link href="/dashboard/service?tab=dispatch" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Active visits</div><div className="mt-1 text-2xl font-bold">{data?.summary?.service?.activeVisits ?? 0}</div><div className="mt-1 text-xs text-[#6F5A45]">Technician capacity</div></Link>
            <Link href="/dashboard/service?tab=tickets" className="border border-red-200 bg-red-50 p-3 hover:bg-red-100"><div className="text-xs uppercase text-red-800">SLA overdue</div><div className="mt-1 text-2xl font-bold text-red-900">{data?.summary?.service?.overdueTickets ?? 0}</div><div className="mt-1 text-xs text-red-800">Escalate today</div></Link>
            <Link href="/dashboard/service?tab=contracts" className="border border-[#E8DCC4] p-3 hover:bg-[#FAF6ED]"><div className="text-xs uppercase text-[#8B6F47]">Warranty / contract</div><div className="mt-1 text-2xl font-bold">{data?.summary?.service?.warrantyTickets ?? 0}</div><div className="mt-1 text-xs text-[#6F5A45]">Protect renewal margin</div></Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="border border-[#E8DCC4] bg-white">
          <div className="border-b border-[#E8DCC4] px-4 py-3">
            <h2 className="font-bold">Module Health</h2>
            <p className="text-xs text-[#7A6756]">Operational readiness by functional area.</p>
          </div>
          <div className="divide-y divide-[#EFE5D4]">
            {(data?.moduleHealth || []).map((module) => (
              <Link key={module.module} href={module.route} className="flex items-center justify-between px-4 py-3 hover:bg-[#FAF6ED]">
                <span className="font-semibold">{module.module}</span>
                <span className="text-sm text-[#6F5A45]">{module.status}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="border border-[#E8DCC4] bg-white">
          <div className="border-b border-[#E8DCC4] px-4 py-3">
            <h2 className="font-bold">Recent Transaction Flow</h2>
            <p className="text-xs text-[#7A6756]">Latest PR, PO and GRN documents across the tenant.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm">
              <thead className="bg-[#F5EFE3] text-xs uppercase text-[#6F4E37]">
                <tr>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Document</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE5D4]">
                {(data?.activity || []).map((row, index) => (
                  <tr key={`${row.type}-${row.number}-${index}`} className="hover:bg-[#FAF6ED]">
                    <td className="px-4 py-3 font-bold text-[#8B6F47]">{row.type}</td>
                    <td className="px-4 py-3">
                      <Link href={row.route} className="font-semibold hover:underline">{row.number}</Link>
                    </td>
                    <td className="px-4 py-3">{row.status}</td>
                    <td className="px-4 py-3">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatAmount(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
        </div>
      </details>
    </div>
  );
}
