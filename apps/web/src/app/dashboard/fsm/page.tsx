"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Briefcase, Check, ChevronRight,
  CircleDollarSign, CloudOff, Compass, Loader2, MapPin, MessageCircle, Navigation,
  Plus, RefreshCw, Route, Settings, ShieldCheck, Smartphone, UsersRound, Wifi,
} from "lucide-react";
import { apiClient } from "../../../../lib/api-client";
import {
  fsmIdentityFromStorage,
  listFsmOperations,
  queueFsmOperation,
  updateFsmOperation,
  type FsmOfflineOperation,
} from "../../../lib/fsm-offline";

type Visit = {
  id: string; status: string; scheduled_start: string; scheduled_end: string; purpose?: string;
  location_verification?: string; account?: { account_name: string; account_number?: string };
  site?: { site_name: string; address_text?: string; latitude?: number; longitude?: number };
};
type Workspace = { visits: Visit[]; recommendations: any[]; sites: any[]; metrics: any | null; capabilities: any | null };
type Tab = "today" | "planner" | "customers" | "sync" | "team" | "exceptions" | "settings";

const DEMO_VISITS: Visit[] = [
  { id: "demo-1", status: "CHECKED_IN", scheduled_start: "2026-09-11T09:30:00Z", scheduled_end: "2026-09-11T10:15:00Z", purpose: "Product review and replenishment", location_verification: "VERIFIED", account: { account_name: "Nile Trade Distribution", account_number: "ACC-EG-001" }, site: { site_name: "Cairo Head Office", address_text: "Nasr City, Cairo", latitude: 30.0595, longitude: 31.3301 } },
  { id: "demo-2", status: "PLANNED", scheduled_start: "2026-09-11T11:15:00Z", scheduled_end: "2026-09-11T12:00:00Z", purpose: "Quotation follow-up", location_verification: "NOT_CAPTURED", account: { account_name: "Alexandria Engineering Co.", account_number: "ACC-EG-014" }, site: { site_name: "Project Office", address_text: "Heliopolis, Cairo", latitude: 30.0917, longitude: 31.3233 } },
  { id: "demo-3", status: "PLANNED", scheduled_start: "2026-09-11T14:00:00Z", scheduled_end: "2026-09-11T14:45:00Z", purpose: "Collection commitment", location_verification: "NOT_CAPTURED", account: { account_name: "Delta Food Industries", account_number: "ACC-EG-022" }, site: { site_name: "Giza Branch", address_text: "Dokki, Giza", latitude: 30.0384, longitude: 31.2122 } },
];

const STATUS_STYLE: Record<string, string> = {
  PLANNED: "bg-sky-50 text-sky-700 border-sky-200", EN_ROUTE: "bg-amber-50 text-amber-800 border-amber-200",
  CHECKED_IN: "bg-emerald-50 text-emerald-700 border-emerald-200", REPORT_DRAFT: "bg-violet-50 text-violet-700 border-violet-200",
  COMPLETED: "bg-stone-100 text-stone-700 border-stone-200", MISSED: "bg-red-50 text-red-700 border-red-200",
};

function time(value: string) { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function dateValue() { return new Date().toISOString().slice(0, 10); }

export default function FieldSalesPage({
  searchParams,
}: {
  searchParams?: { demo?: string | string[] };
}) {
  const demo = searchParams?.demo === "1";
  const [tab, setTab] = useState<Tab>("today");
  const [data, setData] = useState<Workspace>({ visits: [], recommendations: [], sites: [], metrics: null, capabilities: null });
  const [selected, setSelected] = useState<Visit | null>(null);
  const [queue, setQueue] = useState<FsmOfflineOperation[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const identity = useMemo(() => fsmIdentityFromStorage(), []);

  const loadQueue = useCallback(async () => {
    if (!identity.tenantId || !identity.userId) return;
    try { setQueue(await listFsmOperations(identity)); } catch (e: any) { setError(e?.message || "Offline storage is unavailable."); }
  }, [identity]);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    if (demo) {
      setData({
        visits: DEMO_VISITS,
        sites: DEMO_VISITS.map((visit) => ({ ...visit.site, account: visit.account, geocode_status: "VERIFIED" })),
        recommendations: [
          { account: { account_name: "Crescent Medical Supplies" }, score: 74, reasons: ["Customer has not been visited recently", "Open commercial opportunity"] },
          { account: { account_name: "Delta Food Industries" }, score: 68, reasons: ["Receivable follow-up is due"] },
        ],
        metrics: { planned: 18, completed: 12, missed: 1, location_verified: 11, compliance_rate: 66.7 },
        capabilities: { routing: { provider: "STRAIGHT_LINE", available: false }, commercial: { revalidation_required: true } },
      });
      setBusy(false); return;
    }
    const settled = await Promise.allSettled([
      apiClient.get<Visit[]>("/fsm/visits", { date: dateValue() }),
      apiClient.get<any[]>("/fsm/recommendations"),
      apiClient.get<any[]>("/fsm/sites", { status: "ACTIVE" }),
      apiClient.get<any>("/fsm/manager/dashboard", { date: dateValue() }),
      apiClient.get<any>("/fsm/capabilities"),
    ]);
    const value = <T,>(index: number, fallback: T): T => settled[index].status === "fulfilled" ? (settled[index] as PromiseFulfilledResult<T>).value : fallback;
    setData({ visits: value(0, []), recommendations: value(1, []), sites: value(2, []), metrics: value(3, null), capabilities: value(4, null) });
    if (settled[0].status === "rejected") setError((settled[0] as PromiseRejectedResult).reason?.message || "Field Sales could not be loaded.");
    setBusy(false);
  }, [demo]);

  useEffect(() => { void load(); void loadQueue(); }, [load, loadQueue]);
  useEffect(() => {
    setOnline(navigator.onLine);
    const connected = () => { setOnline(true); void syncNow(); };
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected); window.addEventListener("offline", disconnected);
    return () => { window.removeEventListener("online", connected); window.removeEventListener("offline", disconnected); };
  });

  async function perform(type: FsmOfflineOperation["type"], payload: any, endpoint: string) {
    setMessage(""); setError("");
    if (!online) {
      await queueFsmOperation(identity, type, payload); await loadQueue(); setMessage("Saved securely on this device. It will sync after reconnecting."); return;
    }
    try { await apiClient.post(endpoint, payload); setMessage("Saved successfully."); await load(); }
    catch (e: any) {
      try { await queueFsmOperation(identity, type, payload); await loadQueue(); setMessage("The server could not be reached. Work is saved on this device for retry."); }
      catch { setError(e?.message || "Unable to save this change."); }
    }
  }

  async function syncNow() {
    if (demo || !online || !identity.tenantId) return;
    const pending = (await listFsmOperations(identity)).filter((item) => ["PENDING", "FAILED"].includes(item.status));
    if (!pending.length) return;
    pending.forEach((item) => void updateFsmOperation(item.client_operation_id, { status: "SYNCING", attempts: item.attempts + 1 }));
    try {
      const result = await apiClient.post<any>("/fsm/sync/batch", { operations: pending.map((item) => ({ client_operation_id: item.client_operation_id, type: item.type, payload: item.payload })) });
      for (const item of result.results || []) await updateFsmOperation(item.client_operation_id, { status: item.status, error: item.message });
      setMessage(`${(result.results || []).filter((item: any) => item.status === "COMMITTED").length} offline change(s) synced.`);
    } catch (e: any) {
      for (const item of pending) await updateFsmOperation(item.client_operation_id, { status: "FAILED", error: e?.message });
    }
    await loadQueue(); await load();
  }

  async function beginVisit(visit: Visit) {
    const endpoint = visit.status === "PLANNED" ? `/fsm/visits/${visit.id}/en-route` : `/fsm/visits/${visit.id}/check-in`;
    if (visit.status === "PLANNED") return perform("VISIT_TRANSITION", { visit_id: visit.id, to_status: "EN_ROUTE" }, endpoint);
    if (!navigator.geolocation) return setError("Location is not available on this device. Ask your manager for a controlled exception.");
    navigator.geolocation.getCurrentPosition(
      (position) => void perform("VISIT_TRANSITION", { visit_id: visit.id, to_status: "CHECKED_IN", location: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: position.coords.accuracy, captured_at: new Date(position.timestamp).toISOString() } }, endpoint),
      () => setError("Location permission was denied or timed out. Your existing work is safe; retry or request an exception."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  const pendingCount = queue.filter((item) => item.status !== "COMMITTED").length;
  const tabs: Array<{ key: Tab; label: string; icon: any }> = [
    { key: "today", label: "My Day", icon: Smartphone }, { key: "planner", label: "Plan & Route", icon: Route },
    { key: "customers", label: "Customers", icon: UsersRound }, { key: "sync", label: `Sync${pendingCount ? ` (${pendingCount})` : ""}`, icon: CloudOff },
    { key: "team", label: "Team", icon: ShieldCheck }, { key: "exceptions", label: "Exceptions", icon: AlertTriangle },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <main className="min-h-screen bg-[#F7F4ED] pb-24 text-[#2F241B] md:pb-8">
      <header className="border-b border-[#E3D7C3] bg-[#FFFDF8] px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8B6F47]">CRM · Field execution</p><h1 className="mt-1 text-2xl font-black md:text-3xl">Field Sales</h1><p className="mt-1 text-sm text-[#745F4E]">Plan the day, visit customers and preserve every commitment.</p></div>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{online ? <Wifi size={15}/> : <CloudOff size={15}/>} {online ? "Online" : "Working offline"}</span>
            <button onClick={() => void load()} className="rounded-xl border border-[#D8C8AA] bg-white p-2.5" aria-label="Refresh"><RefreshCw size={18}/></button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-4 md:px-8 md:py-6">
        {demo && <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><b>Synthetic demonstration data.</b> No customer or personal data is shown.</div>}
        {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
        {error && <div className="mb-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 shrink-0" size={17}/><span>{error}</span></div>}

        <nav className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Field Sales sections">
          {tabs.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setTab(key)} className={`flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold ${tab === key ? "border-[#8B6F47] bg-[#6F4E37] text-white" : "border-[#DFD3C0] bg-white text-[#5D493A]"}`}><Icon size={16}/>{label}</button>)}
        </nav>

        {busy ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-[#8B6F47]" size={28}/></div> : null}
        {!busy && tab === "today" && <Today visits={data.visits} onSelect={setSelected} onBegin={beginVisit}/>} 
        {!busy && tab === "planner" && <Planner visits={data.visits} recommendations={data.recommendations} capabilities={data.capabilities}/>} 
        {!busy && tab === "customers" && <Customers sites={data.sites}/>} 
        {!busy && tab === "sync" && <SyncQueue rows={queue} online={online} onSync={syncNow}/>} 
        {!busy && tab === "team" && <Team metrics={data.metrics}/>} 
        {!busy && tab === "exceptions" && <Exceptions demo={demo}/>} 
        {!busy && tab === "settings" && <SettingsPanel capabilities={data.capabilities}/>} 
      </div>
      {selected && <VisitSheet visit={selected} onClose={() => setSelected(null)} onPerform={perform}/>} 
    </main>
  );
}

function Today({ visits, onSelect, onBegin }: { visits: Visit[]; onSelect: (visit: Visit) => void; onBegin: (visit: Visit) => void }) {
  const next = visits.find((visit) => !["COMPLETED", "CANCELLED", "MISSED"].includes(visit.status));
  return <div className="grid gap-5 lg:grid-cols-[1.45fr_.75fr]">
    <section><div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-bold uppercase text-[#8B6F47]">Today · {new Date().toLocaleDateString(undefined, { day: "numeric", month: "long" })}</p><h2 className="text-xl font-black">My customer visits</h2></div><span className="text-sm text-[#756252]">{visits.length} planned</span></div>
      <div className="space-y-3">{visits.length ? visits.map((visit, index) => <article key={visit.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${next?.id === visit.id ? "border-[#B9975B] ring-2 ring-[#EAD9B9]" : "border-[#E3D7C3]"}`}>
        <div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0E7D8] font-black text-[#6F4E37]">{index + 1}</div><button className="min-w-0 flex-1 text-left" onClick={() => onSelect(visit)}><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{visit.account?.account_name || "Customer"}</h3><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[visit.status] || "bg-stone-50"}`}>{visit.status.replace(/_/g, " ")}</span></div><p className="mt-1 text-sm text-[#745F4E]">{time(visit.scheduled_start)}–{time(visit.scheduled_end)} · {visit.site?.site_name || "Site not selected"}</p><p className="mt-1 truncate text-xs text-[#8B7868]"><MapPin className="mr-1 inline" size={13}/>{visit.site?.address_text || "Address needs confirmation"}</p></button><ChevronRight className="mt-2 text-[#9A846F]" size={20}/></div>
        {!['COMPLETED','CANCELLED','MISSED'].includes(visit.status) && <button onClick={() => void onBegin(visit)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#6F4E37] px-4 py-3 text-sm font-bold text-white">{visit.status === "PLANNED" ? <><Navigation size={17}/> Start travelling</> : visit.status === "EN_ROUTE" ? <><MapPin size={17}/> Check in</> : <><Briefcase size={17}/> Open visit</>}</button>}
      </article>) : <Empty title="No visits planned" text="Choose a recommendation or ask your manager to publish today’s plan."/>}</div>
    </section>
    <aside className="space-y-4"><div className="rounded-2xl bg-[#164E3B] p-5 text-white"><p className="text-xs font-bold uppercase tracking-wider text-emerald-200">Day at a glance</p><div className="mt-4 grid grid-cols-3 gap-2 text-center"><Metric value={visits.length} label="Planned"/><Metric value={visits.filter(v=>v.status==='COMPLETED').length} label="Done"/><Metric value={visits.filter(v=>v.status==='CHECKED_IN').length} label="Active"/></div></div><div className="rounded-2xl border border-[#E3D7C3] bg-white p-5"><h3 className="font-extrabold">Safe field workflow</h3><ol className="mt-3 space-y-3 text-sm text-[#6F5A49]"><li>1. Start travelling when you leave.</li><li>2. Check in with a fresh GPS sample.</li><li>3. Save notes at any time—even offline.</li><li>4. Submit the report, then check out.</li></ol></div></aside>
  </div>;
}

function Planner({ visits, recommendations, capabilities }: any) {
  return <div className="grid gap-5 lg:grid-cols-2"><Card title="Today’s sequence" eyebrow="Route preview"><div className="space-y-3">{visits.map((visit: Visit, i: number) => <div key={visit.id} className="flex items-center gap-3 rounded-xl bg-[#F8F4EC] p-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6F4E37] text-sm font-bold text-white">{i+1}</span><div className="min-w-0 flex-1"><b className="block truncate text-sm">{visit.account?.account_name}</b><span className="text-xs text-[#796654]">{time(visit.scheduled_start)} · {visit.site?.site_name}</span></div></div>)}</div><div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><Route className="mr-1 inline" size={14}/> {capabilities?.routing?.available ? `Route provider: ${capabilities.routing.provider}` : "Road routing is unavailable. Manual sequence and device navigation remain available; displayed estimates are straight-line only."}</div></Card>
    <Card title="Suggested customers" eyebrow="Explainable recommendations"><div className="space-y-3">{recommendations.slice(0,6).map((row: any) => <div key={row.account?.id || row.account?.account_name} className="rounded-xl border border-[#E7DDCC] p-3"><div className="flex items-start justify-between gap-3"><b className="text-sm">{row.account?.account_name}</b><span className="rounded-full bg-[#E8F4EC] px-2 py-1 text-xs font-bold text-[#176B49]">Score {row.score}</span></div><p className="mt-2 text-xs text-[#755F4D]">{(row.reasons || []).join(" · ")}</p><button className="mt-3 text-xs font-bold text-[#6F4E37]">Add to draft plan <ArrowRight className="inline" size={13}/></button></div>)}</div></Card></div>;
}

function Customers({ sites }: any) { return <Card title="Customer sites" eyebrow="CRM accounts and coverage"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sites.map((site: any, index: number) => <div key={site.id || index} className="rounded-2xl border border-[#E3D7C3] p-4"><div className="flex items-start justify-between"><div className="rounded-xl bg-[#F1E9DC] p-2 text-[#7A5937]"><MapPin size={19}/></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${site.geocode_status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{site.geocode_status || 'MISSING'}</span></div><h3 className="mt-3 font-extrabold">{site.account?.account_name || site.site_name}</h3><p className="text-sm text-[#765F4D]">{site.site_name}</p><p className="mt-2 text-xs text-[#897464]">{site.address_text || 'Address needs confirmation'}</p></div>)}</div></Card>; }

function SyncQueue({ rows, online, onSync }: any) { return <Card title="Offline work" eyebrow="Durable, identity-separated outbox"><div className="mb-4 flex items-center justify-between rounded-xl bg-[#F7F2E8] p-4"><div><b>{rows.filter((r:any)=>r.status!=="COMMITTED").length} waiting</b><p className="text-xs text-[#786554]">Committed operations remain visible as evidence until logout.</p></div><button disabled={!online} onClick={() => void onSync()} className="rounded-xl bg-[#6F4E37] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Sync now</button></div>{rows.length ? <div className="space-y-2">{rows.map((row:any)=><div key={row.client_operation_id} className="flex items-center justify-between rounded-xl border p-3 text-sm"><div><b>{row.type.replace(/_/g,' ')}</b><p className="text-xs text-[#846F5E]">{new Date(row.created_at).toLocaleString()}</p></div><span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-bold">{row.status}</span></div>)}</div>:<Empty title="Everything is synced" text="Offline notes, reports and supported commands will appear here."/>}</Card>; }

function Team({ metrics }: any) { const m=metrics||{}; return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Kpi label="Published plan" value={m.planned??0}/><Kpi label="Completed" value={m.completed??0}/><Kpi label="Missed" value={m.missed??0}/><Kpi label="Location verified" value={m.location_verified??0}/><Kpi label="Plan compliance" value={`${m.compliance_rate??0}%`}/><div className="sm:col-span-2 xl:col-span-5 rounded-xl border border-[#E3D7C3] bg-white p-4 text-sm text-[#6F5A49]">Metrics retain the original published-plan denominator. Cancelled documents and mixed currencies are not silently combined.</div></div>; }

function Exceptions({ demo }: {demo:boolean}) { const rows=demo?[{id:'x1',account:'Sphinx Office Systems',rep:'Mona Hassan',reason:'GPS accuracy 185 m',distance:'92 m',status:'PENDING'}]:[]; return <Card title="Location exceptions" eyebrow="Independent manager review">{rows.length?<div className="space-y-3">{rows.map(row=><div key={row.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{row.account}</b><p className="text-xs text-amber-900">{row.rep} · {row.reason} · detected {row.distance}</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold">{row.status}</span></div><div className="mt-3 flex gap-2"><button className="rounded-lg bg-[#176B49] px-3 py-2 text-xs font-bold text-white">Approve with reason</button><button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700">Reject</button></div></div>)}</div>:<Empty title="No exceptions in your scope" text="Out-of-policy or unavailable location evidence appears here for review."/>}</Card>; }

function SettingsPanel({ capabilities }: any) { return <div className="grid gap-5 lg:grid-cols-2"><Card title="Visit policy" eyebrow="Tenant controlled"><div className="space-y-3 text-sm"><Setting label="Check-in radius" value="150 metres"/><Setting label="Maximum GPS age" value="120 seconds"/><Setting label="Maximum GPS accuracy" value="100 metres"/><Setting label="Report before checkout" value="Required"/></div></Card><Card title="Operational capabilities" eyebrow="Safe degradation"><div className="space-y-3 text-sm"><Setting label="Offline queue" value="IndexedDB + manual sync"/><Setting label="Routing" value={capabilities?.routing?.available?capabilities.routing.provider:'Manual + straight-line preview'}/><Setting label="ERP documents" value="Authoritative revalidation"/><Setting label="WhatsApp" value="Draft only; explicit send"/></div></Card></div>; }

function VisitSheet({ visit, onClose, onPerform }: any) {
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values: any = Object.fromEntries(new FormData(e.currentTarget));
    const shouldCheckOut = values.action === "checkout";
    const attachmentIds: string[] = [];
    if (attachment) {
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", attachment);
        const uploaded = await apiClient.postForm<any>(`/fsm/visits/${visit.id}/attachments`, form);
        attachmentIds.push(uploaded.id);
      } finally {
        setUploading(false);
      }
    }
    await onPerform("REPORT_SAVE", { visit_id: visit.id, outcome: values.outcome, summary: values.summary, next_action: values.next_action, attachment_ids: attachmentIds, submit: true }, `/fsm/visits/${visit.id}/report`);
    if (shouldCheckOut) await onPerform("VISIT_TRANSITION", { visit_id: visit.id, to_status: "COMPLETED" }, `/fsm/visits/${visit.id}/check-out`);
    onClose();
  }
  return <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6"><section className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-[#FFFDF8] p-5 shadow-2xl md:max-w-2xl md:rounded-[28px] md:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase text-[#8B6F47]">Visit workspace</p><h2 className="text-xl font-black">{visit.account?.account_name}</h2><p className="text-sm text-[#765F4E]">{visit.site?.site_name} · {time(visit.scheduled_start)}</p></div><button onClick={onClose} className="rounded-full bg-[#EFE7DA] px-3 py-2 text-sm font-bold">Close</button></div><div className="mt-5 grid grid-cols-2 gap-3"><button className="rounded-xl border bg-white p-3 text-left text-sm font-bold"><CircleDollarSign className="mb-2 text-[#8B6F47]"/>Commercial context</button><button className="rounded-xl border bg-white p-3 text-left text-sm font-bold"><MessageCircle className="mb-2 text-[#8B6F47]"/>Prepare WhatsApp draft</button></div><form onSubmit={submit} className="mt-5 space-y-3"><h3 className="font-extrabold">Visit report</h3><select name="outcome" required className="w-full rounded-xl border border-[#D8C8AA] bg-white p-3 text-sm"><option value="">Choose outcome</option><option>Successful</option><option>Follow-up required</option><option>No meeting</option><option>Collection promised</option></select><textarea name="summary" required rows={4} placeholder="What happened? Use simple, useful notes." className="w-full rounded-xl border border-[#D8C8AA] bg-white p-3 text-sm"/><input name="next_action" placeholder="Next action" className="w-full rounded-xl border border-[#D8C8AA] bg-white p-3 text-sm"/><label className="block rounded-xl border border-dashed border-[#CDBB9F] bg-white p-3 text-sm"><b>Photo or PDF evidence</b><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e)=>setAttachment(e.target.files?.[0]||null)} className="mt-2 block w-full text-xs"/><span className="mt-1 block text-xs text-[#816E5E]">Private, authorised access · maximum 10 MB</span></label><div className="grid gap-2 sm:grid-cols-2"><button name="action" value="report" disabled={uploading} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#176B49] bg-white p-3 text-sm font-bold text-[#176B49] disabled:opacity-50">{uploading?<Loader2 className="animate-spin" size={17}/>:<Check size={17}/>}Submit report only</button><button name="action" value="checkout" disabled={uploading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#176B49] p-3 text-sm font-bold text-white disabled:opacity-50">{uploading?<Loader2 className="animate-spin" size={17}/>:<Check size={17}/>}Submit &amp; Check Out</button></div><p className="text-center text-xs text-[#816E5E]">Check Out closes this visit after the required report is safely submitted.</p></form></section></div>;
}

function Card({ title, eyebrow, children }: any) { return <section className="rounded-2xl border border-[#E3D7C3] bg-white p-4 shadow-sm md:p-5"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#8B6F47]">{eyebrow}</p><h2 className="mb-4 mt-1 text-lg font-black">{title}</h2>{children}</section>; }
function Empty({title,text}:any){return <div className="rounded-2xl border border-dashed border-[#D8C8AA] bg-[#FCFAF6] p-8 text-center"><Compass className="mx-auto text-[#A58B6C]"/><b className="mt-3 block">{title}</b><p className="mt-1 text-sm text-[#7A6655]">{text}</p></div>}
function Metric({value,label}:any){return <div><b className="block text-2xl">{value}</b><span className="text-xs text-emerald-100">{label}</span></div>}
function Kpi({label,value}:any){return <div className="rounded-2xl border border-[#E3D7C3] bg-white p-5"><p className="text-xs font-bold uppercase text-[#8B6F47]">{label}</p><b className="mt-2 block text-3xl">{value}</b></div>}
function Setting({label,value}:any){return <div className="flex items-center justify-between gap-4 rounded-xl bg-[#F8F4EC] p-3"><span className="text-[#6F5A49]">{label}</span><b className="text-right">{value}</b></div>}
