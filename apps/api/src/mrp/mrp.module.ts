import { Module } from "@nestjs/common";
import { MrpController } from "./mrp.controller";
import { MrpService } from "./mrp.service";
import { DemandPlanningController } from "./demand-planning.controller";
import { DemandPlanningService } from "./demand-planning.service";
import { AdvancedProductionPlanningController } from "./advanced-production-planning.controller";
import { AdvancedProductionPlanningService } from "./advanced-production-planning.service";
import { PurchaseModule } from "../purchase/purchase.module";
import { ProductionModule } from "../production/production.module";
import { ProductionReplanScheduler } from "./production-replan.scheduler";
import { MrpExceptionService } from "./mrp-exception.service";

@Module({
  imports: [PurchaseModule, ProductionModule],
  controllers: [
    MrpController,
    DemandPlanningController,
    AdvancedProductionPlanningController,
  ],
  providers: [
    MrpService,
    DemandPlanningService,
    AdvancedProductionPlanningService,
    ProductionReplanScheduler,
    MrpExceptionService,
  ],
  exports: [MrpService, AdvancedProductionPlanningService, MrpExceptionService],
})
export class MrpModule {}
