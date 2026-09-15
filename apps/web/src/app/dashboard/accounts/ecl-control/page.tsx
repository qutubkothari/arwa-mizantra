"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
const f = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm",
  money = (v: any) =>
    new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
      maximumFractionDigits: 0,
    }).format(Number(v || 0));
export default function EclControl() {
  const [d, setD] = useState<any>({
      kpis: {},
      models: [],
      assessments: [],
      overrides: [],
      accounts: [],
    }),
    [busy, setBusy] = useState(true),
    [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await apiClient.get("/ecl-control/dashboard"));
      setMsg("");
    } catch (e: any) {
      setMsg(e?.message || "Unable to load IFRS 9 control.");
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
        setMsg(x?.message || "Unable to save ECL control.");
      }
    };
  const patch = async (url: string, b: any, ok: string) => {
    try {
      await apiClient.patch(url, b);
      setMsg(ok);
      load();
    } catch (e: any) {
      setMsg(e?.message || "Unable to progress ECL control.");
    }
  };
  const override = (a: any) => {
    const proposed_stage = prompt("Proposed IFRS 9 stage", String(a.stage)),
      proposed_pd_pct = prompt("Proposed PD %", String(a.pd_pct)),
      proposed_lgd_pct = prompt("Proposed LGD %", String(a.lgd_pct)),
      override_reason = prompt("Specific override reason"),
      override_evidence = prompt("Forward-looking/customer evidence");
    if (
      proposed_stage &&
      proposed_pd_pct &&
      proposed_lgd_pct &&
      override_reason &&
      override_evidence
    )
      apiClient
        .post(`/ecl-control/assessments/${a.id}/overrides`, {
          proposed_stage,
          proposed_pd_pct,
          proposed_lgd_pct,
          override_reason,
          override_evidence,
        })
        .then(() => {
          setMsg("ECL override proposed.");
          load();
        })
        .catch((e: any) => setMsg(e?.message || "Unable to propose override."));
  };
  const approveOverride = (id: string) => {
    const approval_note = prompt(
      "Independent override challenge and approval note",
    );
    if (approval_note)
      patch(
        `/ecl-control/overrides/${id}/approve`,
        { approval_note },
        "ECL override independently approved.",
      );
  };
  const approveModel = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v: any = Object.fromEntries(new FormData(e.currentTarget)),
      id = v.model_id;
    delete v.model_id;
    if (id)
      patch(
        `/ecl-control/models/${id}/approve`,
        v,
        "IFRS 9 model independently approved.",
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
      <header className="rounded-2xl bg-gradient-to-r from-[#4A2C35] to-[#8B4D55] p-6 text-white">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-rose-100">
              <ShieldAlert size={18} />
              Receivable exposure to evidence-backed impairment
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              IFRS 9 ECL & Credit Risk
            </h1>
            <p className="mt-1 text-sm text-rose-50">
              Stages live trade receivables using days past due, PD, LGD and
              forward factors. Impairment preview only—no write-off or GL
              posting.
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
        <K l="Models" v={String(d.kpis.models || 0)} />
        <K l="Receivable exposure" v={money(d.kpis.receivable_exposure)} />
        <K l="Expected credit loss" v={money(d.kpis.expected_credit_loss)} />
        <K l="Stage 2 exposure" v={money(d.kpis.stage_2_exposure)} />
        <K l="Stage 3 exposure" v={money(d.kpis.stage_3_exposure)} />
        <K l="Pending overrides" v={String(d.kpis.pending_overrides || 0)} />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={post(
            "/ecl-control/models",
            "ECL model calculated from live receivables.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Run ECL assessment</h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="model_code"
              placeholder="Model code"
              className={f}
            />
            <input
              required
              name="model_name"
              placeholder="Model name"
              className={f}
            />
            <input required name="as_of_date" type="date" className={f} />
            <input
              required
              name="forward_looking_factor"
              type="number"
              min="0"
              max="5"
              step="0.0001"
              defaultValue="1"
              placeholder="Forward factor"
              className={f}
            />
            <input
              required
              name="stage_1_pd_pct"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              placeholder="Stage 1 PD %"
              className={f}
            />
            <input
              required
              name="stage_2_pd_pct"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              placeholder="Stage 2 PD %"
              className={f}
            />
            <input
              required
              name="stage_3_pd_pct"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              placeholder="Stage 3 PD %"
              className={f}
            />
            <input
              required
              name="lgd_pct"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              placeholder="LGD %"
              className={f}
            />
          </div>
          <input
            required
            name="methodology_evidence"
            placeholder="Historical loss and forward-looking evidence"
            className={f}
          />
          <button className="rounded bg-[#4A2C35] px-3 py-2 text-sm text-white">
            Calculate draft ECL
          </button>
        </form>
        <form
          onSubmit={approveModel}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Independent model approval</h2>
          <select required name="model_id" className={f}>
            <option value="">Draft model</option>
            {d.models
              .filter((x: any) => x.status === "DRAFT")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.model_code} · {x.as_of_date}
                </option>
              ))}
          </select>
          <select required name="impairment_expense_account_id" className={f}>
            <option value="">Impairment expense account</option>
            {opts("EXPENSE")}
          </select>
          <select required name="loss_allowance_account_id" className={f}>
            <option value="">Loss allowance / contra-asset</option>
            {opts("ASSET")}
          </select>
          <input
            required
            name="approval_note"
            placeholder="Independent methodology, staging and overlay review"
            className={f}
          />
          <p className="text-xs text-amber-700">
            This is an IFRS 9 trade-receivable control, not a UAE bank
            regulatory capital model.
          </p>
          <button className="rounded bg-[#8B4D55] px-3 py-2 text-sm text-white">
            Approve model
          </button>
        </form>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">
          Latest receivable staging & impairment preview
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          Stage 1: ≤30 DPD · Stage 2: 31–90 DPD · Stage 3: &gt;90 DPD.
          Evidence-backed overrides require a different approver.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Customer / document</th>
                <th className="p-2 text-right">DPD</th>
                <th className="p-2 text-right">Stage</th>
                <th className="p-2 text-right">EAD</th>
                <th className="p-2 text-right">PD / LGD</th>
                <th className="p-2 text-right">ECL</th>
                <th className="p-2">Control</th>
              </tr>
            </thead>
            <tbody>
              {d.assessments.map((x: any) => (
                <tr key={x.id} className="border-b">
                  <td className="p-2">
                    <b>{x.party?.party_name || "Unassigned customer"}</b>
                    <small className="block text-slate-500">
                      {x.document_number} · due {x.due_date}
                    </small>
                  </td>
                  <td className="p-2 text-right">{x.days_past_due}</td>
                  <td className="p-2 text-right font-bold">{x.stage}</td>
                  <td className="p-2 text-right">
                    {money(x.exposure_at_default)}
                  </td>
                  <td className="p-2 text-right">
                    {x.pd_pct}% / {x.lgd_pct}%
                  </td>
                  <td className="p-2 text-right font-bold text-rose-700">
                    {money(x.expected_credit_loss)}
                  </td>
                  <td className="p-2">
                    {d.latest_model?.status === "DRAFT" && (
                      <button
                        onClick={() => override(x)}
                        className="rounded border px-2 py-1 text-xs"
                      >
                        Override
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.assessments.length && (
            <p className="p-6 text-center text-sm text-slate-500">
              No open receivable assessments in the latest model.
            </p>
          )}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Management override register</h2>
        {d.overrides.map((x: any) => (
          <div
            key={x.id}
            className="flex justify-between border-b py-2 text-sm"
          >
            <span>
              <b>
                Stage {x.proposed_stage} · PD {x.proposed_pd_pct}% · LGD{" "}
                {x.proposed_lgd_pct}%
              </b>
              <small className="block text-slate-500">
                {x.override_reason}
              </small>
            </span>
            <span>
              <b>{x.status}</b>
              {x.status === "PROPOSED" && (
                <button
                  onClick={() => approveOverride(x.id)}
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
