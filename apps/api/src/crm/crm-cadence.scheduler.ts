import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CrmGrowthService } from "./crm-growth.service";

@Injectable()
export class CrmCadenceScheduler {
  private readonly logger = new Logger(CrmCadenceScheduler.name);

  constructor(private readonly growth: CrmGrowthService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async materializeDueSteps() {
    try {
      const result = await this.growth.processDueCadences();
      if (result.scanned) {
        this.logger.log(
          `CRM cadences processed: ${result.created} task(s), ${result.stopped} stopped, ${result.completed} completed.`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`CRM cadence scan skipped: ${error?.message || error}`);
    }
  }
}
