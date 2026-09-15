'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../../lib/api-client';
import {
  buildDocumentBranding,
  renderStandardLetterheadHtml,
} from '@/lib/document-branding';
import { getUserRoleNames, hasMakerCheckerOverride, hasModulePermission, isAdminLike } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth.store';
import { formatDateInputDisplay, getTodayDateInputValue, parseDisplayDateToInputValue } from '@/lib/date';
import { loadDeliveryAddresses, saveDeliveryAddress, type DeliveryAddressOption } from '@/lib/delivery-addresses';
import { toast } from 'sonner';
import { Plus, Trash2, Eye, FileText, CheckCircle, Search, Edit, X, RefreshCw, Send, History, Check, Copy, Printer } from 'lucide-react';
import { confirmDialog } from '../../../../components/ui/ConfirmDialog';
import { ListTable, type ListTableColumn } from '../../../../components/ui/ListTable';
import { SlidePanel } from '../../../../components/ui/SlidePanel';
import { ErpButton, ErpMetricStrip, ErpPageHeader, ErpStatusBadge } from '../../../../components/ui/ErpPrimitives';
import SearchableSelect from '../../../../components/SearchableSelect';
import DateInput from '../../../../components/ui/DateInput';
import RndTemporaryItemModal, { type RndTemporaryItem } from '../../../../components/RndTemporaryItemModal';
import { useEscapeKey } from '../../../../hooks/useEscapeKey';

interface PRItem {
  id: string;
  masterItemId?: string;
  itemCode?: string;
  itemName: string;
  uom?: string;
  vendorId?: string;
  vendorName?: string;
  quantity: number;
  estimatedPrice?: number;
  specifications?: string;
  paymentTerms?: string;
  requiredDate?: string;
}

interface Item {
  id: string;
  code: string;
  name: string;
  uom: string;
  standard_cost?: number;
  oem_part_no?: string | null;
  oem_name?: string | null;
}
interface ItemAvailability {
  itemId: string;
  itemCode: string;
  itemName: string;
  uom?: string;
  currentStockQty: number;
  pendingPoQty: number;
  openPrQty: number;
}

type RawItem = Record<string, any>;

type RequisitionFormSection = 'general' | 'items' | 'notes' | 'review';

const REQUISITION_FORM_SECTIONS: Array<{ id: RequisitionFormSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'items', label: 'Items' },
  { id: 'notes', label: 'Notes' },
  { id: 'review', label: 'Review' },
];

const DEPARTMENT_OPTIONS = [
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'R&D', label: 'R&D' },
];

const ADD_PROJECT_OPTION = '__ADD_PROJECT__';
const RFQ_EMAIL_SENDING_ENABLED = true;

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => ({
  value: priority,
  label: priority,
}));

const PRIORITY_RANK: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

interface Requisition {
  id: string;
  pr_number: string;
  department: string;
  project_id?: string | null;
  project_name?: string | null;
  request_date: string;
  required_date: string;
  status: string;
  priority?: string;
  purpose?: string;
  delivery_address?: string;
  requested_by: string;
  created_at: string;
  workflow_status?: string;
  workflow_status_detail?: string | null;
  workflow_status_label?: string;
  rfq_summary?: {
    total?: number;
    sentCount?: number;
    receivedCount?: number;
    nextFollowUpDate?: string | null;
  };
  po_summary?: {
    total?: number;
    draftCount?: number;
    pendingCount?: number;
    approvedCount?: number;
    rejectedCount?: number;
    cancelledCount?: number;
    totalOrderedQty?: number;
    totalReceivedQty?: number;
    grnCount?: number;
    completedGrnCount?: number;
    poNumbers?: string[];
    grnNumbers?: string[];
  };
}

interface PRDetailItem {
  id: string;
  item_id?: string;
  item_code: string;
  item_name: string;
  uom?: string;
  serial_no?: number;
  vendor_id?: string | null;
  requested_qty: number;
  estimated_rate: number;
  total_amount: number;
  total_ordered_qty?: number;
  remaining_qty?: number;
  po_conversion_status?: string;
  remarks?: string;
  payment_terms?: string;
  delivery_terms?: string;
  required_date?: string;
  updated_at?: string;
  updated_by?: string;
}

interface PRDetail {
  id: string;
  pr_number: string;
  department: string;
  project_id?: string | null;
  project_name?: string | null;
  request_date: string;
  required_date: string;
  status: string;
  priority?: string;
  purpose?: string;
  delivery_address?: string;
  requested_by: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_at?: string;
  submitted_at?: string | null;
  updated_by?: string;
  edit_count?: number;
  last_edited_at?: string;
  current_approval_level?: number;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  workflow_status?: string;
  workflow_status_detail?: string | null;
  workflow_status_label?: string;
  rfq_summary?: {
    total?: number;
    sentCount?: number;
    receivedCount?: number;
    nextFollowUpDate?: string | null;
  };
  po_summary?: {
    total?: number;
    draftCount?: number;
    pendingCount?: number;
    approvedCount?: number;
    rejectedCount?: number;
    cancelledCount?: number;
    totalOrderedQty?: number;
    totalReceivedQty?: number;
    grnCount?: number;
    completedGrnCount?: number;
    poNumbers?: string[];
    grnNumbers?: string[];
  };
  purchase_requisition_items: PRDetailItem[];
}

interface Vendor {
  id: string;
  code: string;
  name: string;
  email: string;
  is_active: boolean;
}

interface RfqAttachment {
  url: string;
  name: string;
}

interface RfqRecord {
  id: string;
  rfq_number: string;
  status: string;
  sent_at?: string;
  response_deadline?: string;
  vendor_quote_received_at?: string;
  follow_up_date?: string | null;
  follow_up_notes?: string | null;
  response_remarks?: string | null;
  response_attachments?: RfqAttachment[];
  vendor?: {
    id: string;
    code?: string;
    name?: string;
    email?: string;
  };
  rfq_items?: Array<{
    id: string;
    pr_item_id: string;
    item_code?: string;
    item_name?: string;
    requested_qty?: number;
    uom?: string;
    vendor_quoted_price?: number | null;
    vendor_quoted_lead_time?: number | null;
    vendor_notes?: string | null;
  }>;
}

interface ProjectOption {
  id: string;
  project_code: string;
  project_name: string;
  department: string;
  status: string;
}

interface ApprovalHistoryEntry {
  id: string;
  action: string;
  actor_name: string;
  reason?: string | null;
  approval_level?: number;
  created_at: string;
}

const resolveUomFromItem = (item: any): string => {
  return (
    String(item?.uom || '').trim() ||
    String(item?.uom_name || '').trim() ||
    String(item?.unit || '').trim() ||
    String(item?.unit_name || '').trim() ||
    String(item?.unit_of_measure || '').trim()
  );
};

function getPrWorkflowStatus(pr: Pick<Requisition, 'workflow_status' | 'status'> | null | undefined): string {
  return String(pr?.workflow_status || pr?.status || '').trim().toUpperCase();
}

function getPrWorkflowLabel(pr: Pick<Requisition, 'workflow_status_label' | 'status'> | null | undefined): string {
  return String(pr?.workflow_status_label || pr?.status || 'UNKNOWN').trim();
}

function canUseApprovedPrActions(pr: Pick<Requisition, 'workflow_status' | 'status'> | null | undefined): boolean {
  const rawStatus = String(pr?.status || '').trim().toUpperCase();
  const status = getPrWorkflowStatus(pr);
  return rawStatus === 'APPROVED' && ['APPROVED', 'RFQ_ISSUED', 'RFQ_RCVD'].includes(status);
}

function canRoleApprovePurchase(user: any): boolean {
  if (isAdminLike(user)) return true;
  return getUserRoleNames(user).some((role) => {
    const normalized = String(role || '').toUpperCase().replace(/[_-]+/g, ' ');
    return ['MANAGER', 'DIRECTOR', 'OWNER'].some((keyword) => normalized.includes(keyword));
  });
}

function normalizePriority(value: string | null | undefined): string {
  const normalized = String(value || 'MEDIUM').trim().toUpperCase();
  return PRIORITY_RANK[normalized] ? normalized : 'MEDIUM';
}

function getPriorityClass(priority: string | null | undefined): string {
  const normalized = normalizePriority(priority);
  if (normalized === 'URGENT') return 'border-red-200 bg-red-50 text-red-700';
  if (normalized === 'HIGH') return 'border-orange-200 bg-orange-50 text-orange-700';
  if (normalized === 'LOW') return 'border-slate-200 bg-slate-50 text-slate-600';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function PriorityBadge({ priority }: { priority?: string | null }) {
  const normalized = normalizePriority(priority);
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${getPriorityClass(normalized)}`}>
      {normalized}
    </span>
  );
}

function parsePrDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const isoDateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDateTime) {
    const year = Number(isoDateTime[1]);
    if (year < 2000 || year > 2100) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = parseDisplayDateToInputValue(raw);
  if (!normalized) return null;
  const year = Number(normalized.slice(0, 4));
  if (year < 2000 || year > 2100) return null;
  const [yearText, monthText, dayText] = normalized.split('-');
  const parsed = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatPrDate(value: string | null | undefined): string {
  const parsed = parsePrDate(value);
  if (!parsed) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(parsed).replace(/\//g, '-');
}

function formatPrDateTime(value: string | null | undefined): string {
  const parsed = parsePrDate(value);
  if (!parsed) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(parsed).replace(/\//g, '-');
}

function escapePrPrintHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeDateInputValue(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    const isValid =
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day &&
      year >= 2000 &&
      year <= 2100;
    return isValid ? raw : '';
  }

  const ddmmyy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (ddmmyy) {
    const [, dayText, monthText, yearText] = ddmmyy;
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return normalizeDateInputValue(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }

  const isoDateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDateTime) {
    return normalizeDateInputValue(`${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}`);
  }

  return '';
}

const AUTO_REFRESH_MS = 30000;

function freshCloneLineId(prefix = 'clone'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function futureOrTodayDate(value: string | null | undefined, today: string): string {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return today;
  return today && normalized < today ? today : normalized;
}

function PRContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser, hydrate: hydrateAuth } = useAuthStore();
  const [todayDate, setTodayDate] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
    hydrateAuth();
    setTodayDate(getTodayDateInputValue());
  }, [hydrateAuth]);
  const permissionUser = isMounted ? currentUser : null;
  const currentUserId = String((permissionUser as any)?.id || (permissionUser as any)?.userId || '');
  const canApprovePR = hasModulePermission(permissionUser, 'Purchase Management', 'approve') || canRoleApprovePurchase(permissionUser);
  const canBypassPrMakerChecker = hasMakerCheckerOverride(permissionUser);
  const canCreatePR = hasModulePermission(permissionUser, 'Purchase Management', 'create');
  const canEditPR = hasModulePermission(permissionUser, 'Purchase Management', 'edit');
  const canDeletePR = hasModulePermission(permissionUser, 'Purchase Management', 'delete');
  const itemEntryRef = useRef<HTMLDivElement>(null);
  const handledDeepLinkRef = useRef('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [items, setItems] = useState<PRItem[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loadingRequisitions, setLoadingRequisitions] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [selectedPR, setSelectedPR] = useState<PRDetail | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryEntry[]>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingPRId, setEditingPRId] = useState<string | null>(null);
  const [formSection, setFormSection] = useState<RequisitionFormSection>('general');
  const [formData, setFormData] = useState({
    department: '',
    projectId: '',
    projectName: '',
    requiredDate: '',
    priority: 'MEDIUM',
    deliveryAddress: '',
    notes: '',
  });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectSaving, setProjectSaving] = useState(false);
  const [deliveryAddresses, setDeliveryAddresses] = useState<DeliveryAddressOption[]>([]);
  const [deliveryAddressName, setDeliveryAddressName] = useState('');
  const [deliveryAddressSaving, setDeliveryAddressSaving] = useState(false);

  const [itemForm, setItemForm] = useState({
    itemName: '',
    vendorId: '',
    vendorName: '',
    quantity: '',
    uom: '',
    estimatedPrice: '',
    specifications: '',
    paymentTerms: '',
    requiredDate: '',
  });

  const [masterItems, setMasterItems] = useState<Item[]>([]);
  const masterItemsRequestRef = useRef(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [itemEntryError, setItemEntryError] = useState('');
  const [itemsLoadError, setItemsLoadError] = useState<string | null>(null);
  const [lastPurchasePrice, setLastPurchasePrice] = useState<{
    unit_price: number;
    po_number?: string;
    po_date?: string;
  } | null>(null);
  const [showRndTemporaryItem, setShowRndTemporaryItem] = useState(false);

  const [rfqPanelOpen, setRfqPanelOpen] = useState(false);
  const [rfqVendors, setRfqVendors] = useState<Vendor[]>([]);
  const [rfqItemVendors, setRfqItemVendors] = useState<Record<string, string[]>>({});
  const [preferredVendorByPrItemId, setPreferredVendorByPrItemId] = useState<Record<string, string>>({});
  const [rfqVendorDrafts, setRfqVendorDrafts] = useState<Record<string, string>>({});
  const [rfqLoadingVendors, setRfqLoadingVendors] = useState(false);
  const [rfqSending, setRfqSending] = useState(false);
  const [rfqResponseDate, setRfqResponseDate] = useState('');
  const [rfqRemarks, setRfqRemarks] = useState('');
  const [rfqRecipientOverrides, setRfqRecipientOverrides] = useState<Record<string, string>>({});
  const [rfqSubjectOverride, setRfqSubjectOverride] = useState('');
  const [rfqCustomMessage, setRfqCustomMessage] = useState('');
  const [showRfqPreview, setShowRfqPreview] = useState(false);
  const [rfqPreviewData, setRfqPreviewData] = useState<any>(null);
  const [rfqPreviewIndex, setRfqPreviewIndex] = useState(0);
  const [rfqPreviewLoading, setRfqPreviewLoading] = useState(false);
  const [rfqHistory, setRfqHistory] = useState<RfqRecord[]>([]);
  const [loadingRfqHistory, setLoadingRfqHistory] = useState(false);
  const [showRfqResponses, setShowRfqResponses] = useState(false);
  const [editingRfqResponse, setEditingRfqResponse] = useState<RfqRecord | null>(null);
  const [savingRfqResponse, setSavingRfqResponse] = useState(false);
  const [uploadingRfqAttachments, setUploadingRfqAttachments] = useState(false);
  const [rfqResponseForm, setRfqResponseForm] = useState<{
    remarks: string;
    followUpDate: string;
    followUpNotes: string;
    attachments: RfqAttachment[];
    items: Array<{
      id?: string;
      prItemId: string;
      itemCode: string;
      itemName: string;
      requestedQty: number;
      uom: string;
      quotedPrice: string;
      leadTime: string;
      notes: string;
    }>;
  }>({
    remarks: '',
    followUpDate: '',
    followUpNotes: '',
    attachments: [],
    items: [],
  });

  const buildPrItemSearchText = (requisition: Requisition) => {
    const items = Array.isArray((requisition as any).purchase_requisition_items)
      ? (requisition as any).purchase_requisition_items
      : Array.isArray((requisition as any).items)
        ? (requisition as any).items
        : [];

    return items
      .map((item: any) => [
        item?.item_code,
        item?.itemCode,
        item?.item_name,
        item?.itemName,
        item?.item_description,
        item?.description,
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

  const requisitionsTableColumns: Array<ListTableColumn<Requisition>> = [
    {
      id: 'pr_number',
      label: 'PR Number',
      accessor: (r) => r.pr_number,
      cell: (r) => <span className="font-medium text-[#4A3426]">{r.pr_number}</span>,
    },
    {
      id: 'department',
      label: 'Department',
      accessor: (r) => r.department,
    },
    {
      id: 'priority',
      label: 'Priority',
      accessor: (r) => normalizePriority(r.priority),
      sortAccessor: (r) => PRIORITY_RANK[normalizePriority(r.priority)],
      cell: (r) => <PriorityBadge priority={r.priority} />,
    },
    {
      id: 'required_date',
      label: 'Required Date',
      accessor: (r) => r.required_date,
      sortAccessor: (r) => new Date(r.required_date).getTime(),
      cell: (r) => <span>{formatPrDate(r.required_date)}</span>,
    },
    {
      id: 'status',
      label: 'Status',
      accessor: (r) => getPrWorkflowLabel(r),
      cell: (r) => (
        <ErpStatusBadge status={getPrWorkflowStatus(r)} label={getPrWorkflowLabel(r)} />
      ),
    },
    {
      id: 'created_at',
      label: 'Created',
      accessor: (r) => r.created_at,
      sortAccessor: (r) => new Date(r.created_at).getTime(),
      cell: (r) => <span>{formatPrDate(r.created_at)}</span>,
    },
    {
      id: 'purpose',
      label: 'Notes',
      accessor: (r) => r.purpose || '',
      cell: (r) => (
        <span className="text-[#7A6555] text-sm truncate max-w-[150px] block" title={r.purpose || ''}>
          {r.purpose || '-'}
        </span>
      ),
      hideable: true,
    },
    {
      id: 'item_description_search',
      label: 'Item / Description',
      accessor: buildPrItemSearchText,
      searchAccessor: buildPrItemSearchText,
      defaultVisible: false,
      minWidth: 220,
    },
    {
      id: 'actions',
      label: 'Actions',
      sortable: false,
      hideable: false,
      cell: (req) => (
        <div className="flex min-w-[9.5rem] items-center justify-end gap-1">
          <ErpButton
            onClick={() => handleViewDetails(req.id)}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="View requisition"
            aria-label="View requisition"
          >
            <Eye className="h-4 w-4" />
          </ErpButton>
          {canCreatePR && (
            <ErpButton
              onClick={() => handleClonePR(req.id)}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Clone requisition as new draft"
              aria-label="Clone requisition as new draft"
            >
              <Copy className="h-4 w-4" />
            </ErpButton>
          )}
          {(req.status === 'DRAFT' || req.status === 'SUBMITTED' || req.status === 'REJECTED') && canEditPR && (
            <ErpButton
              onClick={() => handleEditPR(req.id)}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Edit requisition"
              aria-label="Edit requisition"
            >
              <Edit className="h-4 w-4" />
            </ErpButton>
          )}
          {(req.status === 'DRAFT' || req.status === 'REJECTED') && canEditPR && (
            <ErpButton
              onClick={() => handleSubmitExisting(req.id)}
              variant="primary"
              size="sm"
              className="h-8 w-8 p-0"
              title="Submit for approval"
              aria-label="Submit for approval"
            >
              <Send className="h-4 w-4" />
            </ErpButton>
          )}
          {req.status === 'SUBMITTED' && canApprovePR && (canBypassPrMakerChecker || String(req.requested_by) !== currentUserId) && (
            <>
              <ErpButton
                onClick={() => handleApprove(req.id)}
                variant="approve"
                size="sm"
                className="h-8 w-8 p-0"
                title="Approve requisition"
                aria-label="Approve requisition"
              >
                <Check className="h-4 w-4" />
              </ErpButton>
              <ErpButton
                onClick={() => handleReject(req.id)}
                variant="danger"
                size="sm"
                className="h-8 w-8 p-0"
                title="Reject requisition"
                aria-label="Reject requisition"
              >
                <X className="h-4 w-4" />
              </ErpButton>
            </>
          )}
          {canDeletePR && (
            <ErpButton
              onClick={() => handleDelete(req.id)}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-red-700 hover:bg-red-50 hover:text-red-800"
              title="Delete requisition"
              aria-label="Delete requisition"
            >
              <Trash2 className="h-4 w-4" />
            </ErpButton>
          )}
        </div>
      ),
    },
  ];

  // Helper to get selected vendor IDs
  const getActiveRfqVendorIds = () => new Set(rfqVendors.filter((vendor) => vendor?.is_active !== false).map((vendor) => String(vendor.id)));

  const sanitizeRfqItemVendorMap = (source: Record<string, string[]>) => {
    const activeVendorIds = getActiveRfqVendorIds();
    return Object.fromEntries(
      Object.entries(source).map(([itemId, vendorIds]) => [
        itemId,
        Array.from(new Set((vendorIds || []).map((vendorId) => String(vendorId || '').trim()).filter((vendorId) => vendorId && activeVendorIds.has(vendorId)))),
      ]),
    );
  };

  const getSelectedVendorIds = () => {
    const sanitized = sanitizeRfqItemVendorMap(rfqItemVendors);
    const allVendorIds = Object.values(sanitized).flat().filter(Boolean);
    return Array.from(new Set(allVendorIds));
  };

  // Close modals on Escape key
  useEscapeKey(showDetailModal, () => { setShowDetailModal(false); setSelectedPR(null); });
  useEscapeKey(showRfqPreview, () => setShowRfqPreview(false));
  useEscapeKey(showRfqResponses, () => setShowRfqResponses(false));

  useEffect(() => {
    fetchRequisitions();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;

      fetchRequisitions({ silent: true });
      if (showDetailModal && selectedPR?.id) {
        refreshSelectedPRDetail(selectedPR.id);
        if (showRfqResponses) {
          fetchRfqHistory(selectedPR.id, { silent: true });
        }
      }
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [showDetailModal, selectedPR?.id, showRfqResponses]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, filterVendor]);

  // Load vendors on mount for filter dropdown
  useEffect(() => {
    if (rfqVendors.length === 0) {
      fetchRFQVendors();
    }
  }, []);

  useEffect(() => {
    if (showCreateForm) {
      fetchMasterItems();
      fetchProjects();
      loadDeliveryAddresses()
        .then(setDeliveryAddresses)
        .catch(() => setDeliveryAddresses([]));
      if (rfqVendors.length === 0) {
        fetchRFQVendors();
      }
    }
  }, [showCreateForm]);

  useEffect(() => {
    if (!showCreateForm) return;
    fetchMasterItems();
    resetItemEntry();
  }, [formData.department, showCreateForm]);

  const handleSaveDeliveryAddress = async () => {
    const address = formData.deliveryAddress.trim();
    if (!address) {
      alert('Enter a delivery address before saving');
      return;
    }

    setDeliveryAddressSaving(true);
    try {
      const next = await saveDeliveryAddress(deliveryAddressName, address);
      setDeliveryAddresses(next);
      setDeliveryAddressName('');
      alert('Delivery address saved successfully');
    } catch (error: any) {
      alert(error?.message || 'Failed to save delivery address');
    } finally {
      setDeliveryAddressSaving(false);
    }
  };

  const fetchRequisitions = async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoadingRequisitions(true);
      }
      const response = await apiClient.get('/purchase/requisitions');
      setRequisitions(Array.isArray(response) ? response : []);
    } catch (error: any) {
    } finally {
      if (!options?.silent) {
        setLoadingRequisitions(false);
      }
    }
  };

  const fetchMasterItems = async () => {
    const requestId = ++masterItemsRequestRef.current;
    try {
      setItemsLoadError(null);
      const isRndDepartment = ['R&D', 'RND', 'RESEARCH'].includes(
        String(formData.department || '').trim().toUpperCase(),
      );
      // Keep generated TEMP items reusable by loading them through their own
      // database-scoped query and merging them with the normal catalogue.
      const responses = isRndDepartment
        ? await Promise.all([
            apiClient.get('/inventory/items'),
            apiClient.get('/inventory/items?onlyRnd=true'),
          ])
        : [await apiClient.get('/inventory/items')];
      if (requestId !== masterItemsRequestRef.current) return;
      // apiClient.get already unwraps the data, so response is the array directly.
      // Normalize field names because some APIs return item_id/item_code/etc.
      const list = responses.flatMap((response) =>
        Array.isArray(response) ? (response as RawItem[]) : [],
      );
      const normalized: Item[] = list
        .map((raw) => ({
          id: String(raw.id ?? raw.item_id ?? ''),
          code: String(raw.code ?? raw.item_code ?? ''),
          name: String(raw.name ?? raw.item_name ?? ''),
          uom: resolveUomFromItem(raw),
          standard_cost:
            typeof raw.standard_cost === 'number'
              ? raw.standard_cost
              : typeof raw.standardCost === 'number'
                ? raw.standardCost
                : undefined,
        }))
        .filter((i) => i.id && i.code && i.name)
        .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);

      setMasterItems(normalized);
    } catch (error: any) {
      if (requestId !== masterItemsRequestRef.current) return;
      if (error.message && (error.message.includes('401') || error.message.includes('Unauthorized'))) {
        setItemsLoadError('Session expired. Please refresh the page and login again.');
      } else {
        setItemsLoadError('Failed to load items. Please try again.');
      }
    }
  };

  const selectItem = async (item: Item) => {
    setItemEntryError('');
    setSelectedItemId(item.id);
    setLastPurchasePrice(null);
    setItemForm((prev) => ({
      ...prev,
      itemName: `${item.code} - ${item.name}`,
      uom: item.uom || '',
      vendorId: '',
      vendorName: '',
      estimatedPrice: item.standard_cost?.toString() || '',
      requiredDate: prev.requiredDate || formData.requiredDate || todayDate || getTodayDateInputValue(),
    }));

    // Fetch preferred vendor
    try {
      const preferredVendor = await apiClient.get(`/items/${item.id}/vendors/preferred`);
      
      if (preferredVendor) {
        const preferredVendorId =
          preferredVendor.vendor_id ??
          preferredVendor.vendorId ??
          preferredVendor.id ??
          '';

        const preferredVendorName =
          preferredVendor.vendor_name ??
          preferredVendor.vendorName ??
          preferredVendor.name ??
          '';

        // Try last purchase price (item + preferred vendor). If available, prefer it.
        let lastUnitPrice: number | null = null;
        if (preferredVendorId) {
          try {
            const history = await apiClient.get<
              Array<{ po_number?: string; po_date?: string; unit_price: number; quantity?: number; po_status?: string }>
            >(`/items/${item.id}/vendors/${String(preferredVendorId)}/price-history`);

            const last = Array.isArray(history) ? history[0] : null;
            if (last && typeof last.unit_price === 'number' && !Number.isNaN(last.unit_price)) {
              lastUnitPrice = Number(last.unit_price);
              setLastPurchasePrice({
                unit_price: lastUnitPrice,
                po_number: last.po_number,
                po_date: last.po_date,
              });
            }
          } catch (error) {
          }
        }

        setItemForm((prev) => ({
          ...prev,
          itemName: `${item.code} - ${item.name}`,
          uom: item.uom || '',
          vendorId: preferredVendorId ? String(preferredVendorId) : '',
          vendorName: preferredVendorName || '',
          estimatedPrice:
            (lastUnitPrice !== null
              ? String(lastUnitPrice)
              : preferredVendor.unit_price?.toString() || item.standard_cost?.toString()) ||
            '',
        }));
      } else {
        setLastPurchasePrice(null);
        setItemForm((prev) => ({
          ...prev,
          itemName: `${item.code} - ${item.name}`,
          uom: item.uom || '',
          vendorId: '',
          vendorName: '',
          estimatedPrice: item.standard_cost?.toString() || '',
        }));
      }
    } catch (error) {
      // Fallback to item without vendor
      setLastPurchasePrice(null);
      setItemForm((prev) => ({
        ...prev,
        itemName: `${item.code} - ${item.name}`,
        uom: item.uom || '',
        vendorId: '',
        vendorName: '',
        estimatedPrice: item.standard_cost?.toString() || '',
      }));
    }
  };

  const handleRndTemporaryItemCreated = async (item: RndTemporaryItem) => {
    const normalizedItem: Item = {
      id: String(item.id),
      code: String(item.code),
      name: String(item.name || item.code),
      uom: String(item.uom || 'NOS'),
      standard_cost: item.standard_cost == null ? undefined : Number(item.standard_cost),
      oem_part_no: item.oem_part_no || item.code,
      oem_name: item.oem_name || undefined,
    };
    const vendorName = String(
      item.preferred_vendor_name
      || rfqVendors.find((vendor) => vendor.id === item.preferred_vendor_id)?.name
      || '',
    );

    setMasterItems((current) => [normalizedItem, ...current.filter((entry) => entry.id !== normalizedItem.id)]);
    setSelectedItemId(normalizedItem.id);
    setLastPurchasePrice(null);
    setItemEntryError('');
    setItemForm((current) => ({
      ...current,
      itemName: `${normalizedItem.code} - ${normalizedItem.name}`,
      uom: normalizedItem.uom,
      vendorId: String(item.preferred_vendor_id || ''),
      vendorName,
      estimatedPrice: item.preferred_price == null ? '' : String(item.preferred_price),
      specifications: String(item.description || current.specifications || ''),
      requiredDate: current.requiredDate || formData.requiredDate || todayDate || getTodayDateInputValue(),
    }));
  };

  const formatAvailabilityQty = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    return numeric.toLocaleString('en-IN', {
      maximumFractionDigits: 3,
    });
  };

  const resolveItemQuantity = async (selectedItem: Item, requestedQty: number): Promise<number> => {
    const uom = resolveUomFromItem(selectedItem) || selectedItem.uom || '';
    try {
      const availability = await apiClient.get(
        `/purchase/requisitions/item-availability/${selectedItem.id}`,
      ) as ItemAvailability;

      const coveredQuantity = Math.max(
        0,
        Number(availability.currentStockQty || 0) +
          Number(availability.pendingPoQty || 0) +
          Number(availability.openPrQty || 0),
      );

      // Nothing is currently available, so there is no choice to make.
      if (coveredQuantity === 0 || requestedQty <= coveredQuantity) {
        return requestedQty;
      }

      const remainingQuantity = requestedQty - coveredQuantity;
      const addRemaining = await confirmDialog({
        title: 'Quantity exceeds available coverage',
        message: [
          `Item: ${selectedItem.code} - ${selectedItem.name}`,
          `Requested: ${formatAvailabilityQty(requestedQty)} ${uom}`,
          `Covered by stock, open PRs and pending POs: ${formatAvailabilityQty(coveredQuantity)} ${uom}`,
          `Remaining quantity: ${formatAvailabilityQty(remainingQuantity)} ${uom}`,
          '',
          'Which quantity should be added to this requisition?',
        ].join('\n'),
        confirmLabel: `Add remaining (${formatAvailabilityQty(remainingQuantity)})`,
        cancelLabel: `Add full quantity (${formatAvailabilityQty(requestedQty)})`,
        variant: 'warning',
        disableDismiss: true,
      });
      return addRemaining ? remainingQuantity : requestedQty;
    } catch {
      // A temporary availability lookup issue must not block adding a line item.
      return requestedQty;
    }
  };

  const normalizePrItemCode = (value: unknown) => String(value || '').trim().toUpperCase();

  const findDuplicatePrItem = (selectedItem: Item, excludeLineId?: string | null) => {
    const selectedMasterId = String(selectedItem.id || '').trim();
    const selectedCode = normalizePrItemCode(selectedItem.code);

    return items.find((item) => {
      if (excludeLineId && item.id === excludeLineId) return false;

      const existingMasterId = String(item.masterItemId || '').trim();
      const existingCode = normalizePrItemCode(item.itemCode);

      return (
        (selectedMasterId && existingMasterId && selectedMasterId === existingMasterId) ||
        (selectedCode && existingCode && selectedCode === existingCode)
      );
    });
  };

  const addItem = async () => {
    setItemEntryError('');
    const quantity = Number(itemForm.quantity);
    const estimatedPrice = itemForm.estimatedPrice ? Number(itemForm.estimatedPrice) : undefined;

    if (!selectedItemId) {
      if (formData.department === 'R&D') {
        setShowRndTemporaryItem(true);
        return;
      }
      setItemEntryError('Select an item from the search results before adding it.');
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setItemEntryError('Enter a quantity greater than zero.');
      return;
    }

    if (!itemForm.requiredDate) {
      setItemEntryError('Select the delivery date for this item.');
      return;
    }

    const selectedItem = masterItems.find(item => item.id === selectedItemId);
    if (!selectedItem) {
      setItemEntryError('The selected item is no longer available. Search and select it again.');
      return;
    }

    if (estimatedPrice !== undefined && (!Number.isFinite(estimatedPrice) || estimatedPrice < 0)) {
      setItemEntryError('Estimated unit price cannot be negative.');
      return;
    }

    const duplicate = findDuplicatePrItem(selectedItem);
    if (duplicate) {
      const message = `${selectedItem.code} is already included in this requisition. Edit the existing line instead of adding it again.`;
      setItemEntryError(message);
      toast.error(message);
      return;
    }

    const resolvedQuantity = await resolveItemQuantity(selectedItem, quantity);

    const nextItem = {
      id: Date.now().toString(),
      masterItemId: selectedItem.id,
      itemCode: selectedItem.code,
      itemName: `${selectedItem.code} - ${selectedItem.name}`,
      uom: resolveUomFromItem(selectedItem) || undefined,
      vendorId: itemForm.vendorId || undefined,
      vendorName: itemForm.vendorName || undefined,
      quantity: resolvedQuantity,
      estimatedPrice,
      specifications: itemForm.specifications,
      paymentTerms: itemForm.paymentTerms || undefined,
      requiredDate: itemForm.requiredDate || undefined,
    };

    setItems((prev) => [...prev, nextItem]);

    setItemForm({
      itemName: '',
      vendorId: '',
      vendorName: '',
      quantity: '',
      uom: '',
      estimatedPrice: '',
      specifications: '',
      paymentTerms: '',
      requiredDate: formData.requiredDate || todayDate || getTodayDateInputValue(),
    });
    setSelectedItemId(null);
    setLastPurchasePrice(null);
  };

  const resetItemEntry = () => {
    setItemForm({
      itemName: '',
      vendorId: '',
      vendorName: '',
      quantity: '',
      uom: '',
      estimatedPrice: '',
      specifications: '',
      paymentTerms: '',
      requiredDate: formData.requiredDate || todayDate || getTodayDateInputValue(),
    });
    setSelectedItemId(null);
    setItemEntryError('');
    setLastPurchasePrice(null);
  };

  const closeRequisitionForm = () => {
    setShowCreateForm(false);
    setEditingPRId(null);
    setEditingItemId(null);
    setItems([]);
    setFormData({ department: '', projectId: '', projectName: '', requiredDate: todayDate || getTodayDateInputValue(), priority: 'MEDIUM', deliveryAddress: '', notes: '' });
    setDeliveryAddressName('');
    setFormSection('general');
    resetItemEntry();
  };

  const startNewLineItem = () => {
    setEditingItemId(null);
    resetItemEntry();
    itemEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      itemEntryRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus({ preventScroll: true });
    }, 350);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const editItem = (id: string) => {
    const item = items.find(it => it.id === id);
    if (!item) return;

    // Resolve UOM from master items to get latest value
    const matchedItem = masterItems.find(mi => mi.code === item.itemCode);
    const resolvedUom = matchedItem ? resolveUomFromItem(matchedItem) : (item.uom || '');

    setEditingItemId(id);
    setItemForm({
      itemName: item.itemName,
      vendorId: item.vendorId || '',
      vendorName: item.vendorName || '',
      quantity: item.quantity.toString(),
      uom: resolvedUom,
      estimatedPrice: item.estimatedPrice?.toString() || '',
      specifications: item.specifications || '',
      paymentTerms: item.paymentTerms || '',
      requiredDate: item.requiredDate || formData.requiredDate || '',
    });
    if (matchedItem) {
      setSelectedItemId(matchedItem.id);
    } else {
      setSelectedItemId(null);
      setItemEntryError('This item is not available in the current item master and cannot be edited.');
    }
  };

  const updateItem = async () => {
    if (!editingItemId) return;

    setItemEntryError('');
    const quantity = Number(itemForm.quantity);
    const estimatedPrice = itemForm.estimatedPrice ? Number(itemForm.estimatedPrice) : undefined;

    if (!selectedItemId) {
      setItemEntryError('Select an item from the search results before updating this line.');
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setItemEntryError('Enter a quantity greater than zero.');
      return;
    }

    if (!itemForm.requiredDate) {
      setItemEntryError('Select the delivery date for this item.');
      return;
    }

    const selectedItem = masterItems.find(item => item.id === selectedItemId);
    if (!selectedItem) {
      setItemEntryError('The selected item is no longer available. Search and select it again.');
      return;
    }

    if (estimatedPrice !== undefined && (!Number.isFinite(estimatedPrice) || estimatedPrice < 0)) {
      setItemEntryError('Estimated unit price cannot be negative.');
      return;
    }

    const duplicate = findDuplicatePrItem(selectedItem, editingItemId);
    if (duplicate) {
      const message = `${selectedItem.code} is already included in this requisition. Edit the existing line instead.`;
      setItemEntryError(message);
      toast.error(message);
      return;
    }

    const resolvedQuantity = await resolveItemQuantity(selectedItem, quantity);

    setItems(prev => prev.map(item => 
      item.id === editingItemId ? {
        ...item,
        masterItemId: selectedItem.id,
        itemCode: selectedItem.code,
        itemName: `${selectedItem.code} - ${selectedItem.name}`,
        uom: resolveUomFromItem(selectedItem) || item.uom,
        vendorId: itemForm.vendorId || undefined,
        vendorName: itemForm.vendorName || undefined,
        quantity: resolvedQuantity,
        estimatedPrice,
        specifications: itemForm.specifications,
        paymentTerms: itemForm.paymentTerms || undefined,
        requiredDate: itemForm.requiredDate || undefined,
      } : item
    ));

    setEditingItemId(null);
    resetItemEntry();
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    resetItemEntry();
  };

  const fetchApprovalHistorySafely = async (prId: string): Promise<ApprovalHistoryEntry[]> => {
    try {
      const history = await apiClient.get(`/purchase/requisitions/${prId}/approval-history`);
      return Array.isArray(history) ? history : [];
    } catch (error) {
      console.warn('[PR] Approval history unavailable:', error);
      return [];
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await apiClient.get('/projects?status=ACTIVE');
      setProjects(Array.isArray(response) ? response : []);
    } catch {
      setProjects([]);
    }
  };

  const createProjectFromDropdown = async () => {
    const projectName = window.prompt('Enter new project name');
    if (!projectName?.trim()) return;
    const department = formData.department || 'PRODUCTION';
    setProjectSaving(true);
    try {
      const created = await apiClient.post('/projects', {
        projectName: projectName.trim(),
        department,
      });
      await fetchProjects();
      setFormData((prev) => ({
        ...prev,
        projectId: String(created?.id || ''),
        projectName: String(created?.project_name || projectName.trim()),
      }));
      toast.success('Project created and selected.');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create project');
    } finally {
      setProjectSaving(false);
    }
  };

  const handleViewDetails = async (prId: string) => {
    setSelectedPR(null);
    setLoadingDetail(true);
    setShowDetailModal(true);
    setRfqPanelOpen(false);
    setShowRfqResponses(false);
    setRfqHistory([]);
    setApprovalHistory([]);
    setEditingRfqResponse(null);
    setRfqItemVendors({});
    setPreferredVendorByPrItemId({});
    setRfqResponseDate('');
    setRfqRemarks('');
    if (masterItems.length === 0) {
      // Ensure we can resolve UOM from Item Master in the detail modal.
      fetchMasterItems();
    }
    try {
      const data = await apiClient.get(`/purchase/requisitions/${prId}`);
      setSelectedPR(data);
      setApprovalHistory(await fetchApprovalHistorySafely(prId));
    } catch (error) {
      alert('Failed to load PR details');
      setShowDetailModal(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  const printPurchaseRequisition = async (pr: PRDetail) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups for this site to print the PR.');
      return;
    }
    printWindow.document.write(
      '<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px">Preparing official purchase requisition...</body></html>',
    );
    printWindow.document.close();

    try {
      const company = await apiClient.get('/organization').catch(() => null);
      const branding = buildDocumentBranding(company);
      const generatedOn = new Date().toLocaleString('en-IN');
      const itemRows = (pr.purchase_requisition_items || [])
        .map((item, index) => `
          <tr>
            <td class="center">${index + 1}</td>
            <td><strong>${escapePrPrintHtml(item.item_code || '-')}</strong><div>${escapePrPrintHtml(item.item_name || '-')}</div>${item.remarks ? `<small>${escapePrPrintHtml(item.remarks)}</small>` : ''}</td>
            <td class="center">${escapePrPrintHtml(item.requested_qty)}</td>
            <td class="center">${escapePrPrintHtml(item.uom || '-')}</td>
            <td class="right">${Number(item.estimated_rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="right">${Number(item.total_amount || Number(item.requested_qty || 0) * Number(item.estimated_rate || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${escapePrPrintHtml(formatPrDate(item.required_date || pr.required_date))}</td>
          </tr>`)
        .join('');
      const total = (pr.purchase_requisition_items || []).reduce(
        (sum, item) => sum + Number(item.total_amount || Number(item.requested_qty || 0) * Number(item.estimated_rate || 0)),
        0,
      );
      const approvals = approvalHistory.length
        ? approvalHistory.map((entry) => `<tr><td>${escapePrPrintHtml(entry.action)}</td><td>${escapePrPrintHtml(entry.actor_name || '-')}</td><td>${escapePrPrintHtml(formatPrDateTime(entry.created_at))}</td><td>${escapePrPrintHtml(entry.reason || '-')}</td></tr>`).join('')
        : '<tr><td colspan="4" class="center muted">No approval action recorded</td></tr>';

      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html><head><title>PR - ${escapePrPrintHtml(pr.pr_number)}</title>
        <style>
          @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#1f2937;margin:0}.page{width:100%}
          h1{font-size:20px;text-align:center;letter-spacing:.08em;margin:4px 0 14px;color:#1f2937}.meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #9ca3af;margin-bottom:14px}.meta>div{padding:8px;border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db;min-height:48px}.meta>div:nth-child(4n){border-right:0}.label{font-size:9px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:4px}.value{font-weight:600;white-space:pre-wrap}
          table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #9ca3af;padding:6px;vertical-align:top}th{background:#f3f4f6;text-transform:uppercase;font-size:9px}.center{text-align:center}.right{text-align:right}.muted,small{color:#6b7280}.section{font-size:12px;font-weight:700;margin-top:16px;padding-bottom:5px;border-bottom:1px solid #9ca3af}.total{font-size:12px;font-weight:700}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:42px}.signature{border-top:1px solid #6b7280;padding-top:6px;text-align:center}.footer{margin-top:18px;border-top:1px solid #d1d5db;padding-top:6px;font-size:9px;color:#6b7280;display:flex;justify-content:space-between}@media print{body{margin:0}.no-print{display:none}}
        </style></head><body><div class="page">
        ${renderStandardLetterheadHtml(branding, generatedOn)}
        <h1>PURCHASE REQUISITION</h1>
        <div class="meta">
          <div><div class="label">PR Number</div><div class="value">${escapePrPrintHtml(pr.pr_number)}</div></div>
          <div><div class="label">Request Date</div><div class="value">${escapePrPrintHtml(formatPrDate(pr.request_date))}</div></div>
          <div><div class="label">Required Date</div><div class="value">${escapePrPrintHtml(formatPrDate(pr.required_date))}</div></div>
          <div><div class="label">Status</div><div class="value">${escapePrPrintHtml(pr.workflow_status_label || pr.status)}</div></div>
          <div><div class="label">Department</div><div class="value">${escapePrPrintHtml(pr.department || '-')}</div></div>
          <div><div class="label">Project</div><div class="value">${escapePrPrintHtml(pr.project_name || '-')}</div></div>
          <div><div class="label">Priority</div><div class="value">${escapePrPrintHtml(pr.priority || '-')}</div></div>
          <div><div class="label">Approved By</div><div class="value">${escapePrPrintHtml(pr.approved_by_name || (pr.approved_by ? 'Recorded in workflow' : '-'))}</div></div>
        </div>
        <div class="meta">
          <div style="grid-column:span 2"><div class="label">Purpose</div><div class="value">${escapePrPrintHtml(pr.purpose || '-')}</div></div>
          <div style="grid-column:span 2"><div class="label">Delivery Address</div><div class="value">${escapePrPrintHtml(pr.delivery_address || '-')}</div></div>
        </div>
        <div class="section">Requested Items</div>
        <table><thead><tr><th style="width:5%">#</th><th>Item</th><th style="width:9%">Qty</th><th style="width:8%">UOM</th><th style="width:12%">Est. Rate</th><th style="width:13%">Est. Amount</th><th style="width:12%">Required</th></tr></thead><tbody>${itemRows || '<tr><td colspan="7" class="center muted">No item lines</td></tr>'}<tr><td colspan="5" class="right total">Estimated Total</td><td class="right total">${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td></td></tr></tbody></table>
        <div class="section">Approval Trail</div>
        <table><thead><tr><th>Action</th><th>Actor</th><th>Date & Time</th><th>Remarks</th></tr></thead><tbody>${approvals}</tbody></table>
        <div class="signatures"><div class="signature">Requested By</div><div class="signature">Department Head</div><div class="signature">Approved By</div></div>
        <div class="footer"><span>System-generated controlled document</span><span>Printed ${escapePrPrintHtml(generatedOn)}</span></div>
        </div><script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
      printWindow.document.close();
      printWindow.focus();
    } catch (error: any) {
      printWindow.close();
      toast.error(error?.message || 'Unable to prepare the official PR document.');
    }
  };

  useEffect(() => {
    const openPrId = String(searchParams.get('open') || searchParams.get('prId') || '').trim();
    if (!openPrId) return;

    const shouldOpenRfqResponses = ['1', 'true', 'yes'].includes(
      String(searchParams.get('rfqResponses') || searchParams.get('rfq') || '').trim().toLowerCase(),
    );
    const key = `${openPrId}:${shouldOpenRfqResponses ? 'rfq' : 'detail'}`;
    if (handledDeepLinkRef.current === key) return;
    handledDeepLinkRef.current = key;

    (async () => {
      await handleViewDetails(openPrId);
      if (shouldOpenRfqResponses) {
        await fetchRfqHistory(openPrId);
        setShowRfqResponses(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const refreshSelectedPRDetail = async (prId: string) => {
    try {
      const data = await apiClient.get(`/purchase/requisitions/${prId}`);
      setSelectedPR(data);
      const [approvalRows, rfqRows] = await Promise.all([
        fetchApprovalHistorySafely(prId),
        apiClient.get<RfqRecord[]>(`/purchase/requisitions/${prId}/rfqs`).catch(() => []),
      ]);
      setApprovalHistory(approvalRows);
      setRfqHistory(Array.isArray(rfqRows) ? rfqRows : []);
    } catch {
    }
  };

  const resolveUomForPRDetailItem = (prItem: PRDetailItem): string => {
    const byId = prItem.item_id
      ? masterItems.find((mi) => mi.id === String(prItem.item_id))
      : undefined;

    if (byId?.uom) return byId.uom;

    const code = String(prItem.item_code || '').trim().toLowerCase();
    const byCode = code
      ? masterItems.find((mi) => mi.code.trim().toLowerCase() === code)
      : undefined;

    return byCode?.uom || prItem.uom || '-';
  };

  const handleEditPR = async (prId: string) => {
    try {
      const data = await apiClient.get(`/purchase/requisitions/${prId}`);
      resetItemEntry();
      setEditingItemId(null);

      // Populate form with existing PR data
      setFormData({
        department: data.department || '',
        projectId: data.project_id || data.projectId || '',
        projectName: data.project_name || data.projectName || '',
        requiredDate: normalizeDateInputValue(data.required_date ?? data.requiredDate),
        priority: data.priority || 'MEDIUM',
        deliveryAddress: data.delivery_address || data.deliveryAddress || '',
        notes: data.purpose || data.notes || '',
      });

      // Populate items (API may return purchase_requisition_items)
      const rawItems: any[] = Array.isArray(data?.purchase_requisition_items)
        ? data.purchase_requisition_items
        : Array.isArray(data?.items)
          ? data.items
          : [];

      const prItems: PRItem[] = rawItems.map((item: any) => ({
        id: String(item?.id || ''),
        masterItemId: item?.item_id || item?.itemId || undefined,
        itemCode: item?.item_code || item?.itemCode || '',
        itemName: item?.item_name || item?.itemName || '',
        uom: resolveUomFromItem(item?.item || item),
        vendorId: item?.vendor_id || item?.vendorId || undefined,
        vendorName: item?.vendor_name || item?.vendorName || undefined,
        quantity: item?.requested_qty ?? item?.quantity ?? 0,
        estimatedPrice: item?.estimated_rate ?? item?.estimated_price ?? item?.estimatedPrice ?? undefined,
        specifications: item?.remarks || item?.specifications || '',
        paymentTerms: item?.payment_terms || item?.paymentTerms || undefined,
        requiredDate: String(item?.required_date || item?.requiredDate || '').slice(0, 10) || undefined,
      }));
      setItems(prItems);

      setEditingPRId(prId);
      setFormSection('general');
      setShowCreateForm(true);
    } catch (error) {
      const msg = (error as any)?.message ? String((error as any).message) : '';
      alert(msg ? `Failed to load PR for editing: ${msg}` : 'Failed to load PR for editing');
    }
  };

  const handleClonePR = async (prId: string) => {
    if (!canCreatePR) return;
    try {
      const data = await apiClient.get(`/purchase/requisitions/${prId}`);
      resetItemEntry();
      setEditingItemId(null);
      setEditingPRId(null);
      setRfqPanelOpen(false);
      setShowRfqResponses(false);
      setRfqHistory([]);
      setApprovalHistory([]);

      const sourceRequiredDate = futureOrTodayDate(data.required_date ?? data.requiredDate, todayDate);
      setFormData({
        department: data.department || '',
        projectId: data.project_id || data.projectId || '',
        projectName: data.project_name || data.projectName || '',
        requiredDate: sourceRequiredDate,
        priority: data.priority || 'MEDIUM',
        deliveryAddress: data.delivery_address || data.deliveryAddress || '',
        notes: data.purpose || data.notes
          ? `Cloned from ${data.pr_number || 'source PR'} - ${data.purpose || data.notes}`
          : `Cloned from ${data.pr_number || 'source PR'}`,
      });

      const rawItems: any[] = Array.isArray(data?.purchase_requisition_items)
        ? data.purchase_requisition_items
        : Array.isArray(data?.items)
          ? data.items
          : [];

      const clonedItems: PRItem[] = rawItems.map((item: any, index: number) => ({
        id: freshCloneLineId(`pr-line-${index + 1}`),
        masterItemId: item?.item_id || item?.itemId || undefined,
        itemCode: item?.item_code || item?.itemCode || '',
        itemName: item?.item_name || item?.itemName || '',
        uom: resolveUomFromItem(item?.item || item),
        vendorId: item?.vendor_id || item?.vendorId || undefined,
        vendorName: item?.vendor_name || item?.vendorName || undefined,
        quantity: item?.requested_qty ?? item?.quantity ?? 0,
        estimatedPrice: item?.estimated_rate ?? item?.estimated_price ?? item?.estimatedPrice ?? undefined,
        specifications: item?.remarks || item?.specifications || '',
        paymentTerms: item?.payment_terms || item?.paymentTerms || undefined,
        requiredDate: futureOrTodayDate(item?.required_date || item?.requiredDate || sourceRequiredDate, todayDate),
      }));
      setItems(clonedItems);

      setFormSection('general');
      setShowDetailModal(false);
      setShowCreateForm(true);
      toast.success(`Cloned ${data.pr_number || 'PR'} as a new requisition draft.`);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to clone PR');
    }
  };

  const resolveItemIdForPRItem = async (prItem: PRDetailItem): Promise<string | null> => {
    if (prItem.item_id) return prItem.item_id;

    const query = (prItem.item_code || prItem.item_name || '').trim();
    if (!query) return null;

    try {
      const results = await apiClient.get<Array<{ id: string; code: string; name: string }>>(
        `/items/search?q=${encodeURIComponent(query)}`,
      );
      const list = Array.isArray(results) ? results : [];

      const exactCode = prItem.item_code
        ? list.find((i) => i.code?.toLowerCase() === prItem.item_code.toLowerCase())
        : undefined;
      if (exactCode?.id) return exactCode.id;

      const exactName = prItem.item_name
        ? list.find((i) => i.name?.toLowerCase() === prItem.item_name.toLowerCase())
        : undefined;
      if (exactName?.id) return exactName.id;

      return list[0]?.id || null;
    } catch (error) {
      return null;
    }
  };

  const fetchItemVendorLinksForPRItem = async (
    prItem: PRDetailItem,
    itemIdCache: Map<string, string | null>,
  ): Promise<Array<{ vendorId: string; preferred: boolean }>> => {
    const cacheKey = prItem.item_id || prItem.item_code || prItem.item_name || prItem.id;
    let itemId: string | null | undefined = itemIdCache.get(cacheKey);
    if (itemId === undefined) {
      itemId = await resolveItemIdForPRItem(prItem);
      itemIdCache.set(cacheKey, itemId);
    }

    if (!itemId) return [];

    try {
      const itemVendors = await apiClient.get(`/items/${itemId}/vendors`);
      if (!Array.isArray(itemVendors)) return [];
      return itemVendors
        .filter((iv: any) =>
          iv?.is_active !== false &&
          iv?.vendor?.is_active !== false &&
          (iv?.vendor_id || iv?.vendor?.id),
        )
        .map((iv: any, index: number) => ({
          vendorId: String(iv.vendor_id || iv.vendor?.id),
          preferred: iv.is_preferred === true || index === 0,
        }));
    } catch {
      return [];
    }
  };

  const fetchPreferredVendorsForPR = async (pr: PRDetail) => {
    const items = Array.isArray(pr.purchase_requisition_items) ? pr.purchase_requisition_items : [];
    if (items.length === 0) return;

    const itemIdCache = new Map<string, string | null>();
    const itemVendorMap: Record<string, string[]> = {};
    const preferredVendorMap: Record<string, string> = {};
    let activeVendorIds = new Set<string>();
    try {
      const activeVendors = await apiClient.get<Vendor[]>('/purchase/vendors?isActive=true');
      activeVendorIds = new Set((Array.isArray(activeVendors) ? activeVendors : []).filter((vendor) => vendor?.is_active !== false).map((vendor) => String(vendor.id)));
    } catch {
      activeVendorIds = new Set(rfqVendors.filter((vendor) => vendor?.is_active !== false).map((vendor) => String(vendor.id)));
    }

    for (const prItem of items) {
      const linkedVendors = await fetchItemVendorLinksForPRItem(prItem, itemIdCache);
      const linkedVendorIds = linkedVendors.map((entry) => entry.vendorId).filter((vendorId) => activeVendorIds.has(String(vendorId)));
      const preferredVendorId =
        String(linkedVendors.find((entry) => entry.preferred && activeVendorIds.has(String(entry.vendorId)))?.vendorId || '').trim() ||
        (activeVendorIds.has(String(prItem.vendor_id || '').trim()) ? String(prItem.vendor_id || '').trim() : '') ||
        String(linkedVendorIds[0] || '').trim();

      if (preferredVendorId) {
        preferredVendorMap[prItem.id] = preferredVendorId;
        itemVendorMap[prItem.id] = Array.from(new Set([preferredVendorId, ...linkedVendorIds]));
      } else if (linkedVendorIds.length > 0) {
        itemVendorMap[prItem.id] = Array.from(new Set(linkedVendorIds));
      }

      if (!itemVendorMap[prItem.id]?.length) {
        try {
          const cacheKey = prItem.item_id || prItem.item_code || prItem.item_name || prItem.id;
          const resolvedItemId = itemIdCache.get(cacheKey) ?? await resolveItemIdForPRItem(prItem);
          if (resolvedItemId) {
            const pref = await apiClient.get(`/items/${resolvedItemId}/vendors/preferred`);
            const vendorId = pref?.vendor_id || pref?.vendorId || pref?.vendor?.id;
            if (vendorId && activeVendorIds.has(String(vendorId))) {
              preferredVendorMap[prItem.id] = String(vendorId);
              itemVendorMap[prItem.id] = [String(vendorId)];
            }
          }
        } catch {
        }
      }
    }

    // Set the per-item vendor selections
    setRfqItemVendors(itemVendorMap);
    setPreferredVendorByPrItemId(preferredVendorMap);
  };

  const fetchRFQVendors = async () => {
    try {
      setRfqLoadingVendors(true);
      
      // Get all vendors first, then filter to those associated with PR items
      const allVendors = await apiClient.get<Vendor[]>('/purchase/vendors?isActive=true');
      const vendorList = Array.isArray(allVendors) ? allVendors : [];
      
      // If we have a selected PR with items, get vendors from item_vendors relationships
      if (selectedPR?.purchase_requisition_items && selectedPR.purchase_requisition_items.length > 0) {
        const prItems = selectedPR.purchase_requisition_items;
        const allVendorIds = new Set<string>();
        const itemIdCache = new Map<string, string | null>();

        // Collect every active vendor linked to the PR items. Preferred vendors are highlighted in the item table,
        // but RFQ should not silently exclude alternate approved vendors.
        for (const prItem of prItems) {
          const linkedVendors = await fetchItemVendorLinksForPRItem(prItem, itemIdCache);
          linkedVendors.forEach((entry) => allVendorIds.add(entry.vendorId));
          if (prItem.vendor_id) allVendorIds.add(String(prItem.vendor_id));
        }

        const associatedVendors = vendorList.filter(
          (v) => v?.is_active !== false && allVendorIds.has(String(v.id)),
        );

        const sortByName = (a: Vendor, b: Vendor) => (a.name || '').localeCompare(b.name || '');
        const finalList = associatedVendors.length > 0
          ? associatedVendors
          : vendorList.filter((v) => v?.is_active !== false);
        setRfqVendors([...finalList].sort(sortByName));
      } else {
        // No PR selected, show all active vendors
        const sortByName = (a: Vendor, b: Vendor) => (a.name || '').localeCompare(b.name || '');
        setRfqVendors([...vendorList.filter((v) => v?.is_active !== false)].sort(sortByName));
      }
    } catch (error) {
      alert('Failed to load vendors');
    } finally {
      setRfqLoadingVendors(false);
    }
  };

  const fetchRfqHistory = async (prId: string, options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoadingRfqHistory(true);
      }
      const data = await apiClient.get<RfqRecord[]>(`/purchase/requisitions/${prId}/rfqs`);
      setRfqHistory(Array.isArray(data) ? data : []);
    } catch (error) {
      if (!options?.silent) {
        alert('Failed to load RFQ responses');
      }
      setRfqHistory([]);
    } finally {
      if (!options?.silent) {
        setLoadingRfqHistory(false);
      }
    }
  };

  const openRfqResponseEditor = (rfq: RfqRecord) => {
    const sourceItems = Array.isArray(rfq.rfq_items) && rfq.rfq_items.length > 0
      ? rfq.rfq_items
      : (selectedPR?.purchase_requisition_items || []).map((item) => ({
          id: '',
          pr_item_id: item.id,
          item_code: item.item_code || '',
          item_name: item.item_name || '',
          requested_qty: item.requested_qty || 0,
          uom: resolveUomForPRDetailItem(item),
          vendor_quoted_price: null,
          vendor_quoted_lead_time: null,
          vendor_notes: '',
        }));

    setEditingRfqResponse(rfq);
    setRfqResponseForm({
      remarks: rfq.response_remarks || '',
      followUpDate: normalizeDateInputValue(rfq.follow_up_date),
      followUpNotes: rfq.follow_up_notes || '',
      attachments: Array.isArray(rfq.response_attachments) ? rfq.response_attachments : [],
      items: sourceItems
        .map((item) => ({
            id: item.id,
            prItemId: item.pr_item_id,
            itemCode: item.item_code || '',
            itemName: item.item_name || '',
            requestedQty: Number(item.requested_qty || 0),
            uom: item.uom || '-',
            quotedPrice:
              item.vendor_quoted_price == null || Number.isNaN(Number(item.vendor_quoted_price))
                ? ''
                : String(item.vendor_quoted_price),
            leadTime:
              item.vendor_quoted_lead_time == null || Number.isNaN(Number(item.vendor_quoted_lead_time))
                ? ''
                : String(item.vendor_quoted_lead_time),
            notes: item.vendor_notes || '',
          }))
    });
  };

  const uploadRfqResponseFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    try {
      setUploadingRfqAttachments(true);
      const token = localStorage.getItem('accessToken');
      const uploaded: RfqAttachment[] = [];

      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('bucket', 'documents');
        fd.append('folder', 'rfq-responses');

        const response = await fetch('/api/v1/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData?.message || response.statusText || 'Upload failed');
        }

        const data = await response.json();
        const url = String(data?.url || '').trim();
        if (!url) throw new Error('Upload failed: no URL returned');

        uploaded.push({
          url,
          name: file.name,
        });
      }

      setRfqResponseForm((prev) => ({
        ...prev,
        attachments: [...prev.attachments, ...uploaded],
      }));
    } catch (error: any) {
      alert(`Failed to upload RFQ attachment: ${error?.message || 'Unknown error'}`);
    } finally {
      setUploadingRfqAttachments(false);
    }
  };

  const saveRfqResponse = async () => {
    if (!selectedPR || !editingRfqResponse) return;

    const followUpDate = normalizeDateInputValue(rfqResponseForm.followUpDate);
    if (rfqResponseForm.followUpDate && !followUpDate) {
      alert('Enter a valid follow-up date');
      return;
    }

    const payload = {
      remarks: rfqResponseForm.remarks || undefined,
      followUpDate: followUpDate || undefined,
      followUpNotes: rfqResponseForm.followUpNotes || undefined,
      attachments: rfqResponseForm.attachments,
      items: rfqResponseForm.items.map((item) => ({
        id: item.id,
        prItemId: item.prItemId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        requestedQty: item.requestedQty,
        uom: item.uom,
        quotedPrice: item.quotedPrice === '' ? null : Number(item.quotedPrice),
        leadTime: item.leadTime === '' ? null : Number(item.leadTime),
        notes: item.notes || undefined,
      })),
    };

    try {
      setSavingRfqResponse(true);
      await apiClient.post(
        `/purchase/requisitions/${selectedPR.id}/rfqs/${editingRfqResponse.id}/response`,
        payload,
      );

      await Promise.all([fetchRfqHistory(selectedPR.id), handleViewDetails(selectedPR.id)]);
      setEditingRfqResponse(null);
    } catch (error: any) {
      alert(error?.message || 'Failed to save RFQ response');
    } finally {
      setSavingRfqResponse(false);
    }
  };

  const addItemVendor = (itemId: string, vendorId: string) => {
    if (!vendorId) return;
    setRfqItemVendors((prev) => {
      const currentVendors = prev[itemId] || [];
      if (currentVendors.includes(vendorId)) {
        return prev;
      }

      return {
        ...prev,
        [itemId]: [...currentVendors, vendorId],
      };
    });
    setRfqVendorDrafts((prev) => ({ ...prev, [itemId]: '' }));
  };

  const removeItemVendor = (itemId: string, vendorId: string) => {
    setRfqItemVendors((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || []).filter((id) => id !== vendorId),
    }));
  };

  const handlePreviewRFQ = async (options?: { keepIndex?: number }) => {
    if (!selectedPR) return;
    const selectedVendors = getSelectedVendorIds();
    if (selectedVendors.length === 0) {
      alert('Please select at least one vendor for the items');
      return;
    }
    const sanitizedRfqItemVendors = sanitizeRfqItemVendorMap(rfqItemVendors);

    // Create item-vendor assignments
    const itemVendorAssignments = selectedPR.purchase_requisition_items?.map((item) => ({
      item: item,
      vendorIds: sanitizedRfqItemVendors[item.id] || []
    })) || [];

    // Create item-vendor assignments for API
    const itemVendorAssignmentsForApi = selectedPR.purchase_requisition_items?.map((item) => ({
      itemId: item.id,
      vendorIds: sanitizedRfqItemVendors[item.id] || [],
    })) || [];
    const normalizedResponseDate = normalizeDateInputValue(rfqResponseDate);
    if (rfqResponseDate && !normalizedResponseDate) {
      toast.error('Enter expected response date in dd-mm-yyyy format.');
      return;
    }

    try {
      setRfqPreviewLoading(true);
      const preview = await apiClient.post(`/purchase/requisitions/${selectedPR.id}/rfq/preview`, {
        vendorIds: selectedVendors,
        itemVendors: itemVendorAssignmentsForApi,
        responseDate: normalizedResponseDate || undefined,
        remarks: rfqRemarks || undefined,
        recipientOverrides: rfqRecipientOverrides,
        subject: rfqSubjectOverride.trim() ? rfqSubjectOverride.trim() : undefined,
        customMessage: rfqCustomMessage || undefined,
      });

      const emailPreviews = Array.isArray(preview?.previews) ? preview.previews : [];
      const keepIndex = typeof options?.keepIndex === 'number' ? options.keepIndex : undefined;
      const nextIndex =
        typeof keepIndex === 'number'
          ? Math.min(Math.max(keepIndex, 0), Math.max(emailPreviews.length - 1, 0))
          : 0;

      setRfqPreviewIndex(nextIndex);
      setRfqPreviewData({
        pr: selectedPR,
        vendors: rfqVendors.filter((v) => selectedVendors.includes(v.id)),
        itemVendors: itemVendorAssignments,
        responseDate: normalizedResponseDate,
        remarks: rfqRemarks,
        emailPreviews,
      });
      setShowRfqPreview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate RFQ preview';
      alert(message === 'Failed to generate RFQ preview' ? message : `Failed to generate RFQ preview: ${message}`);
    } finally {
      setRfqPreviewLoading(false);
    }
  };

  const handleSendRFQ = async () => {
    if (!RFQ_EMAIL_SENDING_ENABLED) {
      alert('RFQ emails are currently disabled. Please use Preview RFQ to review the email content.');
      return;
    }

    if (!selectedPR) return;
    const selectedVendors = getSelectedVendorIds();
    if (selectedVendors.length === 0) {
      alert('Please select at least one vendor for the items');
      return;
    }
    const sanitizedRfqItemVendors = sanitizeRfqItemVendorMap(rfqItemVendors);

    // Create item-vendor assignments for API
    const itemVendorAssignments = selectedPR.purchase_requisition_items?.map((item) => ({
      itemId: item.id,
      vendorIds: sanitizedRfqItemVendors[item.id] || []
    })) || [];
    const normalizedResponseDate = normalizeDateInputValue(rfqResponseDate);
    if (rfqResponseDate && !normalizedResponseDate) {
      toast.error('Enter expected response date in dd-mm-yyyy format.');
      return;
    }

    try {
      setRfqSending(true);
      const result = await apiClient.post(`/purchase/requisitions/${selectedPR.id}/rfq/send`, {
        vendorIds: selectedVendors,
        itemVendors: itemVendorAssignments,
        responseDate: normalizedResponseDate || undefined,
        remarks: rfqRemarks || undefined,
        recipientOverrides: rfqRecipientOverrides,
        subject: rfqSubjectOverride.trim() ? rfqSubjectOverride.trim() : undefined,
        customMessage: rfqCustomMessage || undefined,
      });

      const sentCount = result?.sent_count ?? 0;
      const failedCount = result?.failed_count ?? 0;
      const skippedCount = result?.skipped_count ?? 0;
      const failedList: Array<{ email?: string; error?: string }> = Array.isArray(result?.failed) ? result.failed : [];
      const skippedList: Array<{ name?: string; reason?: string }> = Array.isArray(result?.skipped) ? result.skipped : [];
      const failedDetails = failedCount > 0 && failedList.length > 0
        ? `\n\nFailed:\n${failedList.map((f) => `• ${f?.email || 'unknown'} - ${f?.error || 'Unknown error'}`).join('\n')}`
        : '';
      const skippedDetails = skippedCount > 0 && skippedList.length > 0
        ? `\n\nSkipped (no email on file):\n${skippedList.map((s) => `• ${s?.name || 'unknown'}`).join('\n')}`
        : '';
      alert(`RFQ sent: ${sentCount}, failed: ${failedCount}, skipped: ${skippedCount}${failedDetails}${skippedDetails}`);
      setShowRfqPreview(false);
      setRfqPanelOpen(false);
      setRfqItemVendors({});
      setPreferredVendorByPrItemId({});
      setRfqResponseDate('');
      setRfqRemarks('');
      setRfqRecipientOverrides({});
      setRfqSubjectOverride('');
      setRfqCustomMessage('');
      await Promise.all([fetchRequisitions(), handleViewDetails(selectedPR.id)]);
    } catch (error) {
      alert('Failed to send RFQ');
    } finally {
      setRfqSending(false);
    }
  };

  const handleApprove = async (prId: string) => {
    const confirmed = await confirmDialog({
      title: 'Approve Purchase Requisition',
      message: 'Are you sure you want to approve this PR?',
      confirmLabel: 'Approve',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      const updated = await apiClient.post(`/purchase/requisitions/${prId}/approve`, {});
      const nextStatus = String(updated?.status || '').toUpperCase();
      const nextLevel = Number(updated?.current_approval_level || 0) + 1;
      toast.success(nextStatus === 'APPROVED' ? 'PR approved successfully!' : `Approval recorded. Awaiting level ${nextLevel}.`);
      if (showDetailModal) {
        setSelectedPR(updated);
        void fetchApprovalHistorySafely(prId).then(setApprovalHistory);
      }
      fetchRequisitions();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Failed to approve PR';
      toast.error(message);
    }
  };

  const handleSubmitExisting = async (prId: string) => {
    const confirmed = await confirmDialog({
      title: 'Submit Purchase Requisition',
      message: 'Submit this PR to the manager approval queue?',
      confirmLabel: 'Submit for Approval',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      await apiClient.post(`/purchase/requisitions/${prId}/submit`, {});
      toast.success('PR submitted for approval.');
      await fetchRequisitions();
      if (showDetailModal) await handleViewDetails(prId);
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Failed to submit PR';
      toast.error(message);
    }
  };

  const handleReject = async (prId: string) => {
    const reason = prompt('Please enter rejection reason:');
    if (!reason) return;
    try {
      await apiClient.post(`/purchase/requisitions/${prId}/reject`, { reason });
      toast.success('PR rejected successfully!');
      setShowDetailModal(false);
      fetchRequisitions();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Failed to reject PR';
      toast.error(message);
    }
  };

  const handleDelete = async (prId: string) => {
    const confirmed = await confirmDialog({
      title: 'Delete Purchase Requisition',
      message: 'This will delete the PR only if no RFQ, PO, GRN, receipt, or AP records are linked. If linked, the system will block deletion and show the reason.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/purchase/requisitions/${prId}`);
      toast.success('PR deleted successfully!');
      setShowDetailModal(false);
      fetchRequisitions();
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Failed to delete PR';
      toast.error(message);
    }
  };

  const actuallySubmitPR = async (status: 'DRAFT' | 'SUBMITTED') => {
    try {
      const seenItemCodes = new Set<string>();
      const duplicateLine = items.find((item) => {
        const code = String(item.itemCode || '').trim().toUpperCase();
        if (!code) return false;
        if (seenItemCodes.has(code)) return true;
        seenItemCodes.add(code);
        return false;
      });
      if (duplicateLine) {
        const message = `${duplicateLine.itemCode} is duplicated in this PR. Please keep one line and edit its quantity/specifications.`;
        setFormSection('items');
        setItemEntryError(message);
        toast.error(message);
        itemEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const missingDeliveryDate = items.find((item) => !normalizeDateInputValue(item.requiredDate || ''));
      if (status === 'SUBMITTED' && missingDeliveryDate) {
        const message = `${missingDeliveryDate.itemCode || missingDeliveryDate.itemName} requires a delivery date.`;
        setFormSection('items');
        setItemEntryError(message);
        toast.error(message);
        itemEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const normalizedRequiredDate = normalizeDateInputValue(formData.requiredDate);
      if (!normalizedRequiredDate) {
        toast.error('Please select a valid required date.');
        return;
      }
      if (todayDate && normalizedRequiredDate < todayDate) {
        toast.error(`Required date cannot be before today (${formatDateInputDisplay(todayDate)}).`);
        return;
      }

      const prData = {
        department: formData.department,
        projectId: formData.projectId || null,
        projectName: formData.projectName || null,
        requiredDate: normalizedRequiredDate,
        priority: formData.priority,
        deliveryAddress: formData.deliveryAddress || null,
        purpose: formData.notes || null,
        status: status,
        items: items.map(item => ({
          id: item.id,
          itemId: item.masterItemId,
          itemCode: item.itemCode,
          itemName: item.itemName,
          vendorId: item.vendorId || null,
          uom: item.uom || null,
          requestedQty: item.quantity,
          estimatedRate: item.estimatedPrice || 0,
          description: item.specifications || null,
          remarks: item.specifications || null,
          paymentTerms: item.paymentTerms || null,
          requiredDate: normalizeDateInputValue(item.requiredDate || '') || null,
        })),
      };
      
      if (editingPRId) {
        await apiClient.put(`/purchase/requisitions/${editingPRId}`, prData);
        toast.success(`Purchase Requisition ${status === 'DRAFT' ? 'saved as draft' : 'updated'} successfully!`);
      } else {
        await apiClient.post('/purchase/requisitions', prData);
        toast.success(`Purchase Requisition ${status === 'DRAFT' ? 'saved as draft' : 'submitted'} successfully!`);
      }
      
      closeRequisitionForm();
      fetchRequisitions(); // Refresh the list
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      toast.error(`Failed to save purchase requisition: ${errorMessage}`);
    }
  };

  const handleSubmit = async (status: 'DRAFT' | 'SUBMITTED') => {
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    return actuallySubmitPR(status);
  };

  const totalPRs = requisitions.length;
  const pendingApprovals = requisitions.filter((pr) =>
    ['PENDING', 'SUBMITTED', 'AWAITING_APPROVAL'].includes(
      String(pr.workflow_status || pr.status || '').toUpperCase(),
    ),
  ).length;
  const draftPRs = requisitions.filter(pr => pr.status === 'DRAFT').length;
  const urgentHighPRs = requisitions.filter((pr) =>
    ['URGENT', 'HIGH'].includes(normalizePriority(pr.priority)) &&
    !['PO_DONE', 'GOODS_RCVD', 'REJECTED'].includes(getPrWorkflowStatus(pr)),
  ).length;
  const formSectionIndex = REQUISITION_FORM_SECTIONS.findIndex((section) => section.id === formSection);
  const estimatedTotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimatedPrice) || 0),
    0,
  );
  const filteredProjectOptions = [
    ...projects
      .filter((project) => !formData.department || project.department === formData.department)
      .map((project) => ({
        value: project.id,
        label: project.project_name,
        subtitle: `${project.project_code} - ${project.department}`,
      })),
    ...(formData.department
      ? [{ value: ADD_PROJECT_OPTION, label: '+ Add new project', subtitle: formData.department }]
      : []),
  ];
  const canSubmitRequisition = Boolean(formData.department && formData.requiredDate && items.length > 0);

  return (
    <div className="w-full">
      <div className="w-full space-y-3">
        {/* Header */}
        <ErpPageHeader
          eyebrow="Procurement"
          title="Purchase Requisitions"
          description="Create, approve, source, and convert internal purchase requirements."
          actions={canCreatePR ? (
            <ErpButton
              onClick={() => {
                closeRequisitionForm();
                setShowCreateForm(true);
              }}
              variant="primary"
            >
              <Plus className="h-4 w-4" />
              New Requisition
            </ErpButton>
          ) : null}
        />

        <ErpMetricStrip
          loading={loadingRequisitions}
          metrics={[
            { label: 'Total requisitions', value: totalPRs },
            { label: 'Pending approval', value: pendingApprovals, tone: pendingApprovals > 0 ? 'warning' : 'neutral' },
            { label: 'High / urgent open', value: urgentHighPRs, tone: urgentHighPRs > 0 ? 'danger' : 'neutral' },
            { label: 'Drafts', value: draftPRs },
          ]}
        />

        {/* Create Form Slide Panel */}
        <SlidePanel
          open={showCreateForm}
          onClose={closeRequisitionForm}
          title={editingPRId ? 'Edit Purchase Requisition' : 'New Purchase Requisition'}
          subtitle={`${items.length} line item${items.length === 1 ? '' : 's'} | Estimated value ${estimatedTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}`}
          width="full"
          footer={
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ErpButton onClick={closeRequisitionForm} variant="ghost">Cancel</ErpButton>
                <ErpButton
                  onClick={() => setFormSection(REQUISITION_FORM_SECTIONS[Math.max(0, formSectionIndex - 1)].id)}
                  disabled={formSectionIndex === 0}
                  variant="secondary"
                >
                  Previous
                </ErpButton>
                <ErpButton
                  onClick={() => setFormSection(REQUISITION_FORM_SECTIONS[Math.min(REQUISITION_FORM_SECTIONS.length - 1, formSectionIndex + 1)].id)}
                  disabled={formSectionIndex === REQUISITION_FORM_SECTIONS.length - 1}
                  variant="secondary"
                >
                  Next
                </ErpButton>
              </div>
              <div className="flex items-center justify-end gap-2">
                <ErpButton
                  onClick={() => handleSubmit('DRAFT')}
                  disabled={items.length === 0}
                  variant="secondary"
                >
                  <FileText className="w-4 h-4" /> Save Draft
                </ErpButton>
                <ErpButton
                  onClick={() => handleSubmit('SUBMITTED')}
                  disabled={!canSubmitRequisition}
                  variant="primary"
                >
                  <Send className="w-4 h-4" /> {editingPRId ? 'Update & Submit' : 'Submit for Approval'}
                </ErpButton>
              </div>
            </div>
          }
        >
          <div className="space-y-4 pb-2">
            <nav className="sticky -top-3 z-20 -mx-4 -mt-3 border-b border-[#E8DCC4] bg-white px-4" aria-label="Requisition sections">
              <div className="flex min-w-max items-center gap-6 overflow-x-auto">
                {REQUISITION_FORM_SECTIONS.map((section, index) => {
                  const isActive = section.id === formSection;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setFormSection(section.id)}
                      className={`border-b-2 px-1 py-3 text-sm font-semibold transition-colors ${isActive ? 'border-[#8B6F47] text-[#5E4635]' : 'border-transparent text-[#7A6555] hover:text-[#4A3426]'}`}
                      aria-current={isActive ? 'step' : undefined}
                    >
                      <span className="mr-2 text-xs text-[#9A8878]">{index + 1}</span>
                      {section.label}{section.id === 'items' ? ` (${items.length})` : ''}
                    </button>
                  );
                })}
              </div>
            </nav>
            {formSection === 'general' && (
              <section aria-labelledby="pr-general-heading" className="space-y-4">
                <div>
                  <h3 id="pr-general-heading" className="text-lg font-semibold text-[#4A3426]">General Information</h3>
                  <p className="text-sm text-[#7A6555]">Request ownership, priority, required date, and delivery location.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#5E4635]">Department *</label>
                    <SearchableSelect
                      value={formData.department}
                      onChange={(department) => setFormData((prev) => ({ ...prev, department, projectId: '', projectName: '' }))}
                      options={DEPARTMENT_OPTIONS}
                      placeholder="Search department"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#5E4635]">Project</label>
                    <SearchableSelect
                      value={formData.projectId}
                      onChange={(projectId, option) => {
                        if (projectId === ADD_PROJECT_OPTION) {
                          createProjectFromDropdown();
                          return;
                        }
                        setFormData((prev) => ({ ...prev, projectId, projectName: option?.label || '' }));
                      }}
                      options={filteredProjectOptions}
                      placeholder={formData.department ? 'Search or add project' : 'Select department first'}
                      disabled={!formData.department || projectSaving}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#5E4635] mb-2">
                      Required Date *
                    </label>
                    <DateInput
                      min={todayDate}
                      value={formData.requiredDate}
                      onChange={(value) => {
                        setFormData((current) => ({ ...current, requiredDate: value }));
                        setItemForm((current) => ({
                          ...current,
                          requiredDate: current.requiredDate || value,
                        }));
                      }}
                      className="w-full px-4 py-2 border border-[#D8C8AA] rounded-lg focus:ring-2 focus:ring-[#8B6F47] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#5E4635]">Priority *</label>
                    <SearchableSelect
                      value={formData.priority}
                      onChange={(priority) => setFormData((prev) => ({ ...prev, priority }))}
                      options={PRIORITY_OPTIONS}
                      placeholder="Select priority"
                      required
                    />
                    <p className="mt-1 text-xs text-[#7A6555]">
                      Used for purchase follow-up, filtering, and urgent/high visibility. Automatic notification frequency is not enabled yet.
                    </p>
                  </div>
                  <div className="lg:col-span-3">
                    <label className="block text-sm font-medium text-[#5E4635] mb-2">
                      Delivery Address
                    </label>
                    <div className="space-y-2">
                      <SearchableSelect
                        value={deliveryAddresses.some((entry) => entry.address === formData.deliveryAddress) ? formData.deliveryAddress : ''}
                        onChange={(address) => setFormData((prev) => ({ ...prev, deliveryAddress: address }))}
                        options={deliveryAddresses.map((entry) => ({
                          value: entry.address,
                          label: entry.name,
                          subtitle: entry.address,
                        }))}
                        placeholder="Search stored delivery addresses"
                        truncateInput={false}
                        showSubtitleInInput={false}
                      />
                      <textarea
                        value={formData.deliveryAddress}
                        onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
                        rows={2}
                        className="w-full px-4 py-2 border border-[#D8C8AA] rounded-lg focus:ring-2 focus:ring-[#8B6F47] focus:border-transparent"
                        placeholder="Enter delivery address..."
                      />
                      <div className="flex gap-2">
                        <input
                          value={deliveryAddressName}
                          onChange={(e) => setDeliveryAddressName(e.target.value)}
                          className="flex-1 px-4 py-2 border border-[#D8C8AA] rounded-lg focus:ring-2 focus:ring-[#8B6F47] focus:border-transparent"
                          placeholder="Address name for saving, e.g. Factory"
                        />
                        <button
                          type="button"
                          onClick={handleSaveDeliveryAddress}
                          disabled={deliveryAddressSaving || !formData.deliveryAddress.trim()}
                          className="px-4 py-2 rounded-lg bg-[#8B6F47] text-white text-sm font-semibold hover:bg-[#5E4635] disabled:opacity-50"
                        >
                          {deliveryAddressSaving ? 'Saving...' : 'Save Address'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

                {/* Items Section */}
            {formSection === 'items' && (
                <section aria-labelledby="pr-items-heading">
                  <h3 id="pr-items-heading" className="mb-2 text-lg font-semibold text-[#4A3426]">Line Items</h3>

                  {/* Add Item Form */}
                  <div ref={itemEntryRef} className="scroll-mt-3 mb-3 rounded-md border border-[#E8DCC4] bg-[#FAF9F6] p-3">
                    <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
                      {/* Item Name/Search */}
                      <div className="xl:col-span-4">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <SearchableSelect
                              value={selectedItemId || ''}
                              onChange={(itemId) => {
                                setItemEntryError('');
                                const item = masterItems.find((candidate) => candidate.id === itemId);
                                if (item) void selectItem(item);
                              }}
                              options={masterItems.map((item) => ({
                                value: item.id,
                                label: `${item.code} - ${item.name}`,
                                subtitle: `UOM: ${item.uom || '-'}${typeof item.standard_cost === 'number' ? ` | Standard cost: ${item.standard_cost.toFixed(2)}` : ''}`,
                              }))}
                              placeholder={itemsLoadError || 'Search item code, name, or UOM'}
                              disabled={Boolean(itemsLoadError)}
                              truncateInput={false}
                              minSearchChars={2}
                              maxResults={75}
                              showSubtitleInInput={false}
                              dropdownClassName="max-h-80"
                            />
                          </div>
                          {formData.department === 'R&D' ? (
                            <button
                              type="button"
                              onClick={() => setShowRndTemporaryItem(true)}
                              title="Add temporary R&D item"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-lg font-bold text-emerald-700 hover:bg-emerald-100"
                            >
                              +
                            </button>
                          ) : null}
                        </div>
                        {itemForm.vendorName ? (
                          <p className="mt-1 text-xs text-[#7A6555]">
                            Preferred vendor: <span className="font-medium text-[#5E4635]">{itemForm.vendorName}</span>
                          </p>
                        ) : null}
                      </div>
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        value={itemForm.quantity}
                        onChange={(e) => {
                          setItemEntryError('');
                          setItemForm({ ...itemForm, quantity: e.target.value });
                        }}
                        placeholder="Quantity *"
                        className="border border-[#D8C8AA] px-3 py-2 focus:ring-2 focus:ring-[#8B6F47] xl:col-span-2"
                      />
                      <input
                        type="text"
                        value={itemForm.uom || ''}
                        onChange={(e) => setItemForm({ ...itemForm, uom: e.target.value })}
                        placeholder="UOM"
                        readOnly
                        className="cursor-not-allowed border border-[#D8C8AA] bg-[#F5EFE3] px-3 py-2 focus:ring-2 focus:ring-[#8B6F47] xl:col-span-2"
                        title="UOM is filled from the selected master item"
                      />
                      <div className="xl:col-span-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={itemForm.estimatedPrice}
                          onChange={(e) => setItemForm({ ...itemForm, estimatedPrice: e.target.value })}
                          placeholder="Est. Unit Price"
                          title="Estimated unit price. Extended price = Qty × unit price."
                          className="w-full px-3 py-2 border border-[#D8C8AA] rounded-lg focus:ring-2 focus:ring-[#8B6F47]"
                        />
                        {lastPurchasePrice && (
                          <div className="mt-1 text-[11px] text-[#7A6555]">
                            Last: <span className="font-medium text-[#5E4635]">₹{Number(lastPurchasePrice.unit_price || 0).toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {itemEntryError ? (
                      <p role="alert" className="mb-3 text-sm font-medium text-red-700">{itemEntryError}</p>
                    ) : null}
                    <textarea
                      value={itemForm.specifications}
                      onChange={(e) => setItemForm({ ...itemForm, specifications: e.target.value })}
                      placeholder="Specifications / Notes"
                      rows={2}
                      className="w-full resize-y rounded-md border border-[#D8C8AA] px-3 py-2 focus:ring-2 focus:ring-[#8B6F47]"
                    />

                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
                      <div className="lg:col-span-6">
                        <label className="block text-xs font-semibold text-[#5E4635] mb-1">Delivery Date *</label>
                        <DateInput
                          min={todayDate}
                          value={itemForm.requiredDate}
                          onChange={(requiredDate) => {
                            setItemEntryError('');
                            setItemForm((current) => ({ ...current, requiredDate }));
                          }}
                          required
                          className="w-full px-3 py-2 border border-[#D8C8AA] rounded-lg focus:ring-2 focus:ring-[#8B6F47] text-sm"
                        />
                      </div>
                      <div className="flex items-end justify-end gap-2 lg:col-span-6">
                        {editingItemId ? (
                          <>
                            <ErpButton
                              type="button"
                              onClick={cancelEdit}
                              variant="secondary"
                            >
                              Cancel
                            </ErpButton>
                            <ErpButton
                              type="button"
                              onClick={updateItem}
                              variant="approve"
                            >
                              Update
                            </ErpButton>
                          </>
                        ) : (
                          <ErpButton
                            type="button"
                            onClick={addItem}
                            variant="primary"
                            className="min-w-[180px]"
                          >
                            <Plus className="h-4 w-4" /> Add Item
                          </ErpButton>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Items List */}
                  {items.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-[#F5EFE3]">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Item</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Vendor</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Qty</th>
                            <th
                              className="px-4 py-2 text-left text-sm font-semibold"
                              title="Estimated unit price. Extended price = Qty × unit price."
                            >
                              Est. Unit Price
                            </th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Delivery Date</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Specifications</th>
                            <th className="px-4 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.id} className="border-t">
                              <td className="px-4 py-2">
                                <div className="font-medium text-[#4A3426]">{item.itemName}</div>
                              </td>
                              <td className="px-4 py-2">
                                <SearchableSelect
                                  value={item.vendorId || ''}
                                  onChange={(vendorId) => {
                                    const vendor = rfqVendors.find((v) => v.id === vendorId);
                                    setItems((prev) =>
                                      prev.map((it) =>
                                        it.id === item.id
                                          ? {
                                              ...it,
                                              vendorId: vendorId || undefined,
                                              vendorName: vendor ? vendor.name : undefined,
                                            }
                                          : it,
                                      ),
                                    );
                                  }}
                                  options={[
                                    { value: '', label: 'No vendor assigned' },
                                    ...rfqVendors.map((vendor) => ({
                                      value: vendor.id,
                                      label: vendor.name,
                                      subtitle: vendor.code || vendor.email,
                                    })),
                                  ]}
                                  placeholder="Search vendors"
                                  className="min-w-52"
                                  showSubtitleInInput={false}
                                />
                              </td>
                              <td className="px-4 py-2">
                                {item.quantity}
                                {(() => {
                                  const matchedItem = masterItems.find(mi => mi.code === item.itemCode);
                                  const uom = matchedItem ? resolveUomFromItem(matchedItem) : item.uom;
                                  return uom ? <span className="ml-1 text-xs text-[#7A6555]">{uom}</span> : null;
                                })()}
                              </td>
                              <td className="px-4 py-2">
                                {item.estimatedPrice ? `₹${item.estimatedPrice.toFixed(2)}` : '-'}
                              </td>
                              <td className="px-4 py-2 text-sm font-medium text-[#5E4635]">
                                {item.requiredDate ? formatDateInputDisplay(item.requiredDate) : '-'}
                              </td>
                              <td className="whitespace-pre-wrap px-4 py-2 text-sm text-[#7A6555]">
                                {item.specifications || '-'}
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => editItem(item.id)}
                                    className="text-blue-600 hover:text-blue-800 font-medium"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeItem(item.id)}
                                    className="text-red-600 hover:text-red-800 font-medium"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-center border-t border-[#E8DCC4] bg-[#FAF9F6] px-3 py-2.5">
                        <ErpButton type="button" onClick={startNewLineItem} variant="secondary">
                          <Plus className="h-4 w-4" /> Add New Line Item
                        </ErpButton>
                      </div>
                    </div>
                  )}
                </section>
            )}

                {/* Notes */}
            {formSection === 'notes' && (
                <section aria-labelledby="pr-notes-heading" className="space-y-3">
                  <div>
                    <h3 id="pr-notes-heading" className="text-lg font-semibold text-[#4A3426]">Notes and Instructions</h3>
                    <p className="text-sm text-[#7A6555]">Information that applies to the complete requisition.</p>
                  </div>
                  <label className="block text-sm font-medium text-[#5E4635] mb-2">
                    Additional Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 border border-[#D8C8AA] rounded-lg focus:ring-2 focus:ring-[#8B6F47] focus:border-transparent"
                    placeholder="Any additional information..."
                  />
                </section>
            )}

            {formSection === 'review' && (
              <section aria-labelledby="pr-review-heading" className="space-y-5">
                <div>
                  <h3 id="pr-review-heading" className="text-lg font-semibold text-[#4A3426]">Review Requisition</h3>
                  <p className="text-sm text-[#7A6555]">Confirm the request details before saving or submitting.</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-[#E8DCC4] py-4 lg:grid-cols-5">
                  <div><dt className="text-xs font-medium text-[#7A6555]">Department</dt><dd className="mt-1 font-semibold text-[#4A3426]">{formData.department || 'Required'}</dd></div>
                  <div><dt className="text-xs font-medium text-[#7A6555]">Project</dt><dd className="mt-1 font-semibold text-[#4A3426]">{formData.projectName || 'Not linked'}</dd></div>
                  <div><dt className="text-xs font-medium text-[#7A6555]">Priority</dt><dd className="mt-1 font-semibold text-[#4A3426]">{formData.priority}</dd></div>
                  <div><dt className="text-xs font-medium text-[#7A6555]">Required date</dt><dd className="mt-1 font-semibold text-[#4A3426]">{formData.requiredDate ? formatDateInputDisplay(formData.requiredDate) : 'Required'}</dd></div>
                  <div><dt className="text-xs font-medium text-[#7A6555]">Line items</dt><dd className="mt-1 font-semibold text-[#4A3426]">{items.length}</dd></div>
                  <div><dt className="text-xs font-medium text-[#7A6555]">Estimated value</dt><dd className="mt-1 font-semibold text-[#4A3426]">{estimatedTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</dd></div>
                </dl>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[#4A3426]">Items</h4>
                  {items.length === 0 ? (
                    <button type="button" onClick={() => setFormSection('items')} className="text-sm font-semibold text-[#8B6F47] hover:text-[#4A3426]">Add at least one line item</button>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-[#E8DCC4]">
                      <table className="w-full table-fixed">
                        <thead className="bg-[#FAF9F6] text-left text-xs uppercase text-[#7A6555]"><tr><th className="px-3 py-2">Item</th><th className="w-32 px-3 py-2 text-right">Quantity</th><th className="w-40 px-3 py-2 text-right">Amount</th></tr></thead>
                        <tbody className="divide-y divide-[#E8DCC4]">
                          {items.map((item) => (
                            <tr key={item.id}><td className="px-3 py-2 text-sm font-medium text-[#4A3426]">{item.itemName}</td><td className="px-3 py-2 text-right text-sm">{item.quantity} {item.uom}</td><td className="px-3 py-2 text-right text-sm font-semibold">{((item.quantity || 0) * (item.estimatedPrice || 0)).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div><p className="text-xs font-medium text-[#7A6555]">Delivery address</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#5E4635]">{formData.deliveryAddress || 'Not specified'}</p></div>
                  <div><p className="text-xs font-medium text-[#7A6555]">Notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#5E4635]">{formData.notes || 'No additional notes'}</p></div>
                </div>
              </section>
            )}

          </div>
        </SlidePanel>

        {/* List View */}
        <div className="flex items-center justify-between pt-1">
          <h2 className="text-sm font-semibold text-[#4A3426]">
            {canApprovePR ? 'All Requisitions' : 'My Requisitions'}
          </h2>
        </div>

        {loadingRequisitions ? (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="p-6 text-center text-[#7A6555]">
              <p>Loading requisitions...</p>
            </div>
          </div>
        ) : requisitions.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="p-6 text-center text-[#7A6555]">
              <p className="text-lg mb-2">No purchase requisitions yet</p>
              <p className="text-sm">Click &ldquo;New Requisition&rdquo; to create your first purchase request</p>
            </div>
          </div>
        ) : (
          <ListTable
            storageKey="requisitionsTable"
            rows={requisitions.filter((r: any) => {
              const statusMatch = !filterStatus ? true : getPrWorkflowStatus(r) === filterStatus;
              const vendorMatch = !filterVendor ? true : (r.purchase_requisition_items || r.items || [])?.some((item: any) => item.vendor_id === filterVendor || item.vendorId === filterVendor);
              const priorityMatch = !filterPriority ? true : normalizePriority(r.priority) === filterPriority;
              return statusMatch && vendorMatch && priorityMatch;
            }).sort((a, b) => {
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            })}
            columns={requisitionsTableColumns}
            getRowId={(r) => r.id}
            defaultSort={{ id: 'created_at', direction: 'desc' }}
            defaultPageSize={10}
            pageSizeOptions={[10, 25, 50, 100]}
            searchPlaceholder="Search PR, item code, name, description, department, priority, status..."
            variantContext={{ vendor: filterVendor, status: filterStatus, priority: filterPriority }}
            onApplyVariantContext={(context) => {
              setFilterVendor(context.vendor || '');
              setFilterStatus(context.status || '');
              setFilterPriority(context.priority || '');
            }}
            toolbarRight={
              <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
                <SearchableSelect
                  value={filterVendor}
                  onChange={setFilterVendor}
                  options={[
                    { value: '', label: 'All vendors' },
                    ...rfqVendors.map((vendor) => ({
                      value: vendor.id,
                      label: vendor.name,
                      subtitle: vendor.code || vendor.email,
                    })),
                  ]}
                  placeholder="Filter by vendor"
                  className="w-full sm:w-56"
                />
                <SearchableSelect
                  value={filterPriority}
                  onChange={setFilterPriority}
                  options={[
                    { value: '', label: 'All priorities' },
                    ...PRIORITY_OPTIONS,
                  ]}
                  placeholder="Filter by priority"
                  className="w-full sm:w-48"
                />
                <SearchableSelect
                  value={filterStatus}
                  onChange={setFilterStatus}
                  options={[
                    { value: '', label: 'All statuses' },
                    { value: 'DRAFT', label: 'Draft' },
                    { value: 'AWAITING_APPROVAL', label: 'Awaiting approval' },
                    { value: 'SUBMITTED', label: 'Submitted' },
                    { value: 'RFQ_ISSUED', label: 'RFQ issued' },
                    { value: 'RFQ_RCVD', label: 'RFQ received' },
                    { value: 'PO_DONE', label: 'PO completed' },
                    { value: 'GOODS_RCVD', label: 'Goods received' },
                    { value: 'REJECTED', label: 'Rejected' },
                  ]}
                  placeholder="Filter by status"
                  className="w-full sm:w-48"
                />
              </div>
            }
          />
        )}

        {/* Full-screen PR workspace */}
        {showDetailModal && isMounted && createPortal(
          <div className="fixed inset-0 z-[1000] h-[100dvh] w-screen overflow-hidden bg-[#FAF9F6]">
            <div className="flex h-full w-full flex-col bg-white">
              {loadingDetail ? (
                <div className="flex flex-1 items-center justify-center p-8 text-center">
                  <div className="animate-pulse">
                    <div className="h-4 bg-[#E8DCC4] rounded w-3/4 mx-auto mb-4"></div>
                    <div className="h-4 bg-[#E8DCC4] rounded w-1/2 mx-auto"></div>
                    <p className="text-[#7A6555] mt-4">Loading PR details...</p>
                  </div>
                </div>
              ) : selectedPR ? (
                <>
                  {/* Sticky Header */}
                  <div className="z-10 border-b border-[#E8DCC4] bg-white px-4 py-4 sm:px-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-xl font-bold text-[#4A3426] sm:text-2xl">Purchase Requisition</h2>
                          <ErpStatusBadge
                            status={getPrWorkflowStatus(selectedPR)}
                            label={getPrWorkflowLabel(selectedPR)}
                          />
                        </div>
                        <p className="mt-1 text-sm font-medium text-[#7A6555]">{selectedPR.pr_number}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(selectedPR.status === 'DRAFT' || selectedPR.status === 'SUBMITTED' || selectedPR.status === 'REJECTED') && canEditPR && (
                          <ErpButton
                            onClick={() => {
                              handleEditPR(selectedPR.id);
                              setShowDetailModal(false);
                            }}
                            variant="secondary"
                            size="sm"
                          >
                            <Edit className="h-4 w-4" />
                            Edit
                          </ErpButton>
                        )}
                        {canCreatePR && (
                          <ErpButton
                            onClick={() => handleClonePR(selectedPR.id)}
                            variant="secondary"
                            size="sm"
                          >
                            <Copy className="h-4 w-4" />
                            Clone PR
                          </ErpButton>
                        )}
                        {(selectedPR.status === 'DRAFT' || selectedPR.status === 'REJECTED') && canEditPR && (
                          <ErpButton onClick={() => handleSubmitExisting(selectedPR.id)} variant="primary" size="sm">
                            <Send className="h-4 w-4" />
                            Submit for Approval
                          </ErpButton>
                        )}
                        {selectedPR.status === 'SUBMITTED' && canApprovePR && (canBypassPrMakerChecker || String(selectedPR.requested_by) !== currentUserId) && (
                          <>
                            <ErpButton onClick={() => handleReject(selectedPR.id)} variant="danger" size="sm">
                              <X className="h-4 w-4" />
                              Reject
                            </ErpButton>
                            <ErpButton onClick={() => handleApprove(selectedPR.id)} variant="approve" size="sm">
                              <Check className="h-4 w-4" />
                              Approve
                            </ErpButton>
                          </>
                        )}
                        {selectedPR.status === 'SUBMITTED' && String(selectedPR.requested_by) === currentUserId && !canBypassPrMakerChecker && (
                          <span className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                            Awaiting manager approval
                          </span>
                        )}
                        {selectedPR.status === 'SUBMITTED' && !canApprovePR && String(selectedPR.requested_by) !== currentUserId && (
                          <span className="rounded border border-[#E8DCC4] bg-[#FAF9F6] px-3 py-2 text-sm font-medium text-[#7A6555]">
                            Approval access required
                          </span>
                        )}
                        {canUseApprovedPrActions(selectedPR) &&
                          getPrWorkflowStatus(selectedPR) !== 'PO_DONE' &&
                          getPrWorkflowStatus(selectedPR) !== 'GOODS_RCVD' && (
                          <>
                            <ErpButton
                              onClick={async () => {
                                const nextOpen = !rfqPanelOpen;
                                setRfqPanelOpen(nextOpen);
                                if (nextOpen && rfqVendors.length === 0) {
                                  await fetchRFQVendors();
                                }
                                if (nextOpen && selectedPR) {
                                  await fetchPreferredVendorsForPR(selectedPR);
                                }
                              }}
                              variant="secondary"
                              size="sm"
                            >
                              <Send className="h-4 w-4" />
                              Send RFQ
                            </ErpButton>
                            <ErpButton
                              onClick={async () => {
                                const next = !showRfqResponses;
                                setShowRfqResponses(next);
                                if (next) {
                                  await fetchRfqHistory(selectedPR.id);
                                }
                              }}
                              variant="secondary"
                              size="sm"
                            >
                              View RFQ responses
                            </ErpButton>
                            <ErpButton
                              onClick={() => {
                                setShowDetailModal(false);
                                router.push(`/dashboard/purchase/orders?prId=${selectedPR.id}`);
                              }}
                              variant="primary"
                              size="sm"
                            >
                              Create PO
                            </ErpButton>
                          </>
                        )}
                        <ErpButton
                          onClick={() => void printPurchaseRequisition(selectedPR)}
                          variant="secondary"
                          size="sm"
                        >
                          <Printer className="h-4 w-4" />
                          Print PR
                        </ErpButton>
                        <ErpButton
                          onClick={() => setShowDetailModal(false)}
                          variant="ghost"
                          size="sm"
                          aria-label="Close requisition details"
                        >
                          <X className="h-4 w-4" />
                          Close
                        </ErpButton>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto bg-[#FAF9F6] p-4 sm:p-6">

                  {/* PR Info */}
                  <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg border border-[#E8DCC4] bg-white p-4 sm:grid-cols-3 lg:grid-cols-4">
                    <div>
                      <p className="text-sm text-[#7A6555]">Department</p>
                      <p className="font-semibold">{selectedPR.department}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[#7A6555]">Project Name</p>
                      <p className="font-semibold">{selectedPR.project_name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[#7A6555]">Status</p>
                      <ErpStatusBadge
                        status={getPrWorkflowStatus(selectedPR)}
                        label={getPrWorkflowLabel(selectedPR)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <p className="text-sm text-[#7A6555]">Required Date</p>
                      <p className="font-semibold">{formatPrDate(selectedPR.required_date)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[#7A6555]">Priority</p>
                      <div className="mt-1">
                        <PriorityBadge priority={selectedPR.priority} />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-[#7A6555]">Purpose</p>
                      <p className="font-semibold">{selectedPR.purpose || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[#7A6555]">Request Date</p>
                      <p className="font-semibold">{formatPrDate(selectedPR.request_date)}</p>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <p className="text-sm text-[#7A6555]">Delivery Address</p>
                      <p className="font-semibold whitespace-pre-line">{selectedPR.delivery_address || 'N/A'}</p>
                    </div>
                    {/* Hide UUID for requested_by until we implement user lookup */}
                    {selectedPR.approved_by && (
                      <div>
                        <p className="text-sm text-[#7A6555]">Approved By</p>
                        <p className="font-semibold text-xs">{selectedPR.approved_by_name || 'Unknown User'}</p>
                      </div>
                    )}
                    {selectedPR.approved_at && (
                      <div>
                        <p className="text-sm text-[#7A6555]">Approved At</p>
                        <p className="font-semibold">{formatPrDate(selectedPR.approved_at)}</p>
                      </div>
                    )}
                    {selectedPR.submitted_at && (
                      <div>
                        <p className="text-sm text-[#7A6555]">Submitted At</p>
                        <p className="font-semibold">{formatPrDateTime(selectedPR.submitted_at)}</p>
                      </div>
                    )}
                    {selectedPR.rejected_at && (
                      <div>
                        <p className="text-sm text-[#7A6555]">Rejected At</p>
                        <p className="font-semibold">{formatPrDateTime(selectedPR.rejected_at)}</p>
                      </div>
                    )}
                    {selectedPR.rejection_reason && (
                      <div className="sm:col-span-2 lg:col-span-4">
                        <p className="text-sm text-[#7A6555]">Rejection Reason</p>
                        <p className="whitespace-pre-wrap font-semibold text-red-700">{selectedPR.rejection_reason}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-[#7A6555]">RFQ Sent</p>
                      <p className="font-semibold">{Number(selectedPR.rfq_summary?.sentCount || 0)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[#7A6555]">RFQ Received</p>
                      <p className="font-semibold">{Number(selectedPR.rfq_summary?.receivedCount || 0)}</p>
                    </div>
                    {selectedPR.rfq_summary?.nextFollowUpDate && (
                      <div>
                        <p className="text-sm text-[#7A6555]">Next Follow-up</p>
                        <p className="font-semibold">{formatPrDate(selectedPR.rfq_summary.nextFollowUpDate)}</p>
                      </div>
                    )}
                    {selectedPR.edit_count && selectedPR.edit_count > 0 && (
                      <div>
                        <p className="text-sm text-[#7A6555]">Edits</p>
                        <p className="font-semibold">{selectedPR.edit_count} time{selectedPR.edit_count !== 1 ? 's' : ''}</p>
                      </div>
                    )}
                    {selectedPR.last_edited_at && (
                      <div>
                        <p className="text-sm text-[#7A6555]">Last Edited</p>
                        <p className="font-semibold">{formatPrDateTime(selectedPR.last_edited_at)}</p>
                      </div>
                    )}
                  </div>

                  <section className="mb-6 border-y border-[#E8DCC4] bg-white py-4" aria-labelledby="pr-trail-heading">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 id="pr-trail-heading" className="text-sm font-semibold uppercase tracking-wide text-[#4A3426]">
                          PR Trail
                        </h3>
                        <p className="text-xs text-[#7A6555]">
                          RFQ, PO, and receipt lifecycle linked to this requisition.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 border border-[#E8DCC4] md:grid-cols-3 xl:grid-cols-6">
                      <div className="border-b border-r border-[#E8DCC4] p-3 xl:border-b-0">
                        <p className="text-xs font-semibold uppercase text-[#7A6555]">Vendors Sent RFQ</p>
                        <p className="mt-1 text-xl font-bold text-[#2F241B]">{Number(selectedPR.rfq_summary?.sentCount || 0)}</p>
                      </div>
                      <div className="border-b border-r border-[#E8DCC4] p-3 xl:border-b-0">
                        <p className="text-xs font-semibold uppercase text-[#7A6555]">RFQ Responses</p>
                        <p className="mt-1 text-xl font-bold text-[#2F241B]">{Number(selectedPR.rfq_summary?.receivedCount || 0)}</p>
                        <p className="text-xs text-[#7A6555]">of {Number(selectedPR.rfq_summary?.total || 0)} requests</p>
                      </div>
                      <div className="border-b border-r border-[#E8DCC4] p-3 xl:border-b-0">
                        <p className="text-xs font-semibold uppercase text-[#7A6555]">POs Created</p>
                        <p className="mt-1 text-xl font-bold text-[#2F241B]">{Number(selectedPR.po_summary?.total || 0)}</p>
                        <p className="text-xs text-[#7A6555]">{Number(selectedPR.po_summary?.approvedCount || 0)} approved</p>
                      </div>
                      <div className="border-b border-r border-[#E8DCC4] p-3 md:border-b-0">
                        <p className="text-xs font-semibold uppercase text-[#7A6555]">GRNs Created</p>
                        <p className="mt-1 text-xl font-bold text-[#2F241B]">{Number(selectedPR.po_summary?.grnCount || 0)}</p>
                        <p className="text-xs text-[#7A6555]">{Number(selectedPR.po_summary?.completedGrnCount || 0)} completed</p>
                      </div>
                      <div className="border-r border-[#E8DCC4] p-3">
                        <p className="text-xs font-semibold uppercase text-[#7A6555]">Ordered Qty</p>
                        <p className="mt-1 text-xl font-bold text-[#2F241B]">
                          {Number(selectedPR.po_summary?.totalOrderedQty || 0).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="p-3">
                        <p className="text-xs font-semibold uppercase text-[#7A6555]">Goods Received</p>
                        <p className="mt-1 text-xl font-bold text-[#2F241B]">
                          {Number(selectedPR.po_summary?.totalReceivedQty || 0).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                    {((selectedPR.po_summary?.poNumbers || []).length > 0 || (selectedPR.po_summary?.grnNumbers || []).length > 0) && (
                      <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                        {(selectedPR.po_summary?.poNumbers || []).length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase text-[#7A6555]">PO References</p>
                            <p className="text-[#2F241B]">{(selectedPR.po_summary?.poNumbers || []).join(', ')}</p>
                          </div>
                        )}
                        {(selectedPR.po_summary?.grnNumbers || []).length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase text-[#7A6555]">GRN References</p>
                            <p className="text-[#2F241B]">{(selectedPR.po_summary?.grnNumbers || []).join(', ')}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  <section className="mb-6 border-y border-[#E8DCC4] bg-white py-4" aria-labelledby="rfq-trail-heading">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 id="rfq-trail-heading" className="text-sm font-semibold uppercase tracking-wide text-[#4A3426]">
                          RFQ Vendor Trail
                        </h3>
                        <p className="text-xs text-[#7A6555]">
                          Vendors contacted, RFQ status, response due date, and line items included.
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-[#7A6555]">{rfqHistory.length} vendor record{rfqHistory.length === 1 ? '' : 's'}</span>
                    </div>
                    {rfqHistory.length > 0 ? (
                      <div className="overflow-x-auto border border-[#E8DCC4]">
                        <table className="min-w-[1280px] w-full text-sm">
                          <thead className="bg-[#F5EFE3] text-[#4A3426]">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold">RFQ</th>
                              <th className="px-3 py-2 text-left font-semibold">Vendor</th>
                              <th className="px-3 py-2 text-left font-semibold">Email</th>
                              <th className="px-3 py-2 text-left font-semibold">Status</th>
                              <th className="px-3 py-2 text-left font-semibold">Sent</th>
                              <th className="px-3 py-2 text-left font-semibold">Due</th>
                              <th className="px-3 py-2 text-left font-semibold">Received</th>
                              <th className="px-3 py-2 text-left font-semibold">Items</th>
                              <th className="px-3 py-2 text-left font-semibold">Quote Summary</th>
                              <th className="px-3 py-2 text-left font-semibold">Files</th>
                              <th className="px-3 py-2 text-right font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rfqHistory.map((rfq) => {
                              const isReceived = String(rfq.status || '').toUpperCase() === 'RECEIVED';
                              const quoteLines = Array.isArray(rfq.rfq_items)
                                ? rfq.rfq_items
                                    .map((item) => {
                                      const price = item.vendor_quoted_price == null ? '' : `Rs. ${Number(item.vendor_quoted_price).toLocaleString('en-IN')}`;
                                      const leadTime = item.vendor_quoted_lead_time == null ? '' : `${item.vendor_quoted_lead_time} days`;
                                      return [item.item_code || item.item_name || 'Item', price, leadTime].filter(Boolean).join(' - ');
                                    })
                                    .filter(Boolean)
                                : [];
                              return (
                                <tr key={rfq.id} className="border-t border-[#E8DCC4] align-top">
                                  <td className="px-3 py-2 font-semibold text-[#2F241B]">{rfq.rfq_number || '-'}</td>
                                  <td className="px-3 py-2">{rfq.vendor?.name || '-'}</td>
                                  <td className="px-3 py-2">{rfq.vendor?.email || (rfq as any)?.meta?.recipientEmail || '-'}</td>
                                  <td className="px-3 py-2">
                                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                                      isReceived ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-[#D8C8AA] text-[#4A3426]'
                                    }`}>
                                      {String(rfq.status || '-').toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2">{rfq.sent_at ? formatPrDateTime(rfq.sent_at) : '-'}</td>
                                  <td className="px-3 py-2">{rfq.response_deadline ? formatPrDate(rfq.response_deadline) : '-'}</td>
                                  <td className="px-3 py-2">{rfq.vendor_quote_received_at ? formatPrDateTime(rfq.vendor_quote_received_at) : '-'}</td>
                                  <td className="px-3 py-2">
                                    {Array.isArray(rfq.rfq_items) && rfq.rfq_items.length > 0
                                      ? rfq.rfq_items.map((item) => item.item_code || item.item_name || 'Item').join(', ')
                                      : '-'}
                                  </td>
                                  <td className="px-3 py-2">
                                    {isReceived ? (
                                      <div className="space-y-1">
                                        {quoteLines.length > 0 ? (
                                          quoteLines.map((line, index) => <div key={`${rfq.id}-quote-${index}`}>{line}</div>)
                                        ) : (
                                          <div>Response recorded</div>
                                        )}
                                        {rfq.response_remarks ? <div className="text-xs text-[#7A6555]">{rfq.response_remarks}</div> : null}
                                      </div>
                                    ) : (
                                      <span className="text-[#7A6555]">Awaiting vendor quote</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {Array.isArray(rfq.response_attachments) && rfq.response_attachments.length > 0
                                      ? `${rfq.response_attachments.length} file${rfq.response_attachments.length === 1 ? '' : 's'}`
                                      : '-'}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <ErpButton
                                      type="button"
                                      size="sm"
                                      variant={isReceived ? 'secondary' : 'primary'}
                                      onClick={() => openRfqResponseEditor(rfq)}
                                      className="whitespace-nowrap"
                                    >
                                      <Edit className="h-4 w-4" />
                                      {isReceived ? 'Edit Response' : 'Record Response'}
                                    </ErpButton>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="border border-dashed border-[#D8C8AA] bg-[#FAF9F6] px-4 py-3 text-sm text-[#7A6555]">
                        No RFQ has been sent for this PR yet. Click <span className="font-semibold text-[#4A3426]">Send RFQ</span>, select the vendor(s) against the items, preview the email, and send. Once sent, this section becomes the vendor-wise RFQ sent register and shows <span className="font-semibold text-[#4A3426]">Record Response</span>.
                      </div>
                    )}
                  </section>

                  {(approvalHistory.length > 0 || selectedPR.rejection_reason) && (
                    <section className="mb-6 border-y border-[#E8DCC4] bg-white py-4" aria-labelledby="approval-history-heading">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 id="approval-history-heading" className="text-sm font-semibold text-[#4A3426]">Approval History</h3>
                        <span className="text-xs text-[#7A6555]">Current level {Number(selectedPR.current_approval_level || 0) + (selectedPR.status === 'SUBMITTED' ? 1 : 0)}</span>
                      </div>
                      <ol className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        {approvalHistory.map((entry) => (
                          <li key={entry.id} className="border-l-2 border-[#D8C8AA] pl-3">
                            <p className="text-sm font-semibold text-[#4A3426]">{entry.action.replaceAll('_', ' ')}</p>
                            <p className="text-xs text-[#7A6555]">{entry.actor_name} · {formatPrDateTime(entry.created_at)}</p>
                            {entry.reason ? <p className="mt-1 whitespace-pre-wrap text-sm text-red-700">{entry.reason}</p> : null}
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}

                  {/* Items Table */}
                  <div className="mb-6">
                    <h3 className="text-lg font-bold mb-3">Items</h3>
                    <div className="border rounded-lg overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-[#F5EFE3]">
                          <tr>
                            <th className="px-4 py-2 text-center text-sm font-semibold">S.No</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">SAS Part Number</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Item Name</th>
                            {rfqPanelOpen && <th className="px-4 py-2 text-left text-sm font-semibold">Vendors (Select Multiple)</th>}
                            <th className="px-4 py-2 text-right text-sm font-semibold">Requested</th>
                            <th className="px-4 py-2 text-center text-sm font-semibold">UOM</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold">Ordered</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold">Remaining</th>
                            <th className="px-4 py-2 text-center text-sm font-semibold">Status</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold">Est. Rate</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold">Total</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Delivery Date</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold">Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPR.purchase_requisition_items && selectedPR.purchase_requisition_items.length > 0 ? (
                            selectedPR.purchase_requisition_items.map((item, index) => {
                              const preferredVendorId = preferredVendorByPrItemId[item.id] || String(item.vendor_id || '');
                              return (
                              <tr key={item.id} className="border-t">
                                <td className="px-4 py-2 text-sm text-center">{item.serial_no || index + 1}</td>
                                <td className="px-4 py-2 text-sm">{item.item_code || '-'}</td>
                                <td className="px-4 py-2 text-sm">{item.item_name}</td>
                                {rfqPanelOpen && (
                                  <td className="px-4 py-2">
                                    <div className="space-y-2 min-w-[260px]">
                                      <SearchableSelect
                                        value={rfqVendorDrafts[item.id] || ''}
                                        onChange={(value) => addItemVendor(item.id, String(value || ''))}
                                        options={rfqVendors
                                          .filter((vendor) => !(rfqItemVendors[item.id] || []).includes(vendor.id))
                                          .map((vendor) => ({
                                            value: vendor.id,
                                            label: vendor.name,
                                            subtitle: preferredVendorId === vendor.id
                                              ? `${vendor.email || 'No email'} - Preferred vendor`
                                              : (vendor.email || vendor.code || ''),
                                          }))}
                                        placeholder="Search vendor..."
                                        disabled={rfqVendors.filter((vendor) => !(rfqItemVendors[item.id] || []).includes(vendor.id)).length === 0}
                                      />
                                      {(rfqItemVendors[item.id] || []).length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                          {(rfqItemVendors[item.id] || []).map((vendorId) => {
                                            const vendor = rfqVendors.find((entry) => entry.id === vendorId);
                                            if (!vendor) return null;
                                            const isPreferred = preferredVendorId === vendor.id;
                                            return (
                                              <span
                                                key={vendor.id}
                                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${isPreferred ? 'border-[#CDBB9D] bg-[#FAF6EE] text-[#5E4635]' : 'border-[#E8DCC4] bg-[#FAF9F6] text-[#5E4635]'}`}
                                              >
                                                <span>{vendor.name}</span>
                                                {isPreferred && <span>(Preferred)</span>}
                                                <button
                                                  type="button"
                                                  onClick={() => removeItemVendor(item.id, vendor.id)}
                                                  className="text-[#7A6555] hover:text-[#4A3426]"
                                                  aria-label={`Remove ${vendor.name}`}
                                                >
                                                  x
                                                </button>
                                              </span>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-[#7A6555]">No vendors selected yet.</p>
                                      )}
                                    </div>
                                  </td>
                                )}
                                <td className="px-4 py-2 text-sm text-right">{item.requested_qty}</td>
                                <td className="px-4 py-2 text-sm text-center">{resolveUomForPRDetailItem(item)}</td>
                                <td className="px-4 py-2 text-sm text-right">{item.total_ordered_qty || 0}</td>
                                <td className="px-4 py-2 text-sm text-right font-medium text-blue-700">{item.remaining_qty ?? item.requested_qty}</td>
                                <td className="px-4 py-2 text-center">
                                  {item.po_conversion_status === 'COMPLETED' && (
                                    <span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">DONE</span>
                                  )}
                                  {item.po_conversion_status === 'PARTIAL' && (
                                    <span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">PARTIAL</span>
                                  )}
                                  {(!item.po_conversion_status || item.po_conversion_status === 'PENDING') && (
                                    <span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-[#F5EFE3] text-[#7A6555]">PENDING</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-sm text-right">₹{(item.estimated_rate || 0).toFixed(2)}</td>
                                <td className="px-4 py-2 text-sm text-right font-semibold">₹{((item.requested_qty || 0) * (item.estimated_rate || 0)).toFixed(2)}</td>
                                <td className="px-4 py-2 text-sm font-medium text-[#5E4635]">
                                  {item.required_date ? formatDateInputDisplay(String(item.required_date).slice(0, 10)) : '-'}
                                </td>
                                <td className="px-4 py-2 text-sm text-[#7A6555]">{item.remarks || '-'}</td>
                              </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={rfqPanelOpen ? 14 : 13} className="px-4 py-8 text-center text-[#7A6555]">
                                No items found in this requisition
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {selectedPR.purchase_requisition_items && selectedPR.purchase_requisition_items.length > 0 && (
                          <tfoot className="bg-[#FAF9F6] border-t-2">
                            <tr>
                              <td colSpan={rfqPanelOpen ? 12 : 11} className="px-4 py-3 text-right font-bold">Total Amount:</td>
                              <td className="px-4 py-3 text-right font-bold text-lg">
                                ₹{selectedPR.purchase_requisition_items.reduce((sum, item) => sum + ((item.requested_qty || 0) * (item.estimated_rate || 0)), 0).toFixed(2)}
                              </td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>



                  {selectedPR.status !== 'DRAFT' && selectedPR.status !== 'REJECTED' && rfqPanelOpen && (
                    <div className="mt-4 p-4 bg-[#FAF9F6] rounded-lg border">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-[#4A3426]">Send RFQ to Vendors</h3>
                        <button
                          onClick={() => setRfqPanelOpen(false)}
                          className="text-[#7A6555] hover:text-[#4A3426] font-medium"
                        >
                          Hide
                        </button>
                      </div>

                      <div className="mb-3 text-sm text-[#7A6555]">
                        Select vendors by typing part of the vendor name, similar to PO creation. Preferred vendors stay highlighted.
                      </div>

                      {rfqLoadingVendors && (
                        <p className="text-sm text-[#7A6555]">Loading vendors...</p>
                      )}

                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <label className="block text-xs font-semibold text-[#5E4635] mb-1">Expected Response Date (optional)</label>
                          <DateInput
                            min={todayDate}
                            value={normalizeDateInputValue(rfqResponseDate)}
                            onChange={(value) => setRfqResponseDate(normalizeDateInputValue(value))}
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#5E4635] mb-1">Remarks (optional)</label>
                          <input
                            type="text"
                            value={rfqRemarks}
                            onChange={(e) => setRfqRemarks(e.target.value)}
                            placeholder="Any notes to vendor"
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 mt-3">
                        <button
                          onClick={() => handlePreviewRFQ()}
                          disabled={rfqLoadingVendors || rfqPreviewLoading}
                          className={`px-6 py-2 rounded-lg transition-colors ${
                            rfqLoadingVendors || rfqPreviewLoading
                              ? 'bg-[#D8C8AA] text-[#7A6555]'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          {rfqPreviewLoading ? 'Generating...' : 'Preview Email'}
                        </button>
                      </div>
                    </div>
                  )}

                  </div>
                </>
              ) : (
                <div className="p-8 text-center">
                  <p className="text-[#7A6555]">No data available</p>
                  <button
                    onClick={() => setShowDetailModal(false)}
                    className="mt-4 px-6 py-2 bg-[#D8C8AA] text-[#5E4635] rounded-lg hover:bg-[#9A8878] transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

        {showRfqResponses && selectedPR && (
          <div className="fixed inset-0 bg-[#4A3426]/45 flex items-center justify-center z-[2000] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full w-full max-w-none max-h-[90vh] overflow-hidden flex flex-col">
              <div className="border-b px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-[#4A3426]">RFQ Responses</h2>
                  <p className="text-sm text-[#7A6555] mt-1">PR Number: {selectedPR.pr_number}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRfqResponses(false)}
                  className="text-[#7A6555] hover:text-[#5E4635] text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-4 rounded-lg bg-[#FAF9F6] border border-[#E8DCC4] px-4 py-3 text-sm text-[#5E4635]">
                  Use <span className="font-semibold">Record Response</span> to enter the vendor quote, lead time, remarks, follow-up date, and attachments for each RFQ.
                </div>

                {loadingRfqHistory ? (
                  <p className="text-sm text-[#7A6555]">Loading RFQ responses...</p>
                ) : rfqHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#D8C8AA] bg-[#FAF9F6] p-5 text-sm text-[#7A6555]">
                    <p className="font-semibold text-[#4A3426]">No RFQ has been sent for this PR yet.</p>
                    <p className="mt-1">Send the RFQ first. After that, every vendor contacted appears here with sent date, email, status, and a Record Response action.</p>
                    <button
                      type="button"
                      onClick={async () => {
                        setShowRfqResponses(false);
                        setRfqPanelOpen(true);
                        if (rfqVendors.length === 0) await fetchRFQVendors();
                        if (selectedPR) await fetchPreferredVendorsForPR(selectedPR);
                      }}
                      className="mt-3 rounded-lg bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                    >
                      Open Send RFQ
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-white border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left">RFQ</th>
                          <th className="px-3 py-2 text-left">Vendor</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-left">Sent</th>
                          <th className="px-3 py-2 text-left">Received</th>
                          <th className="px-3 py-2 text-left">Follow-up</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rfqHistory.map((rfq) => (
                          <tr key={rfq.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2 font-medium text-[#4A3426]">{rfq.rfq_number}</td>
                            <td className="px-3 py-2">
                              <div>{rfq.vendor?.name || 'Vendor'}</div>
                              <div className="text-xs text-[#7A6555]">{rfq.vendor?.email || '-'}</div>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                                String(rfq.status).toUpperCase() === 'RECEIVED'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-[#F5EFE3] text-[#5E4635]'
                              }`}>
                                {String(rfq.status || '').toUpperCase()}
                              </span>
                            </td>
                            <td className="px-3 py-2">{rfq.sent_at ? formatPrDate(rfq.sent_at) : '-'}</td>
                            <td className="px-3 py-2">{rfq.vendor_quote_received_at ? formatPrDate(rfq.vendor_quote_received_at) : '-'}</td>
                            <td className="px-3 py-2">{rfq.follow_up_date ? formatPrDate(rfq.follow_up_date) : '-'}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => openRfqResponseEditor(rfq)}
                                className="text-blue-600 hover:text-blue-900 font-medium"
                              >
                                {String(rfq.status).toUpperCase() === 'RECEIVED' ? 'Edit Response' : 'Record Response'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="border-t px-6 py-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowRfqResponses(false)}
                  className="px-6 py-2 bg-[#D8C8AA] text-[#5E4635] rounded-lg hover:bg-[#9A8878] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {editingRfqResponse && (
          <div className="fixed inset-0 bg-[#4A3426]/45 flex items-center justify-center z-[2100] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full w-full max-w-none max-h-[92vh] overflow-hidden flex flex-col">
              <div className="border-b px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-[#4A3426]">RFQ Response</h2>
                  <p className="text-sm text-[#7A6555] mt-1">
                    {editingRfqResponse.vendor?.name || 'Vendor'} · {editingRfqResponse.rfq_number}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRfqResponse(null)}
                  className="text-[#7A6555] hover:text-[#5E4635] text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-[#5E4635] mb-1">Response Remarks</label>
                    <textarea
                      rows={3}
                      value={rfqResponseForm.remarks}
                      onChange={(e) => setRfqResponseForm((prev) => ({ ...prev, remarks: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Summary from vendor"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#5E4635] mb-1">Follow-up Date</label>
                    <DateInput
                      min={todayDate}
                      value={rfqResponseForm.followUpDate}
                      onChange={(value) => setRfqResponseForm((prev) => ({ ...prev, followUpDate: value }))}
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#5E4635] mb-1">Follow-up Notes</label>
                    <textarea
                      rows={3}
                      value={rfqResponseForm.followUpNotes}
                      onChange={(e) => setRfqResponseForm((prev) => ({ ...prev, followUpNotes: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="Next action / reminder"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <label className="block text-sm font-semibold text-[#5E4635]">Response Attachments</label>
                    <label className="inline-flex items-center px-4 py-2 rounded-lg bg-[#5E4635] text-white hover:bg-[#5E4635] cursor-pointer text-sm">
                      {uploadingRfqAttachments ? 'Uploading...' : 'Upload Attachments'}
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => uploadRfqResponseFiles(e.target.files)}
                        disabled={uploadingRfqAttachments}
                      />
                    </label>
                  </div>
                  {rfqResponseForm.attachments.length === 0 ? (
                    <p className="text-sm text-[#7A6555]">No attachments uploaded yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {rfqResponseForm.attachments.map((attachment, index) => (
                        <div key={`${attachment.url}-${index}`} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm bg-[#FAF9F6]">
                          <a href={attachment.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-900 truncate pr-3">
                            {attachment.name}
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              setRfqResponseForm((prev) => ({
                                ...prev,
                                attachments: prev.attachments.filter((_, itemIndex) => itemIndex !== index),
                              }))
                            }
                            className="text-red-600 hover:text-red-900 font-medium"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm border rounded-lg overflow-hidden">
                    <thead className="bg-[#F5EFE3]">
                      <tr>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-right">Requested</th>
                        <th className="px-3 py-2 text-center">UOM</th>
                        <th className="px-3 py-2 text-right">Quoted Price</th>
                        <th className="px-3 py-2 text-right">Lead Time (days)</th>
                        <th className="px-3 py-2 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rfqResponseForm.items.map((item, index) => (
                        <tr key={`${item.prItemId}-${index}`} className="border-t">
                          <td className="px-3 py-2">
                            <div className="font-medium text-[#4A3426]">{item.itemCode || '-'}</div>
                            <div className="text-xs text-[#7A6555]">{item.itemName}</div>
                          </td>
                          <td className="px-3 py-2 text-right">{item.requestedQty}</td>
                          <td className="px-3 py-2 text-center">{item.uom}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.quotedPrice}
                              onChange={(e) =>
                                setRfqResponseForm((prev) => ({
                                  ...prev,
                                  items: prev.items.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, quotedPrice: e.target.value } : row,
                                  ),
                                }))
                              }
                              className="w-full border rounded px-3 py-2 text-right"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={item.leadTime}
                              onChange={(e) =>
                                setRfqResponseForm((prev) => ({
                                  ...prev,
                                  items: prev.items.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, leadTime: e.target.value } : row,
                                  ),
                                }))
                              }
                              className="w-full border rounded px-3 py-2 text-right"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={item.notes}
                              onChange={(e) =>
                                setRfqResponseForm((prev) => ({
                                  ...prev,
                                  items: prev.items.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, notes: e.target.value } : row,
                                  ),
                                }))
                              }
                              className="w-full border rounded px-3 py-2"
                              placeholder="Vendor comments"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border-t px-6 py-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingRfqResponse(null)}
                  className="px-6 py-2 bg-[#D8C8AA] text-[#5E4635] rounded-lg hover:bg-[#9A8878] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveRfqResponse}
                  disabled={savingRfqResponse}
                  className={`px-6 py-2 rounded-lg transition-colors ${
                    savingRfqResponse ? 'bg-[#D8C8AA] text-[#7A6555]' : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {savingRfqResponse ? 'Saving...' : 'Save RFQ Response'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RFQ Email Preview Modal */}
        {showRfqPreview && rfqPreviewData && (
          <div className="fixed inset-0 bg-[#4A3426]/45 flex items-center justify-center z-[2000] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full w-full max-w-none max-h-[95vh] overflow-auto">
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
                <h2 className="text-2xl font-bold text-[#4A3426]">RFQ Email Preview</h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowRfqPreview(false);
                    setRfqPreviewIndex(0);
                  }}
                  className="text-[#7A6555] hover:text-[#5E4635] text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-x-auto">
                {(() => {
                  const previews = Array.isArray(rfqPreviewData?.emailPreviews)
                    ? rfqPreviewData.emailPreviews
                    : [];
                  const current = previews[rfqPreviewIndex] || previews[0];
                  const recipientKey = String(current?.vendor_id || current?.to || '').trim();
                  const effectiveTo =
                    (recipientKey && typeof rfqRecipientOverrides[recipientKey] === 'string'
                      ? rfqRecipientOverrides[recipientKey]
                      : '') || String(current?.to || '');
                  const effectiveSubject =
                    (rfqSubjectOverride ? rfqSubjectOverride : String(current?.subject || '')) || '';

                  return (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-[900px]">
                        {/* Recipient list */}
                        <div className="md:col-span-1">
                          <h3 className="text-lg font-bold mb-2">Recipients</h3>
                          <div className="border rounded-lg overflow-hidden">
                            <div className="bg-[#FAF9F6] px-3 py-2 text-xs font-semibold text-[#5E4635]">
                              Select vendor
                            </div>
                            <div className="max-h-72 overflow-y-auto divide-y">
                              {previews.length === 0 ? (
                                <div className="p-3 text-sm text-[#7A6555]">No preview data available.</div>
                              ) : (
                                previews.map((p: any, idx: number) => {
                                  const active = idx === rfqPreviewIndex;
                                  return (
                                    <button
                                      key={`${String(p?.to || '')}-${idx}`}
                                      type="button"
                                      onClick={() => setRfqPreviewIndex(idx)}
                                      className={`w-full text-left px-3 py-2 hover:bg-[#FAF9F6] ${
                                        active ? 'bg-[#FAF6EE]' : ''
                                      }`}
                                    >
                                      <div className="text-sm font-semibold text-[#4A3426]">
                                        {p?.vendor_name || 'Vendor'}
                                      </div>
                                      <div className="text-xs text-[#7A6555]">{String(p?.to || '')}</div>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Email preview */}
                        <div className="md:col-span-2 space-y-3">
                          <h3 className="text-lg font-bold">Email</h3>
                          {!current ? (
                            <div className="bg-[#FAF9F6] p-4 rounded-lg text-sm text-[#5E4635]">
                              Select a recipient to preview the email.
                            </div>
                          ) : (
                            <>
                              <div className="bg-[#FAF9F6] p-4 rounded-lg text-sm space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <label className="block">
                                    <span className="font-semibold">To</span>
                                    <input
                                      className="mt-1 w-full border rounded px-3 py-2"
                                      value={effectiveTo}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        if (!recipientKey) return;
                                        setRfqRecipientOverrides((prev) => {
                                          const next = { ...prev };
                                          if (!value.trim()) {
                                            delete next[recipientKey];
                                            return next;
                                          }
                                          next[recipientKey] = value;
                                          return next;
                                        });
                                      }}
                                      placeholder="vendor@email.com"
                                    />
                                  </label>

                                  <label className="block">
                                    <span className="font-semibold">Subject</span>
                                    <input
                                      className="mt-1 w-full border rounded px-3 py-2"
                                      value={effectiveSubject}
                                      onChange={(e) => setRfqSubjectOverride(e.target.value)}
                                      placeholder="Subject"
                                    />
                                  </label>
                                </div>

                                <label className="block">
                                  <span className="font-semibold">Message (optional)</span>
                                  <textarea
                                    className="mt-1 w-full border rounded px-3 py-2"
                                    rows={3}
                                    value={rfqCustomMessage}
                                    onChange={(e) => setRfqCustomMessage(e.target.value)}
                                    placeholder="Add a short note to the vendor..."
                                  />
                                </label>

                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handlePreviewRFQ({ keepIndex: rfqPreviewIndex })}
                                    disabled={rfqPreviewLoading}
                                    className={`px-4 py-2 rounded-lg transition-colors text-sm ${
                                      rfqPreviewLoading
                                        ? 'bg-[#D8C8AA] text-[#7A6555]'
                                        : 'bg-blue-600 text-white hover:bg-blue-700'
                                    }`}
                                  >
                                    {rfqPreviewLoading ? 'Updating...' : 'Update Preview'}
                                  </button>
                                </div>

                                <div>
                                  <span className="font-semibold">From:</span> {String(current?.from || '')}
                                </div>
                                {current?.replyTo && (
                                  <div>
                                    <span className="font-semibold">Reply-To:</span>{' '}
                                    {String(current.replyTo)}
                                  </div>
                                )}
                                {Array.isArray(current?.attachments) && current.attachments.length > 0 && (
                                  <div>
                                    <span className="font-semibold">Attachments:</span>{' '}
                                    {current.attachments.join(', ')}
                                  </div>
                                )}
                              </div>

                              <div className="border rounded-lg overflow-hidden bg-white">
                                <iframe
                                  title="RFQ Email Preview"
                                  className="w-full h-[65vh]"
                                  srcDoc={String(current?.html || '')}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Vendor-Item Assignment Summary (selection aid) */}
                      <div className="overflow-x-auto">
                        <h3 className="text-lg font-bold mb-2">Vendor Assignment Summary</h3>
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                          {rfqPreviewData.vendors.map((vendor: Vendor) => {
                            const vendorItems = rfqPreviewData.itemVendors.filter((iv: any) =>
                              iv.vendorIds.includes(vendor.id),
                            );
                            return (
                              <div key={vendor.id} className="mb-3 last:mb-0">
                                <p className="font-semibold text-sm">{vendor.name}:</p>
                                <ul className="ml-4 text-sm text-[#5E4635]">
                                  {vendorItems.map((iv: any) => (
                                    <li key={iv.item.id}>
                                      • {iv.item.item_name} (Qty: {iv.item.requested_qty})
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowRfqPreview(false);
                    setRfqPreviewIndex(0);
                  }}
                  className="px-6 py-2 bg-[#D8C8AA] text-[#5E4635] rounded-lg hover:bg-[#9A8878] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendRFQ}
                  disabled={rfqSending}
                  className={`px-6 py-2 rounded-lg transition-colors ${
                    rfqSending
                      ? 'bg-[#D8C8AA] text-[#7A6555]'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {rfqSending ? 'Sending...' : 'Confirm & Send RFQ Email'}
                </button>
              </div>
            </div>
          </div>
        )}
        <RndTemporaryItemModal
          open={showRndTemporaryItem}
          vendors={rfqVendors.map((vendor) => ({ id: vendor.id, name: vendor.name, code: vendor.code }))}
          onClose={() => setShowRndTemporaryItem(false)}
          onCreated={handleRndTemporaryItemCreated}
        />
      </div>
    </div>
  );
}

export default function PurchaseRequisitionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#7A6555]">Loading purchase requisitions...</div>}>
      <PRContent />
    </Suspense>
  );
}

