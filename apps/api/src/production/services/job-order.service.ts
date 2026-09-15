import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  CreateJobOrderDto,
  UpdateJobOrderDto,
  UpdateOperationDto,
} from "../dto/job-order.dto";
import { UidSupabaseService } from "../../uid/services/uid-supabase.service";
import { normalizeInventoryStockCategory as normalizeInventoryCategory } from "../../inventory/utils/inventory-category";
import {
  hasModuleAccess,
  hasScreenAccess,
} from "../../auth/utils/permission-utils";
import {
  evaluateProductionFormula,
  roundProductionFormula,
} from "./production-formula-engine";
import { scaleBomLineQuantity } from "./bom-quantity-basis";
import { planComponentSupply } from "./component-supply-policy";

export function openingCompletedBalance(
  confirmedFinishedQuantity: unknown,
  recordedStageQuantity: unknown,
) {
  return Math.max(
    0,
    Number(confirmedFinishedQuantity || 0) - Number(recordedStageQuantity || 0),
  );
}

type JobOrderIssueMaterialsFailure = {
  materialId: string;
  itemCode?: string;
  itemId?: string;
  step:
    | "RESOLVE_ITEM_ID"
    | "FETCH_ITEM"
    | "UID_REQUIRED"
    | "FETCH_STOCK"
    | "UPDATE_STOCK_ENTRY"
    | "AUDIT_SIV"
    | "UPDATE_MATERIAL"
    | "UPDATE_JOB_ORDER";
  message: string;
};

type JobOrderIssueMaterialsSummary = {
  jobOrderId: string;
  totalMaterials: number;
  materialsNeedingIssue: number;
  attempted: number;
  issuedLines: number;
  partialLines: number;
  noStockLines: number;
  skippedInvalidItemLines: number;
  failures: JobOrderIssueMaterialsFailure[];
  durationMs: number;
  autoRepair?: {
    requested: boolean;
    attempted: boolean;
    triggered: boolean;
    reason?: string;
    plannedSubAssembliesToMake?: number;
    createdSubJobOrders?: number;
    qcApprovedSubJobOrders?: number;
  };
};

type IssueMaterialsOptions = {
  userId?: string;
  autoRepair?: boolean;
};

type SmartJobOrderPreviewRequest = {
  itemId: string;
  quantity: number;
  salesOrderId?: string;
  salesOrderItemId?: string;
  includeAllComponents?: boolean;
};

type SmartJobOrderCreateRequest = {
  itemId: string;
  quantity: number;
  startDate?: string;
  salesOrderId?: string;
  salesOrderItemId?: string;
  variantSelections?: Record<string, string>;
  itemSelections?: Record<string, string>;
  autoIssueMaterials?: boolean;
  priority?: string;
  notes?: string;
  workingHoursOverride?: number;
  idempotencyKey?: string;
};

type SmartJobOrderCreateProgress = {
  current: number;
  total: number;
  phase:
    | "PREVIEW"
    | "SUB_ASSEMBLIES"
    | "MAIN_JOB_ORDER"
    | "ISSUE_MATERIALS"
    | "DONE";
  message: string;
  itemCode?: string;
  itemName?: string;
};

type SmartJobOrderCreateAsyncStatus = {
  id: string;
  tenantId: string;
  userId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: SmartJobOrderCreateProgress;
  result?: any;
  error?: string;
};

export function requireExecutableRouting(routes: unknown) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new BadRequestException(
      "This manufactured item has no routing. Add at least one process and work station in Production > BOM & Routing before creating the Job Order.",
    );
  }
  const invalid = routes.find(
    (route: any) =>
      !String(route?.operation_name || "").trim() ||
      !String(route?.workstation_id || route?.work_station_id || "").trim(),
  );
  if (invalid) {
    throw new BadRequestException(
      "The BOM routing contains a process without an operation name or work station. Complete the routing before creating the Job Order.",
    );
  }
  return routes as any[];
}

export type SmartExplosionNode = {
  level: number;
  componentType: "ITEM" | "BOM";
  bomId: string;
  parentBomId?: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  requiredQuantity: number;
  availableQuantity: number;
  toMakeQuantity: number;
  shortageQuantity: number;
  supplyPolicy?: string;
  supplyAction?: string;
  stockAllocatedQuantity?: number;
  scheduledSupplyQuantity?: number;
  sourceBomItemId?: string;
  uidStrategy?: "SERIALIZED" | "BATCHED" | "NONE";
  sequence?: number;
};

export type MasterPurchaseShortage = {
  itemId: string;
  itemCode: string;
  itemName: string;
  required: number;
  available: number;
  shortage: number;
  supplyPolicy?: string;
  sourceBomItemId?: string | null;
};

/**
 * Builds one procurement list for the complete Smart Job Order tree.
 * Repeated materials are deliberately grouped by item so Purchasing receives
 * one PR line that can later be sourced from one preferred vendor / PO.
 */
export function consolidateMasterPurchaseShortages(
  nodes: SmartExplosionNode[],
): MasterPurchaseShortage[] {
  const grouped = new Map<string, MasterPurchaseShortage>();

  for (const node of Array.isArray(nodes) ? nodes : []) {
    const itemId = String(node?.itemId || "").trim();
    const action = String(node?.supplyAction || "").trim().toUpperCase();
    const shortage = Math.max(0, Number(node?.shortageQuantity || 0));
    if (!itemId || shortage <= 0 || !["BUY", "ISSUE"].includes(action)) {
      continue;
    }

    const required = Math.max(0, Number(node?.requiredQuantity || 0));
    const available = Math.max(
      0,
      Number(node?.stockAllocatedQuantity || 0) +
        Number(node?.scheduledSupplyQuantity || 0),
    );
    const existing = grouped.get(itemId);
    if (!existing) {
      grouped.set(itemId, {
        itemId,
        itemCode: String(node?.itemCode || "").trim(),
        itemName: String(node?.itemName || "").trim(),
        required: Number(required.toFixed(4)),
        available: Number(available.toFixed(4)),
        shortage: Number(shortage.toFixed(4)),
        supplyPolicy: String(node?.supplyPolicy || "AUTO").toUpperCase(),
        sourceBomItemId: node?.sourceBomItemId || null,
      });
      continue;
    }

    existing.required = Number((existing.required + required).toFixed(4));
    existing.available = Number((existing.available + available).toFixed(4));
    existing.shortage = Number((existing.shortage + shortage).toFixed(4));
    if (existing.sourceBomItemId !== node?.sourceBomItemId) {
      existing.sourceBomItemId = null;
    }
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.itemCode.localeCompare(b.itemCode),
  );
}

type SmartSubAssemblyPlan = {
  bomId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  requiredQuantity: number;
  availableQuantity: number;
  toMakeQuantity: number;
  stockAllocatedQuantity?: number;
  scheduledSupplyQuantity?: number;
  supplyPolicy?: string;
  sourceBomItemId?: string;
};

type LinkedPurchaseRequisitionInfo = {
  prNumber: string;
};

type LinkedPurchaseFlow = {
  prNumber: string;
  prId: string | null;
  prStatus: string | null;
  status: string;
  rfqSentCount: number;
  rfqReceivedCount: number;
  poCount: number;
  poNumbers: string[];
  grnCount: number;
  grnNumbers: string[];
  orderedQty: number;
  receivedQty: number;
};

type JobOrderStoreFlowSummary = {
  lines: number;
  quantity: number;
  approvedLines: number;
  approvedQuantity: number;
  pendingLines: number;
  pendingQuantity: number;
};

export type ProductionLaunchPackStep = {
  code:
    | "JOB_ORDER"
    | "SHORTAGE_PR"
    | "MATERIAL_ISSUE"
    | "OPERATION_SCHEDULE"
    | "SHOP_FLOOR"
    | "QUALITY"
    | "FINISHED_GOODS_RECEIPT";
  label: string;
  status:
    | "CREATED"
    | "DRAFT_CREATED"
    | "NOT_REQUIRED"
    | "PREPARED"
    | "AWAITING_PHYSICAL_EVENT";
  detail: string;
  route: string;
  count?: number;
  reference?: string | null;
  requires_confirmation: boolean;
};

export type ProductionLaunchPack = {
  title: string;
  job_order_id: string;
  job_order_number: string;
  prepared_at: string;
  steps: ProductionLaunchPackStep[];
  physical_confirmations: string[];
};

export function buildProductionLaunchPack(
  jobOrder: any,
  preparedAt = new Date().toISOString(),
): ProductionLaunchPack {
  const id = String(jobOrder?.id || "").trim();
  const number = String(jobOrder?.job_order_number || "").trim();
  const materials = Array.isArray(jobOrder?.materials)
    ? jobOrder.materials
    : [];
  const operations = Array.isArray(jobOrder?.operations)
    ? jobOrder.operations
    : [];
  const prNumber = String(jobOrder?.linked_pr_number || "").trim() || null;
  const query = `jobId=${encodeURIComponent(id)}&joNumber=${encodeURIComponent(number)}`;

  return {
    title: "Production Launch Pack",
    job_order_id: id,
    job_order_number: number,
    prepared_at: preparedAt,
    steps: [
      {
        code: "JOB_ORDER",
        label: "Job order",
        status: "CREATED",
        detail: `${number || "Job order"} created with its active BOM.`,
        route: "/dashboard/production/job-orders",
        reference: number || null,
        requires_confirmation: false,
      },
      {
        code: "SHORTAGE_PR",
        label: "Shortage purchase requisition",
        status: prNumber ? "DRAFT_CREATED" : "NOT_REQUIRED",
        detail: prNumber
          ? `${prNumber} prepared for unavailable BOM material.`
          : "No purchase requisition was required from the current stock check.",
        route: "/dashboard/purchase/requisitions",
        reference: prNumber,
        requires_confirmation: false,
      },
      {
        code: "MATERIAL_ISSUE",
        label: "SIV material request",
        status: "PREPARED",
        detail: `${materials.length} BOM material line${materials.length === 1 ? "" : "s"} prepared as the store pick list. Stock moves only when Stores confirms issue.`,
        route: `/dashboard/inventory/siv?${query}`,
        count: materials.length,
        requires_confirmation: true,
      },
      {
        code: "OPERATION_SCHEDULE",
        label: "Operation schedule",
        status: "PREPARED",
        detail: `${operations.length} routed operation${operations.length === 1 ? "" : "s"} prepared in sequence.`,
        route: "/dashboard/production/job-orders",
        count: operations.length,
        requires_confirmation: false,
      },
      {
        code: "SHOP_FLOOR",
        label: "Shop-floor task list",
        status: "PREPARED",
        detail: `${operations.length} operation task${operations.length === 1 ? "" : "s"} ready for assignment and execution.`,
        route: "/dashboard/shop-floor",
        count: operations.length,
        requires_confirmation: true,
      },
      {
        code: "QUALITY",
        label: "QC checkpoint",
        status: "AWAITING_PHYSICAL_EVENT",
        detail:
          "QC is queued and becomes actionable after finished quantity is received through SRV.",
        route: `/dashboard/quality?${query}`,
        requires_confirmation: true,
      },
      {
        code: "FINISHED_GOODS_RECEIPT",
        label: "SRV finished-goods receipt",
        status: "AWAITING_PHYSICAL_EVENT",
        detail:
          "The receipt path is ready. Stores records only the quantity actually produced and handed over.",
        route: `/dashboard/inventory/srv?${query}`,
        requires_confirmation: true,
      },
    ],
    physical_confirmations: [
      "Stores issues the actual material quantity through SIV.",
      "Production records actual output and operation completion.",
      "Stores receives the actual finished quantity through SRV.",
      "Quality accepts, rejects, or holds the received quantity.",
    ],
  };
}

const LINKED_PR_WORKFLOW_STATUS = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  PR_NOT_FOUND: "PR_NOT_FOUND",
  RFQ_ISSUED: "RFQ_ISSUED",
  RFQ_RCVD: "RFQ_RCVD",
  PO_DONE: "PO_DONE",
  GOODS_RCVD: "GOODS_RCVD",
  REJECTED: "REJECTED",
} as const;

const JOB_ORDER_STATUS = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  STORE_ISSUED: "STORE_ISSUED",
  COMPLETED: "COMPLETED",
  STOPPED: "STOPPED",
  CANCELLED: "CANCELLED",
} as const;

const OPEN_SIV_JOB_ORDER_STATUSES = [
  JOB_ORDER_STATUS.DRAFT,
  JOB_ORDER_STATUS.SCHEDULED,
  JOB_ORDER_STATUS.IN_PROGRESS,
  JOB_ORDER_STATUS.STORE_ISSUED,
] as const;

const SRV_RECEIVABLE_JOB_ORDER_STATUSES = [
  JOB_ORDER_STATUS.IN_PROGRESS,
  JOB_ORDER_STATUS.STORE_ISSUED,
  JOB_ORDER_STATUS.COMPLETED,
  JOB_ORDER_STATUS.STOPPED,
] as const;

function normalizeLinkedPrStatus(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseLinkedPrNotes(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value))
    return value as Record<string, any>;
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

@Injectable()
export class JobOrderService {
  private readonly logger = new Logger(JobOrderService.name);
  private readonly manualReturnLocks = new Map<string, Promise<void>>();
  private readonly smartPreviewMaxDepth = Number(
    process.env.SMART_JO_MAX_BOM_DEPTH || 20,
  );
  private readonly smartPreviewMaxNodes = Number(
    process.env.SMART_JO_MAX_BOM_NODES || 5000,
  );
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  private smartCreateJobs = new Map<string, SmartJobOrderCreateAsyncStatus>();
  private smartCreateJobTtlMs = 1000 * 60 * 60; // 1 hour

  constructor(private readonly uidService: UidSupabaseService) {}

  private isIssuableUidStatus(status: unknown): boolean {
    const normalized = String(status || "")
      .trim()
      .toUpperCase();
    return ["ACTIVE", "AVAILABLE", "GENERATED", "IN_STOCK"].includes(
      normalized,
    );
  }

  private formatUserDisplayName(user: any) {
    const firstName = String(user?.first_name || "").trim();
    const lastName = String(user?.last_name || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    return fullName || String(user?.email || user?.id || "").trim() || null;
  }

  private async loadUsersWithRoles(tenantId: string) {
    const { data: users, error } = await this.supabase
      .from("users")
      .select(
        "id, email, first_name, last_name, is_active, role:roles (id, name, permissions)",
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("first_name", { ascending: true });

    if (error) throw new BadRequestException(error.message);

    const rows = Array.isArray(users) ? users : [];
    const userIds = rows.map((row: any) => row?.id).filter(Boolean);
    let userRoles: any[] = [];

    if (userIds.length > 0) {
      const { data, error: rolesError } = await this.supabase
        .from("user_roles")
        .select("user_id, role:roles (id, name, permissions)")
        .eq("tenant_id", tenantId)
        .in("user_id", userIds);

      if (!rolesError) {
        userRoles = Array.isArray(data) ? data : [];
      }
    }

    const rolesByUserId = new Map<string, any[]>();
    userRoles.forEach((entry: any) => {
      const userId = String(entry?.user_id || "").trim();
      const role = entry?.role;
      if (!userId || !role) return;
      const list = rolesByUserId.get(userId) || [];
      list.push({ role });
      rolesByUserId.set(userId, list);
    });

    return rows.map((row: any) => {
      const multiRoles = rolesByUserId.get(String(row?.id || "").trim()) || [];
      const fallbackRoles = row?.role ? [{ role: row.role }] : [];
      return {
        ...row,
        roles: multiRoles.length > 0 ? multiRoles : fallbackRoles,
      };
    });
  }

  async getAssignableUsers(tenantId: string) {
    const users = await this.loadUsersWithRoles(tenantId);

    return users
      .filter(
        (user: any) =>
          hasModuleAccess(user, "Production") ||
          hasScreenAccess(user, "production-job-orders") ||
          hasScreenAccess(user, "production-create-job-order") ||
          hasScreenAccess(user, "production-smart-job-order") ||
          hasScreenAccess(user, "production-job-order-vouchers"),
      )
      .map((user: any) => ({
        id: String(user?.id || "").trim(),
        displayName: String(this.formatUserDisplayName(user) || "").trim(),
        employeeCode: null,
        email: String(user?.email || "").trim() || null,
      }))
      .filter((user: any) => user.id && user.displayName)
      .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));
  }

  async getActiveEmployeesForStoreIssue(tenantId: string) {
    const { data, error } = await this.supabase
      .from("employees")
      .select(
        "id, employee_code, employee_name, department, designation, status",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "ACTIVE")
      .order("employee_name", { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return (Array.isArray(data) ? data : [])
      .map((employee: any) => ({
        id: String(employee?.id || "").trim(),
        employeeCode: String(employee?.employee_code || "").trim(),
        employeeName: String(employee?.employee_name || "").trim(),
        department: String(employee?.department || "").trim() || null,
        designation: String(employee?.designation || "").trim() || null,
      }))
      .filter((employee) => employee.id && employee.employeeName);
  }

  private pruneSmartCreateJobs(now = Date.now()) {
    for (const [id, job] of this.smartCreateJobs.entries()) {
      const createdAt = Date.parse(job.createdAt);
      const ageMs = Number.isFinite(createdAt)
        ? now - createdAt
        : this.smartCreateJobTtlMs + 1;
      const done = job.status === "COMPLETED" || job.status === "FAILED";
      if (done && ageMs > this.smartCreateJobTtlMs) {
        this.smartCreateJobs.delete(id);
      }
    }
  }

  async startSmartJobOrderCreateAsync(
    tenantId: string,
    userId: string,
    req: SmartJobOrderCreateRequest,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!userId) throw new BadRequestException("userId is required");
    if (!req?.itemId) throw new BadRequestException("itemId is required");
    if (!req?.quantity || Number(req.quantity) <= 0)
      throw new BadRequestException("quantity must be > 0");

    this.pruneSmartCreateJobs();

    const jobId = randomUUID();
    const createdAt = new Date().toISOString();

    const job: SmartJobOrderCreateAsyncStatus = {
      id: jobId,
      tenantId,
      userId,
      status: "PENDING",
      createdAt,
      progress: {
        current: 0,
        total: 0,
        phase: "PREVIEW",
        message: "Preparing Smart Job Order...",
      },
    };

    this.smartCreateJobs.set(jobId, job);

    // Run in background (do NOT await) to avoid request timeouts.
    setTimeout(() => {
      void this.runSmartJobOrderCreateJob(jobId, req);
    }, 0);

    return { jobId };
  }

  async getSmartJobOrderCreateAsyncStatus(tenantId: string, jobId: string) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    this.pruneSmartCreateJobs();

    const job = this.smartCreateJobs.get(jobId);
    if (!job)
      throw new NotFoundException("Smart job order create job not found");
    if (job.tenantId !== tenantId)
      throw new NotFoundException("Smart job order create job not found");

    // Do not leak tenant/user ids.
    const { tenantId: _t, userId: _u, ...safe } = job;
    return safe;
  }

  private async runSmartJobOrderCreateJob(
    jobId: string,
    req: SmartJobOrderCreateRequest,
  ) {
    const job = this.smartCreateJobs.get(jobId);
    if (!job) return;

    const update = (patch: Partial<SmartJobOrderCreateAsyncStatus>) => {
      const current = this.smartCreateJobs.get(jobId);
      if (!current) return;
      this.smartCreateJobs.set(jobId, {
        ...current,
        ...patch,
        progress: patch.progress
          ? { ...current.progress, ...patch.progress }
          : current.progress,
      });
    };

    try {
      update({ status: "RUNNING", startedAt: new Date().toISOString() });

      const result = await this.createSmartJobOrderInternal(
        job.tenantId,
        job.userId,
        req,
        (p) => {
          update({ progress: p });
        },
      );

      update({
        status: "COMPLETED",
        finishedAt: new Date().toISOString(),
        progress: {
          current: result?._progressTotal ?? job.progress.current,
          total: result?._progressTotal ?? job.progress.total,
          phase: "DONE",
          message: "Smart Job Order created successfully",
        },
        result: {
          jobOrder: {
            ...(result.jobOrder || {}),
            linked_pr_id:
              (result as any)?.jobOrder?.linked_pr_id ??
              (result as any)?.linked_pr_id ??
              null,
            linked_pr_number:
              (result as any)?.jobOrder?.linked_pr_number ??
              (result as any)?.linked_pr_number ??
              null,
          },
          launchPack: buildProductionLaunchPack(result.jobOrder),
          autoCompletedSubJobOrders: result.autoCompletedSubJobOrders,
          preview: result.preview,
          issueMaterialsSummary: (result as any).issueMaterialsSummary,
        },
      });
    } catch (err: any) {
      update({
        status: "FAILED",
        finishedAt: new Date().toISOString(),
        error: err?.message || "Failed to create Smart Job Order",
      });
    }
  }

  private isUuid(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const v = value.trim();
    if (!v) return false;
    // Basic UUID v1-v5 validation (case-insensitive)
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    );
  }

  private async withManualReturnLock<T>(
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.manualReturnLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.manualReturnLocks.set(key, queued);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.manualReturnLocks.get(key) === queued)
        this.manualReturnLocks.delete(key);
    }
  }

  /** Generate a unique movement_number for stock_movements inserts (ISS-000001, PRD-000001, etc.) */
  private async generateMovementNumber(
    tenantId: string,
    movementType: string,
  ): Promise<string> {
    const prefixes: Record<string, string> = {
      GRN_RECEIPT: "RCP-",
      PRODUCTION_ISSUE: "ISS-",
      PRODUCTION_RETURN: "RET-",
      PRODUCTION_RECEIPT: "PRD-",
      SALES_ISSUE: "SAL-",
      TRANSFER: "TRN-",
      ADJUSTMENT: "ADJ-",
      SCRAP: "SCR-",
    };
    const prefix = prefixes[movementType] || "MOV-";
    const { count } = await this.supabase
      .from("stock_movements")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .like("movement_number", `${prefix}%`);
    const seq = String((count || 0) + 1).padStart(6, "0");
    // Append timestamp+random suffix to prevent duplicates when multiple movements
    // are generated in the same request before any are committed, and across tenants
    // because movement_number is globally unique in stock_movements.
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = Math.floor(Math.random() * 1000000)
      .toString(36)
      .toUpperCase()
      .padStart(4, "0");
    return `${prefix}${seq}-${stamp}-${rand}`;
  }

  private resolveUidEntityTypeFromItemCategory(category: unknown): string {
    const c = String(category || "").toUpperCase();
    if (c.includes("COMPONENT")) return "CP";
    if (c.includes("FINISHED")) return "FG";
    if (c.includes("SUB_ASSEMBLY") || c.includes("ASSEMBLY")) return "SA";
    return "FG";
  }

  private async generateJobOrderUids(
    tenantId: string,
    userId: string | undefined,
    jobOrder: any,
    finishedItem: any,
    countToGenerate: number,
    reason: string,
  ) {
    const quantity = Math.max(0, Number(countToGenerate) || 0);
    if (quantity <= 0) return [];

    const entityType = this.resolveUidEntityTypeFromItemCategory(
      finishedItem?.category,
    );
    const isSubAssembly = entityType === "SA";

    // Sub-assemblies ALWAYS require UIDs regardless of uid_tracking flag.
    // For other item types, respect the uid_tracking / uid_strategy setting.
    if (
      !isSubAssembly &&
      (finishedItem?.uid_tracking === false ||
        finishedItem?.uid_strategy === "NONE")
    ) {
      if (process.env.DEBUG_JOB_ORDER === "true") {
        console.log(
          `[JobOrder] Skipping UID generation for ${finishedItem?.code} - uid_tracking disabled or strategy is NONE`,
        );
      }
      return [];
    }

    const uidsCreated: string[] = [];
    const tenantCode = await this.uidService.resolveTenantCode(tenantId);

    if (process.env.DEBUG_JOB_ORDER === "true") {
      console.log(
        `[JobOrder] Generating ${quantity} UIDs for ${finishedItem?.code}, entityType: ${entityType}, reason: ${reason}`,
      );
    }

    for (let i = 0; i < quantity; i++) {
      const uid = await this.uidService.generateUID(
        tenantCode,
        "MFG",
        entityType,
      );

      const { error: uidError } = await this.supabase
        .from("uid_registry")
        .insert({
          tenant_id: tenantId,
          uid,
          entity_type: entityType,
          entity_id: finishedItem.id,
          job_order_id: jobOrder.id,
          location: "QC",
          status: "GENERATED",
          quality_status: "PENDING",
          lifecycle: JSON.stringify([
            {
              stage: "PRODUCED",
              timestamp: new Date().toISOString(),
              location: "Production",
              reference: `${reason} JOB ORDER ${jobOrder.job_order_number}`,
              user: userId,
            },
            {
              stage: "PENDING_QC",
              timestamp: new Date().toISOString(),
              location: "QC",
              reference: "Awaiting Quality Control Inspection",
              user: userId,
            },
          ]),
          metadata: JSON.stringify({
            item_code: finishedItem.code,
            item_name: finishedItem.name,
            job_order_id: jobOrder.id,
            job_order_number: jobOrder.job_order_number,
            production_date: new Date().toISOString(),
            qc_status: "PENDING",
            reason,
          }),
        });

      if (!uidError) {
        uidsCreated.push(uid);
      } else {
        console.error("[JobOrder] UID generation error:", uidError);
      }
    }

    return uidsCreated;
  }

  async ensureUidsForJobOrder(
    tenantId: string,
    jobOrderId: string,
    userId?: string,
  ) {
    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select(
        "id, tenant_id, job_order_number, status, item_id, quantity, completed_quantity",
      )
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const desiredCount = Math.max(
      0,
      Number(jobOrder.completed_quantity ?? jobOrder.quantity ?? 0) || 0,
    );

    const { count: existingCount, error: countError } = await this.supabase
      .from("uid_registry")
      .select("uid", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId);

    if (countError) throw new BadRequestException(countError.message);

    const have = Number(existingCount) || 0;
    const missing = Math.max(0, desiredCount - have);
    if (missing <= 0) {
      return {
        jobOrderId,
        jobOrderNumber: jobOrder.job_order_number,
        desired: desiredCount,
        existing: have,
        created: 0,
        message: "UIDs already exist for this job order",
      };
    }

    const { data: finishedItem, error: itemError } = await this.supabase
      .from("items")
      .select("id, code, name, category")
      .eq("id", jobOrder.item_id)
      .single();

    if (itemError) throw new BadRequestException(itemError.message);
    if (!finishedItem) throw new BadRequestException("Finished item not found");

    const createdUids = await this.generateJobOrderUids(
      tenantId,
      userId,
      jobOrder,
      finishedItem,
      missing,
      "ENSURE_UIDS",
    );

    if (createdUids.length !== missing) {
      throw new BadRequestException(
        `Failed to generate all UIDs. Needed ${missing}, created ${createdUids.length}.`,
      );
    }

    return {
      jobOrderId,
      jobOrderNumber: jobOrder.job_order_number,
      desired: desiredCount,
      existing: have,
      created: createdUids.length,
      uids: createdUids,
      message: `Generated ${createdUids.length} missing UIDs`,
    };
  }

  async completeJobOrderPartial(
    tenantId: string,
    jobOrderId: string,
    userId?: string,
    details?: { producedQuantity: number },
  ) {
    const producedQuantity = Number(details?.producedQuantity);
    if (!Number.isFinite(producedQuantity) || producedQuantity <= 0) {
      throw new BadRequestException("producedQuantity must be > 0");
    }

    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select(
        "id, tenant_id, job_order_number, status, item_id, quantity, completed_quantity",
      )
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    if (String(jobOrder.status || "").toUpperCase() !== "IN_PROGRESS") {
      throw new BadRequestException(
        "Job order must be IN_PROGRESS to record partial completion",
      );
    }

    const planned = Math.max(0, Number(jobOrder.quantity) || 0);
    if (planned <= 0) {
      throw new BadRequestException("Invalid job order quantity");
    }

    const alreadyCompleted = Math.max(
      0,
      Number(jobOrder.completed_quantity) || 0,
    );

    if (alreadyCompleted > planned) {
      throw new BadRequestException(
        `Job order has inconsistent quantities (planned ${planned}, completed ${alreadyCompleted}). Please contact admin.`,
      );
    }

    const nextCompleted = Math.min(
      planned,
      alreadyCompleted + producedQuantity,
    );
    const producedNow = Math.max(0, nextCompleted - alreadyCompleted);

    if (producedNow <= 0) {
      return {
        jobOrderId,
        jobOrderNumber: jobOrder.job_order_number,
        plannedQuantity: planned,
        completedQuantity: alreadyCompleted,
        producedNow: 0,
        message:
          "No remaining quantity to record (already at planned quantity)",
      };
    }

    const { error: updateError } = await this.supabase
      .from("production_job_orders")
      .update({ completed_quantity: nextCompleted })
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId);

    if (updateError) throw new BadRequestException(updateError.message);

    return {
      jobOrderId,
      jobOrderNumber: jobOrder.job_order_number,
      plannedQuantity: planned,
      completedQuantity: nextCompleted,
      producedNow,
      message:
        nextCompleted >= planned
          ? "Partial completion recorded. Planned quantity reached; you can now complete and hand over to Stores for SRV receipt."
          : "Partial completion recorded. Stores can receive SRV for produced quantity; UIDs will be generated after QC.",
    };
  }

  async resumeRemainingProduction(
    tenantId: string,
    jobOrderId: string,
    userId?: string,
  ) {
    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select(
        "id,job_order_number,status,quantity,completed_quantity,actual_end_date",
      )
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();
    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const planned = Math.max(0, Number(jobOrder.quantity || 0));
    const completed = Math.max(0, Number(jobOrder.completed_quantity || 0));
    const remaining = Math.max(0, planned - completed);
    if (remaining <= 0)
      throw new BadRequestException(
        "This Job Order has no remaining production quantity",
      );
    if (["STOPPED", "CANCELLED", "QC_COMPLETED"].includes(
      String(jobOrder.status || "").toUpperCase(),
    ))
      throw new BadRequestException(
        `Cannot resume a ${String(jobOrder.status).toLowerCase()} Job Order`,
      );

    const { data: productionOrders, error: productionOrderError } =
      await this.supabase
        .from("production_orders")
        .select("id,order_number,status,bom_id")
        .eq("tenant_id", tenantId)
        .eq("job_order_id", jobOrderId);
    if (productionOrderError)
      throw new BadRequestException(productionOrderError.message);
    if (!productionOrders?.length)
      throw new BadRequestException(
        "No linked production order exists for this Job Order",
      );

    // Older partial-completion records could confirm finished output at the
    // Job Order/SRV level without writing the matching station rows. Restore
    // that confirmed quantity as an opening balance at every route so Shop
    // Floor offers only the true unproduced balance. This is idempotent: only
    // the gap between confirmed and already-recorded stage output is inserted.
    const bomIds = [
      ...new Set(productionOrders.map((order: any) => order.bom_id).filter(Boolean)),
    ];
    const productionOrderIds = productionOrders.map((order: any) => order.id);
    const [routingResult, operationResult, completionResult] =
      await Promise.all([
        this.supabase
          .from("production_routing")
          .select("id,bom_id,work_station_id,sequence_no,operation_name")
          .eq("tenant_id", tenantId)
          .in("bom_id", bomIds),
        this.supabase
          .from("job_order_operations")
          .select("id,routing_id,workstation_id")
          .eq("job_order_id", jobOrderId),
        this.supabase
          .from("station_completions")
          .select("production_order_id,routing_id,quantity_completed,status")
          .eq("tenant_id", tenantId)
          .in("production_order_id", productionOrderIds)
          .eq("status", "COMPLETED"),
      ]);
    if (routingResult.error)
      throw new BadRequestException(routingResult.error.message);
    if (operationResult.error)
      throw new BadRequestException(operationResult.error.message);
    if (completionResult.error)
      throw new BadRequestException(completionResult.error.message);
    const operationByRouting = new Map(
      (operationResult.data || []).map((operation: any) => [
        String(operation.routing_id),
        operation,
      ]),
    );
    const openingRows: any[] = [];
    const now = new Date().toISOString();
    for (const productionOrder of productionOrders as any[]) {
      const routes = (routingResult.data || []).filter(
        (route: any) => String(route.bom_id) === String(productionOrder.bom_id),
      );
      for (const route of routes) {
        const recorded = (completionResult.data || [])
          .filter(
            (entry: any) =>
              String(entry.production_order_id) ===
                String(productionOrder.id) &&
              String(entry.routing_id) === String(route.id),
          )
          .reduce(
            (sum: number, entry: any) =>
              sum + Number(entry.quantity_completed || 0),
            0,
          );
        const openingQuantity = openingCompletedBalance(completed, recorded);
        if (openingQuantity <= 1e-9) continue;
        const operation: any = operationByRouting.get(String(route.id));
        const stationId = operation?.workstation_id || route.work_station_id;
        if (!stationId)
          throw new BadRequestException(
            `Cannot reopen ${route.operation_name || "operation"}: no machine is assigned`,
          );
        openingRows.push({
          tenant_id: tenantId,
          production_order_id: productionOrder.id,
          job_order_id: jobOrderId,
          job_order_operation_id: operation?.id || null,
          routing_id: route.id,
          work_station_id: stationId,
          sequence_no: Number(route.sequence_no || 0),
          operator_id: userId || null,
          completed_by: userId || null,
          quantity_completed: Number(openingQuantity.toFixed(3)),
          quantity_rejected: 0,
          start_time: now,
          end_time: now,
          actual_time_minutes: 0,
          status: "COMPLETED",
          notes: `[[OPENING_COMPLETED_BALANCE]] ${completed} units already confirmed by ${jobOrder.job_order_number}`,
          updated_at: now,
        });
      }
    }
    if (openingRows.length) {
      const { error: openingError } = await this.supabase
        .from("station_completions")
        .insert(openingRows);
      if (openingError) throw new BadRequestException(openingError.message);
    }

    const { error: reopenOrderError } = await this.supabase
      .from("production_orders")
      .update({ status: "IN_PROGRESS", updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId);
    if (reopenOrderError)
      throw new BadRequestException(reopenOrderError.message);

    const { error: operationError } = await this.supabase
      .from("job_order_operations")
      .update({ status: "IN_PROGRESS" })
      .eq("job_order_id", jobOrderId)
      .lt("completed_quantity", planned);
    if (operationError) throw new BadRequestException(operationError.message);

    const { error: jobUpdateError } = await this.supabase
      .from("production_job_orders")
      .update({
        status: "IN_PROGRESS",
        actual_end_date: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId);
    if (jobUpdateError) throw new BadRequestException(jobUpdateError.message);

    return {
      jobOrderId,
      jobOrderNumber: jobOrder.job_order_number,
      plannedQuantity: planned,
      completedQuantity: completed,
      remainingQuantity: remaining,
      status: "IN_PROGRESS",
      message: `${remaining} units are open for production`,
    };
  }

  private async resolveJobOrderIdentity(
    tenantId: string,
    jobOrderIdOrNumber: string,
  ): Promise<{ id: string; job_order_number?: string; status?: string }> {
    const raw = String(jobOrderIdOrNumber || "").trim();
    if (!raw) throw new BadRequestException("jobOrderId is required");

    if (this.isUuid(raw)) {
      const { data: byId, error: byIdError } = await this.supabase
        .from("production_job_orders")
        .select("id, job_order_number, status")
        .eq("tenant_id", tenantId)
        .eq("id", raw)
        .maybeSingle();

      if (byIdError) throw new BadRequestException(byIdError.message);
      if (byId?.id) {
        return {
          id: String(byId.id),
          job_order_number: String((byId as any).job_order_number || ""),
          status: String((byId as any).status || ""),
        };
      }
    }

    const { data: byNumber, error: byNumberError } = await this.supabase
      .from("production_job_orders")
      .select("id, job_order_number, status")
      .eq("tenant_id", tenantId)
      .eq("job_order_number", raw)
      .maybeSingle();

    if (byNumberError) throw new BadRequestException(byNumberError.message);
    if (!byNumber?.id) throw new NotFoundException("Job order not found");

    return {
      id: String(byNumber.id),
      job_order_number: String((byNumber as any).job_order_number || ""),
      status: String((byNumber as any).status || ""),
    };
  }

  private async issueJobOrderMaterials(
    tenantId: string,
    jobOrderId: string,
    movedByUserId?: string,
  ): Promise<JobOrderIssueMaterialsSummary> {
    const startedAt = Date.now();

    const resolvedJobOrder = await this.resolveJobOrderIdentity(
      tenantId,
      jobOrderId,
    );
    const targetJobOrderId = resolvedJobOrder.id;

    this.logger.log("[SmartJO] issueJobOrderMaterials called");
    this.logger.log(JSON.stringify({ tenantId, jobOrderId, targetJobOrderId }));

    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", targetJobOrderId)
      .single();

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const { data: materialsRaw, error: materialsError } = await this.supabase
      .from("job_order_materials")
      .select("*")
      .eq("job_order_id", targetJobOrderId);

    if (materialsError) throw new BadRequestException(materialsError.message);
    jobOrder.job_order_materials = Array.isArray(materialsRaw)
      ? materialsRaw
      : [];

    const status = String(jobOrder.status || "");
    if (status === "COMPLETED" || status === "CANCELLED") {
      throw new BadRequestException(
        "Cannot issue materials for a completed/cancelled job order",
      );
    }

    const totalMaterials = jobOrder.job_order_materials?.length || 0;
    this.logger.log(`[SmartJO] Found ${totalMaterials} materials on job order`);

    // Some deployments (and some historical rows) store BOM header IDs into job_order_materials.item_id
    // for BOM-type components. Those are valid UUIDs but not item IDs, so stock lookups will fail.
    // Normalize any BOM header IDs to their corresponding items up-front.
    try {
      const rawMaterials = Array.isArray(jobOrder.job_order_materials)
        ? jobOrder.job_order_materials
        : [];
      const candidateIds = new Set<string>();
      for (const m of rawMaterials) {
        const itemId = String(m?.item_id || "").trim();
        const variantId = String(m?.selected_variant_id || "").trim();
        if (itemId && this.isUuid(itemId)) candidateIds.add(itemId);
        if (variantId && this.isUuid(variantId)) candidateIds.add(variantId);
      }

      const idList = Array.from(candidateIds);
      if (idList.length) {
        const { data: existingItems } = await this.supabase
          .from("items")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("id", idList);

        const existingItemIds = new Set(
          (existingItems || [])
            .map((r: any) => String(r?.id || "").trim())
            .filter(Boolean),
        );
        const missingIds = idList.filter((id) => !existingItemIds.has(id));

        if (missingIds.length) {
          const { data: bomHeaders } = await this.supabase
            .from("bom_headers")
            .select("id, item_id")
            .eq("tenant_id", tenantId)
            .in("id", missingIds);

          const headerIdToItemId = new Map<string, string>();
          for (const h of bomHeaders || []) {
            const headerId = String((h as any)?.id || "").trim();
            const mappedItemId = String((h as any)?.item_id || "").trim();
            if (headerId && mappedItemId && this.isUuid(mappedItemId)) {
              headerIdToItemId.set(headerId, mappedItemId);
            }
          }

          if (headerIdToItemId.size) {
            for (const m of rawMaterials) {
              const currentItemId = String(m?.item_id || "").trim();
              const currentVariantId = String(
                m?.selected_variant_id || "",
              ).trim();
              const mappedItemId = currentItemId
                ? headerIdToItemId.get(currentItemId)
                : undefined;
              const mappedVariantId = currentVariantId
                ? headerIdToItemId.get(currentVariantId)
                : undefined;

              const patch: any = {};
              if (mappedItemId && mappedItemId !== currentItemId)
                patch.item_id = mappedItemId;
              if (mappedVariantId && mappedVariantId !== currentVariantId)
                patch.selected_variant_id = mappedVariantId;

              if (Object.keys(patch).length) {
                await this.supabase
                  .from("job_order_materials")
                  .update(patch)
                  .eq("id", m.id);
              }
            }

            // Keep the in-memory copy consistent for this request.
            jobOrder.job_order_materials = rawMaterials.map((m: any) => {
              const currentItemId = String(m?.item_id || "").trim();
              const currentVariantId = String(
                m?.selected_variant_id || "",
              ).trim();
              const mappedItemId = currentItemId
                ? headerIdToItemId.get(currentItemId)
                : undefined;
              const mappedVariantId = currentVariantId
                ? headerIdToItemId.get(currentVariantId)
                : undefined;
              return {
                ...m,
                item_id: mappedItemId || m.item_id,
                selected_variant_id: mappedVariantId || m.selected_variant_id,
              };
            });
          }
        }
      }
    } catch (e) {
      // Never block issuing because of normalization; proceed with best-effort.
      this.logger.warn(
        "[SmartJO] Material ID normalization skipped due to error",
      );
      this.logger.warn(String((e as any)?.message || e));
    }

    // Some legacy/edge flows can create job_order_materials with missing/invalid UUIDs.
    // If we just skip them, the JO appears to stop issuing around N lines.
    // Resolve missing item ids from item_code up-front so we can issue all materials.
    const normalizeCode = (value: unknown) =>
      String(value || "")
        .trim()
        .toUpperCase();
    const resolveCodeCandidate = (m: any) => {
      const fromItemCode = normalizeCode(m?.item_code);
      if (fromItemCode) return fromItemCode;

      // Some buggy historical rows stored item_code into selected_variant_id / item_id.
      const sv = String(m?.selected_variant_id || "").trim();
      if (sv && !this.isUuid(sv)) return normalizeCode(sv);

      const itemId = String(m?.item_id || "").trim();
      if (itemId && !this.isUuid(itemId)) return normalizeCode(itemId);

      return "";
    };

    const materialsNeedingIssue = (jobOrder.job_order_materials || []).filter(
      (m: any) => {
        const requiredQty = Number(m.required_quantity) || 0;
        const alreadyIssued = Number(m.issued_quantity) || 0;
        return Math.max(0, requiredQty - alreadyIssued) > 0;
      },
    );

    const failures: JobOrderIssueMaterialsFailure[] = [];
    let attempted = 0;
    let issuedLines = 0;
    let partialLines = 0;
    let noStockLines = 0;
    let skippedInvalidItemLines = 0;

    const codesToResolve = Array.from(
      new Set(
        materialsNeedingIssue
          .map((m: any) => resolveCodeCandidate(m))
          .filter(Boolean),
      ),
    );

    const itemIdByCode = new Map<string, string>();
    for (const code of codesToResolve) {
      try {
        const codeStr = String(code);
        const { data: found } = await this.supabase
          .from("items")
          .select("id, code")
          .eq("tenant_id", tenantId)
          .ilike("code", codeStr)
          .limit(1);

        const row = Array.isArray(found) ? found[0] : null;
        if (row?.id) {
          itemIdByCode.set(codeStr, String(row.id));
        }
      } catch (e) {
        console.warn("[JobOrderService] Failed resolving item_id from code", {
          tenantId,
          code,
          e,
        });
      }
    }

    for (const material of jobOrder.job_order_materials || []) {
      const requiredQty = Number(material.required_quantity) || 0;
      const alreadyIssued = Number(material.issued_quantity) || 0;
      const consumeQty = Math.max(0, requiredQty - alreadyIssued);
      if (consumeQty <= 0) {
        // Keep status consistent if fully issued.
        if (
          requiredQty > 0 &&
          alreadyIssued >= requiredQty &&
          material.status !== "ISSUED"
        ) {
          await this.supabase
            .from("job_order_materials")
            .update({ status: "ISSUED" })
            .eq("id", material.id);
        }
        continue;
      }

      attempted += 1;

      try {
        let itemIdToConsume = material.selected_variant_id || material.item_id;

        const normalizedCode = resolveCodeCandidate(material);

        // If we have a UUID, still validate it exists and matches the material code.
        // Some legacy rows have a UUID that points to the wrong item.
        if (this.isUuid(String(itemIdToConsume || ""))) {
          const { data: existingItem, error: existingItemError } =
            await this.supabase
              .from("items")
              .select("id, code")
              .eq("tenant_id", tenantId)
              .eq("id", itemIdToConsume)
              .maybeSingle();

          const resolvedByCode = normalizedCode
            ? itemIdByCode.get(normalizedCode)
            : undefined;

          const existingCode = normalizeCode(existingItem?.code);
          const isMissing = Boolean(existingItemError) || !existingItem;
          const isMismatch = Boolean(
            existingItem &&
            normalizedCode &&
            existingCode &&
            existingCode !== normalizedCode,
          );

          if (
            (isMissing || isMismatch) &&
            resolvedByCode &&
            this.isUuid(String(resolvedByCode))
          ) {
            console.warn(
              "[JobOrderService] Corrected material item_id using item_code",
              {
                materialId: material.id,
                item_code: material.item_code,
                from: itemIdToConsume,
                to: resolvedByCode,
                reason: isMissing ? "MISSING_ITEM" : "CODE_MISMATCH",
              },
            );

            itemIdToConsume = resolvedByCode;
            const patch: any = { item_id: resolvedByCode };
            if (
              material.selected_variant_id &&
              !this.isUuid(String(material.selected_variant_id || ""))
            ) {
              patch.selected_variant_id = null;
            }
            await this.supabase
              .from("job_order_materials")
              .update(patch)
              .eq("id", material.id);
          }
        }

        if (!this.isUuid(String(itemIdToConsume || ""))) {
          const resolved = normalizedCode
            ? itemIdByCode.get(normalizedCode)
            : undefined;

          if (resolved && this.isUuid(String(resolved))) {
            console.warn(
              "[JobOrderService] Backfilled missing item_id from item_code",
              {
                materialId: material.id,
                item_code: material.item_code,
                from: itemIdToConsume,
                to: resolved,
              },
            );

            itemIdToConsume = resolved;

            // Persist the fix so subsequent actions (edit/issue/complete) are consistent.
            const patch: any = { item_id: resolved };
            if (
              material.selected_variant_id &&
              !this.isUuid(String(material.selected_variant_id || ""))
            ) {
              patch.selected_variant_id = null;
            }
            await this.supabase
              .from("job_order_materials")
              .update(patch)
              .eq("id", material.id);
          } else {
            skippedInvalidItemLines += 1;
            failures.push({
              materialId: String(material.id),
              itemCode: material.item_code,
              itemId: String(itemIdToConsume || ""),
              step: "RESOLVE_ITEM_ID",
              message:
                "Skipping material with invalid item_id (cannot resolve)",
            });
            this.logger.error(
              "[SmartJO] Skipping material: invalid item_id cannot resolve",
            );
            this.logger.error(
              JSON.stringify({
                tenantId,
                jobOrderId,
                materialId: material.id,
                item_code: material.item_code,
                itemIdToConsume,
              }),
            );
            // Keep pending; continue processing remaining materials.
            continue;
          }
        }

        this.logger.log("[SmartJO] Issuing material");
        this.logger.log(
          JSON.stringify({
            code: material.item_code,
            itemId: itemIdToConsume,
            requiredQty,
            alreadyIssued,
            consumeQty,
          }),
        );

        const { data: item, error: itemErr } = await this.supabase
          .from("items")
          .select("code, name, category")
          .eq("id", itemIdToConsume)
          .single();

        if (itemErr) {
          failures.push({
            materialId: String(material.id),
            itemCode: material.item_code,
            itemId: String(itemIdToConsume || ""),
            step: "FETCH_ITEM",
            message: itemErr.message,
          });
          this.logger.error("[SmartJO] Failed fetching item for material");
          this.logger.error(
            JSON.stringify({
              tenantId,
              jobOrderId,
              materialId: material.id,
              itemIdToConsume,
              error: itemErr,
            }),
          );
          continue;
        }

        // If item is UID-tracked and has issuable UIDs, require scanned UID issuing via issue-line.
        // Prevent bypassing the UID mapping requirement through the bulk issue endpoint.
        try {
          const { data: uidStatusRows, error: uidCountErr } =
            await this.supabase
              .from("uid_registry")
              .select("status")
              .eq("tenant_id", tenantId)
              .eq("entity_id", itemIdToConsume);

          if (uidCountErr) throw uidCountErr;

          const issuableUidCount = (
            Array.isArray(uidStatusRows) ? uidStatusRows : []
          ).filter((row: any) => this.isIssuableUidStatus(row?.status)).length;

          if (issuableUidCount > 0) {
            failures.push({
              materialId: String(material.id),
              itemCode: material.item_code,
              itemId: String(itemIdToConsume || ""),
              step: "UID_REQUIRED",
              message: "UID_MAPPING_REQUIRED",
            });
            this.logger.warn(
              "[SmartJO] Skipping bulk issue for UID-tracked item; requires scanned UID issue-line",
            );
            this.logger.warn(
              JSON.stringify({
                tenantId,
                jobOrderId,
                materialId: material.id,
                itemIdToConsume,
                issuableUidCount,
              }),
            );
            continue;
          }
        } catch (e: any) {
          // If UID check fails, don't block bulk issuing for non-UID items; log and continue.
          this.logger.warn(
            "[SmartJO] UID check failed; proceeding without UID enforcement for bulk issuing",
          );
          this.logger.warn(String(e?.message || e));
        }

        const { data: stockEntries, error: stockErr } = await this.supabase
          .from("stock_entries")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("item_id", itemIdToConsume)
          .gt("available_quantity", 0)
          .order("created_at", { ascending: true });

        if (stockErr) {
          failures.push({
            materialId: String(material.id),
            itemCode: material.item_code,
            itemId: String(itemIdToConsume || ""),
            step: "FETCH_STOCK",
            message: stockErr.message,
          });
          this.logger.error(
            "[SmartJO] Failed fetching stock entries for material",
          );
          this.logger.error(
            JSON.stringify({
              tenantId,
              jobOrderId,
              materialId: material.id,
              itemIdToConsume,
              error: stockErr,
            }),
          );
          continue;
        }

        const safeEntries = Array.isArray(stockEntries) ? stockEntries : [];
        const totalAvailable = safeEntries.reduce(
          (sum, entry) => sum + parseFloat(entry.available_quantity.toString()),
          0,
        );

        this.logger.log("[SmartJO] Stock available");
        this.logger.log(
          JSON.stringify({
            code: item?.code,
            totalAvailable,
            needed: consumeQty,
            entries: safeEntries.length,
          }),
        );

        // Best-effort issuing: consume up to what's available, never throw for missing/insufficient stock.
        // Smart Job Orders often start with shortages and should still be created.
        const issueNow = Math.max(0, Math.min(consumeQty, totalAvailable));
        if (issueNow <= 0) {
          // Nothing to issue; keep issued_quantity as-is.
          noStockLines += 1;
          failures.push({
            materialId: String(material.id),
            itemCode: material.item_code,
            itemId: String(itemIdToConsume || ""),
            step: "FETCH_STOCK",
            message: "NO_STOCK_AVAILABLE",
          });

          this.logger.warn(
            "[SmartJO] No stock available for material; leaving PENDING",
          );
          this.logger.warn(
            JSON.stringify({
              tenantId,
              jobOrderId,
              materialId: material.id,
              code: material.item_code,
              itemId: itemIdToConsume,
              requiredQty,
              alreadyIssued,
              consumeQty,
              totalAvailable,
              entryCount: safeEntries.length,
            }),
          );
          continue;
        }

        let remainingToConsume = issueNow;
        let updateFailed = false;
        for (const entry of safeEntries) {
          if (remainingToConsume <= 0) break;

          const entryAvailable = parseFloat(
            entry.available_quantity.toString(),
          );
          const toConsumeFromEntry = Math.min(
            entryAvailable,
            remainingToConsume,
          );
          const newAvailable = entryAvailable - toConsumeFromEntry;

          this.logger.log("[SmartJO] Consuming from stock entry");
          this.logger.log(
            JSON.stringify({
              entryId: entry.id,
              before: entryAvailable,
              consuming: toConsumeFromEntry,
              after: newAvailable,
            }),
          );

          const { error: updateError } = await this.supabase
            .from("stock_entries")
            .update({
              available_quantity: newAvailable,
              updated_at: new Date().toISOString(),
            })
            .eq("id", entry.id);

          if (updateError) {
            updateFailed = true;
            failures.push({
              materialId: String(material.id),
              itemCode: material.item_code,
              itemId: String(itemIdToConsume || ""),
              step: "UPDATE_STOCK_ENTRY",
              message: updateError.message,
            });
            this.logger.error("[SmartJO] Failed to update stock entry");
            this.logger.error(
              JSON.stringify({
                tenantId,
                jobOrderId,
                materialId: material.id,
                itemIdToConsume,
                entryId: entry.id,
                error: updateError,
              }),
            );
            break; // Exit this material's stock entry loop, move to next material
          }

          // Keep inventory_stock consistent with stock_entries.
          // Smart JO preview uses stock checks and other modules rely on inventory_stock.
          const warehouseId = String((entry as any)?.warehouse_id || "").trim();
          if (warehouseId && this.isUuid(warehouseId)) {
            const { error: invError } = await this.supabase.rpc(
              "adjust_inventory_stock",
              {
                p_tenant_id: tenantId,
                p_item_id: itemIdToConsume,
                p_warehouse_id: warehouseId,
                p_location_id: null,
                p_quantity_change: -toConsumeFromEntry,
                p_category: normalizeInventoryCategory(
                  (item as any)?.category,
                  "RAW_MATERIAL",
                ),
              },
            );

            if (invError) {
              failures.push({
                materialId: String(material.id),
                itemCode: material.item_code,
                itemId: String(itemIdToConsume || ""),
                step: "UPDATE_STOCK_ENTRY",
                message: `INVENTORY_STOCK_SYNC_FAILED: ${invError.message}`,
              });
              this.logger.error(
                "[SmartJO] Failed syncing inventory_stock after consuming stock entry",
              );
              this.logger.error(
                JSON.stringify({
                  tenantId,
                  jobOrderId,
                  materialId: material.id,
                  itemIdToConsume,
                  warehouseId,
                  consumed: toConsumeFromEntry,
                  error: invError,
                }),
              );
            }
          }

          remainingToConsume -= toConsumeFromEntry;

          // Audit trail: record SIV (store issue voucher) movement when user is known.
          const movedBy = String(movedByUserId || "").trim();
          if (movedBy && this.isUuid(movedBy)) {
            const warehouseId = String(
              (entry as any)?.warehouse_id || "",
            ).trim();
            const movementNumber = await this.generateMovementNumber(
              tenantId,
              "PRODUCTION_ISSUE",
            );
            const { error: auditError } = await this.supabase
              .from("stock_movements")
              .insert({
                tenant_id: tenantId,
                movement_number: movementNumber,
                movement_type: "PRODUCTION_ISSUE",
                item_id: itemIdToConsume,
                from_warehouse_id:
                  warehouseId && this.isUuid(warehouseId) ? warehouseId : null,
                quantity: toConsumeFromEntry,
                reference_type: "SIV",
                reference_id: targetJobOrderId,
                reference_number: String(
                  (jobOrder as any)?.job_order_number || "",
                ),
                notes: `SIV: Issued material ${String(material?.item_code || "").trim()} (${String(material?.item_name || "").trim()}) for ${String((jobOrder as any)?.job_order_number || "").trim()} (material_id=${String(material?.id || "").trim()})`,
                moved_by: movedBy,
                movement_date: new Date().toISOString(),
              } as any);

            if (auditError) {
              failures.push({
                materialId: String(material.id),
                itemCode: material.item_code,
                itemId: String(itemIdToConsume || ""),
                step: "AUDIT_SIV",
                message: `STOCK_MOVEMENTS_INSERT_FAILED: ${auditError.message}`,
              });
              this.logger.error(
                "[SmartJO] Failed inserting SIV stock_movements audit row",
              );
              this.logger.error(
                JSON.stringify({
                  tenantId,
                  jobOrderId: targetJobOrderId,
                  materialId: material.id,
                  itemIdToConsume,
                  consumed: toConsumeFromEntry,
                  movedBy,
                  error: auditError,
                }),
              );
            }
          }
        }

        const actuallyConsumed = Math.max(0, issueNow - remainingToConsume);
        if (actuallyConsumed <= 0) {
          // If we planned to consume but couldn't update any stock entries, keep material unchanged.
          if (updateFailed) {
            this.logger.warn(
              "[SmartJO] Planned consumption but consumed 0 due to stock update failure",
            );
          }
          continue;
        }

        const nextIssued = alreadyIssued + actuallyConsumed;
        const nextStatus = nextIssued >= requiredQty ? "ISSUED" : "PARTIAL";
        if (nextStatus === "ISSUED") issuedLines += 1;
        else partialLines += 1;

        this.logger.log("[SmartJO] Material issued");
        this.logger.log(
          JSON.stringify({
            code: material.item_code,
            issued: nextIssued,
            required: requiredQty,
            status: nextStatus,
          }),
        );

        const { error: matUpdateErr } = await this.supabase
          .from("job_order_materials")
          .update({
            issued_quantity: nextIssued,
            status: nextStatus,
          })
          .eq("id", material.id);

        if (matUpdateErr) {
          failures.push({
            materialId: String(material.id),
            itemCode: material.item_code,
            itemId: String(itemIdToConsume || ""),
            step: "UPDATE_MATERIAL",
            message: matUpdateErr.message,
          });
          this.logger.error("[SmartJO] Failed to update job_order_materials");
          this.logger.error(
            JSON.stringify({
              tenantId,
              jobOrderId,
              materialId: material.id,
              error: matUpdateErr,
            }),
          );
        }
      } catch (e: any) {
        failures.push({
          materialId: String(material.id),
          itemCode: material.item_code,
          itemId: String(
            material.selected_variant_id || material.item_id || "",
          ),
          step: "UPDATE_MATERIAL",
          message: e?.message || "Unknown error while issuing material",
        });
        this.logger.error("[SmartJO] Unexpected error issuing material");
        this.logger.error(
          JSON.stringify({
            tenantId,
            jobOrderId,
            materialId: material.id,
            item_code: material.item_code,
            error: e?.message || e,
          }),
        );
        continue;
      }
    }

    // Move JO to IN_PROGRESS once materials are issued
    if (status !== "IN_PROGRESS") {
      const { error: joUpdateErr } = await this.supabase
        .from("production_job_orders")
        .update({
          status: "IN_PROGRESS",
          actual_start_date: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", targetJobOrderId);

      if (joUpdateErr) {
        failures.push({
          materialId: "",
          step: "UPDATE_JOB_ORDER",
          message: joUpdateErr.message,
        });
        this.logger.error(
          "[SmartJO] Failed to update job order status to IN_PROGRESS",
        );
        this.logger.error(
          JSON.stringify({ tenantId, jobOrderId, error: joUpdateErr }),
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    const summary: JobOrderIssueMaterialsSummary = {
      jobOrderId: targetJobOrderId,
      totalMaterials,
      materialsNeedingIssue: materialsNeedingIssue.length,
      attempted,
      issuedLines,
      partialLines,
      noStockLines,
      skippedInvalidItemLines,
      failures,
      durationMs,
    };

    this.logger.log("[SmartJO] issueJobOrderMaterials summary");
    this.logger.log(JSON.stringify(summary));
    return summary;
  }

  async issueMaterialsForJobOrder(
    tenantId: string,
    jobOrderId: string,
    options: IssueMaterialsOptions = {},
  ): Promise<JobOrderIssueMaterialsSummary> {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!jobOrderId) throw new BadRequestException("jobOrderId is required");

    // Never auto-manufacture, auto-receive, or auto-QC missing materials from an
    // issue request. Store movements must follow the controlled SIV/SRV flow.
    const autoRepairRequested = false;
    const userId = String(options.userId || "").trim();

    const first = await this.issueJobOrderMaterials(
      tenantId,
      jobOrderId,
      userId || undefined,
    );
    first.autoRepair = {
      requested: autoRepairRequested,
      attempted: false,
      triggered: false,
    };

    if (!autoRepairRequested) return first;

    // Only attempt auto-repair if issuing is completely blocked by NO_STOCK.
    // This is aimed at legacy Smart JOs created before the improved BOM expansion logic.
    const hasIssuedAnything =
      (first.issuedLines || 0) > 0 || (first.partialLines || 0) > 0;
    const hasNoStock = (first.noStockLines || 0) > 0;
    const isFullyBlocked = !hasIssuedAnything && hasNoStock;
    if (!isFullyBlocked) {
      first.autoRepair.reason = "NOT_FULLY_BLOCKED";
      return first;
    }

    // Only for Smart JOs (avoid creating sub-job-orders for normal/manual JOs).
    const { data: joRow, error: joErr } = await this.supabase
      .from("production_job_orders")
      .select("id, job_order_number, notes")
      .eq("tenant_id", tenantId)
      .eq("id", first.jobOrderId)
      .single();

    if (joErr) {
      first.autoRepair.reason = `JOB_ORDER_FETCH_FAILED: ${joErr.message}`;
      return first;
    }

    const notes = String((joRow as any)?.notes || "");
    const looksSmart = /\bsmart\s+job\s+order\b/i.test(notes);
    if (!looksSmart) {
      first.autoRepair.reason = "NOT_SMART_JOB_ORDER";
      return first;
    }

    if (!userId) {
      first.autoRepair.reason = "MISSING_USER_ID_FOR_REPAIR";
      return first;
    }

    // Additionally, only trigger if NO_STOCK is the dominant failure mode.
    const failures = Array.isArray(first.failures) ? first.failures : [];
    const noStockFailures = failures.filter(
      (f) => String(f?.message || "") === "NO_STOCK_AVAILABLE",
    );
    if (noStockFailures.length === 0) {
      first.autoRepair.reason = "NO_NO_STOCK_FAILURES";
      return first;
    }

    this.logger.log(
      "[SmartJO][AutoRepair] Triggering smart repair+issue from issue-materials endpoint",
    );
    this.logger.log(
      JSON.stringify({
        tenantId,
        jobOrderId: first.jobOrderId,
        jobOrderNumber: (joRow as any)?.job_order_number || null,
        noStockFailures: noStockFailures.length,
      }),
    );

    first.autoRepair.attempted = true;

    try {
      const repaired = await this.repairSmartJobOrderAndIssueMaterials(
        tenantId,
        userId,
        first.jobOrderId,
      );
      const finalSummary = repaired.issueMaterialsSummary;
      finalSummary.autoRepair = {
        requested: true,
        attempted: true,
        triggered: true,
        reason: "SMART_REPAIR_RAN",
        plannedSubAssembliesToMake: repaired.plannedSubAssembliesToMake,
        createdSubJobOrders: repaired.createdSubJobOrders,
        qcApprovedSubJobOrders: repaired.qcApprovedSubJobOrders,
      };
      return finalSummary;
    } catch (e: any) {
      first.autoRepair.triggered = true;
      first.autoRepair.reason = `SMART_REPAIR_FAILED: ${e?.message || "Unknown error"}`;
      this.logger.error("[SmartJO][AutoRepair] Smart repair failed");
      this.logger.error(
        JSON.stringify({ tenantId, jobOrderId, error: e?.message || e }),
      );
      return first;
    }
  }

  async repairSmartJobOrderAndIssueMaterials(
    tenantId: string,
    userId: string,
    jobOrderId: string,
  ): Promise<{
    jobOrderId: string;
    jobOrderNumber: string;
    preview: any;
    plannedSubAssembliesToMake: number;
    createdSubJobOrders: number;
    qcApprovedSubJobOrders: number;
    issueMaterialsSummary: JobOrderIssueMaterialsSummary;
  }> {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!userId) throw new BadRequestException("userId is required");
    if (!jobOrderId) throw new BadRequestException("jobOrderId is required");

    const resolvedJobOrder = await this.resolveJobOrderIdentity(
      tenantId,
      jobOrderId,
    );

    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select(
        "id, tenant_id, item_id, job_order_number, quantity, start_date, status",
      )
      .eq("tenant_id", tenantId)
      .eq("id", resolvedJobOrder.id)
      .single();

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const status = String(jobOrder.status || "");
    if (status === "COMPLETED" || status === "CANCELLED") {
      throw new BadRequestException(
        "Cannot repair/issue materials for a completed/cancelled job order",
      );
    }

    const startDate = this.toStartDate(
      String((jobOrder as any).start_date || ""),
    );

    // Rebuild Smart JO preview using the *current* BOM expansion logic.
    // This is the key fix for legacy Smart JOs created before BOM-detection improvements.
    const preview = await this.getSmartJobOrderPreview(tenantId, {
      itemId: String((jobOrder as any).item_id || ""),
      quantity: Number((jobOrder as any).quantity || 0),
    });

    const completedSubJobOrders: any[] = [];
    let qcApprovedSubJobOrders = 0;

    const normalizeCode = (value: unknown) =>
      String(value || "")
        .trim()
        .toUpperCase();

    const createCompleteAndQcApprove = async (args: {
      itemId: string;
      itemCode?: string;
      bomId: string;
      quantity: number;
      reason: string;
    }) => {
      this.logger.log("[SmartJO][Repair] Creating sub-assembly");
      this.logger.log(
        JSON.stringify({
          itemId: args.itemId,
          itemCode: args.itemCode,
          bomId: args.bomId,
          quantity: args.quantity,
          forJobOrder: jobOrder.job_order_number,
          reason: args.reason,
        }),
      );

      const created = await this.createFromBOMWithVariantSelections(
        tenantId,
        userId,
        {
          itemId: args.itemId,
          bomId: args.bomId,
          quantity: args.quantity,
          startDate,
          priority: "NORMAL",
          notes: `Auto-created by Smart JO Repair for ${jobOrder.job_order_number} (${args.reason})`,
        } as any,
      );

      // Ensure status is IN_PROGRESS so completeJobOrder can run.
      await this.supabase
        .from("production_job_orders")
        .update({
          status: "IN_PROGRESS",
          actual_start_date: new Date().toISOString(),
        })
        .eq("id", created.id);

      const completed = await this.completeJobOrder(
        tenantId,
        created.id,
        userId,
        {
          allowPartialConsumption: true,
          autoBuildMissingSubAssemblies: true,
        } as any,
      );
      completedSubJobOrders.push(completed);

      // New workflow: SRV receive (SYSTEM) with quantity, then QC completes and generates UIDs.
      await this.receiveStoreReceiptVoucher(tenantId, created.id, userId, {
        receiverName: "SYSTEM",
        receivedQuantity: args.quantity,
      });
      await this.approveQC(
        tenantId,
        created.id,
        {
          acceptedQuantity: args.quantity,
          rejectedQuantity: 0,
        },
        userId,
      );
      qcApprovedSubJobOrders += 1;
    };

    // Create deeper sub-assemblies first to satisfy nested BOM dependencies.
    const subAssemblyLevelByKey = new Map<string, number>();
    for (const n of (preview.nodes || []) as any[]) {
      if (n?.componentType !== "BOM") continue;
      const key = `${String(n.bomId)}:${String(n.itemId)}`;
      const lvl = Number(n.level) || 0;
      const existing = subAssemblyLevelByKey.get(key);
      if (existing === undefined || lvl > existing)
        subAssemblyLevelByKey.set(key, lvl);
    }

    const subAssembliesToMakeAll = (
      [...(preview.subAssembliesToMake || [])] as any[]
    ).sort((a, b) => {
      const aKey = `${String(a.bomId)}:${String(a.itemId)}`;
      const bKey = `${String(b.bomId)}:${String(b.itemId)}`;
      const aLvl = subAssemblyLevelByKey.get(aKey) ?? 0;
      const bLvl = subAssemblyLevelByKey.get(bKey) ?? 0;
      if (aLvl !== bLvl) return bLvl - aLvl; // deeper first
      return (Number(b.toMakeQuantity) || 0) - (Number(a.toMakeQuantity) || 0);
    });

    const subAssembliesToMake = subAssembliesToMakeAll.filter(
      (sa) => Number(sa?.toMakeQuantity || 0) > 0,
    );

    this.logger.log("[SmartJO][Repair] Planning sub-assembly rebuild");
    this.logger.log(
      JSON.stringify({
        tenantId,
        jobOrderId,
        jobOrderNumber: jobOrder.job_order_number,
        planned: subAssembliesToMake.length,
      }),
    );

    for (const sa of subAssembliesToMake) {
      await createCompleteAndQcApprove({
        itemId: String(sa.itemId),
        itemCode: sa.itemCode,
        bomId: String(sa.bomId),
        quantity: Number(sa.toMakeQuantity),
        reason: "SMART_PREVIEW",
      });
    }

    // IMPORTANT: Legacy Smart JOs may have been created with user selections (alternate items/variants)
    // that the current preview call doesn't know about. So after preview-based rebuild, we ALSO ensure
    // stock for the *actual pending materials* on the existing job order.
    const { data: joMaterials, error: joMaterialsErr } = await this.supabase
      .from("job_order_materials")
      .select(
        "id, item_id, item_code, required_quantity, issued_quantity, status",
      )
      .eq("job_order_id", resolvedJobOrder.id);

    if (joMaterialsErr) throw new BadRequestException(joMaterialsErr.message);
    const materialsRows = Array.isArray(joMaterials) ? joMaterials : [];
    const pendingMaterials = materialsRows.filter((m: any) => {
      const required = Number(m?.required_quantity) || 0;
      const issued = Number(m?.issued_quantity) || 0;
      return required - issued > 0;
    });

    const pendingCodes = Array.from(
      new Set(
        pendingMaterials
          .map((m: any) => normalizeCode(String(m?.item_code || "")))
          .filter(Boolean),
      ),
    );

    const itemIdByCode = new Map<string, string>();
    if (pendingCodes.length > 0) {
      const { data: itemsByCode } = await this.supabase
        .from("items")
        .select("id, code")
        .eq("tenant_id", tenantId)
        .in("code", pendingCodes);

      (itemsByCode || []).forEach((i: any) => {
        const c = normalizeCode(String(i?.code || ""));
        const id = String(i?.id || "").trim();
        if (c && this.isUuid(id)) itemIdByCode.set(c, id);
      });
    }

    const neededByItemId = new Map<
      string,
      { itemId: string; itemCode: string; needed: number }
    >();
    for (const m of pendingMaterials) {
      const itemCode = normalizeCode(String((m as any)?.item_code || ""));
      let itemId = String((m as any)?.item_id || "").trim();
      if (!this.isUuid(itemId) && itemCode) {
        const resolved = itemIdByCode.get(itemCode);
        if (resolved) itemId = resolved;
      }
      if (!this.isUuid(itemId) || !itemCode) continue;

      const required = Number((m as any)?.required_quantity) || 0;
      const issued = Number((m as any)?.issued_quantity) || 0;
      const needed = Math.max(0, required - issued);
      if (needed <= 0) continue;

      const existing = neededByItemId.get(itemId);
      if (existing) existing.needed += needed;
      else neededByItemId.set(itemId, { itemId, itemCode, needed });
    }

    const targeted = Array.from(neededByItemId.values());
    this.logger.log(
      "[SmartJO][Repair] Ensuring stock for pending BOM materials",
    );
    this.logger.log(
      JSON.stringify({
        tenantId,
        jobOrderId: resolvedJobOrder.id,
        jobOrderNumber: jobOrder.job_order_number,
        pendingMaterialItems: targeted.length,
      }),
    );

    for (const t of targeted) {
      // Match issuing behavior: use stock_entries.available_quantity (not inventory_stock)
      const { data: stockEntries, error: stockErr } = await this.supabase
        .from("stock_entries")
        .select("available_quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", t.itemId)
        .gt("available_quantity", 0);

      if (stockErr) {
        this.logger.error(
          "[SmartJO][Repair] Failed fetching stock for pending material",
        );
        this.logger.error(
          JSON.stringify({
            tenantId,
            jobOrderId,
            itemId: t.itemId,
            itemCode: t.itemCode,
            error: stockErr,
          }),
        );
        continue;
      }

      const entries = Array.isArray(stockEntries) ? stockEntries : [];
      const available = entries.reduce(
        (sum: number, e: any) => sum + (Number(e?.available_quantity) || 0),
        0,
      );
      const shortage = Math.max(0, (Number(t.needed) || 0) - available);
      if (shortage <= 0) continue;

      const bom = await this.getActiveBomForItem(tenantId, t.itemId);
      if (!bom?.id) {
        this.logger.warn(
          "[SmartJO][Repair] Pending material has no BOM; cannot auto-build",
        );
        this.logger.warn(
          JSON.stringify({
            tenantId,
            jobOrderId,
            itemId: t.itemId,
            itemCode: t.itemCode,
            needed: t.needed,
            available,
          }),
        );
        continue;
      }

      await createCompleteAndQcApprove({
        itemId: t.itemId,
        itemCode: t.itemCode,
        bomId: String(bom.id),
        quantity: shortage,
        reason: "PENDING_MATERIAL_SHORTAGE",
      });
    }

    // Finally, re-issue materials for the existing main job order.
    const issueMaterialsSummary = await this.issueJobOrderMaterials(
      tenantId,
      resolvedJobOrder.id,
    );

    return {
      jobOrderId: resolvedJobOrder.id,
      jobOrderNumber: String(jobOrder.job_order_number || ""),
      preview,
      plannedSubAssembliesToMake: subAssembliesToMake.length,
      createdSubJobOrders: completedSubJobOrders.length,
      qcApprovedSubJobOrders,
      issueMaterialsSummary,
    };
  }

  private async normalizeMaterialIds(
    tenantId: string,
    materials: any[],
  ): Promise<any[]> {
    const safeMaterials = Array.isArray(materials) ? materials : [];
    if (safeMaterials.length === 0) return safeMaterials;

    const candidateIds = new Set<string>();
    for (const material of safeMaterials) {
      const itemId = String(material?.itemId || "").trim();
      const selectedVariantId = String(
        material?.selectedVariantId || material?.selected_variant_id || "",
      ).trim();
      if (itemId) candidateIds.add(itemId);
      if (selectedVariantId) candidateIds.add(selectedVariantId);
    }

    const ids = Array.from(candidateIds);
    if (ids.length === 0) return safeMaterials;

    const { data: items } = await this.supabase
      .from("items")
      .select("id")
      .in("id", ids);
    const itemIdSet = new Set((items || []).map((i: any) => i.id));

    const missingIds = ids.filter((id) => !itemIdSet.has(id));
    if (missingIds.length === 0) return safeMaterials;

    const { data: bomHeaders } = await this.supabase
      .from("bom_headers")
      .select("id, item_id")
      .eq("tenant_id", tenantId)
      .in("id", missingIds);

    const headerIdToItemId = new Map<string, string>();
    (bomHeaders || []).forEach((h: any) => {
      if (h?.id && h?.item_id) headerIdToItemId.set(h.id, h.item_id);
    });

    if (headerIdToItemId.size === 0) return safeMaterials;

    return safeMaterials.map((material) => {
      const originalItemId = String(material?.itemId || "").trim();
      const originalVariantId = String(
        material?.selectedVariantId || material?.selected_variant_id || "",
      ).trim();

      const resolvedItemId =
        headerIdToItemId.get(originalItemId) || originalItemId;
      const resolvedVariantId =
        headerIdToItemId.get(originalVariantId) || originalVariantId;

      const next: any = { ...material };
      if (resolvedItemId !== originalItemId) next.itemId = resolvedItemId;

      if (originalVariantId) {
        // Preserve existing key style (frontend sends selectedVariantId)
        if ((material as any).selectedVariantId !== undefined) {
          if (resolvedVariantId !== originalVariantId)
            next.selectedVariantId = resolvedVariantId;
        } else {
          if (resolvedVariantId !== originalVariantId)
            next.selected_variant_id = resolvedVariantId;
        }
      }

      // If the UI used itemId as a proxy for selectedVariantId, keep them aligned.
      if (
        originalVariantId &&
        originalVariantId === originalItemId &&
        resolvedItemId !== originalItemId
      ) {
        if ((material as any).selectedVariantId !== undefined)
          next.selectedVariantId = resolvedItemId;
        else next.selected_variant_id = resolvedItemId;
      }

      return next;
    });
  }

  async create(tenantId: string, userId: string, dto: CreateJobOrderDto) {
    if (process.env.DEBUG_JOB_ORDER === "true") {
      console.log(
        "[JobOrderService] create called - itemId:",
        dto.itemId,
        "quantity:",
        dto.quantity,
      );
      console.log(
        "[JobOrderService] create - materials:",
        JSON.stringify(dto.materials, null, 2),
      );
    }

    // Get item details
    const { data: item } = await this.supabase
      .from("items")
      .select("code, name")
      .eq("id", dto.itemId)
      .single();

    if (!item) throw new NotFoundException("Item not found");

    const normalizedMaterials = await this.normalizeMaterialIds(
      tenantId,
      dto.materials || [],
    );
    const materialAvailability =
      normalizedMaterials && normalizedMaterials.length > 0
        ? await this.checkMaterialAvailability(
            tenantId,
            normalizedMaterials,
            dto.quantity,
          )
        : { available: true, shortages: [] as any[] };

    // Only enforce material availability if explicitly requested.
    // (For production planning / Smart Job Orders, shortages are expected and should not block creation.)
    if (
      dto.validateMaterialsOnCreate &&
      normalizedMaterials &&
      normalizedMaterials.length > 0
    ) {
      if (!materialAvailability.available) {
        throw new BadRequestException(
          `Insufficient materials:\n${materialAvailability.shortages
            .map(
              (s) =>
                `${s.itemCode} - ${s.itemName}: Need ${s.required}, Available ${s.available}, Short ${s.shortage}`,
            )
            .join("\n")}`,
        );
      }
    }

    // Get assigned user name if provided
    let assignedToName = null;
    if (dto.assignedTo) {
      const { data: assignedUser } = await this.supabase
        .from("users")
        .select("id, email, first_name, last_name")
        .eq("id", dto.assignedTo)
        .single();
      assignedToName = this.formatUserDisplayName(assignedUser);
    }

    // Create job order
    const { data: jobOrder, error } = await this.supabase
      .from("production_job_orders")
      .insert({
        tenant_id: tenantId,
        item_id: dto.itemId,
        item_code: item.code,
        item_name: item.name,
        bom_id: dto.bomId || null,
        quantity: dto.quantity,
        start_date: dto.startDate,
        end_date: dto.endDate || null,
        sales_order_id: dto.salesOrderId || null,
        sales_order_item_id: dto.salesOrderItemId || null,
        priority: dto.priority || "NORMAL",
        notes: dto.notes || null,
        assigned_to: dto.assignedTo || null,
        assigned_to_name: assignedToName,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Keep the header and its dependent rows atomic from the application's
    // perspective. PostgREST calls are separate transactions, so explicitly
    // remove the header if operation/material creation fails.
    try {
      // Create operations if provided
      if (dto.operations && dto.operations.length > 0) {
        const operations = await Promise.all(
          dto.operations.map(async (op) => {
            const { data: workstation } = await this.supabase
              .from("work_stations")
              .select("station_name")
              .eq("id", op.workstationId)
              .single();

            let assignedUserName = null;
            if (op.assignedUserId) {
              const { data: user } = await this.supabase
                .from("users")
                .select("id, email, first_name, last_name")
                .eq("id", op.assignedUserId)
                .single();
              assignedUserName = this.formatUserDisplayName(user);
            }

            return {
              job_order_id: jobOrder.id,
              routing_id: op.routingId || null,
              sequence_number: op.sequenceNumber,
              operation_name: op.operationName,
              workstation_id: op.workstationId,
              workstation_name: workstation?.station_name,
              assigned_user_id: op.assignedUserId || null,
              assigned_user_name: assignedUserName,
              start_datetime: op.startDatetime || null,
              end_datetime: op.endDatetime || null,
              expected_duration_hours: op.expectedDurationHours || 0,
              setup_time_hours: op.setupTimeHours || 0,
              accepted_variation_percent: op.acceptedVariationPercent || 0,
              notes: op.notes || null,
            };
          }),
        );

        const { error: opErr } = await this.supabase
          .from("job_order_operations")
          .insert(operations);
        if (opErr) throw new BadRequestException(opErr.message);
      }

      // Create materials if provided
      if (normalizedMaterials && normalizedMaterials.length > 0) {
        const materials = await Promise.all(
          normalizedMaterials.map(async (mat) => {
            const { data: matItem } = await this.supabase
              .from("items")
              .select("code, name")
              .eq("id", mat.itemId)
              .single();

            if (!matItem?.code || !matItem?.name) {
              throw new BadRequestException(
                `Material item not found: ${String(mat.itemId)}`,
              );
            }

            let warehouseName = null;
            if (mat.warehouseId) {
              const { data: wh } = await this.supabase
                .from("warehouses")
                .select("name")
                .eq("id", mat.warehouseId)
                .single();
              warehouseName = wh?.name;
            }

            return {
              job_order_id: jobOrder.id,
              item_id: mat.itemId,
              item_code: matItem?.code,
              item_name: matItem?.name,
              required_quantity: mat.requiredQuantity,
              warehouse_id: mat.warehouseId || null,
              warehouse_name: warehouseName,
              selected_variant_id: (mat as any).selectedVariantId || null,
              variant_notes: (mat as any).variantNotes || null,
              route_operation_id: (mat as any).routeOperationId || null,
              issue_method: (mat as any).issueMethod || "MANUAL",
              input_warehouse_id: (mat as any).inputWarehouseId || null,
              supply_policy: String((mat as any).supplyPolicy || "AUTO").toUpperCase(),
              source_bom_item_id: (mat as any).sourceBomItemId || null,
            };
          }),
        );

        const { error: matErr } = await this.supabase
          .from("job_order_materials")
          .insert(materials);
        if (matErr) throw new BadRequestException(matErr.message);
      }
    } catch (dependentRowError) {
      await this.rollbackCreatedJobOrder(
        tenantId,
        String(jobOrder.id || "").trim(),
      );
      throw dependentRowError;
    }

    let linkedPrNumber: string | null = null;
    let linkedPrId: string | null = null;
    try {
      if (
        !(dto as CreateJobOrderDto & { deferShortagePr?: boolean })
          .deferShortagePr &&
        !materialAvailability.available &&
        materialAvailability.shortages.length > 0
      ) {
        const linkedPr = await this.createShortagePurchaseRequisition(
          tenantId,
          userId,
          jobOrder,
          materialAvailability.shortages,
        );

        linkedPrId = linkedPr?.prId || null;
        linkedPrNumber = linkedPr?.prNumber || null;

        if (linkedPrNumber) {
          const nextNotes = this.appendLinkedPrNote(dto.notes, linkedPrNumber);
          const { error: notesError } = await this.supabase
            .from("production_job_orders")
            .update({ notes: nextNotes })
            .eq("tenant_id", tenantId)
            .eq("id", jobOrder.id);

          if (notesError) throw new BadRequestException(notesError.message);
        }
      }
    } catch (error) {
      await this.rollbackCreatedJobOrder(
        tenantId,
        String(jobOrder.id || "").trim(),
        linkedPrId,
      );
      throw error;
    }

    const created = await this.findOne(tenantId, jobOrder.id);
    const reservation = await this.supabase.rpc(
      "reserve_production_job_materials",
      {
        p_tenant_id: tenantId,
        p_job_order_id: jobOrder.id,
        p_reserved_by: userId,
      },
    );
    if (reservation.error && !String(reservation.error.message || "").includes("Could not find the function")) {
      await this.rollbackCreatedJobOrder(tenantId, String(jobOrder.id), linkedPrId);
      throw new BadRequestException(
        `Job Order stock reservation failed: ${reservation.error.message}`,
      );
    }
    return {
      ...created,
      linked_pr_id: linkedPrId,
      linked_pr_number: linkedPrNumber,
      siv_ready:
        materialAvailability.available && normalizedMaterials.length > 0,
      material_reservation: reservation.data || null,
    };
  }

  async findAll(tenantId: string, filters?: any) {
    let query = this.supabase
      .from("production_job_orders")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    if (filters?.itemId) {
      query = query.eq("item_id", filters.itemId);
    }

    if (filters?.salesOrderId) {
      query = query.eq("sales_order_id", filters.salesOrderId);
    }

    if (filters?.salesOrderItemId) {
      query = query.eq("sales_order_item_id", filters.salesOrderItemId);
    }

    if (filters?.assignedTo) {
      query = query.eq("assigned_to", filters.assignedTo);
    }

    if (filters?.search) {
      query = query.or(
        `job_order_number.ilike.%${filters.search}%,item_code.ilike.%${filters.search}%,item_name.ilike.%${filters.search}%`,
      );
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(error.message);

    const rows = Array.isArray(data) ? data : [];

    // Derive a user-facing workflow status for completed job orders.
    // Rules:
    // - If any UID is ON_HOLD/FAILED => QC Failed
    // - Else if all UIDs are decided (no pending) => QC Completed
    // - Else => Awaiting QC
    const jobOrderIds = rows.map((r: any) => r?.id).filter(Boolean);
    if (jobOrderIds.length === 0) return rows;

    const { data: uidRows, error: uidError } = await this.supabase
      .from("uid_registry")
      .select("job_order_id, quality_status")
      .eq("tenant_id", tenantId)
      .in("job_order_id", jobOrderIds);

    if (uidError) throw new BadRequestException(uidError.message);

    const qcCountsByJobOrderId = new Map<
      string,
      { total: number; passed: number; onHold: number; pending: number }
    >();
    for (const row of Array.isArray(uidRows) ? uidRows : []) {
      const id = String((row as any)?.job_order_id || "").trim();
      if (!id) continue;
      const s = String((row as any)?.quality_status || "").toUpperCase();

      const counts = qcCountsByJobOrderId.get(id) || {
        total: 0,
        passed: 0,
        onHold: 0,
        pending: 0,
      };

      counts.total += 1;
      if (s === "PASSED") counts.passed += 1;
      else if (s === "ON_HOLD" || s === "FAILED") counts.onHold += 1;
      else counts.pending += 1;

      qcCountsByJobOrderId.set(id, counts);
    }

    // Also derive SRV QC completion from stock_entries metadata so non-UID items
    // can still show "QC Completed" after QC release.
    const { data: srvEntries, error: srvEntriesError } = await this.supabase
      .from("stock_entries")
      .select("id, quantity, available_quantity, metadata")
      .eq("tenant_id", tenantId)
      .eq("metadata->>created_from", "STORE_RECEIPT")
      .in("metadata->>job_order_id", jobOrderIds)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (srvEntriesError) throw new BadRequestException(srvEntriesError.message);

    const srvQcByJobOrderId = new Map<
      string,
      { qcCompleted: boolean; srvApproved: boolean }
    >();
    const srvSummaryByJobOrderId = new Map<string, JobOrderStoreFlowSummary>();
    for (const entry of Array.isArray(srvEntries) ? srvEntries : []) {
      const meta = (entry as any)?.metadata || {};
      const jobId = String(meta?.job_order_id || "").trim();
      if (!jobId) continue;

      const hasQcCompletedAt = Boolean(
        String(meta?.qc_completed_at || "").trim(),
      );
      const avail = Number((entry as any)?.available_quantity || 0) || 0;
      const qty = Number((entry as any)?.quantity || 0) || 0;
      const qcCompleted = hasQcCompletedAt || avail > 0;
      const srvApproved = Boolean(String(meta?.srv_approved_at || "").trim());

      const prev = srvQcByJobOrderId.get(jobId) || {
        qcCompleted: false,
        srvApproved: false,
      };
      srvQcByJobOrderId.set(jobId, {
        qcCompleted: prev.qcCompleted || qcCompleted,
        srvApproved: prev.srvApproved || srvApproved,
      });

      const summary = srvSummaryByJobOrderId.get(jobId) || {
        lines: 0,
        quantity: 0,
        approvedLines: 0,
        approvedQuantity: 0,
        pendingLines: 0,
        pendingQuantity: 0,
      };
      summary.lines += 1;
      summary.quantity += qty;
      if (srvApproved) {
        summary.approvedLines += 1;
        summary.approvedQuantity += qty;
      } else {
        summary.pendingLines += 1;
        summary.pendingQuantity += qty;
      }
      srvSummaryByJobOrderId.set(jobId, summary);
    }

    const { data: sivMovements, error: sivMovementsError } = await this.supabase
      .from("stock_movements")
      .select("id, reference_id, quantity, approved_by, approved_at")
      .eq("tenant_id", tenantId)
      .eq("reference_type", "SIV")
      .in("reference_id", jobOrderIds)
      .order("movement_date", { ascending: false })
      .limit(2000);

    if (sivMovementsError)
      throw new BadRequestException(sivMovementsError.message);

    const sivSummaryByJobOrderId = new Map<string, JobOrderStoreFlowSummary>();
    for (const movement of Array.isArray(sivMovements) ? sivMovements : []) {
      const jobId = String((movement as any)?.reference_id || "").trim();
      if (!jobId) continue;

      const qty = Number((movement as any)?.quantity || 0) || 0;
      const approved = Boolean(
        String((movement as any)?.approved_by || "").trim() ||
        String((movement as any)?.approved_at || "").trim(),
      );
      const summary = sivSummaryByJobOrderId.get(jobId) || {
        lines: 0,
        quantity: 0,
        approvedLines: 0,
        approvedQuantity: 0,
        pendingLines: 0,
        pendingQuantity: 0,
      };
      summary.lines += 1;
      summary.quantity += qty;
      if (approved) {
        summary.approvedLines += 1;
        summary.approvedQuantity += qty;
      } else {
        summary.pendingLines += 1;
        summary.pendingQuantity += qty;
      }
      sivSummaryByJobOrderId.set(jobId, summary);
    }

    return Promise.all(
      rows.map(async (r: any) => {
        const baseStatus = String(r?.status || "").trim();
        const baseKey = baseStatus.toUpperCase();
        const linkedPrInfo = this.extractLinkedPurchaseRequisitionInfo(
          r?.notes,
        );
        const linkedPurchaseFlow = linkedPrInfo
          ? await this.resolveLinkedPurchaseFlow(
              tenantId,
              linkedPrInfo.prNumber || null,
            )
          : null;
        const linkedPrWorkflowStatus = linkedPurchaseFlow?.status || null;

        // Default: keep raw status
        let workflowStatus = baseStatus;
        const counts = qcCountsByJobOrderId.get(String(r?.id || "")) || {
          total: 0,
          passed: 0,
          onHold: 0,
          pending: 0,
        };

        const srv = srvQcByJobOrderId.get(String(r?.id || "").trim()) || {
          qcCompleted: false,
          srvApproved: false,
        };

        if ((baseKey === "DRAFT" || baseKey === "SCHEDULED") && linkedPrInfo) {
          // A few legacy Smart JOs have an AUTO_PR token in notes where the
          // historical PR was later removed during test-data cleanup. That is a
          // linked-document exception, not the production status of the Job
          // Order. Keep the JO in its true production state and expose the
          // missing PR only in linked_pr_workflow_status / linked_purchase_flow.
          workflowStatus =
            baseKey === "DRAFT" &&
            linkedPrWorkflowStatus !== LINKED_PR_WORKFLOW_STATUS.PR_NOT_FOUND
              ? linkedPrWorkflowStatus ||
                LINKED_PR_WORKFLOW_STATUS.PENDING_APPROVAL
              : baseStatus;
        } else if (baseKey === "STORE_ISSUED") {
          // Materials have been issued from store to production floor.
          // QC happens later in SRV — so this stage is "Sent to Store".
          if (srv.qcCompleted || (counts.total > 0 && counts.pending === 0))
            workflowStatus = "QC Completed";
          else if (counts.onHold > 0) workflowStatus = "QC Failed";
          else workflowStatus = "Sent to Store";
        } else if (baseKey === "COMPLETED") {
          if (counts.onHold > 0) workflowStatus = "QC Failed";
          else if (
            srv.qcCompleted ||
            (counts.total > 0 && counts.pending === 0)
          )
            workflowStatus = "QC Completed";
          else workflowStatus = "Awaiting QC";
        }

        return {
          ...r,
          workflow_status: workflowStatus,
          linked_pr_number: linkedPrInfo?.prNumber || null,
          linked_pr_workflow_status: linkedPrWorkflowStatus,
          linked_purchase_flow: linkedPurchaseFlow,
          siv_summary:
            sivSummaryByJobOrderId.get(String(r?.id || "").trim()) || null,
          srv_summary:
            srvSummaryByJobOrderId.get(String(r?.id || "").trim()) || null,
          qc_total_uids: counts.total,
          qc_passed_uids: counts.passed,
          qc_rejected_uids: counts.onHold,
          qc_pending_uids: counts.pending,
        };
      }),
    );
  }

  async getFactoryReadiness(tenantId: string, jobOrderId: string) {
    const [job, materials, reservations, actions, pegging, blockers] = await Promise.all([
      this.supabase.from("production_job_orders").select("id,job_order_number,status,quantity,completed_quantity").eq("tenant_id", tenantId).eq("id", jobOrderId).maybeSingle(),
      this.supabase.from("job_order_materials").select("id,item_id,item_code,item_name,required_quantity,issued_quantity,supply_policy").eq("job_order_id", jobOrderId),
      this.supabase.from("stock_reservations").select("reference_line_id,item_id,reserved_quantity,warehouse_id").eq("tenant_id", tenantId).eq("reference_type", "PRODUCTION_JOB_ORDER").eq("reference_id", jobOrderId).eq("released", false),
      this.supabase.from("production_supply_actions").select("*").eq("tenant_id", tenantId).eq("parent_job_order_id", jobOrderId).not("status", "in", '("COMPLETED","CANCELLED")'),
      this.supabase.from("production_supply_pegging").select("*").eq("tenant_id", tenantId).eq("parent_job_order_id", jobOrderId),
      this.supabase.from("production_factory_blockers").select("*").eq("tenant_id", tenantId).eq("job_order_id", jobOrderId),
    ]);
    const firstError = [job, materials, reservations, actions, pegging, blockers].find((result: any) => result.error)?.error;
    if (firstError) throw new BadRequestException(firstError.message);
    if (!job.data) throw new NotFoundException("Job order not found");
    const reservedByLine = new Map<string, number>();
    for (const row of reservations.data || []) {
      const key = String(row.reference_line_id || "");
      reservedByLine.set(key, (reservedByLine.get(key) || 0) + Number(row.reserved_quantity || 0));
    }
    const materialLines = (materials.data || []).map((row: any) => {
      const required = Number(row.required_quantity || 0);
      const issued = Number(row.issued_quantity || 0);
      const reserved = reservedByLine.get(String(row.id)) || 0;
      return { ...row, reserved_quantity: reserved, uncovered_quantity: Math.max(0, required-issued-reserved) };
    });
    const uncovered = materialLines.reduce((sum: number, row: any) => sum + row.uncovered_quantity, 0);
    return {
      job_order: job.data,
      ready_to_release: uncovered <= 0 && (blockers.data || []).length === 0,
      material_summary: {
        lines: materialLines.length,
        reserved_quantity: (reservations.data || []).reduce((sum: number, row: any) => sum + Number(row.reserved_quantity || 0), 0),
        uncovered_quantity: uncovered,
      },
      materials: materialLines,
      supply_actions: actions.data || [],
      supply_pegging: pegging.data || [],
      blockers: blockers.data || [],
      recovery: (blockers.data || []).length
        ? "Open the listed supply action or child Job Order. A supervisor override requires a reason, evidence and expiry."
        : null,
    };
  }

  async createSupervisorOverride(
    tenantId: string,
    jobOrderId: string,
    userId: string,
    body: { controlCode?: string; reason?: string; evidenceReference?: string; validMinutes?: number },
  ) {
    const controlCode = String(body?.controlCode || "").trim().toUpperCase();
    const reason = String(body?.reason || "").trim();
    const validMinutes = Math.min(480, Math.max(5, Number(body?.validMinutes || 30)));
    if (!["WIP_PREDECESSOR"].includes(controlCode))
      throw new BadRequestException("This production control cannot be overridden.");
    if (reason.length < 10)
      throw new BadRequestException("A specific supervisor reason of at least 10 characters is required.");
    const { data: job, error: jobError } = await this.supabase
      .from("production_job_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .maybeSingle();
    if (jobError) throw new BadRequestException(jobError.message);
    if (!job) throw new NotFoundException("Job order not found");
    const { data: execution, error: executionError } = await this.supabase
      .from("production_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId)
      .maybeSingle();
    if (executionError) throw new BadRequestException(executionError.message);
    if (!execution) throw new BadRequestException("Shop-floor execution order is not available.");
    const { data, error } = await this.supabase
      .from("production_supervisor_overrides")
      .insert({
        tenant_id: tenantId,
        production_order_id: execution.id,
        job_order_id: jobOrderId,
        control_code: controlCode,
        reason,
        evidence_reference: body?.evidenceReference || null,
        expires_at: new Date(Date.now() + validMinutes * 60000).toISOString(),
        approved_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return { ...data, warning: "This one-time override is audited and cannot bypass planned-quantity limits." };
  }

  async findOne(tenantId: string, id: string) {
    const { data: jobOrder, error } = await this.supabase
      .from("production_job_orders")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .single();

    if (error) throw new NotFoundException("Job order not found");

    // Get operations
    const { data: operations } = await this.supabase
      .from("job_order_operations")
      .select("*")
      .eq("job_order_id", id)
      .order("sequence_number", { ascending: true });

    const routingIds = (operations || [])
      .map((operation: any) => String(operation.routing_id || "").trim())
      .filter(Boolean);
    const { data: alternatives } = routingIds.length
      ? await this.supabase
          .from("production_resource_alternatives")
          .select("routing_id,work_station_id,priority,efficiency_percent")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .in("routing_id", routingIds)
      : ({ data: [] } as any);
    const alternativeStationIds = (alternatives || []).map((row: any) =>
      String(row.work_station_id),
    );
    const { data: alternativeStations } = alternativeStationIds.length
      ? await this.supabase
          .from("work_stations")
          .select("id,station_name,station_code,station_type")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .in("id", alternativeStationIds)
      : ({ data: [] } as any);
    const stationById = new Map(
      (alternativeStations || []).map((station: any) => [
        String(station.id),
        station,
      ]),
    );
    const dispatches = await this.loadOperationDispatches(tenantId, id);
    const enrichedOperations = (operations || []).map((operation: any) => ({
      ...operation,
      dispatches: dispatches.filter(
        (dispatch: any) =>
          String(dispatch.job_order_operation_id) === String(operation.id),
      ),
      eligible_workstations: [
        {
          id: operation.workstation_id,
          name: operation.workstation_name,
          primary: true,
          priority: 0,
        },
        ...(alternatives || [])
          .filter(
            (row: any) =>
              String(row.routing_id) === String(operation.routing_id) &&
              String(row.work_station_id) !== String(operation.workstation_id),
          )
          .map((row: any) => {
            const station: any = stationById.get(String(row.work_station_id));
            return {
              id: row.work_station_id,
              name: station?.station_name || "Alternative machine",
              type: station?.station_type || "",
              primary: false,
              priority: row.priority,
              efficiency_percent: row.efficiency_percent,
            };
          }),
      ].filter((station) => station.id),
    }));

    // Get materials
    const { data: materials } = await this.supabase
      .from("job_order_materials")
      .select("*")
      .eq("job_order_id", id);

    const linkedPrInfo = this.extractLinkedPurchaseRequisitionInfo(
      (jobOrder as any)?.notes,
    );
    const linkedPurchaseFlow = await this.resolveLinkedPurchaseFlow(
      tenantId,
      linkedPrInfo?.prNumber || null,
    );
    const normalizedLinkedPrWorkflowStatus = linkedPrInfo
      ? linkedPurchaseFlow?.status || LINKED_PR_WORKFLOW_STATUS.PR_NOT_FOUND
      : null;
    const baseStatus = String((jobOrder as any)?.status || "").trim();
    const workflowStatus =
      linkedPrInfo &&
      String(baseStatus).toUpperCase() === "DRAFT" &&
      normalizedLinkedPrWorkflowStatus !==
        LINKED_PR_WORKFLOW_STATUS.PR_NOT_FOUND
        ? normalizedLinkedPrWorkflowStatus ||
          LINKED_PR_WORKFLOW_STATUS.PENDING_APPROVAL
        : baseStatus;

    const [sivSummary, srvSummary] = await Promise.all([
      this.resolveJobOrderSivSummary(tenantId, id),
      this.resolveJobOrderSrvSummary(tenantId, id),
    ]);

    return {
      ...jobOrder,
      workflow_status: workflowStatus,
      linked_pr_number: linkedPrInfo?.prNumber || null,
      linked_pr_workflow_status: normalizedLinkedPrWorkflowStatus,
      linked_purchase_flow: linkedPurchaseFlow,
      siv_summary: sivSummary,
      srv_summary: srvSummary,
      operations: enrichedOperations,
      materials: materials || [],
    };
  }

  private async loadOperationDispatches(tenantId: string, jobOrderId: string) {
    const { data, error } = await this.supabase
      .from("production_schedule_operations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId)
      .order("created_at", { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const schedules = (data || []).flatMap((row: any) => {
      try {
        const detail = JSON.parse(String(row.scheduling_note || "{}"));
        return detail?.kind === "JOB_CARD" ? [{ row, detail }] : [];
      } catch {
        return [];
      }
    });
    const { data: completions } = schedules.length
      ? await this.supabase
          .from("station_completions")
          .select("notes,quantity_completed,quantity_rejected,status")
          .eq("tenant_id", tenantId)
          .eq("job_order_id", jobOrderId)
      : ({ data: [] } as any);
    const stationIds = [...new Set(schedules.map(({ row }: any) => row.work_station_id).filter(Boolean))];
    const { data: stations } = stationIds.length
      ? await this.supabase
          .from("work_stations")
          .select("id,station_code,station_name,station_type")
          .eq("tenant_id", tenantId)
          .in("id", stationIds)
      : ({ data: [] } as any);
    const stationById = new Map((stations || []).map((row: any) => [String(row.id), row]));
    return schedules.map(({ row, detail }: any) => {
      const marker = `[[JOB_CARD:${row.id}]]`;
      const executions = (completions || []).filter((entry: any) =>
        String(entry.notes || "").includes(marker),
      );
      const completedQuantity = executions
        .filter((entry: any) => entry.status === "COMPLETED")
        .reduce((sum: number, entry: any) => sum + Number(entry.quantity_completed || 0), 0);
      const rejectedQuantity = executions
        .filter((entry: any) => entry.status === "COMPLETED")
        .reduce((sum: number, entry: any) => sum + Number(entry.quantity_rejected || 0), 0);
      const assignedQuantity = Number(detail.assigned_quantity || 0);
      const processed = completedQuantity + rejectedQuantity;
      const status = row.status === "IN_PROGRESS"
        ? "IN_PROGRESS"
        : row.status === "COMPLETED" || processed >= assignedQuantity
          ? "COMPLETED"
          : processed > 0
            ? "PARTIALLY_COMPLETED"
            : "DISPATCHED";
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        dispatch_number: detail.dispatch_number,
        job_order_id: row.job_order_id,
        job_order_operation_id: detail.job_order_operation_id,
        routing_id: detail.routing_id,
        work_station_id: row.work_station_id,
        assigned_quantity: assignedQuantity,
        completed_quantity: completedQuantity,
        rejected_quantity: rejectedQuantity,
        planned_start: row.planned_start,
        planned_end: row.planned_end,
        assigned_operator_id: detail.assigned_operator_id || null,
        assigned_operator_name: detail.assigned_operator_name || null,
        notes: detail.notes || null,
        status,
        created_by: detail.created_by || null,
        created_at: row.created_at,
        work_station: stationById.get(String(row.work_station_id)) || null,
      };
    });
  }

  async getOperationDispatches(tenantId: string, jobOrderId: string) {
    const { data: job } = await this.supabase
      .from("production_job_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .maybeSingle();
    if (!job) throw new NotFoundException("Job order not found");
    return this.loadOperationDispatches(tenantId, jobOrderId);
  }

  async dispatchOperation(
    tenantId: string,
    userId: string,
    jobOrderId: string,
    operationId: string,
    body: any,
  ) {
    const quantity = Number(body?.assignedQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new BadRequestException("Assigned quantity must be greater than zero");
    if (!body?.workStationId)
      throw new BadRequestException("Select the machine for this Job Card");
    const [{ data: job }, { data: operation }] = await Promise.all([
      this.supabase
        .from("production_job_orders")
        .select("id,job_order_number,quantity,status,start_date,end_date")
        .eq("tenant_id", tenantId)
        .eq("id", jobOrderId)
        .single(),
      this.supabase
        .from("job_order_operations")
        .select("id,job_order_id,routing_id,sequence_number,operation_name,workstation_id,expected_duration_hours")
        .eq("id", operationId)
        .eq("job_order_id", jobOrderId)
        .single(),
    ]);
    if (!job) throw new NotFoundException("Job order not found");
    if (!operation) throw new NotFoundException("Job Order operation not found");
    if (["COMPLETED", "CANCELLED", "CLOSED"].includes(String(job.status).toUpperCase()))
      throw new BadRequestException("A closed Job Order cannot receive new machine allocations");
    const { data: alternatives } = operation.routing_id
      ? await this.supabase
          .from("production_resource_alternatives")
          .select("work_station_id")
          .eq("tenant_id", tenantId)
          .eq("routing_id", operation.routing_id)
          .eq("is_active", true)
      : ({ data: [] } as any);
    const eligibleStations = new Set([
      String(operation.workstation_id || ""),
      ...(alternatives || []).map((row: any) => String(row.work_station_id)),
    ]);
    if (!eligibleStations.has(String(body.workStationId)))
      throw new BadRequestException("The selected machine is not approved for this routing operation");
    const existingDispatches = await this.loadOperationDispatches(tenantId, jobOrderId);
    const allocated = existingDispatches
      .filter((row: any) => String(row.job_order_operation_id) === String(operationId))
      .reduce((sum: number, row: any) => sum + Number(row.assigned_quantity || 0), 0);
    if (allocated + quantity > Number(job.quantity || 0))
      throw new BadRequestException(
        `This allocation exceeds the ${Number(job.quantity || 0) - allocated} units remaining for the operation`,
      );
    const safeJob = String(job.job_order_number || "JO").replace(/[^A-Za-z0-9-]/g, "");
    const dispatchNumber = `JC-${safeJob}-${String(operation.sequence_number).padStart(2, "0")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const plannedStart = new Date(body.plannedStart || job.start_date || Date.now());
    const defaultMinutes = Math.max(1, Math.round(Number(operation.expected_duration_hours || 1) * 60));
    const plannedEnd = new Date(body.plannedEnd || plannedStart.getTime() + defaultMinutes * 60000);
    if (!Number.isFinite(plannedStart.getTime()) || !Number.isFinite(plannedEnd.getTime()) || plannedEnd <= plannedStart)
      throw new BadRequestException("Enter a valid planned start and end time for the Job Card");
    const { data: conflicts, error: conflictError } = await this.supabase
      .from("production_schedule_operations")
      .select("id,operation_code")
      .eq("tenant_id", tenantId)
      .eq("work_station_id", body.workStationId)
      .in("status", ["PLANNED", "RELEASED", "IN_PROGRESS"])
      .lt("planned_start", plannedEnd.toISOString())
      .gt("planned_end", plannedStart.toISOString())
      .limit(1);
    if (conflictError) throw new BadRequestException(conflictError.message);
    if ((conflicts || []).length)
      throw new BadRequestException("This machine already has work allocated in the selected time window");
    const detail = {
      kind: "JOB_CARD",
      dispatch_number: dispatchNumber,
      job_order_operation_id: operationId,
      routing_id: operation.routing_id || null,
      assigned_quantity: quantity,
      assigned_operator_id: body.assignedOperatorId || null,
      assigned_operator_name: String(body.assignedOperatorName || "").trim() || null,
      notes: String(body.notes || "").trim() || null,
      created_by: userId || null,
    };
    const payload = {
      tenant_id: tenantId,
      job_order_id: jobOrderId,
      work_station_id: body.workStationId,
      operation_code: `JC-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      planned_start: plannedStart.toISOString(),
      planned_end: plannedEnd.toISOString(),
      planned_minutes: Math.max(1, Math.ceil((plannedEnd.getTime() - plannedStart.getTime()) / 60000)),
      status: "PLANNED",
      scheduling_note: JSON.stringify(detail),
    };
    const { data, error } = await this.supabase
      .from("production_schedule_operations")
      .insert(payload)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return (await this.loadOperationDispatches(tenantId, jobOrderId)).find(
      (row: any) => String(row.id) === String(data.id),
    );
  }

  async cancelOperationDispatch(
    tenantId: string,
    jobOrderId: string,
    dispatchId: string,
  ) {
    const { data: current, error: currentError } = await this.supabase
      .from("production_schedule_operations")
      .select("id,status,scheduling_note")
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId)
      .eq("id", dispatchId)
      .single();
    if (currentError || !current) throw new NotFoundException("Job Card allocation not found");
    let detail: any = {};
    try { detail = JSON.parse(String(current.scheduling_note || "{}")); } catch {}
    if (detail.kind !== "JOB_CARD") throw new NotFoundException("Job Card allocation not found");
    const dispatches = await this.loadOperationDispatches(tenantId, jobOrderId);
    const normalized = dispatches.find((row: any) => String(row.id) === String(dispatchId));
    if (!normalized) throw new NotFoundException("Job Card allocation not found");
    if (["IN_PROGRESS", "PARTIALLY_COMPLETED", "COMPLETED"].includes(String(normalized.status)))
      throw new BadRequestException("A started Job Card cannot be cancelled; complete or close its execution first");
    const { error } = await this.supabase
      .from("production_schedule_operations")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId)
      .eq("id", dispatchId)
      .eq("id", dispatchId);
    if (error) throw new BadRequestException(error.message);
    return { id: dispatchId, status: "CANCELLED" };
  }

  private emptyStoreFlowSummary(): JobOrderStoreFlowSummary {
    return {
      lines: 0,
      quantity: 0,
      approvedLines: 0,
      approvedQuantity: 0,
      pendingLines: 0,
      pendingQuantity: 0,
    };
  }

  private async resolveJobOrderSivSummary(
    tenantId: string,
    jobOrderId: string,
  ): Promise<JobOrderStoreFlowSummary> {
    const normalizedJobOrderId = String(jobOrderId || "").trim();
    const summary = this.emptyStoreFlowSummary();
    if (!normalizedJobOrderId) return summary;

    const { data, error } = await this.supabase
      .from("stock_movements")
      .select("id, quantity, approved_by, approved_at")
      .eq("tenant_id", tenantId)
      .eq("reference_type", "SIV")
      .eq("reference_id", normalizedJobOrderId);

    if (error) throw new BadRequestException(error.message);

    for (const row of Array.isArray(data) ? data : []) {
      const qty = Number((row as any)?.quantity || 0) || 0;
      const approved = Boolean(
        String((row as any)?.approved_by || "").trim() ||
        String((row as any)?.approved_at || "").trim(),
      );
      summary.lines += 1;
      summary.quantity += qty;
      if (approved) {
        summary.approvedLines += 1;
        summary.approvedQuantity += qty;
      } else {
        summary.pendingLines += 1;
        summary.pendingQuantity += qty;
      }
    }

    return summary;
  }

  private async resolveJobOrderSrvSummary(
    tenantId: string,
    jobOrderId: string,
  ): Promise<JobOrderStoreFlowSummary> {
    const normalizedJobOrderId = String(jobOrderId || "").trim();
    const summary = this.emptyStoreFlowSummary();
    if (!normalizedJobOrderId) return summary;

    const { data, error } = await this.supabase
      .from("stock_entries")
      .select("id, quantity, metadata")
      .eq("tenant_id", tenantId)
      .eq("metadata->>created_from", "STORE_RECEIPT")
      .eq("metadata->>job_order_id", normalizedJobOrderId);

    if (error) throw new BadRequestException(error.message);

    for (const row of Array.isArray(data) ? data : []) {
      const qty = Number((row as any)?.quantity || 0) || 0;
      const meta = (row as any)?.metadata || {};
      const approved = Boolean(String(meta?.srv_approved_at || "").trim());
      summary.lines += 1;
      summary.quantity += qty;
      if (approved) {
        summary.approvedLines += 1;
        summary.approvedQuantity += qty;
      } else {
        summary.pendingLines += 1;
        summary.pendingQuantity += qty;
      }
    }

    return summary;
  }

  private async resolveLinkedPurchaseWorkflowStatus(
    tenantId: string,
    prNumber: string | null,
  ): Promise<string | null> {
    const flow = await this.resolveLinkedPurchaseFlow(tenantId, prNumber);
    return flow?.status || null;
  }

  private async resolveLinkedPurchaseFlow(
    tenantId: string,
    prNumber: string | null,
  ): Promise<LinkedPurchaseFlow | null> {
    const normalizedPrNumber = String(prNumber || "").trim();
    if (!normalizedPrNumber) return null;

    const { data: requisition } = await this.supabase
      .from("purchase_requisitions")
      .select(
        `
        id,
        pr_number,
        status,
        purchase_requisition_items(remaining_qty, requested_qty)
      `,
      )
      .eq("tenant_id", tenantId)
      .eq("pr_number", normalizedPrNumber)
      .maybeSingle();

    if (!requisition) {
      return {
        prNumber: normalizedPrNumber,
        prId: null,
        prStatus: null,
        status: LINKED_PR_WORKFLOW_STATUS.PR_NOT_FOUND,
        rfqSentCount: 0,
        rfqReceivedCount: 0,
        poCount: 0,
        poNumbers: [],
        grnCount: 0,
        grnNumbers: [],
        orderedQty: 0,
        receivedQty: 0,
      };
    }

    const prId = String((requisition as any)?.id || "").trim();
    if (!prId) {
      return {
        prNumber: normalizedPrNumber,
        prId: null,
        prStatus: String((requisition as any)?.status || "").trim() || null,
        status: LINKED_PR_WORKFLOW_STATUS.PR_NOT_FOUND,
        rfqSentCount: 0,
        rfqReceivedCount: 0,
        poCount: 0,
        poNumbers: [],
        grnCount: 0,
        grnNumbers: [],
        orderedQty: 0,
        receivedQty: 0,
      };
    }

    const [{ data: rfqRows }, { data: poRows }] = await Promise.all([
      this.supabase
        .from("rfqs")
        .select("status, sent_at, vendor_quote_received_at, notes")
        .eq("tenant_id", tenantId)
        .eq("pr_id", prId),
      this.supabase
        .from("purchase_orders")
        .select(
          "id, po_number, purchase_order_items(ordered_qty, received_qty)",
        )
        .eq("tenant_id", tenantId)
        .eq("pr_id", prId),
    ]);

    const poIds = (Array.isArray(poRows) ? poRows : [])
      .map((row: any) => String(row?.id || "").trim())
      .filter(Boolean);

    let grnRows: any[] = [];
    if (poIds.length > 0) {
      const { data } = await this.supabase
        .from("grns")
        .select("id, grn_number, status, po_id")
        .eq("tenant_id", tenantId)
        .in("po_id", poIds);
      grnRows = Array.isArray(data) ? data : [];
    }

    const items = Array.isArray(
      (requisition as any)?.purchase_requisition_items,
    )
      ? (requisition as any).purchase_requisition_items
      : [];

    const rfqSummary = {
      sentCount: 0,
      receivedCount: 0,
    };

    (Array.isArray(rfqRows) ? rfqRows : []).forEach((row: any) => {
      const notes = parseLinkedPrNotes(row?.notes);
      const normalizedStatus = normalizeLinkedPrStatus(row?.status);
      if (row?.sent_at) rfqSummary.sentCount += 1;
      if (
        normalizedStatus === "RECEIVED" ||
        row?.vendor_quote_received_at ||
        notes?.receivedAt
      ) {
        rfqSummary.receivedCount += 1;
      }
    });

    const poSummary = {
      totalOrderedQty: 0,
      totalReceivedQty: 0,
    };
    const poNumbers: string[] = [];

    (Array.isArray(poRows) ? poRows : []).forEach((row: any) => {
      const poNumber = String(row?.po_number || "").trim();
      if (poNumber) poNumbers.push(poNumber);
      const poItems = Array.isArray(row?.purchase_order_items)
        ? row.purchase_order_items
        : [];
      poItems.forEach((item: any) => {
        poSummary.totalOrderedQty += Number(item?.ordered_qty || 0);
        poSummary.totalReceivedQty += Number(item?.received_qty || 0);
      });
    });

    const baseStatus = normalizeLinkedPrStatus((requisition as any)?.status);
    const poDone =
      items.length > 0 &&
      items.every(
        (item: any) =>
          Number(item?.remaining_qty ?? item?.requested_qty ?? 0) <= 0,
      );
    const goodsReceived =
      poSummary.totalOrderedQty > 0 &&
      poSummary.totalReceivedQty >= poSummary.totalOrderedQty;

    if (baseStatus === LINKED_PR_WORKFLOW_STATUS.REJECTED) {
      return {
        prNumber: String(
          (requisition as any)?.pr_number || normalizedPrNumber,
        ).trim(),
        prId,
        prStatus: baseStatus || null,
        status: LINKED_PR_WORKFLOW_STATUS.REJECTED,
        rfqSentCount: rfqSummary.sentCount,
        rfqReceivedCount: rfqSummary.receivedCount,
        poCount: poNumbers.length,
        poNumbers,
        grnCount: grnRows.length,
        grnNumbers: grnRows
          .map((row: any) => String(row?.grn_number || "").trim())
          .filter(Boolean),
        orderedQty: poSummary.totalOrderedQty,
        receivedQty: poSummary.totalReceivedQty,
      };
    }

    let status: string;
    if (baseStatus === LINKED_PR_WORKFLOW_STATUS.DRAFT || !baseStatus) {
      status = LINKED_PR_WORKFLOW_STATUS.DRAFT;
    } else if (baseStatus === "SUBMITTED" || baseStatus === "PENDING") {
      status = LINKED_PR_WORKFLOW_STATUS.PENDING_APPROVAL;
    } else if (goodsReceived) {
      status = LINKED_PR_WORKFLOW_STATUS.GOODS_RCVD;
    } else if (poDone || poNumbers.length > 0) {
      status = LINKED_PR_WORKFLOW_STATUS.PO_DONE;
    } else if (rfqSummary.receivedCount > 0) {
      status = LINKED_PR_WORKFLOW_STATUS.RFQ_RCVD;
    } else if (baseStatus === "APPROVED" && rfqSummary.sentCount === 0) {
      status = LINKED_PR_WORKFLOW_STATUS.APPROVED;
    } else {
      status = LINKED_PR_WORKFLOW_STATUS.RFQ_ISSUED;
    }

    return {
      prNumber: String(
        (requisition as any)?.pr_number || normalizedPrNumber,
      ).trim(),
      prId,
      prStatus: baseStatus || null,
      status,
      rfqSentCount: rfqSummary.sentCount,
      rfqReceivedCount: rfqSummary.receivedCount,
      poCount: poNumbers.length,
      poNumbers,
      grnCount: grnRows.length,
      grnNumbers: grnRows
        .map((row: any) => String(row?.grn_number || "").trim())
        .filter(Boolean),
      orderedQty: poSummary.totalOrderedQty,
      receivedQty: poSummary.totalReceivedQty,
    };
  }

  private extractLinkedPurchaseRequisitionInfo(
    notes: unknown,
  ): LinkedPurchaseRequisitionInfo | null {
    const text = String(notes || "").trim();
    if (!text) return null;

    const tokenMatch = text.match(/\[AUTO_PR:([^\]]+)\]/i);
    if (tokenMatch?.[1]) {
      return { prNumber: String(tokenMatch[1]).trim() };
    }

    const labelMatch = text.match(/PR\s+Issued\s*:\s*([A-Z0-9\/-]+)/i);
    if (labelMatch?.[1]) {
      return { prNumber: String(labelMatch[1]).trim() };
    }

    return null;
  }

  private appendLinkedPrNote(existingNotes: unknown, prNumber: string): string {
    const current = String(existingNotes || "").trim();
    if (current.includes(`[AUTO_PR:${prNumber}]`)) return current;

    const addition = `PR Issued: ${prNumber} for shortage items. [AUTO_PR:${prNumber}]`;
    return current ? `${current}\n${addition}` : addition;
  }

  private async generatePRNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `PR-${year}-${month}`;

    const { data } = await this.supabase
      .from("purchase_requisitions")
      .select("pr_number")
      .eq("tenant_id", tenantId)
      .like("pr_number", "PR-%");

    let maxSeq = 0;
    for (const row of data || []) {
      const match = /^PR-\d{4}-\d{2}-(\d+)$/.exec((row as any).pr_number || "");
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }

    return `${prefix}-${String(maxSeq + 1).padStart(3, "0")}`;
  }

  private async createShortagePurchaseRequisition(
    tenantId: string,
    userId: string,
    jobOrder: any,
    shortages: Array<{
      itemId: string;
      itemCode: string;
      itemName: string;
      required: number;
      available: number;
      shortage: number;
      supplyPolicy?: string;
      sourceBomItemId?: string | null;
    }>,
    options?: {
      master?: boolean;
      childJobOrderCount?: number;
    },
  ): Promise<{ prId: string | null; prNumber: string | null } | null> {
    if (!Array.isArray(shortages) || shortages.length === 0) return null;

    const rawMaterialShortages = (
      await Promise.all(
        shortages.map(async (shortage) => {
          const itemId = String(shortage.itemId || "").trim();
          if (!itemId) return null;

          const policy = String(shortage.supplyPolicy || "AUTO").toUpperCase();
          if (["MAKE", "SUBCONTRACT", "TRANSFER", "PLANNER_CHOICE", "PHANTOM"].includes(policy)) {
            return null;
          }

          // BUY/DIRECT can be externally sourced even when engineering has a
          // BOM. AUTO+active BOM remains a manufactured component.
          if (!["BUY", "DIRECT"].includes(policy)) {
            const activeBom = await this.getActiveBomForItem(tenantId, itemId);
            if (activeBom) return null;
          }

          return shortage;
        }),
      )
    ).filter(
      (
        row,
      ): row is {
        itemId: string;
        itemCode: string;
        itemName: string;
        required: number;
        available: number;
        shortage: number;
        supplyPolicy?: string;
        sourceBomItemId?: string | null;
      } => Boolean(row),
    );

    if (rawMaterialShortages.length === 0) return null;

    const prNumber = await this.generatePRNumber(tenantId);
    const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    let createdPrId: string | null = null;
    try {
      const { data: pr, error } = await this.supabase
        .from("purchase_requisitions")
        .insert({
          tenant_id: tenantId,
          pr_number: prNumber,
          request_date: new Date().toISOString().split("T")[0],
          department: "PRODUCTION",
          purpose: options?.master
            ? `Master shortage for Job Order tree ${String(jobOrder?.job_order_number || "").trim()}`
            : `Shortage for Job Order ${String(jobOrder?.job_order_number || "").trim()}`,
          requested_by: userId,
          required_date: requiredDate,
          status: "SUBMITTED",
          submitted_at: new Date().toISOString(),
          current_approval_level: 0,
          remarks: options?.master
            ? `MASTER PR: consolidated shortages for parent Job Order ${String(jobOrder?.job_order_number || "").trim()} and ${Number(options?.childJobOrderCount || 0)} child Job Order(s). [JOB_ORDER:${String(jobOrder?.id || "").trim()}]`
            : `Auto-generated from Job Order ${String(jobOrder?.job_order_number || "").trim()} [JOB_ORDER:${String(jobOrder?.id || "").trim()}]`,
        })
        .select("id, pr_number")
        .single();

      if (error) throw new BadRequestException(error.message);

      createdPrId = String(pr?.id || "").trim() || null;

      if (createdPrId) {
        await this.supabase
          .from("purchase_requisition_approval_history")
          .insert({
            tenant_id: tenantId,
            pr_id: createdPrId,
            actor_id: userId,
            action: "SUBMITTED",
            from_status: "AUTO_CREATED",
            to_status: "SUBMITTED",
            reason: options?.master
              ? `Auto-submitted master shortage PR for Job Order tree ${String(jobOrder?.job_order_number || "").trim()}`
              : `Auto-submitted from Job Order ${String(jobOrder?.job_order_number || "").trim()} shortage planning`,
            approval_level: 0,
          } as any);
      }

      const itemIds = rawMaterialShortages
        .map((row) => String(row.itemId || "").trim())
        .filter(Boolean);
      const { data: itemRows, error: itemRowsError } = await this.supabase
        .from("items")
        .select("id, code, name, uom, standard_cost, selling_price")
        .eq("tenant_id", tenantId)
        .in("id", itemIds);

      if (itemRowsError) throw new BadRequestException(itemRowsError.message);

      const itemById = new Map<string, any>();
      for (const row of itemRows || []) {
        const itemId = String((row as any)?.id || "").trim();
        if (itemId) itemById.set(itemId, row);
      }

      const preferredVendorByItemId = new Map<string, any>();
      if (itemIds.length > 0) {
        const { data: vendorLinks, error: vendorLinkError } =
          await this.supabase
            .from("item_vendors")
            .select(
              "item_id, vendor_id, unit_price, priority, vendor:vendors(id, code, name, is_active, is_verified, approval_status)",
            )
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .in("item_id", itemIds)
            .order("priority", { ascending: true });

        if (vendorLinkError)
          throw new BadRequestException(vendorLinkError.message);

        for (const link of vendorLinks || []) {
          const itemId = String((link as any)?.item_id || "").trim();
          if (!itemId || preferredVendorByItemId.has(itemId)) continue;
          const vendor = Array.isArray((link as any)?.vendor)
            ? (link as any).vendor[0]
            : (link as any)?.vendor;
          const approvalStatus = String(vendor?.approval_status || "")
            .trim()
            .toUpperCase();
          const isApproved =
            vendor?.is_verified === true ||
            ["APPROVED", "VERIFIED"].includes(approvalStatus);
          if (vendor?.is_active === false || !isApproved) continue;
          preferredVendorByItemId.set(itemId, { ...link, vendor });
        }
      }

      const itemsPayload = rawMaterialShortages
        .map((shortage) => {
          const shortageItemId = String(shortage.itemId || "").trim();
          const item = itemById.get(shortageItemId) || {};
          const preferredVendor = preferredVendorByItemId.get(shortageItemId);
          const preferredVendorName = String(
            preferredVendor?.vendor?.name || "",
          ).trim();
          const preferredVendorRate =
            Number(preferredVendor?.unit_price || 0) || 0;
          const estimatedRate =
            preferredVendorRate ||
            Number(
              (item as any)?.standard_cost || (item as any)?.selling_price || 0,
            ) ||
            0;
          const baseRemark = `Required ${Number(shortage.required || 0)}, available ${Number(shortage.available || 0)} for Job Order ${String(jobOrder?.job_order_number || "").trim()}`;
          return {
            pr_id: pr.id,
            item_id: shortageItemId,
            vendor_id:
              preferredVendor?.vendor_id || preferredVendor?.vendor?.id || null,
            item_code: String(
              (item as any)?.code || shortage.itemCode || "",
            ).trim(),
            item_name: String(
              (item as any)?.name || shortage.itemName || "",
            ).trim(),
            description: options?.master
              ? `Consolidated shortage for Job Order tree ${String(jobOrder?.job_order_number || "").trim()}`
              : `Auto-generated shortage for ${String(jobOrder?.job_order_number || "").trim()}`,
            uom: String((item as any)?.uom || "Nos").trim() || "Nos",
            requested_qty: Math.max(0, Number(shortage.shortage || 0)),
            estimated_rate: estimatedRate,
            required_date: requiredDate,
            remarks: preferredVendorName
              ? `${baseRemark}. Preferred supplier: ${preferredVendorName}.`
              : `${baseRemark}. No active approved preferred supplier found; Purchase must select vendor.`,
          };
        })
        .filter(
          (row) => row.item_code && row.item_name && row.requested_qty > 0,
        );

      if (itemsPayload.length === 0) {
        return {
          prId: createdPrId,
          prNumber: String(pr?.pr_number || prNumber || "").trim() || null,
        };
      }

      const { error: itemsError } = await this.supabase
        .from("purchase_requisition_items")
        .insert(itemsPayload as any);

      if (itemsError) throw new BadRequestException(itemsError.message);

      return {
        prId: createdPrId,
        prNumber: String(pr?.pr_number || prNumber || "").trim() || null,
      };
    } catch (error) {
      if (createdPrId) {
        await this.supabase
          .from("purchase_requisition_items")
          .delete()
          .eq("pr_id", createdPrId);
        await this.supabase
          .from("purchase_requisitions")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("id", createdPrId);
      }
      throw error;
    }
  }

  private async rollbackCreatedJobOrder(
    tenantId: string,
    jobOrderId: string,
    linkedPrId?: string | null,
  ) {
    const normalizedJobOrderId = String(jobOrderId || "").trim();
    if (!normalizedJobOrderId) return;

    await this.supabase
      .from("job_order_operations")
      .delete()
      .eq("job_order_id", normalizedJobOrderId);
    await this.supabase
      .from("job_order_materials")
      .delete()
      .eq("job_order_id", normalizedJobOrderId);
    await this.supabase
      .from("production_job_orders")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", normalizedJobOrderId);

    const normalizedPrId = String(linkedPrId || "").trim();
    if (normalizedPrId) {
      await this.supabase
        .from("purchase_requisition_items")
        .delete()
        .eq("pr_id", normalizedPrId);
      await this.supabase
        .from("purchase_requisitions")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", normalizedPrId);
    }
  }

  private async resolveUidMappingsForIssue(params: {
    tenantId: string;
    itemId: string;
    requestedIssueQty: number;
    normalizedUids: string[];
    uidTrackingEnabled: boolean;
    uidStrategy: string;
    qtyPerUid: number;
  }): Promise<string[]> {
    const {
      tenantId,
      itemId,
      requestedIssueQty,
      normalizedUids,
      uidTrackingEnabled,
      uidStrategy,
      qtyPerUid,
    } = params;

    if (!uidTrackingEnabled || normalizedUids.length > 0) {
      return normalizedUids;
    }

    if (uidStrategy === "BATCHED") {
      const ratio = requestedIssueQty / qtyPerUid;
      if (
        !Number.isFinite(ratio) ||
        Math.abs(ratio - Math.round(ratio)) > 1e-9
      ) {
        throw new BadRequestException(
          `Issue quantity must be a multiple of batch_quantity=${qtyPerUid} for this UID-tracked item`,
        );
      }
    }

    const neededUidCount =
      uidStrategy === "BATCHED"
        ? Math.round(requestedIssueQty / qtyPerUid)
        : Math.round(requestedIssueQty);

    if (!Number.isFinite(neededUidCount) || neededUidCount <= 0) {
      throw new BadRequestException(
        "Unable to determine required UID count for this issue",
      );
    }

    const { data: autoUidRows, error: autoUidError } = await this.supabase
      .from("uid_registry")
      .select("uid, status")
      .eq("tenant_id", tenantId)
      .eq("entity_id", itemId)
      .order("created_at", { ascending: true });

    if (autoUidError) {
      throw new BadRequestException(autoUidError.message);
    }

    const autoUids = (Array.isArray(autoUidRows) ? autoUidRows : [])
      .filter((row: any) => this.isIssuableUidStatus(row?.status))
      .map((row: any) => String(row?.uid || "").trim())
      .filter(Boolean)
      .slice(0, neededUidCount);

    if (autoUids.length < neededUidCount) {
      throw new BadRequestException(
        "This item requires UID mapping. Please scan UIDs before issuing.",
      );
    }

    return autoUids;
  }

  async update(tenantId: string, id: string, dto: UpdateJobOrderDto) {
    const updateData: any = {};

    if (dto.startDate !== undefined) updateData.start_date = dto.startDate;
    if (dto.endDate !== undefined) updateData.end_date = dto.endDate;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.salesOrderId !== undefined)
      updateData.sales_order_id = dto.salesOrderId;
    if (dto.salesOrderItemId !== undefined)
      updateData.sales_order_item_id = dto.salesOrderItemId;
    if (dto.assignedTo !== undefined) updateData.assigned_to = dto.assignedTo;

    // Get assigned user name if assignedTo is being updated
    if (dto.assignedTo) {
      const { data: assignedUser } = await this.supabase
        .from("users")
        .select("id, email, first_name, last_name")
        .eq("id", dto.assignedTo)
        .single();
      updateData.assigned_to_name = this.formatUserDisplayName(assignedUser);
    } else if (dto.assignedTo === null) {
      updateData.assigned_to = null;
      updateData.assigned_to_name = null;
    }

    const { error } = await this.supabase
      .from("production_job_orders")
      .update(updateData)
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) throw new BadRequestException(error.message);

    return this.findOne(tenantId, id);
  }

  async updateStatus(tenantId: string, id: string, status: string) {
    const updates: any = { status };

    if (status === "IN_PROGRESS") {
      const { data: materialRows, error: materialError } = await this.supabase
        .from("job_order_materials")
        .select("required_quantity, issued_quantity")
        .eq("job_order_id", id);

      if (materialError) throw new BadRequestException(materialError.message);

      const hasPendingMaterials = (materialRows || []).some((m: any) => {
        const required = Number(m?.required_quantity || 0);
        const issued = Number(m?.issued_quantity || 0);
        return issued + 1e-9 < required;
      });

      if (hasPendingMaterials) {
        throw new BadRequestException(
          "SIV pending: materials are not fully assigned yet. Complete SIV (Store Issue Voucher) first from Inventory.",
        );
      }

      updates.actual_start_date = new Date().toISOString();
    } else if (status === "COMPLETED") {
      updates.actual_end_date = new Date().toISOString();
    }

    const { error } = await this.supabase
      .from("production_job_orders")
      .update(updates)
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) throw new BadRequestException(error.message);

    return this.findOne(tenantId, id);
  }

  async stopJobOrder(
    tenantId: string,
    id: string,
    userId?: string,
    reason?: string,
    producedQuantity?: number,
  ) {
    // Get job order to verify it exists and is not already stopped/completed
    const { data: jobOrder, error: fetchError } = await this.supabase
      .from("production_job_orders")
      .select("id, status, job_order_number, quantity, completed_quantity")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .single();

    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const currentStatus = String(jobOrder.status || "").toUpperCase();

    // Cannot stop already completed, cancelled, or stopped job orders
    if (["COMPLETED", "CANCELLED", "STOPPED"].includes(currentStatus)) {
      throw new BadRequestException(
        `Cannot stop a job order that is already ${currentStatus.toLowerCase()}`,
      );
    }

    const plannedQty = Math.max(0, Number((jobOrder as any)?.quantity) || 0);
    const currentProducedQty = Math.max(
      0,
      Number((jobOrder as any)?.completed_quantity) || 0,
    );
    const requestedProducedQty = Number(producedQuantity);
    const hasProducedQtyInput =
      Number.isFinite(requestedProducedQty) && requestedProducedQty > 0;
    const finalProducedQty = hasProducedQtyInput
      ? Math.max(
          currentProducedQty,
          Math.min(plannedQty || requestedProducedQty, requestedProducedQty),
        )
      : currentProducedQty;

    if (
      hasProducedQtyInput &&
      plannedQty > 0 &&
      requestedProducedQty - plannedQty > 1e-9
    ) {
      throw new BadRequestException(
        `Produced quantity cannot exceed planned quantity (${plannedQty})`,
      );
    }

    // Update job order status to STOPPED
    const updates: any = {
      status: "STOPPED",
      actual_end_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (finalProducedQty > currentProducedQty) {
      updates.completed_quantity = finalProducedQty;
    }

    // Add stop reason to notes if provided
    if (reason?.trim() || finalProducedQty > currentProducedQty) {
      const { data: current } = await this.supabase
        .from("production_job_orders")
        .select("notes")
        .eq("id", id)
        .single();
      const currentNotes = String(current?.notes || "");
      const pieces = [
        reason?.trim() ? `Reason: ${reason.trim()}` : null,
        finalProducedQty > currentProducedQty
          ? `Produced before stop: ${finalProducedQty}`
          : null,
      ].filter(Boolean);
      const stopNote = `[STOPPED by ${userId || "system"} at ${new Date().toISOString()}] ${pieces.join(" | ") || "No reason provided"}`;
      updates.notes = currentNotes ? `${currentNotes}\n${stopNote}` : stopNote;
    }

    const { error } = await this.supabase
      .from("production_job_orders")
      .update(updates)
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) throw new BadRequestException(error.message);

    this.logger.log(
      `Job Order ${jobOrder.job_order_number} stopped by ${userId || "system"}. Reason: ${reason || "N/A"}`,
    );

    return {
      id,
      jobOrderNumber: jobOrder.job_order_number,
      status: "STOPPED",
      producedQuantity: finalProducedQty,
      srvPending: finalProducedQty > 0,
      message:
        finalProducedQty > 0
          ? "Job order stopped successfully. Produced quantity is available for SRV receipt."
          : "Job order stopped successfully",
    };
  }

  async updateOperation(
    tenantId: string,
    jobOrderId: string,
    operationId: string,
    dto: UpdateOperationDto,
  ) {
    // Verify job order belongs to tenant
    const { data: jobOrder } = await this.supabase
      .from("production_job_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (!jobOrder) throw new NotFoundException("Job order not found");

    const { error } = await this.supabase
      .from("job_order_operations")
      .update(dto)
      .eq("id", operationId)
      .eq("job_order_id", jobOrderId);

    if (error) throw new BadRequestException(error.message);

    return this.findOne(tenantId, jobOrderId);
  }

  async delete(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from("production_job_orders")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) throw new BadRequestException(error.message);

    return { message: "Job order deleted successfully" };
  }

  async createFromBOM(
    tenantId: string,
    userId: string,
    itemId: string,
    bomId: string,
    quantity: number,
    startDate: string,
    options?: { autoIssueMaterials?: boolean; autoRepair?: boolean },
  ) {
    if (options?.autoIssueMaterials || options?.autoRepair) {
      throw new BadRequestException(
        "Automatic material issue is disabled. Issue Job Order materials through Inventory > SIV.",
      );
    }

    // Get BOM details (avoid PostgREST ambiguous embed between bom_headers and bom_items)
    const bom = await this.getBomWithItemsAndRoutingForJobOrder(
      tenantId,
      bomId,
    );
    if (!bom) throw new NotFoundException("BOM not found");

    // Create operations from routing
    const executableRoutes = requireExecutableRouting(bom.bom_routing);
    const operations = executableRoutes.map((route: any, idx: number) => ({
      routingId: route.id,
      sequenceNumber: route.operation_sequence || (idx + 1) * 10,
      operationName: route.operation_name,
      workstationId: route.workstation_id,
      expectedDurationHours: route.cycle_time || 0,
      setupTimeHours: route.setup_time || 0,
      acceptedVariationPercent: 5, // default 5%
    }));

    // Create materials from BOM items.
    // IMPORTANT: bom_items can represent either:
    // - direct ITEM component via item_id
    // - sub-BOM component via child_bom_id (multi-level BOM)
    // For child_bom_id we consume the sub-assembly item (bom_headers.item_id) at this level.
    const bomItems = Array.isArray(bom.bom_items) ? bom.bom_items : [];
    const formulaIds = Array.from(
      new Set(
        bomItems.map((line: any) => line?.quantity_formula_id).filter(Boolean),
      ),
    );
    const [formulaRows, specification] = await Promise.all([
      formulaIds.length
        ? this.supabase
            .from("production_formula_definitions")
            .select("id,expression,rounding_mode,decimal_places")
            .eq("tenant_id", tenantId)
            .eq("lifecycle_status", "APPROVED")
            .in("id", formulaIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      this.supabase
        .from("production_item_specifications")
        .select("specification_values")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .eq("lifecycle_status", "APPROVED")
        .maybeSingle(),
    ]);
    if (formulaRows.error || specification.error)
      throw new BadRequestException(
        (formulaRows.error || specification.error)?.message,
      );
    const formulaMap = new Map<string, any>(
      (formulaRows.data || []).map((row: any) => [String(row.id), row]),
    );
    const lineRequirement = (line: any) => {
      const formula = line?.quantity_formula_id
        ? formulaMap.get(String(line.quantity_formula_id))
        : null;
      const base = !formula
        ? scaleBomLineQuantity(
            line,
            Number(quantity),
            Number(bom.output_quantity || 1),
          )
        : roundProductionFormula(
            evaluateProductionFormula(formula.expression, {
              ...(specification.data?.specification_values || {}),
              quantity: Number(quantity),
              finished_quantity: Number(quantity),
            }),
            formula.rounding_mode,
            formula.decimal_places,
          );
      return base * (1 + Number(line?.scrap_percentage || 0) / 100);
    };

    const childBomIds = Array.from(
      new Set(
        bomItems
          .map((bi: any) => bi?.child_bom_id || bi?.childBomId)
          .filter(Boolean)
          .map((v: any) => String(v)),
      ),
    );

    const childBomIdToItemId = new Map<string, string>();
    if (childBomIds.length > 0) {
      const { data: childBoms, error: childBomsError } = await this.supabase
        .from("bom_headers")
        .select("id, item_id")
        .in("id", childBomIds);
      if (childBomsError) throw new BadRequestException(childBomsError.message);
      for (const cb of childBoms || []) {
        if (cb?.id && cb?.item_id)
          childBomIdToItemId.set(String(cb.id), String(cb.item_id));
      }
    }

    // Deduplicate by itemId to avoid repeated rows
    const requiredByItemId = new Map<string, any>();
    for (const bi of bomItems) {
      const lineQty = Number(bi?.quantity) || 0;
      if (lineQty <= 0 && !bi?.quantity_formula_id) continue;

      const requiredQuantity = lineRequirement(bi);
      const directItemId = bi?.item_id || bi?.itemId;
      const childBomId = bi?.child_bom_id || bi?.childBomId;

      let materialItemId: string | null = null;
      if (directItemId) {
        materialItemId = String(directItemId);
      } else if (childBomId) {
        materialItemId = childBomIdToItemId.get(String(childBomId)) || null;
        if (!materialItemId) {
          console.warn(
            "[JobOrderService] BOM item references child_bom_id but child BOM has no item_id:",
            {
              bomId,
              bomItemId: bi?.id,
              childBomId,
            },
          );
        }
      } else {
        console.warn(
          "[JobOrderService] Skipping BOM item with neither item_id nor child_bom_id:",
          {
            bomId,
            bomItemId: bi?.id,
          },
        );
      }

      if (!materialItemId) continue;
      const routeOperationId = bi?.route_operation_id || null;
      const issueMethod = bi?.issue_method || "MANUAL";
      const inputWarehouseId = bi?.input_warehouse_id || null;
      const key = `${materialItemId}|${routeOperationId || ""}|${issueMethod}|${inputWarehouseId || ""}`;
      const prior = requiredByItemId.get(key);
      requiredByItemId.set(key, {
        itemId: materialItemId,
        requiredQuantity: (prior?.requiredQuantity || 0) + requiredQuantity,
        routeOperationId,
        issueMethod,
        inputWarehouseId,
        warehouseId: inputWarehouseId,
      });
    }

    const materials = Array.from(requiredByItemId.values());

    const created = await this.create(tenantId, userId, {
      itemId,
      bomId,
      quantity,
      startDate,
      operations,
      materials,
    });

    if (options?.autoIssueMaterials !== true) {
      return created;
    }

    const issueMaterialsSummary = await this.issueMaterialsForJobOrder(
      tenantId,
      created.id,
      {
        userId,
        autoRepair: options?.autoRepair,
      },
    );

    return {
      ...created,
      issueMaterialsSummary,
    };
  }

  private async createFromBOMWithVariantSelections(
    tenantId: string,
    userId: string,
    args: {
      itemId: string;
      bomId: string;
      quantity: number;
      startDate: string;
      priority?: string;
      notes?: string;
      salesOrderId?: string;
      salesOrderItemId?: string;
      variantSelections?: Record<string, string>;
      itemSelections?: Record<string, string>;
      deferShortagePr?: boolean;
    },
  ) {
    const bom = await this.getBomWithItemsAndRoutingForJobOrder(
      tenantId,
      args.bomId,
    );
    if (!bom) {
      console.error("[JobOrderService] BOM not found - bomId:", args.bomId);
      throw new NotFoundException(`BOM not found for ID: ${args.bomId}`);
    }

    // For multi-level BOMs, bom_items can reference child_bom_id instead of item_id.
    // Resolve those child BOMs to their item_id so job_order_materials never gets null itemIds.
    const childBomIds = Array.from(
      new Set(
        (bom.bom_items || [])
          .map((bi: any) => bi?.child_bom_id || bi?.childBomId)
          .filter(Boolean)
          .map((id: any) => String(id)),
      ),
    );

    const childBomIdToItemId = new Map<string, string>();
    if (childBomIds.length > 0) {
      const { data: childBoms, error: childBomsErr } = await this.supabase
        .from("bom_headers")
        .select("id, item_id")
        .eq("tenant_id", tenantId)
        .in("id", childBomIds);

      if (childBomsErr) throw new BadRequestException(childBomsErr.message);
      (childBoms || []).forEach((cb: any) => {
        if (cb?.id && cb?.item_id)
          childBomIdToItemId.set(String(cb.id), String(cb.item_id));
      });
    }

    const variantBomItems = Array.isArray(bom.bom_items) ? bom.bom_items : [];
    const variantFormulaIds = Array.from(
      new Set(
        variantBomItems
          .map((line: any) => line?.quantity_formula_id)
          .filter(Boolean),
      ),
    );
    const [variantFormulaRows, variantSpecification] = await Promise.all([
      variantFormulaIds.length
        ? this.supabase
            .from("production_formula_definitions")
            .select("id,expression,rounding_mode,decimal_places")
            .eq("tenant_id", tenantId)
            .eq("lifecycle_status", "APPROVED")
            .in("id", variantFormulaIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      this.supabase
        .from("production_item_specifications")
        .select("specification_values")
        .eq("tenant_id", tenantId)
        .eq("item_id", args.itemId)
        .eq("lifecycle_status", "APPROVED")
        .maybeSingle(),
    ]);
    if (variantFormulaRows.error || variantSpecification.error)
      throw new BadRequestException(
        (variantFormulaRows.error || variantSpecification.error)?.message,
      );
    const variantFormulaMap = new Map<string, any>(
      (variantFormulaRows.data || []).map((row: any) => [String(row.id), row]),
    );
    const variantLineRequirement = (line: any) => {
      const formula = line?.quantity_formula_id
        ? variantFormulaMap.get(String(line.quantity_formula_id))
        : null;
      const base = !formula
        ? scaleBomLineQuantity(
            line,
            args.quantity,
            Number(bom.output_quantity || 1),
          )
        : roundProductionFormula(
            evaluateProductionFormula(formula.expression, {
              ...(variantSpecification.data?.specification_values || {}),
              quantity: Number(args.quantity),
              finished_quantity: Number(args.quantity),
            }),
            formula.rounding_mode,
            formula.decimal_places,
          );
      return base * (1 + Number(line?.scrap_percentage || 0) / 100);
    };

    const executableRoutes = requireExecutableRouting(bom.bom_routing);
    const operations = executableRoutes.map((route: any, idx: number) => ({
      routingId: route.id,
      sequenceNumber: route.operation_sequence || (idx + 1) * 10,
      operationName: route.operation_name,
      workstationId: route.workstation_id,
      expectedDurationHours: route.cycle_time || 0,
      setupTimeHours: route.setup_time || 0,
      acceptedVariationPercent: 5,
    }));

    const materials = (bom.bom_items || [])
      .map((item: any) => {
        const directItemId = item?.item_id || item?.itemId || null;
        const childBomId = item?.child_bom_id || item?.childBomId || null;

        const baseItemId = directItemId
          ? String(directItemId)
          : childBomId
            ? childBomIdToItemId.get(String(childBomId)) || null
            : null;

        if (!baseItemId) {
          console.warn(
            "[JobOrderService] Skipping BOM item with neither item_id nor resolvable child_bom_id:",
            {
              bomId: args.bomId,
              bomItemId: item?.id,
              directItemId,
              childBomId,
            },
          );
          return null;
        }

        const selectionKey = `${args.bomId}:${baseItemId}`;

        const selectedItemIdRaw = args.itemSelections?.[selectionKey];
        const selectedItemId = String(selectedItemIdRaw || "").trim();
        const effectiveItemId = selectedItemId ? selectedItemId : baseItemId;

        const selectedVariantIdRaw = args.variantSelections?.[selectionKey];
        const selectedVariantId = String(selectedVariantIdRaw || "").trim();
        const shouldApplyVariant = effectiveItemId === baseItemId;

        return {
          itemId: effectiveItemId,
          requiredQuantity: variantLineRequirement(item),
          selectedVariantId:
            shouldApplyVariant &&
            selectedVariantId &&
            selectedVariantId !== baseItemId
              ? selectedVariantId
              : undefined,
          routeOperationId: item?.route_operation_id || null,
          issueMethod: item?.issue_method || "MANUAL",
          inputWarehouseId: item?.input_warehouse_id || null,
          warehouseId: item?.input_warehouse_id || undefined,
          supplyPolicy: item?.supply_policy || "AUTO",
          sourceBomItemId: item?.id || undefined,
        };
      })
      .filter(Boolean);

    return this.create(tenantId, userId, {
      itemId: args.itemId,
      bomId: args.bomId,
      quantity: args.quantity,
      startDate: args.startDate,
      salesOrderId: args.salesOrderId,
      salesOrderItemId: args.salesOrderItemId,
      priority: args.priority || "NORMAL",
      notes: args.notes,
      operations,
      materials,
      deferShortagePr: args.deferShortagePr,
    } as any);
  }

  private async checkMaterialAvailability(
    tenantId: string,
    materials: any[],
    jobQuantity: number,
  ) {
    if (process.env.DEBUG_JOB_ORDER === "true") {
      console.log(
        "[JobOrderService] checkMaterialAvailability - tenantId:",
        tenantId,
      );
      console.log(
        "[JobOrderService] checkMaterialAvailability - materials:",
        JSON.stringify(materials, null, 2),
      );
      console.log(
        "[JobOrderService] checkMaterialAvailability - jobQuantity:",
        jobQuantity,
      );
    }

    const normalizedMaterials = await this.normalizeMaterialIds(
      tenantId,
      materials || [],
    );

    const shortages = [];

    for (const material of normalizedMaterials) {
      const required = material.requiredQuantity; // Don't multiply by jobQuantity - it's already included in requiredQuantity

      const itemIdToCheck =
        material.selectedVariantId ||
        material.selected_variant_id ||
        material.itemId;
      if (!this.isUuid(String(itemIdToCheck || ""))) {
        throw new BadRequestException(
          `Invalid material itemId: ${String(itemIdToCheck)}`,
        );
      }
      if (process.env.DEBUG_JOB_ORDER === "true") {
        console.log(
          "[JobOrderService] Checking material - itemIdToCheck:",
          itemIdToCheck,
          "required:",
          required,
        );
      }

      // IMPORTANT: Use stock_entries-backed summary (same as GET /items/:id/stock)
      // so Job Order validation matches the stock shown across the app.
      const { data, error } = await this.supabase.rpc(
        "get_item_stock_summary",
        {
          p_item_id: itemIdToCheck,
          p_tenant_id: tenantId,
        },
      );

      if (process.env.DEBUG_JOB_ORDER === "true") {
        console.log("[JobOrderService] Stock check for item:", itemIdToCheck);
        console.log("[JobOrderService] Stock summary found:", data);
        console.log("[JobOrderService] Stock summary query error:", error);
      }

      const summary = Array.isArray(data) && data.length > 0 ? data[0] : null;
      const available = Number(summary?.available_quantity) || 0;

      if (process.env.DEBUG_JOB_ORDER === "true") {
        console.log(
          "[JobOrderService] Required:",
          required,
          "Available:",
          available,
        );
      }

      // Check material availability
      if (available < required) {
        // Fetch item details
        const { data: item, error: itemError } = await this.supabase
          .from("items")
          .select("id, code, name")
          .eq("id", itemIdToCheck)
          .single();

        if (itemError) {
          console.error(
            "[JobOrderService] Error fetching item details for",
            itemIdToCheck,
            ":",
            itemError,
          );
        }

        if (process.env.DEBUG_JOB_ORDER === "true") {
          console.log(
            "[JobOrderService] Item lookup for",
            itemIdToCheck,
            "- found:",
            item,
            "error:",
            itemError,
          );
        }

        // If item doesn't exist, try to get item code/name from other sources
        const itemCode = item?.code || "Unknown";
        const itemName = item?.name || "Unknown";

        if (!item && itemIdToCheck) {
          console.warn(
            "[JobOrderService] Item not found in items table for ID:",
            itemIdToCheck,
          );
        }

        shortages.push({
          itemId: itemIdToCheck,
          itemCode: itemCode,
          itemName: itemName,
          required,
          available,
          shortage: required - available,
          supplyPolicy: String(material.supplyPolicy || "AUTO").toUpperCase(),
          sourceBomItemId: material.sourceBomItemId || null,
        });
      }
    }

    if (process.env.DEBUG_JOB_ORDER === "true") {
      console.log(
        "[JobOrderService] Final shortages:",
        JSON.stringify(shortages, null, 2),
      );
    }
    return {
      available: shortages.length === 0,
      shortages,
    };
  }

  async completeJobOrder(
    tenantId: string,
    jobOrderId: string,
    userId?: string,
    options?: {
      allowPartialConsumption?: boolean;
      autoBuildMissingSubAssemblies?: boolean;
    },
  ) {
    // Get job order header first (avoid masking embed/join errors as NotFound)
    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const { data: materialsRaw, error: materialsError } = await this.supabase
      .from("job_order_materials")
      .select("*")
      .eq("job_order_id", jobOrderId);

    if (materialsError) throw new BadRequestException(materialsError.message);
    jobOrder.job_order_materials = Array.isArray(materialsRaw)
      ? materialsRaw
      : [];

    if (jobOrder.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        "Job order must be IN_PROGRESS to complete",
      );
    }

    const allowPartial = Boolean(options?.allowPartialConsumption);
    // Normal completion must block on missing materials. Never manufacture,
    // receive, or QC-release a missing subassembly inside JO completion.
    const autoBuildMissingSubAssemblies = false;

    if (process.env.DEBUG_JOB_ORDER === "true") {
      console.log("[completeJobOrder] Starting completion", {
        jobOrderId,
        jobOrderNumber: jobOrder.job_order_number,
        status: jobOrder.status,
        materialsCount: (jobOrder.job_order_materials || []).length,
        allowPartial,
        autoBuildMissingSubAssemblies,
      });
    }

    // Normalize legacy/buggy material rows (some historical flows stored bom_header IDs in item_id/selected_variant_id).
    try {
      jobOrder.job_order_materials = await this.normalizeJobOrderMaterialRows(
        tenantId,
        jobOrder.job_order_materials || [],
      );
    } catch (e: any) {
      console.warn(
        "[completeJobOrder] Material normalization failed:",
        e?.message || e,
      );
    }

    const pendingIssueLines = (jobOrder.job_order_materials || []).filter(
      (material: any) =>
        Number(material?.issued_quantity || 0) + 0.0001 <
        Number(material?.required_quantity || 0),
    );
    if (pendingIssueLines.length > 0) {
      const first = pendingIssueLines[0] as any;
      throw new BadRequestException(
        `Material issue is incomplete for ${String(first?.item_code || first?.item_name || "a required line")}. Complete Inventory > SIV before production completion.`,
      );
    }

    if (!userId || !this.isUuid(String(userId))) {
      throw new BadRequestException(
        "An authenticated user is required to post production consumption",
      );
    }
    const { data: backflushEvidence, error: backflushError } =
      await this.supabase.rpc("record_job_order_material_backflush", {
        p_tenant_id: tenantId,
        p_job_order_id: jobOrderId,
        p_posted_by: userId,
      });
    if (backflushError) {
      throw new BadRequestException(
        `Failed to post production consumption: ${backflushError.message}`,
      );
    }

    // Auto-build missing sub-assemblies if the job order is blocked by assembly shortages.
    // This runs BEFORE consumption regardless of partial mode (tries to create what's needed first).
    // Only triggers for items that have an active BOM.
    if (autoBuildMissingSubAssemblies) {
      if (process.env.DEBUG_JOB_ORDER === "true") {
        console.log(
          "[completeJobOrder] Auto-build enabled, checking materials for shortages",
        );
      }
      if (!userId) {
        throw new BadRequestException(
          "userId is required to auto-build missing sub-assemblies",
        );
      }

      const startDate = this.toStartDate(
        String((jobOrder as any)?.start_date || ""),
      );
      const materials = Array.isArray(jobOrder.job_order_materials)
        ? jobOrder.job_order_materials
        : [];
      if (process.env.DEBUG_JOB_ORDER === "true") {
        console.log("[completeJobOrder] Materials to check:", materials.length);
      }

      for (const material of materials) {
        const requiredQty = Number(material.required_quantity) || 0;
        const alreadyIssued = Number(material.issued_quantity) || 0;
        const consumeQty = Math.max(0, requiredQty - alreadyIssued);
        if (consumeQty <= 0) {
          if (process.env.DEBUG_JOB_ORDER === "true") {
            console.log(
              "[completeJobOrder] Skipping material (already issued):",
              material.item_id,
            );
          }
          continue;
        }

        const itemIdToConsume =
          material.selected_variant_id || material.item_id;
        if (!this.isUuid(String(itemIdToConsume || ""))) {
          if (process.env.DEBUG_JOB_ORDER === "true") {
            console.log(
              "[completeJobOrder] Skipping material (invalid UUID):",
              itemIdToConsume,
            );
          }
          continue;
        }

        const available = await this.getAvailableStock(
          tenantId,
          String(itemIdToConsume),
        );
        const shortage = Math.max(0, consumeQty - available);
        if (process.env.DEBUG_JOB_ORDER === "true") {
          console.log("[completeJobOrder] Material check:", {
            itemIdToConsume,
            consumeQty,
            available,
            shortage,
          });
        }
        if (shortage <= 0) continue;

        const bom = await this.getActiveBomForItem(
          tenantId,
          String(itemIdToConsume),
        );
        if (!bom?.id) {
          if (process.env.DEBUG_JOB_ORDER === "true") {
            console.log(
              "[completeJobOrder] No BOM for item (raw material):",
              itemIdToConsume,
            );
          }
          continue; // No BOM => raw material; cannot auto-build.
        }

        // Build the missing sub-assembly quantity, complete it, then QC-approve so stock is created.
        const itemBasic = await this.getItemBasic(String(itemIdToConsume));
        if (process.env.DEBUG_JOB_ORDER === "true") {
          console.log("[completeJobOrder] Auto-building missing sub-assembly", {
            jobOrderId,
            jobOrderNumber: jobOrder.job_order_number,
            itemId: itemIdToConsume,
            itemCode: itemBasic?.code,
            shortage,
            bomId: bom.id,
          });
        }

        const created = await this.createFromBOMWithVariantSelections(
          tenantId,
          userId,
          {
            itemId: String(itemIdToConsume),
            bomId: String(bom.id),
            quantity: shortage,
            startDate,
            priority: "NORMAL",
            notes: `Auto-created during completion of ${jobOrder.job_order_number} (missing sub-assembly)`,
          } as any,
        );

        await this.supabase
          .from("production_job_orders")
          .update({
            status: "IN_PROGRESS",
            actual_start_date: new Date().toISOString(),
          })
          .eq("id", created.id);

        await this.completeJobOrder(tenantId, created.id, userId, {
          allowPartialConsumption: false,
          autoBuildMissingSubAssemblies: true,
        } as any);

        // New workflow: SRV receive (SYSTEM) with quantity, then QC completes and generates UIDs.
        await this.receiveStoreReceiptVoucher(tenantId, created.id, userId, {
          receiverName: "SYSTEM",
          receivedQuantity: shortage,
        });
        await this.approveQC(
          tenantId,
          created.id,
          {
            acceptedQuantity: shortage,
            rejectedQuantity: 0,
          },
          userId,
        );
      }

      // Re-load materials after auto-build (issued quantities / ids may have changed)
      const { data: refreshed, error: refreshedError } = await this.supabase
        .from("production_job_orders")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", jobOrderId)
        .single();

      if (refreshedError) throw new BadRequestException(refreshedError.message);
      if (refreshed) {
        const { data: refreshedMaterials, error: refreshedMaterialsError } =
          await this.supabase
            .from("job_order_materials")
            .select("*")
            .eq("job_order_id", jobOrderId);

        if (refreshedMaterialsError)
          throw new BadRequestException(refreshedMaterialsError.message);
        jobOrder.job_order_materials = Array.isArray(refreshedMaterials)
          ? refreshedMaterials
          : [];
      }
    }

    // Start transaction-like operations
    try {
      // 1. Consume materials from inventory (stock_entries)
      for (const material of jobOrder.job_order_materials) {
        const requiredQty = Number(material.required_quantity) || 0;
        const alreadyIssued = Number(material.issued_quantity) || 0;
        const consumeQty = Math.max(0, requiredQty - alreadyIssued);
        if (consumeQty <= 0) {
          // Nothing left to consume for this material.
          continue;
        }

        // Use selected_variant_id if available, otherwise use item_id
        const itemIdToConsume =
          material.selected_variant_id || material.item_id;
        if (!this.isUuid(String(itemIdToConsume || ""))) {
          if (allowPartial) {
            console.warn(
              "[completeJobOrder] Skipping material with invalid item id (partial consumption mode)",
            );
            continue;
          }
          throw new BadRequestException(
            "Failed to consume material: invalid item id",
          );
        }

        // Get item details
        const { data: item } = await this.supabase
          .from("items")
          .select("code, name, category")
          .eq("id", itemIdToConsume)
          .single();

        // If manual inventory adjustments were done (inventory_stock updated) but stock_entries
        // wasn't, completion would incorrectly fail with "Item not found" or shortages.
        await this.ensureStockEntriesAtLeastInventoryAvailable(
          tenantId,
          String(itemIdToConsume),
        );

        // Get available stock entries for this material (use variant if selected)
        const { data: stockEntries } = await this.supabase
          .from("stock_entries")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("item_id", itemIdToConsume)
          .gt("available_quantity", 0)
          .order("created_at", { ascending: true });

        if (!stockEntries || stockEntries.length === 0) {
          if (allowPartial) {
            console.warn(
              `[completeJobOrder] Skipping material ${item?.code}: not found in inventory (partial consumption mode)`,
            );
            continue;
          }
          throw new BadRequestException(
            `Failed to consume ${item?.code}: Item not found in inventory`,
          );
        }

        // Calculate total available
        const totalAvailable = stockEntries.reduce(
          (sum, entry) => sum + parseFloat(entry.available_quantity.toString()),
          0,
        );

        if (totalAvailable < consumeQty) {
          if (allowPartial) {
            console.warn(
              `[completeJobOrder] Partial consumption for ${item?.code}: need ${consumeQty}, have ${totalAvailable}`,
            );
            // Will consume what's available below
          } else {
            throw new BadRequestException(
              `Failed to consume ${item?.code}: Insufficient stock. Need ${consumeQty}, have ${totalAvailable}`,
            );
          }
        }

        // Consume from stock entries using FIFO
        let remainingToConsume = consumeQty;
        for (const entry of stockEntries) {
          if (remainingToConsume <= 0) break;

          const entryAvailable = parseFloat(
            entry.available_quantity.toString(),
          );
          const toConsumeFromEntry = Math.min(
            entryAvailable,
            remainingToConsume,
          );
          const newAvailable = entryAvailable - toConsumeFromEntry;

          const { error: updateError } = await this.supabase
            .from("stock_entries")
            .update({
              available_quantity: newAvailable,
              updated_at: new Date().toISOString(),
            })
            .eq("id", entry.id);

          if (updateError) {
            console.error("Error updating stock entry:", updateError);
            throw new BadRequestException(
              `Failed to consume ${item?.code}: ${updateError.message}`,
            );
          }

          // Keep inventory_stock consistent with stock_entries.
          const warehouseId = String((entry as any)?.warehouse_id || "").trim();
          if (warehouseId && this.isUuid(warehouseId)) {
            const { error: invError } = await this.supabase.rpc(
              "adjust_inventory_stock",
              {
                p_tenant_id: tenantId,
                p_item_id: itemIdToConsume,
                p_warehouse_id: warehouseId,
                p_location_id: null,
                p_quantity_change: -toConsumeFromEntry,
                p_category: normalizeInventoryCategory(
                  (item as any)?.category,
                  "RAW_MATERIAL",
                ),
              },
            );

            if (invError) {
              console.error(
                "Error syncing inventory_stock after consumption:",
                invError,
              );
              throw new BadRequestException(
                `Failed to sync inventory stock: ${invError.message}`,
              );
            }
          }

          remainingToConsume -= toConsumeFromEntry;
        }

        const actuallyConsumed = Math.max(0, consumeQty - remainingToConsume);
        if (actuallyConsumed <= 0) {
          if (allowPartial) {
            continue;
          }
          throw new BadRequestException(
            `Failed to consume ${item?.code}: Unable to consume from stock`,
          );
        }

        // Update material issued quantity (accurate for partial consumption)
        const nextIssued = alreadyIssued + actuallyConsumed;
        const nextStatus = nextIssued >= requiredQty ? "ISSUED" : "PARTIAL";
        await this.supabase
          .from("job_order_materials")
          .update({
            issued_quantity: nextIssued,
            status: nextStatus,
          })
          .eq("id", material.id);
      }

      // 2. Update job order status
      // New workflow:
      // - Completion = production finished + handed over to Stores
      // - SRV receipt is done by Stores (GRN-like popup)
      // - UIDs + stock release happen only after QC completion
      const { error: updateError } = await this.supabase
        .from("production_job_orders")
        .update({
          status: "STORE_ISSUED",
          actual_end_date: new Date().toISOString(),
          completed_quantity: jobOrder.quantity,
        })
        .eq("id", jobOrderId);

      if (updateError) throw new BadRequestException(updateError.message);

      return {
        ...(await this.findOne(tenantId, jobOrderId)),
        consumptionEvidence: backflushEvidence,
      };
    } catch (error) {
      console.error("Error completing job order:", error);
      throw error;
    }
  }

  async approveQC(
    tenantId: string,
    jobOrderId: string,
    payload: {
      // Legacy UID-based flow
      approvedUids?: string[];
      rejectedUids?: string[];
      // New quantity-based flow (UIDs generated only after QC completion)
      acceptedQuantity?: number;
      rejectedQuantity?: number;
      metadata?: any;
      checkedBy?: Record<string, string>;
    },
    userId?: string,
  ) {
    const approvedUids = Array.isArray(payload?.approvedUids)
      ? payload.approvedUids.map((u) => String(u || "").trim()).filter(Boolean)
      : [];
    const rejectedUids = Array.isArray(payload?.rejectedUids)
      ? payload.rejectedUids.map((u) => String(u || "").trim()).filter(Boolean)
      : [];
    const useUidListFlow = approvedUids.length + rejectedUids.length > 0;

    // Validate job order exists
    const { data: jobOrder } = await this.supabase
      .from("production_job_orders")
      .select(
        "*, finished_item:items!production_job_orders_item_id_fkey(id, code, name, category, uid_tracking, uid_strategy, standard_cost)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (!jobOrder) throw new NotFoundException("Job order not found");
    const joStatus = String((jobOrder as any)?.status || "").toUpperCase();
    // QC for SRV receipts can happen even when production is still IN_PROGRESS (partial completion).
    // We primarily gate QC by SRV receipt existence below.
    if (
      joStatus !== "IN_PROGRESS" &&
      joStatus !== "STORE_ISSUED" &&
      joStatus !== "COMPLETED"
    ) {
      throw new BadRequestException(
        "Job order must be IN_PROGRESS / STORE_ISSUED / COMPLETED before QC",
      );
    }

    const approver = String(userId || "").trim();
    if (!approver || !this.isUuid(approver)) {
      throw new BadRequestException("Valid userId is required to approve QC");
    }

    // SRV receipt is required before QC. Auto-create if missing (handles cases where
    // receive step was skipped or the receipt entry was accidentally wiped).
    const { data: existingReceipts, error: receiptError } = await this.supabase
      .from("stock_entries")
      .select(
        "id, quantity, available_quantity, warehouse_id, metadata, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("metadata->>created_from", "STORE_RECEIPT")
      .eq("metadata->>job_order_id", jobOrderId)
      .order("created_at", { ascending: true });
    if (receiptError) throw new BadRequestException(receiptError.message);
    let receiptEntries = Array.isArray(existingReceipts)
      ? existingReceipts
      : [];

    // Auto-receive if no SRV receipt exists yet
    if (receiptEntries.length === 0) {
      const acceptedQtyForAutoRecv =
        Number(payload?.acceptedQuantity) +
        Number(payload?.rejectedQuantity || 0);
      if (
        Number.isFinite(acceptedQtyForAutoRecv) &&
        acceptedQtyForAutoRecv > 0
      ) {
        try {
          await this.receiveStoreReceiptVoucher(
            tenantId,
            jobOrderId,
            approver,
            { receiverName: "AUTO", receivedQuantity: acceptedQtyForAutoRecv },
          );
        } catch (autoErr: any) {
          console.warn("[QC] Auto-receive failed:", autoErr?.message);
        }
        const { data: refetched } = await this.supabase
          .from("stock_entries")
          .select(
            "id, quantity, available_quantity, warehouse_id, metadata, created_at",
          )
          .eq("tenant_id", tenantId)
          .eq("metadata->>created_from", "STORE_RECEIPT")
          .eq("metadata->>job_order_id", jobOrderId)
          .order("created_at", { ascending: true });
        receiptEntries = Array.isArray(refetched) ? refetched : [];
      }
    }

    if (receiptEntries.length === 0) {
      throw new BadRequestException(
        "SRV pending: please complete SRV (Store Receipt Voucher) before QC.",
      );
    }

    let totalReceivedQty = receiptEntries.reduce(
      (sum: number, e: any) => sum + (Number(e?.quantity || 0) || 0),
      0,
    );
    // Fallback: if all receipt entries were zeroed (e.g. by a migration), use payload total
    if (totalReceivedQty <= 0) {
      const payloadTotal =
        Number(payload?.acceptedQuantity || 0) +
        Number(payload?.rejectedQuantity || 0);
      if (payloadTotal > 0) {
        totalReceivedQty = payloadTotal;
      } else {
        throw new BadRequestException(
          "SRV has zero received quantity; cannot QC",
        );
      }
    }

    // New flow: quantity-based QC
    if (!useUidListFlow) {
      const acceptedQuantity = Number(payload?.acceptedQuantity);
      const rejectedQuantity = Number(payload?.rejectedQuantity || 0);
      if (!Number.isFinite(acceptedQuantity) || acceptedQuantity <= 0) {
        throw new BadRequestException("acceptedQuantity must be > 0");
      }
      if (!Number.isFinite(rejectedQuantity) || rejectedQuantity < 0) {
        throw new BadRequestException("rejectedQuantity must be >= 0");
      }
      if (acceptedQuantity + rejectedQuantity - totalReceivedQty > 1e-9) {
        throw new BadRequestException(
          `QC quantity exceeds SRV received quantity. Received=${totalReceivedQty}, accepted=${acceptedQuantity}, rejected=${rejectedQuantity}`,
        );
      }

      // Generate UIDs ONLY NOW (after QC completion) for accepted quantity.
      // Supabase relations can return array or object depending on FK resolution - normalize.
      const rawFinishedItem = (jobOrder as any)?.finished_item;
      let finishedItem = Array.isArray(rawFinishedItem)
        ? rawFinishedItem[0]
        : rawFinishedItem;
      // Fallback: fetch item directly if join failed to populate it
      if (!finishedItem?.id) {
        const itemId = String((jobOrder as any)?.item_id || "").trim();
        if (itemId) {
          const { data: fetchedItem } = await this.supabase
            .from("items")
            .select(
              "id, code, name, category, uid_tracking, uid_strategy, standard_cost",
            )
            .eq("id", itemId)
            .single();
          if (fetchedItem) finishedItem = fetchedItem;
        }
      }
      const createdUids = await this.generateJobOrderUids(
        tenantId,
        approver,
        jobOrder,
        finishedItem,
        acceptedQuantity,
        "QC_COMPLETE",
      );

      // Mark generated UIDs as PASSED and IN_STOCK immediately (QC already completed here).
      if (createdUids.length > 0) {
        for (const uid of createdUids) {
          await this.supabase
            .from("uid_registry")
            .update({
              quality_status: "PASSED",
              status: "IN_STOCK",
              location: "STORE",
            } as any)
            .eq("tenant_id", tenantId)
            .eq("uid", uid);
        }
      }

      // Release accepted quantity to stock (inventory_stock + stock_entries.available_quantity)
      // Use SRV warehouse (first entry) as destination.
      const warehouseId = String(
        (receiptEntries[0] as any)?.warehouse_id || "",
      ).trim();
      if (!warehouseId || !this.isUuid(warehouseId)) {
        throw new BadRequestException(
          "Invalid SRV warehouse_id; cannot release stock",
        );
      }

      // Update inventory_stock (+acceptedQuantity)
      const itemCategory = (finishedItem as any)?.category;
      const { error: invErr } = await this.supabase.rpc(
        "adjust_inventory_stock",
        {
          p_tenant_id: tenantId,
          p_item_id: (jobOrder as any)?.item_id,
          p_warehouse_id: warehouseId,
          p_location_id: null,
          p_quantity_change: acceptedQuantity,
          p_category: normalizeInventoryCategory(
            itemCategory,
            "FINISHED_GOODS",
          ),
        },
      );
      if (invErr) throw new BadRequestException(invErr.message);

      // Allocate available_quantity across SRV stock_entries in FIFO order.
      let remainingToRelease = acceptedQuantity;
      for (const entry of receiptEntries) {
        if (remainingToRelease <= 0) break;
        const entryQty = Number((entry as any)?.quantity || 0) || 0;
        const previousAvail =
          Number((entry as any)?.available_quantity || 0) || 0;
        const newAvail = Math.min(entryQty, remainingToRelease);
        const releasedNow = Math.max(0, newAvail - previousAvail);
        const meta = (entry as any)?.metadata || {};
        const nextMeta = {
          ...meta,
          qc_completed_at: new Date().toISOString(),
          qc_completed_by: approver,
          qc_accepted_quantity: acceptedQuantity,
          qc_rejected_quantity: rejectedQuantity,
          approved_uids: createdUids,
          srv_approved_by: approver,
          srv_approved_at: new Date().toISOString(),
        };
        await this.supabase
          .from("stock_entries")
          .update({
            available_quantity: newAvail,
            metadata: nextMeta,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("tenant_id", tenantId)
          .eq("id", (entry as any)?.id);

        // Preserve the finished-goods value released by QC as operational
        // valuation evidence. Finance still controls journal creation/posting.
        if (releasedNow > 0) {
          const unitCost = Number((finishedItem as any)?.standard_cost || 0);
          const jobNumber = String(
            (jobOrder as any)?.job_order_number || "",
          ).trim();
          const { error: costEventError } = await this.supabase
            .from("inventory_cost_events")
            .upsert(
              {
                tenant_id: tenantId,
                event_type: "PRODUCTION_RECEIPT",
                item_id: (jobOrder as any)?.item_id,
                stock_entry_id: (entry as any)?.id,
                quantity: releasedNow,
                unit_cost: unitCost,
                total_cost: Number((releasedNow * unitCost).toFixed(4)),
                reference_type: "JOB_ORDER_QC",
                reference_number: `${jobNumber}:QC:${String((entry as any)?.id || "")}:${newAvail}`,
                metadata: {
                  valuation_method: "STANDARD",
                  job_order_id: jobOrderId,
                  job_order_number: jobNumber,
                  warehouse_id: warehouseId,
                  qc_completed_by: approver,
                },
              },
              {
                onConflict:
                  "tenant_id,event_type,stock_entry_id,reference_number",
                ignoreDuplicates: true,
              },
            );
          if (costEventError) {
            this.logger.error(
              `[QC] Production receipt cost evidence failed for ${jobNumber}: ${costEventError.message}`,
            );
          }
        }
        remainingToRelease -= newAvail;
      }

      // Do NOT change job order status here.
      // - Production completion already sets status to STORE_ISSUED.
      // - Partial production stays IN_PROGRESS.
      // QC just releases stock + generates UIDs (if applicable).

      return {
        jobOrderId,
        jobOrderNumber: (jobOrder as any)?.job_order_number,
        itemCode: (finishedItem as any)?.code,
        itemName: (finishedItem as any)?.name,
        stockAdded: acceptedQuantity,
        stockAvailable: acceptedQuantity,
        generatedUids: createdUids,
        message: `QC complete: accepted ${acceptedQuantity}, rejected ${rejectedQuantity}. Stock released.`,
      };
    }

    // Legacy flow: UID list based QC (kept for backward compatibility)

    // Get all UIDs for this job order
    const { data: allUids, error: allUidsError } = await this.supabase
      .from("uid_registry")
      .select("uid, lifecycle, metadata")
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId);

    if (allUidsError) throw new BadRequestException(allUidsError.message);
    if (!allUids || allUids.length === 0)
      throw new BadRequestException("No UIDs found for this job order");

    const totalUids = allUids.length;
    const providedCount = approvedUids.length + rejectedUids.length;

    if (providedCount !== totalUids) {
      throw new BadRequestException(
        `Total UIDs mismatch. Job order has ${totalUids} UIDs, but ${providedCount} were provided for QC`,
      );
    }

    try {
      const receiptEntry = receiptEntries[receiptEntries.length - 1];

      const receivedUids = Array.isArray(
        (receiptEntry as any)?.metadata?.received_uids,
      )
        ? ((receiptEntry as any).metadata.received_uids as any[])
            .map((u) => String(u || "").trim())
            .filter(Boolean)
        : [];

      // Enforce full receipt for the job order before QC.
      if (receivedUids.length !== totalUids) {
        throw new BadRequestException(
          `SRV pending: ${Math.max(0, totalUids - receivedUids.length)} unit(s) not received in SRV yet. Complete SRV first, then QC.`,
        );
      }

      const alreadyApprovedUidSet = new Set<string>();
      const approvedList = (receiptEntry as any)?.metadata?.approved_uids;
      if (Array.isArray(approvedList)) {
        for (const u of approvedList) {
          const s = String(u || "").trim();
          if (s) alreadyApprovedUidSet.add(s);
        }
      }

      const newlyApprovedUids = (approvedUids || []).filter(
        (u) => !alreadyApprovedUidSet.has(String(u || "").trim()),
      );

      // 1. Update approved UIDs
      if (approvedUids.length > 0) {
        for (const uid of approvedUids) {
          const { data: existing } = await this.supabase
            .from("uid_registry")
            .select("lifecycle, metadata")
            .eq("uid", uid)
            .single();

          const currentLifecycle = existing?.lifecycle
            ? JSON.parse(existing.lifecycle)
            : [];
          const currentMetadata = existing?.metadata
            ? JSON.parse(existing.metadata)
            : {};

          await this.supabase
            .from("uid_registry")
            .update({
              status: "QC_APPROVED",
              quality_status: "PASSED",
              location: "Warehouse",
              lifecycle: JSON.stringify([
                ...currentLifecycle,
                {
                  stage: "QC_APPROVED",
                  timestamp: new Date().toISOString(),
                  location: "QC",
                  reference: "Quality Control Passed",
                  user: userId,
                },
              ]),
              metadata: JSON.stringify({
                ...currentMetadata,
                qc_status: "APPROVED",
                qc_approved_at: new Date().toISOString(),
                qc_approved_by: userId,
              }),
            })
            .eq("uid", uid);
        }
      }

      // 2. Update rejected UIDs
      if (rejectedUids.length > 0) {
        for (const uid of rejectedUids) {
          const { data: existing } = await this.supabase
            .from("uid_registry")
            .select("lifecycle, metadata")
            .eq("uid", uid)
            .single();

          const currentLifecycle = existing?.lifecycle
            ? JSON.parse(existing.lifecycle)
            : [];
          const currentMetadata = existing?.metadata
            ? JSON.parse(existing.metadata)
            : {};

          await this.supabase
            .from("uid_registry")
            .update({
              status: "QC_REJECTED",
              quality_status: "FAILED",
              location: "Rework/Scrap",
              lifecycle: JSON.stringify([
                ...currentLifecycle,
                {
                  stage: "QC_REJECTED",
                  timestamp: new Date().toISOString(),
                  location: "QC",
                  reference: "Quality Control Failed",
                  user: userId,
                },
              ]),
              metadata: JSON.stringify({
                ...currentMetadata,
                qc_status: "REJECTED",
                qc_rejected_at: new Date().toISOString(),
                qc_rejected_by: userId,
              }),
            })
            .eq("uid", uid);
        }
      }

      // 3. Release approved quantity to stock from the STORE_RECEIPT entry
      const existingAvailable =
        Number((receiptEntry as any)?.available_quantity) || 0;
      const receiptQty = Number((receiptEntry as any)?.quantity) || 0;
      const deltaToRelease = newlyApprovedUids.length;
      const nextAvailable = Math.min(
        receiptQty,
        existingAvailable + deltaToRelease,
      );

      const mergedApproved = Array.from(
        new Set([
          ...Array.from(alreadyApprovedUidSet),
          ...newlyApprovedUids
            .map((u) => String(u || "").trim())
            .filter(Boolean),
        ]),
      );

      const { error: receiptUpdateErr } = await this.supabase
        .from("stock_entries")
        .update({
          available_quantity: nextAvailable,
          metadata: {
            ...(receiptEntry as any)?.metadata,
            approved_uids: mergedApproved,
            qc_released_at: new Date().toISOString(),
            qc_released_by: userId || null,
          },
        })
        .eq("tenant_id", tenantId)
        .eq("id", (receiptEntry as any)?.id);

      if (receiptUpdateErr)
        throw new BadRequestException(receiptUpdateErr.message);

      // Sync inventory_stock only for newly released (approved) units
      if (deltaToRelease > 0) {
        const warehouseId = String(
          (receiptEntry as any)?.warehouse_id || "",
        ).trim();
        if (!warehouseId || !this.isUuid(warehouseId)) {
          throw new BadRequestException("Warehouse not set on SRV entry");
        }

        const { data: itemRow, error: itemErr } = await this.supabase
          .from("items")
          .select("category")
          .eq("tenant_id", tenantId)
          .eq("id", jobOrder.item_id)
          .single();

        if (itemErr) throw new BadRequestException(itemErr.message);

        const { error: invError } = await this.supabase.rpc(
          "adjust_inventory_stock",
          {
            p_tenant_id: tenantId,
            p_item_id: jobOrder.item_id,
            p_warehouse_id: warehouseId,
            p_location_id: null,
            p_quantity_change: deltaToRelease,
            p_category: normalizeInventoryCategory(
              itemRow?.category,
              "FINISHED_GOODS",
            ),
          },
        );

        if (invError) throw new BadRequestException(invError.message);
      }

      console.log(
        `[QC Approval] Job Order ${jobOrder.job_order_number}: ${approvedUids.length} approved, ${rejectedUids.length} rejected`,
      );
      console.log(
        `[QC Approval] Released ${newlyApprovedUids.length} newly approved unit(s) to stock from SRV receipt`,
      );

      return {
        jobOrderId,
        jobOrderNumber: jobOrder.job_order_number,
        itemId: jobOrder.item_id,
        itemCode: jobOrder.item_code,
        itemName: jobOrder.item_name,
        totalProduced: totalUids,
        qcApproved: approvedUids.length,
        qcRejected: rejectedUids.length,
        stockAdded: newlyApprovedUids.length,
        pendingStoreReceipt: 0,
        newlyApproved: newlyApprovedUids.length,
        message:
          newlyApprovedUids.length > 0
            ? `QC Complete: ${newlyApprovedUids.length} unit(s) released to stock.`
            : `QC already applied: no new units to release.`,
      };
    } catch (error) {
      console.error("Error during QC approval:", error);
      throw error;
    }
  }

  async getOpenMaterialRequisitions(
    tenantId: string,
    options?: { assignedTo?: string },
  ) {
    const assignedTo = String(options?.assignedTo || "").trim();

    let jobOrdersQuery = this.supabase
      .from("production_job_orders")
      .select(
        "id, job_order_number, item_id, item_code, item_name, quantity, status, start_date, created_at, assigned_to, assigned_to_name",
      )
      .eq("tenant_id", tenantId)
      .in("status", [...OPEN_SIV_JOB_ORDER_STATUSES]);

    if (assignedTo) {
      jobOrdersQuery = jobOrdersQuery.eq("assigned_to", assignedTo);
    }

    const { data: jobOrders, error: jobOrderError } = await jobOrdersQuery
      .order("created_at", { ascending: false })
      .limit(200);

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);

    const ids = (jobOrders || []).map((j: any) => String(j.id)).filter(Boolean);
    if (ids.length === 0) return [];

    const { data: materials, error: materialsError } = await this.supabase
      .from("job_order_materials")
      .select(
        "id, job_order_id, item_id, item_code, item_name, required_quantity, issued_quantity, status",
      )
      .in("job_order_id", ids);

    if (materialsError) throw new BadRequestException(materialsError.message);

    const byJob = new Map<string, any[]>();
    for (const row of materials || []) {
      const key = String((row as any)?.job_order_id || "").trim();
      if (!key) continue;
      if (!byJob.has(key)) byJob.set(key, []);
      byJob.get(key)!.push(row);
    }

    // Fetch available stock for all item_ids across all material lines in one query
    const allItemIds = [
      ...new Set(
        (materials || [])
          .map((r: any) => String(r?.item_id || ""))
          .filter(Boolean),
      ),
    ];
    const stockByItem = new Map<string, number>();
    if (allItemIds.length > 0) {
      const { data: stockRows } = await this.supabase
        .from("stock_entries")
        .select("item_id, available_quantity")
        .eq("tenant_id", tenantId)
        .in("item_id", allItemIds)
        .gt("available_quantity", 0);
      for (const row of stockRows || []) {
        const itemId = String((row as any)?.item_id || "").trim();
        const qty = Number((row as any)?.available_quantity || 0);
        stockByItem.set(itemId, (stockByItem.get(itemId) || 0) + qty);
      }

      // Also count UIDs in GENERATED or IN_STOCK status — sub-assembly UIDs exist in
      // uid_registry even if stock_entries was zeroed by a failed/partial transaction.
      // Use MAX(stock_qty, uid_count) so either source of availability wins.
      const { data: uidRows } = await this.supabase
        .from("uid_registry")
        .select("entity_id")
        .eq("tenant_id", tenantId)
        .in("entity_id", allItemIds)
        .in("status", ["GENERATED", "IN_STOCK"]);
      const uidCountByItem = new Map<string, number>();
      for (const row of uidRows || []) {
        const itemId = String((row as any)?.entity_id || "").trim();
        if (itemId)
          uidCountByItem.set(itemId, (uidCountByItem.get(itemId) || 0) + 1);
      }
      for (const [itemId, uidCount] of uidCountByItem) {
        const existing = stockByItem.get(itemId) || 0;
        if (uidCount > existing) stockByItem.set(itemId, uidCount);
      }
    }

    return (jobOrders || [])
      .map((jo: any) => {
        const rows = byJob.get(String(jo.id)) || [];
        const requiredQuantity = rows.reduce(
          (sum, r: any) => sum + (Number(r?.required_quantity) || 0),
          0,
        );
        const issuedQuantity = rows.reduce(
          (sum, r: any) => sum + (Number(r?.issued_quantity) || 0),
          0,
        );
        const pendingLines = rows.filter(
          (r: any) =>
            (Number(r?.issued_quantity) || 0) + 1e-9 <
            (Number(r?.required_quantity) || 0),
        ).length;
        return {
          ...jo,
          requisitionStatus: pendingLines > 0 ? "OPEN" : "ISSUED",
          requiredQuantity,
          issuedQuantity,
          pendingQuantity: Math.max(0, requiredQuantity - issuedQuantity),
          pendingLines,
          materialLines: rows.map((line: any) => {
            const required = Number(line?.required_quantity) || 0;
            const issued = Number(line?.issued_quantity) || 0;
            const itemId = String(line?.item_id || "").trim();
            const availableQty = stockByItem.get(itemId) || 0;
            return {
              ...line,
              pending_quantity: Math.max(0, required - issued),
              available_quantity: availableQty,
            };
          }),
        };
      })
      .filter(
        // Note: do NOT filter by pendingLines here — all active JOs are returned so the
        // SIV client can build correct parent→sub-assembly relationships regardless of
        // whether each sub-JO's materials have already been partially issued.
        // The front-end applies its own display filter (pendingLines > 0 for SIV cards).
        (row) => row.requisitionStatus !== undefined,
      ); // keep all non-COMPLETED/CANCELLED
  }

  async assignMaterialRequisition(
    tenantId: string,
    jobOrderId: string,
    assignedTo: string | null,
  ) {
    const normalizedJobOrderId = String(jobOrderId || "").trim();
    const normalizedAssignedTo = String(assignedTo || "").trim();

    if (!normalizedJobOrderId) {
      throw new BadRequestException("Job order is required for assignment.");
    }

    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("id", normalizedJobOrderId)
      .single();

    if (jobOrderError || !jobOrder) {
      throw new BadRequestException(
        "Material requisition/job order not found.",
      );
    }

    const status = String((jobOrder as any)?.status || "")
      .trim()
      .toUpperCase();
    if (["COMPLETED", "CANCELLED", "STOPPED"].includes(status)) {
      throw new BadRequestException(
        "Cannot assign a completed, cancelled, or stopped job order.",
      );
    }

    let resolvedAssignedTo: string | null = null;
    let assignedToName: string | null = null;
    if (normalizedAssignedTo) {
      const { data: assignedUser, error: userError } = await this.supabase
        .from("users")
        .select("id, email, first_name, last_name")
        .eq("tenant_id", tenantId)
        .eq("id", normalizedAssignedTo)
        .maybeSingle();

      if (!userError && assignedUser) {
        resolvedAssignedTo = String(
          (assignedUser as any).id || normalizedAssignedTo,
        ).trim();
        assignedToName = this.formatUserDisplayName(assignedUser);
      } else {
        const { data: employee, error: employeeError } = await this.supabase
          .from("employees")
          .select("id, user_id, employee_name, email")
          .eq("tenant_id", tenantId)
          .eq("id", normalizedAssignedTo)
          .maybeSingle();

        if (employeeError || !employee) {
          throw new BadRequestException(
            "Selected employee/user was not found for this tenant.",
          );
        }

        const linkedUserId = String((employee as any)?.user_id || "").trim();
        if (linkedUserId) {
          const { data: linkedUser, error: linkedUserError } =
            await this.supabase
              .from("users")
              .select("id, email, first_name, last_name")
              .eq("tenant_id", tenantId)
              .eq("id", linkedUserId)
              .maybeSingle();

          if (!linkedUserError && linkedUser) {
            resolvedAssignedTo = String(
              (linkedUser as any).id || linkedUserId,
            ).trim();
            assignedToName = this.formatUserDisplayName(linkedUser);
          }
        }

        if (!resolvedAssignedTo) {
          resolvedAssignedTo = String(
            (employee as any).id || normalizedAssignedTo,
          ).trim();
          assignedToName =
            String((employee as any)?.employee_name || "").trim() ||
            String((employee as any)?.email || "").trim() ||
            resolvedAssignedTo;
        }
      }
    }

    const { data, error } = await this.supabase
      .from("production_job_orders")
      .update({
        assigned_to: resolvedAssignedTo,
        assigned_to_name: assignedToName,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", normalizedJobOrderId)
      .select("id, job_order_number, assigned_to, assigned_to_name")
      .single();

    if (error) throw new BadRequestException(error.message);

    return {
      id: data?.id,
      job_order_number: data?.job_order_number,
      assigned_to: data?.assigned_to || null,
      assigned_to_name: data?.assigned_to_name || null,
    };
  }

  async issueMaterialRequisition(
    tenantId: string,
    jobOrderId: string,
    userId?: string,
  ) {
    const summary = await this.issueMaterialsForJobOrder(tenantId, jobOrderId, {
      userId,
      autoRepair: false,
    });

    const updated = await this.findOne(tenantId, jobOrderId);
    return {
      jobOrder: updated,
      summary,
    };
  }

  /**
   * Pre-flight check before issuing materials for a job order.
   * Returns any sub-assembly material lines that have insufficient stock
   * (meaning their own sub-JO has not been completed yet).
   */
  async checkIssuanceReadiness(tenantId: string, jobOrderId: string) {
    const resolvedJobOrder = await this.resolveJobOrderIdentity(
      tenantId,
      jobOrderId,
    );

    // Fetch pending material lines (all lines, including already-issued ones)
    // NOTE: job_order_materials has no tenant_id column — filter by job_order_id only
    const { data: materials, error: mErr } = await this.supabase
      .from("job_order_materials")
      .select(
        "id, item_id, item_code, item_name, required_quantity, issued_quantity",
      )
      .eq("job_order_id", resolvedJobOrder.id);

    if (mErr) throw new BadRequestException(mErr.message);

    const blockers: Array<{
      materialId: string;
      itemCode: string;
      itemName: string;
      needed: number;
      available: number;
      pendingSubJoNumber: string | null;
    }> = [];

    for (const mat of materials || []) {
      const itemId = String(mat.item_id || "");
      if (!itemId) continue;

      const issued = Number(mat.issued_quantity || 0);
      const required = Number(mat.required_quantity || 0);
      const stillNeeded = Math.max(0, required - issued);
      if (stillNeeded <= 0) continue; // already fully issued

      // Check if this item is a sub-assembly (has its own BOM)
      const subBom = await this.getActiveBomForItem(tenantId, itemId);
      if (!subBom) continue; // not a sub-assembly — raw material, skip

      // Primary check: is there a PENDING (non-COMPLETED, non-CANCELLED) sub-JO for this item?
      // This is the most reliable indicator — if the sub-JO is still in progress, the
      // sub-assembly is definitely not yet ready, regardless of any stock drift.
      const { data: pendingSubJos } = await this.supabase
        .from("production_job_orders")
        .select("id, job_order_number, status, quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .in("status", [...OPEN_SIV_JOB_ORDER_STATUSES])
        .order("created_at", { ascending: false })
        .limit(5);

      const pendingList = Array.isArray(pendingSubJos) ? pendingSubJos : [];

      // Secondary check: available stock from stock_entries AND uid_registry
      // UIDs in GENERATED/IN_STOCK status count as available stock for sub-assemblies
      const { data: stockRows } = await this.supabase
        .from("stock_entries")
        .select("available_quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .gt("available_quantity", 0);

      const stockAvailable = (Array.isArray(stockRows) ? stockRows : []).reduce(
        (sum: number, r: any) => sum + (Number(r?.available_quantity) || 0),
        0,
      );

      // Also count UIDs — sub-assembly UIDs in uid_registry are the ground truth
      const { count: uidCount } = await this.supabase
        .from("uid_registry")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("entity_id", itemId)
        .in("status", ["GENERATED", "IN_STOCK"]);

      const available = Math.max(stockAvailable, uidCount || 0);

      // Only block if stock is insufficient.
      // "QC Completed" on a sub-JO is a display-only label — the DB status stays SCHEDULED/IN_PROGRESS
      // until explicitly completed. Stock in hand is the reliable gate: if available >= stillNeeded,
      // the sub-assembly IS ready regardless of the sub-JO's workflow state.
      const hasPendingSubJo = pendingList.length > 0;
      const stockInsufficient = available < stillNeeded;

      if (!stockInsufficient) continue; // stock is sufficient — all clear

      const pendingSubJo = pendingList[0] || null;

      blockers.push({
        materialId: String(mat.id),
        itemCode: String(mat.item_code || ""),
        itemName: String(mat.item_name || ""),
        needed: stillNeeded,
        available,
        pendingSubJoNumber: pendingSubJo
          ? String(pendingSubJo.job_order_number || pendingSubJo.id || "")
          : null,
      });
    }

    return {
      ready: blockers.length === 0,
      blockers,
    };
  }

  async issueMaterialRequisitionLine(
    tenantId: string,
    jobOrderId: string,
    materialId: string,
    issueQuantity: number,
    uids?: string[],
    userId?: string,
  ) {
    // Master try-catch for detailed error reporting (v2026-02-17-v5)
    try {
      const formatSupabaseError = (err: any, location: string) => {
        const message = String(err?.message || "").trim();
        const details = String(err?.details || "").trim();
        const hint = String(err?.hint || "").trim();
        const code = String(err?.code || "").trim();
        const parts = [message, details, hint].filter(Boolean);
        const joined = parts.join(" | ");
        const base = code
          ? `${joined}${joined ? ` (code=${code})` : `code=${code}`}`
          : joined;
        // CRITICAL: Never return empty string - NestJS treats falsy as generic "Bad Request"
        return (
          base || `Supabase error at ${location} (raw: ${JSON.stringify(err)})`
        );
      };

      if (!tenantId) throw new BadRequestException("tenantId is required");
      if (!jobOrderId) throw new BadRequestException("jobOrderId is required");
      if (!materialId) throw new BadRequestException("materialId is required");

      const requestedIssueQty = Number(issueQuantity);
      if (!Number.isFinite(requestedIssueQty) || requestedIssueQty <= 0) {
        throw new BadRequestException("issueQuantity must be greater than 0");
      }

      let normalizedUids = Array.from(
        new Set(
          (Array.isArray(uids) ? uids : [])
            .map((u) => String(u || "").trim())
            .filter(Boolean),
        ),
      );

      const resolvedJobOrder = await this.resolveJobOrderIdentity(
        tenantId,
        jobOrderId,
      );
      const targetJobOrderId = resolvedJobOrder.id;

      const { data: jobOrder, error: jobError } = await this.supabase
        .from("production_job_orders")
        .select("id, tenant_id, status, job_order_number")
        .eq("tenant_id", tenantId)
        .eq("id", targetJobOrderId)
        .single();

      this.logger.log(
        `[SIV v5] STEP-1: Fetched job order for tenant=${tenantId}, jobOrderId=${targetJobOrderId}, error=${!!jobError}`,
      );
      if (jobError)
        throw new BadRequestException(
          formatSupabaseError(jobError, "STEP-1:job_order_lookup"),
        );
      if (!jobOrder) throw new NotFoundException("Job order not found");

      const status = String((jobOrder as any)?.status || "");
      if (status === "COMPLETED" || status === "CANCELLED") {
        throw new BadRequestException(
          "Cannot issue materials for a completed/cancelled job order",
        );
      }

      const { data: material, error: materialError } = await this.supabase
        .from("job_order_materials")
        .select(
          "id, job_order_id, item_id, selected_variant_id, item_code, item_name, required_quantity, issued_quantity, status",
        )
        .eq("id", materialId)
        .eq("job_order_id", targetJobOrderId)
        .maybeSingle();

      this.logger.log(
        `[SIV v5] STEP-2: Fetched material for materialId=${materialId}, jobOrderId=${targetJobOrderId}, error=${!!materialError}, found=${!!material}`,
      );
      if (materialError)
        throw new BadRequestException(
          formatSupabaseError(materialError, "STEP-2:material_lookup"),
        );
      if (!material)
        throw new NotFoundException(
          "Material line not found for this job order",
        );

      const requiredQty = Number((material as any)?.required_quantity) || 0;
      const alreadyIssued = Number((material as any)?.issued_quantity) || 0;
      const pendingQty = Math.max(0, requiredQty - alreadyIssued);

      if (pendingQty <= 0) {
        return {
          jobOrderId: targetJobOrderId,
          jobOrderNumber: (jobOrder as any)?.job_order_number,
          materialId,
          requestedIssueQty,
          issuedNow: 0,
          totalIssued: alreadyIssued,
          pendingQuantity: 0,
          materialStatus: "ISSUED",
          message: "This material line is already fully issued",
        };
      }

      let itemIdToConsume =
        String((material as any)?.selected_variant_id || "").trim() ||
        String((material as any)?.item_id || "").trim();

      if (!this.isUuid(itemIdToConsume)) {
        const code = String((material as any)?.item_code || "").trim();
        if (code) {
          const { data: itemByCode, error: itemByCodeError } =
            await this.supabase
              .from("items")
              .select("id, code")
              .eq("tenant_id", tenantId)
              .ilike("code", code)
              .limit(1);

          if (itemByCodeError)
            throw new BadRequestException(
              formatSupabaseError(itemByCodeError, "STEP-3a:item_code_lookup"),
            );
          const row = Array.isArray(itemByCode) ? itemByCode[0] : null;
          if (row?.id) {
            itemIdToConsume = String(row.id);
            await this.supabase
              .from("job_order_materials")
              .update({ item_id: itemIdToConsume })
              .eq("id", materialId);
          }
        }
      }

      if (!this.isUuid(itemIdToConsume)) {
        throw new BadRequestException(
          "Material line has invalid item mapping; cannot issue quantity",
        );
      }

      this.logger.log(
        `[SIV v5] STEP-3: Looking up item: itemIdToConsume=${itemIdToConsume}, tenantId=${tenantId}`,
      );
      const { data: item, error: itemError } = await this.supabase
        .from("items")
        .select(
          "code, name, category, uid_tracking, uid_strategy, batch_uom, batch_quantity",
        )
        .eq("tenant_id", tenantId)
        .eq("id", itemIdToConsume)
        .single();

      if (itemError)
        throw new BadRequestException(
          formatSupabaseError(
            itemError,
            `STEP-3:item_lookup(itemId=${itemIdToConsume})`,
          ),
        );

      // Some legacy/manual flows update only inventory_stock (not stock_entries).
      // Reconcile so FIFO issuing doesn't fail with "No stock available" while stock exists.
      this.logger.log(
        `[SIV v5] STEP-4: Reconciling stock entries for item=${itemIdToConsume}`,
      );
      await this.ensureStockEntriesAtLeastInventoryAvailable(
        tenantId,
        String(itemIdToConsume),
      );
      this.logger.log(`[SIV v5] STEP-4: Reconciliation complete`);

      // UID policy comes from Item Master.
      const uidTrackingEnabled =
        (item as any)?.uid_tracking === true &&
        String((item as any)?.uid_strategy || "").toUpperCase() !== "NONE";
      const uidStrategy = String(
        (item as any)?.uid_strategy ||
          (uidTrackingEnabled ? "SERIALIZED" : "NONE"),
      ).toUpperCase();
      const rawBatchQty = Number((item as any)?.batch_quantity);
      const qtyPerUid =
        uidStrategy === "BATCHED"
          ? Number.isFinite(rawBatchQty) && rawBatchQty > 0
            ? rawBatchQty
            : NaN
          : 1;

      if (
        uidTrackingEnabled &&
        uidStrategy === "BATCHED" &&
        !Number.isFinite(qtyPerUid)
      ) {
        throw new BadRequestException(
          "Item UID strategy is BATCHED but batch_quantity is missing/invalid in Item Master",
        );
      }

      normalizedUids = await this.resolveUidMappingsForIssue({
        tenantId,
        itemId: itemIdToConsume,
        requestedIssueQty,
        normalizedUids,
        uidTrackingEnabled,
        uidStrategy,
        qtyPerUid,
      });

      // If UID tracking is enabled, UIDs are compulsory for issuing (otherwise traceability breaks).
      // If UID tracking is disabled, UIDs are optional; if user provided them, we will validate them.
      const requiresUidMapping =
        uidTrackingEnabled || normalizedUids.length > 0;

      const issueQtyFromUids =
        normalizedUids.length > 0 ? normalizedUids.length * qtyPerUid : 0;

      if (
        normalizedUids.length > 0 &&
        Math.abs(issueQtyFromUids - requestedIssueQty) > 1e-9
      ) {
        const extra =
          uidStrategy === "BATCHED" ? ` (batch_quantity=${qtyPerUid})` : "";
        throw new BadRequestException(
          `issueQuantity must match scanned UIDs${extra}`,
        );
      }

      if (normalizedUids.length > 0 && issueQtyFromUids - pendingQty > 1e-9) {
        throw new BadRequestException(
          "Scanned UID quantity exceeds pending quantity for this material line",
        );
      }

      const issueTargetQty =
        normalizedUids.length > 0
          ? issueQtyFromUids
          : Math.min(requestedIssueQty, pendingQty);

      if (requiresUidMapping) {
        // Validate scanned UIDs exist, match item, and are ACTIVE
        const { data: uidRows, error: uidErr } = await this.supabase
          .from("uid_registry")
          .select(
            "uid, status, location, entity_id, entity_type, lifecycle, metadata",
          )
          .eq("tenant_id", tenantId)
          .in("uid", normalizedUids);

        if (uidErr)
          throw new BadRequestException(
            formatSupabaseError(uidErr, "STEP-5a:uid_registry_select"),
          );

        const byUid = new Map<string, any>();
        for (const row of uidRows || []) {
          const uid = String((row as any)?.uid || "").trim();
          if (uid) byUid.set(uid, row);
        }

        const missing = normalizedUids.filter((u) => !byUid.has(u));
        if (missing.length > 0) {
          throw new BadRequestException(
            `Unknown UID(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`,
          );
        }

        for (const uid of normalizedUids) {
          const row = byUid.get(uid);
          const status = String((row as any)?.status || "").trim();
          const entityId = String((row as any)?.entity_id || "").trim();

          if (!this.isIssuableUidStatus(status)) {
            throw new BadRequestException(
              `UID ${uid} cannot be issued (status=${status || "N/A"}). Must be GENERATED or IN_STOCK.`,
            );
          }
          if (entityId !== itemIdToConsume) {
            throw new BadRequestException(
              `UID ${uid} does not belong to the selected item`,
            );
          }
        }
      }

      const { data: stockEntries, error: stockError } = await this.supabase
        .from("stock_entries")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemIdToConsume)
        .gt("available_quantity", 0)
        .order("created_at", { ascending: true });

      this.logger.log(
        `[SIV v5] STEP-6: Stock query for item=${itemIdToConsume}: entries=${Array.isArray(stockEntries) ? stockEntries.length : "null"}, error=${!!stockError}`,
      );
      if (stockError)
        throw new BadRequestException(
          formatSupabaseError(stockError, "STEP-6:stock_entries_query"),
        );

      const safeEntries = Array.isArray(stockEntries) ? stockEntries : [];
      const uidWarehouseId = requiresUidMapping
        ? String((safeEntries[0] as any)?.warehouse_id || "").trim()
        : "";

      const relevantEntries =
        requiresUidMapping && uidWarehouseId
          ? safeEntries.filter(
              (e: any) =>
                String(e?.warehouse_id || "").trim() === uidWarehouseId,
            )
          : safeEntries;

      const totalAvailable = relevantEntries.reduce(
        (sum, entry: any) => sum + (Number(entry?.available_quantity) || 0),
        0,
      );

      // For UID-tracked items, also count UIDs in registry as authoritative stock.
      // stock_entries.available_quantity may be stale (drained by failed transactions)
      // while the underlying UIDs still exist as GENERATED/IN_STOCK.
      let uidRegistryCount = 0;
      if (requiresUidMapping && normalizedUids.length > 0) {
        const { count: uidCount } = await this.supabase
          .from("uid_registry")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("entity_id", itemIdToConsume)
          .in("status", ["GENERATED", "IN_STOCK"]);
        uidRegistryCount = uidCount || 0;
      }
      const effectiveAvailable = requiresUidMapping
        ? Math.max(totalAvailable, uidRegistryCount)
        : totalAvailable;

      this.logger.log(
        `[SIV v5] STEP-6: effectiveAvailable=${effectiveAvailable} (stockEntries=${totalAvailable}, uidRegistry=${uidRegistryCount}), required=${issueTargetQty}, requiresUidMapping=${requiresUidMapping}`,
      );

      // If UIDs are involved, do not allow partial issuing; it would consume FIFO but not map all scanned UIDs.
      if (requiresUidMapping && effectiveAvailable + 1e-9 < issueTargetQty) {
        throw new BadRequestException(
          `Insufficient stock to issue scanned UIDs. Required=${issueTargetQty}, available=${effectiveAvailable} (stock=${totalAvailable}, uids=${uidRegistryCount})`,
        );
      }
      const issueNow = Math.max(
        0,
        Math.min(issueTargetQty, effectiveAvailable),
      );

      if (issueNow <= 0) {
        this.logger.warn(
          `[SIV v5] STEP-6a: NO STOCK! item=${itemIdToConsume}, effectiveAvailable=${effectiveAvailable}, issueTargetQty=${issueTargetQty}, entriesCount=${relevantEntries.length}`,
        );
        throw new BadRequestException(
          `No stock available to issue for this material line. Item=${itemIdToConsume}, available=${effectiveAvailable}, required=${issueTargetQty}, entries=${relevantEntries.length}`,
        );
      }

      let remainingToConsume = issueNow;
      for (const entry of relevantEntries) {
        if (remainingToConsume <= 0) break;

        const entryAvailable = Number((entry as any)?.available_quantity) || 0;
        const toConsumeFromEntry = Math.min(entryAvailable, remainingToConsume);
        if (toConsumeFromEntry <= 0) continue;

        const newAvailable = entryAvailable - toConsumeFromEntry;

        const { error: updateError } = await this.supabase
          .from("stock_entries")
          .update({
            available_quantity: newAvailable,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (entry as any)?.id);

        if (updateError)
          throw new BadRequestException(
            formatSupabaseError(
              updateError,
              `STEP-7:stock_entry_update(entryId=${(entry as any)?.id})`,
            ),
          );

        const warehouseId = String((entry as any)?.warehouse_id || "").trim();

        // Enhanced diagnostic logging for warehouse validation (v2026-02-16-v3)
        this.logger.log(
          `[SIV DEBUG v2026-02-16-v3] Processing stock entry: entryId=${(entry as any)?.id}, warehouseId="${warehouseId}", isValidUuid=${this.isUuid(warehouseId)}, itemId=${itemIdToConsume}, qty=${toConsumeFromEntry}`,
        );

        if (!warehouseId) {
          throw new BadRequestException(
            `Stock entry ${(entry as any)?.id} has no warehouse_id. Cannot adjust inventory. Entry data: ${JSON.stringify(entry)}`,
          );
        }

        if (!this.isUuid(warehouseId)) {
          throw new BadRequestException(
            `Stock entry ${(entry as any)?.id} has invalid warehouse_id: "${warehouseId}". Must be a valid UUID.`,
          );
        }

        if (warehouseId && this.isUuid(warehouseId)) {
          try {
            await this.adjustInventoryStockWithFallback({
              tenantId,
              itemId: itemIdToConsume,
              warehouseId,
              locationId: null,
              quantityChange: -toConsumeFromEntry,
              category: normalizeInventoryCategory(
                (item as any)?.category,
                "RAW_MATERIAL",
              ),
              context: {
                source: "SIV_ISSUE_LINE",
                jobOrderId: targetJobOrderId,
                jobOrderNumber: String(
                  (jobOrder as any)?.job_order_number || "",
                ).trim(),
                materialId,
                stockEntryId: String((entry as any)?.id || "").trim(),
              },
            });
          } catch (err: any) {
            // Enhanced error context (v2026-02-16-v3)
            this.logger.error(
              `[SIV ERROR v2026-02-16-v3] adjust_inventory_stock failed: ${err?.message}. Entry: ${(entry as any)?.id}, Warehouse: ${warehouseId}, Item: ${itemIdToConsume}`,
            );

            // Roll back stock_entries update so we don't partially consume FIFO without updating inventory_stock.
            await this.supabase
              .from("stock_entries")
              .update({
                available_quantity: entryAvailable,
                updated_at: new Date().toISOString(),
              })
              .eq("id", (entry as any)?.id);
            throw err;
          }
        }

        // Preserve the exact FIFO layer consumed by production. This is
        // operational WIP/variance evidence only; no journal is auto-posted.
        const issueUnitCost = Number((entry as any)?.unit_price || 0);
        const jobNumber = String(
          (jobOrder as any)?.job_order_number || "",
        ).trim();
        const { error: costEventError } = await this.supabase
          .from("inventory_cost_events")
          .upsert(
            {
              tenant_id: tenantId,
              event_type: "PRODUCTION_ISSUE",
              item_id: itemIdToConsume,
              stock_entry_id: (entry as any)?.id,
              quantity: toConsumeFromEntry,
              unit_cost: issueUnitCost,
              total_cost: Number(
                (toConsumeFromEntry * issueUnitCost).toFixed(4),
              ),
              reference_type: "SIV",
              reference_number: `${jobNumber}:SIV:${materialId}:${String((entry as any)?.id || "")}:${newAvailable}`,
              metadata: {
                valuation_method: "FIFO",
                job_order_id: targetJobOrderId,
                job_order_number: jobNumber,
                material_line_id: materialId,
                warehouse_id: warehouseId,
              },
            },
            {
              onConflict:
                "tenant_id,event_type,stock_entry_id,reference_number",
              ignoreDuplicates: true,
            },
          );
        if (costEventError) {
          this.logger.error(
            `[SIV] Production issue cost evidence failed for ${jobNumber}: ${costEventError.message}`,
          );
        }

        // Audit trail handled below (one-per-uid if UID mapped; otherwise per chunk).
        if (!requiresUidMapping) {
          const movedBy = String(userId || "").trim();
          if (movedBy && this.isUuid(movedBy)) {
            const movementNumber = await this.generateMovementNumber(
              tenantId,
              "PRODUCTION_ISSUE",
            );
            const postedAt = new Date().toISOString();
            const { error: auditError } = await this.supabase
              .from("stock_movements")
              .insert({
                tenant_id: tenantId,
                movement_number: movementNumber,
                movement_type: "PRODUCTION_ISSUE",
                item_id: itemIdToConsume,
                from_warehouse_id:
                  warehouseId && this.isUuid(warehouseId) ? warehouseId : null,
                quantity: toConsumeFromEntry,
                reference_type: "SIV",
                reference_id: targetJobOrderId,
                reference_number: String(
                  (jobOrder as any)?.job_order_number || "",
                ),
                notes: `SIV: Issued ${toConsumeFromEntry} of ${String((material as any)?.item_code || "").trim()} (${String((material as any)?.item_name || "").trim()}) for ${String((jobOrder as any)?.job_order_number || "").trim()} (material_id=${materialId})`,
                moved_by: movedBy,
                movement_date: postedAt,
                approved_by: movedBy,
                approved_at: postedAt,
              } as any);

            if (auditError) {
              this.logger.error(
                "[SIV] Failed inserting stock_movements audit row (issueMaterialRequisitionLine)",
              );
              this.logger.error(
                JSON.stringify({
                  tenantId,
                  jobOrderId: targetJobOrderId,
                  materialId,
                  itemIdToConsume,
                  consumed: toConsumeFromEntry,
                  movedBy,
                  error: auditError,
                }),
              );
            }
          }
        }

        remainingToConsume -= toConsumeFromEntry;
      }

      // When UIDs are explicitly provided and cover the target quantity, UIDs are the authoritative
      // inventory source. stock_entries.available_quantity may be stale (drained by failed/rolled-back
      // transactions) while the underlying UIDs still exist as GENERATED/IN_STOCK. In that case,
      // honour the scanned UIDs and record issuedNow as the full target quantity.
      const issuedNow =
        requiresUidMapping && normalizedUids.length >= issueTargetQty
          ? issueTargetQty
          : Math.max(0, issueNow - remainingToConsume);

      if (requiresUidMapping) {
        const movedBy = String(userId || "").trim();
        if (movedBy && this.isUuid(movedBy)) {
          const uidsToConsumeCount = Math.min(
            normalizedUids.length,
            qtyPerUid > 0
              ? Math.floor(issuedNow / qtyPerUid + 1e-9)
              : normalizedUids.length,
          );
          const uidsToRecord = normalizedUids.slice(0, uidsToConsumeCount);
          const uidMovementNumbers: string[] = [];
          for (let i = 0; i < uidsToRecord.length; i++) {
            uidMovementNumbers.push(
              await this.generateMovementNumber(tenantId, "PRODUCTION_ISSUE"),
            );
          }
          const rows = uidsToRecord.map((uid, idx) => ({
            tenant_id: tenantId,
            movement_number: uidMovementNumbers[idx],
            movement_type: "PRODUCTION_ISSUE",
            item_id: itemIdToConsume,
            uid,
            from_warehouse_id:
              uidWarehouseId && this.isUuid(uidWarehouseId)
                ? uidWarehouseId
                : null,
            quantity: qtyPerUid,
            reference_type: "SIV",
            reference_id: targetJobOrderId,
            reference_number: String((jobOrder as any)?.job_order_number || ""),
            notes: `SIV: Issued UID ${uid} for ${String((jobOrder as any)?.job_order_number || "").trim()} (material_id=${materialId})`,
            moved_by: movedBy,
            movement_date: new Date().toISOString(),
            approved_by: movedBy,
            approved_at: new Date().toISOString(),
          }));

          if (rows.length > 0) {
            const { error: auditError } = await this.supabase
              .from("stock_movements")
              .insert(rows as any);
            if (auditError)
              throw new BadRequestException(
                formatSupabaseError(
                  auditError,
                  "STEP-8:stock_movements_insert",
                ),
              );
          }
        }

        // Mark UIDs as consumed for traceability
        const uidsToConsumeCount = Math.min(
          normalizedUids.length,
          qtyPerUid > 0
            ? Math.floor(issuedNow / qtyPerUid + 1e-9)
            : normalizedUids.length,
        );
        const { data: uidRows, error: uidErr } = await this.supabase
          .from("uid_registry")
          .select("uid, lifecycle, metadata")
          .eq("tenant_id", tenantId)
          .in("uid", normalizedUids.slice(0, uidsToConsumeCount));

        if (uidErr)
          throw new BadRequestException(
            formatSupabaseError(uidErr, "STEP-9:uid_registry_consumed"),
          );

        for (const row of uidRows || []) {
          const uid = String((row as any)?.uid || "").trim();
          if (!uid) continue;

          const rawLifecycle = (row as any)?.lifecycle;
          const rawMetadata = (row as any)?.metadata;
          const currentLifecycle = Array.isArray(rawLifecycle)
            ? rawLifecycle
            : rawLifecycle
              ? JSON.parse(String(rawLifecycle))
              : [];
          const currentMetadata =
            rawMetadata && typeof rawMetadata === "object"
              ? rawMetadata
              : rawMetadata
                ? JSON.parse(String(rawMetadata))
                : {};

          await this.supabase
            .from("uid_registry")
            .update({
              status: "CONSUMED",
              location: `Issued to ${String((jobOrder as any)?.job_order_number || "").trim()}`,
              lifecycle: [
                ...currentLifecycle,
                {
                  stage: "SIV_ISSUED",
                  timestamp: new Date().toISOString(),
                  job_order_id: targetJobOrderId,
                  job_order_number: String(
                    (jobOrder as any)?.job_order_number || "",
                  ).trim(),
                  material_id: materialId,
                  user: userId || null,
                },
              ],
              metadata: {
                ...currentMetadata,
                siv_issued_at: new Date().toISOString(),
                siv_issued_by: userId || null,
                siv_job_order_id: targetJobOrderId,
                siv_job_order_number: String(
                  (jobOrder as any)?.job_order_number || "",
                ).trim(),
                siv_material_id: materialId,
              },
            } as any)
            .eq("tenant_id", tenantId)
            .eq("uid", uid);
        }
      }

      const nextIssued = alreadyIssued + issuedNow;
      const nextStatus =
        nextIssued + 1e-9 >= requiredQty ? "ISSUED" : "PARTIAL";

      const { error: matUpdateErr } = await this.supabase
        .from("job_order_materials")
        .update({
          issued_quantity: nextIssued,
          status: nextStatus,
        })
        .eq("id", materialId)
        .eq("job_order_id", targetJobOrderId);

      if (matUpdateErr)
        throw new BadRequestException(
          formatSupabaseError(
            matUpdateErr,
            "STEP-10:job_order_materials_update",
          ),
        );

      const newPending = Math.max(0, requiredQty - nextIssued);

      return {
        jobOrderId: targetJobOrderId,
        jobOrderNumber: (jobOrder as any)?.job_order_number,
        materialId,
        materialItemCode: (material as any)?.item_code,
        materialItemName: (material as any)?.item_name,
        requestedIssueQty,
        issuedNow,
        totalIssued: nextIssued,
        pendingQuantity: newPending,
        materialStatus: nextStatus,
        issuedBy: userId || null,
        message:
          newPending > 0
            ? `Issued ${issuedNow.toFixed(2)}. Pending ${newPending.toFixed(2)} for this line.`
            : `Issued ${issuedNow.toFixed(2)}. This line is now fully issued.`,
      };
    } catch (error: any) {
      // Enhanced error context for v2026-02-17-v4
      const errorDetails = {
        errorType: error?.constructor?.name || "UnknownError",
        errorMessage: error?.message || "No message",
        tenantId,
        jobOrderId,
        materialId,
        issueQuantity,
        uidsProvided: Array.isArray(uids) ? uids.length : 0,
        timestamp: new Date().toISOString(),
      };

      this.logger.error(
        "[SIV issueMaterialRequisitionLine FAILED v2026-02-17-v5]",
      );
      this.logger.error(JSON.stringify(errorDetails, null, 2));

      // Re-throw with enhanced context - NEVER use empty/falsy message
      const errMsg =
        error?.message && error.message !== "Bad Request"
          ? error.message
          : `Unknown error (type=${errorDetails.errorType}, raw=${JSON.stringify(error?.response || error?.stack?.split("\n")[0] || "no-info")})`;
      throw new BadRequestException(
        `SIV Issue Failed (v5): ${errMsg}. Details: ${JSON.stringify(errorDetails)}`,
      );
    }
  }

  private supabaseErrorToString(err: any): string {
    const message = String(err?.message || "").trim();
    const details = String(err?.details || "").trim();
    const hint = String(err?.hint || "").trim();
    const code = String(err?.code || "").trim();

    const parts = [message, details, hint].filter(Boolean);
    const joined = parts.join(" | ");
    const base = code
      ? `${joined}${joined ? ` (code=${code})` : `code=${code}`}`
      : joined;

    // PostgrestError may not serialize well; include own-property JSON if it helps.
    let raw = "";
    try {
      raw = JSON.stringify(err, Object.getOwnPropertyNames(err));
    } catch {
      raw = "";
    }

    const rawUseful = raw && raw !== "{}" && raw !== "null" ? raw : "";
    if (rawUseful && base && rawUseful.includes(base)) return rawUseful;
    if (rawUseful && base) return `${base} | raw=${rawUseful}`;
    if (rawUseful) return rawUseful;
    return base || String(err || "").trim() || "Unknown error";
  }

  private async adjustInventoryStockWithFallback(args: {
    tenantId: string;
    itemId: string;
    warehouseId: string;
    locationId: string | null;
    quantityChange: number;
    category: string;
    context?: Record<string, any>;
  }): Promise<void> {
    const {
      tenantId,
      itemId,
      warehouseId,
      locationId,
      quantityChange,
      category,
      context,
    } = args;

    const { error: invError } = await this.supabase.rpc(
      "adjust_inventory_stock",
      {
        p_tenant_id: tenantId,
        p_item_id: itemId,
        p_warehouse_id: warehouseId,
        p_location_id: locationId,
        p_quantity_change: quantityChange,
        p_category: category,
      },
    );

    if (!invError) return;

    const rpcErr = this.supabaseErrorToString(invError);
    this.logger.error(
      "[Inventory] adjust_inventory_stock RPC failed; attempting fallback update on inventory_stock",
    );
    this.logger.error(
      JSON.stringify(
        {
          tenantId,
          itemId,
          warehouseId,
          locationId,
          quantityChange,
          category,
          rpcErr,
          context: context || null,
        },
        null,
        2,
      ),
    );

    try {
      await this.adjustInventoryStockFallbackDirect({
        tenantId,
        itemId,
        warehouseId,
        quantityChange,
        category,
      });
    } catch (fallbackErr: any) {
      const fbErr = this.supabaseErrorToString(fallbackErr);
      throw new BadRequestException(
        `adjust_inventory_stock failed: ${rpcErr}; fallback failed: ${fbErr}`,
      );
    }
  }

  private async adjustInventoryStockFallbackDirect(args: {
    tenantId: string;
    itemId: string;
    warehouseId: string;
    quantityChange: number;
    category: string;
  }): Promise<void> {
    const { tenantId, itemId, warehouseId, quantityChange } = args;
    const category = normalizeInventoryCategory(args.category, "RAW_MATERIAL");

    if (!Number.isFinite(quantityChange) || Math.abs(quantityChange) < 1e-9)
      return;

    // Prefer consuming/adding from existing rows to avoid creating duplicate NULL-location rows.
    const { data: rows, error } = await this.supabase
      .from("inventory_stock")
      .select(
        "id, quantity, reserved_quantity, available_quantity, location_id",
      )
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("warehouse_id", warehouseId)
      .eq("category", category)
      .order("available_quantity", { ascending: false });

    if (error) throw error;

    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length === 0) {
      if (quantityChange < 0) {
        throw new Error("No inventory stock rows available for deduction");
      }

      // Last resort: try to insert a row. This may fail if your schema enforces location_id.
      const { error: insErr } = await this.supabase
        .from("inventory_stock")
        .insert({
          tenant_id: tenantId,
          item_id: itemId,
          warehouse_id: warehouseId,
          location_id: null,
          category,
          quantity: quantityChange,
          reserved_quantity: 0,
          last_movement_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any);
      if (insErr) throw insErr;
      return;
    }

    let remaining = quantityChange;
    if (remaining < 0) {
      const totalAvailable = safeRows.reduce((sum, row) => {
        const currentQty = Number((row as any)?.quantity || 0);
        const reservedQty = Number((row as any)?.reserved_quantity || 0);
        return sum + Math.max(0, currentQty - reservedQty);
      }, 0);

      // Never leave a partially deducted balance if the full SIV quantity is
      // unavailable. Validate first, then update the individual location rows.
      if (totalAvailable + 1e-6 < -remaining) {
        throw new Error(
          `Insufficient inventory stock: available ${totalAvailable.toFixed(6)}, requested ${Math.abs(remaining).toFixed(6)}`,
        );
      }

      // Deduct across rows with the most available first.
      for (const row of safeRows) {
        if (remaining >= -1e-9) break;
        const currentQty = Number((row as any)?.quantity || 0);
        const reservedQty = Number((row as any)?.reserved_quantity || 0);
        const maxDeduct = Math.max(0, currentQty - reservedQty);
        const want = Math.min(maxDeduct, -remaining);
        if (want <= 0) continue;

        const nextQty = currentQty - want;
        const { error: upErr } = await this.supabase
          .from("inventory_stock")
          .update({
            quantity: nextQty,
            last_movement_date: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", (row as any)?.id);
        if (upErr) throw upErr;
        remaining += want;
      }

      if (remaining < -1e-6) {
        throw new Error(
          `Fallback inventory_stock deduction short by ${Math.abs(remaining).toFixed(6)}`,
        );
      }
      return;
    }

    // Add to the most available row (simple).
    const target = safeRows[0];
    const currentQty = Number((target as any)?.quantity || 0);
    const nextQty = currentQty + remaining;
    const { error: upErr } = await this.supabase
      .from("inventory_stock")
      .update({
        quantity: nextQty,
        last_movement_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", (target as any)?.id);
    if (upErr) throw upErr;
  }

  async getOpenStoreReceiptVouchers(tenantId: string) {
    const { data: completedJobs, error: jobsError } = await this.supabase
      .from("production_job_orders")
      .select(
        "id, job_order_number, item_id, item_code, item_name, quantity, completed_quantity, status, actual_end_date, created_at",
      )
      .eq("tenant_id", tenantId)
      .in("status", [...SRV_RECEIVABLE_JOB_ORDER_STATUSES])
      .order("created_at", { ascending: false })
      .limit(200);

    if (jobsError) throw new BadRequestException(jobsError.message);

    const ids = (completedJobs || [])
      .map((j: any) => String(j.id))
      .filter(Boolean);
    if (ids.length === 0) return [];

    const { data: receiptEntries, error: receiptError } = await this.supabase
      .from("stock_entries")
      .select("id, item_id, quantity, available_quantity, created_at, metadata")
      .eq("tenant_id", tenantId)
      .eq("metadata->>created_from", "STORE_RECEIPT")
      .order("created_at", { ascending: false })
      .limit(500);

    if (receiptError) throw new BadRequestException(receiptError.message);

    // Latest SRV stock_entry per job order (one SRV entry holds many UIDs).
    const latestReceiptByJob = new Map<string, any>();
    for (const entry of receiptEntries || []) {
      const jobId = String((entry as any)?.metadata?.job_order_id || "").trim();
      if (!jobId) continue;
      if (!latestReceiptByJob.has(jobId)) {
        latestReceiptByJob.set(jobId, entry);
      }
    }

    // OPEN SRVs = jobs that have produced quantity pending receipt OR receipt exists but is not approved.
    return (completedJobs || [])
      .map((jo: any) => {
        const status = String(jo.status || "")
          .trim()
          .toUpperCase();
        const completedQty = Number(jo.completed_quantity);
        const plannedQty = Number(jo.quantity);
        const producedQty =
          status === JOB_ORDER_STATUS.STOPPED ||
          status === JOB_ORDER_STATUS.IN_PROGRESS
            ? Math.max(0, Number.isFinite(completedQty) ? completedQty : 0)
            : Math.max(
                0,
                Number.isFinite(completedQty)
                  ? completedQty
                  : Number.isFinite(plannedQty)
                    ? plannedQty
                    : 0,
              );
        const alreadyReceivedQty = (receiptEntries || [])
          .filter(
            (e: any) =>
              String((e as any)?.metadata?.job_order_id || "").trim() ===
              String(jo.id),
          )
          .reduce(
            (sum: number, e: any) =>
              sum + (Number((e as any)?.quantity || 0) || 0),
            0,
          );
        const pendingQty = Math.max(0, producedQty - alreadyReceivedQty);

        const receiptEntry = latestReceiptByJob.get(String(jo.id)) || null;
        const meta = receiptEntry?.metadata || {};
        const srvApprovedAt = meta?.srv_approved_at || null;
        const hasPendingReceiptApproval =
          Boolean(receiptEntry?.id) && !srvApprovedAt && pendingQty <= 0;
        const receiptQuantity = Number(receiptEntry?.quantity || 0) || 0;
        const approvedUids = Array.isArray(meta?.approved_uids)
          ? meta.approved_uids
              .map((uid: any) => String(uid || "").trim())
              .filter(Boolean)
          : [];
        const receivedUids = Array.isArray(meta?.received_uids)
          ? meta.received_uids
              .map((uid: any) => String(uid || "").trim())
              .filter(Boolean)
          : [];
        const uids = approvedUids.length > 0 ? approvedUids : receivedUids;
        const uidSummary =
          uids.length === 0
            ? null
            : uids.length === 1
              ? uids[0]
              : `${uids.length} UIDs`;

        return {
          id: String(jo.id),
          entry_id: hasPendingReceiptApproval ? receiptEntry?.id || null : null,
          job_order_id: String(jo.id),
          job_order_number: jo.job_order_number,
          item_id: jo.item_id,
          item_code: jo.item_code,
          item_name: jo.item_name,
          uid: hasPendingReceiptApproval ? uidSummary : null,
          quantity: hasPendingReceiptApproval ? receiptQuantity : pendingQty,
          to_warehouse_id: null,
          movement_date: hasPendingReceiptApproval
            ? meta?.received_at || jo.actual_end_date || jo.created_at || null
            : jo.actual_end_date || jo.created_at || null,
          received_by: hasPendingReceiptApproval
            ? meta?.received_by_name || meta?.received_by || null
            : null,
          approved_by: hasPendingReceiptApproval
            ? meta?.srv_approved_by || null
            : null,
          approved_at: hasPendingReceiptApproval
            ? meta?.srv_approved_at || null
            : null,
          notes: null,
          // internal/debug fields (ignored by UI)
          _srv_stock_entry_id: hasPendingReceiptApproval
            ? receiptEntry?.id || null
            : null,
          _srv_approved_at: hasPendingReceiptApproval ? srvApprovedAt : null,
          _produced_qty: producedQty,
          _received_qty: alreadyReceivedQty,
        };
      })
      .filter((row: any) => {
        const pendingQty = Number(row.quantity || 0) || 0;
        // show when there is something left to receive OR when receipt exists but is not approved
        if (pendingQty > 0) return true;
        return Boolean(row._srv_stock_entry_id) && !row._srv_approved_at;
      });
  }

  private async resolveStoreReceiptVoucherEntry(
    tenantId: string,
    entryIdOrJobOrderId: string,
  ): Promise<{ id: string; metadata: any } | null> {
    const id = String(entryIdOrJobOrderId || "").trim();
    if (!tenantId || !id) return null;

    // 1) Try by stock_entries.id (history row)
    const { data: byId, error: byIdError } = await this.supabase
      .from("stock_entries")
      .select("id, metadata")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (byIdError) throw new BadRequestException(byIdError.message);
    if (byId)
      return { id: String((byId as any).id), metadata: (byId as any).metadata };

    // 2) Try by job_order_id stored in metadata (open SRV UI passes job order id)
    const { data: rows, error: byJobError } = await this.supabase
      .from("stock_entries")
      .select("id, metadata, created_at")
      .eq("tenant_id", tenantId)
      .eq("metadata->>created_from", "STORE_RECEIPT")
      .eq("metadata->>job_order_id", id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (byJobError) throw new BadRequestException(byJobError.message);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.id) return null;
    return { id: String((row as any).id), metadata: (row as any).metadata };
  }

  private summarizeStoreReceiptUids(metadata: any): string | null {
    const approvedUids = Array.isArray(metadata?.approved_uids)
      ? metadata.approved_uids
          .map((uid: any) => String(uid || "").trim())
          .filter(Boolean)
      : [];
    const receivedUids = Array.isArray(metadata?.received_uids)
      ? metadata.received_uids
          .map((uid: any) => String(uid || "").trim())
          .filter(Boolean)
      : [];
    const uids = approvedUids.length > 0 ? approvedUids : receivedUids;

    if (uids.length === 0) return null;
    if (uids.length === 1) return uids[0];
    return `${uids.length} UIDs`;
  }

  async getStoreIssueVoucherHistory(
    tenantId: string,
    options?: { assignedTo?: string },
  ) {
    const assignedTo = String(options?.assignedTo || "").trim();
    const { data: movements, error: mvErr } = await this.supabase
      .from("stock_movements")
      .select(
        "id, tenant_id, movement_type, item_id, uid, from_warehouse_id, quantity, reference_type, reference_id, reference_number, movement_date, notes, moved_by, approved_by, approved_at, issued_to_employee_id, issued_to_employee_code, issued_to_employee_name",
      )
      .eq("tenant_id", tenantId)
      .eq("reference_type", "SIV")
      .order("movement_date", { ascending: false })
      .limit(500);

    if (mvErr) throw new BadRequestException(mvErr.message);

    const safe = Array.isArray(movements) ? movements : [];
    const itemIds = Array.from(
      new Set(
        safe.map((m: any) => String(m?.item_id || "").trim()).filter(Boolean),
      ),
    );
    const jobIds = Array.from(
      new Set(
        safe
          .map((m: any) => String(m?.reference_id || "").trim())
          .filter(Boolean),
      ),
    );

    const [itemsResult, jobsResult] = await Promise.all([
      itemIds.length
        ? this.supabase
            .from("items")
            .select("id, code, name")
            .eq("tenant_id", tenantId)
            .in("id", itemIds)
        : Promise.resolve({ data: [], error: null } as any),
      jobIds.length
        ? this.supabase
            .from("production_job_orders")
            .select(
              "id, job_order_number, item_code, item_name, assigned_to, assigned_to_name",
            )
            .eq("tenant_id", tenantId)
            .in("id", jobIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (itemsResult?.error)
      throw new BadRequestException(itemsResult.error.message);
    if (jobsResult?.error)
      throw new BadRequestException(jobsResult.error.message);

    const itemsById = new Map<string, any>();
    for (const it of (itemsResult?.data || []) as any[]) {
      const id = String((it as any)?.id || "").trim();
      if (!id) continue;
      itemsById.set(id, it);
    }

    const jobsById = new Map<string, any>();
    for (const jo of (jobsResult?.data || []) as any[]) {
      const id = String((jo as any)?.id || "").trim();
      if (!id) continue;
      jobsById.set(id, jo);
    }

    const allowedJobIds = assignedTo
      ? new Set(
          Array.from(jobsById.values())
            .filter(
              (jo: any) =>
                String((jo as any)?.assigned_to || "").trim() === assignedTo,
            )
            .map((jo: any) => String((jo as any)?.id || "").trim())
            .filter(Boolean),
        )
      : null;

    return safe
      .filter((m: any) => {
        if (!assignedTo) return true;

        const jobId = String(m?.reference_id || "").trim();
        if (jobId) {
          return allowedJobIds?.has(jobId) ?? false;
        }

        return String(m?.moved_by || "").trim() === assignedTo;
      })
      .map((m: any) => {
        const itemId = String(m?.item_id || "").trim();
        const jobId = String(m?.reference_id || "").trim();
        const item = itemId ? itemsById.get(itemId) : null;
        const job = jobId ? jobsById.get(jobId) : null;

        return {
          id: String(m?.id || ""),
          job_order_id: jobId || null,
          job_order_number: String(
            job?.job_order_number || m?.reference_number || "",
          ),
          item_id: itemId || null,
          item_code: String(item?.code || job?.item_code || ""),
          item_name: String(item?.name || job?.item_name || ""),
          uid: String(m?.uid || ""),
          quantity: Number(m?.quantity || 0),
          from_warehouse_id: String(m?.from_warehouse_id || ""),
          movement_date: m?.movement_date || null,
          moved_by: String(m?.moved_by || ""),
          approved_by: String(m?.approved_by || ""),
          approved_at: m?.approved_at || null,
          notes: String(m?.notes || ""),
          issued_to_employee_id: String(m?.issued_to_employee_id || ""),
          issued_to_employee_code: String(m?.issued_to_employee_code || ""),
          issued_to_employee_name: String(m?.issued_to_employee_name || ""),
          assigned_to: String(job?.assigned_to || ""),
          assigned_to_name: String(job?.assigned_to_name || ""),
        };
      });
  }

  async createManualStoreIssueVoucher(
    tenantId: string,
    payload: {
      itemId: string;
      issueQuantity: number;
      issuedToEmployeeId: string;
      notes?: string;
      uids?: string[];
      userId?: string;
    },
  ) {
    const itemId = String(payload?.itemId || "").trim();
    const requestedIssueQty = Number(payload?.issueQuantity || 0);
    const movedBy = String(payload?.userId || "").trim();
    const issuedToEmployeeId = String(payload?.issuedToEmployeeId || "").trim();
    const manualNotes = String(payload?.notes || "").trim();
    let normalizedUids = Array.from(
      new Set(
        (Array.isArray(payload?.uids) ? payload.uids : [])
          .map((uid) => String(uid || "").trim())
          .filter(Boolean),
      ),
    );

    if (!this.isUuid(itemId))
      throw new BadRequestException("Valid itemId is required");
    if (!Number.isFinite(requestedIssueQty) || requestedIssueQty <= 0) {
      throw new BadRequestException("issueQuantity must be greater than 0");
    }
    if (!movedBy || !this.isUuid(movedBy))
      throw new BadRequestException("Valid userId is required");
    if (!issuedToEmployeeId || !this.isUuid(issuedToEmployeeId)) {
      throw new BadRequestException(
        "Select the employee receiving the material",
      );
    }

    const { data: issuedToEmployee, error: employeeError } = await this.supabase
      .from("employees")
      .select("id, employee_code, employee_name, status")
      .eq("tenant_id", tenantId)
      .eq("id", issuedToEmployeeId)
      .maybeSingle();
    if (employeeError) throw new BadRequestException(employeeError.message);
    if (
      !issuedToEmployee ||
      String((issuedToEmployee as any)?.status || "").toUpperCase() !== "ACTIVE"
    ) {
      throw new BadRequestException(
        "Selected employee is not an active registered employee for this company",
      );
    }
    const issuedToEmployeeCode = String(
      (issuedToEmployee as any)?.employee_code || "",
    ).trim();
    const issuedToEmployeeName = String(
      (issuedToEmployee as any)?.employee_name || "",
    ).trim();
    if (!issuedToEmployeeName)
      throw new BadRequestException(
        "Selected employee has no name in Employee Master",
      );

    const { data: item, error: itemError } = await this.supabase
      .from("items")
      .select(
        "id, code, name, category, uid_tracking, uid_strategy, batch_quantity",
      )
      .eq("tenant_id", tenantId)
      .eq("id", itemId)
      .single();

    if (itemError) throw new BadRequestException(itemError.message);

    await this.ensureStockEntriesAtLeastInventoryAvailable(tenantId, itemId);

    const uidTrackingEnabled =
      (item as any)?.uid_tracking === true &&
      String((item as any)?.uid_strategy || "").toUpperCase() !== "NONE";
    const uidStrategy = String(
      (item as any)?.uid_strategy ||
        (uidTrackingEnabled ? "SERIALIZED" : "NONE"),
    ).toUpperCase();
    const rawBatchQty = Number((item as any)?.batch_quantity);
    const qtyPerUid =
      uidStrategy === "BATCHED"
        ? Number.isFinite(rawBatchQty) && rawBatchQty > 0
          ? rawBatchQty
          : NaN
        : 1;

    if (
      uidTrackingEnabled &&
      uidStrategy === "BATCHED" &&
      !Number.isFinite(qtyPerUid)
    ) {
      throw new BadRequestException(
        "Item UID strategy is BATCHED but batch_quantity is missing/invalid in Item Master",
      );
    }

    normalizedUids = await this.resolveUidMappingsForIssue({
      tenantId,
      itemId,
      requestedIssueQty,
      normalizedUids,
      uidTrackingEnabled,
      uidStrategy,
      qtyPerUid,
    });

    const requiresUidMapping = uidTrackingEnabled || normalizedUids.length > 0;

    const issueQtyFromUids =
      normalizedUids.length > 0 ? normalizedUids.length * qtyPerUid : 0;
    if (
      normalizedUids.length > 0 &&
      Math.abs(issueQtyFromUids - requestedIssueQty) > 1e-9
    ) {
      const extra =
        uidStrategy === "BATCHED" ? ` (batch_quantity=${qtyPerUid})` : "";
      throw new BadRequestException(
        `issueQuantity must match scanned UIDs${extra}`,
      );
    }

    if (requiresUidMapping) {
      const { data: uidRows, error: uidErr } = await this.supabase
        .from("uid_registry")
        .select("uid, status, entity_id")
        .eq("tenant_id", tenantId)
        .in("uid", normalizedUids);

      if (uidErr) throw new BadRequestException(uidErr.message);

      const byUid = new Map<string, any>();
      for (const row of uidRows || []) {
        const uid = String((row as any)?.uid || "").trim();
        if (uid) byUid.set(uid, row);
      }

      const missing = normalizedUids.filter((uid) => !byUid.has(uid));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown UID(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`,
        );
      }

      for (const uid of normalizedUids) {
        const row = byUid.get(uid);
        const status = String((row as any)?.status || "").trim();
        const entityId = String((row as any)?.entity_id || "").trim();
        if (!this.isIssuableUidStatus(status)) {
          throw new BadRequestException(
            `UID ${uid} cannot be issued (status=${status || "N/A"})`,
          );
        }
        if (entityId !== itemId) {
          throw new BadRequestException(
            `UID ${uid} does not belong to the selected item`,
          );
        }
      }
    }

    const { data: stockEntries, error: stockError } = await this.supabase
      .from("stock_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .gt("available_quantity", 0)
      .order("created_at", { ascending: true });

    if (stockError) throw new BadRequestException(stockError.message);

    const safeEntries = Array.isArray(stockEntries) ? stockEntries : [];
    const preferredWarehouseId = requiresUidMapping
      ? String((safeEntries[0] as any)?.warehouse_id || "").trim()
      : "";
    const relevantEntries =
      requiresUidMapping && preferredWarehouseId
        ? safeEntries.filter(
            (entry: any) =>
              String(entry?.warehouse_id || "").trim() === preferredWarehouseId,
          )
        : safeEntries;

    const totalAvailable = relevantEntries.reduce(
      (sum, entry: any) => sum + (Number(entry?.available_quantity) || 0),
      0,
    );
    let uidRegistryCount = 0;
    if (requiresUidMapping && normalizedUids.length > 0) {
      const { count } = await this.supabase
        .from("uid_registry")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("entity_id", itemId)
        .in("status", ["GENERATED", "IN_STOCK"]);
      uidRegistryCount = count || 0;
    }

    const effectiveAvailable = totalAvailable;
    const issueTargetQty =
      normalizedUids.length > 0 ? issueQtyFromUids : requestedIssueQty;

    if (requiresUidMapping && uidRegistryCount + 1e-9 < normalizedUids.length) {
      throw new BadRequestException(
        `Insufficient UID stock to issue scanned UIDs. Required=${normalizedUids.length}, available=${uidRegistryCount}`,
      );
    }

    if (requiresUidMapping && effectiveAvailable + 1e-9 < issueTargetQty) {
      throw new BadRequestException(
        `Insufficient stock to issue scanned UIDs. Required=${issueTargetQty}, available=${effectiveAvailable}`,
      );
    }

    const issueNow = Math.max(0, Math.min(issueTargetQty, effectiveAvailable));
    if (issueNow <= 0)
      throw new BadRequestException(
        "No stock available to issue for the selected item",
      );

    const voucherNumber = await this.generateMovementNumber(
      tenantId,
      "PRODUCTION_ISSUE",
    );
    let remainingToConsume = issueNow;

    for (const entry of relevantEntries) {
      if (remainingToConsume <= 0) break;

      const entryAvailable = Number((entry as any)?.available_quantity || 0);
      const toConsumeFromEntry = Math.min(entryAvailable, remainingToConsume);
      if (toConsumeFromEntry <= 0) continue;

      const warehouseId = String((entry as any)?.warehouse_id || "").trim();
      if (!warehouseId || !this.isUuid(warehouseId)) {
        throw new BadRequestException(
          `Stock entry ${(entry as any)?.id} has invalid warehouse_id`,
        );
      }

      const { error: updateError } = await this.supabase
        .from("stock_entries")
        .update({
          available_quantity: entryAvailable - toConsumeFromEntry,
          updated_at: new Date().toISOString(),
        })
        .eq("id", (entry as any)?.id);

      if (updateError) throw new BadRequestException(updateError.message);

      try {
        await this.adjustInventoryStockWithFallback({
          tenantId,
          itemId,
          warehouseId,
          locationId: null,
          quantityChange: -toConsumeFromEntry,
          category: normalizeInventoryCategory(
            (item as any)?.category,
            "RAW_MATERIAL",
          ),
          context: {
            source: "MANUAL_SIV",
            stockEntryId: String((entry as any)?.id || "").trim(),
            voucherNumber,
          },
        });
      } catch (error) {
        await this.supabase
          .from("stock_entries")
          .update({
            available_quantity: entryAvailable,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (entry as any)?.id);
        throw error;
      }

      if (!requiresUidMapping) {
        const postedAt = new Date().toISOString();
        const lineMovementNumber = await this.generateMovementNumber(
          tenantId,
          "PRODUCTION_ISSUE",
        );
        const { error: movementError } = await this.supabase
          .from("stock_movements")
          .insert({
            tenant_id: tenantId,
            movement_number: lineMovementNumber,
            movement_type: "PRODUCTION_ISSUE",
            item_id: itemId,
            from_warehouse_id: warehouseId,
            quantity: toConsumeFromEntry,
            reference_type: "SIV",
            reference_id: null,
            reference_number: voucherNumber,
            notes:
              manualNotes ||
              `Manual SIV: Issued ${toConsumeFromEntry} of ${String((item as any)?.code || "").trim()} (${String((item as any)?.name || "").trim()})`,
            moved_by: movedBy,
            issued_to_employee_id: issuedToEmployeeId,
            issued_to_employee_code: issuedToEmployeeCode || null,
            issued_to_employee_name: issuedToEmployeeName,
            movement_date: postedAt,
            approved_by: movedBy,
            approved_at: postedAt,
          } as any);

        if (movementError) throw new BadRequestException(movementError.message);
      }

      remainingToConsume -= toConsumeFromEntry;
    }

    const issuedNow =
      normalizedUids.length > 0 && normalizedUids.length >= issueTargetQty
        ? issueTargetQty
        : Math.max(0, issueNow - remainingToConsume);

    if (requiresUidMapping) {
      const warehouseId =
        preferredWarehouseId && this.isUuid(preferredWarehouseId)
          ? preferredWarehouseId
          : null;
      const uidMovementNumbers: string[] = [];
      const uidsToConsumeCount = Math.min(
        normalizedUids.length,
        qtyPerUid > 0
          ? Math.floor(issuedNow / qtyPerUid + 1e-9)
          : normalizedUids.length,
      );
      const uidsToRecord = normalizedUids.slice(0, uidsToConsumeCount);

      for (let index = 0; index < uidsToRecord.length; index += 1) {
        uidMovementNumbers.push(
          await this.generateMovementNumber(tenantId, "PRODUCTION_ISSUE"),
        );
      }

      const rows = uidsToRecord.map((uid, index) => {
        const postedAt = new Date().toISOString();
        return {
          tenant_id: tenantId,
          movement_number: uidMovementNumbers[index],
          movement_type: "PRODUCTION_ISSUE",
          item_id: itemId,
          uid,
          from_warehouse_id: warehouseId,
          quantity: qtyPerUid,
          reference_type: "SIV",
          reference_id: null,
          reference_number: voucherNumber,
          notes:
            manualNotes ||
            `Manual SIV: Issued UID ${uid} for ${String((item as any)?.code || "").trim()}`,
          moved_by: movedBy,
          issued_to_employee_id: issuedToEmployeeId,
          issued_to_employee_code: issuedToEmployeeCode || null,
          issued_to_employee_name: issuedToEmployeeName,
          movement_date: postedAt,
          approved_by: movedBy,
          approved_at: postedAt,
        };
      });

      if (rows.length > 0) {
        const { error: rowsError } = await this.supabase
          .from("stock_movements")
          .insert(rows as any);
        if (rowsError) throw new BadRequestException(rowsError.message);
      }

      const { data: uidRows, error: uidRowsError } = await this.supabase
        .from("uid_registry")
        .select("uid, lifecycle, metadata")
        .eq("tenant_id", tenantId)
        .in("uid", uidsToRecord);

      if (uidRowsError) throw new BadRequestException(uidRowsError.message);

      for (const row of uidRows || []) {
        const uid = String((row as any)?.uid || "").trim();
        if (!uid) continue;

        const rawLifecycle = (row as any)?.lifecycle;
        const rawMetadata = (row as any)?.metadata;
        const currentLifecycle = Array.isArray(rawLifecycle)
          ? rawLifecycle
          : rawLifecycle
            ? JSON.parse(String(rawLifecycle))
            : [];
        const currentMetadata =
          rawMetadata && typeof rawMetadata === "object"
            ? rawMetadata
            : rawMetadata
              ? JSON.parse(String(rawMetadata))
              : {};

        await this.supabase
          .from("uid_registry")
          .update({
            status: "CONSUMED",
            location: `Issued via ${voucherNumber}`,
            lifecycle: [
              ...currentLifecycle,
              {
                stage: "SIV_ISSUED",
                timestamp: new Date().toISOString(),
                user: movedBy,
                voucher_number: voucherNumber,
                manual: true,
              },
            ],
            metadata: {
              ...currentMetadata,
              siv_issued_at: new Date().toISOString(),
              siv_issued_by: movedBy,
              siv_reference_number: voucherNumber,
              siv_manual: true,
            },
          } as any)
          .eq("tenant_id", tenantId)
          .eq("uid", uid);
      }
    }

    return {
      voucherNumber,
      itemId,
      itemCode: String((item as any)?.code || "").trim(),
      itemName: String((item as any)?.name || "").trim(),
      issuedToEmployeeId,
      issuedToEmployeeCode,
      issuedToEmployeeName,
      issuedNow,
      uidCount: normalizedUids.length,
      message: `Manual SIV ${voucherNumber} created successfully`,
    };
  }

  async createManualStoreReturnVoucher(
    tenantId: string,
    payload: {
      sourceVoucherNumber: string;
      itemId: string;
      returnQuantity: number;
      returnedByEmployeeId: string;
      condition: "GOOD" | "DAMAGED" | "REJECTED" | "SCRAP";
      reason: string;
      uids?: string[];
      userId?: string;
    },
  ) {
    const sourceVoucherNumber = String(
        payload?.sourceVoucherNumber || "",
      ).trim(),
      itemId = String(payload?.itemId || "").trim(),
      employeeId = String(payload?.returnedByEmployeeId || "").trim(),
      userId = String(payload?.userId || "").trim(),
      condition = String(payload?.condition || "").toUpperCase() as
        | "GOOD"
        | "DAMAGED"
        | "REJECTED"
        | "SCRAP",
      reason = String(payload?.reason || "").trim(),
      returnQuantity = Number(payload?.returnQuantity || 0),
      suppliedUids = Array.from(
        new Set(
          (Array.isArray(payload?.uids) ? payload.uids : [])
            .map((uid) => String(uid || "").trim())
            .filter(Boolean),
        ),
      );
    if (!tenantId || !sourceVoucherNumber)
      throw new BadRequestException("Original SIV voucher is required");
    if (!this.isUuid(itemId) || !this.isUuid(employeeId))
      throw new BadRequestException(
        "Valid item and returning employee are required",
      );
    if (!this.isUuid(userId))
      throw new BadRequestException("Valid userId is required");
    if (!Number.isFinite(returnQuantity) || returnQuantity <= 0)
      throw new BadRequestException("returnQuantity must be greater than 0");
    if (!["GOOD", "DAMAGED", "REJECTED", "SCRAP"].includes(condition))
      throw new BadRequestException("Return condition is not supported");
    if (!reason) throw new BadRequestException("Return reason is required");

    return this.withManualReturnLock(
      `${tenantId}:${sourceVoucherNumber}:${itemId}:${employeeId}`,
      async () => {
        const [
          { data: employee, error: employeeError },
          { data: item, error: itemError },
        ] = await Promise.all([
          this.supabase
            .from("employees")
            .select("id,employee_code,employee_name,status")
            .eq("tenant_id", tenantId)
            .eq("id", employeeId)
            .maybeSingle(),
          this.supabase
            .from("items")
            .select(
              "id,code,name,category,uid_tracking,uid_strategy,batch_quantity",
            )
            .eq("tenant_id", tenantId)
            .eq("id", itemId)
            .maybeSingle(),
        ]);
        if (employeeError || !employee)
          throw new BadRequestException(
            employeeError?.message || "Returning employee was not found",
          );
        if (String((employee as any).status || "").toUpperCase() !== "ACTIVE")
          throw new BadRequestException("Returning employee is not active");
        if (itemError || !item)
          throw new BadRequestException(
            itemError?.message || "Return item was not found",
          );

        const [
          { data: issuedRows, error: issueError },
          { data: returnedRows, error: returnError },
        ] = await Promise.all([
          this.supabase
            .from("stock_movements")
            .select("id,uid,from_warehouse_id,quantity,issued_to_employee_id")
            .eq("tenant_id", tenantId)
            .eq("reference_type", "SIV")
            .eq("reference_number", sourceVoucherNumber)
            .eq("item_id", itemId),
          this.supabase
            .from("stock_movements")
            .select("id,uid,quantity,issued_to_employee_id")
            .eq("tenant_id", tenantId)
            .eq("reference_type", "SRV")
            .eq("reference_number", sourceVoucherNumber)
            .eq("item_id", itemId),
        ]);
        if (issueError || returnError)
          throw new BadRequestException((issueError || returnError)?.message);
        const issues = issuedRows || [];
        if (!issues.length)
          throw new BadRequestException(
            "Original SIV does not contain the selected item",
          );
        if (
          issues.some(
            (row: any) =>
              String(row.issued_to_employee_id || "") !== employeeId,
          )
        )
          throw new BadRequestException(
            "Returning employee does not match the original SIV custody",
          );
        const issuedQuantity = issues.reduce(
            (sum: number, row: any) => sum + Number(row.quantity || 0),
            0,
          ),
          alreadyReturned = (returnedRows || []).reduce(
            (sum: number, row: any) => sum + Number(row.quantity || 0),
            0,
          ),
          remaining = issuedQuantity - alreadyReturned;
        if (returnQuantity > remaining + 0.000001)
          throw new BadRequestException(
            `Return quantity exceeds remaining employee custody (${Math.max(0, remaining)})`,
          );

        const uidTracked =
            (item as any).uid_tracking === true &&
            String((item as any).uid_strategy || "").toUpperCase() !== "NONE",
          uidStrategy = String(
            (item as any).uid_strategy || (uidTracked ? "SERIALIZED" : "NONE"),
          ).toUpperCase(),
          batchQuantity =
            uidStrategy === "BATCHED"
              ? Number((item as any).batch_quantity)
              : 1,
          sourceUids = new Set(
            issues
              .map((row: any) => String(row.uid || "").trim())
              .filter(Boolean),
          ),
          returnedUids = new Set(
            (returnedRows || [])
              .map((row: any) => String(row.uid || "").trim())
              .filter(Boolean),
          );
        if (uidTracked) {
          if (!suppliedUids.length)
            throw new BadRequestException(
              "This return requires exact UIDs from the original SIV",
            );
          if (
            !Number.isFinite(batchQuantity) ||
            batchQuantity <= 0 ||
            Math.abs(suppliedUids.length * batchQuantity - returnQuantity) >
              0.000001
          )
            throw new BadRequestException(
              "Return quantity must match the exact supplied UIDs",
            );
          for (const uid of suppliedUids)
            if (!sourceUids.has(uid) || returnedUids.has(uid))
              throw new BadRequestException(
                `UID ${uid} is not returnable against the original SIV`,
              );
        } else if (suppliedUids.length) {
          throw new BadRequestException(
            "UIDs cannot be supplied for a non-UID item",
          );
        }

        const warehouseIds = [
          ...new Set(
            issues
              .map((row: any) => String(row.from_warehouse_id || "").trim())
              .filter(Boolean),
          ),
        ];
        if (warehouseIds.length !== 1 || !this.isUuid(warehouseIds[0]))
          throw new BadRequestException(
            "Original SIV warehouse cannot be resolved unambiguously",
          );
        const warehouseId = warehouseIds[0],
          returnVoucherNumber = await this.generateMovementNumber(
            tenantId,
            "PRODUCTION_RETURN",
          ),
          isAvailable = condition === "GOOD",
          returnedAt = new Date().toISOString(),
          metadata = {
            created_from: "MANUAL_SRV_RETURN",
            source_siv_voucher: sourceVoucherNumber,
            return_voucher_number: returnVoucherNumber,
            return_condition: condition,
            return_reason: reason,
            returned_by_employee_id: employeeId,
            returned_by_employee_code:
              String((employee as any).employee_code || "").trim() || null,
            returned_by_employee_name: String(
              (employee as any).employee_name || "",
            ).trim(),
            returned_uids: suppliedUids,
            quarantined: !isAvailable,
            returned_at: returnedAt,
            returned_by: userId,
          };
        const { data: stockEntry, error: stockEntryError } = await this.supabase
          .from("stock_entries")
          .insert({
            tenant_id: tenantId,
            item_id: itemId,
            warehouse_id: warehouseId,
            quantity: returnQuantity,
            available_quantity: isAvailable ? returnQuantity : 0,
            allocated_quantity: 0,
            metadata,
          } as any)
          .select("id")
          .single();
        if (stockEntryError || !stockEntry)
          throw new BadRequestException(
            stockEntryError?.message ||
              "Return stock entry could not be created",
          );

        let inventoryAdjusted = false;
        let uidOriginalRows: any[] = [];
        try {
          if (isAvailable) {
            await this.adjustInventoryStockWithFallback({
              tenantId,
              itemId,
              warehouseId,
              locationId: null,
              quantityChange: returnQuantity,
              category: normalizeInventoryCategory(
                (item as any).category,
                "RAW_MATERIAL",
              ),
              context: { source: "MANUAL_SRV_RETURN", returnVoucherNumber },
            });
            inventoryAdjusted = true;
          }
          const movementRows = suppliedUids.length
            ? await Promise.all(
                suppliedUids.map(async (uid) => ({
                  tenant_id: tenantId,
                  movement_number: await this.generateMovementNumber(
                    tenantId,
                    "PRODUCTION_RETURN",
                  ),
                  movement_type: "PRODUCTION_RETURN",
                  item_id: itemId,
                  uid,
                  from_warehouse_id: warehouseId,
                  quantity: batchQuantity,
                  reference_type: "SRV",
                  reference_id: stockEntry.id,
                  reference_number: sourceVoucherNumber,
                  notes: `${condition} return via ${returnVoucherNumber}: ${reason}`,
                  moved_by: userId,
                  issued_to_employee_id: employeeId,
                  issued_to_employee_code:
                    (employee as any).employee_code || null,
                  issued_to_employee_name: (employee as any).employee_name,
                  movement_date: returnedAt,
                  approved_by: userId,
                  approved_at: returnedAt,
                })),
              )
            : [
                {
                  tenant_id: tenantId,
                  movement_number: returnVoucherNumber,
                  movement_type: "PRODUCTION_RETURN",
                  item_id: itemId,
                  from_warehouse_id: warehouseId,
                  quantity: returnQuantity,
                  reference_type: "SRV",
                  reference_id: stockEntry.id,
                  reference_number: sourceVoucherNumber,
                  notes: `${condition} return: ${reason}`,
                  moved_by: userId,
                  issued_to_employee_id: employeeId,
                  issued_to_employee_code:
                    (employee as any).employee_code || null,
                  issued_to_employee_name: (employee as any).employee_name,
                  movement_date: returnedAt,
                  approved_by: userId,
                  approved_at: returnedAt,
                },
              ];
          const { error: movementError } = await this.supabase
            .from("stock_movements")
            .insert(movementRows as any);
          if (movementError) throw movementError;

          if (suppliedUids.length) {
            const { data: uidRows, error: uidError } = await this.supabase
              .from("uid_registry")
              .select("uid,status,location,lifecycle,metadata")
              .eq("tenant_id", tenantId)
              .in("uid", suppliedUids);
            if (uidError || (uidRows || []).length !== suppliedUids.length)
              throw (
                uidError ||
                new Error("One or more returned UIDs were not found")
              );
            uidOriginalRows = uidRows || [];
            for (const uidRow of uidRows || []) {
              if (String((uidRow as any).status || "") !== "CONSUMED")
                throw new Error(
                  `UID ${(uidRow as any).uid} is no longer in issued custody`,
                );
              const lifecycle = Array.isArray((uidRow as any).lifecycle)
                  ? (uidRow as any).lifecycle
                  : [],
                existingMetadata =
                  (uidRow as any).metadata &&
                  typeof (uidRow as any).metadata === "object"
                    ? (uidRow as any).metadata
                    : {};
              const { error: updateUidError } = await this.supabase
                .from("uid_registry")
                .update({
                  status:
                    condition === "GOOD"
                      ? "IN_STOCK"
                      : condition === "SCRAP"
                        ? "SCRAPPED"
                        : "CONSUMED",
                  location:
                    condition === "GOOD"
                      ? "Warehouse"
                      : condition === "SCRAP"
                        ? "Scrap"
                        : "Return quarantine",
                  lifecycle: [
                    ...lifecycle,
                    {
                      stage: "SRV_RETURNED",
                      timestamp: returnedAt,
                      source_siv_voucher: sourceVoucherNumber,
                      return_voucher_number: returnVoucherNumber,
                      condition,
                      user: userId,
                    },
                  ],
                  metadata: {
                    ...existingMetadata,
                    srv_returned_at: returnedAt,
                    srv_returned_by: userId,
                    srv_return_condition: condition,
                    srv_return_voucher: returnVoucherNumber,
                    srv_quarantined: !isAvailable,
                  },
                } as any)
                .eq("tenant_id", tenantId)
                .eq("uid", (uidRow as any).uid);
              if (updateUidError) throw updateUidError;
            }
          }
        } catch (error: any) {
          for (const uidRow of uidOriginalRows) {
            await this.supabase
              .from("uid_registry")
              .update({
                status: (uidRow as any).status,
                location: (uidRow as any).location,
                lifecycle: (uidRow as any).lifecycle,
                metadata: (uidRow as any).metadata,
              } as any)
              .eq("tenant_id", tenantId)
              .eq("uid", (uidRow as any).uid);
          }
          await this.supabase
            .from("stock_movements")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("reference_type", "SRV")
            .eq("reference_id", stockEntry.id);
          if (inventoryAdjusted)
            await this.adjustInventoryStockWithFallback({
              tenantId,
              itemId,
              warehouseId,
              locationId: null,
              quantityChange: -returnQuantity,
              category: normalizeInventoryCategory(
                (item as any).category,
                "RAW_MATERIAL",
              ),
              context: {
                source: "MANUAL_SRV_RETURN_ROLLBACK",
                returnVoucherNumber,
              },
            });
          await this.supabase
            .from("stock_entries")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("id", stockEntry.id);
          throw new BadRequestException(
            error?.message || "Manual SRV return failed and was rolled back",
          );
        }

        return {
          returnVoucherNumber,
          sourceVoucherNumber,
          itemId,
          returnedByEmployeeId: employeeId,
          returnQuantity,
          condition,
          availableQuantityAdded: isAvailable ? returnQuantity : 0,
          quarantinedQuantity: isAvailable ? 0 : returnQuantity,
          uidCount: suppliedUids.length,
          message: `Manual SRV ${returnVoucherNumber} created successfully`,
        };
      },
    );
  }

  async updateStoreIssueVoucherHistoryRow(
    tenantId: string,
    movementId: string,
    details: { notes?: string; userId?: string },
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!movementId) throw new BadRequestException("movementId is required");

    const notes = String(details?.notes || "").trim();
    const { data: row, error } = await this.supabase
      .from("stock_movements")
      .select("id, reference_type")
      .eq("tenant_id", tenantId)
      .eq("id", movementId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!row) throw new NotFoundException("SIV history row not found");
    if (String((row as any)?.reference_type || "").trim() !== "SIV") {
      throw new BadRequestException("Not a SIV history row");
    }

    const { error: upErr } = await this.supabase
      .from("stock_movements")
      .update({ notes } as any)
      .eq("tenant_id", tenantId)
      .eq("id", movementId);

    if (upErr) throw new BadRequestException(upErr.message);
    return { id: movementId, message: "Updated" };
  }

  async approveStoreIssueVoucherHistoryRow(
    tenantId: string,
    movementId: string,
    userId?: string,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!movementId) throw new BadRequestException("movementId is required");

    const approver = String(userId || "").trim();
    if (!approver || !this.isUuid(approver)) {
      throw new BadRequestException("Valid userId is required to approve");
    }

    const { data: row, error } = await this.supabase
      .from("stock_movements")
      .select("id, reference_type, approved_at")
      .eq("tenant_id", tenantId)
      .eq("id", movementId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!row) throw new NotFoundException("SIV history row not found");
    if (String((row as any)?.reference_type || "").trim() !== "SIV") {
      throw new BadRequestException("Not a SIV history row");
    }
    if ((row as any)?.approved_at) {
      return { id: movementId, message: "Already approved" };
    }

    const { error: upErr } = await this.supabase
      .from("stock_movements")
      .update({
        approved_by: approver,
        approved_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", movementId);

    if (upErr) throw new BadRequestException(upErr.message);
    return { id: movementId, message: "Approved" };
  }

  async approveStoreIssueVoucherHistoryRows(
    tenantId: string,
    movementIds: string[],
    userId?: string,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");

    const approver = String(userId || "").trim();
    if (!approver || !this.isUuid(approver)) {
      throw new BadRequestException("Valid userId is required to approve");
    }

    const ids = Array.from(
      new Set(
        (Array.isArray(movementIds) ? movementIds : [])
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );
    if (ids.length === 0)
      throw new BadRequestException("Select at least one SIV entry to approve");

    const chunkSize = 75;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }

    const validRows: any[] = [];
    for (const chunk of chunks) {
      const { data: rows, error } = await this.supabase
        .from("stock_movements")
        .select("id, reference_type, approved_at")
        .eq("tenant_id", tenantId)
        .in("id", chunk);

      if (error) {
        throw new BadRequestException(
          `Failed to validate SIV entries: ${error.message}`,
        );
      }
      validRows.push(...(Array.isArray(rows) ? rows : []));
    }

    if (validRows.length !== ids.length) {
      throw new BadRequestException(
        "One or more selected SIV entries were not found",
      );
    }
    if (
      validRows.some(
        (row: any) => String(row?.reference_type || "").trim() !== "SIV",
      )
    ) {
      throw new BadRequestException(
        "One or more selected entries are not SIV history rows",
      );
    }

    const pendingIds = validRows
      .filter((row: any) => !row?.approved_at)
      .map((row: any) => String(row.id));
    if (pendingIds.length > 0) {
      const approvedAt = new Date().toISOString();
      for (let i = 0; i < pendingIds.length; i += chunkSize) {
        const chunk = pendingIds.slice(i, i + chunkSize);
        const { error: updateError } = await this.supabase
          .from("stock_movements")
          .update({ approved_by: approver, approved_at: approvedAt } as any)
          .eq("tenant_id", tenantId)
          .in("id", chunk);
        if (updateError) {
          throw new BadRequestException(
            `Failed to approve SIV entries: ${updateError.message}`,
          );
        }
      }
    }

    return {
      approved: pendingIds.length,
      alreadyApproved: ids.length - pendingIds.length,
      requested: ids.length,
      message: `${pendingIds.length} SIV entr${pendingIds.length === 1 ? "y" : "ies"} approved`,
    };
  }

  async deleteStoreIssueVoucherHistoryRow(
    tenantId: string,
    movementId: string,
    userId?: string,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!movementId) throw new BadRequestException("movementId is required");

    const { data: mv, error } = await this.supabase
      .from("stock_movements")
      .select(
        "id, reference_type, item_id, uid, from_warehouse_id, quantity, reference_id, reference_number, notes, approved_at",
      )
      .eq("tenant_id", tenantId)
      .eq("id", movementId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!mv) throw new NotFoundException("SIV history row not found");
    if (String((mv as any)?.reference_type || "").trim() !== "SIV") {
      throw new BadRequestException("Not a SIV history row");
    }
    if ((mv as any)?.approved_at) {
      throw new BadRequestException("Cannot delete an approved SIV row");
    }

    const itemId = String((mv as any)?.item_id || "").trim();
    const warehouseId = String((mv as any)?.from_warehouse_id || "").trim();
    const qty = Number((mv as any)?.quantity || 0);
    if (!itemId || !this.isUuid(itemId))
      throw new BadRequestException("Invalid item_id on movement");
    if (!warehouseId || !this.isUuid(warehouseId))
      throw new BadRequestException("Invalid from_warehouse_id on movement");
    if (!Number.isFinite(qty) || qty <= 0)
      throw new BadRequestException("Invalid quantity on movement");

    const { data: item, error: itemErr } = await this.supabase
      .from("items")
      .select("id, category")
      .eq("tenant_id", tenantId)
      .eq("id", itemId)
      .single();
    if (itemErr) throw new BadRequestException(itemErr.message);

    // Restore stock_entries (FIFO pool) and inventory_stock aggregate
    const { error: addErr } = await this.supabase.from("stock_entries").insert({
      tenant_id: tenantId,
      item_id: itemId,
      warehouse_id: warehouseId,
      quantity: qty,
      available_quantity: qty,
      allocated_quantity: 0,
      metadata: {
        created_from: "SIV_DELETE_REVERSAL",
        siv_movement_id: movementId,
        job_order_id: String((mv as any)?.reference_id || "").trim() || null,
        job_order_number:
          String((mv as any)?.reference_number || "").trim() || null,
        reversed_at: new Date().toISOString(),
        reversed_by: String(userId || "").trim() || null,
      },
    } as any);
    if (addErr) throw new BadRequestException(addErr.message);

    const { error: invErr } = await this.supabase.rpc(
      "adjust_inventory_stock",
      {
        p_tenant_id: tenantId,
        p_item_id: itemId,
        p_warehouse_id: warehouseId,
        p_location_id: null,
        p_quantity_change: qty,
        p_category: normalizeInventoryCategory(
          (item as any)?.category,
          "RAW_MATERIAL",
        ),
      },
    );
    if (invErr) throw new BadRequestException(invErr.message);

    // If UID-based movement, unconsume UID
    const uid = String((mv as any)?.uid || "").trim();
    if (uid) {
      const { data: uidRow, error: uidErr } = await this.supabase
        .from("uid_registry")
        .select("uid, lifecycle, metadata")
        .eq("tenant_id", tenantId)
        .eq("uid", uid)
        .maybeSingle();
      if (uidErr) throw new BadRequestException(uidErr.message);

      if (uidRow) {
        const rawLifecycle = (uidRow as any)?.lifecycle;
        const rawMetadata = (uidRow as any)?.metadata;
        const currentLifecycle = Array.isArray(rawLifecycle)
          ? rawLifecycle
          : rawLifecycle
            ? JSON.parse(String(rawLifecycle))
            : [];
        const currentMetadata =
          rawMetadata && typeof rawMetadata === "object"
            ? rawMetadata
            : rawMetadata
              ? JSON.parse(String(rawMetadata))
              : {};

        await this.supabase
          .from("uid_registry")
          .update({
            status: "IN_STOCK",
            location: "Warehouse",
            lifecycle: [
              ...currentLifecycle,
              {
                stage: "SIV_DELETED",
                timestamp: new Date().toISOString(),
                siv_movement_id: movementId,
                user: String(userId || "").trim() || null,
              },
            ],
            metadata: {
              ...currentMetadata,
              siv_deleted_at: new Date().toISOString(),
              siv_deleted_by: String(userId || "").trim() || null,
            },
          } as any)
          .eq("tenant_id", tenantId)
          .eq("uid", uid);
      }
    }

    // Reduce issued qty on material line (best-effort via parsing notes)
    const materialMatch = String((mv as any)?.notes || "").match(
      /material_id=([0-9a-fA-F-]{36})/,
    );
    const parsedMaterialId = materialMatch?.[1];
    if (parsedMaterialId && this.isUuid(parsedMaterialId)) {
      const { data: mat, error: matErr } = await this.supabase
        .from("job_order_materials")
        .select("id, required_quantity, issued_quantity")
        .eq("id", parsedMaterialId)
        .maybeSingle();
      if (!matErr && mat) {
        const required = Number((mat as any)?.required_quantity || 0);
        const issued = Number((mat as any)?.issued_quantity || 0);
        const nextIssued = Math.max(0, issued - qty);
        const nextStatus =
          nextIssued + 1e-9 >= required
            ? "ISSUED"
            : nextIssued > 0
              ? "PARTIAL"
              : "PENDING";
        await this.supabase
          .from("job_order_materials")
          .update({ issued_quantity: nextIssued, status: nextStatus } as any)
          .eq("id", parsedMaterialId);
      }
    }

    const { error: delErr } = await this.supabase
      .from("stock_movements")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", movementId);
    if (delErr) throw new BadRequestException(delErr.message);

    return { id: movementId, message: "Deleted and reversed" };
  }

  async updateStoreReceiptVoucherHistoryRow(
    tenantId: string,
    entryId: string,
    details: { receiverName?: string; receiverPhone?: string; userId?: string },
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!entryId) throw new BadRequestException("entryId is required");

    const { data: entry, error } = await this.supabase
      .from("stock_entries")
      .select("id, metadata")
      .eq("tenant_id", tenantId)
      .eq("id", entryId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!entry) throw new NotFoundException("SRV history row not found");

    const meta = (entry as any)?.metadata || {};
    if (String(meta?.created_from || "").trim() !== "STORE_RECEIPT") {
      throw new BadRequestException("Not a SRV history row");
    }

    const nextMeta = {
      ...meta,
      received_by_name:
        String(details?.receiverName || "").trim() ||
        meta?.received_by_name ||
        null,
      received_by_phone:
        String(details?.receiverPhone || "").trim() ||
        meta?.received_by_phone ||
        null,
      srv_updated_at: new Date().toISOString(),
      srv_updated_by: String(details?.userId || "").trim() || null,
    };

    const { error: upErr } = await this.supabase
      .from("stock_entries")
      .update({ metadata: nextMeta } as any)
      .eq("tenant_id", tenantId)
      .eq("id", entryId);
    if (upErr) throw new BadRequestException(upErr.message);

    return { id: entryId, message: "Updated" };
  }

  async approveStoreReceiptVoucherHistoryRow(
    tenantId: string,
    entryId: string,
    userId?: string,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!entryId) throw new BadRequestException("entryId is required");

    const approver = String(userId || "").trim();
    if (!approver || !this.isUuid(approver)) {
      throw new BadRequestException("Valid userId is required to approve");
    }

    // UI may pass either stock_entries.id (history row) OR production_job_orders.id (open tab).
    let resolved = await this.resolveStoreReceiptVoucherEntry(
      tenantId,
      entryId,
    );
    if (!resolved) {
      // If no SRV row exists yet, auto-receive to create it, then approve.
      await this.receiveStoreReceiptVoucher(tenantId, entryId, userId, {
        receiverName: "SYSTEM",
      });
      resolved = await this.resolveStoreReceiptVoucherEntry(tenantId, entryId);
    }
    if (!resolved) throw new NotFoundException("SRV history row not found");

    const meta = resolved.metadata || {};
    if (String(meta?.created_from || "").trim() !== "STORE_RECEIPT") {
      throw new BadRequestException("Not a SRV history row");
    }

    const nextMeta = {
      ...meta,
      srv_approved_by: approver,
      srv_approved_at: new Date().toISOString(),
    };

    const { error: upErr } = await this.supabase
      .from("stock_entries")
      .update({ metadata: nextMeta } as any)
      .eq("tenant_id", tenantId)
      .eq("id", resolved.id);
    if (upErr) throw new BadRequestException(upErr.message);

    return { id: resolved.id, message: "Approved" };
  }

  async deleteStoreReceiptVoucherHistoryRow(
    tenantId: string,
    entryId: string,
    userId?: string,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");
    if (!entryId) throw new BadRequestException("entryId is required");

    const resolved = await this.resolveStoreReceiptVoucherEntry(
      tenantId,
      entryId,
    );
    if (!resolved) throw new NotFoundException("SRV history row not found");

    const { data: entry, error } = await this.supabase
      .from("stock_entries")
      .select("id, available_quantity, metadata")
      .eq("tenant_id", tenantId)
      .eq("id", resolved.id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!entry) throw new NotFoundException("SRV history row not found");

    const meta = (entry as any)?.metadata || {};
    if (String(meta?.created_from || "").trim() !== "STORE_RECEIPT") {
      throw new BadRequestException("Not a SRV history row");
    }

    const approvedUids = Array.isArray(meta?.approved_uids)
      ? meta.approved_uids
      : [];
    if (
      approvedUids.length > 0 ||
      Number((entry as any)?.available_quantity || 0) > 0
    ) {
      throw new BadRequestException(
        "Cannot delete SRV after QC release has started",
      );
    }

    const receivedUids = Array.isArray(meta?.received_uids)
      ? meta.received_uids
      : [];
    const safeUids = receivedUids
      .map((u: any) => String(u || "").trim())
      .filter(Boolean);

    // Revert UID location back to Store (best effort)
    if (safeUids.length > 0) {
      const { data: uidRows, error: uidErr } = await this.supabase
        .from("uid_registry")
        .select("uid, lifecycle, metadata")
        .eq("tenant_id", tenantId)
        .in("uid", safeUids);
      if (uidErr) throw new BadRequestException(uidErr.message);

      for (const row of uidRows || []) {
        const uid = String((row as any)?.uid || "").trim();
        if (!uid) continue;

        const rawLifecycle = (row as any)?.lifecycle;
        const rawMetadata = (row as any)?.metadata;
        const currentLifecycle = Array.isArray(rawLifecycle)
          ? rawLifecycle
          : rawLifecycle
            ? JSON.parse(String(rawLifecycle))
            : [];
        const currentMetadata =
          rawMetadata && typeof rawMetadata === "object"
            ? rawMetadata
            : rawMetadata
              ? JSON.parse(String(rawMetadata))
              : {};

        await this.supabase
          .from("uid_registry")
          .update({
            location: "Store",
            lifecycle: [
              ...currentLifecycle,
              {
                stage: "SRV_DELETED",
                timestamp: new Date().toISOString(),
                srv_entry_id: resolved.id,
                user: String(userId || "").trim() || null,
              },
            ],
            metadata: {
              ...currentMetadata,
              srv_deleted_at: new Date().toISOString(),
              srv_deleted_by: String(userId || "").trim() || null,
            },
          } as any)
          .eq("tenant_id", tenantId)
          .eq("uid", uid);
      }
    }

    const { error: delErr } = await this.supabase
      .from("stock_entries")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", resolved.id);
    if (delErr) throw new BadRequestException(delErr.message);

    return { id: resolved.id, message: "Deleted" };
  }

  async receiveStoreReceiptVoucher(
    tenantId: string,
    jobOrderId: string,
    userId?: string,
    details?: {
      receiverName?: string;
      receiverPhone?: string;
      receivedQuantity?: number;
    },
  ) {
    const { data: jobOrder, error: jobError } = await this.supabase
      .from("production_job_orders")
      .select(
        "id, tenant_id, item_id, item_code, item_name, job_order_number, status, quantity, completed_quantity",
      )
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (jobError) throw new BadRequestException(jobError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const status = String(jobOrder.status || "").toUpperCase();
    if (!SRV_RECEIVABLE_JOB_ORDER_STATUSES.includes(status as any)) {
      throw new BadRequestException(
        "SRV is allowed only for IN_PROGRESS / STORE_ISSUED / COMPLETED / STOPPED job orders",
      );
    }

    const completedQty = Number((jobOrder as any)?.completed_quantity);
    const plannedQty = Number((jobOrder as any)?.quantity);
    const producedQty =
      status === JOB_ORDER_STATUS.STOPPED ||
      status === JOB_ORDER_STATUS.IN_PROGRESS
        ? Math.max(0, Number.isFinite(completedQty) ? completedQty : 0)
        : Math.max(
            0,
            Number.isFinite(completedQty)
              ? completedQty
              : Number.isFinite(plannedQty)
                ? plannedQty
                : 0,
          );
    if (producedQty <= 0) {
      throw new BadRequestException(
        "No produced quantity available for SRV receipt. Record partial production before receiving SRV.",
      );
    }

    const { data: existingReceipts, error: existingError } = await this.supabase
      .from("stock_entries")
      .select("id, quantity, metadata, created_at")
      .eq("tenant_id", tenantId)
      .eq("metadata->>created_from", "STORE_RECEIPT")
      .eq("metadata->>job_order_id", jobOrderId);

    if (existingError) throw new BadRequestException(existingError.message);

    const alreadyReceivedQty = (existingReceipts || []).reduce(
      (sum: number, e: any) => sum + (Number(e?.quantity || 0) || 0),
      0,
    );
    const pendingQty = Math.max(0, producedQty - alreadyReceivedQty);
    if (pendingQty <= 0) {
      return {
        jobOrderId,
        jobOrderNumber: jobOrder.job_order_number,
        receivedQuantity: 0,
        pendingReceipt: 0,
        message: "No pending SRV quantity for this job order",
      };
    }

    const requestedQty = Number((details as any)?.receivedQuantity);
    const receiveQty =
      Number.isFinite(requestedQty) && requestedQty > 0
        ? requestedQty
        : pendingQty;
    if (receiveQty <= 0) {
      throw new BadRequestException("receivedQuantity must be > 0");
    }
    if (receiveQty - pendingQty > 1e-9) {
      throw new BadRequestException(
        `Cannot receive more than pending quantity. Pending=${pendingQty}, requested=${receiveQty}`,
      );
    }

    const { data: warehouses, error: whError } = await this.supabase
      .from("warehouses")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1);

    if (whError) throw new BadRequestException(whError.message);
    if (!warehouses || warehouses.length === 0) {
      throw new BadRequestException("No warehouse configured");
    }
    const warehouseId = warehouses[0].id;

    const { error: addError } = await this.supabase
      .from("stock_entries")
      .insert({
        tenant_id: tenantId,
        item_id: jobOrder.item_id,
        warehouse_id: warehouseId,
        quantity: receiveQty,
        // SRV is GRN-like receipt into QC-hold: stock becomes AVAILABLE only after QC approval.
        available_quantity: 0,
        allocated_quantity: 0,
        metadata: {
          created_from: "STORE_RECEIPT",
          job_order_id: jobOrderId,
          job_order_number: jobOrder.job_order_number,
          received_uids: [],
          received_by: userId || null,
          received_by_name: String(details?.receiverName || "").trim() || null,
          received_by_phone:
            String(details?.receiverPhone || "").trim() || null,
          received_at: new Date().toISOString(),
          approved_uids: [],
        },
      });

    if (addError) {
      throw new BadRequestException(
        `Failed to add stock receipt: ${addError.message}`,
      );
    }

    return {
      jobOrderId,
      jobOrderNumber: jobOrder.job_order_number,
      receivedQuantity: receiveQty,
      pendingReceipt: Math.max(0, pendingQty - receiveQty),
      message: `SRV received: ${receiveQty} unit(s) received to QC-hold (UIDs will be generated after QC)`,
    };
  }

  async getStoreReceiptVoucherHistory(tenantId: string) {
    const { data: entries, error } = await this.supabase
      .from("stock_entries")
      .select(
        "id, item_id, warehouse_id, quantity, available_quantity, created_at, metadata",
      )
      .eq("tenant_id", tenantId)
      .or(
        "metadata->>created_from.eq.STORE_RECEIPT,metadata->>created_from.eq.MANUAL_SRV",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new BadRequestException(error.message);

    const safe = Array.isArray(entries) ? entries : [];
    const itemIds = Array.from(
      new Set(
        safe.map((e: any) => String(e?.item_id || "").trim()).filter(Boolean),
      ),
    );
    const itemById = new Map<string, { code?: string; name?: string }>();

    if (itemIds.length > 0) {
      const { data: items, error: itemError } = await this.supabase
        .from("items")
        .select("id, code, name")
        .eq("tenant_id", tenantId)
        .in("id", itemIds);
      if (itemError) throw new BadRequestException(itemError.message);
      for (const it of items || []) {
        itemById.set(String((it as any)?.id), {
          code: (it as any)?.code,
          name: (it as any)?.name,
        });
      }
    }

    return safe.map((e: any) => {
      const meta = (e as any)?.metadata || {};
      const itemInfo = itemById.get(String((e as any)?.item_id || "")) || {};
      const receivedUids = Array.isArray(meta?.received_uids)
        ? meta.received_uids
        : [];
      const approvedUids = Array.isArray(meta?.approved_uids)
        ? meta.approved_uids
        : [];
      const uidSummary = this.summarizeStoreReceiptUids(meta);
      return {
        id: e.id,
        entry_id: e.id,
        job_order_id: meta?.job_order_id || null,
        job_order_number: meta?.job_order_number || null,
        item_id: e.item_id,
        item_code: itemInfo.code || null,
        item_name: itemInfo.name || null,
        uid: uidSummary,
        quantity: Number(e.quantity || 0),
        to_warehouse_id: (e as any)?.warehouse_id || null,
        movement_date: meta?.received_at || e.created_at || null,
        received_by: meta?.received_by_name || meta?.received_by || null,
        approved_by: meta?.srv_approved_by || null,
        approved_at: meta?.srv_approved_at || null,
        notes: meta?.notes || null,

        // Keep extended fields for other UI consumers (ignored by current SRV page)
        received_quantity: Number(e.quantity || 0),
        available_quantity: Number(e.available_quantity || 0),
        received_at: meta?.received_at || e.created_at || null,
        received_by_name: meta?.received_by_name || null,
        received_by_phone: meta?.received_by_phone || null,
        srv_approved_by: meta?.srv_approved_by || null,
        srv_approved_at: meta?.srv_approved_at || null,
        received_uids: receivedUids,
        approved_uids: approvedUids,
      };
    });
  }

  async getQcSummary(tenantId: string, jobOrderId: string) {
    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select("id, tenant_id, item_id, job_order_number, quantity, status")
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    const { data: qcStockEntries, error: qcStockError } = await this.supabase
      .from("stock_entries")
      .select("id, quantity, available_quantity, metadata, created_at")
      .eq("tenant_id", tenantId)
      .eq("item_id", jobOrder.item_id)
      .eq("metadata->>job_order_id", jobOrderId);

    if (qcStockError) throw new BadRequestException(qcStockError.message);

    const entries = Array.isArray(qcStockEntries) ? qcStockEntries : [];

    const srvEntries = entries.filter((e: any) => {
      const from = String(
        (e as any)?.metadata?.created_from || "",
      ).toUpperCase();
      return from === "STORE_RECEIPT";
    });
    const srvReceivedQuantity = srvEntries.reduce(
      (sum: number, e: any) => sum + (Number(e?.quantity) || 0),
      0,
    );
    const latestSrvMeta =
      srvEntries
        .slice()
        .sort(
          (a: any, b: any) =>
            Date.parse(String(a?.created_at || 0)) -
            Date.parse(String(b?.created_at || 0)),
        )
        .map((e: any) => (e as any)?.metadata || {})
        .pop() || {};
    // With SRV-first flow, STORE_RECEIPT quantity is received-to-QC and does not mean available stock.
    // Use available_quantity (or approved_uids) to represent released-to-stock.
    const stockAdded = entries
      .filter((e: any) => {
        const from = String(
          (e as any)?.metadata?.created_from || "",
        ).toUpperCase();
        return from === "STORE_RECEIPT" || from === "QC_APPROVAL";
      })
      .reduce((sum, e: any) => sum + (Number(e?.available_quantity) || 0), 0);

    const qcAppliedAt = entries.reduce<string | null>((latest, e: any) => {
      const raw = e?.created_at;
      if (!raw) return latest;
      const ts = Date.parse(String(raw));
      if (Number.isNaN(ts)) return latest;

      if (!latest) return String(raw);
      const latestTs = Date.parse(String(latest));
      if (Number.isNaN(latestTs)) return String(raw);
      return ts > latestTs ? String(raw) : latest;
    }, null);

    const approvedUidSet = new Set<string>();
    for (const e of entries) {
      const approved = (e as any)?.metadata?.approved_uids;
      const received = (e as any)?.metadata?.received_uids;
      const merged = [
        ...(Array.isArray(approved) ? approved : []),
        ...(Array.isArray(received) ? received : []),
      ];
      if (merged.length > 0) {
        for (const u of merged) {
          const s = String(u || "").trim();
          if (s) approvedUidSet.add(s);
        }
      }
    }

    // Also summarize UID quality statuses (PASS/FAIL/PENDING)
    const { data: uidRows, error: uidError } = await this.supabase
      .from("uid_registry")
      .select("quality_status")
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId);

    if (uidError) throw new BadRequestException(uidError.message);

    const uidList = Array.isArray(uidRows) ? uidRows : [];
    const totalUidsCount = uidList.length;
    const passedUidsCount = uidList.filter(
      (u: any) => String(u?.quality_status || "").toUpperCase() === "PASSED",
    ).length;
    const rejectedUidsCount = uidList.filter((u: any) => {
      const status = String(u?.quality_status || "").toUpperCase();
      return status === "ON_HOLD" || status === "FAILED";
    }).length;
    const pendingUidsCount = Math.max(
      0,
      totalUidsCount - passedUidsCount - rejectedUidsCount,
    );

    return {
      jobOrderId: jobOrder.id,
      jobOrderNumber: jobOrder.job_order_number,
      status: jobOrder.status,
      qcStockEntriesCount: entries.length,
      stockAdded,
      approvedUidsCount: approvedUidSet.size,
      isQcApplied: entries.length > 0,
      qcAppliedAt,
      totalUidsCount,
      passedUidsCount,
      rejectedUidsCount,
      pendingUidsCount,
      srvReceivedQuantity,
      srvApprovedAt: latestSrvMeta?.srv_approved_at || null,
      srvApprovedBy: latestSrvMeta?.srv_approved_by || null,
    };
  }

  async getCompletionPreview(tenantId: string, jobOrderId: string) {
    // Get job order first (avoid masking embed errors as NotFound)
    const { data: jobOrder, error: jobOrderError } = await this.supabase
      .from("production_job_orders")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (jobOrderError) throw new BadRequestException(jobOrderError.message);
    if (!jobOrder) throw new NotFoundException("Job order not found");

    // Get materials (no embeds; item joins can be ambiguous when multiple FKs exist)
    const { data: materialsRaw, error: materialsError } = await this.supabase
      .from("job_order_materials")
      .select(
        "id, item_id, selected_variant_id, required_quantity, issued_quantity, status",
      )
      .eq("job_order_id", jobOrderId);

    if (materialsError) throw new BadRequestException(materialsError.message);
    let materialsList = Array.isArray(materialsRaw) ? materialsRaw : [];
    try {
      materialsList = await this.normalizeJobOrderMaterialRows(
        tenantId,
        materialsList,
      );
    } catch (e: any) {
      console.warn(
        "[getCompletionPreview] Material normalization failed:",
        e?.message || e,
      );
    }

    const itemIds = Array.from(
      new Set(
        [
          jobOrder.item_id,
          ...materialsList.map(
            (m: any) => m?.selected_variant_id || m?.item_id,
          ),
        ]
          .map((v) => String(v || "").trim())
          .filter(Boolean),
      ),
    );

    // Fetch item details in one shot
    const { data: items, error: itemsError } = itemIds.length
      ? await this.supabase
          .from("items")
          .select("id, code, name")
          .in("id", itemIds)
      : { data: [], error: null };

    if (itemsError) throw new BadRequestException(itemsError.message);
    const itemById = new Map<string, { code: string; name: string }>();
    (items || []).forEach((it: any) => {
      if (it?.id) itemById.set(String(it.id), { code: it.code, name: it.name });
    });

    // Fetch stock summaries from both sources:
    // - stock_entries: used for FIFO consumption
    // - inventory_stock: used by the Inventory module & reservations
    // Some legacy flows update only inventory_stock (e.g. manual adjustments). To avoid false
    // shortages blocking job completion, the preview will use the higher of the two totals.
    const [
      { data: stockEntries, error: stockError },
      { data: invStock, error: invError },
    ] = itemIds.length
      ? await Promise.all([
          this.supabase
            .from("stock_entries")
            .select("item_id, available_quantity, allocated_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", itemIds),
          this.supabase
            .from("inventory_stock")
            .select("item_id, available_quantity, reserved_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", itemIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];

    if (stockError) throw new BadRequestException(stockError.message);
    if (invError) throw new BadRequestException(invError.message);

    const stockByItemId = new Map<
      string,
      {
        available: number;
        allocated: number;
        invAvailable: number;
        invReserved: number;
      }
    >();

    for (const entry of stockEntries || []) {
      const itemId = String((entry as any)?.item_id || "").trim();
      if (!itemId) continue;
      const prev = stockByItemId.get(itemId) || {
        available: 0,
        allocated: 0,
        invAvailable: 0,
        invReserved: 0,
      };
      prev.available +=
        parseFloat(String((entry as any)?.available_quantity ?? "0")) || 0;
      prev.allocated +=
        parseFloat(String((entry as any)?.allocated_quantity ?? "0")) || 0;
      stockByItemId.set(itemId, prev);
    }

    for (const row of invStock || []) {
      const itemId = String((row as any)?.item_id || "").trim();
      if (!itemId) continue;
      const prev = stockByItemId.get(itemId) || {
        available: 0,
        allocated: 0,
        invAvailable: 0,
        invReserved: 0,
      };
      prev.invAvailable +=
        parseFloat(String((row as any)?.available_quantity ?? "0")) || 0;
      prev.invReserved +=
        parseFloat(String((row as any)?.reserved_quantity ?? "0")) || 0;
      stockByItemId.set(itemId, prev);
    }

    const finishedItemId = String(jobOrder.item_id || "").trim();
    const finishedItem = itemById.get(finishedItemId);
    const finishedStock = stockByItemId.get(finishedItemId) || {
      available: 0,
      allocated: 0,
      invAvailable: 0,
      invReserved: 0,
    };

    const quantityToAdd = Number(jobOrder.quantity) || 0;
    const currentFinishedStock = Math.max(
      Number(finishedStock.available) || 0,
      Number(finishedStock.invAvailable) || 0,
    );
    const newFinishedStock = currentFinishedStock + quantityToAdd;

    const materialsToConsume = materialsList.map((material: any) => {
      const materialItemId = String(
        material?.selected_variant_id || material?.item_id || "",
      ).trim();
      const materialItem = itemById.get(materialItemId);
      const materialStock = stockByItemId.get(materialItemId) || {
        available: 0,
        allocated: 0,
        invAvailable: 0,
        invReserved: 0,
      };
      const requiredQty = Number(material?.required_quantity) || 0;
      const alreadyIssued = Number(material?.issued_quantity) || 0;
      const pendingIssue = Math.max(0, requiredQty - alreadyIssued);
      const toConsume = Math.min(requiredQty, alreadyIssued);
      const currentStock = Math.max(
        Number(materialStock.available) || 0,
        Number(materialStock.invAvailable) || 0,
      );
      const reservedStock = Math.max(
        Number(materialStock.allocated) || 0,
        Number(materialStock.invReserved) || 0,
      );
      const newStock = currentStock;
      const status =
        pendingIssue <= 0.0001 ? "READY_TO_BACKFLUSH" : "SIV_PENDING";
      return {
        itemId: materialItemId,
        itemCode: materialItem?.code || "Unknown",
        itemName: materialItem?.name || "Unknown",
        requiredQty,
        alreadyIssued,
        toConsume,
        pendingIssue,
        currentStock,
        reservedStock,
        newStock,
        autoBuildable: false,
        autoBuildQuantity: 0,
        status,
        sufficient: pendingIssue <= 0.0001,
        // Diagnostic fields (safe to ignore on UI)
        _sources: {
          stock_entries_available: materialStock.available,
          inventory_stock_available: materialStock.invAvailable,
          stock_entries_reserved: materialStock.allocated,
          inventory_stock_reserved: materialStock.invReserved,
        },
      };
    });

    const autoBuildMaterials: any[] = [];

    return {
      jobOrderId,
      jobOrderNumber: jobOrder.job_order_number,
      finishedProduct: {
        itemCode: finishedItem?.code || "Unknown",
        itemName: finishedItem?.name || "Unknown",
        quantityToAdd,
        currentStock: currentFinishedStock,
        newStock: newFinishedStock,
      },
      materialsToConsume,
      autoBuildMaterials,
      canComplete: materialsToConsume.every((m) => m.sufficient),
      insufficientMaterials: materialsToConsume.filter((m) => !m.sufficient),
    };
  }

  private toStartDate(value?: string): string {
    if (value && value.trim()) return value;
    return new Date().toISOString().slice(0, 10);
  }

  private async getItemBasic(itemId: string): Promise<{
    id: string;
    code: string;
    name: string;
    category?: string | null;
    uid_strategy?: string | null;
  } | null> {
    const { data } = await this.supabase
      .from("items")
      .select("id, code, name, category, uid_strategy")
      .eq("id", itemId)
      .single();
    return data || null;
  }

  private async getAvailableStock(
    tenantId: string,
    itemId: string,
  ): Promise<number> {
    // IMPORTANT:
    // - Job completion consumes from stock_entries FIFO.
    // - Inventory adjustments/movements (legacy) may update only inventory_stock.
    // If inventory_stock shows more available than stock_entries, we opportunistically
    // top-up stock_entries so completion doesn't get blocked by a drift.
    await this.ensureStockEntriesAtLeastInventoryAvailable(tenantId, itemId);

    const { data: entries, error } = await this.supabase
      .from("stock_entries")
      .select("available_quantity")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .gt("available_quantity", 0);

    if (error) throw new BadRequestException(error.message);

    const safe = Array.isArray(entries) ? entries : [];
    return safe.reduce(
      (sum: number, e: any) => sum + (Number(e?.available_quantity) || 0),
      0,
    );
  }

  private async ensureStockEntriesAtLeastInventoryAvailable(
    tenantId: string,
    itemId: string,
  ): Promise<void> {
    const formatErr = (err: any, location: string) => {
      const message = String(err?.message || "").trim();
      const details = String(err?.details || "").trim();
      const hint = String(err?.hint || "").trim();
      const code = String(err?.code || "").trim();
      const parts = [message, details, hint].filter(Boolean);
      const joined = parts.join(" | ");
      const base = code
        ? `${joined}${joined ? ` (code=${code})` : `code=${code}`}`
        : joined;
      return (
        base || `Supabase error at ${location} (raw: ${JSON.stringify(err)})`
      );
    };

    // If inventory_stock indicates stock exists but stock_entries does not, create a synthetic
    // stock_entries row so FIFO consumption can proceed.
    // This is intentionally one-way (we only ever increase stock_entries to match inventory_stock).
    const [
      { data: invRows, error: invErr },
      { data: entryRows, error: entryErr },
    ] = await Promise.all([
      this.supabase
        .from("inventory_stock")
        .select("warehouse_id, available_quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId),
      this.supabase
        .from("stock_entries")
        .select("available_quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .gt("available_quantity", 0),
    ]);

    if (invErr)
      throw new BadRequestException(
        formatErr(invErr, "ensureStock:inventory_stock"),
      );
    if (entryErr)
      throw new BadRequestException(
        formatErr(entryErr, "ensureStock:stock_entries"),
      );

    const invList = Array.isArray(invRows) ? invRows : [];
    const invAvailable = invList.reduce(
      (sum: number, r: any) => sum + (Number(r?.available_quantity) || 0),
      0,
    );

    const entryList = Array.isArray(entryRows) ? entryRows : [];
    const entriesAvailable = entryList.reduce(
      (sum: number, r: any) => sum + (Number(r?.available_quantity) || 0),
      0,
    );

    const delta = Math.max(0, invAvailable - entriesAvailable);
    if (delta <= 0.0001) return;

    // DISABLED: This reconcile logic was creating duplicate stock entries.
    // When inventory_stock is corrupted (doubled), it adds synthetic entries,
    // which then makes the next reconcile add even more. Creates infinite loop.
    // TODO: Implement proper fix that rebuilds inventory_stock from stock_entries instead.
    console.warn(
      "[StockReconcile] SKIPPED - Disabled due to duplicate entry bug",
      {
        tenantId,
        itemId,
        invAvailable,
        entriesAvailable,
        delta,
        message:
          "Manual cleanup required: inventory_stock should be rebuilt from stock_entries, not the reverse",
      },
    );
    return;

    /*
    const best = invList
      .filter((r: any) => this.isUuid(String(r?.warehouse_id || '')))
      .sort((a: any, b: any) => (Number(b?.available_quantity) || 0) - (Number(a?.available_quantity) || 0))[0];

    const warehouseId = String(best?.warehouse_id || '').trim();
    if (!warehouseId || !this.isUuid(warehouseId)) return;

    console.warn('[StockReconcile] inventory_stock > stock_entries; inserting synthetic stock entry', {
      tenantId,
      itemId,
      invAvailable,
      entriesAvailable,
      delta,
      warehouseId,
    });

    const { error: insertErr } = await this.supabase
      .from('stock_entries')
      .insert({
        tenant_id: tenantId,
        item_id: itemId,
        warehouse_id: warehouseId,
        quantity: delta,
        available_quantity: delta,
        allocated_quantity: 0,
        unit_price: 0,
        metadata: {
          reconciled_from_inventory_stock: true,
          reason: 'inventory_stock showed more available than stock_entries',
          inv_available: invAvailable,
          entries_available: entriesAvailable,
          reconciled_at: new Date().toISOString(),
        },
      });
    */

    // Error handling disabled along with reconcile logic above
    // if (insertErr) {
    //   console.error('[StockReconcile] Failed inserting synthetic stock entry', {
    //     tenantId, itemId, warehouseId, delta,
    //     error: formatErr(insertErr, 'ensureStock:insert'),
    //   });
    // }
  }

  private async normalizeJobOrderMaterialRows(
    tenantId: string,
    materials: any[],
  ): Promise<any[]> {
    const safeMaterials = Array.isArray(materials) ? materials : [];
    if (safeMaterials.length === 0) return safeMaterials;

    const candidateIds = new Set<string>();
    for (const m of safeMaterials) {
      const itemId = String(m?.item_id || "").trim();
      const variantId = String(m?.selected_variant_id || "").trim();
      if (itemId && this.isUuid(itemId)) candidateIds.add(itemId);
      if (variantId && this.isUuid(variantId)) candidateIds.add(variantId);
    }

    const idList = Array.from(candidateIds);
    if (idList.length === 0) return safeMaterials;

    const { data: existingItems } = await this.supabase
      .from("items")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", idList);

    const existingItemIds = new Set(
      (existingItems || [])
        .map((r: any) => String(r?.id || "").trim())
        .filter(Boolean),
    );

    const missingIds = idList.filter((id) => !existingItemIds.has(id));
    if (missingIds.length === 0) return safeMaterials;

    const { data: bomHeaders } = await this.supabase
      .from("bom_headers")
      .select("id, item_id")
      .eq("tenant_id", tenantId)
      .in("id", missingIds);

    const headerIdToItemId = new Map<string, string>();
    for (const h of bomHeaders || []) {
      const headerId = String((h as any)?.id || "").trim();
      const mappedItemId = String((h as any)?.item_id || "").trim();
      if (headerId && mappedItemId && this.isUuid(mappedItemId)) {
        headerIdToItemId.set(headerId, mappedItemId);
      }
    }

    if (headerIdToItemId.size === 0) return safeMaterials;

    const nextMaterials = safeMaterials.map((m: any) => {
      const currentItemId = String(m?.item_id || "").trim();
      const currentVariantId = String(m?.selected_variant_id || "").trim();
      const mappedItemId = currentItemId
        ? headerIdToItemId.get(currentItemId)
        : undefined;
      const mappedVariantId = currentVariantId
        ? headerIdToItemId.get(currentVariantId)
        : undefined;
      return {
        ...m,
        item_id: mappedItemId || m.item_id,
        selected_variant_id: mappedVariantId || m.selected_variant_id,
      };
    });

    for (let i = 0; i < safeMaterials.length; i += 1) {
      const before = safeMaterials[i];
      const after = nextMaterials[i];
      const patch: any = {};

      const beforeItemId = String(before?.item_id || "").trim();
      const afterItemId = String(after?.item_id || "").trim();
      const beforeVariantId = String(before?.selected_variant_id || "").trim();
      const afterVariantId = String(after?.selected_variant_id || "").trim();

      if (afterItemId && afterItemId !== beforeItemId)
        patch.item_id = afterItemId;
      if (afterVariantId !== beforeVariantId)
        patch.selected_variant_id = afterVariantId || null;

      if (Object.keys(patch).length) {
        await this.supabase
          .from("job_order_materials")
          .update(patch)
          .eq("id", before.id);
      }
    }

    return nextMaterials;
  }

  private async getActiveBomForItem(
    tenantId: string,
    itemId: string,
  ): Promise<any | null> {
    // Prefer active BOM. If is_active is not present or no active exists, fall back to latest version.
    const { data: active } = await this.supabase
      .from("bom_headers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1);

    if (Array.isArray(active) && active.length > 0) return active[0];

    const { data: latest } = await this.supabase
      .from("bom_headers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .order("version", { ascending: false })
      .limit(1);

    if (Array.isArray(latest) && latest.length > 0) return latest[0];
    return null;
  }

  private async getBomById(
    tenantId: string,
    bomId: string,
  ): Promise<any | null> {
    const { data } = await this.supabase
      .from("bom_headers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", bomId)
      .single();
    return data || null;
  }

  private async getBomItems(bomId: string): Promise<any[]> {
    const { data } = await this.supabase
      .from("bom_items")
      .select("*")
      .eq("bom_id", bomId)
      .order("sequence", { ascending: true });
    return Array.isArray(data) ? data : [];
  }

  private async getActiveBomForItemCached(
    tenantId: string,
    itemId: string,
    cache: Map<string, any | null>,
  ): Promise<any | null> {
    if (cache.has(itemId)) return cache.get(itemId) || null;
    const bom = await this.getActiveBomForItem(tenantId, itemId);
    cache.set(itemId, bom || null);
    return bom || null;
  }

  private async getBomItemsCached(
    bomId: string,
    cache: Map<string, any[]>,
  ): Promise<any[]> {
    const cached = cache.get(bomId);
    if (cached) return cached;
    const rows = await this.getBomItems(bomId);
    cache.set(bomId, rows);
    return rows;
  }

  private async getAvailableStockForPreview(
    tenantId: string,
    itemId: string,
  ): Promise<number> {
    // Preview must be fast and side-effect free. The actual SIV/JO posting path still performs
    // strict FIFO checks. For planning, show the best available ledger figure without running
    // stock-entry reconciliation for every BOM node.
    const [entryRes, inventoryRes] = await Promise.all([
      this.supabase
        .from("stock_entries")
        .select("available_quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .gt("available_quantity", 0),
      this.supabase
        .from("inventory_stock")
        .select("available_quantity")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId),
    ]);

    if (entryRes.error) throw new BadRequestException(entryRes.error.message);
    if (inventoryRes.error)
      throw new BadRequestException(inventoryRes.error.message);

    const entryAvailable = (
      Array.isArray(entryRes.data) ? entryRes.data : []
    ).reduce(
      (sum: number, row: any) => sum + (Number(row?.available_quantity) || 0),
      0,
    );
    const inventoryAvailable = (
      Array.isArray(inventoryRes.data) ? inventoryRes.data : []
    ).reduce(
      (sum: number, row: any) => sum + (Number(row?.available_quantity) || 0),
      0,
    );

    return Math.max(entryAvailable, inventoryAvailable);
  }

  private chunkArray<T>(items: T[], size = 500): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private pickBetterBomForPreview(
    current: any | null | undefined,
    candidate: any,
  ): any {
    if (!current) return candidate;
    const currentActive = Boolean(current?.is_active);
    const candidateActive = Boolean(candidate?.is_active);
    if (candidateActive !== currentActive)
      return candidateActive ? candidate : current;
    const currentVersion = Number(current?.version || 0);
    const candidateVersion = Number(candidate?.version || 0);
    return candidateVersion > currentVersion ? candidate : current;
  }

  private async loadSmartPreviewCaches(
    tenantId: string,
    finishedItem: any,
    topBom: any,
  ): Promise<{
    itemById: Map<string, any>;
    stockByItemId: Map<string, number>;
    scheduledSupplyByItemId: Map<string, number>;
    bomById: Map<string, any>;
    activeBomByItemId: Map<string, any | null>;
    bomItemsByBomId: Map<string, any[]>;
  }> {
    const caches = {
      itemById: new Map<string, any>([[String(finishedItem.id), finishedItem]]),
      stockByItemId: new Map<string, number>(),
      scheduledSupplyByItemId: new Map<string, number>(),
      bomById: new Map<string, any>([[String(topBom.id), topBom]]),
      activeBomByItemId: new Map<string, any | null>([
        [String(finishedItem.id), topBom],
      ]),
      bomItemsByBomId: new Map<string, any[]>(),
    };

    const queuedBomIds = new Set<string>([String(topBom.id)]);
    const loadedBomIds = new Set<string>();
    const discoveredItemIds = new Set<string>([String(finishedItem.id)]);
    let safetyRounds = 0;

    while (queuedBomIds.size > 0) {
      safetyRounds += 1;
      if (safetyRounds > this.smartPreviewMaxDepth + 5) {
        throw new BadRequestException(
          `BOM preload exceeded ${this.smartPreviewMaxDepth} levels. Please check for circular or unusually deep BOM data.`,
        );
      }

      const bomIdsToLoad = Array.from(queuedBomIds).filter(
        (bomId) => bomId && !loadedBomIds.has(bomId),
      );
      queuedBomIds.clear();
      if (bomIdsToLoad.length === 0) break;

      const bomItems: any[] = [];
      for (const chunk of this.chunkArray(bomIdsToLoad)) {
        const { data, error } = await this.supabase
          .from("bom_items")
          .select("*")
          .in("bom_id", chunk)
          .order("sequence", { ascending: true });
        if (error) throw new BadRequestException(error.message);
        bomItems.push(...(Array.isArray(data) ? data : []));
      }

      for (const bomId of bomIdsToLoad) loadedBomIds.add(bomId);

      const childBomIds = new Set<string>();
      const componentItemIds = new Set<string>();
      for (const row of bomItems) {
        const rowBomId = String(row?.bom_id || row?.bomId || "").trim();
        if (rowBomId) {
          const list = caches.bomItemsByBomId.get(rowBomId) || [];
          list.push(row);
          caches.bomItemsByBomId.set(rowBomId, list);
        }

        const itemId = String(row?.item_id || row?.itemId || "").trim();
        if (itemId) componentItemIds.add(itemId);

        const childBomId = String(
          row?.child_bom_id || row?.childBomId || "",
        ).trim();
        if (childBomId && !caches.bomById.has(childBomId))
          childBomIds.add(childBomId);
      }

      if (childBomIds.size > 0) {
        for (const chunk of this.chunkArray(Array.from(childBomIds))) {
          const { data, error } = await this.supabase
            .from("bom_headers")
            .select("*")
            .eq("tenant_id", tenantId)
            .in("id", chunk);
          if (error) throw new BadRequestException(error.message);
          for (const header of Array.isArray(data) ? data : []) {
            const bomId = String(header?.id || "").trim();
            const headerItemId = String(
              header?.item_id || header?.itemId || "",
            ).trim();
            if (bomId) {
              caches.bomById.set(bomId, header);
              if (!loadedBomIds.has(bomId)) queuedBomIds.add(bomId);
            }
            if (headerItemId) {
              discoveredItemIds.add(headerItemId);
              const existing = caches.activeBomByItemId.get(headerItemId);
              caches.activeBomByItemId.set(
                headerItemId,
                this.pickBetterBomForPreview(existing, header),
              );
            }
          }
        }
      }

      const activeLookupIds = Array.from(componentItemIds).filter(
        (itemId) => itemId && !caches.activeBomByItemId.has(itemId),
      );
      if (activeLookupIds.length > 0) {
        const foundActiveFor = new Set<string>();
        for (const chunk of this.chunkArray(activeLookupIds)) {
          const { data, error } = await this.supabase
            .from("bom_headers")
            .select("*")
            .eq("tenant_id", tenantId)
            .in("item_id", chunk)
            .order("version", { ascending: false });
          if (error) throw new BadRequestException(error.message);

          for (const header of Array.isArray(data) ? data : []) {
            const bomId = String(header?.id || "").trim();
            const headerItemId = String(
              header?.item_id || header?.itemId || "",
            ).trim();
            if (!bomId || !headerItemId) continue;
            foundActiveFor.add(headerItemId);
            caches.bomById.set(bomId, header);
            const existing = caches.activeBomByItemId.get(headerItemId);
            const better = this.pickBetterBomForPreview(existing, header);
            caches.activeBomByItemId.set(headerItemId, better);
            if (better?.id && !loadedBomIds.has(String(better.id)))
              queuedBomIds.add(String(better.id));
          }
        }

        for (const itemId of activeLookupIds) {
          if (
            !foundActiveFor.has(itemId) &&
            !caches.activeBomByItemId.has(itemId)
          ) {
            caches.activeBomByItemId.set(itemId, null);
          }
        }
      }

      for (const itemId of componentItemIds) discoveredItemIds.add(itemId);

      if (loadedBomIds.size > this.smartPreviewMaxNodes) {
        throw new BadRequestException(
          `BOM preload exceeded ${this.smartPreviewMaxNodes} BOM records. Please review duplicate/circular BOM data.`,
        );
      }
    }

    const itemIdList = Array.from(discoveredItemIds).filter(Boolean);
    for (const chunk of this.chunkArray(itemIdList)) {
      const { data, error } = await this.supabase
        .from("items")
        .select("id, code, name, category, uid_strategy")
        .eq("tenant_id", tenantId)
        .in("id", chunk);
      if (error) throw new BadRequestException(error.message);
      for (const item of Array.isArray(data) ? data : []) {
        if (item?.id) caches.itemById.set(String(item.id), item);
      }
    }

    const stockEntryTotals = new Map<string, number>();
    const inventoryTotals = new Map<string, number>();
    for (const chunk of this.chunkArray(itemIdList)) {
      const [entriesRes, inventoryRes] = await Promise.all([
        this.supabase
          .from("stock_entries")
          .select("item_id, available_quantity")
          .eq("tenant_id", tenantId)
          .in("item_id", chunk)
          .gt("available_quantity", 0),
        this.supabase
          .from("inventory_stock")
          .select("item_id, available_quantity")
          .eq("tenant_id", tenantId)
          .in("item_id", chunk),
      ]);

      if (entriesRes.error)
        throw new BadRequestException(entriesRes.error.message);
      if (inventoryRes.error)
        throw new BadRequestException(inventoryRes.error.message);

      for (const entry of Array.isArray(entriesRes.data)
        ? entriesRes.data
        : []) {
        const id = String(entry?.item_id || "").trim();
        if (!id) continue;
        stockEntryTotals.set(
          id,
          (stockEntryTotals.get(id) || 0) +
            (Number(entry?.available_quantity) || 0),
        );
      }
      for (const row of Array.isArray(inventoryRes.data)
        ? inventoryRes.data
        : []) {
        const id = String(row?.item_id || "").trim();
        if (!id) continue;
        inventoryTotals.set(
          id,
          (inventoryTotals.get(id) || 0) +
            (Number(row?.available_quantity) || 0),
        );
      }
    }

    for (const id of itemIdList) {
      caches.stockByItemId.set(
        id,
        Math.max(stockEntryTotals.get(id) || 0, inventoryTotals.get(id) || 0),
      );
    }

    // An already open build is scheduled supply. Count only its unfinished
    // balance so another Smart JO preview does not propose duplicate work.
    for (const chunk of this.chunkArray(itemIdList)) {
      const { data, error } = await this.supabase
        .from("production_job_orders")
        .select("item_id,quantity,completed_quantity,status")
        .eq("tenant_id", tenantId)
        .in("item_id", chunk);
      if (error) throw new BadRequestException(error.message);
      for (const order of Array.isArray(data) ? data : []) {
        if (
          ["COMPLETED", "CANCELLED", "CLOSED"].includes(
            String(order?.status || "").toUpperCase(),
          )
        )
          continue;
        const id = String(order?.item_id || "").trim();
        if (!id) continue;
        const openQuantity = Math.max(
          0,
          Number(order?.quantity || 0) - Number(order?.completed_quantity || 0),
        );
        caches.scheduledSupplyByItemId.set(
          id,
          (caches.scheduledSupplyByItemId.get(id) || 0) + openQuantity,
        );
      }
    }

    return caches;
  }

  private async getBomWithItemsAndRoutingForJobOrder(
    tenantId: string,
    bomId: string,
  ): Promise<any | null> {
    const { data: header, error: headerError } = await this.supabase
      .from("bom_headers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", bomId)
      .single();

    if (headerError) throw new BadRequestException(headerError.message);
    if (!header) return null;

    const [itemsRes, canonicalRoutingRes] = await Promise.all([
      this.supabase
        .from("bom_items")
        .select("*")
        .eq("bom_id", bomId)
        .order("sequence", { ascending: true }),
      this.supabase
        .from("production_routing")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("bom_id", bomId)
        .order("sequence_no", { ascending: true }),
    ]);

    if (itemsRes.error) throw new BadRequestException(itemsRes.error.message);
    if (canonicalRoutingRes.error)
      throw new BadRequestException(canonicalRoutingRes.error.message);

    let routes = (canonicalRoutingRes.data || []).map((route: any) => ({
      ...route,
      operation_sequence: route.sequence_no,
      workstation_id: route.work_station_id,
      cycle_time: Number(route.cycle_time_minutes || 0) / 60,
      setup_time: Number(route.setup_time_minutes || 0) / 60,
    }));
    // Compatibility for earlier BOM revisions. New setup and execution use
    // production_routing as the single canonical route. Promote legacy rows
    // before creating a Job Order so job_order_operations.routing_id always
    // satisfies its FK to production_routing and remains executable on the
    // shop floor.
    if (!routes.length) {
      const legacy = await this.supabase
        .from("bom_routing")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("bom_id", bomId)
        .order("operation_sequence", { ascending: true });
      if (legacy.error) throw new BadRequestException(legacy.error.message);

      const legacyRoutes = legacy.data || [];
      if (legacyRoutes.length) {
        const canonicalRows = legacyRoutes.map((route: any, idx: number) => ({
          tenant_id: tenantId,
          bom_id: bomId,
          sequence_no: Number(route.operation_sequence || (idx + 1) * 10),
          work_station_id: route.workstation_id,
          operation_name: route.operation_name,
          setup_time_minutes: Math.round(Number(route.setup_time || 0) * 60),
          cycle_time_minutes: Math.round(Number(route.cycle_time || 0) * 60),
          estimated_start_offset_hours: 0,
          estimated_duration_hours: Number(route.cycle_time || 0),
          manhours_required: Number(route.cycle_time || 0),
          qc_required: false,
          notes: route.notes || null,
        }));

        const { error: promoteError } = await this.supabase
          .from("production_routing")
          .insert(canonicalRows);

        // A concurrent request may have promoted the same BOM after our
        // initial read. In either case, re-read the canonical source of truth.
        if (
          promoteError &&
          !String(promoteError.message || "")
            .toLowerCase()
            .includes("duplicate")
        ) {
          throw new BadRequestException(
            `Unable to prepare executable routing: ${promoteError.message}`,
          );
        }

        const canonical = await this.supabase
          .from("production_routing")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("bom_id", bomId)
          .order("sequence_no", { ascending: true });
        if (canonical.error)
          throw new BadRequestException(canonical.error.message);

        routes = (canonical.data || []).map((route: any) => ({
          ...route,
          operation_sequence: route.sequence_no,
          workstation_id: route.work_station_id,
          cycle_time: Number(route.cycle_time_minutes || 0) / 60,
          setup_time: Number(route.setup_time_minutes || 0) / 60,
        }));
      }
    }

    return {
      ...header,
      bom_items: Array.isArray(itemsRes.data) ? itemsRes.data : [],
      bom_routing: routes,
    };
  }

  private async buildSmartExplosion(
    tenantId: string,
    bomId: string,
    multiplier: number,
    level: number,
    visitedBomIds: Set<string>,
    caches: {
      itemById: Map<string, any>;
      stockByItemId: Map<string, number>;
      scheduledSupplyByItemId: Map<string, number>;
      bomById: Map<string, any>;
      activeBomByItemId: Map<string, any | null>;
      bomItemsByBomId: Map<string, any[]>;
    },
    options?: {
      includeAllComponents?: boolean;
      state?: { nodeCount: number };
      memo?: Map<
        string,
        { nodes: SmartExplosionNode[]; subAssemblies: SmartSubAssemblyPlan[] }
      >;
    },
  ): Promise<{
    nodes: SmartExplosionNode[];
    subAssemblies: SmartSubAssemblyPlan[];
  }> {
    if (multiplier <= 0) return { nodes: [], subAssemblies: [] };

    if (level > this.smartPreviewMaxDepth) {
      throw new BadRequestException(
        `BOM expansion exceeded ${this.smartPreviewMaxDepth} levels. Please check for an unusually deep or circular BOM hierarchy.`,
      );
    }

    if (visitedBomIds.has(bomId)) {
      throw new BadRequestException(
        "BOM cycle detected. Please check BOM hierarchy.",
      );
    }
    visitedBomIds.add(bomId);

    const state = options?.state || { nodeCount: 0 };
    const registerNode = () => {
      state.nodeCount += 1;
      if (state.nodeCount > this.smartPreviewMaxNodes) {
        throw new BadRequestException(
          `BOM expansion exceeded ${this.smartPreviewMaxNodes} component lines. Please narrow the request or review duplicate/circular BOM data.`,
        );
      }
    };

    const nodes: SmartExplosionNode[] = [];
    const subAssemblies: SmartSubAssemblyPlan[] = [];
    // Stock and scheduled supply are consumed across sibling branches. A
    // quantity-only memo would reuse stale availability and over-plan supply,
    // therefore this execution intentionally walks every occurrence.

    let bom = caches.bomById.get(bomId);
    if (!bom) {
      bom = await this.getBomById(tenantId, bomId);
      if (!bom) throw new NotFoundException("BOM not found");
      caches.bomById.set(bomId, bom);
    }

    const bomItems = await this.getBomItemsCached(
      bomId,
      caches.bomItemsByBomId,
    );
    for (const bi of bomItems) {
      const lineQty = Number(bi.quantity) || 0;
      if (lineQty <= 0) continue;

      const requiredQuantity = lineQty * multiplier;

      const childBomId =
        (bi as any).child_bom_id || (bi as any).child_bomId || null;
      const itemId = (bi as any).item_id || (bi as any).itemId || null;

      if (childBomId) {
        let childBom = caches.bomById.get(childBomId);
        if (!childBom) {
          childBom = await this.getBomById(tenantId, childBomId);
          if (!childBom) throw new NotFoundException("Child BOM not found");
          caches.bomById.set(childBomId, childBom);
        }

        const subItemId = childBom.item_id;
        if (!subItemId) continue;

        let subItem = caches.itemById.get(subItemId);
        if (!subItem) {
          subItem = await this.getItemBasic(subItemId);
          if (!subItem) throw new NotFoundException("Item not found");
          caches.itemById.set(subItemId, subItem);
        }

        let available = caches.stockByItemId.get(subItemId);
        if (available === undefined) {
          available = await this.getAvailableStockForPreview(
            tenantId,
            subItemId,
          );
          caches.stockByItemId.set(subItemId, available);
        }

        const scheduled = caches.scheduledSupplyByItemId.get(subItemId) || 0;
        const supply = planComponentSupply({
          requiredQuantity,
          availableQuantity: available,
          scheduledSupplyQuantity: scheduled,
          supplyPolicy: (bi as any).supply_policy,
          hasBom: true,
        });
        caches.stockByItemId.set(subItemId, supply.remainingStockQuantity);
        caches.scheduledSupplyByItemId.set(
          subItemId,
          supply.remainingScheduledSupplyQuantity,
        );

        registerNode();
        nodes.push({
          level,
          componentType: "BOM",
          bomId: childBomId,
          parentBomId: bomId,
          itemId: subItemId,
          itemCode: subItem.code,
          itemName: subItem.name,
          requiredQuantity,
          availableQuantity: available,
          toMakeQuantity: supply.createJobOrder ? supply.shortageQuantity : 0,
          shortageQuantity: supply.shortageQuantity,
          stockAllocatedQuantity: supply.stockUsedQuantity,
          scheduledSupplyQuantity: supply.scheduledSupplyUsedQuantity,
          supplyPolicy: supply.policy,
          supplyAction: supply.action,
          sourceBomItemId: String((bi as any).id || "") || undefined,
          uidStrategy: "SERIALIZED", // Sub-assemblies always require UIDs
          sequence:
            typeof (bi as any).sequence === "number"
              ? (bi as any).sequence
              : Number((bi as any).sequence || 0) || undefined,
        });

        if (supply.createJobOrder)
          subAssemblies.push({
            bomId: childBomId,
            itemId: subItemId,
            itemCode: subItem.code,
            itemName: subItem.name,
            requiredQuantity,
            availableQuantity: available,
            toMakeQuantity: supply.shortageQuantity,
            stockAllocatedQuantity: supply.stockUsedQuantity,
            scheduledSupplyQuantity: supply.scheduledSupplyUsedQuantity,
            supplyPolicy: supply.policy,
            sourceBomItemId: String((bi as any).id || "") || undefined,
          });

        // Always explode full required quantity (not just shortage) to include all raw materials
        // This ensures consistent shortage reporting across quantity changes
        const shouldExplodeChild =
          Boolean(options?.includeAllComponents) || supply.explodeChildren;
        if (shouldExplodeChild) {
          const childResult = await this.buildSmartExplosion(
            tenantId,
            childBomId,
            Boolean(options?.includeAllComponents)
              ? requiredQuantity
              : supply.childExplosionQuantity,
            level + 1,
            new Set(visitedBomIds),
            caches,
            { ...options, state },
          );
          nodes.push(...childResult.nodes);
          subAssemblies.push(...childResult.subAssemblies);
        }

        continue;
      }

      if (itemId) {
        let item = caches.itemById.get(itemId);
        if (!item) {
          item = await this.getItemBasic(itemId);
          if (!item) throw new NotFoundException("Item not found");
          caches.itemById.set(itemId, item);
        }

        // If this item has its own BOM, treat it as a sub-assembly even if category/type is not set.
        // Many BOMs reference assemblies via item_id (without child_bom_id), so relying only on
        // category/type can cause assemblies to be treated as plain items and appear as "NO_STOCK".
        const subBom = await this.getActiveBomForItemCached(
          tenantId,
          itemId,
          caches.activeBomByItemId,
        );

        // Debug: Log when an item has/doesn't have a BOM
        if (
          process.env.DEBUG_SMART_JO_PREVIEW === "true" &&
          !subBom &&
          (item.code?.startsWith("SA-") || item.code?.startsWith("ITEM-06"))
        ) {
          console.log(
            `[SmartJO Explosion] Item ${item.code} (${itemId}) has NO BOM - treating as ITEM`,
          );
        }

        if (subBom) {
          caches.bomById.set(subBom.id, subBom);

          let available = caches.stockByItemId.get(itemId);
          if (available === undefined) {
            available = await this.getAvailableStockForPreview(
              tenantId,
              itemId,
            );
            caches.stockByItemId.set(itemId, available);
          }

          const scheduled = caches.scheduledSupplyByItemId.get(itemId) || 0;
          const supply = planComponentSupply({
            requiredQuantity,
            availableQuantity: available,
            scheduledSupplyQuantity: scheduled,
            supplyPolicy: (bi as any).supply_policy,
            hasBom: true,
          });
          caches.stockByItemId.set(itemId, supply.remainingStockQuantity);
          caches.scheduledSupplyByItemId.set(
            itemId,
            supply.remainingScheduledSupplyQuantity,
          );

          registerNode();
          nodes.push({
            level,
            componentType: "BOM",
            bomId: subBom.id,
            parentBomId: bomId,
            itemId,
            itemCode: item.code,
            itemName: item.name,
            requiredQuantity,
            availableQuantity: available,
            toMakeQuantity: supply.createJobOrder ? supply.shortageQuantity : 0,
            shortageQuantity: supply.shortageQuantity,
            stockAllocatedQuantity: supply.stockUsedQuantity,
            scheduledSupplyQuantity: supply.scheduledSupplyUsedQuantity,
            supplyPolicy: supply.policy,
            supplyAction: supply.action,
            sourceBomItemId: String((bi as any).id || "") || undefined,
            uidStrategy: "SERIALIZED", // Sub-assemblies always require UIDs
            sequence:
              typeof (bi as any).sequence === "number"
                ? (bi as any).sequence
                : Number((bi as any).sequence || 0) || undefined,
          });

          if (supply.createJobOrder) {
            subAssemblies.push({
              bomId: subBom.id,
              itemId,
              itemCode: item.code,
              itemName: item.name,
              requiredQuantity,
              availableQuantity: available,
              toMakeQuantity: supply.shortageQuantity,
              stockAllocatedQuantity: supply.stockUsedQuantity,
              scheduledSupplyQuantity: supply.scheduledSupplyUsedQuantity,
              supplyPolicy: supply.policy,
              sourceBomItemId: String((bi as any).id || "") || undefined,
            });
          }

          const shouldExpandChild =
            Boolean(options?.includeAllComponents) || supply.explodeChildren;
          if (shouldExpandChild) {
            const nextMultiplier = Boolean(options?.includeAllComponents)
              ? requiredQuantity
              : supply.childExplosionQuantity;
            const childResult = await this.buildSmartExplosion(
              tenantId,
              subBom.id,
              nextMultiplier,
              level + 1,
              new Set(visitedBomIds),
              caches,
              { ...options, state },
            );
            nodes.push(...childResult.nodes);
            subAssemblies.push(...childResult.subAssemblies);
          }

          continue;
        }

        // Standard ITEM component (not a subassembly or no BOM found)
        let available = caches.stockByItemId.get(itemId);
        if (available === undefined) {
          available = await this.getAvailableStockForPreview(tenantId, itemId);
          caches.stockByItemId.set(itemId, available);
        }

        const scheduled = caches.scheduledSupplyByItemId.get(itemId) || 0;
        const supply = planComponentSupply({
          requiredQuantity,
          availableQuantity: available,
          scheduledSupplyQuantity: scheduled,
          supplyPolicy: (bi as any).supply_policy,
          hasBom: false,
        });
        caches.stockByItemId.set(itemId, supply.remainingStockQuantity);
        caches.scheduledSupplyByItemId.set(
          itemId,
          supply.remainingScheduledSupplyQuantity,
        );

        registerNode();
        nodes.push({
          level,
          componentType: "ITEM",
          bomId,
          parentBomId: bomId,
          itemId,
          itemCode: item.code,
          itemName: item.name,
          requiredQuantity,
          availableQuantity: available,
          toMakeQuantity: 0,
          shortageQuantity: supply.shortageQuantity,
          stockAllocatedQuantity: supply.stockUsedQuantity,
          scheduledSupplyQuantity: supply.scheduledSupplyUsedQuantity,
          supplyPolicy: supply.policy,
          supplyAction: supply.action,
          sourceBomItemId: String((bi as any).id || "") || undefined,
          uidStrategy: item.uid_strategy || item.uidStrategy || "NONE",
          sequence:
            typeof (bi as any).sequence === "number"
              ? (bi as any).sequence
              : Number((bi as any).sequence || 0) || undefined,
        });
      }
    }

    return { nodes, subAssemblies };
  }

  async getSmartJobOrderPreview(
    tenantId: string,
    req: SmartJobOrderPreviewRequest,
  ) {
    if (!req?.itemId) throw new BadRequestException("itemId is required");
    if (!req?.quantity || Number(req.quantity) <= 0)
      throw new BadRequestException("quantity must be > 0");

    const finishedItem = await this.getItemBasic(req.itemId);
    if (!finishedItem) throw new NotFoundException("Item not found");

    const topBom = await this.getActiveBomForItem(tenantId, req.itemId);
    if (!topBom) {
      throw new BadRequestException("No BOM found for this item");
    }

    const caches = await this.loadSmartPreviewCaches(
      tenantId,
      finishedItem,
      topBom,
    );

    const { nodes, subAssemblies } = await this.buildSmartExplosion(
      tenantId,
      topBom.id,
      Number(req.quantity),
      0,
      new Set<string>(),
      caches,
      {
        includeAllComponents: Boolean(req.includeAllComponents),
        memo: new Map(),
      },
    );

    const bomNodes = nodes.filter((n: any) => n.componentType === "BOM");
    const bomNodesWithStock = bomNodes.filter(
      (n: any) => n.toMakeQuantity === 0,
    );
    const bomNodesNeedMake = bomNodes.filter((n: any) => n.toMakeQuantity > 0);
    if (process.env.DEBUG_SMART_JO_PREVIEW === "true") {
      console.log(`[SmartJO Preview] Explosion results:`, {
        totalNodes: nodes.length,
        bomNodes: bomNodes.length,
        subAssembliesWithStock: bomNodesWithStock.length,
        subAssembliesNeedToMake: bomNodesNeedMake.length,
        subAssembliesBeforeDedup: subAssemblies.length,
      });
      if (bomNodesWithStock.length > 0) {
        console.log(
          `[SmartJO Preview] Sub-assemblies with existing stock (skipped):`,
          bomNodesWithStock
            .map((n: any) => `${n.itemCode} (has ${n.availableQuantity})`)
            .join(", "),
        );
      }
    }

    // Consolidate repeated occurrences after consuming shared stock/supply once.
    // Summing the residual shortages is essential when the same subassembly is
    // used by more than one branch of the parent BOM.
    const planMap = new Map<string, SmartSubAssemblyPlan>();
    for (const sa of subAssemblies) {
      const key = `${sa.bomId}:${sa.itemId}`;
      const existing = planMap.get(key);
      if (!existing) {
        planMap.set(key, sa);
      } else {
        planMap.set(key, {
          ...existing,
          requiredQuantity:
            Number(existing.requiredQuantity || 0) +
            Number(sa.requiredQuantity || 0),
          availableQuantity:
            Number(existing.availableQuantity || 0) +
            Number(sa.availableQuantity || 0),
          toMakeQuantity:
            Number(existing.toMakeQuantity || 0) +
            Number(sa.toMakeQuantity || 0),
          stockAllocatedQuantity:
            Number(existing.stockAllocatedQuantity || 0) +
            Number(sa.stockAllocatedQuantity || 0),
          scheduledSupplyQuantity:
            Number(existing.scheduledSupplyQuantity || 0) +
            Number(sa.scheduledSupplyQuantity || 0),
        });
      }
    }

    const requestedQuantity = Number(req.quantity) || 0;
    const itemNodes = (nodes || []).filter(
      (n: any) => n?.componentType === "ITEM",
    );
    let maxProducibleQuantity = requestedQuantity;
    for (const node of itemNodes) {
      const requiredForRequested = Number((node as any)?.requiredQuantity || 0);
      if (requiredForRequested <= 0 || requestedQuantity <= 0) continue;

      const perUnitNeed = requiredForRequested / requestedQuantity;
      if (perUnitNeed <= 0) continue;

      const availableNow = Number((node as any)?.availableQuantity || 0);
      const possibleForThisItem = availableNow / perUnitNeed;
      if (Number.isFinite(possibleForThisItem)) {
        maxProducibleQuantity = Math.min(
          maxProducibleQuantity,
          Math.max(0, possibleForThisItem),
        );
      }
    }

    if (!Number.isFinite(maxProducibleQuantity) || maxProducibleQuantity < 0) {
      maxProducibleQuantity = 0;
    }

    // For finished goods we plan in pieces, so floor to whole units.
    const makeNowQuantity = Math.max(0, Math.floor(maxProducibleQuantity));
    const shortageToTargetQuantity = Math.max(
      0,
      Math.floor(requestedQuantity - makeNowQuantity),
    );

    return {
      finishedItem,
      quantity: Number(req.quantity),
      topBom: {
        id: topBom.id,
        version: topBom.version,
        is_active: (topBom as any).is_active,
      },
      nodes,
      subAssembliesToMake: Array.from(planMap.values()).sort(
        (a, b) => b.toMakeQuantity - a.toMakeQuantity,
      ),
      makeNowQuantity,
      shortageToTargetQuantity,
      source: {
        salesOrderId: req.salesOrderId || null,
        salesOrderItemId: req.salesOrderItemId || null,
      },
    };
  }

  async createSmartJobOrder(
    tenantId: string,
    userId: string,
    req: SmartJobOrderCreateRequest,
  ) {
    const result = await this.createSmartJobOrderInternal(
      tenantId,
      userId,
      req,
    );
    return {
      jobOrder: result.jobOrder,
      autoCompletedSubJobOrders: result.autoCompletedSubJobOrders,
      preview: result.preview,
      launchPack: buildProductionLaunchPack(result.jobOrder),
    };
  }

  private async createSmartJobOrderInternal(
    tenantId: string,
    userId: string,
    req: SmartJobOrderCreateRequest,
    onProgress?: (p: SmartJobOrderCreateProgress) => void,
  ) {
    if (!req?.itemId) throw new BadRequestException("itemId is required");
    if (!req?.quantity || Number(req.quantity) <= 0)
      throw new BadRequestException("quantity must be > 0");

    const startDate = this.toStartDate(req.startDate);
    onProgress?.({
      current: 0,
      total: 0,
      phase: "PREVIEW",
      message: "Building preview...",
    });

    const preview = await this.getSmartJobOrderPreview(tenantId, {
      itemId: req.itemId,
      quantity: Number(req.quantity),
      salesOrderId: req.salesOrderId,
      salesOrderItemId: req.salesOrderItemId,
    });

    const idempotencyKey = String(req.idempotencyKey || randomUUID()).trim();
    const { data: priorRun, error: priorRunError } = await this.supabase
      .from("production_creation_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (priorRunError) throw new BadRequestException(priorRunError.message);
    if (priorRun?.status === "COMPLETED" && priorRun.root_job_order_id) {
      const existing = await this.findOne(tenantId, priorRun.root_job_order_id);
      return {
        jobOrder: existing,
        linked_pr_id: (existing as any)?.linked_pr_id || null,
        linked_pr_number: (existing as any)?.linked_pr_number || null,
        autoCompletedSubJobOrders: [],
        preview,
        issueMaterialsSummary: null,
        _progressTotal: 0,
        idempotentReplay: true,
      };
    }
    if (priorRun?.status === "CREATING") {
      throw new BadRequestException(
        "This Smart Job Order request is already being processed. Refresh its status instead of submitting it again.",
      );
    }
    const creationRunResult = priorRun
      ? await this.supabase
          .from("production_creation_runs")
          .update({
            status: "CREATING",
            request_payload: req,
            root_job_order_id: null,
            created_job_order_ids: [],
            failure_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", priorRun.id)
          .select("id")
          .single()
      : await this.supabase
          .from("production_creation_runs")
          .insert({
            tenant_id: tenantId,
            idempotency_key: idempotencyKey,
            request_payload: req,
            status: "CREATING",
            created_by: userId,
          })
          .select("id")
          .single();
    if (creationRunResult.error)
      throw new BadRequestException(creationRunResult.error.message);
    const creationRunId = String(creationRunResult.data.id);
    const createdForRollback: Array<{ id: string; prId?: string | null }> = [];
    let masterPrId: string | null = null;
    let masterPrNumber: string | null = null;

    const completedSubJobOrders: any[] = [];

    // Create deeper sub-assemblies first to satisfy nested BOM dependencies.
    const subAssemblyLevelByKey = new Map<string, number>();
    for (const n of (preview.nodes || []) as SmartExplosionNode[]) {
      if (n?.componentType !== "BOM") continue;
      const key = `${String(n.bomId)}:${String(n.itemId)}`;
      const lvl = Number(n.level) || 0;
      const existing = subAssemblyLevelByKey.get(key);
      if (existing === undefined || lvl > existing)
        subAssemblyLevelByKey.set(key, lvl);
    }

    const subAssembliesToMakeAll = [
      ...((preview.subAssembliesToMake as SmartSubAssemblyPlan[]) || []),
    ].sort((a, b) => {
      const aKey = `${String(a.bomId)}:${String(a.itemId)}`;
      const bKey = `${String(b.bomId)}:${String(b.itemId)}`;
      const aLvl = subAssemblyLevelByKey.get(aKey) ?? 0;
      const bLvl = subAssemblyLevelByKey.get(bKey) ?? 0;
      if (aLvl !== bLvl) return bLvl - aLvl; // deeper first
      return (Number(b.toMakeQuantity) || 0) - (Number(a.toMakeQuantity) || 0);
    });

    const subAssembliesToMake = subAssembliesToMakeAll.filter(
      (sa) => Number(sa?.toMakeQuantity || 0) > 0,
    );

    if (process.env.DEBUG_SMART_JO_CREATE === "true") {
      console.log("[SmartJO] Sub-assembly processing order (deepest first):");
      for (const sa of subAssembliesToMake) {
        const key = `${String(sa.bomId)}:${String(sa.itemId)}`;
        const lvl = subAssemblyLevelByKey.get(key) ?? 0;
        console.log(
          `  Level ${lvl}: ${sa.itemCode} (qty: ${sa.toMakeQuantity})`,
        );
      }
    }
    const totalSteps = subAssembliesToMake.length + 1; // +1 for main job order
    let currentStep = 0;

    onProgress?.({
      current: 0,
      total: totalSteps,
      phase: "SUB_ASSEMBLIES",
      message: subAssembliesToMake.length
        ? `Creating ${subAssembliesToMake.length} sub-assemblies...`
        : "No sub-assemblies required",
    });

    // PHASE 1: Create ALL sub-assembly job orders first (without completing).
    // This ensures they all exist before we try to complete any of them.
    const createdSubJobOrders: Array<{
      sa: SmartSubAssemblyPlan;
      jobOrder: any;
      completed: boolean;
    }> = [];

    try {
    for (const sa of subAssembliesToMake) {
      currentStep += 1;
      onProgress?.({
        current: currentStep,
        total: totalSteps,
        phase: "SUB_ASSEMBLIES",
        message: `Creating sub-assembly ${currentStep} of ${subAssembliesToMake.length}`,
        itemCode: sa.itemCode,
        itemName: sa.itemName,
      });

      if (process.env.DEBUG_SMART_JO_CREATE === "true") {
        console.log("[SmartJO] Creating sub-assembly job order:", {
          itemId: sa.itemId,
          itemCode: sa.itemCode,
          bomId: sa.bomId,
          quantity: sa.toMakeQuantity,
          level:
            subAssemblyLevelByKey.get(`${sa.bomId}:${sa.itemId}`) ?? "unknown",
        });
      }

      const created = await this.createFromBOMWithVariantSelections(
        tenantId,
        userId,
        {
          itemId: sa.itemId,
          bomId: sa.bomId,
          quantity: sa.toMakeQuantity,
          startDate,
          priority: "NORMAL",
          notes: `Auto-created by Smart Job Order for ${preview.finishedItem.code}`,
          variantSelections: req.variantSelections,
          itemSelections: req.itemSelections,
          deferShortagePr: true,
        },
      );

      createdSubJobOrders.push({ sa, jobOrder: created, completed: false });
      createdForRollback.push({ id: created.id, prId: created.linked_pr_id });
      await this.supabase
        .from("production_creation_runs")
        .update({ created_job_order_ids: createdForRollback.map((row) => row.id), updated_at: new Date().toISOString() })
        .eq("id", creationRunId);
    }

    if (process.env.DEBUG_SMART_JO_CREATE === "true") {
      console.log(
        `[SmartJO] Created ${createdSubJobOrders.length} sub-assembly job orders as DRAFT. Manual store flow required: issue materials via SIV -> receive via SRV -> QC approval -> then execute main JO.`,
      );
    }

    // NOTE: Sub-assembly JOs intentionally remain in DRAFT/PLANNED status.
    // The store flow must be followed for each sub-assembly before the main JO can be executed:
    //   1. Store raises a Material Requisition / SIV against the sub-assembly JO
    //   2. Inventory is issued (stock decremented)
    //   3. Sub-assembly is manufactured and received via SRV
    //   4. QC approves the received sub-assembly
    // Only after all sub-assemblies are QC-approved does the main JO have the required components in stock.

    // Create the main finished-goods job order. Keep it as-is (typically PLANNED) for shop floor execution.
    onProgress?.({
      current: subAssembliesToMake.length + 1,
      total: totalSteps,
      phase: "MAIN_JOB_ORDER",
      message: "Creating main finished-goods job order...",
      itemCode: preview.finishedItem.code,
      itemName: preview.finishedItem.name,
    });

    const mainNotesParts: string[] = ["Created via Smart Job Order"];
    if (preview.source?.salesOrderId)
      mainNotesParts.push(`SalesOrder: ${preview.source.salesOrderId}`);
    if (preview.source?.salesOrderItemId)
      mainNotesParts.push(`SOItem: ${preview.source.salesOrderItemId}`);
    if (req.notes) mainNotesParts.push(req.notes);
    if (req.workingHoursOverride)
      mainNotesParts.push(
        `Temporary working-hours override: ${req.workingHoursOverride} hours for ${startDate}; machine masters unchanged`,
      );

    const main = await this.createFromBOMWithVariantSelections(
      tenantId,
      userId,
      {
        itemId: preview.finishedItem.id,
        bomId: preview.topBom.id,
        quantity: preview.quantity,
        startDate,
        salesOrderId: preview.source?.salesOrderId || undefined,
        salesOrderItemId: preview.source?.salesOrderItemId || undefined,
        priority: req.priority || "NORMAL",
        notes: mainNotesParts.join(" | "),
        variantSelections: req.variantSelections,
        itemSelections: req.itemSelections,
        deferShortagePr: true,
      },
    );
    createdForRollback.push({ id: main.id, prId: main.linked_pr_id });
    await this.supabase
      .from("production_creation_runs")
      .update({ created_job_order_ids: createdForRollback.map((row) => row.id), root_job_order_id: main.id, updated_at: new Date().toISOString() })
      .eq("id", creationRunId);

    // One parent-and-child BOM explosion produces one master PR. Repeated
    // items across sub-assemblies are combined into a single requested line.
    const masterShortages = consolidateMasterPurchaseShortages(
      (preview.nodes || []) as SmartExplosionNode[],
    );
    if (masterShortages.length > 0) {
      const masterPr = await this.createShortagePurchaseRequisition(
        tenantId,
        userId,
        main,
        masterShortages,
        {
          master: true,
          childJobOrderCount: createdSubJobOrders.length,
        },
      );
      masterPrId = masterPr?.prId || null;
      masterPrNumber = masterPr?.prNumber || null;

      if (masterPrId) {
        const mainRollbackRow = createdForRollback.find(
          (row) => row.id === main.id,
        );
        if (mainRollbackRow) mainRollbackRow.prId = masterPrId;
      }

      if (masterPrNumber) {
        const jobsToLink = [
          { id: main.id, notes: main.notes },
          ...createdSubJobOrders.map((child) => ({
            id: child.jobOrder.id,
            notes: child.jobOrder.notes,
          })),
        ];
        for (const job of jobsToLink) {
          const notesResult = await this.supabase
            .from("production_job_orders")
            .update({
              notes: this.appendLinkedPrNote(job.notes, masterPrNumber),
            })
            .eq("tenant_id", tenantId)
            .eq("id", job.id);
          if (notesResult.error) {
            throw new BadRequestException(
              `Master PR ${masterPrNumber} was created but could not be linked to the Job Order tree: ${notesResult.error.message}`,
            );
          }
        }
      }
    }

    // Attach the child builds only after the parent exists. This keeps the
    // creation sequence (deepest first) while giving planners an auditable
    // parent/root chain and prevents child output being treated as anonymous
    // free supply.
    for (const child of createdSubJobOrders) {
      const link = await this.supabase
        .from("production_job_orders")
        .update({
          parent_job_order_id: main.id,
          root_job_order_id: main.id,
          source_bom_item_id: child.sa.sourceBomItemId || null,
          demand_pegging: {
            parent_job_order_id: main.id,
            parent_job_order_number: main.job_order_number,
            required_quantity: child.sa.requiredQuantity,
            stock_allocated_quantity: child.sa.stockAllocatedQuantity || 0,
            scheduled_supply_quantity: child.sa.scheduledSupplyQuantity || 0,
            planned_supply_quantity: child.sa.toMakeQuantity,
          },
        })
        .eq("tenant_id", tenantId)
        .eq("id", child.jobOrder.id);
      if (link.error)
        throw new BadRequestException(
          `Child Job Order ${child.jobOrder.job_order_number || child.jobOrder.id} was created but could not be pegged: ${link.error.message}`,
        );

      const pegging = await this.supabase
        .from("production_supply_pegging")
        .upsert(
          {
            tenant_id: tenantId,
            parent_job_order_id: main.id,
            child_job_order_id: child.jobOrder.id,
            bom_item_id: child.sa.sourceBomItemId || null,
            item_id: child.sa.itemId,
            supply_policy: child.sa.supplyPolicy || "MAKE",
            required_quantity: child.sa.requiredQuantity,
            stock_allocated_quantity: child.sa.stockAllocatedQuantity || 0,
            scheduled_supply_quantity: child.sa.scheduledSupplyQuantity || 0,
            planned_supply_quantity: child.sa.toMakeQuantity,
            required_by_date: startDate,
            status: "PLANNED",
            source_reference: {
              parent_job_order_number: main.job_order_number,
              child_job_order_number: child.jobOrder.job_order_number,
              sales_order_id: preview.source?.salesOrderId || null,
              sales_order_item_id: preview.source?.salesOrderItemId || null,
            },
            created_by: userId,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict:
              "tenant_id,parent_job_order_id,child_job_order_id,item_id",
          },
        );
      if (pegging.error)
        throw new BadRequestException(
          `Child Job Order ${child.jobOrder.job_order_number || child.jobOrder.id} was linked but its supply pegging could not be saved: ${pegging.error.message}`,
        );
    }

    const supplyActions = (preview.nodes || [])
      .filter((node: SmartExplosionNode) =>
        ["BUY", "SUBCONTRACT", "REVIEW"].includes(String(node.supplyAction || "")) &&
        Number(node.shortageQuantity || 0) > 0,
      )
      .map((node: SmartExplosionNode) => ({
        tenant_id: tenantId,
        parent_job_order_id: main.id,
        bom_item_id: node.sourceBomItemId || null,
        item_id: node.itemId,
        action_type:
          node.supplyAction === "REVIEW" ? "PLANNER_REVIEW" : node.supplyAction,
        required_quantity: node.shortageQuantity,
        required_by_date: startDate,
        status: "ACTION_REQUIRED",
        owner_id: userId,
        notes: `${node.itemCode} requires ${node.shortageQuantity} through ${node.supplyAction}`,
        created_by: userId,
        updated_at: new Date().toISOString(),
      }));
    if (supplyActions.length) {
      const actionResult = await this.supabase
        .from("production_supply_actions")
        .upsert(supplyActions, {
          onConflict: "tenant_id,parent_job_order_id,bom_item_id,item_id,action_type",
        });
      if (actionResult.error)
        throw new BadRequestException(
          `Supply action worklist could not be created: ${actionResult.error.message}`,
        );
      if (masterPrId) {
        await this.supabase
          .from("production_supply_actions")
          .update({
            status: "PENDING_APPROVAL",
            source_document_type: "PURCHASE_REQUISITION",
            source_document_id: masterPrId,
            source_document_number: masterPrNumber,
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", tenantId)
          .eq("parent_job_order_id", main.id)
          .eq("action_type", "BUY");
      }
    }

    // Do NOT auto-issue materials for the main job order.
    // Materials will appear as a Material Requisition in the SIV (Store Issue Voucher) screen
    // so the storekeeper can physically verify and issue inventory.
    if (process.env.DEBUG_SMART_JO_CREATE === "true") {
      console.log("[JobOrderService] Smart job order created:", {
        jobOrderId: main.id,
        jobOrderNumber: main.job_order_number,
        note: "Materials NOT auto-issued - will appear in SIV for manual issue",
      });
    }

    const issueMaterialsSummary = null;

    const mainWithMaterials = await this.findOne(tenantId, main.id);
    onProgress?.({
      current: totalSteps,
      total: totalSteps,
      phase: "DONE",
      message: "Done",
    });

    await this.supabase
      .from("production_creation_runs")
      .update({ status: "COMPLETED", root_job_order_id: main.id, updated_at: new Date().toISOString() })
      .eq("id", creationRunId);

    return {
      jobOrder: {
        ...mainWithMaterials,
        linked_pr_id: masterPrId,
        linked_pr_number: masterPrNumber,
      },
      linked_pr_id: masterPrId,
      linked_pr_number: masterPrNumber,
      autoCompletedSubJobOrders: completedSubJobOrders,
      preview,
      issueMaterialsSummary,
      _progressTotal: totalSteps,
    };
    } catch (error: any) {
      for (const created of [...createdForRollback].reverse()) {
        await this.rollbackCreatedJobOrder(tenantId, created.id, created.prId);
      }
      await this.supabase
        .from("production_creation_runs")
        .update({
          status: "ROLLED_BACK",
          failure_message: String(error?.message || error),
          root_job_order_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", creationRunId);
      throw error;
    }
  }

  /**
   * Force auto-complete DRAFT job orders with sub-assemblies.
   * Transitions DRAFT → IN_PROGRESS → COMPLETED with auto-approval.
   * Used when BOMs have sub-assemblies and should auto-complete like other job orders.
   */
  async forceAutoCompleteDraftJobOrder(
    tenantId: string,
    jobOrderId: string,
    userId?: string,
  ) {
    const { data: jobOrder, error: joErr } = await this.supabase
      .from("production_job_orders")
      .select("*, job_order_materials(*)")
      .eq("tenant_id", tenantId)
      .eq("id", jobOrderId)
      .single();

    if (joErr || !jobOrder) throw new NotFoundException("Job order not found");
    if (jobOrder.status !== "DRAFT") {
      throw new BadRequestException(
        `Cannot force-complete job order with status ${jobOrder.status}. Only DRAFT jobs can be force-completed.`,
      );
    }

    this.logger.log("[ForceAutoComplete] Starting for DRAFT job order:", {
      jobOrderId,
      jobOrderNumber: jobOrder.job_order_number,
      hasMaterials: Array.isArray(jobOrder.job_order_materials),
    });

    // Transition DRAFT → IN_PROGRESS
    await this.supabase
      .from("production_job_orders")
      .update({
        status: "IN_PROGRESS",
        actual_start_date: new Date().toISOString(),
      })
      .eq("id", jobOrderId);

    // Complete the job order
    const completed = await this.completeJobOrder(
      tenantId,
      jobOrderId,
      userId,
      {
        allowPartialConsumption: true,
        autoBuildMissingSubAssemblies: true,
      },
    );

    // Auto-complete QC to immediately create stock (SYSTEM)
    try {
      const qty =
        Math.max(
          0,
          Number(
            (completed as any)?.quantity ||
              (completed as any)?.completed_quantity ||
              0,
          ) || 0,
        ) || 1;
      await this.receiveStoreReceiptVoucher(tenantId, jobOrderId, userId, {
        receiverName: "SYSTEM",
        receivedQuantity: qty,
      });
      await this.approveQC(
        tenantId,
        jobOrderId,
        {
          acceptedQuantity: qty,
          rejectedQuantity: 0,
        },
        userId,
      );
      this.logger.log("[ForceAutoComplete] QC auto-completed (SYSTEM):", qty);
    } catch (qcErr: any) {
      this.logger.warn(
        "[ForceAutoComplete] QC auto-completion failed (non-fatal):",
        qcErr?.message,
      );
    }

    this.logger.log("[ForceAutoComplete] Completed successfully");
    return completed;
  }

  async createManualStoreReceiptVoucher(
    tenantId: string,
    payload: {
      itemId: string;
      quantity: number;
      warehouseId?: string;
      receiverName?: string;
      receiverPhone?: string;
      notes?: string;
      movementDate?: string;
      userId?: string;
    },
  ) {
    const itemId = String(payload?.itemId || "").trim();
    const quantity = Number(payload?.quantity || 0);
    if (!this.isUuid(itemId))
      throw new BadRequestException("Valid itemId is required");
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new BadRequestException("quantity must be greater than 0");

    const { data: item, error: itemError } = await this.supabase
      .from("items")
      .select("id, code, name, category, uid_tracking, uid_strategy")
      .eq("tenant_id", tenantId)
      .eq("id", itemId)
      .single();

    if (itemError || !item) throw new BadRequestException("Item not found");

    let warehouseId = String(payload?.warehouseId || "").trim();
    if (!warehouseId || !this.isUuid(warehouseId)) {
      const { data: warehouses, error: whError } = await this.supabase
        .from("warehouses")
        .select("id")
        .eq("tenant_id", tenantId)
        .limit(1);
      if (whError || !warehouses?.length)
        throw new BadRequestException("No warehouse configured");
      warehouseId = warehouses[0].id;
    }

    const movementDate =
      payload?.movementDate || new Date().toISOString().split("T")[0];

    // Auto-approve manual SRV: stock is immediately available
    const { data: entry, error: insertError } = await this.supabase
      .from("stock_entries")
      .insert({
        tenant_id: tenantId,
        item_id: itemId,
        warehouse_id: warehouseId,
        quantity,
        available_quantity: quantity,
        allocated_quantity: 0,
        metadata: {
          created_from: "MANUAL_SRV",
          item_code: (item as any).code,
          item_name: (item as any).name,
          received_by: payload?.userId || null,
          received_by_name: String(payload?.receiverName || "").trim() || null,
          received_by_phone:
            String(payload?.receiverPhone || "").trim() || null,
          notes: String(payload?.notes || "").trim() || null,
          movement_date: movementDate,
          srv_approved_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
        },
      })
      .select("id")
      .single();

    if (insertError)
      throw new BadRequestException(
        `Failed to create manual SRV: ${insertError.message}`,
      );

    // Update inventory_stock to reflect new available stock
    const { error: invErr } = await this.supabase.rpc(
      "adjust_inventory_stock",
      {
        p_tenant_id: tenantId,
        p_item_id: itemId,
        p_warehouse_id: warehouseId,
        p_location_id: null,
        p_quantity_change: quantity,
        p_category: normalizeInventoryCategory(
          (item as any).category,
          "RAW_MATERIAL",
        ),
      },
    );
    if (invErr) {
      this.logger.warn(
        `[ManualSRV] adjust_inventory_stock failed (non-fatal): ${invErr.message}`,
      );
    }

    this.logger.log(
      `[ManualSRV] Created entry ${entry?.id} for item ${itemId}, qty=${quantity}`,
    );

    // Generate UIDs for received quantity (respects uid_tracking / uid_strategy on the item)
    const generatedUids: string[] = [];
    try {
      if (
        (item as any).uid_tracking !== false &&
        (item as any).uid_strategy !== "NONE"
      ) {
        const entityType = this.resolveUidEntityTypeFromItemCategory(
          (item as any).category,
        );
        const tenantCode = await this.uidService.resolveTenantCode(tenantId);
        for (let i = 0; i < quantity; i++) {
          const uid = await this.uidService.generateUID(
            tenantCode,
            "SRV",
            entityType,
          );
          const { error: uidError } = await this.supabase
            .from("uid_registry")
            .insert({
              tenant_id: tenantId,
              uid,
              entity_type: entityType,
              entity_id: itemId,
              location: "STORE",
              status: "IN_STOCK",
              quality_status: "APPROVED",
              lifecycle: JSON.stringify([
                {
                  stage: "RECEIVED",
                  timestamp: new Date().toISOString(),
                  location: "Store",
                  reference: `MANUAL SRV entry ${entry?.id}`,
                  user: payload?.userId || null,
                },
              ]),
              metadata: JSON.stringify({
                item_code: (item as any).code,
                item_name: (item as any).name,
                stock_entry_id: entry?.id,
                created_from: "MANUAL_SRV",
                received_by: payload?.receiverName || null,
                movement_date: movementDate,
              }),
            });
          if (!uidError) generatedUids.push(uid);
          else
            this.logger.warn(
              `[ManualSRV] UID insert error for uid=${uid}: ${uidError.message}`,
            );
        }
        this.logger.log(
          `[ManualSRV] Generated ${generatedUids.length} UIDs for item ${itemId}`,
        );
      }
    } catch (uidErr: any) {
      this.logger.warn(
        `[ManualSRV] UID generation failed (non-fatal): ${uidErr?.message}`,
      );
    }

    return {
      entryId: entry?.id,
      itemId,
      itemCode: (item as any).code,
      itemName: (item as any).name,
      quantity,
      warehouseId,
      uids: generatedUids,
      message: `Manual SRV created: ${quantity} unit(s) received and added to stock.${generatedUids.length > 0 ? ` ${generatedUids.length} UID(s) generated.` : ""}`,
    };
  }
}
