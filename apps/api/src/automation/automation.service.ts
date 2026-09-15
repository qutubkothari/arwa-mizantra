import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { OperatingEventsService } from '../intelligence/operating-events.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

const SUPPORTED_TRIGGERS = new Set(['QUOTATION_EXPIRING', 'RECEIVABLE_OVERDUE', 'SERVICE_SLA_RISK', 'SERVICE_CONTRACT_EXPIRING', 'WARRANTY_EXPIRING', 'PREVENTIVE_MAINTENANCE_DUE', 'SERVICE_ESTIMATE_EXPIRING', 'LOW_STOCK', 'PO_OVERDUE', 'QUALITY_REJECTION_RATE', 'CUSTOMER_CREDIT_EXPOSURE', 'MANUAL']);
const SUPPORTED_MODULES = new Set(['SALES', 'SERVICE', 'PURCHASE', 'INVENTORY', 'FINANCE', 'OPERATIONS']);

@Injectable()
export class AutomationService {
  private supabase: SupabaseClient;

  constructor(config: ConfigService, private readonly events: OperatingEventsService, private readonly whatsapp: WhatsAppService) {
    this.supabase = createClient(config.get<string>('SUPABASE_URL') || process.env.SUPABASE_URL!, config.get<string>('SUPABASE_KEY') || process.env.SUPABASE_KEY!);
  }

  async listRules(tenantId: string, query: any = {}) {
    let request = this.supabase.from('automation_rules').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
    if (query.module) request = request.eq('module', String(query.module).toUpperCase());
    if (query.active === 'true' || query.active === 'false') request = request.eq('is_active', query.active === 'true');
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createRule(tenantId: string, userId: string, body: any) {
    const payload = this.normalizeRule(body);
    const { data, error } = await this.supabase.from('automation_rules').insert({ ...payload, tenant_id: tenantId, created_by: userId }).select().single();
    if (error || !data) throw new BadRequestException(error?.code === '23505' ? 'An automation rule with this code already exists.' : error?.message || 'Automation rule could not be created');
    return data;
  }

  async updateRule(tenantId: string, id: string, body: any) {
    const payload = this.normalizeRule(body, true);
    const { data, error } = await this.supabase.from('automation_rules').update({ ...payload, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Automation rule not found');
    return data;
  }

  /**
   * A configuration may be removed only before it has produced an audit trail.
   * Executed/previewed rules are retained for traceability and can instead be
   * disabled, which is the ERP-safe alternative to deleting operational history.
   */
  async deleteRule(tenantId: string, id: string) {
    const { data: rule, error: ruleError } = await this.supabase.from('automation_rules').select('id,is_active').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (ruleError) throw new BadRequestException(ruleError.message);
    if (!rule) throw new NotFoundException('Automation rule not found');
    if (rule.is_active) throw new BadRequestException('Disable the automation rule before removing it.');
    // Preserve preview/execution history while allowing the configuration to be
    // removed. The FK on automation_runs intentionally SET NULLs the rule id.
    const { error } = await this.supabase.from('automation_rules').delete().eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async runRule(tenantId: string, userId: string | null | undefined, id: string, execute: boolean) {
    const { data: rule, error } = await this.supabase.from('automation_rules').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!rule) throw new NotFoundException('Automation rule not found');
    if (execute && !rule.is_active) throw new BadRequestException('Enable the automation rule before running it. Use Preview to inspect targets safely.');
    const targets = await this.resolveTargets(tenantId, rule.trigger_type, rule.conditions || {});
    const delivery = execute
      ? await this.createGovernedActions(tenantId, userId, rule, targets)
      : { created: 0, skipped: 0, channel: this.resolveChannel(rule.action_type), note: 'Preview only: no action records were created.' };
    const result = {
      rule_code: rule.rule_code,
      trigger: rule.trigger_type,
      action: rule.action_type,
      targets,
      execution_mode: execute ? 'EXECUTE' : 'PREVIEW',
      delivery,
      safe_note: execute
        ? 'Execution created auditable governed actions. Email is queued for configured delivery only; it is never sent from a preview.'
        : 'Preview only: inspect targets before enabling and executing the rule.',
    };
    const { data: run, error: runError } = await this.supabase.from('automation_runs').insert({ tenant_id: tenantId, automation_rule_id: id, run_type: execute ? 'EXECUTE' : 'PREVIEW', status: 'SUCCESS', target_count: targets.length, result, run_by: userId || null }).select().single();
    if (runError) throw new BadRequestException(runError.message);
    await this.supabase.from('automation_rules').update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    return run;
  }

  /**
   * Runs every enabled rule in a tenant. This is used by the scheduler and by
   * the supervised "Run enabled rules" action. Individual rule failures are
   * isolated and recorded so one bad configuration never blocks the rest.
   */
  async runActiveRules(tenantId?: string, userId?: string) {
    let query = this.supabase.from('automation_rules').select('id,tenant_id,rule_code').eq('is_active', true);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data: rules, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const summary = { evaluated: 0, succeeded: 0, failed: 0, runs: [] as any[] };
    for (const rule of rules || []) {
      summary.evaluated += 1;
      try {
        // Scheduled executions have no human actor. Audit actor columns are UUIDs,
        // so a null system actor is correct and avoids invalid sentinel values.
        const run = await this.runRule(rule.tenant_id, userId || null, rule.id, true);
        summary.succeeded += 1;
        summary.runs.push({ rule_code: rule.rule_code, run_id: run.id, status: 'SUCCESS', target_count: run.target_count });
      } catch (error: any) {
        summary.failed += 1;
        summary.runs.push({ rule_code: rule.rule_code, status: 'FAILED', message: error?.message || 'Automation rule failed' });
      }
    }
    return summary;
  }

  async listRuns(tenantId: string, query: any = {}) {
    let request = this.supabase.from('automation_runs').select('*, automation_rule:automation_rules(rule_code,rule_name,module)').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(query.limit) || 50, 1), 200));
    if (query.rule_id) request = request.eq('automation_rule_id', query.rule_id);
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async listCommunications(tenantId: string, query: any = {}) {
    let request = this.supabase.from('communication_log').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(query.limit) || 100, 1), 250));
    if (query.module) request = request.eq('module', String(query.module).toUpperCase());
    if (query.document_id) request = request.eq('document_id', query.document_id);
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async markCommunicationRead(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('communication_log')
      .update({ delivery_status: 'READ' })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Communication record not found');
    return data;
  }

  async listTasks(tenantId: string, query: any = {}) {
    let request = this.supabase
      .from('automation_tasks')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Number(query.limit) || 100, 1), 250));
    if (query.status) request = request.eq('status', String(query.status).toUpperCase());
    if (query.module) request = request.eq('module', String(query.module).toUpperCase());
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async updateTask(tenantId: string, userId: string, id: string, body: any) {
    const status = String(body.status || '').trim().toUpperCase();
    if (!['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(status)) throw new BadRequestException('Invalid task status');
    const update: any = { status, updated_at: new Date().toISOString() };
    if (body.owner_user_id !== undefined) update.owner_user_id = body.owner_user_id || null;
    if (body.due_date !== undefined) update.due_date = String(body.due_date || '').trim() || null;
    const completionEvidence = String(body.completion_evidence || '').trim();
    const realizedValue = Number(body.realized_value || 0);
    if (!Number.isFinite(realizedValue) || realizedValue < 0) throw new BadRequestException('Realized value must be zero or greater');
    if (status === 'DONE' && !completionEvidence && body.require_completion_evidence === true) throw new BadRequestException('Completion evidence is required for this task');
    if (status === 'DONE' || status === 'CANCELLED') {
      update.completed_at = new Date().toISOString();
      update.completed_by = userId;
    } else {
      update.completed_at = null;
      update.completed_by = null;
    }
    const { data, error } = await this.supabase.from('automation_tasks').update(update).eq('tenant_id', tenantId).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Automation task not found');
    const source = data.metadata?.source;
    if (source === 'MIZANTRA_INTELLIGENCE' && (status === 'DONE' || status === 'CANCELLED')) {
      await this.events.record({ tenantId, eventType: status === 'DONE' ? 'CONTROLLED_FOLLOW_UP_COMPLETED' : 'CONTROLLED_FOLLOW_UP_CANCELLED', domain: data.module || 'OPERATIONS', severity: status === 'DONE' ? 'INFO' : 'LOW', correlationId: data.metadata?.insight_id || data.id, sourceType: 'automation_task', sourceId: data.id, title: status === 'DONE' ? `Completed: ${data.title}` : `Cancelled: ${data.title}`, summary: completionEvidence || null, route: data.metadata?.route || '/dashboard/automation', actorUserId: userId, payload: { task_status: status, completion_evidence: completionEvidence || null, stated_realized_value: realizedValue, value_status: realizedValue > 0 ? 'UNVERIFIED_REQUIRES_FINANCE_EVIDENCE' : 'NOT_STATED' } });
    }
    return data;
  }

  async listBranches(tenantId: string) {
    const { data, error } = await this.supabase.from('company_branches').select('*').eq('tenant_id', tenantId).order('branch_name');
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createBranch(tenantId: string, body: any) {
    const market = String(body.market_profile || 'INDIA').toUpperCase();
    if (!['INDIA', 'UAE'].includes(market)) throw new BadRequestException('Market profile must be INDIA or UAE');
    const branchCode = String(body.branch_code || '').trim().toUpperCase();
    const branchName = String(body.branch_name || '').trim();
    if (!branchCode || !branchName) throw new BadRequestException('Branch code and branch name are required');
    const payload = { tenant_id: tenantId, branch_code: branchCode, branch_name: branchName, market_profile: market, currency_code: market === 'UAE' ? 'AED' : 'INR', tax_regime: market === 'UAE' ? 'UAE_VAT' : 'GST', timezone: market === 'UAE' ? 'Asia/Dubai' : 'Asia/Kolkata', address: String(body.address || '').trim() || null, is_active: body.is_active !== false };
    const { data, error } = await this.supabase.from('company_branches').insert(payload).select().single();
    if (error || !data) throw new BadRequestException(error?.code === '23505' ? 'Branch code already exists.' : error?.message || 'Branch could not be created');
    return data;
  }

  async updateBranch(tenantId: string, id: string, body: any) {
    const existing = await this.supabase.from('company_branches').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (existing.error) throw new BadRequestException(existing.error.message);
    if (!existing.data) throw new NotFoundException('Branch not found');
    const market = String(body.market_profile || existing.data.market_profile || 'INDIA').toUpperCase();
    if (!['INDIA', 'UAE'].includes(market)) throw new BadRequestException('Market profile must be INDIA or UAE');
    const payload = {
      branch_code: body.branch_code === undefined ? existing.data.branch_code : String(body.branch_code || '').trim().toUpperCase(),
      branch_name: body.branch_name === undefined ? existing.data.branch_name : String(body.branch_name || '').trim(),
      market_profile: market,
      currency_code: String(body.currency_code || existing.data.currency_code || (market === 'UAE' ? 'AED' : 'INR')).trim().toUpperCase(),
      tax_regime: String(body.tax_regime || existing.data.tax_regime || (market === 'UAE' ? 'UAE_VAT' : 'GST')).trim(),
      timezone: String(body.timezone || existing.data.timezone || (market === 'UAE' ? 'Asia/Dubai' : 'Asia/Kolkata')).trim(),
      address: body.address === undefined ? existing.data.address : String(body.address || '').trim() || null,
      is_active: body.is_active === undefined ? existing.data.is_active : Boolean(body.is_active),
      updated_at: new Date().toISOString(),
    };
    if (!payload.branch_code || !payload.branch_name) throw new BadRequestException('Branch code and branch name are required');
    const { data, error } = await this.supabase.from('company_branches').update(payload).eq('tenant_id', tenantId).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.code === '23505' ? 'Branch code already exists.' : error.message);
    if (!data) throw new NotFoundException('Branch not found');
    return data;
  }

  private normalizeRule(body: any, partial = false) {
    const value: any = {};
    if (!partial || body.rule_code !== undefined) {
      const suppliedCode = String(body.rule_code || '').trim();
      const generatedCode = String(body.rule_name || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
      value.rule_code = (suppliedCode || generatedCode).toUpperCase().replace(/\s+/g, '_');
    }
    if (!partial || body.rule_name !== undefined) value.rule_name = String(body.rule_name || '').trim();
    if (!partial || body.module !== undefined) value.module = String(body.module || '').trim().toUpperCase();
    if (!partial || body.trigger_type !== undefined) value.trigger_type = String(body.trigger_type || '').trim().toUpperCase();
    if (!partial || body.action_type !== undefined) value.action_type = String(body.action_type || 'NOTIFY').trim().toUpperCase();
    if (body.recipients !== undefined) value.recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (body.conditions !== undefined) value.conditions = body.conditions && typeof body.conditions === 'object' ? body.conditions : {};
    ['template_subject', 'template_body'].forEach((key) => { if (body[key] !== undefined) value[key] = String(body[key] || '').trim() || null; });
    if (body.is_active !== undefined) value.is_active = Boolean(body.is_active);
    if ((!partial || value.rule_code !== undefined) && !value.rule_code) throw new BadRequestException('Rule code is required');
    if ((!partial || value.rule_name !== undefined) && !value.rule_name) throw new BadRequestException('Rule name is required');
    if (value.module && !SUPPORTED_MODULES.has(value.module)) throw new BadRequestException('Unsupported automation module');
    if (value.trigger_type && !SUPPORTED_TRIGGERS.has(value.trigger_type)) throw new BadRequestException('Unsupported automation trigger');
    return value;
  }

  private async resolveTargets(tenantId: string, trigger: string, conditions: any): Promise<any[]> {
    const days = Math.max(0, Math.min(Number(conditions.days || 7), 365));
    const today = new Date(); const cutoff = new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
    const past = new Date(today.getTime() - days * 86400000).toISOString();
    try {
      if (trigger === 'QUOTATION_EXPIRING') {
        const { data } = await this.supabase.from('quotations').select('id,quotation_number,valid_until,status,customer:customers(customer_name,email)').eq('tenant_id', tenantId).in('status', ['DRAFT', 'SENT', 'SUBMITTED', 'PENDING', 'FOLLOW_UP', 'REVISED']).gte('valid_until', today.toISOString().slice(0, 10)).lte('valid_until', cutoff).limit(200);
        return data || [];
      }
      if (trigger === 'RECEIVABLE_OVERDUE') {
        const { data } = await this.supabase.from('sales_invoices').select('id,invoice_number,due_date,balance_amount,customer:customers(customer_name,email)').eq('tenant_id', tenantId).gt('balance_amount', 0).lt('due_date', today.toISOString().slice(0, 10)).limit(200);
        return data || [];
      }
      if (trigger === 'SERVICE_SLA_RISK') {
        const { data } = await this.supabase.from('service_tickets').select('id,ticket_number,status,sla_due_at,priority,customer:customers(customer_name,email)').eq('tenant_id', tenantId).in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'SCHEDULED', 'REOPENED']).lte('sla_due_at', cutoff).limit(200);
        return data || [];
      }
      if (trigger === 'SERVICE_CONTRACT_EXPIRING') {
        const { data } = await this.supabase.from('service_contracts').select('id,contract_number,contract_type,end_date,status,customer:customers(customer_name,email)').eq('tenant_id', tenantId).eq('status', 'ACTIVE').gte('end_date', today.toISOString().slice(0, 10)).lte('end_date', cutoff).limit(200);
        return data || [];
      }
      if (trigger === 'WARRANTY_EXPIRING') {
        const { data } = await this.supabase.from('service_installed_assets').select('id,asset_number,asset_name,serial_number,warranty_until,status,customer:customers(customer_name,email)').eq('tenant_id', tenantId).eq('status', 'ACTIVE').not('warranty_until', 'is', null).gte('warranty_until', today.toISOString().slice(0, 10)).lte('warranty_until', cutoff).limit(200);
        return data || [];
      }
      if (trigger === 'PREVENTIVE_MAINTENANCE_DUE') {
        const { data } = await this.supabase.from('preventive_maintenance_schedule').select('id,schedule_name,uid,next_service_date,notify_before_days,is_active,customer:customers(customer_name,email)').eq('tenant_id', tenantId).eq('is_active', true).lte('next_service_date', cutoff).limit(200);
        return data || [];
      }
      if (trigger === 'SERVICE_ESTIMATE_EXPIRING') {
        const { data } = await this.supabase.from('service_estimates').select('id,estimate_number,valid_until,status,ticket:service_tickets(ticket_number,customer:customers(customer_name,email))').eq('tenant_id', tenantId).eq('status', 'PENDING_APPROVAL').not('valid_until', 'is', null).gte('valid_until', today.toISOString().slice(0, 10)).lte('valid_until', cutoff).limit(200);
        return data || [];
      }
      if (trigger === 'LOW_STOCK') {
        const { data } = await this.supabase.from('inventory_alerts').select('id,title,message,item_code,created_at').eq('tenant_id', tenantId).eq('acknowledged', false).limit(200);
        return data || [];
      }
      if (trigger === 'PO_OVERDUE') {
        const { data } = await this.supabase.from('purchase_orders').select('id,po_number,delivery_date,status,vendor:vendors(name,email)').eq('tenant_id', tenantId).in('status', ['APPROVED', 'PARTIAL']).lt('delivery_date', past.slice(0, 10)).limit(200);
        return data || [];
      }
      if (trigger === 'QUALITY_REJECTION_RATE') {
        const threshold = Math.max(0, Math.min(Number(conditions.threshold_pct || 3), 100));
        const { data } = await this.supabase.from('process_quality_metrics').select('id,process_name,metric_date,units_produced,units_failed,units_reworked,defect_rate,quality_related_downtime').eq('tenant_id', tenantId).gte('metric_date', past.slice(0, 10)).gt('defect_rate', threshold).order('defect_rate', { ascending: false }).limit(200);
        return data || [];
      }
      if (trigger === 'CUSTOMER_CREDIT_EXPOSURE') {
        const threshold = Math.max(0, Number(conditions.threshold_amount || 0));
        const [{ data: customers }, { data: invoices }, { data: orders }] = await Promise.all([
          this.supabase.from('customers').select('id,customer_code,customer_name,email,credit_limit').eq('tenant_id', tenantId).eq('is_active', true),
          this.supabase.from('sales_invoices').select('id,customer_id,balance_amount,billing_status').eq('tenant_id', tenantId).gt('balance_amount', 0).neq('billing_status', 'CANCELLED'),
          this.supabase.from('sales_orders').select('id,customer_id,balance_amount,status').eq('tenant_id', tenantId).in('status', ['CONFIRMED','IN_PROGRESS','PARTIAL','APPROVED']),
        ]);
        return (customers || []).map((customer: any) => {
          const exposure = (invoices || []).filter((row: any) => row.customer_id === customer.id).reduce((sum: number, row: any) => sum + Number(row.balance_amount || 0), 0) + (orders || []).filter((row: any) => row.customer_id === customer.id).reduce((sum: number, row: any) => sum + Number(row.balance_amount || 0), 0);
          return { ...customer, exposure, available_credit: Number(customer.credit_limit || 0) - exposure };
        }).filter((customer: any) => customer.exposure > Math.max(threshold, Number(customer.credit_limit || 0))).sort((a: any,b: any) => b.exposure-a.exposure).slice(0,200);
      }
    } catch { return []; }
    return [];
  }

  /**
   * Creates a durable, tenant-scoped operational action for each target. This
   * deliberately does not call an email/SMS provider: delivery must remain
   * under the tenant's configured channel, consent and approval controls.
   */
  private async createGovernedActions(tenantId: string, userId: string | null | undefined, rule: any, targets: any[]) {
    const channel = this.resolveChannel(rule.action_type);
    const rows: any[] = [];
    const tasks: any[] = [];
    let skipped = 0;
    for (const target of targets) {
      const reference = this.describeTarget(target, rule.trigger_type);
      if (!reference.documentId) { skipped += 1; continue; }
      // Use a deterministic day-scoped key. The scheduler and a manual retry
      // can safely run concurrently without creating duplicate communication
      // rows (and duplicate governed tasks) for the same target.
      const executionDay = new Date().toISOString().slice(0, 10);
      const dedupeKey = [rule.id, reference.documentType, reference.documentId, channel, executionDay].join(':');
      const { data: existing } = await this.supabase
        .from('communication_log')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('dedupe_key', dedupeKey)
        .limit(1);
      if (existing?.length) { skipped += 1; continue; }
      const recipient = this.resolveRecipient(target, rule.recipients);
      const subject = this.renderTemplate(rule.template_subject || `${rule.rule_name}: ${reference.documentNumber}`, target, reference.documentNumber);
      const message = this.renderTemplate(rule.template_body || `${reference.documentNumber} requires attention (${rule.trigger_type.replace(/_/g, ' ').toLowerCase()}).`, target, reference.documentNumber);
      if (channel === 'WHATSAPP' && !/^\d{10,15}$/.test(String(recipient || '').replace(/\D/g, ''))) { skipped += 1; continue; }
      let deliveryStatus = channel === 'IN_APP' ? 'DELIVERED' : 'QUEUED';
      if (channel === 'WHATSAPP') {
        try { await this.whatsapp.sendAutomated(tenantId, recipient, message, { automation_rule_id: rule.id, document_id: reference.documentId }); deliveryStatus = 'SENT'; }
        catch { deliveryStatus = 'FAILED'; }
      }
      rows.push({
        tenant_id: tenantId,
        module: rule.module,
        document_type: reference.documentType,
        document_id: reference.documentId,
        document_number: reference.documentNumber,
        channel,
        direction: 'OUTBOUND',
        recipient,
        subject,
        message_preview: message.slice(0, 1000),
        delivery_status: deliveryStatus,
        dedupe_key: dedupeKey,
        metadata: { automation_rule_id: rule.id, automation_rule_code: rule.rule_code, trigger: rule.trigger_type, action: rule.action_type, target },
        created_by: userId || null,
      });
      const action = String(rule.action_type || 'NOTIFY').toUpperCase();
      if (action === 'CREATE_TASK' || action === 'ESCALATE') {
        tasks.push({
          tenant_id: tenantId,
          automation_rule_id: rule.id,
          module: rule.module,
          document_type: reference.documentType,
          document_id: reference.documentId,
          document_number: reference.documentNumber,
          title: subject,
          description: message,
          priority: action === 'ESCALATE' || rule.trigger_type === 'SERVICE_SLA_RISK' ? 'HIGH' : 'NORMAL',
          due_date: new Date().toISOString().slice(0, 10),
          metadata: { automation_rule_id: rule.id, automation_rule_code: rule.rule_code, trigger: rule.trigger_type, action: rule.action_type },
        });
      }
    }
    if (rows.length) {
      const { error } = await this.supabase
        .from('communication_log')
        .upsert(rows, { onConflict: 'tenant_id,dedupe_key', ignoreDuplicates: true });
      if (error) throw new BadRequestException(`Automation actions could not be recorded: ${error.message}`);
    }
    let tasksCreated = 0;
    for (const task of tasks) {
      const { error } = await this.supabase.from('automation_tasks').insert(task);
      if (error && error.code !== '23505') throw new BadRequestException(`Automation tasks could not be recorded: ${error.message}`);
      if (!error) tasksCreated += 1;
    }
    return {
      created: rows.length,
      tasksCreated,
      skipped,
      channel,
      note: channel === 'WHATSAPP'
        ? 'WhatsApp delivery was attempted only for valid configured recipients while tenant automation is enabled. Each attempt remains in both the communication register and WhatsApp ledger.'
        : channel === 'EMAIL'
        ? 'Email actions are queued in the communication register for the configured delivery service; no unconfigured outbound email was sent.'
        : 'In-app actions were recorded in the communication register.',
    };
  }

  private resolveChannel(actionType: string) {
    const action = String(actionType || '').toUpperCase();
    return action === 'EMAIL' ? 'EMAIL' : action === 'WHATSAPP' ? 'WHATSAPP' : 'IN_APP';
  }

  private describeTarget(target: any, trigger: string) {
    const numbers: Record<string, string> = {
      QUOTATION_EXPIRING: 'quotation_number',
      RECEIVABLE_OVERDUE: 'invoice_number',
      SERVICE_SLA_RISK: 'ticket_number',
      SERVICE_CONTRACT_EXPIRING: 'contract_number',
      WARRANTY_EXPIRING: 'asset_number',
      PREVENTIVE_MAINTENANCE_DUE: 'schedule_name',
      SERVICE_ESTIMATE_EXPIRING: 'estimate_number',
      LOW_STOCK: 'item_code',
      PO_OVERDUE: 'po_number',
    };
    const documentTypes: Record<string, string> = {
      QUOTATION_EXPIRING: 'QUOTATION',
      RECEIVABLE_OVERDUE: 'SALES_INVOICE',
      SERVICE_SLA_RISK: 'SERVICE_TICKET',
      SERVICE_CONTRACT_EXPIRING: 'SERVICE_CONTRACT',
      WARRANTY_EXPIRING: 'INSTALLED_ASSET',
      PREVENTIVE_MAINTENANCE_DUE: 'PREVENTIVE_MAINTENANCE',
      SERVICE_ESTIMATE_EXPIRING: 'SERVICE_ESTIMATE',
      LOW_STOCK: 'INVENTORY_ALERT',
      PO_OVERDUE: 'PURCHASE_ORDER',
    };
    const number = target?.[numbers[trigger]] || target?.id || 'ERP record';
    return { documentId: target?.id ? String(target.id) : null, documentNumber: String(number), documentType: documentTypes[trigger] || 'ERP_RECORD' };
  }

  private resolveRecipient(target: any, configuredRecipients: any) {
    const recipients = Array.isArray(configuredRecipients) ? configuredRecipients.filter(Boolean) : [];
    if (recipients.length) return String(recipients[0]);
    return target?.customer?.email || target?.ticket?.customer?.email || target?.vendor?.email || null;
  }

  private renderTemplate(template: string, target: any, documentNumber: string) {
    return String(template || '')
      .replace(/{{\s*document_number\s*}}/gi, documentNumber)
      .replace(/{{\s*customer_name\s*}}/gi, target?.customer?.customer_name || '')
      .replace(/{{\s*vendor_name\s*}}/gi, target?.vendor?.vendor_name || '');
  }
}
