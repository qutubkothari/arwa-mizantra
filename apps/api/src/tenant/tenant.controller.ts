import { Controller, Get, Put, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Tenant')
@Controller('tenant')
@UseGuards(JwtAuthGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current tenant/company information' })
  @ApiResponse({ status: 200, description: 'Tenant information' })
  async getCurrentTenant(@Request() req: any) {
    return this.tenantService.findOne(req.user.tenantId);
  }

  @Put('current')
  @ApiOperation({ summary: 'Update current tenant/company information' })
  @ApiResponse({ status: 200, description: 'Tenant updated successfully' })
  async updateCurrentTenant(@Body() dto: any, @Request() req: any) {
    return this.tenantService.update(req.user.tenantId, dto);
  }
}
