"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { getAllowedMisPersonas, getMisPersona } from "@/lib/mis-catalog";
import { useAuthStore } from "@/stores/auth.store";

type Metric = { key: string; label: string; value: number; displayValue?: string; helper?: string; route?: string };
type Exception = { type: string; title: string; detail: string; severity: string; route?: string };
type Cockpit = { generatedAt: string; metrics: Metric[]; summary: any; exceptions: Exception[]; currencyCode?: string; scope?: { mode?: string } };
const number = (value: unknown) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value || 0));
const money = (value: unknown, currencyCode = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode, maximumFractionDigits: 0 }).format(Number(value || 0));

function scopedMetrics(domain: string, view: string, data: Cockpit): Metric[] {
  const s = data.summary || {};
  if (domain === "sales" && ["MY_DOCUMENTS", "TENANT_DOCUMENTS"].includes(data.scope?.mode || "")) return data.metrics || [];
  if (domain === "sales") return [
    { key: "leads", label: view === "executive" ? "My open leads" : "Open leads", value: s.sales?.openLeads || 0, helper: "Active opportunities in scope" },
    { key: "pipeline", label: "Open pipeline", value: s.sales?.quoteValue || 0, displayValue: money(s.sales?.quoteValue, data.currencyCode), helper: "Open opportunity value" },
    { key: "weighted", label: "Weighted pipeline", value: s.sales?.weightedQuoteValue || 0, displayValue: money(s.sales?.weightedQuoteValue, data.currencyCode), helper: "Probability-weighted value" },
    { key: "followups", label: "Follow-ups due", value: s.sales?.followUpsDue || 0, helper: "Due now or overdue" },
    { key: "orders", label: "Active orders", value: s.sales?.activeOrders || 0, helper: "Orders in execution" },
    { key: "receivables", label: "Receivables", value: s.sales?.receivables || 0, displayValue: money(s.sales?.receivables, data.currencyCode), helper: "Customer cash exposure" },
  ];
  if (domain === "finance" && view === "manager") return [
    { key: "supplier", label: "Supplier invoice value", value: s.accounts?.invoicedValue || 0, displayValue: money(s.accounts?.invoicedValue, data.currencyCode) },
    { key: "receivables", label: "Customer receivables", value: s.sales?.receivables || 0, displayValue: money(s.sales?.receivables, data.currencyCode) },
    { key: "advance", label: "Supplier advances", value: s.accounts?.advancePaid || 0, displayValue: money(s.accounts?.advancePaid, data.currencyCode) },
    { key: "overdue", label: "Overdue invoices", value: s.sales?.overdueInvoices || 0 },
    { key: "debits", label: "Open debit notes", value: s.accounts?.openDebitNotes || 0 },
    { key: "commitments", label: "Open PO commitment", value: s.procurement?.openPOValue || 0, displayValue: money(s.procurement?.openPOValue, data.currencyCode) },
  ];
  if (domain === "finance") return [
    { key: "invoices", label: "Supplier invoice value", value: s.accounts?.invoicedValue || 0, displayValue: money(s.accounts?.invoicedValue, data.currencyCode) },
    { key: "grn", label: "GRNs pending", value: s.inventory?.draftGRNs || 0 },
    { key: "debits", label: "Open debit notes", value: s.accounts?.openDebitNotes || 0 },
    { key: "approvals", label: "Approvals pending", value: Number(s.procurement?.pendingPRs || 0) + Number(s.procurement?.pendingPOs || 0) },
  ];
  return data.metrics || [];
}

export default function MisWorkspace({ domain, view }: { domain: string; view: string }) {
  const user = useAuthStore((state) => state.user);
  const isReady = useAuthStore((state) => state.isReady);
  const hydrate = useAuthStore((state) => state.hydrate);
  const [data, setData] = useState<Cockpit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const persona = getMisPersona(domain, view);
  const allowed = useMemo(() => getAllowedMisPersonas(user), [user]);
  const permitted = !!persona && allowed.some((item) => item.domain === persona.domain && item.slug === persona.slug);

  useEffect(() => { if (!isReady) hydrate(); }, [hydrate, isReady]);
  const load = async () => {
    setLoading(true); setError(""); setData(null);
    try {
      const scopedUrl = `/dashboard/stakeholder-mis?domain=${encodeURIComponent(domain)}&view=${encodeURIComponent(view)}`;
      const result = await apiClient.get<Cockpit>(scopedUrl);
      setData(result);
    }
    catch (err: any) { setError(err?.message || "MIS data could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (isReady && permitted) void load(); }, [domain, view, isReady, permitted]);

  if (!persona) return <div className="rounded-xl border bg-white p-8"><h1 className="text-xl font-bold">Report workspace not found</h1></div>;
  if (isReady && !permitted) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-8"><h1 className="text-xl font-bold">This report is outside your assigned scope</h1><p className="mt-2 text-sm">Ask your administrator to assign the required report workspace.</p></div>;
  const metrics = data ? scopedMetrics(domain, view, data).slice(0, 6) : [];
  const exceptions = (data?.exceptions || []).slice(0, 5);

  return <main className="space-y-5 p-4 md:p-6">
    <section className="rounded-2xl border border-[#D8C8AA] bg-gradient-to-r from-white to-[#FBF6EC] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-xs font-bold uppercase tracking-widest text-[#8B6F47]">MIS · {persona.audience}</div><h1 className="mt-1 text-2xl font-bold text-[#2F241B] md:text-3xl">{persona.title}</h1><p className="mt-1 max-w-3xl text-sm text-[#6F543E]">{persona.description}</p></div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#B9955A] bg-white px-4 py-2 text-sm font-semibold text-[#5C402D]"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>Refresh</button>
      </div>
    </section>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {data?.scope?.mode === "TERRITORY_MAPPING_REQUIRED" && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No territory is assigned to this manager yet. Configure an active CRM assignment rule to populate this workspace.</div>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {(loading ? Array.from({ length: 6 }) : metrics).map((metric: any, index) => <div key={metric?.key || index} className="min-h-28 rounded-xl border border-[#E2D4BA] bg-white p-4 shadow-sm">
        {loading ? <div className="h-16 animate-pulse rounded bg-stone-100"/> : <><div className="text-xs font-semibold uppercase tracking-wide text-[#80664F]">{metric.label}</div><div className="mt-2 text-2xl font-bold text-[#2F241B]">{metric.displayValue || number(metric.value)}</div><div className="mt-1 text-xs text-[#7C6A5A]">{metric.helper || "Current governed ERP value"}</div></>}
      </div>)}
    </section>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-xl border border-[#D8C8AA] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-[#2F241B]">Attention now</h2><p className="text-xs text-[#7C6A5A]">Only priority exceptions; open the source transaction for detail.</p></div><AlertTriangle className="text-amber-600" size={20}/></div>
        <div className="mt-4 divide-y">{exceptions.map((row, index) => <Link key={`${row.title}-${index}`} href={row.route || "#"} className="flex items-start gap-3 py-3 hover:bg-[#FBF6EC]"><span className={`mt-1 h-2.5 w-2.5 rounded-full ${row.severity === "danger" ? "bg-red-500" : row.severity === "warning" ? "bg-amber-500" : "bg-blue-500"}`}/><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{row.title}</span><span className="block truncate text-xs text-gray-600">{row.detail}</span></span><ArrowRight size={16}/></Link>)}
          {!loading && !exceptions.length && <div className="flex items-center gap-2 py-8 text-sm text-emerald-700"><CheckCircle2 size={18}/>No critical exceptions in this scope.</div>}
        </div>
      </section>
      <section className="rounded-xl border border-[#D8C8AA] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><BarChart3 size={19} className="text-[#8B6F47]"/><h2 className="text-lg font-bold">Drill-down reports</h2></div><div className="mt-3 space-y-2">{persona.quickReports.map((report) => <Link key={report.href + report.label} href={report.href} className="group block rounded-lg border border-[#E7DBC5] p-3 hover:border-[#B9955A] hover:bg-[#FBF6EC]"><span className="flex items-center justify-between text-sm font-semibold">{report.label}<ArrowRight size={15} className="transition-transform group-hover:translate-x-1"/></span><span className="mt-1 block text-xs text-gray-600">{report.description}</span></Link>)}</div></section>
    </div>
    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900"><ShieldCheck size={17}/>Figures are tenant-scoped and link to governed source transactions. Role and screen permissions still apply.</div>
  </main>;
}
