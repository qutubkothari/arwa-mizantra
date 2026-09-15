import { BadRequestException, Controller, Get, Query, Request } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('activity-logs')
  @RequirePermissions('activity_logs:read')
  async listActivityLogs(@Request() req: any, @Query() query: any) {
    try {
      return await this.auditService.listActivityLogs(req.user.tenantId, query);
    } catch (error: any) {
      throw new BadRequestException(error?.message || 'Failed to load audit trails');
    }
  }

  @Get('activity-logs/filters')
  @RequirePermissions('activity_logs:read')
  async getActivityLogFilters(@Request() req: any) {
    try {
      return await this.auditService.getActivityLogFilters(req.user.tenantId);
    } catch (error: any) {
      throw new BadRequestException(error?.message || 'Failed to load audit filters');
    }
  }
}