import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const statuses = new Set([
  'DRAFT',
  'IN_TRANSIT',
  'AT_PORT',
  'CLEARED',
  'GRN_POSTED',
  'LANDED_COST_PENDING',
  'LANDED_COST_POSTED',
  'CLOSED',
  'CANCELLED',
]);

const paymentStatuses = new Set(['PENDING_APPROVAL', 'APPROVED', 'PAID', 'REVERSED']);

@Injectable()
export class ImportFilesService implements OnModuleInit {
  private readonly supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private schemaReady: Promise<void> | null = null;

  onModuleInit() {
    void this.ensureSchema().catch((error) => {
      console.warn('[ImportFilesService] schema warm-up failed:', error?.message || error);
    });
  }

  private num(value: any): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
  }

  private text(value: any): string | null {
    const t = String(value || '').trim();
    return t || null;
  }

  async ensureSchema() {
    if (this.schemaReady) return this.schemaReady;
    this.schemaReady = (async () => {
      const sql = `
CREATE TABLE IF NOT EXISTS public.import_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_number VARCHAR(60) NOT NULL,
 vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL, po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
 status VARCHAR(40) NOT NULL DEFAULT 'DRAFT', currency VARCHAR(10) NOT NULL DEFAULT 'USD', customs_exchange_rate NUMERIC(15,6), incoterm VARCHAR(20),
 shipment_reference VARCHAR(160), bill_of_entry_number VARCHAR(120), bill_of_entry_date DATE, port_of_entry VARCHAR(160), expected_arrival_date DATE,
 commercial_invoice_number VARCHAR(120), commercial_invoice_date DATE, assessable_value_inr NUMERIC(15,2) NOT NULL DEFAULT 0,
 bcd_amount NUMERIC(15,2) NOT NULL DEFAULT 0, sws_amount NUMERIC(15,2) NOT NULL DEFAULT 0, import_igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
 recoverable_igst BOOLEAN NOT NULL DEFAULT TRUE, final_landed_cost NUMERIC(15,2) NOT NULL DEFAULT 0, notes TEXT,
 created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id, import_number)
);
ALTER TABLE public.import_files DROP CONSTRAINT IF EXISTS import_files_status_check;
ALTER TABLE public.import_files ADD CONSTRAINT import_files_status_check CHECK (status IN ('DRAFT','IN_TRANSIT','AT_PORT','CLEARED','GRN_POSTED','LANDED_COST_PENDING','LANDED_COST_POSTED','CLOSED','CANCELLED'));
CREATE TABLE IF NOT EXISTS public.import_file_costs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
 cost_type VARCHAR(50) NOT NULL, supplier_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL, document_number VARCHAR(120), cost_date DATE,
 currency VARCHAR(10) NOT NULL DEFAULT 'INR', exchange_rate NUMERIC(15,6) NOT NULL DEFAULT 1, foreign_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
 inr_amount NUMERIC(15,2) NOT NULL DEFAULT 0, recoverable_tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0, allocation_basis VARCHAR(30) NOT NULL DEFAULT 'VALUE',
 notes TEXT, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.import_file_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
 document_type VARCHAR(50) NOT NULL, file_name TEXT NOT NULL, file_url TEXT NOT NULL, notes TEXT, uploaded_by UUID, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.import_file_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
 event_type VARCHAR(60) NOT NULL, description TEXT NOT NULL, reference_type VARCHAR(40), reference_id UUID, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.import_file_grns (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
 grn_id UUID NOT NULL REFERENCES public.grns(id) ON DELETE RESTRICT, allocation_basis VARCHAR(30) NOT NULL DEFAULT 'VALUE',
 allocated_landed_cost NUMERIC(15,2) NOT NULL DEFAULT 0, status VARCHAR(30) NOT NULL DEFAULT 'PENDING_ALLOCATION', created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(tenant_id, import_file_id, grn_id)
);
CREATE TABLE IF NOT EXISTS public.import_file_grn_allocations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
 import_file_grn_id UUID NOT NULL REFERENCES public.import_file_grns(id) ON DELETE CASCADE, grn_id UUID NOT NULL REFERENCES public.grns(id) ON DELETE RESTRICT,
 grn_item_id UUID, item_id UUID, item_code TEXT, item_name TEXT, received_qty NUMERIC(15,3) NOT NULL DEFAULT 0,
 base_rate NUMERIC(15,2) NOT NULL DEFAULT 0, base_value NUMERIC(15,2) NOT NULL DEFAULT 0, allocated_landed_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
 landed_unit_cost NUMERIC(15,4) NOT NULL DEFAULT 0, allocation_basis VARCHAR(30) NOT NULL DEFAULT 'VALUE',
 created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.import_file_assessment_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
 grn_id UUID REFERENCES public.grns(id) ON DELETE SET NULL, grn_item_id UUID, item_id UUID, item_code TEXT, item_name TEXT,
 quantity NUMERIC(15,3) NOT NULL DEFAULT 0, foreign_amount NUMERIC(15,2) NOT NULL DEFAULT 0, exchange_rate NUMERIC(15,6) NOT NULL DEFAULT 1,
 assessed_value_inr NUMERIC(15,2) NOT NULL DEFAULT 0, customs_duty_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
 cess_amount NUMERIC(15,2) NOT NULL DEFAULT 0, gst_rate NUMERIC(8,3) NOT NULL DEFAULT 0, gst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
 total_tax_base NUMERIC(15,2) NOT NULL DEFAULT 0, notes TEXT, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.import_file_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, import_file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
 supplier_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL, payment_category VARCHAR(50) NOT NULL, document_number VARCHAR(120), currency VARCHAR(10) NOT NULL DEFAULT 'INR',
 exchange_rate NUMERIC(15,6) NOT NULL DEFAULT 1, foreign_amount NUMERIC(15,2) NOT NULL DEFAULT 0, inr_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
 status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL', payment_date DATE, payment_reference VARCHAR(160), notes TEXT,
 created_by UUID, approved_by UUID, approved_at TIMESTAMPTZ, paid_by UUID, paid_at TIMESTAMPTZ, reversed_by UUID, reversed_at TIMESTAMPTZ, reversal_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.import_file_payments DROP CONSTRAINT IF EXISTS import_file_payments_status_check;
ALTER TABLE public.import_file_payments ADD CONSTRAINT import_file_payments_status_check CHECK (status IN ('PENDING_APPROVAL','APPROVED','PAID','REVERSED'));
CREATE INDEX IF NOT EXISTS idx_import_files_tenant_status ON public.import_files(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_events_file ON public.import_file_events(tenant_id,import_file_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_grns_file ON public.import_file_grns(tenant_id,import_file_id);
CREATE INDEX IF NOT EXISTS idx_import_allocations_file ON public.import_file_grn_allocations(tenant_id,import_file_id);
CREATE INDEX IF NOT EXISTS idx_import_assessment_file ON public.import_file_assessment_lines(tenant_id,import_file_id);
CREATE INDEX IF NOT EXISTS idx_import_payments_file ON public.import_file_payments(tenant_id,import_file_id);
NOTIFY pgrst, 'reload schema';`;
      const { error } = await this.supabase.rpc('exec_sql', { sql });
      if (!error) return;
      const probe = await this.supabase.from('import_files').select('id', { count: 'exact', head: true }).limit(1);
      if (probe.error) throw new BadRequestException(`Import File schema setup failed: ${error.message}`);
    })();
    return this.schemaReady;
  }

  private async nextNo(tenantId: string) {
    const prefix = `IMP-${new Date().toISOString().slice(0, 7)}`;
    const { data } = await this.supabase
      .from('import_files')
      .select('import_number')
      .eq('tenant_id', tenantId)
      .like('import_number', `${prefix}-%`)
      .order('created_at', { ascending: false })
      .limit(1);
    const last = String(data?.[0]?.import_number || '').match(/(\d+)$/)?.[1];
    return `${prefix}-${String((last ? Number(last) : 0) + 1).padStart(3, '0')}`;
  }

  private async event(tenantId: string, importFileId: string, eventType: string, description: string, userId: string, referenceId?: string) {
    await this.supabase.from('import_file_events').insert({
      tenant_id: tenantId,
      import_file_id: importFileId,
      event_type: eventType,
      description,
      created_by: userId || null,
      reference_id: referenceId || null,
    });
  }

  async list(tenantId: string) {
    await this.ensureSchema();
    const { data, error } = await this.supabase
      .from('import_files')
      .select('*, vendor:vendors(id,name,code), po:purchase_orders(id,po_number), costs:import_file_costs(*), documents:import_file_documents(*), grns:import_file_grns(*), payments:import_file_payments(*)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async one(tenantId: string, id: string) {
    await this.ensureSchema();
    const { data, error } = await this.supabase
      .from('import_files')
      .select('*, vendor:vendors(id,name,code), po:purchase_orders(id,po_number)')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Import File not found');

    const [costs, documents, grns, events, payments, allocations, assessmentLines] = await Promise.all([
      this.supabase.from('import_file_costs').select('*, supplier:vendors(id,name,code)').eq('tenant_id', tenantId).eq('import_file_id', id).order('created_at', { ascending: false }),
      this.supabase.from('import_file_documents').select('*').eq('tenant_id', tenantId).eq('import_file_id', id).order('uploaded_at', { ascending: false }),
      this.supabase.from('import_file_grns').select('*, grn:grns(id,grn_number,status,invoice_number,receipt_date,purchase_order_id)').eq('tenant_id', tenantId).eq('import_file_id', id).order('created_at', { ascending: false }),
      this.supabase.from('import_file_events').select('*').eq('tenant_id', tenantId).eq('import_file_id', id).order('created_at', { ascending: false }),
      this.supabase.from('import_file_payments').select('*, supplier:vendors(id,name,code)').eq('tenant_id', tenantId).eq('import_file_id', id).order('created_at', { ascending: false }),
      this.supabase.from('import_file_grn_allocations').select('*').eq('tenant_id', tenantId).eq('import_file_id', id).order('created_at', { ascending: false }),
      this.supabase.from('import_file_assessment_lines').select('*').eq('tenant_id', tenantId).eq('import_file_id', id).order('created_at', { ascending: true }),
    ]);
    const linkedGrnIds = Array.from(new Set((grns.data || []).map((row: any) => row.grn_id).filter(Boolean)));
    let assessmentSourceLines: any[] = [];
    if (linkedGrnIds.length) {
      const { data: sourceLines } = await this.supabase
        .from('grn_items')
        .select('id,grn_id,item_id,item_code,item_name,accepted_qty,received_qty,quantity,rate,total_amount')
        .eq('tenant_id', tenantId)
        .in('grn_id', linkedGrnIds);
      assessmentSourceLines = sourceLines || [];
    }

    return {
      ...data,
      costs: costs.data || [],
      documents: documents.data || [],
      grns: grns.data || [],
      events: events.data || [],
      payments: payments.data || [],
      allocations: allocations.data || [],
      assessment_lines: assessmentLines.data || [],
      assessmentSourceLines,
    };
  }

  async relatedByVendor(tenantId: string, vendorId: string) {
    await this.ensureSchema();
    if (!String(vendorId || '').trim()) throw new BadRequestException('Vendor is required.');
    const { data, error } = await this.supabase
      .from('import_files')
      .select('*, vendor:vendors(id,name,code), po:purchase_orders(id,po_number), costs:import_file_costs(*), documents:import_file_documents(*), grns:import_file_grns(*), payments:import_file_payments(*)')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async relatedByPo(tenantId: string, poId: string) {
    await this.ensureSchema();
    if (!String(poId || '').trim()) throw new BadRequestException('PO is required.');
    const { data, error } = await this.supabase
      .from('import_files')
      .select('*, vendor:vendors(id,name,code), po:purchase_orders(id,po_number), costs:import_file_costs(*), documents:import_file_documents(*), grns:import_file_grns(*), payments:import_file_payments(*)')
      .eq('tenant_id', tenantId)
      .eq('po_id', poId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async relatedByGrn(tenantId: string, grnId: string) {
    await this.ensureSchema();
    if (!String(grnId || '').trim()) throw new BadRequestException('GRN is required.');
    const { data: links, error } = await this.supabase
      .from('import_file_grns')
      .select('import_file_id')
      .eq('tenant_id', tenantId)
      .eq('grn_id', grnId);
    if (error) throw new BadRequestException(error.message);
    const ids = Array.from(new Set((links || []).map((row: any) => row.import_file_id).filter(Boolean)));
    if (!ids.length) return [];
    const { data, error: fileError } = await this.supabase
      .from('import_files')
      .select('*, vendor:vendors(id,name,code), po:purchase_orders(id,po_number), costs:import_file_costs(*), documents:import_file_documents(*), grns:import_file_grns(*), payments:import_file_payments(*)')
      .eq('tenant_id', tenantId)
      .in('id', ids)
      .order('created_at', { ascending: false });
    if (fileError) throw new BadRequestException(fileError.message);
    return data || [];
  }

  async create(tenantId: string, userId: string, body: any) {
    await this.ensureSchema();
    const vendorId = String(body.vendorId || '').trim();
    if (!vendorId) throw new BadRequestException('Select the foreign supplier.');
    const payload = {
      tenant_id: tenantId,
      import_number: await this.nextNo(tenantId),
      vendor_id: vendorId,
      po_id: this.text(body.poId),
      currency: String(body.currency || 'USD').toUpperCase(),
      customs_exchange_rate: this.num(body.customsExchangeRate) || null,
      incoterm: this.text(body.incoterm),
      shipment_reference: this.text(body.shipmentReference),
      expected_arrival_date: String(body.expectedArrivalDate || '').slice(0, 10) || null,
      port_of_entry: this.text(body.portOfEntry),
      bill_of_entry_number: this.text(body.billOfEntryNumber),
      bill_of_entry_date: String(body.billOfEntryDate || '').slice(0, 10) || null,
      commercial_invoice_number: this.text(body.commercialInvoiceNumber),
      commercial_invoice_date: String(body.commercialInvoiceDate || '').slice(0, 10) || null,
      assessable_value_inr: this.num(body.assessableValueInr),
      bcd_amount: this.num(body.bcdAmount),
      sws_amount: this.num(body.swsAmount),
      import_igst_amount: this.num(body.importIgstAmount),
      recoverable_igst: body.recoverableIgst !== false,
      notes: this.text(body.notes),
      created_by: userId,
    };
    const { data, error } = await this.supabase.from('import_files').insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.event(tenantId, data.id, 'IMPORT_FILE_CREATED', `Import file ${data.import_number} created`, userId);
    return this.one(tenantId, data.id);
  }

  async addCost(tenantId: string, id: string, userId: string, body: any) {
    await this.one(tenantId, id);
    const amount = this.num(body.inrAmount);
    const costType = String(body.costType || '').trim().toUpperCase();
    if (!costType || amount <= 0) throw new BadRequestException('Cost type and INR amount are required.');
    const { data, error } = await this.supabase.from('import_file_costs').insert({
      tenant_id: tenantId,
      import_file_id: id,
      cost_type: costType,
      supplier_id: this.text(body.supplierId),
      document_number: this.text(body.documentNumber),
      cost_date: String(body.costDate || '').slice(0, 10) || null,
      currency: String(body.currency || 'INR').toUpperCase(),
      exchange_rate: this.num(body.exchangeRate) || 1,
      foreign_amount: this.num(body.foreignAmount),
      inr_amount: amount,
      recoverable_tax_amount: this.num(body.recoverableTaxAmount),
      allocation_basis: String(body.allocationBasis || 'VALUE').toUpperCase(),
      notes: this.text(body.notes),
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.event(tenantId, id, 'INWARD_COST_ADDED', `${costType} of INR ${amount.toFixed(2)} recorded`, userId, data.id);
    await this.supabase.from('import_files').update({ status: 'LANDED_COST_PENDING', updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).neq('status', 'CLOSED');
    return this.one(tenantId, id);
  }

  async addDocument(tenantId: string, id: string, userId: string, body: any) {
    await this.one(tenantId, id);
    if (!String(body.documentType || '').trim() || !String(body.fileName || '').trim() || !String(body.fileUrl || '').trim()) {
      throw new BadRequestException('Document type, file name and storage link are required.');
    }
    const { data, error } = await this.supabase.from('import_file_documents').insert({
      tenant_id: tenantId,
      import_file_id: id,
      document_type: String(body.documentType).toUpperCase(),
      file_name: String(body.fileName),
      file_url: String(body.fileUrl),
      notes: this.text(body.notes),
      uploaded_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.event(tenantId, id, 'DOCUMENT_ADDED', `${String(body.documentType).toUpperCase()}: ${body.fileName}`, userId, data.id);
    return this.one(tenantId, id);
  }

  async linkGrn(tenantId: string, id: string, userId: string, body: any) {
    const file = await this.one(tenantId, id);
    const grnId = String(body.grnId || '').trim();
    if (!grnId) throw new BadRequestException('Select a GRN.');
    const { data: grn, error: grnError } = await this.supabase
      .from('grns')
      .select('id,grn_number,purchase_order_id')
      .eq('tenant_id', tenantId)
      .eq('id', grnId)
      .maybeSingle();
    if (grnError || !grn) throw new BadRequestException('GRN not found.');
    if (file.po_id && String(file.po_id) !== String(grn.purchase_order_id)) throw new BadRequestException('The GRN must belong to this Import File PO.');
    const alloc = this.num(body.allocatedLandedCost);
    const { data, error } = await this.supabase.from('import_file_grns').upsert({
      tenant_id: tenantId,
      import_file_id: id,
      grn_id: grnId,
      allocation_basis: String(body.allocationBasis || 'VALUE').toUpperCase(),
      allocated_landed_cost: alloc,
      status: 'PENDING_ALLOCATION',
      created_by: userId,
    }, { onConflict: 'tenant_id,import_file_id,grn_id' }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.event(tenantId, id, 'GRN_LINKED', `GRN ${grn.grn_number} linked for landed-cost allocation (${data.allocation_basis})`, userId, data.id);
    return this.one(tenantId, id);
  }

  async updateAssessment(tenantId: string, id: string, userId: string, body: any) {
    await this.ensureSchema();
    await this.one(tenantId, id);
    const headerPatch: any = {
      updated_at: new Date().toISOString(),
    };
    if (body.billOfEntryNumber !== undefined) headerPatch.bill_of_entry_number = this.text(body.billOfEntryNumber);
    if (body.billOfEntryDate !== undefined) headerPatch.bill_of_entry_date = String(body.billOfEntryDate || '').slice(0, 10) || null;
    if (body.portOfEntry !== undefined || body.portOfDischarge !== undefined) headerPatch.port_of_entry = this.text(body.portOfEntry ?? body.portOfDischarge);
    if (body.customsExchangeRate !== undefined || body.exchangeRate !== undefined) headerPatch.customs_exchange_rate = this.num(body.customsExchangeRate ?? body.exchangeRate) || null;
    if (body.commercialInvoiceNumber !== undefined) headerPatch.commercial_invoice_number = this.text(body.commercialInvoiceNumber);
    if (body.commercialInvoiceDate !== undefined) headerPatch.commercial_invoice_date = String(body.commercialInvoiceDate || '').slice(0, 10) || null;

    const lines = Array.isArray(body.lines) ? body.lines : [];
    const rows = lines.map((line: any) => {
      const assessed = this.num(line.assessedValueInr ?? line.assessed_value_inr);
      const duty = this.num(line.customsDutyAmount ?? line.customs_duty_amount);
      const cess = this.num(line.cessAmount ?? line.cess_amount);
      const gstRate = this.num(line.gstRate ?? line.gst_rate);
      const taxBase = this.num(assessed + duty + cess);
      const gst = this.num(line.gstAmount ?? line.gst_amount ?? ((taxBase * gstRate) / 100));
      return {
        tenant_id: tenantId,
        import_file_id: id,
        grn_id: this.text(line.grnId ?? line.grn_id),
        grn_item_id: this.text(line.grnItemId ?? line.grn_item_id),
        item_id: this.text(line.itemId ?? line.item_id),
        item_code: this.text(line.itemCode ?? line.item_code),
        item_name: this.text(line.itemName ?? line.item_name),
        quantity: this.num(line.quantity),
        foreign_amount: this.num(line.foreignAmount ?? line.foreign_amount),
        exchange_rate: this.num(line.exchangeRate ?? line.exchange_rate ?? body.customsExchangeRate ?? body.exchangeRate) || 1,
        assessed_value_inr: assessed,
        customs_duty_amount: duty,
        cess_amount: cess,
        gst_rate: gstRate,
        gst_amount: gst,
        total_tax_base: taxBase,
        notes: this.text(line.notes),
        created_by: userId,
        updated_at: new Date().toISOString(),
      };
    });

    const totals = rows.reduce((sum, row) => ({
      assessed: sum.assessed + Number(row.assessed_value_inr || 0),
      duty: sum.duty + Number(row.customs_duty_amount || 0),
      cess: sum.cess + Number(row.cess_amount || 0),
      gst: sum.gst + Number(row.gst_amount || 0),
    }), { assessed: 0, duty: 0, cess: 0, gst: 0 });

    headerPatch.assessable_value_inr = this.num(totals.assessed);
    headerPatch.bcd_amount = this.num(totals.duty);
    headerPatch.sws_amount = this.num(totals.cess);
    headerPatch.import_igst_amount = this.num(totals.gst);
    headerPatch.status = 'LANDED_COST_PENDING';

    const { error: fileError } = await this.supabase
      .from('import_files')
      .update(headerPatch)
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (fileError) throw new BadRequestException(fileError.message);

    const { error: deleteError } = await this.supabase
      .from('import_file_assessment_lines')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('import_file_id', id);
    if (deleteError) throw new BadRequestException(deleteError.message);
    if (rows.length) {
      const { error: insertError } = await this.supabase.from('import_file_assessment_lines').insert(rows);
      if (insertError) throw new BadRequestException(insertError.message);
    }
    await this.event(tenantId, id, 'BOE_ASSESSMENT_UPDATED', `BOE assessment updated: assessed INR ${this.num(totals.assessed).toFixed(2)}, duty INR ${this.num(totals.duty).toFixed(2)}, cess INR ${this.num(totals.cess).toFixed(2)}, GST INR ${this.num(totals.gst).toFixed(2)}`, userId);
    return this.one(tenantId, id);
  }

  async postLandedCost(tenantId: string, id: string, userId: string) {
    const file = await this.one(tenantId, id);
    if (!file.grns?.length) throw new BadRequestException('Link at least one GRN before posting landed cost.');

    const nonRecoverableDuty = this.num(Number(file.bcd_amount || 0) + Number(file.sws_amount || 0) + (file.recoverable_igst ? 0 : Number(file.import_igst_amount || 0)));
    const inwardCost = (file.costs || []).reduce((sum: number, cost: any) => sum + this.num(Number(cost.inr_amount || 0) - Number(cost.recoverable_tax_amount || 0)), 0);
    const pool = this.num(nonRecoverableDuty + inwardCost);
    if (pool <= 0) throw new BadRequestException('Record duty or inward cost before posting landed-cost allocation.');

    const allLines: any[] = [];
    for (const linked of file.grns || []) {
      const { data: lines, error } = await this.supabase
        .from('grn_items')
        .select('id,grn_id,item_id,item_code,item_name,received_qty,accepted_qty,quantity,rate,total_amount')
        .eq('tenant_id', tenantId)
        .eq('grn_id', linked.grn_id);
      if (error) throw new BadRequestException(error.message);
      for (const line of lines || []) {
        const qty = this.num(line.accepted_qty ?? line.received_qty ?? line.quantity);
        const rate = this.num(line.rate);
        const baseValue = this.num(line.total_amount || qty * rate);
        allLines.push({ ...line, import_file_grn_id: linked.id, allocation_basis: linked.allocation_basis || 'VALUE', qty, rate, baseValue });
      }
    }

    if (!allLines.length) throw new BadRequestException('Linked GRNs do not have item lines to allocate.');
    const basis = String(file.grns?.[0]?.allocation_basis || 'VALUE').toUpperCase();
    const denominator = allLines.reduce((sum, line) => sum + (basis === 'QTY' ? Math.max(0, line.qty) : Math.max(0, line.baseValue)), 0);
    if (denominator <= 0) throw new BadRequestException('GRN lines do not have quantity/value for allocation.');

    await this.supabase.from('import_file_grn_allocations').delete().eq('tenant_id', tenantId).eq('import_file_id', id);
    const rows = allLines.map((line, index) => {
      const weight = basis === 'QTY' ? line.qty : line.baseValue;
      const allocated = index === allLines.length - 1
        ? this.num(pool - allLines.slice(0, -1).reduce((s, prior) => {
          const priorWeight = basis === 'QTY' ? prior.qty : prior.baseValue;
          return s + this.num((pool * priorWeight) / denominator);
        }, 0))
        : this.num((pool * weight) / denominator);
      return {
        tenant_id: tenantId,
        import_file_id: id,
        import_file_grn_id: line.import_file_grn_id,
        grn_id: line.grn_id,
        grn_item_id: line.id,
        item_id: line.item_id || null,
        item_code: line.item_code || null,
        item_name: line.item_name || null,
        received_qty: line.qty,
        base_rate: line.rate,
        base_value: line.baseValue,
        allocated_landed_cost: allocated,
        landed_unit_cost: line.qty > 0 ? Number((allocated / line.qty).toFixed(4)) : 0,
        allocation_basis: basis,
        created_by: userId,
      };
    });
    const { error } = await this.supabase.from('import_file_grn_allocations').insert(rows);
    if (error) throw new BadRequestException(error.message);
    await this.supabase.from('import_file_grns').update({ status: 'POSTED' }).eq('tenant_id', tenantId).eq('import_file_id', id);
    await this.supabase.from('import_files').update({ status: 'LANDED_COST_POSTED', final_landed_cost: pool, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    await this.event(tenantId, id, 'LANDED_COST_POSTED', `INR ${pool.toFixed(2)} posted across ${rows.length} GRN line(s) using ${basis} basis`, userId);
    return this.one(tenantId, id);
  }

  async addPayment(tenantId: string, id: string, userId: string, body: any) {
    await this.one(tenantId, id);
    const category = String(body.paymentCategory || '').trim().toUpperCase();
    const amount = this.num(body.inrAmount);
    if (!category || amount <= 0) throw new BadRequestException('Payment category and INR amount are required.');
    const { data, error } = await this.supabase.from('import_file_payments').insert({
      tenant_id: tenantId,
      import_file_id: id,
      supplier_id: this.text(body.supplierId),
      payment_category: category,
      document_number: this.text(body.documentNumber),
      currency: String(body.currency || 'INR').toUpperCase(),
      exchange_rate: this.num(body.exchangeRate) || 1,
      foreign_amount: this.num(body.foreignAmount),
      inr_amount: amount,
      status: 'PENDING_APPROVAL',
      payment_date: String(body.paymentDate || '').slice(0, 10) || null,
      payment_reference: this.text(body.paymentReference),
      notes: this.text(body.notes),
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.event(tenantId, id, 'PAYMENT_REQUESTED', `${category} payment of INR ${amount.toFixed(2)} recorded for approval`, userId, data.id);
    return this.one(tenantId, id);
  }

  async updatePaymentStatus(tenantId: string, id: string, paymentId: string, userId: string, body: any) {
    await this.one(tenantId, id);
    const next = String(body.status || '').trim().toUpperCase();
    if (!paymentStatuses.has(next)) throw new BadRequestException('Invalid payment status.');
    const patch: any = { status: next };
    if (next === 'APPROVED') {
      patch.approved_by = userId;
      patch.approved_at = new Date().toISOString();
    }
    if (next === 'PAID') {
      patch.paid_by = userId;
      patch.paid_at = new Date().toISOString();
      patch.payment_reference = this.text(body.paymentReference) || body.paymentReference;
      patch.payment_date = String(body.paymentDate || '').slice(0, 10) || null;
    }
    if (next === 'REVERSED') {
      patch.reversed_by = userId;
      patch.reversed_at = new Date().toISOString();
      patch.reversal_reason = this.text(body.reversalReason);
    }
    const { error } = await this.supabase.from('import_file_payments').update(patch).eq('tenant_id', tenantId).eq('import_file_id', id).eq('id', paymentId);
    if (error) throw new BadRequestException(error.message);
    await this.event(tenantId, id, 'PAYMENT_STATUS_CHANGED', `Import payment moved to ${next.replaceAll('_', ' ')}`, userId, paymentId);
    return this.one(tenantId, id);
  }

  async updateStatus(tenantId: string, id: string, userId: string, status: string) {
    const next = String(status || '').toUpperCase();
    if (!statuses.has(next)) throw new BadRequestException('Invalid import status.');
    await this.one(tenantId, id);
    const { error } = await this.supabase.from('import_files').update({ status: next, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.event(tenantId, id, 'STATUS_CHANGED', `Import file moved to ${next.replaceAll('_', ' ')}`, userId);
    return this.one(tenantId, id);
  }
}
