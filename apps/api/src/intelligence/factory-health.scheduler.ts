import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { IntelligenceService } from "./intelligence.service";

@Injectable()
export class FactoryHealthScheduler {
  private readonly logger = new Logger(FactoryHealthScheduler.name);
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  constructor(private readonly intelligence: IntelligenceService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: "Asia/Dubai" })
  async captureDailyHealth() {
    const { data: tenants, error } = await this.db.from("tenants").select("id");
    if (error) {
      this.logger.warn(`Factory health capture skipped: ${error.message}`);
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
          `Factory health capture failed for tenant ${tenant.id}: ${String(captureError?.message || captureError).slice(0, 300)}`,
        );
      }
    }
    this.logger.log(
      `Factory health daily capture complete: ${captured} stored, ${failed} failed.`,
    );
    return { captured, failed, skipped: false };
  }

  async capture(tenantId: string) {
    const center = await this.intelligence.commandCenter(tenantId, {});
    const health = center.operating_health;
    const date = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dubai",
    });
    const { error } = await this.db
      .from("mizantra_factory_health_snapshots")
      .upsert(
        {
          tenant_id: tenantId,
          snapshot_date: date,
          score: health.score,
          open_exceptions: health.open_exceptions,
          high_priority: health.high_priority,
          factors: health.factors || [],
        },
        { onConflict: "tenant_id,snapshot_date" },
      );
    if (error) {
      this.logger.warn(`Factory health snapshot not stored: ${error.message}`);
      return { stored: false, reason: error.message };
    }
    let forecastRecording: any = { recorded: 0, reason: "UNAVAILABLE" };
    let forecastEvaluation: any = { evaluated: 0, reason: "UNAVAILABLE" };
    try {
      forecastRecording = await this.intelligence.recordHealthForecast(
        tenantId,
        date,
      );
      forecastEvaluation = await this.intelligence.evaluateHealthForecasts(
        tenantId,
        date,
      );
    } catch (forecastError: any) {
      this.logger.warn(
        `Factory health forecast accountability skipped for tenant ${tenantId}: ${String(forecastError?.message || forecastError).slice(0, 300)}`,
      );
    }
    return {
      stored: true,
      snapshot_date: date,
      score: health.score,
      forecast_recording: forecastRecording,
      forecast_evaluation: forecastEvaluation,
    };
  }
}
