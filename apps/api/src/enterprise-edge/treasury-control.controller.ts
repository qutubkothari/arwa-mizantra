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
import { TreasuryControlService } from "./treasury-control.service";
@Controller("treasury-control")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TreasuryControlController {
  constructor(private readonly service: TreasuryControlService) {}
  @Get("dashboard") dashboard(@Req() request: any) {
    return this.service.dashboard(request.user.tenantId);
  }
  @Post("cash-positions") position(@Req() request: any, @Body() body: any) {
    return this.service.position(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }
  @Post("fx-exposures") exposure(@Req() request: any, @Body() body: any) {
    return this.service.exposure(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }
  @Post("actions") action(@Req() request: any, @Body() body: any) {
    return this.service.action(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }
  @Patch("actions/:id/approve") approve(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.approve(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
  @Patch("actions/:id/execute") execute(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.execute(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
  @Patch("actions/:id/verify") verify(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.verify(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
}
