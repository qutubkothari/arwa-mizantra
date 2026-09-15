'use client';

import { useState, useEffect, Suspense, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '../../../../../lib/api-client';
import { hasMakerCheckerOverride, hasModulePermission, readStoredUser } from '@/lib/rbac';
import { getTodayDateInputValue } from '@/lib/date';
import { loadDeliveryAddresses, saveDeliveryAddress, type DeliveryAddressOption } from '@/lib/delivery-addresses';
import DateInput from '../../../../components/ui/DateInput';
import DrawingManager from '../../../../components/DrawingManager';
import SearchableSelect from '../../../../components/SearchableSelect';
import RndTemporaryItemModal, { type RndTemporaryItem } from '../../../../components/RndTemporaryItemModal';
import { useSelection } from '../../../../hooks/useSelection';
import { useEscapeKey } from '../../../../hooks/useEscapeKey';
import DuplicateWarning, { useDuplicateDetection } from '../../../../components/DuplicateWarning';
import { ListTable, type ListTableColumn } from '../../../../components/ui/ListTable';
import { confirmDialog } from '../../../../components/ui/ConfirmDialog';
import { ErpButton, ErpMetricStrip, ErpPageHeader } from '../../../../components/ui/ErpPrimitives';
import {
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  GitBranch,
  Mail,
  Pencil,
  Plus,
  Printer,
  Save,
  Send,
  Trash2,
  Truck,
  X,
} from 'lucide-react';

const ITEM_CATEGORY_ALIASES: Record<string, string> = {
  RAW_MATERIALS: 'RAW_MATERIAL',
  SERVICE: 'SERVICES',
};

const PAYMENT_TERM_OPTIONS = [
  { value: 'NET_15', label: 'Net 15 Days' },
  { value: 'NET_30', label: 'Net 30 Days' },
  { value: 'NET_45', label: 'Net 45 Days' },
  { value: 'NET_60', label: 'Net 60 Days' },
  { value: 'ADVANCE', label: 'Advance Payment' },
  { value: 'COD', label: 'Cash on Delivery' },
  { value: 'AGAINST_DELIVERY', label: 'Against Delivery' },
  { value: 'AGAINST_PROFORMA', label: 'Against Proforma Invoice' },
];

const isStandardPaymentTerm = (value: string) => PAYMENT_TERM_OPTIONS.some((option) => option.value === value);
const PAYMENT_TERM_LABELS = PAYMENT_TERM_OPTIONS.reduce<Record<string, string>>((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

function parsePoTermsMetadata(value: unknown): Record<string, any> {
  try {
    if (value && typeof value === 'string' && value.trim().startsWith('{')) {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
    if (value && typeof value === 'object') return value as Record<string, any>;
  } catch {}
  return {};
}

function resolvePoPaymentTermsLabel(po: any): string {
  const metadata = parsePoTermsMetadata(po?.terms_and_conditions);
  const customText = String(
    metadata.paymentTermsText ||
    metadata.payment_terms_text ||
    metadata.customPaymentTerms ||
    metadata.custom_payment_terms ||
    '',
  ).trim();
  if (customText) return customText;

  const raw = String(po?.payment_terms || po?.paymentTerms || '').trim();
  if (!raw) return '-';
  if (raw === 'CUSTOM') return 'Custom / Other';
  return PAYMENT_TERM_LABELS[raw] || raw;
}

function normalizeItemCategory(category: unknown): string {
  const value = String(category ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  return ITEM_CATEGORY_ALIASES[value] || value;
}

const AUTO_REFRESH_MS = 30000;

const inrFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtINR(val: number | undefined | null): string {
  return inrFmt.format(val ?? 0);
}

function fmtRoundedINR(val: number | undefined | null): string {
  return inrFmt.format(Math.round(Number(val ?? 0)));
}

function calcRoundingAdjustment(val: number | undefined | null): number {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Number((Math.round(n) - n).toFixed(2));
}

function fmtPercent(val: number | undefined | null): string {
  const value = Number(val || 0) || 0;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function calcFreightGstAmount(freightAmount: number | undefined | null, applicable: boolean, percent: number | undefined | null): number {
  const base = Number(freightAmount || 0) || 0;
  const rate = Number(percent || 0) || 0;
  if (!applicable || base <= 0 || rate <= 0) return 0;
  return Number(((base * rate) / 100).toFixed(2));
}

function calcPoLineTotal(quantity: number, unitPrice: number, discountPercent: number, taxRate: number): number {
  const grossAmount = Math.max(0, Number(quantity || 0) * Number(unitPrice || 0));
  const discountAmount = grossAmount * (Math.max(0, Number(discountPercent || 0)) / 100);
  const taxableAmount = Math.max(0, grossAmount - discountAmount);
  return taxableAmount + (taxableAmount * Math.max(0, Number(taxRate || 0))) / 100;
}

function recalcPoItem(item: PurchaseOrderFormItem, forceTaxRate?: number): PurchaseOrderFormItem {
  const taxRate = forceTaxRate ?? item.taxRate ?? 0;
  return {
    ...item,
    taxRate,
    totalPrice: calcPoLineTotal(item.quantity, item.unitPrice, item.discount || 0, taxRate),
  };
}

function fmtDate(value: unknown): string {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN');
}

function FullScreenPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

function ObjectPageNav({ sections }: { sections: Array<{ id: string; label: string }> }) {
  return (
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#E8DCC4] bg-white px-5" aria-label="Purchase order sections">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="min-h-11 shrink-0 border-b-2 border-transparent px-3 text-sm font-semibold text-[#7A6555] transition-colors hover:border-[#C8AC7A] hover:bg-[#FAF9F6] hover:text-[#4A3426] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6F47]"
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

function ObjectPageTabs({
  sections,
  activeId,
  onChange,
}: {
  sections: Array<{ id: string; label: string }>;
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#E8DCC4] bg-white px-5 py-3"><label className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">Purchase order section</label><select value={activeId} onChange={(event) => onChange(event.target.value)} className="min-w-56 rounded-md border border-[#D8C8AA] bg-white px-3 py-2 text-sm font-semibold text-[#4A3426]">{sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></div>
  );
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  pr_id?: string;
  project_id?: string | null;
  project_name?: string | null;
  pr?: {
    id: string;
    pr_number: string;
  } | null;
  vendor: {
    id?: string;
    name: string;
    contact_person: string;
    billing_line2?: string;
    metadata?: { billingLine2?: string } | null;
    street?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    email?: string;
    phone?: string;
    tax_id?: string;
  };
  po_date: string;
  delivery_date: string;
  payment_terms?: string;
  payment_terms_code?: string;
  delivery_terms?: string;
  status: string;
  total_amount: number;
  remarks?: string;
  payment_status?: string;
  payment_notes?: string;
  customs_duty?: number;
  other_charges?: number;
  freight_amount?: number;
  freight_gst_applicable?: boolean;
  freight_gst_percent?: number;
  terms_and_conditions?: string | object;
  updated_by?: string;
  edit_count?: number;
  last_edited_at?: string;
  is_partial_po?: boolean;
  receipt_status?: 'OPEN' | 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED' | string;
  receipt_progress?: {
    ordered_qty?: number;
    received_qty?: number;
    remaining_qty?: number;
    received_percent?: number;
  };
  purchase_order_items: Array<{
    id?: string;
    item_id?: string;
    item_code?: string;
    item_name?: string;
    item: { name: string; code?: string; uom?: string };
    quantity: number;
    ordered_qty?: number;
    received_qty?: number;
    remaining_qty?: number;
    rate?: number;
    discount_percent?: number;
    amount?: number;
    uom?: string;
    serial_no?: number;
    pr_item_id?: string;
    payment_terms?: string | null;
    delivery_terms?: string | null;
  }>;
}

type PurchaseOrderFormItem = {
  poItemId?: string;
  prItemId?: string;
  itemId?: string;
  itemCode?: string;
  itemName?: string;
  vendorId?: string;
  vendorName?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  totalPrice: number;
  specifications?: string;
  uom?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  includeDrawing?: boolean;
  selectedDrawingId?: string;
};

type DrawingOption = {
  id: string;
  file_name?: string;
  version?: number;
  is_active?: boolean;
  created_at?: string;
};

type PurchaseOrderFormData = {
  vendorId: string;
  projectId: string;
  orderDate: string;
  expectedDelivery: string;
  paymentTerms: string;
  paymentStatus: string;
  paymentNotes: string;
  deliveryAddress: string;
  deliveryContactPerson: string;
  deliveryContactPhone: string;
  notes: string;
  quotationRef: string;
  projectName: string;
  freightTerms: string;
  freightAmount: number;
  freightGstApplicable: boolean;
  freightGstPercent: number;
  customsDuty: number;
  otherCharges: number;
  isImportPurchase: boolean;
  supplierCurrency: string;
  customsExchangeRate: number;
  importNotes: string;
  trackingNumber: string;
  shippedDate: string;
  estimatedDeliveryDate: string;
  carrierName: string;
  trackingUrl: string;
  deliveryStatus: string;
  sent_at?: string;
  approved_at?: string;
  attachments: Array<{ url: string; name: string }>;
  items: PurchaseOrderFormItem[];
};

function PurchaseOrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const todayDate = getTodayDateInputValue();
  const prId = searchParams?.get('prId');
  const viewId = searchParams?.get('viewId');
  const [currentUser, setCurrentUser] = useState<ReturnType<typeof readStoredUser>>(null);
  const currentUserId = String((currentUser as any)?.id || (currentUser as any)?.userId || '');
  const canApprovePO = hasModulePermission(currentUser, 'Purchase Management', 'approve');
  const canCreatePO = hasModulePermission(currentUser, 'Purchase Management', 'create');
  const canEditPO = hasModulePermission(currentUser, 'Purchase Management', 'edit');
  const canDeletePO = hasModulePermission(currentUser, 'Purchase Management', 'delete');
  const canDownloadPO =
    hasModulePermission(currentUser, 'Purchase Management', 'download') ||
    hasModulePermission(currentUser, 'Purchase Management', 'view');
  const canBypassMakerChecker = hasMakerCheckerOverride(currentUser);
  const canEditPendingPO = (po: PurchaseOrder) =>
    canEditPO &&
    String(po.status || '').toUpperCase() === 'PENDING' &&
    (String((po as any).created_by || '') === currentUserId || canBypassMakerChecker);

  useEffect(() => {
    setCurrentUser(readStoredUser());
  }, []);

  const [purchaseRequisitions, setPurchaseRequisitions] = useState<
    Array<{ id: string; pr_number: string; department?: string; status?: string }>
  >([]);
  const [loadingPrList, setLoadingPrList] = useState(false);
  
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  type VendorOption = { id: string; name: string; contact_person: string };
  type POAttachment = { url: string; name: string };
  type ProjectOption = { id: string; project_name: string; project_code?: string; department?: string };
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; employee_name: string; employee_code?: string; phone?: string; mobile?: string; phone_number?: string; contact_number?: string; mobile_number?: string }>>([]);
  const [items, setItems] = useState<Array<{
    id: string;
    code: string;
    name: string;
    uom: string;
    category?: string;
    standard_cost?: number;
    selling_price?: number;
    drawing_required?: string;
    oem_part_no?: string;
    oem_name?: string;
    description?: string;
  }>>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [poViewSection, setPoViewSection] = useState('overview');
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [showPOEmailPreview, setShowPOEmailPreview] = useState(false);
  const [poEmailPreviewLoading, setPoEmailPreviewLoading] = useState(false);
  const [poEmailSending, setPoEmailSending] = useState(false);
  const [poEmailPreview, setPoEmailPreview] = useState<any>(null);
  const [poEmailTo, setPoEmailTo] = useState('');
  const [poEmailSubject, setPoEmailSubject] = useState('');
  const [poEmailMessage, setPoEmailMessage] = useState('');
  const [editingPOId, setEditingPOId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<'create' | 'edit' | 'tracking'>('create');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterVendor, setFilterVendor] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingPR, setLoadingPR] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>('po_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard to prevent rapid double-clicks before state updates
  const isSubmittingRef = useRef(false);
  // Reminder links use ?viewId=. Keep track of that opening so the URL can
  // be cleared on close; otherwise clicking the same reminder again is a
  // no-op because Next.js sees the same route/query string.
  const reminderViewOpenedRef = useRef<string | null>(null);
  // Idempotency key to prevent duplicate API calls
  const [lastSubmitKey, setLastSubmitKey] = useState<string | null>(null);
  const [showDrawingManager, setShowDrawingManager] = useState(false);
  const [selectedItemForDrawing, setSelectedItemForDrawing] = useState<{ id: string; code: string; name: string; mandatory: boolean } | null>(null);
  const [drawingOptionsByItemId, setDrawingOptionsByItemId] = useState<Record<string, DrawingOption[]>>({});
  const [drawingOptionsLoading, setDrawingOptionsLoading] = useState<Record<string, boolean>>({});
  const [pendingItemIndex, setPendingItemIndex] = useState<number | null>(null);
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [currentPrId, setCurrentPrId] = useState<string | null>(null);
  const [currentPrDepartment, setCurrentPrDepartment] = useState('');
  const [rfqRespondedVendorIds, setRfqRespondedVendorIds] = useState<string[]>([]);
  const [rfqHistory, setRfqHistory] = useState<any[]>([]);
  const { duplicateState, checkDuplicates, handleProceed, handleCancel } = useDuplicateDetection();
  type PriceHistoryRecord = { po_number: string; po_date: string; unit_price: number; quantity: number; po_status: string };
  const [priceHistory, setPriceHistory] = useState<Record<string, PriceHistoryRecord[]>>({});
  const [stockInfo, setStockInfo] = useState<Record<string, { total_quantity: number; available_quantity: number; allocated_quantity: number }>>({});
  const [hoveredItem, setHoveredItem] = useState<number | null>(null);
  const [deliveryAddresses, setDeliveryAddresses] = useState<DeliveryAddressOption[]>([]);
  const [deliveryAddressName, setDeliveryAddressName] = useState('');
  const [deliveryAddressSaving, setDeliveryAddressSaving] = useState(false);

  // Row target used only by the temporary R&D item creator.
  const [quickCreateItemIndex, setQuickCreateItemIndex] = useState<number | null>(null);
  const [showRndTemporaryItem, setShowRndTemporaryItem] = useState(false);

  // PO attachment upload state
  const [poAttachmentUploading, setPoAttachmentUploading] = useState(false);
  const [supplierAttachments, setSupplierAttachments] = useState<Record<string, POAttachment[]>>({});

  // PO Trail state
  const [showTrailModal, setShowTrailModal] = useState(false);
  const [trailData, setTrailData] = useState<any>(null);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailPO, setTrailPO] = useState<PurchaseOrder | null>(null);

  const orderSelection = useSelection(orders);

  // Form state
  const [formData, setFormData] = useState<PurchaseOrderFormData>({
    vendorId: '',
    projectId: '',
    orderDate: getTodayDateInputValue(),
    expectedDelivery: '',
    paymentTerms: 'NET_30',
    paymentStatus: 'UNPAID',
    paymentNotes: '',
    deliveryAddress: '',
    deliveryContactPerson: '',
    deliveryContactPhone: '',
    notes: '',
    quotationRef: '',
    projectName: '',
    freightTerms: '',
    freightAmount: 0,
    freightGstApplicable: false,
    freightGstPercent: 0,
    customsDuty: 0,
    otherCharges: 0,
    isImportPurchase: false,
    supplierCurrency: 'INR',
    customsExchangeRate: 0,
    importNotes: '',
    trackingNumber: '',
    shippedDate: '',
    estimatedDeliveryDate: '',
    carrierName: '',
    trackingUrl: '',
    deliveryStatus: 'PENDING',
    attachments: [],
    items: [],
  });

  const isServiceOrder = formData.items.length > 0 && formData.items.every(item => {
    const matchedItem = items.find(i => i.id === item.itemId || i.code === item.itemCode);
    return normalizeItemCategory((matchedItem as any)?.category) === 'SERVICES';
  });
  const isProjectNameLockedFromPR = Boolean(currentPrId);
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.project_name,
    subtitle: [project.project_code, project.department].filter(Boolean).join(' - '),
  }));
  const prSupplierGroups = useMemo(() => {
    if (!currentPrId) return [];
    const groups = new Map<string, { vendorId: string; vendorName: string; itemCount: number; quantity: number }>();
    formData.items.forEach((item) => {
      const vendorId = String(item.vendorId || '').trim();
      if (!vendorId) return;
      const vendorMasterName = vendors.find((vendor) => String(vendor.id) === vendorId)?.name;
      const existing = groups.get(vendorId) || {
        vendorId,
        vendorName: String(vendorMasterName || item.vendorName || 'Selected supplier'),
        itemCount: 0,
        quantity: 0,
      };
      existing.itemCount += 1;
      existing.quantity += Number(item.quantity || 0);
      groups.set(vendorId, existing);
    });
    return Array.from(groups.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }, [currentPrId, formData.items, vendors]);

  const isSupplierWisePRSplit = Boolean(currentPrId && prSupplierGroups.length > 1);
  const getVendorDisplayName = (vendorId: string) =>
    prSupplierGroups.find((group) => String(group.vendorId) === String(vendorId))?.vendorName ||
    vendors.find((vendor) => String(vendor.id) === String(vendorId))?.name ||
    'Selected supplier';

  useEffect(() => {
    if (!showModal) return;
    if (!formData.isImportPurchase && String(formData.supplierCurrency || 'INR').toUpperCase() === 'INR') return;
    if (!formData.items.some((item) => Number(item.taxRate || 0) !== 0)) return;
    setFormData((current) => ({
      ...current,
      freightGstApplicable: false,
      freightGstPercent: 0,
      items: current.items.map((item) => recalcPoItem(item, 0)),
    }));
  }, [formData.isImportPurchase, formData.supplierCurrency, showModal]);

  useEffect(() => {
    if (!showModal) return;
    if (items.length > 0) return;
    fetchItems();
  }, [showModal, items.length]);

  useEffect(() => {
    if (!showModal) return;
    loadDeliveryAddresses()
      .then(setDeliveryAddresses)
      .catch(() => setDeliveryAddresses([]));
  }, [showModal]);

  // Close modals on Escape key
  useEscapeKey(showViewModal, () => { setShowViewModal(false); setSelectedPO(null); });
  useEscapeKey(showTrailModal, () => setShowTrailModal(false));
  useEscapeKey(showPOEmailPreview, () => setShowPOEmailPreview(false));
  useEscapeKey(showDrawingManager, () => { setShowDrawingManager(false); setSelectedItemForDrawing(null); setPendingItemIndex(null); });

  // Fetch vendors on component mount
  useEffect(() => {
    fetchVendors();
    apiClient.get<any[]>('/projects?status=ACTIVE')
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]));
    apiClient.get<any[]>('/hr/employees').then(data => setUsers(Array.isArray(data) ? data : [])).catch(() => {});

    // Fetch PRs eligible for PO creation. Only fully approved PRs may be
    // selected for PO conversion; submitted/awaiting-approval PRs remain in
    // the PR approval register but must not appear here.
    setLoadingPrList(true);
    apiClient.get<any[]>('/purchase/requisitions')
      .then((allPrs) => {
        const eligible = (Array.isArray(allPrs) ? allPrs : []).filter((pr: any) => {
          const s = String(pr.status || '').toUpperCase();
          const ws = String(pr.workflow_status || '').toUpperCase();
          return s === 'APPROVED'
            && ws !== 'PO_DONE' && ws !== 'GOODS_RCVD';
        });
        setPurchaseRequisitions(eligible.map((pr: any) => ({
          id: pr.id,
          pr_number: pr.pr_number,
          department: pr.department,
          status: pr.status,
        })));
      })
      .catch(() => {})
      .finally(() => setLoadingPrList(false));
  }, []);

  // Fetch orders on mount and when filters change
  useEffect(() => {
    fetchOrders();
  }, [filterStatus, filterVendor, searchTerm]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchOrders({ silent: true });
      if (showViewModal && selectedPO?.id) {
        refreshSelectedPODetail(selectedPO.id);
      }
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [filterStatus, searchTerm, showViewModal, selectedPO?.id]);

  // Load PR data if prId is in URL (convert PR to PO)
  useEffect(() => {
    if (prId && !showModal) {
      setShowModal(true);
      loadPRData(prId);
    }
  }, [prId]);

  // Auto-open PO details if viewId is in URL (from Action Required links)
  useEffect(() => {
    if (viewId && !showViewModal) {
      void handleViewDetails(viewId).then(() => {
        reminderViewOpenedRef.current = viewId;
      });
    }
  }, [viewId]);

  useEffect(() => {
    if (showViewModal || !viewId || reminderViewOpenedRef.current !== viewId) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('viewId');
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
    reminderViewOpenedRef.current = null;
  }, [showViewModal, viewId]);

  // Backfill missing itemId (and itemName) from itemCode once items master data loads.
  // Some PO payloads provide only item_code/item_name; SearchableSelect needs itemId.
  useEffect(() => {
    if (items.length === 0) return;

    setFormData((prev) => {
      const currentItems = Array.isArray(prev.items) ? prev.items : [];
      if (currentItems.length === 0) return prev;

      let changed = false;
      const patched = currentItems.map((row) => {
        if (String(row?.itemId || '').trim()) return row;
        const code = String(row?.itemCode || '').trim();
        if (!code) return row;
        const match = items.find((i) => String(i.code || '').trim() === code);
        if (!match?.id) return row;
        changed = true;
        return {
          ...row,
          itemId: String(match.id),
          itemCode: row.itemCode || String(match.code || ''),
          itemName: row.itemName || String(match.name || ''),
        };
      });

      return changed ? { ...prev, items: patched } : prev;
    });
  }, [items]);

  // Prefetch last purchase price for any item+vendor pairs shown in the create/edit modal
  useEffect(() => {
    const pairs = new Map<string, { itemId: string; vendorId: string }>();
    (formData.items || []).forEach((it) => {
      const rawItemId = String((it as any)?.itemId || '').trim();
      const code = String((it as any)?.itemCode || '').trim();
      const resolvedItemId =
        rawItemId ||
        String(items.find((i) => String(i.code).trim() === code)?.id || '').trim();
      const vendorId = String((it as any)?.vendorId || formData.vendorId || '').trim();
      if (resolvedItemId && vendorId) {
        pairs.set(`${resolvedItemId}-${vendorId}`, { itemId: resolvedItemId, vendorId });
      }
    });

    pairs.forEach(({ itemId, vendorId }, key) => {
      if (priceHistory[key] !== undefined) return;
      fetchPriceHistory(itemId, vendorId);
    });
  }, [formData.items, formData.vendorId, items, priceHistory]);

  // Prefetch last purchase prices for the approval/details (view) modal.
  // This handles the case where vendorId/itemId can only be resolved after
  // vendors/items master data finishes loading.
  useEffect(() => {
    if (!showViewModal || !selectedPO) return;

    const vendorId = resolveVendorIdFromPO(selectedPO);
    if (!vendorId) return;

    const poItems = Array.isArray((selectedPO as any)?.purchase_order_items)
      ? (selectedPO as any).purchase_order_items
      : [];

    const itemIds = poItems.map((it: any) => resolveItemIdFromPOLine(it)).filter(Boolean);
    itemIds.forEach((itemId: string) => {
      const key = `${itemId}-${vendorId}`;
      if (priceHistory[key] !== undefined) return;
      fetchPriceHistory(itemId, vendorId);
    });
  }, [showViewModal, selectedPO, vendors, items, priceHistory]);

  const fetchVendors = async (): Promise<VendorOption[]> => {
    try {
      const token = localStorage.getItem('accessToken');
      
      const response = await fetch('/api/v1/purchase/vendors?isActive=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      
      const data = await response.json();
      
      if (data && data.length > 0) {
      }
      
      // VERIFICATION FILTER DISABLED TEMPORARILY - uncomment below to re-enable
      // setVendors(Array.isArray(data) ? data.filter((v: any) => v.is_verified === true).sort((a: any, b: any) => a.name.localeCompare(b.name)) : []);
      const normalized = Array.isArray(data) ? data.sort((a: any, b: any) => a.name.localeCompare(b.name)) : [];
      setVendors((prev) => {
        const byId = new Map<string, VendorOption>();
        normalized.forEach((vendor: any) => {
          if (vendor?.id) byId.set(String(vendor.id), vendor);
        });
        prev.forEach((vendor) => {
          if (vendor?.id && !byId.has(String(vendor.id))) byId.set(String(vendor.id), vendor);
        });
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
      });
      return normalized;
    } catch (error) {
      return [];
    }
  };

  const ensureVendorOption = async (vendorId: string, fallbackName?: string): Promise<void> => {
    const normalizedVendorId = String(vendorId || '').trim();
    if (!normalizedVendorId) return;

    if (vendors.some((vendor) => String(vendor.id) === normalizedVendorId)) return;

    let option: VendorOption | null = null;
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/purchase/vendors/${normalizedVendorId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const vendor = await response.json();
        option = {
          id: normalizedVendorId,
          name: String(vendor?.name || vendor?.legal_name || fallbackName || normalizedVendorId),
          contact_person: String(vendor?.contact_person || ''),
        };
      }
    } catch {}

    if (!option && fallbackName) {
      option = {
        id: normalizedVendorId,
        name: fallbackName,
        contact_person: '',
      };
    }

    if (!option) return;

    setVendors((prev) => {
      if (prev.some((vendor) => String(vendor.id) === normalizedVendorId)) return prev;
      return [...prev, option as VendorOption].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const resolveVendorIdFromAny = (source: any, options?: { allowBareId?: boolean }): string => {
    const vendorId = String(
      source?.vendor_id ??
      source?.vendorId ??
      source?.preferred_vendor_id ??
      source?.preferredVendorId ??
      source?.preferred_vendor?.id ??
      source?.preferredVendor?.id ??
      source?.vendor?.vendor_id ??
      source?.vendor?.vendorId ??
      source?.vendor?.id ??
      (options?.allowBareId ? source?.id : '') ??
      '',
    ).trim();
    return vendorId;
  };

  const resolveVendorNameFromAny = (source: any): string => String(
    source?.vendor_name ??
    source?.vendorName ??
    source?.preferred_vendor_name ??
    source?.preferredVendorName ??
    source?.preferred_vendor?.name ??
    source?.preferredVendor?.name ??
    source?.vendor?.name ??
    source?.name ??
    source?.legal_name ??
    '',
  ).trim();

  const resolvePreferredVendorNameFromAny = (source: any): string => String(
    source?.vendor_name ??
    source?.vendorName ??
    source?.preferred_vendor_name ??
    source?.preferredVendorName ??
    source?.preferred_vendor?.name ??
    source?.preferredVendor?.name ??
    source?.vendor?.name ??
    '',
  ).trim();

  const fetchItems = async () => {
    setItemsLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      // Include inactive so historical PO lines can still resolve UOM.
      const response = await fetch('/api/v1/inventory/items?includeInactive=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      const normalized = Array.isArray(data)
        ? data.map((item: any) => ({
            ...item,
            category: normalizeItemCategory(item?.category),
            uom: resolveUomFromItem(item),
          }))
        : [];
      setItems(normalized);
    } catch (error) {
    } finally {
      setItemsLoading(false);
    }
  };

  const handleSaveDeliveryAddress = async () => {
    const address = formData.deliveryAddress.trim();
    if (!address) {
      toast.error('Enter a delivery address before saving');
      return;
    }

    setDeliveryAddressSaving(true);
    try {
      const next = await saveDeliveryAddress(deliveryAddressName, address);
      setDeliveryAddresses(next);
      setDeliveryAddressName('');
      toast.success('Delivery address saved');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save delivery address');
    } finally {
      setDeliveryAddressSaving(false);
    }
  };

  const handleDeleteDeliveryAddress = async (id: string) => {
    if (!confirm('Delete this saved address?')) return;
    try {
      const response = await fetch(`/api/v1/vendors/delivery-addresses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
      });
      if (!response.ok) throw new Error('Failed to delete address');
      setDeliveryAddresses(prev => prev.filter(a => a.id !== id));
      toast.success('Address deleted');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete address');
    }
  };

  const fetchPriceHistory = async (itemId: string, vendorId: string): Promise<PriceHistoryRecord[]> => {
    const key = `${itemId}-${vendorId}`;
    if (priceHistory[key] !== undefined) return priceHistory[key];

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `/api/v1/items/${itemId}/vendors/${vendorId}/price-history`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        setPriceHistory((prev) => ({ ...prev, [key]: [] }));
        return [];
      }

      const data = await response.json().catch(() => []);
      const normalized = Array.isArray(data) ? (data as PriceHistoryRecord[]) : [];
      setPriceHistory((prev) => ({ ...prev, [key]: normalized }));
      return normalized;
    } catch (error) {
      setPriceHistory((prev) => ({ ...prev, [key]: [] }));
    }

    return [];
  };

  const resolveVendorIdFromPO = (po: any): string => {
    const direct = String(po?.vendor_id || po?.vendorId || po?.vendor?.id || po?.vendor?.vendor_id || '').trim();
    if (direct) return direct;

    const vendorName = String(po?.vendor?.name || po?.vendor_name || '').trim().toLowerCase();
    if (!vendorName) return '';
    const match = vendors.find((v) => String(v?.name || '').trim().toLowerCase() === vendorName);
    return String(match?.id || '').trim();
  };

  const resolveItemIdFromPOLine = (poLine: any): string => {
    const direct = String(poLine?.item_id || poLine?.itemId || poLine?.item?.id || '').trim();
    if (direct) return direct;
    const code = String(poLine?.item?.code || poLine?.item_code || '').trim();
    if (!code) return '';
    const normalized = code.toUpperCase();
    const match = items.find((i) => String(i.code || '').trim().toUpperCase() === normalized);
    return String(match?.id || '').trim();
  };

  const resolveUomFromPOLine = (poLine: any): string => {
    const candidates = [
      poLine?.uom,
      poLine?.uom_name,
      poLine?.unit,
      poLine?.unit_name,
      poLine?.item?.uom,
      poLine?.item?.uom_name,
    ];
    const direct = candidates
      .map((v) => String(v || '').trim())
      .find((v) => v.length > 0);
    if (direct) return direct;

    const itemId = resolveItemIdFromPOLine(poLine);
    const code = String(poLine?.item?.code || poLine?.item_code || '').trim();
    const normalized = code ? code.toUpperCase() : '';
    const match = items.find(
      (i) => (itemId && String(i.id || '').trim() === itemId) || (normalized && String(i.code || '').trim().toUpperCase() === normalized),
    );
    return String(match?.uom || '').trim();
  };

  const resolveUomFromItem = (item: any): string => {
    return (
      String(item?.uom || '').trim() ||
      String(item?.uom_name || '').trim() ||
      String(item?.unit || '').trim() ||
      String(item?.unit_name || '').trim()
    );
  };

  const fetchStockInfo = async (itemId: string) => {
    if (stockInfo[itemId]) return; // Already fetched

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `/api/v1/items/${itemId}/stock`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.ok) {
        const data = await response.json();
        setStockInfo(prev => ({ ...prev, [itemId]: data }));
      }
    } catch (error) {
    }
  };

  const loadPRData = async (prId: string) => {
    try {
      setLoadingPR(true);
      setSupplierAttachments({});
      
      // Fetch fresh items data to ensure we have prices
      const token = localStorage.getItem('accessToken');
      const itemsResponse = await fetch('/api/v1/inventory/items', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const itemsData = await itemsResponse.json();
      const freshItems = itemsData || [];
      
      const prData = await apiClient.get(`/purchase/requisitions/${prId}/available-for-po`);
      
      // Store PR ID for later use
      setCurrentPrId(prId);
      setCurrentPrDepartment(String(prData.department || prData.project_department || '').trim());

      // Fetch RFQ responses for this PR so buyers can compare quotes before selecting a PO vendor.
      try {
        const rfqs: any[] = await apiClient.get(`/purchase/requisitions/${prId}/rfqs`);
        const normalizedRfqs = Array.isArray(rfqs) ? rfqs : [];
        setRfqHistory(normalizedRfqs);
        const respondedIds = normalizedRfqs
          .filter((r: any) => ['RECEIVED', 'RESPONDED'].includes(String(r.status || '').toUpperCase()))
          .map((r: any) => resolveVendorIdFromAny(r))
          .filter(Boolean);
        setRfqRespondedVendorIds(respondedIds);
      } catch {
        setRfqHistory([]);
        setRfqRespondedVendorIds([]);
      }
      
      // Map PR items to PO items and fetch preferred vendors
      const prItemsRaw = Array.isArray(prData.purchase_requisition_items) ? prData.purchase_requisition_items : [];
      const poItemsPromises = prItemsRaw.map(async (item: any) => {
        // Preserve the approved PR estimated rate when converting PR -> PO.
        // Master/preferred-vendor prices are only fallbacks; they must not silently
        // alter approved commercial values (e.g. 120.00 becoming 119.99).
        let unitPrice = Number(item.estimated_rate ?? item.estimatedRate ?? 0) || 0;
        const hasPrApprovedRate = unitPrice > 0;
        let preferredVendorId = resolveVendorIdFromAny(item);
        let preferredVendorName = resolveVendorNameFromAny(item);
        let itemId = item.item_id;
        
        // If no item_id, try to find by item_code
        if (!itemId && item.item_code && freshItems.length > 0) {
          const masterItem = freshItems.find((i: any) => i.code === item.item_code);
          if (masterItem) {
            itemId = masterItem.id;
          } else {
          }
        }
        
        if (itemId && freshItems.length > 0) {
          const masterItem = freshItems.find((i: any) => i.id === item.item_id);
          if (masterItem) {
            if (!preferredVendorId) preferredVendorId = resolveVendorIdFromAny(masterItem);
            if (!preferredVendorName) preferredVendorName = resolvePreferredVendorNameFromAny(masterItem);
            if (!hasPrApprovedRate) {
              unitPrice = masterItem.standard_cost || masterItem.selling_price || unitPrice;
            }
          }
        }
        
        if (itemId && freshItems.length > 0) {
          const masterItem = freshItems.find((i: any) => i.id === itemId);
          if (masterItem) {
            if (!preferredVendorId) preferredVendorId = resolveVendorIdFromAny(masterItem);
            if (!preferredVendorName) preferredVendorName = resolvePreferredVendorNameFromAny(masterItem);
            if (!hasPrApprovedRate) {
              unitPrice = masterItem.standard_cost || masterItem.selling_price || unitPrice;
            }
          }
        }
        
        // Fetch preferred vendor for this item only if the PR line did not already carry one.
        if (itemId && !preferredVendorId) {
          try {
            const vendorResponse = await fetch(`/api/v1/items/${itemId}/vendors/preferred`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            
            
            if (vendorResponse.ok) {
              const preferredVendor = await vendorResponse.json();
              const resolvedVendorId = resolveVendorIdFromAny(preferredVendor, { allowBareId: true });
              
              if (preferredVendor && resolvedVendorId) {
                preferredVendorId = resolvedVendorId;
                preferredVendorName = resolveVendorNameFromAny(preferredVendor) || preferredVendorName;
                // Use vendor price only as fallback when the PR line has no approved rate.
                if (!hasPrApprovedRate && preferredVendor.unit_price) {
                  unitPrice = preferredVendor.unit_price;
                }
              } else {
              }
            } else {
              const errorText = await vendorResponse.text();
            }
          } catch (error) {
          }
        } else {
        }
        
        const quantity = item.requested_qty || 0;
        const subtotal = quantity * unitPrice;
        const totalWithTax = subtotal + (subtotal * 18 / 100);
        
        // Get UOM from PR item or master item
        let uom = resolveUomFromItem(item);
        if (!uom && itemId && freshItems.length > 0) {
          const masterItem = freshItems.find((i: any) => i.id === itemId);
          if (masterItem) {
            uom = resolveUomFromItem(masterItem);
          }
        }
        
        return {
          prItemId: item.id ? String(item.id) : undefined,
          itemId: itemId || '',
          itemCode: item.item_code || '',
          itemName: item.item_name || '',
          uom: uom,
          vendorId: preferredVendorId,
          vendorName: preferredVendorName,
          quantity: quantity,
          unitPrice: unitPrice,
          taxRate: 18, // Default GST rate
          totalPrice: totalWithTax,
          specifications: item.remarks || '',
          paymentTerms: item.payment_terms || '',
          deliveryTerms: item.delivery_terms || '',
        };
      });

      const poItems = await Promise.all(poItemsPromises);

      const uniqueVendorIds = Array.from(
        new Set(poItems.map((item) => String(item.vendorId || '').trim()).filter(Boolean)),
      );
      if (uniqueVendorIds.length === 1) {
        const selectedVendorId = uniqueVendorIds[0];
        const selectedVendorName = poItems.find((item) => String(item.vendorId || '').trim() === selectedVendorId)?.vendorName;
        if (selectedVendorName) {
          setVendors((prev) => {
            if (prev.some((vendor) => String(vendor.id) === selectedVendorId)) return prev;
            return [...prev, { id: selectedVendorId, name: selectedVendorName, contact_person: '' }]
              .sort((a, b) => a.name.localeCompare(b.name));
          });
        }
        await ensureVendorOption(selectedVendorId, selectedVendorName);
      }
      const prRequiredDate = String(prData.required_date || prData.requiredDate || '').slice(0, 10);
      const prDeliveryAddress = String(prData.delivery_address || prData.deliveryAddress || '').trim();
      const prProjectId = String(prData.project_id || prData.projectId || '').trim();
      const prProjectName = String(prData.project_name || prData.projectName || '').trim();

      setFormData((prev) => ({
        ...prev,
        vendorId: uniqueVendorIds.length === 1 ? uniqueVendorIds[0] : prev.vendorId,
        expectedDelivery: prRequiredDate || prev.expectedDelivery,
        deliveryAddress: prDeliveryAddress || prev.deliveryAddress,
        projectId: prProjectId || prev.projectId,
        projectName: prProjectName || prev.projectName,
        notes: '',
        items: poItems,
      }));

      // Open modal automatically
      setShowModal(true);
      const autoSelectedCount = poItems.filter(item => item.vendorId).length;
      const supplierCount = uniqueVendorIds.length;
      const missingVendorCount = Math.max(0, poItems.length - autoSelectedCount);
      if (poItems.length === 0) {
        setAlertMessage({
          type: 'info',
          message: `PR ${prData.pr_number} has no remaining items available for PO.`,
        });
      } else {
        toast.info(
          supplierCount > 1
            ? `Loaded ${poItems.length} PR lines. Submit will create ${supplierCount} supplier-wise POs.`
            : `Loaded ${poItems.length} PR lines. ${autoSelectedCount} line(s) have a preferred vendor.`,
        );
        if (missingVendorCount > 0) {
          setAlertMessage({
            type: 'error',
            message: `${missingVendorCount} PR line(s) still need a supplier before PO creation.`,
          });
        } else {
          setAlertMessage(null);
        }
      }
    } catch (error) {
      setAlertMessage({ type: 'error', message: 'Failed to load PR data. Please try again.' });
    } finally {
      setLoadingPR(false);
    }
  };

  const fetchOrders = async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoading(true);
      }
      const params = new URLSearchParams();
      if (filterStatus !== 'ALL') params.append('status', filterStatus);
      if (filterVendor) params.append('vendorId', filterVendor);
      if (searchTerm) params.append('search', searchTerm);

      const data = await apiClient.get(`/purchase/orders?${params}`);
      if (data && data.length > 0) {
      }
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      setOrders([]);
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  };

  const refreshSelectedPODetail = async (poId: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/purchase/orders/${poId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      setSelectedPO(data);
    } catch {
    }
  };

  const actuallyCreatePO = async (poStatus: 'DRAFT' | 'PENDING' = 'DRAFT') => {
    // Layer 1: Synchronous ref check (prevents race conditions)
    if (isSubmittingRef.current) {
      return;
    }
    // Layer 2: React state check
    if (submitting) {
      return;
    }
    
    // Generate idempotency key from form data
    const submitKey = JSON.stringify({
      vendorId: formData.vendorId,
      items: formData.items.map(i => ({ id: i.itemId, vendorId: i.vendorId, qty: i.quantity })),
      total: formData.items.reduce((s, i) => s + i.totalPrice, 0),
      status: poStatus,
      ts: Date.now(), // Still allow if 5+ seconds passed
    });
    
    // Layer 3: Idempotency check (prevent exact duplicate within 5 seconds)
    if (lastSubmitKey && Math.abs(Date.now() - parseInt(lastSubmitKey.split('"ts":')[1]?.split(',')[0] || '0')) < 5000) {
      setAlertMessage({ type: 'error', message: 'Duplicate submission blocked. Please wait a moment.' });
      return;
    }
    
    isSubmittingRef.current = true;
    setLastSubmitKey(submitKey);
    
    try {
      setSubmitting(true);
      const token = localStorage.getItem('accessToken');
      
      if (!formData.orderDate) {
        setAlertMessage({ type: 'error', message: 'Please select an order date' });
        setSubmitting(false);
        return;
      }
      
      if (formData.items.length === 0) {
        setAlertMessage({ type: 'error', message: 'Please add at least one item' });
        setSubmitting(false);
        return;
      }

      // A PO has one commercial line per item.  Older PR/RFQ data can contain
      // repeated rows for the same master item; never silently multiply the
      // ordered quantity or value when converting that data into a PO.
      const duplicatePoItems = new Set<string>();
      const seenPoItems = new Set<string>();
      for (const line of formData.items) {
        const key = String(line.itemId || line.itemCode || '').trim().toLowerCase();
        if (!key) continue;
        if (seenPoItems.has(key)) duplicatePoItems.add(key);
        seenPoItems.add(key);
      }
      if (duplicatePoItems.size > 0) {
        const labels = formData.items
          .filter((line) => duplicatePoItems.has(String(line.itemId || line.itemCode || '').trim().toLowerCase()))
          .map((line) => line.itemCode || line.itemName || 'item')
          .filter((label, index, all) => all.indexOf(label) === index);
        setAlertMessage({
          type: 'error',
          message: `Duplicate PO item line detected: ${labels.join(', ')}. Keep one line per item and choose one price before creating the PO.`,
        });
        setSubmitting(false);
        return;
      }

      // For PR-linked PO creation, each PR line's selected/preferred vendor is the
      // authority. Do not silently collapse multi-supplier PRs into the header
      // vendor; SAP-style conversion creates one PO per line vendor.
      const itemsWithoutVendor = formData.items.filter(item => {
        const lineVendorId = String(item.vendorId || '').trim();
        const headerVendorId = String(formData.vendorId || '').trim();
        return currentPrId ? !lineVendorId : !lineVendorId && !headerVendorId;
      });
      if (itemsWithoutVendor.length > 0) {
        setAlertMessage({ type: 'error', message: 'Please select vendor for all PR line items before creating PO.' });
        setSubmitting(false);
        return;
      }
      
      // Check if all items have itemId (or at least itemCode for pre-filled items)
      const invalidItems = formData.items.filter(item => !item.itemId && !item.itemCode);
      if (invalidItems.length > 0) {
        setAlertMessage({ type: 'error', message: 'Please select items for all rows' });
        setSubmitting(false);
        return;
      }

      // Unit price cannot be 0/empty for any PO line
      const itemsWithInvalidPrice = formData.items
        .map((row, index) => {
          const masterItem = items.find((i) => i.id === row.itemId || i.code === row.itemCode);
          const displayCode = row.itemCode || masterItem?.code || '';
          const displayName = row.itemName || masterItem?.name || '';
          const price = typeof row.unitPrice === 'number' ? row.unitPrice : Number(row.unitPrice);
          return {
            index,
            label: displayCode && displayName ? `${displayCode} - ${displayName}` : (displayName || displayCode || `Row ${index + 1}`),
            price,
          };
        })
        .filter((x) => !Number.isFinite(x.price) || x.price <= 0);

      if (poStatus !== 'DRAFT' && itemsWithInvalidPrice.length > 0) {
        setAlertMessage({
          type: 'error',
          message: `Unit Price is required before submitting for approval. Please enter a valid price for: ${itemsWithInvalidPrice.map((x) => x.label).join(', ')}`,
        });
        setPendingItemIndex(itemsWithInvalidPrice[0].index);
        setSubmitting(false);
        return;
      }

      // Check for compulsory drawings
      const compulsoryItems = formData.items
        .map((row, index) => {
          const masterItem = items.find(i => i.id === row.itemId || i.code === row.itemCode);
          return {
            row,
            index,
            resolvedItemId: masterItem?.id || row.itemId,
            resolvedCode: masterItem?.code || row.itemCode,
            resolvedName: masterItem?.name || row.itemName,
            drawingRequired: masterItem?.drawing_required,
          };
        })
        .filter(x => x.drawingRequired === 'COMPULSORY');

      if (compulsoryItems.length > 0) {
        const itemsWithoutDrawings: Array<{ name: string; firstMissing?: { id: string; code: string; name: string; index: number } }> = [];
        let firstMissing: { id: string; code: string; name: string; index: number } | null = null;

        for (const item of compulsoryItems) {
          const id = item.resolvedItemId;
          const name = item.resolvedName || item.resolvedCode || 'Unknown item';

          if (!id) {
            itemsWithoutDrawings.push({ name });
            continue;
          }

          try {
            const drawings: any[] = await apiClient.get(`/inventory/items/${id}/drawings`);
            if (!Array.isArray(drawings) || drawings.length === 0) {
              itemsWithoutDrawings.push({ name });
              if (!firstMissing) {
                firstMissing = {
                  id,
                  code: item.resolvedCode || '',
                  name: item.resolvedName || '',
                  index: item.index,
                };
              }
            }
          } catch (error) {
            itemsWithoutDrawings.push({ name });
            if (!firstMissing) {
              firstMissing = {
                id,
                code: item.resolvedCode || '',
                name: item.resolvedName || '',
                index: item.index,
              };
            }
          }
        }

        if (itemsWithoutDrawings.length > 0) {
          setAlertMessage({
            type: 'error',
            message: `Drawing upload is compulsory for: ${itemsWithoutDrawings.map(i => i.name).join(', ')}. Please upload drawings before creating PO.`,
          });

          if (firstMissing) {
            setPendingItemIndex(firstMissing.index);
            setSelectedItemForDrawing({
              id: firstMissing.id,
              code: firstMissing.code,
              name: firstMissing.name,
              mandatory: true,
            });
            setShowDrawingManager(true);
          }

          setSubmitting(false);
          return;
        }
      }

      const poItemsWithResolvedDrawings = await prepareItemsWithResolvedDrawings(formData.items);
      setFormData((prev) => ({ ...prev, items: poItemsWithResolvedDrawings }));

      // Group items by vendor
      const itemsByVendor = poItemsWithResolvedDrawings.reduce((acc, item) => {
        const vendorKey = String(currentPrId ? item.vendorId : (item.vendorId || formData.vendorId) || '').trim();
        if (!vendorKey) return acc;
        if (!acc[vendorKey]) {
          acc[vendorKey] = [];
        }
        acc[vendorKey].push({ ...item, vendorId: vendorKey });
        return acc;
      }, {} as Record<string, PurchaseOrderFormItem[]>);

      const vendorIds = Object.keys(itemsByVendor);
      if (vendorIds.length === 0) {
        setAlertMessage({ type: 'error', message: 'No supplier grouping found. Please select a vendor for each line item.' });
        setSubmitting(false);
        return;
      }

      const supplierWiseSplit = Boolean(currentPrId && vendorIds.length > 1);
      if (poStatus !== 'DRAFT') {
        if (supplierWiseSplit) {
          const missingQuotationVendors = vendorIds.filter((vendorId) => {
            const rfq = rfqHistory.find((entry: any) =>
              String(resolveVendorIdFromAny(entry)) === String(vendorId) &&
              ['RECEIVED', 'RESPONDED'].includes(String(entry?.status || '').toUpperCase()),
            );
            const rfqAttachments = Array.isArray(rfq?.response_attachments) ? rfq.response_attachments : [];
            return (supplierAttachments[vendorId] || []).length === 0 && rfqAttachments.length === 0;
          });
          if (missingQuotationVendors.length > 0) {
            setAlertMessage({
              type: 'error',
              message: `Vendor quotation attachment is mandatory for every supplier-wise PO. Missing: ${missingQuotationVendors.map(getVendorDisplayName).join(', ')}`,
            });
            setSubmitting(false);
            return;
          }
        } else {
          const selectedVendorId = vendorIds[0];
          const linkedRfq = rfqHistory.find((entry: any) =>
            String(resolveVendorIdFromAny(entry)) === String(selectedVendorId) &&
            ['RECEIVED', 'RESPONDED'].includes(String(entry?.status || '').toUpperCase()),
          );
          const linkedRfqAttachments = Array.isArray(linkedRfq?.response_attachments) ? linkedRfq.response_attachments : [];
          if ((!Array.isArray(formData.attachments) || formData.attachments.length === 0) && linkedRfqAttachments.length === 0) {
          setAlertMessage({ type: 'error', message: 'Vendor quotation attachment is mandatory for Purchase Order.' });
          setSubmitting(false);
          return;
          }
        }
      }

      const createdPOs = [];
      const createdPORows: PurchaseOrder[] = [];
      
      // Create a PO for each vendor
      for (const vendorId of vendorIds) {
        const vendorItems = itemsByVendor[vendorId];
        
        // Transform items for API
        const transformedItems = vendorItems.map(item => {
          let finalItemId = item.itemId;
          
          if (!finalItemId && item.itemCode) {
            const foundItem = items.find(i => i.code === item.itemCode);
            if (foundItem) {
              finalItemId = foundItem.id;
            }
          }
          
          return {
            prItemId: (item as any).prItemId,
            itemId: finalItemId,
            itemCode: item.itemCode || '',
            itemName: item.itemName || '',
            orderedQty: item.quantity,
            rate: item.unitPrice,
            discountPercent: item.discount || 0,
            taxPercent: item.taxRate,
            amount: item.totalPrice,
            remarks: item.specifications || '',
            paymentTerms: (item as any).paymentTerms || null,
            deliveryTerms: (item as any).deliveryTerms || null,
            includeDrawing: item.includeDrawing === true,
            selectedDrawingId: item.selectedDrawingId || null,
          };
        });

        const itemsSubtotal = vendorItems.reduce((sum, item) => sum + item.totalPrice, 0);
        const freightAmount = parseFloat(formData.freightAmount?.toString() || '0');
        const freightGstApplicable = formData.freightGstApplicable === true && freightAmount > 0;
        const freightGstPercent = freightGstApplicable ? parseFloat(formData.freightGstPercent?.toString() || '0') : 0;
        const freightGstAmount = calcFreightGstAmount(freightAmount, freightGstApplicable, freightGstPercent);
        const customsDuty = parseFloat(formData.customsDuty?.toString() || '0');
        const otherCharges = parseFloat(formData.otherCharges?.toString() || '0');
        const grandTotal = itemsSubtotal + freightAmount + freightGstAmount + customsDuty + otherCharges;
        const linkedRfq = rfqHistory.find((entry: any) =>
          String(resolveVendorIdFromAny(entry)) === String(vendorId) &&
          ['RECEIVED', 'RESPONDED'].includes(String(entry?.status || '').toUpperCase()),
        );
        const linkedRfqAttachments: POAttachment[] = Array.isArray(linkedRfq?.response_attachments)
          ? linkedRfq.response_attachments
              .map((attachment: any) => ({ url: String(attachment?.url || '').trim(), name: String(attachment?.name || '').trim() || 'Vendor quotation' }))
              .filter((attachment: POAttachment) => attachment.url)
          : [];
        const manuallyAttached = supplierWiseSplit ? (supplierAttachments[vendorId] || []) : (formData.attachments || []);
        const poAttachments = [...manuallyAttached, ...linkedRfqAttachments].filter((attachment, index, all) =>
          all.findIndex((candidate) => candidate.url === attachment.url) === index,
        );

        const payload = {
          prId: currentPrId,
          vendorId: vendorId,
          poDate: formData.orderDate,
          deliveryDate: formData.expectedDelivery || null,
          paymentTerms: formData.paymentTerms,
          paymentStatus: formData.paymentStatus,
          paymentNotes: formData.paymentNotes || null,
          deliveryAddress: formData.deliveryAddress,
          deliveryContactPerson: formData.deliveryContactPerson || undefined,
          deliveryContactPhone: formData.deliveryContactPhone || undefined,
          remarks: formData.notes,
          quotationRef: formData.quotationRef || undefined,
          projectId: formData.projectId || undefined,
          projectName: formData.projectName || undefined,
          freightTerms: formData.freightTerms || undefined,
          freightAmount,
          freightGstApplicable,
          freightGstPercent,
          freightGstAmount,
          customsDuty: customsDuty,
          otherCharges: otherCharges,
          isImportPurchase: formData.isImportPurchase,
          supplierCurrency: formData.supplierCurrency || 'INR',
          customsExchangeRate: formData.customsExchangeRate || 0,
          importNotes: formData.importNotes || undefined,
          status: poStatus,
          attachments: poAttachments,
          totalAmount: grandTotal,
          grandTotal,
          items: transformedItems,
        };

        
        const response = await fetch('/api/v1/purchase/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = await response.json();
          const displayNum = data.po_number?.startsWith('DRAFT-') ? 'Draft' : (data.po_number || data.id);
          createdPOs.push(displayNum);
          createdPORows.push(data);
        } else {
          const errorData = await response.json();
          throw new Error(`Failed to create PO for vendor: ${errorData.message || 'Unknown error'}`);
        }
      }

      setShowModal(false);
      setCurrentPage(1);
      if (createdPORows.length > 0) {
        setOrders((current) => {
          const newIds = new Set(createdPORows.map((po) => po.id));
          return [...createdPORows, ...current.filter((po) => !newIds.has(po.id))];
        });
      }
      await fetchOrders({ silent: true });
      resetForm();
      setAlertMessage({ 
        type: 'success', 
        message: `Successfully created ${createdPOs.length} supplier-wise Purchase Order(s): ${createdPOs.join(', ')}` 
      });
    } catch (error: any) {
      setAlertMessage({ type: 'error', message: error.message || 'Failed to create PO. Please try again.' });
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const handleCreateOrder = async (poStatus: 'DRAFT' | 'PENDING' = 'PENDING') => {
    // First validate required fields
    if (!formData.orderDate) {
      setAlertMessage({ type: 'error', message: 'Please select an order date' });
      return;
    }
    
    if (formData.items.length === 0) {
      setAlertMessage({ type: 'error', message: 'Please add at least one item' });
      return;
    }

    // PR-linked conversion must keep line-level vendors intact so multi-supplier
    // requisitions generate separate POs automatically.
    const itemsWithoutVendor = formData.items.filter(item => {
      const lineVendorId = String(item.vendorId || '').trim();
      const headerVendorId = String(formData.vendorId || '').trim();
      return currentPrId ? !lineVendorId : !lineVendorId && !headerVendorId;
    });
    if (itemsWithoutVendor.length > 0) {
      setAlertMessage({ type: 'error', message: 'Please select vendor for all PR line items before creating PO.' });
      return;
    }

    if (currentPrId) {
      await actuallyCreatePO(poStatus);
      return;
    }

    // Get first vendor ID for duplicate check
    const firstVendorId = formData.vendorId || formData.items[0]?.vendorId;
    if (!firstVendorId) {
      setAlertMessage({ type: 'error', message: 'Please select vendor for items' });
      return;
    }

    // Prepare simplified payload for duplicate check
    const checkPayload = {
      vendorId: firstVendorId,
      items: formData.items.map(item => ({
        itemId: item.itemId || items.find(i => i.code === item.itemCode)?.id,
        quantity: item.quantity,
      })),
    };

    // Check for duplicates before creating
    await checkDuplicates(
      () => apiClient.post('/purchase/orders/check-duplicates', checkPayload),
      () => actuallyCreatePO(poStatus),
    );
  };

  const handleUpdateOrder = async (poId: string) => {
    if (submitting) return; // Prevent duplicate submissions

    try {
      setSubmitting(true);
      const token = localStorage.getItem('accessToken');

      if (!formData.orderDate) {
        setAlertMessage({ type: 'error', message: 'Please select an order date' });
        setSubmitting(false);
        return;
      }

      if (formData.items.length === 0) {
        setAlertMessage({ type: 'error', message: 'Please add at least one item' });
        setSubmitting(false);
        return;
      }

      const resolvedVendorIds = Array.from(
        new Set(
          formData.items
            .map((item) => String(item.vendorId || formData.vendorId || '').trim())
            .filter((vendorId) => vendorId.length > 0),
        ),
      );

      if (resolvedVendorIds.length > 1) {
        setAlertMessage({ type: 'error', message: 'A purchase order can only have one vendor. Use the master vendor field to change the vendor for the whole PO.' });
        setSubmitting(false);
        return;
      }

      const vendorId = resolvedVendorIds[0] || formData.vendorId || formData.items[0]?.vendorId;
      if (!vendorId) {
        setAlertMessage({ type: 'error', message: 'Please select a vendor' });
        setSubmitting(false);
        return;
      }

      const invalidItems = formData.items.filter((item) => !item.itemId && !item.itemCode);
      if (invalidItems.length > 0) {
        setAlertMessage({ type: 'error', message: 'Please select items for all rows' });
        setSubmitting(false);
        return;
      }

      const itemsWithInvalidPrice = formData.items
        .map((row, index) => {
          const masterItem = items.find((i) => i.id === row.itemId || i.code === row.itemCode);
          const displayCode = row.itemCode || masterItem?.code || '';
          const displayName = row.itemName || masterItem?.name || '';
          const price = typeof row.unitPrice === 'number' ? row.unitPrice : Number(row.unitPrice);
          return {
            index,
            label:
              displayCode && displayName
                ? `${displayCode} - ${displayName}`
                : displayName || displayCode || `Row ${index + 1}`,
            price,
          };
        })
        .filter((x) => !Number.isFinite(x.price) || x.price <= 0);

      if (itemsWithInvalidPrice.length > 0) {
        setAlertMessage({
          type: 'error',
          message: `Unit Price cannot be 0. Please enter a valid price for: ${itemsWithInvalidPrice
            .map((x) => x.label)
            .join(', ')}`,
        });
        setPendingItemIndex(itemsWithInvalidPrice[0].index);
        setSubmitting(false);
        return;
      }

      const poItemsWithResolvedDrawings = await prepareItemsWithResolvedDrawings(formData.items);
      setFormData((prev) => ({ ...prev, items: poItemsWithResolvedDrawings }));

      const itemsSubtotal = poItemsWithResolvedDrawings.reduce((sum, item) => sum + item.totalPrice, 0);
      const freightAmount = parseFloat(formData.freightAmount?.toString() || '0');
      const freightGstApplicable = formData.freightGstApplicable === true && freightAmount > 0;
      const freightGstPercent = freightGstApplicable ? parseFloat(formData.freightGstPercent?.toString() || '0') : 0;
      const freightGstAmount = calcFreightGstAmount(freightAmount, freightGstApplicable, freightGstPercent);
      const customsDuty = parseFloat(formData.customsDuty?.toString() || '0');
      const otherCharges = parseFloat(formData.otherCharges?.toString() || '0');
      const grandTotal = itemsSubtotal + freightAmount + freightGstAmount + customsDuty + otherCharges;

      const payload = {
        vendorId,
        poDate: formData.orderDate,
        deliveryDate: formData.expectedDelivery || null,
        paymentTerms: formData.paymentTerms,
        paymentStatus: formData.paymentStatus,
        paymentNotes: formData.paymentNotes || null,
        deliveryAddress: formData.deliveryAddress,
        deliveryContactPerson: formData.deliveryContactPerson || undefined,
        deliveryContactPhone: formData.deliveryContactPhone || undefined,
        remarks: formData.notes,
        quotationRef: formData.quotationRef || undefined,
        projectId: formData.projectId || undefined,
        projectName: formData.projectName || undefined,
        freightTerms: formData.freightTerms || undefined,
        freightAmount,
        freightGstApplicable,
        freightGstPercent,
        freightGstAmount,
        customsDuty,
        otherCharges,
        isImportPurchase: formData.isImportPurchase,
        supplierCurrency: formData.supplierCurrency || 'INR',
        customsExchangeRate: formData.customsExchangeRate || 0,
        importNotes: formData.importNotes || undefined,
        ...(Array.isArray(formData.attachments) && formData.attachments.length > 0
          ? { attachments: formData.attachments }
          : {}),
        totalAmount: grandTotal,
        grandTotal,
        items: poItemsWithResolvedDrawings.map((item) => ({
          poItemId: (item as any).poItemId,
          id: (item as any).poItemId,
          prItemId: (item as any).prItemId,
          itemId: item.itemId || items.find((i) => i.code === item.itemCode)?.id,
          itemCode: item.itemCode || '',
          itemName: item.itemName || '',
          description: (item as any).description || item.specifications || '',
          uom: (item as any).uom || '',
          orderedQty: item.quantity,
          rate: item.unitPrice,
          discountPercent: item.discount || 0,
          taxPercent: item.taxRate,
          amount: item.totalPrice,
          remarks: item.specifications || '',
          paymentTerms: (item as any).paymentTerms || null,
          deliveryTerms: (item as any).deliveryTerms || null,
          includeDrawing: item.includeDrawing === true,
          selectedDrawingId: item.selectedDrawingId || null,
        })),
      };

      const response = await fetch(`/api/v1/purchase/orders/${poId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || 'Failed to update PO');
      }

      setAlertMessage({ type: 'success', message: 'Purchase Order updated successfully' });
      setShowModal(false);
      setCurrentPage(1);
      await fetchOrders({ silent: true });
      resetForm();
    } catch (error: any) {
      setAlertMessage({ type: 'error', message: error.message || 'Failed to update PO' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddItem = () => {
    if (String(currentPrDepartment || '').trim().toUpperCase() === 'R&D') {
      setQuickCreateItemIndex(null);
      setShowRndTemporaryItem(true);
      return;
    }

    // Validate last row before adding new one
    if (formData.items.length > 0) {
      const lastItem = formData.items[formData.items.length - 1];
      if (!lastItem.itemId || lastItem.quantity <= 0) {
        alert('Please complete the current row before adding a new one');
        return;
      }
    }

    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          prItemId: undefined,
          itemId: '',
          itemCode: '',
          itemName: '',
          uom: '',
          vendorId: prev.vendorId,
          quantity: 1,
          unitPrice: 0,
          discount: 0,
          taxRate: 18,
          totalPrice: 0,
          specifications: '',
          paymentTerms: '',
          deliveryTerms: '',
          includeDrawing: false,
          selectedDrawingId: '',
        },
      ],
    }));
  };

  const handleUploadPOAttachment = async (files: FileList | null, supplierVendorId?: string) => {
    if (!files || files.length === 0) return;
    try {
      setPoAttachmentUploading(true);
      const token = localStorage.getItem('accessToken');
      const uploaded: POAttachment[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('bucket', 'documents');
        fd.append('folder', 'po-attachments');
        const response = await fetch('/api/v1/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err?.message || 'Upload failed');
        }
        const data = await response.json();
        const url = String(data?.url || '').trim();
        if (!url) throw new Error('Upload failed: no URL returned');
        uploaded.push({ url, name: file.name });
      }
      if (supplierVendorId) {
        setSupplierAttachments((prev) => ({
          ...prev,
          [supplierVendorId]: [...(prev[supplierVendorId] || []), ...uploaded],
        }));
      } else {
        setFormData((prev) => ({ ...prev, attachments: [...prev.attachments, ...uploaded] }));
      }
    } catch (err: any) {
      alert(`Failed to upload attachment: ${err?.message || 'Unknown error'}`);
    } finally {
      setPoAttachmentUploading(false);
    }
  };

  const fetchDrawingOptionsForItem = async (itemId: string, options?: { force?: boolean }): Promise<DrawingOption[]> => {
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId) return [];
    if (!options?.force && drawingOptionsByItemId[normalizedItemId]) return drawingOptionsByItemId[normalizedItemId];
    if (drawingOptionsLoading[normalizedItemId]) return [];

    setDrawingOptionsLoading((prev) => ({ ...prev, [normalizedItemId]: true }));
    try {
      const drawings: DrawingOption[] = await apiClient.get(`/inventory/items/${normalizedItemId}/drawings`);
      const normalizedDrawings = Array.isArray(drawings) ? drawings : [];
      setDrawingOptionsByItemId((prev) => ({
        ...prev,
        [normalizedItemId]: normalizedDrawings,
      }));
      return normalizedDrawings;
    } catch (error) {
      setDrawingOptionsByItemId((prev) => ({ ...prev, [normalizedItemId]: [] }));
      return [];
    } finally {
      setDrawingOptionsLoading((prev) => ({ ...prev, [normalizedItemId]: false }));
    }
  };

  const getLatestDrawingId = (itemId: string, fallbackDrawings?: DrawingOption[]) => {
    const drawings = fallbackDrawings || drawingOptionsByItemId[itemId] || [];
    return drawings.find((drawing) => drawing.is_active)?.id || drawings[0]?.id || '';
  };

  const prepareItemsWithResolvedDrawings = async (
    sourceItems: PurchaseOrderFormItem[],
  ): Promise<PurchaseOrderFormItem[]> => {
    const prepared: PurchaseOrderFormItem[] = [];

    for (const row of sourceItems || []) {
      const masterItem = items.find((i) => i.id === row.itemId || i.code === row.itemCode);
      const resolvedItemId = masterItem?.id || row.itemId || '';
      const drawingRequired = String(masterItem?.drawing_required || '').toUpperCase();
      const includeDrawing = drawingRequired === 'COMPULSORY' || row.includeDrawing === true;
      let selectedDrawingId = row.selectedDrawingId || '';

      if (includeDrawing && resolvedItemId && !selectedDrawingId) {
        const drawings = await fetchDrawingOptionsForItem(resolvedItemId);
        selectedDrawingId = getLatestDrawingId(resolvedItemId, drawings);
      }

      prepared.push({
        ...row,
        itemId: resolvedItemId || row.itemId,
        includeDrawing,
        selectedDrawingId,
      });
    }

    return prepared;
  };

  const handleUpdateItem = async (index: number, field: string, value: any) => {
    const updatedItems = [...(formData.items || [])];
    const normalizedVendorValue = field === 'vendorId' ? String(value || '').trim() : '';
    
    // Check for duplicate items when changing itemId
    if (field === 'itemId' && value) {
      const isDuplicate = (formData.items || []).some((item, i) => 
        i !== index && item.itemId === value
      );
      if (isDuplicate) {
        alert('This item is already added to the purchase order. Please select a different item.');
        return;
      }
    }
    
    // If selecting an item from dropdown, populate itemCode, itemName, unitPrice, and preferred vendor
    if (field === 'itemId' && value) {
      const selectedItem = items.find(item => item.id === value);
      if (selectedItem) {
        updatedItems[index] = {
          ...updatedItems[index],
          itemId: value,
          itemCode: selectedItem.code,
          itemName: selectedItem.name,
          uom: resolveUomFromItem(selectedItem),
          unitPrice: selectedItem.standard_cost || selectedItem.selling_price || 0,
          includeDrawing: selectedItem.drawing_required === 'COMPULSORY',
          selectedDrawingId: '',
        };
        
        // Fetch stock info for this item
        fetchStockInfo(value);
        fetchDrawingOptionsForItem(value);
        
        // Fetch preferred vendor for this item
        try {
          const token = localStorage.getItem('accessToken');
          const response = await fetch(`/api/v1/items/${value}/vendors/preferred`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          
          
          if (response.ok) {
            const preferredVendor = await response.json();

            const preferredVendorId =
              preferredVendor?.vendor_id ??
              preferredVendor?.vendorId ??
              preferredVendor?.id ??
              preferredVendor?.vendor?.id ??
              '';

            if (preferredVendor && preferredVendorId) {
              updatedItems[index].vendorId = formData.vendorId || String(preferredVendorId);
              // Update unit price from preferred vendor if available
              if (preferredVendor.unit_price) {
                updatedItems[index].unitPrice = preferredVendor.unit_price;
              }
            } else {
            }
          } else {
            const errorText = await response.text();
          }
        } catch (error) {
        }
      } else {
        // Item not found in loaded list — record the selection and trigger a re-fetch.
        // This handles the race condition where the user selects before items finish loading.
        updatedItems[index] = { ...updatedItems[index], itemId: value };
        if (items.length === 0) fetchItems();
      }
    } else {
      updatedItems[index] = { ...updatedItems[index], [field]: value };

      if (field === 'includeDrawing' && value) {
        const itemId = String(updatedItems[index]?.itemId || '').trim();
        if (itemId) {
          const drawings = await fetchDrawingOptionsForItem(itemId);
          updatedItems[index].selectedDrawingId = updatedItems[index].selectedDrawingId || getLatestDrawingId(itemId, drawings);
        }
      }

      if (field === 'includeDrawing' && !value) {
        updatedItems[index].selectedDrawingId = '';
      }

      if (field === 'vendorId' && editingMode === 'edit') {
        for (let itemIndex = 0; itemIndex < updatedItems.length; itemIndex += 1) {
          updatedItems[itemIndex] = {
            ...updatedItems[itemIndex],
            vendorId: normalizedVendorValue,
          };
        }
      }
    }

    // If we have item + vendor, try to autofill the unit price from last purchase price.
    // (This overrides standard cost / preferred vendor unit_price when history exists.)
    const row = updatedItems[index];
    const shouldTryAutofill =
      (field === 'itemId' || field === 'vendorId') &&
      Boolean(row?.itemId) &&
      Boolean(row?.vendorId);

    if (shouldTryAutofill) {
      const itemId = String(row.itemId || '').trim();
      const vendorId = String(row.vendorId || '').trim();
      if (!itemId || !vendorId) return;
      const history = await fetchPriceHistory(itemId, vendorId);
      const last = history?.[0];
      if (last && typeof last.unit_price === 'number' && !Number.isNaN(last.unit_price)) {
        row.unitPrice = Number(last.unit_price);
      }
    }

    // Recalculate total price (including discount)
    if (field === 'quantity' || field === 'unitPrice' || field === 'taxRate' || field === 'discount' || field === 'itemId' || field === 'vendorId') {
      const item = updatedItems[index];
      if (formData.isImportPurchase || String(formData.supplierCurrency || 'INR').toUpperCase() !== 'INR') {
        item.taxRate = 0;
      }
      item.totalPrice = calcPoLineTotal(item.quantity, item.unitPrice, item.discount || 0, item.taxRate);
    }

    // Use functional update to avoid clobbering other form fields
    setFormData((prev) => ({
      ...prev,
      vendorId: field === 'vendorId' && editingMode === 'edit' ? normalizedVendorValue : prev.vendorId,
      items: updatedItems,
    }));
  };

  const handleRemoveItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  // Helper function to set vendor for all items, and pull RFQ prices if available
  const handleSetAllVendors = async (vendorId: string) => {
    let rfqPriceByPrItemId: Record<string, number> = {};
    let rfqLeadTimeByPrItemId: Record<string, number> = {};
    if (currentPrId && vendorId) {
      try {
        const rfqs: any[] = rfqHistory.length > 0 ? rfqHistory : await apiClient.get(`/purchase/requisitions/${currentPrId}/rfqs`);
        const vendorRfq = (rfqs || []).find((r: any) =>
          String(resolveVendorIdFromAny(r)) === String(vendorId) &&
          ['RECEIVED', 'RESPONDED'].includes(String(r.status || '').toUpperCase())
        );
        if (vendorRfq && Array.isArray(vendorRfq.rfq_items)) {
          vendorRfq.rfq_items.forEach((ri: any) => {
            if (ri.pr_item_id && ri.vendor_quoted_price != null) {
              rfqPriceByPrItemId[String(ri.pr_item_id)] = Number(ri.vendor_quoted_price);
            }
            if (ri.pr_item_id && ri.vendor_quoted_lead_time != null) {
              rfqLeadTimeByPrItemId[String(ri.pr_item_id)] = Number(ri.vendor_quoted_lead_time);
            }
          });
        }
      } catch { }
    }
    setFormData(prev => ({
      ...prev,
      vendorId,
      items: prev.items.map(item => {
        const rfqPrice = item.prItemId ? rfqPriceByPrItemId[String(item.prItemId)] : undefined;
        const rfqLeadTime = item.prItemId ? rfqLeadTimeByPrItemId[String(item.prItemId)] : undefined;
        const effectivePrice = rfqPrice != null ? rfqPrice : item.unitPrice;
        const totalPrice = calcPoLineTotal(item.quantity, effectivePrice, item.discount || 0, item.taxRate);
        return {
          ...item,
          vendorId,
          ...(rfqPrice != null ? { unitPrice: rfqPrice } : {}),
          ...(rfqLeadTime != null ? { deliveryTerms: `${rfqLeadTime} days` } : {}),
          totalPrice,
        };
      }),
    }));
    if (Object.keys(rfqPriceByPrItemId).length > 0) {
      setAlertMessage({ type: 'info', message: `RFQ quoted prices loaded for ${Object.keys(rfqPriceByPrItemId).length} item(s) from vendor response.` });
    }
  };

  const handleRndTemporaryItemCreated = async (item: RndTemporaryItem) => {
    if (String(currentPrDepartment || '').trim().toUpperCase() !== 'R&D') {
      setAlertMessage({
        type: 'error',
        message: 'Temporary items can only be added to an R&D purchase order.',
      });
      setShowRndTemporaryItem(false);
      setQuickCreateItemIndex(null);
      return;
    }
    const itemId = String(item.id || '');
    const code = String(item.code || '');
    const name = String(item.name || code);
    const uom = String(item.uom || 'NOS');
    const vendorId = String(item.preferred_vendor_id || '');
    const vendorName = String(
      item.preferred_vendor_name
      || vendors.find((vendor) => String(vendor.id) === vendorId)?.name
      || '',
    );
    const unitPrice = Number(item.preferred_price ?? item.standard_cost ?? 0) || 0;
    const subtotal = unitPrice;
    const newLine = {
      prItemId: undefined,
      itemId,
      itemCode: code,
      itemName: name,
      uom,
      vendorId,
      vendorName,
      quantity: 1,
      unitPrice,
      discount: 0,
      taxRate: 18,
      totalPrice: subtotal + (subtotal * 0.18),
      specifications: String(item.description || 'Temporary R&D procurement item'),
      paymentTerms: '',
      deliveryTerms: '',
      includeDrawing: false,
      selectedDrawingId: '',
    };

    setItems((current) => [{
      id: itemId,
      code,
      name,
      uom,
      category: 'RAW_MATERIAL',
      standard_cost: unitPrice,
      drawing_required: 'NOT_REQUIRED',
      oem_part_no: code,
      oem_name: item.oem_name || undefined,
    }, ...current.filter((entry) => entry.id !== itemId)]);
    if (vendorId && vendorName) {
      setVendors((current) => current.some((vendor) => String(vendor.id) === vendorId)
        ? current
        : [...current, { id: vendorId, name: vendorName, contact_person: '' }].sort((a, b) => a.name.localeCompare(b.name)));
    }
    setFormData((current) => {
      const targetIndex = quickCreateItemIndex;
      const nextItems = targetIndex !== null && targetIndex >= 0 && targetIndex < current.items.length
        ? current.items.map((line, index) => index === targetIndex ? { ...line, ...newLine } : line)
        : [...current.items, newLine];
      return {
        ...current,
        vendorId: current.vendorId || vendorId,
        items: nextItems,
      };
    });
    setQuickCreateItemIndex(null);
  };

  const handleApplyRfqQuote = (rfq: any) => {
    const vendorId = resolveVendorIdFromAny(rfq);
    if (!vendorId) {
      setAlertMessage({ type: 'error', message: 'This RFQ response has no linked vendor.' });
      return;
    }

    const rfqItems = Array.isArray(rfq?.rfq_items) ? rfq.rfq_items : [];
    const quotedByPrItemId = new Map<string, any>(
      rfqItems
        .filter((item: any) => item?.pr_item_id)
        .map((item: any) => [String(item.pr_item_id), item]),
    );

    setFormData((prev) => ({
      ...prev,
      vendorId,
      quotationRef: rfq?.rfq_number || prev.quotationRef,
      items: prev.items.map((item) => {
        const quote = item.prItemId ? quotedByPrItemId.get(String(item.prItemId)) : null;
        const quotedPrice = quote?.vendor_quoted_price == null ? null : Number(quote.vendor_quoted_price);
        const quotedLeadTime = quote?.vendor_quoted_lead_time == null ? null : Number(quote.vendor_quoted_lead_time);
        const unitPrice = Number.isFinite(quotedPrice) && quotedPrice !== null ? quotedPrice : item.unitPrice;
        return {
          ...item,
          vendorId,
          unitPrice,
          deliveryTerms: Number.isFinite(quotedLeadTime) && quotedLeadTime !== null ? `${quotedLeadTime} days` : item.deliveryTerms,
          totalPrice: calcPoLineTotal(item.quantity, unitPrice, item.discount || 0, item.taxRate),
        };
      }),
    }));

    setAlertMessage({
      type: 'info',
      message: `Applied RFQ response from ${rfq?.vendor?.name || 'selected vendor'} to the PO lines. You can still edit rates or choose another vendor before saving.`,
    });
  };

  const resetForm = () => {
    setFormData({
      vendorId: '',
      orderDate: getTodayDateInputValue(),
      expectedDelivery: '',
      paymentTerms: 'NET_30',
      paymentStatus: 'UNPAID',
      paymentNotes: '',
      deliveryAddress: '',
      deliveryContactPerson: '',
      deliveryContactPhone: '',
      notes: '',
      quotationRef: '',
      projectId: '',
      projectName: '',
      freightTerms: '',
      freightAmount: 0,
      freightGstApplicable: false,
      freightGstPercent: 0,
      customsDuty: 0,
      otherCharges: 0,
      isImportPurchase: false,
      supplierCurrency: 'INR',
      customsExchangeRate: 0,
      importNotes: '',
      trackingNumber: '',
      shippedDate: '',
      estimatedDeliveryDate: '',
      carrierName: '',
      trackingUrl: '',
      deliveryStatus: 'PENDING',
      attachments: [],
      items: [],
    });
    setCurrentPrId(null); // Clear PR ID on form reset
    setCurrentPrDepartment('');
    setRfqHistory([]);
    setRfqRespondedVendorIds([]);
    setSupplierAttachments({});
    setEditingPOId(null); // Clear editing state
    setEditingMode('create');
  };

  const handleViewDetails = async (poId: string) => {
    try {
      setPoViewSection('overview');
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/purchase/orders/${poId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setSelectedPO(data);
      setShowViewModal(true);

      // Prefetch last purchase prices for inline display on the approval/details screen
      try {
        const vendorId = resolveVendorIdFromPO(data);
        const poItems = Array.isArray(data?.purchase_order_items) ? data.purchase_order_items : [];
        if (vendorId) {
          await Promise.all(
            poItems
              .map((it: any) => resolveItemIdFromPOLine(it))
              .filter(Boolean)
              .map((itemId: string) => fetchPriceHistory(itemId, vendorId)),
          );
        }
      } catch (e) {
      }

      // Ensure we have item master data so we can resolve drawing_required + item ids
      if (items.length === 0) {
        fetchItems();
      }
    } catch (error) {
      setAlertMessage({ type: 'error', message: 'Failed to load PO details' });
    }
  };

  // Fetch PO Trail data (PR, GRNs, Payments, Invoices)
  const fetchTrailData = async (po: PurchaseOrder) => {
    try {
      setTrailLoading(true);
      const detailedPO = await apiClient.get<PurchaseOrder>(`/purchase/orders/${po.id}`).catch(() => po);
      const activePO = detailedPO || po;
      setTrailPO(activePO);
      
      // Fetch related data in parallel
      const [grnsData, poSettlementData, vendorBalanceData] = await Promise.all([
        apiClient.get<any[]>(`/purchase/grn?poId=${activePO.id}`).catch(() => []),
        apiClient.get<any>(`/purchase/debit-notes/po/${activePO.id}/settlement`).catch(() => null),
        activePO.vendor?.id ? apiClient.get<any>(`/purchase/debit-notes/vendor/${activePO.vendor.id}/advance-balance`).catch(() => null) : Promise.resolve(null),
      ]);

      const poAdvances = poSettlementData?.advances || [];
      const settlementByGrn = new Map(
        (poSettlementData?.invoices || []).map((invoice: any) => [invoice.grn_id, invoice]),
      );
      const grnIds = (grnsData || []).map((grn: any) => grn.id).filter(Boolean);
      const debitNotesData = activePO.vendor?.id
        ? await apiClient.get<any[]>(`/purchase/debit-notes?vendor_id=${activePO.vendor.id}`).catch(() => [])
        : [];
      const poDebitNotes = (debitNotesData || []).filter((note: any) => grnIds.includes(note.grn_id || note.grn?.id));

      // Process GRNs to get payment entries for each
      const grnsWithPayments = await Promise.all(
        (grnsData || []).map(async (grn: any) => {
          try {
            const authoritativeInvoice: any = settlementByGrn.get(grn.id);
            const payableDetail = await apiClient.get<any>(`/purchase/debit-notes/grn/${grn.id}/payable-detail`).catch(() => null);
            const paymentEntries = authoritativeInvoice?.payment_entries
              ?? payableDetail?.payment_entries?.filter((entry: any) => entry.entry_type !== 'ADVANCE_APPLIED')
              ?? await apiClient.get<any[]>(`/purchase/debit-notes/grn/${grn.id}/payment-entries`).catch(() => []);
            const normalizedEntries = Array.isArray(paymentEntries) ? [...paymentEntries] : [];
            const paymentReversals = Array.isArray(payableDetail?.payment_reversals) ? payableDetail.payment_reversals : [];
            const recordedEntryAmount = normalizedEntries.reduce((sum: number, entry: any) => sum + Number(entry.amount || 0), 0);
            const aggregatePaidAmount = Number(authoritativeInvoice?.settlement?.cashPaid ?? grn.paid_amount ?? 0);

            // Older AP records stored settlement only on the GRN. Preserve that
            // history in the PO trail without duplicating newer payment entries.
            if (aggregatePaidAmount > recordedEntryAmount + 0.009) {
              normalizedEntries.push({
                id: `grn-aggregate-${grn.id}`,
                entry_type: 'RECORDED_PAYMENT',
                amount: aggregatePaidAmount - recordedEntryAmount,
                payment_date: grn.payment_date || grn.updated_at || grn.grn_date,
                payment_method: grn.payment_method || 'Recorded settlement',
                payment_reference: grn.payment_reference || null,
                payment_notes: grn.payment_notes || 'Payment recorded against supplier invoice',
                tds_amount: 0,
                short_payment_amount: 0,
              });
            }

            const debitNotes = poDebitNotes.filter((note: any) => (note.grn_id || note.grn?.id) === grn.id);
            const netPayable = Number(grn.net_payable_amount ?? grn.gross_amount ?? 0);
            const paidAmount = Number(authoritativeInvoice?.settlement?.cashPaid ?? grn.paid_amount ?? normalizedEntries.reduce((sum: number, entry: any) => sum + Number(entry.amount || 0), 0));
            const tdsAmount = Number(authoritativeInvoice?.settlement?.tds ?? grn.tds_amount ?? 0);
            const shortAmount = Number(authoritativeInvoice?.settlement?.shortPayment ?? grn.short_payment_amount ?? 0);
            const advanceApplied = Number(authoritativeInvoice?.settlement?.advanceApplied || 0);

            return {
              ...grn,
              payment_status: authoritativeInvoice?.settlement?.paymentStatus || grn.payment_status,
              payment_entries: normalizedEntries.sort((a: any, b: any) => new Date(a.payment_date || 0).getTime() - new Date(b.payment_date || 0).getTime()),
              payment_reversals: paymentReversals.sort((a: any, b: any) => new Date(b.reversed_at || 0).getTime() - new Date(a.reversed_at || 0).getTime()),
              debit_notes: debitNotes,
              settlement: {
                net_payable: netPayable,
                paid: paidAmount,
                tds: tdsAmount,
                short_payment: shortAmount,
                advance_applied: advanceApplied,
                total_settled: Number(authoritativeInvoice?.settlement?.totalSettled ?? paidAmount + tdsAmount + shortAmount + advanceApplied),
                outstanding: Number(authoritativeInvoice?.settlement?.outstanding ?? Math.max(0, netPayable - paidAmount - tdsAmount - shortAmount - advanceApplied)),
              },
            };
          } catch {
            return { ...grn, payment_entries: [], debit_notes: [], settlement: null };
          }
        })
      );

      const calculatedSummary = grnsWithPayments.reduce((summary: any, grn: any) => {
        const settlement = grn.settlement || {};
        summary.invoiced += Number(settlement.net_payable || 0);
        summary.paid += Number(settlement.paid || 0);
        summary.tds += Number(settlement.tds || 0);
        summary.shortPayment += Number(settlement.short_payment || 0);
        summary.advanceApplied += Number(settlement.advance_applied || 0);
        summary.outstanding += Number(settlement.outstanding || 0);
        summary.paymentCount += grn.payment_entries?.length || 0;
        summary.paymentReversalCount += grn.payment_reversals?.length || 0;
        summary.paymentReversals += (grn.payment_reversals || []).reduce(
          (sum: number, reversal: any) =>
            sum +
            Number(reversal.original_amount || 0) +
            Number(reversal.original_tds_amount || 0) +
            Number(reversal.original_short_payment_amount || 0),
          0,
        );
        return summary;
      }, {
        poValue: Number((activePO as any).grand_total ?? activePO.total_amount ?? 0),
        invoiced: 0,
        paid: 0,
        tds: 0,
        shortPayment: 0,
        outstanding: 0,
        paymentCount: 0,
        paymentReversalCount: 0,
        paymentReversals: 0,
        advanceApplied: 0,
      });
      const authoritativeSummary = poSettlementData?.summary;
      const financialSummary = {
        ...calculatedSummary,
        invoiced: Number(authoritativeSummary?.invoiced ?? calculatedSummary.invoiced),
        paid: Number(authoritativeSummary?.cashPaid ?? calculatedSummary.paid),
        tds: Number(authoritativeSummary?.tds ?? calculatedSummary.tds),
        shortPayment: Number(authoritativeSummary?.shortPayment ?? calculatedSummary.shortPayment),
        outstanding: Number(authoritativeSummary?.outstanding ?? calculatedSummary.outstanding),
        advancePaid: Number(authoritativeSummary?.totalAdvance ?? poAdvances.reduce((sum: number, advance: any) => sum + Number(advance.amount || 0), 0)),
        advanceApplied: Number(authoritativeSummary?.advanceApplied || 0),
        advanceAvailable: Number(authoritativeSummary?.advanceAvailable || 0),
        debitNotes: poDebitNotes.reduce((sum: number, note: any) => sum + Number(note.total_amount || 0), 0),
        paymentReversalCount: calculatedSummary.paymentReversalCount,
        paymentReversals: calculatedSummary.paymentReversals,
      };

      setTrailData({
        po: activePO,
        pr: activePO.pr,
        grns: grnsWithPayments,
        advances: poAdvances,
        debitNotes: poDebitNotes,
        vendorAdvanceBalance: vendorBalanceData,
        financialSummary,
      });
      setShowTrailModal(true);
    } catch (error) {
      toast.error('Failed to load PO trail');
    } finally {
      setTrailLoading(false);
    }
  };

  const handleSaveTracking = async (poId: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      
      const trackingData = {
        tracking_number: formData.trackingNumber || null,
        shipped_date: formData.shippedDate || null,
        estimated_delivery_date: formData.estimatedDeliveryDate || null,
        carrier_name: formData.carrierName || null,
        tracking_url: formData.trackingUrl || null,
        delivery_status: formData.deliveryStatus || 'PENDING',
      };

      const response = await fetch(`/api/v1/purchase/orders/${poId}/tracking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(trackingData),
      });

      if (response.ok) {
        setAlertMessage({ type: 'success', message: 'Tracking information saved successfully' });
        fetchOrders();
        setShowModal(false);
        resetForm();
      } else {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save tracking information');
      }
    } catch (error: any) {
      setAlertMessage({ type: 'error', message: error.message || 'Failed to save tracking information' });
    }
  };

  const handleEditDetails = async (poId: string, mode: 'edit' | 'tracking' = 'edit') => {
    try {
      setCurrentPrId(null);
      setCurrentPrDepartment('');
      setSupplierAttachments({});
      setPendingItemIndex(null);

      // Ensure item options are loaded so SearchableSelect can render the selected label
      if (items.length === 0) {
        await fetchItems();
      }
      let vendorOptions = vendors;
      if (vendorOptions.length === 0) {
        vendorOptions = await fetchVendors();
      }

      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/purchase/orders/${poId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      const linkedPrId = String(data?.pr_id || data?.prId || data?.pr?.id || '').trim();
      const linkedPrDepartment = String(data?.pr?.department || data?.pr_department || '').trim();
      setCurrentPrId(linkedPrId || null);
      setCurrentPrDepartment(linkedPrDepartment);

      const directVendorId = String(data?.vendor_id || data?.vendorId || data?.vendor?.id || data?.vendor?.vendor_id || '').trim();
      const poVendorName = String(data?.vendor?.name || data?.vendor_name || '').trim();
      const resolvedVendorId = directVendorId || String(
        vendorOptions.find((vendor) => String(vendor.name || '').trim().toLowerCase() === poVendorName.toLowerCase())?.id || ''
      ).trim();
      if (resolvedVendorId && poVendorName && !vendorOptions.some((vendor) => String(vendor.id) === resolvedVendorId)) {
        const currentPoVendor = {
          id: resolvedVendorId,
          name: poVendorName,
          contact_person: data?.vendor?.contact_person || '',
        };
        vendorOptions = [...vendorOptions, currentPoVendor].sort((a, b) => a.name.localeCompare(b.name));
        setVendors(vendorOptions);
      }
      
      // Populate form with PO data for editing
      const editItems = data.purchase_order_items?.map((item: any) => ({
        poItemId: item.id || '',
        itemCode: item.item_code || item.item?.code || '',
        itemId: (() => {
          const direct = item.item_id || item.itemId || item.item?.id;
          if (direct) return direct;
          const code = String(item.item_code || item.item?.code || '').trim();
          if (!code) return '';
          const match = items.find((i) => String(i.code).trim() === code);
          return match?.id || '';
        })(),
        itemName: item.item_name || item.item?.name || '',
        description: item.description || item.item?.description || '',
        uom: item.uom || item.item?.uom || 'NUMBER',
        vendorId: resolvedVendorId, // Use PO's vendor for all items
        quantity: item.ordered_qty || 0,
        unitPrice: item.rate || 0,
        discount: item.discount_percent ?? item.discountPercent ?? item.discount ?? 0,
        taxRate: item.tax_percent != null ? item.tax_percent : 18,
        totalPrice: item.amount || 0,
        specifications: item.remarks || '',
        paymentTerms: item.payment_terms || '',
        deliveryTerms: item.delivery_terms || '',
        includeDrawing: item.include_drawing === true || item.includeDrawing === true,
        selectedDrawingId: item.selected_drawing_id || item.selectedDrawingId || '',
      })) || [];
      
      setFormData({
        vendorId: resolvedVendorId,
        orderDate: data.po_date || getTodayDateInputValue(),
        expectedDelivery: data.delivery_date || '',
        paymentTerms: data.payment_terms || 'NET_30',
        paymentStatus: data.payment_status || 'UNPAID',
        paymentNotes: data.payment_notes || '',
        deliveryAddress: data.delivery_address || '',
        deliveryContactPerson: data.delivery_contact_person || '',
        deliveryContactPhone: data.delivery_contact_phone || '',
        notes: data.remarks || '',
        quotationRef: data.quotation_ref || '',
        projectId: data.project_id || '',
        projectName: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return JSON.parse(tc).project || '';
            if (tc && typeof tc === 'object') return (tc as any).project || '';
          } catch {}
          return data.project_name || '';
        })(),
        freightTerms: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return JSON.parse(tc).freight || '';
            if (tc && typeof tc === 'object') return (tc as any).freight || '';
          } catch {}
          return data.freight_terms || '';
        })(),
        freightAmount: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return Number(JSON.parse(tc).freightAmount || 0);
            if (tc && typeof tc === 'object') return Number((tc as any).freightAmount || 0);
          } catch {}
          return 0;
        })(),
        freightGstApplicable: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return JSON.parse(tc).freightGstApplicable === true;
            if (tc && typeof tc === 'object') return (tc as any).freightGstApplicable === true;
          } catch {}
          return false;
        })(),
        freightGstPercent: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return Number(JSON.parse(tc).freightGstPercent || 0);
            if (tc && typeof tc === 'object') return Number((tc as any).freightGstPercent || 0);
          } catch {}
          return 0;
        })(),
        customsDuty: data.customs_duty || 0,
        otherCharges: data.other_charges || 0,
        isImportPurchase: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return JSON.parse(tc).isImportPurchase === true;
            if (tc && typeof tc === 'object') return (tc as any).isImportPurchase === true;
          } catch {}
          return false;
        })(),
        supplierCurrency: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return JSON.parse(tc).supplierCurrency || 'INR';
            if (tc && typeof tc === 'object') return (tc as any).supplierCurrency || 'INR';
          } catch {}
          return 'INR';
        })(),
        customsExchangeRate: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return Number(JSON.parse(tc).customsExchangeRate || 0);
            if (tc && typeof tc === 'object') return Number((tc as any).customsExchangeRate || 0);
          } catch {}
          return 0;
        })(),
        importNotes: (() => {
          try {
            const tc = data.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) return JSON.parse(tc).importNotes || '';
            if (tc && typeof tc === 'object') return (tc as any).importNotes || '';
          } catch {}
          return '';
        })(),
        trackingNumber: data.tracking_number || '',
        shippedDate: data.shipped_date || '',
        estimatedDeliveryDate: data.estimated_delivery_date || '',
        carrierName: data.carrier_name || '',
        trackingUrl: data.tracking_url || '',
        deliveryStatus: data.delivery_status || 'PENDING',
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        items: editItems,
      });
      
      setEditingPOId(poId);
      setEditingMode(mode);
      setShowModal(true);
      setAlertMessage({
        type: 'info',
        message: mode === 'tracking' ? 'Update tracking details below' : 'Edit mode: Update the PO details below',
      });
    } catch (error) {
      setAlertMessage({ type: 'error', message: 'Failed to load PO details' });
    }
  };

  const removeSupplierAttachment = (supplierVendorId: string, attachmentIndex: number) => {
    setSupplierAttachments((prev) => ({
      ...prev,
      [supplierVendorId]: (prev[supplierVendorId] || []).filter((_, index) => index !== attachmentIndex),
    }));
  };

  const readPoTermsValue = (po: any, key: string, fallback: any = '') => {
    try {
      const tc = po?.terms_and_conditions;
      if (tc && typeof tc === 'string' && tc.startsWith('{')) {
        const parsed = JSON.parse(tc);
        return parsed?.[key] ?? fallback;
      }
      if (tc && typeof tc === 'object') return (tc as any)?.[key] ?? fallback;
    } catch {}
    return fallback;
  };

  const handleClonePO = async (poId: string) => {
    if (!canCreatePO) return;
    try {
      resetForm();
      setPendingItemIndex(null);
      setEditingPOId(null);
      setEditingMode('create');
      setCurrentPrId(null);
      setCurrentPrDepartment('');
      setRfqRespondedVendorIds([]);
      setRfqHistory([]);

      if (items.length === 0) {
        await fetchItems();
      }
      let vendorOptions = vendors;
      if (vendorOptions.length === 0) {
        vendorOptions = await fetchVendors();
      }

      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/purchase/orders/${poId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to load PO for cloning');
      const data = await response.json();

      const directVendorId = String(data?.vendor_id || data?.vendorId || data?.vendor?.id || data?.vendor?.vendor_id || '').trim();
      const poVendorName = String(data?.vendor?.name || data?.vendor_name || '').trim();
      const resolvedVendorId = directVendorId || String(
        vendorOptions.find((vendor) => String(vendor.name || '').trim().toLowerCase() === poVendorName.toLowerCase())?.id || ''
      ).trim();
      if (resolvedVendorId && poVendorName && !vendorOptions.some((vendor) => String(vendor.id) === resolvedVendorId)) {
        const currentPoVendor = {
          id: resolvedVendorId,
          name: poVendorName,
          contact_person: data?.vendor?.contact_person || '',
        };
        vendorOptions = [...vendorOptions, currentPoVendor].sort((a, b) => a.name.localeCompare(b.name));
        setVendors(vendorOptions);
      }

      const sourceItems: any[] = Array.isArray(data?.purchase_order_items) ? data.purchase_order_items : [];
      const clonedItems: PurchaseOrderFormItem[] = sourceItems.map((item: any) => {
        const quantity = Number(item.ordered_qty || item.quantity || 0) || 0;
        const unitPrice = Number(item.rate || item.unit_price || 0) || 0;
        const discount = Number(item.discount_percent ?? item.discountPercent ?? item.discount ?? 0) || 0;
        const taxRate = Number(item.tax_percent ?? item.taxRate ?? 18) || 0;
        return {
          itemCode: item.item_code || item.item?.code || '',
          itemId: (() => {
            const direct = item.item_id || item.itemId || item.item?.id;
            if (direct) return direct;
            const code = String(item.item_code || item.item?.code || '').trim();
            if (!code) return '';
            const match = items.find((i) => String(i.code).trim() === code);
            return match?.id || '';
          })(),
          itemName: item.item_name || item.item?.name || '',
          vendorId: resolvedVendorId,
          vendorName: poVendorName,
          quantity,
          unitPrice,
          discount,
          taxRate,
          totalPrice: calcPoLineTotal(quantity, unitPrice, discount, taxRate),
          specifications: item.remarks || '',
          paymentTerms: item.payment_terms || '',
          deliveryTerms: item.delivery_terms || '',
          includeDrawing: item.include_drawing === true || item.includeDrawing === true,
          selectedDrawingId: item.selected_drawing_id || item.selectedDrawingId || '',
        };
      });

      setFormData({
        vendorId: resolvedVendorId,
        orderDate: getTodayDateInputValue(),
        expectedDelivery: data.delivery_date || '',
        paymentTerms: data.payment_terms || 'NET_30',
        paymentStatus: 'UNPAID',
        paymentNotes: '',
        deliveryAddress: data.delivery_address || '',
        deliveryContactPerson: data.delivery_contact_person || '',
        deliveryContactPhone: data.delivery_contact_phone || '',
        notes: data.remarks ? `Cloned from ${data.po_number || 'source PO'} - ${data.remarks}` : `Cloned from ${data.po_number || 'source PO'}`,
        quotationRef: data.quotation_ref || '',
        projectId: data.project_id || '',
        projectName: readPoTermsValue(data, 'project', data.project_name || ''),
        freightTerms: readPoTermsValue(data, 'freight', data.freight_terms || ''),
        freightAmount: Number(readPoTermsValue(data, 'freightAmount', data.freight_amount || 0)) || 0,
        freightGstApplicable: readPoTermsValue(data, 'freightGstApplicable', data.freight_gst_applicable || false) === true,
        freightGstPercent: Number(readPoTermsValue(data, 'freightGstPercent', data.freight_gst_percent || 0)) || 0,
        customsDuty: data.customs_duty || 0,
        otherCharges: data.other_charges || 0,
        isImportPurchase: readPoTermsValue(data, 'isImportPurchase', false) === true,
        supplierCurrency: readPoTermsValue(data, 'supplierCurrency', 'INR') || 'INR',
        customsExchangeRate: Number(readPoTermsValue(data, 'customsExchangeRate', 0)) || 0,
        importNotes: readPoTermsValue(data, 'importNotes', ''),
        trackingNumber: '',
        shippedDate: '',
        estimatedDeliveryDate: '',
        carrierName: '',
        trackingUrl: '',
        deliveryStatus: 'PENDING',
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        items: clonedItems,
      });

      setShowViewModal(false);
      setSelectedPO(null);
      setShowModal(true);
      setAlertMessage({
        type: 'info',
        message: `Cloned ${data.po_number || 'PO'} as a new draft. Review quantities, prices, and quotation before saving/submitting.`,
      });
    } catch (error: any) {
      setAlertMessage({ type: 'error', message: error?.message || 'Failed to clone PO' });
    }
  };

  const handleControlledEdit = async (order: PurchaseOrder) => {
    if (order.status === 'APPROVED') {
      const confirmed = await confirmDialog({
        title: 'Create PO Change',
        message: `${order.po_number} is approved. Saving a commercial change will return it to Pending Approval before it can be issued again.`,
        confirmLabel: 'Continue',
      });
      if (!confirmed) return;
    }
    setShowViewModal(false);
    await handleEditDetails(order.id, 'edit');
  };

  const fetchPOEmailPreview = async (poId: string, payload: any, seedEditableFields: boolean) => {
    try {
      setPoEmailPreviewLoading(true);
      const res = await apiClient.post(`/purchase/orders/${poId}/preview-email`, payload);

      setPoEmailPreview(res);
      setShowPOEmailPreview(true);

      if (seedEditableFields) {
        const preview = res?.preview || res;
        setPoEmailTo(String(preview?.to || res?.recipient || ''));
        setPoEmailSubject(String(preview?.subject || ''));
        setPoEmailMessage('');
      }
    } catch (error: any) {
      setAlertMessage({
        type: 'error',
        message: error?.message || 'Failed to generate PO email preview',
      });
    } finally {
      setPoEmailPreviewLoading(false);
    }
  };

  const handlePreviewPOEmail = async (poId: string) => {
    return fetchPOEmailPreview(poId, {}, true);
  };

  const handleUpdatePOEmailPreview = async () => {
    const poId = String(poEmailPreview?.po_id || selectedPO?.id || '').trim();
    if (!poId) return;
    return fetchPOEmailPreview(
      poId,
      {
        to: poEmailTo,
        subject: poEmailSubject,
        customMessage: poEmailMessage,
      },
      false,
    );
  };

  const handleSendPOEmail = async (poId: string) => {
    try {
      setPoEmailSending(true);
      const res = await apiClient.post(`/purchase/orders/${poId}/send-email`, {
        to: poEmailTo,
        subject: poEmailSubject,
        customMessage: poEmailMessage,
      });

      setAlertMessage({
        type: 'success',
        message: res?.message || 'PO email sent successfully',
      });
      setShowPOEmailPreview(false);
      setPoEmailPreview(null);
      setPoEmailTo('');
      setPoEmailSubject('');
      setPoEmailMessage('');
      setShowViewModal(false);
      await fetchOrders();
    } catch (error: any) {
      setAlertMessage({
        type: 'error',
        message: error?.message || 'Failed to send PO email',
      });
    } finally {
      setPoEmailSending(false);
    }
  };

  const buildPoPdfFilename = (poNumber?: string | null) => {
    const normalized = String(poNumber || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ');

    return normalized ? `${normalized}.pdf` : 'PO.pdf';
  };

  const resolvePoPdfFilename = (response: Response, poNumber?: string | null) => {
    const serverFilename = String(response.headers.get('x-document-filename') || '').trim();
    return serverFilename || buildPoPdfFilename(poNumber);
  };

  const buildPoPdfUrl = (poId: string) => `/api/v1/purchase/orders/${poId}/pdf/world-class?v=${Date.now()}`;

  const handleDownloadPDF = async (poId: string, poNumber?: string | null) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(buildPoPdfUrl(poId), {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to download PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resolvePoPdfFilename(response, poNumber);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Delay revoke to let browser finish downloading
      setTimeout(() => window.URL.revokeObjectURL(url), 30000);

      setAlertMessage({
        type: 'success',
        message: 'PDF downloaded successfully',
      });
    } catch (error: any) {
      setAlertMessage({
        type: 'error',
        message: error?.message || 'Failed to download PDF',
      });
    }
  };

  const handleViewPDF = async (poId: string, poNumber?: string | null) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(buildPoPdfUrl(poId), {
        cache: 'no-store',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load PDF: ${response.status} ${response.statusText}`);
      }

      // Create blob from response
      const blob = await response.blob();
      const filename = resolvePoPdfFilename(response, poNumber);
      // Use File (not Blob) so the embedded PDF viewer sees the correct filename
      const pdfFile = new File([blob], filename, { type: 'application/pdf' });
      const pdfUrl = URL.createObjectURL(pdfFile);

      // Open in an HTML wrapper page so the browser tab title = PO filename,
      // ensuring Ctrl+S / browser Save As and Acrobat Save As all suggest the right name.
      const escapedFilename = filename.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapedFilename}</title></head><body style="margin:0;padding:0;height:100vh;overflow:hidden"><embed src="${pdfUrl}" type="application/pdf" style="width:100%;height:100%;border:none" /></body></html>`;
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const htmlUrl = URL.createObjectURL(htmlBlob);

      // Open in new window
      window.open(htmlUrl, '_blank');

      // Don't revoke quickly — user may interact with the PDF viewer tab
      setTimeout(() => { URL.revokeObjectURL(pdfUrl); URL.revokeObjectURL(htmlUrl); }, 300000);
    } catch (error: any) {
      setAlertMessage({
        type: 'error',
        message: error?.message || 'Failed to view PDF',
      });
    }
  };

  const handlePrintPDF = async (poId: string, poNumber?: string | null) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(buildPoPdfUrl(poId), {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load PDF for printing');
      }

      const blob = await response.blob();
      const file = new File([blob], resolvePoPdfFilename(response, poNumber), { type: 'application/pdf' });
      const url = window.URL.createObjectURL(file);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(iframe);
        }, 1000);
      };
    } catch (error: any) {
      setAlertMessage({
        type: 'error',
        message: error?.message || 'Failed to print PDF',
      });
    }
  };

  const handleDeleteAll = async () => {
    const confirmed = await confirmDialog({
      title: `Delete ${orderSelection.selectedItems.length} Purchase Order${orderSelection.selectedItems.length > 1 ? 's' : ''}`,
      message: `This will permanently delete ${orderSelection.selectedItems.length} purchase order${orderSelection.selectedItems.length > 1 ? 's' : ''}. This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      const selectedOrders = [...orderSelection.selectedItems];
      const results = await Promise.allSettled(
        selectedOrders.map((order) => apiClient.delete(`/purchase/orders/${order.id}`)),
      );

      const failed: Array<{ poNumber: string; reason: string }> = [];
      let successCount = 0;

      results.forEach((result, index) => {
        const order = selectedOrders[index];
        if (result.status === 'fulfilled') {
          successCount += 1;
          return;
        }

        const reason =
          (result.reason as any)?.message ||
          (typeof result.reason === 'string' ? result.reason : 'Delete failed');

        failed.push({ poNumber: order?.po_number || 'Unknown PO', reason });
      });

      orderSelection.deselectAll();
      fetchOrders();

      if (failed.length === 0) {
        setAlertMessage({
          type: 'success',
          message: `${successCount} purchase orders deleted successfully`,
        });
        return;
      }

      const shown = failed.slice(0, 3);
      const remainder = failed.length - shown.length;
      const details = shown
        .map((f) => `${f.poNumber}: ${f.reason}`)
        .join(' | ');
      const suffix = remainder > 0 ? ` (+${remainder} more)` : '';

      setAlertMessage({
        type: failed.length === selectedOrders.length ? 'error' : 'info',
        message: `Deleted ${successCount} of ${selectedOrders.length} purchase orders. Failed: ${details}${suffix}`,
      });
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: (error as any)?.message || 'Failed to delete purchase orders',
      });
    }
  };

  const handleDeleteOne = async (order: PurchaseOrder) => {
    const confirmed = await confirmDialog({
      title: 'Delete Purchase Order',
      message: `This will permanently delete ${order.po_number || 'this purchase order'}. This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await apiClient.delete(`/purchase/orders/${order.id}`);
      orderSelection.deselectAll();
      fetchOrders();
      setAlertMessage({
        type: 'success',
        message: `${order.po_number || 'Purchase order'} deleted successfully`,
      });
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: (error as any)?.message || 'Failed to delete purchase order',
      });
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'bg-gray-100 text-gray-800',
      PENDING: 'bg-orange-100 text-orange-800',
      SENT: 'bg-blue-100 text-blue-800',
      ACKNOWLEDGED: 'bg-[#F5EFE3] text-[#5E4635]',
      APPROVED: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      PARTIAL: 'bg-yellow-100 text-yellow-800',
      COMPLETED: 'bg-green-100 text-green-800',
      CLOSED: 'bg-gray-100 text-gray-800',
      CANCELLED: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getPaymentStatusLabel = (status?: string | null) => {
    const key = String(status || 'UNPAID').toUpperCase();
    if (key === 'PAID') return 'Payment Done';
    if (key === 'PARTIAL' || key === 'PARTIALLY_PAID') return 'Partial Payment';
    if (key === 'CHEQUE_ISSUED') return 'Cheque Issued';
    if (key === 'OTHER') return 'Other';
    return 'Unpaid';
  };

  const getPoLifecycle = (order: PurchaseOrder): { label: string; className: string } => {
    const status = String(order.status || '').toUpperCase();
    const deliveryStatus = String((order as any).delivery_status || '').toUpperCase();
    const paymentStatus = String(order.payment_status || '').toUpperCase();
    const receiptStatus = String((order as any).receipt_status || '').toUpperCase();

    if (receiptStatus === 'FULLY_RECEIVED') return { label: 'Closed', className: 'bg-gray-100 text-gray-800' };
    if (receiptStatus === 'PARTIALLY_RECEIVED') return { label: 'Partial', className: 'bg-yellow-100 text-yellow-800' };
    if (paymentStatus === 'PAID') return { label: 'Payment Done', className: 'bg-green-100 text-green-800' };
    if (paymentStatus === 'PARTIAL' || paymentStatus === 'PARTIALLY_PAID') return { label: 'Partial Payment', className: 'bg-yellow-100 text-yellow-800' };
    if (deliveryStatus === 'IN_TRANSIT' || deliveryStatus === 'SHIPPED') return { label: 'Under Transit', className: 'bg-blue-100 text-blue-800' };
    if (status === 'APPROVED') return { label: 'Approved', className: 'bg-green-100 text-green-800' };
    if (status === 'PARTIAL') return { label: 'Partial', className: 'bg-yellow-100 text-yellow-800' };
    if (status === 'CLOSED') return { label: 'Closed', className: 'bg-gray-100 text-gray-800' };
    if (status === 'PENDING') return { label: 'Pending for Approval', className: 'bg-orange-100 text-orange-800' };
    if (status === 'DRAFT') return { label: 'Draft', className: 'bg-gray-100 text-gray-800' };
    if (status === 'REJECTED') return { label: 'Rejected', className: 'bg-red-100 text-red-800' };
    return { label: status || 'Draft', className: getStatusColor(status) };
  };

  const getReceiptStatusColor = (receiptStatus: string) => {
    const key = String(receiptStatus || '').toUpperCase();
    if (key === 'FULLY_RECEIVED') return 'bg-green-100 text-green-800';
    if (key === 'PARTIALLY_RECEIVED') return 'bg-yellow-100 text-yellow-800';
    if (key === 'OPEN') return 'bg-gray-100 text-gray-800';
    return 'bg-gray-100 text-gray-800';
  };

  const buildPoItemSearchText = (order: PurchaseOrder) => {
    const items = Array.isArray((order as any).purchase_order_items)
      ? (order as any).purchase_order_items
      : [];

    return items
      .map((item: any) => [
        item?.item_code,
        item?.itemCode,
        item?.item_name,
        item?.itemName,
        item?.description,
        item?.line_description,
        item?.specifications,
        item?.notes,
        item?.remarks,
        item?.oem_part_no,
        item?.oem_part_number,
        item?.oem_name,
        item?.item?.code,
        item?.item?.name,
        item?.item?.description,
        item?.item?.oem_part_no,
        item?.item?.oem_part_number,
        item?.item?.oem_name,
      ].filter(Boolean).join(' '))
      .join(' ');
  };

  const handleSendMaterialReminder = async (poId: string) => {
    const confirmed = await confirmDialog({
      title: 'Send Material Reminder',
      message: 'Email the supplier a reminder for the outstanding material and expected delivery date?',
      confirmLabel: 'Send Reminder',
    });
    if (!confirmed) return;
    try {
      setPoEmailSending(true);
      const response = await apiClient.post(`/purchase/orders/${poId}/send-tracking-reminder`, {});
      setAlertMessage({ type: 'success', message: response?.message || 'Material reminder sent successfully' });
    } catch (error: any) {
      setAlertMessage({ type: 'error', message: error?.message || 'Material reminder could not be sent' });
    } finally {
      setPoEmailSending(false);
    }
  };

  const ordersTableColumns: Array<ListTableColumn<PurchaseOrder>> = [
    {
      id: 'select',
      label: '',
      sortable: false,
      hideable: false,
      cell: (order) => (
        <input
          type="checkbox"
          checked={orderSelection.isSelected(order.id)}
          onChange={() => orderSelection.toggleSelection(order.id)}
          className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
        />
      ),
      minWidth: 48,
      headerClassName: 'w-[4%]',
      cellClassName: 'w-[4%]',
    },
    {
      id: 'po_date',
      label: 'Date',
      accessor: (o) => o.po_date,
      sortAccessor: (o) => (o.po_date ? new Date(o.po_date).getTime() : 0),
      cell: (o) => (
        <span className="whitespace-nowrap text-gray-600">
          {o.po_date
            ? (() => {
                try {
                  return new Date(o.po_date).toLocaleDateString();
                } catch {
                  return o.po_date;
                }
              })()
            : '-'}
        </span>
      ),
      minWidth: 130,
      headerClassName: 'w-[12%]',
      cellClassName: 'w-[12%]',
    },
    {
      id: 'po_number',
      label: 'PO Number',
      accessor: (o) => o.po_number,
      cell: (o) => (
        <span className="block truncate font-medium text-gray-900" title={o.po_number || ''}>
          {o.po_number?.startsWith('DRAFT-') ? <span className="italic text-gray-400">Draft</span> : o.po_number}
        </span>
      ),
      minWidth: 170,
      headerClassName: 'w-[18%]',
      cellClassName: 'w-[18%]',
    },
    {
      id: 'pr_ref',
      label: 'PR Ref',
      accessor: (o) => o.pr?.pr_number || '-',
      defaultVisible: false,
      minWidth: 140,
    },
    {
      id: 'item_description_search',
      label: 'Item / Description',
      accessor: buildPoItemSearchText,
      searchAccessor: buildPoItemSearchText,
      defaultVisible: false,
      minWidth: 220,
    },
    {
      id: 'vendor',
      label: 'Supplier',
      accessor: (o) => o.vendor?.name || '',
      searchAccessor: (o) => `${o.vendor?.name || ''} ${o.vendor?.contact_person || ''}`.trim(),
      cell: (o) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900" title={o.vendor?.name || '-'}>{o.vendor?.name || '-'}</div>
          {o.vendor?.contact_person && <div className="truncate text-[11px] text-gray-500" title={o.vendor.contact_person}>{o.vendor.contact_person}</div>}
        </div>
      ),
      minWidth: 300,
      headerClassName: 'w-[34%]',
      cellClassName: 'w-[34%]',
    },
    {
      id: 'delivery_date',
      label: 'Expected',
      accessor: (o) => o.delivery_date,
      sortAccessor: (o) => (o.delivery_date ? new Date(o.delivery_date).getTime() : 0),
      cell: (o) => (
        <span className="text-sm text-gray-600">
          {o.delivery_date
            ? (() => {
                try {
                  return new Date(o.delivery_date).toLocaleDateString();
                } catch {
                  return o.delivery_date;
                }
              })()
            : '-'}
        </span>
      ),
      defaultVisible: false,
      minWidth: 140,
    },
    {
      id: 'payment_terms',
      label: 'Payment Terms',
      accessor: (o) => (o as any)?.payment_terms || (o as any)?.paymentTerms || '-',
      cell: (o) => <span className="block break-words text-sm text-gray-700">{(o as any)?.payment_terms || (o as any)?.paymentTerms || '-'}</span>,
      defaultVisible: false,
      minWidth: 170,
      headerClassName: 'w-[16%]',
      cellClassName: 'w-[16%]',
    },
    {
      id: 'delivery_terms',
      label: 'Delivery Terms',
      accessor: (o) => (o as any)?.delivery_terms || (o as any)?.deliveryTerms || '-',
      cell: (o) => <span className="block break-words text-sm text-gray-700">{(o as any)?.delivery_terms || (o as any)?.deliveryTerms || '-'}</span>,
      defaultVisible: false,
      minWidth: 170,
      headerClassName: 'w-[10%]',
      cellClassName: 'w-[10%]',
    },
    {
      id: 'items_count',
      label: 'Items',
      accessor: (o) => o.purchase_order_items?.length || 0,
      sortAccessor: (o) => o.purchase_order_items?.length || 0,
      cell: (o) => <span className="text-sm text-gray-600">{o.purchase_order_items?.length || 0} items</span>,
      defaultVisible: false,
      minWidth: 110,
    },
    {
      id: 'total_amount',
      label: 'Amount',
      accessor: (o) => {
        // Calculate grand total including freight from terms_and_conditions
        const items = o.purchase_order_items || [];
        const itemsSubtotal = items.reduce((sum: number, item: any) => sum + (item.total_amount || item.amount || 0), 0);
        const tc = o.terms_and_conditions;
        let freightData: any = {};
        try {
          if (tc && typeof tc === 'string' && tc.startsWith('{')) {
            freightData = JSON.parse(tc);
          } else if (tc && typeof tc === 'object') {
            freightData = tc;
          }
        } catch {}
        const freightAmount = freightData.freightAmount || o.freight_amount || 0;
        const freightGstApplicable = freightData.freightGstApplicable === true || o.freight_gst_applicable === true;
        const freightGstPercent = freightData.freightGstPercent || o.freight_gst_percent || 0;
        const freightGstAmount = freightGstApplicable ? Math.round(freightAmount * freightGstPercent) / 100 : 0;
        const customsDuty = o.customs_duty || freightData.additionalExpenses || 0;
        const otherCharges = o.other_charges || 0;
        return itemsSubtotal + freightAmount + freightGstAmount + customsDuty + otherCharges;
      },
      align: 'right',
      cell: (o) => {
        // Calculate grand total including freight from terms_and_conditions
        const items = o.purchase_order_items || [];
        const itemsSubtotal = items.reduce((sum: number, item: any) => sum + (item.total_amount || item.amount || 0), 0);
        const tc = o.terms_and_conditions;
        let freightData: any = {};
        try {
          if (tc && typeof tc === 'string' && tc.startsWith('{')) {
            freightData = JSON.parse(tc);
          } else if (tc && typeof tc === 'object') {
            freightData = tc;
          }
        } catch {}
        const freightAmount = freightData.freightAmount || o.freight_amount || 0;
        const freightGstApplicable = freightData.freightGstApplicable === true || o.freight_gst_applicable === true;
        const freightGstPercent = freightData.freightGstPercent || o.freight_gst_percent || 0;
        const freightGstAmount = freightGstApplicable ? Math.round(freightAmount * freightGstPercent) / 100 : 0;
        const customsDuty = o.customs_duty || freightData.additionalExpenses || 0;
        const otherCharges = o.other_charges || 0;
        const grandTotal = itemsSubtotal + freightAmount + freightGstAmount + customsDuty + otherCharges;
        return (
          <span className="whitespace-nowrap font-semibold text-gray-900">₹{fmtRoundedINR(grandTotal)}</span>
        );
      },
      minWidth: 150,
      headerClassName: 'w-[10%]',
      cellClassName: 'w-[10%]',
    },
    {
      id: 'payment_status',
      label: 'Payment',
      accessor: (o) => getPaymentStatusLabel(o.payment_status),
      cell: (o) => (
        <span
          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
            o.payment_status === 'PAID'
              ? 'bg-green-100 text-green-700'
              : o.payment_status === 'PARTIAL' || o.payment_status === 'PARTIALLY_PAID'
                ? 'bg-yellow-100 text-yellow-700'
              : o.payment_status === 'CHEQUE_ISSUED'
                ? 'bg-blue-100 text-blue-700'
                : o.payment_status === 'OTHER'
                  ? 'bg-[#F5EFE3] text-[#6F4E37]'
                  : 'bg-yellow-100 text-yellow-700'
          }`}
        >
          {getPaymentStatusLabel(o.payment_status)}
        </span>
      ),
      align: 'center',
      defaultVisible: false,
      minWidth: 130,
    },
    {
      id: 'receipt',
      label: 'Receipt',
      accessor: (o) => (o as any).receipt_status || 'OPEN',
      cell: (o) => {
        const receiptStatus = String((o as any).receipt_status || 'OPEN');
        const progress = (o as any).receipt_progress || {};
        const orderedQty = Number(progress.ordered_qty ?? 0) || 0;
        const receivedQty = Number(progress.received_qty ?? 0) || 0;
        const receivedPercent = Number(
          progress.received_percent ?? (orderedQty > 0 ? (receivedQty / orderedQty) * 100 : 0),
        );

        const pctText = Number.isFinite(receivedPercent)
          ? `${receivedPercent % 1 === 0 ? receivedPercent.toFixed(0) : receivedPercent.toFixed(1)}%`
          : '';

        return (
          <div className="text-center">
            <span
              className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getReceiptStatusColor(receiptStatus)}`}
            >
              {receiptStatus === 'FULLY_RECEIVED' || receiptStatus === 'PARTIALLY_RECEIVED' ? 'GRN Done' : receiptStatus}
            </span>
            <div className="mt-1 text-xs text-gray-500 whitespace-nowrap">
              {receivedQty}/{orderedQty}{orderedQty > 0 ? ` (${pctText})` : ''}
            </div>
          </div>
        );
      },
      align: 'center',
      defaultVisible: false,
      minWidth: 150,
      headerClassName: 'w-[9%]',
      cellClassName: 'w-[9%]',
    },
    {
      id: 'last_edited_at',
      label: 'Date Modified',
      accessor: (o) => (o as any).last_edited_at || '',
      sortAccessor: (o) => ((o as any).last_edited_at ? new Date((o as any).last_edited_at).getTime() : 0),
      cell: (o) => {
        const d = (o as any).last_edited_at;
        if (!d) return <span className="text-xs text-gray-400">—</span>;
        const dt = new Date(d);
        return (
          <span className="text-xs text-gray-700 whitespace-nowrap">
            {dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            <span className="block text-gray-400">{dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </span>
        );
      },
      defaultVisible: false,
      minWidth: 140,
    },
    {
      id: 'edit_count',
      label: 'Modified',
      accessor: (o) => (o as any).edit_count ?? 0,
      sortAccessor: (o) => (o as any).edit_count ?? 0,
      cell: (o) => {
        const count = (o as any).edit_count;
        const user = (o as any).updated_by;
        if (!count) return <span className="text-xs text-gray-400">—</span>;
        return (
          <span className="text-xs text-gray-700">
            {count} time{count !== 1 ? 's' : ''}
            {user && <span className="block text-gray-400 truncate" title={user}>{user}</span>}
          </span>
        );
      },
      defaultVisible: false,
      minWidth: 130,
    },
    {
      id: 'status',
      label: 'Status',
      accessor: (o) => getPoLifecycle(o).label,
      cell: (o) => {
        const lifecycle = getPoLifecycle(o);
        return (
          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${lifecycle.className}`}>
            {lifecycle.label}
          </span>
        );
      },
      align: 'center',
      defaultVisible: false,
      minWidth: 130,
    },
    {
      id: 'actions',
      label: 'Actions',
      sortable: false,
      hideable: false,
      align: 'right',
      minWidth: 150,
      headerClassName: 'w-[16%]',
      cellClassName: 'w-[16%]',
      cell: (o) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          <ErpButton
            type="button"
            onClick={() => handleViewDetails(o.id)}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="View purchase order"
            aria-label="View purchase order"
          >
            <Eye className="h-4 w-4" />
          </ErpButton>
          <ErpButton
            type="button"
            onClick={() => fetchTrailData(o)}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="View PO lifecycle trail"
            aria-label="View PO lifecycle trail"
          >
            <GitBranch className="h-4 w-4" />
          </ErpButton>
          {canCreatePO && (
            <ErpButton
              type="button"
              onClick={() => handleClonePO(o.id)}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Clone purchase order as new draft"
              aria-label="Clone purchase order as new draft"
            >
              <Copy className="h-4 w-4" />
            </ErpButton>
          )}
          {(canEditPO && ['DRAFT', 'REJECTED', 'APPROVED'].includes(o.status) || canEditPendingPO(o)) && (
          <ErpButton
            type="button"
            onClick={() => handleControlledEdit(o)}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title={o.status === 'APPROVED' ? 'Create controlled PO change' : o.status === 'PENDING' ? 'Edit and resubmit purchase order' : 'Edit purchase order'}
            aria-label={o.status === 'APPROVED' ? 'Create controlled PO change' : o.status === 'PENDING' ? 'Edit and resubmit purchase order' : 'Edit purchase order'}
          >
            <Pencil className="h-4 w-4" />
          </ErpButton>
          )}
          {canDeletePO && ['DRAFT', 'REJECTED'].includes(o.status) && (
            <ErpButton
              type="button"
              onClick={() => handleDeleteOne(o)}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-red-700"
              title="Delete purchase order"
              aria-label="Delete purchase order"
            >
              <Trash2 className="h-4 w-4" />
            </ErpButton>
          )}
        </div>
      ),
    },
  ];

  const poMetrics = [
    { label: 'Total Orders', value: orders.length },
    { label: 'Pending Approval', value: orders.filter((order) => order.status === 'PENDING').length, tone: 'warning' as const },
    { label: 'Approved', value: orders.filter((order) => order.status === 'APPROVED').length, tone: 'success' as const },
    { label: 'Open Receipt', value: orders.filter((order) => !order.receipt_status || order.receipt_status === 'OPEN').length },
  ];

  return (
    <div className="space-y-4">
      <div className="w-full max-w-none">
        {!showModal && (
          <>
        <ErpPageHeader
          eyebrow="PROCUREMENT"
          title="Purchase Orders"
          description="Create, approve, issue, receive, and track supplier commitments."
          actions={
            <>
            {orderSelection.hasSelections && canDeletePO && (
              <ErpButton
                onClick={handleDeleteAll}
                variant="danger"
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected ({orderSelection.selectedItems.length})
              </ErpButton>
            )}
            {canCreatePO && (
            <ErpButton
              onClick={() => {
                setShowModal(true);
                setEditingMode('create');
                setEditingPOId(null);
                // Lazy load items when modal opens
                if (items.length === 0) {
                  fetchItems();
                }
              }}
              variant="primary"
            >
              <Plus className="h-4 w-4" />
              New Purchase Order
            </ErpButton>
            )}
            </>
          }
        />

        <ErpMetricStrip metrics={poMetrics} loading={loading} />

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#4A3426]">Purchase Order Register</h2>
          <span className="text-xs text-[#7A6555]">{orders.length} records</span>
        </div>

        {/* Orders List */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-md border border-gray-200">
            <div className="p-8 text-center text-gray-500">Loading orders...</div>
          </div>
        ) : (
          <ListTable
            storageKey="purchaseOrdersTable:sap:v1"
            rows={orders}
            columns={ordersTableColumns}
            getRowId={(o) => o.id}
            defaultPageSize={10}
            pageSizeOptions={[10, 25, 50, 100]}
            searchPlaceholder="Search PO number, vendor, PR ref, item code, name, description…"
            toolbarRight={
              <div className="flex w-full flex-wrap items-center gap-2 2xl:w-auto 2xl:flex-nowrap">
                {orders.length > 0 && (
                  <div className="flex min-h-9 items-center gap-2 border-r border-[#E8DCC4] pr-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={orderSelection.isAllSelected}
                        onChange={orderSelection.toggleSelectAll}
                        className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                        Select All ({orders.length})
                      </span>
                    </label>
                    {orderSelection.hasSelections && (
                      <button
                        onClick={orderSelection.deselectAll}
                        className="text-xs text-amber-600 hover:text-amber-800 font-medium whitespace-nowrap"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
                <div className="min-w-[15rem] flex-1 2xl:w-64 2xl:flex-none">
                  <SearchableSelect
                    options={[{ value: '', label: 'All suppliers' }, ...vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))]}
                    value={filterVendor}
                    onChange={setFilterVendor}
                    placeholder="All suppliers"
                  />
                </div>
                <div className="min-w-[13rem] flex-1 2xl:w-56 2xl:flex-none">
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'All statuses' },
                      { value: 'DRAFT', label: 'Draft' },
                      { value: 'PENDING', label: 'Pending Approval' },
                      { value: 'APPROVED', label: 'Approved' },
                      { value: 'REJECTED', label: 'Rejected' },
                      { value: 'SENT', label: 'Sent' },
                      { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
                      { value: 'PARTIAL', label: 'Partial' },
                      { value: 'COMPLETED', label: 'Completed' },
                    ]}
                    value={filterStatus}
                    onChange={setFilterStatus}
                    placeholder="All statuses"
                  />
                </div>
              </div>
            }
            emptyState={
              <div className="p-12 text-center">
                <div className="text-6xl mb-4">📋</div>
                <h3 className="text-xl font-semibold text-gray-700 mb-2">No Purchase Orders Yet</h3>
                <p className="text-gray-500">Create your first purchase order to get started</p>
              </div>
            }
          />
        )}
          </>
        )}

      {/* Create/Edit Form */}
      {showModal && (
        <FullScreenPortal>
        <div className="fixed inset-0 z-[1000] flex h-[100dvh] w-screen flex-col overflow-hidden bg-white">
            <div className="z-20 flex shrink-0 flex-col gap-3 border-b border-[#E8DCC4] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <h2 className="text-lg font-bold text-[#4A3426] sm:text-xl">
                {editingMode === 'create'
                  ? `Create ${isServiceOrder ? 'Service' : 'Purchase'} Order`
                  : editingMode === 'tracking'
                    ? 'Update Tracking Information'
                    : `Edit ${isServiceOrder ? 'Service' : 'Purchase'} Order`}
              </h2>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:gap-3 [&>button]:shrink-0">
                <ErpButton
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  variant="secondary"
                >
                  Cancel
                </ErpButton>
                {editingMode === 'tracking' && editingPOId ? (
                  <ErpButton
                  onClick={() => handleSaveTracking(editingPOId)}
                  disabled={submitting}
                    variant="primary"
                  >
                    <Save className="h-4 w-4" />
                    {submitting ? 'Saving...' : 'Save Tracking Info'}
                  </ErpButton>
                ) : editingMode === 'edit' && editingPOId ? (
                  <ErpButton
                    onClick={() => handleUpdateOrder(editingPOId)}
                    disabled={submitting}
                    variant="primary"
                  >
                    <Save className="h-4 w-4" />
                    {submitting ? 'Saving...' : 'Save Changes'}
                  </ErpButton>
                ) : (
                  <>
                    <ErpButton
                      onClick={() => handleCreateOrder('DRAFT')}
                      disabled={submitting}
                      variant="secondary"
                    >
                      <Save className="h-4 w-4" />
                      {submitting ? 'Saving...' : 'Save as Draft'}
                    </ErpButton>
                    <ErpButton
                      onClick={() => handleCreateOrder('PENDING')}
                      disabled={submitting}
                      variant="primary"
                      className="w-full sm:w-auto"
                    >
                      <Send className="h-4 w-4" />
                      {submitting ? 'Submitting...' : 'Submit for Approval'}
                    </ErpButton>
                  </>
                )}
              </div>
            </div>
            <ObjectPageNav sections={editingMode === 'tracking'
              ? [{ id: 'po-form-tracking', label: 'Tracking' }]
              : [
                  { id: 'po-form-header', label: 'Header' },
                  ...(editingMode === 'edit' ? [{ id: 'po-form-tracking', label: 'Fulfilment' }] : []),
                  { id: 'po-form-items', label: `Items (${formData.items.length})` },
                  { id: 'po-form-documents', label: `Documents (${formData.attachments.length})` },
                  { id: 'po-form-commercial', label: 'Commercial' },
                ]}
            />
            <div className="flex-1 space-y-5 overflow-y-auto scroll-smooth bg-[#FAF9F6] p-4 md:p-5">
              {/* Order Details */}
              <section id="po-form-header" className="scroll-mt-4 space-y-2 border border-[#E8DCC4] bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#EFE5D2] pb-2">
                  <div>
                    <h3 className="text-base font-semibold text-[#4A3426]">Header Data</h3>
                    <p className="text-xs text-[#7A6555]">Supplier, dates, payment terms, delivery, and commercial references.</p>
                  </div>
                  <span className="rounded-full border border-[#D8C8AA] bg-[#FFFCF5] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    PO Header
                  </span>
                </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                {editingMode === 'create' && (
                  <div className="md:col-span-2 xl:col-span-5">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">
                      Purchase Requisition (optional)
                    </label>
                    <SearchableSelect
                      value={currentPrId || ''}
                      onChange={(value) => {
                        const next = String(value || '').trim();
                        if (!next) {
                          setCurrentPrId(null);
                          setCurrentPrDepartment('');
                          setRfqRespondedVendorIds([]);
                          setRfqHistory([]);
                          setSupplierAttachments({});
                          setFormData((prev) => ({ ...prev, projectId: '', projectName: '', items: [] }));
                          return;
                        }
                        loadPRData(next);
                      }}
                      options={purchaseRequisitions.map((pr) => ({
                        value: pr.id,
                        label: pr.pr_number,
                        subtitle: pr.department || pr.status || '',
                      }))}
                      placeholder={loadingPrList ? 'Loading PRs...' : 'Select PR...'}
                    />
                  </div>
                )}
                {currentPrId && (
                  <section className="md:col-span-2 xl:col-span-5 rounded-lg border border-[#D8C8AA] bg-[#FFFCF5]" aria-label="RFQ vendor comparison">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E8DCC4] px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#4A3426]">RFQ comparison</h3>
                        <p className="text-xs text-[#7A6555]">
                          RFQ vendors are shown here. Apply a received quote, or choose a vendor manually below if responses are still pending.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[#D8C8AA] bg-white px-3 py-1 text-xs font-semibold text-[#4A3426]">
                          {rfqHistory.length} vendor RFQ{rfqHistory.length === 1 ? '' : 's'}
                        </span>
                        <ErpButton
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => router.push(`/dashboard/purchase/requisitions?open=${encodeURIComponent(currentPrId)}&rfqResponses=1`)}
                          className="whitespace-nowrap"
                        >
                          <Pencil className="h-4 w-4" />
                          Record RFQ Response
                        </ErpButton>
                      </div>
                    </div>
                    {rfqHistory.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-[960px] w-full text-sm">
                          <thead className="bg-[#F5EFE3] text-left text-xs uppercase tracking-wide text-[#5E4635]">
                            <tr>
                              <th className="px-4 py-2 font-semibold">Vendor</th>
                              <th className="px-4 py-2 font-semibold">RFQ status</th>
                              <th className="px-4 py-2 font-semibold">Quoted items</th>
                              <th className="px-4 py-2 font-semibold">Quote value</th>
                              <th className="px-4 py-2 font-semibold">Lead / delivery terms</th>
                              <th className="px-4 py-2 font-semibold">Notes</th>
                              <th className="px-4 py-2 text-right font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rfqHistory.map((rfq) => {
                              const status = String(rfq.status || '').toUpperCase();
                              const received = ['RECEIVED', 'RESPONDED'].includes(status);
                              const rfqItems = Array.isArray(rfq.rfq_items) ? rfq.rfq_items : [];
                              const quoteValue = rfqItems.reduce((sum: number, item: any) => {
                                const qty = Number(item.requested_qty || 0);
                                const rate = item.vendor_quoted_price == null ? null : Number(item.vendor_quoted_price);
                                return Number.isFinite(rate) && rate != null ? sum + qty * rate : sum;
                              }, 0);
                              const leadTimes = rfqItems
                                .map((item: any) => item.vendor_quoted_lead_time)
                                .filter((value: any) => value !== null && value !== undefined && value !== '')
                                .map((value: any) => `${value} days`);
                              const notes = [
                                rfq.response_remarks,
                                ...rfqItems.map((item: any) => item.vendor_notes).filter(Boolean),
                              ].filter(Boolean);
                              return (
                                <tr key={rfq.id || rfq.rfq_number} className="border-t border-[#E8DCC4] align-top">
                                  <td className="px-4 py-3">
                                    <div className="font-semibold text-[#2F241B]">{rfq.vendor?.name || rfq.vendor_name || '-'}</div>
                                    <div className="text-xs text-[#7A6555]">{rfq.vendor?.email || rfq.meta?.recipientEmail || rfq.rfq_number || '-'}</div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                                      received
                                        ? 'border-green-200 bg-green-50 text-green-800'
                                        : 'border-[#D8C8AA] bg-white text-[#7A6555]'
                                    }`}>
                                      {status || 'SENT'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-[#4A3426]">
                                    {rfqItems.length > 0 ? `${rfqItems.length} item${rfqItems.length === 1 ? '' : 's'}` : '-'}
                                  </td>
                                  <td className="px-4 py-3 font-semibold text-[#2F241B]">
                                    {quoteValue > 0 ? `₹${fmtINR(quoteValue)}` : '-'}
                                  </td>
                                  <td className="px-4 py-3 text-[#4A3426]">
                                    {leadTimes.length > 0 ? Array.from(new Set(leadTimes)).join(', ') : '-'}
                                  </td>
                                  <td className="max-w-[260px] px-4 py-3 text-[#7A6555]">
                                    {notes.length > 0 ? Array.from(new Set(notes)).join(' | ') : '-'}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <ErpButton
                                      type="button"
                                      size="sm"
                                      variant={received ? 'primary' : 'secondary'}
                                      disabled={!received}
                                      onClick={() => handleApplyRfqQuote(rfq)}
                                      className="whitespace-nowrap"
                                    >
                                      <Check className="h-4 w-4" />
                                      Use Quote
                                    </ErpButton>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-4 py-3 text-sm text-[#7A6555]">
                        No vendor RFQs are recorded for this PR yet. You can still create the PO by selecting a vendor manually.
                      </div>
                    )}
                  </section>
                )}
                <div className="xl:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">
                    Vendor <span className="text-red-500">*</span>
                    {currentPrId && <span className="ml-2 text-xs font-normal text-[#8B6F47]">optional bulk override; PO creation groups by each line supplier</span>}
                  </label>
                  <SearchableSelect
                    value={formData.vendorId}
                    onChange={(value) => handleSetAllVendors(String(value || ''))}
                    options={(() => {
                      const responded = new Set(rfqRespondedVendorIds);
                      const rfqVendors = new Set(rfqHistory.map((rfq) => resolveVendorIdFromAny(rfq)).filter(Boolean));
                      const preferredName = formData.items.find(
                        (item) => String(item.vendorId || '').trim() === String(formData.vendorId || '').trim(),
                      )?.vendorName;
                      const selectableVendors = [...vendors];
                      if (
                        formData.vendorId &&
                        !selectableVendors.some((vendor) => String(vendor.id) === String(formData.vendorId))
                      ) {
                        selectableVendors.push({
                          id: String(formData.vendorId),
                          name: String(preferredName || 'Preferred Vendor'),
                          contact_person: '',
                        });
                      }
                      return selectableVendors
                        .sort((a, b) =>
                          Number(responded.has(String(b.id))) - Number(responded.has(String(a.id))) ||
                          Number(rfqVendors.has(String(b.id))) - Number(rfqVendors.has(String(a.id))) ||
                          a.name.localeCompare(b.name)
                        )
                        .map((v) => ({
                        value: v.id,
                        label: v.name,
                        subtitle: responded.has(String(v.id))
                          ? `RFQ response received${v.contact_person ? ` - ${v.contact_person}` : ''}`
                          : rfqVendors.has(String(v.id))
                            ? `RFQ sent - awaiting response${v.contact_person ? ` - ${v.contact_person}` : ''}`
                            : String(v.id) === String(formData.vendorId) && preferredName
                              ? 'Preferred vendor from Item Master'
                              : (v.contact_person || 'Manual vendor'),
                      }));
                    })()}
                    placeholder={currentPrId ? 'Optional: apply one vendor to all PR lines...' : 'Search vendor to apply to all items...'}
                  />
                  {currentPrId && prSupplierGroups.length > 1 && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-900">
                      <div className="font-semibold">Supplier-wise PO split ready: {prSupplierGroups.length} POs will be created</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {prSupplierGroups.map((group) => (
                          <span
                            key={group.vendorId}
                            className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-800"
                          >
                            {group.vendorName}: {group.itemCount} line{group.itemCount === 1 ? '' : 's'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentPrId && prSupplierGroups.length === 0 && formData.items.length > 0 && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      No line supplier is selected yet. Select a supplier on each PR line, or use the vendor field above only if all lines should go to one supplier.
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Order Date <span className="text-red-500">*</span></label>
                  <DateInput
                    min={todayDate}
                    value={formData.orderDate}
                    onChange={(value) => setFormData({ ...formData, orderDate: value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Expected Delivery</label>
                  <DateInput
                    min={formData.orderDate || todayDate}
                    value={formData.expectedDelivery}
                    onChange={(value) => setFormData({ ...formData, expectedDelivery: value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Payment Terms</label>
                  <select
                    value={isStandardPaymentTerm(formData.paymentTerms) ? formData.paymentTerms : 'CUSTOM'}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, paymentTerms: value === 'CUSTOM' ? '' : value });
                    }}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  >
                    {PAYMENT_TERM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                    <option value="CUSTOM">Custom / Other</option>
                  </select>
                  {!isStandardPaymentTerm(formData.paymentTerms) ? (
                    <input
                      type="text"
                      value={formData.paymentTerms}
                      onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                      className="mt-2 w-full border border-gray-300 rounded-lg px-4 py-2"
                      placeholder="Enter custom payment terms"
                    />
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-[#E8DCC4] bg-[#FFFCF5] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900">Delivery Address</label>
                  {deliveryAddresses.length > 0 && (
                    <span className="text-[11px] font-medium text-[#8B6F47]">Saved addresses scroll horizontally</span>
                  )}
                </div>
                <div className="space-y-2">
                  {/* Saved addresses quick-select */}
                  {deliveryAddresses.length > 0 && (
                    <div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {deliveryAddresses.map((entry) => (
                          <div key={entry.id} className="flex shrink-0 items-center gap-1 bg-gray-50 rounded-full border border-gray-200 pr-1">
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, deliveryAddress: entry.address })}
                              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                formData.deliveryAddress === entry.address
                                ? 'bg-amber-700 text-white border-amber-700'
                                : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-50'
                            }`}
                            >
                              📍 {entry.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDeliveryAddress(entry.id)}
                              className="w-6 h-6 flex items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 text-sm font-bold transition-colors"
                              title="Delete this saved address"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <textarea
                    value={formData.deliveryAddress}
                    onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="Enter delivery address..."
                  />
                  {/* Save current address for future reuse */}
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <input
                      value={deliveryAddressName}
                      onChange={(e) => setDeliveryAddressName(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                      placeholder="Label to save this address (e.g. Factory, Head Office)"
                    />
                    <button
                      type="button"
                      onClick={handleSaveDeliveryAddress}
                      disabled={deliveryAddressSaving || !formData.deliveryAddress.trim()}
                      className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {deliveryAddressSaving ? 'Saving…' : '💾 Save for reuse'}
                    </button>
                  </div>
                                  </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Consignee POC Name</label>
                  {users.length > 0 ? (
                    <SearchableSelect
                      value={formData.deliveryContactPerson}
                      onChange={(selectedName) => {
                        const selectedUser = users.find(u => u.employee_name === selectedName);
                        // Try multiple possible phone field names
                        const phone = selectedUser?.phone || selectedUser?.mobile || selectedUser?.phone_number || selectedUser?.contact_number || selectedUser?.mobile_number || '';
                        setFormData({
                          ...formData,
                          deliveryContactPerson: selectedName,
                          deliveryContactPhone: phone
                        });
                      }}
                      options={users.map((u) => ({ value: u.employee_name, label: u.employee_name, subtitle: u.employee_code }))}
                      placeholder="Search employee..."
                    />
                  ) : null}
                  <input
                    type="text"
                    value={formData.deliveryContactPerson}
                    onChange={(e) => setFormData({ ...formData, deliveryContactPerson: e.target.value })}
                    className={`w-full border border-gray-300 rounded-lg px-4 py-2 ${users.length > 0 ? 'mt-1' : ''}`}
                    placeholder="Or type name manually"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Consignee POC Phone</label>
                  <input
                    type="text"
                    value={formData.deliveryContactPhone}
                    onChange={(e) => setFormData({ ...formData, deliveryContactPhone: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="Phone number of contact person"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Quotation Ref No.</label>
                  <input
                    type="text"
                    value={formData.quotationRef}
                    onChange={(e) => setFormData({ ...formData, quotationRef: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="Quotation reference (optional)"
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900">Project Name</label>
                    {isProjectNameLockedFromPR && (
                      <span className="rounded-full border border-[#D8C8AA] bg-[#FFFCF5] px-2 py-0.5 text-[11px] font-semibold text-[#8B6F47]">
                        From PR
                      </span>
                    )}
                  </div>
                  {isProjectNameLockedFromPR ? (
                    <input
                      type="text"
                      value={formData.projectName}
                      readOnly
                      aria-readonly
                      className="w-full cursor-not-allowed rounded-lg border border-[#E8DCC4] bg-[#F5EFE3] px-4 py-2 text-[#4A3426]"
                      placeholder="Project name from selected PR"
                    />
                  ) : (
                    <SearchableSelect
                      value={formData.projectId}
                      onChange={(value, option) => setFormData({
                        ...formData,
                        projectId: value,
                        projectName: option?.label || '',
                      })}
                      options={projectOptions}
                      placeholder="Select project"
                      className="w-full"
                      minSearchChars={0}
                      showSubtitleInInput={false}
                    />
                  )}
                  {isProjectNameLockedFromPR ? (
                    <p className="mt-1 text-xs text-[#7A6555]">
                      Read-only because this PO is linked to the selected purchase requisition.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-[#7A6555]">
                      Standalone POs must use the project master dropdown; free-text project entry is disabled.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Freight Terms</label>
                  <input
                    type="text"
                    value={formData.freightTerms}
                    onChange={(e) => setFormData({ ...formData, freightTerms: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="e.g. FOB, CIF, Ex-Works"
                  />
                </div>
              </div>
              </section>

              {/* Tracking Information */}
              {editingMode !== 'create' && (
                <section id="po-form-tracking" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Tracking Information</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Tracking Number</label>
                      <input
                        type="text"
                        value={formData.trackingNumber}
                        onChange={(e) => setFormData({ ...formData, trackingNumber: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                        placeholder="Enter tracking number..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Delivery Status</label>
                      <SearchableSelect
                        value={formData.deliveryStatus}
                        onChange={(value) => setFormData({ ...formData, deliveryStatus: value })}
                        options={[
                          { value: 'PENDING', label: 'Pending' },
                          { value: 'SHIPPED', label: 'Shipped' },
                          { value: 'IN_TRANSIT', label: 'In Transit' },
                          { value: 'DELIVERED', label: 'Delivered' },
                          { value: 'DELAYED', label: 'Delayed' },
                        ]}
                        placeholder="Search delivery status..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Carrier Name</label>
                      <input
                        type="text"
                        value={formData.carrierName}
                        onChange={(e) => setFormData({ ...formData, carrierName: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                        placeholder="e.g., Blue Dart, DTDC..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Shipped Date</label>
                      <DateInput
                        max={todayDate}
                        value={formData.shippedDate}
                        onChange={(value) => setFormData({ ...formData, shippedDate: value })}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Estimated Delivery Date</label>
                      <DateInput
                        min={todayDate}
                        value={formData.estimatedDeliveryDate}
                        onChange={(value) => setFormData({ ...formData, estimatedDeliveryDate: value })}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Tracking URL</label>
                      <input
                        type="url"
                        value={formData.trackingUrl}
                        onChange={(e) => setFormData({ ...formData, trackingUrl: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* Payment status removed - managed through Accounts module */}

              {/* Items */}
              {editingMode !== 'tracking' && (
                <section id="po-form-items" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Items</h3>
                    {(editingMode === 'create' || editingMode === 'edit') && (
                      <ErpButton
                        onClick={handleAddItem}
                        variant="secondary"
                      >
                        <Plus className="h-4 w-4" /> Add Item
                      </ErpButton>
                    )}
                  </div>

                  {formData.items.length === 0 ? (
                    <div className="text-sm text-gray-500">No items added yet.</div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white p-3 overflow-visible">
                      <div className="hidden lg:grid grid-cols-[minmax(12rem,2fr)_4.75rem_6rem_minmax(8rem,1fr)_5rem_4.75rem_6rem_2.5rem] gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600 shadow-sm">
                          <div>Item</div>
                          <div>Qty</div>
                          <div>UOM</div>
                          <div>Unit Price</div>
                          <div className="text-right">Discount %</div>
                          <div>GST %</div>
                          <div className="text-right">Total</div>
                          <div></div>
                        </div>
                        <div className="mt-3 space-y-4">
                      {formData.items.map((item, index) => (
                        <div key={index} className="relative border border-gray-200 rounded-lg p-4 bg-white">
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(12rem,2fr)_4.75rem_6rem_minmax(8rem,1fr)_5rem_4.75rem_6rem_2.5rem] lg:gap-3">
                            <div className="min-w-0 md:col-span-2 lg:col-span-1">
                              {item.itemId ? (
                                <div className="flex flex-col gap-2 min-w-0">
                                  <div className="min-w-0">
                                    {(() => {
                                      const masterItem = items.find((i) => i.id === item.itemId || i.code === item.itemCode);
                                      const resolvedItemId = masterItem?.id || item.itemId;
                                      const drawingRequired = masterItem?.drawing_required || 'OPTIONAL';
                                      const displayCode = item.itemCode || masterItem?.code || '';
                                      const displayName = item.itemName || masterItem?.name || '';
                                      const includeDrawing = drawingRequired === 'COMPULSORY' || item.includeDrawing === true;
                                      const drawingOptions = resolvedItemId ? (drawingOptionsByItemId[resolvedItemId] || []) : [];
                                      const selectedDrawingId = item.selectedDrawingId || (includeDrawing && resolvedItemId ? getLatestDrawingId(resolvedItemId) : '');

                                      return (
                                        <>
                                          <div className="text-sm font-medium text-gray-900">{displayCode || '-'}</div>
                                          <div className="text-xs text-gray-500 truncate">{displayName || '-'}</div>
                                          {resolvedItemId ? (
                                            <div className="mt-1 space-y-2 min-w-0">
                                              <div className="flex items-center justify-between gap-2 min-w-0">
                                                <span className={`text-xs px-2 py-0.5 rounded ${
                                                  drawingRequired === 'COMPULSORY'
                                                    ? 'bg-red-100 text-red-800'
                                                    : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                  Drawing: {drawingRequired}
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setPendingItemIndex(index);
                                                    setSelectedItemForDrawing({
                                                      id: resolvedItemId,
                                                      code: displayCode,
                                                      name: displayName,
                                                      mandatory: drawingRequired === 'COMPULSORY',
                                                    });
                                                    setShowDrawingManager(true);
                                                  }}
                                                  className="text-xs text-amber-700 hover:text-amber-900 font-medium shrink-0"
                                                >
                                                  Manage Drawings
                                                </button>
                                              </div>
                                              <label className="flex items-center gap-2 text-xs text-gray-700">
                                                <input
                                                  type="checkbox"
                                                  checked={includeDrawing}
                                                  disabled={drawingRequired === 'COMPULSORY'}
                                                  onChange={(event) => handleUpdateItem(index, 'includeDrawing', event.target.checked)}
                                                  className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                                                />
                                                <span>{drawingRequired === 'COMPULSORY' ? 'Drawing will be attached' : 'Attach drawing to PO/PDF'}</span>
                                              </label>
                                              {includeDrawing && (
                                                <SearchableSelect
                                                  value={selectedDrawingId}
                                                  onChange={(value) => handleUpdateItem(index, 'selectedDrawingId', value)}
                                                  options={[
                                                    { value: '', label: drawingOptionsLoading[resolvedItemId] ? 'Loading drawings...' : 'Latest active drawing' },
                                                    ...drawingOptions.map((drawing) => ({
                                                      value: drawing.id,
                                                      label: `v${drawing.version || '-'} ${drawing.is_active ? '(Active)' : '(Old)'}`,
                                                      subtitle: drawing.file_name || 'Drawing',
                                                    })),
                                                  ]}
                                                  placeholder="Search drawing version..."
                                                />
                                              )}
                                            </div>
                                          ) : null}
                                        </>
                                      );
                                    })()}
                                    {item.itemId && stockInfo[item.itemId] && (
                                      <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                                        <div className="flex justify-between">
                                          <span>Stock in Hand:</span>
                                          <span className="font-semibold text-blue-600">{stockInfo[item.itemId].total_quantity || 0}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Available:</span>
                                          <span className="font-semibold text-green-600">{stockInfo[item.itemId].available_quantity || 0}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Allocated:</span>
                                          <span className="font-semibold text-amber-600">{stockInfo[item.itemId].allocated_quantity || 0}</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <SearchableSelect
                                    value={item.itemId || ''}
                                    onChange={(value) => handleUpdateItem(index, 'itemId', value)}
                                    options={items.map(i => ({
                                      value: i.id,
                                      label: i.code,
                                      subtitle: [i.name, i.oem_part_no, i.description].filter(Boolean).join(' | ')
                                    }))}
                                    placeholder={itemsLoading ? 'Loading items...' : 'Change item...'}
                                    disabled={itemsLoading}
                                    className="text-xs"
                                  />
                                </div>
                              ) : (
                                <div className="relative z-20 flex min-w-0 items-center gap-1">
                                <SearchableSelect
                                  value={item.itemId || ''}
                                  onChange={(value) => handleUpdateItem(index, 'itemId', value)}
                                  options={items.map(i => ({
                                    value: i.id,
                                    label: i.code,
                                    subtitle: [i.name, i.oem_part_no, i.description].filter(Boolean).join(' | ')
                                  }))}
                                  placeholder={itemsLoading ? 'Loading items...' : 'Select Item'}
                                  disabled={itemsLoading}
                                  required
                                  className="flex-1"
                                />
                                {String(currentPrDepartment || '').trim().toUpperCase() === 'R&D' ? (
                                  <button
                                    type="button"
                                    title="Add temporary R&D item"
                                    onClick={() => {
                                      setQuickCreateItemIndex(index);
                                      setShowRndTemporaryItem(true);
                                    }}
                                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold text-sm"
                                  >+</button>
                                ) : null}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) => handleUpdateItem(index, 'quantity', parseFloat(e.target.value))}
                                  placeholder="Quantity"
                                  className="w-full border border-gray-300 rounded px-3 py-2"
                                  required
                                />
                              </div>
                            </div>
                            <div className="min-w-0">
                              <input
                                type="text"
                                value={(() => {
                                  const masterItem = items.find((i) => i.id === item.itemId || i.code === item.itemCode);
                                  return masterItem ? resolveUomFromItem(masterItem) : (item.uom || '');
                                })()}
                                readOnly
                                placeholder="UOM"
                                className="w-full border border-gray-300 rounded px-3 py-2 bg-gray-50 cursor-not-allowed"
                                title="UOM is auto-filled from master item"
                              />
                            </div>
                            <div className="relative min-w-0">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={item.unitPrice}
                                  onChange={(e) => handleUpdateItem(index, 'unitPrice', parseFloat(e.target.value))}
                                  placeholder="Unit Price"
                                  className="w-full border border-gray-300 rounded px-3 py-2"
                                />
                                {(() => {
                                  const effectiveVendorId = String(item.vendorId || formData.vendorId || '').trim();
                                  const effectiveItemId =
                                    String(item.itemId || '').trim() ||
                                    String(items.find((i) => i.code === item.itemCode)?.id || '').trim();
                                  if (!effectiveItemId || !effectiveVendorId) return null;

                                  return (
                                    <div
                                      className="relative"
                                      onMouseEnter={() => {
                                        setHoveredItem(index);
                                        fetchPriceHistory(effectiveItemId, effectiveVendorId);
                                      }}
                                      onMouseLeave={() => setHoveredItem(null)}
                                    >
                                      <button
                                        type="button"
                                        className="p-1 text-blue-500 hover:text-blue-700 cursor-help"
                                      >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                        </svg>
                                      </button>

                                      {hoveredItem === index && (
                                        <div className="absolute z-50 right-0 mr-2 top-0 w-80 bg-white border border-gray-300 rounded-lg shadow-xl p-4">
                                          <div className="text-sm font-semibold text-gray-700 mb-2">Last 3 Purchase Prices</div>
                                          {(() => {
                                            const key = `${effectiveItemId}-${effectiveVendorId}`;
                                            const history = priceHistory[key];

                                            if (!history || history.length === 0) {
                                              return <div className="text-xs text-gray-400 italic">No previous prices available</div>;
                                            }

                                            return (
                                              <div className="space-y-2">
                                                {history.map((record, idx) => (
                                                  <div key={idx} className="border-b border-gray-200 pb-2 last:border-0">
                                                    <div className="flex justify-between items-start">
                                                      <div>
                                                        <div className="text-xs font-medium text-gray-900">
                                                          PO: {record.po_number}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                          {new Date(record.po_date).toLocaleDateString()}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                          Qty: {record.quantity}
                                                        </div>
                                                      </div>
                                                      <div className="text-right">
                                                        <div className="text-sm font-semibold text-blue-600">
                                                          ₹{fmtINR(record.unit_price)}
                                                        </div>
                                                        <div className="text-xs text-gray-500 capitalize">
                                                          {record.po_status.replace('_', ' ')}
                                                        </div>
                                                      </div>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>

                              {(() => {
                                const effectiveVendorId = String(item.vendorId || formData.vendorId || '').trim();
                                const effectiveItemId =
                                  String(item.itemId || '').trim() ||
                                  String(items.find((i) => i.code === item.itemCode)?.id || '').trim();
                                if (!effectiveItemId || !effectiveVendorId) return null;

                                const key = `${effectiveItemId}-${effectiveVendorId}`;
                                const history = priceHistory[key];
                                if (!history || history.length === 0) {
                                  return <div className="mt-1 max-w-full break-words text-[11px] leading-tight text-gray-400 italic">No previous prices available</div>;
                                }
                                const last = history?.[0];
                                if (!last) {
                                  return <div className="mt-1 max-w-full break-words text-[11px] leading-tight text-gray-400 italic">No previous prices available</div>;
                                }
                                return (
                                  <div className="mt-1 max-w-full break-words text-[11px] leading-tight text-gray-600">
                                    Last: <span className="font-medium text-gray-800">₹{fmtINR(last.unit_price)}</span>
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="min-w-0">
                              <input
                                type="number"
                                value={item.discount || 0}
                                onChange={(e) => handleUpdateItem(index, 'discount', parseFloat(e.target.value) || 0)}
                                placeholder="Discount %"
                                className="w-full border border-gray-300 rounded px-3 py-2"
                                min="0"
                                max="100"
                              />
                            </div>
                            <div className="min-w-0">
                              <input
                                type="number"
                                value={item.taxRate}
                                disabled={formData.isImportPurchase || String(formData.supplierCurrency || 'INR').toUpperCase() !== 'INR'}
                                onChange={(e) => { const v = parseFloat(e.target.value); handleUpdateItem(index, 'taxRate', Number.isNaN(v) ? 0 : v); }}
                                placeholder={(formData.isImportPurchase || String(formData.supplierCurrency || 'INR').toUpperCase() !== 'INR') ? 'Import GST via BOE' : 'Tax %'}
                                className={`w-full rounded border px-3 py-2 ${(formData.isImportPurchase || String(formData.supplierCurrency || 'INR').toUpperCase() !== 'INR') ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-300'}`}
                              />
                            </div>
                            <div className="flex min-w-0 items-center justify-start lg:justify-end pt-2 lg:pt-0">
                              <span className="font-medium whitespace-nowrap">₹{fmtINR(item.totalPrice)}</span>
                            </div>
                            <div className="flex items-center justify-end md:justify-start lg:justify-center">
                              <button
                                onClick={() => handleRemoveItem(index)}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-red-100 text-lg font-bold text-red-600 hover:bg-red-200 hover:text-red-800"
                                title="Remove this item"
                              >
                                ×
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Line Payment Terms</label>
                              <input
                                type="text"
                                value={(item as any).paymentTerms || ''}
                                onChange={(e) => handleUpdateItem(index, 'paymentTerms', e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Line Delivery Terms</label>
                              <input
                                type="text"
                                value={(item as any).deliveryTerms || ''}
                                onChange={(e) => handleUpdateItem(index, 'deliveryTerms', e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                        </div>
                    </div>
                  )}
                  {(editingMode === 'create' || editingMode === 'edit') && formData.items.length > 0 && (
                    <div className="mt-4 flex justify-center">
                      <ErpButton
                        onClick={handleAddItem}
                        variant="secondary"
                      >
                        <Plus className="h-4 w-4" /> Add Another Item
                      </ErpButton>
                    </div>
                  )}
                </section>
              )}

              <div className="border-b border-[#E8DCC4] bg-white p-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="Additional notes..."
                />
              </div>

              {/* Documents / Quotation Attachments */}
              {(editingMode === 'create' || editingMode === 'edit') && (
                <section id="po-form-documents" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-900 mb-2">Documents / Quotation <span className="text-red-500">*</span></label>
                  {isSupplierWisePRSplit ? (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500">
                        This PR will create supplier-wise POs. Upload the quotation for each supplier; each generated PO receives only its own supplier document.
                      </p>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {prSupplierGroups.map((group) => {
                          const attachments = supplierAttachments[group.vendorId] || [];
                          return (
                            <div key={group.vendorId} className="rounded-xl border border-[#E8DCC4] bg-[#FFFCF5] p-3">
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-[#4A3426]">{group.vendorName}</div>
                                  <div className="text-xs text-[#7A6555]">
                                    {group.itemCount} line{group.itemCount === 1 ? '' : 's'} · Qty {group.quantity}
                                  </div>
                                </div>
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${attachments.length > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                  {attachments.length > 0 ? `${attachments.length} attached` : 'Required'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 border border-dashed border-[#BFA77A] rounded-lg text-xs font-semibold text-[#6B4F2A] hover:bg-white">
                                  {poAttachmentUploading ? 'Uploading...' : '+ Attach supplier quotation'}
                                  <input
                                    type="file"
                                    multiple
                                    className="hidden"
                                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                                    disabled={poAttachmentUploading}
                                    onChange={(e) => {
                                      handleUploadPOAttachment(e.target.files, group.vendorId);
                                      e.currentTarget.value = '';
                                    }}
                                  />
                                </label>
                                {attachments.map((att, i) => (
                                  <div key={`${group.vendorId}-${att.url}-${i}`} className="flex max-w-xs items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-800">
                                    <a href={att.url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline" title={att.name}>{att.name}</a>
                                    <button
                                      type="button"
                                      onClick={() => removeSupplierAttachment(group.vendorId, i)}
                                      className="flex-shrink-0 font-bold text-blue-400 hover:text-red-600"
                                      title="Remove"
                                    >&times;</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500 mb-2">Attach vendor quotations, drawings, or any supporting documents for this PO.</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-dashed border-gray-400 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                          {poAttachmentUploading ? 'Uploading...' : '+ Attach Document'}
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                            disabled={poAttachmentUploading}
                            onChange={(e) => {
                              handleUploadPOAttachment(e.target.files);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                        {formData.attachments.map((att, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 max-w-xs">
                            <a href={att.url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline" title={att.name}>{att.name}</a>
                            <button
                              type="button"
                              onClick={() => setFormData((prev) => ({ ...prev, attachments: prev.attachments.filter((_, idx) => idx !== i) }))}
                              className="text-blue-400 hover:text-red-600 flex-shrink-0 font-bold"
                              title="Remove"
                            >&times;</button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}

              {/* Additional Charges */}
              {editingMode !== 'tracking' && (
                <section id="po-form-commercial" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                <div className="mb-4">
                  <h3 className="text-base font-semibold text-[#4A3426]">Commercial Summary</h3>
                  <p className="text-xs text-[#7A6555]">Freight, tax on freight, duties, and additional expenses.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Freight Value (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.freightAmount}
                    onChange={(e) => setFormData({ ...formData, freightAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">GST on Freight</label>
                  <label className="flex h-[42px] items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={formData.freightGstApplicable}
                      onChange={(e) => setFormData({
                        ...formData,
                        freightGstApplicable: e.target.checked,
                        freightGstPercent: e.target.checked ? (formData.freightGstPercent || 18) : 0,
                      })}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Applicable
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Freight GST (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.freightGstPercent}
                    onChange={(e) => setFormData({ ...formData, freightGstPercent: parseFloat(e.target.value) || 0 })}
                    disabled={!formData.freightGstApplicable}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Customs Duty (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.customsDuty}
                    onChange={(e) => setFormData({ ...formData, customsDuty: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Additional Expenses (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.otherCharges}
                    onChange={(e) => setFormData({ ...formData, otherCharges: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="0.00"
                  />
                </div>
                </div>
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <label className="flex items-start gap-3 text-sm font-semibold text-[#4A3426]">
                    <input
                      type="checkbox"
                      checked={formData.isImportPurchase}
                      onChange={(e) => {
                        const isImport = e.target.checked;
                        setFormData({
                          ...formData,
                          isImportPurchase: isImport,
                          supplierCurrency: isImport ? (formData.supplierCurrency === 'INR' ? 'USD' : formData.supplierCurrency || 'USD') : 'INR',
                          customsExchangeRate: isImport ? formData.customsExchangeRate : 0,
                          freightGstApplicable: isImport ? false : formData.freightGstApplicable,
                          freightGstPercent: isImport ? 0 : formData.freightGstPercent,
                          items: isImport ? formData.items.map((item) => recalcPoItem(item, 0)) : formData.items,
                        });
                      }}
                      className="mt-1 h-4 w-4 rounded border-amber-300 text-[#8B6F47] focus:ring-[#8B6F47]"
                    />
                    <span>
                      Import / foreign purchase
                      <span className="mt-1 block text-xs font-normal text-[#7A6555]">
                        Use this when supplier billing is in foreign currency or inward costs/duty need to be linked through Import Files.
                      </span>
                    </span>
                  </label>
                  {formData.isImportPurchase && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Supplier Currency</label>
                        <select
                          value={formData.supplierCurrency}
                          onChange={(e) => {
                            const nextCurrency = e.target.value;
                            const isForeign = nextCurrency !== 'INR';
                            setFormData({
                              ...formData,
                              supplierCurrency: nextCurrency,
                              isImportPurchase: isForeign || formData.isImportPurchase,
                              freightGstApplicable: isForeign ? false : formData.freightGstApplicable,
                              freightGstPercent: isForeign ? 0 : formData.freightGstPercent,
                              items: isForeign ? formData.items.map((item) => recalcPoItem(item, 0)) : formData.items,
                            });
                          }}
                          className="w-full rounded-lg border border-amber-200 bg-white px-4 py-2"
                        >
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                          <option value="GBP">GBP</option>
                          <option value="AED">AED</option>
                          <option value="CNY">CNY</option>
                          <option value="JPY">JPY</option>
                          <option value="INR">INR</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Customs Exchange Rate</label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={formData.customsExchangeRate}
                          onChange={(e) => setFormData({ ...formData, customsExchangeRate: parseFloat(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-amber-200 bg-white px-4 py-2"
                          placeholder="e.g. 83.2500"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Import Notes / BOE Ref</label>
                        <input
                          type="text"
                          value={formData.importNotes}
                          onChange={(e) => setFormData({ ...formData, importNotes: e.target.value })}
                          className="w-full rounded-lg border border-amber-200 bg-white px-4 py-2"
                          placeholder="BOE, CHA, duty or inward-cost note"
                        />
                      </div>
                      <div className="md:col-span-3 rounded-lg border border-amber-100 bg-white px-4 py-3 text-xs text-[#7A6555]">
                        SAP-standard control: supplier price remains the PO commercial price; customs duty, freight, insurance, CHA and other non-recoverable inward costs are accumulated in the Import File and allocated to landed cost when GRN is linked.
                      </div>
                    </div>
                  )}
                </div>
                </section>
              )}

              {/* Total */}
              <div className="ml-auto w-full max-w-xl bg-white p-4">
                <div className="space-y-2 text-right">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Items Subtotal:</span>
                    <span>₹{fmtINR(formData.items.reduce((sum, item) => sum + item.totalPrice, 0))}</span>
                  </div>
                  {(formData.freightAmount > 0 || calcFreightGstAmount(formData.freightAmount, formData.freightGstApplicable, formData.freightGstPercent) > 0 || formData.customsDuty > 0 || formData.otherCharges > 0) && (
                    <>
                      {formData.freightAmount > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Freight Value:</span>
                          <span>₹{fmtINR(formData.freightAmount)}</span>
                        </div>
                      )}
                      {calcFreightGstAmount(formData.freightAmount, formData.freightGstApplicable, formData.freightGstPercent) > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Freight GST ({fmtPercent(formData.freightGstPercent)}%):</span>
                          <span>₹{fmtINR(calcFreightGstAmount(formData.freightAmount, formData.freightGstApplicable, formData.freightGstPercent))}</span>
                        </div>
                      )}
                      {formData.customsDuty > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Customs Duty:</span>
                          <span>₹{fmtINR(formData.customsDuty)}</span>
                        </div>
                      )}
                      {formData.otherCharges > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Additional Expenses:</span>
                          <span>₹{fmtINR(formData.otherCharges)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {Math.abs(calcRoundingAdjustment(
                    formData.items.reduce((sum, item) => sum + item.totalPrice, 0) +
                    (formData.freightAmount || 0) +
                    calcFreightGstAmount(formData.freightAmount, formData.freightGstApplicable, formData.freightGstPercent) +
                    (formData.customsDuty || 0) +
                    (formData.otherCharges || 0)
                  )) >= 0.01 && (
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Rounding:</span>
                      <span>₹{fmtINR(calcRoundingAdjustment(
                        formData.items.reduce((sum, item) => sum + item.totalPrice, 0) +
                        (formData.freightAmount || 0) +
                        calcFreightGstAmount(formData.freightAmount, formData.freightGstApplicable, formData.freightGstPercent) +
                        (formData.customsDuty || 0) +
                        (formData.otherCharges || 0)
                      ))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-bold text-gray-900 border-t pt-2">
                    <span>Grand Total:</span>
                    <span>₹{fmtRoundedINR(
                      formData.items.reduce((sum, item) => sum + item.totalPrice, 0) +
                      (formData.freightAmount || 0) +
                      calcFreightGstAmount(formData.freightAmount, formData.freightGstApplicable, formData.freightGstPercent) +
                      (formData.customsDuty || 0) +
                      (formData.otherCharges || 0)
                    )}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </FullScreenPortal>
        )}
      </div>

      <RndTemporaryItemModal
        open={showRndTemporaryItem}
        vendors={vendors.map((vendor) => ({ id: vendor.id, name: vendor.name }))}
        onClose={() => {
          setShowRndTemporaryItem(false);
          setQuickCreateItemIndex(null);
        }}
        onCreated={handleRndTemporaryItemCreated}
      />

      {/* Drawing Manager Modal - Mandatory for PO items */}
      {showDrawingManager && selectedItemForDrawing && (
        <DrawingManager
          itemId={selectedItemForDrawing.id}
          itemCode={selectedItemForDrawing.code}
          itemName={selectedItemForDrawing.name}
          onChanged={(drawings) => {
            const itemId = selectedItemForDrawing.id;
            const normalizedDrawings = Array.isArray(drawings) ? drawings : [];
            setDrawingOptionsByItemId((prev) => ({
              ...prev,
              [itemId]: normalizedDrawings,
            }));
            const activeDrawingId = normalizedDrawings.find((drawing) => drawing.is_active)?.id || normalizedDrawings[0]?.id || '';
            if (activeDrawingId && pendingItemIndex !== null) {
              setFormData((current) => ({
                ...current,
                items: current.items.map((item, index) => (
                  index === pendingItemIndex
                    ? { ...item, includeDrawing: true, selectedDrawingId: activeDrawingId }
                    : item
                )),
              }));
            }
          }}
          onClose={() => {
            setShowDrawingManager(false);
            setSelectedItemForDrawing(null);
            setPendingItemIndex(null);

            // Context-aware message
            if (showModal && editingMode === 'create') {
              setAlertMessage({ type: 'info', message: 'Drawing uploaded! Please try creating the PO again.' });
            } else {
              setAlertMessage({ type: 'success', message: 'Drawing updated successfully.' });
            }
          }}
          mandatory={selectedItemForDrawing.mandatory}
        />
      )}

      {/* View Details Modal */}
      {showViewModal && selectedPO && (
        <FullScreenPortal>
        <div className="fixed inset-0 z-[1000] h-[100dvh] w-screen overflow-hidden bg-[#FAF9F6]">
          <div className="flex h-full w-full flex-col bg-white">
            <div className="flex shrink-0 items-center justify-between border-b border-[#E8DCC4] bg-white px-5 py-3">
              <div>
                <h2 className="text-xl font-bold text-[#4A3426]">Purchase Order</h2>
                <p className="text-sm font-medium text-[#7A6555]">{selectedPO.po_number?.startsWith('DRAFT-') ? 'Draft purchase order' : selectedPO.po_number}</p>
              </div>
              <button onClick={() => setShowViewModal(false)} className="text-gray-500 hover:text-gray-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {selectedPO.status === 'PENDING' && canApprovePO && (() => {
              const evidence = [
                ...(Array.isArray((selectedPO as any).rfq_trail?.response_attachments)
                  ? (selectedPO as any).rfq_trail.response_attachments
                  : []),
                ...(Array.isArray((selectedPO as any).attachments)
                  ? (selectedPO as any).attachments
                  : []),
              ].filter((attachment: any, index: number, all: any[]) =>
                attachment?.url && all.findIndex((candidate: any) => candidate?.url === attachment.url) === index,
              );
              const firstEvidence = evidence[0];
              return (
                <section className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-amber-900">Approval evidence opened automatically</p>
                      <p className="text-xs text-amber-800">Compare the supplier quotation or supporting document before approving.</p>
                    </div>
                    {firstEvidence && (
                      <a href={firstEvidence.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-700 underline">
                        Open in new tab
                      </a>
                    )}
                  </div>
                  {firstEvidence ? (
                    <iframe
                      src={firstEvidence.url}
                      title={firstEvidence.name || 'PO approval attachment'}
                      className="h-[36vh] min-h-[260px] w-full rounded border border-amber-200 bg-white"
                    />
                  ) : (
                    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                      No supplier quotation or supporting attachment is available for comparison.
                    </div>
                  )}
                </section>
              );
            })()}

            <ObjectPageTabs
              activeId={poViewSection}
              onChange={setPoViewSection}
              sections={[
                { id: 'overview', label: 'Overview' },
                { id: 'items', label: `Items (${selectedPO.purchase_order_items?.length || 0})` },
                { id: 'fulfilment', label: 'Fulfilment' },
                { id: 'flow', label: 'Document Flow' },
                { id: 'documents', label: `Documents (${Array.isArray((selectedPO as any).attachments) ? (selectedPO as any).attachments.length : 0})` },
              ]}
            />

            <div className="flex-1 space-y-5 overflow-y-auto scroll-smooth bg-[#FAF9F6] p-4 md:p-5">
              {/* Header Info */}
              {poViewSection === 'overview' && (
              <>
              <section id="po-view-overview" className="scroll-mt-4 grid grid-cols-1 gap-4 border-b border-[#E8DCC4] bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">PO Number</p>
                  <p className="font-semibold text-lg">
                  {selectedPO.po_number?.startsWith('DRAFT-')
                    ? <span className="italic text-gray-400">Not assigned (Draft)</span>
                    : selectedPO.po_number}
                </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">PR Reference</p>
                  <p className="font-semibold">{selectedPO.pr?.pr_number || '-'}</p>
                  {selectedPO.is_partial_po && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">
                      Partial PO
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Status</p>
                  <span className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(selectedPO.status)}`}>
                    {selectedPO.status}
                  </span>
                </div>
                {selectedPO.edit_count != null && selectedPO.edit_count > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Edits</p>
                    <p className="font-semibold">{selectedPO.edit_count} time{selectedPO.edit_count !== 1 ? 's' : ''}</p>
                  </div>
                )}
                {selectedPO.last_edited_at && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Last Edited</p>
                    <p className="font-semibold">{new Date(selectedPO.last_edited_at).toLocaleDateString()} {new Date(selectedPO.last_edited_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                  </div>
                )}
                {(selectedPO as any).created_by_name && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Created By</p>
                    <p className="font-semibold">{(selectedPO as any).created_by_name}</p>
                  </div>
                )}
                {(selectedPO as any).approved_by_name && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Approved By</p>
                    <p className="font-semibold">{(selectedPO as any).approved_by_name}</p>
                  </div>
                )}
              </section>
              <section className="grid grid-cols-1 gap-4 border-b border-[#E8DCC4] bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Vendor</p>
                  <p className="font-semibold">{(selectedPO as any)?.vendor?.name || (selectedPO as any)?.vendor_name || '-'}</p>
                  {((selectedPO as any)?.vendor?.contact_person || (selectedPO as any)?.vendor_contact_person) && (
                    <p className="text-sm text-gray-500">{(selectedPO as any)?.vendor?.contact_person || (selectedPO as any)?.vendor_contact_person}</p>
                  )}
                  {((selectedPO as any)?.vendor?.billing_line2 || (selectedPO as any)?.vendor?.metadata?.billingLine2) && (
                    <p className="text-sm text-gray-500">{(selectedPO as any)?.vendor?.billing_line2 || (selectedPO as any)?.vendor?.metadata?.billingLine2}</p>
                  )}
                  {((selectedPO as any)?.vendor?.street || (selectedPO as any)?.vendor?.address) && (
                    <p className="text-sm text-gray-500">{(selectedPO as any)?.vendor?.street || (selectedPO as any)?.vendor?.address}</p>
                  )}
                  {((selectedPO as any)?.vendor?.city || (selectedPO as any)?.vendor?.state || (selectedPO as any)?.vendor?.pincode) && (
                    <p className="text-sm text-gray-500">{[(selectedPO as any)?.vendor?.city, (selectedPO as any)?.vendor?.state, (selectedPO as any)?.vendor?.pincode].filter(Boolean).join(', ')}</p>
                  )}
                  {(selectedPO as any)?.vendor?.tax_id && (
                    <p className="text-sm text-gray-500">GSTIN: {(selectedPO as any)?.vendor?.tax_id}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Order Date</p>
                  <p className="font-semibold">{selectedPO.po_date ? new Date(selectedPO.po_date).toLocaleDateString() : '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Expected Delivery</p>
                  <p className="font-semibold">{selectedPO.delivery_date ? new Date(selectedPO.delivery_date).toLocaleDateString() : '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Payment Terms</p>
                  <p className="font-semibold break-words">{resolvePoPaymentTermsLabel(selectedPO)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Total Amount</p>
                  <p className="font-semibold text-lg">₹{fmtRoundedINR(selectedPO.total_amount)}</p>
                </div>
              </section>

              {/* Cost Breakdown */}
              {(selectedPO as any).purchase_order_items?.length > 0 && (
                <section className="border-b border-[#E8DCC4] bg-white p-4">
                  <h4 className="mb-3 text-sm font-semibold text-[#4A3426]">Cost Breakdown</h4>
                  {(() => {
                    const items = (selectedPO as any).purchase_order_items || [];
                    const itemsSubtotal = items.reduce((sum: number, item: any) => sum + (item.total_amount || item.amount || 0), 0);
                    const tc = (selectedPO as any).terms_and_conditions;
                    let freightData: any = {};
                    try {
                      if (tc && typeof tc === 'string' && tc.startsWith('{')) {
                        freightData = JSON.parse(tc);
                      } else if (tc && typeof tc === 'object') {
                        freightData = tc;
                      }
                    } catch {}
                    const freightAmount = freightData.freightAmount || (selectedPO as any).freight_amount || 0;
                    const freightGstApplicable = freightData.freightGstApplicable === true || (selectedPO as any).freight_gst_applicable === true;
                    const freightGstPercent = freightData.freightGstPercent || (selectedPO as any).freight_gst_percent || 0;
                    const freightGstAmount = freightGstApplicable ? Math.round(freightAmount * freightGstPercent) / 100 : 0;
                    const customsDuty = (selectedPO as any).customs_duty || freightData.additionalExpenses || 0;
                    const otherCharges = (selectedPO as any).other_charges || 0;
                    const grandTotal = itemsSubtotal + freightAmount + freightGstAmount + customsDuty + otherCharges;
                    const roundingAdjustment = calcRoundingAdjustment(grandTotal);
                    return (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Items Subtotal:</span>
                          <span className="font-medium">₹{fmtINR(itemsSubtotal)}</span>
                        </div>
                        {freightAmount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Freight/Transportation:</span>
                            <span className="font-medium">₹{fmtINR(freightAmount)}</span>
                          </div>
                        )}
                        {freightGstAmount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Freight GST ({freightGstPercent}%):</span>
                            <span className="font-medium">₹{fmtINR(freightGstAmount)}</span>
                          </div>
                        )}
                        {customsDuty > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Customs Duty:</span>
                            <span className="font-medium">₹{fmtINR(customsDuty)}</span>
                          </div>
                        )}
                        {otherCharges > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Additional Expenses:</span>
                            <span className="font-medium">₹{fmtINR(otherCharges)}</span>
                          </div>
                        )}
                        {Math.abs(roundingAdjustment) >= 0.01 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Rounding:</span>
                            <span className="font-medium">₹{fmtINR(roundingAdjustment)}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-blue-200 pt-2 mt-2">
                          <span className="font-semibold text-blue-900">Grand Total:</span>
                          <span className="font-bold text-blue-900">₹{fmtRoundedINR(grandTotal)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </section>
              )}
              {(() => {
                const tc = (selectedPO as any).terms_and_conditions;
                let commercial: any = {};
                try {
                  if (tc && typeof tc === 'string' && tc.startsWith('{')) commercial = JSON.parse(tc);
                  else if (tc && typeof tc === 'object') commercial = tc;
                } catch {}
                if (commercial.isImportPurchase !== true) return null;
                return (
                  <section className="border-b border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Import Purchase Control</p>
                        <h4 className="mt-1 text-base font-semibold text-[#4A3426]">
                          {commercial.supplierCurrency || 'Foreign currency'} PO / Customs rate {commercial.customsExchangeRate || '-'}
                        </h4>
                        <p className="mt-1 text-sm text-[#7A6555]">
                          Create an Import File to store BOE/documents, inward costs, GRN links, landed-cost allocation and payment trail for this PO.
                        </p>
                        {commercial.importNotes && <p className="mt-1 text-xs text-[#7A6555]">Reference: {commercial.importNotes}</p>}
                      </div>
                      <ErpButton
                        variant="primary"
                        onClick={() => {
                          setShowViewModal(false);
                          router.push(`/dashboard/purchase/import-files?create=1&poId=${encodeURIComponent(selectedPO.id)}`);
                        }}
                      >
                        <FileText className="h-4 w-4" />
                        Create Import File
                      </ErpButton>
                    </div>
                  </section>
                );
              })()}
              {(selectedPO as any).delivery_address && (
                <div className="border-b border-[#E8DCC4] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Delivery Address</p>
                  <p className="font-semibold whitespace-pre-line">{(selectedPO as any).delivery_address}</p>
                </div>
              )}
              {selectedPO.remarks && (
                <div className="border-b border-[#E8DCC4] bg-white p-4">
                  <p className="mb-2 text-sm text-gray-600">Remarks</p>
                  <p className="whitespace-pre-line text-gray-800">{selectedPO.remarks}</p>
                </div>
              )}
              </>
              )}

              {/* Items Table */}
              {poViewSection === 'items' && (
              <section id="po-view-items" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                <h3 className="text-lg font-semibold mb-3">Items</h3>
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-700">S.No</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Item</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Drawing</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Quantity</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-700">UOM</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Rate</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Discount %</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">GST %</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Payment Terms</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Delivery Terms</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-700">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {selectedPO.purchase_order_items && selectedPO.purchase_order_items.length > 0 ? (
                        selectedPO.purchase_order_items.map((item: any, idx: number) => (
                          <tr key={idx}>
                            <td className="px-4 py-2 text-center text-sm">{item.serial_no || idx + 1}</td>
                            <td className="px-4 py-2">
                              <div className="font-medium">{item.item?.name || item.item_name || '-'}</div>
                              <div className="text-xs text-gray-500">{item.item?.code || item.item_code || ''}</div>
                            </td>
                            <td className="px-4 py-2">
                              {(() => {
                                const itemCode = item.item?.code || item.item_code;
                                const itemId = item.item_id || item.itemId || item.item?.id;
                                const masterItem = items.find((i) => i.id === itemId || i.code === itemCode);
                                const drawingRequired = masterItem?.drawing_required || 'OPTIONAL';
                                const resolvedItemId = masterItem?.id || itemId;

                                if (!resolvedItemId) {
                                  return <span className="text-xs text-gray-500">-</span>;
                                }

                                return (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs px-2 py-0.5 rounded ${
                                      drawingRequired === 'COMPULSORY'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-gray-100 text-gray-700'
                                    }`}>
                                      {drawingRequired}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedItemForDrawing({
                                          id: resolvedItemId,
                                          code: masterItem?.code || itemCode || '',
                                          name: masterItem?.name || item.item?.name || item.item_name || '',
                                          mandatory: drawingRequired === 'COMPULSORY',
                                        });
                                        setShowDrawingManager(true);
                                      }}
                                      className="text-xs text-amber-700 hover:text-amber-900 font-medium"
                                    >
                                      Manage Drawings
                                    </button>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-2 text-right">{item.quantity || item.ordered_qty || 0}</td>
                            <td className="px-4 py-2 text-center text-sm">{resolveUomFromPOLine(item) || '-'}</td>
                            <td className="px-4 py-2 text-right">
                              <div>₹{fmtINR(item.rate)}</div>
                              {(() => {
                                const vendorId = resolveVendorIdFromPO(selectedPO);
                                const itemId = resolveItemIdFromPOLine(item);

                                // Always show some message under Rate
                                if (!vendorId || !itemId) {
                                  return <div className="mt-0.5 ml-auto max-w-[160px] break-words text-[11px] leading-tight text-gray-500">Last purchase price not available</div>;
                                }

                                const key = `${itemId}-${vendorId}`;
                                const history = priceHistory[key];
                                if (!history || history.length === 0) return <div className="mt-0.5 ml-auto max-w-[160px] break-words text-[11px] leading-tight text-gray-400 italic">No previous prices available</div>;
                                const last = history?.[0];
                                if (!last) return <div className="mt-0.5 ml-auto max-w-[160px] break-words text-[11px] leading-tight text-gray-400 italic">No previous prices available</div>;
                                return (
                                  <div className="mt-0.5 ml-auto max-w-[160px] break-words text-[11px] leading-tight text-gray-600">
                                    Last: <span className="font-medium text-gray-800">₹{fmtINR(last.unit_price)}</span>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-2 text-right text-sm">{fmtPercent(item.discount_percent ?? item.discountPercent ?? item.discount ?? 0)}%</td>
                            <td className="px-4 py-2 text-right text-sm">{fmtPercent(item.tax_percent ?? item.taxPercent ?? item.taxRate ?? 0)}%</td>
                            <td className="px-4 py-2 text-sm text-gray-700">{item.payment_terms || (item as any).paymentTerms || '-'}</td>
                            <td className="px-4 py-2 text-sm text-gray-700">{item.delivery_terms || (item as any).deliveryTerms || '-'}</td>
                            <td className="px-4 py-2 text-right font-medium">₹{fmtINR(item.amount)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={11} className="px-4 py-8 text-center text-gray-500">No items found</td>
                        </tr>
                      )}
                    </tbody>
                    {selectedPO.purchase_order_items && selectedPO.purchase_order_items.length > 0 && (
                      <tfoot className="border-t-2 border-gray-200 bg-amber-50/60">
                        <tr>
                          <td colSpan={10} className="px-4 py-3 text-right text-sm font-semibold uppercase tracking-wide text-gray-700">
                            Total Amount
                          </td>
                          <td className="px-4 py-3 text-right text-base font-bold text-gray-900">
                            ₹{fmtINR(selectedPO.purchase_order_items.reduce(
                              (total: number, item: any) => total + (Number(item.amount) || 0),
                              0,
                            ))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </section>
              )}

              {/* Tracking Information */}
              {poViewSection === 'fulfilment' && (selectedPO as any).status && (selectedPO as any).status !== 'DRAFT' && (
                <section id="po-view-fulfilment" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                  <h3 className="text-lg font-semibold mb-3">Tracking Information</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-sm text-gray-600">Tracking Number</p>
                      <p className="font-semibold">{(selectedPO as any).tracking_number || '-'}</p>
                      {!(selectedPO as any).tracking_number && (
                        <p className="text-xs text-gray-500 mt-1">No tracking added yet</p>
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Delivery Status</p>
                      <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${
                        (selectedPO as any).delivery_status === 'DELIVERED' ? 'bg-green-100 text-green-800' :
                        (selectedPO as any).delivery_status === 'SHIPPED' ? 'bg-blue-100 text-blue-800' :
                        (selectedPO as any).delivery_status === 'DELAYED' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {(selectedPO as any).delivery_status || 'PENDING'}
                      </span>
                    </div>
                    {(selectedPO as any).carrier_name && (
                      <div>
                        <p className="text-sm text-gray-600">Carrier</p>
                        <p className="font-semibold">{(selectedPO as any).carrier_name}</p>
                      </div>
                    )}
                    {(selectedPO as any).shipped_date && (
                      <div>
                        <p className="text-sm text-gray-600">Shipped Date</p>
                        <p className="font-semibold">{new Date((selectedPO as any).shipped_date).toLocaleDateString()}</p>
                      </div>
                    )}
                    {(selectedPO as any).estimated_delivery_date && (
                      <div>
                        <p className="text-sm text-gray-600">Estimated Delivery</p>
                        <p className="font-semibold">{new Date((selectedPO as any).estimated_delivery_date).toLocaleDateString()}</p>
                      </div>
                    )}
                    {(selectedPO as any).tracking_url && (
                      <div className="col-span-2">
                        <p className="text-sm text-gray-600 mb-1">Track Shipment</p>
                        <a 
                          href={(selectedPO as any).tracking_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline text-sm"
                        >
                          {(selectedPO as any).tracking_url}
                        </a>
                      </div>
                    )}
                  </div>
                </section>
              )}
              {poViewSection === 'fulfilment' && (selectedPO as any).status === 'DRAFT' && (
                <div className="border-b border-[#E8DCC4] bg-white p-8 text-center text-sm text-[#7A6555]">
                  Fulfilment tracking becomes available after the purchase order is submitted.
                </div>
              )}

              {/* Procurement Trail (PR-route POs) */}
              {poViewSection === 'flow' && (selectedPO as any).pr && (
                <section id="po-view-flow" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                  <h3 className="text-lg font-semibold mb-3">Procurement Trail</h3>
                  <div className="space-y-3 border-l-2 border-[#C8AC7A] pl-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Purchase Requisition</span>
                      <span className="font-semibold text-blue-900">{(selectedPO as any).pr.pr_number}</span>
                    </div>
                    {(selectedPO as any).rfq_trail && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">RFQ Reference</span>
                          <span className="font-semibold text-blue-900">{(selectedPO as any).rfq_trail.rfq_number}</span>
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                            (selectedPO as any).rfq_trail.status === 'RESPONDED' ? 'bg-green-100 text-green-800' :
                            (selectedPO as any).rfq_trail.status === 'SENT' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-700'
                          }`}>{(selectedPO as any).rfq_trail.status}</span>
                        </div>
                        {(selectedPO as any).rfq_trail.response_attachments?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-1">Vendor Quotation(s)</p>
                            <div className="flex flex-wrap gap-2">
                              {(selectedPO as any).rfq_trail.response_attachments.map((att: any, i: number) => (
                                <a
                                  key={i}
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-blue-300 rounded text-sm text-blue-800 hover:bg-blue-100 max-w-xs truncate"
                                  title={att.name}
                                >
                                  📄 {att.name || 'Quotation'}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}
              {poViewSection === 'flow' && !(selectedPO as any).pr && (
                <div className="border-b border-[#E8DCC4] bg-white p-8 text-center text-sm text-[#7A6555]">
                  No linked purchase requisition or RFQ was recorded for this purchase order.
                </div>
              )}

              {/* PO Documents / Attachments */}
              {poViewSection === 'documents' && Array.isArray((selectedPO as any).attachments) && (selectedPO as any).attachments.length > 0 && (
                <section id="po-view-documents" className="scroll-mt-4 border-b border-[#E8DCC4] bg-white p-4">
                  <h3 className="text-lg font-semibold mb-3">Documents / Attachments</h3>
                  <div className="flex flex-wrap gap-2">
                    {(selectedPO as any).attachments.map((att: any, i: number) => (
                      <a
                        key={i}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-800 hover:bg-gray-100 max-w-xs truncate"
                        title={att.name}
                      >
                        📎 {att.name || 'Document'}
                      </a>
                    ))}
                  </div>
                </section>
              )}
              {poViewSection === 'documents' && (!Array.isArray((selectedPO as any).attachments) || (selectedPO as any).attachments.length === 0) && (
                <div className="border-b border-[#E8DCC4] bg-white p-8 text-center text-sm text-[#7A6555]">
                  No quotations or supporting documents are attached to this purchase order.
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap justify-between gap-3 border-t border-[#E8DCC4] bg-white px-5 py-3">
              <div className="flex flex-wrap gap-2">
                {selectedPO.status === 'DRAFT' && (
                  <>
                    {canEditPO && (
                    <ErpButton
                      onClick={() => {
                        setShowViewModal(false);
                        handleEditDetails(selectedPO.id, 'edit');
                      }}
                      variant="secondary"
                    >
                      <Pencil className="h-4 w-4" /> Edit
                    </ErpButton>
                    )}
                    <ErpButton
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem('accessToken');
                          const response = await fetch(`/api/v1/purchase/orders/${selectedPO.id}/status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ status: 'PENDING' }),
                          });
                          if (response.ok) {
                            setAlertMessage({ type: 'success', message: 'Purchase Order sent for approval!' });
                            setShowViewModal(false);
                            fetchOrders();
                          } else {
                            const err = await response.json();
                            setAlertMessage({ type: 'error', message: `Failed: ${err.message || 'Unknown error'}` });
                          }
                        } catch {
                          setAlertMessage({ type: 'error', message: 'Error sending for approval' });
                        }
                      }}
                      variant="primary"
                    >
                      <Send className="h-4 w-4" /> Send for Approval
                    </ErpButton>
                  </>
                )}

                {selectedPO.status === 'PENDING' && String((selectedPO as any).created_by || '') === currentUserId && !canBypassMakerChecker && (
                  <>
                    {canEditPendingPO(selectedPO) && (
                      <ErpButton
                        onClick={() => {
                          setShowViewModal(false);
                          handleEditDetails(selectedPO.id, 'edit');
                        }}
                        variant="secondary"
                      >
                        <Pencil className="h-4 w-4" /> Edit & Resubmit
                      </ErpButton>
                    )}
                    <span className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                      Awaiting manager approval
                    </span>
                  </>
                )}

                {selectedPO.status === 'PENDING' && canBypassMakerChecker && String((selectedPO as any).created_by || '') !== currentUserId && (
                  <ErpButton
                    onClick={() => {
                      setShowViewModal(false);
                      handleEditDetails(selectedPO.id, 'edit');
                    }}
                    variant="secondary"
                  >
                      <Pencil className="h-4 w-4" /> Admin Override
                  </ErpButton>
                )}

                {selectedPO.status === 'PENDING' && canApprovePO && (canBypassMakerChecker || String((selectedPO as any).created_by || '') !== currentUserId) && (
                  <>
                    <ErpButton
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem('accessToken');
                          const response = await fetch(`/api/v1/purchase/orders/${selectedPO.id}/approve`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${token}`,
                            },
                          });
                          if (response.ok) {
                            setAlertMessage({ type: 'success', message: 'Purchase Order approved successfully!' });
                            setShowViewModal(false);
                            fetchOrders();
                          } else {
                            const errorData = await response.json();
                            setAlertMessage({ type: 'error', message: `Failed to approve PO: ${errorData.message || 'Unknown error'}` });
                          }
                        } catch (error) {
                          setAlertMessage({ type: 'error', message: 'Error approving PO' });
                        }
                      }}
                      variant="approve"
                    >
                      <Check className="h-4 w-4" /> Approve
                    </ErpButton>
                    <ErpButton
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem('accessToken');
                          const response = await fetch(`/api/v1/purchase/orders/${selectedPO.id}/reject`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${token}`,
                            },
                          });
                          if (response.ok) {
                            setAlertMessage({ type: 'success', message: 'Purchase Order rejected successfully!' });
                            setShowViewModal(false);
                            fetchOrders();
                          } else {
                            const errorData = await response.json();
                            setAlertMessage({ type: 'error', message: `Failed to reject PO: ${errorData.message || 'Unknown error'}` });
                          }
                        } catch (error) {
                          setAlertMessage({ type: 'error', message: 'Error rejecting PO' });
                        }
                      }}
                      variant="danger"
                    >
                      <X className="h-4 w-4" /> Reject
                    </ErpButton>
                  </>
                )}

                {(selectedPO.status === 'APPROVED' || selectedPO.status === 'SENT' || selectedPO.status === 'ACKNOWLEDGED' || selectedPO.status === 'PARTIAL' || selectedPO.status === 'COMPLETED') && (
                  <>
                    {selectedPO.status === 'APPROVED' && canEditPO && (
                      <ErpButton
                        onClick={() => handleControlledEdit(selectedPO)}
                        variant="secondary"
                      >
                        <Pencil className="h-4 w-4" /> Change PO
                      </ErpButton>
                    )}
                    {canCreatePO && (
                      <ErpButton
                        onClick={() => handleClonePO(selectedPO.id)}
                        variant="secondary"
                      >
                        <Copy className="h-4 w-4" /> Clone PO
                      </ErpButton>
                    )}
                    {canDownloadPO && (
                      <>
                        <ErpButton
                          onClick={() => handleDownloadPDF(selectedPO.id, selectedPO.po_number)}
                          variant="secondary"
                        >
                          <Download className="h-4 w-4" /> Download PDF
                        </ErpButton>
                        <ErpButton
                          onClick={() => handleViewPDF(selectedPO.id, selectedPO.po_number)}
                          variant="secondary"
                        >
                          <FileText className="h-4 w-4" /> View PDF
                        </ErpButton>
                        <ErpButton
                          onClick={() => handlePrintPDF(selectedPO.id, selectedPO.po_number)}
                          variant="secondary"
                        >
                          <Printer className="h-4 w-4" /> Print PDF
                        </ErpButton>
                      </>
                    )}
                    <ErpButton
                      onClick={() => handlePreviewPOEmail(selectedPO.id)}
                      disabled={poEmailPreviewLoading}
                      variant="primary"
                    >
                      <Mail className="h-4 w-4" />
                      {poEmailPreviewLoading ? 'Generating...' : 'Preview Email'}
                    </ErpButton>
                    <ErpButton
                      onClick={() => handleSendMaterialReminder(selectedPO.id)}
                      disabled={poEmailSending || ['COMPLETED', 'CANCELLED', 'CLOSED'].includes(String(selectedPO.status || '').toUpperCase())}
                      variant="secondary"
                    >
                      <Mail className="h-4 w-4" /> Material Reminder
                    </ErpButton>
                    <ErpButton
                      onClick={() => {
                        setShowViewModal(false);
                        handleEditDetails(selectedPO.id, 'tracking');
                      }}
                      variant="secondary"
                    >
                      <Truck className="h-4 w-4" /> Update Tracking
                    </ErpButton>
                  </>
                )}
              </div>
              <ErpButton
                onClick={() => setShowViewModal(false)}
                variant="ghost"
              >
                <X className="h-4 w-4" /> Close
              </ErpButton>
            </div>
          </div>
        </div>
        </FullScreenPortal>
      )}

      {/* PO Email Preview Modal */}
      {showPOEmailPreview && poEmailPreview && (
        <FullScreenPortal>
        <div className="fixed inset-0 z-[1200] h-[100dvh] w-screen overflow-hidden bg-white">
          <div className="flex h-full w-full flex-col overflow-y-auto bg-white">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-amber-900">PO Email Preview</h2>
              <button
                type="button"
                onClick={() => {
                  setShowPOEmailPreview(false);
                  setPoEmailPreview(null);
                  setPoEmailTo('');
                  setPoEmailSubject('');
                  setPoEmailMessage('');
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {(() => {
              const preview = poEmailPreview?.preview || poEmailPreview;
              const poId = String(poEmailPreview?.po_id || selectedPO?.id || '');
              const html = String(preview?.html || '');

              return (
                <div className="p-6 space-y-4">
                  <div className="bg-gray-50 p-4 rounded-lg text-sm space-y-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="font-semibold">To</span>
                        <input
                          className="mt-1 w-full border rounded px-3 py-2"
                          value={poEmailTo}
                          onChange={(e) => setPoEmailTo(e.target.value)}
                          placeholder="vendor@email.com"
                        />
                      </label>

                      <label className="block">
                        <span className="font-semibold">Subject</span>
                        <input
                          className="mt-1 w-full border rounded px-3 py-2"
                          value={poEmailSubject}
                          onChange={(e) => setPoEmailSubject(e.target.value)}
                          placeholder="Subject"
                        />
                      </label>
                    </div>

                    <label className="block mt-2">
                      <span className="font-semibold">Message (optional)</span>
                      <textarea
                        className="mt-1 w-full border rounded px-3 py-2"
                        rows={3}
                        value={poEmailMessage}
                        onChange={(e) => setPoEmailMessage(e.target.value)}
                        placeholder="Add a short note to the vendor..."
                      />
                    </label>

                    <div className="flex justify-end mt-2">
                      <button
                        type="button"
                        onClick={handleUpdatePOEmailPreview}
                        disabled={poEmailPreviewLoading}
                        className={`px-4 py-2 rounded-lg transition-colors text-sm ${
                          poEmailPreviewLoading
                            ? 'bg-gray-300 text-gray-600'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {poEmailPreviewLoading ? 'Updating...' : 'Update Preview'}
                      </button>
                    </div>

                    <div>
                      <span className="font-semibold">From:</span> {String(preview?.from || '')}
                    </div>
                    {preview?.replyTo && (
                      <div>
                        <span className="font-semibold">Reply-To:</span> {String(preview.replyTo)}
                      </div>
                    )}
                    {Array.isArray(preview?.attachments) && preview.attachments.length > 0 && (
                      <div>
                        <span className="font-semibold">Attachments:</span> {preview.attachments.join(', ')}
                      </div>
                    )}
                  </div>

                  <div className="border rounded-lg overflow-hidden bg-white">
                    <iframe
                      title="PO Email Preview"
                      className="w-full h-[60vh]"
                      srcDoc={html}
                      sandbox=""
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  <div className="sticky bottom-0 bg-white border-t -mx-6 px-6 py-4 flex justify-end gap-3">
                    <button
                      onClick={() => {
                        setShowPOEmailPreview(false);
                        setPoEmailPreview(null);
                        setPoEmailTo('');
                        setPoEmailSubject('');
                        setPoEmailMessage('');
                      }}
                      className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSendPOEmail(poId)}
                      disabled={poEmailSending || !poId || !poEmailTo.trim()}
                      className={`px-6 py-2 rounded-lg transition-colors ${
                        poEmailSending || !poId || !poEmailTo.trim()
                          ? 'bg-gray-300 text-gray-600'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {poEmailSending ? 'Sending...' : 'Confirm & Send PO Email'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        </FullScreenPortal>
      )}

      {/* Alert Popup */}
      {alertMessage && (
        <FullScreenPortal>
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-[#4A3426]/45">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start">
              <div className={`flex-shrink-0 ${
                alertMessage.type === 'success' ? 'text-green-500' :
                alertMessage.type === 'error' ? 'text-red-500' :
                'text-blue-500'
              }`}>
                {alertMessage.type === 'success' && (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {alertMessage.type === 'error' && (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {alertMessage.type === 'info' && (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div className="ml-3 flex-1">
                <h3 className={`text-sm font-medium ${
                  alertMessage.type === 'success' ? 'text-green-800' :
                  alertMessage.type === 'error' ? 'text-red-800' :
                  'text-blue-800'
                }`}>
                  {alertMessage.type === 'success' ? 'Success' :
                   alertMessage.type === 'error' ? 'Error' :
                   'Information'}
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
                  alertMessage.type === 'success' ? 'bg-green-600 hover:bg-green-700' :
                  alertMessage.type === 'error' ? 'bg-red-600 hover:bg-red-700' :
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
        </FullScreenPortal>
      )}

      {/* PO Trail Modal */}
      {showTrailModal && trailPO && (
        <FullScreenPortal>
        <div className="fixed inset-0 z-[1100] flex h-[100dvh] w-screen items-center justify-center bg-white p-0">
          <div className="bg-white shadow-2xl w-screen h-screen max-w-none max-h-none flex flex-col">
            <div className="p-5 border-b flex justify-between items-center bg-gradient-to-r from-[#FAF9F6] to-[#F5EFE3]">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <span className="text-2xl">📋</span> PO Trail: {trailPO.po_number}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Complete lifecycle from PR to Payments
                </p>
              </div>
              <button 
                onClick={() => setShowTrailModal(false)} 
                className="text-gray-400 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="overflow-auto flex-1 p-5">
              {trailLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8B6F47]"></div>
                  <span className="ml-3 text-gray-600">Loading trail data...</span>
                </div>
              ) : trailData ? (
                <div className="space-y-6">
                  {/* PR Section */}
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h3 className="text-sm font-bold text-blue-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span>📄</span> Source: Purchase Requisition
                    </h3>
                    {trailData.pr ? (
                      <div className="bg-blue-50 rounded-lg p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-500">PR Number:</span>
                            <button
                              onClick={() => {
                                setShowTrailModal(false);
                                router.push(`/dashboard/purchase/requisitions?viewId=${trailData.pr.id}`);
                              }}
                              className="font-semibold text-blue-900 hover:text-blue-600 hover:underline cursor-pointer bg-transparent border-0 p-0 text-left"
                            >
                              {trailData.pr.pr_number} ↗
                            </button>
                          </div>
                          <div>
                            <span className="text-gray-500">PR ID:</span>
                            <p className="font-medium">{trailData.pr.id}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-4 text-gray-500 italic">
                        No PR linked (Direct PO)
                      </div>
                    )}
                  </div>

                  {/* PO Details */}
                  <div className="border-l-4 border-[#A78B62] pl-4">
                    <h3 className="text-sm font-bold text-[#6F4E37] uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span>📑</span> Purchase Order
                    </h3>
                    <div className="bg-[#FAF9F6] rounded-lg p-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">PO Number:</span>
                          <button
                            onClick={() => {
                              setShowTrailModal(false);
                              handleViewDetails(trailPO.id);
                            }}
                            className="font-semibold text-[#4A3426] hover:text-[#8B6F47] hover:underline cursor-pointer bg-transparent border-0 p-0 text-left block"
                          >
                            {trailPO.po_number} ↗
                          </button>
                        </div>
                        <div>
                          <span className="text-gray-500">Vendor:</span>
                          <button
                            onClick={() => {
                              setShowTrailModal(false);
                              router.push(`/dashboard/purchase/vendors?editId=${trailPO.vendor?.id}`);
                            }}
                            className="font-medium hover:text-amber-600 hover:underline cursor-pointer bg-transparent border-0 p-0 text-left block"
                          >
                            {trailPO.vendor?.name} ↗
                          </button>
                        </div>
                        <div>
                          <span className="text-gray-500">Date:</span>
                          <p className="font-medium">{new Date(trailPO.po_date).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Amount:</span>
                          <p className="font-semibold text-[#4A3426]">₹{fmtRoundedINR(Number((trailPO as any).grand_total ?? trailPO.total_amount ?? 0))}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Status:</span>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            trailPO.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                            trailPO.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                            trailPO.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' :
                            'bg-blue-100 text-blue-800'
                          }`}>
                            {trailPO.status}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Items:</span>
                          <p className="font-medium">{trailPO.purchase_order_items?.length || 0}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Approved By:</span>
                          <p className="font-medium">{(trailPO as any).approved_by_name || 'Not approved'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Approved On:</span>
                          <p className="font-medium">{(trailPO as any).approved_at ? new Date((trailPO as any).approved_at).toLocaleString() : '-'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Sent to Supplier:</span>
                          <p className="font-medium">{(trailPO as any).sent_at ? new Date((trailPO as any).sent_at).toLocaleString() : 'Not sent'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Financial reconciliation */}
                  <div className="border-l-4 border-[#8B6F47] pl-4">
                    <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#5E4635]">Financial Reconciliation</h3>
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-[#E8DCC4] bg-[#E8DCC4] md:grid-cols-4 xl:grid-cols-5">
                      {[
                        ['PO Value', trailData.financialSummary?.poValue],
                        ['Invoiced', trailData.financialSummary?.invoiced],
                        ['Supplier Payments', trailData.financialSummary?.paid],
                        ['Payment Reversals', trailData.financialSummary?.paymentReversals],
                        ['Advance Paid', trailData.financialSummary?.advancePaid],
                        ['Advance Applied', trailData.financialSummary?.advanceApplied],
                        ['Advance Available', trailData.financialSummary?.advanceAvailable],
                        ['Debit Notes', trailData.financialSummary?.debitNotes],
                        ['TDS / Short Pay', Number(trailData.financialSummary?.tds || 0) + Number(trailData.financialSummary?.shortPayment || 0)],
                        ['Outstanding', trailData.financialSummary?.outstanding],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="bg-white p-3">
                          <div className="text-xs font-medium text-[#7A6555]">{label}</div>
                          <div className="mt-1 text-base font-bold tabular-nums text-[#4A3426]">₹{fmtRoundedINR(Number(value || 0))}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* GRNs Section */}
                  <div className="border-l-4 border-green-500 pl-4">
                    <h3 className="text-sm font-bold text-green-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span>📦</span> Goods Receipt Notes (GRN)
                      {trailData.grns?.length > 0 && (
                        <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs">
                          {trailData.grns.length}
                        </span>
                      )}
                    </h3>
                    {trailData.grns?.length > 0 ? (
                      <div className="space-y-3">
                        {trailData.grns.map((grn: any, idx: number) => (
                          <div key={grn.id} className="bg-green-50 rounded-lg p-4 border border-green-100">
                            <div className="flex justify-between items-start mb-2">
                              <a
                                href={`/dashboard/purchase/grn?viewId=${grn.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-green-900 hover:text-green-600 hover:underline cursor-pointer bg-transparent border-0 p-0 text-left"
                              >
                                GRN #{grn.grn_number} ↗
                              </a>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                grn.status === 'COMPLETED' ? 'bg-green-200 text-green-800' :
                                grn.status === 'QC_PENDING' ? 'bg-yellow-200 text-yellow-800' :
                                'bg-gray-200 text-gray-800'
                              }`}>
                                {grn.status}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                              <div>
                                <span className="text-gray-500">Date:</span>
                                <p className="font-medium">{fmtDate(grn.grn_date || grn.receipt_date || grn.created_at)}</p>
                              </div>
                              <div>
                                <span className="text-gray-500">Invoice:</span>
                                <p className="font-medium">{grn.invoice_number || 'N/A'}</p>
                              </div>
                              <div>
                                <span className="text-gray-500">Net Payable:</span>
                                <p className="font-semibold">₹{fmtINR(grn.net_payable_amount || grn.gross_amount)}</p>
                              </div>
                              <div>
                                <span className="text-gray-500">QC Status:</span>
                                <p className="font-medium">{grn.qc_completed ? '✅ Completed' : '⏳ Pending'}</p>
                              </div>
                            </div>
                            {/* Payment Entries for this GRN */}
                            {false && grn.payment_entries?.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-green-200">
                                <div className="flex justify-between items-center mb-2">
                                  <h5 className="text-xs font-bold text-green-700">💳 Payments:</h5>
                                  <button
                                    onClick={() => {
                                      setShowTrailModal(false);
                                      router.push(`/dashboard/accounts/payables`);
                                    }}
                                    className="text-xs text-green-600 hover:text-green-800 underline cursor-pointer bg-transparent border-0"
                                  >
                                    View All Payments ↗
                                  </button>
                                </div>
                                <div className="space-y-2">
                                  {grn.payment_entries.map((payment: any) => (
                                    <div key={payment.id} className="flex justify-between items-center text-sm bg-white rounded px-3 py-2">
                                      <div className="flex gap-3">
                                        <span className="text-gray-600">{new Date(payment.payment_date).toLocaleDateString()}</span>
                                        <span className="font-medium">₹{fmtINR(payment.amount)}</span>
                                        <span className="text-gray-500">{payment.payment_method}</span>
                                        {payment.payment_reference && (
                                          <span className="text-gray-400">Ref: {payment.payment_reference}</span>
                                        )}
                                      </div>
                                      <span className={`px-2 py-0.5 rounded text-xs ${
                                        payment.entry_type === 'ADVANCE' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                      }`}>
                                        {payment.entry_type || 'PAYMENT'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-4 text-gray-500 italic">
                        No GRNs received yet
                      </div>
                    )}
                  </div>

                  {/* Supplier invoices and settlements */}
                  <div className="border-l-4 border-emerald-600 pl-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-800">
                        Supplier Invoices & Settlements
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{trailData.grns?.length || 0}</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setShowTrailModal(false);
                          router.push('/dashboard/accounts/payables');
                        }}
                        className="text-xs font-medium text-[#8B6F47] hover:text-[#5E4635] hover:underline"
                      >
                        Open Accounts Payable
                      </button>
                    </div>
                    {trailData.grns?.length > 0 ? (
                      <div className="space-y-3">
                        {trailData.grns.map((grn: any) => {
                          const settlement = grn.settlement || {};
                          return (
                            <div key={`invoice-${grn.id}`} className="border border-[#E8DCC4] bg-white">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8DCC4] bg-[#FAF9F6] px-4 py-3">
                                <div>
                                  <div className="text-xs font-medium text-[#7A6555]">Supplier Invoice</div>
                                  <div className="font-semibold text-[#4A3426]">{grn.invoice_number || 'Invoice number not recorded'}</div>
                                  <div className="text-xs text-[#7A6555]">Against {grn.grn_number}</div>
                                </div>
                                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                  grn.payment_status === 'PAID'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : grn.payment_status === 'PARTIAL'
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : 'border-[#E8DCC4] bg-white text-[#6F4E37]'
                                }`}>
                                  {grn.payment_status || 'UNPAID'}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-4 px-4 py-3 text-sm md:grid-cols-4 xl:grid-cols-8">
                                <div><span className="text-xs text-gray-500">Invoice Date</span><p className="font-medium">{fmtDate(grn.invoice_date)}</p></div>
                                <div><span className="text-xs text-gray-500">Gross</span><p className="font-medium">₹{fmtINR(Number(grn.gross_amount || 0))}</p></div>
                                <div><span className="text-xs text-gray-500">Tax</span><p className="font-medium">₹{fmtINR(Number(grn.tax_amount || 0))}</p></div>
                                <div><span className="text-xs text-gray-500">Debit Notes</span><p className="font-medium">₹{fmtINR(Number(grn.debit_note_amount || 0))}</p></div>
                                <div><span className="text-xs text-gray-500">Net Payable</span><p className="font-semibold">₹{fmtINR(Number(settlement.net_payable || 0))}</p></div>
                                <div><span className="text-xs text-gray-500">Advance Applied</span><p className="font-semibold text-[#8B6F47]">₹{fmtINR(Number(settlement.advance_applied || 0))}</p></div>
                                <div><span className="text-xs text-gray-500">Total Settled</span><p className="font-semibold text-emerald-700">₹{fmtINR(Number(settlement.total_settled || 0))}</p></div>
                                <div><span className="text-xs text-gray-500">Outstanding</span><p className="font-bold text-amber-700">₹{fmtINR(Number(settlement.outstanding || 0))}</p></div>
                              </div>

                              <div className="border-t border-[#E8DCC4] px-4 py-3">
                                <div className="mb-2 text-xs font-semibold uppercase text-[#7A6555]">Supplier Payments / Remittance</div>
                                {grn.payment_entries?.length > 0 ? (
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                      <thead className="bg-[#FAF9F6] text-left text-xs text-[#7A6555]">
                                        <tr>
                                          <th className="px-3 py-2">Date</th>
                                          <th className="px-3 py-2">Type</th>
                                          <th className="px-3 py-2">Method</th>
                                          <th className="px-3 py-2">Reference</th>
                                          <th className="px-3 py-2 text-right">Payment</th>
                                          <th className="px-3 py-2 text-right">TDS</th>
                                          <th className="px-3 py-2 text-right">Short Pay</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#E8DCC4]">
                                        {grn.payment_entries.map((payment: any) => (
                                          <tr key={payment.id}>
                                            <td className="px-3 py-2 whitespace-nowrap">{fmtDate(payment.payment_date)}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">{payment.entry_type === 'RECORDED_PAYMENT' ? 'Recorded Payment' : payment.entry_type || 'Payment'}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">{payment.payment_method || '-'}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">{payment.payment_reference || '-'}</td>
                                            <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">₹{fmtINR(Number(payment.amount || 0))}</td>
                                            <td className="px-3 py-2 text-right whitespace-nowrap">₹{fmtINR(Number(payment.tds_amount || 0))}</td>
                                            <td className="px-3 py-2 text-right whitespace-nowrap">₹{fmtINR(Number(payment.short_payment_amount || 0))}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="text-sm text-[#7A6555]">No supplier payment has been recorded for this invoice.</div>
                                )}
                              </div>

                              {grn.payment_reversals?.length > 0 && (
                                <div className="border-t border-red-100 px-4 py-3">
                                  <div className="mb-2 flex items-center justify-between gap-3">
                                    <div className="text-xs font-semibold uppercase text-red-700">Payment Reversals / Corrections</div>
                                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                                      {grn.payment_reversals.length} reversal{grn.payment_reversals.length === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                      <thead className="bg-red-50 text-left text-xs text-red-700">
                                        <tr>
                                          <th className="px-3 py-2">Reversed On</th>
                                          <th className="px-3 py-2">Original Date</th>
                                          <th className="px-3 py-2">Method</th>
                                          <th className="px-3 py-2">Reference</th>
                                          <th className="px-3 py-2 text-right">Reversed Amount</th>
                                          <th className="px-3 py-2">Reason</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-red-100">
                                        {grn.payment_reversals.map((reversal: any) => (
                                          <tr key={reversal.id}>
                                            <td className="px-3 py-2 whitespace-nowrap">{fmtDate(reversal.reversed_at)}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">{fmtDate(reversal.original_payment_date)}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">{reversal.original_payment_method || '-'}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">{reversal.original_payment_reference || '-'}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-red-700 whitespace-nowrap">
                                              -Rs. {fmtINR(
                                                Number(reversal.original_amount || 0) +
                                                Number(reversal.original_tds_amount || 0) +
                                                Number(reversal.original_short_payment_amount || 0)
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-[#5E4635]">{reversal.reversal_reason || '-'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {grn.debit_notes?.length > 0 && (
                                <div className="border-t border-[#E8DCC4] px-4 py-3">
                                  <div className="mb-2 text-xs font-semibold uppercase text-[#7A6555]">Debit Notes / Adjustments</div>
                                  <div className="flex flex-wrap gap-2">
                                    {grn.debit_notes.map((note: any) => (
                                      <span key={note.id} className="border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
                                        {note.debit_note_number}: ₹{fmtINR(Number(note.total_amount || 0))} ({note.status})
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="border border-[#E8DCC4] bg-white p-4 text-sm text-[#7A6555]">
                        No supplier invoices are available because no GRN has been posted for this PO.
                      </div>
                    )}
                  </div>

                  {/* Advance Payments Section */}
                  <div className="border-l-4 border-[#A78B62] pl-4">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-sm font-bold text-[#6F4E37] uppercase tracking-wide flex items-center gap-2">
                        <span>💰</span> Advance Payments
                        {trailData.advances?.length > 0 && (
                          <span className="bg-[#F5EFE3] text-[#5E4635] px-2 py-0.5 rounded-full text-xs">
                            {trailData.advances.length}
                          </span>
                        )}
                      </h3>
                      <button
                        onClick={() => {
                          setShowTrailModal(false);
                          router.push(`/dashboard/accounts/payables`);
                        }}
                        className="text-xs text-[#8B6F47] hover:text-[#5E4635] underline cursor-pointer bg-transparent border-0"
                      >
                        Manage Advances ↗
                      </button>
                    </div>
                    {trailData.advances?.length > 0 ? (
                      <div className="bg-[#FAF9F6] rounded-lg p-4">
                        <div className="space-y-2">
                          {trailData.advances.map((adv: any) => (
                            <div key={adv.id} className="flex justify-between items-center text-sm bg-white rounded px-3 py-2">
                              <div className="flex gap-3">
                                <span className="text-gray-600">{fmtDate(adv.payment_date)}</span>
                                <span className="font-semibold text-[#4A3426]">₹{fmtINR(adv.amount)}</span>
                                <span className="text-gray-500">{adv.payment_method}</span>
                                {adv.payment_reference && (
                                  <span className="text-gray-400">Ref: {adv.payment_reference}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-2 border-t border-[#E8DCC4] flex justify-between items-center">
                          <span className="text-sm text-gray-600">Total Advance for this PO:</span>
                          <span className="font-bold text-[#4A3426]">
                            ₹{fmtINR(trailData.advances.reduce((s: number, a: any) => s + (a.amount || 0), 0))}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-4 text-gray-500 italic">
                        No advance payments for this PO
                      </div>
                    )}
                  </div>

                  {/* Vendor Advance Balance */}
                  {trailData.vendorAdvanceBalance && trailData.vendorAdvanceBalance.balance_amount > 0 && (
                    <div className="border-l-4 border-amber-500 pl-4">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-bold text-amber-700 uppercase tracking-wide flex items-center gap-2">
                          <span>🏦</span> Vendor Advance Balance
                        </h3>
                        <button
                          onClick={() => {
                            setShowTrailModal(false);
                            router.push(`/dashboard/accounts/payables`);
                          }}
                          className="text-xs text-amber-600 hover:text-amber-800 underline cursor-pointer bg-transparent border-0"
                        >
                          View in Payables ↗
                        </button>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-4">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-500">Total Advance:</span>
                            <p className="font-semibold text-amber-900">₹{fmtINR(trailData.vendorAdvanceBalance.total_advance)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">Utilized:</span>
                            <p className="font-medium">₹{fmtINR(trailData.vendorAdvanceBalance.utilized_amount)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">Available Balance:</span>
                            <p className="font-bold text-green-700">₹{fmtINR(trailData.vendorAdvanceBalance.balance_amount)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  <div className="bg-gray-100 rounded-lg p-4 mt-6">
                    <h3 className="text-sm font-bold text-gray-700 mb-3">📊 Trail Summary</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4 xl:grid-cols-7">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{trailData.pr ? '1' : '0'}</div>
                        <div className="text-gray-500">PRs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-[#8B6F47]">1</div>
                        <div className="text-gray-500">POs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{trailData.grns?.length || 0}</div>
                        <div className="text-gray-500">GRNs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-emerald-700">{trailData.grns?.filter((g: any) => g.invoice_number).length || 0}</div>
                        <div className="text-gray-500">Supplier Invoices</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-[#8B6F47]">
                          {trailData.advances?.length || 0}
                        </div>
                        <div className="text-gray-500">Advances</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">
                          {trailData.financialSummary?.paymentCount || 0}
                        </div>
                        <div className="text-gray-500">Supplier Payments</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-700">{trailData.debitNotes?.length || 0}</div>
                        <div className="text-gray-500">Debit Notes</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  Failed to load trail data
                </div>
              )}
            </div>

            <div className="p-4 border-t flex justify-end gap-3 bg-gray-50">
              <button 
                onClick={() => setShowTrailModal(false)} 
                className="px-5 py-2 bg-gray-600 text-white rounded-lg text-sm font-semibold hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
        </FullScreenPortal>
      )}

      {/* Duplicate Warning Modal */}
      <DuplicateWarning
        isOpen={duplicateState.isOpen}
        exactMatches={duplicateState.exactMatches}
        fuzzyMatches={duplicateState.fuzzyMatches}
        entityType="Purchase Order"
        onProceed={handleProceed}
        onCancel={handleCancel}
        formatRecord={(data) => (
          <div className="text-sm">
            <p className="font-semibold">PO #{data.po_number}</p>
            <p className="text-xs text-gray-600">Vendor: {data.vendor?.name}</p>
            <p className="text-xs text-gray-600">Items: {data.purchase_order_items?.length || 0}</p>
            <p className="text-xs text-gray-600">Total: ₹{fmtRoundedINR(data.total_amount)}</p>
            <p className="text-xs text-gray-600">Date: {new Date(data.po_date).toLocaleDateString()}</p>
          </div>
        )}
      />
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <PurchaseOrdersContent />
    </Suspense>
  );
}
