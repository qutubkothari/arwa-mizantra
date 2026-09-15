import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JobOrderService } from '../services/job-order.service';
import { CreateJobOrderDto, PartialCompleteJobOrderDto, UpdateJobOrderDto, UpdateOperationDto } from '../dto/job-order.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';
import { hasPermission, hasScreenAccess } from '../../auth/utils/permission-utils';

@Controller('job-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JobOrderController {
  constructor(private readonly jobOrderService: JobOrderService) {}

  @Get('smart/preview')
  async getSmartPreview(
    @Request() req: any,
    @Query()
    query: {
      itemId?: string;
      quantity?: string | number;
      salesOrderId?: string;
      salesOrderItemId?: string;
      includeAllComponents?: string | boolean;
    },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const quantity = typeof query.quantity === 'string' ? Number(query.quantity) : Number(query.quantity);

    const includeAllComponents =
      query.includeAllComponents === true ||
      query.includeAllComponents === 'true' ||
      query.includeAllComponents === '1';

    return this.jobOrderService.getSmartJobOrderPreview(tenantId, {
      itemId: String(query.itemId || ''),
      quantity,
      salesOrderId: query.salesOrderId,
      salesOrderItemId: query.salesOrderItemId,
      includeAllComponents,
    });
  }

  @Post('smart/create')
  async createSmartJobOrder(
    @Request() req: any,
    @Body() body: {
      itemId: string;
      quantity: number;
      startDate?: string;
      salesOrderId?: string;
      salesOrderItemId?: string;
      variantSelections?: Record<string, string>;
      itemSelections?: Record<string, string>;
      priority?: string;
      notes?: string;
      workingHoursOverride?: number;
      idempotencyKey?: string;
    },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.createSmartJobOrder(tenantId, userId, body);
  }

  @Post('smart/create-async')
  async createSmartJobOrderAsync(
    @Request() req: any,
    @Body() body: {
      itemId: string;
      quantity: number;
      startDate?: string;
      salesOrderId?: string;
      salesOrderItemId?: string;
      variantSelections?: Record<string, string>;
      itemSelections?: Record<string, string>;
      autoIssueMaterials?: boolean;
      priority?: string;
      notes?: string;
      workingHoursOverride?: number;
      idempotencyKey?: string;
    },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.startSmartJobOrderCreateAsync(tenantId, userId, body);
  }

  @Get('smart/create-async/:jobId')
  async getSmartJobOrderAsyncStatus(
    @Request() req: any,
    @Param('jobId') jobId: string,
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getSmartJobOrderCreateAsyncStatus(tenantId, jobId);
  }

  @Post()
  @RequireCreate('job_orders')
  async create(@Request() req: any, @Body() dto: CreateJobOrderDto) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id;
    return this.jobOrderService.create(tenantId, userId, dto);
  }

  @Post('from-bom')
  async createFromBOM(
    @Request() req: any,
    @Body()
    body: {
      itemId: string;
      bomId: string;
      quantity: number;
      startDate: string;
      autoIssueMaterials?: boolean;
      autoRepair?: boolean;
    },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id;
    if (body.autoIssueMaterials || body.autoRepair) {
      throw new BadRequestException(
        'Automatic material issue is disabled. Create the Job Order, then issue materials through Inventory > SIV.',
      );
    }
    return this.jobOrderService.createFromBOM(
      tenantId,
      userId,
      body.itemId,
      body.bomId,
      body.quantity,
      body.startDate,
      {
        autoIssueMaterials: false,
        autoRepair: false,
      },
    );
  }

  @Get()
  async findAll(@Request() req: any, @Query() filters: any) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    const nextFilters = { ...(filters || {}) };
    const canSeeAllJobOrders =
      hasScreenAccess(req.user, 'production-create-job-order') ||
      hasScreenAccess(req.user, 'production-smart-job-order') ||
      hasPermission(req.user, 'job_orders:approve');

    if (!canSeeAllJobOrders && userId) {
      nextFilters.assignedTo = userId;
      delete nextFilters.myAssigned;
    } else if (nextFilters?.myAssigned === 'true' || nextFilters?.myAssigned === true) {
      nextFilters.assignedTo = userId;
      delete nextFilters.myAssigned;
    }
    return this.jobOrderService.findAll(tenantId, nextFilters);
  }

  @Get('assignable-users')
  async getAssignableUsers(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getAssignableUsers(tenantId);
  }

  @Get('store/issue-employees')
  async getStoreIssueEmployees(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getActiveEmployeesForStoreIssue(tenantId);
  }

  @Get(':id/factory-readiness')
  async getFactoryReadiness(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getFactoryReadiness(tenantId, id);
  }

  @Post(':id/supervisor-override')
  @RequireApprove('job_orders')
  async createSupervisorOverride(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { controlCode?: string; reason?: string; evidenceReference?: string; validMinutes?: number },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    return this.jobOrderService.createSupervisorOverride(tenantId, id, userId, body);
  }

  @Get(':id/dispatches')
  async getOperationDispatches(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getOperationDispatches(tenantId, id);
  }

  @Post(':id/operations/:operationId/dispatches')
  @RequireUpdate('job_orders')
  async dispatchOperation(
    @Request() req: any,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
    @Body() body: any,
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.dispatchOperation(tenantId, userId, id, operationId, body);
  }

  @Delete(':id/dispatches/:dispatchId')
  @RequireUpdate('job_orders')
  async cancelOperationDispatch(
    @Request() req: any,
    @Param('id') id: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.cancelOperationDispatch(tenantId, id, dispatchId);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.findOne(tenantId, id);
  }

  @Put(':id')
  @RequireUpdate('job_orders')
  async update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateJobOrderDto) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.update(tenantId, id, dto);
  }

  @Put(':id/status')
  async updateStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body('status') status: string
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.updateStatus(tenantId, id, status);
  }

  @Post(':id/stop')
  @RequireUpdate('job_orders')
  async stopJobOrder(@Request() req: any, @Param('id') id: string, @Body() body: { reason?: string; producedQuantity?: number }) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.stopJobOrder(tenantId, id, userId, body?.reason, body?.producedQuantity);
  }

  @Post(':id/resume-remaining')
  @RequireUpdate('job_orders')
  async resumeRemainingProduction(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.resumeRemainingProduction(tenantId, id, userId);
  }

  @Put(':id/operations/:operationId')
  async updateOperation(
    @Request() req: any,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
    @Body() dto: UpdateOperationDto
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.updateOperation(tenantId, id, operationId, dto);
  }

  @Post(':id/complete')
  async completeJobOrder(@Request() req: any, @Param('id') id: string, @Body() body?: { allowPartialConsumption?: boolean; autoBuildMissingSubAssemblies?: boolean }) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    if (body?.autoBuildMissingSubAssemblies) {
      throw new BadRequestException(
        'Automatic subassembly completion is disabled. Complete the shortage and store workflow before completing this Job Order.',
      );
    }
    return this.jobOrderService.completeJobOrder(tenantId, id, userId, {
      allowPartialConsumption: body?.allowPartialConsumption ?? false,
      autoBuildMissingSubAssemblies: false,
    });
  }

  @Post(':id/complete-partial')
  async completeJobOrderPartial(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: PartialCompleteJobOrderDto,
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.completeJobOrderPartial(tenantId, id, userId, {
      producedQuantity: body?.producedQuantity,
    });
  }

  @Post(':id/issue-materials')
  async issueMaterials(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { autoRepair?: boolean } = {},
  ) {
    throw new BadRequestException(
      'Direct material issue from a Job Order is disabled. Use Inventory > SIV to issue materials.',
    );
  }

  @Post(':id/smart/repair-issue')
  async repairSmartAndIssue(@Request() req: any, @Param('id') id: string) {
    throw new BadRequestException(
      'Automatic Smart JO repair and issue is disabled. Complete shortage PRs and issue materials through Inventory > SIV.',
    );
  }

  @Post(':id/qc-approve')
  @RequireApprove('job_orders')
  async approveQC(
    @Request() req: any, 
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;

    return this.jobOrderService.approveQC(tenantId, id, body || {}, userId);
  }

  @Get('store/material-requisitions/open')
  async getOpenMaterialRequisitions(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    const canSeeAllJobOrders =
      hasScreenAccess(req.user, 'production-create-job-order') ||
      hasScreenAccess(req.user, 'production-smart-job-order') ||
      hasPermission(req.user, 'job_orders:approve');

    return this.jobOrderService.getOpenMaterialRequisitions(tenantId, {
      assignedTo: canSeeAllJobOrders ? undefined : userId,
    });
  }

  @Get('store/material-requisitions/history')
  async getStoreIssueVoucherHistory(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    const canSeeAllJobOrders =
      hasScreenAccess(req.user, 'production-create-job-order') ||
      hasScreenAccess(req.user, 'production-smart-job-order') ||
      hasPermission(req.user, 'job_orders:approve');

    return this.jobOrderService.getStoreIssueVoucherHistory(tenantId, {
      assignedTo: canSeeAllJobOrders ? undefined : userId,
    });
  }

  @Get('store/material-requisitions/:id/readiness')
  async checkMaterialReadiness(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.checkIssuanceReadiness(tenantId, id);
  }

  @Put('store/material-requisitions/:id/assign')
  async assignMaterialRequisition(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { assignedTo?: string | null },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.assignMaterialRequisition(
      tenantId,
      id,
      body?.assignedTo || null,
    );
  }

  @Post('store/material-requisitions/:id/issue')
  async issueMaterialRequisition(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.issueMaterialRequisition(tenantId, id, userId);
  }

  @Post('store/material-requisitions/:id/issue-line')
  async issueMaterialRequisitionLine(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { materialId: string; issueQuantity: number; uids?: string[] },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;

    try {
      return await this.jobOrderService.issueMaterialRequisitionLine(
        tenantId,
        id,
        body?.materialId,
        body?.issueQuantity,
        Array.isArray(body?.uids) ? body.uids : undefined,
        userId,
      );
    } catch (error: any) {
      // Enhanced error logging and response (version 2026-02-17-v5)
      const errorContext = {
        endpoint: 'issue-line',
        tenantId,
        jobOrderId: id,
        materialId: body?.materialId,
        issueQuantity: body?.issueQuantity,
        uidsCount: Array.isArray(body?.uids) ? body.uids.length : 0,
        errorType: error?.constructor?.name || 'Unknown',
        errorMessage: error?.message || 'No error message',
        errorResponse: error?.response,
        errorStack: error?.stack?.split('\n').slice(0, 3).join('\n'),
        timestamp: new Date().toISOString(),
      };

      console.error('[SIV ISSUE-LINE ERROR v2026-02-17-v5]', JSON.stringify(errorContext, null, 2));

      // Re-throw with enhanced message - ALWAYS include details
      if (error?.message && error.message !== 'Bad Request') {
        throw error; // Already has a good message
      }

      // Generic error - add context (NEVER let empty message through)
      throw new BadRequestException(
        `Failed to issue material (v5): ${error?.message || 'Unknown error'}. Context: jobOrder=${id}, material=${body?.materialId}, qty=${body?.issueQuantity}. Raw: ${JSON.stringify(error?.response || 'no-response-data')}`,
      );
    }
  }

  @Post('store/material-requisitions/manual-issue')
  async createManualStoreIssueVoucher(
    @Request() req: any,
    @Body() body: { itemId: string; issueQuantity: number; issuedToEmployeeId: string; notes?: string; uids?: string[] },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.createManualStoreIssueVoucher(tenantId, {
      itemId: body?.itemId,
      issueQuantity: body?.issueQuantity,
      issuedToEmployeeId: body?.issuedToEmployeeId,
      notes: body?.notes,
      uids: Array.isArray(body?.uids) ? body.uids : undefined,
      userId,
    });
  }

  @Put('store/material-requisitions/history/approve-bulk')
  @RequireApprove('job_orders')
  async approveStoreIssueVoucherHistoryRows(
    @Request() req: any,
    @Body() body: { movementIds?: string[] },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.approveStoreIssueVoucherHistoryRows(
      tenantId,
      Array.isArray(body?.movementIds) ? body.movementIds : [],
      userId,
    );
  }

  @Put('store/material-requisitions/history/:movementId')
  async updateStoreIssueVoucherHistoryRow(
    @Request() req: any,
    @Param('movementId') movementId: string,
    @Body() body: { notes?: string },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.updateStoreIssueVoucherHistoryRow(tenantId, movementId, {
      notes: body?.notes,
      userId,
    });
  }

  @Put('store/material-requisitions/history/:movementId/approve')
  @RequireApprove('job_orders')
  async approveStoreIssueVoucherHistoryRow(@Request() req: any, @Param('movementId') movementId: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.approveStoreIssueVoucherHistoryRow(tenantId, movementId, userId);
  }

  @Delete('store/material-requisitions/history/:movementId')
  async deleteStoreIssueVoucherHistoryRow(@Request() req: any, @Param('movementId') movementId: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.jobOrderService.deleteStoreIssueVoucherHistoryRow(tenantId, movementId, userId);
  }

  @Get('store/receipt-vouchers/open')
  async getOpenStoreReceiptVouchers(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getOpenStoreReceiptVouchers(tenantId);
  }

  @Get('store/receipt-vouchers/history')
  async getStoreReceiptVoucherHistory(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getStoreReceiptVoucherHistory(tenantId);
  }

  @Put('store/receipt-vouchers/history/:entryId')
  async updateStoreReceiptVoucherHistoryRow(
    @Request() req: any,
    @Param('entryId') entryId: string,
    @Body() body: { receiverName?: string; receiverPhone?: string },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.updateStoreReceiptVoucherHistoryRow(tenantId, entryId, {
      receiverName: body?.receiverName,
      receiverPhone: body?.receiverPhone,
      userId,
    });
  }

  @Put('store/receipt-vouchers/history/:entryId/approve')
  @RequireApprove('job_orders')
  async approveStoreReceiptVoucherHistoryRow(@Request() req: any, @Param('entryId') entryId: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.approveStoreReceiptVoucherHistoryRow(tenantId, entryId, userId);
  }

  @Put('store/receipt-vouchers/:entryId/approve')
  @RequireApprove('job_orders')
  async approveStoreReceiptVoucher(@Request() req: any, @Param('entryId') entryId: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.approveStoreReceiptVoucherHistoryRow(tenantId, entryId, userId);
  }

  @Delete('store/receipt-vouchers/history/:entryId')
  async deleteStoreReceiptVoucherHistoryRow(@Request() req: any, @Param('entryId') entryId: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.deleteStoreReceiptVoucherHistoryRow(tenantId, entryId, userId);
  }

  @Post('store/receipt-vouchers/manual')
  async createManualStoreReceiptVoucher(
    @Request() req: any,
    @Body() body: { itemId: string; quantity: number; warehouseId?: string; receiverName?: string; receiverPhone?: string; notes?: string; movementDate?: string },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.createManualStoreReceiptVoucher(tenantId, { ...body, userId });
  }

  @Delete('store/receipt-vouchers/:entryId')
  async deleteStoreReceiptVoucher(@Request() req: any, @Param('entryId') entryId: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.deleteStoreReceiptVoucherHistoryRow(tenantId, entryId, userId);
  }

  @Post('store/receipt-vouchers/:id/receive')
  async receiveStoreReceiptVoucher(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { receiverName?: string; receiverPhone?: string; receivedQuantity?: number },
  ) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.receiveStoreReceiptVoucher(tenantId, id, userId, {
      receiverName: body?.receiverName,
      receiverPhone: body?.receiverPhone,
      receivedQuantity: body?.receivedQuantity,
    });
  }

  @Get(':id/qc-summary')
  async getQcSummary(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getQcSummary(tenantId, id);
  }

  @Post(':id/ensure-uids')
  async ensureUids(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    const userId = req.user?.id || req.user?.sub;
    return this.jobOrderService.ensureUidsForJobOrder(tenantId, id, userId);
  }

  @Post(':id/force-auto-complete')
  async forceAutoComplete(@Request() req: any, @Param('id') id: string) {
    throw new BadRequestException(
      'Force auto-completion is disabled. Follow JO > SIV > Production > SRV > QC.',
    );
  }

  @Get(':id/completion-preview')
  async getCompletionPreview(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.getCompletionPreview(tenantId, id);
  }

  @Delete(':id')
  @RequireDelete('job_orders')
  async delete(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
    return this.jobOrderService.delete(tenantId, id);
  }
}
