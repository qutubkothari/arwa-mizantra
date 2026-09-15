import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { MasterDataGovernanceService } from './master-data-governance.service';

@Controller('master-data-governance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MasterDataGovernanceController {
  constructor(private readonly service: MasterDataGovernanceService) {}
  private user(r: any) { return r.user.userId || r.user.id; }

  @Get('dashboard') dashboard(@Req() r: any) { return this.service.dashboard(r.user.tenantId, this.user(r)); }
  @Post('sla/evaluate') evaluateSla(@Req() r: any) { return this.service.evaluateSla(r.user.tenantId, true); }
  @Get('requests') requests(@Req() r: any) { return this.service.requests(r.user.tenantId, this.user(r)); }
  @Get('requests/:id') request(@Req() r: any, @Param('id') id: string) { return this.service.request(r.user.tenantId, id); }
  @Post('requests') create(@Req() r: any, @Body() b: any) { return this.service.create(r.user.tenantId, this.user(r), b); }
  @Patch('requests/:id/submit') submit(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.transition(r.user.tenantId, this.user(r), id, 'SUBMIT', b?.note); }
  @Patch('requests/:id/review') review(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.transition(r.user.tenantId, this.user(r), id, 'REVIEW', b?.note); }
  @Patch('requests/:id/approve') approve(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.transition(r.user.tenantId, this.user(r), id, 'APPROVE', b?.note); }
  @Patch('requests/:id/apply') apply(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.apply(r.user.tenantId, this.user(r), id, b?.note); }
  @Patch('requests/:id/reject') reject(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.reject(r.user.tenantId, this.user(r), id, b?.note); }
}
