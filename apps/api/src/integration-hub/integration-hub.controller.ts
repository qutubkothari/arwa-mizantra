import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { IntegrationHubService } from './integration-hub.service';

@Controller('integration-hub')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntegrationHubController {
  constructor(private readonly service: IntegrationHubService) {}

  @Get('dashboard')
  dashboard(@Req() request: any) { return this.service.dashboard(request.user.tenantId, request.user); }

  @Post('connections')
  save(@Req() request: any, @Body() body: any) { return this.service.save(request.user.tenantId, request.user, body || {}, request); }

  @Post('connections/:id/test')
  test(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.recordTest(request.user.tenantId, request.user, id, body || {}, request); }
}
