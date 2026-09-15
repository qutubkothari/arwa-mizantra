import { Module } from "@nestjs/common";
import { SalesModule } from "../sales/sales.module";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";
import { CrmReminderScheduler } from "./crm-reminder.scheduler";
import { CrmInboundController } from "./crm-inbound.controller";
import { AiModule } from "../ai/ai.module";
import { CrmIntakeClassifierService } from "./crm-intake-classifier.service";
import { CrmEmailIntakeScheduler } from "./crm-email-intake.scheduler";
import { CrmCommercialService } from "./crm-commercial.service";
import { CrmGrowthService } from "./crm-growth.service";
import { EmailModule } from "../email/email.module";
import { CrmCadenceScheduler } from "./crm-cadence.scheduler";

@Module({
  imports: [SalesModule, AiModule, EmailModule],
  controllers: [CrmController, CrmInboundController],
  providers: [CrmService, CrmCommercialService, CrmGrowthService, CrmReminderScheduler, CrmCadenceScheduler, CrmIntakeClassifierService, CrmEmailIntakeScheduler],
  exports: [CrmService, CrmCommercialService, CrmGrowthService],
})
export class CrmModule {}
