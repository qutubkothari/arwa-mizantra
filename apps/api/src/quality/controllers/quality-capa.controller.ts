import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { QualityCapaService } from '../services/quality-capa.service';

@Controller('quality-capa')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QualityCapaController {
  constructor(private readonly service: QualityCapaService) {}
  @Get('dashboard') dashboard(@Req() request: any) { return this.service.dashboard(request.user.tenantId); }
  @Post() create(@Req() request: any, @Body() body: any) { return this.service.create(request.user.tenantId, request.user.userId, body); }
  @Patch(':id/investigate') investigate(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.investigate(request.user.tenantId, request.user.userId, id, body); }
  @Post(':id/actions') action(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.addAction(request.user.tenantId, request.user.userId, id, body); }
  @Patch(':id/submit') submit(@Req() request: any, @Param('id') id: string) { return this.service.submit(request.user.tenantId, request.user.userId, id); }
  @Patch(':id/approve') approve(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.approve(request.user.tenantId, request.user.userId, id, body); }
  @Patch('actions/:actionId/complete') complete(@Req() request: any, @Param('actionId') actionId: string, @Body() body: any) { return this.service.completeAction(request.user.tenantId, request.user.userId, actionId, body); }
  @Patch(':id/verify') verify(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.service.verify(request.user.tenantId, request.user.userId, id, body); }
}
