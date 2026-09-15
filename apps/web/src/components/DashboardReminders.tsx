"use client";

import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GripVertical } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { hasModulePermission } from "@/lib/rbac";
import { useAuthStore } from "@/stores/auth.store";
import { useLocale } from "@/lib/locale";

export type PendingPO = {
  id: string;
  po_number?: string;
  vendor?: { name?: string } | null;
  created_at?: string;
  order_date?: string;
  po_date?: string;
  total_amount?: number;
  status?: string;
};

export type PendingGRN = {
  id: string;
  grn_number?: string;
  purchase_order?: { po_number?: string } | null;
  vendor?: { name?: string } | null;
  created_at?: string;
  receipt_date?: string;
  status?: string;
};

export type DashboardReminderQueue = {
  pendingPOs: PendingPO[];
  pendingQC: PendingGRN[];
};

export default function DashboardReminders() {
  const pathname = usePathname();
  const { language } = useLocale();
  const reminderRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [pendingPOs, setPendingPOs] = useState<PendingPO[]>([]);
  const [pendingQC, setPendingQC] = useState<PendingGRN[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const { user, isReady, hydrate } = useAuthStore();
  const canApprovePO = hasModulePermission(
    user,
    "Purchase Management",
    "approve",
  );
  const canUpdateQC =
    hasModulePermission(user, "Inventory", "edit") ||
    hasModulePermission(user, "Inventory", "approve") ||
    hasModulePermission(user, "Quality Control", "edit") ||
    hasModulePermission(user, "Quality Control", "approve");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("dashboardReminderPosition") || "null",
      );
      if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
        setPosition({ left: saved.left, top: saved.top });
      }
    } catch {
      localStorage.removeItem("dashboardReminderPosition");
    }
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (!apiClient.isAuthenticated()) {
      setPendingPOs([]);
      setPendingQC([]);
      return;
    }
    let cancelled = false;

    const fetchReminders = async () => {
      try {
        const result = await apiClient.get<DashboardReminderQueue>(
          "/dashboard/reminders",
        );

        if (cancelled) return;

        const queue: DashboardReminderQueue = {
          pendingPOs:
            canApprovePO && Array.isArray(result?.pendingPOs)
              ? result.pendingPOs
              : [],
          pendingQC:
            canUpdateQC && Array.isArray(result?.pendingQC)
              ? result.pendingQC
              : [],
        };
        setPendingPOs(queue.pendingPOs);
        setPendingQC(queue.pendingQC);

        // Other dashboard views consume the exact same queue. This prevents a
        // duplicate query or permission branch from showing conflicting counts.
        (
          window as Window & { __sakPendingReminders?: DashboardReminderQueue }
        ).__sakPendingReminders = queue;
        window.dispatchEvent(
          new CustomEvent<DashboardReminderQueue>("sak:pending-reminders", {
            detail: queue,
          }),
        );
      } catch {
        if (!cancelled) {
          setPendingPOs([]);
          setPendingQC([]);
        }
      }
    };

    fetchReminders();
    const intervalId = window.setInterval(fetchReminders, 30000); // Poll every 30 seconds

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [canApprovePO, canUpdateQC, isReady]);

  const total = pendingPOs.length + pendingQC.length;
  const positionClass =
    pathname === "/dashboard/settings/production-setup"
      ? "bottom-28"
      : "bottom-5";
  const floatingStyle = position
    ? {
        left: `${position.left}px`,
        top: `${position.top}px`,
        right: "auto",
        bottom: "auto",
      }
    : undefined;

  const clampPosition = (left: number, top: number) => {
    const box = reminderRef.current?.getBoundingClientRect();
    const width = box?.width || 320;
    const height = box?.height || 72;
    return {
      left: Math.max(12, Math.min(left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - height - 12)),
    };
  };

  const startDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const box = reminderRef.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - box.left,
      offsetY: event.clientY - box.top,
    };
    setPosition({ left: box.left, top: box.top });
    setDragging(true);
  };

  const moveReminder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(
      clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY),
    );
  };

  const stopDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    setDragging(false);
    setPosition((current) => {
      if (current) {
        localStorage.setItem(
          "dashboardReminderPosition",
          JSON.stringify(current),
        );
      }
      return current;
    });
  };

  const resetPosition = () => {
    dragState.current = null;
    setDragging(false);
    setPosition(null);
    localStorage.removeItem("dashboardReminderPosition");
  };

  const dragHandle = (
    <button
      type="button"
      aria-label="Drag Action Required reminder to move it"
      title="Drag to move. Double-click to reset position."
      onPointerDown={startDragging}
      onPointerMove={moveReminder}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onDoubleClick={resetPosition}
      className={`absolute -left-4 top-1/2 z-10 inline-flex h-10 w-7 -translate-y-1/2 touch-none items-center justify-center rounded-l-lg border border-r-0 border-amber-200 bg-amber-50 text-amber-800 shadow-sm ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <GripVertical size={17} />
    </button>
  );

  const handleLater = () => {
    // Hide immediately. Persisting the snooze is secondary: browsers can
    // reject localStorage writes (privacy mode, quota, or policy), and that
    // must never make "Later" fall back to the same behaviour as "Collapse".
    setSnoozed(true);
    const until = Date.now() + 30 * 60 * 1000;
    try {
      localStorage.setItem("dashboardRemindersSnoozedUntil", String(until));
    } catch {
      // The current session remains dismissed even when persistence is denied.
    }
  };

  useEffect(() => {
    const savedUntil = Number(
      localStorage.getItem("dashboardRemindersSnoozedUntil") || 0,
    );
    if (savedUntil <= Date.now()) {
      localStorage.removeItem("dashboardRemindersSnoozedUntil");
      setSnoozed(false);
      return;
    }

    setSnoozed(true);
    const timeoutId = window.setTimeout(
      () => {
        localStorage.removeItem("dashboardRemindersSnoozedUntil");
        setSnoozed(false);
      },
      Math.min(savedUntil - Date.now(), 2_147_483_647),
    );

    return () => window.clearTimeout(timeoutId);
  }, []);

  if (total === 0 || snoozed) return null;

  if (!expanded) {
    return (
      <div
        ref={reminderRef}
        style={floatingStyle}
        className={`fixed z-50 hidden w-[320px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-amber-200 bg-white shadow-xl md:block ${position ? "" : `right-5 ${positionClass}`}`}
      >
        {dragHandle}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-left hover:bg-amber-100"
        >
          <div>
            <h2 className="text-sm font-bold text-amber-900">
              Action Required
            </h2>
            <p className="mt-0.5 text-xs text-amber-800">
              {language === "ar"
                ? `${total} ${total === 1 ? "تذكير معلق" : "تذكيرات معلقة"}`
                : `${total} reminder${total === 1 ? "" : "s"} pending`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pendingPOs.length > 0 && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
                PO {pendingPOs.length}
              </span>
            )}
            {pendingQC.length > 0 && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                QC {pendingQC.length}
              </span>
            )}
            <span className="text-xs font-semibold text-amber-900">Open</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={reminderRef}
      style={floatingStyle}
      className={`fixed z-50 hidden w-[360px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-amber-200 bg-white shadow-2xl md:block ${position ? "" : `right-5 ${positionClass}`}`}
    >
      {dragHandle}
      <div className="border-b border-amber-100 bg-amber-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-amber-900">
              Action Required
            </h2>
            <p className="mt-0.5 text-xs text-amber-800">
              Pending approvals and QC reminders
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Collapse
          </button>
          <button
            type="button"
            onClick={handleLater}
            className="rounded px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Later
          </button>
        </div>
      </div>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
        {pendingPOs.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                PO Approval
              </h3>
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
                {pendingPOs.length}
              </span>
            </div>
            <div className="space-y-2">
              {pendingPOs.slice(0, 3).map((po) => (
                <Link
                  key={po.id}
                  href={`/dashboard/purchase/orders?viewId=${po.id}`}
                  className="block rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-sm hover:bg-orange-100"
                >
                  <div className="font-semibold text-orange-950">
                    {po.po_number?.startsWith("DRAFT-")
                      ? "Draft PO"
                      : po.po_number || "Purchase Order"}
                  </div>
                  <div className="mt-0.5 text-xs text-orange-800">
                    {po.vendor?.name || "Vendor not available"} is pending for
                    approval
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {pendingQC.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                QC Pending
              </h3>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                {pendingQC.length}
              </span>
            </div>
            <div className="space-y-2">
              {pendingQC.slice(0, 3).map((grn) => (
                <Link
                  key={grn.id}
                  href={`/dashboard/purchase/grn?viewId=${grn.id}`}
                  className="block rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm hover:bg-sky-100"
                >
                  <div className="font-semibold text-sky-950">
                    {grn.grn_number || "GRN"}
                  </div>
                  <div className="mt-0.5 text-xs text-sky-800">
                    {grn.vendor?.name || "Vendor not available"} - QC is pending
                    for {grn.purchase_order?.po_number || "received material"}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {total > 6 && (
          <div className="text-xs text-gray-500">
            +{total - 6} more reminders available in respective screens
          </div>
        )}
      </div>
    </div>
  );
}
