import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class FpnaControlService {
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
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
  }
  private async cycle(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("fpna_plan_cycles")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "FP&A cycle not found.");
    return data;
  }
  private async scenario(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("fpna_scenarios")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "FP&A scenario not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const [cyclesResult, scenariosResult] = await Promise.all([
      this.db
        .from("fpna_plan_cycles")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      this.db
        .from("fpna_scenarios")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
    ]);
    if (cyclesResult.error)
      this.fail(cyclesResult.error, "Unable to load FP&A cycles.");
    if (scenariosResult.error)
      this.fail(scenariosResult.error, "Unable to load FP&A scenarios.");
    const cycles = cyclesResult.data || [],
      scenarios = scenariosResult.data || [];
    const cycleMap = new Map(cycles.map((row: any) => [String(row.id), row]));
    const enriched = scenarios.map((row: any) => ({
      ...row,
      cycle: cycleMap.get(String(row.cycle_id)),
    }));
    const approved = enriched.filter((row: any) => row.status === "APPROVED");
    return {
      kpis: {
        planning_cycles: cycles.length,
        scenarios: enriched.length,
        pending_approval: enriched.filter((row: any) => row.status === "DRAFT")
          .length,
        approved_revenue: approved.reduce(
          (sum: number, row: any) => sum + this.number(row.projected_revenue),
          0,
        ),
        approved_ebitda: approved.reduce(
          (sum: number, row: any) => sum + this.number(row.projected_ebitda),
          0,
        ),
        approved_free_cash: approved.reduce(
          (sum: number, row: any) => sum + this.number(row.projected_free_cash),
          0,
        ),
        approved_funding_need: approved.reduce(
          (sum: number, row: any) =>
            sum + this.number(row.projected_funding_need),
          0,
        ),
      },
      cycles,
      scenarios: enriched,
    };
  }

  private async actualSnapshot(tenantId: string, from: string, to: string) {
    const [
      accountsResult,
      periodLinesResult,
      balanceLinesResult,
      openItemsResult,
    ] = await Promise.all([
      this.db
        .from("accounting_accounts")
        .select("id,account_type,account_subtype,opening_debit,opening_credit")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      this.db
        .from("accounting_journal_lines")
        .select(
          "account_id,debit,credit,journal:accounting_journals!inner(journal_date,status)",
        )
        .eq("tenant_id", tenantId)
        .eq("journal.status", "POSTED")
        .gte("journal.journal_date", from)
        .lte("journal.journal_date", to),
      this.db
        .from("accounting_journal_lines")
        .select(
          "account_id,debit,credit,journal:accounting_journals!inner(journal_date,status)",
        )
        .eq("tenant_id", tenantId)
        .eq("journal.status", "POSTED")
        .lte("journal.journal_date", to),
      this.db
        .from("accounting_open_items")
        .select("direction,status,original_amount,settled_amount,document_date")
        .eq("tenant_id", tenantId)
        .in("status", ["OPEN", "PARTIAL"])
        .lte("document_date", to),
    ]);
    if (accountsResult.error)
      this.fail(accountsResult.error, "Unable to read chart of accounts.");
    if (periodLinesResult.error)
      this.fail(periodLinesResult.error, "Unable to read posted actuals.");
    if (balanceLinesResult.error)
      this.fail(balanceLinesResult.error, "Unable to read balance actuals.");
    if (openItemsResult.error)
      this.fail(openItemsResult.error, "Unable to read open-item actuals.");
    const accounts = accountsResult.data || [],
      accountMap = new Map(accounts.map((row: any) => [String(row.id), row]));
    let revenue = 0,
      expense = 0;
    for (const line of periodLinesResult.data || []) {
      const account: any = accountMap.get(String(line.account_id));
      if (account?.account_type === "REVENUE")
        revenue += this.number(line.credit) - this.number(line.debit);
      if (account?.account_type === "EXPENSE")
        expense += this.number(line.debit) - this.number(line.credit);
    }
    const balances = new Map<string, number>();
    for (const account of accounts)
      balances.set(
        String(account.id),
        this.number(account.opening_debit) -
          this.number(account.opening_credit),
      );
    for (const line of balanceLinesResult.data || [])
      balances.set(
        String(line.account_id),
        (balances.get(String(line.account_id)) || 0) +
          this.number(line.debit) -
          this.number(line.credit),
      );
    let cash = 0,
      inventory = 0;
    for (const account of accounts) {
      const balance = balances.get(String(account.id)) || 0;
      if (
        ["BANK", "CASH"].includes(
          String(account.account_subtype || "").toUpperCase(),
        )
      )
        cash += balance;
      if (String(account.account_subtype || "").toUpperCase() === "INVENTORY")
        inventory += balance;
    }
    let receivables = 0,
      payables = 0;
    for (const item of openItemsResult.data || []) {
      const outstanding = Math.max(
        0,
        this.number(item.original_amount) - this.number(item.settled_amount),
      );
      if (item.direction === "RECEIVABLE") receivables += outstanding;
      if (item.direction === "PAYABLE") payables += outstanding;
    }
    const days = Math.max(
      1,
      Math.floor(
        (new Date(`${to}T00:00:00Z`).getTime() -
          new Date(`${from}T00:00:00Z`).getTime()) /
          86400000,
      ) + 1,
    );
    return {
      captured_at: new Date().toISOString(),
      period_days: days,
      period_revenue: Math.max(0, revenue),
      period_expense: Math.max(0, expense),
      annualized_revenue: (Math.max(0, revenue) / days) * 365,
      annualized_expense: (Math.max(0, expense) / days) * 365,
      cash_balance: cash,
      receivables,
      payables,
      inventory,
      baseline_nwc: receivables + inventory - payables,
      source: "POSTED_GL_AND_OPEN_ITEMS",
    };
  }

  async createCycle(tenantId: string, userId: string, body: any) {
    const code = this.text(body.cycle_code).toUpperCase(),
      name = this.text(body.cycle_name),
      from = this.text(body.actual_period_from),
      to = this.text(body.actual_period_to),
      months = Math.floor(this.number(body.forecast_months || 12));
    const today = new Date().toISOString().slice(0, 10);
    if (
      !code ||
      !name ||
      !from ||
      !to ||
      from > to ||
      to > today ||
      months < 3 ||
      months > 36
    )
      this.fail(
        null,
        "Code, name, completed actual period and forecast horizon of 3-36 months are required.",
      );
    const snapshot = await this.actualSnapshot(tenantId, from, to);
    const { data, error } = await this.db
      .from("fpna_plan_cycles")
      .insert({
        tenant_id: tenantId,
        cycle_code: code,
        cycle_name: name,
        actual_period_from: from,
        actual_period_to: to,
        forecast_months: months,
        currency_code: "AED",
        actual_snapshot: snapshot,
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create FP&A cycle.");
    return data;
  }

  async createScenario(tenantId: string, userId: string, body: any) {
    const cycleId = this.text(body.cycle_id),
      cycle = await this.cycle(tenantId, cycleId),
      name = this.text(body.scenario_name),
      type = this.text(body.scenario_type).toUpperCase();
    const growth = this.number(body.revenue_growth_pct),
      margin = this.number(body.gross_margin_pct),
      opexPct = this.number(body.opex_pct_of_revenue),
      dso = this.number(body.dso_days),
      dpo = this.number(body.dpo_days),
      inventoryDays = this.number(body.inventory_days),
      capex = this.number(body.capex),
      taxRate = this.number(body.tax_rate_pct),
      confidence = this.number(body.confidence_pct),
      evidence = this.text(body.assumptions_evidence);
    if (
      cycle.status !== "DRAFT" ||
      !name ||
      !["BASE", "UPSIDE", "DOWNSIDE", "STRESS", "BOARD"].includes(type) ||
      growth < -100 ||
      margin < 0 ||
      margin > 100 ||
      opexPct < 0 ||
      opexPct > 100 ||
      dso < 0 ||
      dpo < 0 ||
      inventoryDays < 0 ||
      capex < 0 ||
      taxRate < 0 ||
      taxRate > 100 ||
      confidence < 0 ||
      confidence > 100 ||
      !evidence
    )
      this.fail(
        null,
        "A draft cycle, valid driver assumptions, confidence and evidence are required.",
      );
    const actual = cycle.actual_snapshot || {},
      annualRevenue = this.number(actual.annualized_revenue),
      revenue = annualRevenue * (1 + growth / 100),
      grossProfit = (revenue * margin) / 100,
      opex = (revenue * opexPct) / 100,
      ebitda = grossProfit - opex,
      cogs = Math.max(0, revenue - grossProfit),
      nwc =
        (revenue * dso) / 365 +
        (cogs * inventoryDays) / 365 -
        (cogs * dpo) / 365,
      release = this.number(actual.baseline_nwc) - nwc,
      tax = Math.max(0, (ebitda * taxRate) / 100),
      freeCash = ebitda - tax - capex + release,
      funding = Math.max(
        0,
        capex +
          Math.max(0, nwc - this.number(actual.baseline_nwc)) -
          Math.max(0, this.number(actual.cash_balance)),
      );
    const { data, error } = await this.db
      .from("fpna_scenarios")
      .insert({
        tenant_id: tenantId,
        cycle_id: cycleId,
        scenario_name: name,
        scenario_type: type,
        revenue_growth_pct: growth,
        gross_margin_pct: margin,
        opex_pct_of_revenue: opexPct,
        dso_days: dso,
        dpo_days: dpo,
        inventory_days: inventoryDays,
        capex,
        tax_rate_pct: taxRate,
        confidence_pct: confidence,
        projected_revenue: revenue,
        projected_gross_profit: grossProfit,
        projected_opex: opex,
        projected_ebitda: ebitda,
        projected_nwc: nwc,
        working_capital_release: release,
        projected_funding_need: funding,
        projected_free_cash: freeCash,
        confidence_adjusted_free_cash: (freeCash * confidence) / 100,
        assumptions_evidence: evidence,
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to calculate FP&A scenario.");
    return data;
  }

  async approveScenario(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const scenario = await this.scenario(tenantId, id),
      note = this.text(body.approval_note);
    if (scenario.status !== "DRAFT" || scenario.created_by === userId || !note)
      this.fail(
        null,
        "Independent scenario approval with a challenge note is required.",
      );
    const { data, error } = await this.db
      .from("fpna_scenarios")
      .update({
        status: "APPROVED",
        confidence_pct: 100,
        confidence_adjusted_free_cash: scenario.projected_free_cash,
        approved_by: userId,
        approval_note: note,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to approve FP&A scenario.");
    await this.db
      .from("fpna_plan_cycles")
      .update({
        status: "APPROVED",
        approved_by: userId,
        approval_note: note,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", scenario.cycle_id)
      .eq("status", "DRAFT");
    return data;
  }
  async rejectScenario(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const scenario = await this.scenario(tenantId, id),
      reason = this.text(body.rejection_reason);
    if (
      scenario.status !== "DRAFT" ||
      scenario.created_by === userId ||
      !reason
    )
      this.fail(null, "Independent rejection reason is required.");
    const { data, error } = await this.db
      .from("fpna_scenarios")
      .update({
        status: "REJECTED",
        rejected_by: userId,
        rejection_reason: reason,
        rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to reject FP&A scenario.");
    return data;
  }
  async closeCycle(tenantId: string, userId: string, id: string, body: any) {
    const cycle = await this.cycle(tenantId, id),
      evidence = this.text(body.closure_evidence);
    if (cycle.status !== "APPROVED" || cycle.created_by === userId || !evidence)
      this.fail(
        null,
        "Independent closure evidence is required for an approved planning cycle.",
      );
    const { data, error } = await this.db
      .from("fpna_plan_cycles")
      .update({
        status: "CLOSED",
        closed_by: userId,
        closure_evidence: evidence,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "APPROVED")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to close FP&A cycle.");
    return data;
  }
}
