"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Scale, RefreshCw } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const f = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm",
  money = (v: any) =>
    new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
      maximumFractionDigits: 0,
    }).format(Number(v || 0));
export default function ProvisionControl() {
  const [d, setD] = useState<any>({
      kpis: {},
      cases: [],
      reviews: [],
      accounts: [],
    }),
    [busy, setBusy] = useState(true),
    [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await apiClient.get("/provision-control/dashboard"));
      setMsg("");
    } catch (e: any) {
      setMsg(e?.message || "Unable to load IAS 37 control.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const postDynamic =
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
        setMsg(x?.message || "Unable to save provision control.");
      }
    };
  const patch = async (url: string, b: any, ok: string) => {
    try {
      await apiClient.patch(url, b);
      setMsg(ok);
      load();
    } catch (e: any) {
      setMsg(e?.message || "Unable to progress provision control.");
    }
  };
  const approve = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v: any = Object.fromEntries(new FormData(e.currentTarget)),
      id = v.case_id;
    delete v.case_id;
    if (id)
      patch(
        `/provision-control/cases/${id}/approve`,
        v,
        "IAS 37 classification independently approved.",
      );
  };
  const approveReview = (id: string) => {
    const approval_note = prompt("Independent reassessment approval note");
    if (approval_note)
      patch(
        `/provision-control/reviews/${id}/approve`,
        { approval_note },
        "Provision reassessment approved.",
      );
  };
  const settle = (x: any) => {
    const actual_settlement_amount = prompt(
        "Actual settlement amount AED",
        String(x.recognized_amount || 0),
      ),
      settlement_evidence = prompt("Settlement and legal closure evidence");
    if (actual_settlement_amount !== null && settlement_evidence)
      patch(
        `/provision-control/cases/${x.id}/settle`,
        { actual_settlement_amount, settlement_evidence },
        "Provision case settled with variance trail.",
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
      <header className="rounded-2xl bg-gradient-to-r from-[#413A2A] to-[#807044] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-amber-100">
              <Scale size={18} />
              Uncertain obligations to governed recognition and disclosure
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              IAS 37 Provisions & Contingencies
            </h1>
            <p className="mt-1 text-sm text-amber-50">
              Probability-weighted discounted cash flows, reassessment and
              settlement variance. Accounting preview only—no journal or legal
              conclusion is created.
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
        <K l="Approved cases" v={String(d.kpis.approved_cases || 0)} />
        <K l="Recognized provisions" v={money(d.kpis.recognized_provisions)} />
        <K l="Contingent exposure" v={money(d.kpis.contingent_exposure)} />
        <K l="Overdue reviews" v={String(d.kpis.overdue_reviews || 0)} />
        <K l="Pending reviews" v={String(d.kpis.pending_reviews || 0)} />
        <K l="Settlement variance" v={money(d.kpis.settlement_variance)} />
      </section>
      <div className="grid gap-5 lg:grid-cols-3">
        <form
          onSubmit={postDynamic(
            () => "/provision-control/cases",
            "IAS 37 case created in draft.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Register uncertain obligation</h2>
          <input
            required
            name="case_code"
            placeholder="Case code"
            className={f}
          />
          <select name="case_type" className={f}>
            {[
              "LEGAL",
              "WARRANTY",
              "ONEROUS_CONTRACT",
              "DECOMMISSIONING",
              "RESTRUCTURING",
              "OTHER",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <input required name="title" placeholder="Case title" className={f} />
          <input
            required
            name="description"
            placeholder="Present obligation / uncertainty"
            className={f}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="obligating_event_date"
              type="date"
              className={f}
            />
            <input
              required
              name="expected_settlement_date"
              type="date"
              className={f}
            />
            <input
              required
              name="probability_pct"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="Occurrence probability %"
              className={f}
            />
            <input
              required
              name="discount_rate_pct"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              defaultValue="0"
              placeholder="Discount rate %"
              className={f}
            />
            <input
              required
              name="recognition_threshold_pct"
              type="number"
              min="0"
              max="100"
              defaultValue="50"
              placeholder="Recognition threshold %"
              className={f}
            />
            <input
              required
              name="disclosure_threshold_pct"
              type="number"
              min="0"
              max="100"
              defaultValue="5"
              placeholder="Disclosure threshold %"
              className={f}
            />
          </div>
          <input
            required
            name="owner_reference"
            placeholder="Accountable owner"
            className={f}
          />
          <input
            required
            name="source_evidence"
            placeholder="Legal/technical evidence"
            className={f}
          />
          <input required name="next_review_date" type="date" className={f} />
          <button className="rounded bg-[#413A2A] px-3 py-2 text-sm text-white">
            Create draft case
          </button>
        </form>
        <form
          onSubmit={postDynamic(
            (v) => `/provision-control/cases/${v.case_id}/cashflows`,
            "Cash-flow scenario added.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Probability-weighted cash flows</h2>
          <select required name="case_id" className={f}>
            <option value="">Draft case</option>
            {d.cases
              .filter((x: any) => x.status === "DRAFT")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.case_code} · current weight{" "}
                  {x.cashflows.reduce(
                    (n: number, c: any) => n + Number(c.probability_weight_pct),
                    0,
                  )}
                  %
                </option>
              ))}
          </select>
          <input
            required
            name="scenario_label"
            placeholder="Scenario label"
            className={f}
          />
          <input
            required
            name="cashflow_amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="Cash flow AED"
            className={f}
          />
          <input
            required
            name="probability_weight_pct"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            placeholder="Scenario weight %"
            className={f}
          />
          <input
            required
            name="expected_payment_date"
            type="date"
            className={f}
          />
          <input
            required
            name="estimate_evidence"
            placeholder="Estimate evidence"
            className={f}
          />
          <p className="text-xs text-amber-700">
            Scenario weights must total exactly 100% before approval.
          </p>
          <button className="rounded bg-[#807044] px-3 py-2 text-sm text-white">
            Add cash flow
          </button>
        </form>
        <form
          onSubmit={approve}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Independent recognition decision</h2>
          <select required name="case_id" className={f}>
            <option value="">Draft case</option>
            {d.cases
              .filter((x: any) => x.status === "DRAFT")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.case_code}
                </option>
              ))}
          </select>
          <select name="provision_expense_account_id" className={f}>
            <option value="">Provision expense account</option>
            {opts("EXPENSE")}
          </select>
          <select name="provision_liability_account_id" className={f}>
            <option value="">Provision liability account</option>
            {opts("LIABILITY")}
          </select>
          <input
            required
            name="approval_note"
            placeholder="Independent recognition/disclosure rationale"
            className={f}
          />
          <button className="rounded border px-3 py-2 text-sm">
            Approve classification
          </button>
        </form>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <form
          onSubmit={postDynamic(
            (v) => `/provision-control/cases/${v.case_id}/reviews`,
            "Provision reassessment proposed.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Periodic reassessment</h2>
          <select required name="case_id" className={f}>
            <option value="">Approved case</option>
            {d.cases
              .filter((x: any) => x.status === "APPROVED")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.case_code}
                </option>
              ))}
          </select>
          <input required name="review_date" type="date" className={f} />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="revised_probability_pct"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="Revised probability %"
              className={f}
            />
            <input
              required
              name="revised_discount_rate_pct"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              placeholder="Revised discount %"
              className={f}
            />
            <input
              required
              name="revised_settlement_date"
              type="date"
              className={f}
            />
            <input required name="next_review_date" type="date" className={f} />
          </div>
          <input
            required
            name="review_conclusion"
            placeholder="Reassessment conclusion"
            className={f}
          />
          <input
            required
            name="review_evidence"
            placeholder="Updated evidence"
            className={f}
          />
          <button className="rounded border px-3 py-2 text-sm">
            Propose reassessment
          </button>
        </form>
        <section className="rounded-xl border bg-white p-4 lg:col-span-2">
          <h2 className="font-semibold">Provision & contingency register</h2>
          {d.cases.map((x: any) => (
            <div key={x.id} className="grid grid-cols-5 border-b py-3 text-sm">
              <span className="col-span-2">
                <b>
                  {x.case_code} · {x.title}
                </b>
                <small className="block text-slate-500">
                  {x.case_type} · {x.status} · review {x.next_review_date}
                </small>
              </span>
              <span className="text-right">
                Probability
                <br />
                <b>{x.probability_pct}%</b>
              </span>
              <span className="text-right">
                Classification
                <br />
                <b>{x.classification || "PENDING"}</b>
              </span>
              <span className="text-right">
                PV / recognized
                <br />
                <b>
                  {money(x.present_value_exposure)} /{" "}
                  {money(x.recognized_amount)}
                </b>
                {x.status === "APPROVED" && (
                  <button
                    onClick={() => settle(x)}
                    className="ml-2 rounded border px-2 py-1 text-xs"
                  >
                    Settle
                  </button>
                )}
                {x.status === "SETTLED" && (
                  <small className="block">
                    Variance {money(x.settlement_variance)}
                  </small>
                )}
              </span>
            </div>
          ))}
        </section>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Reassessment approvals</h2>
        {d.reviews.map((x: any) => (
          <div
            key={x.id}
            className="flex justify-between border-b py-2 text-sm"
          >
            <span>
              <b>
                {x.case?.case_code} · probability {x.revised_probability_pct}%
              </b>
              <small className="block text-slate-500">
                {x.review_date} · {x.review_conclusion}
              </small>
            </span>
            <span>
              <b>{x.status}</b>
              {x.status === "PROPOSED" && (
                <button
                  onClick={() => approveReview(x.id)}
                  className="ml-2 rounded border px-2 py-1 text-xs"
                >
                  Approve
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
