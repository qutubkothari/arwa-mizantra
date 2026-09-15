"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const num = (v: any) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(
    Number(v || 0),
  );
const money = (v: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));
export default function PlanningControlTower() {
  const [data, setData] = useState<any>({
      summary: {},
      programs: [],
      action_queue: [],
    }),
    [cost, setCost] = useState<any>({ summary: {}, jobs: [] }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [tower, variance] = await Promise.all([
        apiClient.get("/production-planning/control-tower"),
        apiClient.get("/costing/production-variance"),
      ]);
      setData(tower);
      setCost(variance);
      setMessage("");
    } catch (e: any) {
      setMessage(e?.message || "Unable to load the control tower.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-3 sm:p-5">
      <header className="rounded-2xl bg-gradient-to-r from-[#4A3526] to-[#8B6844] p-6 text-white">
        <div className="flex justify-between gap-3">
          <div>
            <p className="text-sm text-amber-100">
              Demand-to-production intelligence
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              Production Planning Control Tower
            </h1>
            <p className="mt-2 max-w-4xl text-sm text-amber-50">
              One owner view of delivery feasibility, bottlenecks, material
              shortages, cost variance, blocked cash, recovery choices and
              governed release readiness.
            </p>
          </div>
          <button
            onClick={load}
            className="h-fit rounded border border-white/40 p-2"
          >
            <RefreshCw className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </header>
      {message && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {message}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-10">
        <K
          icon={<CalendarClock />}
          l="Programs"
          v={num(data.summary.programs)}
        />
        <K
          icon={<AlertTriangle />}
          l="Delivery at risk"
          v={num(data.summary.at_risk)}
          risk={data.summary.at_risk > 0}
        />
        <K
          icon={<AlertTriangle />}
          l="Critical materials"
          v={num(data.summary.critical_materials)}
          risk={data.summary.critical_materials > 0}
        />
        <K
          icon={<Banknote />}
          l="Planned material cash"
          v={money(data.summary.cash_required)}
        />
        <K
          icon={<ShieldCheck />}
          l="Frozen/released"
          v={num(data.summary.frozen)}
        />
        <K
          icon={<Banknote />}
          l="Production variance"
          v={money(cost.summary.total_variance)}
          risk={cost.summary.total_variance > 0}
        />
        <K
          icon={<AlertTriangle />}
          l="Incomplete cost jobs"
          v={num(cost.summary.incomplete_jobs)}
          risk={cost.summary.incomplete_jobs > 0}
        />
        <K
          icon={<AlertTriangle />}
          l="Execution jobs at risk"
          v={num(data.summary.execution_jobs_at_risk)}
          risk={data.summary.execution_jobs_at_risk > 0}
        />
        <K
          icon={<ShieldCheck />}
          l="Completed linked jobs"
          v={num(data.summary.completed_job_orders)}
        />
        <K
          icon={<AlertTriangle />}
          l="Priority actions"
          v={num(data.summary.action_count)}
          risk={data.summary.action_count > 0}
        />
      </div>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Owner transformation action queue</h2>
            <p className="mt-1 text-xs text-slate-500">
              Deterministically ranked from delivery, material, capacity,
              execution, cash and release-control evidence. No AI model is used.
            </p>
          </div>
          <span className="rounded-full bg-[#F7F2E9] px-3 py-1 text-xs font-semibold text-[#4A3526]">
            {num(data.action_queue?.length)} current actions
          </span>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {(data.action_queue || []).slice(0, 10).map((action: any) => (
            <div
              key={action.id}
              className={`rounded-lg border p-3 ${action.priority_score >= 90 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <b className="rounded bg-white px-2 py-1">
                  Priority {num(action.priority_score)}
                </b>
                <span className="font-semibold text-slate-600">
                  {action.domain}
                </span>
                <span className="text-slate-500">
                  Due {action.due_date || "—"}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-semibold">{action.title}</h3>
              <p className="mt-1 text-xs text-slate-600">
                {action.explanation}
              </p>
              <p className="mt-2 text-xs">
                <b>Next control:</b> {action.next_action}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <small className="text-slate-500">
                  Evidence: {action.evidence_source}
                </small>
                <Link
                  href={action.route}
                  className="rounded border border-[#4A3526] bg-white px-2 py-1 text-xs font-semibold text-[#4A3526]"
                >
                  Open workflow
                </Link>
              </div>
            </div>
          ))}
          {!data.action_queue?.length && !busy && (
            <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
              No current production transformation exception requires action.
            </p>
          )}
        </div>
        {data.control && (
          <p className="mt-3 text-xs font-semibold text-slate-600">
            {data.control}
          </p>
        )}
      </section>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">Cost and yield exceptions</h2>
            <p className="text-xs text-slate-500">
              Adverse variance and missing standards require correction before
              profitability is trusted.
            </p>
          </div>
          <Link
            href="/dashboard/accounts/costing"
            className="rounded border border-[#4A3526] px-3 py-2 text-sm font-semibold text-[#4A3526]"
          >
            Open cost cockpit
          </Link>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <K
            icon={<Banknote />}
            l="Actual / estimated cost"
            v={money(cost.summary.actual_cost)}
          />
          <K
            icon={<AlertTriangle />}
            l="Yield loss"
            v={money(cost.summary.yield_loss)}
            risk={cost.summary.yield_loss > 0}
          />
          <K
            icon={<AlertTriangle />}
            l="Adverse jobs"
            v={num(cost.summary.adverse_jobs)}
            risk={cost.summary.adverse_jobs > 0}
          />
        </div>
        {(cost.jobs || [])
          .filter((x: any) => x.total_variance > 0 || x.exceptions?.length)
          .slice(0, 6)
          .map((x: any) => (
            <p
              key={x.id}
              className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900"
            >
              <b>{x.job_order_number}</b> · variance{" "}
              {x.total_variance == null
                ? "not calculated"
                : money(x.total_variance)}{" "}
              ·{" "}
              {x.exceptions?.length
                ? x.exceptions.join(" · ").replaceAll("_", " ")
                : "adverse actual cost"}
            </p>
          ))}
      </section>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">Exception-first program portfolio</h2>
            <p className="text-xs text-slate-500">
              At-risk programs sort first. Open the governed plan to replan,
              approve, freeze or create draft execution documents.
            </p>
          </div>
          <Link
            href="/dashboard/production/smart-planning"
            className="rounded bg-[#4A3526] px-3 py-2 text-sm font-semibold text-white"
          >
            Open planning workbench
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Program</th>
                <th className="p-2">Delivery</th>
                <th className="p-2">Bottleneck</th>
                <th className="p-2">Material risk</th>
                <th className="p-2">Cash</th>
                <th className="p-2">Execution</th>
                <th className="p-2">Recovery</th>
                <th className="p-2">Release</th>
              </tr>
            </thead>
            <tbody>
              {[...data.programs]
                .sort(
                  (a: any, b: any) => Number(a.feasible) - Number(b.feasible),
                )
                .map((x: any) => (
                  <tr
                    key={x.program_id}
                    className={
                      x.feasible === false ? "border-b bg-red-50" : "border-b"
                    }
                  >
                    <td className="p-2">
                      <b>{x.program_code}</b>
                      <small className="block text-slate-500">
                        {x.program_name} · due {x.due_date}
                      </small>
                    </td>
                    <td className="p-2">
                      <b
                        className={
                          x.feasible === false
                            ? "text-red-700"
                            : "text-emerald-700"
                        }
                      >
                        {x.feasible == null
                          ? "Not planned"
                          : x.feasible
                            ? "FEASIBLE"
                            : "AT RISK"}
                      </b>
                      <small className="block">
                        {num(x.confidence_pct)}% confidence ·{" "}
                        {x.projected_completion_date || "—"}
                      </small>
                    </td>
                    <td className="p-2">{x.bottleneck || "—"}</td>
                    <td className="p-2">
                      {num(x.critical_materials)} critical
                    </td>
                    <td className="p-2">
                      {money(x.material_cash_required)}
                      <small className="block text-amber-700">
                        {money(x.excess_wip_cash_risk)} excess/WIP risk
                      </small>
                    </td>
                    <td className="p-2">
                      <b
                        className={
                          x.execution?.jobs_at_risk > 0
                            ? "text-red-700"
                            : "text-emerald-700"
                        }
                      >
                        {num(x.execution?.jobs_at_risk)} at risk
                      </b>
                      <small className="block text-slate-500">
                        {num(x.execution?.completed_job_orders)} completed ·{" "}
                        {num(x.execution?.rejected_quantity)} rejected
                      </small>
                    </td>
                    <td className="max-w-xs p-2">
                      {x.recommended_recovery?.label || "Base plan"}
                      <small className="block text-slate-500">
                        {x.recommended_recovery?.impact ||
                          "No recovery action proposed."}
                      </small>
                    </td>
                    <td className="p-2">
                      <span className="block">
                        {x.approved ? "Approved" : "Approval pending"}
                      </span>
                      <span>
                        {x.frozen ? "Frozen" : "Not frozen"} · auto-replan{" "}
                        {x.auto_replan_enabled ? "ON" : "OFF"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!data.programs.length && !busy && (
            <p className="py-6 text-sm text-slate-500">
              No production programs have been created.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
function K({
  icon,
  l,
  v,
  risk = false,
}: {
  icon: any;
  l: string;
  v: string;
  risk?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${risk ? "border-red-200 bg-red-50" : "bg-white"}`}
    >
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{l}</span>
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-bold">{v}</p>
    </div>
  );
}
