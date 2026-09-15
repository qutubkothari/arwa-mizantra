import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { IntelligenceService } from "./intelligence.service";

@Injectable()
export class ManagementBriefScheduler {
  private readonly logger = new Logger(ManagementBriefScheduler.name);
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  constructor(private readonly intelligence: IntelligenceService) {}

  @Cron("5 0 * * *", { timeZone: "Asia/Dubai" })
  async captureDailyBriefs() {
    const { data: tenants, error } = await this.db.from("tenants").select("id");
    if (error) {
      this.logger.warn(`Management brief capture skipped: ${error.message}`);
      return { captured: 0, failed: 0, skipped: true };
    }
    let captured = 0;
    let failed = 0;
    for (const tenant of tenants || []) {
      try {
        const result = await this.capture(String(tenant.id));
        if (result.stored) captured++;
        else failed++;
      } catch (captureError: any) {
        failed++;
        this.logger.warn(
          `Management brief capture failed for tenant ${tenant.id}: ${String(captureError?.message || captureError).slice(0, 300)}`,
        );
      }
    }
    this.logger.log(
      `Management brief daily capture complete: ${captured} stored, ${failed} failed.`,
    );
    return { captured, failed, skipped: false };
  }

  async capture(tenantId: string) {
    const brief = await this.intelligence.dailyBrief(tenantId, {});
    const date = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dubai",
    });
    const { error } = await this.db
      .from("mizantra_management_brief_snapshots")
      .upsert(
        {
          tenant_id: tenantId,
          snapshot_date: date,
          brief,
          health_score: brief.operating_health?.score ?? null,
          decision_count: brief.decisions_required?.length || 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,snapshot_date" },
      );
    if (error) {
      this.logger.warn(
        `Management brief snapshot not stored: ${error.message}`,
      );
      return { stored: false, reason: error.message };
    }
    return {
      stored: true,
      snapshot_date: date,
      decision_count: brief.decisions_required?.length || 0,
    };
  }
}
