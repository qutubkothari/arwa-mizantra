import { Controller, Get, Query, UseGuards, Request, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { TraceabilityService } from './traceability.service';

@Controller('uid/traceability')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  /**
   * Get full traceability for a specific UID
   * GET /uid/traceability/:uid
   */
  @Get(':uid')
  async getUidTraceability(
    @Request() req: any,
    @Param('uid') uid: string,
  ) {
    const result = await this.traceabilityService.getTraceabilityReport(req.user.tenantId, {
      uid,
      limit: 100,
      offset: 0,
    });
    return result.data;
  }

  /**
   * Get traceability for all UIDs from a specific GRN
   * GET /uid/traceability/grn/:grnNumber
   */
  @Get('grn/:grnNumber')
  async getGrnTraceability(
    @Request() req: any,
    @Param('grnNumber') grnNumber: string,
  ) {
    return this.traceabilityService.getGrnTraceability(grnNumber, req.user.tenantId);
  }

  /**
   * Get material traceability for a specific Work Order
   * GET /uid/traceability/work-order/:workOrderNumber
   */
  @Get('work-order/:workOrderNumber')
  async getWorkOrderTraceability(
    @Request() req: any,
    @Param('workOrderNumber') workOrderNumber: string,
  ) {
    return this.traceabilityService.getWorkOrderTraceability(workOrderNumber, req.user.tenantId);
  }

  /**
   * Get full traceability report with filters
   * GET /uid/traceability
   */
  @Get()
  async getTraceabilityReport(
    @Request() req: any,
    @Query('uid') uid?: string,
    @Query('part_code') partCode?: string,
    @Query('supplier_name') supplierName?: string,
    @Query('grn_number') grnNumber?: string,
    @Query('work_order_number') workOrderNumber?: string,
    @Query('assembly_name') assemblyName?: string,
    @Query('level') level?: string,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters = {
      uid,
      part_code: partCode,
      supplier_name: supplierName,
      grn_number: grnNumber,
      work_order_number: workOrderNumber,
      assembly_name: assemblyName,
      level: level ? parseInt(level) : undefined,
      from_date: fromDate,
      to_date: toDate,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    };

    return this.traceabilityService.getTraceabilityReport(req.user.tenantId, filters);
  }

  /**
   * Export traceability report as CSV/Excel
   * GET /uid/traceability/export
   */
  @Get('export')
  async exportTraceabilityReport(
    @Request() req: any,
    @Query('format') format: 'csv' | 'excel' = 'csv',
    @Query('uid') uid?: string,
    @Query('grn_number') grnNumber?: string,
    @Query('work_order_number') workOrderNumber?: string,
  ) {
    const filters = {
      uid,
      grn_number: grnNumber,
      work_order_number: workOrderNumber,
    };

    return this.traceabilityService.exportReport(req.user.tenantId, filters, format);
  }
}
