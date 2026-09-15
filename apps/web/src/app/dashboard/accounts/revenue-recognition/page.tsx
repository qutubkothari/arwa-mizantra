"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { BadgeDollarSign, RefreshCw } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const f = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm",
  money = (v: any) =>
    new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
      maximumFractionDigits: 0,
    }).format(Number(v || 0));
export default function RevenueRecognition() {
  const [d, setD] = useState<any>({
      kpis: {},
      contracts: [],
      obligations: [],
      claims: [],
      accounts: [],
    }),
    [busy, setBusy] = useState(true),
    [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await apiClient.get("/revenue-recognition/dashboard"));
      setMsg("");
    } catch (e: any) {
      setMsg(e?.message || "Unable to load revenue recognition.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const patch = async (url: string, b: any, ok: string) => {
    try {
      await apiClient.patch(url, b);
      setMsg(ok);
      load();
    } catch (e: any) {
      setMsg(e?.message || "Unable to progress recognition control.");
    }
  };
  const dynamicPost =
    (path: (v: any) => string, ok: string) =>
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const v: any = Object.fromEntries(new FormData(e.currentTarget));
      try {
        await apiClient.post(path(v), v);
        e.currentTarget.reset();
        setMsg(ok);
        load();
      } catch (x: any) {
        setMsg(x?.message || "Unable to save recognition record.");
      }
    };
  const approve = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v: any = Object.fromEntries(new FormData(e.currentTarget)),
      id = v.contract_id;
    delete v.contract_id;
    if (id)
      await patch(
        `/revenue-recognition/contracts/${id}/approve`,
        v,
        "IFRS 15 contract independently approved.",
      );
  };
  const verify = (id: string) => {
    const verification_note = prompt(
        "Finance verification methodology and conclusion",
      ),
      finance_evidence = prompt("Ledger, acceptance and performance evidence");
    if (verification_note && finance_evidence)
      patch(
        `/revenue-recognition/claims/${id}/verify`,
        { verification_note, finance_evidence },
        "Revenue recognition independently verified.",
      );
  };
  const opts = (type: string) =>
    d.accounts
      .filter((x: any) => x.account_type === type)
      .map((x: any) => (
        <option key={x.id} value={x.id}>
          {x.account_code} · {x.account_name}
        </option>
      ));
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#21483F] to-[#4E7C66] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-emerald-100">
              <BadgeDollarSign size={18} />
              IFRS 15 obligations to finance-verified revenue
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Contract Revenue Recognition
            </h1>
            <p className="mt-1 text-sm text-emerald-50">
              Tax-exclusive transaction-price allocation, performance evidence
              and contract asset/liability control. No GL or VAT return is
              changed automatically.
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
        <K l="Active contracts" v={String(d.kpis.active_contracts || 0)} />
        <K l="Transaction price" v={money(d.kpis.transaction_price)} />
        <K l="Verified revenue" v={money(d.kpis.verified_revenue)} />
        <K l="Backlog" v={money(d.kpis.remaining_backlog)} />
        <K l="Contract assets" v={money(d.kpis.contract_assets)} />
        <K l="Contract liabilities" v={money(d.kpis.contract_liabilities)} />
        <K
          l="Pending verification"
          v={String(d.kpis.pending_verification || 0)}
        />
      </section>
      <div className="grid gap-5 lg:grid-cols-3">
        <form
          onSubmit={dynamicPost(
            () => "/revenue-recognition/contracts",
            "Revenue contract created in draft.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Register customer contract</h2>
          <input
            required
            name="contract_code"
            placeholder="Contract code"
            className={f}
          />
          <input
            required
            name="customer_name"
            placeholder="Customer"
            className={f}
          />
          <input name="customer_trn" placeholder="Customer TRN" className={f} />
          <div className="grid grid-cols-3 gap-2">
            <input required name="contract_date" type="date" className={f} />
            <input required name="start_date" type="date" className={f} />
            <input required name="end_date" type="date" className={f} />
          </div>
          <input
            required
            name="transaction_price_ex_tax"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Transaction price excl. tax"
            className={f}
          />
          <input
            name="billed_amount_ex_tax"
            type="number"
            min="0"
            step="0.01"
            placeholder="Billed excl. tax"
            className={f}
          />
          <input
            required
            name="contract_evidence"
            placeholder="Signed contract evidence"
            className={f}
          />
          <button className="rounded bg-[#21483F] px-3 py-2 text-sm text-white">
            Create draft
          </button>
        </form>
        <form
          onSubmit={dynamicPost(
            (v) =>
              `/revenue-recognition/contracts/${v.contract_id}/obligations`,
            "Performance obligation added.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Distinct performance obligation</h2>
          <select required name="contract_id" className={f}>
            <option value="">Draft contract</option>
            {d.contracts
              .filter((x: any) => x.status === "DRAFT")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.contract_code}
                </option>
              ))}
          </select>
          <input
            required
            name="obligation_code"
            placeholder="Obligation code"
            className={f}
          />
          <input
            required
            name="description"
            placeholder="Promised good/service"
            className={f}
          />
          <select name="satisfaction_pattern" className={f}>
            <option>OVER_TIME</option>
            <option>POINT_IN_TIME</option>
          </select>
          <input
            required
            name="standalone_selling_price"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Standalone selling price"
            className={f}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="recognition_start_date"
              type="date"
              className={f}
            />
            <input
              required
              name="recognition_end_date"
              type="date"
              className={f}
            />
          </div>
          <input
            required
            name="acceptance_criteria"
            placeholder="Satisfaction / acceptance criteria"
            className={f}
          />
          <button className="rounded bg-[#4E7C66] px-3 py-2 text-sm text-white">
            Add obligation
          </button>
        </form>
        <form
          onSubmit={approve}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Approve allocation & GL mapping</h2>
          <select required name="contract_id" className={f}>
            <option value="">Draft contract</option>
            {d.contracts
              .filter(
                (x: any) => x.status === "DRAFT" && x.obligation_count > 0,
              )
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.contract_code} · {x.obligation_count} obligations
                </option>
              ))}
          </select>
          <select required name="receivable_account_id" className={f}>
            <option value="">Receivable asset account</option>
            {opts("ASSET")}
          </select>
          <select required name="contract_asset_account_id" className={f}>
            <option value="">Contract asset account</option>
            {opts("ASSET")}
          </select>
          <select required name="contract_liability_account_id" className={f}>
            <option value="">Contract liability account</option>
            {opts("LIABILITY")}
          </select>
          <select required name="revenue_account_id" className={f}>
            <option value="">Revenue account</option>
            {opts("REVENUE")}
          </select>
          <input
            required
            name="approval_note"
            placeholder="Independent IFRS 15 assessment"
            className={f}
          />
          <button className="rounded border px-3 py-2 text-sm">
            Approve & allocate
          </button>
        </form>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <form
          onSubmit={dynamicPost(
            (v) => `/revenue-recognition/obligations/${v.obligation_id}/claims`,
            "Recognition claim proposed.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Propose revenue recognition</h2>
          <select required name="obligation_id" className={f}>
            <option value="">Active obligation</option>
            {d.obligations
              .filter((o: any) => o.contract?.status === "ACTIVE")
              .map((o: any) => (
                <option key={o.id} value={o.id}>
                  {o.contract?.contract_code} · {o.obligation_code}
                </option>
              ))}
          </select>
          <input required name="recognition_date" type="date" className={f} />
          <input
            required
            name="cumulative_progress_pct"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            placeholder="Cumulative progress %"
            className={f}
          />
          <input
            required
            name="performance_evidence"
            placeholder="Milestone/progress evidence"
            className={f}
          />
          <input
            name="customer_acceptance_reference"
            placeholder="Customer acceptance (mandatory at point in time)"
            className={f}
          />
          <button className="rounded bg-[#21483F] px-3 py-2 text-sm text-white">
            Propose recognition
          </button>
        </form>
        <section className="rounded-xl border bg-white p-4 lg:col-span-2">
          <h2 className="font-semibold">Contract portfolio</h2>
          {d.contracts.map((x: any) => (
            <div key={x.id} className="grid grid-cols-5 border-b py-3 text-sm">
              <span className="col-span-2">
                <b>
                  {x.contract_code} · {x.customer_name}
                </b>
                <small className="block text-slate-500">
                  {x.status} · {x.obligation_count} obligations
                </small>
              </span>
              <span className="text-right">
                Price
                <br />
                <b>{money(x.transaction_price_ex_tax)}</b>
              </span>
              <span className="text-right">
                Recognized
                <br />
                <b className="text-emerald-700">
                  {money(x.recognized_revenue)}
                </b>
              </span>
              <span className="text-right">
                Backlog
                <br />
                <b>{money(x.remaining_backlog)}</b>
                <small className="block">
                  Asset {money(x.contract_asset)} · liability{" "}
                  {money(x.contract_liability)}
                </small>
              </span>
            </div>
          ))}
          {!d.contracts.length && (
            <p className="py-4 text-sm text-slate-500">
              No revenue contracts yet.
            </p>
          )}
        </section>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Performance obligations & allocation</h2>
        {d.obligations.map((x: any) => (
          <div key={x.id} className="grid grid-cols-4 border-b py-2 text-sm">
            <span>
              <b>
                {x.contract?.contract_code} · {x.obligation_code}
              </b>
              <small className="block">
                {x.satisfaction_pattern.replaceAll("_", " ")}
              </small>
            </span>
            <span>{x.description}</span>
            <span className="text-right">
              SSP {money(x.standalone_selling_price)}
            </span>
            <span className="text-right">
              Allocated{" "}
              <b>
                {x.allocated_transaction_price == null
                  ? "Pending"
                  : money(x.allocated_transaction_price)}
              </b>
            </span>
          </div>
        ))}
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">
          Recognition claims & finance verification
        </h2>
        {d.claims.map((x: any) => (
          <div key={x.id} className="grid grid-cols-5 border-b py-2 text-sm">
            <span>
              <b>
                {x.contract?.contract_code} · {x.obligation?.obligation_code}
              </b>
            </span>
            <span>{x.recognition_date}</span>
            <span className="text-right">
              Progress {x.prior_verified_progress_pct}% →{" "}
              {x.cumulative_progress_pct}%
            </span>
            <span className="text-right">
              <b>{money(x.claimed_revenue)}</b>
            </span>
            <span className="text-right">
              <b>{x.status}</b>
              {x.status === "PROPOSED" && (
                <button
                  onClick={() => verify(x.id)}
                  className="ml-2 rounded border px-2 py-1 text-xs"
                >
                  Verify
                </button>
              )}
            </span>
          </div>
        ))}
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
