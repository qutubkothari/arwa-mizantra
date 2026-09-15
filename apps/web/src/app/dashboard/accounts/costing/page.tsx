"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { apiClient } from "../../../../../lib/api-client";
import { useLocale } from "@/lib/locale";

type MarginLine = {
  item_id: string;
  item_code?: string | null;
  item_name: string;
  quantity: number;
  revenue: number;
  standard_cost: number;
  gross_margin: number;
  gross_margin_percent: number;
};
type Summary = {
  revenue: number;
  standard_cost: number;
  gross_margin: number;
  gross_margin_percent: number;
  lines: MarginLine[];
  disclaimer: string;
};
type Fifo = {
  total_cogs: number;
  event_count: number;
  events: Array<{
    id: string;
    reference_number?: string | null;
    quantity: number;
    unit_cost: number;
    total_cost: number;
    event_at: string;
    items?: { code?: string; name?: string } | null;
  }>;
  disclaimer: string;
};
type FifoCoverage = {
  receipt_event_count: number;
  receipt_quantity: number;
  receipt_cost: number;
  issue_event_count: number;
  issue_quantity: number;
  issue_cost: number;
  disclaimer: string;
};
type CostEvent = {
  id: string;
  event_type: string;
  reference_number?: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  event_at: string;
  items?: { code?: string; name?: string } | null;
  posting?: {
    status: string;
    journal?: { journal_number: string; status: string } | null;
  } | null;
};
type ValuationRun = {
  id: string;
  run_code: string;
  period_start: string;
  period_end: string;
  status: string;
  opening_value: number;
  receipt_value: number;
  issue_value: number;
  closing_value: number;
  movement_variance: number;
  event_count: number;
  exception_count: number;
  evidence_hash: string;
};
export default function CostingPage() {
  const { currency: tenantCurrency, locale: appLocale, language, t } = useLocale();
  const [data, setData] = useState<Summary | null>(null);
  const [fifo, setFifo] = useState<Fifo | null>(null);
  const [coverage, setCoverage] = useState<FifoCoverage | null>(null);
  const [events, setEvents] = useState<CostEvent[]>([]);
  const [runs, setRuns] = useState<ValuationRun[]>([]);
  const [production, setProduction] = useState<any>({
    summary: {},
    jobs: [],
    purchase_price_variances: [],
  });
  const [remediation, setRemediation] = useState<any>({
    summary: {},
    actions: [],
    users: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafting, setDrafting] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const currency = String(production?.currency_code || tenantCurrency || "AED");
  const money = useCallback(
    (value: number) => new Intl.NumberFormat(appLocale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(value || 0)),
    [appLocale, currency],
  );
  const selectedJob = useMemo(() => {
    const jobs = Array.isArray(production?.jobs) ? production.jobs : [];
    return jobs.find((job: any) => job.id === selectedJobId) ||
      jobs.find((job: any) => job.actual_cost_per_piece != null) || jobs[0] || null;
  }, [production, selectedJobId]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        margin,
        fifoEvents,
        fifoCoverage,
        inventoryEvents,
        valuationRuns,
        productionVariance,
        productionRemediations,
      ] = await Promise.all([
        apiClient.get<Summary>("/costing/standard-margin"),
        apiClient.get<Fifo>("/costing/fifo-cogs"),
        apiClient.get<FifoCoverage>("/costing/fifo-coverage"),
        apiClient.get<CostEvent[]>("/costing/inventory-events"),
        apiClient.get<ValuationRun[]>("/costing/valuation-runs"),
        apiClient.get<any>("/costing/production-variance"),
        apiClient.get<any>("/costing/production-remediations"),
      ]);
      setData(margin);
      setFifo(fifoEvents);
      setCoverage(fifoCoverage);
      setEvents(inventoryEvents);
      setRuns(valuationRuns);
      setProduction(productionVariance);
      setRemediation(productionRemediations);
    } catch (err: any) {
      setError(err?.message || "Unable to load cost and margin data.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const syncRemediations = async () => {
    setLoading(true);
    try {
      const result: any = await apiClient.post(
        "/costing/production-remediations/sync",
        {},
      );
      setMessage(
        `Cost readiness synchronized: ${result.inserted} new and ${result.existing} existing action(s).`,
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to synchronize cost readiness.");
      setLoading(false);
    }
  };
  const updateRemediation = async (id: string, body: any) => {
    setDrafting(id);
    try {
      await apiClient.patch(`/costing/production-remediations/${id}`, body);
      setMessage("Cost-readiness action updated with owner evidence.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to update cost-readiness action.");
    } finally {
      setDrafting(null);
    }
  };
  const draft = async (id: string) => {
    setDrafting(id);
    setMessage("");
    setError("");
    try {
      const result: any = await apiClient.post(
        `/costing/fifo-cogs/${id}/draft`,
      );
      setMessage(
        result?.status === "SKIPPED"
          ? result.reason
          : result?.idempotent
            ? "Existing COGS draft found."
            : "COGS draft created for finance review.",
      );
    } catch (err: any) {
      setError(err?.message || "Unable to create COGS draft.");
    } finally {
      setDrafting(null);
    }
  };
  const draftEvent = async (id: string) => {
    setDrafting(id);
    setMessage("");
    setError("");
    try {
      const result: any = await apiClient.post(`/costing/events/${id}/draft`);
      setMessage(
        result?.status === "SKIPPED"
          ? result.reason
          : result?.idempotent
            ? "Existing valuation journal found."
            : "Valuation draft created for finance review.",
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to create valuation draft.");
    } finally {
      setDrafting(null);
    }
  };
  const createRun = async () => {
    const today = new Date().toISOString().slice(0, 10);
    setLoading(true);
    try {
      await apiClient.post("/costing/valuation-runs", {
        run_code: `INV-${today}-${Date.now()}`,
        period_start: `${today.slice(0, 8)}01`,
        period_end: today,
      });
      setMessage("FIFO valuation snapshot created with SHA-256 evidence.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to create valuation snapshot.");
      setLoading(false);
    }
  };
  const certify = async (id: string) => {
    setLoading(true);
    try {
      await apiClient.post(`/costing/valuation-runs/${id}/certify`, {
        certification_note:
          "Finance independently verified FIFO evidence and ledger movement reconciliation.",
      });
      setMessage("Inventory valuation independently certified.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Unable to certify valuation.");
      setLoading(false);
    }
  };
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-2 sm:p-4">
      <section className="rounded-2xl bg-gradient-to-r from-[#613535] to-[#99534C] p-5 text-white shadow-lg sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-rose-100">
              <BarChart3 size={18} /> Explainable profitability
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl">
              Cost & Margin Control
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-rose-50">
              Billed revenue compared with the approved standard cost of each
              item.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}{" "}
            Refresh
          </button>
        </div>
      </section>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          {message}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-5">
        <Metric label="Billed revenue" value={money(data?.revenue || 0)} />
        <Metric label="Standard cost" value={money(data?.standard_cost || 0)} />
        <Metric label="Gross margin" value={money(data?.gross_margin || 0)} />
        <Metric
          label="Margin rate"
          value={`${Number(data?.gross_margin_percent || 0).toFixed(1)}%`}
        />
        <Metric
          label="FIFO COGS evidence"
          value={money(fifo?.total_cogs || 0)}
        />
      </section>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        {production?.disclaimer ||
          data?.disclaimer ||
          "This standard-cost view does not post or replace actual COGS."}
      </div>
      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-md">
        <div className="flex flex-col gap-4 bg-gradient-to-r from-emerald-800 to-emerald-600 p-5 text-white sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-100">
              {t("Simple production costing")}
            </p>
            <h2 className="mt-1 text-2xl font-bold">{t("Cost per piece")}</h2>
            <p className="mt-1 text-sm text-emerald-50">
              {language === "ar"
                ? "المواد + التشغيل + فاقد الجودة ÷ القطع المقبولة"
                : "Materials + conversion + quality loss ÷ accepted pieces"}
            </p>
          </div>
          <label className="min-w-72 text-sm font-semibold">
            <span className="mb-1 block text-emerald-50">{t("Select a job order")}</span>
            <select
              value={selectedJob?.id || ""}
              onChange={(event) => setSelectedJobId(event.target.value)}
              className="w-full rounded-lg border border-white/40 bg-white px-3 py-2 text-slate-900"
            >
              {(production.jobs || []).map((job: any) => (
                <option key={job.id} value={job.id}>
                  {job.job_order_number} — {job.item_code || job.item_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <Loading /> : selectedJob ? (
          <div className="grid gap-4 p-5 lg:grid-cols-[1.3fr_2fr]">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
              <p className="text-sm font-semibold text-emerald-800">
                {selectedJob.actual_cost_per_piece != null
                  ? t("Actual cost per piece")
                  : t("Planned cost per piece")}
              </p>
              <p className="mt-2 text-4xl font-black tabular-nums text-emerald-950" data-ltr>
                {money(selectedJob.actual_cost_per_piece ?? selectedJob.planned_cost_per_piece ?? 0)}
              </p>
              <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
                {selectedJob.cost_stage === "FINAL"
                  ? t("Final cost")
                  : selectedJob.cost_stage === "LIVE"
                    ? t("Live estimate")
                    : t("Planned estimate")}
              </span>
              <p className="mt-3 text-sm text-emerald-900">
                {selectedJob.job_order_number} · {selectedJob.item_name}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                {t("Accepted pieces")}: {Number(selectedJob.accepted_quantity || 0).toLocaleString(appLocale)}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label={t("Material per piece")} value={selectedJob.material_cost_per_piece == null ? "—" : money(selectedJob.material_cost_per_piece)} />
              <Metric label={t("Conversion per piece")} value={selectedJob.conversion_cost_per_piece == null ? "—" : money(selectedJob.conversion_cost_per_piece)} />
              <Metric label={t("Quality loss per piece")} value={selectedJob.quality_loss_per_piece == null ? "—" : money(selectedJob.quality_loss_per_piece)} />
              <Metric label={t("Planned cost per piece")} value={selectedJob.planned_cost_per_piece == null ? "—" : money(selectedJob.planned_cost_per_piece)} />
              {selectedJob.assurance !== "CONTROLLED" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:col-span-2">
                  <b>{t("Cost evidence incomplete")}</b>
                  <span className="mt-1 block text-xs">{(selectedJob.exceptions || []).join(" · ").replaceAll("_", " ")}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6 text-sm text-slate-500">No production job is available yet.</div>
        )}
      </section>
      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">
              Production cost variance cockpit
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Standard material and conversion cost compared with issued
              material, actual operation time and rejection loss over the last{" "}
              {production.period_days || 180} days. Portfolio values include
              controlled jobs only.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {production.generated_at
              ? `Updated ${new Date(production.generated_at).toLocaleString()}`
              : ""}
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            label="Jobs analysed"
            value={String(production.summary.jobs_analyzed || 0)}
          />
          <Metric
            label="Controlled jobs"
            value={String(production.summary.controlled_jobs || 0)}
          />
          <Metric
            label="Incomplete / excluded"
            value={String(production.summary.incomplete_jobs || 0)}
          />
          <Metric
            label="Controlled standard cost"
            value={money(production.summary.standard_cost || 0)}
          />
          <Metric
            label="Controlled actual cost"
            value={money(production.summary.actual_cost || 0)}
          />
          <Metric
            label="Controlled variance"
            value={money(production.summary.total_variance || 0)}
          />
          <Metric
            label="Controlled yield loss"
            value={money(production.summary.yield_loss || 0)}
          />
          <Metric
            label="Production issue value"
            value={money(production.summary.production_issue_value || 0)}
          />
          <Metric
            label="FG receipt value"
            value={money(production.summary.production_receipt_value || 0)}
          />
          <Metric
            label="Open WIP value"
            value={money(production.summary.wip_value || 0)}
          />
        </div>
        {loading ? (
          <Loading />
        ) : production.jobs?.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-3">Job order</th>
                  <th className="px-2 py-3 text-right">Std. material</th>
                  <th className="px-2 py-3 text-right">Actual material</th>
                  <th className="px-2 py-3 text-right">Conversion variance</th>
                  <th className="px-2 py-3 text-right">Yield loss</th>
                  <th className="px-2 py-3 text-right">Total variance</th>
                  <th className="px-2 py-3">Assurance</th>
                </tr>
              </thead>
              <tbody>
                {production.jobs.slice(0, 40).map((job: any) => (
                  <tr key={job.id} className="border-b border-slate-100">
                    <td className="px-2 py-3">
                      <b>{job.job_order_number}</b>
                      <small className="block max-w-64 text-slate-500">
                        {job.item_code} · {job.item_name}
                      </small>
                    </td>
                    <td className="px-2 py-3 text-right">
                      {money(job.standard_material_cost)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {job.assurance === "CONTROLLED"
                        ? money(job.actual_material_cost)
                        : "Not calculated"}
                      <small className="block text-slate-500">
                        {job.fifo_material_evidence
                          ? "FIFO evidence"
                          : "Execution evidence incomplete"}
                      </small>
                    </td>
                    <td
                      className={`px-2 py-3 text-right ${job.conversion_variance > 0 ? "text-red-700" : "text-emerald-700"}`}
                    >
                      {job.conversion_variance == null
                        ? "—"
                        : money(job.conversion_variance)}
                    </td>
                    <td className="px-2 py-3 text-right text-red-700">
                      {job.yield_variance == null
                        ? "—"
                        : money(job.yield_variance)}
                    </td>
                    <td
                      className={`px-2 py-3 text-right font-semibold ${job.total_variance > 0 ? "text-red-700" : "text-emerald-700"}`}
                    >
                      {job.total_variance == null
                        ? "Not calculated"
                        : money(job.total_variance)}
                      <small className="block">
                        {job.variance_percent == null
                          ? "No controlled baseline"
                          : `${Number(job.variance_percent).toFixed(1)}%`}
                      </small>
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${job.assurance === "CONTROLLED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
                      >
                        {job.assurance}
                      </span>
                      {job.exceptions?.length > 0 && (
                        <small className="mt-1 block max-w-60 text-amber-800">
                          {job.exceptions.join(" · ").replaceAll("_", " ")}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 p-5 text-sm text-slate-500">
            No recent production jobs are available for variance analysis.
          </div>
        )}
      </section>
      <section className="rounded-xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-violet-950">
              Costing-readiness remediation
            </h2>
            <p className="mt-1 text-sm text-violet-800">
              Assign missing standards, routing, rates and execution evidence to
              an owner. Corrections remain inside their native controlled
              workflow.
            </p>
          </div>
          <button
            type="button"
            onClick={syncRemediations}
            disabled={loading}
            className="rounded-lg bg-violet-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Synchronize current findings
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Open" value={String(remediation.summary.open || 0)} />
          <Metric
            label="In progress"
            value={String(remediation.summary.in_progress || 0)}
          />
          <Metric
            label="Unassigned"
            value={String(remediation.summary.unassigned || 0)}
          />
          <Metric
            label="Overdue"
            value={String(remediation.summary.overdue || 0)}
          />
          <Metric
            label="Critical"
            value={String(remediation.summary.critical || 0)}
          />
          <Metric
            label="Resolved"
            value={String(remediation.summary.resolved || 0)}
          />
        </div>
        <div className="mt-4 space-y-3">
          {(remediation.actions || [])
            .filter(
              (row: any) => !["RESOLVED", "DISMISSED"].includes(row.status),
            )
            .slice(0, 50)
            .map((row: any) => (
              <RemediationRow
                key={row.id}
                row={row}
                users={remediation.users || []}
                busy={drafting === row.id}
                update={updateRemediation}
              />
            ))}
          {!remediation.summary.open && !remediation.summary.in_progress && (
            <p className="rounded-lg bg-white p-4 text-sm text-slate-600">
              Synchronize current findings to create the first controlled
              remediation worklist.
            </p>
          )}
        </div>
      </section>
      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">
          Purchase-price variance feeding production
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Receipt unit cost compared with the approved item standard cost.
          Positive values are adverse.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Metric
            label="Purchase-price variance"
            value={money(production.summary.purchase_price_variance || 0)}
          />
          <Metric
            label="Adverse production jobs"
            value={String(production.summary.adverse_jobs || 0)}
          />
        </div>
        {production.purchase_price_variances?.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-3">Receipt / item</th>
                  <th className="px-2 py-3 text-right">Quantity</th>
                  <th className="px-2 py-3 text-right">Standard unit</th>
                  <th className="px-2 py-3 text-right">Actual unit</th>
                  <th className="px-2 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {production.purchase_price_variances
                  .slice(0, 20)
                  .map((row: any, index: number) => (
                    <tr
                      key={`${row.reference_number}-${row.item_id}-${index}`}
                      className="border-b border-slate-100"
                    >
                      <td className="px-2 py-3">
                        <b>{row.reference_number || "No reference"}</b>
                        <small className="block text-slate-500">
                          {row.item_code} · {row.item_name}
                          {row.exception ? " · standard cost missing" : ""}
                        </small>
                      </td>
                      <td className="px-2 py-3 text-right">{row.quantity}</td>
                      <td className="px-2 py-3 text-right">
                        {money(row.standard_unit_cost)}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {money(row.actual_unit_cost)}
                      </td>
                      <td
                        className={`px-2 py-3 text-right font-semibold ${row.variance > 0 ? "text-red-700" : "text-emerald-700"}`}
                      >
                        {row.variance == null
                          ? "Not calculated"
                          : money(row.variance)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-slate-50 p-5 text-sm text-slate-500">
            No purchase-receipt cost evidence is available in this period.
          </p>
        )}
      </section>
      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">FIFO evidence coverage</h2>
        <p className="mt-1 text-sm text-slate-500">
          A reconciliation indicator for new receipt and dispatch evidence; it
          is not a GL valuation.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Metric
            label="Receipt events"
            value={String(coverage?.receipt_event_count || 0)}
          />
          <Metric
            label="Receipt cost evidence"
            value={money(coverage?.receipt_cost || 0)}
          />
          <Metric
            label="Issue events"
            value={String(coverage?.issue_event_count || 0)}
          />
          <Metric
            label="Issue cost evidence"
            value={money(coverage?.issue_cost || 0)}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">{coverage?.disclaimer}</p>
      </section>
      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">
              Inventory-to-ledger control
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Every receipt and issue must have a posted, source-linked journal
              before finance certification.
            </p>
          </div>
          <button
            onClick={createRun}
            disabled={loading}
            className="rounded-lg bg-[#613535] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Create month snapshot
          </button>
        </div>
        {events.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-3">Reference</th>
                  <th className="px-2 py-3">Movement</th>
                  <th className="px-2 py-3 text-right">Value</th>
                  <th className="px-2 py-3">Ledger control</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 20).map((event) => (
                  <tr key={event.id} className="border-b border-slate-100">
                    <td className="px-2 py-3 font-medium">
                      {event.reference_number || "No reference"}
                    </td>
                    <td className="px-2 py-3">
                      {event.event_type.replaceAll("_", " ")}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {money(event.total_cost)}
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${event.posting?.journal?.status === "POSTED" ? "bg-emerald-100 text-emerald-700" : event.posting ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}
                      >
                        {event.posting?.journal?.status || "MISSING"}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right">
                      {event.posting ? (
                        <span className="text-xs text-slate-500">
                          {event.posting.journal?.journal_number}
                        </span>
                      ) : (
                        <button
                          onClick={() => draftEvent(event.id)}
                          disabled={drafting === event.id}
                          className="rounded border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700"
                        >
                          Create draft
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 p-5 text-sm text-slate-500">
            No valuation events recorded.
          </div>
        )}
      </section>
      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">
          Period valuation certificates
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Immutable FIFO snapshots with independent finance sign-off and
          tamper-evident evidence hashes.
        </p>
        {runs.length ? (
          <div className="mt-4 space-y-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {run.run_code}
                    </div>
                    <div className="text-xs text-slate-500">
                      {run.period_start} to {run.period_end} · {run.event_count}{" "}
                      events · hash {run.evidence_hash.slice(0, 12)}…
                    </div>
                  </div>
                  <span
                    className={`h-fit rounded-full px-2 py-1 text-xs font-bold ${run.status === "CERTIFIED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-5">
                  <Metric label="Opening" value={money(run.opening_value)} />
                  <Metric label="Receipts" value={money(run.receipt_value)} />
                  <Metric
                    label="Issues / COGS"
                    value={money(run.issue_value)}
                  />
                  <Metric label="Closing" value={money(run.closing_value)} />
                  <Metric
                    label="Variance"
                    value={money(run.movement_variance)}
                  />
                </div>
                {run.status === "DRAFT" && (
                  <button
                    onClick={() => certify(run.id)}
                    disabled={
                      run.exception_count > 0 ||
                      Math.abs(run.movement_variance) > 0.005
                    }
                    className="mt-3 inline-flex items-center gap-2 rounded border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <CheckCircle2 size={14} /> Certify ({run.exception_count}{" "}
                    exceptions)
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 p-5 text-sm text-slate-500">
            Create the first monthly valuation snapshot after all source
            journals are posted.
          </div>
        )}
      </section>
      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Billed item margin</h2>
        <p className="mt-1 text-sm text-slate-500">
          Lowest margin items appear first, making leakage visible for
          commercial and finance review.
        </p>
        {loading ? (
          <Loading />
        ) : data?.lines.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-3">Item</th>
                  <th className="px-2 py-3 text-right">Qty</th>
                  <th className="px-2 py-3 text-right">Revenue</th>
                  <th className="px-2 py-3 text-right">Std. cost</th>
                  <th className="px-2 py-3 text-right">Margin</th>
                  <th className="px-2 py-3 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr
                    key={line.item_id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-2 py-3">
                      <div className="font-medium text-slate-900">
                        {line.item_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {line.item_code || "No code"}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right">{line.quantity}</td>
                    <td className="px-2 py-3 text-right">
                      {money(line.revenue)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {money(line.standard_cost)}
                    </td>
                    <td
                      className={`px-2 py-3 text-right font-semibold ${line.gross_margin < 0 ? "text-red-700" : "text-emerald-700"}`}
                    >
                      {money(line.gross_margin)}
                    </td>
                    <td
                      className={`px-2 py-3 text-right font-semibold ${line.gross_margin_percent < 0 ? "text-red-700" : "text-emerald-700"}`}
                    >
                      {line.gross_margin_percent.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 p-6 text-sm text-slate-500">
            No active billed item lines are available for this tenant yet.
          </div>
        )}
      </section>
      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">
          FIFO COGS evidence register
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          New PGIs capture their consumed layer cost here. Finance must still
          approve a ledger mapping before any draft journal is created.
        </p>
        {loading ? (
          <Loading />
        ) : fifo?.events.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-3">Dispatch</th>
                  <th className="px-2 py-3">Item</th>
                  <th className="px-2 py-3 text-right">Qty</th>
                  <th className="px-2 py-3 text-right">FIFO unit cost</th>
                  <th className="px-2 py-3 text-right">Cost</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fifo.events.slice(0, 20).map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-2 py-3 font-medium">
                      {event.reference_number || "—"}
                    </td>
                    <td className="px-2 py-3">
                      {event.items?.name || event.items?.code || "Item"}
                    </td>
                    <td className="px-2 py-3 text-right">{event.quantity}</td>
                    <td className="px-2 py-3 text-right">
                      {money(event.unit_cost)}
                    </td>
                    <td className="px-2 py-3 text-right font-semibold">
                      {money(event.total_cost)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <button
                        onClick={() => draft(event.id)}
                        disabled={drafting === event.id}
                        className="rounded border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {drafting === event.id ? "Creating…" : "Create draft"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 p-6 text-sm text-slate-500">
            No FIFO cost events yet. Create a new test dispatch to begin the
            evidence register.
          </div>
        )}
      </section>
    </div>
  );
}
function RemediationRow({
  row,
  users,
  busy,
  update,
}: {
  row: any;
  users: any[];
  busy: boolean;
  update: (id: string, body: any) => Promise<void>;
}) {
  const [owner, setOwner] = useState(String(row.assigned_to || ""));
  const [due, setDue] = useState(String(row.due_date || ""));
  const [note, setNote] = useState(String(row.owner_note || ""));
  const [evidence, setEvidence] = useState(
    String(row.resolution_evidence || ""),
  );
  const body = (status: string) => ({
    status,
    assigned_to: owner || null,
    due_date: due || null,
    owner_note: note,
    resolution_evidence: evidence,
  });
  return (
    <div className="rounded-xl border border-violet-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b>{row.title}</b>
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${row.severity === "CRITICAL" ? "bg-red-100 text-red-800" : row.severity === "HIGH" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}
            >
              {row.severity}
            </span>
            <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
              {row.status.replaceAll("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {row.job?.job_order_number} · {row.job?.item_code} ·{" "}
            {row.job?.item_name}
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {row.recommended_action}
          </p>
        </div>
        <Link
          href={row.target_route || "/dashboard/accounts/costing"}
          className="rounded border border-violet-300 px-3 py-2 text-xs font-semibold text-violet-800"
        >
          Open controlled workflow
        </Link>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-[1.4fr_0.8fr_2fr_2fr_auto]">
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          className="rounded border px-2 py-2 text-xs"
        >
          <option value="">Assign owner</option>
          {users.map((user: any) => (
            <option key={user.id} value={user.id}>
              {[user.first_name, user.last_name].filter(Boolean).join(" ") ||
                user.email}
            </option>
          ))}
        </select>
        <input
          value={due}
          onChange={(event) => setDue(event.target.value)}
          type="date"
          className="rounded border px-2 py-2 text-xs"
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Owner plan / note"
          className="rounded border px-2 py-2 text-xs"
        />
        <input
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          placeholder="Resolution evidence (required to resolve)"
          className="rounded border px-2 py-2 text-xs"
        />
        <div className="flex gap-1">
          <button
            disabled={busy}
            onClick={() => update(row.id, body("IN_PROGRESS"))}
            type="button"
            className="rounded bg-violet-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Start
          </button>
          <button
            disabled={busy}
            onClick={() => update(row.id, body("RESOLVED"))}
            type="button"
            className="rounded border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50"
          >
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
      <Loader2 size={16} className="animate-spin" /> Loading billed margin…
    </div>
  );
}
