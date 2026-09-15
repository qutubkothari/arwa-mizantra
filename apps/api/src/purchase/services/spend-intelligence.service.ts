import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SpendIntelligenceService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private fail(error: any, fallback: string): never { throw new BadRequestException(error?.message || fallback); }
  private n(value: any) { const number = Number(value || 0); return Number.isFinite(number) ? number : 0; }
  private t(value: any) { return String(value || '').trim(); }

  async dashboard(tenantId: string) {
    const [{ data: orders, error: orderError }, { data: receipts, error: receiptError }, { data: opportunities, error: opportunityError }, { data: tenant, error: tenantError }] = await Promise.all([
      this.db.from('purchase_orders').select('*,vendor:vendors(id,name,code),purchase_order_items(*)').eq('tenant_id', tenantId).order('po_date', { ascending: false }),
      this.db.from('grns').select('id,po_id,vendor_id,receipt_date,status,grn_items(accepted_qty,rejected_qty)').eq('tenant_id', tenantId),
      this.db.from('procurement_savings_opportunities').select('*,vendor:vendors(id,name,code)').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      this.db.from('tenants').select('market_profile').eq('id', tenantId).maybeSingle(),
    ]);
    if (orderError) this.fail(orderError, 'Unable to analyse purchase orders.'); if (receiptError) this.fail(receiptError, 'Unable to analyse receipts.'); if (opportunityError) this.fail(opportunityError, 'Unable to load savings pipeline.'); if (tenantError) this.fail(tenantError, 'Unable to load company market profile.');
    const validOrders = (orders || []).filter((po: any) => !['DRAFT', 'REJECTED', 'CANCELLED'].includes(this.t(po.status).toUpperCase()));
    const spendByVendor = new Map<string, any>(); const priceGroups = new Map<string, any[]>(); let totalSpend = 0;
    for (const po of validOrders) {
      const spend = this.n(po.grand_total || po.total_amount); totalSpend += spend; const vendorId = this.t(po.vendor_id);
      const vendor = spendByVendor.get(vendorId) || { vendor_id: vendorId, vendor_name: po.vendor?.name || po.vendor?.code || 'Unknown vendor', spend: 0, po_count: 0, on_time_orders: 0, received_orders: 0, accepted_qty: 0, rejected_qty: 0 };
      vendor.spend += spend; vendor.po_count += 1; spendByVendor.set(vendorId, vendor);
      for (const line of po.purchase_order_items || []) { const key = this.t(line.item_code || line.item_name).toUpperCase(); if (!key) continue; const rows = priceGroups.get(key) || []; rows.push({ po_id: po.id, po_number: po.po_number, vendor_id: vendorId, vendor_name: vendor.vendor_name, item_code: line.item_code || key, item_name: line.item_name || key, rate: this.n(line.rate || line.unit_price), qty: this.n(line.ordered_qty || line.quantity) }); priceGroups.set(key, rows); }
    }
    const orderById = new Map(validOrders.map((po: any) => [String(po.id), po]));
    for (const grn of receipts || []) { if (['REJECTED', 'CANCELLED'].includes(this.t(grn.status).toUpperCase())) continue; const po: any = orderById.get(String(grn.po_id)); if (!po) continue; const vendor = spendByVendor.get(this.t(po.vendor_id)); if (!vendor) continue; vendor.received_orders += 1; const due = po.expected_delivery || po.delivery_date; if (due && grn.receipt_date && String(grn.receipt_date) <= String(due)) vendor.on_time_orders += 1; for (const item of grn.grn_items || []) { vendor.accepted_qty += this.n(item.accepted_qty); vendor.rejected_qty += this.n(item.rejected_qty); } }
    const suppliers = Array.from(spendByVendor.values()).map((v: any) => ({ ...v, spend_share_pct: totalSpend ? v.spend / totalSpend * 100 : 0, on_time_pct: v.received_orders ? v.on_time_orders / v.received_orders * 100 : null, rejection_pct: v.accepted_qty + v.rejected_qty ? v.rejected_qty / (v.accepted_qty + v.rejected_qty) * 100 : null })).sort((a: any, b: any) => b.spend - a.spend);
    const priceOpportunities: any[] = []; let priceVariancePotential = 0;
    for (const rows of priceGroups.values()) { const priced = rows.filter((x: any) => x.rate > 0 && x.qty > 0); const vendors = new Set(priced.map((x: any) => x.vendor_id)); if (priced.length < 2 || vendors.size < 2) continue; const best = Math.min(...priced.map((x: any) => x.rate)); const latest = priced[0]; const potential = priced.reduce((s: number, x: any) => s + Math.max(0, x.rate - best) * x.qty, 0); if (potential <= 0) continue; priceVariancePotential += potential; priceOpportunities.push({ item_code: latest.item_code, item_name: latest.item_name, best_rate: best, highest_rate: Math.max(...priced.map((x: any) => x.rate)), suppliers: vendors.size, potential_savings: potential }); }
    priceOpportunities.sort((a, b) => b.potential_savings - a.potential_savings);
    const pipeline = opportunities || []; const openExpected = pipeline.filter((x: any) => !['REALIZED', 'DISMISSED'].includes(x.status)).reduce((s: number, x: any) => s + this.n(x.expected_savings), 0); const realized = pipeline.filter((x: any) => x.status === 'REALIZED').reduce((s: number, x: any) => s + this.n(x.realized_savings), 0);
    const currencyCode = String(tenant?.market_profile || 'INDIA').toUpperCase() === 'UAE' ? 'AED' : 'INR';
    return { currency_code: currencyCode, kpis: { total_spend: totalSpend, supplier_count: suppliers.length, top_supplier_share_pct: suppliers[0]?.spend_share_pct || 0, price_variance_potential: priceVariancePotential, pipeline_expected: openExpected, realized_savings: realized }, suppliers, price_opportunities: priceOpportunities.slice(0, 25), opportunities: pipeline };
  }
  async createOpportunity(tenantId: string, userId: string, b: any) {
    const title = this.t(b.title); const type = this.t(b.opportunity_type).toUpperCase(); const expected = this.n(b.expected_savings); if (!title || !['PRICE_VARIANCE','SUPPLIER_CONCENTRATION','VOLUME_CONSOLIDATION','PAYMENT_TERMS','PROCESS_LEAKAGE','OTHER'].includes(type) || expected <= 0) this.fail(null, 'Title, valid opportunity type and positive expected savings are required.');
    const { data, error } = await this.db.from('procurement_savings_opportunities').insert({ tenant_id: tenantId, title, opportunity_type: type, vendor_id: b.vendor_id || null, item_code: this.t(b.item_code) || null, baseline_spend: this.n(b.baseline_spend), expected_savings: expected, owner_user_id: b.owner_user_id || userId, target_date: b.target_date || null, notes: this.t(b.notes) || null, created_by: userId }).select().single(); if (error) this.fail(error, 'Unable to create savings opportunity.'); return data;
  }
  async updateOpportunity(tenantId: string, userId: string, id: string, b: any) {
    const { data: current } = await this.db.from('procurement_savings_opportunities').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle(); if (!current) this.fail(null, 'Savings opportunity not found.');
    const status = this.t(b.status).toUpperCase(); if (!['VALIDATED','NEGOTIATING','REALIZED','DISMISSED'].includes(status)) this.fail(null, 'Invalid savings stage.'); if (['VALIDATED','REALIZED'].includes(status) && current.created_by === userId) this.fail(null, 'Maker-checker control prevents the creator from validating or realizing savings.');
    const patch: any = { status, notes: this.t(b.notes) || current.notes, updated_at: new Date().toISOString() };
    if (status === 'VALIDATED') { patch.validated_by = userId; patch.validated_at = new Date().toISOString(); }
    if (status === 'REALIZED') { const amount = this.n(b.realized_savings); const evidence = this.t(b.evidence_reference); if (amount <= 0 || !evidence) this.fail(null, 'Positive realized savings and evidence reference are required.'); patch.realized_savings = amount; patch.evidence_reference = evidence; patch.realized_by = userId; patch.realized_at = new Date().toISOString(); }
    const { data, error } = await this.db.from('procurement_savings_opportunities').update(patch).eq('tenant_id', tenantId).eq('id', id).select().single(); if (error) this.fail(error, 'Unable to update savings opportunity.'); return data;
  }
}
