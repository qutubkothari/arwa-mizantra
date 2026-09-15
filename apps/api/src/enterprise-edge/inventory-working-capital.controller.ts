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
import { InventoryWorkingCapitalService } from "./inventory-working-capital.service";

@Controller("inventory-working-capital")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryWorkingCapitalController {
  constructor(private readonly service: InventoryWorkingCapitalService) {}

  @Get("dashboard") dashboard(@Req() request: any) {
    return this.service.dashboard(request.user.tenantId);
  }
  @Post("policies") policy(@Req() request: any, @Body() body: any) {
    return this.service.policy(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }
  @Post("cases") createCase(@Req() request: any, @Body() body: any) {
    return this.service.createCase(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }
  @Patch("cases/:id/approve") approve(
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
  @Patch("cases/:id/execute") execute(
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
  @Patch("cases/:id/verify") verify(
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
