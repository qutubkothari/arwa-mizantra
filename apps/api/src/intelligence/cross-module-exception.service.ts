import { Injectable, Logger } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type CrossModuleDecision = {
  id: string;
  title: string;
  domain: string;
  severity: Severity;
  priority_score: number;
  explanation: string;
  recommended_action: string;
  impact: string | null;
  financial_impact_value: number | null;
  route: string;
  action_mode: "REVIEW_ONLY";
  source: "LIVE_ERP_CROSS_MODULE";
  forward_risk: {
    horizon: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    basis: string;
  };
  evidence: Record<string, unknown>;
};

@Injectable()
export class CrossModuleExceptionService {
  private readonly logger = new Logger(CrossModuleExceptionService.name);
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: CrossModuleDecision[] }
  >();
  private readonly pending = new Map<string, Promise<CrossModuleDecision[]>>();

  private money(value: unknown): number {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
  }

  private daysLate(value: unknown, today = new Date()): number {
    const date = new Date(String(value || ""));
    if (!Number.isFinite(date.getTime())) return 0;
    return Math.max(
      0,
      Math.floor(
        (Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        ) -
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
          )) /
          86400000,
      ),
    );
  }

  private severity(value: unknown, fallback: Severity = "MEDIUM"): Severity {
    const normalized = String(value || "").toUpperCase();
    return ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(normalized)
      ? (normalized as Severity)
      : fallback;
  }

  private score(
    severity: Severity,
    amount = 0,
    overdueDays = 0,
    compliance = false,
  ): number {
    const base = { CRITICAL: 88, HIGH: 74, MEDIUM: 54, LOW: 32 }[severity];
    const financial =
      amount > 0 ? Math.min(8, Math.log10(amount + 1) * 1.8) : 0;
    const urgency = Math.min(8, overdueDays / 3);
    return Math.min(
      99,
      Math.round(base + financial + urgency + (compliance ? 4 : 0)),
    );
  }

  private impact(amount: number, label: string): string | null {
    return amount > 0 ? `${label}: ${amount.toFixed(2)}` : null;
  }

  private async safeRows(
    table: string,
    build: (query: any) => any,
  ): Promise<any[]> {
    try {
      const result = await build(this.db.from(table).select("*"));
      if (result?.error) {
        this.logger.warn(
          JSON.stringify({
            event: "CROSS_MODULE_SIGNAL_UNAVAILABLE",
            table,
            reason: result.error.message,
          }),
        );
        return [];
      }
      return Array.isArray(result?.data) ? result.data : [];
    } catch (error: any) {
      this.logger.warn(
        JSON.stringify({
          event: "CROSS_MODULE_SIGNAL_FAILED",
          table,
          reason: String(error?.message || error),
        }),
      );
      return [];
    }
  }

  async collect(tenantId: string): Promise<CrossModuleDecision[]> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = this.pending.get(tenantId);
    if (pending) return pending;
    const work = this.collectFresh(tenantId)
      .then((value) => {
        this.cache.set(tenantId, { expiresAt: Date.now() + 30_000, value });
        return value;
      })
      .finally(() => this.pending.delete(tenantId));
    this.pending.set(tenantId, work);
    return work;
  }

  private async collectFresh(tenantId: string): Promise<CrossModuleDecision[]> {
    const today = new Date().toISOString().slice(0, 10);
    const [
      machineAlerts,
      productionExceptions,
      qualityAlerts,
      capas,
      maintenance,
      openItems,
      bankTransactions,
      salesOrders,
      purchaseOrders,
      productionOrders,
    ] = await Promise.all([
      this.safeRows("production_machine_alerts", (q) =>
        q
          .eq("tenant_id", tenantId)
          .eq("status", "OPEN")
          .order("created_at", { ascending: false })
          .limit(40),
      ),
      this.safeRows("production_autonomy_exceptions", (q) =>
        q
          .eq("tenant_id", tenantId)
          .eq("status", "OPEN")
          .order("created_at", { ascending: false })
          .limit(40),
      ),
      this.safeRows("quality_alerts", (q) =>
        q
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("triggered_at", { ascending: false })
          .limit(40),
      ),
      this.safeRows("quality_capa_cases", (q) =>
        q
          .eq("tenant_id", tenantId)
          .lt("due_date", today)
          .not("status", "in", "(EFFECTIVE,CANCELLED)")
          .order("due_date")
          .limit(40),
      ),
      this.safeRows("plant_maintenance_work_orders", (q) =>
        q
          .eq("tenant_id", tenantId)
          .lt("planned_date", today)
          .in("status", ["OPEN", "IN_PROGRESS"])
          .order("planned_date")
          .limit(40),
      ),
      this.safeRows("accounting_open_items", (q) =>
        q
          .eq("tenant_id", tenantId)
          .eq("direction", "RECEIVABLE")
          .lt("due_date", today)
          .in("status", ["OPEN", "PARTIAL"])
          .order("due_date")
          .limit(60),
      ),
      this.safeRows("accounting_bank_transactions", (q) =>
        q
          .eq("tenant_id", tenantId)
          .eq("reconciliation_status", "UNMATCHED")
          .order("transaction_date")
          .limit(60),
      ),
      this.safeRows("sales_orders", (q) =>
        q
          .eq("tenant_id", tenantId)
          .lt("expected_delivery_date", today)
          .order("expected_delivery_date")
          .limit(60),
      ),
      this.safeRows("purchase_orders", (q) =>
        q
          .eq("tenant_id", tenantId)
          .lt("delivery_date", today)
          .order("delivery_date")
          .limit(60),
      ),
      this.safeRows("production_orders", (q) =>
        q
          .eq("tenant_id", tenantId)
          .lt("end_date", today)
          .order("end_date")
          .limit(60),
      ),
    ]);

    const decisions: CrossModuleDecision[] = [];
    const add = (
      decision: Omit<
        CrossModuleDecision,
        "priority_score" | "action_mode" | "source"
      > & { overdue_days?: number; compliance?: boolean },
    ) => {
      const { overdue_days = 0, compliance = false, ...rest } = decision;
      decisions.push({
        ...rest,
        priority_score: this.score(
          rest.severity,
          rest.financial_impact_value || 0,
          overdue_days,
          compliance,
        ),
        action_mode: "REVIEW_ONLY",
        source: "LIVE_ERP_CROSS_MODULE",
      });
    };

    for (const row of machineAlerts) {
      const severity = this.severity(row.severity, "HIGH");
      const amount = this.money(
        row.details?.estimated_financial_exposure ||
          row.details?.financial_impact,
      );
      add({
        id: `machine-alert:${row.id}`,
        title:
          row.title ||
          `Machine ${row.alert_type || "condition"} requires attention`,
        domain: "MAINTENANCE",
        severity,
        explanation: `Machine signal ${row.alert_type || "anomaly"} is open. ${row.details?.reason || row.details?.message || "Inspect the recorded telemetry before the next production run."}`,
        recommended_action:
          "Inspect the machine evidence and create a governed maintenance work order when intervention is required.",
        impact: this.impact(amount, "Estimated exposure"),
        financial_impact_value: amount || null,
        route: "/dashboard/production/autonomy",
        forward_risk: {
          horizon: "Before the next production run",
          confidence: row.event_id ? "HIGH" : "MEDIUM",
          basis: row.event_id
            ? "An open alert is linked to recorded machine telemetry."
            : "The open machine alert has no linked telemetry event.",
        },
        evidence: {
          source_table: "production_machine_alerts",
          source_id: row.id,
          work_station_id: row.work_station_id,
          event_id: row.event_id,
          details: row.details || {},
        },
      });
    }

    for (const row of productionExceptions) {
      const severity = this.severity(row.severity, "HIGH");
      add({
        id: `production-exception:${row.id}`,
        title: String(row.exception_type || "Production exception").replaceAll(
          "_",
          " ",
        ),
        domain: "PRODUCTION",
        severity,
        explanation:
          row.recommendation ||
          "A production-control exception requires review.",
        recommended_action:
          row.recommendation ||
          "Review the affected work station and record the controlled disposition.",
        impact: null,
        financial_impact_value: null,
        route: "/dashboard/production/autonomy",
        forward_risk: {
          horizon: "Current production shift",
          confidence: row.source_id ? "HIGH" : "MEDIUM",
          basis: "An unresolved production-autonomy exception is recorded.",
        },
        evidence: {
          source_table: "production_autonomy_exceptions",
          source_id: row.id,
          source_type: row.source_type,
          source_record_id: row.source_id,
          work_station_id: row.work_station_id,
        },
      });
    }

    for (const row of qualityAlerts) {
      const severity = this.severity(row.severity, "HIGH");
      add({
        id: `quality-alert:${row.id}`,
        title: row.title || "Quality exception",
        domain: "QUALITY",
        severity,
        explanation:
          row.description ||
          `Open quality signal: ${row.alert_type || "exception"}.`,
        recommended_action:
          "Review affected inspection/NCR evidence, contain suspect material and assign corrective action.",
        impact: null,
        financial_impact_value: null,
        route: "/dashboard/quality",
        forward_risk: {
          horizon: "Before material or product release",
          confidence: row.reference_id ? "HIGH" : "MEDIUM",
          basis: row.reference_id
            ? "The alert links to a recorded quality source."
            : "The alert requires source-record validation.",
        },
        evidence: {
          source_table: "quality_alerts",
          source_id: row.id,
          reference_type: row.reference_type,
          reference_id: row.reference_id,
          alert_type: row.alert_type,
        },
        compliance: severity === "CRITICAL",
      });
    }

    for (const row of capas) {
      const overdue = this.daysLate(row.due_date);
      const amount = this.money(row.failure_cost || row.supplier_claim_amount);
      const severity = this.severity(
        row.severity,
        overdue > 14 ? "HIGH" : "MEDIUM",
      );
      add({
        id: `capa-overdue:${row.id}`,
        title: `CAPA ${row.capa_number || ""} is ${overdue} day(s) overdue`,
        domain: "QUALITY",
        severity,
        explanation:
          row.title ||
          row.problem_statement ||
          "Corrective action has passed its due date.",
        recommended_action:
          "Escalate the CAPA owner, verify containment and record effectiveness evidence.",
        impact: this.impact(amount, "Recorded failure/claim exposure"),
        financial_impact_value: amount || null,
        route: "/dashboard/quality/capa",
        forward_risk: {
          horizon: "Immediate compliance review",
          confidence: "HIGH",
          basis:
            "The recorded CAPA due date has passed and its status is not effective or cancelled.",
        },
        evidence: {
          source_table: "quality_capa_cases",
          source_id: row.id,
          due_date: row.due_date,
          status: row.status,
          vendor_id: row.vendor_id,
        },
        overdue_days: overdue,
        compliance: true,
      });
    }

    for (const row of maintenance) {
      const overdue = this.daysLate(row.planned_date);
      const severity = this.severity(
        row.priority,
        overdue > 7 ? "HIGH" : "MEDIUM",
      );
      add({
        id: `maintenance-overdue:${row.id}`,
        title: `${row.work_order_number || "Maintenance work order"} is overdue`,
        domain: "MAINTENANCE",
        severity,
        explanation: `Planned maintenance is ${overdue} day(s) overdue for an active asset.`,
        recommended_action:
          "Assign the technician and complete or formally reschedule the maintenance work order.",
        impact: null,
        financial_impact_value: null,
        route: "/dashboard/production/maintenance",
        forward_risk: {
          horizon: "Before continued machine operation",
          confidence: "HIGH",
          basis:
            "The planned date has passed while the work order remains open.",
        },
        evidence: {
          source_table: "plant_maintenance_work_orders",
          source_id: row.id,
          asset_id: row.asset_id,
          work_type: row.work_type,
          planned_date: row.planned_date,
        },
        overdue_days: overdue,
        compliance: row.priority === "CRITICAL",
      });
    }

    const receivableTotal = openItems.reduce(
      (sum, row) =>
        sum +
        Math.max(
          0,
          this.money(row.original_amount) - this.money(row.settled_amount),
        ),
      0,
    );
    if (openItems.length) {
      const oldest = Math.max(
        ...openItems.map((row) => this.daysLate(row.due_date)),
      );
      add({
        id: `overdue-receivables:${openItems
          .map((row) => row.id)
          .sort()
          .join(":")
          .slice(0, 180)}`,
        title: `${openItems.length} overdue receivable(s) require collection action`,
        domain: "FINANCE",
        severity: oldest > 30 || receivableTotal > 100000 ? "HIGH" : "MEDIUM",
        explanation: `${receivableTotal.toFixed(2)} remains outstanding; the oldest item is ${oldest} day(s) overdue.`,
        recommended_action:
          "Prioritise the oldest/highest-value items and create controlled collection follow-ups.",
        impact: this.impact(receivableTotal, "Overdue cash"),
        financial_impact_value: receivableTotal,
        route: "/dashboard/accounts/collections",
        forward_risk: {
          horizon: "Current collection cycle",
          confidence: "HIGH",
          basis:
            "Calculated from open receivable documents and recorded due dates.",
        },
        evidence: {
          source_table: "accounting_open_items",
          open_item_ids: openItems.map((row) => row.id),
          oldest_days: oldest,
          currency_codes: Array.from(
            new Set(openItems.map((row) => row.currency_code)),
          ),
        },
        overdue_days: oldest,
      });
    }

    const unmatchedTotal = bankTransactions.reduce(
      (sum, row) => sum + this.money(row.amount),
      0,
    );
    if (bankTransactions.length) {
      const oldest = Math.max(
        ...bankTransactions.map((row) => this.daysLate(row.transaction_date)),
      );
      add({
        id: `bank-unmatched:${bankTransactions
          .map((row) => row.id)
          .sort()
          .join(":")
          .slice(0, 180)}`,
        title: `${bankTransactions.length} bank transaction(s) remain unmatched`,
        domain: "FINANCE",
        severity: oldest > 14 ? "HIGH" : "MEDIUM",
        explanation: `${unmatchedTotal.toFixed(2)} of imported bank activity requires reconciliation or documented exclusion.`,
        recommended_action:
          "Review matching suggestions and complete independent bank reconciliation.",
        impact: this.impact(unmatchedTotal, "Unmatched bank movement"),
        financial_impact_value: unmatchedTotal,
        route: "/dashboard/accounts/bank-reconciliation",
        forward_risk: {
          horizon: "Before the next close or payment run",
          confidence: "HIGH",
          basis:
            "Calculated from bank transactions explicitly marked UNMATCHED.",
        },
        evidence: {
          source_table: "accounting_bank_transactions",
          transaction_ids: bankTransactions.map((row) => row.id),
          oldest_days: oldest,
        },
        overdue_days: oldest,
        compliance: oldest > 30,
      });
    }

    const closedSales = new Set([
      "COMPLETED",
      "CANCELLED",
      "CLOSED",
      "DELIVERED",
    ]);
    for (const row of salesOrders.filter(
      (entry) => !closedSales.has(String(entry.status || "").toUpperCase()),
    )) {
      const overdue = this.daysLate(row.expected_delivery_date);
      const amount = this.money(row.net_amount || row.total_amount);
      add({
        id: `sales-delivery-risk:${row.id}`,
        title: `${row.so_number || "Sales order"} is past expected delivery`,
        domain: "SALES",
        severity: overdue > 7 || amount > 100000 ? "HIGH" : "MEDIUM",
        explanation: `The order is ${overdue} day(s) past expected delivery and remains ${row.status || "open"}.`,
        recommended_action:
          "Review production/material availability and assign a customer delivery recovery action.",
        impact: this.impact(amount, "Order value at risk"),
        financial_impact_value: amount || null,
        route: "/dashboard/sales?tab=orders",
        forward_risk: {
          horizon: "Customer commitment already due",
          confidence: "HIGH",
          basis:
            "The recorded expected delivery date has passed and the order is not closed.",
        },
        evidence: {
          source_table: "sales_orders",
          source_id: row.id,
          customer_id: row.customer_id,
          expected_delivery_date: row.expected_delivery_date,
          status: row.status,
        },
        overdue_days: overdue,
      });
    }

    const closedPurchases = new Set([
      "COMPLETED",
      "CANCELLED",
      "CLOSED",
      "RECEIVED",
    ]);
    for (const row of purchaseOrders.filter(
      (entry) => !closedPurchases.has(String(entry.status || "").toUpperCase()),
    )) {
      const overdue = this.daysLate(row.delivery_date);
      const amount = this.money(row.grand_total || row.total_amount);
      add({
        id: `supplier-delay:${row.id}`,
        title: `${row.po_number || "Purchase order"} is past supplier delivery`,
        domain: "PROCUREMENT",
        severity: overdue > 7 ? "HIGH" : "MEDIUM",
        explanation: `The supplier commitment is ${overdue} day(s) overdue and the PO remains ${row.status || "open"}.`,
        recommended_action:
          "Confirm supplier recovery date and evaluate affected production requirements.",
        impact: this.impact(amount, "Purchase exposure"),
        financial_impact_value: amount || null,
        route: "/dashboard/purchase/orders",
        forward_risk: {
          horizon: "Current replenishment cycle",
          confidence: "HIGH",
          basis:
            "The PO delivery date has passed and its recorded status is still open.",
        },
        evidence: {
          source_table: "purchase_orders",
          source_id: row.id,
          vendor_id: row.vendor_id,
          delivery_date: row.delivery_date,
          status: row.status,
        },
        overdue_days: overdue,
      });
    }

    const closedProduction = new Set(["COMPLETED", "CANCELLED", "CLOSED"]);
    for (const row of productionOrders.filter(
      (entry) =>
        !closedProduction.has(String(entry.status || "").toUpperCase()),
    )) {
      const overdue = this.daysLate(row.end_date);
      const shortfall = Math.max(
        0,
        this.money(row.quantity) - this.money(row.produced_quantity),
      );
      add({
        id: `production-delay:${row.id}`,
        title: `${row.order_number || "Production order"} is behind plan`,
        domain: "PRODUCTION",
        severity: overdue > 3 ? "HIGH" : "MEDIUM",
        explanation: `The planned end date is ${overdue} day(s) overdue with ${shortfall.toFixed(3)} quantity not recorded as produced.`,
        recommended_action:
          "Review material, capacity, machine and quality constraints before controlled rescheduling.",
        impact:
          shortfall > 0 ? `Quantity shortfall: ${shortfall.toFixed(3)}` : null,
        financial_impact_value: null,
        route: "/dashboard/production/job-orders",
        forward_risk: {
          horizon: "Current production plan",
          confidence: "HIGH",
          basis:
            "The planned end date has passed and the production order is not closed.",
        },
        evidence: {
          source_table: "production_orders",
          source_id: row.id,
          item_id: row.item_id,
          end_date: row.end_date,
          status: row.status,
          quantity: row.quantity,
          produced_quantity: row.produced_quantity,
        },
        overdue_days: overdue,
      });
    }

    return decisions
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, 200);
  }
}
