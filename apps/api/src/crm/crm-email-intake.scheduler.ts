import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CrmService } from "./crm.service";

@Injectable()
export class CrmEmailIntakeScheduler {
  private readonly logger = new Logger(CrmEmailIntakeScheduler.name);
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  private running = false;

  constructor(private readonly crm: CrmService) {}

  private addresses(value: any): string[] {
    if (Array.isArray(value)) return value.map(String);
    const text = String(value || "").trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    return text.split(/[;,]/).map((item) => item.trim());
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingEmailReceipts() {
    if (this.running) return;
    this.running = true;
    try {
      const { data: routes, error: routeError } = await this.db
        .from("crm_email_receipt_routes")
        .select("id,tenant_id,email_address,created_by")
        .eq("is_active", true);
      if (routeError) {
        if (!/does not exist|schema cache/i.test(routeError.message || ""))
          this.logger.warn(`Email intake routes unavailable: ${routeError.message}`);
        return;
      }
      if (!routes?.length) return;
      const settingsResult = await this.db
        .from("crm_intake_settings")
        .select("tenant_id,email_intake_enabled")
        .in("tenant_id", Array.from(new Set(routes.map((route: any) => route.tenant_id))));
      const enabled = new Set(
        (settingsResult.data || [])
          .filter((row: any) => row.email_intake_enabled)
          .map((row: any) => row.tenant_id),
      );
      const activeRoutes = routes.filter((route: any) => enabled.has(route.tenant_id));
      if (!activeRoutes.length) return;
      const safeAddresses = activeRoutes
        .map((route: any) => String(route.email_address || "").toLowerCase())
        .filter((address: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
      const filters = safeAddresses.flatMap((address: string) => [
        `to_addresses.ilike.%${address}%`,
        `cc_addresses.ilike.%${address}%`,
        `bcc_addresses.ilike.%${address}%`,
      ]);
      if (!filters.length) return;
      const { data: emails, error: emailError } = await this.db
        .from("email_inbox")
        .select("id,message_id,thread_id,from_address,from_name,to_addresses,cc_addresses,bcc_addresses,subject,body_text,body_html,received_date,has_attachments")
        .is("crm_intake_processed_at", null)
        .or(filters.join(","))
        .order("received_date", { ascending: true })
        .limit(200);
      if (emailError) {
        if (!/does not exist|schema cache/i.test(emailError.message || ""))
          this.logger.warn(`Email inbox intake unavailable: ${emailError.message}`);
        return;
      }
      for (const email of emails || []) {
        const recipients = [
          ...this.addresses(email.to_addresses),
          ...this.addresses(email.cc_addresses),
          ...this.addresses(email.bcc_addresses),
        ].map((address) => address.toLowerCase());
        const route = activeRoutes.find((candidate: any) =>
          recipients.includes(String(candidate.email_address).toLowerCase()),
        );
        if (!route) continue;
        try {
          const result = await this.crm.processIntakeMessage(route.tenant_id, route.created_by, {
            channel: "EMAIL",
            external_id: String(email.message_id || email.id),
            conversation_key: String(email.thread_id || email.message_id || email.id),
            sender_name: email.from_name,
            sender_address: email.from_address,
            email: email.from_address,
            subject: email.subject,
            body: email.body_text || email.body_html,
            received_at: email.received_date,
            has_attachments: email.has_attachments,
            source_payload: { email_inbox_id: email.id, receipt_route_id: route.id },
          });
          await this.db
            .from("email_inbox")
            .update({
              crm_intake_processed_at: new Date().toISOString(),
              crm_intake_message_id: result.intake?.id || null,
              crm_intake_error: null,
            })
            .eq("id", email.id);
          await this.db
            .from("crm_email_receipt_routes")
            .update({ last_received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", route.id);
        } catch (error: any) {
          await this.db
            .from("email_inbox")
            .update({ crm_intake_error: String(error?.message || "CRM intake failed").slice(0, 1000) })
            .eq("id", email.id);
          this.logger.warn(`Email ${email.id} CRM intake failed: ${error?.message || error}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
