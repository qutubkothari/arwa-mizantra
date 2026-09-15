'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../lib/api-client';
import SearchableSelect from '../../../components/SearchableSelect';
import DateInput from '../../../components/ui/DateInput';
import DuplicateWarning, { useDuplicateDetection } from '../../../components/DuplicateWarning';
import { getTodayDateInputValue } from '@/lib/date';
import { buildDocumentBranding, renderStandardLetterheadHtml } from '@/lib/document-branding';
import { confirmDialog } from '../../../components/ui/ConfirmDialog';
import { hasModulePermission, readStoredUser, type StoredUser } from '@/lib/rbac';
import { useEscapeKey } from '../../../hooks/useEscapeKey';
import { useRegionalProfile } from '../../../hooks/useRegionalProfile';
import { formatRegionalCurrency } from '@/lib/market-profile';
import {
  Briefcase,
  CheckCircle,
  Download,
  Eye,
  Mail,
  MessageSquare,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  ReceiptIndianRupee,
  RotateCcw,
  Send,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';

type TabType = 'customers' | 'quotations' | 'orders' | 'fulfilment' | 'dispatch' | 'billing' | 'collections' | 'returns' | 'warranties';

interface Customer {
  id: string;
  customer_code: string;
  customer_name: string;
  customer_type: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  gst_number?: string;
  pan_number?: string;
  billing_address?: string;
  shipping_address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  credit_limit: number;
  credit_days: number;
  is_active: boolean;
  sales_blocked?: boolean;
  delivery_blocked?: boolean;
  billing_blocked?: boolean;
  block_reason?: string;
  tax_treatment?: string;
  contacts?: CustomerContact[];
  billing_addresses?: string[];
  shipping_addresses?: string[];
}

interface CustomerContact {
  name: string;
  mobile: string;
  email: string;
}

interface CustomerAccountStatement {
  customer: Customer;
  period: { from: string; to: string };
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  current_outstanding: number;
  ageing: Array<{ bucket: string; amount: number }>;
  open_invoices: Array<{ id: string; invoice_number: string; source: 'SALES' | 'SERVICE'; balance_amount: number; days_overdue: number }>;
  dunning_notices: Array<{
    id: string;
    notice_number: string;
    notice_date: string;
    dunning_level: number;
    due_by: string;
    overdue_amount: number;
    total_outstanding: number;
    status: string;
    notes?: string;
    cancellation_reason?: string;
  }>;
  transactions: Array<{
    date: string;
    source: 'SALES' | 'SERVICE';
    document_type: string;
    document_number: string;
    reference?: string;
    debit: number;
    credit: number;
    balance: number;
    remarks?: string;
  }>;
}

interface DunningNoticeDetail {
  id: string;
  notice_number: string;
  notice_date: string;
  dunning_level: number;
  due_by: string;
  overdue_amount: number;
  total_outstanding: number;
  status: string;
  notes?: string;
  cancellation_reason?: string;
  customer: Customer;
  invoice_snapshot: Array<{
    source: 'SALES' | 'SERVICE';
    invoice_id: string;
    invoice_number: string;
    invoice_date: string;
    due_date?: string;
    days_overdue: number;
    balance_amount: number;
  }>;
}

interface QuotationItem {
  id?: string;
  item_id: string;
  item_description: string;
  quantity: number;
  converted_quantity?: number;
  pending_quantity?: number;
  unit_price: number;
  discount_percentage: number;
  tax_percentage: number;
  line_total?: number;
  ordered_uom?: string;
  sales_quantity?: number;
  base_uom?: string;
  uom_conversion_factor?: number;
  price_uom?: string;
  hsn_code?: string;
  promised_date?: string;
  photos?: QuotationPhoto[];
}

interface QuotationPhoto {
  url: string;
  name: string;
  type?: string;
  size?: number;
}

interface Quotation {
  id: string;
  quotation_number: string;
  customer_id: string;
  customer_name?: string;
  quotation_date: string;
  valid_until: string;
  status: string;
  total_amount: number;
  discount_amount: number;
  tax_amount: number;
  net_amount: number;
  payment_terms?: string;
  delivery_terms?: string;
  currency_code?: string;
  place_of_supply?: string;
  incoterm?: string;
  customer_reference?: string;
  terms_conditions?: string;
  revision_no?: number;
  revised_from_quotation_id?: string;
  revised_from_quotation?: { id: string; quotation_number: string; revision_no?: number; status: string } | null;
  revised_to_quotation?: { id: string; quotation_number: string; revision_no?: number; status: string } | null;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejected_reason?: string;
  created_at: string;
  quotation_items?: QuotationItem[];
}

interface SalesOrder {
  id: string;
  so_number: string;
  customer_id: string;
  customer_name?: string;
  order_date: string;
  expected_delivery_date?: string;
  status: string;
  total_amount: number;
  net_amount: number;
  advance_paid: number;
  balance_amount: number;
  project?: string;
  is_direct_order?: boolean;
  source_type?: 'QUOTATION' | 'DIRECT' | 'INTERNAL';
  customer_po_number?: string;
  customer_po_date?: string;
  currency_code?: string;
  place_of_supply?: string;
  incoterm?: string;
  release_status?: string;
  credit_status?: string;
  availability_status?: string;
  delivery_block?: boolean;
  billing_block?: boolean;
  block_reason?: string;
  created_at: string;
}

interface DispatchNote {
  id: string;
  dn_number: string;
  sales_order_id: string;
  so_number?: string;
  customer_id: string;
  customer_name?: string;
  dispatch_date: string;
  transporter_name?: string;
  vehicle_number?: string;
  lr_number?: string;
  status?: string;
  delivered_at?: string;
  delivered_to_name?: string;
  delivered_to_mobile?: string;
  proof_of_delivery_url?: string;
  proof_of_delivery_name?: string;
  created_at: string;
}

interface FulfilmentTask {
  id: string;
  task_number: string;
  sales_order_id: string;
  planned_dispatch_date: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'PLANNED' | 'PICKING' | 'PICKED' | 'PACKED' | 'READY_TO_DISPATCH' | 'DISPATCHED' | 'CANCELLED';
  notes?: string;
  sales_order?: SalesOrder & { customer?: Customer };
  warehouse?: Warehouse;
  items?: Array<{
    id: string;
    sales_order_item_id: string;
    item_id: string;
    planned_quantity: number;
    picked_quantity: number;
    packed_quantity: number;
    batch_number?: string;
    storage_bin?: string;
  }>;
  created_at: string;
}

interface SalesInvoice {
  id: string;
  dispatch_note_id?: string;
  invoice_number: string;
  invoice_date: string;
  due_date?: string;
  net_amount: number;
  paid_amount: number;
  credited_amount?: number;
  balance_amount: number;
  payment_status: string;
  billing_status?: string;
  customer?: { customer_code?: string; customer_name?: string };
  sales_order?: { so_number?: string };
  dispatch_note?: { dn_number?: string };
  items?: any[];
  payments?: any[];
  credit_notes?: any[];
  days_overdue?: number;
  ageing_bucket?: string;
  collection_status?: string;
  next_follow_up_date?: string;
  promise_to_pay_date?: string;
  collection_notes?: string;
  source?: 'SALES' | 'SERVICE';
  customer_id?: string;
  status?: string;
  latest_dunning?: { id: string; notice_number: string; dunning_level: number; notice_date: string; due_by: string; status: string } | null;
  follow_up_due?: boolean;
  broken_promise?: boolean;
  last_follow_up_at?: string;
  irn?: string;
  irn_ack_number?: string;
  irn_ack_date?: string;
  eway_bill_number?: string;
  eway_bill_date?: string;
  eway_bill_valid_until?: string;
  statutory_status?: 'PENDING' | 'RECORDED' | 'NOT_APPLICABLE';
  statutory_exemption_reason?: string;
}

interface CollectionsWorklist {
  as_of: string;
  summary: { open_items: number; total_outstanding: number; overdue_outstanding: number; follow_ups_due: number; broken_promises: number };
  items: SalesInvoice[];
}

interface Warehouse { id: string; code?: string; name?: string; is_active?: boolean; }
interface SalesReturn {
  id: string;
  return_number: string;
  return_date: string;
  status: string;
  reason?: string;
  customer_reference?: string;
  customer?: { customer_code?: string; customer_name?: string };
  invoice?: { invoice_number?: string };
  items?: Array<{ id: string; item_description?: string; quantity: number; qc_accepted_quantity?: number; qc_rejected_quantity?: number }>;
}

interface Warranty {
  id: string;
  warranty_number: string;
  uid: string;
  customer_name?: string;
  item_description?: string;
  warranty_start_date: string;
  warranty_duration_months: number;
  warranty_end_date: string;
  warranty_type: string;
  status: string;
  claim_count: number;
  created_at: string;
}

interface UIDRecord {
  id?: string;
  uid: string;
  entity_id: string;
  status: string;
  location?: string;
  grn_id?: string;
  created_at?: string;
}

const formatSalesAmount = (value: number | null | undefined) =>
  `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const formatIndianNumber = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('en-IN');

const registerShellClass = 'overflow-x-auto rounded-md border border-[#E8DCC4] bg-white';
const registerTableClass = 'min-w-[1180px] divide-y divide-[#E8DCC4]';
const registerHeadClass = 'bg-[#F6EFE2]';
const registerHeaderCellClass = 'px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]';
const registerBodyClass = 'divide-y divide-[#EFE5D2] bg-white';
const registerCellClass = 'whitespace-nowrap px-4 py-3 text-sm text-[#5C4738]';
const stickyFirstHeaderClass = 'sticky left-0 z-20 bg-[#F6EFE2] px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]';
const stickySecondHeaderClass = 'sticky left-[170px] z-20 bg-[#F6EFE2] px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]';
const stickyFirstCellClass = 'sticky left-0 z-10 w-[170px] whitespace-nowrap bg-inherit px-4 py-3 text-sm font-semibold text-[#8B6F47]';
const stickySecondCellClass = 'sticky left-[170px] z-10 min-w-[260px] bg-inherit px-4 py-3 text-sm';

function ActionIconButton({
  title,
  onClick,
  disabled,
  children,
  tone = 'neutral',
  type = 'button',
}: {
  title: string;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'danger' | 'warning';
  type?: 'button' | 'submit';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-green-200 text-green-700 hover:bg-green-50'
      : tone === 'danger'
        ? 'border-red-200 text-red-700 hover:bg-red-50'
        : tone === 'warning'
          ? 'border-[#E0C99F] text-[#8B5E16] hover:bg-[#FFF8EA]'
          : tone === 'primary'
            ? 'border-blue-200 text-blue-700 hover:bg-blue-50'
            : 'border-[#D9C9AD] text-[#6F4E37] hover:bg-[#F6EFE2]';

  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border bg-white transition ${toneClass} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function SalesPageContent() {
  const todayDate = getTodayDateInputValue();
  const searchParams = useSearchParams();
  const salesQuery = searchParams.toString();
  const { profile: regionalProfile, loading: regionalProfileLoading } = useRegionalProfile();
  const regionalCountry = regionalProfile.marketProfile === 'UAE' ? 'United Arab Emirates' : 'India';
  const formatSalesAmount = (value: number | null | undefined) => formatRegionalCurrency(value, regionalProfile);
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const canCreate = hasModulePermission(currentUser, 'Sales Management', 'create');
  const canEdit = hasModulePermission(currentUser, 'Sales Management', 'edit');
  const canDelete = hasModulePermission(currentUser, 'Sales Management', 'delete');
  const canApprove = hasModulePermission(currentUser, 'Sales Management', 'approve');
  const [activeTab, setActiveTab] = useState<TabType>('quotations');
  useEffect(() => {
    const requested = searchParams.get('tab') as TabType | null;
    const allowed: TabType[] = ['customers', 'quotations', 'orders', 'fulfilment', 'dispatch', 'billing', 'collections', 'returns', 'warranties'];
    if (requested && allowed.includes(requested)) setActiveTab(requested);
  }, [searchParams]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [fulfilmentTasks, setFulfilmentTasks] = useState<FulfilmentTask[]>([]);
  const [dispatches, setDispatches] = useState<DispatchNote[]>([]);
  const [deliveryConfirmation, setDeliveryConfirmation] = useState<DispatchNote | null>(null);
  const [deliveryProofUploading, setDeliveryProofUploading] = useState(false);
  const [deliveryConfirmationForm, setDeliveryConfirmationForm] = useState({
    delivery_date: getTodayDateInputValue(),
    delivery_time: new Date().toTimeString().slice(0, 5),
    delivered_to_name: '',
    delivered_to_mobile: '',
    notes: '',
    proof_file: null as File | null,
  });
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [collectionsWorklist, setCollectionsWorklist] = useState<CollectionsWorklist | null>(null);
  const [salesReturns, setSalesReturns] = useState<SalesReturn[]>([]);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [registerSearch, setRegisterSearch] = useState('');
  const [registerStatus, setRegisterStatus] = useState('ALL');
  const [availableUIDs, setAvailableUIDs] = useState<{ [key: string]: UIDRecord[] }>({});
  const [loadingUIDs, setLoadingUIDs] = useState<{ [key: number]: boolean }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingSOEmailId, setSendingSOEmailId] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<SalesInvoice | null>(null);
  const [statutoryInvoice, setStatutoryInvoice] = useState<SalesInvoice | null>(null);
  const [savingStatutoryDetails, setSavingStatutoryDetails] = useState(false);
  const [statutoryForm, setStatutoryForm] = useState({
    irn: '',
    irn_ack_number: '',
    irn_ack_date: '',
    eway_bill_number: '',
    eway_bill_date: '',
    eway_bill_valid_until: '',
    not_applicable: false,
    statutory_exemption_reason: '',
  });
  const [salesOrderFlow, setSalesOrderFlow] = useState<any>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<SalesInvoice | null>(null);
  const [collectionInvoice, setCollectionInvoice] = useState<SalesInvoice | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [accountStatement, setAccountStatement] = useState<CustomerAccountStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementPeriod, setStatementPeriod] = useState({ from: `${todayDate.slice(0, 4)}-01-01`, to: todayDate });
  const [showDunningForm, setShowDunningForm] = useState(false);
  const [viewingDunningNotice, setViewingDunningNotice] = useState<DunningNoticeDetail | null>(null);
  const [dunningDetailLoading, setDunningDetailLoading] = useState(false);
  const [dunningForm, setDunningForm] = useState({
    dunning_level: '1',
    due_by: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    notes: '',
  });
  const [collectionForm, setCollectionForm] = useState({ collection_status: 'CONTACTED', next_follow_up_date: '', promise_to_pay_date: '', notes: '' });
  const [creditInvoice, setCreditInvoice] = useState<SalesInvoice | null>(null);
  const [returnInvoice, setReturnInvoice] = useState<SalesInvoice | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnLines, setReturnLines] = useState<Record<string, string>>({});
  const [receivingReturn, setReceivingReturn] = useState<SalesReturn | null>(null);
  const [returnWarehouseId, setReturnWarehouseId] = useState('');
  const [qcReturn, setQcReturn] = useState<SalesReturn | null>(null);
  const [returnQcLines, setReturnQcLines] = useState<Record<string, string>>({});
  const [returnQcNotes, setReturnQcNotes] = useState('');
  const [receiptForm, setReceiptForm] = useState({
    amount: '',
    receipt_date: getTodayDateInputValue(),
    payment_method: 'NEFT',
    payment_reference: '',
    notes: '',
  });
  const [creditNoteForm, setCreditNoteForm] = useState({
    taxable_amount: '',
    tax_percentage: '0',
    credit_note_date: getTodayDateInputValue(),
    reason: '',
    external_reference: '',
  });

  useEffect(() => {
    setCurrentUser(readStoredUser());
  }, []);

  // Sales Order edit
  const [showOrderEditForm, setShowOrderEditForm] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderNumber, setEditingOrderNumber] = useState('');
  const [editingOrderItems, setEditingOrderItems] = useState<any[]>([]);
  const [orderEditForm, setOrderEditForm] = useState({
    expected_delivery_date: '',
    payment_terms: '',
    delivery_terms: '',
    notes: '',
    status: 'CONFIRMED',
    customer_po_number: '',
    customer_po_date: '',
    currency_code: regionalProfile.currency as string,
    place_of_supply: '',
    incoterm: '',
    delivery_block: false,
    billing_block: false,
    block_reason: '',
  });

  // Dispatch edit
  const [showDispatchEditForm, setShowDispatchEditForm] = useState(false);
  const [editingDispatchId, setEditingDispatchId] = useState<string | null>(null);
  const [dispatchEditForm, setDispatchEditForm] = useState({
    dispatch_date: '',
    transporter_name: '',
    vehicle_number: '',
    lr_number: '',
    lr_date: '',
    delivery_address: '',
    notes: '',
  });

  // Warranty edit
  const [showWarrantyEditForm, setShowWarrantyEditForm] = useState(false);
  const [editingWarrantyId, setEditingWarrantyId] = useState<string | null>(null);
  const [warrantyEditForm, setWarrantyEditForm] = useState({
    status: 'ACTIVE',
    warranty_type: 'STANDARD',
  });
  
  // Customer form
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [customerFormError, setCustomerFormError] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState({
    customer_name: '',
    customer_type: 'REGULAR',
    contact_person: '',
    email: '',
    phone: '',
    mobile: '',
    gst_number: '',
    pan_number: '',
    billing_address: '',
    shipping_address: '',
    city: '',
    state: '',
    country: regionalCountry,
    pincode: '',
    credit_limit: 0,
    credit_days: 30,
    sales_blocked: false,
    delivery_blocked: false,
    billing_blocked: false,
    block_reason: '',
    tax_treatment: 'REGISTERED',
    contacts: [{ name: '', mobile: '', email: '' }] as CustomerContact[],
    billing_addresses: [''],
    shipping_addresses: [''],
  });

  const resetCustomerForm = () => {
    setCustomerFormError(null);
    setEditingCustomerId(null);
    setCustomerForm({
      customer_name: '',
      customer_type: 'REGULAR',
      contact_person: '',
      email: '',
      phone: '',
      mobile: '',
      gst_number: '',
      pan_number: '',
      billing_address: '',
      shipping_address: '',
      city: '',
      state: '',
      country: regionalCountry,
      pincode: '',
      credit_limit: 0,
      credit_days: 30,
      sales_blocked: false,
      delivery_blocked: false,
      billing_blocked: false,
      block_reason: '',
      tax_treatment: 'REGISTERED',
      contacts: [{ name: '', mobile: '', email: '' }],
      billing_addresses: [''],
      shipping_addresses: [''],
    });
  };

  // Quotation form
  const createDefaultQuotationForm = (): {
    customer_id: string;
    quotation_date: string;
    valid_until: string;
    payment_terms: string;
    delivery_terms: string;
    notes: string;
    currency_code: string;
    place_of_supply: string;
    incoterm: string;
    customer_reference: string;
    terms_conditions: string;
    items: QuotationItem[];
  } => ({
    customer_id: '',
    quotation_date: getTodayDateInputValue(),
    valid_until: getTodayDateInputValue(),
    payment_terms: '',
    delivery_terms: '',
    notes: '',
    currency_code: regionalProfile.currency as string,
    place_of_supply: '',
    incoterm: '',
    customer_reference: '',
    terms_conditions: '',
    items: [] as QuotationItem[],
  });
  const [showQuotationForm, setShowQuotationForm] = useState(false);
  const [quotationForm, setQuotationForm] = useState(createDefaultQuotationForm);
  const quotationHandoffRef = useRef('');
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [viewingQuotation, setViewingQuotation] = useState<any | null>(null);
  const [rejectingQuotation, setRejectingQuotation] = useState<Quotation | null>(null);
  const [quotationRejectionReason, setQuotationRejectionReason] = useState('');
  const [quotationDecisionSaving, setQuotationDecisionSaving] = useState(false);
  const [quotationPhotoUploadingIndex, setQuotationPhotoUploadingIndex] = useState<number | null>(null);
  const [communicationQuotation, setCommunicationQuotation] = useState<any | null>(null);
  const [quotationActivities, setQuotationActivities] = useState<any[]>([]);
  const [quotationCommunicationSaving, setQuotationCommunicationSaving] = useState(false);
  const [quotationCommunicationForm, setQuotationCommunicationForm] = useState({ email: '', subject: '', message: '', follow_up_at: '' });

  // CRM handoff: open a new quotation with its converted customer and CRM
  // reference already selected. The ref prevents navigation events or React
  // remounts from reopening the same handoff.
  useEffect(() => {
    const params = new URLSearchParams(salesQuery);
    const customerId = params.get('customer') || '';
    const create = params.get('create');
    const crmLead = params.get('crmLead') || '';
    const crmRef = params.get('crmRef') || '';
    if (!canCreate || activeTab !== 'quotations' || create !== 'quotation' || !customerId) return;
    const handoffKey = `${customerId}:${crmLead || crmRef}`;
    if (quotationHandoffRef.current === handoffKey) return;
    quotationHandoffRef.current = handoffKey;

    void (async () => {
      try {
        const customerRows = customers.length
          ? customers
          : await apiClient.get<Customer[]>('/sales/customers');
        if (!customers.length) setCustomers(customerRows);
        if (!customerRows.some((customer) => customer.id === customerId)) {
          throw new Error('The CRM customer is not available in this organisation.');
        }
        setEditingQuotationId(null);
        setQuotationForm({
          ...createDefaultQuotationForm(),
          customer_id: customerId,
          customer_reference: crmRef,
          notes: crmRef ? `Prepared from CRM ${crmRef}.` : 'Prepared from CRM.',
        });
        setShowQuotationForm(true);
      } catch (err: any) {
        quotationHandoffRef.current = '';
        setError(err?.message || 'Unable to prepare the CRM quotation handoff.');
      }
    })();
  }, [activeTab, canCreate, salesQuery]);

  // Dispatch form
  const [showFulfilmentForm, setShowFulfilmentForm] = useState(false);
  const [fulfilmentOrder, setFulfilmentOrder] = useState<SalesOrder | null>(null);
  const [fulfilmentForm, setFulfilmentForm] = useState({
    planned_dispatch_date: getTodayDateInputValue(),
    warehouse_id: '',
    priority: 'NORMAL',
    notes: '',
    items: [] as Array<{ sales_order_item_id: string; item_id: string; description: string; quantity: number }>,
  });
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [selectedOrderForDispatch, setSelectedOrderForDispatch] = useState<SalesOrder | null>(null);
  const [salesOrderItems, setSalesOrderItems] = useState<any[]>([]);
  const [dispatchForm, setDispatchForm] = useState({
    sales_order_id: '',
    fulfilment_task_id: '',
    dispatch_date: getTodayDateInputValue(),
    transporter_name: '',
    vehicle_number: '',
    lr_number: '',
    lr_date: getTodayDateInputValue(),
    delivery_address: '',
    notes: '',
    items: [] as { sales_order_item_id: string; item_id: string; uid: string[]; quantity: number; batch_number?: string }[],
  });

  // Warranty form
  const [showWarrantyForm, setShowWarrantyForm] = useState(false);
  const [warrantyForm, setWarrantyForm] = useState({
    uid: '',
    warranty_duration_months: 12,
    warranty_type: 'STANDARD',
    notes: '',
  });

  // Duplicate detection hooks
  const customerDuplicateDetection = useDuplicateDetection();
  const quotationDuplicateDetection = useDuplicateDetection();
  const salesOrderDuplicateDetection = useDuplicateDetection();
  // React state is not a synchronous mutex: rapid clicks can enter the save
  // handler more than once before the disabled state is rendered. Keep a
  // ref-based lock around the actual write so one user action creates one row.
  const customerSaveInFlightRef = useRef(false);

  // Sales Order conversion
  const [showSOConversionForm, setShowSOConversionForm] = useState(false);
  const [selectedQuotationForSO, setSelectedQuotationForSO] = useState<Quotation | null>(null);
  const [soConversionForm, setSOConversionForm] = useState({
    expected_delivery_date: '',
    advance_amount: 0,
    payment_terms: '',
    special_instructions: '',
    project: '',
  });
  const [conversionItems, setConversionItems] = useState<{[key: string]: number}>({});

  // Direct Sales Order form
  const [showDirectSOForm, setShowDirectSOForm] = useState(false);
  const [directSOForm, setDirectSOForm] = useState({
    customer_id: '',
    order_date: getTodayDateInputValue(),
    expected_delivery_date: '',
    payment_terms: '',
    project: '',
    source_type: 'DIRECT' as 'DIRECT' | 'INTERNAL',
    customer_po_number: '',
    customer_po_date: '',
    currency_code: regionalProfile.currency as string,
    place_of_supply: '',
    incoterm: '',
    items: [] as QuotationItem[],
  });

  useEffect(() => {
    if (regionalProfileLoading) return;
    if (!editingCustomerId) {
      setCustomerForm((current) => ({
        ...current,
        country: !current.country || ['India', 'United Arab Emirates'].includes(current.country)
          ? regionalCountry
          : current.country,
      }));
    }
    if (!editingQuotationId) {
      setQuotationForm((current) => ({
        ...current,
        currency_code: !current.currency_code || ['INR', 'AED'].includes(current.currency_code)
          ? regionalProfile.currency
          : current.currency_code,
      }));
    }
    setDirectSOForm((current) => ({
      ...current,
      currency_code: !current.currency_code || ['INR', 'AED'].includes(current.currency_code)
        ? regionalProfile.currency
        : current.currency_code,
    }));
  }, [editingCustomerId, editingQuotationId, regionalCountry, regionalProfile, regionalProfileLoading]);

  const handlePrintQuotation = async (quotation: any) => {
    // Keep a writable WindowProxy while the branding request completes. Chrome
    // may return null when `noopener` is supplied, leaving an orphaned blank tab.
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing quotation...</body></html>');
      printWindow.document.close();
    }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString(regionalProfile.locale) : '-';
      const taxLabel = regionalProfile.taxLabel;
      const itemCodeLabel = regionalProfile.marketProfile === 'UAE' ? 'Commodity / Service Code' : 'HSN';
      const items = quotation.quotation_items || [];
      const itemRows = items.map((item: any, index: number) => {
        const photos = Array.isArray(item.photos) ? item.photos : [];
        const photoHtml = photos.length > 0
          ? `<div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">${photos.map((photo: any) => `<img style="width:48px;height:48px;object-fit:cover;border:1px solid #d1d5db;border-radius:3px" src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name || 'Product photo')}">`).join('')}</div>`
          : '';
        return `<tr><td>${index + 1}</td><td>${escapeHtml(item.item_description || '-')}<br><small>${itemCodeLabel}: ${escapeHtml(item.hsn_code || '-')}</small>${photoHtml}</td><td class="num">${escapeHtml(item.sales_quantity ?? item.quantity)} ${escapeHtml(item.ordered_uom || '')}</td><td class="num">${money(item.unit_price)} / ${escapeHtml(item.price_uom || item.ordered_uom || '')}</td><td class="num">${Number(item.discount_percentage || 0).toFixed(2)}%</td><td class="num">${Number(item.tax_percentage || 0).toFixed(2)}%</td><td class="num">${money(item.line_total)}</td></tr>`;
      }).join('');
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(quotation.quotation_number)}</title><style>@page{margin:.5cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;margin-bottom:16px}.meta div{padding:8px 10px;border-bottom:1px solid #e5e7eb}.meta div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:7px}th{background:#f3f4f6;text-align:left;font-size:9px;text-transform:uppercase}.num{text-align:right}.totals{margin:14px 0 0 auto;width:340px}.totals div{display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid #e5e7eb}.net{font-size:14px;font-weight:800}.terms{margin-top:22px;border-top:1px solid #d1d5db;padding-top:12px;white-space:pre-wrap}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>SALES QUOTATION</h1><div class="meta"><div><div class="label">Quotation No.</div><div class="value">${escapeHtml(quotation.quotation_number)}</div></div><div><div class="label">Status / Revision</div><div class="value">${escapeHtml(quotation.status || 'DRAFT')} / Rev. ${Number(quotation.revision_no || 0)}</div></div><div><div class="label">Quotation Date</div><div class="value">${date(quotation.quotation_date)}</div></div><div><div class="label">Valid Until</div><div class="value">${date(quotation.valid_until)}</div></div><div><div class="label">Customer</div><div class="value">${escapeHtml(quotation.customer_name || '-')}</div></div><div><div class="label">Revised From</div><div class="value">${escapeHtml(quotation.revised_from_quotation?.quotation_number || '-')}</div></div><div><div class="label">Payment Terms</div><div class="value">${escapeHtml(quotation.payment_terms || '-')}</div></div><div><div class="label">Delivery Terms</div><div class="value">${escapeHtml(quotation.delivery_terms || '-')}</div></div></div><table><thead><tr><th>No.</th><th>Item / Description</th><th>Qty</th><th>Rate</th><th>Discount</th><th>${taxLabel}</th><th>Amount</th></tr></thead><tbody>${itemRows || '<tr><td colspan="7">No items</td></tr>'}</tbody></table><div class="totals"><div><span>Gross Amount</span><strong>${money(quotation.total_amount)}</strong></div><div><span>Discount</span><strong>${money(quotation.discount_amount)}</strong></div><div class="net"><span>Net Amount</span><span>${money(quotation.net_amount)}</span></div></div>${quotation.terms_conditions || quotation.notes ? `<div class="terms"><strong>Terms & Notes</strong><br>${escapeHtml(quotation.terms_conditions || quotation.notes)}</div>` : ''}<div class="sign"><span>Prepared By</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this quotation as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) {
      if (printWindow) printWindow.close();
      alert(err?.message || 'Failed to prepare quotation document');
    }
  };

  const handlePrintSalesOrder = async (flow: any) => {
    // The generated document is written after an API call, so this window must
    // remain script-accessible until its final HTML has been installed.
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing sales order...</body></html>'); printWindow.document.close(); }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const order = flow?.sales_order || {};
      const customer = flow?.customer || order?.customers || {};
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString(regionalProfile.locale) : '-';
      const rows = (order.sales_order_items || []).map((item: any, index: number) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.item_description || '-')}</td><td class="num">${escapeHtml(item.sales_quantity ?? item.quantity)} ${escapeHtml(item.ordered_uom || '')}</td><td class="num">${money(item.unit_price)} / ${escapeHtml(item.price_uom || item.ordered_uom || '')}</td><td class="num">${money(item.discount_amount)}</td><td class="num">${money(item.tax_amount)}</td><td class="num">${money(item.line_total)}</td></tr>`).join('');
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(order.so_number)}</title><style>@page{margin:.5cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;margin-bottom:16px}.meta>div{padding:8px 10px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:7px}th{background:#f3f4f6;text-align:left;font-size:9px;text-transform:uppercase}.num{text-align:right}.totals{margin:14px 0 0 auto;width:340px}.totals div{display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid #e5e7eb}.net{font-size:14px;font-weight:800}.notes{margin-top:20px;white-space:pre-wrap}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>SALES ORDER</h1><div class="meta"><div><div class="label">Sales Order No.</div><div class="value">${escapeHtml(order.so_number)}</div></div><div><div class="label">Order Date</div><div class="value">${date(order.order_date)}</div></div><div><div class="label">Customer</div><div class="value">${escapeHtml(customer.customer_name || '-')}</div></div><div><div class="label">Expected Delivery</div><div class="value">${date(order.expected_delivery_date)}</div></div><div><div class="label">Project</div><div class="value">${escapeHtml(order.project || '-')}</div></div><div><div class="label">Status</div><div class="value">${escapeHtml(order.status || '-')}</div></div><div><div class="label">Payment Terms</div><div class="value">${escapeHtml(order.payment_terms || '-')}</div></div><div><div class="label">Delivery Terms</div><div class="value">${escapeHtml(order.delivery_terms || '-')}</div></div></div><table><thead><tr><th>No.</th><th>Item / Description</th><th>Qty</th><th>Rate</th><th>Discount</th><th>${regionalProfile.taxLabel}</th><th>Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No items</td></tr>'}</tbody></table><div class="totals"><div><span>Order Value</span><strong>${money(order.net_amount)}</strong></div><div><span>Advance</span><strong>${money(order.advance_amount)}</strong></div><div class="net"><span>Balance</span><span>${money(order.balance_amount)}</span></div></div>${order.notes ? `<div class="notes"><strong>Notes</strong><br>${escapeHtml(order.notes)}</div>` : ''}<div class="sign"><span>Customer Acceptance</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this sales order as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare sales order'); }
  };

  const downloadSalesDocumentPdf = async (endpoint: string, filename: string) => {
    try {
      const blob = await apiClient.getBlob(endpoint);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || 'Failed to download the sales document PDF');
    }
  };

  const handlePrintDispatchNote = async (dispatch: DispatchNote) => {
    // Keep the WindowProxy writable until the asynchronous document data has
    // been loaded. Chrome may return null for a noopener popup, leaving the
    // user on an orphaned about:blank tab.
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing dispatch note...</body></html>'); printWindow.document.close(); }
    try {
      const [company, flow] = await Promise.all([
        apiClient.get<any>('/tenant/current').catch(() => null),
        apiClient.get<any>(`/sales/orders/${dispatch.sales_order_id}/document-flow`),
      ]);
      const branding = buildDocumentBranding(company);
      const detail = (flow.dispatches || []).find((entry: any) => entry.id === dispatch.id) || dispatch;
      const order = flow.sales_order || {};
      const customer = flow.customer || {};
      const orderLines = new Map((order.sales_order_items || []).map((line: any) => [line.id, line]));
      const grouped = new Map<string, any>();
      for (const line of detail.items || []) {
        const key = String(line.sales_order_item_id || line.item_id || line.id);
        const current = grouped.get(key) || { ...line, quantity: 0, uids: [] as string[] };
        current.quantity += Number(line.quantity || 0);
        if (line.uid) current.uids.push(String(line.uid));
        grouped.set(key, current);
      }
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString('en-IN') : '-';
      const rows = [...grouped.values()].map((line: any, index: number) => {
        const orderLine: any = orderLines.get(line.sales_order_item_id);
        return `<tr><td>${index + 1}</td><td>${escapeHtml(orderLine?.item_description || line.item_description || line.item_id || '-')}</td><td class="num">${Number(line.quantity || 0).toLocaleString('en-IN')}</td><td>${escapeHtml((line.uids || []).join(', ') || '-')}</td></tr>`;
      }).join('');
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(detail.dn_number)}</title><style>@page{margin:.5cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;margin-bottom:16px}.meta>div{padding:8px 10px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:7px}th{background:#f3f4f6;text-align:left;font-size:9px;text-transform:uppercase}.num{text-align:right}.notes{margin-top:20px;white-space:pre-wrap}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString('en-IN'))}<h1>DELIVERY / DISPATCH NOTE</h1><div class="meta"><div><div class="label">Dispatch Note No.</div><div class="value">${escapeHtml(detail.dn_number)}</div></div><div><div class="label">Dispatch Date</div><div class="value">${date(detail.dispatch_date)}</div></div><div><div class="label">Sales Order</div><div class="value">${escapeHtml(order.so_number || dispatch.so_number || '-')}</div></div><div><div class="label">Customer</div><div class="value">${escapeHtml(customer.customer_name || dispatch.customer_name || '-')}</div></div><div><div class="label">Transporter</div><div class="value">${escapeHtml(detail.transporter_name || '-')}</div></div><div><div class="label">Vehicle / LR</div><div class="value">${escapeHtml([detail.vehicle_number, detail.lr_number].filter(Boolean).join(' / ') || '-')}</div></div><div><div class="label">Delivery Address</div><div class="value">${escapeHtml(detail.delivery_address || customer.shipping_address || customer.billing_address || '-')}</div></div><div><div class="label">Status</div><div class="value">${escapeHtml(String(detail.status || 'PGI_POSTED').replaceAll('_', ' '))}</div></div></div><table><thead><tr><th>No.</th><th>Item / Description</th><th>Dispatched Qty</th><th>UID / Serial Numbers</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No dispatch lines</td></tr>'}</tbody></table>${detail.notes ? `<div class="notes"><strong>Notes</strong><br>${escapeHtml(detail.notes)}</div>` : ''}<div class="sign"><span>Prepared / Dispatched By</span><span>Customer Receipt & Stamp</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this dispatch note as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare dispatch note'); }
  };

  const handlePrintCustomerInvoice = async (invoice: SalesInvoice) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing customer invoice...</body></html>'); printWindow.document.close(); }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString('en-IN') : '-';
      const taxable = (invoice.items || []).reduce((sum: number, line: any) => sum + Number(line.taxable_amount ?? (Number(line.line_total || 0) - Number(line.tax_amount || 0))), 0);
      const tax = (invoice.items || []).reduce((sum: number, line: any) => sum + Number(line.tax_amount || 0), 0);
      const rows = (invoice.items || []).map((line: any, index: number) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.item_description || line.item_id || '-')}</td><td class="num">${Number(line.sales_quantity ?? line.quantity ?? 0).toLocaleString('en-IN')} ${escapeHtml(line.ordered_uom || '')}</td><td class="num">${money(line.unit_price)} / ${escapeHtml(line.price_uom || line.ordered_uom || '')}</td><td class="num">${money(line.discount_amount)}</td><td class="num">${money(line.tax_percentage)}%</td><td class="num">${money(line.line_total)}</td></tr>`).join('');
      const customer: any = invoice.customer || {};
      const customerAddress = [customer.billing_address, customer.city, customer.state, customer.pincode].filter(Boolean).join(', ');
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(invoice.invoice_number)}</title><style>@page{margin:.5cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;margin-bottom:16px}.meta>div{padding:8px 10px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:7px}th{background:#f3f4f6;text-align:left;font-size:9px;text-transform:uppercase}.num{text-align:right}.totals{margin:14px 0 0 auto;width:360px}.totals div{display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid #e5e7eb}.net{font-size:14px;font-weight:800}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>TAX INVOICE</h1><div class="meta"><div><div class="label">Invoice No.</div><div class="value">${escapeHtml(invoice.invoice_number)}</div></div><div><div class="label">Invoice Date</div><div class="value">${date(invoice.invoice_date)}</div></div><div><div class="label">Customer</div><div class="value">${escapeHtml(customer.customer_name || '-')}</div></div><div><div class="label">Customer GSTIN</div><div class="value">${escapeHtml(customer.gst_number || '-')}</div></div><div><div class="label">Billing Address</div><div class="value">${escapeHtml(customerAddress || '-')}</div></div><div><div class="label">Due Date</div><div class="value">${date(invoice.due_date)}</div></div><div><div class="label">Sales Order</div><div class="value">${escapeHtml(invoice.sales_order?.so_number || '-')}</div></div><div><div class="label">Dispatch Note</div><div class="value">${escapeHtml(invoice.dispatch_note?.dn_number || '-')}</div></div></div><table><thead><tr><th>No.</th><th>Item / Description</th><th>Qty</th><th>Rate</th><th>Discount</th><th>${regionalProfile.taxLabel}</th><th>Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No invoice lines</td></tr>'}</tbody></table><div class="totals"><div><span>Taxable Value</span><strong>${money(taxable)}</strong></div><div><span>GST</span><strong>${money(tax)}</strong></div><div class="net"><span>Invoice Total</span><span>${money(invoice.net_amount)}</span></div><div><span>Received / Adjusted</span><strong>${money(Number(invoice.paid_amount || 0) + Number(invoice.credited_amount || 0))}</strong></div><div><span>Outstanding</span><strong>${money(invoice.balance_amount)}</strong></div></div><div class="sign"><span>Customer Acknowledgement</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this customer invoice as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare customer invoice'); }
  };

  const handlePrintCustomerReceipt = async (invoice: SalesInvoice, payment: any) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing receipt voucher...</body></html>'); printWindow.document.close(); }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString('en-IN') : '-';
      const customer: any = invoice.customer || {};
      const status = payment.reversed_at ? 'REVERSED' : 'POSTED';
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(payment.receipt_number)}</title><style>@page{margin:.7cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.status{text-align:center;font-weight:800;color:${payment.reversed_at ? '#b91c1c' : '#166534'};margin-top:-12px;margin-bottom:18px}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db}.meta>div{padding:10px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:4px}.amount{margin:22px 0;border:2px solid #374151;padding:18px;text-align:center}.amount .label{font-size:10px}.amount .value{font-size:24px}.notes{margin-top:18px;border:1px solid #d1d5db;padding:12px}.sign{display:flex;justify-content:space-between;margin-top:60px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>CUSTOMER RECEIPT VOUCHER</h1><div class="status">${status}</div><div class="meta"><div><div class="label">Receipt No.</div><div class="value">${escapeHtml(payment.receipt_number)}</div></div><div><div class="label">Receipt Date</div><div class="value">${date(payment.receipt_date)}</div></div><div><div class="label">Received From</div><div class="value">${escapeHtml(customer.customer_name || '-')}</div></div><div><div class="label">Customer Code</div><div class="value">${escapeHtml(customer.customer_code || '-')}</div></div><div><div class="label">Against Invoice</div><div class="value">${escapeHtml(invoice.invoice_number)}</div></div><div><div class="label">Sales Order / Dispatch</div><div class="value">${escapeHtml([invoice.sales_order?.so_number, invoice.dispatch_note?.dn_number].filter(Boolean).join(' / ') || '-')}</div></div><div><div class="label">Payment Method</div><div class="value">${escapeHtml(payment.payment_method || '-')}</div></div><div><div class="label">Transaction Reference</div><div class="value">${escapeHtml(payment.payment_reference || '-')}</div></div></div><div class="amount"><div class="label">Amount Received</div><div class="value">${money(payment.amount)}</div></div><div class="meta"><div><div class="label">Invoice Value</div><div class="value">${money(invoice.net_amount)}</div></div><div><div class="label">Current Outstanding</div><div class="value">${money(invoice.balance_amount)}</div></div></div>${payment.notes || payment.reversal_reason ? `<div class="notes"><strong>${payment.reversed_at ? 'Reversal Reason' : 'Notes'}</strong><br>${escapeHtml(payment.reversal_reason || payment.notes)}</div>` : ''}<div class="sign"><span>Received By</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this receipt voucher as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare customer receipt'); }
  };

  const handlePrintWarranty = async (warrantyId: string) => {
    try {
      // Try to open a print window immediately (must be synchronous on click to avoid Chrome popup blocking).
      // If popups are blocked, we will fall back to printing via a hidden iframe.
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(
          '<!doctype html><html><head><title>Preparing warranty certificate...</title></head><body style="font-family: Arial, sans-serif; padding: 16px;">Preparing warranty certificate…</body></html>',
        );
        printWindow.document.close();
      }

      const [company, warranty] = await Promise.all([
        apiClient.get<any>('/tenant/current').catch(() => null),
        apiClient.get<any>(`/sales/warranties/${warrantyId}`),
      ]);

      const escapeHtml = (value: unknown) =>
        String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

      const formatDate = (d: any) => {
        if (!d) return '';
        try {
          return new Date(d).toLocaleDateString('en-IN');
        } catch {
          return String(d);
        }
      };

      const branding = buildDocumentBranding(company);
      const generatedOn = new Date().toLocaleDateString('en-IN');

      const itemLabel =
        (warranty?.item_code || warranty?.item_name)
          ? `${warranty?.item_code ? `${warranty.item_code} - ` : ''}${warranty?.item_name || ''}`
          : (warranty?.item_description || 'Item');

      const legacyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Warranty Certificate - ${escapeHtml(warranty?.warranty_number || '')}</title>
  <style>
    @page { margin: 0.5cm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #000; font-size: 11pt; }
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
    .title {
      text-align: center;
      font-size: 18px;
      font-weight: 800;
      margin: 18px 0 10px 0;
      letter-spacing: 0.4px;
    }
    .sub { text-align: center; font-size: 10.5pt; color: #333; margin-top: -6px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
    .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
    .box h3 { margin: 0 0 8px 0; font-size: 12pt; }
    .row { display: flex; justify-content: space-between; gap: 12px; margin: 6px 0; }
    .label { color: #374151; font-size: 10.5pt; }
    .value { font-weight: 600; font-size: 10.5pt; text-align: right; }
    .terms { margin-top: 16px; border-top: 1px dashed #cbd5e1; padding-top: 12px; font-size: 10.5pt; color: #111; }
    .footer { margin-top: 18px; display: flex; justify-content: space-between; gap: 12px; }
    .sign { width: 48%; border-top: 1px solid #111; padding-top: 6px; font-size: 10.5pt; }
    .muted { color: #4b5563; }
    img.logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; }
  </style>
</head>
<body>
  ${renderStandardLetterheadHtml(branding, generatedOn)}

  <div class="title">WARRANTY CERTIFICATE</div>
  <div class="sub">(1 certificate per dispatched UID)</div>

  <div class="grid">
    <div class="box">
      <h3>Warranty Details</h3>
      <div class="row"><div class="label">Warranty No.</div><div class="value">${escapeHtml(warranty?.warranty_number)}</div></div>
      <div class="row"><div class="label">UID</div><div class="value">${escapeHtml(warranty?.uid)}</div></div>
      <div class="row"><div class="label">Product</div><div class="value">${escapeHtml(itemLabel)}</div></div>
      ${warranty?.serial_number ? `<div class="row"><div class="label">Serial No.</div><div class="value">${escapeHtml(warranty.serial_number)}</div></div>` : ''}
      ${warranty?.batch_number ? `<div class="row"><div class="label">Batch</div><div class="value">${escapeHtml(warranty.batch_number)}</div></div>` : ''}
      <div class="row"><div class="label">Warranty Type</div><div class="value">${escapeHtml(warranty?.warranty_type || 'STANDARD')}</div></div>
      <div class="row"><div class="label">Start Date</div><div class="value">${escapeHtml(formatDate(warranty?.warranty_start_date))}</div></div>
      <div class="row"><div class="label">End Date</div><div class="value">${escapeHtml(formatDate(warranty?.warranty_end_date))}</div></div>
      <div class="row"><div class="label">Duration</div><div class="value">${escapeHtml(String(warranty?.warranty_duration_months || 12))} months</div></div>
    </div>
    <div class="box">
      <h3>Customer / Dispatch</h3>
      <div class="row"><div class="label">Customer</div><div class="value">${escapeHtml(warranty?.customer_name || '')}</div></div>
      ${warranty?.customer_code ? `<div class="row"><div class="label">Customer Code</div><div class="value">${escapeHtml(warranty.customer_code)}</div></div>` : ''}
      ${warranty?.so_number ? `<div class="row"><div class="label">Sales Order</div><div class="value">${escapeHtml(warranty.so_number)}</div></div>` : ''}
      ${warranty?.dn_number ? `<div class="row"><div class="label">Dispatch Note</div><div class="value">${escapeHtml(warranty.dn_number)}</div></div>` : ''}
      ${warranty?.dn_date ? `<div class="row"><div class="label">Dispatch Date</div><div class="value">${escapeHtml(formatDate(warranty.dn_date))}</div></div>` : ''}
      <div class="row"><div class="label">Status</div><div class="value">${escapeHtml(warranty?.status || 'ACTIVE')}</div></div>
    </div>
  </div>

  <div class="terms">
    <div style="font-weight:700; margin-bottom:6px">Standard Warranty Terms</div>
    <div>• This warranty is valid only for the UID/product mentioned above.</div>
    <div>• Warranty is applicable from the start date until the end date stated in this certificate.</div>
    <div>• Please retain this certificate for warranty claims and service support.</div>
  </div>

  <div class="footer">
    <div class="sign">Authorized Signatory</div>
    <div class="sign">Customer Signature</div>
  </div>

  <script>
    window.onload = function(){
      // Keep it immediate; browsers can treat delayed prints as non-user initiated.
      try { window.focus(); } catch(e) {}
      try { window.print(); } catch(e) {}
    };
  </script>
</body>
</html>
      `;

      const warrantyPeriod = Number(warranty?.warranty_duration_months || 12);
      const companyAddress = (branding.addressLines || []).join(', ') || branding.address || '-';
      const companyWebsite = String(branding.website || '').replace(/^https?:\/\//i, '');
      const warrantyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Warranty Certificate - ${escapeHtml(warranty?.warranty_number || '')}</title>
  <style>
    @page { size: A4 landscape; margin: 7mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #9a4600; font-size: 10.5pt; }
    .certificate { min-height: 190mm; border: 7px double #173e71; padding: 7mm 8mm 10mm; }
    .masthead { position: relative; min-height: 54mm; text-align: center; color: #295893; }
    .brand-logo { display: block; width: 30mm; height: 30mm; object-fit: contain; margin: 2mm auto 1mm; }
    .company { font-size: 11pt; font-weight: 700; line-height: 1.16; }
    .company div { margin: 0; }
    .website { text-decoration: underline; }
    h1 { color: #31568b; text-align: center; font-family: Georgia, 'Times New Roman', serif; font-size: 25pt; letter-spacing: .5px; margin: 0 0 4mm; text-shadow: .4px .4px #9db3ce; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    td { border: 1px solid #596c80; padding: 2px 5px; vertical-align: top; line-height: 1.14; }
    .label { display: block; color: #31568b; font-weight: 700; font-size: 9pt; margin-bottom: 1px; }
    .value { color: #9a4600; font-size: 10.5pt; overflow-wrap: anywhere; }
    .top { width: 50%; margin: 0 auto 10mm; }
    .details { margin-top: 0; }
    .signature { margin-top: 12mm; color: #295893; font-size: 10pt; }
    .signature-line { width: 54mm; border-top: 1px solid #295893; margin: 7mm 0 3mm; }
    .signature-name { font-weight: 700; }
  </style>
</head>
<body>
  <main class="certificate">
    <header class="masthead">
      <img class="brand-logo" src="${escapeHtml(`${window.location.origin}/branding/sak-solutions-mark.png`)}" alt="SAK Solutions logo" />
      <div class="company">
        <div>${escapeHtml(branding.companyName)}</div>
        <div>${escapeHtml(companyAddress)}</div>
        ${branding.email ? `<div>E-mail: ${escapeHtml(branding.email)}</div>` : ''}
        ${companyWebsite ? `<div class="website">${escapeHtml(companyWebsite)}</div>` : ''}
      </div>
    </header>
    <h1>WARRANTY CERTIFICATE</h1>
    <table class="top"><tr>
      <td><span class="label">Warranty Issue Date</span><span class="value">${escapeHtml(formatDate(warranty?.invoice_date || warranty?.warranty_start_date || generatedOn))}</span></td>
      <td><span class="label">Warranty Certificate No.</span><span class="value">${escapeHtml(warranty?.warranty_number || '')}</span></td>
    </tr></table>
    <table class="details">
      <tr><td colspan="3"><span class="label">Customer Name</span><span class="value">${escapeHtml(warranty?.customer_name || '-')}</span></td></tr>
      <tr><td colspan="3"><span class="label">Address</span><span class="value">${escapeHtml(warranty?.customer_address || '-')}</span></td></tr>
      <tr>
        <td style="width:41%"><span class="label">Product Warranted</span><span class="value">${escapeHtml(itemLabel)}</span></td>
        <td style="width:25%"><span class="label">Supplied Location</span><span class="value">${escapeHtml(warranty?.supplied_location || '-')}</span></td>
        <td style="width:34%"><span class="label">Warranty Period</span><span class="value">${escapeHtml(`${warrantyPeriod} MONTHS FROM DATE OF SUPPLY`)}</span></td>
      </tr>
      <tr>
        <td><span class="label">Purchase Order No.</span><span class="value">${escapeHtml(warranty?.customer_po_number || warranty?.so_number || '-')}</span></td>
        <td><span class="label">Date</span><span class="value">${escapeHtml(formatDate(warranty?.customer_po_date))}</span></td>
        <td><span class="label">Invoice No.</span><span class="value">${escapeHtml(warranty?.invoice_number || warranty?.dn_number || '-')}</span></td>
        <td><span class="label">Date</span><span class="value">${escapeHtml(formatDate(warranty?.invoice_date || warranty?.dn_date))}</span></td>
      </tr>
    </table>
    <div class="signature"><div class="signature-line"></div><div class="signature-name">Authorized Signatory</div></div>
  </main>
  <script>window.onload=function(){try{window.focus();window.print();}catch(e){}}</script>
</body>
</html>`;
      const html = warrantyHtml;

      // Preferred path: if a popup window was successfully opened, render into it.
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.opener = null;
        return;
      }

      // Fallback: print via hidden iframe (no popup required).
      const frameId = `warranty-print-frame-${warrantyId}`;
      const existing = document.getElementById(frameId);
      if (existing) existing.remove();

      const iframe = document.createElement('iframe');
      iframe.id = frameId;
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) {
        iframe.remove();
        throw new Error('Unable to create print frame');
      }

      doc.open();
      doc.write(html);
      doc.close();

      const cleanup = () => {
        try {
          iframe.remove();
        } catch {
          // ignore
        }
      };

      try {
        iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
      } catch {
        // ignore
      }

      setTimeout(cleanup, 30_000);
    } catch (err: any) {
      alert(err?.message || 'Failed to print warranty certificate');
    }
  };

  // Close modals on Escape key
  useEscapeKey(showCustomerForm, () => setShowCustomerForm(false));
  useEscapeKey(showQuotationForm, () => setShowQuotationForm(false));
  useEscapeKey(!!viewingQuotation, () => setViewingQuotation(null));
  useEscapeKey(!!communicationQuotation, () => setCommunicationQuotation(null));
  useEscapeKey(!!rejectingQuotation, () => {
    if (!quotationDecisionSaving) {
      setRejectingQuotation(null);
      setQuotationRejectionReason('');
    }
  });
  useEscapeKey(showSOConversionForm, () => setShowSOConversionForm(false));
  useEscapeKey(showDispatchForm, () => setShowDispatchForm(false));
  useEscapeKey(showFulfilmentForm, () => setShowFulfilmentForm(false));
  useEscapeKey(showOrderEditForm, () => setShowOrderEditForm(false));
  useEscapeKey(showDispatchEditForm, () => setShowDispatchEditForm(false));
  useEscapeKey(!!deliveryConfirmation, () => setDeliveryConfirmation(null));
  useEscapeKey(showWarrantyForm, () => setShowWarrantyForm(false));
  useEscapeKey(showWarrantyEditForm, () => setShowWarrantyEditForm(false));
  useEscapeKey(showDirectSOForm, () => setShowDirectSOForm(false));
  useEscapeKey(!!viewingInvoice, () => setViewingInvoice(null));
  useEscapeKey(!!statutoryInvoice, () => setStatutoryInvoice(null));
  useEscapeKey(!!receiptInvoice, () => setReceiptInvoice(null));
  useEscapeKey(!!collectionInvoice, () => setCollectionInvoice(null));
  useEscapeKey(!!creditInvoice, () => setCreditInvoice(null));
  useEscapeKey(!!returnInvoice, () => setReturnInvoice(null));
  useEscapeKey(!!receivingReturn, () => setReceivingReturn(null));
  useEscapeKey(!!qcReturn, () => setQcReturn(null));
  useEscapeKey(!!statementCustomer, () => { setStatementCustomer(null); setAccountStatement(null); });
  useEscapeKey(!!viewingDunningNotice, () => setViewingDunningNotice(null));

  useEffect(() => {
    fetchItems(); // Fetch items on mount for all forms
    if (activeTab === 'customers') {
      fetchCustomers();
    } else if (activeTab === 'quotations') {
      fetchQuotations();
    } else if (activeTab === 'orders') {
      fetchOrders();
    } else if (activeTab === 'fulfilment') {
      fetchFulfilmentTasks();
      fetchWarehouses();
    } else if (activeTab === 'dispatch') {
      fetchDispatches();
    } else if (activeTab === 'billing') {
      fetchInvoices();
    } else if (activeTab === 'collections') {
      fetchCollectionsWorklist();
    } else if (activeTab === 'returns') {
      fetchSalesReturns();
    } else if (activeTab === 'warranties') {
      fetchWarranties();
    }
  }, [activeTab]);

  useEffect(() => {
    setCurrentPage(1);
    setRegisterSearch('');
    setRegisterStatus('ALL');
  }, [activeTab]);

  const fetchItems = async () => {
    try {
      const data = await apiClient.get<any[]>('/items');
      setItems(data);
    } catch (err: any) {
    }
  };

  const fetchSalesReturns = async () => {
    setLoading(true);
    setError(null);
    try {
      setSalesReturns(await apiClient.get<SalesReturn[]>('/sales/returns'));
    } catch (err: any) {
      setError(err?.message || 'Failed to load sales returns');
    } finally {
      setLoading(false);
    }
  };

  const fetchFulfilmentTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      setFulfilmentTasks(await apiClient.get<FulfilmentTask[]>('/sales/fulfilment'));
    } catch (err: any) {
      setError(err?.message || 'Failed to load fulfilment worklist');
    } finally {
      setLoading(false);
    }
  };

  const fetchCollectionsWorklist = async () => {
    setLoading(true);
    setError(null);
    try {
      setCollectionsWorklist(await apiClient.get<CollectionsWorklist>('/sales/collections/worklist'));
    } catch (err: any) {
      setError(err?.message || 'Failed to load collections worklist');
    } finally {
      setLoading(false);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const result = await apiClient.get<Warehouse[]>('/inventory/warehouses');
      setWarehouses((result || []).filter((warehouse) => warehouse.is_active !== false));
    } catch (err: any) {
      setError(err?.message || 'Failed to load warehouses');
    }
  };

  const fetchCustomers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<Customer[]>('/sales/customers');
      setCustomers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch customers');
    } finally {
      setLoading(false);
    }
  };

  const fetchQuotations = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<Quotation[]>('/sales/quotations');
      setQuotations(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch quotations');
    } finally {
      setLoading(false);
    }
  };

  const resetQuotationForm = () => {
    setQuotationForm(createDefaultQuotationForm());
    setEditingQuotationId(null);
  };

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<SalesOrder[]>('/sales/orders');
      setOrders(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sales orders');
    } finally {
      setLoading(false);
    }
  };

  const handleSendSalesOrderEmail = async (orderId: string) => {
    try {
      setSendingSOEmailId(orderId);
      const result = await apiClient.post(`/sales/orders/${orderId}/send-email`, {});
      alert(`Sales order email sent to: ${result?.to || 'customer email'}`);
    } catch (err: any) {
      alert(err?.message || 'Failed to send sales order email');
    } finally {
      setSendingSOEmailId(null);
    }
  };

  const handleEditSalesOrder = async (orderId: string) => {
    try {
      const data: any = await apiClient.get(`/sales/orders/${orderId}`);
      setEditingOrderId(orderId);
      setEditingOrderNumber(data.so_number || '');
      setEditingOrderItems(Array.isArray(data.sales_order_items) ? data.sales_order_items.map((line: any) => {
        const commercialQuantity = Number(line.sales_quantity ?? line.quantity ?? 0);
        const gross = commercialQuantity * Number(line.unit_price || 0);
        return {
          ...line,
          quantity: commercialQuantity,
          discount_percentage: gross > 0 ? (Number(line.discount_amount || 0) / gross) * 100 : 0,
          ordered_uom: line.ordered_uom || 'NOS',
          price_uom: line.price_uom || line.ordered_uom || 'NOS',
          hsn_code: line.hsn_code || '',
        };
      }) : []);
      setOrderEditForm({
        expected_delivery_date: data.expected_delivery_date?.split('T')[0] || '',
        payment_terms: data.payment_terms || '',
        delivery_terms: data.delivery_terms || '',
        notes: data.notes || '',
        status: data.status || 'CONFIRMED',
        customer_po_number: data.customer_po_number || '',
        customer_po_date: data.customer_po_date?.split('T')[0] || '',
        currency_code: data.currency_code || regionalProfile.currency,
        place_of_supply: data.place_of_supply || '',
        incoterm: data.incoterm || '',
        delivery_block: Boolean(data.delivery_block),
        billing_block: Boolean(data.billing_block),
        block_reason: data.block_reason || '',
      });
      setShowOrderEditForm(true);
    } catch (err: any) {
      alert(err?.message || 'Failed to load sales order');
    }
  };

  const handleSaveSalesOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrderId) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.put(`/sales/orders/${editingOrderId}`, { ...orderEditForm, items: editingOrderItems });
      setShowOrderEditForm(false);
      setEditingOrderId(null);
      setEditingOrderNumber('');
      setEditingOrderItems([]);
      await fetchOrders();
    } catch (err: any) {
      setError(err?.message || 'Failed to update sales order');
      alert(err?.message || 'Failed to update sales order');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSalesOrder = async (order: SalesOrder) => {
    const confirmed = await confirmDialog({
      title: 'Delete Sales Order',
      message: `Delete sales order ${order.so_number}?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/sales/orders/${order.id}`);
      await fetchOrders();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete sales order');
    }
  };

  const handleReleaseSalesOrder = async (order: SalesOrder) => {
    const confirmed = await confirmDialog({
      title: 'Release Sales Order',
      message: `Run customer-credit and ATP availability checks, then commercially release ${order.so_number}?`,
      confirmLabel: 'Check & Release',
    });
    if (!confirmed) return;
    try {
      const result: any = await apiClient.post(`/sales/orders/${order.id}/release`, {});
      alert(`${order.so_number} released. ATP: ${String(result?.availability?.status || 'CHECKED').replaceAll('_', ' ')}.`);
      await fetchOrders();
    } catch (err: any) {
      alert(err?.message || 'Sales-order release failed');
    }
  };

  const handleSalesOrderBlock = async (order: SalesOrder) => {
    const currentlyBlocked = Boolean(order.delivery_block || order.billing_block);
    let reason = '';
    if (!currentlyBlocked) {
      reason = window.prompt(`Enter the mandatory reason for blocking delivery and billing on ${order.so_number}:`)?.trim() || '';
      if (!reason) return;
    }
    const confirmed = await confirmDialog({
      title: currentlyBlocked ? 'Clear Sales Order Hold' : 'Apply Sales Order Hold',
      message: currentlyBlocked
        ? `Clear the delivery and billing hold on ${order.so_number}?`
        : `Block delivery and billing on ${order.so_number}? Commercial values will remain locked.`,
      confirmLabel: currentlyBlocked ? 'Clear Hold' : 'Apply Hold',
      variant: currentlyBlocked ? 'info' : 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.put(`/sales/orders/${order.id}/blocks`, {
        delivery_block: !currentlyBlocked,
        billing_block: !currentlyBlocked,
        block_reason: reason,
      });
      await fetchOrders();
    } catch (err: any) {
      alert(err?.message || 'Sales-order hold update failed');
    }
  };

  const handleEditDispatch = (dispatch: DispatchNote) => {
    setEditingDispatchId(dispatch.id);
    setDispatchEditForm({
      dispatch_date: dispatch.dispatch_date?.split('T')[0] || '',
      transporter_name: dispatch.transporter_name || '',
      vehicle_number: dispatch.vehicle_number || '',
      lr_number: dispatch.lr_number || '',
      lr_date: (dispatch as any).lr_date?.split('T')[0] || '',
      delivery_address: (dispatch as any).delivery_address || '',
      notes: (dispatch as any).notes || '',
    });
    setShowDispatchEditForm(true);
  };

  const handleSaveDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDispatchId) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.put(`/sales/dispatch/${editingDispatchId}`, dispatchEditForm);
      setShowDispatchEditForm(false);
      setEditingDispatchId(null);
      await fetchDispatches();
    } catch (err: any) {
      setError(err?.message || 'Failed to update dispatch');
      alert(err?.message || 'Failed to update dispatch');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDispatch = async (dispatch: DispatchNote) => {
    const confirmed = await confirmDialog({
      title: 'Reverse Goods Issue',
      message: `Reverse PGI ${dispatch.dn_number}? Stock and UID ownership will be restored, while the dispatch document remains in the audit trail as CANCELLED.`,
      confirmLabel: 'Reverse PGI',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/sales/dispatch/${dispatch.id}`);
      await fetchDispatches();
      await fetchOrders();
      await fetchWarranties();
    } catch (err: any) {
      alert(err?.message || 'Failed to reverse goods issue');
    }
  };

  const handleEditWarranty = (warranty: Warranty) => {
    if (!canEdit) {
      alert('You do not have permission to edit warranties');
      return;
    }

    setEditingWarrantyId(warranty.id);
    setWarrantyEditForm({
      status: warranty.status || 'ACTIVE',
      warranty_type: warranty.warranty_type || 'STANDARD',
    });
    setShowWarrantyEditForm(true);
  };

  const handleSaveWarranty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWarrantyId) return;
    if (!canEdit) {
      alert('You do not have permission to edit warranties');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiClient.put(`/sales/warranties/${editingWarrantyId}`, warrantyEditForm);
      setShowWarrantyEditForm(false);
      setEditingWarrantyId(null);
      await fetchWarranties();
    } catch (err: any) {
      setError(err?.message || 'Failed to update warranty');
      alert(err?.message || 'Failed to update warranty');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWarranty = async (warranty: Warranty) => {
    if (!canDelete) {
      alert('You do not have permission to delete warranties');
      return;
    }

    const confirmed = await confirmDialog({
      title: 'Delete Warranty',
      message: `Delete warranty ${warranty.warranty_number}?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/sales/warranties/${warranty.id}`);
      await fetchWarranties();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete warranty');
    }
  };

  const fetchDispatches = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<DispatchNote[]>('/sales/dispatch');
      setDispatches(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch dispatch notes');
    } finally {
      setLoading(false);
    }
  };

  const fetchInvoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<SalesInvoice[]>('/sales/invoices');
      setInvoices(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch customer invoices');
    } finally {
      setLoading(false);
    }
  };

  const handleViewInvoice = async (invoice: SalesInvoice) => {
    try {
      setViewingInvoice(await apiClient.get<SalesInvoice>(`/sales/invoices/${invoice.id}`));
    } catch (err: any) {
      alert(err?.message || 'Failed to load customer invoice');
    }
  };

  const openInvoiceStatutoryDetails = (invoice: SalesInvoice) => {
    setStatutoryInvoice(invoice);
    setStatutoryForm({
      irn: invoice.irn || '',
      irn_ack_number: invoice.irn_ack_number || '',
      irn_ack_date: invoice.irn_ack_date ? String(invoice.irn_ack_date).slice(0, 10) : '',
      eway_bill_number: invoice.eway_bill_number || '',
      eway_bill_date: invoice.eway_bill_date ? String(invoice.eway_bill_date).slice(0, 10) : '',
      eway_bill_valid_until: invoice.eway_bill_valid_until ? String(invoice.eway_bill_valid_until).slice(0, 10) : '',
      not_applicable: invoice.statutory_status === 'NOT_APPLICABLE',
      statutory_exemption_reason: invoice.statutory_exemption_reason || '',
    });
  };

  const handleSaveInvoiceStatutoryDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!statutoryInvoice || savingStatutoryDetails) return;
    setSavingStatutoryDetails(true);
    try {
      const updated = await apiClient.post<SalesInvoice>(`/sales/invoices/${statutoryInvoice.id}/statutory-details`, statutoryForm);
      setInvoices((current) => current.map((entry) => entry.id === updated.id ? { ...entry, ...updated } : entry));
      if (viewingInvoice?.id === updated.id) setViewingInvoice(updated);
      setStatutoryInvoice(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to save statutory invoice details');
    } finally {
      setSavingStatutoryDetails(false);
    }
  };

  const handleCancelInvoice = async (invoice: SalesInvoice) => {
    const reason = window.prompt(`Reason for cancelling ${invoice.invoice_number}:`)?.trim();
    if (!reason) return;
    try {
      await apiClient.post(`/sales/invoices/${invoice.id}/cancel`, { reason });
      setViewingInvoice(null);
      await fetchInvoices();
    } catch (err: any) { alert(err?.message || 'Failed to cancel invoice'); }
  };

  const handleReverseInvoicePayment = async (invoice: SalesInvoice, payment: any) => {
    const reason = window.prompt(`Reason for reversing ${payment.receipt_number}:`)?.trim();
    if (!reason) return;
    try {
      await apiClient.post(`/sales/invoices/${invoice.id}/payments/${payment.id}/reverse`, { reason });
      setViewingInvoice(await apiClient.get<SalesInvoice>(`/sales/invoices/${invoice.id}`));
      await fetchInvoices();
    } catch (err: any) { alert(err?.message || 'Failed to reverse customer receipt'); }
  };

  const handleCreateCreditNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!creditInvoice) return;
    const taxableAmount = Number(creditNoteForm.taxable_amount);
    const taxPercentage = Number(creditNoteForm.tax_percentage || 0);
    if (!Number.isFinite(taxableAmount) || taxableAmount <= 0 || !Number.isFinite(taxPercentage) || taxPercentage < 0 || !creditNoteForm.reason.trim()) {
      alert('Enter a positive taxable amount, valid GST percentage, and a credit-note reason.');
      return;
    }
    const grossAmount = taxableAmount * (1 + taxPercentage / 100);
    if (grossAmount > Number(creditInvoice.balance_amount || 0) + 0.001) {
      alert('The credit note cannot exceed the current invoice outstanding balance.');
      return;
    }
    try {
      const creditNote = await apiClient.post<any>(`/sales/invoices/${creditInvoice.id}/credit-notes`, {
        ...creditNoteForm,
        taxable_amount: taxableAmount,
        tax_percentage: taxPercentage,
        reason: creditNoteForm.reason.trim(),
      });
      alert(`Credit note ${creditNote.credit_note_number} posted. No stock has been adjusted.`);
      setCreditInvoice(null);
      setCreditNoteForm({ taxable_amount: '', tax_percentage: '0', credit_note_date: getTodayDateInputValue(), reason: '', external_reference: '' });
      setViewingInvoice(await apiClient.get<SalesInvoice>(`/sales/invoices/${creditInvoice.id}`));
      await fetchInvoices();
    } catch (err: any) { alert(err?.message || 'Failed to post credit note'); }
  };

  const handleCancelCreditNote = async (creditNote: any) => {
    const reason = window.prompt(`Reason for cancelling ${creditNote.credit_note_number}:`)?.trim();
    if (!reason || !viewingInvoice) return;
    try {
      await apiClient.post(`/sales/credit-notes/${creditNote.id}/cancel`, { reason });
      setViewingInvoice(await apiClient.get<SalesInvoice>(`/sales/invoices/${viewingInvoice.id}`));
      await fetchInvoices();
    } catch (err: any) { alert(err?.message || 'Failed to cancel credit note'); }
  };

  const handleCreateSalesReturn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!returnInvoice) return;
    const items = (returnInvoice.items || []).map((line: any) => ({ invoice_item_id: line.id, quantity: Number(returnLines[line.id] || 0) })).filter((line: any) => line.quantity > 0);
    if (!returnReason.trim() || !items.length) return alert('Enter a return reason and at least one returned quantity.');
    try {
      const result = await apiClient.post<any>(`/sales/invoices/${returnInvoice.id}/returns`, { reason: returnReason.trim(), items });
      alert(`Sales return ${result.return_number} created. Receive it into quarantine before QC.`);
      setReturnInvoice(null); setReturnReason(''); setReturnLines({});
    } catch (err: any) { alert(err?.message || 'Failed to create sales return'); }
  };

  const openSalesReturnReceipt = async (salesReturn: SalesReturn) => {
    if (!warehouses.length) await fetchWarehouses();
    setReturnWarehouseId('');
    setReceivingReturn(salesReturn);
  };

  const receiveSalesReturn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!receivingReturn || !returnWarehouseId) return alert('Select the quarantine/receiving warehouse.');
    try {
      const result = await apiClient.post<any>(`/sales/returns/${receivingReturn.id}/receive`, { warehouse_id: returnWarehouseId });
      alert(result?.message || `Sales return ${receivingReturn.return_number} received and awaiting QC.`);
      setReceivingReturn(null);
      await fetchSalesReturns();
    } catch (err: any) { alert(err?.message || 'Failed to receive sales return'); }
  };

  const openSalesReturnQc = (salesReturn: SalesReturn) => {
    setReturnQcLines(Object.fromEntries((salesReturn.items || []).map((line) => [line.id, String(line.quantity || 0)])));
    setReturnQcNotes('');
    setQcReturn(salesReturn);
  };

  const completeSalesReturnQc = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!qcReturn) return;
    const items = (qcReturn.items || []).map((line) => ({ id: line.id, accepted_quantity: Number(returnQcLines[line.id] || 0) }));
    if (items.some((line, index) => !Number.isFinite(line.accepted_quantity) || line.accepted_quantity < 0 || line.accepted_quantity > Number(qcReturn.items?.[index]?.quantity || 0))) {
      return alert('Each QC-accepted quantity must be between zero and the returned quantity.');
    }
    try {
      const result = await apiClient.post<any>(`/sales/returns/${qcReturn.id}/qc`, { items, qc_notes: returnQcNotes.trim() });
      alert(result?.message || `QC completed for ${qcReturn.return_number}.`);
      setQcReturn(null);
      await fetchSalesReturns();
    } catch (err: any) { alert(err?.message || 'Failed to complete sales-return QC'); }
  };

  const handleViewSalesOrderFlow = async (order: SalesOrder) => {
    try {
      setLoading(true);
      setSalesOrderFlow(await apiClient.get(`/sales/orders/${order.id}/document-flow`));
    } catch (err: any) {
      alert(err?.message || 'Failed to load sales-order document trail');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInvoiceFromDispatch = async (dispatch: DispatchNote) => {
    const confirmed = await confirmDialog({
      title: 'Create Customer Invoice',
      message: `Create a billing document from dispatch ${dispatch.dn_number}?`,
      confirmLabel: 'Create Invoice',
    });
    if (!confirmed) return;
    try {
      const invoice = await apiClient.post<SalesInvoice>(`/sales/dispatch/${dispatch.id}/create-invoice`, {});
      alert(`Customer invoice ${invoice.invoice_number} created successfully.`);
      await fetchDispatches();
      setActiveTab('billing');
    } catch (err: any) {
      alert(err?.message || 'Failed to create customer invoice');
    }
  };

  const openDeliveryConfirmation = (dispatch: DispatchNote) => {
    setDeliveryConfirmation(dispatch);
    setDeliveryConfirmationForm({
      delivery_date: getTodayDateInputValue(),
      delivery_time: new Date().toTimeString().slice(0, 5),
      delivered_to_name: '',
      delivered_to_mobile: '',
      notes: '',
      proof_file: null,
    });
  };

  const handleConfirmDelivery = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!deliveryConfirmation) return;
    if (!deliveryConfirmationForm.delivered_to_name.trim()) {
      alert('Enter the name of the customer representative who received the material.');
      return;
    }
    try {
      setDeliveryProofUploading(true);
      let proofUrl = '';
      let proofName = '';
      if (deliveryConfirmationForm.proof_file) {
        const formData = new FormData();
        formData.append('file', deliveryConfirmationForm.proof_file);
        formData.append('bucket', 'documents');
        formData.append('folder', 'sales-proof-of-delivery');
        const upload: any = await apiClient.postForm('/upload', formData);
        if (!upload?.url) throw new Error('Proof-of-delivery upload did not return a file URL.');
        proofUrl = upload.url;
        proofName = deliveryConfirmationForm.proof_file.name;
      }
      await apiClient.post(`/sales/dispatch/${deliveryConfirmation.id}/confirm-delivery`, {
        delivered_at: new Date(`${deliveryConfirmationForm.delivery_date}T${deliveryConfirmationForm.delivery_time || '00:00'}:00`).toISOString(),
        delivered_to_name: deliveryConfirmationForm.delivered_to_name.trim(),
        delivered_to_mobile: deliveryConfirmationForm.delivered_to_mobile.trim(),
        notes: deliveryConfirmationForm.notes.trim(),
        proof_of_delivery_url: proofUrl || null,
        proof_of_delivery_name: proofName || null,
      });
      setDeliveryConfirmation(null);
      await fetchDispatches();
    } catch (err: any) {
      alert(err?.message || 'Failed to confirm delivery');
    } finally {
      setDeliveryProofUploading(false);
    }
  };

  const handleRecordReceipt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!receiptInvoice) return;
    const amount = Number(receiptForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(receiptInvoice.balance_amount || 0)) {
      alert('Enter a valid receipt amount not exceeding the outstanding balance.');
      return;
    }
    try {
      await apiClient.post(`/sales/invoices/${receiptInvoice.id}/payments`, {
        ...receiptForm,
        amount,
      });
      setReceiptInvoice(null);
      setReceiptForm({
        amount: '',
        receipt_date: getTodayDateInputValue(),
        payment_method: 'NEFT',
        payment_reference: '',
        notes: '',
      });
      await fetchInvoices();
    } catch (err: any) {
      alert(err?.message || 'Failed to record customer receipt');
    }
  };

  const handleCollectionFollowUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!collectionInvoice) return;
    try {
      const endpoint = collectionInvoice.source === 'SERVICE'
        ? `/service/customer-invoices/${collectionInvoice.id}/collection-action`
        : `/sales/invoices/${collectionInvoice.id}/collection-action`;
      await apiClient.post(endpoint, collectionForm);
      setCollectionInvoice(null);
      setCollectionForm({ collection_status: 'CONTACTED', next_follow_up_date: '', promise_to_pay_date: '', notes: '' });
      await fetchInvoices();
      if (activeTab === 'collections') await fetchCollectionsWorklist();
    } catch (err: any) {
      alert(err?.message || 'Failed to save collection follow-up');
    }
  };

  const fetchWarranties = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<Warranty[]>('/sales/warranties');
      setWarranties(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch warranties');
    } finally {
      setLoading(false);
    }
  };

  const actuallyCreateCustomer = async () => {
    if (customerSaveInFlightRef.current) return;
    customerSaveInFlightRef.current = true;
    setLoading(true);
    setCustomerFormError(null);
    try {
      const contacts = customerForm.contacts.filter((contact) => contact.name.trim() || contact.mobile.trim() || contact.email.trim());
      const billingAddresses = customerForm.billing_addresses.map((address) => address.trim()).filter(Boolean);
      const shippingAddresses = customerForm.shipping_addresses.map((address) => address.trim()).filter(Boolean);
      const primaryContact = contacts[0];
      const payload = {
        ...customerForm,
        customer_type: 'REGULAR',
        contacts,
        billing_addresses: billingAddresses,
        shipping_addresses: shippingAddresses,
        contact_person: primaryContact?.name || '',
        mobile: primaryContact?.mobile || '',
        email: primaryContact?.email || '',
        billing_address: billingAddresses[0] || '',
        shipping_address: shippingAddresses[0] || '',
      };
      if (editingCustomerId) {
        await apiClient.put(`/sales/customers/${editingCustomerId}`, payload);
        alert('Customer updated successfully!');
      } else {
        const response: any = await apiClient.post('/sales/customers', payload);
        alert(`Customer ${response?.customer_code || ''} created successfully!`.replace('  ', ' '));
      }
      setShowCustomerForm(false);
      resetCustomerForm();
      await fetchCustomers();
    } catch (err: any) {
      setCustomerFormError(err.response?.data?.message || err.message || 'Failed to save customer');
    } finally {
      customerSaveInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomerFormError(null);
    
    // For updates, skip duplicate check
    if (editingCustomerId) {
      await actuallyCreateCustomer();
      return;
    }

    // Check for duplicates before creating
    try {
      const primaryContact = customerForm.contacts.find((contact) => contact.name.trim() || contact.mobile.trim() || contact.email.trim());
      await customerDuplicateDetection.checkDuplicates(
        () => apiClient.post('/sales/customers/check-duplicates', {
          ...customerForm,
          contact_person: primaryContact?.name || '',
          mobile: primaryContact?.mobile || '',
          email: primaryContact?.email || '',
        }),
        () => actuallyCreateCustomer(),
      );
    } catch (err: any) {
      setCustomerFormError(err.response?.data?.message || err.message || 'Unable to validate customer details');
    }
  };

  const handleEditCustomer = (customer: Customer) => {
    setCustomerFormError(null);
    setEditingCustomerId(customer.id);
    const formData = {
      customer_name: customer.customer_name || '',
      customer_type: customer.customer_type || 'REGULAR',
      contact_person: customer.contact_person || '',
      email: customer.email || '',
      phone: customer.phone || '',
      mobile: customer.mobile || '',
      gst_number: customer.gst_number || '',
      pan_number: customer.pan_number || '',
      billing_address: customer.billing_address || '',
      shipping_address: customer.shipping_address || '',
      city: customer.city || '',
      state: customer.state || '',
      country: customer.country || regionalCountry,
      pincode: customer.pincode || '',
      credit_limit: Number(customer.credit_limit) || 0,
      credit_days: Number(customer.credit_days) || 30,
      sales_blocked: Boolean(customer.sales_blocked),
      delivery_blocked: Boolean(customer.delivery_blocked),
      billing_blocked: Boolean(customer.billing_blocked),
      block_reason: customer.block_reason || '',
      tax_treatment: customer.tax_treatment || 'REGISTERED',
      contacts: customer.contacts?.length
        ? customer.contacts
        : [{ name: customer.contact_person || '', mobile: customer.mobile || customer.phone || '', email: customer.email || '' }],
      billing_addresses: customer.billing_addresses?.length ? customer.billing_addresses : [customer.billing_address || ''],
      shipping_addresses: customer.shipping_addresses?.length ? customer.shipping_addresses : [customer.shipping_address || ''],
    };
    setCustomerForm(formData);
    setShowCustomerForm(true);
  };

  const loadCustomerStatement = async (customer: Customer, period = statementPeriod) => {
    setStatementLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ from: period.from, to: period.to });
      const statement = await apiClient.get<CustomerAccountStatement>(`/sales/customers/${customer.id}/account-statement?${query.toString()}`);
      setAccountStatement(statement);
    } catch (err: any) {
      setError(err?.message || 'Failed to load customer account statement');
    } finally {
      setStatementLoading(false);
    }
  };

  const openCustomerStatement = async (customer: Customer) => {
    setStatementCustomer(customer);
    setAccountStatement(null);
    setShowDunningForm(false);
    await loadCustomerStatement(customer);
  };

  const downloadCustomerStatementPdf = async () => {
    if (!statementCustomer || !accountStatement) return;
    try {
      const query = new URLSearchParams({ from: statementPeriod.from, to: statementPeriod.to });
      const blob = await apiClient.getBlob(`/sales/customers/${statementCustomer.id}/account-statement/pdf?${query.toString()}`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${statementCustomer.customer_code || 'Customer'}_Statement_${statementPeriod.from}_to_${statementPeriod.to}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err: any) {
      alert(err?.message || 'Failed to download the customer account statement PDF');
    }
  };

  const emailCustomerStatementPdf = async () => {
    if (!statementCustomer || !accountStatement) return;
    const recipient = window.prompt('Send customer account statement to:', statementCustomer.email || '')?.trim();
    if (!recipient) return;
    setStatementLoading(true);
    try {
      const result = await apiClient.post<any>(`/sales/customers/${statementCustomer.id}/account-statement/send-email`, {
        from: statementPeriod.from,
        to: statementPeriod.to,
        recipient,
      });
      alert(result?.message || `Customer account statement emailed to ${recipient}.`);
    } catch (err: any) {
      alert(err?.message || 'Failed to email the customer account statement');
    } finally {
      setStatementLoading(false);
    }
  };

  const openDunningNotice = async (noticeId: string) => {
    setDunningDetailLoading(true);
    try {
      const detail = await apiClient.get<DunningNoticeDetail>(`/sales/dunning-notices/${noticeId}`);
      setViewingDunningNotice(detail);
    } catch (err: any) {
      alert(err?.message || 'Failed to load the payment reminder');
    } finally {
      setDunningDetailLoading(false);
    }
  };

  const handlePrintDunningNotice = async (notice: DunningNoticeDetail) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing payment reminder...</body></html>');
      printWindow.document.close();
    }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const date = (value: unknown) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN') : '-';
      const customer = notice.customer || ({} as Customer);
      const address = [customer.billing_address, customer.city, customer.state, customer.pincode, customer.country].filter(Boolean).join(', ');
      const title = notice.dunning_level === 3 ? 'FINAL PAYMENT NOTICE' : notice.dunning_level === 2 ? 'URGENT PAYMENT REMINDER' : 'PAYMENT REMINDER';
      const introduction = notice.dunning_level === 3
        ? 'Despite our earlier follow-up, the invoices listed below remain overdue. Please arrange payment by the stated due date and share the remittance details with our accounts team.'
        : notice.dunning_level === 2
          ? 'Our records show that the invoices listed below remain overdue. We request your urgent attention and payment by the stated due date.'
          : 'This is a courteous reminder that the invoices listed below were outstanding on the date of this notice. Please arrange payment by the stated due date.';
      const rows = (notice.invoice_snapshot || []).map((invoice, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(invoice.source)}</td><td>${escapeHtml(invoice.invoice_number)}</td><td>${date(invoice.invoice_date)}</td><td>${date(invoice.due_date)}</td><td class="num">${escapeHtml(invoice.days_overdue)}</td><td class="num">${money(invoice.balance_amount)}</td></tr>`).join('');
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(notice.notice_number)}</title><style>@page{margin:.65cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:19px;margin:20px 0 4px}.level{text-align:center;color:#92400e;font-weight:700;margin-bottom:18px}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;margin-bottom:18px}.meta>div{padding:8px 10px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:3px}.recipient{margin:16px 0;line-height:1.55}.message{line-height:1.65;margin:16px 0}.due{border:1px solid #f59e0b;background:#fffbeb;padding:10px 12px;font-weight:700;margin:14px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:7px}th{background:#f3f4f6;text-align:left;font-size:9px;text-transform:uppercase}.num{text-align:right}.totals{margin:14px 0 0 auto;width:360px}.totals div{display:flex;justify-content:space-between;padding:7px;border-bottom:1px solid #e5e7eb}.total{font-size:13px;font-weight:800}.notes{margin-top:18px;white-space:pre-wrap}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}.cancelled{border:2px solid #b91c1c;color:#b91c1c;padding:8px;text-align:center;font-weight:800;margin:12px 0}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>${title}</h1><div class="level">Dunning Level ${notice.dunning_level}</div>${notice.status === 'CANCELLED' ? `<div class="cancelled">CANCELLED${notice.cancellation_reason ? ` — ${escapeHtml(notice.cancellation_reason)}` : ''}</div>` : ''}<div class="meta"><div><div class="label">Notice No.</div><div class="value">${escapeHtml(notice.notice_number)}</div></div><div><div class="label">Notice Date</div><div class="value">${date(notice.notice_date)}</div></div><div><div class="label">Customer Code</div><div class="value">${escapeHtml(customer.customer_code || '-')}</div></div><div><div class="label">Payment Due By</div><div class="value">${date(notice.due_by)}</div></div></div><div class="recipient"><strong>To:</strong><br><strong>${escapeHtml(customer.customer_name || '-')}</strong>${customer.contact_person ? `<br>Attn: ${escapeHtml(customer.contact_person)}` : ''}${address ? `<br>${escapeHtml(address)}` : ''}${customer.email ? `<br>${escapeHtml(customer.email)}` : ''}</div><div class="message"><strong>Subject: Outstanding payment against overdue invoices</strong><p>${introduction}</p></div><div class="due">Please arrange payment on or before ${date(notice.due_by)}.</div><table><thead><tr><th>No.</th><th>Source</th><th>Invoice</th><th>Invoice Date</th><th>Due Date</th><th>Days Overdue</th><th class="num">Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No invoice snapshot available</td></tr>'}</tbody></table><div class="totals"><div><span>Overdue Amount</span><strong>${money(notice.overdue_amount)}</strong></div><div class="total"><span>Total Outstanding</span><span>${money(notice.total_outstanding)}</span></div></div>${notice.notes ? `<div class="notes"><strong>Remarks</strong><br>${escapeHtml(notice.notes)}</div>` : ''}<div class="message"><p>If payment has already been made, please disregard this reminder and share the payment reference so that we can update our records.</p></div><div class="sign"><span>Accounts Receivable</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Pop-up was blocked. Allow pop-ups and try again.');
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (err: any) {
      printWindow?.close();
      alert(err?.message || 'Failed to prepare the payment reminder');
    }
  };

  const downloadDunningNoticePdf = async (notice: DunningNoticeDetail) => {
    try {
      const blob = await apiClient.getBlob(`/sales/dunning-notices/${notice.id}/pdf`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${notice.notice_number || 'payment-reminder'}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err: any) {
      alert(err?.message || 'Failed to download the payment reminder PDF');
    }
  };

  const issueDunningNotice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!statementCustomer) return;
    setStatementLoading(true);
    try {
      const result = await apiClient.post<any>(`/sales/customers/${statementCustomer.id}/dunning-notices`, {
        dunning_level: Number(dunningForm.dunning_level),
        due_by: dunningForm.due_by,
        notes: dunningForm.notes.trim(),
      });
      alert(result?.message || `Dunning notice ${result?.notice_number || ''} issued.`);
      setShowDunningForm(false);
      setDunningForm({ dunning_level: '1', due_by: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), notes: '' });
      await loadCustomerStatement(statementCustomer);
    } catch (err: any) {
      alert(err?.message || 'Failed to issue dunning notice');
    } finally {
      setStatementLoading(false);
    }
  };

  const cancelDunningNotice = async (notice: CustomerAccountStatement['dunning_notices'][number]) => {
    if (!statementCustomer) return;
    const reason = window.prompt(`Reason for cancelling ${notice.notice_number}:`)?.trim();
    if (!reason) return;
    try {
      await apiClient.post(`/sales/dunning-notices/${notice.id}/cancel`, { reason });
      await loadCustomerStatement(statementCustomer);
    } catch (err: any) {
      alert(err?.message || 'Failed to cancel dunning notice');
    }
  };

  const handleDeleteCustomer = async (customer: Customer) => {
    const confirmed = await confirmDialog({
      title: 'Delete Customer',
      message: `Delete customer ${customer.customer_name}? This will deactivate the customer.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/sales/customers/${customer.id}`);
      await fetchCustomers();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete customer');
    }
  };

  const actuallyCreateQuotation = async () => {
    setLoading(true);
    setError(null);
    try {
      if (editingQuotationId) {
        await apiClient.put(`/sales/quotations/${editingQuotationId}`, quotationForm);
        alert('Quotation updated successfully!');
      } else {
        await apiClient.post('/sales/quotations', quotationForm);
        alert('Quotation created successfully!');
      }
      setShowQuotationForm(false);
      resetQuotationForm();
      fetchQuotations();
    } catch (err: any) {
      setError(err.message || 'Failed to save quotation');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!quotationForm.terms_conditions.trim()) {
      alert('Terms and Conditions are required.');
      return;
    }
    const invalidLineIndex = quotationForm.items.findIndex((item) =>
      !item.item_description.trim() || !String(item.hsn_code || '').trim(),
    );
    if (invalidLineIndex >= 0) {
      alert(`Complete the description and HSN code for quotation item ${invalidLineIndex + 1}.`);
      return;
    }
    if (quotationPhotoUploadingIndex !== null) {
      alert('Please wait for the quotation photo upload to finish.');
      return;
    }
    
    // For updates, skip duplicate check
    if (editingQuotationId) {
      await actuallyCreateQuotation();
      return;
    }

    // Check for duplicates before creating
    await quotationDuplicateDetection.checkDuplicates(
      () => apiClient.post('/sales/quotations/check-duplicates', quotationForm),
      () => actuallyCreateQuotation(),
    );
  };

  const handleViewQuotation = async (quotationId: string) => {
    try {
      const data = await apiClient.get(`/sales/quotations/${quotationId}`);
      setViewingQuotation(data);
    } catch (err: any) {
      alert(err.message || 'Failed to load quotation');
    }
  };

  const handleEditQuotation = async (quotationId: string) => {
    try {
      const data: any = await apiClient.get(`/sales/quotations/${quotationId}`);
      setEditingQuotationId(quotationId);
      setQuotationForm({
        customer_id: data.customer_id || '',
        quotation_date: data.quotation_date?.split('T')[0] || '',
        valid_until: data.valid_until?.split('T')[0] || '',
        payment_terms: data.payment_terms || '',
        delivery_terms: data.delivery_terms || '',
        notes: data.notes || '',
        currency_code: data.currency_code || regionalProfile.currency,
        place_of_supply: data.place_of_supply || '',
        incoterm: data.incoterm || '',
        customer_reference: data.customer_reference || '',
        terms_conditions: data.terms_conditions || '',
        items: (data.quotation_items || []).map((item: any) => ({
          item_id: item.item_id || '',
          item_description: item.item_description || '',
          quantity: Number(item.sales_quantity ?? item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
          discount_percentage:
            item.discount_percentage !== undefined ? Number(item.discount_percentage) : 0,
          tax_percentage: item.tax_percentage !== undefined ? Number(item.tax_percentage) : 18,
          hsn_code: item.hsn_code || '',
          ordered_uom: item.ordered_uom || item.base_uom || 'PCS',
          price_uom: item.price_uom || item.ordered_uom || item.base_uom || 'PCS',
          photos: Array.isArray(item.photos) ? item.photos : [],
        })),
      });
      setShowQuotationForm(true);
    } catch (err: any) {
      alert(err.message || 'Failed to load quotation for editing');
    }
  };

  const handleDeleteQuotation = async (quotation: Quotation) => {
    if (quotation.status !== 'DRAFT') return;
    const confirmed = await confirmDialog({
      title: 'Delete Quotation',
      message: `Delete quotation ${quotation.quotation_number}?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/sales/quotations/${quotation.id}`);
      await fetchQuotations();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete quotation');
    }
  };

  const handleReviseQuotation = async (quotation: Quotation) => {
    const confirmed = await confirmDialog({
      title: 'Create Quotation Revision',
      message: `Create a new editable draft from ${quotation.quotation_number}? The original quotation will remain unchanged for audit purposes.`,
      confirmLabel: 'Create Revision',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      const revision = await apiClient.post<any>(`/sales/quotations/${quotation.id}/revise`, {});
      await fetchQuotations();
      alert(`${revision.message}. The new revision is now open for editing.`);
      await handleEditQuotation(revision.id);
    } catch (err: any) {
      alert('Failed to create quotation revision: ' + err.message);
    }
  };

  const openQuotationCommunication = async (quotation: Quotation) => {
    try {
      const [detail, activities] = await Promise.all([
        apiClient.get<any>(`/sales/quotations/${quotation.id}`),
        apiClient.get<any[]>(`/sales/quotations/${quotation.id}/activities`),
      ]);
      setCommunicationQuotation(detail);
      setQuotationActivities(activities || []);
      setQuotationCommunicationForm({
        email: detail.customers?.email || '',
        subject: `Sales quotation ${detail.quotation_number}`,
        message: '',
        follow_up_at: '',
      });
    } catch (err: any) {
      alert(err?.message || 'Failed to load quotation communication history');
    }
  };

  const refreshQuotationActivities = async (quotationId: string) => {
    setQuotationActivities(await apiClient.get<any[]>(`/sales/quotations/${quotationId}/activities`));
  };

  const sendQuotationCommunication = async (reminder: boolean) => {
    if (!communicationQuotation || !quotationCommunicationForm.email.trim()) {
      alert('Enter the customer email address.');
      return;
    }
    setQuotationCommunicationSaving(true);
    try {
      const path = reminder ? 'send-response-reminder' : 'send-email';
      const result = await apiClient.post<any>(`/sales/quotations/${communicationQuotation.id}/${path}`, {
        to: quotationCommunicationForm.email.trim(),
        subject: quotationCommunicationForm.subject.trim() || undefined,
        message: quotationCommunicationForm.message.trim() || undefined,
        follow_up_at: quotationCommunicationForm.follow_up_at || undefined,
      });
      alert(result.message);
      await refreshQuotationActivities(communicationQuotation.id);
    } catch (err: any) {
      alert(err?.message || 'Quotation email could not be sent');
    } finally {
      setQuotationCommunicationSaving(false);
    }
  };

  const addQuotationCustomerComment = async () => {
    if (!communicationQuotation || !quotationCommunicationForm.message.trim()) {
      alert('Enter the customer comment or feedback.');
      return;
    }
    setQuotationCommunicationSaving(true);
    try {
      await apiClient.post(`/sales/quotations/${communicationQuotation.id}/comments`, {
        subject: quotationCommunicationForm.subject.trim() || 'Customer feedback',
        comments: quotationCommunicationForm.message.trim(),
        follow_up_at: quotationCommunicationForm.follow_up_at || undefined,
      });
      setQuotationCommunicationForm((current) => ({ ...current, message: '', follow_up_at: '' }));
      await refreshQuotationActivities(communicationQuotation.id);
    } catch (err: any) {
      alert(err?.message || 'Customer comment could not be saved');
    } finally {
      setQuotationCommunicationSaving(false);
    }
  };

  const handleSendInvoiceEmail = async (invoice: SalesInvoice) => {
    const recipient = window.prompt('Send invoice to email:', (invoice.customer as any)?.email || '')?.trim();
    if (!recipient) return;
    try {
      const result = await apiClient.post<any>(`/sales/invoices/${invoice.id}/send-email`, { to: recipient });
      alert(result.message);
    } catch (err: any) {
      alert(err?.message || 'Sales invoice email could not be sent');
    }
  };

  const handleSendDispatchEmail = async (dispatch: any) => {
    const recipient = window.prompt(`Send dispatch note ${dispatch.dn_number} to email:`, '')?.trim();
    if (!recipient) return;
    try {
      const result = await apiClient.post<any>(`/sales/dispatch/${dispatch.id}/send-email`, { to: recipient });
      alert(result.message);
    } catch (err: any) {
      alert(err?.message || 'Dispatch note email could not be sent');
    }
  };

  const handleSendCustomerReceiptEmail = async (invoice: SalesInvoice, payment: any) => {
    const recipient = window.prompt(`Send receipt ${payment.receipt_number} to email:`, (invoice.customer as any)?.email || '')?.trim();
    if (!recipient) return;
    try {
      const result = await apiClient.post<any>(`/sales/invoices/${invoice.id}/payments/${payment.id}/send-email`, { to: recipient });
      alert(result.message);
    } catch (err: any) {
      alert(err?.message || 'Customer receipt email could not be sent');
    }
  };

  const handleRejectQuotation = async () => {
    if (!rejectingQuotation) return;
    const reason = quotationRejectionReason.trim();
    if (reason.length < 5) {
      alert('Enter a rejection reason of at least 5 characters.');
      return;
    }

    setQuotationDecisionSaving(true);
    try {
      const result = await apiClient.put<any>(`/sales/quotations/${rejectingQuotation.id}/reject`, { reason });
      setRejectingQuotation(null);
      setQuotationRejectionReason('');
      await fetchQuotations();
      alert(result.message || `Quotation ${rejectingQuotation.quotation_number} rejected.`);
    } catch (err: any) {
      alert('Failed to reject quotation: ' + err.message);
    } finally {
      setQuotationDecisionSaving(false);
    }
  };

  const handleOpenSOConversion = async (quotation: Quotation) => {
    try {
      // Fetch full quotation details with items
      const fullQuotation = await apiClient.get<any>(`/sales/quotations/${quotation.id}`);
      setSelectedQuotationForSO(fullQuotation);
      
      // Initialize conversion items with pending quantities
      const initialConversionItems: {[key: string]: number} = {};
      if (fullQuotation.quotation_items) {
        fullQuotation.quotation_items.forEach((item: QuotationItem) => {
          const pendingQty = item.pending_quantity || (item.quantity - (item.converted_quantity || 0));
          initialConversionItems[item.id!] = pendingQty;
        });
      }
      setConversionItems(initialConversionItems);
      
      setSOConversionForm({
        ...soConversionForm,
        payment_terms: fullQuotation.payment_terms || '',
      });
      setShowSOConversionForm(true);
    } catch (err: any) {
      alert('Failed to load quotation details: ' + err.message);
    }
  };

  const openFulfilmentPlanning = async (order: SalesOrder) => {
    try {
      const detail: any = await apiClient.get(`/sales/orders/${order.id}`);
      const lines = (detail.sales_order_items || detail.items || [])
        .map((line: any) => ({
          sales_order_item_id: line.id,
          item_id: line.item_id,
          description: line.item_description || items.find((item) => item.id === line.item_id)?.name || 'Sales-order item',
          quantity: Math.max(0, Number(line.quantity || 0) - Number(line.dispatched_quantity || 0)),
        }))
        .filter((line: any) => line.quantity > 0);
      if (lines.length === 0) throw new Error('This sales order has no unfulfilled quantity');
      if (warehouses.length === 0) await fetchWarehouses();
      setFulfilmentOrder(order);
      setFulfilmentForm({ planned_dispatch_date: order.expected_delivery_date || todayDate, warehouse_id: warehouses[0]?.id || '', priority: 'NORMAL', notes: '', items: lines });
      setShowFulfilmentForm(true);
    } catch (err: any) {
      alert(err?.message || 'Unable to open fulfilment planning');
    }
  };

  const handleCreateFulfilment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fulfilmentOrder) return;
    const lines = fulfilmentForm.items.filter((line) => Number(line.quantity) > 0);
    if (lines.length === 0) return alert('Enter at least one fulfilment quantity.');
    setLoading(true);
    try {
      const result: any = await apiClient.post('/sales/fulfilment', {
        sales_order_id: fulfilmentOrder.id,
        planned_dispatch_date: fulfilmentForm.planned_dispatch_date,
        warehouse_id: fulfilmentForm.warehouse_id || null,
        priority: fulfilmentForm.priority,
        notes: fulfilmentForm.notes,
        items: lines.map(({ sales_order_item_id, quantity }) => ({ sales_order_item_id, quantity })),
      });
      alert(`Fulfilment task ${result.task_number} created.`);
      setShowFulfilmentForm(false);
      setFulfilmentOrder(null);
      setActiveTab('fulfilment');
      await fetchFulfilmentTasks();
    } catch (err: any) {
      alert(err?.message || 'Fulfilment task could not be created');
    } finally {
      setLoading(false);
    }
  };

  const handleFulfilmentAction = async (task: FulfilmentTask, action: string) => {
    let reason = '';
    if (action === 'CANCEL') {
      reason = window.prompt('Enter the fulfilment cancellation reason:')?.trim() || '';
      if (!reason) return;
      if (!await confirmDialog({ title: 'Cancel fulfilment task?', message: `${task.task_number} will be cancelled and its quantity released for replanning.`, confirmLabel: 'Cancel task' })) return;
    }
    const body: any = { action, reason };
    if (action === 'CONFIRM_PICK') body.items = (task.items || []).map((line) => ({ sales_order_item_id: line.sales_order_item_id, quantity: Number(line.planned_quantity), batch_number: line.batch_number || '', storage_bin: line.storage_bin || '' }));
    if (action === 'CONFIRM_PACK') body.items = (task.items || []).map((line) => ({ sales_order_item_id: line.sales_order_item_id, quantity: Number(line.picked_quantity) }));
    try {
      const result: any = await apiClient.post(`/sales/fulfilment/${task.id}/action`, body);
      alert(result?.message || `${task.task_number} updated.`);
      await fetchFulfilmentTasks();
    } catch (err: any) {
      alert(err?.message || 'Fulfilment action failed');
    }
  };

  const openDispatchFromFulfilment = async (task: FulfilmentTask) => {
    const order = orders.find((row) => row.id === task.sales_order_id) || task.sales_order;
    if (!order) return alert('Sales order details are unavailable. Refresh and retry.');
    const detail: any = await apiClient.get(`/sales/orders/${task.sales_order_id}`);
    const orderLines = detail.sales_order_items || detail.items || [];
    setSalesOrderItems(orderLines);
    setSelectedOrderForDispatch(order as SalesOrder);
    const dispatchLines = (task.items || []).map((line) => ({ sales_order_item_id: line.sales_order_item_id, item_id: line.item_id, uid: [] as string[], quantity: 0, batch_number: line.batch_number || '' }));
    setDispatchForm({ sales_order_id: task.sales_order_id, fulfilment_task_id: task.id, dispatch_date: todayDate, transporter_name: '', vehicle_number: '', lr_number: '', lr_date: todayDate, delivery_address: '', notes: `Fulfilment ${task.task_number}`, items: dispatchLines });
    dispatchLines.forEach((line, index) => void fetchAvailableUIDs(line.item_id, index));
    setShowDispatchForm(true);
  };

  const handleCreateDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all items have UIDs selected
    const itemsWithoutUIDs = dispatchForm.items.filter(item => !item.uid || item.uid.length === 0);
    if (itemsWithoutUIDs.length > 0) {
      alert('❌ All dispatch items must have UIDs selected.\n\nPlease select at least one UID for each item before creating the dispatch.');
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      // Prepare dispatch payload with customer_id from selected order
      const dispatchPayload = {
        ...dispatchForm,
        customer_id: selectedOrderForDispatch?.customer_id,
      };

      await apiClient.post('/sales/dispatch', dispatchPayload);
      alert('Dispatch note created successfully!');
      setShowDispatchForm(false);
      setSelectedOrderForDispatch(null);
      setSalesOrderItems([]);
      setAvailableUIDs({});
      setDispatchForm({
        sales_order_id: '',
        fulfilment_task_id: '',
        dispatch_date: getTodayDateInputValue(),
        transporter_name: '',
        vehicle_number: '',
        lr_number: '',
        lr_date: getTodayDateInputValue(),
        delivery_address: '',
        notes: '',
        items: [],
      });
      fetchDispatches();
      fetchOrders();
      fetchWarranties();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to create dispatch';
      setError(errorMessage);
      alert('❌ Dispatch Creation Failed:\n\n' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const addQuotationItem = () => {
    // Validate last row before adding new one
    if (quotationForm.items.length > 0) {
      const lastItem = quotationForm.items[quotationForm.items.length - 1];
      if (!lastItem.item_id || lastItem.quantity <= 0) {
        alert('Please complete the current row before adding a new one');
        return;
      }
    }

    setQuotationForm({
      ...quotationForm,
      items: [
        ...quotationForm.items,
        {
          item_id: '',
          item_description: '',
          quantity: 1,
          unit_price: 0,
          discount_percentage: 0,
          tax_percentage: 18,
          hsn_code: '',
          photos: [],
        },
      ],
    });
  };

  const uploadQuotationPhotos = async (index: number, files: FileList | null) => {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    const invalid = selectedFiles.find((file) => !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024);
    if (invalid) {
      alert('Quotation photos must be image files of 10 MB or less each.');
      return;
    }
    setQuotationPhotoUploadingIndex(index);
    try {
      const uploaded: QuotationPhoto[] = [];
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('bucket', 'drawings');
        formData.append('folder', 'sales-quotation-photos');
        const result: any = await apiClient.postForm('/upload', formData);
        if (!result?.url) throw new Error(`No upload URL returned for ${file.name}`);
        uploaded.push({ url: result.url, name: file.name, type: file.type, size: file.size });
      }
      setQuotationForm((current) => ({
        ...current,
        items: current.items.map((row, rowIndex) => rowIndex === index
          ? { ...row, photos: [...(row.photos || []), ...uploaded] }
          : row),
      }));
    } catch (error: any) {
      alert(error?.message || 'Failed to upload quotation photo');
    } finally {
      setQuotationPhotoUploadingIndex(null);
    }
  };

  const removeQuotationPhoto = (itemIndex: number, photoIndex: number) => {
    setQuotationForm((current) => ({
      ...current,
      items: current.items.map((row, rowIndex) => rowIndex === itemIndex
        ? { ...row, photos: (row.photos || []).filter((_, index) => index !== photoIndex) }
        : row),
    }));
  };

  const updateQuotationItem = (index: number, field: keyof QuotationItem, value: any) => {
    // Check for duplicate items when changing item_id
    if (field === 'item_id' && value) {
      const isDuplicate = quotationForm.items.some((item, i) => 
        i !== index && item.item_id === value
      );
      if (isDuplicate) {
        alert('This item is already added to the quotation. Please select a different item.');
        return;
      }
    }
    
    const newItems = [...quotationForm.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setQuotationForm({ ...quotationForm, items: newItems });
  };

  const removeQuotationItem = (index: number) => {
    setQuotationForm({
      ...quotationForm,
      items: quotationForm.items.filter((_, i) => i !== index),
    });
  };

  const addDispatchItem = () => {
    // Validate last row before adding new one
    if (dispatchForm.items.length > 0) {
      const lastItem = dispatchForm.items[dispatchForm.items.length - 1];
      if (!lastItem.sales_order_item_id || lastItem.quantity <= 0) {
        alert('Please complete the current row before adding a new one');
        return;
      }
    }

    setDispatchForm({
      ...dispatchForm,
      items: [
        ...dispatchForm.items,
        {
          sales_order_item_id: '',
          item_id: '',
          uid: [],
          quantity: 1,
          batch_number: '',
        },
      ],
    });
  };

  const updateDispatchItem = (index: number, field: string, value: any) => {
    const newItems = [...dispatchForm.items];
    if (field === 'sales_order_item_id') {
      // Check for duplicate sales order items
      const isDuplicate = dispatchForm.items.some((item, i) => 
        i !== index && item.sales_order_item_id === value
      );
      if (isDuplicate) {
        alert('This sales order item is already added to the dispatch. Please select a different item.');
        return;
      }
      
      // Auto-fill item_id from selected SO item
      const soItem = salesOrderItems.find(item => item.id === value);
      if (soItem) {
        newItems[index] = { 
          ...newItems[index], 
          sales_order_item_id: value,
          item_id: soItem.item_id,
          // Quantity is based on selected *saleable* UIDs (auto-fills)
          quantity: 0,
          uid: [] // Reset UID when item changes
        };
        // Fetch available UIDs for this item
        fetchAvailableUIDs(soItem.item_id, index);
      } else {
        newItems[index] = { ...newItems[index], [field]: value };
      }
    } else if (field === 'uid') {
      // Handle UID array changes and auto-update quantity
      newItems[index] = { ...newItems[index], uid: value, quantity: value.length };
    } else {
      newItems[index] = { ...newItems[index], [field]: value };
    }
    setDispatchForm({ ...dispatchForm, items: newItems });
  };

  const removeDispatchItem = (index: number) => {
    setDispatchForm({
      ...dispatchForm,
      items: dispatchForm.items.filter((_, i) => i !== index),
    });
  };

  const fetchSalesOrderItems = async (orderId: string) => {
    try {
      const data = await apiClient.get(`/sales/orders/${orderId}`);
      const itemsArray = data.sales_order_items || data.items || [];
      setSalesOrderItems(itemsArray);
      if (itemsArray.length === 0) {
        alert('⚠️ Warning: This sales order has no items. Please check the sales order.');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || 'Unknown error';
      alert('❌ Failed to fetch sales order items:\n\n' + errorMsg);
      setSalesOrderItems([]);
    }
  };

  const fetchAvailableUIDs = async (itemId: string, rowIndex: number) => {
    if (!itemId) return;
    
    setLoadingUIDs({ ...loadingUIDs, [rowIndex]: true });
    try {
      // Fetch only saleable UIDs for dispatch: QC PASSED + IN_STOCK status
      const response = await apiClient.get(
        `/uid?item_id=${itemId}&status=IN_STOCK&quality_status=PASSED&limit=5000&sortBy=created_at&sortOrder=asc`
      );
      // Handle paginated response structure: { data: [...], pagination: {...} }
      const uids = response?.data || (Array.isArray(response) ? response : []);
      setAvailableUIDs({ ...availableUIDs, [itemId]: uids });
      
      if (uids.length === 0) {
        alert(`⚠️ No saleable UIDs found for this item. Ensure QC is PASSED and inventory is IN_STOCK.`);
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || 'Unknown error';
      alert('❌ Failed to fetch available UIDs:\n\n' + errorMsg);
      setAvailableUIDs({ ...availableUIDs, [itemId]: [] });
    } finally {
      setLoadingUIDs({ ...loadingUIDs, [rowIndex]: false });
    }
  };

  const actuallyConvertToSO = async (payload: any) => {
    setLoading(true);
    setError(null);
    try {
      await apiClient.post(`/sales/quotations/${selectedQuotationForSO!.id}/convert-to-so`, payload);
      alert('Quotation converted to Sales Order successfully!');
      setShowSOConversionForm(false);
      setSelectedQuotationForSO(null);
      setSOConversionForm({
        expected_delivery_date: '',
        advance_amount: 0,
        payment_terms: '',
        special_instructions: '',
        project: '',
      });
      setConversionItems({});
      fetchQuotations();
      fetchOrders();
    } catch (err: any) {
      setError(err.message || 'Failed to convert quotation');
      alert('Failed to convert quotation: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConvertToSO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuotationForSO) return;
    
    // Build items array with selected quantities
    const items = Object.entries(conversionItems)
      .filter(([_, qty]) => qty > 0)
      .map(([quotation_item_id, quantity]) => ({
        quotation_item_id,
        quantity,
      }));
    
    if (items.length === 0) {
      alert('Please specify quantities to convert for at least one item.');
      return;
    }
    
    const payload = {
      ...soConversionForm,
      items,
      customer_id: selectedQuotationForSO.customer_id,
    };

    // Check for duplicates before converting
    await salesOrderDuplicateDetection.checkDuplicates(
      () => apiClient.post('/sales/orders/check-duplicates', payload),
      () => actuallyConvertToSO(payload),
    );
  };

  const actuallyCreateDirectSO = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiClient.post('/sales/orders', directSOForm);
      alert('Direct Sales Order created successfully!');
      setShowDirectSOForm(false);
      setDirectSOForm({
        customer_id: '',
        order_date: getTodayDateInputValue(),
        expected_delivery_date: '',
        payment_terms: '',
        project: '',
        source_type: 'DIRECT',
        customer_po_number: '',
        customer_po_date: '',
        currency_code: regionalProfile.currency,
        place_of_supply: '',
        incoterm: '',
        items: [],
      });
      fetchOrders();
    } catch (err: any) {
      setError(err.message || 'Failed to create direct sales order');
      alert('Failed to create direct sales order: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDirectSO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directSOForm.customer_id) {
      alert('Please select a customer');
      return;
    }
    if (directSOForm.items.length === 0) {
      alert('Please add at least one item');
      return;
    }
    
    // Check for duplicates before creating
    await salesOrderDuplicateDetection.checkDuplicates(
      () => apiClient.post('/sales/orders/check-duplicates', directSOForm),
      () => actuallyCreateDirectSO(),
    );
  };

  const handleCreateWarranty = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiClient.post('/sales/warranties', warrantyForm);
      alert('Warranty registered successfully!');
      setShowWarrantyForm(false);
      setWarrantyForm({
        uid: '',
        warranty_duration_months: 12,
        warranty_type: 'STANDARD',
        notes: '',
      });
      fetchWarranties();
    } catch (err: any) {
      setError(err.message || 'Failed to register warranty');
      alert('Failed to register warranty: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'bg-gray-100 text-gray-800',
      PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      CONVERTED: 'bg-blue-100 text-blue-800',
      CONFIRMED: 'bg-green-100 text-green-800',
      IN_PRODUCTION: 'bg-purple-100 text-purple-800',
      READY_TO_DISPATCH: 'bg-orange-100 text-orange-800',
      DISPATCHED: 'bg-blue-100 text-blue-800',
      DELIVERED: 'bg-green-100 text-green-800',
      ACTIVE: 'bg-green-100 text-green-800',
      EXPIRED: 'bg-gray-100 text-gray-800',
      CLAIMED: 'bg-yellow-100 text-yellow-800',
      VOID: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const router = useRouter();

  // Smart Job Order (from Sales Order) state
  const [showSmartJOModal, setShowSmartJOModal] = useState(false);
  useEscapeKey(showSmartJOModal, () => setShowSmartJOModal(false));
  const [smartJOOrder, setSmartJOOrder] = useState<SalesOrder | null>(null);
  const [smartJOSOItems, setSmartJOSOItems] = useState<any[]>([]);
  const [smartJOSelectedSOItemId, setSmartJOSelectedSOItemId] = useState<string>('');
  const [smartJOLoading, setSmartJOLoading] = useState(false);

  const openSmartJOForSO = async (order: SalesOrder) => {
    setSmartJOLoading(true);
    try {
      const [so, mappedJobOrders] = await Promise.all([
        apiClient.get<any>(`/sales/orders/${order.id}`),
        apiClient.get<any[]>('/job-orders', { salesOrderId: order.id }),
      ]);
      const soItems = (so?.sales_order_items || so?.items || []) as any[];

      const blockedBySoItemId = new Map<string, number>();
      for (const jo of Array.isArray(mappedJobOrders) ? mappedJobOrders : []) {
        const status = String(jo?.status || '').toUpperCase();
        if (status === 'COMPLETED' || status === 'CANCELLED') continue;
        const soItemId = String(jo?.sales_order_item_id || jo?.salesOrderItemId || '').trim();
        if (!soItemId) continue;
        blockedBySoItemId.set(soItemId, (blockedBySoItemId.get(soItemId) || 0) + (Number(jo?.quantity || 0) || 0));
      }

      const remaining = (Array.isArray(soItems) ? soItems : [])
        .map((soItem) => {
          const blockedQty = Number(blockedBySoItemId.get(String(soItem.id)) || 0);
          const remainingQty = Number(soItem.quantity) - Number(soItem.dispatched_quantity || 0) - blockedQty;
          return {
            ...soItem,
            blockedQty,
            remainingQty,
          };
        })
        .filter((soItem) => soItem.item_id && Number(soItem.remainingQty) > 0);

      if (remaining.length === 0) {
        router.push(
          `/dashboard/production/job-orders/smart-items?salesOrderId=${encodeURIComponent(order.id)}`,
        );
        return;
      }

      if (remaining.length === 1) {
        const soItem = remaining[0];
        router.push(
          `/dashboard/production/job-orders/smart-items?salesOrderId=${encodeURIComponent(order.id)}` +
            `&salesOrderItemId=${encodeURIComponent(soItem.id)}` +
            `&itemId=${encodeURIComponent(soItem.item_id)}` +
            `&quantity=${encodeURIComponent(String(soItem.remainingQty))}`,
        );
        return;
      }

      setSmartJOOrder(order);
      setSmartJOSOItems(remaining);
  setSmartJOSelectedSOItemId('');
      setShowSmartJOModal(true);
    } catch (err: any) {
      alert(`Failed to load sales order items: ${err?.message || 'Unknown error'}`);
    } finally {
      setSmartJOLoading(false);
    }
  };

  // Pagination and sorting helpers
  const getPaginatedAndSortedData = <T extends Record<string, any>>(data: T[], sortKey: keyof T = 'created_at' as keyof T) => {
    const normalizedSearch = registerSearch.trim().toLowerCase();
    const filteredData = data.filter((record) => {
      const searchable = JSON.stringify(record).toLowerCase();
      const recordStatus = String(record.status ?? record.payment_status ?? record.billing_status ?? (record.is_active === true ? 'ACTIVE' : record.is_active === false ? 'INACTIVE' : '')).toUpperCase();
      return (!normalizedSearch || searchable.includes(normalizedSearch)) &&
        (registerStatus === 'ALL' || recordStatus === registerStatus);
    });
    // Sort data
    const sortedData = [...filteredData].sort((a, b) => {
      const aVal: any = a[sortColumn as keyof T] ?? a[sortKey];
      const bVal: any = b[sortColumn as keyof T] ?? b[sortKey];
      
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      
      if (aVal instanceof Date && bVal instanceof Date) {
        return sortDirection === 'asc' ? aVal.getTime() - bVal.getTime() : bVal.getTime() - aVal.getTime();
      }
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // Try to parse as dates if they're strings
      const aNum = typeof aVal === 'number' ? aVal : (typeof aVal === 'string' ? new Date(aVal).getTime() : 0);
      const bNum = typeof bVal === 'number' ? bVal : (typeof bVal === 'string' ? new Date(bVal).getTime() : 0);
      
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    });
    
    // Paginate
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedData = sortedData.slice(startIndex, endIndex);
    const totalPages = Math.ceil(sortedData.length / itemsPerPage);
    
    return { paginatedData, totalPages, totalItems: sortedData.length };
  };

  const salesSortKeys: Record<string, string> = {
    'code': 'customer_code', 'customer': 'customer_name', 'type': 'customer_type',
    'credit limit': 'credit_limit', 'status': 'status', 'qt number': 'quotation_number',
    'date': 'quotation_date', 'valid until': 'valid_until', 'amount': 'net_amount',
    'so number': 'so_number', 'project': 'project', 'order date': 'order_date',
    'delivery date': 'expected_delivery_date', 'balance': 'balance_amount',
    'task': 'task_number', 'planned dispatch': 'planned_dispatch_date', 'priority': 'priority',
    'dn number': 'dn_number', 'dispatch date': 'dispatch_date', 'transporter': 'transporter_name',
    'vehicle no.': 'vehicle_number', 'invoice': 'invoice_number', 'sales order': 'so_number',
    'dispatch': 'dn_number', 'invoice date': 'invoice_date', 'invoice value': 'net_amount',
    'received': 'paid_amount', 'outstanding': 'balance_amount', 'warranty no.': 'warranty_number',
    'source': 'source', 'due / ageing': 'days_overdue', 'collection status': 'status', 'latest reminder': 'created_at',
    'return': 'return_number', 'return date': 'return_date', 'reason': 'reason', 'lines / qty': 'created_at',
    'uid': 'uid', 'start date': 'warranty_start_date', 'duration': 'warranty_period_months',
    'end date': 'end_date', 'claims': 'claim_count',
  };

  const handleRegisterHeaderClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const header = (event.target as HTMLElement).closest('th');
    if (!header) return;
    const label = (header.textContent || '').trim().toLowerCase();
    if (label === 'actions') return;
    const key = salesSortKeys[label];
    if (!key) return;
    setSortDirection((current) => sortColumn === key ? (current === 'asc' ? 'desc' : 'asc') : 'asc');
    setSortColumn(key);
    setCurrentPage(1);
  };

  const activeRegisterData: Record<string, any[]> = { customers, quotations, orders, fulfilment: fulfilmentTasks, dispatch: dispatches, billing: invoices, collections: collectionsWorklist?.items || [], returns: salesReturns, warranties };
  const registerStatuses = Array.from(new Set((activeRegisterData[activeTab] || []).map((record) =>
    String(record.status ?? record.payment_status ?? record.billing_status ?? (record.is_active === true ? 'ACTIVE' : record.is_active === false ? 'INACTIVE' : '')).toUpperCase(),
  ).filter(Boolean))).sort();

  const renderPagination = (totalPages: number, totalItems: number) => {
    if (totalPages <= 1) return null;
    
    return (
      <div className="mt-3 flex flex-col items-center justify-between gap-4 rounded-md border border-[#E8DCC4] bg-white px-4 py-3 sm:flex-row">
        <div className="text-sm text-[#6F4E37]">
          Showing {Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded-md border border-[#D9C9AD] px-3 py-1 text-sm font-semibold text-[#6F4E37] hover:bg-[#F6EFE2] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (currentPage <= 3) {
              pageNum = i + 1;
            } else if (currentPage >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = currentPage - 2 + i;
            }
            return (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`rounded-md border px-3 py-1 text-sm font-semibold ${
                  currentPage === pageNum
                    ? 'border-[#8B6F47] bg-[#8B6F47] text-white'
                    : 'border-[#D9C9AD] text-[#6F4E37] hover:bg-[#F6EFE2]'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded-md border border-[#D9C9AD] px-3 py-1 text-sm font-semibold text-[#6F4E37] hover:bg-[#F6EFE2] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="ml-2 rounded-md border border-[#D9C9AD] bg-white px-2 py-1 text-sm text-[#3F2D20]"
          >
            <option value={10}>10 / page</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>
      </div>
    );
  };

  const pendingQuotationApprovals = quotations.filter((quotation) => quotation.status === 'DRAFT').length;
  const ordersReadyForDispatch = orders.filter((order) => ['CONFIRMED', 'READY_TO_DISPATCH', 'PARTIAL'].includes(String(order.status || ''))).length;
  const overdueReceivables = invoices
    .filter((invoice) => invoice.billing_status !== 'CANCELLED' && Number(invoice.balance_amount || 0) > 0 && invoice.due_date && invoice.due_date < todayDate)
    .reduce((sum, invoice) => sum + Number(invoice.balance_amount || 0), 0);
  const returnsPendingQc = salesReturns.filter((salesReturn) => salesReturn.status === 'RECEIVED_PENDING_QC').length;

  return (
    <div id="sales-management-root" onClickCapture={handleRegisterHeaderClick} className="min-h-screen bg-[#FAF9F6] p-6 text-[#2F241D]">
      <style jsx global>{`
        #sales-management-root table > thead > tr > th:not(:last-child) { resize: horizontal; overflow: hidden; min-width: 92px; cursor: pointer; user-select: none; }
        #sales-management-root table > thead > tr > th:not(:last-child):hover { background-color: #efe3cf; }
      `}</style>
      <div className="w-full max-w-none space-y-5">
        <div className="rounded-md border border-[#E8DCC4] bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Sales & Dispatch</div>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-[#3F2D20]">Order-to-Cash Control Center</h1>
              <p className="mt-1 text-sm text-[#6F4E37]">
                Manage the complete order-to-cash cycle from customer and quotation through delivery, billing, receipt, and warranty.
              </p>
            </div>
            {canCreate && activeTab === 'orders' && (
              <button
                onClick={() => setShowDirectSOForm(true)}
                className="rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#745A37]"
              >
                New Sales Order
              </button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-[#E8DCC4] bg-white">
          <div className="grid grid-cols-2 md:grid-cols-4">
            {[
              ['Quotes awaiting approval', pendingQuotationApprovals, 'quotations'],
              ['Orders ready for fulfilment', ordersReadyForDispatch, 'orders'],
              ['Overdue receivables', formatSalesAmount(overdueReceivables), 'collections'],
              ['Returns awaiting QC', returnsPendingQc, 'returns'],
            ].map(([label, value, tab], index) => <button type="button" key={String(label)} onClick={() => setActiveTab(tab as TabType)} className={`p-4 text-left hover:bg-[#FCF8F1] ${index < 3 ? 'border-r border-[#E8DCC4]' : ''}`}><div className="text-xs font-semibold uppercase text-[#7A6756]">{label}</div><div className="mt-1 text-2xl font-bold text-[#3F2D20]">{value}</div></button>)}
          </div>
          <div className="border-t border-[#E8DCC4] bg-[#FCFAF6] px-4 py-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Controlled document chain</div>
            <div className="grid gap-2 text-xs md:grid-cols-8">
              {['Business Partner', 'Quotation', 'Approval', 'Sales Order', 'ATP / Release', 'Pick / Pack / PGI', 'Billing', 'Collection / Return'].map((stage, index) => <div key={stage} className="flex items-center gap-2 rounded border border-[#E8DCC4] bg-white px-3 py-2 font-semibold text-[#5C4738]"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#8B6F47] text-[10px] text-white">{index + 1}</span>{stage}</div>)}
            </div>
          </div>
        </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E8DCC4] bg-white px-4 py-3 text-sm">
        <span><b className="text-[#3F2D20]">Current workspace:</b> <span className="capitalize text-[#6F4E37]">{activeTab}</span></span>
        <span className="text-xs text-[#7A6756]">Use the Sales menu to switch between customers, quotes, orders, fulfilment, billing and collections.</span>
      </div>

      <div className="grid gap-3 rounded-md border border-[#E8DCC4] bg-white p-3 md:grid-cols-[minmax(260px,1fr)_220px_auto]">
        <input
          value={registerSearch}
          onChange={(event) => { setRegisterSearch(event.target.value); setCurrentPage(1); }}
          placeholder={`Search ${activeTab.replace('-', ' ')}...`}
          className="rounded-md border border-[#D9C9AD] px-3 py-2 text-sm outline-none focus:border-[#8B6F47]"
        />
        <select
          value={registerStatus}
          onChange={(event) => { setRegisterStatus(event.target.value); setCurrentPage(1); }}
          className="rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-sm"
        >
          <option value="ALL">All statuses</option>
          {registerStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
        </select>
        <div className="flex items-center justify-end gap-2 text-xs text-[#7A6756]">
          <span>Sorted by {sortColumn.replaceAll('_', ' ')} ({sortDirection}); click a header to change</span>
          {(registerSearch || registerStatus !== 'ALL') && <button type="button" onClick={() => { setRegisterSearch(''); setRegisterStatus('ALL'); setCurrentPage(1); }} className="rounded-md border border-[#D9C9AD] px-3 py-2 font-semibold text-[#6F4E37]">Clear</button>}
        </div>
      </div>

      {/* Customers Tab */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#3F2D20]">Customer Register</h2>
              <p className="text-sm text-[#6F4E37]">Business partners used for quotations, sales orders, dispatch, credit, and warranty tracking.</p>
            </div>
            {canCreate && (
            <button
              onClick={() => {
                resetCustomerForm();
                setShowCustomerForm(true);
              }}
              className="rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#745A37]"
            >
              New Customer
            </button>
            )}
          </div>

          {loading ? (
            <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center text-[#7A6756]">Loading customers...</div>
          ) : (
            <>
            <div className="overflow-x-auto rounded-md border border-[#E8DCC4] bg-white">
              <table className="min-w-[1020px] divide-y divide-[#E8DCC4]">
                <thead className="bg-[#F6EFE2]">
                  <tr>
                    <th className="sticky left-0 z-10 bg-[#F6EFE2] px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">Code</th>
                    <th className="sticky left-[120px] z-10 bg-[#F6EFE2] px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">Contact</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">Location</th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase text-[#5C4738]">Credit Limit</th>
                    <th className="px-4 py-3 text-center text-xs font-bold uppercase text-[#5C4738]">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE5D2] bg-white">
                  {(() => {
                    const { paginatedData, totalPages, totalItems } = getPaginatedAndSortedData(customers, 'customer_code');
                    return (
                      <>
                        {paginatedData.map((customer) => (
                          <tr key={customer.id} className="hover:bg-[#FFFDF7]">
                            <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-4 py-3 text-sm font-semibold text-[#8B6F47]">
                              {customer.customer_code}
                            </td>
                            <td className="sticky left-[120px] z-10 min-w-[260px] bg-inherit px-4 py-3 text-sm">
                              <div className="font-semibold text-[#1F2937]">{customer.customer_name}</div>
                              <div className="text-xs text-[#7A6756]">{customer.gst_number || customer.pan_number || '-'}</div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-[#5C4738]">
                              <div>{customer.contact_person || '-'}</div>
                              <div className="text-xs text-[#7A6756]">{customer.mobile || customer.phone || customer.email || '-'}</div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-[#5C4738]">{[customer.city, customer.state].filter(Boolean).join(', ') || '-'}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-[#3F2D20]">
                              {formatSalesAmount(customer.credit_limit)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-center">
                              <span
                                className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                  customer.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {customer.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2">
                                <ActionIconButton
                                  title="Customer account statement"
                                  onClick={() => openCustomerStatement(customer)}
                                >
                                  <ReceiptIndianRupee size={16} />
                                </ActionIconButton>
                                {canEdit && (
                                <ActionIconButton
                                  title="Edit customer"
                                  onClick={() => handleEditCustomer(customer)}
                                >
                                  <Pencil size={16} />
                                </ActionIconButton>
                                )}
                                {canDelete && (
                                <ActionIconButton
                                  title="Delete customer"
                                  onClick={() => handleDeleteCustomer(customer)}
                                  tone="danger"
                                >
                                  <Trash2 size={16} />
                                </ActionIconButton>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            {(() => {
              const { totalPages, totalItems } = getPaginatedAndSortedData(customers, 'customer_code');
              return renderPagination(totalPages, totalItems);
            })()}
            </>
          )}

          {/* Customer Form Workspace */}
          {showCustomerForm && (
            <div className="fixed inset-0 z-50 bg-white text-[#2F241D]">
              <div className="flex h-full flex-col bg-[#FAF9F6]">
                <div className="border-b border-[#E8DCC4] bg-white px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Customer Master</div>
                      <h3 className="mt-1 text-2xl font-bold text-[#3F2D20]">{editingCustomerId ? 'Edit Customer' : 'New Customer'}</h3>
                      <p className="mt-1 text-sm text-[#6F4E37]">Maintain customer identity, statutory details, addresses, contact, and credit controls.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCustomerForm(false);
                        resetCustomerForm();
                      }}
                      className="rounded-md border border-[#D9C9AD] px-3 py-2 text-sm font-semibold text-[#6F4E37] hover:bg-[#F6EFE2]"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <form onSubmit={handleSaveCustomer} className="flex min-h-0 flex-1 flex-col">
                  <div className="flex-1 overflow-auto px-6 py-5">
                  {customerFormError && (
                    <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                      {customerFormError}
                    </div>
                  )}
                  <div className="grid gap-4 rounded-md border border-[#E8DCC4] bg-white p-5 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
                      <input
                        type="text"
                        required
                        value={customerForm.customer_name}
                        onChange={(e) => setCustomerForm({ ...customerForm, customer_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3" />
                    <div className="md:col-span-2 xl:col-span-4 rounded-md border border-[#E8DCC4] bg-[#FCFAF6] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-[#3F2D20]">Contact Persons</div>
                          <div className="text-xs text-[#7A6756]">Add every contact with their direct mobile number and email.</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCustomerForm({ ...customerForm, contacts: [...customerForm.contacts, { name: '', mobile: '', email: '' }] })}
                          className="inline-flex items-center gap-1 rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-xs font-semibold text-[#6F4E37] hover:bg-[#F6EFE2]"
                        >
                          <Plus size={14} /> Add contact
                        </button>
                      </div>
                      <div className="space-y-3">
                        {customerForm.contacts.map((contact, index) => (
                          <div key={index} className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase text-[#8B6F47]">Name</label>
                              <input
                                type="text"
                                value={contact.name}
                                onChange={(e) => setCustomerForm({ ...customerForm, contacts: customerForm.contacts.map((row, rowIndex) => rowIndex === index ? { ...row, name: e.target.value } : row) })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                placeholder="Contact person name"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase text-[#8B6F47]">Mobile</label>
                              <input
                                type="tel"
                                value={contact.mobile}
                                onChange={(e) => setCustomerForm({ ...customerForm, contacts: customerForm.contacts.map((row, rowIndex) => rowIndex === index ? { ...row, mobile: e.target.value } : row) })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                placeholder="Mobile number"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase text-[#8B6F47]">Email</label>
                              <input
                                type="email"
                                value={contact.email}
                                onChange={(e) => setCustomerForm({ ...customerForm, contacts: customerForm.contacts.map((row, rowIndex) => rowIndex === index ? { ...row, email: e.target.value } : row) })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                placeholder="Email address"
                              />
                            </div>
                            <button
                              type="button"
                              title="Remove contact"
                              disabled={customerForm.contacts.length === 1}
                              onClick={() => setCustomerForm({ ...customerForm, contacts: customerForm.contacts.filter((_, rowIndex) => rowIndex !== index) })}
                              className="self-end rounded-md border border-red-200 p-2.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{regionalProfile.taxRegistrationLabel}</label>
                      <input
                        type="text"
                        value={customerForm.gst_number}
                        onChange={(e) => setCustomerForm({ ...customerForm, gst_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number</label>
                      <input
                        type="text"
                        value={customerForm.pan_number}
                        onChange={(e) => setCustomerForm({ ...customerForm, pan_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    {(['billing_addresses', 'shipping_addresses'] as const).map((field) => {
                      const label = field === 'billing_addresses' ? 'Billing Addresses' : 'Shipping Addresses';
                      const values = customerForm[field];
                      return (
                        <div key={field} className="md:col-span-2 rounded-md border border-[#E8DCC4] bg-[#FCFAF6] p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <label className="text-sm font-bold text-[#3F2D20]">{label}</label>
                            <button
                              type="button"
                              onClick={() => setCustomerForm({ ...customerForm, [field]: [...values, ''] })}
                              className="inline-flex items-center gap-1 rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-xs font-semibold text-[#6F4E37] hover:bg-[#F6EFE2]"
                            >
                              <Plus size={14} /> Add address
                            </button>
                          </div>
                          <div className="space-y-3">
                            {values.map((address, index) => (
                              <div key={index} className="flex items-start gap-2">
                                <textarea
                                  value={address}
                                  onChange={(e) => setCustomerForm({ ...customerForm, [field]: values.map((row, rowIndex) => rowIndex === index ? e.target.value : row) })}
                                  className="min-h-[76px] flex-1 rounded-lg border border-gray-300 px-3 py-2"
                                  rows={3}
                                  placeholder={`${field === 'billing_addresses' ? 'Billing' : 'Shipping'} address ${index + 1}`}
                                />
                                <button
                                  type="button"
                                  title="Remove address"
                                  disabled={values.length === 1}
                                  onClick={() => setCustomerForm({ ...customerForm, [field]: values.filter((_, rowIndex) => rowIndex !== index) })}
                                  className="rounded-md border border-red-200 p-2.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                      <input
                        type="text"
                        value={customerForm.city}
                        onChange={(e) => setCustomerForm({ ...customerForm, city: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                      <input
                        type="text"
                        value={customerForm.state}
                        onChange={(e) => setCustomerForm({ ...customerForm, state: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                      <input
                        type="text"
                        value={customerForm.country}
                        onChange={(e) => setCustomerForm({ ...customerForm, country: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Pin Code</label>
                      <input
                        type="text"
                        value={customerForm.pincode || ''}
                        onChange={(e) => setCustomerForm({ ...customerForm, pincode: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        maxLength={6}
                        placeholder="Enter 6-digit pin code"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit</label>
                      <input
                        type="number"
                        value={customerForm.credit_limit}
                        onChange={(e) => setCustomerForm({ ...customerForm, credit_limit: parseFloat(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Credit Days</label>
                      <input
                        type="number"
                        value={customerForm.credit_days}
                        onChange={(e) => setCustomerForm({ ...customerForm, credit_days: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tax Treatment</label>
                      <select value={customerForm.tax_treatment} onChange={(e) => setCustomerForm({ ...customerForm, tax_treatment: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"><option value="REGISTERED">{regionalProfile.taxLabel} Registered</option><option value="UNREGISTERED">Unregistered</option>{regionalProfile.marketProfile === 'INDIA' && <option value="SEZ">SEZ</option>}<option value="EXPORT">Export</option><option value="EXEMPT">Exempt</option></select>
                    </div>
                    <div className="xl:col-span-3 rounded-md border border-[#E8DCC4] bg-[#FCFAF6] p-3">
                      <div className="text-xs font-bold uppercase text-[#8B6F47]">Central business-partner blocks</div>
                      <div className="mt-2 flex flex-wrap gap-5">
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerForm.sales_blocked} onChange={(e) => setCustomerForm({ ...customerForm, sales_blocked: e.target.checked })} /> Sales block</label>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerForm.delivery_blocked} onChange={(e) => setCustomerForm({ ...customerForm, delivery_blocked: e.target.checked })} /> Delivery block</label>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerForm.billing_blocked} onChange={(e) => setCustomerForm({ ...customerForm, billing_blocked: e.target.checked })} /> Billing block</label>
                      </div>
                      {(customerForm.sales_blocked || customerForm.delivery_blocked || customerForm.billing_blocked) && <input required value={customerForm.block_reason} onChange={(e) => setCustomerForm({ ...customerForm, block_reason: e.target.value })} placeholder="Mandatory block reason" className="mt-3 w-full rounded-md border border-[#D9C9AD] px-3 py-2 text-sm" />}
                    </div>
                  </div>
                  </div>
                  <div className="border-t border-[#E8DCC4] bg-white px-6 py-4">
                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCustomerForm(false);
                        resetCustomerForm();
                      }}
                      className="rounded-md border border-[#D9C9AD] px-4 py-2 text-sm font-semibold text-[#6F4E37] hover:bg-[#F6EFE2]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#745A37] disabled:opacity-50"
                    >
                      {loading
                        ? editingCustomerId
                          ? 'Saving...'
                          : 'Creating...'
                        : editingCustomerId
                          ? 'Save Changes'
                          : 'Create Customer'}
                    </button>
                  </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quotations Tab */}
      {activeTab === 'quotations' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#3F2D20]">Quotation Register</h2>
              <p className="text-sm text-[#6F4E37]">Customer offers, approval status, conversion balance, and commercial value.</p>
            </div>
            {canCreate && (
            <button
              onClick={() => {
                resetQuotationForm();
                setShowQuotationForm(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#745A37]"
            >
              <Plus size={16} /> Create Quotation
            </button>
            )}
          </div>

          {loading ? (
            <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center text-[#7A6756]">Loading quotations...</div>
          ) : (
            <>
            <div className={registerShellClass}>
              <table className={registerTableClass}>
                <thead className={registerHeadClass}>
                  <tr>
                    <th className={stickyFirstHeaderClass}>QT Number</th>
                    <th className={stickySecondHeaderClass}>Customer</th>
                    <th className={registerHeaderCellClass}>Date</th>
                    <th className={registerHeaderCellClass}>Valid Until</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Amount</th>
                    <th className={registerHeaderCellClass}>Status</th>
                    <th className={registerHeaderCellClass}>Actions</th>
                  </tr>
                </thead>
                <tbody className={registerBodyClass}>
                  {(() => {
                    const { paginatedData, totalPages, totalItems } = getPaginatedAndSortedData(quotations, 'quotation_date');
                    return (
                      <>
                        {paginatedData.map((quotation) => (
                          <tr key={quotation.id} className="hover:bg-[#FFFDF7]">
                      <td className={stickyFirstCellClass}>
                        <div>{quotation.quotation_number}</div>
                        <div className="text-xs font-normal text-[#7A6756]">Revision {quotation.revision_no || 0}</div>
                      </td>
                      <td className={stickySecondCellClass}>
                        <div className="font-semibold text-[#1F2937]">{quotation.customer_name || '-'}</div>
                        <div className="text-xs text-[#7A6756]">{quotation.customer_id}</div>
                      </td>
                      <td className={registerCellClass}>
                        {new Date(quotation.quotation_date).toLocaleDateString()}
                      </td>
                      <td className={registerCellClass}>
                        {new Date(quotation.valid_until).toLocaleDateString()}
                      </td>
                      <td className={`${registerCellClass} text-right font-semibold text-[#3F2D20]`}>
                        {formatSalesAmount(quotation.net_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(quotation.status)}`}>
                          {quotation.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <ActionIconButton
                            title="View quotation"
                            onClick={() => handleViewQuotation(quotation.id)}
                            tone="primary"
                          >
                            <Eye size={16} />
                          </ActionIconButton>
                          <ActionIconButton
                            title="Customer communication, reminders and comments"
                            onClick={() => openQuotationCommunication(quotation)}
                            tone="primary"
                          >
                            <MessageSquare size={16} />
                          </ActionIconButton>
                          {canEdit && (
                          <ActionIconButton
                            title={quotation.status !== 'DRAFT' ? 'Only DRAFT quotations can be edited' : 'Edit quotation'}
                            onClick={() => handleEditQuotation(quotation.id)}
                            disabled={quotation.status !== 'DRAFT'}
                            tone="warning"
                          >
                            <Pencil size={16} />
                          </ActionIconButton>
                          )}
                          {canDelete && (
                          <ActionIconButton
                            title={quotation.status !== 'DRAFT' ? 'Only DRAFT quotations can be deleted' : 'Delete quotation'}
                            onClick={() => handleDeleteQuotation(quotation)}
                            disabled={quotation.status !== 'DRAFT'}
                            tone="danger"
                          >
                            <Trash2 size={16} />
                          </ActionIconButton>
                          )}
                          {canApprove && quotation.status === 'DRAFT' && (
                            <ActionIconButton
                              title="Approve quotation"
                              onClick={async () => {
                                try {
                                  await apiClient.put(`/sales/quotations/${quotation.id}/approve`);
                                  alert('Quotation approved!');
                                  fetchQuotations();
                                } catch (err: any) {
                                  alert('Failed to approve: ' + err.message);
                                }
                              }}
                              tone="success"
                            >
                              <CheckCircle size={16} />
                            </ActionIconButton>
                          )}
                          {canApprove && quotation.status === 'DRAFT' && (
                            <ActionIconButton
                              title="Reject quotation with reason"
                              onClick={() => {
                                setRejectingQuotation(quotation);
                                setQuotationRejectionReason('');
                              }}
                              tone="danger"
                            >
                              <XCircle size={16} />
                            </ActionIconButton>
                          )}
                          {['APPROVED', 'REJECTED', 'EXPIRED'].includes(quotation.status) && (
                            <ActionIconButton
                              title="Create controlled quotation revision"
                              onClick={() => handleReviseQuotation(quotation)}
                              tone="primary"
                            >
                              <RotateCcw size={16} />
                            </ActionIconButton>
                          )}
                          {quotation.status === 'APPROVED' && (
                            <ActionIconButton
                              title="Convert to sales order"
                              onClick={() => handleOpenSOConversion(quotation)}
                              tone="warning"
                            >
                              <Send size={16} />
                            </ActionIconButton>
                          )}
                          {quotation.status === 'PARTIALLY_CONVERTED' && (
                            <ActionIconButton
                              title="Convert remaining quantity"
                              onClick={() => handleOpenSOConversion(quotation)}
                              tone="primary"
                            >
                              <Send size={16} />
                            </ActionIconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            {(() => {
              const { totalPages, totalItems } = getPaginatedAndSortedData(quotations, 'quotation_date');
              return renderPagination(totalPages, totalItems);
            })()}
            </>
          )}

          {/* SO Conversion Form Modal */}
          {showSOConversionForm && selectedQuotationForSO && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
              <div className="bg-white rounded-lg p-6 max-w-4xl w-full my-8 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">
                  Convert Quotation {selectedQuotationForSO.quotation_number} to Sales Order
                </h3>
                <form onSubmit={handleConvertToSO}>
                  <div className="space-y-6">
                    {/* Customer Info */}
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
                          <p className="text-sm text-gray-900 font-medium">{selectedQuotationForSO.customer_name}</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Quotation Total</label>
                          <p className="text-sm text-gray-900 font-medium">{formatSalesAmount(selectedQuotationForSO.net_amount)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Items to Convert */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Select Items & Quantities to Convert</h4>
                      <div className="border rounded-lg overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total Qty</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Converted</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pending</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Convert Now</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {selectedQuotationForSO.quotation_items?.map((item) => {
                              const convertedQty = item.converted_quantity || 0;
                              const pendingQty = item.pending_quantity || (item.quantity - convertedQty);
                              const currentConvertQty = conversionItems[item.id!] || 0;
                              
                              return (
                                <tr key={item.id} className={pendingQty === 0 ? 'bg-gray-50 opacity-60' : ''}>
                                  <td className="px-4 py-3">
                                    <div className="text-sm font-medium text-gray-900">{item.item_description}</div>
                                    {convertedQty > 0 && (
                                      <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                                        <div 
                                          className="bg-green-500 h-2 rounded-full" 
                                          style={{ width: `${(convertedQty / item.quantity) * 100}%` }}
                                        ></div>
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center text-sm text-gray-900">{item.quantity}</td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="text-sm text-green-600 font-medium">{convertedQty}</span>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="text-sm text-amber-600 font-medium">{pendingQty}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <input
                                      type="number"
                                      min="0"
                                      max={pendingQty}
                                      step="0.01"
                                      value={currentConvertQty}
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setConversionItems({
                                          ...conversionItems,
                                          [item.id!]: Math.min(value, pendingQty),
                                        });
                                      }}
                                      disabled={pendingQty === 0}
                                      className="w-24 px-2 py-1 text-center border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-500 disabled:bg-gray-100"
                                    />
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-900">{formatSalesAmount(item.unit_price)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      
                      {/* Quick Actions */}
                      <div className="mt-3 flex space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            const allItems: {[key: string]: number} = {};
                            selectedQuotationForSO.quotation_items?.forEach((item) => {
                              const pendingQty = item.pending_quantity || (item.quantity - (item.converted_quantity || 0));
                              allItems[item.id!] = pendingQty;
                            });
                            setConversionItems(allItems);
                          }}
                          className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                        >
                          Convert All Remaining
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const halfItems: {[key: string]: number} = {};
                            selectedQuotationForSO.quotation_items?.forEach((item) => {
                              const pendingQty = item.pending_quantity || (item.quantity - (item.converted_quantity || 0));
                              halfItems[item.id!] = Math.floor(pendingQty / 2);
                            });
                            setConversionItems(halfItems);
                          }}
                          className="px-3 py-1 text-xs bg-amber-50 text-amber-600 rounded hover:bg-amber-100"
                        >
                          Convert Half
                        </button>
                        <button
                          type="button"
                          onClick={() => setConversionItems({})}
                          className="px-3 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    {/* Order Details */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery Date *</label>
                        <DateInput
                          min={todayDate}
                          required
                          value={soConversionForm.expected_delivery_date}
                          onChange={(value) => setSOConversionForm({ ...soConversionForm, expected_delivery_date: value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Advance Amount ({regionalProfile.currency})</label>
                        <input
                          type="number"
                          min="0"
                          value={soConversionForm.advance_amount}
                          onChange={(e) => setSOConversionForm({ ...soConversionForm, advance_amount: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                        <input
                          type="text"
                          value={soConversionForm.payment_terms}
                          onChange={(e) => setSOConversionForm({ ...soConversionForm, payment_terms: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                        <input
                          type="text"
                          value={soConversionForm.project}
                          onChange={(e) => setSOConversionForm({ ...soConversionForm, project: e.target.value })}
                          placeholder="e.g., Project Alpha, Phase 1"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Special Instructions</label>
                      <textarea
                        rows={2}
                        value={soConversionForm.special_instructions}
                        onChange={(e) => setSOConversionForm({ ...soConversionForm, special_instructions: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowSOConversionForm(false);
                        setSelectedQuotationForSO(null);
                        setConversionItems({});
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Converting...' : 'Create Sales Order'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {viewingQuotation && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-7xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Quotation {viewingQuotation.quotation_number}</h3>
                    <p className="text-sm text-gray-500">Status: {viewingQuotation.status} · Revision {viewingQuotation.revision_no || 0}</p>
                  </div>
                  <button
                    onClick={() => setViewingQuotation(null)}
                    className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                    aria-label="Close quotation details"
                  >
                    ×
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 border rounded-lg p-4 bg-gray-50 mb-6">
                  <div>
                    <p className="text-xs uppercase text-gray-500">Customer</p>
                    <p className="text-sm text-gray-900">{viewingQuotation.customer_name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-gray-500">Quotation Date</p>
                    <p className="text-sm text-gray-900">
                      {new Date(viewingQuotation.quotation_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-gray-500">Valid Until</p>
                    <p className="text-sm text-gray-900">
                      {new Date(viewingQuotation.valid_until).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-gray-500">Net Amount</p>
                    <p className="text-sm text-gray-900">{formatSalesAmount(viewingQuotation.net_amount)}</p>
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-[#E8DCC4] bg-[#FFFDF7] p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-[#7A6756]">Revision</p>
                    <p className="font-medium text-[#3F2D20]">{viewingQuotation.revision_no || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-[#7A6756]">Revised from</p>
                    <p className="font-medium text-[#3F2D20]">{viewingQuotation.revised_from_quotation?.quotation_number || 'Original quotation'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-[#7A6756]">Decision time</p>
                    <p className="font-medium text-[#3F2D20]">
                      {viewingQuotation.approved_at
                        ? new Date(viewingQuotation.approved_at).toLocaleString()
                        : viewingQuotation.rejected_at
                          ? new Date(viewingQuotation.rejected_at).toLocaleString()
                          : 'Pending'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-[#7A6756]">Next revision</p>
                    <p className="font-medium text-[#3F2D20]">{viewingQuotation.revised_to_quotation?.quotation_number || '—'}</p>
                  </div>
                </div>

                {viewingQuotation.status === 'REJECTED' && viewingQuotation.rejected_reason && (
                  <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
                    <p className="text-xs font-semibold uppercase text-red-700">Rejection reason</p>
                    <p className="mt-1 text-sm text-red-900">{viewingQuotation.rejected_reason}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Items</h4>
                  <div className="border rounded-lg overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{regionalProfile.marketProfile === 'UAE' ? 'Commodity / Service Code' : 'HSN'}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Discount %</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {(viewingQuotation.quotation_items || []).map((item: any) => (
                          <tr key={item.id}>
                            <td className="px-4 py-2 text-sm text-gray-900">
                              <div>{item.item_description || '—'}</div>
                              {Array.isArray(item.photos) && item.photos.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.photos.map((photo: QuotationPhoto, photoIndex: number) => (
                                    <a key={`${photo.url}-${photoIndex}`} href={photo.url} target="_blank" rel="noreferrer" title={photo.name}>
                                      <img src={photo.url} alt={photo.name} className="h-14 w-14 rounded border border-gray-200 object-cover" />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600">{item.hsn_code || '—'}</td>
                            <td className="px-4 py-2 text-sm text-gray-600">{item.quantity}</td>
                            <td className="px-4 py-2 text-sm text-gray-600">{formatSalesAmount(item.unit_price)}</td>
                            <td className="px-4 py-2 text-sm text-gray-600">{item.discount_percentage ?? 0}%</td>
                            <td className="px-4 py-2 text-sm text-gray-900">{formatSalesAmount(item.line_total)}</td>
                          </tr>
                        ))}
                        {(viewingQuotation.quotation_items || []).length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                              No items available for this quotation.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h4 className="text-sm font-semibold text-gray-700">Terms and Conditions</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{viewingQuotation.terms_conditions || '—'}</p>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => void downloadSalesDocumentPdf(`/sales/quotations/${viewingQuotation.id}/pdf`, `${viewingQuotation.quotation_number}.pdf`)}
                    className="px-4 py-2 border border-amber-700 text-amber-800 rounded-lg hover:bg-amber-50"
                  >
                    Download PDF
                  </button>
                  <button
                    onClick={() => setViewingQuotation(null)}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {communicationQuotation && (
            <div className="fixed inset-0 z-[65] flex items-center justify-center bg-gray-900/50 p-4">
              <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-[#E8DCC4] p-5">
                  <div>
                    <h3 className="text-lg font-bold text-[#3F2D20]">Customer Communication</h3>
                    <p className="text-sm text-[#7A6756]">{communicationQuotation.quotation_number} · Revision {communicationQuotation.revision_no || 0}</p>
                  </div>
                  <button type="button" aria-label="Close customer communication" onClick={() => setCommunicationQuotation(null)} className="text-2xl leading-none text-gray-500">×</button>
                </div>
                <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#3F2D20]">Recipient email *</label>
                      <input type="email" value={quotationCommunicationForm.email} onChange={(event) => setQuotationCommunicationForm((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#3F2D20]">Subject</label>
                      <input value={quotationCommunicationForm.subject} onChange={(event) => setQuotationCommunicationForm((current) => ({ ...current, subject: event.target.value }))} className="w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#3F2D20]">Message / customer comment</label>
                      <textarea rows={5} value={quotationCommunicationForm.message} onChange={(event) => setQuotationCommunicationForm((current) => ({ ...current, message: event.target.value }))} placeholder="Email note, customer response, commercial comment, or follow-up detail" className="w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-[#3F2D20]">Next follow-up (optional)</label>
                      <input type="datetime-local" value={quotationCommunicationForm.follow_up_at} onChange={(event) => setQuotationCommunicationForm((current) => ({ ...current, follow_up_at: event.target.value }))} className="w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={quotationCommunicationSaving} onClick={() => sendQuotationCommunication(false)} className="inline-flex items-center gap-2 rounded-md bg-[#6F4E37] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Mail size={15} /> Email Quotation</button>
                      <button type="button" disabled={quotationCommunicationSaving} onClick={() => sendQuotationCommunication(true)} className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"><Send size={15} /> Send Response Reminder</button>
                      <button type="button" disabled={quotationCommunicationSaving} onClick={addQuotationCustomerComment} className="inline-flex items-center gap-2 rounded-md border border-[#D9C9AD] px-4 py-2 text-sm font-semibold text-[#6F4E37] disabled:opacity-50"><MessageSquare size={15} /> Log Customer Comment</button>
                    </div>
                  </div>
                  <div className="min-h-[340px] rounded-lg border border-[#E8DCC4] bg-[#FFFDF7] p-4">
                    <h4 className="font-bold text-[#3F2D20]">Activity & response history</h4>
                    <p className="mb-3 text-xs text-[#7A6756]">Auditable emails, reminders, comments, and revisions.</p>
                    <div className="space-y-2">
                      {quotationActivities.map((activity) => (
                        <div key={activity.id} className="rounded-md border border-[#E8DCC4] bg-white p-3">
                          <div className="flex items-start justify-between gap-3"><span className="text-xs font-bold text-[#8B6F47]">{String(activity.activity_type || '').replaceAll('_', ' ')}</span><span className="text-xs text-[#7A6756]">{new Date(activity.created_at).toLocaleString('en-IN')}</span></div>
                          {activity.subject && <div className="mt-1 text-sm font-semibold text-[#3F2D20]">{activity.subject}</div>}
                          {activity.comments && <div className="mt-1 whitespace-pre-wrap text-sm text-[#5F4A3A]">{activity.comments}</div>}
                          {activity.recipient_email && <div className="mt-1 text-xs text-[#7A6756]">To: {activity.recipient_email}</div>}
                          {activity.reminder_due_at && <div className="mt-1 text-xs font-semibold text-amber-800">Follow-up: {new Date(activity.reminder_due_at).toLocaleString('en-IN')}</div>}
                        </div>
                      ))}
                      {!quotationActivities.length && <div className="py-12 text-center text-sm text-[#7A6756]">No communication has been logged yet.</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {rejectingQuotation && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4">
              <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-[#E8DCC4] p-5">
                  <div>
                    <h3 className="text-lg font-semibold text-[#3F2D20]">Reject Quotation</h3>
                    <p className="mt-1 text-sm text-[#7A6756]">{rejectingQuotation.quotation_number}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close rejection dialog"
                    disabled={quotationDecisionSaving}
                    onClick={() => {
                      setRejectingQuotation(null);
                      setQuotationRejectionReason('');
                    }}
                    className="text-2xl leading-none text-gray-500 hover:text-gray-700 disabled:opacity-50"
                  >
                    ×
                  </button>
                </div>
                <div className="p-5">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Rejection reason *</label>
                  <textarea
                    autoFocus
                    rows={4}
                    maxLength={1000}
                    value={quotationRejectionReason}
                    onChange={(event) => setQuotationRejectionReason(event.target.value)}
                    placeholder="Explain the commercial or technical reason for rejection"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-1 focus:ring-[#8B6F47]"
                  />
                  <p className="mt-1 text-xs text-gray-500">This reason is retained in the quotation audit record.</p>
                </div>
                <div className="flex justify-end gap-3 border-t border-[#E8DCC4] p-5">
                  <button
                    type="button"
                    disabled={quotationDecisionSaving}
                    onClick={() => {
                      setRejectingQuotation(null);
                      setQuotationRejectionReason('');
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={quotationDecisionSaving || quotationRejectionReason.trim().length < 5}
                    onClick={handleRejectQuotation}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {quotationDecisionSaving ? 'Rejecting...' : 'Reject Quotation'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Quotation Form Modal */}
          {showQuotationForm && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">
                  {editingQuotationId ? 'Edit Quotation' : 'Create Quotation'}
                </h3>
                <form onSubmit={handleSaveQuotation}>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
                      <select
                        required
                        value={quotationForm.customer_id}
                        onChange={(e) => setQuotationForm({ ...quotationForm, customer_id: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="">Select Customer</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.customer_name} ({c.customer_code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Date *</label>
                      <DateInput
                        max={todayDate}
                        required
                        value={quotationForm.quotation_date}
                        onChange={(value) => setQuotationForm({ ...quotationForm, quotation_date: value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until *</label>
                      <DateInput
                        min={todayDate}
                        required
                        value={quotationForm.valid_until}
                        onChange={(value) => setQuotationForm({ ...quotationForm, valid_until: value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                      <input
                        type="text"
                        value={quotationForm.payment_terms}
                        onChange={(e) => setQuotationForm({ ...quotationForm, payment_terms: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Customer RFQ / Reference</label>
                      <input
                        type="text"
                        value={quotationForm.customer_reference}
                        onChange={(e) => setQuotationForm({ ...quotationForm, customer_reference: e.target.value })}
                        placeholder="Tender, RFQ, enquiry or email reference"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                      <select
                        value={quotationForm.currency_code}
                        onChange={(e) => setQuotationForm({ ...quotationForm, currency_code: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                      >
                        <option value="INR">INR</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="AED">AED</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Place of Supply</label>
                      <input
                        type="text"
                        value={quotationForm.place_of_supply}
                        onChange={(e) => setQuotationForm({ ...quotationForm, place_of_supply: e.target.value })}
                        placeholder={regionalProfile.marketProfile === 'UAE' ? 'Emirate / place of supply' : 'State / territory for GST'}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Incoterm</label>
                      <input
                        type="text"
                        value={quotationForm.incoterm}
                        onChange={(e) => setQuotationForm({ ...quotationForm, incoterm: e.target.value.toUpperCase() })}
                        placeholder="EXW / FCA / FOB / CIF"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Terms and Conditions *</label>
                    <textarea
                      required
                      rows={4}
                      value={quotationForm.terms_conditions}
                      onChange={(e) => setQuotationForm({ ...quotationForm, terms_conditions: e.target.value })}
                      placeholder="Enter commercial, delivery, warranty, validity, and other quotation terms"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    />
                  </div>

                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-3">
                      <label className="block text-sm font-medium text-gray-700">Quotation Items *</label>
                      <button
                        type="button"
                        onClick={addQuotationItem}
                        className="px-3 py-1.5 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
                      >
                        + Add Item
                      </button>
                    </div>

                    {/* Column Headers */}
                    <div className="grid grid-cols-12 gap-2 mb-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="col-span-2 text-xs font-semibold text-gray-700 uppercase">Item</div>
                      <div className="col-span-3 text-xs font-semibold text-gray-700 uppercase">Editable Description</div>
                      <div className="col-span-1 text-xs font-semibold text-gray-700 uppercase">{regionalProfile.marketProfile === 'UAE' ? 'Commodity / Service Code *' : 'HSN *'}</div>
                      <div className="col-span-1 text-xs font-semibold text-gray-700 uppercase">UOM</div>
                      <div className="col-span-1 text-xs font-semibold text-gray-700 uppercase">Quantity</div>
                      <div className="col-span-1 text-xs font-semibold text-gray-700 uppercase">Rate / Basis</div>
                      <div className="col-span-1 text-xs font-semibold text-gray-700 uppercase">Disc %</div>
                      <div className="col-span-1 text-xs font-semibold text-gray-700 uppercase">Photos</div>
                      <div className="col-span-1 text-xs font-semibold text-gray-700 uppercase text-center">Action</div>
                    </div>

                    {quotationForm.items.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
                        <p className="text-sm">No items added yet. Click &quot;+ Add Item&quot; to start.</p>
                      </div>
                    ) : (
                      quotationForm.items.map((item, index) => (
                        <div key={index} className="grid grid-cols-12 gap-2 mb-3 p-3 border border-gray-200 rounded-lg hover:border-amber-300 transition-colors bg-white shadow-sm">
                          <div className="col-span-2">
                            <SearchableSelect
                              options={items.map(i => ({
                                value: i.id,
                                label: i.code,
                                subtitle: i.name,
                              }))}
                              value={item.item_id}
                              onChange={(value, option) => {
                                const selectedItem = items.find(i => i.id === value);
                                if (selectedItem) {
                                  const newItems = [...quotationForm.items];
                                  newItems[index] = {
                                    ...newItems[index],
                                    item_id: value,
                                    item_description: selectedItem.name || selectedItem.description || '',
                                    unit_price: selectedItem.selling_price || selectedItem.standard_cost || 0,
                                    hsn_code: selectedItem.hsn_code || '',
                                    ordered_uom: selectedItem.uom || 'PCS',
                                    price_uom: selectedItem.uom || 'PCS',
                                  };
                                  setQuotationForm({ ...quotationForm, items: newItems });
                                } else {
                                  updateQuotationItem(index, 'item_id', value);
                                }
                              }}
                              placeholder="Search item..."
                              required
                            />
                          </div>
                          <div className="col-span-3">
                            <textarea
                              rows={3}
                              placeholder="Item description"
                              required
                              value={item.item_description}
                              onChange={(e) => updateQuotationItem(index, 'item_description', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </div>
                          <div className="col-span-1">
                            <input
                              type="text"
                              placeholder={regionalProfile.marketProfile === 'UAE' ? 'Commodity / service code' : 'HSN'}
                              required
                              value={item.hsn_code || ''}
                              onChange={(e) => updateQuotationItem(index, 'hsn_code', e.target.value)}
                              className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </div>
                          <div className="col-span-1">
                            <select
                              value={item.ordered_uom || items.find(i => i.id === item.item_id)?.uom || 'PCS'}
                              onChange={(e) => updateQuotationItem(index, 'ordered_uom', e.target.value)}
                              className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                            >
                              {(() => {
                                const selected = items.find(i => i.id === item.item_id);
                                const options = [selected?.uom || 'PCS', selected?.sales_uom].filter(Boolean);
                                return [...new Set(options)].map((uom: any) => (
                                  <option key={uom} value={uom}>{uom}</option>
                                ));
                              })()}
                            </select>
                            {(() => {
                              const selected = items.find(i => i.id === item.item_id);
                              return selected?.sales_uom && item.ordered_uom === selected.sales_uom
                                ? <span className="mt-1 block text-[10px] text-amber-700">1 = {selected.sales_uom_factor} {selected.uom}</span>
                                : null;
                            })()}
                          </div>
                          <div className="col-span-1">
                            <input
                              type="number"
                              placeholder="0"
                              required
                              min="0.01"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) => updateQuotationItem(index, 'quantity', parseFloat(e.target.value))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </div>
                          <div className="col-span-1">
                            <input
                              type="number"
                              placeholder="0.00"
                              required
                              min="0"
                              step="0.01"
                              value={item.unit_price}
                              onChange={(e) => updateQuotationItem(index, 'unit_price', parseFloat(e.target.value))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                            <select
                              aria-label="Price per unit"
                              value={item.price_uom || items.find(i => i.id === item.item_id)?.uom || 'PCS'}
                              onChange={(e) => updateQuotationItem(index, 'price_uom', e.target.value)}
                              className="mt-1 w-full rounded-md border border-gray-300 bg-amber-50 px-2 py-1 text-xs"
                            >
                              {(() => {
                                const selected = items.find(i => i.id === item.item_id);
                                return [...new Set([selected?.uom || 'PCS', selected?.sales_uom].filter(Boolean))].map((uom: any) => (
                                  <option key={uom} value={uom}>per {uom}</option>
                                ));
                              })()}
                            </select>
                          </div>
                          <div className="col-span-1">
                            <input
                              type="number"
                              placeholder="0"
                              min="0"
                              max="100"
                              step="0.1"
                              value={item.discount_percentage}
                              onChange={(e) => updateQuotationItem(index, 'discount_percentage', parseFloat(e.target.value))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </div>
                          <div className="col-span-1">
                            <label className="flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-amber-400 bg-amber-50 px-2 py-2 text-center text-xs font-medium text-amber-800 hover:bg-amber-100">
                              {quotationPhotoUploadingIndex === index ? 'Uploading...' : '+ Photos'}
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                disabled={quotationPhotoUploadingIndex !== null}
                                onChange={(e) => {
                                  void uploadQuotationPhotos(index, e.target.files);
                                  e.currentTarget.value = '';
                                }}
                                className="hidden"
                              />
                            </label>
                            {(item.photos || []).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(item.photos || []).map((photo, photoIndex) => (
                                  <button
                                    type="button"
                                    key={`${photo.url}-${photoIndex}`}
                                    onClick={() => removeQuotationPhoto(index, photoIndex)}
                                    title={`Remove ${photo.name}`}
                                    className="relative h-10 w-10 overflow-hidden rounded border border-gray-200"
                                  >
                                    <img src={photo.url} alt={photo.name} className="h-full w-full object-cover" />
                                    <span className="absolute right-0 top-0 bg-red-600 px-1 text-[9px] text-white">×</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="col-span-1 flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => removeQuotationItem(index)}
                              className="px-2 py-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors"
                              title="Remove item"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        resetQuotationForm();
                        setShowQuotationForm(false);
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || quotationForm.items.length === 0}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading
                        ? editingQuotationId
                          ? 'Updating...'
                          : 'Creating...'
                        : editingQuotationId
                          ? 'Update Quotation'
                          : 'Create Quotation'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sales Orders Tab */}
      {activeTab === 'orders' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#3F2D20]">Sales Order Register</h2>
              <p className="text-sm text-[#6F4E37]">Confirmed customer commitments, fulfilment status, advances, and outstanding balance.</p>
            </div>
            <button
              onClick={() => setShowDirectSOForm(true)}
              className="inline-flex items-center gap-2 rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#745A37]"
            >
              <Plus size={16} /> Create Direct Order
            </button>
          </div>
          {loading ? (
            <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center text-[#7A6756]">Loading sales orders...</div>
          ) : (
            <div className={registerShellClass}>
              <table className="min-w-[1360px] divide-y divide-[#E8DCC4]">
                <thead className={registerHeadClass}>
                  <tr>
                    <th className={stickyFirstHeaderClass}>SO Number</th>
                    <th className={stickySecondHeaderClass}>Customer</th>
                    <th className={registerHeaderCellClass}>Project</th>
                    <th className={registerHeaderCellClass}>Order Date</th>
                    <th className={registerHeaderCellClass}>Delivery Date</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Amount</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Balance</th>
                    <th className={registerHeaderCellClass}>Commercial Control</th>
                    <th className={registerHeaderCellClass}>Status</th>
                    <th className={registerHeaderCellClass}>Actions</th>
                  </tr>
                </thead>
                <tbody className={registerBodyClass}>
                  {getPaginatedAndSortedData(orders, 'order_date').paginatedData.map((order) => (
                    <tr key={order.id} className="hover:bg-[#FFFDF7]">
                      <td className={stickyFirstCellClass}>
                        {order.so_number}
                      </td>
                      <td className={stickySecondCellClass}>
                        <div className="font-semibold text-[#1F2937]">{order.customer_name || '-'}</div>
                        <div className="text-xs text-[#7A6756]">{order.source_type || (order.is_direct_order ? 'DIRECT' : 'QUOTATION')}</div>
                      </td>
                      <td className={registerCellClass}>
                        {order.project || '-'}
                      </td>
                      <td className={registerCellClass}>
                        {new Date(order.order_date).toLocaleDateString()}
                      </td>
                      <td className={registerCellClass}>
                        {order.expected_delivery_date ? new Date(order.expected_delivery_date).toLocaleDateString() : '-'}
                      </td>
                      <td className={`${registerCellClass} text-right font-semibold text-[#3F2D20]`}>
                        {formatSalesAmount(order.net_amount)}
                      </td>
                      <td className={`${registerCellClass} text-right font-semibold text-[#3F2D20]`}>
                        {formatSalesAmount(order.balance_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        <div className="font-semibold">{String(order.release_status || 'RELEASED').replaceAll('_', ' ')}</div>
                        <div className="mt-1 text-[#7A6756]">Credit: {order.credit_status || 'CLEAR'}</div>
                        <div className="text-[#7A6756]">ATP: {String(order.availability_status || 'NOT_CHECKED').replaceAll('_', ' ')}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <ActionIconButton
                            title="View order and document trail"
                            onClick={() => handleViewSalesOrderFlow(order)}
                          >
                            <Eye size={16} />
                          </ActionIconButton>
                          <ActionIconButton
                            title={order.status === 'DISPATCHED' || order.status === 'DELIVERED' ? 'Cannot create job order - sales order is fully dispatched' : 'Create smart job order'}
                            onClick={() => openSmartJOForSO(order)}
                            disabled={smartJOLoading || order.status === 'DISPATCHED' || order.status === 'DELIVERED'}
                            tone="warning"
                          >
                            <Briefcase size={16} />
                          </ActionIconButton>
                          {canApprove && (
                          <ActionIconButton
                            title={order.release_status === 'RELEASED' ? 'Commercially released' : 'Approve commercial release after credit and ATP checks'}
                            onClick={() => handleReleaseSalesOrder(order)}
                            disabled={order.release_status === 'RELEASED' || order.status === 'CANCELLED'}
                            tone="success"
                          >
                            <CheckCircle size={16} />
                          </ActionIconButton>
                          )}
                          {canEdit && (
                          <ActionIconButton
                            title={order.release_status === 'RELEASED' ? 'Commercially released orders are locked' : ['DISPATCHED', 'DELIVERED', 'COMPLETED'].includes(order.status) ? 'Posted sales orders cannot be edited' : 'Edit sales order'}
                            onClick={() => handleEditSalesOrder(order.id)}
                            disabled={order.release_status === 'RELEASED' || ['DISPATCHED', 'DELIVERED', 'COMPLETED'].includes(order.status)}
                            tone="warning"
                          >
                            <Pencil size={16} />
                          </ActionIconButton>
                          )}
                          {canEdit && !['CANCELLED', 'COMPLETED'].includes(order.status) && (
                            <ActionIconButton
                              title={order.delivery_block || order.billing_block ? 'Clear delivery and billing hold' : 'Apply delivery and billing hold'}
                              onClick={() => handleSalesOrderBlock(order)}
                              tone={order.delivery_block || order.billing_block ? 'danger' : 'warning'}
                            >
                              <ShieldAlert size={16} />
                            </ActionIconButton>
                          )}
                          {canDelete && (
                          <ActionIconButton
                            title="Delete sales order"
                            onClick={() => handleDeleteSalesOrder(order)}
                            tone="danger"
                          >
                            <Trash2 size={16} />
                          </ActionIconButton>
                          )}
                          {(order.status === 'READY_TO_DISPATCH' || order.status === 'CONFIRMED') && order.release_status === 'RELEASED' && (
                            <ActionIconButton
                              title="Plan warehouse fulfilment"
                              onClick={() => void openFulfilmentPlanning(order)}
                              tone="primary"
                            >
                              <Briefcase size={16} />
                            </ActionIconButton>
                          )}
                          {(order.status === 'READY_TO_DISPATCH' || order.status === 'CONFIRMED') && order.release_status === 'RELEASED' && (
                            <ActionIconButton
                              title="Create direct dispatch (legacy flow)"
                              onClick={async () => {
                                setSelectedOrderForDispatch(order);
                                setDispatchForm({ ...dispatchForm, sales_order_id: order.id });
                                await fetchSalesOrderItems(order.id);
                                setShowDispatchForm(true);
                              }}
                              tone="success"
                            >
                              <PackageCheck size={16} />
                            </ActionIconButton>
                          )}
                          {(order.status === 'DISPATCHED' || order.status === 'DELIVERED') && (
                            <span className="text-xs text-gray-500 italic">
                              ✓ Fully dispatched
                            </span>
                          )}

                          <ActionIconButton
                            title={sendingSOEmailId === order.id ? 'Sending sales order email' : 'Send sales order email'}
                            onClick={() => handleSendSalesOrderEmail(order.id)}
                            disabled={sendingSOEmailId === order.id}
                            tone="warning"
                          >
                            <Mail size={16} />
                          </ActionIconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(() => { const page = getPaginatedAndSortedData(orders, 'order_date'); return renderPagination(page.totalPages, page.totalItems); })()}

          {showOrderEditForm && editingOrderId && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[92vh] overflow-y-auto">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Edit Sales Order</h3>
                    <p className="text-sm text-gray-500">{editingOrderNumber}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowOrderEditForm(false);
                      setEditingOrderId(null);
                      setEditingOrderNumber('');
                      setEditingOrderItems([]);
                    }}
                    className="text-2xl leading-none text-gray-500 hover:text-gray-800"
                    aria-label="Close edit sales order"
                  >
                    &times;
                  </button>
                </div>
                <form onSubmit={handleSaveSalesOrder}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery Date</label>
                      <DateInput
                        min={todayDate}
                        value={orderEditForm.expected_delivery_date}
                        onChange={(value) =>
                          setOrderEditForm({ ...orderEditForm, expected_delivery_date: value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <select
                        value={orderEditForm.status}
                        onChange={(e) => setOrderEditForm({ ...orderEditForm, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="CONFIRMED">CONFIRMED</option>
                        <option value="IN_PRODUCTION">IN_PRODUCTION</option>
                        <option value="READY_TO_DISPATCH">READY_TO_DISPATCH</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                      <input
                        type="text"
                        value={orderEditForm.payment_terms}
                        onChange={(e) => setOrderEditForm({ ...orderEditForm, payment_terms: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Terms</label>
                      <input
                        type="text"
                        value={orderEditForm.delivery_terms}
                        onChange={(e) => setOrderEditForm({ ...orderEditForm, delivery_terms: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                      <textarea
                        value={orderEditForm.notes}
                        onChange={(e) => setOrderEditForm({ ...orderEditForm, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Customer PO Number</label>
                      <input type="text" value={orderEditForm.customer_po_number} onChange={(e) => setOrderEditForm({ ...orderEditForm, customer_po_number: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Customer PO Date</label>
                      <DateInput max={todayDate} value={orderEditForm.customer_po_date} onChange={(value) => setOrderEditForm({ ...orderEditForm, customer_po_date: value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Place of Supply</label>
                      <input type="text" value={orderEditForm.place_of_supply} onChange={(e) => setOrderEditForm({ ...orderEditForm, place_of_supply: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Incoterm</label>
                      <input type="text" value={orderEditForm.incoterm} onChange={(e) => setOrderEditForm({ ...orderEditForm, incoterm: e.target.value.toUpperCase() })} placeholder="EXW / FOB / CIF" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div className="md:col-span-2 rounded-md border border-[#E8DCC4] bg-[#FCFAF6] p-3">
                      <div className="flex flex-wrap gap-6">
                        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={orderEditForm.delivery_block} onChange={(e) => setOrderEditForm({ ...orderEditForm, delivery_block: e.target.checked })} /> Delivery block</label>
                        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={orderEditForm.billing_block} onChange={(e) => setOrderEditForm({ ...orderEditForm, billing_block: e.target.checked })} /> Billing block</label>
                      </div>
                      {(orderEditForm.delivery_block || orderEditForm.billing_block) && <input required value={orderEditForm.block_reason} onChange={(e) => setOrderEditForm({ ...orderEditForm, block_reason: e.target.value })} placeholder="Mandatory block reason" className="mt-3 w-full rounded-md border border-[#D9C9AD] px-3 py-2 text-sm" />}
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-800">Order Items ({editingOrderItems.length})</h4>
                      <span className="text-xs text-gray-500">Editable until the first goods issue</span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="min-w-[850px] w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">No.</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Item</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">UOM</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Quantity</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Unit Price</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Price Per</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Discount %</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">{regionalProfile.taxLabel}</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">{regionalProfile.marketProfile === 'UAE' ? 'Commodity / Service Code' : 'HSN'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {editingOrderItems.map((item, index) => (
                            <tr key={item.id || `${item.item_id}-${index}`}>
                              <td className="px-3 py-3 text-sm text-gray-600">{index + 1}</td>
                              <td className="px-3 py-3 text-sm font-medium text-gray-900">{item.item_description || item.item_id || '-'}</td>
                              <td className="px-3 py-3"><input value={item.ordered_uom || 'NOS'} onChange={(e) => setEditingOrderItems((rows) => rows.map((row, i) => i === index ? { ...row, ordered_uom: e.target.value.toUpperCase() } : row))} className="w-20 rounded border p-2 text-sm" /></td>
                              <td className="px-3 py-3"><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => setEditingOrderItems((rows) => rows.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} className="w-24 rounded border p-2 text-right text-sm" /></td>
                              <td className="px-3 py-3"><input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => setEditingOrderItems((rows) => rows.map((row, i) => i === index ? { ...row, unit_price: e.target.value } : row))} className="w-28 rounded border p-2 text-right text-sm" /></td>
                              <td className="px-3 py-3"><input value={item.price_uom || item.ordered_uom || 'PCS'} onChange={(e) => setEditingOrderItems((rows) => rows.map((row, i) => i === index ? { ...row, price_uom: e.target.value.toUpperCase() } : row))} className="w-20 rounded border p-2 text-sm" /></td>
                              <td className="px-3 py-3"><input type="number" min="0" max="100" step="0.01" value={item.discount_percentage || 0} onChange={(e) => setEditingOrderItems((rows) => rows.map((row, i) => i === index ? { ...row, discount_percentage: e.target.value } : row))} className="w-20 rounded border p-2 text-right text-sm" /></td>
                              <td className="px-3 py-3"><input type="number" min="0" max="100" step="0.01" value={item.tax_percentage || 0} onChange={(e) => setEditingOrderItems((rows) => rows.map((row, i) => i === index ? { ...row, tax_percentage: e.target.value } : row))} className="w-20 rounded border p-2 text-right text-sm" /></td>
                              <td className="px-3 py-3"><input value={item.hsn_code || ''} onChange={(e) => setEditingOrderItems((rows) => rows.map((row, i) => i === index ? { ...row, hsn_code: e.target.value } : row))} className="w-28 rounded border p-2 text-sm" /></td>
                            </tr>
                          ))}
                          {editingOrderItems.length === 0 && (
                            <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">No item lines were returned for this Sales Order.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowOrderEditForm(false);
                        setEditingOrderId(null);
                        setEditingOrderNumber('');
                        setEditingOrderItems([]);
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Dispatch Form Modal */}
          {showDispatchForm && selectedOrderForDispatch && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">
                  Create Dispatch for {selectedOrderForDispatch.so_number}
                </h3>
                <form onSubmit={handleCreateDispatch}>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date *</label>
                      <DateInput
                        max={todayDate}
                        required
                        value={dispatchForm.dispatch_date}
                        onChange={(value) => setDispatchForm({ ...dispatchForm, dispatch_date: value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Transporter Name</label>
                      <input
                        type="text"
                        value={dispatchForm.transporter_name}
                        onChange={(e) => setDispatchForm({ ...dispatchForm, transporter_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
                      <input
                        type="text"
                        value={dispatchForm.vehicle_number}
                        onChange={(e) => setDispatchForm({ ...dispatchForm, vehicle_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">LR Number</label>
                      <input
                        type="text"
                        value={dispatchForm.lr_number}
                        onChange={(e) => setDispatchForm({ ...dispatchForm, lr_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">Dispatch Items *</label>
                      <button
                        type="button"
                        onClick={addDispatchItem}
                        className="text-sm text-amber-600 hover:text-amber-700"
                      >
                        + Add Item
                      </button>
                    </div>

                    {salesOrderItems.length === 0 && (
                      <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-sm text-yellow-800">
                          ⚠️ No items found in this sales order. The sales order may not have any items yet.
                        </p>
                      </div>
                    )}

                    {dispatchForm.items.map((item, index) => (
                      <div key={index} className="grid grid-cols-4 gap-2 mb-2 p-3 border border-gray-200 rounded-lg bg-gray-50">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">SO Item *</label>
                          <select
                            required
                            value={item.sales_order_item_id}
                            onChange={(e) => updateDispatchItem(index, 'sales_order_item_id', e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          >
                            <option value="">
                              {salesOrderItems.length === 0 ? 'No items available' : 'Select Item'}
                            </option>
                            {salesOrderItems.map((soItem) => (
                              <option key={soItem.id} value={soItem.id}>
                                {items.find(i => i.id === soItem.item_id)?.code || soItem.item_id} - Qty: {soItem.quantity - (soItem.dispatched_quantity || 0)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-600 mb-1">Select UIDs * (Quantity auto-fills)</label>
                          {loadingUIDs[index] ? (
                            <div className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50 text-gray-500">
                              Loading UIDs...
                            </div>
                          ) : item.item_id && availableUIDs[item.item_id] ? (
                            <div className="w-full border border-gray-300 rounded-lg p-2 max-h-40 overflow-y-auto bg-white">
                              {availableUIDs[item.item_id].length === 0 ? (
                                <div className="text-sm text-gray-500">No UIDs available</div>
                              ) : (
                                <div className="space-y-1">
                                  {availableUIDs[item.item_id].map((uid) => (
                                    <label key={uid.id} className="flex items-center space-x-2 p-1 hover:bg-amber-50 rounded cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={item.uid.includes(uid.uid)}
                                        onChange={(e) => {
                                          const newUids = e.target.checked
                                            ? [...item.uid, uid.uid]
                                            : item.uid.filter(u => u !== uid.uid);
                                          updateDispatchItem(index, 'uid', newUids);
                                        }}
                                        className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                                      />
                                      <span className="text-sm">
                                        {uid.uid} - {uid.status} {uid.location ? `(${uid.location})` : ''}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              {item.uid.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-gray-200 text-xs font-medium text-amber-600">
                                  {item.uid.length} UID{item.uid.length > 1 ? 's' : ''} selected
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50 text-gray-500">
                              Select item first
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Quantity (Auto)</label>
                          <input
                            type="number"
                            placeholder="Auto"
                            value={item.quantity}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50 text-gray-700 font-semibold"
                            title="Quantity is automatically set based on selected UIDs"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Batch</label>
                          <input
                            type="text"
                            placeholder="Batch"
                            value={item.batch_number}
                            onChange={(e) => updateDispatchItem(index, 'batch_number', e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeDispatchItem(index)}
                            className="w-full px-2 py-1 text-red-600 hover:text-red-800 text-sm border border-red-300 rounded hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDispatchForm(false);
                        setSelectedOrderForDispatch(null);
                        setSalesOrderItems([]);
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || dispatchForm.items.length === 0}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Creating...' : 'Create Dispatch'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {showSmartJOModal && smartJOOrder && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full">
            <h3 className="text-lg font-semibold mb-2">Create Job Order</h3>
            <p className="text-sm text-gray-600 mb-4">
              Sales Order: <span className="font-medium text-gray-900">{smartJOOrder.so_number}</span>
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-2">Select Sales Order Item (Optional)</label>
            <select
              value={smartJOSelectedSOItemId}
              onChange={(e) => setSmartJOSelectedSOItemId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">No prefill (choose item in Smart Job Order)</option>
              {smartJOSOItems.map((soItem) => {
                const item = items.find((i) => i.id === soItem.item_id);
                const label = `${item?.code || soItem.item_id} - Remaining: ${soItem.remainingQty}`;
                return (
                  <option key={soItem.id} value={soItem.id}>
                    {label}
                  </option>
                );
              })}
            </select>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowSmartJOModal(false);
                  setSmartJOOrder(null);
                  setSmartJOSOItems([]);
                  setSmartJOSelectedSOItemId('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!smartJOSelectedSOItemId) {
                    router.push(
                      `/dashboard/production/job-orders/smart-items?salesOrderId=${encodeURIComponent(smartJOOrder.id)}`,
                    );
                    setShowSmartJOModal(false);
                    return;
                  }

                  const soItem = smartJOSOItems.find((x) => String(x.id) === String(smartJOSelectedSOItemId));
                  if (!soItem?.item_id || Number(soItem.remainingQty) <= 0) {
                    alert('Invalid sales order item selected.');
                    return;
                  }

                  router.push(
                    `/dashboard/production/job-orders/smart-items?salesOrderId=${encodeURIComponent(smartJOOrder.id)}` +
                      `&salesOrderItemId=${encodeURIComponent(soItem.id)}` +
                      `&itemId=${encodeURIComponent(soItem.item_id)}` +
                      `&quantity=${encodeURIComponent(String(soItem.remainingQty))}`,
                  );
                  setShowSmartJOModal(false);
                }}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fulfilment / Pick-Pack Tab */}
      {activeTab === 'fulfilment' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#3F2D20]">Fulfilment Worklist</h2>
              <p className="text-sm text-[#6F4E37]">Released demand controlled through planning, picking, packing, dispatch readiness, and PGI.</p>
            </div>
            <button type="button" onClick={() => setActiveTab('orders')} className="rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white">Plan from Sales Order</button>
          </div>
          {loading ? <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center">Loading fulfilment tasks...</div> : (
            <div className={registerShellClass}>
              <table className="min-w-[1220px] divide-y divide-[#E8DCC4]">
                <thead className={registerHeadClass}><tr>
                  <th className={stickyFirstHeaderClass}>Task</th><th className={stickySecondHeaderClass}>Sales Order / Customer</th>
                  <th className={registerHeaderCellClass}>Warehouse</th><th className={registerHeaderCellClass}>Planned Dispatch</th>
                  <th className={registerHeaderCellClass}>Priority</th><th className={registerHeaderCellClass}>Quantities</th>
                  <th className={registerHeaderCellClass}>Status</th><th className={registerHeaderCellClass}>Actions</th>
                </tr></thead>
                <tbody className={registerBodyClass}>
                  {getPaginatedAndSortedData(fulfilmentTasks, 'planned_dispatch_date').paginatedData.map((task) => {
                    const planned = (task.items || []).reduce((sum, line) => sum + Number(line.planned_quantity || 0), 0);
                    const picked = (task.items || []).reduce((sum, line) => sum + Number(line.picked_quantity || 0), 0);
                    const packed = (task.items || []).reduce((sum, line) => sum + Number(line.packed_quantity || 0), 0);
                    return <tr key={task.id} className="hover:bg-[#FFFDF7]">
                      <td className={stickyFirstCellClass}>{task.task_number}</td>
                      <td className={stickySecondCellClass}><div className="font-semibold">{task.sales_order?.so_number || task.sales_order_id}</div><div className="text-xs text-[#7A6756]">{task.sales_order?.customer?.customer_name || '-'}</div></td>
                      <td className={registerCellClass}>{task.warehouse ? `${task.warehouse.code || ''} ${task.warehouse.name || ''}`.trim() : '-'}</td>
                      <td className={registerCellClass}>{new Date(`${task.planned_dispatch_date}T00:00:00`).toLocaleDateString('en-IN')}</td>
                      <td className={registerCellClass}>{task.priority}</td>
                      <td className={registerCellClass}><div>{task.items?.length || 0} lines</div><div className="text-xs text-[#7A6756]">Plan {planned} · Pick {picked} · Pack {packed}</div></td>
                      <td className={registerCellClass}><span className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(task.status)}`}>{task.status.replaceAll('_', ' ')}</span></td>
                      <td className="whitespace-nowrap px-4 py-3"><div className="flex flex-wrap gap-2">
                        {task.status === 'PLANNED' && <button type="button" onClick={() => void handleFulfilmentAction(task, 'START_PICKING')} className="rounded border border-[#D9C9AD] px-3 py-1.5 text-xs font-semibold">Start Picking</button>}
                        {task.status === 'PICKING' && <button type="button" onClick={() => void handleFulfilmentAction(task, 'CONFIRM_PICK')} className="rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700">Confirm Pick</button>}
                        {task.status === 'PICKED' && <button type="button" onClick={() => void handleFulfilmentAction(task, 'CONFIRM_PACK')} className="rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700">Confirm Pack</button>}
                        {task.status === 'PACKED' && <button type="button" onClick={() => void handleFulfilmentAction(task, 'MARK_READY')} className="rounded border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700">Mark Ready</button>}
                        {task.status === 'READY_TO_DISPATCH' && <button type="button" onClick={() => void openDispatchFromFulfilment(task)} className="rounded bg-green-700 px-3 py-1.5 text-xs font-semibold text-white">Post Dispatch</button>}
                        {!['DISPATCHED', 'CANCELLED'].includes(task.status) && canEdit && <button type="button" onClick={() => void handleFulfilmentAction(task, 'CANCEL')} className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">Cancel</button>}
                      </div></td>
                    </tr>;
                  })}
                  {fulfilmentTasks.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-[#7A6756]">No fulfilment tasks. Plan one from a released Sales Order.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {(() => { const page = getPaginatedAndSortedData(fulfilmentTasks, 'planned_dispatch_date'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {showFulfilmentForm && fulfilmentOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between"><div><h3 className="text-xl font-bold">Plan Fulfilment</h3><p className="text-sm text-gray-500">{fulfilmentOrder.so_number} · {fulfilmentOrder.customer_name}</p></div><button type="button" onClick={() => setShowFulfilmentForm(false)} className="text-2xl">&times;</button></div>
            <form onSubmit={handleCreateFulfilment}>
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="mb-1 block text-sm font-medium">Planned Dispatch Date *</label><DateInput required value={fulfilmentForm.planned_dispatch_date} onChange={(value) => setFulfilmentForm((current) => ({ ...current, planned_dispatch_date: value }))} className="w-full rounded border border-gray-300 px-3 py-2" /></div>
                <div><label className="mb-1 block text-sm font-medium">Warehouse</label><select value={fulfilmentForm.warehouse_id} onChange={(event) => setFulfilmentForm((current) => ({ ...current, warehouse_id: event.target.value }))} className="w-full rounded border border-gray-300 px-3 py-2"><option value="">Select warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>)}</select></div>
                <div><label className="mb-1 block text-sm font-medium">Priority *</label><select value={fulfilmentForm.priority} onChange={(event) => setFulfilmentForm((current) => ({ ...current, priority: event.target.value }))} className="w-full rounded border border-gray-300 px-3 py-2"><option>NORMAL</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></div>
              </div>
              <div className="mt-5 overflow-x-auto rounded border border-[#E8DCC4]"><table className="w-full"><thead className={registerHeadClass}><tr><th className={registerHeaderCellClass}>Item</th><th className={registerHeaderCellClass}>Quantity to plan</th></tr></thead><tbody>{fulfilmentForm.items.map((line, index) => <tr key={line.sales_order_item_id} className="border-t border-[#EFE5D2]"><td className="px-4 py-3">{line.description}</td><td className="px-4 py-3"><input type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => setFulfilmentForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row) }))} className="w-44 rounded border border-gray-300 px-3 py-2" /></td></tr>)}</tbody></table></div>
              <div className="mt-4"><label className="mb-1 block text-sm font-medium">Warehouse Notes</label><textarea value={fulfilmentForm.notes} onChange={(event) => setFulfilmentForm((current) => ({ ...current, notes: event.target.value }))} className="w-full rounded border border-gray-300 px-3 py-2" /></div>
              <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setShowFulfilmentForm(false)} className="rounded border px-4 py-2">Cancel</button><button type="submit" disabled={loading} className="rounded bg-[#8B6F47] px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? 'Planning...' : 'Create Fulfilment Task'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Dispatch Tab */}
      {activeTab === 'dispatch' && (
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold text-[#3F2D20]">Dispatch Register</h2>
            <p className="text-sm text-[#6F4E37]">Outbound deliveries, transporter details, vehicle references, and dispatch control.</p>
          </div>
          {loading ? (
            <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center text-[#7A6756]">Loading dispatch notes...</div>
          ) : (
            <div className={registerShellClass}>
              <table className={registerTableClass}>
                <thead className={registerHeadClass}>
                  <tr>
                    <th className={stickyFirstHeaderClass}>DN Number</th>
                    <th className={stickySecondHeaderClass}>SO Number</th>
                    <th className={registerHeaderCellClass}>Customer</th>
                    <th className={registerHeaderCellClass}>Dispatch Date</th>
                    <th className={registerHeaderCellClass}>Transporter</th>
                    <th className={registerHeaderCellClass}>Vehicle No.</th>
                    <th className={registerHeaderCellClass}>Status</th>
                    <th className={registerHeaderCellClass}>Actions</th>
                  </tr>
                </thead>
                <tbody className={registerBodyClass}>
                  {getPaginatedAndSortedData(dispatches, 'dispatch_date').paginatedData.map((dispatch) => {
                    const activeInvoice = invoices.some((invoice) => invoice.dispatch_note_id === dispatch.id && invoice.billing_status !== 'CANCELLED');
                    const isOpenPgi = (dispatch.status || 'PGI_POSTED') === 'PGI_POSTED';
                    return (
                    <tr key={dispatch.id} className="hover:bg-[#FFFDF7]">
                      <td className={stickyFirstCellClass}>
                        {dispatch.dn_number}
                      </td>
                      <td className={stickySecondCellClass}>
                        {dispatch.so_number || '-'}
                      </td>
                      <td className={registerCellClass}>
                        {dispatch.customer_name || '-'}
                      </td>
                      <td className={registerCellClass}>
                        {new Date(dispatch.dispatch_date).toLocaleDateString()}
                      </td>
                      <td className={registerCellClass}>
                        {dispatch.transporter_name || '-'}
                      </td>
                      <td className={registerCellClass}>
                        {dispatch.vehicle_number || '-'}
                      </td>
                      <td className={registerCellClass}>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          dispatch.status === 'DELIVERED'
                            ? 'bg-green-100 text-green-800'
                            : dispatch.status === 'CANCELLED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-blue-100 text-blue-800'
                        }`}>
                          {(dispatch.status || 'PGI_POSTED').replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          {canEdit && isOpenPgi && !activeInvoice && (
                          <ActionIconButton
                            title="Edit dispatch"
                            onClick={() => handleEditDispatch(dispatch)}
                            tone="warning"
                          >
                            <Pencil size={16} />
                          </ActionIconButton>
                          )}
                          <ActionIconButton
                            title="Download dispatch note PDF"
                            onClick={() => void downloadSalesDocumentPdf(`/sales/dispatch/${dispatch.id}/pdf`, `${dispatch.dn_number}.pdf`)}
                          >
                            <Printer size={16} />
                          </ActionIconButton>
                          {canEdit && dispatch.status !== 'CANCELLED' && (
                            <ActionIconButton
                              title="Email dispatch note with PDF"
                              onClick={() => void handleSendDispatchEmail(dispatch)}
                            >
                              <Mail size={16} />
                            </ActionIconButton>
                          )}
                          {canEdit && isOpenPgi && (
                            <ActionIconButton
                              title="Confirm customer delivery"
                              onClick={() => openDeliveryConfirmation(dispatch)}
                              tone="success"
                            >
                              <PackageCheck size={16} />
                            </ActionIconButton>
                          )}
                          {canCreate && ['PGI_POSTED', 'DELIVERED'].includes(dispatch.status || 'PGI_POSTED') && !activeInvoice && (
                            <ActionIconButton
                              title="Create customer invoice"
                              onClick={() => handleCreateInvoiceFromDispatch(dispatch)}
                              tone="primary"
                            >
                              <ReceiptIndianRupee size={16} />
                            </ActionIconButton>
                          )}
                          {canDelete && isOpenPgi && !activeInvoice && (
                          <ActionIconButton
                            title="Reverse goods issue (retain audit document)"
                            onClick={() => handleDeleteDispatch(dispatch)}
                            tone="danger"
                          >
                            <RotateCcw size={16} />
                          </ActionIconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
          {(() => { const page = getPaginatedAndSortedData(dispatches, 'dispatch_date'); return renderPagination(page.totalPages, page.totalItems); })()}

          {showDispatchEditForm && editingDispatchId && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">Edit Dispatch Note</h3>
                <form onSubmit={handleSaveDispatch}>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date *</label>
                      <DateInput
                        max={todayDate}
                        required
                        value={dispatchEditForm.dispatch_date}
                        onChange={(value) => setDispatchEditForm({ ...dispatchEditForm, dispatch_date: value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Transporter Name</label>
                      <input
                        type="text"
                        value={dispatchEditForm.transporter_name}
                        onChange={(e) =>
                          setDispatchEditForm({ ...dispatchEditForm, transporter_name: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
                      <input
                        type="text"
                        value={dispatchEditForm.vehicle_number}
                        onChange={(e) => setDispatchEditForm({ ...dispatchEditForm, vehicle_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">LR Number</label>
                      <input
                        type="text"
                        value={dispatchEditForm.lr_number}
                        onChange={(e) => setDispatchEditForm({ ...dispatchEditForm, lr_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">LR Date</label>
                      <DateInput
                        max={todayDate}
                        value={dispatchEditForm.lr_date}
                        onChange={(value) => setDispatchEditForm({ ...dispatchEditForm, lr_date: value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Address</label>
                      <textarea
                        value={dispatchEditForm.delivery_address}
                        onChange={(e) =>
                          setDispatchEditForm({ ...dispatchEditForm, delivery_address: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        rows={2}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                      <textarea
                        value={dispatchEditForm.notes}
                        onChange={(e) => setDispatchEditForm({ ...dispatchEditForm, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        rows={2}
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDispatchEditForm(false);
                        setEditingDispatchId(null);
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Billing Tab */}
      {activeTab === 'billing' && (
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold text-[#3F2D20]">Customer Billing & Receivables</h2>
            <p className="text-sm text-[#6F4E37]">Dispatch-linked invoices, tax values, receipts, outstanding balances, and payment status.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {['CURRENT', '1-30', '31-60', '61-90', '90+'].map((bucket) => {
              const amount = invoices.filter((invoice) => invoice.ageing_bucket === bucket).reduce((sum, invoice) => sum + Number(invoice.balance_amount || 0), 0);
              return <div key={bucket} className="rounded-md border border-[#E8DCC4] bg-white p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{bucket === 'CURRENT' ? 'Current' : `${bucket} days`}</div><div className="mt-1 text-lg font-bold text-[#3F2D20]">{formatSalesAmount(amount)}</div></div>;
            })}
          </div>
          {loading ? (
            <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center text-[#7A6756]">Loading customer invoices...</div>
          ) : (
            <div className={registerShellClass}>
              <table className="min-w-[1540px] divide-y divide-[#E8DCC4]">
                <thead className={registerHeadClass}>
                  <tr>
                    <th className={stickyFirstHeaderClass}>Invoice</th>
                    <th className={stickySecondHeaderClass}>Customer</th>
                    <th className={registerHeaderCellClass}>Sales Order</th>
                    <th className={registerHeaderCellClass}>Dispatch</th>
                    <th className={registerHeaderCellClass}>Invoice Date</th>
                    <th className={registerHeaderCellClass}>Due / Ageing</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Invoice Value</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Received</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Outstanding</th>
                    <th className={registerHeaderCellClass}>Status</th>
                    <th className={registerHeaderCellClass}>Actions</th>
                  </tr>
                </thead>
                <tbody className={registerBodyClass}>
                  {getPaginatedAndSortedData(invoices, 'invoice_date').paginatedData.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-[#FFFDF7]">
                      <td className={stickyFirstCellClass}>{invoice.invoice_number}</td>
                      <td className={stickySecondCellClass}>
                        <div className="font-semibold text-[#1F2937]">{invoice.customer?.customer_name || '-'}</div>
                        <div className="text-xs text-[#7A6756]">{invoice.customer?.customer_code || '-'}</div>
                      </td>
                      <td className={registerCellClass}>{invoice.sales_order?.so_number || '-'}</td>
                      <td className={registerCellClass}>{invoice.dispatch_note?.dn_number || '-'}</td>
                      <td className={registerCellClass}>{new Date(invoice.invoice_date).toLocaleDateString()}</td>
                      <td className={registerCellClass}><div>{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-IN') : 'No due date'}</div><div className={`text-xs font-semibold ${Number(invoice.days_overdue || 0) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{invoice.ageing_bucket || 'CURRENT'}{Number(invoice.days_overdue || 0) > 0 ? ` · ${invoice.days_overdue} overdue` : ''}</div></td>
                      <td className={`${registerCellClass} text-right font-semibold`}>{formatSalesAmount(invoice.net_amount)}</td>
                      <td className={`${registerCellClass} text-right`}>{formatSalesAmount(invoice.paid_amount)}</td>
                      <td className={`${registerCellClass} text-right font-semibold`}>{formatSalesAmount(invoice.balance_amount)}</td>
                      <td className={registerCellClass}>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          invoice.payment_status === 'PAID'
                            ? 'bg-green-100 text-green-800'
                            : invoice.payment_status === 'PARTIALLY_PAID'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                        }`}>
                          {(invoice.payment_status || 'UNPAID').replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <ActionIconButton title="View invoice" onClick={() => handleViewInvoice(invoice)}>
                            <Eye size={16} />
                          </ActionIconButton>
                          <ActionIconButton title="Email sales invoice" onClick={() => handleSendInvoiceEmail(invoice)} tone="primary">
                            <Mail size={16} />
                          </ActionIconButton>
                          {canEdit && invoice.billing_status !== 'CANCELLED' && (
                            <button type="button" onClick={() => openInvoiceStatutoryDetails(invoice)} className="inline-flex h-9 items-center rounded-md border border-[#D9C9AD] bg-white px-3 text-xs font-semibold text-[#6F4E37] hover:bg-[#FFF8E8]">
                              {regionalProfile.taxLabel} / E-way
                            </button>
                          )}
                          {canEdit && Number(invoice.balance_amount || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setReceiptInvoice(invoice);
                                setReceiptForm((current) => ({ ...current, amount: String(invoice.balance_amount || '') }));
                              }}
                              className="inline-flex h-9 items-center gap-2 rounded-md border border-green-200 bg-white px-3 text-xs font-semibold text-green-700 hover:bg-green-50"
                            >
                              <ReceiptIndianRupee size={15} /> Record Receipt
                            </button>
                          )}
                          {canEdit && invoice.billing_status !== 'CANCELLED' && Number(invoice.balance_amount || 0) > 0 && <button type="button" onClick={() => { setCollectionInvoice(invoice); setCollectionForm({ collection_status: invoice.collection_status && invoice.collection_status !== 'NOT_STARTED' ? invoice.collection_status : 'CONTACTED', next_follow_up_date: invoice.next_follow_up_date || '', promise_to_pay_date: invoice.promise_to_pay_date || '', notes: invoice.collection_notes || '' }); }} className="inline-flex h-9 items-center rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-50">Follow-up</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!invoices.length && (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-[#7A6756]">No customer invoices have been generated from dispatches.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {(() => { const page = getPaginatedAndSortedData(invoices, 'invoice_date'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {activeTab === 'collections' && (
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold text-[#3F2D20]">Credit & Collections Worklist</h2>
            <p className="text-sm text-[#6F4E37]">Prioritized Sales and Service receivables, follow-up commitments, broken promises, and dunning status.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['Open Items', collectionsWorklist?.summary.open_items || 0, false],
              ['Total Outstanding', collectionsWorklist?.summary.total_outstanding || 0, true],
              ['Overdue Outstanding', collectionsWorklist?.summary.overdue_outstanding || 0, true],
              ['Follow-ups Due', collectionsWorklist?.summary.follow_ups_due || 0, false],
              ['Broken Promises', collectionsWorklist?.summary.broken_promises || 0, false],
            ].map(([label, value, money]) => <div key={String(label)} className="rounded-md border border-[#E8DCC4] bg-white p-4"><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className={`mt-1 text-xl font-bold ${label === 'Broken Promises' && Number(value) > 0 ? 'text-red-700' : 'text-[#3F2D20]'}`}>{money ? formatSalesAmount(Number(value)) : formatIndianNumber(Number(value))}</div></div>)}
          </div>
          {loading ? <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center text-[#7A6756]">Loading collections worklist...</div> : (
            <div className={registerShellClass}>
              <table className="min-w-[1580px] divide-y divide-[#E8DCC4]">
                <thead className={registerHeadClass}><tr>
                  <th className={stickyFirstHeaderClass}>Invoice</th><th className={stickySecondHeaderClass}>Customer</th><th className={registerHeaderCellClass}>Source</th><th className={registerHeaderCellClass}>Invoice Date</th><th className={registerHeaderCellClass}>Due / Ageing</th><th className={`${registerHeaderCellClass} text-right`}>Outstanding</th><th className={registerHeaderCellClass}>Collection Status</th><th className={registerHeaderCellClass}>Next Action</th><th className={registerHeaderCellClass}>Latest Reminder</th><th className={registerHeaderCellClass}>Actions</th>
                </tr></thead>
                <tbody className={registerBodyClass}>
                  {getPaginatedAndSortedData(collectionsWorklist?.items || [], 'days_overdue').paginatedData.map((invoice) => <tr key={`${invoice.source}-${invoice.id}`} className={invoice.broken_promise ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-[#FFFDF7]'}>
                    <td className={stickyFirstCellClass}>{invoice.invoice_number}</td>
                    <td className={stickySecondCellClass}><div className="font-semibold text-[#1F2937]">{invoice.customer?.customer_name || '-'}</div><div className="text-xs text-[#7A6756]">{invoice.customer?.customer_code || '-'}</div></td>
                    <td className={registerCellClass}><span className={`rounded-full px-2 py-1 text-xs font-semibold ${invoice.source === 'SERVICE' ? 'bg-violet-100 text-violet-800' : 'bg-blue-100 text-blue-800'}`}>{invoice.source}</span></td>
                    <td className={registerCellClass}>{invoice.invoice_date ? new Date(`${invoice.invoice_date}T00:00:00`).toLocaleDateString('en-IN') : '-'}</td>
                    <td className={registerCellClass}><div>{invoice.due_date ? new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString('en-IN') : 'No due date'}</div><div className={`text-xs font-semibold ${Number(invoice.days_overdue || 0) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{Number(invoice.days_overdue || 0) > 0 ? `${invoice.days_overdue} days overdue` : 'Current'}</div></td>
                    <td className={`${registerCellClass} text-right font-bold`}>{formatSalesAmount(invoice.balance_amount)}</td>
                    <td className={registerCellClass}><span className="rounded-full bg-[#F6EFE2] px-2 py-1 text-xs font-semibold">{String(invoice.status || 'NOT_STARTED').replaceAll('_', ' ')}</span>{invoice.broken_promise && <div className="mt-1 text-xs font-bold text-red-700">BROKEN PROMISE</div>}</td>
                    <td className={registerCellClass}><div>{invoice.promise_to_pay_date ? `Promise: ${new Date(`${invoice.promise_to_pay_date}T00:00:00`).toLocaleDateString('en-IN')}` : invoice.next_follow_up_date ? `Follow-up: ${new Date(`${invoice.next_follow_up_date}T00:00:00`).toLocaleDateString('en-IN')}` : 'Not scheduled'}</div>{invoice.follow_up_due && <div className="text-xs font-bold text-amber-700">Action due</div>}</td>
                    <td className={registerCellClass}>{invoice.latest_dunning ? <div><div className="font-semibold">Level {invoice.latest_dunning.dunning_level}</div><div className="text-xs text-[#7A6756]">{invoice.latest_dunning.notice_number}</div><button type="button" disabled={dunningDetailLoading} onClick={() => void openDunningNotice(invoice.latest_dunning!.id)} className="mt-1 text-xs font-semibold text-[#8B6F47] underline disabled:opacity-50">View reminder</button></div> : 'Not issued'}</td>
                    <td className={registerCellClass}><div className="flex gap-2">
                      <button type="button" onClick={() => void openCustomerStatement({ id: String(invoice.customer_id), customer_code: invoice.customer?.customer_code || '-', customer_name: invoice.customer?.customer_name || '-', customer_type: '', credit_limit: 0, credit_days: 0, is_active: true })} className="rounded-md border border-[#D9C9AD] px-3 py-2 text-xs font-semibold text-[#6F4E37]">Statement</button>
                      {canEdit && <button type="button" onClick={() => { setCollectionInvoice(invoice); setCollectionForm({ collection_status: invoice.collection_status && invoice.collection_status !== 'NOT_STARTED' ? invoice.collection_status : 'CONTACTED', next_follow_up_date: invoice.next_follow_up_date || '', promise_to_pay_date: invoice.promise_to_pay_date || '', notes: invoice.collection_notes || '' }); }} className="rounded-md border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800">Follow-up</button>}
                    </div></td>
                  </tr>)}
                  {!collectionsWorklist?.items.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-[#7A6756]">No open customer receivables.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {(() => { const page = getPaginatedAndSortedData(collectionsWorklist?.items || [], 'days_overdue'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {/* Warranties Tab */}
      {activeTab === 'returns' && (
        <div className="space-y-3">
          <div><h2 className="text-xl font-bold text-[#3F2D20]">Sales Returns</h2><p className="text-sm text-[#6F4E37]">Returns are received into a selected warehouse and only QC-approved quantities increase stock.</p></div>
          <div className={registerShellClass}><table className="min-w-[1120px] divide-y divide-[#E8DCC4]"><thead className={registerHeadClass}><tr><th className={stickyFirstHeaderClass}>Return</th><th className={stickySecondHeaderClass}>Customer</th><th className={registerHeaderCellClass}>Invoice</th><th className={registerHeaderCellClass}>Return Date</th><th className={registerHeaderCellClass}>Reason</th><th className={`${registerHeaderCellClass} text-right`}>Lines / Qty</th><th className={registerHeaderCellClass}>Status</th><th className={registerHeaderCellClass}>Actions</th></tr></thead><tbody className="divide-y divide-[#EFE5D2]">{getPaginatedAndSortedData(salesReturns, 'return_date').paginatedData.map((salesReturn) => { const totalQty = (salesReturn.items || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0); return <tr key={salesReturn.id} className="hover:bg-[#FFFDF7]"><td className={`${stickyFirstCellClass} font-semibold text-[#8B6F47]`}>{salesReturn.return_number}</td><td className={stickySecondCellClass}>{salesReturn.customer?.customer_name || '-'}</td><td className={registerCellClass}>{salesReturn.invoice?.invoice_number || '-'}</td><td className={registerCellClass}>{salesReturn.return_date ? new Date(salesReturn.return_date).toLocaleDateString('en-IN') : '-'}</td><td className={`${registerCellClass} max-w-[280px] truncate`} title={salesReturn.reason}>{salesReturn.reason || '-'}</td><td className={`${registerCellClass} text-right`}>{(salesReturn.items || []).length} / {totalQty.toLocaleString('en-IN')}</td><td className={registerCellClass}><span className={`rounded-full px-2 py-1 text-xs font-semibold ${salesReturn.status === 'QC_COMPLETED' ? 'bg-emerald-100 text-emerald-800' : salesReturn.status === 'RECEIVED_PENDING_QC' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>{salesReturn.status.replaceAll('_', ' ')}</span></td><td className={registerCellClass}><div className="flex gap-2">{canEdit && salesReturn.status === 'DRAFT' && <button type="button" onClick={() => void openSalesReturnReceipt(salesReturn)} className="rounded border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700">Receive</button>}{canEdit && salesReturn.status === 'RECEIVED_PENDING_QC' && <button type="button" onClick={() => openSalesReturnQc(salesReturn)} className="rounded border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800">QC Inspection</button>}{salesReturn.status === 'QC_COMPLETED' && <span className="text-xs font-semibold text-emerald-700">Stock posted</span>}</div></td></tr>; })}{!salesReturns.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[#7A6756]">No sales returns found.</td></tr>}</tbody></table></div>
          {(() => { const page = getPaginatedAndSortedData(salesReturns, 'return_date'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {activeTab === 'warranties' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#3F2D20]">Warranty Register</h2>
              <p className="text-sm text-[#6F4E37]">UID-linked warranty certificates, coverage dates, claim count, and status.</p>
            </div>
            <button
              onClick={() => setShowWarrantyForm(true)}
              className="inline-flex items-center gap-2 rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#745A37]"
            >
              <Plus size={16} /> Register Warranty
            </button>
          </div>
          {loading ? (
            <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center text-[#7A6756]">Loading warranties...</div>
          ) : (
            <div className={registerShellClass}>
              <table className="min-w-[1320px] divide-y divide-[#E8DCC4]">
                <thead className={registerHeadClass}>
                  <tr>
                    <th className={stickyFirstHeaderClass}>Warranty No.</th>
                    <th className={stickySecondHeaderClass}>UID</th>
                    <th className={registerHeaderCellClass}>Customer</th>
                    <th className={registerHeaderCellClass}>Start Date</th>
                    <th className={registerHeaderCellClass}>Duration</th>
                    <th className={registerHeaderCellClass}>End Date</th>
                    <th className={registerHeaderCellClass}>Status</th>
                    <th className={registerHeaderCellClass}>Claims</th>
                    <th className={registerHeaderCellClass}>Actions</th>
                  </tr>
                </thead>
                <tbody className={registerBodyClass}>
                  {getPaginatedAndSortedData(warranties, 'warranty_start_date').paginatedData.map((warranty) => (
                    <tr key={warranty.id} className="hover:bg-[#FFFDF7]">
                      <td className={stickyFirstCellClass}>
                        {warranty.warranty_number}
                      </td>
                      <td className={`${stickySecondCellClass} font-mono`}>
                        {warranty.uid}
                      </td>
                      <td className={registerCellClass}>
                        {warranty.customer_name || '-'}
                      </td>
                      <td className={registerCellClass}>
                        {new Date(warranty.warranty_start_date).toLocaleDateString()}
                      </td>
                      <td className={registerCellClass}>
                        {warranty.warranty_duration_months} months
                      </td>
                      <td className={registerCellClass}>
                        {new Date(warranty.warranty_end_date).toLocaleDateString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(warranty.status)}`}>
                          {warranty.status}
                        </span>
                      </td>
                      <td className={registerCellClass}>
                        {warranty.claim_count}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <ActionIconButton
                            title="Print warranty"
                            onClick={() => handlePrintWarranty(warranty.id)}
                            tone="primary"
                          >
                            <Printer size={16} />
                          </ActionIconButton>
                          {canEdit && (
                            <ActionIconButton
                              title="Edit warranty"
                              onClick={() => handleEditWarranty(warranty)}
                              tone="warning"
                            >
                              <Pencil size={16} />
                            </ActionIconButton>
                          )}
                          {canDelete && (
                            <ActionIconButton
                              title="Delete warranty"
                              onClick={() => handleDeleteWarranty(warranty)}
                              tone="danger"
                            >
                              <Trash2 size={16} />
                            </ActionIconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(() => { const page = getPaginatedAndSortedData(warranties, 'warranty_start_date'); return renderPagination(page.totalPages, page.totalItems); })()}

          {showWarrantyEditForm && editingWarrantyId && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-lg w-full">
                <h3 className="text-lg font-semibold mb-4">Edit Warranty</h3>
                <form onSubmit={handleSaveWarranty}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Warranty Type *</label>
                      <select
                        required
                        value={warrantyEditForm.warranty_type}
                        onChange={(e) => setWarrantyEditForm({ ...warrantyEditForm, warranty_type: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="STANDARD">Standard Warranty</option>
                        <option value="EXTENDED">Extended Warranty</option>
                        <option value="COMPREHENSIVE">Comprehensive</option>
                        <option value="LIMITED">Limited Warranty</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                      <select
                        required
                        value={warrantyEditForm.status}
                        onChange={(e) => setWarrantyEditForm({ ...warrantyEditForm, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="CLAIMED">Claimed</option>
                        <option value="EXPIRED">Expired</option>
                        <option value="VOID">Void</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowWarrantyEditForm(false);
                        setEditingWarrantyId(null);
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Warranty Form Modal */}
          {showWarrantyForm && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-lg w-full">
                <h3 className="text-lg font-semibold mb-4">Register Warranty</h3>
                <form onSubmit={handleCreateWarranty}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">UID (Unique Identification) *</label>
                      <input
                        type="text"
                        required
                        placeholder="Enter UID from dispatch"
                        value={warrantyForm.uid}
                        onChange={(e) => setWarrantyForm({ ...warrantyForm, uid: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                      <p className="text-xs text-gray-500 mt-1">UID must be from a dispatched item</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Warranty Duration (Months) *</label>
                      <input
                        type="number"
                        required
                        min="1"
                        max="120"
                        value={warrantyForm.warranty_duration_months}
                        onChange={(e) => setWarrantyForm({ ...warrantyForm, warranty_duration_months: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Warranty Type *</label>
                      <select
                        required
                        value={warrantyForm.warranty_type}
                        onChange={(e) => setWarrantyForm({ ...warrantyForm, warranty_type: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="STANDARD">Standard Warranty</option>
                        <option value="EXTENDED">Extended Warranty</option>
                        <option value="COMPREHENSIVE">Comprehensive</option>
                        <option value="LIMITED">Limited Warranty</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                      <textarea
                        rows={3}
                        value={warrantyForm.notes}
                        onChange={(e) => setWarrantyForm({ ...warrantyForm, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        placeholder="Additional warranty terms or conditions..."
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setShowWarrantyForm(false)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Registering...' : 'Register Warranty'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Duplicate Warning Modals */}
      <DuplicateWarning
        isOpen={customerDuplicateDetection.duplicateState.isOpen}
        exactMatches={customerDuplicateDetection.duplicateState.exactMatches}
        fuzzyMatches={customerDuplicateDetection.duplicateState.fuzzyMatches}
        entityType="Customer"
        onProceed={customerDuplicateDetection.handleProceed}
        onCancel={customerDuplicateDetection.handleCancel}
        formatRecord={(data) => (
          <div className="text-sm">
            <p className="font-semibold">{data.customer_name}</p>
            <p className="text-xs text-gray-600">{regionalProfile.taxRegistrationLabel}: {data.gst_number || 'N/A'}</p>
            <p className="text-xs text-gray-600">Contact: {data.contact_person}</p>
            <p className="text-xs text-gray-600">Phone: {data.phone || data.mobile}</p>
          </div>
        )}
      />

      <DuplicateWarning
        isOpen={quotationDuplicateDetection.duplicateState.isOpen}
        exactMatches={quotationDuplicateDetection.duplicateState.exactMatches}
        fuzzyMatches={quotationDuplicateDetection.duplicateState.fuzzyMatches}
        entityType="Quotation"
        onProceed={quotationDuplicateDetection.handleProceed}
        onCancel={quotationDuplicateDetection.handleCancel}
        formatRecord={(data) => (
          <div className="text-sm">
            <p className="font-semibold">Quote #{data.quotation_number}</p>
            <p className="text-xs text-gray-600">Customer: {data.customer_name}</p>
            <p className="text-xs text-gray-600">Items: {data.items?.length || data.quotation_items?.length || 0}</p>
            <p className="text-xs text-gray-600">Total: {formatSalesAmount(data.total_amount ?? data.net_amount)}</p>
          </div>
        )}
      />

      <DuplicateWarning
        isOpen={salesOrderDuplicateDetection.duplicateState.isOpen}
        exactMatches={salesOrderDuplicateDetection.duplicateState.exactMatches}
        fuzzyMatches={salesOrderDuplicateDetection.duplicateState.fuzzyMatches}
        entityType="Sales Order"
        onProceed={salesOrderDuplicateDetection.handleProceed}
        onCancel={salesOrderDuplicateDetection.handleCancel}
        formatRecord={(data) => (
          <div className="text-sm">
            <p className="font-semibold">SO #{data.so_number}</p>
            <p className="text-xs text-gray-600">Customer: {data.customer_name}</p>
            <p className="text-xs text-gray-600">Items: {data.items?.length || data.sales_order_items?.length || 0}</p>
            <p className="text-xs text-gray-600">Total: {formatSalesAmount(data.total_amount ?? data.net_amount)}</p>
          </div>
        )}
      />

      {salesOrderFlow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase text-[#8B6F47]">Sales Document Flow</div>
                <h3 className="text-xl font-bold text-[#3F2D20]">{salesOrderFlow.sales_order?.so_number}</h3>
                <p className="text-sm text-[#6F4E37]">Order → Dispatch / PGI → Delivery → Invoice → Customer Receipt</p>
              </div>
              <button type="button" onClick={() => setSalesOrderFlow(null)} className="text-2xl text-[#6F4E37]" aria-label="Close sales document flow">&times;</button>
            </div>
            <div className="space-y-5 overflow-auto p-6">
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  ['Customer', salesOrderFlow.customer?.customer_name || '-'],
                  ['Status', salesOrderFlow.sales_order?.status || '-'],
                  ['Order Value', formatSalesAmount(salesOrderFlow.sales_order?.net_amount)],
                  ['Outstanding', formatSalesAmount(salesOrderFlow.sales_order?.balance_amount)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border border-[#E8DCC4] bg-[#FFFDF8] p-3">
                    <div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div>
                    <div className="mt-1 font-semibold text-[#3F2D20]">{value}</div>
                  </div>
                ))}
              </div>
              <div className={registerShellClass}>
                <table className="min-w-full divide-y divide-[#E8DCC4]">
                  <thead className={registerHeadClass}><tr>{['Document', 'Date', 'Type', 'Status', 'Value / Receipt'].map((heading) => <th key={heading} className={registerHeaderCellClass}>{heading}</th>)}</tr></thead>
                  <tbody className={registerBodyClass}>
                    <tr><td className={registerCellClass}>{salesOrderFlow.sales_order?.so_number}</td><td className={registerCellClass}>{salesOrderFlow.sales_order?.order_date || '-'}</td><td className={registerCellClass}>Sales Order</td><td className={registerCellClass}>{salesOrderFlow.sales_order?.status}</td><td className={registerCellClass}>{formatSalesAmount(salesOrderFlow.sales_order?.net_amount)}</td></tr>
                    {(salesOrderFlow.fulfilment_tasks || []).map((task: any) => <tr key={task.id}><td className={registerCellClass}>{task.task_number}</td><td className={registerCellClass}>{task.planned_dispatch_date || '-'}</td><td className={registerCellClass}>Pick / Pack Fulfilment</td><td className={registerCellClass}>{String(task.status || '').replaceAll('_', ' ')}</td><td className={registerCellClass}>{(task.items || []).length} line(s)</td></tr>)}
                    {(salesOrderFlow.dispatches || []).map((dispatch: any) => <tr key={dispatch.id}><td className={registerCellClass}>{dispatch.dn_number}</td><td className={registerCellClass}>{dispatch.dispatch_date || '-'}</td><td className={registerCellClass}>Dispatch / PGI</td><td className={registerCellClass}>{dispatch.status || 'PGI_POSTED'}</td><td className={registerCellClass}>{(dispatch.items || []).length} UID line(s)</td></tr>)}
                    {(salesOrderFlow.invoices || []).flatMap((invoice: any) => [
                      <tr key={invoice.id}><td className={registerCellClass}><div>{invoice.invoice_number}</div>{invoice.irn && <div className="mt-1 max-w-[260px] break-all text-xs text-[#7A6756]">IRN: {invoice.irn}</div>}{invoice.eway_bill_number && <div className="text-xs text-[#7A6756]">E-way: {invoice.eway_bill_number}</div>}</td><td className={registerCellClass}>{invoice.invoice_date || '-'}</td><td className={registerCellClass}>Customer Invoice</td><td className={registerCellClass}>{invoice.payment_status || invoice.billing_status}<div className="mt-1 text-xs text-[#7A6756]">Statutory: {String(invoice.statutory_status || 'PENDING').replaceAll('_', ' ')}</div></td><td className={registerCellClass}>{formatSalesAmount(invoice.net_amount)}</td></tr>,
                      ...(invoice.payments || []).map((payment: any) => <tr key={payment.id}><td className={registerCellClass}>{payment.receipt_number}</td><td className={registerCellClass}>{payment.receipt_date || '-'}</td><td className={registerCellClass}>Customer Receipt</td><td className={registerCellClass}>{payment.reversed_at ? 'REVERSED' : 'POSTED'}</td><td className={registerCellClass}>{formatSalesAmount(payment.amount)}</td></tr>),
                      ...(invoice.credit_notes || []).map((creditNote: any) => <tr key={creditNote.id}><td className={registerCellClass}>{creditNote.credit_note_number}</td><td className={registerCellClass}>{creditNote.credit_note_date || '-'}</td><td className={registerCellClass}>Sales Credit Note</td><td className={registerCellClass}>{creditNote.status || 'POSTED'}</td><td className={registerCellClass}>-{formatSalesAmount(creditNote.net_amount)}</td></tr>),
                    ])}
                    {(salesOrderFlow.returns || []).map((salesReturn: any) => <tr key={salesReturn.id}><td className={registerCellClass}>{salesReturn.return_number}</td><td className={registerCellClass}>{salesReturn.return_date || '-'}</td><td className={registerCellClass}>Sales Return</td><td className={registerCellClass}>{String(salesReturn.status || '').replaceAll('_', ' ')}</td><td className={registerCellClass}>{(salesReturn.items || []).length} item line(s)</td></tr>)}
                  </tbody>
                </table>
              </div>
              {(salesOrderFlow.events || []).length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase text-[#8B6F47]">Control & Audit Events</h4>
                  <div className={registerShellClass}>
                    <table className="min-w-full divide-y divide-[#E8DCC4]">
                      <thead className={registerHeadClass}><tr>{['Time', 'Event', 'Document', 'Remarks'].map((heading) => <th key={heading} className={registerHeaderCellClass}>{heading}</th>)}</tr></thead>
                      <tbody className={registerBodyClass}>
                        {salesOrderFlow.events.map((event: any) => <tr key={event.id}><td className={registerCellClass}>{event.event_at ? new Date(event.event_at).toLocaleString('en-IN') : '-'}</td><td className={registerCellClass}>{String(event.event_type || '').replaceAll('_', ' ')}</td><td className={registerCellClass}>{event.document_number || event.document_type || '-'}</td><td className={registerCellClass}>{event.remarks || '-'}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="flex justify-end"><button type="button" onClick={() => void downloadSalesDocumentPdf(`/sales/orders/${salesOrderFlow.sales_order.id}/pdf`, `${salesOrderFlow.sales_order.so_number}.pdf`)} className="rounded-md border border-[#8B6F47] px-4 py-2 font-semibold text-[#6F4E37] hover:bg-[#FFF8EC]">Download PDF</button></div>
            </div>
          </div>
        </div>
      )}

      {viewingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase text-[#8B6F47]">Customer Invoice</div>
                <h3 className="text-xl font-bold text-[#3F2D20]">{viewingInvoice.invoice_number}</h3>
              </div>
              <button type="button" onClick={() => setViewingInvoice(null)} className="text-2xl text-[#6F4E37]" aria-label="Close invoice">&times;</button>
            </div>
            <div className="overflow-auto p-6">
              <div className="mb-5 grid gap-3 md:grid-cols-4">
                {[
                  ['Customer', viewingInvoice.customer?.customer_name || '-'],
                  ['Sales Order', viewingInvoice.sales_order?.so_number || '-'],
                  ['Dispatch', viewingInvoice.dispatch_note?.dn_number || '-'],
                  ['Payment Status', (viewingInvoice.payment_status || 'UNPAID').replaceAll('_', ' ')],
                  ['Invoice Value', formatSalesAmount(viewingInvoice.net_amount)],
                  ['Received', formatSalesAmount(viewingInvoice.paid_amount)],
                  ['Credited', formatSalesAmount(viewingInvoice.credited_amount)],
                  ['Outstanding', formatSalesAmount(viewingInvoice.balance_amount)],
                  ['Due Date', viewingInvoice.due_date ? new Date(viewingInvoice.due_date).toLocaleDateString() : '-'],
                  ['Statutory Status', (viewingInvoice.statutory_status || 'PENDING').replaceAll('_', ' ')],
                  ['IRN', viewingInvoice.irn || '-'],
                  ['IRN Acknowledgement', viewingInvoice.irn_ack_number ? `${viewingInvoice.irn_ack_number}${viewingInvoice.irn_ack_date ? ` / ${String(viewingInvoice.irn_ack_date).slice(0, 10)}` : ''}` : '-'],
                  ['E-way Bill', viewingInvoice.eway_bill_number ? `${viewingInvoice.eway_bill_number}${viewingInvoice.eway_bill_valid_until ? ` / valid until ${String(viewingInvoice.eway_bill_valid_until).slice(0, 10)}` : ''}` : '-'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-3">
                    <div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div>
                    <div className="mt-1 font-semibold text-[#3F2D20]">{value}</div>
                  </div>
                ))}
              </div>
              <div className={registerShellClass}>
                <table className="min-w-full divide-y divide-[#E8DCC4]">
                  <thead className={registerHeadClass}><tr>
                    <th className={registerHeaderCellClass}>Item</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Quantity</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Rate</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Tax</th>
                    <th className={`${registerHeaderCellClass} text-right`}>Line Total</th>
                  </tr></thead>
                  <tbody className={registerBodyClass}>
                    {(viewingInvoice.items || []).map((item: any) => (
                      <tr key={item.id}>
                        <td className={registerCellClass}>{item.item_description || item.item_id || '-'}</td>
                        <td className={`${registerCellClass} text-right`}>{Number(item.quantity || 0).toLocaleString('en-IN')}</td>
                        <td className={`${registerCellClass} text-right`}>{formatSalesAmount(item.unit_price)}</td>
                        <td className={`${registerCellClass} text-right`}>{formatSalesAmount(item.tax_amount)}</td>
                        <td className={`${registerCellClass} text-right font-semibold`}>{formatSalesAmount(item.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 overflow-x-auto rounded-md border border-[#E8DCC4]">
                <table className="min-w-full divide-y divide-[#E8DCC4]"><thead className={registerHeadClass}><tr><th className={registerHeaderCellClass}>Receipt</th><th className={registerHeaderCellClass}>Date</th><th className={registerHeaderCellClass}>Method / Reference</th><th className={`${registerHeaderCellClass} text-right`}>Amount</th><th className={registerHeaderCellClass}>Status / Action</th></tr></thead><tbody className={registerBodyClass}>
                  {(viewingInvoice.payments || []).map((payment: any) => <tr key={payment.id}><td className={registerCellClass}>{payment.receipt_number}</td><td className={registerCellClass}>{payment.receipt_date || '-'}</td><td className={registerCellClass}>{payment.payment_method}{payment.payment_reference ? ` / ${payment.payment_reference}` : ''}</td><td className={`${registerCellClass} text-right`}>{formatSalesAmount(payment.amount)}</td><td className={registerCellClass}><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void downloadSalesDocumentPdf(`/sales/invoices/${viewingInvoice.id}/payments/${payment.id}/pdf`, `${payment.receipt_number}.pdf`)} className="rounded-md border border-[#D9C9AD] px-2 py-1 text-xs font-semibold text-[#6F4E37]">Download PDF</button>{canEdit && !payment.reversed_at && <button type="button" onClick={() => void handleSendCustomerReceiptEmail(viewingInvoice, payment)} className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700">Email Receipt</button>}{payment.reversed_at ? <span>{`REVERSED - ${payment.reversal_reason || ''}`}</span> : canEdit ? <button type="button" onClick={() => handleReverseInvoicePayment(viewingInvoice, payment)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700">Reverse</button> : <span>POSTED</span>}</div></td></tr>)}
                  {!(viewingInvoice.payments || []).length && <tr><td colSpan={5} className="px-4 py-5 text-center text-sm text-[#7A6756]">No customer receipts posted.</td></tr>}
                </tbody></table>
              </div>
              <div className="mt-5 overflow-x-auto rounded-md border border-[#E8DCC4]">
                <table className="min-w-full divide-y divide-[#E8DCC4]"><thead className={registerHeadClass}><tr><th className={registerHeaderCellClass}>Credit Note</th><th className={registerHeaderCellClass}>Date</th><th className={registerHeaderCellClass}>Reason / Reference</th><th className={`${registerHeaderCellClass} text-right`}>Taxable</th><th className={`${registerHeaderCellClass} text-right`}>{regionalProfile.taxLabel}</th><th className={`${registerHeaderCellClass} text-right`}>Credit Amount</th><th className={registerHeaderCellClass}>Status / Action</th></tr></thead><tbody className={registerBodyClass}>
                  {(viewingInvoice.credit_notes || []).map((creditNote: any) => <tr key={creditNote.id}><td className={registerCellClass}>{creditNote.credit_note_number}</td><td className={registerCellClass}>{creditNote.credit_note_date || '-'}</td><td className={registerCellClass}>{creditNote.reason}{creditNote.external_reference ? ` / ${creditNote.external_reference}` : ''}</td><td className={`${registerCellClass} text-right`}>{formatSalesAmount(creditNote.taxable_amount)}</td><td className={`${registerCellClass} text-right`}>{formatSalesAmount(creditNote.tax_amount)}</td><td className={`${registerCellClass} text-right`}>{formatSalesAmount(creditNote.net_amount)}</td><td className={registerCellClass}>{creditNote.status === 'CANCELLED' ? `CANCELLED - ${creditNote.cancellation_reason || ''}` : canEdit ? <button type="button" onClick={() => handleCancelCreditNote(creditNote)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700">Cancel</button> : 'POSTED'}</td></tr>)}
                  {!(viewingInvoice.credit_notes || []).length && <tr><td colSpan={7} className="px-4 py-5 text-center text-sm text-[#7A6756]">No credit notes posted.</td></tr>}
                </tbody></table>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4">
              <button type="button" onClick={() => void downloadSalesDocumentPdf(`/sales/invoices/${viewingInvoice.id}/pdf`, `${viewingInvoice.invoice_number}.pdf`)} className="rounded-md border border-[#8B6F47] px-4 py-2 font-semibold text-[#6F4E37]">Download PDF</button>
              {regionalProfile.marketProfile === 'INDIA' && canEdit && (viewingInvoice as any).billing_status !== 'CANCELLED' && <button type="button" onClick={() => openInvoiceStatutoryDetails(viewingInvoice)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Statutory Details</button>}
              {canEdit && (viewingInvoice as any).billing_status !== 'CANCELLED' && Number(viewingInvoice.balance_amount || 0) > 0 && <button type="button" onClick={() => { setCreditInvoice(viewingInvoice); setCreditNoteForm({ taxable_amount: '', tax_percentage: '0', credit_note_date: getTodayDateInputValue(), reason: '', external_reference: '' }); }} className="rounded-md border border-amber-200 px-4 py-2 font-semibold text-amber-800">Create Credit Note</button>}
              {canEdit && (viewingInvoice as any).billing_status !== 'CANCELLED' && <button type="button" onClick={() => { setReturnInvoice(viewingInvoice); setReturnReason(''); setReturnLines({}); }} className="rounded-md border border-blue-200 px-4 py-2 font-semibold text-blue-800">Create Return Request</button>}
              {canEdit && (viewingInvoice as any).billing_status !== 'CANCELLED' && <button type="button" onClick={() => handleCancelInvoice(viewingInvoice)} className="rounded-md border border-red-200 px-4 py-2 font-semibold text-red-700">Cancel Invoice</button>}
              <button type="button" onClick={() => setViewingInvoice(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Close</button>
            </div>
          </div>
        </div>
      )}

      {statutoryInvoice && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={handleSaveInvoiceStatutoryDetails} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#D9C9AD] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase text-[#8B6F47]">Indian Statutory Invoice Control</div>
                <h3 className="text-xl font-bold text-[#3F2D20]">{statutoryInvoice.invoice_number}</h3>
                <p className="mt-1 text-sm text-[#7A6756]">Record references generated on the GST/e-way portals. These values are printed on the invoice and retained in its audit trail.</p>
              </div>
              <button type="button" onClick={() => setStatutoryInvoice(null)} className="text-2xl text-[#6F4E37]" aria-label="Close statutory details">&times;</button>
            </div>
            <div className="overflow-auto p-6">
              <label className="mb-5 flex items-start gap-3 rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-4">
                <input type="checkbox" checked={statutoryForm.not_applicable} onChange={(event) => setStatutoryForm((current) => ({ ...current, not_applicable: event.target.checked }))} className="mt-1 h-4 w-4" />
                <span><span className="block font-semibold text-[#3F2D20]">Statutory references not applicable</span><span className="text-sm text-[#7A6756]">Use only when this invoice is exempt or outside the applicable statutory threshold.</span></span>
              </label>
              {statutoryForm.not_applicable ? (
                <label className="block text-sm font-semibold text-[#6F4E37]">Reason *
                  <textarea value={statutoryForm.statutory_exemption_reason} onChange={(event) => setStatutoryForm((current) => ({ ...current, statutory_exemption_reason: event.target.value }))} rows={3} required className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2 font-normal text-[#3F2D20]" placeholder="State the exemption or non-applicability reason" />
                </label>
              ) : (
                <div className="space-y-5">
                  <section className="rounded-md border border-[#E8DCC4] p-4">
                    <h4 className="font-bold text-[#3F2D20]">E-invoice reference</h4>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <label className="text-sm font-semibold text-[#6F4E37] md:col-span-2">IRN
                        <input value={statutoryForm.irn} onChange={(event) => setStatutoryForm((current) => ({ ...current, irn: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2 font-mono font-normal uppercase text-[#3F2D20]" placeholder="Invoice Reference Number" />
                      </label>
                      <label className="text-sm font-semibold text-[#6F4E37]">Acknowledgement number
                        <input value={statutoryForm.irn_ack_number} onChange={(event) => setStatutoryForm((current) => ({ ...current, irn_ack_number: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2 font-normal text-[#3F2D20]" />
                      </label>
                      <label className="text-sm font-semibold text-[#6F4E37]">Acknowledgement date
                        <input type="date" max={todayDate} value={statutoryForm.irn_ack_date} onChange={(event) => setStatutoryForm((current) => ({ ...current, irn_ack_date: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2 font-normal text-[#3F2D20]" />
                      </label>
                    </div>
                  </section>
                  <section className="rounded-md border border-[#E8DCC4] p-4">
                    <h4 className="font-bold text-[#3F2D20]">E-way bill reference</h4>
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                      <label className="text-sm font-semibold text-[#6F4E37] md:col-span-3">E-way bill number
                        <input value={statutoryForm.eway_bill_number} onChange={(event) => setStatutoryForm((current) => ({ ...current, eway_bill_number: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2 font-normal uppercase text-[#3F2D20]" />
                      </label>
                      <label className="text-sm font-semibold text-[#6F4E37]">Generated date
                        <input type="date" max={todayDate} value={statutoryForm.eway_bill_date} onChange={(event) => setStatutoryForm((current) => ({ ...current, eway_bill_date: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2 font-normal text-[#3F2D20]" />
                      </label>
                      <label className="text-sm font-semibold text-[#6F4E37]">Valid until
                        <input type="date" value={statutoryForm.eway_bill_valid_until} onChange={(event) => setStatutoryForm((current) => ({ ...current, eway_bill_valid_until: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2 font-normal text-[#3F2D20]" />
                      </label>
                    </div>
                  </section>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4">
              <button type="button" onClick={() => setStatutoryInvoice(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Cancel</button>
              <button type="submit" disabled={savingStatutoryDetails} className="rounded-md bg-[#6F4E37] px-5 py-2 font-semibold text-white disabled:opacity-60">{savingStatutoryDetails ? 'Saving...' : 'Save Statutory Details'}</button>
            </div>
          </form>
        </div>
      )}

      {deliveryConfirmation && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={handleConfirmDelivery} className="w-full max-w-2xl overflow-hidden rounded-lg border border-[#D9C9AD] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Proof of Delivery</div>
                <h3 className="text-xl font-bold text-[#3F2D20]">Confirm Customer Delivery</h3>
                <p className="text-sm text-[#7A6756]">{deliveryConfirmation.dn_number} · Record who accepted the shipment and retain supporting evidence.</p>
              </div>
              <button type="button" onClick={() => setDeliveryConfirmation(null)} className="text-2xl text-[#6F4E37]" aria-label="Close delivery confirmation">&times;</button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2">
              <label className="text-sm font-semibold text-[#5C4738]">Delivery Date *
                <DateInput max={todayDate} required value={deliveryConfirmationForm.delivery_date} onChange={(value) => setDeliveryConfirmationForm((current) => ({ ...current, delivery_date: value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
              </label>
              <label className="text-sm font-semibold text-[#5C4738]">Delivery Time *
                <input type="time" required value={deliveryConfirmationForm.delivery_time} onChange={(event) => setDeliveryConfirmationForm((current) => ({ ...current, delivery_time: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
              </label>
              <label className="text-sm font-semibold text-[#5C4738]">Received By (Customer) *
                <input required value={deliveryConfirmationForm.delivered_to_name} onChange={(event) => setDeliveryConfirmationForm((current) => ({ ...current, delivered_to_name: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" placeholder="Customer representative name" />
              </label>
              <label className="text-sm font-semibold text-[#5C4738]">Receiver Mobile
                <input value={deliveryConfirmationForm.delivered_to_mobile} onChange={(event) => setDeliveryConfirmationForm((current) => ({ ...current, delivered_to_mobile: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" placeholder="Contact number" />
              </label>
              <label className="text-sm font-semibold text-[#5C4738] md:col-span-2">Proof of Delivery
                <input type="file" accept="image/*,.pdf" onChange={(event) => setDeliveryConfirmationForm((current) => ({ ...current, proof_file: event.target.files?.[0] || null }))} className="mt-1 block w-full rounded-md border border-[#D9C9AD] bg-[#FFFDF7] px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs font-normal text-[#7A6756]">Optional signed challan, POD document, or delivery photograph.</span>
              </label>
              <label className="text-sm font-semibold text-[#5C4738] md:col-span-2">Delivery Notes
                <textarea rows={3} value={deliveryConfirmationForm.notes} onChange={(event) => setDeliveryConfirmationForm((current) => ({ ...current, notes: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" placeholder="Condition, acknowledgement, shortages, or customer remarks" />
              </label>
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4">
              <button type="button" onClick={() => setDeliveryConfirmation(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Cancel</button>
              <button type="submit" disabled={deliveryProofUploading} className="rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{deliveryProofUploading ? 'Confirming...' : 'Confirm Delivery'}</button>
            </div>
          </form>
        </div>
      )}

      {collectionInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={handleCollectionFollowUp} className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Accounts Receivable</div><h3 className="text-xl font-bold text-[#3F2D20]">Collection Follow-up</h3><p className="text-sm text-[#7A6756]">{collectionInvoice.invoice_number} · {formatSalesAmount(collectionInvoice.balance_amount)} outstanding · {collectionInvoice.ageing_bucket || 'CURRENT'}</p></div><button type="button" onClick={() => setCollectionInvoice(null)} className="text-2xl" aria-label="Close collection follow-up">&times;</button></div>
            <div className="grid gap-4 p-6 md:grid-cols-2">
              <label className="text-sm font-semibold">Collection Status *<select required value={collectionForm.collection_status} onChange={(e) => setCollectionForm({ ...collectionForm, collection_status: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2"><option value="CONTACTED">Contacted</option><option value="PROMISED">Promise to Pay</option><option value="DISPUTED">Disputed</option><option value="ESCALATED">Escalated</option><option value="NOT_STARTED">Not Started</option></select></label>
              <label className="text-sm font-semibold">Next Follow-up<DateInput value={collectionForm.next_follow_up_date} onChange={(value) => setCollectionForm({ ...collectionForm, next_follow_up_date: value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" /></label>
              {collectionForm.collection_status === 'PROMISED' && <label className="text-sm font-semibold">Promise-to-pay Date *<DateInput required value={collectionForm.promise_to_pay_date} onChange={(value) => setCollectionForm({ ...collectionForm, promise_to_pay_date: value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" /></label>}
              <label className="block text-sm font-semibold md:col-span-2">Follow-up Notes *<textarea required rows={3} value={collectionForm.notes} onChange={(e) => setCollectionForm({ ...collectionForm, notes: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" placeholder="Contact, discussion, commitment, dispute, or escalation details" /></label>
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4"><button type="button" onClick={() => setCollectionInvoice(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold">Cancel</button><button type="submit" className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white">Save Follow-up</button></div>
          </form>
        </div>
      )}

      {receiptInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase text-[#8B6F47]">Accounts Receivable</div>
                <h3 className="text-xl font-bold text-[#3F2D20]">Record Customer Receipt</h3>
                <p className="text-sm text-[#7A6756]">{receiptInvoice.invoice_number} · Outstanding {formatSalesAmount(receiptInvoice.balance_amount)}</p>
              </div>
              <button type="button" onClick={() => setReceiptInvoice(null)} className="text-2xl text-[#6F4E37]" aria-label="Close receipt">&times;</button>
            </div>
            <form onSubmit={handleRecordReceipt} className="space-y-4 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-[#5C4738]">Amount *
                  <input type="number" min="0.01" step="0.01" required value={receiptForm.amount} onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
                </label>
                <label className="text-sm font-semibold text-[#5C4738]">Receipt Date *
                  <DateInput max={todayDate} required value={receiptForm.receipt_date} onChange={(value) => setReceiptForm({ ...receiptForm, receipt_date: value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" />
                </label>
                <label className="text-sm font-semibold text-[#5C4738]">Payment Method *
                  <select value={receiptForm.payment_method} onChange={(e) => setReceiptForm({ ...receiptForm, payment_method: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2">
                    <option value="NEFT">NEFT / RTGS</option><option value="UPI">UPI</option><option value="CHEQUE">Cheque</option><option value="CASH">Cash</option><option value="CARD">Card</option>
                  </select>
                </label>
                <label className="text-sm font-semibold text-[#5C4738]">Reference
                  <input required={receiptForm.payment_method !== 'CASH'} value={receiptForm.payment_reference} onChange={(e) => setReceiptForm({ ...receiptForm, payment_reference: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" placeholder={receiptForm.payment_method === 'CASH' ? 'Optional cash receipt reference' : 'Required UTR / cheque / transaction no.'} />
                </label>
              </div>
              <label className="block text-sm font-semibold text-[#5C4738]">Notes
                <textarea value={receiptForm.notes} onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" rows={2} />
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setReceiptInvoice(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Cancel</button>
                <button type="submit" className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white hover:bg-[#745A37]">Post Receipt</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {creditInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Accounts Receivable</div><h3 className="text-xl font-bold text-[#3F2D20]">Create Sales Credit Note</h3><p className="text-sm text-[#7A6756]">{creditInvoice.invoice_number} · Available to credit {formatSalesAmount(creditInvoice.balance_amount)}</p></div>
              <button type="button" onClick={() => setCreditInvoice(null)} className="text-2xl text-[#6F4E37]" aria-label="Close credit note">&times;</button>
            </div>
            <form onSubmit={handleCreateCreditNote} className="space-y-4 p-6">
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This reduces only the customer receivable. Returned goods require a separate return receipt and QC approval before stock can increase.</p>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-[#5C4738]">Taxable Amount *<input type="number" min="0.01" step="0.01" required value={creditNoteForm.taxable_amount} onChange={(e) => setCreditNoteForm({ ...creditNoteForm, taxable_amount: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">{regionalProfile.taxLabel} %<input type="number" min="0" step="0.01" value={creditNoteForm.tax_percentage} onChange={(e) => setCreditNoteForm({ ...creditNoteForm, tax_percentage: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">Credit Note Date *<DateInput max={todayDate} required value={creditNoteForm.credit_note_date} onChange={(value) => setCreditNoteForm({ ...creditNoteForm, credit_note_date: value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">External Reference<input value={creditNoteForm.external_reference} onChange={(e) => setCreditNoteForm({ ...creditNoteForm, external_reference: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" placeholder="Customer return / approval reference" /></label>
              </div>
              <label className="block text-sm font-semibold text-[#5C4738]">Reason *<textarea required value={creditNoteForm.reason} onChange={(e) => setCreditNoteForm({ ...creditNoteForm, reason: e.target.value })} className="mt-1 w-full rounded-md border border-[#D9C9AD] px-3 py-2" rows={2} /></label>
              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setCreditInvoice(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Cancel</button><button type="submit" className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white hover:bg-[#745A37]">Post Credit Note</button></div>
            </form>
          </div>
        </div>
      )}

      {returnInvoice && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"><div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Sales Return</div><h3 className="text-xl font-bold text-[#3F2D20]">Create Return Request</h3><p className="text-sm text-[#7A6756]">{returnInvoice.invoice_number} · Stock is updated only after receipt and QC.</p></div><button type="button" onClick={() => setReturnInvoice(null)} className="text-2xl">&times;</button></div><form onSubmit={handleCreateSalesReturn} className="overflow-auto p-6"><label className="block text-sm font-semibold">Reason *<textarea required value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="mt-1 w-full rounded border border-[#D9C9AD] p-2" /></label><div className="mt-4 overflow-x-auto"><table className="min-w-full"><thead className={registerHeadClass}><tr><th className={registerHeaderCellClass}>Invoice Item</th><th className={`${registerHeaderCellClass} text-right`}>Invoiced</th><th className={`${registerHeaderCellClass} text-right`}>Return Qty</th></tr></thead><tbody>{(returnInvoice.items || []).map((line: any) => <tr key={line.id} className="border-t"><td className={registerCellClass}>{line.item_description || line.item_id}</td><td className={`${registerCellClass} text-right`}>{line.quantity}</td><td className={`${registerCellClass} text-right`}><input type="number" min="0" max={line.quantity} step="0.001" value={returnLines[line.id] || ''} onChange={(e) => setReturnLines({ ...returnLines, [line.id]: e.target.value })} className="w-28 rounded border border-[#D9C9AD] p-2" /></td></tr>)}</tbody></table></div><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setReturnInvoice(null)} className="rounded border px-4 py-2">Cancel</button><button type="submit" className="rounded bg-[#8B6F47] px-4 py-2 font-semibold text-white">Create Return</button></div></form></div></div>}
      {receivingReturn && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"><form onSubmit={receiveSalesReturn} className="w-full max-w-lg rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Sales Return Receipt</div><h3 className="text-xl font-bold">{receivingReturn.return_number}</h3></div><button type="button" onClick={() => setReceivingReturn(null)} className="text-2xl">&times;</button></div><div className="space-y-4 p-6"><p className="text-sm text-[#6F4E37]">Receive the returned material into a holding/quarantine warehouse. Sellable stock is not increased until QC inspection is completed.</p><label className="block text-sm font-semibold">Receiving Warehouse *<select required value={returnWarehouseId} onChange={(event) => setReturnWarehouseId(event.target.value)} className="mt-1 w-full rounded border border-[#D9C9AD] p-2"><option value="">Select warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code ? `${warehouse.code} - ` : ''}{warehouse.name}</option>)}</select></label></div><div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4"><button type="button" onClick={() => setReceivingReturn(null)} className="rounded border px-4 py-2">Cancel</button><button type="submit" className="rounded bg-[#8B6F47] px-4 py-2 font-semibold text-white">Receive & Queue QC</button></div></form></div>}
      {qcReturn && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"><form onSubmit={completeSalesReturnQc} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Sales Return</div><h3 className="text-xl font-bold">QC Inspection · {qcReturn.return_number}</h3></div><button type="button" onClick={() => setQcReturn(null)} className="text-2xl">&times;</button></div><div className="overflow-auto p-6"><p className="mb-4 text-sm text-[#6F4E37]">Only the accepted quantities below will be returned to stock. The rejected balance remains excluded from sellable stock.</p><table className="min-w-full"><thead className={registerHeadClass}><tr><th className={registerHeaderCellClass}>Item</th><th className={`${registerHeaderCellClass} text-right`}>Received</th><th className={`${registerHeaderCellClass} text-right`}>QC Accepted</th></tr></thead><tbody>{(qcReturn.items || []).map((line) => <tr key={line.id} className="border-t"><td className={registerCellClass}>{line.item_description || '-'}</td><td className={`${registerCellClass} text-right`}>{line.quantity}</td><td className={`${registerCellClass} text-right`}><input type="number" min="0" max={line.quantity} step="0.001" value={returnQcLines[line.id] || ''} onChange={(event) => setReturnQcLines({ ...returnQcLines, [line.id]: event.target.value })} className="w-28 rounded border border-[#D9C9AD] p-2" /></td></tr>)}</tbody></table><label className="mt-4 block text-sm font-semibold">QC Notes<textarea value={returnQcNotes} onChange={(event) => setReturnQcNotes(event.target.value)} className="mt-1 w-full rounded border border-[#D9C9AD] p-2" rows={3} /></label></div><div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4"><button type="button" onClick={() => setQcReturn(null)} className="rounded border px-4 py-2">Cancel</button><button type="submit" className="rounded bg-[#0f7a4f] px-4 py-2 font-semibold text-white">Post QC Inspection</button></div></form></div>}

      {/* Direct Sales Order Form Modal - Global Scope */}
      {showDirectSOForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Create Direct Sales Order</h3>
              <button
                onClick={() => setShowDirectSOForm(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateDirectSO} className="space-y-4">
              {/* Customer and Basic Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
                  <SearchableSelect
                    options={customers.map(c => ({ label: `${c.customer_code} - ${c.customer_name}`, value: c.id }))}
                    value={directSOForm.customer_id}
                    onChange={(value) => setDirectSOForm({ ...directSOForm, customer_id: value })}
                    placeholder="Select customer..."
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Source Type *</label>
                  <select
                    value={directSOForm.source_type}
                    onChange={(e) => setDirectSOForm({ ...directSOForm, source_type: e.target.value as 'DIRECT' | 'INTERNAL' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    required
                  >
                    <option value="DIRECT">Direct Customer Order</option>
                    <option value="INTERNAL">Internal Stock</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Order Date *</label>
                  <DateInput
                    max={todayDate}
                    value={directSOForm.order_date}
                    onChange={(value) => setDirectSOForm({ ...directSOForm, order_date: value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery Date</label>
                  <DateInput
                    min={todayDate}
                    value={directSOForm.expected_delivery_date}
                    onChange={(value) => setDirectSOForm({ ...directSOForm, expected_delivery_date: value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                  <input
                    type="text"
                    value={directSOForm.project}
                    onChange={(e) => setDirectSOForm({ ...directSOForm, project: e.target.value })}
                    placeholder="e.g., Project Alpha, Phase 1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                <input
                  type="text"
                  value={directSOForm.payment_terms}
                  onChange={(e) => setDirectSOForm({ ...directSOForm, payment_terms: e.target.value })}
                  placeholder="e.g., 30 days, Net 45, etc."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div className="rounded-md border border-[#E8DCC4] bg-[#FCFAF6] p-4">
                <div className="mb-3 text-sm font-semibold text-[#3F2D20]">Customer reference & commercial controls</div>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="text-sm font-medium text-gray-700">Customer PO Number
                    <input value={directSOForm.customer_po_number} onChange={(e) => setDirectSOForm({ ...directSOForm, customer_po_number: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-sm font-medium text-gray-700">Customer PO Date
                    <DateInput max={todayDate} value={directSOForm.customer_po_date} onChange={(value) => setDirectSOForm({ ...directSOForm, customer_po_date: value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-sm font-medium text-gray-700">Currency
                    <select value={directSOForm.currency_code} onChange={(e) => setDirectSOForm({ ...directSOForm, currency_code: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="INR">INR</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="AED">AED</option></select>
                  </label>
                  <label className="text-sm font-medium text-gray-700 md:col-span-2">Place of Supply
                    <input value={directSOForm.place_of_supply} onChange={(e) => setDirectSOForm({ ...directSOForm, place_of_supply: e.target.value })} placeholder={regionalProfile.marketProfile === 'UAE' ? 'Emirate / place of supply' : 'State / territory for GST'} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-sm font-medium text-gray-700">Incoterm
                    <input value={directSOForm.incoterm} onChange={(e) => setDirectSOForm({ ...directSOForm, incoterm: e.target.value.toUpperCase() })} placeholder="EXW / FOB / CIF" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                </div>
              </div>

              {/* Items Section */}
              <div className="border rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-semibold">Order Items *</h4>
                  <button
                    type="button"
                    onClick={() => {
                      setDirectSOForm({
                        ...directSOForm,
                        items: [...directSOForm.items, {
                          item_id: '',
                          item_description: '',
                          quantity: 1,
                          unit_price: 0,
                          discount_percentage: 0,
                          tax_percentage: 18,
                        }]
                      });
                    }}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    + Add Item
                  </button>
                </div>
                
                {directSOForm.items.length === 0 ? (
                  <p className="text-gray-500 text-sm">No items added. Click &ldquo;+ Add Item&rdquo; to start.</p>
                ) : (
                  <div className="space-y-3">
                    {directSOForm.items.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 items-start border-b pb-3">
                        <div className="col-span-3">
                          <label className="block text-xs text-gray-600 mb-1">Item *</label>
                          <SearchableSelect
                            options={items.map(i => ({ 
                              label: `${i.code} - ${i.name || i.description || i.item_name}`, 
                              value: i.id 
                            }))}
                            value={item.item_id || ''}
                            onChange={(value) => {
                              const selectedItem = items.find(i => i.id === value);
                              const newItems = [...directSOForm.items];
                              newItems[index] = {
                                ...newItems[index],
                                item_id: value,
                                item_description: selectedItem?.name || selectedItem?.description || selectedItem?.item_name || '',
                                unit_price: selectedItem?.selling_price || selectedItem?.standard_cost || 0,
                                ordered_uom: selectedItem?.uom || 'PCS',
                                price_uom: selectedItem?.uom || 'PCS',
                              };
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            placeholder="Search & select item..."
                            required
                          />
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs text-gray-600 mb-1">UOM *</label>
                          <select
                            value={item.ordered_uom || items.find(i => i.id === item.item_id)?.uom || 'PCS'}
                            onChange={(e) => {
                              const newItems = [...directSOForm.items];
                              newItems[index].ordered_uom = e.target.value;
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          >
                            {(() => {
                              const selected = items.find(i => i.id === item.item_id);
                              return [...new Set([selected?.uom || 'PCS', selected?.sales_uom].filter(Boolean))].map((uom: any) => (
                                <option key={uom} value={uom}>{uom}</option>
                              ));
                            })()}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-600 mb-1">Quantity *</label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => {
                              const newItems = [...directSOForm.items];
                              newItems[index].quantity = parseFloat(e.target.value) || 1;
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            required
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-600 mb-1">Unit Price ({regionalProfile.currency}) *</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) => {
                              const newItems = [...directSOForm.items];
                              newItems[index].unit_price = parseFloat(e.target.value) || 0;
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            required
                          />
                          <select
                            aria-label="Price per unit"
                            value={item.price_uom || items.find(i => i.id === item.item_id)?.uom || 'PCS'}
                            onChange={(e) => {
                              const newItems = [...directSOForm.items];
                              newItems[index].price_uom = e.target.value;
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            className="mt-1 w-full rounded border border-gray-300 bg-amber-50 px-2 py-1 text-xs"
                          >
                            {(() => {
                              const selected = items.find(i => i.id === item.item_id);
                              return [...new Set([selected?.uom || 'PCS', selected?.sales_uom].filter(Boolean))].map((uom: any) => (
                                <option key={uom} value={uom}>per {uom}</option>
                              ));
                            })()}
                          </select>
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs text-gray-600 mb-1">Disc %</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={item.discount_percentage}
                            onChange={(e) => {
                              const newItems = [...directSOForm.items];
                              newItems[index].discount_percentage = parseFloat(e.target.value) || 0;
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs text-gray-600 mb-1">Tax %</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={item.tax_percentage}
                            onChange={(e) => {
                              const newItems = [...directSOForm.items];
                              newItems[index].tax_percentage = parseFloat(e.target.value) || 0;
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                        </div>
                        <div className="col-span-2 flex items-end justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const newItems = directSOForm.items.filter((_, i) => i !== index);
                              setDirectSOForm({ ...directSOForm, items: newItems });
                            }}
                            className="px-2 py-1 bg-red-50 text-red-600 text-xs rounded hover:bg-red-100"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDirectSOForm(false);
                    setDirectSOForm({
                      customer_id: '',
                      order_date: getTodayDateInputValue(),
                      expected_delivery_date: '',
                      payment_terms: '',
                      project: '',
                      source_type: 'DIRECT',
                      customer_po_number: '',
                      customer_po_date: '',
                      currency_code: regionalProfile.currency,
                      place_of_supply: '',
                      incoterm: '',
                      items: [],
                    });
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create Sales Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {statementCustomer && (
        <div className="fixed inset-0 z-[70] bg-white text-[#2F241D]">
          <div className="flex h-full flex-col bg-[#FAF9F6]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E8DCC4] bg-white px-6 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Accounts Receivable</div>
                <h3 className="text-2xl font-bold">Customer Account Statement</h3>
                <p className="text-sm text-[#6F4E37]">{statementCustomer.customer_code} · {statementCustomer.customer_name}</p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && accountStatement?.open_invoices.some(invoice => invoice.days_overdue > 0) && (
                  <button type="button" onClick={() => setShowDunningForm(value => !value)} className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
                    <Mail size={16} /> {showDunningForm ? 'Hide Reminder' : 'Issue Reminder'}
                  </button>
                )}
                <button type="button" onClick={() => void downloadCustomerStatementPdf()} disabled={!accountStatement || statementLoading} className="inline-flex items-center gap-2 rounded-md border border-[#D9C9AD] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40"><Download size={16} /> Download PDF</button>
                {canEdit && <button type="button" onClick={() => void emailCustomerStatementPdf()} disabled={!accountStatement || statementLoading} className="inline-flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-40"><Mail size={16} /> Email Statement</button>}
                <button type="button" onClick={() => { setStatementCustomer(null); setAccountStatement(null); setShowDunningForm(false); }} className="rounded-md border border-[#D9C9AD] bg-white px-4 py-2 text-sm font-semibold">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <div className="mb-4 grid gap-3 rounded-md border border-[#E8DCC4] bg-white p-4 md:grid-cols-[1fr_1fr_auto]">
                <label className="text-sm font-semibold">From<DateInput value={statementPeriod.from} onChange={(value) => setStatementPeriod(current => ({ ...current, from: value }))} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="text-sm font-semibold">To<DateInput value={statementPeriod.to} onChange={(value) => setStatementPeriod(current => ({ ...current, to: value }))} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <button type="button" onClick={() => loadCustomerStatement(statementCustomer)} disabled={statementLoading || !statementPeriod.from || !statementPeriod.to} className="self-end rounded-md bg-[#8B6F47] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{statementLoading ? 'Loading...' : 'Run Statement'}</button>
              </div>
              {statementLoading && !accountStatement ? (
                <div className="rounded-md border border-[#E8DCC4] bg-white p-10 text-center text-[#7A6756]">Preparing consolidated sales and service ledger...</div>
              ) : accountStatement ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {[
                      ['Opening Balance', accountStatement.opening_balance],
                      ['Period Debit', accountStatement.total_debit],
                      ['Period Credit', accountStatement.total_credit],
                      ['Closing Balance', accountStatement.closing_balance],
                      ['Current Outstanding', accountStatement.current_outstanding],
                    ].map(([label, value]) => <div key={String(label)} className="rounded-md border border-[#E8DCC4] bg-white p-4"><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className="mt-1 text-xl font-bold">{formatSalesAmount(Number(value))}</div></div>)}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {accountStatement.ageing.map(item => <div key={item.bucket} className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-3"><div className="text-xs font-bold uppercase text-[#7A6756]">{item.bucket === 'CURRENT' ? 'Current' : `${item.bucket} days`}</div><div className="mt-1 font-bold">{formatSalesAmount(item.amount)}</div></div>)}
                  </div>
                  {showDunningForm && (
                    <form onSubmit={issueDunningNotice} className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 md:grid-cols-[180px_220px_1fr_auto]">
                      <label className="text-sm font-semibold text-amber-950">Escalation level
                        <select value={dunningForm.dunning_level} onChange={event => setDunningForm(current => ({ ...current, dunning_level: event.target.value }))} className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2">
                          <option value="1">Level 1 - Reminder</option>
                          <option value="2">Level 2 - Urgent</option>
                          <option value="3">Level 3 - Final notice</option>
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-amber-950">Payment due by
                        <DateInput value={dunningForm.due_by} onChange={value => setDunningForm(current => ({ ...current, due_by: value }))} className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2" />
                      </label>
                      <label className="text-sm font-semibold text-amber-950">Remarks
                        <input value={dunningForm.notes} onChange={event => setDunningForm(current => ({ ...current, notes: event.target.value }))} placeholder="Optional collection instructions" className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2" />
                      </label>
                      <div className="flex items-end gap-2">
                        <button type="button" onClick={() => setShowDunningForm(false)} className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900">Cancel</button>
                        <button type="submit" disabled={statementLoading || !dunningForm.due_by} className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Issue</button>
                      </div>
                    </form>
                  )}
                  <div className="overflow-x-auto rounded-md border border-[#E8DCC4] bg-white">
                    <div className="flex items-center justify-between border-b border-[#E8DCC4] px-4 py-3">
                      <div><h4 className="font-bold">Payment reminder history</h4><p className="text-xs text-[#7A6756]">Auditable dunning notices issued against overdue receivables.</p></div>
                      <span className="rounded-full bg-[#F6EFE2] px-3 py-1 text-xs font-semibold">{accountStatement.dunning_notices.length} notices</span>
                    </div>
                    <table className="min-w-[900px] divide-y divide-[#E8DCC4]">
                      <thead className="bg-[#F6EFE2]"><tr>{['Notice', 'Date', 'Level', 'Due By', 'Overdue Snapshot', 'Status', 'Remarks', 'Action'].map(header => <th key={header} className={`px-4 py-3 text-xs font-bold uppercase text-[#5C4738] ${header === 'Overdue Snapshot' ? 'text-right' : 'text-left'}`}>{header}</th>)}</tr></thead>
                      <tbody className="divide-y divide-[#EFE5D2]">
                        {accountStatement.dunning_notices.length ? accountStatement.dunning_notices.map(notice => <tr key={notice.id}>
                          <td className="px-4 py-3 text-sm font-semibold">{notice.notice_number}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm">{new Date(`${notice.notice_date}T00:00:00`).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-3 text-sm">Level {notice.dunning_level}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm">{new Date(`${notice.due_by}T00:00:00`).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-3 text-right text-sm font-semibold">{formatSalesAmount(notice.overdue_amount)}</td>
                          <td className="px-4 py-3 text-sm"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${notice.status === 'ISSUED' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{notice.status}</span></td>
                          <td className="max-w-[260px] px-4 py-3 text-sm text-[#6F4E37]">{notice.cancellation_reason || notice.notes || '-'}</td>
                          <td className="px-4 py-3 text-sm"><div className="flex items-center gap-2"><button type="button" disabled={dunningDetailLoading} onClick={() => void openDunningNotice(notice.id)} className="rounded border border-[#D9C9AD] px-3 py-1 text-xs font-semibold text-[#6F4E37] disabled:opacity-50">View</button>{canEdit && notice.status === 'ISSUED' ? <button type="button" onClick={() => void cancelDunningNotice(notice)} className="rounded border border-red-200 px-3 py-1 text-xs font-semibold text-red-700">Cancel</button> : null}</div></td>
                        </tr>) : <tr><td colSpan={8} className="p-6 text-center text-sm text-[#7A6756]">No payment reminders issued.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-[#E8DCC4] bg-white">
                    <table className="min-w-[1100px] divide-y divide-[#E8DCC4]">
                      <thead className="bg-[#F6EFE2]"><tr>{['Date', 'Source', 'Document', 'Number', 'Reference / Remarks', 'Debit', 'Credit', 'Balance'].map(header => <th key={header} className={`px-4 py-3 text-xs font-bold uppercase text-[#5C4738] ${['Debit', 'Credit', 'Balance'].includes(header) ? 'text-right' : 'text-left'}`}>{header}</th>)}</tr></thead>
                      <tbody className="divide-y divide-[#EFE5D2]">
                        {accountStatement.transactions.length ? accountStatement.transactions.map((row, index) => <tr key={`${row.document_number}-${index}`}><td className="whitespace-nowrap px-4 py-3 text-sm">{new Date(`${row.date}T00:00:00`).toLocaleDateString('en-IN')}</td><td className="px-4 py-3 text-sm"><span className="rounded-full bg-[#F6EFE2] px-2 py-1 text-xs font-semibold">{row.source}</span></td><td className="px-4 py-3 text-sm">{row.document_type}</td><td className="whitespace-nowrap px-4 py-3 text-sm font-semibold">{row.document_number}</td><td className="max-w-[320px] px-4 py-3 text-sm text-[#6F4E37]">{row.reference || row.remarks || '-'}</td><td className="px-4 py-3 text-right text-sm">{row.debit ? formatSalesAmount(row.debit) : '-'}</td><td className="px-4 py-3 text-right text-sm">{row.credit ? formatSalesAmount(row.credit) : '-'}</td><td className="px-4 py-3 text-right text-sm font-bold">{formatSalesAmount(row.balance)}</td></tr>) : <tr><td colSpan={8} className="p-10 text-center text-[#7A6756]">No customer transactions in this period.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {viewingDunningNotice && (
        <div className="fixed inset-0 z-[80] bg-black/45 p-3 sm:p-6">
          <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[#D9C9AD] bg-[#FAF9F6] shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E8DCC4] bg-white px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Accounts Receivable</div>
                <h3 className="text-2xl font-bold text-[#2F241D]">{viewingDunningNotice.dunning_level === 3 ? 'Final Payment Notice' : viewingDunningNotice.dunning_level === 2 ? 'Urgent Payment Reminder' : 'Payment Reminder'}</h3>
                <p className="text-sm text-[#6F4E37]">{viewingDunningNotice.notice_number} · Historical invoice snapshot</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void downloadDunningNoticePdf(viewingDunningNotice)} className="inline-flex items-center gap-2 rounded-md border border-[#8B6F47] bg-white px-4 py-2 text-sm font-semibold text-[#6F4E37]"><Printer size={16} /> Download PDF</button>
                <button type="button" onClick={() => setViewingDunningNotice(null)} className="rounded-md bg-[#3F2D20] px-4 py-2 text-sm font-semibold text-white">Close</button>
              </div>
            </div>
            <div className="flex-1 space-y-4 overflow-auto p-5">
              {viewingDunningNotice.status === 'CANCELLED' && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">Cancelled: {viewingDunningNotice.cancellation_reason || 'No reason recorded'}</div>}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-[#E8DCC4] bg-white p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Customer</div><div className="mt-1 font-bold">{viewingDunningNotice.customer?.customer_name || '-'}</div><div className="text-xs text-[#7A6756]">{viewingDunningNotice.customer?.customer_code || '-'}</div></div>
                <div className="rounded-md border border-[#E8DCC4] bg-white p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Notice / Due By</div><div className="mt-1 font-bold">{new Date(`${viewingDunningNotice.notice_date}T00:00:00`).toLocaleDateString('en-IN')}</div><div className="text-xs text-[#7A6756]">Due {new Date(`${viewingDunningNotice.due_by}T00:00:00`).toLocaleDateString('en-IN')}</div></div>
                <div className="rounded-md border border-[#E8DCC4] bg-white p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Overdue Snapshot</div><div className="mt-1 text-xl font-bold text-red-700">{formatSalesAmount(viewingDunningNotice.overdue_amount)}</div></div>
                <div className="rounded-md border border-[#E8DCC4] bg-white p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Total Outstanding</div><div className="mt-1 text-xl font-bold">{formatSalesAmount(viewingDunningNotice.total_outstanding)}</div></div>
              </div>
              <div className="rounded-md border border-[#E8DCC4] bg-white p-4 text-sm"><div className="font-bold">Recipient</div><div className="mt-1 text-[#6F4E37]">{[viewingDunningNotice.customer?.contact_person, viewingDunningNotice.customer?.billing_address, viewingDunningNotice.customer?.city, viewingDunningNotice.customer?.state, viewingDunningNotice.customer?.pincode, viewingDunningNotice.customer?.country].filter(Boolean).join(', ') || '-'}</div>{viewingDunningNotice.customer?.email && <div className="mt-1 text-[#6F4E37]">{viewingDunningNotice.customer.email}</div>}</div>
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4] bg-white">
                <table className="min-w-[980px] divide-y divide-[#E8DCC4]">
                  <thead className="bg-[#F6EFE2]"><tr>{['No.', 'Source', 'Invoice', 'Invoice Date', 'Due Date', 'Days Overdue', 'Balance'].map(header => <th key={header} className={`px-4 py-3 text-xs font-bold uppercase text-[#5C4738] ${['Days Overdue', 'Balance'].includes(header) ? 'text-right' : 'text-left'}`}>{header}</th>)}</tr></thead>
                  <tbody className="divide-y divide-[#EFE5D2]">{(viewingDunningNotice.invoice_snapshot || []).map((invoice, index) => <tr key={`${invoice.source}-${invoice.invoice_id}`}><td className="px-4 py-3 text-sm">{index + 1}</td><td className="px-4 py-3 text-sm"><span className="rounded-full bg-[#F6EFE2] px-2 py-1 text-xs font-semibold">{invoice.source}</span></td><td className="px-4 py-3 text-sm font-semibold">{invoice.invoice_number}</td><td className="px-4 py-3 text-sm">{new Date(`${invoice.invoice_date}T00:00:00`).toLocaleDateString('en-IN')}</td><td className="px-4 py-3 text-sm">{invoice.due_date ? new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString('en-IN') : '-'}</td><td className="px-4 py-3 text-right text-sm font-semibold text-red-700">{invoice.days_overdue}</td><td className="px-4 py-3 text-right text-sm font-bold">{formatSalesAmount(invoice.balance_amount)}</td></tr>)}{!viewingDunningNotice.invoice_snapshot?.length && <tr><td colSpan={7} className="p-8 text-center text-sm text-[#7A6756]">No invoice snapshot was stored with this reminder.</td></tr>}</tbody>
                </table>
              </div>
              {viewingDunningNotice.notes && <div className="rounded-md border border-[#E8DCC4] bg-white p-4 text-sm"><div className="font-bold">Remarks</div><div className="mt-1 text-[#6F4E37]">{viewingDunningNotice.notes}</div></div>}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default function SalesPage() {
  return <Suspense fallback={<div className="p-6">Loading Sales workspace...</div>}><SalesPageContent /></Suspense>;
}
