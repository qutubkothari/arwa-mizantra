import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { MachineTelemetryService } from "./machine-telemetry.service";

@Injectable()
export class ProductionDeviceGatewayService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  constructor(private readonly telemetry: MachineTelemetryService) {}
  private text(value: any) {
    return String(value || "").trim();
  }
  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
  private roleNames(user: any) {
    return [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
      .map((role: any) =>
        String(
          typeof role === "string"
            ? role
            : role?.name || role?.role?.name || "",
        ),
      )
      .map((role: string) => role.toUpperCase().replace(/[\s-]+/g, "_"));
  }
  private activationApprover(user: any) {
    const userId = this.text(user?.userId || user?.id);
    if (
      !userId ||
      !this.roleNames(user).some((role) =>
        [
          "SUPER_ADMIN",
          "ADMIN",
          "ADMINISTRATOR",
          "PRODUCTION_MANAGER",
          "OPERATIONS_MANAGER",
        ].includes(role),
      )
    ) {
      throw new ForbiddenException(
        "An authorised production or administrator approver is required for live gateway activation.",
      );
    }
    return userId;
  }
  async list(tenantId: string) {
    const { data, error } = await this.db
      .from("production_device_gateways")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("gateway_code");
    if (error) throw new BadRequestException(error.message);
    const now = Date.now();
    return (data || []).map((gateway: any) => ({
      ...gateway,
      health: !gateway.last_heartbeat_at
        ? "NO_HEARTBEAT"
        : now - new Date(gateway.last_heartbeat_at).getTime() >
            Number(gateway.heartbeat_seconds) * 2000
          ? "STALE"
          : "HEALTHY",
    }));
  }
  async save(tenantId: string, userId: string, body: any) {
    const code = this.text(body.gateway_code).toUpperCase(),
      name = this.text(body.gateway_name),
      protocol = this.text(body.protocol).toUpperCase();
    if (
      !code ||
      !name ||
      !["HTTPS_WEBHOOK", "MQTT", "OPC_UA", "MODBUS", "FILE"].includes(protocol)
    )
      throw new BadRequestException(
        "Gateway code, name and a supported protocol are required.",
      );
    const requestedStatus = this.text(body.status || "TESTING").toUpperCase();
    if (!["DRAFT", "TESTING", "PAUSED", "ERROR"].includes(requestedStatus))
      throw new BadRequestException(
        "Gateway registration only supports DRAFT, TESTING, PAUSED or ERROR. Use the independent activation approval to enable a live gateway.",
      );
    const heartbeat = Number(body.heartbeat_seconds || 300);
    if (!Number.isInteger(heartbeat) || heartbeat < 30 || heartbeat > 86400)
      throw new BadRequestException("Heartbeat must be 30 to 86400 seconds.");
    if (body.is_test_mode === false)
      throw new BadRequestException(
        "Live mode requires an independently approved field mapping. Register the gateway in test mode first.",
      );
    const { data: existing, error: existingError } = await this.db
      .from("production_device_gateways")
      .select("id,field_mapping,mapping_version")
      .eq("tenant_id", tenantId)
      .eq("gateway_code", code)
      .maybeSingle();
    if (existingError) throw new BadRequestException(existingError.message);
    const mappingChanged =
      Boolean(existing) &&
      JSON.stringify(existing?.field_mapping || {}) !==
        JSON.stringify(body.field_mapping || {});
    const record: any = {
      tenant_id: tenantId,
      gateway_code: code,
      gateway_name: name,
      protocol,
      status: requestedStatus,
      endpoint_reference: this.text(body.endpoint_reference) || null,
      secret_reference: this.text(body.secret_reference) || null,
      field_mapping: body.field_mapping || {},
      heartbeat_seconds: heartbeat,
      is_test_mode: true,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (!existing || mappingChanged)
      Object.assign(record, {
        mapping_version: Number(existing?.mapping_version || 0) + 1,
        mapping_approval_status: "DRAFT",
        mapping_submitted_by: null,
        mapping_submitted_at: null,
        mapping_approved_by: null,
        mapping_approved_at: null,
        activation_note: null,
      });
    const { data, error } = await this.db
      .from("production_device_gateways")
      .upsert(record, { onConflict: "tenant_id,gateway_code" })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async submitActivation(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const note = this.text(body?.activation_note);
    const { data: gateway, error: fetchError } = await this.db
      .from("production_device_gateways")
      .select("id,status,is_test_mode,mapping_approval_status")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (fetchError || !gateway)
      throw new BadRequestException(
        fetchError?.message || "Gateway not found.",
      );
    if (
      !["DRAFT", "REJECTED", "REVOKED"].includes(
        String(gateway.mapping_approval_status || "DRAFT"),
      )
    )
      throw new BadRequestException(
        "This gateway mapping is already awaiting or has received an approval decision.",
      );
    const { data, error } = await this.db
      .from("production_device_gateways")
      .update({
        mapping_approval_status: "SUBMITTED",
        mapping_submitted_by: userId,
        mapping_submitted_at: new Date().toISOString(),
        activation_note: note || null,
        status: "TESTING",
        is_test_mode: true,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return {
      gateway: data,
      next_step:
        "A different authorised production or administrator user must approve the mapping before this gateway can become live.",
    };
  }

  async decideActivation(tenantId: string, user: any, id: string, body: any) {
    const approverId = this.activationApprover(user);
    const decision = this.text(body?.decision).toUpperCase();
    if (!["APPROVE", "REJECT", "REVOKE"].includes(decision))
      throw new BadRequestException(
        "Decision must be APPROVE, REJECT or REVOKE.",
      );
    const { data: gateway, error: fetchError } = await this.db
      .from("production_device_gateways")
      .select("id,mapping_submitted_by,mapping_approval_status")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (fetchError || !gateway)
      throw new BadRequestException(
        fetchError?.message || "Gateway not found.",
      );
    if (decision === "APPROVE" && gateway.mapping_submitted_by === approverId)
      throw new ForbiddenException(
        "Maker-checker control prevents approving your own gateway mapping.",
      );
    if (
      decision === "APPROVE" &&
      gateway.mapping_approval_status !== "SUBMITTED"
    )
      throw new BadRequestException(
        "Only a submitted gateway mapping can be approved.",
      );
    const approved = decision === "APPROVE";
    const { data, error } = await this.db
      .from("production_device_gateways")
      .update({
        mapping_approval_status: approved
          ? "APPROVED"
          : decision === "REJECT"
            ? "REJECTED"
            : "REVOKED",
        mapping_approved_by: approved ? approverId : null,
        mapping_approved_at: approved ? new Date().toISOString() : null,
        activation_note: this.text(body?.activation_note) || null,
        status: approved ? "ACTIVE" : "PAUSED",
        is_test_mode: !approved,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return {
      gateway: data,
      live_events_enabled: approved,
      control: approved
        ? "Field mapping approved by an independent authorised user. Transaction-producing event types remain review-required until their native mapping is separately released."
        : "Gateway is paused from live operation.",
    };
  }
  async heartbeat(tenantId: string, code: string, body: any) {
    const { data, error } = await this.db
      .from("production_device_gateways")
      .update({
        last_heartbeat_at: new Date().toISOString(),
        last_event_at:
          body.event_received === true ? new Date().toISOString() : undefined,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("gateway_code", this.text(code).toUpperCase())
      .in("status", ["TESTING", "ACTIVE"])
      .select()
      .maybeSingle();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Active/testing gateway not found.",
      );
    return data;
  }

  async rotateCredential(tenantId: string, userId: string, id: string) {
    const publicKeyId = `gw_${randomBytes(12).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    const { data, error } = await this.db
      .from("production_device_gateways")
      .update({
        public_key_id: publicKeyId,
        api_key_hash: this.hash(secret),
        updated_at: new Date().toISOString(),
        created_by: userId,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("id,gateway_code,gateway_name,public_key_id,status")
      .maybeSingle();
    if (error || !data)
      throw new BadRequestException(error?.message || "Gateway not found.");
    return {
      gateway: data,
      api_key: secret,
      warning:
        "Copy this key now. Mizantra stores only its hash and cannot display it again.",
    };
  }

  private authenticate(storedHash: string, supplied: string) {
    const actual = Buffer.from(this.hash(supplied), "hex");
    const expected = Buffer.from(storedHash || "", "hex");
    return (
      actual.length === expected.length &&
      actual.length > 0 &&
      timingSafeEqual(actual, expected)
    );
  }

  private mapped(payload: Record<string, any>, mapping: Record<string, any>) {
    const output: Record<string, any> = {};
    for (const [target, source] of Object.entries(mapping || {}))
      if (
        typeof source === "string" &&
        Object.prototype.hasOwnProperty.call(payload, source)
      )
        output[target] = payload[source];
    return { ...payload, ...output };
  }

  async preflightPayload(tenantId: string, gatewayCode: string, body: any) {
    const { data: gateway, error } = await this.db
      .from("production_device_gateways")
      .select("gateway_code,status,is_test_mode,field_mapping,mapping_version")
      .eq("tenant_id", tenantId)
      .eq("gateway_code", this.text(gatewayCode).toUpperCase())
      .in("status", ["DRAFT", "TESTING", "PAUSED"])
      .maybeSingle();
    if (error || !gateway)
      throw new BadRequestException(
        error?.message || "Test-mode gateway not found.",
      );
    if (gateway.is_test_mode === false)
      throw new BadRequestException(
        "Payload preflight is limited to test-mode gateways.",
      );
    const payload =
      body?.payload &&
      typeof body.payload === "object" &&
      !Array.isArray(body.payload)
        ? body.payload
        : {};
    if (JSON.stringify(payload).length > 65536)
      throw new BadRequestException("Gateway payload exceeds 64 KB.");
    const eventType = this.text(body?.event_type).toUpperCase();
    const normalized = this.mapped(payload, gateway.field_mapping || {});
    const telemetry = [
      "RUN",
      "IDLE",
      "STOP",
      "COUNT",
      "QUALITY",
      "ENERGY",
      "CONDITION",
    ].includes(eventType);
    const required = telemetry ? ["work_station_id"] : [];
    const missing = required.filter(
      (field) =>
        normalized[field] == null || String(normalized[field]).trim() === "",
    );
    return {
      test_only: true,
      no_event_persisted: true,
      no_native_transaction_created: true,
      gateway_code: gateway.gateway_code,
      mapping_version: gateway.mapping_version,
      event_type: eventType || null,
      transaction_intent: telemetry ? "MACHINE_TELEMETRY" : "REVIEW_REQUIRED",
      valid: Boolean(eventType) && missing.length === 0,
      missing_required_fields: missing,
      mapped_fields: Object.keys(gateway.field_mapping || {}),
      normalized_preview: normalized,
      note: telemetry
        ? "A valid preflight proves only field compatibility. It does not authorise a live device or post a transaction."
        : "Non-telemetry events remain review-required even after a valid preflight.",
    };
  }

  async ingestExternal(publicKeyId: string, apiKey: string, body: any) {
    if (!publicKeyId || !apiKey)
      throw new UnauthorizedException(
        "Gateway identity and API key are required.",
      );
    const { data: gateway, error } = await this.db
      .from("production_device_gateways")
      .select("*")
      .eq("public_key_id", publicKeyId)
      .in("status", ["TESTING", "ACTIVE"])
      .maybeSingle();
    if (
      error ||
      !gateway ||
      !this.authenticate(String(gateway.api_key_hash || ""), apiKey)
    )
      throw new UnauthorizedException("Gateway authentication failed.");
    const sourceEventId = this.text(body?.source_event_id);
    const eventType = this.text(body?.event_type).toUpperCase();
    if (
      !sourceEventId ||
      sourceEventId.length > 120 ||
      !eventType ||
      eventType.length > 80
    )
      throw new BadRequestException(
        "A bounded source event ID and event type are required.",
      );
    const occurredAt = body?.occurred_at
      ? new Date(body.occurred_at)
      : new Date();
    if (
      Number.isNaN(occurredAt.getTime()) ||
      Math.abs(Date.now() - occurredAt.getTime()) > 31 * 86400000
    )
      throw new BadRequestException(
        "Event timestamp is invalid or outside the 31-day acceptance window.",
      );
    const rawPayload =
      body?.payload &&
      typeof body.payload === "object" &&
      !Array.isArray(body.payload)
        ? body.payload
        : {};
    const serialized = JSON.stringify(rawPayload);
    if (serialized.length > 65536)
      throw new BadRequestException("Gateway payload exceeds 64 KB.");
    const normalized = this.mapped(rawPayload, gateway.field_mapping || {});
    const transactionIntent = [
      "RUN",
      "IDLE",
      "STOP",
      "COUNT",
      "QUALITY",
      "ENERGY",
      "CONDITION",
    ].includes(eventType)
      ? "MACHINE_TELEMETRY"
      : [
            "MATERIAL_SCAN",
            "FINISHED_SCAN",
            "REJECTION",
            "DISPATCH_SCAN",
          ].includes(eventType)
        ? eventType
        : "REVIEW";
    const record = {
      tenant_id: gateway.tenant_id,
      gateway_id: gateway.id,
      source_event_id: sourceEventId,
      event_type: eventType,
      occurred_at: occurredAt.toISOString(),
      payload_hash: this.hash(serialized),
      normalized_event: normalized,
      transaction_intent: transactionIntent,
      status:
        transactionIntent === "MACHINE_TELEMETRY"
          ? "VALIDATED"
          : "REVIEW_REQUIRED",
    };
    const { data: inbox, error: insertError } = await this.db
      .from("mizantra_connector_inbox")
      .upsert(record, {
        onConflict: "tenant_id,gateway_id,source_event_id",
        ignoreDuplicates: true,
      })
      .select()
      .maybeSingle();
    if (insertError) throw new BadRequestException(insertError.message);
    if (!inbox) return { duplicate: true, source_event_id: sourceEventId };
    let native: any = null;
    if (transactionIntent === "MACHINE_TELEMETRY") {
      try {
        native = await this.telemetry.ingest(gateway.tenant_id, {
          ...normalized,
          event_type: eventType,
          source_event_id: `${gateway.gateway_code}:${sourceEventId}`,
          occurred_at: occurredAt.toISOString(),
        });
        await this.db
          .from("mizantra_connector_inbox")
          .update({
            status: "PROCESSED",
            native_resource_type: "PRODUCTION_MACHINE_EVENT",
            native_resource_id: native?.event?.id || null,
            processed_at: new Date().toISOString(),
          })
          .eq("tenant_id", gateway.tenant_id)
          .eq("id", inbox.id);
      } catch (nativeError: any) {
        await this.db
          .from("mizantra_connector_inbox")
          .update({
            status: "FAILED",
            failure_reason: String(
              nativeError?.message || "Telemetry processing failed",
            ).slice(0, 500),
            processed_at: new Date().toISOString(),
          })
          .eq("tenant_id", gateway.tenant_id)
          .eq("id", inbox.id);
        throw nativeError;
      }
    }
    await this.db
      .from("production_device_gateways")
      .update({
        last_heartbeat_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", gateway.tenant_id)
      .eq("id", gateway.id);
    return {
      accepted: true,
      inbox_id: inbox.id,
      status:
        transactionIntent === "MACHINE_TELEMETRY"
          ? "PROCESSED"
          : "REVIEW_REQUIRED",
      transaction_intent: transactionIntent,
      native,
    };
  }
}
