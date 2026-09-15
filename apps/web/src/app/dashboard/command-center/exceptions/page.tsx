"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

type ExceptionRow = {
  id: string;
  title: string;
  explanation?: string;
  recommendation?: string;
  severity: string;
  priority_score: number;
  confidence: string;
  status: string;
  source_type?: string;
  source_route?: string;
  owner_user_id?: string;
  first_seen_at: string;
  last_seen_at: string;
  resolution_evidence?: string;
  evidence?: {
    action_due_date?: string;
    item_code?: string;
    run_id?: string;
    fingerprint?: string;
  };
};
type Assignee = { id: string; label: string };
type Status = "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

export default function ExceptionRegisterPage() {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [filter, setFilter] = useState("OPEN");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [exceptions, owners] = await Promise.all([
        apiClient.get<ExceptionRow[]>(
          `/intelligence/exceptions${filter === "ALL" ? "" : `?status=${filter}`}`,
        ),
        apiClient.get<Assignee[]>("/intelligence/exception-assignees"),
      ]);
      setRows(exceptions);
      setAssignees(owners);
    } catch (e: any) {
      setError(e?.message || "Unable to load exceptions.");
    }
  }, [filter]);
  useEffect(() => {
    load();
  }, [load]);
  const update = async (
    row: ExceptionRow,
    status: Status,
    ownerUserId?: string,
  ) => {
    const evidence =
      status === "RESOLVED"
        ? window.prompt("Resolution evidence / source reference:", "")
        : "";
    if (status === "RESOLVED" && !evidence) return;
    setBusy(row.id);
    try {
      await apiClient.patch(`/intelligence/exceptions/${row.id}`, {
        status,
        owner_user_id: ownerUserId || row.owner_user_id,
        resolution_evidence: evidence,
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Unable to update exception.");
    } finally {
      setBusy(null);
    }
  };
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
              <ShieldAlert className="h-6 w-6" />
              Governed Exception Register
            </h1>
            <p className="mt-1 text-sm text-[#6F5A45]">
              One owner, evidence and decision trail for every Mizantra signal.
              Resolution never posts or changes the source transaction.
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
      <div className="flex gap-2">
        {["OPEN", "ACKNOWLEDGED", "RESOLVED", "ALL"].map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`border px-3 py-1.5 text-xs font-semibold ${filter === value ? "border-[#65452B] bg-[#65452B] text-white" : "border-[#D8C8AA] bg-white"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <section className="border border-[#E8DCC4] bg-white">
        {rows.map((row) => {
          const owner = assignees.find(
            (candidate) => candidate.id === row.owner_user_id,
          );
          const actionable = ["OPEN", "ACKNOWLEDGED"].includes(row.status);
          return (
            <article
              key={row.id}
              className="border-b border-[#F0E7D6] p-4 last:border-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-4xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-bold ${row.priority_score >= 80 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}
                    >
                      {row.priority_score}
                    </span>
                    <span className="text-xs font-semibold text-[#80613D]">
                      {row.severity} · {row.confidence} confidence ·{" "}
                      {row.status}
                    </span>
                    {row.source_type && (
                      <span className="border border-[#D8C8AA] px-2 py-0.5 text-xs font-semibold">
                        {row.source_type.replaceAll("_", " ")}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-2 font-bold">{row.title}</h2>
                  <p className="mt-1 text-sm text-[#6F5A45]">
                    {row.explanation}
                  </p>
                  <p className="mt-2 text-sm">
                    <b>Recommended:</b> {row.recommendation}
                  </p>
                  {row.evidence?.action_due_date && (
                    <p
                      className={`mt-2 text-xs font-semibold ${row.evidence.action_due_date < new Date().toISOString().slice(0, 10) ? "text-red-700" : "text-[#7A6555]"}`}
                    >
                      <b>Action due:</b> {row.evidence.action_due_date}
                      {row.evidence.item_code
                        ? ` · ${row.evidence.item_code}`
                        : ""}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-[#7A6555]">
                    First seen {new Date(row.first_seen_at).toLocaleString()} ·
                    last seen {new Date(row.last_seen_at).toLocaleString()}
                  </p>
                  <p className="mt-2 text-xs text-[#7A6555]">
                    <b>Owner:</b>{" "}
                    {owner?.label ||
                      (row.owner_user_id
                        ? "Former or unavailable user"
                        : "Unassigned")}
                  </p>
                  {row.resolution_evidence && (
                    <p className="mt-2 border-l-2 border-emerald-600 pl-2 text-xs text-emerald-800">
                      <b>Resolution evidence:</b> {row.resolution_evidence}
                    </p>
                  )}
                </div>
                <div className="flex max-w-sm flex-wrap gap-2">
                  {row.source_route && (
                    <Link
                      href={row.source_route}
                      className="border border-[#C9B894] px-2 py-1 text-xs font-semibold"
                    >
                      Source
                    </Link>
                  )}
                  {actionable && (
                    <select
                      aria-label={`Assign owner for ${row.title}`}
                      value={row.owner_user_id || ""}
                      onChange={(event) =>
                        event.target.value &&
                        update(row, "ACKNOWLEDGED", event.target.value)
                      }
                      disabled={busy === row.id}
                      className="border border-[#C9B894] bg-white px-2 py-1 text-xs"
                    >
                      <option value="">Assign owner…</option>
                      {assignees.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {row.status === "OPEN" && (
                    <button
                      onClick={() => update(row, "ACKNOWLEDGED")}
                      disabled={busy === row.id}
                      className="border border-[#C9B894] px-2 py-1 text-xs font-semibold"
                    >
                      Acknowledge
                    </button>
                  )}
                  {actionable && (
                    <>
                      <button
                        onClick={() => update(row, "RESOLVED")}
                        disabled={busy === row.id}
                        className="inline-flex items-center gap-1 bg-emerald-700 px-2 py-1 text-xs font-semibold text-white"
                      >
                        {busy === row.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        Resolve
                      </button>
                      <button
                        onClick={() => update(row, "DISMISSED")}
                        disabled={busy === row.id}
                        className="border border-[#C9B894] px-2 py-1 text-xs font-semibold"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {!rows.length && (
          <p className="p-10 text-center text-sm text-[#6F5A45]">
            No exceptions in this view.
          </p>
        )}
      </section>
    </main>
  );
}
