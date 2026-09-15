import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ProductionAutonomyService {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private text(value: any) { return String(value || '').trim(); }
  private fail(error: any, fallback: string): never { throw new BadRequestException(error?.message || fallback); }

  async dashboard(tenantId: string) {
    const [alerts, exceptions, mes, instructions, tariffs] = await Promise.all([
      this.db.from('production_machine_alerts').select('*').eq('tenant_id', tenantId).eq('status', 'OPEN'),
      this.db.from('production_autonomy_exceptions').select('*').eq('tenant_id', tenantId).eq('status', 'OPEN').order('created_at', { ascending: false }),
      this.db.from('production_mes_executions').select('*').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(100),
      this.db.from('production_digital_instructions').select('*').eq('tenant_id', tenantId).eq('status', 'APPROVED'),
      this.db.from('production_energy_tariffs').select('*').eq('tenant_id', tenantId),
    ]);
    const error = alerts.error || exceptions.error || mes.error || instructions.error || tariffs.error;
    if (error) this.fail(error, 'Unable to load production autonomy dashboard.');
    const mesEvents = mes.data || [];
    const activeStations = new Set(mesEvents.filter((x: any) => ['START', 'RESUME'].includes(x.event_type)).map((x: any) => x.work_station_id));
    return { machine_alerts: alerts.data || [], exceptions: exceptions.data || [], mes_events: mesEvents,
      instructions: instructions.data || [], tariffs: tariffs.data || [],
      kpis: { open_machine_alerts: (alerts.data || []).length, open_exceptions: (exceptions.data || []).length,
        active_mes_runs: activeStations.size, approved_instructions: (instructions.data || []).length,
        configured_energy_stations: (tariffs.data || []).length } };
  }

  async mes(tenantId: string, userId: string, body: any) {
    const eventType = this.text(body.event_type).toUpperCase(), stationId = this.text(body.work_station_id);
    if (!stationId || !['START', 'PAUSE', 'RESUME', 'COMPLETE', 'MATERIAL_SCAN', 'QC_HOLD', 'FIRST_PIECE_APPROVED'].includes(eventType)) throw new BadRequestException('Valid station and MES event type are required.');
    if (['MATERIAL_SCAN', 'QC_HOLD'].includes(eventType) && !this.text(body.barcode || body.reason_code)) throw new BadRequestException('Material scan or QC hold needs barcode/reason evidence.');
    const { data, error } = await this.db.from('production_mes_executions').insert({ tenant_id: tenantId, job_order_id: body.job_order_id || null, work_station_id: stationId, instruction_id: body.instruction_id || null, operator_id: userId, event_type: eventType, barcode: this.text(body.barcode) || null, quantity: body.quantity == null ? null : Number(body.quantity), reason_code: this.text(body.reason_code) || null, evidence: body.evidence || {} }).select().single();
    if (error) this.fail(error, 'Unable to record MES event.'); return data;
  }

  async instructions(tenantId: string, userId: string, body: any) {
    const code = this.text(body.instruction_code).toUpperCase();
    if (!code || !this.text(body.title)) throw new BadRequestException('Instruction code and title are required.');
    const { data, error } = await this.db.from('production_digital_instructions').insert({ tenant_id: tenantId, instruction_code: code, title: this.text(body.title), work_station_id: body.work_station_id || null, content: body.content || {}, first_piece_required: body.first_piece_required === true, evidence_reference: this.text(body.evidence_reference) || null, created_by: userId }).select().single();
    if (error) this.fail(error, 'Unable to create digital instruction.'); return data;
  }

  async approveInstruction(tenantId: string, userId: string, id: string) {
    const { data, error } = await this.db.from('production_digital_instructions').update({ status: 'APPROVED', approved_by: userId, approved_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).eq('status', 'DRAFT').select().single();
    if (error || !data) this.fail(error, 'Draft instruction not found.'); return data;
  }

  async generateExceptions(tenantId: string) {
    const { data: alerts, error } = await this.db.from('production_machine_alerts').select('*').eq('tenant_id', tenantId).eq('status', 'OPEN'); if (error) this.fail(error, 'Unable to read machine alerts.');
    let created = 0;
    for (const alert of alerts || []) {
      const maintenance = ['TEMPERATURE', 'VIBRATION'].includes(alert.alert_type);
      const { data, error: insertError } = await this.db.from('production_autonomy_exceptions').upsert({ tenant_id: tenantId, source_type: 'MACHINE_ALERT', source_id: alert.id, work_station_id: alert.work_station_id, severity: alert.severity, exception_type: alert.alert_type, recommendation: maintenance ? 'Create predictive-maintenance work order and remove station from dispatch.' : 'Place output on quality hold and inspect first piece.', recommended_action: maintenance ? 'CREATE_MAINTENANCE' : 'QUALITY_HOLD' }, { onConflict: 'tenant_id,source_type,source_id', ignoreDuplicates: true }).select().maybeSingle();
      if (insertError) this.fail(insertError, 'Unable to create autonomy exception.'); if (data) created++;
    }
    return { created, method: 'Explainable threshold/rule control. Human approval remains required before any schedule or maintenance action.' };
  }

  async tariff(tenantId: string, body: any) {
    if (!body.work_station_id || !Number.isFinite(Number(body.cost_per_kwh)) || Number(body.cost_per_kwh) < 0) throw new BadRequestException('Station and non-negative energy tariff are required.');
    const { data, error } = await this.db.from('production_energy_tariffs').upsert({ tenant_id: tenantId, work_station_id: body.work_station_id, cost_per_kwh: Number(body.cost_per_kwh), carbon_kg_per_kwh: Number(body.carbon_kg_per_kwh || 0.4), updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,work_station_id' }).select().single();
    if (error) this.fail(error, 'Unable to save energy tariff.'); return data;
  }

  async mapStationAsset(tenantId: string, body: any) {
    if (!this.text(body.work_station_id) || !this.text(body.asset_id)) throw new BadRequestException('Work station and plant asset are required.');
    const { data: asset, error: assetError } = await this.db.from('plant_assets').select('id').eq('tenant_id', tenantId).eq('id', body.asset_id).maybeSingle(); if (assetError || !asset) this.fail(assetError, 'Plant asset not found.');
    const { data, error } = await this.db.from('production_station_asset_maps').upsert({ tenant_id: tenantId, work_station_id: body.work_station_id, asset_id: body.asset_id }, { onConflict: 'tenant_id,work_station_id' }).select().single(); if (error) this.fail(error, 'Unable to map station to plant asset.'); return data;
  }

  async runAps(tenantId: string) {
    const [stationsResult, statesResult, alertsResult] = await Promise.all([this.db.from('work_stations').select('id,station_code,station_name,capacity_per_hour').eq('tenant_id', tenantId).eq('is_active', true), this.db.from('production_machine_states').select('*').eq('tenant_id', tenantId), this.db.from('production_machine_alerts').select('*').eq('tenant_id', tenantId).eq('status', 'OPEN')]);
    const error = stationsResult.error || statesResult.error || alertsResult.error; if (error) this.fail(error, 'Unable to evaluate APS constraints.');
    const stateByStation = new Map((statesResult.data || []).map((x: any) => [x.work_station_id, x])); const alertByStation = new Map<string, any[]>();
    for (const alert of alertsResult.data || []) alertByStation.set(alert.work_station_id, [...(alertByStation.get(alert.work_station_id) || []), alert]);
    const candidates = (stationsResult.data || []).map((station: any) => { const state = stateByStation.get(station.id)?.state || 'UNKNOWN', alerts = alertByStation.get(station.id) || [], blocked = ['STOPPED', 'FAULT'].includes(state) || alerts.some((x: any) => ['HIGH', 'CRITICAL'].includes(x.severity)), capacity = Number(station.capacity_per_hour || 0), score = Math.max(0, (blocked ? 0 : 100) + Math.min(capacity, 100) - alerts.length * 15); return { station, state, alerts, blocked, score }; }).sort((a: any, b: any) => b.score - a.score);
    const proposals = [];
    for (const candidate of candidates) { const recommendation = candidate.blocked ? `Do not dispatch to ${candidate.station.station_code}; resolve ${candidate.alerts.length || 1} machine constraint(s) first.` : `Preferred dispatch station: ${candidate.station.station_code}; available capacity ${candidate.station.capacity_per_hour || 0}/hour.`; const { data, error: insertError } = await this.db.from('production_aps_recommendations').insert({ tenant_id: tenantId, work_station_id: candidate.station.id, priority_score: candidate.score, recommendation, reasoning: { machine_state: candidate.state, open_alerts: candidate.alerts.length, capacity_per_hour: candidate.station.capacity_per_hour || 0, constraints_checked: ['machine_state', 'telemetry_alerts', 'station_capacity'] } }).select().single(); if (insertError) this.fail(insertError, 'Unable to store APS proposal.'); proposals.push(data); }
    return { proposals, controls: 'Advisory APS only: it never changes a job order or schedule without an authorised planner action.' };
  }

  async visionInspection(tenantId: string, userId: string, body: any) {
    const verdict = this.text(body.verdict).toUpperCase(), stationId = this.text(body.work_station_id), confidence = Number(body.confidence_pct);
    if (!stationId || !this.text(body.source_image_reference) || !['PASS', 'FAIL', 'REVIEW'].includes(verdict)) throw new BadRequestException('Station, image reference, and PASS/FAIL/REVIEW verdict are required.');
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new BadRequestException('Confidence must be between 0 and 100.');
    const { data, error } = await this.db.from('production_vision_inspections').insert({ tenant_id: tenantId, work_station_id: stationId, job_order_id: body.job_order_id || null, source_image_reference: this.text(body.source_image_reference), inspection_type: this.text(body.inspection_type).toUpperCase() || 'GENERAL', verdict, confidence_pct: confidence, evidence: { ...(body.evidence || {}), recorded_by: userId, adapter: 'controlled-test-or-camera-gateway' } }).select().single(); if (error) this.fail(error, 'Unable to save vision inspection.');
    if (verdict !== 'PASS') { const { error: exceptionError } = await this.db.from('production_autonomy_exceptions').upsert({ tenant_id: tenantId, source_type: 'VISION_INSPECTION', source_id: data.id, work_station_id: stationId, severity: verdict === 'FAIL' ? 'HIGH' : 'MEDIUM', exception_type: 'VISION_' + verdict, recommendation: verdict === 'FAIL' ? 'Place affected output on quality hold and complete human QC disposition.' : 'Supervisor review of low-confidence or ambiguous inspection.', recommended_action: verdict === 'FAIL' ? 'QUALITY_HOLD' : 'SUPERVISOR_REVIEW' }, { onConflict: 'tenant_id,source_type,source_id', ignoreDuplicates: true }); if (exceptionError) this.fail(exceptionError, 'Unable to raise vision exception.'); }
    return data;
  }

  async dispatchPredictiveMaintenance(tenantId: string, userId: string) {
    const { data: exceptions, error } = await this.db.from('production_autonomy_exceptions').select('*').eq('tenant_id', tenantId).eq('status', 'OPEN').eq('recommended_action', 'CREATE_MAINTENANCE'); if (error) this.fail(error, 'Unable to read maintenance recommendations.');
    const { data: maps, error: mapError } = await this.db.from('production_station_asset_maps').select('*').eq('tenant_id', tenantId); if (mapError) this.fail(mapError, 'Unable to read station asset mappings.'); const assetByStation = new Map((maps || []).map((x: any) => [x.work_station_id, x.asset_id]));
    let created = 0; const unmapped: string[] = [];
    for (const exception of exceptions || []) { const assetId = assetByStation.get(exception.work_station_id); if (!assetId) { unmapped.push(exception.id); continue; } const marker = `[Autonomy exception ${exception.id}]`; const { data: existing, error: existingError } = await this.db.from('plant_maintenance_work_orders').select('id').eq('tenant_id', tenantId).ilike('description', `%${marker}%`).maybeSingle(); if (existingError) this.fail(existingError, 'Unable to evaluate existing predictive work order.'); if (existing) continue; const { count, error: countError } = await this.db.from('plant_maintenance_work_orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId); if (countError) this.fail(countError, 'Unable to number predictive work order.'); const { error: createError } = await this.db.from('plant_maintenance_work_orders').insert({ tenant_id: tenantId, work_order_number: `PM-${String((count || 0) + 1).padStart(6, '0')}`, asset_id: assetId, work_type: 'PREVENTIVE', priority: ['HIGH', 'CRITICAL'].includes(exception.severity) ? 'HIGH' : 'MEDIUM', planned_date: new Date().toISOString().slice(0, 10), description: `[Predictive maintenance] ${marker} ${exception.recommendation}`, created_by: userId }); if (createError) this.fail(createError, 'Unable to create predictive maintenance work order.'); created++; }
    return { created, unmapped_exception_ids: unmapped, controls: 'Work orders are created as OPEN; maintenance retains completion and safety authority.' };
  }

  async costIntelligence(tenantId: string) {
    const [energyResult, tariffResult, mesResult] = await Promise.all([this.db.from('production_machine_events').select('work_station_id,energy_kwh,occurred_at').eq('tenant_id', tenantId).not('energy_kwh', 'is', null).order('occurred_at', { ascending: false }).limit(500), this.db.from('production_energy_tariffs').select('*').eq('tenant_id', tenantId), this.db.from('production_mes_executions').select('work_station_id,event_type,quantity,occurred_at').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(500)]); const error = energyResult.error || tariffResult.error || mesResult.error; if (error) this.fail(error, 'Unable to calculate production cost intelligence.'); const tariffs = new Map((tariffResult.data || []).map((x: any) => [x.work_station_id, x])); const byStation = new Map<string, any>();
    for (const event of energyResult.data || []) { const row = byStation.get(event.work_station_id) || { work_station_id: event.work_station_id, energy_kwh: 0, energy_cost: 0, carbon_kg: 0 }; const tariff = tariffs.get(event.work_station_id), kwh = Number(event.energy_kwh || 0); row.energy_kwh += kwh; row.energy_cost += kwh * Number(tariff?.cost_per_kwh || 0); row.carbon_kg += kwh * Number(tariff?.carbon_kg_per_kwh || 0); byStation.set(event.work_station_id, row); }
    const rows = Array.from(byStation.values()); return { totals: { energy_kwh: rows.reduce((s: number, x: any) => s + x.energy_kwh, 0), energy_cost: rows.reduce((s: number, x: any) => s + x.energy_cost, 0), carbon_kg: rows.reduce((s: number, x: any) => s + x.carbon_kg, 0), quality_holds: (mesResult.data || []).filter((x: any) => x.event_type === 'QC_HOLD').length }, stations: rows };
  }

  async controlTower(tenantId: string) {
    const [dashboard, apsResult, cost, stationsResult, visionResult] = await Promise.all([this.dashboard(tenantId), this.db.from('production_aps_recommendations').select('*').eq('tenant_id', tenantId).eq('status', 'PROPOSED').order('created_at', { ascending: false }).limit(25), this.costIntelligence(tenantId), this.db.from('work_stations').select('id,station_code,station_name,capacity_per_hour').eq('tenant_id', tenantId).eq('is_active', true), this.db.from('production_vision_inspections').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20)]); const error = apsResult.error || stationsResult.error || visionResult.error; if (error) this.fail(error, 'Unable to load production control tower.'); const actions = [...dashboard.exceptions.map((x: any) => ({ source: 'AUTONOMY', priority: x.severity, title: x.exception_type, action: x.recommendation, id: x.id })), ...(apsResult.data || []).map((x: any) => ({ source: 'APS', priority: x.priority_score < 50 ? 'HIGH' : 'LOW', title: 'Dispatch proposal', action: x.recommendation, id: x.id }))]; return { kpis: { ...dashboard.kpis, ...cost.totals, active_stations: (stationsResult.data || []).length, vision_inspections: (visionResult.data || []).length }, actions, aps_recommendations: apsResult.data || [], vision_inspections: visionResult.data || [], cost, safety: 'All recommendations are explainable and advisory. Safety, quality disposition, dispatch and posting controls remain human-authorised.' };
  }
}
