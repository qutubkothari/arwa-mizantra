import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  ACTIVE_PLANNER_EXTRACTION_SCHEMA,
  ActivePlannerService,
  buildGovernedPlannerAction,
  deterministicPlannerParse,
  extractProductionLines,
  isAmbiguousPlannerPrompt,
  normalizePlannerDate,
  normalizePlannerCurrency,
  normalizePlannerUom,
  plannerMessageContinuesContext,
  sanitizePlannerAttachments,
} from "./active-planner.service";
import {
  ACTIVE_PLANNER_CAPABILITIES,
  detectPlannerIntent,
} from "./active-planner.capabilities";

const extracted = () =>
  deterministicPlannerParse(
    "Create a sales order for MOD for 10 drones at 100 each by 30-09-2026",
  );

const makeService = (
  aiOverrides: Record<string, unknown> = {},
  analyticsOverrides: Record<string, unknown> = {},
  semanticOverrides?: Record<string, unknown>,
) => {
  process.env.SUPABASE_URL ||= "http://localhost:54321";
  process.env.SUPABASE_KEY ||= "active-planner-test-key";
  const ai = {
    status: jest
      .fn()
      .mockReturnValue({ configured: true, api_mode: "RESPONSES" }),
    structuredJson: jest.fn().mockResolvedValue({
      value: extracted(),
      provider: "DETERMINISTIC_FALLBACK",
      fallback_used: true,
    }),
    ...aiOverrides,
  };
  const analytics = {
    recognizes: jest.fn().mockReturnValue(false),
    answer: jest.fn().mockResolvedValue(null),
    ...analyticsOverrides,
  };
  const service = new ActivePlannerService(
    ai as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    analytics as any,
    semanticOverrides
      ? ({
          answer: jest.fn().mockResolvedValue(null),
          ...semanticOverrides,
        } as any)
      : undefined,
  );
  return { service, ai };
};

describe("Active Planner deterministic extraction", () => {
  it("routes factory-readiness questions to the production copilot", () => {
    expect(
      detectPlannerIntent("Is JO-2026-00010 ready for production?"),
    ).toBe("FACTORY_READINESS");
    expect(
      detectPlannerIntent("What should I do next for job order JO-2026-00010?"),
    ).toBe("FACTORY_READINESS");
    expect(
      detectPlannerIntent("Why is JO-2026-00010 waiting for previous stage?"),
    ).toBe("FACTORY_READINESS");
  });

  it("routes MRP release and audited supervisor override requests", () => {
    expect(
      detectPlannerIntent("Prepare the approved MRP recommendations for release"),
    ).toBe("MRP_RELEASE");
    expect(
      detectPlannerIntent(
        "Override predecessor block for JO-2026-00010 because batch one is physically verified",
      ),
    ).toBe("PRODUCTION_OVERRIDE");
  });

  it("distinguishes document lookup language from document creation", () => {
    expect(detectPlannerIntent("I need a PR from 25 August 2026")).toBe(
      "REPORT",
    );
    expect(
      detectPlannerIntent("Show purchase requisitions for Production"),
    ).toBe("REPORT");
    expect(detectPlannerIntent("list all job orders")).toBe("REPORT");
    expect(detectPlannerIntent("Create a PR for 10 bearings")).toBe(
      "PURCHASE_REQUISITION",
    );
  });

  it("retains only genuine follow-ups and treats complete requests as new topics", () => {
    expect(plannerMessageContinuesContext("Now show last quarter")).toBe(true);
    expect(plannerMessageContinuesContext("and how many are reserved?")).toBe(
      true,
    );
    expect(plannerMessageContinuesContext("Asons")).toBe(true);
    expect(
      plannerMessageContinuesContext(
        "We need to buy 50 bearings next Friday for maintenance",
      ),
    ).toBe(false);
    expect(plannerMessageContinuesContext("Order 100 cartons from Asons")).toBe(
      false,
    );
    expect(isAmbiguousPlannerPrompt("What is pending?")).toBe(true);
  });

  it("normalizes currency labels before preview or execution", () => {
    expect(normalizePlannerCurrency("Rs")).toBe("INR");
    expect(normalizePlannerCurrency("₹")).toBe("INR");
    expect(normalizePlannerCurrency("dhs")).toBe("AED");
    expect(normalizePlannerCurrency("usd")).toBe("USD");
    expect(normalizePlannerCurrency("unknown")).toBe("INR");
  });
  it("extracts the named item from a direct stock question", () => {
    expect(
      deterministicPlannerParse("What is the stock for super8 antenna?")
        .item_query,
    ).toBe("super8 antenna");
  });
  it("classifies natural purchasing and production commands without prior-topic leakage", () => {
    expect(
      detectPlannerIntent(
        "We need to buy 50 bearings next Friday for maintenance",
      ),
    ).toBe("PURCHASE_REQUISITION");
    expect(detectPlannerIntent("Order 100 cartons from Asons")).toBe(
      "PURCHASE_ORDER",
    );
    expect(detectPlannerIntent("Make 20 drones for sales order SO-100")).toBe(
      "PRODUCTION_PLAN",
    );
    expect(
      detectPlannerIntent(
        "Pay every overdue supplier automatically without approval",
      ),
    ).toBe("PAYMENT_RUN");
    expect(
      detectPlannerIntent("Approve and post all pending journals now"),
    ).toBe("JOURNAL_ENTRY");
  });
  it("normalizes valid Indian dates and rejects impossible calendar dates", () => {
    expect(normalizePlannerDate("29-08-2026")).toBe("2026-08-29");
    expect(normalizePlannerDate("2026-08-30")).toBe("2026-08-30");
    expect(normalizePlannerDate("31-02-2026")).toBe("");
  });
  it("accepts only tenant/user-bound server uploads", () => {
    expect(
      sanitizePlannerAttachments(
        [
          {
            url: "/uploads/grn/invoices/2026-08-30/tenant-1/user-1/invoice.pdf",
            name: "invoice.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        "tenant-1",
        "user-1",
      ),
    ).toHaveLength(1);
    expect(() =>
      sanitizePlannerAttachments(
        [
          {
            url: "/uploads/grn/invoices/2026-08-30/tenant-2/user-2/invoice.pdf",
            name: "invoice.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        "tenant-1",
        "user-1",
      ),
    ).toThrow("does not belong");
  });
  it("builds an approval-gated job-order request only with a resolved active BOM", () => {
    const context = {
      context_id: "11111111-1111-4111-8111-111111111111",
      extracted: {
        intent_type: "JOB_ORDER",
        quantity: 100,
        delivery_date: "2026-09-30",
        priority: "HIGH",
        notes: "Create job for 100 impellers",
      },
      resolved: {
        item: { id: "item-1", name: "Impeller" },
        bom: { id: "bom-1", is_active: true },
      },
    };
    expect(buildGovernedPlannerAction(context)).toMatchObject({
      action_code: "CREATE_PRODUCTION_JOB_ORDER_DRAFT",
      payload: {
        insight_id: "ACTIVE_PLANNER:11111111-1111-4111-8111-111111111111",
        item_id: "item-1",
        bom_id: "bom-1",
        quantity: 100,
      },
    });
    expect(
      buildGovernedPlannerAction({
        ...context,
        resolved: { item: context.resolved.item, bom: null },
      }),
    ).toBeNull();
  });

  it("builds a quality NCR approval request without accepting or scrapping stock", () => {
    const action = buildGovernedPlannerAction({
      context_id: "22222222-2222-4222-8222-222222222222",
      extracted: {
        intent_type: "QUALITY_NCR",
        quantity: 5,
        notes: "Raise NCR for five rejected impellers with casting damage",
      },
      resolved: { item: { id: "item-2", name: "Impeller" } },
    });
    expect(action).toMatchObject({
      action_code: "CREATE_QUALITY_NCR",
      payload: {
        nonconformance_type: "MATERIAL",
        quantity_affected: 5,
      },
    });
    expect(action?.payload).not.toHaveProperty("accepted_quantity");
    expect(action?.payload).not.toHaveProperty("scrap_quantity");
  });

  it("builds a maintenance work-order request only for a resolved tenant asset", () => {
    const context = {
      context_id: "33333333-3333-4333-8333-333333333333",
      extracted: {
        intent_type: "MAINTENANCE_WORK_ORDER",
        work_type: "BREAKDOWN",
        priority: "URGENT",
        delivery_date: "2026-08-31",
        notes:
          "Create urgent breakdown maintenance for CNC-2 due to spindle noise",
      },
      resolved: {
        asset: { id: "asset-1", asset_code: "CNC-2", asset_name: "CNC 2" },
      },
    };
    expect(buildGovernedPlannerAction(context)).toMatchObject({
      action_code: "CREATE_MAINTENANCE_WORK_ORDER",
      payload: {
        insight_id: "ACTIVE_PLANNER:33333333-3333-4333-8333-333333333333",
        asset_id: "asset-1",
        work_type: "BREAKDOWN",
        priority: "URGENT",
        planned_date: "2026-08-31",
      },
    });
    expect(
      buildGovernedPlannerAction({ ...context, resolved: { asset: null } }),
    ).toBeNull();
  });

  it("builds a reconciled non-UID stock-count adjustment request", () => {
    const context = {
      context_id: "44444444-4444-4444-8444-444444444444",
      extracted: {
        intent_type: "STOCK_ADJUSTMENT",
        quantity: 8,
        reason: "Cycle count found two damaged pieces",
        delivery_date: "2026-08-30",
      },
      resolved: {
        item: {
          id: "item-4",
          category: "RAW_MATERIAL",
          uid_tracking: false,
        },
        warehouse: { id: "warehouse-1" },
        stock_snapshot: { available_quantity: 10 },
      },
    };
    expect(buildGovernedPlannerAction(context)).toMatchObject({
      action_code: "CREATE_STOCK_COUNT_ADJUSTMENT",
      payload: {
        counted_quantity: 8,
        expected_system_quantity: 10,
        adjustment_quantity: 2,
        direction: "DECREASE",
      },
    });
    expect(
      buildGovernedPlannerAction({
        ...context,
        resolved: {
          ...context.resolved,
          item: { ...context.resolved.item, uid_tracking: true },
        },
      }),
    ).toBeNull();
  });

  it("builds a service-entry draft request without accepting the service", () => {
    const action = buildGovernedPlannerAction({
      context_id: "55555555-5555-4555-8555-555555555555",
      extracted: {
        intent_type: "SERVICE_ENTRY",
        quantity: 6,
        delivery_date: "2026-08-30",
        reason: "Supervisor signed the completion sheet",
      },
      resolved: {
        purchase_order: {
          id: "po-1",
          delivery_address: "Factory A",
        },
        purchase_order_line: { id: "po-line-1" },
      },
    });
    expect(action).toMatchObject({
      action_code: "CREATE_SERVICE_ENTRY_DRAFT",
      payload: {
        po_id: "po-1",
        completion_date: "2026-08-30",
        completion_notes: "Supervisor signed the completion sheet",
        items: [{ po_item_id: "po-line-1", accepted_quantity: 6 }],
      },
    });
    expect(action?.payload).not.toHaveProperty("status");
    expect(action?.payload).not.toHaveProperty("approved_quantity");
  });

  it("builds a GRN request only with a secured invoice and exact PO line", () => {
    const action = buildGovernedPlannerAction({
      context_id: "66666666-6666-4666-8666-666666666666",
      attachments: [
        {
          url: "/uploads/grn/invoices/2026-08-30/tenant/user/invoice.pdf",
          name: "invoice.pdf",
          type: "application/pdf",
          size: 100,
        },
      ],
      extracted: {
        intent_type: "GOODS_RECEIPT",
        quantity: 5,
        invoice_number: "INV-55",
        invoice_date: "2026-08-29",
        receipt_date: "2026-08-30",
        notes: "Receive five bearings",
      },
      resolved: {
        purchase_order: { id: "po-6", vendor_id: "vendor-6" },
        purchase_order_line: {
          id: "line-6",
          item_code: "BRG-01",
          item_name: "Bearing",
          ordered_qty: 10,
          rate: 100,
        },
        item: { id: "item-6" },
        warehouse: { id: "warehouse-6" },
      },
    });
    expect(action).toMatchObject({
      action_code: "CREATE_GRN_DRAFT",
      payload: {
        po_id: "po-6",
        invoice_number: "INV-55",
        items: [
          {
            po_item_id: "line-6",
            item_id: "item-6",
            received_quantity: 5,
          },
        ],
      },
    });
  });

  it("builds a sales invoice approval from one eligible dispatch", () => {
    expect(
      buildGovernedPlannerAction({
        context_id: "77777777-7777-4777-8777-777777777777",
        extracted: {
          intent_type: "SALES_INVOICE",
          invoice_date: "2026-08-30",
          due_date: "2026-09-29",
          notes: "Bill the completed dispatch",
        },
        resolved: {
          invoice_readiness: {
            ready: true,
            dispatch: { id: "dispatch-1", dispatch_number: "DN-1" },
          },
        },
      }),
    ).toMatchObject({
      action_code: "CREATE_SALES_INVOICE",
      payload: {
        dispatch_id: "dispatch-1",
        invoice_date: "2026-08-30",
        due_date: "2026-09-29",
      },
    });
  });

  it("builds a customer receipt approval against one open invoice", () => {
    expect(
      buildGovernedPlannerAction({
        context_id: "88888888-8888-4888-8888-888888888888",
        extracted: {
          intent_type: "CUSTOMER_RECEIPT",
          amount: 500000,
          payment_method: "NEFT",
          payment_reference: "UTR-100",
          receipt_date: "2026-08-30",
          notes: "Receipt against invoice",
        },
        resolved: {
          customer_receipt_invoice: {
            id: "invoice-1",
            invoice_number: "INV-1",
            balance_amount: 600000,
          },
        },
      }),
    ).toMatchObject({
      action_code: "POST_CUSTOMER_RECEIPT",
      payload: {
        invoice_id: "invoice-1",
        amount: 500000,
        payment_method: "NEFT",
        payment_reference: "UTR-100",
        receipt_date: "2026-08-30",
      },
    });
  });

  it("builds a dispatch approval only with exact validated UIDs", () => {
    expect(
      buildGovernedPlannerAction({
        context_id: "99999999-9999-4999-8999-999999999999",
        extracted: {
          intent_type: "DISPATCH",
          quantity: 2,
          delivery_date: "2026-08-30",
          delivery_address: "Customer receiving dock",
        },
        resolved: {
          sales_order: { id: "so-1", so_number: "SO-1" },
          sales_order_line: { id: "so-line-1" },
          item: { id: "item-1" },
          dispatch_uids: [{ uid: "UID-1" }, { uid: "UID-2" }],
        },
      }),
    ).toMatchObject({
      action_code: "POST_SALES_DISPATCH",
      payload: {
        sales_order_id: "so-1",
        dispatch_date: "2026-08-30",
        items: [
          {
            sales_order_item_id: "so-line-1",
            item_id: "item-1",
            quantity: 2,
            uid: ["UID-1", "UID-2"],
          },
        ],
      },
    });
  });

  it("builds a manual SIV approval only after stock and custody validation", () => {
    expect(
      buildGovernedPlannerAction({
        context_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        extracted: {
          intent_type: "STOCK_ISSUE",
          quantity: 2,
          reason: "Prototype assembly custody",
          uid_list: ["UID-11", "UID-12"],
        },
        resolved: {
          item: { id: "item-11" },
          employee: { id: "employee-11" },
          stock_issue_readiness: { ready: true },
        },
      }),
    ).toMatchObject({
      action_code: "CREATE_MANUAL_SIV",
      payload: {
        item_id: "item-11",
        issue_quantity: 2,
        issued_to_employee_id: "employee-11",
        notes: "Prototype assembly custody",
        uids: ["UID-11", "UID-12"],
      },
    });
  });

  it("builds an employee-custody SRV approval against the original SIV", () => {
    expect(
      buildGovernedPlannerAction({
        context_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        extracted: {
          intent_type: "STOCK_RETURN",
          reference_query: "ISS-000123",
          quantity: 2,
          return_condition: "GOOD",
          reason: "Unused after prototype assembly",
          uid_list: ["UID-21", "UID-22"],
        },
        resolved: {
          item: { id: "item-21" },
          employee: { id: "employee-21" },
          stock_return_readiness: { ready: true },
        },
      }),
    ).toMatchObject({
      action_code: "CREATE_MANUAL_SRV_RETURN",
      payload: {
        source_voucher_number: "ISS-000123",
        item_id: "item-21",
        return_quantity: 2,
        returned_by_employee_id: "employee-21",
        condition: "GOOD",
        reason: "Unused after prototype assembly",
        uids: ["UID-21", "UID-22"],
      },
    });
  });

  it("normalizes conversational units to ERP master codes", () => {
    expect(normalizePlannerUom("ctns")).toBe("CTN");
    expect(normalizePlannerUom("cartons")).toBe("CTN");
    expect(normalizePlannerUom("meters")).toBe("MTR");
    expect(normalizePlannerUom("drones")).toBe("NOS");
  });

  it("keeps sales quantity UOM separate from the price basis UOM", () => {
    expect(
      deterministicPlannerParse(
        "Create sales order for Coast Guard for 100 cartons duct at 2 per pc by 30-09-2026",
      ),
    ).toMatchObject({
      quantity: 100,
      uom: "CTN",
      unit_price: 2,
      price_uom: "PCS",
    });
  });

  it("extracts a purchase-order instruction without inventing a rate", () => {
    const value = deterministicPlannerParse(
      "create a PO for Asons with 100 ctns 8x80",
    );
    expect(value).toMatchObject({
      intent_type: "PURCHASE_ORDER",
      counterparty_query: "Asons",
      item_query: "8x80",
      quantity: 100,
      uom: "CTN",
      unit_price: null,
    });
  });
  it("turns a plain daily-production request into a dated job order", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      deterministicPlannerParse(
        "Create 500 pcs of Rectangular GI Duct Section today",
      ),
    ).toMatchObject({
      intent_type: "JOB_ORDER",
      item_query: "Rectangular GI Duct Section",
      quantity: 500,
      uom: "PCS",
      delivery_date: today,
    });
  });
  it("separates an each-of production request into independent job order lines", () => {
    const prompt =
      "Plan production today for 100 PCS each of Rectangular GI Duct Section, Rectangular GI Elbow 600 × 300 mm, and Rectangular GI Tee 600 × 300 / 300 × 200 mm.";
    expect(extractProductionLines(prompt)).toEqual([
      {
        item_query: "Rectangular GI Duct Section",
        quantity: 100,
        uom: "PCS",
      },
      {
        item_query: "Rectangular GI Elbow 600 × 300 mm",
        quantity: 100,
        uom: "PCS",
      },
      {
        item_query: "Rectangular GI Tee 600 × 300 / 300 × 200 mm",
        quantity: 100,
        uom: "PCS",
      },
    ]);
    expect(deterministicPlannerParse(prompt)).toMatchObject({
      intent_type: "JOB_ORDER",
      item_query: "",
      quantity: null,
      production_lines: expect.any(Array),
    });
  });
  it("extracts a temporary working-hours adjustment without treating hours as output quantity", () => {
    expect(
      deterministicPlannerParse("Increase working hours to 12 hours"),
    ).toMatchObject({
      quantity: null,
      working_hours: 12,
    });
  });
  it("extracts governed maintenance details without asking for stock quantity", () => {
    expect(
      deterministicPlannerParse(
        "Create urgent breakdown maintenance work order for asset CNC-2 on 31-08-2026 because the spindle is noisy",
      ),
    ).toMatchObject({
      intent_type: "MAINTENANCE_WORK_ORDER",
      asset_query: "CNC-2",
      work_type: "BREAKDOWN",
      priority: "URGENT",
      delivery_date: "2026-08-31",
    });
  });
  it("extracts the item, warehouse and counted quantity for a stock count", () => {
    expect(
      deterministicPlannerParse(
        "Set stock count for RM-BOLT-8X80 in warehouse MAIN to 8 nos because cycle count found two damaged pieces",
      ),
    ).toMatchObject({
      intent_type: "STOCK_ADJUSTMENT",
      item_query: "RM-BOLT-8X80",
      warehouse_query: "MAIN",
      quantity: 8,
      reason: "cycle count found two damaged pieces",
    });
  });
  it("extracts a service PO line, quantity and completion evidence", () => {
    expect(
      deterministicPlannerParse(
        "Record service entry for 6 hours preventive maintenance against PO-2026-001 completed on 30-08-2026 because supervisor signed the completion sheet",
      ),
    ).toMatchObject({
      intent_type: "SERVICE_ENTRY",
      reference_query: "PO-2026-001",
      item_query: "preventive maintenance",
      quantity: 6,
      uom: "HOURS",
      delivery_date: "2026-08-30",
      reason: "supervisor signed the completion sheet",
    });
  });
  it("extracts GRN invoice and physical receipt dates separately", () => {
    expect(
      deterministicPlannerParse(
        "Create GRN for 5 nos BRG-01 against PO-2026-001 invoice number INV-55 invoice dated 29-08-2026 receipt date 30-08-2026 warehouse MAIN",
      ),
    ).toMatchObject({
      intent_type: "GOODS_RECEIPT",
      reference_query: "PO-2026-001",
      item_query: "BRG-01",
      quantity: 5,
      invoice_number: "INV-55",
      invoice_date: "2026-08-29",
      receipt_date: "2026-08-30",
      warehouse_query: "MAIN",
    });
  });
  it("extracts and normalizes sales invoice and payment due dates", () => {
    expect(
      deterministicPlannerParse(
        "Invoice MOD for 100 drones invoice dated 30-08-2026 due date 29-09-2026",
      ),
    ).toMatchObject({
      intent_type: "SALES_INVOICE",
      invoice_date: "2026-08-30",
      due_date: "2026-09-29",
    });
  });
  it("extracts customer receipt amount, method, reference and date", () => {
    expect(
      deterministicPlannerParse(
        "Record 5 lakhs received from MOD against INV-2026-001 by NEFT UTR UTR-100 receipt date 30-08-2026",
      ),
    ).toMatchObject({
      intent_type: "CUSTOMER_RECEIPT",
      counterparty_query: "MOD",
      reference_query: "INV-2026-001",
      amount: 500000,
      payment_method: "NEFT",
      payment_reference: "UTR-100",
      receipt_date: "2026-08-30",
    });
  });
  it("extracts an exact Sales Order line and UID list for dispatch", () => {
    expect(
      deterministicPlannerParse(
        "Dispatch 2 nos DRONE-X against SO-2026-001 UIDs UID-1, UID-2 dispatch date 30-08-2026 delivery address Customer receiving dock",
      ),
    ).toMatchObject({
      intent_type: "DISPATCH",
      reference_query: "SO-2026-001",
      item_query: "DRONE-X",
      quantity: 2,
      uid_list: ["UID-1", "UID-2"],
      delivery_date: "2026-08-30",
      delivery_address: "Customer receiving dock",
    });
  });
  it("extracts a manual stock issue recipient, item, reason and exact UIDs", () => {
    expect(
      deterministicPlannerParse(
        "Issue 2 nos RM-BOLT to employee EMP-007 UIDs UID-11, UID-12 because prototype assembly custody",
      ),
    ).toMatchObject({
      intent_type: "STOCK_ISSUE",
      item_query: "RM-BOLT",
      quantity: 2,
      employee_query: "EMP-007",
      uid_list: ["UID-11", "UID-12"],
      reason: "prototype assembly custody",
    });
  });
  it("extracts an SRV source, employee, item, condition, reason and exact UIDs", () => {
    expect(
      deterministicPlannerParse(
        "Return 2 nos unused RM-BOLT from employee EMP-007 against ISS-000123 UIDs UID-21, UID-22 because unused after prototype assembly",
      ),
    ).toMatchObject({
      intent_type: "STOCK_RETURN",
      reference_query: "ISS-000123",
      item_query: "RM-BOLT",
      quantity: 2,
      employee_query: "EMP-007",
      return_condition: "GOOD",
      uid_list: ["UID-21", "UID-22"],
      reason: "unused after prototype assembly",
    });
  });
  it("understands Indian lakh pricing in a sales-invoice instruction", () => {
    const value = deterministicPlannerParse(
      "create an invoice for MOD for 100 drones for 10lacs each",
    );
    expect(value).toMatchObject({
      intent_type: "SALES_INVOICE",
      counterparty_query: "MOD",
      item_query: "drone",
      quantity: 100,
      uom: "NOS",
      unit_price: 1000000,
    });
  });
  it("extracts quotation customer, commercial values and item", () => {
    const value = deterministicPlannerParse(
      "Quote MOD for 100 drones at 10 lakhs each valid 30-09-2026",
    );
    expect(value).toMatchObject({
      intent_type: "SALES_QUOTATION",
      counterparty_query: "MOD",
      item_query: "drone",
      quantity: 100,
      unit_price: 1000000,
      delivery_date: "2026-09-30",
    });
  });
  it("requires explicit ledger account meaning instead of guessing it", () => {
    const value = deterministicPlannerParse(
      "Journal entry amount 200000 debit Audit Fees credit Accrued Expenses on 29-08-2026",
    );
    expect(value).toMatchObject({
      intent_type: "JOURNAL_ENTRY",
      amount: 200000,
      debit_account_query: "Audit Fees",
      credit_account_query: "Accrued Expenses",
      delivery_date: "2026-08-29",
    });
  });
  it.each(
    ACTIVE_PLANNER_CAPABILITIES.map((capability) => [
      capability.intent,
      capability.examples[0],
    ]),
  )("recognizes the %s workflow example", (intent, example) => {
    expect(detectPlannerIntent(example)).toBe(intent);
  });
  it("keeps every capability tenant-safe and governed", () => {
    expect(ACTIVE_PLANNER_CAPABILITIES.length).toBeGreaterThanOrEqual(25);
    for (const capability of ACTIVE_PLANNER_CAPABILITIES) {
      expect(capability.route).toMatch(/^\/dashboard\//);
      expect(capability.never.length).toBeGreaterThan(0);
    }
  });

  it("uses a closed strict schema for every extraction field", () => {
    expect(ACTIVE_PLANNER_EXTRACTION_SCHEMA.additionalProperties).toBe(false);
    expect(ACTIVE_PLANNER_EXTRACTION_SCHEMA.required).toEqual(
      expect.arrayContaining(
        Object.keys(ACTIVE_PLANNER_EXTRACTION_SCHEMA.properties),
      ),
    );
    expect(
      ACTIVE_PLANNER_EXTRACTION_SCHEMA.properties.intent_type.enum,
    ).toContain("UNKNOWN");
  });

  it("only advertises workflows allowed by the caller role", () => {
    const { service } = makeService();
    const result = service.capabilities({
      permissions: ["purchase_orders:create"],
    });
    expect(result.capabilities.map((item) => item.intent)).toEqual([
      "PURCHASE_ORDER",
      "SERVICE_ENTRY",
    ]);
    expect(result.capabilities.map((item) => item.intent)).not.toContain(
      "SALES_ORDER",
    );
    expect(result.safety.permission_scoped).toBe(true);
  });

  it("rejects a forbidden intent before querying tenant masters", async () => {
    const { service, ai } = makeService();
    const from = jest.fn();
    (service as any).db = { from };

    await expect(
      service.interpret(
        "tenant-1",
        { id: "user-1", permissions: ["purchase_orders:create"] },
        {
          message:
            "Create a sales order for MOD for 10 drones at 100 each by 30-09-2026",
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(ai.structuredJson).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        jsonSchema: ACTIVE_PLANNER_EXTRACTION_SCHEMA,
      }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("returns a read-only analytical answer without querying transactional masters", async () => {
    const answer = {
      kind: "CUSTOMER_SALES",
      status: "READY",
      title: "Sales — Coast Guard",
      headline: "Three posted invoices total INR 1,500.",
      questions: [],
      read_only: true,
    };
    const analytics = {
      recognizes: jest.fn().mockReturnValue(true),
      answer: jest.fn().mockResolvedValue(answer),
    };
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: {
            ...extracted(),
            intent_type: "REPORT",
            analytics_kind: "CUSTOMER_SALES",
            query_scope: "ENTITY",
            query_operation: "SUMMARY",
            counterparty_query: "Coast Guard",
            period: "last 3 months",
          },
          provider: "OPENAI",
        }),
      },
      analytics,
    );
    const from = jest.fn();
    (service as any).db = { from };

    const result = await service.interpret(
      "tenant-1",
      {
        id: "user-1",
        permissions: ["reports:read", "sales:read"],
      },
      { message: "What were sales to Coast Guard over the last 3 months?" },
    );

    expect(result).toMatchObject({
      status: "READY_WITH_ANALYTICS",
      analytics: answer,
      safety: { read_only: true, tenant_scoped: true },
    });
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      expect.stringContaining("Coast Guard"),
      expect.objectContaining({ intent_type: "REPORT" }),
      "CUSTOMER_SALES",
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("uses multilingual AI classification when English keyword rules do not recognize the phrasing", async () => {
    const answer = {
      kind: "INVENTORY_POSITION",
      status: "READY",
      title: "Inventory — Super8 Antenna",
      headline: "15 PCS available across 1 warehouse.",
      questions: [],
      read_only: true,
    };
    const analytics = {
      recognizes: jest.fn().mockReturnValue(false),
      answer: jest.fn().mockResolvedValue(answer),
    };
    const aiValue = deterministicPlannerParse("super8 antenna");
    aiValue.intent_type = "REPORT";
    aiValue.analytics_kind = "INVENTORY_POSITION";
    aiValue.item_query = "super8 antenna";
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: aiValue,
          provider: "OPENAI",
        }),
      },
      analytics,
    );
    const from = jest.fn();
    (service as any).db = { from };

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "items:read"] },
      { message: "super8 antenna ka maal kitna pada hai?" },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "super8 antenna ka maal kitna pada hai?",
      expect.objectContaining({ item_query: "super8 antenna" }),
      "INVENTORY_POSITION",
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("lets a valid semantic model decision override keyword fallback routing", async () => {
    const { service } = makeService({
      structuredJson: jest.fn().mockResolvedValue({
        value: {
          ...deterministicPlannerParse(
            "Create an order for MOD for 100 drones",
          ),
          intent_type: "PURCHASE_ORDER",
          analytics_kind: "",
        },
        provider: "OPENAI",
        fallback_used: false,
      }),
    });
    const emptyQuery: any = {
      select: jest.fn(() => emptyQuery),
      eq: jest.fn(() => emptyQuery),
      in: jest.fn(() => emptyQuery),
      order: jest.fn(() => emptyQuery),
      limit: jest.fn(() => emptyQuery),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    (service as any).db = { from: jest.fn(() => emptyQuery) };
    const result = await service.interpret(
      "tenant-1",
      {
        id: "user-1",
        permissions: ["purchase_orders:read", "purchase_orders:create"],
      },
      { message: "Create an order for MOD for 100 drones" },
    );
    expect(result.intent_type).toBe("PURCHASE_ORDER");
  });

  it("gives the semantic router the full workflow catalogue and cross-module boundaries", async () => {
    const structuredJson = jest.fn().mockResolvedValue({
      value: {
        ...deterministicPlannerParse(
          "Receive 25 chargers against PO-210 invoice G26-0216",
        ),
        intent_type: "GOODS_RECEIPT",
      },
      provider: "OPENAI",
      fallback_used: false,
    });
    const { service } = makeService({ structuredJson });
    const emptyQuery: any = {
      select: jest.fn(() => emptyQuery),
      eq: jest.fn(() => emptyQuery),
      in: jest.fn(() => emptyQuery),
      order: jest.fn(() => emptyQuery),
      limit: jest.fn(() => emptyQuery),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    (service as any).db = { from: jest.fn(() => emptyQuery) };

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["grns:read", "grns:create"] },
      { message: "Receive 25 chargers against PO-210 invoice G26-0216" },
    );

    expect(result.intent_type).toBe("GOODS_RECEIPT");
    expect(structuredJson).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routing_method: expect.stringContaining("business object"),
          cross_module_disambiguation: expect.stringContaining(
            "Never use CRM_ACTION for receiving goods",
          ),
          workflow_catalogue: expect.arrayContaining([
            expect.objectContaining({ intent: "GOODS_RECEIPT" }),
            expect.objectContaining({ intent: "CRM_ACTION" }),
          ]),
        }),
      }),
    );
  });

  it("uses semantic scope and operation for misspelled free-form supplier questions", async () => {
    const answer = {
      kind: "SUPPLIER_PAYMENTS",
      status: "READY",
      title: "Latest supplier payment",
      headline: "Latest recorded supplier payment found.",
      questions: [],
      read_only: true,
    };
    const analytics = {
      recognizes: jest.fn().mockReturnValue(false),
      answer: jest.fn().mockResolvedValue(answer),
    };
    const aiValue = deterministicPlannerParse("latest supplier payment");
    Object.assign(aiValue, {
      intent_type: "REPORT",
      analytics_kind: "SUPPLIER_PAYMENTS",
      query_scope: "PORTFOLIO",
      query_operation: "LATEST",
      counterparty_query: "",
    });
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: aiValue,
          provider: "OPENAI",
          fallback_used: false,
        }),
      },
      analytics,
    );

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "accounting:read"] },
      { message: "wich suplr latst paymnt" },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "wich suplr latst paymnt",
      expect.objectContaining({
        query_scope: "PORTFOLIO",
        query_operation: "LATEST",
      }),
      "SUPPLIER_PAYMENTS",
    );
  });

  it("routes supplier advances to their own read-only analysis", async () => {
    const analytics = {
      recognizes: jest.fn().mockReturnValue(false),
      answer: jest.fn().mockResolvedValue({
        kind: "SUPPLIER_ADVANCES",
        status: "READY",
        title: "Available supplier advances",
        questions: [],
        read_only: true,
      }),
    };
    const aiValue = deterministicPlannerParse("supplier advances");
    Object.assign(aiValue, {
      intent_type: "REPORT",
      analytics_kind: "SUPPLIER_ADVANCES",
      query_scope: "PORTFOLIO",
      query_operation: "SUMMARY",
      counterparty_query: "",
    });
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: aiValue,
          provider: "OPENAI",
          fallback_used: false,
        }),
      },
      analytics,
    );

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "accounting:read"] },
      { message: "supplier advances?" },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "supplier advances?",
      expect.objectContaining({
        query_scope: "PORTFOLIO",
        query_operation: "SUMMARY",
      }),
      "SUPPLIER_ADVANCES",
    );
  });

  it("uses the semantic router for an employee lateness question", async () => {
    const analytics = {
      recognizes: jest.fn().mockReturnValue(false),
      answer: jest.fn().mockResolvedValue({
        kind: "EMPLOYEE_ATTENDANCE",
        status: "READY",
        title: "Employees marked late",
        questions: [],
        read_only: true,
      }),
    };
    const aiValue = deterministicPlannerParse(
      "employee who are late this month",
    );
    Object.assign(aiValue, {
      intent_type: "REPORT",
      analytics_kind: "EMPLOYEE_ATTENDANCE",
      query_scope: "PORTFOLIO",
      query_operation: "STATUS",
      employee_query: "",
    });
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: aiValue,
          provider: "OPENAI",
          fallback_used: false,
        }),
      },
      analytics,
    );

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "hr:read"] },
      { message: "employee who are late this month" },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "employee who are late this month",
      expect.objectContaining({
        query_scope: "PORTFOLIO",
        query_operation: "STATUS",
        employee_query: "",
      }),
      "EMPLOYEE_ATTENDANCE",
    );
  });

  it("prefers the composable semantic query engine over fixed analytics handlers", async () => {
    const fixedAnalytics = {
      recognizes: jest.fn().mockReturnValue(false),
      answer: jest.fn().mockResolvedValue(null),
    };
    const semanticAnswer = {
      kind: "SEMANTIC_QUERY",
      status: "READY",
      title: "Purchase orders matching Asons",
      headline: "The latest matching purchase order record is PO-001.",
      questions: [],
      read_only: true,
    };
    const semantic = { answer: jest.fn().mockResolvedValue(semanticAnswer) };
    const aiValue = deterministicPlannerParse(
      "latest purchase order from Asons",
    );
    Object.assign(aiValue, {
      intent_type: "REPORT",
      analytics_kind: "",
      query_scope: "ENTITY",
      query_operation: "LATEST",
      counterparty_query: "Asons",
    });
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: aiValue,
          provider: "OPENAI",
          fallback_used: false,
        }),
      },
      fixedAnalytics,
      semantic,
    );

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "purchase_orders:read"] },
      { message: "latest purchase order from Asons" },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(result.analytics).toEqual(semanticAnswer);
    expect(semantic.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "latest purchase order from Asons",
      expect.objectContaining({ transcript: expect.any(Array) }),
    );
    expect(fixedAnalytics.answer).not.toHaveBeenCalled();
  });

  it("keeps an analytical follow-up in context while prioritizing the new request", async () => {
    const answer = {
      kind: "CUSTOMER_SALES",
      status: "READY",
      title: "Sales — Coast Guard",
      questions: [],
      read_only: true,
    };
    const analytics = {
      recognizes: jest.fn((prompt: string) => /sales/i.test(prompt)),
      answer: jest.fn().mockResolvedValue(answer),
    };
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: {
            ...extracted(),
            intent_type: "REPORT",
            counterparty_query: "Coast Guard",
          },
          provider: "OPENAI",
        }),
      },
      analytics,
    );
    const contextToken = (service as any).sign({
      tenant_id: "tenant-1",
      user_id: "user-1",
      context_id: "analytics-context-1",
      expires_at: Date.now() + 60_000,
      transcript: [
        {
          role: "user",
          content: "What were sales to Coast Guard over the last 3 months?",
        },
      ],
      extracted: { intent_type: "REPORT", counterparty_query: "Coast Guard" },
      resolved: { analytics: answer },
    });
    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "sales:read"] },
      { message: "Now show last quarter", context_token: contextToken },
    );
    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      expect.stringMatching(/^Now show last quarter/),
      expect.anything(),
    );
  });

  it("restores conversational context from server memory after the execution token expires", async () => {
    const answer = {
      kind: "CUSTOMER_SALES",
      status: "READY",
      title: "Sales — Coast Guard",
      questions: [],
      read_only: true,
    };
    const analytics = {
      recognizes: jest.fn().mockReturnValue(true),
      answer: jest.fn().mockResolvedValue(answer),
    };
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: {
            ...extracted(),
            context_relation: "CONTINUE",
            intent_type: "REPORT",
            analytics_kind: "CUSTOMER_SALES",
            counterparty_query: "",
            period: "last quarter",
          },
          provider: "OPENAI",
          fallback_used: false,
        }),
      },
      analytics,
    );

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "sales:read"] },
      {
        message: "What about last quarter?",
        _memory_context: {
          transcript: [
            { role: "user", content: "Show sales to Coast Guard" },
            { role: "assistant", content: "Sales total prepared." },
          ],
          extracted: {
            ...deterministicPlannerParse("Show sales to Coast Guard"),
            intent_type: "REPORT",
            analytics_kind: "CUSTOMER_SALES",
            counterparty_query: "Coast Guard",
          },
          resolved: { analytics: answer },
        },
      },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      expect.stringContaining("Show sales to Coast Guard"),
      expect.objectContaining({ counterparty_query: "Coast Guard" }),
      "CUSTOMER_SALES",
    );
  });

  it("resolves a clarification from the assistant transcript without leaking fields from an older workflow", async () => {
    const pipelineAnswer = {
      kind: "CRM_PIPELINE",
      status: "READY",
      title: "CRM pipeline",
      headline: "Latest CRM leads prepared.",
      questions: [],
      read_only: true,
    };
    let routerRequest: any;
    const semantic = {
      answer: jest.fn().mockResolvedValue(pipelineAnswer),
    };
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockImplementation(async (request: any) => {
          routerRequest = request;
          return {
            value: {
              ...deterministicPlannerParse("CRM leads"),
              context_relation: "CONTINUE",
              intent_type: "REPORT",
              analytics_kind: "CRM_PIPELINE",
              query_scope: "PORTFOLIO",
              query_operation: "LATEST",
              quantity: null,
              uom: "",
              delivery_date: "",
            },
            provider: "OPENAI",
            fallback_used: false,
          };
        }),
      },
      {},
      semantic,
    );
    const contextToken = (service as any).sign({
      tenant_id: "tenant-1",
      user_id: "user-1",
      context_id: "crm-clarification-context",
      expires_at: Date.now() + 60_000,
      transcript: [{ role: "user", content: "latest enquiries" }],
      extracted: {
        ...deterministicPlannerParse(
          "Prepare a production plan for 100 drones by 30-09-2026",
        ),
        intent_type: "REPORT",
        analytics_kind: "",
        query_operation: "LATEST",
      },
      resolved: {
        analytics: { kind: "SEMANTIC_QUERY", status: "NEEDS_INFORMATION" },
      },
    });

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "sales:read"] },
      {
        message: "CRM leads",
        context_token: contextToken,
        _memory_context: {
          transcript: [
            { role: "user", content: "latest enquiries" },
            {
              role: "assistant",
              content:
                "Which business subject do you want the latest enquiries for?",
            },
          ],
        },
      },
    );

    expect(routerRequest.data.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: expect.stringContaining("Which business subject"),
        }),
      ]),
    );
    expect(result).toMatchObject({
      status: "READY_WITH_ANALYTICS",
      intent_type: "REPORT",
      extracted: {
        analytics_kind: "CRM_PIPELINE",
        query_operation: "LATEST",
        quantity: null,
        uom: "",
        delivery_date: "",
      },
    });
    expect(semantic.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "CRM leads",
      expect.objectContaining({
        preserve_query_operation: true,
        transcript: expect.arrayContaining([
          expect.objectContaining({ role: "assistant" }),
        ]),
      }),
    );
  });

  it("uses semantic topic separation even when a phrase looks like a follow-up", async () => {
    const supplierAnswer = {
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: "Supplier dues",
      questions: [],
      read_only: true,
    };
    const analytics = {
      recognizes: jest.fn().mockReturnValue(true),
      answer: jest.fn().mockResolvedValue(supplierAnswer),
    };
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: {
            ...deterministicPlannerParse("supplier dues"),
            context_relation: "NEW_TOPIC",
            intent_type: "REPORT",
            analytics_kind: "SUPPLIER_DUES",
            query_scope: "PORTFOLIO",
            query_operation: "SUMMARY",
            item_query: "",
            counterparty_query: "",
          },
          provider: "OPENAI",
          fallback_used: false,
        }),
      },
      analytics,
    );

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "accounting:read"] },
      {
        message: "and now tell me supplier dues",
        _memory_context: {
          transcript: [{ role: "user", content: "stock of Super8 Antenna" }],
          extracted: {
            ...deterministicPlannerParse("stock of Super8 Antenna"),
            intent_type: "REPORT",
            analytics_kind: "INVENTORY_POSITION",
            item_query: "Super8 Antenna",
          },
          resolved: {
            analytics: { kind: "INVENTORY_POSITION", status: "READY" },
          },
        },
      },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "and now tell me supplier dues",
      expect.objectContaining({
        analytics_kind: "SUPPLIER_DUES",
        item_query: "",
      }),
      "SUPPLIER_DUES",
    );
  });

  it("drops inventory context when the user switches to supplier payables", async () => {
    const inventoryAnswer = {
      kind: "INVENTORY_POSITION",
      status: "READY",
      title: "Inventory — Super8 Antenna",
      questions: [],
      read_only: true,
    };
    const supplierAnswer = {
      kind: "SUPPLIER_DUES",
      status: "READY",
      title: "Overdue supplier payments",
      questions: [],
      read_only: true,
    };
    const analytics = {
      recognizes: jest.fn().mockReturnValue(true),
      answer: jest.fn().mockResolvedValue(supplierAnswer),
    };
    const { service } = makeService(
      {
        structuredJson: jest.fn().mockResolvedValue({
          value: {
            ...deterministicPlannerParse("overdue payment for any supplier"),
            intent_type: "REPORT",
            analytics_kind: "SUPPLIER_DUES",
            query_scope: "PORTFOLIO",
            query_operation: "OVERDUE",
            counterparty_query: "",
            item_query: "",
          },
          provider: "OPENAI",
        }),
      },
      analytics,
    );
    const contextToken = (service as any).sign({
      tenant_id: "tenant-1",
      user_id: "user-1",
      context_id: "inventory-context-1",
      expires_at: Date.now() + 60_000,
      transcript: [
        { role: "user", content: "what is the stock for super8 antenna" },
      ],
      extracted: {
        ...deterministicPlannerParse("what is the stock for super8 antenna"),
        intent_type: "REPORT",
        analytics_kind: "INVENTORY_POSITION",
        item_query: "super8 antenna",
      },
      resolved: { analytics: inventoryAnswer },
    });

    const result = await service.interpret(
      "tenant-1",
      { id: "user-1", permissions: ["reports:read", "accounting:read"] },
      {
        message: "overdue payment for any supplier",
        context_token: contextToken,
      },
    );

    expect(result.status).toBe("READY_WITH_ANALYTICS");
    expect(analytics.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "overdue payment for any supplier",
      expect.objectContaining({
        analytics_kind: "SUPPLIER_DUES",
        item_query: "",
      }),
      "SUPPLIER_DUES",
    );
  });

  it("blocks reuse of an already consumed planner confirmation", async () => {
    const { service } = makeService();
    const contextToken = (service as any).sign({
      tenant_id: "tenant-1",
      user_id: "user-1",
      context_id: "context-1",
      expires_at: Date.now() + 60_000,
      transcript: [{ role: "user", content: "Create PO" }],
      extracted: {
        ...deterministicPlannerParse(
          "Create a PO for Asons with 10 cartons of bolts at 100 each by 30-09-2026",
        ),
        intent_type: "PURCHASE_ORDER",
      },
      resolved: {},
    });
    const single = jest.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    (service as any).db = { from: jest.fn().mockReturnValue({ insert }) };

    await expect(
      service.execute(
        "tenant-1",
        { id: "user-1", permissions: ["purchase_orders:create"] },
        { context_token: contextToken, confirm: "CREATE DRAFT" },
        {},
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BadRequestException>>({
        message: expect.stringContaining("already been used"),
      }),
    );
  });
});
