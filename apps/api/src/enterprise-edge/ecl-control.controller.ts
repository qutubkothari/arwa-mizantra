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
import { EclControlService } from "./ecl-control.service";
@Controller("ecl-control")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EclControlController {
  constructor(private readonly service: EclControlService) {}
  @Get("dashboard") dashboard(@Req() r: any) {
    return this.service.dashboard(r.user.tenantId);
  }
  @Post("models") model(@Req() r: any, @Body() b: any) {
    return this.service.model(r.user.tenantId, r.user.userId, b);
  }
  @Post("assessments/:id/overrides") override(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.override(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("overrides/:id/approve") approveOverride(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.approveOverride(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("models/:id/approve") approveModel(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.approveModel(r.user.tenantId, r.user.userId, id, b);
  }
}
