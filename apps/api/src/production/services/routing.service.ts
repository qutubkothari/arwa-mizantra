import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface ProductionRouting {
  id: string;
  tenant_id: string;
  bom_id: string;
  sequence_no: number;
  work_station_id: string;
  operation_name: string;
  setup_time_minutes: number;
  cycle_time_minutes: number;
  qc_required: boolean;
  notes: string | null;
  estimated_start_offset_hours: number; // Hours after previous operation
  estimated_duration_hours: number; // Total time for this operation
  manhours_required: number; // Labor hours needed
  created_at: string;
}

export interface CreateProductionRoutingDto {
  bom_id: string;
  sequence_no: number;
  work_station_id: string;
  operation_name: string;
  setup_time_minutes?: number;
  cycle_time_minutes?: number;
  qc_required?: boolean;
  notes?: string;
  estimated_start_offset_hours?: number;
  estimated_duration_hours?: number;
  manhours_required?: number;
}

export interface UpdateProductionRoutingDto {
  sequence_no?: number;
  work_station_id?: string;
  operation_name?: string;
  setup_time_minutes?: number;
  cycle_time_minutes?: number;
  qc_required?: boolean;
  notes?: string;
  estimated_start_offset_hours?: number;
  estimated_duration_hours?: number;
  manhours_required?: number;
}

@Injectable()
export class RoutingService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  /**
   * Create a new routing operation for a BOM
   */
  async create(
    tenantId: string,
    dto: CreateProductionRoutingDto,
  ): Promise<ProductionRouting> {
    console.log('[RoutingService] create called with:', { tenantId, dto });
    
    // Verify BOM exists
    const { data: bom, error: bomError } = await this.supabase
      .from('bom_headers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', dto.bom_id)
      .single();

    console.log('[RoutingService] BOM lookup result:', { bom, bomError });

    if (bomError || !bom) {
      throw new NotFoundException(`BOM with ID ${dto.bom_id} not found`);
    }

    // Verify work station exists
    const { data: station, error: stationError } = await this.supabase
      .from('work_stations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', dto.work_station_id)
      .single();

    if (stationError || !station) {
      throw new NotFoundException(`Work station with ID ${dto.work_station_id} not found`);
    }

    // Check for sequence conflict
    const { data: existing } = await this.supabase
      .from('production_routing')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('bom_id', dto.bom_id)
      .eq('sequence_no', dto.sequence_no)
      .maybeSingle();

    if (existing) {
      throw new BadRequestException(
        `Sequence ${dto.sequence_no} already exists for this BOM`,
      );
    }

    const { data, error } = await this.supabase
      .from('production_routing')
      .insert({
        tenant_id: tenantId,
        bom_id: dto.bom_id,
        sequence_no: dto.sequence_no,
        work_station_id: dto.work_station_id,
        operation_name: dto.operation_name,
        setup_time_minutes: dto.setup_time_minutes || 0,
        cycle_time_minutes: dto.cycle_time_minutes || 0,
        qc_required: dto.qc_required !== undefined ? dto.qc_required : false,
        notes: dto.notes || null,
        estimated_start_offset_hours: dto.estimated_start_offset_hours || 0,
        estimated_duration_hours: dto.estimated_duration_hours || 1,
        manhours_required: dto.manhours_required || 1,
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Failed to create routing: ${error.message}`);
    }

    return data;
  }

  /**
   * Get all routing operations for a BOM
   */
  async findByBom(tenantId: string, bomId: string): Promise<ProductionRouting[]> {
    const { data, error } = await this.supabase
      .from('production_routing')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('bom_id', bomId)
      .order('sequence_no', { ascending: true });

    if (error) {
      throw new BadRequestException(`Failed to fetch routing: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get all routing operations with work station details
   */
  async findByBomWithStations(tenantId: string, bomId: string): Promise<any[]> {
    // Fetch routing operations
    const { data: routings, error: routingError } = await this.supabase
      .from('production_routing')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('bom_id', bomId)
      .order('sequence_no', { ascending: true});

    if (routingError) {
      throw new BadRequestException(`Failed to fetch routing: ${routingError.message}`);
    }

    if (!routings || routings.length === 0) {
      return [];
    }

    // Fetch work stations
    const stationIds = [...new Set(routings.map((r) => r.work_station_id))];
    const { data: stations, error: stationError } = await this.supabase
      .from('work_stations')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', stationIds);

    if (stationError) {
      throw new BadRequestException(`Failed to fetch work stations: ${stationError.message}`);
    }

    // Build station map
    const stationMap = new Map(stations?.map((s) => [s.id, s]) || []);

    // Merge data
    return routings.map((routing) => ({
      ...routing,
      work_station: stationMap.get(routing.work_station_id) || null,
    }));
  }

  /**
   * Get single routing operation
   */
  async findOne(tenantId: string, id: string): Promise<ProductionRouting> {
    const { data, error } = await this.supabase
      .from('production_routing')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Routing operation with ID ${id} not found`);
    }

    return data;
  }

  /**
   * Update routing operation
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateProductionRoutingDto,
  ): Promise<ProductionRouting> {
    // Verify routing exists
    const existing = await this.findOne(tenantId, id);

    // If changing work station, verify it exists
    if (dto.work_station_id && dto.work_station_id !== existing.work_station_id) {
      const { data: station, error: stationError } = await this.supabase
        .from('work_stations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('id', dto.work_station_id)
        .single();

      if (stationError || !station) {
        throw new NotFoundException(`Work station with ID ${dto.work_station_id} not found`);
      }
    }

    // If changing sequence, check for conflicts
    if (dto.sequence_no !== undefined && dto.sequence_no !== existing.sequence_no) {
      const { data: conflict } = await this.supabase
        .from('production_routing')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('bom_id', existing.bom_id)
        .eq('sequence_no', dto.sequence_no)
        .neq('id', id)
        .maybeSingle();

      if (conflict) {
        throw new BadRequestException(
          `Sequence ${dto.sequence_no} already exists for this BOM`,
        );
      }
    }

    const { data, error } = await this.supabase
      .from('production_routing')
      .update(dto)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Failed to update routing: ${error.message}`);
    }

    return data;
  }

  /**
   * Delete routing operation
   */
  async delete(tenantId: string, id: string): Promise<void> {
    // Check if routing has any completions
    const { data: completions } = await this.supabase
      .from('station_completions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('routing_id', id)
      .limit(1);

    if (completions && completions.length > 0) {
      throw new BadRequestException(
        'Cannot delete routing operation with existing completions',
      );
    }

    const { error } = await this.supabase
      .from('production_routing')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) {
      throw new BadRequestException(`Failed to delete routing: ${error.message}`);
    }
  }

  /**
   * Copy routing from one BOM to another
   */
  async copyRouting(
    tenantId: string,
    sourceBomId: string,
    targetBomId: string,
  ): Promise<ProductionRouting[]> {
    // Verify target BOM exists
    const { data: targetBom, error: bomError } = await this.supabase
      .from('bom_headers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', targetBomId)
      .single();

    if (bomError || !targetBom) {
      throw new NotFoundException(`Target BOM with ID ${targetBomId} not found`);
    }

    // Check if target BOM already has routing
    const { data: existingRouting } = await this.supabase
      .from('production_routing')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('bom_id', targetBomId)
      .limit(1);

    if (existingRouting && existingRouting.length > 0) {
      throw new BadRequestException('Target BOM already has routing operations');
    }

    // Fetch source routing
    const sourceRouting = await this.findByBom(tenantId, sourceBomId);

    if (sourceRouting.length === 0) {
      throw new NotFoundException(`No routing found for source BOM ${sourceBomId}`);
    }

    // Copy operations
    const newRoutings = sourceRouting.map((r) => ({
      tenant_id: tenantId,
      bom_id: targetBomId,
      sequence_no: r.sequence_no,
      work_station_id: r.work_station_id,
      operation_name: r.operation_name,
      setup_time_minutes: r.setup_time_minutes,
      cycle_time_minutes: r.cycle_time_minutes,
      qc_required: r.qc_required,
      notes: r.notes,
    }));

    const { data, error } = await this.supabase
      .from('production_routing')
      .insert(newRoutings)
      .select();

    if (error) {
      throw new BadRequestException(`Failed to copy routing: ${error.message}`);
    }

    return data;
  }

  /**
   * Resequence routing operations
   */
  async resequence(
    tenantId: string,
    bomId: string,
    routingIds: string[],
  ): Promise<ProductionRouting[]> {
    // Verify all routing IDs belong to this BOM
    const { data: existingRoutings, error } = await this.supabase
      .from('production_routing')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('bom_id', bomId)
      .in('id', routingIds);

    if (error) {
      throw new BadRequestException(`Failed to fetch routing: ${error.message}`);
    }

    if (!existingRoutings || existingRoutings.length !== routingIds.length) {
      throw new BadRequestException('Some routing IDs do not belong to this BOM');
    }

    // Update sequences
    const updates = routingIds.map((id, index) =>
      this.supabase
        .from('production_routing')
        .update({ sequence_no: (index + 1) * 10 })
        .eq('tenant_id', tenantId)
        .eq('id', id),
    );

    await Promise.all(updates);

    // Return updated routing
    return this.findByBom(tenantId, bomId);
  }
}
