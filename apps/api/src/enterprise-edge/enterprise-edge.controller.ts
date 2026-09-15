import { Body, Controller, Get, Patch, Post, Req, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { EnterpriseEdgeService } from './enterprise-edge.service';

@Controller('enterprise-edge')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EnterpriseEdgeController {
  constructor(private readonly service: EnterpriseEdgeService) {}
  @Get('entities') entities(@Req() r: any) { return this.service.entities(r.user.tenantId); }
  @Post('entities') addEntity(@Req() r: any, @Body() b: any) { return this.service.addEntity(r.user.tenantId, b); }
  @Get('intercompany') intercompany(@Req() r: any) { return this.service.intercompany(r.user.tenantId); }
  @Post('intercompany') addIntercompany(@Req() r: any, @Body() b: any) { return this.service.addIntercompany(r.user.tenantId, r.user.userId || r.user.id, b); }
  @Patch('intercompany/:id/match') matchIntercompany(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.matchIntercompany(r.user.tenantId, r.user.userId || r.user.id, id, b); }
  @Patch('intercompany/:id/approve') approveIntercompany(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.approveIntercompany(r.user.tenantId, r.user.userId || r.user.id, id, b); }
  @Get('consolidation-runs') runs(@Req() r: any) { return this.service.runs(r.user.tenantId); }
  @Post('consolidation-runs') run(@Req() r: any, @Body() b: any) { return this.service.createRun(r.user.tenantId, r.user.userId || r.user.id, b); }
  @Patch('consolidation-runs/:id/validate') validateRun(@Req() r: any, @Param('id') id: string) { return this.service.validateRun(r.user.tenantId, r.user.userId || r.user.id, id); }
  @Patch('consolidation-runs/:id/approve') approveRun(@Req() r: any, @Param('id') id: string) { return this.service.approveRun(r.user.tenantId, r.user.userId || r.user.id, id); }
  @Patch('consolidation-runs/:id/post') postRun(@Req() r: any, @Param('id') id: string) { return this.service.postRun(r.user.tenantId, r.user.userId || r.user.id, id); }
  @Get('warehouse-bins') bins(@Req() r: any) { return this.service.bins(r.user.tenantId); }
  @Post('warehouse-bins') addBin(@Req() r: any, @Body() b: any) { return this.service.addBin(r.user.tenantId, b); }
  @Get('warehouse-tasks') tasks(@Req() r: any) { return this.service.tasks(r.user.tenantId); }
  @Post('warehouse-tasks') addTask(@Req() r: any, @Body() b: any) { return this.service.addTask(r.user.tenantId, b); }
  @Patch('warehouse-tasks/:id') updateTask(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.updateTask(r.user.tenantId, id, b); }
  @Get('capacity-slots') capacity(@Req() r: any) { return this.service.capacity(r.user.tenantId); }
  @Post('capacity-slots') setCapacity(@Req() r: any, @Body() b: any) { return this.service.setCapacity(r.user.tenantId, b); }
  @Get('schedule-operations') schedule(@Req() r: any) { return this.service.schedule(r.user.tenantId); }
  @Get('schedule-board') scheduleBoard(@Req() r: any) { return this.service.scheduleBoard(r.user.tenantId); }
  @Get('capacity-wip') capacityWip(@Req() r: any) { return this.service.capacityWip(r.user.tenantId); }
  @Post('schedule-operations') addOperation(@Req() r: any, @Body() b: any) { return this.service.addOperation(r.user.tenantId, b); }
}
