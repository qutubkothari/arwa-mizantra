import { CrossModuleExceptionService } from './cross-module-exception.service';

describe('CrossModuleExceptionService', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
    process.env.SUPABASE_KEY ||= 'test-key';
  });

  it('converts live cross-module records into stable, evidence-linked decisions', async () => {
    const service = new CrossModuleExceptionService();
    jest.spyOn(service as any, 'safeRows').mockImplementation(async (table: string) => {
      if (table === 'production_machine_alerts') return [{ id: 'machine-1', alert_type: 'VIBRATION', severity: 'HIGH', title: 'M14 vibration rising', work_station_id: 'station-1', event_id: 'event-1', details: { estimated_financial_exposure: 32000 } }];
      if (table === 'accounting_open_items') return [{ id: 'ar-1', due_date: '2020-01-01', original_amount: 100000, settled_amount: 25000, currency_code: 'AED' }];
      return [];
    });

    const decisions = await service.collect('tenant-1');

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'machine-alert:machine-1', domain: 'MAINTENANCE', financial_impact_value: 32000, source: 'LIVE_ERP_CROSS_MODULE' }),
      expect.objectContaining({ domain: 'FINANCE', financial_impact_value: 75000, source: 'LIVE_ERP_CROSS_MODULE' }),
    ]));
    expect(decisions.every((decision) => decision.evidence.source_table)).toBe(true);
    expect(decisions.every((decision) => decision.priority_score >= 0 && decision.priority_score <= 99)).toBe(true);
  });

  it('does not manufacture decisions when a source table is unavailable or empty', async () => {
    const service = new CrossModuleExceptionService();
    jest.spyOn(service as any, 'safeRows').mockResolvedValue([]);
    await expect(service.collect('tenant-1')).resolves.toEqual([]);
  });
});
