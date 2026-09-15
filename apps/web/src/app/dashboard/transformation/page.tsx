"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { apiClient } from "../../../../lib/api-client";

const field = "w-full rounded-lg border border-[#D8C8AA] px-3 py-2 text-sm";
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

function KpiCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: any;
}) {
  return (
    <div className="rounded-xl border border-[#E0D2B8] bg-white p-4">
      <div className="flex items-center justify-between text-[#80613D]">
        <span className="text-xs font-bold uppercase tracking-wide">
          {label}
        </span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-2xl font-bold text-[#2F241B]">{value}</p>
    </div>
  );
}

export default function BusinessTransformationPage() {
  const [data, setData] = useState<any>({
    kpis: {},
    objectives: [],
    actions: [],
    initiatives: [],
    safety: {},
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [advisor, setAdvisor] = useState<any>(null);
  const [advisorBusy, setAdvisorBusy] = useState(false);
  const [advisorQuestion, setAdvisorQuestion] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiClient.get("/transformation/dashboard"));
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Unable to load Business Transformation.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post =
    (url: string, success: string) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await apiClient.post(
          url,
          Object.fromEntries(new FormData(event.currentTarget)),
        );
        event.currentTarget.reset();
        setMessage(success);
        load();
      } catch (error: any) {
        setMessage(error?.message || "Unable to save transformation control.");
      }
    };

  const patch = async (url: string, body: any, success: string) => {
    try {
      await apiClient.patch(url, body);
      setMessage(success);
      load();
    } catch (error: any) {
      setMessage(
        error?.message || "Unable to progress transformation control.",
      );
    }
  };

  const approveObjective = (id: string) => {
    const approval_note = prompt(
      "Independent approval rationale and target commitment",
    );
    if (approval_note)
      patch(
        `/transformation/objectives/${id}/approve`,
        { approval_note },
        "Business objective independently approved.",
      );
  };

  const completeAction = (row: any) => {
    const completion_evidence = prompt(
      "Completion evidence or source-document reference",
    );
    const outcome_value = prompt("Measured KPI outcome value");
    if (completion_evidence && outcome_value != null)
      patch(
        `/transformation/actions/${row.id}/complete`,
        { completion_evidence, outcome_value },
        "Action submitted for independent outcome verification.",
      );
  };

  const verifyAction = (row: any) => {
    const verification_evidence = prompt(
      "Independent operational verification evidence",
    );
    const verifier_note = prompt("Verification method and conclusion");
    const operational_benefit = prompt(
      "Operational benefit estimate (finance verification remains separate)",
      "0",
    );
    if (verification_evidence && verifier_note && operational_benefit != null)
      patch(
        `/transformation/actions/${row.id}/verify`,
        { verification_evidence, verifier_note, operational_benefit },
        "Operational outcome independently verified.",
      );
  };

  const rejectAction = (id: string) => {
    const rejection_reason = prompt("Independent rejection reason");
    if (rejection_reason)
      patch(
        `/transformation/actions/${id}/reject`,
        { rejection_reason },
        "Action outcome rejected with an evidence trail.",
      );
  };

  const askAdvisor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdvisorBusy(true);
    try {
      setAdvisor(
        await apiClient.post("/transformation/advisor", {
          question: advisorQuestion,
        }),
      );
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Unable to generate transformation advice.");
    } finally {
      setAdvisorBusy(false);
    }
  };

  const activeObjectives = data.objectives.filter((row: any) =>
    ["ACTIVE", "AT_RISK", "ACHIEVED"].includes(row.status),
  );
  const availableKpis = activeObjectives.flatMap((row: any) => row.kpis || []);

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-4 text-[#2F241B]">
      <header className="rounded-xl border border-[#D8C8AA] bg-gradient-to-r from-[#FBF7EF] to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
              Closed-loop management system
            </p>
            <h1 className="mt-1 text-2xl font-bold">Business Transformation</h1>
            <p className="mt-1 max-w-4xl text-sm text-[#6F5A45]">
              Convert business targets into evidence-backed KPIs, initiatives,
              owned corrective actions and independently verified results.
            </p>
          </div>
          <Link
            href="/dashboard/accounts/value-realization"
            className="flex items-center gap-2 rounded-lg border border-[#80613D] px-3 py-2 text-sm font-semibold"
          >
            Finance value verification <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {message && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="Active objectives"
          value={String(data.kpis.active_objectives || 0)}
          icon={Target}
        />
        <KpiCard
          label="Achieved"
          value={String(data.kpis.achieved_objectives || 0)}
          icon={CheckCircle2}
        />
        <KpiCard
          label="At risk"
          value={String(data.kpis.objectives_at_risk || 0)}
          icon={Activity}
        />
        <KpiCard
          label="Open actions"
          value={String(data.kpis.open_actions || 0)}
          icon={Clock3}
        />
        <KpiCard
          label="Operational value"
          value={money(data.kpis.operational_verified_benefit)}
          icon={CircleDollarSign}
        />
        <KpiCard
          label="Finance verified"
          value={money(data.kpis.finance_verified_benefit)}
          icon={ShieldCheck}
        />
      </section>

      <section className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-bold">
              <Sparkles className="h-5 w-5 text-violet-700" />
              AI transformation advisor
            </h2>
            <p className="mt-1 text-xs text-[#6F5A45]">
              Analyzes only the evidence shown in this control tower. Advice is
              non-executing and every recommendation needs human approval.
            </p>
          </div>
          {advisor && (
            <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-bold">
              {advisor.provider} {advisor.model ? `· ${advisor.model}` : ""}
            </span>
          )}
        </div>
        <form onSubmit={askAdvisor} className="mt-3 flex flex-wrap gap-2">
          <input
            value={advisorQuestion}
            onChange={(event) => setAdvisorQuestion(event.target.value)}
            maxLength={500}
            placeholder="Ask what management should prioritize next"
            className={`${field} min-w-[280px] flex-1 bg-white`}
          />
          <button
            disabled={advisorBusy}
            className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {advisorBusy ? "Analyzing…" : "Generate evidence-based advice"}
          </button>
        </form>
        {advisor && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-violet-100 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>Business health: {advisor.business_health}</b>
                <span className="text-xs text-[#6F5A45]">
                  Advisory only · 0 records created · 0 records modified
                </span>
              </div>
              <p className="mt-1">{advisor.executive_summary}</p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {(advisor.priorities || []).map(
                (priority: any, index: number) => (
                  <article
                    key={`${priority.objective_id}-${index}`}
                    className="rounded-lg border border-violet-100 bg-white p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <b>{priority.title}</b>
                      <span className="rounded bg-violet-50 px-2 py-1 text-[10px] font-bold">
                        {priority.category} · {Number(priority.confidence || 0)}
                        %
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[#6F5A45]">
                      Evidence: {priority.evidence}
                    </p>
                    <p className="mt-2">{priority.recommended_action}</p>
                    <p className="mt-1 text-xs font-semibold text-violet-800">
                      Human approval required
                    </p>
                  </article>
                ),
              )}
            </div>
            {!advisor.priorities?.length && (
              <p className="rounded-lg border border-violet-100 bg-white p-3 text-sm">
                No evidence-backed priority can be ranked yet. Add an approved
                objective and KPI evidence first.
              </p>
            )}
            {!!advisor.missing_evidence?.length && (
              <p className="text-xs text-[#6F5A45]">
                Missing evidence: {advisor.missing_evidence.join("; ")}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#E0D2B8] bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold">Objective control tower</h2>
            <p className="text-xs text-[#7A6555]">
              Target progress uses the latest primary KPI snapshot and immutable
              source evidence.
            </p>
          </div>
          {busy && <span className="text-xs">Refreshing…</span>}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {data.objectives.map((row: any) => (
            <article key={row.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase text-[#8B6F47]">
                    {row.objective_code} · {row.perspective}
                  </p>
                  <h3 className="font-bold">{row.title}</h3>
                  <p className="mt-1 text-xs text-[#6F5A45]">
                    Owner: {row.owner_reference} · Target {row.target_date}
                  </p>
                </div>
                <span className="rounded-full bg-[#F5EEDF] px-2 py-1 text-xs font-bold">
                  {row.status} · {row.health}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded bg-[#EDE4D4]">
                <div
                  className="h-full bg-emerald-600"
                  style={{
                    width: `${Math.min(100, Number(row.progress_pct || 0))}%`,
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span>
                  Baseline {Number(row.baseline_value).toLocaleString()} →
                  current {Number(row.current_value).toLocaleString()}
                </span>
                <b>
                  Target {Number(row.target_value).toLocaleString()}{" "}
                  {row.unit_of_measure}
                </b>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span>{row.kpis.length} KPI(s)</span>
                <span>·</span>
                <span>{row.initiatives.length} initiative(s)</span>
                <span>·</span>
                <span>{row.actions.length} action(s)</span>
              </div>
              <div className="mt-3 flex gap-2">
                {row.status === "DRAFT" && (
                  <button
                    onClick={() =>
                      patch(
                        `/transformation/objectives/${row.id}/submit`,
                        {},
                        "Objective submitted for independent approval.",
                      )
                    }
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Submit
                  </button>
                )}
                {row.status === "SUBMITTED" && (
                  <button
                    onClick={() => approveObjective(row.id)}
                    className="rounded border border-emerald-300 px-2 py-1 text-xs"
                  >
                    Independently approve
                  </button>
                )}
              </div>
            </article>
          ))}
          {!data.objectives.length && (
            <p className="p-6 text-sm text-[#7A6555]">
              No transformation objectives are registered yet. Begin with one
              measurable business outcome below.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <form
          onSubmit={post(
            "/transformation/objectives",
            "Transformation objective created as a draft.",
          )}
          className="space-y-2 rounded-xl border border-[#E0D2B8] bg-white p-4"
        >
          <h2 className="font-bold">1. Define business objective</h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="objective_code"
              placeholder="Objective code"
              className={field}
            />
            <select
              required
              name="perspective"
              className={field}
              defaultValue="DELIVERY"
            >
              {[
                "SALES",
                "CUSTOMER",
                "DELIVERY",
                "PROCUREMENT",
                "INVENTORY",
                "PRODUCTION",
                "QUALITY",
                "FINANCE",
                "PEOPLE",
                "CUSTOM",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <input
            required
            name="title"
            placeholder="Measurable outcome title"
            className={field}
          />
          <textarea
            required
            name="description"
            placeholder="Business problem and intended outcome"
            className={field}
          />
          <input
            required
            name="owner_reference"
            placeholder="Accountable owner"
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              type="number"
              step="0.0001"
              name="baseline_value"
              placeholder="Baseline value"
              className={field}
            />
            <input
              required
              type="number"
              step="0.0001"
              name="target_value"
              placeholder="Target value"
              className={field}
            />
            <input
              required
              name="unit_of_measure"
              placeholder="Unit: %, days, INR"
              className={field}
            />
            <select
              name="improvement_direction"
              className={field}
              defaultValue="INCREASE"
            >
              <option value="INCREASE">Increase is better</option>
              <option value="DECREASE">Decrease is better</option>
            </select>
            <input
              required
              type="date"
              name="baseline_period_from"
              className={field}
            />
            <input
              required
              type="date"
              name="baseline_period_to"
              className={field}
            />
            <input required type="date" name="target_date" className={field} />
            <select
              name="review_frequency"
              className={field}
              defaultValue="MONTHLY"
            >
              <option>DAILY</option>
              <option>WEEKLY</option>
              <option>MONTHLY</option>
              <option>QUARTERLY</option>
            </select>
          </div>
          <input
            required
            name="baseline_evidence"
            placeholder="Baseline report/evidence reference"
            className={field}
          />
          <button className="rounded-lg bg-[#65452B] px-4 py-2 text-sm font-bold text-white">
            Create objective draft
          </button>
        </form>

        <form
          onSubmit={post(
            "/transformation/kpis",
            "Governed KPI definition added.",
          )}
          className="space-y-2 rounded-xl border border-[#E0D2B8] bg-white p-4"
        >
          <h2 className="font-bold">2. Define evidence-backed KPI</h2>
          <select
            required
            name="objective_id"
            className={field}
            defaultValue=""
          >
            <option value="">Select objective</option>
            {data.objectives.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.objective_code} · {row.title}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="kpi_code"
              placeholder="KPI code"
              className={field}
            />
            <input
              required
              name="kpi_name"
              placeholder="KPI name"
              className={field}
            />
            <input
              required
              name="source_module"
              placeholder="Source module"
              className={field}
            />
            <input
              required
              name="unit_of_measure"
              placeholder="Unit"
              className={field}
            />
          </div>
          <textarea
            required
            name="calculation_method"
            placeholder="Exact calculation formula"
            className={field}
          />
          <input
            required
            name="source_reference"
            placeholder="Source table/report and filters"
            className={field}
          />
          <input
            required
            name="owner_reference"
            placeholder="KPI data owner"
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              name="improvement_direction"
              className={field}
              defaultValue="INCREASE"
            >
              <option value="INCREASE">Increase is better</option>
              <option value="DECREASE">Decrease is better</option>
            </select>
            <label className="flex items-center gap-2 rounded-lg border px-3 text-sm">
              <input type="checkbox" name="is_primary" value="true" /> Primary
              objective KPI
            </label>
          </div>
          <button className="rounded-lg bg-[#65452B] px-4 py-2 text-sm font-bold text-white">
            Add KPI definition
          </button>
        </form>

        <form
          onSubmit={post(
            "/transformation/kpi-snapshots",
            "Immutable KPI actual recorded.",
          )}
          className="space-y-2 rounded-xl border border-[#E0D2B8] bg-white p-4"
        >
          <h2 className="font-bold">3. Record periodic actual</h2>
          <select required name="kpi_id" className={field} defaultValue="">
            <option value="">Select active KPI</option>
            {availableKpis.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.kpi_code} · {row.kpi_name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input required type="date" name="period_from" className={field} />
            <input required type="date" name="period_to" className={field} />
          </div>
          <input
            required
            type="number"
            step="0.0001"
            name="actual_value"
            placeholder="Measured actual value"
            className={field}
          />
          <input
            required
            name="evidence_reference"
            placeholder="Approved report/source reference"
            className={field}
          />
          <button className="rounded-lg bg-[#65452B] px-4 py-2 text-sm font-bold text-white">
            Record evidence snapshot
          </button>
        </form>

        <form
          onSubmit={post(
            "/transformation/actions",
            "Corrective action proposed.",
          )}
          className="space-y-2 rounded-xl border border-[#E0D2B8] bg-white p-4"
        >
          <h2 className="font-bold">4. Assign corrective action</h2>
          <select
            required
            name="objective_id"
            className={field}
            defaultValue=""
          >
            <option value="">Select active objective</option>
            {activeObjectives.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.objective_code} · {row.title}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="action_code"
              placeholder="Action code"
              className={field}
            />
            <select name="priority" className={field} defaultValue="MEDIUM">
              <option>LOW</option>
              <option>MEDIUM</option>
              <option>HIGH</option>
              <option>CRITICAL</option>
            </select>
          </div>
          <input
            required
            name="title"
            placeholder="Action title"
            className={field}
          />
          <textarea
            required
            name="description"
            placeholder="Corrective action and root-cause hypothesis"
            className={field}
          />
          <input
            required
            name="owner_reference"
            placeholder="Action owner"
            className={field}
          />
          <input required type="date" name="due_date" className={field} />
          <input
            required
            name="expected_operational_impact"
            placeholder="Expected KPI/operational impact"
            className={field}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            name="expected_benefit"
            placeholder="Expected benefit INR (optional)"
            className={field}
          />
          <button className="rounded-lg bg-[#65452B] px-4 py-2 text-sm font-bold text-white">
            Propose action
          </button>
        </form>

        <form
          onSubmit={post(
            "/transformation/initiatives",
            "Value initiative linked to the business objective.",
          )}
          className="space-y-2 rounded-xl border border-[#E0D2B8] bg-white p-4 xl:col-span-2"
        >
          <h2 className="font-bold">5. Register improvement initiative</h2>
          <p className="text-xs text-[#7A6555]">
            Reuses the existing maker-checker and finance benefit-verification
            workflow instead of creating a second value ledger.
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            <select
              required
              name="objective_id"
              className={field}
              defaultValue=""
            >
              <option value="">Select active objective</option>
              {activeObjectives.map((row: any) => (
                <option key={row.id} value={row.id}>
                  {row.objective_code} · {row.title}
                </option>
              ))}
            </select>
            <select name="primary_kpi_id" className={field} defaultValue="">
              <option value="">Optional primary KPI</option>
              {availableKpis.map((row: any) => (
                <option key={row.id} value={row.id}>
                  {row.kpi_code} · {row.kpi_name}
                </option>
              ))}
            </select>
            <input
              required
              name="initiative_code"
              placeholder="Initiative code"
              className={field}
            />
            <input
              required
              name="title"
              placeholder="Initiative title"
              className={field}
            />
            <input
              required
              name="source_module"
              placeholder="Source module"
              className={field}
            />
            <input
              name="source_reference"
              placeholder="Source/exception reference"
              className={field}
            />
            <input
              required
              name="owner_reference"
              placeholder="Accountable owner"
              className={field}
            />
            <input
              required
              type="date"
              name="baseline_period_from"
              className={field}
            />
            <input
              required
              type="date"
              name="baseline_period_to"
              className={field}
            />
            <input
              required
              type="number"
              min="0"
              step="0.01"
              name="baseline_value"
              placeholder="Baseline value/amount"
              className={field}
            />
            <input
              required
              name="baseline_evidence"
              placeholder="Baseline evidence"
              className={field}
            />
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              name="target_benefit"
              placeholder="Target financial benefit INR"
              className={field}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              name="implementation_investment"
              placeholder="Implementation investment INR"
              className={field}
            />
            <input
              type="number"
              step="0.0001"
              name="target_metric_value"
              placeholder="Target KPI value"
              className={field}
            />
            <input required type="date" name="target_date" className={field} />
          </div>
          <button className="rounded-lg bg-[#65452B] px-4 py-2 text-sm font-bold text-white">
            Propose linked initiative
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-[#E0D2B8] bg-white p-4">
        <h2 className="font-bold">Corrective action queue</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-[#7A6555]">
              <tr>
                <th className="p-2">Action</th>
                <th className="p-2">Owner / due</th>
                <th className="p-2">Impact</th>
                <th className="p-2">Status</th>
                <th className="p-2">Controls</th>
              </tr>
            </thead>
            <tbody>
              {data.actions.map((row: any) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="p-2">
                    <b>{row.action_code}</b>
                    <span className="block">{row.title}</span>
                    <small>{row.priority}</small>
                  </td>
                  <td className="p-2">
                    {row.owner_reference}
                    <span className="block text-xs">{row.due_date}</span>
                  </td>
                  <td className="p-2">
                    {row.expected_operational_impact}
                    <span className="block text-xs">
                      Expected {money(row.expected_benefit)}
                    </span>
                  </td>
                  <td className="p-2">
                    <b>{row.status}</b>
                    {row.status === "VERIFIED" && (
                      <span className="block text-xs text-emerald-700">
                        Operational {money(row.operational_benefit)}; finance
                        review separate
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {row.status === "PROPOSED" && (
                        <button
                          onClick={() =>
                            patch(
                              `/transformation/actions/${row.id}/accept`,
                              {},
                              "Action accepted by owner.",
                            )
                          }
                          className="rounded border px-2 py-1 text-xs"
                        >
                          Accept
                        </button>
                      )}
                      {row.status === "ACCEPTED" && (
                        <button
                          onClick={() =>
                            patch(
                              `/transformation/actions/${row.id}/start`,
                              {},
                              "Action started.",
                            )
                          }
                          className="rounded border px-2 py-1 text-xs"
                        >
                          Start
                        </button>
                      )}
                      {["ACCEPTED", "IN_PROGRESS"].includes(row.status) && (
                        <button
                          onClick={() => completeAction(row)}
                          className="rounded border px-2 py-1 text-xs"
                        >
                          Complete
                        </button>
                      )}
                      {row.status === "COMPLETED" && (
                        <>
                          <button
                            onClick={() => verifyAction(row)}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs"
                          >
                            Verify
                          </button>
                          <button
                            onClick={() => rejectAction(row.id)}
                            className="rounded border border-red-300 px-2 py-1 text-xs"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.actions.length && (
            <p className="p-6 text-center text-sm text-[#7A6555]">
              No corrective actions are registered.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <h2 className="flex items-center gap-2 font-bold">
          <ShieldCheck className="h-5 w-5" />
          Governance boundary
        </h2>
        <p className="mt-2 text-xs">
          This workspace measures and governs improvement work. It cannot create
          or modify sales, purchasing, stock, production, quality, payroll,
          payment or accounting transactions. Operational outcomes require an
          independent verifier; monetary value becomes official only through
          Finance Value Realization.
        </p>
      </section>
    </main>
  );
}
