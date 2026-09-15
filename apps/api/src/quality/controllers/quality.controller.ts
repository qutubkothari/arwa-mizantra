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
import { QualityService } from "../services/quality.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import {
  RequireDelete,
  RequireCreate,
  RequireUpdate,
} from "../../auth/decorators/permissions.decorator";

@Controller("quality")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  // ==================== Inspections ====================

  @Get("plans")
  async getInspectionPlans(@Request() req: any, @Query() query: any) {
    return this.qualityService.getInspectionPlans(req.user.tenantId, query);
  }

  @Get("plans/:id")
  async getInspectionPlan(@Request() req: any, @Param("id") id: string) {
    return this.qualityService.getInspectionPlan(req.user.tenantId, id);
  }

  @Post("plans")
  async createInspectionPlan(@Request() req: any, @Body() body: any) {
    return this.qualityService.createInspectionPlan(
      req.user.tenantId,
      req.user.userId,
      body,
    );
  }

  @Post("plans/:id/approve")
  async approveInspectionPlan(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.qualityService.approveInspectionPlan(
      req.user.tenantId,
      req.user.userId,
      id,
      body,
    );
  }

  @Post("plans/:id/retire")
  async retireInspectionPlan(@Request() req: any, @Param("id") id: string) {
    return this.qualityService.retireInspectionPlan(
      req.user.tenantId,
      req.user.userId,
      id,
    );
  }

  @Post("inspections")
  async createInspection(@Request() req: any, @Body() body: any) {
    return this.qualityService.createInspection(
      req.user.tenantId,
      req.user.userId,
      body,
    );
  }

  @Get("inspections")
  async getInspections(@Request() req: any, @Query() query: any) {
    return this.qualityService.getInspections(req.user.tenantId, query);
  }

  @Get("inspections/:id")
  async getInspectionById(@Request() req: any, @Param("id") id: string) {
    return this.qualityService.getInspectionById(req.user.tenantId, id);
  }

  @Put("inspections/:id")
  async updateInspection(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.qualityService.updateInspection(req.user.tenantId, id, body);
  }

  @Delete("inspections/:id")
  async deleteInspection(@Request() req: any, @Param("id") id: string) {
    return this.qualityService.deleteInspection(req.user.tenantId, id);
  }

  @Post("inspections/:id/complete")
  async completeInspection(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.qualityService.completeInspection(
      req.user.tenantId,
      req.user.userId,
      id,
      body,
    );
  }

  @Post("inspections/:id/parameters")
  async addInspectionParameters(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.qualityService.addInspectionParameters(
      req.user.tenantId,
      id,
      body.parameters,
    );
  }

  @Post("inspections/:id/defects")
  async addInspectionDefects(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.qualityService.addInspectionDefects(
      req.user.tenantId,
      id,
      body.defects,
    );
  }

  // ==================== NCR Management ====================

  @Post("ncr")
  async createNCR(@Request() req: any, @Body() body: any) {
    return this.qualityService.createNCR(
      req.user.tenantId,
      req.user.userId,
      body,
    );
  }

  @Get("ncr")
  async getNCRs(@Request() req: any, @Query() query: any) {
    return this.qualityService.getNCRs(req.user.tenantId, query);
  }

  @Get("ncr/:id")
  async getNCRById(@Request() req: any, @Param("id") id: string) {
    return this.qualityService.getNCRById(req.user.tenantId, id);
  }

  @Put("ncr/:id")
  async updateNCR(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.qualityService.updateNCR(req.user.tenantId, id, body);
  }

  @Post("ncr/:id/close")
  async closeNCR(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.qualityService.closeNCR(
      req.user.tenantId,
      id,
      req.user.userId,
      body,
    );
  }

  // ==================== Quality Analytics ====================

  @Get("vendor-ratings")
  async getVendorQualityRatings(
    @Request() req: any,
    @Query("vendor_id") vendorId?: string,
  ) {
    return this.qualityService.getVendorQualityRatings(
      req.user.tenantId,
      vendorId,
    );
  }

  @Post("vendor-ratings/calculate")
  async calculateVendorQualityRating(@Request() req: any, @Body() body: any) {
    return this.qualityService.calculateVendorQualityRating(
      req.user.tenantId,
      body.vendor_id,
      body.period_start,
      body.period_end,
    );
  }

  @Get("dashboard")
  async getQualityDashboard(@Request() req: any) {
    return this.qualityService.getQualityDashboard(req.user.tenantId);
  }
}
