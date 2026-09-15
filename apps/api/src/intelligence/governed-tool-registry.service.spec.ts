import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { GovernedToolRegistryService } from "./governed-tool-registry.service";

describe("GovernedToolRegistryService security boundary", () => {
  const registry = new GovernedToolRegistryService();

  it("rejects an unregistered tool", () =>
    expect(() => registry.require("DROP_DATABASE")).toThrow(
      BadRequestException,
    ));
  it("publishes only the explicit governed catalogue", () => {
    const catalogue = registry.catalogue();
    expect(catalogue).toHaveLength(23);
    expect(catalogue.map((tool) => tool.code)).toEqual(
      expect.arrayContaining([
        "CREATE_PURCHASE_ORDER_DRAFT",
        "CREATE_PRODUCTION_JOB_ORDER_DRAFT",
        "CREATE_SUPPLY_RESCHEDULE_REVIEW",
        "APPLY_SALES_ORDER_HOLD",
        "CREATE_BANK_RECONCILIATION_REVIEW",
        "CREATE_STOCK_COUNT_ADJUSTMENT",
        "CREATE_SERVICE_ENTRY_DRAFT",
        "CREATE_GRN_DRAFT",
        "CREATE_SALES_INVOICE",
        "POST_CUSTOMER_RECEIPT",
        "POST_SALES_DISPATCH",
        "CREATE_MANUAL_SIV",
        "CREATE_MANUAL_SRV_RETURN",
      ]),
    );
  });
  it("rejects unknown payload fields", () => {
    const tool = registry.require("CREATE_REVIEW_TASK");
    expect(() =>
      registry.validate(tool, { insight_id: "i-1", arbitrary_sql: "select *" }),
    ).toThrow("Unsupported action field");
  });
  it("rejects missing native-action inputs", () => {
    const tool = registry.require("CREATE_MAINTENANCE_WORK_ORDER");
    expect(() => registry.validate(tool, { insight_id: "i-1" })).toThrow(
      "Required action field",
    );
  });
  it("rejects unbounded text", () => {
    const tool = registry.require("CREATE_QUALITY_NCR");
    expect(() =>
      registry.validate(tool, {
        insight_id: "i-1",
        description: "x".repeat(501),
        nonconformance_type: "MATERIAL",
      }),
    ).toThrow("maximum length");
  });
  it("rejects malformed dates", () => {
    const tool = registry.require("CREATE_REVIEW_TASK");
    expect(() =>
      registry.validate(tool, { insight_id: "i-1", due_date: "tomorrow" }),
    ).toThrow("YYYY-MM-DD");
  });
  it("rejects stock-count payloads whose delta or direction does not reconcile", () => {
    const tool = registry.require("CREATE_STOCK_COUNT_ADJUSTMENT");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-1",
        item_id: "item-1",
        warehouse_id: "warehouse-1",
        counted_quantity: 8,
        expected_system_quantity: 10,
        adjustment_quantity: 3,
        direction: "INCREASE",
        reason: "Cycle count variance",
      }),
    ).toThrow("does not reconcile");
  });
  it("rejects malformed or empty service-entry lines", () => {
    const tool = registry.require("CREATE_SERVICE_ENTRY_DRAFT");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-2",
        po_id: "po-1",
        completion_date: "2026-08-30",
        completion_notes: "Signed completion evidence",
        items: [{ po_item_id: "po-line-1", accepted_quantity: 0 }],
      }),
    ).toThrow("positive accepted quantity");
  });
  it("rejects a GRN without server-uploaded invoice metadata", () => {
    const tool = registry.require("CREATE_GRN_DRAFT");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-3",
        po_id: "po-1",
        vendor_id: "vendor-1",
        warehouse_id: "warehouse-1",
        receipt_date: "2026-08-30",
        invoice_number: "INV-1",
        invoice_date: "2026-08-29",
        invoice_file: { url: "data:application/pdf;base64,AAAA" },
        items: [
          {
            po_item_id: "line-1",
            item_id: "item-1",
            received_quantity: 1,
          },
        ],
      }),
    ).toThrow("server-uploaded supplier invoice");
  });
  it("rejects a sales invoice whose due date precedes its invoice date", () => {
    const tool = registry.require("CREATE_SALES_INVOICE");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-4",
        dispatch_id: "dispatch-1",
        invoice_date: "2026-08-30",
        due_date: "2026-08-29",
      }),
    ).toThrow("cannot be before");
  });
  it("requires a transaction reference for a non-cash customer receipt", () => {
    const tool = registry.require("POST_CUSTOMER_RECEIPT");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-5",
        invoice_id: "invoice-1",
        amount: 100,
        payment_method: "NEFT",
        receipt_date: "2026-08-30",
      }),
    ).toThrow("transaction reference");
  });
  it("rejects a dispatch whose UID count does not match its quantity", () => {
    const tool = registry.require("POST_SALES_DISPATCH");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-6",
        sales_order_id: "so-1",
        dispatch_date: "2026-08-30",
        delivery_address: "Customer dock",
        items: [
          {
            sales_order_item_id: "line-1",
            item_id: "item-1",
            quantity: 2,
            uid: ["UID-1"],
          },
        ],
      }),
    ).toThrow("one exact UID per unit");
  });
  it("rejects invalid quantities and duplicate UIDs in a manual SIV", () => {
    const tool = registry.require("CREATE_MANUAL_SIV");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-7",
        item_id: "item-1",
        issue_quantity: 0,
        issued_to_employee_id: "employee-1",
        notes: "Custody purpose",
      }),
    ).toThrow("greater than zero");
    expect(() =>
      registry.validate(tool, {
        insight_id: "ACTIVE_PLANNER:context-7",
        item_id: "item-1",
        issue_quantity: 2,
        issued_to_employee_id: "employee-1",
        notes: "Custody purpose",
        uids: ["UID-1", "UID-1"],
      }),
    ).toThrow("same UID");
  });
  it("rejects invalid quantities, conditions and duplicate UIDs in an SRV return", () => {
    const tool = registry.require("CREATE_MANUAL_SRV_RETURN"),
      base = {
        insight_id: "ACTIVE_PLANNER:context-8",
        source_voucher_number: "ISS-1",
        item_id: "item-1",
        return_quantity: 1,
        returned_by_employee_id: "employee-1",
        condition: "GOOD",
        reason: "Unused material",
      };
    expect(() =>
      registry.validate(tool, { ...base, return_quantity: 0 }),
    ).toThrow("greater than zero");
    expect(() =>
      registry.validate(tool, { ...base, condition: "AVAILABLE" }),
    ).toThrow("must be GOOD");
    expect(() =>
      registry.validate(tool, { ...base, uids: ["UID-1", "UID-1"] }),
    ).toThrow("same UID");
  });
  it("denies a native tool without its permission", () => {
    expect(() =>
      registry.authorize(
        registry.require("CREATE_PURCHASE_REQUISITION_DRAFT"),
        { id: "u-1", permissions: [] },
      ),
    ).toThrow(ForbiddenException);
  });
  it("allows the exact native permission", () => {
    expect(() =>
      registry.authorize(
        registry.require("CREATE_PURCHASE_REQUISITION_DRAFT"),
        { id: "u-1", permissions: ["purchase_requisitions:create"] },
      ),
    ).not.toThrow();
  });
  it("allows an administrator but not a similarly named role", () => {
    const tool = registry.require("CREATE_QUALITY_NCR");
    expect(() =>
      registry.authorize(tool, { id: "u-1", role: "ADMIN" }),
    ).not.toThrow();
    expect(() =>
      registry.authorize(tool, { id: "u-2", role: "ADMIN_ASSISTANT" }),
    ).toThrow(ForbiddenException);
  });
});
