import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';

describe('InventoryService low-stock purchasing', () => {
  const request = { user: { tenantId: 'tenant-1', userId: 'user-1' } } as any;

  it('groups selected items into one submitted PR per preferred supplier', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce({ id: 'pr-1', pr_number: 'PR-001', status: 'AWAITING_APPROVAL' })
      .mockResolvedValueOnce({ id: 'pr-2', pr_number: 'PR-002', status: 'AWAITING_APPROVAL' });
    const service = new InventoryService({} as any, {} as any, { create } as any);
    jest.spyOn(service, 'getLowStockPlanning').mockResolvedValue({
      generated_at: '2026-07-15T00:00:00.000Z',
      summary: { low_stock: 3, missing_vendor: 0, covered_by_open_supply: 0 },
      items: [
        { item_id: 'item-1', item_code: 'ITEM-1', item_name: 'One', uom: 'NOS', available_qty: 0, reorder_level: 10, open_pr_qty: 0, open_po_qty: 0, preferred_vendor_id: 'vendor-a', preferred_vendor_name: 'Supplier A', preferred_price: 10, purchasable: true },
        { item_id: 'item-2', item_code: 'ITEM-2', item_name: 'Two', uom: 'NOS', available_qty: 2, reorder_level: 5, open_pr_qty: 0, open_po_qty: 0, preferred_vendor_id: 'vendor-a', preferred_vendor_name: 'Supplier A', preferred_price: 20, purchasable: true },
        { item_id: 'item-3', item_code: 'ITEM-3', item_name: 'Three', uom: 'MTR', available_qty: 0, reorder_level: 4, open_pr_qty: 0, open_po_qty: 0, preferred_vendor_id: 'vendor-b', preferred_vendor_name: 'Supplier B', preferred_price: 30, purchasable: true },
      ],
    } as any);

    const result = await service.createLowStockPurchaseRequisitions(request, {
      requiredDate: '2026-07-22',
      priority: 'HIGH',
      items: [
        { itemId: 'item-1', requiredQty: 10 },
        { itemId: 'item-2', requiredQty: 3 },
        { itemId: 'item-3', requiredQty: 4 },
      ],
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, 'tenant-1', 'user-1', expect.objectContaining({
      status: 'SUBMITTED',
      requiredDate: '2026-07-22',
      priority: 'HIGH',
      purpose: 'Low stock replenishment - Supplier A',
      items: expect.arrayContaining([
        expect.objectContaining({ itemId: 'item-1', vendorId: 'vendor-a', requestedQty: 10 }),
        expect.objectContaining({ itemId: 'item-2', vendorId: 'vendor-a', requestedQty: 3 }),
      ]),
    }));
    expect(create).toHaveBeenNthCalledWith(2, 'tenant-1', 'user-1', expect.objectContaining({
      purpose: 'Low stock replenishment - Supplier B',
      items: [expect.objectContaining({ itemId: 'item-3', vendorId: 'vendor-b', requestedQty: 4 })],
    }));
    expect(result.created_prs).toHaveLength(2);
  });

  it('blocks purchasing when a preferred supplier is missing', async () => {
    const service = new InventoryService({} as any, {} as any, { create: jest.fn() } as any);
    jest.spyOn(service, 'getLowStockPlanning').mockResolvedValue({
      generated_at: '2026-07-15T00:00:00.000Z',
      summary: { low_stock: 1, missing_vendor: 1, covered_by_open_supply: 0 },
      items: [{ item_id: 'item-1', item_code: 'ITEM-1', purchasable: false, block_reason: 'Preferred supplier is not configured' }],
    } as any);

    await expect(service.createLowStockPurchaseRequisitions(request, {
      items: [{ itemId: 'item-1', requiredQty: 5 }],
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
