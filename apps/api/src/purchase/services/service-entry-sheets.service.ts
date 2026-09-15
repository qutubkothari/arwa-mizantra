import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { normalizeInventoryCategory } from '../../inventory/utils/inventory-category';

const SERVICE_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED']);

@Injectable()
export class ServiceEntrySheetsService implements OnModuleInit {
  private readonly supabase: SupabaseClient;
  private schemaReady: Promise<void> | null = null;

  constructor() {
    this.supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  }

  onModuleInit() {
    void this.ensureSchema().catch((error) => {
      console.warn('[ServiceEntrySheetsService] schema warm-up failed:', error?.message || error);
    });
  }

  private number(value: any): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private isServiceLine(line: any): boolean {
    return normalizeInventoryCategory(line?.item?.category ?? line?.category) === 'SERVICES';
  }

  private superAdminBypass(user: any): boolean {
    const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
      .map((entry: any) => String(entry?.role?.name || entry?.name || entry || '').toUpperCase().replace(/[\s-]+/g, '_'));
    return roles.some((role) => role === 'SUPER_ADMIN');
  }

  async ensureSchema() {
    if (this.schemaReady) return this.schemaReady;
    this.schemaReady = (async () => {
      const sql = `
CREATE TABLE IF NOT EXISTS public.service_entry_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, ses_number VARCHAR(60) NOT NULL,
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT, vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT', service_period_start DATE, service_period_end DATE,
  completion_date DATE NOT NULL DEFAULT CURRENT_DATE, service_location TEXT, completion_notes TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb, submitted_by UUID, submitted_at TIMESTAMPTZ, approved_by UUID,
  approved_at TIMESTAMPTZ, rejected_by UUID, rejected_at TIMESTAMPTZ, rejection_reason TEXT, created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, ses_number),
  CONSTRAINT service_entry_sheets_status_check CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
  CONSTRAINT service_entry_sheets_period_check CHECK (service_period_end IS NULL OR service_period_start IS NULL OR service_period_end >= service_period_start)
);
CREATE TABLE IF NOT EXISTS public.service_entry_sheet_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  ses_id UUID NOT NULL REFERENCES public.service_entry_sheets(id) ON DELETE CASCADE,
  po_item_id UUID NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  item_code VARCHAR(120) NOT NULL, item_name TEXT NOT NULL, uom VARCHAR(30), ordered_qty NUMERIC(15,3) NOT NULL DEFAULT 0,
  accepted_qty NUMERIC(15,3) NOT NULL, rate NUMERIC(15,2) NOT NULL DEFAULT 0, discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_percent NUMERIC(7,3) NOT NULL DEFAULT 0, amount NUMERIC(15,2) NOT NULL DEFAULT 0, completion_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT service_entry_sheet_items_qty_check CHECK (accepted_qty > 0)
);
CREATE TABLE IF NOT EXISTS public.service_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  service_entry_sheet_id UUID NOT NULL REFERENCES public.service_entry_sheets(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(120) NOT NULL, invoice_date DATE NOT NULL, invoice_amount NUMERIC(15,2) NOT NULL,
  invoice_file_url TEXT, notes TEXT, status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL',
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sanctioned_by UUID, sanctioned_at TIMESTAMPTZ,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0, paid_by UUID, paid_at TIMESTAMPTZ, payment_reference VARCHAR(160),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, service_entry_sheet_id),
  CONSTRAINT service_invoices_status_check CHECK (status IN ('PENDING_APPROVAL','SANCTIONED','PARTIALLY_PAID','PAID','REJECTED')),
  CONSTRAINT service_invoices_amount_check CHECK (invoice_amount >= 0 AND paid_amount >= 0)
);
CREATE TABLE IF NOT EXISTS public.service_invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  service_invoice_id UUID NOT NULL REFERENCES public.service_invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL, payment_reference VARCHAR(160), notes TEXT, payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reversed_by UUID, reversed_at TIMESTAMPTZ, reversal_reason TEXT,
  CONSTRAINT service_invoice_payments_amount_check CHECK (amount > 0)
);
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS service_accepted_qty NUMERIC(15,3) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ses_tenant_status ON public.service_entry_sheets(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ses_po ON public.service_entry_sheets(tenant_id, po_id);
CREATE INDEX IF NOT EXISTS idx_ses_items_po_item ON public.service_entry_sheet_items(tenant_id, po_item_id);
CREATE INDEX IF NOT EXISTS idx_service_invoices_tenant_status ON public.service_invoices(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_invoice_payments_invoice ON public.service_invoice_payments(tenant_id, service_invoice_id, created_at DESC);
NOTIFY pgrst, 'reload schema';`;
      const { error } = await this.supabase.rpc('exec_sql', { sql });
      if (!error) return;
      const probe = await this.supabase.from('service_entry_sheets').select('id', { count: 'exact', head: true }).limit(1);
      if (!probe.error) return;
      throw new BadRequestException(`Service Entry Sheet schema setup failed: ${error.message}`);
    })();
    return this.schemaReady;
  }

  private async nextNumber(tenantId: string): Promise<string> {
    const prefix = `SES-${new Date().toISOString().slice(0, 7).replace('-', '-')}`;
    const { data, error } = await this.supabase
      .from('service_entry_sheets').select('ses_number').eq('tenant_id', tenantId)
      .like('ses_number', `${prefix}-%`).order('created_at', { ascending: false }).limit(1);
    if (error) throw new BadRequestException(error.message);
    const last = String(data?.[0]?.ses_number || '').match(/(\d+)$/)?.[1];
    return `${prefix}-${String((last ? Number(last) : 0) + 1).padStart(3, '0')}`;
  }

  private async poWithServiceLines(tenantId: string, poId: string) {
    const { data, error } = await this.supabase.from('purchase_orders').select(`
      id, po_number, vendor_id, status, delivery_address,
      vendor:vendors(id, name, code),
      purchase_order_items(id, item_code, item_name, uom, ordered_qty, rate, discount_percent, tax_percent, amount, service_accepted_qty, item:items(category))
    `).eq('tenant_id', tenantId).eq('id', poId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Purchase Order not found');
    const lines = (data.purchase_order_items || []).filter((line: any) => this.isServiceLine(line));
    if (lines.length === 0) throw new BadRequestException('This PO has no service lines. Use GRN for material purchases.');
    return { ...data, serviceLines: lines };
  }

  private async reservedQty(tenantId: string, poItemId: string, excludingSesId?: string) {
    const { data, error } = await this.supabase.from('service_entry_sheet_items')
      .select('accepted_qty, ses:service_entry_sheets!inner(id, status)')
      .eq('tenant_id', tenantId).eq('po_item_id', poItemId)
      .in('ses.status', ['PENDING_APPROVAL', 'APPROVED']);
    if (error) throw new BadRequestException(error.message);
    return (data || []).filter((row: any) => String(row?.ses?.id) !== String(excludingSesId || ''))
      .reduce((sum: number, row: any) => sum + this.number(row.accepted_qty), 0);
  }

  async eligiblePurchaseOrders(tenantId: string) {
    await this.ensureSchema();
    const { data, error } = await this.supabase.from('purchase_orders').select(`
      id, po_number, status, vendor_id, delivery_address, vendor:vendors(id, name, code),
      purchase_order_items(id, item_code, item_name, ordered_qty, uom, service_accepted_qty, item:items(category))
    `).eq('tenant_id', tenantId).eq('status', 'APPROVED').order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((po: any) => ({ ...po, service_lines: (po.purchase_order_items || []).filter((line: any) => this.isServiceLine(line)) }))
      .filter((po: any) => po.service_lines.length > 0);
  }

  async findAll(tenantId: string, query: any = {}) {
    await this.ensureSchema();
    let db = this.supabase.from('service_entry_sheets').select(`
      *, vendor:vendors(id, name, code), po:purchase_orders(id, po_number, status),
      items:service_entry_sheet_items(*)
    `).eq('tenant_id', tenantId).order('created_at', { ascending: false });
    const status = String(query?.status || '').trim().toUpperCase();
    if (status && SERVICE_STATUSES.has(status)) db = db.eq('status', status);
    const { data, error } = await db;
    if (error) throw new BadRequestException(error.message);
    const search = String(query?.search || '').trim().toLowerCase();
    return (data || []).filter((row: any) => !search || [row.ses_number, row.po?.po_number, row.vendor?.name].some((value) => String(value || '').toLowerCase().includes(search)));
  }

  async findOne(tenantId: string, id: string) {
    await this.ensureSchema();
    const { data, error } = await this.supabase.from('service_entry_sheets').select(`
      *, vendor:vendors(id, name, code), po:purchase_orders(id, po_number, status, delivery_address),
      items:service_entry_sheet_items(*)
    `).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Service Entry Sheet not found');
    return data;
  }

  async create(tenantId: string, userId: string, body: any) {
    await this.ensureSchema();
    const poId = String(body?.poId ?? body?.po_id ?? '').trim();
    if (!poId) throw new BadRequestException('Select an approved Service PO.');
    const po = await this.poWithServiceLines(tenantId, poId);
    if (String(po.status).toUpperCase() !== 'APPROVED') throw new BadRequestException('Only approved Service POs can be accepted.');
    const requested = Array.isArray(body?.items) ? body.items : [];
    if (requested.length === 0) throw new BadRequestException('Enter at least one completed service line.');
    const byId = new Map(po.serviceLines.map((line: any) => [String(line.id), line]));
    const items: any[] = [];
    for (const request of requested) {
      const line = byId.get(String(request?.poItemId ?? request?.po_item_id ?? ''));
      if (!line) throw new BadRequestException('Only service PO lines may be entered on a Service Entry Sheet.');
      const qty = this.number(request?.acceptedQty ?? request?.accepted_qty ?? request?.quantity);
      if (qty <= 0) throw new BadRequestException(`Enter a completed quantity for ${line.item_code}.`);
      const reserved = await this.reservedQty(tenantId, String(line.id));
      const remaining = this.number(line.ordered_qty) - reserved;
      if (qty > remaining + 0.000001) throw new BadRequestException(`${line.item_code} exceeds the remaining service PO quantity (${remaining}).`);
      const rate = this.number(line.rate);
      const discount = this.number(line.discount_percent);
      const net = qty * rate * (1 - discount / 100);
      const tax = this.number(line.tax_percent);
      items.push({ tenant_id: tenantId, po_item_id: line.id, item_code: line.item_code, item_name: line.item_name, uom: line.uom,
        ordered_qty: this.number(line.ordered_qty), accepted_qty: qty, rate, discount_percent: discount, tax_percent: tax,
        amount: Math.round((net + net * tax / 100) * 100) / 100, completion_note: String(request?.completionNote ?? request?.completion_note ?? '').trim() || null });
    }
    const start = String(body?.servicePeriodStart ?? body?.service_period_start ?? '').slice(0, 10) || null;
    const end = String(body?.servicePeriodEnd ?? body?.service_period_end ?? '').slice(0, 10) || null;
    const completionDate = String(body?.completionDate ?? body?.completion_date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (start && end && end < start) throw new BadRequestException('Service period end cannot be before its start date.');
    const evidence = Array.isArray(body?.evidence) ? body.evidence.filter(Boolean) : [];
    const { data: ses, error } = await this.supabase.from('service_entry_sheets').insert({
      tenant_id: tenantId, ses_number: await this.nextNumber(tenantId), po_id: po.id, vendor_id: po.vendor_id,
      status: 'DRAFT', service_period_start: start, service_period_end: end, completion_date: completionDate,
      service_location: String(body?.serviceLocation ?? body?.service_location ?? po.delivery_address ?? '').trim() || null,
      completion_notes: String(body?.completionNotes ?? body?.completion_notes ?? '').trim() || null,
      evidence, created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    const { error: itemError } = await this.supabase.from('service_entry_sheet_items').insert(items.map((item) => ({ ...item, ses_id: ses.id })));
    if (itemError) { await this.supabase.from('service_entry_sheets').delete().eq('id', ses.id); throw new BadRequestException(itemError.message); }
    return this.findOne(tenantId, ses.id);
  }

  async submit(tenantId: string, id: string, userId: string) {
    const ses = await this.findOne(tenantId, id);
    if (!['DRAFT', 'REJECTED'].includes(String(ses.status).toUpperCase())) throw new BadRequestException('Only draft or rejected Service Entry Sheets can be submitted.');
    if (!String(ses.completion_notes || '').trim()) throw new BadRequestException('Completion/sign-off notes are required before submission.');
    if (!Array.isArray(ses.items) || ses.items.length === 0) throw new BadRequestException('A Service Entry Sheet needs at least one service line.');
    const { error } = await this.supabase.from('service_entry_sheets').update({ status: 'PENDING_APPROVAL', submitted_by: userId, submitted_at: new Date().toISOString(), rejection_reason: null, rejected_by: null, rejected_at: null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.findOne(tenantId, id);
  }

  async approve(tenantId: string, id: string, user: any) {
    const ses = await this.findOne(tenantId, id);
    if (String(ses.status).toUpperCase() !== 'PENDING_APPROVAL') throw new BadRequestException('Only a submitted Service Entry Sheet can be accepted.');
    const userId = String(user?.userId || user?.id || '').trim();
    if (userId && userId === String(ses.created_by || '') && !this.superAdminBypass(user)) throw new ForbiddenException('Maker-checker: the service entry creator cannot accept their own entry.');
    for (const item of ses.items || []) {
      const { data: poItem, error: poItemError } = await this.supabase.from('purchase_order_items').select('id, service_accepted_qty').eq('id', item.po_item_id).maybeSingle();
      if (poItemError || !poItem) throw new BadRequestException('A linked PO line is no longer available.');
      const { error: updateError } = await this.supabase.from('purchase_order_items').update({ service_accepted_qty: this.number(poItem.service_accepted_qty) + this.number(item.accepted_qty) }).eq('id', item.po_item_id);
      if (updateError) throw new BadRequestException(updateError.message);
    }
    const { error } = await this.supabase.from('service_entry_sheets').update({ status: 'APPROVED', approved_by: userId || null, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.findOne(tenantId, id);
  }

  async reject(tenantId: string, id: string, user: any, reason: any) {
    const ses = await this.findOne(tenantId, id);
    if (String(ses.status).toUpperCase() !== 'PENDING_APPROVAL') throw new BadRequestException('Only a submitted Service Entry Sheet can be rejected.');
    const userId = String(user?.userId || user?.id || '').trim();
    if (userId && userId === String(ses.created_by || '') && !this.superAdminBypass(user)) throw new ForbiddenException('Maker-checker: the service entry creator cannot reject their own entry.');
    const note = String(reason || '').trim();
    if (!note) throw new BadRequestException('A rejection reason is required.');
    const { error } = await this.supabase.from('service_entry_sheets').update({ status: 'REJECTED', rejected_by: userId || null, rejected_at: new Date().toISOString(), rejection_reason: note, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.findOne(tenantId, id);
  }

  async eligibleForInvoice(tenantId: string) {
    await this.ensureSchema();
    const { data, error } = await this.supabase.from('service_entry_sheets').select(`
      id, ses_number, completion_date, completion_notes, po:purchase_orders(po_number), vendor:vendors(name),
      items:service_entry_sheet_items(item_code, item_name, accepted_qty, amount), invoice:service_invoices(id)
    `).eq('tenant_id', tenantId).eq('status', 'APPROVED').order('approved_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data || []).filter((entry: any) => !entry.invoice).map((entry: any) => ({
      ...entry, accepted_amount: (entry.items || []).reduce((sum: number, item: any) => sum + this.number(item.amount), 0),
    }));
  }

  async listInvoices(tenantId: string) {
    await this.ensureSchema();
    const { data, error } = await this.supabase.from('service_invoices').select(`
      *, ses:service_entry_sheets(ses_number, completion_date, po:purchase_orders(po_number), vendor:vendors(name)),
      payments:service_invoice_payments(*)
    `).eq('tenant_id', tenantId).order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createInvoice(tenantId: string, userId: string, body: any) {
    await this.ensureSchema();
    const sesId = String(body?.serviceEntrySheetId ?? body?.service_entry_sheet_id ?? '').trim();
    const invoiceNumber = String(body?.invoiceNumber ?? body?.invoice_number ?? '').trim();
    const invoiceDate = String(body?.invoiceDate ?? body?.invoice_date ?? '').slice(0, 10);
    const amount = Math.round(this.number(body?.invoiceAmount ?? body?.invoice_amount) * 100) / 100;
    if (!sesId || !invoiceNumber || !invoiceDate || amount <= 0) throw new BadRequestException('Service Entry Sheet, invoice number, date, and amount are required.');
    const ses = await this.findOne(tenantId, sesId);
    if (String(ses.status).toUpperCase() !== 'APPROVED') throw new BadRequestException('Supplier invoice can be recorded only after the Service Entry Sheet is accepted.');
    const acceptedAmount = (ses.items || []).reduce((sum: number, item: any) => sum + this.number(item.amount), 0);
    if (amount > acceptedAmount + 0.01) throw new BadRequestException(`Invoice amount exceeds the accepted service value (${acceptedAmount.toFixed(2)}). Record a revised SES before invoicing.`);
    const { data: existing } = await this.supabase.from('service_invoices').select('id').eq('tenant_id', tenantId).eq('service_entry_sheet_id', sesId).maybeSingle();
    if (existing) throw new BadRequestException('A supplier invoice has already been recorded for this Service Entry Sheet.');
    const { data, error } = await this.supabase.from('service_invoices').insert({
      tenant_id: tenantId, service_entry_sheet_id: sesId, invoice_number: invoiceNumber, invoice_date: invoiceDate,
      invoice_amount: amount, invoice_file_url: String(body?.invoiceFileUrl ?? body?.invoice_file_url ?? '').trim() || null,
      notes: String(body?.notes ?? '').trim() || null, status: 'PENDING_APPROVAL', created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async sanctionInvoice(tenantId: string, id: string, user: any) {
    await this.ensureSchema();
    const { data: invoice, error } = await this.supabase.from('service_invoices').select('*, ses:service_entry_sheets(created_by)').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (error || !invoice) throw new NotFoundException('Service invoice not found');
    if (String(invoice.status).toUpperCase() !== 'PENDING_APPROVAL') throw new BadRequestException('Only pending service invoices can be sanctioned.');
    const userId = String(user?.userId || user?.id || '').trim();
    if (userId && userId === String(invoice.created_by || '') && !this.superAdminBypass(user)) throw new ForbiddenException('Maker-checker: the invoice creator cannot sanction their own invoice.');
    const { error: updateError } = await this.supabase.from('service_invoices').update({ status: 'SANCTIONED', sanctioned_by: userId || null, sanctioned_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    if (updateError) throw new BadRequestException(updateError.message);
    return this.listInvoices(tenantId);
  }

  async recordInvoicePayment(tenantId: string, id: string, userId: string, body: any) {
    await this.ensureSchema();
    const { data: invoice, error } = await this.supabase.from('service_invoices').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (error || !invoice) throw new NotFoundException('Service invoice not found');
    if (!['SANCTIONED', 'PARTIALLY_PAID'].includes(String(invoice.status).toUpperCase())) throw new BadRequestException('Only sanctioned service invoices can be paid.');
    const amount = Math.round(this.number(body?.amount) * 100) / 100;
    const remaining = this.number(invoice.invoice_amount) - this.number(invoice.paid_amount);
    if (amount <= 0 || amount > remaining + 0.01) throw new BadRequestException(`Payment must be greater than zero and not exceed ${remaining.toFixed(2)}.`);
    const { error: paymentError } = await this.supabase.from('service_invoice_payments').insert({
      tenant_id: tenantId, service_invoice_id: id, amount, payment_reference: String(body?.reference ?? '').trim() || null,
      notes: String(body?.notes ?? '').trim() || null, payment_date: String(body?.paymentDate ?? body?.payment_date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10), created_by: userId || null,
    });
    if (paymentError) throw new BadRequestException(paymentError.message);
    const paid = Math.round((this.number(invoice.paid_amount) + amount) * 100) / 100;
    const status = paid >= this.number(invoice.invoice_amount) - 0.01 ? 'PAID' : 'PARTIALLY_PAID';
    const { data, error: updateError } = await this.supabase.from('service_invoices').update({ paid_amount: paid, status, paid_by: userId || null, paid_at: new Date().toISOString(), payment_reference: String(body?.reference ?? '').trim() || invoice.payment_reference || null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).select().single();
    if (updateError) throw new BadRequestException(updateError.message);
    return data;
  }

  async reverseInvoicePayment(tenantId: string, invoiceId: string, paymentId: string, userId: string, reason: any) {
    await this.ensureSchema();
    const note = String(reason || '').trim();
    if (!note) throw new BadRequestException('A reversal reason is required.');
    const { data: invoice, error: invoiceError } = await this.supabase.from('service_invoices').select('*').eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle();
    if (invoiceError || !invoice) throw new NotFoundException('Service invoice not found');
    const { data: payment, error: paymentError } = await this.supabase.from('service_invoice_payments').select('*').eq('tenant_id', tenantId).eq('service_invoice_id', invoiceId).eq('id', paymentId).maybeSingle();
    if (paymentError || !payment) throw new NotFoundException('Service payment not found');
    if (payment.reversed_at) throw new BadRequestException('This service payment has already been reversed.');
    const { error: reverseError } = await this.supabase.from('service_invoice_payments').update({ reversed_by: userId || null, reversed_at: new Date().toISOString(), reversal_reason: note }).eq('tenant_id', tenantId).eq('id', paymentId);
    if (reverseError) throw new BadRequestException(reverseError.message);
    const { data: activePayments, error: activeError } = await this.supabase.from('service_invoice_payments').select('amount').eq('tenant_id', tenantId).eq('service_invoice_id', invoiceId).is('reversed_at', null);
    if (activeError) throw new BadRequestException(activeError.message);
    const paid = Math.round((activePayments || []).reduce((sum: number, entry: any) => sum + this.number(entry.amount), 0) * 100) / 100;
    const status = paid <= 0 ? 'SANCTIONED' : paid >= this.number(invoice.invoice_amount) - 0.01 ? 'PAID' : 'PARTIALLY_PAID';
    const { data, error: updateError } = await this.supabase.from('service_invoices').update({ paid_amount: paid, status, paid_by: null, paid_at: null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', invoiceId).select().single();
    if (updateError) throw new BadRequestException(updateError.message);
    return data;
  }
}
