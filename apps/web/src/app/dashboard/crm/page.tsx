"use client";

import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  GitBranch,
  Import,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import { apiClient } from "../../../../lib/api-client";
import {
  hasModulePermission,
  hasScreenPermission,
  readStoredUser,
  shouldEnforcePermissions,
  type StoredUser,
} from "../../../lib/rbac";

type Stage = {
  id: string;
  stage_code: string;
  stage_name: string;
  probability: number;
  colour?: string;
  is_closed: boolean;
  is_won: boolean;
  leads?: Lead[];
  value?: number;
};

type User = { id: string; name: string; email?: string };
type ActivityRow = {
  id: string;
  activity_type: string;
  subject: string;
  notes?: string;
  status: string;
  scheduled_at?: string;
  completed_at?: string;
};
type Lead = {
  id: string;
  lead_number: string;
  company_name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  source: string;
  territory?: string;
  industry?: string;
  product_interest?: string;
  requirement?: string;
  expected_value: number;
  currency_code: string;
  priority: string;
  probability: number;
  lead_score?: number;
  score_explanation?: string[];
  stage_id: string;
  stage?: Stage;
  owner_user_id?: string;
  owner?: User;
  next_follow_up_at?: string;
  expected_close_date?: string;
  customer_id?: string;
  quotation_id?: string;
  activities?: ActivityRow[];
  stage_history?: any[];
};

type Dashboard = {
  kpis: Record<string, number>;
  stages: Stage[];
  leads: Lead[];
  recommended_actions: Array<{
    type: string;
    priority: string;
    lead_id: string;
    title: string;
    action: string;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    message?: string;
    lead_id: string;
    notification_type: string;
    lead?: { lead_number: string; company_name: string };
  }>;
  metadata: {
    stages: Stage[];
    users: User[];
    sources: string[];
    assignment_rules: any[];
    inbound_channels: Array<{ id: string; channel_code: string; channel_name: string; is_active: boolean; last_received_at?: string }>;
  };
  readiness: {
    ready: boolean;
    active_assignment_rules: number;
    configured_rule_owners: number;
    department_sales_candidates: number;
    active_inbound_channels: number;
    whatsapp_capture_active: boolean;
    warnings: string[];
  };
};

type Customer360 = {
  customer: any;
  crm: { leads: any[]; activities: any[] };
  sales: { quotations: any[]; orders: any[] };
  finance: { invoices: any[]; outstanding: number };
  service: { tickets: any[]; installed_assets: any[] };
};

const EMPTY_LEAD = {
  company_name: "",
  contact_person: "",
  email: "",
  phone: "",
  source: "MANUAL",
  campaign: "",
  territory: "",
  industry: "",
  product_interest: "",
  requirement: "",
  expected_value: "",
  currency_code: "INR",
  priority: "MEDIUM",
  next_follow_up_at: "",
  expected_close_date: "",
};

const field =
  "w-full rounded-xl border border-[#D9C9AC] bg-white px-3 py-2.5 text-sm text-[#2F241B] outline-none transition focus:border-[#8B6F47] focus:ring-2 focus:ring-[#EADCC4]";

function money(value: any, currency = "INR") {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency || "INR"} ${amount.toLocaleString("en-IN")}`;
  }
}

function when(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\"' && quoted && text[index + 1] === '\"') {
      value += '\"';
      index += 1;
    } else if (char === '\"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) =>
    header
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_"),
  );
  return rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] || ""]),
      ),
    );
}

function Kpi({ label, value, icon: Icon, tone = "blue" }: any) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <article className="rounded-2xl border border-[#E7DBC5] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
            {label}
          </p>
          <p className="mt-1 text-2xl font-black text-[#2F241B]">{value}</p>
        </div>
        <span className={`rounded-xl p-2.5 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </article>
  );
}

function CrmPageContent() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<
    "pipeline" | "leads" | "followups" | "rules"
  >("pipeline");
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [customer360, setCustomer360] = useState<Customer360 | null>(null);
  const [leadForm, setLeadForm] = useState<any>(EMPTY_LEAD);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [activityForm, setActivityForm] = useState({
    activity_type: "FOLLOW_UP",
    subject: "",
    notes: "",
    scheduled_at: "",
  });
  const [ruleForm, setRuleForm] = useState({
    rule_name: "",
    strategy: "LOAD_BALANCED",
    source_filter: "",
    territory_filter: "",
    industry_filter: "",
    product_filter: "",
    assignee_user_ids: [] as string[],
  });
  const [channelForm, setChannelForm] = useState({ channel_code: "WEBSITE", channel_name: "" });
  const [channelToken, setChannelToken] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");

  const permissionRequired = shouldEnforcePermissions(user);
  const allowed = (
    action: "view" | "create" | "edit" | "delete" | "approve" | "download",
  ) =>
    !permissionRequired ||
    hasScreenPermission(user, "/dashboard/crm", action) ||
    hasModulePermission(user, "Sales Management", action);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await apiClient.get<Dashboard>("/crm/dashboard"));
    } catch (err: any) {
      setError(err?.message || "Unable to load the CRM workspace.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setUser(readStoredUser());
    load();
  }, [load]);
  useEffect(() => {
    const requested = searchParams.get("view");
    if (["pipeline", "leads", "followups", "rules"].includes(requested || "")) {
      setView(requested as "pipeline" | "leads" | "followups" | "rules");
    }
  }, [searchParams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.leads || []).filter((lead) => {
      const searchable = [
        lead.lead_number,
        lead.company_name,
        lead.contact_person,
        lead.email,
        lead.phone,
        lead.product_interest,
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!q || searchable.includes(q)) &&
        (ownerFilter === "ALL" || lead.owner_user_id === ownerFilter) &&
        (sourceFilter === "ALL" || lead.source === sourceFilter)
      );
    });
  }, [data, query, ownerFilter, sourceFilter]);

  const matchingOwners = useMemo(() => {
    const query = ownerSearch.trim().toLowerCase();
    if (!query) return data?.metadata.users || [];
    return (data?.metadata.users || []).filter((candidate) =>
      [candidate.name, candidate.email].filter(Boolean).join(" ").toLowerCase().includes(query),
    );
  }, [data?.metadata.users, ownerSearch]);

  async function openLead(id: string) {
    setSaving(true);
    try {
      setSelected(await apiClient.get<Lead>(`/crm/leads/${id}`));
    } catch (err: any) {
      setError(err?.message || "Unable to open lead.");
    } finally {
      setSaving(false);
    }
  }

  async function createLead(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await apiClient.post<Lead>("/crm/leads", {
        ...leadForm,
        expected_value: Number(leadForm.expected_value || 0),
        next_follow_up_at: leadForm.next_follow_up_at || null,
        expected_close_date: leadForm.expected_close_date || null,
      });
      setShowCreate(false);
      setLeadForm(EMPTY_LEAD);
      setMessage(
        `Lead ${created.lead_number} created and assigned automatically.`,
      );
      await load();
      await openLead(created.id);
    } catch (err: any) {
      setError(err?.message || "Unable to create lead.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStage(stageId: string) {
    if (!selected) return;
    const target = data?.metadata.stages.find((stage) => stage.id === stageId);
    let reason = "";
    if (target?.stage_code === "LOST") {
      reason = window.prompt("Why was this opportunity lost?") || "";
      if (!reason) return;
    }
    setSaving(true);
    try {
      const updated = await apiClient.post<Lead>(
        `/crm/leads/${selected.id}/stage`,
        { stage_id: stageId, reason },
      );
      setSelected(updated);
      setMessage(
        `Moved to ${updated.stage?.stage_name || target?.stage_name}.`,
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to move the lead.");
    } finally {
      setSaving(false);
    }
  }

  async function assign(ownerUserId = "") {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await apiClient.post<Lead>(
        `/crm/leads/${selected.id}/assign`,
        { owner_user_id: ownerUserId },
      );
      setSelected(updated);
      setMessage(
        `Lead assigned to ${updated.owner?.name || "the selected owner"}.`,
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to assign the lead.");
    } finally {
      setSaving(false);
    }
  }

  async function addActivity(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await apiClient.post(`/crm/leads/${selected.id}/activities`, {
        ...activityForm,
        scheduled_at: activityForm.scheduled_at || null,
      });
      setActivityForm({
        activity_type: "FOLLOW_UP",
        subject: "",
        notes: "",
        scheduled_at: "",
      });
      setMessage("Activity saved and the next action was updated.");
      await openLead(selected.id);
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to save activity.");
    } finally {
      setSaving(false);
    }
  }

  async function completeActivity(activity: ActivityRow) {
    const outcome =
      window.prompt("Outcome / result of this activity") || "Completed";
    setSaving(true);
    try {
      await apiClient.patch(`/crm/activities/${activity.id}/complete`, {
        outcome,
      });
      if (selected) await openLead(selected.id);
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to complete activity.");
    } finally {
      setSaving(false);
    }
  }

  async function convert() {
    if (
      !selected ||
      !window.confirm(
        "Convert this lead to the customer master? The CRM history will remain linked.",
      )
    )
      return;
    setSaving(true);
    try {
      const result = await apiClient.post<any>(
        `/crm/leads/${selected.id}/convert`,
        {},
      );
      setMessage(
        `Converted to customer ${result.customer?.customer_code || "successfully"}. You can now prepare the quotation.`,
      );
      await openLead(selected.id);
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to convert the lead.");
    } finally {
      setSaving(false);
    }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post("/crm/assignment-rules", ruleForm);
      setRuleForm({
        rule_name: "",
        strategy: "LOAD_BALANCED",
        source_filter: "",
        territory_filter: "",
        industry_filter: "",
        product_filter: "",
        assignee_user_ids: [],
      });
      setMessage("Assignment rule activated.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to save assignment rule.");
    } finally {
      setSaving(false);
    }
  }

  async function createInboundChannel(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setChannelToken("");
    try {
      const result = await apiClient.post<any>("/crm/inbound-channels", channelForm);
      setChannelForm({ channel_code: "WEBSITE", channel_name: "" });
      setChannelToken(result.token || "");
      setMessage("Inbound channel created. Copy the token now; it will not be shown again.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to create inbound channel.");
    } finally {
      setSaving(false);
    }
  }

  async function rotateInboundChannel(id: string) {
    if (!window.confirm("Rotate this channel token? The previous token will stop working immediately.")) return;
    setSaving(true);
    try {
      const result = await apiClient.post<any>(`/crm/inbound-channels/${id}/rotate-token`, {});
      setChannelToken(result.token || "");
      setMessage("Token rotated. Copy the new token now; it will not be shown again.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to rotate channel token.");
    } finally {
      setSaving(false);
    }
  }

  async function importCsv(file?: File) {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length)
        throw new Error(
          "The CSV must contain a header and at least one lead row.",
        );
      const result = await apiClient.post<any>("/crm/leads/import", { rows });
      setMessage(
        `${result.created?.length || 0} leads imported, ${result.reused?.length || 0} already existed, ${result.rejected?.length || 0} rejected.`,
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to import leads.");
    } finally {
      setSaving(false);
    }
  }

  async function mergeSelectedLead() {
    if (
      !selected ||
      !mergeTargetId ||
      !window.confirm(
        "Merge this duplicate into the selected retained lead? The duplicate will be hidden, while its activities are preserved.",
      )
    )
      return;
    setSaving(true);
    try {
      const retained = await apiClient.post<Lead>(
        `/crm/leads/${selected.id}/merge`,
        {
          target_lead_id: mergeTargetId,
          reason: "Duplicate consolidated by CRM user.",
        },
      );
      setSelected(retained);
      setMergeTargetId("");
      setMessage(`Duplicate consolidated into ${retained.lead_number}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to merge the duplicate lead.");
    } finally {
      setSaving(false);
    }
  }

  async function openCustomer360(customerId?: string) {
    if (!customerId) return;
    setSaving(true);
    try {
      setCustomer360(
        await apiClient.get<Customer360>(`/crm/customers/${customerId}/360`),
      );
    } catch (err: any) {
      setError(err?.message || "Unable to load Customer 360.");
    } finally {
      setSaving(false);
    }
  }

  async function resolveReminder(id: string) {
    setSaving(true);
    try {
      await apiClient.patch(`/crm/notifications/${id}/resolve`, {});
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to resolve the reminder.");
    } finally {
      setSaving(false);
    }
  }

  const meta = data?.metadata;
  return (
    <main className="min-h-screen bg-[#F7F3EA] p-3 text-[#2F241B] md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#203A43] via-[#2C5364] to-[#167D7F] p-5 text-white shadow-lg md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-teal-100">
                <Sparkles className="h-4 w-4" /> Mizantra Intelligence
              </p>
              <h1 className="mt-2 text-3xl font-black">Intelligent CRM</h1>
              <p className="mt-2 max-w-3xl text-sm text-teal-50">
                One connected prospect journey from first enquiry and
                intelligent assignment through quotation, order, collection,
                installed asset and service.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/active-planner"
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/20"
              >
                <Bot className="h-4 w-4" /> Ask Mizantra
              </Link>
              <button
                onClick={load}
                className="rounded-xl border border-white/30 p-2.5 hover:bg-white/20"
                title="Refresh"
              >
                <RefreshCw
                  className={`h-5 w-5 ${busy ? "animate-spin" : ""}`}
                />
              </button>
              {allowed("create") && (
                <>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/20">
                    <Import className="h-4 w-4" /> Import CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      disabled={saving}
                      onChange={(event) => {
                        void importCsv(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#F2C66D] px-4 py-2.5 text-sm font-black text-[#3A2A17] hover:bg-[#FFD986]"
                  >
                    <Plus className="h-4 w-4" /> New lead
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
            <button className="ml-auto" onClick={() => setError("")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {message && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
            <button className="ml-auto" onClick={() => setMessage("")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {data?.readiness && !data.readiness.ready && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wide">CRM go-live readiness</p>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {data.readiness.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
              {allowed("edit") && <button onClick={() => setView("rules")} className="shrink-0 rounded-xl border border-amber-400 bg-white px-4 py-2 text-sm font-black">Complete CRM setup</button>}
            </div>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Kpi
            label="Open leads"
            value={data?.kpis.open_leads || 0}
            icon={UsersRound}
          />
          <Kpi
            label="My leads"
            value={data?.kpis.my_open_leads || 0}
            icon={UserRoundCheck}
            tone="violet"
          />
          <Kpi
            label="Follow-ups due"
            value={data?.kpis.follow_ups_due || 0}
            icon={CalendarClock}
            tone="red"
          />
          <Kpi
            label="Pipeline"
            value={money(data?.kpis.pipeline_value)}
            icon={CircleDollarSign}
            tone="green"
          />
          <Kpi
            label="Weighted forecast"
            value={money(data?.kpis.weighted_pipeline)}
            icon={GitBranch}
            tone="amber"
          />
          <Kpi
            label="Unassigned"
            value={data?.kpis.unassigned || 0}
            icon={AlertCircle}
            tone="red"
          />
        </section>

        <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-[#E7DBC5] bg-white p-1.5 shadow-sm">
          {[
            ["pipeline", "Pipeline", GitBranch],
            ["leads", "All leads", UsersRound],
            ["followups", "Follow-ups", Activity],
            ["rules", "Assignment rules", Settings2],
          ].map(([key, label, Icon]: any) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${view === key ? "bg-[#3E2A1F] text-white" : "text-[#6F5A49] hover:bg-[#F7F3EA]"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {view !== "rules" && (
          <section className="grid gap-3 rounded-2xl border border-[#E7DBC5] bg-white p-3 shadow-sm md:grid-cols-[1fr_220px_200px]">
            <label className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-[#9A8069]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search company, contact, phone, product or lead number…"
                className={`${field} pl-9`}
              />
            </label>
            <select
              className={field}
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
            >
              <option value="ALL">All owners</option>
              {meta?.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <select
              className={field}
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
            >
              <option value="ALL">All sources</option>
              {meta?.sources.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
          </section>
        )}

        {busy && !data ? (
          <div className="flex min-h-72 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#8B6F47]" />
          </div>
        ) : null}

        {view === "pipeline" && data && (
          <section className="overflow-x-auto pb-3">
            <div className="flex min-w-max gap-3">
              {data.stages.map((stage) => {
                const stageLeads = (stage.leads || []).filter((lead) =>
                  filtered.some((item) => item.id === lead.id),
                );
                return (
                  <div
                    key={stage.id}
                    className="w-[300px] shrink-0 rounded-2xl border border-[#E7DBC5] bg-[#FBF9F5]"
                  >
                    <div
                      className="border-b border-[#E7DBC5] p-3"
                      style={{
                        borderTop: `4px solid ${stage.colour || "#8B6F47"}`,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <b>{stage.stage_name}</b>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">
                          {stageLeads.length}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#7A6555]">
                        {stage.probability}% probability ·{" "}
                        {money(
                          stageLeads.reduce(
                            (sum, lead) =>
                              sum + Number(lead.expected_value || 0),
                            0,
                          ),
                        )}
                      </p>
                    </div>
                    <div className="max-h-[560px] space-y-2 overflow-y-auto p-2">
                      {stageLeads.map((lead) => (
                        <button
                          key={lead.id}
                          onClick={() => openLead(lead.id)}
                          className="w-full rounded-xl border border-[#E7DBC5] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#B08D57] hover:shadow-md"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <b className="text-sm">{lead.company_name}</b>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${lead.priority === "URGENT" || lead.priority === "HIGH" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}
                            >
                              {lead.priority}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#806D5C]">
                            {lead.product_interest ||
                              lead.requirement ||
                              "Requirement not recorded"}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                              Score {Math.round(Number(lead.lead_score || 0))}
                            </span>
                          </div>
                          <div className="mt-3 flex items-end justify-between">
                            <span>
                              <b className="block text-sm">
                                {money(lead.expected_value, lead.currency_code)}
                              </b>
                              <small className="text-[#8A7767]">
                                {lead.owner?.name || "Unassigned"}
                              </small>
                            </span>
                            <ArrowRight className="h-4 w-4 text-[#9B7A4E]" />
                          </div>
                          {lead.next_follow_up_at && (
                            <p className="mt-2 border-t pt-2 text-[11px] text-[#8A5A28]">
                              Next: {when(lead.next_follow_up_at)}
                            </p>
                          )}
                        </button>
                      ))}
                      {!stageLeads.length && (
                        <p className="p-6 text-center text-xs text-[#9A8878]">
                          No matching leads
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {view === "leads" && (
          <section className="overflow-hidden rounded-2xl border border-[#E7DBC5] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-[1050px] w-full text-sm">
                <thead className="bg-[#F1E9DC] text-left text-xs uppercase text-[#6F5A49]">
                  <tr>
                    <th className="p-3">Lead / Prospect</th>
                    <th className="p-3">Stage</th>
                    <th className="p-3">Score</th>
                    <th className="p-3">Owner</th>
                    <th className="p-3">Source</th>
                    <th className="p-3">Next action</th>
                    <th className="p-3 text-right">Expected value</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lead) => (
                    <tr
                      key={lead.id}
                      onClick={() => openLead(lead.id)}
                      className="cursor-pointer border-t border-[#EFE5D5] hover:bg-[#FCF8F0]"
                    >
                      <td className="p-3">
                        <b>{lead.company_name}</b>
                        <small className="block text-[#806D5C]">
                          {lead.lead_number} ·{" "}
                          {lead.contact_person || lead.phone || "No contact"}
                        </small>
                      </td>
                      <td className="p-3">
                        <span
                          className="rounded-full px-2 py-1 text-xs font-bold text-white"
                          style={{
                            background: lead.stage?.colour || "#64748B",
                          }}
                        >
                          {lead.stage?.stage_name}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-indigo-700">
                        {Math.round(Number(lead.lead_score || 0))}/100
                      </td>
                      <td className="p-3">
                        {lead.owner?.name || "Unassigned"}
                      </td>
                      <td className="p-3">{lead.source}</td>
                      <td className="p-3">{when(lead.next_follow_up_at)}</td>
                      <td className="p-3 text-right font-bold">
                        {money(lead.expected_value, lead.currency_code)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <p className="p-10 text-center text-sm text-[#806D5C]">
                No leads match these filters.
              </p>
            )}
          </section>
        )}

        {view === "followups" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <section className="rounded-2xl border border-[#E7DBC5] bg-white p-4">
              <h2 className="font-black">Follow-up worklist</h2>
              <div className="mt-3 space-y-2">
                {filtered
                  .filter((lead) => lead.next_follow_up_at)
                  .sort((a, b) =>
                    String(a.next_follow_up_at).localeCompare(
                      String(b.next_follow_up_at),
                    ),
                  )
                  .map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => openLead(lead.id)}
                      className="flex w-full items-center justify-between gap-4 rounded-xl border p-3 text-left hover:bg-[#FCF8F0]"
                    >
                      <span>
                        <b>{lead.company_name}</b>
                        <small className="block text-[#806D5C]">
                          {lead.owner?.name || "Unassigned"} ·{" "}
                          {lead.stage?.stage_name}
                        </small>
                      </span>
                      <span className="text-right text-xs font-bold text-[#9A5B20]">
                        {when(lead.next_follow_up_at)}
                      </span>
                    </button>
                  ))}
                {!filtered.some((lead) => lead.next_follow_up_at) && (
                  <p className="p-8 text-center text-sm text-[#806D5C]">
                    No scheduled follow-ups.
                  </p>
                )}
              </div>
            </section>
            <aside className="rounded-2xl bg-[#203A43] p-4 text-white">
              <p className="flex items-center gap-2 text-xs font-bold uppercase text-teal-200">
                <Sparkles className="h-4 w-4" /> Recommended now
              </p>
              <div className="mt-3 space-y-2">
                {data?.notifications.map((notice) => (
                  <div
                    key={notice.id}
                    className="rounded-xl bg-amber-50 p-3 text-[#3A2A17]"
                  >
                    <button
                      onClick={() => openLead(notice.lead_id)}
                      className="w-full text-left"
                    >
                      <b className="text-sm">{notice.title}</b>
                      {notice.message && (
                        <p className="mt-1 text-xs text-[#6F5A49]">
                          {notice.message}
                        </p>
                      )}
                    </button>
                    {allowed("edit") && (
                      <button
                        onClick={() => resolveReminder(notice.id)}
                        className="mt-2 text-xs font-bold text-emerald-800"
                      >
                        Mark resolved
                      </button>
                    )}
                  </div>
                ))}
                {data?.recommended_actions.map((action) => (
                  <button
                    key={`${action.type}-${action.lead_id}`}
                    onClick={() => openLead(action.lead_id)}
                    className="w-full rounded-xl bg-white/10 p-3 text-left hover:bg-white/20"
                  >
                    <b className="text-sm">{action.title}</b>
                    <p className="mt-1 text-xs text-teal-100">
                      {action.action}
                    </p>
                  </button>
                ))}
                {!data?.recommended_actions.length && (
                  <p className="text-sm text-teal-100">
                    No urgent CRM action right now.
                  </p>
                )}
              </div>
            </aside>
          </div>
        )}

        {view === "rules" && allowed("edit") && (
          <div className="grid gap-4 lg:grid-cols-[390px_1fr]">
            {data?.readiness && (
              <section className="rounded-2xl border border-[#E7DBC5] bg-white p-5 shadow-sm lg:col-span-2">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase text-[#8B6F47]">Guided activation</p>
                    <h2 className="text-xl font-black">CRM readiness checklist</h2>
                    <p className="text-sm text-[#6F5A49]">Complete both controls before using automatic intake in a client demonstration.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className={`rounded-xl border px-4 py-3 text-sm ${data.readiness.configured_rule_owners >= 2 || data.readiness.department_sales_candidates >= 2 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                      <b className="block">1. Assignment coverage</b>
                      {data.readiness.configured_rule_owners} configured owner(s)
                    </div>
                    <div className={`rounded-xl border px-4 py-3 text-sm ${data.readiness.active_inbound_channels > 0 || data.readiness.whatsapp_capture_active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                      <b className="block">2. Lead intake</b>
                      {data.readiness.active_inbound_channels} external channel(s){data.readiness.whatsapp_capture_active ? " + WhatsApp" : ""}
                    </div>
                  </div>
                </div>
              </section>
            )}
            <form
              onSubmit={createRule}
              className="space-y-3 rounded-2xl border border-[#E7DBC5] bg-white p-5 shadow-sm"
            >
              <div>
                <p className="text-xs font-bold uppercase text-[#8B6F47]">
                  Routing intelligence
                </p>
                <h2 className="text-xl font-black">New assignment rule</h2>
                <p className="text-sm text-[#6F5A49]">
                  Rules are evaluated by priority. Blank filters match any lead.
                </p>
              </div>
              <input
                required
                className={field}
                placeholder="Rule name"
                value={ruleForm.rule_name}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, rule_name: e.target.value })
                }
              />
              <select
                className={field}
                value={ruleForm.strategy}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, strategy: e.target.value })
                }
              >
                <option value="LOAD_BALANCED">Load balanced</option>
                <option value="ROUND_ROBIN">Round robin</option>
                <option value="FIXED_OWNER">Fixed owner</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={field}
                  value={ruleForm.source_filter}
                  onChange={(e) =>
                    setRuleForm({ ...ruleForm, source_filter: e.target.value })
                  }
                >
                  <option value="">Any source</option>
                  {meta?.sources.map((source) => (
                    <option key={source}>{source}</option>
                  ))}
                </select>
                <input
                  className={field}
                  placeholder="Territory contains…"
                  value={ruleForm.territory_filter}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      territory_filter: e.target.value,
                    })
                  }
                />
                <input
                  className={field}
                  placeholder="Industry contains…"
                  value={ruleForm.industry_filter}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      industry_filter: e.target.value,
                    })
                  }
                />
                <input
                  className={field}
                  placeholder="Product contains…"
                  value={ruleForm.product_filter}
                  onChange={(e) =>
                    setRuleForm({ ...ruleForm, product_filter: e.target.value })
                  }
                />
              </div>
              <label className="block text-xs font-bold uppercase text-[#6F5A49]">
                Eligible sales owners
              </label>
              <div className="flex gap-2">
                <label className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-[#9A8069]" />
                  <input
                    className={`${field} pl-9`}
                    placeholder="Search owner name or email"
                    value={ownerSearch}
                    onChange={(event) => setOwnerSearch(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRuleForm({ ...ruleForm, assignee_user_ids: [] })}
                  className="shrink-0 rounded-xl border border-[#D8C8AE] px-3 text-sm font-bold"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border p-2">
                {matchingOwners.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[#F7F3EA]"
                  >
                    <input
                      type="checkbox"
                      checked={ruleForm.assignee_user_ids.includes(user.id)}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          assignee_user_ids: event.target.checked
                            ? [...ruleForm.assignee_user_ids, user.id]
                            : ruleForm.assignee_user_ids.filter(
                                (id) => id !== user.id,
                              ),
                        })
                      }
                    />
                    {user.name}
                  </label>
                ))}
                {!matchingOwners.length && <p className="p-3 text-center text-sm text-[#806D5C]">No matching active user.</p>}
              </div>
              <p className={`text-xs font-bold ${ruleForm.assignee_user_ids.length === 1 && ruleForm.strategy !== "FIXED_OWNER" ? "text-amber-700" : "text-[#6F5A49]"}`}>
                {ruleForm.assignee_user_ids.length} owner(s) selected
                {ruleForm.assignee_user_ids.length === 1 && ruleForm.strategy !== "FIXED_OWNER" ? " — select at least two to avoid a single-owner dependency." : ""}
              </p>
              <button
                disabled={saving}
                className="w-full rounded-xl bg-[#3E2A1F] px-4 py-2.5 font-bold text-white disabled:opacity-50"
              >
                Activate rule
              </button>
            </form>
            <section className="rounded-2xl border border-[#E7DBC5] bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">Active routing rules</h2>
              <div className="mt-3 space-y-2">
                {meta?.assignment_rules.map((rule: any) => (
                  <div key={rule.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between">
                      <b>{rule.rule_name}</b>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${rule.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                      >
                        {rule.is_active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#6F5A49]">
                      {rule.strategy.replace(/_/g, " ")} ·{" "}
                      {rule.assignee_user_ids?.length || 0} owner(s)
                    </p>
                    <p className="mt-1 text-xs text-[#8A7767]">
                      {[
                        rule.source_filter && `Source: ${rule.source_filter}`,
                        rule.territory_filter &&
                          `Territory: ${rule.territory_filter}`,
                        rule.industry_filter &&
                          `Industry: ${rule.industry_filter}`,
                        rule.product_filter &&
                          `Product: ${rule.product_filter}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Matches all leads"}
                    </p>
                  </div>
                ))}
                {!meta?.assignment_rules.length && (
                  <p className="p-8 text-center text-sm text-[#806D5C]">
                    No custom rules yet. Until configured, leads are
                    load-balanced across active Sales department users.
                  </p>
                )}
              </div>
            </section>
            <section className="rounded-2xl border border-[#E7DBC5] bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-[#8B6F47]">Secure intake</p>
                  <h2 className="text-xl font-black">Website, email and API lead channels</h2>
                  <p className="text-sm text-[#6F5A49]">Each channel receives a tenant-scoped token. Tokens are shown once and only their irreversible hashes are stored.</p>
                  <Link href="/dashboard/settings/whatsapp" className="mt-1 inline-block text-sm font-bold text-[#7A4D20] underline">Configure WhatsApp capture</Link>
                </div>
                <form onSubmit={createInboundChannel} className="grid min-w-0 gap-2 sm:grid-cols-[150px_240px_auto]">
                  <select className={field} value={channelForm.channel_code} onChange={(e) => setChannelForm({ ...channelForm, channel_code: e.target.value })}>
                    <option>WEBSITE</option><option>EMAIL</option><option>CAMPAIGN</option><option>API</option>
                  </select>
                  <input required className={field} placeholder="Channel name" value={channelForm.channel_name} onChange={(e) => setChannelForm({ ...channelForm, channel_name: e.target.value })}/>
                  <button disabled={saving} className="rounded-xl bg-[#3E2A1F] px-4 py-2.5 font-bold text-white disabled:opacity-50">Create channel</button>
                </form>
              </div>
              {channelToken && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3"><b className="text-sm text-amber-900">Copy this token now—it will not be shown again.</b><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded bg-white px-3 py-2 text-xs">{channelToken}</code><button type="button" onClick={() => navigator.clipboard.writeText(channelToken)} className="rounded border bg-white px-3 py-2 text-sm font-bold">Copy</button></div></div>}
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {(meta?.inbound_channels || []).map((channel) => <div key={channel.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><b>{channel.channel_name}</b><span className={`rounded-full px-2 py-1 text-xs font-bold ${channel.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{channel.is_active ? "ACTIVE" : "INACTIVE"}</span></div><p className="mt-1 text-xs text-[#806D5C]">{channel.channel_code} · Last intake: {when(channel.last_received_at)}</p><button type="button" disabled={saving} onClick={() => rotateInboundChannel(channel.id)} className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-bold">Rotate token</button></div>)}
                {!meta?.inbound_channels?.length && <p className="text-sm text-[#806D5C]">No external lead channels configured yet. WhatsApp intake is controlled separately in Settings → WhatsApp Business.</p>}
              </div>
            </section>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/45 p-0 md:items-center md:p-5">
          <form
            onSubmit={createLead}
            className="max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl md:rounded-3xl md:p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Intelligent capture
                </p>
                <h2 className="text-2xl font-black">Create a lead</h2>
                <p className="text-sm text-[#6F5A49]">
                  Duplicate checks and automatic owner assignment run when you
                  save.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-full bg-[#F2EBDD] p-2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <input
                required
                className={field}
                placeholder="Company / prospect name *"
                value={leadForm.company_name}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, company_name: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Contact person"
                value={leadForm.contact_person}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, contact_person: e.target.value })
                }
              />
              <input
                type="email"
                className={field}
                placeholder="Email"
                value={leadForm.email}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, email: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Phone / WhatsApp"
                value={leadForm.phone}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, phone: e.target.value })
                }
              />
              <select
                className={field}
                value={leadForm.source}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, source: e.target.value })
                }
              >
                {(meta?.sources || ["MANUAL"]).map((source) => (
                  <option key={source}>{source}</option>
                ))}
              </select>
              <input
                className={field}
                placeholder="Campaign / referral"
                value={leadForm.campaign}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, campaign: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Territory / city"
                value={leadForm.territory}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, territory: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Industry"
                value={leadForm.industry}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, industry: e.target.value })
                }
              />
              <input
                className={field}
                placeholder="Product interest"
                value={leadForm.product_interest}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, product_interest: e.target.value })
                }
              />
              <div className="grid grid-cols-[1fr_100px] gap-2">
                <input
                  type="number"
                  min="0"
                  className={field}
                  placeholder="Expected value"
                  value={leadForm.expected_value}
                  onChange={(e) =>
                    setLeadForm({ ...leadForm, expected_value: e.target.value })
                  }
                />
                <select
                  className={field}
                  value={leadForm.currency_code}
                  onChange={(e) =>
                    setLeadForm({ ...leadForm, currency_code: e.target.value })
                  }
                >
                  <option>INR</option>
                  <option>AED</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
              </div>
              <textarea
                className={`${field} md:col-span-2`}
                rows={3}
                placeholder="Requirement / desired outcome"
                value={leadForm.requirement}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, requirement: e.target.value })
                }
              />
              <select
                className={field}
                value={leadForm.priority}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, priority: e.target.value })
                }
              >
                <option>LOW</option>
                <option>MEDIUM</option>
                <option>HIGH</option>
                <option>URGENT</option>
              </select>
              <input
                type="date"
                className={field}
                value={leadForm.expected_close_date}
                onChange={(e) =>
                  setLeadForm({
                    ...leadForm,
                    expected_close_date: e.target.value,
                  })
                }
              />
              <label className="text-xs font-bold uppercase text-[#6F5A49] md:col-span-2">
                First follow-up
                <input
                  type="datetime-local"
                  className={`${field} mt-1`}
                  value={leadForm.next_follow_up_at}
                  onChange={(e) =>
                    setLeadForm({
                      ...leadForm,
                      next_follow_up_at: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-xl border px-4 py-2.5 font-bold"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                className="rounded-xl bg-[#3E2A1F] px-5 py-2.5 font-bold text-white disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create & auto-assign"}
              </button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[1000] bg-black/45">
          <button
            aria-label="Close lead"
            className="absolute inset-0"
            onClick={() => setSelected(null)}
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto bg-[#F8F4EC] shadow-2xl">
            <div className="sticky top-0 z-10 border-b bg-white p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-[#8B6F47]">
                    {selected.lead_number}
                  </p>
                  <h2 className="text-2xl font-black">
                    {selected.company_name}
                  </h2>
                  <p className="text-sm text-[#6F5A49]">
                    {selected.contact_person || "No contact"} ·{" "}
                    {selected.phone || selected.email || "No contact details"}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-full bg-[#F2EBDD] p-2"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="space-y-4 p-4 md:p-5">
              <section className="rounded-2xl border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase text-[#7A6555]">
                      Stage & probability
                    </p>
                    <select
                      disabled={
                        saving ||
                        !allowed("edit") ||
                        !!selected.stage?.is_closed
                      }
                      className={`${field} mt-1`}
                      value={selected.stage_id}
                      onChange={(e) => changeStage(e.target.value)}
                    >
                      {meta?.stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.stage_name} · {stage.probability}%
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase text-[#7A6555]">
                      Expected value
                    </p>
                    <b className="text-xl">
                      {money(selected.expected_value, selected.currency_code)}
                    </b>
                    <p className="mt-1 text-xs font-bold text-indigo-700">
                      Lead score {Math.round(Number(selected.lead_score || 0))}
                      /100
                    </p>
                  </div>
                </div>
                {Array.isArray(selected.score_explanation) &&
                  selected.score_explanation.length > 0 && (
                    <details className="mt-3 rounded-xl bg-indigo-50 p-3 text-xs text-indigo-900">
                      <summary className="cursor-pointer font-bold">
                        Why this score?
                      </summary>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {selected.score_explanation.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold uppercase text-[#6F5A49]">
                    Owner
                    <select
                      disabled={!allowed("edit")}
                      className={`${field} mt-1`}
                      value={selected.owner_user_id || ""}
                      onChange={(e) => assign(e.target.value)}
                    >
                      <option value="">Auto-assign</option>
                      {meta?.users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <p className="text-xs font-bold uppercase text-[#6F5A49]">
                      Next follow-up
                    </p>
                    <p className="mt-2 text-sm font-bold">
                      {when(selected.next_follow_up_at)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <p>
                    <span className="text-[#806D5C]">Source:</span>{" "}
                    {selected.source}
                  </p>
                  <p>
                    <span className="text-[#806D5C]">Territory:</span>{" "}
                    {selected.territory || "—"}
                  </p>
                  <p>
                    <span className="text-[#806D5C]">Product:</span>{" "}
                    {selected.product_interest || "—"}
                  </p>
                  <p>
                    <span className="text-[#806D5C]">Industry:</span>{" "}
                    {selected.industry || "—"}
                  </p>
                </div>
                {selected.requirement && (
                  <p className="mt-4 rounded-xl bg-[#F7F3EA] p-3 text-sm">
                    {selected.requirement}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {selected.customer_id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openCustomer360(selected.customer_id)}
                        className="rounded-xl bg-[#203A43] px-4 py-2 text-sm font-bold text-white"
                      >
                        Customer 360
                      </button>
                      <Link
                        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
                        href={`/dashboard/sales?tab=customers&customer=${selected.customer_id}`}
                      >
                        Open customer
                      </Link>
                      <Link
                        className="rounded-xl border border-[#8B6F47] px-4 py-2 text-sm font-bold"
                        href={`/dashboard/sales?tab=quotations&customer=${selected.customer_id}&create=quotation&crmLead=${selected.id}&crmRef=${encodeURIComponent(selected.lead_number)}`}
                      >
                        Prepare quotation
                      </Link>
                    </>
                  ) : (
                    allowed("create") && (
                      <button
                        onClick={convert}
                        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
                      >
                        Convert to customer
                      </button>
                    )
                  )}
                </div>
                {allowed("edit") && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-bold uppercase text-amber-900">
                      Duplicate control
                    </p>
                    <div className="mt-2 flex gap-2">
                      <select
                        className={field}
                        value={mergeTargetId}
                        onChange={(event) =>
                          setMergeTargetId(event.target.value)
                        }
                      >
                        <option value="">Select the lead to retain</option>
                        {(data?.leads || [])
                          .filter((lead) => lead.id !== selected.id)
                          .map((lead) => (
                            <option key={lead.id} value={lead.id}>
                              {lead.lead_number} — {lead.company_name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={!mergeTargetId || saving}
                        onClick={mergeSelectedLead}
                        className="shrink-0 rounded-xl border border-amber-700 px-3 text-xs font-bold text-amber-900 disabled:opacity-40"
                      >
                        Merge
                      </button>
                    </div>
                  </div>
                )}
              </section>
              {allowed("create") && (
                <form
                  onSubmit={addActivity}
                  className="rounded-2xl border bg-white p-4"
                >
                  <h3 className="flex items-center gap-2 font-black">
                    <MessageSquareText className="h-4 w-4" /> Record activity /
                    next action
                  </h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr]">
                    <select
                      className={field}
                      value={activityForm.activity_type}
                      onChange={(e) =>
                        setActivityForm({
                          ...activityForm,
                          activity_type: e.target.value,
                        })
                      }
                    >
                      {[
                        "FOLLOW_UP",
                        "CALL",
                        "EMAIL",
                        "WHATSAPP",
                        "MEETING",
                        "SITE_VISIT",
                        "TASK",
                        "NOTE",
                        "DEMO",
                      ].map((type) => (
                        <option key={type}>{type.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                    <input
                      required
                      className={field}
                      placeholder="Subject / next action"
                      value={activityForm.subject}
                      onChange={(e) =>
                        setActivityForm({
                          ...activityForm,
                          subject: e.target.value,
                        })
                      }
                    />
                    <textarea
                      className={`${field} sm:col-span-2`}
                      rows={2}
                      placeholder="Notes / conversation summary"
                      value={activityForm.notes}
                      onChange={(e) =>
                        setActivityForm({
                          ...activityForm,
                          notes: e.target.value,
                        })
                      }
                    />
                    <input
                      type="datetime-local"
                      className={`${field} sm:col-span-2`}
                      value={activityForm.scheduled_at}
                      onChange={(e) =>
                        setActivityForm({
                          ...activityForm,
                          scheduled_at: e.target.value,
                        })
                      }
                    />
                  </div>
                  <button
                    disabled={saving}
                    className="mt-3 rounded-xl bg-[#3E2A1F] px-4 py-2 text-sm font-bold text-white"
                  >
                    Save activity
                  </button>
                </form>
              )}
              <section className="rounded-2xl border bg-white p-4">
                <h3 className="font-black">Relationship timeline</h3>
                <div className="mt-3 space-y-3">
                  {(selected.activities || []).map((activity) => (
                    <div
                      key={activity.id}
                      className="relative border-l-2 border-[#D8C5A7] pl-4"
                    >
                      <span className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full bg-[#8B6F47]" />
                      <div className="flex items-start justify-between gap-3">
                        <span>
                          <b className="text-sm">{activity.subject}</b>
                          <small className="block text-[#806D5C]">
                            {activity.activity_type.replace(/_/g, " ")} ·{" "}
                            {when(
                              activity.scheduled_at || activity.completed_at,
                            )}
                          </small>
                          {activity.notes && (
                            <p className="mt-1 text-sm">{activity.notes}</p>
                          )}
                        </span>
                        {activity.status === "OPEN" && allowed("edit") && (
                          <button
                            onClick={() => completeActivity(activity)}
                            className="shrink-0 rounded-lg border px-2 py-1 text-xs font-bold"
                          >
                            Complete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!selected.activities?.length && (
                    <p className="text-sm text-[#806D5C]">
                      No activities recorded yet.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
      {customer360 && (
        <div className="fixed inset-0 z-[1100] overflow-y-auto bg-black/55 p-3 md:p-8">
          <button
            aria-label="Close Customer 360"
            className="fixed inset-0"
            onClick={() => setCustomer360(null)}
          />
          <section className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#F8F4EC] shadow-2xl">
            <header className="flex items-start justify-between gap-4 bg-[#203A43] p-5 text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-teal-200">
                  Customer 360
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {customer360.customer.customer_name}
                </h2>
                <p className="text-sm text-teal-50">
                  {customer360.customer.customer_code ||
                    customer360.customer.email ||
                    "Connected customer record"}
                </p>
              </div>
              <button
                onClick={() => setCustomer360(null)}
                className="rounded-full bg-white/10 p-2"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                label="CRM leads"
                value={customer360.crm.leads.length}
                icon={UsersRound}
              />
              <Kpi
                label="Quotations"
                value={customer360.sales.quotations.length}
                icon={GitBranch}
                tone="amber"
              />
              <Kpi
                label="Sales orders"
                value={customer360.sales.orders.length}
                icon={CheckCircle2}
                tone="green"
              />
              <Kpi
                label="Outstanding"
                value={money(customer360.finance.outstanding)}
                icon={CircleDollarSign}
                tone="red"
              />
            </div>
            <div className="grid gap-4 p-4 pt-0 lg:grid-cols-2">
              {[
                [
                  "Commercial journey",
                  [
                    ...customer360.sales.quotations.map(
                      (row) => `${row.quotation_number} · ${row.status}`,
                    ),
                    ...customer360.sales.orders.map(
                      (row) => `${row.so_number} · ${row.status}`,
                    ),
                  ],
                ],
                [
                  "Finance",
                  customer360.finance.invoices.map(
                    (row) =>
                      `${row.invoice_number} · ${money(row.balance_amount)}`,
                  ),
                ],
                [
                  "Installed assets",
                  customer360.service.installed_assets.map(
                    (row) => `${row.asset_number || row.uid} · ${row.status}`,
                  ),
                ],
                [
                  "Service tickets",
                  customer360.service.tickets.map(
                    (row) => `${row.ticket_number} · ${row.status}`,
                  ),
                ],
              ].map(([title, rows]: any) => (
                <article
                  key={title}
                  className="rounded-2xl border border-[#E7DBC5] bg-white p-4"
                >
                  <h3 className="font-black">{title}</h3>
                  <div className="mt-3 space-y-2 text-sm">
                    {(rows as string[]).slice(0, 10).map((row, index) => (
                      <p
                        key={`${title}-${index}`}
                        className="rounded-lg bg-[#F7F3EA] px-3 py-2"
                      >
                        {row}
                      </p>
                    ))}
                    {!rows.length && (
                      <p className="text-[#806D5C]">No records yet.</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function CrmPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-[#6F5A49]">Loading CRM workspace…</div>
      }
    >
      <CrmPageContent />
    </Suspense>
  );
}
