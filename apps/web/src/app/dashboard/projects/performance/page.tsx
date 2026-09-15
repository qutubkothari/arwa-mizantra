"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const money = (value: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
const ratio = (value: any) => Number(value || 0).toFixed(2);

export default function ProjectPerformancePage() {
  const [data, setData] = useState<any>({
    kpis: {},
    projects: [],
    performance: [],
    actions: [],
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiClient.get("/project-performance/dashboard"));
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Unable to load project performance.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const snapshot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiClient.post(
        "/project-performance/snapshots",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      event.currentTarget.reset();
      setMessage("Earned-value snapshot saved.");
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save project snapshot.");
    }
  };
  const propose = async (row: any) => {
    const issue_category = prompt(
      "Issue category: COST, SCHEDULE, SCOPE, BILLING, COLLECTION, PROCUREMENT or CHANGE_ORDER",
      row.collection_gap > row.margin_leakage ? "COLLECTION" : "COST",
    );
    const action_description = prompt(
      "Recovery action and measurable deliverable",
    );
    const owner_reference = prompt("Accountable owner");
    const due_date = prompt(
      "Due date (YYYY-MM-DD)",
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    );
    const target_margin_recovery = prompt(
      "Target margin recovery AED",
      String(Math.round(row.margin_leakage || 0)),
    );
    const target_cash_acceleration = prompt(
      "Target cash acceleration AED",
      String(Math.round(row.collection_gap || row.unbilled_earned_value || 0)),
    );
    if (!issue_category || !action_description || !owner_reference || !due_date)
      return;
    try {
      await apiClient.post("/project-performance/actions", {
        project_id: row.project.id,
        snapshot_id: row.snapshot.id,
        issue_category,
        action_description,
        owner_reference,
        due_date,
        target_margin_recovery,
        target_cash_acceleration,
      });
      setMessage("Project recovery action proposed.");
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to propose recovery action.");
    }
  };
  const patch = async (url: string, body: any, success: string) => {
    try {
      await apiClient.patch(url, body);
      setMessage(success);
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to progress recovery action.");
    }
  };
  const approve = (id: string) => {
    const approval_note = prompt("Independent approval rationale");
    if (approval_note)
      patch(
        `/project-performance/actions/${id}/approve`,
        { approval_note },
        "Recovery action approved.",
      );
  };
  const execute = (id: string) => {
    const execution_evidence = prompt("Execution evidence reference");
    if (execution_evidence)
      patch(
        `/project-performance/actions/${id}/execute`,
        { execution_evidence },
        "Execution evidence recorded.",
      );
  };
  const verify = (id: string) => {
    const realized_margin_recovery = prompt(
      "Finance-verified margin recovery AED",
      "0",
    );
    const realized_cash_acceleration = prompt(
      "Finance-verified cash acceleration AED",
      "0",
    );
    const verification_evidence = prompt("Independent verification evidence");
    if (
      realized_margin_recovery !== null &&
      realized_cash_acceleration !== null &&
      verification_evidence
    )
      patch(
        `/project-performance/actions/${id}/verify`,
        {
          realized_margin_recovery,
          realized_cash_acceleration,
          verification_evidence,
        },
        "Project recovery independently verified.",
      );
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#263B59] to-[#496B92] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-blue-100">
              <Gauge size={18} />
              Earned value to verified project recovery
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Project Margin Leakage & EVM Control
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              SAP-style CPI, SPI and forecast-at-completion with billing,
              collections and independently verified AED recovery.
            </p>
          </div>
          <button onClick={load} aria-label="Refresh">
            <RefreshCw className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </header>
      {message && (
        <p className="rounded bg-blue-50 p-3 text-sm text-blue-800">
          {message}
        </p>
      )}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <K
          label="Controlled projects"
          value={data.kpis.controlled_projects || 0}
        />
        <K label="Margin leakage" value={money(data.kpis.margin_leakage)} />
        <K
          label="Forecast overrun"
          value={money(data.kpis.forecast_cost_overrun)}
        />
        <K
          label="Unbilled earned value"
          value={money(data.kpis.unbilled_value)}
        />
        <K label="Collection gap" value={money(data.kpis.collection_gap)} />
        <K
          label="Verified recovery"
          value={money(data.kpis.verified_recovery)}
        />
      </section>
      <form onSubmit={snapshot} className="rounded-xl border bg-white p-4">
        <h2 className="mb-1 font-semibold">
          Periodic project control snapshot
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Capture approved source values as-of a closed reporting date. The
          system derives CV, SV, CPI, SPI, EAC, VAC and margin leakage.
        </p>
        <div className="grid gap-2 md:grid-cols-4">
          <select required name="project_id" className={field}>
            <option value="">Active project</option>
            {data.projects
              .filter((row: any) => row.status === "ACTIVE")
              .map((row: any) => (
                <option key={row.id} value={row.id}>
                  {row.project_code} · {row.project_name}
                </option>
              ))}
          </select>
          <input
            required
            name="as_of_date"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            className={field}
          />
          <input
            required
            name="budget_at_completion"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Budget at completion AED"
            className={field}
          />
          <input
            required
            name="contract_value"
            type="number"
            min="0"
            step="0.01"
            placeholder="Contract value AED"
            className={field}
          />
          <input
            required
            name="planned_value"
            type="number"
            min="0"
            step="0.01"
            placeholder="Planned value AED"
            className={field}
          />
          <input
            required
            name="earned_value"
            type="number"
            min="0"
            step="0.01"
            placeholder="Earned value AED"
            className={field}
          />
          <input
            required
            name="actual_cost"
            type="number"
            min="0"
            step="0.01"
            placeholder="Actual cost AED"
            className={field}
          />
          <input
            name="committed_cost"
            type="number"
            min="0"
            step="0.01"
            placeholder="Committed cost AED"
            className={field}
          />
          <input
            name="approved_change_orders"
            type="number"
            step="0.01"
            placeholder="Approved change orders AED"
            className={field}
          />
          <input
            name="billed_value"
            type="number"
            min="0"
            step="0.01"
            placeholder="Billed value AED"
            className={field}
          />
          <input
            name="cash_collected"
            type="number"
            min="0"
            step="0.01"
            placeholder="Cash collected AED"
            className={field}
          />
          <input
            required
            name="evidence_reference"
            placeholder="Approved cost/progress evidence"
            className={field}
          />
          <button className="rounded bg-[#263B59] px-3 py-2 text-sm text-white">
            Save snapshot
          </button>
        </div>
      </form>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Project exception portfolio</h2>
          {data.performance.map((row: any) => (
            <div key={row.project.id} className="border-b py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span>
                  <b>
                    {row.project.project_code} · {row.project.project_name}
                  </b>
                  {row.snapshot ? (
                    <small className="block text-slate-500">
                      As of {row.snapshot.as_of_date} · CPI {ratio(row.cpi)} ·
                      SPI {ratio(row.spi)} · EAC{" "}
                      {money(row.estimate_at_completion)}
                    </small>
                  ) : (
                    <small className="block text-slate-500">
                      No control snapshot
                    </small>
                  )}
                </span>
                {row.snapshot && (
                  <span className="text-right">
                    <b
                      className={
                        row.margin_leakage > 0
                          ? "text-red-700"
                          : "text-emerald-700"
                      }
                    >
                      {money(row.margin_leakage)} leakage
                    </b>
                    <small className="block text-slate-500">
                      Unbilled {money(row.unbilled_earned_value)} · gap{" "}
                      {money(row.collection_gap)}
                    </small>
                    <button
                      onClick={() => propose(row)}
                      className="mt-1 rounded border px-2 py-1"
                    >
                      Recovery action
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Controlled recovery & verified ROI</h2>
          {data.actions.map((row: any) => (
            <div
              key={row.id}
              className="flex justify-between gap-3 border-b py-3 text-sm"
            >
              <span>
                <b>
                  {row.project?.project_code} · {row.issue_category}
                </b>
                <small className="block text-slate-500">
                  {row.status} · owner {row.owner_reference} · due{" "}
                  {row.due_date}
                </small>
                <small className="block text-slate-500">
                  Target margin {money(row.target_margin_recovery)} · cash{" "}
                  {money(row.target_cash_acceleration)}
                </small>
              </span>
              <span>
                {row.status === "PROPOSED" && (
                  <button
                    onClick={() => approve(row.id)}
                    className="rounded border px-2 py-1"
                  >
                    Approve
                  </button>
                )}
                {row.status === "APPROVED" && (
                  <button
                    onClick={() => execute(row.id)}
                    className="rounded border px-2 py-1"
                  >
                    Executed
                  </button>
                )}
                {row.status === "EXECUTED" && (
                  <button
                    onClick={() => verify(row.id)}
                    className="rounded border px-2 py-1"
                  >
                    Verify ROI
                  </button>
                )}
                {row.status === "VERIFIED" && (
                  <b className="text-emerald-700">
                    {money(
                      Number(row.realized_margin_recovery || 0) +
                        Number(row.realized_cash_acceleration || 0),
                    )}
                  </b>
                )}
              </span>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

function K({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
