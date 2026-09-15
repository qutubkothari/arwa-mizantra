"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardList,
  CreditCard,
  Factory,
  GitBranch,
  Eye,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptText,
  Info,
  RefreshCw,
  Route,
  Save,
  Search,
  Truck,
  Trash2,
  X,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
import DateInput from "../../../../components/ui/DateInput";
import { confirmDialog } from "../../../../components/ui/ConfirmDialog";
import {
  ListTable,
  ListTableColumn,
} from "../../../../components/ui/ListTable";
import SearchableDropdown from "../../../../components/SearchableSelect";
import {
  buildDocumentBranding,
  renderStandardLetterheadHtml,
} from "@/lib/document-branding";
import {
  compactSmartSearchText,
  normalizeSmartSearchText,
  smartSearchTokens,
} from "@/lib/smart-search";

type Item = {
  id: string;
  code?: string;
  name?: string;
  uom?: string;
  product_size?: number;
  product_size_uom?: string;
  current_stock?: number;
  available_quantity?: number;
};
type Vendor = {
  id: string;
  vendor_code?: string;
  code?: string;
  name?: string;
  vendor_name?: string;
};
type Warehouse = { id: string; code?: string; name?: string };
type SelectOption = { value: string; label: string; meta?: string };

function stockItemUom(items: Item[], itemId?: string, fallback = "") {
  const item = items.find((candidate) => candidate.id === itemId);
  return String(item?.uom || fallback || "")
    .trim()
    .toUpperCase();
}

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  for (const key of ["items", "data", "rows", "results"]) {
    const candidate = root[key];
    if (Array.isArray(candidate)) return candidate as T[];
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      for (const nestedKey of ["items", "data", "rows", "results"]) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as T[];
      }
    }
  }
  return [];
}

type RouteStep = {
  id?: string;
  sequence_no: number;
  node_key?: string;
  parent_node_key?: string;
  branch_no?: number;
  operation_name: string;
  process_type?: string;
  vendor_id?: string;
  department?: string;
  input_item_id?: string;
  output_item_id?: string;
  input_uom?: string;
  input_size?: number | string;
  output_uom?: string;
  output_size?: number | string;
  default_input_qty?: number | string;
  default_output_qty?: number | string;
  input_weight_per_piece?: number | string;
  output_weight_per_piece?: number | string;
  planned_input_weight?: number;
  planned_output_weight?: number;
  calculated_scrap_weight?: number;
  standard_yield_pct?: number;
  scrap_tolerance_pct?: number;
  qc_required?: boolean;
  instructions?: string;
};

function requiresRawMaterialLength(
  inputItemId: string | undefined,
  inputUom: string,
  steps: RouteStep[],
) {
  const normalizedInputItemId = String(inputItemId || "").trim();
  const normalizedInputUom = String(inputUom || "")
    .trim()
    .toUpperCase();
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
    .filter((step) => !step.parent_node_key)
    .some(
      (step) =>
        Boolean(step.output_item_id) &&
        step.output_item_id !== normalizedInputItemId &&
        countUoms.has(
          String(step.output_uom || "")
            .trim()
            .toUpperCase(),
        ),
    );
}

type RouteTemplate = {
  id: string;
  route_number: string;
  name: string;
  input_item_id?: string;
  output_item_id?: string;
  default_input_qty?: number;
  default_output_qty?: number;
  consumption_per_output_qty?: number;
  expected_consumption_qty?: number;
  expected_unused_qty?: number;
  uom?: string;
  piece_size?: number;
  size_uom?: string;
  total_input_weight?: number;
  total_output_weight?: number;
  calculated_scrap_weight?: number;
  status?: string;
  notes?: string;
  steps?: RouteStep[];
};

type OrderStep = RouteStep & {
  id: string;
  planned_input_qty?: number;
  planned_output_qty?: number;
  input_uom?: string;
  total_input_weight?: number;
  remaining_raw_material_weight?: number;
  remaining_secondary_input_qty?: number;
  secondary_input_qty?: number;
  secondary_input_uom?: string;
  all_finished_goods_received?: boolean;
  issued_qty?: number;
  accepted_qty?: number;
  receipt_received_qty?: number;
  rejected_qty?: number;
  scrap_qty?: number;
  unused_return_qty?: number;
  consumed_input_weight?: number;
  unit_price?: number;
  hsn_code?: string;
  discount_percent?: number;
  processing_rate?: number;
  processing_amount?: number;
  tax_percent?: number;
  tax_amount?: number;
  freight_amount?: number;
  other_charges_amount?: number;
  deduction_amount?: number;
  payable_amount?: number;
  paid_amount?: number;
  invoice_number?: string;
  invoice_date?: string;
  invoice_status?: string;
  payment_reference?: string;
  payment_date?: string;
  status?: string;
};

type SubOrder = {
  id: string;
  order_number: string;
  requisition_number?: string;
  approval_status?: string;
  submitted_at?: string;
  approved_at?: string;
  rejection_reason?: string;
  route_id?: string;
  status?: string;
  planned_input_qty?: number;
  planned_output_qty?: number;
  input_uom?: string;
  total_input_weight?: number;
  remaining_raw_material_weight?: number;
  remaining_secondary_input_qty?: number;
  secondary_input_qty?: number;
  secondary_input_uom?: string;
  all_finished_goods_received?: boolean;
  current_step_no?: number;
  steps?: OrderStep[];
  movements?: any[];
  route?: {
    route_number?: string;
    name?: string;
    input_item_id?: string;
    output_item_id?: string;
  };
};

type SubcontractGrnRow = {
  id: string;
  order: SubOrder;
  movement: any;
  step?: OrderStep;
};

const badgeTone: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800 border-emerald-200",
  OPEN: "bg-amber-50 text-amber-900 border-amber-200",
  READY: "bg-blue-50 text-blue-800 border-blue-200",
  IN_PROCESS: "bg-amber-50 text-amber-900 border-amber-200",
  PARTIALLY_RECEIVED: "bg-violet-50 text-violet-800 border-violet-200",
  RM_BALANCE_PENDING: "bg-orange-50 text-orange-800 border-orange-200",
  COMPLETED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  INVOICE_RECEIVED: "bg-blue-50 text-blue-800 border-blue-200",
  PENDING_PAYMENT: "bg-amber-50 text-amber-900 border-amber-200",
  PENDING_QC: "bg-blue-50 text-blue-800 border-blue-200",
  DRAFT: "bg-stone-50 text-stone-700 border-stone-200",
  SUBMITTED: "bg-amber-50 text-amber-900 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REJECTED: "bg-red-50 text-red-800 border-red-200",
  PAID: "bg-emerald-50 text-emerald-800 border-emerald-200",
  NOT_RECEIVED: "bg-stone-50 text-stone-700 border-stone-200",
  WAITING: "bg-stone-50 text-stone-700 border-stone-200",
};

function fmt(n: any) {
  const value = Number(n || 0);
  return Number.isFinite(value)
    ? value.toLocaleString("en-IN", { maximumFractionDigits: 3 })
    : "0";
}

function fmtMoney(n: any) {
  const value = Number(n || 0);
  return Number.isFinite(value)
    ? value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";
}

function fmtDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
}

function escapePrintHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] || char,
  );
}

function automaticUnusedReturn(
  order: SubOrder | null,
  lines: Array<{
    item_id: string;
    quantity: string;
    planned_qty?: number;
    received_qty?: number;
  }>,
  issueBalance: number,
  scrapQty = 0,
  lossQty = 0,
) {
  if (!order || issueBalance <= 0) return "";
  const roots = (order.steps || []).filter(
    (step) => !step.parent_node_key && step.output_item_id,
  );
  if (!roots.length) return "";
  const nonProductSettlement =
    Math.max(0, Number(scrapQty || 0)) + Math.max(0, Number(lossQty || 0));
  if (!lines.length)
    return order.all_finished_goods_received
      ? String(
          Math.max(
            0,
            Math.round((issueBalance - nonProductSettlement) * 10_000) / 10_000,
          ),
        )
      : "";
  const receiptByItem = new Map<string, number>();
  for (const line of lines)
    receiptByItem.set(
      line.item_id,
      Number(receiptByItem.get(line.item_id) || 0) + Number(line.quantity || 0),
    );
  const completesAll = roots.every(
    (step) =>
      Number(step.receipt_received_qty || 0) +
        Number(receiptByItem.get(step.output_item_id || "") || 0) +
        0.0001 >=
      Number(step.planned_output_qty || 0),
  );
  if (!completesAll) return "";
  const plannedInput = Number(order.planned_input_qty || 0);
  const plannedLength = Number(order.secondary_input_qty || 0);
  const producedLength = lines.reduce((total, line) => {
    const step = roots.find(
      (candidate) => candidate.output_item_id === line.item_id,
    );
    return (
      total +
      (Number(step?.output_size || 0) * Number(line.quantity || 0)) / 1000
    );
  }, 0);
  const plannedOutput = roots.reduce(
    (total, step) => total + Number(step.planned_output_qty || 0),
    0,
  );
  const receiptOutput = lines.reduce(
    (total, line) => total + Number(line.quantity || 0),
    0,
  );
  const inputUom = String(order.input_uom || "")
    .trim()
    .toUpperCase();
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
    plannedLength > 0 &&
    producedLength > 0;
  const ratio = useLengthBackflush
    ? plannedInput / plannedLength
    : plannedInput > 0 && plannedOutput > 0
      ? plannedInput / plannedOutput
      : 0;
  const basis = useLengthBackflush ? producedLength : receiptOutput;
  const consumption = Math.min(
    issueBalance,
    Math.max(0, ratio > 0 ? basis * ratio : issueBalance),
  );
  return String(
    Math.max(
      0,
      Math.round((issueBalance - consumption - nonProductSettlement) * 10_000) /
        10_000,
    ),
  );
}

function vendorInvoiceAttachmentUrl(notes?: string | null) {
  const match = String(notes || "").match(
    /Vendor invoice attachment:\s*(https?:\/\/\S+)/i,
  );
  return match?.[1] || "";
}

function itemLabel(items: Item[], id?: string) {
  const item = items.find((row) => row.id === id);
  return item ? `${item.code || ""} ${item.name || ""}`.trim() : "-";
}

function subcontractOrderInputUom(order: SubOrder, items: Item[]) {
  return String(
    order.input_uom || stockItemUom(items, order.route?.input_item_id) || "UOM",
  )
    .trim()
    .toUpperCase();
}

function subcontractOrderOutputUom(order: SubOrder, items: Item[]) {
  const uoms = Array.from(
    new Set(
      (order.steps || [])
        .filter((step) => !step.parent_node_key && step.output_item_id)
        .map((step) =>
          stockItemUom(items, step.output_item_id, step.output_uom),
        )
        .filter(Boolean),
    ),
  );
  return uoms.length === 1 ? uoms[0] : uoms.length > 1 ? "MULTIPLE" : "UOM";
}

function subcontractMovementScrapUom(
  movement: any,
  inputUom: string,
  outputUom: string,
) {
  const movementType = String(movement.movement_type || "").toUpperCase();
  const qcStatus = String(movement.qc_status || "").toUpperCase();
  const isFinishedGoodQcScrap =
    movementType === "SUBCON_QC_SCRAP" ||
    (movementType === "SUBCON_SRV" &&
      ["APPROVED", "PARTIALLY_APPROVED"].includes(qcStatus));

  // Rejections and the scrap created by line-item QC are finished-product
  // quantities (for example 5 NUMBER/Nos), not raw-material weight.  Only
  // receipt-time process scrap uses the issued raw-material UOM.
  return isFinishedGoodQcScrap ? outputUom : inputUom;
}

function vendorLabel(vendors: Vendor[], id?: string) {
  const vendor = vendors.find((row) => row.id === id);
  return vendor
    ? `${vendor.name || vendor.vendor_name || ""}`.trim() ||
        vendor.vendor_code ||
        vendor.code ||
        "-"
    : "-";
}

function warehouseLabel(warehouses: Warehouse[], id?: string) {
  const warehouse = warehouses.find((row) => row.id === id);
  return warehouse
    ? `${warehouse.code || ""}${warehouse.code && warehouse.name ? " - " : ""}${warehouse.name || ""}`
    : "-";
}

function StatusBadge({ value }: { value?: string }) {
  const text = String(value || "-").toUpperCase();
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeTone[text] || "bg-white text-stone-700 border-stone-200"}`}
    >
      {text.replace(/_/g, " ")}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6c4f32]">
        {label}
      </span>
      {children}
    </label>
  );
}

function SearchSelect({
  label,
  value,
  options,
  placeholder,
  onChange,
  onAddNew,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  onAddNew?: (term: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const selected = options.find((option) => option.value === value);
  const visible = options
    .filter((option) =>
      `${option.label} ${option.meta || ""}`
        .toLowerCase()
        .includes(term.toLowerCase()),
    )
    .slice(0, 40);

  return (
    <Field label={label}>
      <div className="relative">
        <input
          value={open ? term : selected?.label || ""}
          onFocus={() => {
            setOpen(true);
            setTerm("");
          }}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full border border-[#d8c6aa] bg-white px-3 py-2 outline-none focus:border-[#977447]"
        />
        {open && (
          <div className="absolute z-[260] mt-1 max-h-72 w-full overflow-auto border border-[#d8c6aa] bg-white shadow-xl">
            {visible.map((option) => (
              <button
                key={option.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setTerm("");
                }}
                className="block w-full px-3 py-2 text-left hover:bg-[#f8f1e7]"
              >
                <span className="block text-sm font-semibold text-[#2f241b]">
                  {option.label}
                </span>
                {option.meta && (
                  <span className="block text-xs text-[#7b6753]">
                    {option.meta}
                  </span>
                )}
              </button>
            ))}
            {visible.length === 0 && (
              <div className="px-3 py-3 text-sm text-[#7b6753]">
                No matching records
              </div>
            )}
            {onAddNew && term.trim() && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onAddNew(term.trim());
                  setOpen(false);
                  setTerm("");
                }}
                className="block w-full border-t border-[#eadcc8] px-3 py-2 text-left text-sm font-bold text-[#805f35] hover:bg-[#f8f1e7]"
              >
                + Add "{term.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

function IconButton({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#d8c6aa] bg-white text-[#5b432c] hover:bg-[#f8f1e7] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function normalizeSearchText(value: unknown) {
  return normalizeSmartSearchText(value);
}

function searchTokens(value: string) {
  return smartSearchTokens(value);
}

function scoreSearchMatch(searchValue: string, haystackValue: string) {
  const query = normalizeSearchText(searchValue);
  if (!query) return 1;
  const haystack = normalizeSearchText(haystackValue);
  if (!haystack) return -1;
  if (haystack === query) return 1000;
  if (haystack.startsWith(query)) return 800;
  if (haystack.includes(query)) return 600;

  const tokens = searchTokens(searchValue);
  if (!tokens.length) return 1;
  const compactHaystack = compactSmartSearchText(haystack);
  if (
    !tokens.every(
      (token) =>
        haystack.includes(normalizeSmartSearchText(token)) ||
        compactHaystack.includes(compactSmartSearchText(token)),
    )
  ) return -1;
  return tokens.reduce(
    (score, token) => score + (haystack.startsWith(token) ? 120 : 40),
    200,
  );
}

function filterAndRankRows<T>(
  rows: T[],
  searchValue: string,
  buildHaystack: (row: T) => string,
) {
  const query = normalizeSearchText(searchValue);
  if (!query) return rows;
  return rows
    .map((row, index) => ({
      row,
      index,
      score: scoreSearchMatch(searchValue, buildHaystack(row)),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.row);
}

function createEmptyRouteForm() {
  return {
    name: "",
    input_item_id: "",
    output_item_id: "",
    default_input_qty: "",
    default_output_qty: "100",
    input_weight_per_piece: "",
    output_weight_per_piece: "",
    consumption_per_output_qty: "",
    expected_consumption_qty: "",
    expected_unused_qty: "",
    uom: "",
    vendor_id: "",
    notes: "",
    steps: [
      {
        sequence_no: 1,
        node_key: "NODE-1",
        parent_node_key: "",
        branch_no: 1,
        operation_name: "",
        process_type: "OUTSIDE_PROCESSING",
        vendor_id: "",
        department: "",
        input_item_id: "",
        output_item_id: "",
        input_uom: "",
        input_size: "",
        output_uom: "",
        output_size: "",
        default_input_qty: "",
        default_output_qty: "",
        input_weight_per_piece: "",
        output_weight_per_piece: "",
        standard_yield_pct: 100,
        scrap_tolerance_pct: 0,
        qc_required: true,
        instructions: "",
      },
    ] as RouteStep[],
  };
}

function createEmptyOrderForm(defaultWarehouseId = "") {
  return {
    route_id: "",
    vendor_id: "",
    source_warehouse_id: defaultWarehouseId,
    output_warehouse_id: defaultWarehouseId,
    planned_input_qty: "",
    input_uom: "",
    secondary_input_qty: "",
    secondary_input_uom: "",
    notes: "",
  };
}

function newOrderRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `subcontract-order-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function SubcontractingPage() {
  const [activeTab, setActiveTab] = useState<
    "orders" | "grns" | "routes" | "wip"
  >("orders");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<any>({});
  const [orders, setOrders] = useState<SubOrder[]>([]);
  const [routes, setRoutes] = useState<RouteTemplate[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [vendorStock, setVendorStock] = useState<any[]>([]);
  const [financeRows, setFinanceRows] = useState<any[]>([]);
  const [uomOptions, setUomOptions] = useState([
    "NUMBER",
    "MTR",
    "MM",
    "CM",
    "NOS",
    "PCS",
    "KG",
    "LTR",
    "SET",
  ]);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<
    | "route"
    | "routeView"
    | "order"
    | "issue"
    | "receive"
    | "trail"
    | "view"
    | "moc"
    | null
  >(null);
  const [selectedRoute, setSelectedRoute] = useState<RouteTemplate | null>(
    null,
  );
  const [selectedOrder, setSelectedOrder] = useState<SubOrder | null>(null);
  const [selectedMoc, setSelectedMoc] = useState<any | null>(null);
  const [selectedStep, setSelectedStep] = useState<OrderStep | null>(null);
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>(
    [],
  );
  const [showProcessFlow, setShowProcessFlow] = useState(false);
  const [showFullOrders, setShowFullOrders] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState<{
    row: any;
    invoiceNumber: string;
    invoiceDate: string;
    file: File | null;
  } | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    row: any;
    amount: string;
    reference: string;
  } | null>(null);
  const [qcModal, setQcModal] = useState<{
    order: SubOrder;
    receipt: any;
    notes: string;
    lines: Array<{
      id: string;
      itemId: string;
      receivedQty: number;
      approvedQty: string;
      disposition: "REWORK" | "SCRAP";
      scrapItemId: string;
      notes: string;
    }>;
  } | null>(null);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [orderRequestId, setOrderRequestId] = useState("");
  const [savingOrder, setSavingOrder] = useState(false);

  const [routeForm, setRouteForm] = useState(createEmptyRouteForm);

  const [orderForm, setOrderForm] = useState(() => createEmptyOrderForm());
  const [orderLines, setOrderLines] = useState<
    Array<{
      node_key: string;
      item_id: string;
      uom: string;
      quantity: string;
      size: string;
      price: string;
      hsn_code: string;
      discount_percent: string;
    }>
  >([]);
  const [issueForm, setIssueForm] = useState({
    quantity: "",
    reference_number: "",
    notes: "",
  });
  const [receiveForm, setReceiveForm] = useState({
    issue_id: "",
    finished_goods: [] as Array<{
      item_id: string;
      quantity: string;
      raw_material_qty: string;
      actual_weight: string;
      planned_qty?: number;
      received_qty?: number;
      remaining_qty?: number;
      uom?: string;
    }>,
    rejected_qty: "",
    scrap_qty: "",
    unused_return_qty: "",
    loss_qty: "",
    loss_reason: "",
    scrap_item_id: "",
    reference_number: "",
    processing_rate: "",
    freight_amount: "",
    other_charges_amount: "",
    deduction_amount: "",
    tax_percent: "18",
    invoice_number: "",
    invoice_date: "",
    notes: "",
  });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      // The operational grid only needs routes and orders. The item and vendor
      // masters are large, so waiting for them here makes four orders feel as
      // slow as downloading the entire ERP master-data set.
      const [routeRows, orderRows] = await Promise.all([
        apiClient.get<RouteTemplate[]>("/production/subcontracting/routes"),
        apiClient.get<SubOrder[]>("/production/subcontracting/orders"),
      ]);
      setRoutes(routeRows || []);
      setOrders(orderRows || []);

      // Populate cards, form lookups and secondary views after the order grid
      // is usable. These requests must not hold the main table hostage.
      void Promise.all([
        apiClient
          .get<any>("/production/subcontracting/dashboard")
          .catch(() => ({})),
        apiClient
          .get<Item[]>("/inventory/items")
          .catch(() => apiClient.get<Item[]>("/items")),
        apiClient
          .get<Vendor[]>("/purchase/vendors?isActive=true")
          .catch(() => [] as Vendor[]),
        apiClient
          .get<Warehouse[]>("/inventory/warehouses")
          .catch(() => [] as Warehouse[]),
        apiClient
          .get<any[]>("/production/subcontracting/vendor-stock")
          .catch(() => [] as any[]),
      ]).then(([dash, itemRows, vendorRows, whRows, wipRows]) => {
        setDashboard(dash || {});
        setItems(unwrapList<Item>(itemRows));
        setVendors(vendorRows || []);
        setWarehouses(whRows || []);
        setVendorStock(wipRows || []);
      });
    } catch (err: any) {
      setError(err?.message || "Failed to load subcontracting data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filteredOrders = useMemo(() => {
    return filterAndRankRows(orders, search, (order) =>
      [
        order.order_number,
        order.route?.route_number,
        order.route?.name,
        order.status,
        itemLabel(items, order.route?.input_item_id),
        itemLabel(items, order.route?.output_item_id),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }, [items, orders, search]);
  const operationalOrders = useMemo(
    () =>
      [...filteredOrders]
        .filter(
          (order) => String(order.status || "").toUpperCase() !== "COMPLETED",
        )
        .sort((left, right) => {
          const leftPendingQc = (left.movements || []).some(
            (movement: any) =>
              movement.movement_type === "SUBCON_SRV" &&
              String(movement.qc_status || "").toUpperCase() === "PENDING_QC",
          );
          const rightPendingQc = (right.movements || []).some(
            (movement: any) =>
              movement.movement_type === "SUBCON_SRV" &&
              String(movement.qc_status || "").toUpperCase() === "PENDING_QC",
          );
          return Number(rightPendingQc) - Number(leftPendingQc);
        })
        .slice(0, 6),
    [filteredOrders],
  );

  const subcontractGrns = useMemo<SubcontractGrnRow[]>(() => {
    return orders
      .flatMap((order) =>
        (order.movements || [])
          .filter((movement: any) => movement.movement_type === "SUBCON_SRV")
          .map((movement: any) => ({
            id: movement.id,
            order,
            movement,
            step: (order.steps || []).find(
              (candidate) => candidate.id === movement.order_step_id,
            ),
          })),
      )
      .sort(
        (left, right) =>
          new Date(right.movement.created_at || 0).getTime() -
          new Date(left.movement.created_at || 0).getTime(),
      );
  }, [orders]);

  const filteredGrns = useMemo(() => {
    return filterAndRankRows(subcontractGrns, search, (row) =>
      [
        row.movement.document_number,
        row.movement.external_reference,
        row.movement.invoice_number,
        row.movement.qc_status,
        row.order.order_number,
        row.order.requisition_number,
        row.order.route?.route_number,
        row.order.route?.name,
        row.step?.operation_name,
        vendorLabel(vendors, row.movement.vendor_id || row.step?.vendor_id),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }, [search, subcontractGrns, vendors]);

  const filteredRoutes = useMemo(() => {
    return filterAndRankRows(routes, search, (route) =>
      [
        route.route_number,
        route.name,
        route.status,
        itemLabel(items, route.input_item_id),
        itemLabel(items, route.output_item_id),
        ...(route.steps || []).map(
          (step) =>
            `${step.operation_name || ""} ${vendorLabel(vendors, step.vendor_id)}`,
        ),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }, [items, routes, search, vendors]);

  const filteredVendorStock = useMemo(() => {
    const grouped: any[] = Array.from(
      vendorStock
        .reduce((map, row) => {
          const key = row.order_id || row.order?.id || row.id;
          const existing = map.get(key) || {
            ...row,
            id: `wip-${key}`,
            groupedRows: [],
            outstanding_qty: 0,
          };
          existing.groupedRows.push(row);
          existing.outstanding_qty += Number(row.outstanding_qty || 0);
          existing.operation_name =
            existing.groupedRows.length === 1 && row.operation_name
              ? row.operation_name
              : `${existing.groupedRows.length} output items pending`;
          map.set(key, existing);
          return map;
        }, new Map<string, any>())
        .values(),
    );
    return filterAndRankRows(grouped, search, (row) =>
      [
        row.order?.order_number,
        row.operation_name,
        row.status,
        vendorLabel(vendors, row.vendor_id),
        itemLabel(items, row.input_item_id),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }, [items, search, vendorStock, vendors]);

  async function openVendorSource(row: any) {
    try {
      const orderId = row.order_id || row.order?.id;
      if (!orderId)
        throw new Error("This Vendor WIP row has no linked service order");
      const full: any = await apiClient.get(
        `/production/subcontracting/orders/${orderId}`,
      );
      const order = (full?.data || full?.order || full) as SubOrder;
      setSelectedOrder(order);
      setPanel("trail");
    } catch (err: any) {
      await confirmDialog({
        title: "Source Order Not Available",
        message: err?.message || "Could not load the linked service order.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function inspectVendorReceipt(row: any) {
    try {
      const orderId = row.order_id || row.order?.id;
      if (!orderId)
        throw new Error("This Vendor WIP row has no linked service order");
      const full: any = await apiClient.get(
        `/production/subcontracting/orders/${orderId}`,
      );
      const order = (full?.data || full?.order || full) as SubOrder;
      const receipt = (order.movements || []).find(
        (movement: any) =>
          movement.movement_type === "SUBCON_SRV" &&
          String(movement.qc_status || "").toUpperCase() === "PENDING_QC",
      );
      if (!receipt)
        throw new Error(
          "No received subcontract GRN is awaiting QC inspection for this order. Post the receipt from the Orders tab first.",
        );
      openReceiptQc(order, receipt);
    } catch (err: any) {
      await confirmDialog({
        title: "QC Inspection Not Available",
        message: err?.message || "Could not load the receipt awaiting QC.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function inspectSubcontractGrn(row: SubcontractGrnRow) {
    try {
      const full: any = await apiClient.get(
        `/production/subcontracting/orders/${row.order.id}`,
      );
      const order = (full?.data || full?.order || full) as SubOrder;
      const receipt = (order.movements || []).find(
        (movement: any) =>
          movement.id === row.movement.id &&
          movement.movement_type === "SUBCON_SRV",
      );
      if (!receipt) throw new Error("This subcontract GRN could not be found.");
      openReceiptQc(order, receipt);
    } catch (err: any) {
      await confirmDialog({
        title: "QC Inspection Not Available",
        message: err?.message || "Could not load this subcontract GRN.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  const filteredFinanceRows = useMemo(() => {
    return filterAndRankRows(financeRows, search, (row) =>
      [
        row.order?.order_number,
        row.order?.route?.route_number,
        row.order?.route?.name,
        row.invoice_number,
        row.invoice_status,
        row.operation_name,
        row.vendor?.name || vendorLabel(vendors, row.vendor_id),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }, [financeRows, search, vendors]);

  const itemOptions = useMemo<SelectOption[]>(
    () =>
      [...items]
        .sort((left, right) => {
          const leftLabel = `${left.code || ""} ${left.name || ""}`.trim();
          const rightLabel = `${right.code || ""} ${right.name || ""}`.trim();
          return leftLabel.localeCompare(rightLabel, undefined, {
            numeric: true,
            sensitivity: "base",
          });
        })
        .map((item) => ({
          value: item.id,
          label: `${item.code || ""} - ${item.name || ""}`
            .replace(/^\s*-\s*/, "")
            .trim(),
          meta:
            [
              item.uom ? `Qty UOM: ${item.uom}` : "",
              item.product_size
                ? `Size: ${item.product_size} ${item.product_size_uom || "MM"}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        })),
    [items],
  );

  const vendorOptions = useMemo<SelectOption[]>(
    () =>
      vendors.map((vendor) => ({
        value: vendor.id,
        label:
          vendor.name ||
          vendor.vendor_name ||
          vendor.vendor_code ||
          vendor.code ||
          "Vendor",
        meta: vendor.vendor_code || vendor.code,
      })),
    [vendors],
  );

  const effectiveUomOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...uomOptions,
          ...items
            .map((item) =>
              String(item.uom || "")
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean),
        ]),
      ).sort((left, right) => left.localeCompare(right)),
    [items, uomOptions],
  );
  const uomSelectOptions = useMemo<SelectOption[]>(
    () => effectiveUomOptions.map((uom) => ({ value: uom, label: uom })),
    [effectiveUomOptions],
  );

  const materialCalc = useMemo(() => {
    const rootSteps = routeForm.steps.filter((step) => !step.parent_node_key);
    const source = items.find((item) => item.id === routeForm.input_item_id);
    const sourceUom = String(
      source?.uom || routeForm.uom || "MTR",
    ).toUpperCase();
    const required = rootSteps.reduce((sum, step) => {
      const size = Number(step.output_size || 0);
      const uom = String(step.output_uom || "MM").toUpperCase();
      const pieces = Number(step.default_output_qty || 0);
      const lengthInMm =
        uom === "MTR" || uom === "M"
          ? size * 1000
          : uom === "CM"
            ? size * 10
            : size;
      const weightInGrams =
        uom === "KG" ? size * 1000 : uom === "G" || uom === "GM" ? size : 0;
      const consumption =
        sourceUom === "KG"
          ? (weightInGrams * pieces) / 1000
          : sourceUom === "G" || sourceUom === "GM"
            ? weightInGrams * pieces
            : sourceUom === "MTR" || sourceUom === "M"
              ? (lengthInMm * pieces) / 1000
              : sourceUom === "CM"
                ? (lengthInMm * pieces) / 10
                : lengthInMm * pieces;
      return sum + consumption;
    }, 0);
    const available = Number(
      source?.available_quantity ?? source?.current_stock ?? 0,
    );
    const balance = Math.max(0, available - required);
    return {
      required: Number.isFinite(required) ? required : 0,
      sourceUom,
      available,
      balance: Number.isFinite(balance) ? balance : 0,
      overIssue: Number.isFinite(balance) && balance < 0,
      rootCount: rootSteps.length,
    };
  }, [items, routeForm.input_item_id, routeForm.uom, routeForm.steps]);

  const defaultWarehouseId = useMemo(() => {
    return (
      warehouses.find((warehouse) =>
        String(warehouse.code || "")
          .toUpperCase()
          .includes("MAIN"),
      )?.id ||
      warehouses[0]?.id ||
      ""
    );
  }, [warehouses]);

  const selectedOrderRoute = useMemo(
    () => routes.find((route) => route.id === orderForm.route_id),
    [routes, orderForm.route_id],
  );
  const selectedOrderInputUom = useMemo(() => {
    const inputItem = items.find(
      (item) => item.id === selectedOrderRoute?.input_item_id,
    );
    return String(
      inputItem?.uom || selectedOrderRoute?.uom || orderForm.input_uom || "",
    )
      .trim()
      .toUpperCase();
  }, [items, selectedOrderRoute, orderForm.input_uom]);
  const receiveRawMaterialUom = selectedOrder
    ? subcontractOrderInputUom(selectedOrder, items) || "UOM"
    : "UOM";
  const orderRequiresLength = useMemo(() => {
    return requiresRawMaterialLength(
      selectedOrderRoute?.input_item_id,
      selectedOrderInputUom,
      selectedOrderRoute?.steps || [],
    );
  }, [selectedOrderInputUom, selectedOrderRoute]);

  function routeDefaults(routeId: string) {
    const route = routes.find((row) => row.id === routeId);
    const inputItem = items.find((item) => item.id === route?.input_item_id);
    const inputUom = String(inputItem?.uom || route?.uom || "")
      .trim()
      .toUpperCase();
    const requiresLength = requiresRawMaterialLength(
      route?.input_item_id,
      inputUom,
      route?.steps || [],
    );
    return {
      vendor_id: route?.steps?.[0]?.vendor_id || "",
      planned_input_qty: "",
      input_uom: inputUom,
      secondary_input_qty: "",
      secondary_input_uom: requiresLength ? "MTR" : "",
    };
  }

  function openOrderPanel() {
    setEditingOrderId(null);
    setSelectedOrder(null);
    setOrderForm(createEmptyOrderForm(defaultWarehouseId));
    setOrderLines([]);
    setOrderRequestId(newOrderRequestId());
    setPanel("order");
  }

  function openNewRoutePanel() {
    setEditingRouteId(null);
    setSelectedRoute(null);
    setRouteForm(createEmptyRouteForm());
    setPanel("route");
  }

  async function openOrderEditor(order: SubOrder) {
    if (
      !["OPEN", "READY"].includes(String(order.status || "").toUpperCase()) ||
      (order.movements || []).length
    ) {
      void confirmDialog({
        title: "Order Cannot Be Edited",
        message: "Only orders before stock movement can be edited.",
        confirmLabel: "OK",
        cancelLabel: "Close",
      });
      return;
    }
    try {
      // The grid deliberately loads a compact row. Edit must always use the
      // complete service order, otherwise optional/new header fields can look blank.
      const response: any = await apiClient.get(
        `/production/subcontracting/orders/${order.id}`,
      );
      const full = (response?.data ||
        response?.order ||
        response ||
        order) as SubOrder;
      setEditingOrderId(full.id);
      const fullRoute = routes.find((route) => route.id === full.route_id);
      const routeInputItemId =
        fullRoute?.input_item_id || (full as any).input_item_id;
      const inputItem = items.find((item) => item.id === routeInputItemId);
      const inputUom = String(
        inputItem?.uom || (full as any).input_uom || fullRoute?.uom || "",
      )
        .trim()
        .toUpperCase();
      const requiresLength = requiresRawMaterialLength(
        routeInputItemId,
        inputUom,
        fullRoute?.steps || full.steps || [],
      );
      setOrderForm({
        route_id: full.route_id || "",
        vendor_id: (full as any).vendor_id || full.steps?.[0]?.vendor_id || "",
        source_warehouse_id:
          (full as any).source_warehouse_id || defaultWarehouseId,
        output_warehouse_id:
          (full as any).output_warehouse_id || defaultWarehouseId,
        planned_input_qty: String(full.planned_input_qty ?? ""),
        input_uom: inputUom,
        secondary_input_qty: requiresLength
          ? String((full as any).secondary_input_qty ?? "")
          : "",
        secondary_input_uom: requiresLength ? "MTR" : "",
        notes: String((full as any).notes || ""),
      });
      setOrderLines(
        (full.steps || [])
          .filter((step) => !step.parent_node_key)
          .map((step) => ({
            node_key: step.node_key || "",
            item_id: step.output_item_id || "",
            uom: stockItemUom(items, step.output_item_id, step.output_uom),
            quantity: String(step.planned_output_qty ?? ""),
            size: String(step.output_size ?? ""),
            price: String((step as any).unit_price ?? ""),
            hsn_code: String((step as any).hsn_code || ""),
            discount_percent: String((step as any).discount_percent ?? ""),
          })),
      );
      setPanel("order");
    } catch (err: any) {
      await confirmDialog({
        title: "Order Cannot Be Edited",
        message:
          err?.message ||
          "Could not load the complete subcontracting order for editing.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function openOrderTrail(order: SubOrder) {
    try {
      const full: any = await apiClient.get(
        `/production/subcontracting/orders/${order.id}`,
      );
      setSelectedOrder((full?.data || full?.order || full) as SubOrder);
    } catch {
      setSelectedOrder(order);
    }
    setPanel("trail");
  }

  async function submitSubcontractPr(order: SubOrder) {
    const confirmed = await confirmDialog({
      title: "Submit Subcontract PR",
      message: `Submit ${order.requisition_number || order.order_number} for approval? Material cannot be issued until the Subcontract PO is approved.`,
      confirmLabel: "Submit for approval",
      cancelLabel: "Cancel",
      variant: "warning",
    });
    if (!confirmed) return;
    try {
      await apiClient.post(
        `/production/subcontracting/orders/${order.id}/submit`,
        {},
      );
      await loadAll();
    } catch (err: any) {
      await confirmDialog({
        title: "Submission failed",
        message: err?.message || "Could not submit the subcontract PR.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function approveSubcontractPr(order: SubOrder) {
    const confirmed = await confirmDialog({
      title: "Approve Subcontract PO",
      message: `Approve ${order.requisition_number || order.order_number}? The approved Subcontract PO will become available for material outward.`,
      confirmLabel: "Approve",
      cancelLabel: "Cancel",
      variant: "warning",
    });
    if (!confirmed) return;
    try {
      await apiClient.post(
        `/production/subcontracting/orders/${order.id}/approve`,
        {},
      );
      await loadAll();
    } catch (err: any) {
      await confirmDialog({
        title: "Approval failed",
        message: err?.message || "Could not approve the subcontract PR.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function printSubcontractPurchaseOrder(order: SubOrder) {
    try {
      const response: any = await apiClient.get(
        `/production/subcontracting/orders/${order.id}`,
      );
      const full = (response?.data ||
        response?.order ||
        response ||
        order) as SubOrder;
      const company = await apiClient
        .get<any>("/tenant/current")
        .catch(() => null);
      const branding = buildDocumentBranding(company);
      const printWindow = window.open("", "_blank");
      if (!printWindow)
        throw new Error("Please allow popups to print the Subcontract PO.");
      const vendor = vendorLabel(vendors, full.steps?.[0]?.vendor_id);
      const rows =
        (full.steps || [])
          .filter((step) => !step.parent_node_key)
          .map((step, index) => {
            const qty = Number(step.planned_output_qty || 0);
            const rate = Number(step.unit_price || 0);
            const discount = Number(step.discount_percent || 0);
            const amount = qty * rate * (1 - discount / 100);
            return `<tr><td>${index + 1}</td><td><strong>${escapePrintHtml(itemLabel(items, step.output_item_id))}</strong><br><span class="muted">${escapePrintHtml(step.operation_name || "Outside processing")}</span></td><td class="num">${escapePrintHtml(fmt(qty))}</td><td>${escapePrintHtml(stockItemUom(items, step.output_item_id, step.output_uom) || "-")}</td><td class="num">Rs. ${escapePrintHtml(fmt(rate))}</td><td class="num">${escapePrintHtml(fmt(discount))}%</td><td class="num">Rs. ${escapePrintHtml(fmt(amount))}</td></tr>`;
          })
          .join("") || '<tr><td colspan="7">No service lines</td></tr>';
      const total = (full.steps || [])
        .filter((step) => !step.parent_node_key)
        .reduce(
          (sum, step) =>
            sum +
            Number(step.planned_output_qty || 0) *
              Number(step.unit_price || 0) *
              (1 - Number(step.discount_percent || 0) / 100),
          0,
        );
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Subcontract PO - ${escapePrintHtml(full.order_number)}</title><style>@page{margin:.55cm}body{font-family:Arial,sans-serif;color:#201a15;font-size:11px;padding:18px}.title{font-size:19px;font-weight:800;text-align:right}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #bda98c;margin:14px 0}.meta div,td,th{padding:8px;border:1px solid #bda98c}.label{font-size:9px;text-transform:uppercase;color:#6c4f32;font-weight:700}.value{font-weight:700;margin-top:3px}.muted{color:#6f5a45;font-size:10px}.notice{background:#fff8e8;border:1px solid #c9b28b;padding:10px;margin:12px 0}table{border-collapse:collapse;width:100%}th{background:#f2eadf;text-align:left;font-size:9px;text-transform:uppercase}.num{text-align:right}.sign{display:flex;gap:28px;margin-top:50px}.sign div{flex:1;border-top:1px solid #57412d;padding-top:7px;font-weight:700}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleString())}<div class="title">SUBCONTRACT PURCHASE ORDER</div><div class="meta"><div><div class="label">Subcontract PO No.</div><div class="value">${escapePrintHtml(full.order_number)}</div></div><div><div class="label">Subcontract PR No.</div><div class="value">${escapePrintHtml(full.requisition_number || "Legacy order")}</div></div><div><div class="label">Supplier / Subcontractor</div><div class="value">${escapePrintHtml(vendor)}</div></div><div><div class="label">Approval status</div><div class="value">${escapePrintHtml(full.approval_status || full.status || "-")}</div></div></div><div class="notice">Please process the services below only against this approved Subcontract PO. Material outward, receipt, quality disposition, supplier invoice and payment remain linked to this document.</div><table><thead><tr><th>No.</th><th>Service / output</th><th class="num">Qty</th><th>UOM</th><th class="num">Rate</th><th class="num">Disc.</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="6" class="num">Service value</th><th class="num">Rs. ${escapePrintHtml(fmt(total))}</th></tr></tfoot></table><div class="sign"><div>Prepared By</div><div>Approved By</div><div>Accepted by Subcontractor</div></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (err: any) {
      await confirmDialog({
        title: "Print not available",
        message: err?.message || "Could not prepare the Subcontract PO.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function printSubcontractGrn(row: SubcontractGrnRow) {
    try {
      const response: any = await apiClient.get(
        `/production/subcontracting/orders/${row.order.id}`,
      );
      const order = (response?.data ||
        response?.order ||
        response ||
        row.order) as SubOrder;
      const receipt = (order.movements || []).find(
        (movement: any) =>
          movement.id === row.movement.id &&
          movement.movement_type === "SUBCON_SRV",
      );
      if (!receipt) throw new Error("This subcontract GRN could not be found.");

      const company = await apiClient
        .get<any>("/tenant/current")
        .catch(() => null);
      const branding = buildDocumentBranding(company);
      const printWindow = window.open("", "_blank");
      if (!printWindow)
        throw new Error("Please allow popups to print the Subcontract GRN.");

      const step = (order.steps || []).find(
        (candidate) => candidate.id === receipt.order_step_id,
      );
      const supplier = vendorLabel(
        vendors,
        receipt.vendor_id || step?.vendor_id,
      );
      const receiptLines = Array.isArray(receipt.receipt_lines)
        ? receipt.receipt_lines
        : [];
      const lineRows =
        receiptLines
          .map((line: any, index: number) => {
            const lineType = String(line.line_type || "RECEIPT").replaceAll(
              "_",
              " ",
            );
            const approved =
              String(line.line_type || "").toUpperCase() === "FINISHED_GOOD"
                ? Number(line.qc_approved_qty || 0)
                : Number(line.quantity || 0);
            const rejected = Number(line.qc_rejected_qty || 0);
            return `<tr><td>${index + 1}</td><td>${escapePrintHtml(lineType)}</td><td><strong>${escapePrintHtml(line.item_id ? itemLabel(items, line.item_id) : line.notes || "Approved process loss")}</strong></td><td class="num">${escapePrintHtml(fmt(line.quantity))}</td><td>${escapePrintHtml(stockItemUom(items, line.item_id, step?.output_uom) || "-")}</td><td class="num">${escapePrintHtml(fmt(approved))}</td><td class="num">${escapePrintHtml(fmt(rejected))}</td><td>${escapePrintHtml(line.qc_status || receipt.qc_status || "-")}</td></tr>`;
          })
          .join("") ||
        '<tr><td colspan="8">No receipt lines are available for this document.</td></tr>';
      const costRows = [
        ["Processing value", receipt.processing_amount],
        ["Freight", receipt.freight_amount],
        ["Other charges", receipt.other_charges_amount],
        [`GST (${fmt(receipt.tax_percent)}%)`, receipt.tax_amount],
        ["Less: deductions", -Number(receipt.deduction_amount || 0)],
        ["Payable after QC", receipt.payable_amount],
      ]
        .map(
          ([label, amount]) =>
            `<tr><td>${escapePrintHtml(label)}</td><td class="num">Rs. ${escapePrintHtml(fmtMoney(amount))}</td></tr>`,
        )
        .join("");
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Subcontract GRN - ${escapePrintHtml(receipt.document_number || order.order_number)}</title><style>@page{margin:.55cm}body{font-family:Arial,sans-serif;color:#201a15;margin:0;padding:18px;font-size:11px}.doc{font-size:19px;font-weight:800;text-align:right}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #bda98c;margin:14px 0}.meta>div{padding:8px 10px;border:1px solid #dfd1bd}.label{font-size:9px;text-transform:uppercase;color:#6c4f32;font-weight:700}.value{font-weight:700;margin-top:3px}.notice{background:#fff8e8;border:1px solid #c9b28b;padding:10px;margin:12px 0}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{padding:7px;border:1px solid #bda98c}th{background:#f2eadf;text-align:left;font-size:9px;text-transform:uppercase}.num{text-align:right}.cost{width:42%;margin-left:auto}.sign{display:flex;gap:28px;margin-top:48px}.sign div{flex:1;border-top:1px solid #57412d;padding-top:7px;font-weight:700}@media print{body{padding:0}}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleString())}<div class="doc">SUBCONTRACT GOODS RECEIPT NOTE</div><div class="meta"><div><div class="label">Subcontract GRN</div><div class="value">${escapePrintHtml(receipt.document_number || "-")}</div></div><div><div class="label">Receipt date</div><div class="value">${escapePrintHtml(fmtDate(receipt.created_at))}</div></div><div><div class="label">Subcontract PR / PO</div><div class="value">${escapePrintHtml(order.requisition_number || "Legacy PR")} / ${escapePrintHtml(order.order_number)}</div></div><div><div class="label">Supplier / Subcontractor</div><div class="value">${escapePrintHtml(supplier)}</div></div><div><div class="label">Supplier challan / reference</div><div class="value">${escapePrintHtml(receipt.external_reference || "-")}</div></div><div><div class="label">QC status</div><div class="value">${escapePrintHtml(receipt.qc_status || "PENDING_QC")}</div></div></div><div class="notice">This GRN records material received from the subcontractor against the linked Subcontract PO. Accepted stock and payable value remain governed by QC approval.</div><table><thead><tr><th>No.</th><th>Line type</th><th>Item</th><th class="num">Received</th><th>UOM</th><th class="num">Approved</th><th class="num">Rejected</th><th>QC status</th></tr></thead><tbody>${lineRows}</tbody></table><table class="cost"><tbody>${costRows}</tbody></table>${receipt.notes ? `<div class="notice"><span class="label">Receipt notes</span><br>${escapePrintHtml(receipt.notes)}</div>` : ""}<div class="sign"><div>Received By</div><div>Quality Approved By</div><div>Accounts Verification</div></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (err: any) {
      await confirmDialog({
        title: "Print Not Available",
        message: err?.message || "Could not prepare the Subcontract GRN.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function printStoresIssueSlip(order: SubOrder) {
    try {
      const response: any = await apiClient.get(
        `/production/subcontracting/orders/${order.id}`,
      );
      const full = (response?.data ||
        response?.order ||
        response ||
        order) as SubOrder;
      const company = await apiClient
        .get<any>("/tenant/current")
        .catch(() => null);
      const branding = buildDocumentBranding(company);
      const printWindow = window.open("", "_blank");
      if (!printWindow)
        throw new Error(
          "Please allow popups for this site to print the Stores Issue Slip.",
        );
      const inputUom = subcontractOrderInputUom(full, items) || "UOM";
      const vendor = vendorLabel(vendors, full.steps?.[0]?.vendor_id);
      const outputs = (full.steps || []).filter(
        (step) => !step.parent_node_key,
      );
      const outputRows =
        outputs
          .map(
            (step, index) =>
              `<tr><td>${index + 1}</td><td>${escapePrintHtml(itemLabel(items, step.output_item_id))}</td><td class="num">${escapePrintHtml(fmt(step.planned_output_qty))}</td><td>${escapePrintHtml(stockItemUom(items, step.output_item_id, step.output_uom) || "-")}</td><td>${escapePrintHtml(step.operation_name || "Subcontract processing")}</td></tr>`,
          )
          .join("") || '<tr><td colspan="5">No output lines</td></tr>';
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Stores Issue Slip - ${escapePrintHtml(full.order_number)}</title><style>@page{margin:.55cm}body{font-family:Arial,sans-serif;color:#201a15;margin:0;padding:18px;font-size:11px}.doc{font-size:19px;font-weight:800;text-align:right}.sub{color:#6f5a45;margin-top:4px}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #bda98c;margin:16px 0}.meta div{padding:8px 10px;border-bottom:1px solid #dfd1bd}.meta div:nth-child(odd){border-right:1px solid #dfd1bd}.label{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#6c4f32;font-weight:700}.value{font-weight:700;margin-top:3px;font-size:12px}.notice{border:1px solid #c9b28b;background:#fff8e8;padding:10px 12px;margin:14px 0;font-weight:700;color:#5b432c}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bda98c;padding:7px;text-align:left}th{background:#f2eadf;font-size:9px;text-transform:uppercase;color:#5b432c}.num{text-align:right}.sign{display:flex;gap:26px;margin-top:52px}.sign div{flex:1;border-top:1px solid #57412d;padding-top:7px;font-weight:700}.foot{margin-top:16px;font-size:9px;color:#6f5a45}@media print{body{padding:0}}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleString())}<div class="doc">STORES MATERIAL ISSUE SLIP</div><div class="sub">Subcontracting / Outside Processing · Print date: ${escapePrintHtml(new Date().toLocaleString())}</div><div class="meta"><div><div class="label">Subcontract Order</div><div class="value">${escapePrintHtml(full.order_number)}</div></div><div><div class="label">Order Status</div><div class="value">${escapePrintHtml(full.status || "-")}</div></div><div><div class="label">Route / Operation</div><div class="value">${escapePrintHtml(full.route?.name || "-")}</div></div><div><div class="label">Subcontractor</div><div class="value">${escapePrintHtml(vendor)}</div></div><div><div class="label">Source Warehouse</div><div class="value">${escapePrintHtml(warehouseLabel(warehouses, (full as any).source_warehouse_id))}</div></div><div><div class="label">Destination</div><div class="value">Vendor-held subcontract WIP</div></div></div><div class="notice">Issue the raw material below only against this subcontract order. Stores must verify the item, UOM and quantity before posting the Material Outward Challan.</div><table><thead><tr><th>No.</th><th>Raw Material</th><th class="num">Quantity to Issue</th><th>UOM</th><th>Issue From</th><th>Purpose</th></tr></thead><tbody><tr><td>1</td><td><strong>${escapePrintHtml(itemLabel(items, (full as any).input_item_id || full.route?.input_item_id))}</strong></td><td class="num"><strong>${escapePrintHtml(fmt(full.planned_input_qty))}</strong></td><td><strong>${escapePrintHtml(inputUom)}</strong>${Number(full.secondary_input_qty || 0) > 0 ? `<br><span class="sub">Length: ${escapePrintHtml(fmt(full.secondary_input_qty))} ${escapePrintHtml(String(full.secondary_input_uom || "MTR").toUpperCase())}</span>` : ""}</td><td>${escapePrintHtml(warehouseLabel(warehouses, (full as any).source_warehouse_id))}</td><td>Issue to ${escapePrintHtml(vendor)}</td></tr></tbody></table><table><thead><tr><th>No.</th><th>Expected Output Product</th><th class="num">Planned Qty</th><th>UOM</th><th>Operation</th></tr></thead><tbody>${outputRows}</tbody></table>${(full as any).notes ? `<div class="notice"><span class="label">Order notes</span><br>${escapePrintHtml((full as any).notes)}</div>` : ""}<div class="sign"><div>Prepared By</div><div>Stores Issued By</div><div>Subcontract Coordinator</div></div><div class="foot">This is an internal stores issue instruction. Actual stock movement is posted only when the Material Outward Challan is confirmed in SAK ERP.</div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (err: any) {
      await confirmDialog({
        title: "Print Not Available",
        message: err?.message || "Could not prepare the Stores Issue Slip.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  function openMoc(movement: any) {
    setSelectedMoc(movement);
    setPanel("moc");
  }

  async function openOrderView(order: SubOrder) {
    try {
      const full: any = await apiClient.get(
        `/production/subcontracting/orders/${order.id}`,
      );
      setSelectedOrder((full?.data || full?.order || full) as SubOrder);
    } catch {
      setSelectedOrder(order);
    }
    setPanel("view");
  }

  function closePanel() {
    setPanel(null);
    setEditingRouteId(null);
    setSelectedOrder(null);
    setSelectedMoc(null);
    setSelectedRoute(null);
    setSelectedStep(null);
    setEditingOrderId(null);
    setOrderRequestId("");
    setSavingOrder(false);
    setRouteForm(createEmptyRouteForm());
    setOrderForm(createEmptyOrderForm(defaultWarehouseId));
    setOrderLines([]);
    setIssueForm({ quantity: "", reference_number: "", notes: "" });
    setReceiveForm({
      issue_id: "",
      finished_goods: [],
      rejected_qty: "",
      scrap_qty: "",
      unused_return_qty: "",
      loss_qty: "",
      scrap_item_id: "",
      loss_reason: "",
      reference_number: "",
      processing_rate: "",
      freight_amount: "",
      other_charges_amount: "",
      deduction_amount: "",
      tax_percent: "18",
      invoice_number: "",
      invoice_date: "",
      notes: "",
    });
    setInvoiceFile(null);
  }

  async function saveRoute() {
    try {
      const isEdit = Boolean(editingRouteId);
      const outputIds = routeForm.steps
        .map((step) => step.output_item_id)
        .filter(Boolean);
      const duplicateOutput = outputIds.find(
        (id, index) => outputIds.indexOf(id) !== index,
      );
      if (duplicateOutput)
        throw new Error(
          `Output item ${itemLabel(items, duplicateOutput)} is entered more than once. Each output product must be a separate item.`,
        );
      const payload = {
        ...routeForm,
        steps: routeForm.steps.map((step) => ({
          ...step,
          vendor_id: step.vendor_id || "",
          operation_name: step.operation_name || "Subcontract Processing",
          process_type: "OUTSIDE_PROCESSING",
        })),
        default_input_qty: 0,
        default_output_qty: 0,
        expected_consumption_qty: 0,
        expected_unused_qty: 0,
      };
      if (isEdit && editingRouteId)
        await apiClient.put(
          `/production/subcontracting/routes/${editingRouteId}`,
          payload,
        );
      else await apiClient.post("/production/subcontracting/routes", payload);
      closePanel();
      await loadAll();
      await confirmDialog({
        title: isEdit ? "Route Updated" : "Route Saved",
        message: isEdit
          ? "The subcontracting route has been updated."
          : "The subcontracting route is now available for job-work orders.",
        confirmLabel: "OK",
        cancelLabel: "Close",
      });
    } catch (err: any) {
      await confirmDialog({
        title: "Route Not Saved",
        message:
          err?.message ||
          "Could not save the subcontracting route. Please check the required fields and try again.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function saveOrder() {
    if (savingOrder) return;
    setSavingOrder(true);
    try {
      const isEdit = Boolean(editingOrderId);
      if (!orderForm.route_id)
        throw new Error("Select a subcontracting route.");
      if (!orderForm.vendor_id)
        throw new Error("Select the vendor for this work order.");
      if (!orderForm.source_warehouse_id)
        throw new Error("Select the source warehouse.");
      if (!orderForm.output_warehouse_id)
        throw new Error("Select the output warehouse.");
      if (!(Number(orderForm.planned_input_qty) > 0))
        throw new Error(
          "Enter the input-material quantity for the work order.",
        );
      if (orderRequiresLength && !(Number(orderForm.secondary_input_qty) > 0))
        throw new Error("Enter the raw-material length in MTR.");
      if (!orderLines.length)
        throw new Error("The selected route has no output product lines.");
      const invalidQuantityIndex = orderLines.findIndex(
        (line) => !(Number(line.quantity) > 0),
      );
      if (invalidQuantityIndex >= 0)
        throw new Error(
          `Enter the output quantity for output line ${invalidQuantityIndex + 1}.`,
        );
      const invalidSizeIndex = orderLines.findIndex(
        (line) => !(Number(line.size) > 0),
      );
      if (invalidSizeIndex >= 0)
        throw new Error(
          `Enter the output size in MM for output line ${invalidSizeIndex + 1}.`,
        );
      const payload = {
        ...orderForm,
        input_uom: selectedOrderInputUom,
        secondary_input_qty: orderRequiresLength
          ? orderForm.secondary_input_qty
          : "",
        secondary_input_uom: orderRequiresLength ? "MTR" : "",
        output_lines: orderLines,
        ...(isEdit
          ? {}
          : { client_request_id: orderRequestId || newOrderRequestId() }),
      };
      const savedOrder: any = isEdit
        ? await apiClient.put(
            `/production/subcontracting/orders/${editingOrderId}`,
            payload,
          )
        : await apiClient.post("/production/subcontracting/orders", payload);
      const orderNumber = String(
        savedOrder?.order_number ||
          savedOrder?.data?.order_number ||
          savedOrder?.order?.order_number ||
          savedOrder?.data?.order?.order_number ||
          savedOrder?.document_number ||
          "",
      ).trim();
      closePanel();
      await loadAll();
      await confirmDialog({
        title: isEdit
          ? "Subcontracting Order Updated"
          : "Subcontracting Order Created",
        message: orderNumber
          ? `Order No. ${orderNumber} is ready for material issue.`
          : "The subcontracting order was created and is ready for material issue.",
        confirmLabel: "OK",
        cancelLabel: "Close",
      });
    } catch (err: any) {
      await confirmDialog({
        title: editingOrderId ? "Order Not Updated" : "Order Not Created",
        message:
          err?.message ||
          "Could not create the subcontracting order. Please check the route, vendor, and quantity.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    } finally {
      // A rejected request must never leave the panel permanently displaying
      // "Saving...". Keeping the same request id also makes a user retry
      // idempotent if the server completed the first request but its response
      // was interrupted.
      setSavingOrder(false);
    }
  }

  async function printPostedMaterialOutwardChallan(
    order: SubOrder,
    movement: any,
    challanNumber: string,
    form: { quantity: string; reference_number: string; notes: string },
    printWindow: Window | null,
  ) {
    if (!printWindow) return;
    const company = await apiClient
      .get<any>("/tenant/current")
      .catch(() => null);
    const branding = buildDocumentBranding(company);
    const brandingHeader = `<div class="brand">${escapePrintHtml(branding.companyName)}</div><div class="sub">${escapePrintHtml(branding.address)}</div>`;
    const inputUom = subcontractOrderInputUom(order, items) || "UOM";
    const rawMaterial = itemLabel(
      items,
      movement?.item_id ||
        (order as any).input_item_id ||
        order.route?.input_item_id,
    );
    const vendor = vendorLabel(
      vendors,
      movement?.vendor_id || order.steps?.[0]?.vendor_id,
    );
    const issuedQty = Number(
      movement?.quantity ?? form.quantity ?? order.planned_input_qty ?? 0,
    );
    const reference =
      movement?.external_reference ||
      movement?.reference_number ||
      form.reference_number ||
      "-";
    const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Material Outward Challan - ${escapePrintHtml(challanNumber || order.order_number)}</title><style>@page{margin:.55cm}body{font-family:Arial,sans-serif;color:#201a15;margin:0;padding:18px;font-size:11px}.top{display:flex;justify-content:space-between;border-bottom:2px solid #5b432c;padding-bottom:10px}.brand{font-size:17px;font-weight:800;color:#5b432c}.doc{font-size:19px;font-weight:800;text-align:right}.sub{color:#6f5a45;margin-top:4px}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #bda98c;margin:16px 0}.meta div{padding:8px 10px;border-bottom:1px solid #dfd1bd}.meta div:nth-child(odd){border-right:1px solid #dfd1bd}.label{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#6c4f32;font-weight:700}.value{font-weight:700;margin-top:3px;font-size:12px}.notice{border:1px solid #c9b28b;background:#fff8e8;padding:10px 12px;margin:14px 0;font-weight:700;color:#5b432c}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bda98c;padding:8px;text-align:left}th{background:#f2eadf;font-size:9px;text-transform:uppercase;color:#5b432c}.num{text-align:right}.sign{display:flex;gap:26px;margin-top:52px}.sign div{flex:1;border-top:1px solid #57412d;padding-top:7px;font-weight:700}.foot{margin-top:16px;font-size:9px;color:#6f5a45}@media print{body{padding:0}}</style></head><body><div class="top"><div><div class="brand">SAK ERP</div><div class="sub">Subcontracting / Outside Processing</div></div><div><div class="doc">MATERIAL OUTWARD CHALLAN</div><div class="sub">Posted: ${escapePrintHtml(new Date().toLocaleString())}</div></div></div><div class="meta"><div><div class="label">MOC Number</div><div class="value">${escapePrintHtml(challanNumber || "-")}</div></div><div><div class="label">Subcontract Order</div><div class="value">${escapePrintHtml(order.order_number)}</div></div><div><div class="label">Subcontractor</div><div class="value">${escapePrintHtml(vendor)}</div></div><div><div class="label">External Challan / Reference</div><div class="value">${escapePrintHtml(reference)}</div></div><div><div class="label">Issue From</div><div class="value">${escapePrintHtml(warehouseLabel(warehouses, movement?.from_warehouse_id || (order as any).source_warehouse_id))}</div></div><div><div class="label">Issue To</div><div class="value">Vendor-held subcontract WIP</div></div></div><div class="notice">Stock has been issued to the subcontractor and moved to vendor WIP. Retain this challan with the physical dispatch / transport documents.</div><table><thead><tr><th>No.</th><th>Raw Material</th><th class="num">Issued Quantity</th><th>UOM</th><th>Balance at Vendor</th></tr></thead><tbody><tr><td>1</td><td><strong>${escapePrintHtml(rawMaterial)}</strong></td><td class="num"><strong>${escapePrintHtml(fmt(issuedQty))}</strong></td><td><strong>${escapePrintHtml(inputUom)}</strong></td><td>${escapePrintHtml(fmt(movement?.remaining_qty ?? issuedQty))} ${escapePrintHtml(inputUom)}</td></tr></tbody></table>${form.notes ? `<div class="notice"><span class="label">Issue notes</span><br>${escapePrintHtml(form.notes)}</div>` : ""}<div class="sign"><div>Prepared By</div><div>Stores Issued By</div><div>Received by Subcontractor</div></div><div class="foot">System-generated Material Outward Challan. The document is linked to the subcontract order, inventory movement and vendor WIP record in SAK ERP.</div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
    printWindow.document.open();
    printWindow.document.write(
      html.replace('<div class="brand">SAK ERP</div>', brandingHeader),
    );
    printWindow.document.close();
  }

  async function issueStep() {
    if (!selectedOrder || !selectedStep) return;
    const printWindow = window.open("", "_blank");
    try {
      const issuePath = selectedStep.parent_node_key
        ? `/production/subcontracting/orders/${selectedOrder.id}/steps/${selectedStep.id}/issue`
        : `/production/subcontracting/orders/${selectedOrder.id}/issue`;
      const issued: any = await apiClient.post(issuePath, issueForm);
      closePanel();
      await loadAll();
      const issuedMovement =
        issued?.movement ||
        issued?.data?.movement ||
        (Array.isArray(issued?.movements)
          ? [...issued.movements]
              .reverse()
              .find((movement: any) => movement?.movement_type === "SUBCON_SIV")
          : null) ||
        (Array.isArray(issued?.order?.movements)
          ? [...issued.order.movements]
              .reverse()
              .find((movement: any) => movement?.movement_type === "SUBCON_SIV")
          : null);
      const challanNumber =
        issued?.document_number ||
        issued?.movement?.document_number ||
        issued?.data?.document_number ||
        issued?.reference_number ||
        issuedMovement?.document_number ||
        issuedMovement?.reference_number;
      await printPostedMaterialOutwardChallan(
        selectedOrder,
        issuedMovement,
        challanNumber,
        issueForm,
        printWindow,
      );
      await confirmDialog({
        title: "Material Issued",
        message: `Material Outward Challan No. ${challanNumber || "created"} has been posted and vendor WIP has been updated.`,
        confirmLabel: "OK",
        cancelLabel: "Close",
      });
    } catch (err: any) {
      printWindow?.close();
      await confirmDialog({
        title: "Issue Failed",
        message:
          err?.message ||
          "Could not post the material issue. Please verify available stock and selected step.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function receiveStep() {
    if (!selectedOrder || !selectedStep) return;
    try {
      let attachmentNote = "";
      if (invoiceFile) {
        const fd = new FormData();
        fd.append("file", invoiceFile);
        fd.append(
          "title",
          `Vendor invoice ${receiveForm.invoice_number || selectedOrder.order_number}`,
        );
        fd.append(
          "description",
          `Subcontracting vendor invoice attached to ${selectedOrder.order_number}`,
        );
        fd.append("document_type", "VENDOR_INVOICE");
        fd.append("related_entity_type", "SUBCONTRACT_ORDER");
        fd.append("related_entity_id", selectedOrder.id);
        const uploaded: any = await apiClient.postForm("/documents/upload", fd);
        const fileUrl =
          uploaded?.file_url ||
          uploaded?.url ||
          uploaded?.data?.file_url ||
          uploaded?.data?.url;
        attachmentNote = fileUrl
          ? `Vendor invoice attachment: ${fileUrl}`
          : `Vendor invoice attachment: ${invoiceFile.name}`;
      }
      const received: any = await apiClient.post(
        `/production/subcontracting/orders/${selectedOrder.id}/steps/${selectedStep.id}/receive`,
        {
          ...receiveForm,
          notes: [receiveForm.notes, attachmentNote].filter(Boolean).join("\n"),
        },
      );
      const receiptMovement =
        received?.receipt ||
        received?.data?.receipt ||
        (Array.isArray(received?.movements)
          ? [...received.movements]
              .reverse()
              .find((movement: any) => movement?.movement_type === "SUBCON_SRV")
          : null) ||
        (Array.isArray(received?.order?.movements)
          ? [...received.order.movements]
              .reverse()
              .find((movement: any) => movement?.movement_type === "SUBCON_SRV")
          : null);
      const grnNumber =
        received?.document_number ||
        received?.grn_number ||
        receiptMovement?.document_number ||
        receiptMovement?.reference_number;
      const processingAmount = Number(receiptMovement?.processing_amount || 0);
      const taxAmount = Number(receiptMovement?.tax_amount || 0);
      const deductionAmount = Number(receiptMovement?.deduction_amount || 0);
      const freightAmount = Number(receiptMovement?.freight_amount || 0);
      const otherChargesAmount = Number(
        receiptMovement?.other_charges_amount || 0,
      );
      const payableAmount = Math.max(
        0,
        Math.round(
          (processingAmount +
            freightAmount +
            otherChargesAmount +
            taxAmount -
            deductionAmount) *
            100,
        ) / 100,
      );
      closePanel();
      await loadAll();
      await confirmDialog({
        title: "Receipt Posted",
        message: `GRN No. ${grnNumber || "created"} has been posted. Provisional payable amount: Rs. ${fmtMoney(payableAmount)}. The linked outward-challan balance has been updated. Final payable is confirmed after QC approval.`,
        confirmLabel: "OK",
        cancelLabel: "Close",
      });
    } catch (err: any) {
      await confirmDialog({
        title: "Receipt Failed",
        message:
          err?.message ||
          "Could not post the subcontracting receipt. Please check accepted/rejected quantities and invoice details.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  function openStepPanel(
    kind: "issue" | "receive",
    order: SubOrder,
    step: OrderStep,
  ) {
    setSelectedOrder(order);
    setSelectedStep(step);
    const routeIssue = (order.movements || []).find(
      (movement: any) =>
        movement.movement_type === "SUBCON_SIV" &&
        !movement.order_step_id &&
        Number(movement.remaining_qty ?? movement.quantity ?? 0) > 0,
    );
    const issueDefault =
      kind === "issue" && !step.parent_node_key
        ? Number(
            routeIssue?.remaining_qty ??
              routeIssue?.quantity ??
              order.planned_input_qty ??
              0,
          )
        : Number(step.planned_input_qty || 0) - Number(step.issued_qty || 0) ||
          step.planned_input_qty ||
          "";
    setIssueForm({
      quantity: String(issueDefault),
      reference_number: "",
      notes: "",
    });
    // A current service order has one route-level outward challan. Older orders can
    // still have step-level challans, so support both while preferring a matching step.
    const openIssue =
      (order.movements || []).find(
        (movement: any) =>
          movement.movement_type === "SUBCON_SIV" &&
          movement.order_step_id === step.id &&
          Number(movement.remaining_qty ?? movement.quantity ?? 0) > 0,
      ) || routeIssue;
    const issueBalance = Number(
      openIssue?.remaining_qty ??
        openIssue?.quantity ??
        step.issued_qty ??
        step.planned_input_qty ??
        0,
    );
    const rootOutputSteps = (order.steps || []).filter(
      (candidate) => !candidate.parent_node_key && candidate.output_item_id,
    );
    const outstandingOutputSteps = rootOutputSteps.filter((candidate) => {
      const planned = Number(candidate.planned_output_qty || 0);
      const accepted = Number(candidate.receipt_received_qty || 0);
      // The receipt form is strictly an outstanding-quantity form. A completed
      // line must never reappear with its original quantity on a partial order.
      return planned - accepted > 0.0001;
    });
    // If every planned line was received but the outward challan still has RM,
    // show the route products again with a blank receive quantity. This permits
    // a controlled above-plan receipt; the API still limits it by backflush and
    // the actual open RM balance.
    const outputSteps = outstandingOutputSteps.length
      ? outstandingOutputSteps
      : openIssue
        ? rootOutputSteps
        : [];
    const outputLines = outputSteps.map((candidate) => {
      const plannedQty = Number(candidate.planned_output_qty || 0);
      const receivedQty = Number(candidate.receipt_received_qty || 0);
      const remainingOutput = Math.max(
        0,
        Number(candidate.planned_output_qty || 0) - receivedQty,
      );
      return {
        item_id: candidate.output_item_id || "",
        quantity: remainingOutput > 0 ? String(remainingOutput) : "",
        // RM consumption is always calculated by the API from the service-order
        // plan. Never preload it from the open MOC balance, otherwise a single
        // output line is counted once as consumption and again as unused RM.
        raw_material_qty: "",
        actual_weight: "",
        planned_qty: plannedQty,
        received_qty: receivedQty,
        remaining_qty: remainingOutput,
        uom: stockItemUom(
          items,
          candidate.output_item_id,
          candidate.output_uom,
        ),
      };
    });
    setInvoiceFile(null);
    setReceiveForm({
      issue_id: openIssue?.id || "",
      finished_goods: outputLines,
      rejected_qty: "",
      scrap_qty: "",
      unused_return_qty: automaticUnusedReturn(
        order,
        outputLines,
        issueBalance,
      ),
      loss_qty: "",
      loss_reason: "",
      scrap_item_id: "",
      reference_number: "",
      processing_rate: "",
      freight_amount: "",
      other_charges_amount: "",
      deduction_amount: "",
      tax_percent: "18",
      invoice_number: "",
      invoice_date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
    setPanel(kind);
  }

  function updateReceiveQuantity(index: number, quantity: string) {
    setReceiveForm((current) => {
      const finishedGoods = current.finished_goods.map((row, rowIndex) =>
        rowIndex === index ? { ...row, quantity } : row,
      );
      const issue = (selectedOrder?.movements || []).find(
        (movement: any) => movement.id === current.issue_id,
      );
      const issueBalance = Number(issue?.remaining_qty ?? issue?.quantity ?? 0);
      return {
        ...current,
        finished_goods: finishedGoods,
        unused_return_qty: automaticUnusedReturn(
          selectedOrder,
          finishedGoods,
          issueBalance,
          Number(current.scrap_qty || 0),
          Number(current.loss_qty || 0),
        ),
      };
    });
  }

  function updateReceiveSettlement(
    field: "scrap_qty" | "loss_qty",
    value: string,
  ) {
    setReceiveForm((current) => {
      const issue = (selectedOrder?.movements || []).find(
        (movement: any) => movement.id === current.issue_id,
      );
      const issueBalance = Number(issue?.remaining_qty ?? issue?.quantity ?? 0);
      const scrapQty =
        field === "scrap_qty"
          ? Number(value || 0)
          : Number(current.scrap_qty || 0);
      const lossQty =
        field === "loss_qty"
          ? Number(value || 0)
          : Number(current.loss_qty || 0);
      return {
        ...current,
        [field]: value,
        unused_return_qty: automaticUnusedReturn(
          selectedOrder,
          current.finished_goods,
          issueBalance,
          scrapQty,
          lossQty,
        ),
      };
    });
  }

  function serviceOrderPayablePreview() {
    const lines = receiveForm.finished_goods || [];
    const amount = lines.reduce((total, line) => {
      const pricedStep: any =
        (selectedOrder?.steps || []).find(
          (candidate: any) =>
            candidate.output_item_id === line.item_id &&
            !candidate.parent_node_key,
        ) || selectedStep;
      const configuredRate = Number(pricedStep?.unit_price || 0);
      const fallbackRate = Number(receiveForm.processing_rate || 0);
      const rate = configuredRate > 0 ? configuredRate : fallbackRate;
      const discount = Math.max(
        0,
        Math.min(100, Number(pricedStep?.discount_percent || 0)),
      );
      return total + Number(line.quantity || 0) * rate * (1 - discount / 100);
    }, 0);
    const freight = Number(receiveForm.freight_amount || 0);
    const otherCharges = Number(receiveForm.other_charges_amount || 0);
    const tax =
      ((amount + freight + otherCharges) *
        Number(receiveForm.tax_percent || 0)) /
      100;
    return Math.max(
      0,
      Math.round(
        (amount +
          freight +
          otherCharges +
          tax -
          Number(receiveForm.deduction_amount || 0)) *
          100,
      ) / 100,
    );
  }

  async function openSubcontractPaymentModal(row: any) {
    // Finance state may have changed after QC or invoice matching while this
    // grid was open. Re-read it before presenting a payment form so a stale
    // browser row can never skip the supplier-invoice control.
    let currentRow = row;
    try {
      const latestRows = await apiClient.get<any[]>(
        "/production/subcontracting/finance",
      );
      currentRow =
        latestRows.find((candidate) => candidate.id === row.id) || row;
    } catch {
      // The API performs the same validation when payment is posted. Keeping
      // the current row here lets the user continue if only the refresh failed.
    }

    const status = String(currentRow.invoice_status || "").toUpperCase();
    if (!["INVOICE_RECEIVED", "PENDING_PAYMENT"].includes(status)) {
      setPaymentModal(null);
      setInvoiceModal({
        row: currentRow,
        invoiceNumber: String(currentRow.invoice_number || ""),
        invoiceDate: String(
          currentRow.invoice_date || new Date().toISOString().slice(0, 10),
        ).slice(0, 10),
        file: null,
      });
      return;
    }
    const outstanding = Math.max(
      0,
      Number(currentRow.payable_amount || 0) -
        Number(currentRow.paid_amount || 0),
    );
    if (outstanding <= 0.009) return;
    setPaymentModal({
      row: currentRow,
      amount: outstanding.toFixed(2),
      reference: "",
    });
  }

  async function recordSubcontractInvoice() {
    if (!invoiceModal?.row) return;
    const invoiceNumber = invoiceModal.invoiceNumber.trim();
    if (!invoiceNumber || !invoiceModal.invoiceDate) {
      await confirmDialog({
        title: "Invoice Not Recorded",
        message: "Supplier invoice number and invoice date are required.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "warning",
      });
      return;
    }
    try {
      let attachmentUrl = "";
      if (invoiceModal.file) {
        const form = new FormData();
        form.append("file", invoiceModal.file);
        form.append("title", `Vendor invoice ${invoiceNumber}`);
        form.append(
          "description",
          `Subcontracting vendor invoice attached to ${invoiceModal.row.order?.order_number || "service order"}`,
        );
        form.append("document_type", "VENDOR_INVOICE");
        form.append("related_entity_type", "SUBCONTRACT_ORDER");
        form.append("related_entity_id", invoiceModal.row.order_id);
        const uploaded: any = await apiClient.postForm(
          "/documents/upload",
          form,
        );
        attachmentUrl =
          uploaded?.file_url ||
          uploaded?.url ||
          uploaded?.data?.file_url ||
          uploaded?.data?.url ||
          "";
      }
      await apiClient.post(
        `/production/subcontracting/orders/${invoiceModal.row.order_id}/steps/${invoiceModal.row.id}/invoice`,
        {
          invoice_number: invoiceNumber,
          invoice_date: invoiceModal.invoiceDate,
          attachment_url: attachmentUrl || undefined,
        },
      );
      setInvoiceModal(null);
      await loadAll();
      await confirmDialog({
        title: "Supplier Invoice Recorded",
        message: `Invoice ${invoiceNumber} has been matched to the QC-approved subcontract GRN and is ready for payment.`,
        confirmLabel: "OK",
        cancelLabel: "Close",
      });
    } catch (err: any) {
      await confirmDialog({
        title: "Invoice Not Recorded",
        message:
          err?.message ||
          "Could not match the supplier invoice to the subcontract GRN.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  async function markSubcontractInvoicePaid() {
    if (!paymentModal?.row) return;
    const row = paymentModal.row;
    const amount = Number(paymentModal.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      await confirmDialog({
        title: "Invalid Payment Amount",
        message: "Payment amount must be greater than 0.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "warning",
      });
      return;
    }
    try {
      await apiClient.post(
        `/production/subcontracting/orders/${row.order_id}/steps/${row.id}/pay`,
        {
          amount,
          payment_reference: paymentModal.reference.trim() || undefined,
          payment_date: new Date().toISOString().slice(0, 10),
        },
      );
      setPaymentModal(null);
      await loadAll();
      await confirmDialog({
        title: "Payment Recorded",
        message:
          "Subcontractor payment has been recorded against the service payable.",
        confirmLabel: "OK",
        cancelLabel: "Close",
      });
    } catch (err: any) {
      const message = String(err?.message || "");
      if (message.includes("Record and match the supplier invoice")) {
        setPaymentModal(null);
        setInvoiceModal({
          row,
          invoiceNumber: String(row.invoice_number || ""),
          invoiceDate: String(
            row.invoice_date || new Date().toISOString().slice(0, 10),
          ).slice(0, 10),
          file: null,
        });
        return;
      }
      await confirmDialog({
        title: "Payment Not Recorded",
        message:
          message ||
          "Could not record subcontractor payment. Please check the amount and try again.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    } finally {
      setSavingOrder(false);
    }
  }

  // A route has one calculated source issue. Roots derive KG from pieces ×
  // input weight/pc; downstream steps inherit their parent's output weight.
  function deriveRouteStepInputs(steps: RouteStep[], sourceItemId: string) {
    return steps.map((step) => {
      const parent = step.parent_node_key
        ? steps.find((candidate) => candidate.node_key === step.parent_node_key)
        : undefined;
      return {
        ...step,
        input_item_id: parent ? parent.output_item_id || "" : sourceItemId,
        default_input_qty: parent
          ? (parent.default_output_qty ?? "")
          : step.default_input_qty,
        input_weight_per_piece: parent
          ? (parent.output_weight_per_piece ?? "")
          : step.input_weight_per_piece,
      };
    });
  }

  function openReceiptQc(order: SubOrder, receipt: any) {
    const lines = (receipt.receipt_lines || [])
      .filter(
        (line: any) =>
          String(line.line_type || "").toUpperCase() === "FINISHED_GOOD",
      )
      .map((line: any) => ({
        id: line.id,
        itemId: line.item_id,
        receivedQty: Number(line.quantity || 0),
        approvedQty: String(line.quantity || 0),
        disposition: "REWORK" as const,
        scrapItemId: "",
        notes: "",
      }));
    if (!lines.length) {
      void confirmDialog({
        title: "QC Lines Unavailable",
        message:
          "This GRN has no finished-goods receipt lines. Refresh the order and try again.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
      return;
    }
    setQcModal({ order, receipt, notes: "", lines });
  }

  function updateQcLine(
    lineId: string,
    patch: Partial<NonNullable<typeof qcModal>["lines"][number]>,
  ) {
    setQcModal((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.id === lineId ? { ...line, ...patch } : line,
            ),
          }
        : null,
    );
  }

  async function approveReceiptQc() {
    if (!qcModal) return;
    const { order, receipt } = qcModal;
    try {
      const invalidLine = qcModal.lines.find(
        (line) =>
          Number(line.approvedQty || 0) < 0 ||
          Number(line.approvedQty || 0) > line.receivedQty + 0.0001 ||
          (Number(line.approvedQty || 0) < line.receivedQty - 0.0001 &&
            line.disposition === "SCRAP" &&
            !line.scrapItemId),
      );
      if (invalidLine)
        throw new Error(
          "Enter a valid approved quantity for every line and select a scrap item where required.",
        );
      await apiClient.post(
        `/production/subcontracting/orders/${order.id}/receipts/${receipt.id}/qc-approve`,
        {
          notes: qcModal.notes,
          line_inspections: qcModal.lines.map((line) => ({
            receipt_line_id: line.id,
            approved_qty: Number(line.approvedQty || 0),
            rejected_disposition: line.disposition,
            scrap_item_id: line.scrapItemId || undefined,
            notes: line.notes || undefined,
          })),
        },
      );
      const refreshed = await apiClient.get<SubOrder>(
        `/production/subcontracting/orders/${order.id}`,
      );
      setSelectedOrder(refreshed);
      setQcModal(null);
      await loadAll();
      const approvedReceipt =
        (refreshed.movements || []).find(
          (movement: any) => movement.id === receipt.id,
        ) || receipt;
      const payable = Number(approvedReceipt.payable_amount || 0);
      await confirmDialog({
        title: "QC Inspection Completed",
        message: `GRN No. ${approvedReceipt.document_number || receipt.document_number || "-"} has been QC approved. Order status: ${String(refreshed.status || "UPDATED").replace(/_/g, " ")}.${payable > 0 ? ` Payable created: Rs. ${fmtMoney(payable)}.` : ""}`,
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "info",
      });
    } catch (err: any) {
      await confirmDialog({
        title: "QC Approval Failed",
        message: err?.message || "Could not approve this subcontract GRN.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  function openRouteEditor(route: RouteTemplate) {
    setEditingRouteId(route.id);
    setRouteForm({
      name: route.name || "",
      input_item_id: route.input_item_id || "",
      output_item_id: route.output_item_id || "",
      default_input_qty: String(route.default_input_qty ?? ""),
      default_output_qty: String(route.default_output_qty ?? "100"),
      input_weight_per_piece: "",
      output_weight_per_piece: "",
      consumption_per_output_qty: String(
        route.consumption_per_output_qty ?? "",
      ),
      expected_consumption_qty: String(route.expected_consumption_qty ?? ""),
      expected_unused_qty: String(route.expected_unused_qty ?? ""),
      uom: route.uom || "",
      vendor_id: (route.steps || [])[0]?.vendor_id || "",
      notes: (route as any).notes || "",
      steps: (route.steps || []).map((step, index) => ({
        ...step,
        sequence_no: Number(step.sequence_no || index + 1),
        node_key: step.node_key || `NODE-${index + 1}`,
        parent_node_key: step.parent_node_key || "",
        output_uom: stockItemUom(items, step.output_item_id, step.output_uom),
      })),
    });
    setPanel("route");
  }

  function openRouteView(route: RouteTemplate) {
    setSelectedRoute(route);
    setPanel("routeView");
  }

  async function deleteRoute(route: RouteTemplate) {
    const confirmed = await confirmDialog({
      title: "Delete Route",
      message: `Delete ${route.route_number} - ${route.name}? This is only allowed when no subcontracting order uses the route.`,
      confirmLabel: "Delete Route",
      cancelLabel: "Keep Route",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/production/subcontracting/routes/${route.id}`);
      await loadAll();
    } catch (err: any) {
      await confirmDialog({
        title: "Route Not Deleted",
        message: err?.message || "Could not delete this route.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "danger",
      });
    }
  }

  function addRouteStep(parentNodeKey = "") {
    setRouteForm((prev) => {
      const nodeNumber =
        prev.steps.reduce(
          (highest, step) =>
            Math.max(
              highest,
              Number(String(step.node_key || "").replace(/^NODE-/, "")) || 0,
            ),
          0,
        ) + 1;
      const steps = [
        ...prev.steps,
        {
          sequence_no: prev.steps.length + 1,
          node_key: `NODE-${nodeNumber}`,
          parent_node_key: parentNodeKey,
          branch_no: prev.steps.length + 1,
          operation_name: "",
          process_type: "OUTSIDE_PROCESSING",
          vendor_id: "",
          department: "",
          input_item_id: "",
          output_item_id: "",
          input_uom: "",
          input_size: "",
          output_uom: "",
          output_size: "",
          default_input_qty: "",
          default_output_qty: "",
          input_weight_per_piece: "",
          output_weight_per_piece: "",
          standard_yield_pct: 100,
          scrap_tolerance_pct: 0,
          qc_required: true,
          instructions: "",
        },
      ];
      return {
        ...prev,
        steps: deriveRouteStepInputs(steps, prev.input_item_id),
      };
    });
  }

  function updateRouteStep(index: number, patch: Partial<RouteStep>) {
    setRouteForm((prev) => {
      const steps = prev.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step,
      );
      return {
        ...prev,
        steps: deriveRouteStepInputs(steps, prev.input_item_id),
      };
    });
  }

  function removeRouteStep(index: number) {
    setRouteForm((prev) => {
      const key = prev.steps[index]?.node_key;
      if (!key) return prev;
      const removed = new Set<string>([key]);
      let found = true;
      while (found) {
        found = false;
        prev.steps.forEach((step) => {
          if (
            step.parent_node_key &&
            removed.has(step.parent_node_key) &&
            step.node_key &&
            !removed.has(step.node_key)
          ) {
            removed.add(step.node_key);
            found = true;
          }
        });
      }
      const steps = prev.steps
        .filter((step) => !removed.has(step.node_key || ""))
        .map((step, i) => ({ ...step, sequence_no: i + 1, branch_no: i + 1 }));
      return {
        ...prev,
        steps: deriveRouteStepInputs(steps, prev.input_item_id),
      };
    });
  }

  function addUom(term: string) {
    const next = term.trim().toUpperCase();
    if (!next) return;
    setUomOptions((prev) =>
      prev.includes(next) ? prev : [...prev, next].sort(),
    );
    setRouteForm((prev) => ({ ...prev, uom: next }));
  }

  const orderColumns = useMemo<ListTableColumn<SubOrder>[]>(
    () => [
      {
        id: "order",
        label: "Subcontract PR / PO",
        minWidth: 180,
        sortable: true,
        accessor: (order) =>
          `${order.requisition_number || ""} ${order.order_number}`,
        cell: (order) => (
          <>
            <div className="font-bold">{order.order_number}</div>
            <div className="text-xs text-[#7b6753]">
              PR: {order.requisition_number || "Legacy subcontract order"}
            </div>
          </>
        ),
      },
      {
        id: "route",
        label: "Route",
        minWidth: 180,
        sortable: true,
        accessor: (order) =>
          `${order.route?.route_number || ""} ${order.route?.name || ""}`,
        cell: (order) => order.route?.name || "-",
      },
      {
        id: "status",
        label: "Workflow status",
        minWidth: 125,
        sortable: true,
        accessor: (order) => order.approval_status || order.status || "",
        cell: (order) => (
          <StatusBadge value={order.approval_status || order.status} />
        ),
      },
      {
        id: "planned",
        label: "Planned",
        minWidth: 145,
        sortable: true,
        accessor: (order) => Number(order.planned_input_qty || 0),
        cell: (order) => (
          <>
            {fmt(order.planned_input_qty)} in / {fmt(order.planned_output_qty)}{" "}
            out
          </>
        ),
      },
      {
        id: "operations",
        label: "Operations",
        minWidth: 180,
        sortable: false,
        accessor: (order) =>
          (order.steps || []).map((step) => step.operation_name).join(" "),
        cell: (order) => {
          const steps = [...(order.steps || [])].sort(
            (a, b) => Number(a.sequence_no) - Number(b.sequence_no),
          );
          return (
            <div className="space-y-1">
              <div className="font-semibold text-[#5b432c]">
                {steps.length} operation{steps.length === 1 ? "" : "s"}
              </div>
              <div className="max-w-[220px] truncate text-xs text-[#7b6753]">
                {steps
                  .map((step) => step.operation_name)
                  .filter(Boolean)
                  .join(" • ") || "Subcontract processing"}
              </div>
            </div>
          );
        },
      },
      {
        id: "actions",
        label: "Actions",
        minWidth: 520,
        hideable: false,
        sortable: false,
        cell: (order) => {
          const orderedSteps = [...(order.steps || [])].sort(
            (a, b) => Number(a.sequence_no) - Number(b.sequence_no),
          );
          const issueStep =
            orderedSteps.find(
              (step) =>
                !step.parent_node_key &&
                ["READY", "ISSUED", "IN_PROCESS"].includes(String(step.status)),
            ) || orderedSteps[0];
          const hasPendingQc = (order.movements || []).some(
            (movement: any) =>
              movement.movement_type === "SUBCON_SRV" &&
              String(movement.qc_status || "").toUpperCase() === "PENDING_QC",
          );
          const hasApprovedReceipt = (order.movements || []).some(
            (movement: any) =>
              movement.movement_type === "SUBCON_SRV" &&
              ["APPROVED", "PARTIALLY_APPROVED"].includes(
                String(movement.qc_status || "").toUpperCase(),
              ),
          );
          const status = String(order.status || "").toUpperCase();
          const hasOpenIssue = (order.movements || []).some(
            (movement: any) =>
              movement.movement_type === "SUBCON_SIV" &&
              Number(movement.remaining_qty || 0) > 0.01,
          );
          const receiveStep =
            status !== "COMPLETED" && !hasPendingQc && hasOpenIssue
              ? orderedSteps.find((step) =>
                  ["IN_PROCESS", "ISSUED"].includes(String(step.status)),
                ) || (hasApprovedReceipt ? orderedSteps[0] : undefined)
              : undefined;
          const hasIssue = (order.movements || []).some(
            (movement: any) => movement.movement_type === "SUBCON_SIV",
          );
          const approvalStatus = String(
            order.approval_status ||
              (status === "OPEN" ? "LEGACY_APPROVED" : status),
          ).toUpperCase();
          const editable =
            ["DRAFT", "OPEN", "READY"].includes(status) &&
            !(order.movements || []).length;
          const canIssue =
            !hasIssue &&
            !!issueStep &&
            ["APPROVED", "LEGACY_APPROVED"].includes(approvalStatus) &&
            ["APPROVED", "OPEN", "READY"].includes(status);
          const receiptLabel = hasPendingQc
            ? "QC Pending"
            : hasApprovedReceipt && hasOpenIssue
              ? "Settle RM balance"
              : "Receive Material";
          const receiptTitle = hasPendingQc
            ? "Open the order trail to complete QC inspection"
            : hasApprovedReceipt && hasOpenIssue
              ? "A prior GRN was QC approved. Account for the remaining vendor-held raw material as additional finished goods, unused return, scrap, or approved loss."
              : receiveStep
                ? "Receive all output products against this service order"
                : "No material remains to receive for this completed order";
          return (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!editable}
                onClick={() => void openOrderEditor(order)}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              {approvalStatus === "DRAFT" && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900"
                  onClick={() => void submitSubcontractPr(order)}
                >
                  <ReceiptText className="h-3.5 w-3.5" /> Submit PR
                </button>
              )}
              {approvalStatus === "SUBMITTED" && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-900"
                  onClick={() => void approveSubcontractPr(order)}
                >
                  <PackageCheck className="h-3.5 w-3.5" /> Approve PO
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold"
                onClick={() => void printSubcontractPurchaseOrder(order)}
              >
                <ReceiptText className="h-3.5 w-3.5" /> Print PO
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-[#fff8e8] px-2.5 py-1.5 text-xs font-semibold"
                onClick={() => void printStoresIssueSlip(order)}
              >
                <ClipboardList className="h-3.5 w-3.5" /> Print Issue Slip
              </button>
              <button
                type="button"
                title={
                  canIssue
                    ? "Issue the complete raw-material quantity for this service order"
                    : "Raw material is already issued or this order is no longer open"
                }
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!canIssue}
                onClick={() =>
                  issueStep && openStepPanel("issue", order, issueStep)
                }
              >
                <ArrowUpFromLine className="h-3.5 w-3.5" />{" "}
                {hasIssue ? "RM Issued" : "Issue Material"}
              </button>
              <button
                type="button"
                title={receiptTitle}
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!receiveStep}
                onClick={() =>
                  receiveStep && openStepPanel("receive", order, receiveStep)
                }
              >
                <ArrowDownToLine className="h-3.5 w-3.5" /> {receiptLabel}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold"
                onClick={() => void openOrderTrail(order)}
              >
                <ClipboardList className="h-3.5 w-3.5" />{" "}
                {hasPendingQc ? "Review & QC" : "Order Trail"}
              </button>
            </div>
          );
        },
      },
    ],
    [vendors, routes, defaultWarehouseId],
  );

  const grnColumns = useMemo<ListTableColumn<SubcontractGrnRow>[]>(
    () => [
      {
        id: "grn",
        label: "Subcontract GRN",
        minWidth: 185,
        sortable: true,
        accessor: (row) =>
          `${row.movement.document_number || ""} ${row.movement.external_reference || ""}`,
        cell: (row) => (
          <>
            <div className="font-bold">
              {row.movement.document_number || "Receipt pending number"}
            </div>
            <div className="text-xs text-[#7b6753]">
              Supplier ref: {row.movement.external_reference || "-"}
            </div>
          </>
        ),
      },
      {
        id: "order",
        label: "Subcontract PR / PO",
        minWidth: 190,
        sortable: true,
        accessor: (row) =>
          `${row.order.requisition_number || ""} ${row.order.order_number}`,
        cell: (row) => (
          <>
            <div className="font-semibold">PO: {row.order.order_number}</div>
            <div className="text-xs text-[#7b6753]">
              PR: {row.order.requisition_number || "Legacy subcontract order"}
            </div>
          </>
        ),
      },
      {
        id: "supplier",
        label: "Supplier",
        minWidth: 190,
        sortable: true,
        accessor: (row) =>
          vendorLabel(vendors, row.movement.vendor_id || row.step?.vendor_id),
        cell: (row) => (
          <>
            <div>
              {vendorLabel(
                vendors,
                row.movement.vendor_id || row.step?.vendor_id,
              )}
            </div>
            <div className="text-xs text-[#7b6753]">
              {row.step?.operation_name ||
                row.order.route?.name ||
                "Outside processing"}
            </div>
          </>
        ),
      },
      {
        id: "receiptDate",
        label: "Receipt date",
        minWidth: 125,
        sortable: true,
        accessor: (row) => row.movement.created_at || "",
        cell: (row) => fmtDate(row.movement.created_at),
      },
      {
        id: "quantity",
        label: "Receipt quantity",
        minWidth: 150,
        sortable: true,
        accessor: (row) => Number(row.movement.quantity || 0),
        cell: (row) => (
          <>
            <div className="font-bold">{fmt(row.movement.quantity)}</div>
            <div className="text-xs text-[#7b6753]">
              Accepted {fmt(row.movement.accepted_qty)} · Rejected{" "}
              {fmt(row.movement.rejected_qty)}
            </div>
          </>
        ),
      },
      {
        id: "qc",
        label: "QC status",
        minWidth: 140,
        sortable: true,
        accessor: (row) => row.movement.qc_status || "PENDING_QC",
        cell: (row) => (
          <StatusBadge value={row.movement.qc_status || "PENDING_QC"} />
        ),
      },
      {
        id: "payable",
        label: "Payable",
        minWidth: 155,
        sortable: true,
        accessor: (row) => Number(row.movement.payable_amount || 0),
        cell: (row) => {
          const pendingQc =
            String(row.movement.qc_status || "").toUpperCase() === "PENDING_QC";
          return (
            <>
              <div className="font-bold">
                {pendingQc
                  ? "Pending QC"
                  : `₹${fmtMoney(row.movement.payable_amount)}`}
              </div>
              <div className="text-xs text-[#7b6753]">
                Invoice: {row.movement.invoice_number || "Not recorded"}
              </div>
            </>
          );
        },
      },
      {
        id: "actions",
        label: "Actions",
        minWidth: 270,
        hideable: false,
        sortable: false,
        cell: (row) => {
          const pendingQc =
            String(row.movement.qc_status || "").toUpperCase() === "PENDING_QC";
          return (
            <div className="flex flex-nowrap gap-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold"
                onClick={() => void openOrderTrail(row.order)}
              >
                <Eye className="h-3.5 w-3.5" /> View
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold"
                onClick={() => void printSubcontractGrn(row)}
              >
                <ReceiptText className="h-3.5 w-3.5" /> Print GRN
              </button>
              <button
                type="button"
                disabled={!pendingQc}
                title={
                  pendingQc
                    ? "Inspect and approve this subcontract receipt"
                    : "QC has already been completed for this GRN"
                }
                className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-[#fff8e8] px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void inspectSubcontractGrn(row)}
              >
                <PackageCheck className="h-3.5 w-3.5" /> QC
              </button>
            </div>
          );
        },
      },
    ],
    [items, vendors],
  );

  const routeColumns = useMemo<ListTableColumn<RouteTemplate>[]>(
    () => [
      {
        id: "route",
        label: "Route",
        minWidth: 220,
        sortable: true,
        accessor: (route) => `${route.route_number} ${route.name}`,
        cell: (route) => (
          <>
            <div className="font-bold">{route.route_number}</div>
            <div className="text-[#6f5a45]">{route.name}</div>
          </>
        ),
      },
      {
        id: "input",
        label: "Raw material",
        minWidth: 280,
        sortable: true,
        accessor: (route) => itemLabel(items, route.input_item_id),
        cell: (route) => (
          <div className="font-medium">
            {itemLabel(items, route.input_item_id)}
            <div className="text-xs text-[#7b6753]">
              Route input; quantity entered on Work Order
            </div>
          </div>
        ),
      },
      {
        id: "output",
        label: "Output products",
        minWidth: 400,
        sortable: true,
        accessor: (route) =>
          (route.steps || [])
            .map((step) => itemLabel(items, step.output_item_id))
            .join(" "),
        cell: (route) => (
          <div
            className="space-y-1"
            title={(route.steps || [])
              .map((step) => itemLabel(items, step.output_item_id))
              .join("\n")}
          >
            {(route.steps || []).slice(0, 2).map((step, index) => (
              <div
                key={step.id || step.sequence_no}
                className="flex min-w-0 items-baseline text-[13px] leading-5"
              >
                <span className="mr-2 shrink-0 font-bold text-[#957244]">
                  {index + 1}.
                </span>
                <span className="min-w-0 truncate">
                  {itemLabel(items, step.output_item_id)}
                </span>
                {step.output_size ? (
                  <span className="ml-2 shrink-0 text-xs text-[#7b6753]">
                    {step.output_size} {step.output_uom || "MM"}
                  </span>
                ) : null}
              </div>
            ))}
            {(route.steps || []).length > 2 ? (
              <div className="pl-6 text-xs font-semibold text-[#805f35]">
                +{(route.steps || []).length - 2} more products — use View for
                details
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "operations",
        label: "Products",
        minWidth: 100,
        sortable: true,
        accessor: (route) => (route.steps || []).length,
        cell: (route) => (
          <span className="rounded-full bg-[#f8f1e7] px-3 py-1 text-xs font-semibold">
            {(route.steps || []).length} output{" "}
            {(route.steps || []).length === 1 ? "product" : "products"}
          </span>
        ),
      },
      {
        id: "status",
        label: "Status",
        minWidth: 120,
        sortable: true,
        accessor: (route) => route.status || "",
        cell: (route) => <StatusBadge value={route.status} />,
      },
      {
        id: "actions",
        label: "Actions",
        minWidth: 260,
        hideable: false,
        sortable: false,
        cell: (route) => (
          <div className="flex flex-nowrap gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold"
              onClick={() => openRouteView(route)}
            >
              <Eye className="h-3.5 w-3.5" /> View
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-[#cdb994] bg-white px-2.5 py-1.5 text-xs font-semibold"
              onClick={() => openRouteEditor(route)}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700"
              onClick={() => deleteRoute(route)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        ),
      },
    ],
    [items],
  );

  const wipColumns = useMemo<ListTableColumn<any>[]>(
    () => [
      {
        id: "order",
        label: "Order",
        minWidth: 150,
        sortable: true,
        accessor: (row) => row.order?.order_number || "",
        cell: (row) => (
          <div className="font-bold">{row.order?.order_number || "-"}</div>
        ),
      },
      {
        id: "operation",
        label: "Operation",
        minWidth: 180,
        sortable: true,
        accessor: (row) => row.operation_name || "",
        cell: (row) => row.operation_name || "-",
      },
      {
        id: "vendor",
        label: "Vendor",
        minWidth: 160,
        sortable: true,
        accessor: (row) => vendorLabel(vendors, row.vendor_id),
        cell: (row) => vendorLabel(vendors, row.vendor_id),
      },
      {
        id: "input",
        label: "Input item",
        minWidth: 300,
        sortable: true,
        accessor: (row) => itemLabel(items, row.input_item_id),
        cell: (row) => itemLabel(items, row.input_item_id),
      },
      {
        id: "outstanding",
        label: "Outstanding qty",
        minWidth: 150,
        sortable: true,
        accessor: (row) => Number(row.outstanding_qty || 0),
        cell: (row) => (
          <span className="font-bold">{fmt(row.outstanding_qty)}</span>
        ),
      },
      {
        id: "status",
        label: "Status",
        minWidth: 130,
        sortable: true,
        accessor: (row) => row.status || "",
        cell: (row) => <StatusBadge value={row.status} />,
      },
      {
        id: "actions",
        label: "Actions",
        minWidth: 230,
        hideable: false,
        sortable: false,
        cell: (row) => {
          const qcPending =
            String(row.status || "").toUpperCase() === "PENDING_QC" &&
            !!row.pending_qc_receipt_id;
          return (
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded border border-[#cdb994] px-2 py-1 text-xs font-semibold"
                onClick={() => void openVendorSource(row)}
              >
                Document Trail
              </button>
              <button
                type="button"
                title={
                  qcPending
                    ? "Perform QC inspection for the received material"
                    : "No received material is awaiting QC inspection"
                }
                disabled={!qcPending}
                className="rounded border border-[#cdb994] px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void inspectVendorReceipt(row)}
              >
                QC inspection
              </button>
            </div>
          );
        },
      },
    ],
    [items, vendors],
  );

  const financeColumns = useMemo<ListTableColumn<any>[]>(
    () => [
      {
        id: "order",
        label: "Order / Invoice",
        minWidth: 190,
        sortable: true,
        accessor: (row) =>
          `${row.order?.order_number || ""} ${row.invoice_number || ""}`,
        cell: (row) => (
          <>
            <div className="font-bold">{row.order?.order_number || "-"}</div>
            <div className="text-xs text-[#7b6753]">
              {row.invoice_number || "Invoice not captured"}
            </div>
          </>
        ),
      },
      {
        id: "vendor",
        label: "Vendor",
        minWidth: 170,
        sortable: true,
        accessor: (row) =>
          row.vendor?.name || vendorLabel(vendors, row.vendor_id),
        cell: (row) => row.vendor?.name || vendorLabel(vendors, row.vendor_id),
      },
      {
        id: "operation",
        label: "Operation",
        minWidth: 180,
        sortable: true,
        accessor: (row) => row.operation_name || "",
        cell: (row) => row.operation_name || "-",
      },
      {
        id: "processing",
        label: "Processing",
        minWidth: 130,
        sortable: true,
        accessor: (row) => Number(row.processing_amount || 0),
        cell: (row) => `Rs. ${fmtMoney(row.processing_amount)}`,
      },
      {
        id: "tax",
        label: "Tax",
        minWidth: 110,
        sortable: true,
        accessor: (row) => Number(row.tax_amount || 0),
        cell: (row) => `Rs. ${fmtMoney(row.tax_amount)}`,
      },
      {
        id: "deductions",
        label: "Deductions",
        minWidth: 130,
        sortable: true,
        accessor: (row) => Number(row.deduction_amount || 0),
        cell: (row) => (
          <span className="text-red-700">
            Rs. {fmtMoney(row.deduction_amount)}
          </span>
        ),
      },
      {
        id: "payable",
        label: "Payable",
        minWidth: 130,
        sortable: true,
        accessor: (row) => Number(row.payable_amount || 0),
        cell: (row) => (
          <span className="font-bold">Rs. {fmtMoney(row.payable_amount)}</span>
        ),
      },
      {
        id: "status",
        label: "Status",
        minWidth: 140,
        sortable: true,
        accessor: (row) => row.invoice_status || "",
        cell: (row) => (
          <StatusBadge value={row.invoice_status || "PENDING_PAYMENT"} />
        ),
      },
      {
        id: "actions",
        label: "Actions",
        minWidth: 250,
        hideable: false,
        sortable: false,
        cell: (row) => {
          const outstanding = Math.max(
            0,
            Number(row.payable_amount || 0) - Number(row.paid_amount || 0),
          );
          const status = String(row.invoice_status || "").toUpperCase();
          const needsInvoice = status === "PENDING_INVOICE";
          const canPay =
            ["INVOICE_RECEIVED", "PENDING_PAYMENT"].includes(status) &&
            outstanding > 0.009;
          return (
            <div className="flex gap-1">
              <IconButton
                title="View order trail"
                onClick={() => void openOrderTrail(row.order)}
              >
                <Eye className="h-4 w-4" />
              </IconButton>
              {needsInvoice ? (
                <button
                  type="button"
                  className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900"
                  onClick={() =>
                    setInvoiceModal({
                      row,
                      invoiceNumber: "",
                      invoiceDate: new Date().toISOString().slice(0, 10),
                      file: null,
                    })
                  }
                >
                  Record Invoice
                </button>
              ) : (
                <button
                  type="button"
                  title="Record subcontractor payment"
                  className="rounded border border-[#cdb994] px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!canPay}
                  onClick={() => void openSubcontractPaymentModal(row)}
                >
                  Mark Paid
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [vendors],
  );

  return (
    <div className="min-h-screen bg-[#f7f3ec] text-[#2f241b]">
      <div className="mx-auto max-w-[1680px] px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d9c9b1] pb-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-[#957244]">
              Production
            </div>
            <h1 className="mt-1 text-3xl font-bold">
              Subcontracting / Outside Processing
            </h1>
            <p className="mt-1 text-sm text-[#6f5a45]">
              Work orders, material outward challans, vendor-held WIP,
              subcontract receipts, service invoices, and product-cost
              traceability.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadAll}
              className="inline-flex items-center gap-2 rounded border border-[#cdb994] bg-white px-4 py-2 text-sm font-semibold text-[#5b432c] hover:bg-[#f8f1e7]"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              onClick={openNewRoutePanel}
              className="inline-flex items-center gap-2 rounded bg-[#977447] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7e5f38]"
            >
              <GitBranch className="h-4 w-4" /> New Route
            </button>
            <button
              onClick={openOrderPanel}
              className="inline-flex items-center gap-2 rounded bg-[#5b432c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#43311f]"
            >
              <Plus className="h-4 w-4" /> New Order
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 border border-[#dcc9ad] bg-white sm:grid-cols-5">
          {[
            ["Open orders", dashboard.openOrders],
            ["Active routes", dashboard.activeRoutes],
            ["Open steps", dashboard.openSteps],
            ["Vendor WIP qty", dashboard.vendorHeldQty],
            ["Subcon payable", `Rs. ${fmtMoney(dashboard.subcontractPayable)}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="border-b border-r border-[#eadcc8] px-5 py-4 last:border-r-0 sm:border-b-0"
            >
              <div className="text-xs font-semibold uppercase text-[#795f43]">
                {label}
              </div>
              <div className="mt-1 text-2xl font-bold">{fmt(value)}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 border border-[#dcc9ad] bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-[#957244]">
                SAP-standard job-work control
              </div>
              <div className="font-semibold text-[#3b2a1e]">
                Subcontracting process flow
              </div>
            </div>
            <button
              type="button"
              title="Show process flow information"
              aria-label="Show process flow information"
              onClick={() => setShowProcessFlow((value) => !value)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${showProcessFlow ? "border-[#957244] bg-[#f2eadf]" : "border-[#d8c6aa]"} text-[#6c4f32]`}
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
          {showProcessFlow && (
            <>
              <div className="border-t border-[#eadcc8] px-4 py-3 text-sm text-[#6f5a45]">
                Company-owned raw material is issued to a vendor, processed
                outside, received with finished goods/scrap/returns, and
                reconciled through service invoice and stock update.
              </div>
              <div className="grid grid-cols-1 divide-y divide-[#eadcc8] md:grid-cols-7 md:divide-x md:divide-y-0">
                {[
                  [
                    "1",
                    "Work Order",
                    "Create subcontracting order against route/BOM.",
                    ClipboardList,
                  ],
                  [
                    "2",
                    "Issue Material",
                    "Post material outward challan; stock moves to vendor WIP.",
                    ArrowUpFromLine,
                  ],
                  [
                    "3",
                    "Vendor WIP",
                    "Track company material lying with subcontractor.",
                    Truck,
                  ],
                  [
                    "4",
                    "Receipt",
                    "Receive processed goods, rejected qty, scrap, and unused returns.",
                    ArrowDownToLine,
                  ],
                  [
                    "5",
                    "Service Invoice",
                    "Capture job-work charges, GST, invoice and payable.",
                    ReceiptText,
                  ],
                  [
                    "6",
                    "Stock Update",
                    "Accepted output stock is updated; consumed input is relieved.",
                    PackageCheck,
                  ],
                  [
                    "7",
                    "Next Use",
                    "Continue final assembly, dispatch, or payment settlement.",
                    Factory,
                  ],
                ].map(([step, title, body, Icon]) => (
                  <div key={String(step)} className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f2eadf] text-xs font-bold text-[#6c4f32]">
                        {String(step)}
                      </span>
                      <Icon className="h-4 w-4 text-[#957244]" />
                    </div>
                    <div className="mt-3 font-bold text-[#3b2a1e]">
                      {String(title)}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[#6f5a45]">
                      {String(body)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 border-t border-[#eadcc8] bg-[#fffcf7] p-4 text-xs text-[#6f5a45] md:grid-cols-4">
                <div>
                  <span className="font-bold text-[#5b432c]">Orders:</span>{" "}
                  create and operate the job-work order.
                </div>
                <div>
                  <span className="font-bold text-[#5b432c]">Routes:</span>{" "}
                  define raw material, output item, UOM, yield and operation
                  sequence.
                </div>
                <div>
                  <span className="font-bold text-[#5b432c]">Vendor WIP:</span>{" "}
                  see material still held by subcontractors.
                </div>
                <div>
                  <span className="font-bold text-[#5b432c]">Finance:</span>{" "}
                  approved subcontractor invoices and payments are included in
                  Accounts &gt; Accounts Payable.
                </div>
              </div>
            </>
          )}
        </div>

        {activeTab === "orders" && (
          <section className="mt-5 border border-[#dcc9ad] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#957244]">
                  Today&apos;s outside-processing work
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  What should happen next
                </h2>
                <p className="mt-1 text-sm text-[#6f5a45]">
                  Work through one subcontract order at a time. Mizantra keeps
                  the full document trail in the background.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFullOrders((current) => !current)}
                className="rounded border border-[#cdb994] bg-white px-3 py-2 text-sm font-semibold text-[#5b432c]"
              >
                {showFullOrders
                  ? "Hide full order register"
                  : `Open full order register (${filteredOrders.length})`}
              </button>
            </div>
            {loading ? (
              <div className="py-8 text-sm text-[#6f5a45]">
                Loading outside-processing work...
              </div>
            ) : !operationalOrders.length ? (
              <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                No open subcontract orders need action right now.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {operationalOrders.map((order) => {
                  const orderedSteps = [...(order.steps || [])].sort(
                    (left, right) =>
                      Number(left.sequence_no) - Number(right.sequence_no),
                  );
                  const issueStep =
                    orderedSteps.find(
                      (step) =>
                        !step.parent_node_key &&
                        ["READY", "ISSUED", "IN_PROCESS"].includes(
                          String(step.status),
                        ),
                    ) || orderedSteps[0];
                  const hasIssue = (order.movements || []).some(
                    (movement: any) => movement.movement_type === "SUBCON_SIV",
                  );
                  const hasOpenIssue = (order.movements || []).some(
                    (movement: any) =>
                      movement.movement_type === "SUBCON_SIV" &&
                      Number(movement.remaining_qty || 0) > 0.01,
                  );
                  const hasPendingQc = (order.movements || []).some(
                    (movement: any) =>
                      movement.movement_type === "SUBCON_SRV" &&
                      String(movement.qc_status || "").toUpperCase() ===
                        "PENDING_QC",
                  );
                  const status = String(order.status || "").toUpperCase();
                  const approvalStatus = String(
                    order.approval_status ||
                      (status === "OPEN" ? "LEGACY_APPROVED" : status),
                  ).toUpperCase();
                  const receiveStep =
                    status !== "COMPLETED" && !hasPendingQc && hasOpenIssue
                      ? orderedSteps.find((step) =>
                          ["IN_PROCESS", "ISSUED"].includes(
                            String(step.status),
                          ),
                        ) || issueStep
                      : undefined;
                  const action =
                    approvalStatus === "DRAFT"
                      ? {
                          label: "Submit PR",
                          run: () => void submitSubcontractPr(order),
                        }
                      : approvalStatus === "SUBMITTED"
                        ? {
                            label: "Approve PO",
                            run: () => void approveSubcontractPr(order),
                          }
                        : hasPendingQc
                          ? {
                              label: "Review & QC",
                              run: () => void openOrderTrail(order),
                            }
                          : !hasIssue &&
                              issueStep &&
                              ["APPROVED", "LEGACY_APPROVED"].includes(
                                approvalStatus,
                              )
                            ? {
                                label: "Issue material",
                                run: () =>
                                  openStepPanel("issue", order, issueStep),
                              }
                            : receiveStep
                              ? {
                                  label: "Receive material",
                                  run: () =>
                                    openStepPanel(
                                      "receive",
                                      order,
                                      receiveStep,
                                    ),
                                }
                              : {
                                  label: "Open order trail",
                                  run: () => void openOrderTrail(order),
                                };
                  return (
                    <article
                      key={order.id}
                      className="rounded-lg border border-[#e5d6bf] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-[#3b2a1e]">
                            {order.order_number}
                          </h3>
                          <p className="mt-1 text-sm text-[#6f5a45]">
                            {order.route?.name || "Outside processing"}
                          </p>
                        </div>
                        <StatusBadge
                          value={order.approval_status || order.status}
                        />
                      </div>
                      <p className="mt-3 text-sm text-[#6f5a45]">
                        Planned:{" "}
                        <b className="text-[#3b2a1e]">
                          {fmt(order.planned_input_qty)}
                        </b>{" "}
                        in /{" "}
                        <b className="text-[#3b2a1e]">
                          {fmt(order.planned_output_qty)}
                        </b>{" "}
                        out
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={action.run}
                          className="rounded bg-[#5b432c] px-3 py-2 text-sm font-semibold text-white"
                        >
                          {action.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => void openOrderTrail(order)}
                          className="rounded border border-[#cdb994] px-3 py-2 text-sm font-semibold text-[#5b432c]"
                        >
                          View trail
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div className="mt-5 border border-[#dcc9ad] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadcc8] p-4">
            <label className="min-w-[220px] text-xs font-bold uppercase tracking-wide text-[#795f43]">
              Subcontracting workspace
              <select
                value={activeTab}
                onChange={(event) =>
                  setActiveTab(event.target.value as typeof activeTab)
                }
                className="mt-1 block w-full rounded border border-[#cdb994] bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[#5b432c] outline-none focus:ring-2 focus:ring-[#cdb994]"
              >
                <option value="orders">Orders</option>
                <option value="grns">Subcontract GRNs</option>
                <option value="routes">Routes</option>
                <option value="wip">Vendor WIP</option>
              </select>
            </label>
            <div className="flex min-w-[320px] items-center gap-2 border border-[#d8c6aa] bg-white px-3 py-2">
              <Search className="h-4 w-4 text-[#957244]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order, route, status..."
                className="w-full outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="m-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {loading && (
            <div className="p-10 text-center text-[#6f5a45]">
              Loading subcontracting module...
            </div>
          )}

          {!loading && activeTab === "orders" && showFullOrders && (
            <ListTable
              storageKey="subcontracting-orders"
              rows={filteredOrders}
              columns={orderColumns}
              getRowId={(order) => order.id}
              defaultSort={{ id: "order", direction: "desc" }}
              defaultPageSize={10}
              searchPlaceholder="Search order, route, item, status..."
              emptyState="No subcontracting orders found."
            />
          )}

          {!loading && activeTab === "grns" && (
            <>
              <div className="grid grid-cols-2 border-b border-[#eadcc8] bg-[#fffcf7] md:grid-cols-4">
                {[
                  ["Total GRNs", subcontractGrns.length],
                  [
                    "Pending QC",
                    subcontractGrns.filter(
                      (row) =>
                        String(row.movement.qc_status || "").toUpperCase() ===
                        "PENDING_QC",
                    ).length,
                  ],
                  [
                    "QC completed",
                    subcontractGrns.filter((row) =>
                      ["APPROVED", "PARTIALLY_APPROVED"].includes(
                        String(row.movement.qc_status || "").toUpperCase(),
                      ),
                    ).length,
                  ],
                  [
                    "Approved payable",
                    `₹${fmtMoney(
                      subcontractGrns.reduce(
                        (sum, row) =>
                          sum + Number(row.movement.payable_amount || 0),
                        0,
                      ),
                    )}`,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="border-r border-[#eadcc8] px-4 py-3 last:border-r-0"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[#80684d]">
                      {label}
                    </div>
                    <div className="mt-1 text-lg font-bold text-[#3b2a1e]">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              <ListTable
                storageKey="subcontracting-grns"
                rows={filteredGrns}
                columns={grnColumns}
                getRowId={(row) => row.id}
                defaultSort={{ id: "receiptDate", direction: "desc" }}
                defaultPageSize={10}
                searchPlaceholder="Search GRN, PR/PO, supplier, invoice, QC..."
                emptyState="No subcontract GRNs found. Use Receive Material from an approved subcontract order to post the first receipt."
              />
            </>
          )}

          {!loading && activeTab === "routes" && (
            <ListTable
              storageKey="subcontracting-routes"
              rows={filteredRoutes}
              columns={routeColumns}
              getRowId={(route) => route.id}
              defaultSort={{ id: "route", direction: "asc" }}
              defaultPageSize={10}
              searchPlaceholder="Search route, material, operation, vendor..."
              emptyState="No subcontracting routes found."
            />
          )}

          {!loading && activeTab === "wip" && (
            <>
              <ListTable
                storageKey="subcontracting-wip"
                rows={filteredVendorStock}
                columns={wipColumns}
                getRowId={(row) => row.id}
                defaultSort={{ id: "order", direction: "desc" }}
                defaultPageSize={10}
                searchPlaceholder="Search order, vendor, item, status..."
                emptyState="No vendor-held WIP pending."
              />
              <div className="hidden">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-[#f2eadf] text-left text-xs uppercase text-[#6c4f32]">
                    <tr>
                      <th className="px-4 py-3">Order</th>
                      <th className="px-4 py-3">Operation</th>
                      <th className="px-4 py-3">Vendor</th>
                      <th className="px-4 py-3">Input Item</th>
                      <th className="px-4 py-3">Outstanding Qty</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendorStock.map((row) => (
                      <tr key={row.id} className="border-t border-[#eadcc8]">
                        <td className="px-4 py-4 font-bold">
                          {row.order?.order_number || "-"}
                        </td>
                        <td className="px-4 py-4">{row.operation_name}</td>
                        <td className="px-4 py-4">
                          {vendorLabel(vendors, row.vendor_id)}
                        </td>
                        <td className="px-4 py-4">
                          {itemLabel(items, row.input_item_id)}
                        </td>
                        <td className="px-4 py-4 font-bold">
                          {fmt(row.outstanding_qty)}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge value={row.status} />
                        </td>
                      </tr>
                    ))}
                    {filteredVendorStock.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-10 text-center text-[#7b6753]"
                        >
                          No vendor-held WIP pending.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {qcModal && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eadcc8] p-5">
              <div>
                <div className="text-xs font-bold uppercase text-[#957244]">
                  Subcontract GRN QC
                </div>
                <h2 className="text-xl font-bold">
                  {qcModal.receipt.document_number}
                </h2>
                <p className="text-sm text-[#6f5a45]">
                  Inspect every finished-goods line. The rejected balance on
                  each line must be sent for rework or recorded as scrap.
                </p>
              </div>
              <button onClick={() => setQcModal(null)} className="p-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-auto p-5">
              <div className="overflow-x-auto border border-[#eadcc8]">
                <table className="min-w-[1050px] w-full text-sm">
                  <thead className="bg-[#f8f2e8] text-left text-xs uppercase text-[#765a3b]">
                    <tr>
                      <th className="px-3 py-3">Finished good</th>
                      <th className="px-3 py-3">UOM</th>
                      <th className="px-3 py-3 text-right">Received</th>
                      <th className="px-3 py-3">QC approved *</th>
                      <th className="px-3 py-3 text-right">Rejected</th>
                      <th className="px-3 py-3">Disposition</th>
                      <th className="px-3 py-3">Scrap item</th>
                      <th className="px-3 py-3">Line QC notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qcModal.lines.map((line) => {
                      const rejectedQty = Math.max(
                        0,
                        line.receivedQty - Number(line.approvedQty || 0),
                      );
                      return (
                        <tr
                          key={line.id}
                          className="border-t border-[#eee2d1] align-top"
                        >
                          <td className="px-3 py-3 font-semibold text-[#3f2f20]">
                            {itemLabel(items, line.itemId)}
                          </td>
                          <td className="px-3 py-3">
                            {stockItemUom(items, line.itemId, "UOM")}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {fmt(line.receivedQty)}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              max={line.receivedQty}
                              step="any"
                              value={line.approvedQty}
                              onChange={(e) =>
                                updateQcLine(line.id, {
                                  approvedQty: e.target.value,
                                })
                              }
                              className="w-28 border border-[#d8c6aa] px-2 py-1.5"
                            />
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-[#a14924]">
                            {fmt(rejectedQty)}
                          </td>
                          <td className="px-3 py-2">
                            {rejectedQty > 0 ? (
                              <select
                                value={line.disposition}
                                onChange={(e) =>
                                  updateQcLine(line.id, {
                                    disposition: e.target.value as
                                      | "REWORK"
                                      | "SCRAP",
                                    scrapItemId:
                                      e.target.value === "REWORK"
                                        ? ""
                                        : line.scrapItemId,
                                  })
                                }
                                className="w-40 border border-[#d8c6aa] px-2 py-1.5"
                              >
                                <option value="REWORK">Rework</option>
                                <option value="SCRAP">Scrap</option>
                              </select>
                            ) : (
                              <span className="text-[#71806a]">Accepted</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {rejectedQty > 0 && line.disposition === "SCRAP" ? (
                              <SearchableDropdown
                                value={line.scrapItemId}
                                onChange={(value) =>
                                  updateQcLine(line.id, {
                                    scrapItemId: value,
                                  })
                                }
                                options={itemOptions.map((option) => ({
                                  value: option.value,
                                  label: option.label,
                                  subtitle: option.meta,
                                }))}
                                placeholder="Type to search scrap item"
                                className="w-56"
                                maxResults={50}
                                showSubtitleInInput={false}
                              />
                            ) : (
                              <span className="text-[#a2917b]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={line.notes}
                              onChange={(e) =>
                                updateQcLine(line.id, { notes: e.target.value })
                              }
                              placeholder="Observation / reason"
                              className="w-48 border border-[#d8c6aa] px-2 py-1.5"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                <Field label="Overall QC notes">
                  <textarea
                    value={qcModal.notes}
                    onChange={(e) =>
                      setQcModal({ ...qcModal, notes: e.target.value })
                    }
                    className="w-full border border-[#d8c6aa] px-3 py-2"
                  />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-[#eadcc8] p-4">
              <button
                onClick={() => setQcModal(null)}
                className="rounded border border-[#cdb994] px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={approveReceiptQc}
                className="rounded bg-[#0f7a4f] px-4 py-2 font-semibold text-white"
              >
                Post QC Inspection
              </button>
            </div>
          </div>
        </div>
      )}

      {invoiceModal && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#dcc9ad] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eadcc8] px-6 py-5">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#d8c8aa] bg-[#fff8e8] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#8b6f47]">
                  Subcontracting Finance
                </div>
                <h2 className="text-xl font-bold text-[#2f241b]">
                  Record Supplier Invoice
                </h2>
                <p className="mt-1 text-sm text-[#7b6753]">
                  {invoiceModal.row.order?.order_number ||
                    "Subcontract service order"}{" "}
                  · QC approved payable Rs.{" "}
                  {fmtMoney(invoiceModal.row.payable_amount)}
                </p>
              </div>
              <button
                onClick={() => setInvoiceModal(null)}
                className="rounded-full p-1 text-[#7b6753] hover:bg-[#f2eadf]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6c4f32]">
                  Supplier Invoice Number *
                </span>
                <input
                  value={invoiceModal.invoiceNumber}
                  onChange={(event) =>
                    setInvoiceModal((current) =>
                      current
                        ? { ...current, invoiceNumber: event.target.value }
                        : current,
                    )
                  }
                  className="w-full rounded border border-[#cdb994] px-3 py-2 outline-none focus:border-[#8b6f47] focus:ring-2 focus:ring-[#8b6f47]/20"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6c4f32]">
                  Invoice Date *
                </span>
                <input
                  type="date"
                  value={invoiceModal.invoiceDate}
                  onChange={(event) =>
                    setInvoiceModal((current) =>
                      current
                        ? { ...current, invoiceDate: event.target.value }
                        : current,
                    )
                  }
                  className="w-full rounded border border-[#cdb994] px-3 py-2 outline-none focus:border-[#8b6f47] focus:ring-2 focus:ring-[#8b6f47]/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6c4f32]">
                  Vendor Invoice Attachment (optional)
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(event) =>
                    setInvoiceModal((current) =>
                      current
                        ? { ...current, file: event.target.files?.[0] || null }
                        : current,
                    )
                  }
                  className="w-full rounded border border-[#cdb994] px-3 py-2 text-sm"
                />
              </label>
              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                The invoice will be matched only to a QC-approved subcontract
                GRN. Payment becomes available after this step.
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-[#eadcc8] px-6 py-4">
              <button
                onClick={() => setInvoiceModal(null)}
                className="rounded border border-[#cdb994] px-5 py-2 font-semibold text-[#5b432c]"
              >
                Cancel
              </button>
              <button
                onClick={recordSubcontractInvoice}
                className="inline-flex items-center gap-2 rounded bg-[#8b6f47] px-5 py-2 font-semibold text-white"
              >
                <ReceiptText className="h-4 w-4" /> Record Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentModal && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#dcc9ad] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eadcc8] px-6 py-5">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#d8c8aa] bg-[#fff8e8] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#8b6f47]">
                  Subcontracting Finance
                </div>
                <h2 className="text-xl font-bold text-[#2f241b]">
                  Record Subcontractor Payment
                </h2>
                <p className="mt-1 text-sm text-[#7b6753]">
                  {paymentModal.row.order?.order_number ||
                    "Subcontract invoice"}
                </p>
              </div>
              <button
                onClick={() => setPaymentModal(null)}
                className="rounded-full p-1 text-[#7b6753] hover:bg-[#f2eadf]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded border border-[#eadcc8] bg-[#faf7f1] p-3">
                  <div className="text-xs uppercase text-[#7b6753]">
                    Payable
                  </div>
                  <div className="font-bold">
                    Rs. {fmtMoney(paymentModal.row.payable_amount)}
                  </div>
                </div>
                <div className="rounded border border-[#eadcc8] bg-[#faf7f1] p-3">
                  <div className="text-xs uppercase text-[#7b6753]">Paid</div>
                  <div className="font-bold text-emerald-700">
                    Rs. {fmtMoney(paymentModal.row.paid_amount)}
                  </div>
                </div>
                <div className="rounded border border-[#eadcc8] bg-[#fff8e8] p-3">
                  <div className="text-xs uppercase text-[#7b6753]">
                    Outstanding
                  </div>
                  <div className="font-bold">
                    Rs.{" "}
                    {fmtMoney(
                      Math.max(
                        0,
                        Number(paymentModal.row.payable_amount || 0) -
                          Number(paymentModal.row.paid_amount || 0),
                      ),
                    )}
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6c4f32]">
                  Payment Amount
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={paymentModal.amount}
                  onChange={(event) =>
                    setPaymentModal((current) =>
                      current
                        ? { ...current, amount: event.target.value }
                        : current,
                    )
                  }
                  className="w-full rounded border border-[#cdb994] px-3 py-2 outline-none focus:border-[#8b6f47] focus:ring-2 focus:ring-[#8b6f47]/20"
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6c4f32]">
                  Payment Reference / UTR / Cheque No. (optional)
                </span>
                <input
                  value={paymentModal.reference}
                  onChange={(event) =>
                    setPaymentModal((current) =>
                      current
                        ? { ...current, reference: event.target.value }
                        : current,
                    )
                  }
                  className="w-full rounded border border-[#cdb994] px-3 py-2 outline-none focus:border-[#8b6f47] focus:ring-2 focus:ring-[#8b6f47]/20"
                  placeholder="Enter payment reference"
                />
              </label>

              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Payment will be posted against the subcontracting operation and
                reflected in the Finance trail.
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-[#eadcc8] px-6 py-4">
              <button
                onClick={() => setPaymentModal(null)}
                className="rounded border border-[#cdb994] px-5 py-2 font-semibold text-[#5b432c]"
              >
                Cancel
              </button>
              <button
                onClick={markSubcontractInvoicePaid}
                className="inline-flex items-center gap-2 rounded bg-[#8b6f47] px-5 py-2 font-semibold text-white"
              >
                <CreditCard className="h-4 w-4" /> Record Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {panel && (
        <div className="fixed inset-0 z-[220] bg-[#f7f3ec]">
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between border-b border-[#d9c9b1] bg-white px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase text-[#957244]">
                  {panel === "route" || panel === "routeView"
                    ? "Route Template"
                    : panel === "order"
                      ? "Subcontracting Order"
                      : selectedOrder?.order_number}
                </div>
                <h2 className="text-2xl font-bold">
                  {panel === "routeView"
                    ? "View Process Route"
                    : panel === "route"
                      ? editingRouteId
                        ? "Edit Process Route"
                        : "Create Process Route"
                      : panel === "order"
                        ? editingOrderId
                          ? "Edit Subcontracting Order"
                          : "Create Subcontracting Order"
                        : panel === "issue"
                          ? "Issue Material"
                          : panel === "moc"
                            ? "Material Outward Challan"
                            : panel === "view"
                              ? "View Subcontracting Order"
                              : panel === "trail"
                                ? "Document Flow / Trail"
                                : "Receive Processed Material"}
                </h2>
              </div>
              <button
                onClick={closePanel}
                className="rounded p-2 text-[#6f5a45] hover:bg-[#f8f1e7]"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {panel === "routeView" && selectedRoute && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 border border-[#dcc9ad] bg-white md:grid-cols-4">
                    <div className="border-b border-r border-[#eadcc8] p-4 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#805f35]">
                        Route
                      </div>
                      <div className="mt-1 font-bold">
                        {selectedRoute.route_number}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] p-4 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#805f35]">
                        Name
                      </div>
                      <div className="mt-1 font-semibold">
                        {selectedRoute.name}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] p-4 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#805f35]">
                        Input material
                      </div>
                      <div className="mt-1 font-semibold">
                        {itemLabel(items, selectedRoute.input_item_id)}
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="text-xs font-bold uppercase text-[#805f35]">
                        Status
                      </div>
                      <div className="mt-1">
                        <StatusBadge value={selectedRoute.status} />
                      </div>
                    </div>
                  </div>
                  <div className="overflow-auto border border-[#dcc9ad] bg-white">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="bg-[#f2eadf] text-left text-xs uppercase text-[#6c4f32]">
                        <tr>
                          <th className="px-4 py-3">No.</th>
                          <th className="px-4 py-3">Output product</th>
                          <th className="px-4 py-3">UOM</th>
                          <th className="px-4 py-3">Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedRoute.steps || []).map((step, index) => (
                          <tr
                            key={step.id || step.node_key || index}
                            className="border-t border-[#eadcc8]"
                          >
                            <td className="px-4 py-3">{index + 1}</td>
                            <td className="px-4 py-3 font-semibold">
                              {itemLabel(items, step.output_item_id)}
                            </td>
                            <td className="px-4 py-3">
                              {step.output_uom || "NOS"}
                            </td>
                            <td className="px-4 py-3">
                              {fmt(step.output_size)} MM
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedRoute.notes && (
                    <div className="border border-[#dcc9ad] bg-white p-4">
                      <div className="text-xs font-bold uppercase text-[#805f35]">
                        Notes
                      </div>
                      <div className="mt-1">{selectedRoute.notes}</div>
                    </div>
                  )}
                </div>
              )}

              {panel === "route" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    <Field label="Route Name *">
                      <input
                        className="w-full border border-[#d8c6aa] px-3 py-2"
                        placeholder="e.g. Rod to Coupler - Fabrication + Threading"
                        value={routeForm.name}
                        onChange={(e) =>
                          setRouteForm({ ...routeForm, name: e.target.value })
                        }
                      />
                    </Field>
                    <SearchSelect
                      label="Source material issued once *"
                      value={routeForm.input_item_id}
                      options={itemOptions}
                      placeholder="Search source material by code/name"
                      onChange={(value) =>
                        setRouteForm((prev) => ({
                          ...prev,
                          input_item_id: value,
                          steps: deriveRouteStepInputs(prev.steps, value),
                        }))
                      }
                    />
                    <Field label="Route Notes">
                      <input
                        className="w-full border border-[#d8c6aa] px-3 py-2"
                        placeholder="Optional process notes"
                        value={routeForm.notes}
                        onChange={(e) =>
                          setRouteForm({ ...routeForm, notes: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <p className="-mt-2 text-xs text-[#6f5a45]">
                    For rods, consumption is output size × pieces and is
                    deducted in the source item’s length UOM. Weight-based
                    materials deduct in KG/G instead.
                  </p>
                  <div
                    className={`grid grid-cols-1 border ${materialCalc.overIssue ? "border-red-300 bg-red-50" : "border-[#dcc9ad] bg-white"} md:grid-cols-3`}
                  >
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Raw Material Required
                      </div>
                      <div className="mt-1 text-xl font-bold">
                        {fmt(materialCalc.required)} {materialCalc.sourceUom}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Available Source
                      </div>
                      <div className="mt-1 text-xl font-bold">
                        {fmt(materialCalc.available)} {materialCalc.sourceUom}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Remaining Raw Material
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {fmt(materialCalc.balance)} {materialCalc.sourceUom}{" "}
                        after {materialCalc.rootCount} root product{" "}
                        {materialCalc.rootCount === 1 ? "branch" : "branches"}
                      </div>
                    </div>
                  </div>

                  <div className="border border-[#dcc9ad] bg-white">
                    <div className="flex items-center justify-between border-b border-[#eadcc8] px-4 py-3">
                      <div>
                        <h3 className="font-bold">
                          Process tree &amp; co-product branches
                        </h3>
                        <p className="mt-1 text-xs text-[#6f5a45]">
                          Create one root branch for each product made from the
                          issued raw material. Add downstream processes under
                          the product that feeds them.
                        </p>
                      </div>
                      <button
                        onClick={() => addRouteStep()}
                        className="inline-flex items-center gap-2 rounded border border-[#cdb994] px-3 py-2 text-sm font-semibold"
                      >
                        <Plus className="h-4 w-4" /> Add root product
                      </button>
                    </div>
                    <div className="border-b border-[#eadcc8] bg-[#fbf8f2] px-4 py-3 text-xs text-[#6f5a45]">
                      Every root calculates source use from output size × output
                      pieces. No source-material allocation is required.
                    </div>
                    <div className="divide-y divide-[#eadcc8]">
                      {routeForm.steps.map((step, index) => {
                        const parent = routeForm.steps.find(
                          (candidate) =>
                            candidate.node_key === step.parent_node_key,
                        );
                        const parentOptions: SelectOption[] = routeForm.steps
                          .filter(
                            (candidate) =>
                              candidate.node_key !== step.node_key &&
                              Number(candidate.sequence_no) <
                                Number(step.sequence_no),
                          )
                          .map((candidate) => ({
                            value: candidate.node_key || "",
                            label: `${candidate.operation_name || candidate.node_key} → ${itemLabel(items, candidate.output_item_id)}`,
                          }));
                        return (
                          <div key={step.node_key || index} className="p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <GitBranch className="h-4 w-4 text-[#957244]" />
                                <span>
                                  {step.parent_node_key
                                    ? `Downstream of ${parent?.operation_name || step.parent_node_key}`
                                    : "Root co-product from raw material"}
                                </span>
                                <span className="rounded bg-[#f8f1e7] px-2 py-0.5 text-xs text-[#795f43]">
                                  {step.node_key}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                {false && (
                                  <button
                                    type="button"
                                    onClick={() => addRouteStep(step.node_key)}
                                    className="rounded border border-[#cdb994] px-2.5 py-1.5 text-xs font-semibold text-[#5b432c]"
                                  >
                                    + Downstream process
                                  </button>
                                )}
                                {routeForm.steps.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeRouteStep(index)}
                                    className="rounded border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700"
                                  >
                                    Remove branch
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                              {step.parent_node_key ? (
                                <Field label="Consumes output from *">
                                  <select
                                    className="w-full border border-[#d8c6aa] px-3 py-2"
                                    value={step.parent_node_key}
                                    onChange={(e) =>
                                      updateRouteStep(index, {
                                        parent_node_key: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">
                                      Choose parent process
                                    </option>
                                    {parentOptions.map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                              ) : (
                                <div className="rounded border border-[#d8c6aa] bg-[#f8f5ef] px-3 py-2">
                                  <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                    Source material
                                  </div>
                                  <div className="mt-1 text-sm text-[#5b432c]">
                                    Route source issued once
                                  </div>
                                </div>
                              )}
                              <input
                                type="hidden"
                                value="Subcontract Processing"
                                readOnly
                              />
                              <input
                                type="hidden"
                                value={step.vendor_id || ""}
                                readOnly
                              />
                              <SearchSelect
                                label="Resulting item / co-product *"
                                value={step.output_item_id || ""}
                                options={itemOptions}
                                placeholder="Product created by this operation"
                                onChange={(value) => {
                                  const item = items.find(
                                    (entry) => entry.id === value,
                                  );
                                  updateRouteStep(index, {
                                    output_item_id: value,
                                    output_uom: stockItemUom(items, value),
                                    output_size: item?.product_size
                                      ? String(item.product_size)
                                      : "",
                                    input_size: item?.product_size
                                      ? String(item.product_size)
                                      : step.input_size,
                                  });
                                }}
                              />
                              <input
                                type="hidden"
                                value={step.input_uom || ""}
                                readOnly
                              />
                              <div>
                                <SearchSelect
                                  label="Output UOM *"
                                  value={stockItemUom(
                                    items,
                                    step.output_item_id,
                                    step.output_uom,
                                  )}
                                  options={uomSelectOptions}
                                  placeholder="Select an output item"
                                  onChange={(value) =>
                                    updateRouteStep(index, {
                                      output_uom: value,
                                    })
                                  }
                                />
                                <div className="mt-1 text-[11px] text-[#805f35]">
                                  Inherited from the selected item in Stock
                                  Master.
                                </div>
                              </div>
                              <Field
                                label={`Output size (${items.find((item) => item.id === step.output_item_id)?.product_size_uom || "MM"}) *`}
                              >
                                <input
                                  className="w-full border border-[#d8c6aa] px-3 py-2"
                                  placeholder="e.g. 33"
                                  value={step.output_size ?? ""}
                                  onChange={(e) =>
                                    updateRouteStep(index, {
                                      output_size: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                              {step.parent_node_key ? (
                                <div className="rounded border border-[#d8c6aa] bg-[#f8f5ef] px-3 py-2">
                                  <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                    Input quantity
                                  </div>
                                  <div className="mt-1 text-sm text-[#5b432c]">
                                    {step.default_input_qty ||
                                      "Set the parent planned output qty"}
                                  </div>
                                  <div className="mt-0.5 text-xs text-[#8a7359]">
                                    Automatically derived from the parent
                                    process.
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded border border-[#d8c6aa] bg-[#f8f5ef] px-3 py-2 text-sm text-[#5b432c]">
                                  Raw material is calculated from output pieces
                                  × input weight/pc.
                                </div>
                              )}
                              <div className="rounded border border-[#d8c6aa] bg-[#f8f5ef] px-3 py-2 text-sm text-[#5b432c]">
                                <div className="text-xs font-bold uppercase text-[#805f35]">
                                  Output quantity / weight
                                </div>
                                <div className="mt-1">
                                  Entered on Work Order / GRN
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {panel === "order" && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <select
                    className="border border-[#d8c6aa] px-3 py-2"
                    value={orderForm.route_id}
                    onChange={(e) => {
                      const route = routes.find(
                        (row) => row.id === e.target.value,
                      );
                      setOrderForm({
                        ...orderForm,
                        route_id: e.target.value,
                        ...routeDefaults(e.target.value),
                      });
                      setOrderLines(
                        (route?.steps || [])
                          .filter((step) => !step.parent_node_key)
                          .map((step) => ({
                            node_key: step.node_key || "",
                            item_id: step.output_item_id || "",
                            uom: stockItemUom(
                              items,
                              step.output_item_id,
                              step.output_uom,
                            ),
                            quantity: "",
                            size: String(step.output_size || ""),
                            price: "",
                            hsn_code: "",
                            discount_percent: "",
                          })),
                      );
                    }}
                  >
                    <option value="">Select route *</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.route_number} - {r.name}
                      </option>
                    ))}
                  </select>
                  <SearchSelect
                    label="Vendor *"
                    value={orderForm.vendor_id}
                    options={vendorOptions}
                    placeholder="Select route vendor"
                    onChange={(value) =>
                      setOrderForm({ ...orderForm, vendor_id: value })
                    }
                  />
                  <div className="border border-[#d8c6aa] bg-[#fbf8f2] px-3 py-2 text-sm md:col-span-2">
                    <div className="text-xs font-bold uppercase text-[#805f35]">
                      Input material
                    </div>
                    <div className="mt-1 font-semibold text-[#3f3023]">
                      {itemLabel(
                        items,
                        routes.find((route) => route.id === orderForm.route_id)
                          ?.input_item_id || "",
                      ) || "Select a route to view the raw material"}
                    </div>
                  </div>
                  <select
                    className="border border-[#d8c6aa] px-3 py-2"
                    value={orderForm.source_warehouse_id}
                    onChange={(e) =>
                      setOrderForm({
                        ...orderForm,
                        source_warehouse_id: e.target.value,
                      })
                    }
                  >
                    <option value="">Source warehouse *</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} - {w.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="border border-[#d8c6aa] px-3 py-2"
                    value={orderForm.output_warehouse_id}
                    onChange={(e) =>
                      setOrderForm({
                        ...orderForm,
                        output_warehouse_id: e.target.value,
                      })
                    }
                  >
                    <option value="">Output warehouse *</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} - {w.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      className="border border-[#d8c6aa] px-3 py-2"
                      placeholder={`Input material quantity${selectedOrderInputUom ? ` (${selectedOrderInputUom})` : ""} *`}
                      value={orderForm.planned_input_qty}
                      onChange={(e) =>
                        setOrderForm({
                          ...orderForm,
                          planned_input_qty: e.target.value,
                        })
                      }
                    />
                    <div className="border border-[#d8c6aa] bg-[#fbf8f2] px-3 py-2 font-semibold">
                      {selectedOrderInputUom || "UOM"}
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required={orderRequiresLength}
                      disabled={!orderRequiresLength}
                      className="border border-[#d8c6aa] px-3 py-2 disabled:cursor-not-allowed disabled:bg-[#eee9e1] disabled:text-[#8a7c6d]"
                      placeholder={
                        orderRequiresLength
                          ? "Raw material length (MTR) *"
                          : "Length not required for same material"
                      }
                      value={
                        orderRequiresLength ? orderForm.secondary_input_qty : ""
                      }
                      onChange={(e) =>
                        setOrderForm({
                          ...orderForm,
                          secondary_input_qty: e.target.value,
                          secondary_input_uom: "MTR",
                        })
                      }
                    />
                    <div
                      className={`border border-[#d8c6aa] px-3 py-2 font-semibold ${orderRequiresLength ? "bg-[#fbf8f2]" : "bg-[#eee9e1] text-[#8a7c6d]"}`}
                    >
                      {orderRequiresLength ? "MTR" : "N/A"}
                    </div>
                  </div>
                  <input
                    className="border border-[#d8c6aa] px-3 py-2"
                    placeholder="Notes"
                    value={orderForm.notes}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, notes: e.target.value })
                    }
                  />
                  {orderLines.length > 0 && (
                    <div className="md:col-span-2 overflow-auto rounded border border-[#d8c6aa] bg-white">
                      <div className="border-b border-[#eadcc8] bg-[#fbf8f2] px-3 py-2">
                        <div className="text-xs font-bold uppercase text-[#805f35]">
                          Output lines
                        </div>
                        <div className="mt-1 text-[11px] text-[#805f35]">
                          Use the ↓ beside a column to copy its first-row value
                          down that column.
                        </div>
                      </div>
                      <div className="grid min-w-[1000px] grid-cols-[40px_minmax(260px,1fr)_100px_120px_120px_120px_120px_120px] items-center border-b border-[#eadcc8] bg-[#fbf8f2] px-3 py-2 text-xs font-bold uppercase text-[#805f35]">
                        <span>No.</span>
                        <span>Output product</span>
                        <button
                          type="button"
                          title="Copy first-row UOM down"
                          className="text-left"
                          onClick={() =>
                            setOrderLines((rows) =>
                              rows.length < 2
                                ? rows
                                : rows.map((row, i) =>
                                    i === 0
                                      ? row
                                      : { ...row, uom: rows[0].uom },
                                  ),
                            )
                          }
                        >
                          UOM <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          type="button"
                          title="Copy first-row output quantity down"
                          className="text-left"
                          onClick={() =>
                            setOrderLines((rows) =>
                              rows.length < 2
                                ? rows
                                : rows.map((row, i) =>
                                    i === 0
                                      ? row
                                      : { ...row, quantity: rows[0].quantity },
                                  ),
                            )
                          }
                        >
                          Output qty <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          type="button"
                          title="Copy first-row size down"
                          className="text-left"
                          onClick={() =>
                            setOrderLines((rows) =>
                              rows.length < 2
                                ? rows
                                : rows.map((row, i) =>
                                    i === 0
                                      ? row
                                      : { ...row, size: rows[0].size },
                                  ),
                            )
                          }
                        >
                          Size (MM) <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          type="button"
                          title="Copy first-row price down"
                          className="text-left"
                          onClick={() =>
                            setOrderLines((rows) =>
                              rows.length < 2
                                ? rows
                                : rows.map((row, i) =>
                                    i === 0
                                      ? row
                                      : { ...row, price: rows[0].price },
                                  ),
                            )
                          }
                        >
                          Price <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          type="button"
                          title="Copy first-row HSN down"
                          className="text-left"
                          onClick={() =>
                            setOrderLines((rows) =>
                              rows.length < 2
                                ? rows
                                : rows.map((row, i) =>
                                    i === 0
                                      ? row
                                      : { ...row, hsn_code: rows[0].hsn_code },
                                  ),
                            )
                          }
                        >
                          HSN <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          type="button"
                          title="Copy first-row discount down"
                          className="text-left"
                          onClick={() =>
                            setOrderLines((rows) =>
                              rows.length < 2
                                ? rows
                                : rows.map((row, i) =>
                                    i === 0
                                      ? row
                                      : {
                                          ...row,
                                          discount_percent:
                                            rows[0].discount_percent,
                                        },
                                  ),
                            )
                          }
                        >
                          Discount % <span aria-hidden="true">↓</span>
                        </button>
                      </div>
                      {orderLines.map((line, index) => (
                        <div
                          key={line.node_key || index}
                          className="grid min-w-[1000px] grid-cols-[40px_minmax(260px,1fr)_100px_120px_120px_120px_120px_120px] items-center gap-2 border-b border-[#f0e5d6] px-3 py-2"
                        >
                          <span>{index + 1}</span>
                          <span>{itemLabel(items, line.item_id)}</span>
                          <select
                            className="border border-[#d8c6aa] px-2 py-1"
                            value={line.uom || "NOS"}
                            onChange={(e) =>
                              setOrderLines((rows) =>
                                rows.map((row, i) =>
                                  i === index
                                    ? { ...row, uom: e.target.value }
                                    : row,
                                ),
                              )
                            }
                          >
                            {uomOptions.map((uom) => (
                              <option key={uom} value={uom}>
                                {uom}
                              </option>
                            ))}
                          </select>
                          <input
                            className="border border-[#d8c6aa] px-2 py-1"
                            value={line.quantity}
                            onChange={(e) =>
                              setOrderLines((rows) =>
                                rows.map((row, i) =>
                                  i === index
                                    ? { ...row, quantity: e.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          <input
                            className="border border-[#d8c6aa] px-2 py-1"
                            value={line.size}
                            onChange={(e) =>
                              setOrderLines((rows) =>
                                rows.map((row, i) =>
                                  i === index
                                    ? { ...row, size: e.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          <input
                            className="border border-[#d8c6aa] px-2 py-1"
                            value={line.price}
                            onChange={(e) =>
                              setOrderLines((rows) =>
                                rows.map((row, i) =>
                                  i === index
                                    ? { ...row, price: e.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          <input
                            className="border border-[#d8c6aa] px-2 py-1"
                            value={line.hsn_code}
                            onChange={(e) =>
                              setOrderLines((rows) =>
                                rows.map((row, i) =>
                                  i === index
                                    ? { ...row, hsn_code: e.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          <input
                            className="border border-[#d8c6aa] px-2 py-1"
                            value={line.discount_percent}
                            onChange={(e) =>
                              setOrderLines((rows) =>
                                rows.map((row, i) =>
                                  i === index
                                    ? {
                                        ...row,
                                        discount_percent: e.target.value,
                                      }
                                    : row,
                                ),
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {panel === "issue" && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="border border-[#dcc9ad] bg-white p-4 md:col-span-2">
                    <div className="font-bold">
                      {selectedStep?.operation_name}
                    </div>
                    <div className="text-sm text-[#6f5a45]">
                      {itemLabel(items, selectedStep?.input_item_id)} to{" "}
                      {vendorLabel(vendors, selectedStep?.vendor_id)}
                    </div>
                    <div className="mt-2 text-xs font-bold uppercase text-[#805f35]">
                      This posts a Material Outward Challan and moves stock to
                      Vendor WIP.
                    </div>
                  </div>
                  <label className="grid gap-1 text-xs font-bold uppercase text-[#805f35]">
                    {selectedStep?.parent_node_key
                      ? "Issue quantity *"
                      : `Approved raw material to issue (${(selectedOrder as any)?.input_uom || "KG"})`}
                    <input
                      className="border border-[#d8c6aa] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-[#f7f1e8]"
                      placeholder="Issue quantity *"
                      value={issueForm.quantity}
                      readOnly={!selectedStep?.parent_node_key}
                      disabled={!selectedStep?.parent_node_key}
                      onChange={(e) =>
                        setIssueForm({ ...issueForm, quantity: e.target.value })
                      }
                    />
                  </label>
                  <input
                    className="border border-[#d8c6aa] px-3 py-2"
                    placeholder="External challan / vendor reference"
                    value={issueForm.reference_number}
                    onChange={(e) =>
                      setIssueForm({
                        ...issueForm,
                        reference_number: e.target.value,
                      })
                    }
                  />
                  <textarea
                    className="border border-[#d8c6aa] px-3 py-2 md:col-span-2"
                    placeholder="Notes"
                    value={issueForm.notes}
                    onChange={(e) =>
                      setIssueForm({ ...issueForm, notes: e.target.value })
                    }
                  />
                </div>
              )}

              {panel === "receive" && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="border border-[#dcc9ad] bg-white p-4 md:col-span-3">
                    <div className="font-bold">
                      {selectedStep?.operation_name}
                    </div>
                    <div className="text-sm text-[#6f5a45]">
                      Post a Subcontract GRN against one outward challan. Every
                      raw-material unit must be accounted for as finished-good
                      consumption, unused return, scrap, or approved loss.
                    </div>
                  </div>
                  <select
                    className="border border-[#d8c6aa] px-3 py-2 md:col-span-3"
                    value={receiveForm.issue_id}
                    onChange={(e) =>
                      setReceiveForm({
                        ...receiveForm,
                        issue_id: e.target.value,
                      })
                    }
                  >
                    <option value="">Select Material Outward Challan *</option>
                    {(selectedOrder?.movements || [])
                      .filter(
                        (movement: any) =>
                          movement.movement_type === "SUBCON_SIV" &&
                          (!movement.order_step_id ||
                            movement.order_step_id === selectedStep?.id) &&
                          Number(
                            movement.remaining_qty ?? movement.quantity ?? 0,
                          ) > 0,
                      )
                      .map((movement: any) => (
                        <option key={movement.id} value={movement.id}>
                          {movement.document_number} — open RM{" "}
                          {fmt(movement.remaining_qty ?? movement.quantity)}
                        </option>
                      ))}
                  </select>
                  {selectedOrder?.all_finished_goods_received && (
                    <div className="grid grid-cols-1 gap-3 border border-orange-200 bg-orange-50 p-4 md:col-span-3 md:grid-cols-3">
                      <div>
                        <div className="text-xs font-bold uppercase text-orange-800">
                          Finished goods
                        </div>
                        <div className="mt-1 font-bold text-emerald-700">
                          Fully received
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase text-orange-800">
                          RM weight remaining
                        </div>
                        <div className="mt-1 font-bold">
                          {fmt(selectedOrder.remaining_raw_material_weight)} KG
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase text-orange-800">
                          RM length remaining
                        </div>
                        <div className="mt-1 font-bold">
                          {fmt(selectedOrder.remaining_secondary_input_qty)}{" "}
                          {selectedOrder.secondary_input_uom || "MTR"}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="border border-[#dcc9ad] bg-white p-3 md:col-span-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <div className="font-bold">
                          Finished goods to receive
                        </div>
                        <div className="text-xs text-[#805f35]">
                          Enter the actual receipt. Above-plan output is allowed
                          when the route backflush is within the issued RM
                          balance; planned versus received remains visible for
                          variance control.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded border border-[#cdb994] px-2 py-1 text-xs font-semibold"
                        onClick={() =>
                          setReceiveForm((current) => ({
                            ...current,
                            finished_goods: [
                              ...current.finished_goods,
                              {
                                item_id: "",
                                quantity: "",
                                raw_material_qty: "",
                                actual_weight: "",
                                planned_qty: 0,
                                received_qty: 0,
                                remaining_qty: 0,
                                uom: "NOS",
                              },
                            ],
                          }))
                        }
                      >
                        + Add product
                      </button>
                    </div>
                    <div className="min-w-[760px] overflow-auto">
                      <div className="grid grid-cols-[40px_minmax(280px,1fr)_75px_95px_105px_150px_36px] gap-2 border-y border-[#eadcc8] bg-[#fbf8f2] px-2 py-2 text-xs font-bold uppercase text-[#805f35]">
                        <span>No.</span>
                        <span>Output product</span>
                        <span>UOM</span>
                        <span>Planned</span>
                        <span>Received</span>
                        <span>Receive now</span>
                        <span />
                      </div>
                      {receiveForm.finished_goods.map((line, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-[40px_minmax(280px,1fr)_75px_95px_105px_150px_36px] items-center gap-2 border-b border-[#f0e5d6] px-2 py-2"
                        >
                          <span>{index + 1}</span>
                          <SearchableDropdown
                            options={itemOptions.map((item) => ({
                              value: item.value,
                              label: item.label,
                              subtitle: item.meta,
                            }))}
                            value={line.item_id}
                            placeholder="Search finished item by code or name"
                            minSearchChars={1}
                            maxResults={60}
                            onChange={(itemId) =>
                              setReceiveForm((current) => ({
                                ...current,
                                finished_goods: current.finished_goods.map(
                                  (row, i) =>
                                    i === index
                                      ? { ...row, item_id: itemId }
                                      : row,
                                ),
                              }))
                            }
                          />
                          <span className="text-sm font-semibold">
                            {line.uom || "NOS"}
                          </span>
                          <span className="text-sm">
                            {fmt(line.planned_qty)}
                          </span>
                          <span className="text-sm">
                            {fmt(line.received_qty)}
                          </span>
                          <input
                            className="border border-[#d8c6aa] px-3 py-2"
                            placeholder="Actual qty"
                            value={line.quantity}
                            onChange={(e) =>
                              updateReceiveQuantity(index, e.target.value)
                            }
                          />
                          <button
                            type="button"
                            className="border border-red-200 text-red-700"
                            disabled={receiveForm.finished_goods.length === 1}
                            onClick={() =>
                              setReceiveForm((current) => ({
                                ...current,
                                finished_goods: current.finished_goods.filter(
                                  (_, i) => i !== index,
                                ),
                              }))
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {receiveForm.finished_goods.length === 0 && (
                        <div className="border-b border-[#f0e5d6] bg-[#f8f1e7] px-3 py-4 text-sm text-[#6f5a45]">
                          All planned finished goods have already been received.
                          Settle the open raw-material balance shown above
                          through unused return, scrap, or approved process
                          loss.
                        </div>
                      )}
                    </div>
                  </div>
                  <label className="text-xs font-bold uppercase text-[#6c4f32]">
                    Rejected quantity
                    <input
                      aria-label="Rejected quantity"
                      className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                      placeholder="Enter rejected quantity"
                      value={receiveForm.rejected_qty}
                      onChange={(e) =>
                        setReceiveForm({
                          ...receiveForm,
                          rejected_qty: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="text-xs font-bold uppercase text-[#6c4f32]">
                    Scrap quantity ({receiveRawMaterialUom})
                    <input
                      aria-label="Scrap quantity"
                      className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                      placeholder={`Enter scrap in ${receiveRawMaterialUom}`}
                      value={receiveForm.scrap_qty}
                      onChange={(e) =>
                        updateReceiveSettlement("scrap_qty", e.target.value)
                      }
                    />
                  </label>
                  <label className="text-xs font-bold uppercase text-[#6c4f32]">
                    Unused raw material return ({receiveRawMaterialUom}) - auto
                    <input
                      aria-label="Unused raw material return"
                      readOnly
                      className="mt-1 w-full cursor-not-allowed border border-[#d8c6aa] bg-[#f3eee6] px-3 py-2"
                      placeholder="Issued RM minus consumption, scrap and loss"
                      value={receiveForm.unused_return_qty}
                    />
                    <span className="mt-1 block text-[11px] font-normal normal-case text-[#806d58]">
                      System calculated in {receiveRawMaterialUom}: issued RM
                      minus route backflush, scrap and approved loss.
                    </span>
                  </label>
                  <label className="text-xs font-bold uppercase text-[#6c4f32]">
                    Approved process loss ({receiveRawMaterialUom})
                    <input
                      aria-label="Approved process loss"
                      className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                      placeholder={`Enter approved loss in ${receiveRawMaterialUom}`}
                      value={receiveForm.loss_qty}
                      onChange={(e) =>
                        updateReceiveSettlement("loss_qty", e.target.value)
                      }
                    />
                  </label>
                  <label className="text-xs font-bold uppercase text-[#6c4f32]">
                    Supplier challan / reference
                    <input
                      aria-label="Supplier challan reference"
                      className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                      placeholder="Enter supplier challan or reference"
                      value={receiveForm.reference_number}
                      onChange={(e) =>
                        setReceiveForm({
                          ...receiveForm,
                          reference_number: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="text-xs font-bold uppercase text-[#6c4f32]">
                    Loss reason / approval
                    <input
                      aria-label="Loss reason or approval"
                      className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                      placeholder="Explain and approve any process loss"
                      value={receiveForm.loss_reason}
                      onChange={(e) =>
                        setReceiveForm({
                          ...receiveForm,
                          loss_reason: e.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="border border-[#dcc9ad] bg-white p-4 md:col-span-3">
                    <div className="mb-3 flex items-center gap-2 font-bold">
                      <ReceiptText className="h-4 w-4 text-[#957244]" />{" "}
                      Subcontracting Service Invoice
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                      <label className="text-xs font-bold uppercase text-[#6c4f32]">
                        Vendor invoice number
                        <input
                          aria-label="Vendor invoice number"
                          className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                          placeholder="Enter vendor invoice number"
                          value={receiveForm.invoice_number}
                          onChange={(e) =>
                            setReceiveForm({
                              ...receiveForm,
                              invoice_number: e.target.value,
                            })
                          }
                        />
                      </label>
                      <DateInput
                        className="border border-[#d8c6aa] px-3 py-2"
                        value={receiveForm.invoice_date}
                        onChange={(value) =>
                          setReceiveForm({
                            ...receiveForm,
                            invoice_date: value,
                          })
                        }
                      />
                      <label className="text-xs font-bold uppercase text-[#6c4f32]">
                        Service Order pricing
                        <input
                          aria-label="Service Order pricing"
                          className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                          placeholder="Calculated from Service Order line prices"
                          value={receiveForm.processing_rate}
                          onChange={(e) =>
                            setReceiveForm({
                              ...receiveForm,
                              processing_rate: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs font-bold uppercase text-[#6c4f32]">
                        Freight
                        <input
                          aria-label="Freight amount"
                          type="number"
                          min="0"
                          step="0.01"
                          className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                          placeholder="Freight amount"
                          value={receiveForm.freight_amount}
                          onChange={(e) =>
                            setReceiveForm({
                              ...receiveForm,
                              freight_amount: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs font-bold uppercase text-[#6c4f32]">
                        Other charges
                        <input
                          aria-label="Other charges amount"
                          type="number"
                          min="0"
                          step="0.01"
                          className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                          placeholder="Packing, handling, etc."
                          value={receiveForm.other_charges_amount}
                          onChange={(e) =>
                            setReceiveForm({
                              ...receiveForm,
                              other_charges_amount: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs font-bold uppercase text-[#6c4f32]">
                        Custom deductions
                        <input
                          aria-label="Custom deductions"
                          className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                          placeholder="Enter deduction amount"
                          value={receiveForm.deduction_amount}
                          onChange={(e) =>
                            setReceiveForm({
                              ...receiveForm,
                              deduction_amount: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs font-bold uppercase text-[#6c4f32]">
                        GST percentage
                        <input
                          aria-label="GST percentage"
                          className="mt-1 w-full border border-[#d8c6aa] px-3 py-2"
                          placeholder="Enter GST percentage"
                          value={receiveForm.tax_percent}
                          onChange={(e) =>
                            setReceiveForm({
                              ...receiveForm,
                              tax_percent: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs font-bold uppercase text-[#6c4f32] md:col-span-2">
                        Attach vendor invoice
                        <input
                          aria-label="Attach vendor invoice"
                          type="file"
                          accept="application/pdf,image/*"
                          className="mt-1 w-full border border-[#d8c6aa] px-3 py-2 text-sm"
                          onChange={(e) =>
                            setInvoiceFile(e.target.files?.[0] || null)
                          }
                        />
                        {invoiceFile && (
                          <span className="mt-1 block text-xs normal-case text-[#5b432c]">
                            Selected: {invoiceFile.name}
                          </span>
                        )}
                      </label>
                      <div className="border border-[#eadcc8] bg-[#fbf8f2] px-3 py-2">
                        <div className="text-xs font-bold uppercase text-[#6c4f32]">
                          Payable
                        </div>
                        <div className="font-bold">
                          Rs. {fmtMoney(serviceOrderPayablePreview())}
                        </div>
                      </div>
                    </div>
                  </div>
                  <select
                    className="border border-[#d8c6aa] px-3 py-2 md:col-span-3"
                    value={receiveForm.scrap_item_id}
                    onChange={(e) =>
                      setReceiveForm({
                        ...receiveForm,
                        scrap_item_id: e.target.value,
                      })
                    }
                  >
                    <option value="">Optional scrap item master</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.code} - {i.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="border border-[#d8c6aa] px-3 py-2 md:col-span-3"
                    placeholder="QC / receipt notes"
                    value={receiveForm.notes}
                    onChange={(e) =>
                      setReceiveForm({ ...receiveForm, notes: e.target.value })
                    }
                  />
                </div>
              )}

              {panel === "view" && selectedOrder && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 border border-[#dcc9ad] bg-white md:grid-cols-5">
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Order
                      </div>
                      <div className="mt-1 font-bold">
                        {selectedOrder.order_number}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Route
                      </div>
                      <div className="mt-1 font-bold">
                        {selectedOrder.route?.name || "-"}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Status
                      </div>
                      <div className="mt-1">
                        <StatusBadge value={selectedOrder.status} />
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Input
                      </div>
                      <div className="mt-1 font-bold">
                        {fmt(selectedOrder.planned_input_qty)}{" "}
                        {(selectedOrder as any).input_uom || ""}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Vendor
                      </div>
                      <div className="mt-1 font-bold">
                        {vendorLabel(
                          vendors,
                          selectedOrder.steps?.[0]?.vendor_id,
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="border border-[#dcc9ad] bg-white">
                    <div className="border-b border-[#eadcc8] px-4 py-3">
                      <h3 className="font-bold">
                        Output products and commercial terms
                      </h3>
                      <p className="text-xs text-[#7b6753]">
                        Service-order pricing, discount and GST are shown like a
                        purchase order.
                      </p>
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-[1250px] w-full text-sm">
                        <thead className="bg-[#f2eadf] text-left text-xs uppercase text-[#6c4f32]">
                          <tr>
                            <th className="px-4 py-3">No.</th>
                            <th className="px-4 py-3">Output product</th>
                            <th className="px-4 py-3">UOM</th>
                            <th className="px-4 py-3">Quantity</th>
                            <th className="px-4 py-3">Size</th>
                            <th className="px-4 py-3">Price</th>
                            <th className="px-4 py-3">Discount %</th>
                            <th className="px-4 py-3">GST %</th>
                            <th className="px-4 py-3">Line total</th>
                            <th className="px-4 py-3">Operation</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedOrder.steps || [])
                            .filter((step) => !step.parent_node_key)
                            .map((step: any, index) => {
                              const qty = Number(step.planned_output_qty || 0);
                              const price = Number(step.unit_price || 0);
                              const discount = Math.max(
                                0,
                                Math.min(
                                  100,
                                  Number(step.discount_percent || 0),
                                ),
                              );
                              const gst = Number(step.tax_percent || 18);
                              const net = qty * price * (1 - discount / 100);
                              const total = net * (1 + gst / 100);
                              return (
                                <tr
                                  key={step.id}
                                  className="border-t border-[#eadcc8]"
                                >
                                  <td className="px-4 py-3">{index + 1}</td>
                                  <td className="px-4 py-3 font-semibold">
                                    {itemLabel(items, step.output_item_id)}
                                  </td>
                                  <td className="px-4 py-3">
                                    {step.output_uom || "NOS"}
                                  </td>
                                  <td className="px-4 py-3">
                                    {fmt(step.planned_output_qty)}
                                  </td>
                                  <td className="px-4 py-3">
                                    {step.output_size || "-"}
                                  </td>
                                  <td className="px-4 py-3">
                                    Rs. {fmtMoney(price)}
                                  </td>
                                  <td className="px-4 py-3">
                                    {fmt(discount)}%
                                  </td>
                                  <td className="px-4 py-3">{fmt(gst)}%</td>
                                  <td className="px-4 py-3 font-semibold">
                                    Rs. {fmtMoney(total)}
                                  </td>
                                  <td className="px-4 py-3">
                                    {step.operation_name || "-"}
                                  </td>
                                  <td className="px-4 py-3">
                                    <StatusBadge value={step.status} />
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {panel === "moc" && selectedOrder && selectedMoc && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 border border-[#dcc9ad] bg-white md:grid-cols-4">
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        MOC number
                      </div>
                      <div className="mt-1 font-bold">
                        {selectedMoc.document_number ||
                          selectedMoc.reference_number ||
                          "-"}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Service order
                      </div>
                      <div className="mt-1 font-bold">
                        {selectedOrder.order_number}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Vendor
                      </div>
                      <div className="mt-1 font-bold">
                        {vendorLabel(
                          vendors,
                          selectedMoc.vendor_id ||
                            selectedOrder.steps?.[0]?.vendor_id,
                        )}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Issue status
                      </div>
                      <div className="mt-1">
                        <StatusBadge
                          value={
                            Number(selectedMoc.remaining_qty || 0) > 0.01
                              ? "IN_PROCESS"
                              : "COMPLETED"
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="border border-[#dcc9ad] bg-white">
                    <div className="border-b border-[#eadcc8] px-4 py-3">
                      <h3 className="font-bold">Issued raw material</h3>
                      <p className="text-xs text-[#7b6753]">
                        This is the single outward material issue linked to the
                        service order.
                      </p>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-[#f2eadf] text-left text-xs uppercase text-[#6c4f32]">
                          <tr>
                            <th className="px-4 py-3">Raw material</th>
                            <th className="px-4 py-3">From warehouse</th>
                            <th className="px-4 py-3">To warehouse</th>
                            <th className="px-4 py-3">Issued KG</th>
                            <th className="px-4 py-3">Remaining KG</th>
                            <th className="px-4 py-3">Issue date</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-[#eadcc8]">
                            <td className="px-4 py-3 font-semibold">
                              {itemLabel(
                                items,
                                selectedMoc.item_id ||
                                  (selectedOrder as any).input_item_id,
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {warehouseLabel(
                                warehouses,
                                selectedMoc.from_warehouse_id,
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {warehouseLabel(
                                warehouses,
                                selectedMoc.to_warehouse_id ||
                                  selectedMoc.warehouse_id,
                              )}
                            </td>
                            <td className="px-4 py-3 font-bold">
                              {fmt(selectedMoc.quantity)}
                            </td>
                            <td className="px-4 py-3">
                              {fmt(selectedMoc.remaining_qty)}
                            </td>
                            <td className="px-4 py-3">
                              {selectedMoc.created_at
                                ? new Date(
                                    selectedMoc.created_at,
                                  ).toLocaleString()
                                : "-"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {selectedMoc.notes && (
                    <div className="border border-[#dcc9ad] bg-[#fbf8f2] px-4 py-3 text-sm">
                      <span className="font-bold">Issue notes: </span>
                      {selectedMoc.notes}
                    </div>
                  )}
                </div>
              )}

              {panel === "trail" && selectedOrder && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 border border-[#dcc9ad] bg-white md:grid-cols-5">
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Order
                      </div>
                      <div className="mt-1 font-bold">
                        {selectedOrder.order_number}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Route
                      </div>
                      <div className="mt-1 font-bold">
                        {selectedOrder.route?.name || "-"}
                      </div>
                    </div>
                    <div className="border-b border-r border-[#eadcc8] px-4 py-3 md:border-b-0">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Status
                      </div>
                      <div className="mt-1">
                        <StatusBadge value={selectedOrder.status} />
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Planned
                      </div>
                      <div className="mt-1 font-bold">
                        {fmt(selectedOrder.planned_input_qty)} in /{" "}
                        {fmt(selectedOrder.planned_output_qty)} out
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs font-bold uppercase text-[#6c4f32]">
                        Remaining raw material
                      </div>
                      <div className="mt-1 font-bold">
                        {fmt(selectedOrder.remaining_raw_material_weight)} KG
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const movements = selectedOrder.movements || [];
                    const issue = movements.find(
                      (movement: any) =>
                        movement.movement_type === "SUBCON_SIV",
                    );
                    const receipt = movements.find(
                      (movement: any) =>
                        movement.movement_type === "SUBCON_SRV",
                    );
                    const pendingQc =
                      receipt &&
                      String(receipt.qc_status || "").toUpperCase() ===
                        "PENDING_QC";
                    const payable = (selectedOrder.steps || []).reduce(
                      (sum, step: any) =>
                        sum + Number(step.payable_amount || 0),
                      0,
                    );
                    const paid = (selectedOrder.steps || []).reduce(
                      (sum, step: any) => sum + Number(step.paid_amount || 0),
                      0,
                    );
                    const stage = (
                      title: string,
                      detail: string,
                      value: string,
                      tone: string,
                    ) => (
                      <div className="border-r border-[#eadcc8] px-4 py-3 last:border-r-0">
                        <div className="text-xs font-bold uppercase text-[#6c4f32]">
                          {title}
                        </div>
                        <div
                          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${tone}`}
                        >
                          {value}
                        </div>
                        <div className="mt-1 text-xs text-[#7b6753]">
                          {detail}
                        </div>
                      </div>
                    );
                    return (
                      <div className="grid grid-cols-1 border border-[#dcc9ad] bg-[#fbf8f2] md:grid-cols-5">
                        {stage(
                          "1. Service order",
                          selectedOrder.order_number,
                          "CREATED",
                          "border-blue-200 bg-blue-50 text-blue-800",
                        )}
                        {stage(
                          "2. Material issue",
                          issue?.document_number || "Awaiting issue",
                          issue ? "ISSUED" : "PENDING",
                          issue
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-amber-200 bg-amber-50 text-amber-900",
                        )}
                        {stage(
                          "3. Receipt / GRN",
                          receipt?.document_number || "Awaiting receipt",
                          receipt ? "POSTED" : "PENDING",
                          receipt
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-amber-200 bg-amber-50 text-amber-900",
                        )}
                        {stage(
                          "4. Quality inspection",
                          !receipt
                            ? "Receipt required first"
                            : pendingQc
                              ? "QC inspection required"
                              : String(receipt.qc_status || "PENDING"),
                          !receipt
                            ? "PENDING"
                            : pendingQc
                              ? "PENDING QC"
                              : "COMPLETE",
                          pendingQc
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : receipt
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-slate-200 bg-slate-50 text-slate-700",
                        )}
                        {stage(
                          "5. Payment",
                          payable > 0
                            ? `Rs. ${fmtMoney(paid)} paid of Rs. ${fmtMoney(payable)}`
                            : "QC approval creates payable",
                          payable > 0 && paid >= payable - 0.01
                            ? "PAID"
                            : payable > 0
                              ? "PAYABLE"
                              : "PENDING",
                          payable > 0 && paid >= payable - 0.01
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : payable > 0
                              ? "border-amber-200 bg-amber-50 text-amber-900"
                              : "border-slate-200 bg-slate-50 text-slate-700",
                        )}
                      </div>
                    );
                  })()}

                  {(() => {
                    const movements = selectedOrder.movements || [];
                    const issue = movements.find(
                      (movement: any) =>
                        movement.movement_type === "SUBCON_SIV",
                    );
                    const receipts = movements.filter(
                      (movement: any) =>
                        movement.movement_type === "SUBCON_SRV",
                    );
                    const processing = receipts.reduce(
                      (sum: number, movement: any) =>
                        sum + Number(movement.processing_amount || 0),
                      0,
                    );
                    const freight = receipts.reduce(
                      (sum: number, movement: any) =>
                        sum + Number(movement.freight_amount || 0),
                      0,
                    );
                    const otherCharges = receipts.reduce(
                      (sum: number, movement: any) =>
                        sum + Number(movement.other_charges_amount || 0),
                      0,
                    );
                    const gst = receipts.reduce(
                      (sum: number, movement: any) =>
                        sum + Number(movement.tax_amount || 0),
                      0,
                    );
                    const deductions = receipts.reduce(
                      (sum: number, movement: any) =>
                        sum + Number(movement.deduction_amount || 0),
                      0,
                    );
                    const payable = receipts.reduce(
                      (sum: number, movement: any) =>
                        sum + Number(movement.payable_amount || 0),
                      0,
                    );
                    const paid = (selectedOrder.steps || []).reduce(
                      (sum: number, step: any) =>
                        sum + Number(step.paid_amount || 0),
                      0,
                    );
                    const inputUom = subcontractOrderInputUom(
                      selectedOrder,
                      items,
                    );
                    const reconciliation = Array.isArray(
                      (selectedOrder as any).reconciliation,
                    )
                      ? (selectedOrder as any).reconciliation[0]
                      : (selectedOrder as any).reconciliation;
                    return (
                      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
                        <div className="border border-[#dcc9ad] bg-white">
                          <div className="border-b border-[#eadcc8] px-4 py-3">
                            <h3 className="font-bold">
                              Raw Material Traceability
                            </h3>
                            <p className="text-xs text-[#7b6753]">
                              Source material and its outward issue to the
                              subcontractor.
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-px bg-[#eadcc8] text-sm">
                            <div className="bg-white px-4 py-3">
                              <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                Raw material
                              </div>
                              <div className="mt-1 font-semibold">
                                {itemLabel(
                                  items,
                                  (selectedOrder as any).input_item_id ||
                                    issue?.item_id,
                                )}
                              </div>
                            </div>
                            <div className="bg-white px-4 py-3">
                              <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                Planned
                              </div>
                              <div className="mt-1 font-semibold">
                                {fmt(selectedOrder.planned_input_qty)}{" "}
                                {inputUom}
                              </div>
                              {Number(selectedOrder.secondary_input_qty || 0) >
                                0 && (
                                <div className="text-xs text-[#7b6753]">
                                  {fmt(selectedOrder.secondary_input_qty)}{" "}
                                  {String(
                                    selectedOrder.secondary_input_uom || "MTR",
                                  ).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="bg-white px-4 py-3">
                              <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                Issued to vendor
                              </div>
                              <div className="mt-1 font-semibold">
                                {issue
                                  ? `${fmt(issue.quantity)} ${inputUom}`
                                  : "Not issued"}
                              </div>
                            </div>
                            <div className="bg-white px-4 py-3">
                              <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                Vendor balance
                              </div>
                              <div className="mt-1 font-semibold">
                                {issue
                                  ? `${fmt(issue.remaining_qty)} ${inputUom}`
                                  : "-"}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="border border-[#dcc9ad] bg-white">
                          <div className="border-b border-[#eadcc8] px-4 py-3">
                            <h3 className="font-bold">Finance Summary</h3>
                            <p className="text-xs text-[#7b6753]">
                              Processing, freight, other charges, GST,
                              deductions, payable and paid.
                            </p>
                          </div>
                          <div className="overflow-auto">
                            <table className="w-full min-w-[650px] text-sm">
                              <thead className="bg-[#f2eadf] text-left text-xs uppercase text-[#6c4f32]">
                                <tr>
                                  <th className="px-4 py-3">Processing</th>
                                  <th className="px-4 py-3">Freight</th>
                                  <th className="px-4 py-3">Other</th>
                                  <th className="px-4 py-3">GST</th>
                                  <th className="px-4 py-3">Deduction</th>
                                  <th className="px-4 py-3">Payable</th>
                                  <th className="px-4 py-3">Paid</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="px-4 py-3">
                                    Rs. {fmtMoney(processing)}
                                  </td>
                                  <td className="px-4 py-3">
                                    Rs. {fmtMoney(freight)}
                                  </td>
                                  <td className="px-4 py-3">
                                    Rs. {fmtMoney(otherCharges)}
                                  </td>
                                  <td className="px-4 py-3">
                                    Rs. {fmtMoney(gst)}
                                  </td>
                                  <td className="px-4 py-3 text-red-700">
                                    Rs. {fmtMoney(deductions)}
                                  </td>
                                  <td className="px-4 py-3 font-bold">
                                    Rs. {fmtMoney(payable)}
                                  </td>
                                  <td className="px-4 py-3">
                                    Rs. {fmtMoney(paid)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          {reconciliation && (
                            <div className="grid grid-cols-2 gap-px border-t bg-[#eadcc8] text-sm md:grid-cols-5">
                              <div className="bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                  Standard service cost
                                </div>
                                <div className="mt-1 font-semibold">
                                  Rs.{" "}
                                  {fmtMoney(
                                    reconciliation.standard_service_cost,
                                  )}
                                </div>
                              </div>
                              <div className="bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                  Actual service cost
                                </div>
                                <div className="mt-1 font-semibold">
                                  Rs.{" "}
                                  {fmtMoney(reconciliation.actual_service_cost)}
                                </div>
                              </div>
                              <div className="bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                  Cost variance
                                </div>
                                <div
                                  className={`mt-1 font-semibold ${Number(reconciliation.service_cost_variance || 0) > 0 ? "text-red-700" : "text-emerald-700"}`}
                                >
                                  Rs.{" "}
                                  {fmtMoney(
                                    reconciliation.service_cost_variance,
                                  )}
                                </div>
                              </div>
                              <div className="bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                  Yield variance
                                </div>
                                <div className="mt-1 font-semibold">
                                  {fmt(reconciliation.yield_variance_quantity)}
                                </div>
                              </div>
                              <div className="bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase text-[#6c4f32]">
                                  Reconciliation
                                </div>
                                <div
                                  className={`mt-1 font-bold ${reconciliation.status === "EXCEPTION" ? "text-red-700" : reconciliation.status === "RECONCILED" ? "text-emerald-700" : "text-amber-700"}`}
                                >
                                  {reconciliation.status}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="border border-[#dcc9ad] bg-white">
                    <div className="border-b border-[#eadcc8] px-4 py-3">
                      <h3 className="font-bold">Service-order output lines</h3>
                      <p className="text-xs text-[#7b6753]">
                        All output products, quantities and commercial terms in
                        this order.
                      </p>
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-[900px] w-full text-sm">
                        <thead className="bg-[#f2eadf] text-left text-xs uppercase text-[#6c4f32]">
                          <tr>
                            <th className="px-4 py-3">No.</th>
                            <th className="px-4 py-3">Output product</th>
                            <th className="px-4 py-3">UOM</th>
                            <th className="px-4 py-3">Qty</th>
                            <th className="px-4 py-3">Size (MM)</th>
                            <th className="px-4 py-3">Price</th>
                            <th className="px-4 py-3">GST</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedOrder.steps || [])
                            .filter((step) => !step.parent_node_key)
                            .map((step: any, index) => (
                              <tr
                                key={step.id}
                                className="border-t border-[#eadcc8]"
                              >
                                <td className="px-4 py-3">{index + 1}</td>
                                <td className="px-4 py-3 font-semibold">
                                  {itemLabel(items, step.output_item_id)}
                                </td>
                                <td className="px-4 py-3">
                                  {step.output_uom || "NOS"}
                                </td>
                                <td className="px-4 py-3">
                                  {fmt(step.planned_output_qty)}
                                </td>
                                <td className="px-4 py-3">
                                  {fmt(step.output_size)}
                                </td>
                                <td className="px-4 py-3">
                                  Rs. {fmtMoney(step.unit_price)}
                                </td>
                                <td className="px-4 py-3">
                                  {fmt(step.tax_percent || 18)}%
                                </td>
                                <td className="px-4 py-3">
                                  <StatusBadge value={step.status} />
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border border-[#dcc9ad] bg-white">
                    <div className="border-b border-[#eadcc8] px-4 py-3">
                      <h3 className="font-bold">
                        Subcontracting Document Flow
                      </h3>
                      <p className="text-xs text-[#7b6753]">
                        {
                          "Work Order -> Material Outward Challan -> Subcontract Receipt -> Service Invoice -> Inventory update -> Final assembly / dispatch."
                        }
                      </p>
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-[1150px] w-full text-sm">
                        <thead className="bg-[#f2eadf] text-left text-xs uppercase text-[#6c4f32]">
                          <tr>
                            <th className="px-4 py-3">Document</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Operation</th>
                            <th className="px-4 py-3">Vendor</th>
                            <th className="px-4 py-3">Qty</th>
                            <th className="px-4 py-3">UOM</th>
                            <th className="px-4 py-3">Accepted</th>
                            <th className="px-4 py-3">Rejected</th>
                            <th className="px-4 py-3">Scrap</th>
                            <th className="px-4 py-3">RM Consumed</th>
                            <th className="px-4 py-3">Unused Return</th>
                            <th className="px-4 py-3">External Ref.</th>
                            <th className="px-4 py-3">Finance</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-[#eadcc8] bg-[#fbf8f2]">
                            <td className="px-4 py-3 font-bold">
                              {selectedOrder.order_number}
                            </td>
                            <td className="px-4 py-3">
                              Subcontract Service Order
                            </td>
                            <td className="px-4 py-3">
                              {selectedOrder.route?.name || "-"}
                            </td>
                            <td className="px-4 py-3">
                              {vendorLabel(
                                vendors,
                                selectedOrder.steps?.[0]?.vendor_id,
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div>{fmt(selectedOrder.planned_input_qty)}</div>
                              {Number(selectedOrder.secondary_input_qty || 0) >
                                0 && (
                                <div>
                                  {fmt(selectedOrder.secondary_input_qty)}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div>
                                {subcontractOrderInputUom(selectedOrder, items)}
                              </div>
                              {Number(selectedOrder.secondary_input_qty || 0) >
                                0 && (
                                <div>
                                  {String(
                                    selectedOrder.secondary_input_uom || "MTR",
                                  ).toUpperCase()}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">-</td>
                            <td className="px-4 py-3">-</td>
                            <td className="px-4 py-3">-</td>
                            <td className="px-4 py-3">-</td>
                            <td className="px-4 py-3">-</td>
                            <td className="px-4 py-3">-</td>
                            <td className="px-4 py-3">
                              <StatusBadge value={selectedOrder.status} />
                            </td>
                          </tr>
                          {(selectedOrder.movements || []).map(
                            (movement: any) => {
                              const step = (selectedOrder.steps || []).find(
                                (row) => row.id === movement.order_step_id,
                              );
                              const inputUom = subcontractOrderInputUom(
                                selectedOrder,
                                items,
                              );
                              const outputUom = step?.output_item_id
                                ? stockItemUom(
                                    items,
                                    step.output_item_id,
                                    step.output_uom,
                                  )
                                : subcontractOrderOutputUom(
                                    selectedOrder,
                                    items,
                                  );
                              const movementUom =
                                movement.movement_type === "SUBCON_SIV"
                                  ? inputUom
                                  : outputUom;
                              const scrapUom = subcontractMovementScrapUom(
                                movement,
                                inputUom,
                                outputUom,
                              );
                              return (
                                <tr
                                  key={movement.id}
                                  className="border-t border-[#eadcc8]"
                                >
                                  <td className="px-4 py-3 font-bold">
                                    {movement.movement_type === "SUBCON_SIV" ? (
                                      <button
                                        type="button"
                                        onClick={() => openMoc(movement)}
                                        className="text-left font-bold text-[#805f35] underline decoration-[#cdb994] underline-offset-2 hover:text-[#4a3426]"
                                        title="View Material Outward Challan"
                                      >
                                        {movement.document_number ||
                                          movement.reference_number ||
                                          "-"}
                                      </button>
                                    ) : (
                                      movement.document_number ||
                                      movement.reference_number ||
                                      "-"
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    {movement.movement_type === "SUBCON_SIV"
                                      ? "Material Outward Challan"
                                      : movement.movement_type === "SUBCON_SRV"
                                        ? "Subcontract GRN"
                                        : movement.movement_type ===
                                            "SUBCON_QC_REWORK"
                                          ? "QC Rework"
                                          : movement.movement_type ===
                                              "SUBCON_QC_SCRAP"
                                            ? "QC Scrap"
                                            : movement.movement_type}
                                  </td>
                                  <td className="px-4 py-3">
                                    {step?.operation_name || "-"}
                                  </td>
                                  <td className="px-4 py-3">
                                    {vendorLabel(
                                      vendors,
                                      movement.vendor_id || step?.vendor_id,
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    {fmt(movement.quantity)}
                                  </td>
                                  <td className="px-4 py-3">{movementUom}</td>
                                  <td className="px-4 py-3">
                                    {fmt(movement.accepted_qty)}
                                  </td>
                                  <td className="px-4 py-3">
                                    {fmt(movement.rejected_qty)}
                                  </td>
                                  <td className="px-4 py-3">
                                    {fmt(movement.scrap_qty)}{" "}
                                    {Number(movement.scrap_qty || 0) > 0
                                      ? scrapUom
                                      : ""}
                                  </td>
                                  <td className="px-4 py-3">
                                    {fmt(movement.consumed_qty)} {inputUom}
                                  </td>
                                  <td className="px-4 py-3">
                                    {fmt(movement.unused_return_qty)}{" "}
                                    {Number(movement.unused_return_qty || 0) > 0
                                      ? inputUom
                                      : ""}
                                  </td>
                                  <td className="px-4 py-3">
                                    {vendorInvoiceAttachmentUrl(
                                      movement.notes,
                                    ) ? (
                                      <a
                                        href={vendorInvoiceAttachmentUrl(
                                          movement.notes,
                                        )}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-semibold text-[#805f35] underline decoration-[#cdb994] underline-offset-2 hover:text-[#4a3426]"
                                      >
                                        View vendor invoice
                                      </a>
                                    ) : (
                                      movement.external_reference || "-"
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    {movement.movement_type === "SUBCON_SRV" &&
                                    movement.qc_status === "PENDING_QC" ? (
                                      <div className="space-y-2">
                                        <StatusBadge value="PENDING_QC" />
                                        <button
                                          onClick={() =>
                                            openReceiptQc(
                                              selectedOrder,
                                              movement,
                                            )
                                          }
                                          className="rounded border border-[#cdb994] px-2 py-1 text-xs font-semibold text-[#5b432c]"
                                        >
                                          QC Inspection
                                        </button>
                                      </div>
                                    ) : Number(movement.payable_amount || 0) >
                                      0 ? (
                                      <div>
                                        <div className="font-bold">
                                          Rs.{" "}
                                          {fmtMoney(movement.payable_amount)}
                                        </div>
                                        <div className="text-xs text-[#7b6753]">
                                          {movement.qc_status || "-"} ·{" "}
                                          {movement.invoice_number ||
                                            "Invoice pending"}
                                        </div>
                                        {vendorInvoiceAttachmentUrl(
                                          movement.notes,
                                        ) && (
                                          <a
                                            href={vendorInvoiceAttachmentUrl(
                                              movement.notes,
                                            )}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-1 inline-block text-xs font-semibold text-[#805f35] underline decoration-[#cdb994] underline-offset-2 hover:text-[#4a3426]"
                                          >
                                            View vendor invoice
                                          </a>
                                        )}
                                      </div>
                                    ) : movement.movement_type ===
                                      "SUBCON_SRV" ? (
                                      <StatusBadge
                                        value={
                                          movement.qc_status || "PENDING_QC"
                                        }
                                      />
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                </tr>
                              );
                            },
                          )}
                          {(selectedOrder.movements || []).length === 0 && (
                            <tr>
                              <td
                                colSpan={13}
                                className="px-4 py-10 text-center text-[#7b6753]"
                              >
                                No outward challan or subcontract receipt posted
                                yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-[#d9c9b1] bg-white px-6 py-4">
              <button
                onClick={closePanel}
                className="rounded border border-[#cdb994] px-5 py-2 font-semibold text-[#5b432c]"
              >
                Cancel
              </button>
              {panel === "route" && (
                <button
                  onClick={saveRoute}
                  className="inline-flex items-center gap-2 rounded bg-[#977447] px-5 py-2 font-semibold text-white"
                >
                  <Save className="h-4 w-4" />{" "}
                  {editingRouteId ? "Update Route" : "Save Route"}
                </button>
              )}
              {panel === "order" && (
                <button
                  onClick={saveOrder}
                  disabled={savingOrder}
                  className="inline-flex items-center gap-2 rounded bg-[#5b432c] px-5 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Factory className="h-4 w-4" />{" "}
                  {savingOrder
                    ? "Saving..."
                    : editingOrderId
                      ? "Update Order"
                      : "Create Order"}
                </button>
              )}
              {panel === "issue" && (
                <button
                  onClick={issueStep}
                  className="inline-flex items-center gap-2 rounded bg-[#5b432c] px-5 py-2 font-semibold text-white"
                >
                  <Truck className="h-4 w-4" /> Post Issue
                </button>
              )}
              {panel === "receive" && (
                <button
                  onClick={receiveStep}
                  className="inline-flex items-center gap-2 rounded bg-[#0f7a4f] px-5 py-2 font-semibold text-white"
                >
                  <PackageCheck className="h-4 w-4" /> Post Receipt
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
