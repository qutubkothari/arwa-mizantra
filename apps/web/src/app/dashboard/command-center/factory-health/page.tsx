"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, Save, ShieldCheck, TrendingUp } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

type Configuration = {
  configured: boolean;
  factor_caps: Record<string, number>;
  management_attention_threshold: number;
  critical_threshold: number;
  historical_observations_required: number;
  updated_at?: string | null;
  note: string;
};
type History = {
  history: Array<{
    snapshot_date: string;
    score: number;
    open_exceptions?: number;
    high_priority?: number;
  }>;
  change_from_previous: number | null;
  note: string;
};
type Forecast = {
  sufficient_data: boolean;
  confidence: string;
  observations_available?: number;
  observations_required?: number;
  forecast: Array<{ date: string; score: number }>;
  note?: string;
  methodology: string;
  data_classification?: "TEST_SIMULATION" | "OPERATING_HISTORY";
  data_classification_note?: string;
};
type ForecastQuality = {
  evaluated_forecasts: number;
  pending_evaluation: number;
  mean_absolute_error: number | null;
  accuracy_score: number | null;
  note: string;
};

const factorLabels: Record<string, string> = {
  approvals: "Approval flow",
  stock_risk: "Material availability",
  receipt_qc: "Receipt and QC closure",
  master_data: "Master-data hygiene",
  critical_exceptions: "Critical exceptions",
  production_risk: "Production schedule",
  quality_risk: "Quality and CAPA",
  maintenance_risk: "Machine and maintenance",
  cash_risk: "Cash and reconciliation",
};

export default function FactoryHealthPage() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastQuality, setForecastQuality] =
    useState<ForecastQuality | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [configuration, trend, projection, quality] = await Promise.all([
        apiClient.get<Configuration>("/intelligence/health-configuration"),
        apiClient.get<History>("/intelligence/health-history?days=90"),
        apiClient.get<Forecast>("/intelligence/health-forecast?days=14"),
        apiClient.get<ForecastQuality>("/intelligence/health-forecast-quality"),
      ]);
      setConfig(configuration);
      setHistory(trend);
      setForecast(projection);
      setForecastQuality(quality);
    } catch (e: any) {
      setError(e?.message || "Unable to load Factory Health controls.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await apiClient.patch<Configuration>(
        "/intelligence/health-configuration",
        {
          factor_caps: config.factor_caps,
          management_attention_threshold: Number(
            config.management_attention_threshold,
          ),
          critical_threshold: Number(config.critical_threshold),
          historical_observations_required: Number(
            config.historical_observations_required,
          ),
        },
      );
      setConfig(saved);
      setMessage(
        "Factory Health configuration saved. No source ERP record was changed.",
      );
      await load();
    } catch (e: any) {
      setError(e?.message || "Unable to save Factory Health configuration.");
    } finally {
      setSaving(false);
    }
  };
  const updateCap = (key: string, value: string) =>
    setConfig((current) =>
      current
        ? {
            ...current,
            factor_caps: { ...current.factor_caps, [key]: Number(value) },
          }
        : current,
    );
  return (
    <main className="min-h-full bg-[#FAF7F1] p-4 md:p-7">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 border border-[#E8DCC4] bg-white p-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8B6F47]">
              Mizantra governed intelligence
            </p>
            <h1 className="mt-2 text-3xl font-bold text-[#2F241B]">
              Factory Health
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[#6F5A45]">
              Configure transparent score weighting and the historical evidence
              threshold. These controls score operational risk; they never post,
              approve or modify ERP transactions.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard/command-center"
              className="border border-[#65452B] px-3 py-2 text-sm font-semibold text-[#65452B]"
            >
              Command Center
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
        {error && (
          <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}
        {message && (
          <div className="border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {message}
          </div>
        )}
        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <form
            onSubmit={save}
            className="border border-[#E8DCC4] bg-white p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Tenant score controls</h2>
                <p className="text-sm text-[#6F5A45]">
                  Maximum penalty per risk factor, from 0 to 50 points.
                </p>
              </div>
              <ShieldCheck className="h-6 w-6 text-[#8B6F47]" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {config &&
                Object.entries(config.factor_caps).map(([key, value]) => (
                  <label
                    key={key}
                    className="text-xs font-semibold uppercase tracking-wide text-[#6F5A45]"
                  >
                    {factorLabels[key] || key}
                    <input
                      aria-label={factorLabels[key] || key}
                      type="number"
                      min="0"
                      max="50"
                      value={value}
                      onChange={(e) => updateCap(key, e.target.value)}
                      className="mt-1 w-full border border-[#D8C8AA] bg-[#FFFCF7] px-3 py-2 text-base font-bold text-[#2F241B]"
                    />
                  </label>
                ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-[#6F5A45]">
                Management attention
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={config?.management_attention_threshold ?? ""}
                  onChange={(e) =>
                    setConfig((c) =>
                      c
                        ? {
                            ...c,
                            management_attention_threshold: Number(
                              e.target.value,
                            ),
                          }
                        : c,
                    )
                  }
                  className="mt-1 w-full border border-[#D8C8AA] p-2"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#6F5A45]">
                Critical threshold
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={config?.critical_threshold ?? ""}
                  onChange={(e) =>
                    setConfig((c) =>
                      c
                        ? { ...c, critical_threshold: Number(e.target.value) }
                        : c,
                    )
                  }
                  className="mt-1 w-full border border-[#D8C8AA] p-2"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#6F5A45]">
                History required
                <input
                  type="number"
                  min="3"
                  max="90"
                  value={config?.historical_observations_required ?? ""}
                  onChange={(e) =>
                    setConfig((c) =>
                      c
                        ? {
                            ...c,
                            historical_observations_required: Number(
                              e.target.value,
                            ),
                          }
                        : c,
                    )
                  }
                  className="mt-1 w-full border border-[#D8C8AA] p-2"
                />
              </label>
            </div>
            <p className="mt-4 text-xs text-[#6F5A45]">{config?.note}</p>
            <button
              disabled={saving || !config}
              className="mt-4 inline-flex items-center gap-2 bg-[#65452B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save governed configuration"}
            </button>
          </form>
          <section className="border border-[#E8DCC4] bg-white p-5">
            <div className="flex gap-2">
              <TrendingUp className="h-6 w-6 text-[#8B6F47]" />
              <div>
                <h2 className="text-lg font-bold">Calibration status</h2>
                <p className="text-sm text-[#6F5A45]">
                  A trend is shown only when approved history is sufficient.
                </p>
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between border-b border-[#F0E7D7] pb-2">
                <dt>Observations available</dt>
                <dd className="font-bold">
                  {forecast?.observations_available ??
                    history?.history.length ??
                    0}
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#F0E7D7] pb-2">
                <dt>Required</dt>
                <dd className="font-bold">
                  {forecast?.observations_required ??
                    config?.historical_observations_required ??
                    14}
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#F0E7D7] pb-2">
                <dt>Forecast confidence</dt>
                <dd className="font-bold">{forecast?.confidence || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Latest score movement</dt>
                <dd className="font-bold">
                  {history?.change_from_previous == null
                    ? "—"
                    : `${history.change_from_previous > 0 ? "+" : ""}${history.change_from_previous}`}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-[#6F5A45]">
              {forecast?.note ||
                forecast?.methodology ||
                "Loading calibration status…"}
            </p>
          </section>
        </div>
        <section className="border border-[#E8DCC4] bg-white p-5">
          <h2 className="text-lg font-bold">Evidence history and projection</h2>
          <p className="mt-1 text-sm text-[#6F5A45]">
            Stored daily score snapshots are evidence of operational state. The
            projection is statistical trend only and does not claim causation.
          </p>
          {forecast?.data_classification === "TEST_SIMULATION" && (
            <div className="mt-4 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <b>Test-data projection.</b> {forecast.data_classification_note}
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="border border-[#F0E7D7] p-3 text-sm">
              <p className="text-[#6F5A45]">Evaluated forecasts</p>
              <b>{forecastQuality?.evaluated_forecasts ?? 0}</b>
            </div>
            <div className="border border-[#F0E7D7] p-3 text-sm">
              <p className="text-[#6F5A45]">Pending evaluation</p>
              <b>{forecastQuality?.pending_evaluation ?? 0}</b>
            </div>
            <div className="border border-[#F0E7D7] p-3 text-sm">
              <p className="text-[#6F5A45]">Mean absolute error</p>
              <b>
                {forecastQuality?.mean_absolute_error == null
                  ? "—"
                  : `${forecastQuality.mean_absolute_error} pts`}
              </b>
            </div>
            <div className="border border-[#F0E7D7] p-3 text-sm">
              <p className="text-[#6F5A45]">Accuracy score</p>
              <b>
                {forecastQuality?.accuracy_score == null
                  ? "—"
                  : `${forecastQuality.accuracy_score}%`}
              </b>
            </div>
          </div>
          <p className="mt-3 text-xs text-[#6F5A45]">{forecastQuality?.note}</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="font-semibold">Recent daily evidence</h3>
              <div className="mt-2 max-h-72 overflow-auto border border-[#F0E7D7]">
                {(history?.history || [])
                  .slice()
                  .reverse()
                  .map((item) => (
                    <div
                      key={item.snapshot_date}
                      className="flex justify-between border-b border-[#F0E7D7] px-3 py-2 text-sm"
                    >
                      <span>{item.snapshot_date}</span>
                      <b>{item.score}/100</b>
                    </div>
                  ))}
                {!history?.history.length && (
                  <p className="p-3 text-sm text-[#6F5A45]">
                    No snapshots yet. The daily scheduler will create the first
                    evidence point.
                  </p>
                )}
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Next 14 days</h3>
              <div className="mt-2 border border-[#F0E7D7]">
                {(forecast?.forecast || []).map((item) => (
                  <div
                    key={item.date}
                    className="flex justify-between border-b border-[#F0E7D7] px-3 py-2 text-sm"
                  >
                    <span>{item.date}</span>
                    <b>{item.score}/100</b>
                  </div>
                ))}
                {!forecast?.forecast.length && (
                  <p className="p-3 text-sm text-[#6F5A45]">
                    No projection until the approved historical observation
                    threshold is met.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
