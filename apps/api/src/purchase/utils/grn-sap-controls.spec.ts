import { buildSapGrnControls } from './grn-sap-controls';

describe('buildSapGrnControls', () => {
  it('keeps accepted-only stock posting visible without changing received quantities', () => {
    const controls = buildSapGrnControls({
      grnNumber: 'GRN-2026-07-001',
      receiptDate: '2026-07-02',
      status: 'COMPLETED',
      qcCompleted: true,
      items: [
        {
          itemCode: 'FACT-RMC-M30-OPC53-350-100RSAND',
          orderedQty: 50,
          previousReceivedQty: 35,
          receivedQty: 7,
          acceptedQty: 7,
          rejectedQty: 0,
          poRate: 100,
          grnRate: 100,
        },
      ],
    });

    expect(controls.movementType).toBe('101');
    expect(controls.stockPostingPolicy).toBe('POST_ACCEPTED_ONLY');
    expect(controls.qcGateStatus).toBe('ACCEPTED');
    expect(controls.threeWayMatchStatus).toBe('OK');
    expect(controls.items[0].stockType).toBe('UNRESTRICTED');
    expect(controls.items[0].receivedQty).toBe(7);
    expect(controls.items[0].acceptedQty).toBe(7);
  });

  it('flags over-receipts as warnings instead of silently changing business quantities', () => {
    const controls = buildSapGrnControls({
      grnNumber: 'GRN-2026-07-002',
      status: 'DRAFT',
      qcCompleted: false,
      items: [
        {
          itemCode: 'RM-001',
          orderedQty: 10,
          previousReceivedQty: 8,
          receivedQty: 4,
          acceptedQty: 0,
          rejectedQty: 0,
          poRate: 100,
          grnRate: 108,
        },
      ],
    });

    expect(controls.toleranceStatus).toBe('WARNING');
    expect(controls.qcGateStatus).toBe('PENDING_INSPECTION');
    expect(controls.items[0].stockType).toBe('QUALITY_INSPECTION');
    expect(controls.items[0].qtyVariance).toBe(2);
    expect(controls.messages.join(' ')).toContain('exceeds remaining PO quantity');
    expect(controls.messages.join(' ')).toContain('rate variance');
  });

  it('marks fully rejected items as blocked stock for visibility', () => {
    const controls = buildSapGrnControls({
      grnNumber: 'GRN-2026-07-003',
      status: 'COMPLETED',
      qcCompleted: true,
      items: [
        {
          itemCode: 'RM-REJECT',
          orderedQty: 5,
          receivedQty: 5,
          acceptedQty: 0,
          rejectedQty: 5,
        },
      ],
    });

    expect(controls.qcGateStatus).toBe('REJECTED');
    expect(controls.items[0].stockType).toBe('BLOCKED');
    expect(controls.threeWayMatchStatus).toBe('OK');
  });

  it('marks reversed GRNs with a reversed material document status', () => {
    const controls = buildSapGrnControls({
      grnNumber: 'GRN-2026-07-004',
      status: 'REJECTED',
      qcCompleted: false,
      items: [
        {
          itemCode: 'RM-REV',
          orderedQty: 5,
          receivedQty: 5,
          acceptedQty: 5,
          rejectedQty: 0,
        },
      ],
    });

    expect(controls.reversalStatus).toBe('REVERSED');
  });
});
