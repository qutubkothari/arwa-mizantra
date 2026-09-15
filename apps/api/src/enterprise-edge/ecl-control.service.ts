import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
@Injectable()
export class EclControlService {
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
  private async modelRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("credit_ecl_models")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "ECL model not found.");
    return data;
  }
  private async assessment(t: string, id: string) {
    const { data, error } = await this.db
      .from("credit_ecl_assessments")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "ECL assessment not found.");
    return data;
  }
  private async overrideRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("credit_ecl_overrides")
      .select("*,assessment:credit_ecl_assessments(*)")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "ECL override not found.");
    return data;
  }
  async dashboard(t: string) {
    const [models, assessments, overrides, parties, accounts] =
      await Promise.all([
        this.db
          .from("credit_ecl_models")
          .select("*")
          .eq("tenant_id", t)
          .order("as_of_date", { ascending: false }),
        this.db
          .from("credit_ecl_assessments")
          .select("*")
          .eq("tenant_id", t)
          .order("expected_credit_loss", { ascending: false }),
        this.db
          .from("credit_ecl_overrides")
          .select("*")
          .eq("tenant_id", t)
          .order("created_at", { ascending: false }),
        this.db
          .from("accounting_parties")
          .select("id,party_code,party_name")
          .eq("tenant_id", t),
        this.db
          .from("accounting_accounts")
          .select("id,account_code,account_name,account_type")
          .eq("tenant_id", t)
          .eq("is_active", true)
          .order("account_code"),
      ]);
    for (const r of [models, assessments, overrides, parties, accounts])
      if (r.error) this.fail(r.error, "Unable to load IFRS 9 ECL control.");
    const ms = models.data || [],
      latest = ms[0] || null,
      as = (assessments.data || []).filter(
        (x: any) => x.model_id === latest?.id,
      ),
      pm = new Map((parties.data || []).map((x: any) => [String(x.id), x]));
    return {
      kpis: {
        models: ms.length,
        receivable_exposure: as.reduce(
          (n: number, x: any) => n + this.num(x.exposure_at_default),
          0,
        ),
        expected_credit_loss: as.reduce(
          (n: number, x: any) => n + this.num(x.expected_credit_loss),
          0,
        ),
        stage_2_exposure: as
          .filter((x: any) => x.stage === 2)
          .reduce(
            (n: number, x: any) => n + this.num(x.exposure_at_default),
            0,
          ),
        stage_3_exposure: as
          .filter((x: any) => x.stage === 3)
          .reduce(
            (n: number, x: any) => n + this.num(x.exposure_at_default),
            0,
          ),
        pending_overrides: (overrides.data || []).filter(
          (x: any) => x.status === "PROPOSED",
        ).length,
      },
      models: ms,
      latest_model: latest,
      assessments: as.map((x: any) => ({
        ...x,
        party: pm.get(String(x.party_id)),
      })),
      overrides: overrides.data || [],
      accounts: accounts.data || [],
    };
  }
  async model(t: string, u: string, b: any) {
    const code = this.text(b.model_code).toUpperCase(),
      name = this.text(b.model_name),
      date = this.text(b.as_of_date),
      p1 = this.num(b.stage_1_pd_pct),
      p2 = this.num(b.stage_2_pd_pct),
      p3 = this.num(b.stage_3_pd_pct),
      lgd = this.num(b.lgd_pct),
      factor = this.num(b.forward_looking_factor),
      evidence = this.text(b.methodology_evidence),
      today = new Date().toISOString().slice(0, 10);
    if (
      !code ||
      !name ||
      !date ||
      date > today ||
      [p1, p2, p3, lgd].some((x) => x < 0 || x > 100) ||
      p1 > p2 ||
      p2 > p3 ||
      factor < 0 ||
      factor > 5 ||
      !evidence
    )
      this.fail(
        null,
        "Completed as-of date, ordered stage PDs, LGD, forward factor and methodology evidence are required.",
      );
    const { data: model, error } = await this.db
      .from("credit_ecl_models")
      .insert({
        tenant_id: t,
        model_code: code,
        model_name: name,
        as_of_date: date,
        stage_1_pd_pct: p1,
        stage_2_pd_pct: p2,
        stage_3_pd_pct: p3,
        lgd_pct: lgd,
        forward_looking_factor: factor,
        methodology_evidence: evidence,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create ECL model.");
    const { data: items, error: ie } = await this.db
      .from("accounting_open_items")
      .select(
        "id,party_id,document_number,document_date,due_date,original_amount,settled_amount,direction,status",
      )
      .eq("tenant_id", t)
      .eq("direction", "RECEIVABLE")
      .in("status", ["OPEN", "PARTIAL"])
      .lte("document_date", date);
    if (ie) this.fail(ie, "Unable to read receivable exposure.");
    const asOf = new Date(`${date}T00:00:00Z`).getTime(),
      rows = (items || [])
        .map((x: any) => {
          const ead = Math.max(
              0,
              this.num(x.original_amount) - this.num(x.settled_amount),
            ),
            due = new Date(
              `${String(x.due_date || x.document_date).slice(0, 10)}T00:00:00Z`,
            ).getTime(),
            dpd = Math.max(0, Math.floor((asOf - due) / 86400000)),
            stage = dpd > 90 ? 3 : dpd > 30 ? 2 : 1,
            base = stage === 1 ? p1 : stage === 2 ? p2 : p3,
            pd = Math.min(100, base * factor),
            ecl = (((ead * pd) / 100) * lgd) / 100;
          return {
            tenant_id: t,
            model_id: model.id,
            open_item_id: x.id,
            party_id: x.party_id,
            document_number: x.document_number,
            due_date: x.due_date || x.document_date,
            days_past_due: dpd,
            stage,
            exposure_at_default: ead,
            pd_pct: pd,
            lgd_pct: lgd,
            expected_credit_loss: ecl,
            original_stage: stage,
            original_ecl: ecl,
          };
        })
        .filter((x: any) => x.exposure_at_default > 0);
    if (rows.length) {
      const { error: ae } = await this.db
        .from("credit_ecl_assessments")
        .insert(rows);
      if (ae) {
        await this.db
          .from("credit_ecl_models")
          .delete()
          .eq("tenant_id", t)
          .eq("id", model.id);
        this.fail(ae, "Unable to calculate ECL assessments.");
      }
    }
    return model;
  }
  async override(t: string, u: string, id: string, b: any) {
    const a = await this.assessment(t, id),
      m = await this.modelRow(t, a.model_id),
      stage = Math.floor(this.num(b.proposed_stage)),
      pd = this.num(b.proposed_pd_pct),
      lgd = this.num(b.proposed_lgd_pct),
      reason = this.text(b.override_reason),
      evidence = this.text(b.override_evidence);
    if (
      m.status !== "DRAFT" ||
      stage < 1 ||
      stage > 3 ||
      pd < 0 ||
      pd > 100 ||
      lgd < 0 ||
      lgd > 100 ||
      !reason ||
      !evidence
    )
      this.fail(
        null,
        "A draft model and evidenced, valid override are required.",
      );
    const { data, error } = await this.db
      .from("credit_ecl_overrides")
      .insert({
        tenant_id: t,
        assessment_id: id,
        proposed_stage: stage,
        proposed_pd_pct: pd,
        proposed_lgd_pct: lgd,
        override_reason: reason,
        override_evidence: evidence,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose ECL override.");
    return data;
  }
  async approveOverride(t: string, u: string, id: string, b: any) {
    const o = await this.overrideRow(t, id),
      note = this.text(b.approval_note),
      a: any = o.assessment,
      m = await this.modelRow(t, a.model_id);
    if (
      o.status !== "PROPOSED" ||
      o.created_by === u ||
      m.status !== "DRAFT" ||
      !note
    )
      this.fail(
        null,
        "Independent override approval is required while the model is draft.",
      );
    const ecl =
      (((this.num(a.exposure_at_default) * this.num(o.proposed_pd_pct)) / 100) *
        this.num(o.proposed_lgd_pct)) /
      100;
    const { error: ae } = await this.db
      .from("credit_ecl_assessments")
      .update({
        stage: o.proposed_stage,
        pd_pct: o.proposed_pd_pct,
        lgd_pct: o.proposed_lgd_pct,
        expected_credit_loss: ecl,
      })
      .eq("tenant_id", t)
      .eq("id", a.id);
    if (ae) this.fail(ae, "Unable to apply ECL override.");
    const { data, error } = await this.db
      .from("credit_ecl_overrides")
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
    if (error || !data) this.fail(error, "Unable to approve ECL override.");
    return data;
  }
  async approveModel(t: string, u: string, id: string, b: any) {
    const m = await this.modelRow(t, id),
      expense = this.text(b.impairment_expense_account_id),
      allowance = this.text(b.loss_allowance_account_id),
      note = this.text(b.approval_note);
    if (
      m.status !== "DRAFT" ||
      m.created_by === u ||
      !expense ||
      !allowance ||
      !note
    )
      this.fail(
        null,
        "Independent model approval and GL mappings are required.",
      );
    const { count, error: pe } = await this.db
      .from("credit_ecl_overrides")
      .select("*,assessment:credit_ecl_assessments!inner(model_id)", {
        head: true,
        count: "exact",
      })
      .eq("tenant_id", t)
      .eq("status", "PROPOSED")
      .eq("assessment.model_id", id);
    if (pe || (count || 0) > 0)
      this.fail(pe, "Resolve every proposed override before model approval.");
    const { data: ac, error: ae } = await this.db
      .from("accounting_accounts")
      .select("id,account_type")
      .eq("tenant_id", t)
      .in("id", [expense, allowance]);
    if (ae || (ac || []).length !== 2)
      this.fail(ae, "Mapped accounts must belong to this tenant.");
    const tm = new Map((ac || []).map((x: any) => [x.id, x.account_type]));
    if (tm.get(expense) !== "EXPENSE" || tm.get(allowance) !== "ASSET")
      this.fail(
        null,
        "Use an expense account and a loss-allowance asset account.",
      );
    const { data, error } = await this.db
      .from("credit_ecl_models")
      .update({
        status: "APPROVED",
        impairment_expense_account_id: expense,
        loss_allowance_account_id: allowance,
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
    if (error || !data) this.fail(error, "Unable to approve ECL model.");
    return data;
  }
}
