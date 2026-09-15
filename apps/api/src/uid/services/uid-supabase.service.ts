import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class UidSupabaseService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  private uidRegistryColumnSupport = new Map<string, Promise<boolean>>();
  private tenantCodeCache = new Map<string, Promise<string>>();

  get client() {
    return this.supabase;
  }

  private normalizeUidList(value: any): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
        }
      } catch {
        return [];
      }
    }

    return [];
  }

  private isTransientSupabaseError(error: any): boolean {
    const message = String(error?.message || error?.details || error || '').toLowerCase();
    const code = String(error?.code || error?.status || '').toLowerCase();

    return (
      code === '502' ||
      code === '503' ||
      code === '504' ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('bad gateway') ||
      message.includes('gateway timeout') ||
      message.includes('cloudflare')
    );
  }

  private async waitForRetry(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async retryTransientSupabase<T>(
    operationName: string,
    operation: () => Promise<T>,
    maxAttempts = 3,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.isTransientSupabaseError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const delayMs = attempt * 250;
        console.warn(
          `[UidSupabaseService] ${operationName} failed with transient Supabase error on attempt ${attempt}/${maxAttempts}. Retrying in ${delayMs}ms...`,
          String((error as any)?.message || error),
        );
        await this.waitForRetry(delayMs);
      }
    }

    throw lastError;
  }

  private async detectUidRegistryColumnSupport(columnName: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('uid_registry')
      .select(`uid,${columnName}`)
      .limit(1);

    if (!error) {
      return true;
    }

    const message = String((error as any)?.message || '');
    if (
      /column uid_registry\.[a-z0-9_]+ does not exist/i.test(message) ||
      /Could not find the '.*' column of 'uid_registry'/i.test(message)
    ) {
      return false;
    }

    console.warn(`Unable to verify uid_registry.${columnName} support: ${message}`);
    return true;
  }

  private async supportsUidRegistryColumn(columnName: string): Promise<boolean> {
    let pending = this.uidRegistryColumnSupport.get(columnName);

    if (!pending) {
      pending = this.detectUidRegistryColumnSupport(columnName);
      this.uidRegistryColumnSupport.set(columnName, pending);
    }

    return pending;
  }

  private normalizeTenantCode(value: unknown): string {
    const normalized = String(value || '')
      .replace(/[^A-Za-z0-9]+/g, '')
      .toUpperCase()
      .trim();

    if (!normalized) {
      return '';
    }

    if (normalized.length >= 2) {
      return normalized.slice(0, 4);
    }

    return `${normalized}X`;
  }

  private deriveTenantCodeFromName(name: unknown): string {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const initials = parts
      .map((part) => part.replace(/[^A-Za-z0-9]+/g, '').charAt(0).toUpperCase())
      .filter(Boolean)
      .join('')
      .slice(0, 4);

    return this.normalizeTenantCode(initials || String(name || '').slice(0, 4));
  }

  async resolveTenantCode(tenantId?: string, fallbackCode?: string): Promise<string> {
    const normalizedTenantId = String(tenantId || '').trim();
    const normalizedFallback = this.normalizeTenantCode(fallbackCode);

    if (!normalizedTenantId) {
      return normalizedFallback || 'TEN';
    }

    let pending = this.tenantCodeCache.get(normalizedTenantId);

    if (!pending) {
      pending = (async () => {
        const { data, error } = await this.supabase
          .from('tenants')
          .select('name')
          .eq('id', normalizedTenantId)
          .single();

        if (error) {
          console.warn(`[UidSupabaseService] Failed to resolve tenant code for ${normalizedTenantId}: ${error.message}`);
          return normalizedFallback || 'TEN';
        }

        const resolved =
          this.deriveTenantCodeFromName((data as any)?.name) ||
          normalizedFallback ||
          'TEN';

        return resolved;
      })();

      this.tenantCodeCache.set(normalizedTenantId, pending);
    }

    return pending;
  }

  private buildUidCreateMetadata(createDto: any): Record<string, any> | undefined {
    const metadata = createDto?.metadata && typeof createDto.metadata === 'object' && !Array.isArray(createDto.metadata)
      ? { ...createDto.metadata }
      : {};

    if (createDto?.reference) {
      metadata.reference = createDto.reference;
    }

    if (createDto?.description) {
      metadata.description = createDto.description;
    }

    if (createDto?.item_id) {
      metadata.item_id = createDto.item_id;
    }

    if (createDto?.tenantCode) {
      metadata.tenant_code = createDto.tenantCode;
    }

    if (createDto?.plantCode) {
      metadata.plant_code = createDto.plantCode;
    }

    if (createDto?.entityType) {
      metadata.requested_entity_type = createDto.entityType;
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private async buildUidCreateInsertPayload(req: any, uid: string, createDto: any) {
    const location = createDto?.location || 'Warehouse';
    const reference = createDto?.reference || 'Initial';
    const entityType = createDto?.entity_type || createDto?.entityType;
    const entityId = createDto?.entity_id || createDto?.item_id;
    const metadata = this.buildUidCreateMetadata(createDto);

    const rawPayload: Record<string, any> = {
      entity_type: entityType,
      entity_id: entityId,
      lifecycle: JSON.stringify([
        {
          stage: 'CREATED',
          timestamp: new Date().toISOString(),
          location,
          reference,
          user: req.user.email,
        },
      ]),
    };

    if (metadata) {
      rawPayload.metadata = metadata;
    }

    for (const [key, value] of Object.entries(createDto || {})) {
      if (value === undefined) {
        continue;
      }

      if (
        key === 'tenantCode' ||
        key === 'plantCode' ||
        key === 'entityType' ||
        key === 'entity_type' ||
        key === 'entity_id' ||
        key === 'item_id' ||
        key === 'reference' ||
        key === 'description' ||
        key === 'lifecycle' ||
        key === 'tenant_id' ||
        key === 'uid' ||
        key === 'metadata'
      ) {
        continue;
      }

      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        continue;
      }

      rawPayload[key] = value;
    }

    const payload: Record<string, any> = {
      tenant_id: req.user.tenantId,
      uid,
    };

    for (const [key, value] of Object.entries(rawPayload)) {
      if (value === undefined) {
        continue;
      }

      if (await this.supportsUidRegistryColumn(key)) {
        payload[key] = value;
      }
    }

    return payload;
  }

  private async resolveVendorFromLineage(tenantId: string, uidRecord: any): Promise<{
    supplierId: string | null;
    grnId: string | null;
    vendorData: { id?: string; name?: string; code?: string } | null;
  } | null> {
    const maxDepth = 6;
    const visited = new Set<string>();
    let currentLevelUids = this.normalizeUidList(uidRecord?.parent_uids);

    for (let depth = 0; depth < maxDepth && currentLevelUids.length > 0; depth++) {
      const pendingUids = currentLevelUids.filter((parentUid) => !visited.has(parentUid));
      pendingUids.forEach((parentUid) => visited.add(parentUid));

      if (pendingUids.length === 0) {
        break;
      }

      const { data: parentRecords } = await this.supabase
        .from('uid_registry')
        .select('uid, supplier_id, grn_id, parent_uids')
        .eq('tenant_id', tenantId)
        .in('uid', pendingUids);

      if (!parentRecords || parentRecords.length === 0) {
        break;
      }

      for (const parentRecord of parentRecords) {
        if (parentRecord.supplier_id) {
          const { data: vendor } = await this.supabase
            .from('vendors')
            .select('id, name, code')
            .eq('id', parentRecord.supplier_id)
            .maybeSingle();

          if (vendor) {
            return {
              supplierId: parentRecord.supplier_id,
              grnId: parentRecord.grn_id || null,
              vendorData: vendor,
            };
          }
        }

        if (parentRecord.grn_id) {
          const { data: parentGrn } = await this.supabase
            .from('grn')
            .select('id, vendor_id, vendor_name')
            .eq('id', parentRecord.grn_id)
            .maybeSingle();

          if (parentGrn?.vendor_id) {
            const { data: vendor } = await this.supabase
              .from('vendors')
              .select('id, name, code')
              .eq('id', parentGrn.vendor_id)
              .maybeSingle();

            if (vendor) {
              return {
                supplierId: parentGrn.vendor_id,
                grnId: parentRecord.grn_id,
                vendorData: vendor,
              };
            }
          }

          if (parentGrn?.vendor_name) {
            return {
              supplierId: parentGrn.vendor_id || null,
              grnId: parentRecord.grn_id,
              vendorData: {
                id: parentGrn.vendor_id || undefined,
                name: parentGrn.vendor_name,
                code: '',
              },
            };
          }
        }
      }

      currentLevelUids = parentRecords.flatMap((parentRecord) => this.normalizeUidList(parentRecord.parent_uids));
    }

    return null;
  }

  private async resolvePreferredVendorForItem(itemId: string | null): Promise<{
    supplierId: string | null;
    vendorData: { id?: string; name?: string; code?: string } | null;
  } | null> {
    if (!itemId) {
      return null;
    }

    try {
      const { data } = await this.supabase.rpc('get_preferred_vendor', {
        p_item_id: itemId,
      });

      const preferred = Array.isArray(data) ? data[0] : null;
      if (!preferred) {
        return null;
      }

      const preferredVendorId = preferred.vendor_id || preferred.id || null;
      const preferredVendorName = preferred.vendor_name || preferred.name || null;
      const preferredVendorCode = preferred.vendor_code || preferred.code || '';

      if (preferredVendorId) {
        const { data: vendor } = await this.supabase
          .from('vendors')
          .select('id, name, code')
          .eq('id', preferredVendorId)
          .maybeSingle();

        if (vendor) {
          return {
            supplierId: vendor.id,
            vendorData: vendor,
          };
        }
      }

      if (preferredVendorName) {
        return {
          supplierId: preferredVendorId,
          vendorData: {
            id: preferredVendorId || undefined,
            name: preferredVendorName,
            code: preferredVendorCode,
          },
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async resolveVendorFromRecentGrn(tenantId: string, itemId: string | null): Promise<{
    supplierId: string | null;
    grnId: string | null;
    vendorData: { id?: string; name?: string; code?: string } | null;
  } | null> {
    if (!itemId) {
      return null;
    }

    try {
      const { data: grnItemRows } = await this.supabase
        .from('grn_items')
        .select('grn_id, created_at')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(25);

      const grnIds = Array.from(
        new Set((grnItemRows || []).map((row: any) => row.grn_id).filter((id: any) => typeof id === 'string' && id.length > 0)),
      );

      if (grnIds.length === 0) {
        return null;
      }

      const { data: grns } = await this.supabase
        .from('grn')
        .select('id, vendor_id, vendor_name, received_date, grn_date, created_at')
        .eq('tenant_id', tenantId)
        .in('id', grnIds)
        .order('received_date', { ascending: false })
        .limit(25);

      if (!grns || grns.length === 0) {
        return null;
      }

      const latestGrn = grns.find((grn) => !!grn.vendor_id || !!grn.vendor_name) || grns[0];
      if (!latestGrn) {
        return null;
      }

      if (latestGrn.vendor_id) {
        const { data: vendor } = await this.supabase
          .from('vendors')
          .select('id, name, code')
          .eq('id', latestGrn.vendor_id)
          .maybeSingle();

        if (vendor) {
          return {
            supplierId: vendor.id,
            grnId: latestGrn.id,
            vendorData: vendor,
          };
        }
      }

      if (latestGrn.vendor_name) {
        return {
          supplierId: latestGrn.vendor_id || null,
          grnId: latestGrn.id,
          vendorData: {
            id: latestGrn.vendor_id || undefined,
            name: latestGrn.vendor_name,
            code: '',
          },
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Generate UID with format: UID-{TENANT}-{PLANT}-{TYPE}-{SEQUENCE}-{CHECKSUM}
   * Uses database function for atomic sequence generation to prevent race conditions
   */
  async generateUID(
    tenantCode: string,
    plantCode: string,
    entityType: string,
  ): Promise<string> {
    return this.retryTransientSupabase('generate_next_uid', async () => {
      const { data, error } = await this.supabase.rpc('generate_next_uid', {
        p_tenant_code: tenantCode,
        p_plant_code: plantCode,
        p_entity_type: entityType,
      });

      if (error) {
        if (this.isTransientSupabaseError(error)) {
          throw error;
        }

        console.error('Error calling generate_next_uid:', error);
        // Fallback to old method if function doesn't exist yet
        return this.generateUIDLegacy(tenantCode, plantCode, entityType);
      }

      return data;
    });
  }

  /**
   * Legacy UID generation (fallback only)
   */
  private async generateUIDLegacy(
    tenantCode: string,
    plantCode: string,
    entityType: string,
  ): Promise<string> {
    return this.retryTransientSupabase('generateUIDLegacy', async () => {
      const { data: existing, error } = await this.supabase
        .from('uid_registry')
        .select('uid')
        .like('uid', `UID-${tenantCode}-${plantCode}-${entityType}-%`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      let sequence = 1;
      if (existing && existing.length > 0) {
        const lastUID = existing[0].uid;
        const parts = lastUID.split('-');
        sequence = parseInt(parts[4]) + 1;
      }

      const seqStr = sequence.toString().padStart(6, '0');
      const checksum = this.generateChecksum(
        `${tenantCode}${plantCode}${entityType}${seqStr}`,
      );

      return `UID-${tenantCode}-${plantCode}-${entityType}-${seqStr}-${checksum}`;
    });
  }

  /**
   * Create UID record
   */
  async createUID(req: any, createDto: any) {
    const tenantId = String(createDto?.tenant_id || req?.user?.tenantId || '').trim();
    const tenantCode = await this.resolveTenantCode(tenantId, createDto?.tenantCode);
    const normalizedCreateDto = {
      ...createDto,
      tenant_id: tenantId || createDto?.tenant_id,
      tenantCode,
    };

    // Generate UID
    const uid = await this.generateUID(
      tenantCode,
      normalizedCreateDto.plantCode || 'KOL',
      normalizedCreateDto.entityType || 'RM',
    );

    const payload = await this.buildUidCreateInsertPayload(req, uid, normalizedCreateDto);

    return this.retryTransientSupabase('uid_registry insert', async () => {
      const { data, error } = await this.supabase
        .from('uid_registry')
        .insert([payload])
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    });
  }

  /**
   * Get all UIDs with filters
   */
  async findAll(req: any, filters?: any) {
    const tenantId = req.user.tenantId;

    // Pagination parameters
    const page = filters?.page ? parseInt(filters.page) : 1;
    const limit = filters?.limit ? parseInt(filters.limit) : 50;
    const offset = (page - 1) * limit;

    // Get total count first
    let countQuery = this.supabase
      .from('uid_registry')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if (filters?.status) {
      countQuery = countQuery.eq('status', filters.status);
    }

    if (filters?.entity_type) {
      countQuery = countQuery.eq('entity_type', filters.entity_type);
    }

    if (filters?.location) {
      countQuery = countQuery.ilike('location', `%${filters.location}%`);
    }

    const { count, error: countError } = await countQuery;
    if (countError) throw new Error(countError.message);

    let query = this.supabase
      .from('uid_registry')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.entity_type) {
      query = query.eq('entity_type', filters.entity_type);
    }

    if (filters?.location) {
      query = query.ilike('location', `%${filters.location}%`);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    
    // Manually fetch item details for each UID to avoid relationship issues
    const processedData = [];
    for (const uid of data || []) {
      let itemDetails = null;
      
      // Try to fetch item details if item_id exists
      if (uid.item_id) {
        const { data: item } = await this.supabase
          .from('items')
          .select('code, name, category')
          .eq('id', uid.item_id)
          .maybeSingle();
        itemDetails = item;
      }
      // Fallback: try entity_id if item_id doesn't exist
      else if (uid.entity_id) {
        const { data: item } = await this.supabase
          .from('items')
          .select('code, name, category')
          .eq('id', uid.entity_id)
          .maybeSingle();
        itemDetails = item;
      }
      
      processedData.push({
        ...uid,
        items: itemDetails
      });
    }
    
    return {
      data: processedData,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    };
  }

  /**
   * Search for specific UID
   */
  async searchUID(req: any, uid: string) {
    const tenantId = req.user.tenantId;
    console.log('=== SEARCH UID ===');
    console.log('UID:', uid);

    // First get the UID record
    const { data: uidData, error: uidError } = await this.supabase
      .from('uid_registry')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .single();

    if (uidError) throw new Error(uidError.message);

    console.log('UID Data:', { supplier_id: uidData.supplier_id, po_id: uidData.purchase_order_id, grn_id: uidData.grn_id });

    // Then fetch related data separately
    let supplier = null;
    let purchaseOrder = null;
    let grn: any = null;

    if (uidData.supplier_id) {
      console.log('Looking up vendor with ID:', uidData.supplier_id, 'for tenant:', tenantId);
      const { data: vendorData, error: vendorError } = await this.supabase
        .from('vendors')
        .select('id, name, code')
        .eq('tenant_id', tenantId)
        .eq('id', uidData.supplier_id)
        .maybeSingle();
      if (vendorError) {
        console.log('Vendor query error:', vendorError.message);
      }
      supplier = vendorData;
      console.log('Supplier found:', supplier?.name || 'NULL');
    }

    if (uidData.purchase_order_id) {
      const { data: poData } = await this.supabase
        .from('purchase_orders')
        .select('id, po_number')
        .eq('id', uidData.purchase_order_id)
        .single();
      purchaseOrder = poData;
      console.log('PO found:', purchaseOrder?.po_number);
    }

    if (uidData.grn_id) {
      const { data: grnData } = await this.supabase
        .from('grn')
        .select('id, grn_number')
        .eq('id', uidData.grn_id)
        .single();
      grn = grnData;
      console.log('GRN found:', grn?.grn_number);
    }

    const result = {
      ...uidData,
      supplier: supplier || null,
      purchase_order: purchaseOrder || null,
      grn: grn || null,
    };
    
    console.log('=== FINAL RESULT ===');
    console.log('Supplier:', JSON.stringify(result.supplier));
    console.log('PO:', JSON.stringify(result.purchase_order));
    console.log('GRN:', JSON.stringify(result.grn));
    return result;
  }

  /**
   * Get UID with complete hierarchy
   */
  async getUIDWithHierarchy(req: any, uid: string) {
    const uidRecord = await this.searchUID(req, uid);

    // Get parent records
    let parents = [];
    if (uidRecord.parent_uids && uidRecord.parent_uids.length > 0) {
      const { data } = await this.supabase
        .from('uid_registry')
        .select('*')
        .in('uid', uidRecord.parent_uids);
      parents = data || [];
    }

    // Get child records
    let children = [];
    if (uidRecord.child_uids && uidRecord.child_uids.length > 0) {
      const { data } = await this.supabase
        .from('uid_registry')
        .select('*')
        .in('uid', uidRecord.child_uids);
      children = data || [];
    }

    return {
      ...uidRecord,
      parents,
      children,
    };
  }

  /**
   * Update UID lifecycle
   */
  async updateLifecycle(
    req: any,
    uid: string,
    stage: string,
    location: string,
    reference: string,
  ) {
    const tenantId = req.user.tenantId;

    // Get current record
    const { data: current } = await this.supabase
      .from('uid_registry')
      .select('lifecycle')
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .single();

    if (!current) throw new Error('UID not found');

    const lifecycle = Array.isArray(current.lifecycle)
      ? current.lifecycle
      : [];

    lifecycle.push({
      stage,
      timestamp: new Date().toISOString(),
      location,
      reference,
      user: req.user.email,
    });

    const { data, error } = await this.supabase
      .from('uid_registry')
      .update({
        lifecycle: JSON.stringify(lifecycle),
        location,
      })
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Link UIDs (parent-child relationship)
   */
  async linkUIDs(req: any, parentUID: string, childUID: string) {
    const tenantId = req.user.tenantId;

    // Update parent
    const { data: parent } = await this.supabase
      .from('uid_registry')
      .select('child_uids')
      .eq('tenant_id', tenantId)
      .eq('uid', parentUID)
      .single();

    if (!parent) throw new Error('Parent UID not found');

    const childUIDs = Array.isArray(parent.child_uids) ? parent.child_uids : [];
    if (!childUIDs.includes(childUID)) {
      childUIDs.push(childUID);
    }

    await this.supabase
      .from('uid_registry')
      .update({ child_uids: JSON.stringify(childUIDs) })
      .eq('tenant_id', tenantId)
      .eq('uid', parentUID);

    // Update child
    const { data: child } = await this.supabase
      .from('uid_registry')
      .select('parent_uids, assembly_level')
      .eq('tenant_id', tenantId)
      .eq('uid', childUID)
      .single();

    if (!child) throw new Error('Child UID not found');

    const parentUIDs = Array.isArray(child.parent_uids)
      ? child.parent_uids
      : [];
    if (!parentUIDs.includes(parentUID)) {
      parentUIDs.push(parentUID);
    }

    await this.supabase
      .from('uid_registry')
      .update({
        parent_uids: JSON.stringify(parentUIDs),
        assembly_level: (child.assembly_level || 0) + 1,
      })
      .eq('tenant_id', tenantId)
      .eq('uid', childUID);

    return { message: 'UIDs linked successfully' };
  }

  /**
   * Update UID status
   */
  async updateStatus(req: any, uid: string, status: string, location?: string) {
    const tenantId = req.user.tenantId;

    const updateData: any = { status };
    if (location) updateData.location = location;

    const { data, error } = await this.supabase
      .from('uid_registry')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Add lifecycle event
    await this.updateLifecycle(
      req,
      uid,
      `STATUS_CHANGE_${status}`,
      location || data.location,
      `Status changed to ${status}`,
    );

    return data;
  }

  /**
   * Update UID quality status (QC result)
   *
   * Used by Job Order quick-QC flow. Quality status controls saleability.
   */
  async updateQualityStatus(req: any, uid: string, qualityStatus: string, notes?: string) {
    const tenantId = req.user.tenantId;

    const raw = String(qualityStatus || '').trim();
    if (!raw) throw new Error('quality_status is required');

    let normalized = raw.toUpperCase();
    if (normalized === 'FAIL') normalized = 'ON_HOLD';
    if (normalized === 'HOLD') normalized = 'ON_HOLD';

    if (!['PASSED', 'ON_HOLD', 'FAILED'].includes(normalized)) {
      throw new Error('Invalid quality status');
    }

    // Update quality_status and move to IN_STOCK if PASSED
    const updateFields: any = {
      quality_status: normalized,
      updated_at: new Date().toISOString(),
    };

    // If QC PASSED, update status to IN_STOCK so it's available for dispatch
    if (normalized === 'PASSED') {
      updateFields.status = 'IN_STOCK';
    }

    const { data, error } = await this.supabase
      .from('uid_registry')
      .update(updateFields)
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Add lifecycle event
    const location = data?.location || 'N/A';
    await this.updateLifecycle(
      req,
      uid,
      `QC_${normalized}`,
      location,
      notes ? `QC marked as ${normalized}: ${notes}` : `QC marked as ${normalized}`,
    );

    return data;
  }

  /**
   * Validate UID format
   */
  validateUIDFormat(uid: string): boolean {
    const pattern = /^UID-[A-Z0-9]{2,4}-[A-Z0-9]{2,3}-[A-Z0-9]{2}-\d{6}-[A-Z0-9]{2}$/;
    return pattern.test(uid);
  }

  /**
   * Get Purchase Trail for UID
   */
  async getPurchaseTrail(req: any, uid: string) {
    const tenantId = req.user.tenantId;

    // Get UID record
    const { data: uidRecord, error: uidError } = await this.supabase
      .from('uid_registry')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .single();

    if (uidError) throw new Error('UID not found');

    // Get item details
    const { data: item } = await this.supabase
      .from('items')
      .select('code, name')
      .eq('id', uidRecord.entity_id)
      .single();

    // Get supplier details
    let supplier = null;
    if (uidRecord.supplier_id) {
      const { data } = await this.supabase
        .from('vendors')
        .select('name, contact_person')
        .eq('id', uidRecord.supplier_id)
        .single();
      supplier = data;
    }

    // Get purchase order details
    let purchase_order = null;
    if (uidRecord.purchase_order_id) {
      const { data } = await this.supabase
        .from('purchase_orders')
        .select('po_number, order_date, total_amount')
        .eq('id', uidRecord.purchase_order_id)
        .single();
      purchase_order = data;
    }

    // Get GRN and invoice details
    let grn = null;
    if (uidRecord.grn_id) {
      const { data } = await this.supabase
        .from('grns')
        .select('grn_number, receipt_date, invoice_number, invoice_date, invoice_file_url, invoice_file_name, invoice_file_type, invoice_file_size')
        .eq('id', uidRecord.grn_id)
        .single();
      grn = data;
    }

    let metadata: any = {};
    try {
      metadata = typeof uidRecord.metadata === 'string'
        ? JSON.parse(uidRecord.metadata)
        : uidRecord.metadata || {};
    } catch {
      metadata = {};
    }

    if (grn && !grn.invoice_number && metadata?.invoice_number) {
      grn.invoice_number = metadata.invoice_number;
    }

    // Parse lifecycle
    let lifecycle = [];
    try {
      lifecycle = typeof uidRecord.lifecycle === 'string' 
        ? JSON.parse(uidRecord.lifecycle) 
        : uidRecord.lifecycle || [];
    } catch {
      lifecycle = [];
    }

    return {
      uid: uidRecord.uid,
      item: item || { code: 'N/A', name: 'Unknown Item' },
      supplier,
      purchase_order,
      grn,
      batch_number: uidRecord.batch_number,
      location: uidRecord.location,
      lifecycle,
    };
  }

  /**
   * Get complete trace data for a UID including timeline, components, vendor, quality, and customer
   */
  async getCompleteTrace(req: any, uid: string) {
    const tenantId = req.user.tenantId;

    console.log('[UID Trace] Looking for UID:', uid, 'Tenant:', tenantId);

    // 1. Get main UID record
    const { data: uidRecord, error: uidError } = await this.supabase
      .from('uid_registry')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .maybeSingle();

    console.log('[UID Trace] Query result:', { found: !!uidRecord, error: uidError });

    if (uidError) {
      console.error('[UID Trace] Database error:', uidError);
      throw new Error(`Database error: ${uidError.message}`);
    }

    if (!uidRecord) {
      console.error('[UID Trace] UID not found in database');
      throw new Error('UID not found');
    }

    console.log('[UID Trace] UID record item_id:', uidRecord.item_id);

    // 2. Get item details separately
    const { data: item, error: itemError } = await this.supabase
      .from('items')
      .select('id, code, name, description, category, uom')
      .eq('id', uidRecord.item_id)
      .maybeSingle();

    console.log('[UID Trace] Item lookup result:', { found: !!item, error: itemError });

    // Attach item to UID record
    uidRecord.item = item;

    // Parse lifecycle
    const lifecycle = Array.isArray(uidRecord.lifecycle)
      ? uidRecord.lifecycle
      : typeof uidRecord.lifecycle === 'string'
      ? JSON.parse(uidRecord.lifecycle)
      : [];

    // 2. Get vendor details directly from supplier_id
    let vendor = null;
    console.log('[UID Trace] UID Record supplier_id:', uidRecord.supplier_id);
    if (uidRecord.supplier_id) {
      const { data: vendorData, error: vendorError } = await this.supabase
        .from('vendors')
        .select('code, name, contact_person, email')
        .eq('tenant_id', tenantId)
        .eq('id', uidRecord.supplier_id)
        .maybeSingle();

      console.log('[UID Trace] Vendor lookup result:', { vendorData, vendorError });
      if (vendorData) {
        vendor = {
          code: vendorData.code,
          name: vendorData.name,
          contact: `${vendorData.contact_person || 'N/A'} (${vendorData.email || 'N/A'})`,
        };
        console.log('[UID Trace] Vendor object created:', vendor);
      } else {
        console.log('[UID Trace] No vendor data found for supplier_id:', uidRecord.supplier_id);
      }
    } else {
      console.log('[UID Trace] No supplier_id in UID record');
    }

    // 2b. Get PO details if available
    let purchase_order = null;
    console.log('[UID Trace] UID Record purchase_order_id:', uidRecord.purchase_order_id);
    if (uidRecord.purchase_order_id) {
      const { data: poData, error: poError } = await this.supabase
        .from('purchase_orders')
        .select('id, po_number, order_date, total_amount')
        .eq('id', uidRecord.purchase_order_id)
        .maybeSingle();
      
      console.log('[UID Trace] PO lookup result:', { poData, poError });
      if (poData) {
        purchase_order = {
          po_number: poData.po_number,
          order_date: poData.order_date,
          total_amount: poData.total_amount,
        };
        console.log('[UID Trace] PO object created:', purchase_order);
      } else {
        console.log('[UID Trace] No PO data found for purchase_order_id:', uidRecord.purchase_order_id);
      }
    } else {
      console.log('[UID Trace] No purchase_order_id in UID record');
    }

    // 2c. Get GRN details if available
    let grn_info = null;
    if (uidRecord.grn_id) {
      const { data: grnData } = await this.supabase
        .from('grn')
        .select('id, grn_number, grn_date, received_date')
        .eq('id', uidRecord.grn_id)
        .maybeSingle();
      
      if (grnData) {
        grn_info = {
          grn_number: grnData.grn_number,
          grn_date: grnData.grn_date || grnData.received_date,
        };
      }
    }

    // 3. Get quality checkpoints
    const quality_checkpoints = lifecycle
      .filter((event: any) => 
        event.stage.includes('QC') || 
        event.stage.includes('QUALITY') || 
        event.stage.includes('INSPECTION')
      )
      .map((event: any) => ({
        stage: event.stage,
        status: event.reference.includes('PASSED') ? 'PASSED' : 
                event.reference.includes('FAILED') ? 'FAILED' : 'PENDING',
        date: event.timestamp,
        inspector: event.user,
        notes: event.reference,
      }));

    // 4. Get components (child UIDs) with their details
    const child_uids = Array.isArray(uidRecord.child_uids) 
      ? uidRecord.child_uids 
      : typeof uidRecord.child_uids === 'string' && uidRecord.child_uids
      ? JSON.parse(uidRecord.child_uids)
      : [];

    let components: any[] = [];
    if (child_uids.length > 0) {
      const { data: childRecords } = await this.supabase
        .from('uid_registry')
        .select(`
          uid,
          batch_number,
          received_date,
          qc_status,
          item:items(code, name)
        `)
        .in('uid', child_uids);

      if (childRecords) {
        components = childRecords.map((child: any) => {
          const itemData = Array.isArray(child.item) ? child.item[0] : child.item;
          return {
            uid: child.uid,
            item_code: itemData?.code || 'N/A',
            item_name: itemData?.name || 'N/A',
            batch_number: child.batch_number || 'N/A',
            received_date: child.received_date || 'N/A',
            qc_status: child.qc_status || 'PENDING',
            vendor_name: null as string | null,
          };
        });

        // Get vendor names for components
        for (const component of components) {
          const { data: componentRecord } = await this.supabase
            .from('uid_registry')
            .select('lifecycle')
            .eq('uid', component.uid)
            .single();

          if (componentRecord) {
            const compLifecycle = Array.isArray(componentRecord.lifecycle)
              ? componentRecord.lifecycle
              : typeof componentRecord.lifecycle === 'string'
              ? JSON.parse(componentRecord.lifecycle)
              : [];
            
            const compGrnRef = compLifecycle.find((e: any) => 
              e.reference && e.reference.includes('GRN')
            );

            if (compGrnRef) {
              const { data: compGrn } = await this.supabase
                .from('grn')
                .select('vendor:vendors(name)')
                .eq('tenant_id', tenantId)
                .eq('grn_number', compGrnRef.reference)
                .single();

              if (compGrn && compGrn.vendor) {
                const vendorData = Array.isArray(compGrn.vendor) ? compGrn.vendor[0] : compGrn.vendor;
                component.vendor_name = vendorData?.name || null;
              }
            }
          }
        }
      }
    }

    // 5. Get parent products (where this UID is used)
    const parent_uids = Array.isArray(uidRecord.parent_uids) 
      ? uidRecord.parent_uids 
      : typeof uidRecord.parent_uids === 'string' && uidRecord.parent_uids
      ? JSON.parse(uidRecord.parent_uids)
      : [];

    let parent_products: any[] = [];
    if (parent_uids.length > 0) {
      const { data: parentRecords } = await this.supabase
        .from('uid_registry')
        .select(`
          uid,
          item:items(code, name)
        `)
        .in('uid', parent_uids);

      if (parentRecords) {
        parent_products = parentRecords.map((parent: any) => {
          const itemData = Array.isArray(parent.item) ? parent.item[0] : parent.item;
          return {
            uid: parent.uid,
            item_code: itemData?.code || 'N/A',
            item_name: itemData?.name || 'N/A',
          };
        });
      }
    }

    // 6. Get customer + location details from deployment tracking (authoritative)
    let customer = null;
    try {
      const { data: deploymentStatus } = await this.supabase
        .from('v_uid_deployment_status')
        .select('current_level, current_organization, current_location, current_deployment_date, warranty_expiry_date')
        .eq('tenant_id', tenantId)
        .eq('uid', uidRecord.uid)
        .maybeSingle();

      if (deploymentStatus?.current_organization || deploymentStatus?.current_location) {
        customer = {
          name: deploymentStatus.current_organization || null,
          location: deploymentStatus.current_location || null,
          deployment_level: deploymentStatus.current_level || null,
          deployment_date: deploymentStatus.current_deployment_date || null,
          warranty_expiry_date: deploymentStatus.warranty_expiry_date || null,
        };
      }
    } catch (e) {
      console.warn('[UID Trace] Deployment status lookup failed:', e);
    }

    const itemData = Array.isArray(uidRecord.item) ? uidRecord.item[0] : uidRecord.item;

    const result = {
      uid: uidRecord.uid,
      entity_type: uidRecord.entity_type,
      item: {
        code: itemData?.code || 'N/A',
        name: itemData?.name || 'N/A',
        category: itemData?.category || 'N/A',
      },
      status: uidRecord.status,
      location: uidRecord.location,
      batch_number: uidRecord.batch_number,
      lifecycle,
      components,
      parent_products,
      vendor: vendor || null,
      purchase_order: purchase_order || null,
      grn: grn_info || null,
      quality_checkpoints: quality_checkpoints || [],
      customer: customer || null,
    };

    console.log('[UID Trace] Final result vendor:', result.vendor);
    console.log('[UID Trace] Final result purchase_order:', result.purchase_order);

    return result;
  }

  /**
   * Get all UIDs with filtering - for quality inspection form
   */
  async getAllUIDs(
    req: any, 
    status?: string, 
    entityType?: string, 
    itemId?: string, 
    qualityStatus?: string,
    search?: string,
    limit?: number,
    offset?: number,
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
    jobOrderId?: string
  ) {
    const tenantId = req.user?.tenantId || req.tenantId;
    console.log('[getAllUIDs] Called with:', { tenantId, status, entityType, itemId, qualityStatus, search, limit, offset, sortBy, sortOrder, jobOrderId });
    
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    // Pagination parameters
    const pageLimit = limit || 10;
    const pageOffset = offset || 0;
    
    let query = this.supabase
      .from('uid_registry')
      .select(`
        uid,
        entity_id,
        entity_type,
        status,
        location,
        batch_number,
        quality_status,
        client_part_number,
        grn_id,
        created_at
      `, { count: 'exact' })
      .eq('tenant_id', tenantId);

    // Search across multiple fields
    if (search) {
      query = query.or(`uid.ilike.%${search}%,client_part_number.ilike.%${search}%,location.ilike.%${search}%,batch_number.ilike.%${search}%`);
    }

    if (status) {
      // Support comma-separated statuses
      const statuses = status.split(',').map(s => s.trim());
      if (statuses.length === 1) {
        query = query.eq('status', statuses[0]);
      } else {
        query = query.in('status', statuses);
      }
    }

    if (qualityStatus) {
      // Support comma-separated quality statuses
      const qStatuses = qualityStatus.split(',').map(s => s.trim());
      if (qStatuses.length === 1) {
        query = query.eq('quality_status', qStatuses[0]);
      } else {
        query = query.in('quality_status', qStatuses);
      }
    }

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    if (itemId) {
      // Filter by entity_id (the item/entity this UID belongs to)
      query = query.eq('entity_id', itemId);
    }

    if (jobOrderId) {
      query = query.eq('job_order_id', jobOrderId);
    }

    // Sorting
    const orderField = sortBy || 'created_at';
    const orderAscending = sortOrder === 'asc';
    query = query.order(orderField, { ascending: orderAscending });
    
    // Pagination
    query = query.range(pageOffset, pageOffset + pageLimit - 1);

    const { data, error, count } = await query;

    console.log('[getAllUIDs] Query result:', { dataCount: data?.length, error, totalCount: count });

    if (error) {
      console.error('[getAllUIDs] Supabase Error Details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        fullError: JSON.stringify(error, null, 2)
      });
      throw new Error(`Failed to fetch UIDs: ${error.message} (Code: ${error.code}, Details: ${error.details})`);
    }

    // Fetch item details separately if we have UIDs
    if (data && data.length > 0) {
      console.log('[getAllUIDs] Fetching item details for', data.length, 'UIDs');
      const entityIds = [...new Set(data.map((uid: any) => uid.entity_id).filter(Boolean))];
      
      console.log('[getAllUIDs] Unique entity IDs:', entityIds);
      
      if (entityIds.length > 0) {
        const { data: items } = await this.supabase
          .from('items')
          .select('id, code, name')
          .in('id', entityIds);
        
        console.log('[getAllUIDs] Fetched items:', items?.length);
        
        if (items) {
          const itemsMap = new Map(items.map(item => [item.id, item]));
          
          // Attach item details to UIDs
          data.forEach((uid: any) => {
            const itemLookupId = uid.entity_id;
            const item = itemsMap.get(itemLookupId);
            if (item) {
              uid.items = item;
            }
          });
        }
      }
      // Batch-fetch GRN numbers
      const grnIds = [...new Set(data.map((uid: any) => uid.grn_id).filter(Boolean))];
      if (grnIds.length > 0) {
        const { data: grns } = await this.supabase
          .from('grns')
          .select('id, grn_number')
          .in('id', grnIds);

        if (grns) {
          const grnMap = new Map(grns.map((g: any) => [g.id, g]));
          data.forEach((uid: any) => {
            if (uid.grn_id) {
              uid.grn = grnMap.get(uid.grn_id) || null;
            }
          });
        }
      }
    } else {
      console.log('[getAllUIDs] No UIDs found matching criteria');
    }

    console.log('[getAllUIDs] Returning data with', data?.length, 'UIDs');

    return {
      data,
      total: count || 0,
      limit: pageLimit,
      offset: pageOffset
    };
  }

  /**
   * Get UID details with vendor and item information for quality inspection
   */
  async getUIDDetails(req: any, uid: string) {
    const tenantId = req.user.tenantId;
    console.log(`[getUIDDetails] Fetching UID: ${uid} for tenant: ${tenantId}`);

    // First check if UID exists
    const { data: uidCheck, error: checkError } = await this.supabase
      .from('uid_registry')
      .select('uid, entity_id, supplier_id, grn_id, tenant_id')
      .eq('uid', uid)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    console.log(`[getUIDDetails] UID check result:`, uidCheck);
    console.log(`[getUIDDetails] Check error:`, checkError);

    if (checkError) {
      console.error('Error checking UID:', checkError);
      throw new Error(`Database error: ${checkError.message}`);
    }

    if (!uidCheck) {
      console.error(`UID ${uid} not found for tenant ${tenantId}`);
      throw new Error(`UID ${uid} not found or does not belong to your tenant`);
    }

    console.log(`[getUIDDetails] UID exists, fetching related data...`);

    // Fetch UID record - don't use joins, fetch items and vendors separately
    const { data: uidRecord, error } = await this.supabase
      .from('uid_registry')
      .select('*')
      .eq('uid', uid)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    console.log(`[getUIDDetails] Full UID record:`, JSON.stringify(uidRecord, null, 2));
    console.log(`[getUIDDetails] Fetch error:`, error);

    if (error) {
      console.error('Error fetching UID details:', error);
      throw new Error(`Failed to fetch UID details: ${error.message}`);
    }

    if (!uidRecord) {
      throw new Error(`UID ${uid} data not found`);
    }

    // Fetch item details separately if entity_id exists
    let itemData = null;
    if (uidRecord.entity_id) {
      const { data: item } = await this.supabase
        .from('items')
        .select('id, name, code, description, metadata')
        .eq('id', uidRecord.entity_id)
        .maybeSingle();
      itemData = item;
    }

    // Fetch vendor details separately if supplier_id exists
    let vendorData = null;
    if (uidRecord.supplier_id) {
      const { data: vendor } = await this.supabase
        .from('vendors')
        .select('id, name, code')
        .eq('id', uidRecord.supplier_id)
        .maybeSingle();
      vendorData = vendor;
    }

    let resolvedSupplierId = uidRecord.supplier_id || null;
    let resolvedGrnId = uidRecord.grn_id || null;

    if (!vendorData) {
      const lineageVendor = await this.resolveVendorFromLineage(tenantId, uidRecord);
      if (lineageVendor?.vendorData) {
        vendorData = lineageVendor.vendorData;
        resolvedSupplierId = lineageVendor.supplierId || resolvedSupplierId;
        resolvedGrnId = resolvedGrnId || lineageVendor.grnId;
      }
    }

    if (!vendorData) {
      const preferredVendor = await this.resolvePreferredVendorForItem(uidRecord.entity_id || null);
      if (preferredVendor?.vendorData) {
        vendorData = preferredVendor.vendorData;
        resolvedSupplierId = preferredVendor.supplierId || resolvedSupplierId;
      }
    }

    if (!vendorData) {
      const recentGrnVendor = await this.resolveVendorFromRecentGrn(tenantId, uidRecord.entity_id || null);
      if (recentGrnVendor?.vendorData) {
        vendorData = recentGrnVendor.vendorData;
        resolvedSupplierId = recentGrnVendor.supplierId || resolvedSupplierId;
        resolvedGrnId = resolvedGrnId || recentGrnVendor.grnId;
      }
    }

    const metadataSupplier =
      typeof itemData?.metadata === 'object' && itemData?.metadata
        ? itemData.metadata.supplier || itemData.metadata.vendor || null
        : null;

    console.log(`[getUIDDetails] Item data:`, itemData);
    console.log(`[getUIDDetails] Vendor data:`, vendorData);

    const result = {
      uid: uidRecord.uid,
      grnId: resolvedGrnId,
      itemId: uidRecord.entity_id,
      itemName: itemData?.name || '',
      itemCode: itemData?.code || '',
      vendorId: resolvedSupplierId,
      vendorName: vendorData?.name || metadataSupplier || '',
      vendorCode: vendorData?.code || '',
      batchNumber: uidRecord.batch_number || '',
      lotNumber: '', // Add if you have lot_number field
      entityType: uidRecord.entity_type,
      status: uidRecord.status,
      location: uidRecord.location,
      assemblyLevel: uidRecord.assembly_level,
      parentUids: uidRecord.parent_uids,
      childUids: uidRecord.child_uids,
      qualityStatus: uidRecord.quality_status,
      createdAt: uidRecord.created_at,
    };

    console.log(`[getUIDDetails] Returning result:`, result);
    return result;
  }

  /**
   * Generate checksum
   */
  private generateChecksum(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).toUpperCase().substring(0, 2).padEnd(2, '0');
  }

  /**
   * Update client part number for a UID
   */
  async updatePartNumber(
    req: any,
    uid: string,
    clientPartNumber: string | null,
  ): Promise<void> {
    const tenantId = req.user?.tenantId || req.tenantId;
    
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    // Verify UID exists and belongs to tenant
    const { data: existing, error: fetchError } = await this.supabase
      .from('uid_registry')
      .select('id')
      .eq('uid', uid)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !existing) {
      throw new Error(`UID ${uid} not found`);
    }

    // Update the part number
    const { error: updateError } = await this.supabase
      .from('uid_registry')
      .update({ 
        client_part_number: clientPartNumber,
        updated_at: new Date().toISOString()
      })
      .eq('uid', uid)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('[updatePartNumber] Error:', updateError);
      throw new Error(`Failed to update part number: ${updateError.message}`);
    }

    console.log(`[updatePartNumber] Successfully updated UID ${uid} with part number: ${clientPartNumber}`);
  }
}
