import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { SalesService } from "../sales/services/sales.service";

const DEFAULT_STAGES = [
  ["NEW", "New", 10, "#64748B", false, false],
  ["ASSIGNED", "Assigned", 20, "#2563EB", false, false],
  ["CONTACTED", "Contacted", 30, "#7C3AED", false, false],
  ["QUALIFIED", "Qualified", 50, "#0891B2", false, false],
  ["REQUIREMENT", "Requirement Confirmed", 60, "#0F766E", false, false],
  ["QUOTATION", "Quotation", 70, "#CA8A04", false, false],
  ["NEGOTIATION", "Negotiation", 85, "#EA580C", false, false],
  ["WON", "Won", 100, "#15803D", true, true],
  ["LOST", "Lost", 0, "#B91C1C", true, false],
  ["ON_HOLD", "On Hold", 25, "#475569", false, false],
] as const;

@Injectable()
export class CrmService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(private readonly sales: SalesService) {}

  private fail(error: any, fallback: string): never {
    throw new BadRequestException(error?.message || fallback);
  }

  private text(value: any) {
    return String(value ?? "").trim();
  }

  private number(value: any) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private normalize(value: any) {
    return this.text(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  private customerContactName(value: any, fallback: string) {
    const name = this.text(value) || this.text(fallback);
    if (!name) return "Mr. Customer Contact";
    return /^(mr|ms|mrs|dr|prof)\.?\s+/i.test(name) ? name : `Mr. ${name}`;
  }

  private hashToken(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private safeTokenMatch(token: string, expectedHash: string) {
    const actual = Buffer.from(this.hashToken(token));
    const expected = Buffer.from(String(expectedHash || ""));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private calculateLeadScore(lead: any) {
    let score = 5;
    const reasons: string[] = ["Prospect captured"];
    const add = (condition: boolean, points: number, reason: string) => {
      if (!condition) return;
      score += points;
      reasons.push(`${reason} (+${points})`);
    };
    add(
      Boolean(this.text(lead.contact_person)),
      8,
      "Decision contact identified",
    );
    add(Boolean(this.text(lead.email)), 7, "Email available");
    add(Boolean(this.text(lead.phone)), 8, "Phone or WhatsApp available");
    add(Boolean(this.text(lead.requirement)), 15, "Requirement documented");
    add(
      Boolean(this.text(lead.product_interest)),
      10,
      "Product interest identified",
    );
    add(
      this.number(lead.expected_value) > 0,
      12,
      "Opportunity value estimated",
    );
    add(Boolean(lead.expected_close_date), 8, "Expected close date recorded");
    add(Boolean(lead.next_follow_up_at), 10, "Next follow-up scheduled");
    add(Boolean(this.text(lead.territory)), 4, "Territory known");
    add(Boolean(this.text(lead.industry)), 4, "Industry known");
    add(
      ["REFERRAL", "WEBSITE", "EXHIBITION", "CAMPAIGN"].includes(
        this.text(lead.source).toUpperCase(),
      ),
      4,
      "Trackable acquisition source",
    );
    add(
      ["HIGH", "URGENT"].includes(this.text(lead.priority).toUpperCase()),
      5,
      "High-priority opportunity",
    );
    return { lead_score: Math.min(100, score), score_explanation: reasons };
  }

  private async ensureStages(tenantId: string) {
    const rows = DEFAULT_STAGES.map((stage, index) => ({
      tenant_id: tenantId,
      stage_code: stage[0],
      stage_name: stage[1],
      sort_order: (index + 1) * 10,
      probability: stage[2],
      colour: stage[3],
      is_closed: stage[4],
      is_won: stage[5],
      is_active: true,
    }));
    const { error } = await this.db
      .from("crm_pipeline_stages")
      .upsert(rows, {
        onConflict: "tenant_id,stage_code",
        ignoreDuplicates: true,
      });
    if (error) this.fail(error, "Unable to initialise the CRM pipeline.");
  }

  private async stageByCode(tenantId: string, code: string) {
    await this.ensureStages(tenantId);
    const { data, error } = await this.db
      .from("crm_pipeline_stages")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("stage_code", code)
      .single();
    if (error || !data) this.fail(error, `CRM stage ${code} is unavailable.`);
    return data;
  }

  private async nextLeadNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const prefix = `LEAD-${year}-`;
    const { data } = await this.db
      .from("crm_leads")
      .select("lead_number")
      .eq("tenant_id", tenantId)
      .like("lead_number", `${prefix}%`)
      .order("lead_number", { ascending: false })
      .limit(1);
    const sequence = Number.parseInt(
      String(data?.[0]?.lead_number || "").replace(prefix, ""),
      10,
    );
    return `${prefix}${String(Number.isFinite(sequence) ? sequence + 1 : 1).padStart(5, "0")}`;
  }

  private matchesRule(rule: any, lead: any) {
    const match = (filter: any, value: any) =>
      !this.text(filter) ||
      this.normalize(value).includes(this.normalize(filter));
    return (
      match(rule.source_filter, lead.source) &&
      match(rule.territory_filter, lead.territory) &&
      match(rule.industry_filter, lead.industry) &&
      match(rule.product_filter, lead.product_interest)
    );
  }

  private async salesTeamCandidates(tenantId: string) {
    const { data } = await this.db
      .from("employees")
      .select("user_id,department,status")
      .eq("tenant_id", tenantId)
      .eq("status", "ACTIVE")
      .not("user_id", "is", null);
    return (data || [])
      .filter((row: any) =>
        /sales|commercial|business development/i.test(
          this.text(row.department),
        ),
      )
      .map((row: any) => this.text(row.user_id))
      .filter(Boolean);
  }

  private async automaticOwner(tenantId: string, lead: any, creatorId: string) {
    const { data: rules, error } = await this.db
      .from("crm_assignment_rules")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("priority");
    if (error) this.fail(error, "Unable to evaluate CRM assignment rules.");
    const rule = (rules || []).find((candidate: any) =>
      this.matchesRule(candidate, lead),
    );
    let candidateIds = Array.isArray(rule?.assignee_user_ids)
      ? rule.assignee_user_ids.map((id: any) => this.text(id)).filter(Boolean)
      : [];
    if (!candidateIds.length)
      candidateIds = await this.salesTeamCandidates(tenantId);
    if (!candidateIds.length)
      return {
        ownerId: creatorId,
        rule: null,
        reason:
          "Assigned to creator because no active CRM sales pool is configured.",
      };

    if (rule?.strategy === "FIXED_OWNER") {
      return {
        ownerId: candidateIds[0],
        rule,
        reason: `Fixed owner from ${rule.rule_name}.`,
      };
    }
    if (rule?.strategy === "ROUND_ROBIN") {
      const nextIndex =
        (Number(rule.last_assignee_index || -1) + 1) % candidateIds.length;
      await this.db
        .from("crm_assignment_rules")
        .update({
          last_assignee_index: nextIndex,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", rule.id);
      return {
        ownerId: candidateIds[nextIndex],
        rule,
        reason: `Round-robin assignment from ${rule.rule_name}.`,
      };
    }

    const { data: open } = await this.db
      .from("crm_leads")
      .select("owner_user_id")
      .eq("tenant_id", tenantId)
      .in("owner_user_id", candidateIds)
      .is("converted_at", null);
    const load = new Map(candidateIds.map((id: string) => [id, 0]));
    (open || []).forEach((row: any) =>
      load.set(row.owner_user_id, (load.get(row.owner_user_id) || 0) + 1),
    );
    candidateIds.sort(
      (a: string, b: string) =>
        (load.get(a) || 0) - (load.get(b) || 0) || a.localeCompare(b),
    );
    return {
      ownerId: candidateIds[0],
      rule,
      reason: `Load-balanced assignment${rule ? ` from ${rule.rule_name}` : " across the active Sales team"}.`,
    };
  }

  private async userMap(tenantId: string, ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return new Map<string, any>();
    const { data } = await this.db
      .from("users")
      .select("id,first_name,last_name,email,is_active")
      .eq("tenant_id", tenantId)
      .in("id", unique);
    return new Map(
      (data || []).map((user: any) => [
        String(user.id),
        {
          ...user,
          name:
            [user.first_name, user.last_name].filter(Boolean).join(" ") ||
            user.email,
        },
      ]),
    );
  }

  private async validateActiveAssignees(tenantId: string, values: any[]) {
    const ids = Array.from(
      new Set((Array.isArray(values) ? values : []).map((id) => this.text(id)).filter(Boolean)),
    );
    if (!ids.length) return [];
    const users = await this.userMap(tenantId, ids);
    const valid = ids.filter((id) => users.get(id)?.is_active === true);
    if (valid.length !== ids.length)
      throw new BadRequestException(
        "Every assignment owner must be an active user in this organisation.",
      );
    return valid;
  }

  private async enrichLeads(tenantId: string, rows: any[]) {
    const users = await this.userMap(
      tenantId,
      rows.map((row) => row.owner_user_id),
    );
    return rows.map((row) => ({
      ...row,
      owner: users.get(String(row.owner_user_id)) || null,
    }));
  }

  async metadata(tenantId: string) {
    await this.ensureStages(tenantId);
    const [stages, rules, users, inboundChannels] = await Promise.all([
      this.db
        .from("crm_pipeline_stages")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("sort_order"),
      this.db
        .from("crm_assignment_rules")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("priority"),
      this.db
        .from("users")
        .select("id,first_name,last_name,email,is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("first_name"),
      this.inboundChannels(tenantId),
    ]);
    if (stages.error) this.fail(stages.error, "Unable to load CRM stages.");
    if (rules.error) this.fail(rules.error, "Unable to load assignment rules.");
    if (users.error) this.fail(users.error, "Unable to load CRM users.");
    return {
      stages: stages.data || [],
      assignment_rules: rules.data || [],
      inbound_channels: inboundChannels,
      users: (users.data || []).map((user: any) => ({
        ...user,
        name:
          [user.first_name, user.last_name].filter(Boolean).join(" ") ||
          user.email,
      })),
      sources: [
        "MANUAL",
        "WEBSITE",
        "WHATSAPP",
        "EMAIL",
        "PHONE",
        "REFERRAL",
        "EXHIBITION",
        "CAMPAIGN",
        "IMPORT",
      ],
    };
  }

  async leads(tenantId: string, filters: any = {}) {
    await this.ensureStages(tenantId);
    let query = this.db
      .from("crm_leads")
      .select("*,stage:crm_pipeline_stages(*)")
      .eq("tenant_id", tenantId)
      .is("merged_into_lead_id", null)
      .order("updated_at", { ascending: false });
    if (filters.stage_id) query = query.eq("stage_id", filters.stage_id);
    if (filters.owner_user_id)
      query = query.eq("owner_user_id", filters.owner_user_id);
    if (filters.source) query = query.eq("source", filters.source);
    if (filters.q) {
      const q = this.text(filters.q).replace(/[,()%]/g, "");
      query = query.or(
        `lead_number.ilike.%${q}%,company_name.ilike.%${q}%,contact_person.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`,
      );
    }
    const { data, error } = await query.limit(1000);
    if (error) this.fail(error, "Unable to load CRM leads.");
    return this.enrichLeads(tenantId, data || []);
  }

  async lead(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("crm_leads")
      .select("*,stage:crm_pipeline_stages(*)")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data)
      throw new NotFoundException(error?.message || "CRM lead not found.");
    const [activities, history, enriched] = await Promise.all([
      this.db
        .from("crm_activities")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("lead_id", id)
        .order("created_at", { ascending: false }),
      this.db
        .from("crm_lead_stage_history")
        .select(
          "*,from_stage:crm_pipeline_stages!crm_lead_stage_history_from_stage_id_fkey(stage_name),to_stage:crm_pipeline_stages!crm_lead_stage_history_to_stage_id_fkey(stage_name)",
        )
        .eq("tenant_id", tenantId)
        .eq("lead_id", id)
        .order("changed_at", { ascending: false }),
      this.enrichLeads(tenantId, [data]),
    ]);
    return {
      ...enriched[0],
      activities: activities.data || [],
      stage_history: history.data || [],
    };
  }

  async dashboard(tenantId: string, userId: string) {
    await this.scanDueFollowups(tenantId);
    const [metadata, leads, notifications] = await Promise.all([
      this.metadata(tenantId),
      this.leads(tenantId),
      this.notifications(tenantId, userId),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const closedIds = new Set(
      metadata.stages
        .filter((stage: any) => stage.is_closed)
        .map((stage: any) => stage.id),
    );
    const open = leads.filter((lead: any) => !closedIds.has(lead.stage_id));
    const due = open.filter(
      (lead: any) =>
        lead.next_follow_up_at &&
        String(lead.next_follow_up_at).slice(0, 10) <= today,
    );
    const weighted = open.reduce(
      (sum: number, lead: any) =>
        sum +
        (this.number(lead.expected_value) * this.number(lead.probability)) /
          100,
      0,
    );
    const byStage = metadata.stages.map((stage: any) => ({
      ...stage,
      leads: leads.filter((lead: any) => lead.stage_id === stage.id),
      value: leads
        .filter((lead: any) => lead.stage_id === stage.id)
        .reduce(
          (sum: number, lead: any) => sum + this.number(lead.expected_value),
          0,
        ),
    }));
    const unassigned = open.filter((lead: any) => !lead.owner_user_id);
    const [salesCandidates, whatsappResult] = await Promise.all([
      this.salesTeamCandidates(tenantId),
      this.db
        .from("whatsapp_connections")
        .select("crm_capture_enabled,status")
        .eq("tenant_id", tenantId)
        .eq("is_primary", true)
        .maybeSingle(),
    ]);
    const activeRules = metadata.assignment_rules.filter((rule: any) => rule.is_active);
    const configuredOwners = new Set(
      activeRules.flatMap((rule: any) =>
        Array.isArray(rule.assignee_user_ids) ? rule.assignee_user_ids : [],
      ),
    );
    const activeInboundChannels = metadata.inbound_channels.filter(
      (channel: any) => channel.is_active,
    );
    const whatsappCapture = Boolean(
      whatsappResult.data?.crm_capture_enabled && whatsappResult.data?.status === "READY",
    );
    const readinessWarnings: string[] = [];
    if (!activeRules.length && !salesCandidates.length)
      readinessWarnings.push("No automatic assignment pool is configured.");
    else if (configuredOwners.size === 1 && !salesCandidates.length)
      readinessWarnings.push("Lead routing currently depends on one configured owner.");
    if (!activeInboundChannels.length && !whatsappCapture)
      readinessWarnings.push("No live website, email, API, or WhatsApp lead channel is active.");
    const recommended = [
      ...due.map((lead: any) => ({
        type: "FOLLOW_UP_DUE",
        priority: "HIGH",
        lead_id: lead.id,
        title: `${lead.company_name}: follow-up is due`,
        action: "Record the outcome and next action.",
      })),
      ...unassigned.map((lead: any) => ({
        type: "UNASSIGNED",
        priority: "URGENT",
        lead_id: lead.id,
        title: `${lead.company_name}: no owner`,
        action: "Run automatic assignment or select an owner.",
      })),
    ].slice(0, 10);
    return {
      kpis: {
        total_leads: leads.length,
        open_leads: open.length,
        my_open_leads: open.filter((lead: any) => lead.owner_user_id === userId)
          .length,
        follow_ups_due: due.length,
        pipeline_value: open.reduce(
          (sum: number, lead: any) => sum + this.number(lead.expected_value),
          0,
        ),
        weighted_pipeline: weighted,
        unassigned: unassigned.length,
      },
      stages: byStage,
      leads,
      recommended_actions: recommended,
      notifications,
      metadata,
      readiness: {
        ready: readinessWarnings.length === 0,
        active_assignment_rules: activeRules.length,
        configured_rule_owners: configuredOwners.size,
        department_sales_candidates: salesCandidates.length,
        active_inbound_channels: activeInboundChannels.length,
        whatsapp_capture_active: whatsappCapture,
        warnings: readinessWarnings,
      },
    };
  }

  async createLead(tenantId: string, userId: string, body: any) {
    const companyName = this.text(body.company_name);
    if (!companyName)
      throw new BadRequestException("Company / prospect name is required.");
    const email = this.text(body.email).toLowerCase();
    const phone = this.text(body.phone).replace(/\s+/g, "");
    const { data: candidates } = await this.db
      .from("crm_leads")
      .select("id,lead_number,company_name,email,phone")
      .eq("tenant_id", tenantId)
      .limit(1000);
    const duplicate = (candidates || []).find(
      (row: any) =>
        (email && this.normalize(row.email) === this.normalize(email)) ||
        (phone && this.normalize(row.phone) === this.normalize(phone)) ||
        this.normalize(row.company_name) === this.normalize(companyName),
    );
    if (duplicate && body.allow_duplicate !== true) {
      throw new BadRequestException(
        `Possible duplicate lead ${duplicate.lead_number} (${duplicate.company_name}). Review it or explicitly allow a duplicate.`,
      );
    }
    const initialStage = await this.stageByCode(tenantId, "NEW");
    const draft: any = {
      tenant_id: tenantId,
      lead_number: await this.nextLeadNumber(tenantId),
      company_name: companyName,
      contact_person: this.text(body.contact_person) || null,
      email: email || null,
      phone: phone || null,
      alternate_phone: this.text(body.alternate_phone) || null,
      source: this.text(body.source).toUpperCase() || "MANUAL",
      campaign: this.text(body.campaign) || null,
      territory: this.text(body.territory) || null,
      industry: this.text(body.industry) || null,
      product_interest: this.text(body.product_interest) || null,
      requirement: this.text(body.requirement) || null,
      expected_value: Math.max(0, this.number(body.expected_value)),
      currency_code: this.text(body.currency_code).toUpperCase() || "INR",
      priority: this.text(body.priority).toUpperCase() || "MEDIUM",
      stage_id: initialStage.id,
      probability: initialStage.probability,
      next_follow_up_at: body.next_follow_up_at || null,
      expected_close_date: body.expected_close_date || null,
      source_external_id: this.text(body.source_external_id) || null,
      source_payload:
        body.source_payload && typeof body.source_payload === "object"
          ? body.source_payload
          : {},
      created_by: userId,
    };
    const assignment = await this.automaticOwner(tenantId, draft, userId);
    const assignedStage = assignment.ownerId
      ? await this.stageByCode(tenantId, "ASSIGNED")
      : initialStage;
    draft.owner_user_id = assignment.ownerId;
    draft.assigned_at = assignment.ownerId ? new Date().toISOString() : null;
    draft.stage_id = assignedStage.id;
    draft.probability = assignedStage.probability;
    Object.assign(draft, this.calculateLeadScore(draft));
    const { data, error } = await this.db
      .from("crm_leads")
      .insert(draft)
      .select("*")
      .single();
    if (error) this.fail(error, "Unable to create CRM lead.");
    await this.db
      .from("crm_lead_stage_history")
      .insert({
        tenant_id: tenantId,
        lead_id: data.id,
        to_stage_id: assignedStage.id,
        changed_by: userId,
        reason: assignment.ownerId
          ? `Lead created and assigned. ${assignment.reason}`
          : "Lead created",
      });
    await this.db
      .from("crm_activities")
      .insert({
        tenant_id: tenantId,
        lead_id: data.id,
        activity_type: "NOTE",
        direction: "INTERNAL",
        subject: "Automatic assignment",
        notes: assignment.reason,
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        owner_user_id: assignment.ownerId,
        created_by: userId,
      });
    return {
      ...(await this.lead(tenantId, data.id)),
      assignment_explanation: assignment.reason,
    };
  }

  async updateLead(tenantId: string, id: string, body: any) {
    const current = await this.lead(tenantId, id);
    const allowed = [
      "company_name",
      "contact_person",
      "email",
      "phone",
      "alternate_phone",
      "source",
      "campaign",
      "territory",
      "industry",
      "product_interest",
      "requirement",
      "expected_value",
      "currency_code",
      "priority",
      "next_follow_up_at",
      "expected_close_date",
    ];
    const patch: any = { updated_at: new Date().toISOString() };
    allowed.forEach((key) => {
      if (body[key] !== undefined)
        patch[key] = body[key] === "" ? null : body[key];
    });
    if (
      patch.expected_value !== undefined &&
      this.number(patch.expected_value) < 0
    )
      throw new BadRequestException("Expected value cannot be negative.");
    Object.assign(patch, this.calculateLeadScore({ ...current, ...patch }));
    const { error } = await this.db
      .from("crm_leads")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", current.id);
    if (error) this.fail(error, "Unable to update CRM lead.");
    return this.lead(tenantId, id);
  }

  async assignLead(
    tenantId: string,
    id: string,
    ownerUserId: string,
    actorId: string,
    reason?: string,
  ) {
    await this.lead(tenantId, id);
    let owner = this.text(ownerUserId);
    let explanation = this.text(reason);
    if (!owner) {
      const current = await this.lead(tenantId, id);
      const assignment = await this.automaticOwner(tenantId, current, actorId);
      owner = assignment.ownerId;
      explanation = assignment.reason;
    }
    const users = await this.userMap(tenantId, [owner]);
    if (!users.has(owner))
      throw new BadRequestException(
        "Select an active user from this organisation.",
      );
    const assignedStage = await this.stageByCode(tenantId, "ASSIGNED");
    const { error } = await this.db
      .from("crm_leads")
      .update({
        owner_user_id: owner,
        assigned_at: new Date().toISOString(),
        stage_id: assignedStage.id,
        probability: assignedStage.probability,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (error) this.fail(error, "Unable to assign CRM lead.");
    await this.db
      .from("crm_activities")
      .insert({
        tenant_id: tenantId,
        lead_id: id,
        activity_type: "NOTE",
        direction: "INTERNAL",
        subject: "Lead assigned",
        notes: explanation || "Owner selected manually.",
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        owner_user_id: owner,
        created_by: actorId,
      });
    return this.lead(tenantId, id);
  }

  async changeStage(
    tenantId: string,
    id: string,
    stageId: string,
    actorId: string,
    reason?: string,
  ) {
    const current = await this.lead(tenantId, id);
    const { data: stage, error: stageError } = await this.db
      .from("crm_pipeline_stages")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", stageId)
      .eq("is_active", true)
      .maybeSingle();
    if (stageError || !stage)
      throw new BadRequestException(
        stageError?.message || "Select a valid CRM stage.",
      );
    if (stage.stage_code === "LOST" && !this.text(reason))
      throw new BadRequestException("A lost reason is required.");
    const patch: any = {
      stage_id: stage.id,
      probability: stage.probability,
      lost_reason: stage.stage_code === "LOST" ? this.text(reason) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.db
      .from("crm_leads")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (error) this.fail(error, "Unable to change the CRM stage.");
    await this.db
      .from("crm_lead_stage_history")
      .insert({
        tenant_id: tenantId,
        lead_id: id,
        from_stage_id: current.stage_id,
        to_stage_id: stage.id,
        changed_by: actorId,
        reason: this.text(reason) || null,
      });
    return this.lead(tenantId, id);
  }

  async addActivity(
    tenantId: string,
    leadId: string,
    userId: string,
    body: any,
  ) {
    const lead = await this.lead(tenantId, leadId);
    const type = this.text(body.activity_type).toUpperCase() || "FOLLOW_UP";
    const subject = this.text(body.subject);
    if (!subject)
      throw new BadRequestException("Activity subject is required.");
    const payload = {
      tenant_id: tenantId,
      lead_id: leadId,
      customer_id: lead.customer_id || null,
      activity_type: type,
      direction: this.text(body.direction).toUpperCase() || "INTERNAL",
      subject,
      notes: this.text(body.notes) || null,
      scheduled_at: body.scheduled_at || null,
      owner_user_id: body.owner_user_id || lead.owner_user_id || userId,
      status: body.status || "OPEN",
      created_by: userId,
    };
    const { data, error } = await this.db
      .from("crm_activities")
      .insert(payload)
      .select("*")
      .single();
    if (error) this.fail(error, "Unable to create CRM activity.");
    if (payload.scheduled_at)
      await this.db
        .from("crm_leads")
        .update({
          next_follow_up_at: payload.scheduled_at,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", leadId);
    return data;
  }

  async completeActivity(tenantId: string, id: string, body: any) {
    const { data, error } = await this.db
      .from("crm_activities")
      .update({
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        outcome: this.text(body.outcome) || null,
        next_action_at: body.next_action_at || null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error || !data)
      throw new NotFoundException(error?.message || "CRM activity not found.");
    if (body.next_action_at && data.lead_id)
      await this.db
        .from("crm_leads")
        .update({
          next_follow_up_at: body.next_action_at,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", data.lead_id);
    return data;
  }

  async convertLead(req: any, id: string, body: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const lead = await this.lead(tenantId, id);
    if (lead.customer_id)
      return {
        lead,
        customer_id: lead.customer_id,
        quotation_id: lead.quotation_id,
        customer_route: `/dashboard/sales?tab=customers&customer=${lead.customer_id}`,
        quotation_route: `/dashboard/sales?tab=quotations&customer=${lead.customer_id}&create=quotation&crmLead=${lead.id}&crmRef=${encodeURIComponent(lead.lead_number)}`,
      };
    const conversionKey = randomUUID();
    const { data: locked, error: lockError } = await this.db
      .from("crm_leads")
      .update({
        conversion_status: "IN_PROGRESS",
        conversion_key: conversionKey,
        conversion_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .neq("conversion_status", "IN_PROGRESS")
      .is("customer_id", null)
      .select("id")
      .maybeSingle();
    if (lockError)
      this.fail(lockError, "Unable to lock this lead for conversion.");
    if (!locked) {
      const current = await this.lead(tenantId, id);
      if (current.customer_id)
        return {
          lead: current,
          customer_id: current.customer_id,
          quotation_id: current.quotation_id,
        };
      throw new BadRequestException(
        "This lead is already being converted. Refresh before retrying.",
      );
    }
    let customer: any = null;
    let quotation: any = null;
    let createdCustomer = false;
    try {
      const { data: customers } = await this.db
        .from("customers")
        .select("id,customer_name,email,mobile,phone")
        .eq("tenant_id", tenantId)
        .eq("is_active", true);
      customer = (customers || []).find(
        (candidate: any) =>
          (lead.email &&
            this.normalize(candidate.email) === this.normalize(lead.email)) ||
          (lead.phone &&
            [candidate.mobile, candidate.phone].some(
              (phone) => this.normalize(phone) === this.normalize(lead.phone),
            )) ||
          this.normalize(candidate.customer_name) ===
            this.normalize(lead.company_name),
      );
      if (!customer) {
        const contactName = this.customerContactName(
          lead.contact_person,
          lead.company_name,
        );
        customer = await this.sales.createCustomer(req, {
          customer_name: lead.company_name,
          customer_type: body.customer_type || "REGULAR",
          contact_person: contactName,
          contacts: [
            {
              name: contactName,
              email: lead.email || "",
              mobile: lead.phone || "",
              designation: "",
            },
          ],
          email: lead.email,
          phone: lead.phone,
          mobile: lead.phone,
          city: body.city,
          state: body.state,
          country: body.country,
          billing_address: body.billing_address,
          shipping_address: body.shipping_address,
          credit_days: body.credit_days ?? 30,
          credit_limit: body.credit_limit ?? 0,
        });
        createdCustomer = true;
      }
      if (Array.isArray(body.quotation_items) && body.quotation_items.length) {
        quotation = await this.sales.createQuotation(req, {
          customer_id: customer.id,
          quotation_date:
            body.quotation_date || new Date().toISOString().slice(0, 10),
          valid_until: body.valid_until,
          items: body.quotation_items,
          terms_conditions: body.terms_conditions,
          payment_terms: body.payment_terms,
          delivery_terms: body.delivery_terms,
          currency_code: lead.currency_code,
          notes:
            `Created from CRM ${lead.lead_number}. ${this.text(body.notes)}`.trim(),
        });
      }
      const targetStage = quotation
        ? await this.stageByCode(tenantId, "QUOTATION")
        : lead.stage;
      const { data: converted, error } = await this.db
        .from("crm_leads")
        .update({
          customer_id: customer.id,
          quotation_id: quotation?.id || null,
          stage_id: targetStage.id,
          probability: targetStage.probability,
          converted_at: new Date().toISOString(),
          converted_by: userId,
          conversion_notes: this.text(body.notes) || null,
          conversion_status: "COMPLETED",
          conversion_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .eq("conversion_key", conversionKey)
        .select("id")
        .maybeSingle();
      if (error || !converted)
        this.fail(error, "Lead conversion changed while it was being saved.");
      if (quotation && targetStage.id !== lead.stage_id)
        await this.db
          .from("crm_lead_stage_history")
          .insert({
            tenant_id: tenantId,
            lead_id: id,
            from_stage_id: lead.stage_id,
            to_stage_id: targetStage.id,
            changed_by: userId,
            reason: "Customer and draft quotation created from CRM.",
          });
      await this.db
        .from("crm_activities")
        .insert({
          tenant_id: tenantId,
          lead_id: id,
          customer_id: customer.id,
          activity_type: "NOTE",
          direction: "INTERNAL",
          subject: quotation
            ? "Converted to customer and quotation"
            : "Converted to customer",
          notes: quotation
            ? `Draft quotation ${quotation.quotation_number || "created"}.`
            : "Business partner created; opportunity remains open until a commercial win is recorded.",
          status: "COMPLETED",
          completed_at: new Date().toISOString(),
          owner_user_id: lead.owner_user_id || userId,
          created_by: userId,
        });
      await this.db
        .from("crm_activities")
        .update({ customer_id: customer.id, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("lead_id", id)
        .is("customer_id", null);
      return {
        lead: await this.lead(tenantId, id),
        customer,
        quotation,
        customer_route: `/dashboard/sales?tab=customers&customer=${customer.id}`,
        quotation_route: quotation
          ? `/dashboard/sales?tab=quotations&quotation=${quotation.id}`
          : `/dashboard/sales?tab=quotations&customer=${customer.id}&create=quotation&crmLead=${id}&crmRef=${encodeURIComponent(lead.lead_number)}`,
      };
    } catch (error: any) {
      if (createdCustomer && customer?.id && !quotation)
        await this.db
          .from("customers")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("id", customer.id);
      await this.db
        .from("crm_leads")
        .update({
          conversion_status: "FAILED",
          conversion_error: this.text(error?.message).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .eq("conversion_key", conversionKey);
      throw error;
    }
  }

  async customer360(tenantId: string, customerId: string) {
    const customerResult = await this.db
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", customerId)
      .maybeSingle();
    if (customerResult.error || !customerResult.data)
      throw new NotFoundException(
        customerResult.error?.message || "Customer not found.",
      );
    const [leads, activities, quotations, orders, invoices, tickets, assets] =
      await Promise.all([
        this.db
          .from("crm_leads")
          .select("*,stage:crm_pipeline_stages(stage_name,stage_code)")
          .eq("tenant_id", tenantId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false }),
        this.db
          .from("crm_activities")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false }),
        this.db
          .from("quotations")
          .select(
            "id,quotation_number,quotation_date,valid_until,status,net_amount,currency_code",
          )
          .eq("tenant_id", tenantId)
          .eq("customer_id", customerId)
          .order("quotation_date", { ascending: false }),
        this.db
          .from("sales_orders")
          .select(
            "id,so_number,order_date,expected_delivery_date,status,total_amount,currency_code",
          )
          .eq("tenant_id", tenantId)
          .eq("customer_id", customerId)
          .order("order_date", { ascending: false }),
        this.db
          .from("invoices")
          .select(
            "id,invoice_number,invoice_date,due_date,net_amount,balance_amount,payment_status",
          )
          .eq("tenant_id", tenantId)
          .eq("customer_id", customerId)
          .order("invoice_date", { ascending: false }),
        this.db
          .from("service_tickets")
          .select(
            "id,ticket_number,complaint_date,priority,status,service_type",
          )
          .eq("tenant_id", tenantId)
          .eq("customer_id", customerId)
          .order("complaint_date", { ascending: false }),
        this.db
          .from("service_installed_assets")
          .select(
            "id,asset_number,asset_name,uid,serial_number,warranty_until,status",
          )
          .eq("tenant_id", tenantId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false }),
      ]);
    return {
      customer: customerResult.data,
      crm: { leads: leads.data || [], activities: activities.data || [] },
      sales: { quotations: quotations.data || [], orders: orders.data || [] },
      finance: {
        invoices: invoices.data || [],
        outstanding: (invoices.data || []).reduce(
          (sum: number, invoice: any) =>
            sum + this.number(invoice.balance_amount),
          0,
        ),
      },
      service: {
        tickets: tickets.data || [],
        installed_assets: assets.data || [],
      },
    };
  }

  async captureInboundLead(tenantId: string, userId: string, body: any) {
    const source = this.text(body.source).toUpperCase() || "IMPORT";
    const externalId = this.text(body.source_external_id);
    if (!externalId)
      throw new BadRequestException(
        "A source external ID is required for duplicate-safe inbound capture.",
      );
    const { data: existing, error } = await this.db
      .from("crm_leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source", source)
      .eq("source_external_id", externalId)
      .is("merged_into_lead_id", null)
      .maybeSingle();
    if (error) this.fail(error, "Unable to check the inbound lead identity.");
    if (existing)
      return { reused: true, lead: await this.lead(tenantId, existing.id) };
    const lead = await this.createLead(tenantId, userId, {
      ...body,
      source,
      source_external_id: externalId,
      source_payload: body.source_payload || body,
    });
    return { reused: false, lead };
  }

  async captureConversationLead(
    tenantId: string,
    userId: string,
    body: any,
    activityType: "WHATSAPP" | "EMAIL" = "WHATSAPP",
  ) {
    const captured = await this.captureInboundLead(tenantId, userId, body);
    if (captured.reused && this.text(body.requirement)) {
      await this.addActivity(tenantId, captured.lead.id, userId, {
        activity_type: activityType,
        direction: "INBOUND",
        subject: `Inbound ${activityType.toLowerCase()} message`,
        notes: this.text(body.requirement).slice(0, 4000),
        status: "COMPLETED",
      });
      captured.lead = await this.lead(tenantId, captured.lead.id);
    }
    return captured;
  }

  async inboundChannels(tenantId: string) {
    const { data, error } = await this.db
      .from("crm_inbound_channels")
      .select("id,channel_code,channel_name,is_active,last_received_at,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) this.fail(error, "Unable to load CRM inbound channels.");
    return data || [];
  }

  async createInboundChannel(tenantId: string, userId: string, body: any) {
    const channelCode = this.text(body.channel_code).toUpperCase();
    const channelName = this.text(body.channel_name);
    if (!["WEBSITE", "EMAIL", "WHATSAPP", "CAMPAIGN", "API"].includes(channelCode))
      throw new BadRequestException("Select a supported inbound channel type.");
    if (!channelName) throw new BadRequestException("Channel name is required.");
    const token = randomBytes(32).toString("base64url");
    const { data, error } = await this.db
      .from("crm_inbound_channels")
      .insert({
        tenant_id: tenantId,
        channel_code: channelCode,
        channel_name: channelName,
        token_hash: this.hashToken(token),
        created_by: userId,
      })
      .select("id,channel_code,channel_name,is_active,created_at")
      .single();
    if (error) this.fail(error, "Unable to create CRM inbound channel.");
    return { ...data, token, token_returned_once: true };
  }

  async rotateInboundChannelToken(tenantId: string, id: string) {
    const token = randomBytes(32).toString("base64url");
    const { data, error } = await this.db
      .from("crm_inbound_channels")
      .update({ token_hash: this.hashToken(token), is_active: true, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("id,channel_code,channel_name,is_active,updated_at")
      .maybeSingle();
    if (error || !data) throw new NotFoundException(error?.message || "Inbound channel not found.");
    return { ...data, token, token_returned_once: true };
  }

  async deactivateInboundChannel(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("crm_inbound_channels")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error || !data) throw new NotFoundException(error?.message || "Inbound channel not found.");
    return { deactivated: true };
  }

  async receiveInboundChannel(channelId: string, token: string, body: any) {
    const { data: channel, error } = await this.db
      .from("crm_inbound_channels")
      .select("*")
      .eq("id", channelId)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !channel || !token || !this.safeTokenMatch(token, channel.token_hash))
      throw new NotFoundException("Inbound channel not found.");
    const externalId = this.text(body.external_id || body.source_external_id).slice(0, 240);
    if (!externalId) throw new BadRequestException("external_id is required.");
    const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const { data: prior } = await this.db
      .from("crm_inbound_events")
      .select("lead_id,status")
      .eq("tenant_id", channel.tenant_id)
      .eq("channel_id", channel.id)
      .eq("external_id", externalId)
      .maybeSingle();
    if (prior) return { accepted: true, reused: true, lead_id: prior.lead_id };
    const companyName = this.text(body.company_name || body.company || body.contact_name || body.name || body.email || body.phone);
    if (!companyName) throw new BadRequestException("company_name, contact_name, email, or phone is required.");
    const safePayload = {
      external_id: externalId,
      campaign: this.text(body.campaign).slice(0, 160) || undefined,
      referrer: this.text(body.referrer).slice(0, 500) || undefined,
      received_at: new Date().toISOString(),
    };
    try {
      const captured = await this.captureInboundLead(channel.tenant_id, channel.created_by, {
        source: channel.channel_code,
        source_external_id: `${channel.id}:${externalId}`,
        company_name: companyName,
        contact_person: this.text(body.contact_person || body.contact_name || body.name) || null,
        email: this.text(body.email) || null,
        phone: this.text(body.phone || body.mobile) || null,
        requirement: this.text(body.requirement || body.message || body.enquiry || body.subject).slice(0, 4000) || null,
        product_interest: this.text(body.product_interest || body.product).slice(0, 240) || null,
        campaign: this.text(body.campaign).slice(0, 160) || null,
        territory: this.text(body.territory).slice(0, 120) || null,
        industry: this.text(body.industry).slice(0, 120) || null,
        expected_value: body.expected_value,
        currency_code: body.currency_code,
        source_payload: safePayload,
      });
      await this.db.from("crm_inbound_events").insert({
        tenant_id: channel.tenant_id,
        channel_id: channel.id,
        external_id: externalId,
        payload_hash: payloadHash,
        lead_id: captured.lead.id,
        status: captured.reused ? "REUSED" : "CAPTURED",
        processed_at: new Date().toISOString(),
      });
      await this.db.from("crm_inbound_channels").update({ last_received_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", channel.id);
      return { accepted: true, reused: captured.reused, lead_id: captured.lead.id };
    } catch (captureError: any) {
      await this.db.from("crm_inbound_events").insert({
        tenant_id: channel.tenant_id,
        channel_id: channel.id,
        external_id: externalId,
        payload_hash: payloadHash,
        status: "REJECTED",
        error_message: this.text(captureError?.message).slice(0, 500),
        processed_at: new Date().toISOString(),
      }).catch(() => undefined);
      throw captureError;
    }
  }

  async importLeads(tenantId: string, userId: string, body: any) {
    const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 500) : [];
    if (!rows.length)
      throw new BadRequestException("Provide between 1 and 500 lead rows.");
    const result = {
      created: [] as string[],
      reused: [] as string[],
      rejected: [] as Array<{ row: number; reason: string }>,
    };
    for (let index = 0; index < rows.length; index += 1) {
      try {
        const identity = this.normalize(
          rows[index].email || rows[index].phone || rows[index].company_name,
        );
        if (!identity)
          throw new BadRequestException(
            "Company, email, phone, or a source external ID is required.",
          );
        const sourceExternalId =
          this.text(rows[index].source_external_id) || `IMPORT-${identity}`;
        const captured = await this.captureInboundLead(tenantId, userId, {
          ...rows[index],
          source: rows[index].source || "IMPORT",
          source_external_id: sourceExternalId,
        });
        (captured.reused ? result.reused : result.created).push(
          captured.lead.lead_number,
        );
      } catch (error: any) {
        result.rejected.push({
          row: index + 1,
          reason: this.text(error?.message) || "Unable to import row.",
        });
      }
    }
    return result;
  }

  async mergeLeads(
    tenantId: string,
    sourceId: string,
    targetId: string,
    userId: string,
    reason?: string,
  ) {
    if (!targetId || sourceId === targetId)
      throw new BadRequestException(
        "Select a different target lead to merge into.",
      );
    const [source, target] = await Promise.all([
      this.lead(tenantId, sourceId),
      this.lead(tenantId, targetId),
    ]);
    if (
      source.customer_id &&
      target.customer_id &&
      source.customer_id !== target.customer_id
    )
      throw new BadRequestException(
        "Leads linked to different customers cannot be merged.",
      );
    const fields = [
      "contact_person",
      "email",
      "phone",
      "alternate_phone",
      "territory",
      "industry",
      "product_interest",
      "requirement",
      "expected_close_date",
      "next_follow_up_at",
    ];
    const patch: any = { updated_at: new Date().toISOString() };
    fields.forEach((field) => {
      if (!target[field] && source[field]) patch[field] = source[field];
    });
    patch.expected_value = Math.max(
      this.number(target.expected_value),
      this.number(source.expected_value),
    );
    patch.customer_id = target.customer_id || source.customer_id || null;
    Object.assign(patch, this.calculateLeadScore({ ...target, ...patch }));
    const { error: targetError } = await this.db
      .from("crm_leads")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", targetId);
    if (targetError)
      this.fail(targetError, "Unable to update the retained CRM lead.");
    await Promise.all([
      this.db
        .from("crm_activities")
        .update({ lead_id: targetId, customer_id: patch.customer_id })
        .eq("tenant_id", tenantId)
        .eq("lead_id", sourceId),
      this.db
        .from("crm_notifications")
        .update({ status: "RESOLVED", resolved_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("lead_id", sourceId),
      this.db
        .from("crm_leads")
        .update({
          merged_into_lead_id: targetId,
          merged_at: new Date().toISOString(),
          merged_by: userId,
          conversion_error: this.text(reason) || "Duplicate merged",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", sourceId),
    ]);
    await this.addActivity(tenantId, targetId, userId, {
      activity_type: "NOTE",
      subject: `Merged duplicate ${source.lead_number}`,
      notes:
        this.text(reason) ||
        `${source.company_name} was merged into this retained lead.`,
      status: "COMPLETED",
    });
    return this.lead(tenantId, targetId);
  }

  async scanDueFollowups(tenantId?: string) {
    let leadQuery = this.db
      .from("crm_leads")
      .select(
        "id,tenant_id,lead_number,company_name,owner_user_id,next_follow_up_at,stage:crm_pipeline_stages(is_closed)",
      )
      .is("merged_into_lead_id", null)
      .not("next_follow_up_at", "is", null);
    if (tenantId) leadQuery = leadQuery.eq("tenant_id", tenantId);
    const { data, error } = await leadQuery.limit(5000);
    if (error) this.fail(error, "Unable to scan CRM follow-ups.");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const rows: any[] = [];
    for (const lead of data || []) {
      if ((lead as any).stage?.is_closed) continue;
      const dueAt = new Date((lead as any).next_follow_up_at);
      if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() > now.getTime())
        continue;
      const escalated = now.getTime() - dueAt.getTime() >= 24 * 60 * 60 * 1000;
      rows.push({
        tenant_id: (lead as any).tenant_id,
        lead_id: (lead as any).id,
        owner_user_id: (lead as any).owner_user_id,
        notification_type: escalated
          ? "FOLLOW_UP_ESCALATION"
          : "FOLLOW_UP_REMINDER",
        notification_date: today,
        title: `${escalated ? "Escalated" : "Due"}: ${(lead as any).company_name}`,
        message: `${(lead as any).lead_number} follow-up was due ${dueAt.toISOString()}.`,
        status: "OPEN",
      });
    }
    if (rows.length) {
      const { error: upsertError } = await this.db
        .from("crm_notifications")
        .upsert(rows, {
          onConflict: "tenant_id,lead_id,notification_type,notification_date",
          ignoreDuplicates: true,
        });
      if (upsertError)
        this.fail(upsertError, "Unable to record CRM follow-up reminders.");
    }
    return { scanned: (data || []).length, due: rows.length };
  }

  async notifications(tenantId: string, userId?: string) {
    let query = this.db
      .from("crm_notifications")
      .select("*,lead:crm_leads(lead_number,company_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "OPEN")
      .order("created_at", { ascending: false });
    if (userId)
      query = query.or(`owner_user_id.eq.${userId},owner_user_id.is.null`);
    const { data, error } = await query.limit(100);
    if (error) this.fail(error, "Unable to load CRM reminders.");
    return data || [];
  }

  async resolveNotification(tenantId: string, id: string, userId: string) {
    const { data, error } = await this.db
      .from("crm_notifications")
      .update({ status: "RESOLVED", resolved_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .or(`owner_user_id.eq.${userId},owner_user_id.is.null`)
      .select("*")
      .maybeSingle();
    if (error || !data)
      throw new NotFoundException(error?.message || "CRM reminder not found.");
    return data;
  }

  async planPromptAction(tenantId: string, input: any) {
    await this.ensureStages(tenantId);
    const action = this.text(input.crm_action).toUpperCase();
    const query = this.text(
      input.reference_query || input.company_name || input.counterparty_query,
    );
    const [leadResult, stageResult, userResult] = await Promise.all([
      this.db
        .from("crm_leads")
        .select("id,lead_number,company_name,stage_id,owner_user_id")
        .eq("tenant_id", tenantId)
        .is("merged_into_lead_id", null)
        .limit(1000),
      this.db
        .from("crm_pipeline_stages")
        .select("id,stage_code,stage_name,is_closed")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      this.db
        .from("users")
        .select("id,first_name,last_name,email,is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
    ]);
    if (leadResult.error || stageResult.error || userResult.error)
      this.fail(
        leadResult.error || stageResult.error || userResult.error,
        "Unable to resolve the CRM prompt.",
      );
    const matches = (leadResult.data || []).filter(
      (lead: any) =>
        query &&
        [lead.lead_number, lead.company_name].some(
          (value) =>
            this.normalize(value).includes(this.normalize(query)) ||
            this.normalize(query).includes(this.normalize(value)),
        ),
    );
    const lead = matches.length === 1 ? matches[0] : null;
    const ownerQuery = this.text(input.owner_query || input.employee_query);
    const ownerMatches = (userResult.data || [])
      .map((user: any) => ({
        ...user,
        name:
          [user.first_name, user.last_name].filter(Boolean).join(" ") ||
          user.email,
      }))
      .filter(
        (user: any) =>
          ownerQuery &&
          [user.name, user.email].some(
            (value) =>
              this.normalize(value).includes(this.normalize(ownerQuery)) ||
              this.normalize(ownerQuery).includes(this.normalize(value)),
          ),
      );
    const owner = ownerMatches.length === 1 ? ownerMatches[0] : null;
    const stageQuery = this.text(input.stage_query);
    const stageMatches = (stageResult.data || []).filter(
      (stage: any) =>
        stageQuery &&
        [stage.stage_code, stage.stage_name].some(
          (value) =>
            this.normalize(value) === this.normalize(stageQuery) ||
            this.normalize(value).includes(this.normalize(stageQuery)),
        ),
    );
    const stage = stageMatches.length === 1 ? stageMatches[0] : null;
    const questions: string[] = [];
    if (
      ![
        "CREATE_LEAD",
        "LOG_ACTIVITY",
        "SCHEDULE_FOLLOW_UP",
        "ASSIGN_OWNER",
        "CHANGE_STAGE",
      ].includes(action)
    )
      questions.push(
        "Should I create a lead, log an activity, schedule a follow-up, assign an owner, or change a stage?",
      );
    if (
      action === "CREATE_LEAD" &&
      !this.text(input.company_name || input.counterparty_query)
    )
      questions.push("What is the prospect company name?");
    if (action !== "CREATE_LEAD" && action && !lead)
      questions.push(
        matches.length > 1
          ? `Which lead do you mean? Matches: ${matches.map((item: any) => `${item.lead_number} - ${item.company_name}`).join(", ")}`
          : "Which lead number or prospect company should I update?",
      );
    if (
      ["LOG_ACTIVITY", "SCHEDULE_FOLLOW_UP"].includes(action) &&
      !this.text(input.notes || input.reason)
    )
      questions.push("What activity or follow-up should be recorded?");
    if (
      action === "SCHEDULE_FOLLOW_UP" &&
      !this.text(input.delivery_date || input.due_date)
    )
      questions.push("On what date should the follow-up be scheduled?");
    if (action === "ASSIGN_OWNER" && !owner)
      questions.push(
        ownerMatches.length > 1
          ? `Which owner do you mean? Matches: ${ownerMatches.map((item: any) => item.name).join(", ")}`
          : "Which active user should own this lead?",
      );
    if (action === "CHANGE_STAGE" && !stage)
      questions.push("Which CRM stage should this lead move to?");
    return { action, lead, owner, stage, questions };
  }

  async executePromptAction(
    tenantId: string,
    userId: string,
    input: any,
    resolved?: any,
  ) {
    const plan = resolved?.action
      ? resolved
      : await this.planPromptAction(tenantId, input);
    if (plan.questions?.length)
      throw new BadRequestException(plan.questions.join(" "));
    if (plan.action === "CREATE_LEAD")
      return this.createLead(tenantId, userId, {
        company_name: input.company_name || input.counterparty_query,
        contact_person: input.contact_person,
        email: input.email,
        phone: input.phone,
        source: "ACTIVE_PLANNER",
        requirement: input.notes || input.reason,
        expected_value: input.amount || 0,
        currency_code: input.currency,
        priority: input.priority || "MEDIUM",
        next_follow_up_at: input.delivery_date || input.due_date || null,
      });
    if (plan.action === "ASSIGN_OWNER")
      return this.assignLead(
        tenantId,
        plan.lead.id,
        plan.owner.id,
        userId,
        input.reason || "Assigned through Active Planner.",
      );
    if (plan.action === "CHANGE_STAGE")
      return this.changeStage(
        tenantId,
        plan.lead.id,
        plan.stage.id,
        userId,
        input.reason || "Stage changed through Active Planner.",
      );
    const scheduled =
      plan.action === "SCHEDULE_FOLLOW_UP"
        ? `${input.delivery_date || input.due_date}T09:00:00`
        : null;
    return this.addActivity(tenantId, plan.lead.id, userId, {
      activity_type: input.activity_type || (scheduled ? "FOLLOW_UP" : "NOTE"),
      subject: input.notes || input.reason,
      notes: input.notes || input.reason,
      scheduled_at: scheduled,
      status: scheduled ? "OPEN" : "COMPLETED",
    });
  }

  async createAssignmentRule(tenantId: string, userId: string, body: any) {
    const ruleName = this.text(body.rule_name);
    if (!ruleName)
      throw new BadRequestException("Assignment rule name is required.");
    const assignees = await this.validateActiveAssignees(
      tenantId,
      body.assignee_user_ids,
    );
    const strategy = this.text(body.strategy).toUpperCase() || "LOAD_BALANCED";
    if (strategy === "FIXED_OWNER" && assignees.length !== 1)
      throw new BadRequestException("A fixed-owner rule requires exactly one active owner.");
    if (!assignees.length && !(await this.salesTeamCandidates(tenantId)).length)
      throw new BadRequestException(
        "Select at least one owner because no active Sales department pool is configured.",
      );
    const payload = {
      tenant_id: tenantId,
      rule_name: ruleName,
      priority: Number(body.priority || 100),
      strategy,
      source_filter: this.text(body.source_filter) || null,
      territory_filter: this.text(body.territory_filter) || null,
      industry_filter: this.text(body.industry_filter) || null,
      product_filter: this.text(body.product_filter) || null,
      assignee_user_ids: assignees,
      is_active: body.is_active !== false,
      created_by: userId,
    };
    const { data, error } = await this.db
      .from("crm_assignment_rules")
      .insert(payload)
      .select("*")
      .single();
    if (error) this.fail(error, "Unable to create assignment rule.");
    return data;
  }

  async updateAssignmentRule(tenantId: string, id: string, body: any) {
    if (body.assignee_user_ids !== undefined)
      body = {
        ...body,
        assignee_user_ids: await this.validateActiveAssignees(
          tenantId,
          body.assignee_user_ids,
        ),
      };
    const allowed = [
      "rule_name",
      "priority",
      "strategy",
      "source_filter",
      "territory_filter",
      "industry_filter",
      "product_filter",
      "assignee_user_ids",
      "is_active",
    ];
    const patch: any = { updated_at: new Date().toISOString() };
    allowed.forEach((key) => {
      if (body[key] !== undefined) patch[key] = body[key];
    });
    const { data, error } = await this.db
      .from("crm_assignment_rules")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error || !data)
      throw new NotFoundException(
        error?.message || "CRM assignment rule not found.",
      );
    return data;
  }
}
