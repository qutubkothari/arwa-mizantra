import { Module } from "@nestjs/common";
import { ProductionService } from "./services/production.service";
import { WorkStationService } from "./services/work-station.service";
import { RoutingService } from "./services/routing.service";
import { StationCompletionService } from "./services/station-completion.service";
import { JobOrderService } from "./services/job-order.service";
import { ProductionController } from "./controllers/production.controller";
import { JobOrderController } from "./controllers/job-order.controller";
import { ManufacturingPerformanceController } from "./controllers/manufacturing-performance.controller";
import { ManufacturingPerformanceService } from "./services/manufacturing-performance.service";
import { EngineeringChangeController } from "./controllers/engineering-change.controller";
import { EngineeringChangeService } from "./services/engineering-change.service";
import { MachineTelemetryController } from "./controllers/machine-telemetry.controller";
import { MachineTelemetryService } from "./services/machine-telemetry.service";
import { ProductionAutonomyController } from "./controllers/production-autonomy.controller";
import { ProductionAutonomyService } from "./services/production-autonomy.service";
import { ProductionDeviceGatewayController } from "./controllers/production-device-gateway.controller";
import { ProductionDeviceGatewayService } from "./services/production-device-gateway.service";
import { OperationalConnectorController } from "./controllers/operational-connector.controller";
import { UidModule } from "../uid/uid.module";
import { ProductionReportController } from "./controllers/production-report.controller";
import { ProductionReportService } from "./services/production-report.service";
import { ProductionStandardizationController } from "./controllers/production-standardization.controller";
import { ProductionStandardizationService } from "./services/production-standardization.service";
import { CostingModule } from "../costing/costing.module";

@Module({
  imports: [UidModule, CostingModule],
  controllers: [
    ProductionController,
    JobOrderController,
    ManufacturingPerformanceController,
    ProductionReportController,
    EngineeringChangeController,
    MachineTelemetryController,
    ProductionAutonomyController,
    ProductionDeviceGatewayController,
    OperationalConnectorController,
    ProductionStandardizationController,
  ],
  providers: [
    ProductionService,
    WorkStationService,
    RoutingService,
    StationCompletionService,
    JobOrderService,
    ManufacturingPerformanceService,
    ProductionReportService,
    EngineeringChangeService,
    MachineTelemetryService,
    ProductionAutonomyService,
    ProductionDeviceGatewayService,
    ProductionStandardizationService,
  ],
  exports: [
    ProductionService,
    WorkStationService,
    RoutingService,
    StationCompletionService,
    JobOrderService,
    ProductionReportService,
  ],
})
export class ProductionModule {}
