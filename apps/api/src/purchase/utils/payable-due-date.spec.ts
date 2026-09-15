import { derivePayableDueDate, payableCreditDays } from "./payable-due-date";

describe("payable due date", () => {
  it.each([
    ["NET_30", 30],
    ["Net 45", 45],
    ["payment within 60 days", 60],
    ["COD", 0],
    ["Immediate", 0],
  ])("parses %s", (terms, expected) => {
    expect(payableCreditDays(terms)).toBe(expected);
  });

  it("uses PO terms and receipt date as the governed AP basis", () => {
    expect(
      derivePayableDueDate({
        receipt_date: "2026-07-01",
        invoice_date: "2026-06-25",
        po_payment_terms: "NET_30",
        vendor_payment_terms: "NET_60",
        today: "2026-08-05",
      }),
    ).toEqual({
      payment_terms: "NET_30",
      credit_days: 30,
      due_date: "2026-07-31",
      days_overdue: 5,
      is_overdue: true,
      due_date_basis: "RECEIPT_DATE",
      terms_source: "PURCHASE_ORDER",
    });
  });

  it("falls back to vendor terms and then the NET 30 policy", () => {
    expect(
      derivePayableDueDate({
        invoice_date: "2026-08-01",
        vendor_payment_terms: "NET_15",
        today: "2026-08-10",
      }),
    ).toMatchObject({
      credit_days: 15,
      due_date: "2026-08-16",
      due_date_basis: "INVOICE_DATE",
      terms_source: "VENDOR",
      is_overdue: false,
    });
    expect(
      derivePayableDueDate({ receipt_date: "2026-08-01", today: "2026-09-01" }),
    ).toMatchObject({
      payment_terms: "NET_30",
      due_date: "2026-08-31",
      terms_source: "DEFAULT_POLICY",
      days_overdue: 1,
    });
  });
});
