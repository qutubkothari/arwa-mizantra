"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CircleDollarSign,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

type Benefit = {
  id: string;
  benefit_title?: string;
  source_module?: string;
  benefit_class?: string;
  finance_status?: string;
  finance_verified_amount?: number;
  gross_amount?: number;
  drift_detected?: boolean;
  source_verified_at?: string;
};
type Dashboard = {
  kpis?: Record<string, number>;
  source_benefits?: Benefit[];
  leakage_alerts?: Array<{
    type: string;
    title: string;
    amount: number;
    source?: string;
  }>;
  benchmark?: { cohort?: { market?: string | null }; privacy_note?: string };
};

const number = (value: unknown) => Number(value || 0);

export default function MizantraImpactPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setData(await apiClient.get<Dashboard>("/value-realization/dashboard"));
    } catch (e: any) {
      setError(e?.message || "Unable to load Mizantra Impact.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const currency = data?.benchmark?.cohort?.market === "INDIA" ? "INR" : "AED";
  const money = (value: unknown) =>
    `${currency} ${new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-AE", { maximumFractionDigits: 0 }).format(number(value))}`;
  const waterfall = useMemo(() => {
    const verified = (data?.source_benefits || []).filter(
      (benefit) =>
        benefit.finance_status === "FINANCE_VERIFIED" &&
        !benefit.drift_detected,
    );
    const sum = (classes: string[]) =>
      verified
        .filter((benefit) =>
          classes.includes(String(benefit.benefit_class || "")),
        )
        .reduce(
          (total, benefit) => total + number(benefit.finance_verified_amount),
          0,
        );
    return {
      cash: sum(["CASH_RELEASE", "WORKING_CAPITAL"]),
      accounting: sum(["ACCOUNTING_SAVING", "REVENUE_UPLIFT"]),
      risk: sum(["RISK_AVOIDANCE"]),
      verified,
    };
  }, [data]);
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 text-[#2F241B]">
      <header className="border border-[#D8C8AA] bg-[#FBF7EF] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href="/dashboard/command-center"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#80613D]"
            >
              <ArrowLeft className="h-3 w-3" />
              Command Center
            </Link>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold">
              <CircleDollarSign className="h-6 w-6" />
              Mizantra Impact
            </h1>
            <p className="mt-1 text-sm text-[#6F5A45]">
              Verified value only. Cash, accounting impact and risk avoidance
              are separate so management does not mistake an accounting benefit
              for cash received.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard/accounts/value-realization"
              className="border border-[#65452B] px-3 py-2 text-sm font-semibold text-[#65452B]"
            >
              Open value controls
            </Link>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 bg-[#65452B] px-3 py-2 text-sm font-semibold text-white"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </header>
      {error && (
        <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <section className="grid gap-3 md:grid-cols-4">
        <Card
          label="Finance-verified value"
          value={money(data?.kpis?.connected_net_benefit)}
          note="After approved duplicate-benefit deductions"
        />
        <Card
          label="Cash / working capital"
          value={money(waterfall.cash)}
          note="Requires finance verification"
        />
        <Card
          label="P&L / revenue impact"
          value={money(waterfall.accounting)}
          note="Accounting saving or revenue uplift"
        />
        <Card
          label="Risk avoidance"
          value={money(waterfall.risk)}
          note="Tracked separately from cash and P&L"
        />
      </section>
      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <article className="border border-[#E8DCC4] bg-white p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#80613D]" />
            <div>
              <h2 className="font-bold">Evidence-backed source benefits</h2>
              <p className="text-xs text-[#6F5A45]">
                Only source benefits verified by finance and without evidence
                drift appear here.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {waterfall.verified.map((benefit) => (
              <div
                key={benefit.id}
                className="flex flex-wrap justify-between gap-2 border-l-2 border-[#B28B50] bg-[#FBF7EF] p-3 text-sm"
              >
                <div>
                  <b>{benefit.benefit_title || "Verified benefit"}</b>
                  <p className="mt-1 text-xs text-[#6F5A45]">
                    {benefit.source_module || "ERP"} ·{" "}
                    {String(benefit.benefit_class || "").replaceAll("_", " ")}
                  </p>
                </div>
                <b>{money(benefit.finance_verified_amount)}</b>
              </div>
            ))}
            {!waterfall.verified.length && (
              <p className="py-5 text-sm text-[#6F5A45]">
                No finance-verified connected benefits are available yet.
                Mizantra will not manufacture ROI numbers.
              </p>
            )}
          </div>
        </article>
        <article className="border border-[#E8DCC4] bg-white p-5">
          <h2 className="font-bold">Evidence controls</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row
              label="Finance verification pending"
              value={String(data?.kpis?.connected_pending_finance ?? 0)}
            />
            <Row
              label="Evidence drift alerts"
              value={String(data?.kpis?.evidence_drift_alerts ?? 0)}
            />
            <Row
              label="Duplicate overlap deduction"
              value={money(data?.kpis?.duplicate_overlap_deduction)}
            />
            <Row
              label="Potential leakage requiring review"
              value={money(data?.kpis?.benefit_leakage_amount)}
            />
          </dl>
          <p className="mt-5 text-xs text-[#6F5A45]">
            {data?.benchmark?.privacy_note}
          </p>
        </article>
      </section>
      <section className="border border-[#E8DCC4] bg-white p-5">
        <h2 className="font-bold">Verification worklist</h2>
        <div className="mt-3 space-y-2">
          {(data?.leakage_alerts || []).map((alert, index) => (
            <div
              key={`${alert.type}-${index}`}
              className="border-l-2 border-amber-500 p-3 text-sm"
            >
              <b>{alert.title}</b>
              <p className="mt-1 text-[#6F5A45]">
                {alert.source || "ROI"} · {money(alert.amount)} ·{" "}
                {alert.type.replaceAll("_", " ")}
              </p>
            </div>
          ))}
          {!data?.leakage_alerts?.length && (
            <p className="text-sm text-[#6F5A45]">
              No ROI verification exception is currently recorded.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Card({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="border border-[#E8DCC4] bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-[#6F5A45]">{note}</p>
    </article>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#F0E7D6] pb-2">
      <dt>{label}</dt>
      <dd className="text-right font-bold">{value}</dd>
    </div>
  );
}
