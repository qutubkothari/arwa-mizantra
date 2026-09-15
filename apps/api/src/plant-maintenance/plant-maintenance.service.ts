import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class PlantMaintenanceService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

  async assets(tenantId: string) { const { data, error } = await this.db.from('plant_assets').select('*').eq('tenant_id', tenantId).order('asset_code'); if (error) throw new BadRequestException(error.message); return data || []; }

  async createAsset(tenantId: string, body: any) {
    const asset_code = String(body.asset_code || '').trim(), asset_name = String(body.asset_name || '').trim();
    if (!asset_code || !asset_name) throw new BadRequestException('Asset code and name are required.');
    const work_station_id = String(body.work_station_id || '').trim() || null;
    if (work_station_id) { const station = await this.db.from('work_stations').select('id').eq('tenant_id', tenantId).eq('id', work_station_id).maybeSingle(); if (station.error || !station.data) throw new BadRequestException('Selected work station was not found.'); }
    const { data, error } = await this.db.from('plant_assets').insert({ tenant_id: tenantId, asset_code, asset_name, work_station_id, asset_type: body.asset_type || null, location_name: body.location_name || null, criticality: body.criticality || 'MEDIUM', manufacturer: body.manufacturer || null, model_number: body.model_number || null, serial_number: body.serial_number || null, commissioned_on: body.commissioned_on || null }).select().single();
    if (error) throw new BadRequestException(error.code === '23505' ? 'Asset code already exists.' : error.message); return data;
  }

  async workOrders(tenantId: string) { const { data, error } = await this.db.from('plant_maintenance_work_orders').select('*,asset:plant_assets(asset_code,asset_name,criticality,location_name,work_station_id)').eq('tenant_id', tenantId).order('created_at', { ascending: false }); if (error) throw new BadRequestException(error.message); return data || []; }

  async createWorkOrder(tenantId: string, userId: string, body: any) {
    const asset_id = String(body.asset_id || '').trim(); if (!asset_id || !body.work_type || !body.description) throw new BadRequestException('Asset, work type and description are required.');
    const { data: asset } = await this.db.from('plant_assets').select('id').eq('tenant_id', tenantId).eq('id', asset_id).maybeSingle(); if (!asset) throw new BadRequestException('Plant asset not found.');
    const planned_start = body.planned_start ? new Date(body.planned_start).toISOString() : null, planned_end = body.planned_end ? new Date(body.planned_end).toISOString() : null;
    if (planned_start && planned_end && planned_end <= planned_start) throw new BadRequestException('Planned maintenance end must be after its start.');
    const { count } = await this.db.from('plant_maintenance_work_orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId); const work_order_number = `PM-${String((count || 0) + 1).padStart(6, '0')}`;
    const { data, error } = await this.db.from('plant_maintenance_work_orders').insert({ tenant_id: tenantId, work_order_number, asset_id, work_type: body.work_type, priority: body.priority || 'MEDIUM', planned_date: body.planned_date || planned_start?.slice(0, 10) || null, planned_start, planned_end, downtime_minutes: Math.max(0, Number(body.downtime_minutes || 0)), reported_at: body.work_type === 'BREAKDOWN' ? new Date().toISOString() : null, description: String(body.description).trim(), created_by: userId }).select().single();
    if (error) throw new BadRequestException(error.message); return data;
  }

  async updateWorkOrder(tenantId: string, id: string, body: any) { const status = String(body.status || '').toUpperCase(); if (!['OPEN','IN_PROGRESS','COMPLETED','CANCELLED'].includes(status)) throw new BadRequestException('Invalid work-order status.'); const patch:any={status,updated_at:new Date().toISOString()}; if(status==='IN_PROGRESS')patch.started_at=new Date().toISOString(); if(status==='COMPLETED'){patch.completed_at=new Date().toISOString();patch.downtime_minutes=Math.max(0,Number(body.downtime_minutes||0));patch.resolution_note=String(body.resolution_note||'').trim()||null;} const {data,error}=await this.db.from('plant_maintenance_work_orders').update(patch).eq('tenant_id',tenantId).eq('id',id).select().maybeSingle(); if(error||!data)throw new BadRequestException(error?.message||'Work order not found.');return data; }
}
