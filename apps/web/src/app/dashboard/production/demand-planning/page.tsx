"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, Waypoints } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const f = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm",
  money = (v: any) =>
    new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
      maximumFractionDigits: 0,
    }).format(Number(v || 0)),
  num = (v: any) =>
    new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(
      Number(v || 0),
    );
export default function DemandPlanning() {
  const [d, setD] = useState<any>({
      cycle: null,
      active_cycle: null,
      cycle_history: [],
      lines: [],
      scenarios: [],
    }),
    [busy, setBusy] = useState(true),
    [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await apiClient.get("/demand-planning/dashboard"));
    } catch (e: any) {
      setMsg(e?.message || "Unable to load demand plan.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const run = async () => {
    setBusy(true);
    try {
      setD(await apiClient.post("/demand-planning/run", {}));
      setMsg("Statistical demand cycle created from posted invoice history.");
    } catch (e: any) {
      setMsg(e?.message || "Unable to run demand planning.");
    } finally {
      setBusy(false);
    }
  };
  const adjust = async (x: any) => {
    const current = (x.consensus_forecast || [])
        .map((v: any) => v.quantity)
        .join(", "),
      raw = prompt(
        "Six monthly consensus quantities, comma-separated",
        current,
      );
    if (!raw) return;
    const override_reason = prompt("Reason for forecast override");
    if (!override_reason) return;
    try {
      await apiClient.patch(`/demand-planning/lines/${x.id}/consensus`, {
        quantities: raw.split(",").map((v: string) => Number(v.trim())),
        override_reason,
      });
      load();
    } catch (e: any) {
      setMsg(e?.message || "Unable to adjust consensus.");
    }
  };
  const scenario = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await apiClient.post(
        "/demand-planning/scenarios",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      e.currentTarget.reset();
      load();
    } catch (x: any) {
      setMsg(x?.message || "Unable to save scenario.");
    }
  };
  const approve = async () => {
    const approval_evidence = prompt(
      "S&OP approval evidence / meeting reference",
    );
    if (!approval_evidence) return;
    try {
      await apiClient.patch(`/demand-planning/cycles/${d.cycle.id}/approve`, {
        approval_evidence,
      });
      load();
    } catch (e: any) {
      setMsg(e?.message || "Unable to approve cycle.");
    }
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#214A55] to-[#3E7785] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-cyan-100">
              <Waypoints size={18} />
              Demand-to-cash planning
            </div>
            <h1 className="mt-2 text-2xl font-bold">Demand Planning & S&OP</h1>
            <p className="mt-1 text-sm text-cyan-100">
              Six-month consensus forecast and working-capital scenarios. No job
              order, PR or stock reservation is created.
            </p>
          </div>
          <div className="space-x-2">
            <button onClick={load}>
              <RefreshCw className={busy ? "animate-spin" : ""} />
            </button>
            <button
              onClick={run}
              disabled={busy}
              className="rounded bg-white px-3 py-2 text-sm font-semibold text-[#214A55]"
            >
              Run forecast
            </button>
          </div>
        </div>
      </header>
      {msg && (
        <p className="rounded bg-blue-50 p-3 text-sm text-blue-800">{msg}</p>
      )}
      {d.active_cycle && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="font-semibold">
            Frozen MRP demand source: {d.active_cycle.cycle_name}
          </div>
          <div className="mt-1 text-xs">
            Approved{" "}
            {d.active_cycle.approved_at
              ? new Date(d.active_cycle.approved_at).toLocaleString()
              : "—"}
            {" · "}Snapshot{" "}
            {d.active_cycle.snapshot_hash
              ? d.active_cycle.snapshot_hash.slice(0, 12)
              : "legacy approved cycle"}
            {" · "}Sales orders are consumed against this forecast before
            residual demand enters MRP.
          </div>
        </section>
      )}
      {d.cycle ? (
        <>
          <section className="grid gap-3 md:grid-cols-5">
            <K l="Forecast units" v={num(d.cycle.forecast_units)} />
            <K l="Forecast revenue" v={money(d.cycle.forecast_revenue)} />
            <K l="Inventory gap" v={money(d.cycle.inventory_gap_value)} />
            <K
              l="Backtest accuracy"
              v={`${Number(d.cycle.average_accuracy_pct || 0).toFixed(1)}%`}
            />
            <K l="Cycle status" v={d.cycle.status} />
          </section>
          <div className="grid gap-5 lg:grid-cols-3">
            <form
              onSubmit={scenario}
              className="space-y-2 rounded-xl border bg-white p-4"
            >
              <h2 className="font-semibold">Working-capital scenario</h2>
              <input
                required
                name="scenario_name"
                placeholder="Scenario name"
                className={f}
              />
              <input
                name="demand_change_pct"
                type="number"
                min="-90"
                max="300"
                step="0.1"
                placeholder="Demand change %"
                className={f}
              />
              <input
                name="safety_stock_days"
                type="number"
                min="0"
                placeholder="Safety-stock days"
                className={f}
              />
              <button className="rounded bg-[#214A55] px-3 py-2 text-sm text-white">
                Calculate scenario
              </button>
              {d.cycle.status === "DRAFT" && (
                <button
                  type="button"
                  onClick={approve}
                  className="ml-2 rounded border px-3 py-2 text-sm"
                >
                  Approve cycle
                </button>
              )}
            </form>
            <section className="rounded-xl border bg-white p-4 lg:col-span-2">
              <h2 className="font-semibold">Scenario comparison</h2>
              {d.scenarios.map((x: any) => (
                <div
                  key={x.id}
                  className="grid grid-cols-4 border-b py-2 text-sm"
                >
                  <span>
                    <b>{x.scenario_name}</b>
                    <small className="block">
                      Demand {x.demand_change_pct}%
                    </small>
                  </span>
                  <span>
                    Units
                    <br />
                    <b>{num(x.projected_units)}</b>
                  </span>
                  <span>
                    Revenue
                    <br />
                    <b>{money(x.projected_revenue)}</b>
                  </span>
                  <span>
                    Cash exposure
                    <br />
                    <b>{money(x.working_capital_exposure)}</b>
                  </span>
                </div>
              ))}
              {!d.scenarios.length && (
                <p className="py-4 text-sm text-slate-500">
                  No scenarios saved for this cycle.
                </p>
              )}
            </section>
          </div>
          <section className="rounded-xl border bg-white p-4">
            <h2 className="font-semibold">Consensus forecast by item</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Item</th>
                    <th className="p-2">Pattern</th>
                    <th className="p-2 text-right">6m demand</th>
                    <th className="p-2 text-right">Available</th>
                    <th className="p-2 text-right">Gap value</th>
                    <th className="p-2 text-right">Accuracy</th>
                    <th className="p-2">Control</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((x: any) => (
                    <tr key={x.id} className="border-b">
                      <td className="p-2">
                        <b>{x.item_code || x.item_name}</b>
                        <small className="block text-slate-500">
                          {x.item_name}
                        </small>
                      </td>
                      <td className="p-2">{x.demand_pattern}</td>
                      <td className="p-2 text-right">
                        {num(
                          (x.consensus_forecast || []).reduce(
                            (s: number, v: any) => s + Number(v.quantity || 0),
                            0,
                          ),
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {num(x.available_quantity)}
                      </td>
                      <td className="p-2 text-right font-semibold text-amber-700">
                        {money(x.inventory_gap_value)}
                      </td>
                      <td className="p-2 text-right">
                        {x.forecast_accuracy_pct == null
                          ? "—"
                          : `${Number(x.forecast_accuracy_pct).toFixed(1)}%`}
                      </td>
                      <td className="p-2">
                        {d.cycle.status === "DRAFT" && (
                          <button
                            onClick={() => adjust(x)}
                            className="rounded border px-2 py-1 text-xs"
                          >
                            Adjust consensus
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        !busy && (
          <div className="rounded-xl border bg-white p-8 text-sm text-slate-500">
            No demand cycle exists. Run the forecast to analyse twelve months of
            posted sales history.
          </div>
        )
      )}
    </main>
  );
}
function K({ l, v }: { l: string; v: any }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="text-xs text-slate-500">{l}</div>
      <div className="mt-1 text-lg font-bold">{v}</div>
    </div>
  );
}
