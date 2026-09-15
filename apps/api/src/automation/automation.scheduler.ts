import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AutomationService } from './automation.service';

/** Scheduled rules run only after a process owner enables them. */
@Injectable()
export class AutomationScheduler {
  private readonly logger = new Logger(AutomationScheduler.name);
  private running = false;

  constructor(private readonly automation: AutomationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Kolkata' })
  async processDailyRules() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.automation.runActiveRules();
      this.logger.log(`Daily automation run: ${result.succeeded}/${result.evaluated} rules completed`);
    } catch (error: any) {
      this.logger.error(`Daily automation run failed: ${error?.message || error}`);
    } finally {
      this.running = false;
    }
  }
}
