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
import { ProvisionControlService } from "./provision-control.service";
@Controller("provision-control")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProvisionControlController {
  constructor(private readonly service: ProvisionControlService) {}
  @Get("dashboard") dashboard(@Req() r: any) {
    return this.service.dashboard(r.user.tenantId);
  }
  @Post("cases") create(@Req() r: any, @Body() b: any) {
    return this.service.create(r.user.tenantId, r.user.userId, b);
  }
  @Post("cases/:id/cashflows") cashflow(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.cashflow(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("cases/:id/approve") approve(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.approve(r.user.tenantId, r.user.userId, id, b);
  }
  @Post("cases/:id/reviews") review(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.review(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("reviews/:id/approve") approveReview(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.approveReview(r.user.tenantId, r.user.userId, id, b);
  }
  @Patch("cases/:id/settle") settle(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.settle(r.user.tenantId, r.user.userId, id, b);
  }
}
