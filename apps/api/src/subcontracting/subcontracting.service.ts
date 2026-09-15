import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { InventoryService } from "../inventory/services/inventory.service";

type OperationalAccountingService = {
  queueAutomaticOperationalPosting: (...args: any[]) => Promise<unknown>;
};

// Some client deployments run a narrower module set than Mizantra. Resolve
// the accounting integration when that module is installed, while keeping the
// operational subcontracting flow deployable for clients without Accounts.
let ACCOUNTING_SERVICE_TOKEN: any = "OPTIONAL_ACCOUNTING_SERVICE";
try {
  ACCOUNTING_SERVICE_TOKEN =
    require("../accounting/accounting.service").AccountingService;
} catch {
  // The optional integration is absent in client deployments without Accounts.
}

type RequestWithUser = { user: { tenantId: string; userId: string } };

function num(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundQty(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function text(value: any, fallback = "") {
  return String(value ?? fallback).trim();
}

export function requiresSecondaryLength(
  inputItemId: unknown,
  inputUom: unknown,
  steps: Array<{
    parent_node_key?: unknown;
    output_item_id?: unknown;
    output_uom?: unknown;
  }>,
) {
  const normalizedInputItemId = text(inputItemId);
  const normalizedInputUom = text(inputUom).toUpperCase();
  const weightUoms = new Set([
    "KG",
    "KGS",
    "KILOGRAM",
    "KILOGRAMS",
    "G",
    "GM",
    "GMS",
    "GRAM",
    "GRAMS",
  ]);
  const countUoms = new Set([
    "NUMBER",
    "NO",
    "NOS",
    "PCS",
    "PC",
    "PIECE",
    "PIECES",
    "EA",
    "EACH",
  ]);

  if (!normalizedInputItemId || !weightUoms.has(normalizedInputUom))
    return false;

  return steps
    .filter((step) => !text(step.parent_node_key))
    .some((step) => {
      const outputItemId = text(step.output_item_id);
      return (
        outputItemId &&
        outputItemId !== normalizedInputItemId &&
        countUoms.has(text(step.output_uom).toUpperCase())
      );
    });
}

function isMissingSchemaError(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("exec_sql")
  );
}

function emptyDashboard() {
  return {
    totalOrders: 0,
    openOrders: 0,
    activeRoutes: 0,
    openSteps: 0,
    vendorHeldQty: 0,
    pendingInvoiceSteps: 0,
    subcontractPayable: 0,
  };
}

@Injectable()
export class SubcontractingService implements OnModuleInit {
  private supabase: SupabaseClient;
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly inventoryService: InventoryService,
    @Optional()
    @Inject(ACCOUNTING_SERVICE_TOKEN)
    private readonly accountingService?: OperationalAccountingService,
  ) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  onModuleInit() {
    void this.ensureSchema().catch((error) => {
      console.warn(
        "[SubcontractingService] schema warm-up failed:",
        error?.message || error,
      );
    });
  }

  private async itemUomMap(
    tenantId: string,
    itemIds: Array<string | null | undefined>,
  ) {
    const ids = Array.from(
      new Set(itemIds.map((id) => text(id)).filter(Boolean)),
    );
    if (!ids.length) return new Map<string, string>();
    const { data, error } = await this.supabase
      .from("items")
      .select("id, uom")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    if (error) throw new BadRequestException(error.message);
    return new Map(
      (data || []).map((item: any) => [
        text(item.id),
        text(item.uom).toUpperCase(),
      ]),
    );
  }

  private async ensureSchema() {
    if (this.schemaReady) return this.schemaReady;

    this.schemaReady = (async () => {
      const sql = `
CREATE TABLE IF NOT EXISTS public.subcontract_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  route_number VARCHAR(60) NOT NULL,
  name VARCHAR(255) NOT NULL,
  input_item_id UUID,
  output_item_id UUID,
  default_input_qty NUMERIC(18, 4) DEFAULT 0,
  default_output_qty NUMERIC(18, 4) DEFAULT 0,
  consumption_per_output_qty NUMERIC(18, 4) DEFAULT 0,
  expected_consumption_qty NUMERIC(18, 4) DEFAULT 0,
  expected_unused_qty NUMERIC(18, 4) DEFAULT 0,
  uom VARCHAR(50),
  status VARCHAR(30) DEFAULT 'ACTIVE',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, route_number)
);

CREATE TABLE IF NOT EXISTS public.subcontract_route_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  route_id UUID NOT NULL REFERENCES public.subcontract_routes(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  node_key VARCHAR(80),
  parent_node_key VARCHAR(80),
  branch_no INTEGER DEFAULT 1,
  operation_name VARCHAR(255) NOT NULL,
  process_type VARCHAR(80) DEFAULT 'OUTSIDE_PROCESSING',
  vendor_id UUID,
  department VARCHAR(120),
  input_item_id UUID,
  output_item_id UUID,
  default_input_qty NUMERIC(18, 4) DEFAULT 0,
  default_output_qty NUMERIC(18, 4) DEFAULT 0,
  standard_yield_pct NUMERIC(8, 3) DEFAULT 100,
  scrap_tolerance_pct NUMERIC(8, 3) DEFAULT 0,
  qc_required BOOLEAN DEFAULT true,
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, route_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS public.subcontract_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_number VARCHAR(60) NOT NULL,
  route_id UUID REFERENCES public.subcontract_routes(id),
  source_warehouse_id UUID,
  output_warehouse_id UUID,
  input_item_id UUID,
  output_item_id UUID,
  planned_input_qty NUMERIC(18, 4) DEFAULT 0,
  planned_output_qty NUMERIC(18, 4) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'DRAFT',
  current_step_no INTEGER DEFAULT 1,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(tenant_id, order_number)
);

CREATE TABLE IF NOT EXISTS public.subcontract_order_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  route_step_id UUID,
  sequence_no INTEGER NOT NULL,
  node_key VARCHAR(80),
  parent_node_key VARCHAR(80),
  parent_order_step_id UUID,
  branch_no INTEGER DEFAULT 1,
  operation_name VARCHAR(255) NOT NULL,
  process_type VARCHAR(80) DEFAULT 'OUTSIDE_PROCESSING',
  vendor_id UUID,
  department VARCHAR(120),
  input_item_id UUID,
  output_item_id UUID,
  planned_input_qty NUMERIC(18, 4) DEFAULT 0,
  planned_output_qty NUMERIC(18, 4) DEFAULT 0,
  issued_qty NUMERIC(18, 4) DEFAULT 0,
  received_qty NUMERIC(18, 4) DEFAULT 0,
  accepted_qty NUMERIC(18, 4) DEFAULT 0,
  rejected_qty NUMERIC(18, 4) DEFAULT 0,
  scrap_qty NUMERIC(18, 4) DEFAULT 0,
  unused_return_qty NUMERIC(18, 4) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'WAITING',
  processing_rate NUMERIC(18, 4) DEFAULT 0,
  processing_amount NUMERIC(18, 2) DEFAULT 0,
  tax_percent NUMERIC(8, 3) DEFAULT 0,
  tax_amount NUMERIC(18, 2) DEFAULT 0,
  payable_amount NUMERIC(18, 2) DEFAULT 0,
  paid_amount NUMERIC(18, 2) DEFAULT 0,
  invoice_number VARCHAR(120),
  invoice_date DATE,
  invoice_status VARCHAR(30) DEFAULT 'NOT_RECEIVED',
  payment_reference VARCHAR(120),
  payment_date DATE,
  issued_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, order_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS public.subcontract_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  order_step_id UUID REFERENCES public.subcontract_order_steps(id) ON DELETE CASCADE,
  movement_type VARCHAR(40) NOT NULL,
  item_id UUID,
  quantity NUMERIC(18, 4) DEFAULT 0,
  warehouse_id UUID,
  vendor_id UUID,
  reference_number VARCHAR(80),
  document_number VARCHAR(80),
  external_reference VARCHAR(120),
  from_warehouse_id UUID,
  to_warehouse_id UUID,
  consumed_qty NUMERIC(18, 4) DEFAULT 0,
  accepted_qty NUMERIC(18, 4) DEFAULT 0,
  rejected_qty NUMERIC(18, 4) DEFAULT 0,
  scrap_qty NUMERIC(18, 4) DEFAULT 0,
  unused_return_qty NUMERIC(18, 4) DEFAULT 0,
  processing_rate NUMERIC(18, 4) DEFAULT 0,
  processing_amount NUMERIC(18, 2) DEFAULT 0,
  tax_percent NUMERIC(8, 3) DEFAULT 0,
  tax_amount NUMERIC(18, 2) DEFAULT 0,
  payable_amount NUMERIC(18, 2) DEFAULT 0,
  invoice_number VARCHAR(120),
  invoice_date DATE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontract_routes_tenant ON public.subcontract_routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_steps_route ON public.subcontract_route_steps(route_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_orders_tenant ON public.subcontract_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_order_steps_order ON public.subcontract_order_steps(order_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_movements_order ON public.subcontract_movements(order_id);

ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS consumption_per_output_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS expected_consumption_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS expected_unused_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS node_key VARCHAR(80);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS parent_node_key VARCHAR(80);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS branch_no INTEGER DEFAULT 1;
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS default_input_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS output_uom VARCHAR(30);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS output_size NUMERIC(18,4);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS output_uom VARCHAR(30);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS output_size NUMERIC(18,4);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18,4) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(30);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(8,3) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS other_charges_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS other_charges_amount NUMERIC(18,2) DEFAULT 0;
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS input_uom VARCHAR(30);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS secondary_input_qty NUMERIC(18,4);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS secondary_input_uom VARCHAR(30);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS remaining_secondary_input_qty NUMERIC(18,4);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_orders_tenant_client_request
  ON public.subcontract_orders(tenant_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS default_output_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS node_key VARCHAR(80);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS parent_node_key VARCHAR(80);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS parent_order_step_id UUID;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS branch_no INTEGER DEFAULT 1;
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS piece_size NUMERIC(18,4);
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS size_uom VARCHAR(20);
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS input_weight_per_piece NUMERIC(18,6);
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS output_weight_per_piece NUMERIC(18,6);
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS total_input_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS total_output_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_routes ADD COLUMN IF NOT EXISTS calculated_scrap_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS input_weight_per_piece NUMERIC(18,6);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS output_weight_per_piece NUMERIC(18,6);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS planned_input_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS planned_output_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_route_steps ADD COLUMN IF NOT EXISTS calculated_scrap_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS total_input_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS remaining_raw_material_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS input_weight_per_piece NUMERIC(18,6);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS output_weight_per_piece NUMERIC(18,6);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS planned_input_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS planned_output_weight NUMERIC(18,6);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS consumed_input_weight NUMERIC(18,6) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS calculated_scrap_weight NUMERIC(18,6) DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_subcontract_route_steps_parent ON public.subcontract_route_steps(route_id, parent_node_key);
CREATE INDEX IF NOT EXISTS idx_subcontract_order_steps_parent ON public.subcontract_order_steps(order_id, parent_order_step_id);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS document_number VARCHAR(80);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS external_reference VARCHAR(120);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS from_warehouse_id UUID;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS to_warehouse_id UUID;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS consumed_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS accepted_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS scrap_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS unused_return_qty NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS processing_rate NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS processing_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(8, 3) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS payable_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(120);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) DEFAULT 'NOT_RECEIVED';
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(120);
ALTER TABLE public.subcontract_order_steps ADD COLUMN IF NOT EXISTS payment_date DATE;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS processing_rate NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS processing_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(8, 3) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS payable_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(120);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) DEFAULT 'NOT_RECEIVED';
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS issue_movement_id UUID REFERENCES public.subcontract_movements(id);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS remaining_qty NUMERIC(18,4);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS balance_status VARCHAR(30) DEFAULT 'OPEN';
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS qc_status VARCHAR(30);
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS qc_approved_qty NUMERIC(18,4) DEFAULT 0;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS qc_approved_at TIMESTAMPTZ;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS qc_approved_by UUID;
ALTER TABLE public.subcontract_movements ADD COLUMN IF NOT EXISTS qc_notes TEXT;
CREATE TABLE IF NOT EXISTS public.subcontract_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  receipt_movement_id UUID NOT NULL REFERENCES public.subcontract_movements(id) ON DELETE CASCADE,
  issue_movement_id UUID NOT NULL REFERENCES public.subcontract_movements(id),
  line_type VARCHAR(30) NOT NULL, item_id UUID, quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  raw_material_qty NUMERIC(18,4) NOT NULL DEFAULT 0, warehouse_id UUID, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS actual_weight NUMERIC(18,4);
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_status VARCHAR(30) NOT NULL DEFAULT 'PENDING_QC';
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_approved_qty NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_rejected_qty NUMERIC(18,4) NOT NULL DEFAULT 0;
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_disposition VARCHAR(30);
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_scrap_item_id UUID REFERENCES public.items(id);
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_notes TEXT;
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_approved_at TIMESTAMPTZ;
ALTER TABLE public.subcontract_receipt_lines ADD COLUMN IF NOT EXISTS qc_approved_by UUID;
CREATE INDEX IF NOT EXISTS idx_subcontract_movements_issue ON public.subcontract_movements(issue_movement_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_receipt_lines_issue ON public.subcontract_receipt_lines(issue_movement_id);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS requisition_number VARCHAR(60);
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'LEGACY_APPROVED';
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS submitted_by UUID;
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS rejected_by UUID;
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE public.subcontract_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_orders_tenant_requisition_number
  ON public.subcontract_orders(tenant_id, requisition_number)
  WHERE requisition_number IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.subcontract_order_approval_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL, from_status VARCHAR(30), to_status VARCHAR(30) NOT NULL,
  reason TEXT, action_by UUID, action_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subcontract_order_approval_history_order
  ON public.subcontract_order_approval_history(tenant_id, order_id, action_at DESC);
`;

      const { error } = await this.supabase.rpc("exec_sql", { sql });
      if (!error) return;

      const message = String(error.message || "");
      if (message.includes("exec_sql")) {
        const probe = await this.supabase
          .from("subcontract_routes")
          .select("id", { count: "exact", head: true })
          .limit(1);
        if (!probe.error) return;
      }

      if (isMissingSchemaError(error)) {
        throw new BadRequestException(
          "Subcontracting schema is not available yet. Please run the migration endpoint /migrate/subcontracting-tables in this environment first.",
        );
      }

      throw new BadRequestException(
        `Subcontracting schema setup failed: ${error.message}`,
      );
    })();

    return this.schemaReady;
  }

  private async generateNumber(
    tenantId: string,
    table: string,
    prefix: string,
  ) {
    const { count } = await this.supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    return `${prefix}-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(4, "0")}`;
  }

  private async generateDocumentNumber(
    tenantId: string,
    movementType: string,
    prefix: string,
  ) {
    const { count } = await this.supabase
      .from("subcontract_movements")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("movement_type", movementType);
    return `${prefix}-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(5, "0")}`;
  }

  /**
   * Normalise the route editor payload into an acyclic production/process tree.
   * Roots consume the route raw material; a child consumes the accepted output
   * from its parent.  Legacy routes without parent_node_key remain a linear
   * sequence so historical routes continue to work unchanged.
   */
  private normaliseTreeSteps(rawSteps: any[], body: any) {
    const hasExplicitTree = rawSteps.some(
      (step) => text(step.node_key) || text(step.parent_node_key),
    );
    const nodes = rawSteps.map((raw, index) => ({
      ...raw,
      sequence_no: num(raw.sequence_no, index + 1),
      node_key: text(raw.node_key) || `NODE-${index + 1}`,
      parent_node_key:
        text(raw.parent_node_key) ||
        (hasExplicitTree || index === 0 ? "" : `NODE-${index}`),
      branch_no: num(raw.branch_no, index + 1),
      default_input_qty: num(raw.default_input_qty),
      default_output_qty: num(raw.default_output_qty),
    }));
    const byKey = new Map<string, any>();
    for (const node of nodes) {
      if (byKey.has(node.node_key))
        throw new BadRequestException(
          `Duplicate process node key: ${node.node_key}`,
        );
      byKey.set(node.node_key, node);
    }
    for (const node of nodes) {
      if (node.parent_node_key && !byKey.has(node.parent_node_key)) {
        throw new BadRequestException(
          `Parent operation for ${node.operation_name || node.node_key} was not found`,
        );
      }
      if (node.parent_node_key === node.node_key)
        throw new BadRequestException("An operation cannot be its own parent");
    }
    const visiting = new Set<string>();
    const checked = new Set<string>();
    const visit = (key: string) => {
      if (visiting.has(key))
        throw new BadRequestException(
          "Subcontract process tree contains a circular dependency",
        );
      if (checked.has(key)) return;
      visiting.add(key);
      const parent = byKey.get(key)?.parent_node_key;
      if (parent) visit(parent);
      visiting.delete(key);
      checked.add(key);
    };
    nodes.forEach((node) => visit(node.node_key));

    const orderedNodes = nodes.sort((a, b) => a.sequence_no - b.sequence_no);

    // Weight-based routes are calculated, never allocated.  A root's raw
    // material is pieces × input weight/pc.  A downstream step gets the
    // parent output weight/pc automatically; its own output weight determines
    // its scrap.  Legacy routes keep their historical quantity behaviour.
    if (hasExplicitTree) {
      const sourceItemId = text(body.input_item_id);
      if (!sourceItemId)
        throw new BadRequestException(
          "Select the source material issued to the subcontractor",
        );
      const weightBased = orderedNodes.some(
        (node) =>
          num(node.input_weight_per_piece) > 0 ||
          num(node.output_weight_per_piece) > 0,
      );

      for (const node of orderedNodes) {
        if (!text(node.output_item_id)) {
          throw new BadRequestException(
            `Select an output item for ${node.operation_name || node.node_key}`,
          );
        }
        if (node.default_output_qty < 0) {
          throw new BadRequestException(
            `Output quantity cannot be negative for ${node.operation_name || node.node_key}`,
          );
        }

        if (!node.parent_node_key) {
          node.input_item_id = sourceItemId;
          if (weightBased) {
            if (
              num(node.input_weight_per_piece) <= 0 ||
              num(node.output_weight_per_piece) <= 0
            ) {
              throw new BadRequestException(
                `Enter input and output weight per piece for ${node.operation_name || node.node_key}`,
              );
            }
            node.default_input_qty =
              num(node.default_output_qty) * num(node.input_weight_per_piece);
            node.planned_input_weight = node.default_input_qty;
            node.planned_output_weight =
              num(node.default_output_qty) * num(node.output_weight_per_piece);
            node.calculated_scrap_weight = Math.max(
              0,
              num(node.planned_input_weight) - num(node.planned_output_weight),
            );
          }
          continue;
        }

        const parent = byKey.get(node.parent_node_key);
        if (num(parent.sequence_no) >= num(node.sequence_no)) {
          throw new BadRequestException(
            `The parent operation must be before ${node.operation_name || node.node_key}`,
          );
        }
        if (!text(parent.output_item_id)) {
          throw new BadRequestException(
            `Select the parent output item before adding ${node.operation_name || node.node_key}`,
          );
        }
        node.input_item_id = parent.output_item_id;
        if (weightBased) {
          node.default_input_qty = num(parent.default_output_qty);
          node.input_weight_per_piece = num(parent.output_weight_per_piece);
          if (num(node.output_weight_per_piece) <= 0) {
            throw new BadRequestException(
              `Enter output weight per piece for ${node.operation_name || node.node_key}`,
            );
          }
          node.planned_input_weight =
            num(node.default_input_qty) * num(node.input_weight_per_piece);
          node.planned_output_weight =
            num(node.default_output_qty) * num(node.output_weight_per_piece);
          node.calculated_scrap_weight = Math.max(
            0,
            num(node.planned_input_weight) - num(node.planned_output_weight),
          );
        }
      }

      if (weightBased) {
        body.default_input_qty = orderedNodes
          .filter((node) => !node.parent_node_key)
          .reduce((total, node) => total + num(node.planned_input_weight), 0);
        body.total_input_weight = body.default_input_qty;
        body.total_output_weight = orderedNodes
          .filter((node) => !node.parent_node_key)
          .reduce((total, node) => total + num(node.planned_output_weight), 0);
        body.calculated_scrap_weight = Math.max(
          0,
          num(body.total_input_weight) - num(body.total_output_weight),
        );
      }

      // A parent output may feed more than one downstream process, but each
      // downstream branch must reserve a defined portion of that output. This
      // prevents the same 100 m (or any other quantity) being reused by every
      // branch of the tree.
      for (const parent of orderedNodes) {
        if (weightBased) continue;
        const childAllocation = orderedNodes
          .filter((node) => node.parent_node_key === parent.node_key)
          .reduce((total, node) => total + num(node.default_input_qty), 0);
        if (childAllocation > num(parent.default_output_qty) + 0.0001) {
          throw new BadRequestException(
            `Downstream allocations (${childAllocation}) exceed the expected output (${num(parent.default_output_qty)}) of ${parent.operation_name || parent.node_key}`,
          );
        }
      }
    }

    return orderedNodes;
  }

  private async getWipWarehouse(req: RequestWithUser) {
    const { tenantId } = req.user;
    const { data: found, error: findError } = await this.supabase
      .from("warehouses")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("code", "SUBCON_WIP")
      .maybeSingle();
    if (findError) throw new BadRequestException(findError.message);
    if (found?.id) return found;

    const basePayload = {
      tenant_id: tenantId,
      code: "SUBCON_WIP",
      name: "Subcontracting WIP",
      is_active: true,
    } as any;
    const enrichedPayload = {
      ...basePayload,
      type: "WIP",
      metadata: {
        system: true,
        purpose: "Vendor held outside processing stock",
      },
    } as any;

    let insert = await this.supabase
      .from("warehouses")
      .insert(enrichedPayload)
      .select("id, code, name")
      .single();
    if (insert.error && isMissingSchemaError(insert.error)) {
      insert = await this.supabase
        .from("warehouses")
        .insert(basePayload)
        .select("id, code, name")
        .single();
    }
    if (insert.error) throw new BadRequestException(insert.error.message);
    return insert.data;
  }

  private async getDefaultWarehouse(req: RequestWithUser) {
    const { tenantId } = req.user;
    const { data, error } = await this.supabase
      .from("warehouses")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("code", { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const rows = data || [];
    const main = rows.find((row: any) =>
      String(row.code || "")
        .toUpperCase()
        .includes("MAIN"),
    );
    return main || rows[0] || null;
  }

  private async moveStock(req: RequestWithUser, data: any) {
    if (!data.item_id || num(data.quantity) <= 0) return null;
    return this.inventoryService.createStockMovement(req as any, {
      movement_type: "TRANSFER",
      item_id: data.item_id,
      quantity: num(data.quantity),
      from_warehouse_id: data.from_warehouse_id || null,
      to_warehouse_id: data.to_warehouse_id || null,
      reference_type: "SUBCONTRACTING",
      reference_id: data.reference_id,
      reference_number: data.reference_number,
      notes: data.notes,
    });
  }

  async dashboard(req: RequestWithUser) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    const [orders, routes, steps, issues] = await Promise.all([
      this.supabase
        .from("subcontract_orders")
        .select("id, status", { count: "exact" })
        .eq("tenant_id", tenantId),
      this.supabase
        .from("subcontract_routes")
        .select("id, status", { count: "exact" })
        .eq("tenant_id", tenantId),
      this.supabase
        .from("subcontract_order_steps")
        .select(
          "id, status, issued_qty, accepted_qty, invoice_status, payable_amount, paid_amount",
        )
        .eq("tenant_id", tenantId),
      this.supabase
        .from("subcontract_movements")
        .select("id, quantity, remaining_qty")
        .eq("tenant_id", tenantId)
        .eq("movement_type", "SUBCON_SIV"),
    ]);

    if (orders.error) {
      if (isMissingSchemaError(orders.error)) return emptyDashboard();
      throw new BadRequestException(orders.error.message);
    }
    if (routes.error) {
      if (isMissingSchemaError(routes.error)) return emptyDashboard();
      throw new BadRequestException(routes.error.message);
    }
    if (steps.error) {
      if (isMissingSchemaError(steps.error)) return emptyDashboard();
      throw new BadRequestException(steps.error.message);
    }
    if (issues.error) {
      if (isMissingSchemaError(issues.error)) return emptyDashboard();
      throw new BadRequestException(issues.error.message);
    }

    const stepRows = steps.data || [];
    const openSteps = stepRows.filter((s: any) =>
      [
        "READY",
        "IN_PROCESS",
        "ISSUED",
        "PENDING_QC",
        "PARTIALLY_RECEIVED",
      ].includes(String(s.status)),
    ).length;
    // One service order has one route-level outward challan. WIP must come
    // from that challan balance, not from six duplicated output-step balances.
    const vendorHeldQty = (issues.data || []).reduce(
      (sum: number, issue: any) => {
        return sum + Math.max(0, num(issue.remaining_qty, num(issue.quantity)));
      },
      0,
    );
    const pendingInvoiceSteps = stepRows.filter((s: any) =>
      ["INVOICE_RECEIVED", "PENDING_PAYMENT"].includes(
        String(s.invoice_status),
      ),
    ).length;
    const subcontractPayable = stepRows.reduce(
      (sum: number, s: any) =>
        sum + Math.max(0, num(s.payable_amount) - num(s.paid_amount)),
      0,
    );

    return {
      totalOrders: orders.count || 0,
      openOrders: (orders.data || []).filter(
        (o: any) => !["COMPLETED", "CANCELLED"].includes(String(o.status)),
      ).length,
      activeRoutes: (routes.data || []).filter(
        (r: any) => r.status === "ACTIVE",
      ).length,
      openSteps,
      vendorHeldQty,
      pendingInvoiceSteps,
      subcontractPayable,
    };
  }

  async listRoutes(req: RequestWithUser, query: any = {}) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    let request = this.supabase
      .from("subcontract_routes")
      .select(
        "id, tenant_id, route_number, name, input_item_id, output_item_id, default_input_qty, default_output_qty, uom, status, notes, created_at, input_item:items!subcontract_routes_input_item_id_fkey(id, code, name, uom), output_item:items!subcontract_routes_output_item_id_fkey(id, code, name, uom), steps:subcontract_route_steps(id, route_id, sequence_no, node_key, parent_node_key, branch_no, operation_name, process_type, vendor_id, input_item_id, output_item_id, default_input_qty, default_output_qty, output_uom, output_size)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (query.status) request = request.eq("status", query.status);
    const { data, error } = await request;
    if (error) {
      const fallback = await this.supabase
        .from("subcontract_routes")
        .select("*, steps:subcontract_route_steps(*)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (fallback.error) {
        if (isMissingSchemaError(fallback.error)) return [];
        throw new BadRequestException(fallback.error.message);
      }
      return fallback.data || [];
    }
    return data || [];
  }

  async createRoute(req: RequestWithUser, body: any) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const rawSteps = Array.isArray(body.steps) ? body.steps : [];
    if (!text(body.name))
      throw new BadRequestException("Route name is required");
    if (rawSteps.length === 0)
      throw new BadRequestException("At least one operation step is required");
    const steps = this.normaliseTreeSteps(rawSteps, body);
    if (!body.input_item_id)
      throw new BadRequestException(
        "Select the raw material to be issued for this route",
      );
    const isTreeRoute = rawSteps.some(
      (step: any) => text(step.node_key) || text(step.parent_node_key),
    );
    if (isTreeRoute && steps.some((step) => !step.output_item_id)) {
      throw new BadRequestException(
        "Select an output item for every process branch",
      );
    }
    const outputIds = steps
      .map((step) => text(step.output_item_id))
      .filter(Boolean);
    const duplicateOutput = outputIds.find(
      (id, index) => outputIds.indexOf(id) !== index,
    );
    if (duplicateOutput)
      throw new BadRequestException(
        "Each route output product must be unique; duplicate output item entries are not allowed.",
      );

    // A legacy route has one header output.  For a process tree that value is
    // merely the route's primary reporting output; derive it from the first
    // terminal node so a co-product route does not require duplicate entry.
    const parentKeys = new Set(
      steps.map((step) => text(step.parent_node_key)).filter(Boolean),
    );
    const primaryOutputItemId =
      body.output_item_id ||
      steps.find((step) => !parentKeys.has(text(step.node_key)))
        ?.output_item_id ||
      steps[0]?.output_item_id ||
      null;
    if (!primaryOutputItemId)
      throw new BadRequestException("Select at least one route output item");

    const routeNumber =
      text(body.route_number) ||
      (await this.generateNumber(tenantId, "subcontract_routes", "SUBR"));
    const { data: route, error } = await this.supabase
      .from("subcontract_routes")
      .insert({
        tenant_id: tenantId,
        route_number: routeNumber,
        name: text(body.name),
        input_item_id: body.input_item_id || null,
        output_item_id: primaryOutputItemId,
        default_input_qty: num(body.default_input_qty),
        default_output_qty: num(body.default_output_qty),
        consumption_per_output_qty: num(body.consumption_per_output_qty),
        expected_consumption_qty: num(body.expected_consumption_qty),
        expected_unused_qty: num(body.expected_unused_qty),
        piece_size: num(body.piece_size) || null,
        size_uom: text(body.size_uom) || null,
        input_weight_per_piece: num(body.input_weight_per_piece) || null,
        output_weight_per_piece: num(body.output_weight_per_piece) || null,
        total_input_weight:
          num(body.total_input_weight || body.default_input_qty) || null,
        total_output_weight: num(body.total_output_weight) || null,
        calculated_scrap_weight: num(body.calculated_scrap_weight) || null,
        uom: text(body.uom),
        status: text(body.status, "ACTIVE") || "ACTIVE",
        notes: text(body.notes),
        created_by: userId,
      } as any)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    const outputUoms = await this.itemUomMap(
      tenantId,
      steps.map((step: any) => step.output_item_id || primaryOutputItemId),
    );
    const stepRows = steps.map((step: any, index: number) => ({
      tenant_id: tenantId,
      route_id: route.id,
      sequence_no: Number(step.sequence_no || index + 1),
      node_key: step.node_key,
      parent_node_key: step.parent_node_key || null,
      branch_no: step.branch_no || index + 1,
      operation_name: text(step.operation_name) || `Operation ${index + 1}`,
      process_type:
        text(step.process_type, "OUTSIDE_PROCESSING") || "OUTSIDE_PROCESSING",
      vendor_id: step.vendor_id || null,
      department: text(step.department),
      input_item_id: step.input_item_id || body.input_item_id || null,
      output_item_id: step.output_item_id || primaryOutputItemId,
      output_uom:
        outputUoms.get(text(step.output_item_id || primaryOutputItemId)) ||
        text(step.output_uom).toUpperCase() ||
        null,
      output_size: num(step.output_size) || null,
      default_input_qty: num(step.default_input_qty),
      default_output_qty: num(step.default_output_qty),
      input_weight_per_piece: num(step.input_weight_per_piece) || null,
      output_weight_per_piece: num(step.output_weight_per_piece) || null,
      planned_input_weight: num(step.planned_input_weight) || null,
      planned_output_weight: num(step.planned_output_weight) || null,
      calculated_scrap_weight: num(step.calculated_scrap_weight) || null,
      standard_yield_pct: num(step.standard_yield_pct, 100),
      scrap_tolerance_pct: num(step.scrap_tolerance_pct),
      qc_required: step.qc_required !== false,
      instructions: text(step.instructions),
    }));

    const { error: stepError } = await this.supabase
      .from("subcontract_route_steps")
      .insert(stepRows as any);
    if (stepError) throw new BadRequestException(stepError.message);
    return this.findRoute(req, route.id);
  }

  async updateRoute(req: RequestWithUser, routeId: string, body: any) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const { count, error: countError } = await this.supabase
      .from("subcontract_orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("route_id", routeId);
    if (countError) throw new BadRequestException(countError.message);
    if (Number(count || 0) > 0) {
      throw new BadRequestException(
        "This route is already used by subcontracting orders and cannot be changed. Create a revised route instead.",
      );
    }

    const rawSteps = Array.isArray(body.steps) ? body.steps : [];
    if (!text(body.name))
      throw new BadRequestException("Route name is required");
    if (!body.input_item_id)
      throw new BadRequestException(
        "Select the raw material to be issued for this route",
      );
    if (!rawSteps.length)
      throw new BadRequestException("At least one operation step is required");
    const steps = this.normaliseTreeSteps(rawSteps, body);
    const outputIds = steps
      .map((step) => text(step.output_item_id))
      .filter(Boolean);
    const duplicateOutput = outputIds.find(
      (id, index) => outputIds.indexOf(id) !== index,
    );
    if (duplicateOutput)
      throw new BadRequestException(
        "Each route output product must be unique; duplicate output item entries are not allowed.",
      );
    const parentKeys = new Set(
      steps.map((step) => text(step.parent_node_key)).filter(Boolean),
    );
    const primaryOutputItemId =
      body.output_item_id ||
      steps.find((step) => !parentKeys.has(text(step.node_key)))
        ?.output_item_id ||
      steps[0]?.output_item_id ||
      null;
    if (!primaryOutputItemId)
      throw new BadRequestException("Select at least one route output item");

    const { error: routeError } = await this.supabase
      .from("subcontract_routes")
      .update({
        name: text(body.name),
        input_item_id: body.input_item_id,
        output_item_id: primaryOutputItemId,
        default_input_qty: num(body.default_input_qty),
        default_output_qty: num(body.default_output_qty),
        consumption_per_output_qty: num(body.consumption_per_output_qty),
        expected_consumption_qty: num(body.expected_consumption_qty),
        expected_unused_qty: num(body.expected_unused_qty),
        piece_size: num(body.piece_size) || null,
        size_uom: text(body.size_uom) || null,
        input_weight_per_piece: num(body.input_weight_per_piece) || null,
        output_weight_per_piece: num(body.output_weight_per_piece) || null,
        total_input_weight:
          num(body.total_input_weight || body.default_input_qty) || null,
        total_output_weight: num(body.total_output_weight) || null,
        calculated_scrap_weight: num(body.calculated_scrap_weight) || null,
        uom: text(body.uom),
        status: text(body.status, "ACTIVE") || "ACTIVE",
        notes: text(body.notes),
        created_by: userId,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", routeId);
    if (routeError) throw new BadRequestException(routeError.message);

    const { error: deleteStepsError } = await this.supabase
      .from("subcontract_route_steps")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("route_id", routeId);
    if (deleteStepsError)
      throw new BadRequestException(deleteStepsError.message);
    const outputUoms = await this.itemUomMap(
      tenantId,
      steps.map((step: any) => step.output_item_id || primaryOutputItemId),
    );
    const stepRows = steps.map((step: any, index: number) => ({
      tenant_id: tenantId,
      route_id: routeId,
      sequence_no: Number(step.sequence_no || index + 1),
      node_key: step.node_key,
      parent_node_key: step.parent_node_key || null,
      branch_no: step.branch_no || index + 1,
      operation_name: text(step.operation_name) || `Operation ${index + 1}`,
      process_type:
        text(step.process_type, "OUTSIDE_PROCESSING") || "OUTSIDE_PROCESSING",
      vendor_id: step.vendor_id || null,
      department: text(step.department),
      input_item_id: step.input_item_id || body.input_item_id || null,
      output_item_id: step.output_item_id || primaryOutputItemId,
      output_uom:
        outputUoms.get(text(step.output_item_id || primaryOutputItemId)) ||
        text(step.output_uom).toUpperCase() ||
        null,
      output_size: num(step.output_size) || null,
      default_input_qty: num(step.default_input_qty),
      default_output_qty: num(step.default_output_qty),
      input_weight_per_piece: num(step.input_weight_per_piece) || null,
      output_weight_per_piece: num(step.output_weight_per_piece) || null,
      planned_input_weight: num(step.planned_input_weight) || null,
      planned_output_weight: num(step.planned_output_weight) || null,
      calculated_scrap_weight: num(step.calculated_scrap_weight) || null,
      standard_yield_pct: num(step.standard_yield_pct, 100),
      scrap_tolerance_pct: num(step.scrap_tolerance_pct),
      qc_required: step.qc_required !== false,
      instructions: text(step.instructions),
    }));
    const { error: stepError } = await this.supabase
      .from("subcontract_route_steps")
      .insert(stepRows as any);
    if (stepError) throw new BadRequestException(stepError.message);
    return this.findRoute(req, routeId);
  }

  async deleteRoute(req: RequestWithUser, routeId: string) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    const { count, error: countError } = await this.supabase
      .from("subcontract_orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("route_id", routeId);
    if (countError) throw new BadRequestException(countError.message);
    if (Number(count || 0) > 0)
      throw new BadRequestException(
        "This route is already used by subcontracting orders and cannot be deleted.",
      );
    const { error } = await this.supabase
      .from("subcontract_routes")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", routeId);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  private async findRoute(req: RequestWithUser, routeId: string) {
    const { tenantId } = req.user;
    const { data, error } = await this.supabase
      .from("subcontract_routes")
      .select("*, steps:subcontract_route_steps(*)")
      .eq("tenant_id", tenantId)
      .eq("id", routeId)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Receipt quantities are line-level facts. Legacy/current posting stores the
   * route-level receipt total on the first order step, so step.accepted_qty is
   * not a reliable per-product balance. Hydrate every order from its actual GRN
   * lines and expose receipt_received_qty on the matching output step.
   */
  private async hydrateReceiptProgress(tenantId: string, orders: any[]) {
    if (!orders.length) return orders;
    const receiptMovements = orders.flatMap((order: any) =>
      (order.movements || []).filter(
        (movement: any) =>
          movement.movement_type === "SUBCON_SRV" &&
          !["CANCELLED", "REVERSED"].includes(
            String(movement.qc_status || "").toUpperCase(),
          ),
      ),
    );
    const receiptIds = receiptMovements
      .map((movement: any) => movement.id)
      .filter(Boolean);
    const receiptOrderById = new Map(
      receiptMovements.map((movement: any) => [movement.id, movement.order_id]),
    );
    const receivedByOrderItem = new Map<string, number>();
    if (receiptIds.length) {
      const { data: lines, error } = await this.supabase
        .from("subcontract_receipt_lines")
        .select("receipt_movement_id, item_id, quantity, line_type")
        .eq("tenant_id", tenantId)
        .in("receipt_movement_id", receiptIds)
        .eq("line_type", "FINISHED_GOOD");
      if (error) throw new BadRequestException(error.message);
      for (const line of lines || []) {
        const orderId = receiptOrderById.get((line as any).receipt_movement_id);
        if (!orderId || !(line as any).item_id) continue;
        const key = `${orderId}:${(line as any).item_id}`;
        receivedByOrderItem.set(
          key,
          num(receivedByOrderItem.get(key)) + num((line as any).quantity),
        );
      }
    }
    return orders.map((order: any) => {
      const steps = (order.steps || []).map((step: any) => ({
        ...step,
        receipt_received_qty: num(
          receivedByOrderItem.get(`${order.id}:${step.output_item_id}`),
        ),
      }));
      const roots = steps.filter(
        (step: any) => !text(step.parent_node_key) && step.output_item_id,
      );
      const allFinishedGoodsReceived =
        roots.length > 0 &&
        roots.every(
          (step: any) =>
            num(step.receipt_received_qty) + 0.0001 >=
            num(step.planned_output_qty),
        );
      const pendingQc = (order.movements || []).some(
        (movement: any) =>
          movement.movement_type === "SUBCON_SRV" &&
          String(movement.qc_status || "").toUpperCase() === "PENDING_QC",
      );
      const openIssue = (order.movements || []).find(
        (movement: any) =>
          movement.movement_type === "SUBCON_SIV" &&
          num(movement.remaining_qty, num(movement.quantity)) > 0.01,
      );
      const status =
        allFinishedGoodsReceived && openIssue && !pendingQc
          ? "RM_BALANCE_PENDING"
          : order.status;
      return {
        ...order,
        status,
        steps,
        all_finished_goods_received: allFinishedGoodsReceived,
      };
    });
  }

  async listOrders(req: RequestWithUser, query: any = {}) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    let request = this.supabase
      .from("subcontract_orders")
      .select(
        "id, order_number, requisition_number, approval_status, submitted_by, submitted_at, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, route_id, source_warehouse_id, output_warehouse_id, input_item_id, output_item_id, planned_input_qty, planned_output_qty, input_uom, secondary_input_qty, secondary_input_uom, remaining_raw_material_weight, remaining_secondary_input_qty, status, current_step_no, notes, created_at, route:subcontract_routes(id, route_number, name), steps:subcontract_order_steps(id, order_id, route_step_id, sequence_no, node_key, parent_node_key, parent_order_step_id, branch_no, operation_name, process_type, vendor_id, input_item_id, output_item_id, planned_input_qty, planned_output_qty, issued_qty, received_qty, accepted_qty, rejected_qty, scrap_qty, unused_return_qty, status, processing_rate, processing_amount, tax_percent, tax_amount, freight_amount, other_charges_amount, deduction_amount, payable_amount, paid_amount, invoice_number, invoice_date, invoice_status, payment_reference, payment_date, output_uom, output_size, unit_price, hsn_code, discount_percent), movements:subcontract_movements(id, order_id, order_step_id, issue_movement_id, movement_type, item_id, quantity, remaining_qty, consumed_qty, accepted_qty, rejected_qty, scrap_qty, unused_return_qty, processing_rate, processing_amount, tax_percent, tax_amount, freight_amount, other_charges_amount, deduction_amount, payable_amount, paid_amount, invoice_number, invoice_date, invoice_status, qc_status, document_number, reference_number, external_reference, notes, vendor_id, warehouse_id, from_warehouse_id, to_warehouse_id, created_at), reconciliation:subcontract_reconciliations(*)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (query.status) request = request.eq("status", query.status);
    const { data, error } = await request;
    if (error) {
      throw new BadRequestException(error.message);
    }
    return this.hydrateReceiptProgress(tenantId, data || []);
  }

  async getOrder(req: RequestWithUser, orderId: string) {
    await this.ensureSchema();
    return this.findOrder(req, orderId);
  }

  async createOrder(req: RequestWithUser, body: any) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    if (!body.route_id) throw new BadRequestException("Route is required");
    const clientRequestId = text(body.client_request_id).slice(0, 120) || null;
    // A browser retry must return the order made by the original request. This
    // protects users from slow connections, double-clicks and repeated submits.
    if (clientRequestId) {
      const { data: existing, error: existingError } = await this.supabase
        .from("subcontract_orders")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("client_request_id", clientRequestId)
        .maybeSingle();
      if (existingError) throw new BadRequestException(existingError.message);
      if (existing?.id) {
        const order = await this.findOrder(req, existing.id);
        return {
          ...order,
          order_number: (order as any).order_number,
          order,
          idempotent: true,
        };
      }
    }
    const defaultWarehouse =
      !body.source_warehouse_id || !body.output_warehouse_id
        ? await this.getDefaultWarehouse(req)
        : null;
    const sourceWarehouseId = body.source_warehouse_id || defaultWarehouse?.id;
    const outputWarehouseId = body.output_warehouse_id || defaultWarehouse?.id;
    if (!sourceWarehouseId)
      throw new BadRequestException("Source warehouse is required");
    if (!outputWarehouseId)
      throw new BadRequestException("Output warehouse is required");

    const route = await this.findRoute(req, body.route_id);
    const steps = [...(route.steps || [])].sort(
      (a: any, b: any) => num(a.sequence_no) - num(b.sequence_no),
    );
    if (steps.length === 0)
      throw new BadRequestException("Selected route has no operation steps");
    const outputLines = Array.isArray(body.output_lines)
      ? body.output_lines
      : [];
    const outputByNode = new Map(
      outputLines.map((line: any) => [text(line.node_key), line]),
    );
    const outputUoms = await this.itemUomMap(
      tenantId,
      steps.map((step: any) => step.output_item_id),
    );
    for (const step of steps) {
      const line: any = outputByNode.get(text(step.node_key));
      if (line) {
        step.default_output_qty = num(
          line.quantity,
          num(step.default_output_qty),
        );
        step.output_uom =
          outputUoms.get(text(step.output_item_id)) ||
          text(line.uom).toUpperCase() ||
          text(step.output_uom).toUpperCase();
        step.output_size = num(line.size) || null;
        step.unit_price = num(line.price);
        step.hsn_code = text(line.hsn_code);
        step.discount_percent = num(line.discount_percent);
      }
    }
    const orderVendorId =
      body.vendor_id ||
      steps.find((step: any) => step.vendor_id)?.vendor_id ||
      null;
    if (!orderVendorId)
      throw new BadRequestException("Vendor is required for the work order");
    // A work order has one contractor. Carry that vendor onto every operation
    // so all SIV/GRN movements and the payable remain with the same supplier.
    for (const step of steps) step.vendor_id = orderVendorId;

    const orderNumber = await this.generateNumber(
      tenantId,
      "subcontract_orders",
      "SPO",
    );
    const requisitionNumber = await this.generateNumber(
      tenantId,
      "subcontract_orders",
      "SCPR",
    );
    const weightBased = steps.some(
      (step: any) =>
        num(step.input_weight_per_piece) > 0 ||
        num(step.output_weight_per_piece) > 0,
    );
    const rootSteps = steps.filter((step: any) => !text(step.parent_node_key));
    const { data: inputItem } = await this.supabase
      .from("items")
      .select("id, uom")
      .eq("tenant_id", tenantId)
      .eq("id", route.input_item_id)
      .maybeSingle();
    const inputUom = text(
      (inputItem as any)?.uom || route.uom || body.input_uom,
    ).toUpperCase();
    const requiresLength = requiresSecondaryLength(
      route.input_item_id,
      inputUom,
      rootSteps,
    );
    const plannedInput = num(
      body.planned_input_qty,
      num(route.default_input_qty),
    );
    const plannedLength = requiresLength ? num(body.secondary_input_qty) : 0;
    const plannedOutput = outputLines.reduce(
      (sum: number, line: any) => sum + num(line.quantity),
      0,
    );
    if (plannedInput <= 0)
      throw new BadRequestException(
        "Enter the input-material quantity for the work order",
      );
    if (!inputUom)
      throw new BadRequestException(
        "The input material must have a UOM in the item master",
      );
    if (requiresLength && plannedLength <= 0)
      throw new BadRequestException(
        "Enter the raw-material length because the input and output materials are different",
      );
    if (rootSteps.some((step: any) => num(step.default_output_qty) <= 0))
      throw new BadRequestException(
        "Enter output quantity for every output product line",
      );
    if (rootSteps.some((step: any) => num(step.output_size) <= 0))
      throw new BadRequestException(
        "Enter the output size in MM for every output product line",
      );

    const { data: order, error } = await this.supabase
      .from("subcontract_orders")
      .insert({
        tenant_id: tenantId,
        order_number: orderNumber,
        route_id: route.id,
        source_warehouse_id: sourceWarehouseId,
        output_warehouse_id: outputWarehouseId,
        input_item_id: route.input_item_id,
        output_item_id: route.output_item_id,
        planned_input_qty: plannedInput,
        planned_output_qty: plannedOutput,
        input_uom: inputUom,
        secondary_input_qty: plannedLength,
        secondary_input_uom: requiresLength ? "MTR" : null,
        total_input_weight: plannedInput,
        remaining_raw_material_weight: plannedInput,
        remaining_secondary_input_qty: plannedLength,
        status: "DRAFT",
        requisition_number: requisitionNumber,
        approval_status: "DRAFT",
        current_step_no: 1,
        notes: text(body.notes),
        created_by: userId,
        client_request_id: clientRequestId,
      } as any)
      .select()
      .single();
    if (error) {
      // Concurrent requests can both pass the pre-read. The unique index is
      // the final authority; return its already-created order to the retry.
      if (
        clientRequestId &&
        /duplicate key|unique constraint/i.test(String(error.message || ""))
      ) {
        const { data: existing } = await this.supabase
          .from("subcontract_orders")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("client_request_id", clientRequestId)
          .maybeSingle();
        if (existing?.id) {
          const existingOrder = await this.findOrder(req, existing.id);
          return {
            ...existingOrder,
            order_number: (existingOrder as any).order_number,
            order: existingOrder,
            idempotent: true,
          };
        }
      }
      throw new BadRequestException(error.message);
    }

    await this.supabase.from("subcontract_order_approval_history").insert({
      tenant_id: tenantId,
      order_id: order.id,
      action: "CREATED",
      to_status: "DRAFT",
      action_by: userId,
    } as any);

    const stepPlanByNode = new Map<string, { input: number; output: number }>();
    const roots = steps.filter((step: any) => !text(step.parent_node_key));
    const multipleRoots = roots.length > 1;
    const isTreeRoute = steps.some(
      (step: any) => text(step.node_key) || text(step.parent_node_key),
    );
    const routeSourceQty = num(route.default_input_qty);
    const sourceScale =
      isTreeRoute && routeSourceQty > 0 ? plannedInput / routeSourceQty : 1;
    const roundPlanQty = (value: number) =>
      Math.round(value * 1_000_000) / 1_000_000;
    for (const step of steps) {
      const parentPlan = text(step.parent_node_key)
        ? stepPlanByNode.get(text(step.parent_node_key))
        : null;
      const configuredInput = num(step.default_input_qty);
      const configuredOutput = num(step.default_output_qty);
      let input: number;
      let output: number;

      if (weightBased && parentPlan) {
        input = parentPlan.output;
        output =
          configuredOutput > 0
            ? roundPlanQty(configuredOutput * sourceScale)
            : input;
      } else if (weightBased) {
        input = roundPlanQty(configuredInput * sourceScale);
        output =
          configuredOutput > 0
            ? roundPlanQty(configuredOutput * sourceScale)
            : plannedOutput;
      } else if (isTreeRoute && parentPlan) {
        // A child receives only its configured allocation of its direct
        // parent's output. The allocation is scaled with the parent plan, so
        // one 100 m source can split across six products without being issued
        // six times. Sequential operations simply allocate the full parent
        // output to their only child.
        const parentRouteStep = steps.find(
          (candidate: any) =>
            text(candidate.node_key) === text(step.parent_node_key),
        );
        const parentConfiguredOutput = num(parentRouteStep?.default_output_qty);
        const parentScale =
          parentConfiguredOutput > 0
            ? parentPlan.output / parentConfiguredOutput
            : 1;
        const childConfiguredInput =
          configuredInput > 0 ? configuredInput : parentConfiguredOutput;
        input = roundPlanQty(childConfiguredInput * parentScale);
        output =
          configuredOutput > 0 && childConfiguredInput > 0
            ? roundPlanQty(input * (configuredOutput / childConfiguredInput))
            : roundPlanQty((input * num(step.standard_yield_pct, 100)) / 100);
      } else if (isTreeRoute) {
        // Each root receives its proportional allocation from the one source
        // issue. Scaling preserves the route recipe for a different order size.
        // Quantity fields on the route step may be blank (the UI derives
        // them from the order/header). Fall back to the order quantities so
        // a root Machining/processing step is still planned correctly.
        const rootCount = Math.max(1, roots.length);
        const fallbackInput =
          plannedInput > 0
            ? plannedInput / rootCount
            : plannedOutput > 0
              ? plannedOutput / rootCount
              : 0;
        const fallbackOutput =
          plannedOutput > 0 ? plannedOutput / rootCount : 0;
        input =
          configuredInput > 0
            ? roundPlanQty(configuredInput * sourceScale)
            : roundPlanQty(fallbackInput);
        output =
          configuredInput > 0 && configuredOutput > 0
            ? roundPlanQty(input * (configuredOutput / configuredInput))
            : configuredOutput > 0
              ? roundPlanQty(configuredOutput * sourceScale)
              : roundPlanQty(fallbackOutput);
      } else {
        input = parentPlan
          ? configuredInput || parentPlan.output
          : multipleRoots
            ? configuredInput
            : configuredInput || plannedInput;
        output =
          configuredOutput ||
          (parentPlan
            ? Math.round(input * num(step.standard_yield_pct, 100)) / 100
            : plannedOutput);
      }
      if (input <= 0 || output <= 0)
        throw new BadRequestException(
          `Planned quantities are required for ${step.operation_name}`,
        );
      stepPlanByNode.set(text(step.node_key) || `NODE-${step.sequence_no}`, {
        input,
        output,
      });
    }

    const orderSteps = steps.map((step: any, index: number) => {
      const nodeKey = text(step.node_key) || `NODE-${step.sequence_no}`;
      const plan = stepPlanByNode.get(nodeKey)!;
      return {
        tenant_id: tenantId,
        order_id: order.id,
        route_step_id: step.id,
        sequence_no: step.sequence_no,
        node_key: nodeKey,
        parent_node_key: text(step.parent_node_key) || null,
        branch_no: num(step.branch_no, index + 1),
        operation_name: step.operation_name,
        process_type: step.process_type,
        vendor_id: step.vendor_id,
        department: step.department,
        input_item_id: step.input_item_id || route.input_item_id,
        output_item_id: step.output_item_id || route.output_item_id,
        output_uom: text(step.output_uom) || null,
        output_size: num(step.output_size) || null,
        unit_price: num(step.unit_price),
        hsn_code: text(step.hsn_code) || null,
        discount_percent: num(step.discount_percent),
        planned_input_qty: plan.input,
        planned_output_qty: plan.output,
        input_weight_per_piece: num(step.input_weight_per_piece) || null,
        output_weight_per_piece: num(step.output_weight_per_piece) || null,
        planned_input_weight: weightBased
          ? !text(step.parent_node_key)
            ? plan.input
            : plan.input * num(step.input_weight_per_piece)
          : null,
        planned_output_weight: weightBased
          ? plan.output * num(step.output_weight_per_piece)
          : null,
        calculated_scrap_weight: weightBased
          ? Math.max(
              0,
              (!text(step.parent_node_key)
                ? plan.input
                : plan.input * num(step.input_weight_per_piece)) -
                plan.output * num(step.output_weight_per_piece),
            )
          : null,
        status: !text(step.parent_node_key) ? "READY" : "WAITING",
      };
    });
    const { data: createdSteps, error: stepsError } = await this.supabase
      .from("subcontract_order_steps")
      .insert(orderSteps as any)
      .select();
    if (stepsError) throw new BadRequestException(stepsError.message);
    const orderStepByNode = new Map(
      (createdSteps || []).map((step: any) => [text(step.node_key), step]),
    );
    for (const created of createdSteps || []) {
      if (!created.parent_node_key) continue;
      const parent = orderStepByNode.get(text(created.parent_node_key));
      if (!parent)
        throw new BadRequestException(
          `Order process parent ${created.parent_node_key} could not be linked`,
        );
      const { error: parentError } = await this.supabase
        .from("subcontract_order_steps")
        .update({ parent_order_step_id: parent.id } as any)
        .eq("tenant_id", tenantId)
        .eq("id", created.id);
      if (parentError) throw new BadRequestException(parentError.message);
    }
    const createdOrder = await this.findOrder(req, order.id);
    return {
      ...createdOrder,
      order_number: orderNumber,
      order: createdOrder,
    };
  }

  async updateOrder(req: RequestWithUser, orderId: string, body: any) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    const order = await this.findOrder(req, orderId);
    if (!["DRAFT", "OPEN", "READY"].includes(String(order.status || "").toUpperCase())) {
      throw new BadRequestException(
        "This work order cannot be edited after material movement has started",
      );
    }
    if ((order.movements || []).length > 0) {
      throw new BadRequestException(
        "This work order cannot be edited after stock movement",
      );
    }
    const inputItemId = text(order.input_item_id);
    const rootSteps = (order.steps || []).filter(
      (step: any) => !text(step.parent_node_key),
    );
    const { data: inputItem } = await this.supabase
      .from("items")
      .select("id, uom")
      .eq("tenant_id", tenantId)
      .eq("id", inputItemId)
      .maybeSingle();
    const inputUom = text(
      (inputItem as any)?.uom || order.input_uom || body.input_uom,
    ).toUpperCase();
    const requiresLength = requiresSecondaryLength(
      inputItemId,
      inputUom,
      rootSteps,
    );
    const plannedInput = num(body.planned_input_qty);
    const plannedLength = requiresLength ? num(body.secondary_input_qty) : 0;
    if (plannedInput <= 0)
      throw new BadRequestException(
        "Enter the input-material quantity for the work order",
      );
    if (!inputUom)
      throw new BadRequestException(
        "The input material must have a UOM in the item master",
      );
    if (requiresLength && plannedLength <= 0)
      throw new BadRequestException(
        "Enter the raw-material length because the input and output materials are different",
      );
    const lines = Array.isArray(body.output_lines) ? body.output_lines : [];
    const lineByNode = new Map(
      lines.map((line: any) => [text(line.node_key), line]),
    );
    const outputUoms = await this.itemUomMap(
      tenantId,
      (order.steps || []).map((step: any) => step.output_item_id),
    );
    for (const step of rootSteps) {
      const line = lineByNode.get(text(step.node_key));
      if (!line || num(line.quantity) <= 0)
        throw new BadRequestException(
          "Enter output quantity for every output product line",
        );
      if (num(line.size) <= 0)
        throw new BadRequestException(
          "Enter the output size in MM for every output product line",
        );
    }
    const plannedOutput = lines.reduce(
      (sum: number, line: any) => sum + num(line.quantity),
      0,
    );
    const { error } = await this.supabase
      .from("subcontract_orders")
      .update({
        source_warehouse_id:
          body.source_warehouse_id || order.source_warehouse_id,
        output_warehouse_id:
          body.output_warehouse_id || order.output_warehouse_id,
        planned_input_qty: plannedInput,
        planned_output_qty: plannedOutput,
        input_uom: inputUom,
        secondary_input_qty: plannedLength,
        secondary_input_uom: requiresLength ? "MTR" : null,
        total_input_weight: plannedInput,
        remaining_raw_material_weight: plannedInput,
        remaining_secondary_input_qty: plannedLength,
        notes: text(body.notes),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", orderId);
    if (error) throw new BadRequestException(error.message);
    for (const step of order.steps || []) {
      const line = lineByNode.get(text(step.node_key));
      if (!line) continue;
      const { error: stepError } = await this.supabase
        .from("subcontract_order_steps")
        .update({
          planned_output_qty: num(line.quantity),
          output_uom:
            outputUoms.get(text(step.output_item_id)) ||
            text(line.uom).toUpperCase() ||
            text(step.output_uom).toUpperCase(),
          output_size: num(line.size) || null,
          unit_price: num(line.price),
          hsn_code: text(line.hsn_code) || null,
          discount_percent: num(line.discount_percent),
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", step.id);
      if (stepError) throw new BadRequestException(stepError.message);
    }
    return this.findOrder(req, orderId);
  }

  async submitOrder(req: RequestWithUser, orderId: string) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const order = await this.findOrder(req, orderId);
    const status = String(order.status || "").toUpperCase();
    if (!['DRAFT', 'REJECTED'].includes(status) || (order.movements || []).length) {
      throw new BadRequestException('Only an unposted draft subcontract PR can be submitted for approval.');
    }
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('subcontract_orders').update({
      status: 'SUBMITTED', approval_status: 'SUBMITTED', submitted_by: userId,
      submitted_at: now, rejected_by: null, rejected_at: null, rejection_reason: null,
      updated_at: now,
    } as any).eq('tenant_id', tenantId).eq('id', orderId);
    if (error) throw new BadRequestException(error.message);
    await this.supabase.from('subcontract_order_approval_history').insert({
      tenant_id: tenantId, order_id: orderId, action: 'SUBMITTED', from_status: status,
      to_status: 'SUBMITTED', action_by: userId,
    } as any);
    return this.findOrder(req, orderId);
  }

  async approveOrder(req: RequestWithUser, orderId: string) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const order = await this.findOrder(req, orderId);
    if (String(order.status || '').toUpperCase() !== 'SUBMITTED') {
      throw new BadRequestException('Only a submitted subcontract PR can be approved.');
    }
    if (String((order as any).created_by || '') === String(userId || '')) {
      throw new BadRequestException('The maker cannot approve the same subcontract PR.');
    }
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('subcontract_orders').update({
      status: 'APPROVED', approval_status: 'APPROVED', approved_by: userId,
      approved_at: now, updated_at: now,
    } as any).eq('tenant_id', tenantId).eq('id', orderId);
    if (error) throw new BadRequestException(error.message);
    await this.supabase.from('subcontract_order_approval_history').insert({
      tenant_id: tenantId, order_id: orderId, action: 'APPROVED', from_status: 'SUBMITTED',
      to_status: 'APPROVED', action_by: userId,
    } as any);
    return this.findOrder(req, orderId);
  }

  async rejectOrder(req: RequestWithUser, orderId: string, reason: unknown) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const order = await this.findOrder(req, orderId);
    const rejectionReason = text(reason);
    if (!rejectionReason) throw new BadRequestException('A rejection reason is required.');
    if (String(order.status || '').toUpperCase() !== 'SUBMITTED') {
      throw new BadRequestException('Only a submitted subcontract PR can be rejected.');
    }
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('subcontract_orders').update({
      status: 'REJECTED', approval_status: 'REJECTED', rejected_by: userId,
      rejected_at: now, rejection_reason: rejectionReason, updated_at: now,
    } as any).eq('tenant_id', tenantId).eq('id', orderId);
    if (error) throw new BadRequestException(error.message);
    await this.supabase.from('subcontract_order_approval_history').insert({
      tenant_id: tenantId, order_id: orderId, action: 'REJECTED', from_status: 'SUBMITTED',
      to_status: 'REJECTED', reason: rejectionReason, action_by: userId,
    } as any);
    return this.findOrder(req, orderId);
  }

  private async findOrder(req: RequestWithUser, orderId: string) {
    const { tenantId } = req.user;
    const { data, error } = await this.supabase
      .from("subcontract_orders")
      // Receipt lines are loaded separately below.  The production schema has
      // existed with and without the PostgREST relationship metadata between a
      // movement and its receipt lines; nesting that relation makes the whole
      // order lookup fail even when the order itself exists.
      .select(
        "*, route:subcontract_routes(id, route_number, name), steps:subcontract_order_steps(*), movements:subcontract_movements(*)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", orderId)
      .single();
    if (error) throw new NotFoundException("Subcontracting order not found");
    const movementIds = (data?.movements || [])
      .map((movement: any) => movement.id)
      .filter(Boolean);
    if (movementIds.length) {
      const { data: receiptLines, error: receiptLinesError } =
        await this.supabase
          .from("subcontract_receipt_lines")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("receipt_movement_id", movementIds);
      if (receiptLinesError)
        throw new BadRequestException(receiptLinesError.message);
      const byMovement = new Map<string, any[]>();
      for (const line of receiptLines || []) {
        const movementId = String((line as any).receipt_movement_id || "");
        if (!movementId) continue;
        byMovement.set(movementId, [
          ...(byMovement.get(movementId) || []),
          line,
        ]);
      }
      data.movements = (data.movements || []).map((movement: any) => ({
        ...movement,
        receipt_lines: byMovement.get(String(movement.id)) || [],
      }));
    }
    const [hydrated] = await this.hydrateReceiptProgress(tenantId, [data]);
    return hydrated;
  }

  async issueOrder(req: RequestWithUser, orderId: string, body: any) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const order = await this.findOrder(req, orderId);
    const approvalStatus = String((order as any).approval_status || '').toUpperCase();
    if (approvalStatus && !['APPROVED', 'LEGACY_APPROVED'].includes(approvalStatus)) {
      throw new BadRequestException('Approve the subcontract PR before issuing material against the Subcontract PO.');
    }
    const roots = (order.steps || []).filter(
      (step: any) => !text(step.parent_node_key),
    );
    if (!roots.length)
      throw new BadRequestException(
        "This work order has no root output products",
      );
    const existing = (order.movements || []).find(
      (movement: any) =>
        movement.movement_type === "SUBCON_SIV" && !movement.order_step_id,
    );
    if (existing)
      throw new BadRequestException(
        `Material is already issued on ${existing.document_number}`,
      );
    // One subcontract order creates exactly one route-level MOC.  Its quantity
    // is the approved work-order input, not a user-editable partial issue.
    // Ignore a stale/UI-supplied quantity so the single Issue Material action
    // cannot accidentally create or reject a partial outward challan.
    const quantity = num(order.planned_input_qty);
    if (quantity <= 0)
      throw new BadRequestException(
        "Enter the total raw-material quantity to issue",
      );
    const wip = await this.getWipWarehouse(req);
    const documentNumber = await this.generateDocumentNumber(
      tenantId,
      "SUBCON_SIV",
      "MOC",
    );
    // A subcontract MOC is an outward issue from available stores. Vendor-held
    // quantity is controlled by the subcontract movement sub-ledger, not by a
    // second inventory warehouse balance. This keeps Stock Trail aligned with
    // the physical posting: the complete RM quantity is deducted once on MOC.
    await this.moveStock(req, {
      item_id: order.input_item_id,
      quantity,
      from_warehouse_id: order.source_warehouse_id,
      reference_id: order.id,
      reference_number: documentNumber,
      notes: `Material Outward Challan ${documentNumber} - route-level issue to subcontractor`,
    });
    const { error } = await this.supabase
      .from("subcontract_movements")
      .insert({
        tenant_id: tenantId,
        order_id: order.id,
        order_step_id: null,
        movement_type: "SUBCON_SIV",
        item_id: order.input_item_id,
        quantity,
        remaining_qty: quantity,
        balance_status: "OPEN",
        warehouse_id: wip.id,
        from_warehouse_id: order.source_warehouse_id,
        to_warehouse_id: wip.id,
        vendor_id:
          (order.steps || []).find((step: any) => step.vendor_id)?.vendor_id ||
          null,
        document_number: documentNumber,
        reference_number: documentNumber,
        notes: text(body.notes),
        created_by: userId,
      } as any);
    if (error) throw new BadRequestException(error.message);
    await this.supabase
      .from("subcontract_orders")
      .update({
        status: "IN_PROCESS",
        current_step_no: 1,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", order.id);
    for (const step of roots)
      await this.supabase
        .from("subcontract_order_steps")
        .update({
          issued_qty: num(step.planned_input_qty),
          status: "IN_PROCESS",
          issued_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", step.id);
    return this.findOrder(req, order.id);
  }

  async issueStep(
    req: RequestWithUser,
    orderId: string,
    stepId: string,
    body: any,
  ) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const order = await this.findOrder(req, orderId);
    const step = (order.steps || []).find((s: any) => s.id === stepId);
    if (!step) throw new NotFoundException("Operation step not found");
    if (!["READY", "ISSUED", "IN_PROCESS"].includes(String(step.status))) {
      throw new BadRequestException("This operation is not ready for issue");
    }

    const quantity = num(
      body.quantity,
      num(step.planned_input_qty) - num(step.issued_qty),
    );
    if (quantity <= 0)
      throw new BadRequestException("Issue quantity must be greater than zero");
    if (
      quantity >
      Math.max(0, num(step.planned_input_qty) - num(step.issued_qty)) + 0.0001
    ) {
      throw new BadRequestException(
        "Issue quantity exceeds this operation's planned input",
      );
    }
    const parentStep = step.parent_order_step_id
      ? (order.steps || []).find(
          (candidate: any) => candidate.id === step.parent_order_step_id,
        )
      : null;
    if (parentStep) {
      const siblingsIssued = (order.steps || [])
        .filter(
          (candidate: any) =>
            candidate.parent_order_step_id === parentStep.id &&
            candidate.id !== step.id,
        )
        .reduce(
          (total: number, candidate: any) => total + num(candidate.issued_qty),
          0,
        );
      const availableFromParent = Math.max(
        0,
        num(parentStep.accepted_qty) - siblingsIssued - num(step.issued_qty),
      );
      if (quantity > availableFromParent + 0.0001) {
        throw new BadRequestException(
          `Only ${availableFromParent} is available from ${parentStep.operation_name} for this downstream operation`,
        );
      }
    }
    const wip = await this.getWipWarehouse(req);
    const fromWarehouse = parentStep ? wip.id : order.source_warehouse_id;
    const documentNumber = await this.generateDocumentNumber(
      tenantId,
      "SUBCON_SIV",
      "MOC",
    );

    await this.moveStock(req, {
      item_id: step.input_item_id || order.input_item_id,
      quantity,
      from_warehouse_id: fromWarehouse,
      to_warehouse_id: wip.id,
      reference_id: order.id,
      reference_number: documentNumber,
      notes: `Material Outward Challan ${documentNumber} - issued to subcontractor for ${step.operation_name}`,
    });

    const { error: updateError } = await this.supabase
      .from("subcontract_order_steps")
      .update({
        issued_qty: num(step.issued_qty) + quantity,
        status: "IN_PROCESS",
        issued_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", step.id);
    if (updateError) throw new BadRequestException(updateError.message);

    const { error: movementError } = await this.supabase
      .from("subcontract_movements")
      .insert({
        tenant_id: tenantId,
        order_id: order.id,
        order_step_id: step.id,
        movement_type: "SUBCON_SIV",
        item_id: step.input_item_id || order.input_item_id,
        quantity,
        consumed_qty: 0,
        remaining_qty: quantity,
        balance_status: "OPEN",
        warehouse_id: wip.id,
        from_warehouse_id: fromWarehouse,
        to_warehouse_id: wip.id,
        vendor_id: step.vendor_id,
        document_number: documentNumber,
        reference_number: documentNumber,
        external_reference: text(body.reference_number),
        notes: text(body.notes),
        created_by: userId,
      } as any);
    if (movementError) throw new BadRequestException(movementError.message);

    await this.supabase
      .from("subcontract_orders")
      .update({
        status: "IN_PROCESS",
        current_step_no: step.sequence_no,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", order.id);

    return this.findOrder(req, order.id);
  }

  async receiveStep(
    req: RequestWithUser,
    orderId: string,
    stepId: string,
    body: any,
  ) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const order = await this.findOrder(req, orderId);
    const step = (order.steps || []).find((s: any) => s.id === stepId);
    if (!step) throw new NotFoundException("Operation step not found");
    const reconciliationOnly = [
      "PARTIALLY_RECEIVED",
      "RM_BALANCE_PENDING",
    ].includes(String(order.status || "").toUpperCase());
    if (
      !["IN_PROCESS", "ISSUED"].includes(String(step.status)) &&
      !reconciliationOnly
    ) {
      throw new BadRequestException("Issue this operation before receiving it");
    }
    const weightBased =
      num(step.input_weight_per_piece) > 0 ||
      num(step.output_weight_per_piece) > 0;
    const issueId = text(body.issue_id);
    const stepIssues = (order.movements || []).filter(
      (row: any) =>
        row.movement_type === "SUBCON_SIV" &&
        row.order_step_id === step.id &&
        num(row.remaining_qty, num(row.quantity)) > 0.0001,
    );
    const issues = stepIssues.length
      ? stepIssues
      : (order.movements || []).filter(
          (row: any) =>
            row.movement_type === "SUBCON_SIV" &&
            !row.order_step_id &&
            num(row.remaining_qty, num(row.quantity)) > 0.0001,
        );
    const issue = issueId
      ? issues.find((row: any) => row.id === issueId)
      : issues[0];
    if (!issue)
      throw new BadRequestException(
        "Select an open Material Outward Challan before posting this subcontract GRN.",
      );
    const openQty = num(issue.remaining_qty, num(issue.quantity));

    const rawFinishedGoods = Array.isArray(body.finished_goods)
      ? body.finished_goods
      : [
          {
            item_id:
              body.output_item_id ||
              step.output_item_id ||
              order.output_item_id,
            quantity: body.accepted_qty,
            raw_material_qty: body.consumed_qty,
          },
        ];
    let finishedGoods = rawFinishedGoods
      .map((line: any) => ({
        item_id: text(line.item_id),
        quantity: num(line.quantity),
        // Receipt operators enter only actual finished-goods quantities. Raw
        // material consumption is authoritative only when backflushed below from
        // the service-order route, so ignore stale/legacy client values here.
        raw_material_qty: 0,
        actual_weight: num(line.actual_weight) || null,
        notes: text(line.notes),
      }))
      .filter((line: any) => line.item_id && line.quantity > 0);
    const scrapQty = num(body.scrap_qty);
    let unusedReturnQty = num(body.unused_return_qty);
    const lossQty = num(body.loss_qty);
    const rejectedQty = num(body.rejected_qty);
    // Once every finished-good line has already been received, the complete
    // open MOC balance is the unused raw material awaiting return. Do not make
    // the operator re-key a quantity the system already knows.
    if (
      !finishedGoods.length &&
      order.all_finished_goods_received &&
      unusedReturnQty <= 0 &&
      scrapQty <= 0 &&
      lossQty <= 0
    ) {
      unusedReturnQty = openQty;
    }
    if (
      !finishedGoods.length &&
      scrapQty <= 0 &&
      unusedReturnQty <= 0 &&
      lossQty <= 0
    ) {
      throw new BadRequestException(
        "No finished goods remain. Enter the unused raw-material return, scrap, or approved process loss to settle this outward challan.",
      );
    }
    if (finishedGoods.some((line: any) => line.raw_material_qty < 0))
      throw new BadRequestException(
        "Raw-material consumption cannot be negative.",
      );

    // A route-level issue can be received across more than one GRN, but each
    // output line is still capped by the quantity planned on the service order.
    // Without this guard, submitting the same six finished-good rows a second
    // time posted another GRN and duplicated finished-good stock.
    const priorReceiptIds = (order.movements || [])
      .filter(
        (movement: any) =>
          movement.movement_type === "SUBCON_SRV" &&
          !["CANCELLED", "REVERSED"].includes(
            String(movement.qc_status || "").toUpperCase(),
          ),
      )
      .map((movement: any) => movement.id)
      .filter(Boolean);
    const priorReceiptLinesResult = priorReceiptIds.length
      ? await this.supabase
          .from("subcontract_receipt_lines")
          .select("item_id, quantity, line_type")
          .in("receipt_movement_id", priorReceiptIds)
          .eq("line_type", "FINISHED_GOOD")
      : { data: [], error: null };
    if (priorReceiptLinesResult.error)
      throw new BadRequestException(priorReceiptLinesResult.error.message);
    const previouslyReceivedByItem = new Map<string, number>();
    for (const line of priorReceiptLinesResult.data || []) {
      const itemId = text((line as any).item_id);
      previouslyReceivedByItem.set(
        itemId,
        num(previouslyReceivedByItem.get(itemId)) + num((line as any).quantity),
      );
    }
    const reconciliationTolerance = 0.01;
    // Planned finished-good quantities are the service-order baseline, not the
    // physical receipt ceiling. A vendor may produce more than planned when
    // the issued raw material supports it. The authoritative ceiling is
    // therefore enforced below against the route backflush and the open MOC
    // balance, while the planned and actual quantities remain available for
    // variance reporting.
    // When this receipt completes all planned FG lines, calculate the unused
    // return automatically as issued/open RM less the route backflush. The
    // operator may still override it by supplying return/scrap/loss values.
    if (finishedGoods.length) {
      const rootSteps = (order.steps || []).filter(
        (candidate: any) => !text(candidate.parent_node_key),
      );
      const receiptQtyByItem = new Map<string, number>();
      for (const line of finishedGoods)
        receiptQtyByItem.set(
          line.item_id,
          num(receiptQtyByItem.get(line.item_id)) + line.quantity,
        );
      const completesAllOutputs =
        rootSteps.length > 0 &&
        rootSteps.every(
          (candidate: any) =>
            num(previouslyReceivedByItem.get(candidate.output_item_id)) +
              num(receiptQtyByItem.get(candidate.output_item_id)) +
              0.0001 >=
            num(candidate.planned_output_qty),
        );
      if (completesAllOutputs) {
        const plannedInput = num(order.planned_input_qty, num(issue.quantity));
        const plannedLengthMetres = num(order.secondary_input_qty);
        const plannedOutput = rootSteps.reduce(
          (total: number, candidate: any) =>
            total + num(candidate.planned_output_qty),
          0,
        );
        const producedLengthMetres = finishedGoods.reduce(
          (total: number, line: any) => {
            const outputStep = rootSteps.find(
              (candidate: any) => candidate.output_item_id === line.item_id,
            );
            return (
              total + (num(outputStep?.output_size) * line.quantity) / 1000
            );
          },
          0,
        );
        const inputUom = text(order.input_uom).toUpperCase();
        const useLengthBackflush =
          [
            "KG",
            "KGS",
            "KILOGRAM",
            "KILOGRAMS",
            "G",
            "GM",
            "GMS",
            "GRAM",
            "GRAMS",
          ].includes(inputUom) &&
          plannedLengthMetres > 0 &&
          producedLengthMetres > 0;
        const ratio = useLengthBackflush
          ? plannedInput / plannedLengthMetres
          : plannedInput > 0 && plannedOutput > 0
            ? plannedInput / plannedOutput
            : 0;
        const basis = useLengthBackflush
          ? producedLengthMetres
          : finishedGoods.reduce(
              (total: number, line: any) => total + line.quantity,
              0,
            );
        const projectedConsumption = Math.min(
          openQty,
          Math.max(0, ratio > 0 ? basis * ratio : openQty),
        );
        // Route backflush is authoritative. Scrap and approved loss consume the
        // same issued RM balance, so they reduce the automatic unused return;
        // they must never reduce the calculated finished-good consumption.
        unusedReturnQty = Math.max(
          0,
          Math.round(
            (openQty - projectedConsumption - scrapQty - lossQty) * 10_000,
          ) / 10_000,
        );
      }
    }
    const explicitConsumedQty = finishedGoods.reduce(
      (total: number, line: any) => total + line.raw_material_qty,
      0,
    );
    // RM consumption is never keyed on the receipt. Backflush it from the
    // service order plan. For a route-level MOC, use its one issued input
    // quantity against the total planned output of all root products; this
    // supports partial GRNs without closing the entire MOC prematurely.
    if (explicitConsumedQty <= 0 && openQty > 0) {
      const acceptedQty = finishedGoods.reduce(
        (total: number, line: any) => total + line.quantity,
        0,
      );
      const routeLevelIssue = !issue.order_step_id;
      const rootSteps = (order.steps || []).filter(
        (candidate: any) => !text(candidate.parent_node_key),
      );
      const plannedInput = routeLevelIssue
        ? num(order.planned_input_qty, num(issue.quantity))
        : num(step.planned_input_qty);
      const plannedLengthMetres = routeLevelIssue
        ? num(order.secondary_input_qty)
        : 0;
      const producedLengthMetres = routeLevelIssue
        ? finishedGoods.reduce((total: number, line: any) => {
            const outputStep = rootSteps.find(
              (candidate: any) => candidate.output_item_id === line.item_id,
            );
            return (
              total + (num(outputStep?.output_size) * line.quantity) / 1000
            );
          }, 0)
        : 0;
      const plannedOutput = routeLevelIssue
        ? rootSteps.reduce(
            (total: number, candidate: any) =>
              total + num(candidate.planned_output_qty),
            0,
          )
        : num(step.planned_output_qty);
      const inputUom = text(order.input_uom).toUpperCase();
      const useLengthBackflush =
        [
          "KG",
          "KGS",
          "KILOGRAM",
          "KILOGRAMS",
          "G",
          "GM",
          "GMS",
          "GRAM",
          "GRAMS",
        ].includes(inputUom) &&
        plannedLengthMetres > 0 &&
        producedLengthMetres > 0;
      const ratio = useLengthBackflush
        ? plannedInput / plannedLengthMetres
        : plannedInput > 0 && plannedOutput > 0
          ? plannedInput / plannedOutput
          : 0;
      const consumptionBasis = useLengthBackflush
        ? producedLengthMetres
        : acceptedQty;
      const availableToConsume = Math.max(
        0,
        openQty - scrapQty - unusedReturnQty - lossQty,
      );
      const requiredBackflushQty =
        ratio > 0 ? consumptionBasis * ratio : availableToConsume;
      if (
        ratio > 0 &&
        requiredBackflushQty > availableToConsume + reconciliationTolerance
      ) {
        throw new BadRequestException(
          `This finished-goods receipt requires ${requiredBackflushQty.toFixed(4)} ${text(order.input_uom) || "RM"}, but only ${availableToConsume.toFixed(4)} remains available on outward challan ${issue.document_number}. Reduce the receipt quantity or revise the service order.`,
        );
      }
      const backflushedQty = Math.min(availableToConsume, requiredBackflushQty);
      if (acceptedQty > 0 && backflushedQty > 0) {
        finishedGoods = finishedGoods.map((line: any) => ({
          ...line,
          raw_material_qty:
            Math.round(backflushedQty * (line.quantity / acceptedQty) * 10000) /
            10000,
        }));
      }
    }
    const consumedQty = roundQty(
      finishedGoods.reduce(
        (total: number, line: any) => total + line.raw_material_qty,
        0,
      ),
    );
    let settledQty = roundQty(
      consumedQty + scrapQty + unusedReturnQty + lossQty,
    );
    // Quantity plans can produce repeating decimals (for example, six output
    // lines sharing 100 KG). Treat a sub-0.01 UOM rounding variance as settled.
    if (Math.abs(settledQty - openQty) <= reconciliationTolerance)
      settledQty = openQty;
    if (scrapQty < 0 || unusedReturnQty < 0 || lossQty < 0 || settledQty <= 0)
      throw new BadRequestException(
        "Account for a positive raw-material quantity as finished-good consumption, scrap, return, or loss.",
      );
    if (settledQty > openQty + reconciliationTolerance)
      throw new BadRequestException(
        `This GRN accounts for ${settledQty.toFixed(4)}, but only ${openQty.toFixed(4)} remains on outward challan ${issue.document_number}.`,
      );

    const fallbackProcessingRate = num(body.processing_rate);
    const taxPercent = num(body.tax_percent);
    const freightAmount = Math.max(0, num(body.freight_amount));
    const otherChargesAmount = Math.max(0, num(body.other_charges_amount));
    const deductionAmount = Math.max(0, num(body.deduction_amount));
    const acceptedQty = finishedGoods.reduce(
      (total: number, line: any) => total + line.quantity,
      0,
    );
    // Service-order line pricing is authoritative for subcontract payables.
    // The receipt rate is only a fallback for legacy orders without a line price.
    const processingAmount =
      Math.round(
        finishedGoods.reduce((total: number, line: any) => {
          const pricedStep =
            (order.steps || []).find(
              (candidate: any) =>
                candidate.output_item_id === line.item_id &&
                !candidate.parent_node_key,
            ) || step;
          const configuredRate = num(pricedStep?.unit_price);
          const rate =
            configuredRate > 0 ? configuredRate : fallbackProcessingRate;
          const discount = Math.max(
            0,
            Math.min(100, num(pricedStep?.discount_percent)),
          );
          return total + line.quantity * rate * (1 - discount / 100);
        }, 0) * 100,
      ) / 100;
    const processingRate =
      acceptedQty > 0
        ? Math.round((processingAmount / acceptedQty) * 10000) / 10000
        : fallbackProcessingRate;
    const taxableAmount = processingAmount + freightAmount + otherChargesAmount;
    const taxAmount =
      Math.round(((taxableAmount * taxPercent) / 100) * 100) / 100;
    const payableAmount = Math.max(
      0,
      Math.round((taxableAmount + taxAmount - deductionAmount) * 100) / 100,
    );
    const invoiceNumber = text(body.invoice_number);
    const invoiceDate = text(body.invoice_date);
    const invoiceStatus = "PENDING_QC";

    const wip = await this.getWipWarehouse(req);
    const childSteps = (order.steps || []).filter(
      (candidate: any) =>
        candidate.parent_order_step_id === step.id ||
        (!candidate.parent_order_step_id &&
          text(candidate.parent_node_key) === text(step.node_key)),
    );
    const outputWarehouse = childSteps.length
      ? wip.id
      : order.output_warehouse_id;
    const inputItem = step.input_item_id || order.input_item_id;
    const documentNumber = await this.generateDocumentNumber(
      tenantId,
      "SUBCON_SRV",
      "SCR",
    );

    // Backflushed RM consumption belongs to the subcontract reconciliation
    // document only. The stock deduction already happened on the MOC, so a
    // receipt must not create another raw-material inventory movement.
    for (const line of finishedGoods) {
      await this.moveStock(req, {
        item_id: line.item_id,
        quantity: line.quantity,
        to_warehouse_id: outputWarehouse,
        reference_id: order.id,
        reference_number: documentNumber,
        notes: `Subcontract GRN ${documentNumber} - finished goods from ${step.operation_name}`,
      });
    }

    if (unusedReturnQty > 0) {
      await this.moveStock(req, {
        item_id: inputItem,
        quantity: unusedReturnQty,
        to_warehouse_id: order.source_warehouse_id,
        reference_id: order.id,
        reference_number: documentNumber,
        notes: `Subcontract receipt ${documentNumber} - unused material returned from ${step.operation_name}`,
      });
    }

    if (scrapQty > 0 && body.scrap_item_id) {
      await this.moveStock(req, {
        item_id: body.scrap_item_id,
        quantity: scrapQty,
        to_warehouse_id: order.source_warehouse_id,
        reference_id: order.id,
        reference_number: documentNumber,
        notes: `Subcontract receipt ${documentNumber} - scrap returned from ${step.operation_name}`,
      });
    }
    const balanceAfter = Math.max(0, roundQty(openQty - settledQty));
    const issueClosed = balanceAfter <= reconciliationTolerance;
    const { data: receipt, error: receiptError } = await this.supabase
      .from("subcontract_movements")
      .insert({
        tenant_id: tenantId,
        order_id: order.id,
        order_step_id: step.id,
        issue_movement_id: issue.id,
        movement_type: "SUBCON_SRV",
        item_id: finishedGoods[0]?.item_id || inputItem,
        quantity: acceptedQty,
        consumed_qty: consumedQty,
        accepted_qty: acceptedQty,
        rejected_qty: rejectedQty,
        scrap_qty: scrapQty,
        unused_return_qty: unusedReturnQty,
        processing_rate: processingRate,
        processing_amount: processingAmount,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        freight_amount: freightAmount,
        other_charges_amount: otherChargesAmount,
        deduction_amount: deductionAmount,
        payable_amount: 0,
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        qc_status: "PENDING_QC",
        warehouse_id: outputWarehouse,
        from_warehouse_id: wip.id,
        to_warehouse_id: outputWarehouse,
        vendor_id: step.vendor_id,
        document_number: documentNumber,
        reference_number: documentNumber,
        external_reference: text(body.reference_number),
        notes: text(body.notes),
        created_by: userId,
      } as any)
      .select()
      .single();
    if (receiptError) throw new BadRequestException(receiptError.message);
    const receiptLines = [
      ...finishedGoods.map((line: any) => ({
        tenant_id: tenantId,
        receipt_movement_id: receipt.id,
        issue_movement_id: issue.id,
        line_type: "FINISHED_GOOD",
        item_id: line.item_id,
        quantity: line.quantity,
        raw_material_qty: line.raw_material_qty,
        actual_weight: line.actual_weight,
        warehouse_id: outputWarehouse,
        notes: line.notes || null,
        qc_status: "PENDING_QC",
      })),
      ...(unusedReturnQty > 0
        ? [
            {
              tenant_id: tenantId,
              receipt_movement_id: receipt.id,
              issue_movement_id: issue.id,
              line_type: "UNUSED_RETURN",
              item_id: inputItem,
              quantity: unusedReturnQty,
              raw_material_qty: unusedReturnQty,
              warehouse_id: order.source_warehouse_id,
              qc_status: "NOT_APPLICABLE",
            },
          ]
        : []),
      ...(scrapQty > 0
        ? [
            {
              tenant_id: tenantId,
              receipt_movement_id: receipt.id,
              issue_movement_id: issue.id,
              line_type: "SCRAP",
              item_id: body.scrap_item_id || null,
              quantity: scrapQty,
              raw_material_qty: scrapQty,
              warehouse_id: order.source_warehouse_id,
              qc_status: "NOT_APPLICABLE",
            },
          ]
        : []),
      ...(lossQty > 0
        ? [
            {
              tenant_id: tenantId,
              receipt_movement_id: receipt.id,
              issue_movement_id: issue.id,
              line_type: "LOSS",
              item_id: null,
              quantity: lossQty,
              raw_material_qty: lossQty,
              notes: text(body.loss_reason),
              qc_status: "NOT_APPLICABLE",
            },
          ]
        : []),
    ];
    const { error: lineError } = await this.supabase
      .from("subcontract_receipt_lines")
      .insert(receiptLines as any);
    if (lineError) throw new BadRequestException(lineError.message);
    const { error: issueError } = await this.supabase
      .from("subcontract_movements")
      .update({
        remaining_qty: issueClosed ? 0 : balanceAfter,
        balance_status: issueClosed ? "CLOSED" : "OPEN",
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", issue.id);
    if (issueError) throw new BadRequestException(issueError.message);
    // Post product quantities to their own output steps. Previously the full
    // multi-product GRN total was written to only the first step (for example
    // 120 on product 1 and zero on products 2-6), which made subsequent receipt
    // screens falsely show already-received products as outstanding.
    for (const line of finishedGoods) {
      const productStep =
        (order.steps || []).find(
          (candidate: any) =>
            candidate.output_item_id === line.item_id &&
            !text(candidate.parent_node_key),
        ) || step;
      const { error: productStepError } = await this.supabase
        .from("subcontract_order_steps")
        .update({
          received_qty: num(productStep.received_qty) + line.quantity,
          accepted_qty: num(productStep.accepted_qty) + line.quantity,
          consumed_input_weight:
            num(productStep.consumed_input_weight) + line.raw_material_qty,
          status: "PENDING_QC",
          received_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", productStep.id);
      if (productStepError)
        throw new BadRequestException(productStepError.message);
    }
    const { error: stepError } = await this.supabase
      .from("subcontract_order_steps")
      .update({
        rejected_qty: num(step.rejected_qty) + rejectedQty,
        scrap_qty: num(step.scrap_qty) + scrapQty,
        unused_return_qty: num(step.unused_return_qty) + unusedReturnQty,
        calculated_scrap_weight:
          num(step.calculated_scrap_weight) + scrapQty + lossQty,
        processing_rate: processingRate,
        processing_amount: processingAmount,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        freight_amount: freightAmount,
        other_charges_amount: otherChargesAmount,
        deduction_amount: deductionAmount,
        payable_amount: num(step.payable_amount),
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        invoice_status: invoiceStatus,
        status: "PENDING_QC",
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", step.id);
    if (stepError) throw new BadRequestException(stepError.message);

    if (issueClosed && childSteps.length) {
      const childIds = childSteps
        .filter((child: any) => child.status === "WAITING")
        .map((child: any) => child.id);
      if (childIds.length) {
        const { error: readyError } = await this.supabase
          .from("subcontract_order_steps")
          .update({
            status: "READY",
            updated_at: new Date().toISOString(),
          } as any)
          .eq("tenant_id", tenantId)
          .in("id", childIds);
        if (readyError) throw new BadRequestException(readyError.message);
      }
      await this.supabase
        .from("subcontract_orders")
        .update({
          current_step_no: Math.min(
            ...childSteps.map((child: any) => num(child.sequence_no)),
          ),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", order.id);
    }

    if (!step.parent_order_step_id) {
      // Every reconciled quantity leaves vendor WIP, whether it was consumed into
      // finished goods, returned unused, scrapped, or posted as approved loss.
      // Subtracting only consumption left fully reconciled orders displaying a
      // phantom raw-material balance.
      const remainingRaw = issueClosed
        ? 0
        : Math.max(
            0,
            num(
              order.remaining_raw_material_weight,
              num(order.planned_input_qty),
            ) - settledQty,
          );
      const rootSteps = (order.steps || []).filter(
        (candidate: any) => !text(candidate.parent_node_key),
      );
      const usedLengthMetres = finishedGoods.reduce(
        (total: number, line: any) => {
          const outputStep = rootSteps.find(
            (candidate: any) => candidate.output_item_id === line.item_id,
          );
          return total + (num(outputStep?.output_size) * line.quantity) / 1000;
        },
        0,
      );
      const remainingLength = issueClosed
        ? 0
        : Math.max(
            0,
            num(
              order.remaining_secondary_input_qty,
              num(order.secondary_input_qty),
            ) - usedLengthMetres,
          );
      await this.supabase
        .from("subcontract_orders")
        .update({
          remaining_raw_material_weight: remainingRaw,
          remaining_secondary_input_qty: remainingLength,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", order.id);
    }

    // The order remains in process until the corresponding QC decision.
    // approveReceiptQc is the only transition that can complete the order.
    await this.supabase
      .from("subcontract_orders")
      .update({
        status: "IN_PROCESS",
        updated_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", order.id);

    await this.refreshOrderReconciliation(req, order.id, userId);
    return this.findOrder(req, order.id);
  }

  private async refreshOrderReconciliation(
    req: RequestWithUser,
    orderId: string,
    calculatedBy?: string,
  ) {
    const { tenantId } = req.user;
    const order = await this.findOrder(req, orderId);
    const steps = order.steps || [];
    const movements = order.movements || [];
    const rootSteps = steps.filter((step: any) => !text(step.parent_node_key));
    const issue =
      movements.find(
        (movement: any) =>
          movement.movement_type === "SUBCON_SIV" && !movement.order_step_id,
      ) ||
      movements.find(
        (movement: any) => movement.movement_type === "SUBCON_SIV",
      );
    const allReceipts = movements.filter(
      (movement: any) =>
        movement.movement_type === "SUBCON_SRV" &&
        !["CANCELLED", "REVERSED"].includes(
          String(movement.qc_status || "").toUpperCase(),
        ),
    );
    const approvedReceipts = allReceipts.filter((movement: any) =>
      ["APPROVED", "PARTIALLY_APPROVED"].includes(
        String(movement.qc_status || "").toUpperCase(),
      ),
    );
    const receiptIds = allReceipts.map((movement: any) => movement.id);
    const { data: lossRows, error: lossError } = receiptIds.length
      ? await this.supabase
          .from("subcontract_receipt_lines")
          .select("quantity")
          .eq("tenant_id", tenantId)
          .eq("line_type", "LOSS")
          .in("receipt_movement_id", receiptIds)
      : ({ data: [], error: null } as any);
    if (lossError) throw new BadRequestException(lossError.message);

    const issued = num(issue?.quantity);
    const vendorBalance = Math.max(0, num(issue?.remaining_qty, issued));
    const consumed = allReceipts.reduce(
      (sum: number, movement: any) => sum + num(movement.consumed_qty),
      0,
    );
    const scrap = allReceipts.reduce(
      (sum: number, movement: any) => sum + num(movement.scrap_qty),
      0,
    );
    const returned = allReceipts.reduce(
      (sum: number, movement: any) => sum + num(movement.unused_return_qty),
      0,
    );
    const approvedLoss = (lossRows || []).reduce(
      (sum: number, line: any) => sum + num(line.quantity),
      0,
    );
    const inputVariance = roundQty(
      issued - consumed - scrap - returned - approvedLoss - vendorBalance,
    );
    const standardOutput = rootSteps.reduce(
      (sum: number, step: any) => sum + num(step.planned_output_qty),
      0,
    );
    const actualAccepted = approvedReceipts.reduce(
      (sum: number, movement: any) => sum + num(movement.accepted_qty),
      0,
    );
    const actualRejected = approvedReceipts.reduce(
      (sum: number, movement: any) => sum + num(movement.rejected_qty),
      0,
    );
    const standardCost = rootSteps.reduce((sum: number, step: any) => {
      const discount = Math.max(0, Math.min(100, num(step.discount_percent)));
      return (
        sum +
        num(step.planned_output_qty) *
          num(step.unit_price) *
          (1 - discount / 100)
      );
    }, 0);
    const actualCost = approvedReceipts.reduce(
      (sum: number, movement: any) =>
        sum +
        num(movement.processing_amount) +
        num(movement.freight_amount) +
        num(movement.other_charges_amount) -
        num(movement.deduction_amount),
      0,
    );
    const pendingQc = movements.some(
      (movement: any) =>
        movement.movement_type === "SUBCON_SRV" &&
        String(movement.qc_status || "").toUpperCase() === "PENDING_QC",
    );
    const status =
      Math.abs(inputVariance) > 0.01
        ? "EXCEPTION"
        : vendorBalance <= 0.01 && !pendingQc
          ? "RECONCILED"
          : "OPEN";
    const { error } = await this.supabase
      .from("subcontract_reconciliations")
      .upsert(
        {
          tenant_id: tenantId,
          order_id: orderId,
          issued_input_quantity: issued,
          consumed_input_quantity: consumed,
          scrap_input_quantity: scrap,
          returned_input_quantity: returned,
          approved_loss_quantity: approvedLoss,
          vendor_balance_quantity: vendorBalance,
          input_reconciliation_variance: inputVariance,
          standard_output_quantity: standardOutput,
          actual_accepted_quantity: actualAccepted,
          actual_rejected_quantity: actualRejected,
          yield_variance_quantity: roundQty(actualAccepted - standardOutput),
          standard_service_cost: Math.round(standardCost * 100) / 100,
          actual_service_cost: Math.round(actualCost * 100) / 100,
          service_cost_variance:
            Math.round((actualCost - standardCost) * 100) / 100,
          status,
          calculated_by: calculatedBy || null,
          calculated_at: new Date().toISOString(),
          evidence: {
            issue_document: issue?.document_number || null,
            approved_receipt_count: approvedReceipts.length,
            calculation: "MOC_AND_QC_APPROVED_SUBCONTRACT_GRN",
          },
        } as any,
        { onConflict: "tenant_id,order_id" },
      );
    if (error) throw new BadRequestException(error.message);
  }

  async approveReceiptQc(
    req: RequestWithUser,
    orderId: string,
    receiptId: string,
    body: any,
  ) {
    await this.ensureSchema();
    const { tenantId, userId } = req.user;
    const order = await this.findOrder(req, orderId);
    const receipt = (order.movements || []).find(
      (movement: any) =>
        movement.id === receiptId && movement.movement_type === "SUBCON_SRV",
    );
    if (!receipt) throw new NotFoundException("Subcontract GRN not found");
    if (
      ["APPROVED", "PARTIALLY_APPROVED"].includes(
        String(receipt.qc_status || "").toUpperCase(),
      )
    ) {
      throw new BadRequestException(
        "This subcontract GRN is already QC approved",
      );
    }
    const { data: storedLines, error: storedLinesError } = await this.supabase
      .from("subcontract_receipt_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("receipt_movement_id", receiptId)
      .eq("line_type", "FINISHED_GOOD");
    if (storedLinesError)
      throw new BadRequestException(storedLinesError.message);
    const receiptLines = storedLines || [];
    if (!receiptLines.length)
      throw new BadRequestException(
        "This subcontract GRN has no finished-goods lines to inspect.",
      );

    const requestedInspections = Array.isArray(body.line_inspections)
      ? body.line_inspections
      : [];
    // Existing single-line GRNs remain usable while all new/multi-line GRNs
    // are explicitly inspected item-by-item.
    const legacySingleLine =
      !requestedInspections.length && receiptLines.length === 1
        ? [
            {
              receipt_line_id: receiptLines[0].id,
              approved_qty: body.approved_qty,
              rejected_disposition: body.rejected_disposition,
              scrap_item_id: body.scrap_item_id,
              notes: body.notes,
            },
          ]
        : requestedInspections;
    if (legacySingleLine.length !== receiptLines.length) {
      throw new BadRequestException(
        "Inspect every finished-goods line before posting subcontract GRN QC.",
      );
    }
    const inspectionByLineId = new Map(
      legacySingleLine.map((line: any) => [text(line.receipt_line_id), line]),
    );
    const approvedLineIds = new Set(receiptLines.map((line: any) => line.id));
    if (
      inspectionByLineId.size !== receiptLines.length ||
      [...inspectionByLineId.keys()].some((id) => !approvedLineIds.has(id))
    ) {
      throw new BadRequestException(
        "Each QC inspection must refer to one received finished-goods line.",
      );
    }
    const inspections = receiptLines.map((line: any) => {
      const requested = inspectionByLineId.get(line.id) || {};
      const receivedQty = num(line.quantity);
      const approvedQty = num(requested.approved_qty, receivedQty);
      if (approvedQty < 0 || approvedQty > receivedQty + 0.0001) {
        throw new BadRequestException(
          "QC-approved quantity cannot exceed the received quantity for any line.",
        );
      }
      const rejectedQty = Math.max(0, roundQty(receivedQty - approvedQty));
      const disposition = text(
        requested.rejected_disposition,
        rejectedQty > 0 ? "REWORK" : "",
      );
      if (rejectedQty > 0 && !["REWORK", "SCRAP"].includes(disposition)) {
        throw new BadRequestException(
          "Choose REWORK or SCRAP for every QC-rejected line.",
        );
      }
      if (
        rejectedQty > 0 &&
        disposition === "SCRAP" &&
        !requested.scrap_item_id
      ) {
        throw new BadRequestException(
          "Select the scrap item for every line received as scrap.",
        );
      }
      return {
        line,
        approvedQty,
        rejectedQty,
        disposition,
        scrapItemId: text(requested.scrap_item_id),
        notes: text(requested.notes),
      };
    });
    const receivedQty = inspections.reduce(
      (sum, inspection) => sum + num(inspection.line.quantity),
      0,
    );
    const approvedQty = inspections.reduce(
      (sum, inspection) => sum + inspection.approvedQty,
      0,
    );
    const rejectedQty = inspections.reduce(
      (sum, inspection) => sum + inspection.rejectedQty,
      0,
    );
    const qcScrapQty = inspections.reduce(
      (sum, inspection) =>
        sum + (inspection.disposition === "SCRAP" ? inspection.rejectedQty : 0),
      0,
    );
    const approvalRatio = receivedQty > 0 ? approvedQty / receivedQty : 0;
    const step = (order.steps || []).find(
      (row: any) => row.id === receipt.order_step_id,
    );
    const deductionAmount =
      Math.round(
        Math.max(0, num(receipt.deduction_amount)) * approvalRatio * 100,
      ) / 100;
    // QC must value each approved product at its own service-order price. A
    // flat approved/received ratio is wrong when the GRN contains products at
    // different rates: rejecting five low-priced pieces would otherwise reduce
    // the payable by the blended average price of all six products.
    const fallbackRate = num(receipt.processing_rate);
    const processingAmount =
      Math.round(
        inspections.reduce((sum, inspection) => {
          const pricedStep =
            (order.steps || []).find(
              (candidate: any) =>
                !text(candidate.parent_node_key) &&
                candidate.output_item_id === inspection.line.item_id,
            ) || step;
          const configuredRate = num(pricedStep?.unit_price);
          const rate = configuredRate > 0 ? configuredRate : fallbackRate;
          const discount = Math.max(
            0,
            Math.min(100, num(pricedStep?.discount_percent)),
          );
          return sum + inspection.approvedQty * rate * (1 - discount / 100);
        }, 0) * 100,
      ) / 100;
    // A QC rejection makes the vendor responsible for the receipt-level
    // freight/other charge. Do not turn any portion of those charges into an
    // approved payable; fully approved receipts retain them unchanged.
    const freightAmount =
      rejectedQty > 0
        ? 0
        : Math.round(Math.max(0, num(receipt.freight_amount)) * 100) / 100;
    const otherChargesAmount =
      rejectedQty > 0
        ? 0
        : Math.round(Math.max(0, num(receipt.other_charges_amount)) * 100) /
          100;
    const taxableAmount = processingAmount + freightAmount + otherChargesAmount;
    const taxAmount =
      Math.round(((taxableAmount * num(receipt.tax_percent)) / 100) * 100) /
      100;
    const payableAmount = Math.max(
      0,
      Math.round((taxableAmount + taxAmount - deductionAmount) * 100) / 100,
    );
    // An RM-only settlement GRN has no new supplier invoice. It must never
    // erase the invoice/payment state created by the preceding priced GRN.
    const existingInvoiceStatus = String(
      step?.invoice_status || "",
    ).toUpperCase();
    const invoiceStatus = receipt.invoice_number
      ? "INVOICE_RECEIVED"
      : payableAmount <= 0.009 &&
          ["INVOICE_RECEIVED", "PENDING_PAYMENT", "PAID"].includes(
            existingInvoiceStatus,
          )
        ? existingInvoiceStatus
        : "PENDING_INVOICE";
    // A step can be received in more than one GRN. Build its finance values
    // from previously QC-approved GRNs plus the GRN being approved now. Do
    // not add the current GRN to the provisional values already written at
    // receipt time, otherwise processing and GST are doubled.
    const priorApprovedReceipts = (order.movements || []).filter(
      (movement: any) =>
        movement.movement_type === "SUBCON_SRV" &&
        movement.order_step_id === receipt.order_step_id &&
        movement.id !== receipt.id &&
        ["APPROVED", "PARTIALLY_APPROVED"].includes(
          String(movement.qc_status || "").toUpperCase(),
        ),
    );
    const accumulatedProcessing =
      priorApprovedReceipts.reduce(
        (sum: number, movement: any) => sum + num(movement.processing_amount),
        0,
      ) + processingAmount;
    const accumulatedTax =
      priorApprovedReceipts.reduce(
        (sum: number, movement: any) => sum + num(movement.tax_amount),
        0,
      ) + taxAmount;
    const accumulatedFreight =
      priorApprovedReceipts.reduce(
        (sum: number, movement: any) => sum + num(movement.freight_amount),
        0,
      ) + freightAmount;
    const accumulatedOtherCharges =
      priorApprovedReceipts.reduce(
        (sum: number, movement: any) =>
          sum + num(movement.other_charges_amount),
        0,
      ) + otherChargesAmount;
    const accumulatedDeductions =
      priorApprovedReceipts.reduce(
        (sum: number, movement: any) => sum + num(movement.deduction_amount),
        0,
      ) + deductionAmount;
    const accumulatedPayable =
      priorApprovedReceipts.reduce(
        (sum: number, movement: any) => sum + num(movement.payable_amount),
        0,
      ) + payableAmount;
    if (rejectedQty > 0) {
      const wip = await this.getWipWarehouse(req);
      for (const inspection of inspections.filter(
        (candidate) => candidate.rejectedQty > 0,
      )) {
        if (inspection.disposition === "REWORK") {
          await this.moveStock(req, {
            item_id: inspection.line.item_id,
            quantity: inspection.rejectedQty,
            from_warehouse_id: receipt.to_warehouse_id || receipt.warehouse_id,
            to_warehouse_id: wip.id,
            reference_id: order.id,
            reference_number: receipt.document_number,
            notes: `QC rejected ${inspection.rejectedQty}; returned to vendor WIP for rework`,
          });
        } else {
          await this.moveStock(req, {
            item_id: inspection.line.item_id,
            quantity: inspection.rejectedQty,
            from_warehouse_id: receipt.to_warehouse_id || receipt.warehouse_id,
            reference_id: order.id,
            reference_number: receipt.document_number,
            notes: `QC rejected ${inspection.rejectedQty}; disposed as approved scrap`,
          });
          await this.moveStock(req, {
            item_id: inspection.scrapItemId,
            quantity: inspection.rejectedQty,
            to_warehouse_id: order.source_warehouse_id,
            reference_id: order.id,
            reference_number: receipt.document_number,
            notes: `QC rejected subcontract material received as scrap`,
          });
        }
        const { error: movementError } = await this.supabase
          .from("subcontract_movements")
          .insert({
            tenant_id: tenantId,
            order_id: order.id,
            order_step_id: receipt.order_step_id,
            issue_movement_id: receipt.issue_movement_id,
            movement_type:
              inspection.disposition === "REWORK"
                ? "SUBCON_QC_REWORK"
                : "SUBCON_QC_SCRAP",
            item_id: inspection.line.item_id,
            quantity: inspection.rejectedQty,
            accepted_qty: 0,
            rejected_qty: inspection.rejectedQty,
            scrap_qty:
              inspection.disposition === "SCRAP" ? inspection.rejectedQty : 0,
            vendor_id: receipt.vendor_id,
            document_number: receipt.document_number,
            reference_number: receipt.document_number,
            notes: inspection.notes || text(body.notes),
            created_by: userId,
          } as any);
        if (movementError) throw new BadRequestException(movementError.message);
      }
    }
    const now = new Date().toISOString();
    for (const inspection of inspections) {
      const { error: lineUpdateError } = await this.supabase
        .from("subcontract_receipt_lines")
        .update({
          qc_status:
            inspection.rejectedQty > 0 ? "PARTIALLY_APPROVED" : "APPROVED",
          qc_approved_qty: inspection.approvedQty,
          qc_rejected_qty: inspection.rejectedQty,
          qc_disposition: inspection.disposition || null,
          qc_scrap_item_id: inspection.scrapItemId || null,
          qc_notes: inspection.notes || text(body.notes) || null,
          qc_approved_at: now,
          qc_approved_by: userId,
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", inspection.line.id);
      if (lineUpdateError)
        throw new BadRequestException(lineUpdateError.message);

      // Receipt quantities are provisionally counted as accepted when the GRN
      // arrives. Replace that provisional balance with the final QC outcome on
      // the matching product step so planning, trail, and inventory agree.
      const productStep = (order.steps || []).find(
        (candidate: any) =>
          !text(candidate.parent_node_key) &&
          candidate.output_item_id === inspection.line.item_id,
      );
      if (productStep && inspection.rejectedQty > 0) {
        const { error: productStepError } = await this.supabase
          .from("subcontract_order_steps")
          .update({
            accepted_qty: Math.max(
              0,
              roundQty(num(productStep.accepted_qty) - inspection.rejectedQty),
            ),
            rejected_qty: roundQty(
              num(productStep.rejected_qty) + inspection.rejectedQty,
            ),
            scrap_qty: roundQty(
              num(productStep.scrap_qty) +
                (inspection.disposition === "SCRAP"
                  ? inspection.rejectedQty
                  : 0),
            ),
            updated_at: now,
          } as any)
          .eq("tenant_id", tenantId)
          .eq("id", productStep.id);
        if (productStepError)
          throw new BadRequestException(productStepError.message);
      }
    }
    const { error: receiptError } = await this.supabase
      .from("subcontract_movements")
      .update({
        accepted_qty: approvedQty,
        rejected_qty: rejectedQty,
        scrap_qty: qcScrapQty,
        qc_status: rejectedQty > 0 ? "PARTIALLY_APPROVED" : "APPROVED",
        qc_approved_qty: approvedQty,
        qc_approved_at: now,
        qc_approved_by: userId,
        qc_notes: text(body.notes),
        processing_amount: processingAmount,
        tax_amount: taxAmount,
        payable_amount: payableAmount,
        invoice_status: invoiceStatus,
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", receiptId);
    if (receiptError) throw new BadRequestException(receiptError.message);
    const issueMovement = (order.movements || []).find(
      (movement: any) => movement.id === receipt.issue_movement_id,
    );
    const issueClosed =
      !!issueMovement &&
      num(issueMovement.remaining_qty, num(issueMovement.quantity)) <= 0.01;
    // One current service order issues RM once at route level. Its GRN therefore
    // settles all root output lines together, rather than leaving five sibling
    // products permanently in IN_PROCESS after the single QC decision.
    const settledStepIds = !issueMovement?.order_step_id
      ? (order.steps || [])
          .filter((candidate: any) => !text(candidate.parent_node_key))
          .map((candidate: any) => candidate.id)
      : step
        ? [step.id]
        : [];
    const nextStepStatus = inspections.some(
      (inspection) =>
        inspection.rejectedQty > 0 && inspection.disposition === "REWORK",
    )
      ? "IN_PROCESS"
      : issueClosed
        ? "COMPLETED"
        : "IN_PROCESS";
    if (step) {
      const { error: stepError } = await this.supabase
        .from("subcontract_order_steps")
        .update({
          payable_amount: accumulatedPayable,
          deduction_amount: accumulatedDeductions,
          processing_amount: accumulatedProcessing,
          freight_amount: accumulatedFreight,
          other_charges_amount: accumulatedOtherCharges,
          tax_amount: accumulatedTax,
          invoice_status: invoiceStatus,
          status: nextStepStatus,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", step.id);
      if (stepError) throw new BadRequestException(stepError.message);
      const siblingIds = settledStepIds.filter((id: string) => id !== step.id);
      if (siblingIds.length) {
        const { error: siblingsError } = await this.supabase
          .from("subcontract_order_steps")
          .update({
            status: nextStepStatus,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("tenant_id", tenantId)
          .in("id", siblingIds);
        if (siblingsError) throw new BadRequestException(siblingsError.message);
      }
      // The route-level MOC settles every root output line together.  Do not
      // read their pre-QC status here: `order` is the snapshot loaded before
      // the sibling updates above. Only a real downstream operation keeps the
      // service order open after root QC.
      const remainingOpenSteps = (order.steps || []).filter(
        (candidate: any) =>
          !settledStepIds.includes(candidate.id) &&
          !["COMPLETED", "CANCELLED"].includes(
            String(candidate.status || "").toUpperCase(),
          ),
      );
      const allComplete =
        nextStepStatus === "COMPLETED" && remainingOpenSteps.length === 0;
      if (allComplete) {
        await this.supabase
          .from("subcontract_orders")
          .update({
            status: "COMPLETED",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq("tenant_id", tenantId)
          .eq("id", order.id);
      } else if (nextStepStatus === "IN_PROCESS") {
        // QC has been completed, but the route-level outward challan still has
        // RM held by the vendor.  This is not a completed order, and calling it
        // merely "IN_PROCESS" hides that a partial GRN was already QC cleared.
        await this.supabase
          .from("subcontract_orders")
          .update({
            status: "PARTIALLY_RECEIVED",
            updated_at: new Date().toISOString(),
          } as any)
          .eq("tenant_id", tenantId)
          .eq("id", order.id);
      }
    }
    // The vendor liability is finance-drafted only after QC confirms the
    // subcontract receipt. It remains review/approval controlled and does not
    // interfere with goods receipt when no posting rule has been enabled.
    await this.accountingService?.queueAutomaticOperationalPosting(
      tenantId,
      userId,
      {
        source_type: "SUBCONTRACT_RECEIPT",
        source_id: receipt.id,
        source_number: receipt.document_number,
        amount: payableAmount,
        journal_date: String(
          receipt.invoice_date ||
            receipt.created_at ||
            new Date().toISOString(),
        ).slice(0, 10),
        narration: `QC-approved subcontract receipt ${receipt.document_number}`,
      },
    );
    await this.refreshOrderReconciliation(req, orderId, userId);
    return this.findOrder(req, orderId);
  }

  async recordStepInvoice(
    req: RequestWithUser,
    orderId: string,
    stepId: string,
    body: any,
  ) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    const order = await this.findOrder(req, orderId);
    const step = (order.steps || []).find(
      (candidate: any) => candidate.id === stepId,
    );
    if (!step) throw new NotFoundException("Operation step not found");
    if (
      String(step.invoice_status || "").toUpperCase() === "PAID" ||
      num(step.paid_amount) > 0.009
    ) {
      throw new BadRequestException(
        "The supplier invoice cannot be changed after payment is recorded.",
      );
    }

    const invoiceNumber = text(body.invoice_number);
    const invoiceDate = text(body.invoice_date).slice(0, 10);
    if (!invoiceNumber)
      throw new BadRequestException("Supplier invoice number is required.");
    if (!invoiceDate)
      throw new BadRequestException("Supplier invoice date is required.");
    if (num(step.payable_amount) <= 0.009)
      throw new BadRequestException(
        "No QC-approved subcontract payable is available for invoice matching.",
      );

    const approvedReceipts = (order.movements || []).filter(
      (movement: any) =>
        movement.movement_type === "SUBCON_SRV" &&
        movement.order_step_id === stepId &&
        ["APPROVED", "PARTIALLY_APPROVED"].includes(
          String(movement.qc_status || "").toUpperCase(),
        ),
    );
    if (!approvedReceipts.length) {
      throw new BadRequestException(
        "Complete QC inspection for the subcontract GRN before recording the supplier invoice.",
      );
    }

    const now = new Date().toISOString();
    const { error: stepError } = await this.supabase
      .from("subcontract_order_steps")
      .update({
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        invoice_status: "INVOICE_RECEIVED",
        updated_at: now,
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", stepId);
    if (stepError) throw new BadRequestException(stepError.message);

    const attachmentUrl = text(body.attachment_url);
    for (const receipt of approvedReceipts) {
      const existingNotes = text(receipt.notes);
      const attachmentNote =
        attachmentUrl && !existingNotes.includes(attachmentUrl)
          ? `Vendor invoice attachment: ${attachmentUrl}`
          : "";
      const { error: receiptError } = await this.supabase
        .from("subcontract_movements")
        .update({
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          invoice_status: "INVOICE_RECEIVED",
          notes:
            [existingNotes, attachmentNote].filter(Boolean).join("\n") || null,
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", receipt.id);
      if (receiptError) throw new BadRequestException(receiptError.message);
    }

    return this.findOrder(req, orderId);
  }

  async markStepPaid(
    req: RequestWithUser,
    orderId: string,
    stepId: string,
    body: any,
  ) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    const order = await this.findOrder(req, orderId);
    const step = (order.steps || []).find((s: any) => s.id === stepId);
    if (!step) throw new NotFoundException("Operation step not found");
    const payable = num(step.payable_amount);
    if (
      !["INVOICE_RECEIVED", "PENDING_PAYMENT"].includes(
        String(step.invoice_status),
      )
    ) {
      throw new BadRequestException(
        "Record and match the supplier invoice to the QC-approved subcontract GRN before payment.",
      );
    }
    const amount = num(body.amount, payable);
    if (payable <= 0)
      throw new BadRequestException(
        "No subcontractor payable is recorded for this operation",
      );
    if (amount <= 0)
      throw new BadRequestException("Payment amount must be greater than zero");
    if (amount > payable + 0.009)
      throw new BadRequestException(
        "Payment amount cannot exceed payable amount",
      );

    const nextPaid = Math.min(payable, num(step.paid_amount) + amount);
    const invoiceStatus =
      nextPaid >= payable - 0.009 ? "PAID" : "PENDING_PAYMENT";
    const { error } = await this.supabase
      .from("subcontract_order_steps")
      .update({
        paid_amount: nextPaid,
        invoice_status: invoiceStatus,
        payment_reference: text(body.payment_reference) || null,
        payment_date:
          text(body.payment_date) || new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("tenant_id", tenantId)
      .eq("id", stepId);
    if (error) throw new BadRequestException(error.message);
    return this.findOrder(req, orderId);
  }

  async finance(req: RequestWithUser) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    const { data, error } = await this.supabase
      .from("subcontract_order_steps")
      .select(
        "*, order:subcontract_orders(id, order_number, status, route:subcontract_routes(route_number, name))",
      )
      .eq("tenant_id", tenantId)
      .gt("payable_amount", 0)
      .in("invoice_status", [
        "PENDING_INVOICE",
        "INVOICE_RECEIVED",
        "PENDING_PAYMENT",
        "PAID",
      ])
      .order("received_at", { ascending: false });
    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw new BadRequestException(error.message);
    }

    const vendorIds = Array.from(
      new Set((data || []).map((row: any) => row.vendor_id).filter(Boolean)),
    );
    const vendorById = new Map<string, any>();
    if (vendorIds.length) {
      const { data: vendors, error: vendorError } = await this.supabase
        .from("vendors")
        .select("id, code, name")
        .eq("tenant_id", tenantId)
        .in("id", vendorIds);
      if (vendorError) throw new BadRequestException(vendorError.message);
      (vendors || []).forEach((vendor: any) =>
        vendorById.set(vendor.id, vendor),
      );
    }

    return (data || []).map((row: any) => ({
      ...row,
      vendor: row.vendor_id ? vendorById.get(row.vendor_id) || null : null,
      outstanding_amount: Math.max(
        0,
        num(row.payable_amount) - num(row.paid_amount),
      ),
    }));
  }

  async vendorStock(req: RequestWithUser) {
    await this.ensureSchema();
    const { tenantId } = req.user;
    const { data, error } = await this.supabase
      .from("subcontract_orders")
      .select(
        "id, order_number, status, input_item_id, steps:subcontract_order_steps(id, operation_name, vendor_id, input_item_id, output_item_id, status), movements:subcontract_movements(id, movement_type, order_step_id, vendor_id, quantity, remaining_qty, qc_status, document_number)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["IN_PROCESS", "ISSUED", "PARTIALLY_RECEIVED"]);
    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw new BadRequestException(error.message);
    }

    return (data || [])
      .map((order: any) => {
        const routeIssue = (order.movements || []).find(
          (movement: any) =>
            movement.movement_type === "SUBCON_SIV" && !movement.order_step_id,
        );
        const pendingQc = (order.movements || []).find(
          (movement: any) =>
            movement.movement_type === "SUBCON_SRV" &&
            movement.qc_status === "PENDING_QC",
        );
        const outputSteps = (order.steps || []).filter(
          (step: any) =>
            !["COMPLETED", "CANCELLED"].includes(String(step.status)),
        );
        const firstStep = outputSteps[0] || (order.steps || [])[0] || {};
        return {
          id: `wip-${order.id}`,
          order_id: order.id,
          order: { id: order.id, order_number: order.order_number },
          operation_name: `${(order.steps || []).length} output items`,
          vendor_id: routeIssue?.vendor_id || firstStep.vendor_id || null,
          input_item_id: order.input_item_id || firstStep.input_item_id || null,
          outstanding_qty: Math.max(
            0,
            num(routeIssue?.remaining_qty, num(routeIssue?.quantity)),
          ),
          status: pendingQc ? "PENDING_QC" : order.status,
          document_number: routeIssue?.document_number || null,
          pending_qc_receipt_id: pendingQc?.id || null,
        };
      })
      .filter(
        (row: any) => row.outstanding_qty > 0 || row.status === "PENDING_QC",
      );
  }
}
