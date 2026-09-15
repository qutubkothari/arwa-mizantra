import { ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { hasAnyPermissionForResource } from "../auth/utils/permission-utils";
import { DebitNoteService } from "../purchase/services/debit-note.service";
import { AccountingService } from "../accounting/accounting.service";
import { ProductionReportService } from "../production/services/production-report.service";
import { FsmService } from "../fsm/fsm.service";

export type AnalyticsKind =
  | "CUSTOMER_SALES"
  | "CUSTOMER_RECEIVABLES"
  | "SUPPLIER_DUES"
  | "SUPPLIER_ADVANCES"
  | "SUPPLIER_PAYMENTS"
  | "SUPPLIER_PRICE_COMPARISON"
  | "INVENTORY_POSITION"
  | "SALES_ORDER_STATUS"
  | "PRODUCTION_STATUS"
  | "PRODUCTION_REPORT"
  | "PROFIT_AND_LOSS"
  | "COSTING_SHEET"
  | "EMPLOYEE_ATTENDANCE"
  | "CRM_PIPELINE"
  | "CRM_FOLLOWUPS"
  | "FIELD_SALES"
  | "SEMANTIC_QUERY"
  | "MANAGEMENT_SUMMARY";

export type AnalyticsAnswer = {
  kind: AnalyticsKind;
  status: "READY" | "NEEDS_INFORMATION";
  title: string;
  headline?: string;
  questions: string[];
  period?: { from: string; to: string; label: string };
  currency_code?: string;
  metrics?: Array<{ label: string; value: number | string; format?: string }>;
  columns?: Array<{ key: string; label: string; format?: string }>;
  rows?: any[];
  definition?: string;
  warnings?: string[];
  sources?: Array<{
    table: string;
    label: string;
    record_count: number;
  }>;
  drill_down?: { label: string; route: string };
  actions?: Array<{
    kind: "DOWNLOAD_PDF" | "OPEN_RECORD";
    label: string;
    route: string;
    filename?: string;
  }>;
  generated_at: string;
  read_only: true;
  sections?: AnalyticsAnswer[];
  semantic_plan?: {
    mode: string;
    dataset?: string;
    specialist_kind?: string;
    operation?: string;
    entity_query?: string;
    entity_is_named?: boolean;
    date_from?: string;
    date_to?: string;
    confidence: number;
    provider: "OPENAI";
  };
};

const value = (input: unknown) => String(input ?? "").trim();
const amount = (input: unknown) => {
  const parsed = Number(input || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const quantityText = (input: unknown) => {
  const parsed = amount(input);
  return Number.isInteger(parsed)
    ? String(parsed)
    : parsed.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
};
const iso = (date: Date) => date.toISOString().slice(0, 10);
const normalized = (input: unknown) =>
  value(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const editSimilarity = (left: string, right: string) => {
  const compactSimilarity = (a: string, b: string) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const longest = Math.max(a.length, b.length);
    if (Math.abs(a.length - b.length) / longest > 0.4) return 0;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1)
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      previous = current;
    }
    return 1 - previous[b.length] / longest;
  };
  const leftTokens = normalized(left).split(/\s+/).filter(Boolean);
  const rightTokens = normalized(right).split(/\s+/).filter(Boolean);
  const a = leftTokens.join("");
  const b = rightTokens.join("");
  if (!a || !b) return 0;
  const whole = compactSimilarity(a, b);
  const tokenCoverage = leftTokens.length
    ? leftTokens.reduce(
        (sum, token) =>
          sum +
          Math.max(
            0,
            ...rightTokens.map((candidate) =>
              compactSimilarity(token, candidate),
            ),
          ),
        0,
      ) / leftTokens.length
    : 0;
  return Math.max(whole, tokenCoverage);
};

export function detectAnalyticsQuestionKind(
  prompt: string,
): AnalyticsKind | null {
  const text = normalized(prompt)
    .replace(/\b(?:wht|whats)\b/g, "what")
    .replace(/\bwich\b/g, "which")
    .replace(/\b(?:suplier|supplr|suplr)\b/g, "supplier")
    .replace(/\bvender\b/g, "vendor")
    .replace(/\bcustmer\b/g, "customer")
    .replace(/\binventry\b/g, "inventory")
    .replace(/\bstck\b/g, "stock")
    .replace(/\bprodction\b/g, "production")
    .replace(/\bpaymnt\b/g, "payment")
    .replace(/\battendence\b/g, "attendance")
    .replace(/\bremaning\b/g, "remaining");
  if (
    /\b(field sales|field work|customer (?:visits?|meetings?|appointments?)|sales (?:visits?|route|rounds?)|my (?:visits?|customer calls?|appointments?)|visit plan|day route|route today|location exceptions?|location reviews?)\b/.test(text) ||
    /\b(?:who|which customer|where)\b.*\b(?:should|do|must)\b.*\bvisit\b/.test(text) ||
    /\b(?:where am i going|who (?:do i|should i) (?:need to )?(?:see|meet|visit)|what (?:customer )?appointments? do i have)\b/.test(text) ||
    /\b(?:customers?|accounts?)\b.*\b(?:not seen|not visited|have not seen|overdue for (?:a )?visit)\b/.test(text) ||
    /\b(?:field|visit)\b.*\b(?:team|reps?|representatives?)\b.*\b(?:doing|performance|progress|compliance)\b/.test(text) ||
    /\bshow\b.*\b(?:today(?: s)?|planned|missed|completed)\b.*\bvisits?\b/.test(text)
  )
    return "FIELD_SALES";
  if (
    /\b(p l|pnl|profit and loss|income statement|are we making money|did we make (?:a )?(?:profit|loss)|business profitable)\b/.test(
      text,
    )
  )
    return "PROFIT_AND_LOSS";
  if (
    /\b(costing sheet|cost sheet|product cost|item cost|cost per (?:piece|unit)|how much .+ cost to (?:make|produce)|what does .+ cost to make)\b/.test(
      text,
    )
  )
    return "COSTING_SHEET";
  if (
    /\b(?:what|how much|how many)\b.*\b(?:did we |was |were )?(?:make|made|produce|produced)\b/.test(
      text,
    )
  )
    return "PRODUCTION_REPORT";
  if (
    /\b(production|manufacturing|shop floor)\b/.test(text) &&
    /\b(report|performance|output|actuals?|efficiency|rejection|downtime|made|produced|target|stoppage)\b/.test(
      text,
    )
  )
    return "PRODUCTION_REPORT";
  if (
    /\b(planning report|production plan report|material planning report)\b/.test(
      text,
    )
  )
    return "PRODUCTION_STATUS";
  if (
    /\b(employee|employees|staff|worker|workers|team|people)\b/.test(text) &&
    /\b(late|lateness|attendance|check in|checked in|punctual|punctuality|absent|absence)\b/.test(
      text,
    ) &&
    !/\b(create|record|mark|correct|edit|update|approve|regularize|delete)\b/.test(
      text,
    )
  )
    return "EMPLOYEE_ATTENDANCE";
  if (
    /\b(supplier|suppliers|vendor|vendors)\b/.test(text) &&
    /\b(advance|advances|prepayment|prepayments)\b/.test(text) &&
    !/\b(create|record|add|pay|adjust|utilize|use|post|approve|cancel)\b/.test(
      text,
    )
  )
    return "SUPPLIER_ADVANCES";
  if (
    /\b(management|executive|owner|business)\b/.test(text) &&
    /\b(summary|brief|snapshot|performance|health|overview|doing|needs attention)\b/.test(
      text,
    )
  )
    return "MANAGEMENT_SUMMARY";
  if (
    /\b(production|manufacturing|job|jobs|job order|work order)\b/.test(text) &&
    /\b(status|progress|pending|open|delay|delayed|schedule|plan|overview|unfinished|remaining|left|going)\b/.test(
      text,
    )
  )
    return "PRODUCTION_STATUS";
  if (
    /\b(sales orders?|customer orders?|order fulfilment|order fulfillment)\b/.test(
      text,
    ) &&
    /\b(status|progress|pending|open|delivery|dispatch|fulfilment|fulfillment|where|shipped|delivered|left)\b/.test(
      text,
    )
  )
    return "SALES_ORDER_STATUS";
  const inventoryQuestion = /\b(stock|inventory|store|warehouse)\b/.test(text);
  const colloquialInventoryQuestion =
    /\b(how much|kitna|kitni|kithna|kithni)\b/.test(text) &&
    /\b(maal|mal|saman|material|item|quantity)\b/.test(text) &&
    /\b(pada|padi|bacha|bachi|left|lying|available|hai|he)\b/.test(text);
  const inventoryMutation =
    /\b(create|raise|record|receive|dispatch|issue|return|adjust|approve|post|transfer|consume|release|cancel)\b/.test(
      text,
    );
  if (
    (inventoryQuestion || colloquialInventoryQuestion) &&
    !inventoryMutation &&
    (/\b(available|availability|on hand|position|short|shortage|low|reorder|slow|ageing|aging|movement|how much|how many|overview|left|remaining|enough)\b/.test(
      text,
    ) ||
      /\b(what|show|tell|check|find|give)\b/.test(text) ||
      /\b(stock|inventory)\s+(?:of|for)\b/.test(text) ||
      colloquialInventoryQuestion)
  )
    return "INVENTORY_POSITION";
  if (
    /\b(compare|comparison|versus|vs|best|cheapest|lowest)\b/.test(text) &&
    /\b(price|prices|rate|rates|cost)\b/.test(text) &&
    /\b(supplier|suppliers|vendor|vendors)\b/.test(text)
  )
    return "SUPPLIER_PRICE_COMPARISON";
  if (
    /\b(supplier|suppliers|vendor|vendors)\b/.test(text) &&
    /\b(latest|last|recent|newest)\b/.test(text) &&
    /\b(payment|payments|paid|transaction|transactions)\b/.test(text) &&
    !/\b(due|dues|overdue|outstanding|payable|payables|unpaid)\b/.test(text)
  )
    return "SUPPLIER_PAYMENTS";
  const imperativeMutation =
    /^(create|raise|record|receive|dispatch|issue|return|adjust|approve|post|pay|release|cancel|make|manufacture|produce|buy|purchase|order)\b/.test(
      text,
    );
  if (
    !imperativeMutation &&
    ((/\b(supplier|suppliers|vendor|vendors)\b/.test(text) &&
      /\b(ap|accounts payable|due|dues|outstanding|payable|payables|owed|owing|overdue|unpaid|payment|payments|bills?|need to pay)\b/.test(
        text,
      )) ||
      /\b(highest|largest|biggest|maximum|max|top)\b.*\b(ap|accounts payable|payable|payables)\b/.test(
        text,
      ) ||
      /\bwho\b.*\bowe\b.*\bmost\b/.test(text))
  )
    return "SUPPLIER_DUES";
  if (
    (/\b(customer|client|receivable|receivables|debtor|debtors)\b/.test(text) ||
      /\b(owe|owes|owed|owing)\s+(?:to\s+)?us\b/.test(text)) &&
    /\b(due|dues|outstanding|receivable|receivables|owed|owing|overdue|ageing|aging|balance|paid|payment status)\b/.test(
      text,
    )
  )
    return "CUSTOMER_RECEIVABLES";
  if (
    /\b(?:who|which customers?|which clients?)\b.*\b(?:owe|owes)\b.*\bus\b|\bmoney (?:to collect|still coming)\b|\bwhat (?:do|does) .+ owe us\b/.test(
      text,
    )
  )
    return "CUSTOMER_RECEIVABLES";
  if (
    /\b(?:lead|leads|enquiry|enquiries|opportunity|opportunities|pipeline)\b/.test(
      text,
    )
  ) {
    if (
      /\b(?:follow up|call|contact|next action|due|today|overdue|needs attention)\b/.test(
        text,
      )
    )
      return "CRM_FOLLOWUPS";
    return "CRM_PIPELINE";
  }
  if (
    !imperativeMutation &&
    /\b(sales|revenue|billing|billed|turnover|sell|sold|business)\b/.test(
      text,
    ) &&
    /\b(client|customer|account|to|of|for|did|from)\b/.test(text)
  )
    return "CUSTOMER_SALES";
  return null;
}

@Injectable()
export class ConversationalAnalyticsService {
  private db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(
    @Optional() private readonly debitNotes?: DebitNoteService,
    @Optional() private readonly accounting?: AccountingService,
    @Optional() private readonly productionReports?: ProductionReportService,
    @Optional() private readonly fsm?: FsmService,
  ) {}

  recognizes(prompt: string) {
    return detectAnalyticsQuestionKind(prompt) !== null;
  }

  private assertDomainAccess(user: any, resource: string) {
    if (!hasAnyPermissionForResource(user, resource))
      throw new ForbiddenException(
        `Your role cannot query ${resource.replaceAll("_", " ")} analytics.`,
      );
  }

  private resolveRows(
    prompt: string,
    query: string,
    rows: any[],
    fields: string[],
  ) {
    const promptText = normalized(prompt);
    const queryText = normalized(query);
    const scored = rows
      .map((row) => {
        const labels = fields
          .map((field) => normalized(row[field]))
          .filter(Boolean);
        let score = 0;
        for (const label of labels) {
          if (queryText && label === queryText) score = Math.max(score, 100);
          if (label.length >= 2 && promptText.includes(label))
            score = Math.max(score, 95);
          if (
            queryText &&
            (label.startsWith(queryText) || queryText.startsWith(label))
          )
            score = Math.max(score, 80);
          if (
            queryText &&
            (label.includes(queryText) || queryText.includes(label))
          )
            score = Math.max(score, 60);
        }
        return { row, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    const unique =
      scored.length === 1 || scored[0]?.score > (scored[1]?.score || 0);
    if (!scored.length && queryText.replace(/\s+/g, "").length >= 5) {
      const fuzzy = rows
        .map((row) => ({
          row,
          similarity: Math.max(
            ...fields.map((field) => editSimilarity(queryText, row[field])),
          ),
        }))
        .filter((entry) => entry.similarity >= 0.72)
        .sort((left, right) => right.similarity - left.similarity);
      const confident = Boolean(
        fuzzy[0]?.similarity >= 0.78 &&
        (!fuzzy[1] || fuzzy[0].similarity - fuzzy[1].similarity >= 0.08),
      );
      return {
        match: confident ? fuzzy[0].row : null,
        candidates: fuzzy.slice(0, 5).map((entry) => entry.row),
      };
    }
    return {
      match: unique ? scored[0]?.row || null : null,
      candidates: scored.slice(0, 5).map((entry) => entry.row),
    };
  }

  private period(prompt: string) {
    const today = new Date();
    const lower = normalized(prompt);
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    if (/\b(today|today s|daily)\b/.test(lower))
      return { from: iso(today), to: iso(today), label: "Today" };
    if (/\byear to date\b|\bytd\b/.test(lower))
      return {
        from: iso(new Date(Date.UTC(year, 0, 1))),
        to: iso(today),
        label: `Year to date ${year}`,
      };
    if (/\bthis month\b|\bcurrent month\b/.test(lower))
      return {
        from: iso(new Date(Date.UTC(year, month, 1))),
        to: iso(today),
        label: "Current month to date",
      };
    if (/\blast month\b|\bprevious month\b/.test(lower))
      return {
        from: iso(new Date(Date.UTC(year, month - 1, 1))),
        to: iso(new Date(Date.UTC(year, month, 0))),
        label: "Previous calendar month",
      };
    const currentQuarter = Math.floor(month / 3);
    if (/\bthis quarter\b|\bcurrent quarter\b/.test(lower))
      return {
        from: iso(new Date(Date.UTC(year, currentQuarter * 3, 1))),
        to: iso(today),
        label: `Q${currentQuarter + 1} ${year} to date`,
      };
    if (/\blast quarter\b|\bprevious quarter\b/.test(lower)) {
      const start = new Date(Date.UTC(year, currentQuarter * 3 - 3, 1));
      return {
        from: iso(start),
        to: iso(
          new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0),
          ),
        ),
        label: `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`,
      };
    }
    const months = lower.match(
      /\b(?:last|past|previous)\s+(\d{1,2})\s+months?\b/,
    );
    if (months) {
      const count = Math.min(36, Math.max(1, Number(months[1])));
      const from = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - count + 1, 1),
      );
      return {
        from: iso(from),
        to: iso(today),
        label: `Current month plus previous ${count - 1} month${count === 2 ? "" : "s"}`,
      };
    }
    const days = lower.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/);
    if (days) {
      const count = Math.min(1095, Math.max(1, Number(days[1])));
      const from = new Date(today);
      from.setUTCDate(from.getUTCDate() - count + 1);
      return { from: iso(from), to: iso(today), label: `Last ${count} days` };
    }
    const quarter = lower.match(/\bq([1-4])\b(?:\s+(20\d{2}))?/);
    if (quarter) {
      const q = Number(quarter[1]);
      const y = Number(quarter[2] || year);
      const startMonth = (q - 1) * 3;
      return {
        from: iso(new Date(Date.UTC(y, startMonth, 1))),
        to: iso(new Date(Date.UTC(y, startMonth + 3, 0))),
        label: `Q${q} ${y}`,
      };
    }
    return null;
  }

  private needs(
    kind: AnalyticsKind,
    title: string,
    question: string,
  ): AnalyticsAnswer {
    return {
      kind,
      status: "NEEDS_INFORMATION",
      title,
      questions: [question],
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  async answer(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any = {},
    forcedKind?: AnalyticsKind,
  ): Promise<AnalyticsAnswer | null> {
    const kind = forcedKind || detectAnalyticsQuestionKind(prompt);
    if (!kind) return null;
    if (kind === "CUSTOMER_SALES")
      return this.customerSales(tenantId, user, prompt, extracted);
    if (kind === "CUSTOMER_RECEIVABLES")
      return this.customerReceivables(tenantId, user, prompt, extracted);
    if (kind === "SUPPLIER_DUES")
      return this.supplierDues(tenantId, user, prompt, extracted);
    if (kind === "SUPPLIER_ADVANCES")
      return this.supplierAdvances(tenantId, user, prompt, extracted);
    if (kind === "SUPPLIER_PAYMENTS")
      return this.supplierPayments(tenantId, user, prompt, extracted);
    if (kind === "SUPPLIER_PRICE_COMPARISON")
      return this.supplierPriceComparison(tenantId, user, prompt, extracted);
    if (kind === "INVENTORY_POSITION")
      return this.inventoryPosition(tenantId, user, prompt, extracted);
    if (kind === "SALES_ORDER_STATUS")
      return this.salesOrderStatus(tenantId, user, prompt, extracted);
    if (kind === "PRODUCTION_STATUS")
      return this.productionStatus(tenantId, user, prompt, extracted);
    if (kind === "PRODUCTION_REPORT")
      return this.productionReport(tenantId, user, prompt);
    if (kind === "PROFIT_AND_LOSS")
      return this.profitAndLoss(tenantId, user, prompt);
    if (kind === "COSTING_SHEET")
      return this.costingSheet(tenantId, user, prompt, extracted);
    if (kind === "EMPLOYEE_ATTENDANCE")
      return this.employeeAttendance(tenantId, user, prompt, extracted);
    if (kind === "CRM_PIPELINE" || kind === "CRM_FOLLOWUPS")
      return this.crmPipeline(tenantId, user, kind, extracted);
    if (kind === "FIELD_SALES") return this.fieldSales(tenantId, user, prompt);
    return this.managementSummary(tenantId, user, prompt);
  }

  private async fieldSales(tenantId: string, user: any, prompt: string): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "fsm");
    if (!this.fsm) throw new Error("Field Sales analytics is not available.");
    const actor = { ...user, tenantId, userId: user?.userId || user?.id };
    const today = iso(new Date());
    const wantsTeam = /\b(?:team|reps?|representatives?|performance|compliance)\b/.test(normalized(prompt));
    const wantsSuggestions = /\b(?:who|which customer|should|recommend|suggest|priority|not seen|not visited|have not seen|overdue|meet next|see next)\b/.test(normalized(prompt));
    const wantsExceptions = /\b(?:exception|outside|location|gps|accuracy)\b/.test(normalized(prompt));
    if (wantsExceptions) {
      const rows: any[] = await this.fsm.exceptions(actor);
      return { kind: "FIELD_SALES", status: "READY", title: "Field visit location reviews", headline: `${rows.filter((row) => row.status === "PENDING").length} review(s) need attention`, questions: [], columns: [{ key: "status", label: "Status" }, { key: "reason", label: "Reason" }, { key: "created_at", label: "Raised" }], rows, definition: "Only location exceptions within your current manager scope are included. Approved exceptions are not labelled GPS verified.", sources: [{ table: "fsm_location_reviews", label: "Tenant-scoped location review register", record_count: rows.length }], drill_down: { label: "Open Field Sales exceptions", route: "/dashboard/fsm?view=exceptions" }, generated_at: new Date().toISOString(), read_only: true };
    }
    if (wantsTeam) {
      const metrics: any = await this.fsm.managerDashboard(actor, { date: today });
      return { kind: "FIELD_SALES", status: "READY", title: "Field sales team performance", headline: `${metrics.completed || 0} of ${metrics.planned || 0} planned visit(s) completed today`, questions: [], columns: [{ key: "planned", label: "Planned" }, { key: "completed", label: "Completed" }, { key: "missed", label: "Missed" }, { key: "location_verified", label: "Location verified" }, { key: "compliance_rate", label: "Compliance %", format: "number" }], rows: [metrics], definition: "Today’s manager metrics use tenant-scoped visits, exclude cancelled visits and preserve the published-plan denominator.", sources: [{ table: "fsm_visits/fsm_visit_plans", label: "Tenant-scoped field execution metrics", record_count: Number(metrics.planned || 0) }], drill_down: { label: "Open Field Sales team", route: "/dashboard/fsm?view=team" }, generated_at: new Date().toISOString(), read_only: true };
    }
    if (wantsSuggestions) {
      const rows: any[] = await this.fsm.recommendations(actor);
      return { kind: "FIELD_SALES", status: "READY", title: "Customers to visit", headline: rows.length ? `${rows[0].account?.account_name || "The first customer"} is currently the highest priority` : "No customer recommendation is available", questions: [], columns: [{ key: "account.account_name", label: "Customer" }, { key: "score", label: "Score", format: "number" }, { key: "reasons", label: "Why" }], rows: rows.slice(0, 20), definition: "Deterministic recommendations use only accounts in your current field-sales scope. Restricted finance amounts are not disclosed.", sources: [{ table: "crm_accounts/fsm_visits", label: "Scoped CRM coverage and visit history", record_count: rows.length }], drill_down: { label: "Open plan and route", route: "/dashboard/fsm?view=planner" }, generated_at: new Date().toISOString(), read_only: true };
    }
    const rows: any[] = await this.fsm.visits(actor, { date: today });
    return { kind: "FIELD_SALES", status: "READY", title: "Today’s customer visits", headline: `${rows.length} visit(s) planned today`, questions: [], columns: [{ key: "scheduled_start", label: "Time" }, { key: "account.account_name", label: "Customer" }, { key: "site.site_name", label: "Site" }, { key: "status", label: "Status" }], rows, definition: "Visits are filtered by your current tenant, ownership, effective assignment and manager territory scope.", sources: [{ table: "fsm_visits", label: "Tenant-scoped visit register", record_count: rows.length }], drill_down: { label: "Open Field Sales", route: "/dashboard/fsm" }, generated_at: new Date().toISOString(), read_only: true };
  }

  private async profitAndLoss(
    tenantId: string,
    user: any,
    prompt: string,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "accounting");
    if (!this.accounting)
      throw new Error("Profit and loss reporting is not available.");
    const period = this.period(prompt);
    const asOf = period?.to || iso(new Date());
    const result: any = await this.accounting.profitLoss(tenantId, {
      as_of: asOf,
    });
    const rows = [
      ...(result.revenue || []).map((row: any) => ({
        section: "Revenue",
        account_code: row.account_code,
        account_name: row.account_name || row.name,
        amount: Math.abs(amount(row.balance)),
      })),
      ...(result.expenses || []).map((row: any) => ({
        section: "Expense",
        account_code: row.account_code,
        account_name: row.account_name || row.name,
        amount: Math.abs(amount(row.balance)),
      })),
    ];
    return {
      kind: "PROFIT_AND_LOSS",
      status: "READY",
      title: `Profit & Loss as of ${asOf}`,
      headline: `Net ${amount(result.net_profit) >= 0 ? "profit" : "loss"}: ${Math.abs(amount(result.net_profit)).toLocaleString("en-IN")}`,
      questions: [],
      period: {
        from: "",
        to: asOf,
        label: `Cumulative balances as of ${asOf}`,
      },
      currency_code: "INR",
      metrics: [
        {
          label: "Revenue",
          value: amount(result.total_revenue),
          format: "money",
        },
        {
          label: "Expenses",
          value: amount(result.total_expense),
          format: "money",
        },
        {
          label: "Net profit",
          value: amount(result.net_profit),
          format: "money",
        },
      ],
      columns: [
        { key: "section", label: "Section" },
        { key: "account_code", label: "Account" },
        { key: "account_name", label: "Account name" },
        { key: "amount", label: "Amount", format: "money" },
      ],
      rows,
      definition:
        "Cumulative posted general-ledger revenue and expense balances through the selected as-of date. Draft and unposted journals are excluded.",
      sources: [
        {
          table: "accounting_journal_lines",
          label: "Posted general ledger",
          record_count: rows.length,
        },
      ],
      drill_down: {
        label: "Open accounting reports",
        route: "/dashboard/accounts",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async productionReport(
    tenantId: string,
    user: any,
    prompt: string,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "job_orders");
    if (!this.productionReports)
      throw new Error("Production reporting is not available.");
    const requested = this.period(prompt);
    const today = new Date();
    const fallback = {
      from: iso(
        new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      ),
      to: iso(today),
      label: "Current month to date",
    };
    const period = requested || fallback;
    const grouping = /\bmonthly\b/.test(normalized(prompt))
      ? "monthly"
      : /\bweekly\b/.test(normalized(prompt))
        ? "weekly"
        : "daily";
    const result: any = await this.productionReports.report(tenantId, {
      period: grouping,
      from: period.from,
      to: period.to,
    });
    const totals = result.totals || {};
    const processed =
      amount(totals.good_quantity) + amount(totals.rejected_quantity);
    return {
      kind: "PRODUCTION_REPORT",
      status: "READY",
      title: "Production performance report",
      headline: `${amount(totals.good_quantity).toLocaleString("en-IN")} good units recorded across ${result.by_product?.length || 0} product-period line(s).`,
      questions: [],
      period,
      metrics: [
        {
          label: "Good output",
          value: amount(totals.good_quantity),
          format: "number",
        },
        {
          label: "Rejected",
          value: amount(totals.rejected_quantity),
          format: "number",
        },
        {
          label: "Rejection %",
          value: processed
            ? Number(
                ((amount(totals.rejected_quantity) / processed) * 100).toFixed(
                  2,
                ),
              )
            : 0,
          format: "number",
        },
        {
          label: "Run minutes",
          value: amount(totals.run_minutes),
          format: "number",
        },
        {
          label: "Downtime minutes",
          value: amount(totals.downtime_minutes),
          format: "number",
        },
      ],
      columns: [
        { key: "period", label: "Period" },
        { key: "code", label: "Product code" },
        { key: "name", label: "Product" },
        { key: "good_quantity", label: "Good", format: "number" },
        { key: "rejected_quantity", label: "Rejected", format: "number" },
        { key: "rejection_pct", label: "Rejection %", format: "number" },
        { key: "units_per_hour", label: "Units/hour", format: "number" },
        { key: "availability_pct", label: "Availability %", format: "number" },
      ],
      rows: result.by_product || [],
      definition:
        "Actual completed shop-floor quantities and recorded downtime, grouped from governed production execution records.",
      sources: [
        {
          table: "station_completions",
          label: "Shop-floor completions",
          record_count: result.by_product?.length || 0,
        },
        {
          table: "manufacturing_downtime_events",
          label: "Recorded downtime",
          record_count: result.by_machine?.length || 0,
        },
      ],
      drill_down: {
        label: "Open production reports",
        route: "/dashboard/production/reports",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async costingSheet(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "job_orders");
    const { data, error } = await this.db
      .from("production_cost_sheet_templates")
      .select(
        "id,finished_item_id,template_name,currency_code,output_quantity,calculated_total_cost,calculated_unit_cost,is_active,updated_at,cost_lines",
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const itemIds = Array.from(
      new Set(
        (data || []).map((row: any) => row.finished_item_id).filter(Boolean),
      ),
    );
    const itemResult = itemIds.length
      ? await this.db
          .from("items")
          .select("id,code,name,uom")
          .eq("tenant_id", tenantId)
          .in("id", itemIds)
      : ({ data: [], error: null } as any);
    if (itemResult.error) throw itemResult.error;
    const itemMap = new Map(
      (itemResult.data || []).map((item: any) => [String(item.id), item]),
    );
    const query = normalized(extracted?.item_query || "");
    let rows = (data || []).map((row: any) => {
      const item: any = itemMap.get(String(row.finished_item_id));
      return {
        item_code: item?.code || "",
        item_name: item?.name || "Unmapped item",
        sheet_name: row.template_name,
        output_quantity: amount(row.output_quantity),
        total_cost: amount(row.calculated_total_cost),
        unit_cost: amount(row.calculated_unit_cost),
        currency_code: row.currency_code || "INR",
        updated_at: row.updated_at,
      };
    });
    if (query)
      rows = rows.filter((row: any) =>
        normalized(
          `${row.item_code} ${row.item_name} ${row.sheet_name}`,
        ).includes(query),
      );
    const total = rows.reduce(
      (sum: number, row: any) => sum + row.total_cost,
      0,
    );
    return {
      kind: "COSTING_SHEET",
      status: "READY",
      title: query
        ? `Production costing sheets matching ${extracted.item_query}`
        : "Production costing sheets",
      headline: rows.length
        ? `${rows.length} active costing sheet${rows.length === 1 ? "" : "s"} ready to review or export.`
        : "No active production costing sheet matched this request.",
      questions: [],
      currency_code:
        rows.length &&
        rows.every((row: any) => row.currency_code === rows[0].currency_code)
          ? rows[0].currency_code
          : "MIXED",
      metrics: [
        { label: "Cost sheets", value: rows.length, format: "number" },
        { label: "Combined batch cost", value: total, format: "money" },
      ],
      columns: [
        { key: "item_code", label: "Item code" },
        { key: "item_name", label: "Finished item" },
        { key: "sheet_name", label: "Cost sheet" },
        { key: "output_quantity", label: "Output qty", format: "number" },
        { key: "total_cost", label: "Batch cost", format: "money" },
        { key: "unit_cost", label: "Unit cost", format: "money" },
        { key: "updated_at", label: "Updated", format: "date" },
      ],
      rows,
      definition:
        "Saved active production cost-sheet templates. Unit cost equals the calculated batch cost divided by planned output quantity.",
      sources: [
        {
          table: "production_cost_sheet_templates",
          label: "Production cost sheets",
          record_count: rows.length,
        },
      ],
      drill_down: {
        label: "Open production costing",
        route: "/dashboard/settings/production-setup?step=costing",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async crmPipeline(
    tenantId: string,
    user: any,
    kind: "CRM_PIPELINE" | "CRM_FOLLOWUPS",
    extracted: any = {},
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "sales");
    const [leadResult, stageResult] = await Promise.all([
      this.db
        .from("crm_leads")
        .select(
          "id,lead_number,company_name,expected_value,currency_code,probability,lead_score,owner_user_id,next_follow_up_at,expected_close_date,stage_id,updated_at",
        )
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(2000),
      this.db
        .from("crm_pipeline_stages")
        .select("id,stage_name,stage_code,is_closed")
        .eq("tenant_id", tenantId),
    ]);
    if (leadResult.error) throw leadResult.error;
    if (stageResult.error) throw stageResult.error;
    const stages = new Map(
      (stageResult.data || []).map((stage: any) => [String(stage.id), stage]),
    );
    const open = (leadResult.data || []).filter(
      (lead: any) => !stages.get(String(lead.stage_id))?.is_closed,
    );
    const ownerIds = Array.from(
      new Set(
        open.map((lead: any) => value(lead.owner_user_id)).filter(Boolean),
      ),
    );
    const ownerResult = ownerIds.length
      ? await this.db
          .from("users")
          .select("id,first_name,last_name,email")
          .eq("tenant_id", tenantId)
          .in("id", ownerIds)
      : { data: [], error: null };
    if (ownerResult.error) throw ownerResult.error;
    const owners = new Map(
      (ownerResult.data || []).map((owner: any) => [
        String(owner.id),
        [owner.first_name, owner.last_name].filter(Boolean).join(" ") ||
          owner.email,
      ]),
    );
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const due = open.filter(
      (lead: any) =>
        lead.next_follow_up_at &&
        new Date(lead.next_follow_up_at).getTime() <= endOfToday.getTime(),
    );
    const selected = kind === "CRM_FOLLOWUPS" ? due : open;
    const latestFirst =
      kind === "CRM_PIPELINE" && extracted?.query_operation === "LATEST";
    const rows = selected
      .sort((left: any, right: any) => {
        if (kind === "CRM_FOLLOWUPS")
          return (
            new Date(left.next_follow_up_at).getTime() -
            new Date(right.next_follow_up_at).getTime()
          );
        if (latestFirst)
          return (
            new Date(right.updated_at).getTime() -
            new Date(left.updated_at).getTime()
          );
        return amount(right.lead_score) - amount(left.lead_score);
      })
      .slice(0, 100)
      .map((lead: any) => ({
        lead: `${lead.lead_number} · ${lead.company_name}`,
        stage: stages.get(String(lead.stage_id))?.stage_name || "Unstaged",
        owner: owners.get(String(lead.owner_user_id)) || "Unassigned",
        score: amount(lead.lead_score),
        expected_value: amount(lead.expected_value),
        probability: amount(lead.probability),
        next_follow_up: lead.next_follow_up_at || "Not scheduled",
        last_updated: lead.updated_at,
      }));
    const pipelineValue = open.reduce(
      (sum: number, lead: any) => sum + amount(lead.expected_value),
      0,
    );
    const weightedValue = open.reduce(
      (sum: number, lead: any) =>
        sum + (amount(lead.expected_value) * amount(lead.probability)) / 100,
      0,
    );
    return {
      kind,
      status: "READY",
      title: kind === "CRM_FOLLOWUPS" ? "CRM follow-ups due" : "CRM pipeline",
      headline:
        kind === "CRM_FOLLOWUPS"
          ? `${due.length} open lead${due.length === 1 ? "" : "s"} require follow-up by today.`
          : `${open.length} open leads with ${pipelineValue.toFixed(2)} total pipeline value.`,
      questions: [],
      metrics: [
        { label: "Open leads", value: open.length },
        { label: "Follow-ups due", value: due.length },
        { label: "Pipeline value", value: pipelineValue, format: "currency" },
        {
          label: "Weighted forecast",
          value: weightedValue,
          format: "currency",
        },
      ],
      columns: [
        { key: "lead", label: "Lead" },
        { key: "stage", label: "Stage" },
        { key: "owner", label: "Owner" },
        { key: "score", label: "Score", format: "number" },
        { key: "expected_value", label: "Expected value", format: "currency" },
        { key: "probability", label: "Probability", format: "number" },
        { key: "next_follow_up", label: "Next follow-up" },
        { key: "last_updated", label: "Last updated" },
      ],
      rows,
      definition:
        "Open CRM leads are ranked by explainable lead score. Follow-ups due include every open lead scheduled up to the end of today.",
      sources: [
        {
          table: "crm_leads",
          label: "Tenant CRM lead register",
          record_count: leadResult.data?.length || 0,
        },
        {
          table: "crm_pipeline_stages",
          label: "Tenant CRM pipeline",
          record_count: stageResult.data?.length || 0,
        },
      ],
      drill_down: { label: "Open Intelligent CRM", route: "/dashboard/crm" },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async customerSales(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "sales");
    const { data: customers, error: customerError } = await this.db
      .from("customers")
      .select("id,customer_code,customer_name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(2000);
    if (customerError) throw customerError;
    const resolved = this.resolveRows(
      prompt,
      extracted.counterparty_query,
      customers || [],
      ["customer_code", "customer_name"],
    );
    if (!resolved.match) {
      const names = resolved.candidates
        .map((row: any) => row.customer_name)
        .filter(Boolean)
        .join(", ");
      return this.needs(
        "CUSTOMER_SALES",
        "Customer sales",
        names
          ? `Which customer did you mean: ${names}?`
          : "Which customer should I analyse? Please enter the customer name or code.",
      );
    }
    const period = this.period(prompt);
    if (!period)
      return this.needs(
        "CUSTOMER_SALES",
        `Sales — ${resolved.match.customer_name}`,
        "Which period should I use, for example last 3 months, last 90 days, or Q2 2026?",
      );
    const [productResult, serviceResult] = await Promise.all([
      this.db
        .from("invoices")
        .select(
          "id,invoice_number,invoice_date,net_amount,credited_amount,billing_status,currency_code",
        )
        .eq("tenant_id", tenantId)
        .eq("customer_id", resolved.match.id)
        .gte("invoice_date", period.from)
        .lte("invoice_date", period.to)
        .order("invoice_date", { ascending: false }),
      this.db
        .from("customer_service_invoices")
        .select("id,invoice_number,invoice_date,net_amount,billing_status")
        .eq("tenant_id", tenantId)
        .eq("customer_id", resolved.match.id)
        .gte("invoice_date", period.from)
        .lte("invoice_date", period.to)
        .order("invoice_date", { ascending: false }),
    ]);
    if (productResult.error) throw productResult.error;
    if (serviceResult.error) throw serviceResult.error;
    const product = (productResult.data || []).filter(
      (row: any) =>
        String(row.billing_status || "POSTED").toUpperCase() !== "CANCELLED",
    );
    const service = (serviceResult.data || []).filter(
      (row: any) =>
        String(row.billing_status || "POSTED").toUpperCase() !== "CANCELLED",
    );
    const rows = [
      ...product.map((row: any) => ({
        ...row,
        source: "Product invoice",
        net_sales: amount(row.net_amount) - amount(row.credited_amount),
      })),
      ...service.map((row: any) => ({
        ...row,
        source: "Service invoice",
        currency_code: "INR",
        net_sales: amount(row.net_amount),
      })),
    ].sort((left, right) =>
      String(right.invoice_date).localeCompare(String(left.invoice_date)),
    );
    const currencies = [
      ...new Set(rows.map((row) => row.currency_code || "INR")),
    ];
    const currency = currencies.length === 1 ? currencies[0] : "MIXED";
    const totalsByCurrency = new Map<string, number>();
    for (const row of rows)
      totalsByCurrency.set(
        row.currency_code || "INR",
        (totalsByCurrency.get(row.currency_code || "INR") || 0) + row.net_sales,
      );
    const total =
      currencies.length <= 1 ? [...totalsByCurrency.values()][0] || 0 : null;
    const totalLabel = [...totalsByCurrency.entries()]
      .map(([code, totalValue]) => `${totalValue.toFixed(2)} ${code}`)
      .join(" + ");
    const monthly = new Map<string, number>();
    for (const row of rows) {
      const month = String(row.invoice_date).slice(0, 7);
      monthly.set(month, (monthly.get(month) || 0) + row.net_sales);
    }
    return {
      kind: "CUSTOMER_SALES",
      status: "READY",
      title: `Sales — ${resolved.match.customer_name}`,
      headline: `${rows.length} posted invoice${rows.length === 1 ? "" : "s"} total ${totalLabel || `0.00 ${currency}`}.`,
      questions: [],
      period,
      currency_code: currency,
      metrics: [
        {
          label: "Net invoiced sales",
          value: total === null ? totalLabel : total,
          format: total === null ? "text" : "money",
        },
        { label: "Invoices", value: rows.length, format: "number" },
        {
          label: "Average invoice",
          value:
            total !== null && rows.length
              ? total / rows.length
              : "Not combined",
          format: total === null ? "text" : "money",
        },
      ],
      columns: [
        { key: "month", label: "Month" },
        { key: "sales", label: "Net sales", format: "money" },
      ],
      rows: [...monthly.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, sales]) => ({ month, sales })),
      definition:
        "Posted product and service invoice value, excluding cancelled invoices and net of recorded product-invoice credit notes. This is invoiced sales, not cash collected, and includes tax where the invoice net amount includes tax.",
      warnings:
        currencies.length > 1
          ? [
              "Multiple currencies are present; values are not converted or added across currencies.",
            ]
          : [],
      sources: [
        {
          table: "invoices",
          label: "Product sales invoices",
          record_count: product.length,
        },
        {
          table: "customer_service_invoices",
          label: "Service sales invoices",
          record_count: service.length,
        },
      ],
      drill_down: { label: "Open customer sales", route: "/dashboard/sales" },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async accountsPayableWorkspaceSnapshot(
    tenantId: string,
    vendors: any[],
  ): Promise<{
    groups: Map<string, any>;
    documentCount: number;
    datedDocumentCount: number;
    undatedDocumentCount: number;
    overdueDocumentCount: number;
  } | null> {
    if (!this.debitNotes) return null;
    const [payableDocuments, vendorAdvances] = await Promise.all([
      this.debitNotes.getGrnsWithPaymentStatus(tenantId),
      this.debitNotes.getVendorAdvanceSummary(tenantId),
    ]);
    const vendorById = new Map(
      vendors.map((vendor: any) => [String(vendor.id), vendor]),
    );
    const advanceByVendor = new Map<string, number>();
    for (const advance of vendorAdvances || []) {
      const vendorId = String(advance.vendor_id || advance.vendor?.id || "");
      if (!vendorId) continue;
      advanceByVendor.set(
        vendorId,
        (advanceByVendor.get(vendorId) || 0) + amount(advance.balance_amount),
      );
    }
    const groups = new Map<string, any>();
    let documentCount = 0;
    let datedDocumentCount = 0;
    let undatedDocumentCount = 0;
    let overdueDocumentCount = 0;
    for (const row of payableDocuments || []) {
      const status = String(row.status || "").toUpperCase();
      if (["REJECTED", "CANCELLED", "DRAFT"].includes(status)) continue;
      if (!row.invoice_approved) continue;
      const calculation = row._payment_calculation || {};
      const netPayable = amount(
        calculation.net_payable ?? row.net_payable_amount,
      );
      const outstanding = Math.max(
        0,
        amount(
          calculation.outstanding ??
            row.outstanding_amount ??
            netPayable - amount(calculation.total_settled),
        ),
      );
      if (netPayable <= 0.009 || outstanding <= 0.009) continue;
      const vendorId = String(row.vendor?.id || row.vendor_id || "");
      const vendor = vendorById.get(vendorId) || row.vendor;
      if (!vendorId || !vendor) continue;
      const key = `${vendorId}:INR`;
      const group = groups.get(key) || {
        supplier: vendor.name,
        supplier_code: vendor.code || "",
        vendor_id: vendorId,
        currency_code: "INR",
        total_outstanding: 0,
        overdue_amount: 0,
        open_documents: 0,
        overdue_documents: 0,
      };
      group.total_outstanding += outstanding;
      group.open_documents += 1;
      if (row.due_date) datedDocumentCount += 1;
      else undatedDocumentCount += 1;
      if (row.is_overdue) {
        group.overdue_amount += outstanding;
        group.overdue_documents += 1;
        overdueDocumentCount += 1;
      }
      groups.set(key, group);
      documentCount += 1;
    }
    for (const [key, group] of [...groups.entries()]) {
      const availableAdvance =
        advanceByVendor.get(String(group.vendor_id)) || 0;
      group.total_outstanding = Math.max(
        0,
        group.total_outstanding - availableAdvance,
      );
      // Available vendor advance is applied to the oldest exposure first for
      // ageing presentation, without posting an accounting settlement.
      group.overdue_amount = Math.max(
        0,
        group.overdue_amount - availableAdvance,
      );
      if (group.total_outstanding <= 0.009) groups.delete(key);
    }
    return {
      groups,
      documentCount,
      datedDocumentCount,
      undatedDocumentCount,
      overdueDocumentCount,
    };
  }

  private async supplierDuesOverview(
    tenantId: string,
    vendors: any[],
    prompt: string,
    extracted: any = {},
  ): Promise<AnalyticsAnswer> {
    const today = iso(new Date());
    const promptText = normalized(prompt);
    const semanticOperation = value(extracted.query_operation).toUpperCase();
    const overdueOnly =
      semanticOperation === "OVERDUE" ||
      (!semanticOperation && /\boverdue\b/.test(promptText));
    const topSupplierOnly =
      semanticOperation === "RANK_TOP" ||
      (!semanticOperation &&
        (/\b(highest|largest|biggest|maximum|max|top|most)\b/.test(
          promptText,
        ) ||
          /\bsabse zyada\b/.test(promptText)));
    const [
      { data: parties, error: partyError },
      { data: openItems, error: itemError },
    ] = await Promise.all([
      this.db
        .from("accounting_parties")
        .select("id,party_id,party_code,party_name")
        .eq("tenant_id", tenantId)
        .eq("party_type", "SUPPLIER")
        .eq("is_active", true),
      this.db
        .from("accounting_open_items")
        .select(
          "id,party_id,document_number,due_date,original_amount,settled_amount,currency_code,status",
        )
        .eq("tenant_id", tenantId)
        .eq("direction", "PAYABLE")
        .in("status", ["OPEN", "PARTIAL"]),
    ]);
    if (partyError || itemError) throw partyError || itemError;
    const partyById = new Map((parties || []).map((row: any) => [row.id, row]));
    const vendorById = new Map(
      vendors.map((row: any) => [String(row.id), row]),
    );
    const vendorByCode = new Map(
      vendors.map((row: any) => [normalized(row.code), row]),
    );
    const workspace = await this.accountsPayableWorkspaceSnapshot(
      tenantId,
      vendors,
    );
    const groups = workspace?.groups || new Map<string, any>();
    let documentCount = workspace?.documentCount || 0;
    let sourceMode: "AP_WORKSPACE" | "ACCOUNTING" | "OPERATIONAL" = workspace
      ? "AP_WORKSPACE"
      : "ACCOUNTING";
    const workspaceAuthoritative = Boolean(workspace);
    let overdueAgeingUnavailable = Boolean(
      overdueOnly &&
      workspace &&
      workspace.documentCount > 0 &&
      workspace.datedDocumentCount === 0,
    );
    if (overdueOnly && workspace && !overdueAgeingUnavailable) {
      for (const [key, group] of [...groups.entries()]) {
        if (group.overdue_amount <= 0.009) groups.delete(key);
      }
      documentCount = workspace.overdueDocumentCount;
    }
    for (const item of !workspaceAuthoritative ? openItems || [] : []) {
      const outstanding = Math.max(
        0,
        amount(item.original_amount) - amount(item.settled_amount),
      );
      const overdue = Boolean(item.due_date && item.due_date < today);
      if (outstanding <= 0 || (overdueOnly && !overdue)) continue;
      const party: any = partyById.get(item.party_id);
      if (!party) continue;
      const vendor =
        vendorById.get(String(party.party_id || "")) ||
        vendorByCode.get(normalized(party.party_code));
      const currency = item.currency_code || "INR";
      const supplier = vendor?.name || party.party_name || party.party_code;
      const key = `${party.id}:${currency}`;
      const group = groups.get(key) || {
        supplier,
        supplier_code: vendor?.code || party.party_code || "",
        currency_code: currency,
        total_outstanding: 0,
        overdue_amount: 0,
        open_documents: 0,
      };
      group.total_outstanding += outstanding;
      if (overdue) group.overdue_amount += outstanding;
      group.open_documents += 1;
      groups.set(key, group);
      documentCount += 1;
    }
    if (groups.size === 0 && !workspaceAuthoritative) {
      const [materialResult, serviceResult] = await Promise.all([
        this.db
          .from("grns")
          .select(
            "id,vendor_id,invoice_number,grn_number,net_payable_amount,paid_amount,payment_status,status,invoice_approved",
          )
          .eq("tenant_id", tenantId)
          .eq("invoice_approved", true)
          .limit(5000),
        this.db
          .from("service_invoices")
          .select(
            "id,invoice_number,invoice_amount,paid_amount,status,ses:service_entry_sheets(vendor_id)",
          )
          .eq("tenant_id", tenantId)
          .limit(5000),
      ]);
      if (materialResult.error || serviceResult.error)
        throw materialResult.error || serviceResult.error;
      const addOperationalBalance = (
        vendorId: unknown,
        original: unknown,
        settled: unknown,
      ) => {
        const outstanding = Math.max(amount(original) - amount(settled), 0);
        const vendor = vendorById.get(String(vendorId || ""));
        if (!vendor || outstanding <= 0) return;
        const key = `${vendor.id}:INR`;
        const group = groups.get(key) || {
          supplier: vendor.name,
          supplier_code: vendor.code || "",
          currency_code: "INR",
          total_outstanding: 0,
          overdue_amount: 0,
          open_documents: 0,
        };
        group.total_outstanding += outstanding;
        group.open_documents += 1;
        groups.set(key, group);
        documentCount += 1;
      };
      for (const row of materialResult.data || []) {
        if (
          ["PAID", "CANCELLED", "REJECTED"].includes(
            String(row.payment_status || row.status || "").toUpperCase(),
          )
        )
          continue;
        addOperationalBalance(
          row.vendor_id,
          row.net_payable_amount,
          row.paid_amount,
        );
      }
      for (const row of serviceResult.data || []) {
        if (
          ["PAID", "REJECTED", "CANCELLED"].includes(
            String(row.status || "").toUpperCase(),
          )
        )
          continue;
        const ses = Array.isArray(row.ses) ? row.ses[0] : row.ses;
        addOperationalBalance(
          ses?.vendor_id,
          row.invoice_amount,
          row.paid_amount,
        );
      }
      sourceMode = "OPERATIONAL";
      overdueAgeingUnavailable = overdueOnly && groups.size > 0;
    }
    const rows = [...groups.values()].sort((left, right) =>
      overdueOnly
        ? right.overdue_amount - left.overdue_amount ||
          right.total_outstanding - left.total_outstanding
        : right.total_outstanding - left.total_outstanding ||
          right.overdue_amount - left.overdue_amount,
    );
    const totals = new Map<string, { outstanding: number; overdue: number }>();
    for (const row of rows) {
      const bucket = totals.get(row.currency_code) || {
        outstanding: 0,
        overdue: 0,
      };
      bucket.outstanding += row.total_outstanding;
      bucket.overdue += row.overdue_amount;
      totals.set(row.currency_code, bucket);
    }
    const totalLabel = [...totals.entries()]
      .map(([code, bucket]) => `${bucket.outstanding.toFixed(2)} ${code}`)
      .join(" + ");
    const overdueLabel = [...totals.entries()]
      .map(([code, bucket]) => `${bucket.overdue.toFixed(2)} ${code}`)
      .join(" + ");
    const currencies = [...totals.keys()];
    const singleCurrency = currencies.length <= 1;
    const currency = singleCurrency ? currencies[0] || "INR" : "MIXED";
    const singleTotal = totals.get(currencies[0]) || {
      outstanding: 0,
      overdue: 0,
    };
    const topSupplier = rows[0];
    return {
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: overdueAgeingUnavailable
        ? "Supplier payables — overdue ageing unavailable"
        : topSupplierOnly
          ? overdueOnly
            ? "Supplier with highest overdue AP"
            : "Supplier with highest AP"
          : overdueOnly
            ? "Overdue supplier payments"
            : "Supplier payables",
      headline:
        overdueAgeingUnavailable && rows.length
          ? `The Accounts Payable workspace has ${totalLabel} outstanding across ${rows.length} supplier${rows.length === 1 ? "" : "s"} and ${documentCount} open document${documentCount === 1 ? "" : "s"}. These documents do not currently have governed due dates, so the system cannot truthfully classify them as overdue.`
          : topSupplierOnly && topSupplier
            ? `${topSupplier.supplier} has the highest ${overdueOnly ? "overdue " : ""}accounts-payable balance: ${(overdueOnly ? topSupplier.overdue_amount : topSupplier.total_outstanding).toFixed(2)} ${topSupplier.currency_code} across ${topSupplier.open_documents} open document${topSupplier.open_documents === 1 ? "" : "s"}.`
            : rows.length
              ? `${rows.length} supplier balance${rows.length === 1 ? "" : "s"} across ${documentCount} open document${documentCount === 1 ? "" : "s"}; ${overdueOnly ? "overdue" : "outstanding"} ${overdueOnly ? overdueLabel : totalLabel}.`
              : overdueOnly
                ? sourceMode === "AP_WORKSPACE"
                  ? "No overdue supplier payables were found using receipt dates and governed payment terms."
                  : "No overdue supplier payables were found in the accounting open-item ledger."
                : sourceMode === "AP_WORKSPACE"
                  ? "No open supplier payables were found in the Accounts Payable workspace."
                  : "No open supplier payables were found in the accounting open-item ledger.",
      questions: [],
      period: { from: "", to: today, label: `Outstanding as of ${today}` },
      currency_code: currency,
      metrics: [
        {
          label: overdueAgeingUnavailable
            ? "Current AP outstanding"
            : overdueOnly
              ? "Overdue"
              : "Total outstanding",
          value: singleCurrency
            ? overdueAgeingUnavailable
              ? singleTotal.outstanding
              : overdueOnly
                ? singleTotal.overdue
                : singleTotal.outstanding
            : overdueAgeingUnavailable
              ? totalLabel
              : overdueOnly
                ? overdueLabel
                : totalLabel,
          format: singleCurrency ? "money" : "text",
        },
        { label: "Suppliers", value: rows.length, format: "number" },
        { label: "Open documents", value: documentCount, format: "number" },
      ],
      columns: overdueAgeingUnavailable
        ? [
            { key: "supplier", label: "Supplier" },
            {
              key: "total_outstanding",
              label: "Current AP outstanding",
              format: "money",
            },
            { key: "open_documents", label: "Documents", format: "number" },
          ]
        : [
            { key: "supplier", label: "Supplier" },
            {
              key: "total_outstanding",
              label: "Outstanding",
              format: "money",
            },
            { key: "overdue_amount", label: "Overdue", format: "money" },
            { key: "open_documents", label: "Documents", format: "number" },
          ],
      rows: topSupplierOnly ? rows.slice(0, 1) : rows.slice(0, 100),
      definition:
        sourceMode === "AP_WORKSPACE"
          ? "The same governed settlement calculation used by the Accounts Payable workspace: sanctioned supplier documents less cash, TDS, short settlement, reversals, allocated PO advances and available vendor advances; subcontract payables are included."
          : sourceMode === "ACCOUNTING"
            ? "Authoritative supplier payable open items grouped by supplier and currency. Outstanding is original amount less settled amount; overdue requires a due date before today."
            : "Approved operational supplier invoices from material GRNs and service-entry controls, grouped by supplier. Outstanding is invoice/net payable less recorded payments.",
      warnings: [
        ...(overdueAgeingUnavailable
          ? [
              "Outstanding AP exists, but overdue ageing is unavailable because governed due dates are not present on these operational payable documents.",
            ]
          : []),
        ...(overdueOnly &&
        workspace &&
        workspace.undatedDocumentCount > 0 &&
        workspace.datedDocumentCount > 0
          ? [
              `${workspace.undatedDocumentCount} payable document${workspace.undatedDocumentCount === 1 ? "" : "s"} could not be aged because neither a receipt date nor invoice date was available.`,
            ]
          : []),
        ...(sourceMode === "OPERATIONAL"
          ? [
              "No accounting payable open items were found; this answer uses approved operational supplier invoices. Due-date ageing is unavailable until accounting-subledger mapping is completed.",
            ]
          : []),
        ...(currencies.length > 1
          ? [
              "Multiple currencies are shown separately and are not converted or added.",
            ]
          : []),
      ],
      sources: [
        {
          table:
            sourceMode === "AP_WORKSPACE"
              ? "grns / grn_payment_entries / advances / subcontract_order_steps"
              : sourceMode === "ACCOUNTING"
                ? "accounting_open_items"
                : "grns / service_invoices",
          label:
            sourceMode === "AP_WORKSPACE"
              ? "Accounts Payable workspace settlement engine"
              : sourceMode === "ACCOUNTING"
                ? "Governed supplier payable open items"
                : "Approved operational supplier invoices",
          record_count: documentCount,
        },
      ],
      drill_down: {
        label: "Open supplier payables",
        route: "/dashboard/accounts/payables",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async supplierDues(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "accounting");
    const { data: vendors, error: vendorError } = await this.db
      .from("vendors")
      .select("id,code,name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(2000);
    if (vendorError) throw vendorError;
    const promptText = normalized(prompt);
    const namedVendorInPrompt = (vendors || []).some((vendor: any) =>
      [vendor.code, vendor.name]
        .map((entry) => normalized(entry))
        .filter((entry) => entry.length >= 2)
        .some((entry) => promptText.includes(entry)),
    );
    const supplierPortfolioQuestion =
      /\b(which|what|who|list|show|give|tell)\b.*\b(supplier|suppliers|vendor|vendors)\b.*\b(ap|accounts payable|due|dues|outstanding|payable|payables|owed|owing|overdue|unpaid|payment|payments)\b/.test(
        promptText,
      ) ||
      /\b(supplier|suppliers|vendor|vendors)\b.*\b(which|what|who|list|show|give|tell|overdue|unpaid)\b.*\b(ap|accounts payable|due|dues|outstanding|payable|payables|owed|owing|overdue|unpaid|payment|payments)\b/.test(
        promptText,
      );
    const semanticScope = value(extracted.query_scope).toUpperCase();
    const fallbackGenericSupplierScope =
      /\b(any|all)\s+(supplier|suppliers|vendor|vendors)\b/.test(promptText) ||
      (/\b(highest|largest|biggest|maximum|max|top|most|sabse zyada)\b/.test(
        promptText,
      ) &&
        /\b(ap|accounts payable|supplier|suppliers|vendor|vendors|payable|payables|due|dues|outstanding)\b/.test(
          promptText,
        )) ||
      /\bwho\b.*\bowe\b.*\bmost\b/.test(promptText) ||
      /\b(overdue\s+payments?|supplier\s+dues|supplier\s+payables|vendor\s+dues|vendor\s+payables)\s+(?:overview|summary|report)\b/.test(
        promptText,
      ) ||
      (supplierPortfolioQuestion && !namedVendorInPrompt) ||
      (!value(extracted.counterparty_query) &&
        /\b(overdue\s+payments?|supplier\s+dues|supplier\s+payables|vendor\s+dues|vendor\s+payables)\b/.test(
          promptText,
        ));
    const genericSupplierScope =
      semanticScope === "PORTFOLIO" ||
      (!semanticScope && fallbackGenericSupplierScope);
    if (genericSupplierScope)
      return this.supplierDuesOverview(
        tenantId,
        vendors || [],
        prompt,
        extracted,
      );
    const resolved = this.resolveRows(
      prompt,
      extracted.counterparty_query,
      vendors || [],
      ["code", "name"],
    );
    if (!resolved.match) {
      const names = resolved.candidates
        .map((row: any) => row.name)
        .filter(Boolean)
        .join(", ");
      return this.needs(
        "SUPPLIER_DUES",
        "Supplier dues",
        names
          ? `Which supplier did you mean: ${names}?`
          : "Which supplier should I analyse? Please enter the supplier name or code.",
      );
    }
    const { data: parties, error: partyError } = await this.db
      .from("accounting_parties")
      .select("id,party_id,party_code,party_name")
      .eq("tenant_id", tenantId)
      .eq("party_type", "SUPPLIER")
      .eq("is_active", true);
    if (partyError) throw partyError;
    const party = (parties || []).find(
      (row: any) =>
        String(row.party_id || "") === String(resolved.match.id) ||
        normalized(row.party_code) === normalized(resolved.match.code),
    );
    const today = iso(new Date());
    let rows: any[] = [];
    let sourceMode: "ACCOUNTING" | "OPERATIONAL" = "ACCOUNTING";
    if (party) {
      const { data, error } = await this.db
        .from("accounting_open_items")
        .select(
          "id,document_number,document_type,document_date,due_date,original_amount,settled_amount,currency_code,status",
        )
        .eq("tenant_id", tenantId)
        .eq("party_id", party.id)
        .eq("direction", "PAYABLE")
        .in("status", ["OPEN", "PARTIAL"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      rows = (data || []).map((row: any) => ({
        ...row,
        outstanding: Math.max(
          0,
          amount(row.original_amount) - amount(row.settled_amount),
        ),
        overdue: Boolean(row.due_date && row.due_date < today),
      }));
    }
    if (rows.length === 0) {
      const [materialResult, serviceResult] = await Promise.all([
        this.db
          .from("grns")
          .select(
            "id,grn_number,invoice_number,invoice_date,net_payable_amount,paid_amount,payment_status,invoice_approved,status",
          )
          .eq("tenant_id", tenantId)
          .eq("vendor_id", resolved.match.id)
          .eq("invoice_approved", true),
        this.db
          .from("service_invoices")
          .select(
            "id,invoice_number,invoice_date,invoice_amount,paid_amount,status,ses:service_entry_sheets(vendor_id)",
          )
          .eq("tenant_id", tenantId)
          .limit(1000),
      ]);
      if (materialResult.error) throw materialResult.error;
      if (serviceResult.error) throw serviceResult.error;
      const material = (materialResult.data || [])
        .filter(
          (row: any) =>
            !["PAID", "CANCELLED", "REJECTED"].includes(
              String(row.payment_status || row.status || "").toUpperCase(),
            ),
        )
        .map((row: any) => ({
          document_number: row.invoice_number || row.grn_number,
          document_type: "MATERIAL_INVOICE",
          document_date: row.invoice_date,
          due_date: null,
          original_amount: amount(row.net_payable_amount),
          settled_amount: amount(row.paid_amount),
          currency_code: "INR",
          outstanding: Math.max(
            0,
            amount(row.net_payable_amount) - amount(row.paid_amount),
          ),
          overdue: false,
        }));
      const serviceRows = (serviceResult.data || [])
        .filter(
          (row: any) =>
            String(row.ses?.vendor_id || "") === String(resolved.match.id) &&
            !["PAID", "REJECTED"].includes(
              String(row.status || "").toUpperCase(),
            ),
        )
        .map((row: any) => ({
          document_number: row.invoice_number,
          document_type: "SERVICE_INVOICE",
          document_date: row.invoice_date,
          due_date: null,
          original_amount: amount(row.invoice_amount),
          settled_amount: amount(row.paid_amount),
          currency_code: "INR",
          outstanding: Math.max(
            0,
            amount(row.invoice_amount) - amount(row.paid_amount),
          ),
          overdue: false,
        }));
      rows = [...material, ...serviceRows].filter((row) => row.outstanding > 0);
      sourceMode = "OPERATIONAL";
    }
    const currencies = [
      ...new Set(rows.map((row) => row.currency_code || "INR")),
    ];
    const currency = currencies.length <= 1 ? currencies[0] || "INR" : "MIXED";
    const totalsByCurrency = new Map<string, number>();
    const overdueByCurrency = new Map<string, number>();
    for (const row of rows) {
      const code = row.currency_code || "INR";
      totalsByCurrency.set(
        code,
        (totalsByCurrency.get(code) || 0) + row.outstanding,
      );
      if (row.overdue)
        overdueByCurrency.set(
          code,
          (overdueByCurrency.get(code) || 0) + row.outstanding,
        );
    }
    const total =
      currencies.length <= 1 ? [...totalsByCurrency.values()][0] || 0 : null;
    const overdue =
      currencies.length <= 1 ? [...overdueByCurrency.values()][0] || 0 : null;
    const totalLabel = [...totalsByCurrency.entries()]
      .map(([code, totalValue]) => `${totalValue.toFixed(2)} ${code}`)
      .join(" + ");
    const overdueLabel = [...overdueByCurrency.entries()]
      .map(([code, totalValue]) => `${totalValue.toFixed(2)} ${code}`)
      .join(" + ");
    return {
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: `Supplier dues — ${resolved.match.name}`,
      headline: `${rows.length} open payable${rows.length === 1 ? "" : "s"} total ${totalLabel || `0.00 ${currency}`}; overdue ${overdueLabel || `0.00 ${currency}`}.`,
      questions: [],
      period: { from: "", to: today, label: `Outstanding as of ${today}` },
      currency_code: currency,
      metrics: [
        {
          label: "Total outstanding",
          value: total === null ? totalLabel : total,
          format: total === null ? "text" : "money",
        },
        {
          label: "Overdue",
          value: overdue === null ? overdueLabel : overdue,
          format: overdue === null ? "text" : "money",
        },
        { label: "Open documents", value: rows.length, format: "number" },
      ],
      columns: [
        { key: "document_number", label: "Document" },
        { key: "due_date", label: "Due date", format: "date" },
        { key: "outstanding", label: "Outstanding", format: "money" },
        { key: "age", label: "State" },
      ],
      rows: rows.slice(0, 100).map((row) => ({
        document_number: row.document_number,
        due_date: row.due_date,
        outstanding: row.outstanding,
        age: row.overdue ? "OVERDUE" : "NOT DUE",
      })),
      definition:
        sourceMode === "ACCOUNTING"
          ? "Authoritative accounting payable open items: original amount less settled amount for OPEN and PARTIAL supplier documents. Cancelled and settled documents are excluded."
          : "Operational supplier invoices approved through material GRN or service-entry controls: invoice/net payable less recorded payments. Settled, rejected and cancelled documents are excluded.",
      warnings: [
        ...(sourceMode === "OPERATIONAL"
          ? [
              "No accounting payable open items were found; this answer uses approved operational supplier invoices. Due-date ageing is unavailable until these invoices are mapped to the accounting subledger.",
            ]
          : []),
        ...(currencies.length > 1
          ? [
              "Multiple currencies are present; values are not converted or added across currencies.",
            ]
          : []),
      ],
      sources: [
        {
          table:
            sourceMode === "ACCOUNTING"
              ? "accounting_open_items"
              : "grns / service_invoices",
          label:
            sourceMode === "ACCOUNTING"
              ? "Governed supplier payable open items"
              : "Approved operational supplier invoices",
          record_count: rows.length,
        },
      ],
      drill_down: {
        label: "Open supplier payables",
        route: "/dashboard/accounts/payables",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async supplierAdvances(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "accounting");
    const { data: vendors, error: vendorError } = await this.db
      .from("vendors")
      .select("id,code,name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(2000);
    if (vendorError) throw vendorError;
    const semanticScope = value(extracted.query_scope).toUpperCase();
    let selectedVendor: any = null;
    if (semanticScope === "ENTITY" || value(extracted.counterparty_query)) {
      const resolved = this.resolveRows(
        prompt,
        extracted.counterparty_query,
        vendors || [],
        ["code", "name"],
      );
      if (!resolved.match) {
        const names = resolved.candidates
          .map((row: any) => row.name)
          .filter(Boolean)
          .join(", ");
        return this.needs(
          "SUPPLIER_ADVANCES",
          "Supplier advances",
          names
            ? `Which supplier did you mean: ${names}?`
            : "Which supplier should I analyse? Please enter the supplier name or code.",
        );
      }
      selectedVendor = resolved.match;
    }
    let advances: any[] = [];
    if (this.debitNotes) {
      advances = await this.debitNotes.getUnifiedAdvances(tenantId, {
        advance_type: "ALL",
        vendor_id: selectedVendor?.id,
        has_balance: true,
      });
    } else {
      let query = this.db
        .from("po_advance_payments")
        .select(
          "id,vendor_id,po_id,advance_type,amount,utilized_amount,balance_amount,payment_date,payment_reference,vendor:vendors(id,code,name),purchase_order:purchase_orders(id,po_number)",
        )
        .eq("tenant_id", tenantId)
        .gt("balance_amount", 0)
        .order("payment_date", { ascending: false })
        .limit(5000);
      if (selectedVendor) query = query.eq("vendor_id", selectedVendor.id);
      const result = await query;
      if (result.error) throw result.error;
      advances = result.data || [];
    }
    const vendorById = new Map(
      (vendors || []).map((vendor: any) => [String(vendor.id), vendor]),
    );
    const groups = new Map<string, any>();
    for (const advance of advances || []) {
      const available = amount(advance.balance_amount);
      if (available <= 0.009) continue;
      const vendorId = String(advance.vendor_id || advance.vendor?.id || "");
      const vendor = vendorById.get(vendorId) || advance.vendor;
      if (!vendorId || !vendor) continue;
      const type = String(advance.advance_type || "PO").toUpperCase();
      const group = groups.get(vendorId) || {
        supplier: vendor.name,
        supplier_code: vendor.code || "",
        available_advance: 0,
        original_advance: 0,
        utilized_amount: 0,
        open_advances: 0,
        po_advances: 0,
        blanket_advances: 0,
        latest_advance_date: null,
        currency_code: "INR",
      };
      group.available_advance += available;
      group.original_advance += amount(advance.amount);
      group.utilized_amount += amount(advance.utilized_amount);
      group.open_advances += 1;
      if (type === "BLANKET") group.blanket_advances += 1;
      else group.po_advances += 1;
      if (
        advance.payment_date &&
        (!group.latest_advance_date ||
          String(advance.payment_date) > String(group.latest_advance_date))
      )
        group.latest_advance_date = advance.payment_date;
      groups.set(vendorId, group);
    }
    const rows = [...groups.values()].sort(
      (left, right) => right.available_advance - left.available_advance,
    );
    const availableTotal = rows.reduce(
      (sum, row) => sum + row.available_advance,
      0,
    );
    const recordCount = rows.reduce((sum, row) => sum + row.open_advances, 0);
    return {
      kind: "SUPPLIER_ADVANCES",
      status: "READY",
      title: selectedVendor
        ? `Available advances — ${selectedVendor.name}`
        : "Available supplier advances",
      headline: rows.length
        ? `${rows.length} supplier${rows.length === 1 ? " has" : "s have"} ${availableTotal.toFixed(2)} INR available across ${recordCount} open advance record${recordCount === 1 ? "" : "s"}.`
        : selectedVendor
          ? `No open advance balance is available for ${selectedVendor.name}.`
          : "No open supplier advance balances were found.",
      questions: [],
      period: {
        from: "",
        to: iso(new Date()),
        label: `Available as of ${iso(new Date())}`,
      },
      currency_code: "INR",
      metrics: [
        {
          label: "Available advances",
          value: availableTotal,
          format: "money",
        },
        { label: "Suppliers", value: rows.length, format: "number" },
        { label: "Open advances", value: recordCount, format: "number" },
      ],
      columns: [
        { key: "supplier", label: "Supplier" },
        {
          key: "available_advance",
          label: "Available advance",
          format: "money",
        },
        { key: "po_advances", label: "PO advances", format: "number" },
        {
          key: "blanket_advances",
          label: "Blanket advances",
          format: "number",
        },
        {
          key: "latest_advance_date",
          label: "Latest advance date",
          format: "date",
        },
      ],
      rows: rows.slice(0, 100),
      definition:
        "Open supplier advances recorded in the governed advance ledger. Available advance is the remaining unutilized balance, grouped by supplier; PO-linked and blanket advances are shown separately.",
      warnings: [],
      sources: [
        {
          table: "po_advance_payments",
          label: "Open supplier advance balances",
          record_count: recordCount,
        },
      ],
      drill_down: {
        label: "Open supplier advances",
        route: "/dashboard/accounts/payables?workspace=advances",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async supplierPayments(
    tenantId: string,
    user: any,
    _prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "accounting");
    const { data: vendors, error: vendorError } = await this.db
      .from("vendors")
      .select("id,code,name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(2000);
    if (vendorError) throw vendorError;

    const scope = value(extracted.query_scope).toUpperCase();
    const operation = value(extracted.query_operation).toUpperCase();
    let selectedVendor: any = null;
    if (scope === "ENTITY") {
      const resolved = this.resolveRows(
        _prompt,
        extracted.counterparty_query,
        vendors || [],
        ["code", "name"],
      );
      if (!resolved.match)
        return this.needs(
          "SUPPLIER_PAYMENTS",
          "Supplier payments",
          "Which supplier should I analyse? Please enter the supplier name or code.",
        );
      selectedVendor = resolved.match;
    }

    const { data, error } = await this.db
      .from("grn_payment_entries")
      .select(
        "id,payment_date,amount,payment_method,payment_reference,tds_amount,short_payment_amount,grn:grns(id,grn_number,invoice_number,vendor_id,vendor:vendors(id,code,name))",
      )
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const allRows = (data || [])
      .filter(
        (row: any) =>
          !selectedVendor ||
          String(row.grn?.vendor_id || "") === String(selectedVendor.id),
      )
      .map((row: any) => ({
        supplier:
          row.grn?.vendor?.name || selectedVendor?.name || "Unknown supplier",
        supplier_code: row.grn?.vendor?.code || selectedVendor?.code || "",
        payment_date: row.payment_date,
        amount: amount(row.amount),
        payment_method: row.payment_method || "",
        payment_reference: row.payment_reference || "",
        document: row.grn?.invoice_number || row.grn?.grn_number || "",
      }));
    const rows = (operation === "LATEST" ? allRows.slice(0, 1) : allRows).slice(
      0,
      100,
    );
    const latest = rows[0];
    const subject = selectedVendor ? ` for ${selectedVendor.name}` : "";
    return {
      kind: "SUPPLIER_PAYMENTS",
      status: "READY",
      title:
        operation === "LATEST"
          ? `Latest supplier payment${subject}`
          : `Supplier payment history${subject}`,
      headline: latest
        ? `Latest recorded supplier payment${subject}: ${latest.amount.toFixed(2)} INR to ${latest.supplier} on ${latest.payment_date}.`
        : `No recorded supplier payments were found${subject}.`,
      questions: [],
      currency_code: "INR",
      metrics: [
        { label: "Payments found", value: allRows.length, format: "number" },
        {
          label: "Latest payment",
          value: latest ? latest.amount : 0,
          format: "money",
        },
      ],
      columns: [
        { key: "payment_date", label: "Payment date", format: "date" },
        { key: "supplier", label: "Supplier" },
        { key: "document", label: "Invoice / GRN" },
        { key: "amount", label: "Amount", format: "money" },
        { key: "payment_method", label: "Method" },
        { key: "payment_reference", label: "Reference" },
      ],
      rows,
      definition:
        "Recorded, non-aggregated supplier payments against material GRN invoices, ordered by payment date and creation time.",
      sources: [
        {
          table: "grn_payment_entries / grns / vendors",
          label: "Recorded supplier invoice payments",
          record_count: allRows.length,
        },
      ],
      drill_down: {
        label: "Open supplier invoices",
        route: "/dashboard/accounts/supplier-invoices",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async customerReceivables(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "accounting");
    const { data: customers, error: customerError } = await this.db
      .from("customers")
      .select("id,customer_code,customer_name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(2000);
    if (customerError) throw customerError;
    const resolved = this.resolveRows(
      prompt,
      extracted.counterparty_query,
      customers || [],
      ["customer_code", "customer_name"],
    );
    if (!resolved.match) {
      const names = resolved.candidates
        .map((row: any) => row.customer_name)
        .filter(Boolean)
        .join(", ");
      return this.needs(
        "CUSTOMER_RECEIVABLES",
        "Customer receivables",
        names
          ? `Which customer did you mean: ${names}?`
          : "Which customer should I analyse? Please enter the customer name or code.",
      );
    }
    const { data: parties, error: partyError } = await this.db
      .from("accounting_parties")
      .select("id,party_id,party_code")
      .eq("tenant_id", tenantId)
      .eq("party_type", "CUSTOMER")
      .eq("is_active", true);
    if (partyError) throw partyError;
    const party = (parties || []).find(
      (row: any) =>
        String(row.party_id || "") === String(resolved.match.id) ||
        normalized(row.party_code) === normalized(resolved.match.customer_code),
    );
    const today = iso(new Date());
    let rows: any[] = [];
    let sourceMode: "ACCOUNTING" | "OPERATIONAL" = "ACCOUNTING";
    if (party) {
      const { data, error } = await this.db
        .from("accounting_open_items")
        .select(
          "id,document_number,document_date,due_date,original_amount,settled_amount,currency_code,status",
        )
        .eq("tenant_id", tenantId)
        .eq("party_id", party.id)
        .eq("direction", "RECEIVABLE")
        .in("status", ["OPEN", "PARTIAL"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      rows = (data || []).map((row: any) => ({
        ...row,
        outstanding: Math.max(
          0,
          amount(row.original_amount) - amount(row.settled_amount),
        ),
        overdue: Boolean(row.due_date && row.due_date < today),
      }));
    }
    if (!rows.length) {
      const { data, error } = await this.db
        .from("invoices")
        .select(
          "id,invoice_number,invoice_date,due_date,net_amount,paid_amount,balance_amount,currency_code,billing_status,payment_status",
        )
        .eq("tenant_id", tenantId)
        .eq("customer_id", resolved.match.id)
        .order("due_date", { ascending: true });
      if (error) throw error;
      rows = (data || [])
        .filter(
          (row: any) =>
            !["CANCELLED", "PAID"].includes(
              String(
                row.billing_status || row.payment_status || "",
              ).toUpperCase(),
            ),
        )
        .map((row: any) => {
          const outstanding =
            row.balance_amount == null
              ? Math.max(0, amount(row.net_amount) - amount(row.paid_amount))
              : Math.max(0, amount(row.balance_amount));
          return {
            document_number: row.invoice_number,
            document_date: row.invoice_date,
            due_date: row.due_date,
            currency_code: row.currency_code || "INR",
            outstanding,
            overdue: Boolean(row.due_date && row.due_date < today),
          };
        })
        .filter((row: any) => row.outstanding > 0);
      sourceMode = "OPERATIONAL";
    }
    const totals = new Map<string, { total: number; overdue: number }>();
    for (const row of rows) {
      const code = row.currency_code || "INR";
      const bucket = totals.get(code) || { total: 0, overdue: 0 };
      bucket.total += row.outstanding;
      if (row.overdue) bucket.overdue += row.outstanding;
      totals.set(code, bucket);
    }
    const currencies = [...totals.keys()];
    const currency = currencies.length <= 1 ? currencies[0] || "INR" : "MIXED";
    const totalLabel = [...totals.entries()]
      .map(([code, bucket]) => `${bucket.total.toFixed(2)} ${code}`)
      .join(" + ");
    const overdueLabel = [...totals.entries()]
      .map(([code, bucket]) => `${bucket.overdue.toFixed(2)} ${code}`)
      .join(" + ");
    const single = currencies.length <= 1;
    const first = totals.get(currencies[0]) || { total: 0, overdue: 0 };
    return {
      kind: "CUSTOMER_RECEIVABLES",
      status: "READY",
      title: `Receivables — ${resolved.match.customer_name}`,
      headline: `${rows.length} open receivable${rows.length === 1 ? "" : "s"} total ${totalLabel || `0.00 ${currency}`}; overdue ${overdueLabel || `0.00 ${currency}`}.`,
      questions: [],
      period: { from: "", to: today, label: `Outstanding as of ${today}` },
      currency_code: currency,
      metrics: [
        {
          label: "Total outstanding",
          value: single ? first.total : totalLabel,
          format: single ? "money" : "text",
        },
        {
          label: "Overdue",
          value: single ? first.overdue : overdueLabel,
          format: single ? "money" : "text",
        },
        { label: "Open documents", value: rows.length, format: "number" },
      ],
      columns: [
        { key: "document_number", label: "Document" },
        { key: "due_date", label: "Due date", format: "date" },
        { key: "outstanding", label: "Outstanding", format: "money" },
        { key: "state", label: "State" },
      ],
      rows: rows.slice(0, 100).map((row: any) => ({
        document_number: row.document_number,
        due_date: row.due_date,
        outstanding: row.outstanding,
        state: row.overdue ? "OVERDUE" : "NOT DUE",
      })),
      definition:
        sourceMode === "ACCOUNTING"
          ? "Authoritative accounting receivable open items: original amount less settled amount for OPEN and PARTIAL customer documents."
          : "Posted operational customer invoices: recorded balance, or net invoice amount less recorded payments when balance is unavailable.",
      warnings: [
        ...(sourceMode === "OPERATIONAL"
          ? [
              "No accounting receivable open items were found; this answer uses operational invoice balances.",
            ]
          : []),
        ...(currencies.length > 1
          ? [
              "Multiple currencies are present; values were not converted or added.",
            ]
          : []),
      ],
      sources: [
        {
          table:
            sourceMode === "ACCOUNTING" ? "accounting_open_items" : "invoices",
          label:
            sourceMode === "ACCOUNTING"
              ? "Governed customer receivable open items"
              : "Operational customer invoice balances",
          record_count: rows.length,
        },
      ],
      drill_down: {
        label: "Open customer collections",
        route: "/dashboard/accounts/collections",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async supplierPriceComparison(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "purchase_orders");
    const [vendorResult, itemResult] = await Promise.all([
      this.db
        .from("vendors")
        .select("id,code,name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .limit(2000),
      this.db
        .from("items")
        .select("id,code,name,uom")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .limit(5000),
    ]);
    if (vendorResult.error) throw vendorResult.error;
    if (itemResult.error) throw itemResult.error;
    const promptText = normalized(prompt);
    const matchedVendors = (vendorResult.data || [])
      .filter((vendor: any) =>
        [vendor.code, vendor.name]
          .map(normalized)
          .some((entry) => entry.length >= 2 && promptText.includes(entry)),
      )
      .slice(0, 5);
    if (matchedVendors.length !== 2)
      return this.needs(
        "SUPPLIER_PRICE_COMPARISON",
        "Supplier price comparison",
        matchedVendors.length > 2
          ? `I found ${matchedVendors.map((row: any) => row.name).join(", ")}. Which two suppliers should I compare?`
          : "Please name exactly two suppliers to compare.",
      );
    const item = this.resolveRows(
      prompt,
      extracted.item_query,
      itemResult.data || [],
      ["code", "name"],
    );
    if (!item.match)
      return this.needs(
        "SUPPLIER_PRICE_COMPARISON",
        `Price comparison — ${matchedVendors[0].name} vs ${matchedVendors[1].name}`,
        "Which item should I compare? Please enter the item name or code.",
      );
    const period =
      this.period(prompt) ||
      (() => {
        const today = new Date();
        const from = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1),
        );
        return {
          from: iso(from),
          to: iso(today),
          label: "Current month plus previous 11 months",
        };
      })();
    const { data: orders, error } = await this.db
      .from("purchase_orders")
      .select(
        "id,po_number,po_date,vendor_id,status,purchase_order_items(id,item_id,item_code,item_name,uom,ordered_qty,rate)",
      )
      .eq("tenant_id", tenantId)
      .in(
        "vendor_id",
        matchedVendors.map((vendor: any) => vendor.id),
      )
      .gte("po_date", period.from)
      .lte("po_date", period.to)
      .order("po_date", { ascending: false });
    if (error) throw error;
    const valid = (orders || []).filter(
      (order: any) =>
        !["DRAFT", "REJECTED", "CANCELLED"].includes(
          String(order.status || "").toUpperCase(),
        ),
    );
    const lines = valid.flatMap((order: any) =>
      (order.purchase_order_items || [])
        .filter(
          (line: any) =>
            String(line.item_id || "") === String(item.match.id) ||
            normalized(line.item_code) === normalized(item.match.code),
        )
        .map((line: any) => ({
          vendor_id: order.vendor_id,
          po_number: order.po_number,
          po_date: order.po_date,
          currency_code: "INR",
          uom: String(line.uom || item.match.uom || "").toUpperCase(),
          quantity: amount(line.ordered_qty),
          rate: amount(line.rate),
        })),
    );
    const rows = matchedVendors.map((vendor: any) => {
      const vendorLines = lines.filter(
        (line: any) => line.vendor_id === vendor.id && line.rate > 0,
      );
      const totalQty = vendorLines.reduce(
        (sum: number, line: any) => sum + line.quantity,
        0,
      );
      const weighted = vendorLines.reduce(
        (sum: number, line: any) => sum + line.rate * line.quantity,
        0,
      );
      return {
        supplier: vendor.name,
        po_count: new Set(vendorLines.map((line: any) => line.po_number)).size,
        latest_rate: vendorLines[0]?.rate || null,
        weighted_average_rate: totalQty ? weighted / totalQty : null,
        lowest_rate: vendorLines.length
          ? Math.min(...vendorLines.map((line: any) => line.rate))
          : null,
        highest_rate: vendorLines.length
          ? Math.max(...vendorLines.map((line: any) => line.rate))
          : null,
        last_purchase: vendorLines[0]?.po_date || null,
        uom: vendorLines[0]?.uom || item.match.uom,
        currency_code: vendorLines[0]?.currency_code || "INR",
        line_count: vendorLines.length,
      };
    });
    const comparable = rows.filter((row) => row.weighted_average_rate != null);
    const comparableUnits = new Set(
      comparable.map((row) => `${row.currency_code}:${row.uom}`),
    );
    const best =
      comparable.length === 2 && comparableUnits.size === 1
        ? [...comparable].sort(
            (left, right) =>
              left.weighted_average_rate - right.weighted_average_rate,
          )[0]
        : null;
    return {
      kind: "SUPPLIER_PRICE_COMPARISON",
      status: "READY",
      title: `Supplier prices — ${item.match.code} ${item.match.name}`,
      headline: best
        ? `${best.supplier} has the lower weighted average recorded PO rate at ${Number(best.weighted_average_rate).toFixed(2)} ${best.currency_code}/${best.uom}.`
        : "No directly comparable same-currency, same-UOM purchasing history was found for both suppliers and this item.",
      questions: [],
      period,
      currency_code:
        new Set(rows.map((row) => row.currency_code)).size === 1
          ? rows[0]?.currency_code || "INR"
          : "MIXED",
      metrics: [
        { label: "Suppliers compared", value: 2, format: "number" },
        { label: "PO lines analysed", value: lines.length, format: "number" },
        { label: "Best supplier", value: best?.supplier || "No comparison" },
      ],
      columns: [
        { key: "supplier", label: "Supplier" },
        {
          key: "weighted_average_rate",
          label: "Weighted avg.",
          format: "money",
        },
        { key: "latest_rate", label: "Latest rate", format: "money" },
        { key: "lowest_rate", label: "Lowest", format: "money" },
        { key: "last_purchase", label: "Last purchase", format: "date" },
      ],
      rows,
      definition:
        "Approved/non-cancelled purchase-order line basic rates, quantity-weighted within the selected period. Tax, freight, duty, rebates, quality and delivery performance are not included, so this is not yet a landed-cost award recommendation.",
      warnings: [
        ...rows
          .filter((row) => row.line_count === 0)
          .map(
            (row) =>
              `No qualifying purchase history was found for ${row.supplier}.`,
          ),
        ...(new Set(lines.map((line: any) => line.uom)).size > 1
          ? [
              "Different UOMs exist in the source history; validate conversion before awarding business.",
            ]
          : []),
        ...(new Set(lines.map((line: any) => line.currency_code)).size > 1
          ? ["Different currencies exist; rates were not converted."]
          : []),
      ],
      sources: [
        {
          table: "purchase_orders / purchase_order_items",
          label: "Approved purchase-order history",
          record_count: lines.length,
        },
      ],
      drill_down: {
        label: "Open purchase orders",
        route: "/dashboard/purchase/orders",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async inventoryPosition(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "items");
    const [itemResult, stockResult, warehouseResult] = await Promise.all([
      this.db
        .from("items")
        .select("id,code,name,uom")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .limit(5000),
      this.db
        .from("inventory_stock")
        .select(
          "id,item_id,warehouse_id,quantity,reserved_quantity,available_quantity,min_quantity,reorder_point,last_movement_date",
        )
        .eq("tenant_id", tenantId)
        .limit(10000),
      this.db
        .from("warehouses")
        .select("id,code,name")
        .eq("tenant_id", tenantId)
        .limit(1000),
    ]);
    if (itemResult.error) throw itemResult.error;
    if (stockResult.error) throw stockResult.error;
    if (warehouseResult.error) throw warehouseResult.error;
    const items = itemResult.data || [];
    // PostgREST may enforce a 1,000-row response cap even when `.limit(5000)`
    // is requested. Load the remaining item-master pages so fuzzy names and
    // codes beyond the first page remain addressable by the planner.
    if (items.length >= 1000) {
      for (let offset = 1000; offset < 5000; offset += 1000) {
        const pageResult = await this.db
          .from("items")
          .select("id,code,name,uom")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .range(offset, offset + 999);
        if (pageResult.error) throw pageResult.error;
        const page = pageResult.data || [];
        for (const item of page)
          if (!items.some((known: any) => known.id === item.id))
            items.push(item);
        if (page.length < 1000) break;
      }
    }
    const inventoryPrompt = normalized(prompt);
    const portfolioQuery =
      extracted.query_scope === "PORTFOLIO" && !value(extracted.item_query);
    const general =
      portfolioQuery ||
      /\b(low|stok|stck|short|shortage|shortge|reorder|slow|ageing|aging|overview|all)\b/.test(
        inventoryPrompt,
      );
    let resolved = general
      ? { match: null, candidates: [] }
      : this.resolveRows(prompt, extracted.item_query, items, ["code", "name"]);
    const directItemCode = value(extracted.item_query).trim();
    if (
      !general &&
      !resolved.match &&
      /^[a-z0-9][a-z0-9._/-]{1,79}$/i.test(directItemCode)
    ) {
      // Supabase installations commonly cap a result page at 1,000 rows even
      // when a higher limit is requested. Resolve an explicit item code with a
      // targeted query so large item masters cannot turn an exact code into a
      // misleading fuzzy-code clarification.
      const exactItemResult = await this.db
        .from("items")
        .select("id,code,name,uom")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .ilike("code", directItemCode)
        .limit(2);
      if (exactItemResult.error) throw exactItemResult.error;
      const exactItems = exactItemResult.data || [];
      if (exactItems.length === 1) {
        const exactItem = exactItems[0];
        if (!items.some((item: any) => item.id === exactItem.id))
          items.push(exactItem);
        resolved = { match: exactItem, candidates: [exactItem] };
      } else if (exactItems.length > 1) {
        resolved = { match: null, candidates: exactItems };
      }
    }
    const itemMap = new Map(items.map((item: any) => [item.id, item]));
    const warehouseMap = new Map(
      (warehouseResult.data || []).map((warehouse: any) => [
        warehouse.id,
        warehouse,
      ]),
    );
    if (!general && !resolved.match) {
      const names = resolved.candidates
        .map((row: any) => `${row.code} ${row.name}`)
        .join(", ");
      return this.needs(
        "INVENTORY_POSITION",
        "Inventory position",
        names
          ? `Which item did you mean: ${names}?`
          : "Which item should I check? Enter its item code or name, or ask for low-stock items.",
      );
    }
    const grouped = new Map<string, any>();
    for (const stock of stockResult.data || []) {
      if (resolved.match && stock.item_id !== resolved.match.id) continue;
      const item: any = itemMap.get(stock.item_id);
      if (!item) continue;
      const row = grouped.get(stock.item_id) || {
        item_code: item.code,
        item_name: item.name,
        uom: item.uom,
        on_hand: 0,
        reserved: 0,
        available: 0,
        reorder_point: 0,
        last_movement: null,
        warehouses: new Set<string>(),
        warehouse_balances: new Map<string, any>(),
      };
      row.on_hand += amount(stock.quantity);
      row.reserved += amount(stock.reserved_quantity);
      row.available +=
        stock.available_quantity == null
          ? amount(stock.quantity) - amount(stock.reserved_quantity)
          : amount(stock.available_quantity);
      row.reorder_point += Math.max(
        amount(stock.reorder_point),
        amount(stock.min_quantity),
      );
      if (stock.warehouse_id) row.warehouses.add(stock.warehouse_id);
      if (stock.warehouse_id) {
        const warehouse: any = warehouseMap.get(stock.warehouse_id);
        const warehouseLabel =
          warehouse?.code || warehouse?.name || "Unknown warehouse";
        const balance = row.warehouse_balances.get(stock.warehouse_id) || {
          label: warehouseLabel,
          on_hand: 0,
          reserved: 0,
          available: 0,
        };
        balance.on_hand += amount(stock.quantity);
        balance.reserved += amount(stock.reserved_quantity);
        balance.available +=
          stock.available_quantity == null
            ? amount(stock.quantity) - amount(stock.reserved_quantity)
            : amount(stock.available_quantity);
        row.warehouse_balances.set(stock.warehouse_id, balance);
      }
      if (
        stock.last_movement_date &&
        (!row.last_movement || stock.last_movement_date > row.last_movement)
      )
        row.last_movement = stock.last_movement_date;
      grouped.set(stock.item_id, row);
    }
    const ageLimit = new Date();
    ageLimit.setUTCDate(ageLimit.getUTCDate() - 90);
    const ageLimitIso = iso(ageLimit);
    let rows = [...grouped.values()].map((row: any) => {
      const warehouseDetails = [...row.warehouse_balances.values()]
        .map(
          (balance: any) =>
            `${balance.label}: ${balance.available} available (${balance.on_hand} on hand, ${balance.reserved} reserved)`,
        )
        .join("; ");
      return {
        item_code: row.item_code,
        item_name: row.item_name,
        uom: row.uom,
        on_hand: row.on_hand,
        reserved: row.reserved,
        available: row.available,
        reorder_point: row.reorder_point,
        last_movement: row.last_movement,
        warehouses: row.warehouses.size,
        warehouse_details: warehouseDetails || "No warehouse balance",
        state:
          row.available <= row.reorder_point
            ? "REORDER"
            : row.last_movement && row.last_movement < ageLimitIso
              ? "SLOW MOVING"
              : "AVAILABLE",
      };
    });
    const lowOnly =
      /\b(low|stok|stck|short|shortage|shortge|reorder)\b/.test(
        inventoryPrompt,
      ) ||
      (portfolioQuery && extracted.query_operation === "RANK_TOP");
    const slowOnly = /\b(slow|ageing|aging)\b/.test(normalized(prompt));
    if (lowOnly) rows = rows.filter((row: any) => row.state === "REORDER");
    if (slowOnly) rows = rows.filter((row: any) => row.state === "SLOW MOVING");
    rows.sort((left: any, right: any) => left.available - right.available);
    const totalAvailable = rows.reduce(
      (sum: number, row: any) => sum + row.available,
      0,
    );
    const lowCount = rows.filter((row: any) => row.state === "REORDER").length;
    return {
      kind: "INVENTORY_POSITION",
      status: "READY",
      title: resolved.match
        ? `Inventory — ${resolved.match.code} ${resolved.match.name}`
        : slowOnly
          ? "Slow-moving inventory"
          : "Inventory exceptions",
      headline: resolved.match
        ? `${quantityText(totalAvailable)} ${resolved.match.uom || "units"} available across ${rows[0]?.warehouses || 0} warehouse${rows[0]?.warehouses === 1 ? "" : "s"}.`
        : `${rows.length} item${rows.length === 1 ? "" : "s"} matched; ${lowCount} at or below reorder level.`,
      questions: [],
      metrics: [
        { label: "Items", value: rows.length, format: "number" },
        {
          label: "Available quantity",
          value: totalAvailable,
          format: "number",
        },
        { label: "Reorder exceptions", value: lowCount, format: "number" },
      ],
      columns: [
        { key: "item_code", label: "Item" },
        { key: "on_hand", label: "On hand", format: "number" },
        { key: "available", label: "Available", format: "number" },
        { key: "reserved", label: "Reserved", format: "number" },
        { key: "warehouse_details", label: "Warehouse breakdown" },
        { key: "reorder_point", label: "Reorder at", format: "number" },
        { key: "state", label: "State" },
      ],
      rows: rows.slice(0, 100),
      definition:
        "Warehouse stock aggregated by item. Available quantity uses the governed available balance (or on-hand less reserved where unavailable). Reorder exceptions are at or below the larger configured minimum/reorder point. Slow-moving means no movement in the last 90 days.",
      warnings:
        rows.length >= 100 ? ["Showing the first 100 matching items."] : [],
      sources: [
        {
          table: "inventory_stock",
          label: "Tenant warehouse stock balances",
          record_count: stockResult.data?.length || 0,
        },
        {
          table: "items",
          label: "Active item master",
          record_count: items.length,
        },
      ],
      drill_down: {
        label: "Open inventory",
        route: "/dashboard/inventory/items",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async salesOrderStatus(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "sales");
    const [orderResult, customerResult] = await Promise.all([
      this.db
        .from("sales_orders")
        .select(
          "id,so_number,order_date,expected_delivery_date,customer_id,status,release_status,credit_status,delivery_block,billing_block,currency_code,net_amount",
        )
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("order_date", { ascending: false })
        .limit(2000),
      this.db
        .from("customers")
        .select("id,customer_code,customer_name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .limit(2000),
    ]);
    if (orderResult.error) throw orderResult.error;
    if (customerResult.error) throw customerResult.error;
    const orders = orderResult.data || [];
    const customers = customerResult.data || [];
    const customerMap = new Map(customers.map((row: any) => [row.id, row]));
    const promptText = normalized(prompt);
    const genericOrderScope =
      /\b(any|all|open|pending)\b.*\b(?:sales|customer)?\s*orders?\b/.test(
        promptText,
      ) || /\bcustomer orders?\b.*\b(pending|open|dispatch)\b/.test(promptText);
    const direct = orders.filter((row: any) =>
      promptText.includes(normalized(row.so_number)),
    );
    const resolvedCustomer = this.resolveRows(
      prompt,
      extracted.counterparty_query,
      customers,
      ["customer_code", "customer_name"],
    );
    let selected = direct.length
      ? direct
      : resolvedCustomer.match
        ? orders.filter(
            (row: any) => row.customer_id === resolvedCustomer.match.id,
          )
        : orders.filter(
            (row: any) =>
              !["COMPLETED", "CANCELLED", "CLOSED"].includes(
                String(row.status || "").toUpperCase(),
              ),
          );
    if (
      !direct.length &&
      !resolvedCustomer.match &&
      !genericOrderScope &&
      (value(extracted.counterparty_query) ||
        /\b(for|client)\b/.test(promptText))
    )
      return this.needs(
        "SALES_ORDER_STATUS",
        "Sales-order status",
        "Which customer or Sales Order number should I check?",
      );
    const ids = selected.map((row: any) => row.id);
    let lines: any[] = [];
    if (ids.length) {
      const { data, error } = await this.db
        .from("sales_order_items")
        .select("sales_order_id,quantity,dispatched_quantity,pending_quantity")
        .in("sales_order_id", ids);
      if (error) throw error;
      lines = data || [];
    }
    const today = iso(new Date());
    const rows = selected.slice(0, 100).map((order: any) => {
      const orderLines = lines.filter(
        (line: any) => line.sales_order_id === order.id,
      );
      const ordered = orderLines.reduce(
        (sum: number, line: any) => sum + amount(line.quantity),
        0,
      );
      const dispatched = orderLines.reduce(
        (sum: number, line: any) => sum + amount(line.dispatched_quantity),
        0,
      );
      const pending = orderLines.reduce(
        (sum: number, line: any) =>
          sum +
          (line.pending_quantity == null
            ? Math.max(
                0,
                amount(line.quantity) - amount(line.dispatched_quantity),
              )
            : amount(line.pending_quantity)),
        0,
      );
      const customer: any = customerMap.get(order.customer_id);
      return {
        so_number: order.so_number,
        customer: customer?.customer_name || "Unknown",
        status: order.status,
        release: order.release_status,
        ordered,
        dispatched,
        pending,
        due_date: order.expected_delivery_date,
        state:
          order.delivery_block || order.billing_block
            ? "BLOCKED"
            : order.expected_delivery_date &&
                order.expected_delivery_date < today &&
                pending > 0
              ? "OVERDUE"
              : pending > 0
                ? "OPEN"
                : "FULFILLED",
      };
    });
    return {
      kind: "SALES_ORDER_STATUS",
      status: "READY",
      title:
        direct.length === 1
          ? `Sales order — ${direct[0].so_number}`
          : resolvedCustomer.match
            ? `Orders — ${resolvedCustomer.match.customer_name}`
            : "Open sales orders",
      headline: `${rows.length} order${rows.length === 1 ? "" : "s"}; ${rows.filter((row: any) => row.state === "OVERDUE").length} overdue and ${rows.filter((row: any) => row.state === "BLOCKED").length} blocked.`,
      questions: [],
      metrics: [
        { label: "Orders", value: rows.length, format: "number" },
        {
          label: "Overdue",
          value: rows.filter((row: any) => row.state === "OVERDUE").length,
          format: "number",
        },
        {
          label: "Blocked",
          value: rows.filter((row: any) => row.state === "BLOCKED").length,
          format: "number",
        },
      ],
      columns: [
        { key: "so_number", label: "Sales order" },
        { key: "customer", label: "Customer" },
        { key: "pending", label: "Pending", format: "number" },
        { key: "due_date", label: "Due date", format: "date" },
        { key: "state", label: "State" },
      ],
      rows,
      definition:
        "Active Sales Orders with ordered, dispatched and pending quantities from their native order lines. Overdue means pending quantity remains after the expected delivery date; blocked reflects delivery or billing blocks.",
      warnings:
        selected.length > 100
          ? ["Showing the latest 100 matching orders."]
          : [],
      sources: [
        {
          table: "sales_orders",
          label: "Active customer orders",
          record_count: selected.length,
        },
        {
          table: "sales_order_items",
          label: "Order fulfilment quantities",
          record_count: lines.length,
        },
      ],
      drill_down: {
        label: "Open sales fulfilment",
        route: "/dashboard/sales?tab=fulfilment",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async productionStatus(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "job_orders");
    const [orderResult, itemResult] = await Promise.all([
      this.db
        .from("production_orders")
        .select(
          "id,order_number,item_id,quantity,produced_quantity,start_date,end_date,actual_start_date,actual_end_date,status,priority",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(2000),
      this.db
        .from("items")
        .select("id,code,name,uom")
        .eq("tenant_id", tenantId)
        .limit(5000),
    ]);
    if (orderResult.error) throw orderResult.error;
    if (itemResult.error) throw itemResult.error;
    const itemMap = new Map(
      (itemResult.data || []).map((row: any) => [row.id, row]),
    );
    const promptText = normalized(prompt);
    const direct = (orderResult.data || []).filter((row: any) =>
      promptText.includes(normalized(row.order_number)),
    );
    const item = this.resolveRows(
      prompt,
      extracted.item_query,
      itemResult.data || [],
      ["code", "name"],
    );
    const selected = direct.length
      ? direct
      : item.match
        ? (orderResult.data || []).filter(
            (row: any) => row.item_id === item.match.id,
          )
        : (orderResult.data || []).filter(
            (row: any) =>
              !["COMPLETED", "CANCELLED", "CLOSED"].includes(
                String(row.status || "").toUpperCase(),
              ),
          );
    const today = iso(new Date());
    const rows = selected.slice(0, 100).map((order: any) => {
      const master: any = itemMap.get(order.item_id);
      const planned = amount(order.quantity);
      const produced = amount(order.produced_quantity);
      const balance = Math.max(0, planned - produced);
      return {
        order_number: order.order_number,
        item: master ? `${master.code} ${master.name}` : order.item_id,
        planned,
        produced,
        balance,
        progress: planned ? `${((produced / planned) * 100).toFixed(1)}%` : "—",
        end_date: order.end_date,
        state:
          order.end_date && order.end_date < today && balance > 0
            ? "DELAYED"
            : order.status,
      };
    });
    return {
      kind: "PRODUCTION_STATUS",
      status: "READY",
      title:
        direct.length === 1
          ? `Production — ${direct[0].order_number}`
          : item.match
            ? `Production — ${item.match.code} ${item.match.name}`
            : "Open production",
      headline: `${rows.length} production order${rows.length === 1 ? "" : "s"}; ${rows.filter((row: any) => row.state === "DELAYED").length} delayed.`,
      questions: [],
      metrics: [
        { label: "Orders", value: rows.length, format: "number" },
        {
          label: "Planned quantity",
          value: rows.reduce((sum: number, row: any) => sum + row.planned, 0),
          format: "number",
        },
        {
          label: "Balance quantity",
          value: rows.reduce((sum: number, row: any) => sum + row.balance, 0),
          format: "number",
        },
      ],
      columns: [
        { key: "order_number", label: "Production order" },
        { key: "item", label: "Product" },
        { key: "progress", label: "Progress" },
        { key: "balance", label: "Balance", format: "number" },
        { key: "end_date", label: "Due date", format: "date" },
        { key: "state", label: "State" },
      ],
      rows,
      definition:
        "Native production-order planned quantity compared with recorded produced quantity. Delayed means an unfinished balance remains after the planned end date.",
      warnings:
        selected.length > 100
          ? ["Showing the latest 100 matching production orders."]
          : [],
      sources: [
        {
          table: "production_orders",
          label: "Production execution orders",
          record_count: selected.length,
        },
        {
          table: "items",
          label: "Product master",
          record_count: itemResult.data?.length || 0,
        },
      ],
      drill_down: {
        label: "Open production orders",
        route: "/dashboard/production",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async employeeAttendance(
    tenantId: string,
    user: any,
    prompt: string,
    extracted: any,
  ): Promise<AnalyticsAnswer> {
    this.assertDomainAccess(user, "hr");
    const period =
      this.period(prompt) ||
      (() => {
        const today = new Date();
        return {
          from: iso(
            new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
          ),
          to: iso(today),
          label: "Current month to date",
        };
      })();
    const [attendanceResult, employeeResult] = await Promise.all([
      this.db
        .from("attendance")
        .select(
          "id,employee_id,attendance_date,status,check_in_time,check_out_time,work_hours",
        )
        .eq("tenant_id", tenantId)
        .gte("attendance_date", period.from)
        .lte("attendance_date", period.to)
        .order("attendance_date", { ascending: false })
        .limit(5000),
      this.db
        .from("employees")
        .select("id,employee_code,employee_name,email,status")
        .eq("tenant_id", tenantId)
        .limit(5000),
    ]);
    if (attendanceResult.error) throw attendanceResult.error;
    if (employeeResult.error) throw employeeResult.error;

    const employees = employeeResult.data || [];
    const semanticScope = value(extracted.query_scope).toUpperCase();
    const employeeQuery = value(extracted.employee_query);
    let selectedEmployee: any = null;
    if (semanticScope === "ENTITY" || employeeQuery) {
      const resolved = this.resolveRows(prompt, employeeQuery, employees, [
        "employee_code",
        "employee_name",
        "email",
      ]);
      if (!resolved.match) {
        const names = resolved.candidates
          .map((row: any) => row.employee_name)
          .filter(Boolean)
          .join(", ");
        return this.needs(
          "EMPLOYEE_ATTENDANCE",
          "Employee punctuality",
          names
            ? `Which employee did you mean: ${names}?`
            : "Which employee should I analyse? Please enter the employee name or code.",
        );
      }
      selectedEmployee = resolved.match;
    }

    const employeeById = new Map(
      employees.map((employee: any) => [String(employee.id), employee]),
    );
    const lateRecords = (attendanceResult.data || []).filter(
      (record: any) =>
        String(record.status || "").toUpperCase() === "LATE" &&
        (!selectedEmployee || record.employee_id === selectedEmployee.id),
    );
    const grouped = new Map<string, any>();
    for (const record of lateRecords) {
      const employee: any = employeeById.get(String(record.employee_id));
      if (!employee) continue;
      const key = String(record.employee_id);
      const row = grouped.get(key) || {
        employee: employee.employee_name || employee.employee_code || key,
        employee_code: employee.employee_code || "",
        late_days: 0,
        first_late_date: null,
        latest_late_date: null,
        latest_check_in: null,
      };
      const attendanceDate = String(record.attendance_date || "").slice(0, 10);
      row.late_days += 1;
      if (!row.first_late_date || attendanceDate < row.first_late_date)
        row.first_late_date = attendanceDate;
      if (!row.latest_late_date || attendanceDate > row.latest_late_date) {
        row.latest_late_date = attendanceDate;
        row.latest_check_in = record.check_in_time || null;
      }
      grouped.set(key, row);
    }
    const rows = [...grouped.values()].sort(
      (left, right) =>
        right.late_days - left.late_days ||
        String(left.employee).localeCompare(String(right.employee)),
    );
    const attendanceCount = (attendanceResult.data || []).filter(
      (record: any) =>
        !selectedEmployee || record.employee_id === selectedEmployee.id,
    ).length;
    return {
      kind: "EMPLOYEE_ATTENDANCE",
      status: "READY",
      title: selectedEmployee
        ? `Late attendance — ${selectedEmployee.employee_name}`
        : "Employees marked late",
      headline: lateRecords.length
        ? `${rows.length} employee${rows.length === 1 ? " was" : "s were"} marked late on ${lateRecords.length} attendance record${lateRecords.length === 1 ? "" : "s"} during ${period.label.toLowerCase()}.`
        : selectedEmployee
          ? `${selectedEmployee.employee_name} has no attendance records marked late during ${period.label.toLowerCase()}.`
          : `No employees were marked late during ${period.label.toLowerCase()}.`,
      questions: [],
      period,
      metrics: [
        { label: "Employees late", value: rows.length, format: "number" },
        { label: "Late records", value: lateRecords.length, format: "number" },
        {
          label: "Attendance records checked",
          value: attendanceCount,
          format: "number",
        },
      ],
      columns: [
        { key: "employee", label: "Employee" },
        { key: "employee_code", label: "Employee code" },
        { key: "late_days", label: "Late days", format: "number" },
        { key: "first_late_date", label: "First late date", format: "date" },
        { key: "latest_late_date", label: "Latest late date", format: "date" },
        {
          key: "latest_check_in",
          label: "Latest check-in",
          format: "datetime",
        },
      ],
      rows: rows.slice(0, 100),
      definition:
        "Attendance records explicitly classified as LATE by the governed HR attendance process. The assistant does not invent a shift start or grace period; HR controls the recorded attendance status.",
      warnings:
        rows.length > 100
          ? ["Showing the 100 employees with the most late records."]
          : [],
      sources: [
        {
          table: "attendance",
          label: "Governed employee attendance register",
          record_count: attendanceCount,
        },
        {
          table: "employees",
          label: "Tenant employee master",
          record_count: employees.length,
        },
      ],
      drill_down: {
        label: "Open HR attendance",
        route: "/dashboard/hr?tab=attendance",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }

  private async managementSummary(
    tenantId: string,
    user: any,
    prompt: string,
  ): Promise<AnalyticsAnswer> {
    const permissions = {
      sales: hasAnyPermissionForResource(user, "sales"),
      accounting: hasAnyPermissionForResource(user, "accounting"),
      inventory: hasAnyPermissionForResource(user, "items"),
      production: hasAnyPermissionForResource(user, "job_orders"),
    };
    if (!Object.values(permissions).some(Boolean))
      throw new ForbiddenException(
        "Your role cannot view management analytics.",
      );
    const period =
      this.period(prompt) ||
      (() => {
        const today = new Date();
        return {
          from: iso(
            new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
          ),
          to: iso(today),
          label: "Current month to date",
        };
      })();
    const rows: any[] = [];
    const sources: AnalyticsAnswer["sources"] = [];
    if (permissions.sales) {
      const { data, error } = await this.db
        .from("invoices")
        .select("net_amount,credited_amount,currency_code,billing_status")
        .eq("tenant_id", tenantId)
        .gte("invoice_date", period.from)
        .lte("invoice_date", period.to);
      if (error) throw error;
      const invoices = (data || []).filter(
        (row: any) =>
          String(row.billing_status || "").toUpperCase() !== "CANCELLED",
      );
      const byCurrency = new Map<string, number>();
      for (const row of invoices) {
        const code = row.currency_code || "INR";
        byCurrency.set(
          code,
          (byCurrency.get(code) || 0) +
            amount(row.net_amount) -
            amount(row.credited_amount),
        );
      }
      rows.push({
        area: "Sales",
        indicator: "Net invoiced sales",
        value:
          [...byCurrency.entries()]
            .map(([code, total]) => `${total.toFixed(2)} ${code}`)
            .join(" + ") || "0.00 INR",
        state: "ACTUAL",
      });
      sources.push({
        table: "invoices",
        label: "Posted product invoices",
        record_count: invoices.length,
      });
    }
    if (permissions.accounting) {
      const { data, error } = await this.db
        .from("accounting_open_items")
        .select(
          "direction,original_amount,settled_amount,currency_code,status,due_date",
        )
        .eq("tenant_id", tenantId)
        .in("status", ["OPEN", "PARTIAL"]);
      if (error) throw error;
      const today = iso(new Date());
      for (const direction of ["RECEIVABLE", "PAYABLE"]) {
        const records = (data || []).filter(
          (row: any) => row.direction === direction,
        );
        const total = records.reduce(
          (sum: number, row: any) =>
            sum +
            Math.max(
              0,
              amount(row.original_amount) - amount(row.settled_amount),
            ),
          0,
        );
        const overdue = records
          .filter((row: any) => row.due_date && row.due_date < today)
          .reduce(
            (sum: number, row: any) =>
              sum +
              Math.max(
                0,
                amount(row.original_amount) - amount(row.settled_amount),
              ),
            0,
          );
        rows.push({
          area: "Cash",
          indicator:
            direction === "RECEIVABLE"
              ? "Customer receivables"
              : "Supplier payables",
          value: `${total.toFixed(2)} base currency`,
          state: `${overdue.toFixed(2)} overdue`,
        });
      }
      sources.push({
        table: "accounting_open_items",
        label: "Governed open-item subledger",
        record_count: data?.length || 0,
      });
    }
    if (permissions.inventory) {
      const { data, error } = await this.db
        .from("inventory_stock")
        .select(
          "available_quantity,quantity,reserved_quantity,min_quantity,reorder_point",
        )
        .eq("tenant_id", tenantId)
        .limit(10000);
      if (error) throw error;
      const low = (data || []).filter((row: any) => {
        const available =
          row.available_quantity == null
            ? amount(row.quantity) - amount(row.reserved_quantity)
            : amount(row.available_quantity);
        return (
          available <=
          Math.max(amount(row.min_quantity), amount(row.reorder_point))
        );
      }).length;
      rows.push({
        area: "Inventory",
        indicator: "Stock-location reorder exceptions",
        value: String(low),
        state: low ? "ATTENTION" : "CLEAR",
      });
      sources.push({
        table: "inventory_stock",
        label: "Warehouse stock balances",
        record_count: data?.length || 0,
      });
    }
    if (permissions.production) {
      const { data, error } = await this.db
        .from("production_orders")
        .select("quantity,produced_quantity,end_date,status")
        .eq("tenant_id", tenantId)
        .limit(5000);
      if (error) throw error;
      const today = iso(new Date());
      const open = (data || []).filter(
        (row: any) =>
          !["COMPLETED", "CANCELLED", "CLOSED"].includes(
            String(row.status || "").toUpperCase(),
          ),
      );
      const delayed = open.filter(
        (row: any) =>
          row.end_date &&
          row.end_date < today &&
          amount(row.produced_quantity) < amount(row.quantity),
      );
      rows.push({
        area: "Production",
        indicator: "Open / delayed orders",
        value: `${open.length} / ${delayed.length}`,
        state: delayed.length ? "ATTENTION" : "ON TRACK",
      });
      sources.push({
        table: "production_orders",
        label: "Production execution orders",
        record_count: data?.length || 0,
      });
    }
    return {
      kind: "MANAGEMENT_SUMMARY",
      status: "READY",
      title: "Owner business brief",
      headline: `${rows.length} governed indicators prepared for ${period.label.toLowerCase()}.`,
      questions: [],
      period,
      metrics: [
        { label: "Indicators", value: rows.length, format: "number" },
        {
          label: "Attention items",
          value: rows.filter(
            (row) =>
              row.state === "ATTENTION" ||
              String(row.state).includes("overdue"),
          ).length,
          format: "number",
        },
        {
          label: "Modules covered",
          value: Object.values(permissions).filter(Boolean).length,
          format: "number",
        },
      ],
      columns: [
        { key: "area", label: "Area" },
        { key: "indicator", label: "Indicator" },
        { key: "value", label: "Value" },
        { key: "state", label: "State" },
      ],
      rows,
      definition:
        "A permission-scoped operational brief assembled from native posted invoices, accounting open items, warehouse balances and production execution records. It does not forecast outcomes or combine currencies using assumed exchange rates.",
      warnings: Object.values(permissions).some((allowed) => !allowed)
        ? [
            "Some modules are omitted because this user does not have permission to view them.",
          ]
        : [],
      sources,
      drill_down: {
        label: "Open transformation cockpit",
        route: "/dashboard/transformation",
      },
      generated_at: new Date().toISOString(),
      read_only: true,
    };
  }
}
