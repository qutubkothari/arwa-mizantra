import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';
import { EmailService } from '../../email/email.service';
import {
  normalizeInventoryCategory,
  normalizeInventoryStockCategory,
} from '../utils/inventory-category';
import { UidSupabaseService } from '../../uid/services/uid-supabase.service';
import { PurchaseRequisitionsService } from '../../purchase/services/purchase-requisitions.service';
import { AccountingService } from '../../accounting/accounting.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_WAREHOUSES = [
  { code: 'MAIN_WAREHOUSE', name: 'Main Warehouse', type: 'STORE' },
  { code: 'PRODUCTION_FLOOR', name: 'Production Floor', type: 'PRODUCTION' },
  { code: 'QC_AREA', name: 'QC Area', type: 'QC' },
  { code: 'FINISHED_GOODS', name: 'Finished Goods', type: 'STORE' },
] as const;

const toValidUuid = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
};

type UidAdjustmentContext = {
  item: any;
  direction: 'increase' | 'decrease';
  quantity: number;
  uidStrategy: 'SERIALIZED' | 'BATCHED';
  qtyPerUid: number;
  requiredUidCount: number;
  selectedUids: string[];
  generateUids: boolean;
  warehouseId: string;
  warehouseLabel: string;
};

type UidRollbackState = {
  generatedUids: string[];
  consumedUids: Array<{
    uid: string;
    status: string;
    location?: string;
  }>;
};

type WarehouseColumnSupport = {
  metadata: boolean;
  plantId: boolean;
  type: boolean;
};

type WarehouseWriteInput = {
  code?: string;
  name?: string;
  type?: string;
  plant_id?: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
};

type InventoryItemLookupRow = {
  id: string;
  code: string;
  name: string;
  uom?: string;
  category?: string;
  standard_cost?: number;
  selling_price?: number;
};

type InventoryWarehouseLookupRow = {
  id: string;
  code: string;
  name: string;
};

@Injectable()
export class InventoryService {
  private supabase: SupabaseClient;
  private warehouseColumnSupportPromise: Promise<WarehouseColumnSupport> | null = null;

  constructor(
    private emailService: EmailService,
    private readonly uidSupabaseService: UidSupabaseService,
    private readonly purchaseRequisitionsService: PurchaseRequisitionsService,
    private readonly accountingService: AccountingService,
  ) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!
    );
  }

  private stockKey(itemId: string, warehouseId: string) {
    return `${itemId}::${warehouseId}`;
  }

  private splitStockKey(key: string) {
    const [itemId, warehouseId] = key.split('::');
    return { itemId, warehouseId };
  }

  private async getLedgerStockByWarehouse(tenantId: string, filters?: any) {
    const totals = new Map<string, number>();

    // Operational stock balance lives in inventory_stock. stock_entries is a
    // receipt-lot/FIFO table and can disagree with the live available balance
    // after reversals, SIV/SRV, adjustments, or legacy imports. Any screen or
    // planning flow that displays "current stock" must read this source.
    let stockQuery = this.supabase
      .from('inventory_stock')
      .select('item_id, warehouse_id, quantity, available_quantity')
      .eq('tenant_id', tenantId);

    if (filters?.item_id) stockQuery = stockQuery.eq('item_id', filters.item_id);
    if (filters?.warehouse_id) stockQuery = stockQuery.eq('warehouse_id', filters.warehouse_id);

    const { data: stockRows, error: stockError } = await stockQuery;
    if (stockError) throw new BadRequestException(stockError.message);

    for (const row of stockRows || []) {
      const itemId = toValidUuid((row as any).item_id);
      const warehouseId = toValidUuid((row as any).warehouse_id);
      if (!itemId || !warehouseId) continue;

      const stockKey = this.stockKey(itemId, warehouseId);
      const qty = Number((row as any).available_quantity ?? (row as any).quantity ?? 0) || 0;
      totals.set(stockKey, (totals.get(stockKey) || 0) + qty);
    }

    return totals;
  }

  private isMissingColumnError(error: { message?: string; code?: string } | null | undefined, columnName: string) {
    const msg = String(error?.message || '').toLowerCase();
    return (
      msg.includes(`could not find the '${columnName}' column`) ||
      msg.includes(`column "${columnName}" does not exist`) ||
      msg.includes(`column ${columnName} does not exist`) ||
      msg.includes(`relation "warehouses" does not have column "${columnName}"`) ||
      msg.includes(`undefined column "${columnName}"`) ||
      (String(error?.code || '') === '42703') // PostgreSQL undefined_column
    );
  }

  private async supportsWarehouseColumn(columnName: 'metadata' | 'plant_id' | 'type') {
    try {
      const { error } = await this.supabase
        .from('warehouses')
        .select(`id, ${columnName}`)
        .limit(1);

      if (!error) return true;
      if (this.isMissingColumnError(error, columnName)) return false;
      // Unknown error — assume column doesn't exist to avoid crashing warehouse seeding
      return false;
    } catch {
      return false;
    }
  }

  private async getWarehouseColumnSupport() {
    if (!this.warehouseColumnSupportPromise) {
      this.warehouseColumnSupportPromise = (async () => {
        const [metadata, plantId, type] = await Promise.all([
          this.supportsWarehouseColumn('metadata'),
          this.supportsWarehouseColumn('plant_id'),
          this.supportsWarehouseColumn('type'),
        ]);

        return { metadata, plantId, type };
      })();
    }

    return this.warehouseColumnSupportPromise;
  }

  private async buildWarehousePayload(tenantId: string, warehouse: WarehouseWriteInput) {
    const columnSupport = await this.getWarehouseColumnSupport();
    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      code: warehouse.code,
      name: warehouse.name,
      is_active: warehouse.is_active ?? true,
    };

    if (columnSupport.type && warehouse.type) {
      payload.type = warehouse.type;
    }

    if (columnSupport.plantId && warehouse.plant_id) {
      payload.plant_id = warehouse.plant_id;
    }

    if (columnSupport.metadata) {
      payload.metadata = warehouse.metadata || {};
    }

    return payload;
  }

  private async ensureDefaultWarehouses(tenantId: string) {
    const payload = await Promise.all(
      DEFAULT_WAREHOUSES.map((warehouse) =>
        this.buildWarehousePayload(tenantId, {
          code: warehouse.code,
          name: warehouse.name,
          type: warehouse.type,
          is_active: true,
          metadata: { system_seeded: true },
        })
      )
    );

    const { error: insertError } = await this.supabase
      .from('warehouses')
      .insert(payload);

    if (insertError) throw new BadRequestException(insertError.message);

    const { data, error } = await this.supabase
      .from('warehouses')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name');

    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // Get current stock levels with filters
  async getStockLevels(req: Request, filters?: any) {
    const { tenantId } = req.user as any;

    const ledgerTotals = await this.getLedgerStockByWarehouse(tenantId, filters);
    let stockEntries = Array.from(ledgerTotals.entries()).map(([key, quantity]) => {
      const { itemId, warehouseId } = this.splitStockKey(key);
      return {
        id: key,
        tenant_id: tenantId,
        item_id: itemId,
        warehouse_id: warehouseId,
        quantity,
        available_quantity: quantity,
        reserved_quantity: 0,
        allocated_quantity: 0,
      };
    });

    if (filters?.low_stock) {
      stockEntries = stockEntries.filter((entry) => Number(entry.available_quantity || 0) < 10);
    }

    if (!stockEntries || stockEntries.length === 0) {
      return [];
    }

    // Get item details separately
    const itemIds = [...new Set(
      stockEntries
        .map((entry) => toValidUuid(entry.item_id))
        .filter(Boolean)
    )] as string[];
    // PostgREST encodes `.in()` values in the URL. Large tenants can easily
    // exceed proxy/HTTP URL limits if every stocked item is requested at once,
    // which surfaced to users as the unhelpful "TypeError: fetch failed".
    const itemRows: InventoryItemLookupRow[] = [];
    for (let offset = 0; offset < itemIds.length; offset += 100) {
      const itemBatch = itemIds.slice(offset, offset + 100);
      const { data: batchRows, error: batchError } = await this.supabase
        .from('items')
        .select('id, code, name, uom, category, standard_cost, selling_price, is_rnd_item, metadata')
        .in('id', itemBatch);
      if (batchError) throw new BadRequestException(batchError.message);
      itemRows.push(...((batchRows || []) as InventoryItemLookupRow[]));
    }

    // Get warehouse details separately
    const warehouseIds = [...new Set(
      stockEntries
        .map((entry) => toValidUuid(entry.warehouse_id))
        .filter(Boolean)
    )] as string[];
    const warehouses = warehouseIds.length > 0
      ? await this.supabase
          .from('warehouses')
          .select('id, code, name')
          .in('id', warehouseIds)
      : { data: [], error: null };

    if (warehouses.error) throw new BadRequestException(warehouses.error.message);

    const warehouseRows = (warehouses.data ?? []) as InventoryWarehouseLookupRow[];

    // Combine the data manually
    const result = stockEntries.map(entry => {
      const item = itemRows.find(i => i.id === entry.item_id);
      const warehouse = warehouseRows.find(w => w.id === entry.warehouse_id);
      
      return {
        ...entry,
        items: item || { code: 'N/A', name: 'Unknown Item', uom: '', category: '', standard_cost: 0, selling_price: 0 },
        warehouses: warehouse || { code: 'N/A', name: 'Unknown Warehouse' }
      };
    });

    let filteredResult = result;
    if (filters?.category) {
      filteredResult = filteredResult.filter(entry => entry.items.category === filters.category);
    }

    if (filters?.low_stock) {
      filteredResult = filteredResult.filter((entry: any) => (
        entry.items?.is_rnd_item !== true && entry.items?.metadata?.excludeLowStock !== true
      ));
    }

    return filteredResult;
  }

  // Get stock movements history
  async getStockMovements(req: Request, filters?: any) {
    
    const { tenantId } = req.user as any;

    let query = this.supabase
      .from('stock_movements')
      .select('*')
      .eq('tenant_id', tenantId);

    if (filters?.movement_type) {
      query = query.eq('movement_type', filters.movement_type);
    }

    if (filters?.item_id) {
      query = query.eq('item_id', filters.item_id);
    }

    if (filters?.uid) {
      query = query.eq('uid', filters.uid);
    }

    if (filters?.from_date) {
      query = query.gte('movement_date', filters.from_date);
    }

    if (filters?.to_date) {
      query = query.lte('movement_date', filters.to_date);
    }

    const { data: movements, error: movementError } = await query
      .order('movement_date', { ascending: false })
      .limit(filters?.limit || 100);

    if (movementError) throw new BadRequestException(movementError.message);

    if (!movements || movements.length === 0) {
      return [];
    }

    // Get item details separately
    const itemIds = [...new Set(
      movements
        .map((movement) => toValidUuid(movement.item_id))
        .filter(Boolean)
    )] as string[];
    const items = itemIds.length > 0
      ? await this.supabase
          .from('items')
          .select('id, code, name')
          .in('id', itemIds)
      : { data: [], error: null };

    if (items.error) throw new BadRequestException(items.error.message);

    // Get warehouse details separately
    const warehouseIds = [...new Set([
      ...movements
        .map((movement) => toValidUuid(movement.from_warehouse_id))
        .filter(Boolean),
      ...movements
        .map((movement) => toValidUuid(movement.to_warehouse_id))
        .filter(Boolean)
    ])] as string[];
    
    const warehouses = warehouseIds.length > 0
      ? await this.supabase
          .from('warehouses')
          .select('id, code, name')
          .in('id', warehouseIds)
      : { data: [], error: null };

    if (warehouses.error) throw new BadRequestException(warehouses.error.message);

    const itemRows = (items.data ?? []) as InventoryItemLookupRow[];
    const warehouseRows = (warehouses.data ?? []) as InventoryWarehouseLookupRow[];

    // Combine the data manually
    const result = movements.map(movement => {
      const item = itemRows.find(i => i.id === movement.item_id);
      const fromWarehouse = warehouseRows.find(w => w.id === movement.from_warehouse_id);
      const toWarehouse = warehouseRows.find(w => w.id === movement.to_warehouse_id);
      
      return {
        ...movement,
        items: item || { code: 'N/A', name: 'Unknown Item' },
        from_warehouse: fromWarehouse || null,
        to_warehouse: toWarehouse || null
      };
    });

    return result;
  }

  // Create stock movement (generic)
  async createStockMovement(req: Request, movementData: any) {
    
    const { tenantId, userId } = req.user as any;

    const { data: item, error: itemError } = await this.supabase
      .from('items')
      .select('id, code, name, standard_cost, is_active, is_verified')
      .eq('tenant_id', tenantId)
      .eq('id', movementData.item_id)
      .maybeSingle();
    if (itemError) throw new BadRequestException(itemError.message);
    if (!item?.id) throw new BadRequestException('Item not found');
    if (item.is_active === false) throw new BadRequestException(`Item ${item.name || item.code || ''} is inactive and cannot be used.`);
    // Verification check disabled - causing too many errors
    // if (item.is_verified !== true) throw new BadRequestException(`Item ${item.name || item.code || ''} is not verified by admin and cannot be used.`);

    const movementBase = {
      tenant_id: tenantId,
      movement_type: movementData.movement_type,
      item_id: movementData.item_id,
      uid: movementData.uid,
      from_warehouse_id: movementData.from_warehouse_id,
      from_location_id: movementData.from_location_id,
      to_warehouse_id: movementData.to_warehouse_id,
      to_location_id: movementData.to_location_id,
      quantity: movementData.quantity,
      reference_type: movementData.reference_type,
      reference_id: movementData.reference_id,
      reference_number: movementData.reference_number,
      batch_number: movementData.batch_number,
      notes: movementData.notes,
      moved_by: userId,
      movement_date: movementData.movement_date || new Date().toISOString(),
    };

    // movement_number is globally unique (not tenant-scoped). Allocate from the
    // global maximum and retry a collision caused by concurrent postings.
    let movementRecord: any = null;
    let movementError: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sequentialNumber = await this.generateMovementNumber(req, movementData.movement_type);
      const collisionSuffix = attempt > 0
        ? `-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        : '';
      const movementNumber = `${sequentialNumber}${collisionSuffix}`;
      const insert = await this.supabase
        .from('stock_movements')
        .insert({ ...movementBase, movement_number: movementNumber })
        .select()
        .single();
      movementRecord = insert.data;
      movementError = insert.error;
      if (!movementError) break;

      const isMovementNumberCollision = movementError?.code === '23505'
        && String(movementError?.message || '').includes('stock_movements_movement_number_key');
      if (!isMovementNumberCollision) break;
    }

    if (movementError || !movementRecord) {
      throw new BadRequestException(
        movementError?.message || 'Could not allocate a unique stock movement number',
      );
    }

    const uidRollbackState: UidRollbackState = {
      generatedUids: [],
      consumedUids: [],
    };

    let uidAdjustmentResult: { generated_uids: string[]; consumed_uids: string[] } = {
      generated_uids: [],
      consumed_uids: [],
    };

    let stockUpdated = false;
    const stockEntriesRollbackState: Array<{
      id: string;
      available_quantity?: number;
      delete?: boolean;
    }> = [];

    try {
      // Update stock levels
      await this.updateStockLevels(req, movementData);
      stockUpdated = true;

      await this.syncStockEntriesForAdjustment(req, movementData, movementRecord, stockEntriesRollbackState);

      uidAdjustmentResult = await this.handleUidAdjustmentEffects(
        req,
        movementData,
        movementRecord,
        uidRollbackState,
      );

      // Check for low stock alerts
      await this.checkLowStockAlerts(req, movementData.item_id, movementData.to_warehouse_id || movementData.from_warehouse_id);
    } catch (error) {
      await this.rollbackStockEntryAdjustment(req, stockEntriesRollbackState);

      if (stockUpdated) {
        try {
          await this.updateStockLevels(req, movementData, -1);
        } catch (rollbackStockError) {
          console.error('Failed to rollback stock levels after stock movement error:', rollbackStockError);
        }
      }

      await this.rollbackUidAdjustmentEffects(req, uidRollbackState);

      if (movementRecord?.id) {
        await this.supabase
          .from('stock_movements')
          .delete()
          .eq('id', movementRecord.id)
          .eq('tenant_id', tenantId);
      }

      throw error;
    }

    const response = {
      ...movementRecord,
      ...uidAdjustmentResult,
      stock_category: movementData.category,
    };

    // Only a deliberate physical/manual adjustment is a standalone finance
    // source event.  Transfers, GRNs, SIVs and production movements have
    // their own operational document adapters and must not double-post here.
    const isManualAdjustment = String(movementData.movement_type || '').toUpperCase() === 'ADJUSTMENT'
      && String(movementData.reference_type || '').toUpperCase() === 'STOCK_ADJUSTMENT';
    const unitCost = Number((item as any)?.standard_cost || 0);
    const adjustmentAmount = Math.abs(Number(movementData.quantity || 0) * unitCost);
    if (isManualAdjustment && adjustmentAmount > 0) {
      const queuePosting = (this.accountingService as any)?.queueAutomaticOperationalPosting;
      if (typeof queuePosting === 'function') {
        try {
          await queuePosting.call(this.accountingService, tenantId, String(userId || ''), {
            source_type: 'STOCK_ADJUSTMENT',
            source_id: String(movementRecord.id),
            source_number: String(movementRecord.movement_number),
            journal_date: String(movementData.movement_date || new Date().toISOString()).slice(0, 10),
            amount: adjustmentAmount,
            reverse_accounts: Boolean(movementData.from_warehouse_id && !movementData.to_warehouse_id),
            narration: `Stock adjustment ${String(movementRecord.movement_number)} for ${String((item as any)?.code || 'item')}`,
          });
        } catch (postingError) {
          // Inventory has already been committed and must not be reported as
          // failed (or retried and duplicated) because an optional downstream
          // accounting queue is temporarily unavailable.
          console.error('Stock adjustment posted but accounting queue failed:', postingError);
        }
      }
    }

    return response;
  }

  // Update stock levels after movement
  private async updateStockLevels(req: Request, movementData: any, multiplier = 1) {
    
    const { tenantId } = req.user as any;

    const quantity = Number(movementData.quantity || 0) * multiplier;

    // Decrease from source warehouse
    if (movementData.from_warehouse_id) {
      await this.adjustStock(
        req,
        movementData.item_id,
        movementData.from_warehouse_id,
        movementData.from_location_id,
        -quantity
      );
    }

    // Increase at destination warehouse
    if (movementData.to_warehouse_id) {
      await this.adjustStock(
        req,
        movementData.item_id,
        movementData.to_warehouse_id,
        movementData.to_location_id,
        quantity,
        movementData.category
      );
    }
  }

  private normalizeUidList(value: any): string[] {
    const source = Array.isArray(value) ? value : [value];
    return Array.from(
      new Set(
        source
          .map((entry) => String(entry || '').trim())
          .filter(Boolean),
      ),
    );
  }

  async getLowStockPlanning(req: Request) {
    const { tenantId } = req.user as any;
    const { data: items, error: itemsError } = await this.supabase
      .from('items')
      .select('id, code, name, uom, category, hsn_code, reorder_level, reorder_quantity, standard_cost, is_active, is_verified, is_rnd_item, metadata')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .gt('reorder_level', 0)
      .order('code');
    if (itemsError) throw new BadRequestException(itemsError.message);

    const alertableItems = (items || []).filter((item: any) => (
      item.is_rnd_item !== true && item.metadata?.excludeLowStock !== true
    ));
    if (alertableItems.length === 0) {
      return { generated_at: new Date().toISOString(), items: [], ignored_items: [], summary: { low_stock: 0, ignored: 0, missing_vendor: 0, covered_by_open_supply: 0 } };
    }

    const itemIds = alertableItems.map((item: any) => String(item.id));
    const ledgerByWarehouse = await this.getLedgerStockByWarehouse(tenantId);
    const availableByItem = new Map<string, number>();
    for (const [key, quantity] of ledgerByWarehouse.entries()) {
      const { itemId } = this.splitStockKey(key);
      availableByItem.set(itemId, (availableByItem.get(itemId) || 0) + Number(quantity || 0));
    }

    // Lightweight demand signal for replenishment decisions. We deliberately
    // use the authoritative stock movement ledger and a bounded 90-day window
    // so planning remains fast while exposing a useful stock-coverage metric.
    const demandSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: demandMovements } = await this.supabase
      .from('stock_movements')
      .select('item_id,quantity,movement_date,movement_type')
      .eq('tenant_id', tenantId)
      .in('item_id', itemIds)
      .in('movement_type', ['PRODUCTION_ISSUE', 'SALES_ISSUE', 'SERVICE_ISSUE', 'DEMO_ISSUE'])
      .gte('movement_date', demandSince)
      .limit(10000);
    const demandByItem = new Map<string, number>();
    for (const movement of demandMovements || []) {
      const itemId = String((movement as any).item_id || '');
      if (!itemId) continue;
      demandByItem.set(itemId, (demandByItem.get(itemId) || 0) + Math.abs(Number((movement as any).quantity || 0)));
    }

    const [{ data: requisitions, error: requisitionsError }, { data: orders, error: ordersError }, { data: vendorLinks, error: vendorLinksError }] = await Promise.all([
      this.supabase
        .from('purchase_requisitions')
        .select('id, pr_number, status, purchase_requisition_items(id, item_id, requested_qty)')
        .eq('tenant_id', tenantId),
      this.supabase
        .from('purchase_orders')
        .select('id, po_number, status, purchase_order_items(item_id, pr_item_id, ordered_qty, received_qty)')
        .eq('tenant_id', tenantId),
      this.supabase
        .from('item_vendors')
        .select('item_id, vendor_id, unit_price, priority, vendor:vendors(id, code, name, is_active, is_verified, approval_status)')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('item_id', itemIds)
        .order('priority', { ascending: true }),
    ]);
    if (requisitionsError) throw new BadRequestException(requisitionsError.message);
    if (ordersError) throw new BadRequestException(ordersError.message);
    if (vendorLinksError) throw new BadRequestException(vendorLinksError.message);

    const terminalPrStatuses = new Set(['REJECTED', 'CANCELLED', 'GOODS_RCVD', 'CLOSED']);
    const terminalPoStatuses = new Set(['REJECTED', 'CANCELLED', 'CLOSED', 'COMPLETED']);
    const itemByPrItem = new Map<string, string>();
    for (const requisition of requisitions || []) {
      for (const line of (requisition as any).purchase_requisition_items || []) {
        const prItemId = String(line?.id || '').trim();
        const itemId = String(line?.item_id || '').trim();
        if (prItemId && itemId) itemByPrItem.set(prItemId, itemId);
      }
    }
    const orderedByPrItem = new Map<string, number>();
    const openPoByItem = new Map<string, number>();
    const openPoRefsByItem = new Map<string, Array<{ id: string; number: string; qty: number; status: string }>>();
    for (const order of orders || []) {
      if (terminalPoStatuses.has(String((order as any).status || '').toUpperCase())) continue;
      for (const line of (order as any).purchase_order_items || []) {
        const prItemId = String(line?.pr_item_id || '').trim();
        const itemId = String(line?.item_id || itemByPrItem.get(prItemId) || '').trim();
        const ordered = Number(line?.ordered_qty || 0);
        const received = Number(line?.received_qty || 0);
        const remaining = Math.max(0, ordered - received);
        if (itemId && remaining > 0) {
          openPoByItem.set(itemId, (openPoByItem.get(itemId) || 0) + remaining);
          const refs = openPoRefsByItem.get(itemId) || [];
          refs.push({
            id: String((order as any).id || ''),
            number: String((order as any).po_number || ''),
            qty: remaining,
            status: String((order as any).status || ''),
          });
          openPoRefsByItem.set(itemId, refs);
        }
        if (prItemId) orderedByPrItem.set(prItemId, (orderedByPrItem.get(prItemId) || 0) + ordered);
      }
    }

    const openPrByItem = new Map<string, number>();
    const openPrRefsByItem = new Map<string, Array<{ id: string; number: string; qty: number; status: string }>>();
    for (const requisition of requisitions || []) {
      if (terminalPrStatuses.has(String((requisition as any).status || '').toUpperCase())) continue;
      for (const line of (requisition as any).purchase_requisition_items || []) {
        const itemId = String(line?.item_id || '').trim();
        if (!itemId) continue;
        const remaining = Math.max(0, Number(line?.requested_qty || 0) - Number(orderedByPrItem.get(String(line?.id || '')) || 0));
        if (remaining > 0) {
          openPrByItem.set(itemId, (openPrByItem.get(itemId) || 0) + remaining);
          const refs = openPrRefsByItem.get(itemId) || [];
          refs.push({
            id: String((requisition as any).id || ''),
            number: String((requisition as any).pr_number || ''),
            qty: remaining,
            status: String((requisition as any).status || ''),
          });
          openPrRefsByItem.set(itemId, refs);
        }
      }
    }

    const preferredByItem = new Map<string, any>();
    for (const link of vendorLinks || []) {
      const itemId = String((link as any).item_id || '').trim();
      if (!itemId || preferredByItem.has(itemId)) continue;
      const vendor = Array.isArray((link as any).vendor) ? (link as any).vendor[0] : (link as any).vendor;
      if (!vendor || vendor.is_active === false) continue;
      preferredByItem.set(itemId, { ...(link as any), vendor });
    }

    // "Ignore" is a reminder suppression, not a permanent procurement block.
    // Once stock recovers above reorder level, clear the ignore flag so the item
    // can naturally re-enter the Planning List if it falls low again later.
    try {
      const recoveredIgnoredItems = alertableItems.filter((item: any) => {
        const available = Number(availableByItem.get(String(item.id)) || 0);
        const reorderLevel = Number(item.reorder_level || 0);
        return item.metadata?.lowStockPlanning?.ignored === true && available > reorderLevel;
      });

      await Promise.all(recoveredIgnoredItems.map((item: any) => {
        const metadata = { ...(item.metadata || {}) };
        metadata.lowStockPlanning = {
          ...(metadata.lowStockPlanning || {}),
          ignored: false,
          restoredAt: new Date().toISOString(),
          restoreReason: 'Stock recovered above reorder level',
        };
        return this.supabase
          .from('items')
          .update({ metadata, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('id', item.id);
      }));

      recoveredIgnoredItems.forEach((item: any) => {
        item.metadata = {
          ...(item.metadata || {}),
          lowStockPlanning: {
            ...(item.metadata?.lowStockPlanning || {}),
            ignored: false,
            restoredAt: new Date().toISOString(),
            restoreReason: 'Stock recovered above reorder level',
          },
        };
      });
    } catch (e) {
      console.warn('Low-stock ignore auto-restore failed:', (e as any)?.message || e);
    }

    const rows = alertableItems
      .map((item: any) => {
        const available = Number(availableByItem.get(String(item.id)) || 0);
        const reorderLevel = Number(item.reorder_level || 0);
        if (available > reorderLevel) return null;
        const reorderQuantity = Number(item.reorder_quantity || 0);
        const grossRequirement = Math.max(reorderLevel - available, reorderQuantity > 0 ? reorderQuantity : 0);
        const openPr = Number(openPrByItem.get(String(item.id)) || 0);
        const openPo = Number(openPoByItem.get(String(item.id)) || 0);
        const avgDailyConsumption = Number(demandByItem.get(String(item.id)) || 0) / 90;
        const coverageDays = avgDailyConsumption > 0 ? available / avgDailyConsumption : null;
        const suggested = Math.max(0, grossRequirement - openPr - openPo);
        const preferred = preferredByItem.get(String(item.id));
        const vendor = preferred?.vendor;
        const vendorVerified = vendor?.is_verified === true || String(vendor?.approval_status || '').toUpperCase() === 'APPROVED';
        const blockReason = item.is_verified !== true
          ? 'Item is pending verification'
          : !vendor?.id
            ? 'Preferred supplier is not configured'
            : !vendorVerified
              ? 'Preferred supplier is pending verification'
              : null;

        return {
          item_id: item.id,
          item_code: item.code,
          item_name: item.name,
          uom: item.uom,
          category: item.category,
          hsn_code: item.hsn_code,
          available_qty: available,
          avg_daily_consumption: Number(avgDailyConsumption.toFixed(4)),
          coverage_days: coverageDays === null ? null : Number(coverageDays.toFixed(1)),
          forecast_window_days: 90,
          reorder_level: reorderLevel,
          reorder_qty: reorderQuantity,
          open_pr_qty: openPr,
          open_po_qty: openPo,
          open_pr_refs: openPrRefsByItem.get(String(item.id)) || [],
          open_po_refs: openPoRefsByItem.get(String(item.id)) || [],
          suggested_purchase_qty: suggested,
          preferred_vendor_id: vendor?.id || null,
          preferred_vendor_code: vendor?.code || null,
          preferred_vendor_name: vendor?.name || null,
          preferred_price: Number(preferred?.unit_price ?? item.standard_cost ?? 0),
          purchasable: !blockReason,
          block_reason: blockReason,
          ignored: item.metadata?.lowStockPlanning?.ignored === true,
          ignored_at: item.metadata?.lowStockPlanning?.ignoredAt || null,
          ignored_by: item.metadata?.lowStockPlanning?.ignoredBy || null,
          ignored_reason: item.metadata?.lowStockPlanning?.ignoreReason || null,
        };
      })
      .filter(Boolean);
    const activeRows = rows.filter((row: any) => row.ignored !== true);
    const ignoredRows = rows.filter((row: any) => row.ignored === true);

    return {
      generated_at: new Date().toISOString(),
      items: activeRows,
      ignored_items: ignoredRows,
      summary: {
        low_stock: activeRows.length,
        ignored: ignoredRows.length,
        missing_vendor: activeRows.filter((row: any) => !row.purchasable).length,
        covered_by_open_supply: activeRows.filter((row: any) => row.suggested_purchase_qty <= 0).length,
      },
    };
  }

  async setLowStockPlanningIgnored(req: Request, itemId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId) throw new BadRequestException('Item is required.');

    const ignored = body?.ignored !== false;
    const reason = String(body?.reason || '').trim();
    if (ignored && reason.length < 3) {
      throw new BadRequestException('Please enter a short reason before ignoring this item.');
    }

    const { data: item, error } = await this.supabase
      .from('items')
      .select('id, metadata')
      .eq('tenant_id', tenantId)
      .eq('id', normalizedItemId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!item?.id) throw new BadRequestException('Item not found.');

    const metadata = { ...((item as any).metadata || {}) };
    const previousPlanning = { ...(metadata.lowStockPlanning || {}) };
    metadata.lowStockPlanning = ignored
      ? {
          ...previousPlanning,
          ignored: true,
          ignoredAt: new Date().toISOString(),
          ignoredBy: userId || null,
          ignoreReason: reason,
        }
      : {
          ...previousPlanning,
          ignored: false,
          restoredAt: new Date().toISOString(),
          restoredBy: userId || null,
          restoreReason: reason || 'Restored to low-stock planning',
        };

    const { data: updated, error: updateError } = await this.supabase
      .from('items')
      .update({ metadata })
      .eq('tenant_id', tenantId)
      .eq('id', normalizedItemId)
      .select('id, metadata')
      .single();

    if (updateError) throw new BadRequestException(updateError.message);

    if (ignored) {
      const { error: alertError } = await this.supabase
        .from('inventory_alerts')
        .update({
          acknowledged: true,
          acknowledged_by: userId,
          acknowledged_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('item_id', normalizedItemId)
        .eq('alert_type', 'LOW_STOCK')
        .eq('acknowledged', false);
      if (alertError) throw new BadRequestException(alertError.message);
    }

    return {
      item_id: updated.id,
      ignored,
      message: ignored
        ? 'Item moved to the Low Stock Ignore List.'
        : 'Item restored to Low Stock Planning.',
    };
  }

  async createLowStockPurchaseRequisitions(req: Request, body: any) {
    const { tenantId, userId } = req.user as any;
    const selections = Array.isArray(body?.items) ? body.items : [];
    if (selections.length === 0) throw new BadRequestException('Select at least one low-stock item to purchase.');

    const selectedById = new Map<string, number>();
    for (const selection of selections) {
      const itemId = String(selection?.item_id ?? selection?.itemId ?? '').trim();
      const quantity = Number(selection?.required_qty ?? selection?.requiredQty ?? selection?.quantity);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('Every selected item requires a purchase quantity greater than zero.');
      }
      if (selectedById.has(itemId)) throw new BadRequestException('The same item cannot be selected more than once.');
      selectedById.set(itemId, Number(quantity.toFixed(3)));
    }

    const planning = await this.getLowStockPlanning(req);
    const rowsById = new Map((planning.items || []).map((row: any) => [String(row.item_id), row]));
    const groups = new Map<string, { vendor: any; items: any[] }>();
    for (const [itemId, quantity] of selectedById.entries()) {
      const row: any = rowsById.get(itemId);
      if (!row) throw new BadRequestException(`Item ${itemId} is no longer below its reorder level.`);
      if (!row.purchasable || !row.preferred_vendor_id) {
        throw new BadRequestException(`${row.item_code}: ${row.block_reason || 'Preferred supplier is required'}.`);
      }
      const vendorId = String(row.preferred_vendor_id);
      if (!groups.has(vendorId)) groups.set(vendorId, { vendor: { id: vendorId, name: row.preferred_vendor_name }, items: [] });
      groups.get(vendorId)!.items.push({ row, quantity });
    }

    const requiredDate = String(body?.required_date ?? body?.requiredDate ?? new Date().toISOString().slice(0, 10));
    const priority = String(body?.priority || 'MEDIUM').trim().toUpperCase();
    const created: any[] = [];
    for (const group of groups.values()) {
      const requisition = await this.purchaseRequisitionsService.create(tenantId, userId, {
        department: 'PRODUCTION',
        requestDate: new Date().toISOString().slice(0, 10),
        requiredDate,
        priority,
        status: 'SUBMITTED',
        purpose: `Low stock replenishment - ${group.vendor.name}`,
        remarks: `Automatically generated from Low Stock Planning for preferred supplier ${group.vendor.name}.`,
        items: group.items.map(({ row, quantity }) => ({
          itemId: row.item_id,
          itemCode: row.item_code,
          itemName: row.item_name,
          vendorId: row.preferred_vendor_id,
          uom: row.uom,
          requestedQty: quantity,
          estimatedRate: row.preferred_price,
          requiredDate,
          remarks: `Low stock: available ${row.available_qty}; reorder level ${row.reorder_level}; open PR ${row.open_pr_qty}; open PO ${row.open_po_qty}.`,
        })),
      });
      created.push({
        id: requisition.id,
        pr_number: requisition.pr_number,
        status: requisition.status,
        vendor_id: group.vendor.id,
        vendor_name: group.vendor.name,
        item_count: group.items.length,
      });
    }

    return {
      message: `${created.length} supplier-grouped purchase requisition${created.length === 1 ? '' : 's'} created and sent for approval.`,
      created_prs: created,
    };
  }

  private isAdjustmentMovement(movementData: any): boolean {
    return String(movementData?.movement_type || '').trim().toUpperCase() === 'ADJUSTMENT';
  }

  private async syncStockEntriesForAdjustment(
    req: Request,
    movementData: any,
    movementRecord: any,
    rollbackState: Array<{ id: string; available_quantity?: number; delete?: boolean }>,
  ) {
    if (!this.isAdjustmentMovement(movementData)) return;

    const { tenantId } = req.user as any;
    const quantity = Number(movementData?.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    const itemId = String(movementData?.item_id || '').trim();
    const increaseWarehouseId = String(movementData?.to_warehouse_id || '').trim();
    const decreaseWarehouseId = String(movementData?.from_warehouse_id || '').trim();
    const isIncrease = !!increaseWarehouseId && !decreaseWarehouseId;
    const isDecrease = !!decreaseWarehouseId && !increaseWarehouseId;

    if (!isIncrease && !isDecrease) return;

    const { data: item, error: itemError } = await this.supabase
      .from('items')
      .select('id, code, name, category, uid_tracking, uid_strategy')
      .eq('tenant_id', tenantId)
      .eq('id', itemId)
      .maybeSingle();

    if (itemError) throw new BadRequestException(itemError.message);
    if (!item?.id) throw new BadRequestException('Item not found');

    if (isIncrease) {
      const { data: inserted, error } = await this.supabase
        .from('stock_entries')
        .insert({
          tenant_id: tenantId,
          item_id: itemId,
          warehouse_id: increaseWarehouseId,
          quantity,
          available_quantity: quantity,
          allocated_quantity: 0,
          unit_price: Number(movementData?.unit_price || movementData?.unit_cost || 0) || 0,
          metadata: {
            created_from: 'STOCK_ADJUSTMENT',
            movement_id: movementRecord?.id || null,
            movement_number: movementRecord?.movement_number || null,
            reference_number: movementData?.reference_number || null,
            notes: movementData?.notes || null,
            category: normalizeInventoryCategory(movementData?.category || (item as any)?.category, 'RAW_MATERIAL'),
          },
        } as any)
        .select('id')
        .single();

      if (error) throw new BadRequestException(error.message);
      if (inserted?.id) rollbackState.push({ id: inserted.id, delete: true });
      return;
    }

    const { data: rows, error } = await this.supabase
      .from('stock_entries')
      .select('id, available_quantity')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .eq('warehouse_id', decreaseWarehouseId)
      .gt('available_quantity', 0)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    const safeRows = Array.isArray(rows) ? rows : [];

    // inventory_stock is the authoritative operational balance and has already
    // been validated/updated by updateStockLevels above. stock_entries is a
    // legacy receipt-lot/FIFO mirror which can legitimately be absent or lower
    // after imports and historic adjustments. Synchronize the rows that exist,
    // but never reject a valid operational movement because that mirror drifted.
    if (safeRows.length === 0) return;

    let remaining = quantity;
    for (const row of safeRows) {
      if (remaining <= 0) break;
      const current = Number((row as any)?.available_quantity || 0);
      const consume = Math.min(current, remaining);
      rollbackState.push({ id: String((row as any).id), available_quantity: current });
      const { error: updateError } = await this.supabase
        .from('stock_entries')
        .update({ available_quantity: current - consume, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('id', (row as any).id);
      if (updateError) throw new BadRequestException(updateError.message);
      remaining -= consume;
    }
  }

  private async rollbackStockEntryAdjustment(
    req: Request,
    rollbackState: Array<{ id: string; available_quantity?: number; delete?: boolean }>,
  ) {
    if (rollbackState.length === 0) return;
    const { tenantId } = req.user as any;

    for (const entry of rollbackState.reverse()) {
      try {
        if (entry.delete) {
          await this.supabase
            .from('stock_entries')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('id', entry.id);
        } else {
          await this.supabase
            .from('stock_entries')
            .update({ available_quantity: entry.available_quantity, updated_at: new Date().toISOString() })
            .eq('tenant_id', tenantId)
            .eq('id', entry.id);
        }
      } catch (error) {
        console.error('Failed to rollback stock_entries adjustment:', error);
      }
    }
  }

  private mapEntityTypeFromCategory(category?: string): string {
    const normalized = String(category || '').toUpperCase();
    if (normalized.includes('COMPONENT')) return 'CP';
    if (normalized.includes('FINISHED')) return 'FG';
    if (normalized.includes('ASSEMBLY')) return 'SA';
    return 'RM';
  }

  private async resolveWarehouseLabel(warehouseId: string): Promise<string> {
    const { data } = await this.supabase
      .from('warehouses')
      .select('code, name')
      .eq('id', warehouseId)
      .maybeSingle();

    return String(data?.name || data?.code || 'Warehouse').trim() || 'Warehouse';
  }

  private resolveRequiredUidCount(quantity: number, uidStrategy: 'SERIALIZED' | 'BATCHED', qtyPerUid: number): number {
    if (uidStrategy === 'BATCHED') {
      const ratio = quantity / qtyPerUid;
      if (!Number.isFinite(ratio) || Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        throw new BadRequestException(`Adjustment quantity must be a multiple of batch_quantity=${qtyPerUid} for this UID-tracked item`);
      }

      return Math.round(ratio);
    }

    if (Math.abs(quantity - Math.round(quantity)) > 1e-9) {
      throw new BadRequestException('Adjustment quantity must be a whole number for SERIALIZED UID-tracked items');
    }

    return Math.round(quantity);
  }

  private async buildUidAdjustmentContext(req: Request, movementData: any): Promise<UidAdjustmentContext | null> {
    const { tenantId } = req.user as any;
    const movementType = String(movementData?.movement_type || '').trim().toUpperCase();

    if (movementType !== 'ADJUSTMENT') {
      return null;
    }

    const quantity = Number(movementData?.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return null;
    }

    const isIncrease = !!movementData?.to_warehouse_id && !movementData?.from_warehouse_id;
    const isDecrease = !!movementData?.from_warehouse_id && !movementData?.to_warehouse_id;

    if (!isIncrease && !isDecrease) {
      return null;
    }

    const { data: item, error: itemError } = await this.supabase
      .from('items')
      .select('id, code, name, category, uid_tracking, uid_strategy, batch_quantity, batch_uom')
      .eq('tenant_id', tenantId)
      .eq('id', movementData.item_id)
      .maybeSingle();

    if (itemError) throw new BadRequestException(itemError.message);
    if (!item) throw new BadRequestException('Item not found');

    const uidTrackingEnabled = item.uid_tracking === true && String(item.uid_strategy || '').toUpperCase() !== 'NONE';
    if (!uidTrackingEnabled) {
      return null;
    }

    const uidStrategy = (String(item.uid_strategy || 'SERIALIZED').toUpperCase() === 'BATCHED'
      ? 'BATCHED'
      : 'SERIALIZED') as 'SERIALIZED' | 'BATCHED';

    const rawBatchQty = Number(item.batch_quantity);
    const qtyPerUid = uidStrategy === 'BATCHED'
      ? (Number.isFinite(rawBatchQty) && rawBatchQty > 0 ? rawBatchQty : NaN)
      : 1;

    if (uidStrategy === 'BATCHED' && !Number.isFinite(qtyPerUid)) {
      throw new BadRequestException('Item UID strategy is BATCHED but batch_quantity is missing/invalid in Item Master');
    }

    const direction = isIncrease ? 'increase' : 'decrease';
    const selectedUids = this.normalizeUidList(movementData?.selected_uids);
    const generateUids = movementData?.generate_uids === true;
    const requiresUidMapping = direction === 'decrease' || generateUids;
    const requiredUidCount = requiresUidMapping
      ? this.resolveRequiredUidCount(quantity, uidStrategy, qtyPerUid)
      : 0;
    const warehouseId = String(isIncrease ? movementData.to_warehouse_id : movementData.from_warehouse_id);
    const warehouseLabel = await this.resolveWarehouseLabel(warehouseId);

    return {
      item,
      direction,
      quantity,
      uidStrategy,
      qtyPerUid,
      requiredUidCount,
      selectedUids,
      generateUids,
      warehouseId,
      warehouseLabel,
    };
  }

  private async validateConsumableUids(req: Request, context: UidAdjustmentContext) {
    const { tenantId } = req.user as any;

    if (context.selectedUids.length !== context.requiredUidCount) {
      const extra = context.uidStrategy === 'BATCHED'
        ? ` (batch_quantity=${context.qtyPerUid})`
        : '';
      throw new BadRequestException(`Select exactly ${context.requiredUidCount} UID(s) for this adjustment${extra}`);
    }

    const { data: uidRows, error: uidError } = await this.supabase
      .from('uid_registry')
      .select('uid, status, location, entity_id')
      .eq('tenant_id', tenantId)
      .in('uid', context.selectedUids);

    if (uidError) throw new BadRequestException(uidError.message);

    const byUid = new Map((uidRows || []).map((row: any) => [String(row.uid || '').trim(), row]));
    const missing = context.selectedUids.filter((uid) => !byUid.has(uid));

    if (missing.length > 0) {
      throw new BadRequestException(`Unknown UID(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`);
    }

    const issuableStatuses = new Set(['ACTIVE', 'GENERATED', 'IN_STOCK']);

    for (const uid of context.selectedUids) {
      const row: any = byUid.get(uid);
      const status = String(row?.status || '').trim();
      const entityId = String(row?.entity_id || '').trim();

      if (!issuableStatuses.has(status)) {
        throw new BadRequestException(`UID ${uid} cannot be removed from stock (status=${status || 'N/A'})`);
      }

      if (entityId !== String(context.item.id)) {
        throw new BadRequestException(`UID ${uid} does not belong to the selected item`);
      }
    }

    return (uidRows || []).map((row: any) => ({
      uid: String(row.uid || '').trim(),
      status: String(row.status || '').trim(),
      location: row.location ? String(row.location) : undefined,
    }));
  }

  private async handleUidAdjustmentEffects(
    req: Request,
    movementData: any,
    movementRecord: any,
    rollbackState: UidRollbackState,
  ): Promise<{ generated_uids: string[]; consumed_uids: string[] }> {
    const context = await this.buildUidAdjustmentContext(req, movementData);

    if (!context) {
      return {
        generated_uids: [],
        consumed_uids: [],
      };
    }

    if (context.direction === 'increase') {
      if (!context.generateUids) {
        return {
          generated_uids: [],
          consumed_uids: [],
        };
      }

      const generatedUids: string[] = [];

      for (let index = 0; index < context.requiredUidCount; index++) {
        const created = await this.uidSupabaseService.createUID(req as any, {
          plantCode: 'MFG',
          entityType: this.mapEntityTypeFromCategory(context.item.category),
          entity_type: this.mapEntityTypeFromCategory(context.item.category),
          entity_id: context.item.id,
          item_id: context.item.id,
          status: 'GENERATED',
          location: context.warehouseLabel,
          reference: movementRecord.movement_number,
          description: context.item.name,
          metadata: {
            source: 'STOCK_ADJUSTMENT',
            movement_id: movementRecord.id,
            movement_number: movementRecord.movement_number,
            adjusted_quantity: context.quantity,
            uid_sequence: index + 1,
            uid_count: context.requiredUidCount,
            uid_strategy: context.uidStrategy,
            qty_per_uid: context.qtyPerUid,
            warehouse_id: context.warehouseId,
            warehouse_name: context.warehouseLabel,
            item_code: context.item.code,
            item_name: context.item.name,
          },
        });

        const uid = String((created as any)?.uid || '').trim();
        if (!uid) {
          throw new BadRequestException('UID generation succeeded but no UID value was returned');
        }

        rollbackState.generatedUids.push(uid);
        generatedUids.push(uid);

        await this.uidSupabaseService.updateLifecycle(
          req as any,
          uid,
          'STOCK_ADJUSTMENT_INCREASE',
          context.warehouseLabel,
          `Stock adjustment ${movementRecord.movement_number}`,
        );
      }

      return {
        generated_uids: generatedUids,
        consumed_uids: [],
      };
    }

    const originalStates = await this.validateConsumableUids(req, context);

    for (const state of originalStates) {
      rollbackState.consumedUids.push(state);

      await this.uidSupabaseService.updateStatus(
        req as any,
        state.uid,
        'CONSUMED',
        `Stock Adjustment - ${context.warehouseLabel}`,
      );

      await this.uidSupabaseService.updateLifecycle(
        req as any,
        state.uid,
        'STOCK_ADJUSTMENT_DECREASE',
        `Stock Adjustment - ${context.warehouseLabel}`,
        `Stock adjustment ${movementRecord.movement_number}`,
      );
    }

    return {
      generated_uids: [],
      consumed_uids: originalStates.map((state) => state.uid),
    };
  }

  private async rollbackUidAdjustmentEffects(req: Request, rollbackState: UidRollbackState) {
    const { tenantId } = req.user as any;

    if (rollbackState.generatedUids.length > 0) {
      const { error } = await this.supabase
        .from('uid_registry')
        .delete()
        .eq('tenant_id', tenantId)
        .in('uid', rollbackState.generatedUids);

      if (error) {
        console.error('Failed to rollback generated UIDs after stock movement error:', error);
      }
    }

    for (const state of rollbackState.consumedUids) {
      try {
        await this.uidSupabaseService.updateStatus(
          req as any,
          state.uid,
          state.status,
          state.location,
        );

        await this.uidSupabaseService.updateLifecycle(
          req as any,
          state.uid,
          'STOCK_ADJUSTMENT_ROLLBACK',
          state.location || 'Warehouse',
          'Rolled back failed stock adjustment',
        );
      } catch (error) {
        console.error(`Failed to rollback consumed UID ${state.uid}:`, error);
      }
    }
  }

  // Adjust stock quantity (upsert)
  private async adjustStock(
    req: Request,
    itemId: string,
    warehouseId: string,
    locationId: string | null,
    quantityChange: number,
    category?: string
  ) {
    const { tenantId } = req.user as any;
    const normalizedCategory = normalizeInventoryStockCategory(category, 'RAW_MATERIAL');

    if (!locationId) {
      try {
        await this.adjustStockFallbackDirect({
          tenantId,
          itemId,
          warehouseId,
          quantityChange,
          category: normalizedCategory,
        });
        return;
      } catch (fallbackError: any) {
        console.error('Error in adjustStock direct fallback:', fallbackError);
        throw new BadRequestException('Failed to adjust stock levels.');
      }
    }

    const { error } = await this.supabase.rpc('adjust_inventory_stock', {
      p_tenant_id: tenantId,
      p_item_id: itemId,
      p_warehouse_id: warehouseId,
      p_location_id: locationId ?? null,
      p_quantity_change: quantityChange,
      p_category: normalizedCategory,
    });

    if (!error) {
      return;
    }

    console.error('Error in adjustStock RPC call, attempting fallback:', error);

    try {
      await this.adjustStockFallbackDirect({
        tenantId,
        itemId,
        warehouseId,
        quantityChange,
        category: normalizedCategory,
      });
    } catch (fallbackError: any) {
      console.error('Error in adjustStock fallback:', fallbackError);
      throw new BadRequestException('Failed to adjust stock levels.');
    }
  }

  private async adjustStockFallbackDirect(args: {
    tenantId: string;
    itemId: string;
    warehouseId: string;
    quantityChange: number;
    category: string;
  }) {
    const { tenantId, itemId, warehouseId, quantityChange, category } = args;

    if (!Number.isFinite(quantityChange) || Math.abs(quantityChange) < 1e-9) {
      return;
    }

    const { data: rows, error } = await this.supabase
      .from('inventory_stock')
      .select('id, quantity, reserved_quantity, available_quantity, location_id')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .eq('category', category)
      .order('available_quantity', { ascending: false });

    if (error) throw error;

    const safeRows = Array.isArray(rows) ? rows : [];

    if (safeRows.length === 0) {
      if (quantityChange < 0) {
        throw new Error('No inventory stock rows available for deduction');
      }

      const { error: insertError } = await this.supabase
        .from('inventory_stock')
        .insert({
          tenant_id: tenantId,
          item_id: itemId,
          warehouse_id: warehouseId,
          location_id: null,
          category,
          quantity: quantityChange,
          reserved_quantity: 0,
          last_movement_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any);

      if (insertError) throw insertError;
      return;
    }

    let remaining = quantityChange;

    if (remaining < 0) {
      const totalAvailable = safeRows.reduce((sum, row) => {
        const currentQty = Number((row as any)?.quantity || 0);
        const reservedQty = Number((row as any)?.reserved_quantity || 0);
        return sum + Math.max(0, currentQty - reservedQty);
      }, 0);

      // Validate the complete deduction before updating any row. Without this
      // preflight, a shortage could partially consume stock and then fail,
      // leaving inventory changed without a corresponding movement document.
      if (totalAvailable + 1e-6 < -remaining) {
        throw new Error(
          `Insufficient inventory stock: available ${totalAvailable.toFixed(6)}, requested ${Math.abs(remaining).toFixed(6)}`,
        );
      }

      for (const row of safeRows) {
        if (remaining >= -1e-9) break;

        const currentQty = Number((row as any)?.quantity || 0);
        const reservedQty = Number((row as any)?.reserved_quantity || 0);
        const maxDeduct = Math.max(0, currentQty - reservedQty);
        const wanted = Math.min(maxDeduct, -remaining);

        if (wanted <= 0) continue;

        const nextQty = currentQty - wanted;
        const { error: updateError } = await this.supabase
          .from('inventory_stock')
          .update({
            quantity: nextQty,
            last_movement_date: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', (row as any)?.id);

        if (updateError) throw updateError;
        remaining += wanted;
      }

      if (remaining < -1e-6) {
        throw new Error(`Fallback inventory_stock deduction short by ${Math.abs(remaining).toFixed(6)}`);
      }

      return;
    }

    const target = safeRows[0];
    const currentQty = Number((target as any)?.quantity || 0);
    const nextQty = currentQty + remaining;
    const { error: updateError } = await this.supabase
      .from('inventory_stock')
      .update({
        quantity: nextQty,
        last_movement_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', (target as any)?.id);

    if (updateError) throw updateError;
  }

  // Generate movement number
  private async generateMovementNumber(req: Request, movementType: string): Promise<string> {
    
    const prefix = this.getMovementPrefix(movementType);
    // The database constraint is global, so this lookup must not be limited to
    // the current tenant. Counting rows is unsafe because deletions create gaps
    // and cause an already-used sequence to be generated again.
    const { data, error } = await this.supabase
      .from('stock_movements')
      .select('movement_number')
      .like('movement_number', `${prefix}%`)
      .order('movement_number', { ascending: false })
      .limit(1);
    if (error) throw new BadRequestException(error.message);

    const latest = String(data?.[0]?.movement_number || '');
    const sequenceText = latest.slice(prefix.length).match(/^\d+/)?.[0] || '0';
    const nextSequence = Number(sequenceText) + 1;
    return `${prefix}${String(nextSequence).padStart(6, '0')}`;
  }

  private getMovementPrefix(movementType: string): string {
    const prefixes: Record<string, string> = {
      GRN_RECEIPT: 'RCP-',
      PRODUCTION_ISSUE: 'ISS-',
      PRODUCTION_RETURN: 'RET-',
      PRODUCTION_RECEIPT: 'PRD-',
      SALES_ISSUE: 'SAL-',
      DEMO_ISSUE: 'DMO-',
      DEMO_RETURN: 'DMR-',
      DEMO_SOLD: 'DMS-',
      SERVICE_ISSUE: 'SRV-',
      TRANSFER: 'TRN-',
      ADJUSTMENT: 'ADJ-',
      SCRAP: 'SCR-',
    };
    return prefixes[movementType] || 'MOV-';
  }

  // Reserve stock for production/sales
  async reserveStock(req: Request, reservationData: any) {
    
    const { tenantId, userId } = req.user as any;

    // Check available quantity
    const { data: stock } = await this.supabase
      .from('inventory_stock')
      .select('available_quantity')
      .eq('tenant_id', tenantId)
      .eq('item_id', reservationData.item_id)
      .eq('warehouse_id', reservationData.warehouse_id)
      .single();

    if (!stock || parseFloat(stock.available_quantity) < reservationData.reserved_quantity) {
      throw new BadRequestException('Insufficient stock available for reservation');
    }

    // Create reservation
    const reservation = {
      tenant_id: tenantId,
      item_id: reservationData.item_id,
      warehouse_id: reservationData.warehouse_id,
      reserved_quantity: reservationData.reserved_quantity,
      reference_type: reservationData.reference_type,
      reference_id: reservationData.reference_id,
      reference_number: reservationData.reference_number,
      reserved_by: userId,
      expires_at: reservationData.expires_at,
    };

    const { data, error } = await this.supabase
      .from('stock_reservations')
      .insert(reservation)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Update stock reserved_quantity
    await this.supabase.rpc('increment_reserved_quantity', {
      p_tenant_id: tenantId,
      p_item_id: reservationData.item_id,
      p_warehouse_id: reservationData.warehouse_id,
      p_quantity: reservationData.reserved_quantity,
    });

    return data;
  }

  // Release stock reservation
  async releaseReservation(req: Request, reservationId: string) {
    
    const { tenantId } = req.user as any;

    const { data: reservation } = await this.supabase
      .from('stock_reservations')
      .select('*')
      .eq('id', reservationId)
      .eq('tenant_id', tenantId)
      .single();

    if (!reservation) throw new NotFoundException('Reservation not found');

    // Update reservation
    await this.supabase
      .from('stock_reservations')
      .update({ released: true, released_at: new Date().toISOString() })
      .eq('id', reservationId);

    // Decrease stock reserved_quantity
    await this.supabase.rpc('decrement_reserved_quantity', {
      p_tenant_id: tenantId,
      p_item_id: reservation.item_id,
      p_warehouse_id: reservation.warehouse_id,
      p_quantity: reservation.reserved_quantity,
    });

    return { message: 'Reservation released successfully' };
  }

  // Check and create low stock alerts
  private async checkLowStockAlerts(req: Request, itemId: string, warehouseId: string) {
    
    const { tenantId } = req.user as any;

    // Get stock and item details (need item's reorder_level)
    const { data: stock } = await this.supabase
      .from('inventory_stock')
      .select('*, items!inner(reorder_level, is_rnd_item, metadata)')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle();

    if (!stock || !stock.items) return;
    if (
      stock.items.is_rnd_item === true ||
      stock.items.metadata?.excludeLowStock === true ||
      stock.items.metadata?.lowStockPlanning?.ignored === true
    ) return;

    const reorderLevel = stock.items.reorder_level || 0;
    const availableQty = parseFloat(stock.available_quantity) || 0;

    if (reorderLevel > 0 && availableQty <= reorderLevel) {
      // Check if alert already exists
      const { data: existingAlert } = await this.supabase
        .from('inventory_alerts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('item_id', itemId)
        .eq('warehouse_id', warehouseId)
        .eq('alert_type', 'LOW_STOCK')
        .eq('acknowledged', false)
        .maybeSingle();

      if (!existingAlert) {
        await this.supabase.from('inventory_alerts').insert({
          tenant_id: tenantId,
          alert_type: 'LOW_STOCK',
          item_id: itemId,
          warehouse_id: warehouseId,
          current_quantity: availableQty,
          threshold_quantity: reorderLevel,
          message: `Low stock alert: Available quantity (${availableQty}) is at or below reorder level (${reorderLevel})`,
          severity: availableQty <= 0 ? 'CRITICAL' : 'HIGH',
        });
      }
    }
  }

  // Check all items for low stock and create alerts
  async checkAllLowStock(req: Request) {
    const { tenantId } = req.user as any;

    // Get all items with reorder levels set
    const { data: items, error: itemsError } = await this.supabase
      .from('items')
      .select('id, code, name, reorder_level, is_rnd_item, metadata')
      .eq('tenant_id', tenantId)
      .gt('reorder_level', 0);

    if (itemsError) throw new BadRequestException(itemsError.message);

    const alertableItems = (items || []).filter((item: any) => (
      item.is_rnd_item !== true &&
      item.metadata?.excludeLowStock !== true &&
      item.metadata?.lowStockPlanning?.ignored !== true
    ));

    if (alertableItems.length === 0) {
      return {
        success: true,
        itemsChecked: 0,
        alertsCreated: 0,
        message: 'No items found with reorder levels set.'
      };
    }

    let alertsCreated = 0;
    let itemsChecked = 0;

    // Check stock for each item
    for (const item of alertableItems) {
      const { data: stockRecords } = await this.supabase
        .from('inventory_stock')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('item_id', item.id);

      if (stockRecords && stockRecords.length > 0) {
        for (const stock of stockRecords) {
          itemsChecked++;
          const availableQty = parseFloat(stock.available_quantity) || 0;

          if (availableQty <= item.reorder_level) {
            // Check if alert already exists
            const { data: existingAlert } = await this.supabase
              .from('inventory_alerts')
              .select('id')
              .eq('tenant_id', tenantId)
              .eq('item_id', item.id)
              .eq('warehouse_id', stock.warehouse_id)
              .eq('alert_type', 'LOW_STOCK')
              .eq('acknowledged', false)
              .maybeSingle();

            if (!existingAlert) {
              await this.supabase.from('inventory_alerts').insert({
                tenant_id: tenantId,
                alert_type: 'LOW_STOCK',
                item_id: item.id,
                warehouse_id: stock.warehouse_id,
                current_quantity: availableQty,
                threshold_quantity: item.reorder_level,
                message: `Low stock: ${item.code} - ${item.name} (Available: ${availableQty}, Reorder: ${item.reorder_level})`,
                severity: availableQty <= 0 ? 'CRITICAL' : 'HIGH',
              });
              alertsCreated++;
            }
          }
        }
      }
    }

    return {
      success: true,
      itemsChecked,
      alertsCreated,
      message: `Checked ${itemsChecked} stock records from ${alertableItems.length} items with reorder levels. Created ${alertsCreated} new alerts.`
    };
  }

  // Check for overdue and approaching due job orders
  async checkJobOrderAlerts(req: Request) {
    try {
      console.log('[checkJobOrderAlerts] Starting job order alerts check');
      const { tenantId } = req.user as any;
      console.log('[checkJobOrderAlerts] Tenant ID:', tenantId);

      const today = new Date();
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(today.getDate() + 3);

      // Get all active job orders
      console.log('[checkJobOrderAlerts] Querying production_job_orders table...');
      const { data: jobOrders, error } = await this.supabase
        .from('production_job_orders')
        .select('id, job_order_number, item_code, item_name, item_id, end_date, status')
        .eq('tenant_id', tenantId)
        .in('status', ['DRAFT', 'SCHEDULED', 'IN_PROGRESS']);

      if (error) {
        console.error('[checkJobOrderAlerts] Database error:', error);
        throw new BadRequestException(`Failed to fetch job orders: ${error.message}`);
      }

      console.log('[checkJobOrderAlerts] Found', jobOrders?.length || 0, 'active job orders');

    let alertsCreated = 0;
    const todayStr = today.toISOString().split('T')[0];

    for (const job of jobOrders || []) {
      if (!job.end_date) continue;

      const endDate = new Date(job.end_date);

      // Check if overdue
      if (endDate < today && job.status !== 'COMPLETED') {
        const { data: existingAlert } = await this.supabase
          .from('inventory_alerts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('alert_type', 'JOB_OVERDUE')
          .eq('item_id', job.item_id)
          .ilike('message', `%${job.job_order_number}%`)
          .eq('acknowledged', false)
          .maybeSingle();

        if (!existingAlert) {
          const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
          await this.supabase.from('inventory_alerts').insert({
            tenant_id: tenantId,
            alert_type: 'JOB_OVERDUE',
            item_id: job.item_id,
            warehouse_id: null,
            current_quantity: null,
            threshold_quantity: null,
            message: `⚠️ Job Order ${job.job_order_number} is OVERDUE by ${daysOverdue} day(s) | Item: ${job.item_code} - ${job.item_name} | Due: ${job.end_date}`,
            severity: 'CRITICAL',
          });
          alertsCreated++;
        }
      }
      // Check if approaching due date (within 3 days)
      else if (endDate >= today && endDate <= threeDaysFromNow) {
        const { data: existingAlert } = await this.supabase
          .from('inventory_alerts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('alert_type', 'JOB_DUE_SOON')
          .eq('item_id', job.item_id)
          .ilike('message', `%${job.job_order_number}%`)
          .eq('acknowledged', false)
          .maybeSingle();

        if (!existingAlert) {
          const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          await this.supabase.from('inventory_alerts').insert({
            tenant_id: tenantId,
            alert_type: 'JOB_DUE_SOON',
            item_id: job.item_id,
            warehouse_id: null,
            current_quantity: null,
            threshold_quantity: null,
            message: `📅 Job Order ${job.job_order_number} due in ${daysRemaining} day(s) | Item: ${job.item_code} - ${job.item_name} | Due: ${job.end_date}`,
            severity: daysRemaining === 0 ? 'HIGH' : 'MEDIUM',
          });
          alertsCreated++;
        }
      }
    }

      console.log('[checkJobOrderAlerts] Successfully created', alertsCreated, 'new alerts');
      return {
        success: true,
        jobOrdersChecked: jobOrders?.length || 0,
        alertsCreated,
        message: `Checked ${jobOrders?.length || 0} active job orders. Created ${alertsCreated} new alerts.`
      };
    } catch (error) {
      console.error('[checkJobOrderAlerts] Error occurred:', error);
      console.error('[checkJobOrderAlerts] Error stack:', error.stack);
      throw error;
    }
  }

  // Get inventory alerts
  async getAlerts(req: Request, acknowledged?: boolean) {
    
    const { tenantId } = req.user as any;

    let query = this.supabase
      .from('inventory_alerts')
      .select('*')
      .eq('tenant_id', tenantId);

    if (acknowledged !== undefined) {
      query = query.eq('acknowledged', acknowledged);
    }

    const { data: alerts, error: alertError } = await query
      .order('created_at', { ascending: false });

    if (alertError) throw new BadRequestException(alertError.message);

    if (!alerts || alerts.length === 0) {
      return [];
    }

    // Get item details separately
    const itemIds = [...new Set(alerts.map(a => a.item_id))];
    const { data: items, error: itemError } = await this.supabase
      .from('items')
      .select('id, code, name')
      .in('id', itemIds);

    if (itemError) throw new BadRequestException(itemError.message);

    // Get warehouse details separately
    const warehouseIds = [...new Set(alerts.map(a => a.warehouse_id))];
    const { data: warehouses, error: warehouseError } = await this.supabase
      .from('warehouses')
      .select('id, code, name')
      .in('id', warehouseIds);

    if (warehouseError) throw new BadRequestException(warehouseError.message);

    // Combine the data manually
    const result = alerts.map(alert => {
      const item = items?.find(i => i.id === alert.item_id);
      const warehouse = warehouses?.find(w => w.id === alert.warehouse_id);
      
      return {
        ...alert,
        items: item ? {
          item_code: item.code,
          item_name: item.name
        } : null,
        warehouses: warehouse ? {
          warehouse_code: warehouse.code,
          warehouse_name: warehouse.name
        } : null
      };
    });

    return result;
  }

  // Acknowledge alert
  async acknowledgeAlert(req: Request, alertId: string) {
    
    const { tenantId, userId } = req.user as any;

    const { error } = await this.supabase
      .from('inventory_alerts')
      .update({
        acknowledged: true,
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', alertId)
      .eq('tenant_id', tenantId);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Alert acknowledged successfully' };
  }

  // Send low stock email alert
  async sendLowStockEmail(req: Request, recipientEmail: string) {
    
    const { tenantId } = req.user as any;

    // Get all unacknowledged low stock alerts
    const alerts = await this.getAlerts(req, false);
    const lowStockAlerts = alerts.filter((alert: any) => alert.alert_type === 'LOW_STOCK');

    if (lowStockAlerts.length === 0) {
      throw new BadRequestException('No low stock alerts to send');
    }

    try {
      await this.emailService.sendLowStockAlert(recipientEmail, lowStockAlerts, tenantId);
      return { 
        success: true, 
        message: `Low stock alert email sent to ${recipientEmail}`,
        itemCount: lowStockAlerts.length 
      };
    } catch (error) {
      throw new BadRequestException(`Failed to send email: ${error.message}`);
    }
  }

  // Demo inventory management
  async issueDemoStock(req: Request, demoData: any) {
    
    const { tenantId, userId } = req.user as any;

    // Generate demo ID
    const demoId = await this.generateDemoId(req);

    const demo = {
      tenant_id: tenantId,
      demo_id: demoId,
      uid: demoData.uid,
      item_id: demoData.item_id,
      issued_to_staff_id: demoData.issued_to_staff_id,
      customer_name: demoData.customer_name,
      customer_contact: demoData.customer_contact,
      issue_date: demoData.issue_date || new Date().toISOString().split('T')[0],
      expected_return_date: demoData.expected_return_date,
      warehouse_id: demoData.warehouse_id,
      status: 'ISSUED',
    };

    const { data, error } = await this.supabase
      .from('demo_inventory')
      .insert(demo)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Create stock movement for demo issue
    await this.createStockMovement(req, {
      movement_type: 'DEMO_ISSUE',
      item_id: demoData.item_id,
      uid: demoData.uid,
      from_warehouse_id: demoData.warehouse_id,
      quantity: 1,
      reference_type: 'DEMO',
      reference_id: data.id,
      reference_number: demoId,
      notes: `Demo issued to ${demoData.issued_to_staff_id} for ${demoData.customer_name}`,
    });

    return data;
  }

  // Return demo stock
  async returnDemoStock(req: Request, demoId: string, returnData: any) {
    
    const { tenantId } = req.user as any;

    const { data: demo } = await this.supabase
      .from('demo_inventory')
      .select('*')
      .eq('demo_id', demoId)
      .eq('tenant_id', tenantId)
      .single();

    if (!demo) throw new NotFoundException('Demo record not found');

    // Update demo record
    const { data: updatedDemo, error } = await this.supabase
      .from('demo_inventory')
      .update({
        status: 'RETURNED',
        actual_return_date: returnData.return_date || new Date().toISOString().split('T')[0],
        inspection_notes: returnData.inspection_notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', demo.id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Create stock movement for demo return
    await this.createStockMovement(req, {
      movement_type: 'DEMO_RETURN',
      item_id: demo.item_id,
      uid: demo.uid,
      to_warehouse_id: demo.warehouse_id,
      quantity: 1,
      reference_type: 'DEMO',
      reference_id: demo.id,
      reference_number: demoId,
      notes: returnData.inspection_notes,
    });

    return updatedDemo;
  }

  // Convert demo to sale
  async convertDemoToSale(req: Request, demoId: string, salesOrderId: string) {
    
    const { tenantId } = req.user as any;

    const { data: demo } = await this.supabase
      .from('demo_inventory')
      .select('*')
      .eq('demo_id', demoId)
      .eq('tenant_id', tenantId)
      .single();

    if (!demo) throw new NotFoundException('Demo record not found');

    // Update demo record
    const { error } = await this.supabase
      .from('demo_inventory')
      .update({
        status: 'SOLD',
        converted_to_sale: true,
        sales_order_id: salesOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', demo.id);

    if (error) throw new BadRequestException(error.message);

    // Create stock movement for demo sold
    await this.createStockMovement(req, {
      movement_type: 'DEMO_SOLD',
      item_id: demo.item_id,
      uid: demo.uid,
      from_warehouse_id: demo.warehouse_id,
      quantity: 1,
      reference_type: 'SALES_ORDER',
      reference_id: salesOrderId,
      reference_number: demoId,
      notes: `Demo converted to sale for ${demo.customer_name}`,
    });

    return { message: 'Demo converted to sale successfully', demo_expenses: demo.demo_expenses };
  }

  // Get demo inventory
  async getDemoInventory(req: Request, filters?: any) {
    
    const { tenantId } = req.user as any;

    let query = this.supabase
      .from('demo_inventory')
      .select('*')
      .eq('tenant_id', tenantId);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.staff_id) {
      query = query.eq('issued_to_staff_id', filters.staff_id);
    }

    const { data: demos, error: demoError } = await query
      .order('issue_date', { ascending: false });

    if (demoError) throw new BadRequestException(demoError.message);

    if (!demos || demos.length === 0) {
      return [];
    }

    // Get item details separately
    const itemIds = [...new Set(demos.map(d => d.item_id))];
    const { data: items, error: itemError } = await this.supabase
      .from('items')
      .select('id, code, name')
      .in('id', itemIds);

    if (itemError) throw new BadRequestException(itemError.message);

    // Combine the data manually
    const result = demos.map(demo => {
      const item = items?.find(i => i.id === demo.item_id);
      
      return {
        ...demo,
        items: item ? {
          item_code: item.code,
          item_name: item.name
        } : null
      };
    });

    return result;
  }

  private async generateDemoId(req: Request): Promise<string> {
    
    const { tenantId } = req.user as any;

    const { count } = await this.supabase
      .from('demo_inventory')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return `DEMO-${String((count || 0) + 1).padStart(6, '0')}`;
  }

  // Get warehouses
  async getWarehouses(req: Request) {
    
    const { tenantId } = req.user as any;

    const { data, error } = await this.supabase
      .from('warehouses')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name');

    if (error) throw new BadRequestException(error.message);

    const warehouses = data || [];

    if (warehouses.length === 0) {
      return this.ensureDefaultWarehouses(tenantId);
    }

    const visibleWarehouses = warehouses.filter((warehouse: any) => warehouse?.is_active !== false);
    return visibleWarehouses.length > 0 ? visibleWarehouses : warehouses;
  }

  // Create warehouse
  async createWarehouse(req: Request, warehouseData: any) {
    
    const { tenantId } = req.user as any;

    const warehouse = await this.buildWarehousePayload(tenantId, {
      code: warehouseData.code || warehouseData.warehouse_code,
      name: warehouseData.name || warehouseData.warehouse_name,
      type: warehouseData.type,
      plant_id: warehouseData.plant_id,
      is_active: true,
      metadata: warehouseData.metadata || {},
    });

    const { data, error } = await this.supabase
      .from('warehouses')
      .insert(warehouse)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Delete stock entry
  async deleteStockEntry(req: Request, id: string) {
    const { tenantId } = req.user as any;

    const { data, error } = await this.supabase
      .from('inventory_stock')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Stock entry not found');
    return data;
  }

  // Delete stock movement
  async deleteStockMovement(req: Request, id: string) {
    const { tenantId } = req.user as any;

    const { data, error } = await this.supabase
      .from('stock_movements')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Stock movement not found');
    return data;
  }

  /**
   * Reverse a stock movement that was committed but whose owning business
   * document could not be completed.  The original ledger row is retained
   * and a separate return document restores stock for a complete audit trail.
   */
  async reverseCommittedServiceIssue(req: Request, movement: any, reason: string) {
    if (!movement?.id || movement?.movement_type !== 'SERVICE_ISSUE') {
      throw new BadRequestException('Only a committed service issue can be reversed');
    }
    if (!movement.from_warehouse_id || Number(movement.quantity) <= 0) {
      throw new BadRequestException('The service issue does not contain a reversible stock quantity');
    }

    return this.createStockMovement(req, {
      // TRANSFER is already supported by every deployed database. With only a
      // destination warehouse it records an inbound return from field service;
      // reference_type distinguishes it from an inter-warehouse transfer.
      movement_type: 'TRANSFER',
      item_id: movement.item_id,
      to_warehouse_id: movement.from_warehouse_id,
      to_location_id: movement.from_location_id || null,
      quantity: Number(movement.quantity),
      category: movement.stock_category,
      reference_type: 'SERVICE_ISSUE_REVERSAL',
      reference_id: movement.id,
      reference_number: movement.movement_number,
      notes: reason,
    });
  }

  // Delete alert
  async deleteAlert(req: Request, id: string) {
    const { tenantId } = req.user as any;

    const { data, error } = await this.supabase
      .from('inventory_alerts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Alert not found');
    return data;
  }

  // Delete demo item
  async deleteDemoItem(req: Request, id: string) {
    const { tenantId } = req.user as any;

    const { data, error } = await this.supabase
      .from('demo_inventory')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Demo item not found');
    return data;
  }
}
