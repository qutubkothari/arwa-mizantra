import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CrmService } from "./crm.service";

@Injectable()
export class CrmReminderScheduler {
  private readonly logger = new Logger(CrmReminderScheduler.name);

  constructor(private readonly crm: CrmService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async captureDueFollowups() {
    try {
      const result = await this.crm.scanDueFollowups();
      if (result.due)
        this.logger.log(
          `CRM reminders refreshed: ${result.due} due follow-up(s).`,
        );
    } catch (error: any) {
      this.logger.warn(`CRM reminder scan skipped: ${error?.message || error}`);
    }
  }
}
