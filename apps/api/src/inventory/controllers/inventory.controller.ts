import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { InventoryService } from '../services/inventory.service';
import { ItemsService } from '../../items/services/items.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly itemsService: ItemsService,
  ) {}

  // Items Master
  @Get('items')
  async getItems(
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
    return this.itemsService.findAll(req.user.tenantId, search, includeInactiveBool, onlyVerifiedBool, {
      includeRnd: includeRndBool,
      onlyRnd: onlyRndBool,
    });
  }

  @Get('items/search')
  async searchItems(@Request() req: any, @Query('q') query: string) {
    return this.itemsService.search(req.user.tenantId, query);
  }

  @Get('items/:id')
  async getItem(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.findOne(req.user.tenantId, id);
  }

  @Post('items')
  async createItem(@Request() req: any, @Body() body: any) {
    return this.itemsService.create(req.user.tenantId, req.user.userId, body);
  }

  @Put('items/:id')
  async updateItem(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.itemsService.update(req.user.tenantId, id, body, req.user.userId);
  }

  @Delete('items/:id')
  async deleteItem(@Request() req: any, @Param('id') id: string) {
    return this.itemsService.delete(req.user.tenantId, req.user.userId, id);
  }

  // Stock levels
  @Get('stock')
  async getStockLevels(@Request() req: any, @Query() filters: any) {
    return this.inventoryService.getStockLevels(req, filters);
  }

  @Delete('stock/:id')
  async deleteStockEntry(@Request() req: any, @Param('id') id: string) {
    return this.inventoryService.deleteStockEntry(req, id);
  }

  // Stock movements
  @Get('movements')
  async getStockMovements(@Request() req: any, @Query() filters: any) {
    return this.inventoryService.getStockMovements(req, filters);
  }

  @Post('movements')
  async createStockMovement(@Request() req: any, @Body() movementData: any) {
    return this.inventoryService.createStockMovement(req, movementData);
  }

  @Delete('movements/:id')
  async deleteStockMovement(@Request() req: any, @Param('id') id: string) {
    return this.inventoryService.deleteStockMovement(req, id);
  }

  // Reservations
  @Post('reservations')
  async reserveStock(@Request() req: any, @Body() reservationData: any) {
    return this.inventoryService.reserveStock(req, reservationData);
  }

  @Put('reservations/:id/release')
  async releaseReservation(@Request() req: any, @Param('id') reservationId: string) {
    return this.inventoryService.releaseReservation(req, reservationId);
  }

  // Alerts
  @Get('alerts')
  async getAlerts(@Request() req: any, @Query('acknowledged') acknowledged?: string) {
    const ack = acknowledged === 'true' ? true : acknowledged === 'false' ? false : undefined;
    return this.inventoryService.getAlerts(req, ack);
  }

  @Put('alerts/:id/acknowledge')
  async acknowledgeAlert(@Request() req: any, @Param('id') alertId: string) {
    return this.inventoryService.acknowledgeAlert(req, alertId);
  }

  @Post('alerts/send-email')
  async sendLowStockEmail(@Request() req: any, @Body() emailData: { recipientEmail: string }) {
    return this.inventoryService.sendLowStockEmail(req, emailData.recipientEmail);
  }

  @Post('alerts/check-low-stock')
  async checkAllLowStock(@Request() req: any) {
    return this.inventoryService.checkAllLowStock(req);
  }

  @Get('low-stock-planning')
  async getLowStockPlanning(@Request() req: any) {
    return this.inventoryService.getLowStockPlanning(req);
  }

  @Put('low-stock-planning/:itemId/ignore')
  @RequireUpdate('items')
  async ignoreLowStockItem(@Request() req: any, @Param('itemId') itemId: string, @Body() body: any) {
    return this.inventoryService.setLowStockPlanningIgnored(req, itemId, { ...body, ignored: true });
  }

  @Put('low-stock-planning/:itemId/restore')
  @RequireUpdate('items')
  async restoreLowStockItem(@Request() req: any, @Param('itemId') itemId: string, @Body() body: any) {
    return this.inventoryService.setLowStockPlanningIgnored(req, itemId, { ...body, ignored: false });
  }

  @Post('low-stock-planning/purchase')
  @RequireCreate('purchase_requisitions')
  async createLowStockPurchaseRequisitions(@Request() req: any, @Body() body: any) {
    return this.inventoryService.createLowStockPurchaseRequisitions(req, body);
  }

  @Post('alerts/check-job-orders')
  async checkJobOrderAlerts(@Request() req: any) {
    try {
      console.log('[Controller] checkJobOrderAlerts called');
      const result = await this.inventoryService.checkJobOrderAlerts(req);
      console.log('[Controller] checkJobOrderAlerts result:', result);
      return result;
    } catch (error) {
      console.error('[Controller] checkJobOrderAlerts error:', error);
      throw error;
    }
  }

  @Delete('alerts/:id')
  async deleteAlert(@Request() req: any, @Param('id') alertId: string) {
    return this.inventoryService.deleteAlert(req, alertId);
  }

  // Demo inventory
  @Get('demo')
  async getDemoInventory(@Request() req: any, @Query() filters: any) {
    return this.inventoryService.getDemoInventory(req, filters);
  }

  @Post('demo/issue')
  async issueDemoStock(@Request() req: any, @Body() demoData: any) {
    return this.inventoryService.issueDemoStock(req, demoData);
  }

  @Put('demo/:demoId/return')
  async returnDemoStock(@Request() req: any, @Param('demoId') demoId: string, @Body() returnData: any) {
    return this.inventoryService.returnDemoStock(req, demoId, returnData);
  }

  @Put('demo/:demoId/convert-to-sale')
  async convertDemoToSale(
    @Request() req: any,
    @Param('demoId') demoId: string,
    @Body() body: { sales_order_id: string }
  ) {
    return this.inventoryService.convertDemoToSale(req, demoId, body.sales_order_id);
  }

  @Delete('demo/:id')
  async deleteDemoItem(@Request() req: any, @Param('id') id: string) {
    return this.inventoryService.deleteDemoItem(req, id);
  }

  // Warehouses
  @Get('warehouses')
  async getWarehouses(@Request() req: any) {
    return this.inventoryService.getWarehouses(req);
  }

  @Post('warehouses')
  async createWarehouse(@Request() req: any, @Body() warehouseData: any) {
    return this.inventoryService.createWarehouse(req, warehouseData);
  }

  // Item Drawings/Documents
  @Get('items/:id/drawings')
  async getItemDrawings(@Request() req: any, @Param('id') itemId: string) {
    return this.itemsService.getDrawings(req.user.tenantId, itemId);
  }

  @Post('items/:id/drawings')
  async uploadItemDrawing(
    @Request() req: any,
    @Param('id') itemId: string,
    @Body() drawingData: any
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id;
    return this.itemsService.uploadDrawing(req.user.tenantId, userId, itemId, drawingData);
  }

  @Put('items/:id/drawings/:drawingId')
  async updateItemDrawing(
    @Request() req: any,
    @Param('id') itemId: string,
    @Param('drawingId') drawingId: string,
    @Body() drawingData: any
  ) {
    return this.itemsService.updateDrawing(req.user.tenantId, itemId, drawingId, drawingData);
  }

  @Post('items/:id/drawings/:drawingId/transition')
  async transitionItemDrawing(
    @Request() req: any,
    @Param('id') itemId: string,
    @Param('drawingId') drawingId: string,
    @Body() body: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id;
    return this.itemsService.transitionDrawing(req.user.tenantId, userId, itemId, drawingId, body?.action, body);
  }

  @Get('items/:id/drawings/:drawingId/impact')
  async getItemDrawingImpact(
    @Request() req: any,
    @Param('id') itemId: string,
    @Param('drawingId') drawingId: string,
  ) {
    return this.itemsService.getDrawingImpact(req.user.tenantId, itemId, drawingId);
  }

  @Delete('items/:id/drawings/:drawingId')
  async deleteItemDrawing(
    @Request() req: any,
    @Param('id') itemId: string,
    @Param('drawingId') drawingId: string
  ) {
    return this.itemsService.deleteDrawing(req.user.tenantId, itemId, drawingId);
  }

  // Item-Vendor Relationships
  @Get('items/:id/vendors')
  async getItemVendors(@Request() req: any, @Param('id') itemId: string) {
    return this.itemsService.getItemVendors(req.user.tenantId, itemId);
  }

  @Post('items/:id/vendors')
  async addItemVendor(@Request() req: any, @Param('id') itemId: string, @Body() body: any) {
    return this.itemsService.addItemVendor(req.user.tenantId, req.user.userId, itemId, body);
  }

  @Put('items/:id/vendors/:vendorId')
  async updateItemVendor(
    @Request() req: any,
    @Param('id') itemId: string,
    @Param('vendorId') vendorId: string,
    @Body() body: any
  ) {
    return this.itemsService.updateItemVendor(req.user.tenantId, req.user.userId, itemId, vendorId, body);
  }

  @Delete('items/:id/vendors/:vendorId')
  async deleteItemVendor(@Request() req: any, @Param('id') itemId: string, @Param('vendorId') vendorId: string) {
    return this.itemsService.deleteItemVendor(req.user.tenantId, itemId, vendorId);
  }
}
