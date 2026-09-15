import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ExpenseControlService } from './expense-control.service';

@Controller('expense-control')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpenseControlController {
  constructor(private readonly service: ExpenseControlService) {}
  @Get('dashboard') dashboard(@Req() r: any) { return this.service.dashboard(r.user.tenantId); }
  @Get('policies') policies(@Req() r: any) { return this.service.policies(r.user.tenantId); }
  @Post('policies') savePolicy(@Req() r: any, @Body() b: any) { return this.service.savePolicy(r.user.tenantId, b); }
  @Post('claims') createClaim(@Req() r: any, @Body() b: any) { return this.service.createClaim(r.user.tenantId, r.user.userId, b); }
  @Post('claims/:id/items') addItem(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.addItem(r.user.tenantId, r.user.userId, id, b); }
  @Post('claims/:id/submit') submit(@Req() r: any, @Param('id') id: string) { return this.service.submit(r.user.tenantId, r.user.userId, id); }
  @Patch('claims/:id/review') review(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.review(r.user.tenantId, r.user.userId, id, b); }
  @Patch('claims/:id/reimburse') reimburse(@Req() r: any, @Param('id') id: string, @Body() b: any) { return this.service.reimburse(r.user.tenantId, r.user.userId, id, b); }
}

