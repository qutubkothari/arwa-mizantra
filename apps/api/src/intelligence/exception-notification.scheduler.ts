import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ExceptionNotificationScheduler {
  private readonly logger = new Logger(ExceptionNotificationScheduler.name);
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private running = false;

  @Cron(CronExpression.EVERY_HOUR)
  async notifyOpenExceptions() {
    if (this.running) return;
    this.running = true;
    try {
      const { data: tenants, error } = await this.db.from('tenants').select('id');
      if (error) { this.logger.warn(`Exception notification scan skipped: ${error.message}`); return; }
      for (const tenant of tenants || []) await this.notifyTenant(String(tenant.id));
    } finally { this.running = false; }
  }

  private roleFor(domain: string) {
    const value = String(domain || '').toUpperCase();
    if (/FINANCE|PAY|INVOICE|GRN/.test(value)) return 'FINANCE_REVIEWER';
    if (/PURCHASE|PROCUREMENT|SUPPLIER|VENDOR/.test(value)) return 'PROCUREMENT_MANAGER';
    if (/PRODUCTION|QUALITY|MACHINE|MAINTENANCE/.test(value)) return 'OPERATIONS_MANAGER';
    if (/INVENTORY|STOCK|MATERIAL/.test(value)) return 'INVENTORY_MANAGER';
    return 'PROCESS_OWNER';
  }

  private async notifyTenant(tenantId: string) {
    const { data, error } = await this.db.from('mizantra_exception_register').select('*').eq('tenant_id', tenantId).in('status', ['OPEN', 'ACKNOWLEDGED']).order('priority_score', { ascending: false }).limit(200);
    if (error) { this.logger.warn(`Exception notification scan unavailable: ${error.message}`); return; }
    const now = Date.now(); const day = new Date().toISOString().slice(0, 10); const rows: any[] = [];
    for (const item of data || []) {
      const ageHours = Math.max(0, (now - new Date(item.first_seen_at).getTime()) / 3_600_000);
      const stage = item.priority_score >= 80 && ageHours >= 4 ? 'ESCALATION' : item.status === 'OPEN' ? 'REMINDER' : null;
      if (!stage) continue;
      const recipient = item.owner_user_id ? `USER:${item.owner_user_id}` : this.roleFor(item.source_type || item.title);
      rows.push({ tenant_id: tenantId, module: 'OPERATIONS', document_type: 'MIZANTRA_EXCEPTION', document_id: item.id, document_number: item.source_key, channel: 'IN_APP', direction: 'OUTBOUND', recipient, subject: `${stage === 'ESCALATION' ? 'Escalation' : 'Action required'}: ${item.title}`, message_preview: `${item.explanation || ''} Recommended: ${item.recommendation || 'Review the source record.'}`.slice(0, 1000), delivery_status: 'DELIVERED', dedupe_key: `MIZANTRA_EXCEPTION:${item.id}:${stage}:${day}`, metadata: { exception_id: item.id, priority_score: item.priority_score, severity: item.severity, stage, route: item.source_route, recipient_type: item.owner_user_id ? 'USER' : 'ROLE', deduplicated: true } });
    }
    if (!rows.length) return;
    const { error: insertError } = await this.db.from('communication_log').upsert(rows, { onConflict: 'tenant_id,dedupe_key', ignoreDuplicates: true });
    if (insertError) this.logger.warn(`Exception notifications not recorded: ${insertError.message}`);
  }
}
