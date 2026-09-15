import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ValueRealizationService } from "./value-realization.service";

@Injectable()
export class ValueRealizationScheduler {
  private readonly logger = new Logger(ValueRealizationScheduler.name);
  constructor(private readonly value: ValueRealizationService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async deliverDueClientPacks() {
    try { await this.value.processDueDeliveries(); }
    catch (error: any) { this.logger.error(`ROI pack delivery evaluation failed: ${error?.message || error}`); }
  }
}
