import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { AdvancedProductionPlanningService } from "./advanced-production-planning.service";
import {
  RequireApprove,
  RequireCreate,
  RequireUpdate,
} from "../auth/decorators/permissions.decorator";

@Controller("production-planning")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdvancedProductionPlanningController {
  constructor(private readonly service: AdvancedProductionPlanningService) {}
  @Get("masters") masters(@Req() r: any) {
    return this.service.masters(r.user.tenantId);
  }
  @Get("sales-orders") salesOrders(@Req() r: any) {
    return this.service.salesOrderDemands(r.user.tenantId);
  }
  @Get("dashboard") dashboard(@Req() r: any) {
    return this.service.dashboard(r.user.tenantId);
  }
  @Get("control-tower") tower(@Req() r: any) {
    return this.service.controlTower(r.user.tenantId);
  }
  @Get("configuration") configuration(@Req() r: any) {
    return this.service.planningConfiguration(r.user.tenantId);
  }
  @Patch("configuration/items/:id")
  @RequireUpdate("items")
  itemPolicy(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.saveItemPlanningPolicy(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Patch("configuration/routings/:id")
  @RequireUpdate("job_orders")
  routingConstraint(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.saveRoutingConstraint(r.user.tenantId, id, b);
  }
  @Post("configuration/resource-alternatives")
  @RequireUpdate("job_orders")
  alternative(@Req() r: any, @Body() b: any) {
    return this.service.saveResourceAlternative(r.user.tenantId, b);
  }
  @Post("configuration/changeovers")
  @RequireUpdate("job_orders")
  changeover(@Req() r: any, @Body() b: any) {
    return this.service.saveChangeover(r.user.tenantId, b);
  }
  @Post("configuration/cost-sheet-templates")
  @RequireUpdate("job_orders")
  costSheetTemplate(@Req() r: any, @Body() b: any) {
    return this.service.saveCostSheetTemplate(
      r.user.tenantId,
      r.user.userId || r.user.id,
      b,
    );
  }
  @Delete("configuration/cost-sheet-templates/:id")
  @RequireUpdate("job_orders")
  deleteCostSheetTemplate(@Req() r: any, @Param("id") id: string) {
    return this.service.deleteCostSheetTemplate(r.user.tenantId, id);
  }
  @Post("configuration/tools")
  @RequireUpdate("job_orders")
  tool(@Req() r: any, @Body() b: any) {
    return this.service.saveToolResource(
      r.user.tenantId,
      r.user.userId || r.user.id,
      b,
    );
  }
  @Post("configuration/tools/:id/usage")
  @RequireUpdate("job_orders")
  toolUsage(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.recordToolUsage(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Post("configuration/tools/:id/calibrations")
  @RequireUpdate("job_orders")
  toolCalibration(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.recordToolCalibration(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Patch("configuration/tool-calibrations/:id/verify")
  @RequireApprove("job_orders")
  verifyToolCalibration(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.verifyToolCalibration(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Post("configuration/skills")
  @RequireUpdate("job_orders")
  skill(@Req() r: any, @Body() b: any) {
    return this.service.saveEmployeeSkill(r.user.tenantId, b);
  }
  @Get("programs/:id") detail(@Req() r: any, @Param("id") id: string) {
    return this.service.detail(r.user.tenantId, id);
  }
  @Get("programs/:id/procurement-proposal") proposal(
    @Req() r: any,
    @Param("id") id: string,
  ) {
    return this.service.procurementProposal(r.user.tenantId, id);
  }
  @Get("programs/:id/staleness") staleness(
    @Req() r: any,
    @Param("id") id: string,
  ) {
    return this.service.staleness(r.user.tenantId, id);
  }
  @Post("programs/:id/procurement-proposal/draft-pr")
  @RequireCreate("purchase_requisitions")
  draftPr(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.createDraftPurchaseRequisition(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Post("programs") create(@Req() r: any, @Body() b: any) {
    return this.service.createProgram(r.user.tenantId, r.user.userId, b);
  }
  @Post("programs/:id/run") run(@Req() r: any, @Param("id") id: string) {
    return this.service.run(r.user.tenantId, r.user.userId, id);
  }
  @Post("programs/:id/simulate") simulate(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.simulateScenario(r.user.tenantId, id, b);
  }
  @Get("programs/:id/execution-variance")
  executionVariance(@Req() r: any, @Param("id") id: string) {
    return this.service.executionVariance(r.user.tenantId, id);
  }
  @Patch("programs/:id/action")
  @RequireUpdate("job_orders")
  action(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.actOnProgram(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Patch("programs/:id/approve")
  @RequireApprove("job_orders")
  approve(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.actOnProgram(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      { ...b, action: "APPROVE" },
    );
  }
  @Patch("programs/:id/auto-replan")
  @RequireUpdate("job_orders")
  autoReplan(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.setAutoReplan(r.user.tenantId, id, b);
  }
  @Post("programs/:id/execution/draft-job-orders")
  @RequireCreate("job_orders")
  jobs(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.createDraftJobOrders(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Post("programs/:id/execution/draft-shifts")
  @RequireCreate("job_orders")
  shifts(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.createDraftShiftProposals(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Post("programs/:id/execution/publish-shifts")
  @RequireApprove("job_orders")
  publishShifts(@Req() r: any, @Param("id") id: string, @Body() b: any) {
    return this.service.publishShiftProposals(
      r.user.tenantId,
      r.user.userId || r.user.id,
      id,
      b,
    );
  }
  @Patch("stage-policies") policy(@Req() r: any, @Body() b: any) {
    return this.service.updateStagePolicy(r.user.tenantId, b);
  }
}
