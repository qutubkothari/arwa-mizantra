"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const f = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const money = (v: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));
export default function LeaseAccountingPage() {
  const [d, setD] = useState<any>({
      kpis: {},
      leases: [],
      schedule: [],
      events: [],
      accounts: [],
    }),
    [busy, setBusy] = useState(true),
    [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await apiClient.get("/lease-accounting/dashboard"));
      setMsg("");
    } catch (e: any) {
      setMsg(e?.message || "Unable to load lease accounting.");
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
        setMsg(x?.message || "Unable to save lease control.");
      }
    };
  const patch = async (url: string, b: any, ok: string) => {
    try {
      await apiClient.patch(url, b);
      setMsg(ok);
      load();
    } catch (e: any) {
      setMsg(e?.message || "Unable to progress lease control.");
    }
  };
  const approveLease = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (values.lease_id) {
      const id = String(values.lease_id);
      delete values.lease_id;
      await patch(
        `/lease-accounting/leases/${id}/approve`,
        values,
        "Lease independently approved and activated.",
      );
    }
  };
  const approveEvent = (id: string) => {
    const approval_note = prompt(
      "Independent lease-event assessment and approval rationale",
    );
    if (approval_note)
      patch(
        `/lease-accounting/events/${id}/approve`,
        { approval_note },
        "Lease event approved.",
      );
  };
  const terminate = (id: string) => {
    const termination_evidence = prompt("Derecognition/closure evidence");
    if (termination_evidence)
      patch(
        `/lease-accounting/leases/${id}/terminate`,
        { termination_evidence },
        "Lease terminated with evidence.",
      );
  };
  const accountOptions = (type?: string) =>
    d.accounts
      .filter((x: any) => !type || x.account_type === type)
      .map((x: any) => (
        <option key={x.id} value={x.id}>
          {x.account_code} · {x.account_name}
        </option>
      ));
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#3F334D] to-[#776080] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-purple-100">
              <Building2 size={18} />
              IFRS 16 liability, ROU and renewal control
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Lease Accounting & IFRS 16 Control
            </h1>
            <p className="mt-1 text-sm text-purple-50">
              Present-value schedules, mandatory GL mappings and governed
              modifications. Journal previews only—nothing is posted
              automatically.
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
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <K l="Active leases" v={String(d.kpis.active_leases || 0)} />
        <K l="Lease liability" v={money(d.kpis.lease_liability)} />
        <K l="ROU net book value" v={money(d.kpis.rou_net_book_value)} />
        <K l="90-day payments" v={money(d.kpis.payments_next_90_days)} />
        <K l="Renewal notices" v={String(d.kpis.renewals_due || 0)} />
        <K l="Pending events" v={String(d.kpis.pending_events || 0)} />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={post(
            "/lease-accounting/leases",
            "IFRS 16 schedule calculated in draft.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Register lease contract</h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="lease_code"
              placeholder="Lease code"
              className={f}
            />
            <select name="lease_type" className={f}>
              {["PROPERTY", "EQUIPMENT", "VEHICLE", "OTHER"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input
              required
              name="lessor_name"
              placeholder="Lessor"
              className={f}
            />
            <input
              required
              name="asset_description"
              placeholder="Underlying asset"
              className={f}
            />
            <input
              required
              name="commencement_date"
              type="date"
              className={f}
            />
            <input required name="end_date" type="date" className={f} />
            <select name="payment_frequency" className={f}>
              <option>MONTHLY</option>
              <option>QUARTERLY</option>
              <option>ANNUAL</option>
            </select>
            <input
              required
              name="periodic_payment"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Periodic payment AED"
              className={f}
            />
            <input
              required
              name="discount_rate_pct"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              placeholder="Discount rate %"
              className={f}
            />
            <input
              name="initial_direct_cost"
              type="number"
              min="0"
              step="0.01"
              placeholder="Initial direct cost"
              className={f}
            />
            <input
              name="lease_incentives"
              type="number"
              min="0"
              step="0.01"
              placeholder="Lease incentives"
              className={f}
            />
            <input name="renewal_notice_date" type="date" className={f} />
          </div>
          <input
            required
            name="contract_evidence"
            placeholder="Signed contract/evidence reference"
            className={f}
          />
          <button className="rounded bg-[#3F334D] px-3 py-2 text-sm text-white">
            Calculate draft schedule
          </button>
        </form>
        <form
          onSubmit={approveLease}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Independent approval & GL mapping</h2>
          <select required name="lease_id" className={f}>
            <option value="">Draft lease</option>
            {d.leases
              .filter((x: any) => x.status === "DRAFT")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.lease_code} · {x.asset_description}
                </option>
              ))}
          </select>
          <label className="text-xs">ROU asset account</label>
          <select required name="rou_asset_account_id" className={f}>
            <option value="">Select asset account</option>
            {accountOptions("ASSET")}
          </select>
          <label className="text-xs">Lease liability account</label>
          <select required name="lease_liability_account_id" className={f}>
            <option value="">Select liability account</option>
            {accountOptions("LIABILITY")}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select required name="interest_expense_account_id" className={f}>
              <option value="">Interest expense</option>
              {accountOptions("EXPENSE")}
            </select>
            <select
              required
              name="depreciation_expense_account_id"
              className={f}
            >
              <option value="">Depreciation expense</option>
              {accountOptions("EXPENSE")}
            </select>
          </div>
          <select
            required
            name="accumulated_depreciation_account_id"
            className={f}
          >
            <option value="">Accumulated depreciation</option>
            {accountOptions("ASSET")}
          </select>
          <input
            required
            name="approval_note"
            placeholder="Independent classification and valuation review"
            className={f}
          />
          <button className="rounded bg-[#776080] px-3 py-2 text-sm text-white">
            Approve & activate
          </button>
        </form>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget)),
              id = String(v.lease_id || "");
            delete v.lease_id;
            if (id) {
              await apiClient.post(`/lease-accounting/leases/${id}/events`, v);
              e.currentTarget.reset();
              setMsg("Lease event proposed.");
              load();
            }
          }}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Propose lease event</h2>
          <select required name="lease_id" className={f}>
            <option value="">Active lease</option>
            {d.leases
              .filter((x: any) => x.status === "ACTIVE")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.lease_code}
                </option>
              ))}
          </select>
          <select name="event_type" className={f}>
            {["MODIFICATION", "RENEWAL", "IMPAIRMENT", "TERMINATION"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
          <input required name="effective_date" type="date" className={f} />
          <input
            name="financial_impact"
            type="number"
            step="0.01"
            placeholder="Financial impact AED"
            className={f}
          />
          <input
            required
            name="event_description"
            placeholder="Assessment"
            className={f}
          />
          <input
            required
            name="event_evidence"
            placeholder="Evidence"
            className={f}
          />
          <button className="rounded border px-3 py-2 text-sm">
            Propose event
          </button>
        </form>
        <section className="rounded-xl border bg-white p-4 lg:col-span-2">
          <h2 className="font-semibold">Lease portfolio</h2>
          {d.leases.map((x: any) => (
            <div
              key={x.id}
              className="flex justify-between border-b py-3 text-sm"
            >
              <span>
                <b>
                  {x.lease_code} · {x.asset_description}
                </b>
                <small className="block text-slate-500">
                  {x.lessor_name} · {x.status} · next{" "}
                  {x.next_payment?.due_date || "—"}
                </small>
              </span>
              <span className="text-right">
                Liability <b>{money(x.current_liability)}</b>
                <small className="block">
                  ROU NBV {money(x.rou_net_book_value)}
                </small>
                {x.status === "ACTIVE" &&
                  d.events.some(
                    (e: any) =>
                      e.lease_id === x.id &&
                      e.event_type === "TERMINATION" &&
                      e.status === "APPROVED",
                  ) && (
                    <button
                      onClick={() => terminate(x.id)}
                      className="mt-1 rounded border px-2 py-1 text-xs"
                    >
                      Terminate
                    </button>
                  )}
              </span>
            </div>
          ))}
          {!d.leases.length && (
            <p className="py-4 text-sm text-slate-500">No leases registered.</p>
          )}
        </section>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Governed lease events</h2>
        {d.events.map((x: any) => (
          <div
            key={x.id}
            className="flex justify-between border-b py-2 text-sm"
          >
            <span>
              <b>
                {x.lease?.lease_code} · {x.event_type}
              </b>
              <small className="block text-slate-500">
                {x.effective_date} · {x.event_description}
              </small>
            </span>
            <span>
              <b>{x.status}</b>
              {x.status === "PROPOSED" && (
                <button
                  onClick={() => approveEvent(x.id)}
                  className="ml-2 rounded border px-2 py-1 text-xs"
                >
                  Approve
                </button>
              )}
            </span>
          </div>
        ))}
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">
          Upcoming amortization & journal preview
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Due</th>
                <th className="p-2">Lease</th>
                <th className="p-2 text-right">Opening</th>
                <th className="p-2 text-right">Interest</th>
                <th className="p-2 text-right">Payment</th>
                <th className="p-2 text-right">Principal</th>
                <th className="p-2 text-right">ROU depreciation</th>
              </tr>
            </thead>
            <tbody>
              {d.schedule.slice(0, 100).map((x: any) => (
                <tr key={x.id} className="border-b">
                  <td className="p-2">{x.due_date}</td>
                  <td className="p-2">
                    {d.leases.find((l: any) => l.id === x.lease_id)?.lease_code}
                  </td>
                  <td className="p-2 text-right">
                    {money(x.opening_liability)}
                  </td>
                  <td className="p-2 text-right">
                    {money(x.interest_expense)}
                  </td>
                  <td className="p-2 text-right">{money(x.lease_payment)}</td>
                  <td className="p-2 text-right">
                    {money(x.principal_reduction)}
                  </td>
                  <td className="p-2 text-right">
                    {money(x.rou_depreciation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
