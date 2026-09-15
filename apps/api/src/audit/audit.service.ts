import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface AuditActivityInput {
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceCode?: string | null;
  resourceName?: string | null;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
}

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  action?: string;
  resourceType?: string;
  userId?: string;
  from?: string;
  to?: string;
  search?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  async logActivity(input: AuditActivityInput): Promise<void> {
    if (!input.tenantId || !input.userId) return;

    try {
      const { error } = await this.supabase.from('activity_logs').insert({
        tenant_id: input.tenantId,
        user_id: input.userId,
        action: input.action,
        resource_type: input.resourceType,
        resource_id: input.resourceId || null,
        resource_code: input.resourceCode || null,
        resource_name: input.resourceName || null,
        old_value: input.oldValue ?? null,
        new_value: input.newValue ?? null,
        ip_address: input.ipAddress || null,
        user_agent: input.userAgent || null,
        metadata: input.metadata || {},
      });

      if (error) {
        this.logger.warn(`Audit log insert failed: ${error.message}`);
      }
    } catch (error: any) {
      this.logger.warn(`Audit log insert failed: ${error?.message || error}`);
    }
  }

  async listActivityLogs(tenantId: string, query: AuditLogQuery = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);

    let request = this.supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.action) request = request.eq('action', query.action);
    if (query.resourceType) request = request.eq('resource_type', query.resourceType);
    if (query.userId) request = request.eq('user_id', query.userId);
    if (query.from) request = request.gte('created_at', query.from);
    if (query.to) request = request.lte('created_at', query.to);

    const search = String(query.search || '').trim();
    if (search) {
      const escaped = search.replace(/[%_]/g, '\\$&');
      request = request.or(`resource_code.ilike.%${escaped}%,resource_name.ilike.%${escaped}%,resource_type.ilike.%${escaped}%,action.ilike.%${escaped}%`);
    }

    const { data, error, count } = await request;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const userIds = Array.from(new Set(rows.map((row: any) => row?.user_id).filter(Boolean)));
    const userMap = new Map<string, any>();

    if (userIds.length > 0) {
      const { data: users } = await this.supabase
        .from('users')
        .select('id, first_name, last_name, username, email')
        .in('id', userIds);

      for (const user of users || []) {
        userMap.set(user.id, {
          id: user.id,
          name: this.formatUserName(user),
          email: user.email || '',
        });
      }
    }

    return {
      data: rows.map((row: any) => ({
        ...row,
        user: row?.user_id ? userMap.get(row.user_id) || null : null,
      })),
      total: count || 0,
      limit,
      offset,
    };
  }

  async getActivityLogFilters(tenantId: string) {
    const { data, error } = await this.supabase
      .from('activity_logs')
      .select('action, resource_type')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    return {
      actions: Array.from(new Set((data || []).map((row: any) => row.action).filter(Boolean))).sort(),
      resourceTypes: Array.from(new Set((data || []).map((row: any) => row.resource_type).filter(Boolean))).sort(),
    };
  }

  private formatUserName(user: any): string {
    return `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username || user?.email || 'Unknown user';
  }
}