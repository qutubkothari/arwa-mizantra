import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
@Injectable()
export class ProvisionControlService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  private fail(e: any, m: string): never {
    throw new BadRequestException(e?.message || m);
  }
  private text(v: any) {
    return String(v || "").trim();
  }
  private num(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  private async caseRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("provision_control_cases")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Provision case not found.");
    return data;
  }
  private async reviewRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("provision_case_reviews")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Provision review not found.");
    return data;
  }
  private classification(c: any, prob: number) {
    return prob >= this.num(c.recognition_threshold_pct)
      ? "PROVISION"
      : prob >= this.num(c.disclosure_threshold_pct)
        ? "CONTINGENT_LIABILITY"
        : "REMOTE";
  }
  private async valuation(t: string, id: string, rate: number, asOf: string) {
    const { data, error } = await this.db
      .from("provision_cashflow_scenarios")
      .select("*")
      .eq("tenant_id", t)
      .eq("case_id", id);
    if (error) this.fail(error, "Unable to value provision cash flows.");
    const rows = data || [],
      weight = rows.reduce(
        (n: number, x: any) => n + this.num(x.probability_weight_pct),
        0,
      );
    if (!rows.length || Math.abs(weight - 100) > 0.01)
      this.fail(null, "Cash-flow scenario weights must total exactly 100%.");
    const base = new Date(`${asOf}T00:00:00Z`).getTime();
    let weighted = 0,
      pv = 0;
    for (const x of rows) {
      const amount =
          (this.num(x.cashflow_amount) * this.num(x.probability_weight_pct)) /
          100,
        days = Math.max(
          0,
          (new Date(`${x.expected_payment_date}T00:00:00Z`).getTime() - base) /
            86400000,
        );
      weighted += amount;
      pv += amount / Math.pow(1 + rate / 100, days / 365);
    }
    return { weighted, pv };
  }
  async dashboard(t: string) {
    const [cases, cashflows, reviews, accounts] = await Promise.all([
      this.db
        .from("provision_control_cases")
        .select("*")
        .eq("tenant_id", t)
        .order("created_at", { ascending: false }),
      this.db
        .from("provision_cashflow_scenarios")
        .select("*")
        .eq("tenant_id", t)
        .order("created_at"),
      this.db
        .from("provision_case_reviews")
        .select("*")
        .eq("tenant_id", t)
        .order("review_date", { ascending: false }),
      this.db
        .from("accounting_accounts")
        .select("id,account_code,account_name,account_type")
        .eq("tenant_id", t)
        .eq("is_active", true)
        .order("account_code"),
    ]);
    for (const r of [cases, cashflows, reviews, accounts])
      if (r.error) this.fail(r.error, "Unable to load IAS 37 control.");
    const cs = cases.data || [],
      cm = new Map(cs.map((x: any) => [String(x.id), x])),
      today = new Date().toISOString().slice(0, 10);
    return {
      kpis: {
        approved_cases: cs.filter((x: any) => x.status === "APPROVED").length,
        recognized_provisions: cs
          .filter(
            (x: any) =>
              x.status === "APPROVED" && x.classification === "PROVISION",
          )
          .reduce((n: number, x: any) => n + this.num(x.recognized_amount), 0),
        contingent_exposure: cs
          .filter(
            (x: any) =>
              x.status === "APPROVED" &&
              x.classification === "CONTINGENT_LIABILITY",
          )
          .reduce(
            (n: number, x: any) => n + this.num(x.present_value_exposure),
            0,
          ),
        overdue_reviews: cs.filter(
          (x: any) => x.status === "APPROVED" && x.next_review_date < today,
        ).length,
        pending_reviews: (reviews.data || []).filter(
          (x: any) => x.status === "PROPOSED",
        ).length,
        settlement_variance: cs
          .filter((x: any) => x.status === "SETTLED")
          .reduce(
            (n: number, x: any) =>
              n +
              this.num(x.actual_settlement_amount) -
              this.num(x.recognized_amount),
            0,
          ),
      },
      cases: cs.map((x: any) => ({
        ...x,
        cashflows: (cashflows.data || []).filter(
          (f: any) => f.case_id === x.id,
        ),
        settlement_variance:
          x.status === "SETTLED"
            ? this.num(x.actual_settlement_amount) -
              this.num(x.recognized_amount)
            : null,
      })),
      reviews: (reviews.data || []).map((x: any) => ({
        ...x,
        case: cm.get(String(x.case_id)),
      })),
      accounts: accounts.data || [],
    };
  }
  async create(t: string, u: string, b: any) {
    const code = this.text(b.case_code).toUpperCase(),
      type = this.text(b.case_type).toUpperCase(),
      title = this.text(b.title),
      description = this.text(b.description),
      event = this.text(b.obligating_event_date),
      settlement = this.text(b.expected_settlement_date),
      prob = this.num(b.probability_pct),
      rate = this.num(b.discount_rate_pct),
      recognition = this.num(b.recognition_threshold_pct),
      disclosure = this.num(b.disclosure_threshold_pct),
      owner = this.text(b.owner_reference),
      evidence = this.text(b.source_evidence),
      review = this.text(b.next_review_date);
    if (
      !code ||
      ![
        "LEGAL",
        "WARRANTY",
        "ONEROUS_CONTRACT",
        "DECOMMISSIONING",
        "RESTRUCTURING",
        "OTHER",
      ].includes(type) ||
      !title ||
      !description ||
      !event ||
      !settlement ||
      settlement < event ||
      prob < 0 ||
      prob > 100 ||
      rate < 0 ||
      rate > 100 ||
      disclosure < 0 ||
      recognition > 100 ||
      disclosure > recognition ||
      !owner ||
      !evidence ||
      !review
    )
      this.fail(
        null,
        "Valid IAS 37 case, thresholds, dates, owner and evidence are required.",
      );
    const { data, error } = await this.db
      .from("provision_control_cases")
      .insert({
        tenant_id: t,
        case_code: code,
        case_type: type,
        title,
        description,
        obligating_event_date: event,
        expected_settlement_date: settlement,
        probability_pct: prob,
        discount_rate_pct: rate,
        recognition_threshold_pct: recognition,
        disclosure_threshold_pct: disclosure,
        owner_reference: owner,
        source_evidence: evidence,
        next_review_date: review,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create provision case.");
    return data;
  }
  async cashflow(t: string, u: string, id: string, b: any) {
    const c = await this.caseRow(t, id),
      label = this.text(b.scenario_label),
      amount = this.num(b.cashflow_amount),
      weight = this.num(b.probability_weight_pct),
      date = this.text(b.expected_payment_date),
      evidence = this.text(b.estimate_evidence);
    if (
      c.status !== "DRAFT" ||
      !label ||
      amount < 0 ||
      weight <= 0 ||
      weight > 100 ||
      !date ||
      !evidence
    )
      this.fail(
        null,
        "A draft case and valid evidenced cash-flow scenario are required.",
      );
    const { data: existing } = await this.db
      .from("provision_cashflow_scenarios")
      .select("probability_weight_pct")
      .eq("tenant_id", t)
      .eq("case_id", id);
    if (
      (existing || []).reduce(
        (n: number, x: any) => n + this.num(x.probability_weight_pct),
        0,
      ) +
        weight >
      100.01
    )
      this.fail(null, "Scenario probability weights cannot exceed 100%.");
    const { data, error } = await this.db
      .from("provision_cashflow_scenarios")
      .insert({
        tenant_id: t,
        case_id: id,
        scenario_label: label,
        cashflow_amount: amount,
        probability_weight_pct: weight,
        expected_payment_date: date,
        estimate_evidence: evidence,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to add cash-flow scenario.");
    return data;
  }
  async approve(t: string, u: string, id: string, b: any) {
    const c = await this.caseRow(t, id),
      note = this.text(b.approval_note),
      expense = this.text(b.provision_expense_account_id),
      liability = this.text(b.provision_liability_account_id);
    if (c.status !== "DRAFT" || c.created_by === u || !note)
      this.fail(null, "Independent IAS 37 approval is required.");
    const value = await this.valuation(
        t,
        id,
        this.num(c.discount_rate_pct),
        c.obligating_event_date,
      ),
      classification = this.classification(c, this.num(c.probability_pct));
    if (classification === "PROVISION" && (!expense || !liability))
      this.fail(
        null,
        "Provision expense and liability mappings are required for recognized provisions.",
      );
    if (classification === "PROVISION") {
      const { data, error } = await this.db
        .from("accounting_accounts")
        .select("id,account_type")
        .eq("tenant_id", t)
        .in("id", [expense, liability]);
      if (error || (data || []).length !== 2)
        this.fail(error, "Mapped accounts must belong to this tenant.");
      const tm = new Map((data || []).map((x: any) => [x.id, x.account_type]));
      if (tm.get(expense) !== "EXPENSE" || tm.get(liability) !== "LIABILITY")
        this.fail(
          null,
          "Use expense and liability accounts for the provision mapping.",
        );
    }
    const { data, error } = await this.db
      .from("provision_control_cases")
      .update({
        status: "APPROVED",
        classification,
        probability_weighted_exposure: value.weighted,
        present_value_exposure: value.pv,
        recognized_amount: classification === "PROVISION" ? value.pv : 0,
        provision_expense_account_id: expense || null,
        provision_liability_account_id: liability || null,
        approved_by: u,
        approval_note: note,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", t)
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to approve provision case.");
    return data;
  }
  async review(t: string, u: string, id: string, b: any) {
    const c = await this.caseRow(t, id),
      date = this.text(b.review_date),
      prob = this.num(b.revised_probability_pct),
      rate = this.num(b.revised_discount_rate_pct),
      settlement = this.text(b.revised_settlement_date),
      next = this.text(b.next_review_date),
      conclusion = this.text(b.review_conclusion),
      evidence = this.text(b.review_evidence);
    if (
      c.status !== "APPROVED" ||
      !date ||
      prob < 0 ||
      prob > 100 ||
      rate < 0 ||
      rate > 100 ||
      !settlement ||
      !next ||
      !conclusion ||
      !evidence
    )
      this.fail(
        null,
        "An approved case and complete evidenced reassessment are required.",
      );
    const { data, error } = await this.db
      .from("provision_case_reviews")
      .insert({
        tenant_id: t,
        case_id: id,
        review_date: date,
        revised_probability_pct: prob,
        revised_discount_rate_pct: rate,
        revised_settlement_date: settlement,
        next_review_date: next,
        review_conclusion: conclusion,
        review_evidence: evidence,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose provision review.");
    return data;
  }
  async approveReview(t: string, u: string, id: string, b: any) {
    const r = await this.reviewRow(t, id),
      c = await this.caseRow(t, r.case_id),
      note = this.text(b.approval_note);
    if (
      r.status !== "PROPOSED" ||
      r.created_by === u ||
      c.status !== "APPROVED" ||
      !note
    )
      this.fail(null, "Independent reassessment approval is required.");
    const value = await this.valuation(
        t,
        c.id,
        this.num(r.revised_discount_rate_pct),
        r.review_date,
      ),
      classification = this.classification(
        c,
        this.num(r.revised_probability_pct),
      );
    const { error: ce } = await this.db
      .from("provision_control_cases")
      .update({
        probability_pct: r.revised_probability_pct,
        discount_rate_pct: r.revised_discount_rate_pct,
        expected_settlement_date: r.revised_settlement_date,
        next_review_date: r.next_review_date,
        classification,
        probability_weighted_exposure: value.weighted,
        present_value_exposure: value.pv,
        recognized_amount: classification === "PROVISION" ? value.pv : 0,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", t)
      .eq("id", c.id);
    if (ce) this.fail(ce, "Unable to apply provision reassessment.");
    const { data, error } = await this.db
      .from("provision_case_reviews")
      .update({
        status: "APPROVED",
        approved_by: u,
        approval_note: note,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", t)
      .eq("id", id)
      .eq("status", "PROPOSED")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to approve provision review.");
    return data;
  }
  async settle(t: string, u: string, id: string, b: any) {
    const c = await this.caseRow(t, id),
      amount = this.num(b.actual_settlement_amount),
      evidence = this.text(b.settlement_evidence);
    if (
      c.status !== "APPROVED" ||
      c.created_by === u ||
      amount < 0 ||
      !evidence
    )
      this.fail(
        null,
        "Independent settlement amount and evidence are required.",
      );
    const { data, error } = await this.db
      .from("provision_control_cases")
      .update({
        status: "SETTLED",
        actual_settlement_amount: amount,
        settlement_evidence: evidence,
        settled_by: u,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", t)
      .eq("id", id)
      .eq("status", "APPROVED")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to settle provision case.");
    return data;
  }
}
