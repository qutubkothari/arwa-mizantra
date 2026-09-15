import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type OperatingEventInput = {
  tenantId: string;
  eventType: string;
  domain?: string;
  severity?: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  correlationId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  title: string;
  summary?: string | null;
  route?: string | null;
  actorUserId?: string | null;
  payload?: Record<string, any>;
};

/**
 * The event ledger is evidence only. Source modules remain authoritative for
 * records and controls; this service makes their decisions traceable together.
 */
@Injectable()
export class OperatingEventsService {
  private readonly logger = new Logger(OperatingEventsService.name);
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

  async record(input: OperatingEventInput) {
    const { data, error } = await this.db.from('mizantra_operating_events').insert({
      tenant_id: input.tenantId,
      event_type: input.eventType,
      domain: input.domain || 'OPERATIONS',
      severity: input.severity || 'INFO',
      correlation_id: input.correlationId || null,
      source_type: input.sourceType || null,
      source_id: input.sourceId || null,
      title: input.title,
      summary: input.summary || null,
      route: input.route || null,
      actor_user_id: input.actorUserId || null,
      payload: input.payload || {},
    }).select().single();
    if (error) {
      // Event capture must never block the native ERP workflow. The audit trail
      // remains the fallback evidence if a tenant has not applied the migration.
      this.logger.warn(`Operating event not recorded: ${error.message}`);
      return null;
    }
    return data;
  }

  async recent(tenantId: string, limit = 25, correlationId?: string) {
    let query = this.db.from('mizantra_operating_events').select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 25, 1), 100));
    if (correlationId) query = query.eq('correlation_id', correlationId);
    const { data, error } = await query;
    if (error) {
      this.logger.warn(`Operating event query unavailable: ${error.message}`);
      return [];
    }
    return data || [];
  }
}
