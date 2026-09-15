export type SapToleranceStatus = 'OK' | 'WARNING' | 'BLOCKED';
export type SapQcGateStatus = 'PENDING_INSPECTION' | 'ACCEPTED' | 'PARTIAL' | 'REJECTED';
export type SapStockType = 'QUALITY_INSPECTION' | 'UNRESTRICTED' | 'BLOCKED';

export type SapGrnItemInput = {
  id?: string;
  poItemId?: string;
  itemId?: string;
  itemCode?: string;
  orderedQty?: number;
  previousReceivedQty?: number;
  receivedQty?: number;
  acceptedQty?: number;
  rejectedQty?: number;
  poRate?: number;
  grnRate?: number;
};

export type SapGrnInput = {
  grnId?: string;
  grnNumber: string;
  poNumber?: string | null;
  receiptDate?: string | null;
  status?: string | null;
  qcCompleted?: boolean;
  items: SapGrnItemInput[];
};

export type SapGrnItemControl = SapGrnItemInput & {
  movementType: '101';
  stockType: SapStockType;
  qtyVariance: number;
  priceVariancePercent: number;
  poAmendmentRequired: boolean;
  proposedOrderedQty: number | null;
  proposedRate: number | null;
  toleranceStatus: SapToleranceStatus;
  toleranceMessages: string[];
};

export type SapGrnControl = {
  movementType: '101';
  movementText: string;
  materialDocumentNumber: string;
  fiscalYear: number;
  inspectionLotNumber: string;
  grIrStatus: 'PENDING_INVOICE_APPROVAL' | 'READY_FOR_AP';
  qcGateStatus: SapQcGateStatus;
  threeWayMatchStatus: SapToleranceStatus;
  toleranceStatus: SapToleranceStatus;
  reversalStatus: 'NOT_REVERSED' | 'REVERSED';
  stockPostingPolicy: 'POST_ACCEPTED_ONLY';
  items: SapGrnItemControl[];
  messages: string[];
  poAmendmentApproval: {
    required: boolean;
    status: 'NOT_REQUIRED' | 'PENDING_APPROVAL';
    items: Array<{
      poItemId?: string;
      itemId?: string;
      itemCode?: string;
      orderedQty: number;
      previousReceivedQty: number;
      receivedQty: number;
      poRate: number;
      grnRate: number;
      qtyVariance: number;
      priceVariancePercent: number;
      proposedOrderedQty: number | null;
      proposedRate: number | null;
      reasons: Array<'QUANTITY_OVER_RECEIPT' | 'PRICE_VARIANCE'>;
      messages: string[];
    }>;
  };
};

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

function fiscalYearFromDate(value?: string | null): number {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const month = safe.getMonth() + 1;
  return month >= 4 ? safe.getFullYear() : safe.getFullYear() - 1;
}

function statusRank(status: SapToleranceStatus): number {
  return status === 'BLOCKED' ? 2 : status === 'WARNING' ? 1 : 0;
}

function maxStatus(statuses: SapToleranceStatus[]): SapToleranceStatus {
  return statuses.reduce<SapToleranceStatus>(
    (max, status) => (statusRank(status) > statusRank(max) ? status : max),
    'OK',
  );
}

function sanitizeDocumentSuffix(grnNumber: string): string {
  return String(grnNumber || 'GRN')
    .trim()
    .replace(/^GRN[-_]?/i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'GRN';
}

export function buildSapGrnControls(input: SapGrnInput): SapGrnControl {
  const fiscalYear = fiscalYearFromDate(input.receiptDate);
  const docSuffix = sanitizeDocumentSuffix(input.grnNumber);
  const items = (input.items || []).map<SapGrnItemControl>((item) => {
    const orderedQty = toNumber(item.orderedQty);
    const previousReceivedQty = Math.max(0, toNumber(item.previousReceivedQty));
    const receivedQty = Math.max(0, toNumber(item.receivedQty));
    const acceptedQty = Math.max(0, toNumber(item.acceptedQty));
    const rejectedQty = Math.max(0, toNumber(item.rejectedQty));
    const remainingBeforeGrn = Math.max(0, orderedQty - previousReceivedQty);
    const qtyVariance = receivedQty - remainingBeforeGrn;
    const poRate = toNumber(item.poRate);
    const grnRate = toNumber(item.grnRate);
    const priceVariancePercent = poRate > 0 ? ((grnRate - poRate) / poRate) * 100 : 0;
    const toleranceMessages: string[] = [];
    const reasons: Array<'QUANTITY_OVER_RECEIPT' | 'PRICE_VARIANCE'> = [];

    if (orderedQty > 0 && qtyVariance > 0.000001) {
      toleranceMessages.push(`Received quantity exceeds remaining PO quantity by ${qtyVariance}.`);
      reasons.push('QUANTITY_OVER_RECEIPT');
    }
    if (receivedQty > 0 && acceptedQty + rejectedQty > receivedQty + 0.000001) {
      toleranceMessages.push('Accepted plus rejected quantity exceeds received quantity.');
    }
    if (poRate > 0 && Math.abs(priceVariancePercent) > 5) {
      toleranceMessages.push(`Invoice/GRN rate variance is ${priceVariancePercent.toFixed(2)}%.`);
      reasons.push('PRICE_VARIANCE');
      if (previousReceivedQty > 0) {
        toleranceMessages.push(
          `Previous GRN quantity ${previousReceivedQty} was received at the PO rate; only this GRN rate needs amendment approval unless the approver changes the PO rate.`,
        );
      }
    }

    const poAmendmentRequired = reasons.length > 0;
    const proposedOrderedQty = reasons.includes('QUANTITY_OVER_RECEIPT')
      ? previousReceivedQty + receivedQty
      : null;
    const proposedRate = reasons.includes('PRICE_VARIANCE') ? grnRate : null;

    const toleranceStatus: SapToleranceStatus = toleranceMessages.length > 0 ? 'WARNING' : 'OK';
    const stockType: SapStockType =
      rejectedQty > 0 && acceptedQty <= 0
        ? 'BLOCKED'
        : acceptedQty > 0
          ? 'UNRESTRICTED'
          : 'QUALITY_INSPECTION';

    return {
      ...item,
      orderedQty,
      previousReceivedQty,
      receivedQty,
      acceptedQty,
      rejectedQty,
      poRate,
      grnRate,
      movementType: '101',
      stockType,
      qtyVariance,
      priceVariancePercent,
      poAmendmentRequired,
      proposedOrderedQty,
      proposedRate,
      toleranceStatus,
      toleranceMessages,
    };
  });

  const acceptedTotal = items.reduce((sum, item) => sum + item.acceptedQty, 0);
  const rejectedTotal = items.reduce((sum, item) => sum + item.rejectedQty, 0);
  const receivedTotal = items.reduce((sum, item) => sum + item.receivedQty, 0);
  const itemToleranceStatus = maxStatus(items.map((item) => item.toleranceStatus));
  const messages = items.flatMap((item) =>
    item.toleranceMessages.map((message) => `${item.itemCode || item.itemId || 'Item'}: ${message}`),
  );
  const poAmendmentItems = items
    .filter((item) => item.poAmendmentRequired)
    .map((item) => {
      const reasons: Array<'QUANTITY_OVER_RECEIPT' | 'PRICE_VARIANCE'> = [];
      if (item.proposedOrderedQty !== null) reasons.push('QUANTITY_OVER_RECEIPT');
      if (item.proposedRate !== null) reasons.push('PRICE_VARIANCE');
      return {
        poItemId: item.poItemId,
        itemId: item.itemId,
        itemCode: item.itemCode,
        orderedQty: item.orderedQty || 0,
        previousReceivedQty: item.previousReceivedQty || 0,
        receivedQty: item.receivedQty || 0,
        poRate: item.poRate || 0,
        grnRate: item.grnRate || 0,
        qtyVariance: item.qtyVariance || 0,
        priceVariancePercent: item.priceVariancePercent || 0,
        proposedOrderedQty: item.proposedOrderedQty,
        proposedRate: item.proposedRate,
        reasons,
        messages: item.toleranceMessages,
      };
    });

  const qcGateStatus: SapQcGateStatus =
    input.qcCompleted || acceptedTotal + rejectedTotal >= receivedTotal
      ? rejectedTotal > 0 && acceptedTotal > 0
        ? 'PARTIAL'
        : rejectedTotal > 0
          ? 'REJECTED'
          : 'ACCEPTED'
      : 'PENDING_INSPECTION';
  const isReversed = String(input.status || '').toUpperCase() === 'REJECTED';

  const threeWayMatchStatus: SapToleranceStatus =
    itemToleranceStatus === 'OK' && qcGateStatus !== 'PENDING_INSPECTION' ? 'OK' : itemToleranceStatus;

  return {
    movementType: '101',
    movementText: 'Goods receipt for purchase order',
    materialDocumentNumber: `MD-${docSuffix}`,
    fiscalYear,
    inspectionLotNumber: `IL-${docSuffix}`,
    grIrStatus: input.status === 'COMPLETED' ? 'READY_FOR_AP' : 'PENDING_INVOICE_APPROVAL',
    qcGateStatus,
    threeWayMatchStatus,
    toleranceStatus: itemToleranceStatus,
    reversalStatus: isReversed ? 'REVERSED' : 'NOT_REVERSED',
    stockPostingPolicy: 'POST_ACCEPTED_ONLY',
    items,
    messages,
    poAmendmentApproval: {
      required: poAmendmentItems.length > 0,
      status: poAmendmentItems.length > 0 ? 'PENDING_APPROVAL' : 'NOT_REQUIRED',
      items: poAmendmentItems,
    },
  };
}
