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
import { LeaseAccountingService } from "./lease-accounting.service";
@Controller("lease-accounting")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeaseAccountingController {
  constructor(private readonly service: LeaseAccountingService) {}
  @Get("dashboard") dashboard(@Req() r: any) {
    return this.service.dashboard(r.user.tenantId);
  }
  @Post("leases") create(@Req() r: any, @Body() b: any) {
    return this.service.create(r.user.tenantId, r.user.userId, b);
  }
  @Patch("leases/:id/approve") approve(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.approve(r.user.tenantId, r.user.userId, id, b);
  }
  @Post("leases/:id/events") event(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.event(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("events/:id/approve") approveEvent(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.approveEvent(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("leases/:id/terminate") terminate(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.terminate(r.user.tenantId, r.user.userId, id, b);
  }
}
