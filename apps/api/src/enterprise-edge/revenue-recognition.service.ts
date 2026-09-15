import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
@Injectable()
export class RevenueRecognitionService {
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
  private async contractRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("revenue_recognition_contracts")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Revenue contract not found.");
    return data;
  }
  private async obligationRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("revenue_performance_obligations")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Performance obligation not found.");
    return data;
  }
  private async claimRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("revenue_recognition_claims")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Recognition claim not found.");
    return data;
  }
  async dashboard(t: string) {
    const [contracts, obligations, claims, accounts] = await Promise.all([
      this.db
        .from("revenue_recognition_contracts")
        .select("*")
        .eq("tenant_id", t)
        .order("created_at", { ascending: false }),
      this.db
        .from("revenue_performance_obligations")
        .select("*")
        .eq("tenant_id", t)
        .order("created_at"),
      this.db
        .from("revenue_recognition_claims")
        .select("*")
        .eq("tenant_id", t)
        .order("recognition_date", { ascending: false }),
      this.db
        .from("accounting_accounts")
        .select("id,account_code,account_name,account_type")
        .eq("tenant_id", t)
        .eq("is_active", true)
        .order("account_code"),
    ]);
    for (const r of [contracts, obligations, claims, accounts])
      if (r.error)
        this.fail(r.error, "Unable to load revenue recognition control.");
    const cs = contracts.data || [],
      os = obligations.data || [],
      xs = claims.data || [],
      cm = new Map(cs.map((x: any) => [String(x.id), x])),
      om = new Map(os.map((x: any) => [String(x.id), x]));
    const enriched = cs.map((c: any) => {
      const ids = os
          .filter((o: any) => o.contract_id === c.id)
          .map((o: any) => o.id),
        verified = xs
          .filter(
            (x: any) =>
              ids.includes(x.obligation_id) && x.status === "VERIFIED",
          )
          .reduce((n: number, x: any) => n + this.num(x.claimed_revenue), 0),
        asset = Math.max(0, verified - this.num(c.billed_amount_ex_tax)),
        liability = Math.max(0, this.num(c.billed_amount_ex_tax) - verified);
      return {
        ...c,
        recognized_revenue: verified,
        remaining_backlog: Math.max(
          0,
          this.num(c.transaction_price_ex_tax) - verified,
        ),
        contract_asset: asset,
        contract_liability: liability,
        obligation_count: ids.length,
      };
    });
    return {
      kpis: {
        active_contracts: enriched.filter((x: any) => x.status === "ACTIVE")
          .length,
        transaction_price: enriched.reduce(
          (n: number, x: any) => n + this.num(x.transaction_price_ex_tax),
          0,
        ),
        verified_revenue: enriched.reduce(
          (n: number, x: any) => n + x.recognized_revenue,
          0,
        ),
        remaining_backlog: enriched.reduce(
          (n: number, x: any) => n + x.remaining_backlog,
          0,
        ),
        contract_assets: enriched.reduce(
          (n: number, x: any) => n + x.contract_asset,
          0,
        ),
        contract_liabilities: enriched.reduce(
          (n: number, x: any) => n + x.contract_liability,
          0,
        ),
        pending_verification: xs.filter((x: any) => x.status === "PROPOSED")
          .length,
      },
      contracts: enriched,
      obligations: os.map((o: any) => ({
        ...o,
        contract: cm.get(String(o.contract_id)),
      })),
      claims: xs.map((x: any) => ({
        ...x,
        obligation: om.get(String(x.obligation_id)),
        contract: cm.get(String(om.get(String(x.obligation_id))?.contract_id)),
      })),
      accounts: accounts.data || [],
    };
  }
  async contract(t: string, u: string, b: any) {
    const code = this.text(b.contract_code).toUpperCase(),
      customer = this.text(b.customer_name),
      date = this.text(b.contract_date),
      start = this.text(b.start_date),
      end = this.text(b.end_date),
      price = this.num(b.transaction_price_ex_tax),
      billed = this.num(b.billed_amount_ex_tax),
      evidence = this.text(b.contract_evidence);
    if (
      !code ||
      !customer ||
      !date ||
      !start ||
      !end ||
      start > end ||
      price <= 0 ||
      billed < 0 ||
      !evidence
    )
      this.fail(
        null,
        "Valid customer contract, dates, tax-exclusive price, billing and evidence are required.",
      );
    const { data, error } = await this.db
      .from("revenue_recognition_contracts")
      .insert({
        tenant_id: t,
        contract_code: code,
        customer_name: customer,
        customer_trn: this.text(b.customer_trn) || null,
        contract_date: date,
        start_date: start,
        end_date: end,
        transaction_price_ex_tax: price,
        billed_amount_ex_tax: billed,
        currency_code: "AED",
        contract_evidence: evidence,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create revenue contract.");
    return data;
  }
  async obligation(t: string, u: string, id: string, b: any) {
    const c = await this.contractRow(t, id),
      code = this.text(b.obligation_code).toUpperCase(),
      description = this.text(b.description),
      pattern = this.text(b.satisfaction_pattern).toUpperCase(),
      ssp = this.num(b.standalone_selling_price),
      start = this.text(b.recognition_start_date),
      end = this.text(b.recognition_end_date),
      criteria = this.text(b.acceptance_criteria);
    if (
      c.status !== "DRAFT" ||
      !code ||
      !description ||
      !["POINT_IN_TIME", "OVER_TIME"].includes(pattern) ||
      ssp <= 0 ||
      !start ||
      !end ||
      start > end ||
      start < c.start_date ||
      end > c.end_date ||
      !criteria
    )
      this.fail(
        null,
        "A draft contract and valid distinct obligation, SSP, recognition dates and acceptance criteria are required.",
      );
    const { data, error } = await this.db
      .from("revenue_performance_obligations")
      .insert({
        tenant_id: t,
        contract_id: id,
        obligation_code: code,
        description,
        satisfaction_pattern: pattern,
        standalone_selling_price: ssp,
        recognition_start_date: start,
        recognition_end_date: end,
        acceptance_criteria: criteria,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to add performance obligation.");
    return data;
  }
  async approve(t: string, u: string, id: string, b: any) {
    const c = await this.contractRow(t, id),
      note = this.text(b.approval_note),
      keys = [
        "receivable_account_id",
        "contract_asset_account_id",
        "contract_liability_account_id",
        "revenue_account_id",
      ],
      patch: any = {};
    for (const k of keys) {
      patch[k] = this.text(b[k]);
      if (!patch[k]) this.fail(null, "All IFRS 15 GL mappings are required.");
    }
    if (c.status !== "DRAFT" || c.created_by === u || !note)
      this.fail(
        null,
        "Independent contract approval and GL mappings are required.",
      );
    const { data: os, error: oe } = await this.db
      .from("revenue_performance_obligations")
      .select("id,standalone_selling_price")
      .eq("tenant_id", t)
      .eq("contract_id", id);
    if (oe || !(os || []).length)
      this.fail(oe, "At least one performance obligation is required.");
    const { data: as, error: ae } = await this.db
      .from("accounting_accounts")
      .select("id,account_type")
      .eq("tenant_id", t)
      .in(
        "id",
        keys.map((k) => patch[k]),
      );
    if (ae || (as || []).length !== 4)
      this.fail(ae, "Mapped accounts must belong to this tenant.");
    const tm = new Map((as || []).map((a: any) => [a.id, a.account_type]));
    if (
      tm.get(patch.receivable_account_id) !== "ASSET" ||
      tm.get(patch.contract_asset_account_id) !== "ASSET" ||
      tm.get(patch.contract_liability_account_id) !== "LIABILITY" ||
      tm.get(patch.revenue_account_id) !== "REVENUE"
    )
      this.fail(
        null,
        "Use asset, liability and revenue accounts in the required IFRS 15 mappings.",
      );
    const total = (os || []).reduce(
      (n: number, o: any) => n + this.num(o.standalone_selling_price),
      0,
    );
    for (const o of os || []) {
      const { error } = await this.db
        .from("revenue_performance_obligations")
        .update({
          allocated_transaction_price:
            (this.num(c.transaction_price_ex_tax) *
              this.num(o.standalone_selling_price)) /
            total,
        })
        .eq("tenant_id", t)
        .eq("id", o.id);
      if (error) this.fail(error, "Unable to allocate transaction price.");
    }
    const { data, error } = await this.db
      .from("revenue_recognition_contracts")
      .update({
        ...patch,
        status: "ACTIVE",
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
    if (error || !data)
      this.fail(error, "Unable to activate revenue contract.");
    return data;
  }
  async claim(t: string, u: string, id: string, b: any) {
    const o = await this.obligationRow(t, id),
      c = await this.contractRow(t, o.contract_id),
      date = this.text(b.recognition_date),
      progress = this.num(b.cumulative_progress_pct),
      evidence = this.text(b.performance_evidence),
      acceptance = this.text(b.customer_acceptance_reference);
    const { data: prior, error: pe } = await this.db
      .from("revenue_recognition_claims")
      .select("cumulative_progress_pct")
      .eq("tenant_id", t)
      .eq("obligation_id", id)
      .eq("status", "VERIFIED")
      .order("cumulative_progress_pct", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pe) this.fail(pe, "Unable to validate prior recognition.");
    const previous = this.num(prior?.cumulative_progress_pct);
    if (
      c.status !== "ACTIVE" ||
      !date ||
      date < o.recognition_start_date ||
      date > o.recognition_end_date ||
      progress <= previous ||
      progress > 100 ||
      !evidence ||
      (o.satisfaction_pattern === "POINT_IN_TIME" &&
        (progress !== 100 || !acceptance))
    )
      this.fail(
        null,
        "Valid incremental progress, recognition date, evidence and point-in-time acceptance are required.",
      );
    const amount =
      (this.num(o.allocated_transaction_price) * (progress - previous)) / 100;
    const { data, error } = await this.db
      .from("revenue_recognition_claims")
      .insert({
        tenant_id: t,
        obligation_id: id,
        recognition_date: date,
        cumulative_progress_pct: progress,
        prior_verified_progress_pct: previous,
        claimed_revenue: amount,
        performance_evidence: evidence,
        customer_acceptance_reference: acceptance || null,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose revenue recognition.");
    return data;
  }
  async verify(t: string, u: string, id: string, b: any) {
    const x = await this.claimRow(t, id),
      note = this.text(b.verification_note),
      evidence = this.text(b.finance_evidence);
    if (x.status !== "PROPOSED" || x.created_by === u || !note || !evidence)
      this.fail(
        null,
        "Independent finance verification and evidence are required.",
      );
    const { data: later } = await this.db
      .from("revenue_recognition_claims")
      .select("id")
      .eq("tenant_id", t)
      .eq("obligation_id", x.obligation_id)
      .eq("status", "VERIFIED")
      .gt("cumulative_progress_pct", x.prior_verified_progress_pct)
      .limit(1)
      .maybeSingle();
    if (later)
      this.fail(
        null,
        "Recognition sequence changed; recreate this claim from the latest verified progress.",
      );
    const { data, error } = await this.db
      .from("revenue_recognition_claims")
      .update({
        status: "VERIFIED",
        verified_by: u,
        verification_note: note,
        finance_evidence: evidence,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", t)
      .eq("id", id)
      .eq("status", "PROPOSED")
      .select()
      .maybeSingle();
    if (error || !data)
      this.fail(error, "Unable to verify revenue recognition.");
    return data;
  }
}
