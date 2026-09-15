import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { UidSupabaseService } from '../../uid/services/uid-supabase.service';
import { normalizeInventoryStockCategory as normalizeInventoryCategory } from '../../inventory/utils/inventory-category';

@Injectable()
export class ProductionService {
  private supabase: SupabaseClient;

  constructor(private uidService: UidSupabaseService) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  /**
   * Generate production order number
   */
  async generateOrderNumber(tenantId: string): Promise<string> {
    const { data } = await this.supabase
      .from('production_orders')
      .select('order_number')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastNumber = data && data.length > 0 ? data[0].order_number : 'PO-0000';
    const number = parseInt(lastNumber.split('-')[1]) + 1;
    return `PO-${number.toString().padStart(4, '0')}`;
  }

  /**
   * Create production order
   */
  async create(tenantId: string, userId: string, data: any) {
    const orderNumber = await this.generateOrderNumber(tenantId);

    // Create production order with BOM reference
    const { data: order, error } = await this.supabase
      .from('production_orders')
      .insert({
        tenant_id: tenantId,
        order_number: orderNumber,
        item_id: data.itemId,
        bom_id: data.bomId || null, // Save BOM reference for routing integration
        quantity: data.quantity,
        plant_code: data.plantCode || 'KOL',
        start_date: data.startDate,
        end_date: data.endDate,
        priority: data.priority || 'NORMAL',
        notes: data.notes,
        created_by: userId,
        status: 'DRAFT',
      })
      .select()
      .single();

    if (error) {
      console.error('[Production] Failed to create order', {
        tenantId,
        userId,
        orderNumber,
        payload: data,
        error,
      });
      throw new BadRequestException(error.message);
    }

    // If BOM provided, expand BOM and create component requirements
    if (data.bomId) {
      await this.expandBOM(order.id, data.bomId, data.quantity);
    }

    // Log stage
    await this.logStage(order.id, 'DRAFT', userId, 'Production order created');

    return this.findOne(tenantId, order.id);
  }

  /**
   * Expand BOM to get component requirements (with recursive multi-level BOM support)
   */
  async expandBOM(productionOrderId: string, bomId: string, quantity: number) {
    // Get BOM items with component type
    const { data: bomItems } = await this.supabase
      .from('bom_items')
      .select('component_type, item_id, child_bom_id, quantity, scrap_percentage')
      .eq('bom_id', bomId);

    if (!bomItems || bomItems.length === 0) return;

    const allComponents: Array<{
      production_order_id: string;
      item_id: string;
      required_quantity: number;
      consumed_quantity: number;
    }> = [];

    // Process each component
    for (const bomItem of bomItems) {
      const scrapFactor = 1 + (bomItem.scrap_percentage || 0) / 100;
      const adjustedQty = bomItem.quantity * quantity * scrapFactor;

      if (bomItem.component_type === 'ITEM' && bomItem.item_id) {
        // Direct item - add to requirements
        allComponents.push({
          production_order_id: productionOrderId,
          item_id: bomItem.item_id,
          required_quantity: adjustedQty,
          consumed_quantity: 0,
        });
      } else if (bomItem.component_type === 'BOM' && bomItem.child_bom_id) {
        // Nested BOM - recursively expand
        console.log(`[Production] Expanding child BOM: ${bomItem.child_bom_id} with qty: ${adjustedQty}`);
        
        // Get child BOM items
        const { data: childBomItems } = await this.supabase
          .from('bom_items')
          .select('component_type, item_id, child_bom_id, quantity, scrap_percentage')
          .eq('bom_id', bomItem.child_bom_id);

        if (childBomItems) {
          // Recursively process child BOM
          await this.expandChildBOM(
            productionOrderId,
            childBomItems,
            adjustedQty,
            allComponents
          );
        }
      }
    }

    // Insert all components in one batch
    if (allComponents.length > 0) {
      // Aggregate quantities for duplicate items
      const aggregatedComponents = new Map<string, number>();
      allComponents.forEach(comp => {
        const existing = aggregatedComponents.get(comp.item_id) || 0;
        aggregatedComponents.set(comp.item_id, existing + comp.required_quantity);
      });

      const finalComponents = Array.from(aggregatedComponents.entries()).map(([itemId, qty]) => ({
        production_order_id: productionOrderId,
        item_id: itemId,
        required_quantity: qty,
        consumed_quantity: 0,
      }));

      await this.supabase.from('production_order_components').insert(finalComponents);
      console.log(`[Production] Inserted ${finalComponents.length} component requirements`);
    }
  }

  /**
   * Helper: Recursively expand child BOMs
   */
  private async expandChildBOM(
    productionOrderId: string,
    bomItems: any[],
    quantity: number,
    accumulator: Array<any>
  ) {
    for (const bomItem of bomItems) {
      const scrapFactor = 1 + (bomItem.scrap_percentage || 0) / 100;
      const adjustedQty = bomItem.quantity * quantity * scrapFactor;

      if (bomItem.component_type === 'ITEM' && bomItem.item_id) {
        accumulator.push({
          production_order_id: productionOrderId,
          item_id: bomItem.item_id,
          required_quantity: adjustedQty,
          consumed_quantity: 0,
        });
      } else if (bomItem.component_type === 'BOM' && bomItem.child_bom_id) {
        // Continue recursion
        const { data: childBomItems } = await this.supabase
          .from('bom_items')
          .select('component_type, item_id, child_bom_id, quantity, scrap_percentage')
          .eq('bom_id', bomItem.child_bom_id);

        if (childBomItems) {
          await this.expandChildBOM(
            productionOrderId,
            childBomItems,
            adjustedQty,
            accumulator
          );
        }
      }
    }
  }

  /**
   * Start production (Release order)
   */
  async startProduction(tenantId: string, orderId: string, userId: string) {
    const { error } = await this.supabase
      .from('production_orders')
      .update({
        status: 'RELEASED',
        actual_start_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', orderId);

    if (error) throw new BadRequestException(error.message);

    await this.logStage(orderId, 'RELEASED', userId, 'Production released to floor');

    return this.findOne(tenantId, orderId);
  }

  /**
   * Complete assembly - Link component UIDs to finished product UID
   */
  async completeAssembly(tenantId: string, data: any) {
    const { productionOrderId, componentUids, assembledBy } = data;

    // Get production order with BOM details
    const { data: order } = await this.supabase
      .from('production_orders')
      .select('*, item:items(code, name, type, uom), bom:boms(id, items:bom_items(item_id, quantity))')
      .eq('tenant_id', tenantId)
      .eq('id', productionOrderId)
      .single();

    if (!order) throw new NotFoundException('Production order not found');

    // Validate component UIDs exist and are available
    if (!componentUids || componentUids.length === 0) {
      throw new BadRequestException('No component UIDs provided');
    }

    // Get all component UID details
    const { data: uidDetails } = await this.supabase
      .from('uid_registry')
      .select('uid, entity_id, entity_type, status')
      .eq('tenant_id', tenantId)
      .in('uid', componentUids);

    if (!uidDetails || uidDetails.length !== componentUids.length) {
      throw new BadRequestException('Some component UIDs not found or invalid');
    }

    // Verify all UIDs are AVAILABLE
    const unavailableUids = uidDetails.filter(u => u.status !== 'AVAILABLE');
    if (unavailableUids.length > 0) {
      throw new BadRequestException(`UIDs not available: ${unavailableUids.map(u => u.uid).join(', ')}`);
    }

    // Generate UID for finished product
    const mockReq = {
      user: { tenantId, email: 'system@production.auto' },
    };
    const tenantCode = await this.uidService.resolveTenantCode(tenantId);

    const finishedUid = await this.uidService.generateUID(
      tenantCode,
      order.plant_code || 'KOL',
      'FG', // Finished Good
    );

    // Create UID registry entry for finished product
    await this.uidService.createUID(mockReq, {
      tenant_id: tenantId,
      plantCode: order.plant_code || 'KOL',
      entityType: 'FG',
      entity_type: 'FG',
      entity_id: order.item_id,
      location: `FG-Warehouse-${order.plant_code}`,
      status: 'AVAILABLE',
      reference: `PO-${order.order_number}`,
      description: order.item?.name,
      metadata: {
        production_order_id: productionOrderId,
        production_order_number: order.order_number,
        assembled_date: new Date().toISOString(),
      },
    });

    // Link component UIDs to finished product UID and mark as CONSUMED
    for (const componentUid of componentUids) {
      // Link UIDs
      await this.uidService.linkUIDs(mockReq, finishedUid, componentUid);
      
      // Mark component UID as CONSUMED
      await this.supabase
        .from('uid_registry')
        .update({
          status: 'CONSUMED',
          consumed_at: new Date().toISOString(),
          consumed_in_uid: finishedUid,
          updated_at: new Date().toISOString(),
        })
        .eq('uid', componentUid)
        .eq('tenant_id', tenantId);
    }

    // Reduce inventory for each component
    for (const uid of uidDetails) {
      const { data: item } = await this.supabase
        .from('items')
        .select('category')
        .eq('id', uid.entity_id)
        .single();

      const { data: stockEntry } = await this.supabase
        .from('inventory_stock')
        .select('warehouse_id')
        .eq('tenant_id', tenantId)
        .eq('item_id', uid.entity_id)
        .limit(1)
        .single();

      if (stockEntry) {
        await this.supabase.rpc('adjust_inventory_stock', {
            p_tenant_id: tenantId,
            p_item_id: uid.entity_id,
            p_warehouse_id: stockEntry.warehouse_id,
            p_location_id: null,
            p_quantity_change: -1,
            p_category: normalizeInventoryCategory(item?.category, 'RAW_MATERIAL'),
        });
      }

      // Log inventory movement
      await this.supabase
        .from('stock_movements')
        .insert({
          tenant_id: tenantId,
          item_id: uid.entity_id,
          movement_type: 'PRODUCTION_ISSUE',
          quantity: 1,
          reference_type: 'PRODUCTION',
          reference_id: productionOrderId,
          reference_number: order.order_number,
          uid: uid.uid,
          moved_by: assembledBy,
          notes: `Consumed in production assembly ${finishedUid}`,
        });
    }

    // Add finished goods to stock
    const { data: warehouse } = await this.supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .single();

    const { data: item } = await this.supabase
      .from('items')
      .select('category')
      .eq('id', order.item_id)
      .single();
        
    await this.supabase.rpc('adjust_inventory_stock', {
      p_tenant_id: tenantId,
      p_item_id: order.item_id,
      p_warehouse_id: warehouse?.id,
      p_location_id: null,
      p_quantity_change: 1,
      p_category: normalizeInventoryCategory(item?.category, 'FINISHED_GOODS'),
    });

    // Log inventory movement for finished goods
    await this.supabase
      .from('inventory_movements')
      .insert({
        tenant_id: tenantId,
        item_id: order.item_id,
        movement_type: 'PRODUCTION',
        quantity: 1,
        reference_type: 'PRODUCTION',
        reference_id: productionOrderId,
        reference_number: order.order_number,
        uid: finishedUid,
        moved_by: assembledBy,
        notes: `Finished goods produced from production order ${order.order_number}`,
      });

    // Create assembly record
    const { data: assembly } = await this.supabase
      .from('production_assemblies')
      .insert({
        production_order_id: productionOrderId,
        finished_product_uid: finishedUid,
        component_uids: componentUids,
        assembly_date: new Date().toISOString(),
        assembled_by: assembledBy,
        qc_status: 'PENDING',
      })
      .select()
      .single();

    // Update produced quantity
    await this.supabase
      .from('production_orders')
      .update({
        produced_quantity: order.produced_quantity + 1,
        status: 'IN_PROGRESS',
        updated_at: new Date().toISOString(),
      })
      .eq('id', productionOrderId);

    await this.logStage(productionOrderId, 'IN_PROGRESS', assembledBy, `Assembly completed - FG UID: ${finishedUid}`);

    return { assembly, finishedUid };
  }

  /**
   * QC approval
   */
  async approveQC(tenantId: string, assemblyId: string, data: any) {
    const { qcStatus, qcNotes, qcBy } = data;

    const { error } = await this.supabase
      .from('production_assemblies')
      .update({
        qc_status: qcStatus,
        qc_date: new Date().toISOString(),
        qc_by: qcBy,
        qc_notes: qcNotes,
      })
      .eq('id', assemblyId);

    if (error) throw new BadRequestException(error.message);

    // If QC passed, update UID lifecycle and move to IN_STOCK
    if (qcStatus === 'PASSED') {
      const { data: assembly } = await this.supabase
        .from('production_assemblies')
        .select('finished_product_uid, production_order_id')
        .eq('id', assemblyId)
        .single();

      if (assembly) {
        const mockReq = { user: { tenantId, email: 'system@qc.auto' } };
        await this.uidService.updateLifecycle(
          mockReq,
          assembly.finished_product_uid,
          'QC_PASSED',
          'Finished Goods Warehouse',
          'QC Approval'
        );

        // Update UID status to IN_STOCK so it becomes available for dispatch
        await this.supabase
          .from('uid_registry')
          .update({ status: 'IN_STOCK' })
          .eq('tenant_id', tenantId)
          .eq('uid', assembly.finished_product_uid);

        await this.logStage(assembly.production_order_id, 'QC', qcBy, 'QC inspection completed');
      }
    }

    return { success: true };
  }

  /**
   * Complete production order
   */
  async complete(tenantId: string, orderId: string, userId: string) {
    const { error } = await this.supabase
      .from('production_orders')
      .update({
        status: 'COMPLETED',
        actual_end_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', orderId);

    if (error) throw new BadRequestException(error.message);

    await this.logStage(orderId, 'COMPLETED', userId, 'Production order completed');

    return this.findOne(tenantId, orderId);
  }

  /**
   * Get available UIDs for BOM components (FIFO sorted)
   */
  async getAvailableUIDs(tenantId: string, bomId: string) {
    // Get BOM items
    const { data: bomItems, error: bomError } = await this.supabase
      .from('bom_items')
      .select(`
        item_id,
        quantity,
        item:items!inner(id, code, name, uom, category)
      `)
      .eq('bom_id', bomId);

    if (bomError || !bomItems) {
      throw new BadRequestException('Failed to fetch BOM items');
    }

    // For each BOM item, get available UIDs sorted FIFO
    const result: Record<string, any[]> = {};

    for (const bomItem of bomItems) {
      const item = Array.isArray(bomItem.item) ? bomItem.item[0] : bomItem.item;
      
      const { data: uids, error: uidError } = await this.supabase
        .from('uid_registry')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('entity_id', bomItem.item_id)
        .eq('entity_type', 'RM') // Raw Material
        .eq('status', 'AVAILABLE')
        .order('received_date', { ascending: true }) // FIFO: oldest first
        .order('expiry_date', { ascending: true, nullsFirst: false })
        .order('batch_number', { ascending: true });

      if (!uidError && uids) {
        result[bomItem.item_id] = uids.map(uid => ({
          uid: uid.uid,
          item_id: uid.entity_id,
          item_code: item.code,
          item_name: item.name,
          batch_number: uid.batch_number,
          received_date: uid.received_date,
          expiry_date: uid.expiry_date,
          location: uid.location,
          status: uid.status,
        }));
      } else {
        result[bomItem.item_id] = [];
      }
    }

    return result;
  }

  /**
   * Get all production orders
   */
  async findAll(tenantId: string, filters?: any) {
    let query = this.supabase
      .from('production_orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.search) {
      query = query.or(`order_number.ilike.%${filters.search}%`);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('[Production] Failed to fetch orders', {
        tenantId,
        filters,
        error,
      });
      throw new BadRequestException(error.message);
    }

    if (!orders || orders.length === 0) {
      return [];
    }

    const itemIds = Array.from(
      new Set(orders.map(order => order.item_id).filter(Boolean)),
    );
    const orderIds = orders.map(order => order.id);

    const itemsById: Record<string, any> = {};
    if (itemIds.length > 0) {
      const { data: items, error: itemsError } = await this.supabase
        .from('items')
        .select('id, code, name, uom')
        .in('id', itemIds);

      if (itemsError) {
        console.error('[Production] Failed to fetch linked items', {
          tenantId,
          itemIds,
          itemsError,
        });
      } else if (items) {
        items.forEach(item => {
          itemsById[item.id] = item;
        });
      }
    }

    const assembliesByOrderId: Record<string, any[]> = {};
    if (orderIds.length > 0) {
      const { data: assemblies, error: assembliesError } = await this.supabase
        .from('production_assemblies')
        .select('id, production_order_id, finished_product_uid, qc_status')
        .in('production_order_id', orderIds);

      if (assembliesError) {
        console.error('[Production] Failed to fetch assemblies', {
          tenantId,
          orderIds,
          assembliesError,
        });
      } else if (assemblies) {
        assemblies.forEach(assembly => {
          if (!assembliesByOrderId[assembly.production_order_id]) {
            assembliesByOrderId[assembly.production_order_id] = [];
          }
          assembliesByOrderId[assembly.production_order_id].push(assembly);
        });
      }
    }

    return orders.map(order => ({
      ...order,
      item: order.item_id ? itemsById[order.item_id] || null : null,
      production_assemblies: assembliesByOrderId[order.id] || [],
    }));
  }

  /**
   * Get single production order
   */
  async findOne(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('production_orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (error) {
      console.error('[Production] Failed to fetch order', {
        tenantId,
        orderId: id,
        error,
      });
      throw new NotFoundException('Production order not found');
    }
    let item: any = null;
    if (data.item_id) {
      const result = await this.supabase
        .from('items')
        .select('id, code, name, description, uom')
        .eq('tenant_id', tenantId)
        .eq('id', data.item_id)
        .maybeSingle();
      if (result.error) {
        console.error('[Production] Failed to fetch order item', {
          tenantId,
          orderId: id,
          itemId: data.item_id,
          error: result.error,
        });
      } else {
        item = result.data || null;
      }
    }
    return { ...data, item };
  }

  /**
   * Log stage change
   */
  async logStage(orderId: string, stage: string, userId: string, notes?: string) {
    await this.supabase.from('production_stage_logs').insert({
      production_order_id: orderId,
      stage,
      entered_by: userId,
      notes,
      entered_at: new Date().toISOString(),
    });
  }
}
