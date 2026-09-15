import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class InventoryWorkingCapitalService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  private fail(error: any, message: string): never {
    throw new BadRequestException(error?.message || message);
  }
  private text(value: any) {
    return String(value || "").trim();
  }
  private number(value: any) {
    const result = Number(value || 0);
    return Number.isFinite(result) ? result : 0;
  }

  private async dispositionCase(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("inventory_disposition_cases")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data)
      this.fail(error, "Inventory disposition case not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const consumptionSince = new Date(
      Date.now() - 365 * 86400000,
    ).toISOString();
    const [
      stocksResult,
      itemsResult,
      policiesResult,
      casesResult,
      costsResult,
    ] = await Promise.all([
      this.db
        .from("inventory_stock")
        .select(
          "item_id,quantity,available_quantity,min_quantity,max_quantity,last_movement_date",
        )
        .eq("tenant_id", tenantId)
        .gt("available_quantity", 0),
      this.db
        .from("items")
        .select("id,code,name,uom,standard_cost")
        .eq("tenant_id", tenantId)
        .order("code"),
      this.db
        .from("inventory_working_capital_policies")
        .select("*")
        .eq("tenant_id", tenantId),
      this.db
        .from("inventory_disposition_cases")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      this.db
        .from("inventory_cost_events")
        .select("item_id,event_type,quantity,unit_cost,event_at")
        .eq("tenant_id", tenantId)
        .gte("event_at", consumptionSince)
        .order("event_at", { ascending: false })
        .limit(5000),
    ]);
    if (stocksResult.error)
      this.fail(stocksResult.error, "Unable to load inventory balances.");
    if (itemsResult.error)
      this.fail(itemsResult.error, "Unable to load items.");
    if (policiesResult.error)
      this.fail(
        policiesResult.error,
        "Unable to load working-capital policies.",
      );
    if (casesResult.error)
      this.fail(casesResult.error, "Unable to load disposition cases.");
    if (costsResult.error)
      this.fail(costsResult.error, "Unable to load inventory cost evidence.");

    const stocks = stocksResult.data || [];
    const items = itemsResult.data || [];
    const policies = policiesResult.data || [];
    const cases = casesResult.data || [];
    const costEvents = costsResult.data || [];
    const itemMap = new Map(items.map((row: any) => [String(row.id), row]));
    const policyMap = new Map(
      policies.map((row: any) => [String(row.item_id), row]),
    );
    const stockMap = new Map<string, any>();
    for (const row of stocks) {
      const id = String(row.item_id);
      const aggregate = stockMap.get(id) || {
        item_id: id,
        available_quantity: 0,
        min_quantity: 0,
        max_quantity: 0,
        last_movement_date: null,
      };
      aggregate.available_quantity += this.number(row.available_quantity);
      aggregate.min_quantity += this.number(row.min_quantity);
      aggregate.max_quantity += this.number(row.max_quantity);
      if (
        row.last_movement_date &&
        (!aggregate.last_movement_date ||
          row.last_movement_date > aggregate.last_movement_date)
      )
        aggregate.last_movement_date = row.last_movement_date;
      stockMap.set(id, aggregate);
    }
    const consumptionMap = new Map<string, number>();
    const latestCostMap = new Map<string, number>();
    for (const event of costEvents) {
      const id = String(event.item_id);
      if (!latestCostMap.has(id) && this.number(event.unit_cost) > 0)
        latestCostMap.set(id, this.number(event.unit_cost));
      if (["SALES_ISSUE", "PRODUCTION_ISSUE"].includes(event.event_type))
        consumptionMap.set(
          id,
          (consumptionMap.get(id) || 0) + this.number(event.quantity),
        );
    }
    const now = Date.now();
    const opportunities = Array.from(stockMap.values())
      .map((stock: any) => {
        const item: any = itemMap.get(stock.item_id) || {};
        const policy: any = policyMap.get(stock.item_id) || {};
        const slowDays = this.number(policy.slow_moving_days || 90);
        const obsoleteDays = this.number(policy.obsolete_days || 365);
        const targetDays = this.number(policy.target_days_supply || 45);
        const safetyStock = this.number(
          policy.safety_stock_quantity || stock.min_quantity,
        );
        const annualConsumption = consumptionMap.get(stock.item_id) || 0;
        const dailyConsumption = annualConsumption / 365;
        const targetQuantity = safetyStock + dailyConsumption * targetDays;
        const ageDays = stock.last_movement_date
          ? Math.max(
              0,
              Math.floor(
                (now - new Date(stock.last_movement_date).getTime()) / 86400000,
              ),
            )
          : 9999;
        const classification =
          ageDays >= obsoleteDays
            ? "OBSOLETE"
            : ageDays >= slowDays
              ? "SLOW"
              : stock.available_quantity > targetQuantity
                ? "EXCESS"
                : "HEALTHY";
        const opportunityQuantity =
          classification === "OBSOLETE"
            ? stock.available_quantity
            : Math.max(0, stock.available_quantity - targetQuantity);
        const unitCost =
          policy.unit_cost_override == null
            ? this.number(
                latestCostMap.get(stock.item_id) || item.standard_cost,
              )
            : this.number(policy.unit_cost_override);
        const cashRelease = opportunityQuantity * unitCost;
        const carryingRate = this.number(policy.annual_carrying_cost_pct || 20);
        return {
          ...stock,
          item,
          policy,
          annual_consumption: annualConsumption,
          daily_consumption: dailyConsumption,
          target_quantity: targetQuantity,
          age_days: ageDays,
          classification,
          opportunity_quantity: opportunityQuantity,
          unit_cost: unitCost,
          cash_release: cashRelease,
          annual_carrying_cost_avoidance: (cashRelease * carryingRate) / 100,
        };
      })
      .filter(
        (row: any) =>
          row.classification !== "HEALTHY" && row.opportunity_quantity > 0,
      )
      .sort((a: any, b: any) => b.cash_release - a.cash_release);
    const enrichedCases = cases.map((row: any) => ({
      ...row,
      item: itemMap.get(String(row.item_id)),
    }));
    return {
      kpis: {
        inventory_value_at_risk: opportunities.reduce(
          (sum: number, row: any) => sum + row.cash_release,
          0,
        ),
        annual_carrying_cost_opportunity: opportunities.reduce(
          (sum: number, row: any) => sum + row.annual_carrying_cost_avoidance,
          0,
        ),
        affected_items: opportunities.length,
        obsolete_items: opportunities.filter(
          (row: any) => row.classification === "OBSOLETE",
        ).length,
        approved_pipeline: enrichedCases
          .filter((row: any) => ["APPROVED", "EXECUTED"].includes(row.status))
          .reduce(
            (sum: number, row: any) =>
              sum + this.number(row.target_cash_release),
            0,
          ),
        verified_cash_release: enrichedCases
          .filter((row: any) => row.status === "VERIFIED")
          .reduce(
            (sum: number, row: any) =>
              sum + this.number(row.realized_cash_release),
            0,
          ),
      },
      opportunities,
      cases: enrichedCases,
      policies,
      items,
    };
  }

  async policy(tenantId: string, userId: string, body: any) {
    const itemId = this.text(body.item_id);
    const slowDays = Math.floor(this.number(body.slow_moving_days));
    const obsoleteDays = Math.floor(this.number(body.obsolete_days));
    if (!itemId || slowDays <= 0 || obsoleteDays <= slowDays)
      this.fail(
        null,
        "Item and valid slow/obsolete day thresholds are required.",
      );
    const override = this.text(body.unit_cost_override);
    const { data, error } = await this.db
      .from("inventory_working_capital_policies")
      .upsert(
        {
          tenant_id: tenantId,
          item_id: itemId,
          target_days_supply: this.number(body.target_days_supply),
          safety_stock_quantity: this.number(body.safety_stock_quantity),
          slow_moving_days: slowDays,
          obsolete_days: obsoleteDays,
          annual_carrying_cost_pct: this.number(body.annual_carrying_cost_pct),
          unit_cost_override: override ? this.number(override) : null,
          created_by: userId,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,item_id" },
      )
      .select()
      .single();
    if (error)
      this.fail(error, "Unable to save inventory working-capital policy.");
    return data;
  }

  async createCase(tenantId: string, userId: string, body: any) {
    const classification = this.text(body.classification).toUpperCase();
    const action = this.text(body.disposition_action).toUpperCase();
    const quantity = this.number(body.quantity);
    const unitCost = this.number(body.unit_cost);
    const rationale = this.text(body.rationale);
    if (
      !this.text(body.item_id) ||
      !["EXCESS", "SLOW", "OBSOLETE"].includes(classification) ||
      ![
        "RETURN",
        "TRANSFER",
        "DISCOUNT",
        "BUNDLE",
        "CONSUME",
        "RECYCLE",
        "WRITE_OFF",
      ].includes(action) ||
      quantity <= 0 ||
      !rationale
    )
      this.fail(
        null,
        "Item, classification, action, positive quantity and rationale are required.",
      );
    const { data, error } = await this.db
      .from("inventory_disposition_cases")
      .insert({
        tenant_id: tenantId,
        item_id: body.item_id,
        classification,
        disposition_action: action,
        quantity,
        unit_cost: unitCost,
        target_cash_release: this.number(
          body.target_cash_release || quantity * unitCost,
        ),
        target_annual_carrying_cost_avoidance: this.number(
          body.target_annual_carrying_cost_avoidance,
        ),
        rationale,
        created_by: userId,
      })
      .select()
      .single();
    if (error)
      this.fail(error, "Unable to propose inventory disposition case.");
    return data;
  }

  async approve(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.dispositionCase(tenantId, id);
    const note = this.text(body.approval_note);
    if (row.status !== "PROPOSED" || row.created_by === userId || !note)
      this.fail(null, "Independent approval with rationale is required.");
    return this.transition(
      tenantId,
      id,
      "PROPOSED",
      {
        status: "APPROVED",
        approval_note: note,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      },
      "Unable to approve disposition case.",
    );
  }

  async execute(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.dispositionCase(tenantId, id);
    const evidence = this.text(body.execution_evidence);
    if (row.status !== "APPROVED" || !evidence)
      this.fail(
        null,
        "Approved case and execution evidence are required. No stock or GL entry is created automatically.",
      );
    return this.transition(
      tenantId,
      id,
      "APPROVED",
      {
        status: "EXECUTED",
        execution_evidence: evidence,
        executed_by: userId,
        executed_at: new Date().toISOString(),
      },
      "Unable to record disposition execution.",
    );
  }

  async verify(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.dispositionCase(tenantId, id);
    const evidence = this.text(body.verification_evidence);
    const cash = this.number(body.realized_cash_release);
    const carrying = this.number(body.realized_carrying_cost_avoidance);
    if (
      row.status !== "EXECUTED" ||
      row.executed_by === userId ||
      !evidence ||
      cash < 0 ||
      carrying < 0
    )
      this.fail(
        null,
        "Independent verification, evidence and non-negative realized benefits are required.",
      );
    return this.transition(
      tenantId,
      id,
      "EXECUTED",
      {
        status: "VERIFIED",
        verification_evidence: evidence,
        realized_cash_release: cash,
        realized_carrying_cost_avoidance: carrying,
        verified_by: userId,
        verified_at: new Date().toISOString(),
      },
      "Unable to verify inventory benefit.",
    );
  }

  private async transition(
    tenantId: string,
    id: string,
    status: string,
    values: any,
    message: string,
  ) {
    const { data, error } = await this.db
      .from("inventory_disposition_cases")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", status)
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, message);
    return data;
  }
}
