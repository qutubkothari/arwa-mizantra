import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireCreate } from '../../auth/decorators/permissions.decorator';
import { ServiceEntrySheetsService } from '../services/service-entry-sheets.service';

@Controller('purchase/service-entries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServiceEntrySheetsController {
  constructor(private readonly service: ServiceEntrySheetsService) {}

  @Get() findAll(@Request() req: any, @Query() query: any) { return this.service.findAll(req.user.tenantId, query); }
  @Get('invoices/list') listInvoices(@Request() req: any) { return this.service.listInvoices(req.user.tenantId); }
  @Get('invoices/eligible-ses') eligibleForInvoice(@Request() req: any) { return this.service.eligibleForInvoice(req.user.tenantId); }
  @Get('eligible-pos') eligiblePurchaseOrders(@Request() req: any) { return this.service.eligiblePurchaseOrders(req.user.tenantId); }
  @Get(':id') findOne(@Request() req: any, @Param('id') id: string) { return this.service.findOne(req.user.tenantId, id); }
  @Post() @RequireCreate('purchase_orders') create(@Request() req: any, @Body() body: any) { return this.service.create(req.user.tenantId, req.user.userId, body); }
  @Post('invoices') @RequireCreate('purchase_orders') createInvoice(@Request() req: any, @Body() body: any) { return this.service.createInvoice(req.user.tenantId, req.user.userId, body); }
  @Post('invoices/:id/sanction') @RequireApprove('purchase_orders') sanctionInvoice(@Request() req: any, @Param('id') id: string) { return this.service.sanctionInvoice(req.user.tenantId, id, req.user); }
  @Post('invoices/:id/pay') @RequireApprove('purchase_orders') recordInvoicePayment(@Request() req: any, @Param('id') id: string, @Body() body: any) { return this.service.recordInvoicePayment(req.user.tenantId, id, req.user.userId, body); }
  @Post('invoices/:id/payments/:paymentId/reverse') @RequireApprove('purchase_orders') reverseInvoicePayment(@Request() req: any, @Param('id') id: string, @Param('paymentId') paymentId: string, @Body() body: any) { return this.service.reverseInvoicePayment(req.user.tenantId, id, paymentId, req.user.userId, body?.reason); }
  @Post(':id/submit') @RequireCreate('purchase_orders') submit(@Request() req: any, @Param('id') id: string) { return this.service.submit(req.user.tenantId, id, req.user.userId); }
  @Post(':id/approve') @RequireApprove('purchase_orders') approve(@Request() req: any, @Param('id') id: string) { return this.service.approve(req.user.tenantId, id, req.user); }
  @Post(':id/reject') @RequireApprove('purchase_orders') reject(@Request() req: any, @Param('id') id: string, @Body() body: any) { return this.service.reject(req.user.tenantId, id, req.user, body?.reason); }
}
