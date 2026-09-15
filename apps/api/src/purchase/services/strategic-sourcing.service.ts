import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class StrategicSourcingService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private fail(error: any, fallback: string): never { throw new BadRequestException(error?.message || fallback); }
  private n(value: any) { const number = Number(value || 0); return Number.isFinite(number) ? number : 0; }
  private t(value: any) { return String(value || '').trim(); }

  async board(tenantId: string) {
    const [{ data: rfqs, error: rfqError }, { data: evaluations, error: evalError }, { data: awards, error: awardError }] = await Promise.all([
      this.db.from('rfqs').select('*,vendor:vendors(id,name,code),rfq_items(*)').eq('tenant_id', tenantId).eq('status', 'RECEIVED').order('created_at', { ascending: false }),
      this.db.from('sourcing_bid_evaluations').select('*').eq('tenant_id', tenantId),
      this.db.from('sourcing_award_decisions').select('*,vendor:vendors!sourcing_award_decisions_vendor_id_fkey(id,name,code)').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    ]);
    if (rfqError) this.fail(rfqError, 'Unable to load received RFQs.'); if (evalError) this.fail(evalError, 'Unable to load bid evaluations.'); if (awardError) this.fail(awardError, 'Unable to load sourcing awards.');
    const prIds = [...new Set((rfqs || []).map((x: any) => x.pr_id).filter(Boolean))];
    const { data: prs, error: prError } = prIds.length ? await this.db.from('purchase_requisitions').select('id,pr_number,department').eq('tenant_id', tenantId).in('id', prIds) : { data: [], error: null } as any; if (prError) this.fail(prError, 'Unable to load requisitions.');
    const prMap = new Map((prs || []).map((x: any) => [String(x.id), x])); const evalMap = new Map((evaluations || []).map((x: any) => [String(x.rfq_id), x])); const groups = new Map<string, any>();
    for (const rfq of rfqs || []) for (const item of rfq.rfq_items || []) { const price = this.n(item.vendor_quoted_price); if (price <= 0 || !item.pr_item_id) continue; const key = String(item.pr_item_id); const group = groups.get(key) || { pr_id: rfq.pr_id, pr_item_id: item.pr_item_id, pr_number: prMap.get(String(rfq.pr_id))?.pr_number || 'PR', department: prMap.get(String(rfq.pr_id))?.department || null, item_code: item.item_code, item_name: item.item_name, requested_qty: this.n(item.requested_qty), offers: [] }; const evaluation: any = evalMap.get(String(rfq.id)); group.offers.push({ rfq_id: rfq.id, rfq_number: rfq.rfq_number, vendor_id: rfq.vendor_id, vendor_name: rfq.vendor?.name || rfq.vendor?.code || 'Vendor', unit_price: price, lead_time_days: this.n(item.vendor_quoted_lead_time), technical_score: evaluation ? this.n(evaluation.technical_score) : 50, risk_score: evaluation ? this.n(evaluation.risk_score) : 50, evaluated: !!evaluation }); groups.set(key, group); }
    const comparisons = Array.from(groups.values()).map((group: any) => { const bestPrice = Math.min(...group.offers.map((x: any) => x.unit_price)); const positiveLeads = group.offers.map((x: any) => x.lead_time_days).filter((x: number) => x > 0); const bestLead = positiveLeads.length ? Math.min(...positiveLeads) : 0; group.offers = group.offers.map((x: any) => ({ ...x, price_score: bestPrice / x.unit_price * 100, lead_score: bestLead && x.lead_time_days ? bestLead / x.lead_time_days * 100 : 50, weighted_score: bestPrice / x.unit_price * 50 + (bestLead && x.lead_time_days ? bestLead / x.lead_time_days * 100 : 50) * .2 + x.technical_score * .2 + x.risk_score * .1 })).sort((a: any, b: any) => b.weighted_score - a.weighted_score); group.recommended_vendor_id = group.offers[0]?.vendor_id; group.baseline_unit_price = Math.max(...group.offers.map((x: any) => x.unit_price)); group.potential_savings = Math.max(0, (group.baseline_unit_price - bestPrice) * group.requested_qty); return group; }).sort((a: any, b: any) => b.potential_savings - a.potential_savings);
    const approvedSavings = (awards || []).filter((x: any) => x.status === 'APPROVED').reduce((s: number, x: any) => s + this.n(x.expected_savings), 0);
    return { kpis: { comparable_lines: comparisons.filter((x: any) => x.offers.length > 1).length, suppliers_compared: new Set(comparisons.flatMap((x: any) => x.offers.map((o: any) => o.vendor_id))).size, potential_savings: comparisons.reduce((s: number, x: any) => s + x.potential_savings, 0), approved_savings: approvedSavings }, comparisons, awards: awards || [], weights: { price: 50, lead_time: 20, technical: 20, risk: 10 } };
  }
  async evaluate(tenantId: string, userId: string, b: any) {
    const technical = this.n(b.technical_score), risk = this.n(b.risk_score); if (!b.rfq_id || technical < 0 || technical > 100 || risk < 0 || risk > 100) this.fail(null, 'RFQ and scores from 0 to 100 are required.');
    const { data: rfq } = await this.db.from('rfqs').select('id').eq('tenant_id', tenantId).eq('id', b.rfq_id).eq('status', 'RECEIVED').maybeSingle(); if (!rfq) this.fail(null, 'Only a received RFQ can be evaluated.');
    const { data, error } = await this.db.from('sourcing_bid_evaluations').upsert({ tenant_id: tenantId, rfq_id: b.rfq_id, technical_score: technical, risk_score: risk, evaluation_notes: this.t(b.evaluation_notes) || null, evaluated_by: userId, evaluated_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,rfq_id' }).select().single(); if (error) this.fail(error, 'Unable to save bid evaluation.'); return data;
  }
  async draftAward(tenantId: string, userId: string, b: any) {
    const board = await this.board(tenantId); const line: any = board.comparisons.find((x: any) => String(x.pr_item_id) === String(b.pr_item_id)); const offer = line?.offers.find((x: any) => String(x.rfq_id) === String(b.rfq_id)); if (!line || !offer) this.fail(null, 'Comparable bid line was not found.');
    const deviation = this.t(b.deviation_reason); if (String(offer.vendor_id) !== String(line.recommended_vendor_id) && !deviation) this.fail(null, 'A deviation reason is required when the recommended supplier is not selected.');
    const existing = board.awards.find((x: any) => String(x.pr_item_id) === String(line.pr_item_id)); if (existing?.status === 'APPROVED') this.fail(null, 'An approved award cannot be replaced.');
    const payload = { tenant_id: tenantId, pr_id: line.pr_id, pr_item_id: line.pr_item_id, rfq_id: offer.rfq_id, vendor_id: offer.vendor_id, requested_qty: line.requested_qty, selected_unit_price: offer.unit_price, baseline_unit_price: line.baseline_unit_price, expected_savings: Math.max(0, (line.baseline_unit_price - offer.unit_price) * line.requested_qty), weighted_score: offer.weighted_score, recommended_vendor_id: line.recommended_vendor_id, scoring_snapshot: { weights: board.weights, offers: line.offers }, deviation_reason: deviation || null, status: 'DRAFT', created_by: userId, updated_at: new Date().toISOString() };
    const { data, error } = await this.db.from('sourcing_award_decisions').upsert(payload, { onConflict: 'tenant_id,pr_item_id' }).select().single(); if (error) this.fail(error, 'Unable to draft award decision.'); return data;
  }
  async decide(tenantId: string, userId: string, id: string, b: any) {
    const { data: award } = await this.db.from('sourcing_award_decisions').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle(); if (!award || award.status !== 'DRAFT') this.fail(null, 'Only a draft award can be decided.'); if (award.created_by === userId) this.fail(null, 'Maker-checker control prevents self-approval.'); const status = this.t(b.status).toUpperCase(); if (!['APPROVED','REJECTED'].includes(status)) this.fail(null, 'Decision must be APPROVED or REJECTED.'); const evidence = this.t(b.evidence_reference); if (status === 'APPROVED' && !evidence) this.fail(null, 'Approval evidence reference is required.');
    const { data, error } = await this.db.from('sourcing_award_decisions').update({ status, approved_by: userId, approved_at: new Date().toISOString(), evidence_reference: evidence || null, approval_notes: this.t(b.approval_notes) || null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).select().single(); if (error) this.fail(error, 'Unable to decide award.'); return data;
  }
}

