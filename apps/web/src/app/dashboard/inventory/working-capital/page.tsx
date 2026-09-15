"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleDollarSign, RefreshCw } from "lucide-react";
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

export default function InventoryWorkingCapitalPage() {
  const [data, setData] = useState<any>({
    kpis: {},
    opportunities: [],
    cases: [],
    policies: [],
    items: [],
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiClient.get("/inventory-working-capital/dashboard"));
      setMessage("");
    } catch (error: any) {
      setMessage(
        error?.message || "Unable to load inventory working-capital control.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiClient.post(
        "/inventory-working-capital/policies",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      event.currentTarget.reset();
      setMessage("Inventory policy saved.");
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save policy.");
    }
  };
  const propose = async (row: any) => {
    const action = prompt(
      "Disposition action: RETURN, TRANSFER, DISCOUNT, BUNDLE, CONSUME, RECYCLE or WRITE_OFF",
      row.classification === "OBSOLETE" ? "RECYCLE" : "TRANSFER",
    );
    const rationale = prompt("Business rationale and evidence reference");
    if (!action || !rationale) return;
    try {
      await apiClient.post("/inventory-working-capital/cases", {
        item_id: row.item_id,
        classification: row.classification,
        disposition_action: action,
        quantity: row.opportunity_quantity,
        unit_cost: row.unit_cost,
        target_cash_release: row.cash_release,
        target_annual_carrying_cost_avoidance:
          row.annual_carrying_cost_avoidance,
        rationale,
      });
      setMessage("Disposition case proposed.");
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to propose case.");
    }
  };
  const patch = async (url: string, body: any, success: string) => {
    try {
      await apiClient.patch(url, body);
      setMessage(success);
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to progress disposition case.");
    }
  };
  const approve = (id: string) => {
    const approval_note = prompt("Independent approval rationale");
    if (approval_note)
      patch(
        `/inventory-working-capital/cases/${id}/approve`,
        { approval_note },
        "Disposition case approved.",
      );
  };
  const execute = (id: string) => {
    const execution_evidence = prompt(
      "Execution evidence: transfer, supplier return, sale or controlled write-off reference",
    );
    if (execution_evidence)
      patch(
        `/inventory-working-capital/cases/${id}/execute`,
        { execution_evidence },
        "Execution evidence recorded.",
      );
  };
  const verify = (id: string) => {
    const realized_cash_release = prompt("Verified cash released (AED)", "0");
    const realized_carrying_cost_avoidance = prompt(
      "Verified annual carrying-cost avoidance (AED)",
      "0",
    );
    const verification_evidence = prompt(
      "Independent finance verification evidence",
    );
    if (
      realized_cash_release !== null &&
      realized_carrying_cost_avoidance !== null &&
      verification_evidence
    )
      patch(
        `/inventory-working-capital/cases/${id}/verify`,
        {
          realized_cash_release,
          realized_carrying_cost_avoidance,
          verification_evidence,
        },
        "Inventory ROI independently verified.",
      );
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#173F35] to-[#376956] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-emerald-100">
              <CircleDollarSign size={18} />
              Stock exposure to verified AED cash release
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Inventory Working-Capital & SLOB Control
            </h1>
            <p className="mt-1 text-sm text-emerald-100">
              Finds excess, slow and obsolete inventory using consumption, age
              and cost evidence. No stock movement or GL write-off is automatic.
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
          label="Value at risk"
          value={money(data.kpis.inventory_value_at_risk)}
        />
        <K
          label="Carrying-cost opportunity"
          value={money(data.kpis.annual_carrying_cost_opportunity)}
        />
        <K label="Affected items" value={number(data.kpis.affected_items)} />
        <K label="Obsolete items" value={number(data.kpis.obsolete_items)} />
        <K
          label="Approved pipeline"
          value={money(data.kpis.approved_pipeline)}
        />
        <K
          label="Verified cash release"
          value={money(data.kpis.verified_cash_release)}
        />
      </section>
      <form onSubmit={savePolicy} className="rounded-xl border bg-white p-4">
        <h2 className="mb-1 font-semibold">Item working-capital policy</h2>
        <p className="mb-3 text-xs text-slate-500">
          Set service-stock, ageing and carrying-cost assumptions. Cost override
          is optional and remains auditable.
        </p>
        <div className="grid gap-2 md:grid-cols-4">
          <select required name="item_id" className={field}>
            <option value="">Item</option>
            {data.items.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.code} · {row.name}
              </option>
            ))}
          </select>
          <input
            required
            name="target_days_supply"
            type="number"
            min="0"
            step="0.01"
            defaultValue="45"
            placeholder="Target days supply"
            className={field}
          />
          <input
            name="safety_stock_quantity"
            type="number"
            min="0"
            step="0.0001"
            defaultValue="0"
            placeholder="Safety stock"
            className={field}
          />
          <input
            required
            name="annual_carrying_cost_pct"
            type="number"
            min="0"
            step="0.001"
            defaultValue="20"
            placeholder="Annual carrying cost %"
            className={field}
          />
          <input
            required
            name="slow_moving_days"
            type="number"
            min="1"
            defaultValue="90"
            placeholder="Slow after days"
            className={field}
          />
          <input
            required
            name="obsolete_days"
            type="number"
            min="2"
            defaultValue="365"
            placeholder="Obsolete after days"
            className={field}
          />
          <input
            name="unit_cost_override"
            type="number"
            min="0"
            step="0.0001"
            placeholder="Optional unit-cost override AED"
            className={field}
          />
          <button className="rounded bg-[#173F35] px-3 py-2 text-sm text-white">
            Save policy
          </button>
        </div>
      </form>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Ranked cash-release opportunities</h2>
          <p className="mb-2 text-xs text-slate-500">
            365-day consumption, current availability, last movement, policy
            stock and FIFO cost evidence.
          </p>
          {data.opportunities.slice(0, 20).map((row: any) => (
            <div
              key={row.item_id}
              className="flex justify-between gap-3 border-b py-3 text-sm"
            >
              <span>
                <b>
                  {row.item?.code} · {row.item?.name}
                </b>
                <small className="block text-slate-500">
                  {row.classification} · {number(row.age_days)} days ·{" "}
                  {number(row.opportunity_quantity)} {row.item?.uom || "units"}{" "}
                  actionable
                </small>
                <small className="block text-slate-500">
                  On hand {number(row.available_quantity)} · target{" "}
                  {number(row.target_quantity)} · annual use{" "}
                  {number(row.annual_consumption)}
                </small>
              </span>
              <span className="text-right">
                <b className="text-emerald-700">{money(row.cash_release)}</b>
                <small className="block text-slate-500">
                  + {money(row.annual_carrying_cost_avoidance)}/yr
                </small>
                <button
                  onClick={() => propose(row)}
                  className="mt-1 rounded border px-2 py-1"
                >
                  Propose
                </button>
              </span>
            </div>
          ))}
          {!data.opportunities.length && (
            <p className="py-5 text-sm text-slate-500">
              No SLOB opportunity is currently supported by stock and cost
              evidence.
            </p>
          )}
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">
            Controlled disposition & verified ROI
          </h2>
          <p className="mb-2 text-xs text-slate-500">
            Maker–checker approval, execution evidence and independent finance
            verification.
          </p>
          {data.cases.map((row: any) => (
            <div
              key={row.id}
              className="flex justify-between gap-3 border-b py-3 text-sm"
            >
              <span>
                <b>
                  {row.item?.code} · {row.disposition_action}
                </b>
                <small className="block text-slate-500">
                  {row.status} · {row.classification} · {number(row.quantity)}{" "}
                  units
                </small>
                <small className="block text-slate-500">
                  Target {money(row.target_cash_release)} +{" "}
                  {money(row.target_annual_carrying_cost_avoidance)}/yr
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
                    {money(row.realized_cash_release)}
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
