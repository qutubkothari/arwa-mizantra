import { DashboardService } from './dashboard.service';

class QueryStub implements PromiseLike<any> {
  calls: Array<[string, ...any[]]> = [];

  constructor(private readonly result: any) {}

  select(...args: any[]) { this.calls.push(['select', ...args]); return this; }
  eq(...args: any[]) { this.calls.push(['eq', ...args]); return this; }
  or(...args: any[]) { this.calls.push(['or', ...args]); return this; }
  order(...args: any[]) { this.calls.push(['order', ...args]); return this; }
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

describe('DashboardService reminder queue', () => {
  it('uses the same complete PO and QC definitions for dashboard consumers', async () => {
    const poQuery = new QueryStub({ data: [{ id: 'po-1' }], error: null });
    const qcQuery = new QueryStub({ data: [{ id: 'grn-1' }], error: null });
    const config = { get: (key: string) => key === 'SUPABASE_URL' ? 'https://example.supabase.co' : key === 'SUPABASE_KEY' ? 'test-key' : undefined };
    const service = new DashboardService(config as any, { isEnabled: () => false } as any);
    (service as any).supabase = {
      from: (table: string) => table === 'purchase_orders' ? poQuery : qcQuery,
    };

    await expect(service.getReminderQueue('tenant-1')).resolves.toEqual({
      pendingPOs: [{ id: 'po-1' }],
      pendingQC: [{ id: 'grn-1' }],
    });
    expect(poQuery.calls).toContainEqual(['eq', 'tenant_id', 'tenant-1']);
    expect(poQuery.calls).toContainEqual(['eq', 'status', 'PENDING']);
    expect(poQuery.calls).toContainEqual(['eq', 'pr_po_status', 'PENDING']);
    expect(qcQuery.calls).toContainEqual(['eq', 'tenant_id', 'tenant-1']);
    expect(qcQuery.calls).toContainEqual(['eq', 'is_active', true]);
    expect(qcQuery.calls).toContainEqual(['eq', 'qc_completed', false]);
  });
});
