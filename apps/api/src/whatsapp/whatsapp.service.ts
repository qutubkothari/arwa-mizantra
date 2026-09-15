import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuditService } from '../audit/audit.service';
import { CrmService } from '../crm/crm.service';

const phone = (value: unknown) => String(value || '').replace(/\D/g, '');
const session = (tenantId: string) => String(process.env.WAHA_SESSION_NAME || `tenant_${String(tenantId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18)}`);

@Injectable()
export class WhatsAppService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  constructor(private readonly audit: AuditService, private readonly crm: CrmService) {}
  private roles(user: any) {
    return Array.from(new Set([
      typeof user?.role === 'string' ? user.role : user?.role?.name,
      ...(Array.isArray(user?.roles) ? user.roles.map((entry: any) => typeof entry === 'string' ? entry : entry?.role?.name || entry?.name) : []),
    ].filter(Boolean).map((value) => String(value).trim().toUpperCase().replace(/[\s-]+/g, '_'))));
  }
  private admin(user: any) { if (!this.roles(user).some((r) => ['SUPER_ADMIN', 'ADMIN', 'ADMINISTRATOR'].includes(r))) throw new ForbiddenException('Only an administrator may configure WhatsApp.'); return String(user?.userId || user?.id || ''); }
  private key() { return String(process.env.WAHA_API_KEY || ''); }
  private url() { return String(process.env.WAHA_API_URL || '').replace(/\/$/, ''); }
  private webhookUrl() { return String(process.env.WHATSAPP_WEBHOOK_URL || '').trim(); }
  private providerWebhook() {
    const url = this.webhookUrl();
    const secret = String(process.env.WHATSAPP_WEBHOOK_SECRET || '');
    if (!url || !secret) throw new BadRequestException('WhatsApp webhook URL and secret are not configured.');
    return {
      url,
      events: ['message', 'session.status'],
      hmac: { key: secret },
      retries: { policy: 'exponential', delaySeconds: 2, attempts: 8 },
    };
  }
  private signatureMatches(received: string, digest: Buffer) {
    const value = String(received || '').trim().replace(/^sha(?:256|512)=/i, '');
    const candidates: Buffer[] = [];
    if (/^[a-f\d]+$/i.test(value) && value.length % 2 === 0) candidates.push(Buffer.from(value, 'hex'));
    try { candidates.push(Buffer.from(value, 'base64')); } catch { /* Invalid base64 cannot match. */ }
    return candidates.some((candidate) => candidate.length === digest.length && timingSafeEqual(candidate, digest));
  }
  private async wa(method: string, path: string, body?: any) {
    if (!this.url() || !this.key()) throw new BadRequestException('WhatsApp provider is not configured. Set WAHA_API_URL and WAHA_API_KEY on the server.');
    const response = await fetch(`${this.url()}${path}`, { method, headers: { 'X-Api-Key': this.key(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new BadRequestException(`WhatsApp provider returned ${response.status}.`);
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.arrayBuffer();
  }
  private async connection(tenantId: string) { const { data, error } = await this.db.from('whatsapp_connections').select('*').eq('tenant_id', tenantId).eq('is_primary', true).maybeSingle(); if (error) throw new BadRequestException(error.message); return data; }
  private async syncConnection(tenantId: string, current?: any) {
    const connection = current || await this.connection(tenantId);
    if (!connection || !this.url() || !this.key()) return connection;
    try {
      const sessions: any = await this.wa('GET', '/api/sessions');
      const active = Array.isArray(sessions) ? sessions.find((item) => item?.name === connection.session_name) : null;
      const providerStatus = String(active?.status || '').toUpperCase();
      const status = providerStatus === 'WORKING' ? 'READY' : providerStatus ? 'QR_READY' : connection.status;
      const connectedPhone = phone(active?.me?.id || active?.me?.wid?.user || active?.me?.user || connection.phone_number);
      if (status !== connection.status || (connectedPhone && connectedPhone !== connection.phone_number)) {
        const { data } = await this.db.from('whatsapp_connections').update({ status, phone_number: connectedPhone || connection.phone_number || null, connected_at: status === 'READY' ? new Date().toISOString() : connection.connected_at, updated_at: new Date().toISOString() }).eq('id', connection.id).select().single();
        return data || connection;
      }
    } catch { /* Provider can be unavailable while it is starting; preserve the recorded state. */ }
    return connection;
  }
  async dashboard(tenantId: string, user: any) { this.admin(user); const connection = await this.syncConnection(tenantId); const { data, error } = await this.db.from('whatsapp_messages').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20); if (error) throw new BadRequestException(error.message); return { connection: connection || { status: 'DISCONNECTED', automation_enabled: false, opt_in_required: true }, messages: data || [], safety: { opt_in_required: true, automatic_external_send: !!connection?.automation_enabled, webhook_signature_required: true, provider: 'WAHA' } }; }
  async messages(tenantId: string, user: any, query: any) { this.admin(user); let request = this.db.from('whatsapp_messages').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(query?.limit) || 100, 1), 250)); if (query?.contact_phone) request = request.eq('contact_phone', phone(query.contact_phone)); const { data, error } = await request; if (error) throw new BadRequestException(error.message); return data || []; }
  async deleteMessage(tenantId: string, user: any, id: string, req: any) { const userId = this.admin(user); const { data, error } = await this.db.from('whatsapp_messages').delete().eq('tenant_id', tenantId).eq('id', id).select('id,contact_phone,direction').maybeSingle(); if (error) throw new BadRequestException(error.message); if (!data) throw new BadRequestException('WhatsApp message not found.'); await this.audit.logActivity({ tenantId, userId, action: 'WHATSAPP_MESSAGE_REMOVED_FROM_LEDGER', resourceType: 'whatsapp_message', resourceId: id, metadata: { recipient_masked: `***${String(data.contact_phone || '').slice(-4)}`, direction: data.direction, audit_history_retained: true }, ipAddress: req?.ip, userAgent: req?.headers?.['user-agent'] }); return { deleted: true, audit_history_retained: true }; }
  async connect(tenantId: string, user: any, body: any, req: any) { const userId = this.admin(user); const name = session(tenantId); const sessions: any = await this.wa('GET', '/api/sessions').catch(() => []); const existing = Array.isArray(sessions) ? sessions.find((item) => item?.name === name) : null; const providerStatus = String(existing?.status || '').toUpperCase(); const config = { ...(existing?.config || {}), webhooks: [this.providerWebhook()] }; if (!existing) await this.wa('POST', '/api/sessions', { name, config }); else await this.wa('PUT', `/api/sessions/${encodeURIComponent(name)}`, { name, config }); if (!['WORKING', 'SCAN_QR_CODE', 'STARTING'].includes(providerStatus)) await this.wa('POST', `/api/sessions/${encodeURIComponent(name)}/start`, {}); const { data, error } = await this.db.from('whatsapp_connections').upsert({ tenant_id: tenantId, session_name: name, provider: 'WAHA', status: providerStatus === 'WORKING' ? 'READY' : 'QR_READY', is_primary: true, automation_enabled: false, opt_in_required: true, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,session_name' }).select().single(); if (error) throw new BadRequestException(error.message); await this.audit.logActivity({ tenantId, userId, action: 'WHATSAPP_CONNECTION_STARTED', resourceType: 'whatsapp_connection', resourceId: data.id, metadata: { provider: 'WAHA', automation_enabled: false, signed_webhook_configured: true }, ipAddress: req?.ip, userAgent: req?.headers?.['user-agent'] }); return data; }
  async qr(tenantId: string, user: any) { this.admin(user); const conn = await this.connection(tenantId); if (!conn) throw new BadRequestException('Start a WhatsApp connection first.'); const bytes = await this.wa('POST', `/api/${encodeURIComponent(conn.session_name)}/auth/qr`, {}); return { session_name: conn.session_name, qr_data_url: `data:image/png;base64,${Buffer.from(bytes as ArrayBuffer).toString('base64')}` }; }
  async disconnect(tenantId: string, user: any, req: any) { const userId = this.admin(user); const conn = await this.connection(tenantId); if (!conn) return { disconnected: true }; await this.wa('POST', `/api/sessions/${encodeURIComponent(conn.session_name)}/stop`, {}).catch(() => undefined); const { error } = await this.db.from('whatsapp_connections').update({ status: 'DISCONNECTED', connected_at: null, updated_at: new Date().toISOString() }).eq('id', conn.id); if (error) throw new BadRequestException(error.message); await this.audit.logActivity({ tenantId, userId, action: 'WHATSAPP_CONNECTION_DISCONNECTED', resourceType: 'whatsapp_connection', resourceId: conn.id, ipAddress: req?.ip, userAgent: req?.headers?.['user-agent'] }); return { disconnected: true }; }
  async setAutomation(tenantId: string, user: any, body: any, req: any) { const userId = this.admin(user); const connection = await this.syncConnection(tenantId); if (!connection || connection.status !== 'READY') throw new BadRequestException('Connect WhatsApp before enabling automation.'); const enabled = body?.enabled === true; if (enabled && body?.confirm !== 'ENABLE') throw new BadRequestException('Set confirm to ENABLE to activate approved WhatsApp automation rules.'); const { data, error } = await this.db.from('whatsapp_connections').update({ automation_enabled: enabled, updated_at: new Date().toISOString() }).eq('id', connection.id).select().single(); if (error || !data) throw new BadRequestException(error?.message || 'WhatsApp automation setting could not be saved.'); await this.audit.logActivity({ tenantId, userId, action: enabled ? 'WHATSAPP_AUTOMATION_ENABLED' : 'WHATSAPP_AUTOMATION_DISABLED', resourceType: 'whatsapp_connection', resourceId: connection.id, metadata: { approved_rule_delivery_only: true }, ipAddress: req?.ip, userAgent: req?.headers?.['user-agent'] }); return data; }
  async setCrmCapture(tenantId: string, user: any, body: any, req: any) { const userId = this.admin(user); const connection = await this.syncConnection(tenantId); if (!connection || connection.status !== 'READY') throw new BadRequestException('Connect WhatsApp before enabling CRM capture.'); const enabled = body?.enabled === true; if (enabled && body?.confirm !== 'ENABLE') throw new BadRequestException('Set confirm to ENABLE to activate inbound CRM capture.'); const { data, error } = await this.db.from('whatsapp_connections').update({ crm_capture_enabled: enabled, crm_capture_owner_id: userId, updated_at: new Date().toISOString() }).eq('id', connection.id).select().single(); if (error || !data) throw new BadRequestException(error?.message || 'WhatsApp CRM capture setting could not be saved.'); await this.audit.logActivity({ tenantId, userId, action: enabled ? 'WHATSAPP_CRM_CAPTURE_ENABLED' : 'WHATSAPP_CRM_CAPTURE_DISABLED', resourceType: 'whatsapp_connection', resourceId: connection.id, metadata: { inbound_only: true, duplicate_safe_by_contact: true }, ipAddress: req?.ip, userAgent: req?.headers?.['user-agent'] }); return data; }
  async sendAutomated(tenantId: string, recipient: unknown, message: unknown, metadata: any = {}) { const conn = await this.syncConnection(tenantId); const to = phone(recipient); const text = String(message || '').trim(); if (!conn || conn.status !== 'READY') throw new BadRequestException('WhatsApp is not connected and ready.'); if (!conn.automation_enabled) throw new ForbiddenException('WhatsApp automation is disabled for this tenant.'); if (!to || to.length < 10 || !text) throw new BadRequestException('A valid WhatsApp recipient and message are required.'); const result: any = await this.wa('POST', '/api/sendText', { session: conn.session_name, chatId: `${to}@c.us`, text }); const { data, error } = await this.db.from('whatsapp_messages').insert({ tenant_id: tenantId, session_name: conn.session_name, contact_phone: to, direction: 'OUTBOUND', message_text: text, waha_message_id: result?.id || null, status: 'SENT', consent_checked: true }).select().single(); if (error) throw new BadRequestException(error.message); return { ...data, metadata }; }
  async send(tenantId: string, user: any, body: any, req: any) { const userId = this.admin(user); const conn = await this.syncConnection(tenantId); const recipients = Array.from(new Set(String(body?.phone || '').split(/[,;\n]+/).map(phone).filter((value) => value.length >= 10 && value.length <= 15))); const message = String(body?.message || '').trim(); if (!conn || conn.status !== 'READY') throw new BadRequestException('WhatsApp is not connected and ready.'); if (!recipients.length || !message) throw new BadRequestException('Enter at least one valid phone number and message. Separate multiple numbers with commas.'); if (body?.confirm !== 'SEND') throw new BadRequestException('Set confirm to SEND for an intentional external message.'); const sent: any[] = []; const failed: any[] = []; for (const to of recipients) { try { const result: any = await this.wa('POST', '/api/sendText', { session: conn.session_name, chatId: `${to}@c.us`, text: message }); const { data, error } = await this.db.from('whatsapp_messages').insert({ tenant_id: tenantId, session_name: conn.session_name, contact_phone: to, direction: 'OUTBOUND', message_text: message, waha_message_id: result?.id || null, status: 'SENT', sent_by: userId, consent_checked: true }).select().single(); if (error) throw new Error(error.message); sent.push(data); await this.audit.logActivity({ tenantId, userId, action: 'WHATSAPP_MESSAGE_SENT', resourceType: 'whatsapp_message', resourceId: data.id, metadata: { recipient_masked: `***${to.slice(-4)}`, length: message.length }, ipAddress: req?.ip, userAgent: req?.headers?.['user-agent'] }); } catch (error: any) { failed.push({ phone: `***${to.slice(-4)}`, reason: String(error?.message || 'Delivery failed') }); } } if (!sent.length) throw new BadRequestException(`No WhatsApp messages were sent. ${failed[0]?.reason || ''}`.trim()); return { sent, failed, sent_count: sent.length, failed_count: failed.length }; }
  async webhook(signatures: { provider?: string; legacy?: string }, rawBody: Buffer | undefined, payload: any) {
    const secret = String(process.env.WHATSAPP_WEBHOOK_SECRET || '');
    if (!secret) throw new UnauthorizedException('WhatsApp webhook secret is not configured.');
    const raw = rawBody?.length ? rawBody : Buffer.from(JSON.stringify(payload));
    const providerValid = !!signatures.provider && !!rawBody?.length && this.signatureMatches(signatures.provider, createHmac('sha512', secret).update(raw).digest());
    const legacyValid = !!signatures.legacy && this.signatureMatches(signatures.legacy, createHmac('sha256', secret).update(raw).digest());
    if (!providerValid && !legacyValid) throw new UnauthorizedException('Invalid WhatsApp webhook signature.');

    const event = String(payload?.event || '');
    if (!['message', 'message.any', 'session.status'].includes(event)) return { accepted: true, ignored: true };
    const name = String(typeof payload?.session === 'string' ? payload.session : payload?.session?.name || '');
    const { data: conn, error: connectionError } = await this.db.from('whatsapp_connections').select('*').eq('session_name', name).maybeSingle();
    if (connectionError) throw new BadRequestException(connectionError.message);
    if (!conn) return { accepted: true, ignored: true };
    if (event === 'session.status') {
      const ready = String(payload?.payload?.status || '').toUpperCase() === 'WORKING';
      const { error } = await this.db.from('whatsapp_connections').update({ status: ready ? 'READY' : 'QR_READY', connected_at: ready ? new Date().toISOString() : conn.connected_at, updated_at: new Date().toISOString() }).eq('id', conn.id);
      if (error) throw new BadRequestException(error.message);
      return { accepted: true };
    }

    const message = payload?.payload || {};
    if (message?.fromMe || message?._data?.key?.fromMe) return { accepted: true, ignored: true };
    const inbound = String(message?.body || '').trim();
    const rawMessageId = message?.id?._serialized || message?.id || message?._data?.key?.id;
    const wahaId = String(rawMessageId || '').trim();
    const contactPhone = phone(message?.from || message?._data?.key?.remoteJid);
    const contactName = String(message?._data?.notifyName || message?.notifyName || '').trim();
    if (!wahaId || !contactPhone) throw new BadRequestException('Inbound WhatsApp message identity is missing.');

    const { error: messageError } = await this.db.from('whatsapp_messages').upsert({
      tenant_id: conn.tenant_id, session_name: name, contact_phone: contactPhone,
      contact_name: contactName || null, direction: 'INBOUND', message_text: inbound,
      media_type: message?.type || null, waha_message_id: wahaId, status: 'RECEIVED', consent_checked: true,
    }, { onConflict: 'tenant_id,waha_message_id', ignoreDuplicates: true });
    if (messageError) throw new BadRequestException(messageError.message);

    const { data: ledger, error: ledgerError } = await this.db.from('whatsapp_messages')
      .select('id,crm_lead_id,crm_captured_at').eq('tenant_id', conn.tenant_id).eq('waha_message_id', wahaId).single();
    if (ledgerError || !ledger) throw new BadRequestException(ledgerError?.message || 'WhatsApp message ledger could not be read.');
    if (ledger.crm_captured_at) return { accepted: true, duplicate: true, crm_lead_id: ledger.crm_lead_id || null };

    await this.db.from('communication_log').upsert({
      tenant_id: conn.tenant_id, module: 'WHATSAPP', document_type: 'INBOUND_MESSAGE', channel: 'WHATSAPP',
      direction: 'INBOUND', recipient: contactPhone, subject: 'Inbound WhatsApp message',
      message_preview: inbound.slice(0, 1000), delivery_status: 'RECEIVED', dedupe_key: `WA:${wahaId}`,
      metadata: { session: name, automation_enabled: !!conn.automation_enabled, crm_capture_enabled: !!conn.crm_capture_enabled },
    }, { onConflict: 'tenant_id,dedupe_key', ignoreDuplicates: true });

    let crmLeadId: string | null = null;
    if (conn.crm_capture_enabled && inbound) {
      try {
        const captured = await this.crm.captureConversationLead(conn.tenant_id, conn.crm_capture_owner_id || conn.created_by, {
          source: 'WHATSAPP', source_external_id: `WA-CONTACT:${contactPhone}`,
          company_name: contactName || `WhatsApp ${contactPhone.slice(-4)}`, contact_person: contactName || null,
          phone: contactPhone, requirement: inbound,
          source_payload: { first_message_id: wahaId, channel: 'WHATSAPP' },
        }, 'WHATSAPP');
        crmLeadId = captured?.lead?.id || null;
        const { error } = await this.db.from('whatsapp_messages').update({ crm_lead_id: crmLeadId, crm_captured_at: new Date().toISOString(), crm_capture_error: null }).eq('id', ledger.id);
        if (error) throw new Error(error.message);
      } catch (error: any) {
        await this.db.from('whatsapp_messages').update({ crm_capture_error: String(error?.message || 'CRM capture failed').slice(0, 1000) }).eq('id', ledger.id);
        throw error;
      }
    } else {
      await this.db.from('whatsapp_messages').update({ crm_captured_at: new Date().toISOString(), crm_capture_error: null }).eq('id', ledger.id);
    }
    return { accepted: true, crm_lead_id: crmLeadId };
  }
}
