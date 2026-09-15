"use client";

import { useState, useEffect, Suspense, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { apiClient } from "../../../../../lib/api-client";
import {
  buildDocumentBranding,
  renderStandardLetterheadHtml,
} from "@/lib/document-branding";
import {
  hasModulePermission,
  hasScreenPermission,
  readStoredUser,
} from "@/lib/rbac";
import { getTodayDateInputValue } from "@/lib/date";
import DateInput from "../../../../components/ui/DateInput";
import { confirmDialog } from "../../../../components/ui/ConfirmDialog";
import {
  ListTable,
  type ListTableColumn,
} from "../../../../components/ui/ListTable";
import { useEscapeKey } from "../../../../hooks/useEscapeKey";
import {
  ErpButton,
  ErpMetricStrip,
  ErpPageHeader,
  ErpStatusBadge,
} from "../../../../components/ui/ErpPrimitives";
import {
  Download,
  Eye,
  FileText,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  X,
  ChevronDown,
} from "lucide-react";

interface SearchableSelectOption {
  value: string;
  label: string;
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  emptyMessage = "No matches found",
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label || "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      inputRef.current?.focus();
    } else {
      setQuery("");
    }
  }, [open]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-left bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none flex items-center justify-between"
      >
        <span className={selectedLabel ? "text-gray-900" : "text-gray-400"}>
          {selectedLabel || placeholder}
        </span>
        <div className="flex items-center gap-2">
          {value && (
            <span
              onClick={handleClear}
              className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={18} className="text-gray-400" />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-72 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
            <Search size={16} className="text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search PO or vendor..."
              className="flex-1 outline-none text-sm text-gray-900 placeholder-gray-400"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto flex-1 p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">
                {emptyMessage}
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`
                    w-full text-left px-3 py-2 text-sm rounded-md transition-colors
                    ${option.value === value ? "bg-amber-50 text-amber-900" : "text-gray-700 hover:bg-gray-100"}
                  `}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getApiV1BaseUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (!raw) return null;
  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
}

function escapePrintHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface GRN {
  id: string;
  grn_number: string;
  grn_date: string;
  receipt_date?: string;
  invoice_number: string;
  invoice_date: string;
  invoice_file_url?: string;
  invoice_file_name?: string;
  invoice_file_type?: string;
  invoice_file_size?: number;
  additional_invoice_files?: Array<{ url: string; name: string; type: string }>;
  status: string;
  remarks?: string;
  qc_completed?: boolean;
  gross_amount?: number;
  tax_amount?: number;
  gst_percentage?: number;
  freight_amount?: number;
  created_at?: string;
  freight_gst_amount?: number;
  debit_note_amount?: number;
  net_payable_amount?: number;
  sap_controls?: {
    material_document_number?: string;
    fiscal_year?: number;
    inspection_lot_number?: string;
    movement_type?: string;
    movement_text?: string;
    gr_ir_status?: string;
    qc_gate_status?: string;
    three_way_match_status?: string;
    tolerance_status?: string;
    reversal_status?: string;
    stock_posting_policy?: string;
    metadata?: {
      messages?: string[];
      po_amendment_approval?: GrnPoAmendmentApproval;
    };
    items?: Array<{
      grn_item_id?: string;
      item_code?: string;
      movement_type?: string;
      stock_type?: string;
      received_qty?: number;
      accepted_qty?: number;
      rejected_qty?: number;
      qty_variance?: number;
      price_variance_percent?: number;
      tolerance_status?: string;
      metadata?: { messages?: string[] };
    }>;
  } | null;
  vendor: {
    name: string;
    code: string;
  };
  purchase_order: {
    po_number: string;
  };
  warehouse: {
    id?: string;
    name: string;
  };
  grn_items: Array<{
    id?: string;
    item_code?: string;
    item_name?: string;
    item?: { name: string; code: string; hsn_code?: string };
    received_qty?: number;
    accepted_qty?: number;
    rejected_qty?: number;
    received_quantity?: number;
    accepted_quantity?: number;
    rejected_quantity?: number;
    uid?: string;
    batch_number?: string;
    supplier_hsn_code?: string;
    unit_price?: number;
    rejection_amount?: number;
    rejection_reason?: string;
    qc_notes?: string;
    qc_file_url?: string;
    qc_file_name?: string;
    qc_file_type?: string;
    qc_file_size?: number;
    return_status?: string;
    debit_note_id?: string;
  }>;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor: {
    id: string;
    name: string;
    code: string;
  };
  po_date: string;
  status: string;
  purchase_order_items: Array<{
    id: string;
    item_id: string;
    item_code: string;
    item_name: string;
    uom?: string;
    ordered_qty: number;
    quantity?: number;
    remaining_qty?: number;
    received_qty?: number;
    received_quantity?: number;
    rate: number;
    discount_percent?: number;
    item?: {
      hsn_code?: string;
      category?: string;
    };
  }>;
}

function normalizeInventoryCategory(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function isServicePoLine(item: any): boolean {
  const category = normalizeInventoryCategory(
    item?.item?.category || item?.category,
  );
  if (category === "SERVICES" || category === "SERVICE") return true;

  const code = String(
    item?.item_code || item?.itemCode || item?.item?.code || "",
  )
    .trim()
    .toUpperCase();
  if (code.startsWith("SER-") || code.startsWith("SERVICE-")) return true;

  const name = String(
    item?.item_name || item?.itemName || item?.item?.name || "",
  )
    .trim()
    .toUpperCase();
  return (
    /\bSERVICES?\b/.test(name) ||
    /\bTRANSPORTATION\b/.test(name) ||
    /\bFREIGHT\b/.test(name)
  );
}

function getPoLineQuantities(item: any) {
  const ordered =
    Number.parseFloat(
      String(
        item?.ordered_qty ??
          item?.ordered_quantity ??
          item?.quantity ??
          item?.qty ??
          0,
      ),
    ) || 0;
  const received =
    Number.parseFloat(
      String(item?.received_qty ?? item?.received_quantity ?? 0),
    ) || 0;
  const explicitRemaining = item?.remaining_qty ?? item?.remaining_quantity;
  const remaining =
    explicitRemaining === undefined || explicitRemaining === null
      ? Math.max(0, ordered - received)
      : Math.max(0, Number.parseFloat(String(explicitRemaining)) || 0);
  return { ordered, received, remaining };
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  location: string;
}

interface User {
  id: string;
  employee_name: string;
  employee_code?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  permissions?: unknown;
  role?: {
    name?: string;
    permissions?: unknown;
  };
  roles?: Array<{
    role?: {
      name?: string;
      permissions?: unknown;
    };
  }>;
}

type ItemUidConfig = {
  id: string;
  uid_tracking?: boolean;
  uid_strategy?: string;
  batch_uom?: string;
  batch_quantity?: number;
};

type ItemMasterMini = {
  id: string;
  code: string;
  uom?: string;
  name?: string;
  purchase_currency?: string;
  foreign_unit_price?: number;
};

type UIDRecord = {
  uid: string;
  entity_type?: string;
  status?: string;
  batch_number?: string;
  location?: string;
  created_at: string;
  item?: {
    name: string;
    code: string;
  };
};

type PurchaseTrail = {
  uid: string;
  item: {
    code: string;
    name: string;
  };
  supplier?: {
    name: string;
    contact_person?: string;
  };
  purchase_order?: {
    po_number: string;
    order_date: string;
    total_amount: number;
  };
  grn?: {
    grn_number: string;
    received_date?: string;
    receipt_date?: string;
    received_quantity?: number;
    invoice_number?: string;
    invoice_date?: string;
    invoice_file_url?: string;
    invoice_file_name?: string;
    invoice_file_type?: string;
    invoice_file_size?: number;
  };
  lifecycle?: Array<{
    stage: string;
    location: string;
    reference: string;
    timestamp: string;
  }>;
};

type GeneratedUidPrintItem = {
  itemId: string;
  itemCode: string;
  itemName: string;
  acceptedQty: number;
  generatedUids: string[];
};

type InvoiceUploadStatus = {
  state: "idle" | "uploading" | "uploaded" | "selected" | "error";
  message: string;
};

const emptyInvoiceUploadStatus: InvoiceUploadStatus = {
  state: "idle",
  message: "",
};

type GrnPoAmendmentApproval = {
  required?: boolean;
  status?: string;
  requestedAt?: string | null;
  decidedAt?: string | null;
  items?: Array<{
    poItemId?: string;
    itemCode?: string;
    orderedQty?: number;
    previousReceivedQty?: number;
    receivedQty?: number;
    poRate?: number;
    grnRate?: number;
    qtyVariance?: number;
    priceVariancePercent?: number;
    proposedOrderedQty?: number | null;
    proposedRate?: number | null;
    reasons?: string[];
    messages?: string[];
  }>;
};

type GrnDiscrepancyPreview = {
  hasDiscrepancy: boolean;
  messages?: string[];
  poAmendmentApproval?: GrnPoAmendmentApproval;
};

function GRNContent() {
  // const { duplicateState, checkDuplicates, handleProceed, handleCancel } = useDuplicateDetection();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialGrnSearch = searchParams.get("search") || "";
  const viewId = searchParams.get("viewId");
  const returnTo = searchParams.get("returnTo");
  const todayDate = getTodayDateInputValue();
  const currentUser = readStoredUser();
  const canApproveGRN = hasModulePermission(
    currentUser,
    "Inventory",
    "approve",
  );
  const canCreateGRN = hasModulePermission(currentUser, "Inventory", "create");
  const canEditGRN = hasModulePermission(currentUser, "Inventory", "edit");
  const canDeleteGRN = hasModulePermission(currentUser, "Inventory", "delete");
  const [mounted, setMounted] = useState(false);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [grnDiscrepancyPreview, setGrnDiscrepancyPreview] =
    useState<GrnDiscrepancyPreview | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>("grn_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const closeGRNView = () => {
    setShowViewModal(false);
    setSelectedGRN(null);
    setEditMode(false);

    const safeReturnTo =
      returnTo &&
      returnTo.startsWith("/dashboard/") &&
      !returnTo.startsWith("//")
        ? returnTo
        : "";

    if (safeReturnTo) {
      router.push(safeReturnTo);
      return;
    }

    // Clear viewId from URL to prevent reopening
    const params = new URLSearchParams(window.location.search);
    if (params.has("viewId")) {
      params.delete("viewId");
      params.delete("returnTo");
      const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
      window.history.replaceState({}, "", newUrl);
    }
  };
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [showUIDsModal, setShowUIDsModal] = useState(false);
  const [selectedGRNUIDs, setSelectedGRNUIDs] = useState<UIDRecord[]>([]);
  const [loadingUIDs, setLoadingUIDs] = useState(false);
  const [showTrailModal, setShowTrailModal] = useState(false);
  const [purchaseTrail, setPurchaseTrail] = useState<PurchaseTrail | null>(
    null,
  );
  const [loadingTrail, setLoadingTrail] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrdersById, setPurchaseOrdersById] = useState<
    Record<string, PurchaseOrder>
  >({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [itemUidConfigById, setItemUidConfigById] = useState<
    Record<string, ItemUidConfig>
  >({});
  const [itemMasterById, setItemMasterById] = useState<
    Record<string, ItemMasterMini>
  >({});
  const [itemMasterByCode, setItemMasterByCode] = useState<
    Record<string, ItemMasterMini>
  >({});
  const [additionalInvoiceFiles, setAdditionalInvoiceFiles] = useState<
    Array<{ url: string; name: string; type: string }>
  >([]);
  const [additionalUploadStatus, setAdditionalUploadStatus] =
    useState<string>("");
  const [invoiceUploadStatus, setInvoiceUploadStatus] = useState<{
    create: InvoiceUploadStatus;
    edit: InvoiceUploadStatus;
  }>({
    create: emptyInvoiceUploadStatus,
    edit: emptyInvoiceUploadStatus,
  });
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [alertMessage, setAlertMessage] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showQCModal, setShowQCModal] = useState(false);
  const [selectedGRN, setSelectedGRN] = useState<GRN | null>(null);
  const [reverseTargetGRN, setReverseTargetGRN] = useState<GRN | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [qcFormData, setQcFormData] = useState<
    Array<{
      itemId: string;
      itemCode: string;
      itemName: string;
      notes?: string;
      receivedQty: number;
      acceptedQty: number;
      rejectedQty: number;
      qcNotes: string;
      rejectionReason: string;
      qcFiles?: Array<{
        url: string;
        name: string;
        type: string;
        size: number;
      }>;
      // Keep legacy fields for backward compatibility
      qcFileUrl?: string;
      qcFileName?: string;
      qcFileType?: string;
      qcFileSize?: number;
      checked_by?: string;
    }>
  >([]);
  const [qcMetadata, setQcMetadata] = useState<{
    invoiceNumber: string;
    qcDate: string;
    qcBy: string;
  }>({
    invoiceNumber: "",
    qcDate: getTodayDateInputValue(),
    qcBy: "",
  });

  const normalizeEmail = (value: unknown) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const normalizeName = (value: unknown) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const hasQualityInspectionAccess = (user: User) => {
    const actions: Array<"view" | "create" | "edit" | "delete" | "approve"> = [
      "view",
      "create",
      "edit",
      "delete",
      "approve",
    ];
    return actions.some(
      (action) =>
        hasModulePermission(user as any, "Quality Control", action) ||
        hasScreenPermission(user as any, "/dashboard/quality", action),
    );
  };

  const resolveQcUserLabel = (userId: string) => {
    const match = users.find((user) => String(user.id) === String(userId));
    if (match) {
      return `${match.employee_name}${match.employee_code ? ` (${match.employee_code})` : ""}`;
    }

    const fallback = [
      (currentUser as any)?.employee_name,
      [(currentUser as any)?.first_name, (currentUser as any)?.last_name]
        .filter(Boolean)
        .join(" "),
      [(currentUser as any)?.firstName, (currentUser as any)?.lastName]
        .filter(Boolean)
        .join(" "),
    ].find((value) => String(value || "").trim().length > 0);

    return String(fallback || "").trim() || "-";
  };

  const printGeneratedGrnUids = async (payload: {
    grnNumber: string;
    qcDate: string;
    qcBy: string;
    items: GeneratedUidPrintItem[];
  }) => {
    const grnNumber = escapePrintHtml(payload.grnNumber || "-");
    const qcDate = escapePrintHtml(payload.qcDate || "-");
    const qcBy = escapePrintHtml(payload.qcBy || "-");
    const printedAt = escapePrintHtml(new Date().toLocaleString());
    const totalUids = payload.items.reduce(
      (sum, item) => sum + item.generatedUids.length,
      0,
    );
    const qrByUid = new Map<string, string>();

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert(
        "QC completed, but the UID print window was blocked. Please allow pop-ups and try again.",
      );
      return;
    }

    const company = await apiClient
      .get<any>("/tenant/current")
      .catch(() => null);
    const branding = buildDocumentBranding(company);

    await Promise.all(
      payload.items.flatMap((item) =>
        item.generatedUids.map(async (uid) => {
          qrByUid.set(
            uid,
            await QRCode.toDataURL(uid, {
              errorCorrectionLevel: "M",
              margin: 1,
              width: 120,
            }),
          );
        }),
      ),
    );

    const sections = payload.items
      .map((item) => {
        const itemCode = escapePrintHtml(item.itemCode || "-");
        const itemName = escapePrintHtml(item.itemName || "-");
        const acceptedQty = escapePrintHtml(String(item.acceptedQty || 0));
        const cards = item.generatedUids
          .map(
            (uid, index) => `
              <div class="uid-card">
                <div class="uid-card-head">
                  <div>
                    <div class="uid-card-title">UID Label</div>
                    <div class="uid-card-subtitle">${itemCode} | ${itemName}</div>
                  </div>
                  <div class="uid-card-seq">${index + 1}/${item.generatedUids.length}</div>
                </div>
                <div class="uid-card-body">
                  <div class="uid-layout">
                    <div class="uid-copy">
                      <div class="uid-value">${escapePrintHtml(uid)}</div>
                      <div class="uid-meta">GRN: ${grnNumber}</div>
                      <div class="uid-meta">QC Date: ${qcDate}</div>
                    </div>
                    <img class="uid-qr" src="${qrByUid.get(uid) || ""}" alt="QR for ${escapePrintHtml(uid)}" />
                  </div>
                </div>
              </div>
            `,
          )
          .join("");

        const rows = item.generatedUids
          .map(
            (uid, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapePrintHtml(uid)}</td>
                <td>${itemCode}</td>
                <td>${itemName}</td>
                <td>${acceptedQty}</td>
              </tr>
            `,
          )
          .join("");

        return `
          <section class="item-section">
            <div class="item-header">
              <div>
                <div class="item-title">${itemCode}</div>
                <div class="item-subtitle">${itemName}</div>
              </div>
              <div class="item-accepted">Accepted Qty: ${acceptedQty}</div>
            </div>
            <div class="uid-grid">${cards}</div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>UID</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Accepted Qty</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `;
      })
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script>window.onload = window.print</script>
        <title>UID Print - ${grnNumber}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #111827; }
          .letterhead {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #1e3a8a;
            padding-bottom: 12px;
            margin-bottom: 16px;
          }
          .logo-section { display: flex; align-items: center; gap: 12px; }
          .logo-box {
            width: 52px; height: 52px; background: #1e3a8a; color: white;
            display: flex; align-items: center; justify-content: center;
            font-weight: 700; border-radius: 8px;
          }
          .logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; }
          .company-name { font-size: 18px; font-weight: 700; margin: 0; color: #1e3a8a; }
          .company-meta { font-size: 10.5pt; margin: 2px 0 0 0; color: #111; }
          .generated-on { text-align:right; font-size:10.5pt; color:#1e3a8a; line-height:1.5; }
          .generated-on-label { font-weight:700; text-transform:uppercase; letter-spacing:0.06em; }
          .generated-on-value { font-weight:700; color:#111827; }
          .page { max-width: 1100px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
          .title { font-size: 28px; font-weight: 800; margin-top: 6px; }
          .subtitle { margin-top: 6px; color: #4b5563; }
          .meta { display: grid; gap: 6px; text-align: right; font-size: 12px; }
          .summary { margin-top: 20px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
          .summary-card { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; }
          .summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
          .summary-value { margin-top: 6px; font-size: 14px; font-weight: 700; }
          .item-section { margin-top: 28px; page-break-inside: avoid; }
          .item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; }
          .item-title { font-size: 18px; font-weight: 800; }
          .item-subtitle { font-size: 13px; color: #4b5563; margin-top: 4px; }
          .item-accepted { font-size: 13px; font-weight: 700; color: #374151; }
          .uid-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
          .uid-card { border: 1px dashed #9ca3af; border-radius: 12px; padding: 14px; page-break-inside: avoid; }
          .uid-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
          .uid-card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
          .uid-card-subtitle { margin-top: 4px; font-size: 13px; font-weight: 700; }
          .uid-card-seq { font-size: 11px; color: #6b7280; }
          .uid-card-body { margin-top: 18px; }
          .uid-layout { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
          .uid-copy { flex: 1; min-width: 0; }
          .uid-value { font-size: 22px; font-weight: 800; letter-spacing: 0.04em; word-break: break-word; }
          .uid-qr { width: 96px; height: 96px; object-fit: contain; flex-shrink: 0; }
          .uid-meta { margin-top: 6px; font-size: 12px; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; font-size: 12px; }
          th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
          .footer-note { margin-top: 18px; font-size: 11px; color: #6b7280; }
          @media print {
            body { margin: 0; }
            .page { max-width: none; padding: 18px; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          ${renderStandardLetterheadHtml(branding, printedAt)}

          <div class="header">
            <div>
              <div class="title">Generated UID Labels</div>
              <div class="subtitle">Generated at GRN Entry by Stores Incharge</div>
            </div>
            <div class="meta">
              <div><strong>Printed At:</strong> ${printedAt}</div>
              <div><strong>QC By:</strong> ${qcBy}</div>
              <div><strong>Total UIDs:</strong> ${escapePrintHtml(String(totalUids))}</div>
            </div>
          </div>

          <div class="summary">
            <div class="summary-card">
              <div class="summary-label">GRN</div>
              <div class="summary-value">${grnNumber}</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">QC Date</div>
              <div class="summary-value">${qcDate}</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">Items</div>
              <div class="summary-value">${escapePrintHtml(String(payload.items.length))}</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">UID Labels</div>
              <div class="summary-value">${escapePrintHtml(String(totalUids))}</div>
            </div>
          </div>

          ${sections}

          <div class="footer-note">Keep this print with the accepted GRN batch for UID traceability.</div>
        </div>
      </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  };

  const printGRN = async (grn: GRN) => {
    const pw = window.open("", "_blank");
    if (!pw) {
      alert("Popup blocked — please allow popups to print GRN.");
      return;
    }

    try {
      // Fetch full GRN details
      const token = localStorage.getItem("accessToken");
      const res = await fetch(`/api/v1/purchase/grn/${grn.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const full: any = res.ok ? await res.json() : grn;
      const company = await apiClient
        .get<any>("/tenant/current")
        .catch(() => null);
      const branding = buildDocumentBranding(company);
      const _now = new Date();
      const printedAt = `${_now.getDate().toString().padStart(2, "0")}/${(_now.getMonth() + 1).toString().padStart(2, "0")}/${_now.getFullYear()} ${_now.getHours().toString().padStart(2, "0")}:${_now.getMinutes().toString().padStart(2, "0")}`;
      const items: any[] = Array.isArray(full.grn_items) ? full.grn_items : [];

      const rows = items
        .map(
          (it: any, idx: number) => `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${escapePrintHtml(it.item_code || "")}</strong></td>
          <td>${escapePrintHtml(it.item_name || "")}${it.qc_notes ? `<div style="font-size:9px;color:#555;margin-top:2px;font-style:italic">QC: ${escapePrintHtml(it.qc_notes)}</div>` : ""}</td>
          <td style="text-align:center">${it.received_qty ?? "-"}</td>
          <td style="text-align:center">${it.accepted_qty ?? "-"}</td>
          <td style="text-align:center">${it.rejected_qty ?? 0}</td>
          <td style="text-align:right">₹${it.rate ? Number(it.rate).toFixed(2) : "-"}</td>
          <td style="text-align:right">₹${it.amount ? Number(it.amount).toFixed(2) : "-"}</td>
        </tr>`,
        )
        .join("");
      const grnPrintDate =
        full.grn_date ||
        full.receipt_date ||
        full.received_date ||
        grn.grn_date ||
        grn.receipt_date ||
        full.created_at ||
        "";

      const html = `<!DOCTYPE html><html><head>
        <title>GRN - ${escapePrintHtml(full.grn_number || grn.grn_number || "")}</title>
        <script>window.onload = window.print<\/script>
        <style>
          @page { margin: 1cm; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 16px; }
          h2 { text-align:center; font-size:15px; margin:4px 0; }
          .co { text-align:center; font-size:12px; font-weight:bold; color:#1e3a8a; }
          .meta { display:flex; justify-content:space-between; margin:12px 0; font-size:11px; }
          .meta-block { flex:1; }
          .meta-block strong { display:block; font-size:10px; text-transform:uppercase; color:#555; }
          table { width:100%; border-collapse:collapse; margin-top:12px; }
          th { background:#1e3a8a; color:#fff; padding:5px 8px; font-size:10px; text-transform:uppercase; text-align:left; }
          td { padding:4px 8px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
          tr:nth-child(even) td { background:#f9fafb; }
          .footer { margin-top:24px; display:flex; justify-content:space-around; }
          .sig { text-align:center; border-top:1px solid #333; padding-top:6px; min-width:140px; font-size:10px; }
          .title-bar { background:#1e3a8a; color:#fff; text-align:center; padding:6px; font-size:13px; font-weight:bold; margin:10px 0; }
        </style>
      </head><body>
        <div class="co">${escapePrintHtml(branding.companyName)}</div>
        <div class="title-bar">GOODS RECEIPT NOTE</div>
        <div class="meta">
          <div class="meta-block"><strong>GRN No</strong>${escapePrintHtml(full.grn_number || grn.grn_number || "-")}</div>
          <div class="meta-block"><strong>GRN Date</strong>${escapePrintHtml(grnPrintDate ? new Date(grnPrintDate).toLocaleDateString("en-IN") : "-")}</div>
          <div class="meta-block"><strong>PO No</strong>${escapePrintHtml(full.purchase_order?.po_number || "-")}</div>
          <div class="meta-block"><strong>Vendor</strong>${escapePrintHtml(full.vendor?.name || "-")}</div>
        </div>
        <div class="meta">
          <div class="meta-block"><strong>Invoice No</strong>${escapePrintHtml(full.invoice_number || "-")}</div>
          <div class="meta-block"><strong>Invoice Date</strong>${escapePrintHtml(full.invoice_date ? new Date(full.invoice_date).toLocaleDateString("en-IN") : "-")}</div>
          <div class="meta-block"><strong>Warehouse</strong>${escapePrintHtml(full.warehouse?.name || full.warehouse?.code || "-")}</div>
          <div class="meta-block"><strong>Status</strong>${escapePrintHtml(full.status || grn.status || "-")}</div>
        </div>
        <table>
          <thead><tr>
            <th>#</th><th>Item Code</th><th>Item Name</th>
            <th style="text-align:center">Rcvd Qty</th><th style="text-align:center">Acc Qty</th><th style="text-align:center">Rej Qty</th>
            <th style="text-align:right">Rate</th><th style="text-align:right">Amount</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:12px;color:#999">No items</td></tr>'}</tbody>
        </table>
        ${full.remarks ? `<div style="margin-top:12px;font-size:10px;"><strong>Remarks:</strong> ${escapePrintHtml(full.remarks)}</div>` : ""}
        <div class="footer">
          <div class="sig">Stores Incharge</div>
          <div class="sig">QC / Inspector</div>
          <div class="sig">Authorized Signatory</div>
        </div>
        <div style="text-align:right;font-size:9px;color:#9ca3af;margin-top:12px;">Printed: ${escapePrintHtml(printedAt)}</div>
      </body></html>`;

      pw.document.open();
      pw.document.write(html);
      pw.document.close();
      pw.focus();
    } catch (err) {
      console.error("GRN print error:", err);
      try {
        pw.document.open();
        pw.document.write(
          `<html><body style="font-family:Arial;padding:20px"><b>Failed to generate GRN print.</b><br><br>Error: ${String((err as any)?.message || err)}<br><br>Please try again or contact support.</body></html>`,
        );
        pw.document.close();
      } catch {
        /* popup may have been closed */
      }
    }
  };

  const [editMode, setEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState<{
    invoiceNumber: string;
    invoiceDate: string;
    invoiceFileUrl: string;
    invoiceFileName: string;
    invoiceFileType: string;
    invoiceFileSize: number;
    additionalInvoiceFiles: Array<{ url: string; name: string; type: string }>;
    warehouseId: string;
    notes: string;
    items: Array<{
      id?: string;
      itemId?: string;
      poItemId?: string;
      itemCode: string;
      itemName: string;
      uom?: string;
      orderedQuantity?: number;
      receivedQty: number;
      acceptedQty: number;
      rejectedQty: number;
      unitPrice?: number;
      uidCount?: number;
      batchNumber: string;
      expiryDate?: string;
      notes?: string;
    }>;
  }>({
    invoiceNumber: "",
    invoiceDate: "",
    invoiceFileUrl: "",
    invoiceFileName: "",
    invoiceFileType: "",
    invoiceFileSize: 0,
    additionalInvoiceFiles: [],
    warehouseId: "",
    notes: "",
    items: [],
  });

  const [formData, setFormData] = useState({
    poId: "",
    vendorId: "",
    receiptDate: getTodayDateInputValue(),
    invoiceNumber: "",
    invoiceDate: "",
    invoiceFileUrl: "",
    invoiceFileName: "",
    invoiceFileType: "",
    invoiceFileSize: 0,
    warehouseId: "",
    notes: "",
    items: [] as Array<{
      itemId: string;
      itemCode?: string;
      itemName?: string;
      poItemId: string;
      uom?: string;
      orderedQuantity: number;
      previousReceivedQuantity: number;
      receivedQuantity: number;
      acceptedQuantity: number;
      rejectedQuantity: number;
      unitPrice: number;
      purchaseCurrency?: string;
      foreignUnitPrice?: number;
      exchangeRate?: string;
      batchNumber: string;
      expiryDate: string;
      notes: string;
      rejectionReason?: string;
      supplierHsnCode?: string;
      masterHsnCode?: string;
    }>,
  });

  const handleViewInvoice = (
    invoiceFileUrl: string,
    invoiceFileName?: string,
  ) => {
    // Convert base64 data URL to blob and open in new window
    if (invoiceFileUrl.startsWith("data:")) {
      const base64Data = invoiceFileUrl.split(",")[1];
      const mimeType = invoiceFileUrl.split(":")[1].split(";")[0];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const newWindow = window.open(url, "_blank");
      // Clean up the URL after window opens
      if (newWindow) {
        newWindow.onload = () => {
          URL.revokeObjectURL(url);
        };
      }
    } else {
      // Regular URL, open directly
      window.open(invoiceFileUrl, "_blank");
    }
  };

  const handleInvoiceFileSelect = (file: File, target: "create" | "edit") => {
    const validTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "application/pdf",
    ];
    if (!validTypes.includes(file.type)) {
      setAlertMessage({
        type: "error",
        message: "Please upload PNG, JPG, or PDF files only.",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAlertMessage({
        type: "error",
        message: "File size must be less than 10MB.",
      });
      return;
    }

    // Prefer server-side upload (avoids large base64 JSON payloads that can break GRN save)
    const upload = async () => {
      setInvoiceUploadStatus((prev) => ({
        ...prev,
        [target]: { state: "uploading", message: `Uploading ${file.name}...` },
      }));

      try {
        const token = localStorage.getItem("accessToken");
        const fd = new FormData();
        fd.append("file", file);

        const apiBase = getApiV1BaseUrl();
        const uploadUrl = apiBase
          ? `${apiBase}/purchase/grn/invoice/upload`
          : "/api/v1/purchase/grn/invoice/upload";

        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        });

        if (response.ok) {
          const data = await response.json();
          const url = String(data?.url || "").trim();
          if (!url) throw new Error("Upload did not return a URL");

          if (target === "create") {
            setFormData((prev) => ({
              ...prev,
              invoiceFileUrl: url,
              invoiceFileName: String(data?.name || file.name),
              invoiceFileType: String(data?.type || file.type),
              invoiceFileSize: Number(data?.size || file.size) || 0,
            }));
          } else {
            setEditFormData((prev) => ({
              ...prev,
              invoiceFileUrl: url,
              invoiceFileName: String(data?.name || file.name),
              invoiceFileType: String(data?.type || file.type),
              invoiceFileSize: Number(data?.size || file.size) || 0,
            }));
          }

          setInvoiceUploadStatus((prev) => ({
            ...prev,
            [target]: {
              state: "uploaded",
              message: `Uploaded: ${String(data?.name || file.name)}`,
            },
          }));

          return;
        }
      } catch (e) {}

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        if (target === "create") {
          setFormData((prev) => ({
            ...prev,
            invoiceFileUrl: base64,
            invoiceFileName: file.name,
            invoiceFileType: file.type,
            invoiceFileSize: file.size,
          }));
        } else {
          setEditFormData((prev) => ({
            ...prev,
            invoiceFileUrl: base64,
            invoiceFileName: file.name,
            invoiceFileType: file.type,
            invoiceFileSize: file.size,
          }));
        }

        setInvoiceUploadStatus((prev) => ({
          ...prev,
          [target]: {
            state: "selected",
            message: `Selected for save: ${file.name}. Upload will be stored with the GRN.`,
          },
        }));
      };
      reader.onerror = () => {
        setInvoiceUploadStatus((prev) => ({
          ...prev,
          [target]: {
            state: "error",
            message: `Could not attach ${file.name}. Please try again.`,
          },
        }));
      };
      reader.readAsDataURL(file);
    };

    upload();
  };

  const handleQCFileSelect = async (file: File, index: number) => {
    const validTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "application/pdf",
    ];
    if (!validTypes.includes(file.type)) {
      setAlertMessage({
        type: "error",
        message: "Please upload PNG, JPG, or PDF files only.",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAlertMessage({
        type: "error",
        message: "File size must be less than 10MB.",
      });
      return;
    }

    try {
      const token = localStorage.getItem("accessToken");
      const fd = new FormData();
      fd.append("file", file);

      const apiBase = getApiV1BaseUrl();
      const uploadUrl = apiBase
        ? `${apiBase}/purchase/grn/qc/upload`
        : "/api/v1/purchase/grn/qc/upload";

      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: fd,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setAlertMessage({
          type: "error",
          message: `QC upload failed: ${errorData.message || response.statusText}`,
        });
        return;
      }

      const data = await response.json();
      const url = String(data?.url || "").trim();
      if (!url) {
        setAlertMessage({
          type: "error",
          message: "QC upload failed: no URL returned.",
        });
        return;
      }

      const newFile = {
        url: url,
        name: String(data?.name || file.name),
        type: String(data?.type || file.type),
        size: Number(data?.size || file.size) || 0,
      };

      const newData = [...qcFormData];
      const existingFiles = newData[index].qcFiles || [];
      newData[index] = {
        ...newData[index],
        qcFiles: [...existingFiles, newFile],
        // Update legacy fields to point to first file for backward compatibility
        qcFileUrl: existingFiles.length === 0 ? url : newData[index].qcFileUrl,
        qcFileName:
          existingFiles.length === 0 ? newFile.name : newData[index].qcFileName,
        qcFileType:
          existingFiles.length === 0 ? newFile.type : newData[index].qcFileType,
        qcFileSize:
          existingFiles.length === 0 ? newFile.size : newData[index].qcFileSize,
      };
      setQcFormData(newData);
    } catch (e) {
      setAlertMessage({
        type: "error",
        message: "QC upload failed. Please try again.",
      });
    }
  };

  const handleRemoveQCFile = (itemIndex: number, fileIndex: number) => {
    const newData = [...qcFormData];
    const files = newData[itemIndex].qcFiles || [];
    const updatedFiles = files.filter((_, idx) => idx !== fileIndex);

    newData[itemIndex] = {
      ...newData[itemIndex],
      qcFiles: updatedFiles,
      // Update legacy fields to point to first file
      qcFileUrl: updatedFiles.length > 0 ? updatedFiles[0].url : "",
      qcFileName: updatedFiles.length > 0 ? updatedFiles[0].name : "",
      qcFileType: updatedFiles.length > 0 ? updatedFiles[0].type : "",
      qcFileSize: updatedFiles.length > 0 ? updatedFiles[0].size : 0,
    };
    setQcFormData(newData);
  };

  // Close modals on Escape key
  useEscapeKey(showModal, () => setShowModal(false));
  useEscapeKey(showViewModal, closeGRNView);
  useEscapeKey(showUIDsModal, () => setShowUIDsModal(false));
  useEscapeKey(showTrailModal, () => setShowTrailModal(false));
  useEscapeKey(showQCModal, () => setShowQCModal(false));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetchGRNs();
    fetchPurchaseOrders();
    fetchWarehouses();
    fetchUsers();
  }, [filterStatus]);

  // Auto-open GRN details if viewId is in URL (from Action Required links)
  // Note: showViewModal is NOT in deps to prevent reopening when closing modal
  useEffect(() => {
    if (viewId && !showViewModal && grns.length > 0) {
      // Find GRN in already loaded data or fetch it
      const grnFromList = grns.find((g) => g.id === viewId);
      if (grnFromList) {
        // Fetch full GRN details with items
        const fetchAndViewGRN = async () => {
          try {
            const token = localStorage.getItem("accessToken");
            const response = await fetch(`/api/v1/purchase/grn/${viewId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const detailedGRN = await response.json();
            setSelectedGRN(detailedGRN);
          } catch {
            setSelectedGRN(grnFromList); // Fallback to list data
          }
          setShowViewModal(true);
          setEditMode(false);
        };
        fetchAndViewGRN();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, grns]); // Intentionally excluding showViewModal to prevent reopen loop

  useEffect(() => {
    // Used to show container/drum breakdown while entering GRN qty in base UOM.
    const fetchItemUidConfig = async () => {
      try {
        const token = localStorage.getItem("accessToken");
        const response = await fetch(
          "/api/v1/inventory/items?includeInactive=true",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        const items = Array.isArray(data) ? data : [];
        const next: Record<string, ItemUidConfig> = {};
        const nextMasterById: Record<string, ItemMasterMini> = {};
        const nextMasterByCode: Record<string, ItemMasterMini> = {};
        for (const it of items) {
          if (!it?.id) continue;
          const id = String(it.id);
          next[id] = {
            id: String(it.id),
            uid_tracking: it.uid_tracking,
            uid_strategy: it.uid_strategy,
            batch_uom: it.batch_uom,
            batch_quantity:
              typeof it.batch_quantity === "number"
                ? it.batch_quantity
                : Number(it.batch_quantity) || undefined,
          };

          const code = String(it.code || "").trim();
          const normalizedCode = code.toUpperCase();
          const mini: ItemMasterMini = {
            id,
            code,
            uom: it.uom ? String(it.uom) : undefined,
            name: it.name ? String(it.name) : undefined,
            purchase_currency: it.purchase_currency
              ? String(it.purchase_currency)
              : undefined,
            foreign_unit_price:
              it.foreign_unit_price != null
                ? Number(it.foreign_unit_price)
                : undefined,
          };
          nextMasterById[id] = mini;
          if (normalizedCode) nextMasterByCode[normalizedCode] = mini;
        }
        setItemUidConfigById(next);
        setItemMasterById(nextMasterById);
        setItemMasterByCode(nextMasterByCode);
      } catch {
        // Best-effort UI enhancement only.
      }
    };

    fetchItemUidConfig();
  }, []);

  const resolveUom = (
    row:
      | { uom?: string; itemId?: string; itemCode?: string }
      | null
      | undefined,
  ): string => {
    if (!row) return "";
    const direct = String(row.uom || "").trim();
    if (direct) return direct;
    const itemId = String(row.itemId || "").trim();
    const itemCode = String(row.itemCode || "").trim();
    const normalizedCode = itemCode.toUpperCase();
    const fromId = itemId
      ? String(itemMasterById[itemId]?.uom || "").trim()
      : "";
    if (fromId) return fromId;
    const fromCode = normalizedCode
      ? String(itemMasterByCode[normalizedCode]?.uom || "").trim()
      : "";
    return fromCode;
  };

  const resolveItemIdFromCode = (itemCode: string): string => {
    const code = String(itemCode || "").trim();
    if (!code) return "";
    return String(itemMasterByCode[code.toUpperCase()]?.id || "").trim();
  };

  const resolvePOFromGRN = (grnLike: any): PurchaseOrder | null => {
    const poId = String(
      grnLike?.po_id ||
        grnLike?.poId ||
        grnLike?.purchase_order_id ||
        grnLike?.purchaseOrderId ||
        grnLike?.purchase_order?.id ||
        "",
    ).trim();
    if (poId && purchaseOrdersById[poId]) return purchaseOrdersById[poId];

    const poNumber = String(
      grnLike?.purchase_order?.po_number ||
        grnLike?.purchase_order?.poNumber ||
        grnLike?.po_number ||
        "",
    ).trim();
    if (!poNumber) return null;
    const all = Object.values(purchaseOrdersById);
    return (
      all.find((po) => String(po?.po_number || "").trim() === poNumber) || null
    );
  };

  const resolvePOItemId = (
    po: PurchaseOrder | null,
    itemCode: string,
    itemId: string,
  ): string => {
    if (!po) return "";
    const code = String(itemCode || "").trim();
    const normalizedCode = code.toUpperCase();
    const id = String(itemId || "").trim();
    const lines = Array.isArray(po.purchase_order_items)
      ? po.purchase_order_items
      : [];
    const match =
      lines.find(
        (l) =>
          String(l.item_id || "").trim() === id &&
          String(l.item_code || "")
            .trim()
            .toUpperCase() === normalizedCode,
      ) ||
      lines.find((l) => String(l.item_id || "").trim() === id) ||
      lines.find(
        (l) =>
          String(l.item_code || "")
            .trim()
            .toUpperCase() === normalizedCode,
      );
    return String(match?.id || "").trim();
  };

  const ensurePurchaseOrderHydrated = async (
    grnLike: any,
  ): Promise<PurchaseOrder | null> => {
    const poId = String(
      grnLike?.po_id ||
        grnLike?.poId ||
        grnLike?.purchase_order_id ||
        grnLike?.purchaseOrderId ||
        grnLike?.purchase_order?.id ||
        "",
    ).trim();

    const existing = poId ? purchaseOrdersById[poId] : null;
    const existingLines = Array.isArray((existing as any)?.purchase_order_items)
      ? (existing as any).purchase_order_items
      : [];
    if (existing && existingLines.length > 0) return existing;

    if (!poId) {
      // Fall back to whatever we can resolve from PO number.
      return resolvePOFromGRN(grnLike);
    }

    try {
      const token = localStorage.getItem("accessToken");
      const resp = await fetch(`/api/v1/purchase/orders/${poId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!resp.ok) return existing;
      const full = await resp.json();
      if (full?.id) {
        setPurchaseOrdersById((prev) => ({ ...prev, [String(full.id)]: full }));
      }
      return full || existing;
    } catch {
      return existing;
    }
  };

  const backfillEditItems = (itemsIn: any[], grnLike: any): any[] => {
    const po = resolvePOFromGRN(grnLike);
    const poLines = Array.isArray(po?.purchase_order_items)
      ? po!.purchase_order_items
      : [];

    return (Array.isArray(itemsIn) ? itemsIn : []).map((row: any) => {
      const itemCode = String(
        row?.itemCode || row?.item_code || row?.item?.code || "",
      ).trim();
      const normalizedCode = itemCode.toUpperCase();
      const currentItemId = String(
        row?.itemId || row?.item_id || row?.item?.id || "",
      ).trim();

      const itemIdFromPO =
        (normalizedCode
          ? poLines.find(
              (l) =>
                String(l.item_code || "")
                  .trim()
                  .toUpperCase() === normalizedCode,
            )?.item_id
          : "") || "";
      const resolvedItemId =
        currentItemId ||
        String(itemIdFromPO || "").trim() ||
        resolveItemIdFromCode(itemCode);

      const currentPoItemId = String(
        row?.poItemId || row?.po_item_id || "",
      ).trim();
      const resolvedPoItemId =
        currentPoItemId || resolvePOItemId(po, itemCode, resolvedItemId);

      const uomFromPO =
        (normalizedCode
          ? poLines.find(
              (l) =>
                String(l.item_code || "")
                  .trim()
                  .toUpperCase() === normalizedCode,
            )?.uom
          : "") || "";
      const resolvedUom =
        String(row?.uom || "").trim() ||
        String(uomFromPO || "").trim() ||
        resolveUom({ uom: row?.uom, itemId: resolvedItemId, itemCode });

      // Restore rate from PO item if GRN item rate is 0/missing
      const poLineForRate = normalizedCode
        ? poLines.find(
            (l) =>
              String(l.item_code || "")
                .trim()
                .toUpperCase() === normalizedCode,
          )
        : null;
      const resolvedUnitPrice =
        Number(row?.unitPrice) || Number(poLineForRate?.rate) || 0;

      return {
        ...row,
        itemId: resolvedItemId,
        poItemId: resolvedPoItemId,
        itemCode,
        uom: resolvedUom,
        unitPrice: resolvedUnitPrice,
      };
    });
  };

  const fetchPurchaseOrders = async () => {
    try {
      const token = localStorage.getItem("accessToken");

      // Fetch only pending receipt POs. Backend allows Approved + Partial and
      // excludes fully received/closed/service-only POs.
      const poResponse = await fetch(
        `/api/v1/purchase/orders?pendingOnly=true&_ts=${Date.now()}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
      );

      if (!poResponse.ok) {
        const errorData = await poResponse.json();
        setPurchaseOrders([]);
        return;
      }

      const allPOs = await poResponse.json();

      const allPOsList = Array.isArray(allPOs) ? allPOs : [];
      const nextById: Record<string, PurchaseOrder> = {};
      for (const po of allPOsList) {
        if (!po?.id) continue;
        nextById[String(po.id)] = po;
      }
      setPurchaseOrdersById(nextById);

      // The API filters pendingOnly, but keep a strict client-side guard so
      // cached/older API responses cannot show completed POs in GRN creation.
      const availablePOs = allPOsList.filter((po: any) => {
        const status = String(po.status || "").toUpperCase();
        if (!["APPROVED", "PARTIAL"].includes(status)) return false;
        if (po.receipt_status === "FULLY_RECEIVED") return false;

        const progress = po.receipt_progress || {};
        const orderedTotal =
          Number.parseFloat(String(progress.ordered_qty ?? 0)) || 0;
        const remainingTotal =
          Number.parseFloat(String(progress.remaining_qty ?? 0)) || 0;
        if (orderedTotal <= 0 || remainingTotal <= 0) return false;

        const items: any[] = po.purchase_order_items || po.po_items || [];
        if (items.length > 0) {
          return items.some((item: any) => {
            const { ordered, remaining } = getPoLineQuantities(item);
            return ordered > 0 && remaining > 0.000001;
          });
        }

        return false;
      });

      setPurchaseOrders(availablePOs);
    } catch (error) {
      setPurchaseOrders([]);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch("/api/v1/inventory/warehouses", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 401) {
        }
        setWarehouses([]);
        return;
      }

      const data = await response.json();
      const warehousesList = Array.isArray(data) ? data : [];
      setWarehouses(warehousesList);

      // Default to "Main" warehouse for Create GRN (do not override if user already selected)
      if (warehousesList.length > 0) {
        const normalize = (v: any) =>
          String(v || "")
            .trim()
            .toLowerCase();
        const main =
          warehousesList.find((w: any) => normalize(w?.code) === "main") ||
          warehousesList.find((w: any) =>
            normalize(w?.name).includes("main"),
          ) ||
          warehousesList[0];
        const mainId = String((main as any)?.id || "").trim();

        if (mainId) {
          setFormData((prev) =>
            prev.warehouseId ? prev : { ...prev, warehouseId: mainId },
          );
          setEditFormData((prev) =>
            prev.warehouseId ? prev : { ...prev, warehouseId: mainId },
          );
        }
      }
    } catch (error) {
      setWarehouses([]);
    }
  };

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const [employeesResponse, usersResponse] = await Promise.all([
        fetch("/api/v1/hr/employees", {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }),
        fetch("/api/v1/users", {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }),
      ]);

      if (!employeesResponse.ok || !usersResponse.ok) {
        setUsers([]);
        return;
      }

      const [employeesData, usersData] = await Promise.all([
        employeesResponse.json(),
        usersResponse.json(),
      ]);
      const employees = Array.isArray(employeesData)
        ? (employeesData as User[])
        : [];
      const usersWithQualityAccess = Array.isArray(usersData)
        ? (usersData as User[]).filter(hasQualityInspectionAccess)
        : [];
      const allowedEmails = new Set(
        usersWithQualityAccess
          .map((user) => normalizeEmail(user.email))
          .filter(Boolean),
      );
      const allowedNames = new Set(
        usersWithQualityAccess
          .map((user) =>
            normalizeName(
              [user.first_name, user.last_name].filter(Boolean).join(" "),
            ),
          )
          .filter(Boolean),
      );

      setUsers(
        employees.filter((employee) => {
          const email = normalizeEmail(employee.email);
          const name = normalizeName(employee.employee_name);
          return (
            (email && allowedEmails.has(email)) ||
            (name && allowedNames.has(name))
          );
        }),
      );
    } catch (error) {
      setUsers([]);
    }
  };

  const handlePOChange = async (poId: string) => {
    const cached = purchaseOrders.find((p) => p.id === poId);
    if (!cached) return;
    setSelectedPO(cached);

    // Always fetch fresh PO from API to get current received_qty (avoids stale cache)
    let po: PurchaseOrder = cached;
    try {
      const token = localStorage.getItem("accessToken");
      const resp = await fetch(
        `/api/v1/purchase/orders/${poId}?_ts=${Date.now()}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
      );
      if (resp.ok) {
        const fresh = await resp.json();
        if (fresh?.id) {
          po = fresh;
          setPurchaseOrdersById((prev) => ({
            ...prev,
            [String(fresh.id)]: fresh,
          }));
        }
      } else {
        setAlertMessage({
          type: "error",
          message:
            "Could not refresh PO balance. Please reload and select the PO again so GRN quantities are not prepared from stale data.",
        });
        return;
      }
    } catch {
      setAlertMessage({
        type: "error",
        message:
          "Could not refresh PO balance. Please reload and select the PO again so GRN quantities are not prepared from stale data.",
      });
      return;
    }

    setSelectedPO(po);
    const materialLines = (
      Array.isArray(po.purchase_order_items) ? po.purchase_order_items : []
    ).filter((item) => {
      if (isServicePoLine(item)) return false;
      // Only show items that still have remaining quantity to receive.
      // This must be line-level balance; never spread PO-level balance across a line.
      const { ordered, remaining } = getPoLineQuantities(item);
      return ordered > 0 && remaining > 0.000001;
    });

    setFormData({
      ...formData,
      poId: po.id,
      vendorId: po.vendor_id,
      items: materialLines.map((item) => {
        const { ordered, received, remaining } = getPoLineQuantities(item);

        return {
          itemId:
            item.item_id ?? (item as any).itemId ?? (item as any).item?.id,
          itemCode: item.item_code,
          itemName: item.item_name,
          poItemId: item.id,
          uom:
            String(item.uom || "").trim() ||
            String(
              itemMasterById[String(item.item_id || "")]?.uom || "",
            ).trim() ||
            String(
              itemMasterByCode[String(item.item_code || "")]?.uom || "",
            ).trim() ||
            "",
          orderedQuantity: ordered,
          previousReceivedQuantity: Math.max(0, received),
          receivedQuantity: remaining, // Default to remaining quantity
          // QC must be explicitly recorded via QC Accept.
          acceptedQuantity: 0,
          rejectedQuantity: 0,
          unitPrice: item.rate,
          purchaseCurrency:
            itemMasterById[String(item.item_id || "")]?.purchase_currency ||
            "INR",
          foreignUnitPrice:
            itemMasterById[String(item.item_id || "")]?.foreign_unit_price,
          exchangeRate: "",
          batchNumber: "",
          expiryDate: "",
          notes: "",
          rejectionReason: "",
          discountPercent: item.discount_percent ?? 0,
          masterHsnCode: item.item?.hsn_code || "",
          supplierHsnCode: item.item?.hsn_code || "",
        };
      }),
    });
  };

  // Once item master data loads, backfill missing UOMs in Create GRN.
  useEffect(() => {
    if (
      Object.keys(itemMasterById).length === 0 &&
      Object.keys(itemMasterByCode).length === 0
    )
      return;
    if (!Array.isArray(formData.items) || formData.items.length === 0) return;

    let changed = false;
    const nextItems = formData.items.map((row) => {
      const uom = resolveUom({
        uom: row.uom,
        itemId: row.itemId,
        itemCode: row.itemCode,
      });
      if (!String(row.uom || "").trim() && uom) {
        changed = true;
        return { ...row, uom };
      }
      return row;
    });

    if (changed) {
      setFormData((prev) => ({ ...prev, items: nextItems }));
    }
  }, [itemMasterById, itemMasterByCode, formData.items]);

  const fetchGRNs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus !== "ALL") params.append("status", filterStatus);
      if (searchTerm) params.append("search", searchTerm);

      const data = await apiClient.get(`/purchase/grn?${params}`);
      setGrns(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateGRN = async () => {
    if (!selectedGRN) return;

    if (!editFormData.invoiceNumber || !editFormData.invoiceNumber.trim()) {
      setAlertMessage({
        type: "error",
        message: "Invoice Number is required.",
      });
      return;
    }

    if (!editFormData.invoiceDate) {
      setAlertMessage({ type: "error", message: "Invoice Date is required." });
      return;
    }

    if (!editFormData.invoiceFileUrl) {
      setAlertMessage({
        type: "error",
        message: "Vendor invoice upload is required.",
      });
      return;
    }

    try {
      // Ensure we have PO line items available for resolving poItemId.
      const hydratedPO = await ensurePurchaseOrderHydrated(selectedGRN);
      const patchedItems = backfillEditItems(
        editFormData.items as any[],
        hydratedPO && hydratedPO.id
          ? { ...selectedGRN, po_id: hydratedPO.id }
          : selectedGRN,
      );
      const missing = patchedItems.filter(
        (it: any) =>
          !String(it.itemId || "").trim() || !String(it.poItemId || "").trim(),
      );
      if (missing.length > 0) {
        const codes = missing
          .map((it: any) => String(it.itemCode || "").trim())
          .filter(Boolean)
          .join(", ");
        setAlertMessage({
          type: "error",
          message: codes
            ? `Some GRN items are missing Item/PO Item IDs: ${codes}. Please re-open Edit or contact support.`
            : "Some GRN items are missing Item/PO Item IDs. Please re-open Edit or contact support.",
        });
        return;
      }

      // Keep UI state in sync so the user doesn't hit the same validation again.
      setEditFormData((prev) => ({ ...prev, items: patchedItems as any }));

      await apiClient.put(`/purchase/grn/${selectedGRN.id}`, {
        invoiceNumber: editFormData.invoiceNumber,
        invoiceDate: editFormData.invoiceDate,
        invoiceFileUrl: editFormData.invoiceFileUrl || null,
        invoiceFileName: editFormData.invoiceFileName || null,
        invoiceFileType: editFormData.invoiceFileType || null,
        invoiceFileSize: editFormData.invoiceFileSize || null,
        additionalInvoiceFiles:
          editFormData.additionalInvoiceFiles.length > 0
            ? editFormData.additionalInvoiceFiles
            : undefined,
        warehouseId: editFormData.warehouseId,
        remarks: editFormData.notes,
        items: (patchedItems as any[]).map((item: any) => ({
          itemId: item.itemId,
          poItemId: item.poItemId,
          itemCode: item.itemCode,
          itemName: item.itemName,
          orderedQuantity: item.orderedQuantity ?? item.receivedQty,
          receivedQuantity: item.receivedQty,
          acceptedQuantity: item.acceptedQty,
          rejectedQuantity: item.rejectedQty,
          unitPrice: item.unitPrice ?? 0,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate || null,
          notes: item.notes || null,
        })),
      });

      setAlertMessage({
        type: "success",
        message: "GRN updated successfully!",
      });
      setShowViewModal(false);
      setEditMode(false);
      fetchGRNs();
    } catch (error: any) {
      setAlertMessage({
        type: "error",
        message: error?.message || "Failed to update GRN. Please try again.",
      });
    }
  };

  const handleDownloadInvoice = async (
    invoiceFileUrl: string,
    invoiceFileName?: string,
  ) => {
    try {
      const response = await fetch(invoiceFileUrl, { credentials: "include" });
      if (!response.ok) {
        throw new Error(
          `Invoice file could not be downloaded (HTTP ${response.status}).`,
        );
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const fallbackName = decodeURIComponent(
        invoiceFileUrl.split("/").pop() || "vendor-invoice",
      );
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = invoiceFileName?.trim() || fallbackName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error: any) {
      setAlertMessage({
        type: "error",
        message:
          error?.message ||
          "Invoice file could not be downloaded. Please try again.",
      });
    }
  };

  const openReverseGRNDialog = (grn: GRN) => {
    setReverseTargetGRN(grn);
    setReverseReason("");
  };

  const handleReverseGRN = async () => {
    const grn = reverseTargetGRN;
    const reason = reverseReason.trim();
    if (!grn) return;
    if (!reason) {
      setAlertMessage({
        type: "error",
        message: "GRN reversal reason is required.",
      });
      return;
    }
    try {
      setSubmitting(true);
      await apiClient.post(`/purchase/grn/${grn.id}/reverse`, { reason });
      const refreshed = await apiClient.get<GRN>(`/purchase/grn/${grn.id}`);
      setSelectedGRN(refreshed);
      setReverseTargetGRN(null);
      setReverseReason("");
      setAlertMessage({
        type: "success",
        message: "GRN reversed successfully.",
      });
      fetchGRNs();
    } catch (error: any) {
      setAlertMessage({
        type: "error",
        message:
          error?.message ||
          "Failed to reverse GRN. Please check stock/AP status and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePoAmendmentDecision = async (decision: "approve" | "reject") => {
    if (!selectedGRN) return;
    const label =
      decision === "approve"
        ? "approve and update the PO"
        : "reject this PO amendment";
    const confirmed = await confirmDialog({
      title:
        decision === "approve"
          ? "Approve PO amendment?"
          : "Reject PO amendment?",
      message: `Are you sure you want to ${label}?`,
      confirmLabel:
        decision === "approve" ? "Approve amendment" : "Reject amendment",
      variant: decision === "approve" ? "info" : "warning",
    });
    if (!confirmed) return;

    try {
      setSubmitting(true);
      const updated = await apiClient.post<GRN>(
        `/purchase/grn/${selectedGRN.id}/po-amendment/${decision}`,
        {},
      );
      setSelectedGRN(updated);
      setAlertMessage({
        type: "success",
        message:
          decision === "approve"
            ? "PO amendment approved and PO updated."
            : "PO amendment rejected. PO remains unchanged.",
      });
      fetchGRNs();
      fetchPurchaseOrders();
    } catch (error: any) {
      setAlertMessage({
        type: "error",
        message: error?.message || "Failed to update PO amendment approval.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const buildCreateGrnPayload = () => ({
    poId: formData.poId,
    vendorId: formData.vendorId,
    grnDate: formData.receiptDate,
    invoiceNumber: formData.invoiceNumber || null,
    invoiceDate: formData.invoiceDate || null,
    invoiceFileUrl: formData.invoiceFileUrl || null,
    invoiceFileName: formData.invoiceFileName || null,
    invoiceFileType: formData.invoiceFileType || null,
    invoiceFileSize: formData.invoiceFileSize || null,
    additionalInvoiceFiles:
      additionalInvoiceFiles.length > 0 ? additionalInvoiceFiles : undefined,
    warehouseId: formData.warehouseId,
    remarks: formData.notes || null,
    status: "DRAFT",
    items: formData.items.map((item) => ({
      itemId: item.itemId,
      poItemId: item.poItemId,
      itemCode: item.itemCode,
      itemName: item.itemName,
      orderedQty: item.orderedQuantity,
      receivedQty: item.receivedQuantity,
      acceptedQty: item.acceptedQuantity,
      rejectedQty: item.rejectedQuantity,
      rejectionReason: item.rejectionReason || null,
      rate: item.unitPrice,
      discountPercent: (item as any).discountPercent ?? 0,
      batchNumber: item.batchNumber || null,
      expiryDate: item.expiryDate || null,
      remarks: item.notes || null,
      supplierHsnCode: item.supplierHsnCode || null,
    })),
  });

  const actuallyCreateGRN = async () => {
    if (submitting) return; // Prevent double submission

    try {
      // Validate required fields
      if (!formData.poId) {
        setAlertMessage({
          type: "error",
          message: "Please select a Purchase Order.",
        });
        return;
      }

      if (formData.items.length === 0) {
        setAlertMessage({
          type: "error",
          message: "No material items are available to receive for this PO.",
        });
        return;
      }

      if (!formData.invoiceFileUrl) {
        setAlertMessage({
          type: "error",
          message: "Vendor invoice upload is required.",
        });
        return;
      }

      setSubmitting(true);

      const payload = buildCreateGrnPayload();

      // Update item HSN codes if different from master
      const token = localStorage.getItem("accessToken");
      for (const item of formData.items) {
        if (
          item.supplierHsnCode &&
          item.supplierHsnCode !== item.masterHsnCode
        ) {
          try {
            await fetch(`/api/v1/inventory/items/${item.itemId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ hsn_code: item.supplierHsnCode }),
            });
          } catch (err) {}
        }
      }

      const response = await fetch("/api/v1/purchase/grn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        setAlertMessage({
          type: "success",
          message: "GRN created successfully! Fetching UID labels…",
        });
        setShowModal(false);
        fetchGRNs();
        fetchPurchaseOrders();
        resetForm();

        // Point 21: Auto-print UID labels immediately after GRN creation
        // UIDs are generated at GRN create time by Stores Incharge
        if (data?.id) {
          try {
            const uidToken = localStorage.getItem("accessToken");
            const uidResponse = await fetch(
              `/api/v1/purchase/grn/${data.id}/uids`,
              {
                headers: {
                  Authorization: `Bearer ${uidToken}`,
                  "Content-Type": "application/json",
                },
              },
            );
            if (uidResponse.ok) {
              const uids: any[] = await uidResponse.json();
              if (Array.isArray(uids) && uids.length > 0) {
                // Group UIDs by item_code (from metadata)
                const byItem = new Map<string, GeneratedUidPrintItem>();
                for (const u of uids) {
                  let meta: Record<string, string> = {};
                  try {
                    meta = JSON.parse(u.metadata || "{}");
                  } catch {
                    /* */
                  }
                  const itemCode = meta.item_code || u.item_code || "";
                  const key = itemCode || u.entity_id || "unknown";
                  if (!byItem.has(key)) {
                    byItem.set(key, {
                      itemId: key,
                      itemCode,
                      itemName: meta.item_name || u.item_name || "",
                      acceptedQty: 0,
                      generatedUids: [],
                    });
                  }
                  const entry = byItem.get(key)!;
                  entry.generatedUids.push(u.uid);
                  entry.acceptedQty = entry.generatedUids.length;
                }
                await printGeneratedGrnUids({
                  grnNumber: data.grn_number || "",
                  qcDate: new Date().toLocaleDateString(),
                  qcBy: "Stores Incharge",
                  items: Array.from(byItem.values()),
                });
                setAlertMessage({
                  type: "success",
                  message: `GRN created! ${uids.length} UID label(s) sent to print.`,
                });
              } else {
                setAlertMessage({
                  type: "success",
                  message:
                    "GRN created successfully! (No UIDs generated — items may not have UID tracking enabled.)",
                });
              }
            }
          } catch {
            // UID print failure should not block GRN success
          }
        }
      } else {
        const errorData = await response.json();
        setAlertMessage({
          type: "error",
          message: `Failed to create GRN: ${errorData.message || "Unknown error"}`,
        });
      }
    } catch (error) {
      setAlertMessage({
        type: "error",
        message: "Failed to create GRN. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateGRN = async () => {
    if (submitting) return;
    // Lock immediately, including during the discrepancy preview. Previously
    // the button stayed live until the final POST, allowing two quick clicks
    // (or two requests) to pass the browser-only duplicate check.
    setSubmitting(true);
    try {
      // Validate required fields first
      if (!formData.poId) {
        setAlertMessage({
          type: "error",
          message: "Please select a Purchase Order.",
        });
        return;
      }

      if (!formData.invoiceNumber || !formData.invoiceNumber.trim()) {
        setAlertMessage({
          type: "error",
          message: "Invoice Number is required.",
        });
        return;
      }

      if (!formData.invoiceDate) {
        setAlertMessage({
          type: "error",
          message: "Invoice Date is required.",
        });
        return;
      }

      if (!formData.invoiceFileUrl) {
        setAlertMessage({
          type: "error",
          message: "Vendor invoice upload is required.",
        });
        return;
      }

      if (formData.items.length === 0) {
        setAlertMessage({
          type: "error",
          message: "No material items are available to receive for this PO.",
        });
        return;
      }

      // DUPLICATE DETECTION: Check if GRN already exists for this Invoice + PO combination
      const existingGRN = grns.find(
        (g) =>
          g.invoice_number?.toLowerCase().trim() ===
            formData.invoiceNumber?.toLowerCase().trim() &&
          g.purchase_order?.po_number ===
            purchaseOrders.find((po) => po.id === formData.poId)?.po_number,
      );

      if (existingGRN) {
        setAlertMessage({
          type: "error",
          message: `GRN already exists for this Invoice (${formData.invoiceNumber}) and PO combination.\n\nExisting GRN: ${existingGRN.grn_number}\nCreated: ${existingGRN.created_at ? new Date(existingGRN.created_at).toLocaleString("en-IN") : "N/A"}\n\nPlease check the GRN list or use a different invoice number.`,
        });
        return;
      }

      try {
        const token = localStorage.getItem("accessToken");
        const response = await fetch(
          "/api/v1/purchase/grn/discrepancy-preview",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(buildCreateGrnPayload()),
          },
        );
        if (response.ok) {
          const preview = await response.json();
          if (preview?.hasDiscrepancy) {
            setSubmitting(false);
            setGrnDiscrepancyPreview(preview);
            return;
          }
        }
      } catch {
        // Preview failure should not block GRN creation; backend still records controls after save.
      }

      await actuallyCreateGRN();
    } finally {
      // actuallyCreateGRN also releases this state. Keeping this here covers
      // validation and preview failures before the final create request starts.
      setSubmitting(false);
    }
  };

  const fetchGRNUIDs = async (grnId: string) => {
    try {
      setLoadingUIDs(true);
      setSelectedGRNUIDs([]);
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`/api/v1/purchase/grn/${grnId}/uids`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        const uidsArray = Array.isArray(data) ? data : [];

        if (uidsArray.length === 0) {
          setAlertMessage({
            type: "info",
            message:
              "No UIDs found. UIDs are generated when GRN status is COMPLETED. Please ensure the GRN is completed first.",
          });
        } else {
          setSelectedGRNUIDs(uidsArray);
          setShowUIDsModal(true);
        }
      } else {
        const errorData = await response.json();
        setAlertMessage({
          type: "error",
          message: `Failed to fetch UIDs: ${errorData.message || "Unknown error"}. UIDs are auto-generated when GRN status is COMPLETED.`,
        });
      }
    } catch (error) {
      setAlertMessage({
        type: "error",
        message: "Failed to fetch UIDs. Please check your connection.",
      });
    } finally {
      setLoadingUIDs(false);
    }
  };

  const generateMissingUIDs = async (grnId: string, grnItemId: string) => {
    try {
      setAlertMessage({ type: "info", message: "Generating missing UIDs..." });
      const token = localStorage.getItem("accessToken");
      const url = `/api/v1/purchase/grn/${grnId}/items/${grnItemId}/generate-missing-uids`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const responseData = await response.json();

      if (response.ok) {
        setAlertMessage({
          type: "success",
          message:
            responseData.message ||
            `Generated ${responseData.generated} additional UID(s)`,
        });
        // Refresh GRN data to show updated counts
        fetchGRNs();
        // Refresh selected GRN if viewing
        if (selectedGRN?.id === grnId) {
          const refreshResponse = await fetch(`/api/v1/purchase/grn/${grnId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (refreshResponse.ok) {
            setSelectedGRN(await refreshResponse.json());
          }
        }
      } else {
        setAlertMessage({
          type: "error",
          message: responseData.message || "Failed to generate missing UIDs",
        });
      }
    } catch (error) {
      setAlertMessage({
        type: "error",
        message: "Failed to generate missing UIDs",
      });
    }
  };

  const fetchPurchaseTrail = async (uid: string) => {
    try {
      setLoadingTrail(true);
      const token = localStorage.getItem("accessToken");

      const response = await fetch(`/api/v1/uid/${uid}/purchase-trail`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setPurchaseTrail(data);
        setShowTrailModal(true);
      } else {
        setAlertMessage({
          type: "error",
          message: "Purchase trail not found for this UID.",
        });
      }
    } catch (error) {
      setAlertMessage({
        type: "error",
        message: "Failed to fetch purchase trail.",
      });
    } finally {
      setLoadingTrail(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateOnly = (dateString?: string) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
  };

  const getGrnReceiptDate = (grn: GRN | null | undefined) =>
    grn?.receipt_date || grn?.grn_date || "";

  const renderInvoiceUploadStatus = (status: InvoiceUploadStatus) => {
    if (status.state === "idle" || !status.message) return null;

    const className =
      status.state === "uploaded"
        ? "text-green-700 bg-green-50 border-green-200"
        : status.state === "uploading"
          ? "text-blue-700 bg-blue-50 border-blue-200"
          : status.state === "error"
            ? "text-red-700 bg-red-50 border-red-200"
            : "text-amber-700 bg-amber-50 border-amber-200";

    return (
      <div className={`text-xs mt-2 border rounded px-2 py-1 ${className}`}>
        {status.message}
      </div>
    );
  };

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        {
          itemId: "",
          poItemId: "",
          orderedQuantity: 0,
          previousReceivedQuantity: 0,
          receivedQuantity: 0,
          acceptedQuantity: 0,
          rejectedQuantity: 0,
          unitPrice: 0,
          batchNumber: "",
          expiryDate: "",
          notes: "",
          rejectionReason: "",
        },
      ],
    });
  };

  const handleUpdateItem = (index: number, field: string, value: any) => {
    const updatedItems = [...formData.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };

    const toNum = (v: any) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    // Auto-calculate INR rate from foreign price × exchange rate
    if (field === "exchangeRate") {
      const rate = parseFloat(String(value)) || 0;
      const foreignPrice = Number(updatedItems[index].foreignUnitPrice) || 0;
      if (rate > 0 && foreignPrice > 0) {
        updatedItems[index].unitPrice = parseFloat(
          (foreignPrice * rate).toFixed(4),
        );
      }
    }

    // Auto-calculate accepted/rejected based on received
    if (field === "receivedQuantity") {
      const received = Math.max(0, toNum(value));
      updatedItems[index].receivedQuantity = received;
      updatedItems[index].acceptedQuantity = received;
      updatedItems[index].rejectedQuantity = 0;
    }

    if (field === "acceptedQuantity" || field === "rejectedQuantity") {
      const item = updatedItems[index];
      if (field === "acceptedQuantity") {
        let received = Math.max(0, toNum(item.receivedQuantity));
        const ordered = Math.max(0, toNum(item.orderedQuantity));
        const prevReceived = Math.max(0, toNum(item.previousReceivedQuantity));
        const maxReceivable = Math.max(0, ordered - prevReceived);
        const acceptedRaw = Math.max(0, toNum(value));

        // UX: if user edits Accepted and hasn't explicitly adjusted Received,
        // assume full remaining receipt (Received = Remaining) so Rejected auto-fills.
        if (
          maxReceivable > 0 &&
          (received === 0 ||
            (received === acceptedRaw && maxReceivable > received))
        ) {
          received = maxReceivable;
          item.receivedQuantity = received;
        }

        const accepted = Math.min(received, acceptedRaw);
        item.acceptedQuantity = accepted;
        item.rejectedQuantity = received - accepted;
      } else {
        const received = Math.max(0, toNum(item.receivedQuantity));
        const rejected = Math.min(received, Math.max(0, toNum(value)));
        item.rejectedQuantity = rejected;
        item.acceptedQuantity = received - rejected;
      }
    }

    setFormData({ ...formData, items: updatedItems });
  };

  const handleRemoveItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const handleAdditionalInvoiceFileSelect = async (
    file: File,
    target: "create" | "edit" = "create",
  ) => {
    const validTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "application/pdf",
    ];
    if (!validTypes.includes(file.type)) {
      setAlertMessage({
        type: "error",
        message: "Please upload PNG, JPG, or PDF files only.",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAlertMessage({
        type: "error",
        message: "File size must be less than 10MB.",
      });
      return;
    }
    setAdditionalUploadStatus(`Uploading ${file.name}...`);
    try {
      const token = localStorage.getItem("accessToken");
      const fd = new FormData();
      fd.append("file", file);
      const response = await fetch("/api/v1/purchase/grn/invoice/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (response.ok) {
        const data = await response.json();
        const url = String(data?.url || "").trim();
        if (url) {
          const fileInfo = {
            url,
            name: String(data?.name || file.name),
            type: String(data?.type || file.type),
          };
          if (target === "edit") {
            setEditFormData((prev) => ({
              ...prev,
              additionalInvoiceFiles: [
                ...prev.additionalInvoiceFiles,
                fileInfo,
              ],
            }));
          } else {
            setAdditionalInvoiceFiles((prev) => [...prev, fileInfo]);
          }
          setAdditionalUploadStatus(`✓ ${file.name} uploaded`);
          setTimeout(() => setAdditionalUploadStatus(""), 3000);
        }
      } else {
        setAdditionalUploadStatus("Upload failed");
      }
    } catch {
      setAdditionalUploadStatus("Upload failed");
    }
  };

  const resetForm = () => {
    setSelectedPO(null);
    setAdditionalInvoiceFiles([]);
    setAdditionalUploadStatus("");
    setInvoiceUploadStatus((prev) => ({
      ...prev,
      create: emptyInvoiceUploadStatus,
    }));
    setFormData({
      poId: "",
      vendorId: "",
      receiptDate: getTodayDateInputValue(),
      invoiceNumber: "",
      invoiceDate: "",
      invoiceFileUrl: "",
      invoiceFileName: "",
      invoiceFileType: "",
      invoiceFileSize: 0,
      warehouseId: "",
      notes: "",
      items: [],
    });
  };

  const getStatusColor = (status: string) => {
    return status === "COMPLETED"
      ? "bg-green-100 text-green-800"
      : status === "CANCELLED"
        ? "bg-red-100 text-red-800"
        : "bg-gray-100 text-gray-800";
  };

  const isGRNEditLocked = (grn?: GRN | null) => {
    if (!grn) return true;
    return (
      Boolean(grn.qc_completed) ||
      String(grn.sap_controls?.qc_gate_status || "").toUpperCase() ===
        "ACCEPTED" ||
      String(grn.status || "").toUpperCase() === "COMPLETED" ||
      String(grn.sap_controls?.reversal_status || "").toUpperCase() ===
        "REVERSED"
    );
  };

  const startEditGRN = (grn: GRN) => {
    if (isGRNEditLocked(grn)) {
      setAlertMessage({
        type: "error",
        message:
          "QC accepted GRNs cannot be edited. Please use Reverse to cancel the stock/accounting posting.",
      });
      return;
    }

    const hydratedItems = backfillEditItems(
      (Array.isArray(grn.grn_items) ? grn.grn_items : []).map((item: any) => ({
        id: item.id,
        itemId: item.item_id || item.itemId || item.item?.id || "",
        poItemId: item.po_item_id || item.poItemId || "",
        itemCode: item.item_code || item.item?.code || "",
        itemName: item.item_name || item.item?.name || "",
        uom: item.uom || item.item?.uom || "",
        orderedQuantity:
          Number(item.ordered_qty || item.ordered_quantity) ||
          Number(item.received_qty || item.received_quantity) ||
          0,
        receivedQty: Number(item.received_qty || item.received_quantity) || 0,
        acceptedQty: Number(item.accepted_qty || item.accepted_quantity) || 0,
        rejectedQty: Number(item.rejected_qty || item.rejected_quantity) || 0,
        unitPrice: Number(item.rate || item.unit_price || item.unitPrice) || 0,
        uidCount: Number((item as any).uid_count) || 0,
        batchNumber: item.batch_number || "",
        expiryDate: item.expiry_date || "",
        notes: item.notes || "",
      })),
      grn,
    );

    setInvoiceUploadStatus((prev) => ({
      ...prev,
      edit: emptyInvoiceUploadStatus,
    }));
    setEditFormData({
      invoiceNumber: grn.invoice_number || "",
      invoiceDate: grn.invoice_date || "",
      invoiceFileUrl: grn.invoice_file_url || "",
      invoiceFileName: grn.invoice_file_name || "",
      invoiceFileType: grn.invoice_file_type || "",
      invoiceFileSize: grn.invoice_file_size || 0,
      additionalInvoiceFiles: Array.isArray(grn.additional_invoice_files)
        ? grn.additional_invoice_files
        : [],
      warehouseId: grn.warehouse?.id || "",
      notes: grn.remarks || (grn as any).notes || "",
      items: hydratedItems as any,
    });
    setEditMode(true);
  };

  const grnTableColumns: Array<ListTableColumn<GRN>> = [
    {
      id: "created_at",
      label: "Created",
      accessor: (grn) => grn.created_at || "",
      defaultVisible: false,
      minWidth: 126,
      cellClassName: "whitespace-nowrap text-[#5E4635]",
      cell: (grn) =>
        grn.created_at
          ? new Date(grn.created_at).toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "-",
    },
    {
      id: "grn_number",
      label: "GRN / PO",
      accessor: (g) => `${g.grn_number} ${g.purchase_order?.po_number || ""}`,
      minWidth: 188,
      cell: (g) => (
        <div className="min-w-0">
          <div
            className="truncate font-semibold text-[#2F241D]"
            title={g.grn_number}
          >
            {g.grn_number}
          </div>
          <div
            className="truncate text-xs text-[#7A6555]"
            title={g.purchase_order?.po_number || ""}
          >
            PO: {g.purchase_order?.po_number || "-"}
          </div>
          <div className="truncate text-xs text-[#7A6555]">
            Receipt: {formatDateOnly(getGrnReceiptDate(g))}
          </div>
        </div>
      ),
    },
    {
      id: "po_number",
      label: "PO Number",
      accessor: (g) => g.purchase_order?.po_number || "-",
      defaultVisible: false,
    },
    {
      id: "vendor",
      label: "Supplier",
      accessor: (g) => g.vendor?.name || "",
      searchAccessor: (g) =>
        `${g.vendor?.name || ""} ${g.vendor?.code || ""}`.trim(),
      minWidth: 260,
      cell: (g) => (
        <div className="min-w-0">
          <div
            className="truncate text-sm font-semibold text-[#2F241D]"
            title={g.vendor?.name || "-"}
          >
            {g.vendor?.name || "-"}
          </div>
          <div
            className="truncate text-xs uppercase text-[#7A6555]"
            title={g.vendor?.code || ""}
          >
            {g.vendor?.code || ""}
          </div>
        </div>
      ),
    },
    {
      id: "grn_date",
      label: "Receipt Date",
      accessor: (g) => getGrnReceiptDate(g),
      sortAccessor: (g) => {
        const receiptDate = getGrnReceiptDate(g);
        if (!receiptDate) return 0;
        const time = new Date(receiptDate).getTime();
        return Number.isNaN(time) ? 0 : time;
      },
      minWidth: 112,
      defaultVisible: false,
      cellClassName: "whitespace-nowrap",
      cell: (g) => (
        <span className="text-sm text-[#5E4635]">
          {formatDateOnly(getGrnReceiptDate(g))}
        </span>
      ),
    },
    {
      id: "invoice",
      label: "Invoice",
      accessor: (g) => g.invoice_number || "",
      searchAccessor: (g) =>
        `${g.invoice_number || ""} ${g.invoice_date || ""}`.trim(),
      minWidth: 180,
      cell: (g) => (
        <div className="min-w-0 text-sm text-[#5E4635]">
          <div
            className="truncate font-medium text-[#2F241D]"
            title={g.invoice_number || "-"}
          >
            {g.invoice_number || "-"}
          </div>
          {g.invoice_date && (
            <div className="text-xs text-[#7A6555]">
              {new Date(g.invoice_date).toLocaleDateString("en-IN")}
            </div>
          )}
          {g.invoice_file_url && (
            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  handleViewInvoice(g.invoice_file_url!, g.invoice_file_name)
                }
                className="text-xs font-medium text-[#8B6F47] hover:text-[#4A3426] hover:underline"
              >
                View
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleDownloadInvoice(
                    g.invoice_file_url!,
                    g.invoice_file_name,
                  )
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[#8B6F47] hover:text-[#4A3426] hover:underline"
                title={`Download ${g.invoice_file_name || "vendor invoice"}`}
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "warehouse",
      label: "Warehouse",
      accessor: (g) => g.warehouse?.name || "-",
      defaultVisible: false,
      minWidth: 160,
    },
    {
      id: "items_uids",
      label: "Receiving / QC",
      sortable: false,
      accessor: (g) => (Array.isArray(g.grn_items) ? g.grn_items.length : 0),
      searchAccessor: (g) =>
        (Array.isArray(g.grn_items) ? g.grn_items : [])
          .map((item: any) =>
            [
              item.item_code,
              item.item_name,
              item.supplier_hsn_code,
              item.batch_number,
              item.item?.code,
              item.item?.name,
              item.item?.hsn_code,
              item.item?.uom,
              item.item?.oem_part_number,
              item.item?.oem_name,
              item.item?.description,
            ]
              .filter(Boolean)
              .join(" "),
          )
          .join(" "),
      minWidth: 220,
      cell: (g) => {
        const items: any[] = Array.isArray(g.grn_items)
          ? (g.grn_items as any[])
          : [];
        const accepted = items.reduce(
          (sum, item) =>
            sum + (Number(item.accepted_qty || item.accepted_quantity) || 0),
          0,
        );
        const rejected = items.reduce(
          (sum, item) =>
            sum + (Number(item.rejected_qty || item.rejected_quantity) || 0),
          0,
        );
        const uidTotal = items.reduce(
          (sum, item) => sum + (Number((item as any).uid_count) || 0),
          0,
        );
        const hasUids = items.some(
          (item) => (Number((item as any).uid_count) || 0) > 0,
        );
        // Only show "UIDs pending" if at least one UID-tracked item has accepted qty but no UIDs
        const hasUidTrackedWithAccepted = items.some((item) => {
          const cfg = itemUidConfigById[String(item.item_id || "")];
          return (
            cfg?.uid_tracking === true &&
            (Number(item.accepted_qty || item.accepted_quantity) || 0) > 0
          );
        });

        return (
          <div className="min-w-0 text-sm text-[#5E4635]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-[#2F241D]">
                {items.length} items
              </span>
              <span className="text-xs">Accepted {accepted}</span>
              {rejected > 0 && (
                <span className="text-xs font-medium text-red-700">
                  Rejected {rejected}
                </span>
              )}
            </div>
            {items.length > 0 && (
              <div
                className="mt-1 truncate text-xs text-[#7A6555]"
                title={items
                  .map((item: any) =>
                    [
                      item.item_code || item.item?.code,
                      item.item_name || item.item?.name,
                    ]
                      .filter(Boolean)
                      .join(" - "),
                  )
                  .filter(Boolean)
                  .join("; ")}
              >
                {items
                  .slice(0, 2)
                  .map((item: any) =>
                    [
                      item.item_code || item.item?.code,
                      item.item_name || item.item?.name,
                    ]
                      .filter(Boolean)
                      .join(" - "),
                  )
                  .filter(Boolean)
                  .join("; ")}
                {items.length > 2 ? ` +${items.length - 2} more` : ""}
              </div>
            )}
            {hasUids ? (
              <div className="mt-1 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5">
                <span className="text-xs text-green-600 font-medium">
                  ✓ {uidTotal} UIDs
                </span>
                <div className="hidden">
                  UIDs are generated only for UID-tracked items (batched items
                  may generate fewer UIDs than accepted qty).
                </div>
              </div>
            ) : hasUidTrackedWithAccepted ? (
              <div className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                UIDs pending
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "status",
      label: "Status",
      accessor: (g) => g.status,
      minWidth: 120,
      cell: (g) => <ErpStatusBadge status={g.status} />,
      align: "center",
    },
    {
      id: "actions",
      label: "Actions",
      sortable: false,
      hideable: false,
      align: "right",
      minWidth: 96,
      cell: (grn) => (
        <div className="flex justify-end text-sm">
          <button
            type="button"
            onClick={async () => {
              // Fetch full GRN details with items
              try {
                const token = localStorage.getItem("accessToken");
                const response = await fetch(`/api/v1/purchase/grn/${grn.id}`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                const detailedGRN = await response.json();
                setSelectedGRN(detailedGRN);
              } catch (error) {
                setSelectedGRN(grn); // Fallback to list data
              }

              setShowViewModal(true);
              setEditMode(false);
            }}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-[#D8C8AA] bg-white px-2.5 text-xs font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
          >
            <Eye className="h-3.5 w-3.5" />
            Open
          </button>
        </div>
      ),
    },
  ];

  const visibleGrns = grns.filter((g) =>
    filterStatus === "ALL" ? true : g.status === filterStatus,
  );

  if (!mounted) {
    return <div className="min-h-screen bg-[#FAF9F6]" />;
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-4 text-[#2F241D] lg:px-6">
      <div className="flex min-h-[calc(100vh-2rem)] flex-col gap-4">
        <ErpPageHeader
          eyebrow="Inventory"
          title="Goods Receipt Notes"
          description="Record supplier invoices, receive PO quantities, complete QC, and generate UID traceability."
          actions={
            canCreateGRN ? (
              <ErpButton variant="primary" onClick={() => setShowModal(true)}>
                <Plus className="h-4 w-4" />
                Create GRN
              </ErpButton>
            ) : null
          }
        />

        <ErpMetricStrip
          loading={loading}
          metrics={[
            { label: "Total GRNs", value: grns.length },
            {
              label: "Draft",
              value: grns.filter((g) => g.status === "DRAFT").length,
              tone: "warning",
            },
            {
              label: "Completed",
              value: grns.filter((g) => g.status === "COMPLETED").length,
              tone: "success",
            },
            {
              label: "Cancelled",
              value: grns.filter((g) => g.status === "CANCELLED").length,
              tone: "danger",
            },
          ]}
        />

        <section className="min-h-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[#4A3426]">GRN Register</h2>
            <span className="text-sm text-[#7A6555]">
              {visibleGrns.length} records
            </span>
          </div>
          {/* GRN List */}
          {loading ? (
            <div className="rounded-md border border-[#E8DCC4] bg-white">
              <div className="p-8 text-center text-[#7A6555]">
                Loading GRNs...
              </div>
            </div>
          ) : (
            <ListTable
              storageKey="grnTable:v3"
              rows={visibleGrns}
              columns={grnTableColumns}
              getRowId={(g) => g.id}
              defaultPageSize={25}
              pageSizeOptions={[10, 25, 50, 100]}
              initialSearch={initialGrnSearch}
              searchPlaceholder="Search GRN, PO, vendor, invoice, part no, item name, description, HSN…"
              toolbarLayout="singleLine"
              searchClassName="sm:max-w-[28rem] lg:max-w-[34rem]"
              toolbarRight={
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="min-h-9 w-40 rounded-md border border-[#D8C8AA] bg-white px-3 py-1.5 text-sm text-[#2F241D] focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                >
                  <option value="ALL">All Status</option>
                  <option value="DRAFT">Draft</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              }
              emptyState={
                <div className="p-12 text-center">
                  <div className="text-6xl mb-4">📦</div>
                  <h3 className="text-xl font-semibold text-gray-700 mb-2">
                    No GRNs Yet
                  </h3>
                  <p className="text-gray-500">
                    Create your first goods receipt note to track incoming
                    inventory
                  </p>
                </div>
              }
            />
          )}
        </section>
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F6]">
          <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white">
            <div className="shrink-0 border-b border-[#E8DCC4] bg-white px-5 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#8B6F47]">
                    Goods Receipt
                  </p>
                  <h2 className="text-xl font-bold text-[#4A3426]">
                    Create GRN
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#7A6555] hover:bg-[#F5EFE3] hover:text-[#4A3426]"
                  aria-label="Close create GRN"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-6">
                {/* GRN Header */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Purchase Order *
                    </label>
                    <SearchableSelect
                      value={formData.poId}
                      onChange={(value) => handlePOChange(value)}
                      placeholder="Select Purchase Order..."
                      emptyMessage="No material POs pending GRN. Service-only POs are handled in Service Entry Sheets."
                      options={purchaseOrders.map((po) => ({
                        value: po.id,
                        label: `${po.po_number} - ${po.vendor.name} (${new Date(po.po_date).toLocaleDateString()})`,
                      }))}
                    />
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <div className="font-semibold">
                        Only material POs appear here for GRN.
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span>
                          Service-only POs, such as transportation/job-work
                          charges, must be accepted through Service Entry
                          Sheets.
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            router.push("/dashboard/purchase/service-entries")
                          }
                          className="font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-950"
                        >
                          Open Service Entry Sheets
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vendor *
                    </label>
                    <input
                      type="text"
                      value={
                        selectedPO
                          ? `${selectedPO.vendor.name} (${selectedPO.vendor.code})`
                          : ""
                      }
                      readOnly
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-gray-50"
                      placeholder="Auto-filled from PO"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Receipt Date
                    </label>
                    <DateInput
                      max={todayDate}
                      value={formData.receiptDate}
                      onChange={(value) =>
                        setFormData({ ...formData, receiptDate: value })
                      }
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Invoice Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.invoiceNumber}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          invoiceNumber: e.target.value,
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      required
                      placeholder="Enter invoice number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Invoice Date <span className="text-red-500">*</span>
                    </label>
                    <DateInput
                      max={todayDate}
                      value={formData.invoiceDate}
                      onChange={(value) =>
                        setFormData({ ...formData, invoiceDate: value })
                      }
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      required
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Purchase Invoice (File){" "}
                      <span className="text-red-500">*</span>
                      <span className="ml-2 text-xs text-gray-400 font-normal">
                        Upload one or more invoice files
                      </span>
                    </label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleInvoiceFileSelect(file, "create");
                      }}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                    {formData.invoiceFileName && (
                      <div className="text-xs text-gray-600 mt-1 flex items-center gap-2">
                        <span>📄 {formData.invoiceFileName}</span>
                        {formData.invoiceFileUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              handleViewInvoice(
                                formData.invoiceFileUrl,
                                formData.invoiceFileName,
                              )
                            }
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            Open
                          </button>
                        )}
                      </div>
                    )}
                    {renderInvoiceUploadStatus(invoiceUploadStatus.create)}
                    {/* Additional invoice files */}
                    {additionalInvoiceFiles.map((f, i) => (
                      <div
                        key={i}
                        className="text-xs text-gray-600 mt-1 flex items-center gap-2"
                      >
                        <span>📄 {f.name}</span>
                        <button
                          type="button"
                          onClick={() => handleViewInvoice(f.url, f.name)}
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAdditionalInvoiceFiles((prev) =>
                              prev.filter((_, idx) => idx !== i),
                            )
                          }
                          className="text-red-500 hover:text-red-700"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="mt-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                        <span>+ Add Another Invoice File</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleAdditionalInvoiceFileSelect(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {additionalUploadStatus && (
                        <span className="ml-3 text-xs text-green-600">
                          {additionalUploadStatus}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Items{" "}
                      {formData.items.length > 0 &&
                        `(${formData.items.length})`}
                    </h3>
                  </div>

                  {formData.items.length === 0 ? (
                    <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                      <p className="text-gray-500">
                        Select a Purchase Order to auto-fill items
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {formData.items.map((item, index) => (
                        <div
                          key={index}
                          className="border border-gray-300 rounded-lg p-4 bg-gray-50"
                        >
                          <div className="overflow-x-auto">
                            <div className="min-w-[980px] grid grid-cols-1 md:grid-cols-[56px_2.2fr_80px_160px_90px_90px_90px_90px_110px_110px_44px] gap-3 items-end">
                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  S.No
                                </label>
                                <div className="text-sm font-medium text-gray-900 mt-2">
                                  {index + 1}
                                </div>
                              </div>

                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  Item
                                </label>
                                <div className="text-sm font-medium text-gray-900 mt-1 break-words">
                                  <span className="whitespace-nowrap">
                                    {item.itemCode}
                                  </span>
                                  <span className="text-gray-500"> - </span>
                                  <span>{item.itemName}</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  Master HSN: {item.masterHsnCode || "N/A"}
                                </div>
                                {(() => {
                                  const cfg = itemUidConfigById[item.itemId];
                                  const isBatched =
                                    cfg?.uid_tracking !== false &&
                                    cfg?.uid_strategy === "BATCHED";
                                  const perContainer =
                                    Number(cfg?.batch_quantity ?? 0) || 0;
                                  if (!isBatched || perContainer <= 0)
                                    return null;

                                  const qty =
                                    Number(item.acceptedQuantity ?? 0) || 0;
                                  const containers =
                                    qty > 0 ? Math.ceil(qty / perContainer) : 0;
                                  const containerLabel = String(
                                    cfg?.batch_uom || "Container",
                                  );
                                  const uomLabel = String(item.uom || "UOM");

                                  return (
                                    <div className="text-xs text-indigo-700 mt-1">
                                      Pack: {perContainer} {uomLabel} /{" "}
                                      {containerLabel}  UIDs: {containers}{" "}
                                      {containerLabel}
                                      {containers === 1 ? "" : "s"}
                                    </div>
                                  );
                                })()}
                              </div>

                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  UOM
                                </label>
                                <input
                                  type="text"
                                  value={item.uom || ""}
                                  readOnly
                                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                                  placeholder="-"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  Supplier HSN
                                </label>
                                <input
                                  type="text"
                                  value={item.supplierHsnCode || ""}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      index,
                                      "supplierHsnCode",
                                      e.target.value,
                                    )
                                  }
                                  className={`w-full border rounded px-3 py-2 text-sm ${
                                    item.supplierHsnCode &&
                                    item.supplierHsnCode !== item.masterHsnCode
                                      ? "border-amber-500 bg-amber-50"
                                      : "border-gray-300"
                                  }`}
                                  placeholder="HSN from invoice"
                                />
                                {item.supplierHsnCode &&
                                  item.supplierHsnCode !==
                                    item.masterHsnCode && (
                                    <div className="text-xs text-amber-600 mt-1">
                                      ⚠ HSN differs
                                    </div>
                                  )}
                              </div>
                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  Ordered
                                </label>
                                <input
                                  type="number"
                                  value={item.orderedQuantity}
                                  readOnly
                                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-gray-50"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  Prev. Received
                                </label>
                                <input
                                  type="number"
                                  value={Math.max(
                                    0,
                                    Number(item.previousReceivedQuantity || 0),
                                  )}
                                  readOnly
                                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-blue-50 text-blue-700 font-medium"
                                  title="Quantity already received against this PO line (from earlier GRNs)"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  Receiving Now *
                                </label>
                                <input
                                  type="number"
                                  value={item.receivedQuantity}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      index,
                                      "receivedQuantity",
                                      parseFloat(e.target.value),
                                    )
                                  }
                                  className="w-full border border-amber-400 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 bg-amber-50 font-semibold"
                                  placeholder="Qty in this delivery"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                  Batch
                                </label>
                                <input
                                  type="text"
                                  value={item.batchNumber}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      index,
                                      "batchNumber",
                                      e.target.value,
                                    )
                                  }
                                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                />
                              </div>
                              {item.purchaseCurrency &&
                              item.purchaseCurrency !== "INR" ? (
                                <div>
                                  <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                    Exch. Rate ({item.purchaseCurrency}→INR)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={item.exchangeRate || ""}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        index,
                                        "exchangeRate",
                                        e.target.value,
                                      )
                                    }
                                    className="w-full border border-blue-400 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 bg-blue-50"
                                    placeholder="e.g. 84.50"
                                  />
                                  {item.foreignUnitPrice != null && (
                                    <div className="text-xs text-blue-600 mt-1">
                                      {item.purchaseCurrency}{" "}
                                      {Number(item.foreignUnitPrice).toFixed(4)}{" "}
                                      × rate = ₹
                                      {Number(item.unitPrice || 0).toFixed(2)}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  <label className="text-xs text-gray-600 font-semibold whitespace-nowrap">
                                    Rate (₹)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={item.unitPrice || ""}
                                    onChange={(e) =>
                                      handleUpdateItem(
                                        index,
                                        "unitPrice",
                                        parseFloat(e.target.value) || 0,
                                      )
                                    }
                                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                    placeholder="0.00"
                                  />
                                </div>
                              )}
                              <div className="flex items-end justify-end">
                                <button
                                  onClick={() => handleRemoveItem(index)}
                                  className="h-10 w-10 inline-flex items-center justify-center rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-900"
                                  aria-label="Remove item"
                                >
                                  <span className="text-xl leading-none">
                                    ×
                                  </span>
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="mt-2">
                            <input
                              type="text"
                              value={item.notes}
                              onChange={(e) =>
                                handleUpdateItem(index, "notes", e.target.value)
                              }
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              placeholder="Item notes..."
                            />
                          </div>

                          {(Number(item.rejectedQuantity) || 0) > 0 && (
                            <div className="mt-2">
                              <input
                                type="text"
                                value={item.rejectionReason || ""}
                                onChange={(e) =>
                                  handleUpdateItem(
                                    index,
                                    "rejectionReason",
                                    e.target.value,
                                  )
                                }
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                placeholder="Rejection remark..."
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-[#E8DCC4] bg-white px-5 py-3">
              <div className="flex justify-end gap-3">
                <ErpButton
                  variant="secondary"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                >
                  Cancel
                </ErpButton>
                <ErpButton
                  variant="primary"
                  onClick={handleCreateGRN}
                  disabled={submitting}
                >
                  {submitting ? "Creating..." : "Create GRN"}
                </ErpButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {grnDiscrepancyPreview && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-[#E8DCC4] px-5 py-4">
              <h3 className="text-lg font-bold text-[#4A3426]">
                GRN discrepancy requires approval
              </h3>
              <p className="mt-1 text-sm text-[#7A6555]">
                The GRN can be created now. Any PO quantity or rate change will
                stay pending until an approver approves it.
              </p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              <div className="overflow-x-auto rounded border border-[#E8DCC4]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#F5EFE3] text-xs uppercase text-[#5E4635]">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">PO Qty</th>
                      <th className="px-3 py-2 text-right">Previous GRN</th>
                      <th className="px-3 py-2 text-right">This GRN</th>
                      <th className="px-3 py-2 text-right">Proposed PO Qty</th>
                      <th className="px-3 py-2 text-right">PO Rate</th>
                      <th className="px-3 py-2 text-right">GRN Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DCC4]">
                    {(
                      grnDiscrepancyPreview.poAmendmentApproval?.items || []
                    ).map((item, index) => (
                      <tr key={`${item.poItemId || item.itemCode || index}`}>
                        <td className="px-3 py-2 font-semibold text-[#2F241D]">
                          {item.itemCode || "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {Number(item.orderedQty || 0).toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {Number(item.previousReceivedQty || 0).toLocaleString(
                            "en-IN",
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {Number(item.receivedQty || 0).toLocaleString(
                            "en-IN",
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-800">
                          {item.proposedOrderedQty == null
                            ? "-"
                            : Number(item.proposedOrderedQty).toLocaleString(
                                "en-IN",
                              )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          ₹{Number(item.poRate || 0).toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-800">
                          ₹{Number(item.grnRate || 0).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(grnDiscrepancyPreview.messages || []).length > 0 && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {(grnDiscrepancyPreview.messages || []).map(
                    (message, index) => (
                      <div key={index}>{message}</div>
                    ),
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-5 py-4">
              <ErpButton
                variant="secondary"
                onClick={() => setGrnDiscrepancyPreview(null)}
                disabled={submitting}
              >
                Review GRN
              </ErpButton>
              <ErpButton
                variant="primary"
                disabled={submitting}
                onClick={async () => {
                  setGrnDiscrepancyPreview(null);
                  await actuallyCreateGRN();
                }}
              >
                Create & Send PO Change for Approval
              </ErpButton>
            </div>
          </div>
        </div>
      )}

      {/* View/Edit Modal */}
      {showViewModal && selectedGRN && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F6]">
          <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white">
            <div className="shrink-0 border-b border-[#E8DCC4] bg-white px-5 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-[#8B6F47]">
                    {editMode ? "Edit Goods Receipt" : "Goods Receipt"}
                  </p>
                  <h2 className="truncate text-xl font-bold text-[#4A3426]">
                    {selectedGRN.grn_number}
                  </h2>
                </div>
                <button
                  onClick={closeGRNView}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#7A6555] hover:bg-[#F5EFE3] hover:text-[#4A3426]"
                  aria-label="Close GRN"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-6">
                {/* GRN Header Information */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      GRN Number
                    </label>
                    <p className="mt-1 text-gray-900 font-semibold">
                      {selectedGRN.grn_number}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Status
                    </label>
                    <span
                      className={`inline-block mt-1 px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(selectedGRN.status)}`}
                    >
                      {selectedGRN.status}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      PO Number
                    </label>
                    <p className="mt-1 text-gray-900">
                      {selectedGRN.purchase_order?.po_number || "-"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Vendor
                    </label>
                    <p className="mt-1 text-gray-900">
                      {selectedGRN.vendor?.name} ({selectedGRN.vendor?.code})
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Receipt Date
                    </label>
                    <p className="mt-1 text-gray-900">
                      {formatDateOnly(getGrnReceiptDate(selectedGRN))}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Warehouse
                    </label>
                    {editMode ? (
                      <select
                        value={editFormData.warehouseId}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            warehouseId: e.target.value,
                          })
                        }
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      >
                        <option value="">Select Warehouse</option>
                        {warehouses.map((wh) => (
                          <option key={wh.id} value={wh.id}>
                            {wh.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="mt-1 text-gray-900">
                        {selectedGRN.warehouse?.name || "-"}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Invoice Number
                    </label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editFormData.invoiceNumber}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            invoiceNumber: e.target.value,
                          })
                        }
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="Enter invoice number"
                      />
                    ) : (
                      <p className="mt-1 text-gray-900">
                        {selectedGRN.invoice_number || "-"}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Invoice Date
                    </label>
                    {editMode ? (
                      <DateInput
                        max={todayDate}
                        value={editFormData.invoiceDate}
                        onChange={(value) =>
                          setEditFormData({
                            ...editFormData,
                            invoiceDate: value,
                          })
                        }
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                      />
                    ) : (
                      <p className="mt-1 text-gray-900">
                        {selectedGRN.invoice_date
                          ? new Date(
                              selectedGRN.invoice_date,
                            ).toLocaleDateString()
                          : "-"}
                      </p>
                    )}
                  </div>
                  {editMode ? (
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700">
                        GRN Notes / Remarks
                      </label>
                      <textarea
                        value={editFormData.notes || ""}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            notes: e.target.value,
                          })
                        }
                        rows={2}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="Additional notes..."
                      />
                    </div>
                  ) : selectedGRN?.remarks || (selectedGRN as any)?.notes ? (
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700">
                        GRN Notes / Remarks
                      </label>
                      <p className="mt-1 text-sm text-gray-600 italic whitespace-pre-wrap">
                        {selectedGRN?.remarks || (selectedGRN as any)?.notes}
                      </p>
                    </div>
                  ) : null}

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Purchase Invoice (File){" "}
                      <span className="text-red-500">*</span>
                    </label>
                    {editMode ? (
                      <>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleInvoiceFileSelect(file, "edit");
                          }}
                          className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                        />
                        {editFormData.invoiceFileName && (
                          <div className="text-xs text-gray-600 mt-1">
                            Current file: {editFormData.invoiceFileName}
                            {editFormData.invoiceFileUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleViewInvoice(
                                    editFormData.invoiceFileUrl,
                                    editFormData.invoiceFileName,
                                  )
                                }
                                className="ml-2 text-blue-600 hover:text-blue-800 underline"
                              >
                                Open
                              </button>
                            )}
                          </div>
                        )}
                        {renderInvoiceUploadStatus(invoiceUploadStatus.edit)}
                        {/* Additional invoice files */}
                        {editFormData.additionalInvoiceFiles.map((f, i) => (
                          <div
                            key={i}
                            className="text-xs text-gray-600 mt-1 flex items-center gap-2"
                          >
                            <span>📄 {f.name}</span>
                            <button
                              type="button"
                              onClick={() => handleViewInvoice(f.url, f.name)}
                              className="text-blue-600 hover:text-blue-800 underline"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditFormData((prev) => ({
                                  ...prev,
                                  additionalInvoiceFiles:
                                    prev.additionalInvoiceFiles.filter(
                                      (_, idx) => idx !== i,
                                    ),
                                }))
                              }
                              className="text-red-500 hover:text-red-700"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <div className="mt-2">
                          <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                            <span>+ Add Another Invoice File</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/jpg,application/pdf"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f)
                                  handleAdditionalInvoiceFileSelect(f, "edit");
                                e.target.value = "";
                              }}
                            />
                          </label>
                          {additionalUploadStatus && (
                            <span className="ml-3 text-xs text-green-600">
                              {additionalUploadStatus}
                            </span>
                          )}
                        </div>
                      </>
                    ) : selectedGRN.invoice_file_url ? (
                      <div className="flex flex-col gap-1 mt-1">
                        <button
                          onClick={() =>
                            handleViewInvoice(
                              selectedGRN.invoice_file_url!,
                              selectedGRN.invoice_file_name,
                            )
                          }
                          className="inline-block text-blue-600 hover:text-blue-800 underline cursor-pointer text-left"
                        >
                          View Invoice{" "}
                          {selectedGRN.invoice_file_name
                            ? `(${selectedGRN.invoice_file_name})`
                            : ""}
                        </button>
                        <button
                          onClick={() =>
                            void handleDownloadInvoice(
                              selectedGRN.invoice_file_url!,
                              selectedGRN.invoice_file_name,
                            )
                          }
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline cursor-pointer text-left"
                        >
                          <Download className="h-4 w-4" /> Download Invoice
                        </button>
                        {Array.isArray(
                          (selectedGRN as any).additional_invoice_files,
                        ) &&
                          (selectedGRN as any).additional_invoice_files.map(
                            (f: any, i: number) => (
                              <button
                                key={i}
                                onClick={() => handleViewInvoice(f.url, f.name)}
                                className="inline-block text-blue-600 hover:text-blue-800 underline cursor-pointer text-left"
                              >
                                Additional Invoice {i + 2}{" "}
                                {f.name ? `(${f.name})` : ""}
                              </button>
                            ),
                          )}
                      </div>
                    ) : (
                      <p className="mt-1 text-gray-900">-</p>
                    )}
                  </div>
                </div>

                {!editMode && selectedGRN.sap_controls && (
                  <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5]">
                    <div className="border-b border-[#E8DCC4] px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold text-[#4A3426]">
                            SAP Receiving Controls
                          </h3>
                          <p className="text-xs text-[#7A6555]">
                            Material document, inspection lot, tolerance, and
                            GR/IR readiness.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full border border-[#D8C8AA] bg-white px-2.5 py-1 font-semibold text-[#5E4635]">
                            Mvt{" "}
                            {selectedGRN.sap_controls.movement_type || "101"}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 font-semibold ${
                              selectedGRN.sap_controls.tolerance_status === "OK"
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : "bg-amber-50 text-amber-800 border border-amber-200"
                            }`}
                          >
                            Tolerance{" "}
                            {selectedGRN.sap_controls.tolerance_status || "OK"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-px bg-[#E8DCC4] md:grid-cols-4">
                      {[
                        [
                          "Material Document",
                          selectedGRN.sap_controls.material_document_number ||
                            "-",
                        ],
                        [
                          "Fiscal Year",
                          selectedGRN.sap_controls.fiscal_year || "-",
                        ],
                        [
                          "Inspection Lot",
                          selectedGRN.sap_controls.inspection_lot_number || "-",
                        ],
                        [
                          "QC Gate",
                          String(
                            selectedGRN.sap_controls.qc_gate_status || "-",
                          ).replace(/_/g, " "),
                        ],
                        [
                          "GR/IR Status",
                          String(
                            selectedGRN.sap_controls.gr_ir_status || "-",
                          ).replace(/_/g, " "),
                        ],
                        [
                          "3-Way Match",
                          selectedGRN.sap_controls.three_way_match_status ||
                            "-",
                        ],
                        [
                          "Stock Posting",
                          String(
                            selectedGRN.sap_controls.stock_posting_policy ||
                              "-",
                          ).replace(/_/g, " "),
                        ],
                        [
                          "Reversal",
                          String(
                            selectedGRN.sap_controls.reversal_status || "-",
                          ).replace(/_/g, " "),
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="bg-white px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase text-[#8B6F47]">
                            {label}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-[#2F241D]">
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(selectedGRN.sap_controls.items) &&
                      selectedGRN.sap_controls.items.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead className="bg-[#F5EFE3] text-xs uppercase text-[#5E4635]">
                              <tr>
                                <th className="px-4 py-2 text-left">Item</th>
                                <th className="px-4 py-2 text-left">
                                  Stock Type
                                </th>
                                <th className="px-4 py-2 text-right">
                                  Received
                                </th>
                                <th className="px-4 py-2 text-right">
                                  Accepted
                                </th>
                                <th className="px-4 py-2 text-right">
                                  Rejected
                                </th>
                                <th className="px-4 py-2 text-right">
                                  Qty Variance
                                </th>
                                <th className="px-4 py-2 text-right">
                                  Rate Variance
                                </th>
                                <th className="px-4 py-2 text-left">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E8DCC4] bg-white">
                              {selectedGRN.sap_controls.items.map(
                                (item, index) => (
                                  <tr key={item.grn_item_id || index}>
                                    <td className="px-4 py-2 font-semibold text-[#2F241D]">
                                      {item.item_code || "-"}
                                    </td>
                                    <td className="px-4 py-2 text-[#5E4635]">
                                      {String(item.stock_type || "-").replace(
                                        /_/g,
                                        " ",
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {Number(
                                        item.received_qty || 0,
                                      ).toLocaleString("en-IN")}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {Number(
                                        item.accepted_qty || 0,
                                      ).toLocaleString("en-IN")}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {Number(
                                        item.rejected_qty || 0,
                                      ).toLocaleString("en-IN")}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {Number(
                                        item.qty_variance || 0,
                                      ).toLocaleString("en-IN")}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {Number(
                                        item.price_variance_percent || 0,
                                      ).toFixed(2)}
                                      %
                                    </td>
                                    <td className="px-4 py-2">
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                          item.tolerance_status === "OK"
                                            ? "bg-emerald-50 text-emerald-800"
                                            : "bg-amber-50 text-amber-800"
                                        }`}
                                      >
                                        {item.tolerance_status || "OK"}
                                      </span>
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    {Array.isArray(
                      selectedGRN.sap_controls.metadata?.messages,
                    ) &&
                      selectedGRN.sap_controls.metadata.messages.length > 0 && (
                        <div className="border-t border-[#E8DCC4] bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          {selectedGRN.sap_controls.metadata.messages.map(
                            (message, index) => (
                              <div key={index}>{message}</div>
                            ),
                          )}
                        </div>
                      )}
                    {selectedGRN.sap_controls.metadata?.po_amendment_approval
                      ?.status === "PENDING_APPROVAL" && (
                      <div className="border-t border-[#E8DCC4] bg-white px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-[#4A3426]">
                              PO amendment pending approval
                            </div>
                            <div className="text-xs text-[#7A6555]">
                              Quantity/rate changes from this GRN will update
                              the PO only after approval.
                            </div>
                          </div>
                          {canApproveGRN && (
                            <div className="flex gap-2">
                              <ErpButton
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  handlePoAmendmentDecision("reject")
                                }
                                disabled={submitting}
                              >
                                Reject PO Change
                              </ErpButton>
                              <ErpButton
                                size="sm"
                                variant="primary"
                                onClick={() =>
                                  handlePoAmendmentDecision("approve")
                                }
                                disabled={submitting}
                              >
                                Approve & Update PO
                              </ErpButton>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Financial Summary - Only show if financial data exists */}
                {(selectedGRN.gross_amount ||
                  selectedGRN.debit_note_amount ||
                  selectedGRN.net_payable_amount) &&
                  (() => {
                    const freightTotal =
                      (selectedGRN.freight_amount || 0) +
                      (selectedGRN.freight_gst_amount || 0);
                    const netPayableRounded = Math.round(
                      selectedGRN.net_payable_amount || 0,
                    );
                    return (
                      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                        <h3 className="text-lg font-bold text-blue-900 mb-3">
                          💰 Financial Summary
                        </h3>
                        <div
                          className={`grid gap-4 ${freightTotal > 0 ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4"}`}
                        >
                          <div className="bg-white rounded-lg p-3 border border-blue-200">
                            <div className="text-xs text-gray-600 mb-1">
                              Subtotal (Items)
                            </div>
                            <div className="text-xl font-bold text-gray-900">
                              ₹
                              {(selectedGRN.gross_amount || 0).toLocaleString(
                                "en-IN",
                                { minimumFractionDigits: 2 },
                              )}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-purple-200">
                            <div className="text-xs text-gray-600 mb-1">
                              Tax ({selectedGRN.gst_percentage ?? 0}% GST)
                            </div>
                            <div className="text-xl font-bold text-purple-600">
                              ₹
                              {(selectedGRN.tax_amount || 0).toLocaleString(
                                "en-IN",
                                { minimumFractionDigits: 2 },
                              )}
                            </div>
                          </div>
                          {freightTotal > 0 && (
                            <div className="bg-white rounded-lg p-3 border border-blue-300">
                              <div className="text-xs text-gray-600 mb-1">
                                Freight &amp; Charges
                              </div>
                              <div className="text-xl font-bold text-blue-600">
                                ₹
                                {freightTotal.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                })}
                              </div>
                              {(selectedGRN.freight_amount || 0) > 0 &&
                                (selectedGRN.freight_gst_amount || 0) > 0 && (
                                  <div className="text-[10px] text-gray-400">
                                    ₹
                                    {(
                                      selectedGRN.freight_amount || 0
                                    ).toLocaleString("en-IN")}{" "}
                                    + ₹
                                    {(
                                      selectedGRN.freight_gst_amount || 0
                                    ).toLocaleString("en-IN")}{" "}
                                    GST
                                  </div>
                                )}
                            </div>
                          )}
                          <div className="bg-white rounded-lg p-3 border border-red-200">
                            <div className="text-xs text-gray-600 mb-1">
                              Less: Debit Notes
                            </div>
                            <div className="text-xl font-bold text-red-600">
                              -₹
                              {(
                                selectedGRN.debit_note_amount || 0
                              ).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-green-200">
                            <div className="text-xs text-gray-600 mb-1">
                              Net Payable (Rounded)
                            </div>
                            <div className="text-xl font-bold text-green-600">
                              ₹
                              {netPayableRounded.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 text-xs text-gray-500 text-center">
                          Net Payable = Subtotal + Tax
                          {freightTotal > 0 ? " + Freight" : ""} - Debit Notes
                          (Rounded)
                        </div>
                      </div>
                    );
                  })()}

                {/* Items Table */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Items
                  </h3>
                  <table className="min-w-full border border-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-700">
                          S.No
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">
                          Item Code
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">
                          Item Name
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-700">
                          UOM
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">
                          Received
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">
                          Accepted
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">
                          UIDs
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">
                          Batch/UID
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {editMode
                        ? editFormData.items.map((item, idx) => (
                            <tr key={idx}>
                              <td className="px-4 py-2 text-sm text-gray-700 text-center">
                                {idx + 1}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900">
                                {item.itemCode}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900">
                                <div>{item.itemName}</div>
                                <input
                                  type="text"
                                  value={item.notes || ""}
                                  onChange={(e) => {
                                    const newItems = [...editFormData.items];
                                    newItems[idx].notes = e.target.value;
                                    setEditFormData({
                                      ...editFormData,
                                      items: newItems,
                                    });
                                  }}
                                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-xs"
                                  placeholder="Item note..."
                                />
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 text-center">
                                {resolveUom(item) || "-"}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                <input
                                  type="number"
                                  value={item.receivedQty}
                                  onChange={(e) => {
                                    const newItems = [...editFormData.items];
                                    newItems[idx].receivedQty = Number(
                                      e.target.value,
                                    );
                                    setEditFormData({
                                      ...editFormData,
                                      items: newItems,
                                    });
                                  }}
                                  className="w-20 border border-gray-300 rounded px-2 py-1 text-right"
                                />
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                <input
                                  type="number"
                                  value={item.acceptedQty}
                                  onChange={(e) => {
                                    const newItems = [...editFormData.items];
                                    newItems[idx].acceptedQty = Number(
                                      e.target.value,
                                    );
                                    setEditFormData({
                                      ...editFormData,
                                      items: newItems,
                                    });
                                  }}
                                  className="w-20 border border-gray-300 rounded px-2 py-1 text-right"
                                />
                              </td>
                              <td className="px-4 py-2 text-sm text-right">
                                <span className="text-gray-600">
                                  {item.uidCount || 0}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm">
                                <input
                                  type="text"
                                  value={item.batchNumber}
                                  onChange={(e) => {
                                    const newItems = [...editFormData.items];
                                    newItems[idx].batchNumber = e.target.value;
                                    setEditFormData({
                                      ...editFormData,
                                      items: newItems,
                                    });
                                  }}
                                  className="w-32 border border-gray-300 rounded px-2 py-1"
                                  placeholder="Batch number"
                                />
                              </td>
                            </tr>
                          ))
                        : selectedGRN.grn_items.map((item, idx) => {
                            const acceptedQty =
                              Number(
                                item.accepted_qty || item.accepted_quantity,
                              ) || 0;
                            const uidCount =
                              Number((item as any).uid_count) || 0;
                            const itemId = String(
                              (item as any).item_id ||
                                (item as any).item?.id ||
                                "",
                            );
                            const cfg =
                              itemUidConfigById[itemId] ||
                              (item as any).item ||
                              {};
                            const uidStrategy = String(
                              (cfg as any).uid_strategy || "",
                            ).toUpperCase();
                            const requiresUidTracking =
                              (cfg as any).uid_tracking === true &&
                              uidStrategy !== "NONE";
                            const batchQuantity = Math.max(
                              1,
                              Number((cfg as any).batch_quantity) || 1,
                            );
                            const targetUidCount = requiresUidTracking
                              ? uidStrategy === "BATCHED"
                                ? Math.ceil(acceptedQty / batchQuantity)
                                : acceptedQty
                              : 0;
                            const missingUidCount = Math.max(
                              0,
                              targetUidCount - uidCount,
                            );
                            const hasMissingUIDs =
                              requiresUidTracking &&
                              acceptedQty > 0 &&
                              missingUidCount > 0;
                            return (
                              <tr key={idx}>
                                <td className="px-4 py-2 text-sm text-gray-700 text-center">
                                  {idx + 1}
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900">
                                  {item.item_code || item.item?.code || "-"}
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900">
                                  <div>
                                    {item.item_name || item.item?.name || "-"}
                                  </div>
                                  {(item as any).notes && (
                                    <div className="text-xs text-gray-500 mt-1 italic whitespace-pre-wrap">
                                      {(item as any).notes}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-center">
                                  {resolveUom({
                                    uom:
                                      (item as any).uom ||
                                      (item as any).uom_name ||
                                      (item as any).unit ||
                                      (item as any).unit_name ||
                                      (item as any).item?.uom,
                                    itemId:
                                      (item as any).item_id ||
                                      (item as any).itemId ||
                                      (item as any).item?.id,
                                    itemCode:
                                      item.item_code ||
                                      (item as any).item?.code,
                                  }) || "-"}
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  {Number(
                                    item.received_qty || item.received_quantity,
                                  ) || 0}
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  {acceptedQty}
                                </td>
                                <td className="px-4 py-2 text-sm text-right">
                                  {uidCount > 0 ? (
                                    <span
                                      className={
                                        hasMissingUIDs
                                          ? "text-amber-600 font-medium"
                                          : "text-green-600"
                                      }
                                    >
                                      {uidCount}
                                      {hasMissingUIDs && (
                                        <span className="text-xs ml-1">
                                          / {targetUidCount}
                                        </span>
                                      )}
                                    </span>
                                  ) : acceptedQty > 0 ? (
                                    <span className="text-gray-400">-</span>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-sm">
                                  {item.batch_number && (
                                    <div className="text-gray-600">
                                      Batch: {item.batch_number}
                                    </div>
                                  )}
                                  {item.uid && (
                                    <div className="font-mono text-blue-600 text-xs">
                                      {item.uid}
                                    </div>
                                  )}
                                  {hasMissingUIDs &&
                                    selectedGRN.status === "COMPLETED" && (
                                      <button
                                        onClick={() =>
                                          generateMissingUIDs(
                                            selectedGRN.id,
                                            (item as any).id,
                                          )
                                        }
                                        className="mt-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded font-medium"
                                        title={`Generate ${missingUidCount} missing UID(s)`}
                                      >
                                        +{missingUidCount} Generate
                                      </button>
                                    )}
                                  {!item.batch_number &&
                                    !item.uid &&
                                    !hasMissingUIDs && (
                                      <span className="text-gray-400">-</span>
                                    )}
                                </td>
                              </tr>
                            );
                          })}
                    </tbody>
                  </table>
                </div>

                {/* Rejections Section - Only show if there are rejections */}
                {selectedGRN.grn_items?.some(
                  (item: any) => (item.rejected_qty || 0) > 0,
                ) && (
                  <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
                    <h3 className="text-lg font-bold text-red-900 mb-3">
                      ❌ Rejected Items
                    </h3>
                    <div className="space-y-3">
                      {selectedGRN.grn_items
                        .filter((item: any) => (item.rejected_qty || 0) > 0)
                        .map((item: any, idx: number) => {
                          const itemName =
                            item.item_name || item.item?.name || "Unknown Item";
                          const itemCode =
                            item.item_code || item.item?.code || "N/A";
                          return (
                            <div
                              key={idx}
                              className="bg-white border border-red-200 rounded-lg p-3"
                            >
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <div className="font-semibold text-gray-900">
                                    {itemName} ({itemCode})
                                  </div>
                                  <div className="text-sm text-gray-600 mt-1">
                                    Rejected Qty:{" "}
                                    <span className="font-bold text-red-600">
                                      {item.rejected_qty}
                                    </span>
                                    {item.unit_price && (
                                      <span className="ml-3">
                                        Amount:{" "}
                                        <span className="font-bold text-red-600">
                                          ₹
                                          {(
                                            item.rejection_amount ||
                                            item.rejected_qty * item.unit_price
                                          ).toLocaleString("en-IN", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {item.return_status &&
                                  item.return_status !== "NONE" && (
                                    <span
                                      className={`px-2 py-1 rounded text-xs font-bold ${
                                        item.return_status === "PENDING_RETURN"
                                          ? "bg-yellow-100 text-yellow-800"
                                          : item.return_status === "RETURNED"
                                            ? "bg-green-100 text-green-800"
                                            : item.return_status === "DESTROYED"
                                              ? "bg-gray-100 text-gray-800"
                                              : "bg-blue-100 text-blue-800"
                                      }`}
                                    >
                                      {item.return_status.replace("_", " ")}
                                    </span>
                                  )}
                              </div>

                              {item.rejection_reason && (
                                <div className="text-sm text-gray-700 bg-red-50 border-l-4 border-red-400 p-2 rounded">
                                  <span className="font-medium">Reason:</span>{" "}
                                  {item.rejection_reason}
                                </div>
                              )}
                              {item.qc_notes && (
                                <div className="text-sm text-gray-600 mt-1">
                                  <span className="font-medium">QC Notes:</span>{" "}
                                  {item.qc_notes}
                                </div>
                              )}
                              {item.debit_note_id && (
                                <div className="text-sm text-blue-600 mt-2 font-medium">
                                  📄 Debit Note Created
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer with Action Buttons */}
            <div className="shrink-0 border-t border-[#E8DCC4] bg-white px-5 py-3 flex justify-between items-center">
              <div className="flex gap-3">
                {editMode ? (
                  <ErpButton variant="primary" onClick={handleUpdateGRN}>
                    Save Changes
                  </ErpButton>
                ) : (
                  <>
                    <ErpButton
                      variant="secondary"
                      onClick={() => printGRN(selectedGRN)}
                    >
                      <Printer className="h-4 w-4" />
                      Print
                    </ErpButton>
                    {selectedGRN.status === "COMPLETED" && (
                      <ErpButton
                        variant="secondary"
                        onClick={() => fetchGRNUIDs(selectedGRN.id)}
                      >
                        UIDs
                      </ErpButton>
                    )}
                    {canEditGRN && !isGRNEditLocked(selectedGRN) && (
                      <ErpButton
                        variant="secondary"
                        onClick={() => startEditGRN(selectedGRN)}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </ErpButton>
                    )}
                    {canApproveGRN &&
                      selectedGRN.status === "COMPLETED" &&
                      selectedGRN.sap_controls?.reversal_status !==
                        "REVERSED" && (
                        <ErpButton
                          variant="secondary"
                          onClick={() => openReverseGRNDialog(selectedGRN)}
                          disabled={submitting}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reverse
                        </ErpButton>
                      )}
                    {canEditGRN && (
                      <button
                        onClick={() => {
                          // Initialize QC form data with GRN items
                          const qcData = selectedGRN.grn_items.map(
                            (item: any) => {
                              const receivedQty =
                                item.received_qty ||
                                item.received_quantity ||
                                0;
                              const acceptedQty =
                                item.accepted_qty ||
                                item.accepted_quantity ||
                                receivedQty;
                              const rejectedQty =
                                item.rejected_qty ||
                                item.rejected_quantity ||
                                0;
                              // Load existing QC files
                              const existingFiles = [];
                              if (item.qc_file_url) {
                                existingFiles.push({
                                  url: item.qc_file_url,
                                  name: item.qc_file_name || "QC Attachment",
                                  type: item.qc_file_type || "",
                                  size: item.qc_file_size || 0,
                                });
                              }
                              return {
                                itemId: item.id,
                                itemCode: item.item_code || item.item?.code,
                                itemName: item.item_name || item.item?.name,
                                notes: (item as any).notes || "",
                                receivedQty: receivedQty,
                                acceptedQty: acceptedQty,
                                rejectedQty: rejectedQty,
                                qcNotes: item.qc_notes || "",
                                rejectionReason: item.rejection_reason || "",
                                qcFiles: existingFiles,
                                // Keep legacy fields for backward compatibility
                                qcFileUrl: item.qc_file_url || "",
                                qcFileName: item.qc_file_name || "",
                                qcFileType: item.qc_file_type || "",
                                qcFileSize: item.qc_file_size || 0,
                                checked_by: "",
                              };
                            },
                          );
                          setQcFormData(qcData);
                          // Initialize QC metadata
                          setQcMetadata({
                            invoiceNumber: selectedGRN.invoice_number || "",
                            qcDate: getTodayDateInputValue(),
                            qcBy: "",
                          });
                          setShowQCModal(true);
                        }}
                        disabled={
                          selectedGRN.status !== "DRAFT" ||
                          selectedGRN.qc_completed
                        }
                        className={`px-6 py-2 text-white rounded-lg ${
                          selectedGRN.status === "DRAFT" &&
                          !selectedGRN.qc_completed
                            ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
                            : "bg-gray-400 cursor-not-allowed"
                        }`}
                        title={
                          selectedGRN.qc_completed
                            ? "QC already completed"
                            : selectedGRN.status !== "DRAFT"
                              ? "QC can be performed only in DRAFT"
                              : "Perform QC inspection"
                        }
                      >
                        🔍 QC Accept
                      </button>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={closeGRNView}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UIDs Modal */}
      {showUIDsModal && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F6]">
          <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white">
            <div className="shrink-0 border-b border-[#E8DCC4] bg-white px-5 py-3 flex justify-between items-center">
              <h2 className="text-xl font-bold text-[#4A3426]">
                Generated UIDs
              </h2>
              <button
                onClick={() => setShowUIDsModal(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#7A6555] hover:bg-[#F5EFE3] hover:text-[#4A3426]"
                aria-label="Close UIDs"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {selectedGRNUIDs.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No UIDs found</p>
              ) : (
                <div className="grid gap-3">
                  {selectedGRNUIDs.map((uidRecord) => (
                    <div
                      key={uidRecord.uid}
                      className="border border-gray-200 rounded-lg p-4 hover:bg-blue-50 cursor-pointer transition-colors"
                      onClick={() => fetchPurchaseTrail(uidRecord.uid)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-mono text-sm font-semibold text-blue-600">
                            {uidRecord.uid}
                          </div>
                          {uidRecord.item && (
                            <div className="text-sm font-medium text-gray-900 mt-1">
                              {uidRecord.item.name} ({uidRecord.item.code})
                            </div>
                          )}
                          <div className="text-sm text-gray-600 mt-1">
                            Type: {uidRecord.entity_type} | Status:{" "}
                            {uidRecord.status}
                          </div>
                          {uidRecord.batch_number && (
                            <div className="text-xs text-gray-500 mt-1">
                              Batch: {uidRecord.batch_number}
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-1">
                            Location: {uidRecord.location || "N/A"}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatDate(uidRecord.created_at)}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-blue-600">
                        Click to view purchase trail →
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Purchase Trail Modal - Same as BOM page */}
      {showTrailModal && purchaseTrail && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F6]">
          <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white">
            <div className="shrink-0 border-b border-[#E8DCC4] bg-white px-5 py-3">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-[#4A3426]">
                    Purchase Trail
                  </h2>
                  <p className="text-sm text-[#7A6555] mt-1">
                    UID: {purchaseTrail.uid}
                  </p>
                </div>
                <button
                  onClick={() => setShowTrailModal(false)}
                  className="text-2xl text-gray-500"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">📦 Item</h3>
                <div className="text-sm">
                  <span className="text-gray-600">Code:</span>{" "}
                  {purchaseTrail.item.code} |{" "}
                  <span className="text-gray-600">Name:</span>{" "}
                  {purchaseTrail.item.name}
                </div>
              </div>
              {purchaseTrail.supplier && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-semibold text-green-900 mb-2">
                    🏭 Supplier
                  </h3>
                  <div className="text-sm">
                    {purchaseTrail.supplier.name} -{" "}
                    {purchaseTrail.supplier.contact_person}
                  </div>
                </div>
              )}
              {purchaseTrail.purchase_order && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 className="font-semibold text-purple-900 mb-2">📋 PO</h3>
                  <div className="text-sm">
                    {purchaseTrail.purchase_order.po_number} |{" "}
                    {formatDate(purchaseTrail.purchase_order.order_date)} | ₹
                    {purchaseTrail.purchase_order.total_amount.toLocaleString()}
                  </div>
                </div>
              )}
              {purchaseTrail.grn && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h3 className="font-semibold text-amber-900 mb-2">📥 GRN</h3>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                    <div>
                      <span className="text-gray-600">GRN Number:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.grn.grn_number}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Receipt Date:</span>
                      <span className="ml-2 font-medium">
                        {formatDate(
                          purchaseTrail.grn.receipt_date ||
                            purchaseTrail.grn.received_date ||
                            "",
                        )}
                      </span>
                    </div>
                    {purchaseTrail.grn.received_quantity !== undefined && (
                      <div>
                        <span className="text-gray-600">Quantity:</span>
                        <span className="ml-2 font-medium">
                          {purchaseTrail.grn.received_quantity}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-600">Invoice No:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.grn.invoice_number || "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Invoice Date:</span>
                      <span className="ml-2 font-medium">
                        {formatDate(purchaseTrail.grn.invoice_date || "")}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Invoice File:</span>
                      {purchaseTrail.grn.invoice_file_url ? (
                        <span className="ml-2 inline-flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              handleViewInvoice(
                                purchaseTrail.grn!.invoice_file_url!,
                                purchaseTrail.grn!.invoice_file_name,
                              )
                            }
                            className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {purchaseTrail.grn.invoice_file_name || "Open"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleDownloadInvoice(
                                purchaseTrail.grn!.invoice_file_url!,
                                purchaseTrail.grn!.invoice_file_name,
                              )
                            }
                            className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            <Download className="h-4 w-4" /> Download
                          </button>
                        </span>
                      ) : (
                        <span className="ml-2 font-medium">-</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {(purchaseTrail.lifecycle?.length ?? 0) > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    🕐 Timeline
                  </h3>
                  <div className="space-y-3">
                    {purchaseTrail.lifecycle?.map((event, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="w-2 h-2 bg-amber-600 rounded-full mt-1"></div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{event.stage}</p>
                          <p className="text-xs text-gray-600">
                            {event.location} - {event.reference}
                          </p>
                          <p className="text-xs text-gray-400">
                            {formatDate(event.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GRN Reversal Dialog */}
      {reverseTargetGRN && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl">
            <div className="border-b border-[#E8DCC4] px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Goods receipt reversal
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-[#2D1B12]">
                    Reverse {reverseTargetGRN.grn_number}
                  </h3>
                  <p className="mt-1 text-sm text-[#6B5B4D]">
                    Stock and accounting impact will be reversed with an audit
                    trail.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReverseTargetGRN(null);
                    setReverseReason("");
                  }}
                  className="rounded-lg p-2 text-[#7A6555] hover:bg-[#F5EFE3]"
                  aria-label="Close reversal dialog"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="space-y-3 px-6 py-5">
              <label
                className="block text-sm font-semibold text-[#4A3426]"
                htmlFor="grn-reversal-reason"
              >
                Reversal reason <span className="text-red-600">*</span>
              </label>
              <textarea
                id="grn-reversal-reason"
                value={reverseReason}
                onChange={(event) => setReverseReason(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-[#D7C3A3] px-3 py-2 text-sm text-gray-900 focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#E8DCC4]"
                placeholder="Example: Wrong invoice quantity / duplicate GRN / material returned to supplier..."
                autoFocus
              />
              <p className="text-xs text-[#7A6555]">
                This note is saved in the GRN reversal history for audit review.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4">
              <ErpButton
                variant="secondary"
                onClick={() => {
                  setReverseTargetGRN(null);
                  setReverseReason("");
                }}
                disabled={submitting}
              >
                Cancel
              </ErpButton>
              <ErpButton
                variant="danger"
                onClick={handleReverseGRN}
                disabled={submitting || !reverseReason.trim()}
              >
                <RotateCcw className="h-4 w-4" />
                Reverse GRN
              </ErpButton>
            </div>
          </div>
        </div>
      )}

      {/* Alert Popup */}
      {alertMessage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start">
              <div
                className={`flex-shrink-0 ${
                  alertMessage.type === "success"
                    ? "text-green-500"
                    : alertMessage.type === "error"
                      ? "text-red-500"
                      : "text-blue-500"
                }`}
              >
                {alertMessage.type === "success" && (
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
                {alertMessage.type === "error" && (
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
                {alertMessage.type === "info" && (
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
              </div>
              <div className="ml-3 flex-1">
                <h3
                  className={`text-sm font-medium ${
                    alertMessage.type === "success"
                      ? "text-green-800"
                      : alertMessage.type === "error"
                        ? "text-red-800"
                        : "text-blue-800"
                  }`}
                >
                  {alertMessage.type === "success"
                    ? "Success"
                    : alertMessage.type === "error"
                      ? "Error"
                      : "Information"}
                </h3>
                <div className="mt-2 text-sm text-gray-700">
                  {alertMessage.message}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <button
                onClick={() => setAlertMessage(null)}
                className={`w-full px-4 py-2 text-sm font-medium text-white rounded-md ${
                  alertMessage.type === "success"
                    ? "bg-green-600 hover:bg-green-700"
                    : alertMessage.type === "error"
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QC Accept Modal */}
      {showQCModal && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F6]">
          <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white">
            <div className="shrink-0 border-b border-[#E8DCC4] bg-white px-5 py-3 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">
                🔍 QC Inspection
              </h2>
              <button
                onClick={() => setShowQCModal(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#7A6555] hover:bg-[#F5EFE3] hover:text-[#4A3426]"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* QC Metadata Section */}
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  QC Information
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Invoice Number
                    </label>
                    <input
                      type="text"
                      value={qcMetadata.invoiceNumber}
                      onChange={(e) =>
                        setQcMetadata({
                          ...qcMetadata,
                          invoiceNumber: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Invoice #"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      QC Date *
                    </label>
                    <DateInput
                      max={todayDate}
                      value={qcMetadata.qcDate}
                      onChange={(value) =>
                        setQcMetadata({ ...qcMetadata, qcDate: value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                {(selectedGRN?.remarks || (selectedGRN as any)?.notes) && (
                  <div className="mt-4 pt-4 border-t border-amber-200">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      GRN Notes
                    </label>
                    <p className="text-sm text-gray-600 italic whitespace-pre-wrap">
                      {selectedGRN?.remarks || (selectedGRN as any)?.notes}
                    </p>
                  </div>
                )}
                {(selectedGRN?.invoice_file_url ||
                  (selectedGRN as any)?.additional_invoice_files?.length >
                    0) && (
                  <div className="mt-4 pt-4 border-t border-amber-200">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      GRN Attachments
                    </label>
                    <div className="flex flex-col gap-1 mt-1">
                      {selectedGRN?.invoice_file_url && (
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={() =>
                              handleViewInvoice(
                                selectedGRN.invoice_file_url!,
                                selectedGRN.invoice_file_name,
                              )
                            }
                            className="inline-block text-blue-600 hover:text-blue-800 underline cursor-pointer text-left text-sm"
                          >
                            View Invoice{" "}
                            {selectedGRN.invoice_file_name
                              ? `(${selectedGRN.invoice_file_name})`
                              : ""}
                          </button>
                          <button
                            onClick={() =>
                              void handleDownloadInvoice(
                                selectedGRN.invoice_file_url!,
                                selectedGRN.invoice_file_name,
                              )
                            }
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline cursor-pointer text-left text-sm"
                          >
                            <Download className="h-4 w-4" /> Download
                          </button>
                        </div>
                      )}
                      {Array.isArray(
                        (selectedGRN as any).additional_invoice_files,
                      ) &&
                        (selectedGRN as any).additional_invoice_files.map(
                          (f: any, i: number) => (
                            <button
                              key={i}
                              onClick={() => handleViewInvoice(f.url, f.name)}
                              className="inline-block text-blue-600 hover:text-blue-800 underline cursor-pointer text-left text-sm"
                            >
                              Additional Attachment {i + 1}{" "}
                              {f.name ? `(${f.name})` : ""}
                            </button>
                          ),
                        )}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {qcFormData.map((item, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="font-semibold text-gray-900">
                          {item.itemName}
                        </div>
                        <div className="text-sm text-gray-600">
                          Code: {item.itemCode}
                        </div>
                        {item.notes && (
                          <div className="text-sm text-gray-500 italic mt-1 bg-white p-2 rounded border border-gray-200">
                            Item Note: {item.notes}
                          </div>
                        )}
                      </div>
                      <div className="text-sm text-gray-600">
                        Received:{" "}
                        <span className="font-semibold">
                          {item.receivedQty}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Accepted Quantity *
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={item.receivedQty}
                          value={item.acceptedQty}
                          onChange={(e) => {
                            const accepted = parseFloat(e.target.value) || 0;
                            const rejected = item.receivedQty - accepted;
                            const newData = [...qcFormData];
                            newData[index] = {
                              ...item,
                              acceptedQty: accepted,
                              rejectedQty: Math.max(0, rejected),
                            };
                            setQcFormData(newData);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Rejected Quantity
                        </label>
                        <input
                          type="number"
                          value={item.rejectedQty}
                          readOnly
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100"
                        />
                      </div>
                    </div>

                    {item.rejectedQty > 0 && (
                      <div className="mt-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Rejection Reason *
                        </label>
                        <input
                          type="text"
                          value={item.rejectionReason}
                          onChange={(e) => {
                            const newData = [...qcFormData];
                            newData[index] = {
                              ...item,
                              rejectionReason: e.target.value,
                            };
                            setQcFormData(newData);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          placeholder="Enter reason for rejection"
                        />
                      </div>
                    )}

                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        QC Notes
                      </label>
                      <textarea
                        value={item.qcNotes}
                        onChange={(e) => {
                          const newData = [...qcFormData];
                          newData[index] = { ...item, qcNotes: e.target.value };
                          setQcFormData(newData);
                        }}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Optional inspection notes"
                      />
                    </div>

                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Upload QC Photos / Reports (PNG, JPG, PDF)
                      </label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,application/pdf"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          files.forEach((file) =>
                            handleQCFileSelect(file, index),
                          );
                          // Clear the input so the same file can be uploaded again if needed
                          e.target.value = "";
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                      {item.qcFiles && item.qcFiles.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs font-medium text-gray-700">
                            Uploaded Files ({item.qcFiles.length}):
                          </div>
                          {item.qcFiles.map((file, fileIndex) => (
                            <div
                              key={fileIndex}
                              className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded"
                            >
                              <span className="flex-1 truncate">
                                📎 {file.name}
                              </span>
                              <div className="flex gap-2 ml-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleViewInvoice(file.url, file.name)
                                  }
                                  className="text-blue-600 hover:text-blue-800 underline"
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRemoveQCFile(index, fileIndex)
                                  }
                                  className="text-red-600 hover:text-red-800 font-bold"
                                  title="Remove file"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-t border-[#E8DCC4] bg-white px-5 py-3 flex justify-end gap-3">
              <button
                onClick={() => setShowQCModal(false)}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              {canEditGRN && (
                <button
                  onClick={async () => {
                    try {
                      // Validate
                      const hasRejectedWithoutReason = qcFormData.some(
                        (item) =>
                          item.rejectedQty > 0 && !item.rejectionReason?.trim(),
                      );

                      if (hasRejectedWithoutReason) {
                        setAlertMessage({
                          type: "error",
                          message:
                            "Please provide rejection reason for all rejected items",
                        });
                        return;
                      }

                      if (!qcMetadata.qcDate) {
                        setAlertMessage({
                          type: "error",
                          message: "QC Date is required",
                        });
                        return;
                      }

                      if (!selectedGRN) return;

                      const token = localStorage.getItem("accessToken");
                      const response = await fetch(
                        `/api/v1/purchase/grn/${selectedGRN.id}/qc-accept`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                          },
                          body: JSON.stringify({
                            items: qcFormData,
                            metadata: qcMetadata,
                          }),
                        },
                      );

                      if (response.ok) {
                        const result = await response.json().catch(() => null);
                        const generatedUidPrintItems = Array.isArray(
                          result?.generatedUidPrintItems,
                        )
                          ? (
                              result.generatedUidPrintItems as GeneratedUidPrintItem[]
                            )
                              .map((item) => ({
                                itemId: String(item?.itemId || "").trim(),
                                itemCode: String(item?.itemCode || "").trim(),
                                itemName: String(item?.itemName || "").trim(),
                                acceptedQty: Number(item?.acceptedQty || 0),
                                generatedUids: Array.isArray(
                                  item?.generatedUids,
                                )
                                  ? item.generatedUids
                                      .map((uid) => String(uid || "").trim())
                                      .filter(Boolean)
                                  : [],
                              }))
                              .filter((item) => item.generatedUids.length > 0)
                          : [];

                        setAlertMessage({
                          type: "success",
                          message:
                            generatedUidPrintItems.length > 0
                              ? `QC inspection completed successfully. ${generatedUidPrintItems.reduce((sum, item) => sum + item.generatedUids.length, 0)} UID(s) generated and opened for print.`
                              : "QC inspection completed successfully!",
                        });
                        setShowQCModal(false);
                        fetchGRNs();
                        setShowViewModal(false);

                        if (selectedGRN && generatedUidPrintItems.length > 0) {
                          await printGeneratedGrnUids({
                            grnNumber: selectedGRN.grn_number,
                            qcDate: qcMetadata.qcDate,
                            qcBy: resolveQcUserLabel(qcMetadata.qcBy),
                            items: generatedUidPrintItems,
                          });
                        }
                      } else {
                        const errorData = await response.json();
                        setAlertMessage({
                          type: "error",
                          message: `QC inspection failed: ${errorData.message || "Unknown error"}`,
                        });
                      }
                    } catch (error) {
                      setAlertMessage({
                        type: "error",
                        message: "Failed to complete QC inspection",
                      });
                    }
                  }}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  ✓ Complete QC Inspection
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GRNPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-gray-500">Loading...</div>}
    >
      <GRNContent />
    </Suspense>
  );
}
