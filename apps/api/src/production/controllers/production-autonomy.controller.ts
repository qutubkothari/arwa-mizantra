import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ProductionAutonomyService } from '../services/production-autonomy.service';

@Controller('production-autonomy')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionAutonomyController {
  constructor(private readonly service: ProductionAutonomyService) {}
  @Get('dashboard') dashboard(@Req() req: any) { return this.service.dashboard(req.user.tenantId); }
  @Get('control-tower') tower(@Req() req: any) { return this.service.controlTower(req.user.tenantId); }
  @Get('cost-intelligence') cost(@Req() req: any) { return this.service.costIntelligence(req.user.tenantId); }
  @Post('mes-events') mes(@Req() req: any, @Body() body: any) { return this.service.mes(req.user.tenantId, req.user.userId, body); }
  @Post('instructions') instructions(@Req() req: any, @Body() body: any) { return this.service.instructions(req.user.tenantId, req.user.userId, body); }
  @Patch('instructions/:id/approve') approve(@Req() req: any, @Param('id') id: string) { return this.service.approveInstruction(req.user.tenantId, req.user.userId, id); }
  @Post('exceptions/generate') exceptions(@Req() req: any) { return this.service.generateExceptions(req.user.tenantId); }
  @Post('energy-tariffs') tariff(@Req() req: any, @Body() body: any) { return this.service.tariff(req.user.tenantId, body); }
  @Post('station-assets') stationAsset(@Req() req: any, @Body() body: any) { return this.service.mapStationAsset(req.user.tenantId, body); }
  @Post('aps/run') aps(@Req() req: any) { return this.service.runAps(req.user.tenantId); }
  @Post('vision-inspections') vision(@Req() req: any, @Body() body: any) { return this.service.visionInspection(req.user.tenantId, req.user.userId, body); }
  @Post('predictive-maintenance/dispatch') predictive(@Req() req: any) { return this.service.dispatchPredictiveMaintenance(req.user.tenantId, req.user.userId); }
}
