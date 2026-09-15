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
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { FpnaControlService } from "./fpna-control.service";

@Controller("fpna-control")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FpnaControlController {
  constructor(private readonly service: FpnaControlService) {}
  @Get("dashboard") dashboard(@Req() request: any) {
    return this.service.dashboard(request.user.tenantId);
  }
  @Post("cycles") cycle(@Req() request: any, @Body() body: any) {
    return this.service.createCycle(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }
  @Post("scenarios") scenario(@Req() request: any, @Body() body: any) {
    return this.service.createScenario(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }
  @Patch("scenarios/:id/approve") approve(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.approveScenario(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
  @Patch("scenarios/:id/reject") reject(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.rejectScenario(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
  @Patch("cycles/:id/close") close(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.closeCycle(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
}
