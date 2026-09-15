import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StakeholderMisService } from './stakeholder-mis.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly stakeholderMis: StakeholderMisService,
  ) {}

  @Get('stats')
  async getStats(@Request() req: any) {
    return this.dashboardService.getStats(req.user.tenantId);
  }

  @Get('cockpit')
  async getCockpit(@Request() req: any) {
    try {
      return await this.dashboardService.getCockpit(req.user.tenantId);
    } catch (error) {
      console.error('[DashboardController] Cockpit fallback used:', error);
      return this.dashboardService.getFallbackCockpit(error);
    }
  }

  @Get('stakeholder-mis')
  async getStakeholderMis(
    @Request() req: any,
    @Query('domain') domain = 'executive',
    @Query('view') view = 'overview',
  ) {
    return this.stakeholderMis.get({
      tenantId: req.user.tenantId,
      userId: req.user.userId || req.user.id,
      domain,
      view,
      roles: req.user.roles,
      role: req.user.role,
    });
  }

  @Get('reminders')
  async getReminders(@Request() req: any) {
    return this.dashboardService.getReminderQueue(req.user.tenantId);
  }

  @Get('reports')
  async getReports(@Request() req: any) {
    return this.dashboardService.getReportCatalog(req.user.tenantId);
  }

  @Get('mis')
  async getMis(@Request() req: any) {
    return this.dashboardService.getAiMis(req.user.tenantId);
  }
}
