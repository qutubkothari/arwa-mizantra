"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

export type PlannerDecision = "APPROVED" | "CHANGED" | "DEFERRED" | "REJECTED";

type Master = {
  id: string;
  code?: string;
  name?: string;
  station_code?: string;
  station_name?: string;
  is_active?: boolean;
};

export type PlannerDecisionLine = {
  id: string;
  item_code?: string | null;
  item_name?: string | null;
  recommended_quantity?: number;
  net_requirement: number;
  required_by_date?: string | null;
  supply_action: "MONITOR" | "BUY" | "BUILD";
  planner_decision?: {
    decision: string;
    adjusted_quantity?: number | null;
    adjusted_required_by_date?: string | null;
    preferred_supplier_id?: string | null;
    preferred_work_centre_id?: string | null;
    reason?: string | null;
  } | null;
};

export function PlannerDecisionDialog({
  line,
  initialDecision,
  onClose,
  onSave,
}: {
  line: PlannerDecisionLine;
  initialDecision: PlannerDecision;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const existing = line.planner_decision;
  const [decision, setDecision] = useState<PlannerDecision>(initialDecision);
  const [vendors, setVendors] = useState<Master[]>([]);
  const [stations, setStations] = useState<Master[]>([]);
  const [loadingMasters, setLoadingMasters] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<Master[]>("/purchase/vendors", { isActive: true }),
      apiClient.get<Master[]>("/production/work-stations"),
    ])
      .then(([supplierRows, stationRows]) => {
        if (!active) return;
        setVendors(
          (supplierRows || []).filter((row) => row.is_active !== false),
        );
        setStations(
          (stationRows || []).filter((row) => row.is_active !== false),
        );
      })
      .catch((nextError: any) => {
        if (active)
          setError(nextError?.message || "Unable to load planning masters.");
      })
      .finally(() => {
        if (active) setLoadingMasters(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const changed = decision === "CHANGED";
    const payload: Record<string, unknown> = {
      decision,
      reason: String(values.reason || "").trim(),
      adjusted_quantity: changed ? Number(values.adjusted_quantity) : null,
      adjusted_required_by_date: changed
        ? String(values.adjusted_required_by_date || "") || null
        : null,
      preferred_supplier_id:
        line.supply_action === "BUY"
          ? String(values.preferred_supplier_id || "") || null
          : null,
      preferred_work_centre_id:
        line.supply_action === "BUILD"
          ? String(values.preferred_work_centre_id || "") || null
          : null,
    };
    try {
      await onSave(payload);
      onClose();
    } catch (nextError: any) {
      setError(nextError?.message || "Planner decision could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3">
      <form
        onSubmit={submit}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b p-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#76552B]">
              <ShieldCheck size={16} /> Governed planner decision
            </div>
            <h2 className="mt-1 text-xl font-bold">
              {line.item_code || "Material"} ·{" "}
              {line.item_name || "Unnamed item"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              This records planning judgement only. It does not create a PR, job
              order, reservation, stock movement or posting.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">
              {error}
            </div>
          )}
          <label className="text-sm font-semibold">
            Planner decision
            <select
              name="decision"
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as PlannerDecision)
              }
              className={`${input} mt-1`}
            >
              <option value="APPROVED">Approve recommendation</option>
              <option value="CHANGED">Approve with changes</option>
              <option value="DEFERRED">Defer</option>
              <option value="REJECTED">Reject</option>
            </select>
          </label>
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <span className="text-slate-500">System recommendation</span>
            <b className="block text-lg">
              {line.recommended_quantity || line.net_requirement || 0}
            </b>
            <span className="text-xs text-slate-500">
              Required {line.required_by_date || "date not set"} ·{" "}
              {line.supply_action}
            </span>
          </div>

          {decision === "CHANGED" && (
            <>
              <label className="text-sm font-semibold">
                Adjusted quantity
                <input
                  required
                  name="adjusted_quantity"
                  type="number"
                  min="0"
                  step="0.0001"
                  defaultValue={
                    existing?.adjusted_quantity ??
                    line.recommended_quantity ??
                    line.net_requirement
                  }
                  className={`${input} mt-1`}
                />
              </label>
              <label className="text-sm font-semibold">
                Adjusted required date
                <input
                  name="adjusted_required_by_date"
                  type="date"
                  min={today}
                  defaultValue={
                    existing?.adjusted_required_by_date ||
                    line.required_by_date ||
                    ""
                  }
                  className={`${input} mt-1`}
                />
              </label>
            </>
          )}

          {line.supply_action === "BUY" &&
            ["APPROVED", "CHANGED"].includes(decision) && (
              <label className="text-sm font-semibold sm:col-span-2">
                Preferred supplier
                <select
                  name="preferred_supplier_id"
                  defaultValue={existing?.preferred_supplier_id || ""}
                  disabled={loadingMasters}
                  className={`${input} mt-1`}
                >
                  <option value="">Buyer to select during PR review</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.code || "Supplier"} · {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

          {line.supply_action === "BUILD" &&
            ["APPROVED", "CHANGED"].includes(decision) && (
              <label className="text-sm font-semibold sm:col-span-2">
                Preferred work centre
                <select
                  name="preferred_work_centre_id"
                  defaultValue={existing?.preferred_work_centre_id || ""}
                  disabled={loadingMasters}
                  className={`${input} mt-1`}
                >
                  <option value="">Production planner to assign later</option>
                  {stations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.station_code || "Work centre"} ·{" "}
                      {station.station_name}
                    </option>
                  ))}
                </select>
              </label>
            )}

          <label className="text-sm font-semibold sm:col-span-2">
            {decision === "APPROVED" ? "Approval note (optional)" : "Reason *"}
            <textarea
              name="reason"
              required={decision !== "APPROVED"}
              maxLength={500}
              defaultValue={existing?.reason || ""}
              rows={3}
              placeholder="Explain the evidence and planning judgement."
              className={`${input} mt-1`}
            />
          </label>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t p-5">
          <p className="text-xs text-slate-500">
            Supplier and work-centre IDs are revalidated against this tenant on
            the server.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              disabled={busy || loadingMasters}
              className="inline-flex items-center gap-2 rounded-lg bg-[#253A63] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              Save decision
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
