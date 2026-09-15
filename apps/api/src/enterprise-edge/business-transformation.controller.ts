import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { RequirePermissions } from "../auth/decorators/permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { BusinessTransformationService } from "./business-transformation.service";

@Controller("transformation")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BusinessTransformationController {
  constructor(private readonly service: BusinessTransformationService) {}

  @Get("dashboard")
  @RequirePermissions("transformation:read")
  dashboard(@Req() request: any) {
    return this.service.dashboard(request.user.tenantId);
  }

  @Post("advisor")
  @RequirePermissions("transformation:read")
  advisor(@Req() request: any, @Body() body: any) {
    return this.service.advisor(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Post("objectives")
  @RequirePermissions("transformation:create")
  createObjective(@Req() request: any, @Body() body: any) {
    return this.service.createObjective(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Patch("objectives/:id/submit")
  @RequirePermissions("transformation:update")
  submitObjective(@Req() request: any, @Param("id") id: string) {
    return this.service.submitObjective(
      request.user.tenantId,
      request.user.userId,
      id,
    );
  }

  @Patch("objectives/:id/approve")
  @RequirePermissions("transformation:approve")
  approveObjective(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.approveObjective(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }

  @Post("kpis")
  @RequirePermissions("transformation:create")
  createKpi(@Req() request: any, @Body() body: any) {
    return this.service.createKpi(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Post("kpi-snapshots")
  @RequirePermissions("transformation:update")
  recordSnapshot(@Req() request: any, @Body() body: any) {
    return this.service.recordSnapshot(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Post("initiatives")
  @RequirePermissions("transformation:create")
  createInitiative(@Req() request: any, @Body() body: any) {
    return this.service.createInitiative(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Post("actions")
  @RequirePermissions("transformation:create")
  createAction(@Req() request: any, @Body() body: any) {
    return this.service.createAction(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Patch("actions/:id/accept")
  @RequirePermissions("transformation:update")
  acceptAction(@Req() request: any, @Param("id") id: string) {
    return this.service.acceptAction(
      request.user.tenantId,
      request.user.userId,
      id,
    );
  }

  @Patch("actions/:id/start")
  @RequirePermissions("transformation:update")
  startAction(@Req() request: any, @Param("id") id: string) {
    return this.service.startAction(
      request.user.tenantId,
      request.user.userId,
      id,
    );
  }

  @Patch("actions/:id/complete")
  @RequirePermissions("transformation:update")
  completeAction(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.completeAction(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }

  @Patch("actions/:id/verify")
  @RequirePermissions("transformation:approve")
  verifyAction(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.verifyAction(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }

  @Patch("actions/:id/reject")
  @RequirePermissions("transformation:approve")
  rejectAction(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.rejectAction(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
}
