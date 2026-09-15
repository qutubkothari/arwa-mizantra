import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { SalesService } from '../services/sales.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DuplicateDetectionService } from '../../common/services/duplicate-detection.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';

@Controller('sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  // ==================== CUSTOMERS ====================
  
  @Post('customers/check-duplicates')
  async checkCustomerDuplicates(@Request() req: any, @Body() customerData: any) {
    const existing = await this.salesService.getCustomers(req, {});
    const primaryContact = Array.isArray(customerData.contacts)
      ? customerData.contacts.find((contact: any) => contact?.name || contact?.mobile || contact?.email)
      : null;
    const duplicateCandidate = {
      ...customerData,
      contact_person: primaryContact?.name || customerData.contact_person,
      mobile: primaryContact?.mobile || customerData.mobile,
      email: primaryContact?.email || customerData.email,
    };
    
    return this.duplicateDetectionService.checkDuplicates(
      duplicateCandidate,
      existing,
      {
        exactMatchFields: ['gst_number', 'pan_number', 'email'],
        fuzzyMatchFields: ['customer_name', 'contact_person', 'phone', 'mobile'],
        fuzzyThreshold: 0.2,
        excludeId: customerData.id,
      },
    );
  }
  
  @Get('customers')
  async getCustomers(@Request() req: any, @Query() filters: any) {
    return this.salesService.getCustomers(req, filters);
  }

  @Post('customers')
  @RequireCreate('sales')
  async createCustomer(@Request() req: any, @Body() customerData: any) {
    return this.salesService.createCustomer(req, customerData);
  }

  @Put('customers/:id')
  @RequireUpdate('sales')
  async updateCustomer(
    @Request() req: any,
    @Param('id') customerId: string,
    @Body() customerData: any,
  ) {
    return this.salesService.updateCustomer(req, customerId, customerData);
  }

  @Delete('customers/:id')
  @RequireDelete('sales')
  async deleteCustomer(@Request() req: any, @Param('id') customerId: string) {
    return this.salesService.deleteCustomer(req, customerId);
  }

  // ==================== QUOTATIONS ====================
  
  @Post('quotations/check-duplicates')
  async checkQuotationDuplicates(@Request() req: any, @Body() quotationData: any) {
    const existing = await this.salesService.getQuotations(req, {});
    
    // Check for same customer + items within last 7 days
    const recentQuotations = existing.filter((q: any) => {
      if (q.customer_id !== quotationData.customer_id) return false;
      const daysDiff = Math.abs(new Date().getTime() - new Date(q.created_at).getTime()) / (1000 * 3600 * 24);
      return daysDiff <= 7;
    });
    
    if (recentQuotations.length === 0) {
      return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
    }
    
    // Check if items match
    for (const recentQuotation of recentQuotations) {
      const hasSameItems = this.duplicateDetectionService.checkArrayDuplicates(
        quotationData.items || [],
        [recentQuotation.items || []],
        ['item_description', 'quantity'],
      );
      
      if (hasSameItems) {
        return {
          hasDuplicates: true,
          fuzzyMatches: [{
            id: recentQuotation.id,
            matchScore: 95,
            matchedFields: ['customer_id', 'items'],
            data: recentQuotation,
          }],
          exactMatches: [],
          message: 'Similar quotation with same customer and items created in last 7 days',
        };
      }
    }
    
    return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
  }
  
  @Get('quotations')
  async getQuotations(@Request() req: any, @Query() filters: any) {
    return this.salesService.getQuotations(req, filters);
  }

  @Get('quotations/:id')
  async getQuotationById(@Request() req: any, @Param('id') quotationId: string) {
    return this.salesService.getQuotationById(req, quotationId);
  }

  @Post('quotations')
  @RequireCreate('sales')
  async createQuotation(@Request() req: any, @Body() quotationData: any) {
    return this.salesService.createQuotation(req, quotationData);
  }

  @Get('quotations/:id/pdf')
  async downloadQuotationPdf(@Request() req: any, @Param('id') quotationId: string, @Res() res: Response) {
    const document = await this.salesService.renderQuotationPdf(req, quotationId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(document.buffer);
  }

  @Put('quotations/:id')
  @RequireUpdate('sales')
  async updateQuotation(
    @Request() req: any,
    @Param('id') quotationId: string,
    @Body() quotationData: any,
  ) {
    return this.salesService.updateQuotation(req, quotationId, quotationData);
  }

  @Put('quotations/:id/approve')
  @RequireApprove('sales')
  async approveQuotation(@Request() req: any, @Param('id') quotationId: string) {
    return this.salesService.approveQuotation(req, quotationId);
  }

  @Put('quotations/:id/reject')
  @RequireApprove('sales')
  async rejectQuotation(
    @Request() req: any,
    @Param('id') quotationId: string,
    @Body() decision: { reason?: string },
  ) {
    return this.salesService.rejectQuotation(req, quotationId, decision?.reason);
  }

  @Post('quotations/:id/revise')
  @RequireCreate('sales')
  async reviseQuotation(@Request() req: any, @Param('id') quotationId: string) {
    return this.salesService.reviseQuotation(req, quotationId);
  }

  @Get('quotations/:id/activities')
  async getQuotationActivities(@Request() req: any, @Param('id') quotationId: string) {
    return this.salesService.getQuotationActivities(req, quotationId);
  }

  @Post('quotations/:id/comments')
  @RequireUpdate('sales')
  async addQuotationComment(@Request() req: any, @Param('id') quotationId: string, @Body() body: any) {
    return this.salesService.addQuotationComment(req, quotationId, body);
  }

  @Post('quotations/:id/send-email')
  async sendQuotationEmail(@Request() req: any, @Param('id') quotationId: string, @Body() body: any) {
    return this.salesService.sendQuotationEmail(req, quotationId, body);
  }

  @Post('quotations/:id/send-response-reminder')
  async sendQuotationResponseReminder(@Request() req: any, @Param('id') quotationId: string, @Body() body: any) {
    return this.salesService.sendQuotationResponseReminder(req, quotationId, body);
  }

  @Delete('quotations/:id')
  @RequireDelete('sales')
  async deleteQuotation(@Request() req: any, @Param('id') quotationId: string) {
    return this.salesService.deleteQuotation(req, quotationId);
  }

  @Post('quotations/:id/convert-to-so')
  @RequireCreate('sales')
  async convertQuotationToSO(
    @Request() req: any, 
    @Param('id') quotationId: string,
    @Body() conversionData?: any
  ) {
    return this.salesService.convertQuotationToSO(req, quotationId, conversionData);
  }

  // ==================== SALES ORDERS ====================
  
  @Post('orders/check-duplicates')
  async checkSalesOrderDuplicates(@Request() req: any, @Body() soData: any) {
    const existing = await this.salesService.getSalesOrders(req, {});
    
    // Check for same customer + items within last 3 days
    const recentSOs = existing.filter((so: any) => {
      if (so.customer_id !== soData.customer_id) return false;
      const daysDiff = Math.abs(new Date().getTime() - new Date(so.created_at).getTime()) / (1000 * 3600 * 24);
      return daysDiff <= 3;
    });
    
    if (recentSOs.length === 0) {
      return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
    }
    
    // Check if items match
    for (const recentSO of recentSOs) {
      const hasSameItems = this.duplicateDetectionService.checkArrayDuplicates(
        soData.items || [],
        [recentSO.items || []],
        ['item_description', 'quantity'],
      );
      
      if (hasSameItems) {
        return {
          hasDuplicates: true,
          exactMatches: [{
            id: recentSO.id,
            matchScore: 100,
            matchedFields: ['customer_id', 'items'],
            data: recentSO,
          }],
          fuzzyMatches: [],
          message: 'Identical Sales Order with same customer and items created in last 3 days',
        };
      }
    }
    
    return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
  }
  
  @Get('orders')
  async getSalesOrders(@Request() req: any, @Query() filters: any) {
    return this.salesService.getSalesOrders(req, filters);
  }

  @Get('orders/:id')
  async getSalesOrderById(@Request() req: any, @Param('id') soId: string) {
    return this.salesService.getSalesOrderById(req, soId);
  }

  @Get('orders/:id/pdf')
  async downloadSalesOrderPdf(@Request() req: any, @Param('id') soId: string, @Res() res: Response) {
    const document = await this.salesService.renderSalesOrderPdf(req, soId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(document.buffer);
  }

  @Get('customers/:id/credit-exposure')
  async getCustomerCreditExposure(@Request() req: any, @Param('id') customerId: string, @Query('proposed_amount') proposedAmount?: string) {
    return this.salesService.getCustomerCreditExposure(req, customerId, Number(proposedAmount || 0));
  }

  @Get('customers/:id/account-statement')
  async getCustomerAccountStatement(
    @Request() req: any,
    @Param('id') customerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.salesService.getCustomerAccountStatement(req, customerId, { from, to });
  }

  @Get('customers/:id/account-statement/pdf')
  async downloadCustomerAccountStatementPdf(
    @Request() req: any,
    @Param('id') customerId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() response: Response,
  ) {
    const document = await this.salesService.renderCustomerAccountStatementPdf(req, customerId, { from, to });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(document.buffer);
  }

  @Post('customers/:id/account-statement/send-email')
  @RequireUpdate('sales')
  async sendCustomerAccountStatementEmail(
    @Request() req: any,
    @Param('id') customerId: string,
    @Body() body: any,
  ) {
    return this.salesService.sendCustomerAccountStatementEmail(req, customerId, body);
  }

  @Get('dunning-notices')
  async getDunningNotices(@Request() req: any, @Query() filters: any) {
    return this.salesService.getDunningNotices(req, filters);
  }

  @Get('dunning-notices/:id')
  async getDunningNoticeById(@Request() req: any, @Param('id') noticeId: string) {
    return this.salesService.getDunningNoticeById(req, noticeId);
  }

  @Get('dunning-notices/:id/pdf')
  async downloadDunningNoticePdf(
    @Request() req: any,
    @Param('id') noticeId: string,
    @Res() response: Response,
  ) {
    const document = await this.salesService.renderDunningNoticePdf(req, noticeId);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(document.buffer);
  }

  @Post('customers/:id/dunning-notices')
  @RequireUpdate('sales')
  async createDunningNotice(@Request() req: any, @Param('id') customerId: string, @Body() body: any) {
    return this.salesService.createDunningNotice(req, customerId, body);
  }

  @Post('dunning-notices/:id/cancel')
  @RequireUpdate('sales')
  async cancelDunningNotice(@Request() req: any, @Param('id') noticeId: string, @Body() body: any) {
    return this.salesService.cancelDunningNotice(req, noticeId, body);
  }

  @Get('orders/:id/availability')
  async getSalesOrderAvailability(@Request() req: any, @Param('id') soId: string) {
    return this.salesService.getSalesOrderAvailability(req, soId);
  }

  @Post('orders/:id/release')
  @RequireApprove('sales')
  async releaseSalesOrder(@Request() req: any, @Param('id') soId: string, @Body() body: any) {
    return this.salesService.releaseSalesOrder(req, soId, body);
  }

  @Put('orders/:id/blocks')
  @RequireUpdate('sales')
  async updateSalesOrderBlocks(@Request() req: any, @Param('id') soId: string, @Body() body: any) {
    return this.salesService.updateSalesOrderBlocks(req, soId, body);
  }

  @Post('orders')
  @RequireCreate('sales')
  async createDirectSalesOrder(@Request() req: any, @Body() soData: any) {
    return this.salesService.createDirectSalesOrder(req, soData);
  }

  @Put('orders/:id')
  @RequireUpdate('sales')
  async updateSalesOrder(
    @Request() req: any,
    @Param('id') soId: string,
    @Body() soData: any,
  ) {
    return this.salesService.updateSalesOrder(req, soId, soData);
  }

  @Delete('orders/:id')
  @RequireDelete('sales')
  async deleteSalesOrder(@Request() req: any, @Param('id') soId: string) {
    return this.salesService.deleteSalesOrder(req, soId);
  }

  @Post('orders/:id/send-email')
  async sendSalesOrderEmail(@Request() req: any, @Param('id') soId: string) {
    return this.salesService.sendSalesOrderEmail(req, soId);
  }

  // ==================== DISPATCH ====================
  
  @Get('dispatch')
  async getDispatchNotes(@Request() req: any, @Query() filters: any) {
    return this.salesService.getDispatchNotes(req, filters);
  }

  @Post('dispatch')
  @RequireCreate('sales')
  async createDispatch(@Request() req: any, @Body() dispatchData: any) {
    return this.salesService.createDispatch(req, dispatchData);
  }

  @Put('dispatch/:id')
  @RequireUpdate('sales')
  async updateDispatch(@Request() req: any, @Param('id') dispatchId: string, @Body() dispatchData: any) {
    return this.salesService.updateDispatch(req, dispatchId, dispatchData);
  }

  @Delete('dispatch/:id')
  @RequireDelete('sales')
  async deleteDispatch(@Request() req: any, @Param('id') dispatchId: string) {
    return this.salesService.deleteDispatch(req, dispatchId);
  }

  @Get('dispatch/:id/pdf')
  async downloadDispatchPdf(@Request() req: any, @Param('id') dispatchId: string, @Res() res: Response) {
    const document = await this.salesService.renderDispatchPdf(req, dispatchId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(document.buffer);
  }

  @Post('dispatch/:id/send-email')
  @RequireUpdate('sales')
  async sendDispatchNoteEmail(@Request() req: any, @Param('id') dispatchId: string, @Body() body: any) {
    return this.salesService.sendDispatchNoteEmail(req, dispatchId, body);
  }

  @Post('dispatch/:id/confirm-delivery')
  @RequireUpdate('sales')
  async confirmDelivery(@Request() req: any, @Param('id') dispatchId: string, @Body() body: any) {
    return this.salesService.confirmDelivery(req, dispatchId, body);
  }

  // ==================== BILLING / RECEIVABLES ====================

  @Get('collections/worklist')
  async getCollectionsWorklist(@Request() req: any, @Query() filters: any) {
    return this.salesService.getCollectionsWorklist(req, filters);
  }

  @Get('invoices')
  async getInvoices(@Request() req: any, @Query() filters: any) {
    return this.salesService.getInvoices(req, filters);
  }

  @Get('invoices/:id')
  async getInvoiceById(@Request() req: any, @Param('id') invoiceId: string) {
    return this.salesService.getInvoiceById(req, invoiceId);
  }

  @Get('invoices/:id/pdf')
  async downloadSalesInvoicePdf(@Request() req: any, @Param('id') invoiceId: string, @Res() res: Response) {
    const document = await this.salesService.renderSalesInvoicePdf(req, invoiceId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(document.buffer);
  }

  @Get('invoices/:id/credit-notes')
  async getInvoiceCreditNotes(@Request() req: any, @Param('id') invoiceId: string) {
    return this.salesService.getInvoiceCreditNotes(req, invoiceId);
  }

  @Post('invoices/:id/send-email')
  async sendInvoiceEmail(@Request() req: any, @Param('id') invoiceId: string, @Body() body: any) {
    return this.salesService.sendInvoiceEmail(req, invoiceId, body);
  }

  @Post('dispatch/:id/create-invoice')
  @RequireCreate('sales')
  async createInvoiceFromDispatch(
    @Request() req: any,
    @Param('id') dispatchId: string,
    @Body() body: any,
  ) {
    return this.salesService.createInvoiceFromDispatch(req, dispatchId, body);
  }

  @Post('invoices/:id/payments')
  @RequireUpdate('sales')
  async recordInvoicePayment(
    @Request() req: any,
    @Param('id') invoiceId: string,
    @Body() body: any,
  ) {
    return this.salesService.recordInvoicePayment(req, invoiceId, body);
  }

  @Post('invoices/:id/collection-action')
  @RequireUpdate('sales')
  async recordInvoiceCollectionAction(
    @Request() req: any,
    @Param('id') invoiceId: string,
    @Body() body: any,
  ) {
    return this.salesService.recordInvoiceCollectionAction(req, invoiceId, body);
  }

  @Post('invoices/:id/credit-notes')
  @RequireUpdate('sales')
  async createSalesCreditNote(@Request() req: any, @Param('id') invoiceId: string, @Body() body: any) {
    return this.salesService.createSalesCreditNote(req, invoiceId, body);
  }

  @Post('credit-notes/:id/cancel')
  @RequireUpdate('sales')
  async cancelSalesCreditNote(@Request() req: any, @Param('id') creditNoteId: string, @Body() body: any) {
    return this.salesService.cancelSalesCreditNote(req, creditNoteId, body);
  }

  @Get('returns')
  async getSalesReturns(@Request() req: any) { return this.salesService.getSalesReturns(req); }

  @Post('invoices/:id/returns')
  @RequireCreate('sales')
  async createSalesReturn(@Request() req: any, @Param('id') invoiceId: string, @Body() body: any) { return this.salesService.createSalesReturn(req, invoiceId, body); }

  @Post('returns/:id/receive')
  @RequireUpdate('sales')
  async receiveSalesReturn(@Request() req: any, @Param('id') returnId: string, @Body() body: any) { return this.salesService.receiveSalesReturn(req, returnId, body); }

  @Post('returns/:id/qc')
  @RequireUpdate('sales')
  async qcSalesReturn(@Request() req: any, @Param('id') returnId: string, @Body() body: any) { return this.salesService.qcSalesReturn(req, returnId, body); }

  @Post('invoices/:id/cancel')
  @RequireUpdate('sales')
  async cancelInvoice(@Request() req: any, @Param('id') invoiceId: string, @Body() body: any) {
    return this.salesService.cancelInvoice(req, invoiceId, body);
  }

  @Post('invoices/:invoiceId/payments/:paymentId/reverse')
  @RequireUpdate('sales')
  async reverseInvoicePayment(@Request() req: any, @Param('invoiceId') invoiceId: string, @Param('paymentId') paymentId: string, @Body() body: any) {
    return this.salesService.reverseInvoicePayment(req, invoiceId, paymentId, body);
  }

  @Get('invoices/:invoiceId/payments/:paymentId/pdf')
  async downloadCustomerReceiptPdf(@Request() req: any, @Param('invoiceId') invoiceId: string, @Param('paymentId') paymentId: string, @Res() res: Response) {
    const document = await this.salesService.renderCustomerReceiptPdf(req, invoiceId, paymentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(document.buffer);
  }

  @Post('invoices/:invoiceId/payments/:paymentId/send-email')
  @RequireUpdate('sales')
  async sendCustomerReceiptEmail(@Request() req: any, @Param('invoiceId') invoiceId: string, @Param('paymentId') paymentId: string, @Body() body: any) {
    return this.salesService.sendCustomerReceiptEmail(req, invoiceId, paymentId, body);
  }

  @Get('orders/:id/document-flow')
  async getSalesOrderDocumentFlow(@Request() req: any, @Param('id') soId: string) {
    return this.salesService.getSalesOrderDocumentFlow(req, soId);
  }

  // ==================== WARRANTY ====================

  @Post('warranties')
  @RequireCreate('sales')
  async createWarranty(@Request() req: any, @Body() warrantyData: any) {
    return this.salesService.createWarranty(req, warrantyData);
  }
  
  @Get('warranties')
  async getWarranties(@Request() req: any, @Query() filters: any) {
    return this.salesService.getWarranties(req, filters);
  }

  @Get('warranties/:id')
  async getWarrantyById(@Request() req: any, @Param('id') warrantyId: string) {
    return this.salesService.getWarrantyById(req, warrantyId);
  }

  @Get('warranties/validate/:uid')
  async validateWarranty(@Request() req: any, @Param('uid') uid: string) {
    return this.salesService.validateWarranty(req, uid);
  }

  @Put('warranties/:id')
  @RequireUpdate('sales')
  async updateWarranty(@Request() req: any, @Param('id') warrantyId: string, @Body() warrantyData: any) {
    return this.salesService.updateWarranty(req, warrantyId, warrantyData);
  }

  @Delete('warranties/:id')
  @RequireDelete('sales')
  async deleteWarranty(@Request() req: any, @Param('id') warrantyId: string) {
    return this.salesService.deleteWarranty(req, warrantyId);
  }
}
