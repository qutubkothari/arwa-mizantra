"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { FileText, Link2, RefreshCw, ShieldCheck, Target } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const money = (value: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export default function ValueRealizationPage() {
  const [data, setData] = useState<any>({
    kpis: {},
    initiatives: [],
    claims: [],
    source_benefits: [],
    overlaps: [],
    commercial_profiles: [],
    statements: [],
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [moat, setMoat] = useState<any>({ assurance: [], alerts: [], proofs: [], country_value_library: [] });
  const [renewal, setRenewal] = useState<any>({ configured: false });

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [dashboard, moatDashboard, renewalDashboard] = await Promise.all([apiClient.get("/value-realization/dashboard"), apiClient.get("/value-realization/moat-dashboard"), apiClient.get("/value-realization/renewal-cockpit")]);
      setData(dashboard);
      setMoat(moatDashboard);
      setRenewal(renewalDashboard);
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Unable to load value realization data.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const post =
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
        setMessage(error?.message || "Unable to save value record.");
      }
    };
  const patch = async (url: string, body: any, success: string) => {
    try {
      await apiClient.patch(url, body);
      setMessage(success);
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to progress value control.");
    }
  };
  const approve = (id: string) => {
    const approval_note = prompt(
      "Independent business-case approval rationale",
    );
    if (approval_note)
      patch(
        `/value-realization/initiatives/${id}/approve`,
        { approval_note },
        "Value initiative independently approved.",
      );
  };
  const close = (id: string) => {
    const closure_evidence = prompt("Closure evidence and outcome reference");
    if (closure_evidence)
      patch(
        `/value-realization/initiatives/${id}/close`,
        { closure_evidence },
        "Value initiative independently closed.",
      );
  };
  const verify = (claim: any) => {
    const verified_amount = prompt(
      "Finance-verified benefit amount (AED)",
      String(claim.claimed_amount),
    );
    const finance_evidence = prompt(
      "Ledger, bank, or approved management-report evidence",
    );
    const verifier_note = prompt(
      "Finance verification methodology and conclusion",
    );
    if (verified_amount && finance_evidence && verifier_note)
      patch(
        `/value-realization/claims/${claim.id}/verify`,
        { verified_amount, finance_evidence, verifier_note },
        "Benefit independently verified by finance.",
      );
  };
  const reject = (id: string) => {
    const rejection_reason = prompt("Independent rejection reason");
    if (rejection_reason)
      patch(
        `/value-realization/claims/${id}/reject`,
        { rejection_reason },
        "Benefit claim rejected with evidence trail.",
      );
  };
  const syncSources = async () => {
    try {
      const result: any = await apiClient.post("/value-realization/sync-sources", {});
      setMessage(`Connected ROI sync complete: ${result.inserted} new, ${result.unchanged} unchanged, ${result.drifted} drift alert(s).`);
      load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to connect operational benefits.");
    }
  };
  const verifySource = (benefit: any) => {
    const finance_verified_amount = prompt("Finance-verified attributable amount (AED)", String(benefit.gross_amount));
    const finance_evidence = prompt("Ledger, bank, or approved finance-report evidence");
    const finance_note = prompt("Finance attribution method and conclusion");
    if (finance_verified_amount && finance_evidence && finance_note)
      patch(`/value-realization/source-benefits/${benefit.id}/verify`, { finance_verified_amount, finance_evidence, finance_note }, "Connected benefit verified by finance.");
  };
  const rejectSource = (id: string) => {
    const rejection_reason = prompt("Finance rejection reason");
    if (rejection_reason) patch(`/value-realization/source-benefits/${id}/reject`, { rejection_reason }, "Connected benefit rejected.");
  };
  const approveProfile = (id: string) => patch(`/value-realization/commercial-profiles/${id}/approve`, {}, "Commercial profile independently approved.");
  const approveOverlap = (id: string) => patch(`/value-realization/overlaps/${id}/approve`, {}, "Duplicate-benefit overlap independently approved.");
  const issueStatement = (id: string) => patch(`/value-realization/statements/${id}/issue`, {}, "Client ROI statement independently issued.");
  const approveClientStatement = (id:string) => { const client_note=prompt("Client acknowledgement note or acceptance reference"); if(client_note) patch(`/value-realization/statements/${id}/client-approve`,{client_note},"Client ROI statement acknowledged."); };
  const autoMatchProofs = async () => { try { const r:any=await apiClient.post("/value-realization/proofs/auto-match", {}); setMessage(`Financial-proof match complete: ${r.linked} matched link(s) from ${r.candidates} candidate(s).`); load(); } catch(error:any){setMessage(error?.message||"Unable to auto-match financial proof.");} };
  const clientPack = async (id:string) => { try { const pack:any=await apiClient.get(`/value-realization/statements/${id}/client-pack`); const blob=new Blob([JSON.stringify(pack,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`SAK-ROI-${pack.statement.period_to}.json`; a.click(); URL.revokeObjectURL(url); setMessage("Client ROI evidence pack downloaded."); } catch(error:any){setMessage(error?.message||"Unable to generate client ROI pack.");} };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#173B4D] to-[#266B67] p-6 text-white">
        <div className="flex justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-cyan-100">
              <Target size={18} /> Operational change to finance-verified ROI
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Enterprise Value Realization
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-cyan-50">
              One governed benefit ledger with baselines, duplicate-claim
              prevention, maker-checker approval and finance evidence. No
              journal or operational record is changed automatically.
            </p>
          </div>
          <span className="flex gap-3">
            <button onClick={syncSources} className="rounded border border-cyan-100 px-3 py-2 text-xs"><Link2 size={15} className="mr-1 inline" />Connect modules</button>
            <button onClick={load} aria-label="Refresh value realization"><RefreshCw className={busy ? "animate-spin" : ""} /></button>
          </span>
        </div>
      </header>

      {message && (
        <p className="rounded bg-blue-50 p-3 text-sm text-blue-800">
          {message}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <Kpi label="Target benefit" value={money(data.kpis.target_benefit)} />
        <Kpi label="Submitted" value={money(data.kpis.submitted_benefit)} />
        <Kpi
          label="Confidence pipeline"
          value={money(data.kpis.confidence_adjusted_pipeline)}
        />
        <Kpi
          label="Verified benefit"
          value={money(data.kpis.verified_benefit)}
        />
        <Kpi
          label="Cash released"
          value={money(data.kpis.verified_cash_release)}
        />
        <Kpi
          label="Investment"
          value={money(data.kpis.implementation_investment)}
        />
        <Kpi
          label="Verified ROI"
          value={
            data.kpis.verified_roi_pct == null
              ? "Awaiting investment"
              : `${Number(data.kpis.verified_roi_pct).toFixed(1)}%`
          }
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Connected, finance verified" value={money(data.kpis.connected_source_benefit)} />
        <Kpi label="Overlap removed" value={money(data.kpis.duplicate_overlap_deduction)} />
        <Kpi label="Creditable client value" value={money(data.kpis.connected_net_benefit)} />
        <Kpi label="Awaiting finance" value={String(data.kpis.connected_pending_finance || 0)} />
        <Kpi label="Evidence drift alerts" value={String(data.kpis.evidence_drift_alerts || 0)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold text-amber-900">Benefit leakage control</h2><p className="mt-1 text-sm text-amber-800">Potential value requiring action: {money(data.kpis.benefit_leakage_amount)}</p>{(data.leakage_alerts||[]).slice(0,6).map((row:any)=><p key={`${row.type}-${row.title}`} className="mt-2 text-xs text-amber-900"><b>{row.severity}</b> · {row.title} · {money(row.amount)}</p>)}{!(data.leakage_alerts||[]).length&&<p className="mt-2 text-xs text-emerald-800">No leakage signals are currently open.</p>}</div><div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4"><h2 className="font-semibold text-cyan-900">Privacy-safe value benchmark</h2><p className="mt-1 text-sm text-cyan-800">{data.benchmark?.sample_size>=3?`Current issued ROI is in the ${data.benchmark.percentile}th percentile of ${data.benchmark.sample_size} anonymized client results.`:'Benchmark becomes available after at least three other anonymized issued client statements.'}</p><p className="mt-2 text-xs text-cyan-900">{data.benchmark?.privacy_note}</p></div></section>

      <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-violet-950">Verified Value Graph</h2><p className="text-xs text-violet-800">Financial proof, causal attribution, baseline discipline, durability and complete client TCO.</p></div>
          <button type="button" onClick={autoMatchProofs} className="rounded bg-violet-800 px-3 py-2 text-xs text-white">Auto-match reconciled bank proof</button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded bg-white p-3 text-xs"><b>Benefit assurance</b>{(moat.assurance||[]).slice(0,5).map((row:any)=><p key={row.benefit_id} className="mt-1">{row.source_module}: <b>{row.assurance_score}/100</b> · proof {money(row.matched_amount)}</p>)}</div>
          <div className="rounded bg-white p-3 text-xs"><b>Revalidation alerts</b>{(moat.alerts||[]).slice(0,5).map((row:any,index:number)=><p key={`${row.type}-${index}`} className="mt-1">{row.type.replaceAll("_"," ")} {row.title||row.due_date||""}</p>)}</div>
          <div className="rounded bg-white p-3 text-xs"><b>{moat.country_profile?.market||"UAE"} value library</b>{(moat.country_value_library||[]).map((item:string)=><p key={item} className="mt-1">• {item}</p>)}<p className="mt-2 text-slate-500">Benchmark consent: {moat.country_profile?.benchmarking_consent?"on":"off"}</p></div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-4 text-sm"><h2 className="font-semibold">Value-to-renewal cockpit</h2>{renewal.configured ? <><p className="mt-2">Renewal in <b>{renewal.days_to_renewal}</b> days · risk <b>{renewal.renewal_risk_score}/100</b></p><p className="mt-1">Verified value coverage: <b>{renewal.value_coverage_ratio == null ? "—" : `${(Number(renewal.value_coverage_ratio)*100).toFixed(0)}%`}</b></p><p className="mt-1 text-xs text-slate-500">{renewal.overdue_revalidations} overdue benefit revalidation(s)</p></> : <p className="mt-2 text-slate-500">Configure the commercial renewal profile below.</p>}</div>
        <form onSubmit={post("/value-realization/renewal-profile", "Renewal value profile saved.")} className="space-y-2 rounded-xl border bg-white p-4"><h2 className="font-semibold">Renewal profile</h2><input required type="date" name="renewal_date" className={field}/><input required type="number" min="0" step="0.01" name="contracted_arr" placeholder="Contracted ARR" className={field}/><input required type="number" min="0" max="100" name="adoption_score" placeholder="Adoption score / 100" className={field}/><input name="account_owner_reference" placeholder="Account owner" className={field}/><input name="action_plan" placeholder="Value renewal action plan" className={field}/><button className="rounded bg-violet-800 px-3 py-2 text-sm text-white">Save renewal plan</button></form>
        <form onSubmit={post("/value-realization/country-rules/run", "Country value rules evaluated.")} className="space-y-2 rounded-xl border bg-white p-4"><h2 className="font-semibold">Country ROI rules</h2><p className="text-xs text-slate-500">Runs the configured UAE or India value library with auditable no-data signals until real connector evidence is available.</p><input required type="date" name="period_from" className={field}/><input required type="date" name="period_to" className={field}/><button className="rounded bg-violet-800 px-3 py-2 text-sm text-white">Run country rules</button></form>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold text-amber-950">Value Intelligence</h2><p className="text-xs text-amber-800">Explainable, source-linked priorities for finance and customer-success teams.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{(moat.intelligence||[]).slice(0,8).map((item:any,index:number)=><div key={`${item.category}-${index}`} className="rounded bg-white p-3 text-xs"><b>{item.priority}/100 · {item.category.replaceAll("_"," ")}</b><p className="mt-1 font-medium">{item.title}</p><p className="mt-1 text-slate-600">{item.recommendation}</p></div>)}{!(moat.intelligence||[]).length&&<p className="text-sm text-emerald-800">No priority value-control actions are open.</p>}</div></section>

      <div className="grid gap-5 lg:grid-cols-3">
        <form onSubmit={post("/value-realization/commercial-profiles", "Commercial profile proposed.")} className="space-y-2 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Subscription value baseline</h2>
          <input required name="contract_reference" placeholder="Contract reference" className={field} />
          <input required name="service_start_date" type="date" className={field} />
          <input required name="implementation_investment" type="number" min="0" step="0.01" placeholder="Implementation investment AED" className={field} />
          <input required name="monthly_subscription_value" type="number" min="0.01" step="0.01" placeholder="Monthly subscription AED" className={field} />
          <input required name="commercial_evidence" placeholder="Signed order/contract evidence" className={field} />
          <button className="rounded bg-[#173B4D] px-3 py-2 text-sm text-white">Propose commercial baseline</button>
          {data.commercial_profiles.map((row: any) => <p key={row.id} className="text-xs text-slate-600">{row.contract_reference} · {money(row.monthly_subscription_value)}/month · <b>{row.status}</b>{row.status === "PROPOSED" && <button type="button" onClick={() => approveProfile(row.id)} className="ml-2 rounded border px-2 py-1">Approve</button>}</p>)}
        </form>

        <form onSubmit={post("/value-realization/overlaps", "Cross-module overlap proposed.")} className="space-y-2 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Prevent duplicate value</h2>
          <select required name="primary_benefit_id" className={field}><option value="">Primary finance-verified benefit</option>{data.source_benefits.filter((r: any) => r.finance_status === "FINANCE_VERIFIED").map((r: any) => <option key={r.id} value={r.id}>{r.source_module} · {r.benefit_title}</option>)}</select>
          <select required name="overlapping_benefit_id" className={field}><option value="">Overlapping finance-verified benefit</option>{data.source_benefits.filter((r: any) => r.finance_status === "FINANCE_VERIFIED").map((r: any) => <option key={r.id} value={r.id}>{r.source_module} · {r.benefit_title}</option>)}</select>
          <input required name="overlap_amount" type="number" min="0.01" step="0.01" placeholder="Duplicated amount AED" className={field} />
          <input required name="rationale" placeholder="Economic-event attribution rationale" className={field} />
          <button className="rounded bg-[#266B67] px-3 py-2 text-sm text-white">Propose overlap deduction</button>
          {data.overlaps.map((row: any) => <p key={row.id} className="text-xs text-slate-600">{money(row.overlap_amount)} · <b>{row.status}</b>{row.status === "PROPOSED" && <button type="button" onClick={() => approveOverlap(row.id)} className="ml-2 rounded border px-2 py-1">Approve</button>}</p>)}
        </form>

        <form onSubmit={post("/value-realization/statements", "Monthly client ROI statement generated.")} className="space-y-2 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Client monthly ROI statement</h2>
          <input required name="period_from" type="date" className={field} />
          <input required name="period_to" type="date" className={field} />
          <p className="text-xs text-slate-500">Annual benefits are credited monthly at 1/12. One-time benefits are credited in their verified month. Approved overlaps are deducted.</p>
          <button className="rounded bg-indigo-700 px-3 py-2 text-sm text-white"><FileText size={15} className="mr-1 inline" />Generate statement</button>
          {data.statements.map((row: any) => <div key={row.id} className="rounded border p-2 text-xs"><b>{row.period_from} → {row.period_to}</b><span className="block">Net benefit {money(row.net_benefit)} · subscription {money(row.subscription_value)}</span><span className="block">Cumulative ROI {row.roi_pct == null ? "—" : `${Number(row.roi_pct).toFixed(1)}%`} · payback {row.payback_achieved ? "achieved" : "pending"}</span><b>{row.status}</b>{row.status === "DRAFT" && <button type="button" onClick={() => issueStatement(row.id)} className="ml-2 rounded border px-2 py-1">Issue</button>}{row.status === "ISSUED" && <><button type="button" onClick={() => clientPack(row.id)} className="ml-2 rounded border px-2 py-1">Evidence pack</button><button type="button" onClick={() => approveClientStatement(row.id)} className="ml-2 rounded border px-2 py-1">Client acknowledge</button></>}</div>)}
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={post("/value-realization/baselines", "Versioned ROI baseline proposed.")} className="space-y-2 rounded-xl border bg-white p-4"><h2 className="font-semibold">Trusted baseline</h2><input required name="baseline_key" placeholder="Baseline key" className={field}/><input required name="title" placeholder="Metric title" className={field}/><div className="grid grid-cols-2 gap-2"><input required type="date" name="period_from" className={field}/><input required type="date" name="period_to" className={field}/></div><input required type="number" step="0.0001" name="baseline_value" placeholder="Baseline amount / rate" className={field}/><select name="normalization_method" className={field}><option value="NONE">No normalization</option><option value="VOLUME">Volume normalized</option><option value="SEASONAL">Seasonally adjusted</option><option value="FX_INFLATION">FX / inflation adjusted</option></select><input required name="evidence_reference" placeholder="Evidence / report reference" className={field}/><button className="rounded bg-violet-800 px-3 py-2 text-sm text-white">Propose baseline</button></form>
        <form onSubmit={post("/value-realization/commercial-costs", "Client TCO cost recorded.")} className="space-y-2 rounded-xl border bg-white p-4"><h2 className="font-semibold">Complete client TCO</h2><input required name="title" placeholder="Cost title" className={field}/><select required name="cost_type" className={field}><option value="INTEGRATION">Integration</option><option value="INTERNAL_LABOUR">Internal labour</option><option value="PARTNER">Partner</option><option value="CREDIT">Client credit</option><option value="OTHER">Other cost</option></select><input required type="number" step="0.01" name="amount" placeholder="Amount AED" className={field}/><input required type="date" name="effective_from" className={field}/><select name="recurring_frequency" className={field}><option value="ONE_TIME">One-time</option><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></select><input required name="evidence_reference" placeholder="Contract / approved evidence" className={field}/><button className="rounded bg-violet-800 px-3 py-2 text-sm text-white">Add TCO cost</button></form>
        <form onSubmit={post("/value-realization/country-profile", "Country ROI value library configured.")} className="space-y-2 rounded-xl border bg-white p-4"><h2 className="font-semibold">Country-native value library</h2><select required name="market" className={field}><option value="UAE">UAE</option><option value="INDIA">India</option><option value="GLOBAL">Global</option></select><input name="currency" placeholder="Currency (AED / INR)" className={field}/><input name="client_display_name" placeholder="Client display name" className={field}/><input name="benchmark_segment" placeholder="Anonymous benchmark segment" className={field}/><label className="flex gap-2 text-sm"><input type="checkbox" name="benchmarking_consent" value="true"/> Consent to anonymised aggregate benchmark</label><button className="rounded bg-violet-800 px-3 py-2 text-sm text-white">Save country profile</button><p className="text-xs text-slate-500">No client identity or raw financial record is exposed through benchmarks.</p></form>
      </div>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Connected operational benefit ledger</h2>
        <p className="mb-3 text-xs text-slate-500">Exact source keys prevent duplicate ingestion. Source snapshots preserve baseline and outcome evidence; changed evidence is quarantined as drift until resolved.</p>
        <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Source</th><th className="p-2">Classification</th><th className="p-2">Evidence</th><th className="p-2 text-right">Source outcome</th><th className="p-2 text-right">Finance verified</th><th className="p-2">Control</th></tr></thead><tbody>
          {data.source_benefits.map((row: any) => <tr key={row.id} className="border-b align-top"><td className="p-2"><b>{row.source_module}</b><span className="block">{row.benefit_title}</span><small className="text-slate-500">{row.source_reference}</small></td><td className="p-2">{row.benefit_class.replaceAll("_", " ")}<small className="block text-slate-500">{row.realization_basis}</small></td><td className="max-w-xs p-2 text-xs"><span className="block">Baseline: {row.baseline_evidence}</span><span className="block">Outcome: {row.outcome_evidence}</span></td><td className="p-2 text-right">{money(row.gross_amount)}</td><td className="p-2 text-right font-semibold text-emerald-700">{row.finance_status === "FINANCE_VERIFIED" ? money(row.finance_verified_amount) : "—"}</td><td className="p-2"><b className={row.drift_detected ? "text-red-700" : ""}>{row.drift_detected ? "EVIDENCE DRIFT" : row.finance_status}</b>{row.finance_status === "SOURCE_VERIFIED" && !row.drift_detected && <span className="mt-1 flex gap-1"><button onClick={() => verifySource(row)} className="rounded border border-emerald-300 px-2 py-1 text-xs">Verify</button><button onClick={() => rejectSource(row.id)} className="rounded border border-red-300 px-2 py-1 text-xs">Reject</button></span>}</td></tr>)}
        </tbody></table>{!data.source_benefits.length && <p className="p-6 text-center text-sm text-slate-500">No verified operational benefits are available yet. Use Connect modules after source teams verify outcomes.</p>}</div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={post(
            "/value-realization/initiatives",
            "Value initiative proposed.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Register governed value initiative</h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="initiative_code"
              placeholder="Initiative code"
              className={field}
            />
            <input
              required
              name="title"
              placeholder="Initiative title"
              className={field}
            />
            <input
              required
              name="source_module"
              placeholder="Source module"
              className={field}
            />
            <input
              name="source_reference"
              placeholder="Source reference"
              className={field}
            />
          </div>
          <input
            required
            name="owner_reference"
            placeholder="Accountable owner"
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              name="baseline_period_from"
              type="date"
              className={field}
            />
            <input
              required
              name="baseline_period_to"
              type="date"
              className={field}
            />
            <input
              required
              name="baseline_value"
              type="number"
              min="0"
              step="0.01"
              placeholder="Baseline AED"
              className={field}
            />
            <input
              required
              name="target_benefit"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Target benefit AED"
              className={field}
            />
            <input
              name="implementation_investment"
              type="number"
              min="0"
              step="0.01"
              placeholder="Investment AED"
              className={field}
            />
            <input required name="target_date" type="date" className={field} />
          </div>
          <input
            required
            name="baseline_evidence"
            placeholder="Baseline report/evidence reference"
            className={field}
          />
          <button className="rounded bg-[#173B4D] px-3 py-2 text-sm text-white">
            Propose initiative
          </button>
        </form>

        <form
          onSubmit={post(
            "/value-realization/claims",
            "Benefit claim submitted for finance verification.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Submit measured benefit claim</h2>
          <select required name="initiative_id" className={field}>
            <option value="">Approved initiative</option>
            {data.initiatives
              .filter((row: any) => row.status === "APPROVED")
              .map((row: any) => (
                <option key={row.id} value={row.id}>
                  {row.initiative_code} · {row.title}
                </option>
              ))}
          </select>
          <select name="benefit_type" className={field}>
            <option>CASH_RELEASE</option>
            <option>COST_SAVING</option>
            <option>REVENUE_UPLIFT</option>
            <option>RISK_AVOIDANCE</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input required name="period_from" type="date" className={field} />
            <input required name="period_to" type="date" className={field} />
            <input
              required
              name="claimed_amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Claimed AED"
              className={field}
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
              className={field}
            />
          </div>
          <input
            required
            name="measurement_method"
            placeholder="Measurement method vs baseline"
            className={field}
          />
          <input
            required
            name="source_reference"
            placeholder="Unique source transaction/report"
            className={field}
          />
          <input
            required
            name="evidence_reference"
            placeholder="Operational evidence reference"
            className={field}
          />
          <button className="rounded bg-[#266B67] px-3 py-2 text-sm text-white">
            Submit claim
          </button>
        </form>
      </div>

      <section className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Initiative portfolio</h2>
            <p className="text-xs text-slate-500">
              Independent approval locks the baseline before claims are
              accepted.
            </p>
          </div>
          <ShieldCheck className="text-emerald-700" size={20} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Initiative</th>
                <th className="p-2">Owner / source</th>
                <th className="p-2 text-right">Baseline</th>
                <th className="p-2 text-right">Target</th>
                <th className="p-2 text-right">Investment</th>
                <th className="p-2">Status / control</th>
              </tr>
            </thead>
            <tbody>
              {data.initiatives.map((row: any) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="p-2">
                    <b>{row.initiative_code}</b>
                    <span className="block">{row.title}</span>
                  </td>
                  <td className="p-2">
                    {row.owner_reference}
                    <small className="block text-slate-500">
                      {row.source_module} ·{" "}
                      {row.source_reference || "No source reference"}
                    </small>
                  </td>
                  <td className="p-2 text-right">
                    {money(row.baseline_value)}
                  </td>
                  <td className="p-2 text-right">
                    {money(row.target_benefit)}
                  </td>
                  <td className="p-2 text-right">
                    {money(row.implementation_investment)}
                  </td>
                  <td className="p-2">
                    <b className="block text-xs">{row.status}</b>
                    {row.status === "PROPOSED" && (
                      <button
                        onClick={() => approve(row.id)}
                        className="mt-1 rounded border px-2 py-1 text-xs"
                      >
                        Approve
                      </button>
                    )}
                    {row.status === "APPROVED" && (
                      <button
                        onClick={() => close(row.id)}
                        className="mt-1 rounded border px-2 py-1 text-xs"
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.initiatives.length && (
            <p className="p-6 text-center text-sm text-slate-500">
              No governed value initiatives yet.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Benefit claims & finance verification</h2>
        <p className="mb-3 text-xs text-slate-500">
          The source-period fingerprint blocks duplicate benefit claims. Only
          independently verified amounts count as realized ROI.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Initiative</th>
                <th className="p-2">Benefit / period</th>
                <th className="p-2 text-right">Claimed</th>
                <th className="p-2 text-right">Confidence value</th>
                <th className="p-2 text-right">Finance verified</th>
                <th className="p-2">Status / control</th>
              </tr>
            </thead>
            <tbody>
              {data.claims.map((row: any) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="p-2">
                    <b>{row.initiative?.initiative_code}</b>
                    <small className="block text-slate-500">
                      {row.source_reference}
                    </small>
                  </td>
                  <td className="p-2">
                    {row.benefit_type.replaceAll("_", " ")}
                    <small className="block text-slate-500">
                      {row.period_from} → {row.period_to}
                    </small>
                  </td>
                  <td className="p-2 text-right">
                    {money(row.claimed_amount)}
                  </td>
                  <td className="p-2 text-right">
                    {money(row.confidence_adjusted_amount)}
                    <small className="block text-slate-500">
                      {row.confidence_pct}%
                    </small>
                  </td>
                  <td className="p-2 text-right font-semibold text-emerald-700">
                    {row.status === "VERIFIED"
                      ? money(row.verified_amount)
                      : "—"}
                  </td>
                  <td className="p-2">
                    <b className="block text-xs">{row.status}</b>
                    {row.status === "SUBMITTED" && (
                      <span className="mt-1 flex gap-1">
                        <button
                          onClick={() => verify(row)}
                          className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => reject(row.id)}
                          className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
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
          {!data.claims.length && (
            <p className="p-6 text-center text-sm text-slate-500">
              No benefit claims submitted yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
