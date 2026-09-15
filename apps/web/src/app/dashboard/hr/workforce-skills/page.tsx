"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, UsersRound } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const money = (value: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
const number = (value: any) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 1 }).format(
    Number(value || 0),
  );

export default function WorkforceSkillsPage() {
  const [data, setData] = useState<any>({
    kpis: {},
    employees: [],
    requirements: [],
    assessments: [],
    gaps: [],
    actions: [],
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiClient.get("/workforce-skills/dashboard"));
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Unable to load workforce skills.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const postForm =
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
        setMessage(error?.message || "Unable to save.");
      }
    };
  const propose = async (gap: any) => {
    const action_type = prompt(
      "Action: TRAIN, CROSS_TRAIN, REDEPLOY, HIRE, CONTRACT or AUTOMATE",
      "CROSS_TRAIN",
    );
    const action_description = prompt("Measurable gap-closure action");
    const owner_reference = prompt("Accountable owner");
    const due_date = prompt(
      "Due date (YYYY-MM-DD)",
      new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
    );
    const target_annual_cost_avoidance = prompt(
      "Target annual cost avoidance AED",
      String(Math.round(gap.annual_capacity_risk || 0)),
    );
    if (!action_type || !action_description || !owner_reference || !due_date)
      return;
    try {
      await apiClient.post("/workforce-skills/actions", {
        requirement_id: gap.id,
        action_type,
        affected_headcount: Math.max(1, gap.uncovered_headcount),
        action_description,
        owner_reference,
        due_date,
        target_annual_cost_avoidance,
      });
      setMessage("Workforce gap action proposed.");
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to propose workforce action.");
    }
  };
  const patch = async (url: string, body: any, success: string) => {
    try {
      await apiClient.patch(url, body);
      setMessage(success);
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to progress workforce action.");
    }
  };
  const approve = (id: string) => {
    const approval_note = prompt("Independent approval rationale");
    if (approval_note)
      patch(
        `/workforce-skills/actions/${id}/approve`,
        { approval_note },
        "Workforce action approved.",
      );
  };
  const execute = (id: string) => {
    const execution_evidence = prompt(
      "Training, qualification or deployment evidence",
    );
    if (execution_evidence)
      patch(
        `/workforce-skills/actions/${id}/execute`,
        { execution_evidence },
        "Execution evidence recorded.",
      );
  };
  const verify = (id: string) => {
    const realized_annual_cost_avoidance = prompt(
      "Verified annual cost avoidance AED",
      "0",
    );
    const verification_evidence = prompt(
      "Independent operations/finance verification evidence",
    );
    if (realized_annual_cost_avoidance !== null && verification_evidence)
      patch(
        `/workforce-skills/actions/${id}/verify`,
        { realized_annual_cost_avoidance, verification_evidence },
        "Workforce ROI independently verified.",
      );
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#4B284F] to-[#79527E] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-purple-100">
              <UsersRound size={18} />
              Critical skill coverage to verified capacity savings
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Workforce Skills, Certification & Capacity Risk
            </h1>
            <p className="mt-1 text-sm text-purple-100">
              Maps role-critical skills, evidence-backed proficiency and
              certification validity to quantified AED capacity exposure.
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
        <K label="Critical skills" value={data.kpis.critical_skills || 0} />
        <K
          label="Uncovered positions"
          value={data.kpis.uncovered_positions || 0}
        />
        <K
          label="Annual capacity risk"
          value={money(data.kpis.annual_capacity_risk)}
        />
        <K
          label="Certifications expiring"
          value={data.kpis.certifications_expiring_60d || 0}
        />
        <K
          label="Approved savings"
          value={money(data.kpis.approved_savings_pipeline)}
        />
        <K
          label="Verified savings"
          value={money(data.kpis.verified_annual_savings)}
        />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={postForm(
            "/workforce-skills/requirements",
            "Critical skill requirement saved.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Critical skill requirement</h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="requirement_code"
              placeholder="Requirement code"
              className={field}
            />
            <input
              required
              name="skill_name"
              placeholder="Skill / authorization"
              className={field}
            />
            <input
              name="department"
              placeholder="Department (optional)"
              className={field}
            />
            <input
              name="designation"
              placeholder="Designation (optional)"
              className={field}
            />
            <select name="criticality" defaultValue="HIGH" className={field}>
              <option>LOW</option>
              <option>MEDIUM</option>
              <option>HIGH</option>
              <option>CRITICAL</option>
            </select>
            <input
              required
              name="required_headcount"
              type="number"
              min="1"
              defaultValue="1"
              placeholder="Required headcount"
              className={field}
            />
            <input
              required
              name="minimum_proficiency"
              type="number"
              min="1"
              max="5"
              defaultValue="3"
              placeholder="Minimum proficiency 1-5"
              className={field}
            />
            <label className="flex items-center gap-2 rounded border px-3 text-sm">
              <input name="certification_required" type="checkbox" />
              Certification required
            </label>
            <input
              required
              name="annual_risk_hours"
              type="number"
              min="0"
              step="0.01"
              defaultValue="160"
              placeholder="Annual risk hours"
              className={field}
            />
            <input
              required
              name="cost_per_gap_hour"
              type="number"
              min="0"
              step="0.01"
              placeholder="Cost per gap hour AED"
              className={field}
            />
          </div>
          <button className="rounded bg-[#4B284F] px-3 py-2 text-sm text-white">
            Save requirement
          </button>
        </form>
        <form
          onSubmit={postForm(
            "/workforce-skills/assessments",
            "Evidence-backed skill assessment saved.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Employee skill assessment</h2>
          <select required name="requirement_id" className={field}>
            <option value="">Skill requirement</option>
            {data.requirements.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.requirement_code} · {row.skill_name}
              </option>
            ))}
          </select>
          <select required name="employee_id" className={field}>
            <option value="">Active employee</option>
            {data.employees.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.employee_code} · {row.employee_name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="proficiency_level"
              type="number"
              min="1"
              max="5"
              placeholder="Proficiency 1-5"
              className={field}
            />
            <input
              required
              name="assessed_on"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              className={field}
            />
            <input name="certified_until" type="date" className={field} />
            <input
              required
              name="evidence_reference"
              placeholder="Assessment/certificate evidence"
              className={field}
            />
          </div>
          <button className="rounded bg-[#4B284F] px-3 py-2 text-sm text-white">
            Save assessment
          </button>
        </form>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Ranked skill and capacity gaps</h2>
          {data.gaps.map((row: any) => (
            <div
              key={row.id}
              className="flex justify-between gap-3 border-b py-3 text-sm"
            >
              <span>
                <b>
                  {row.requirement_code} · {row.skill_name}
                </b>
                <small className="block text-slate-500">
                  {row.criticality} · qualified {row.qualified_headcount}/
                  {row.required_headcount} · coverage {number(row.coverage_pct)}
                  %
                </small>
                <small className="block text-slate-500">
                  Eligible {row.eligible_headcount} · assessed{" "}
                  {row.assessed_headcount}
                </small>
              </span>
              <span className="text-right">
                <b
                  className={
                    row.uncovered_headcount
                      ? "text-red-700"
                      : "text-emerald-700"
                  }
                >
                  {row.uncovered_headcount} gaps
                </b>
                <small className="block text-slate-500">
                  {money(row.annual_capacity_risk)}/yr risk
                </small>
                {row.uncovered_headcount > 0 && (
                  <button
                    onClick={() => propose(row)}
                    className="mt-1 rounded border px-2 py-1"
                  >
                    Close gap
                  </button>
                )}
              </span>
            </div>
          ))}
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Controlled actions & verified ROI</h2>
          {data.actions.map((row: any) => (
            <div
              key={row.id}
              className="flex justify-between gap-3 border-b py-3 text-sm"
            >
              <span>
                <b>
                  {row.requirement?.requirement_code} · {row.action_type}
                </b>
                <small className="block text-slate-500">
                  {row.status} · {row.affected_headcount} people · due{" "}
                  {row.due_date}
                </small>
                <small className="block text-slate-500">
                  Target {money(row.target_annual_cost_avoidance)}/yr
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
                    {money(row.realized_annual_cost_avoidance)}
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
