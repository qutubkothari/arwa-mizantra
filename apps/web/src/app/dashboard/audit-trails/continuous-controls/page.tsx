"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, ScanSearch, ShieldCheck } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const money = (value: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export default function ContinuousControlsPage() {
  const [data, setData] = useState<any>({
    kpis: {},
    definitions: [],
    findings: [],
    actions: [],
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiClient.get("/continuous-controls/dashboard"));
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Unable to load continuous controls.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const scan = async () => {
    setBusy(true);
    try {
      setData(await apiClient.post("/continuous-controls/scan", {}));
      setMessage("180-day financial control scan completed.");
    } catch (error: any) {
      setMessage(error?.message || "Control scan failed.");
    } finally {
      setBusy(false);
    }
  };
  const saveDefinition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiClient.post(
        "/continuous-controls/definitions",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      setMessage("Control definition saved.");
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save control.");
    }
  };
  const remediate = async (finding: any) => {
    const action_description = prompt("Remediation action and control change");
    const owner_reference = prompt("Accountable owner");
    const due_date = prompt(
      "Due date (YYYY-MM-DD)",
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    );
    const target_loss_prevention = prompt(
      "Target loss prevention AED",
      String(Math.round(finding.exposure_amount || 0)),
    );
    if (!action_description || !owner_reference || !due_date) return;
    try {
      await apiClient.post("/continuous-controls/actions", {
        finding_id: finding.id,
        action_description,
        owner_reference,
        due_date,
        target_loss_prevention,
      });
      setMessage("Control remediation proposed.");
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to propose remediation.");
    }
  };
  const patch = async (url: string, body: any, success: string) => {
    try {
      await apiClient.patch(url, body);
      setMessage(success);
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to progress remediation.");
    }
  };
  const approve = (id: string) => {
    const approval_note = prompt("Independent approval rationale");
    if (approval_note)
      patch(
        `/continuous-controls/actions/${id}/approve`,
        { approval_note },
        "Remediation approved.",
      );
  };
  const execute = (id: string) => {
    const execution_evidence = prompt(
      "Implemented control and evidence reference",
    );
    if (execution_evidence)
      patch(
        `/continuous-controls/actions/${id}/execute`,
        { execution_evidence },
        "Remediation evidence recorded.",
      );
  };
  const verify = (id: string) => {
    const realized_loss_prevention = prompt(
      "Verified loss prevented/recovered AED",
      "0",
    );
    const verification_evidence = prompt(
      "Independent audit/finance verification evidence",
    );
    if (realized_loss_prevention !== null && verification_evidence)
      patch(
        `/continuous-controls/actions/${id}/verify`,
        { realized_loss_prevention, verification_evidence },
        "Control remediation independently verified.",
      );
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#222F3E] to-[#536779] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <ShieldCheck size={18} />
              Continuous assurance to verified loss prevention
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Continuous Controls & Leakage Prevention
            </h1>
            <p className="mt-1 text-sm text-slate-200">
              Scans posted finance evidence for independence, balance,
              duplicate-source and high-value manual-journal exceptions without
              changing transactions.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={scan}
              className="flex items-center gap-2 rounded border border-white/40 px-3 py-2 text-sm"
            >
              <ScanSearch size={17} />
              Run scan
            </button>
            <button onClick={load} aria-label="Refresh">
              <RefreshCw className={busy ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>
      {message && (
        <p className="rounded bg-blue-50 p-3 text-sm text-blue-800">
          {message}
        </p>
      )}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <K label="Active controls" value={data.kpis.active_controls || 0} />
        <K label="Open findings" value={data.kpis.open_findings || 0} />
        <K label="Critical findings" value={data.kpis.critical_findings || 0} />
        <K label="Exposure" value={money(data.kpis.exposure_amount)} />
        <K
          label="Prevention pipeline"
          value={money(data.kpis.approved_prevention_pipeline)}
        />
        <K
          label="Verified prevention"
          value={money(data.kpis.verified_loss_prevention)}
        />
      </section>
      <form
        onSubmit={saveDefinition}
        className="rounded-xl border bg-white p-4"
      >
        <h2 className="mb-2 font-semibold">Control configuration</h2>
        <div className="grid gap-2 md:grid-cols-5">
          <select name="control_code" className={field}>
            <option>POSTER_INDEPENDENCE</option>
            <option>POSTED_BALANCE</option>
            <option>DUPLICATE_SOURCE_POSTING</option>
            <option>HIGH_VALUE_MANUAL</option>
          </select>
          <input
            required
            name="control_name"
            placeholder="Control name"
            className={field}
          />
          <select name="severity" defaultValue="HIGH" className={field}>
            <option>LOW</option>
            <option>MEDIUM</option>
            <option>HIGH</option>
            <option>CRITICAL</option>
          </select>
          <input
            name="threshold"
            type="number"
            min="0"
            step="0.01"
            defaultValue="100000"
            placeholder="Manual journal threshold AED"
            className={field}
          />
          <button className="rounded bg-[#222F3E] px-3 py-2 text-sm text-white">
            Save control
          </button>
        </div>
      </form>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Detected control exceptions</h2>
          {data.findings.map((row: any) => (
            <div
              key={row.id}
              className="flex justify-between gap-3 border-b py-3 text-sm"
            >
              <span>
                <b>
                  {row.control_code} · {row.source_reference || row.source_id}
                </b>
                <small className="block text-slate-500">
                  {row.severity} · {row.status} · {row.finding_summary}
                </small>
              </span>
              <span className="text-right">
                <b className="text-red-700">{money(row.exposure_amount)}</b>
                {["OPEN", "ACCEPTED"].includes(row.status) && (
                  <button
                    onClick={() => remediate(row)}
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    Remediate
                  </button>
                )}
              </span>
            </div>
          ))}
          {!data.findings.length && (
            <p className="py-5 text-sm text-slate-500">
              Run the scanner to establish the continuous-control baseline.
            </p>
          )}
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">
            Controlled remediation & verified ROI
          </h2>
          {data.actions.map((row: any) => (
            <div
              key={row.id}
              className="flex justify-between gap-3 border-b py-3 text-sm"
            >
              <span>
                <b>
                  {row.finding?.control_code} · {row.finding?.source_reference}
                </b>
                <small className="block text-slate-500">
                  {row.status} · owner {row.owner_reference} · due{" "}
                  {row.due_date}
                </small>
                <small className="block text-slate-500">
                  Target {money(row.target_loss_prevention)}
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
                    Verify
                  </button>
                )}
                {row.status === "VERIFIED" && (
                  <b className="text-emerald-700">
                    {money(row.realized_loss_prevention)}
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
