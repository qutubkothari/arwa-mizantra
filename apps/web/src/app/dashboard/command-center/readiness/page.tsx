"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle as CircleAlert,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

type Check = {
  key: string;
  label: string;
  phase: string;
  current: number;
  minimum: number;
  ready: boolean;
  optional: boolean;
  route: string;
};
type Readiness = {
  readiness_percent: number;
  completed_required_checks: number;
  required_checks: number;
  checks: Check[];
  note: string;
};
type Observability = {
  components: Record<string, { status: string }>;
  ai_provider: { note: string };
  host_watchdog?: {
    status: "AVAILABLE" | "WARNING" | "DEGRADED" | "UNAVAILABLE" | string;
    checked_at: string | null;
    age_minutes: number | null;
    disk_used_percent: number | null;
    backup: {
      status: string;
      age_hours: number | null;
      size_bytes: number;
    };
    api_status: string;
    web_status: string;
    issues: string[];
    note: string;
  };
  provider_runtime?: {
    provider: string;
    circuit: string;
    cache: { entries: number };
    metrics: {
      calls: number;
      fallbacks: number;
      cache_hits: number;
      average_latency_ms: number;
    };
  };
};
type Memory = {
  coverage: { nodes: number; edges: number };
  methodology: string;
};
type ExternalReadiness = {
  market_profile: string;
  external_delivery_enabled: boolean;
  connectors: {
    required: string[];
    testing_with_vault_reference: string[];
    blockers: Array<{ connector_code: string; action: string }>;
  };
  physical_gateways: {
    registered: number;
    independently_activated: number;
    blocker: string | null;
  };
  provider: { configured: boolean; note: string };
  ready_for_external_activation: boolean;
  note: string;
};

export default function ReadinessPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [observability, setObservability] = useState<Observability | null>(
    null,
  );
  const [memory, setMemory] = useState<Memory | null>(null);
  const [external, setExternal] = useState<ExternalReadiness | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [r, o, m, x] = await Promise.all([
        apiClient.get<Readiness>("/intelligence/onboarding-readiness"),
        apiClient.get<Observability>("/intelligence/observability"),
        apiClient.get<Memory>("/intelligence/knowledge-graph?limit=500"),
        apiClient.get<ExternalReadiness>(
          "/intelligence/external-activation-readiness",
        ),
      ]);
      setReadiness(r);
      setObservability(o);
      setMemory(m);
      setExternal(x);
    } catch (e: any) {
      setError(e?.message || "Unable to load readiness and trust controls.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const available = observability
    ? Object.values(observability.components).filter(
        (item) => item.status === "AVAILABLE",
      ).length
    : "--";

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 text-[#2F241B]">
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
              <ShieldCheck className="h-6 w-6" />
              Readiness &amp; Intelligence Trust
            </h1>
            <p className="mt-1 text-sm text-[#6F5A45]">
              Live tenant setup, intelligence-engine availability and
              evidence-graph coverage.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 bg-[#65452B] px-3 py-2 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </header>
      {error && (
        <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <section className="grid gap-3 md:grid-cols-3">
        <Stat
          label="Tenant readiness"
          value={`${readiness?.readiness_percent ?? "--"}%`}
          note={
            readiness
              ? `${readiness.completed_required_checks} of ${readiness.required_checks} required controls ready`
              : "Loading"
          }
        />
        <Stat
          label="Business Memory"
          value={`${memory?.coverage.nodes ?? "--"} nodes`}
          note={`${memory?.coverage.edges ?? "--"} evidence-backed relationships`}
        />
        <Stat
          label="Intelligence components"
          value={String(available)}
          note="available in this tenant"
        />
      </section>
      <nav className="flex flex-wrap gap-2 text-sm font-semibold">
        <Link
          href="/dashboard/command-center/actions"
          className="border border-[#D8C8AA] bg-white px-3 py-2"
        >
          Governed actions
        </Link>
        <Link
          href="/dashboard/command-center/onboarding"
          className="border border-[#D8C8AA] bg-white px-3 py-2"
        >
          Onboarding intelligence
        </Link>
        <Link
          href="/dashboard/command-center/agents"
          className="border border-[#D8C8AA] bg-white px-3 py-2"
        >
          Controlled agents
        </Link>
      </nav>
      <section className="border border-[#E0D2B8] bg-white">
        <div className="border-b border-[#E8DCC4] p-4">
          <h2 className="font-bold">Configuration readiness</h2>
          <p className="text-xs text-[#6F5A45]">
            Calculated from tenant-scoped master and control records.
          </p>
        </div>
        <div className="grid gap-px bg-[#EFE5D3] md:grid-cols-2">
          {(readiness?.checks || []).map((check) => (
            <Link
              key={check.key}
              href={check.route}
              className="flex items-center justify-between bg-white p-4 hover:bg-[#FBF7EF]"
            >
              <div className="flex gap-3">
                {check.ready ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                ) : (
                  <CircleAlert className="h-5 w-5 text-amber-700" />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    {check.label}
                    {check.optional ? " (optional)" : ""}
                  </p>
                  <p className="text-xs text-[#80613D]">{check.phase}</p>
                </div>
              </div>
              <span className="text-xs font-bold">
                {check.current} / {check.minimum}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        <div className="border border-[#E0D2B8] bg-white p-4">
          <h2 className="font-bold">Engine observability</h2>
          <div className="mt-3">
            {Object.entries(observability?.components || {}).map(
              ([key, value]) => (
                <div
                  key={key}
                  className="flex justify-between border-b border-[#F0E7D6] py-2 text-sm"
                >
                  <span>{key.replaceAll("_", " ")}</span>
                  <b
                    className={
                      value.status === "AVAILABLE"
                        ? "text-emerald-700"
                        : "text-red-700"
                    }
                  >
                    {value.status}
                  </b>
                </div>
              ),
            )}
          </div>
          <p className="mt-3 text-xs text-[#6F5A45]">
            {observability?.ai_provider.note}
          </p>
        </div>
        <div className="border border-[#E0D2B8] bg-white p-4">
          <h2 className="font-bold">Evidence rules</h2>
          <p className="mt-3 text-sm text-[#6F5A45]">{memory?.methodology}</p>
          <p className="mt-3 text-xs text-[#80613D]">{readiness?.note}</p>
        </div>
      </section>
      {observability?.host_watchdog && (
        <section className="border border-[#E0D2B8] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">Mizantra server watchdog</h2>
              <p className="mt-1 text-xs text-[#6F5A45]">
                Read-only ten-minute infrastructure check for the application
                processes, endpoints and available disk space.
              </p>
            </div>
            <span
              className={
                observability.host_watchdog.status === "AVAILABLE"
                  ? "bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"
                  : observability.host_watchdog.status === "WARNING"
                    ? "bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800"
                    : "bg-red-100 px-2 py-1 text-xs font-bold text-red-800"
              }
            >
              {observability.host_watchdog.status}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
            {[
              ["Disk used", observability.host_watchdog.disk_used_percent == null ? "--" : `${observability.host_watchdog.disk_used_percent}%`],
              ["API process", observability.host_watchdog.api_status],
              ["Web process", observability.host_watchdog.web_status],
              [
                "Latest backup",
                observability.host_watchdog.backup.age_hours == null
                  ? observability.host_watchdog.backup.status
                  : `${observability.host_watchdog.backup.age_hours}h ago`,
              ],
              ["Last check", observability.host_watchdog.age_minutes == null ? "--" : `${observability.host_watchdog.age_minutes} min ago`],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-[#FBF7EF] p-3">
                <p className="text-xs text-[#80613D]">{label}</p>
                <b className="text-sm">{value}</b>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[#6F5A45]">
            {observability.host_watchdog.note}
            {observability.host_watchdog.checked_at
              ? ` Checked ${new Date(observability.host_watchdog.checked_at).toLocaleString()}.`
              : ""}
          </p>
          {observability.host_watchdog.issues.length > 0 && (
            <p className="mt-2 border-l-2 border-amber-500 pl-2 text-xs text-[#80613D]">
              {observability.host_watchdog.issues.join(", ")}
            </p>
          )}
        </section>
      )}
      <section className="border border-[#E0D2B8] bg-white p-4">
        <h2 className="font-bold">External activation readiness</h2>
        <p className="mt-1 text-xs text-[#6F5A45]">{external?.note}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-[#80613D]">
              {external?.market_profile} connectors
            </p>
            <p className="font-semibold">
              {external?.connectors.testing_with_vault_reference.length ?? 0} /{" "}
              {external?.connectors.required.length ?? 0} test-ready
            </p>
          </div>
          <div>
            <p className="text-xs text-[#80613D]">Physical gateways</p>
            <p className="font-semibold">
              {external?.physical_gateways.independently_activated ?? 0}{" "}
              approved / {external?.physical_gateways.registered ?? 0}{" "}
              registered
            </p>
          </div>
          <div>
            <p className="text-xs text-[#80613D]">External delivery</p>
            <p className="font-semibold">
              {external?.external_delivery_enabled
                ? "Enabled"
                : "Disabled by control"}
            </p>
          </div>
        </div>
        {(external?.connectors.blockers || []).map((item) => (
          <p
            key={item.connector_code}
            className="mt-2 border-l-2 border-amber-500 pl-2 text-xs text-[#80613D]"
          >
            <b>{item.connector_code}:</b> {item.action}
          </p>
        ))}
        {external?.physical_gateways.blocker && (
          <p className="mt-2 border-l-2 border-amber-500 pl-2 text-xs text-[#80613D]">
            {external.physical_gateways.blocker}
          </p>
        )}
      </section>
      {observability?.provider_runtime && (
        <section className="border border-[#E0D2B8] bg-white p-4">
          <h2 className="font-bold">Provider, cache &amp; circuit health</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
            {[
              ["Provider", observability.provider_runtime.provider],
              ["Circuit", observability.provider_runtime.circuit],
              ["Cache entries", observability.provider_runtime.cache.entries],
              ["Cache hits", observability.provider_runtime.metrics.cache_hits],
              [
                "Average latency",
                `${observability.provider_runtime.metrics.average_latency_ms} ms`,
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-[#FBF7EF] p-3">
                <p className="text-xs text-[#80613D]">{label}</p>
                <b>{value}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="border border-[#E0D2B8] bg-white p-4">
      <p className="text-xs font-bold uppercase text-[#80613D]">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="text-xs text-[#6F5A45]">{note}</p>
    </div>
  );
}
