'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';

type Signal = { key: string; module: string; title: string; count: number; expected_value: number; route: string };
type Action = {
  id: string; signal_key: string; title: string; source_module: string; source_reference?: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED'; priority: string;
  expected_value: number; realised_value: number; note?: string | null; created_at: string;
};
type Overview = { signals: Signal[]; actions: Action[]; expected_value: number; realised_value: number };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));

export default function MarginControlPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', source_module: 'SALES', signal_key: 'CASH_COLLECTION', priority: 'MEDIUM', expected_value: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setOverview(await apiClient.get<Overview>('/margin-control/overview')); }
    catch (err: any) { setError(err?.message || 'Unable to load the control tower.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolve = async (action: Action) => {
    setSavingId(action.id);
    try {
      await apiClient.patch(`/margin-control/actions/${action.id}`, { status: 'RESOLVED', realised_value: action.realised_value || action.expected_value });
      await load();
    } catch (err: any) { setError(err?.message || 'Unable to resolve this action.'); }
    finally { setSavingId(null); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true); setError('');
    try {
      await apiClient.post('/margin-control/actions', { ...form, title: form.title.trim(), expected_value: Number(form.expected_value || 0) });
      setForm({ title: '', source_module: 'SALES', signal_key: 'CASH_COLLECTION', priority: 'MEDIUM', expected_value: '' });
      await load();
    } catch (err: any) { setError(err?.message || 'Unable to create this action.'); }
    finally { setCreating(false); }
  };

  const actions = overview?.actions || [];
  const openActions = actions.filter((action) => !['RESOLVED', 'DISMISSED'].includes(action.status));
  const captured = Number(overview?.realised_value || 0);
  const expected = Number(overview?.expected_value || 0);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-2 sm:p-4">
      <section className="rounded-2xl bg-gradient-to-r from-[#153F35] to-[#276653] p-5 text-white shadow-lg sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-100"><TrendingUp size={18} /> ROI command centre</div>
            <h1 className="text-2xl font-bold sm:text-3xl">Margin-to-Cash Control Tower</h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50">Turn operational exceptions into owned actions and verifiable financial outcomes.</p>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25 disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Refresh
          </button>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Open actions" value={String(openActions.length)} hint="Require an owner and follow-through" />
        <Metric label="Expected value protected" value={money(expected)} hint="From actions entered by your team" />
        <Metric label="Value realised" value={money(captured)} hint={expected ? `${Math.round((captured / expected) * 100)}% of expected value` : 'Record realised value when resolved'} />
      </section>

      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><AlertTriangle className="text-amber-600" size={20} /><h2 className="font-semibold text-slate-900">Live business signals</h2></div>
        {loading ? <Loading /> : (overview?.signals.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{overview.signals.map((signal) => (
          <a key={signal.key} href={signal.route} className="group rounded-lg border border-slate-200 p-4 transition hover:border-emerald-400 hover:shadow-sm">
            <div className="text-xs font-semibold tracking-wide text-slate-500">{signal.module}</div>
            <div className="mt-1 font-semibold text-slate-900">{signal.title}</div>
            <div className="mt-3 flex items-end justify-between"><span className="text-2xl font-bold text-amber-700">{signal.count}</span><ArrowRight size={18} className="text-slate-400 group-hover:text-emerald-600" /></div>
            {signal.expected_value > 0 && <div className="mt-1 text-xs text-slate-500">At risk: {money(signal.expected_value)}</div>}
          </a>
        ))}</div> : <Empty text="No active operational signals. The tower will surface stock, WIP, collection and SLA risks as they arise." />)}
      </section>

      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Log an ROI action</h2>
        <p className="mt-1 text-sm text-slate-500">Capture the expected value before the intervention, then record realised value when it is resolved.</p>
        <form onSubmit={create} className="mt-4 grid gap-3 md:grid-cols-5">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Action to take" className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
          <select value={form.source_module} onChange={(e) => setForm({ ...form, source_module: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>SALES</option><option>INVENTORY</option><option>PRODUCTION</option><option>SERVICE</option><option>FINANCE</option></select>
          <input value={form.expected_value} onChange={(e) => setForm({ ...form, expected_value: e.target.value })} inputMode="decimal" placeholder="Expected ₹ value" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button disabled={creating || !form.title.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F6B55] px-3 py-2 text-sm font-semibold text-white hover:bg-[#155240] disabled:opacity-50">{creating && <Loader2 size={16} className="animate-spin" />} Log action</button>
        </form>
      </section>

      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">ROI action ledger</h2><p className="text-sm text-slate-500">Actions are a test-safe audit trail of margin protected and cash released.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{actions.length} total</span></div>
        {loading ? <Loading /> : actions.length ? <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-3">Action</th><th className="px-2 py-3">Priority</th><th className="px-2 py-3">Expected</th><th className="px-2 py-3">Realised</th><th className="px-2 py-3">Status</th><th className="px-2 py-3"></th></tr></thead><tbody>{actions.map((action) => <tr key={action.id} className="border-b border-slate-100 last:border-0"><td className="px-2 py-3"><div className="font-medium text-slate-900">{action.title}</div><div className="text-xs text-slate-500">{action.source_module}{action.source_reference ? ` · ${action.source_reference}` : ''}</div></td><td className="px-2 py-3"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{action.priority}</span></td><td className="px-2 py-3">{money(action.expected_value)}</td><td className="px-2 py-3">{money(action.realised_value)}</td><td className="px-2 py-3"><span className="text-xs font-semibold text-slate-600">{action.status.replace('_', ' ')}</span></td><td className="px-2 py-3">{!['RESOLVED', 'DISMISSED'].includes(action.status) && <button onClick={() => resolve(action)} disabled={savingId === action.id} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{savingId === action.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Resolve</button>}</td></tr>)}</tbody></table></div> : <Empty text="No ROI actions have been logged yet. Use the operational signals above to create the first owned action through the API-enabled workflow." />}
      </section>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div><div className="mt-1 text-xs text-slate-500">{hint}</div></div>; }
function Loading() { return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading control-tower data…</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-lg bg-slate-50 p-6 text-sm text-slate-500">{text}</div>; }
