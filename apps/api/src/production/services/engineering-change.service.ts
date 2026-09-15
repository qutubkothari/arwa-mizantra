import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class EngineeringChangeService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private fail(error: any, fallback: string): never { throw new BadRequestException(error?.message || fallback); }
  private text(value: any) { return String(value || '').trim(); }
  private number(value: any) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
  private async request(tenantId: string, id: string) {
    const { data, error } = await this.db.from('engineering_change_requests').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (error || !data) this.fail(error, 'Engineering change was not found.');
    return data;
  }

  async dashboard(tenantId: string) {
    const [{ data: changes, error: changeError }, { data: impacts, error: impactError }, { data: items, error: itemError }, { data: boms, error: bomError }] = await Promise.all([
      this.db.from('engineering_change_requests').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      this.db.from('engineering_change_impacts').select('*').eq('tenant_id', tenantId),
      this.db.from('items').select('*').eq('tenant_id', tenantId).order('code'),
      this.db.from('bom_headers').select('id,item_id,version,is_active').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    ]);
    if (changeError) this.fail(changeError, 'Unable to load engineering changes.');
    if (impactError) this.fail(impactError, 'Unable to load engineering impacts.');
    if (itemError) this.fail(itemError, 'Unable to load items.');
    if (bomError) this.fail(bomError, 'Unable to load BOMs.');
    const itemMap = new Map((items || []).map((item: any) => [String(item.id), item]));
    const rows = (changes || []).map((change: any) => {
      const lines = (impacts || []).filter((impact: any) => String(impact.change_request_id) === String(change.id));
      return { ...change, item: itemMap.get(String(change.affected_item_id)), impacts: lines, exposure_value: lines.reduce((sum: number, line: any) => sum + this.number(line.exposure_value), 0), where_used_count: lines.filter((line: any) => line.impact_type === 'BOM_WHERE_USED').length };
    });
    const verified = rows.filter((row: any) => row.status === 'VERIFIED');
    return {
      kpis: {
        open_changes: rows.filter((row: any) => !['VERIFIED', 'REJECTED', 'CANCELLED'].includes(row.status)).length,
        high_risk: rows.filter((row: any) => this.number(row.risk_score) >= 15 && !['VERIFIED', 'CANCELLED'].includes(row.status)).length,
        inventory_exposure: rows.filter((row: any) => !['VERIFIED', 'CANCELLED'].includes(row.status)).reduce((sum: number, row: any) => sum + row.exposure_value, 0),
        avoidance_pipeline: rows.filter((row: any) => !['VERIFIED', 'REJECTED', 'CANCELLED'].includes(row.status)).reduce((sum: number, row: any) => sum + this.number(row.estimated_avoidance), 0),
        verified_avoidance: verified.reduce((sum: number, row: any) => sum + this.number(row.realized_avoidance), 0),
        average_cycle_days: verified.length ? verified.reduce((sum: number, row: any) => sum + (new Date(row.verified_at).getTime() - new Date(row.created_at).getTime()) / 86400000, 0) / verified.length : 0,
      },
      changes: rows,
      items: items || [],
      boms: (boms || []).map((bom: any) => ({ ...bom, item: itemMap.get(String(bom.item_id)) })),
    };
  }

  async create(tenantId: string, userId: string, body: any) {
    const title = this.text(body.title), type = this.text(body.change_type).toUpperCase(), reason = this.text(body.reason);
    const priority = this.text(body.priority || 'MEDIUM').toUpperCase();
    const risk = Math.floor(this.number(body.risk_score || 1));
    if (!title || !reason || !['DESIGN','MATERIAL','PROCESS','SUPPLIER','QUALITY','COMPLIANCE','COST'].includes(type) || !['LOW','MEDIUM','HIGH','CRITICAL'].includes(priority) || risk < 1 || risk > 25) this.fail(null, 'Title, reason, valid type, priority and risk score (1-25) are required.');
    if (!body.affected_item_id && !body.affected_bom_id) this.fail(null, 'Select an affected item or BOM.');
    const date = new Date(), changeNumber = `ECN-${date.toISOString().slice(0,10).replace(/-/g,'')}-${date.getTime().toString().slice(-6)}`;
    const { data, error } = await this.db.from('engineering_change_requests').insert({ tenant_id: tenantId, change_number: changeNumber, title, change_type: type, priority, reason, proposed_solution: this.text(body.proposed_solution) || null, affected_item_id: body.affected_item_id || null, affected_bom_id: body.affected_bom_id || null, effective_date: body.effective_date || null, risk_score: risk, estimated_change_cost: this.number(body.estimated_change_cost), estimated_avoidance: this.number(body.estimated_avoidance), created_by: userId }).select().single();
    if (error) this.fail(error, 'Unable to create engineering change.');
    return data;
  }

  async assess(tenantId: string, userId: string, id: string) {
    const change = await this.request(tenantId, id);
    if (!['DRAFT','ASSESSED'].includes(change.status)) this.fail(null, 'Only a draft or assessed change can be reassessed.');
    await this.db.from('engineering_change_impacts').delete().eq('tenant_id', tenantId).eq('change_request_id', id).eq('source', 'AUTO');
    const itemId = change.affected_item_id;
    const generated: any[] = [];
    if (itemId) {
      const [{ data: item }, { data: stock, error: stockError }, { data: usages, error: usageError }] = await Promise.all([
        this.db.from('items').select('*').eq('tenant_id', tenantId).eq('id', itemId).maybeSingle(),
        this.db.from('inventory_stock').select('quantity,available_quantity').eq('tenant_id', tenantId).eq('item_id', itemId),
        this.db.from('bom_items').select('id,bom_id,quantity').eq('item_id', itemId),
      ]);
      if (stockError) this.fail(stockError, 'Unable to assess inventory exposure.');
      if (usageError) this.fail(usageError, 'Unable to assess BOM where-used exposure.');
      const quantity = (stock || []).reduce((sum: number, row: any) => sum + this.number(row.quantity ?? row.available_quantity), 0);
      const unitCost = this.number(item?.standard_cost || item?.unit_price || item?.foreign_unit_price);
      if (quantity > 0) generated.push({ tenant_id: tenantId, change_request_id: id, impact_type: 'INVENTORY', reference_id: itemId, reference_label: `${item?.code || 'ITEM'} - on-hand stock`, quantity_at_risk: quantity, unit_cost: unitCost, exposure_value: quantity * unitCost, disposition: 'REVIEW', source: 'AUTO', created_by: userId });
      const bomIds = [...new Set((usages || []).map((row: any) => row.bom_id).filter(Boolean))];
      if (bomIds.length) {
        const { data: headers, error } = await this.db.from('bom_headers').select('id,item_id,version').eq('tenant_id', tenantId).in('id', bomIds);
        if (error) this.fail(error, 'Unable to resolve BOM where-used records.');
        const parentIds = [...new Set((headers || []).map((row: any) => row.item_id).filter(Boolean))];
        const { data: parents } = parentIds.length ? await this.db.from('items').select('id,code,name').eq('tenant_id', tenantId).in('id', parentIds) : { data: [] as any[] };
        const parentMap = new Map((parents || []).map((row: any) => [String(row.id), row]));
        for (const header of headers || []) { const parent: any = parentMap.get(String(header.item_id)); generated.push({ tenant_id: tenantId, change_request_id: id, impact_type: 'BOM_WHERE_USED', reference_id: header.id, reference_label: `${parent?.code || 'BOM'} v${header.version} - ${parent?.name || 'where used'}`, disposition: 'REVIEW', source: 'AUTO', created_by: userId }); }
      }
    }
    if (change.affected_bom_id && !generated.some((row) => String(row.reference_id) === String(change.affected_bom_id))) generated.push({ tenant_id: tenantId, change_request_id: id, impact_type: 'BOM_WHERE_USED', reference_id: change.affected_bom_id, reference_label: 'Directly affected BOM', disposition: 'REVIEW', source: 'AUTO', created_by: userId });
    if (generated.length) { const { error } = await this.db.from('engineering_change_impacts').insert(generated); if (error) this.fail(error, 'Unable to save impact assessment.'); }
    const { data, error } = await this.db.from('engineering_change_requests').update({ status: 'ASSESSED', updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).select().single();
    if (error) this.fail(error, 'Unable to complete assessment.');
    return data;
  }

  async addImpact(tenantId: string, userId: string, id: string, body: any) {
    const change = await this.request(tenantId, id), type = this.text(body.impact_type).toUpperCase(), label = this.text(body.reference_label);
    if (!['DRAFT','ASSESSED'].includes(change.status) || !label || !['INVENTORY','BOM_WHERE_USED','WORK_ORDER','SUPPLIER','CUSTOMER','QUALITY','COMPLIANCE','OTHER'].includes(type)) this.fail(null, 'Manual impacts can only be added to a draft/assessed change with a valid type and label.');
    const quantity = this.number(body.quantity_at_risk), unitCost = this.number(body.unit_cost);
    const { data, error } = await this.db.from('engineering_change_impacts').insert({ tenant_id: tenantId, change_request_id: id, impact_type: type, reference_label: label, quantity_at_risk: quantity, unit_cost: unitCost, exposure_value: quantity * unitCost, disposition: this.text(body.disposition || 'REVIEW').toUpperCase(), notes: this.text(body.notes) || null, source: 'MANUAL', created_by: userId }).select().single();
    if (error) this.fail(error, 'Unable to add impact.'); return data;
  }

  async submit(tenantId: string, userId: string, id: string) {
    const change = await this.request(tenantId, id);
    if (change.status !== 'ASSESSED') this.fail(null, 'Run impact assessment before submission.');
    const { count } = await this.db.from('engineering_change_impacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('change_request_id', id);
    if (!count) this.fail(null, 'At least one impact record is required before submission.');
    return this.transition(tenantId, id, 'ASSESSED', { status: 'SUBMITTED', submitted_by: userId, submitted_at: new Date().toISOString() }, 'Unable to submit engineering change.');
  }
  async approve(tenantId: string, userId: string, id: string, body: any) { const change = await this.request(tenantId, id), note = this.text(body.approval_note); if (change.status !== 'SUBMITTED' || change.created_by === userId || !note) this.fail(null, 'Independent approval with an approval note is required.'); return this.transition(tenantId, id, 'SUBMITTED', { status: 'APPROVED', approved_by: userId, approved_at: new Date().toISOString(), approval_note: note }, 'Unable to approve engineering change.'); }
  async implement(tenantId: string, userId: string, id: string, body: any) { const change = await this.request(tenantId, id), evidence = this.text(body.implementation_evidence); if (change.status !== 'APPROVED' || !evidence) this.fail(null, 'Only an approved change with implementation evidence can be implemented.'); return this.transition(tenantId, id, 'APPROVED', { status: 'IMPLEMENTED', implemented_by: userId, implemented_at: new Date().toISOString(), implementation_evidence: evidence }, 'Unable to record implementation.'); }
  async verify(tenantId: string, userId: string, id: string, body: any) { const change = await this.request(tenantId, id), evidence = this.text(body.verification_evidence), avoidance = this.number(body.realized_avoidance); if (change.status !== 'IMPLEMENTED' || change.implemented_by === userId || !evidence || avoidance < 0) this.fail(null, 'Independent verification, evidence, and a non-negative realized avoidance value are required.'); return this.transition(tenantId, id, 'IMPLEMENTED', { status: 'VERIFIED', verified_by: userId, verified_at: new Date().toISOString(), verification_evidence: evidence, realized_avoidance: avoidance }, 'Unable to verify engineering change.'); }
  private async transition(tenantId: string, id: string, expected: string, values: any, fallback: string) { const { data, error } = await this.db.from('engineering_change_requests').update({ ...values, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).eq('status', expected).select().maybeSingle(); if (error || !data) this.fail(error, fallback); return data; }
}
