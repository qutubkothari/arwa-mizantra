import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { RequirePermissions } from "../../auth/decorators/permissions.decorator";
import { ProductionDeviceGatewayService } from "../services/production-device-gateway.service";

@Controller("production-device-gateways")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionDeviceGatewayController {
  constructor(private readonly service: ProductionDeviceGatewayService) {}
  @Get() @RequirePermissions("job_orders:read") list(@Req() req: any) {
    return this.service.list(req.user.tenantId);
  }
  @Post() @RequirePermissions("job_orders:update") save(
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.service.save(req.user.tenantId, req.user.userId, body);
  }
  @Post(":id/submit-activation")
  @RequirePermissions("job_orders:update")
  submitActivation(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.submitActivation(
      req.user.tenantId,
      req.user.userId || req.user.id,
      id,
      body || {},
    );
  }
  @Post(":id/activation-decision")
  @RequirePermissions("job_orders:update")
  activationDecision(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.decideActivation(
      req.user.tenantId,
      req.user,
      id,
      body || {},
    );
  }
  @Post(":gatewayCode/heartbeat")
  @RequirePermissions("job_orders:update")
  heartbeat(
    @Req() req: any,
    @Param("gatewayCode") gatewayCode: string,
    @Body() body: any,
  ) {
    return this.service.heartbeat(req.user.tenantId, gatewayCode, body);
  }
  @Post(":gatewayCode/preflight")
  @RequirePermissions("job_orders:update")
  preflight(
    @Req() req: any,
    @Param("gatewayCode") gatewayCode: string,
    @Body() body: any,
  ) {
    return this.service.preflightPayload(
      req.user.tenantId,
      gatewayCode,
      body || {},
    );
  }
  @Post(":id/rotate-credential")
  @RequirePermissions("job_orders:update")
  rotate(@Req() req: any, @Param("id") id: string) {
    return this.service.rotateCredential(
      req.user.tenantId,
      req.user.userId || req.user.id,
      id,
    );
  }
}
