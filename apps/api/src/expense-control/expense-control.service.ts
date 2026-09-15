import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ExpenseControlService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private fail(error: any, fallback: string): never { throw new BadRequestException(error?.message || fallback); }
  private text(value: any) { return String(value || '').trim(); }
  private async event(tenantId: string, claimId: string, actor: string, type: string, notes?: string, data: any = {}) {
    await this.db.from('expense_claim_events').insert({ tenant_id: tenantId, claim_id: claimId, actor_user_id: actor, event_type: type, notes: notes || null, event_data: data });
  }

  async dashboard(tenantId: string) {
    const { data, error } = await this.db.from('expense_claims').select('*,items:expense_claim_items(*)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
    if (error) this.fail(error, 'Unable to load expense claims.');
    const claims = data || [];
    return {
      kpis: {
        submitted_value: claims.filter((x: any) => x.status === 'SUBMITTED').reduce((s: number, x: any) => s + Number(x.total_claimed || 0), 0),
        approved_value: claims.filter((x: any) => ['APPROVED', 'REIMBURSED'].includes(x.status)).reduce((s: number, x: any) => s + Number(x.total_approved || 0), 0),
        prevented_leakage: claims.filter((x: any) => x.status === 'REJECTED').reduce((s: number, x: any) => s + Number(x.avoided_leakage || 0), 0),
        exceptions: claims.reduce((s: number, x: any) => s + (x.items || []).filter((i: any) => ['EXCEPTION', 'DUPLICATE'].includes(i.policy_status)).length, 0),
      }, claims,
    };
  }
  async policies(tenantId: string) { const { data, error } = await this.db.from('expense_policies').select('*').eq('tenant_id', tenantId).order('category'); if (error) this.fail(error, 'Unable to load policies.'); return data || []; }
  async savePolicy(tenantId: string, b: any) {
    const category = this.text(b.category).toUpperCase(); if (!category) this.fail(null, 'Category is required.');
    const payload = { tenant_id: tenantId, category, max_item_amount: b.max_item_amount === '' ? null : Number(b.max_item_amount), receipt_required_above: Number(b.receipt_required_above || 0), requires_business_purpose: b.requires_business_purpose !== false && b.requires_business_purpose !== 'false', enabled: b.enabled !== false && b.enabled !== 'false', updated_at: new Date().toISOString() };
    if (payload.max_item_amount !== null && payload.max_item_amount <= 0) this.fail(null, 'Maximum item amount must be positive.');
    const { data, error } = await this.db.from('expense_policies').upsert(payload, { onConflict: 'tenant_id,category' }).select().single(); if (error) this.fail(error, 'Unable to save policy.'); return data;
  }
  async createClaim(tenantId: string, userId: string, b: any) {
    const title = this.text(b.title); if (!title) this.fail(null, 'Claim title is required.');
    const claim_number = `EXP-${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data, error } = await this.db.from('expense_claims').insert({ tenant_id: tenantId, claimant_user_id: userId, claim_number, title, currency: this.text(b.currency || 'AED').toUpperCase() }).select().single();
    if (error) this.fail(error, 'Unable to create claim.'); await this.event(tenantId, data.id, userId, 'CREATED'); return data;
  }
  async addItem(tenantId: string, userId: string, claimId: string, b: any) {
    const { data: claim } = await this.db.from('expense_claims').select('*').eq('tenant_id', tenantId).eq('id', claimId).maybeSingle();
    if (!claim || claim.status !== 'DRAFT' || claim.claimant_user_id !== userId) this.fail(null, 'Only the claimant can edit a draft claim.');
    const amount = Number(b.claimed_amount); const tax = Number(b.tax_amount || 0); if (!b.expense_date || !this.text(b.category) || !this.text(b.merchant) || !(amount > 0)) this.fail(null, 'Date, category, merchant and positive amount are required.');
    if (String(b.expense_date) > new Date().toISOString().slice(0, 10)) this.fail(null, 'Expense date cannot be in the future.');
    if (tax < 0 || tax > amount) this.fail(null, 'Tax amount must be between zero and the claimed amount.');
    const { data, error } = await this.db.from('expense_claim_items').insert({ tenant_id: tenantId, claim_id: claimId, expense_date: b.expense_date, category: this.text(b.category).toUpperCase(), merchant: this.text(b.merchant), business_purpose: this.text(b.business_purpose) || null, claimed_amount: amount, tax_amount: tax, receipt_reference: this.text(b.receipt_reference) || null }).select().single();
    if (error) this.fail(error, 'Unable to add expense.'); await this.event(tenantId, claimId, userId, 'ITEM_ADDED', undefined, { item_id: data.id, amount }); return data;
  }
  async submit(tenantId: string, userId: string, claimId: string) {
    const [{ data: claim }, { data: items, error }, { data: policies }] = await Promise.all([
      this.db.from('expense_claims').select('*').eq('tenant_id', tenantId).eq('id', claimId).maybeSingle(),
      this.db.from('expense_claim_items').select('*').eq('tenant_id', tenantId).eq('claim_id', claimId),
      this.db.from('expense_policies').select('*').eq('tenant_id', tenantId).eq('enabled', true),
    ]);
    if (!claim || claim.status !== 'DRAFT' || claim.claimant_user_id !== userId) this.fail(null, 'Only the claimant can submit a draft claim.');
    if (error || !items?.length) this.fail(error, 'Add at least one expense item before submission.');
    let total = 0, exception = 0, leakage = 0;
    for (const item of items) {
      const findings: string[] = []; const amount = Number(item.claimed_amount); total += amount;
      const policy: any = (policies || []).find((p: any) => p.category === item.category);
      if (!policy) findings.push('No active policy configured for this category.');
      if (policy?.requires_business_purpose && !this.text(item.business_purpose)) findings.push('Business purpose is required.');
      if (policy && amount > Number(policy.receipt_required_above || 0) && !item.receipt_reference) findings.push('Receipt evidence is required.');
      if (policy?.max_item_amount && amount > Number(policy.max_item_amount)) { findings.push(`Amount exceeds policy limit of ${Number(policy.max_item_amount).toFixed(2)}.`); leakage += amount - Number(policy.max_item_amount); }
      const { data: dupes } = await this.db.from('expense_claim_items').select('id,claim_id').eq('tenant_id', tenantId).eq('expense_date', item.expense_date).ilike('merchant', item.merchant).eq('claimed_amount', amount).neq('id', item.id).limit(1);
      const duplicate = dupes?.[0]; if (duplicate) { findings.push('Possible duplicate expense detected.'); leakage += amount; }
      if (findings.length) exception += amount;
      const status = duplicate ? 'DUPLICATE' : findings.length ? 'EXCEPTION' : 'PASS';
      const { error: itemError } = await this.db.from('expense_claim_items').update({ policy_status: status, policy_findings: findings, duplicate_of: duplicate?.id || null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', item.id); if (itemError) this.fail(itemError, 'Unable to validate claim item.');
    }
    leakage = Math.min(total, leakage);
    const { data, error: updateError } = await this.db.from('expense_claims').update({ status: 'SUBMITTED', total_claimed: total, exception_amount: exception, avoided_leakage: leakage, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', claimId).select().single();
    if (updateError) this.fail(updateError, 'Unable to submit claim.'); await this.event(tenantId, claimId, userId, 'SUBMITTED', undefined, { total, exception, leakage }); return data;
  }
  async review(tenantId: string, reviewerId: string, claimId: string, b: any) {
    const { data: claim } = await this.db.from('expense_claims').select('*').eq('tenant_id', tenantId).eq('id', claimId).maybeSingle(); if (!claim || claim.status !== 'SUBMITTED') this.fail(null, 'Only submitted claims can be reviewed.'); if (claim.claimant_user_id === reviewerId) this.fail(null, 'Maker-checker control prevents self-approval.');
    const status = this.text(b.status).toUpperCase(); if (!['APPROVED', 'REJECTED'].includes(status)) this.fail(null, 'Review status must be APPROVED or REJECTED.');
    const allow = b.allow_exceptions === true || b.allow_exceptions === 'true'; if (status === 'APPROVED' && Number(claim.exception_amount) > 0 && !allow) this.fail(null, 'Policy exceptions require explicit override approval.');
    const approved = status === 'APPROVED' ? Number(claim.total_claimed) : 0;
    const { data: items, error: itemsError } = await this.db.from('expense_claim_items').select('id,claimed_amount').eq('tenant_id', tenantId).eq('claim_id', claimId); if (itemsError) this.fail(itemsError, 'Unable to load claim items.');
    for (const item of items || []) { const { error: itemError } = await this.db.from('expense_claim_items').update({ approved_amount: status === 'APPROVED' ? Number(item.claimed_amount) : 0, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', item.id); if (itemError) this.fail(itemError, 'Unable to update approved item amount.'); }
    const { data, error } = await this.db.from('expense_claims').update({ status, total_approved: approved, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_notes: this.text(b.review_notes) || null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', claimId).select().single(); if (error) this.fail(error, 'Unable to review claim.');
    await this.event(tenantId, claimId, reviewerId, status, this.text(b.review_notes), { exception_override: allow }); return data;
  }
  async reimburse(tenantId: string, userId: string, claimId: string, b: any) {
    const reference = this.text(b.payment_reference); if (!reference) this.fail(null, 'Payment reference is required.');
    const { data, error } = await this.db.from('expense_claims').update({ status: 'REIMBURSED', payment_reference: reference, reimbursed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', claimId).eq('status', 'APPROVED').select().maybeSingle(); if (error || !data) this.fail(error, 'Only an approved claim can be marked reimbursed.'); await this.event(tenantId, claimId, userId, 'REIMBURSED', reference); return data;
  }
}
