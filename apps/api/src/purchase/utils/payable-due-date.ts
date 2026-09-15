export type PayableDueDate = {
  payment_terms: string;
  credit_days: number;
  due_date: string | null;
  days_overdue: number;
  is_overdue: boolean;
  due_date_basis: "RECEIPT_DATE" | "INVOICE_DATE" | "NONE";
  terms_source: "PURCHASE_ORDER" | "VENDOR" | "DEFAULT_POLICY";
};

const text = (value: unknown) => String(value ?? "").trim();

const metadataPaymentTerms = (value: unknown) => {
  if (!value) return "";
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return "";
    return text(
      (parsed as any).paymentTermsText ||
        (parsed as any).payment_terms_text ||
        (parsed as any).customPaymentTerms ||
        (parsed as any).custom_payment_terms,
    );
  } catch {
    return "";
  }
};

export const payableCreditDays = (terms: unknown): number | null => {
  const normalized = text(terms).toUpperCase().replace(/[-\s]+/g, "_");
  if (!normalized) return null;
  if (
    normalized === "ADVANCE" ||
    normalized === "COD" ||
    /\b(IMMEDIATE|ON_DELIVERY|ON_RECEIPT)\b/.test(normalized)
  )
    return 0;
  const net = normalized.match(/\bNET_?(\d{1,3})\b/);
  if (net) return Math.min(365, Number(net[1]));
  const days = normalized.match(/(?:^|_)(\d{1,3})_?DAYS?(?:_|$)/);
  return days ? Math.min(365, Number(days[1])) : null;
};

const isoDate = (value: unknown) => {
  const raw = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
};

const dateDifference = (later: string, earlier: string) => {
  const left = Date.parse(`${later}T00:00:00Z`);
  const right = Date.parse(`${earlier}T00:00:00Z`);
  return Math.max(0, Math.floor((left - right) / 86400000));
};

export function derivePayableDueDate(input: {
  receipt_date?: unknown;
  invoice_date?: unknown;
  po_payment_terms?: unknown;
  po_terms_and_conditions?: unknown;
  vendor_payment_terms?: unknown;
  today?: string;
}): PayableDueDate {
  const customPoTerms = metadataPaymentTerms(input.po_terms_and_conditions);
  const poTerms = customPoTerms || text(input.po_payment_terms);
  const vendorTerms = text(input.vendor_payment_terms);
  const poDays = payableCreditDays(poTerms);
  const vendorDays = payableCreditDays(vendorTerms);
  const creditDays = poDays ?? vendorDays ?? 30;
  const paymentTerms =
    (poDays !== null ? poTerms : "") ||
    (vendorDays !== null ? vendorTerms : "") ||
    "NET_30";
  const termsSource =
    poDays !== null
      ? "PURCHASE_ORDER"
      : vendorDays !== null
        ? "VENDOR"
        : "DEFAULT_POLICY";
  const receiptDate = isoDate(input.receipt_date);
  const invoiceDate = isoDate(input.invoice_date);
  const basisDate = receiptDate || invoiceDate;
  const basis = receiptDate
    ? "RECEIPT_DATE"
    : invoiceDate
      ? "INVOICE_DATE"
      : "NONE";
  const dueDate = basisDate ? addDays(basisDate, creditDays) : null;
  const today = isoDate(input.today) || new Date().toISOString().slice(0, 10);
  const isOverdue = Boolean(dueDate && dueDate < today);
  return {
    payment_terms: paymentTerms,
    credit_days: creditDays,
    due_date: dueDate,
    days_overdue: isOverdue && dueDate ? dateDifference(today, dueDate) : 0,
    is_overdue: isOverdue,
    due_date_basis: basis,
    terms_source: termsSource,
  };
}
