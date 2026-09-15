import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { allocateSalesAtpLines, SalesService } from "./sales.service";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || "test-key";

const mockReq = (userId = "checker-1") =>
  ({
    user: {
      tenantId: "tenant-1",
      userId,
    },
  }) as any;

describe("sales ATP allocation", () => {
  it("allocates shared item stock once across multiple order lines and warehouses", () => {
    const result = allocateSalesAtpLines(
      [
        {
          id: "line-1",
          item_id: "item-1",
          quantity: 8,
          dispatched_quantity: 0,
        },
        {
          id: "line-2",
          item_id: "item-1",
          quantity: 7,
          dispatched_quantity: 0,
        },
      ],
      [
        {
          id: "stock-a",
          item_id: "item-1",
          warehouse_id: "wh-a",
          available_quantity: 5,
        },
        {
          id: "stock-b",
          item_id: "item-1",
          warehouse_id: "wh-b",
          available_quantity: 6,
        },
      ],
    );
    expect(result[0]).toMatchObject({
      confirmed_quantity: 8,
      shortage_quantity: 0,
      status: "FULLY_CONFIRMED",
    });
    expect(result[0].allocations.map((row: any) => row.quantity)).toEqual([
      5, 3,
    ]);
    expect(result[1]).toMatchObject({
      available_quantity: 3,
      confirmed_quantity: 3,
      shortage_quantity: 4,
      status: "PARTIALLY_CONFIRMED",
    });
    expect(
      result
        .flatMap((line: any) => line.allocations)
        .reduce((sum: number, row: any) => sum + row.quantity, 0),
    ).toBe(11);
  });

  it("allocates only the undispatched balance", () => {
    const [line] = allocateSalesAtpLines(
      [
        {
          id: "line-1",
          item_id: "item-1",
          quantity: 10,
          dispatched_quantity: 6,
        },
      ],
      [
        {
          id: "stock-a",
          item_id: "item-1",
          warehouse_id: "wh-a",
          available_quantity: 20,
        },
      ],
    );
    expect(line).toMatchObject({
      open_quantity: 4,
      confirmed_quantity: 4,
      shortage_quantity: 0,
    });
  });
});

describe("SalesService quotation approval controls", () => {
  it("converts carton sales quantity to base stock quantity", async () => {
    const service = new SalesService({} as any, {} as any);
    const itemQuery: any = {
      select: jest.fn(() => itemQuery),
      eq: jest.fn(() => itemQuery),
      in: jest.fn().mockResolvedValue({
        data: [
          {
            id: "item-1",
            code: "FG-1",
            uom: "PCS",
            sales_uom: "CTN",
            sales_uom_factor: 1000,
            sales_whole_uom_only: true,
          },
        ],
        error: null,
      }),
    };
    (service as any).supabase = { from: jest.fn(() => itemQuery) };

    const [line] = await (service as any).resolveCommercialSalesQuantities(
      "tenant-1",
      [{
        item_id: "item-1",
        quantity: 100,
        ordered_uom: "CARTONS",
        price_uom: "PCS",
        unit_price: 2,
      }],
    );

    expect(line).toMatchObject({
      quantity: 100000,
      sales_quantity: 100,
      ordered_uom: "CTN",
      base_uom: "PCS",
      uom_conversion_factor: 1000,
      price_uom: "PCS",
      price_uom_factor: 1,
      pricing_quantity: 100000,
    });
    const perPiece = (service as any).prepareSalesOrderItems([line], 0);
    const perCarton = (service as any).prepareSalesOrderItems(
      [{
        ...line,
        price_uom: "CTN",
        price_uom_factor: 1000,
        pricing_quantity: 100,
        unit_price: 2000,
      }],
      0,
    );
    expect(perPiece.totalAmount).toBe(200000);
    expect(perCarton.totalAmount).toBe(200000);
  });

  it("prevents the creator from approving their own quotation", async () => {
    const service = new SalesService({} as any, {} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "quote-1",
          quotation_number: "QT-1",
          status: "DRAFT",
          created_by: "maker-1",
          net_amount: 1000,
        },
        error: null,
      }),
    };

    (service as any).supabase = {
      from: jest.fn(() => fetchQuery),
    };

    await expect(
      service.approveQuotation(mockReq("maker-1"), "quote-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("approves only draft quotations and records approver metadata", async () => {
    const service = new SalesService({} as any, {} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "quote-1",
          quotation_number: "QT-1",
          status: "DRAFT",
          created_by: "maker-1",
          net_amount: 1000,
        },
        error: null,
      }),
    };
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
    };

    (service as any).supabase = {
      from: jest
        .fn()
        .mockReturnValueOnce(fetchQuery)
        .mockReturnValueOnce(updateQuery),
    };

    await expect(
      service.approveQuotation(mockReq("checker-1"), "quote-1"),
    ).resolves.toEqual({
      message: "Quotation approved successfully",
    });

    expect(updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "APPROVED",
        approved_by: "checker-1",
      }),
    );
    expect(updateQuery.eq).toHaveBeenCalledWith("status", "DRAFT");
  });

  it("blocks approval once a quotation has left draft status", async () => {
    const service = new SalesService({} as any, {} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "quote-1",
          quotation_number: "QT-1",
          status: "APPROVED",
          created_by: "maker-1",
          net_amount: 1000,
        },
        error: null,
      }),
    };

    (service as any).supabase = {
      from: jest.fn(() => fetchQuery),
    };

    await expect(
      service.approveQuotation(mockReq("checker-1"), "quote-1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires a meaningful reason before rejecting a quotation", async () => {
    const service = new SalesService({} as any, {} as any);
    await expect(
      service.rejectQuotation(mockReq("checker-1"), "quote-1", "no"),
    ).rejects.toThrow(
      "A rejection reason of at least 5 characters is required",
    );
  });

  it("rejects a draft quotation and preserves the decision reason", async () => {
    const service = new SalesService({} as any, {} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "quote-1",
          quotation_number: "QT-1",
          status: "DRAFT",
          created_by: "maker-1",
        },
        error: null,
      }),
    };
    const updateQuery: any = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
    };
    (service as any).supabase = {
      from: jest
        .fn()
        .mockReturnValueOnce(fetchQuery)
        .mockReturnValueOnce(updateQuery),
    };

    await expect(
      service.rejectQuotation(
        mockReq("checker-1"),
        "quote-1",
        "Commercial terms need revision",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        quotation_number: "QT-1",
        status: "REJECTED",
        rejected_reason: "Commercial terms need revision",
      }),
    );
    expect(updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "REJECTED",
        rejected_reason: "Commercial terms need revision",
        rejected_by: "checker-1",
        rejected_at: expect.any(String),
      }),
    );
    expect(updateQuery.eq).toHaveBeenCalledWith("status", "DRAFT");
  });
});

describe("SalesService commercial amount controls", () => {
  it("allows a quotation validity date after the quotation date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    expect(
      (service as any).validateQuotationDates("2026-08-16", "2026-09-16"),
    ).toEqual({
      quotationDate: "2026-08-16",
      validUntil: "2026-09-16",
    });
  });

  it("rejects a quotation validity date before the quotation date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    expect(() =>
      (service as any).validateQuotationDates("2026-08-16", "2026-08-15"),
    ).toThrow("Valid Until must be on or after the quotation date");
  });

  it("detects an expired quotation using an explicit business date", () => {
    const service = new SalesService({} as any, {} as any);
    expect(
      (service as any).isQuotationExpired("2026-08-16", "2026-08-17"),
    ).toBe(true);
    expect(
      (service as any).isQuotationExpired("2026-08-17", "2026-08-17"),
    ).toBe(false);
    expect(
      (service as any).isQuotationExpired("2026-08-18", "2026-08-17"),
    ).toBe(false);
  });

  it("rejects quotation line discounts that exceed the line value", () => {
    const service = new SalesService({} as any, {} as any);

    expect(() =>
      (service as any).prepareQuotationItems([
        {
          item_id: "item-1",
          quantity: 10,
          unit_price: 100,
          discount_amount: 1001,
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it("rejects sales order items without a positive quantity", () => {
    const service = new SalesService({} as any, {} as any);

    expect(() =>
      (service as any).prepareSalesOrderItems([
        {
          item_id: "item-1",
          quantity: 0,
          unit_price: 100,
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it("blocks direct sales order advances above the net order amount", async () => {
    const service = new SalesService({} as any, {} as any);
    jest
      .spyOn(service as any, "generateSONumber")
      .mockResolvedValue("SO-TEST-1");

    await expect(
      service.createDirectSalesOrder(mockReq("maker-1"), {
        customer_id: "cust-1",
        advance_amount: 200,
        items: [
          {
            item_id: "item-1",
            quantity: 1,
            unit_price: 100,
            tax_percentage: 0,
          },
        ],
      }),
    ).rejects.toThrow("Advance amount cannot exceed sales order net amount");
  });

  it("blocks quotation conversion advances above the converted order amount", async () => {
    const service = new SalesService({} as any, {} as any);
    jest
      .spyOn(service as any, "generateSONumber")
      .mockResolvedValue("SO-TEST-2");

    const quotationQuery: any = {
      select: jest.fn(() => quotationQuery),
      eq: jest.fn(() => quotationQuery),
      single: jest.fn().mockResolvedValue({
        data: {
          id: "quote-1",
          status: "APPROVED",
          customer_id: "cust-1",
          payment_terms: "30 days",
          delivery_terms: "Ex works",
          quotation_items: [
            {
              id: "quote-line-1",
              item_id: "item-1",
              item_description: "Panel",
              quantity: 1,
              converted_quantity: 0,
              unit_price: 100,
              discount_amount: 0,
              tax_percentage: 0,
              tax_amount: 0,
              line_total: 100,
            },
          ],
        },
        error: null,
      }),
    };

    (service as any).supabase = {
      from: jest.fn(() => quotationQuery),
    };

    await expect(
      service.convertQuotationToSO(mockReq("maker-1"), "quote-1", {
        advance_amount: 101,
      }),
    ).rejects.toThrow("Advance amount cannot exceed sales order value");
  });
});

describe("SalesService sales-order release controls", () => {
  it("prevents the creator from releasing their own sales order", async () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest.spyOn(service, "getSalesOrderById").mockResolvedValue({
      id: "so-1",
      so_number: "SO-TEST-1",
      status: "CONFIRMED",
      release_status: "PENDING",
      created_by: "maker-1",
    } as any);

    await expect(
      service.releaseSalesOrder(mockReq("maker-1"), "so-1"),
    ).rejects.toThrow("Creator cannot release their own sales order");
  });

  it("locks a sales order against editing after commercial release", async () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    const fetchQuery: any = {
      select: jest.fn(() => fetchQuery),
      eq: jest.fn(() => fetchQuery),
      single: jest.fn().mockResolvedValue({
        data: {
          id: "so-1",
          release_status: "RELEASED",
          sales_order_items: [],
        },
        error: null,
      }),
    };
    (service as any).supabase = { from: jest.fn(() => fetchQuery) };

    await expect(
      service.updateSalesOrder(mockReq("checker-1"), "so-1", {
        notes: "Changed",
      }),
    ).rejects.toThrow("Sales order cannot be edited after commercial release");
  });
});

describe("SalesService dispatch controls", () => {
  const orderLines = [
    {
      id: "line-1",
      item_id: "item-1",
      item_description: "Finished Assembly",
      quantity: 10,
      dispatched_quantity: 4,
    },
  ];

  it("accepts a dispatch up to the remaining sales-order quantity", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    expect(() =>
      (service as any).validateDispatchAgainstSalesOrder(
        [{ sales_order_item_id: "line-1", item_id: "item-1", quantity: 6 }],
        orderLines,
      ),
    ).not.toThrow();
  });

  it("rejects cumulative over-dispatch across duplicate request lines", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    expect(() =>
      (service as any).validateDispatchAgainstSalesOrder(
        [
          { sales_order_item_id: "line-1", item_id: "item-1", quantity: 4 },
          { sales_order_item_id: "line-1", item_id: "item-1", quantity: 3 },
        ],
        orderLines,
      ),
    ).toThrow("exceeds the remaining quantity 6");
  });

  it("rejects an item or line that does not belong to the sales order", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    expect(() =>
      (service as any).validateDispatchAgainstSalesOrder(
        [{ sales_order_item_id: "line-2", item_id: "item-1", quantity: 1 }],
        orderLines,
      ),
    ).toThrow("does not belong to this sales order");
    expect(() =>
      (service as any).validateDispatchAgainstSalesOrder(
        [{ sales_order_item_id: "line-1", item_id: "item-2", quantity: 1 }],
        orderLines,
      ),
    ).toThrow("does not match sales-order line");
  });
});

describe("SalesService dispatch billing controls", () => {
  it("accepts an invoice date on or after dispatch with a later due date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");

    expect(
      (service as any).validateInvoiceDates(
        "2026-08-16",
        "2026-09-15",
        "2026-08-16",
      ),
    ).toEqual({ invoiceDate: "2026-08-16", dueDate: "2026-09-15" });
  });

  it("rejects an invoice dated before its dispatch", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");

    expect(() =>
      (service as any).validateInvoiceDates("2026-08-15", null, "2026-08-16"),
    ).toThrow("Invoice date cannot be before the dispatch date");
  });

  it("rejects future invoice dates and due dates before invoice date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");

    expect(() =>
      (service as any).validateInvoiceDates("2026-08-18", null, "2026-08-16"),
    ).toThrow("Invoice date cannot be in the future");
    expect(() =>
      (service as any).validateInvoiceDates(
        "2026-08-17",
        "2026-08-16",
        "2026-08-16",
      ),
    ).toThrow("Due date must be on or after the invoice date");
  });
});

describe("SalesService customer receipt controls", () => {
  it("accepts a receipt dated between the invoice date and business date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");
    expect(
      (service as any).validateReceiptDate("2026-08-17", "2026-08-16"),
    ).toBe("2026-08-17");
  });

  it("rejects a future receipt date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");
    expect(() =>
      (service as any).validateReceiptDate("2026-08-18", "2026-08-16"),
    ).toThrow("Receipt date cannot be in the future");
  });

  it("rejects a receipt dated before its invoice", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");
    expect(() =>
      (service as any).validateReceiptDate("2026-08-15", "2026-08-16"),
    ).toThrow("Receipt date cannot be before the invoice date");
  });
});

describe("SalesService return controls", () => {
  const invoiceItems = [
    {
      id: "invoice-line-1",
      item_id: "item-1",
      item_description: "Pump",
      quantity: 10,
    },
  ];

  it("limits a new return by quantities already returned on earlier documents", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    const priorReturns = [
      {
        status: "QC_COMPLETED",
        items: [{ invoice_item_id: "invoice-line-1", quantity: 6 }],
      },
    ];
    expect(() =>
      (service as any).prepareSalesReturnItems(
        [{ invoice_item_id: "invoice-line-1", quantity: 5 }],
        invoiceItems,
        priorReturns,
      ),
    ).toThrow("exceeds the remaining returnable quantity 4");
    expect(
      (service as any).prepareSalesReturnItems(
        [{ invoice_item_id: "invoice-line-1", quantity: 4 }],
        invoiceItems,
        priorReturns,
      ),
    ).toEqual([expect.objectContaining({ quantity: 4 })]);
  });

  it("does not count cancelled returns against the returnable quantity", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    const cancelled = [
      {
        status: "CANCELLED",
        items: [{ invoice_item_id: "invoice-line-1", quantity: 10 }],
      },
    ];
    expect(
      (service as any).prepareSalesReturnItems(
        [{ invoice_item_id: "invoice-line-1", quantity: 10 }],
        invoiceItems,
        cancelled,
      ),
    ).toHaveLength(1);
  });

  it("rejects future returns and returns dated before the invoice", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");
    expect(() =>
      (service as any).validateSalesReturnDate("2026-08-18", "2026-08-16"),
    ).toThrow("Return date cannot be in the future");
    expect(() =>
      (service as any).validateSalesReturnDate("2026-08-15", "2026-08-16"),
    ).toThrow("Return date cannot be before the invoice date");
  });
});

describe("SalesService credit-note controls", () => {
  it("accepts a credit-note date on or after the invoice date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");
    expect(
      (service as any).validateCreditNoteDate("2026-08-17", "2026-08-16"),
    ).toBe("2026-08-17");
  });

  it("rejects a future credit-note date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");
    expect(() =>
      (service as any).validateCreditNoteDate("2026-08-18", "2026-08-16"),
    ).toThrow("Credit-note date cannot be in the future");
  });

  it("rejects a credit-note date before the invoice date", () => {
    const service = new SalesService({} as any, {} as any, {} as any);
    jest
      .spyOn(service as any, "getCurrentBusinessDate")
      .mockReturnValue("2026-08-17");
    expect(() =>
      (service as any).validateCreditNoteDate("2026-08-15", "2026-08-16"),
    ).toThrow("Credit-note date cannot be before the invoice date");
  });
});
