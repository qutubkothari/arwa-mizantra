"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Printer, RefreshCw } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field = "rounded-lg border border-[#D9C8AA] bg-white px-3 py-2 text-sm";
const number = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  );
const pct = (value: unknown) => `${number(value)}%`;

type Row = {
  period: string;
  key: string;
  code: string;
  name: string;
  good_quantity: number;
  rejected_quantity: number;
  processed_quantity: number;
  run_minutes: number;
  downtime_minutes: number;
  operations: number;
  rejection_pct: number;
  units_per_hour: number;
  availability_pct: number;
};

export default function ProductionReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const initialFrom = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [period, setPeriod] = useState("daily");
  const [view, setView] = useState<"product" | "machine" | "process">(
    "product",
  );
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<any>({
    totals: {},
    by_product: [],
    by_machine: [],
    by_process: [],
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      setData(
        await apiClient.get(
          `/production-reports/summary?period=${period}&from=${from}&to=${to}`,
        ),
      );
    } catch (error: any) {
      setMessage(error?.message || "Unable to load production report.");
    } finally {
      setBusy(false);
    }
  }, [from, period, to]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadCsv = () => {
    const lines: string[][] = [
      [
        "View",
        "Period",
        "Code",
        "Name",
        "Good",
        "Rejected",
        "Processed",
        "Run minutes",
        "Downtime minutes",
        "Availability %",
        "Units/hour",
        "Rejection %",
        "Operations",
      ],
    ];
    for (const [view, rows] of [
      ["Product", data.by_product],
      ["Machine", data.by_machine],
      ["Process", data.by_process],
    ] as Array<[string, Row[]]>)
      for (const row of rows || [])
        lines.push([
          view,
          row.period,
          row.code,
          row.name,
          String(row.good_quantity),
          String(row.rejected_quantity),
          String(row.processed_quantity),
          String(row.run_minutes),
          String(row.downtime_minutes),
          String(row.availability_pct),
          String(row.units_per_hour),
          String(row.rejection_pct),
          String(row.operations),
        ]);
    const csv = lines
      .map((line) =>
        line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `production-${period}-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const applyRange = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  };

  const reportViews = {
    product: {
      label: "By product",
      dimension: "Product",
      rows: data.by_product || [],
    },
    machine: {
      label: "By machine",
      dimension: "Machine",
      rows: data.by_machine || [],
    },
    process: {
      label: "By process",
      dimension: "Process",
      rows: data.by_process || [],
    },
  } as const;
  const selectedView = reportViews[view];
  const totalProcessed = Number(data.totals?.processed_quantity || 0);
  const rejectionPct = totalProcessed
    ? (Number(data.totals?.rejected_quantity || 0) / totalProcessed) * 100
    : 0;
  const downtimeMinutes = Number(data.totals?.downtime_minutes || 0);
  const recommendations = useMemo(() => {
    const rows = [
      ...(data.by_machine || []),
      ...(data.by_process || []),
      ...(data.by_product || []),
    ] as Row[];
    const usable = rows.filter((row) => Number(row.operations || 0) > 0);
    const worstDowntime = [...usable].sort(
      (left, right) =>
        Number(right.downtime_minutes || 0) -
        Number(left.downtime_minutes || 0),
    )[0];
    const worstRejection = [...usable].sort(
      (left, right) =>
        Number(right.rejection_pct || 0) - Number(left.rejection_pct || 0),
    )[0];
    const weakestAvailability = [...usable]
      .filter((row) => Number(row.availability_pct || 0) > 0)
      .sort(
        (left, right) =>
          Number(left.availability_pct || 0) -
          Number(right.availability_pct || 0),
      )[0];
    const cards: Array<{
      title: string;
      detail: string;
      tone: "amber" | "red" | "blue";
      href: string;
      action: string;
    }> = [];

    if (worstDowntime && Number(worstDowntime.downtime_minutes || 0) >= 30) {
      cards.push({
        title: `Protect ${worstDowntime.name || worstDowntime.code}`,
        detail: `${number(worstDowntime.downtime_minutes)} minutes lost. Review the downtime reason and schedule the next roll/tool change before the run.`,
        tone: "amber",
        href: "/dashboard/shop-floor",
        action: "Open My Machine",
      });
    }
    if (worstRejection && Number(worstRejection.rejection_pct || 0) > 2) {
      cards.push({
        title: `Contain rejects on ${worstRejection.name || worstRejection.code}`,
        detail: `${pct(worstRejection.rejection_pct)} rejected. Check the first-off sample, tooling condition and process settings before releasing the next batch.`,
        tone: "red",
        href: "/dashboard/quality",
        action: "Open Quality",
      });
    }
    if (
      weakestAvailability &&
      Number(weakestAvailability.availability_pct || 0) < 85
    ) {
      cards.push({
        title: `Improve availability at ${weakestAvailability.name || weakestAvailability.code}`,
        detail: `Availability is ${pct(weakestAvailability.availability_pct)}. Compare planned versus actual stop time and assign the recurring cause to maintenance or planning.`,
        tone: "blue",
        href: "/dashboard/production/maintenance",
        action: "Open Maintenance",
      });
    }
    if (!cards.length) {
      cards.push({
        title: "No urgent production exception",
        detail: usable.length
          ? "Recorded output, rejection and availability are within the current thresholds. Keep recording actual run and stop details to strengthen the recommendations."
          : "Record actual output and downtime from My Machine. Recommendations will appear when there is enough production evidence.",
        tone: "blue",
        href: "/dashboard/shop-floor",
        action: "Open My Machine",
      });
    }
    return cards.slice(0, 3);
  }, [data.by_machine, data.by_process, data.by_product]);

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-4 print:max-w-none print:p-0">
      <header className="rounded-2xl bg-gradient-to-r from-[#4A3526] to-[#8B6844] p-6 text-white print:bg-white print:text-black">
        <p className="text-sm text-amber-100 print:text-black">
          Production intelligence
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Production Results</h1>
            <p className="mt-1 text-sm text-amber-50 print:text-black">
              See what was made, what stopped production and where to focus
              today. Detailed analysis is one click away.
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={downloadCsv}
              className="rounded-lg border border-white/50 px-3 py-2 text-sm"
            >
              <Download className="mr-1 inline h-4 w-4" />
              CSV
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-lg border border-white/50 px-3 py-2 text-sm"
            >
              <Printer className="mr-1 inline h-4 w-4" />
              Print/PDF
            </button>
          </div>
        </div>
      </header>
      <section className="rounded-xl border bg-white p-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-[#3E2A1F]">Report period</h2>
            <p className="text-sm text-slate-500">
              Choose a quick period or set exact dates.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => applyRange(days)}
                className="rounded-lg border border-[#D9C8AA] px-3 py-2 text-sm font-medium text-[#4A3526] hover:bg-[#FFF8EB]"
              >
                Last {days} days
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-[#5E4635]">
            Period
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className={`${field} mt-1 block`}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-[#5E4635]">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className={`${field} mt-1 block`}
            />
          </label>
          <label className="text-xs font-semibold text-[#5E4635]">
            To
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className={`${field} mt-1 block`}
            />
          </label>
          <button
            onClick={load}
            disabled={busy}
            className="rounded-lg bg-[#4A3526] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <RefreshCw
              className={`mr-1 inline h-4 w-4 ${busy ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </section>
      {message && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {message}
        </p>
      )}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <K label="Good output" value={number(data.totals?.good_quantity)} />
        <K label="Rejected" value={number(data.totals?.rejected_quantity)} />
        <K label="Run time" value={`${number(data.totals?.run_minutes)} min`} />
        <K
          label="Downtime"
          value={`${number(data.totals?.downtime_minutes)} min`}
        />
      </section>
      <section className="rounded-xl border border-[#E2D2B7] bg-[#FFF9EF] p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-[#8B6844]">
          Today&apos;s focus
        </p>
        <p className="mt-1 font-semibold text-[#3E2A1F]">
          {totalProcessed === 0 && downtimeMinutes > 0
            ? `No completed output was recorded, while ${number(downtimeMinutes)} minutes of downtime were logged. Review the machine view to identify the cause before the next run.`
            : totalProcessed === 0
              ? "No completed output in this period yet. Record production from My Machine to start seeing results."
              : downtimeMinutes > 0
                ? `${number(downtimeMinutes)} minutes of downtime were recorded. Review the machine view to identify where time was lost.`
                : rejectionPct > 2
                  ? `${pct(rejectionPct)} of processed output was rejected. Review the product and process views before the next run.`
                  : "Production is running within the recorded limits for this period."}
        </p>
      </section>
      <section className="rounded-xl border border-[#D7E1EF] bg-white p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#455F82]">
            Mizantra recommendations
          </p>
          <h2 className="mt-1 font-bold text-[#26384F]">
            What should the team do next?
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Practical actions from the actual output, rejection and downtime
            recorded in this period.
          </p>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {recommendations.map((card) => (
            <article
              key={card.title}
              className={`rounded-xl border p-4 ${
                card.tone === "red"
                  ? "border-red-200 bg-red-50"
                  : card.tone === "amber"
                    ? "border-amber-200 bg-amber-50"
                    : "border-blue-200 bg-blue-50"
              }`}
            >
              <h3 className="font-bold text-[#26384F]">{card.title}</h3>
              <p className="mt-1 text-sm text-slate-700">{card.detail}</p>
              <Link
                href={card.href}
                className="mt-3 inline-flex text-sm font-bold text-[#455F82] underline underline-offset-4"
              >
                {card.action}
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-4 print:hidden">
        <h2 className="font-bold text-[#3E2A1F]">Break down the result</h2>
        <p className="mt-1 text-sm text-slate-500">
          Choose one view at a time to keep the review focused.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(reportViews) as Array<keyof typeof reportViews>).map(
            (key) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === key ? "bg-[#4A3526] text-white" : "border border-[#D9C8AA] text-[#4A3526]"}`}
              >
                {reportViews[key].label}
              </button>
            ),
          )}
        </div>
      </section>
      <ReportTable
        title={selectedView.label}
        dimension={selectedView.dimension}
        rows={selectedView.rows}
      />
    </main>
  );
}

function K({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-[#3E2A1F]">{value}</p>
    </div>
  );
}

function ReportTable({
  title,
  dimension,
  rows,
}: {
  title: string;
  dimension: string;
  rows: Row[];
}) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-bold text-[#3E2A1F]">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">Period</th>
              <th className="p-2">{dimension}</th>
              <th className="p-2 text-right">Good</th>
              <th className="p-2 text-right">Rejected</th>
              <th className="p-2 text-right">Run min</th>
              <th className="p-2 text-right">Down min</th>
              <th className="p-2 text-right">Availability</th>
              <th className="p-2 text-right">Units/hr</th>
              <th className="p-2 text-right">Reject %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.period}-${row.key}`} className="border-b">
                <td className="p-2 font-medium">{row.period}</td>
                <td className="p-2">
                  <b>{row.code}</b>
                  <small className="block text-slate-500">{row.name}</small>
                </td>
                <td className="p-2 text-right">{number(row.good_quantity)}</td>
                <td className="p-2 text-right text-red-700">
                  {number(row.rejected_quantity)}
                </td>
                <td className="p-2 text-right">{number(row.run_minutes)}</td>
                <td className="p-2 text-right text-amber-700">
                  {number(row.downtime_minutes)}
                </td>
                <td className="p-2 text-right">{pct(row.availability_pct)}</td>
                <td className="p-2 text-right">{number(row.units_per_hour)}</td>
                <td className="p-2 text-right">{pct(row.rejection_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="py-8 text-center text-sm text-slate-500">
            No completed production activity in this period.
          </p>
        )}
      </div>
    </section>
  );
}
