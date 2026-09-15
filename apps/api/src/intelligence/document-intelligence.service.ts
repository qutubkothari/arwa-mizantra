import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DocumentsService } from '../documents/services/documents.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DocumentIntelligenceService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  constructor(private readonly documents: DocumentsService, private readonly audit: AuditService) {}

  private text(value: unknown) { return String(value ?? '').trim(); }
  private number(value: unknown) { const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(parsed) ? parsed : 0; }
  private userId(user: any) { return this.text(user?.userId || user?.id); }
  private roles(user: any) { return [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].map((entry: any) => this.text(typeof entry === 'string' ? entry : entry?.role?.name || entry?.name).toUpperCase().replace(/[\s-]+/g, '_')); }
  private manager(user: any) { if (!this.roles(user).some((role) => ['SUPER_ADMIN','ADMIN','ADMINISTRATOR','FINANCE_MANAGER','PURCHASE_MANAGER','CFO'].includes(role))) throw new ForbiddenException('Finance or Purchase management approval is required.'); }

  private first(data: any, keys: string[]) {
    for (const key of keys) if (data?.[key] != null && this.text(data[key])) return data[key];
    return null;
  }

  private classify(document: any, extracted: any) {
    const declared = this.text(document?.ai_classification?.documentType || document?.document_type || extracted?.documentType).toUpperCase();
    const haystack = `${declared} ${document?.title || ''} ${document?.file_name || ''} ${document?.ocr_text || ''}`.toUpperCase();
    if (/INVOICE|TAX INVOICE|BILL/.test(haystack)) return 'SUPPLIER_INVOICE';
    if (/PURCHASE.?ORDER|\bPO\b/.test(haystack)) return 'PURCHASE_ORDER';
    if (/QUOTATION|QUOTE|RFQ/.test(haystack)) return 'SUPPLIER_QUOTATION';
    if (/DELIVERY.?NOTE|CHALLAN/.test(haystack)) return 'DELIVERY_NOTE';
    if (/BANK.?STATEMENT/.test(haystack)) return 'BANK_STATEMENT';
    return declared || 'OTHER';
  }

  async list(tenantId: string) {
    const { data, error } = await this.db.from('mizantra_document_intakes').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100);
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async analyse(tenantId: string, user: any, documentId: string, request: any, body: any = {}) {
    const userId = this.userId(user); if (!userId) throw new ForbiddenException('Authenticated user is required.');
    const document: any = await this.documents.findOne(request, documentId);
    const extracted = document?.ai_extracted_data && typeof document.ai_extracted_data === 'object' ? document.ai_extracted_data : (body?.extracted_data && typeof body.extracted_data === 'object' ? body.extracted_data : {});
    const documentType = this.classify(document, extracted);
    const confidence = Math.max(0, Math.min(1, this.number(document?.ai_classification?.confidence || body?.classification_confidence || (Object.keys(extracted).length ? 0.7 : 0.3))));
    const invoiceNumber = this.text(this.first(extracted, ['invoiceNumber','invoice_number','documentNumber','document_number','billNumber','bill_number']) || document?.document_number);
    const poNumber = this.text(this.first(extracted, ['purchaseOrderNumber','purchase_order_number','poNumber','po_number','poReference','po_reference']));
    const vendorName = this.text(this.first(extracted, ['vendor','vendorName','vendor_name','supplier','supplierName','supplier_name']));
    const total = this.number(this.first(extracted, ['grandTotal','grand_total','netAmount','net_amount','totalAmount','total_amount','amount']));
    const tax = this.number(this.first(extracted, ['taxAmount','tax_amount','gstAmount','gst_amount','vatAmount','vat_amount']));
    const freight = this.number(this.first(extracted, ['freight','freightAmount','freight_amount']));
    const tolerancePct = Math.min(Math.max(this.number(body?.amount_tolerance_pct || 1), 0), 10);

    let vendor: any = null, po: any = null; let grns: any[] = [];
    if (vendorName) {
      const result = await this.db.from('vendors').select('id,code,name').eq('tenant_id', tenantId).ilike('name', vendorName).limit(2);
      if (!result.error && result.data?.length === 1) vendor = result.data[0];
    }
    if (poNumber) {
      const result = await this.db.from('purchase_orders').select('*').eq('tenant_id', tenantId).eq('po_number', poNumber).maybeSingle();
      if (!result.error) po = result.data;
    }
    if (po?.id) {
      const result = await this.db.from('grns').select('*').eq('tenant_id', tenantId).eq('po_id', po.id).neq('status', 'CANCELLED');
      if (!result.error) grns = result.data || [];
    }

    const exceptions: any[] = [];
    if (!Object.keys(extracted).length) exceptions.push({ code: 'NO_STRUCTURED_EXTRACTION', severity: 'HIGH', message: 'Run document OCR/analysis or provide reviewed extracted fields.' });
    if (documentType === 'SUPPLIER_INVOICE' && !invoiceNumber) exceptions.push({ code: 'MISSING_INVOICE_NUMBER', severity: 'HIGH', message: 'Supplier invoice number is required.' });
    if (documentType === 'SUPPLIER_INVOICE' && !po) exceptions.push({ code: 'PO_NOT_MATCHED', severity: 'HIGH', message: poNumber ? `No tenant PO matched ${poNumber}.` : 'No purchase-order reference was extracted.' });
    if (vendorName && !vendor) exceptions.push({ code: 'VENDOR_NOT_MATCHED', severity: 'HIGH', message: `No unique approved supplier matched ${vendorName}.` });
    if (po && vendor && String(po.vendor_id) !== String(vendor.id)) exceptions.push({ code: 'VENDOR_PO_MISMATCH', severity: 'HIGH', message: 'The extracted supplier does not match the PO supplier.' });
    if (po && total > 0) {
      const poTotal = this.number(po.grand_total || po.total_amount); const allowed = Math.max(0.01, poTotal * tolerancePct / 100); const variance = total - poTotal;
      if (Math.abs(variance) > allowed) exceptions.push({ code: 'PO_AMOUNT_VARIANCE', severity: 'HIGH', message: `Invoice total differs from PO total by ${variance.toFixed(2)} (tolerance ${tolerancePct}%).`, expected: poTotal, actual: total });
    }
    if (po && documentType === 'SUPPLIER_INVOICE' && !grns.length) exceptions.push({ code: 'GRN_NOT_FOUND', severity: 'HIGH', message: 'No active GRN exists for the matched PO; three-way match cannot complete.' });
    const { data: duplicate } = invoiceNumber ? await this.db.from('mizantra_document_intakes').select('id,document_id,status').eq('tenant_id', tenantId).neq('document_id', documentId).contains('extracted_data', { invoice_number_normalized: invoiceNumber.toUpperCase() }).limit(1).maybeSingle() : { data: null } as any;
    if (duplicate) exceptions.push({ code: 'DUPLICATE_INVOICE', severity: 'CRITICAL', message: 'This supplier invoice number was already analysed.', intake_id: duplicate.id });

    const normalized = { ...extracted, invoice_number_normalized: invoiceNumber.toUpperCase() || null, po_number_normalized: poNumber.toUpperCase() || null, vendor_name_normalized: vendorName || null, total_amount_normalized: total, tax_amount_normalized: tax, freight_amount_normalized: freight };
    const matchResult = { document_type: documentType, invoice_number: invoiceNumber || null, purchase_order_number: po?.po_number || poNumber || null, vendor: vendor ? { id: vendor.id, code: vendor.code, name: vendor.name } : null, purchase_order_total: po ? this.number(po.grand_total || po.total_amount) : null, document_total: total || null, grn_count: grns.length, amount_tolerance_pct: tolerancePct, three_way_match_ready: !!po && grns.length > 0 && !exceptions.some((entry) => ['VENDOR_PO_MISMATCH','PO_AMOUNT_VARIANCE','DUPLICATE_INVOICE'].includes(entry.code)) };
    const status = exceptions.length ? 'REVIEW_REQUIRED' : 'VALIDATED';
    const { data, error } = await this.db.from('mizantra_document_intakes').upsert({ tenant_id: tenantId, document_id: documentId, document_type: documentType, classification_confidence: confidence, extracted_data: normalized, matched_vendor_id: vendor?.id || null, matched_purchase_order_id: po?.id || null, matched_grn_ids: grns.map((row) => row.id), match_result: matchResult, exceptions, status, created_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,document_id' }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.audit.logActivity({ tenantId, userId, action: 'DOCUMENT_INTELLIGENCE_ANALYSED', resourceType: 'MIZANTRA_DOCUMENT_INTAKE', resourceId: data.id, resourceCode: invoiceNumber || documentId, newValue: { status, document_type: documentType, match_result: matchResult, exceptions }, metadata: { source_document_id: documentId } });
    return { intake: data, document: { id: document.id, title: document.title, file_name: document.file_name }, match: matchResult, exceptions, control: 'No inventory, AP or GL entry was posted. A validated intake still requires independent approval and native draft creation.' };
  }

  async approve(tenantId: string, user: any, id: string) {
    this.manager(user); const userId = this.userId(user);
    const { data: intake } = await this.db.from('mizantra_document_intakes').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!intake) throw new BadRequestException('Document intake not found.');
    if (intake.created_by === userId) throw new ForbiddenException('Maker-checker prevents self-approval of extracted document data.');
    if (intake.status !== 'VALIDATED' || (intake.exceptions || []).length) throw new BadRequestException('Resolve every matching exception before approval.');
    const { data, error } = await this.db.from('mizantra_document_intakes').update({ status: 'DRAFT_READY', approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).eq('status', 'VALIDATED').select().single();
    if (error) throw new BadRequestException(error.message);
    await this.audit.logActivity({ tenantId, userId, action: 'DOCUMENT_INTELLIGENCE_APPROVED', resourceType: 'MIZANTRA_DOCUMENT_INTAKE', resourceId: id, oldValue: { status: intake.status }, newValue: { status: data.status }, metadata: { source_document_id: intake.document_id, matched_purchase_order_id: intake.matched_purchase_order_id } });
    return { intake: data, next_step: 'Open the matched PO/GRN and create the native supplier-invoice draft. Posting remains prohibited until normal finance approval.' };
  }
}
