import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
@Injectable()
export class LeaseAccountingService {
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
  private async lease(t: string, id: string) {
    const { data, error } = await this.db
      .from("lease_accounting_contracts")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Lease not found.");
    return data;
  }
  private async eventRow(t: string, id: string) {
    const { data, error } = await this.db
      .from("lease_accounting_events")
      .select("*")
      .eq("tenant_id", t)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Lease event not found.");
    return data;
  }
  async dashboard(t: string) {
    const [leases, schedules, events, accounts] = await Promise.all([
      this.db
        .from("lease_accounting_contracts")
        .select("*")
        .eq("tenant_id", t)
        .order("created_at", { ascending: false }),
      this.db
        .from("lease_accounting_schedule")
        .select("*")
        .eq("tenant_id", t)
        .order("due_date"),
      this.db
        .from("lease_accounting_events")
        .select("*")
        .eq("tenant_id", t)
        .order("created_at", { ascending: false }),
      this.db
        .from("accounting_accounts")
        .select("id,account_code,account_name,account_type")
        .eq("tenant_id", t)
        .eq("is_active", true)
        .order("account_code"),
    ]);
    for (const result of [leases, schedules, events, accounts])
      if (result.error)
        this.fail(result.error, "Unable to load lease accounting control.");
    const rows = leases.data || [],
      schedule = schedules.data || [],
      leaseMap = new Map(rows.map((x: any) => [String(x.id), x]));
    const today = new Date().toISOString().slice(0, 10),
      horizon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
      renewal = new Date(Date.now() + 120 * 86400000)
        .toISOString()
        .slice(0, 10);
    const current = rows.map((x: any) => {
      const elapsed = schedule.filter(
          (s: any) => s.lease_id === x.id && s.due_date <= today,
        ),
        next = schedule.find(
          (s: any) => s.lease_id === x.id && s.due_date > today,
        );
      const depreciation = elapsed.reduce(
        (n: number, s: any) => n + this.num(s.rou_depreciation),
        0,
      );
      return {
        ...x,
        current_liability: elapsed.length
          ? this.num(elapsed[elapsed.length - 1].closing_liability)
          : this.num(x.initial_lease_liability),
        rou_net_book_value: Math.max(
          0,
          this.num(x.initial_rou_asset) - depreciation,
        ),
        next_payment: next || null,
      };
    });
    const due = schedule.filter(
      (s: any) =>
        s.due_date >= today &&
        s.due_date <= horizon &&
        ["ACTIVE"].includes(leaseMap.get(String(s.lease_id))?.status),
    );
    return {
      kpis: {
        active_leases: current.filter((x: any) => x.status === "ACTIVE").length,
        lease_liability: current
          .filter((x: any) => x.status === "ACTIVE")
          .reduce((n: number, x: any) => n + x.current_liability, 0),
        rou_net_book_value: current
          .filter((x: any) => x.status === "ACTIVE")
          .reduce((n: number, x: any) => n + x.rou_net_book_value, 0),
        payments_next_90_days: due.reduce(
          (n: number, x: any) => n + this.num(x.lease_payment),
          0,
        ),
        renewals_due: current.filter(
          (x: any) =>
            x.status === "ACTIVE" &&
            x.renewal_notice_date &&
            x.renewal_notice_date <= renewal,
        ).length,
        pending_events: (events.data || []).filter(
          (x: any) => x.status === "PROPOSED",
        ).length,
      },
      leases: current,
      schedule,
      events: (events.data || []).map((x: any) => ({
        ...x,
        lease: leaseMap.get(String(x.lease_id)),
      })),
      accounts: accounts.data || [],
    };
  }
  private buildSchedule(
    start: string,
    end: string,
    frequency: string,
    payment: number,
    annualRate: number,
    rou: number,
  ) {
    const perYear: any = { MONTHLY: 12, QUARTERLY: 4, ANNUAL: 1 },
      ppy = perYear[frequency],
      step = 12 / ppy,
      startDate = new Date(`${start}T00:00:00Z`),
      endDate = new Date(`${end}T00:00:00Z`),
      months = Math.max(
        1,
        (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
          endDate.getUTCMonth() -
          startDate.getUTCMonth(),
      ),
      periods = Math.max(1, Math.ceil(months / step)),
      rate = annualRate / 100 / ppy;
    const liability =
      rate === 0
        ? payment * periods
        : (payment * (1 - Math.pow(1 + rate, -periods))) / rate;
    let opening = liability;
    const rows = [];
    for (let i = 1; i <= periods; i++) {
      const interest = opening * rate,
        principal = Math.min(opening, Math.max(0, payment - interest)),
        closing = Math.max(0, opening - principal),
        due = new Date(startDate);
      due.setUTCMonth(due.getUTCMonth() + step * i);
      if (due > endDate) due.setTime(endDate.getTime());
      rows.push({
        period_number: i,
        due_date: due.toISOString().slice(0, 10),
        opening_liability: opening,
        interest_expense: interest,
        lease_payment: i === periods ? principal + interest : payment,
        principal_reduction: principal,
        closing_liability: closing,
        rou_depreciation: rou / periods,
      });
      opening = closing;
    }
    return { liability, rows };
  }
  async create(t: string, u: string, b: any) {
    const code = this.text(b.lease_code).toUpperCase(),
      type = this.text(b.lease_type).toUpperCase(),
      lessor = this.text(b.lessor_name),
      asset = this.text(b.asset_description),
      start = this.text(b.commencement_date),
      end = this.text(b.end_date),
      frequency = this.text(b.payment_frequency).toUpperCase(),
      payment = this.num(b.periodic_payment),
      rate = this.num(b.discount_rate_pct),
      cost = this.num(b.initial_direct_cost),
      incentives = this.num(b.lease_incentives),
      evidence = this.text(b.contract_evidence);
    if (
      !code ||
      !["PROPERTY", "EQUIPMENT", "VEHICLE", "OTHER"].includes(type) ||
      !lessor ||
      !asset ||
      !start ||
      !end ||
      start >= end ||
      !["MONTHLY", "QUARTERLY", "ANNUAL"].includes(frequency) ||
      payment <= 0 ||
      rate < 0 ||
      rate > 100 ||
      cost < 0 ||
      incentives < 0 ||
      !evidence
    )
      this.fail(
        null,
        "Valid lease details, dates, payments, discount rate and contract evidence are required.",
      );
    const base = this.buildSchedule(start, end, frequency, payment, rate, 1),
      rou = Math.max(0, base.liability + cost - incentives),
      calculated = this.buildSchedule(
        start,
        end,
        frequency,
        payment,
        rate,
        rou,
      );
    const { data, error } = await this.db
      .from("lease_accounting_contracts")
      .insert({
        tenant_id: t,
        lease_code: code,
        lease_type: type,
        lessor_name: lessor,
        asset_description: asset,
        commencement_date: start,
        end_date: end,
        payment_frequency: frequency,
        periodic_payment: payment,
        discount_rate_pct: rate,
        initial_direct_cost: cost,
        lease_incentives: incentives,
        initial_lease_liability: calculated.liability,
        initial_rou_asset: rou,
        renewal_notice_date: this.text(b.renewal_notice_date) || null,
        contract_evidence: evidence,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create lease.");
    const { error: scheduleError } = await this.db
      .from("lease_accounting_schedule")
      .insert(
        calculated.rows.map((x: any) => ({
          ...x,
          tenant_id: t,
          lease_id: data.id,
        })),
      );
    if (scheduleError) {
      await this.db
        .from("lease_accounting_contracts")
        .delete()
        .eq("tenant_id", t)
        .eq("id", data.id);
      this.fail(scheduleError, "Unable to create lease schedule.");
    }
    return data;
  }
  async approve(t: string, u: string, id: string, b: any) {
    const lease = await this.lease(t, id),
      note = this.text(b.approval_note),
      keys = [
        "rou_asset_account_id",
        "lease_liability_account_id",
        "interest_expense_account_id",
        "depreciation_expense_account_id",
        "accumulated_depreciation_account_id",
      ],
      patch: any = {};
    for (const key of keys) {
      patch[key] = this.text(b[key]);
      if (!patch[key])
        this.fail(null, "All five IFRS 16 GL mappings are required.");
    }
    if (lease.status !== "DRAFT" || lease.created_by === u || !note)
      this.fail(
        null,
        "Independent approval, rationale and GL mappings are required.",
      );
    const { data: mappedAccounts, error: mappingError } = await this.db
      .from("accounting_accounts")
      .select("id,account_type")
      .eq("tenant_id", t)
      .in(
        "id",
        keys.map((key) => patch[key]),
      );
    if (mappingError || (mappedAccounts || []).length !== 5)
      this.fail(
        mappingError,
        "Every mapped account must belong to this tenant.",
      );
    const typeById = new Map(
      (mappedAccounts || []).map((account: any) => [
        account.id,
        account.account_type,
      ]),
    );
    if (
      typeById.get(patch.rou_asset_account_id) !== "ASSET" ||
      typeById.get(patch.accumulated_depreciation_account_id) !== "ASSET" ||
      typeById.get(patch.lease_liability_account_id) !== "LIABILITY" ||
      typeById.get(patch.interest_expense_account_id) !== "EXPENSE" ||
      typeById.get(patch.depreciation_expense_account_id) !== "EXPENSE"
    )
      this.fail(null, "IFRS 16 mappings must use the correct account types.");
    const { data, error } = await this.db
      .from("lease_accounting_contracts")
      .update({
        ...patch,
        status: "ACTIVE",
        approval_note: note,
        approved_by: u,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", t)
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to activate lease.");
    return data;
  }
  async event(t: string, u: string, id: string, b: any) {
    const lease = await this.lease(t, id),
      type = this.text(b.event_type).toUpperCase(),
      date = this.text(b.effective_date),
      description = this.text(b.event_description),
      evidence = this.text(b.event_evidence);
    if (
      lease.status !== "ACTIVE" ||
      !["MODIFICATION", "RENEWAL", "IMPAIRMENT", "TERMINATION"].includes(
        type,
      ) ||
      !date ||
      !description ||
      !evidence
    )
      this.fail(null, "An active lease and evidenced event are required.");
    const { data, error } = await this.db
      .from("lease_accounting_events")
      .insert({
        tenant_id: t,
        lease_id: id,
        event_type: type,
        effective_date: date,
        financial_impact: this.num(b.financial_impact),
        event_description: description,
        event_evidence: evidence,
        created_by: u,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose lease event.");
    return data;
  }
  async approveEvent(t: string, u: string, id: string, b: any) {
    const event = await this.eventRow(t, id),
      note = this.text(b.approval_note);
    if (event.status !== "PROPOSED" || event.created_by === u || !note)
      this.fail(null, "Independent event approval is required.");
    const { data, error } = await this.db
      .from("lease_accounting_events")
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
    if (error || !data) this.fail(error, "Unable to approve lease event.");
    return data;
  }
  async terminate(t: string, u: string, id: string, b: any) {
    const lease = await this.lease(t, id),
      evidence = this.text(b.termination_evidence);
    const { data: event } = await this.db
      .from("lease_accounting_events")
      .select("id")
      .eq("tenant_id", t)
      .eq("lease_id", id)
      .eq("event_type", "TERMINATION")
      .eq("status", "APPROVED")
      .limit(1)
      .maybeSingle();
    if (
      lease.status !== "ACTIVE" ||
      lease.created_by === u ||
      !event ||
      !evidence
    )
      this.fail(
        null,
        "An independently approved termination event and closure evidence are required.",
      );
    const { data, error } = await this.db
      .from("lease_accounting_contracts")
      .update({
        status: "TERMINATED",
        terminated_by: u,
        termination_evidence: evidence,
        terminated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", t)
      .eq("id", id)
      .eq("status", "ACTIVE")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to terminate lease.");
    return data;
  }
}
