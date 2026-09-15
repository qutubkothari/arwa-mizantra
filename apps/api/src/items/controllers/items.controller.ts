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
} from '@nestjs/common';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { ItemsService } from '../services/items.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DuplicateDetectionService } from '../../common/services/duplicate-detection.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';
import { hasAdminBypass, hasSuperAdminBypass } from '../../auth/utils/permission-utils';

@Controller('items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  @Post('check-duplicates')
  async checkDuplicates(@Request() req: any, @Body() itemData: any) {
    const normalizedItemData = {
      ...itemData,
      code: itemData?.code ?? itemData?.item_code ?? itemData?.itemCode ?? null,
      name: itemData?.name ?? itemData?.item_name ?? itemData?.itemName ?? null,
      drawing_number: itemData?.drawing_number ?? itemData?.drawingNumber ?? null,
    };
    const existing = await this.itemsService.findAll(req.user.tenantId, '', true, false, { includeRnd: true });
    
    return this.duplicateDetectionService.checkDuplicates(
      normalizedItemData,
      existing,
      {
        exactMatchFields: ['code', 'drawing_number'],
        fuzzyMatchFields: ['name', 'description'],
        fuzzyThreshold: 0.25,
        excludeId: normalizedItemData.id,
      },
    );
  }

  @Get()
  async findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('onlyVerified') onlyVerified?: string,
    @Query('includeRnd') includeRnd?: string,
    @Query('onlyRnd') onlyRnd?: string,
    @Query('scope') scope?: string,
    @Query('department') department?: string,
  ) {
    const includeInactiveBool = includeInactive === 'true';
    const onlyVerifiedBool = onlyVerified === 'true';
    const normalizedScope = String(scope || department || '').trim().toUpperCase();
    const onlyRndBool = onlyRnd === 'true' || normalizedScope === 'RND' || normalizedScope === 'R&D' || normalizedScope === 'RESEARCH';
    const includeRndBool = includeRnd === 'true' || onlyRndBool;
    console.log('[ItemsController] findAll called:', { tenantId: req.user.tenantId, search, includeInactive, includeInactiveBool, onlyVerifiedBool, includeRndBool, onlyRndBool });
    const result = await this.itemsService.findAll(req.user.tenantId, search, includeInactiveBool, onlyVerifiedBool, {
      includeRnd: includeRndBool,
      onlyRnd: onlyRndBool,
    });
    console.log('[ItemsController] findAll result:', { count: result.length });
    return result;
  }

  @Get('search')
  async search(@Request() req: any, @Query('q') query: string) {
    return this.itemsService.search(req.user.tenantId, query);
  }

  @Get('next-code')
  async previewNextCode(@Request() req: any, @Query('category') category: string) {
    return this.itemsService.previewNextItemCode(req.user.tenantId, category || 'RAW_MATERIAL');
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.findOne(req.user.tenantId, id);
  }

  @Post()
  @RequireCreate('items')
  async create(@Request() req: any, @Body() body: any) {
    return this.itemsService.create(req.user.tenantId, req.user.userId, body);
  }

  @Post('rnd-temporary')
  @RequireCreate('purchase_requisitions')
  async createRndTemporary(@Request() req: any, @Body() body: any) {
    return this.itemsService.createRndTemporary(req.user.tenantId, req.user.userId, body, {
      adminBypass: hasAdminBypass(req.user),
    });
  }

  @Post('bulk')
  async bulkCreate(@Request() req: any, @Body() body: { items: any[] }) {
    return this.itemsService.bulkCreate(req.user.tenantId, body.items);
  }

  @Put(':id')
  @RequireUpdate('items')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.itemsService.update(req.user.tenantId, id, body, req.user.userId);
  }

  @Put(':id/verify')
  @RequireApprove('items')
  async verify(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.setVerification(req.user.tenantId, req.user.userId, id, true, {
      overrideMakerChecker: hasSuperAdminBypass(req.user),
    });
  }

  @Put(':id/unverify')
  @RequireApprove('items')
  async unverify(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.setVerification(req.user.tenantId, req.user.userId, id, false, {
      overrideMakerChecker: hasSuperAdminBypass(req.user),
    });
  }

  @Delete(':id')
  @RequireDelete('items')
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.delete(req.user.tenantId, req.user.userId, id);
  }

  // Item-Vendor Relationships
  @Get(':id/vendors')
  async getItemVendors(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.getItemVendors(req.user.tenantId, id);
  }

  @Get(':id/vendors/preferred')
  async getPreferredVendor(@Request() req: any, @Param('id') id: string) {
    const preferred = await this.itemsService.getPreferredVendor(req.user.tenantId, id);
    // Returning `null` can be serialized as an empty response by some stacks/proxies;
    // always return a JSON value so frontend `response.json()` is safe.
    return preferred ?? {};
  }

  @Post(':id/vendors')
  async addVendor(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.itemsService.addItemVendor(req.user.tenantId, req.user.userId, id, body);
  }

  @Put(':id/vendors/:vendorId')
  async updateVendor(
    @Request() req: any,
    @Param('id') id: string,
    @Param('vendorId') vendorId: string,
    @Body() body: any
  ) {
    return this.itemsService.updateItemVendor(req.user.tenantId, req.user.userId, id, vendorId, body);
  }

  @Delete(':id/vendors/:vendorId')
  async removeVendor(@Request() req: any, @Param('id') id: string, @Param('vendorId') vendorId: string) {
    return this.itemsService.deleteItemVendor(req.user.tenantId, id, vendorId);
  }

  @Get(':id/vendors/:vendorId/price-history')
  async getPriceHistory(
    @Request() req: any,
    @Param('id') itemId: string,
    @Param('vendorId') vendorId: string
  ) {
    return this.itemsService.getPurchasePriceHistory(itemId, vendorId);
  }

  @Get(':id/stock')
  async getItemStock(
    @Request() req: any,
    @Param('id') itemId: string
  ) {
    return this.itemsService.getItemStock(itemId, req.user.tenantId);
  }

  @Get(':id/stock-trail')
  async getStockTrail(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.getStockTrail(req.user.tenantId, id);
  }

  @Get(':id/variants')
  async getItemVariants(
    @Request() req: any,
    @Param('id') itemId: string
  ) {
    return this.itemsService.getItemVariants(req.user.tenantId, itemId);
  }

  @Get(':id/default-variant')
  async getDefaultVariant(
    @Request() req: any,
    @Param('id') itemId: string
  ) {
    return this.itemsService.getDefaultVariant(req.user.tenantId, itemId);
  }

  @Get('export/excel')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="items.xlsx"')
  async exportExcel(@Request() req: any, @Res() res: Response) {
    const items = await this.itemsService.findAll(req.user.tenantId, '', true, false, { includeRnd: true });
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Items');
    
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 36 },
      { header: 'Item Code', key: 'item_code', width: 20 },
      { header: 'Item Name', key: 'item_name', width: 30 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'UOM', key: 'uom', width: 10 },
      { header: 'HSN Code', key: 'hsn_code', width: 15 },
      { header: 'Drawing Number', key: 'drawing_number', width: 20 },
      { header: 'OEM Part No', key: 'oem_part_no', width: 20 },
      { header: 'OEM Name', key: 'oem_name', width: 25 },
      { header: 'Is Verified', key: 'is_verified', width: 12 },
      { header: 'Is Active', key: 'is_active', width: 12 },
      { header: 'Purchase Currency', key: 'purchase_currency', width: 15 },
      { header: 'Foreign Unit Price', key: 'foreign_unit_price', width: 15 },
      { header: 'Standard Price', key: 'standard_price', width: 15 },
      { header: 'Reorder Level', key: 'reorder_level', width: 12 },
      { header: 'Reorder Qty', key: 'reorder_qty', width: 12 },
      { header: 'Max Stock', key: 'max_stock', width: 12 },
      { header: 'Min Stock', key: 'min_stock', width: 12 },
      { header: 'GST %', key: 'gst_percentage', width: 10 },
      { header: 'Created At', key: 'created_at', width: 20 },
      { header: 'Updated At', key: 'updated_at', width: 20 },
    ];
    
    items.forEach((item: any) => {
      worksheet.addRow({
        id: item.id,
        item_code: item.item_code,
        item_name: item.item_name,
        description: item.description,
        category: item.category?.name || item.category_name || '',
        uom: item.uom,
        hsn_code: item.hsn_code,
        drawing_number: item.drawing_number,
        oem_part_no: item.oem_part_no || '',
        oem_name: item.oem_name || '',
        is_verified: item.is_verified ? 'Yes' : 'No',
        is_active: item.is_active ? 'Yes' : 'No',
        purchase_currency: item.purchase_currency,
        foreign_unit_price: item.foreign_unit_price,
        standard_price: item.standard_price,
        reorder_level: item.reorder_level,
        reorder_qty: item.reorder_qty,
        max_stock: item.max_stock,
        min_stock: item.min_stock,
        gst_percentage: item.gst_percentage,
        created_at: item.created_at,
        updated_at: item.updated_at,
      });
    });
    
    worksheet.getRow(1).font = { bold: true };
    
    const buffer = await workbook.xlsx.writeBuffer();
    res.send(buffer);
  }
}
