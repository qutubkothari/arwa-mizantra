import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { MarginControlService } from './margin-control.service';

@Controller('margin-control')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MarginControlController {
  constructor(private readonly service: MarginControlService) {}
  @Get('overview') overview(@Req() req: any) { return this.service.overview(req.user.tenantId); }
  @Get('actions') actions(@Req() req: any) { return this.service.actions(req.user.tenantId); }
  @Post('actions') create(@Req() req: any, @Body() body: any) { return this.service.create(req.user.tenantId, body); }
  @Patch('actions/:id') update(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.update(req.user.tenantId, id, body); }
}
