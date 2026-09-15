import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AiProviderService } from "../ai/ai-provider.service";

type QueryBuilder = ReturnType<SupabaseClient["from"]>;

type DashboardMetric = {
  key: string;
  label: string;
  value: number;
  displayValue?: string;
  tone: "neutral" | "good" | "warning" | "danger";
  route?: string;
  helper?: string;
};

type DashboardException = {
  type: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "danger";
  route: string;
  value?: string;
};

type RoiOpportunity = {
  key: string;
  area: string;
  title: string;
  action: string;
  impact: string;
  priority: "high" | "medium" | "low";
  count: number;
  amount?: number;
  route: string;
};

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

@Injectable()
export class DashboardService {
  private supabase: SupabaseClient;
  private aiEnabled = false;
  private readonly cockpitCache = new Map<
    string,
    { expiresAt: number; value: any }
  >();
  private readonly cockpitInFlight = new Map<string, Promise<any>>();
  private readonly cockpitCacheTtlMs = 30_000;

  constructor(
    private configService: ConfigService,
    private readonly ai: AiProviderService,
  ) {
    this.supabase = createClient(
      this.configService.get<string>("SUPABASE_URL") ||
        process.env.SUPABASE_URL!,
      this.configService.get<string>("SUPABASE_KEY") ||
        process.env.SUPABASE_KEY!,
    );

    this.aiEnabled = this.ai.isEnabled();
  }

  private formatMoney(value: number): string {
    return INR.format(Math.round(Number.isFinite(value) ? value : 0));
  }

  private n(value: unknown): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  private sum(rows: any[] | null | undefined, keys: string[]): number {
    return (rows || []).reduce((total, row) => {
      const key = keys.find((k) => row?.[k] !== undefined && row?.[k] !== null);
      return total + (key ? this.n(row[key]) : 0);
    }, 0);
  }

  private daysOld(value: unknown): number {
    if (!value) return 0;
    const time = new Date(String(value)).getTime();
    if (!Number.isFinite(time)) return 0;
    return Math.floor((Date.now() - time) / 86_400_000);
  }

  private applyFilters(
    query: QueryBuilder,
    filters: Record<string, any>,
  ): QueryBuilder {
    let q = query;
    Object.entries(filters).forEach(([key, value]) => {
      if (Array.isArray(value)) q = q.in(key, value);
      else if (value !== undefined) q = q.eq(key, value);
    });
    return q;
  }

  private async safeCount(
    table: string,
    tenantId: string,
    filters: Record<string, any> = {},
  ): Promise<number> {
    try {
      const query = this.applyFilters(
        this.supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
        filters,
      );
      const { count, error } = await query;
      if (error) return 0;
      return count || 0;
    } catch {
      return 0;
    }
  }

  private async safeRows(
    table: string,
    tenantId: string,
    filters: Record<string, any> = {},
    limit = 250,
    order = "created_at",
  ): Promise<any[]> {
    try {
      let query = this.applyFilters(
        this.supabase.from(table).select("*").eq("tenant_id", tenantId),
        filters,
      );
      query = query.order(order, { ascending: false }).limit(limit);
      const { data, error } = await query;
      if (error) return [];
      return data || [];
    } catch {
      return [];
    }
  }

  async getReminderQueue(tenantId: string) {
    const poSelection =
      "id, po_number, created_at, po_date, total_amount, status, vendor:vendors(id, name)";
    const [statusPoResult, workflowPoResult, qcResult] = await Promise.all([
      this.supabase
        .from("purchase_orders")
        .select(poSelection)
        .eq("tenant_id", tenantId)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false }),
      this.supabase
        .from("purchase_orders")
        .select(poSelection)
        .eq("tenant_id", tenantId)
        .eq("pr_po_status", "PENDING")
        .order("created_at", { ascending: false }),
      this.supabase
        .from("grns")
        .select(
          "id, grn_number, created_at, receipt_date, status, qc_completed, purchase_order:purchase_orders(id, po_number), vendor:vendors(id, name)",
        )
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .eq("qc_completed", false)
        .order("created_at", { ascending: false }),
    ]);

    const pendingPOs = [
      ...(statusPoResult.data || []),
      ...(workflowPoResult.error ? [] : workflowPoResult.data || []),
    ].filter(
      (row, index, rows) =>
        rows.findIndex((candidate) => candidate.id === row.id) === index,
    );

    return {
      pendingPOs: statusPoResult.error ? [] : pendingPOs,
      pendingQC: qcResult.error ? [] : qcResult.data || [],
    };
  }

  async getStats(tenantId: string) {
    const cockpit = await this.getCockpit(tenantId);
    return {
      activeOrders: cockpit.summary.sales.activeOrders,
      pendingPOs: cockpit.summary.procurement.pendingPOs,
      inProduction: cockpit.summary.production.inProgress,
      readyToShip: cockpit.summary.sales.readyToShip,
      lowStockCount: cockpit.summary.inventory.lowStock,
    };
  }

  async getCockpit(tenantId: string) {
    const cached = this.cockpitCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const inFlight = this.cockpitInFlight.get(tenantId);
    if (inFlight) return inFlight;

    const request = this.buildCockpit(tenantId)
      .then((value) => {
        this.cockpitCache.set(tenantId, {
          expiresAt: Date.now() + this.cockpitCacheTtlMs,
          value,
        });
        return value;
      })
      .finally(() => this.cockpitInFlight.delete(tenantId));

    this.cockpitInFlight.set(tenantId, request);
    return request;
  }

  private async buildCockpit(tenantId: string) {
    const [
      reminderQueue,
      pendingPRs,
      draftPRs,
      approvedPOs,
      completedGRNs,
      vendorPendingApproval,
      activeVendors,
      verifiedVendors,
      activeItems,
      pendingItemVerification,
      lowStock,
      openDebitNotes,
      jobOrdersOpen,
      jobOrdersInProgress,
      activeSalesOrders,
      readyToShip,
      uidPendingQc,
      purchaseOrders,
      grns,
      advances,
      vendorAdvances,
      inventoryAlerts,
      recentPRs,
      recentPOs,
      recentGRNs,
      quotations,
      salesInvoices,
      serviceTickets,
      serviceVisits,
    ] = await Promise.all([
      this.getReminderQueue(tenantId),
      this.safeCount("purchase_requisitions", tenantId, {
        status: ["SUBMITTED", "PENDING"],
      }),
      this.safeCount("purchase_requisitions", tenantId, { status: "DRAFT" }),
      this.safeCount("purchase_orders", tenantId, { status: "APPROVED" }),
      this.safeCount("grns", tenantId, { status: "COMPLETED" }),
      this.safeCount("vendors", tenantId, {
        approval_status: ["PENDING", "PENDING_APPROVAL"],
      }),
      this.safeCount("vendors", tenantId, { is_active: true }),
      this.safeCount("vendors", tenantId, { is_verified: true }),
      this.safeCount("items", tenantId, { is_active: true }),
      this.safeCount("items", tenantId, { is_verified: false }),
      this.safeCount("inventory_alerts", tenantId, { acknowledged: false }),
      this.safeCount("debit_notes", tenantId, {
        status: ["DRAFT", "PENDING", "APPROVED"],
      }),
      this.safeCount("production_job_orders", tenantId, {
        status: ["DRAFT", "PENDING", "RELEASED"],
      }),
      this.safeCount("production_job_orders", tenantId, {
        status: ["IN_PROGRESS", "STARTED"],
      }),
      this.safeCount("sales_orders", tenantId, {
        status: ["PENDING", "CONFIRMED", "IN_PRODUCTION"],
      }),
      this.safeCount("sales_orders", tenantId, { status: "READY_TO_SHIP" }),
      this.safeCount("uid_registry", tenantId, { quality_status: "PENDING" }),
      this.safeRows("purchase_orders", tenantId, {}, 250),
      this.safeRows("grns", tenantId, {}, 250),
      this.safeRows("po_advance_payments", tenantId, {}, 250),
      this.safeRows("vendor_advance_balances", tenantId, {}, 250),
      this.safeRows("inventory_alerts", tenantId, { acknowledged: false }, 10),
      this.safeRows("purchase_requisitions", tenantId, {}, 8),
      this.safeRows("purchase_orders", tenantId, {}, 8),
      this.safeRows("grns", tenantId, {}, 8),
      this.safeRows("quotations", tenantId, {}, 250),
      this.safeRows("sales_invoices", tenantId, {}, 250),
      this.safeRows("service_tickets", tenantId, {}, 250),
      this.safeRows("service_site_visits", tenantId, {}, 250),
    ]);

    const pendingPOs = reminderQueue.pendingPOs.length;
    const draftGRNs = reminderQueue.pendingQC.length;

    const poValue = this.sum(purchaseOrders, [
      "rounded_total_amount",
      "total_amount",
      "grand_total",
    ]);
    const openPOValue = this.sum(
      purchaseOrders.filter((po) =>
        ["PENDING", "APPROVED", "PARTIAL"].includes(
          String(po.pr_po_status || po.status || "").toUpperCase(),
        ),
      ),
      ["rounded_total_amount", "total_amount", "grand_total"],
    );
    const invoicedValue = this.sum(grns, [
      "net_payable_rounded",
      "net_payable",
      "total_amount",
    ]);
    const advancePaid =
      this.sum(advances, [
        "available_amount",
        "balance_amount",
        "amount",
        "advance_amount",
      ]) +
      this.sum(vendorAdvances, [
        "available_amount",
        "balance_amount",
        "amount",
      ]);

    const quoteOpenStatuses = new Set([
      "DRAFT",
      "SENT",
      "SUBMITTED",
      "PENDING",
      "FOLLOW_UP",
      "REVISED",
    ]);
    const openQuotations = quotations.filter((row: any) =>
      quoteOpenStatuses.has(String(row.status || "").toUpperCase()),
    );
    const quoteValue = this.sum(openQuotations, [
      "net_amount",
      "total_amount",
      "grand_total",
      "rounded_total_amount",
    ]);
    const weightedQuoteValue = openQuotations.reduce(
      (total: number, row: any) => {
        const value = this.n(
          row.net_amount ??
            row.total_amount ??
            row.grand_total ??
            row.rounded_total_amount,
        );
        const probability = Math.min(
          100,
          Math.max(
            0,
            this.n(
              row.probability ??
                row.win_probability ??
                row.conversion_probability,
            ) || 50,
          ),
        );
        return total + (value * probability) / 100;
      },
      0,
    );
    const invoiceOpenStatuses = new Set([
      "POSTED",
      "PARTIALLY_PAID",
      "PENDING",
      "APPROVED",
      "DUE",
      "OVERDUE",
    ]);
    const openSalesInvoices = salesInvoices.filter(
      (row: any) =>
        invoiceOpenStatuses.has(String(row.status || "").toUpperCase()) ||
        this.n(row.balance_amount || row.outstanding_amount) > 0,
    );
    const receivables = this.sum(openSalesInvoices, [
      "balance_amount",
      "outstanding_amount",
      "due_amount",
      "net_amount",
      "total_amount",
    ]);
    const activeServiceStatuses = new Set([
      "OPEN",
      "ASSIGNED",
      "IN_PROGRESS",
      "PENDING",
      "SCHEDULED",
      "REOPENED",
    ]);
    const openServiceTickets = serviceTickets.filter((row: any) =>
      activeServiceStatuses.has(String(row.status || "").toUpperCase()),
    );
    const activeVisits = serviceVisits.filter((row: any) =>
      activeServiceStatuses.has(String(row.status || "").toUpperCase()),
    );
    const now = Date.now();
    const sevenDays = now + 7 * 86_400_000;
    const expiringQuotations = openQuotations.filter((row: any) => {
      const expiry = new Date(
        String(row.valid_until || row.expiry_date || ""),
      ).getTime();
      return Number.isFinite(expiry) && expiry >= now && expiry <= sevenDays;
    });
    const overdueReceivables = openSalesInvoices.filter((row: any) => {
      const due = new Date(
        String(row.due_date || row.payment_due_date || ""),
      ).getTime();
      return Number.isFinite(due) && due < now;
    });
    const overdueServiceTickets = openServiceTickets.filter((row: any) => {
      const due = new Date(
        String(
          row.sla_due_at || row.due_at || row.expected_resolution_at || "",
        ),
      ).getTime();
      return Number.isFinite(due) && due < now;
    });
    const warrantyServiceTickets = openServiceTickets.filter(
      (row: any) =>
        row.is_under_warranty === true ||
        ["WARRANTY", "UNDER_WARRANTY", "CONTRACT"].includes(
          String(row.entitlement_status || "").toUpperCase(),
        ),
    );

    const exceptions: DashboardException[] = [];

    if (pendingPRs > 0) {
      exceptions.push({
        type: "Approval",
        title: `${pendingPRs} PR waiting for approval`,
        detail:
          "Purchase requisitions should be approved before sourcing or PO creation.",
        severity: pendingPRs > 5 ? "danger" : "warning",
        route: "/dashboard/purchase/requisitions",
      });
    }

    if (pendingPOs > 0) {
      exceptions.push({
        type: "Approval",
        title: `${pendingPOs} PO waiting for approval`,
        detail:
          "Pending PO commitments need manager action before supplier release.",
        severity: pendingPOs > 3 ? "danger" : "warning",
        route: "/dashboard/purchase/orders",
        value: this.formatMoney(openPOValue),
      });
    }

    if (draftGRNs > 0) {
      exceptions.push({
        type: "GRN/QC",
        title: `${draftGRNs} GRN pending QC or posting`,
        detail:
          "Open goods receipts should be accepted/rejected to keep stock and AP aligned.",
        severity: "warning",
        route: "/dashboard/purchase/grn",
      });
    }

    if (lowStock > 0) {
      exceptions.push({
        type: "Inventory",
        title: `${lowStock} low stock alert`,
        detail: "Review reorder exposure and open procurement coverage.",
        severity: "danger",
        route: "/dashboard/inventory/items",
      });
    }

    if (pendingItemVerification > 0) {
      exceptions.push({
        type: "Master Data",
        title: `${pendingItemVerification} item pending verification`,
        detail:
          "Unverified material master records can affect procurement and production accuracy.",
        severity: "warning",
        route: "/dashboard/inventory/items",
      });
    }

    if (vendorPendingApproval > 0) {
      exceptions.push({
        type: "Master Data",
        title: `${vendorPendingApproval} vendor pending approval`,
        detail: "Maker-checker approval is needed before vendor use.",
        severity: "warning",
        route: "/dashboard/purchase/vendors",
      });
    }

    inventoryAlerts.slice(0, 4).forEach((alert: any) => {
      exceptions.push({
        type: "Inventory",
        title: String(alert.title || alert.item_code || "Inventory alert"),
        detail: String(
          alert.message || alert.description || "Stock needs review.",
        ),
        severity: "warning",
        route: "/dashboard/inventory/items",
      });
    });

    const activity = [
      ...recentPRs.map((row: any) => ({
        type: "PR",
        number: row.pr_number || row.number || "-",
        status: row.status || "-",
        date: row.created_at || row.request_date,
        route: "/dashboard/purchase/requisitions",
      })),
      ...recentPOs.map((row: any) => ({
        type: "PO",
        number: row.po_number || row.number || "-",
        status: row.pr_po_status || row.status || "-",
        amount: this.n(row.rounded_total_amount ?? row.total_amount),
        date: row.created_at || row.order_date,
        route: "/dashboard/purchase/orders",
      })),
      ...recentGRNs.map((row: any) => ({
        type: "GRN",
        number: row.grn_number || row.number || "-",
        status: row.status || "-",
        amount: this.n(
          row.net_payable_rounded ?? row.net_payable ?? row.total_amount,
        ),
        date: row.created_at || row.receipt_date,
        route: "/dashboard/purchase/grn",
      })),
    ]
      .sort(
        (a, b) =>
          new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
      )
      .slice(0, 12);

    const metrics: DashboardMetric[] = [
      {
        key: "approvals",
        label: "Approvals Pending",
        value: pendingPRs + pendingPOs + vendorPendingApproval,
        tone:
          pendingPRs + pendingPOs + vendorPendingApproval > 0
            ? "warning"
            : "good",
        route: "/dashboard/manager",
        helper: "PR, PO, vendor maker-checker",
      },
      {
        key: "poExposure",
        label: "Open PO Exposure",
        value: openPOValue,
        displayValue: this.formatMoney(openPOValue),
        tone: "neutral",
        route: "/dashboard/purchase/orders",
        helper: "Approved/pending purchase commitment",
      },
      {
        key: "invoiced",
        label: "Supplier Invoice Value",
        value: invoicedValue,
        displayValue: this.formatMoney(invoicedValue),
        tone: "neutral",
        route: "/dashboard/accounts/supplier-invoices",
        helper: "Latest GRN invoice exposure",
      },
      {
        key: "advance",
        label: "Advance Balance",
        value: advancePaid,
        displayValue: this.formatMoney(advancePaid),
        tone: advancePaid > 0 ? "warning" : "neutral",
        route: "/dashboard/accounts/payables",
        helper: "PO/vendor advance available for adjustment",
      },
      {
        key: "stockRisk",
        label: "Stock Risk",
        value: lowStock + pendingItemVerification,
        tone:
          lowStock > 0
            ? "danger"
            : pendingItemVerification > 0
              ? "warning"
              : "good",
        route: "/dashboard/inventory/items",
        helper: "Low stock plus unverified material master",
      },
      {
        key: "wip",
        label: "Production WIP",
        value: jobOrdersOpen + jobOrdersInProgress,
        tone: "neutral",
        route: "/dashboard/production/job-orders",
        helper: "Open and in-progress job orders",
      },
    ];

    const roiOpportunities: RoiOpportunity[] = [
      pendingPRs + pendingPOs > 0
        ? {
            key: "approval-cycle",
            area: "Cash / Procurement",
            title: "Release blocked purchase decisions",
            action: `Clear ${pendingPRs + pendingPOs} approval queue item(s) to avoid supplier and production delay.`,
            impact:
              openPOValue > 0
                ? `${this.formatMoney(openPOValue)} of purchase exposure is waiting for control.`
                : "Shorten approval-to-order cycle time.",
            priority: "high",
            count: pendingPRs + pendingPOs,
            amount: openPOValue,
            route: "/dashboard/manager",
          }
        : null,
      draftGRNs > 0
        ? {
            key: "grn-qc-ap",
            area: "Inventory / Finance",
            title: "Close receipt and QC exceptions",
            action: `Complete ${draftGRNs} pending GRN/QC item(s) so stock and payables agree.`,
            impact:
              "Prevent stock understatement, invoice mismatch and delayed supplier settlement.",
            priority: "high",
            count: draftGRNs,
            route: "/dashboard/purchase/grn",
          }
        : null,
      advancePaid > 0
        ? {
            key: "advance-recovery",
            area: "Cash",
            title: "Recover supplier advances",
            action:
              "Match open advances against approved receipts and invoices before the next payment run.",
            impact: `${this.formatMoney(advancePaid)} is available for adjustment or reconciliation.`,
            priority: "high",
            count: 1,
            amount: advancePaid,
            route: "/dashboard/accounts/payables",
          }
        : null,
      lowStock > 0
        ? {
            key: "stockout-risk",
            area: "Supply Chain",
            title: "Protect production from stockouts",
            action: `Review ${lowStock} low-stock alert(s) against open demand and incoming supply.`,
            impact: "Prevent line stoppage and emergency purchasing.",
            priority: "high",
            count: lowStock,
            route: "/dashboard/inventory/items",
          }
        : null,
      jobOrdersOpen + jobOrdersInProgress > 0
        ? {
            key: "wip-flow",
            area: "Production",
            title: "Accelerate open production WIP",
            action: `Review ${jobOrdersOpen + jobOrdersInProgress} open/in-progress job order(s) for material, QC or capacity blockers.`,
            impact: "Reduce WIP days and protect promised delivery dates.",
            priority: "medium",
            count: jobOrdersOpen + jobOrdersInProgress,
            route: "/dashboard/production/job-orders",
          }
        : null,
      openQuotations.length > 0
        ? {
            key: "sales-pipeline",
            area: "Sales",
            title: "Convert open quotation pipeline",
            action: `Follow up ${openQuotations.length} open quotation(s) and close the next-best opportunities.`,
            impact:
              quoteValue > 0
                ? `${this.formatMoney(quoteValue)} of quoted value is still open.`
                : "Improve quote-to-order conversion and response speed.",
            priority: "medium",
            count: openQuotations.length,
            amount: quoteValue,
            route: "/dashboard/sales",
          }
        : null,
      receivables > 0
        ? {
            key: "sales-collections",
            area: "Sales / Cash",
            title: "Accelerate customer collections",
            action: `Review ${openSalesInvoices.length} open customer invoice(s) and trigger collection follow-ups.`,
            impact: `${this.formatMoney(receivables)} is currently exposed in customer receivables.`,
            priority: "high",
            count: openSalesInvoices.length,
            amount: receivables,
            route: "/dashboard/sales",
          }
        : null,
      openServiceTickets.length > 0
        ? {
            key: "service-backlog",
            area: "Service",
            title: "Reduce service backlog and SLA risk",
            action: `Assign and progress ${openServiceTickets.length} active service ticket(s)${activeVisits.length ? ` across ${activeVisits.length} visit(s)` : ""}.`,
            impact:
              "Protect contract renewals, customer satisfaction and billable technician capacity.",
            priority: "high",
            count: openServiceTickets.length,
            route: "/dashboard/service",
          }
        : null,
      overdueServiceTickets.length > 0
        ? {
            key: "service-sla",
            area: "Service / SLA",
            title: "Recover overdue service commitments",
            action: `${overdueServiceTickets.length} active ticket(s) are past their SLA or promised resolution date.`,
            impact:
              "Prevent escalation, credits and renewal risk by assigning an owner and next action today.",
            priority: "high",
            count: overdueServiceTickets.length,
            route: "/dashboard/service",
          }
        : null,
      expiringQuotations.length > 0
        ? {
            key: "quote-expiry",
            area: "Sales",
            title: "Protect quotations from expiry",
            action: `${expiringQuotations.length} quotation(s) expire within the next seven days; send a reminder or revise them now.`,
            impact:
              "Prevent silent pipeline loss and preserve customer response momentum.",
            priority: "high",
            count: expiringQuotations.length,
            route: "/dashboard/sales",
          }
        : null,
      overdueReceivables.length > 0
        ? {
            key: "overdue-receivables",
            area: "Cash / Sales",
            title: "Escalate overdue customer invoices",
            action: `${overdueReceivables.length} customer invoice(s) are past their due date; assign collection owners and next-contact dates.`,
            impact:
              "Reduce DSO and improve cash conversion without increasing sales volume.",
            priority: "high",
            count: overdueReceivables.length,
            amount: this.sum(overdueReceivables, [
              "balance_amount",
              "outstanding_amount",
              "due_amount",
              "net_amount",
              "total_amount",
            ]),
            route: "/dashboard/sales",
          }
        : null,
    ].filter(Boolean) as RoiOpportunity[];

    return {
      generatedAt: new Date().toISOString(),
      metrics,
      aiMis: this.buildRuleBasedMis(metrics, exceptions, {
        poValue,
        openPOValue,
        invoicedValue,
        advancePaid,
        pendingPRs,
        pendingPOs,
        draftGRNs,
        lowStock,
        pendingItemVerification,
        jobOrdersOpen,
        jobOrdersInProgress,
      }),
      summary: {
        procurement: {
          pendingPRs,
          draftPRs,
          pendingPOs,
          approvedPOs,
          poValue,
          openPOValue,
        },
        inventory: {
          activeItems,
          pendingItemVerification,
          lowStock,
          completedGRNs,
          draftGRNs,
          uidPendingQc,
        },
        accounts: { invoicedValue, advancePaid, openDebitNotes },
        production: { open: jobOrdersOpen, inProgress: jobOrdersInProgress },
        sales: {
          activeOrders: activeSalesOrders,
          readyToShip,
          openQuotations: openQuotations.length,
          quoteValue,
          weightedQuoteValue,
          expiringQuotations: expiringQuotations.length,
          openInvoices: openSalesInvoices.length,
          overdueInvoices: overdueReceivables.length,
          receivables,
        },
        service: {
          openTickets: openServiceTickets.length,
          activeVisits: activeVisits.length,
          overdueTickets: overdueServiceTickets.length,
          warrantyTickets: warrantyServiceTickets.length,
        },
        vendors: {
          active: activeVendors,
          verified: verifiedVendors,
          pendingApproval: vendorPendingApproval,
        },
      },
      roiOpportunities,
      exceptions: exceptions.slice(0, 12),
      activity,
      aging: {
        purchaseOrders: this.buildAging(purchaseOrders, [
          "PENDING",
          "APPROVED",
          "PARTIAL",
        ]),
        grns: this.buildAging(grns, ["DRAFT", "PENDING"]),
      },
      moduleHealth: [
        {
          module: "Procurement",
          status: pendingPRs + pendingPOs > 0 ? "Action required" : "Healthy",
          route: "/dashboard/purchase",
        },
        {
          module: "Inventory",
          status:
            lowStock + pendingItemVerification > 0
              ? "Review needed"
              : "Healthy",
          route: "/dashboard/inventory/items",
        },
        {
          module: "Accounts Payable",
          status:
            advancePaid > 0 || openDebitNotes > 0 ? "Reconcile" : "Healthy",
          route: "/dashboard/accounts/payables",
        },
        {
          module: "Production",
          status: jobOrdersInProgress > 0 ? "In progress" : "Ready",
          route: "/dashboard/production/job-orders",
        },
        {
          module: "Quality",
          status:
            uidPendingQc + draftGRNs > 0 ? "Pending inspection" : "Healthy",
          route: "/dashboard/quality",
        },
      ],
    };
  }

  private buildAging(rows: any[], statuses: string[]) {
    const openRows = (rows || []).filter((row) =>
      statuses.includes(
        String(row.status || row.pr_po_status || "").toUpperCase(),
      ),
    );
    return {
      current: openRows.filter(
        (row) =>
          this.daysOld(row.created_at || row.order_date || row.receipt_date) <=
          7,
      ).length,
      d8to15: openRows.filter((row) => {
        const d = this.daysOld(
          row.created_at || row.order_date || row.receipt_date,
        );
        return d > 7 && d <= 15;
      }).length,
      d16to30: openRows.filter((row) => {
        const d = this.daysOld(
          row.created_at || row.order_date || row.receipt_date,
        );
        return d > 15 && d <= 30;
      }).length,
      over30: openRows.filter(
        (row) =>
          this.daysOld(row.created_at || row.order_date || row.receipt_date) >
          30,
      ).length,
    };
  }

  getFallbackCockpit(error?: unknown) {
    const metrics: DashboardMetric[] = [
      {
        key: "approvals",
        label: "Approvals Pending",
        value: 0,
        tone: "neutral",
        route: "/dashboard/manager",
        helper: "Fallback view; refresh after API recovery",
      },
      {
        key: "poExposure",
        label: "Open PO Exposure",
        value: 0,
        displayValue: this.formatMoney(0),
        tone: "neutral",
        route: "/dashboard/purchase/orders",
        helper: "Purchase commitment unavailable",
      },
      {
        key: "invoiced",
        label: "Supplier Invoice Value",
        value: 0,
        displayValue: this.formatMoney(0),
        tone: "neutral",
        route: "/dashboard/accounts/supplier-invoices",
        helper: "Supplier invoice exposure unavailable",
      },
      {
        key: "advance",
        label: "Advance Balance",
        value: 0,
        displayValue: this.formatMoney(0),
        tone: "neutral",
        route: "/dashboard/accounts/payables",
        helper: "Advance balance unavailable",
      },
      {
        key: "stockRisk",
        label: "Stock Risk",
        value: 0,
        tone: "neutral",
        route: "/dashboard/inventory/items",
        helper: "Stock risk unavailable",
      },
      {
        key: "wip",
        label: "Production WIP",
        value: 0,
        tone: "neutral",
        route: "/dashboard/production/job-orders",
        helper: "Production WIP unavailable",
      },
    ];

    const exceptions: DashboardException[] = [
      {
        type: "System",
        title: "Dashboard data fallback active",
        detail:
          "One or more dashboard report queries failed. Operational modules remain available from the sidebar.",
        severity: "warning",
        route: "/dashboard/reports",
        value: error instanceof Error ? error.message : undefined,
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      metrics,
      aiMis: this.buildRuleBasedMis(metrics, exceptions, {}),
      summary: {
        procurement: {
          pendingPRs: 0,
          draftPRs: 0,
          pendingPOs: 0,
          approvedPOs: 0,
          poValue: 0,
          openPOValue: 0,
        },
        inventory: {
          activeItems: 0,
          pendingItemVerification: 0,
          lowStock: 0,
          completedGRNs: 0,
          draftGRNs: 0,
          uidPendingQc: 0,
        },
        accounts: { invoicedValue: 0, advancePaid: 0, openDebitNotes: 0 },
        production: { open: 0, inProgress: 0 },
        sales: { activeOrders: 0, readyToShip: 0 },
        vendors: { active: 0, verified: 0, pendingApproval: 0 },
      },
      roiOpportunities: [],
      exceptions,
      activity: [],
      aging: {
        purchaseOrders: { current: 0, d8to15: 0, d16to30: 0, over30: 0 },
        grns: { current: 0, d8to15: 0, d16to30: 0, over30: 0 },
      },
      moduleHealth: [
        {
          module: "Procurement",
          status: "Open module",
          route: "/dashboard/purchase",
        },
        {
          module: "Inventory",
          status: "Open module",
          route: "/dashboard/inventory/items",
        },
        {
          module: "Accounts Payable",
          status: "Open module",
          route: "/dashboard/accounts/payables",
        },
        {
          module: "Production",
          status: "Open module",
          route: "/dashboard/production/job-orders",
        },
        {
          module: "Quality",
          status: "Open module",
          route: "/dashboard/quality",
        },
      ],
    };
  }

  async getReportCatalog(tenantId: string) {
    const cockpit = await this.getCockpit(tenantId);
    return {
      generatedAt: cockpit.generatedAt,
      managementReports: this.buildManagementReports(cockpit),
      aiMis: cockpit.aiMis,
      groups: [
        {
          name: "Management MIS",
          description:
            "Executive analysis packs for owners, directors and department heads.",
          reports: [
            {
              name: "Executive Daily MIS",
              route: "/dashboard/reports#ai-mis",
              format: "AI narrative, risks, decisions required",
              owner: "Management",
            },
            {
              name: "Purchase Exposure Analysis",
              route: "/dashboard/reports#management-reports",
              format: "PO exposure, pending approvals, GRN risk",
              owner: "Purchase Head",
            },
            {
              name: "Cash & Payables Outlook",
              route: "/dashboard/reports#management-reports",
              format: "Invoice exposure, advances, debit notes, payment focus",
              owner: "Finance Manager",
            },
            {
              name: "Inventory & Production Risk",
              route: "/dashboard/reports#management-reports",
              format: "Stock risk, WIP, QC bottlenecks, master-data gaps",
              owner: "Operations Head",
            },
          ],
        },
        {
          name: "Procurement",
          description: "PR, PO, vendor, GRN and supplier commitment reporting.",
          reports: [
            {
              name: "PR Approval Register",
              route: "/dashboard/purchase/requisitions",
              format: "List + status filters",
              owner: "Procurement Manager",
            },
            {
              name: "PO Commitment Register",
              route: "/dashboard/purchase/orders",
              format: "Amount, vendor, status, fulfillment",
              owner: "Purchase Head",
            },
            {
              name: "GRN / QC Register",
              route: "/dashboard/purchase/grn",
              format: "Receipt, invoice, QC and stock posting",
              owner: "Stores + QC",
            },
            {
              name: "Vendor Master Audit",
              route: "/dashboard/purchase/vendors",
              format: "Verification, bank, GST/PAN and approval trail",
              owner: "Master Data",
            },
          ],
        },
        {
          name: "Inventory",
          description:
            "Material master, stock movement, issue/receipt and UID traceability.",
          reports: [
            {
              name: "Stock Master Register",
              route: "/dashboard/inventory/items",
              format: "Freeze columns, saved views, CSV",
              owner: "Stores",
            },
            {
              name: "Stock Adjustment Report",
              route: "/dashboard/inventory/stock-adjustments",
              format: "Movement type, reason, quantity, audit",
              owner: "Inventory Controller",
            },
            {
              name: "SIV / SRV Register",
              route: "/dashboard/inventory/siv",
              format: "Issue and receipt movement documents",
              owner: "Stores",
            },
            {
              name: "UID Traceability Report",
              route: "/dashboard/uid/trace",
              format: "Full material lifecycle trace",
              owner: "Quality / Dispatch",
            },
          ],
        },
        {
          name: "Finance",
          description:
            "Supplier invoices, advances, payables, debit notes and outstanding balances.",
          reports: [
            {
              name: "Supplier Invoice Register",
              route: "/dashboard/accounts/supplier-invoices",
              format: "GRN invoice amount, tax, freight, rounding",
              owner: "Accounts",
            },
            {
              name: "Accounts Payable Aging",
              route: "/dashboard/accounts/payables",
              format: "Vendor outstanding, paid, pending and advance balance",
              owner: "Finance Manager",
            },
            {
              name: "Debit Note Register",
              route: "/dashboard/purchase/debit-notes",
              format: "Debit recovery and tax impact",
              owner: "Accounts",
            },
          ],
        },
        {
          name: "Production",
          description:
            "Job orders, subcontracting route, WIP and shop-floor visibility.",
          reports: [
            {
              name: "Job Order Register",
              route: "/dashboard/production/job-orders",
              format: "Plan, issue, consume, complete",
              owner: "Production",
            },
            {
              name: "Subcontracting Route Register",
              route: "/dashboard/production/subcontracting",
              format:
                "Operation route, external vendor stages, scrap/return tracking",
              owner: "Production + Stores",
            },
            {
              name: "BOM Register",
              route: "/dashboard/bom",
              format: "Engineering structure and routing",
              owner: "Engineering",
            },
          ],
        },
      ],
      headlineMetrics: cockpit.metrics,
    };
  }

  async getAiMis(tenantId: string) {
    const cockpit = await this.getCockpit(tenantId);
    const fallback = cockpit.aiMis;

    const promptData = {
      metrics: cockpit.metrics,
      summary: cockpit.summary,
      exceptions: cockpit.exceptions,
      aging: cockpit.aging,
      moduleHealth: cockpit.moduleHealth,
    };
    const result = await this.ai.structuredJson<any>({
      capability: "EXECUTIVE_MIS",
      scope: `tenant:${tenantId}`,
      model: this.configService.get<string>("OPENAI_MIS_MODEL") || undefined,
      system:
        "You are a senior manufacturing ERP MIS analyst. Create concise executive MIS from ERP data. Return valid JSON only with keys: executiveSummary, managementAttention, decisionsRequired, riskRegister, departmentActions, nextReviewFocus. Keep it factual, preserve record values, and do not invent data.",
      data: promptData,
      fallback,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: [
          "executiveSummary",
          "managementAttention",
          "decisionsRequired",
          "riskRegister",
          "departmentActions",
          "nextReviewFocus",
        ],
        properties: {
          executiveSummary: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
          },
          managementAttention: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["area", "issue", "impact", "severity"],
              properties: {
                area: { type: "string" },
                issue: { type: "string" },
                impact: { type: "string" },
                severity: { type: "string" },
              },
            },
          },
          decisionsRequired: {
            type: "array",
            items: { type: "string" },
            maxItems: 8,
          },
          riskRegister: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["risk", "score", "mitigation"],
              properties: {
                risk: { type: "string" },
                score: { type: "number" },
                mitigation: { type: "string" },
              },
            },
          },
          departmentActions: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["department", "action", "route"],
              properties: {
                department: { type: "string" },
                action: { type: "string" },
                route: { type: "string" },
              },
            },
          },
          nextReviewFocus: {
            type: "array",
            items: { type: "string" },
            maxItems: 8,
          },
        },
      },
    });
    // AI JSON is untrusted input. Providers can return a single string or an
    // object despite the requested schema; normalize narrative/list fields so
    // every dashboard consumer receives the contract it expects.
    const asTextList = (value: unknown, fallbackValue: string[] = []) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || "").trim()).filter(Boolean);
      if (typeof value === "string" && value.trim()) return [value.trim()];
      if (value && typeof value === "object") {
        const text = [
          (value as any).summary,
          (value as any).title,
          (value as any).message,
          (value as any).description,
          (value as any).action,
        ].find((item) => typeof item === "string" && item.trim());
        return text ? [String(text).trim()] : fallbackValue;
      }
      return fallbackValue;
    };
    const asObjectList = (value: unknown, fallbackValue: any[] = []) =>
      Array.isArray(value)
        ? value.filter((item) => item && typeof item === "object")
        : fallbackValue;
    const aiValue =
      result.value &&
      typeof result.value === "object" &&
      !Array.isArray(result.value)
        ? result.value
        : {};
    return {
      ...fallback,
      ...aiValue,
      executiveSummary: asTextList(
        aiValue.executiveSummary,
        fallback.executiveSummary || [],
      ),
      decisionsRequired: asTextList(
        aiValue.decisionsRequired,
        fallback.decisionsRequired || [],
      ),
      nextReviewFocus: asTextList(
        aiValue.nextReviewFocus,
        fallback.nextReviewFocus || [],
      ),
      managementAttention: asObjectList(
        aiValue.managementAttention,
        fallback.managementAttention || [],
      ),
      riskRegister: asObjectList(
        aiValue.riskRegister,
        fallback.riskRegister || [],
      ),
      departmentActions: asObjectList(
        aiValue.departmentActions,
        fallback.departmentActions || [],
      ),
      generatedBy: result.fallback_used
        ? "MIS rules engine"
        : "Configured AI provider",
      aiConfigured: this.ai.isEnabled(),
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallback_used,
      latencyMs: result.latency_ms,
      usage: result.usage,
      note: result.fallback_used
        ? "Deterministic MIS remains active because the AI provider is unavailable or returned an invalid response."
        : undefined,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildRuleBasedMis(
    metrics: DashboardMetric[],
    exceptions: DashboardException[],
    facts: Record<string, number>,
  ) {
    const riskScore = Math.min(
      100,
      (facts.pendingPRs || 0) * 6 +
        (facts.pendingPOs || 0) * 8 +
        (facts.draftGRNs || 0) * 7 +
        (facts.lowStock || 0) * 10 +
        (facts.pendingItemVerification || 0) * 2,
    );
    const grade =
      riskScore >= 70
        ? "High Risk"
        : riskScore >= 35
          ? "Needs Management Attention"
          : "Controlled";

    const decisionsRequired = [
      facts.pendingPRs > 0
        ? `Approve or reject ${facts.pendingPRs} pending PR document(s).`
        : "",
      facts.pendingPOs > 0
        ? `Clear ${facts.pendingPOs} pending PO approval(s) before supplier commitment.`
        : "",
      facts.draftGRNs > 0
        ? `Complete QC/posting for ${facts.draftGRNs} pending GRN(s) to align stock and AP.`
        : "",
      facts.lowStock > 0
        ? `Review ${facts.lowStock} low-stock alert(s) and confirm procurement coverage.`
        : "",
      facts.advancePaid > 0
        ? `Review advance balance of ${this.formatMoney(facts.advancePaid)} before supplier payment release.`
        : "",
    ].filter(Boolean);

    return {
      generatedAt: new Date().toISOString(),
      generatedBy: "MIS rules engine",
      aiConfigured: this.aiEnabled,
      riskScore,
      grade,
      executiveSummary: [
        `Current operations status is ${grade}.`,
        `Open purchase exposure is ${this.formatMoney(facts.openPOValue || 0)} and supplier invoice exposure is ${this.formatMoney(facts.invoicedValue || 0)}.`,
        `The main exception load is ${exceptions.length} item(s), led by approvals, GRN/QC, inventory risk and master-data hygiene.`,
      ],
      managementAttention: exceptions.slice(0, 6).map((item) => ({
        area: item.type,
        issue: item.title,
        impact: item.detail,
        severity: item.severity,
      })),
      decisionsRequired,
      riskRegister: [
        {
          risk: "Delayed procurement approvals",
          score: (facts.pendingPRs || 0) + (facts.pendingPOs || 0),
          mitigation: "Daily manager approval queue review.",
        },
        {
          risk: "Stock/AP mismatch from pending GRNs",
          score: facts.draftGRNs || 0,
          mitigation: "Close QC and invoice approval before payment release.",
        },
        {
          risk: "Material availability and master-data quality",
          score: (facts.lowStock || 0) + (facts.pendingItemVerification || 0),
          mitigation: "Verify item masters and review reorder coverage.",
        },
        {
          risk: "Supplier advance leakage",
          score: facts.advancePaid || 0,
          mitigation: "Adjust advances only during approved payment run.",
        },
      ],
      departmentActions: [
        {
          department: "Purchase",
          action: "Clear PR/PO approval queue and review open PO exposure.",
          route: "/dashboard/purchase/orders",
        },
        {
          department: "Stores/QC",
          action: "Close pending GRN inspections and verify stock posting.",
          route: "/dashboard/purchase/grn",
        },
        {
          department: "Finance",
          action:
            "Review supplier invoice, debit note and advance adjustment exposure.",
          route: "/dashboard/accounts/payables",
        },
        {
          department: "Operations",
          action:
            "Monitor WIP, subcontracting stages and stock risk before production release.",
          route: "/dashboard/production/job-orders",
        },
      ],
      nextReviewFocus: metrics
        .filter(
          (metric) => metric.tone === "danger" || metric.tone === "warning",
        )
        .map((metric) => metric.label),
    };
  }

  private buildManagementReports(cockpit: any) {
    const s = cockpit.summary;
    return [
      {
        title: "Executive Daily MIS",
        owner: "Management",
        objective:
          "One-page health check of approvals, procurement exposure, stock risk, WIP and AP exposure.",
        kpis: [
          {
            label: "Approval Load",
            value:
              (s.procurement.pendingPRs || 0) +
              (s.procurement.pendingPOs || 0) +
              (s.vendors.pendingApproval || 0),
          },
          {
            label: "Open PO Exposure",
            value: this.formatMoney(s.procurement.openPOValue || 0),
          },
          {
            label: "Supplier Invoice Exposure",
            value: this.formatMoney(s.accounts.invoicedValue || 0),
          },
          {
            label: "Stock Risk",
            value:
              (s.inventory.lowStock || 0) +
              (s.inventory.pendingItemVerification || 0),
          },
        ],
      },
      {
        title: "Finance MIS",
        owner: "Finance Manager",
        objective: "Payment planning, advance control and AP reconciliation.",
        kpis: [
          {
            label: "Supplier Invoice Value",
            value: this.formatMoney(s.accounts.invoicedValue || 0),
          },
          {
            label: "Advance Balance",
            value: this.formatMoney(s.accounts.advancePaid || 0),
          },
          { label: "Open Debit Notes", value: s.accounts.openDebitNotes || 0 },
        ],
      },
      {
        title: "Purchase MIS",
        owner: "Purchase Head",
        objective: "Procurement cycle control from PR to PO to GRN.",
        kpis: [
          { label: "Pending PR", value: s.procurement.pendingPRs || 0 },
          { label: "Pending PO", value: s.procurement.pendingPOs || 0 },
          { label: "Approved PO", value: s.procurement.approvedPOs || 0 },
          {
            label: "Open PO Value",
            value: this.formatMoney(s.procurement.openPOValue || 0),
          },
        ],
      },
      {
        title: "Operations MIS",
        owner: "Operations Head",
        objective: "Inventory, QC and production bottleneck visibility.",
        kpis: [
          { label: "Low Stock Alerts", value: s.inventory.lowStock || 0 },
          { label: "Pending GRN/QC", value: s.inventory.draftGRNs || 0 },
          {
            label: "Production WIP",
            value: (s.production.open || 0) + (s.production.inProgress || 0),
          },
          { label: "Pending UID QC", value: s.inventory.uidPendingQc || 0 },
        ],
      },
    ];
  }
}
