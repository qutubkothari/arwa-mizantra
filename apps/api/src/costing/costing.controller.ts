import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CostingService } from './costing.service';

@Controller('costing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CostingController {
  constructor(private readonly service: CostingService) {}
  @Get('standard-margin') summary(@Req() req: any) { return this.service.standardMargin(req.user.tenantId); }
  @Get('fifo-cogs') fifoCogs(@Req() req: any) { return this.service.fifoCogs(req.user.tenantId); }
  @Get('fifo-coverage') fifoCoverage(@Req() req: any) { return this.service.fifoCoverage(req.user.tenantId); }
  @Get('inventory-events') inventoryEvents(@Req() req: any) { return this.service.inventoryEvents(req.user.tenantId); }
  @Get('production-variance') productionVariance(@Req() req: any) { return this.service.productionVariance(req.user.tenantId); }
  @Get('production-remediations') productionRemediations(@Req() req: any) { return this.service.productionCostRemediations(req.user.tenantId); }
  @Post('production-remediations/sync') syncProductionRemediations(@Req() req: any) { return this.service.syncProductionCostRemediations(req.user.tenantId, req.user.userId || req.user.id); }
  @Patch('production-remediations/:id') updateProductionRemediation(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.updateProductionCostRemediation(req.user.tenantId, req.user.userId || req.user.id, id, body); }
  @Post('fifo-cogs/:id/draft') draft(@Req() req: any, @Param('id') id: string) { return this.service.createCogsDraft(req.user.tenantId, req.user.userId, id); }
  @Post('events/:id/draft') eventDraft(@Req() req: any, @Param('id') id: string) { return this.service.createEventDraft(req.user.tenantId, req.user.userId || req.user.id, id); }
  @Get('valuation-runs') valuationRuns(@Req() req: any) { return this.service.listValuationRuns(req.user.tenantId); }
  @Post('valuation-runs') createValuationRun(@Req() req: any, @Body() body: any) { return this.service.createValuationRun(req.user.tenantId, req.user.userId || req.user.id, body); }
  @Post('valuation-runs/:id/certify') certifyValuationRun(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.certifyValuationRun(req.user.tenantId, req.user.userId || req.user.id, id, body); }
}
