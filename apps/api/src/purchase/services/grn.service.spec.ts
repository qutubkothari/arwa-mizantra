import { GrnService } from './grn.service';
import { allocatePoSettlement } from '../utils/po-settlement';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';

describe('GrnService commercial amount controls', () => {
  it('reopens PO receipt quantity after QC rejection while keeping pending QC blocked', async () => {
    const service = new GrnService({} as any);

    expect((service as any).effectivePoReceiptQty({
      received_qty: 10,
      accepted_qty: 0,
      rejected_qty: 10,
      qc_status: 'REJECTED',
    })).toBe(0);

    expect((service as any).effectivePoReceiptQty({
      received_qty: 10,
      accepted_qty: 0,
      rejected_qty: 0,
      qc_status: null,
    })).toBe(10);

    await expect((service as any).validateReceiptsDoNotExceedRemaining({
      poItemQtyMap: new Map([
        ['po-line-1', { orderedQty: 10, receivedQty: 10, effectiveReceivedQty: 0 }],
      ]),
      receivedByPoItemId: new Map([['po-line-1', 10]]),
    })).resolves.toBeUndefined();

    await expect((service as any).validateReceiptsDoNotExceedRemaining({
      poItemQtyMap: new Map([
        ['po-line-1', { orderedQty: 10, receivedQty: 10, effectiveReceivedQty: 10 }],
      ]),
      receivedByPoItemId: new Map([['po-line-1', 1]]),
    })).rejects.toThrow('Remaining quantity is 0');
  });

  it('recalculates GRN/AP payable from discounted PO line value', async () => {
    const service = new GrnService({} as any);
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
    };

    (service as any).supabase = {
      from: jest.fn((table: string) => {
        if (table === 'grn_items') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    po_item_id: 'po-line-1',
                    received_qty: 10,
                    rate: 100,
                  },
                ],
              }),
            })),
          };
        }

        if (table === 'purchase_order_items') {
          return {
            select: jest.fn(() => ({
              in: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'po-line-1',
                    rate: 100,
                    discount_percent: 10,
                    tax_percent: 18,
                  },
                ],
              }),
            })),
          };
        }

        if (table === 'grns') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                  data: {
                    gst_percentage: 18,
                    debit_note_amount: 0,
                    freight_amount: 0,
                    freight_gst_amount: 0,
                  },
                }),
              })),
            })),
            update: updateQuery.update,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await (service as any).updateGRNFinancialAmounts('tenant-1', 'grn-1');

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      gross_amount: 900,
      tax_amount: 162,
      net_payable_amount: 1062,
    }));

    const settlement = allocatePoSettlement([{ id: 'grn-1', netPayable: 1062 }], 400);
    expect(settlement.invoiced).toBe(1062);
    expect(settlement.advanceApplied).toBe(0);
    expect(settlement.advanceAvailable).toBe(400);
    expect(settlement.outstanding).toBe(1062);
  });

  it('uses QC accepted quantity for GRN payable after inspection', async () => {
    const service = new GrnService({} as any);
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
    };

    (service as any).supabase = {
      from: jest.fn((table: string) => {
        if (table === 'grn_items') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    po_item_id: 'po-line-1',
                    received_qty: 150,
                    accepted_qty: 140,
                    rejected_qty: 0,
                    qc_status: 'PARTIAL',
                    rate: 8000,
                  },
                ],
              }),
            })),
          };
        }

        if (table === 'purchase_order_items') {
          return {
            select: jest.fn(() => ({
              in: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'po-line-1',
                    rate: 8000,
                    discount_percent: 0,
                    tax_percent: 18,
                  },
                ],
              }),
            })),
          };
        }

        if (table === 'grns') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                  data: {
                    gst_percentage: 18,
                    debit_note_amount: 0,
                    freight_amount: 0,
                    freight_gst_amount: 0,
                  },
                }),
              })),
            })),
            update: updateQuery.update,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await (service as any).updateGRNFinancialAmounts('tenant-1', 'grn-1');

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      gross_amount: 1120000,
      tax_amount: 201600,
      net_payable_amount: 1321600,
    }));
  });

  it('allocates only PO freight charges into GRN payable', async () => {
    const service = new GrnService({} as any);
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
    };

    (service as any).supabase = {
      from: jest.fn((table: string) => {
        if (table === 'grn_items') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    po_item_id: 'po-line-1',
                    received_qty: 1,
                    accepted_qty: 0,
                    rejected_qty: 0,
                    qc_status: null,
                    rate: 4892.5,
                  },
                ],
              }),
            })),
          };
        }

        if (table === 'purchase_order_items') {
          const query: any = {
            select: jest.fn(() => query),
            in: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'po-line-1',
                  rate: 4892.5,
                  discount_percent: 0,
                  tax_percent: 18,
                },
              ],
            }),
            eq: jest.fn().mockResolvedValue({
              data: [
                {
                  ordered_qty: 1,
                  rate: 4892.5,
                  discount_percent: 0,
                },
              ],
            }),
          };
          return query;
        }

        if (table === 'purchase_orders') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                  data: {
                    terms_and_conditions: JSON.stringify({ freightAmount: 100, freightGstAmount: 0 }),
                    customs_duty: 200,
                    other_charges: 0,
                  },
                  error: null,
                }),
              })),
            })),
          };
        }

        if (table === 'grns') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                  data: {
                    po_id: 'po-1',
                    gst_percentage: 18,
                    debit_note_amount: 0,
                    freight_amount: 0,
                    freight_gst_amount: 0,
                  },
                }),
              })),
            })),
            update: updateQuery.update,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await (service as any).updateGRNFinancialAmounts('tenant-1', 'grn-1');

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      gross_amount: 4892.5,
      tax_amount: 880.65,
      freight_amount: 100,
      freight_gst_amount: 0,
      net_payable_amount: 5873,
    }));
  });
});

describe('GrnService supplier invoice sanction controls', () => {
  function createServiceWithGrnMock(currentGrn: any) {
    const service = new GrnService({} as any);
    const selectQuery: any = {
      select: jest.fn(() => selectQuery),
      eq: jest.fn(() => selectQuery),
      single: jest.fn().mockResolvedValue({ data: currentGrn, error: null }),
    };
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
    };

    (service as any).supabase = {
      from: jest.fn(() => ({
        select: selectQuery.select,
        update: updateQuery.update,
      })),
    };

    jest.spyOn(service, 'findOne').mockResolvedValue({ id: currentGrn?.id || 'grn-1' } as any);

    return { service, selectQuery, updateQuery };
  }

  it('blocks the GRN receiver from sanctioning their own supplier invoice', async () => {
    const { service } = createServiceWithGrnMock({
      id: 'grn-1',
      grn_number: 'GRN-1',
      status: 'COMPLETED',
      qc_completed: true,
      invoice_approved: false,
      received_by: 'receiver-1',
      net_payable_amount: 1000,
    });

    await expect(service.approveInvoice('tenant-1', 'grn-1', 'receiver-1', {})).rejects.toThrow(
      'Receiver cannot sanction their own supplier invoice',
    );
  });

  it('allows a Super Admin receiver to override supplier invoice maker-checker', async () => {
    const { service, updateQuery } = createServiceWithGrnMock({
      id: 'grn-1',
      grn_number: 'GRN-1',
      status: 'COMPLETED',
      qc_completed: true,
      invoice_approved: false,
      received_by: 'super-1',
      net_payable_amount: 1000,
    });

    await service.approveInvoice(
      'tenant-1',
      'grn-1',
      { userId: 'super-1', role: { name: 'SUPER_ADMIN' } },
      { notes: 'Super admin override' },
    );

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      invoice_approved: true,
      invoice_approved_by: 'super-1',
      invoice_approval_notes: 'Super admin override',
    }));
  });

  it('requires completed QC before supplier invoice sanction', async () => {
    const { service } = createServiceWithGrnMock({
      id: 'grn-1',
      grn_number: 'GRN-1',
      status: 'COMPLETED',
      qc_completed: false,
      invoice_approved: false,
      received_by: 'receiver-1',
      net_payable_amount: 1000,
    });

    await expect(service.approveInvoice('tenant-1', 'grn-1', 'approver-1', {})).rejects.toThrow(
      'QC must be completed before supplier invoice sanction',
    );
  });

  it('records supplier invoice sanction metadata and notes', async () => {
    const { service, updateQuery } = createServiceWithGrnMock({
      id: 'grn-1',
      grn_number: 'GRN-1',
      status: 'COMPLETED',
      qc_completed: true,
      invoice_approved: false,
      received_by: 'receiver-1',
      net_payable_amount: 1000,
    });

    await service.approveInvoice('tenant-1', 'grn-1', 'approver-1', { notes: 'Checked against invoice INV-1' });

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      invoice_approved: true,
      invoice_approved_by: 'approver-1',
      invoice_approval_notes: 'Checked against invoice INV-1',
    }));
  });

  it('blocks reverting invoice sanction after payment is recorded', async () => {
    const { service } = createServiceWithGrnMock({
      id: 'grn-1',
      invoice_approved: true,
      paid_amount: 10,
      payment_status: 'PARTIAL',
    });

    await expect(service.unapproveInvoice('tenant-1', 'grn-1', 'approver-1', { notes: 'Wrong sanction' })).rejects.toThrow(
      'Cannot revert supplier invoice sanction after payment is recorded',
    );
  });
});
