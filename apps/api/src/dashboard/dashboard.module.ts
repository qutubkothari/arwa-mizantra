import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AiModule } from '../ai/ai.module';
import { StakeholderMisService } from './stakeholder-mis.service';

@Module({
  imports: [AiModule],
  controllers: [DashboardController],
  providers: [DashboardService, StakeholderMisService],
  exports: [DashboardService],
})
export class DashboardModule {}
