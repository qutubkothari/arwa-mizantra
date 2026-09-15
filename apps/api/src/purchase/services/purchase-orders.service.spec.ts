import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';

describe('PurchaseOrdersService controls', () => {
  const makeService = () => new PurchaseOrdersService({} as any, {} as any);

  it('prevents a PO creator from approving their own purchase order', async () => {
    const service = makeService();
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      single: jest.fn().mockResolvedValue({
        data: {
          po_number: 'PO-2026-07-001',
          status: 'PENDING',
          terms_and_conditions: null,
          created_by: 'creator-1',
        },
      }),
    };
    (service as any).supabase = {
      from: jest.fn(() => query),
    };

    await expect(service.updateStatus('tenant-1', 'po-1', 'APPROVED', 'creator-1')).rejects.toThrow(
      new BadRequestException('You cannot approve a purchase order that you created or last edited.'),
    );
  });

  it('prevents a PO creator from rejecting their own purchase order', async () => {
    const service = makeService();
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      single: jest.fn().mockResolvedValue({
        data: {
          po_number: 'PO-2026-07-001',
          status: 'PENDING',
          terms_and_conditions: null,
          created_by: 'creator-1',
        },
      }),
    };
    (service as any).supabase = {
      from: jest.fn(() => query),
    };

    await expect(service.updateStatus('tenant-1', 'po-1', 'REJECTED', 'creator-1')).rejects.toThrow(
      new BadRequestException('You cannot reject a purchase order that you created or last edited.'),
    );
  });

  it('blocks ordering more than the remaining PR quantity', async () => {
    const service = makeService();
    const prItemsQuery: any = {
      select: jest.fn(() => prItemsQuery),
      eq: jest.fn(() => prItemsQuery),
      in: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'pr-line-1',
            item_code: 'ITEM-1',
            item_name: 'Item 1',
            requested_qty: 100,
          },
        ],
        error: null,
      }),
    };
    const poQuery: any = {
      select: jest.fn(() => poQuery),
      eq: jest.fn(() => poQuery),
      neq: jest.fn(() => poQuery),
      then: (resolve: any) => resolve({
        data: [
          {
            id: 'po-1',
            status: 'APPROVED',
            purchase_order_items: [
              { pr_item_id: 'pr-line-1', ordered_qty: 80 },
            ],
          },
        ],
        error: null,
      }),
    };
    (service as any).supabase = {
      from: jest.fn((table: string) => {
        if (table === 'purchase_requisition_items') return prItemsQuery;
        if (table === 'purchase_orders') return poQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await expect((service as any).assertPrQuantitiesAvailable('tenant-1', 'pr-1', [
      { prItemId: 'pr-line-1', orderedQty: 25 },
    ])).rejects.toThrow('PO quantity for ITEM-1 exceeds PR balance. Requested 25, available 20.');
  });
});
