import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";

export type GovernedToolCode =
  | "CREATE_REVIEW_TASK"
  | "ASSIGN_FOLLOW_UP"
  | "CREATE_COLLECTION_FOLLOWUP"
  | "RECOMMEND_RESCHEDULE"
  | "REQUEST_SUPPLIER_RECOVERY"
  | "REQUEST_QUOTES_REVIEW"
  | "CREATE_QUALITY_CONTAINMENT"
  | "CREATE_BANK_RECONCILIATION_REVIEW"
  | "CREATE_PURCHASE_REQUISITION_DRAFT"
  | "CREATE_PRODUCTION_JOB_ORDER_DRAFT"
  | "CREATE_SUPPLY_RESCHEDULE_REVIEW"
  | "CREATE_PURCHASE_ORDER_DRAFT"
  | "CREATE_MAINTENANCE_WORK_ORDER"
  | "CREATE_QUALITY_NCR"
  | "CREATE_STOCK_COUNT_ADJUSTMENT"
  | "CREATE_SERVICE_ENTRY_DRAFT"
  | "CREATE_GRN_DRAFT"
  | "CREATE_SALES_INVOICE"
  | "POST_CUSTOMER_RECEIPT"
  | "POST_SALES_DISPATCH"
  | "CREATE_MANUAL_SIV"
  | "CREATE_MANUAL_SRV_RETURN"
  | "APPLY_SALES_ORDER_HOLD";

export type GovernedToolDefinition = {
  code: GovernedToolCode;
  name: string;
  description: string;
  effect: "TASK_ONLY" | "NATIVE_DRAFT" | "NATIVE_TRANSACTION";
  risk: "LOW" | "MEDIUM" | "HIGH";
  approval_required: boolean;
  native_workflow_required: true;
  required_permission: string | null;
  input_schema: {
    required: string[];
    optional: string[];
    maximum_string_length: number;
  };
  output_schema: Record<string, string>;
};

@Injectable()
export class GovernedToolRegistryService {
  private readonly tools: GovernedToolDefinition[] = [
    {
      code: "CREATE_REVIEW_TASK",
      name: "Create governed review task",
      description:
        "Creates a tenant-scoped work item linked to a live Mizantra exception.",
      effect: "TASK_ONLY",
      risk: "LOW",
      approval_required: false,
      native_workflow_required: true,
      required_permission: null,
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "owner_user_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
        reused: "boolean",
      },
    },
    {
      code: "ASSIGN_FOLLOW_UP",
      name: "Create owned follow-up",
      description:
        "Creates a governed follow-up assigned to the requesting user.",
      effect: "TASK_ONLY",
      risk: "LOW",
      approval_required: false,
      native_workflow_required: true,
      required_permission: null,
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "owner_user_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
        reused: "boolean",
      },
    },
    {
      code: "CREATE_COLLECTION_FOLLOWUP",
      name: "Create collection follow-up",
      description:
        "Creates an auditable collection task; it never sends a message or holds an order automatically.",
      effect: "TASK_ONLY",
      risk: "LOW",
      approval_required: false,
      native_workflow_required: true,
      required_permission: "sales:update",
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "customer_id", "invoice_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
      },
    },
    {
      code: "RECOMMEND_RESCHEDULE",
      name: "Draft production reschedule review",
      description:
        "Creates a planning review; it does not change the production schedule.",
      effect: "TASK_ONLY",
      risk: "MEDIUM",
      approval_required: false,
      native_workflow_required: true,
      required_permission: "job_orders:update",
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "job_order_id", "work_station_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
      },
    },
    {
      code: "REQUEST_SUPPLIER_RECOVERY",
      name: "Create supplier recovery follow-up",
      description:
        "Creates an owned supplier recovery task linked to the delayed or at-risk supply record.",
      effect: "TASK_ONLY",
      risk: "MEDIUM",
      approval_required: false,
      native_workflow_required: true,
      required_permission: "purchase_orders:update",
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "vendor_id", "purchase_order_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
      },
    },
    {
      code: "REQUEST_QUOTES_REVIEW",
      name: "Create request-for-quotes review",
      description:
        "Creates a sourcing review task; supplier communication remains in the native RFQ workflow.",
      effect: "TASK_ONLY",
      risk: "MEDIUM",
      approval_required: false,
      native_workflow_required: true,
      required_permission: "purchase_requisitions:update",
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "item_id", "purchase_requisition_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
      },
    },
    {
      code: "CREATE_QUALITY_CONTAINMENT",
      name: "Create quality containment task",
      description:
        "Creates an auditable containment task without releasing, accepting or scrapping material.",
      effect: "TASK_ONLY",
      risk: "MEDIUM",
      approval_required: false,
      native_workflow_required: true,
      required_permission: "quality:update",
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "item_id", "inspection_id", "ncr_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
      },
    },
    {
      code: "CREATE_BANK_RECONCILIATION_REVIEW",
      name: "Create bank reconciliation review",
      description:
        "Creates a finance review task; it does not match, exclude or post a bank transaction.",
      effect: "TASK_ONLY",
      risk: "MEDIUM",
      approval_required: false,
      native_workflow_required: true,
      required_permission: "accounting:update",
      input_schema: {
        required: ["insight_id"],
        optional: ["due_date", "bank_account_id", "transaction_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        task: "automation task",
        safe_note: "execution boundary statement",
      },
    },
    {
      code: "CREATE_PURCHASE_REQUISITION_DRAFT",
      name: "Create purchase requisition draft",
      description:
        "Creates a native draft PR only after independent approval of the action request.",
      effect: "NATIVE_DRAFT",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "purchase_requisitions:create",
      input_schema: {
        required: [
          "insight_id",
          "department",
          "purpose",
          "required_date",
          "items",
        ],
        optional: ["priority", "remarks"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "purchase requisition after execution",
      },
    },
    {
      code: "CREATE_PRODUCTION_JOB_ORDER_DRAFT",
      name: "Create production job-order draft",
      description:
        "Creates a native draft job order only after independent approval of the MRP release request.",
      effect: "NATIVE_DRAFT",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "job_orders:create",
      input_schema: {
        required: ["insight_id", "item_id", "quantity", "start_date"],
        optional: ["bom_id", "end_date", "priority", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "draft production job order after execution",
      },
    },
    {
      code: "CREATE_SUPPLY_RESCHEDULE_REVIEW",
      name: "Create approved supply reschedule review",
      description:
        "Creates an auditable review task for a specific PO, PR or production job order only after independent approval; it never edits the source document or its dates.",
      effect: "NATIVE_DRAFT",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: null,
      input_schema: {
        required: [
          "insight_id",
          "run_id",
          "line_id",
          "intervention_type",
          "document_type",
          "document_id",
          "document_number",
          "quantity",
          "required_date",
        ],
        optional: ["current_date", "document_line_id", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "approved reschedule review task",
      },
    },
    {
      code: "CREATE_PURCHASE_ORDER_DRAFT",
      name: "Create purchase order draft",
      description:
        "Creates a native draft PO only after independent approval; normal PO approval and supplier-release controls still apply.",
      effect: "NATIVE_DRAFT",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "purchase_orders:create",
      input_schema: {
        required: [
          "insight_id",
          "vendor_id",
          "delivery_date",
          "delivery_address",
          "items",
        ],
        optional: ["pr_id", "payment_terms", "remarks"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "draft purchase order after execution",
      },
    },
    {
      code: "CREATE_MAINTENANCE_WORK_ORDER",
      name: "Create maintenance work order",
      description:
        "Creates a native maintenance work order only after independent approval of the action request.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "job_orders:create",
      input_schema: {
        required: ["insight_id", "asset_id", "work_type", "description"],
        optional: ["priority", "planned_date"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "maintenance work order after execution",
      },
    },
    {
      code: "CREATE_QUALITY_NCR",
      name: "Create quality non-conformance",
      description:
        "Creates a native NCR only after independent approval of the action request.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "quality:create",
      input_schema: {
        required: ["insight_id", "description", "nonconformance_type"],
        optional: [
          "item_id",
          "item_name",
          "vendor_id",
          "production_order_id",
          "quantity_affected",
          "cost_impact",
        ],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "quality NCR after execution",
      },
    },
    {
      code: "CREATE_STOCK_COUNT_ADJUSTMENT",
      name: "Post approved stock-count adjustment",
      description:
        "Posts a non-UID stock adjustment only after independent approval and a fresh authoritative-balance check.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "items:update",
      input_schema: {
        required: [
          "insight_id",
          "item_id",
          "warehouse_id",
          "counted_quantity",
          "expected_system_quantity",
          "adjustment_quantity",
          "direction",
          "reason",
        ],
        optional: ["movement_date", "item_category"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "stock movement after balance revalidation",
      },
    },
    {
      code: "CREATE_SERVICE_ENTRY_DRAFT",
      name: "Create service entry draft",
      description:
        "Creates a draft Service Entry Sheet only after independent approval; native submission and service acceptance remain separate.",
      effect: "NATIVE_DRAFT",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "purchase_orders:create",
      input_schema: {
        required: [
          "insight_id",
          "po_id",
          "completion_date",
          "completion_notes",
          "items",
        ],
        optional: [
          "service_period_start",
          "service_period_end",
          "service_location",
          "evidence",
        ],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "draft Service Entry Sheet after execution",
      },
    },
    {
      code: "CREATE_GRN_DRAFT",
      name: "Create governed GRN draft",
      description:
        "Creates a GRN only after independent approval while retaining native invoice-lock, PO-balance, UID, QC and GRN approval controls.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "grns:create",
      input_schema: {
        required: [
          "insight_id",
          "po_id",
          "vendor_id",
          "warehouse_id",
          "receipt_date",
          "invoice_number",
          "invoice_date",
          "invoice_file",
          "items",
        ],
        optional: ["remarks"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "GRN under normal QC and approval controls",
      },
    },
    {
      code: "CREATE_SALES_INVOICE",
      name: "Create governed sales invoice",
      description:
        "Posts an invoice from one eligible unbilled PGI dispatch only after independent approval, retaining native release, billing-block, duplicate, tax and accounting controls.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "sales:create",
      input_schema: {
        required: ["insight_id", "dispatch_id", "invoice_date", "due_date"],
        optional: [
          "notes",
          "external_reference",
          "place_of_supply",
          "tax_type",
        ],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "posted sales invoice after execution",
      },
    },
    {
      code: "POST_CUSTOMER_RECEIPT",
      name: "Post governed customer receipt",
      description:
        "Allocates a customer receipt to one open invoice only after independent approval, retaining native balance, date, reference, concurrency and accounting controls.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "sales:update",
      input_schema: {
        required: [
          "insight_id",
          "invoice_id",
          "amount",
          "payment_method",
          "receipt_date",
        ],
        optional: ["payment_reference", "notes"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "posted customer receipt after execution",
      },
    },
    {
      code: "POST_SALES_DISPATCH",
      name: "Post governed sales dispatch",
      description:
        "Posts dispatch and PGI only after independent approval, using exact supplied UIDs and retaining native release, credit, delivery-block, quantity, stock, ATP and rollback controls.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "sales:create",
      input_schema: {
        required: [
          "insight_id",
          "sales_order_id",
          "dispatch_date",
          "delivery_address",
          "items",
        ],
        optional: [
          "transporter_name",
          "vehicle_number",
          "lr_number",
          "lr_date",
          "notes",
        ],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "PGI-posted dispatch after execution",
      },
    },
    {
      code: "CREATE_MANUAL_SIV",
      name: "Post governed manual store issue voucher",
      description:
        "Issues material to one active employee only after independent approval, retaining native stock, UID, custody, FIFO and rollback controls. Job-linked issues remain in the controlled SIV workflow.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "job_orders:create",
      input_schema: {
        required: [
          "insight_id",
          "item_id",
          "issue_quantity",
          "issued_to_employee_id",
          "notes",
        ],
        optional: ["uids"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "manual SIV and employee custody after execution",
      },
    },
    {
      code: "CREATE_MANUAL_SRV_RETURN",
      name: "Post governed manual store return voucher",
      description:
        "Returns material against exact employee SIV custody only after independent approval. Good stock becomes available; damaged, rejected and scrap quantities remain unavailable/quarantined.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "job_orders:create",
      input_schema: {
        required: [
          "insight_id",
          "source_voucher_number",
          "item_id",
          "return_quantity",
          "returned_by_employee_id",
          "condition",
          "reason",
        ],
        optional: ["uids"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "employee-custody SRV return after execution",
      },
    },
    {
      code: "APPLY_SALES_ORDER_HOLD",
      name: "Apply sales-order hold",
      description:
        "Applies a native delivery and/or billing hold only after independent approval.",
      effect: "NATIVE_TRANSACTION",
      risk: "HIGH",
      approval_required: true,
      native_workflow_required: true,
      required_permission: "sales:update",
      input_schema: {
        required: ["insight_id", "sales_order_id", "block_reason"],
        optional: ["hold_scope"],
        maximum_string_length: 500,
      },
      output_schema: {
        action_request: "maker-checker request",
        native_record: "sales order control update after execution",
      },
    },
  ];

  catalogue() {
    return this.tools.map((tool) => ({ ...tool, enabled: true }));
  }

  require(code: string): GovernedToolDefinition {
    const normalized = String(code || "")
      .trim()
      .toUpperCase();
    const tool = this.tools.find((entry) => entry.code === normalized);
    if (!tool)
      throw new BadRequestException(
        "This action is not registered as a governed Mizantra tool.",
      );
    return tool;
  }

  validate(tool: GovernedToolDefinition, input: Record<string, any>) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new BadRequestException("A structured action payload is required.");
    const allowed = new Set([
      ...tool.input_schema.required,
      ...tool.input_schema.optional,
    ]);
    const unknown = Object.keys(input).filter((key) => !allowed.has(key));
    if (unknown.length)
      throw new BadRequestException(
        `Unsupported action field(s): ${unknown.join(", ")}.`,
      );
    const missing = tool.input_schema.required.filter(
      (key) =>
        input[key] == null ||
        input[key] === "" ||
        (Array.isArray(input[key]) && input[key].length === 0),
    );
    if (missing.length)
      throw new BadRequestException(
        `Required action field(s) missing: ${missing.join(", ")}.`,
      );
    for (const value of Object.values(input))
      if (
        typeof value === "string" &&
        value.length > tool.input_schema.maximum_string_length
      )
        throw new BadRequestException(
          "Action text exceeds the governed maximum length.",
        );
    if (input.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.due_date)))
      throw new BadRequestException("Due date must use YYYY-MM-DD.");
    if (
      input.required_date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(input.required_date))
    )
      throw new BadRequestException("Required date must use YYYY-MM-DD.");
    if (
      input.movement_date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(input.movement_date))
    )
      throw new BadRequestException("Movement date must use YYYY-MM-DD.");
    for (const field of [
      "completion_date",
      "service_period_start",
      "service_period_end",
      "invoice_date",
      "receipt_date",
      "dispatch_date",
      "lr_date",
    ])
      if (input[field] && !/^\d{4}-\d{2}-\d{2}$/.test(String(input[field])))
        throw new BadRequestException(`${field} must use YYYY-MM-DD.`);
    if (tool.code === "CREATE_STOCK_COUNT_ADJUSTMENT") {
      const counted = Number(input.counted_quantity),
        expected = Number(input.expected_system_quantity),
        adjustment = Number(input.adjustment_quantity),
        direction = String(input.direction || "").toUpperCase();
      if (![counted, expected, adjustment].every(Number.isFinite))
        throw new BadRequestException(
          "Stock-count quantities must be finite numbers.",
        );
      if (counted < 0 || expected < 0 || adjustment <= 0)
        throw new BadRequestException(
          "Stock-count quantities cannot be negative and the adjustment must be greater than zero.",
        );
      if (!["INCREASE", "DECREASE"].includes(direction))
        throw new BadRequestException(
          "Stock-count direction must be INCREASE or DECREASE.",
        );
      const signedDifference = counted - expected;
      if (
        Math.abs(Math.abs(signedDifference) - adjustment) > 0.000001 ||
        (signedDifference > 0 ? "INCREASE" : "DECREASE") !== direction
      )
        throw new BadRequestException(
          "Stock-count adjustment does not reconcile to counted minus system quantity.",
        );
    }
    if (tool.code === "CREATE_SERVICE_ENTRY_DRAFT") {
      if (!Array.isArray(input.items) || input.items.length === 0)
        throw new BadRequestException(
          "At least one service-entry line is required.",
        );
      for (const line of input.items) {
        if (
          !line ||
          typeof line !== "object" ||
          !String(line.po_item_id || "").trim() ||
          !Number.isFinite(Number(line.accepted_quantity)) ||
          Number(line.accepted_quantity) <= 0
        )
          throw new BadRequestException(
            "Each service-entry line requires a PO item and a positive accepted quantity.",
          );
      }
      if (
        input.service_period_start &&
        input.service_period_end &&
        input.service_period_end < input.service_period_start
      )
        throw new BadRequestException(
          "Service period end cannot be before its start date.",
        );
    }
    if (tool.code === "CREATE_GRN_DRAFT") {
      const file = input.invoice_file;
      if (
        !file ||
        typeof file !== "object" ||
        !String(file.url || "").startsWith("/uploads/grn/invoices/") ||
        !String(file.name || "").trim() ||
        !String(file.type || "").trim() ||
        !Number.isFinite(Number(file.size)) ||
        Number(file.size) <= 0
      )
        throw new BadRequestException(
          "GRN requires valid server-uploaded supplier invoice metadata.",
        );
      if (!Array.isArray(input.items) || input.items.length === 0)
        throw new BadRequestException("At least one GRN line is required.");
      for (const line of input.items)
        if (
          !String(line?.po_item_id || "").trim() ||
          !String(line?.item_id || "").trim() ||
          !Number.isFinite(Number(line?.received_quantity)) ||
          Number(line.received_quantity) <= 0
        )
          throw new BadRequestException(
            "Each GRN line requires a PO item, item, and positive receipt quantity.",
          );
    }
    if (
      tool.code === "CREATE_SALES_INVOICE" &&
      input.due_date < input.invoice_date
    )
      throw new BadRequestException(
        "Sales-invoice due date cannot be before its invoice date.",
      );
    if (tool.code === "POST_CUSTOMER_RECEIPT") {
      const amount = Number(input.amount),
        method = String(input.payment_method || "").toUpperCase(),
        reference = String(input.payment_reference || "").trim();
      if (!Number.isFinite(amount) || amount <= 0)
        throw new BadRequestException(
          "Customer-receipt amount must be greater than zero.",
        );
      if (!["NEFT", "RTGS", "UPI", "CHEQUE", "CASH", "CARD"].includes(method))
        throw new BadRequestException(
          "Customer-receipt payment method is not supported.",
        );
      if (method !== "CASH" && !reference)
        throw new BadRequestException(
          "A transaction reference is required for non-cash receipts.",
        );
    }
    if (tool.code === "POST_SALES_DISPATCH") {
      if (!Array.isArray(input.items) || input.items.length === 0)
        throw new BadRequestException(
          "At least one Sales Order line is required for dispatch.",
        );
      const allUids: string[] = [];
      for (const line of input.items) {
        const quantity = Number(line?.quantity),
          uids = Array.isArray(line?.uid)
            ? line.uid
                .map((value: any) => String(value || "").trim())
                .filter(Boolean)
            : [];
        if (
          !String(line?.sales_order_item_id || "").trim() ||
          !String(line?.item_id || "").trim() ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          uids.length !== quantity
        )
          throw new BadRequestException(
            "Each dispatch line requires a Sales Order item, item, positive quantity and one exact UID per unit.",
          );
        allUids.push(...uids);
      }
      if (new Set(allUids).size !== allUids.length)
        throw new BadRequestException(
          "The same UID cannot appear more than once in a dispatch request.",
        );
    }
    if (tool.code === "CREATE_MANUAL_SIV") {
      const quantity = Number(input.issue_quantity),
        uids = Array.isArray(input.uids)
          ? input.uids
              .map((value: any) => String(value || "").trim())
              .filter(Boolean)
          : [];
      if (!Number.isFinite(quantity) || quantity <= 0)
        throw new BadRequestException(
          "Manual SIV issue quantity must be greater than zero.",
        );
      if (input.uids !== undefined && !Array.isArray(input.uids))
        throw new BadRequestException("Manual SIV UIDs must be an array.");
      if (uids.length > 200)
        throw new BadRequestException(
          "Manual SIV supports at most 200 exact UIDs per request.",
        );
      if (new Set(uids).size !== uids.length)
        throw new BadRequestException(
          "The same UID cannot appear more than once in a manual SIV request.",
        );
    }
    if (tool.code === "CREATE_MANUAL_SRV_RETURN") {
      const quantity = Number(input.return_quantity),
        condition = String(input.condition || "").toUpperCase(),
        uids = Array.isArray(input.uids)
          ? input.uids
              .map((value: any) => String(value || "").trim())
              .filter(Boolean)
          : [];
      if (!Number.isFinite(quantity) || quantity <= 0)
        throw new BadRequestException(
          "Manual SRV return quantity must be greater than zero.",
        );
      if (!["GOOD", "DAMAGED", "REJECTED", "SCRAP"].includes(condition))
        throw new BadRequestException(
          "Manual SRV condition must be GOOD, DAMAGED, REJECTED, or SCRAP.",
        );
      if (input.uids !== undefined && !Array.isArray(input.uids))
        throw new BadRequestException("Manual SRV UIDs must be an array.");
      if (uids.length > 200)
        throw new BadRequestException(
          "Manual SRV supports at most 200 exact UIDs per request.",
        );
      if (new Set(uids).size !== uids.length)
        throw new BadRequestException(
          "The same UID cannot appear more than once in a manual SRV request.",
        );
    }
    return input;
  }

  authorize(tool: GovernedToolDefinition, user: any) {
    if (!user)
      throw new ForbiddenException("Authenticated user context is required.");
    if (!tool.required_permission) return;
    const normalize = (value: any) =>
      String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    const roles = [
      user.role,
      ...(Array.isArray(user.roles) ? user.roles : []),
    ].map((entry: any) =>
      normalize(
        typeof entry === "string" ? entry : entry?.role?.name || entry?.name,
      ),
    );
    if (
      roles.some((role) =>
        ["SUPER_ADMIN", "ADMIN", "ADMINISTRATOR"].includes(role),
      )
    )
      return;
    const permissions = new Set<string>(
      Array.isArray(user.permissions) ? user.permissions.map(String) : [],
    );
    for (const entry of Array.isArray(user.roles) ? user.roles : []) {
      const raw = entry?.role?.permissions || entry?.permissions;
      if (raw && !Array.isArray(raw) && typeof raw === "object")
        for (const [resource, actions] of Object.entries(raw))
          if (Array.isArray(actions))
            for (const action of actions)
              permissions.add(`${resource}:${action}`);
    }
    if (!permissions.has(tool.required_permission))
      throw new ForbiddenException(
        `This governed action requires ${tool.required_permission}.`,
      );
  }
}
