import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SubcontractingService } from './subcontracting.service';

@Controller('production/subcontracting')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubcontractingController {
  constructor(private readonly subcontractingService: SubcontractingService) {}

  @Get('dashboard')
  dashboard(@Request() req: any) {
    return this.subcontractingService.dashboard(req);
  }

  @Get('routes')
  routes(@Request() req: any, @Query() query: any) {
    return this.subcontractingService.listRoutes(req, query);
  }

  @Post('routes')
  createRoute(@Request() req: any, @Body() body: any) {
    return this.subcontractingService.createRoute(req, body);
  }

  @Put('routes/:id')
  updateRoute(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.subcontractingService.updateRoute(req, id, body);
  }

  @Delete('routes/:id')
  deleteRoute(@Request() req: any, @Param('id') id: string) {
    return this.subcontractingService.deleteRoute(req, id);
  }

  @Get('orders')
  orders(@Request() req: any, @Query() query: any) {
    return this.subcontractingService.listOrders(req, query);
  }

  @Get('orders/:id')
  order(@Request() req: any, @Param('id') id: string) {
    return this.subcontractingService.getOrder(req, id);
  }

  @Get('finance')
  finance(@Request() req: any) {
    return this.subcontractingService.finance(req);
  }

  @Post('orders')
  createOrder(@Request() req: any, @Body() body: any) {
    return this.subcontractingService.createOrder(req, body);
  }

  @Put('orders/:id')
  updateOrder(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.subcontractingService.updateOrder(req, id, body);
  }

  @Post('orders/:id/submit')
  submitOrder(@Request() req: any, @Param('id') id: string) {
    return this.subcontractingService.submitOrder(req, id);
  }

  @Post('orders/:id/approve')
  approveOrder(@Request() req: any, @Param('id') id: string) {
    return this.subcontractingService.approveOrder(req, id);
  }

  @Post('orders/:id/reject')
  rejectOrder(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.subcontractingService.rejectOrder(req, id, body?.reason);
  }

  @Post('orders/:id/steps/:stepId/issue')
  issueStep(@Request() req: any, @Param('id') id: string, @Param('stepId') stepId: string, @Body() body: any) {
    return this.subcontractingService.issueStep(req, id, stepId, body);
  }

  @Post('orders/:id/issue')
  issueOrder(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.subcontractingService.issueOrder(req, id, body);
  }

  @Post('orders/:id/steps/:stepId/receive')
  receiveStep(@Request() req: any, @Param('id') id: string, @Param('stepId') stepId: string, @Body() body: any) {
    return this.subcontractingService.receiveStep(req, id, stepId, body);
  }

  @Post('orders/:id/receipts/:receiptId/qc-approve')
  approveReceiptQc(@Request() req: any, @Param('id') id: string, @Param('receiptId') receiptId: string, @Body() body: any) {
    return this.subcontractingService.approveReceiptQc(req, id, receiptId, body);
  }

  @Post('orders/:id/steps/:stepId/invoice')
  recordStepInvoice(@Request() req: any, @Param('id') id: string, @Param('stepId') stepId: string, @Body() body: any) {
    return this.subcontractingService.recordStepInvoice(req, id, stepId, body);
  }

  @Post('orders/:id/steps/:stepId/pay')
  markStepPaid(@Request() req: any, @Param('id') id: string, @Param('stepId') stepId: string, @Body() body: any) {
    return this.subcontractingService.markStepPaid(req, id, stepId, body);
  }

  @Get('vendor-stock')
  vendorStock(@Request() req: any) {
    return this.subcontractingService.vendorStock(req);
  }
}
