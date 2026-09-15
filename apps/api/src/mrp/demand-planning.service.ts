import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function buildDemandPlanFingerprint(lines: any[]) {
  const snapshot = (lines || [])
    .map((line) => ({
      item_id: String(line?.item_id || ""),
      consensus_forecast: (Array.isArray(line?.consensus_forecast)
        ? line.consensus_forecast
        : []
      )
        .map((bucket: any) => ({
          month: String(bucket?.month || "").slice(0, 7),
          quantity: Number(
            Math.max(0, Number(bucket?.quantity || 0)).toFixed(3),
          ),
        }))
        .sort((a: any, b: any) => a.month.localeCompare(b.month)),
    }))
    .sort((a, b) => a.item_id.localeCompare(b.item_id));
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

@Injectable()
export class DemandPlanningService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  private fail(error: any, message: string): never {
    throw new BadRequestException(error?.message || message);
  }
  private n(value: any) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }
  private t(value: any) {
    return String(value || "").trim();
  }
  private avg(values: number[]) {
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  }
  private month(date: Date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  async dashboard(tenantId: string) {
    const [
      { data: cycles, error },
      { data: activeCycle, error: activeCycleError },
    ] = await Promise.all([
      this.db
        .from("demand_plan_cycles")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(12),
      this.db
        .from("demand_plan_cycles")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (error) this.fail(error, "Unable to load demand plan.");
    if (activeCycleError)
      this.fail(activeCycleError, "Unable to identify the active MRP demand plan.");
    const cycle = cycles?.[0] || null;
    if (!cycle) {
      return {
        cycle: null,
        active_cycle: null,
        cycle_history: [],
        lines: [],
        scenarios: [],
      };
    }
    const [
      { data: lines, error: lineError },
      { data: scenarios, error: scenarioError },
    ] = await Promise.all([
      this.db
        .from("demand_plan_lines")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("cycle_id", cycle.id)
        .order("inventory_gap_value", { ascending: false }),
      this.db
        .from("demand_plan_scenarios")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("cycle_id", cycle.id)
        .order("created_at", { ascending: false }),
    ]);
    if (lineError) this.fail(lineError, "Unable to load forecast lines.");
    if (scenarioError) this.fail(scenarioError, "Unable to load scenarios.");
    return {
      cycle,
      active_cycle: activeCycle,
      cycle_history: cycles || [],
      lines: lines || [],
      scenarios: scenarios || [],
    };
  }

  async run(tenantId: string, userId: string) {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
    );
    const months = Array.from({ length: 12 }, (_, index) =>
      this.month(
        new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1),
        ),
      ),
    );
    const { data: invoices, error: invoiceError } = await this.db
      .from("invoices")
      .select("id,invoice_date,billing_status")
      .eq("tenant_id", tenantId)
      .gte("invoice_date", `${months[0]}-01`)
      .neq("billing_status", "CANCELLED");
    if (invoiceError) this.fail(invoiceError, "Unable to read sales history.");
    const invoiceMap = new Map(
      (invoices || []).map((row: any) => [
        String(row.id),
        this.t(row.invoice_date).slice(0, 7),
      ]),
    );
    const ids = [...invoiceMap.keys()];
    const { data: sales, error: salesError } = ids.length
      ? await this.db
          .from("sales_invoice_items")
          .select("invoice_id,item_id,quantity,unit_price,line_total")
          .in("invoice_id", ids)
      : ({ data: [], error: null } as any);
    if (salesError) this.fail(salesError, "Unable to read invoice lines.");
    const itemIds = [
      ...new Set((sales || []).map((row: any) => row.item_id).filter(Boolean)),
    ];
    const [{ data: items }, { data: stocks }, { data: entries }] =
      await Promise.all([
        itemIds.length
          ? this.db
              .from("items")
              .select("id,code,name")
              .eq("tenant_id", tenantId)
              .in("id", itemIds)
          : Promise.resolve({ data: [] }),
        itemIds.length
          ? this.db
              .from("inventory_stock")
              .select("item_id,available_quantity")
              .eq("tenant_id", tenantId)
              .in("item_id", itemIds)
          : Promise.resolve({ data: [] }),
        itemIds.length
          ? this.db
              .from("stock_entries")
              .select("item_id,available_quantity")
              .eq("tenant_id", tenantId)
              .in("item_id", itemIds)
              .gt("available_quantity", 0)
          : Promise.resolve({ data: [] }),
      ]);
    const itemMap = new Map(
      (items || []).map((row: any) => [String(row.id), row]),
    );
    const stockMap = new Map<string, number>();
    for (const row of [...(stocks || []), ...(entries || [])]) {
      const id = String((row as any).item_id);
      stockMap.set(
        id,
        Math.max(
          stockMap.get(id) || 0,
          this.n((row as any).available_quantity),
        ),
      );
    }
    const aggregate = new Map<string, any>();
    for (const row of sales || []) {
      const id = String(row.item_id);
      const saleMonth = invoiceMap.get(String(row.invoice_id));
      if (!saleMonth) continue;
      const current = aggregate.get(id) || {
        quantity: new Map<string, number>(),
        totalQuantity: 0,
        totalValue: 0,
      };
      current.quantity.set(
        saleMonth,
        (current.quantity.get(saleMonth) || 0) + this.n(row.quantity),
      );
      current.totalQuantity += this.n(row.quantity);
      current.totalValue += this.n(
        row.line_total || this.n(row.quantity) * this.n(row.unit_price),
      );
      aggregate.set(id, current);
    }
    const future = Array.from({ length: 6 }, (_, index) =>
      this.month(
        new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index + 1, 1),
        ),
      ),
    );
    const lines: any[] = [];
    for (const [id, aggregateLine] of aggregate) {
      const actual = months.map((month) =>
        this.n(aggregateLine.quantity.get(month)),
      );
      const recent = this.avg(actual.slice(-3));
      const previous = this.avg(actual.slice(-6, -3));
      const trend = Math.max(
        -0.2,
        Math.min(0.2, (recent - previous) / Math.max(previous, 1) / 3),
      );
      const forecast = future.map((month, index) => ({
        month,
        quantity: Number(
          Math.max(0, recent * (1 + trend * (index + 1))).toFixed(3),
        ),
      }));
      const errors: number[] = [];
      for (let index = 3; index < actual.length; index += 1) {
        const predicted = this.avg(actual.slice(index - 3, index));
        errors.push(
          Math.abs(actual[index] - predicted) / Math.max(actual[index], 1),
        );
      }
      const accuracy = errors.length
        ? Math.max(0, 100 - this.avg(errors) * 100)
        : null;
      const available = stockMap.get(id) || 0;
      const totalForecast = forecast.reduce(
        (sum, row) => sum + row.quantity,
        0,
      );
      const averageValue = aggregateLine.totalQuantity
        ? aggregateLine.totalValue / aggregateLine.totalQuantity
        : 0;
      const gap = Math.max(0, totalForecast - available);
      const activeMonths = actual.filter((quantity) => quantity > 0).length;
      const item: any = itemMap.get(id);
      lines.push({
        tenant_id: tenantId,
        item_id: id,
        item_code: item?.code || null,
        item_name: item?.name || null,
        demand_pattern:
          activeMonths >= 9
            ? "STABLE"
            : activeMonths >= 4
              ? "INTERMITTENT"
              : "NEW_OR_SPARSE",
        history_buckets: months.map((month, index) => ({
          month,
          quantity: actual[index],
        })),
        statistical_forecast: forecast,
        consensus_forecast: forecast,
        forecast_accuracy_pct:
          accuracy == null ? null : Number(accuracy.toFixed(2)),
        available_quantity: available,
        average_unit_value: Number(averageValue.toFixed(2)),
        inventory_gap_quantity: Number(gap.toFixed(3)),
        inventory_gap_value: Number((gap * averageValue).toFixed(2)),
        updated_by: userId,
      });
    }
    const totals = {
      units: lines.reduce(
        (sum, line) =>
          sum +
          line.consensus_forecast.reduce(
            (value: number, bucket: any) => value + this.n(bucket.quantity),
            0,
          ),
        0,
      ),
      revenue: lines.reduce(
        (sum, line) =>
          sum +
          line.consensus_forecast.reduce(
            (value: number, bucket: any) => value + this.n(bucket.quantity),
            0,
          ) *
            line.average_unit_value,
        0,
      ),
      gap: lines.reduce((sum, line) => sum + line.inventory_gap_value, 0),
      accuracy: this.avg(
        lines
          .map((line) => line.forecast_accuracy_pct)
          .filter((value: any) => value != null),
      ),
    };
    const { data: cycle, error: cycleError } = await this.db
      .from("demand_plan_cycles")
      .insert({
        tenant_id: tenantId,
        cycle_name: `S&OP ${this.month(now)}`,
        created_by: userId,
        forecast_units: totals.units,
        forecast_revenue: totals.revenue,
        inventory_gap_value: totals.gap,
        average_accuracy_pct: totals.accuracy || null,
      })
      .select()
      .single();
    if (cycleError) this.fail(cycleError, "Unable to create demand cycle.");
    if (lines.length) {
      const { error: lineError } = await this.db
        .from("demand_plan_lines")
        .insert(lines.map((line) => ({ ...line, cycle_id: cycle.id })));
      if (lineError) this.fail(lineError, "Unable to save forecast lines.");
    }
    return this.dashboard(tenantId);
  }

  async override(tenantId: string, userId: string, id: string, body: any) {
    const { data: line } = await this.db
      .from("demand_plan_lines")
      .select("*,cycle:demand_plan_cycles(*)")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (!line || line.cycle?.status !== "DRAFT")
      this.fail(null, "Only a draft demand plan can be adjusted.");
    const values = Array.isArray(body.quantities)
      ? body.quantities.map((value: any) => this.n(value))
      : [];
    const reason = this.t(body.override_reason);
    if (
      values.length !== 6 ||
      values.some((value: number) => value < 0) ||
      !reason
    )
      this.fail(
        null,
        "Six non-negative monthly quantities and an override reason are required.",
      );
    const statistical = line.statistical_forecast || [];
    const consensus = values.map((quantity: number, index: number) => ({
      month: statistical[index]?.month,
      quantity,
    }));
    const total = values.reduce((sum: number, value: number) => sum + value, 0);
    const gap = Math.max(0, total - this.n(line.available_quantity));
    const { data, error } = await this.db
      .from("demand_plan_lines")
      .update({
        consensus_forecast: consensus,
        override_reason: reason,
        inventory_gap_quantity: gap,
        inventory_gap_value: gap * this.n(line.average_unit_value),
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) this.fail(error, "Unable to update consensus.");
    await this.refreshCycle(tenantId, line.cycle_id);
    return data;
  }

  private async refreshCycle(tenantId: string, cycleId: string) {
    const { data: lines } = await this.db
      .from("demand_plan_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("cycle_id", cycleId);
    const units = (lines || []).reduce(
      (sum: number, line: any) =>
        sum +
        (line.consensus_forecast || []).reduce(
          (value: number, bucket: any) => value + this.n(bucket.quantity),
          0,
        ),
      0,
    );
    const revenue = (lines || []).reduce(
      (sum: number, line: any) =>
        sum +
        (line.consensus_forecast || []).reduce(
          (value: number, bucket: any) => value + this.n(bucket.quantity),
          0,
        ) *
          this.n(line.average_unit_value),
      0,
    );
    const gap = (lines || []).reduce(
      (sum: number, line: any) => sum + this.n(line.inventory_gap_value),
      0,
    );
    await this.db
      .from("demand_plan_cycles")
      .update({
        forecast_units: units,
        forecast_revenue: revenue,
        inventory_gap_value: gap,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", cycleId);
  }

  async scenario(tenantId: string, userId: string, body: any) {
    const dashboard = await this.dashboard(tenantId);
    const cycle: any = dashboard.cycle;
    if (!cycle) this.fail(null, "Run demand planning first.");
    const name = this.t(body.scenario_name);
    const change = this.n(body.demand_change_pct);
    const days = Math.max(0, Math.floor(this.n(body.safety_stock_days)));
    if (!name || change < -90 || change > 300)
      this.fail(
        null,
        "Scenario name and demand change between -90% and 300% are required.",
      );
    let units = 0,
      revenue = 0,
      gap = 0,
      working = 0;
    for (const line of dashboard.lines) {
      const base = (line.consensus_forecast || []).reduce(
        (sum: number, bucket: any) => sum + this.n(bucket.quantity),
        0,
      );
      const projected = base * (1 + change / 100);
      const required = projected + (base / 6) * (days / 30);
      const lineGap = Math.max(0, required - this.n(line.available_quantity));
      units += required;
      revenue += projected * this.n(line.average_unit_value);
      gap += lineGap;
      working += lineGap * this.n(line.average_unit_value);
    }
    const { data, error } = await this.db
      .from("demand_plan_scenarios")
      .insert({
        tenant_id: tenantId,
        cycle_id: cycle.id,
        scenario_name: name,
        demand_change_pct: change,
        safety_stock_days: days,
        projected_units: units,
        projected_revenue: revenue,
        inventory_gap_quantity: gap,
        working_capital_exposure: working,
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to save scenario.");
    return data;
  }

  async approve(tenantId: string, userId: string, id: string, body: any) {
    const [{ data: cycle }, { data: lines, error: lineError }] =
      await Promise.all([
        this.db
          .from("demand_plan_cycles")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("id", id)
          .maybeSingle(),
        this.db
          .from("demand_plan_lines")
          .select("id,item_id,consensus_forecast")
          .eq("tenant_id", tenantId)
          .eq("cycle_id", id),
      ]);
    if (!cycle || cycle.status !== "DRAFT")
      this.fail(null, "Only a draft cycle can be approved.");
    if (cycle.created_by === userId)
      this.fail(null, "Maker-checker control prevents self-approval.");
    if (lineError) this.fail(lineError, "Unable to verify demand plan lines.");
    if (!lines?.length)
      this.fail(null, "An empty demand cycle cannot be approved.");
    const evidence = this.t(body.approval_evidence);
    if (!evidence) this.fail(null, "Approval evidence is required.");
    const approvedAt = new Date().toISOString();
    const { data, error } = await this.db
      .from("demand_plan_cycles")
      .update({
        status: "APPROVED",
        approved_by: userId,
        approved_at: approvedAt,
        approval_evidence: evidence,
        snapshot_hash: buildDemandPlanFingerprint(lines),
        updated_at: approvedAt,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .single();
    if (error) this.fail(error, "Unable to approve demand plan.");
    return data;
  }
}
