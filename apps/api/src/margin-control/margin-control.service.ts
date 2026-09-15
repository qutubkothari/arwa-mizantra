import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class MarginControlService {
  private readonly supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private async rows(table: string, tenantId: string, columns = '*') { const { data, error } = await this.supabase.from(table).select(columns).eq('tenant_id', tenantId); return error ? [] : data || []; }
  async overview(tenantId: string) {
    const [alerts, jobs, invoices, tickets, actions] = await Promise.all([
      this.rows('inventory_alerts', tenantId), this.rows('job_orders', tenantId, 'id,status,job_order_number'),
      this.rows('invoices', tenantId, 'id,invoice_number,due_date,balance_amount,billing_status'),
      this.rows('service_tickets', tenantId, 'id,ticket_number,sla_due_at,status'), this.actions(tenantId),
    ]);
    const now = Date.now(); const openJobs = jobs.filter((x: any) => ['OPEN','IN_PROGRESS','RELEASED'].includes(String(x.status).toUpperCase()));
    const overdue = invoices.filter((x: any) => x.billing_status !== 'CANCELLED' && Number(x.balance_amount || 0) > 0 && x.due_date && new Date(x.due_date).getTime() < now);
    const sla = tickets.filter((x: any) => !['CLOSED','RESOLVED','CANCELLED'].includes(String(x.status).toUpperCase()) && x.sla_due_at && new Date(x.sla_due_at).getTime() < now);
    const signals = [
      { key: 'LOW_STOCK', module: 'INVENTORY', title: 'Material shortage risk', count: alerts.length, expected_value: 0, route: '/dashboard/inventory/low-stock' },
      { key: 'WIP_BLOCKER', module: 'PRODUCTION', title: 'Open production WIP', count: openJobs.length, expected_value: 0, route: '/dashboard/production/job-orders' },
      { key: 'CASH_COLLECTION', module: 'SALES', title: 'Overdue receivables', count: overdue.length, expected_value: overdue.reduce((s: number, x: any) => s + Number(x.balance_amount || 0), 0), route: '/dashboard/sales' },
      { key: 'SLA_MARGIN_RISK', module: 'SERVICE', title: 'Overdue service SLA', count: sla.length, expected_value: 0, route: '/dashboard/service' },
    ].filter(x => x.count > 0);
    return { signals, actions, expected_value: actions.reduce((s: number, x: any) => s + Number(x.expected_value || 0), 0), realised_value: actions.reduce((s: number, x: any) => s + Number(x.realised_value || 0), 0) };
  }
  async actions(tenantId: string) { const { data, error } = await this.supabase.from('margin_control_actions').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }); if (error) throw new BadRequestException(error.message); return data || []; }
  async create(tenantId: string, body: any) { if (!body.signal_key || !body.title || !body.source_module) throw new BadRequestException('Signal, title and source module are required.'); const { data, error } = await this.supabase.from('margin_control_actions').insert({ tenant_id: tenantId, signal_key: String(body.signal_key).toUpperCase(), title: String(body.title), source_module: String(body.source_module).toUpperCase(), source_reference: body.source_reference || null, owner_id: body.owner_id || null, priority: String(body.priority || 'MEDIUM').toUpperCase(), expected_value: Number(body.expected_value || 0), evidence: body.evidence || {}, note: body.note || null }).select().single(); if (error || !data) throw new BadRequestException(error?.message || 'Action could not be created.'); return data; }
  async update(tenantId: string, id: string, body: any) { const patch: any = { updated_at: new Date().toISOString() }; for (const key of ['owner_id','priority','expected_value','realised_value','evidence','note','status']) if (body[key] !== undefined) patch[key] = body[key]; if (String(body.status || '').toUpperCase() === 'RESOLVED') patch.resolved_at = new Date().toISOString(); const { data, error } = await this.supabase.from('margin_control_actions').update(patch).eq('tenant_id', tenantId).eq('id', id).select().single(); if (error || !data) throw new BadRequestException(error?.message || 'Action could not be updated.'); return data; }
}
