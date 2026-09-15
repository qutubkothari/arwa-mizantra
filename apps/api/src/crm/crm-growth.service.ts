import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { EmailService } from "../email/email.service";

@Injectable()
export class CrmGrowthService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  constructor(private readonly email: EmailService) {}

  private text(value: any) { return String(value ?? "").trim(); }
  private number(value: any) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
  private fail(error: any, fallback: string): never { throw new BadRequestException(error?.message || fallback); }
  private month(value?: string) {
    const raw = this.text(value) || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(raw)) throw new BadRequestException("Month must use YYYY-MM format.");
    return `${raw}-01`;
  }
  private monthWindow(targetMonth: string) {
    const start = new Date(`${targetMonth}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start: start.toISOString(), end: end.toISOString(), startDate: targetMonth, endDate: end.toISOString().slice(0, 10) };
  }
  private addMetric(map: Map<string, any>, ownerId: any, key: string, amount = 1) {
    const owner = this.text(ownerId);
    if (!owner) return;
    const row = map.get(owner) || { revenue: 0, wins: 0, new_leads: 0, calls: 0, visits: 0, quotations: 0, collections: 0, open_pipeline: 0, weighted_pipeline: 0 };
    row[key] = this.number(row[key]) + this.number(amount);
    map.set(owner, row);
  }
  private escape(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  }
  private async nextCode(tenantId: string, table: string, column: string, prefix: string) {
    const marker = `${prefix}-${new Date().getFullYear()}-`;
    const { data, error } = await this.db.from(table).select(column).eq("tenant_id", tenantId).like(column, `${marker}%`).order(column, { ascending: false }).limit(1);
    if (error) this.fail(error, `Unable to generate ${prefix} code.`);
    const latest = this.text(data?.[0]?.[column]);
    const sequence = Number.parseInt(latest.replace(marker, ""), 10);
    return `${marker}${String((Number.isFinite(sequence) ? sequence : 0) + 1).padStart(5, "0")}`;
  }

  async workspace(tenantId: string, month?: string) {
    const targetMonth = this.month(month);
    const period = this.monthWindow(targetMonth);
    const [territories, targets, campaigns, cadences, templates, workflows, opportunities, communications, inbound, items, leads, activities, quotations, receipts, invoiceItems] = await Promise.all([
      this.db.from("crm_territories").select("*").eq("tenant_id", tenantId).order("territory_name"),
      this.db.from("crm_sales_targets").select("*,territory:crm_territories(id,territory_code,territory_name,member_user_ids),product_targets:crm_sales_target_products(*,item:items(id,code,name,uom))").eq("tenant_id", tenantId).eq("target_month", targetMonth),
      this.db.from("crm_campaigns").select("*,members:crm_campaign_members(count)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(250),
      this.db.from("crm_cadences").select("*,steps:crm_cadence_steps(*),enrollments:crm_cadence_enrollments(count)").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      this.db.from("crm_message_templates").select("*").eq("tenant_id", tenantId).order("template_name"),
      this.db.from("crm_workflow_rules").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      this.db.from("crm_opportunities").select("*,stage:crm_opportunity_stages(stage_code,stage_name,is_closed,is_won),account:crm_accounts(account_name)").eq("tenant_id", tenantId).limit(2000),
      this.db.from("communication_log").select("*").eq("tenant_id", tenantId).eq("module", "CRM").order("created_at", { ascending: false }).limit(250),
      this.db.from("crm_intake_messages").select("id,channel,sender_address,subject,body_preview,classification,decision,received_at,lead_id").eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(250),
      this.db.from("items").select("id,code,name,uom").eq("tenant_id", tenantId).eq("is_active", true).order("name").limit(2000),
      this.db.from("crm_leads").select("id,owner_user_id,created_at").eq("tenant_id", tenantId).gte("created_at", period.start).lt("created_at", period.end).limit(10000),
      this.db.from("crm_activities").select("id,owner_user_id,activity_type,status,completed_at").eq("tenant_id", tenantId).eq("status", "COMPLETED").gte("completed_at", period.start).lt("completed_at", period.end).limit(10000),
      this.db.from("quotations").select("id,created_by,quotation_date").eq("tenant_id", tenantId).gte("quotation_date", period.startDate).lt("quotation_date", period.endDate).limit(10000),
      this.db.from("sales_invoice_payments").select("id,amount,receipt_date,reversed_at,invoice:invoices(sales_order:sales_orders(created_by))").eq("tenant_id", tenantId).is("reversed_at", null).gte("receipt_date", period.startDate).lt("receipt_date", period.endDate).limit(10000),
      this.db.from("sales_invoice_items").select("item_id,quantity,line_total,invoice:invoices!inner(tenant_id,invoice_date,billing_status,sales_order:sales_orders(created_by))").eq("invoice.tenant_id", tenantId).neq("invoice.billing_status", "CANCELLED").gte("invoice.invoice_date", period.startDate).lt("invoice.invoice_date", period.endDate).limit(20000),
    ]);
    for (const result of [territories, targets, campaigns, cadences, templates, workflows, opportunities, communications, inbound, items, leads, activities, quotations, receipts, invoiceItems])
      if (result.error) this.fail(result.error, "Unable to load the CRM revenue operations workspace.");
    const deals: any[] = opportunities.data || [];
    const won = deals.filter((row) => row.status === "WON" && String(row.closed_at || "").slice(0, 7) === targetMonth.slice(0, 7));
    const open = deals.filter((row) => ["OPEN", "ON_HOLD"].includes(row.status));
    const targetTotal = (targets.data || []).reduce((sum: number, row: any) => sum + this.number(row.target_amount), 0);
    const wonTotal = won.reduce((sum, row) => sum + this.number(row.amount), 0);
    const now = Date.now();
    const actualByOwner = new Map<string, any>();
    for (const row of deals) {
      if (row.status === "WON" && String(row.closed_at || "").slice(0, 7) === targetMonth.slice(0, 7)) {
        this.addMetric(actualByOwner, row.owner_user_id, "revenue", row.amount);
        this.addMetric(actualByOwner, row.owner_user_id, "wins");
      }
      if (["OPEN", "ON_HOLD"].includes(row.status)) {
        this.addMetric(actualByOwner, row.owner_user_id, "open_pipeline", row.amount);
        this.addMetric(actualByOwner, row.owner_user_id, "weighted_pipeline", this.number(row.amount) * this.number(row.probability) / 100);
      }
    }
    for (const row of leads.data || []) this.addMetric(actualByOwner, row.owner_user_id, "new_leads");
    for (const row of activities.data || []) {
      if (row.activity_type === "CALL") this.addMetric(actualByOwner, row.owner_user_id, "calls");
      if (["SITE_VISIT", "MEETING"].includes(row.activity_type)) this.addMetric(actualByOwner, row.owner_user_id, "visits");
    }
    for (const row of quotations.data || []) this.addMetric(actualByOwner, row.created_by, "quotations");
    for (const row of receipts.data || []) this.addMetric(actualByOwner, row.invoice?.sales_order?.created_by, "collections", row.amount);
    const productActuals = new Map<string, { quantity: number; value: number }>();
    for (const row of invoiceItems.data || []) {
      const owner = this.text(row.invoice?.sales_order?.created_by), item = this.text(row.item_id);
      if (!owner || !item) continue;
      const key = `${owner}:${item}`, current = productActuals.get(key) || { quantity: 0, value: 0 };
      current.quantity += this.number(row.quantity); current.value += this.number(row.line_total); productActuals.set(key, current);
    }
    const scorecards = (targets.data || []).map((target: any) => {
      const ownerIds: string[] = target.user_id ? [target.user_id] : (Array.isArray(target.territory?.member_user_ids) ? target.territory.member_user_ids : []);
      const actual = ownerIds.reduce((total: any, ownerId: string) => {
        const source = actualByOwner.get(ownerId) || {};
        for (const key of ["revenue", "wins", "new_leads", "calls", "visits", "quotations", "collections", "open_pipeline", "weighted_pipeline"]) total[key] = this.number(total[key]) + this.number(source[key]);
        return total;
      }, {});
      const metrics = [
        ["revenue", target.target_amount], ["wins", target.target_wins], ["new_leads", target.target_new_leads],
        ["calls", target.target_calls], ["visits", target.target_visits], ["quotations", target.target_quotations], ["collections", target.target_collections],
      ];
      const active = metrics.filter(([, targetValue]) => this.number(targetValue) > 0);
      const overall = active.length ? active.reduce((sum, [key, targetValue]) => sum + Math.min(100, this.number(actual[key]) / this.number(targetValue) * 100), 0) / active.length : 0;
      return { ...target, actual, overall_attainment: Math.round(overall * 10) / 10, product_targets: (target.product_targets || []).map((product: any) => ({ ...product, actual: ownerIds.reduce((total, ownerId) => { const source = productActuals.get(`${ownerId}:${product.item_id}`) || { quantity: 0, value: 0 }; return { quantity: total.quantity + source.quantity, value: total.value + source.value }; }, { quantity: 0, value: 0 }) })) };
    });
    return {
      month: targetMonth.slice(0, 7), territories: territories.data || [], targets: targets.data || [], scorecards, items: items.data || [],
      campaigns: campaigns.data || [], cadences: (cadences.data || []).map((row: any) => ({ ...row, steps: [...(row.steps || [])].sort((a, b) => a.step_order - b.step_order) })),
      templates: templates.data || [], workflows: workflows.data || [], opportunities: deals,
      communications: [
        ...(communications.data || []),
        ...(inbound.data || []).map((row: any) => ({
          ...row,
          direction: "INBOUND",
          recipient: row.sender_address,
          message_preview: row.body_preview,
          delivery_status: row.decision,
          created_at: row.received_at,
          module: "CRM",
        })),
      ].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 300),
      analytics: {
        target: targetTotal, won: wonTotal, attainment: targetTotal ? Math.round(wonTotal / targetTotal * 1000) / 10 : 0,
        open_pipeline: open.reduce((sum, row) => sum + this.number(row.amount), 0),
        weighted_pipeline: open.reduce((sum, row) => sum + this.number(row.amount) * this.number(row.probability) / 100, 0),
        open_deals: open.length, won_deals: won.length,
        stale_deals: open.filter((row) => now - new Date(row.last_activity_at || row.updated_at).getTime() > 14 * 86400000).length,
        overdue_next_actions: open.filter((row) => row.next_activity_at && new Date(row.next_activity_at).getTime() < now).length,
      },
    };
  }

  async createTerritory(tenantId: string, userId: string, body: any) {
    const name = this.text(body.territory_name); if (!name) throw new BadRequestException("Territory name is required.");
    const code = this.text(body.territory_code).toUpperCase() || await this.nextCode(tenantId, "crm_territories", "territory_code", "TER");
    const { data, error } = await this.db.from("crm_territories").insert({ tenant_id: tenantId, territory_code: code, territory_name: name, manager_user_id: body.manager_user_id || null, member_user_ids: Array.isArray(body.member_user_ids) ? body.member_user_ids : [], country_filter: this.text(body.country_filter) || null, state_filter: this.text(body.state_filter) || null, city_filter: this.text(body.city_filter) || null, industry_filter: this.text(body.industry_filter) || null, created_by: userId }).select("*").single();
    if (error) this.fail(error, "Unable to create the CRM territory."); return data;
  }

  async upsertTarget(tenantId: string, userId: string, body: any) {
    const targetMonth = this.month(body.month || body.target_month);
    if (!body.user_id && !body.territory_id) throw new BadRequestException("Select a salesperson or territory.");
    if (body.user_id && body.territory_id) throw new BadRequestException("A target must belong to either one salesperson or one territory.");
    const payload = { tenant_id: tenantId, target_month: targetMonth, user_id: body.user_id || null, territory_id: body.territory_id || null, currency_code: this.text(body.currency_code).toUpperCase() || "INR", target_amount: Math.max(0, this.number(body.target_amount)), target_wins: Math.max(0, Math.floor(this.number(body.target_wins))), target_new_leads: Math.max(0, Math.floor(this.number(body.target_new_leads))), target_calls: Math.max(0, Math.floor(this.number(body.target_calls))), target_visits: Math.max(0, Math.floor(this.number(body.target_visits))), target_quotations: Math.max(0, Math.floor(this.number(body.target_quotations))), target_collections: Math.max(0, this.number(body.target_collections)), created_by: userId, updated_at: new Date().toISOString() };
    let query = this.db.from("crm_sales_targets").select("id").eq("tenant_id", tenantId).eq("target_month", targetMonth);
    query = body.user_id ? query.eq("user_id", body.user_id).is("territory_id", null) : query.eq("territory_id", body.territory_id).is("user_id", null);
    const existing = await query.maybeSingle();
    const result = existing.data ? await this.db.from("crm_sales_targets").update(payload).eq("id", existing.data.id).select("*").single() : await this.db.from("crm_sales_targets").insert(payload).select("*").single();
    if (result.error) this.fail(result.error, "Unable to save the CRM target.");
    if (Array.isArray(body.product_targets)) {
      const cleaned = body.product_targets.map((row: any) => ({ item_id: this.text(row.item_id), target_quantity: Math.max(0, this.number(row.target_quantity)), target_value: Math.max(0, this.number(row.target_value)), uom: this.text(row.uom) || null })).filter((row: any) => row.item_id && (row.target_quantity > 0 || row.target_value > 0));
      const itemIds = [...new Set(cleaned.map((row: any) => row.item_id))];
      if (itemIds.length) {
        const valid = await this.db.from("items").select("id").eq("tenant_id", tenantId).in("id", itemIds);
        if (valid.error || (valid.data || []).length !== itemIds.length) throw new BadRequestException("One or more product targets are invalid for this client.");
      }
      const removed = await this.db.from("crm_sales_target_products").delete().eq("tenant_id", tenantId).eq("target_id", result.data.id);
      if (removed.error) this.fail(removed.error, "Unable to replace the product targets.");
      if (cleaned.length) {
        const inserted = await this.db.from("crm_sales_target_products").insert(cleaned.map((row: any) => ({ ...row, tenant_id: tenantId, target_id: result.data.id, created_by: userId })));
        if (inserted.error) this.fail(inserted.error, "Unable to save the product targets.");
      }
    }
    return result.data;
  }

  async createCampaign(tenantId: string, userId: string, body: any) {
    const name = this.text(body.campaign_name); if (!name) throw new BadRequestException("Campaign name is required.");
    const code = this.text(body.campaign_code).toUpperCase() || await this.nextCode(tenantId, "crm_campaigns", "campaign_code", "CMP");
    const { data, error } = await this.db.from("crm_campaigns").insert({ tenant_id: tenantId, campaign_code: code, campaign_name: name, campaign_type: this.text(body.campaign_type).toUpperCase() || "OTHER", owner_user_id: body.owner_user_id || userId, status: this.text(body.status).toUpperCase() || "PLANNED", start_date: body.start_date || null, end_date: body.end_date || null, budget: Math.max(0, this.number(body.budget)), expected_revenue: Math.max(0, this.number(body.expected_revenue)), currency_code: this.text(body.currency_code).toUpperCase() || "INR", description: this.text(body.description) || null, created_by: userId }).select("*").single();
    if (error) this.fail(error, "Unable to create the CRM campaign."); return data;
  }

  async addCampaignMembers(tenantId: string, campaignId: string, body: any) {
    const leadIds = Array.isArray(body.lead_ids) ? [...new Set(body.lead_ids.map((id: any) => this.text(id)).filter(Boolean))] : [];
    if (!leadIds.length) throw new BadRequestException("Select at least one lead for the campaign.");
    const campaign = await this.db.from("crm_campaigns").select("id").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle();
    if (!campaign.data) throw new NotFoundException("CRM campaign not found.");
    const leads = await this.db.from("crm_leads").select("id").eq("tenant_id", tenantId).in("id", leadIds);
    if (leads.error) this.fail(leads.error, "Unable to verify the selected campaign leads.");
    const validIds = (leads.data || []).map((row: any) => row.id);
    if (!validIds.length) throw new BadRequestException("No valid leads were selected.");
    const result = await this.db.from("crm_campaign_members").upsert(
      validIds.map((leadId: string) => ({ tenant_id: tenantId, campaign_id: campaignId, lead_id: leadId, member_status: "SELECTED", updated_at: new Date().toISOString() })),
      { onConflict: "campaign_id,lead_id", ignoreDuplicates: true },
    ).select("*");
    if (result.error) this.fail(result.error, "Unable to add the campaign members.");
    return { added: result.data?.length || 0, selected: validIds.length };
  }

  async createTemplate(tenantId: string, userId: string, body: any) {
    const name = this.text(body.template_name), content = this.text(body.body), channel = this.text(body.channel).toUpperCase();
    if (!name || !content || !["EMAIL", "WHATSAPP"].includes(channel)) throw new BadRequestException("Template name, channel and body are required.");
    const { data, error } = await this.db.from("crm_message_templates").insert({ tenant_id: tenantId, template_name: name, channel, subject: this.text(body.subject) || null, body: content, category: this.text(body.category) || null, approved_external_use: false, created_by: userId }).select("*").single();
    if (error) this.fail(error, "Unable to create the CRM template."); return data;
  }

  async approveTemplate(tenantId: string, id: string, userId: string, approved: boolean) {
    const { data, error } = await this.db.from("crm_message_templates").update({ approved_external_use: approved, approved_by: approved ? userId : null, approved_at: approved ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).select("*").maybeSingle();
    if (error || !data) throw new NotFoundException(error?.message || "CRM template not found."); return data;
  }

  async createCadence(tenantId: string, userId: string, body: any) {
    const name = this.text(body.cadence_name), steps = Array.isArray(body.steps) ? body.steps : [];
    if (!name || !steps.length) throw new BadRequestException("Cadence name and at least one step are required.");
    const { data: cadence, error } = await this.db.from("crm_cadences").insert({ tenant_id: tenantId, cadence_name: name, description: this.text(body.description) || null, owner_user_id: body.owner_user_id || userId, is_active: body.is_active === true, created_by: userId }).select("*").single();
    if (error) this.fail(error, "Unable to create the CRM cadence.");
    const rows = steps.map((step: any, index: number) => ({ tenant_id: tenantId, cadence_id: cadence.id, step_order: index + 1, wait_days: Math.max(0, Math.floor(this.number(step.wait_days))), action_type: this.text(step.action_type).toUpperCase(), template_id: step.template_id || null, instructions: this.text(step.instructions) || null, automatic_execution: false }));
    const inserted = await this.db.from("crm_cadence_steps").insert(rows);
    if (inserted.error) { await this.db.from("crm_cadences").delete().eq("id", cadence.id); this.fail(inserted.error, "Unable to save the cadence steps."); }
    return cadence;
  }

  async enrollLead(tenantId: string, cadenceId: string, userId: string, body: any) {
    const leadId = this.text(body.lead_id); if (!leadId) throw new BadRequestException("Select a lead for this cadence.");
    const [cadence, lead, first] = await Promise.all([
      this.db.from("crm_cadences").select("*").eq("tenant_id", tenantId).eq("id", cadenceId).eq("is_active", true).maybeSingle(),
      this.db.from("crm_leads").select("id,owner_user_id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle(),
      this.db.from("crm_cadence_steps").select("*").eq("tenant_id", tenantId).eq("cadence_id", cadenceId).order("step_order").limit(1).maybeSingle(),
    ]);
    if (!cadence.data || !lead.data || !first.data) throw new BadRequestException("Active cadence, lead and first step are required.");
    const next = new Date(Date.now() + this.number(first.data.wait_days) * 86400000).toISOString();
    const { data, error } = await this.db.from("crm_cadence_enrollments").insert({ tenant_id: tenantId, cadence_id: cadenceId, lead_id: leadId, owner_user_id: lead.data.owner_user_id || userId, current_step: 0, next_action_at: next, stop_on_reply: body.stop_on_reply !== false, enrolled_by: userId }).select("*").single();
    if (error) this.fail(error, "Unable to enroll the lead in this cadence."); return data;
  }

  async processDueCadences() {
    const due = await this.db.from("crm_cadence_enrollments")
      .select("*,lead:crm_leads(id,company_name,customer_id,owner_user_id)")
      .eq("status", "ACTIVE").lte("next_action_at", new Date().toISOString()).limit(250);
    if (due.error) this.fail(due.error, "Unable to scan due CRM cadences.");
    let created = 0, stopped = 0, completed = 0;
    for (const enrollment of due.data || []) {
      if (enrollment.stop_on_reply) {
        const reply = await this.db.from("crm_intake_messages").select("id")
          .eq("tenant_id", enrollment.tenant_id).eq("lead_id", enrollment.lead_id)
          .gt("received_at", enrollment.enrolled_at).limit(1).maybeSingle();
        if (reply.data) {
          await this.db.from("crm_cadence_enrollments").update({ status: "STOPPED", next_action_at: null, updated_at: new Date().toISOString() }).eq("id", enrollment.id).eq("status", "ACTIVE");
          stopped += 1;
          continue;
        }
      }
      const steps = await this.db.from("crm_cadence_steps").select("*")
        .eq("tenant_id", enrollment.tenant_id).eq("cadence_id", enrollment.cadence_id).order("step_order");
      if (steps.error || !steps.data?.length) continue;
      const step = steps.data[enrollment.current_step];
      if (!step) {
        await this.db.from("crm_cadence_enrollments").update({ status: "COMPLETED", next_action_at: null, updated_at: new Date().toISOString() }).eq("id", enrollment.id).eq("status", "ACTIVE");
        completed += 1;
        continue;
      }
      const nextStep = steps.data[enrollment.current_step + 1];
      const nextActionAt = nextStep ? new Date(Date.now() + this.number(nextStep.wait_days) * 86400000).toISOString() : null;
      const claim = await this.db.from("crm_cadence_enrollments").update({
        current_step: enrollment.current_step + 1,
        status: nextStep ? "ACTIVE" : "COMPLETED",
        next_action_at: nextActionAt,
        updated_at: new Date().toISOString(),
      }).eq("id", enrollment.id).eq("status", "ACTIVE").eq("current_step", enrollment.current_step).select("id").maybeSingle();
      if (!claim.data) continue;
      const action = step.action_type === "EMAIL" || step.action_type === "WHATSAPP" ? step.action_type : step.action_type || "TASK";
      const subject = `${action === "TASK" ? "Follow up" : action}: ${enrollment.lead?.company_name || "CRM lead"}`;
      const activity = await this.db.from("crm_activities").insert({
        tenant_id: enrollment.tenant_id,
        lead_id: enrollment.lead_id,
        customer_id: enrollment.lead?.customer_id || null,
        activity_type: action,
        direction: action === "EMAIL" || action === "WHATSAPP" ? "OUTBOUND" : "INTERNAL",
        subject,
        notes: `${step.instructions || "Complete this cadence step."}${action === "EMAIL" || action === "WHATSAPP" ? " External delivery requires explicit user confirmation and an approved template." : ""}`,
        status: "OPEN",
        scheduled_at: new Date().toISOString(),
        owner_user_id: enrollment.owner_user_id || enrollment.lead?.owner_user_id || null,
        created_by: enrollment.enrolled_by || null,
      });
      if (!activity.error) created += 1;
    }
    return { scanned: due.data?.length || 0, created, stopped, completed };
  }

  async createWorkflow(tenantId: string, userId: string, body: any) {
    const name = this.text(body.rule_name); if (!name) throw new BadRequestException("Workflow rule name is required.");
    const { data, error } = await this.db.from("crm_workflow_rules").insert({ tenant_id: tenantId, rule_name: name, entity_type: this.text(body.entity_type).toUpperCase() || "LEAD", trigger_event: this.text(body.trigger_event).toUpperCase(), conditions: body.conditions && typeof body.conditions === "object" ? body.conditions : {}, actions: Array.isArray(body.actions) ? body.actions : [], approval_status: "DRAFT", is_active: false, created_by: userId }).select("*").single();
    if (error) this.fail(error, "Unable to create the CRM workflow."); return data;
  }

  async approveWorkflow(tenantId: string, id: string, userId: string, approved: boolean) {
    const { data, error } = await this.db.from("crm_workflow_rules").update({ approval_status: approved ? "APPROVED" : "REJECTED", is_active: approved, approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).select("*").maybeSingle();
    if (error || !data) throw new NotFoundException(error?.message || "CRM workflow rule not found."); return data;
  }

  async sendEmail(tenantId: string, userId: string, body: any) {
    if (body.confirm !== "SEND") throw new BadRequestException("Set confirm to SEND for an intentional external email.");
    let recipient = this.text(body.to).toLowerCase();
    if (body.contact_id) {
      const contact = await this.db.from("crm_contacts").select("*").eq("tenant_id", tenantId).eq("id", body.contact_id).maybeSingle();
      if (!contact.data) throw new NotFoundException("CRM contact not found.");
      if (contact.data.email_consent === "OPTED_OUT") throw new BadRequestException("This contact has opted out of email communication.");
      recipient = recipient || this.text(contact.data.email).toLowerCase();
    }
    let subject = this.text(body.subject), content = this.text(body.body);
    if (body.template_id) {
      const template = await this.db.from("crm_message_templates").select("*").eq("tenant_id", tenantId).eq("id", body.template_id).eq("channel", "EMAIL").maybeSingle();
      if (!template.data?.approved_external_use) throw new BadRequestException("Select an approved email template.");
      subject = subject || this.text(template.data.subject); content = content || this.text(template.data.body);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !subject || !content) throw new BadRequestException("A valid recipient, subject and message are required.");
    const seed: any = { tenant_id: tenantId, module: "CRM", document_type: "CRM_MESSAGE", channel: "EMAIL", direction: "OUTBOUND", recipient, subject, message_preview: content.slice(0, 1000), delivery_status: "QUEUED", crm_lead_id: body.lead_id || null, crm_account_id: body.account_id || null, crm_contact_id: body.contact_id || null, crm_opportunity_id: body.opportunity_id || null, created_by: userId, metadata: { governed: true, template_id: body.template_id || null } };
    const ledger = await this.db.from("communication_log").insert(seed).select("*").single();
    if (ledger.error) this.fail(ledger.error, "Unable to create the CRM communication ledger entry.");
    try {
      const result: any = await this.email.sendEmail({ to: recipient, subject, html: `<div style="white-space:pre-wrap">${this.escape(content)}</div>`, from: "sales", tenantId });
      await this.db.from("communication_log").update({ delivery_status: "SENT", provider_reference: this.text(result?.messageId) || null }).eq("id", ledger.data.id);
      return { sent: true, communication_id: ledger.data.id };
    } catch (error: any) {
      await this.db.from("communication_log").update({ delivery_status: "FAILED", metadata: { ...seed.metadata, error: this.text(error?.message).slice(0, 500) } }).eq("id", ledger.data.id);
      throw new BadRequestException(error?.message || "CRM email delivery failed.");
    }
  }

  async account360(tenantId: string, id: string) {
    const account = await this.db.from("crm_accounts").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (account.error || !account.data) throw new NotFoundException(account.error?.message || "CRM account not found.");
    const customerId = account.data.customer_id;
    const [contacts, opportunities, communications, quotations, orders, invoices, tickets, assets] = await Promise.all([
      this.db.from("crm_contacts").select("*").eq("tenant_id", tenantId).eq("account_id", id),
      this.db.from("crm_opportunities").select("*,stage:crm_opportunity_stages(stage_name,stage_code)").eq("tenant_id", tenantId).eq("account_id", id),
      this.db.from("communication_log").select("*").eq("tenant_id", tenantId).eq("crm_account_id", id).order("created_at", { ascending: false }).limit(250),
      customerId ? this.db.from("quotations").select("id,quotation_number,status,net_amount,currency_code").eq("tenant_id", tenantId).eq("customer_id", customerId) : Promise.resolve({ data: [] }),
      customerId ? this.db.from("sales_orders").select("id,so_number,status,total_amount,currency_code").eq("tenant_id", tenantId).eq("customer_id", customerId) : Promise.resolve({ data: [] }),
      customerId ? this.db.from("invoices").select("id,invoice_number,payment_status,net_amount,balance_amount").eq("tenant_id", tenantId).eq("customer_id", customerId) : Promise.resolve({ data: [] }),
      customerId ? this.db.from("service_tickets").select("id,ticket_number,status,priority").eq("tenant_id", tenantId).eq("customer_id", customerId) : Promise.resolve({ data: [] }),
      customerId ? this.db.from("service_installed_assets").select("id,asset_number,asset_name,status,warranty_until").eq("tenant_id", tenantId).eq("customer_id", customerId) : Promise.resolve({ data: [] }),
    ] as any[]);
    return { account: account.data, contacts: contacts.data || [], opportunities: opportunities.data || [], communications: communications.data || [], erp: { quotations: quotations.data || [], orders: orders.data || [], invoices: invoices.data || [], tickets: tickets.data || [], installed_assets: assets.data || [] } };
  }
}
