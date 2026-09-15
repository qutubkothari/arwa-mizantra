import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
@Injectable()
export class TreasuryControlService {
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
  private async optimization(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("treasury_optimization_actions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data)
      this.fail(error, "Treasury optimization action not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const [banksResult, positionsResult, exposuresResult, actionsResult] =
      await Promise.all([
        this.db
          .from("accounting_bank_accounts")
          .select(
            "id,bank_name,account_name,account_number_masked,currency_code,is_active",
          )
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("bank_name"),
        this.db
          .from("treasury_cash_positions")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("as_of_date", { ascending: false }),
        this.db
          .from("treasury_fx_exposures")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("status", "OPEN")
          .order("due_date"),
        this.db
          .from("treasury_optimization_actions")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
      ]);
    if (banksResult.error)
      this.fail(banksResult.error, "Unable to load bank accounts.");
    if (positionsResult.error)
      this.fail(positionsResult.error, "Unable to load cash positions.");
    if (exposuresResult.error)
      this.fail(exposuresResult.error, "Unable to load FX exposures.");
    if (actionsResult.error)
      this.fail(actionsResult.error, "Unable to load treasury actions.");
    const banks = banksResult.data || [];
    const bankMap = new Map(banks.map((row: any) => [String(row.id), row]));
    const latest = new Map<string, any>();
    for (const row of positionsResult.data || [])
      if (!latest.has(String(row.bank_account_id)))
        latest.set(String(row.bank_account_id), row);
    const positions = Array.from(latest.values()).map((row: any) => {
      const usable =
        this.number(row.available_balance) - this.number(row.restricted_cash);
      const buffer = this.number(row.minimum_operating_buffer);
      const surplus = Math.max(0, usable - buffer);
      const fundingGap = Math.max(0, buffer - usable);
      const yieldSpread = Math.max(
        0,
        this.number(row.borrowing_cost_pct) -
          this.number(row.deposit_yield_pct),
      );
      return {
        ...row,
        bank: bankMap.get(String(row.bank_account_id)),
        usable_liquidity: usable,
        surplus_cash: surplus,
        funding_gap: fundingGap,
        annual_interest_opportunity: (surplus * yieldSpread) / 100,
      };
    });
    const exposures = exposuresResult.data || [];
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDays = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const enrichedExposures = exposures.map((row: any) => ({
      ...row,
      unhedged_amount_aed: Math.max(
        0,
        this.number(row.base_amount_aed) - this.number(row.hedged_amount_aed),
      ),
      maturity_bucket:
        row.due_date < today
          ? "OVERDUE"
          : row.due_date <= thirtyDays
            ? "0-30 DAYS"
            : "LATER",
    }));
    const actions = actionsResult.data || [];
    return {
      kpis: {
        usable_liquidity: positions.reduce(
          (sum: number, row: any) => sum + row.usable_liquidity,
          0,
        ),
        surplus_cash: positions.reduce(
          (sum: number, row: any) => sum + row.surplus_cash,
          0,
        ),
        funding_gap: positions.reduce(
          (sum: number, row: any) => sum + row.funding_gap,
          0,
        ),
        unhedged_fx_exposure: enrichedExposures.reduce(
          (sum: number, row: any) => sum + row.unhedged_amount_aed,
          0,
        ),
        annual_interest_opportunity: positions.reduce(
          (sum: number, row: any) => sum + row.annual_interest_opportunity,
          0,
        ),
        verified_benefit: actions
          .filter((row: any) => row.status === "VERIFIED")
          .reduce(
            (sum: number, row: any) =>
              sum +
              this.number(row.realized_cash_release) +
              this.number(row.realized_annual_savings),
            0,
          ),
      },
      banks,
      positions,
      exposures: enrichedExposures,
      actions,
    };
  }

  async position(tenantId: string, userId: string, body: any) {
    const bankId = this.text(body.bank_account_id);
    const date = this.text(body.as_of_date);
    const evidence = this.text(body.evidence_reference);
    const restricted = this.number(body.restricted_cash);
    const buffer = this.number(body.minimum_operating_buffer);
    if (
      !bankId ||
      !date ||
      date > new Date().toISOString().slice(0, 10) ||
      !evidence ||
      restricted < 0 ||
      buffer < 0
    )
      this.fail(
        null,
        "Bank account, non-future date, valid balances and evidence are required.",
      );
    const { data, error } = await this.db
      .from("treasury_cash_positions")
      .upsert(
        {
          tenant_id: tenantId,
          bank_account_id: bankId,
          as_of_date: date,
          available_balance: this.number(body.available_balance),
          restricted_cash: restricted,
          minimum_operating_buffer: buffer,
          deposit_yield_pct: this.number(body.deposit_yield_pct),
          borrowing_cost_pct: this.number(body.borrowing_cost_pct),
          evidence_reference: evidence,
          created_by: userId,
        },
        { onConflict: "tenant_id,bank_account_id,as_of_date" },
      )
      .select()
      .single();
    if (error) this.fail(error, "Unable to save treasury cash position.");
    return data;
  }

  async exposure(tenantId: string, userId: string, body: any) {
    const reference = this.text(body.exposure_reference).toUpperCase();
    const type = this.text(body.exposure_type).toUpperCase();
    const direction = this.text(body.direction).toUpperCase();
    const currency = this.text(body.currency_code).toUpperCase();
    const due = this.text(body.due_date);
    const evidence = this.text(body.evidence_reference);
    if (
      !reference ||
      !["RECEIVABLE", "PAYABLE", "LOAN", "PURCHASE", "SALE"].includes(type) ||
      !["INFLOW", "OUTFLOW"].includes(direction) ||
      !currency ||
      currency === "AED" ||
      this.number(body.foreign_amount) <= 0 ||
      this.number(body.base_amount_aed) < 0 ||
      !due ||
      !evidence
    )
      this.fail(
        null,
        "Reference, foreign currency exposure, direction, positive amount, AED value, due date and evidence are required.",
      );
    const { data, error } = await this.db
      .from("treasury_fx_exposures")
      .upsert(
        {
          tenant_id: tenantId,
          exposure_reference: reference,
          exposure_type: type,
          direction,
          currency_code: currency,
          foreign_amount: this.number(body.foreign_amount),
          base_amount_aed: this.number(body.base_amount_aed),
          due_date: due,
          hedged_amount_aed: this.number(body.hedged_amount_aed),
          evidence_reference: evidence,
          created_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,exposure_reference" },
      )
      .select()
      .single();
    if (error) this.fail(error, "Unable to save FX exposure.");
    return data;
  }

  async action(tenantId: string, userId: string, body: any) {
    const type = this.text(body.action_type).toUpperCase();
    const description = this.text(body.action_description);
    const owner = this.text(body.owner_reference);
    const due = this.text(body.due_date);
    if (
      ![
        "SWEEP",
        "REPAY",
        "INVEST",
        "HEDGE",
        "REFINANCE",
        "NEGOTIATE_FEES",
      ].includes(type) ||
      !description ||
      !owner ||
      !due
    )
      this.fail(
        null,
        "Treasury action, description, owner and due date are required.",
      );
    const { data, error } = await this.db
      .from("treasury_optimization_actions")
      .insert({
        tenant_id: tenantId,
        action_type: type,
        action_description: description,
        owner_reference: owner,
        due_date: due,
        target_cash_release: this.number(body.target_cash_release),
        target_annual_savings: this.number(body.target_annual_savings),
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose treasury action.");
    return data;
  }

  async approve(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.optimization(tenantId, id);
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
      "Unable to approve treasury action.",
    );
  }
  async execute(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.optimization(tenantId, id);
    const evidence = this.text(body.execution_evidence);
    if (row.status !== "APPROVED" || !evidence)
      this.fail(
        null,
        "Approved treasury action and bank/deal evidence are required. No transaction is initiated automatically.",
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
      "Unable to record treasury execution.",
    );
  }
  async verify(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.optimization(tenantId, id);
    const evidence = this.text(body.verification_evidence);
    const cash = this.number(body.realized_cash_release);
    const savings = this.number(body.realized_annual_savings);
    if (
      row.status !== "EXECUTED" ||
      row.executed_by === userId ||
      !evidence ||
      cash < 0 ||
      savings < 0
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
        realized_annual_savings: savings,
        verified_by: userId,
        verified_at: new Date().toISOString(),
      },
      "Unable to verify treasury benefit.",
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
      .from("treasury_optimization_actions")
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
