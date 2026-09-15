import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AdvancedProductionPlanningService } from './advanced-production-planning.service';

@Injectable()
export class ProductionReplanScheduler {
  private readonly logger = new Logger(ProductionReplanScheduler.name);
  private running = false;
  constructor(private readonly planner: AdvancedProductionPlanningService) {}

  @Interval(60_000)
  async scan() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.planner.processAutomaticReplans();
      if (result.replanned) this.logger.log(`Automatic production replanning completed: ${result.replanned}/${result.evaluated}`);
    } catch (error: any) {
      this.logger.error(`Automatic production replanning failed: ${error?.message || error}`);
    } finally {
      this.running = false;
    }
  }
}
