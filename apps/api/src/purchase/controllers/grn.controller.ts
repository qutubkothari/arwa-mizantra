import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { GrnService } from '../services/grn.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, resolve, join } from 'path';
import { randomUUID } from 'crypto';
import { DuplicateDetectionService } from '../../common/services/duplicate-detection.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';
import { hasSuperAdminBypass } from '../../auth/utils/permission-utils';

function getUploadsRoot(): string {
  return (
    process.env.UPLOAD_ROOT_DIR ||
    resolve(process.cwd(), '..', '..', 'uploads')
  );
}

function buildGrnUploadStorage(kind: 'invoice' | 'qc') {
  return diskStorage({
    destination: (req, _file, cb) => {
      try {
        const user = (req as any)?.user;
        const tenantId = user?.tenantId;
        const userId = user?.userId;
        if (!tenantId || !userId) {
          cb(new BadRequestException('Missing auth context for upload') as any, '');
          return;
        }

        const today = new Date().toISOString().slice(0, 10);
        const relativeDir =
          kind === 'invoice'
            ? `grn/invoices/${today}/${tenantId}/${userId}`
            : `grn/qc/${today}/${tenantId}/${userId}`;

        (req as any).__grnUploadRelativeDir = relativeDir;

        const uploadsRoot = getUploadsRoot();
        const targetDir = join(uploadsRoot, relativeDir);
        mkdirSync(targetDir, { recursive: true });
        cb(null, targetDir);
      } catch (e) {
        cb(e as any, '');
      }
    },
    filename: (req, file, cb) => {
      try {
        const extensionFromName = extname(file.originalname || '').toLowerCase();
        const safeExtension =
          extensionFromName && extensionFromName.length <= 10
            ? extensionFromName
            : file.mimetype === 'application/pdf'
              ? '.pdf'
              : file.mimetype === 'image/png'
                ? '.png'
                : file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg'
                  ? '.jpg'
                  : '';

        const fileName = `${randomUUID()}${safeExtension}`;
        (req as any).__grnUploadFileName = fileName;
        cb(null, fileName);
      } catch (e) {
        cb(e as any, '');
      }
    },
  });
}

@Controller('purchase/grn')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GrnController {
  constructor(
    private readonly grnService: GrnService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  @Post('check-duplicates')
  async checkDuplicates(@Request() req: any, @Body() grnData: any) {
    const existing = await this.grnService.findAll(req.user.tenantId, {});
    
    // Check for duplicate GRN for same PO
    const existingForPO = existing.filter((grn: any) => 
      grn.purchase_order_id === grnData.purchase_order_id
    );
    
    if (existingForPO.length === 0) {
      return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
    }
    
    // Check if items match
    for (const existingGRN of existingForPO) {
      const hasSameItems = this.duplicateDetectionService.checkArrayDuplicates(
        grnData.items || [],
        [existingGRN.items || []],
        ['item_id', 'quantity'],
      );
      
      if (hasSameItems) {
        return {
          hasDuplicates: true,
          exactMatches: [{
            id: existingGRN.id,
            matchScore: 100,
            matchedFields: ['purchase_order_id', 'items'],
            data: existingGRN,
          }],
          fuzzyMatches: [],
          message: 'Identical GRN already exists for this PO with same items and quantities',
        };
      }
    }
    
    return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
  }

  @Post('discrepancy-preview')
  @RequireCreate('grns')
  async discrepancyPreview(@Request() req: any, @Body() body: any) {
    return this.grnService.previewDiscrepancies(req.user.tenantId, body);
  }

  @Post('invoice/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: buildGrnUploadStorage('invoice'),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadInvoice(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.grnService.uploadInvoice(req.user.tenantId, req.user.userId, file);
  }

  @Post('qc/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: buildGrnUploadStorage('qc'),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadQcAttachment(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.grnService.uploadQcAttachment(req.user.tenantId, req.user.userId, file);
  }

  @Post()
  @RequireCreate('grns')
  async create(@Request() req: any, @Body() body: any) {
    return this.grnService.create(req.user.tenantId, req.user.userId, body);
  }

  @Get()
  async findAll(@Request() req: any, @Query() query: any) {
    return this.grnService.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.grnService.findOne(req.user.tenantId, id);
  }

  @Put(':id')
  @RequireUpdate('grns')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.update(req.user.tenantId, id, body, req.user.userId);
  }

  @Post(':id/submit')
  async submit(@Request() req: any, @Param('id') id: string) {
    return this.grnService.submit(req.user.tenantId, id, req.user.userId);
  }

  @Post(':id/status')
  @RequireUpdate('grns')
  async updateStatus(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    const nextStatus = String(body?.status || '').trim().toUpperCase();
    if (nextStatus === 'APPROVED' || nextStatus === 'REJECTED') {
      throw new BadRequestException('Use the dedicated approval endpoint for approve or reject actions');
    }
    return this.grnService.updateStatus(req.user.tenantId, id, body.status, req.user.userId);
  }

  @Post(':id/approve')
  @RequireApprove('grns')
  async approve(@Request() req: any, @Param('id') id: string) {
    return this.grnService.updateStatus(req.user.tenantId, id, 'APPROVED', req.user.userId, { overrideMakerChecker: hasSuperAdminBypass(req.user) });
  }

  @Post(':id/reject')
  @RequireApprove('grns')
  async reject(@Request() req: any, @Param('id') id: string) {
    return this.grnService.updateStatus(req.user.tenantId, id, 'REJECTED', req.user.userId, { overrideMakerChecker: hasSuperAdminBypass(req.user) });
  }

  @Post(':id/po-amendment/approve')
  @RequireApprove('grns')
  async approvePoAmendment(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.decidePoAmendment(req.user.tenantId, id, req.user.userId, 'APPROVED', body?.note);
  }

  @Post(':id/po-amendment/reject')
  @RequireApprove('grns')
  async rejectPoAmendment(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.decidePoAmendment(req.user.tenantId, id, req.user.userId, 'REJECTED', body?.note);
  }

  @Delete(':id')
  @RequireDelete('grns')
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.grnService.delete(req.user.tenantId, id);
  }

  @Post(':id/qc-accept')
  @RequireUpdate('grns')
  async qcAccept(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.qcAccept(req.user.tenantId, id, req.user.userId, body);
  }

  @Put(':id/invoice-amounts')
  @RequireUpdate('grns')
  async updateInvoiceAmounts(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.updateInvoiceAmounts(req.user.tenantId, id, body, req.user.userId);
  }

  @Post(':id/approve-invoice')
  @RequireApprove('grns')
  async approveInvoice(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.approveInvoice(req.user.tenantId, id, req.user, body);
  }

  @Post(':id/unapprove-invoice')
  @RequireApprove('grns')
  async unapproveInvoice(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.unapproveInvoice(req.user.tenantId, id, req.user.userId, body);
  }

  @Post(':id/rebuild-stock')
  async rebuildStock(@Request() req: any, @Param('id') id: string) {
    return this.grnService.rebuildStockEntries(req.user.tenantId, id);
  }

  @Post(':id/reverse')
  @RequireApprove('grns')
  async reverse(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.grnService.reverse(req.user.tenantId, id, req.user.userId, body);
  }

  @Post('items/:itemId/generate-uids')
  async generateUIDs(@Request() req: any, @Param('itemId') itemId: string, @Body() body: any) {
    return this.grnService.generateUIDs(req.user.tenantId, itemId, body);
  }

  @Get(':id/uids')
  async getUIDsByGRN(@Request() req: any, @Param('id') id: string) {
    return this.grnService.getUIDsByGRN(req.user.tenantId, id);
  }

  @Post(':id/items/:itemId/generate-missing-uids')
  @RequireUpdate('grns')
  async generateMissingUIDs(@Request() req: any, @Param('id') grnId: string, @Param('itemId') itemId: string) {
    return this.grnService.generateMissingUIDs(req.user.tenantId, req.user.userId, grnId, itemId);
  }
}
