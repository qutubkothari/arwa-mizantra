"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { LineChart, RefreshCw } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const f = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const money = (v: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));
export default function FpnaControlPage() {
  const [d, setD] = useState<any>({ kpis: {}, cycles: [], scenarios: [] }),
    [busy, setBusy] = useState(true),
    [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await apiClient.get("/fpna-control/dashboard"));
      setMsg("");
    } catch (e: any) {
      setMsg(e?.message || "Unable to load FP&A control.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const post =
    (url: string, ok: string) => async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      try {
        await apiClient.post(
          url,
          Object.fromEntries(new FormData(e.currentTarget)),
        );
        e.currentTarget.reset();
        setMsg(ok);
        load();
      } catch (x: any) {
        setMsg(x?.message || "Unable to save planning record.");
      }
    };
  const patch = async (url: string, body: any, ok: string) => {
    try {
      await apiClient.patch(url, body);
      setMsg(ok);
      load();
    } catch (e: any) {
      setMsg(e?.message || "Unable to progress planning control.");
    }
  };
  const approve = (id: string) => {
    const approval_note = prompt("Independent challenge and approval evidence");
    if (approval_note)
      patch(
        `/fpna-control/scenarios/${id}/approve`,
        { approval_note },
        "Scenario independently approved.",
      );
  };
  const reject = (id: string) => {
    const rejection_reason = prompt("Independent rejection reason");
    if (rejection_reason)
      patch(
        `/fpna-control/scenarios/${id}/reject`,
        { rejection_reason },
        "Scenario rejected.",
      );
  };
  const close = (id: string) => {
    const closure_evidence = prompt("Board/management closure evidence");
    if (closure_evidence)
      patch(
        `/fpna-control/cycles/${id}/close`,
        { closure_evidence },
        "Planning cycle closed.",
      );
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#2D3158] to-[#5967A8] p-6 text-white">
        <div className="flex justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-indigo-100">
              <LineChart size={18} />
              Posted actuals to board-ready cash scenarios
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Driver-Based FP&A & Rolling Scenarios
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-indigo-50">
              Models revenue, margin, DSO, DPO, inventory, capex, funding and
              free cash from immutable posted actuals. Planning only—no journal,
              budget or tax return is changed.
            </p>
          </div>
          <button onClick={load}>
            <RefreshCw className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </header>
      {msg && (
        <p className="rounded bg-blue-50 p-3 text-sm text-blue-800">{msg}</p>
      )}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <K l="Cycles" v={String(d.kpis.planning_cycles || 0)} />
        <K l="Scenarios" v={String(d.kpis.scenarios || 0)} />
        <K l="Pending challenge" v={String(d.kpis.pending_approval || 0)} />
        <K l="Approved revenue" v={money(d.kpis.approved_revenue)} />
        <K l="Approved EBITDA" v={money(d.kpis.approved_ebitda)} />
        <K l="Approved free cash" v={money(d.kpis.approved_free_cash)} />
        <K l="Funding need" v={money(d.kpis.approved_funding_need)} />
      </section>
      <div className="grid gap-5 lg:grid-cols-3">
        <form
          onSubmit={post("/fpna-control/cycles", "Actuals snapshot captured.")}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Capture actual baseline</h2>
          <input
            required
            name="cycle_code"
            placeholder="Cycle code"
            className={f}
          />
          <input
            required
            name="cycle_name"
            placeholder="Cycle name"
            className={f}
          />
          <label className="block text-xs text-slate-500">
            Completed actual period
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="actual_period_from"
              type="date"
              className={f}
            />
            <input required name="actual_period_to" type="date" className={f} />
          </div>
          <input
            required
            name="forecast_months"
            type="number"
            min="3"
            max="36"
            defaultValue="12"
            className={f}
          />
          <button className="rounded bg-[#2D3158] px-3 py-2 text-sm text-white">
            Capture posted actuals
          </button>
        </form>
        <form
          onSubmit={post(
            "/fpna-control/scenarios",
            "Driver scenario calculated.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4 lg:col-span-2"
        >
          <h2 className="font-semibold">Calculate driver scenario</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <select required name="cycle_id" className={f}>
              <option value="">Draft planning cycle</option>
              {d.cycles
                .filter((x: any) => x.status === "DRAFT")
                .map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {x.cycle_code} · {x.cycle_name}
                  </option>
                ))}
            </select>
            <input
              required
              name="scenario_name"
              placeholder="Scenario name"
              className={f}
            />
            <select name="scenario_type" className={f}>
              {["BASE", "UPSIDE", "DOWNSIDE", "STRESS", "BOARD"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input
              required
              name="revenue_growth_pct"
              type="number"
              min="-100"
              step="0.01"
              defaultValue="0"
              placeholder="Revenue growth %"
              className={f}
            />
            <input
              required
              name="gross_margin_pct"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="Gross margin %"
              className={f}
            />
            <input
              required
              name="opex_pct_of_revenue"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="Opex / revenue %"
              className={f}
            />
            <input
              required
              name="dso_days"
              type="number"
              min="0"
              step="0.1"
              placeholder="DSO days"
              className={f}
            />
            <input
              required
              name="dpo_days"
              type="number"
              min="0"
              step="0.1"
              placeholder="DPO days"
              className={f}
            />
            <input
              required
              name="inventory_days"
              type="number"
              min="0"
              step="0.1"
              placeholder="Inventory days"
              className={f}
            />
            <input
              name="capex"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
              placeholder="Capex AED"
              className={f}
            />
            <input
              required
              name="tax_rate_pct"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue="9"
              placeholder="Planning tax %"
              className={f}
            />
            <input
              required
              name="confidence_pct"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue="50"
              placeholder="Confidence %"
              className={f}
            />
          </div>
          <input
            required
            name="assumptions_evidence"
            placeholder="Market, contract, pipeline or management evidence"
            className={f}
          />
          <p className="text-xs text-amber-700">
            9% is only a UAE planning default, not statutory filing logic.
          </p>
          <button className="rounded bg-[#5967A8] px-3 py-2 text-sm text-white">
            Calculate scenario
          </button>
        </form>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">
          Planning cycles & immutable actual snapshots
        </h2>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {d.cycles.map((x: any) => (
            <div key={x.id} className="rounded-lg border p-3 text-sm">
              <div className="flex justify-between">
                <span>
                  <b>
                    {x.cycle_code} · {x.cycle_name}
                  </b>
                  <small className="block text-slate-500">
                    {x.actual_period_from} → {x.actual_period_to} ·{" "}
                    {x.forecast_months} months
                  </small>
                </span>
                <span>
                  <b>{x.status}</b>
                  {x.status === "APPROVED" && (
                    <button
                      onClick={() => close(x.id)}
                      className="ml-2 rounded border px-2 py-1 text-xs"
                    >
                      Close
                    </button>
                  )}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                <span>
                  Revenue
                  <br />
                  <b>{money(x.actual_snapshot?.annualized_revenue)}</b>
                </span>
                <span>
                  Cash
                  <br />
                  <b>{money(x.actual_snapshot?.cash_balance)}</b>
                </span>
                <span>
                  AR / AP
                  <br />
                  <b>
                    {money(x.actual_snapshot?.receivables)} /{" "}
                    {money(x.actual_snapshot?.payables)}
                  </b>
                </span>
                <span>
                  NWC
                  <br />
                  <b>{money(x.actual_snapshot?.baseline_nwc)}</b>
                </span>
              </div>
            </div>
          ))}
          {!d.cycles.length && (
            <p className="text-sm text-slate-500">No planning cycles yet.</p>
          )}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">
          Scenario comparison & independent challenge
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Scenario</th>
                <th className="p-2 text-right">Revenue</th>
                <th className="p-2 text-right">EBITDA</th>
                <th className="p-2 text-right">NWC / release</th>
                <th className="p-2 text-right">Funding</th>
                <th className="p-2 text-right">Free cash</th>
                <th className="p-2">Control</th>
              </tr>
            </thead>
            <tbody>
              {d.scenarios.map((x: any) => (
                <tr key={x.id} className="border-b align-top">
                  <td className="p-2">
                    <b>{x.scenario_name}</b>
                    <small className="block text-slate-500">
                      {x.cycle?.cycle_code} · {x.scenario_type} ·{" "}
                      {x.confidence_pct}%
                    </small>
                  </td>
                  <td className="p-2 text-right">
                    {money(x.projected_revenue)}
                  </td>
                  <td className="p-2 text-right">
                    {money(x.projected_ebitda)}
                  </td>
                  <td className="p-2 text-right">
                    {money(x.projected_nwc)}
                    <small className="block text-emerald-700">
                      Release {money(x.working_capital_release)}
                    </small>
                  </td>
                  <td className="p-2 text-right text-amber-700">
                    {money(x.projected_funding_need)}
                  </td>
                  <td className="p-2 text-right">
                    <b>{money(x.projected_free_cash)}</b>
                    <small className="block text-slate-500">
                      Weighted {money(x.confidence_adjusted_free_cash)}
                    </small>
                  </td>
                  <td className="p-2">
                    <b className="block text-xs">{x.status}</b>
                    {x.status === "DRAFT" && (
                      <span className="mt-1 flex gap-1">
                        <button
                          onClick={() => approve(x.id)}
                          className="rounded border px-2 py-1 text-xs text-emerald-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => reject(x.id)}
                          className="rounded border px-2 py-1 text-xs text-red-700"
                        >
                          Reject
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.scenarios.length && (
            <p className="p-6 text-center text-sm text-slate-500">
              No scenarios calculated yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
function K({ l, v }: { l: string; v: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs text-slate-500">{l}</p>
      <p className="mt-1 text-lg font-bold">{v}</p>
    </div>
  );
}
