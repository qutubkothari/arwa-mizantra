"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

type ActionRequest = {
  id: string;
  tool_code: string;
  insight_title?: string;
  status: string;
  risk: string;
  created_by: string;
  approved_by?: string;
  created_at: string;
  native_result?: { number?: string; route?: string };
  failure_reason?: string;
};

type WorkNotification = {
  id: string;
  subject: string;
  message_preview?: string;
  created_at: string;
  read: boolean;
  route: string;
  stage?: string;
  metadata?: { severity?: string; priority_score?: number };
};

const statusTone: Record<string, string> = {
  PENDING_APPROVAL: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-blue-200 bg-blue-50 text-blue-800",
  EXECUTED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REJECTED: "border-slate-200 bg-slate-50 text-slate-700",
  FAILED: "border-red-200 bg-red-50 text-red-800",
};

const readable = (value: string) =>
  String(value || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function GovernedActionsPage() {
  const [rows, setRows] = useState<ActionRequest[]>([]),
    [notifications, setNotifications] = useState<WorkNotification[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [filter, setFilter] = useState("OPEN");

  const load = useCallback(async () => {
    setError("");
    try {
      const [actions, reminders] = await Promise.all([
        apiClient.get<ActionRequest[]>("/intelligence/action-requests"),
        apiClient.get<WorkNotification[]>("/intelligence/notifications?limit=12"),
      ]);
      setRows(actions);
      setNotifications(reminders);
    } catch (caught: any) {
      setError(caught?.message || "Unable to load governed actions.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        filter === "ALL"
          ? true
          : filter === "OPEN"
            ? ["PENDING_APPROVAL", "APPROVED"].includes(row.status)
            : row.status === filter,
      ),
    [filter, rows],
  );
  const openActions = rows.filter((row) =>
    ["PENDING_APPROVAL", "APPROVED"].includes(row.status),
  ).length;
  const unread = notifications.filter((item) => !item.read).length;

  const act = async (
    row: ActionRequest,
    action: "approve" | "reject" | "execute",
  ) => {
    const actionLabel =
      action === "execute"
        ? "execute this approved ERP transaction"
        : `${action} this request`;
    if (
      !window.confirm(
        `Are you sure you want to ${actionLabel}?\n\n${readable(row.tool_code)}`,
      )
    )
      return;
    const reason =
      action === "reject"
        ? window.prompt("Enter the rejection reason:", "")?.trim()
        : "";
    if (action === "reject" && !reason) return;
    setBusy(`${row.id}:${action}`);
    setError("");
    try {
      if (action === "execute")
        await apiClient.post(
          `/intelligence/action-requests/${row.id}/execute`,
          {},
        );
      else
        await apiClient.patch(
          `/intelligence/action-requests/${row.id}/${action}`,
          action === "reject" ? { reason } : {},
        );
      await load();
    } catch (caught: any) {
      setError(caught?.message || `Unable to ${action} action.`);
    } finally {
      setBusy("");
    }
  };

  const controls = (row: ActionRequest) => (
    <div className="flex flex-wrap gap-2">
      {row.status === "PENDING_APPROVAL" && (
        <>
          <button
            disabled={!!busy}
            onClick={() => void act(row, "approve")}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === `${row.id}:approve` ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Approve
          </button>
          <button
            disabled={!!busy}
            onClick={() => void act(row, "reject")}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-red-300 px-3 text-xs font-bold text-red-800 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" /> Reject
          </button>
        </>
      )}
      {row.status === "APPROVED" && (
        <button
          disabled={!!busy}
          onClick={() => void act(row, "execute")}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#65452B] px-3 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy === `${row.id}:execute` ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Execute
        </button>
      )}
      {row.status === "EXECUTED" && row.native_result?.route && (
        <Link
          href={row.native_result.route}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-emerald-300 px-3 text-xs font-bold text-emerald-800"
        >
          Open {row.native_result.number || "record"}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );

  return (
    <main className="mx-auto max-w-7xl space-y-3 p-2 pb-24 text-[#2F241B] sm:space-y-4 sm:p-4 sm:pb-4">
      <header className="rounded-2xl border border-[#D8C8AA] bg-gradient-to-br from-[#FBF7EF] to-white p-4 sm:rounded-xl sm:p-5">
        <Link
          href="/dashboard/command-center"
          className="hidden items-center gap-1 text-xs font-semibold text-[#80613D] sm:inline-flex"
        >
          <ArrowLeft className="h-3 w-3" /> Command Center
        </Link>
        <div className="flex items-start justify-between gap-3 sm:mt-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8B6F47] sm:hidden">
              My Work
            </p>
            <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
              <ShieldCheck className="h-6 w-6" /> Approvals & execution
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-[#6F5A45] sm:text-sm">
              Review prompt-prepared work, approve independently, and execute
              only when the evidence is correct.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={!!busy}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#65452B]"
            aria-label="Refresh work"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[#E0D2B8] bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#80613D]">
            Needs your action
          </p>
          <p className="mt-1 text-2xl font-bold">{openActions}</p>
          <p className="mt-1 text-xs text-[#6F5A45]">
            Approval or execution requests visible to you.
          </p>
        </div>
        <Link
          href="/dashboard/command-center/notifications"
          className="rounded-xl border border-[#E0D2B8] bg-white p-4 transition hover:bg-[#FBF7EF]"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#80613D]">
            <Bell className="h-3.5 w-3.5" /> My reminders
          </p>
          <p className="mt-1 text-2xl font-bold">{unread}</p>
          <p className="mt-1 text-xs text-[#6F5A45]">
            Unread role-visible operational reminders.
          </p>
        </Link>
        <Link
          href="/dashboard/command-center/factory-health"
          className="rounded-xl border border-[#E0D2B8] bg-white p-4 transition hover:bg-[#FBF7EF]"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#80613D]">
            <Activity className="h-3.5 w-3.5" /> Operational health
          </p>
          <p className="mt-1 text-sm font-bold">Open Health Centre</p>
          <p className="mt-1 text-xs text-[#6F5A45]">
            Evidence-based risk, trends and readiness controls.
          </p>
        </Link>
      </section>

      {!!notifications.length && (
        <section className="rounded-xl border border-[#E0D2B8] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#EEE3D0] p-4">
            <div>
              <h2 className="font-bold">Latest reminders</h2>
              <p className="text-xs text-[#6F5A45]">
                Only notifications assigned to you or your role are shown.
              </p>
            </div>
            <Link
              href="/dashboard/command-center/notifications"
              className="text-xs font-bold text-indigo-800"
            >
              Open inbox
            </Link>
          </div>
          <div className="divide-y divide-[#F0E7D6]">
            {notifications.slice(0, 4).map((item) => (
              <Link
                key={item.id}
                href={item.route || "/dashboard/command-center/notifications"}
                className={`block p-3 text-sm hover:bg-[#FFFCF6] ${item.read ? "" : "bg-amber-50/40"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.subject}</p>
                    <p className="mt-1 truncate text-xs text-[#6F5A45]">
                      {item.message_preview || "Open the related control decision."}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold text-[#80613D]">
                    {item.metadata?.severity || item.stage || "REMINDER"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="flex gap-2 overflow-x-auto pb-1">
        {[
          ["OPEN", "Needs action"],
          ["PENDING_APPROVAL", "Approval"],
          ["APPROVED", "Ready"],
          ["EXECUTED", "Completed"],
          ["ALL", "All"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`min-h-10 shrink-0 rounded-full border px-4 text-xs font-bold ${filter === value ? "border-[#65452B] bg-[#65452B] text-white" : "border-[#D8C8AA] bg-white text-[#65452B]"}`}
          >
            {label}
          </button>
        ))}
      </section>

      <section className="space-y-3 md:hidden">
        {filtered.map((row) => (
          <article
            key={row.id}
            className="rounded-2xl border border-[#E0D2B8] bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#8B6F47]">
                  {row.risk} risk
                </p>
                <h2 className="mt-1 font-bold leading-snug">
                  {readable(row.tool_code)}
                </h2>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${statusTone[row.status] || "border-slate-200 bg-slate-50"}`}
              >
                {readable(row.status)}
              </span>
            </div>
            <p className="mt-3 text-sm text-[#5F4B3B]">
              {row.insight_title || "Prompt-prepared governed transaction"}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[#806F60]">
              <Clock3 className="h-3.5 w-3.5" />
              {new Date(row.created_at).toLocaleString()}
            </p>
            {row.failure_reason && (
              <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">
                {row.failure_reason}
              </p>
            )}
            <div className="mt-4 border-t border-[#EEE3D0] pt-3">
              {controls(row)}
            </div>
          </article>
        ))}
      </section>

      <section className="hidden overflow-auto rounded-xl border border-[#E0D2B8] bg-white md:block">
        <table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-[#F5EDDF] text-xs uppercase">
            <tr>
              <th className="p-3">Action</th>
              <th>Source decision</th>
              <th>Risk</th>
              <th>Status</th>
              <th>Created</th>
              <th className="p-3">Controls</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-t border-[#EEE3D0]">
                <td className="p-3 font-semibold">{readable(row.tool_code)}</td>
                <td>{row.insight_title || "—"}</td>
                <td>{row.risk}</td>
                <td>
                  <span
                    className={`rounded-full border px-2 py-1 text-xs font-bold ${statusTone[row.status] || "border-slate-200 bg-slate-50"}`}
                  >
                    {readable(row.status)}
                  </span>
                  {row.failure_reason && (
                    <p className="mt-1 text-xs text-red-700">
                      {row.failure_reason}
                    </p>
                  )}
                </td>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td className="p-3">{controls(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {!filtered.length && (
        <section className="rounded-2xl border border-dashed border-[#D8C8AA] bg-white p-8 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
          <h2 className="mt-3 font-bold">Nothing waiting here</h2>
          <p className="mt-1 text-sm text-[#6F5A45]">
            New prompt-prepared approvals and execution tasks will appear here.
          </p>
        </section>
      )}

      <p className="text-xs text-[#6F5A45]">
        The server rechecks tenant, permission, maker-checker state and
        idempotency during every approval and execution.
      </p>
    </main>
  );
}
