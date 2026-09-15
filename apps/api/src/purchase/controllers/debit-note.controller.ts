import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { DebitNoteService } from '../services/debit-note.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireUpdate } from '../../auth/decorators/permissions.decorator';
import { hasSuperAdminBypass } from '../../auth/utils/permission-utils';

@Controller('purchase/debit-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DebitNoteController {
  constructor(private readonly debitNoteService: DebitNoteService) {}

  @Get()
  async findAll(@Req() req: any, @Query() query: any) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.findAll(tenantId, query);
  }

  @Get('vendor-payables')
  async getVendorPayables(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.getVendorPayables(tenantId);
  }

  // Unified Advances API - replaces po-advances and vendor-advances
  @Get('advances')
  async getUnifiedAdvances(
    @Req() req: any,
    @Query('type') type?: 'PO' | 'BLANKET' | 'ALL',
    @Query('vendor_id') vendorId?: string,
    @Query('po_id') poId?: string,
    @Query('has_balance') hasBalance?: string,
  ) {
    return this.debitNoteService.getUnifiedAdvances(req.user.tenantId, {
      advance_type: type || 'ALL',
      vendor_id: vendorId,
      po_id: poId,
      has_balance: hasBalance === 'true',
    });
  }

  // Get available advances for a vendor (for GRN payment adjustment)
  @Get('vendor/:vendorId/available-advances')
  async getVendorAvailableAdvances(
    @Req() req: any,
    @Param('vendorId') vendorId: string,
    @Query('po_id') poId?: string,
  ) {
    return this.debitNoteService.getVendorAvailableAdvances(req.user.tenantId, vendorId, poId);
  }

  // Suggest advance adjustment when GRN is created
  @Get('grn/:grnId/suggest-advance-adjustment')
  async suggestAdvanceAdjustment(
    @Req() req: any,
    @Param('grnId') grnId: string,
  ) {
    const tenantId = req.user.tenantId;
    // First get GRN details to get vendor, PO, and net amount
    const grn = await this.debitNoteService.getGrnPayableDetail(tenantId, grnId);
    return this.debitNoteService.suggestAdvanceAdjustment(
      tenantId,
      grn.vendor_id,
      grn.po_id,
      grn.net_payable_amount,
    );
  }

  // Unified GRN payment status - SINGLE SOURCE OF TRUTH
  // All frontend pages must use this for consistent payment status
  @Get('grns-with-payment-status')
  async getGrnsWithPaymentStatus(@Req() req: any, @Query() query: any) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.getGrnsWithPaymentStatus(tenantId, query);
  }

  @Get('po/:poId/settlement')
  async getPoSettlement(@Req() req: any, @Param('poId') poId: string) {
    return this.debitNoteService.getPoSettlement(req.user.tenantId, poId);
  }

  // Legacy endpoints (keep for backward compatibility)
  @Get('po-advances')
  async getAllAdvancePayments(@Req() req: any) {
    return this.debitNoteService.getUnifiedAdvances(req.user.tenantId, { advance_type: 'ALL' });
  }

  @Get('vendor-advances')
  async getVendorAdvanceSummary(@Req() req: any) {
    return this.debitNoteService.getVendorAdvanceSummary(req.user.tenantId);
  }

  @Get('vendor/:vendorId/advance-balance')
  async getVendorAdvanceBalance(@Req() req: any, @Param('vendorId') vendorId: string) {
    return this.debitNoteService.getVendorAdvanceBalance(req.user.tenantId, vendorId);
  }

  @Post('vendor/:vendorId/add-advance')
  async addVendorAdvance(
    @Req() req: any,
    @Param('vendorId') vendorId: string,
    @Body() body: { amount: number; payment_method?: string; payment_reference?: string; payment_date?: string; notes?: string },
  ) {
    return this.debitNoteService.addVendorAdvance(req.user.tenantId, vendorId, {
      ...body,
      created_by: req.user.userId,
    });
  }

  @Get('grn/:grnId/payable-detail')
  async getGrnPayableDetail(@Req() req: any, @Param('grnId') grnId: string) {
    return this.debitNoteService.getGrnPayableDetail(req.user.tenantId, grnId);
  }

  @Put('grn/:grnId/freight-adjustment')
  @RequireUpdate('debit_notes')
  async adjustInvoiceFreight(
    @Req() req: any,
    @Param('grnId') grnId: string,
    @Body() body: { freight_amount: number; freight_gst_amount?: number; reason: string },
  ) {
    return this.debitNoteService.adjustInvoiceFreight(
      req.user.tenantId,
      grnId,
      req.user.userId,
      body,
    );
  }

  @Get('grn/:grnId/payment-entries')
  async getPaymentEntries(@Req() req: any, @Param('grnId') grnId: string) {
    return this.debitNoteService.getPaymentEntries(req.user.tenantId, grnId);
  }

  @Get('po/:poId/advance-payments')
  async getAdvancePayments(@Req() req: any, @Param('poId') poId: string) {
    return this.debitNoteService.getAdvancePayments(req.user.tenantId, poId);
  }

  @Get('grn/:grnId')
  async findByGrn(@Req() req: any, @Param('grnId') grnId: string) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.findByGrn(tenantId, grnId);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.findOne(tenantId, id);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    return this.debitNoteService.create(tenantId, userId, body);
  }

  @Post(':id/approve')
  @RequireApprove('debit_notes')
  async approve(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    return this.debitNoteService.approve(tenantId, id, userId, {
      overrideMakerChecker: hasSuperAdminBypass(req.user),
    });
  }

  @Post(':id/send-email')
  async sendEmail(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.sendEmail(tenantId, id);
  }

  @Put(':id/status')
  async updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const nextStatus = String(body?.status || '').trim().toUpperCase();
    if (nextStatus === 'APPROVED') {
      throw new ForbiddenException('Use the dedicated approval endpoint for approve actions');
    }
    const tenantId = req.user.tenantId;
    return this.debitNoteService.updateStatus(tenantId, id, body.status);
  }

  @Put(':id/items/:itemId/return-status')
  async updateReturnStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { returnStatus: string; disposalNotes?: string },
  ) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.updateReturnStatus(
      tenantId,
      id,
      itemId,
      body.returnStatus,
      body.disposalNotes,
    );
  }

  // Unified advance payment endpoint - supports both PO and BLANKET advances
  @Post('advance-payment')
  async recordAdvancePayment(
    @Req() req: any,
    @Body() body: {
      advance_type: 'PO' | 'BLANKET';
      po_id?: string;
      vendor_id: string;
      amount: number;
      payment_method: string;
      payment_reference?: string;
      payment_date?: string;
      payment_notes?: string;
    },
  ) {
    return this.debitNoteService.recordAdvancePayment(req.user.tenantId, {
      ...body,
      created_by: req.user.userId,
    });
  }

  // Legacy endpoint (keep for backward compatibility)
  @Post('po/:poId/advance-payment')
  async recordPOAdvancePayment(
    @Req() req: any,
    @Param('poId') poId: string,
    @Body() body: {
      vendor_id: string;
      amount: number;
      payment_method: string;
      payment_reference?: string;
      payment_date?: string;
      payment_notes?: string;
    },
  ) {
    return this.debitNoteService.recordAdvancePayment(req.user.tenantId, {
      advance_type: 'PO',
      po_id: poId,
      vendor_id: body.vendor_id,
      amount: body.amount,
      payment_method: body.payment_method,
      payment_reference: body.payment_reference,
      payment_date: body.payment_date,
      payment_notes: body.payment_notes,
      created_by: req.user.userId,
    });
  }

  // Utilize a specific advance against a GRN
  @Post('advance/:advanceId/utilize-against-grn/:grnId')
  async utilizeAdvanceAgainstGRN(
    @Req() req: any,
    @Param('advanceId') advanceId: string,
    @Param('grnId') grnId: string,
    @Body() body: {
      utilize_amount: number;
      notes?: string;
    },
  ) {
    return this.debitNoteService.utilizeAdvanceAgainstGRN(
      req.user.tenantId,
      advanceId,
      grnId,
      body.utilize_amount,
      body.notes,
    );
  }

  @Post('grn/:grnId/payment')
  async recordPayment(
    @Req() req: any,
    @Param('grnId') grnId: string,
    @Body() body: {
      amount: number;
      payment_method: string;
      payment_reference?: string;
      payment_date?: string;
      payment_notes?: string;
      tds_amount?: number;
      short_payment_amount?: number;
      short_payment_reason?: string;
      close_invoice?: boolean;
    },
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    return this.debitNoteService.recordPayment(tenantId, grnId, { ...body, created_by: userId });
  }

  // Update an existing payment entry
  @Put('grn/:grnId/payment/:paymentId')
  async updatePayment(
    @Req() req: any,
    @Param('grnId') grnId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: {
      amount?: number;
      payment_method?: string;
      payment_reference?: string;
      payment_date?: string;
      payment_notes?: string;
      tds_amount?: number;
      short_payment_amount?: number;
      short_payment_reason?: string;
    },
  ) {
    const tenantId = req.user.tenantId;
    console.log('[Controller updatePayment]', { tenantId, grnId, paymentId, body });
    try {
      const result = await this.debitNoteService.updatePayment(tenantId, grnId, paymentId, body);
      console.log('[Controller updatePayment] success');
      return result;
    } catch (error) {
      console.error('[Controller updatePayment] error:', error);
      throw error;
    }
  }

  // Delete a payment entry
  @Delete('grn/:grnId/payment/:paymentId')
  async deletePayment(
    @Req() req: any,
    @Param('grnId') grnId: string,
    @Param('paymentId') paymentId: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.deletePayment(tenantId, grnId, paymentId);
  }

  @Post('grn/:grnId/payment/:paymentId/reverse')
  async reversePayment(
    @Req() req: any,
    @Param('grnId') grnId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: { reason?: string; notes?: string },
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    return this.debitNoteService.reversePayment(tenantId, grnId, paymentId, userId, body);
  }

  // Sync payment status for GRNs based on PO advance coverage
  @Post('sync-payment-status')
  async syncPaymentStatus(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.debitNoteService.syncPaymentStatusForPoAdvances(tenantId);
  }
}
