import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DebitNoteService } from './debit-note.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';

describe('DebitNoteService payment reversal controls', () => {
  it('requires a reversal reason before reversing a payment', async () => {
    const service = new DebitNoteService({} as any);

    await expect(
      service.reversePayment('tenant-1', 'grn-1', 'pay-1', 'user-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records a reversal audit snapshot and recalculates GRN payment totals', async () => {
    const service = new DebitNoteService({} as any);
    const paymentEntry = {
      id: 'pay-1',
      tenant_id: 'tenant-1',
      grn_id: 'grn-1',
      payment_date: '2026-07-04',
      amount: '25000.00',
      tds_amount: '500.00',
      short_payment_amount: '100.00',
      payment_method: 'BANK_TRANSFER',
      payment_reference: 'UTR-123',
      payment_notes: 'Partial payment',
    };

    const paymentQuery: any = {
      select: jest.fn(() => paymentQuery),
      eq: jest.fn(() => paymentQuery),
      maybeSingle: jest.fn().mockResolvedValue({ data: paymentEntry, error: null }),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const grnQuery: any = {
      select: jest.fn(() => grnQuery),
      eq: jest.fn(() => grnQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'grn-1', po_id: 'po-1', vendor_id: 'vendor-1' },
        error: null,
      }),
    };
    const reversalQuery: any = {
      insert: jest.fn(() => reversalQuery),
      select: jest.fn(() => reversalQuery),
      single: jest.fn().mockResolvedValue({ data: { id: 'rev-1' }, error: null }),
    };

    (service as any).supabase = {
      from: jest.fn((table: string) => {
        if (table === 'grn_payment_entries') return paymentQuery;
        if (table === 'grn_payment_reversals') return reversalQuery;
        if (table === 'grns') return grnQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const deletePayment = jest
      .spyOn(service, 'deletePayment')
      .mockResolvedValue({ payment_status: 'UNPAID', paid_amount: 0 } as any);

    const result = await service.reversePayment(
      'tenant-1',
      'grn-1',
      'pay-1',
      'user-1',
      { reason: 'Wrong payment mapped to GRN' },
    );

    expect(reversalQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      grn_id: 'grn-1',
      payment_entry_id: 'pay-1',
      original_amount: 25000,
      original_tds_amount: 500,
      original_short_payment_amount: 100,
      original_payment_method: 'BANK_TRANSFER',
      original_payment_reference: 'UTR-123',
      reversal_reason: 'Wrong payment mapped to GRN',
      reversed_by: 'user-1',
      original_entry: expect.objectContaining(paymentEntry),
    }));
    expect(deletePayment).toHaveBeenCalledWith('tenant-1', 'grn-1', 'pay-1');
    expect(result).toEqual(expect.objectContaining({
      message: 'Payment reversed successfully',
      reversal_id: 'rev-1',
      reversed_payment_id: 'pay-1',
      payment_status: 'UNPAID',
      paid_amount: 0,
    }));
  });
});

describe('DebitNoteService debit note approval controls', () => {
  it('prevents the creator from approving their own debit note', async () => {
    const service = new DebitNoteService({} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: 'dn-1',
          debit_note_number: 'DN-1',
          status: 'DRAFT',
          created_by: 'user-1',
        },
        error: null,
      }),
    };

    (service as any).supabase = {
      from: jest.fn(() => fetchQuery),
    };

    await expect(
      service.approve('tenant-1', 'dn-1', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approves only draft debit notes and records approver metadata', async () => {
    const service = new DebitNoteService({} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: 'dn-1',
          debit_note_number: 'DN-1',
          status: 'DRAFT',
          created_by: 'maker-1',
        },
        error: null,
      }),
    };
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
      select: jest.fn(() => updateQuery),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'dn-1',
          debit_note_number: 'DN-1',
          status: 'APPROVED',
          approved_by: 'checker-1',
        },
        error: null,
      }),
    };

    (service as any).supabase = {
      from: jest.fn()
        .mockReturnValueOnce(fetchQuery)
        .mockReturnValueOnce(updateQuery),
    };

    const result = await service.approve('tenant-1', 'dn-1', 'checker-1');

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'APPROVED',
      approved_by: 'checker-1',
    }));
    expect(result).toEqual(expect.objectContaining({
      id: 'dn-1',
      status: 'APPROVED',
    }));
  });

  it('blocks approval once a debit note has left draft status', async () => {
    const service = new DebitNoteService({} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: 'dn-1',
          debit_note_number: 'DN-1',
          status: 'SENT',
          created_by: 'maker-1',
        },
        error: null,
      }),
    };

    (service as any).supabase = {
      from: jest.fn(() => fetchQuery),
    };

    await expect(
      service.approve('tenant-1', 'dn-1', 'checker-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DebitNoteService GRN payment-status register', () => {
  it('keeps the register usable when one PO settlement lookup fails', async () => {
    const service = new DebitNoteService({} as any);
    const grnQuery: any = {
      select: jest.fn(() => grnQuery),
      eq: jest.fn(() => grnQuery),
    };
    grnQuery.then = (resolve: any) => resolve({
      data: [
        {
          id: 'grn-1',
          po_id: 'po-1',
          status: 'COMPLETED',
          net_payable_amount: 1000,
          paid_amount: 100,
          tds_amount: 0,
          short_payment_amount: 0,
          payment_status: 'PARTIAL',
        },
      ],
      error: null,
    });

    (service as any).supabase = {
      from: jest.fn(() => grnQuery),
    };
    jest.spyOn(service, 'getPoSettlement').mockRejectedValue(new Error('Failed to fetch PO invoices: fetch failed'));

    const result = await service.getGrnsWithPaymentStatus('tenant-1', { status: 'COMPLETED' });

    expect(result).toHaveLength(1);
    expect(result[0]._payment_calculation).toEqual(expect.objectContaining({
      net_payable: 1000,
      paid_amount: 100,
      outstanding: 900,
      payment_status: 'PARTIAL',
    }));
  });
});

describe('DebitNoteService invoice freight adjustment controls', () => {
  it('requires Accounts to record a reason for every freight adjustment', async () => {
    const service = new DebitNoteService({} as any);

    await expect(service.adjustInvoiceFreight(
      'tenant-1',
      'grn-1',
      'accounts-user-1',
      { freight_amount: 500, freight_gst_amount: 90, reason: '   ' },
    )).rejects.toThrow('Reason for freight adjustment is required');
  });

  it('recalculates the invoice payable and records one old/new freight audit entry', async () => {
    const service = new DebitNoteService({} as any);
    const grn = {
      id: 'grn-1',
      grn_number: 'GRN-2026-07-001',
      status: 'COMPLETED',
      invoice_approved: true,
      gross_amount: 10000,
      tax_amount: 1800,
      debit_note_amount: 100,
      freight_amount: 200,
      freight_gst_amount: 36,
      net_payable_amount: 11936,
      paid_amount: 0,
      tds_amount: 0,
      short_payment_amount: 0,
      payment_status: 'UNPAID',
    };

    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({ data: grn, error: null }),
    };
    const paymentQuery: any = {
      select: jest.fn(() => paymentQuery),
      eq: jest.fn(() => paymentQuery),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
      then: (resolve: any) => resolve({ error: null }),
    };
    const auditQuery: any = {
      insert: jest.fn().mockResolvedValue({ error: null }),
    };

    (service as any).supabase = {
      from: jest.fn()
        .mockReturnValueOnce(fetchQuery)
        .mockReturnValueOnce(paymentQuery)
        .mockReturnValueOnce(updateQuery)
        .mockReturnValueOnce(auditQuery),
    };
    jest.spyOn(service, 'getGrnPayableDetail').mockResolvedValue({ id: 'grn-1' } as any);

    await service.adjustInvoiceFreight(
      'tenant-1',
      'grn-1',
      'accounts-user-1',
      { freight_amount: 500, freight_gst_amount: 90, reason: 'Supplier invoice has revised freight' },
    );

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      freight_amount: 500,
      freight_gst_amount: 90,
      net_payable_amount: 12290,
    }));
    expect(auditQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      user_id: 'accounts-user-1',
      action: 'FREIGHT_ADJUSTMENT',
      resource_type: 'GRN_INVOICE',
      resource_id: 'grn-1',
      old_value: expect.objectContaining({
        freight_amount: 200,
        freight_gst_amount: 36,
        net_payable_amount: 11936,
      }),
      new_value: expect.objectContaining({
        freight_amount: 500,
        freight_gst_amount: 90,
        net_payable_amount: 12290,
      }),
      metadata: expect.objectContaining({
        reason: 'Supplier invoice has revised freight',
        po_freight_updated: false,
      }),
    }));
  });
});

describe('DebitNoteService accounts payable payment posting controls', () => {
  function mockServiceWithPayableGrn(grn: any) {
    const service = new DebitNoteService({} as any);
    const grnQuery: any = {
      select: jest.fn(() => grnQuery),
      eq: jest.fn(() => grnQuery),
      maybeSingle: jest.fn().mockResolvedValue({ data: grn, error: null }),
    };
    const entryQuery: any = {
      insert: jest.fn(() => entryQuery),
      select: jest.fn(() => entryQuery),
      eq: jest.fn(() => entryQuery),
    };

    (service as any).supabase = {
      from: jest.fn((table: string) => {
        if (table === 'grns') return grnQuery;
        if (table === 'grn_payment_entries') return entryQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    return { service, entryQuery };
  }

  it('blocks payment before supplier invoice sanction', async () => {
    const { service } = mockServiceWithPayableGrn({
      id: 'grn-1',
      status: 'COMPLETED',
      invoice_approved: false,
      net_payable_amount: 1000,
      paid_amount: 0,
      tds_amount: 0,
      short_payment_amount: 0,
    });

    await expect(service.recordPayment('tenant-1', 'grn-1', {
      amount: 100,
      payment_method: 'NEFT',
    })).rejects.toThrow('Supplier invoice must be sanctioned before payment');
  });

  it('requires a reason for short payment', async () => {
    const { service } = mockServiceWithPayableGrn({
      id: 'grn-1',
      status: 'COMPLETED',
      invoice_approved: true,
      net_payable_amount: 1000,
      paid_amount: 0,
      tds_amount: 0,
      short_payment_amount: 0,
    });

    await expect(service.recordPayment('tenant-1', 'grn-1', {
      amount: 900,
      short_payment_amount: 100,
      payment_method: 'NEFT',
    })).rejects.toThrow('Short payment reason is required');
  });

  it('blocks closing an invoice without settling the remaining balance', async () => {
    const { service } = mockServiceWithPayableGrn({
      id: 'grn-1',
      status: 'COMPLETED',
      invoice_approved: true,
      net_payable_amount: 1000,
      paid_amount: 0,
      tds_amount: 0,
      short_payment_amount: 0,
    });

    await expect(service.recordPayment('tenant-1', 'grn-1', {
      amount: 900,
      payment_method: 'NEFT',
      close_invoice: true,
    })).rejects.toThrow('Short payment amount must cover the remaining balance before closing the invoice');
  });

  it('retries payment entry insert with legacy columns when live schema is behind', async () => {
    const service = new DebitNoteService({} as any);
    const insert = jest
      .fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'entry_type' column" } })
      .mockResolvedValueOnce({ error: null });

    (service as any).supabase = {
      from: jest.fn(() => ({ insert })),
    };

    await (service as any).insertGrnPaymentEntry('tenant-1', 'grn-1', {
      payment_date: '2026-07-11',
      amount: 4040,
      payment_method: 'NEFT',
      payment_reference: null,
      tds_amount: 0,
      short_payment_amount: 0,
      short_payment_reason: null,
      payment_notes: null,
      entry_type: 'PAYMENT',
      created_by: 'user-1',
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toMatchObject({ entry_type: 'PAYMENT', short_payment_reason: null });
    expect(insert.mock.calls[1][0]).not.toHaveProperty('entry_type');
    expect(insert.mock.calls[1][0]).not.toHaveProperty('short_payment_reason');
  });

  it('falls back to legacy payment-entry totals when entry_type column is unavailable', async () => {
    const service = new DebitNoteService({} as any);
    const makeQuery = (result: any) => {
      let eqCount = 0;
      const query: any = {
        select: jest.fn(() => query),
        eq: jest.fn(() => {
          eqCount += 1;
          return eqCount >= 2 ? Promise.resolve(result) : query;
        }),
      };
      return query;
    };
    const modernQuery = makeQuery({
      error: { code: 'PGRST204', message: "Could not find the 'entry_type' column" },
      data: null,
    });
    const legacyQuery = makeQuery({
      error: null,
      data: [{ amount: 4040, tds_amount: 0, short_payment_amount: 0 }],
    });
    const from = jest.fn()
      .mockReturnValueOnce(modernQuery)
      .mockReturnValueOnce(legacyQuery);

    (service as any).supabase = { from };

    const totals = await (service as any).fetchGrnPaymentEntryTotals('tenant-1', 'grn-1');

    expect(totals).toEqual([{ amount: 4040, tds_amount: 0, short_payment_amount: 0, entry_type: 'PAYMENT' }]);
  });
});
