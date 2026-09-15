import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { AuditService } from "../audit/audit.service";
import { PlantMaintenanceService } from "../plant-maintenance/plant-maintenance.service";
import { PurchaseRequisitionsService } from "../purchase/services/purchase-requisitions.service";
import { PurchaseOrdersService } from "../purchase/services/purchase-orders.service";
import { ServiceEntrySheetsService } from "../purchase/services/service-entry-sheets.service";
import { GrnService } from "../purchase/services/grn.service";
import { QualityService } from "../quality/services/quality.service";
import { SalesService } from "../sales/services/sales.service";
import { JobOrderService } from "../production/services/job-order.service";
import { InventoryService } from "../inventory/services/inventory.service";
import { GovernedToolRegistryService } from "./governed-tool-registry.service";
import { OperatingEventsService } from "./operating-events.service";

@Injectable()
export class GovernedActionService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  constructor(
    private readonly registry: GovernedToolRegistryService,
    private readonly purchaseRequisitions: PurchaseRequisitionsService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly serviceEntries: ServiceEntrySheetsService,
    private readonly grns: GrnService,
    private readonly maintenance: PlantMaintenanceService,
    private readonly quality: QualityService,
    private readonly sales: SalesService,
    private readonly jobOrders: JobOrderService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly events: OperatingEventsService,
  ) {}

  private userId(user: any) {
    return String(user?.userId || user?.id || "").trim();
  }
  private hash(value: any) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  async list(tenantId: string, user: any, status?: string) {
    let query = this.db
      .from("mizantra_governed_action_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (status) query = query.eq("status", String(status).toUpperCase());
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return (data || []).filter(
      (row: any) =>
        row.created_by === this.userId(user) ||
        this.canReview(user, row.required_permission),
    );
  }

  private canReview(user: any, permission: string | null) {
    try {
      this.registry.authorize({ required_permission: permission } as any, user);
      return true;
    } catch {
      return false;
    }
  }

  async request(
    tenantId: string,
    user: any,
    toolCode: string,
    input: Record<string, any>,
    request: any,
  ) {
    const tool = this.registry.require(toolCode);
    if (!tool.approval_required || tool.effect === "TASK_ONLY")
      throw new BadRequestException(
        "This tool executes through the task-only controlled-action endpoint.",
      );
    this.registry.authorize(tool, user);
    this.registry.validate(tool, input);
    const userId = this.userId(user);
    if (!userId)
      throw new ForbiddenException(
        "Authenticated user identifier is required.",
      );
    const { data: insight } = await this.db
      .from("mizantra_exception_register")
      .select("id,source_key,title,status,source_route")
      .eq("tenant_id", tenantId)
      .eq("source_key", input.insight_id)
      .eq("status", "OPEN")
      .maybeSingle();
    if (!insight)
      throw new BadRequestException(
        "This exception is no longer active. Refresh before requesting an action.",
      );
    const idempotencyKey = this.hash({
      tenantId,
      tool: tool.code,
      insight: input.insight_id,
      input,
    });
    const { data: existing } = await this.db
      .from("mizantra_governed_action_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .in("status", ["PENDING_APPROVAL", "APPROVED", "EXECUTING", "EXECUTED"])
      .maybeSingle();
    if (existing)
      return {
        action_request: existing,
        reused: true,
        requires_approval: existing.status === "PENDING_APPROVAL",
      };
    const { data, error } = await this.db
      .from("mizantra_governed_action_requests")
      .insert({
        tenant_id: tenantId,
        insight_id: input.insight_id,
        insight_title: insight.title,
        tool_code: tool.code,
        risk: tool.risk,
        effect: tool.effect,
        required_permission: tool.required_permission,
        input_payload: input,
        idempotency_key: idempotencyKey,
        status: "PENDING_APPROVAL",
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.audit.logActivity({
      tenantId,
      userId,
      action: "MIZANTRA_NATIVE_ACTION_REQUESTED",
      resourceType: "mizantra_governed_action_request",
      resourceId: data.id,
      resourceName: tool.code,
      newValue: {
        tool_code: tool.code,
        risk: tool.risk,
        insight_id: input.insight_id,
      },
      ipAddress: request?.ip,
      userAgent: request?.headers?.["user-agent"],
      metadata: { maker_checker: true, native_execution_deferred: true },
    });
    return {
      action_request: data,
      reused: false,
      requires_approval: true,
      safe_note:
        "The native action is pending independent approval. No source transaction has been created yet.",
    };
  }

  async requestFromPrompt(
    tenantId: string,
    user: any,
    toolCode: string,
    input: Record<string, any>,
    source: { context_id?: string; intent?: string; prompt?: string },
    request: any,
  ) {
    const tool = this.registry.require(toolCode);
    if (!tool.approval_required || tool.effect === "TASK_ONLY")
      throw new BadRequestException(
        "Only approval-gated native tools can be requested from the prompt assistant.",
      );
    this.registry.authorize(tool, user);
    const contextId = String(source?.context_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(contextId))
      throw new BadRequestException("A signed planner context is required.");
    const expectedSource = `ACTIVE_PLANNER:${contextId}`;
    if (String(input?.insight_id || "") !== expectedSource)
      throw new BadRequestException(
        "Planner action source does not match its signed context.",
      );
    this.registry.validate(tool, input);
    const userId = this.userId(user);
    if (!userId)
      throw new ForbiddenException(
        "Authenticated user identifier is required.",
      );
    const idempotencyKey = this.hash({ tenantId, tool: tool.code, input });
    const { data: existing } = await this.db
      .from("mizantra_governed_action_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .in("status", ["PENDING_APPROVAL", "APPROVED", "EXECUTING", "EXECUTED"])
      .maybeSingle();
    if (existing)
      return {
        action_request: existing,
        reused: true,
        requires_approval: existing.status === "PENDING_APPROVAL",
      };
    const prompt = String(source?.prompt || "")
      .trim()
      .slice(0, 240);
    const { data, error } = await this.db
      .from("mizantra_governed_action_requests")
      .insert({
        tenant_id: tenantId,
        insight_id: expectedSource,
        insight_title:
          `Active Planner ${String(source?.intent || tool.name).replaceAll("_", " ")}${prompt ? `: ${prompt}` : ""}`.slice(
            0,
            500,
          ),
        tool_code: tool.code,
        risk: tool.risk,
        effect: tool.effect,
        required_permission: tool.required_permission,
        input_payload: input,
        idempotency_key: idempotencyKey,
        status: "PENDING_APPROVAL",
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.audit.logActivity({
      tenantId,
      userId,
      action: "ACTIVE_PLANNER_NATIVE_ACTION_REQUESTED",
      resourceType: "mizantra_governed_action_request",
      resourceId: data.id,
      resourceName: tool.code,
      newValue: {
        tool_code: tool.code,
        risk: tool.risk,
        source: expectedSource,
      },
      ipAddress: request?.ip,
      userAgent: request?.headers?.["user-agent"],
      metadata: {
        maker_checker: true,
        native_execution_deferred: true,
        source: "ACTIVE_PLANNER",
      },
    });
    return {
      action_request: data,
      reused: false,
      requires_approval: true,
      safe_note:
        "The prompt-created action is pending independent approval. No native ERP record has been created.",
    };
  }

  async approve(tenantId: string, user: any, id: string, request: any) {
    const userId = this.userId(user);
    const { data: row, error } = await this.db
      .from("mizantra_governed_action_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !row)
      throw new BadRequestException("Governed action request not found.");
    const tool = this.registry.require(row.tool_code);
    this.registry.authorize(tool, user);
    if (row.status !== "PENDING_APPROVAL")
      throw new BadRequestException(
        `Only a pending request can be approved; current status is ${row.status}.`,
      );
    if (row.created_by === userId)
      throw new ForbiddenException(
        "Maker-checker control prevents the requester from approving their own action.",
      );
    const { data, error: updateError } = await this.db
      .from("mizantra_governed_action_requests")
      .update({
        status: "APPROVED",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "PENDING_APPROVAL")
      .select()
      .single();
    if (updateError) throw new BadRequestException(updateError.message);
    await this.audit.logActivity({
      tenantId,
      userId,
      action: "MIZANTRA_NATIVE_ACTION_APPROVED",
      resourceType: "mizantra_governed_action_request",
      resourceId: id,
      resourceName: tool.code,
      newValue: { status: "APPROVED" },
      ipAddress: request?.ip,
      userAgent: request?.headers?.["user-agent"],
      metadata: { maker_checker: true, maker_user_id: row.created_by },
    });
    return data;
  }

  async reject(
    tenantId: string,
    user: any,
    id: string,
    reason: string,
    request: any,
  ) {
    const userId = this.userId(user);
    const rejectionReason = String(reason || "").trim();
    if (!rejectionReason || rejectionReason.length > 500)
      throw new BadRequestException(
        "A rejection reason up to 500 characters is required.",
      );
    const { data: row } = await this.db
      .from("mizantra_governed_action_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (!row)
      throw new BadRequestException("Governed action request not found.");
    const tool = this.registry.require(row.tool_code);
    this.registry.authorize(tool, user);
    if (row.status !== "PENDING_APPROVAL" || row.created_by === userId)
      throw new ForbiddenException(
        "Independent rejection of a pending request is required.",
      );
    const { data, error } = await this.db
      .from("mizantra_governed_action_requests")
      .update({
        status: "REJECTED",
        rejected_by: userId,
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectionReason,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "PENDING_APPROVAL")
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.audit.logActivity({
      tenantId,
      userId,
      action: "MIZANTRA_NATIVE_ACTION_REJECTED",
      resourceType: "mizantra_governed_action_request",
      resourceId: id,
      resourceName: tool.code,
      newValue: { status: "REJECTED", reason: rejectionReason },
      ipAddress: request?.ip,
      userAgent: request?.headers?.["user-agent"],
      metadata: { maker_checker: true },
    });
    return data;
  }

  async execute(tenantId: string, user: any, id: string, request: any) {
    const userId = this.userId(user);
    const { data: row } = await this.db
      .from("mizantra_governed_action_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (!row)
      throw new BadRequestException("Governed action request not found.");
    const tool = this.registry.require(row.tool_code);
    this.registry.authorize(tool, user);
    if (row.status === "EXECUTED")
      return {
        action_request: row,
        native_record: row.native_result,
        reused: true,
      };
    if (row.status !== "APPROVED")
      throw new BadRequestException(
        "The action must be independently approved before execution.",
      );
    const { data: locked } = await this.db
      .from("mizantra_governed_action_requests")
      .update({
        status: "EXECUTING",
        execution_started_at: new Date().toISOString(),
        executed_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "APPROVED")
      .select()
      .maybeSingle();
    if (!locked)
      throw new BadRequestException(
        "The action is already being executed or changed. Refresh its status.",
      );
    try {
      const payload = row.input_payload || {};
      this.registry.validate(tool, payload);
      let native: any;
      let route = row.source_route || null;
      if (tool.code === "CREATE_PURCHASE_REQUISITION_DRAFT") {
        native = await this.purchaseRequisitions.create(
          tenantId,
          row.created_by,
          {
            department: payload.department,
            purpose: payload.purpose,
            requiredDate: payload.required_date,
            priority: payload.priority || "MEDIUM",
            remarks: payload.remarks,
            status: "DRAFT",
            items: (payload.items || []).map((item: any) => ({
              itemId: item.item_id,
              itemCode: item.item_code,
              itemName: item.item_name,
              description: item.description,
              uom: item.uom,
              requestedQty: item.requested_qty,
              estimatedRate: item.estimated_rate,
              requiredDate: item.required_date || payload.required_date,
              vendorId: item.vendor_id,
            })),
          },
        );
        route = "/dashboard/purchase/requisitions";
      } else if (tool.code === "CREATE_PRODUCTION_JOB_ORDER_DRAFT") {
        native = await this.jobOrders.create(tenantId, row.created_by, {
          itemId: payload.item_id,
          bomId: payload.bom_id || undefined,
          quantity: Number(payload.quantity),
          startDate: payload.start_date,
          endDate: payload.end_date || undefined,
          priority: payload.priority || "NORMAL",
          notes: payload.notes,
          validateMaterialsOnCreate: false,
        });
        route = "/dashboard/production/job-orders";
      } else if (tool.code === "CREATE_SUPPLY_RESCHEDULE_REVIEW") {
        const documentType = String(payload.document_type || "SUPPLY_DOCUMENT");
        const documentNumber = String(
          payload.document_number || payload.document_id,
        );
        const { data: task, error: taskError } = await this.db
          .from("automation_tasks")
          .insert({
            tenant_id: tenantId,
            module: "PRODUCTION_PLANNING",
            document_type: "MRP_SUPPLY_RESCHEDULE_REVIEW",
            document_id: payload.document_id,
            title: `${
              payload.intervention_type === "CONFIRM_DATE"
                ? "Confirm supply date"
                : payload.intervention_type === "REVIEW_UNPEGGED_SUPPLY"
                  ? "Review unpegged supply"
                  : "Reschedule supply"
            }: ${documentNumber}`,
            description:
              payload.notes ||
              `${documentType} ${documentNumber}: review ${payload.quantity} for ${payload.required_date}. The source document has not been changed.`,
            priority: "HIGH",
            status: "OPEN",
            owner_user_id: row.created_by,
            due_date: payload.required_date,
            metadata: {
              source: "MRP_SUPPLY_PEGGING",
              run_id: payload.run_id,
              line_id: payload.line_id,
              intervention_type: payload.intervention_type,
              document_type: documentType,
              document_id: payload.document_id,
              document_number: documentNumber,
              document_line_id: payload.document_line_id || null,
              current_date: payload.current_date || null,
              required_date: payload.required_date,
              quantity: payload.quantity,
              action_request_id: row.id,
              action_mode: "REVIEW_ONLY",
            },
          })
          .select()
          .single();
        if (taskError) throw new BadRequestException(taskError.message);
        native = task;
        route = "/dashboard/production/mrp";
      } else if (tool.code === "CREATE_PURCHASE_ORDER_DRAFT") {
        native = await this.purchaseOrders.create(tenantId, row.created_by, {
          prId: payload.pr_id || undefined,
          vendorId: payload.vendor_id,
          deliveryDate: payload.delivery_date,
          deliveryAddress: payload.delivery_address,
          paymentTerms: payload.payment_terms,
          remarks: payload.remarks,
          status: "DRAFT",
          items: (payload.items || []).map((item: any) => ({
            prItemId: item.pr_item_id,
            itemId: item.item_id,
            itemCode: item.item_code,
            itemName: item.item_name,
            description: item.description,
            uom: item.uom,
            orderedQty: item.ordered_qty,
            rate: item.rate,
            taxPercent: item.tax_percent,
            discountPercent: item.discount_percent,
            deliveryDate: item.delivery_date || payload.delivery_date,
          })),
        });
        route = "/dashboard/purchase/orders";
      } else if (tool.code === "CREATE_SERVICE_ENTRY_DRAFT") {
        native = await this.serviceEntries.create(tenantId, row.created_by, {
          poId: payload.po_id,
          completionDate: payload.completion_date,
          completionNotes: payload.completion_notes,
          servicePeriodStart: payload.service_period_start,
          servicePeriodEnd: payload.service_period_end,
          serviceLocation: payload.service_location,
          evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
          items: (payload.items || []).map((item: any) => ({
            poItemId: item.po_item_id,
            acceptedQty: Number(item.accepted_quantity),
            completionNote: item.completion_note || payload.completion_notes,
          })),
        });
        route = "/dashboard/purchase/service-entry-sheets";
      } else if (tool.code === "CREATE_GRN_DRAFT") {
        const file = payload.invoice_file;
        const ownerPath = `/${tenantId}/${row.created_by}/`;
        if (!String(file?.url || "").includes(ownerPath))
          throw new BadRequestException(
            "The supplier invoice is not owned by the GRN requester and tenant.",
          );
        native = await this.grns.create(tenantId, row.created_by, {
          poId: payload.po_id,
          vendorId: payload.vendor_id,
          warehouseId: payload.warehouse_id,
          grnDate: payload.receipt_date,
          invoiceNumber: payload.invoice_number,
          invoiceDate: payload.invoice_date,
          invoiceFileUrl: file.url,
          invoiceFileName: file.name,
          invoiceFileType: file.type,
          invoiceFileSize: file.size,
          remarks: payload.remarks,
          status: "DRAFT",
          items: (payload.items || []).map((item: any) => ({
            poItemId: item.po_item_id,
            itemId: item.item_id,
            itemCode: item.item_code,
            itemName: item.item_name,
            description: item.description,
            uom: item.uom,
            orderedQty: Number(item.ordered_quantity),
            receivedQty: Number(item.received_quantity),
            acceptedQty: 0,
            rejectedQty: 0,
            inspectionStatus: "PENDING",
            rate: Number(item.rate || 0),
            discountPercent: Number(item.discount_percent || 0),
          })),
        });
        route = "/dashboard/purchase/grn";
      } else if (tool.code === "CREATE_SALES_INVOICE") {
        const makerRequest = {
          ...request,
          user: {
            ...(request?.user || {}),
            tenantId,
            userId: row.created_by,
            id: row.created_by,
          },
        } as any;
        native = await this.sales.createInvoiceFromDispatch(
          makerRequest,
          payload.dispatch_id,
          {
            invoice_date: payload.invoice_date,
            due_date: payload.due_date,
            notes: payload.notes,
            external_reference: payload.external_reference,
            place_of_supply: payload.place_of_supply,
            tax_type: payload.tax_type,
          },
        );
        route = "/dashboard/sales";
      } else if (tool.code === "POST_CUSTOMER_RECEIPT") {
        const makerRequest = {
          ...request,
          user: {
            ...(request?.user || {}),
            tenantId,
            userId: row.created_by,
            id: row.created_by,
          },
        } as any;
        native = await this.sales.recordInvoicePayment(
          makerRequest,
          payload.invoice_id,
          {
            amount: Number(payload.amount),
            payment_method: payload.payment_method,
            payment_reference: payload.payment_reference,
            receipt_date: payload.receipt_date,
            notes: payload.notes,
          },
        );
        route = "/dashboard/accounts/collections";
      } else if (tool.code === "POST_SALES_DISPATCH") {
        const makerRequest = {
          ...request,
          user: {
            ...(request?.user || {}),
            tenantId,
            userId: row.created_by,
            id: row.created_by,
          },
        } as any;
        native = await this.sales.createDispatch(makerRequest, {
          sales_order_id: payload.sales_order_id,
          dispatch_date: payload.dispatch_date,
          delivery_address: payload.delivery_address,
          transporter_name: payload.transporter_name,
          vehicle_number: payload.vehicle_number,
          lr_number: payload.lr_number,
          lr_date: payload.lr_date,
          notes: payload.notes,
          items: payload.items,
        });
        route = "/dashboard/sales";
      } else if (tool.code === "CREATE_MANUAL_SIV") {
        native = await this.jobOrders.createManualStoreIssueVoucher(tenantId, {
          itemId: payload.item_id,
          issueQuantity: Number(payload.issue_quantity),
          issuedToEmployeeId: payload.issued_to_employee_id,
          notes: payload.notes,
          uids: Array.isArray(payload.uids) ? payload.uids : [],
          userId: row.created_by,
        });
        route = "/dashboard/inventory/siv";
      } else if (tool.code === "CREATE_MANUAL_SRV_RETURN") {
        native = await this.jobOrders.createManualStoreReturnVoucher(tenantId, {
          sourceVoucherNumber: payload.source_voucher_number,
          itemId: payload.item_id,
          returnQuantity: Number(payload.return_quantity),
          returnedByEmployeeId: payload.returned_by_employee_id,
          condition: payload.condition,
          reason: payload.reason,
          uids: Array.isArray(payload.uids) ? payload.uids : [],
          userId: row.created_by,
        });
        route = "/dashboard/inventory/srv";
      } else if (tool.code === "CREATE_MAINTENANCE_WORK_ORDER") {
        native = await this.maintenance.createWorkOrder(
          tenantId,
          row.created_by,
          payload,
        );
        route = "/dashboard/production/maintenance";
      } else if (tool.code === "CREATE_QUALITY_NCR") {
        native = await this.quality.createNCR(
          tenantId,
          row.created_by,
          payload,
        );
        route = "/dashboard/quality";
      } else if (tool.code === "CREATE_STOCK_COUNT_ADJUSTMENT") {
        const counted = Number(payload.counted_quantity),
          expected = Number(payload.expected_system_quantity),
          requestedAdjustment = Number(payload.adjustment_quantity),
          direction = String(payload.direction || "").toUpperCase();
        const { data: item, error: itemError } = await this.db
          .from("items")
          .select("id,code,name,category,is_active,uid_tracking")
          .eq("tenant_id", tenantId)
          .eq("id", payload.item_id)
          .maybeSingle();
        if (itemError || !item)
          throw new BadRequestException(
            itemError?.message || "Stock-adjustment item was not found.",
          );
        if (item.is_active === false)
          throw new BadRequestException(
            "The stock-adjustment item is no longer active.",
          );
        if (item.uid_tracking === true)
          throw new BadRequestException(
            "UID-tracked stock must be adjusted in the controlled screen with exact UID selection.",
          );
        const { data: rows, error: stockError } = await this.db
          .from("inventory_stock")
          .select("quantity,available_quantity")
          .eq("tenant_id", tenantId)
          .eq("item_id", payload.item_id)
          .eq("warehouse_id", payload.warehouse_id);
        if (stockError) throw new BadRequestException(stockError.message);
        const current = (rows || []).reduce(
          (sum: number, row: any) =>
            sum + Number(row.available_quantity ?? row.quantity ?? 0),
          0,
        );
        if (Math.abs(current - expected) > 0.000001)
          throw new BadRequestException(
            `Stock changed after the prompt was prepared (expected ${expected}, now ${current}). Re-run the count prompt before approval execution.`,
          );
        const delta = counted - current;
        if (
          Math.abs(delta) < 0.000001 ||
          Math.abs(Math.abs(delta) - requestedAdjustment) > 0.000001 ||
          (delta > 0 ? "INCREASE" : "DECREASE") !== direction
        )
          throw new BadRequestException(
            "Approved stock-count evidence no longer reconciles to the requested adjustment.",
          );
        native = await this.inventory.createStockMovement(
          { user: { ...user, tenantId, userId } } as any,
          {
            movement_type: "ADJUSTMENT",
            item_id: item.id,
            quantity: Math.abs(delta),
            from_warehouse_id:
              direction === "DECREASE" ? payload.warehouse_id : undefined,
            to_warehouse_id:
              direction === "INCREASE" ? payload.warehouse_id : undefined,
            movement_date: payload.movement_date || undefined,
            reference_type: "STOCK_ADJUSTMENT",
            notes: `${payload.reason} (approved count ${counted}; system ${current})`,
            category: payload.item_category || item.category,
          },
        );
        route = "/dashboard/inventory/stock-adjustments";
      } else if (tool.code === "APPLY_SALES_ORDER_HOLD") {
        const scope = String(payload.hold_scope || "DELIVERY").toUpperCase();
        native = await this.sales.updateSalesOrderBlocks(
          { user: { ...user, tenantId, userId } } as any,
          payload.sales_order_id,
          {
            delivery_block: ["DELIVERY", "BOTH"].includes(scope),
            billing_block: ["BILLING", "BOTH"].includes(scope),
            block_reason: payload.block_reason,
          },
        );
        route = "/dashboard/sales/orders";
      } else
        throw new BadRequestException(
          "No native executor is registered for this tool.",
        );
      const nativeResult = {
        id: native?.id,
        number:
          native?.pr_number ||
          native?.po_number ||
          native?.ses_number ||
          native?.grn_number ||
          native?.job_order_number ||
          native?.so_number ||
          native?.work_order_number ||
          native?.ncr_number ||
          native?.movement_number ||
          null,
        route,
      };
      const { data: completed, error } = await this.db
        .from("mizantra_governed_action_requests")
        .update({
          status: "EXECUTED",
          native_resource_type: tool.code,
          native_resource_id: native?.id || null,
          native_result: nativeResult,
          executed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .eq("status", "EXECUTING")
        .select()
        .single();
      if (error) throw new BadRequestException(error.message);
      await this.events.record({
        tenantId,
        eventType: "GOVERNED_NATIVE_ACTION_EXECUTED",
        domain: tool.code,
        severity: "HIGH",
        correlationId: row.insight_id,
        sourceType: tool.code,
        sourceId: native?.id,
        title: `${tool.name} executed`,
        summary: `Approved action created native record ${nativeResult.number || nativeResult.id}.`,
        route,
        actorUserId: userId,
        payload: {
          action_request_id: id,
          approved_by: row.approved_by,
          native_result: nativeResult,
        },
      });
      await this.audit.logActivity({
        tenantId,
        userId,
        action: "MIZANTRA_NATIVE_ACTION_EXECUTED",
        resourceType: tool.code,
        resourceId: native?.id,
        resourceName: nativeResult.number || tool.name,
        newValue: nativeResult,
        ipAddress: request?.ip,
        userAgent: request?.headers?.["user-agent"],
        metadata: {
          action_request_id: id,
          approved_by: row.approved_by,
          maker_user_id: row.created_by,
        },
      });
      return {
        action_request: completed,
        native_record: native,
        reused: false,
      };
    } catch (error: any) {
      await this.db
        .from("mizantra_governed_action_requests")
        .update({
          status: "FAILED",
          failure_reason: String(
            error?.message || "Native execution failed",
          ).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .eq("status", "EXECUTING");
      throw error;
    }
  }
}
