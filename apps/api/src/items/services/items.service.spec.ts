import { BadRequestException } from '@nestjs/common';
import { ItemsService } from './items.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';

describe('ItemsService temporary R&D procurement items', () => {
  it('requires only an identifier', async () => {
    const service = new ItemsService({} as any);

    await expect(service.createRndTemporary('tenant-1', 'user-1', {
      vendor_id: '4f56087f-1086-4ff5-aec3-bf16c6aac604',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates an admin-approved temporary item with no reorder exposure and links its vendor', async () => {
    const service = new ItemsService({} as any);
    const itemId = 'f0bbc591-2f18-4bb2-a8f1-dc55d2d1981e';
    const vendorId = '4f56087f-1086-4ff5-aec3-bf16c6aac604';

    const duplicateQuery: any = {
      select: jest.fn(() => duplicateQuery),
      eq: jest.fn(() => duplicateQuery),
      ilike: jest.fn(() => duplicateQuery),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const vendorQuery: any = {
      select: jest.fn(() => vendorQuery),
      eq: jest.fn(() => vendorQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: vendorId, code: 'VND-1', name: 'R&D Supplier', is_active: true },
        error: null,
      }),
    };
    const itemInsertQuery: any = {
      insert: jest.fn(() => itemInsertQuery),
      select: jest.fn(() => itemInsertQuery),
      single: jest.fn().mockResolvedValue({
        data: { id: itemId, code: 'OEM-RND-001', name: 'Prototype cable', description: 'Prototype cable', uom: 'NOS', standard_cost: 125.5 },
        error: null,
      }),
    };
    const vendorLinkQuery: any = {
      insert: jest.fn().mockResolvedValue({ error: null }),
    };
    let itemCalls = 0;
    (service as any).supabase = {
      from: jest.fn((table: string) => {
        if (table === 'items') {
          itemCalls += 1;
          return itemCalls === 1 ? duplicateQuery : itemInsertQuery;
        }
        if (table === 'vendors') return vendorQuery;
        if (table === 'item_vendors') return vendorLinkQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await service.createRndTemporary('tenant-1', 'user-1', {
      identifier: 'oem-rnd-001',
      description: 'Prototype cable',
      vendor_id: vendorId,
      effective_date: '2026-07-15',
      hsn_code: '',
      preferred_price: 125.5,
    }, { adminBypass: true });

    expect(itemInsertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      code: 'TEMP-OEM-RND-001',
      name: 'Prototype cable',
      oem_part_no: 'oem-rnd-001',
      description: 'Prototype cable',
      hsn_code: null,
      uom: 'NOS',
      reorder_level: 0,
      reorder_quantity: 0,
      drawing_required: 'NOT_REQUIRED',
      item_type: 'RAW_MATERIAL',
      is_rnd_item: true,
      is_verified: true,
      approval_status: 'APPROVED',
      metadata: expect.objectContaining({
        isTemporary: true,
        excludeLowStock: true,
        effectiveDate: '2026-07-15',
        temporaryItem: expect.objectContaining({
          description: 'Prototype cable',
        }),
      }),
    }));
    expect(vendorLinkQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      item_id: itemId,
      vendor_id: vendorId,
      priority: 1,
      unit_price: 125.5,
    }));
    expect(result).toEqual(expect.objectContaining({
      id: itemId,
      preferred_vendor_id: vendorId,
      preferred_vendor_name: 'R&D Supplier',
      preferred_price: 125.5,
      is_temporary: true,
    }));
  });
});
