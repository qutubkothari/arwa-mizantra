import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IntegrationHubService } from './integration-hub.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-anon-key';

describe('IntegrationHubService controls', () => {
  const audit = { logActivity: jest.fn().mockResolvedValue(undefined) };
  let service: IntegrationHubService;
  const admin = { id: 'admin-1', role: 'ADMIN' };

  beforeEach(() => { jest.clearAllMocks(); service = new IntegrationHubService(audit as any); });

  it('blocks non-administrators before reading or changing a connector', async () => {
    await expect(service.dashboard('tenant-a', { id: 'user-1', role: 'PRODUCTION' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.save('tenant-a', { id: 'user-1', role: 'PRODUCTION' }, { connector_code: 'CRM' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never returns vault references to the browser payload', () => {
    const safe = (service as any).safeConnection({ id: 'connection-1', connector_code: 'CRM', secret_reference: 'vault://client/crm', configuration: { mode: 'TEST' } });
    expect(safe).toEqual({ id: 'connection-1', connector_code: 'CRM', configuration: { mode: 'TEST' } });
    expect(safe.secret_reference).toBeUndefined();
  });

  it('rejects a pasted credential value even for an administrator', async () => {
    jest.spyOn(service, 'dashboard').mockResolvedValue({ catalog: [{ connector_code: 'CRM', connector_name: 'CRM / customer sync', market_profile: 'SHARED' }] } as any);
    await expect(service.save('tenant-a', admin, { connector_code: 'CRM', secret_reference: 'api_key=not-a-vault-reference' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows only a short identifier for an idempotency key', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'connection-1', connector_code: 'CRM', status: 'TESTING' }, error: null });
    const eqSecond = jest.fn(() => ({ single })); const eqFirst = jest.fn(() => ({ eq: eqSecond }));
    const eventSingle = jest.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null });
    const select = jest.fn(() => ({ eq: eqFirst })); const upsert = jest.fn(() => ({ select: jest.fn(() => ({ single: eventSingle })) }));
    (service as any).db = { from: jest.fn((table: string) => table === 'integration_connections' ? { select } : { upsert }) };
    const result = await service.recordTest('tenant-a', admin, 'connection-1', { idempotency_key: 'x'.repeat(300) });
    expect(result.id).toBe('event-1');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: 'x'.repeat(180) }), expect.any(Object));
    expect(audit.logActivity).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', action: 'INTEGRATION_TEST_EVENT_RECORDED' }));
  });
});
