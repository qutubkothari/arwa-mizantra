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
import { RevenueRecognitionService } from "./revenue-recognition.service";
@Controller("revenue-recognition")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RevenueRecognitionController {
  constructor(private readonly service: RevenueRecognitionService) {}
  @Get("dashboard") dashboard(@Req() r: any) {
    return this.service.dashboard(r.user.tenantId);
  }
  @Post("contracts") contract(@Req() r: any, @Body() b: any) {
    return this.service.contract(r.user.tenantId, r.user.userId, b);
  }
  @Post("contracts/:id/obligations") obligation(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.obligation(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("contracts/:id/approve") approve(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.approve(r.user.tenantId, r.user.userId, id, b);
  }
  @Post("obligations/:id/claims") claim(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.claim(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("claims/:id/verify") verify(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.verify(r.user.tenantId, r.user.userId, id, b);
  }
}
