import { JobOrderService } from './job-order.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';

describe('JobOrderService inventory fallback', () => {
  const invokeDeduction = async (rows: any[], quantityChange: number) => {
    const selectQuery: any = {
      select: jest.fn(() => selectQuery),
      eq: jest.fn(() => selectQuery),
      order: jest.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn().mockResolvedValue({ error: null }),
    };
    const insertQuery: any = {
      insert: jest.fn().mockResolvedValue({ error: null }),
    };
    const from = jest.fn()
      .mockReturnValueOnce(selectQuery)
      .mockImplementation(() => updateQuery || insertQuery);
    const service = new JobOrderService({} as any);
    (service as any).supabase = { from };

    const promise = (service as any).adjustInventoryStockFallbackDirect({
      tenantId: 'tenant-1',
      itemId: 'item-1',
      warehouseId: 'warehouse-1',
      quantityChange,
      category: 'RAW_MATERIAL',
    });

    return { promise, from, updateQuery, insertQuery };
  };

  it('does not create a negative row when no stock exists', async () => {
    const result = await invokeDeduction([], -1);

    await expect(result.promise).rejects.toThrow('No inventory stock rows available');
    expect(result.from).toHaveBeenCalledTimes(1);
    expect(result.insertQuery.insert).not.toHaveBeenCalled();
  });

  it('rejects an insufficient SIV deduction before updating any row', async () => {
    const result = await invokeDeduction([
      { id: 'stock-1', quantity: 3, reserved_quantity: 1, available_quantity: 2 },
      { id: 'stock-2', quantity: 2, reserved_quantity: 0, available_quantity: 2 },
    ], -5);

    await expect(result.promise).rejects.toThrow('Insufficient inventory stock');
    expect(result.from).toHaveBeenCalledTimes(1);
    expect(result.updateQuery.update).not.toHaveBeenCalled();
  });

  it('deducts a valid SIV quantity across available location rows', async () => {
    const result = await invokeDeduction([
      { id: 'stock-1', quantity: 3, reserved_quantity: 1, available_quantity: 2 },
      { id: 'stock-2', quantity: 5, reserved_quantity: 0, available_quantity: 5 },
    ], -6);

    await expect(result.promise).resolves.toBeUndefined();
    expect(result.updateQuery.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ quantity: 1 }));
    expect(result.updateQuery.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ quantity: 1 }));
  });

  it('requires a registered receiving employee before a manual SIV can change stock', async () => {
    const service = new JobOrderService({} as any);
    const from = jest.fn();
    (service as any).supabase = { from };

    await expect(service.createManualStoreIssueVoucher(
      '11111111-1111-4111-8111-111111111111',
      {
        itemId: '22222222-2222-4222-8222-222222222222',
        issueQuantity: 1,
        issuedToEmployeeId: '',
        userId: '33333333-3333-4333-8333-333333333333',
      },
    )).rejects.toThrow('Select the employee receiving the material');

    expect(from).not.toHaveBeenCalled();
  });

  it('returns only the minimal active employee fields required by the SIV selector', async () => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn().mockResolvedValue({
        data: [{
          id: 'employee-1',
          employee_code: 'EMP-001',
          employee_name: 'Store Receiver',
          department: 'Production',
          designation: 'Operator',
          status: 'ACTIVE',
        }],
        error: null,
      }),
    };
    const service = new JobOrderService({} as any);
    (service as any).supabase = { from: jest.fn(() => query) };

    await expect(service.getActiveEmployeesForStoreIssue('tenant-1')).resolves.toEqual([{
      id: 'employee-1',
      employeeCode: 'EMP-001',
      employeeName: 'Store Receiver',
      department: 'Production',
      designation: 'Operator',
    }]);
    expect(query.eq).toHaveBeenCalledWith('status', 'ACTIVE');
  });
});
