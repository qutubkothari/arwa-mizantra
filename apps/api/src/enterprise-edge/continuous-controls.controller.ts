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
import { ContinuousControlsService } from "./continuous-controls.service";

@Controller("continuous-controls")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContinuousControlsController {
  constructor(private readonly service: ContinuousControlsService) {}
  @Get("dashboard") dashboard(@Req() request: any) {
    return this.service.dashboard(request.user.tenantId);
  }
  @Post("scan") scan(@Req() request: any) {
    return this.service.scan(request.user.tenantId, request.user.userId);
  }
  @Post("definitions") definition(@Req() request: any, @Body() body: any) {
    return this.service.definition(
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
