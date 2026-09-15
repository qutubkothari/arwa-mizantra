import { Module } from "@nestjs/common";
import { EnterpriseEdgeController } from "./enterprise-edge.controller";
import { EnterpriseEdgeService } from "./enterprise-edge.service";
import { WarehouseOptimizationController } from "./warehouse-optimization.controller";
import { WarehouseOptimizationService } from "./warehouse-optimization.service";
import { InventoryWorkingCapitalController } from "./inventory-working-capital.controller";
import { InventoryWorkingCapitalService } from "./inventory-working-capital.service";
import { ProjectPerformanceController } from "./project-performance.controller";
import { ProjectPerformanceService } from "./project-performance.service";
import { WorkforceSkillsController } from "./workforce-skills.controller";
import { WorkforceSkillsService } from "./workforce-skills.service";
import { ContinuousControlsController } from "./continuous-controls.controller";
import { ContinuousControlsService } from "./continuous-controls.service";
import { TreasuryControlController } from "./treasury-control.controller";
import { TreasuryControlService } from "./treasury-control.service";
import { ValueRealizationController } from "./value-realization.controller";
import { ValueRealizationService } from "./value-realization.service";
import { ValueRealizationScheduler } from "./value-realization.scheduler";
import { FpnaControlController } from "./fpna-control.controller";
import { FpnaControlService } from "./fpna-control.service";
import { LeaseAccountingController } from "./lease-accounting.controller";
import { LeaseAccountingService } from "./lease-accounting.service";
import { RevenueRecognitionController } from "./revenue-recognition.controller";
import { RevenueRecognitionService } from "./revenue-recognition.service";
import { EclControlController } from "./ecl-control.controller";
import { EclControlService } from "./ecl-control.service";
import { ProvisionControlController } from "./provision-control.controller";
import { ProvisionControlService } from "./provision-control.service";
import { AuditModule } from "../audit/audit.module";
import { BusinessTransformationController } from "./business-transformation.controller";
import { BusinessTransformationService } from "./business-transformation.service";
import { AiModule } from "../ai/ai.module";
@Module({
  imports: [AuditModule, AiModule],
  controllers: [
    EnterpriseEdgeController,
    WarehouseOptimizationController,
    InventoryWorkingCapitalController,
    ProjectPerformanceController,
    WorkforceSkillsController,
    ContinuousControlsController,
    TreasuryControlController,
    ValueRealizationController,
    FpnaControlController,
    LeaseAccountingController,
    RevenueRecognitionController,
    EclControlController,
    ProvisionControlController,
    BusinessTransformationController,
  ],
  providers: [
    EnterpriseEdgeService,
    WarehouseOptimizationService,
    InventoryWorkingCapitalService,
    ProjectPerformanceService,
    WorkforceSkillsService,
    ContinuousControlsService,
    TreasuryControlService,
    ValueRealizationService,
    ValueRealizationScheduler,
    FpnaControlService,
    LeaseAccountingService,
    RevenueRecognitionService,
    EclControlService,
    ProvisionControlService,
    BusinessTransformationService,
  ],
  exports: [ValueRealizationService],
})
export class EnterpriseEdgeModule {}
