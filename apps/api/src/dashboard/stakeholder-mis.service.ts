import { ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { DashboardService } from "./dashboard.service";

@Injectable()
export class StakeholderMisService {
  private readonly db: SupabaseClient;

  constructor(config: ConfigService, private readonly dashboard: DashboardService) {
    this.db = createClient(
      config.get<string>("SUPABASE_URL") || process.env.SUPABASE_URL!,
      config.get<string>("SUPABASE_KEY") || process.env.SUPABASE_KEY!,
    );
  }

  private n(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private money(value: number, currencyCode: string) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode, maximumFractionDigits: 0 }).format(value);
  }

  private roleNames(input: { roles?: unknown; role?: unknown }): string[] {
    const names: string[] = [];
    const append = (value: unknown) => {
      if (typeof value === "string") names.push(value);
      else if (value && typeof value === "object" && typeof (value as any).name === "string") names.push((value as any).name);
      else if (value && typeof value === "object" && (value as any).role) append((value as any).role);
    };
    if (Array.isArray(input.roles)) input.roles.forEach(append);
    append(input.role);
    return names.map((name) => name.toUpperCase().replace(/[_-]+/g, " ").trim()).filter(Boolean);
  }

  private assertPersonaAccess(input: { domain: string; view: string; roles?: unknown; role?: unknown }) {
    const names = this.roleNames(input);
    if (names.some((name) => name.includes("ADMIN") || name.includes("SUPER") || name.includes("OWNER"))) return;
    const terms: Record<string, string[]> = {
      "executive/overview": ["CEO", "MANAGING DIRECTOR", "DIRECTOR"],
      "finance/manager": ["CFO", "FINANCE MANAGER", "FINANCE HEAD", "COMMERCIAL MANAGER"],
      "finance/accountant": ["ACCOUNTANT", "ACCOUNTS", "FINANCE EXECUTIVE"],
      "sales/manager": ["SALES HEAD", "SALES MANAGER", "COMMERCIAL MANAGER"],
      "sales/territory": ["TERRITORY MANAGER", "REGIONAL MANAGER", "AREA SALES MANAGER"],
      "sales/executive": ["SALES EXECUTIVE", "SALESPERSON", "SALESMAN", "BUSINESS DEVELOPMENT"],
      "operations/control": ["OPERATIONS", "PROCUREMENT", "PURCHASE", "PRODUCTION", "STORE", "INVENTORY", "QUALITY"],
    };
    const allowed = terms[`${input.domain}/${input.view}`] || [];
    if (!allowed.some((term) => names.some((name) => name.includes(term) || term.includes(name)))) {
      throw new ForbiddenException("This MIS workspace is outside your assigned role scope.");
    }
  }

  private async currencyCode(tenantId: string): Promise<string> {
    const { data } = await this.db
      .from("company_branches")
      .select("currency_code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const code = String(data?.currency_code || "INR").trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : "INR";
  }

  private async legacySalesDocuments(
    input: { tenantId: string; userId?: string },
    cockpit: any,
    view: string,
    currencyCode: string,
  ) {
    if (view === "territory") {
      return {
        ...cockpit,
        currencyCode,
        summary: { ...cockpit.summary, sales: { ...(cockpit.summary?.sales || {}), openLeads: 0, followUpsDue: 0 } },
        scope: { mode: "TERRITORY_MAPPING_REQUIRED", domain: "sales", view, source: "SALES_DOCUMENTS" },
      };
    }
    let quotationQuery = this.db
      .from("quotations")
      .select("id,status,total_amount,net_amount,currency_code,created_by,valid_until,quotation_date")
      .eq("tenant_id", input.tenantId)
      .limit(2500);
    let orderQuery = this.db
      .from("sales_orders")
      .select("id,status,total_amount,currency_code,created_by,order_date")
      .eq("tenant_id", input.tenantId)
      .limit(2500);
    if (view === "executive") {
      quotationQuery = quotationQuery.eq("created_by", input.userId);
      orderQuery = orderQuery.eq("created_by", input.userId);
    }
    const [{ data: quotations, error: quotationError }, { data: orders, error: orderError }] = await Promise.all([quotationQuery, orderQuery]);
    if (quotationError || orderError) throw quotationError || orderError;
    const openQuotations = (quotations || []).filter((row: any) => !["CANCELLED", "CONVERTED", "EXPIRED", "REJECTED"].includes(String(row.status || "").toUpperCase()));
    const activeOrders = (orders || []).filter((row: any) => !["CANCELLED", "COMPLETED", "CLOSED"].includes(String(row.status || "").toUpperCase()));
    const pipeline = openQuotations.reduce((sum: number, row: any) => sum + this.n(row.net_amount ?? row.total_amount), 0);
    const mode = view === "executive" ? "MY_DOCUMENTS" : "TENANT_DOCUMENTS";
    return {
      ...cockpit,
      currencyCode,
      summary: {
        ...cockpit.summary,
        sales: {
          ...(cockpit.summary?.sales || {}),
          openLeads: openQuotations.length,
          followUpsDue: 0,
          quoteValue: pipeline,
          weightedQuoteValue: pipeline,
          activeOrders: activeOrders.length,
        },
      },
      metrics: [
        { key: "openQuotations", label: "Open quotations", value: openQuotations.length, tone: "neutral", helper: view === "executive" ? "Created by me" : "In reporting scope" },
        { key: "pipeline", label: "Quotation pipeline", value: pipeline, displayValue: this.money(pipeline, currencyCode), tone: "neutral", helper: "Open quotation value" },
        { key: "orders", label: "Active orders", value: activeOrders.length, tone: "neutral", helper: view === "executive" ? "Created by me" : "In reporting scope" },
      ],
      exceptions: [],
      scope: { mode, domain: "sales", view, source: "SALES_DOCUMENTS" },
    };
  }

  async get(input: { tenantId: string; userId?: string; domain: string; view: string; roles?: unknown; role?: unknown }) {
    const cockpit = await this.dashboard.getCockpit(input.tenantId);
    const domain = String(input.domain || "executive").toLowerCase();
    const view = String(input.view || "overview").toLowerCase();
    this.assertPersonaAccess({ ...input, domain, view });
    const currencyCode = await this.currencyCode(input.tenantId);

    if (domain !== "sales") {
      const words = domain === "finance"
        ? ["account", "finance", "invoice", "payable", "cash", "payment", "supplier", "debit"]
        : domain === "operations"
          ? ["purchase", "inventory", "production", "quality", "stock", "grn", "vendor"]
          : [];
      const exceptions = words.length
        ? (cockpit.exceptions || []).filter((row: any) => {
            const text = `${row.type || ""} ${row.title || ""} ${row.detail || ""}`.toLowerCase();
            return words.some((word) => text.includes(word));
          })
        : cockpit.exceptions || [];
      return { ...cockpit, currencyCode, exceptions: exceptions.slice(0, 8), scope: { mode: "TENANT", domain, view } };
    }

    try {
      const [{ data: leads, error }, { data: stages }, { data: rules }] = await Promise.all([
        this.db.from("crm_leads").select("id,owner_user_id,territory,expected_value,currency_code,probability,next_follow_up_at,stage_id,converted_at,created_at").eq("tenant_id", input.tenantId).limit(2500),
        this.db.from("crm_pipeline_stages").select("id,is_closed,stage_code").eq("tenant_id", input.tenantId),
        this.db.from("crm_assignment_rules").select("territory_filter,assignee_user_ids,is_active").eq("tenant_id", input.tenantId).eq("is_active", true),
      ]);
      if (error) return await this.legacySalesDocuments(input, cockpit, view, currencyCode);
      const stageMap = new Map((stages || []).map((stage: any) => [stage.id, stage]));
      const allRows = leads || [];
      const territories = (rules || [])
        .filter((rule: any) => Array.isArray(rule.assignee_user_ids) && rule.assignee_user_ids.includes(input.userId))
        .map((rule: any) => String(rule.territory_filter || "").trim())
        .filter(Boolean);
      let rows = allRows;
      let mode = "TENANT";
      if (view === "executive") {
        rows = allRows.filter((lead: any) => lead.owner_user_id === input.userId);
        mode = "MY_RECORDS";
      } else if (view === "territory" && territories.length) {
        rows = allRows.filter((lead: any) => territories.some((territory: string) => territory.toLowerCase() === String(lead.territory || "").toLowerCase()));
        mode = "ASSIGNED_TERRITORIES";
      } else if (view === "territory") {
        rows = [];
        mode = "TERRITORY_MAPPING_REQUIRED";
      }
      const open = rows.filter((lead: any) => !lead.converted_at && !stageMap.get(lead.stage_id)?.is_closed);
      const due = open.filter((lead: any) => lead.next_follow_up_at && new Date(lead.next_follow_up_at).getTime() <= Date.now());
      const pipeline = open.reduce((sum: number, lead: any) => sum + this.n(lead.expected_value), 0);
      const weighted = open.reduce((sum: number, lead: any) => sum + this.n(lead.expected_value) * this.n(lead.probability) / 100, 0);
      return {
        ...cockpit,
        summary: {
          ...cockpit.summary,
          sales: { ...(cockpit.summary?.sales || {}), totalLeads: rows.length, openLeads: open.length, followUpsDue: due.length, quoteValue: pipeline, weightedQuoteValue: weighted },
        },
        metrics: [
          { key: "openLeads", label: "Open leads", value: open.length, tone: due.length ? "warning" : "neutral", helper: mode === "MY_RECORDS" ? "Assigned to me" : "In reporting scope" },
          { key: "pipeline", label: "Pipeline value", value: pipeline, displayValue: this.money(pipeline, currencyCode), tone: "neutral", helper: "Open opportunity value" },
          { key: "weighted", label: "Weighted pipeline", value: weighted, displayValue: this.money(weighted, currencyCode), tone: "neutral", helper: "Probability-weighted value" },
          { key: "followups", label: "Follow-ups due", value: due.length, tone: due.length ? "danger" : "good", helper: "Due now or overdue" },
        ],
        exceptions: (cockpit.exceptions || []).filter((row: any) => `${row.type || ""} ${row.title || ""}`.toLowerCase().includes("sales")).slice(0, 8),
        currencyCode,
        scope: { mode, domain, view, territories },
      };
    } catch {
      throw new ServiceUnavailableException("The scoped sales MIS could not be calculated safely. Please retry.");
    }
  }
}
