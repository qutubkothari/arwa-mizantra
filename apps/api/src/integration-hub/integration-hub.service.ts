import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuditService } from '../audit/audit.service';

const CATALOG: Record<string, Array<[string, string]>> = {
  SHARED: [['CRM', 'CRM / customer sync'], ['ECOMMERCE', 'E-commerce orders'], ['EMAIL', 'Email & document capture'], ['WEBHOOK', 'Webhook/API gateway'], ['WHATSAPP', 'WhatsApp business bot & governed alerts']],
  INDIA: [['INDIA_GST', 'GST returns & reconciliation'], ['INDIA_EINVOICE', 'GST e-invoice / IRN'], ['INDIA_EWAY', 'E-way bill'], ['INDIA_TDS', 'TDS compliance'], ['INDIA_BANK', 'Indian bank statement/payment files'], ['INDIA_PAYROLL', 'Indian payroll statutory exports']],
  UAE: [['UAE_FTA', 'FTA VAT evidence'], ['UAE_EINVOICE', 'UAE e-invoicing readiness'], ['UAE_BANK', 'UAE bank statement/payment files'], ['UAE_WPS', 'WPS payroll file'], ['UAE_GRATUITY', 'End-of-service benefit evidence']],
};

@Injectable()
export class IntegrationHubService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  constructor(private readonly audit: AuditService) {}

  private hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private userId(user: any) { return String(user?.userId || user?.id || '').trim(); }
  private roles(user: any): string[] {
    return Array.from(new Set([
      typeof user?.role === 'string' ? user.role : user?.role?.name,
      ...(Array.isArray(user?.roles) ? user.roles.map((entry: any) => typeof entry === 'string' ? entry : entry?.role?.name || entry?.name) : []),
    ].filter(Boolean).map((value) => String(value).trim().toUpperCase().replace(/[\s-]+/g, '_'))));
  }
  private requireAdministrator(user: any) {
    const userId = this.userId(user);
    if (!userId || !this.roles(user).some((role) => ['SUPER_ADMIN', 'ADMIN', 'ADMINISTRATOR'].includes(role))) {
      throw new ForbiddenException('Only an administrator may view or configure Integration Hub connections.');
    }
    return userId;
  }
  private safeConnection(connection: any) {
    if (!connection) return null;
    const { secret_reference: _secretReference, ...safe } = connection;
    return safe;
  }

  async dashboard(tenantId: string, user: any) {
    this.requireAdministrator(user);
    const [{ data: tenant, error: tenantError }, { data: connections, error: connectionError }, { data: events, error: eventError }] = await Promise.all([
      this.db.from('tenants').select('market_profile').eq('id', tenantId).single(),
      this.db.from('integration_connections').select('*').eq('tenant_id', tenantId).order('connector_name'),
      this.db.from('integration_events').select('*').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(50),
    ]);
    if (tenantError || connectionError || eventError) throw new BadRequestException((tenantError || connectionError || eventError)?.message);
    const market = tenant?.market_profile === 'UAE' ? 'UAE' : 'INDIA';
    const safeConnections = (connections || []).map((connection) => this.safeConnection(connection));
    return {
      market_profile: market,
      catalog: [...CATALOG.SHARED, ...CATALOG[market]].map(([connector_code, connector_name]) => ({
        connector_code, connector_name,
        market_profile: CATALOG[market].some(([code]) => code === connector_code) ? market : 'SHARED',
        connection: safeConnections.find((connection: any) => connection.connector_code === connector_code) || null,
      })),
      connections: safeConnections,
      events: events || [],
      safety: { external_delivery: false, secrets_exposed: false, test_events_only: true },
    };
  }

  async save(tenantId: string, user: any, body: any, request?: any) {
    const userId = this.requireAdministrator(user);
    const dashboard = await this.dashboard(tenantId, user);
    const code = String(body?.connector_code || '').toUpperCase();
    const item = dashboard.catalog.find((entry: any) => entry.connector_code === code);
    if (!item) throw new BadRequestException('This connector is not available for the company market profile.');
    const status = ['DRAFT', 'TESTING', 'PAUSED'].includes(String(body?.status || '').toUpperCase()) ? String(body.status).toUpperCase() : 'DRAFT';
    const configuration = body?.configuration && typeof body.configuration === 'object' ? body.configuration : {};
    const secretReference = String(body?.secret_reference || '').trim() || null;
    if (secretReference && (!/^([A-Za-z0-9_./:-]{3,180})$/.test(secretReference) || /(?:key|token|password|secret)\s*=/i.test(secretReference))) {
      throw new BadRequestException('Store only a vault reference, never a credential value, in Integration Hub.');
    }
    const { data, error } = await this.db.from('integration_connections').upsert({
      tenant_id: tenantId, connector_code: code, connector_name: item.connector_name, market_profile: item.market_profile, status,
      secret_reference: secretReference, configuration, created_by: userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,connector_code' }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.audit.logActivity({ tenantId, userId, action: 'INTEGRATION_CONNECTION_CONFIGURED', resourceType: 'integration_connection', resourceId: data.id, resourceName: code, newValue: { connector_code: code, market_profile: item.market_profile, status, configuration, has_secret_reference: !!secretReference }, ipAddress: request?.ip, userAgent: request?.headers?.['user-agent'], metadata: { external_delivery: false, test_mode_only: true } });
    return this.safeConnection(data);
  }

  async recordTest(tenantId: string, user: any, id: string, body: any, request?: any) {
    const userId = this.requireAdministrator(user);
    const { data: connection, error } = await this.db.from('integration_connections').select('*').eq('tenant_id', tenantId).eq('id', id).single();
    if (error || !connection) throw new BadRequestException('Connector not found.');
    if (connection.status !== 'TESTING') throw new BadRequestException('Only a connector in TESTING status may record a safe test event.');
    const idempotencyKey = String(body?.idempotency_key || `TEST-${Date.now()}`).slice(0, 180);
    const payload = { connector: connection.connector_code, event_type: body?.event_type || 'CONNECTIVITY_TEST', actor: userId, test: true };
    const { data, error: eventError } = await this.db.from('integration_events').upsert({
      tenant_id: tenantId, connection_id: id, direction: 'OUTBOUND', event_type: payload.event_type, idempotency_key: idempotencyKey,
      payload_hash: this.hash(payload), status: 'DELIVERED', attempt_count: 1, processed_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,connection_id,idempotency_key' }).select().single();
    if (eventError) throw new BadRequestException(eventError.message);
    await this.audit.logActivity({ tenantId, userId, action: 'INTEGRATION_TEST_EVENT_RECORDED', resourceType: 'integration_event', resourceId: data.id, resourceName: connection.connector_code, newValue: { event_type: payload.event_type, idempotency_key: idempotencyKey }, ipAddress: request?.ip, userAgent: request?.headers?.['user-agent'], metadata: { external_delivery: false, test_event: true } });
    return data;
  }
}
