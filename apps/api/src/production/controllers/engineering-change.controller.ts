import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { EngineeringChangeService } from '../services/engineering-change.service';

@Controller('engineering-changes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EngineeringChangeController {
  constructor(private readonly service: EngineeringChangeService) {}

  @Get('dashboard') dashboard(@Req() request: any) { return this.service.dashboard(request.user.tenantId); }
  @Post() create(@Req() request: any, @Body() body: any) { return this.service.create(request.user.tenantId, request.user.userId, body); }
  @Post(':id/assess') assess(@Req() request: any, @Param('id') id: string) { return this.service.assess(request.user.tenantId, request.user.userId, id); }
  @Post(':id/impacts') impact(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.addImpact(request.user.tenantId, request.user.userId, id, body); }
  @Patch(':id/submit') submit(@Req() request: any, @Param('id') id: string) { return this.service.submit(request.user.tenantId, request.user.userId, id); }
  @Patch(':id/approve') approve(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.approve(request.user.tenantId, request.user.userId, id, body); }
  @Patch(':id/implement') implement(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.implement(request.user.tenantId, request.user.userId, id, body); }
  @Patch(':id/verify') verify(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.verify(request.user.tenantId, request.user.userId, id, body); }
}
