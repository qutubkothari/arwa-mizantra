import { Controller, Post, Body, ForbiddenException } from '@nestjs/common';
import { DebitNoteService } from '../services/debit-note.service';

// Temporary public controller for one-time sync operation
@Controller('admin/sync')
export class SyncController {
  constructor(private readonly debitNoteService: DebitNoteService) {}

  @Post('payment-status')
  async syncAllPaymentStatus(@Body() body: { secret: string }) {
    if (body.secret !== 'sync-grn-status-2025') {
      throw new ForbiddenException('Invalid secret');
    }
    
    // Get all unique tenant IDs from GRNs
    const { data: tenants } = await this.debitNoteService['supabase']
      .from('grns')
      .select('tenant_id')
      .not('po_id', 'is', null);
    
    const uniqueTenants = [...new Set((tenants || []).map((t: any) => t.tenant_id))];
    const results = [];
    
    for (const tenantId of uniqueTenants) {
      const result = await this.debitNoteService.syncPaymentStatusForPoAdvances(tenantId);
      results.push({ tenantId, ...result });
    }
    
    return { total: results.length, results };
  }
}
