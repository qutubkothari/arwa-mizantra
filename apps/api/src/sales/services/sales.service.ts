import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { hasSuperAdminBypass } from "../../auth/utils/permission-utils";
import { Request } from "express";
import { EmailService } from "../../email/email.service";
import { UidSupabaseService } from "../../uid/services/uid-supabase.service";
import { normalizeInventoryStockCategory } from "../../inventory/utils/inventory-category";
import {
  normalizeEmail,
  normalizeRegionalPhone,
  normalizePersonName,
  toTitleCase,
  toUpperCode,
} from "../../common/utils/data-quality";
import { InventoryService } from "../../inventory/services/inventory.service";
import { QuotePdfService } from "../../documents/services/quote-pdf.service";
import {
  regionalDefaults,
  type RegionalDefaults,
} from "../../common/utils/market-profile";
import { AccountingService } from "../../accounting/accounting.service";

export function allocateSalesAtpLines(orderLines: any[], stockRows: any[]) {
  const remaining = new Map(
    (stockRows || []).map((row: any) => [
      String(row.id),
      Math.max(0, Number(row.available_quantity ?? row.quantity ?? 0)),
    ]),
  );
  return (orderLines || []).map((line: any) => {
    const required = Math.max(
      0,
      Number(line.quantity || 0) - Number(line.dispatched_quantity || 0),
    );
    const itemStocks = (stockRows || []).filter(
      (row: any) => String(row.item_id) === String(line.item_id),
    );
    const availableAtStart = itemStocks.reduce(
      (sum: number, stock: any) => sum + (remaining.get(String(stock.id)) || 0),
      0,
    );
    let needed = required;
    const allocations: any[] = [];
    for (const stock of itemStocks) {
      if (needed <= 0) break;
      const available = remaining.get(String(stock.id)) || 0;
      const quantity = Math.min(needed, available);
      if (quantity <= 0) continue;
      allocations.push({
        inventory_stock_id: stock.id,
        warehouse_id: stock.warehouse_id,
        item_id: line.item_id,
        reference_line_id: line.id,
        quantity: Number(quantity.toFixed(4)),
      });
      remaining.set(String(stock.id), available - quantity);
      needed -= quantity;
    }
    const confirmed = Number((required - needed).toFixed(4));
    return {
      sales_order_item_id: line.id,
      item_id: line.item_id,
      item_description: line.item_description,
      ordered_quantity: Number(line.quantity || 0),
      open_quantity: required,
      available_quantity: Number(availableAtStart.toFixed(4)),
      confirmed_quantity: confirmed,
      shortage_quantity: Number(Math.max(0, required - confirmed).toFixed(4)),
      status:
        confirmed >= required
          ? "FULLY_CONFIRMED"
          : confirmed > 0
            ? "PARTIALLY_CONFIRMED"
            : "NOT_AVAILABLE",
      allocations,
    };
  });
}

@Injectable()
export class SalesService {
  private supabase: SupabaseClient;

  constructor(
    private emailService: EmailService,
    private uidSupabaseService: UidSupabaseService,
    private inventoryService: InventoryService,
    private readonly quotePdfService?: QuotePdfService,
    private readonly accountingService?: AccountingService,
  ) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  // ==================== CUSTOMERS ====================

  async getCustomers(req: Request, filters?: any) {
    const { tenantId } = req.user as any;

    let query = this.supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId);

    if (filters?.customer_type) {
      query = query.eq("customer_type", filters.customer_type);
    }

    if (filters?.is_active !== undefined) {
      query = query.eq("is_active", filters.is_active);
    }

    const { data, error } = await query.order("customer_name");

    if (error) {
      console.error("[SalesService] getCustomers error:", error);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async createCustomer(req: Request, customerData: any) {
    const { tenantId, userId } = req.user as any;
    const regional = await this.getTenantRegionalDefaults(tenantId);

    const customerCode = await this.generateCustomerCode();

    const contacts = this.normalizeCustomerContacts(
      customerData,
      regional.marketProfile,
    );
    const billingAddresses = this.normalizeCustomerAddresses(
      customerData.billing_addresses,
      customerData.billing_address,
    );
    const shippingAddresses = this.normalizeCustomerAddresses(
      customerData.shipping_addresses,
      customerData.shipping_address,
    );
    const primaryContact = contacts[0];

    const customer = {
      tenant_id: tenantId,
      customer_code: customerCode,
      customer_name: toTitleCase(customerData.customer_name),
      customer_type: customerData.customer_type || "REGULAR",
      contact_person: primaryContact?.name || null,
      email: primaryContact?.email || null,
      phone: customerData.phone
        ? normalizeRegionalPhone(customerData.phone, regional.marketProfile)
        : null,
      mobile: primaryContact?.mobile || null,
      gst_number: toUpperCode(customerData.gst_number) || null,
      pan_number: toUpperCode(customerData.pan_number) || null,
      billing_address: billingAddresses[0] || null,
      shipping_address: shippingAddresses[0] || null,
      contacts,
      billing_addresses: billingAddresses,
      shipping_addresses: shippingAddresses,
      city: toTitleCase(customerData.city),
      state: toTitleCase(customerData.state),
      country: toTitleCase(
        customerData.country ||
          (regional.marketProfile === "UAE" ? "United Arab Emirates" : "India"),
      ),
      pincode: customerData.pincode,
      credit_limit: customerData.credit_limit || 0,
      credit_days: customerData.credit_days || 30,
      sales_blocked: Boolean(customerData.sales_blocked),
      delivery_blocked: Boolean(customerData.delivery_blocked),
      billing_blocked: Boolean(customerData.billing_blocked),
      block_reason: String(customerData.block_reason || "").trim() || null,
      tax_treatment: String(customerData.tax_treatment || "REGISTERED")
        .trim()
        .toUpperCase(),
      is_active: true,
    };

    const { data, error } = await this.supabase
      .from("customers")
      .insert(customer)
      .select()
      .single();

    if (error) {
      console.error("Customer creation error:", error);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async updateCustomer(req: Request, customerId: string, customerData: any) {
    const { tenantId } = req.user as any;
    const regional = await this.getTenantRegionalDefaults(tenantId);

    const { data: existing, error: fetchError } = await this.supabase
      .from("customers")
      .select("id, status, customer_type")
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing)
      throw new NotFoundException("Customer not found");

    const contacts = this.normalizeCustomerContacts(
      customerData,
      regional.marketProfile,
    );
    const billingAddresses = this.normalizeCustomerAddresses(
      customerData.billing_addresses,
      customerData.billing_address,
    );
    const shippingAddresses = this.normalizeCustomerAddresses(
      customerData.shipping_addresses,
      customerData.shipping_address,
    );
    const primaryContact = contacts[0];

    const updatePayload: any = {
      customer_name: toTitleCase(customerData.customer_name),
      customer_type:
        customerData.customer_type || existing.customer_type || "REGULAR",
      contact_person: primaryContact?.name || null,
      email: primaryContact?.email || null,
      phone: customerData.phone
        ? normalizeRegionalPhone(customerData.phone, regional.marketProfile)
        : null,
      mobile: primaryContact?.mobile || null,
      gst_number: toUpperCode(customerData.gst_number) || null,
      pan_number: toUpperCode(customerData.pan_number) || null,
      billing_address: billingAddresses[0] || null,
      shipping_address: shippingAddresses[0] || null,
      contacts,
      billing_addresses: billingAddresses,
      shipping_addresses: shippingAddresses,
      city: toTitleCase(customerData.city),
      state: toTitleCase(customerData.state),
      country: toTitleCase(customerData.country),
      pincode: customerData.pincode,
      credit_limit: customerData.credit_limit,
      credit_days: customerData.credit_days,
      sales_blocked: Boolean(customerData.sales_blocked),
      delivery_blocked: Boolean(customerData.delivery_blocked),
      billing_blocked: Boolean(customerData.billing_blocked),
      block_reason: String(customerData.block_reason || "").trim() || null,
      tax_treatment: String(customerData.tax_treatment || "REGISTERED")
        .trim()
        .toUpperCase(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from("customers")
      .update(updatePayload)
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteCustomer(req: Request, customerId: string) {
    const { tenantId } = req.user as any;

    // Soft delete to avoid breaking references
    const { data, error } = await this.supabase
      .from("customers")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .select("id")
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Customer not found");
    return { message: "Customer deactivated successfully" };
  }

  private async generateCustomerCode(): Promise<string> {
    // customer_code currently has a database-wide unique constraint. Counting
    // only the current tenant can therefore reuse another tenant's code, and
    // count + 1 can reuse a code after deletion. Derive the next sequence from
    // the highest existing numeric suffix instead.
    const { data, error } = await this.supabase
      .from("customers")
      .select("customer_code")
      .like("customer_code", "CUST-%")
      .order("customer_code", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Error generating customer code:", error);
      throw new BadRequestException("Unable to generate a customer number");
    }

    const highestCode = data?.[0]?.customer_code || "";
    const highestSequence = Number.parseInt(
      String(highestCode).replace(/^CUST-/i, ""),
      10,
    );
    const nextSequence = Number.isFinite(highestSequence)
      ? highestSequence + 1
      : 1;
    return `CUST-${String(nextSequence).padStart(5, "0")}`;
  }

  private normalizeCommercialUom(value: any) {
    const normalized = String(value || "PCS").trim().toUpperCase();
    const aliases: Record<string, string> = {
      PIECE: "PCS",
      PIECES: "PCS",
      PC: "PCS",
      NOS: "PCS",
      NUMBER: "PCS",
      NUMBERS: "PCS",
      CARTON: "CTN",
      CARTONS: "CTN",
      CTNS: "CTN",
      BOXES: "BOX",
      PACKET: "PKT",
      PACKETS: "PKT",
    };
    return aliases[normalized] || normalized;
  }

  private async resolveCommercialSalesQuantities(
    tenantId: string,
    lines: any[],
  ) {
    if (!Array.isArray(lines) || lines.length === 0) return lines;
    const itemIds = [...new Set(lines.map((line) => line.item_id).filter(Boolean))];
    const { data, error } = await this.supabase
      .from("items")
      .select(
        "id, code, name, uom, sales_uom, sales_uom_factor, sales_whole_uom_only",
      )
      .eq("tenant_id", tenantId)
      .in("id", itemIds);
    if (error) throw new BadRequestException(error.message);

    const itemById = new Map((data || []).map((item: any) => [item.id, item]));
    return lines.map((line: any, index: number) => {
      const item: any = itemById.get(line.item_id);
      if (!item) {
        throw new BadRequestException(
          `Sales item ${index + 1} is not available in this company`,
        );
      }
      const baseUom = this.normalizeCommercialUom(item.uom);
      const orderedUom = this.normalizeCommercialUom(
        line.ordered_uom || line.uom || baseUom,
      );
      const configuredSalesUom = item.sales_uom
        ? this.normalizeCommercialUom(item.sales_uom)
        : null;
      const enteredQuantity = Number(line.sales_quantity ?? line.quantity);
      if (!Number.isFinite(enteredQuantity) || enteredQuantity <= 0) {
        throw new BadRequestException(
          `Sales item ${index + 1} quantity must be greater than 0`,
        );
      }

      let factor = 1;
      if (orderedUom !== baseUom) {
        if (!configuredSalesUom || orderedUom !== configuredSalesUom) {
          throw new BadRequestException(
            `${item.code || item.name} cannot be sold in ${orderedUom}. Configure it in Item Master → Sales & packing unit first.`,
          );
        }
        factor = Number(item.sales_uom_factor);
        if (!Number.isFinite(factor) || factor <= 0) {
          throw new BadRequestException(
            `${item.code || item.name} has an invalid ${orderedUom} conversion`,
          );
        }
        if (
          item.sales_whole_uom_only === true &&
          !Number.isInteger(enteredQuantity)
        ) {
          throw new BadRequestException(
            `${item.code || item.name} must be sold in whole ${orderedUom}`,
          );
        }
      }

      const priceUom = this.normalizeCommercialUom(
        line.price_uom || orderedUom,
      );
      if (
        priceUom !== baseUom &&
        (!configuredSalesUom || priceUom !== configuredSalesUom)
      ) {
        throw new BadRequestException(
          `${item.code || item.name} cannot be priced per ${priceUom}. Use ${baseUom}${configuredSalesUom ? ` or ${configuredSalesUom}` : ""}.`,
        );
      }
      const baseQuantity = enteredQuantity * factor;
      const pricingQuantity =
        priceUom === baseUom
          ? baseQuantity
          : baseQuantity / Number(item.sales_uom_factor || 1);
      const priceUomFactor =
        priceUom === baseUom ? 1 : Number(item.sales_uom_factor || 1);

      return {
        ...line,
        quantity: baseQuantity,
        sales_quantity: enteredQuantity,
        ordered_uom: orderedUom,
        base_uom: baseUom,
        uom_conversion_factor: factor,
        price_uom: priceUom,
        price_uom_factor: priceUomFactor,
        pricing_quantity: pricingQuantity,
      };
    });
  }

  private prepareQuotationItems(
    items: any[],
    defaultTaxRate = 18,
    taxCodeLabel = "HSN",
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException("Quotation must include at least one item");
    }

    let totalAmount = 0;
    const preparedItems = items.map((item: any, index: number) => {
      if (!item.item_id) {
        throw new BadRequestException(
          `Quotation item ${index + 1} is missing item selection`,
        );
      }

      const itemDescription = String(item.item_description || "").trim();
      if (!itemDescription) {
        throw new BadRequestException(
          `Quotation item ${index + 1} description is required`,
        );
      }
      const hsnCode = String(item.hsn_code || "").trim();
      if (!hsnCode) {
        throw new BadRequestException(
          `Quotation item ${index + 1} ${taxCodeLabel} code is required`,
        );
      }
      const photos = Array.isArray(item.photos)
        ? item.photos
            .map((photo: any) => ({
              url: String(photo?.url || "").trim(),
              name: String(photo?.name || "Product photo").trim(),
              type: String(photo?.type || "").trim() || null,
              size: Number.isFinite(Number(photo?.size))
                ? Number(photo.size)
                : null,
            }))
            .filter((photo: any) => photo.url)
        : [];

      const quantity = Number(item.quantity);
      const salesQuantity = Number(item.sales_quantity ?? item.quantity);
      const unitPrice = Number(item.unit_price);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(
          `Quotation item ${index + 1} quantity must be greater than 0`,
        );
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new BadRequestException(
          `Quotation item ${index + 1} unit price cannot be negative`,
        );
      }
      const pricingQuantity = Number(item.pricing_quantity ?? salesQuantity);
      const baseAmount = pricingQuantity * unitPrice;
      const discountPercentage =
        item.discount_percentage !== undefined
          ? Number(item.discount_percentage)
          : 0;
      if (
        !Number.isFinite(discountPercentage) ||
        discountPercentage < 0 ||
        discountPercentage > 100
      ) {
        throw new BadRequestException(
          `Quotation item ${index + 1} discount percentage must be between 0 and 100`,
        );
      }

      let discountAmount =
        item.discount_amount !== undefined
          ? Number(item.discount_amount)
          : (baseAmount * discountPercentage) / 100;

      if (!Number.isFinite(discountAmount) || discountAmount < 0) {
        throw new BadRequestException(
          `Quotation item ${index + 1} discount amount cannot be negative`,
        );
      }
      if (discountAmount > baseAmount) {
        throw new BadRequestException(
          `Quotation item ${index + 1} discount cannot exceed line value`,
        );
      }

      const lineTotal = Math.max(baseAmount - discountAmount, 0);
      const taxPercentage =
        item.tax_percentage !== undefined
          ? Number(item.tax_percentage)
          : defaultTaxRate;
      if (!Number.isFinite(taxPercentage) || taxPercentage < 0) {
        throw new BadRequestException(
          `Quotation item ${index + 1} tax percentage cannot be negative`,
        );
      }
      const taxAmount = (lineTotal * taxPercentage) / 100;
      totalAmount += lineTotal + taxAmount;

      return {
        item_id: item.item_id,
        item_description: itemDescription,
        quantity,
        sales_quantity: salesQuantity,
        base_uom: item.base_uom || item.ordered_uom || "PCS",
        uom_conversion_factor: Number(item.uom_conversion_factor || 1),
        price_uom: item.price_uom || item.ordered_uom || "PCS",
        price_uom_factor: Number(item.price_uom_factor || 1),
        unit_price: unitPrice,
        discount_percentage: discountPercentage,
        discount_amount: discountAmount,
        tax_percentage: taxPercentage,
        tax_amount: taxAmount,
        line_total: lineTotal,
        delivery_days: item.delivery_days,
        ordered_uom: String(item.ordered_uom || item.uom || "NOS")
          .trim()
          .toUpperCase(),
        hsn_code: hsnCode,
        photos,
        promised_date: item.promised_date || null,
        notes: item.notes,
      };
    });

    return { preparedItems, totalAmount };
  }

  // ==================== QUOTATIONS ====================

  private validateQuotationDates(
    quotationDateValue: any,
    validUntilValue: any,
  ) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const quotationDate = String(
      quotationDateValue || new Date().toISOString().split("T")[0],
    ).trim();
    const validUntil = String(validUntilValue || "").trim();

    if (!datePattern.test(quotationDate)) {
      throw new BadRequestException("Quotation date must be a valid date");
    }
    if (!datePattern.test(validUntil)) {
      throw new BadRequestException("Valid Until must be a valid date");
    }
    if (validUntil < quotationDate) {
      throw new BadRequestException(
        "Valid Until must be on or after the quotation date",
      );
    }

    return { quotationDate, validUntil };
  }

  private getCurrentBusinessDate() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  private validateInvoiceDates(
    invoiceDateValue: any,
    dueDateValue: any,
    dispatchDateValue?: any,
  ) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const isRealDate = (value: string) => {
      if (!datePattern.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    };
    const invoiceDate = String(
      invoiceDateValue || this.getCurrentBusinessDate(),
    ).trim();
    const dueDate = String(dueDateValue || "").trim() || null;
    const dispatchDate = String(dispatchDateValue || "").slice(0, 10);

    if (!isRealDate(invoiceDate))
      throw new BadRequestException("Invoice date must be a valid date");
    if (invoiceDate > this.getCurrentBusinessDate()) {
      throw new BadRequestException("Invoice date cannot be in the future");
    }
    if (
      dispatchDate &&
      isRealDate(dispatchDate) &&
      invoiceDate < dispatchDate
    ) {
      throw new BadRequestException(
        "Invoice date cannot be before the dispatch date",
      );
    }
    if (dueDate && !isRealDate(dueDate))
      throw new BadRequestException("Due date must be a valid date");
    if (dueDate && dueDate < invoiceDate) {
      throw new BadRequestException(
        "Due date must be on or after the invoice date",
      );
    }

    return { invoiceDate, dueDate };
  }

  private validateReceiptDate(receiptDateValue: any, invoiceDateValue: any) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const receiptDate = String(
      receiptDateValue || this.getCurrentBusinessDate(),
    ).trim();
    const invoiceDate = String(invoiceDateValue || "").slice(0, 10);
    const parsed = new Date(`${receiptDate}T00:00:00.000Z`);
    if (
      !datePattern.test(receiptDate) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== receiptDate
    ) {
      throw new BadRequestException("Receipt date must be a valid date");
    }
    if (receiptDate > this.getCurrentBusinessDate()) {
      throw new BadRequestException("Receipt date cannot be in the future");
    }
    if (datePattern.test(invoiceDate) && receiptDate < invoiceDate) {
      throw new BadRequestException(
        "Receipt date cannot be before the invoice date",
      );
    }
    return receiptDate;
  }

  private validateSalesReturnDate(returnDateValue: any, invoiceDateValue: any) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const returnDate = String(
      returnDateValue || this.getCurrentBusinessDate(),
    ).trim();
    const invoiceDate = String(invoiceDateValue || "").slice(0, 10);
    const parsed = new Date(`${returnDate}T00:00:00.000Z`);
    if (
      !datePattern.test(returnDate) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== returnDate
    ) {
      throw new BadRequestException("Return date must be a valid date");
    }
    if (returnDate > this.getCurrentBusinessDate())
      throw new BadRequestException("Return date cannot be in the future");
    if (datePattern.test(invoiceDate) && returnDate < invoiceDate) {
      throw new BadRequestException(
        "Return date cannot be before the invoice date",
      );
    }
    return returnDate;
  }

  private validateCreditNoteDate(
    creditNoteDateValue: any,
    invoiceDateValue: any,
  ) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const creditNoteDate = String(
      creditNoteDateValue || this.getCurrentBusinessDate(),
    ).trim();
    const invoiceDate = String(invoiceDateValue || "").slice(0, 10);
    const parsed = new Date(`${creditNoteDate}T00:00:00.000Z`);
    if (
      !datePattern.test(creditNoteDate) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== creditNoteDate
    ) {
      throw new BadRequestException("Credit-note date must be a valid date");
    }
    if (creditNoteDate > this.getCurrentBusinessDate()) {
      throw new BadRequestException("Credit-note date cannot be in the future");
    }
    if (datePattern.test(invoiceDate) && creditNoteDate < invoiceDate) {
      throw new BadRequestException(
        "Credit-note date cannot be before the invoice date",
      );
    }
    return creditNoteDate;
  }

  private prepareSalesReturnItems(
    requestedLines: any[],
    invoiceItems: any[],
    priorReturns: any[] = [],
  ) {
    const billed = new Map(
      (invoiceItems || []).map((line: any) => [String(line.id), line]),
    );
    const alreadyReturned = new Map<string, number>();
    for (const salesReturn of priorReturns || []) {
      if (String(salesReturn?.status || "").toUpperCase() === "CANCELLED")
        continue;
      for (const line of salesReturn?.items || []) {
        const invoiceItemId = String(line.invoice_item_id || "");
        alreadyReturned.set(
          invoiceItemId,
          Number(alreadyReturned.get(invoiceItemId) || 0) +
            Number(line.quantity || 0),
        );
      }
    }

    const normalized = (requestedLines || []).map((line: any) => {
      const invoiceItemId = String(line.invoice_item_id || "");
      const billedLine: any = billed.get(invoiceItemId);
      const quantity = Number(line.quantity || 0);
      if (!billedLine || !Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(
          "Each return line must reference an invoiced item with a positive quantity",
        );
      }
      const remaining = Math.max(
        0,
        Number(billedLine.quantity || 0) -
          Number(alreadyReturned.get(invoiceItemId) || 0),
      );
      if (quantity > remaining + 0.000001) {
        throw new BadRequestException(
          `Return quantity for ${billedLine.item_description || "invoice item"} exceeds the remaining returnable quantity ${remaining}`,
        );
      }
      return {
        invoice_item_id: billedLine.id,
        item_id: billedLine.item_id,
        item_description: billedLine.item_description,
        quantity,
      };
    });
    if (
      new Set(normalized.map((line: any) => line.invoice_item_id)).size !==
      normalized.length
    ) {
      throw new BadRequestException(
        "Duplicate return item lines are not allowed",
      );
    }
    return normalized;
  }

  private isQuotationExpired(
    validUntilValue: any,
    businessDate = this.getCurrentBusinessDate(),
  ) {
    const validUntil = String(validUntilValue || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(validUntil) && validUntil < businessDate;
  }

  async getQuotations(req: Request, filters?: any) {
    const { tenantId } = req.user as any;

    const { error: expiryError } = await this.supabase
      .from("quotations")
      .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .in("status", ["APPROVED", "PARTIALLY_CONVERTED"])
      .lt("valid_until", this.getCurrentBusinessDate());
    if (expiryError) throw new BadRequestException(expiryError.message);

    let query = this.supabase
      .from("quotations")
      .select(
        `
        *,
        customers:customer_id(id, customer_code, customer_name, contact_person)
      `,
      )
      .eq("tenant_id", tenantId);

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    if (filters?.customer_id) {
      query = query.eq("customer_id", filters.customer_id);
    }

    const { data, error } = await query.order("quotation_date", {
      ascending: false,
    });

    if (error) throw new BadRequestException(error.message);

    // Flatten customer data for frontend
    const formattedData = data?.map((q: any) => ({
      ...q,
      customer_name: q.customers?.customer_name || null,
      customer_code: q.customers?.customer_code || null,
    }));

    return formattedData;
  }

  async createQuotation(req: Request, quotationData: any) {
    const { tenantId, userId } = req.user as any;
    const regional = await this.getTenantRegionalDefaults(tenantId);

    const quotationNumber = await this.generateQuotationNumber(req);
    const { quotationDate, validUntil } = this.validateQuotationDates(
      quotationData.quotation_date,
      quotationData.valid_until,
    );

    const commercialItems = await this.resolveCommercialSalesQuantities(
      tenantId,
      quotationData.items || [],
    );
    const { preparedItems, totalAmount } = this.prepareQuotationItems(
      commercialItems,
      regional.defaultTaxRate,
      regional.marketProfile === "UAE" ? "Commodity / Service" : "HSN",
    );
    const termsConditions = String(quotationData.terms_conditions || "").trim();
    if (!termsConditions) {
      throw new BadRequestException("Terms and Conditions are required");
    }

    const discountAmount = Number(quotationData.discount_amount || 0);
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      throw new BadRequestException("Quotation discount cannot be negative");
    }
    if (discountAmount > totalAmount) {
      throw new BadRequestException(
        "Quotation discount cannot exceed quotation value",
      );
    }
    const netAmount = totalAmount - discountAmount;

    const quotation = {
      tenant_id: tenantId,
      quotation_number: quotationNumber,
      customer_id: quotationData.customer_id,
      quotation_date: quotationDate,
      valid_until: validUntil,
      status: "DRAFT",
      total_amount: totalAmount,
      discount_amount: discountAmount,
      net_amount: netAmount,
      payment_terms: quotationData.payment_terms,
      delivery_terms: quotationData.delivery_terms,
      notes: quotationData.notes,
      terms_conditions: termsConditions,
      currency_code: String(quotationData.currency_code || regional.currency)
        .trim()
        .toUpperCase(),
      place_of_supply:
        String(quotationData.place_of_supply || "").trim() || null,
      incoterm:
        String(quotationData.incoterm || "")
          .trim()
          .toUpperCase() || null,
      customer_reference:
        String(quotationData.customer_reference || "").trim() || null,
      created_by: userId,
    };

    const { data: quotationRecord, error: quotationError } = await this.supabase
      .from("quotations")
      .insert(quotation)
      .select()
      .single();

    if (quotationError) throw new BadRequestException(quotationError.message);

    // Insert quotation items
    const quotationItems = preparedItems.map((item: any) => ({
      quotation_id: quotationRecord.id,
      item_id: item.item_id,
      item_description: item.item_description,
      quantity: item.quantity,
      sales_quantity: item.sales_quantity,
      base_uom: item.base_uom,
      uom_conversion_factor: item.uom_conversion_factor,
      price_uom: item.price_uom,
      price_uom_factor: item.price_uom_factor,
      unit_price: item.unit_price,
      discount_percentage: item.discount_percentage,
      discount_amount: item.discount_amount || 0,
      tax_percentage: item.tax_percentage ?? regional.defaultTaxRate,
      tax_amount: item.tax_amount,
      line_total: item.line_total,
      delivery_days: item.delivery_days,
      ordered_uom: item.ordered_uom || "NOS",
      hsn_code: item.hsn_code || null,
      photos: item.photos || [],
      promised_date: item.promised_date || null,
      notes: item.notes,
    }));

    const { error: itemsError } = await this.supabase
      .from("quotation_items")
      .insert(quotationItems);

    if (itemsError) {
      await this.supabase
        .from("quotations")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", quotationRecord.id);
      throw new BadRequestException(itemsError.message);
    }

    return quotationRecord;
  }

  async getQuotationById(req: Request, quotationId: string) {
    const { tenantId } = req.user as any;

    const { data, error } = await this.supabase
      .from("quotations")
      .select(
        `
        *,
        customers:customer_id(id, customer_code, customer_name, contact_person, email, phone, mobile, billing_address, shipping_address, city, state, pincode, gst_number),
        quotation_items(*)
      `,
      )
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }

    if (!data) {
      throw new NotFoundException("Quotation not found");
    }

    let revisedFromQuotation: any = null;
    if (data.revised_from_quotation_id) {
      const { data: predecessor, error: predecessorError } = await this.supabase
        .from("quotations")
        .select("id, quotation_number, revision_no, status")
        .eq("tenant_id", tenantId)
        .eq("id", data.revised_from_quotation_id)
        .maybeSingle();
      if (predecessorError)
        throw new BadRequestException(predecessorError.message);
      revisedFromQuotation = predecessor;
    }

    const { data: successor, error: successorError } = await this.supabase
      .from("quotations")
      .select("id, quotation_number, revision_no, status")
      .eq("tenant_id", tenantId)
      .eq("revised_from_quotation_id", quotationId)
      .maybeSingle();
    if (successorError) throw new BadRequestException(successorError.message);

    return {
      ...data,
      customer_name: data.customers?.customer_name || null,
      customer_code: data.customers?.customer_code || null,
      revised_from_quotation: revisedFromQuotation,
      revised_to_quotation: successor || null,
    };
  }

  async updateQuotation(req: Request, quotationId: string, quotationData: any) {
    const { tenantId } = req.user as any;
    const regional = await this.getTenantRegionalDefaults(tenantId);

    const { data: existing, error: fetchError } = await this.supabase
      .from("quotations")
      .select("id, status, currency_code, revision_no")
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException("Quotation not found");
    }

    if (existing.status !== "DRAFT") {
      throw new BadRequestException("Only draft quotations can be edited");
    }

    const commercialItems = await this.resolveCommercialSalesQuantities(
      tenantId,
      quotationData.items || [],
    );
    const { preparedItems, totalAmount } = this.prepareQuotationItems(
      commercialItems,
      regional.defaultTaxRate,
      regional.marketProfile === "UAE" ? "Commodity / Service" : "HSN",
    );
    const termsConditions = String(quotationData.terms_conditions || "").trim();
    if (!termsConditions) {
      throw new BadRequestException("Terms and Conditions are required");
    }
    const { quotationDate, validUntil } = this.validateQuotationDates(
      quotationData.quotation_date,
      quotationData.valid_until,
    );
    const discountAmount = quotationData.discount_amount
      ? Number(quotationData.discount_amount)
      : 0;
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      throw new BadRequestException("Quotation discount cannot be negative");
    }
    if (discountAmount > totalAmount) {
      throw new BadRequestException(
        "Quotation discount cannot exceed quotation value",
      );
    }
    const netAmount = totalAmount - discountAmount;

    const { data: updatedQuotation, error: quotationError } =
      await this.supabase
        .from("quotations")
        .update({
          customer_id: quotationData.customer_id,
          quotation_date: quotationDate,
          valid_until: validUntil,
          total_amount: totalAmount,
          discount_amount: discountAmount,
          net_amount: netAmount,
          payment_terms: quotationData.payment_terms,
          delivery_terms: quotationData.delivery_terms,
          notes: quotationData.notes,
          terms_conditions: termsConditions,
          currency_code: String(
            quotationData.currency_code ||
              existing.currency_code ||
              regional.currency,
          )
            .trim()
            .toUpperCase(),
          place_of_supply:
            String(quotationData.place_of_supply || "").trim() || null,
          incoterm:
            String(quotationData.incoterm || "")
              .trim()
              .toUpperCase() || null,
          customer_reference:
            String(quotationData.customer_reference || "").trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", quotationId)
        .eq("tenant_id", tenantId)
        .select()
        .single();

    if (quotationError) {
      throw new BadRequestException(quotationError.message);
    }

    const { error: deleteError } = await this.supabase
      .from("quotation_items")
      .delete()
      .eq("quotation_id", quotationId);

    if (deleteError) {
      throw new BadRequestException(deleteError.message);
    }

    const quotationItems = preparedItems.map((item: any) => ({
      quotation_id: quotationId,
      item_id: item.item_id,
      item_description: item.item_description,
      quantity: item.quantity,
      sales_quantity: item.sales_quantity,
      base_uom: item.base_uom,
      uom_conversion_factor: item.uom_conversion_factor,
      price_uom: item.price_uom,
      price_uom_factor: item.price_uom_factor,
      unit_price: item.unit_price,
      discount_percentage: item.discount_percentage,
      discount_amount: item.discount_amount,
      tax_percentage: item.tax_percentage,
      tax_amount: item.tax_amount,
      line_total: item.line_total,
      delivery_days: item.delivery_days,
      ordered_uom: item.ordered_uom || "NOS",
      hsn_code: item.hsn_code || null,
      photos: item.photos || [],
      promised_date: item.promised_date || null,
      notes: item.notes,
    }));

    const { error: itemsError } = await this.supabase
      .from("quotation_items")
      .insert(quotationItems);

    if (itemsError) {
      throw new BadRequestException(itemsError.message);
    }

    return updatedQuotation;
  }

  async approveQuotation(req: Request, quotationId: string) {
    const { tenantId, userId } = req.user as any;

    const { data: quotation, error: fetchError } = await this.supabase
      .from("quotations")
      .select(
        "id, quotation_number, status, created_by, net_amount, valid_until",
      )
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!quotation) throw new NotFoundException("Quotation not found");
    if (
      !hasSuperAdminBypass((req as any).user) &&
      quotation.created_by === userId
    ) {
      throw new ForbiddenException(
        "Creator cannot approve their own quotation",
      );
    }
    if (quotation.status !== "DRAFT") {
      throw new BadRequestException("Only draft quotations can be approved");
    }
    if (this.isQuotationExpired(quotation.valid_until)) {
      throw new BadRequestException(
        "Quotation validity has expired. Update Valid Until before approval",
      );
    }
    if ((Number(quotation.net_amount) || 0) <= 0) {
      throw new BadRequestException(
        "Quotation must have a positive net amount before approval",
      );
    }

    const { error } = await this.supabase
      .from("quotations")
      .update({
        status: "APPROVED",
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .eq("status", "DRAFT");

    if (error) throw new BadRequestException(error.message);
    return { message: "Quotation approved successfully" };
  }

  private buildPdfItems(lines: any[]) {
    return (lines || []).map((line: any) => {
      const quantity = Number(line.sales_quantity ?? line.quantity ?? 0);
      return {
        description: [
          line.item_description || line.description || line.item_id || "Item",
          line.hsn_code ? `HSN: ${line.hsn_code}` : "",
          line.price_uom &&
          this.normalizeCommercialUom(line.price_uom) !==
            this.normalizeCommercialUom(line.ordered_uom)
            ? `Rate basis: per ${this.normalizeCommercialUom(line.price_uom)}`
            : "",
        ]
          .filter(Boolean)
          .join(" | "),
        quantity,
        unit: String(
          line.ordered_uom || line.uom || line.unit || "NOS",
        ).toUpperCase(),
        unit_price: Number(line.unit_price || 0),
      };
    });
  }

  private pdfCustomer(customer: any) {
    return {
      name: customer?.customer_name || "Customer",
      address: [
        customer?.billing_address,
        customer?.city,
        customer?.state,
        customer?.pincode,
      ]
        .filter(Boolean)
        .join(", "),
      phone: customer?.mobile || customer?.phone || "",
      email: customer?.email || "",
    };
  }

  private pdfFilename(reference: unknown) {
    return `${String(reference || "sales-document").replace(/[^a-z0-9._-]+/gi, "-")}.pdf`;
  }

  async renderQuotationPdf(req: Request, quotationId: string) {
    if (!this.quotePdfService)
      throw new BadRequestException("Sales PDF service is unavailable");
    const quotation: any = await this.getQuotationById(req, quotationId);
    const tenantId = (req.user as any).tenantId;
    const lines = quotation.quotation_items || [];
    const taxable = lines.reduce(
      (sum: number, line: any) => sum + Number(line.line_total || 0),
      0,
    );
    const tax = lines.reduce(
      (sum: number, line: any) => sum + Number(line.tax_amount || 0),
      0,
    );
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      quote_number: quotation.quotation_number,
      quote_date_iso: String(
        quotation.quotation_date ||
          quotation.created_at ||
          new Date().toISOString(),
      ),
      title: `Revision ${Number(quotation.revision_no || 0)} | ${String(quotation.status || "DRAFT").replaceAll("_", " ")}`,
      document_label: "SALES QUOTATION",
      company: { name: "SAK ERP" },
      customer: this.pdfCustomer(quotation.customers),
      items: this.buildPdfItems(lines),
      currency: quotation.currency_code || "INR",
      tax_rate: taxable > 0 ? tax / taxable : 0,
      discount: Number(quotation.discount_amount || 0),
      notes: [
        quotation.customer_rfq_reference
          ? `Customer RFQ: ${quotation.customer_rfq_reference}`
          : "",
        quotation.notes || "",
      ]
        .filter(Boolean)
        .join("\n"),
      terms: [
        quotation.payment_terms ? `Payment: ${quotation.payment_terms}` : "",
        quotation.delivery_terms ? `Delivery: ${quotation.delivery_terms}` : "",
        quotation.terms_conditions || "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { buffer, filename: this.pdfFilename(quotation.quotation_number) };
  }

  async rejectQuotation(
    req: Request,
    quotationId: string,
    reasonValue?: string,
  ) {
    const { tenantId, userId } = req.user as any;
    const reason = String(reasonValue || "").trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        "A rejection reason of at least 5 characters is required",
      );
    }

    const { data: quotation, error: fetchError } = await this.supabase
      .from("quotations")
      .select("id, quotation_number, status, created_by")
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!quotation) throw new NotFoundException("Quotation not found");
    if (
      !hasSuperAdminBypass((req as any).user) &&
      quotation.created_by === userId
    ) {
      throw new ForbiddenException("Creator cannot reject their own quotation");
    }
    if (quotation.status !== "DRAFT") {
      throw new BadRequestException("Only draft quotations can be rejected");
    }

    const { error: updateError } = await this.supabase
      .from("quotations")
      .update({
        status: "REJECTED",
        rejected_reason: reason,
        rejected_by: userId,
        rejected_at: new Date().toISOString(),
        approved_by: null,
        approved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .eq("status", "DRAFT");

    if (updateError) throw new BadRequestException(updateError.message);
    return {
      quotation_id: quotation.id,
      quotation_number: quotation.quotation_number,
      status: "REJECTED",
      rejected_reason: reason,
      message: `Quotation ${quotation.quotation_number} rejected`,
    };
  }

  async reviseQuotation(req: Request, quotationId: string) {
    const { tenantId, userId } = req.user as any;
    const { data: source, error: sourceError } = await this.supabase
      .from("quotations")
      .select("*, quotation_items(*)")
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (sourceError) throw new BadRequestException(sourceError.message);
    if (!source) throw new NotFoundException("Quotation not found");
    if (!["APPROVED", "REJECTED", "EXPIRED"].includes(source.status)) {
      throw new BadRequestException(
        "Only approved, rejected, or expired quotations can be revised",
      );
    }

    const { data: existingRevision, error: revisionError } = await this.supabase
      .from("quotations")
      .select("id, quotation_number, status")
      .eq("tenant_id", tenantId)
      .eq("revised_from_quotation_id", quotationId)
      .maybeSingle();
    if (revisionError) throw new BadRequestException(revisionError.message);
    if (existingRevision) {
      throw new BadRequestException(
        `Quotation ${source.quotation_number} already has revision ${existingRevision.quotation_number} (${existingRevision.status})`,
      );
    }

    const quotationNumber = await this.generateQuotationNumber(req);
    const today = new Date();
    const todayValue = today.toISOString().slice(0, 10);
    const originalValidity = source.valid_until
      ? new Date(`${source.valid_until}T00:00:00`)
      : null;
    const defaultValidity = new Date(today);
    defaultValidity.setDate(defaultValidity.getDate() + 30);
    const validUntil =
      originalValidity && originalValidity >= today
        ? String(source.valid_until).slice(0, 10)
        : defaultValidity.toISOString().slice(0, 10);

    const { data: revision, error: insertError } = await this.supabase
      .from("quotations")
      .insert({
        tenant_id: tenantId,
        quotation_number: quotationNumber,
        customer_id: source.customer_id,
        quotation_date: todayValue,
        valid_until: validUntil,
        status: "DRAFT",
        total_amount: source.total_amount,
        discount_percentage: source.discount_percentage,
        discount_amount: source.discount_amount,
        tax_amount: source.tax_amount,
        net_amount: source.net_amount,
        payment_terms: source.payment_terms,
        delivery_terms: source.delivery_terms,
        notes: source.notes,
        terms_conditions: source.terms_conditions,
        currency_code: source.currency_code || "INR",
        place_of_supply: source.place_of_supply,
        incoterm: source.incoterm,
        customer_reference: source.customer_reference,
        revision_no: Number(source.revision_no || 0) + 1,
        revised_from_quotation_id: source.id,
        created_by: userId,
      })
      .select()
      .single();
    if (insertError) throw new BadRequestException(insertError.message);

    const revisionItems = (source.quotation_items || []).map((item: any) => ({
      quotation_id: revision.id,
      item_id: item.item_id,
      item_description: item.item_description,
      quantity: item.quantity,
      sales_quantity: item.sales_quantity ?? item.quantity,
      base_uom: item.base_uom || item.ordered_uom || "PCS",
      uom_conversion_factor: Number(item.uom_conversion_factor || 1),
      price_uom: item.price_uom || item.ordered_uom || "PCS",
      price_uom_factor: Number(item.price_uom_factor || 1),
      unit_price: item.unit_price,
      discount_percentage: item.discount_percentage,
      discount_amount: item.discount_amount,
      tax_percentage: item.tax_percentage,
      tax_amount: item.tax_amount,
      line_total: item.line_total,
      delivery_days: item.delivery_days,
      ordered_uom: item.ordered_uom || "NOS",
      hsn_code: item.hsn_code,
      photos: Array.isArray(item.photos) ? item.photos : [],
      promised_date: item.promised_date,
      notes: item.notes,
    }));

    if (revisionItems.length > 0) {
      const { error: itemError } = await this.supabase
        .from("quotation_items")
        .insert(revisionItems);
      if (itemError) {
        await this.supabase
          .from("quotations")
          .delete()
          .eq("id", revision.id)
          .eq("tenant_id", tenantId);
        throw new BadRequestException(itemError.message);
      }
    }

    await this.insertQuotationActivity(
      tenantId,
      revision.id,
      "REVISION_CREATED",
      userId,
      {
        comments: `Revision ${Number(revision.revision_no || 0)} created from ${source.quotation_number}`,
        metadata: {
          source_quotation_id: source.id,
          source_quotation_number: source.quotation_number,
        },
      },
    );

    return {
      ...revision,
      source_quotation_number: source.quotation_number,
      message: `Draft revision ${quotationNumber} created from ${source.quotation_number}`,
    };
  }

  async getQuotationActivities(req: Request, quotationId: string) {
    const { tenantId } = req.user as any;
    await this.assertQuotationExists(tenantId, quotationId);
    const { data, error } = await this.supabase
      .from("sales_quotation_activities")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("quotation_id", quotationId)
      .order("created_at", { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async addQuotationComment(req: Request, quotationId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    await this.assertQuotationExists(tenantId, quotationId);
    const comments = String(body?.comments || body?.comment || "").trim();
    if (!comments)
      throw new BadRequestException("Customer comment is required");
    return this.insertQuotationActivity(
      tenantId,
      quotationId,
      "CUSTOMER_COMMENT",
      userId,
      {
        subject: String(body?.subject || "Customer feedback").trim(),
        comments,
        reminder_due_at: body?.follow_up_at || null,
        metadata: {
          source: String(body?.source || "MANUAL")
            .trim()
            .toUpperCase(),
        },
      },
    );
  }

  async sendQuotationEmail(req: Request, quotationId: string, body: any = {}) {
    return this.sendQuotationCommunication(req, quotationId, body, false);
  }

  async sendQuotationResponseReminder(
    req: Request,
    quotationId: string,
    body: any = {},
  ) {
    return this.sendQuotationCommunication(req, quotationId, body, true);
  }

  private async sendQuotationCommunication(
    req: Request,
    quotationId: string,
    body: any,
    reminder: boolean,
  ) {
    const { tenantId, userId } = req.user as any;
    const quotation: any = await this.getQuotationById(req, quotationId);
    const customer = quotation.customers || {};
    const recipient = String(body?.to || customer.email || "").trim();
    if (!recipient) throw new BadRequestException("Customer email is required");
    const subject = String(
      body?.subject ||
        (reminder
          ? `Response reminder: ${quotation.quotation_number}`
          : `Sales quotation ${quotation.quotation_number}`),
    ).trim();
    const intro = String(
      body?.message ||
        (reminder
          ? `This is a reminder to review and respond to quotation ${quotation.quotation_number}.`
          : `Please find the commercial details for quotation ${quotation.quotation_number} below.`),
    ).trim();
    const rows = (quotation.quotation_items || [])
      .map(
        (item: any, index: number) => `
      <tr><td>${index + 1}</td><td>${this.escapeSalesHtml(item.item_description || "Item")}</td><td>${Number(item.quantity || 0)}</td><td>Rs. ${this.formatSalesMoney(item.unit_price)}</td><td>Rs. ${this.formatSalesMoney(item.line_total)}</td></tr>`,
      )
      .join("");
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>${this.escapeSalesHtml(subject)}</h2><p>${this.escapeSalesHtml(intro)}</p><table style="border-collapse:collapse;width:100%"><thead><tr><th style="border:1px solid #ddd;padding:8px">No.</th><th style="border:1px solid #ddd;padding:8px">Item / Description</th><th style="border:1px solid #ddd;padding:8px">Qty</th><th style="border:1px solid #ddd;padding:8px">Rate</th><th style="border:1px solid #ddd;padding:8px">Amount</th></tr></thead><tbody>${rows}</tbody></table><p style="font-size:16px"><strong>Net quotation value: Rs. ${this.formatSalesMoney(quotation.net_amount)}</strong></p><p>Valid until: ${this.escapeSalesHtml(String(quotation.valid_until || "-").slice(0, 10))} &nbsp; | &nbsp; Revision: ${Number(quotation.revision_no || 0)}</p><p style="white-space:pre-wrap">${this.escapeSalesHtml(quotation.terms_conditions || "")}</p></div>`;
    const pdf = this.quotePdfService
      ? await this.renderQuotationPdf(req, quotationId)
      : null;
    await this.emailService.sendEmail({
      to: recipient,
      subject,
      html,
      from: "sales",
      tenantId,
      attachments: pdf
        ? [
            {
              filename: pdf.filename,
              content: pdf.buffer,
              contentType: "application/pdf",
            },
          ]
        : [],
    });
    // Keep the tenant communication hub in sync without making the sales
    // transaction depend on a reporting/audit feature being installed.
    await this.supabase
      .from("communication_log")
      .insert({
        tenant_id: tenantId,
        module: "SALES",
        document_type: "QUOTATION",
        document_id: quotation.id,
        document_number: quotation.quotation_number,
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipient,
        subject,
        message_preview: intro.slice(0, 1000),
        delivery_status: "SENT",
        metadata: {
          event: reminder ? "RESPONSE_REMINDER" : "QUOTATION_EMAIL",
          revision_no: Number(quotation.revision_no || 0),
        },
        created_by: userId,
      })
      .then(({ error }: any) => {
        // Communication-log migration may not yet exist in an older tenant.
        // Email has already been successfully delivered and must not be rolled back.
        if (error)
          console.warn(
            "Quotation communication log not written:",
            error.message,
          );
      });
    const activity = await this.insertQuotationActivity(
      tenantId,
      quotationId,
      reminder ? "RESPONSE_REMINDER" : "QUOTATION_EMAIL",
      userId,
      {
        subject,
        comments: intro,
        recipient_email: recipient,
        sent_at: new Date().toISOString(),
        reminder_due_at: body?.follow_up_at || null,
      },
    );
    return {
      message: reminder
        ? "Quotation response reminder sent successfully"
        : "Sales quotation emailed successfully",
      recipient,
      activity,
    };
  }

  async deleteQuotation(req: Request, quotationId: string) {
    const { tenantId } = req.user as any;

    const { data: existing, error: fetchError } = await this.supabase
      .from("quotations")
      .select("id, status")
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing)
      throw new NotFoundException("Quotation not found");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException("Only draft quotations can be deleted");
    }

    const { error: itemsError } = await this.supabase
      .from("quotation_items")
      .delete()
      .eq("quotation_id", quotationId);

    if (itemsError) throw new BadRequestException(itemsError.message);

    const { error: deleteError } = await this.supabase
      .from("quotations")
      .delete()
      .eq("id", quotationId)
      .eq("tenant_id", tenantId);

    if (deleteError) throw new BadRequestException(deleteError.message);
    return { message: "Quotation deleted successfully" };
  }

  async convertQuotationToSO(
    req: Request,
    quotationId: string,
    conversionData?: any,
  ) {
    const { tenantId, userId } = req.user as any;

    // Get quotation with items
    const { data: quotation } = await this.supabase
      .from("quotations")
      .select("*, quotation_items(*)")
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .single();

    if (!quotation) throw new NotFoundException("Quotation not found");

    if (this.isQuotationExpired(quotation.valid_until)) {
      if (["APPROVED", "PARTIALLY_CONVERTED"].includes(quotation.status)) {
        await this.supabase
          .from("quotations")
          .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
          .eq("id", quotationId)
          .eq("tenant_id", tenantId)
          .in("status", ["APPROVED", "PARTIALLY_CONVERTED"]);
      }
      throw new BadRequestException(
        `Quotation ${quotation.quotation_number} expired on ${String(quotation.valid_until).slice(0, 10)}. Create a revision with a new validity date`,
      );
    }

    // Allow APPROVED or PARTIALLY_CONVERTED quotations
    if (!["APPROVED", "PARTIALLY_CONVERTED"].includes(quotation.status)) {
      throw new BadRequestException(
        "Only approved or partially converted quotations can be converted to sales orders",
      );
    }

    // Validate partial conversion quantities if provided
    const itemsToConvert = (
      conversionData?.items ||
      quotation.quotation_items.map((item: any) => ({
        quotation_item_id: item.id,
        quantity:
          (Number(item.quantity) || 0) - (Number(item.converted_quantity) || 0), // remaining qty
      }))
    ).map((item: any) => ({
      quotation_item_id: item.quotation_item_id,
      quantity: Number(item.quantity) || 0,
    }));

    // Validate each item
    for (const convItem of itemsToConvert) {
      const quotItem = quotation.quotation_items.find(
        (qi: any) => qi.id === convItem.quotation_item_id,
      );
      if (!quotItem) {
        throw new BadRequestException(
          `Quotation item ${convItem.quotation_item_id} not found`,
        );
      }

      const pendingQty = quotItem.quantity - (quotItem.converted_quantity || 0);
      if (convItem.quantity > pendingQty) {
        throw new BadRequestException(
          `Cannot convert ${convItem.quantity} of item ${quotItem.item_description}. Only ${pendingQty} remaining.`,
        );
      }

      if (convItem.quantity <= 0) {
        throw new BadRequestException(
          `Quantity must be greater than 0 for item ${quotItem.item_description}`,
        );
      }
    }

    // Create sales order
    const soNumber = await this.generateSONumber(req);

    const advanceAmount = Number(conversionData?.advance_amount || 0) || 0;
    if (!Number.isFinite(advanceAmount) || advanceAmount < 0) {
      throw new BadRequestException("Advance amount cannot be negative");
    }

    // Calculate totals based on items being converted
    let soTotalAmount = 0;
    const soItems = itemsToConvert.map((convItem: any) => {
      const quotItem = quotation.quotation_items.find(
        (qi: any) => qi.id === convItem.quotation_item_id,
      );

      // Proportional calculation based on quantity
      const quoteQty = Number(quotItem.quantity) || 0;
      const ratio =
        quoteQty > 0 ? (Number(convItem.quantity) || 0) / quoteQty : 0;
      const lineTotal = quotItem.line_total * ratio;
      const taxAmount = quotItem.tax_amount * ratio;
      const discountAmount = quotItem.discount_amount * ratio;

      soTotalAmount += lineTotal + taxAmount;

      return {
        sales_order_id: null, // Will be set after SO creation
        item_id: quotItem.item_id,
        item_description: quotItem.item_description,
        quantity: Number(convItem.quantity) || 0,
        sales_quantity:
          Number(quotItem.sales_quantity ?? quotItem.quantity) * ratio,
        base_uom: quotItem.base_uom || quotItem.ordered_uom || "PCS",
        uom_conversion_factor: Number(quotItem.uom_conversion_factor || 1),
        price_uom: quotItem.price_uom || quotItem.ordered_uom || "PCS",
        price_uom_factor: Number(quotItem.price_uom_factor || 1),
        unit_price: quotItem.unit_price,
        discount_amount: discountAmount,
        tax_percentage: quotItem.tax_percentage,
        tax_amount: taxAmount,
        line_total: lineTotal,
        ordered_uom: quotItem.ordered_uom || "NOS",
        hsn_code: quotItem.hsn_code || null,
        promised_date:
          conversionData?.expected_delivery_date ||
          quotItem.promised_date ||
          null,
        notes: quotItem.notes,
      };
    });

    if (advanceAmount > soTotalAmount) {
      throw new BadRequestException(
        "Advance amount cannot exceed sales order value",
      );
    }
    await this.assertCustomerCreditAvailable(
      tenantId,
      quotation.customer_id,
      soTotalAmount - advanceAmount,
    );

    const salesOrder = {
      tenant_id: tenantId,
      so_number: soNumber,
      quotation_id: quotationId,
      customer_id: quotation.customer_id,
      order_date:
        conversionData?.order_date || new Date().toISOString().split("T")[0],
      expected_delivery_date: conversionData?.expected_delivery_date || null,
      status: "CONFIRMED",
      total_amount: soTotalAmount,
      discount_amount: 0,
      net_amount: soTotalAmount,
      balance_amount: soTotalAmount - advanceAmount,
      advance_paid: advanceAmount,
      payment_terms: conversionData?.payment_terms || quotation.payment_terms,
      delivery_terms: quotation.delivery_terms,
      notes: conversionData?.special_instructions || quotation.notes,
      project: conversionData?.project || null, // Project field
      is_direct_order: false,
      source_type: "QUOTATION",
      customer_po_number:
        String(
          conversionData?.customer_po_number ||
            quotation.customer_reference ||
            "",
        ).trim() || null,
      customer_po_date: conversionData?.customer_po_date || null,
      currency_code: quotation.currency_code || "INR",
      place_of_supply: quotation.place_of_supply || null,
      incoterm: quotation.incoterm || null,
      release_status: "PENDING",
      credit_status: "CLEAR",
      release_requested_at: new Date().toISOString(),
      release_requested_by: userId,
      availability_status: "NOT_CHECKED",
      delivery_block: false,
      billing_block: false,
      created_by: userId,
    };

    const { data: soRecord, error: soError } = await this.supabase
      .from("sales_orders")
      .insert(salesOrder)
      .select()
      .single();

    if (soError) throw new BadRequestException(soError.message);

    // Update SO items with the correct sales_order_id (and ensure only schema fields are sent)
    const soItemsWithId = soItems.map((item: any) => ({
      ...item,
      sales_order_id: soRecord.id,
    }));

    const { error: itemsError } = await this.supabase
      .from("sales_order_items")
      .insert(soItemsWithId);

    if (itemsError) throw new BadRequestException(itemsError.message);

    // Update converted_quantity for each quotation item
    for (const convItem of itemsToConvert) {
      const quotItem = quotation.quotation_items.find(
        (qi: any) => qi.id === convItem.quotation_item_id,
      );
      const newConvertedQty =
        (quotItem.converted_quantity || 0) + convItem.quantity;

      await this.supabase
        .from("quotation_items")
        .update({ converted_quantity: newConvertedQty })
        .eq("id", convItem.quotation_item_id);
    }

    // Check if quotation is fully converted
    const { data: updatedItems } = await this.supabase
      .from("quotation_items")
      .select("quantity, converted_quantity")
      .eq("quotation_id", quotationId);

    const allFullyConverted =
      updatedItems &&
      updatedItems.every(
        (item: any) => (item.converted_quantity || 0) >= item.quantity,
      );

    // Update quotation status
    const newStatus = allFullyConverted ? "CONVERTED" : "PARTIALLY_CONVERTED";
    await this.supabase
      .from("quotations")
      .update({
        status: newStatus,
        converted_to_so_id: allFullyConverted
          ? soRecord.id
          : quotation.converted_to_so_id,
        converted_at: allFullyConverted
          ? new Date().toISOString()
          : quotation.converted_at,
      })
      .eq("id", quotationId);

    await this.recordSalesEvent(
      tenantId,
      soRecord.id,
      "SALES_ORDER",
      soRecord.id,
      soRecord.so_number,
      "CREATED_FROM_QUOTATION",
      userId,
      null,
      { quotation_id: quotationId },
    );
    return soRecord;
  }

  private async generateQuotationNumber(req: Request): Promise<string> {
    const sequence = await this.nextDocumentSequence("QUOTATION");
    return `QT-${String(sequence).padStart(6, "0")}`;
  }

  // ==================== SALES ORDERS ====================

  async getSalesOrders(req: Request, filters?: any) {
    const { tenantId } = req.user as any;

    let query = this.supabase
      .from("sales_orders")
      .select(
        `
        *,
        customers:customer_id(id, customer_code, customer_name, contact_person)
      `,
      )
      .eq("tenant_id", tenantId);

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    if (filters?.customer_id) {
      query = query.eq("customer_id", filters.customer_id);
    }

    if (filters?.project) {
      query = query.eq("project", filters.project);
    }

    const { data, error } = await query.order("order_date", {
      ascending: false,
    });

    if (error) throw new BadRequestException(error.message);

    // Flatten customer data for frontend
    const formattedData = data?.map((so: any) => ({
      ...so,
      customer_name: so.customers?.customer_name || null,
      customer_code: so.customers?.customer_code || null,
    }));

    return formattedData;
  }

  /**
   * Customer credit exposure follows the sales-control convention of open AR
   * plus unfulfilled sales-order commitments.  A credit limit of zero is
   * treated as "not configured" so existing customers are not blocked until
   * finance explicitly enables their limit.
   */
  async getCustomerCreditExposure(
    req: Request,
    customerId: string,
    proposedAmount = 0,
  ) {
    const { tenantId } = req.user as any;
    return this.calculateCustomerCreditExposure(
      tenantId,
      customerId,
      proposedAmount,
    );
  }

  private async assertCustomerCreditAvailable(
    tenantId: string,
    customerId: string,
    proposedAmount: number,
  ) {
    const exposure = await this.calculateCustomerCreditExposure(
      tenantId,
      customerId,
      proposedAmount,
    );
    if (
      exposure.credit_control_enabled &&
      exposure.projected_exposure > exposure.credit_limit + 0.01
    ) {
      throw new BadRequestException(
        `Credit limit exceeded for ${exposure.customer_name}. Available credit is Rs. ${exposure.available_credit.toFixed(2)}; this order requires Rs. ${Number(proposedAmount || 0).toFixed(2)}. Record an advance or obtain a credit-limit increase.`,
      );
    }
    return exposure;
  }

  async getCustomerAccountStatement(
    req: Request,
    customerId: string,
    period: { from?: string; to?: string } = {},
  ) {
    const { tenantId } = req.user as any;
    const today = new Date().toISOString().slice(0, 10);
    const from = String(period.from || `${today.slice(0, 4)}-01-01`);
    const to = String(period.to || today);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to
    ) {
      throw new BadRequestException(
        "Enter a valid statement period with From date on or before To date",
      );
    }

    const customer = (await this.getCustomers(req)).find(
      (entry: any) => entry.id === customerId,
    );
    if (!customer) throw new NotFoundException("Customer not found");

    const [
      { data: salesInvoices, error: salesError },
      { data: serviceInvoices, error: serviceError },
    ] = await Promise.all([
      this.supabase
        .from("invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, net_amount, paid_amount, credited_amount, balance_amount, payment_status, billing_status, payments:sales_invoice_payments(*), credit_notes:sales_credit_notes(*)",
        )
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId)
        .lte("invoice_date", to),
      this.supabase
        .from("customer_service_invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, net_amount, paid_amount, balance_amount, payment_status, billing_status, payments:customer_service_payments(*)",
        )
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId)
        .lte("invoice_date", to),
    ]);
    if (salesError) throw new BadRequestException(salesError.message);
    if (serviceError) throw new BadRequestException(serviceError.message);

    const transactions: any[] = [];
    const addInvoiceTransactions = (
      invoice: any,
      source: "SALES" | "SERVICE",
    ) => {
      if (String(invoice.billing_status || "").toUpperCase() === "CANCELLED")
        return;
      transactions.push({
        date: invoice.invoice_date,
        source,
        document_type: source === "SALES" ? "Sales Invoice" : "Service Invoice",
        document_number: invoice.invoice_number,
        reference: invoice.invoice_number,
        debit: this.roundMoney(invoice.net_amount),
        credit: 0,
        remarks: `Invoice due ${invoice.due_date || "-"}`,
      });
      for (const payment of invoice.payments || []) {
        if (payment.reversed_at) continue;
        const transactionDate =
          payment.receipt_date || String(payment.created_at || "").slice(0, 10);
        if (!transactionDate || transactionDate > to) continue;
        transactions.push({
          date: transactionDate,
          source,
          document_type: "Customer Receipt",
          document_number: payment.receipt_number,
          reference: payment.payment_reference || invoice.invoice_number,
          debit: 0,
          credit: this.roundMoney(payment.amount),
          remarks: `${payment.payment_method || "Receipt"} against ${invoice.invoice_number}`,
        });
      }
      if (source === "SALES") {
        for (const creditNote of invoice.credit_notes || []) {
          if (String(creditNote.status || "").toUpperCase() !== "POSTED")
            continue;
          const transactionDate =
            creditNote.credit_note_date ||
            String(creditNote.created_at || "").slice(0, 10);
          if (!transactionDate || transactionDate > to) continue;
          transactions.push({
            date: transactionDate,
            source,
            document_type: "Credit Note",
            document_number: creditNote.credit_note_number,
            reference: invoice.invoice_number,
            debit: 0,
            credit: this.roundMoney(creditNote.net_amount),
            remarks:
              creditNote.reason || `Credit against ${invoice.invoice_number}`,
          });
        }
      }
    };
    for (const invoice of salesInvoices || [])
      addInvoiceTransactions(invoice, "SALES");
    for (const invoice of serviceInvoices || [])
      addInvoiceTransactions(invoice, "SERVICE");
    transactions.sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        String(a.document_number).localeCompare(String(b.document_number)),
    );

    const openingBalance = this.roundMoney(
      transactions
        .filter((row) => row.date < from)
        .reduce((sum, row) => sum + row.debit - row.credit, 0),
    );
    let runningBalance = openingBalance;
    const rows = transactions
      .filter((row) => row.date >= from && row.date <= to)
      .map((row) => {
        runningBalance = this.roundMoney(
          runningBalance + row.debit - row.credit,
        );
        return { ...row, balance: runningBalance };
      });
    const totalDebit = this.roundMoney(
      rows.reduce((sum, row) => sum + row.debit, 0),
    );
    const totalCredit = this.roundMoney(
      rows.reduce((sum, row) => sum + row.credit, 0),
    );
    const openInvoices = [
      ...(salesInvoices || []).map((invoice: any) => ({
        ...this.withReceivableAgeing(invoice),
        source: "SALES",
      })),
      ...(serviceInvoices || []).map((invoice: any) => ({
        ...this.withReceivableAgeing(invoice),
        source: "SERVICE",
      })),
    ].filter(
      (invoice: any) =>
        String(invoice.billing_status || "").toUpperCase() !== "CANCELLED" &&
        Number(invoice.balance_amount || 0) > 0,
    );
    const ageing = ["CURRENT", "1-30", "31-60", "61-90", "90+"].map(
      (bucket) => ({
        bucket,
        amount: this.roundMoney(
          openInvoices
            .filter((invoice: any) => invoice.ageing_bucket === bucket)
            .reduce(
              (sum: number, invoice: any) =>
                sum + Number(invoice.balance_amount || 0),
              0,
            ),
        ),
      }),
    );
    const { data: dunningNotices, error: dunningError } = await this.supabase
      .from("customer_dunning_notices")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .order("notice_date", { ascending: false });
    if (dunningError) throw new BadRequestException(dunningError.message);

    return {
      customer,
      period: { from, to },
      opening_balance: openingBalance,
      total_debit: totalDebit,
      total_credit: totalCredit,
      closing_balance: runningBalance,
      current_outstanding: this.roundMoney(
        openInvoices.reduce(
          (sum: number, invoice: any) =>
            sum + Number(invoice.balance_amount || 0),
          0,
        ),
      ),
      ageing,
      open_invoices: openInvoices,
      dunning_notices: dunningNotices || [],
      transactions: rows,
    };
  }

  async renderCustomerAccountStatementPdf(
    req: Request,
    customerId: string,
    period: { from?: string; to?: string } = {},
    preparedStatement?: any,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    if (!this.quotePdfService)
      throw new BadRequestException(
        "Customer statement PDF generator is not configured",
      );
    const statement: any =
      preparedStatement ||
      (await this.getCustomerAccountStatement(req, customerId, period));
    const customer = statement.customer || {};
    const address = [
      customer.billing_address,
      customer.city,
      customer.state,
      customer.pincode,
      customer.country,
    ]
      .filter(Boolean)
      .join(", ");
    const { tenantId } = req.user as any;
    const buffer = await this.quotePdfService.renderAccountStatementPdf(
      tenantId,
      {
        statement_date_iso: new Date().toISOString().slice(0, 10),
        period_from: statement.period.from,
        period_to: statement.period.to,
        company: { name: "SAK ERP" },
        customer: {
          code: customer.customer_code || "-",
          name: customer.customer_name || "Customer",
          address,
          phone: customer.mobile || customer.phone || "",
          email: customer.email || "",
        },
        opening_balance: statement.opening_balance,
        total_debit: statement.total_debit,
        total_credit: statement.total_credit,
        closing_balance: statement.closing_balance,
        current_outstanding: statement.current_outstanding,
        ageing: statement.ageing || [],
        transactions: statement.transactions || [],
        currency: "INR",
      },
    );
    const safeCustomerCode = String(
      customer.customer_code || "CUSTOMER",
    ).replace(/[^A-Za-z0-9_-]/g, "_");
    return {
      buffer,
      fileName: `${safeCustomerCode}_Statement_${statement.period.from}_to_${statement.period.to}.pdf`,
    };
  }

  async sendCustomerAccountStatementEmail(
    req: Request,
    customerId: string,
    body: {
      from?: string;
      to?: string;
      recipient?: string;
      subject?: string;
      message?: string;
    } = {},
  ) {
    const statement: any = await this.getCustomerAccountStatement(
      req,
      customerId,
      { from: body.from, to: body.to },
    );
    const customer = statement.customer || {};
    const recipient = normalizeEmail(body.recipient || customer.email || "");
    if (!recipient)
      throw new BadRequestException(
        "Customer email is required to send the account statement",
      );
    const document = await this.renderCustomerAccountStatementPdf(
      req,
      customerId,
      { from: body.from, to: body.to },
      statement,
    );
    const subject = String(
      body.subject ||
        `Account statement ${statement.period.from} to ${statement.period.to} - ${customer.customer_name || customer.customer_code || "Customer"}`,
    ).trim();
    const message = String(
      body.message ||
        "Please find attached your customer account statement for the selected period.",
    ).trim();
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>Customer Account Statement</h2><p>Dear ${this.escapeSalesHtml(customer.contact_person || customer.customer_name || "Customer")},</p><p>${this.escapeSalesHtml(message)}</p><p><strong>Statement period:</strong> ${this.escapeSalesHtml(statement.period.from)} to ${this.escapeSalesHtml(statement.period.to)}<br><strong>Closing balance:</strong> Rs. ${this.formatSalesMoney(statement.closing_balance)}<br><strong>Current outstanding:</strong> Rs. ${this.formatSalesMoney(statement.current_outstanding)}</p><p>Please contact our Accounts Receivable team if any reconciliation is required.</p></div>`;
    const { tenantId } = req.user as any;
    const result: any = await this.emailService.sendEmail({
      to: recipient,
      subject,
      html,
      from: "sales",
      tenantId,
      attachments: [
        {
          filename: document.fileName,
          content: document.buffer,
          contentType: "application/pdf",
        },
      ],
    });
    return {
      message: `Customer account statement emailed successfully to ${recipient}`,
      recipient,
      message_id: result?.messageId || null,
      period: statement.period,
      file_name: document.fileName,
    };
  }

  async getDunningNotices(req: Request, filters: any = {}) {
    const { tenantId } = req.user as any;
    let query = this.supabase
      .from("customer_dunning_notices")
      .select("*, customer:customers(customer_code, customer_name)")
      .eq("tenant_id", tenantId)
      .order("notice_date", { ascending: false });
    if (filters.customer_id)
      query = query.eq("customer_id", filters.customer_id);
    if (filters.status)
      query = query.eq("status", String(filters.status).toUpperCase());
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async getDunningNoticeById(req: Request, noticeId: string) {
    const { tenantId } = req.user as any;
    const { data, error } = await this.supabase
      .from("customer_dunning_notices")
      .select(
        `
        *,
        customer:customers(
          id, customer_code, customer_name, customer_type, contact_person,
          email, phone, mobile, gst_number, pan_number, billing_address,
          shipping_address, city, state, pincode, country
        )
      `,
      )
      .eq("tenant_id", tenantId)
      .eq("id", noticeId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Dunning notice not found");
    return data;
  }

  async renderDunningNoticePdf(
    req: Request,
    noticeId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    if (!this.quotePdfService)
      throw new BadRequestException(
        "Payment reminder PDF generator is not configured",
      );
    const notice: any = await this.getDunningNoticeById(req, noticeId);
    const customer = notice.customer || {};
    const level = Number(notice.dunning_level || 1);
    const label =
      level === 3
        ? "FINAL PAYMENT NOTICE"
        : level === 2
          ? "URGENT PAYMENT REMINDER"
          : "PAYMENT REMINDER";
    const items = (notice.invoice_snapshot || []).map((invoice: any) => ({
      description: `${invoice.source || "INVOICE"} ${invoice.invoice_number || "-"} | Invoice ${String(invoice.invoice_date || "-").slice(0, 10)} | Due ${String(invoice.due_date || "-").slice(0, 10)} | ${Number(invoice.days_overdue || 0)} day(s) overdue`,
      quantity: 1,
      unit: "INVOICE",
      unit_price: Number(invoice.balance_amount || 0),
    }));
    if (!items.length) {
      items.push({
        description: "Outstanding receivable balance",
        quantity: 1,
        unit: "ACCOUNT",
        unit_price: Number(notice.overdue_amount || 0),
      });
    }
    const notes = [
      `Dunning Level: ${level}`,
      `Customer Code: ${customer.customer_code || "-"}`,
      `Payment Due By: ${String(notice.due_by || "-").slice(0, 10)}`,
      `Overdue Amount: INR ${Number(notice.overdue_amount || 0).toFixed(2)}`,
      `Total Outstanding: INR ${Number(notice.total_outstanding || 0).toFixed(2)}`,
      notice.status === "CANCELLED"
        ? `CANCELLED: ${notice.cancellation_reason || "No reason recorded"}`
        : "",
      notice.notes ? `Remarks: ${notice.notes}` : "",
      "If payment has already been made, please share the remittance reference with Accounts Receivable.",
    ]
      .filter(Boolean)
      .join("\n");
    const address = [
      customer.billing_address,
      customer.city,
      customer.state,
      customer.pincode,
      customer.country,
    ]
      .filter(Boolean)
      .join(", ");
    const { tenantId } = req.user as any;
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      document_label: label,
      quote_number: notice.notice_number,
      quote_date_iso: notice.notice_date,
      title: notice.notice_number,
      company: { name: "SAK ERP" },
      customer: {
        name: customer.customer_name || "Customer",
        address,
        phone: customer.mobile || customer.phone || "",
        email: customer.email || "",
      },
      items,
      currency: "INR",
      tax_rate: 0,
      notes,
    });
    return {
      buffer,
      fileName: `${String(notice.notice_number).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
    };
  }

  async createDunningNotice(req: Request, customerId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const level = Number(body?.dunning_level);
    if (!Number.isInteger(level) || level < 1 || level > 3) {
      throw new BadRequestException("Dunning level must be 1, 2, or 3");
    }
    const noticeDate = new Date().toISOString().slice(0, 10);
    const dueBy = String(body?.due_by || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueBy) || dueBy < noticeDate) {
      throw new BadRequestException(
        "Due-by date must be today or a future date",
      );
    }
    const statement: any = await this.getCustomerAccountStatement(
      req,
      customerId,
      { from: "1900-01-01", to: noticeDate },
    );
    const overdueInvoices = (statement.open_invoices || []).filter(
      (invoice: any) => Number(invoice.days_overdue || 0) > 0,
    );
    const overdueAmount = this.roundMoney(
      overdueInvoices.reduce(
        (sum: number, invoice: any) =>
          sum + Number(invoice.balance_amount || 0),
        0,
      ),
    );
    if (overdueAmount <= 0)
      throw new BadRequestException(
        "This customer has no overdue receivable to include in a dunning notice",
      );

    const { data: recentNotice, error: recentError } = await this.supabase
      .from("customer_dunning_notices")
      .select("notice_number, notice_date")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .eq("dunning_level", level)
      .eq("status", "ISSUED")
      .gte(
        "notice_date",
        new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      )
      .order("notice_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentError) throw new BadRequestException(recentError.message);
    if (recentNotice)
      throw new BadRequestException(
        `Level ${level} notice ${recentNotice.notice_number} was already issued within the last 7 days`,
      );

    const invoiceSnapshot = overdueInvoices.map((invoice: any) => ({
      source: invoice.source,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      days_overdue: invoice.days_overdue,
      balance_amount: this.roundMoney(invoice.balance_amount),
    }));
    const noticeNumber = await this.generateDunningNoticeNumber(tenantId);
    const notes =
      String(body?.notes || "").trim() ||
      `Level ${level} payment reminder for overdue receivables`;
    const { data, error } = await this.supabase
      .from("customer_dunning_notices")
      .insert({
        tenant_id: tenantId,
        notice_number: noticeNumber,
        customer_id: customerId,
        notice_date: noticeDate,
        dunning_level: level,
        due_by: dueBy,
        total_outstanding: statement.current_outstanding,
        overdue_amount: overdueAmount,
        invoice_snapshot: invoiceSnapshot,
        notes,
        status: "ISSUED",
        created_by: userId,
      })
      .select()
      .single();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Dunning notice could not be issued",
      );

    const collectionStatus = level === 1 ? "CONTACTED" : "ESCALATED";
    for (const invoice of overdueInvoices) {
      const table =
        invoice.source === "SERVICE" ? "customer_service_invoices" : "invoices";
      const { error: updateError } = await this.supabase
        .from(table)
        .update({
          collection_status: collectionStatus,
          last_follow_up_at: new Date().toISOString(),
          last_follow_up_by: userId,
          next_follow_up_date: dueBy,
          collection_notes: notes,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", invoice.id);
      if (updateError) {
        await this.supabase
          .from("customer_dunning_notices")
          .update({
            status: "CANCELLED",
            cancelled_at: new Date().toISOString(),
            cancelled_by: userId,
            cancellation_reason: `System rollback: ${invoice.invoice_number} collection update failed`,
          })
          .eq("tenant_id", tenantId)
          .eq("id", data.id);
        throw new BadRequestException(
          `Dunning posting was rolled back because ${invoice.invoice_number} could not be updated: ${updateError.message}`,
        );
      }
    }
    return {
      ...data,
      customer: statement.customer,
      message: `Dunning notice ${noticeNumber} issued for ${overdueInvoices.length} overdue invoice(s)`,
    };
  }

  async cancelDunningNotice(req: Request, noticeId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const reason = String(body?.reason || "").trim();
    if (!reason)
      throw new BadRequestException("Cancellation reason is required");
    const { data, error } = await this.supabase
      .from("customer_dunning_notices")
      .update({
        status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId,
        cancellation_reason: reason,
      })
      .eq("tenant_id", tenantId)
      .eq("id", noticeId)
      .eq("status", "ISSUED")
      .select()
      .single();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Only an issued dunning notice can be cancelled",
      );
    return {
      ...data,
      message: `Dunning notice ${data.notice_number} cancelled`,
    };
  }

  private async calculateCustomerCreditExposure(
    tenantId: string,
    customerId: string,
    proposedAmount = 0,
  ) {
    const [
      { data: customer, error: customerError },
      { data: invoices, error: invoiceError },
      { data: orders, error: orderError },
    ] = await Promise.all([
      this.supabase
        .from("customers")
        .select("id, customer_name, credit_limit, credit_days")
        .eq("tenant_id", tenantId)
        .eq("id", customerId)
        .single(),
      this.supabase
        .from("invoices")
        .select("balance_amount, billing_status")
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId),
      this.supabase
        .from("sales_orders")
        .select("balance_amount, status")
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId),
    ]);
    if (customerError || !customer)
      throw new NotFoundException("Customer not found");
    if (invoiceError) throw new BadRequestException(invoiceError.message);
    if (orderError) throw new BadRequestException(orderError.message);

    const openReceivables = this.roundMoney(
      (invoices || [])
        .filter(
          (invoice: any) =>
            String(invoice.billing_status || "").toUpperCase() !== "CANCELLED",
        )
        .reduce(
          (total: number, invoice: any) =>
            total + Number(invoice.balance_amount || 0),
          0,
        ),
    );
    const commitmentStatuses = new Set([
      "CONFIRMED",
      "READY_TO_DISPATCH",
      "DISPATCHED",
      "PARTIAL",
    ]);
    const openCommitments = this.roundMoney(
      (orders || [])
        .filter((order: any) =>
          commitmentStatuses.has(String(order.status || "").toUpperCase()),
        )
        .reduce(
          (total: number, order: any) =>
            total + Number(order.balance_amount || 0),
          0,
        ),
    );
    const creditLimit = this.roundMoney(customer.credit_limit || 0);
    const proposed = this.roundMoney(proposedAmount || 0);
    const currentExposure = this.roundMoney(openReceivables + openCommitments);
    const projectedExposure = this.roundMoney(currentExposure + proposed);

    return {
      customer_id: customer.id,
      customer_name: customer.customer_name,
      credit_limit: creditLimit,
      credit_days: Number(customer.credit_days || 0),
      credit_control_enabled: creditLimit > 0,
      open_receivables: openReceivables,
      open_order_commitments: openCommitments,
      current_exposure: currentExposure,
      proposed_exposure: proposed,
      projected_exposure: projectedExposure,
      available_credit: this.roundMoney(creditLimit - currentExposure),
      within_limit: creditLimit <= 0 || projectedExposure <= creditLimit + 0.01,
    };
  }

  async createDirectSalesOrder(req: Request, soData: any) {
    const { tenantId, userId } = req.user as any;
    const regional = await this.getTenantRegionalDefaults(tenantId);

    // Validate required fields
    if (!soData.customer_id) {
      throw new BadRequestException("Customer is required");
    }

    if (!soData.items || soData.items.length === 0) {
      throw new BadRequestException("At least one item is required");
    }

    // Prices are entered per selected sales UOM, so this guard is valid before
    // converting the entered quantity to the base stock quantity.
    const requestedAdvance = Number(soData.advance_amount || 0);
    const enteredOrderCeiling = (soData.items || []).reduce(
      (sum: number, line: any) => {
        const orderedUom = this.normalizeCommercialUom(
          line.ordered_uom || line.uom || "PCS",
        );
        const priceUom = this.normalizeCommercialUom(
          line.price_uom || orderedUom,
        );
        if (priceUom !== orderedUom) return Number.POSITIVE_INFINITY;
        const qty = Number(line.sales_quantity ?? line.quantity ?? 0);
        const rate = Number(line.unit_price || 0);
        const discount = Number(line.discount_percentage || 0);
        const tax = Number(line.tax_percentage ?? regional.defaultTaxRate);
        const taxable = qty * rate * (1 - discount / 100);
        return sum + taxable * (1 + tax / 100);
      },
      0,
    );
    if (requestedAdvance > enteredOrderCeiling) {
      throw new BadRequestException(
        "Advance amount cannot exceed sales order net amount",
      );
    }

    // Calculate totals
    const commercialItems = await this.resolveCommercialSalesQuantities(
      tenantId,
      soData.items || [],
    );
    const { preparedItems, totalAmount, taxAmount } =
      this.prepareSalesOrderItems(commercialItems, regional.defaultTaxRate);

    const discountAmount = Number(soData.discount_amount || 0);
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      throw new BadRequestException("Sales order discount cannot be negative");
    }
    if (discountAmount > totalAmount + taxAmount) {
      throw new BadRequestException(
        "Sales order discount cannot exceed order value",
      );
    }
    const netAmount = totalAmount + taxAmount - discountAmount;
    const advanceAmount = Number(soData.advance_amount || 0);
    if (!Number.isFinite(advanceAmount) || advanceAmount < 0) {
      throw new BadRequestException("Advance amount cannot be negative");
    }
    if (advanceAmount > netAmount) {
      throw new BadRequestException(
        "Advance amount cannot exceed sales order net amount",
      );
    }
    const balanceAmount = netAmount - advanceAmount;

    const { data: customer, error: customerError } = await this.supabase
      .from("customers")
      .select("id, customer_name, is_active, sales_blocked, block_reason")
      .eq("tenant_id", tenantId)
      .eq("id", soData.customer_id)
      .single();
    if (customerError || !customer)
      throw new NotFoundException("Customer not found");
    if (!customer.is_active)
      throw new BadRequestException(
        "Customer is inactive and cannot receive a sales order",
      );
    if (customer.sales_blocked) {
      throw new BadRequestException(
        `Customer is blocked for sales${customer.block_reason ? `: ${customer.block_reason}` : ""}`,
      );
    }

    await this.assertCustomerCreditAvailable(
      tenantId,
      soData.customer_id,
      balanceAmount,
    );

    // Generate the document number only after all commercial controls have passed.
    const soNumber = await this.generateSONumber(req);

    // Create sales order
    const salesOrder = {
      tenant_id: tenantId,
      so_number: soNumber,
      quotation_id: null, // Direct order, no quotation
      customer_id: soData.customer_id,
      order_date: soData.order_date || new Date().toISOString().split("T")[0],
      expected_delivery_date: soData.expected_delivery_date || null,
      status: "CONFIRMED",
      total_amount: totalAmount,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      net_amount: netAmount,
      advance_paid: advanceAmount,
      balance_amount: balanceAmount,
      payment_terms: soData.payment_terms || null,
      delivery_terms: soData.delivery_terms || null,
      billing_address: soData.billing_address || null,
      shipping_address: soData.shipping_address || null,
      notes: soData.notes || null,
      project: soData.project || null, // Project field
      is_direct_order: true,
      source_type: soData.source_type || "DIRECT",
      customer_po_number:
        String(soData.customer_po_number || "").trim() || null,
      customer_po_date: soData.customer_po_date || null,
      currency_code: String(soData.currency_code || regional.currency)
        .trim()
        .toUpperCase(),
      place_of_supply: String(soData.place_of_supply || "").trim() || null,
      incoterm:
        String(soData.incoterm || "")
          .trim()
          .toUpperCase() || null,
      release_status: "PENDING",
      credit_status: "CLEAR",
      release_requested_at: new Date().toISOString(),
      release_requested_by: userId,
      availability_status: "NOT_CHECKED",
      delivery_block: false,
      billing_block: false,
      created_by: userId,
    };

    const { data: soRecord, error: soError } = await this.supabase
      .from("sales_orders")
      .insert(salesOrder)
      .select()
      .single();

    if (soError) throw new BadRequestException(soError.message);

    // Insert sales order items
    const soItems = preparedItems.map((item: any) => ({
      sales_order_id: soRecord.id,
      item_id: item.item_id,
      item_description: item.item_description,
      quantity: item.quantity,
      sales_quantity: item.sales_quantity,
      base_uom: item.base_uom,
      uom_conversion_factor: item.uom_conversion_factor,
      price_uom: item.price_uom,
      price_uom_factor: item.price_uom_factor,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount || 0,
      tax_percentage: item.tax_percentage ?? regional.defaultTaxRate,
      tax_amount: item.tax_amount,
      line_total: item.line_total,
      ordered_uom: item.ordered_uom || "NOS",
      hsn_code: item.hsn_code || null,
      promised_date:
        item.promised_date || soData.expected_delivery_date || null,
      notes: item.notes || null,
    }));

    const { error: itemsError } = await this.supabase
      .from("sales_order_items")
      .insert(soItems);

    if (itemsError) throw new BadRequestException(itemsError.message);

    await this.recordSalesEvent(
      tenantId,
      soRecord.id,
      "SALES_ORDER",
      soRecord.id,
      soRecord.so_number,
      "DIRECT_ORDER_CREATED",
      userId,
    );
    return soRecord;
  }

  private prepareSalesOrderItems(items: any[], defaultTaxRate = 18) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException(
        "Sales order must include at least one item",
      );
    }

    let totalAmount = 0;
    let taxAmount = 0;

    const preparedItems = items.map((item: any, index: number) => {
      if (!item.item_id) {
        throw new BadRequestException(
          `Sales order item ${index + 1} is missing item selection`,
        );
      }

      const quantity = Number(item.quantity);
      const salesQuantity = Number(item.sales_quantity ?? item.quantity);
      const unitPrice = Number(item.unit_price);
      const discountPercentage = Number(item.discount_percentage || 0);
      const taxPercentage =
        item.tax_percentage !== undefined
          ? Number(item.tax_percentage)
          : defaultTaxRate;

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(
          `Sales order item ${index + 1} quantity must be greater than 0`,
        );
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new BadRequestException(
          `Sales order item ${index + 1} unit price cannot be negative`,
        );
      }
      if (
        !Number.isFinite(discountPercentage) ||
        discountPercentage < 0 ||
        discountPercentage > 100
      ) {
        throw new BadRequestException(
          `Sales order item ${index + 1} discount percentage must be between 0 and 100`,
        );
      }
      if (!Number.isFinite(taxPercentage) || taxPercentage < 0) {
        throw new BadRequestException(
          `Sales order item ${index + 1} tax percentage cannot be negative`,
        );
      }

      const pricingQuantity = Number(item.pricing_quantity ?? salesQuantity);
      const subtotal = pricingQuantity * unitPrice;
      const discountAmount = (subtotal * discountPercentage) / 100;
      const taxableAmount = subtotal - discountAmount;
      const itemTaxAmount = (taxableAmount * taxPercentage) / 100;
      const lineTotal = subtotal - discountAmount;

      totalAmount += lineTotal;
      taxAmount += itemTaxAmount;

      return {
        item_id: item.item_id,
        item_description: item.item_description,
        quantity,
        sales_quantity: salesQuantity,
        base_uom: item.base_uom || item.ordered_uom || "PCS",
        uom_conversion_factor: Number(item.uom_conversion_factor || 1),
        price_uom: item.price_uom || item.ordered_uom || "PCS",
        price_uom_factor: Number(item.price_uom_factor || 1),
        unit_price: unitPrice,
        discount_amount: discountAmount,
        tax_percentage: taxPercentage,
        tax_amount: itemTaxAmount,
        line_total: lineTotal,
        ordered_uom: String(item.ordered_uom || item.uom || "NOS")
          .trim()
          .toUpperCase(),
        hsn_code: String(item.hsn_code || "").trim() || null,
        promised_date: item.promised_date || null,
        notes: item.notes || null,
      };
    });

    return { preparedItems, totalAmount, taxAmount };
  }

  async getSalesOrderById(req: Request, soId: string) {
    const { tenantId } = req.user as any;

    const { data, error } = await this.supabase
      .from("sales_orders")
      .select(
        `
        *,
        customers:customer_id(id, customer_code, customer_name, contact_person, email, phone, mobile, billing_address, shipping_address, city, state, pincode, gst_number),
        sales_order_items(*)
      `,
      )
      .eq("id", soId)
      .eq("tenant_id", tenantId)
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async renderSalesOrderPdf(req: Request, soId: string) {
    if (!this.quotePdfService)
      throw new BadRequestException("Sales PDF service is unavailable");
    const order: any = await this.getSalesOrderById(req, soId);
    const tenantId = (req.user as any).tenantId;
    const lines = order.sales_order_items || [];
    const taxable = lines.reduce(
      (sum: number, line: any) => sum + Number(line.line_total || 0),
      0,
    );
    const tax = lines.reduce(
      (sum: number, line: any) => sum + Number(line.tax_amount || 0),
      0,
    );
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      quote_number: order.so_number,
      quote_date_iso: String(
        order.order_date || order.created_at || new Date().toISOString(),
      ),
      title: String(order.status || "OPEN").replaceAll("_", " "),
      document_label: "SALES ORDER",
      company: { name: "SAK ERP" },
      customer: this.pdfCustomer(order.customers),
      items: this.buildPdfItems(lines),
      currency: order.currency_code || "INR",
      tax_rate: taxable > 0 ? tax / taxable : 0,
      discount: Number(order.discount_amount || 0),
      notes: [
        order.customer_po_number
          ? `Customer PO: ${order.customer_po_number}`
          : "",
        order.project ? `Project: ${order.project}` : "",
        order.notes || order.special_instructions || "",
      ]
        .filter(Boolean)
        .join("\n"),
      terms: [
        order.payment_terms ? `Payment: ${order.payment_terms}` : "",
        order.delivery_terms ? `Delivery: ${order.delivery_terms}` : "",
        order.incoterm ? `Incoterm: ${order.incoterm}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { buffer, filename: this.pdfFilename(order.so_number) };
  }

  private normalizeCustomerContacts(
    customerData: any,
    marketProfile: unknown = "INDIA",
  ) {
    const source = Array.isArray(customerData.contacts)
      ? customerData.contacts
      : [
          {
            name: customerData.contact_person,
            mobile: customerData.mobile || customerData.phone,
            email: customerData.email,
          },
        ];

    return source
      .map((contact: any) => ({
        name: contact?.name
          ? normalizePersonName(contact.name, "Customer contact person")
          : "",
        mobile: contact?.mobile
          ? normalizeRegionalPhone(contact.mobile, marketProfile)
          : "",
        email: contact?.email ? normalizeEmail(contact.email) : "",
      }))
      .filter(
        (contact: any) => contact.name || contact.mobile || contact.email,
      );
  }

  private async getTenantRegionalDefaults(
    tenantId: string,
  ): Promise<RegionalDefaults> {
    const { data, error } = await this.supabase
      .from("tenants")
      .select("market_profile")
      .eq("id", tenantId)
      .single();
    if (error || !data?.market_profile) {
      // Legacy tenants predate the market-profile field. Keep commercial flows
      // operable with the established India defaults while the tenant is backfilled.
      console.warn(
        "[SalesService] tenant regional settings unavailable; defaulting to INDIA",
        {
          tenantId,
          error: error?.message,
        },
      );
      return regionalDefaults("INDIA");
    }
    return regionalDefaults(data.market_profile);
  }

  private normalizeCustomerAddresses(
    addresses: unknown,
    fallback: unknown,
  ): string[] {
    const source = Array.isArray(addresses) ? addresses : [fallback];
    return source
      .map((address) => toTitleCase(String(address || "").trim()))
      .filter(Boolean);
  }

  async getSalesOrderAvailability(req: Request, soId: string) {
    const { tenantId } = req.user as any;
    const order: any = await this.getSalesOrderById(req, soId);
    const itemIds = [
      ...new Set<string>(
        (order.sales_order_items || [])
          .map((line: any) => line.item_id)
          .filter(Boolean),
      ),
    ];
    const stockResult: any = itemIds.length
      ? await this.supabase
          .from("inventory_stock")
          .select("id, item_id, warehouse_id, quantity, available_quantity")
          .eq("tenant_id", tenantId)
          .in("item_id", itemIds)
          .gt("available_quantity", 0)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (stockResult.error)
      throw new BadRequestException(stockResult.error.message);
    const lines = allocateSalesAtpLines(
      order.sales_order_items || [],
      stockResult.data || [],
    );
    const status = lines.every((line: any) => line.status === "FULLY_CONFIRMED")
      ? "FULLY_CONFIRMED"
      : lines.some((line: any) => line.confirmed_quantity > 0)
        ? "PARTIALLY_CONFIRMED"
        : "NOT_AVAILABLE";
    return { sales_order_id: soId, so_number: order.so_number, status, lines };
  }

  async releaseSalesOrder(req: Request, soId: string, body: any = {}) {
    const { tenantId, userId } = req.user as any;
    const order: any = await this.getSalesOrderById(req, soId);
    if (
      !hasSuperAdminBypass((req as any).user) &&
      order.created_by === userId
    ) {
      throw new ForbiddenException(
        "Creator cannot release their own sales order",
      );
    }
    if (
      ["CANCELLED", "COMPLETED", "DELIVERED"].includes(String(order.status))
    ) {
      throw new BadRequestException(
        `Sales order in ${order.status} status cannot be released`,
      );
    }
    if (order.release_status === "RELEASED")
      throw new BadRequestException(
        "Sales order is already commercially released",
      );
    const exposure: any = await this.getCustomerCreditExposure(
      req,
      order.customer_id,
      0,
    );
    if (!exposure.within_limit) {
      await this.supabase
        .from("sales_orders")
        .update({
          credit_status: "BLOCKED",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", soId);
      throw new BadRequestException(
        `Credit release failed. Exposure exceeds the customer limit by Rs. ${Math.abs(exposure.available_credit).toFixed(2)}`,
      );
    }
    const availability: any = await this.getSalesOrderAvailability(req, soId);
    const checkedAt = new Date().toISOString();
    const allocations = availability.lines.flatMap(
      (line: any) => line.allocations || [],
    );
    const reservationResult = await this.supabase.rpc(
      "reserve_sales_order_atp",
      {
        p_tenant_id: tenantId,
        p_sales_order_id: soId,
        p_sales_order_number: order.so_number,
        p_reserved_by: userId,
        p_allocations: allocations,
      },
    );
    if (reservationResult.error) {
      throw new BadRequestException(
        reservationResult.error.message ||
          "ATP reservation changed during release",
      );
    }
    let data: any = null;
    try {
      for (const line of availability.lines) {
        const { error: lineError } = await this.supabase
          .from("sales_order_items")
          .update({
            confirmed_quantity: line.confirmed_quantity,
            confirmation_status: line.status,
            available_quantity_snapshot: line.available_quantity,
            confirmed_at: checkedAt,
          })
          .eq("sales_order_id", soId)
          .eq("id", line.sales_order_item_id);
        if (lineError) throw new BadRequestException(lineError.message);
      }
      const updateResult = await this.supabase
        .from("sales_orders")
        .update({
          release_status: "RELEASED",
          credit_status: "CLEAR",
          availability_status: availability.status,
          availability_checked_at: checkedAt,
          released_at: checkedAt,
          released_by: userId,
          release_remarks: String(body?.remarks || "").trim() || null,
          updated_at: checkedAt,
        })
        .eq("tenant_id", tenantId)
        .eq("id", soId)
        .eq("release_status", "PENDING")
        .select()
        .maybeSingle();
      if (updateResult.error || !updateResult.data)
        throw new BadRequestException(
          updateResult.error?.message ||
            "Sales-order release changed concurrently",
        );
      data = updateResult.data;
    } catch (releaseError) {
      const rollback = await this.supabase.rpc("release_sales_order_atp", {
        p_tenant_id: tenantId,
        p_sales_order_id: soId,
      });
      if (rollback.error)
        console.error(
          "[Sales ATP] Reservation compensation failed:",
          rollback.error.message,
        );
      throw releaseError;
    }
    availability.reservation = reservationResult.data;
    await this.recordSalesEvent(
      tenantId,
      soId,
      "SALES_ORDER",
      soId,
      order.so_number,
      "COMMERCIAL_RELEASE",
      userId,
      body?.remarks,
      availability,
    );
    return { ...data, availability };
  }

  async updateSalesOrderBlocks(req: Request, soId: string, body: any = {}) {
    const { tenantId, userId } = req.user as any;
    const { data: order, error: fetchError } = await this.supabase
      .from("sales_orders")
      .select(
        "id, so_number, status, delivery_block, billing_block, block_reason",
      )
      .eq("tenant_id", tenantId)
      .eq("id", soId)
      .single();
    if (fetchError || !order)
      throw new NotFoundException("Sales order not found");
    if (
      ["CANCELLED", "COMPLETED"].includes(
        String(order.status || "").toUpperCase(),
      )
    ) {
      throw new BadRequestException(
        `Sales order in ${order.status} status cannot be blocked or unblocked`,
      );
    }
    if (!("delivery_block" in body) && !("billing_block" in body)) {
      throw new BadRequestException(
        "Specify a delivery block or billing block decision",
      );
    }

    const deliveryBlock =
      "delivery_block" in body
        ? Boolean(body.delivery_block)
        : Boolean(order.delivery_block);
    const billingBlock =
      "billing_block" in body
        ? Boolean(body.billing_block)
        : Boolean(order.billing_block);
    const reason = String(body.block_reason || "").trim();
    if ((deliveryBlock || billingBlock) && !reason) {
      throw new BadRequestException(
        "A reason is required when applying a sales-order block",
      );
    }

    const changedAt = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("sales_orders")
      .update({
        delivery_block: deliveryBlock,
        billing_block: billingBlock,
        block_reason: deliveryBlock || billingBlock ? reason : null,
        updated_at: changedAt,
      })
      .eq("tenant_id", tenantId)
      .eq("id", soId)
      .select()
      .single();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Sales-order block update failed",
      );

    await this.recordSalesEvent(
      tenantId,
      soId,
      "SALES_ORDER",
      soId,
      order.so_number,
      "ORDER_BLOCK_CONTROL",
      userId,
      reason || "Operational block cleared",
      {
        delivery_block: deliveryBlock,
        billing_block: billingBlock,
        changed_at: changedAt,
      },
    );
    return data;
  }

  async updateSalesOrder(req: Request, soId: string, soData: any) {
    const { tenantId } = req.user as any;

    const { data: existing, error: fetchError } = await this.supabase
      .from("sales_orders")
      .select("*, sales_order_items(*)")
      .eq("id", soId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing)
      throw new NotFoundException("Sales order not found");

    if (existing.release_status === "RELEASED") {
      throw new BadRequestException(
        "Sales order cannot be edited after commercial release; cancel it or create a controlled replacement order",
      );
    }

    const { count: postedDispatchCount, error: dispatchCheckError } =
      await this.supabase
        .from("dispatch_notes")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("sales_order_id", soId)
        .neq("status", "CANCELLED");
    if (dispatchCheckError)
      throw new BadRequestException(dispatchCheckError.message);
    if ((postedDispatchCount || 0) > 0) {
      throw new BadRequestException(
        "Sales order cannot be edited after goods issue; use the document flow and controlled reversal instead",
      );
    }

    const updatePayload: any = { updated_at: new Date().toISOString() };
    const nullableTextFields = [
      "payment_terms",
      "delivery_terms",
      "notes",
      "customer_po_number",
      "place_of_supply",
      "incoterm",
      "block_reason",
    ];
    if ("expected_delivery_date" in soData)
      updatePayload.expected_delivery_date =
        soData.expected_delivery_date || null;
    if ("customer_po_date" in soData)
      updatePayload.customer_po_date = soData.customer_po_date || null;
    for (const field of nullableTextFields) {
      if (field in soData)
        updatePayload[field] = String(soData[field] || "").trim() || null;
    }
    if ("currency_code" in soData)
      updatePayload.currency_code = String(soData.currency_code || "INR")
        .trim()
        .toUpperCase();
    if (updatePayload.incoterm)
      updatePayload.incoterm = updatePayload.incoterm.toUpperCase();
    if ("delivery_block" in soData)
      updatePayload.delivery_block = Boolean(soData.delivery_block);
    if ("billing_block" in soData)
      updatePayload.billing_block = Boolean(soData.billing_block);

    const allowedStatuses = new Set([
      "CONFIRMED",
      "IN_PRODUCTION",
      "READY_TO_DISPATCH",
      "CANCELLED",
    ]);
    if (soData.status && !allowedStatuses.has(String(soData.status))) {
      throw new BadRequestException(
        "Sales-order status can only follow the controlled pre-dispatch lifecycle",
      );
    }
    if (soData.status) updatePayload.status = soData.status;

    let replacementItems: any[] | null = null;
    if (Array.isArray(soData.items)) {
      const commercialItems = await this.resolveCommercialSalesQuantities(
        tenantId,
        soData.items,
      );
      const { preparedItems, totalAmount, taxAmount } =
        this.prepareSalesOrderItems(commercialItems);
      const discountAmount = Number(
        soData.discount_amount ?? existing.discount_amount ?? 0,
      );
      if (
        !Number.isFinite(discountAmount) ||
        discountAmount < 0 ||
        discountAmount > totalAmount + taxAmount
      ) {
        throw new BadRequestException("Sales-order header discount is invalid");
      }
      const netAmount = this.roundMoney(
        totalAmount + taxAmount - discountAmount,
      );
      const advancePaid = this.roundMoney(existing.advance_paid || 0);
      if (advancePaid > netAmount)
        throw new BadRequestException(
          "Edited order value cannot be below the recorded advance",
        );
      updatePayload.total_amount = this.roundMoney(totalAmount);
      updatePayload.tax_amount = this.roundMoney(taxAmount);
      updatePayload.discount_amount = this.roundMoney(discountAmount);
      updatePayload.net_amount = netAmount;
      updatePayload.balance_amount = this.roundMoney(netAmount - advancePaid);
      replacementItems = preparedItems.map((item: any) => ({
        sales_order_id: soId,
        item_id: item.item_id,
        item_description: item.item_description,
        quantity: item.quantity,
        sales_quantity: item.sales_quantity,
        base_uom: item.base_uom,
        uom_conversion_factor: item.uom_conversion_factor,
        price_uom: item.price_uom,
        price_uom_factor: item.price_uom_factor,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        tax_percentage: item.tax_percentage,
        tax_amount: item.tax_amount,
        line_total: item.line_total,
        ordered_uom: item.ordered_uom || "NOS",
        hsn_code: item.hsn_code || null,
        promised_date:
          item.promised_date || soData.expected_delivery_date || null,
        notes: item.notes || null,
      }));
    }

    const originalItems = (existing.sales_order_items || []).map(
      (item: any) => ({
        sales_order_id: soId,
        item_id: item.item_id,
        item_description: item.item_description,
        quantity: item.quantity,
        sales_quantity: item.sales_quantity ?? item.quantity,
        base_uom: item.base_uom || item.ordered_uom || "PCS",
        uom_conversion_factor: Number(item.uom_conversion_factor || 1),
        price_uom: item.price_uom || item.ordered_uom || "PCS",
        price_uom_factor: Number(item.price_uom_factor || 1),
        dispatched_quantity: item.dispatched_quantity || 0,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount || 0,
        tax_percentage: item.tax_percentage || 0,
        tax_amount: item.tax_amount || 0,
        line_total: item.line_total,
        ordered_uom: item.ordered_uom || "NOS",
        hsn_code: item.hsn_code || null,
        promised_date: item.promised_date || null,
        production_order_id: item.production_order_id || null,
        notes: item.notes || null,
      }),
    );

    if (replacementItems) {
      const { error: deleteItemsError } = await this.supabase
        .from("sales_order_items")
        .delete()
        .eq("sales_order_id", soId);
      if (deleteItemsError)
        throw new BadRequestException(deleteItemsError.message);
      const { error: insertItemsError } = await this.supabase
        .from("sales_order_items")
        .insert(replacementItems);
      if (insertItemsError) {
        if (originalItems.length)
          await this.supabase.from("sales_order_items").insert(originalItems);
        throw new BadRequestException(
          `Sales-order lines were not changed: ${insertItemsError.message}`,
        );
      }
    }

    const { data, error } = await this.supabase
      .from("sales_orders")
      .update(updatePayload)
      .eq("id", soId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) {
      if (replacementItems) {
        await this.supabase
          .from("sales_order_items")
          .delete()
          .eq("sales_order_id", soId);
        if (originalItems.length)
          await this.supabase.from("sales_order_items").insert(originalItems);
      }
      throw new BadRequestException(error.message);
    }
    return this.getSalesOrderById(req, data.id);
  }

  async deleteSalesOrder(req: Request, soId: string) {
    const { tenantId, userId } = req.user as any;

    const { data: existing, error: fetchError } = await this.supabase
      .from("sales_orders")
      .select("id")
      .eq("id", soId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing)
      throw new NotFoundException("Sales order not found");

    const { data: dispatchExists, error: dispatchError } = await this.supabase
      .from("dispatch_notes")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("sales_order_id", soId)
      .limit(1);

    if (dispatchError) throw new BadRequestException(dispatchError.message);
    if (dispatchExists && dispatchExists.length > 0) {
      throw new BadRequestException(
        "Cannot delete sales order with dispatch notes",
      );
    }

    const { error } = await this.supabase
      .from("sales_orders")
      .update({
        status: "CANCELLED",
        release_status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId,
        cancellation_reason:
          "Cancelled by an authorized user before goods issue",
        updated_at: new Date().toISOString(),
      })
      .eq("id", soId)
      .eq("tenant_id", tenantId);

    if (error) throw new BadRequestException(error.message);
    const releaseResult = await this.supabase.rpc("release_sales_order_atp", {
      p_tenant_id: tenantId,
      p_sales_order_id: soId,
    });
    if (releaseResult.error) {
      throw new BadRequestException(
        `Sales order was cancelled but its ATP reservation could not be released: ${releaseResult.error.message}`,
      );
    }
    return {
      message: "Sales order cancelled; document and item history retained",
    };
  }

  async sendSalesOrderEmail(req: Request, soId: string) {
    const { tenantId } = req.user as any;

    const { data: so, error } = await this.supabase
      .from("sales_orders")
      .select(
        `
        *,
        customers:customer_id(
          id,
          customer_name,
          contact_person,
          email,
          contact_email,
          shipping_address,
          billing_address
        ),
        sales_order_items(*)
      `,
      )
      .eq("id", soId)
      .eq("tenant_id", tenantId)
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!so) throw new NotFoundException("Sales order not found");

    const customer = (so as any).customers;
    const toEmail = customer?.contact_email || customer?.email;
    if (!toEmail) {
      throw new BadRequestException(
        "Customer email not found for this sales order",
      );
    }

    const soItems = Array.isArray((so as any).sales_order_items)
      ? (so as any).sales_order_items
      : [];

    const itemIds = Array.from(
      new Set(
        soItems
          .map((i: any) => i?.item_id)
          .filter((id: any) => typeof id === "string" && id.length > 0),
      ),
    );

    const itemMetaById = new Map<string, { code?: string; name?: string }>();
    if (itemIds.length > 0) {
      const { data: itemsData, error: itemsError } = await this.supabase
        .from("items")
        .select("id, code, name")
        .in("id", itemIds)
        .eq("tenant_id", tenantId);

      if (!itemsError && Array.isArray(itemsData)) {
        for (const item of itemsData as any[]) {
          if (item?.id)
            itemMetaById.set(item.id, { code: item.code, name: item.name });
        }
      }
    }

    const emailItems = soItems.map((item: any) => {
      const quantity = Number(item?.quantity) || 0;
      const unitPrice = Number(item?.unit_price) || 0;
      const amount =
        item?.line_total !== undefined && item?.line_total !== null
          ? Number(item.line_total) || 0
          : quantity * unitPrice;

      const meta = item?.item_id ? itemMetaById.get(item.item_id) : undefined;
      const metaName = meta?.name
        ? `${meta.code ? `${meta.code} - ` : ""}${meta.name}`
        : "";
      const itemName = metaName || item?.item_description || "Item";

      return {
        item_name: itemName,
        quantity,
        unit_price: unitPrice,
        amount,
      };
    });

    const totalAmount = Number(
      (so as any).net_amount ??
        (so as any).total_amount ??
        emailItems.reduce(
          (sum: number, i: any) => sum + (Number(i.amount) || 0),
          0,
        ),
    );

    const pdf = this.quotePdfService
      ? await this.renderSalesOrderPdf(req, soId)
      : null;
    const soData = {
      tenant_id: tenantId,
      so_number: (so as any).so_number,
      customer_name: customer?.customer_name || "",
      order_date: (so as any).order_date,
      delivery_date:
        (so as any).expected_delivery_date || (so as any).delivery_date,
      payment_terms: (so as any).payment_terms,
      shipping_address:
        (so as any).shipping_address ||
        customer?.shipping_address ||
        customer?.billing_address,
      total_amount: totalAmount,
      items: emailItems,
      attachments: pdf
        ? [
            {
              filename: pdf.filename,
              content: pdf.buffer,
              contentType: "application/pdf",
            },
          ]
        : [],
    };

    await this.emailService.sendSO(toEmail, soData);

    return {
      message: "Sales order email sent successfully",
      to: toEmail,
    };
  }

  private async generateSONumber(req: Request): Promise<string> {
    const sequence = await this.nextDocumentSequence("SALES_ORDER");
    return `SO-${String(sequence).padStart(6, "0")}`;
  }

  // ==================== FULFILMENT / PICK-PACK ====================

  async getFulfilmentTasks(req: Request, filters: any = {}) {
    const { tenantId } = req.user as any;
    let query = this.supabase
      .from("sales_fulfilment_tasks")
      .select(
        "*, items:sales_fulfilment_task_items(*), sales_order:sales_orders(id, so_number, status, release_status, customer_id, customer:customers(id, customer_code, customer_name)), warehouse:warehouses(id, code, name)",
      )
      .eq("tenant_id", tenantId);
    if (filters?.status)
      query = query.eq("status", String(filters.status).toUpperCase());
    if (filters?.sales_order_id)
      query = query.eq("sales_order_id", filters.sales_order_id);
    const { data, error } = await query
      .order("planned_dispatch_date")
      .order("created_at");
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createFulfilmentTask(req: Request, body: any) {
    const { tenantId, userId } = req.user as any;
    const salesOrderId = String(body?.sales_order_id || "").trim();
    const requestedLines = Array.isArray(body?.items) ? body.items : [];
    if (!salesOrderId)
      throw new BadRequestException("Select a released sales order");
    if (!body?.planned_dispatch_date)
      throw new BadRequestException("Planned dispatch date is required");
    if (requestedLines.length === 0)
      throw new BadRequestException(
        "Select at least one sales-order line for fulfilment",
      );

    const { data: order, error: orderError } = await this.supabase
      .from("sales_orders")
      .select(
        "id, so_number, status, release_status, credit_status, delivery_block, block_reason, sales_order_items(id, item_id, item_description, quantity, dispatched_quantity)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", salesOrderId)
      .maybeSingle();
    if (orderError) throw new BadRequestException(orderError.message);
    if (!order) throw new NotFoundException("Sales order not found");
    if (String(order.release_status || "") !== "RELEASED")
      throw new BadRequestException(
        "Release the sales order before planning fulfilment",
      );
    if (String(order.credit_status || "CLEAR") !== "CLEAR")
      throw new BadRequestException("Sales order is credit blocked");
    if (order.delivery_block)
      throw new BadRequestException(
        `Delivery is blocked${order.block_reason ? `: ${order.block_reason}` : ""}`,
      );
    if (
      ["CANCELLED", "COMPLETED", "DELIVERED"].includes(
        String(order.status || ""),
      )
    ) {
      throw new BadRequestException(
        `A ${String(order.status).toLowerCase()} sales order cannot be planned`,
      );
    }

    const orderLines = new Map(
      ((order as any).sales_order_items || []).map((line: any) => [
        String(line.id),
        line,
      ]),
    );
    const { data: activeTasks, error: activeTasksError } = await this.supabase
      .from("sales_fulfilment_tasks")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("sales_order_id", salesOrderId)
      .not("status", "in", "(CANCELLED,DISPATCHED)");
    if (activeTasksError)
      throw new BadRequestException(activeTasksError.message);
    const activeTaskIds = (activeTasks || []).map((task: any) => task.id);
    const plannedByLine = new Map<string, number>();
    if (activeTaskIds.length > 0) {
      const { data: activeLines, error: activeLinesError } = await this.supabase
        .from("sales_fulfilment_task_items")
        .select("sales_order_item_id, planned_quantity")
        .in("task_id", activeTaskIds);
      if (activeLinesError)
        throw new BadRequestException(activeLinesError.message);
      for (const line of activeLines || []) {
        const key = String(line.sales_order_item_id);
        plannedByLine.set(
          key,
          (plannedByLine.get(key) || 0) + Number(line.planned_quantity || 0),
        );
      }
    }

    const normalizedLines = requestedLines.map((requested: any) => {
      const lineId = String(requested?.sales_order_item_id || "").trim();
      const quantity = Number(requested?.quantity);
      const orderLine: any = orderLines.get(lineId);
      if (!orderLine)
        throw new BadRequestException(
          "A fulfilment line does not belong to the selected sales order",
        );
      if (!Number.isFinite(quantity) || quantity <= 0)
        throw new BadRequestException(
          `Enter a positive fulfilment quantity for ${orderLine.item_description || "every item"}`,
        );
      const outstanding = Math.max(
        0,
        Number(orderLine.quantity || 0) -
          Number(orderLine.dispatched_quantity || 0) -
          (plannedByLine.get(lineId) || 0),
      );
      if (quantity - outstanding > 1e-9) {
        throw new BadRequestException(
          `Fulfilment quantity ${quantity} exceeds unplanned quantity ${outstanding} for ${orderLine.item_description || "the selected item"}`,
        );
      }
      return {
        sales_order_item_id: lineId,
        item_id: orderLine.item_id,
        planned_quantity: quantity,
        picked_quantity: 0,
        packed_quantity: 0,
      };
    });

    const priority = String(body?.priority || "NORMAL").toUpperCase();
    if (!["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority))
      throw new BadRequestException("Invalid fulfilment priority");
    const sequence = await this.nextDocumentSequence("FULFILMENT_TASK");
    const taskNumber = `FUL-${new Date().getFullYear()}-${String(sequence).padStart(6, "0")}`;
    const { data: task, error: taskError } = await this.supabase
      .from("sales_fulfilment_tasks")
      .insert({
        tenant_id: tenantId,
        task_number: taskNumber,
        sales_order_id: salesOrderId,
        warehouse_id: body?.warehouse_id || null,
        planned_dispatch_date: body.planned_dispatch_date,
        priority,
        status: "PLANNED",
        assigned_to: body?.assigned_to || null,
        notes: String(body?.notes || "").trim() || null,
        created_by: userId || null,
      })
      .select()
      .single();
    if (taskError || !task)
      throw new BadRequestException(
        taskError?.message || "Fulfilment task creation failed",
      );
    const { error: lineError } = await this.supabase
      .from("sales_fulfilment_task_items")
      .insert(
        normalizedLines.map((line: any) => ({ ...line, task_id: task.id })),
      );
    if (lineError) {
      await this.supabase
        .from("sales_fulfilment_tasks")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", task.id);
      throw new BadRequestException(lineError.message);
    }
    await this.recordSalesEvent(
      tenantId,
      salesOrderId,
      "FULFILMENT",
      task.id,
      taskNumber,
      "FULFILMENT_PLANNED",
      userId,
      body?.notes,
      { priority, planned_dispatch_date: body.planned_dispatch_date },
    );
    return this.getFulfilmentTaskById(tenantId, task.id);
  }

  async advanceFulfilmentTask(req: Request, taskId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const task: any = await this.getFulfilmentTaskById(tenantId, taskId);
    const action = String(body?.action || "").toUpperCase();
    const now = new Date().toISOString();
    const transition: Record<
      string,
      { from: string; to: string; timestamp?: string; event: string }
    > = {
      START_PICKING: {
        from: "PLANNED",
        to: "PICKING",
        timestamp: "picking_started_at",
        event: "PICKING_STARTED",
      },
      CONFIRM_PICK: {
        from: "PICKING",
        to: "PICKED",
        timestamp: "picked_at",
        event: "PICKING_CONFIRMED",
      },
      CONFIRM_PACK: {
        from: "PICKED",
        to: "PACKED",
        timestamp: "packed_at",
        event: "PACKING_CONFIRMED",
      },
      MARK_READY: {
        from: "PACKED",
        to: "READY_TO_DISPATCH",
        timestamp: "ready_at",
        event: "READY_TO_DISPATCH",
      },
    };

    if (action === "CANCEL") {
      if (["DISPATCHED", "CANCELLED"].includes(task.status))
        throw new BadRequestException(
          `A ${task.status.toLowerCase()} fulfilment task cannot be cancelled`,
        );
      const reason = String(body?.reason || "").trim();
      if (!reason)
        throw new BadRequestException("Cancellation reason is required");
      const { data, error } = await this.supabase
        .from("sales_fulfilment_tasks")
        .update({
          status: "CANCELLED",
          cancellation_reason: reason,
          cancelled_at: now,
          cancelled_by: userId || null,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", taskId)
        .eq("status", task.status)
        .select()
        .single();
      if (error || !data)
        throw new BadRequestException(
          error?.message || "Fulfilment task cancellation failed",
        );
      await this.recordSalesEvent(
        tenantId,
        task.sales_order_id,
        "FULFILMENT",
        task.id,
        task.task_number,
        "FULFILMENT_CANCELLED",
        userId,
        reason,
      );
      return data;
    }

    const rule = transition[action];
    if (!rule) throw new BadRequestException("Unsupported fulfilment action");
    if (task.status !== rule.from)
      throw new BadRequestException(
        `${action.replaceAll("_", " ")} is not allowed while the task is ${String(task.status).replaceAll("_", " ")}`,
      );

    if (action === "CONFIRM_PICK" || action === "CONFIRM_PACK") {
      const submitted = new Map(
        (Array.isArray(body?.items) ? body.items : []).map((line: any) => [
          String(line.sales_order_item_id),
          line,
        ]),
      );
      for (const line of task.items || []) {
        const values: any = submitted.get(String(line.sales_order_item_id));
        const quantity = Number(values?.quantity);
        const expected =
          action === "CONFIRM_PICK"
            ? Number(line.planned_quantity)
            : Number(line.picked_quantity);
        if (
          !Number.isFinite(quantity) ||
          Math.abs(quantity - expected) > 1e-9
        ) {
          throw new BadRequestException(
            `${action === "CONFIRM_PICK" ? "Picked" : "Packed"} quantity must equal ${expected} for every task line; split the fulfilment task when partial execution is required`,
          );
        }
      }
      for (const line of task.items || []) {
        const values: any = submitted.get(String(line.sales_order_item_id));
        const update =
          action === "CONFIRM_PICK"
            ? {
                picked_quantity: Number(values.quantity),
                batch_number: values.batch_number || null,
                storage_bin: values.storage_bin || null,
                updated_at: now,
              }
            : { packed_quantity: Number(values.quantity), updated_at: now };
        const { error } = await this.supabase
          .from("sales_fulfilment_task_items")
          .update(update)
          .eq("id", line.id)
          .eq("task_id", taskId);
        if (error) throw new BadRequestException(error.message);
      }
    }
    if (
      action === "MARK_READY" &&
      (task.items || []).some(
        (line: any) =>
          Number(line.packed_quantity) !== Number(line.planned_quantity),
      )
    ) {
      throw new BadRequestException(
        "All planned quantities must be packed before dispatch readiness",
      );
    }

    const updatePayload: any = { status: rule.to, updated_at: now };
    if (rule.timestamp) updatePayload[rule.timestamp] = now;
    if (body?.assigned_to !== undefined)
      updatePayload.assigned_to = body.assigned_to || null;
    const { data, error } = await this.supabase
      .from("sales_fulfilment_tasks")
      .update(updatePayload)
      .eq("tenant_id", tenantId)
      .eq("id", taskId)
      .eq("status", rule.from)
      .select()
      .single();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Fulfilment transition failed; refresh and retry",
      );
    await this.recordSalesEvent(
      tenantId,
      task.sales_order_id,
      "FULFILMENT",
      task.id,
      task.task_number,
      rule.event,
      userId,
      body?.notes,
    );
    return this.getFulfilmentTaskById(tenantId, taskId);
  }

  private async getFulfilmentTaskById(tenantId: string, taskId: string) {
    const { data, error } = await this.supabase
      .from("sales_fulfilment_tasks")
      .select(
        "*, items:sales_fulfilment_task_items(*), sales_order:sales_orders(id, so_number, status, release_status, customer_id, customer:customers(id, customer_code, customer_name)), warehouse:warehouses(id, code, name)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", taskId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Fulfilment task not found");
    return data;
  }

  // ==================== DISPATCH ====================

  private validateDispatchAgainstSalesOrder(
    dispatchItems: any[],
    salesOrderItems: any[],
  ) {
    const orderLines = new Map(
      (salesOrderItems || []).map((line: any) => [String(line.id), line]),
    );
    const requestedByLine = new Map<string, number>();

    for (const item of dispatchItems || []) {
      const salesOrderItemId = String(item?.sales_order_item_id || "").trim();
      const itemId = String(item?.item_id || "").trim();
      const quantity = Number(item?.quantity || 0);
      if (
        !salesOrderItemId ||
        !itemId ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        throw new BadRequestException(
          "Every dispatch line must contain a valid sales-order line, item and positive quantity",
        );
      }
      const orderLine: any = orderLines.get(salesOrderItemId);
      if (!orderLine) {
        throw new BadRequestException(
          "A selected dispatch line does not belong to this sales order",
        );
      }
      if (String(orderLine.item_id || "") !== itemId) {
        throw new BadRequestException(
          `Dispatch item does not match sales-order line ${orderLine.item_description || salesOrderItemId}`,
        );
      }
      requestedByLine.set(
        salesOrderItemId,
        (requestedByLine.get(salesOrderItemId) || 0) + quantity,
      );
    }

    for (const [salesOrderItemId, requested] of requestedByLine.entries()) {
      const orderLine: any = orderLines.get(salesOrderItemId);
      const remaining = Math.max(
        0,
        Number(orderLine.quantity || 0) -
          Number(orderLine.dispatched_quantity || 0),
      );
      if (requested - remaining > 1e-9) {
        throw new BadRequestException(
          `Dispatch quantity ${requested} exceeds the remaining quantity ${remaining} for ${orderLine.item_description || "the selected sales-order item"}`,
        );
      }
    }
  }

  async createDispatch(req: Request, dispatchData: any) {
    const { tenantId, userId } = req.user as any;

    if (
      !Array.isArray(dispatchData?.items) ||
      dispatchData.items.length === 0
    ) {
      throw new BadRequestException(
        "Select at least one sales-order item to dispatch",
      );
    }

    // Get sales order to extract customer_id and check status
    const { data: salesOrder } = await this.supabase
      .from("sales_orders")
      .select(
        "customer_id, status, release_status, credit_status, delivery_block, block_reason, customer:customers(delivery_blocked, block_reason), sales_order_items(id, item_id, item_description, quantity, dispatched_quantity)",
      )
      .eq("id", dispatchData.sales_order_id)
      .eq("tenant_id", tenantId)
      .single();

    if (!salesOrder) throw new NotFoundException("Sales order not found");
    if (String(salesOrder.release_status || "RELEASED") !== "RELEASED") {
      throw new BadRequestException(
        "Sales order is not commercially released for goods issue",
      );
    }
    if (String(salesOrder.credit_status || "CLEAR") !== "CLEAR") {
      throw new BadRequestException(
        "Sales order is credit blocked; obtain finance release before goods issue",
      );
    }
    const customerControl: any = Array.isArray((salesOrder as any).customer)
      ? (salesOrder as any).customer[0]
      : (salesOrder as any).customer;
    if (salesOrder.delivery_block || customerControl?.delivery_blocked) {
      throw new BadRequestException(
        `Delivery is blocked${salesOrder.block_reason || customerControl?.block_reason ? `: ${salesOrder.block_reason || customerControl.block_reason}` : ""}`,
      );
    }

    // Prevent dispatch creation if sales order is fully dispatched
    if (
      salesOrder.status === "DISPATCHED" ||
      salesOrder.status === "DELIVERED"
    ) {
      throw new BadRequestException(
        "Cannot create dispatch for a fully dispatched sales order",
      );
    }

    this.validateDispatchAgainstSalesOrder(
      dispatchData.items,
      (salesOrder as any).sales_order_items || [],
    );

    let fulfilmentTask: any = null;
    if (dispatchData?.fulfilment_task_id) {
      fulfilmentTask = await this.getFulfilmentTaskById(
        tenantId,
        String(dispatchData.fulfilment_task_id),
      );
      if (
        String(fulfilmentTask.sales_order_id) !==
        String(dispatchData.sales_order_id)
      ) {
        throw new BadRequestException(
          "The selected fulfilment task belongs to a different sales order",
        );
      }
      if (fulfilmentTask.status !== "READY_TO_DISPATCH") {
        throw new BadRequestException(
          "Only a packed fulfilment task marked ready can be dispatched",
        );
      }
      const packedByOrderLine = new Map(
        (fulfilmentTask.items || []).map((line: any) => [
          String(line.sales_order_item_id),
          Number(line.packed_quantity || 0),
        ]),
      );
      const requestedByOrderLine = new Map<string, number>();
      for (const line of dispatchData.items || []) {
        const key = String(line.sales_order_item_id || "");
        requestedByOrderLine.set(
          key,
          (requestedByOrderLine.get(key) || 0) + Number(line.quantity || 0),
        );
      }
      for (const [lineId, packedQuantity] of packedByOrderLine.entries()) {
        if (
          Math.abs((requestedByOrderLine.get(lineId) || 0) - packedQuantity) >
          1e-9
        ) {
          throw new BadRequestException(
            "Dispatch quantities must match every packed line in the selected fulfilment task",
          );
        }
      }
      if (requestedByOrderLine.size !== packedByOrderLine.size) {
        throw new BadRequestException(
          "Dispatch lines must exactly match the selected fulfilment task",
        );
      }
    }

    const dnNumber = await this.generateDNNumber(req);

    const dispatch = {
      tenant_id: tenantId,
      dn_number: dnNumber,
      sales_order_id: dispatchData.sales_order_id,
      fulfilment_task_id: fulfilmentTask?.id || null,
      customer_id: salesOrder.customer_id,
      dispatch_date:
        dispatchData.dispatch_date || new Date().toISOString().split("T")[0],
      transporter_name: dispatchData.transporter_name,
      vehicle_number: dispatchData.vehicle_number,
      lr_number: dispatchData.lr_number,
      lr_date: dispatchData.lr_date,
      delivery_address: dispatchData.delivery_address,
      notes: dispatchData.notes,
      status: "PGI_POSTED",
      goods_issue_at: new Date().toISOString(),
      goods_issue_by: userId,
      created_by: userId,
    };

    // Validate dispatched UIDs are saleable (QC PASSED) before inserting dispatch items
    const dispatchedUids = Array.from(
      new Set<string>(
        (dispatchData.items || []).flatMap((i: any) => {
          const uids = Array.isArray(i?.uid) ? i.uid : i?.uid ? [i.uid] : [];
          return uids.filter(
            (u: any) => typeof u === "string" && u.trim().length > 0,
          );
        }),
      ),
    );

    const byUid = new Map<string, any>();
    if (dispatchedUids.length > 0) {
      const { data: uidRows, error: uidFetchError } = await this.supabase
        .from("uid_registry")
        .select("uid, status, quality_status, entity_id")
        .eq("tenant_id", tenantId)
        .in("uid", dispatchedUids);

      if (uidFetchError) throw new BadRequestException(uidFetchError.message);

      for (const row of uidRows || []) byUid.set(row.uid, row);
      const missing = dispatchedUids.filter((u) => !byUid.has(u));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Some UIDs are invalid/not found: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`,
        );
      }

      const notSaleable = dispatchedUids.filter((u) => {
        const row: any = byUid.get(u);
        const status = String(row?.status || "");
        const quality = String(row?.quality_status || "");
        const statusOk = status === "IN_STOCK";
        const qualityOk = quality === "PASSED";
        return !(statusOk && qualityOk);
      });

      if (notSaleable.length > 0) {
        throw new BadRequestException(
          `Some UIDs are not saleable (must be QC PASSED and IN_STOCK): ${notSaleable.slice(0, 10).join(", ")}${notSaleable.length > 10 ? "..." : ""}`,
        );
      }
    }

    // Validate all items have UIDs (required for finished goods tracking)
    const itemsWithoutUids = dispatchData.items.filter((item: any) => {
      const uids = Array.isArray(item.uid)
        ? item.uid
        : item.uid
          ? [item.uid]
          : [];
      return uids.length === 0;
    });

    if (itemsWithoutUids.length > 0) {
      throw new BadRequestException(
        "All dispatch items must have UIDs assigned. Please assign UIDs to all items before creating dispatch.",
      );
    }

    const suppliedUidCount = (dispatchData.items || []).reduce(
      (count: number, item: any) => {
        const uids = Array.isArray(item?.uid)
          ? item.uid
          : item?.uid
            ? [item.uid]
            : [];
        return count + uids.length;
      },
      0,
    );
    if (dispatchedUids.length !== suppliedUidCount) {
      throw new BadRequestException(
        "The same UID cannot be dispatched more than once",
      );
    }

    for (const item of dispatchData.items) {
      const uids = Array.isArray(item?.uid)
        ? item.uid
        : item?.uid
          ? [item.uid]
          : [];
      const requestedQuantity = Number(item?.quantity || 0);
      if (
        !Number.isFinite(requestedQuantity) ||
        requestedQuantity <= 0 ||
        Math.abs(requestedQuantity - uids.length) > 1e-9
      ) {
        throw new BadRequestException(
          "Each dispatch-line quantity must match its selected UID count",
        );
      }

      const expectedItemByUid = new Map<string, string>();
      for (const item of dispatchData.items || []) {
        const uids = Array.isArray(item?.uid)
          ? item.uid
          : item?.uid
            ? [item.uid]
            : [];
        for (const uid of uids)
          expectedItemByUid.set(String(uid), String(item.item_id || ""));
      }
      const wrongItemUids = dispatchedUids.filter((uid) => {
        const row: any = byUid.get(uid);
        return (
          String(row?.entity_id || "") !==
          String(expectedItemByUid.get(uid) || "")
        );
      });
      if (wrongItemUids.length > 0) {
        throw new BadRequestException(
          `Some UIDs belong to a different item: ${wrongItemUids.slice(0, 10).join(", ")}${wrongItemUids.length > 10 ? "..." : ""}`,
        );
      }
    }

    // Create the accounting/stock document only after every request-level
    // validation has passed. A rejected UID selection must never leave an
    // orphan dispatch-note header behind.
    const { data: dispatchRecord, error: dispatchError } = await this.supabase
      .from("dispatch_notes")
      .insert(dispatch)
      .select()
      .single();

    if (dispatchError || !dispatchRecord) {
      throw new BadRequestException(
        dispatchError?.message || "Dispatch creation failed",
      );
    }

    // Insert dispatch items with UID assignment
    // Each item can have multiple UIDs, so we create one dispatch_item per UID
    const dispatchItems = dispatchData.items.flatMap((item: any) => {
      const uids = Array.isArray(item.uid)
        ? item.uid
        : item.uid
          ? [item.uid]
          : [];

      // Create one dispatch_item per UID with quantity 1
      return uids.map((uid: string) => ({
        dispatch_note_id: dispatchRecord.id,
        sales_order_item_id: item.sales_order_item_id,
        item_id: item.item_id,
        uid: uid,
        quantity: 1, // One unit per UID
        batch_number: item.batch_number,
        serial_number: item.serial_number,
        notes: item.notes,
      }));
    });

    const { error: itemsError } = await this.supabase
      .from("dispatch_items")
      .insert(dispatchItems);

    if (itemsError) {
      await this.supabase
        .from("dispatch_notes")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", dispatchRecord.id);
      throw new BadRequestException(itemsError.message);
    }

    // Update UID status/location and create deployment mapping (customer/location) for each dispatched UID.
    // This ensures dispatched UIDs stop appearing as AVAILABLE/GENERATED and can be traced to customer + delivery address.
    if (dispatchedUids.length > 0) {
      // Fetch customer contact + name
      const { data: customer } = await this.supabase
        .from("customers")
        .select(
          "customer_name, contact_person, contact_email, contact_phone, email, phone, shipping_address",
        )
        .eq("id", salesOrder.customer_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      const deliveryLocation =
        dispatchData.delivery_address ||
        customer?.shipping_address ||
        "Customer Location";

      // Mark each UID as shipped/in-transit and log lifecycle
      for (const uid of dispatchedUids) {
        try {
          await this.uidSupabaseService.updateStatus(
            req as any,
            uid,
            "IN_TRANSIT",
            deliveryLocation,
          );
          await this.uidSupabaseService.updateLifecycle(
            req as any,
            uid,
            "SHIPPED",
            deliveryLocation,
            `Dispatch ${dispatchRecord.dn_number}`,
          );
        } catch (e) {
          // Do not block dispatch if UID tagging fails, but log it.
          console.error(`[Dispatch] Failed to tag UID ${uid}:`, e);
        }
      }

      // Create deployment history entry (customer/location mapping) per UID
      try {
        const { data: uidRows } = await this.supabase
          .from("uid_registry")
          .select("id, uid")
          .eq("tenant_id", tenantId)
          .in("uid", dispatchedUids);

        if (uidRows && uidRows.length > 0) {
          await this.supabase.from("product_deployment_history").insert(
            uidRows.map((row: any) => ({
              tenant_id: tenantId,
              uid_id: row.id,
              deployment_level: "CUSTOMER",
              organization_name: customer?.customer_name || "Customer",
              location_name: deliveryLocation,
              deployment_date: dispatchRecord.dispatch_date,
              contact_person: customer?.contact_person || null,
              contact_email: customer?.contact_email || customer?.email || null,
              contact_phone: customer?.contact_phone || customer?.phone || null,
              deployment_notes: `Auto-created from dispatch ${dispatchRecord.dn_number}`,
              is_current_location: true,
              created_by: userId,
            })),
          );
        }
      } catch (e) {
        console.error(
          `[Dispatch] Failed to create deployment mapping for ${dispatchRecord.dn_number}:`,
          e,
        );
      }
    }

    // Post PGI as one controlled unit. If inventory rejects any line, reverse
    // the dispatch shell, UID statuses, and completed material movements.
    try {
      await this.reduceStockForDispatch(
        tenantId,
        userId,
        dispatchData.items,
        dispatchRecord.dn_number,
      );
      const reservationConsumption = new Map<string, number>();
      for (const line of dispatchData.items || []) {
        const lineId = String(line.sales_order_item_id || "");
        reservationConsumption.set(
          lineId,
          (reservationConsumption.get(lineId) || 0) +
            Number(line.quantity || 0),
        );
      }
      const consumeResult = await this.supabase.rpc(
        "consume_sales_order_atp_bulk",
        {
          p_tenant_id: tenantId,
          p_sales_order_id: dispatchData.sales_order_id,
          p_lines: [...reservationConsumption.entries()].map(
            ([sales_order_line_id, quantity]) => ({
              sales_order_line_id,
              quantity,
            }),
          ),
        },
      );
      if (consumeResult.error)
        throw new BadRequestException(
          `Stock posted but ATP reservation could not be consumed: ${consumeResult.error.message}`,
        );
    } catch (postingError) {
      try {
        await this.deleteDispatch(req, dispatchRecord.id);
      } catch (rollbackError) {
        console.error(
          `[Dispatch] Compensating rollback failed for ${dispatchRecord.dn_number}:`,
          rollbackError,
        );
      }
      throw postingError;
    }

    // Update sales order item dispatched quantities
    for (const item of dispatchData.items) {
      const { data: soItem } = await this.supabase
        .from("sales_order_items")
        .select("dispatched_quantity")
        .eq("id", item.sales_order_item_id)
        .single();

      if (soItem) {
        await this.supabase
          .from("sales_order_items")
          .update({
            dispatched_quantity:
              (soItem.dispatched_quantity || 0) + item.quantity,
          })
          .eq("id", item.sales_order_item_id);
      }
    }

    // Check if all items in the Sales Order are fully dispatched
    const { data: allItems } = await this.supabase
      .from("sales_order_items")
      .select("quantity, dispatched_quantity")
      .eq("sales_order_id", dispatchData.sales_order_id);

    const allFullyDispatched =
      allItems &&
      allItems.every(
        (item: any) => (item.dispatched_quantity || 0) >= item.quantity,
      );

    // Update sales order status: COMPLETED if fully dispatched, otherwise DISPATCHED
    await this.supabase
      .from("sales_orders")
      .update({ status: allFullyDispatched ? "COMPLETED" : "DISPATCHED" })
      .eq("id", dispatchData.sales_order_id);

    // Create warranties for dispatched items
    try {
      await this.createWarrantiesForDispatch(req, dispatchRecord.id, {
        ...dispatchData,
        customer_id: salesOrder.customer_id,
      });
    } catch (e) {
      console.error("[Dispatch] Warranty creation failed (non-fatal):", e);
    }

    // 🎫 Generate and email issue certificate for final products
    try {
      await this.generateAndEmailCertificate(
        req,
        dispatchRecord,
        salesOrder,
        dispatchData,
      );
    } catch (e) {
      console.error("[Dispatch] Certificate generation failed (non-fatal):", e);
    }

    await this.recordSalesEvent(
      tenantId,
      dispatchData.sales_order_id,
      "DISPATCH",
      dispatchRecord.id,
      dispatchRecord.dn_number,
      "PGI_POSTED",
      userId,
      null,
      { uid_count: dispatchedUids.length },
    );
    if (fulfilmentTask) {
      const { error: fulfilmentError } = await this.supabase
        .from("sales_fulfilment_tasks")
        .update({ status: "DISPATCHED", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", fulfilmentTask.id)
        .eq("status", "READY_TO_DISPATCH");
      if (fulfilmentError) {
        // PGI and stock posting have already succeeded. Do not return a false failure
        // that encourages the user to post the same dispatch again.
        console.error(
          "[Dispatch] Fulfilment status update failed after successful PGI:",
          fulfilmentError,
        );
      } else {
        await this.recordSalesEvent(
          tenantId,
          dispatchData.sales_order_id,
          "FULFILMENT",
          fulfilmentTask.id,
          fulfilmentTask.task_number,
          "FULFILMENT_DISPATCHED",
          userId,
          null,
          {
            dispatch_id: dispatchRecord.id,
            dn_number: dispatchRecord.dn_number,
          },
        );
      }
    }
    return dispatchRecord;
  }

  async updateDispatch(req: Request, dispatchId: string, dispatchData: any) {
    const { tenantId } = req.user as any;

    const { data: existing, error: fetchError } = await this.supabase
      .from("dispatch_notes")
      .select("id, status")
      .eq("id", dispatchId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing)
      throw new NotFoundException("Dispatch note not found");
    if (String(existing.status || "PGI_POSTED") !== "PGI_POSTED") {
      throw new BadRequestException(
        "Only an open PGI-posted dispatch can be edited",
      );
    }

    const { count: invoiceCount, error: invoiceCheckError } =
      await this.supabase
        .from("invoices")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("dispatch_note_id", dispatchId)
        .neq("billing_status", "CANCELLED");
    if (invoiceCheckError)
      throw new BadRequestException(invoiceCheckError.message);
    if ((invoiceCount || 0) > 0)
      throw new BadRequestException("A billed dispatch cannot be edited");

    const { data, error } = await this.supabase
      .from("dispatch_notes")
      .update({
        dispatch_date: dispatchData.dispatch_date,
        transporter_name: dispatchData.transporter_name,
        vehicle_number: dispatchData.vehicle_number,
        lr_number: dispatchData.lr_number,
        lr_date: dispatchData.lr_date,
        delivery_address: dispatchData.delivery_address,
        notes: dispatchData.notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dispatchId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteDispatch(req: Request, dispatchId: string) {
    const { tenantId } = req.user as any;

    const { data: dispatchNote, error: dnError } = await this.supabase
      .from("dispatch_notes")
      .select("id, dn_number, sales_order_id, fulfilment_task_id, status")
      .eq("id", dispatchId)
      .eq("tenant_id", tenantId)
      .single();

    if (dnError) throw new BadRequestException(dnError.message);
    if (!dispatchNote) throw new NotFoundException("Dispatch note not found");
    if (dispatchNote.status === "CANCELLED")
      throw new BadRequestException("Dispatch note is already cancelled");
    if (dispatchNote.status === "DELIVERED")
      throw new BadRequestException("A delivered dispatch cannot be reversed");

    const { count: invoiceCount, error: invoiceCheckError } =
      await this.supabase
        .from("invoices")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("dispatch_note_id", dispatchId)
        .neq("billing_status", "CANCELLED");
    if (invoiceCheckError)
      throw new BadRequestException(invoiceCheckError.message);
    if ((invoiceCount || 0) > 0) {
      throw new BadRequestException(
        "Reverse and cancel the customer invoice before reversing this dispatch",
      );
    }

    const { data: dispatchItems, error: itemsError } = await this.supabase
      .from("dispatch_items")
      .select("id, item_id, uid, quantity, sales_order_item_id")
      .eq("dispatch_note_id", dispatchId);

    if (itemsError) throw new BadRequestException(itemsError.message);

    const itemQtyByItemId = new Map<string, number>();
    const itemQtyBySoItemId = new Map<string, number>();
    const dispatchItemIds: string[] = [];
    const uidsToRevert: string[] = [];

    for (const di of dispatchItems || []) {
      dispatchItemIds.push(di.id);
      const itemId = di.item_id;
      const qty = Number(di.quantity) || 0;
      itemQtyByItemId.set(itemId, (itemQtyByItemId.get(itemId) || 0) + qty);
      if (di.sales_order_item_id) {
        itemQtyBySoItemId.set(
          di.sales_order_item_id,
          (itemQtyBySoItemId.get(di.sales_order_item_id) || 0) + qty,
        );
      }
      if (di.uid) uidsToRevert.push(di.uid);
    }

    // Reverse stock using stock_movements + stock_entries (best-effort)
    // We rely on the movements created during dispatch to restore stock back to the same warehouses.
    const { data: dispatchMovements, error: dispatchMovementsError } =
      await this.supabase
        .from("stock_movements")
        .select("item_id, from_warehouse_id, quantity")
        .eq("tenant_id", tenantId)
        .eq("reference_type", "DISPATCH")
        .eq("reference_number", dispatchNote.dn_number)
        .eq("movement_type", "SALES_ISSUE");

    if (dispatchMovementsError)
      throw new BadRequestException(dispatchMovementsError.message);

    const qtyByItemWarehouse = new Map<string, number>();
    for (const mv of dispatchMovements || []) {
      const warehouseId = mv.from_warehouse_id;
      const itemId = mv.item_id;
      const qty = Number(mv.quantity) || 0;
      if (!warehouseId || !itemId || qty <= 0) continue;
      const key = `${itemId}::${warehouseId}`;
      qtyByItemWarehouse.set(key, (qtyByItemWarehouse.get(key) || 0) + qty);
    }

    for (const [key, qty] of qtyByItemWarehouse.entries()) {
      if (qty <= 0) continue;
      const [itemId, warehouseId] = key.split("::");
      if (!itemId || !warehouseId) continue;

      const { data: itemRowForInv } = await this.supabase
        .from("items")
        .select("category")
        .eq("tenant_id", tenantId)
        .eq("id", itemId)
        .maybeSingle();

      const { data: latestEntry, error: latestEntryError } = await this.supabase
        .from("stock_entries")
        .select("id, quantity, available_quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .eq("warehouse_id", warehouseId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestEntryError)
        throw new BadRequestException(latestEntryError.message);

      if (latestEntry?.id) {
        const nextQty = (Number(latestEntry.quantity) || 0) + qty;
        const nextAvailable =
          (Number(latestEntry.available_quantity) || 0) + qty;
        const { error: updErr } = await this.supabase
          .from("stock_entries")
          .update({
            quantity: nextQty,
            available_quantity: nextAvailable,
            updated_at: new Date().toISOString(),
          })
          .eq("id", latestEntry.id);
        if (updErr) throw new BadRequestException(updErr.message);
      } else {
        const { error: insErr } = await this.supabase
          .from("stock_entries")
          .insert({
            tenant_id: tenantId,
            item_id: itemId,
            warehouse_id: warehouseId,
            quantity: qty,
            available_quantity: qty,
            allocated_quantity: 0,
            metadata: {
              created_from: "DISPATCH_REVERT",
              reference_number: dispatchNote.dn_number,
            },
          });
        if (insErr) throw new BadRequestException(insErr.message);
      }

      // Keep inventory_stock in sync with stock_entries
      const { error: invError } = await this.supabase.rpc(
        "adjust_inventory_stock",
        {
          p_tenant_id: tenantId,
          p_item_id: itemId,
          p_warehouse_id: warehouseId,
          p_location_id: null,
          p_quantity_change: qty,
          p_category: normalizeInventoryStockCategory(
            itemRowForInv?.category,
            "RAW_MATERIAL",
          ),
        },
      );

      if (invError) throw new BadRequestException(invError.message);

      // Log reversal movement. A stock change without its material-document
      // number is not auditable and also breaks any later controlled reversal.
      await this.insertStockMovement("ADJ-", {
        tenant_id: tenantId,
        movement_type: "ADJUSTMENT",
        item_id: itemId,
        uid: null,
        to_warehouse_id: warehouseId,
        quantity: qty,
        reference_type: "DISPATCH_REVERT",
        reference_number: dispatchNote.dn_number,
        notes: `Reverted dispatch ${dispatchNote.dn_number}`,
        moved_by: (req.user as any)?.userId,
        movement_date: new Date().toISOString(),
      });
    }

    // Reverse dispatched quantities
    for (const [soItemId, qty] of itemQtyBySoItemId.entries()) {
      const { data: soItem, error: soItemErr } = await this.supabase
        .from("sales_order_items")
        .select("dispatched_quantity")
        .eq("id", soItemId)
        .maybeSingle();

      if (soItemErr) throw new BadRequestException(soItemErr.message);
      const current = Number(soItem?.dispatched_quantity) || 0;
      const next = Math.max(current - qty, 0);
      const { error: updErr } = await this.supabase
        .from("sales_order_items")
        .update({ dispatched_quantity: next })
        .eq("id", soItemId);

      if (updErr) throw new BadRequestException(updErr.message);
    }

    // Revert UID tagging (best-effort)
    for (const uid of uidsToRevert) {
      try {
        await this.uidSupabaseService.updateStatus(
          req as any,
          uid,
          "GENERATED",
          "Warehouse",
        );
        await this.uidSupabaseService.updateLifecycle(
          req as any,
          uid,
          "RETURNED",
          "Warehouse",
          `Reverted ${dispatchNote.dn_number}`,
        );
      } catch (e) {
        console.error(`[Dispatch] Failed to revert UID ${uid}:`, e);
      }
    }

    // Delete warranties created for this dispatch
    if (dispatchItemIds.length > 0) {
      const { error: wErr } = await this.supabase
        .from("warranties")
        .delete()
        .eq("tenant_id", tenantId)
        .in("dispatch_item_id", dispatchItemIds);
      if (wErr) throw new BadRequestException(wErr.message);
    }

    // Delete deployment mapping rows created from this dispatch (best-effort)
    await this.supabase
      .from("product_deployment_history")
      .delete()
      .eq("tenant_id", tenantId)
      .eq(
        "deployment_notes",
        `Auto-created from dispatch ${dispatchNote.dn_number}`,
      );

    // Restore sales order status (best-effort)
    await this.supabase
      .from("sales_orders")
      .update({ status: "CONFIRMED" })
      .eq("tenant_id", tenantId)
      .eq("id", dispatchNote.sales_order_id);

    // Preserve the posted document and its lines for audit. The DELETE action
    // is implemented as a controlled PGI reversal/cancellation, never as a
    // destructive removal of accounting history.
    const { error: delErr } = await this.supabase
      .from("dispatch_notes")
      .update({
        status: "CANCELLED",
        cancellation_reason: "PGI reversed by an authorized user",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", dispatchId);

    if (delErr) throw new BadRequestException(delErr.message);
    if ((dispatchNote as any).fulfilment_task_id) {
      await this.supabase
        .from("sales_fulfilment_tasks")
        .update({
          status: "READY_TO_DISPATCH",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", (dispatchNote as any).fulfilment_task_id)
        .eq("status", "DISPATCHED");
    }
    return {
      message:
        "Dispatch PGI reversed; stock restored and audit document retained",
    };
  }

  private async generateDNNumber(req: Request): Promise<string> {
    const sequence = await this.nextDocumentSequence("DISPATCH");
    return `DN-${String(sequence).padStart(6, "0")}`;
  }

  private async insertStockMovement(prefix: string, payload: any) {
    let lastError: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: latest, error: latestError } = await this.supabase
        .from("stock_movements")
        .select("movement_number")
        .like("movement_number", `${prefix}%`)
        .order("movement_number", { ascending: false })
        .limit(1);
      if (latestError) throw new BadRequestException(latestError.message);
      const current =
        String(latest?.[0]?.movement_number || "")
          .slice(prefix.length)
          .match(/^\d+/)?.[0] || "0";
      const movementNumber = `${prefix}${String(Number(current) + 1).padStart(6, "0")}`;
      const { data, error } = await this.supabase
        .from("stock_movements")
        .insert({ ...payload, movement_number: movementNumber })
        .select()
        .single();
      if (!error && data) return data;
      lastError = error;
      const collision =
        error?.code === "23505" &&
        String(error?.message || "").includes(
          "stock_movements_movement_number_key",
        );
      if (!collision) break;
    }
    throw new BadRequestException(
      lastError?.message || "Failed to post the stock movement document",
    );
  }

  /**
   * 🔧 CRITICAL FIX: Reduce stock when items are dispatched
   * This was missing and causing inventory to never decrease on sales!
   */
  private async reduceStockForDispatch(
    tenantId: string,
    userId: string,
    dispatchItems: any[],
    dispatchNumber: string,
  ) {
    for (const item of dispatchItems) {
      const itemId = item?.item_id;
      const requiredQty = Number(item?.quantity) || 0;
      if (!itemId || requiredQty <= 0) continue;

      const { data: itemRowForInv } = await this.supabase
        .from("items")
        .select("category")
        .eq("tenant_id", tenantId)
        .eq("id", itemId)
        .maybeSingle();

      const { data: stockEntries, error: stockError } = await this.supabase
        .from("stock_entries")
        .select(
          "id, warehouse_id, quantity, available_quantity, unit_price, created_at",
        )
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .gt("available_quantity", 0)
        .order("created_at", { ascending: true });

      if (stockError) {
        throw new BadRequestException(
          `Error checking stock for item ${itemId}: ${stockError.message}`,
        );
      }

      const totalAvailable = (stockEntries || []).reduce(
        (sum: number, entry: any) =>
          sum + (Number(entry.available_quantity) || 0),
        0,
      );

      if (!stockEntries || stockEntries.length === 0 || totalAvailable <= 0) {
        throw new BadRequestException(
          `No stock available for item ${itemId}. Please receive inventory first.`,
        );
      }

      if (totalAvailable < requiredQty) {
        throw new BadRequestException(
          `Insufficient stock for item ${itemId}. ` +
            `Available: ${totalAvailable}, Required: ${requiredQty}`,
        );
      }

      let remainingToConsume = requiredQty;
      const movementUid = Array.isArray(item?.uid) ? null : (item?.uid ?? null);

      for (const entry of stockEntries) {
        if (remainingToConsume <= 0) break;
        const entryAvailable = Number(entry.available_quantity) || 0;
        if (entryAvailable <= 0) continue;

        const toConsume = Math.min(entryAvailable, remainingToConsume);
        const entryQty = Number(entry.quantity) || 0;

        const warehouseId = String(entry.warehouse_id || "").trim();
        const inventoryCategory = normalizeInventoryStockCategory(
          itemRowForInv?.category,
          "RAW_MATERIAL",
        );
        if (warehouseId) {
          const { error: invError } = await this.supabase.rpc(
            "adjust_inventory_stock",
            {
              p_tenant_id: tenantId,
              p_item_id: itemId,
              p_warehouse_id: warehouseId,
              p_location_id: null,
              p_quantity_change: -toConsume,
              p_category: inventoryCategory,
            },
          );

          if (invError) {
            throw new BadRequestException(
              `Error syncing inventory stock: ${invError.message}`,
            );
          }
        }

        const { error: updateError } = await this.supabase
          .from("stock_entries")
          .update({
            quantity: Math.max(entryQty - toConsume, 0),
            available_quantity: Math.max(entryAvailable - toConsume, 0),
            updated_at: new Date().toISOString(),
          })
          .eq("id", entry.id)
          .eq("tenant_id", tenantId);

        if (updateError) {
          if (warehouseId) {
            await this.supabase.rpc("adjust_inventory_stock", {
              p_tenant_id: tenantId,
              p_item_id: itemId,
              p_warehouse_id: warehouseId,
              p_location_id: null,
              p_quantity_change: toConsume,
              p_category: inventoryCategory,
            });
          }
          throw new BadRequestException(
            `Error reducing stock: ${updateError.message}`,
          );
        }

        // Create stock movement record for audit trail. Do not silently accept
        // an inventory reduction if its material document failed to post.
        try {
          const movement = await this.insertStockMovement("SAL-", {
            tenant_id: tenantId,
            movement_type: "SALES_ISSUE",
            item_id: itemId,
            uid: movementUid,
            from_warehouse_id: entry.warehouse_id,
            quantity: toConsume,
            reference_type: "DISPATCH",
            reference_number: dispatchNumber,
            notes: `Dispatched via ${dispatchNumber} to customer`,
            moved_by: userId,
            movement_date: new Date().toISOString(),
          });
          // Preserve the exact FIFO layer cost used by this dispatch. This is
          // operational valuation evidence only; Finance still controls any GL posting.
          const unitCost = Number((entry as any).unit_price || 0);
          const { error: costEventError } = await this.supabase
            .from("inventory_cost_events")
            .upsert(
              {
                tenant_id: tenantId,
                event_type: "SALES_ISSUE",
                item_id: itemId,
                stock_entry_id: entry.id,
                quantity: toConsume,
                unit_cost: unitCost,
                total_cost: Number((toConsume * unitCost).toFixed(4)),
                reference_type: "DISPATCH",
                reference_number: dispatchNumber,
                movement_id: movement?.id || null,
                metadata: {
                  valuation_method: "FIFO",
                  warehouse_id: entry.warehouse_id || null,
                },
              },
              {
                onConflict:
                  "tenant_id,event_type,stock_entry_id,reference_number",
                ignoreDuplicates: true,
              },
            );
          if (costEventError)
            console.error(
              `[Dispatch] FIFO cost event capture failed for ${dispatchNumber}:`,
              costEventError.message,
            );
        } catch (movementError) {
          await this.supabase
            .from("stock_entries")
            .update({
              quantity: entryQty,
              available_quantity: entryAvailable,
              updated_at: new Date().toISOString(),
            })
            .eq("id", entry.id)
            .eq("tenant_id", tenantId);
          if (warehouseId) {
            await this.supabase.rpc("adjust_inventory_stock", {
              p_tenant_id: tenantId,
              p_item_id: itemId,
              p_warehouse_id: warehouseId,
              p_location_id: null,
              p_quantity_change: toConsume,
              p_category: inventoryCategory,
            });
          }
          throw movementError;
        }

        remainingToConsume -= toConsume;
      }

      console.log(
        `✅ Stock reduced for item ${itemId}: -${requiredQty} units (DN: ${dispatchNumber})`,
      );
    }
  }

  // ==================== WARRANTY ====================

  async createWarranty(req: Request, warrantyData: any) {
    const { tenantId } = req.user as any;

    const uid = String(warrantyData?.uid || "")
      .trim()
      .toUpperCase();
    if (!uid) throw new BadRequestException("UID is required");

    const warrantyDurationMonths =
      Number(warrantyData?.warranty_duration_months) || 12;
    if (
      !Number.isFinite(warrantyDurationMonths) ||
      warrantyDurationMonths <= 0
    ) {
      throw new BadRequestException(
        "warranty_duration_months must be a positive number",
      );
    }

    const warrantyNumber = `WR-${uid}`;

    // Ensure warranty doesn't already exist (by warranty_number)
    const { data: existing } = await this.supabase
      .from("warranties")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("warranty_number", warrantyNumber)
      .maybeSingle();

    if (existing?.id) {
      throw new BadRequestException("Warranty already exists for this UID");
    }

    // Warranty must be tied to a dispatched UID (finished goods)
    const { data: dispatchItem, error: dispatchItemError } = await this.supabase
      .from("dispatch_items")
      .select(
        `
        id,
        uid,
        item_id,
        dispatch_note_id,
        dispatch_notes:dispatch_note_id(id, tenant_id, dn_number, dispatch_date, sales_order_id, customer_id)
      `,
      )
      .eq("uid", uid)
      .maybeSingle();

    if (dispatchItemError)
      throw new BadRequestException(dispatchItemError.message);
    if (!dispatchItem?.id || !dispatchItem?.dispatch_notes) {
      throw new BadRequestException(
        "UID not found in dispatch items. Dispatch the item first.",
      );
    }

    const dispatchNotes = Array.isArray(dispatchItem.dispatch_notes)
      ? dispatchItem.dispatch_notes[0]
      : dispatchItem.dispatch_notes;

    if (dispatchNotes.tenant_id !== tenantId) {
      throw new NotFoundException("Dispatch item not found");
    }

    const warrantyStartDate =
      String((dispatchNotes as any).dispatch_date || "").trim() ||
      new Date().toISOString().split("T")[0];
    const warrantyEndDate = this.calculateWarrantyEndDate(
      warrantyStartDate,
      warrantyDurationMonths,
    );

    const insertPayload = {
      tenant_id: tenantId,
      warranty_number: warrantyNumber,
      uid,
      sales_order_id: (dispatchItem.dispatch_notes as any).sales_order_id,
      dispatch_item_id: dispatchItem.id,
      customer_id: (dispatchItem.dispatch_notes as any).customer_id,
      item_id: dispatchItem.item_id,
      warranty_start_date: warrantyStartDate,
      warranty_duration_months: warrantyDurationMonths,
      warranty_end_date: warrantyEndDate,
      warranty_type: warrantyData?.warranty_type || "STANDARD",
      warranty_terms: warrantyData?.warranty_terms,
      covered_components: warrantyData?.covered_components,
      status: "ACTIVE",
    };

    const { data, error } = await this.supabase
      .from("warranties")
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getWarrantyById(req: Request, warrantyId: string) {
    const { tenantId } = req.user as any;

    // Do not use FK-based joins here (schema cache may not have relationships).
    const { data: warranty, error: warrantyError } = await this.supabase
      .from("warranties")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", warrantyId)
      .maybeSingle();

    if (warrantyError) throw new BadRequestException(warrantyError.message);
    if (!warranty) throw new NotFoundException("Warranty not found");

    const safeMaybeSingle = async <T>(queryBuilder: any): Promise<T | null> => {
      try {
        const { data, error } = await queryBuilder;
        if (error) return null;
        return data ?? null;
      } catch {
        return null;
      }
    };

    const customerPromise = warranty.customer_id
      ? safeMaybeSingle<any>(
          this.supabase
            .from("customers")
            .select(
              "customer_code, customer_name, contact_person, email, phone, billing_address, shipping_address, city, state, pincode, country",
            )
            .eq("tenant_id", tenantId)
            .eq("id", warranty.customer_id)
            .maybeSingle(),
        )
      : Promise.resolve(null);

    const itemPromise = warranty.item_id
      ? safeMaybeSingle<any>(
          this.supabase
            .from("items")
            .select("id, code, name")
            .eq("tenant_id", tenantId)
            .eq("id", warranty.item_id)
            .maybeSingle(),
        )
      : Promise.resolve(null);

    const soPromise = warranty.sales_order_id
      ? safeMaybeSingle<any>(
          this.supabase
            .from("sales_orders")
            .select(
              "id, so_number, customer_po_number, customer_po_date, shipping_address",
            )
            .eq("tenant_id", tenantId)
            .eq("id", warranty.sales_order_id)
            .maybeSingle(),
        )
      : Promise.resolve(null);

    const dispatchItemPromise = warranty.dispatch_item_id
      ? safeMaybeSingle<any>(
          this.supabase
            .from("dispatch_items")
            .select("id, uid, serial_number, batch_number, dispatch_note_id")
            .eq("id", warranty.dispatch_item_id)
            .maybeSingle(),
        )
      : Promise.resolve(null);

    const [customer, item, salesOrder, dispatchItem] = await Promise.all([
      customerPromise,
      itemPromise,
      soPromise,
      dispatchItemPromise,
    ]);

    const dispatchNote = dispatchItem?.dispatch_note_id
      ? await safeMaybeSingle<any>(
          this.supabase
            .from("dispatch_notes")
            .select("id, dn_number, dispatch_date")
            .eq("tenant_id", tenantId)
            .eq("id", dispatchItem.dispatch_note_id)
            .maybeSingle(),
        )
      : null;

    const { data: invoices } = warranty.sales_order_id
      ? await this.supabase
          .from("invoices")
          .select("invoice_number, invoice_date, dispatch_note_id, created_at")
          .eq("tenant_id", tenantId)
          .eq("sales_order_id", warranty.sales_order_id)
          .order("invoice_date", { ascending: false })
      : { data: [] as any[] };
    const invoice =
      (invoices || []).find(
        (record: any) =>
          record.dispatch_note_id &&
          record.dispatch_note_id === dispatchNote?.id,
      ) ||
      (invoices || [])[0] ||
      null;

    const customerAddress = [
      customer?.billing_address,
      customer?.city,
      customer?.state,
      customer?.pincode,
      customer?.country,
    ]
      .filter(Boolean)
      .join(", ");

    return {
      ...warranty,
      customer_name: customer?.customer_name || null,
      customer_code: customer?.customer_code || null,
      item_code: item?.code || null,
      item_name: item?.name || null,
      so_number: salesOrder?.so_number || null,
      customer_po_number: salesOrder?.customer_po_number || null,
      customer_po_date: salesOrder?.customer_po_date || null,
      customer_address: customerAddress || null,
      supplied_location:
        salesOrder?.shipping_address ||
        customer?.shipping_address ||
        customerAddress ||
        null,
      dn_number: dispatchNote?.dn_number || null,
      dn_date: dispatchNote?.dispatch_date || null,
      invoice_number: invoice?.invoice_number || null,
      invoice_date: invoice?.invoice_date || null,
      serial_number: dispatchItem?.serial_number || null,
      batch_number: dispatchItem?.batch_number || null,
    };
  }

  private async createWarrantiesForDispatch(
    req: Request,
    dispatchNoteId: string,
    dispatchData: any,
  ) {
    const { tenantId } = req.user as any;

    const { data: dispatchItems } = await this.supabase
      .from("dispatch_items")
      .select("*")
      .eq("dispatch_note_id", dispatchNoteId);

    if (!dispatchItems || dispatchItems.length === 0) return;

    // Only create warranties for dispatched UIDs (finished goods). Skip rows without UID.
    const uidItems = (dispatchItems || []).filter(
      (it: any) =>
        typeof it?.uid === "string" && String(it.uid).trim().length > 0,
    );

    if (uidItems.length === 0) return;

    // Avoid inserting duplicates (warranty_number is unique)
    const warrantyNumbers = uidItems.map(
      (it: any) => `WR-${String(it.uid).trim().toUpperCase()}`,
    );
    const { data: existing } = await this.supabase
      .from("warranties")
      .select("warranty_number")
      .eq("tenant_id", tenantId)
      .in("warranty_number", warrantyNumbers);

    const existingSet = new Set(
      (existing || []).map((w: any) => w.warranty_number),
    );

    const warranties = uidItems
      .map((item: any) => {
        const normalizedUid = String(item.uid).trim().toUpperCase();
        const warrantyNumber = `WR-${normalizedUid}`;
        if (existingSet.has(warrantyNumber)) return null;

        const warrantyStartDate =
          dispatchData.dispatch_date || new Date().toISOString().split("T")[0];
        const warrantyDurationMonths =
          dispatchData.warranty_duration_months || 12;
        const warrantyEndDate = this.calculateWarrantyEndDate(
          warrantyStartDate,
          warrantyDurationMonths,
        );

        return {
          tenant_id: tenantId,
          warranty_number: warrantyNumber,
          uid: normalizedUid,
          sales_order_id: dispatchData.sales_order_id,
          dispatch_item_id: item.id,
          customer_id: dispatchData.customer_id,
          item_id: item.item_id,
          warranty_start_date: warrantyStartDate,
          warranty_duration_months: warrantyDurationMonths,
          warranty_end_date: warrantyEndDate,
          warranty_type: dispatchData.warranty_type || "STANDARD",
          covered_components: dispatchData.covered_components,
          warranty_terms: dispatchData.warranty_terms,
          status: "ACTIVE",
        };
      })
      .filter(Boolean);

    if (warranties.length === 0) return;

    const { error } = await this.supabase.from("warranties").insert(warranties);

    if (error) throw new BadRequestException(error.message);
  }

  private calculateWarrantyEndDate(
    startDate: string,
    durationMonths: number,
  ): string {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + durationMonths);
    return date.toISOString().split("T")[0];
  }

  /**
   * 🎫 Generate and email issue certificate for dispatched products
   * Automatically triggered when final products are dispatched
   */
  private async generateAndEmailCertificate(
    req: Request,
    dispatchRecord: any,
    salesOrder: any,
    dispatchData: any,
  ) {
    try {
      const { tenantId } = req.user as any;

      // Get customer details
      const { data: customer } = await this.supabase
        .from("customers")
        .select("customer_name, contact_email, contact_person")
        .eq("id", salesOrder.customer_id)
        .single();

      if (!customer || !customer.contact_email) {
        console.warn("⚠️ Certificate not sent - customer email not found");
        return;
      }

      // Get sales order details
      const { data: salesOrderDetails } = await this.supabase
        .from("sales_orders")
        .select("order_number")
        .eq("id", dispatchData.sales_order_id)
        .single();

      // Get dispatch items with product details
      const { data: dispatchItems } = await this.supabase
        .from("dispatch_items")
        .select(
          `
          *,
          items:item_id (
            item_code,
            item_name
          )
        `,
        )
        .eq("dispatch_note_id", dispatchRecord.id);

      if (!dispatchItems || dispatchItems.length === 0) {
        console.warn("⚠️ Certificate not sent - no dispatch items found");
        return;
      }

      // Get warranty information for each item
      const { data: warranties } = await this.supabase
        .from("warranties")
        .select("uid, warranty_duration_months, warranty_end_date")
        .in(
          "uid",
          dispatchItems.map((item: any) => item.uid),
        );

      const warrantyMap = new Map(
        warranties?.map((w: any) => [w.uid, w]) || [],
      );

      // Prepare certificate data
      const certificateData = {
        tenant_id: tenantId,
        certificate_number: `CERT-${dispatchRecord.dn_number}`,
        customer_name: customer.customer_name,
        issue_date: dispatchRecord.dispatch_date,
        so_number: salesOrderDetails?.order_number || "N/A",
        dispatch_number: dispatchRecord.dn_number,
        items: dispatchItems.map((item: any) => {
          const warranty = warrantyMap.get(item.uid);
          const warrantyMonths = warranty?.warranty_duration_months || 12;
          const warrantyYears = Math.floor(warrantyMonths / 12);
          const remainingMonths = warrantyMonths % 12;
          let warrantyPeriod = "";

          if (warrantyYears > 0) {
            warrantyPeriod = `${warrantyYears} Year${warrantyYears > 1 ? "s" : ""}`;
            if (remainingMonths > 0) {
              warrantyPeriod += ` ${remainingMonths} Month${remainingMonths > 1 ? "s" : ""}`;
            }
          } else {
            warrantyPeriod = `${warrantyMonths} Month${warrantyMonths > 1 ? "s" : ""}`;
          }

          return {
            product_name: item.items?.item_name || "Unknown",
            uid_number: item.uid,
            serial_number: item.serial_number,
            warranty_period: warrantyPeriod,
            warranty_expiry: warranty?.warranty_end_date,
          };
        }),
        warranty_info:
          "Standard warranty terms apply as per sales agreement. Please retain this certificate for warranty claims.",
      };

      // Send certificate email
      await this.emailService.sendIssueCertificate(
        customer.contact_email,
        certificateData,
      );

      console.log(
        `✅ Issue certificate sent to ${customer.contact_email} for dispatch ${dispatchRecord.dn_number}`,
      );
    } catch (error) {
      console.error("❌ Failed to send issue certificate:", error);
      // Don't throw - certificate generation failure should not block dispatch
    }
  }

  async getWarranties(req: Request, filters?: any) {
    const { tenantId } = req.user as any;

    let query = this.supabase
      .from("warranties")
      .select(
        `
        *,
        customers:customer_id(customer_code, customer_name, contact_person)
      `,
      )
      .eq("tenant_id", tenantId);

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    if (filters?.uid) {
      query = query.eq("uid", filters.uid);
    }

    if (filters?.customer_id) {
      query = query.eq("customer_id", filters.customer_id);
    }

    const { data, error } = await query.order("warranty_start_date", {
      ascending: false,
    });

    if (error) throw new BadRequestException(error.message);

    // Flatten customer data for frontend
    const formattedData = data?.map((w: any) => ({
      ...w,
      customer_name: w.customers?.customer_name || null,
      customer_code: w.customers?.customer_code || null,
    }));

    return formattedData;
  }

  async validateWarranty(req: Request, uid: string) {
    const { tenantId } = req.user as any;

    const { data: warranty } = await this.supabase
      .from("warranties")
      .select("*")
      .eq("uid", uid)
      .eq("tenant_id", tenantId)
      .eq("status", "ACTIVE")
      .single();

    if (!warranty) {
      return { valid: false, message: "No active warranty found for this UID" };
    }

    const today = new Date().toISOString().split("T")[0];
    if (today > warranty.warranty_end_date) {
      return { valid: false, message: "Warranty has expired", warranty };
    }

    return { valid: true, message: "Warranty is active", warranty };
  }

  async updateWarranty(req: Request, warrantyId: string, warrantyData: any) {
    const { tenantId } = req.user as any;

    const { data: existing, error: fetchError } = await this.supabase
      .from("warranties")
      .select("id")
      .eq("id", warrantyId)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing)
      throw new NotFoundException("Warranty not found");

    const { data, error } = await this.supabase
      .from("warranties")
      .update({
        status: warrantyData.status,
        warranty_type: warrantyData.warranty_type,
        updated_at: new Date().toISOString(),
      })
      .eq("id", warrantyId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteWarranty(req: Request, warrantyId: string) {
    const { tenantId } = req.user as any;

    const { error } = await this.supabase
      .from("warranties")
      .delete()
      .eq("id", warrantyId)
      .eq("tenant_id", tenantId);

    if (error) throw new BadRequestException(error.message);
    return { message: "Warranty deleted successfully" };
  }

  async getDispatchNotes(req: Request, filters?: any) {
    const { tenantId } = req.user as any;

    let query = this.supabase
      .from("dispatch_notes")
      .select(
        `
        *,
        sales_orders:sales_order_id(so_number),
        customers:customer_id(customer_code, customer_name)
      `,
      )
      .eq("tenant_id", tenantId);

    if (filters?.sales_order_id) {
      query = query.eq("sales_order_id", filters.sales_order_id);
    }

    const { data, error } = await query.order("dispatch_date", {
      ascending: false,
    });

    if (error) throw new BadRequestException(error.message);

    // Flatten nested data for frontend
    const formattedData = data?.map((dn: any) => ({
      ...dn,
      so_number: dn.sales_orders?.so_number || null,
      customer_name: dn.customers?.customer_name || null,
      customer_code: dn.customers?.customer_code || null,
    }));

    return formattedData;
  }

  async renderDispatchPdf(req: Request, dispatchId: string) {
    if (!this.quotePdfService)
      throw new BadRequestException("Sales PDF service is unavailable");
    const { tenantId } = req.user as any;
    const { data: dispatch, error } = await this.supabase
      .from("dispatch_notes")
      .select("*, items:dispatch_items(*)")
      .eq("tenant_id", tenantId)
      .eq("id", dispatchId)
      .single();
    if (error || !dispatch)
      throw new NotFoundException("Dispatch note not found");
    const flow: any = await this.getSalesOrderDocumentFlow(
      req,
      dispatch.sales_order_id,
    );
    const orderLines = new Map(
      (flow.sales_order?.sales_order_items || []).map((line: any) => [
        String(line.id),
        line,
      ]),
    );
    const grouped = new Map<string, any>();
    for (const row of dispatch.items || []) {
      const key = String(row.sales_order_item_id || row.item_id || row.id);
      const current = grouped.get(key) || { ...row, quantity: 0 };
      current.quantity += Number(row.quantity || 0);
      grouped.set(key, current);
    }
    const items = [...grouped.values()].map((row: any) => {
      const orderLine: any = orderLines.get(String(row.sales_order_item_id));
      return {
        description:
          orderLine?.item_description ||
          row.item_description ||
          row.item_id ||
          "Dispatched item",
        quantity: Number(row.quantity || 0),
        unit: String(
          orderLine?.ordered_uom || orderLine?.uom || "NOS",
        ).toUpperCase(),
        unit_price: 0,
      };
    });
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      quote_number: dispatch.dn_number,
      quote_date_iso: String(
        dispatch.dispatch_date ||
          dispatch.created_at ||
          new Date().toISOString(),
      ),
      title: String(dispatch.status || "PGI POSTED").replaceAll("_", " "),
      document_label: "DELIVERY / DISPATCH NOTE",
      company: { name: "SAK ERP" },
      customer: this.pdfCustomer(flow.customer),
      items,
      currency: flow.sales_order?.currency_code || "INR",
      show_totals: false,
      notes: [
        flow.sales_order?.so_number
          ? `Sales Order: ${flow.sales_order.so_number}`
          : "",
        dispatch.delivery_address
          ? `Delivery address: ${dispatch.delivery_address}`
          : "",
        dispatch.transporter_name
          ? `Transporter: ${dispatch.transporter_name}`
          : "",
        [dispatch.vehicle_number, dispatch.lr_number].filter(Boolean).length
          ? `Vehicle / LR: ${[dispatch.vehicle_number, dispatch.lr_number].filter(Boolean).join(" / ")}`
          : "",
        dispatch.notes || "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { buffer, filename: this.pdfFilename(dispatch.dn_number) };
  }

  async sendDispatchNoteEmail(
    req: Request,
    dispatchId: string,
    body: any = {},
  ) {
    const { tenantId, userId } = req.user as any;
    const { data: dispatch, error } = await this.supabase
      .from("dispatch_notes")
      .select(
        "id, dn_number, sales_order_id, status, customers:customer_id(customer_name, contact_person, email)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", dispatchId)
      .single();
    if (error || !dispatch)
      throw new NotFoundException("Dispatch note not found");
    if (String(dispatch.status || "").toUpperCase() === "CANCELLED")
      throw new BadRequestException(
        "A cancelled dispatch note cannot be emailed",
      );
    const customer: any = (dispatch as any).customers || {};
    const recipient = normalizeEmail(body?.to || customer.email || "");
    if (!recipient)
      throw new BadRequestException("Enter a valid customer email address");
    const document = await this.renderDispatchPdf(req, dispatchId);
    const subject = String(
      body?.subject || `Dispatch advice ${dispatch.dn_number}`,
    ).trim();
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>${this.escapeSalesHtml(subject)}</h2><p>Dear ${this.escapeSalesHtml(customer.contact_person || customer.customer_name || "Customer")},</p><p>Your order has been dispatched. The official delivery / dispatch note is attached for your records.</p><p><strong>Dispatch note:</strong> ${this.escapeSalesHtml(dispatch.dn_number)}</p></div>`;
    await this.emailService.sendEmail({
      to: recipient,
      subject,
      html,
      from: "sales",
      tenantId,
      attachments: [
        {
          filename: document.filename,
          content: document.buffer,
          contentType: "application/pdf",
        },
      ],
    });
    await this.recordSalesEvent(
      tenantId,
      dispatch.sales_order_id,
      "DISPATCH",
      dispatch.id,
      dispatch.dn_number,
      "DISPATCH_EMAIL_SENT",
      userId,
      `Sent to ${recipient}`,
      { recipient },
    );
    return {
      message: `Dispatch note ${dispatch.dn_number} emailed successfully`,
      recipient,
    };
  }

  // ==================== BILLING / RECEIVABLES ====================

  async getCollectionsWorklist(req: Request, filters: any = {}) {
    const { tenantId } = req.user as any;
    const today = new Date().toISOString().slice(0, 10);
    const [
      { data: salesInvoices, error: salesError },
      { data: serviceInvoices, error: serviceError },
      { data: notices, error: noticeError },
    ] = await Promise.all([
      this.supabase
        .from("invoices")
        .select(
          "id, customer_id, invoice_number, invoice_date, due_date, net_amount, paid_amount, balance_amount, payment_status, billing_status, collection_status, next_follow_up_date, promise_to_pay_date, collection_notes, last_follow_up_at, customer:customers(id, customer_code, customer_name, contact_person, email, phone, mobile)",
        )
        .eq("tenant_id", tenantId)
        .gt("balance_amount", 0),
      this.supabase
        .from("customer_service_invoices")
        .select(
          "id, customer_id, invoice_number, invoice_date, due_date, net_amount, paid_amount, balance_amount, payment_status, billing_status, collection_status, next_follow_up_date, promise_to_pay_date, collection_notes, last_follow_up_at, customer:customers(id, customer_code, customer_name, contact_person, email, phone, mobile), ticket:service_tickets(ticket_number)",
        )
        .eq("tenant_id", tenantId)
        .gt("balance_amount", 0),
      this.supabase
        .from("customer_dunning_notices")
        .select(
          "id, customer_id, notice_number, notice_date, dunning_level, due_by, overdue_amount, status",
        )
        .eq("tenant_id", tenantId)
        .eq("status", "ISSUED")
        .order("notice_date", { ascending: false }),
    ]);
    if (salesError) throw new BadRequestException(salesError.message);
    if (serviceError) throw new BadRequestException(serviceError.message);
    if (noticeError) throw new BadRequestException(noticeError.message);

    const latestNoticeByCustomer = new Map<string, any>();
    for (const notice of notices || []) {
      if (!latestNoticeByCustomer.has(notice.customer_id))
        latestNoticeByCustomer.set(notice.customer_id, notice);
    }
    const normalize = (invoice: any, source: "SALES" | "SERVICE") => {
      const aged = this.withReceivableAgeing(invoice);
      const latestNotice =
        latestNoticeByCustomer.get(invoice.customer_id) || null;
      const collectionStatus = String(
        invoice.collection_status || "NOT_STARTED",
      ).toUpperCase();
      return {
        ...aged,
        source,
        status: collectionStatus,
        source_reference:
          source === "SERVICE" ? invoice.ticket?.ticket_number || null : null,
        latest_dunning: latestNotice,
        follow_up_due: Boolean(
          invoice.next_follow_up_date && invoice.next_follow_up_date <= today,
        ),
        broken_promise: Boolean(
          collectionStatus === "PROMISED" &&
          invoice.promise_to_pay_date &&
          invoice.promise_to_pay_date < today,
        ),
      };
    };
    let rows = [
      ...(salesInvoices || [])
        .filter(
          (invoice: any) =>
            String(invoice.billing_status || "").toUpperCase() !== "CANCELLED",
        )
        .map((invoice: any) => normalize(invoice, "SALES")),
      ...(serviceInvoices || [])
        .filter(
          (invoice: any) =>
            String(invoice.billing_status || "").toUpperCase() !== "CANCELLED",
        )
        .map((invoice: any) => normalize(invoice, "SERVICE")),
    ];
    if (filters.source)
      rows = rows.filter(
        (row: any) => row.source === String(filters.source).toUpperCase(),
      );
    if (filters.customer_id)
      rows = rows.filter((row: any) => row.customer_id === filters.customer_id);
    if (filters.overdue === "true" || filters.overdue === true)
      rows = rows.filter((row: any) => Number(row.days_overdue || 0) > 0);
    rows.sort(
      (a: any, b: any) =>
        Number(b.broken_promise) - Number(a.broken_promise) ||
        Number(b.days_overdue || 0) - Number(a.days_overdue || 0) ||
        String(a.due_date || "").localeCompare(String(b.due_date || "")),
    );

    return {
      as_of: today,
      summary: {
        open_items: rows.length,
        total_outstanding: this.roundMoney(
          rows.reduce(
            (sum: number, row: any) => sum + Number(row.balance_amount || 0),
            0,
          ),
        ),
        overdue_outstanding: this.roundMoney(
          rows
            .filter((row: any) => Number(row.days_overdue || 0) > 0)
            .reduce(
              (sum: number, row: any) => sum + Number(row.balance_amount || 0),
              0,
            ),
        ),
        follow_ups_due: rows.filter((row: any) => row.follow_up_due).length,
        broken_promises: rows.filter((row: any) => row.broken_promise).length,
      },
      items: rows,
    };
  }

  async getInvoices(req: Request, filters?: any) {
    const { tenantId } = req.user as any;
    let query = this.supabase
      .from("invoices")
      .select(
        "*, customer:customers(customer_code, customer_name), sales_order:sales_orders(so_number), dispatch_note:dispatch_notes(dn_number)",
      )
      .eq("tenant_id", tenantId)
      .order("invoice_date", { ascending: false });
    if (filters?.payment_status)
      query = query.eq("payment_status", filters.payment_status);
    if (filters?.customer_id)
      query = query.eq("customer_id", filters.customer_id);
    if (filters?.sales_order_id)
      query = query.eq("sales_order_id", filters.sales_order_id);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((invoice: any) =>
      this.withReceivableAgeing(invoice),
    );
  }

  async getInvoiceById(req: Request, invoiceId: string) {
    const { tenantId } = req.user as any;
    const { data, error } = await this.supabase
      .from("invoices")
      .select(
        `
        *,
        customer:customers(*),
        sales_order:sales_orders(so_number, order_date, payment_terms),
        dispatch_note:dispatch_notes(dn_number, dispatch_date),
        items:sales_invoice_items(*),
        payments:sales_invoice_payments(*),
        credit_notes:sales_credit_notes(*)
      `,
      )
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .single();
    if (error || !data) throw new NotFoundException("Sales invoice not found");
    return this.withReceivableAgeing(data);
  }

  async updateInvoiceStatutoryDetails(
    req: Request,
    invoiceId: string,
    body: any = {},
  ) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    if (String(invoice.billing_status || "").toUpperCase() === "CANCELLED") {
      throw new BadRequestException(
        "Statutory details cannot be changed on a cancelled invoice",
      );
    }

    const notApplicable = body?.not_applicable === true;
    const clean = (value: any) => String(value ?? "").trim() || null;
    const irn = clean(body?.irn)?.toUpperCase() || null;
    const ackNumber = clean(body?.irn_ack_number)?.toUpperCase() || null;
    const ackDate = clean(body?.irn_ack_date);
    const ewayNumber = clean(body?.eway_bill_number)?.toUpperCase() || null;
    const ewayDate = clean(body?.eway_bill_date);
    const ewayValidUntil = clean(body?.eway_bill_valid_until);
    const exemptionReason = clean(body?.statutory_exemption_reason);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const isRealDate = (value: string | null) => {
      if (!value || !datePattern.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    };

    if (notApplicable) {
      if (!exemptionReason)
        throw new BadRequestException(
          "Enter the reason why statutory references are not applicable",
        );
    } else {
      if (!irn && !ewayNumber)
        throw new BadRequestException(
          "Enter an IRN or e-way bill number, or mark statutory references as not applicable",
        );
      if (irn && (!ackNumber || !ackDate))
        throw new BadRequestException(
          "IRN acknowledgement number and date are required when IRN is entered",
        );
      if (!irn && (ackNumber || ackDate))
        throw new BadRequestException(
          "Enter the IRN linked to the acknowledgement",
        );
      if (ewayNumber && (!ewayDate || !ewayValidUntil))
        throw new BadRequestException(
          "E-way bill date and validity date are required when an e-way bill number is entered",
        );
      if (!ewayNumber && (ewayDate || ewayValidUntil))
        throw new BadRequestException(
          "Enter the e-way bill number linked to its dates",
        );
    }
    for (const [label, value] of [
      ["IRN acknowledgement date", ackDate],
      ["E-way bill date", ewayDate],
      ["E-way bill validity date", ewayValidUntil],
    ] as const) {
      if (value && !isRealDate(value))
        throw new BadRequestException(`${label} must be a valid date`);
    }
    if (ackDate && ackDate > this.getCurrentBusinessDate())
      throw new BadRequestException(
        "IRN acknowledgement date cannot be in the future",
      );
    if (ewayDate && ewayDate > this.getCurrentBusinessDate())
      throw new BadRequestException("E-way bill date cannot be in the future");
    if (ewayDate && ewayValidUntil && ewayValidUntil < ewayDate)
      throw new BadRequestException(
        "E-way bill validity date cannot be before its generation date",
      );

    const update = notApplicable
      ? {
          irn: null,
          irn_ack_number: null,
          irn_ack_date: null,
          eway_bill_number: null,
          eway_bill_date: null,
          eway_bill_valid_until: null,
          statutory_status: "NOT_APPLICABLE",
          statutory_exemption_reason: exemptionReason,
        }
      : {
          irn,
          irn_ack_number: ackNumber,
          irn_ack_date: ackDate,
          eway_bill_number: ewayNumber,
          eway_bill_date: ewayDate,
          eway_bill_valid_until: ewayValidUntil,
          statutory_status: "RECORDED",
          statutory_exemption_reason: null,
        };
    const { error } = await this.supabase
      .from("invoices")
      .update({
        ...update,
        statutory_updated_at: new Date().toISOString(),
        statutory_updated_by: userId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId);
    if (error) {
      if (
        String(error.message || "")
          .toLowerCase()
          .includes("unique")
      ) {
        throw new BadRequestException(
          "This IRN or e-way bill number is already linked to another invoice",
        );
      }
      throw new BadRequestException(
        error.message || "Statutory details could not be saved",
      );
    }
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "INVOICE",
      invoice.id,
      invoice.invoice_number,
      "STATUTORY_DETAILS_UPDATED",
      userId,
      exemptionReason,
      {
        statutory_status: update.statutory_status,
        irn,
        irn_ack_number: ackNumber,
        irn_ack_date: ackDate,
        eway_bill_number: ewayNumber,
        eway_bill_date: ewayDate,
        eway_bill_valid_until: ewayValidUntil,
      },
    );
    return this.getInvoiceById(req, invoiceId);
  }

  async renderSalesInvoicePdf(req: Request, invoiceId: string) {
    if (!this.quotePdfService)
      throw new BadRequestException("Sales PDF service is unavailable");
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    const tenantId = (req.user as any).tenantId;
    const lines = invoice.items || [];
    const taxable = lines.reduce(
      (sum: number, line: any) =>
        sum + Number(line.taxable_amount ?? line.line_total ?? 0),
      0,
    );
    const tax = lines.reduce(
      (sum: number, line: any) => sum + Number(line.tax_amount || 0),
      0,
    );
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      quote_number: invoice.invoice_number,
      quote_date_iso: String(
        invoice.invoice_date || invoice.created_at || new Date().toISOString(),
      ),
      title: String(
        invoice.payment_status || invoice.billing_status || "POSTED",
      ).replaceAll("_", " "),
      document_label: "TAX INVOICE",
      company: { name: "SAK ERP" },
      customer: this.pdfCustomer(invoice.customer),
      items: this.buildPdfItems(lines),
      currency: invoice.currency_code || "INR",
      tax_rate: taxable > 0 ? tax / taxable : 0,
      discount: Number(invoice.discount_amount || 0),
      notes: [
        invoice.sales_order?.so_number
          ? `Sales Order: ${invoice.sales_order.so_number}`
          : "",
        invoice.dispatch_note?.dn_number
          ? `Dispatch: ${invoice.dispatch_note.dn_number}`
          : "",
        invoice.irn ? `IRN: ${invoice.irn}` : "",
        invoice.irn_ack_number
          ? `IRN acknowledgement: ${invoice.irn_ack_number}${invoice.irn_ack_date ? ` dated ${String(invoice.irn_ack_date).slice(0, 10)}` : ""}`
          : "",
        invoice.eway_bill_number
          ? `E-way bill: ${invoice.eway_bill_number}${invoice.eway_bill_date ? ` dated ${String(invoice.eway_bill_date).slice(0, 10)}` : ""}${invoice.eway_bill_valid_until ? ` valid until ${String(invoice.eway_bill_valid_until).slice(0, 10)}` : ""}`
          : "",
        invoice.statutory_status === "NOT_APPLICABLE"
          ? `Statutory reference: Not applicable - ${invoice.statutory_exemption_reason || ""}`
          : "",
        invoice.due_date
          ? `Due date: ${String(invoice.due_date).slice(0, 10)}`
          : "",
        `Outstanding: ${Number(invoice.balance_amount || 0).toFixed(2)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { buffer, filename: this.pdfFilename(invoice.invoice_number) };
  }

  async renderCustomerReceiptPdf(
    req: Request,
    invoiceId: string,
    paymentId: string,
  ) {
    if (!this.quotePdfService)
      throw new BadRequestException("Sales PDF service is unavailable");
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    const payment = (invoice.payments || []).find(
      (entry: any) => String(entry.id) === String(paymentId),
    );
    if (!payment) throw new NotFoundException("Customer receipt not found");
    const tenantId = (req.user as any).tenantId;
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      quote_number: payment.receipt_number,
      quote_date_iso: String(
        payment.receipt_date || payment.created_at || new Date().toISOString(),
      ),
      title: payment.reversed_at ? "REVERSED" : "POSTED",
      document_label: "CUSTOMER RECEIPT VOUCHER",
      company: { name: "SAK ERP" },
      customer: this.pdfCustomer(invoice.customer),
      items: [
        {
          description: `Payment received against invoice ${invoice.invoice_number}`,
          quantity: 1,
          unit: "RECEIPT",
          unit_price: Number(payment.amount || 0),
        },
      ],
      currency: invoice.currency_code || "INR",
      notes: [
        invoice.sales_order?.so_number
          ? `Sales Order: ${invoice.sales_order.so_number}`
          : "",
        payment.payment_method
          ? `Payment method: ${payment.payment_method}`
          : "",
        payment.payment_reference
          ? `Transaction reference: ${payment.payment_reference}`
          : "",
        payment.reversal_reason
          ? `Reversal reason: ${payment.reversal_reason}`
          : payment.notes || "",
        `Invoice value: ${Number(invoice.net_amount || 0).toFixed(2)}`,
        `Current outstanding: ${Number(invoice.balance_amount || 0).toFixed(2)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { buffer, filename: this.pdfFilename(payment.receipt_number) };
  }

  async sendCustomerReceiptEmail(
    req: Request,
    invoiceId: string,
    paymentId: string,
    body: any = {},
  ) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    const payment = (invoice.payments || []).find(
      (entry: any) => String(entry.id) === String(paymentId),
    );
    if (!payment) throw new NotFoundException("Customer receipt not found");
    if (payment.reversed_at)
      throw new BadRequestException(
        "A reversed customer receipt cannot be emailed",
      );
    const recipient = normalizeEmail(body?.to || invoice.customer?.email || "");
    if (!recipient)
      throw new BadRequestException("Enter a valid customer email address");
    const document = await this.renderCustomerReceiptPdf(
      req,
      invoiceId,
      paymentId,
    );
    const subject = String(
      body?.subject || `Payment receipt ${payment.receipt_number}`,
    ).trim();
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>${this.escapeSalesHtml(subject)}</h2><p>Dear ${this.escapeSalesHtml(invoice.customer?.contact_person || invoice.customer?.customer_name || "Customer")},</p><p>Thank you. We have recorded your payment against invoice <strong>${this.escapeSalesHtml(invoice.invoice_number)}</strong>.</p><p><strong>Receipt:</strong> ${this.escapeSalesHtml(payment.receipt_number)}<br><strong>Amount received:</strong> Rs. ${this.formatSalesMoney(payment.amount)}</p><p>The official customer receipt voucher is attached.</p></div>`;
    await this.emailService.sendEmail({
      to: recipient,
      subject,
      html,
      from: "sales",
      tenantId,
      attachments: [
        {
          filename: document.filename,
          content: document.buffer,
          contentType: "application/pdf",
        },
      ],
    });
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "PAYMENT",
      payment.id,
      payment.receipt_number,
      "CUSTOMER_RECEIPT_EMAIL_SENT",
      userId,
      `Sent to ${recipient}`,
      { recipient, invoice_id: invoiceId },
    );
    return {
      message: `Customer receipt ${payment.receipt_number} emailed successfully`,
      recipient,
    };
  }

  async sendInvoiceEmail(req: Request, invoiceId: string, body: any = {}) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    const recipient = String(body?.to || invoice.customer?.email || "").trim();
    if (!recipient) throw new BadRequestException("Customer email is required");
    const subject = String(
      body?.subject || `Sales invoice ${invoice.invoice_number}`,
    ).trim();
    const rows = (invoice.items || [])
      .map(
        (item: any, index: number) =>
          `<tr><td>${index + 1}</td><td>${this.escapeSalesHtml(item.item_description || "Item")}</td><td>${Number(item.quantity || 0)}</td><td>Rs. ${this.formatSalesMoney(item.unit_price)}</td><td>Rs. ${this.formatSalesMoney(item.line_total)}</td></tr>`,
      )
      .join("");
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>Sales Invoice ${this.escapeSalesHtml(invoice.invoice_number)}</h2><p>Dear ${this.escapeSalesHtml(invoice.customer?.contact_person || invoice.customer?.customer_name || "Customer")},</p><p>Please find the invoice summary below.</p><table style="border-collapse:collapse;width:100%"><thead><tr><th style="border:1px solid #ddd;padding:8px">No.</th><th style="border:1px solid #ddd;padding:8px">Item</th><th style="border:1px solid #ddd;padding:8px">Qty</th><th style="border:1px solid #ddd;padding:8px">Rate</th><th style="border:1px solid #ddd;padding:8px">Amount</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Invoice value: Rs. ${this.formatSalesMoney(invoice.net_amount)}</strong><br>Outstanding: Rs. ${this.formatSalesMoney(invoice.balance_amount)}<br>Due date: ${this.escapeSalesHtml(String(invoice.due_date || "-").slice(0, 10))}</p></div>`;
    const pdf = this.quotePdfService
      ? await this.renderSalesInvoicePdf(req, invoiceId)
      : null;
    await this.emailService.sendEmail({
      to: recipient,
      subject,
      html,
      from: "sales",
      tenantId,
      attachments: pdf
        ? [
            {
              filename: pdf.filename,
              content: pdf.buffer,
              contentType: "application/pdf",
            },
          ]
        : [],
    });
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "INVOICE",
      invoice.id,
      invoice.invoice_number,
      "INVOICE_EMAIL_SENT",
      userId,
      `Sent to ${recipient}`,
      { recipient },
    );
    return { message: "Sales invoice emailed successfully", recipient };
  }

  async recordInvoiceCollectionAction(
    req: Request,
    invoiceId: string,
    body: any,
  ) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    if (invoice.billing_status === "CANCELLED")
      throw new BadRequestException("Cancelled invoice cannot be followed up");
    if (Number(invoice.balance_amount || 0) <= 0)
      throw new BadRequestException(
        "Paid invoice has no open receivable to follow up",
      );
    const status = String(body?.collection_status || "")
      .trim()
      .toUpperCase();
    const allowed = [
      "NOT_STARTED",
      "CONTACTED",
      "PROMISED",
      "DISPUTED",
      "ESCALATED",
    ];
    if (!allowed.includes(status))
      throw new BadRequestException(
        `Collection status must be one of ${allowed.join(", ")}`,
      );
    const notes = String(body?.notes || "").trim();
    if (!notes)
      throw new BadRequestException("Collection follow-up notes are required");
    if (status === "PROMISED" && !body?.promise_to_pay_date)
      throw new BadRequestException(
        "Promise-to-pay date is required for PROMISED status",
      );
    const { data, error } = await this.supabase
      .from("invoices")
      .update({
        collection_status: status,
        last_follow_up_at: new Date().toISOString(),
        last_follow_up_by: userId,
        next_follow_up_date: body?.next_follow_up_date || null,
        promise_to_pay_date: body?.promise_to_pay_date || null,
        collection_notes: notes,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .select()
      .single();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Collection follow-up could not be saved",
      );
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "INVOICE",
      invoice.id,
      invoice.invoice_number,
      "COLLECTION_FOLLOW_UP",
      userId,
      notes,
      {
        collection_status: status,
        next_follow_up_date: body?.next_follow_up_date || null,
        promise_to_pay_date: body?.promise_to_pay_date || null,
        balance_amount: invoice.balance_amount,
      },
    );
    return this.withReceivableAgeing(data);
  }

  async createInvoiceFromDispatch(
    req: Request,
    dispatchId: string,
    body: any = {},
  ) {
    const { tenantId, userId } = req.user as any;
    const regional = await this.getTenantRegionalDefaults(tenantId);
    const { data: dispatch, error: dispatchError } = await this.supabase
      .from("dispatch_notes")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", dispatchId)
      .single();
    if (dispatchError || !dispatch)
      throw new NotFoundException("Dispatch note not found");
    if (dispatch.status === "CANCELLED")
      throw new BadRequestException("Cancelled dispatch cannot be billed");
    if (!["PGI_POSTED", "DELIVERED"].includes(String(dispatch.status || ""))) {
      throw new BadRequestException(
        "Only a PGI-posted or delivered dispatch can be billed",
      );
    }

    const { data: orderControl, error: orderControlError } = await this.supabase
      .from("sales_orders")
      .select(
        "status, release_status, billing_block, block_reason, currency_code, place_of_supply, customer:customers(billing_blocked, block_reason)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", dispatch.sales_order_id)
      .single();
    if (orderControlError || !orderControl)
      throw new NotFoundException("Sales order not found for billing");
    if (
      String(orderControl.release_status || "").toUpperCase() !== "RELEASED"
    ) {
      throw new BadRequestException(
        "Sales order must be commercially released before billing",
      );
    }
    if (String(orderControl.status || "").toUpperCase() === "CANCELLED") {
      throw new BadRequestException("Cancelled sales order cannot be billed");
    }
    const billingCustomer: any = Array.isArray((orderControl as any).customer)
      ? (orderControl as any).customer[0]
      : (orderControl as any).customer;
    if (orderControl.billing_block || billingCustomer?.billing_blocked) {
      throw new BadRequestException(
        `Billing is blocked${orderControl.block_reason || billingCustomer?.block_reason ? `: ${orderControl.block_reason || billingCustomer.block_reason}` : ""}`,
      );
    }

    const { data: existingInvoice, error: existingInvoiceError } =
      await this.supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("tenant_id", tenantId)
        .eq("dispatch_note_id", dispatchId)
        .neq("billing_status", "CANCELLED")
        .maybeSingle();
    if (existingInvoiceError)
      throw new BadRequestException(existingInvoiceError.message);
    if (existingInvoice) {
      throw new BadRequestException(
        `Dispatch is already billed on ${existingInvoice.invoice_number}`,
      );
    }

    const { data: dispatchItems, error: dispatchItemsError } =
      await this.supabase
        .from("dispatch_items")
        .select("*")
        .eq("dispatch_note_id", dispatchId);
    if (dispatchItemsError || !dispatchItems?.length) {
      throw new BadRequestException("Dispatch has no billable item quantities");
    }

    const soItemIds = [
      ...new Set(
        dispatchItems
          .map((line: any) => line.sales_order_item_id)
          .filter(Boolean),
      ),
    ];
    const { data: orderItems, error: orderItemsError } = await this.supabase
      .from("sales_order_items")
      .select("*")
      .eq("sales_order_id", dispatch.sales_order_id)
      .in("id", soItemIds);
    if (orderItemsError) throw new BadRequestException(orderItemsError.message);
    const orderItemsById = new Map(
      (orderItems || []).map((line: any) => [line.id, line]),
    );

    const invoiceLines = dispatchItems.map((dispatchLine: any) => {
      const orderLine: any = orderItemsById.get(
        dispatchLine.sales_order_item_id,
      );
      if (!orderLine)
        throw new BadRequestException(
          "Dispatch line is not linked to a valid sales-order line",
        );
      const orderedQty = Number(orderLine.quantity || 0);
      const billedQty = Number(dispatchLine.quantity || 0);
      if (!Number.isFinite(billedQty) || billedQty <= 0) {
        throw new BadRequestException(
          "Every billed dispatch line must have a positive quantity",
        );
      }
      if (
        String(dispatchLine.item_id || "") !== String(orderLine.item_id || "")
      ) {
        throw new BadRequestException(
          "Dispatch item does not match its sales-order line",
        );
      }
      const conversionFactor = Number(orderLine.uom_conversion_factor || 1);
      if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
        throw new BadRequestException(
          "Sales-order line has an invalid UOM conversion factor",
        );
      }
      const billedSalesQuantity = billedQty / conversionFactor;
      const priceUomFactor = Number(orderLine.price_uom_factor || 1);
      if (!Number.isFinite(priceUomFactor) || priceUomFactor <= 0) {
        throw new BadRequestException(
          "Sales-order line has an invalid price UOM factor",
        );
      }
      const billedPricingQuantity = billedQty / priceUomFactor;
      const gross = billedPricingQuantity * Number(orderLine.unit_price || 0);
      const proportionalDiscount =
        orderedQty > 0
          ? Number(orderLine.discount_amount || 0) * (billedQty / orderedQty)
          : 0;
      const taxable = Math.max(0, gross - proportionalDiscount);
      const tax = (taxable * Number(orderLine.tax_percentage || 0)) / 100;
      return {
        sales_order_item_id: orderLine.id,
        dispatch_item_id: dispatchLine.id,
        item_id: dispatchLine.item_id,
        item_description: orderLine.item_description,
        quantity: billedQty,
        sales_quantity: billedSalesQuantity,
        base_uom: orderLine.base_uom || orderLine.ordered_uom || "PCS",
        uom_conversion_factor: conversionFactor,
        price_uom: orderLine.price_uom || orderLine.ordered_uom || "PCS",
        price_uom_factor: priceUomFactor,
        unit_price: this.roundMoney(orderLine.unit_price),
        discount_amount: this.roundMoney(proportionalDiscount),
        taxable_amount: this.roundMoney(taxable),
        tax_percentage: Number(orderLine.tax_percentage || 0),
        tax_amount: this.roundMoney(tax),
        line_total: this.roundMoney(taxable + tax),
        ordered_uom: orderLine.ordered_uom || "NOS",
        hsn_code: orderLine.hsn_code || null,
      };
    });

    const taxableAmount = this.roundMoney(
      invoiceLines.reduce((sum, line) => sum + line.taxable_amount, 0),
    );
    const taxAmount = this.roundMoney(
      invoiceLines.reduce((sum, line) => sum + line.tax_amount, 0),
    );
    const netAmount = this.roundMoney(taxableAmount + taxAmount);
    const allowedTaxTypes =
      regional.marketProfile === "UAE" ? ["VAT"] : ["CGST_SGST", "IGST"];
    const taxType = String(
      body.tax_type || (regional.marketProfile === "UAE" ? "VAT" : "IGST"),
    )
      .trim()
      .toUpperCase();
    if (!allowedTaxTypes.includes(taxType)) {
      throw new BadRequestException(
        `Tax type must be ${allowedTaxTypes.join(" or ")}`,
      );
    }
    const cgstAmount =
      taxType === "CGST_SGST" ? this.roundMoney(taxAmount / 2) : 0;
    const sgstAmount =
      taxType === "CGST_SGST" ? this.roundMoney(taxAmount - cgstAmount) : 0;
    const igstAmount = taxType === "IGST" ? taxAmount : 0;
    const { invoiceDate, dueDate } = this.validateInvoiceDates(
      body.invoice_date,
      body.due_date,
      dispatch.dispatch_date,
    );
    const invoiceNumber = await this.generateSalesInvoiceNumber(tenantId);

    const { data: invoice, error: invoiceError } = await this.supabase
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        sales_order_id: dispatch.sales_order_id,
        dispatch_note_id: dispatch.id,
        customer_id: dispatch.customer_id,
        invoice_date: invoiceDate,
        due_date: dueDate,
        total_amount: taxableAmount,
        tax_amount: taxAmount,
        net_amount: netAmount,
        paid_amount: 0,
        balance_amount: netAmount,
        payment_status: "PENDING",
        billing_status: "POSTED",
        notes: body.notes || null,
        external_reference: body.external_reference || null,
        currency_code: orderControl.currency_code || "INR",
        place_of_supply:
          body.place_of_supply || orderControl.place_of_supply || null,
        tax_type: taxType,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        created_by: userId,
        posted_by: userId,
        posted_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (invoiceError || !invoice) {
      if (
        invoiceError?.code === "23505" &&
        String(invoiceError.message || "").includes("dispatch")
      ) {
        throw new BadRequestException("This dispatch has already been billed");
      }
      throw new BadRequestException(
        invoiceError?.message || "Invoice creation failed",
      );
    }

    const { error: linesError } = await this.supabase
      .from("sales_invoice_items")
      .insert(
        invoiceLines.map((line) => ({ ...line, invoice_id: invoice.id })),
      );
    if (linesError) {
      await this.supabase
        .from("invoices")
        .delete()
        .eq("id", invoice.id)
        .eq("tenant_id", tenantId);
      throw new BadRequestException(linesError.message);
    }

    await this.recordSalesEvent(
      tenantId,
      dispatch.sales_order_id,
      "INVOICE",
      invoice.id,
      invoice.invoice_number,
      "INVOICE_POSTED",
      userId,
      null,
      { net_amount: invoice.net_amount, tax_type: invoice.tax_type },
    );
    // Create an idempotent draft GL voucher only when Finance has explicitly
    // configured an active SALES_INVOICE posting rule. Billing remains usable
    // while the finance chart/rules are still being configured.
    await this.accountingService?.queueAutomaticOperationalPosting(
      tenantId,
      userId,
      {
        source_type: "SALES_INVOICE",
        source_id: invoice.id,
        source_number: invoice.invoice_number,
        amount: Number(invoice.net_amount || 0),
        journal_date: invoice.invoice_date,
        narration: `Sales invoice ${invoice.invoice_number}`,
      },
    );
    return this.getInvoiceById(req, invoice.id);
  }

  async recordInvoicePayment(req: Request, invoiceId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    if (invoice.billing_status === "CANCELLED")
      throw new BadRequestException("Cancelled invoice cannot receive payment");
    const amount = this.roundMoney(body.amount);
    if (amount <= 0)
      throw new BadRequestException("Receipt amount must be greater than zero");
    const balance = this.roundMoney(invoice.balance_amount);
    if (amount > balance)
      throw new BadRequestException(
        `Receipt amount exceeds outstanding balance of ${balance.toFixed(2)}`,
      );
    const paymentMethod = String(body.payment_method || "")
      .trim()
      .toUpperCase();
    const paymentReference =
      String(body.payment_reference || "").trim() || null;
    if (!paymentMethod)
      throw new BadRequestException("Payment method is required");
    if (paymentMethod !== "CASH" && !paymentReference) {
      throw new BadRequestException(
        "Transaction reference is required for non-cash receipts",
      );
    }
    const receiptDate = this.validateReceiptDate(
      body.receipt_date,
      invoice.invoice_date,
    );

    const receiptNumber = await this.generateCustomerReceiptNumber(tenantId);
    const { data: payment, error } = await this.supabase
      .from("sales_invoice_payments")
      .insert({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        receipt_number: receiptNumber,
        receipt_date: receiptDate,
        amount,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        notes: body.notes || null,
        received_by: userId,
      })
      .select()
      .single();
    if (error || !payment)
      throw new BadRequestException(error?.message || "Payment posting failed");

    const paidAmount = this.roundMoney(
      Number(invoice.paid_amount || 0) + amount,
    );
    const newBalance = this.roundMoney(
      Number(invoice.net_amount || 0) -
        paidAmount -
        Number(invoice.credited_amount || 0),
    );
    const paymentStatus = newBalance <= 0 ? "PAID" : "PARTIAL";
    const { data: updatedInvoice, error: updateError } = await this.supabase
      .from("invoices")
      .update({
        paid_amount: paidAmount,
        balance_amount: newBalance,
        payment_status: paymentStatus,
        collection_status:
          newBalance <= 0
            ? "CLOSED"
            : invoice.collection_status || "NOT_STARTED",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .eq("paid_amount", Number(invoice.paid_amount || 0))
      .eq("balance_amount", Number(invoice.balance_amount || 0))
      .select("id")
      .maybeSingle();
    if (updateError || !updatedInvoice) {
      await this.supabase
        .from("sales_invoice_payments")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", payment.id);
      throw new BadRequestException(
        updateError?.message ||
          "Invoice balance changed while posting. Reload the invoice and post the receipt again.",
      );
    }
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "PAYMENT",
      payment.id,
      payment.receipt_number,
      "CUSTOMER_RECEIPT_POSTED",
      userId,
      body.notes,
      { amount, invoice_id: invoiceId },
    );
    // Creates an idempotent finance draft only when the tenant has enabled a
    // SALES_RECEIPT posting rule; operational receipt entry remains available
    // while the chart and posting rules are being configured.
    await this.accountingService?.queueAutomaticOperationalPosting(
      tenantId,
      userId,
      {
        source_type: "SALES_RECEIPT",
        source_id: payment.id,
        source_number: payment.receipt_number,
        amount,
        journal_date: receiptDate,
        narration: `Customer receipt ${payment.receipt_number} against ${invoice.invoice_number}`,
      },
    );
    return {
      ...payment,
      invoice_number: invoice.invoice_number,
      balance_amount: newBalance,
      payment_status: paymentStatus,
    };
  }

  async cancelInvoice(req: Request, invoiceId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    if (invoice.billing_status === "CANCELLED")
      throw new BadRequestException("Invoice is already cancelled");
    if (!String(body?.reason || "").trim())
      throw new BadRequestException("Cancellation reason is required");
    const activePayments = (invoice.payments || []).filter(
      (payment: any) => !payment.reversed_at,
    );
    if (activePayments.length > 0) {
      throw new BadRequestException(
        "Reverse all customer receipts before cancelling this invoice",
      );
    }
    const activeCredits = (invoice.credit_notes || []).filter(
      (credit: any) => credit.status === "POSTED",
    );
    if (activeCredits.length > 0) {
      throw new BadRequestException(
        "Cancel all posted credit notes before cancelling this invoice",
      );
    }
    const { data, error } = await this.supabase
      .from("invoices")
      .update({
        billing_status: "CANCELLED",
        payment_status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId,
        cancellation_reason: String(body.reason).trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .select()
      .single();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Invoice cancellation failed",
      );
    return data;
  }

  async reverseInvoicePayment(
    req: Request,
    invoiceId: string,
    paymentId: string,
    body: any,
  ) {
    const { tenantId, userId } = req.user as any;
    const reason = String(body?.reason || "").trim();
    if (!reason) throw new BadRequestException("Reversal reason is required");
    const { data: invoice, error: invoiceError } = await this.supabase
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .single();
    if (invoiceError || !invoice)
      throw new NotFoundException("Customer invoice not found");
    if (invoice.billing_status === "CANCELLED")
      throw new BadRequestException(
        "A receipt on a cancelled invoice cannot be reversed",
      );
    const { data: payment, error: paymentError } = await this.supabase
      .from("sales_invoice_payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("invoice_id", invoiceId)
      .eq("id", paymentId)
      .single();
    if (paymentError || !payment)
      throw new NotFoundException("Customer receipt not found");
    if (payment.reversed_at)
      throw new BadRequestException("Customer receipt is already reversed");

    const reversedAt = new Date().toISOString();
    const { data: reversedPayment, error: reverseError } = await this.supabase
      .from("sales_invoice_payments")
      .update({
        reversed_at: reversedAt,
        reversed_by: userId,
        reversal_reason: reason,
      })
      .eq("tenant_id", tenantId)
      .eq("id", paymentId)
      .is("reversed_at", null)
      .select("id")
      .maybeSingle();
    if (reverseError) throw new BadRequestException(reverseError.message);
    if (!reversedPayment)
      throw new BadRequestException("Customer receipt is already reversed");
    const paidAmount = this.roundMoney(
      Math.max(
        0,
        Number(invoice.paid_amount || 0) - Number(payment.amount || 0),
      ),
    );
    const balanceAmount = this.roundMoney(
      Number(invoice.net_amount || 0) -
        paidAmount -
        Number(invoice.credited_amount || 0),
    );
    const paymentStatus =
      paidAmount <= 0 ? "PENDING" : balanceAmount <= 0 ? "PAID" : "PARTIAL";
    const { data: updatedInvoice, error: updateError } = await this.supabase
      .from("invoices")
      .update({
        paid_amount: paidAmount,
        balance_amount: balanceAmount,
        payment_status: paymentStatus,
        collection_status:
          balanceAmount > 0 ? "NOT_STARTED" : invoice.collection_status,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .eq("paid_amount", Number(invoice.paid_amount || 0))
      .eq("balance_amount", Number(invoice.balance_amount || 0))
      .select("id")
      .maybeSingle();
    if (updateError || !updatedInvoice) {
      await this.supabase
        .from("sales_invoice_payments")
        .update({ reversed_at: null, reversed_by: null, reversal_reason: null })
        .eq("tenant_id", tenantId)
        .eq("id", paymentId)
        .eq("reversed_at", reversedAt);
      throw new BadRequestException(
        updateError?.message ||
          "Invoice balance changed while reversing. Reload the invoice and try again.",
      );
    }
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "PAYMENT",
      payment.id,
      payment.receipt_number,
      "CUSTOMER_RECEIPT_REVERSED",
      userId,
      reason,
      { amount: payment.amount, invoice_id: invoiceId },
    );
    return {
      ...payment,
      reversed_at: reversedAt,
      reversal_reason: reason,
      invoice_number: invoice.invoice_number,
      paid_amount: paidAmount,
      balance_amount: balanceAmount,
      payment_status: paymentStatus,
    };
  }

  async getInvoiceCreditNotes(req: Request, invoiceId: string) {
    const { tenantId } = req.user as any;
    await this.getInvoiceById(req, invoiceId);
    const { data, error } = await this.supabase
      .from("sales_credit_notes")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("invoice_id", invoiceId)
      .order("credit_note_date", { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createSalesCreditNote(req: Request, invoiceId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    if (invoice.billing_status === "CANCELLED")
      throw new BadRequestException("Cancelled invoice cannot be credited");
    const reason = String(body?.reason || "").trim();
    if (!reason)
      throw new BadRequestException("Credit-note reason is required");
    const taxableAmount = this.roundMoney(body?.taxable_amount);
    const taxPercentage = Number(body?.tax_percentage || 0);
    if (
      taxableAmount < 0 ||
      !Number.isFinite(taxPercentage) ||
      taxPercentage < 0 ||
      taxPercentage > 100
    ) {
      throw new BadRequestException(
        "Credit-note taxable amount and tax percentage must be valid positive values",
      );
    }
    const taxAmount = this.roundMoney((taxableAmount * taxPercentage) / 100);
    const netAmount = this.roundMoney(taxableAmount + taxAmount);
    if (netAmount <= 0)
      throw new BadRequestException(
        "Credit-note amount must be greater than zero",
      );
    const balance = this.roundMoney(invoice.balance_amount);
    if (netAmount > balance) {
      throw new BadRequestException(
        `Credit note exceeds outstanding invoice balance of ${balance.toFixed(2)}`,
      );
    }

    const creditNoteDate = this.validateCreditNoteDate(
      body.credit_note_date,
      invoice.invoice_date,
    );
    const creditNoteNumber = await this.generateSalesCreditNoteNumber(tenantId);
    const { data: creditNote, error } = await this.supabase
      .from("sales_credit_notes")
      .insert({
        tenant_id: tenantId,
        credit_note_number: creditNoteNumber,
        invoice_id: invoiceId,
        credit_note_date: creditNoteDate,
        taxable_amount: taxableAmount,
        tax_percentage: taxPercentage,
        tax_amount: taxAmount,
        net_amount: netAmount,
        reason,
        external_reference:
          String(body.external_reference || "").trim() || null,
        created_by: userId,
      })
      .select()
      .single();
    if (error || !creditNote)
      throw new BadRequestException(
        error?.message || "Credit note posting failed",
      );

    const creditedAmount = this.roundMoney(
      Number(invoice.credited_amount || 0) + netAmount,
    );
    const newBalance = this.roundMoney(
      Number(invoice.net_amount || 0) -
        Number(invoice.paid_amount || 0) -
        creditedAmount,
    );
    const paymentStatus =
      newBalance <= 0
        ? "CREDITED"
        : Number(invoice.paid_amount || 0) > 0 || creditedAmount > 0
          ? "PARTIAL"
          : "PENDING";
    const { data: updatedInvoice, error: updateError } = await this.supabase
      .from("invoices")
      .update({
        credited_amount: creditedAmount,
        balance_amount: newBalance,
        payment_status: paymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .eq("credited_amount", Number(invoice.credited_amount || 0))
      .eq("balance_amount", Number(invoice.balance_amount || 0))
      .select("id")
      .maybeSingle();
    if (updateError || !updatedInvoice) {
      await this.supabase
        .from("sales_credit_notes")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", creditNote.id);
      throw new BadRequestException(
        updateError?.message ||
          "Invoice balance changed while posting. Reload the invoice and create the credit note again.",
      );
    }
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "CREDIT_NOTE",
      creditNote.id,
      creditNote.credit_note_number,
      "CREDIT_NOTE_POSTED",
      userId,
      reason,
      { net_amount: netAmount, invoice_id: invoiceId },
    );
    return {
      ...creditNote,
      invoice_number: invoice.invoice_number,
      balance_amount: newBalance,
      payment_status: paymentStatus,
    };
  }

  async cancelSalesCreditNote(req: Request, creditNoteId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const reason = String(body?.reason || "").trim();
    if (!reason)
      throw new BadRequestException(
        "Credit-note cancellation reason is required",
      );
    const { data: creditNote, error } = await this.supabase
      .from("sales_credit_notes")
      .select("*, invoice:invoices(*)")
      .eq("tenant_id", tenantId)
      .eq("id", creditNoteId)
      .single();
    if (error || !creditNote)
      throw new NotFoundException("Sales credit note not found");
    if (creditNote.status !== "POSTED")
      throw new BadRequestException(
        "Only a posted credit note can be cancelled",
      );
    const invoice: any = creditNote.invoice;
    if (!invoice || invoice.billing_status === "CANCELLED")
      throw new BadRequestException("Credit note invoice is not open");
    const updatedCreditedAmount = this.roundMoney(
      Math.max(
        0,
        Number(invoice.credited_amount || 0) -
          Number(creditNote.net_amount || 0),
      ),
    );
    const newBalance = this.roundMoney(
      Number(invoice.net_amount || 0) -
        Number(invoice.paid_amount || 0) -
        updatedCreditedAmount,
    );
    const paymentStatus =
      Number(invoice.paid_amount || 0) <= 0
        ? "PENDING"
        : newBalance <= 0
          ? "PAID"
          : "PARTIAL";
    const cancelledAt = new Date().toISOString();
    const { data: cancelledCredit, error: creditError } = await this.supabase
      .from("sales_credit_notes")
      .update({
        status: "CANCELLED",
        cancelled_at: cancelledAt,
        cancelled_by: userId,
        cancellation_reason: reason,
      })
      .eq("tenant_id", tenantId)
      .eq("id", creditNoteId)
      .eq("status", "POSTED")
      .select("id")
      .maybeSingle();
    if (creditError) throw new BadRequestException(creditError.message);
    if (!cancelledCredit)
      throw new BadRequestException("Sales credit note is already cancelled");
    const { data: updatedInvoice, error: invoiceError } = await this.supabase
      .from("invoices")
      .update({
        credited_amount: updatedCreditedAmount,
        balance_amount: newBalance,
        payment_status: paymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", invoice.id)
      .eq("credited_amount", Number(invoice.credited_amount || 0))
      .eq("balance_amount", Number(invoice.balance_amount || 0))
      .select("id")
      .maybeSingle();
    if (invoiceError || !updatedInvoice) {
      await this.supabase
        .from("sales_credit_notes")
        .update({
          status: "POSTED",
          cancelled_at: null,
          cancelled_by: null,
          cancellation_reason: null,
        })
        .eq("tenant_id", tenantId)
        .eq("id", creditNoteId)
        .eq("cancelled_at", cancelledAt);
      throw new BadRequestException(
        invoiceError?.message ||
          "Invoice balance changed while cancelling. Reload the invoice and try again.",
      );
    }
    await this.recordSalesEvent(
      tenantId,
      invoice.sales_order_id,
      "CREDIT_NOTE",
      creditNote.id,
      creditNote.credit_note_number,
      "CREDIT_NOTE_CANCELLED",
      userId,
      reason,
      { net_amount: creditNote.net_amount, invoice_id: invoice.id },
    );
    return {
      ...creditNote,
      status: "CANCELLED",
      cancellation_reason: reason,
      balance_amount: newBalance,
      payment_status: paymentStatus,
    };
  }

  async getSalesReturns(req: Request) {
    const { tenantId } = req.user as any;
    const { data, error } = await this.supabase
      .from("sales_returns")
      .select(
        "*, customer:customers(customer_code, customer_name), invoice:invoices(invoice_number), items:sales_return_items(*)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createSalesReturn(req: Request, invoiceId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const invoice: any = await this.getInvoiceById(req, invoiceId);
    const reason = String(body?.reason || "").trim();
    const lines = Array.isArray(body?.items) ? body.items : [];
    if (invoice.billing_status === "CANCELLED")
      throw new BadRequestException(
        "Cancelled invoice cannot have a sales return",
      );
    if (!reason || !lines.length)
      throw new BadRequestException(
        "Return reason and at least one item are required",
      );
    const { data: priorReturns, error: priorReturnsError } = await this.supabase
      .from("sales_returns")
      .select("id, status, items:sales_return_items(invoice_item_id, quantity)")
      .eq("tenant_id", tenantId)
      .eq("invoice_id", invoiceId);
    if (priorReturnsError)
      throw new BadRequestException(priorReturnsError.message);
    const normalized = this.prepareSalesReturnItems(
      lines,
      invoice.items || [],
      priorReturns || [],
    );
    const returnDate = this.validateSalesReturnDate(
      body.return_date,
      invoice.invoice_date,
    );
    const returnNumber = await this.generateSalesReturnNumber(tenantId);
    const { data: salesReturn, error } = await this.supabase
      .from("sales_returns")
      .insert({
        tenant_id: tenantId,
        return_number: returnNumber,
        invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        return_date: returnDate,
        reason,
        customer_reference:
          String(body.customer_reference || "").trim() || null,
        created_by: userId,
      })
      .select()
      .single();
    if (error || !salesReturn)
      throw new BadRequestException(
        error?.message || "Sales return creation failed",
      );
    const { error: lineError } = await this.supabase
      .from("sales_return_items")
      .insert(
        normalized.map((line: any) => ({
          ...line,
          sales_return_id: salesReturn.id,
        })),
      );
    if (lineError) {
      await this.supabase
        .from("sales_returns")
        .delete()
        .eq("id", salesReturn.id)
        .eq("tenant_id", tenantId);
      throw new BadRequestException(lineError.message);
    }
    return {
      ...salesReturn,
      items: normalized,
      message:
        "Return request created. Receive it, then QC must approve before stock is updated.",
    };
  }

  async receiveSalesReturn(req: Request, returnId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    if (!body?.warehouse_id)
      throw new BadRequestException("Receiving warehouse is required");
    const { data, error } = await this.supabase
      .from("sales_returns")
      .update({
        status: "RECEIVED_PENDING_QC",
        received_warehouse_id: body.warehouse_id,
        received_at: new Date().toISOString(),
        received_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", returnId)
      .eq("status", "DRAFT")
      .select()
      .single();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Only a draft return can be received",
      );
    return {
      ...data,
      message:
        "Return received in quarantine. No sellable stock was increased; QC decision is required.",
    };
  }

  async qcSalesReturn(req: Request, returnId: string, body: any) {
    const { tenantId, userId } = req.user as any;
    const { data: salesReturn, error } = await this.supabase
      .from("sales_returns")
      .select("*, items:sales_return_items(*)")
      .eq("tenant_id", tenantId)
      .eq("id", returnId)
      .single();
    if (error || !salesReturn)
      throw new NotFoundException("Sales return not found");
    if (salesReturn.status !== "RECEIVED_PENDING_QC")
      throw new BadRequestException(
        "Only a received return can be QC approved",
      );
    const decisions = Array.isArray(body?.items) ? body.items : [];
    if (!decisions.length)
      throw new BadRequestException("QC quantities are required");
    const decisionById = new Map(
      decisions.map((line: any) => [
        line.id,
        Number(line.accepted_quantity || 0),
      ]),
    );
    for (const line of salesReturn.items || []) {
      const accepted = decisionById.get(line.id);
      if (
        !Number.isFinite(accepted) ||
        accepted! < 0 ||
        accepted! > Number(line.quantity)
      )
        throw new BadRequestException(
          "QC accepted quantity must be between zero and received quantity",
        );
    }
    const { data: claimed, error: claimError } = await this.supabase
      .from("sales_returns")
      .update({
        status: "QC_IN_PROGRESS",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", returnId)
      .eq("status", "RECEIVED_PENDING_QC")
      .select("id")
      .maybeSingle();
    if (claimError || !claimed)
      throw new BadRequestException(
        claimError?.message || "Return QC is already being processed",
      );

    let postedMovements = 0;
    try {
      for (const line of salesReturn.items || []) {
        const accepted = Number(decisionById.get(line.id) || 0);
        const rejected = Number(line.quantity) - accepted;
        if (accepted > 0) {
          const movement = await this.inventoryService.createStockMovement(
            req,
            {
              movement_type: "RETURN",
              item_id: line.item_id,
              quantity: accepted,
              to_warehouse_id: salesReturn.received_warehouse_id,
              reference_type: "SALES_RETURN",
              reference_id: salesReturn.id,
              reference_number: salesReturn.return_number,
              notes: `Sales return ${salesReturn.return_number} QC approved`,
            },
          );
          postedMovements += 1;
          const { error: lineError } = await this.supabase
            .from("sales_return_items")
            .update({
              qc_accepted_quantity: accepted,
              qc_rejected_quantity: rejected,
              stock_movement_id: movement?.id || null,
            })
            .eq("id", line.id);
          if (lineError) throw new BadRequestException(lineError.message);
        } else {
          const { error: lineError } = await this.supabase
            .from("sales_return_items")
            .update({ qc_accepted_quantity: 0, qc_rejected_quantity: rejected })
            .eq("id", line.id);
          if (lineError) throw new BadRequestException(lineError.message);
        }
      }
      const { data: updated, error: updateError } = await this.supabase
        .from("sales_returns")
        .update({
          status: "QC_COMPLETED",
          qc_at: new Date().toISOString(),
          qc_by: userId,
          qc_notes: String(body.qc_notes || "").trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", returnId)
        .eq("status", "QC_IN_PROGRESS")
        .select()
        .single();
      if (updateError || !updated)
        throw new BadRequestException(
          updateError?.message || "Return QC completion failed",
        );
      return {
        ...updated,
        message:
          "QC completed. Only accepted quantities were returned to stock.",
      };
    } catch (processingError: any) {
      await this.supabase
        .from("sales_returns")
        .update({
          status: postedMovements > 0 ? "QC_ERROR" : "RECEIVED_PENDING_QC",
          qc_notes:
            postedMovements > 0
              ? `QC posting requires review: ${processingError?.message || "unknown error"}`
              : salesReturn.qc_notes,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", returnId)
        .eq("status", "QC_IN_PROGRESS");
      throw processingError;
    }
  }

  async confirmDelivery(req: Request, dispatchId: string, body: any = {}) {
    const { tenantId, userId } = req.user as any;
    const { data: openDispatch, error: openDispatchError } = await this.supabase
      .from("dispatch_notes")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("id", dispatchId)
      .maybeSingle();
    if (openDispatchError)
      throw new BadRequestException(openDispatchError.message);
    if (!openDispatch) throw new NotFoundException("Dispatch note not found");
    if (openDispatch.status !== "PGI_POSTED") {
      throw new BadRequestException(
        openDispatch.status === "DELIVERED"
          ? "Delivery is already confirmed"
          : "Only a PGI-posted dispatch can be delivered",
      );
    }
    const { data: dispatch, error } = await this.supabase
      .from("dispatch_notes")
      .update({
        status: "DELIVERED",
        delivered_at: body.delivered_at || new Date().toISOString(),
        delivered_by: userId,
        proof_of_delivery_url: body.proof_of_delivery_url || null,
        proof_of_delivery_name: body.proof_of_delivery_name || null,
        delivered_to_name: String(body.delivered_to_name || "").trim() || null,
        delivered_to_mobile:
          String(body.delivered_to_mobile || "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", dispatchId)
      .eq("status", "PGI_POSTED")
      .select()
      .single();
    if (error || !dispatch)
      throw new NotFoundException("Open dispatch note not found");
    await this.supabase
      .from("sales_orders")
      .update({ status: "DELIVERED", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", dispatch.sales_order_id);
    await this.recordSalesEvent(
      tenantId,
      dispatch.sales_order_id,
      "DISPATCH",
      dispatch.id,
      dispatch.dn_number,
      "DELIVERY_CONFIRMED",
      userId,
      body?.notes,
      {
        delivered_at: dispatch.delivered_at,
        delivered_to_name: dispatch.delivered_to_name,
        proof_of_delivery_url: dispatch.proof_of_delivery_url,
      },
    );
    return dispatch;
  }

  async getSalesOrderDocumentFlow(req: Request, soId: string) {
    const { tenantId } = req.user as any;
    const order: any = await this.getSalesOrderById(req, soId);
    const [
      { data: quotation },
      { data: fulfilmentTasks },
      { data: dispatches },
      { data: invoices },
      { data: events },
    ] = await Promise.all([
      order.quotation_id
        ? this.supabase
            .from("quotations")
            .select("id, quotation_number, quotation_date, status, net_amount")
            .eq("tenant_id", tenantId)
            .eq("id", order.quotation_id)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
      this.supabase
        .from("sales_fulfilment_tasks")
        .select("*, items:sales_fulfilment_task_items(*)")
        .eq("tenant_id", tenantId)
        .eq("sales_order_id", soId)
        .order("created_at"),
      this.supabase
        .from("dispatch_notes")
        .select("*, items:dispatch_items(*)")
        .eq("tenant_id", tenantId)
        .eq("sales_order_id", soId)
        .order("dispatch_date"),
      this.supabase
        .from("invoices")
        .select(
          "*, payments:sales_invoice_payments(*), credit_notes:sales_credit_notes(*)",
        )
        .eq("tenant_id", tenantId)
        .eq("sales_order_id", soId)
        .order("invoice_date"),
      this.supabase
        .from("sales_document_events")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("sales_order_id", soId)
        .order("event_at"),
    ]);
    const invoiceIds = (invoices || [])
      .map((invoice: any) => invoice.id)
      .filter(Boolean);
    const { data: returns, error: returnsError } = invoiceIds.length
      ? await this.supabase
          .from("sales_returns")
          .select("*, items:sales_return_items(*)")
          .eq("tenant_id", tenantId)
          .in("invoice_id", invoiceIds)
          .order("return_date")
      : { data: [], error: null };
    if (returnsError) throw new BadRequestException(returnsError.message);
    return {
      customer: order.customers || order.customer || null,
      quotation,
      sales_order: order,
      fulfilment_tasks: fulfilmentTasks || [],
      dispatches: dispatches || [],
      invoices: invoices || [],
      returns: returns || [],
      events: events || [],
    };
  }

  private async recordSalesEvent(
    tenantId: string,
    salesOrderId: string,
    documentType: string,
    documentId: string | null,
    documentNumber: string | null,
    eventType: string,
    eventBy?: string,
    remarks?: any,
    payload: any = {},
  ) {
    const { error } = await this.supabase.from("sales_document_events").insert({
      tenant_id: tenantId,
      sales_order_id: salesOrderId,
      document_type: documentType,
      document_id: documentId,
      document_number: documentNumber,
      event_type: eventType,
      event_by: eventBy || null,
      remarks: String(remarks || "").trim() || null,
      payload: payload || {},
    });
    if (error)
      console.error(
        "[SalesService] sales document event insert failed:",
        error.message,
      );
  }

  private async assertQuotationExists(tenantId: string, quotationId: string) {
    const { data, error } = await this.supabase
      .from("quotations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", quotationId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Quotation not found");
  }

  private async insertQuotationActivity(
    tenantId: string,
    quotationId: string,
    activityType: string,
    userId: string,
    values: any,
  ) {
    const { data, error } = await this.supabase
      .from("sales_quotation_activities")
      .insert({
        tenant_id: tenantId,
        quotation_id: quotationId,
        activity_type: activityType,
        subject: values?.subject || null,
        comments: values?.comments || null,
        recipient_email: values?.recipient_email || null,
        reminder_due_at: values?.reminder_due_at || null,
        sent_at: values?.sent_at || null,
        metadata: values?.metadata || {},
        created_by: userId || null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private escapeSalesHtml(value: any) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character] || character,
    );
  }

  private formatSalesMoney(value: any) {
    return (Number(value) || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private withReceivableAgeing(invoice: any) {
    const balance = Number(invoice?.balance_amount || 0);
    if (balance <= 0 || invoice?.billing_status === "CANCELLED") {
      return { ...invoice, days_overdue: 0, ageing_bucket: "CLOSED" };
    }
    const due = invoice?.due_date
      ? new Date(`${invoice.due_date}T00:00:00`)
      : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysOverdue =
      due && Number.isFinite(due.getTime())
        ? Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000))
        : 0;
    const ageingBucket =
      !due || due >= today
        ? "CURRENT"
        : daysOverdue <= 30
          ? "1-30"
          : daysOverdue <= 60
            ? "31-60"
            : daysOverdue <= 90
              ? "61-90"
              : "90+";
    return {
      ...invoice,
      days_overdue: daysOverdue,
      ageing_bucket: ageingBucket,
    };
  }

  private roundMoney(value: any) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount))
      throw new BadRequestException("Invalid monetary amount");
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  private async generateSalesInvoiceNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const sequence = await this.nextDocumentSequence("INVOICE");
    return `INV-${year}-${String(sequence).padStart(6, "0")}`;
  }

  private async generateCustomerReceiptNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const sequence = await this.nextDocumentSequence("RECEIPT");
    return `CR-${year}-${String(sequence).padStart(6, "0")}`;
  }

  private async generateSalesCreditNoteNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const sequence = await this.nextDocumentSequence("CREDIT_NOTE");
    return `CN-${year}-${String(sequence).padStart(6, "0")}`;
  }

  private async generateSalesReturnNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const sequence = await this.nextDocumentSequence("SALES_RETURN");
    return `SR-${year}-${String(sequence).padStart(6, "0")}`;
  }

  private async generateDunningNoticeNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const sequence = await this.nextDocumentSequence("DUNNING_NOTICE");
    return `DUN-${year}-${String(sequence).padStart(6, "0")}`;
  }

  private async nextDocumentSequence(documentType: string): Promise<number> {
    const { data, error } = await this.supabase.rpc(
      "next_sales_document_number",
      {
        p_document_type: documentType,
      },
    );
    const value = Number(data);
    if (error || !Number.isSafeInteger(value) || value <= 0) {
      throw new BadRequestException(
        error?.message || `Unable to allocate ${documentType} document number`,
      );
    }
    return value;
  }
}
