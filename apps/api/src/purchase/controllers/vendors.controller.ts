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
  Res,
  Header,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import { extname, join, resolve } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { VendorsService } from '../services/vendors.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DuplicateDetectionService } from '../../common/services/duplicate-detection.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';
import { hasSuperAdminBypass } from '../../auth/utils/permission-utils';

function getUploadsRoot(): string {
  return process.env.UPLOAD_ROOT_DIR || resolve(process.cwd(), '..', '..', 'uploads');
}

function normalizeVendorTaxId(value: any): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

function extractVendorPan(value: any): string | null {
  const normalized = normalizeVendorTaxId(value);
  if (!normalized) return null;
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalized)) return normalized;
  if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized)) {
    return normalized.slice(2, 12);
  }
  return null;
}

function extractVendorGstin(value: any): string | null {
  const normalized = normalizeVendorTaxId(value);
  return normalized && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized)
    ? normalized
    : null;
}

function buildVendorAttachmentStorage() {
  return diskStorage({
    destination: (req, _file, cb) => {
      try {
        const user = (req as any)?.user;
        const vendorId = (req as any)?.params?.id;
        if (!user?.tenantId || !user?.userId || !vendorId) {
          cb(new BadRequestException('Missing auth context for upload') as any, '');
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        const relativeDir = `vendors/${today}/${user.tenantId}/${vendorId}`;
        (req as any).__vendorUploadRelativeDir = relativeDir;
        const targetDir = join(getUploadsRoot(), relativeDir);
        mkdirSync(targetDir, { recursive: true });
        cb(null, targetDir);
      } catch (error) {
        cb(error as any, '');
      }
    },
    filename: (req, file, cb) => {
      try {
        const extension = extname(file.originalname || '').toLowerCase() || '';
        const fileName = `${randomUUID()}${extension.length <= 10 ? extension : ''}`;
        (req as any).__vendorUploadFileName = fileName;
        cb(null, fileName);
      } catch (error) {
        cb(error as any, '');
      }
    },
  });
}

@Controller('purchase/vendors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VendorsController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  @Post('check-duplicates')
  async checkDuplicates(@Request() req: any, @Body() vendorData: any) {
    const taxId = normalizeVendorTaxId(vendorData?.tax_id ?? vendorData?.taxId ?? null);
    const normalizedVendorData = {
      ...vendorData,
      tax_id: taxId,
      gst_number: extractVendorGstin(taxId),
      pan_number: extractVendorPan(taxId),
      legal_name: vendorData?.legal_name ?? vendorData?.legalName ?? null,
    };
    const existing = await this.vendorsService.findAll(req.user.tenantId, {});
    const normalizedExisting = existing.map((vendor: any) => ({
      ...vendor,
      tax_id: normalizeVendorTaxId(vendor?.tax_id),
      gst_number: extractVendorGstin(vendor?.tax_id),
      pan_number: extractVendorPan(vendor?.tax_id),
    }));
    
    return this.duplicateDetectionService.checkDuplicates(
      normalizedVendorData,
      normalizedExisting,
      {
        exactMatchFields: ['gst_number', 'pan_number', 'tax_id'],
        fuzzyMatchFields: ['name', 'legal_name', 'email', 'phone'],
        fuzzyThreshold: 0.2,
        excludeId: normalizedVendorData.id,
      },
    );
  }

  @Post()
  @RequireCreate('vendors')
  async create(@Request() req: any, @Body() body: any) {
    return this.vendorsService.create(req.user.tenantId, req.user.userId, body);
  }

  @Post('verify-gstin')
  async verifyGstin(@Body() body: any) {
    return this.vendorsService.verifyGstin(body?.gstin, body?.legalName);
  }

  @Get()
  async findAll(@Request() req: any, @Query() query: any) {
    return this.vendorsService.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.vendorsService.findOne(req.user.tenantId, id);
  }

  @Put(':id')
  @RequireUpdate('vendors')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.vendorsService.update(req.user.tenantId, req.user.userId, id, body);
  }

  @Put(':id/verify')
  @RequireApprove('vendors')
  async verify(@Request() req: any, @Param('id') id: string) {
    return this.vendorsService.setVerification(req.user.tenantId, req.user.userId, id, true, { overrideMakerChecker: hasSuperAdminBypass(req.user) });
  }

  @Put(':id/unverify')
  @RequireApprove('vendors')
  async unverify(@Request() req: any, @Param('id') id: string) {
    return this.vendorsService.setVerification(req.user.tenantId, req.user.userId, id, false, { overrideMakerChecker: hasSuperAdminBypass(req.user) });
  }

  @Put(':id/reject')
  @RequireApprove('vendors')
  async reject(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.vendorsService.rejectVerification(
      req.user.tenantId,
      req.user.userId,
      id,
      body?.reason,
      { overrideMakerChecker: hasSuperAdminBypass(req.user) },
    );
  }

  @Put(':id/bank/verify')
  @RequireApprove('vendors')
  async verifyBank(@Request() req: any, @Param('id') id: string) {
    return this.vendorsService.verifyBank(req.user.tenantId, req.user.userId, id, { overrideMakerChecker: hasSuperAdminBypass(req.user) });
  }

  @Post(':id/attachments/:type')
  @RequireUpdate('vendors')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: buildVendorAttachmentStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadAttachment(
    @Request() req: any,
    @Param('id') id: string,
    @Param('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.vendorsService.uploadAttachment(req.user.tenantId, req.user.userId, id, type, file);
  }

  @Delete(':id')
  @RequireDelete('vendors')
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.vendorsService.delete(req.user.tenantId, req.user.userId, id);
  }

  @Get('export/excel')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="vendors.xlsx"')
  async exportExcel(@Request() req: any, @Res() res: Response) {
    const vendors = await this.vendorsService.findAll(req.user.tenantId, {});
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Vendors');
    
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 36 },
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Legal Name', key: 'legal_name', width: 30 },
      { header: 'GST Number', key: 'gst_number', width: 20 },
      { header: 'PAN Number', key: 'pan_number', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'State', key: 'state', width: 15 },
      { header: 'Pincode', key: 'pincode', width: 10 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Is Verified', key: 'is_verified', width: 12 },
      { header: 'Is Active', key: 'is_active', width: 12 },
      { header: 'Payment Terms', key: 'payment_terms', width: 20 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Created At', key: 'created_at', width: 20 },
      { header: 'Updated At', key: 'updated_at', width: 20 },
    ];
    
    vendors.forEach((vendor: any) => {
      worksheet.addRow({
        id: vendor.id,
        code: vendor.code,
        name: vendor.name,
        legal_name: vendor.legal_name,
        gst_number: vendor.gst_number,
        pan_number: vendor.pan_number,
        email: vendor.email,
        phone: vendor.phone,
        address: vendor.address,
        city: vendor.city,
        state: vendor.state,
        pincode: vendor.pincode,
        country: vendor.country,
        is_verified: vendor.is_verified ? 'Yes' : 'No',
        is_active: vendor.is_active ? 'Yes' : 'No',
        payment_terms: vendor.payment_terms,
        currency: vendor.currency,
        created_at: vendor.created_at,
        updated_at: vendor.updated_at,
      });
    });
    
    worksheet.getRow(1).font = { bold: true };
    
    const buffer = await workbook.xlsx.writeBuffer();
    res.send(buffer);
  }
}
