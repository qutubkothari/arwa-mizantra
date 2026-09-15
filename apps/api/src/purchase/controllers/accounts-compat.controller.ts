import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { DebitNoteService } from '../services/debit-note.service';

@Controller('accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountsCompatController {
  constructor(private readonly debitNoteService: DebitNoteService) {}

  @Get('payables')
  async getPayables(@Req() req: any) {
    return this.debitNoteService.getVendorPayables(req.user.tenantId);
  }

  @Get('supplier-invoices')
  async getSupplierInvoices(@Req() req: any, @Query() query: any) {
    return this.debitNoteService.getGrnsWithPaymentStatus(req.user.tenantId, query);
  }
}
