"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const money = (value: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
export default function TreasuryControlPage() {
  const [data, setData] = useState<any>({
    kpis: {},
    banks: [],
    positions: [],
    exposures: [],
    actions: [],
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiClient.get("/treasury-control/dashboard"));
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Unable to load treasury control.");
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
  const patch = async (url: string, body: any, success: string) => {
    try {
      await apiClient.patch(url, body);
      setMessage(success);
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to progress treasury action.");
    }
  };
  const approve = (id: string) => {
    const approval_note = prompt("Independent treasury approval rationale");
    if (approval_note)
      patch(
        `/treasury-control/actions/${id}/approve`,
        { approval_note },
        "Treasury action approved.",
      );
  };
  const execute = (id: string) => {
    const execution_evidence = prompt(
      "Bank confirmation, deal ticket or execution evidence",
    );
    if (execution_evidence)
      patch(
        `/treasury-control/actions/${id}/execute`,
        { execution_evidence },
        "Treasury execution recorded.",
      );
  };
  const verify = (id: string) => {
    const realized_cash_release = prompt("Verified cash released AED", "0");
    const realized_annual_savings = prompt("Verified annual savings AED", "0");
    const verification_evidence = prompt("Independent finance evidence");
    if (
      realized_cash_release !== null &&
      realized_annual_savings !== null &&
      verification_evidence
    )
      patch(
        `/treasury-control/actions/${id}/verify`,
        {
          realized_cash_release,
          realized_annual_savings,
          verification_evidence,
        },
        "Treasury ROI independently verified.",
      );
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#16384C] to-[#3D7186] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-cyan-100">
              <Landmark size={18} />
              Liquidity and FX exposure to verified treasury ROI
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Treasury Liquidity, Funding & FX Control
            </h1>
            <p className="mt-1 text-sm text-cyan-100">
              Consolidates usable cash, operating buffers, funding gaps, yield
              spreads and unhedged currency exposure. No bank or hedge
              transaction is automatic.
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
        <K label="Usable liquidity" value={money(data.kpis.usable_liquidity)} />
        <K label="Surplus cash" value={money(data.kpis.surplus_cash)} />
        <K label="Funding gap" value={money(data.kpis.funding_gap)} />
        <K label="Unhedged FX" value={money(data.kpis.unhedged_fx_exposure)} />
        <K
          label="Interest opportunity"
          value={money(data.kpis.annual_interest_opportunity)}
        />
        <K label="Verified benefit" value={money(data.kpis.verified_benefit)} />
      </section>
      <div className="grid gap-5 lg:grid-cols-3">
        <form
          onSubmit={postForm(
            "/treasury-control/cash-positions",
            "Evidence-backed cash position saved.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Bank cash position</h2>
          <select required name="bank_account_id" className={field}>
            <option value="">Bank account</option>
            {data.banks.map((row: any) => (
              <option key={row.id} value={row.id}>
                {row.bank_name} ·{" "}
                {row.account_name || row.account_number_masked} ·{" "}
                {row.currency_code}
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
            name="available_balance"
            type="number"
            step="0.01"
            placeholder="Available balance"
            className={field}
          />
          <input
            name="restricted_cash"
            type="number"
            min="0"
            step="0.01"
            placeholder="Restricted cash"
            className={field}
          />
          <input
            name="minimum_operating_buffer"
            type="number"
            min="0"
            step="0.01"
            placeholder="Minimum operating buffer"
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              name="deposit_yield_pct"
              type="number"
              min="0"
              step="0.0001"
              placeholder="Deposit yield %"
              className={field}
            />
            <input
              name="borrowing_cost_pct"
              type="number"
              min="0"
              step="0.0001"
              placeholder="Borrowing cost %"
              className={field}
            />
          </div>
          <input
            required
            name="evidence_reference"
            placeholder="Bank statement evidence"
            className={field}
          />
          <button className="rounded bg-[#16384C] px-3 py-2 text-sm text-white">
            Save position
          </button>
        </form>
        <form
          onSubmit={postForm(
            "/treasury-control/fx-exposures",
            "FX exposure saved.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Foreign-currency exposure</h2>
          <input
            required
            name="exposure_reference"
            placeholder="Exposure reference"
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <select name="exposure_type" className={field}>
              <option>RECEIVABLE</option>
              <option>PAYABLE</option>
              <option>LOAN</option>
              <option>PURCHASE</option>
              <option>SALE</option>
            </select>
            <select name="direction" className={field}>
              <option>INFLOW</option>
              <option>OUTFLOW</option>
            </select>
            <input
              required
              name="currency_code"
              placeholder="Currency e.g. USD"
              className={field}
            />
            <input
              required
              name="foreign_amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Foreign amount"
              className={field}
            />
            <input
              required
              name="base_amount_aed"
              type="number"
              min="0"
              step="0.01"
              placeholder="AED equivalent"
              className={field}
            />
            <input
              name="hedged_amount_aed"
              type="number"
              min="0"
              step="0.01"
              placeholder="Hedged AED"
              className={field}
            />
          </div>
          <input required name="due_date" type="date" className={field} />
          <input
            required
            name="evidence_reference"
            placeholder="Contract/invoice evidence"
            className={field}
          />
          <button className="rounded bg-[#16384C] px-3 py-2 text-sm text-white">
            Save exposure
          </button>
        </form>
        <form
          onSubmit={postForm(
            "/treasury-control/actions",
            "Treasury optimization proposed.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Optimization proposal</h2>
          <select name="action_type" className={field}>
            <option>SWEEP</option>
            <option>REPAY</option>
            <option>INVEST</option>
            <option>HEDGE</option>
            <option>REFINANCE</option>
            <option>NEGOTIATE_FEES</option>
          </select>
          <textarea
            required
            name="action_description"
            placeholder="Measurable treasury action"
            className={field}
          />
          <input
            required
            name="owner_reference"
            placeholder="Accountable owner"
            className={field}
          />
          <input required name="due_date" type="date" className={field} />
          <input
            name="target_cash_release"
            type="number"
            min="0"
            step="0.01"
            placeholder="Target cash release AED"
            className={field}
          />
          <input
            name="target_annual_savings"
            type="number"
            min="0"
            step="0.01"
            placeholder="Target annual savings AED"
            className={field}
          />
          <button className="rounded bg-[#16384C] px-3 py-2 text-sm text-white">
            Propose action
          </button>
        </form>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Latest liquidity positions</h2>
          {data.positions.map((row: any) => (
            <div key={row.id} className="border-b py-3 text-sm">
              <b>
                {row.bank?.bank_name} · {row.bank?.currency_code}
              </b>
              <small className="block text-slate-500">
                Usable {money(row.usable_liquidity)} · buffer{" "}
                {money(row.minimum_operating_buffer)}
              </small>
              <small className="block text-slate-500">
                Surplus {money(row.surplus_cash)} · gap {money(row.funding_gap)}{" "}
                · annual opportunity {money(row.annual_interest_opportunity)}
              </small>
            </div>
          ))}
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Open FX exposures</h2>
          {data.exposures.map((row: any) => (
            <div key={row.id} className="border-b py-3 text-sm">
              <b>
                {row.exposure_reference} · {row.currency_code} {row.direction}
              </b>
              <small className="block text-slate-500">
                Due {row.due_date} · {row.maturity_bucket}
              </small>
              <small className="block text-red-700">
                Unhedged {money(row.unhedged_amount_aed)}
              </small>
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
                <b>{row.action_type}</b>
                <small className="block text-slate-500">
                  {row.status} · due {row.due_date}
                </small>
                <small className="block text-slate-500">
                  Target{" "}
                  {money(
                    Number(row.target_cash_release || 0) +
                      Number(row.target_annual_savings || 0),
                  )}
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
                    {money(
                      Number(row.realized_cash_release || 0) +
                        Number(row.realized_annual_savings || 0),
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
