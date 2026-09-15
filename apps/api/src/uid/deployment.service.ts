import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CreateDeploymentDto, UpdateDeploymentDto, PublicDeploymentUpdateDto } from './dto/deployment.dto';

@Injectable()
export class DeploymentService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  async createDeployment(tenantId: string, userId: string, dto: CreateDeploymentDto) {
    // Verify UID exists and belongs to tenant
    const { data: uid, error: uidError } = await this.supabase
      .from('uid_registry')
      .select('id, uid, entity_id, entity_type, client_part_number')
      .eq('id', dto.uid_id)
      .eq('tenant_id', tenantId)
      .single();

    if (uidError || !uid) {
      throw new NotFoundException('UID not found');
    }

    const commissioningConfirmed = dto.commissioning_confirmed === true;
    const customerId = String(dto.customer_id || '').trim() || null;
    if (commissioningConfirmed && !customerId) {
      throw new BadRequestException('Select an existing customer before confirming commissioning.');
    }
    if (commissioningConfirmed && dto.is_current_location === false) {
      throw new BadRequestException('A commissioned asset must be recorded at its current customer location.');
    }
    if (customerId) {
      const { data: customer } = await this.supabase
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('id', customerId)
        .maybeSingle();
      if (!customer) throw new BadRequestException('Selected customer does not belong to this company.');
    }

    // Generate public access token
    const publicToken = await this.generatePublicToken();

    // Create deployment record
    const { data, error } = await this.supabase
      .from('product_deployment_history')
      .insert({
        tenant_id: tenantId,
        uid_id: dto.uid_id,
        customer_id: customerId,
        deployment_level: dto.deployment_level,
        organization_name: dto.organization_name,
        location_name: dto.location_name,
        deployment_date: dto.deployment_date,
        parent_deployment_id: dto.parent_deployment_id || null,
        contact_person: dto.contact_person || null,
        contact_email: dto.contact_email || null,
        contact_phone: dto.contact_phone || null,
        deployment_notes: dto.deployment_notes || null,
        warranty_expiry_date: dto.warranty_expiry_date || null,
        maintenance_schedule: dto.maintenance_schedule || null,
        is_current_location: dto.is_current_location !== false, // Default to true
        commissioning_confirmed: commissioningConfirmed,
        commissioned_at: commissioningConfirmed ? new Date().toISOString() : null,
        commissioned_by: commissioningConfirmed ? userId : null,
        public_access_token: publicToken,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error('Deployment creation error:', error);
      throw new BadRequestException(error.message);
    }

    if (!commissioningConfirmed) return data;

    try {
      const installedAsset = await this.createInstalledAssetForCommissioning({
        tenantId,
        userId,
        customerId: customerId!,
        uid,
        deployment: data,
      });
      const warrantyEntitlement = await this.createWarrantyEntitlementForCommissioning({
        tenantId,
        userId,
        customerId: customerId!,
        uid,
        deployment: data,
        installedAsset,
      });
      const { data: linked, error: linkError } = await this.supabase
        .from('product_deployment_history')
        .update({ installed_asset_id: installedAsset.id, warranty_entitlement_id: warrantyEntitlement?.id || null })
        .eq('tenant_id', tenantId)
        .eq('id', data.id)
        .select()
        .single();
      if (linkError) throw new BadRequestException(linkError.message);
      return { ...linked, installed_asset: installedAsset, warranty_entitlement: warrantyEntitlement };
    } catch (error) {
      // A commissioning record without its installed asset is misleading.
      // Remove this newly-created record; existing assets are never removed.
      await this.supabase
        .from('product_deployment_history')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', data.id);
      throw error;
    }
  }

  private async createInstalledAssetForCommissioning(params: {
    tenantId: string;
    userId: string;
    customerId: string;
    uid: any;
    deployment: any;
  }) {
    const uidValue = String(params.uid.uid || '').trim();
    const { data: existing } = await this.supabase
      .from('service_installed_assets')
      .select('id, customer_id')
      .eq('tenant_id', params.tenantId)
      .eq('uid', uidValue)
      .maybeSingle();
    if (existing) {
      if (String(existing.customer_id) !== params.customerId) {
        throw new BadRequestException('This UID is already commissioned for another customer. Transfer it through the controlled service asset process.');
      }
      return existing;
    }

    const { data: item } = await this.supabase
      .from('items')
      .select('id, code, name')
      .eq('tenant_id', params.tenantId)
      .eq('id', params.uid.entity_id)
      .maybeSingle();
    const { data: warranty } = await this.supabase
      .from('warranties')
      .select('warranty_end_date')
      .eq('tenant_id', params.tenantId)
      .eq('uid', uidValue)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    const { data: sequence, error: sequenceError } = await this.supabase.rpc(
      'next_service_document_number',
      { p_document_type: 'INSTALLED_ASSET' },
    );
    if (sequenceError) throw new BadRequestException(sequenceError.message);

    const assetName = String(item?.name || params.uid.client_part_number || uidValue).trim();
    const { data: asset, error: assetError } = await this.supabase
      .from('service_installed_assets')
      .insert({
        tenant_id: params.tenantId,
        asset_number: `AST-${String(sequence).padStart(6, '0')}`,
        customer_id: params.customerId,
        item_id: item?.id || null,
        uid: uidValue,
        asset_name: assetName,
        installation_date: params.deployment.deployment_date,
        warranty_until: params.deployment.warranty_expiry_date || warranty?.warranty_end_date || null,
        location: params.deployment.location_name || null,
        status: 'ACTIVE',
        notes: `Auto-created on commissioning from UID ${uidValue}.`,
        created_by: params.userId,
      })
      .select()
      .single();
    if (assetError) throw new BadRequestException(assetError.message);
    return asset;
  }

  private async createWarrantyEntitlementForCommissioning(params: {
    tenantId: string;
    userId: string;
    customerId: string;
    uid: any;
    deployment: any;
    installedAsset: any;
  }) {
    const uidValue = String(params.uid.uid || '').trim();
    const { data: existing, error: existingError } = await this.supabase
      .from('service_contracts')
      .select('*')
      .eq('tenant_id', params.tenantId)
      .eq('source_type', 'COMMISSIONING_WARRANTY')
      .eq('source_id', params.deployment.id)
      .maybeSingle();
    if (existingError) throw new BadRequestException(existingError.message);
    if (existing) return existing;

    const { data: warranty, error: warrantyError } = await this.supabase
      .from('warranties')
      .select('id, customer_id, warranty_number, warranty_start_date, warranty_end_date')
      .eq('tenant_id', params.tenantId)
      .eq('uid', uidValue)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (warrantyError) throw new BadRequestException(warrantyError.message);
    if (warranty && String(warranty.customer_id) !== params.customerId) {
      throw new BadRequestException('The dispatched warranty for this UID belongs to a different customer. Correct the controlled dispatch/customer record before commissioning.');
    }

    // Never invent a warranty duration. An expiry must come from commissioning
    // data or the dispatched warranty record.
    const endDate = String(params.deployment.warranty_expiry_date || warranty?.warranty_end_date || '').slice(0, 10);
    if (!endDate) return null;
    const startDate = String(params.deployment.deployment_date || warranty?.warranty_start_date || '').slice(0, 10);
    if (!startDate || endDate < startDate) {
      throw new BadRequestException('Warranty expiry must be on or after the commissioning date.');
    }

    const { data: sequence, error: sequenceError } = await this.supabase.rpc(
      'next_service_document_number',
      { p_document_type: 'SERVICE_CONTRACT' },
    );
    if (sequenceError) throw new BadRequestException(sequenceError.message);
    const { data: entitlement, error: entitlementError } = await this.supabase
      .from('service_contracts')
      .insert({
        tenant_id: params.tenantId,
        contract_number: `SC-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`,
        customer_id: params.customerId,
        contract_type: 'WARRANTY',
        start_date: startDate,
        end_date: endDate,
        status: 'ACTIVE',
        response_hours: 8,
        resolution_hours: 48,
        included_visits: null,
        included_labor_hours: null,
        contract_value: 0,
        tax_percentage: 0,
        notes: `Auto-created warranty entitlement at commissioning for UID ${uidValue}${warranty?.warranty_number ? ` (warranty ${warranty.warranty_number})` : ''}.`,
        source_type: 'COMMISSIONING_WARRANTY',
        source_id: params.deployment.id,
        auto_created: true,
        created_by: params.userId,
      })
      .select()
      .single();
    if (entitlementError) throw new BadRequestException(entitlementError.message);
    const { error: linkError } = await this.supabase
      .from('service_contract_assets')
      .insert({ contract_id: entitlement.id, asset_id: params.installedAsset.id });
    if (linkError) {
      await this.supabase.from('service_contracts').delete().eq('tenant_id', params.tenantId).eq('id', entitlement.id);
      throw new BadRequestException(linkError.message);
    }
    return entitlement;
  }

  async getDeploymentStatus(tenantId: string, filters?: {
    uid?: string;
    part_number?: string;
    organization?: string;
    location?: string;
    search?: string;
    offset?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: string;
  }) {
    const offset = Number.isFinite(filters?.offset) ? Math.max(0, filters!.offset!) : 0;
    const limit = Number.isFinite(filters?.limit) ? Math.min(200, Math.max(1, filters!.limit!)) : 50;

    const allowedSortFields = new Set([
      'uid',
      'client_part_number',
      'item_name',
      'item_code',
      'current_level',
      'current_organization',
      'current_location',
      'current_deployment_date',
      'deployment_count',
      'warranty_expiry_date',
    ]);

    const sortBy = allowedSortFields.has(filters?.sort_by || '') ? (filters!.sort_by as string) : 'uid';
    const sortAscending = (filters?.sort_order || 'asc').toLowerCase() !== 'desc';

    let query = this.supabase
      .from('v_uid_deployment_status')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (filters?.uid) {
      query = query.eq('uid', filters.uid);
    }

    if (filters?.part_number) {
      query = query.eq('client_part_number', filters.part_number);
    }

    if (filters?.organization) {
      query = query.ilike('current_organization', `%${filters.organization}%`);
    }

    if (filters?.location) {
      query = query.ilike('current_location', `%${filters.location}%`);
    }

    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim();
      query = query.or(
        [
          `uid.ilike.%${q}%`,
          `client_part_number.ilike.%${q}%`,
          `item_name.ilike.%${q}%`,
          `item_code.ilike.%${q}%`,
          `current_organization.ilike.%${q}%`,
          `current_location.ilike.%${q}%`,
          `current_level.ilike.%${q}%`,
        ].join(','),
      );
    }

    query = query.order(sortBy, { ascending: sortAscending }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Fetch deployment status error:', error);
      throw new BadRequestException(error.message);
    }

    return {
      data: data || [],
      total: count || 0,
      offset,
      limit,
    };
  }

  async getDeployments(tenantId: string, filters?: {
    uid_id?: string;
    organization?: string;
    deployment_level?: string;
    is_current?: boolean;
  }) {
    let query = this.supabase
      .from('product_deployment_history')
      .select(`
        *,
        uid:uid_registry (
          uid,
          client_part_number,
          entity_id,
          entity_type
        )
      `)
      .eq('tenant_id', tenantId)
      .order('deployment_date', { ascending: false });

    if (filters?.uid_id) {
      query = query.eq('uid_id', filters.uid_id);
    }

    if (filters?.organization) {
      query = query.ilike('organization_name', `%${filters.organization}%`);
    }

    if (filters?.deployment_level) {
      query = query.eq('deployment_level', filters.deployment_level);
    }

    if (filters?.is_current !== undefined) {
      query = query.eq('is_current_location', filters.is_current);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Fetch deployments error:', error);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async getDeploymentById(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('product_deployment_history')
      .select(`
        *,
        uid:uid_registry (
          uid,
          client_part_number,
          entity_id,
          entity_type
        ),
        parent:product_deployment_history!parent_deployment_id (
          id,
          organization_name,
          location_name,
          deployment_level
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Deployment not found');
    }

    return data;
  }

  async getDeploymentChain(tenantId: string, uidId: string) {
    // Get all deployments for this UID ordered by date
    const { data: deployments, error } = await this.supabase
      .from('product_deployment_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('uid_id', uidId)
      .order('deployment_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Fetch deployment chain error:', error);
      throw new BadRequestException(error.message);
    }

    // Build hierarchy
    const deploymentMap = new Map(deployments.map(d => [d.id, { ...d, children: [] }]));
    const rootDeployments: any[] = [];

    deployments.forEach(deployment => {
      const node = deploymentMap.get(deployment.id);
      if (deployment.parent_deployment_id) {
        const parent = deploymentMap.get(deployment.parent_deployment_id);
        if (parent) {
          parent.children.push(node);
        } else {
          rootDeployments.push(node);
        }
      } else {
        rootDeployments.push(node);
      }
    });

    return rootDeployments;
  }

  async getCurrentLocation(tenantId: string, uidId: string) {
    const { data, error } = await this.supabase
      .from('product_deployment_history')
      .select(`
        *,
        uid:uid_registry (
          uid,
          client_part_number,
          item:items (
            name,
            code
          )
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('uid_id', uidId)
      .eq('is_current_location', true)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      console.error('Fetch current location error:', error);
      throw new BadRequestException(error.message);
    }

    return data || null;
  }

  async updateDeployment(tenantId: string, userId: string, id: string, dto: UpdateDeploymentDto) {
    const { data: current, error: currentError } = await this.supabase
      .from('product_deployment_history')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (currentError) throw new BadRequestException(currentError.message);
    if (!current) throw new NotFoundException('Deployment not found');
    const commissioningConfirmed = dto.commissioning_confirmed === true || current.commissioning_confirmed === true;
    if (current.commissioning_confirmed && dto.commissioning_confirmed === false) {
      throw new BadRequestException('A confirmed commissioning cannot be reversed. Use the controlled asset transfer or decommissioning process.');
    }
    const customerId = String(dto.customer_id || current.customer_id || '').trim() || null;
    if (commissioningConfirmed && !customerId) throw new BadRequestException('Select an existing customer before confirming commissioning.');
    if (commissioningConfirmed && dto.is_current_location === false) throw new BadRequestException('A commissioned asset must be recorded at its current customer location.');
    if (customerId) {
      const { data: customer } = await this.supabase.from('customers').select('id').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle();
      if (!customer) throw new BadRequestException('Selected customer does not belong to this company.');
    }
    const { data, error } = await this.supabase
      .from('product_deployment_history')
      .update({
        customer_id: customerId,
        organization_name: dto.organization_name,
        location_name: dto.location_name,
        deployment_date: dto.deployment_date,
        contact_person: dto.contact_person,
        contact_email: dto.contact_email,
        contact_phone: dto.contact_phone,
        deployment_notes: dto.deployment_notes,
        warranty_expiry_date: dto.warranty_expiry_date,
        maintenance_schedule: dto.maintenance_schedule,
        is_current_location: dto.is_current_location,
        commissioning_confirmed: commissioningConfirmed,
        commissioned_at: !current.commissioning_confirmed && commissioningConfirmed ? new Date().toISOString() : current.commissioned_at,
        commissioned_by: !current.commissioning_confirmed && commissioningConfirmed ? userId : current.commissioned_by,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('Update deployment error:', error);
      throw new BadRequestException(error.message);
    }

    if (!commissioningConfirmed) return data;
    const { data: uid, error: uidError } = await this.supabase
      .from('uid_registry')
      .select('id, uid, entity_id, entity_type, client_part_number')
      .eq('tenant_id', tenantId)
      .eq('id', data.uid_id)
      .maybeSingle();
    if (uidError || !uid) throw new NotFoundException('UID not found');
    const installedAsset = data.installed_asset_id
      ? { id: data.installed_asset_id, customer_id: customerId }
      : await this.createInstalledAssetForCommissioning({ tenantId, userId, customerId: customerId!, uid, deployment: data });
    const warrantyEntitlement = data.warranty_entitlement_id
      ? { id: data.warranty_entitlement_id }
      : await this.createWarrantyEntitlementForCommissioning({ tenantId, userId, customerId: customerId!, uid, deployment: data, installedAsset });
    const { data: linked, error: linkError } = await this.supabase
      .from('product_deployment_history')
      .update({ installed_asset_id: installedAsset.id, warranty_entitlement_id: warrantyEntitlement?.id || null })
      .eq('tenant_id', tenantId)
      .eq('id', data.id)
      .select()
      .single();
    if (linkError) throw new BadRequestException(linkError.message);
    return { ...linked, installed_asset: installedAsset, warranty_entitlement: warrantyEntitlement };
  }

  async setCurrentLocation(tenantId: string, uidId: string, deploymentId: string) {
    // First, unmark all other deployments as current
    const { error: unmarkError } = await this.supabase
      .from('product_deployment_history')
      .update({ is_current_location: false })
      .eq('tenant_id', tenantId)
      .eq('uid_id', uidId)
      .neq('id', deploymentId);

    if (unmarkError) {
      console.error('Unmark current location error:', unmarkError);
      throw new BadRequestException(unmarkError.message);
    }

    // Then mark the specified deployment as current
    const { data, error } = await this.supabase
      .from('product_deployment_history')
      .update({ is_current_location: true })
      .eq('id', deploymentId)
      .eq('tenant_id', tenantId)
      .eq('uid_id', uidId)
      .select()
      .single();

    if (error) {
      console.error('Set current location error:', error);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async deleteDeployment(tenantId: string, id: string) {
    // Check if this deployment has children
    const { data: children } = await this.supabase
      .from('product_deployment_history')
      .select('id')
      .eq('parent_deployment_id', id)
      .eq('tenant_id', tenantId);

    if (children && children.length > 0) {
      throw new BadRequestException('Cannot delete deployment with child deployments');
    }

    const { error } = await this.supabase
      .from('product_deployment_history')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Delete deployment error:', error);
      throw new BadRequestException(error.message);
    }

    return { message: 'Deployment deleted successfully' };
  }

  // Public warranty portal methods (no tenant check)
  async searchByPartNumberOrUid(search: string) {
    // Try to find by client_part_number or uid
    const { data, error } = await this.supabase
      .from('uid_registry')
      .select(`
        id,
        uid,
        client_part_number,
        item:items (
          name,
          code
        )
      `)
      .or(`uid.eq.${search},client_part_number.eq.${search}`)
      .limit(1)
      .single();

    if (error || !data) {
      throw new NotFoundException('Product not found');
    }

    // Get current deployment with public token
    const { data: deployment } = await this.supabase
      .from('product_deployment_history')
      .select('public_access_token')
      .eq('uid_id', data.id)
      .eq('is_current_location', true)
      .single();

    return {
      uid_id: data.id,
      uid: data.uid,
      client_part_number: data.client_part_number,
      item: data.item,
      public_token: deployment?.public_access_token || null,
    };
  }

  async getByPublicToken(token: string) {
    const { data, error } = await this.supabase
      .from('product_deployment_history')
      .select(`
        id,
        deployment_level,
        organization_name,
        location_name,
        deployment_date,
        contact_person,
        contact_email,
        contact_phone,
        deployment_notes,
        warranty_expiry_date,
        maintenance_schedule,
        is_current_location,
        uid:uid_registry (
          uid,
          client_part_number,
          item:items (
            name,
            code
          )
        )
      `)
      .eq('public_access_token', token)
      .single();

    if (error || !data) {
      throw new NotFoundException('Invalid or expired warranty token');
    }

    // Get deployment history
    const { data: history } = await this.supabase
      .from('product_deployment_history')
      .select('deployment_level, organization_name, location_name, deployment_date, is_current_location')
      .eq('uid_id', (data.uid as any).id)
      .order('deployment_date', { ascending: true });

    return {
      ...data,
      history: history || [],
    };
  }

  async updateViaPublicToken(token: string, dto: PublicDeploymentUpdateDto) {
    // Get current deployment
    const { data: currentDeployment, error } = await this.supabase
      .from('product_deployment_history')
      .select('id, uid_id, tenant_id')
      .eq('public_access_token', token)
      .eq('is_current_location', true)
      .single();

    if (error || !currentDeployment) {
      throw new NotFoundException('Invalid or expired warranty token');
    }

    // Create new deployment as child of current
    const newToken = await this.generatePublicToken();
    
    const { data: newDeployment, error: createError } = await this.supabase
      .from('product_deployment_history')
      .insert({
        tenant_id: currentDeployment.tenant_id,
        uid_id: currentDeployment.uid_id,
        deployment_level: 'END_LOCATION', // Public updates default to END_LOCATION
        organization_name: dto.organization_name,
        location_name: dto.location_name,
        deployment_date: new Date().toISOString().split('T')[0],
        parent_deployment_id: currentDeployment.id,
        contact_email: dto.verification_email,
        deployment_notes: dto.deployment_notes || 'Updated via public warranty portal',
        is_current_location: true,
        public_access_token: newToken,
      })
      .select()
      .single();

    if (createError) {
      console.error('Public deployment update error:', createError);
      throw new BadRequestException(createError.message);
    }

    return {
      message: 'Location updated successfully',
      new_token: newToken,
    };
  }

  private async generatePublicToken(): Promise<string> {
    // Generate token: WRT-{16 chars}
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = 'WRT-';
    for (let i = 0; i < 16; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
