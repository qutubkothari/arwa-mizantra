import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ProductionService } from "../services/production.service";
import { WorkStationService } from "../services/work-station.service";
import { RoutingService } from "../services/routing.service";
import { StationCompletionService } from "../services/station-completion.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import {
  RequireDelete,
  RequireCreate,
  RequireUpdate,
} from "../../auth/decorators/permissions.decorator";

@Controller("production")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionController {
  constructor(
    private readonly productionService: ProductionService,
    private readonly workStationService: WorkStationService,
    private readonly routingService: RoutingService,
    private readonly stationCompletionService: StationCompletionService,
  ) {}

  // Work Stations - Must come BEFORE wildcard routes like :id
  @Post("work-stations")
  createWorkStation(@Request() req: any, @Body() createDto: any) {
    return this.workStationService.create(req.user.tenantId, createDto);
  }

  @Get("work-stations")
  findAllWorkStations(@Request() req: any, @Query() filters: any) {
    return this.workStationService.findAll(req.user.tenantId, filters);
  }

  @Get("work-stations/:id")
  findOneWorkStation(@Request() req: any, @Param("id") id: string) {
    return this.workStationService.findOne(req.user.tenantId, id);
  }

  @Get("work-stations/:id/queue")
  getWorkStationQueue(@Request() req: any, @Param("id") id: string) {
    return this.workStationService.getQueue(req.user.tenantId, id);
  }

  @Put("work-stations/:id")
  updateWorkStation(
    @Request() req: any,
    @Param("id") id: string,
    @Body() updateDto: any,
  ) {
    return this.workStationService.update(req.user.tenantId, id, updateDto);
  }

  @Delete("work-stations/:id")
  deleteWorkStation(@Request() req: any, @Param("id") id: string) {
    return this.workStationService.delete(req.user.tenantId, id);
  }

  // Routing - Must come BEFORE wildcard routes
  @Post("routing")
  createRouting(@Request() req: any, @Body() createDto: any) {
    return this.routingService.create(req.user.tenantId, createDto);
  }

  @Get("routing/bom/:bomId")
  findRoutingByBom(
    @Request() req: any,
    @Param("bomId") bomId: string,
    @Query("withStations") withStations?: string,
  ) {
    if (withStations === "true") {
      return this.routingService.findByBomWithStations(
        req.user.tenantId,
        bomId,
      );
    }
    return this.routingService.findByBom(req.user.tenantId, bomId);
  }

  @Put("routing/:id")
  updateRouting(
    @Request() req: any,
    @Param("id") id: string,
    @Body() updateDto: any,
  ) {
    return this.routingService.update(req.user.tenantId, id, updateDto);
  }

  @Delete("routing/:id")
  deleteRouting(@Request() req: any, @Param("id") id: string) {
    return this.routingService.delete(req.user.tenantId, id);
  }

  @Post("routing/copy")
  copyRouting(
    @Request() req: any,
    @Body() data: { sourceBomId: string; targetBomId: string },
  ) {
    return this.routingService.copyRouting(
      req.user.tenantId,
      data.sourceBomId,
      data.targetBomId,
    );
  }

  @Put("routing/bom/:bomId/resequence")
  resequenceRouting(
    @Request() req: any,
    @Param("bomId") bomId: string,
    @Body() data: { routingIds: string[] },
  ) {
    return this.routingService.resequence(
      req.user.tenantId,
      bomId,
      data.routingIds,
    );
  }

  // Station Completions - Must come BEFORE wildcard routes
  @Post("completions/start")
  startOperation(@Request() req: any, @Body() startDto: any) {
    return this.stationCompletionService.startOperation(req.user.tenantId, {
      ...startDto,
      operator_id: req.user.userId,
    });
  }

  @Get("completions/my-active")
  getMyActiveOperation(@Request() req: any) {
    return this.stationCompletionService.getActiveOperation(
      req.user.tenantId,
      req.user.userId,
    );
  }

  @Get("completions/order/:orderId")
  getCompletionsByOrder(
    @Request() req: any,
    @Param("orderId") orderId: string,
  ) {
    return this.stationCompletionService.findByProductionOrder(
      req.user.tenantId,
      orderId,
    );
  }

  @Get("completions/station/:stationId/queue")
  getShopFloorQueue(
    @Request() req: any,
    @Param("stationId") stationId: string,
  ) {
    return this.workStationService.getQueue(req.user.tenantId, stationId);
  }

  @Get("completions/job-order/:jobOrderId/queue")
  getJobOrderShopFloorQueue(
    @Request() req: any,
    @Param("jobOrderId") jobOrderId: string,
    @Query("afterSequence") afterSequence?: string,
  ) {
    return this.workStationService.getJobOrderQueue(
      req.user.tenantId,
      jobOrderId,
      Number(afterSequence || 0),
    );
  }

  @Get("completions/station/:stationId")
  getCompletionsByStation(
    @Request() req: any,
    @Param("stationId") stationId: string,
    @Query() filters: any,
  ) {
    return this.stationCompletionService.findByWorkStation(
      req.user.tenantId,
      stationId,
      filters,
    );
  }

  @Get("completions/productivity/:operatorId")
  getOperatorProductivity(
    @Request() req: any,
    @Param("operatorId") operatorId: string,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
  ) {
    return this.stationCompletionService.getOperatorProductivity(
      req.user.tenantId,
      operatorId,
      startDate,
      endDate,
    );
  }

  @Put("completions/:id/complete")
  completeOperation(
    @Request() req: any,
    @Param("id") id: string,
    @Body() completeDto: any,
  ) {
    return this.stationCompletionService.completeOperation(
      req.user.tenantId,
      req.user.userId,
      id,
      completeDto,
    );
  }

  @Put("completions/partial-dispositions/:id/decision")
  decidePartialProduction(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.stationCompletionService.decidePartialProduction(
      req.user.tenantId,
      req.user.userId,
      id,
      body,
    );
  }

  @Post("completions/:id/tools/change")
  @RequireUpdate("job_orders")
  changeOperationTool(
    @Request() req: any,
    @Param("id") id: string,
    @Body() changeDto: any,
  ) {
    return this.stationCompletionService.changeTool(
      req.user.tenantId,
      req.user.userId,
      id,
      changeDto,
    );
  }

  @Put("completions/:id/pause")
  pauseOperation(
    @Request() req: any,
    @Param("id") id: string,
    @Body() pauseDto: any,
  ) {
    return this.stationCompletionService.pauseOperation(
      req.user.tenantId,
      req.user.userId,
      id,
      pauseDto,
    );
  }

  @Put("completions/:id/resume")
  resumeOperation(@Request() req: any, @Param("id") id: string) {
    return this.stationCompletionService.resumeOperation(
      req.user.tenantId,
      req.user.userId,
      id,
    );
  }

  // Production Orders - Wildcard routes MUST come last
  @Post()
  create(@Request() req: any, @Body() createDto: any) {
    return this.productionService.create(
      req.user.tenantId,
      req.user.userId,
      createDto,
    );
  }

  @Get()
  findAll(@Request() req: any, @Query() filters: any) {
    return this.productionService.findAll(req.user.tenantId, filters);
  }

  @Get("available-uids/:bomId")
  getAvailableUIDs(@Request() req: any, @Param("bomId") bomId: string) {
    return this.productionService.getAvailableUIDs(req.user.tenantId, bomId);
  }

  @Post("assembly/complete")
  completeAssembly(@Request() req: any, @Body() data: any) {
    return this.productionService.completeAssembly(req.user.tenantId, {
      ...data,
      assembledBy: req.user.userId,
    });
  }

  @Put("assembly/:id/qc")
  approveQC(@Request() req: any, @Param("id") id: string, @Body() data: any) {
    return this.productionService.approveQC(req.user.tenantId, id, {
      ...data,
      qcBy: req.user.userId,
    });
  }

  @Put(":id/start")
  startProduction(@Request() req: any, @Param("id") id: string) {
    return this.productionService.startProduction(
      req.user.tenantId,
      id,
      req.user.userId,
    );
  }

  @Put(":id/complete")
  complete(@Request() req: any, @Param("id") id: string) {
    return this.productionService.complete(
      req.user.tenantId,
      id,
      req.user.userId,
    );
  }

  @Get(":id")
  findOne(@Request() req: any, @Param("id") id: string) {
    return this.productionService.findOne(req.user.tenantId, id);
  }
}
