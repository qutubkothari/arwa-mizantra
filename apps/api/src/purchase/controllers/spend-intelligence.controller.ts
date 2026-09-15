import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { SpendIntelligenceService } from '../services/spend-intelligence.service';

@Controller('purchase/spend-intelligence')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SpendIntelligenceController {
  constructor(private readonly service: SpendIntelligenceService) {}
  @Get('dashboard') dashboard(@Req() r: any) { return this.service.dashboard(r.user.tenantId); }
  @Post('opportunities') create(@Req() r: any, @Body() b: any) { return this.service.createOpportunity(r.user.tenantId, r.user.userId, b); }
  @Patch('opportunities/:id') update(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.updateOpportunity(r.user.tenantId, r.user.userId, id, b); }
}

