import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmailService } from '../../email/email.service';
import { allocatePoSettlement } from '../utils/po-settlement';
import { derivePayableDueDate } from '../utils/payable-due-date';

function formatShortDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(2);
  return `${day}/${month}/${year}`;
}

@Injectable()
export class DebitNoteService {
  private supabase: SupabaseClient;

  constructor(private emailService: EmailService) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  // Get all debit notes for tenant
  async findAll(tenantId: string, filters?: any) {
    let query = this.supabase
      .from('debit_notes')
      .select(`
        *,
        grn:grns(id, grn_number),
        vendor:vendors(id, name, code)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  // Get single debit note with details
  async findOne(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('debit_notes')
      .select(`
        *,
        grn:grns(id, grn_number, receipt_date),
        vendor:vendors(id, name, code, contact_person, email),
        debit_note_items(
          *,
          item:items(id, code, name, uom)
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching debit note:', error);
      throw new NotFoundException('Debit note not found');
    }
    
    console.log('Debit note data:', JSON.stringify(data, null, 2));
    return data;
  }

  // Approve debit note
  async approve(tenantId: string, id: string, userId: string, options: { overrideMakerChecker?: boolean } = {}) {
    const { data: existing, error: fetchError } = await this.supabase
      .from('debit_notes')
      .select('id, debit_note_number, status, created_by')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) throw new NotFoundException('Debit note not found');
    if (!options.overrideMakerChecker && existing.created_by && existing.created_by === userId) {
      throw new ForbiddenException('Creator cannot approve their own debit note');
    }
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(`Only draft debit notes can be approved. Current status: ${existing.status}`);
    }

    const { data, error } = await this.supabase
      .from('debit_notes')
      .update({
        status: 'APPROVED',
        approved_by: userId,
        approval_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log(`Debit note ${data.debit_note_number} approved by user ${userId}`);
    
    // Trigger will automatically update GRN net_payable_amount
    return data;
  }

  // Update debit note status
  async updateStatus(tenantId: string, id: string, status: string) {
    const validStatuses = ['DRAFT', 'APPROVED', 'SENT', 'ACKNOWLEDGED', 'CLOSED'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const { data, error } = await this.supabase
      .from('debit_notes')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Update return status for debit note item
  async updateReturnStatus(
    tenantId: string,
    debitNoteId: string,
    itemId: string,
    returnStatus: string,
    disposalNotes?: string,
  ) {
    const validStatuses = ['PENDING', 'RETURNED', 'DESTROYED', 'REWORKED'];
    if (!validStatuses.includes(returnStatus)) {
      throw new Error(`Invalid return status: ${returnStatus}`);
    }

    const { data, error } = await this.supabase
      .from('debit_note_items')
      .update({
        return_status: returnStatus,
        return_date: returnStatus !== 'PENDING' ? new Date().toISOString().split('T')[0] : null,
        disposal_notes: disposalNotes || null,
      })
      .eq('debit_note_id', debitNoteId)
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw error;
    
    // Also update grn_items return_status
    if (data.grn_item_id) {
      await this.supabase
        .from('grn_items')
        .update({ return_status: returnStatus })
        .eq('id', data.grn_item_id);
    }

    return data;
  }

  // Create manual debit note (not from QC)
  async create(tenantId: string, userId: string, data: any) {
    // Generate debit note number
    const { data: dnNumber } = await this.supabase
      .rpc('generate_debit_note_number', { p_tenant_id: tenantId });

    // Calculate GST - preserve 0% GST (don't default to 18% when gst_percentage is 0)
    const gstPercentage = data.gst_percentage !== undefined && data.gst_percentage !== null ? data.gst_percentage : 18;
    const grossAmount = data.gross_amount || data.total_amount || 0;
    const taxAmount = Math.round(grossAmount * (gstPercentage / 100) * 100) / 100;
    const totalAmount = grossAmount + taxAmount;

    // Create debit note
    const { data: debitNote, error: dnError } = await this.supabase
      .from('debit_notes')
      .insert({
        tenant_id: tenantId,
        debit_note_number: dnNumber || `DN-${Date.now()}`,
        grn_id: data.grn_id,
        vendor_id: data.vendor_id,
        gross_amount: grossAmount,
        gst_percentage: gstPercentage,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        reason: data.reason,
        notes: data.notes,
        status: 'DRAFT',
        created_by: userId,
      })
      .select()
      .single();

    if (dnError) throw dnError;

    // Create items if provided
    if (data.items && data.items.length > 0) {
      const items = data.items.map((item: any) => {
        const itemGrossAmount = item.amount || (item.rejected_qty * item.unit_price);
        const itemTaxAmount = Math.round(itemGrossAmount * (gstPercentage / 100) * 100) / 100;
        return {
          debit_note_id: debitNote.id,
          grn_item_id: item.grn_item_id,
          item_id: item.item_id,
          rejected_qty: item.rejected_qty,
          unit_price: item.unit_price,
          amount: itemGrossAmount,
          gst_percentage: gstPercentage,
          tax_amount: itemTaxAmount,
          rejection_reason: item.rejection_reason,
          return_status: 'PENDING',
        };
      });

      await this.supabase.from('debit_note_items').insert(items);
    }

    return debitNote;
  }

  // Get debit notes by GRN
  async findByGrn(tenantId: string, grnId: string) {
    const { data, error } = await this.supabase
      .from('debit_notes')
      .select(`
        *,
        debit_note_items(
          *,
          item:items(code, name, unit)
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('grn_id', grnId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  // Helper: compute outstanding balance for a GRN row
  private grnOutstanding(grn: any): number {
    const gross = parseFloat(grn.gross_amount || 0);
    const tax = parseFloat(grn.tax_amount || 0);
    const debit = parseFloat(grn.debit_note_amount || 0);
    const netPayable = grn.net_payable_amount != null
      ? parseFloat(grn.net_payable_amount)
      : gross + tax - debit;
    const paid = parseFloat(grn.paid_amount || 0);
    return Math.max(0, netPayable - paid);
  }

  private isAdvanceEntry(entry: any) {
    return ['ADVANCE', 'ADVANCE_APPLIED', 'VENDOR_ADVANCE'].includes(String(entry?.entry_type || '').toUpperCase());
  }

  private isSchemaMismatchError(error: any, columns: string[]) {
    const message = String(error?.message || error?.details || error?.hint || '');
    return error?.code === 'PGRST204'
      || error?.code === '42703'
      || columns.some((column) => message.toLowerCase().includes(column.toLowerCase()));
  }

  private normalizePaymentMethod(method?: string | null) {
    const normalized = String(method || 'NEFT').trim().toUpperCase();
    const aliases: Record<string, string> = {
      BANK: 'BANK_TRANSFER',
      TRANSFER: 'BANK_TRANSFER',
      BANKTRANSFER: 'BANK_TRANSFER',
      BANK_TRANSFER: 'BANK_TRANSFER',
    };
    return aliases[normalized] || normalized || 'NEFT';
  }

  private async insertGrnPaymentEntry(tenantId: string, grnId: string, payload: Record<string, any>) {
    const insertPayload = {
      tenant_id: tenantId,
      grn_id: grnId,
      ...payload,
      payment_method: this.normalizePaymentMethod(payload.payment_method),
    };

    const { error } = await this.supabase
      .from('grn_payment_entries')
      .insert(insertPayload);

    if (!error) return;

    if (this.isSchemaMismatchError(error, ['entry_type', 'short_payment_reason'])) {
      const legacyPayload = { ...insertPayload };
      delete legacyPayload.entry_type;
      if (!legacyPayload.short_payment_reason) {
        delete legacyPayload.short_payment_reason;
      }

      const { error: legacyError } = await this.supabase
        .from('grn_payment_entries')
        .insert(legacyPayload);

      if (!legacyError) return;
      if (this.isSchemaMismatchError(legacyError, ['short_payment_reason'])) {
        const noReasonPayload = { ...legacyPayload };
        const shortReason = String(noReasonPayload.short_payment_reason || '').trim();
        delete noReasonPayload.short_payment_reason;
        if (shortReason) {
          const existingNotes = String(noReasonPayload.payment_notes || '').trim();
          noReasonPayload.payment_notes = existingNotes
            ? `${existingNotes}\nShort payment reason: ${shortReason}`
            : `Short payment reason: ${shortReason}`;
        }

        const { error: noReasonError } = await this.supabase
          .from('grn_payment_entries')
          .insert(noReasonPayload);

        if (!noReasonError) return;
        throw new Error(`Failed to insert payment entry: ${noReasonError.message}`);
      }
      throw new Error(`Failed to insert payment entry: ${legacyError.message}`);
    }

    if (error?.code === '23514' && String(error.message || '').toLowerCase().includes('payment_method')) {
      const bankTransferPayload = {
        ...insertPayload,
        payment_method: 'BANK_TRANSFER',
      };
      const { error: bankTransferError } = await this.supabase
        .from('grn_payment_entries')
        .insert(bankTransferPayload);

      if (!bankTransferError) return;
      throw new Error(`Failed to insert payment entry: ${bankTransferError.message}`);
    }

    throw new Error(`Failed to insert payment entry: ${error.message}`);
  }

  private async fetchGrnPaymentEntryTotals(tenantId: string, grnId: string) {
    const withEntryType = await this.supabase
      .from('grn_payment_entries')
      .select('amount, tds_amount, short_payment_amount, entry_type, payment_date, payment_method, payment_reference, payment_notes, created_at')
      .eq('grn_id', grnId)
      .eq('tenant_id', tenantId);

    if (!withEntryType.error) return withEntryType.data || [];

    if (!this.isSchemaMismatchError(withEntryType.error, ['entry_type'])) {
      throw new Error(`Failed to fetch entries: ${withEntryType.error.message}`);
    }

    const legacy = await this.supabase
      .from('grn_payment_entries')
      .select('amount, tds_amount, short_payment_amount, payment_date, payment_method, payment_reference, payment_notes, created_at')
      .eq('grn_id', grnId)
      .eq('tenant_id', tenantId);

    if (legacy.error) throw new Error(`Failed to fetch entries: ${legacy.error.message}`);
    return (legacy.data || []).map((entry: any) => ({ ...entry, entry_type: 'PAYMENT' }));
  }

  private latestPaymentMetadata(entries: any[]) {
    const payments = (entries || [])
      .filter((entry: any) => !this.isAdvanceEntry(entry))
      .sort((left: any, right: any) => {
        const dateOrder = String(left.payment_date || '').localeCompare(String(right.payment_date || ''));
        if (dateOrder !== 0) return dateOrder;
        return String(left.created_at || '').localeCompare(String(right.created_at || ''));
      });

    const latest = payments[payments.length - 1];
    if (!latest) return {};

    return {
      payment_date: latest.payment_date || null,
      payment_method: latest.payment_method || null,
      payment_reference: latest.payment_reference || null,
      payment_notes: latest.payment_notes || null,
    };
  }

  private async fetchGrnForPayment(tenantId: string, grnId: string) {
    const full = await this.supabase
      .from('grns')
      .select('id, po_id, vendor_id, status, invoice_approved, gross_amount, tax_amount, debit_note_amount, net_payable_amount, paid_amount, tds_amount, short_payment_amount, payment_status')
      .eq('id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!full.error) return full.data;

    if (!this.isSchemaMismatchError(full.error, ['tds_amount', 'short_payment_amount', 'payment_status', 'paid_amount'])) {
      throw new Error(`Database error: ${full.error.message}`);
    }

    const legacy = await this.supabase
      .from('grns')
      .select('id, po_id, vendor_id, status, invoice_approved, gross_amount, tax_amount, debit_note_amount, net_payable_amount')
      .eq('id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (legacy.error) throw new Error(`Database error: ${legacy.error.message}`);
    if (!legacy.data) return null;

    return {
      ...legacy.data,
      paid_amount: 0,
      tds_amount: 0,
      short_payment_amount: 0,
      payment_status: 'UNPAID',
    };
  }

  private async updateGrnPaymentAggregate(tenantId: string, grnId: string, payload: Record<string, any>) {
    const full = await this.supabase
      .from('grns')
      .update(payload)
      .eq('id', grnId)
      .eq('tenant_id', tenantId);

    if (!full.error) return;

    if (!this.isSchemaMismatchError(full.error, ['payment_method', 'payment_reference', 'payment_date', 'payment_notes'])) {
      throw new Error(`Failed to update GRN: ${full.error.message}`);
    }

    const aggregateOnly = {
      paid_amount: payload.paid_amount,
      tds_amount: payload.tds_amount,
      short_payment_amount: payload.short_payment_amount,
      payment_status: payload.payment_status,
    };

    const aggregate = await this.supabase
      .from('grns')
      .update(aggregateOnly)
      .eq('id', grnId)
      .eq('tenant_id', tenantId);

    if (!aggregate.error) return;

    if (!this.isSchemaMismatchError(aggregate.error, ['tds_amount', 'short_payment_amount'])) {
      throw new Error(`Failed to update GRN: ${aggregate.error.message}`);
    }

    const legacy = await this.supabase
      .from('grns')
      .update({
        paid_amount: payload.paid_amount,
        payment_status: payload.payment_status,
      })
      .eq('id', grnId)
      .eq('tenant_id', tenantId);

    if (legacy.error) throw new Error(`Failed to update GRN: ${legacy.error.message}`);
  }

  private validateSettlementInput(amount: number, tdsAmount: number, shortAmount: number, shortReason?: string, advanceAmount = 0) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Payment amount cannot be negative');
    }

    if (!Number.isFinite(tdsAmount) || tdsAmount < 0) {
      throw new BadRequestException('TDS amount cannot be negative');
    }

    if (!Number.isFinite(shortAmount) || shortAmount < 0) {
      throw new BadRequestException('Short payment amount cannot be negative');
    }

    if (!Number.isFinite(advanceAmount) || advanceAmount < 0) {
      throw new BadRequestException('Advance adjustment cannot be negative');
    }

    if (amount + tdsAmount + shortAmount + advanceAmount <= 0) {
      throw new BadRequestException('Settlement amount must be greater than 0');
    }

    if (shortAmount > 0 && !String(shortReason || '').trim()) {
      throw new BadRequestException('Short payment reason is required');
    }
  }

  // Get vendor-wise payables summary (only GRNs with outstanding balance)
  async getVendorPayables(tenantId: string) {
    const { data: grnsData, error: grnsError } = await this.supabase
      .from('grns')
      .select('id, vendor_id, po_id, status, gross_amount, tax_amount, debit_note_amount, net_payable_amount, paid_amount, tds_amount, short_payment_amount, payment_status, invoice_number')
      .eq('tenant_id', tenantId)
      .not('status', 'in', '("REJECTED","CANCELLED")')
      .not('status', 'eq', 'DRAFT');

    if (grnsError) {
      console.error('[AP] getVendorPayables grnsError:', grnsError);
      throw grnsError;
    }
    const [subcontractPayables, settlementByGrn] = await Promise.all([
      this.getSubcontractPayableRows(tenantId),
      this.getSettlementByGrnForRows(tenantId, grnsData || []),
    ]);

    // Calculate outstanding including PO advances
    const grnsWithOutstanding = (grnsData || []).map((grn: any) => {
      const gross = parseFloat(grn.gross_amount || 0);
      const tax = parseFloat(grn.tax_amount || 0);
      const debit = parseFloat(grn.debit_note_amount || 0);
      const netPayable = grn.net_payable_amount != null
        ? parseFloat(grn.net_payable_amount)
        : gross + tax - debit;
      const allocated = settlementByGrn.get(grn.id);
      const paid = allocated?.cashPaid ?? parseFloat(grn.paid_amount || 0);
      const tds = allocated?.tds ?? parseFloat(grn.tds_amount || 0);
      const shortPayment = allocated?.shortPayment ?? parseFloat(grn.short_payment_amount || 0);
      const poAdvance = allocated?.advanceApplied ?? 0;
      const totalPaid = allocated?.totalSettled ?? paid + tds + shortPayment + poAdvance;
      const outstanding = allocated?.outstanding ?? Math.max(0, netPayable - totalPaid);
      
      return { ...grn, _outstanding: outstanding, _totalPaid: totalPaid, _poAdvance: poAdvance };
    });

    // Keep only GRNs with an outstanding balance — invoice_approved filter is applied client-side
    const outstandingGrns = grnsWithOutstanding.filter((grn: any) => grn._outstanding > 0.009);
    const vendorIds = [
      ...new Set([
        ...outstandingGrns.map((grn: any) => grn.vendor_id).filter(Boolean),
        ...subcontractPayables.map((row: any) => row.vendor_id).filter(Boolean),
      ]),
    ];
    if (vendorIds.length === 0) return [];

    const { data: vendorsData, error: vendorsError } = await this.supabase
      .from('vendors')
      .select('id, name, code')
      .eq('tenant_id', tenantId)
      .in('id', vendorIds);

    if (vendorsError) throw vendorsError;

    const vendorMap = new Map();
    vendorsData?.forEach((vendor: any) => {
      vendorMap.set(vendor.id, {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        vendor_code: vendor.code,
        total_gross: 0,
        total_debit: 0,
        total_payable: 0,
        total_paid: 0,
        total_outstanding: 0,
        grn_count: 0,
      });
    });

    outstandingGrns.forEach((grn: any) => {
      const vendor = vendorMap.get(grn.vendor_id);
      if (!vendor) return;
      const gross = parseFloat(grn.gross_amount || 0);
      const tax = parseFloat(grn.tax_amount || 0);
      const debit = parseFloat(grn.debit_note_amount || 0);
      const netPayable = grn.net_payable_amount != null
        ? parseFloat(grn.net_payable_amount)
        : gross + tax - debit;
      vendor.total_gross += gross;
      vendor.total_debit += debit;
      vendor.total_payable += netPayable;
      vendor.total_paid += grn._totalPaid;
      vendor.total_outstanding += grn._outstanding;
      vendor.grn_count += 1;
    });

    subcontractPayables.forEach((row: any) => {
      const vendor = vendorMap.get(row.vendor_id);
      if (!vendor) return;
      vendor.total_gross += row.gross_amount;
      vendor.total_debit += 0;
      vendor.total_payable += row.net_payable_amount;
      vendor.total_paid += row.paid_amount;
      vendor.total_outstanding += row.outstanding_amount;
      vendor.grn_count += 1;
      vendor.subcontract_count = (vendor.subcontract_count || 0) + 1;
    });

    return Array.from(vendorMap.values()).filter((v: any) => v.total_outstanding > 0.009);
  }

  private async getSubcontractPayableRows(tenantId: string, vendorId?: string) {
    let query = this.supabase
      .from('subcontract_order_steps')
      .select('id, order_id, operation_name, vendor_id, processing_amount, tax_amount, deduction_amount, payable_amount, paid_amount, invoice_number, invoice_date, invoice_status, received_at, order:subcontract_orders(id, order_number)')
      .eq('tenant_id', tenantId)
      .gt('payable_amount', 0)
      // Subcontracting follows the same AP gate as purchase GRNs: QC and
      // invoice matching must be complete before a liability enters Payables.
      .in('invoice_status', ['INVOICE_RECEIVED', 'PENDING_PAYMENT', 'PAID']);

    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[AP] subcontract payable fetch error:', error.message);
      return [];
    }

    return (data || [])
      .map((row: any) => {
        const payable = parseFloat(row.payable_amount || 0);
        const paid = parseFloat(row.paid_amount || 0);
        const outstanding = Math.max(0, payable - paid);
        return {
          id: `subcontract:${row.id}`,
          source_type: 'SUBCONTRACT',
          source_id: row.id,
          vendor_id: row.vendor_id,
          grn_number: row.order?.order_number || 'Subcontract',
          invoice_number: row.invoice_number || `${row.order?.order_number || 'Subcontract'} / ${row.operation_name || 'Operation'}`,
          invoice_date: row.invoice_date || row.received_at || null,
          receipt_date: row.received_at || row.invoice_date || null,
          status: 'COMPLETED',
          invoice_approved: true,
          gross_amount: parseFloat(row.processing_amount || 0),
          tax_amount: parseFloat(row.tax_amount || 0),
          debit_note_amount: parseFloat(row.deduction_amount || 0),
          net_payable_amount: payable,
          paid_amount: paid,
          tds_amount: 0,
          short_payment_amount: 0,
          payment_status: outstanding <= 0.009 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID',
          outstanding_amount: outstanding,
          net: payable,
          settled: paid,
          purchase_order: {
            id: row.order_id,
            po_number: row.order?.order_number || 'Subcontract',
          },
        };
      })
      .filter((row: any) => row.vendor_id && row.outstanding_amount > 0.009);
  }

  // Send debit note email to supplier
  async sendEmail(tenantId: string, id: string) {
    // Get full debit note details
    const debitNote = await this.findOne(tenantId, id);

    if (!debitNote.vendor?.email) {
      throw new Error('Vendor email not found');
    }

    // Prepare email content
    const subject = `Debit Note ${debitNote.debit_note_number} - Material Rejection`;
    
    let itemsHtml = '';
    let subtotal = 0;
    debitNote.debit_note_items?.forEach((item: any) => {
      const itemAmount = parseFloat(item.amount || 0);
      const itemTax = parseFloat(item.tax_amount || 0);
      const itemTotal = itemAmount + itemTax;
      subtotal += itemAmount;
      
      itemsHtml += `
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px;">${item.item.name} (${item.item.code})</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${item.rejected_qty} ${item.item.unit}</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${item.unit_price.toFixed(2)}</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${itemAmount.toFixed(2)}</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${item.gst_percentage ?? debitNote.gst_percentage ?? 18}%</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${itemTax.toFixed(2)}</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: bold;">₹${itemTotal.toFixed(2)}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${item.rejection_reason}</td>
        </tr>
      `;
    });

    const grossAmount = parseFloat(debitNote.gross_amount || subtotal);
    const taxAmount = parseFloat(debitNote.tax_amount || 0);
    const totalAmount = parseFloat(debitNote.total_amount || (grossAmount + taxAmount));

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background: #f8f9fa; padding: 20px; border-bottom: 3px solid #dc3545; }
          .content { padding: 20px; }
          .footer { background: #f8f9fa; padding: 15px; margin-top: 30px; border-top: 2px solid #ddd; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #dc3545; color: white; padding: 10px; text-align: left; }
          .summary { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
          .total { font-size: 1.2em; font-weight: bold; color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0; color: #dc3545;">Debit Note</h1>
          <p style="margin: 5px 0 0 0; font-size: 1.1em;">${debitNote.debit_note_number}</p>
        </div>
        
        <div class="content">
          <p>Dear ${debitNote.vendor.name},</p>
          
          <p>Please find below the details of Debit Note <strong>${debitNote.debit_note_number}</strong> 
          issued for rejected materials from GRN <strong>${debitNote.grn.grn_number}</strong>.</p>
          
          <div class="summary">
            <strong>Summary:</strong><br>
            Date: ${formatShortDate(debitNote.debit_note_date)}<br>
            GRN Reference: ${debitNote.grn.grn_number}<br>
            Reason: ${debitNote.reason}
          </div>
          
          <h3>Rejected Items:</h3>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align: right;">Rejected Qty</th>
                <th style="text-align: right;">Unit Price</th>
                <th style="text-align: right;">Amount</th>
                <th style="text-align: right;">GST %</th>
                <th style="text-align: right;">Tax Amount</th>
                <th style="text-align: right;">Total</th>
                <th>Rejection Reason</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: bold;">
                  Subtotal (Before Tax):
                </td>
                <td colspan="5" style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">
                  ₹${grossAmount.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td colspan="3" style="border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: bold;">
                  GST (${debitNote.gst_percentage ?? 18}%):
                </td>
                <td colspan="5" style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">
                  ₹${taxAmount.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td colspan="3" style="border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: bold; background: #f8f9fa;">
                  Total Debit Amount:
                </td>
                <td colspan="5" class="total" style="border: 1px solid #ddd; padding: 8px; background: #f8f9fa;">
                  ₹${totalAmount.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
          
          <div style="background: #e7f3ff; padding: 15px; border-left: 4px solid #0066cc; margin: 20px 0;">
            <strong>Action Required:</strong><br>
            This amount of <strong>₹${totalAmount.toFixed(2)}</strong> (including GST) will be deducted from your next payment.
            Please arrange for the collection or replacement of rejected materials at your earliest convenience.
          </div>
          
          ${debitNote.notes ? `<p><strong>Additional Notes:</strong><br>${debitNote.notes}</p>` : ''}
          
          <p>If you have any questions regarding this debit note, please contact us immediately.</p>
        </div>
        
        <div class="footer">
          <p style="margin: 0; font-size: 0.9em; color: #666;">
            This is an automated message. Please do not reply directly to this email.
          </p>
        </div>
      </body>
      </html>
    `;

    // Send email
    await this.emailService.sendEmail({
      to: debitNote.vendor.email,
      subject,
      html: htmlContent,
      tenantId: tenantId,
    });

    // Update debit note status to SENT
    await this.updateStatus(tenantId, id, 'SENT');

    console.log(`Debit note ${debitNote.debit_note_number} emailed to ${debitNote.vendor.email}`);

    return { message: 'Debit note sent successfully' };
  }

  // Record a payment entry against a GRN (supports multiple partial payments)
  async recordPayment(
    tenantId: string,
    grnId: string,
    paymentData: {
      amount: number;
      payment_method: string;
      payment_reference?: string;
      payment_date?: string;
      payment_notes?: string;
      tds_amount?: number;
      short_payment_amount?: number;
      short_payment_reason?: string;
      advance_adjustment_amount?: number;
      close_invoice?: boolean;
      created_by?: string;
    },
  ) {
    // Fetch GRN — look across all statuses (not just COMPLETED) to avoid false 404
    const grn = await this.fetchGrnForPayment(tenantId, grnId);
    if (!grn) throw new NotFoundException(`GRN not found (id: ${grnId})`);

    if (String(grn.status || '').toUpperCase() !== 'COMPLETED') {
      throw new BadRequestException('Only completed GRNs can be paid');
    }

    if (!grn.invoice_approved) {
      throw new BadRequestException('Supplier invoice must be sanctioned before payment');
    }

    // Compute effective net payable (fallback if column is null)
    const gross = parseFloat(grn.gross_amount || 0);
    const tax = parseFloat(grn.tax_amount || 0);
    const debit = parseFloat(grn.debit_note_amount || 0);
    const netPayable = grn.net_payable_amount != null
      ? parseFloat(grn.net_payable_amount)
      : gross + tax - debit;

    const tdsAmount = parseFloat(String(paymentData.tds_amount || 0));
    const shortAmount = parseFloat(String(paymentData.short_payment_amount || 0));
    const entryAmount = parseFloat(String(paymentData.amount || 0));
    const advanceAmount = parseFloat(String(paymentData.advance_adjustment_amount || 0));
    this.validateSettlementInput(entryAmount, tdsAmount, shortAmount, paymentData.short_payment_reason, advanceAmount);

    const poSettlement = grn.po_id ? await this.getPoSettlement(tenantId, grn.po_id) : null;
    const allocatedInvoice = poSettlement?.invoices.find((invoice: any) => invoice.grn_id === grnId)?.settlement;
    const outstanding = allocatedInvoice
      ? Number(allocatedInvoice.outstanding || 0)
      : Math.max(0, netPayable - Number(grn.paid_amount || 0) - Number(grn.tds_amount || 0) - Number(grn.short_payment_amount || 0));
    console.log('[recordPayment]', { grnId, netPayable, outstanding, advanceApplied: allocatedInvoice?.advanceApplied || 0, advanceRequested: advanceAmount });

    const requestedSettlement = entryAmount + tdsAmount + shortAmount + advanceAmount;
    if (requestedSettlement > outstanding + 0.009) {
      throw new BadRequestException(
        `Total settlement (Rs. ${requestedSettlement.toFixed(2)}) exceeds outstanding balance (Rs. ${outstanding.toFixed(2)})`,
      );
    }

    if (paymentData.close_invoice && requestedSettlement < outstanding - 0.009) {
      throw new BadRequestException('Short payment amount must cover the remaining balance before closing the invoice');
    }

    const paymentDate = paymentData.payment_date || new Date().toISOString().split('T')[0];
    const cashSettlement = entryAmount + tdsAmount + shortAmount;
    if (cashSettlement > 0) {
      await this.insertGrnPaymentEntry(tenantId, grnId, {
        payment_date: paymentDate,
        amount: entryAmount,
        payment_method: paymentData.payment_method,
        payment_reference: paymentData.payment_reference || null,
        tds_amount: tdsAmount,
        short_payment_amount: shortAmount,
        short_payment_reason: paymentData.short_payment_reason || null,
        payment_notes: paymentData.payment_notes || null,
        entry_type: 'PAYMENT',
        created_by: paymentData.created_by || null,
      });
    }

    if (advanceAmount > 0) {
      await this.applyAdvanceAdjustmentToGrn(
        tenantId,
        grn,
        advanceAmount,
        paymentDate,
        paymentData.payment_notes,
        paymentData.created_by,
      );
    }

    // Recalculate aggregates from all entries
    const allEntries = await this.fetchGrnPaymentEntryTotals(tenantId, grnId);

    const totalPaid = (allEntries || []).reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? 0 : parseFloat(e.amount || 0)), 0);
    const totalAdvance = (allEntries || []).reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? parseFloat(e.amount || 0) : 0), 0);
    const totalTds = (allEntries || []).reduce((s: number, e: any) => s + parseFloat(e.tds_amount || 0), 0);
    const totalShort = (allEntries || []).reduce((s: number, e: any) => s + parseFloat(e.short_payment_amount || 0), 0);
    const refreshedPoSettlement = grn.po_id ? await this.getPoSettlement(tenantId, grn.po_id) : null;
    const refreshedInvoice = refreshedPoSettlement?.invoices.find((invoice: any) => invoice.grn_id === grnId)?.settlement;
    const totalSettled = refreshedInvoice?.totalSettled ?? totalPaid + totalTds + totalShort + totalAdvance;
    const remaining = refreshedInvoice?.outstanding ?? Math.max(0, netPayable - totalSettled);
    let paymentStatus = refreshedInvoice?.paymentStatus || (remaining <= 0.009 ? 'PAID' : totalSettled > 0 ? 'PARTIAL' : 'UNPAID');
    if (paymentData.close_invoice) paymentStatus = 'PAID';

    // Update GRN aggregate columns
    await this.updateGrnPaymentAggregate(tenantId, grnId, {
      paid_amount: totalPaid,
      tds_amount: totalTds,
      short_payment_amount: totalShort,
      payment_status: paymentStatus,
      payment_method: this.normalizePaymentMethod(paymentData.payment_method),
      payment_reference: paymentData.payment_reference || null,
      payment_date: paymentData.payment_date || new Date().toISOString().split('T')[0],
      payment_notes: paymentData.payment_notes || null,
    });

    return {
      message: 'Payment recorded successfully',
      paid_amount: totalPaid,
      tds_amount: totalTds,
      short_payment_amount: totalShort,
      advance_adjusted_amount: totalAdvance,
      total_settled: totalSettled,
      remaining_amount: remaining,
      payment_status: paymentStatus,
    };
  }

  private async applyAdvanceAdjustmentToGrn(
    tenantId: string,
    grn: any,
    amount: number,
    paymentDate: string,
    notes?: string,
    createdBy?: string,
  ) {
    const vendorId = grn.vendor_id;
    if (!vendorId) {
      throw new BadRequestException('Cannot adjust advance because supplier is missing on this GRN');
    }

    let remaining = amount;
    const availableAdvances = await this.fetchAvailableAdvancesForAdjustment(
      tenantId,
      vendorId,
      grn.po_id || null,
    );

    const totalAvailable = availableAdvances.reduce((sum: number, advance: any) => sum + advance.balance_amount, 0);
    if (totalAvailable + 0.009 < amount) {
      throw new BadRequestException(
        `Advance adjustment Rs. ${amount.toFixed(2)} exceeds available supplier advance Rs. ${totalAvailable.toFixed(2)}`,
      );
    }

    for (const advance of availableAdvances) {
      if (remaining <= 0.009) break;
      const utilizeAmount = Math.min(remaining, advance.balance_amount);
      await this.utilizeAdvanceAgainstGRN(
        tenantId,
        advance.id,
        grn.id,
        utilizeAmount,
        `Adjusted in AP payment against GRN ${grn.id}`,
      );
      remaining = Math.max(0, remaining - utilizeAmount);
    }

    await this.insertGrnPaymentEntry(tenantId, grn.id, {
      payment_date: paymentDate,
      amount,
      payment_method: 'ADVANCE_ADJUSTMENT',
      payment_reference: null,
      tds_amount: 0,
      short_payment_amount: 0,
      short_payment_reason: null,
      payment_notes: notes || 'Supplier advance adjusted against this invoice',
      entry_type: 'ADVANCE_APPLIED',
      created_by: createdBy || null,
    });
  }

  private async fetchAvailableAdvancesForAdjustment(tenantId: string, vendorId: string, poId?: string | null) {
    const select = 'id, vendor_id, po_id, advance_type, amount, utilized_amount, balance_amount, payment_date';
    const queries = [
      this.supabase
        .from('po_advance_payments')
        .select(select)
        .eq('tenant_id', tenantId)
        .eq('vendor_id', vendorId)
        .eq('advance_type', 'BLANKET')
        .gt('balance_amount', 0)
        .order('payment_date', { ascending: true }),
    ];

    if (poId) {
      queries.unshift(
        this.supabase
          .from('po_advance_payments')
          .select(select)
          .eq('tenant_id', tenantId)
          .eq('vendor_id', vendorId)
          .eq('po_id', poId)
          .gt('balance_amount', 0)
          .order('payment_date', { ascending: true }),
      );
    }

    const results = await Promise.all(queries);
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      throw new Error(`Failed to fetch supplier advances: ${failed.error.message}`);
    }

    const byId = new Map<string, any>();
    for (const result of results) {
      for (const advance of result.data || []) {
        const id = String(advance.id || '').trim();
        if (!id) continue;
        byId.set(id, {
          ...advance,
          balance_amount: Number(advance.balance_amount || 0),
          utilized_amount: Number(advance.utilized_amount || 0),
        });
      }
    }

    return Array.from(byId.values()).filter((advance) => advance.balance_amount > 0);
  }

  // Update an existing payment entry (for correcting mistakes)
  async updatePayment(
    tenantId: string,
    grnId: string,
    paymentEntryId: string,
    paymentData: {
      amount?: number;
      payment_method?: string;
      payment_reference?: string;
      payment_date?: string;
      payment_notes?: string;
      tds_amount?: number;
      short_payment_amount?: number;
      short_payment_reason?: string;
    },
  ) {
    console.log('[updatePayment] START', { tenantId, grnId, paymentEntryId, paymentData });
    try {
      // Verify payment entry exists and belongs to this GRN/tenant
      const { data: existingEntry, error: fetchError } = await this.supabase
        .from('grn_payment_entries')
        .select('*')
        .eq('id', paymentEntryId)
        .eq('grn_id', grnId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      console.log('[updatePayment] fetch existing entry:', { existingEntry: !!existingEntry, fetchError });

      if (fetchError) throw new Error(`Database error: ${fetchError.message}`);
      if (!existingEntry) throw new NotFoundException(`Payment entry not found (id: ${paymentEntryId})`);
      if (['ADVANCE', 'ADVANCE_APPLIED', 'VENDOR_ADVANCE'].includes(String(existingEntry.entry_type || '').toUpperCase())) {
        throw new BadRequestException('System advance entries cannot be edited from Accounts Payable');
      }

      const nextAmount = paymentData.amount !== undefined ? Number(paymentData.amount) : Number(existingEntry.amount || 0);
      const nextTds = paymentData.tds_amount !== undefined ? Number(paymentData.tds_amount) : Number(existingEntry.tds_amount || 0);
      const nextShort = paymentData.short_payment_amount !== undefined ? Number(paymentData.short_payment_amount) : Number(existingEntry.short_payment_amount || 0);
      const nextShortReason = paymentData.short_payment_reason !== undefined
        ? paymentData.short_payment_reason
        : existingEntry.short_payment_reason;
      this.validateSettlementInput(nextAmount, nextTds, nextShort, nextShortReason);

      // Update the payment entry
      const { error: updateError } = await this.supabase
        .from('grn_payment_entries')
        .update({
          amount: nextAmount,
          payment_method: paymentData.payment_method || existingEntry.payment_method,
          payment_reference: paymentData.payment_reference !== undefined ? paymentData.payment_reference : existingEntry.payment_reference,
          payment_date: paymentData.payment_date || existingEntry.payment_date,
          payment_notes: paymentData.payment_notes !== undefined ? paymentData.payment_notes : existingEntry.payment_notes,
          tds_amount: nextTds,
          short_payment_amount: nextShort,
          short_payment_reason: nextShortReason,
        })
        .eq('id', paymentEntryId)
        .eq('tenant_id', tenantId);

      console.log('[updatePayment] update payment entry:', { updateError });

      if (updateError) throw new Error(`Failed to update payment entry: ${updateError.message}`);

      // Recalculate all aggregates
      const allEntries = await this.fetchGrnPaymentEntryTotals(tenantId, grnId);

      console.log('[updatePayment] fetch all entries:', { count: allEntries?.length });

      const { data: grn } = await this.supabase
        .from('grns')
        .select('gross_amount, tax_amount, debit_note_amount, net_payable_amount')
        .eq('id', grnId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      console.log('[updatePayment] fetch GRN:', { grn, hasData: !!grn });

      const gross = parseFloat(grn?.gross_amount || 0);
      const tax = parseFloat(grn?.tax_amount || 0);
      const debit = parseFloat(grn?.debit_note_amount || 0);
      const netPayable = grn?.net_payable_amount != null
        ? parseFloat(grn.net_payable_amount)
        : gross + tax - debit;

      console.log('[updatePayment] calculated values:', { gross, tax, debit, netPayable });

      const totalPaid = (allEntries || []).reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? 0 : parseFloat(e.amount || 0)), 0);
      const totalAdvance = (allEntries || []).reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? parseFloat(e.amount || 0) : 0), 0);
      const totalTds = (allEntries || []).reduce((s: number, e: any) => s + parseFloat(e.tds_amount || 0), 0);
      const totalShort = (allEntries || []).reduce((s: number, e: any) => s + parseFloat(e.short_payment_amount || 0), 0);
      const totalSettled = totalPaid + totalTds + totalShort + totalAdvance;

      console.log('[updatePayment] totals:', { totalPaid, totalTds, totalShort, totalSettled });

      let paymentStatus = 'UNPAID';
      if (totalSettled >= netPayable - 0.009) {
        paymentStatus = 'PAID';
      } else if (totalSettled > 0) {
        paymentStatus = 'PARTIAL';
      }

      // Update GRN aggregate columns
      await this.updateGrnPaymentAggregate(tenantId, grnId, {
        paid_amount: totalPaid,
        tds_amount: totalTds,
        short_payment_amount: totalShort,
        payment_status: paymentStatus,
        ...this.latestPaymentMetadata(allEntries || []),
      });

      console.log('[updatePayment] GRN update:', { paymentStatus });

      console.log('[updatePayment] SUCCESS');

      const remaining = Math.max(0, netPayable - totalSettled);
      return {
        message: 'Payment updated successfully',
        paid_amount: totalPaid,
        tds_amount: totalTds,
        short_payment_amount: totalShort,
        advance_adjusted_amount: totalAdvance,
        total_settled: totalSettled,
        remaining_amount: remaining,
        payment_status: paymentStatus,
      };
    } catch (error) {
      console.error('[updatePayment] ERROR DETAILS:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }
  }

  // Delete a payment entry (for removing incorrect payments)
  async deletePayment(
    tenantId: string,
    grnId: string,
    paymentEntryId: string,
  ) {
    // Verify payment entry exists
    const { data: existingEntry, error: fetchError } = await this.supabase
      .from('grn_payment_entries')
      .select('*')
      .eq('id', paymentEntryId)
      .eq('grn_id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError) throw new Error(`Database error: ${fetchError.message}`);
    if (!existingEntry) throw new NotFoundException(`Payment entry not found (id: ${paymentEntryId})`);
    if (this.isAdvanceEntry(existingEntry)) {
      throw new BadRequestException('Advance adjustment entries cannot be deleted from Accounts Payable');
    }

    // Delete the payment entry
    const { error: deleteError } = await this.supabase
      .from('grn_payment_entries')
      .delete()
      .eq('id', paymentEntryId)
      .eq('tenant_id', tenantId);

    if (deleteError) throw new Error(`Failed to delete payment entry: ${deleteError.message}`);

    // Recalculate all aggregates from remaining entries
    const allEntries = await this.fetchGrnPaymentEntryTotals(tenantId, grnId);

    const { data: grn } = await this.supabase
      .from('grns')
      .select('gross_amount, tax_amount, debit_note_amount, net_payable_amount')
      .eq('id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const gross = parseFloat(grn?.gross_amount || 0);
    const tax = parseFloat(grn?.tax_amount || 0);
    const debit = parseFloat(grn?.debit_note_amount || 0);
    const netPayable = grn?.net_payable_amount != null
      ? parseFloat(grn.net_payable_amount)
      : gross + tax - debit;

    const totalPaid = (allEntries || []).reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? 0 : parseFloat(e.amount || 0)), 0);
    const totalAdvance = (allEntries || []).reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? parseFloat(e.amount || 0) : 0), 0);
    const totalTds = (allEntries || []).reduce((s: number, e: any) => s + parseFloat(e.tds_amount || 0), 0);
    const totalShort = (allEntries || []).reduce((s: number, e: any) => s + parseFloat(e.short_payment_amount || 0), 0);
    const totalSettled = totalPaid + totalTds + totalShort + totalAdvance;

    let paymentStatus = 'UNPAID';
    if (totalSettled >= netPayable - 0.009) {
      paymentStatus = 'PAID';
    } else if (totalSettled > 0) {
      paymentStatus = 'PARTIAL';
    }

    // Update GRN aggregate columns
    await this.updateGrnPaymentAggregate(tenantId, grnId, {
      paid_amount: totalPaid,
      tds_amount: totalTds,
      short_payment_amount: totalShort,
      payment_status: paymentStatus,
      // Clear last payment details if no payments remain
      payment_method: allEntries?.length ? undefined : null,
      payment_reference: allEntries?.length ? undefined : null,
      payment_date: allEntries?.length ? undefined : null,
      payment_notes: allEntries?.length ? undefined : null,
    });

    const remaining = Math.max(0, netPayable - totalSettled);
    return {
      message: 'Payment deleted successfully',
      paid_amount: totalPaid,
      tds_amount: totalTds,
      short_payment_amount: totalShort,
      advance_adjusted_amount: totalAdvance,
      total_settled: totalSettled,
      remaining_amount: remaining,
      payment_status: paymentStatus,
    };
  }

  async reversePayment(
    tenantId: string,
    grnId: string,
    paymentEntryId: string,
    userId: string,
    body: { reason?: string; notes?: string } = {},
  ) {
    const reason = String(body?.reason || body?.notes || '').trim();
    if (!reason) {
      throw new BadRequestException('Payment reversal reason is required');
    }

    const { data: existingEntry, error: fetchError } = await this.supabase
      .from('grn_payment_entries')
      .select('*')
      .eq('id', paymentEntryId)
      .eq('grn_id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError) throw new Error(`Database error: ${fetchError.message}`);
    if (!existingEntry) throw new NotFoundException(`Payment entry not found (id: ${paymentEntryId})`);

    const { data: grnForAdvanceReversal } = await this.supabase
      .from('grns')
      .select('id, po_id, vendor_id')
      .eq('id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const { data: sameDayAdvanceEntries, error: advanceFetchError } = await this.supabase
      .from('grn_payment_entries')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('grn_id', grnId)
      .eq('payment_date', existingEntry.payment_date)
      .in('entry_type', ['ADVANCE', 'ADVANCE_APPLIED', 'VENDOR_ADVANCE']);

    if (advanceFetchError && !this.isSchemaMismatchError(advanceFetchError, ['entry_type'])) {
      throw new Error(`Failed to fetch linked advance entries: ${advanceFetchError.message}`);
    }

    const linkedAdvanceEntries = (sameDayAdvanceEntries || []).filter((entry: any) => this.isAdvanceEntry(entry));
    const linkedAdvanceAmount = linkedAdvanceEntries.reduce((sum: number, entry: any) => sum + Number(entry.amount || 0), 0);
    const totalOriginalReversalAmount = parseFloat(existingEntry.amount || 0) + linkedAdvanceAmount;

    const { data: reversal, error: reversalError } = await this.supabase
      .from('grn_payment_reversals')
      .insert({
        tenant_id: tenantId,
        grn_id: grnId,
        payment_entry_id: paymentEntryId,
        original_payment_date: existingEntry.payment_date || null,
        original_amount: totalOriginalReversalAmount,
        original_tds_amount: parseFloat(existingEntry.tds_amount || 0),
        original_short_payment_amount: parseFloat(existingEntry.short_payment_amount || 0),
        original_payment_method: existingEntry.payment_method || null,
        original_payment_reference: existingEntry.payment_reference || null,
        reversal_reason: reason,
        reversed_by: userId || null,
        original_entry: {
          ...existingEntry,
          linked_advance_entries: linkedAdvanceEntries,
          linked_advance_amount: linkedAdvanceAmount,
        },
      })
      .select('id')
      .single();

    if (reversalError) {
      throw new Error(`Failed to record payment reversal audit: ${reversalError.message}`);
    }

    if (linkedAdvanceAmount > 0) {
      await this.restoreAdvanceUtilization(tenantId, grnForAdvanceReversal || { id: grnId }, linkedAdvanceAmount);
      const { error: deleteAdvanceError } = await this.supabase
        .from('grn_payment_entries')
        .delete()
        .eq('tenant_id', tenantId)
        .in('id', linkedAdvanceEntries.map((entry: any) => entry.id));

      if (deleteAdvanceError) {
        throw new Error(`Failed to reverse advance adjustment entries: ${deleteAdvanceError.message}`);
      }
    }

    const recalculated = await this.deletePayment(tenantId, grnId, paymentEntryId);
    return {
      message: 'Payment reversed successfully',
      reversal_id: reversal?.id,
      reversed_payment_id: paymentEntryId,
      reversed_advance_amount: linkedAdvanceAmount,
      ...recalculated,
    };
  }

  // Get all payment entries for a GRN
  async getPaymentEntries(tenantId: string, grnId: string) {
    const { data, error } = await this.supabase
      .from('grn_payment_entries')
      .select('*')
      .eq('grn_id', grnId)
      .eq('tenant_id', tenantId)
      .order('payment_date', { ascending: true });

    if (error) {
      console.error('[getPaymentEntries] error:', error.message);
      return [];
    }
    return data || [];
  }

  async getPaymentReversals(tenantId: string, grnId: string) {
    const { data, error } = await this.supabase
      .from('grn_payment_reversals')
      .select('*')
      .eq('grn_id', grnId)
      .eq('tenant_id', tenantId)
      .order('reversed_at', { ascending: false });

    if (error) {
      console.error('[getPaymentReversals] error:', error.message);
      return [];
    }
    return data || [];
  }

  private async getFreightAdjustments(tenantId: string, grnId: string) {
    const { data, error } = await this.supabase
      .from('activity_logs')
      .select('id, user_id, old_value, new_value, metadata, created_at')
      .eq('tenant_id', tenantId)
      .eq('resource_id', grnId)
      .eq('resource_type', 'GRN_INVOICE')
      .eq('action', 'FREIGHT_ADJUSTMENT')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[getFreightAdjustments] error:', error.message);
      return [];
    }

    const userIds = Array.from(new Set((data || []).map((row: any) => row.user_id).filter(Boolean)));
    const userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: users } = await this.supabase
        .from('users')
        .select('id, first_name, last_name, username, email')
        .in('id', userIds);
      for (const user of users || []) {
        const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
          || user.username
          || user.email
          || 'Unknown user';
        userMap.set(user.id, name);
      }
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      adjusted_by: row.user_id,
      adjusted_by_name: userMap.get(row.user_id) || 'Unknown user',
      adjusted_at: row.created_at,
      reason: row.metadata?.reason || row.new_value?.reason || '',
      old_freight_amount: Number(row.old_value?.freight_amount || 0),
      new_freight_amount: Number(row.new_value?.freight_amount || 0),
      old_freight_gst_amount: Number(row.old_value?.freight_gst_amount || 0),
      new_freight_gst_amount: Number(row.new_value?.freight_gst_amount || 0),
      old_net_payable_amount: Number(row.old_value?.net_payable_amount || 0),
      new_net_payable_amount: Number(row.new_value?.net_payable_amount || 0),
    }));
  }

  async adjustInvoiceFreight(
    tenantId: string,
    grnId: string,
    userId: string,
    body: { freight_amount: number; freight_gst_amount?: number; reason?: string },
  ) {
    const reason = String(body?.reason || '').trim();
    if (!reason) {
      throw new BadRequestException('Reason for freight adjustment is required');
    }

    const freightAmount = Number(body?.freight_amount);
    const freightGstAmount = Number(body?.freight_gst_amount || 0);
    if (!Number.isFinite(freightAmount) || freightAmount < 0) {
      throw new BadRequestException('Freight amount must be a valid non-negative amount');
    }
    if (!Number.isFinite(freightGstAmount) || freightGstAmount < 0) {
      throw new BadRequestException('Freight GST amount must be a valid non-negative amount');
    }
    if (freightAmount > 1_000_000_000 || freightGstAmount > 1_000_000_000) {
      throw new BadRequestException('Freight adjustment amount is outside the allowed range');
    }

    const { data: grn, error: fetchError } = await this.supabase
      .from('grns')
      .select('id, grn_number, status, invoice_approved, gross_amount, tax_amount, debit_note_amount, freight_amount, freight_gst_amount, net_payable_amount, paid_amount, tds_amount, short_payment_amount, payment_status')
      .eq('id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!grn) throw new NotFoundException('GRN supplier invoice not found');
    if (String(grn.status || '').toUpperCase() !== 'COMPLETED') {
      throw new BadRequestException('Freight can only be adjusted for completed GRN invoices');
    }
    if (!grn.invoice_approved) {
      throw new BadRequestException('Supplier invoice must be sanctioned before Accounts Payable can adjust freight');
    }

    const { data: existingPayments, error: paymentError } = await this.supabase
      .from('grn_payment_entries')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('grn_id', grnId)
      .limit(1);
    if (paymentError) throw new BadRequestException(`Unable to verify payment status: ${paymentError.message}`);

    const alreadySettled = Number(grn.paid_amount || 0)
      + Number(grn.tds_amount || 0)
      + Number(grn.short_payment_amount || 0);
    if ((existingPayments || []).length > 0 || alreadySettled > 0.009 || String(grn.payment_status || '').toUpperCase() === 'PAID') {
      throw new BadRequestException('Freight cannot be adjusted after payment or settlement has been posted');
    }

    const oldFreight = Number(grn.freight_amount || 0);
    const oldFreightGst = Number(grn.freight_gst_amount || 0);
    if (Math.round(oldFreight * 100) === Math.round(freightAmount * 100)
      && Math.round(oldFreightGst * 100) === Math.round(freightGstAmount * 100)) {
      throw new BadRequestException('Enter a revised freight or freight GST amount');
    }

    const grossAmount = Number(grn.gross_amount || 0);
    const taxAmount = Number(grn.tax_amount || 0);
    const debitNoteAmount = Number(grn.debit_note_amount || 0);
    const revisedNetPayable = Math.round(
      grossAmount + taxAmount + freightAmount + freightGstAmount - debitNoteAmount,
    );
    if (revisedNetPayable < 0) {
      throw new BadRequestException('Revised freight would produce an invalid payable amount');
    }

    const adjustedAt = new Date().toISOString();
    const oldValue = {
      freight_amount: oldFreight,
      freight_gst_amount: oldFreightGst,
      net_payable_amount: Number(grn.net_payable_amount || 0),
    };
    const newValue = {
      freight_amount: freightAmount,
      freight_gst_amount: freightGstAmount,
      net_payable_amount: revisedNetPayable,
      reason,
    };

    const { error: updateError } = await this.supabase
      .from('grns')
      .update({
        freight_amount: freightAmount,
        freight_gst_amount: freightGstAmount,
        net_payable_amount: revisedNetPayable,
        updated_at: adjustedAt,
      })
      .eq('id', grnId)
      .eq('tenant_id', tenantId);
    if (updateError) throw new BadRequestException(updateError.message);

    const { error: auditError } = await this.supabase.from('activity_logs').insert({
      tenant_id: tenantId,
      user_id: userId,
      action: 'FREIGHT_ADJUSTMENT',
      resource_type: 'GRN_INVOICE',
      resource_id: grnId,
      resource_code: grn.grn_number || null,
      resource_name: 'Supplier invoice freight adjustment',
      old_value: oldValue,
      new_value: newValue,
      metadata: {
        reason,
        source: 'ACCOUNTS_PAYABLE',
        po_freight_updated: false,
      },
    });

    if (auditError) {
      await this.supabase
        .from('grns')
        .update({
          freight_amount: oldValue.freight_amount,
          freight_gst_amount: oldValue.freight_gst_amount,
          net_payable_amount: oldValue.net_payable_amount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', grnId)
        .eq('tenant_id', tenantId);
      throw new BadRequestException(`Freight was not changed because the audit trail could not be recorded: ${auditError.message}`);
    }

    return this.getGrnPayableDetail(tenantId, grnId);
  }

  // Get full payable detail for a single GRN (used by frontend detail modal)
  async getGrnPayableDetail(tenantId: string, grnId: string) {
    const { data: grn, error } = await this.supabase
      .from('grns')
      .select('*, purchase_order:purchase_orders(id, po_number, po_date), vendor:vendors(id, name, code)')
      .eq('id', grnId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      console.error('[getGrnPayableDetail] grn fetch error:', error.message);
      throw new Error(error.message);
    }
    if (!grn) throw new NotFoundException(`GRN not found (id: ${grnId})`);  

    const entries = await this.getPaymentEntries(tenantId, grnId);
    const reversals = await this.getPaymentReversals(tenantId, grnId);
    const freightAdjustments = await this.getFreightAdjustments(tenantId, grnId);

    // Fetch advance payments for this GRN's PO
    const poId = grn.po_id || grn.purchase_order?.id;
    let advanceEntries: any[] = [];
    if (poId) {
      const { data: advances } = await this.supabase
        .from('po_advance_payments')
        .select('*')
        .eq('po_id', poId)
        .eq('tenant_id', tenantId)
        .order('payment_date', { ascending: true });
      advanceEntries = advances || [];
    }

    // Fetch vendor-level blanket advance balance (not linked to any PO)
    const vendorId = grn.vendor_id || grn.vendor?.id;
    console.log('[getGrnPayableDetail] vendorId:', vendorId, 'grn.po_id:', poId);
    let vendorAdvanceAmount = 0;
    if (vendorId) {
      const { data: vendorAdvances, error: advanceError } = await this.supabase
        .from('po_advance_payments')
        .select('balance_amount')
        .eq('vendor_id', vendorId)
        .eq('tenant_id', tenantId)
        .eq('advance_type', 'BLANKET')
        .gt('balance_amount', 0);
      console.log('[getGrnPayableDetail] vendorAdvance query result:', vendorAdvances, 'error:', advanceError);
      vendorAdvanceAmount = (vendorAdvances || []).reduce((sum: number, advance: any) => sum + parseFloat(advance.balance_amount || 0), 0);
      console.log('[getGrnPayableDetail] vendorAdvanceAmount:', vendorAdvanceAmount);
    }

    const gross = parseFloat(grn.gross_amount || 0);
    const tax = parseFloat(grn.tax_amount || 0);
    const debit = parseFloat(grn.debit_note_amount || 0);
    const netPayable = grn.net_payable_amount != null
      ? parseFloat(grn.net_payable_amount)
      : gross + tax - debit;
    const poSettlement = poId ? await this.getPoSettlement(tenantId, poId) : null;
    const allocated = poSettlement?.invoices.find((invoice: any) => invoice.grn_id === grnId)?.settlement;
    const totalPaid = allocated?.cashPaid ?? entries.reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? 0 : parseFloat(e.amount || 0)), 0);
    const totalTds = allocated?.tds ?? entries.reduce((s: number, e: any) => s + parseFloat(e.tds_amount || 0), 0);
    const totalShort = allocated?.shortPayment ?? entries.reduce((s: number, e: any) => s + parseFloat(e.short_payment_amount || 0), 0);
    const totalAdvance = allocated?.advanceApplied ?? entries.reduce((s: number, e: any) => s + (this.isAdvanceEntry(e) ? parseFloat(e.amount || 0) : 0), 0);
    const outstanding = allocated?.outstanding ?? Math.max(0, netPayable - totalPaid - totalTds - totalShort - totalAdvance);

    console.log('[getGrnPayableDetail] totals:', { netPayable, totalPaid, totalTds, totalShort, totalAdvance, outstanding, advanceEntriesCount: advanceEntries.length });

    const allEntries = [
      ...entries.map(e => ({ ...e, entry_type: e.entry_type || 'PAYMENT' })),
    ].sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());

    return {
      ...grn,
      payment_status: allocated?.paymentStatus || grn.payment_status,
      net_payable_amount: netPayable,
      computed_paid: totalPaid,
      computed_tds: totalTds,
      computed_short: totalShort,
      computed_advance: totalAdvance,
      available_po_advance: poSettlement?.summary.advanceAvailable || 0,
      available_vendor_advance: vendorAdvanceAmount,
      outstanding_amount: outstanding,
      payment_entries: allEntries,
      payment_reversals: reversals,
      freight_adjustments: freightAdjustments,
    };
  }

  async recordAdvancePayment(
    tenantId: string,
    paymentData: {
      advance_type: 'PO' | 'BLANKET';
      po_id?: string;
      vendor_id: string;
      amount: number;
      payment_method: string;
      payment_reference?: string;
      payment_date?: string;
      payment_notes?: string;
      created_by?: string;
    },
  ) {
    const amount = parseFloat(String(paymentData.amount));
    if (!amount || amount <= 0) throw new Error('Advance amount must be greater than 0');

    const advanceType = paymentData.advance_type || 'BLANKET';
    
    let poNumber: string | null = null;
    let vendorId = paymentData.vendor_id;

    // If PO-specific advance, validate PO and get vendor from PO
    if (advanceType === 'PO' && paymentData.po_id) {
      const { data: po } = await this.supabase
        .from('purchase_orders')
        .select('id, po_number, vendor_id, grand_total')
        .eq('id', paymentData.po_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!po) throw new Error('Purchase Order not found');
      
      poNumber = po.po_number;
      vendorId = po.vendor_id;
    } else if (advanceType === 'BLANKET') {
      // For blanket advance, validate vendor exists
      const { data: vendor } = await this.supabase
        .from('vendors')
        .select('id, name, code')
        .eq('id', vendorId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!vendor) throw new Error('Vendor not found');
    }

    // Insert advance payment record
    const { data: advanceRecord, error } = await this.supabase
      .from('po_advance_payments')
      .insert({
        tenant_id: tenantId,
        po_id: advanceType === 'PO' ? paymentData.po_id : null,
        vendor_id: vendorId,
        advance_type: advanceType,
        amount,
        balance_amount: amount,  // Initially full amount is available
        utilized_amount: 0,
        payment_method: paymentData.payment_method,
        payment_reference: paymentData.payment_reference || null,
        payment_date: paymentData.payment_date || new Date().toISOString().split('T')[0],
        payment_notes: paymentData.payment_notes || null,
        created_by: paymentData.created_by || null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record advance payment: ${error.message}`);

    // Update vendor advance balance summary
    await this.updateVendorAdvanceBalance(tenantId, vendorId, amount);

    return { 
      message: `${advanceType === 'PO' ? 'PO' : 'Blanket'} advance payment recorded successfully`, 
      po_number: poNumber,
      vendor_id: vendorId,
      amount,
      advance_id: advanceRecord.id
    };
  }

  // Helper to update vendor advance balance summary
  private async updateVendorAdvanceBalance(tenantId: string, vendorId: string, amount: number) {
    const { data: existing } = await this.supabase
      .from('vendor_advance_balances')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .maybeSingle();

    if (existing) {
      await this.supabase
        .from('vendor_advance_balances')
        .update({
          total_advance: existing.total_advance + amount,
          balance_amount: existing.balance_amount + amount,
          last_advance_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await this.supabase
        .from('vendor_advance_balances')
        .insert({
          tenant_id: tenantId,
          vendor_id: vendorId,
          total_advance: amount,
          utilized_amount: 0,
          balance_amount: amount,
          last_advance_date: new Date().toISOString(),
        });
    }
  }

  async getAdvancePayments(tenantId: string, poId: string) {
    const { data, error } = await this.supabase
      .from('po_advance_payments')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('po_id', poId)
      .order('payment_date', { ascending: false });

    if (error) throw new Error(error.message);
    return data || [];
  }

  async getAllAdvancePayments(tenantId: string) {
    const { data, error } = await this.supabase
      .from('po_advance_payments')
      .select(`*, purchase_order:purchase_orders(id, po_number, grand_total), vendor:vendors(id, name, code)`)
      .eq('tenant_id', tenantId)
      .order('payment_date', { ascending: false });

    if (error) throw new Error(error.message);
    return data || [];
  }

  // Get vendor advance summary for Accounts Payable overview
  async getVendorAdvanceSummary(tenantId: string) {
    const { data, error } = await this.supabase
      .from('vendor_advance_balances')
      .select(`
        *,
        vendor:vendors(id, name, code)
      `)
      .eq('tenant_id', tenantId)
      .gt('balance_amount', 0)
      .order('balance_amount', { ascending: false });

    if (error) {
      console.error('[getVendorAdvanceSummary] error:', error.message);
      return [];
    }
    return data || [];
  }

  // Get specific vendor's advance balance
  async getVendorAdvanceBalance(tenantId: string, vendorId: string) {
    const { data, error } = await this.supabase
      .from('vendor_advance_balances')
      .select(`
        *,
        vendor:vendors(id, name, code)
      `)
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .maybeSingle();

    if (error) {
      console.error('[getVendorAdvanceBalance] error:', error.message);
      return null;
    }

    // If no record exists, return zero balance
    if (!data) {
      const { data: vendor } = await this.supabase
        .from('vendors')
        .select('id, name, code')
        .eq('id', vendorId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return {
        vendor_id: vendorId,
        vendor: vendor || { id: vendorId, name: 'Unknown', code: '' },
        total_advance: 0,
        utilized_amount: 0,
        balance_amount: 0,
      };
    }

    return data;
  }

  // Add vendor-level advance (not linked to any PO)
  async addVendorAdvance(
    tenantId: string,
    vendorId: string,
    paymentData: {
      amount: number;
      payment_method?: string;
      payment_reference?: string;
      payment_date?: string;
      notes?: string;
      created_by?: string;
    },
  ) {
    const amount = parseFloat(String(paymentData.amount));
    if (!amount || amount <= 0) throw new Error('Advance amount must be greater than 0');

    // Verify vendor exists
    const { data: vendor, error: vendorError } = await this.supabase
      .from('vendors')
      .select('id, name, code')
      .eq('id', vendorId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (vendorError) throw new Error(`Vendor lookup error: ${vendorError.message}`);
    if (!vendor) throw new Error('Vendor not found');

    // Use RPC function to add advance
    const { data: advanceId, error: rpcError } = await this.supabase
      .rpc('add_vendor_advance', {
        p_tenant_id: tenantId,
        p_vendor_id: vendorId,
        p_amount: amount,
        p_notes: paymentData.notes || `Advance payment - ${paymentData.payment_method || 'NEFT'}`,
      });

    if (rpcError) {
      console.error('[addVendorAdvance] RPC error:', rpcError.message);
      // Fallback: manual upsert
      const { data: existing } = await this.supabase
        .from('vendor_advance_balances')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('vendor_id', vendorId)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await this.supabase
          .from('vendor_advance_balances')
          .update({
            total_advance: (existing.total_advance || 0) + amount,
            balance_amount: (existing.balance_amount || 0) + amount,
            last_advance_date: new Date().toISOString(),
            notes: paymentData.notes || existing.notes,
          })
          .eq('id', existing.id);

        if (updateError) throw new Error(`Failed to update advance: ${updateError.message}`);
      } else {
        const { error: insertError } = await this.supabase
          .from('vendor_advance_balances')
          .insert({
            tenant_id: tenantId,
            vendor_id: vendorId,
            total_advance: amount,
            utilized_amount: 0,
            balance_amount: amount,
            last_advance_date: new Date().toISOString(),
            notes: paymentData.notes,
          });

        if (insertError) throw new Error(`Failed to insert advance: ${insertError.message}`);
      }
    }

    // Also record in po_advance_payments with po_id = NULL to track history
    const { error: historyError } = await this.supabase
      .from('po_advance_payments')
      .insert({
        tenant_id: tenantId,
        po_id: null, // Not linked to any PO - general vendor advance
        vendor_id: vendorId,
        amount: amount,
        payment_method: paymentData.payment_method || 'NEFT',
        payment_reference: paymentData.payment_reference || null,
        payment_date: paymentData.payment_date || new Date().toISOString().split('T')[0],
        payment_notes: paymentData.notes || 'Vendor-level advance payment',
        created_by: paymentData.created_by || null,
      });

    if (historyError) {
      console.error('[addVendorAdvance] History record error:', historyError.message);
      // Don't fail if history insert fails
    }

    return {
      message: 'Vendor advance added successfully',
      vendor_name: vendor.name,
      vendor_code: vendor.code,
      amount,
    };
  }

  // Utilize vendor advance against a GRN payment
  async utilizeVendorAdvance(
    tenantId: string,
    vendorId: string,
    amount: number,
    grnId?: string,
    notes?: string,
  ) {
    const { data: success, error: rpcError } = await this.supabase
      .rpc('utilize_vendor_advance', {
        p_tenant_id: tenantId,
        p_vendor_id: vendorId,
        p_amount: amount,
        p_grn_id: grnId || null,
        p_notes: notes || null,
      });

    if (rpcError) {
      console.error('[utilizeVendorAdvance] RPC error:', rpcError.message);
      throw new Error(`Failed to utilize advance: ${rpcError.message}`);
    }

    if (!success) {
      throw new Error('Insufficient advance balance');
    }

    return { success: true, amount, message: 'Advance utilized successfully' };
  }

  // NEW: Get available advances for a vendor (both blanket and PO-specific)
  async getVendorAvailableAdvances(
    tenantId: string,
    vendorId: string,
    poId?: string,
  ) {
    const { data, error } = await this.supabase
      .rpc('get_vendor_available_advances', {
        p_tenant_id: tenantId,
        p_vendor_id: vendorId,
        p_po_id: poId || null,
      });

    if (error) {
      console.error('[getVendorAvailableAdvances] error:', error.message);
      throw new Error(`Failed to get available advances: ${error.message}`);
    }

    return data || [];
  }

  // NEW: Suggest advance adjustment when GRN is created
  async suggestAdvanceAdjustment(
    tenantId: string,
    vendorId: string,
    poId: string,
    grnNetAmount: number,
  ) {
    const { data, error } = await this.supabase
      .rpc('suggest_advance_adjustment', {
        p_tenant_id: tenantId,
        p_vendor_id: vendorId,
        p_po_id: poId,
        p_grn_net_amount: grnNetAmount,
      });

    if (error) {
      console.error('[suggestAdvanceAdjustment] error:', error.message);
      return {
        has_blanket_advance: false,
        blanket_balance: 0,
        po_advance_balance: 0,
        suggested_adjustment: 0,
        message: 'Error checking advances',
      };
    }

    return data?.[0] || {
      has_blanket_advance: false,
      blanket_balance: 0,
      po_advance_balance: 0,
      suggested_adjustment: 0,
      message: 'No advances found',
    };
  }

  // NEW: Utilize a specific advance against a GRN
  async utilizeAdvanceAgainstGRN(
    tenantId: string,
    advanceId: string,
    grnId: string,
    utilizeAmount: number,
    notes?: string,
  ) {
    const { data: success, error } = await this.supabase
      .rpc('utilize_advance_against_grn', {
        p_tenant_id: tenantId,
        p_advance_id: advanceId,
        p_grn_id: grnId,
        p_utilize_amount: utilizeAmount,
        p_notes: notes || null,
      });

    if (error) {
      console.error('[utilizeAdvanceAgainstGRN] RPC error, using direct fallback:', error.message);
      return this.utilizeAdvanceAgainstGrnDirect(tenantId, advanceId, grnId, utilizeAmount, notes);
    }

    if (!success) {
      throw new Error('Insufficient advance balance or advance not found');
    }

    return { success: true, amount: utilizeAmount, message: 'Advance utilized successfully' };
  }

  private async utilizeAdvanceAgainstGrnDirect(
    tenantId: string,
    advanceId: string,
    grnId: string,
    utilizeAmount: number,
    notes?: string,
  ) {
    const amount = Number(utilizeAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Advance utilization amount must be greater than 0');
    }

    const { data: advance, error: fetchError } = await this.supabase
      .from('po_advance_payments')
      .select('id, vendor_id, balance_amount, utilized_amount')
      .eq('tenant_id', tenantId)
      .eq('id', advanceId)
      .maybeSingle();

    if (fetchError) throw new Error(`Failed to fetch advance: ${fetchError.message}`);
    if (!advance) throw new Error('Insufficient advance balance or advance not found');

    const currentBalance = Number(advance.balance_amount || 0);
    const currentUtilized = Number(advance.utilized_amount || 0);
    if (currentBalance + 0.009 < amount) {
      throw new Error('Insufficient advance balance or advance not found');
    }

    const { error: updateError } = await this.supabase
      .from('po_advance_payments')
      .update({
        balance_amount: Math.max(0, currentBalance - amount),
        utilized_amount: currentUtilized + amount,
        utilized_against_grn_id: grnId,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', advanceId);

    if (updateError) throw new Error(`Failed to update advance balance: ${updateError.message}`);

    if (advance.vendor_id) {
      await this.adjustVendorAdvanceBalanceAfterUtilization(tenantId, advance.vendor_id, amount);
    }

    console.log('[utilizeAdvanceAgainstGRN] direct fallback applied', {
      advanceId,
      grnId,
      amount,
      notes,
    });

    return { success: true, amount, message: 'Advance utilized successfully' };
  }

  private async adjustVendorAdvanceBalanceAfterUtilization(tenantId: string, vendorId: string, amount: number) {
    const { data: existing, error: fetchError } = await this.supabase
      .from('vendor_advance_balances')
      .select('id, balance_amount, utilized_amount')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .maybeSingle();

    if (fetchError || !existing) return;

    await this.supabase
      .from('vendor_advance_balances')
      .update({
        balance_amount: Math.max(0, Number(existing.balance_amount || 0) - amount),
        utilized_amount: Number(existing.utilized_amount || 0) + amount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);
  }

  private async restoreVendorAdvanceBalanceAfterReversal(tenantId: string, vendorId: string, amount: number) {
    const { data: existing, error: fetchError } = await this.supabase
      .from('vendor_advance_balances')
      .select('id, balance_amount, utilized_amount')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .maybeSingle();

    if (fetchError || !existing) return;

    await this.supabase
      .from('vendor_advance_balances')
      .update({
        balance_amount: Number(existing.balance_amount || 0) + amount,
        utilized_amount: Math.max(0, Number(existing.utilized_amount || 0) - amount),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);
  }

  private async restoreAdvanceUtilization(
    tenantId: string,
    grn: any,
    amount: number,
  ) {
    let remaining = Number(amount || 0);
    if (!Number.isFinite(remaining) || remaining <= 0) return;

    const vendorId = grn.vendor_id || grn.vendor?.id;
    if (!vendorId) return;

    let query = this.supabase
      .from('po_advance_payments')
      .select('id, vendor_id, po_id, utilized_amount, balance_amount, payment_date')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .gt('utilized_amount', 0)
      .order('payment_date', { ascending: false });

    if (grn.po_id) query = query.eq('po_id', grn.po_id);

    let { data: advances, error } = await query;
    if (error) throw new Error(`Failed to fetch advances for reversal: ${error.message}`);

    if ((!advances || advances.length === 0) && grn.po_id) {
      const fallback = await this.supabase
        .from('po_advance_payments')
        .select('id, vendor_id, po_id, utilized_amount, balance_amount, payment_date')
        .eq('tenant_id', tenantId)
        .eq('vendor_id', vendorId)
        .gt('utilized_amount', 0)
        .order('payment_date', { ascending: false });
      if (fallback.error) throw new Error(`Failed to fetch vendor advances for reversal: ${fallback.error.message}`);
      advances = fallback.data || [];
    }

    for (const advance of advances || []) {
      if (remaining <= 0.009) break;
      const utilized = Number((advance as any).utilized_amount || 0);
      if (utilized <= 0) continue;
      const restore = Math.min(remaining, utilized);

      const { error: updateError } = await this.supabase
        .from('po_advance_payments')
        .update({
          utilized_amount: Math.max(0, utilized - restore),
          balance_amount: Number((advance as any).balance_amount || 0) + restore,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('id', (advance as any).id);

      if (updateError) throw new Error(`Failed to restore advance balance: ${updateError.message}`);
      remaining = Math.max(0, remaining - restore);
    }

    await this.restoreVendorAdvanceBalanceAfterReversal(tenantId, vendorId, amount - remaining);
  }

  // NEW: Unified method to get all advances with filtering
  async getPoSettlement(tenantId: string, poId: string) {
    const [grnResult, advanceResult] = await Promise.all([
      this.supabase
        .from('grns')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('po_id', poId)
        .order('receipt_date', { ascending: true }),
      this.supabase
        .from('po_advance_payments')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('po_id', poId)
        .order('payment_date', { ascending: true }),
    ]);

    if (grnResult.error) throw new Error(`Failed to fetch PO invoices: ${grnResult.error.message}`);
    if (advanceResult.error) throw new Error(`Failed to fetch PO advances: ${advanceResult.error.message}`);

    const grns = grnResult.data || [];
    const advances = advanceResult.data || [];
    const grnIds = grns.map((grn: any) => grn.id);
    const paymentResult = grnIds.length > 0
      ? await this.supabase
        .from('grn_payment_entries')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('grn_id', grnIds)
        .order('payment_date', { ascending: true })
      : { data: [], error: null };

    if (paymentResult.error) throw new Error(`Failed to fetch supplier payments: ${paymentResult.error.message}`);

    const reversalResult = grnIds.length > 0
      ? await this.supabase
        .from('grn_payment_reversals')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('grn_id', grnIds)
        .order('reversed_at', { ascending: true })
      : { data: [], error: null };

    if (reversalResult.error) throw new Error(`Failed to fetch supplier payment reversals: ${reversalResult.error.message}`);

    const paymentEntries = paymentResult.data || [];
    const entriesByGrn = new Map<string, any[]>();
    for (const entry of paymentEntries) {
      const entries = entriesByGrn.get(entry.grn_id) || [];
      entries.push(entry);
      entriesByGrn.set(entry.grn_id, entries);
    }

    const paymentReversals = reversalResult.data || [];
    const reversalsByGrn = new Map<string, any[]>();
    for (const reversal of paymentReversals) {
      const reversals = reversalsByGrn.get(reversal.grn_id) || [];
      reversals.push(reversal);
      reversalsByGrn.set(reversal.grn_id, reversals);
    }

    const totalAdvance = advances.reduce((sum: number, advance: any) => sum + Number(advance.amount || 0), 0);
    const settlement = allocatePoSettlement(grns.map((grn: any) => {
      const entries = entriesByGrn.get(grn.id) || [];
      const reversals = reversalsByGrn.get(grn.id) || [];
      const rawEntryCash = entries.reduce((sum: number, entry: any) => sum + (this.isAdvanceEntry(entry) ? 0 : Number(entry.amount || 0)), 0);
      const rawEntryAdvance = entries.reduce((sum: number, entry: any) => sum + (this.isAdvanceEntry(entry) ? Number(entry.amount || 0) : 0), 0);
      const rawEntryTds = entries.reduce((sum: number, entry: any) => sum + Number(entry.tds_amount || 0), 0);
      const rawEntryShort = entries.reduce((sum: number, entry: any) => sum + Number(entry.short_payment_amount || 0), 0);
      const reversedCash = reversals.reduce((sum: number, reversal: any) => {
        const originalEntry = reversal.original_entry || {};
        const linkedAdvanceAmount = Number(
          originalEntry.linked_advance_amount ??
          originalEntry.linkedAdvanceAmount ??
          0,
        );
        const originalCashAmount = Number(originalEntry.amount ?? 0);
        const originalAmount = Number(reversal.original_amount || 0);
        const fallbackCash = Math.max(0, originalAmount - linkedAdvanceAmount);
        return sum + (Number.isFinite(originalCashAmount) && originalCashAmount > 0 ? originalCashAmount : fallbackCash);
      }, 0);
      const reversedAdvance = reversals.reduce((sum: number, reversal: any) => {
        const originalEntry = reversal.original_entry || {};
        const linkedAdvanceAmount = Number(
          originalEntry.linked_advance_amount ??
          originalEntry.linkedAdvanceAmount ??
          0,
        );
        if (linkedAdvanceAmount > 0) return sum + linkedAdvanceAmount;
        const originalEntryType = String(originalEntry.entry_type || '').toUpperCase();
        return ['ADVANCE', 'ADVANCE_APPLIED', 'VENDOR_ADVANCE'].includes(originalEntryType)
          ? sum + Number(reversal.original_amount || 0)
          : sum;
      }, 0);
      const reversedTds = reversals.reduce((sum: number, reversal: any) => sum + Number(reversal.original_tds_amount || 0), 0);
      const reversedShort = reversals.reduce((sum: number, reversal: any) => sum + Number(reversal.original_short_payment_amount || 0), 0);
      const entryCash = Math.max(0, rawEntryCash - reversedCash);
      const entryAdvance = Math.max(0, rawEntryAdvance - reversedAdvance);
      const entryTds = Math.max(0, rawEntryTds - reversedTds);
      const entryShort = Math.max(0, rawEntryShort - reversedShort);
      const aggregatePaid = Number(grn.paid_amount || 0);

      // Older auto-advance logic wrote advance utilization into paid_amount.
      // With no remittance evidence, treat that aggregate as advance, not cash.
      const hasLedgerEvidence = entries.length > 0 || reversals.length > 0;
      const hasCashEvidence = hasLedgerEvidence || Boolean(grn.payment_method || grn.payment_reference);
      const cashPaid = hasLedgerEvidence
        ? entryCash
        : totalAdvance > 0 && !hasCashEvidence
          ? 0
          : aggregatePaid;

      return {
        id: grn.id,
        date: grn.invoice_date || grn.receipt_date || grn.created_at,
        netPayable: Number(grn.net_payable_amount ?? grn.gross_amount ?? 0),
        cashPaid,
        advanceApplied: entryAdvance,
        tds: hasLedgerEvidence ? entryTds : Number(grn.tds_amount || 0),
        shortPayment: hasLedgerEvidence ? entryShort : Number(grn.short_payment_amount || 0),
      };
    }), totalAdvance);

    const resultByGrn = new Map(settlement.invoices.map((invoice) => [invoice.id, invoice]));
    return {
      summary: settlement,
      advances,
      invoices: grns.map((grn: any) => ({
        grn_id: grn.id,
        payment_entries: entriesByGrn.get(grn.id) || [],
        payment_reversals: reversalsByGrn.get(grn.id) || [],
        settlement: resultByGrn.get(grn.id),
      })),
    };
  }

  private async getPoSettlementsSafely(tenantId: string, poIds: string[], context: string) {
    const settlements: Array<{ poId: string; settlement: Awaited<ReturnType<DebitNoteService['getPoSettlement']>> }> = [];
    const concurrency = 6;

    for (let index = 0; index < poIds.length; index += concurrency) {
      const batch = poIds.slice(index, index + concurrency);
      const batchSettlements = await Promise.all(batch.map(async (poId) => {
        try {
          const settlement = await this.getPoSettlement(tenantId, poId);
          return { poId, settlement };
        } catch (error: any) {
          console.error(`[${context}] skipped PO settlement lookup`, {
            poId,
            message: error?.message || String(error),
          });
          return null;
        }
      }));

      settlements.push(...batchSettlements.filter((entry): entry is { poId: string; settlement: Awaited<ReturnType<DebitNoteService['getPoSettlement']>> } => Boolean(entry)));
    }

    return settlements;
  }

  private groupRowsByKey(rows: any[], key: string) {
    const grouped = new Map<string, any[]>();
    for (const row of rows || []) {
      const groupKey = row?.[key];
      if (!groupKey) continue;
      const group = grouped.get(groupKey) || [];
      group.push(row);
      grouped.set(groupKey, group);
    }
    return grouped;
  }

  private calculatePoSettlementFromRows(poGrns: any[], advances: any[], paymentEntries: any[], paymentReversals: any[]) {
    const entriesByGrn = this.groupRowsByKey(paymentEntries, 'grn_id');
    const reversalsByGrn = this.groupRowsByKey(paymentReversals, 'grn_id');
    const totalAdvance = (advances || []).reduce((sum: number, advance: any) => sum + Number(advance.amount || 0), 0);

    const settlement = allocatePoSettlement((poGrns || []).map((grn: any) => {
      const entries = entriesByGrn.get(grn.id) || [];
      const reversals = reversalsByGrn.get(grn.id) || [];
      const rawEntryCash = entries.reduce((sum: number, entry: any) => sum + (this.isAdvanceEntry(entry) ? 0 : Number(entry.amount || 0)), 0);
      const rawEntryAdvance = entries.reduce((sum: number, entry: any) => sum + (this.isAdvanceEntry(entry) ? Number(entry.amount || 0) : 0), 0);
      const rawEntryTds = entries.reduce((sum: number, entry: any) => sum + Number(entry.tds_amount || 0), 0);
      const rawEntryShort = entries.reduce((sum: number, entry: any) => sum + Number(entry.short_payment_amount || 0), 0);
      const reversedCash = reversals.reduce((sum: number, reversal: any) => {
        const originalEntry = reversal.original_entry || {};
        const linkedAdvanceAmount = Number(
          originalEntry.linked_advance_amount ??
          originalEntry.linkedAdvanceAmount ??
          0,
        );
        const originalCashAmount = Number(originalEntry.amount ?? 0);
        const originalAmount = Number(reversal.original_amount || 0);
        const fallbackCash = Math.max(0, originalAmount - linkedAdvanceAmount);
        return sum + (Number.isFinite(originalCashAmount) && originalCashAmount > 0 ? originalCashAmount : fallbackCash);
      }, 0);
      const reversedAdvance = reversals.reduce((sum: number, reversal: any) => {
        const originalEntry = reversal.original_entry || {};
        const linkedAdvanceAmount = Number(
          originalEntry.linked_advance_amount ??
          originalEntry.linkedAdvanceAmount ??
          0,
        );
        if (linkedAdvanceAmount > 0) return sum + linkedAdvanceAmount;
        const originalEntryType = String(originalEntry.entry_type || '').toUpperCase();
        return ['ADVANCE', 'ADVANCE_APPLIED', 'VENDOR_ADVANCE'].includes(originalEntryType)
          ? sum + Number(reversal.original_amount || 0)
          : sum;
      }, 0);
      const reversedTds = reversals.reduce((sum: number, reversal: any) => sum + Number(reversal.original_tds_amount || 0), 0);
      const reversedShort = reversals.reduce((sum: number, reversal: any) => sum + Number(reversal.original_short_payment_amount || 0), 0);
      const entryCash = Math.max(0, rawEntryCash - reversedCash);
      const entryAdvance = Math.max(0, rawEntryAdvance - reversedAdvance);
      const entryTds = Math.max(0, rawEntryTds - reversedTds);
      const entryShort = Math.max(0, rawEntryShort - reversedShort);
      const aggregatePaid = Number(grn.paid_amount || 0);

      const hasLedgerEvidence = entries.length > 0 || reversals.length > 0;
      const hasCashEvidence = hasLedgerEvidence || Boolean(grn.payment_method || grn.payment_reference);
      const cashPaid = hasLedgerEvidence
        ? entryCash
        : totalAdvance > 0 && !hasCashEvidence
          ? 0
          : aggregatePaid;

      return {
        id: grn.id,
        date: grn.invoice_date || grn.receipt_date || grn.created_at,
        netPayable: Number(grn.net_payable_amount ?? grn.gross_amount ?? 0),
        cashPaid,
        advanceApplied: entryAdvance,
        tds: hasLedgerEvidence ? entryTds : Number(grn.tds_amount || 0),
        shortPayment: hasLedgerEvidence ? entryShort : Number(grn.short_payment_amount || 0),
      };
    }), totalAdvance);

    const resultByGrn = new Map(settlement.invoices.map((invoice) => [invoice.id, invoice]));
    return {
      summary: settlement,
      advances,
      invoices: (poGrns || []).map((grn: any) => ({
        grn_id: grn.id,
        payment_entries: entriesByGrn.get(grn.id) || [],
        payment_reversals: reversalsByGrn.get(grn.id) || [],
        settlement: resultByGrn.get(grn.id),
      })),
    };
  }

  private async getSettlementByGrnForRows(tenantId: string, grns: any[]) {
    const grnRows = (grns || []).filter((grn: any) => grn?.id && grn?.po_id);
    const grnIds = [...new Set(grnRows.map((grn: any) => grn.id))];
    const poIds = [...new Set(grnRows.map((grn: any) => grn.po_id))];
    const settlementByGrn = new Map<string, any>();

    if (grnIds.length === 0 || poIds.length === 0) return settlementByGrn;

    const [advanceResult, paymentResult, reversalResult] = await Promise.all([
      this.supabase
        .from('po_advance_payments')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('po_id', poIds)
        .order('payment_date', { ascending: true }),
      this.supabase
        .from('grn_payment_entries')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('grn_id', grnIds)
        .order('payment_date', { ascending: true }),
      this.supabase
        .from('grn_payment_reversals')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('grn_id', grnIds)
        .order('reversed_at', { ascending: true }),
    ]);

    if (advanceResult.error) throw new Error(`Failed to fetch supplier advances: ${advanceResult.error.message}`);
    if (paymentResult.error) throw new Error(`Failed to fetch supplier payments: ${paymentResult.error.message}`);
    if (reversalResult.error) throw new Error(`Failed to fetch supplier payment reversals: ${reversalResult.error.message}`);

    const grnsByPo = this.groupRowsByKey(grnRows, 'po_id');
    const advancesByPo = this.groupRowsByKey(advanceResult.data || [], 'po_id');
    const entriesByPo = new Map<string, any[]>();
    const reversalsByPo = new Map<string, any[]>();
    const poIdByGrn = new Map(grnRows.map((grn: any) => [grn.id, grn.po_id]));

    for (const entry of paymentResult.data || []) {
      const poId = poIdByGrn.get(entry.grn_id);
      if (!poId) continue;
      const rows = entriesByPo.get(poId) || [];
      rows.push(entry);
      entriesByPo.set(poId, rows);
    }
    for (const reversal of reversalResult.data || []) {
      const poId = poIdByGrn.get(reversal.grn_id);
      if (!poId) continue;
      const rows = reversalsByPo.get(poId) || [];
      rows.push(reversal);
      reversalsByPo.set(poId, rows);
    }

    for (const poId of poIds) {
      try {
        const settlement = this.calculatePoSettlementFromRows(
          grnsByPo.get(poId) || [],
          advancesByPo.get(poId) || [],
          entriesByPo.get(poId) || [],
          reversalsByPo.get(poId) || [],
        );
        for (const invoice of settlement.invoices) {
          settlementByGrn.set(invoice.grn_id, {
            ...invoice.settlement,
            latest_payment_metadata: this.latestPaymentMetadata(invoice.payment_entries || []),
          });
        }
      } catch (error: any) {
        console.error('[AP] skipped batched PO settlement calculation', {
          poId,
          message: error?.message || String(error),
        });
      }
    }

    return settlementByGrn;
  }

  async getUnifiedAdvances(
    tenantId: string,
    filters?: {
      advance_type?: 'PO' | 'BLANKET' | 'ALL';
      vendor_id?: string;
      po_id?: string;
      has_balance?: boolean;
    },
  ) {
    let query = this.supabase
      .from('po_advance_payments')
      .select(`
        *,
        purchase_order:purchase_orders(id, po_number, grand_total),
        vendor:vendors(id, name, code),
        utilized_grn:grns(id, grn_number)
      `)
      .eq('tenant_id', tenantId)
      .order('payment_date', { ascending: false });

    // Apply filters
    if (filters?.advance_type && filters.advance_type !== 'ALL') {
      query = query.eq('advance_type', filters.advance_type);
    }

    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id);
    }

    if (filters?.po_id) {
      query = query.eq('po_id', filters.po_id);
    }

    if (filters?.has_balance === true) {
      query = query.gt('balance_amount', 0);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[getUnifiedAdvances] error:', error.message);
      throw new Error(`Failed to get advances: ${error.message}`);
    }

    return data || [];
  }

  // Sync payment status for GRNs based on PO advance coverage
  // Marks GRNs as PAID if PO advance covers the full invoice amount
  async syncPaymentStatusForPoAdvances(tenantId: string) {
    // Get all GRNs with their PO advances
    const { data: grns, error: grnError } = await this.supabase
      .from('grns')
      .select('id, po_id, net_payable_amount, paid_amount, tds_amount, short_payment_amount, payment_status')
      .eq('tenant_id', tenantId)
      .not('po_id', 'is', null);

    if (grnError) throw new Error(`Failed to fetch GRNs: ${grnError.message}`);

    const poIds = [...new Set((grns || []).map((grn: any) => grn.po_id).filter(Boolean))];
    const settlements = await Promise.all(poIds.map((poId) => this.getPoSettlement(tenantId, poId)));
    const statusByGrn = new Map<string, string>();
    for (const settlement of settlements) {
      for (const invoice of settlement.invoices) {
        statusByGrn.set(invoice.grn_id, invoice.settlement.paymentStatus);
      }
    }
    const updates = (grns || [])
      .map((grn: any) => ({ id: grn.id, payment_status: statusByGrn.get(grn.id) }))
      .filter((update: any) => update.payment_status);

    // Batch update all GRNs that should be PAID
    for (const update of updates) {
      await this.supabase
        .from('grns')
        .update({
          payment_status: update.payment_status,
          updated_at: new Date().toISOString()
        })
        .eq('id', update.id)
        .eq('tenant_id', tenantId);
    }

    console.log(`[syncPaymentStatus] Updated ${updates.length} GRNs to PAID based on PO advances`);
    return { updated: updates.length };
  }

  // Unified method to calculate GRN payment status - SINGLE SOURCE OF TRUTH
  // All frontend pages must use this for consistent payment status display
  async calculateGrnPaymentStatus(_tenantId: string, grn: any, advanceApplied = 0): Promise<{
    net_payable: number;
    paid_amount: number;
    tds_amount: number;
    short_payment_amount: number;
    po_advance_applied: number;
    total_settled: number;
    outstanding: number;
    is_fully_paid: boolean;
    payment_status: 'PAID' | 'PARTIAL' | 'UNPAID';
  }> {
    const netPayable = parseFloat(grn?.net_payable_amount || 0);
    const paidAmount = parseFloat(grn?.paid_amount || 0);
    const tdsAmount = parseFloat(grn?.tds_amount || 0);
    const shortAmount = parseFloat(grn?.short_payment_amount || 0);
    
    const poAdvance = Math.max(0, Number(advanceApplied || 0));
    const totalSettled = Math.min(netPayable, paidAmount + tdsAmount + shortAmount + poAdvance);
    const outstanding = Math.max(0, netPayable - totalSettled);
    const isFullyPaid = totalSettled >= netPayable - 0.009 || (grn?.payment_status || '').toUpperCase() === 'PAID';
    
    let paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
    if (isFullyPaid) {
      paymentStatus = 'PAID';
    } else if (totalSettled > 0) {
      paymentStatus = 'PARTIAL';
    } else {
      paymentStatus = 'UNPAID';
    }
    
    return {
      net_payable: netPayable,
      paid_amount: paidAmount,
      tds_amount: tdsAmount,
      short_payment_amount: shortAmount,
      po_advance_applied: poAdvance,
      total_settled: totalSettled,
      outstanding: outstanding,
      is_fully_paid: isFullyPaid,
      payment_status: paymentStatus,
    };
  }

  // Get all GRNs with unified payment status for a tenant
  async getGrnsWithPaymentStatus(tenantId: string, filters?: any) {
    // Fetch all GRNs
    let query = this.supabase
      .from('grns')
      .select(`
        *,
        purchase_order:purchase_orders(id, po_number, payment_terms, terms_and_conditions, customs_duty, other_charges),
        vendor:vendors(id, name, code, payment_terms)
      `)
      .eq('tenant_id', tenantId);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.vendorId) {
      query = query.eq('vendor_id', filters.vendorId);
    }

    if (filters?.poId) {
      query = query.eq('po_id', filters.poId);
    }

    if (filters?.search) {
      query = query.or(`grn_number.ilike.%${filters.search}%,invoice_number.ilike.%${filters.search}%`);
    }

    const { data: grns, error } = await query;
    if (error) throw error;

    const settlementByGrn = await this.getSettlementByGrnForRows(tenantId, grns || []);

    // Calculate unified payment status for each GRN
    const results = [];
    for (const grn of grns || []) {
      const allocated = settlementByGrn.get(grn.id);
      const latestPaymentMetadata = allocated?.latest_payment_metadata || {};
      const paymentStatus = allocated
        ? {
          net_payable: allocated.netPayable,
          paid_amount: allocated.cashPaid,
          tds_amount: allocated.tds,
          short_payment_amount: allocated.shortPayment,
          po_advance_applied: allocated.advanceApplied,
          total_settled: allocated.totalSettled,
          outstanding: allocated.outstanding,
          is_fully_paid: allocated.paymentStatus === 'PAID',
          payment_status: allocated.paymentStatus,
        }
        : await this.calculateGrnPaymentStatus(tenantId, grn, 0);
      results.push({
        ...grn,
        ...latestPaymentMetadata,
        ...derivePayableDueDate({
          receipt_date: grn.receipt_date,
          invoice_date: grn.invoice_date,
          po_payment_terms: grn.purchase_order?.payment_terms,
          po_terms_and_conditions: grn.purchase_order?.terms_and_conditions,
          vendor_payment_terms: grn.vendor?.payment_terms,
        }),
        _payment_calculation: paymentStatus,
      });
    }

    if (!filters?.poId && !filters?.status) {
      const subcontractRows = await this.getSubcontractPayableRows(tenantId, filters?.vendorId ? String(filters.vendorId) : undefined);
      if (subcontractRows.length > 0) {
        const vendorIds = Array.from(new Set(subcontractRows.map((row: any) => row.vendor_id).filter(Boolean)));
        const vendorById = new Map<string, any>();
        if (vendorIds.length > 0) {
          const { data: vendors } = await this.supabase
            .from('vendors')
            .select('id, name, code, payment_terms')
            .eq('tenant_id', tenantId)
            .in('id', vendorIds);
          (vendors || []).forEach((vendor: any) => vendorById.set(vendor.id, vendor));
        }

        for (const row of subcontractRows) {
          const vendor = vendorById.get(row.vendor_id) || null;
          results.push({
            ...row,
            vendor,
            ...derivePayableDueDate({
              receipt_date: row.receipt_date,
              invoice_date: row.invoice_date,
              vendor_payment_terms: vendor?.payment_terms,
            }),
            _payment_calculation: {
              net_payable: row.net_payable_amount,
              paid_amount: row.paid_amount,
              tds_amount: 0,
              short_payment_amount: 0,
              po_advance_applied: 0,
              total_settled: row.paid_amount,
              outstanding: row.outstanding_amount,
              is_fully_paid: row.payment_status === 'PAID',
              payment_status: row.payment_status,
            },
          });
        }
      }
    }

    return results;
  }
}
