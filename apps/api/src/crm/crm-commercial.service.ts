import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class CrmCommercialService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  private text(value: any) {
    return String(value ?? "").trim();
  }

  private number(value: any) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private fail(error: any, fallback: string): never {
    throw new BadRequestException(error?.message || fallback);
  }

  private async nextNumber(tenantId: string, table: string, column: string, prefix: string) {
    const year = new Date().getFullYear();
    const marker = `${prefix}-${year}-`;
    const { data, error } = await this.db
      .from(table)
      .select(column)
      .eq("tenant_id", tenantId)
      .like(column, `${marker}%`)
      .order(column, { ascending: false })
      .limit(1);
    if (error) this.fail(error, `Unable to generate ${prefix} number.`);
    const latest = this.text(data?.[0]?.[column]);
    const sequence = Number.parseInt(latest.replace(marker, ""), 10);
    return `${marker}${String((Number.isFinite(sequence) ? sequence : 0) + 1).padStart(5, "0")}`;
  }

  private async accountRecord(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("crm_accounts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) throw new NotFoundException(error?.message || "CRM account not found.");
    return data;
  }

  async workspace(tenantId: string) {
    const [accounts, contacts, opportunities, stages] = await Promise.all([
      this.accounts(tenantId),
      this.contacts(tenantId),
      this.opportunities(tenantId),
      this.db
        .from("crm_opportunity_stages")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("sort_order"),
    ]);
    if (stages.error) this.fail(stages.error, "Unable to load opportunity stages.");
    const open = opportunities.filter((row: any) => row.status === "OPEN" || row.status === "ON_HOLD");
    return {
      accounts,
      contacts,
      opportunities,
      stages: stages.data || [],
      kpis: {
        accounts: accounts.length,
        contacts: contacts.length,
        open_opportunities: open.length,
        open_pipeline: open.reduce((sum: number, row: any) => sum + this.number(row.amount), 0),
        weighted_pipeline: open.reduce(
          (sum: number, row: any) => sum + this.number(row.amount) * this.number(row.probability) / 100,
          0,
        ),
      },
    };
  }

  async accounts(tenantId: string, filters: any = {}) {
    let query = this.db
      .from("crm_accounts")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });
    if (filters.q) {
      const q = this.text(filters.q).replace(/[,()%]/g, "");
      query = query.or(`account_number.ilike.%${q}%,account_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
    }
    const { data, error } = await query.limit(1000);
    if (error) this.fail(error, "Unable to load CRM accounts.");
    return data || [];
  }

  async createAccount(tenantId: string, userId: string, body: any) {
    const name = this.text(body.account_name);
    if (!name) throw new BadRequestException("Account name is required.");
    const { data: duplicate } = await this.db
      .from("crm_accounts")
      .select("id,account_number,account_name")
      .eq("tenant_id", tenantId)
      .ilike("account_name", name)
      .maybeSingle();
    if (duplicate) throw new BadRequestException(`Account already exists as ${duplicate.account_number}.`);
    const accountNumber = await this.nextNumber(tenantId, "crm_accounts", "account_number", "ACC");
    const { data, error } = await this.db
      .from("crm_accounts")
      .insert({
        tenant_id: tenantId,
        account_number: accountNumber,
        account_name: name,
        account_type: this.text(body.account_type).toUpperCase() || "PROSPECT",
        owner_user_id: body.owner_user_id || null,
        website: this.text(body.website) || null,
        domain: this.text(body.domain) || null,
        industry: this.text(body.industry) || null,
        territory: this.text(body.territory) || null,
        tax_registration_number: this.text(body.tax_registration_number) || null,
        email: this.text(body.email).toLowerCase() || null,
        phone: this.text(body.phone) || null,
        billing_address: this.text(body.billing_address) || null,
        shipping_address: this.text(body.shipping_address) || null,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) this.fail(error, "Unable to create the CRM account.");
    return data;
  }

  async contacts(tenantId: string, filters: any = {}) {
    let query = this.db
      .from("crm_contacts")
      .select("*,account:crm_accounts(id,account_number,account_name)")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });
    if (filters.account_id) query = query.eq("account_id", filters.account_id);
    const { data, error } = await query.limit(1000);
    if (error) this.fail(error, "Unable to load CRM contacts.");
    return data || [];
  }

  async createContact(tenantId: string, userId: string, body: any) {
    const firstName = this.text(body.first_name);
    if (!firstName) throw new BadRequestException("Contact first name is required.");
    const account = await this.accountRecord(tenantId, body.account_id);
    const email = this.text(body.email).toLowerCase();
    const mobile = this.text(body.mobile || body.phone);
    if (email || mobile) {
      let duplicateQuery = this.db
        .from("crm_contacts")
        .select("id,first_name,last_name")
        .eq("tenant_id", tenantId)
        .eq("account_id", account.id);
      duplicateQuery = email ? duplicateQuery.eq("email", email) : duplicateQuery.eq("mobile", mobile);
      const { data: duplicate } = await duplicateQuery.maybeSingle();
      if (duplicate) throw new BadRequestException("This contact already exists for the selected account.");
    }
    if (body.is_primary === true)
      await this.db
        .from("crm_contacts")
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("account_id", account.id)
        .eq("is_primary", true);
    const { data, error } = await this.db
      .from("crm_contacts")
      .insert({
        tenant_id: tenantId,
        account_id: account.id,
        customer_id: account.customer_id || null,
        salutation: this.text(body.salutation) || null,
        first_name: firstName,
        last_name: this.text(body.last_name) || null,
        job_title: this.text(body.job_title) || null,
        department: this.text(body.department) || null,
        email: email || null,
        phone: this.text(body.phone) || null,
        mobile: mobile || null,
        whatsapp: this.text(body.whatsapp || mobile) || null,
        is_primary: body.is_primary === true,
        email_consent: this.text(body.email_consent).toUpperCase() || "UNKNOWN",
        whatsapp_consent: this.text(body.whatsapp_consent).toUpperCase() || "UNKNOWN",
        do_not_call: body.do_not_call === true,
        owner_user_id: body.owner_user_id || account.owner_user_id || null,
        created_by: userId,
      })
      .select("*,account:crm_accounts(id,account_number,account_name)")
      .single();
    if (error) this.fail(error, "Unable to create the CRM contact.");
    return data;
  }

  async opportunities(tenantId: string, filters: any = {}) {
    let query = this.db
      .from("crm_opportunities")
      .select("*,account:crm_accounts(id,account_number,account_name),primary_contact:crm_contacts(id,salutation,first_name,last_name,email,mobile),stage:crm_opportunity_stages(*)")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });
    if (filters.account_id) query = query.eq("account_id", filters.account_id);
    if (filters.owner_user_id) query = query.eq("owner_user_id", filters.owner_user_id);
    if (filters.status) query = query.eq("status", this.text(filters.status).toUpperCase());
    const { data, error } = await query.limit(1000);
    if (error) this.fail(error, "Unable to load CRM opportunities.");
    return data || [];
  }

  private async stageRecord(tenantId: string, stageId?: string, defaultCode = "PROSPECTING") {
    let query = this.db
      .from("crm_opportunity_stages")
      .select("*")
      .eq("tenant_id", tenantId);
    query = stageId ? query.eq("id", stageId) : query.eq("stage_code", defaultCode);
    const { data, error } = await query.maybeSingle();
    if (error || !data) throw new BadRequestException(error?.message || "Select a valid opportunity stage.");
    return data;
  }

  async createOpportunity(tenantId: string, userId: string, body: any) {
    const name = this.text(body.opportunity_name);
    if (!name) throw new BadRequestException("Opportunity name is required.");
    const account = await this.accountRecord(tenantId, body.account_id);
    const stage = await this.stageRecord(tenantId, body.stage_id);
    if (body.primary_contact_id) {
      const { data: contact } = await this.db
        .from("crm_contacts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("account_id", account.id)
        .eq("id", body.primary_contact_id)
        .maybeSingle();
      if (!contact) throw new BadRequestException("Primary contact must belong to the selected account.");
    }
    const opportunityNumber = await this.nextNumber(tenantId, "crm_opportunities", "opportunity_number", "OPP");
    const status = stage.is_won ? "WON" : stage.stage_code === "LOST" ? "LOST" : stage.stage_code === "ON_HOLD" ? "ON_HOLD" : "OPEN";
    const { data, error } = await this.db
      .from("crm_opportunities")
      .insert({
        tenant_id: tenantId,
        opportunity_number: opportunityNumber,
        opportunity_name: name,
        account_id: account.id,
        primary_contact_id: body.primary_contact_id || null,
        customer_id: account.customer_id || null,
        owner_user_id: body.owner_user_id || account.owner_user_id || userId,
        stage_id: stage.id,
        status,
        amount: Math.max(0, this.number(body.amount)),
        currency_code: this.text(body.currency_code).toUpperCase() || "INR",
        probability: stage.probability,
        expected_close_date: body.expected_close_date || null,
        next_step: this.text(body.next_step) || null,
        product_interest: this.text(body.product_interest) || null,
        requirement: this.text(body.requirement) || null,
        competitors: this.text(body.competitors) || null,
        loss_reason: status === "LOST" ? this.text(body.loss_reason) || null : null,
        closed_at: stage.is_closed ? new Date().toISOString() : null,
        created_by: userId,
      })
      .select("*,account:crm_accounts(id,account_number,account_name),primary_contact:crm_contacts(id,salutation,first_name,last_name,email,mobile),stage:crm_opportunity_stages(*)")
      .single();
    if (error) this.fail(error, "Unable to create the CRM opportunity.");
    return data;
  }

  async updateOpportunity(tenantId: string, id: string, body: any) {
    const { data: current, error: currentError } = await this.db
      .from("crm_opportunities")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (currentError || !current) throw new NotFoundException(currentError?.message || "CRM opportunity not found.");
    const stage = body.stage_id ? await this.stageRecord(tenantId, body.stage_id) : null;
    const status = stage
      ? stage.is_won ? "WON" : stage.stage_code === "LOST" ? "LOST" : stage.stage_code === "ON_HOLD" ? "ON_HOLD" : "OPEN"
      : current.status;
    if (status === "LOST" && !this.text(body.loss_reason || current.loss_reason))
      throw new BadRequestException("Loss reason is required before closing an opportunity as Lost.");
    const patch: any = { updated_at: new Date().toISOString() };
    for (const field of ["opportunity_name", "primary_contact_id", "owner_user_id", "expected_close_date", "next_step", "product_interest", "requirement", "competitors", "quotation_id", "sales_order_id"])
      if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = body[field] || null;
    if (Object.prototype.hasOwnProperty.call(body, "amount")) patch.amount = Math.max(0, this.number(body.amount));
    if (Object.prototype.hasOwnProperty.call(body, "currency_code")) patch.currency_code = this.text(body.currency_code).toUpperCase();
    if (stage) {
      patch.stage_id = stage.id;
      patch.probability = stage.probability;
      patch.status = status;
      patch.closed_at = stage.is_closed ? new Date().toISOString() : null;
    }
    patch.loss_reason = status === "LOST" ? this.text(body.loss_reason || current.loss_reason) : null;
    const { data, error } = await this.db
      .from("crm_opportunities")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("*,account:crm_accounts(id,account_number,account_name),primary_contact:crm_contacts(id,salutation,first_name,last_name,email,mobile),stage:crm_opportunity_stages(*)")
      .single();
    if (error) this.fail(error, "Unable to update the CRM opportunity.");
    return data;
  }

  async syncConvertedLead(tenantId: string, userId: string, lead: any, customer: any, quotation?: any) {
    let { data: account, error: accountError } = await this.db
      .from("crm_accounts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (accountError) this.fail(accountError, "Unable to find the converted CRM account.");
    if (!account) {
      const accountName = customer.customer_name || lead.company_name;
      const { data: namedAccount, error: namedAccountError } = await this.db
        .from("crm_accounts")
        .select("*")
        .eq("tenant_id", tenantId)
        .ilike("account_name", accountName)
        .limit(1)
        .maybeSingle();
      if (namedAccountError) this.fail(namedAccountError, "Unable to match the converted CRM account.");
      account = namedAccount || await this.createAccount(tenantId, userId, {
          account_name: accountName,
          account_type: "CUSTOMER",
          owner_user_id: lead.owner_user_id,
          industry: lead.industry,
          territory: lead.territory,
          email: lead.email,
          phone: lead.phone,
        });
      const { data: linked, error } = await this.db
        .from("crm_accounts")
        .update({ customer_id: customer.id, account_type: "CUSTOMER" })
        .eq("tenant_id", tenantId)
        .eq("id", account.id)
        .select("*")
        .single();
      if (error) this.fail(error, "Unable to link the CRM account to the customer.");
      account = linked;
    }
    let contact: any = null;
    if (lead.email || lead.phone || lead.contact_person) {
      let contactQuery = this.db.from("crm_contacts").select("*").eq("tenant_id", tenantId).eq("account_id", account.id);
      contactQuery = lead.email ? contactQuery.eq("email", this.text(lead.email).toLowerCase()) : contactQuery.eq("mobile", lead.phone);
      const existing = await contactQuery.limit(1).maybeSingle();
      contact = existing.data;
      if (!contact)
        contact = await this.createContact(tenantId, userId, {
          account_id: account.id,
          first_name: lead.contact_person || lead.company_name,
          email: lead.email,
          mobile: lead.phone,
          whatsapp: lead.phone,
          is_primary: true,
          owner_user_id: lead.owner_user_id,
        });
    }
    let { data: opportunity, error: opportunityError } = await this.db
      .from("crm_opportunities")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("source_lead_id", lead.id)
      .maybeSingle();
    if (opportunityError) this.fail(opportunityError, "Unable to find the converted opportunity.");
    if (!opportunity) {
      const stage = await this.stageRecord(tenantId, undefined, quotation ? "PROPOSAL" : "QUALIFICATION");
      opportunity = await this.createOpportunity(tenantId, userId, {
        opportunity_name: `${lead.company_name} - ${lead.product_interest || "Opportunity"}`,
        account_id: account.id,
        primary_contact_id: contact?.id,
        owner_user_id: lead.owner_user_id || userId,
        stage_id: stage.id,
        amount: lead.expected_value,
        currency_code: lead.currency_code,
        expected_close_date: lead.expected_close_date,
        next_step: lead.next_follow_up_at ? `Follow up scheduled ${lead.next_follow_up_at}` : null,
        product_interest: lead.product_interest,
        requirement: lead.requirement,
      });
      const { data: linked, error } = await this.db
        .from("crm_opportunities")
        .update({ source_lead_id: lead.id, customer_id: customer.id, quotation_id: quotation?.id || null })
        .eq("tenant_id", tenantId)
        .eq("id", opportunity.id)
        .select("*")
        .single();
      if (error) this.fail(error, "Unable to link the opportunity to the converted lead.");
      opportunity = linked;
    }
    return { account, contact, opportunity };
  }
}
