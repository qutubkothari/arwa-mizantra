const MONEY_TOLERANCE = 0.009;

export interface PoSettlementInvoiceInput {
  id: string;
  date?: string | null;
  netPayable: number;
  cashPaid?: number;
  tds?: number;
  shortPayment?: number;
  advanceApplied?: number;
}

export interface PoSettlementInvoiceResult extends PoSettlementInvoiceInput {
  cashPaid: number;
  tds: number;
  shortPayment: number;
  advanceApplied: number;
  totalSettled: number;
  outstanding: number;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
}

export interface PoSettlementResult {
  invoices: PoSettlementInvoiceResult[];
  totalAdvance: number;
  advanceApplied: number;
  advanceAvailable: number;
  invoiced: number;
  cashPaid: number;
  tds: number;
  shortPayment: number;
  totalSettled: number;
  outstanding: number;
}

const money = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

/**
 * Calculates invoice settlement for a PO.
 * Advances are never auto-applied here; invoice.advanceApplied must be passed only
 * after Accounts Payable explicitly adjusts an advance against that invoice.
 */
export function allocatePoSettlement(
  invoices: PoSettlementInvoiceInput[],
  advanceAmount: number,
): PoSettlementResult {
  let advanceAvailable = Math.max(0, money(advanceAmount));

  const ordered = invoices
    .map((invoice, index) => ({ invoice, index }))
    .sort((a, b) => {
      const aTime = a.invoice.date ? new Date(a.invoice.date).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.invoice.date ? new Date(b.invoice.date).getTime() : Number.MAX_SAFE_INTEGER;
      const safeATime = Number.isFinite(aTime) ? aTime : Number.MAX_SAFE_INTEGER;
      const safeBTime = Number.isFinite(bTime) ? bTime : Number.MAX_SAFE_INTEGER;
      return safeATime - safeBTime || a.index - b.index;
    });

  const allocated = ordered.map(({ invoice, index }) => {
    const netPayable = Math.max(0, money(invoice.netPayable));
    const cashPaid = Math.max(0, money(invoice.cashPaid));
    const tds = Math.max(0, money(invoice.tds));
    const shortPayment = Math.max(0, money(invoice.shortPayment));
    const settledBeforeAdvance = Math.min(netPayable, money(cashPaid + tds + shortPayment));
    const requestedAdvance = Math.max(0, money(invoice.advanceApplied));
    const advanceApplied = Math.min(requestedAdvance, advanceAvailable, money(netPayable - settledBeforeAdvance));
    advanceAvailable = money(advanceAvailable - advanceApplied);
    const totalSettled = Math.min(netPayable, money(settledBeforeAdvance + advanceApplied));
    const outstanding = Math.max(0, money(netPayable - totalSettled));
    const paymentStatus = outstanding <= MONEY_TOLERANCE
      ? 'PAID'
      : totalSettled > MONEY_TOLERANCE
        ? 'PARTIAL'
        : 'UNPAID';

    return {
      index,
      result: {
        ...invoice,
        netPayable,
        cashPaid,
        tds,
        shortPayment,
        advanceApplied,
        totalSettled,
        outstanding,
        paymentStatus,
      } satisfies PoSettlementInvoiceResult,
    };
  });

  const results = allocated.sort((a, b) => a.index - b.index).map(({ result }) => result);
  const sum = (selector: (invoice: PoSettlementInvoiceResult) => number) =>
    money(results.reduce((total, invoice) => total + selector(invoice), 0));
  const totalAdvance = Math.max(0, money(advanceAmount));

  return {
    invoices: results,
    totalAdvance,
    advanceApplied: money(totalAdvance - advanceAvailable),
    advanceAvailable,
    invoiced: sum((invoice) => invoice.netPayable),
    cashPaid: sum((invoice) => invoice.cashPaid),
    tds: sum((invoice) => invoice.tds),
    shortPayment: sum((invoice) => invoice.shortPayment),
    totalSettled: sum((invoice) => invoice.totalSettled),
    outstanding: sum((invoice) => invoice.outstanding),
  };
}
