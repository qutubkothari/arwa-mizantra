import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { AuditService } from "../audit/audit.service";
import {
  assertVisitTransition,
  evaluateLocation,
  haversineMetres,
  payloadHash,
  recommendationScore,
  recurrenceDates,
  VisitStatus,
} from "./fsm.domain";

type Actor = { tenantId: string; userId: string; role?: any; roles?: any[]; permissions?: string[] };

@Injectable()
export class FsmService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(private readonly audit: AuditService) {}

  private fail(error: any, fallback: string): never {
    throw new BadRequestException({ code: "validation_failed", message: error?.message || fallback });
  }

  private roleNames(user: Actor) {
    const names = [user.role, ...(user.roles || [])]
      .map((entry: any) => entry?.role?.name || entry?.name || entry)
      .map((value) => String(value || "").toUpperCase().replace(/[ -]+/g, "_"));
    return new Set(names);
  }

  private isAdmin(user: Actor) {
    const roles = this.roleNames(user);
    return roles.has("SUPER_ADMIN") || roles.has("ADMIN") || roles.has("ADMINISTRATOR");
  }

  private isManager(user: Actor) {
    return this.isAdmin(user) || Array.from(this.roleNames(user)).some((role) => role.includes("MANAGER"));
  }

  private async allowedAccountIds(user: Actor): Promise<string[] | null> {
    if (this.isAdmin(user)) return null;
    const today = new Date().toISOString().slice(0, 10);
    const owned = await this.db
      .from("crm_accounts")
      .select("id")
      .eq("tenant_id", user.tenantId)
      .eq("owner_user_id", user.userId);
    const assignments = await this.db
      .from("fsm_account_assignments")
      .select("account_id")
      .eq("tenant_id", user.tenantId)
      .eq("representative_user_id", user.userId)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`);
    const ids = new Set<string>([...(owned.data || []), ...(assignments.data || [])].map((row: any) => row.id || row.account_id));

    if (this.isManager(user)) {
      const territories = await this.db
        .from("crm_territories")
        .select("id,member_user_ids")
        .eq("tenant_id", user.tenantId)
        .eq("manager_user_id", user.userId);
      const territoryIds = (territories.data || []).map((row: any) => row.id);
      const memberIds = (territories.data || []).flatMap((row: any) => row.member_user_ids || []);
      if (territoryIds.length) {
        const siteRows = await this.db.from("fsm_customer_sites").select("account_id").eq("tenant_id", user.tenantId).in("territory_id", territoryIds);
        (siteRows.data || []).forEach((row: any) => ids.add(row.account_id));
      }
      if (memberIds.length) {
        const memberAccounts = await this.db.from("crm_accounts").select("id").eq("tenant_id", user.tenantId).in("owner_user_id", memberIds);
        (memberAccounts.data || []).forEach((row: any) => ids.add(row.id));
      }
    }
    return [...ids];
  }

  private async assertAccountScope(user: Actor, accountId: string) {
    const allowed = await this.allowedAccountIds(user);
    if (allowed !== null && !allowed.includes(accountId)) throw new NotFoundException("Record not found.");
    const { data } = await this.db.from("crm_accounts").select("id").eq("tenant_id", user.tenantId).eq("id", accountId).maybeSingle();
    if (!data) throw new NotFoundException("Record not found.");
  }

  private async visit(user: Actor, id: string) {
    const { data, error } = await this.db
      .from("fsm_visits")
      .select("*,account:crm_accounts(id,account_number,account_name,owner_user_id,customer_id),site:fsm_customer_sites(*),contact:crm_contacts(*)")
      .eq("tenant_id", user.tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) this.fail(error, "Unable to load visit.");
    if (!data) throw new NotFoundException("Record not found.");
    const allowed = await this.allowedAccountIds(user);
    if (allowed !== null && data.representative_user_id !== user.userId && !allowed.includes(data.account_id))
      throw new NotFoundException("Record not found.");
    return data;
  }

  async visitDetail(user: Actor, id: string) {
    const visit = await this.visit(user, id);
    const [events, reports, links] = await Promise.all([
      this.db.from("fsm_visit_events").select("id,event_type,from_status,to_status,server_recorded_at,device_recorded_at,evidence_status,reason_code,notes,actor_user_id").eq("tenant_id", user.tenantId).eq("visit_id", id).order("server_recorded_at"),
      this.db.from("fsm_visit_reports").select("*").eq("tenant_id", user.tenantId).eq("visit_id", id).order("revision", { ascending: false }),
      this.db.from("fsm_commercial_links").select("*").eq("tenant_id", user.tenantId).eq("visit_id", id),
    ]);
    return { ...visit, events: events.data || [], reports: reports.data || [], commercial_links: links.data || [] };
  }

  async capabilities(user: Actor) {
    const settings = await this.settings(user);
    return {
      module: "MIZANTRA_FSM",
      version: 1,
      online: true,
      offline: { indexed_db: true, background_sync_required: false, manual_sync: true },
      routing: { provider: settings.routing_provider, available: settings.routing_enabled === true, fallback: "STRAIGHT_LINE_PREVIEW" },
      commercial: { quotations: "EXISTING_ERP_ADAPTER", orders: "EXISTING_ERP_ADAPTER", revalidation_required: true },
      messaging: { whatsapp: "DRAFT_ONLY", explicit_send_confirmation: true },
    };
  }

  async settings(user: Actor) {
    const { data, error } = await this.db.from("fsm_settings").select("*").eq("tenant_id", user.tenantId).maybeSingle();
    if (error) this.fail(error, "Unable to load FSM settings.");
    return data || {
      tenant_id: user.tenantId,
      timezone: "UTC",
      working_days: [1, 2, 3, 4, 5],
      day_start: "09:00",
      day_end: "18:00",
      checkin_radius_m: 150,
      max_location_age_seconds: 120,
      max_location_accuracy_m: 100,
      require_checkout_report: true,
      require_report_attachment: false,
      routing_provider: "STRAIGHT_LINE",
      routing_enabled: false,
    };
  }

  async updateSettings(user: Actor, body: any) {
    if (!this.isAdmin(user)) throw new ForbiddenException("Administrator access is required.");
    const patch = {
      tenant_id: user.tenantId,
      timezone: String(body.timezone || "UTC"),
      working_days: body.working_days || [1, 2, 3, 4, 5],
      day_start: body.day_start || "09:00",
      day_end: body.day_end || "18:00",
      checkin_radius_m: Number(body.checkin_radius_m || 150),
      max_location_age_seconds: Number(body.max_location_age_seconds || 120),
      max_location_accuracy_m: Number(body.max_location_accuracy_m || 100),
      require_checkout_report: body.require_checkout_report !== false,
      require_report_attachment: body.require_report_attachment === true,
      routing_provider: String(body.routing_provider || "STRAIGHT_LINE"),
      routing_enabled: body.routing_enabled === true,
      updated_by: user.userId,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.db.from("fsm_settings").upsert(patch).select().single();
    if (error) this.fail(error, "Unable to save FSM settings.");
    await this.log(user, "FSM_SETTINGS_UPDATED", "fsm_settings", user.tenantId, { precise_location_excluded: true });
    return data;
  }

  async sites(user: Actor, filters: any = {}) {
    const allowed = await this.allowedAccountIds(user);
    if (allowed !== null && !allowed.length) return [];
    let query = this.db.from("fsm_customer_sites")
      .select("*,account:crm_accounts(id,account_number,account_name,owner_user_id),contact:crm_contacts(id,first_name,last_name,mobile,whatsapp,whatsapp_consent)")
      .eq("tenant_id", user.tenantId).order("site_name");
    if (allowed !== null) query = query.in("account_id", allowed);
    if (filters.account_id) query = query.eq("account_id", filters.account_id);
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) this.fail(error, "Unable to load customer sites.");
    return data || [];
  }

  async saveSite(user: Actor, body: any, id?: string) {
    await this.assertAccountScope(user, body.account_id);
    if (!body.site_name || !body.site_code) throw new BadRequestException("Site code and name are required.");
    const patch: any = {
      tenant_id: user.tenantId, account_id: body.account_id, site_code: String(body.site_code).trim(),
      site_name: String(body.site_name).trim(), address_text: body.address_text || null,
      latitude: body.latitude === "" || body.latitude == null ? null : Number(body.latitude),
      longitude: body.longitude === "" || body.longitude == null ? null : Number(body.longitude),
      geocode_status: body.geocode_status || (body.latitude != null ? "MANUAL" : "MISSING"),
      geofence_radius_m: body.geofence_radius_m || null, territory_id: body.territory_id || null,
      primary_contact_id: body.primary_contact_id || null, status: body.status || "ACTIVE",
      updated_at: new Date().toISOString(),
    };
    let request;
    if (id) {
      const current = await this.db.from("fsm_customer_sites").select("version,account_id").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
      if (!current.data) throw new NotFoundException("Record not found.");
      await this.assertAccountScope(user, current.data.account_id);
      if (Number(body.expected_version) !== Number(current.data.version)) throw new ConflictException({ code: "stale_version", message: "Site changed since it was opened." });
      patch.version = Number(current.data.version) + 1;
      request = this.db.from("fsm_customer_sites").update(patch).eq("tenant_id", user.tenantId).eq("id", id).select().single();
    } else {
      patch.created_by = user.userId;
      request = this.db.from("fsm_customer_sites").insert(patch).select().single();
    }
    const { data, error } = await request;
    if (error) this.fail(error, "Unable to save customer site.");
    await this.log(user, id ? "FSM_SITE_UPDATED" : "FSM_SITE_CREATED", "fsm_customer_site", data.id);
    return data;
  }

  async nearby(user: Actor, query: any) {
    const latitude = Number(query.latitude), longitude = Number(query.longitude), radius = Math.min(Number(query.radius_m || 5000), 50000);
    if (![latitude, longitude].every(Number.isFinite)) throw new BadRequestException("Valid latitude and longitude are required.");
    const rows = await this.sites(user, { status: "ACTIVE" });
    return rows.filter((site: any) => site.latitude != null).map((site: any) => ({ ...site, distance_m: haversineMetres(latitude, longitude, Number(site.latitude), Number(site.longitude)) })).filter((site: any) => site.distance_m <= radius).sort((a: any, b: any) => a.distance_m - b.distance_m);
  }

  async assignments(user: Actor, accountId: string) {
    await this.assertAccountScope(user, accountId);
    const { data, error } = await this.db.from("fsm_account_assignments").select("*").eq("tenant_id", user.tenantId).eq("account_id", accountId).order("effective_from", { ascending: false });
    if (error) this.fail(error, "Unable to load assignment history.");
    return data || [];
  }

  async saveAssignment(user: Actor, body: any) {
    if (!this.isManager(user)) throw new ForbiddenException("Manager access is required.");
    await this.assertAccountScope(user, body.account_id);
    const { data, error } = await this.db.from("fsm_account_assignments").insert({ ...body, tenant_id: user.tenantId, created_by: user.userId }).select().single();
    if (error) this.fail(error, "Unable to save coverage assignment.");
    await this.log(user, "FSM_ASSIGNMENT_CREATED", "fsm_account_assignment", data.id);
    return data;
  }

  async saveRule(user: Actor, body: any) {
    await this.assertAccountScope(user, body.account_id);
    const { data, error } = await this.db.from("fsm_visit_rules").insert({ ...body, tenant_id: user.tenantId, created_by: user.userId }).select().single();
    if (error) this.fail(error, "Unable to save visit frequency rule.");
    return data;
  }

  async generateRecurrence(user: Actor, body: any) {
    if (!this.isManager(user)) throw new ForbiddenException("Manager access is required.");
    const { data: rules, error } = await this.db.from("fsm_visit_rules").select("*").eq("tenant_id", user.tenantId).eq("is_active", true);
    if (error) this.fail(error, "Unable to load recurrence rules.");
    const created: any[] = [];
    for (const rule of rules || []) {
      for (const date of recurrenceDates(rule, body.from, body.to)) {
        const time = String(rule.preferred_time || "09:00:00").slice(0, 8);
        const start = new Date(`${date}T${time}Z`);
        const end = new Date(start.getTime() + Number(rule.duration_minutes || 45) * 60000);
        const row = { tenant_id: user.tenantId, recurrence_rule_id: rule.id, occurrence_key: date, account_id: rule.account_id, site_id: rule.site_id, representative_user_id: rule.representative_user_id, scheduled_start: start.toISOString(), scheduled_end: end.toISOString(), source: "RECURRENCE", created_by: user.userId };
        const result = await this.db.from("fsm_visits").upsert(row, { onConflict: "tenant_id,recurrence_rule_id,occurrence_key", ignoreDuplicates: true }).select().maybeSingle();
        if (result.error) this.fail(result.error, "Unable to generate recurring visits.");
        if (result.data) created.push(result.data);
      }
    }
    return { generated: created.length, from: body.from, to: body.to };
  }

  async plans(user: Actor, filters: any = {}) {
    let query = this.db.from("fsm_visit_plans").select("*").eq("tenant_id", user.tenantId).order("plan_date", { ascending: false });
    if (!this.isManager(user)) query = query.eq("representative_user_id", user.userId);
    if (filters.date) query = query.eq("plan_date", filters.date);
    const { data, error } = await query;
    if (error) this.fail(error, "Unable to load plans.");
    return data || [];
  }

  async createPlan(user: Actor, body: any) {
    const settings = await this.settings(user);
    const representative = this.isManager(user) && body.representative_user_id ? body.representative_user_id : user.userId;
    const { data, error } = await this.db.from("fsm_visit_plans").insert({ tenant_id: user.tenantId, representative_user_id: representative, plan_date: body.plan_date, timezone: body.timezone || settings.timezone, created_by: user.userId }).select().single();
    if (error) this.fail(error, "Unable to create plan.");
    return data;
  }

  async publishPlan(user: Actor, id: string, body: any) {
    if (!this.isManager(user)) throw new ForbiddenException("Manager access is required.");
    const { data: plan } = await this.db.from("fsm_visit_plans").select("*").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
    if (!plan) throw new NotFoundException("Record not found.");
    if (plan.status !== "DRAFT" || Number(body.expected_revision) !== Number(plan.revision)) throw new ConflictException({ code: "stale_version", message: "Plan changed or is already published." });
    const { data, error } = await this.db.from("fsm_visit_plans").update({ status: "PUBLISHED", immutable_after_publish: true, published_at: new Date().toISOString(), published_by: user.userId, updated_at: new Date().toISOString() }).eq("tenant_id", user.tenantId).eq("id", id).eq("revision", plan.revision).select().single();
    if (error) this.fail(error, "Unable to publish plan.");
    await this.log(user, "FSM_PLAN_PUBLISHED", "fsm_visit_plan", id, { revision: plan.revision });
    return data;
  }

  async revisePlan(user: Actor, id: string) {
    if (!this.isManager(user)) throw new ForbiddenException("Manager access is required.");
    const { data: plan } = await this.db.from("fsm_visit_plans").select("*").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
    if (!plan) throw new NotFoundException("Record not found.");
    if (plan.status !== "PUBLISHED") throw new ConflictException("Only a published plan can be revised.");
    const { data, error } = await this.db.from("fsm_visit_plans").insert({ tenant_id: user.tenantId, representative_user_id: plan.representative_user_id, plan_date: plan.plan_date, timezone: plan.timezone, status: "DRAFT", revision: Number(plan.revision) + 1, baseline_revision: plan.revision, created_by: user.userId }).select().single();
    if (error) this.fail(error, "Unable to revise plan.");
    return data;
  }

  async visits(user: Actor, filters: any = {}) {
    const allowed = await this.allowedAccountIds(user);
    if (allowed !== null && !allowed.length) return [];
    let query = this.db.from("fsm_visits").select("*,account:crm_accounts(id,account_name,account_number),site:fsm_customer_sites(id,site_name,address_text,latitude,longitude)").eq("tenant_id", user.tenantId).order("scheduled_start");
    if (allowed !== null) query = query.in("account_id", allowed);
    if (!this.isManager(user)) query = query.eq("representative_user_id", user.userId);
    if (filters.date) query = query.gte("scheduled_start", `${filters.date}T00:00:00Z`).lt("scheduled_start", `${filters.date}T23:59:59.999Z`);
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) this.fail(error, "Unable to load visits.");
    return data || [];
  }

  async createVisit(user: Actor, body: any) {
    await this.assertAccountScope(user, body.account_id);
    const representative = this.isManager(user) && body.representative_user_id ? body.representative_user_id : user.userId;
    const { data, error } = await this.db.from("fsm_visits").insert({ ...body, tenant_id: user.tenantId, representative_user_id: representative, source: body.source || "MANUAL", created_by: user.userId, client_operation_id: body.client_operation_id || null }).select().single();
    if (error) this.fail(error, "Unable to create visit.");
    await this.event(user, data, "VISIT_CREATED", null, "PLANNED", body);
    return data;
  }

  async transition(user: Actor, id: string, to: VisitStatus, body: any = {}) {
    const visit = await this.visit(user, id);
    if (visit.representative_user_id !== user.userId && !this.isManager(user)) throw new NotFoundException("Record not found.");
    assertVisitTransition(visit.status, to);
    const patch: any = { status: to, version: Number(visit.version) + 1, updated_at: new Date().toISOString() };
    let evidence: any = null;
    if (to === "CHECKED_IN") {
      const settings = await this.settings(user);
      evidence = evaluateLocation(body.location, visit.site, { radiusM: Number(visit.site?.geofence_radius_m || settings.checkin_radius_m), maxAgeSeconds: Number(settings.max_location_age_seconds), maxAccuracyM: Number(settings.max_location_accuracy_m) });
      patch.checkin_at = new Date().toISOString();
      patch.location_verification = evidence.status === "VERIFIED" ? "VERIFIED" : "EXCEPTION_PENDING";
    }
    if (to === "COMPLETED") {
      const settings = await this.settings(user);
      if (settings.require_checkout_report) {
        const report = await this.db.from("fsm_visit_reports").select("id,status,attachment_ids").eq("tenant_id", user.tenantId).eq("visit_id", id).eq("status", "SUBMITTED").order("revision", { ascending: false }).limit(1).maybeSingle();
        if (!report.data) throw new BadRequestException({ code: "validation_failed", message: "Submit the visit report before checkout." });
        if (settings.require_report_attachment && !(report.data.attachment_ids || []).length) throw new BadRequestException({ code: "validation_failed", message: "A report attachment is required before checkout." });
      }
      patch.checkout_at = new Date().toISOString();
    }
    const { data, error } = await this.db.from("fsm_visits").update(patch).eq("tenant_id", user.tenantId).eq("id", id).eq("version", visit.version).select().maybeSingle();
    if (error?.code === "23505") throw new ConflictException({ code: "active_visit_conflict", message: "Another active visit already exists." });
    if (error) this.fail(error, "Unable to update visit.");
    if (!data) throw new ConflictException({ code: "stale_version", message: "Visit changed on another device." });
    const event = await this.event(user, data, `VISIT_${to}`, visit.status, to, { ...body, evidence });
    if (to === "CHECKED_IN" && evidence?.status !== "VERIFIED") {
      await this.db.from("fsm_location_reviews").insert({ tenant_id: user.tenantId, visit_id: id, event_id: event.id, requested_by: user.userId, reason: body.exception_reason || `Location evidence: ${evidence?.status}` });
    }
    return { ...data, evidence, version: data.version };
  }

  async saveReport(user: Actor, visitId: string, body: any) {
    const visit = await this.visit(user, visitId);
    if (visit.representative_user_id !== user.userId && !this.isManager(user)) throw new NotFoundException("Record not found.");
    const existing = await this.db.from("fsm_visit_reports").select("*").eq("tenant_id", user.tenantId).eq("visit_id", visitId).order("revision", { ascending: false }).limit(1).maybeSingle();
    const submitting = body.submit === true;
    if (submitting && (!String(body.outcome || existing.data?.outcome || "").trim() || !String(body.summary || existing.data?.summary || "").trim())) throw new BadRequestException({ code: "validation_failed", message: "Outcome and summary are required to submit the report." });
    const row = { tenant_id: user.tenantId, visit_id: visitId, revision: Number(existing.data?.revision || 0) + 1, status: submitting ? "SUBMITTED" : "DRAFT", outcome: body.outcome ?? existing.data?.outcome, summary: body.summary ?? existing.data?.summary, next_action: body.next_action ?? existing.data?.next_action, follow_up_at: body.follow_up_at || null, answers: body.answers || existing.data?.answers || {}, attachment_ids: body.attachment_ids || existing.data?.attachment_ids || [], created_by: user.userId, client_operation_id: body.client_operation_id || null, client_payload_hash: body.client_payload_hash || null };
    const { data, error } = await this.db.from("fsm_visit_reports").insert(row).select().single();
    if (error) this.fail(error, "Unable to save visit report.");
    if (!submitting && visit.status === "CHECKED_IN") await this.transition(user, visitId, "REPORT_DRAFT", {});
    await this.log(user, submitting ? "FSM_REPORT_SUBMITTED" : "FSM_REPORT_SAVED", "fsm_visit_report", data.id, { revision: data.revision });
    return data;
  }

  async uploadAttachment(user: Actor, visitId: string, file: Express.Multer.File) {
    await this.visit(user, visitId);
    if (!file) throw new BadRequestException("Choose a file to upload.");
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    if (!allowed.has(file.mimetype)) throw new BadRequestException({ code: "validation_failed", message: "Only JPG, PNG, WebP and PDF evidence is allowed." });
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException({ code: "validation_failed", message: "Attachment must be 10 MB or smaller." });
    const bucket = "fsm-private";
    const safeName = String(file.originalname || "evidence").replace(/[^a-zA-Z0-9._-]/g, "_");
    const attachmentId = randomUUID();
    const path = `${user.tenantId}/${visitId}/${attachmentId}_${safeName}`;
    const bucketResult = await this.db.storage.createBucket(bucket, { public: false });
    if (bucketResult.error && !/exist/i.test(bucketResult.error.message)) this.fail(bucketResult.error, "Secure attachment storage is unavailable.");
    const uploaded = await this.db.storage.from(bucket).upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploaded.error) this.fail(uploaded.error, "Attachment upload was interrupted. Retry is safe.");
    const { data, error } = await this.db.from("fsm_attachments").insert({ id: attachmentId, tenant_id: user.tenantId, visit_id: visitId, bucket, storage_path: path, original_name: safeName, mime_type: file.mimetype, size_bytes: file.size, created_by: user.userId }).select().single();
    if (error) { await this.db.storage.from(bucket).remove([path]); this.fail(error, "Unable to register attachment."); }
    await this.log(user, "FSM_ATTACHMENT_UPLOADED", "fsm_attachment", attachmentId, { mime_type: file.mimetype, size_bytes: file.size });
    return data;
  }

  async attachmentUrl(user: Actor, id: string) {
    const { data } = await this.db.from("fsm_attachments").select("*").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
    if (!data) throw new NotFoundException("Record not found.");
    await this.visit(user, data.visit_id);
    const signed = await this.db.storage.from(data.bucket).createSignedUrl(data.storage_path, 300);
    if (signed.error) this.fail(signed.error, "Unable to authorise attachment access.");
    return { id, url: signed.data.signedUrl, expires_in_seconds: 300 };
  }

  async exceptions(user: Actor) {
    if (!this.isManager(user)) throw new ForbiddenException("Manager access is required.");
    const { data, error } = await this.db.from("fsm_location_reviews").select("*,visit:fsm_visits(*,account:crm_accounts(account_name),site:fsm_customer_sites(site_name,address_text))").eq("tenant_id", user.tenantId).order("created_at", { ascending: false });
    if (error) this.fail(error, "Unable to load location exceptions.");
    return data || [];
  }

  async reviewException(user: Actor, id: string, body: any) {
    if (!this.isManager(user)) throw new ForbiddenException("Manager access is required.");
    const { data: review } = await this.db.from("fsm_location_reviews").select("*").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
    if (!review) throw new NotFoundException("Record not found.");
    if (review.requested_by === user.userId) throw new ForbiddenException("You cannot approve your own location exception.");
    if (review.status !== "PENDING") throw new ConflictException("This exception has already been reviewed.");
    const status = body.approved === true ? "APPROVED" : "REJECTED";
    const { data, error } = await this.db.from("fsm_location_reviews").update({ status, reviewed_by: user.userId, reviewed_at: new Date().toISOString(), reviewer_notes: body.reason || null }).eq("id", id).eq("status", "PENDING").select().single();
    if (error) this.fail(error, "Unable to review exception.");
    await this.db.from("fsm_visits").update({ location_verification: `EXCEPTION_${status}`, updated_at: new Date().toISOString() }).eq("tenant_id", user.tenantId).eq("id", review.visit_id);
    await this.log(user, `FSM_LOCATION_EXCEPTION_${status}`, "fsm_location_review", id);
    return data;
  }

  async routePreview(user: Actor, body: any) {
    const visits = [];
    for (const id of body.visit_ids || []) visits.push(await this.visit(user, id));
    const excluded = visits.filter((visit: any) => visit.site?.latitude == null).map((visit: any) => ({ visit_id: visit.id, reason: "Site coordinates are missing or ambiguous" }));
    const routable = visits.filter((visit: any) => visit.site?.latitude != null).sort((a: any, b: any) => Number(a.sequence_no) - Number(b.sequence_no));
    let distanceM = 0;
    for (let index = 1; index < routable.length; index++) distanceM += haversineMetres(Number(routable[index - 1].site.latitude), Number(routable[index - 1].site.longitude), Number(routable[index].site.latitude), Number(routable[index].site.longitude));
    const settings = await this.settings(user);
    return { provider: settings.routing_enabled ? settings.routing_provider : "STRAIGHT_LINE", provider_available: settings.routing_enabled === true, is_road_route: false, distance_m: distanceM, sequence: routable.map((visit: any) => visit.id), excluded, warning: "Distance is a straight-line planning estimate. Open device navigation for road directions." };
  }

  async recommendations(user: Actor) {
    const accounts = await this.db.from("crm_accounts").select("id,account_name,owner_user_id").eq("tenant_id", user.tenantId).eq("status", "ACTIVE");
    const allowed = await this.allowedAccountIds(user);
    const scoped = (accounts.data || []).filter((account: any) => allowed === null || allowed.includes(account.id));
    const visits = await this.db.from("fsm_visits").select("account_id,scheduled_start,status").eq("tenant_id", user.tenantId).eq("status", "COMPLETED").order("scheduled_start", { ascending: false });
    const latest = new Map<string, string>();
    (visits.data || []).forEach((visit: any) => { if (!latest.has(visit.account_id)) latest.set(visit.account_id, visit.scheduled_start); });
    return scoped.map((account: any) => {
      const previous = latest.get(account.id);
      const daysSinceVisit = previous ? Math.floor((Date.now() - new Date(previous).getTime()) / 86400000) : 90;
      return { account, days_since_visit: daysSinceVisit, ...recommendationScore({ daysSinceVisit }) };
    }).sort((a: any, b: any) => b.score - a.score);
  }

  async commercialContext(user: Actor, visitId: string) {
    const visit = await this.visit(user, visitId);
    const [opportunities, quotations, invoices, links, promises] = await Promise.all([
      this.db.from("crm_opportunities").select("id,opportunity_number,opportunity_name,status,amount,currency_code").eq("tenant_id", user.tenantId).eq("account_id", visit.account_id),
      this.db.from("quotations").select("id,quotation_number,status,total_amount,currency_code,updated_at").eq("tenant_id", user.tenantId).eq("customer_id", visit.account?.customer_id || "00000000-0000-0000-0000-000000000000"),
      this.db.from("invoices").select("id,invoice_number,due_date,balance_amount,currency_code,billing_status").eq("tenant_id", user.tenantId).eq("customer_id", visit.account?.customer_id || "00000000-0000-0000-0000-000000000000").gt("balance_amount", 0),
      this.db.from("fsm_commercial_links").select("*").eq("tenant_id", user.tenantId).eq("visit_id", visitId),
      this.db.from("fsm_collection_promises").select("*").eq("tenant_id", user.tenantId).eq("visit_id", visitId),
    ]);
    return { visit_id: visitId, account: visit.account, opportunities: opportunities.data || [], quotations: quotations.data || [], invoices: invoices.data || [], links: links.data || [], collection_promises: promises.data || [], authoritative_revalidation_required: true };
  }

  async linkCommercial(user: Actor, visitId: string, body: any) {
    await this.visit(user, visitId);
    const { data, error } = await this.db.from("fsm_commercial_links").upsert({ tenant_id: user.tenantId, visit_id: visitId, document_type: body.document_type, document_id: body.document_id, created_by: user.userId }, { onConflict: "tenant_id,visit_id,document_type,document_id" }).select().single();
    if (error) this.fail(error, "Unable to link commercial document.");
    return { ...data, revalidated_at: new Date().toISOString(), source_of_truth: "ERP" };
  }

  async collectionPromise(user: Actor, visitId: string, body: any) {
    await this.visit(user, visitId);
    const invoice = await this.db.from("invoices").select("id,balance_amount,currency_code,billing_status").eq("tenant_id", user.tenantId).eq("id", body.invoice_id).maybeSingle();
    if (!invoice.data) throw new NotFoundException("Record not found.");
    if (Number(body.promised_amount) > Number(invoice.data.balance_amount)) throw new BadRequestException("Promised amount cannot exceed the current invoice balance.");
    const { data, error } = await this.db.from("fsm_collection_promises").insert({ tenant_id: user.tenantId, visit_id: visitId, invoice_id: body.invoice_id, promised_amount: Number(body.promised_amount), currency_code: invoice.data.currency_code || body.currency_code, promised_date: body.promised_date, notes: body.notes || null, receipt_attachment_id: body.receipt_attachment_id || null, created_by: user.userId, client_operation_id: body.client_operation_id || null, client_payload_hash: body.client_payload_hash || null }).select().single();
    if (error) this.fail(error, "Unable to record collection promise.");
    await this.log(user, "FSM_COLLECTION_PROMISE_RECORDED", "fsm_collection_promise", data.id, { invoice_balance_unchanged: true });
    return { ...data, invoice_balance_changed: false, finance_posting_required: true };
  }

  async messageDraft(user: Actor, visitId: string, body: any) {
    const visit = await this.visit(user, visitId);
    const contactId = body.contact_id || visit.contact_id;
    const contact = await this.db.from("crm_contacts").select("id,first_name,whatsapp,whatsapp_consent").eq("tenant_id", user.tenantId).eq("id", contactId).maybeSingle();
    if (!contact.data) throw new NotFoundException("Record not found.");
    if (contact.data.whatsapp_consent === "OPTED_OUT") throw new ForbiddenException({ code: "permission_changed", message: "WhatsApp consent is currently withdrawn." });
    const text = String(body.message_text || `Hello ${contact.data.first_name || ""}, thank you for meeting us today.`).trim();
    const { data, error } = await this.db.from("fsm_notification_drafts").insert({ tenant_id: user.tenantId, visit_id: visitId, contact_id: contactId, channel: "WHATSAPP", message_text: text, consent_snapshot: contact.data.whatsapp_consent, created_by: user.userId }).select().single();
    if (error) this.fail(error, "Unable to prepare WhatsApp draft.");
    return { ...data, sent: false, send_endpoint: "/whatsapp/send", confirmation_required: "SEND", consent_must_be_rechecked: true };
  }

  async managerDashboard(user: Actor, filters: any = {}) {
    if (!this.isManager(user)) throw new ForbiddenException("Manager access is required.");
    const rows = await this.visits(user, filters);
    const completed = rows.filter((row: any) => row.status === "COMPLETED");
    const planned = rows.filter((row: any) => !["CANCELLED"].includes(row.status));
    return { planned: planned.length, completed: completed.length, missed: rows.filter((row: any) => row.status === "MISSED").length, location_verified: completed.filter((row: any) => row.location_verification === "VERIFIED").length, compliance_rate: planned.length ? Math.round((completed.length / planned.length) * 1000) / 10 : 0, baseline_note: "Published plan denominator is retained by immutable plan revision.", currency_rule: "Amounts are not combined across currencies." };
  }

  async syncPackage(user: Actor, since?: string) {
    const [visits, sites, capabilities] = await Promise.all([this.visits(user, {}), this.sites(user, {}), this.capabilities(user)]);
    const changed = (row: any) => !since || new Date(row.updated_at || row.created_at).getTime() > new Date(since).getTime();
    return { generated_at: new Date().toISOString(), tenant_id: user.tenantId, user_id: user.userId, visits: visits.filter(changed), sites: sites.filter(changed), capabilities };
  }

  async syncBatch(user: Actor, body: any) {
    const results = [];
    for (const operation of body.operations || []) {
      const operationId = String(operation.client_operation_id || "").trim();
      if (!operationId) { results.push({ status: "FAILED", code: "validation_failed", message: "client_operation_id is required" }); continue; }
      const hash = payloadHash({ type: operation.type, payload: operation.payload });
      const prior = await this.db.from("fsm_sync_operations").select("*").eq("tenant_id", user.tenantId).eq("user_id", user.userId).eq("client_operation_id", operationId).maybeSingle();
      if (prior.data) {
        if (prior.data.payload_hash !== hash) { results.push({ client_operation_id: operationId, status: "CONFLICT", code: "idempotency_payload_mismatch" }); continue; }
        results.push({ client_operation_id: operationId, status: prior.data.status, replayed: true, ...prior.data.response }); continue;
      }
      const recovered = await this.recoverOperation(user, operationId, operation.type);
      if (recovered) {
        if (recovered.client_payload_hash && recovered.client_payload_hash !== hash) {
          results.push({ client_operation_id: operationId, status: "CONFLICT", code: "idempotency_payload_mismatch" });
          continue;
        }
        const response = { resource_id: recovered.id, recovered: true };
        await this.db.from("fsm_sync_operations").insert({ tenant_id: user.tenantId, user_id: user.userId, client_operation_id: operationId, operation_type: operation.type, payload_hash: hash, status: "COMMITTED", resource_type: operation.type, resource_id: recovered.id, response });
        results.push({ client_operation_id: operationId, status: "COMMITTED", replayed: true, ...response });
        continue;
      }
      try {
        let record: any;
        const commandPayload = { ...operation.payload, client_operation_id: operationId, client_payload_hash: hash };
        if (operation.type === "VISIT_TRANSITION") record = await this.transition(user, operation.payload.visit_id, operation.payload.to_status, commandPayload);
        else if (operation.type === "REPORT_SAVE") record = await this.saveReport(user, operation.payload.visit_id, commandPayload);
        else if (operation.type === "VISIT_CREATE") record = await this.createVisit(user, commandPayload);
        else if (operation.type === "COLLECTION_PROMISE") record = await this.collectionPromise(user, operation.payload.visit_id, commandPayload);
        else throw new BadRequestException("Unsupported offline operation.");
        const response = { resource_id: record.id || record.visit_id, version: record.version };
        await this.db.from("fsm_sync_operations").insert({ tenant_id: user.tenantId, user_id: user.userId, client_operation_id: operationId, operation_type: operation.type, payload_hash: hash, status: "COMMITTED", resource_type: operation.type, resource_id: response.resource_id || null, response });
        results.push({ client_operation_id: operationId, status: "COMMITTED", ...response });
      } catch (error: any) {
        const status = error instanceof ForbiddenException ? "FORBIDDEN" : error instanceof ConflictException ? "CONFLICT" : "FAILED";
        results.push({ client_operation_id: operationId, status, code: error?.response?.code || "validation_failed", message: error?.response?.message || error?.message });
      }
    }
    return { request_id: randomUUID(), results };
  }

  private async recoverOperation(user: Actor, operationId: string, type: string) {
    const source = type === "REPORT_SAVE"
      ? { table: "fsm_visit_reports", owner: "created_by" }
      : type === "COLLECTION_PROMISE"
        ? { table: "fsm_collection_promises", owner: "created_by" }
        : type === "VISIT_CREATE"
          ? { table: "fsm_visits", owner: "representative_user_id" }
          : { table: "fsm_visit_events", owner: "actor_user_id" };
    const { data } = await this.db.from(source.table).select("id,client_payload_hash").eq("tenant_id", user.tenantId).eq(source.owner, user.userId).eq("client_operation_id", operationId).maybeSingle();
    return data || null;
  }

  private async event(user: Actor, visit: any, type: string, from: string | null, to: string, body: any) {
    const location = body?.location || {};
    const evidence = body?.evidence || {};
    const { data, error } = await this.db.from("fsm_visit_events").insert({ tenant_id: user.tenantId, visit_id: visit.id, event_type: type, from_status: from, to_status: to, device_recorded_at: location.captured_at || null, latitude: location.latitude ?? null, longitude: location.longitude ?? null, accuracy_m: location.accuracy_m ?? null, location_age_seconds: evidence.ageSeconds ?? null, distance_from_site_m: evidence.distanceM ?? null, evidence_status: evidence.status || null, reason_code: body.reason_code || null, notes: body.notes || body.exception_reason || null, actor_user_id: user.userId, client_operation_id: body.client_operation_id || null, client_payload_hash: body.client_payload_hash || null, metadata: { source: body.source || "ONLINE" } }).select().single();
    if (error) this.fail(error, "Unable to preserve visit history.");
    return data;
  }

  private log(user: Actor, action: string, resourceType: string, resourceId: string, metadata: any = {}) {
    return this.audit.logActivity({ tenantId: user.tenantId, userId: user.userId, action, resourceType, resourceId, metadata });
  }
}
