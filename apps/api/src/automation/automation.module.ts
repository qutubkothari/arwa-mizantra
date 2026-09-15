import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationScheduler } from './automation.scheduler';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [IntelligenceModule, WhatsAppModule],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationScheduler],
  exports: [AutomationService],
})
export class AutomationModule {}
