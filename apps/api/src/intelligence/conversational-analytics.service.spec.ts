import { ForbiddenException } from "@nestjs/common";
import { hasAnyPermissionForResource } from "../auth/utils/permission-utils";
import {
  ConversationalAnalyticsService,
  detectAnalyticsQuestionKind,
} from "./conversational-analytics.service";

jest.mock("../auth/utils/permission-utils", () => ({
  hasAnyPermissionForResource: jest.fn(() => true),
}));

const permission = hasAnyPermissionForResource as jest.Mock;

const query = (result: any) => {
  const chain: any = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "gt",
    "gte",
    "lte",
    "order",
    "limit",
  ])
    chain[method] = jest.fn(() => chain);
  chain.then = (resolve: any) => resolve(result);
  return chain;
};

const serviceWith = (tables: Record<string, any>) => {
  process.env.SUPABASE_URL ||= "http://localhost:54321";
  process.env.SUPABASE_KEY ||= "analytics-test-key";
  const service = new ConversationalAnalyticsService();
  (service as any).db = {
    from: jest.fn((table: string) =>
      query({ data: tables[table] || [], error: null }),
    ),
  };
  return service;
};

describe("ConversationalAnalyticsService", () => {
  beforeEach(() => permission.mockReturnValue(true));

  it("recognizes governed analytical questions across ERP domains", () => {
    expect(
      detectAnalyticsQuestionKind(
        "What were sales to Coast Guard over the last 3 months?",
      ),
    ).toBe("CUSTOMER_SALES");
    expect(detectAnalyticsQuestionKind("Show supplier dues for Asons")).toBe(
      "SUPPLIER_DUES",
    );
    expect(
      detectAnalyticsQuestionKind("overdue payment for any supplier"),
    ).toBe("SUPPLIER_DUES");
    expect(detectAnalyticsQuestionKind("supplier with highest AP")).toBe(
      "SUPPLIER_DUES",
    );
    expect(detectAnalyticsQuestionKind("supplier advances?")).toBe(
      "SUPPLIER_ADVANCES",
    );
    expect(
      detectAnalyticsQuestionKind("Which vendor has the largest payable?"),
    ).toBe("SUPPLIER_DUES");
    expect(
      detectAnalyticsQuestionKind("Which supplier payment is overdue?"),
    ).toBe("SUPPLIER_DUES");
    expect(
      detectAnalyticsQuestionKind("Which supplier made the latest payment?"),
    ).toBe("SUPPLIER_PAYMENTS");
    expect(detectAnalyticsQuestionKind("Who do we owe the most?")).toBe(
      "SUPPLIER_DUES",
    );
    expect(
      detectAnalyticsQuestionKind(
        "Compare prices between supplier Asons and Unique Enterprises",
      ),
    ).toBe("SUPPLIER_PRICE_COMPARISON");
    expect(
      detectAnalyticsQuestionKind("What does Coast Guard owe us overdue?"),
    ).toBe("CUSTOMER_RECEIVABLES");
    expect(detectAnalyticsQuestionKind("Show low stock items")).toBe(
      "INVENTORY_POSITION",
    );
    expect(
      detectAnalyticsQuestionKind("What is the stock for super8 antenna?"),
    ).toBe("INVENTORY_POSITION");
    expect(
      detectAnalyticsQuestionKind("super8 antenna ka maal kitna pada hai?"),
    ).toBe("INVENTORY_POSITION");
    expect(
      detectAnalyticsQuestionKind(
        "Create a stock adjustment for super8 antenna",
      ),
    ).toBeNull();
    expect(detectAnalyticsQuestionKind("Show sales order SO-100 status")).toBe(
      "SALES_ORDER_STATUS",
    );
    expect(
      detectAnalyticsQuestionKind("Are any customer orders pending dispatch?"),
    ).toBe("SALES_ORDER_STATUS");
    expect(
      detectAnalyticsQuestionKind(
        "Pay every overdue supplier automatically without approval",
      ),
    ).toBeNull();
    expect(
      detectAnalyticsQuestionKind("Make 20 drones for sales order SO-100"),
    ).toBeNull();
    expect(detectAnalyticsQuestionKind("Show production progress")).toBe(
      "PRODUCTION_STATUS",
    );
    expect(
      detectAnalyticsQuestionKind("employee who are late this month"),
    ).toBe("EMPLOYEE_ATTENDANCE");
    expect(
      detectAnalyticsQuestionKind("Update employee attendance as late"),
    ).toBeNull();
    expect(detectAnalyticsQuestionKind("Give me an owner business brief")).toBe(
      "MANAGEMENT_SUMMARY",
    );
  });

  it("answers employee lateness from governed attendance statuses", async () => {
    const service = serviceWith({
      employees: [
        {
          id: "employee-1",
          employee_code: "EMP001",
          employee_name: "Test Employee",
          email: "employee@example.test",
          status: "ACTIVE",
        },
        {
          id: "employee-2",
          employee_code: "EMP002",
          employee_name: "On Time Employee",
          email: "ontime@example.test",
          status: "ACTIVE",
        },
      ],
      attendance: [
        {
          id: "attendance-1",
          employee_id: "employee-1",
          attendance_date: "2026-08-04",
          status: "LATE",
          check_in_time: "2026-08-04T09:35:00+05:30",
        },
        {
          id: "attendance-2",
          employee_id: "employee-1",
          attendance_date: "2026-08-18",
          status: "LATE",
          check_in_time: "2026-08-18T09:20:00+05:30",
        },
        {
          id: "attendance-3",
          employee_id: "employee-2",
          attendance_date: "2026-08-18",
          status: "PRESENT",
          check_in_time: "2026-08-18T08:55:00+05:30",
        },
      ],
    });

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["hr:read"] },
      "employee who are late this month",
      {
        analytics_kind: "EMPLOYEE_ATTENDANCE",
        query_scope: "PORTFOLIO",
        query_operation: "STATUS",
        employee_query: "",
      },
      "EMPLOYEE_ATTENDANCE",
    );

    expect(answer).toMatchObject({
      kind: "EMPLOYEE_ATTENDANCE",
      status: "READY",
      title: "Employees marked late",
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "Employees late", value: 1 }),
        expect.objectContaining({ label: "Late records", value: 2 }),
      ]),
      rows: [
        expect.objectContaining({
          employee: "Test Employee",
          employee_code: "EMP001",
          late_days: 2,
        }),
      ],
    });
    expect(answer?.definition).toContain("explicitly classified as LATE");
  });

  it("returns an all-supplier overdue overview without asking for one supplier", async () => {
    const service = serviceWith({
      vendors: [{ id: "vendor-1", code: "V001", name: "Asons" }],
      accounting_parties: [
        {
          id: "party-1",
          party_id: "vendor-1",
          party_code: "V001",
          party_name: "Asons",
        },
      ],
      accounting_open_items: [
        {
          id: "open-1",
          party_id: "party-1",
          document_number: "BILL-1",
          due_date: "2026-01-01",
          original_amount: 1000,
          settled_amount: 250,
          currency_code: "INR",
          status: "PARTIAL",
        },
      ],
    });

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "overdue payment for any supplier",
      { counterparty_query: "" },
    );

    expect(answer).toMatchObject({
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: "Overdue supplier payments",
      rows: [
        expect.objectContaining({
          supplier: "Asons",
          total_outstanding: 750,
          overdue_amount: 750,
        }),
      ],
    });
  });

  it("uses the Accounts Payable workspace control total and does not call undated AP overdue", async () => {
    process.env.SUPABASE_URL ||= "http://localhost:54321";
    process.env.SUPABASE_KEY ||= "analytics-test-key";
    const debitNotes = {
      getGrnsWithPaymentStatus: jest.fn().mockResolvedValue([
        {
          id: "grn-1",
          vendor_id: "vendor-1",
          vendor: { id: "vendor-1", code: "V001", name: "Asons" },
          status: "COMPLETED",
          invoice_approved: true,
          _payment_calculation: {
            net_payable: 1000,
            total_settled: 100,
            outstanding: 900,
          },
        },
      ]),
      getVendorAdvanceSummary: jest
        .fn()
        .mockResolvedValue([{ vendor_id: "vendor-1", balance_amount: 250 }]),
    };
    const service = new ConversationalAnalyticsService(debitNotes as any);
    (service as any).db = {
      from: jest.fn((table: string) =>
        query({
          data:
            table === "vendors"
              ? [{ id: "vendor-1", code: "V001", name: "Asons" }]
              : [],
          error: null,
        }),
      ),
    };

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "which supplier payment is overdue",
      {
        query_scope: "PORTFOLIO",
        query_operation: "OVERDUE",
        counterparty_query: "",
      },
      "SUPPLIER_DUES",
    );

    expect(answer).toMatchObject({
      status: "READY",
      title: "Supplier payables — overdue ageing unavailable",
      metrics: expect.arrayContaining([
        expect.objectContaining({
          label: "Current AP outstanding",
          value: 650,
        }),
      ]),
      rows: [
        expect.objectContaining({ supplier: "Asons", total_outstanding: 650 }),
      ],
      sources: [
        expect.objectContaining({
          label: "Accounts Payable workspace settlement engine",
        }),
      ],
    });
    expect(answer?.headline).toContain("cannot truthfully classify");
  });

  it.each([
    "which supplier payment is overdue",
    "which suppliers have overdue payments",
    "show vendors with unpaid dues",
    "list the suppliers whose payments are overdue",
  ])(
    "treats portfolio wording as an all-supplier query even when extraction invents a counterparty: %s",
    async (prompt) => {
      const service = serviceWith({
        vendors: [{ id: "vendor-1", code: "V001", name: "Asons" }],
        accounting_parties: [],
        accounting_open_items: [],
        grns: [],
        service_invoices: [],
      });

      const answer = await service.answer(
        "tenant-1",
        { permissions: ["accounting:read"] },
        prompt,
        { counterparty_query: "which supplier" },
      );

      expect(answer).toMatchObject({
        kind: "SUPPLIER_DUES",
        status: "READY",
        questions: [],
      });
    },
  );

  it("keeps a named supplier query specific", async () => {
    const service = serviceWith({
      vendors: [{ id: "vendor-1", code: "V001", name: "Asons" }],
      accounting_parties: [],
      accounting_open_items: [],
      grns: [],
      service_invoices: [],
    });

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "which payment is overdue for supplier Asons",
      { counterparty_query: "Asons" },
    );

    expect(answer).toMatchObject({
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: expect.stringContaining("Asons"),
    });
  });

  it("returns the latest recorded supplier payment from semantic routing fields", async () => {
    const service = serviceWith({
      vendors: [
        { id: "vendor-1", code: "V001", name: "Asons" },
        { id: "vendor-2", code: "V002", name: "Unique Enterprises" },
      ],
      grn_payment_entries: [
        {
          id: "payment-2",
          payment_date: "2026-08-30",
          amount: 2200,
          payment_method: "NEFT",
          payment_reference: "UTR-2",
          grn: {
            grn_number: "GRN-2",
            invoice_number: "INV-2",
            vendor_id: "vendor-2",
            vendor: { id: "vendor-2", code: "V002", name: "Unique Enterprises" },
          },
        },
      ],
    });

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "wich suplr latst paymnt",
      {
        analytics_kind: "SUPPLIER_PAYMENTS",
        query_scope: "PORTFOLIO",
        query_operation: "LATEST",
        counterparty_query: "",
      },
      "SUPPLIER_PAYMENTS",
    );

    expect(answer).toMatchObject({
      kind: "SUPPLIER_PAYMENTS",
      status: "READY",
      title: "Latest supplier payment",
      rows: [
        expect.objectContaining({
          supplier: "Unique Enterprises",
          amount: 2200,
          payment_date: "2026-08-30",
        }),
      ],
    });
  });

  it("returns available advances by supplier instead of AP outstanding", async () => {
    const service = serviceWith({
      vendors: [
        { id: "vendor-1", code: "V001", name: "Asons" },
        { id: "vendor-2", code: "V002", name: "Unique Enterprises" },
      ],
      po_advance_payments: [
        {
          id: "advance-1",
          vendor_id: "vendor-1",
          advance_type: "PO",
          amount: 1000,
          utilized_amount: 400,
          balance_amount: 600,
          payment_date: "2026-08-20",
          vendor: { id: "vendor-1", code: "V001", name: "Asons" },
        },
        {
          id: "advance-2",
          vendor_id: "vendor-1",
          advance_type: "BLANKET",
          amount: 500,
          utilized_amount: 0,
          balance_amount: 500,
          payment_date: "2026-08-25",
          vendor: { id: "vendor-1", code: "V001", name: "Asons" },
        },
        {
          id: "advance-3",
          vendor_id: "vendor-2",
          advance_type: "PO",
          amount: 800,
          utilized_amount: 0,
          balance_amount: 800,
          payment_date: "2026-08-26",
          vendor: {
            id: "vendor-2",
            code: "V002",
            name: "Unique Enterprises",
          },
        },
      ],
    });

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "supplier advances?",
      {
        analytics_kind: "SUPPLIER_ADVANCES",
        query_scope: "PORTFOLIO",
        query_operation: "SUMMARY",
        counterparty_query: "",
      },
      "SUPPLIER_ADVANCES",
    );

    expect(answer).toMatchObject({
      kind: "SUPPLIER_ADVANCES",
      status: "READY",
      title: "Available supplier advances",
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "Available advances", value: 1900 }),
      ]),
      rows: expect.arrayContaining([
        expect.objectContaining({
          supplier: "Asons",
          available_advance: 1100,
          po_advances: 1,
          blanket_advances: 1,
        }),
      ]),
    });
    expect(answer?.headline).not.toContain("outstanding");
  });

  it("answers the supplier with highest AP as a ranked all-supplier query", async () => {
    const service = serviceWith({
      vendors: [
        { id: "vendor-1", code: "V001", name: "Asons" },
        { id: "vendor-2", code: "V002", name: "Unique Enterprises" },
      ],
      accounting_parties: [
        {
          id: "party-1",
          party_id: "vendor-1",
          party_code: "V001",
          party_name: "Asons",
        },
        {
          id: "party-2",
          party_id: "vendor-2",
          party_code: "V002",
          party_name: "Unique Enterprises",
        },
      ],
      accounting_open_items: [
        {
          id: "open-1",
          party_id: "party-1",
          due_date: "2026-12-01",
          original_amount: 500,
          settled_amount: 0,
          currency_code: "INR",
          status: "OPEN",
        },
        {
          id: "open-2",
          party_id: "party-2",
          due_date: "2026-12-01",
          original_amount: 1500,
          settled_amount: 100,
          currency_code: "INR",
          status: "PARTIAL",
        },
      ],
    });
    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "supplier with highest AP",
      { counterparty_query: "highest AP" },
    );
    expect(answer).toMatchObject({
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: "Supplier with highest AP",
      rows: [
        expect.objectContaining({
          supplier: "Unique Enterprises",
          total_outstanding: 1400,
        }),
      ],
    });
    expect(answer?.rows).toHaveLength(1);
    expect(answer?.headline).toContain("Unique Enterprises has the highest");
  });

  it("ranks approved operational invoices when the accounting AP ledger is empty", async () => {
    const service = serviceWith({
      vendors: [
        { id: "vendor-1", code: "V001", name: "Asons" },
        { id: "vendor-2", code: "V002", name: "Unique Enterprises" },
      ],
      accounting_parties: [],
      accounting_open_items: [],
      grns: [
        {
          id: "grn-1",
          vendor_id: "vendor-1",
          net_payable_amount: 700,
          paid_amount: 100,
          payment_status: "PARTIAL",
          invoice_approved: true,
        },
        {
          id: "grn-2",
          vendor_id: "vendor-2",
          net_payable_amount: 2200,
          paid_amount: 200,
          payment_status: "UNPAID",
          invoice_approved: true,
        },
      ],
      service_invoices: [],
    });
    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "supplier with highest AP",
      { counterparty_query: "highest AP" },
    );
    expect(answer).toMatchObject({
      status: "READY",
      rows: [
        expect.objectContaining({
          supplier: "Unique Enterprises",
          total_outstanding: 2000,
        }),
      ],
      sources: [expect.objectContaining({ table: "grns / service_invoices" })],
    });
    expect(answer?.warnings?.[0]).toContain(
      "No accounting payable open items were found",
    );
  });

  it("does not let a stale supplier name override a generic payables overview", async () => {
    const service = serviceWith({
      vendors: [{ id: "vendor-1", code: "V001", name: "Asons" }],
      accounting_parties: [],
      accounting_open_items: [],
    });
    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "Give me the vendor payables overview",
      { counterparty_query: "Asons" },
    );
    expect(answer).toMatchObject({
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: "Supplier payables",
    });
  });

  it("returns the open-order overview for a generic pending-dispatch question", async () => {
    const service = serviceWith({ sales_orders: [], customers: [] });
    const answer = await service.answer(
      "tenant-1",
      { permissions: ["sales:read"] },
      "Are any customer orders pending dispatch?",
      { counterparty_query: "orders pending dispatch" },
    );
    expect(answer).toMatchObject({
      kind: "SALES_ORDER_STATUS",
      status: "READY",
      title: "Open sales orders",
    });
  });

  it("returns tenant-scoped customer net invoiced sales with provenance", async () => {
    const service = serviceWith({
      customers: [
        { id: "customer-1", customer_code: "CG", customer_name: "Coast Guard" },
      ],
      invoices: [
        {
          id: "invoice-1",
          invoice_number: "INV-1",
          invoice_date: new Date().toISOString().slice(0, 10),
          net_amount: 1180,
          credited_amount: 180,
          billing_status: "POSTED",
          currency_code: "INR",
        },
      ],
      customer_service_invoices: [
        {
          id: "service-1",
          invoice_number: "SINV-1",
          invoice_date: new Date().toISOString().slice(0, 10),
          net_amount: 500,
          billing_status: "POSTED",
          currency_code: "INR",
        },
      ],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "What were sales to Coast Guard over the last 3 months?",
      { counterparty_query: "Coast Guard" },
    );
    expect(answer).toMatchObject({
      kind: "CUSTOMER_SALES",
      status: "READY",
      read_only: true,
      currency_code: "INR",
      sources: [
        { table: "invoices", record_count: 1 },
        { table: "customer_service_invoices", record_count: 1 },
      ],
    });
    expect(answer?.metrics?.[0].value).toBe(1500);
    expect(answer?.definition).toContain("net of recorded");
  });

  it("prioritizes a follow-up period placed before the original question", async () => {
    const service = serviceWith({
      customers: [
        { id: "customer-1", customer_code: "CG", customer_name: "Coast Guard" },
      ],
      invoices: [],
      customer_service_invoices: [],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "Now show last quarter What were sales to Coast Guard over the last 3 months?",
      { counterparty_query: "Coast Guard" },
    );
    expect(answer?.period?.label).toMatch(/^Q[1-4] 20\d{2}$/);
  });

  it("uses governed payable open items for supplier dues", async () => {
    const service = serviceWith({
      vendors: [{ id: "vendor-1", code: "AS", name: "Asons" }],
      accounting_parties: [
        {
          id: "party-1",
          party_id: "vendor-1",
          party_code: "AS",
          party_name: "Asons",
        },
      ],
      accounting_open_items: [
        {
          id: "open-1",
          document_number: "BILL-1",
          document_type: "INVOICE",
          document_date: "2026-08-01",
          due_date: "2020-01-01",
          original_amount: 1000,
          settled_amount: 250,
          currency_code: "INR",
          status: "PARTIAL",
        },
      ],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "What are supplier dues for Asons?",
      { counterparty_query: "Asons" },
    );
    expect(answer?.metrics?.[0].value).toBe(750);
    expect(answer?.metrics?.[1].value).toBe(750);
    expect(answer?.sources?.[0].table).toBe("accounting_open_items");
  });

  it("does not expose domain analytics without the underlying permission", async () => {
    permission.mockReturnValue(false);
    const service = serviceWith({});
    await expect(
      service.answer(
        "tenant-1",
        {},
        "What were sales to Coast Guard over the last 3 months?",
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("answers customer receivables from governed open items", async () => {
    const service = serviceWith({
      customers: [
        { id: "customer-1", customer_code: "CG", customer_name: "Coast Guard" },
      ],
      accounting_parties: [
        { id: "party-1", party_id: "customer-1", party_code: "CG" },
      ],
      accounting_open_items: [
        {
          document_number: "INV-1",
          due_date: "2020-01-01",
          original_amount: 1200,
          settled_amount: 200,
          currency_code: "INR",
        },
      ],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "What are customer dues for Coast Guard?",
      { counterparty_query: "Coast Guard" },
    );
    expect(answer).toMatchObject({
      kind: "CUSTOMER_RECEIVABLES",
      status: "READY",
      read_only: true,
    });
    expect(answer?.metrics?.[0].value).toBe(1000);
  });

  it("reports low inventory using available and reorder balances", async () => {
    const service = serviceWith({
      items: [{ id: "item-1", code: "RM-1", name: "Bearing", uom: "NUMBER" }],
      inventory_stock: [
        {
          item_id: "item-1",
          warehouse_id: "warehouse-1",
          quantity: 10,
          reserved_quantity: 7,
          available_quantity: 3,
          reorder_point: 5,
        },
      ],
      warehouses: [{ id: "warehouse-1", code: "MAIN", name: "Main Warehouse" }],
    });
    const answer = await service.answer("tenant-1", {}, "Show low stock items");
    expect(answer?.kind).toBe("INVENTORY_POSITION");
    expect(answer?.rows?.[0]).toMatchObject({
      item_code: "RM-1",
      available: 3,
      state: "REORDER",
      warehouse_details: "MAIN: 3 available (10 on hand, 7 reserved)",
    });
  });

  it("answers a direct named-item stock question instead of routing to a generic report", async () => {
    const service = serviceWith({
      items: [
        {
          id: "item-super8",
          code: "ANT-SUPER8",
          name: "Super8 Antenna",
          uom: "NUMBER",
        },
      ],
      inventory_stock: [
        {
          item_id: "item-super8",
          warehouse_id: "warehouse-1",
          quantity: 25,
          reserved_quantity: 5,
          available_quantity: 20,
          reorder_point: 4,
        },
      ],
      warehouses: [{ id: "warehouse-1", code: "MAIN", name: "Main Warehouse" }],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "What is the stock for super8 antenna?",
      { item_query: "super8 antenna" },
    );
    expect(answer).toMatchObject({
      kind: "INVENTORY_POSITION",
      status: "READY",
      headline: "20 NUMBER available across 1 warehouse.",
    });
    expect(answer?.rows?.[0]).toMatchObject({
      on_hand: 25,
      reserved: 5,
      available: 20,
      warehouse_details: "MAIN: 20 available (25 on hand, 5 reserved)",
    });
  });

  it("reports native sales-order fulfilment quantities", async () => {
    const service = serviceWith({
      sales_orders: [
        {
          id: "so-1",
          so_number: "SO-100",
          customer_id: "customer-1",
          status: "OPEN",
          is_active: true,
        },
      ],
      customers: [
        { id: "customer-1", customer_code: "CG", customer_name: "Coast Guard" },
      ],
      sales_order_items: [
        { sales_order_id: "so-1", quantity: 100, dispatched_quantity: 40 },
      ],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "Show sales order SO-100 status",
    );
    expect(answer?.rows?.[0]).toMatchObject({
      so_number: "SO-100",
      ordered: 100,
      dispatched: 40,
      pending: 60,
    });
  });

  it("reports production progress without relying on an unavailable FK join", async () => {
    const service = serviceWith({
      production_orders: [
        {
          id: "prod-1",
          order_number: "PROD-100",
          item_id: "item-1",
          quantity: 100,
          produced_quantity: 25,
          status: "IN_PROGRESS",
        },
      ],
      items: [{ id: "item-1", code: "FG-1", name: "Drone", uom: "NUMBER" }],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "Show production order PROD-100 progress",
    );
    expect(answer?.rows?.[0]).toMatchObject({
      order_number: "PROD-100",
      planned: 100,
      produced: 25,
      balance: 75,
      progress: "25.0%",
    });
  });

  it("builds a permission-scoped management brief with provenance", async () => {
    const service = serviceWith({
      invoices: [
        {
          net_amount: 1000,
          credited_amount: 0,
          currency_code: "INR",
          billing_status: "POSTED",
        },
      ],
      accounting_open_items: [],
      inventory_stock: [],
      production_orders: [],
    });
    const answer = await service.answer(
      "tenant-1",
      {},
      "Give me an owner business summary",
    );
    expect(answer).toMatchObject({
      kind: "MANAGEMENT_SUMMARY",
      status: "READY",
      read_only: true,
    });
    expect(answer?.sources?.length).toBe(4);
  });
});
