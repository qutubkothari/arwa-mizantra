'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../lib/api-client';
import SearchableSelect from '../../../components/SearchableSelect';
import DateInput from '../../../components/ui/DateInput';
import { getTodayDateInputValue } from '@/lib/date';
import { hasModulePermission, readStoredUser, type StoredUser } from '@/lib/rbac';
import { buildDocumentBranding, renderStandardLetterheadHtml } from '@/lib/document-branding';
import { useRegionalProfile } from '../../../hooks/useRegionalProfile';
import { formatRegionalCurrency } from '@/lib/market-profile';

type TabType = 'tickets' | 'dispatch' | 'installed-base' | 'contracts' | 'maintenance' | 'checklists' | 'technicians' | 'controls' | 'billing' | 'warranty-check' | 'reports';

interface ServiceTicket {
  id: string;
  ticket_number: string;
  customer: { customer_name: string; contact_person?: string; mobile?: string; phone?: string; email?: string };
  uid?: string;
  ship_name?: string;
  location?: string;
  service_type: string;
  priority: string;
  status: string;
  complaint_date: string;
  complaint_description: string;
  reported_by?: string;
  contact_number?: string;
  email?: string;
  product_name?: string;
  model_number?: string;
  serial_number?: string;
  service_location?: string;
  expected_completion_date?: string;
  is_under_warranty: boolean;
  entitlement_status?: string;
  warranty_valid_until?: string;
  billing_status?: string;
  actual_completion_date?: string;
  estimated_cost: number;
  commercial_approval_required?: boolean;
  commercial_approval_status?: string;
  approved_estimate_id?: string;
  actual_cost: number;
  attachments?: string[];
  created_at: string;
  response_due_at?: string;
  resolution_due_at?: string;
  response_acknowledged_at?: string;
  resolved_at?: string;
  sla?: {
    response_status: string;
    resolution_status: string;
    overall_status: string;
    response_remaining_minutes: number | null;
    resolution_remaining_minutes: number | null;
  };
  feedback?: ServiceFeedback | null;
  assignments?: ServiceAssignment[];
  site_visits?: ServiceSiteVisit[];
  checklist?: ServiceTicketChecklistItem[];
}

interface ServiceTicketChecklistItem {
  id: string; item_text: string; is_required: boolean; sort_order: number;
  status: 'PENDING' | 'COMPLETED' | 'NOT_APPLICABLE'; remarks?: string;
  completed_at?: string; completed_by?: string;
}

interface ServiceChecklistTemplate {
  id: string; template_name: string; service_type?: string; description?: string; is_active: boolean;
  items: Array<{ id?: string; item_text: string; is_required: boolean; sort_order?: number }>;
}

interface ServiceAssignment {
  id: string;
  status: string;
  scheduled_start_date?: string;
  technician?: { id: string; technician_code?: string; technician_name: string; contact_number?: string };
}

interface ServiceSiteVisit {
  id: string;
  service_assignment_id?: string;
  visit_number: number;
  status: 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
  purpose?: string;
  site_contact_name: string;
  site_contact_designation?: string;
  site_contact_mobile?: string;
  site_contact_email?: string;
  check_in_at: string;
  check_in_lat?: number;
  check_in_lng?: number;
  check_in_location?: string;
  check_out_at?: string;
  check_out_lat?: number;
  check_out_lng?: number;
  check_out_location?: string;
  work_notes?: string;
  customer_acknowledgement_name?: string;
  customer_acknowledged_at?: string;
  before_attachments?: string[];
  after_attachments?: string[];
  assignment?: ServiceAssignment;
}

interface ServiceFeedback {
  id: string;
  overall_rating: number;
  technician_rating?: number | null;
  response_time_rating?: number | null;
  quality_rating?: number | null;
  feedback_text?: string | null;
  suggestions?: string | null;
  would_recommend?: boolean | null;
  created_at: string;
}

interface ServiceEstimate {
  id: string; estimate_number: string; revision_no: number; status: string; estimate_date: string;
  valid_until?: string; subtotal: number; discount_amount: number; tax_percentage: number;
  tax_amount: number; total_amount: number; terms_and_conditions?: string; customer_comments?: string;
  approval_reference?: string; approval_attachment_url?: string; items?: Array<{ id?: string; description: string; quantity: number; uom: string; unit_price: number; discount_percent: number; line_total?: number }>;
  engagements?: Array<{ id: string; event_type: string; recipient?: string; notes?: string; next_follow_up_date?: string; created_at: string }>;
}

interface Technician {
  id: string;
  technician_code: string;
  employee_id?: string | null;
  technician_name: string;
  specialization?: string;
  contact_number?: string;
  email?: string;
  is_active: boolean;
  total_assignments: number;
  completed_services: number;
  average_rating: number;
  daily_capacity_hours?: number;
  skills?: string[];
  territories?: string[];
  base_location?: string;
  shift_start?: string;
  shift_end?: string;
  working_days?: number[];
}

interface TechnicianEmployee {
  id: string;
  employee_code: string;
  employee_name: string;
  designation?: string;
  department?: string;
  contact_number?: string;
  email?: string;
  status?: string;
}

interface ServiceFailureCode {
  id: string; code: string; category: string; description: string; default_corrective_action?: string;
  is_active: boolean;
}

interface ServiceEscalation {
  id: string; service_ticket_id: string; escalation_level: number; reason: string; owner_user_id?: string;
  due_at?: string; status: string; resolution_notes?: string; created_at: string;
  ticket?: { id: string; ticket_number: string; status: string; priority: string; customer?: { customer_name?: string } };
}

interface ServiceRmaOrder {
  id: string; rma_number: string; service_ticket_id: string; received_date?: string; received_condition?: string;
  repair_location?: string; disposition: string; status: string; outbound_date?: string; courier_reference?: string; notes?: string;
  ticket?: { ticket_number?: string; product_name?: string; serial_number?: string; uid?: string; customer?: { customer_name?: string } };
}

interface TechnicianCapacity extends Technician {
  capacity_date: string; booked_hours: number; available_hours: number; utilization_percent: number;
  is_overbooked: boolean; assignments: any[];
}

interface WarrantyValidation {
  is_valid: boolean;
  warranty: any;
  message: string;
  days_remaining?: number;
}

interface Customer {
  id: string;
  customer_code: string;
  customer_name: string;
  customer_type: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
}

interface Item {
  id: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
}

interface UIDRecord {
  uid: string;
  entity_id: string;
  status: string;
  location?: string;
  batch_number?: string;
}

interface DeploymentStatusRecord {
  uid_id: string;
  uid: string;
  client_part_number: string | null;
  job_order_id: string | null;
  item_name: string | null;
  item_code: string | null;
  current_level: string | null;
  current_organization: string | null;
  current_location: string | null;
  current_deployment_date: string | null;
  warranty_expiry_date: string | null;
}

interface Warehouse {
  id: string;
  warehouse_code: string;
  warehouse_name: string;
}

interface ServicePartStock {
  item_id: string;
  warehouse_id: string;
  available_quantity?: number;
  quantity?: number;
}

interface CustomerServiceInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  taxable_amount?: number;
  tax_amount?: number;
  net_amount: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  billing_status?: string;
  payments?: any[];
  customer?: { customer_code?: string; customer_name?: string; contact_person?: string; email?: string };
  ticket?: { ticket_number?: string; service_type?: string };
  confirmation?: any;
  service_parts?: any[];
  due_date?: string;
  days_overdue?: number;
  ageing_bucket?: string;
  collection_status?: string;
  next_follow_up_date?: string;
  promise_to_pay_date?: string;
  collection_notes?: string;
}

interface InstalledAsset {
  id: string; asset_number: string; customer_id: string; item_id?: string; uid?: string; serial_number?: string;
  asset_name: string; installation_date?: string; warranty_until?: string; location?: string; status: string; notes?: string;
  customer?: { customer_code?: string; customer_name?: string }; item?: { code?: string; name?: string };
}

interface ServiceContract {
  id: string; contract_number: string; customer_id: string; contract_type: string; start_date: string; end_date: string;
  status: string; effective_status?: string; response_hours: number; resolution_hours: number; included_visits?: number;
  included_labor_hours?: number; contract_value: number; tax_percentage: number; notes?: string;
  customer?: { customer_code?: string; customer_name?: string };
  contract_assets?: Array<{ asset_id: string; asset?: InstalledAsset }>;
  renewed_from_contract_id?: string; renewal_sequence?: number;
  entitlement_usage?: { visits_used: number; visits_remaining: number | null; labor_hours_used: number; labor_hours_remaining: number | null };
}

interface MaintenanceSchedule {
  id: string; customer_id: string; uid: string; installed_asset_id?: string; schedule_name: string;
  frequency_days: number; last_service_date?: string; next_service_date: string; service_checklist?: string;
  is_active: boolean; notify_before_days: number; maintenance_status: string;
  customer?: { customer_code?: string; customer_name?: string }; installed_asset?: InstalledAsset;
  last_ticket?: { id: string; ticket_number: string; status: string };
}

function getAttachmentKind(url: string): 'image' | 'video' | 'other' {
  const normalized = (url || '').split('?')[0].toLowerCase();
  if (normalized.match(/\.(mp4|mov|webm|mkv|avi|m4v)$/)) return 'video';
  if (normalized.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/)) return 'image';
  // Fallback: if backend returns clean /uploads/... without extension
  if (normalized.includes('/uploads/') && normalized.includes('/service/')) return 'image';
  return 'other';
}

function addCalendarDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const ticketStatusTransitions: Record<string, string[]> = {
  OPEN: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'OPEN', 'CANCELLED'],
  IN_PROGRESS: ['PARTS_PENDING', 'CANCELLED'],
  PARTS_PENDING: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

function ServicePageContent() {
  const searchParams = useSearchParams();
  const { profile: regionalProfile, loading: regionalProfileLoading } = useRegionalProfile();
  const serviceAmount = (value: number | null | undefined) => formatRegionalCurrency(value, regionalProfile);
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const canCreate = hasModulePermission(currentUser, 'Service Management', 'create');
  const canEdit = hasModulePermission(currentUser, 'Service Management', 'edit');
  const canDelete = hasModulePermission(currentUser, 'Service Management', 'delete');
  const todayDate = getTodayDateInputValue();
  const [activeTab, setActiveTab] = useState<TabType>('tickets');
  useEffect(() => {
    const requested = searchParams.get('tab') as TabType | null;
    const allowed: TabType[] = ['tickets', 'dispatch', 'installed-base', 'contracts', 'maintenance', 'checklists', 'technicians', 'controls', 'billing', 'warranty-check', 'reports'];
    if (requested && allowed.includes(requested)) setActiveTab(requested);
  }, [searchParams]);
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [installedAssets, setInstalledAssets] = useState<InstalledAsset[]>([]);
  const [serviceContracts, setServiceContracts] = useState<ServiceContract[]>([]);
  const [maintenanceSchedules, setMaintenanceSchedules] = useState<MaintenanceSchedule[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ServiceChecklistTemplate[]>([]);
  const [failureCodes, setFailureCodes] = useState<ServiceFailureCode[]>([]);
  const [serviceEscalations, setServiceEscalations] = useState<ServiceEscalation[]>([]);
  const [rmaOrders, setRmaOrders] = useState<ServiceRmaOrder[]>([]);
  const [warrantyRecoveryClaims, setWarrantyRecoveryClaims] = useState<any[]>([]);
  const [technicianCapacity, setTechnicianCapacity] = useState<TechnicianCapacity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [registerSearch, setRegisterSearch] = useState('');
  const [registerStatus, setRegisterStatus] = useState('ALL');
  const [dispatchDate, setDispatchDate] = useState(todayDate);
  const [dispatchTechnician, setDispatchTechnician] = useState('ALL');
  const [dispatchStatus, setDispatchStatus] = useState('ACTIVE');
  const [dispatchSlaFilter, setDispatchSlaFilter] = useState('ALL');
  const [dispatchSort, setDispatchSort] = useState('schedule');
  const [dispatchSearch, setDispatchSearch] = useState('');
  const [controlSection, setControlSection] = useState<'escalations' | 'failure-codes' | 'rma' | 'warranty-recovery'>('escalations');
  const [showFailureCodeForm, setShowFailureCodeForm] = useState(false);
  const [showEscalationForm, setShowEscalationForm] = useState(false);
  const [showRmaForm, setShowRmaForm] = useState(false);
  const [failureCodeForm, setFailureCodeForm] = useState({ code: '', category: '', description: '', default_corrective_action: '', is_active: true });
  const [escalationForm, setEscalationForm] = useState({ service_ticket_id: '', escalation_level: '1', reason: '', due_at: '' });
  const [rmaForm, setRmaForm] = useState({ service_ticket_id: '', disposition: 'REPAIR', received_date: '', received_condition: '', repair_location: '', notes: '' });
  
  // Data for dropdowns
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [availableUIDs, setAvailableUIDs] = useState<UIDRecord[]>([]);
  const [shipNames, setShipNames] = useState<string[]>([]);
  const [shipNameInput, setShipNameInput] = useState('');
  const [filteredShipNames, setFilteredShipNames] = useState<string[]>([]);
  const [showShipNameDropdown, setShowShipNameDropdown] = useState(false);

  // Product/Part Number/UID lookup (searches deployed units)
  const [productLookupInput, setProductLookupInput] = useState('');
  const [productLookupResults, setProductLookupResults] = useState<DeploymentStatusRecord[]>([]);
  const [showProductLookupDropdown, setShowProductLookupDropdown] = useState(false);
  const [productLookupLoading, setProductLookupLoading] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentStatusRecord | null>(null);

  // Forms
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [showTechnicianForm, setShowTechnicianForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);
  const [showChecklistTemplateForm, setShowChecklistTemplateForm] = useState(false);
  const [editingChecklistTemplateId, setEditingChecklistTemplateId] = useState<string | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [renewingContractId, setRenewingContractId] = useState<string | null>(null);
  const [editingMaintenanceId, setEditingMaintenanceId] = useState<string | null>(null);
  const [showTicketDetails, setShowTicketDetails] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<ServiceTicket | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showEditTicketModal, setShowEditTicketModal] = useState(false);
  const [assignmentTicket, setAssignmentTicket] = useState<ServiceTicket | null>(null);
  const [visitTicket, setVisitTicket] = useState<ServiceTicket | null>(null);
  const [activeVisit, setActiveVisit] = useState<ServiceSiteVisit | null>(null);
  const [visitFiles, setVisitFiles] = useState<File[]>([]);
  const [visitSignatureFile, setVisitSignatureFile] = useState<File | null>(null);
  const [visitForm, setVisitForm] = useState({
    service_assignment_id: '', purpose: '', site_contact_name: '', site_contact_designation: '',
    site_contact_mobile: '', site_contact_email: '', location: '', work_notes: '',
    customer_acknowledgement_name: '', customer_signature_designation: '', signature_declined_reason: '', complete_assignment: false,
  });
  const [partTicket, setPartTicket] = useState<ServiceTicket | null>(null);
  const [editTicketForm, setEditTicketForm] = useState({
    priority: 'MEDIUM',
    expected_completion_date: '',
    ship_name: '',
    location: '',
    service_location: '',
    product_name: '',
    model_number: '',
    reported_by: '',
    contact_number: '',
    email: '',
    complaint_description: '',
  });
  const [showTechnicianDetails, setShowTechnicianDetails] = useState(false);
  const [selectedTechnician, setSelectedTechnician] = useState<any>(null);
  const [showEditTechnicianModal, setShowEditTechnicianModal] = useState(false);
  const [technicianCalendar, setTechnicianCalendar] = useState<any>(null);
  const [unavailabilityForm, setUnavailabilityForm] = useState({ starts_at: '', ends_at: '', reason: 'LEAVE', notes: '' });
  const [ticketForm, setTicketForm] = useState({
    customer_id: '',
    uid: '',
    ship_name: '',
    location: '',
    complaint_description: '',
    reported_by: '',
    contact_number: '',
    email: '',
    product_id: '',
    product_name: '',
    model_number: '',
    service_location: '',
    priority: 'MEDIUM',
    expected_completion_date: '',
    installed_asset_id: '',
    service_contract_id: '',
  });

  const emptyAssetForm = { customer_id: '', item_id: '', uid: '', serial_number: '', asset_name: '', parent_asset_id: '', functional_location: '', criticality: 'MEDIUM', manufacturer: '', model_number: '', installation_date: '', warranty_until: '', location: '', status: 'ACTIVE', notes: '' };
  const [assetForm, setAssetForm] = useState(emptyAssetForm);
  const [assetMeters, setAssetMeters] = useState<any>(null);
  const [meterForm, setMeterForm] = useState({ meter_name: '', meter_type: 'RUNNING_HOURS', uom: 'HOUR', initial_reading: '0', rollover_value: '' });
  const [meterReadingForm, setMeterReadingForm] = useState<Record<string, string>>({});
  const emptyContractForm = { customer_id: '', contract_type: 'AMC', start_date: todayDate, end_date: '', status: 'DRAFT', response_hours: '8', resolution_hours: '48', included_visits: '', included_labor_hours: '', contract_value: '0', tax_percentage: String(regionalProfile.defaultTaxRate), notes: '', asset_ids: [] as string[] };
  const [contractForm, setContractForm] = useState(emptyContractForm);
  const emptyMaintenanceForm = { customer_id: '', uid: '', installed_asset_id: '', schedule_name: '', trigger_type: 'CALENDAR', frequency_days: '90', meter_id: '', meter_interval: '', last_service_meter: '', next_service_meter: '', last_service_date: '', next_service_date: todayDate, notify_before_days: '7', service_checklist: '', is_active: true };
  const [maintenanceForm, setMaintenanceForm] = useState(emptyMaintenanceForm);
  const [maintenanceMeters, setMaintenanceMeters] = useState<any[]>([]);
  const emptyChecklistTemplateForm = { template_name: '', service_type: '', description: '', items: [{ item_text: '', is_required: true }] };
  const [checklistTemplateForm, setChecklistTemplateForm] = useState(emptyChecklistTemplateForm);
  const [ticketChecklistTemplateId, setTicketChecklistTemplateId] = useState('');

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadPreviews, setUploadPreviews] = useState<string[]>([]);

  const [technicianForm, setTechnicianForm] = useState({
    employee_id: '',
    technician_name: '',
    specialization: '',
    contact_number: '',
    email: '',
    daily_capacity_hours: '8',
    skills: '',
    territories: '',
    base_location: '',
    shift_start: '09:00',
    shift_end: '18:00',
    working_days: [1, 2, 3, 4, 5, 6] as number[],
    is_active: true,
  });
  const [technicianFormError, setTechnicianFormError] = useState<string | null>(null);
  const [technicianEmployees, setTechnicianEmployees] = useState<TechnicianEmployee[]>([]);
  const [loadingTechnicianEmployees, setLoadingTechnicianEmployees] = useState(false);

  // Warranty check
  const [warrantyUID, setWarrantyUID] = useState('');
  const [warrantyResult, setWarrantyResult] = useState<WarrantyValidation | null>(null);

  // Reports
  const [reports, setReports] = useState<any>(null);
  const [serviceInvoices, setServiceInvoices] = useState<CustomerServiceInvoice[]>([]);
  const [confirmationTicket, setConfirmationTicket] = useState<ServiceTicket | null>(null);
  const [estimateTicket, setEstimateTicket] = useState<ServiceTicket | null>(null);
  const [serviceEstimates, setServiceEstimates] = useState<ServiceEstimate[]>([]);
  const [revisingEstimateId, setRevisingEstimateId] = useState<string | null>(null);
  const [estimateFollowUp, setEstimateFollowUp] = useState<ServiceEstimate | null>(null);
  const [estimateFollowUpForm, setEstimateFollowUpForm] = useState({ to: '', notes: '', next_follow_up_date: '', send_email: true });
  const [estimateDecision, setEstimateDecision] = useState<{ estimate: ServiceEstimate; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [estimateDecisionForm, setEstimateDecisionForm] = useState({ customer_comments: '', approval_reference: '' });
  const [estimateDecisionFile, setEstimateDecisionFile] = useState<File | null>(null);
  const [estimateForm, setEstimateForm] = useState({
    estimate_date: getTodayDateInputValue(), valid_until: '', tax_percentage: String(regionalProfile.defaultTaxRate), terms_and_conditions: '',
    items: [{ description: 'Service labour and charges', quantity: '1', uom: 'JOB', unit_price: '', discount_percent: '0' }],
  });
  const [confirmationBillablePartsAmount, setConfirmationBillablePartsAmount] = useState(0);
  const [confirmationApprovedEstimateAmount, setConfirmationApprovedEstimateAmount] = useState(0);
  const [confirmationVarianceFile, setConfirmationVarianceFile] = useState<File | null>(null);
  const [documentFlow, setDocumentFlow] = useState<any>(null);
  const [billingReleaseConfirmation, setBillingReleaseConfirmation] = useState<any>(null);
  const [billingReleaseForm, setBillingReleaseForm] = useState({ invoice_date: getTodayDateInputValue(), due_date: addCalendarDays(getTodayDateInputValue(), 30), notes: '' });
  const [feedbackTicket, setFeedbackTicket] = useState<ServiceTicket | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({ overall_rating: '5', technician_rating: '', response_time_rating: '', quality_rating: '', feedback_text: '', suggestions: '', would_recommend: '' });
  const [serviceReceiptInvoice, setServiceReceiptInvoice] = useState<CustomerServiceInvoice | null>(null);
  const [serviceCollectionInvoice, setServiceCollectionInvoice] = useState<CustomerServiceInvoice | null>(null);
  const [serviceCollectionForm, setServiceCollectionForm] = useState({ collection_status: 'CONTACTED', next_follow_up_date: '', promise_to_pay_date: '', notes: '' });
  const [viewingServiceInvoice, setViewingServiceInvoice] = useState<CustomerServiceInvoice | null>(null);
  const [confirmationForm, setConfirmationForm] = useState({
    confirmation_date: getTodayDateInputValue(), work_performed: '', technician_remarks: '',
    failure_code_id: '', failure_category: '', root_cause: '', corrective_action: '', preventive_action: '',
    labor_hours: '', labor_rate: '', travel_cost: '', other_amount: '', tax_percentage: String(regionalProfile.defaultTaxRate),
    customer_signoff_name: '', is_final: true, variance_reason: '', variance_approval_reference: '',
  });
  const [assignmentForm, setAssignmentForm] = useState({ technician_id: '', scheduled_start_at: '', scheduled_end_at: '', required_skills: '', service_territory: '', override_reason: '' });
  const emptyPartForm = {
    part_id: '', warehouse_id: '', quantity: '1', unit_price: '0', charged_to_customer: true,
    old_part_uid: '', old_part_condition: '', new_part_uid: '', replacement_warranty_start: todayDate,
    replacement_warranty_months: '6', return_required: false, notes: '',
  };
  const [partForm, setPartForm] = useState(emptyPartForm);
  const [partStockAvailable, setPartStockAvailable] = useState<number | null>(null);
  const [partStockLoading, setPartStockLoading] = useState(false);
  const [partSubmitting, setPartSubmitting] = useState(false);
  const [partError, setPartError] = useState<string | null>(null);
  const [serviceReceiptForm, setServiceReceiptForm] = useState({
    amount: '', receipt_date: getTodayDateInputValue(), payment_method: 'NEFT', payment_reference: '', notes: '',
  });

  useEffect(() => {
    setCurrentUser(readStoredUser());
  }, []);

  useEffect(() => {
    if (regionalProfileLoading) return;
    const defaultRate = String(regionalProfile.defaultTaxRate);
    if (!editingContractId && !renewingContractId) {
      setContractForm((current) => ({ ...current, tax_percentage: defaultRate }));
    }
    if (!revisingEstimateId) {
      setEstimateForm((current) => ({ ...current, tax_percentage: defaultRate }));
    }
    if (!confirmationTicket) {
      setConfirmationForm((current) => ({ ...current, tax_percentage: defaultRate }));
    }
  }, [confirmationTicket, editingContractId, regionalProfile, regionalProfileLoading, renewingContractId, revisingEstimateId]);

  useEffect(() => {
    if (!maintenanceForm.installed_asset_id) { setMaintenanceMeters([]); return; }
    apiClient.get<any[]>(`/service/installed-assets/${maintenanceForm.installed_asset_id}/meters`).then(setMaintenanceMeters).catch(() => setMaintenanceMeters([]));
  }, [maintenanceForm.installed_asset_id]);

  useEffect(() => {
    let cancelled = false;
    if (!partTicket || !partForm.part_id || !partForm.warehouse_id) {
      setPartStockAvailable(null);
      return () => { cancelled = true; };
    }
    setPartStockLoading(true);
    setPartError(null);
    apiClient.get<ServicePartStock[]>('/inventory/stock', {
      item_id: partForm.part_id,
      warehouse_id: partForm.warehouse_id,
    }).then((rows) => {
      if (cancelled) return;
      const available = (rows || []).reduce(
        (sum, row) => sum + Number(row.available_quantity ?? row.quantity ?? 0),
        0,
      );
      setPartStockAvailable(available);
    }).catch((err: any) => {
      if (!cancelled) {
        setPartStockAvailable(null);
        setPartError(err?.message || 'Available stock could not be loaded.');
      }
    }).finally(() => { if (!cancelled) setPartStockLoading(false); });
    return () => { cancelled = true; };
  }, [partTicket, partForm.part_id, partForm.warehouse_id]);

  useEffect(() => {
    if (activeTab === 'tickets') {
      fetchTickets();
    } else if (activeTab === 'dispatch') {
      fetchDispatchBoard();
    } else if (activeTab === 'installed-base') {
      fetchInstalledAssets();
    } else if (activeTab === 'contracts') {
      fetchServiceContracts();
    } else if (activeTab === 'maintenance') {
      fetchMaintenanceSchedules();
    } else if (activeTab === 'checklists') {
      fetchChecklistTemplates();
    } else if (activeTab === 'technicians') {
      fetchTechnicians();
    } else if (activeTab === 'controls') {
      fetchEnterpriseControls();
    } else if (activeTab === 'billing') {
      fetchServiceInvoices();
    } else if (activeTab === 'reports') {
      fetchReports();
    }
  }, [activeTab]);

  useEffect(() => {
    setCurrentPage(1);
    setRegisterSearch('');
    setRegisterStatus('ALL');
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'dispatch' && dispatchDate) fetchDispatchBoard();
  }, [dispatchDate]);

  useEffect(() => {
    // Fetch customers and items when component mounts
    fetchCustomers();
    fetchItems();
    fetchWarehouses();
    fetchShipNames();
    fetchInstalledAssets();
    fetchServiceContracts();
    fetchMaintenanceSchedules();
    fetchFailureCodes();
  }, []);

  useEffect(() => {
    if (!showTicketForm) return;

    const query = productLookupInput.trim();
    if (!query) {
      setProductLookupResults([]);
      setShowProductLookupDropdown(false);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setProductLookupLoading(true);
        const response = await apiClient.get<{
          data: DeploymentStatusRecord[];
          total: number;
          offset: number;
          limit: number;
        }>(
          `/uid/deployment/status?search=${encodeURIComponent(query)}&offset=0&limit=20&sort_by=uid&sort_order=asc`,
        );

        const results = response?.data || [];
        setProductLookupResults(results);
        setShowProductLookupDropdown(results.length > 0);
      } catch (err) {
        setProductLookupResults([]);
        setShowProductLookupDropdown(false);
      } finally {
        setProductLookupLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [productLookupInput, showTicketForm]);

  const formatWarrantyDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    // 20-Jan-2026 style
    return date
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      .replace(/ /g, '-');
  };

  const getWarrantyStatusText = (warrantyExpiryDate: string | null | undefined) => {
    if (!warrantyExpiryDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(warrantyExpiryDate);
    if (Number.isNaN(expiry.getTime())) return null;
    expiry.setHours(0, 0, 0, 0);

    if (expiry >= today) {
      return `In warranty, expiring by ${formatWarrantyDate(warrantyExpiryDate)}`;
    }
    return `Warranty expired on ${formatWarrantyDate(warrantyExpiryDate)}`;
  };

  const selectDeployment = (deployment: DeploymentStatusRecord) => {
    setSelectedDeployment(deployment);
    setProductLookupInput(
      deployment.client_part_number
        ? `${deployment.client_part_number}`
        : deployment.uid,
    );
    setShowProductLookupDropdown(false);

    const matchedItem = deployment.item_code
      ? items.find((item) => item.code === deployment.item_code)
      : undefined;

    setTicketForm((prev) => ({
      ...prev,
      uid: deployment.uid,
      product_id: matchedItem?.id || prev.product_id,
      product_name: deployment.item_name || matchedItem?.name || prev.product_name,
      model_number: deployment.client_part_number || prev.model_number,
    }));
  };

  const fetchCustomers = async () => {
    try {
      const data = await apiClient.get<Customer[]>('/sales/customers');
      setCustomers(data);
    } catch (err) {
    }
  };

  const fetchItems = async () => {
    try {
      const data = await apiClient.get<Item[]>('/items');
      setItems(data);
    } catch (err) {
    }
  };

  const fetchShipNames = async () => {
    try {
      const data = await apiClient.get<ServiceTicket[]>('/service/tickets');
      const uniqueShipNames = [...new Set(data.map(t => t.ship_name).filter(Boolean))] as string[];
      setShipNames(uniqueShipNames.sort());
    } catch (err) {
    }
  };

  const updateShipNameSuggestions = (value: string) => {
    const query = value.trim().toLowerCase();
    const suggestions = query
      ? shipNames.filter((name) => name.toLowerCase().includes(query))
      : shipNames;

    setFilteredShipNames(suggestions);
    setShowShipNameDropdown(suggestions.length > 0);
  };

  const handleShipNameChange = (value: string) => {
    setShipNameInput(value);
    setTicketForm((prev) => ({ ...prev, ship_name: value }));
    updateShipNameSuggestions(value);
  };

  const selectShipName = (name: string) => {
    setShipNameInput(name);
    setTicketForm((prev) => ({ ...prev, ship_name: name }));
    setShowShipNameDropdown(false);
  };

  const fetchAvailableUIDs = async (itemId: string) => {
    if (!itemId) {
      setAvailableUIDs([]);
      return;
    }
    try {
      const data = await apiClient.get<UIDRecord[]>(`/uid?item_id=${itemId}&status=GENERATED`);
      setAvailableUIDs(data);
    } catch (err) {
      setAvailableUIDs([]);
    }
  };

  const fetchTickets = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<ServiceTicket[]>('/service/tickets');
      setTickets(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch service tickets');
    } finally {
      setLoading(false);
    }
  };

  const fetchTechnicians = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<Technician[]>('/service/technicians');
      setTechnicians(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch technicians');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const isUnder50MB = file.size <= 50 * 1024 * 1024; // 50MB limit
      return (isImage || isVideo) && isUnder50MB;
    });

    if (validFiles.length < files.length) {
      alert('Some files were rejected. Only images and videos under 50MB are allowed.');
    }

    setUploadedFiles(prev => [...prev, ...validFiles]);

    // Create previews
    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadPreviews(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setUploadPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const fetchReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<any>('/service/reports');
      setReports(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch reports');
    } finally {
      setLoading(false);
    }
  };

  const fetchFailureCodes = async () => {
    try { setFailureCodes(await apiClient.get<ServiceFailureCode[]>('/service/failure-codes?active_only=false')); }
    catch (err: any) { setError(err.message || 'Failed to fetch failure codes'); }
  };

  const fetchEnterpriseControls = async () => {
    setLoading(true); setError(null);
    try {
      const [codes, escalations, rmas, recoveryClaims] = await Promise.all([
        apiClient.get<ServiceFailureCode[]>('/service/failure-codes?active_only=false'),
        apiClient.get<ServiceEscalation[]>('/service/escalations'),
        apiClient.get<ServiceRmaOrder[]>('/service/rma-orders'),
        apiClient.get<any[]>('/service/warranty-recovery-claims'),
      ]);
      setFailureCodes(codes); setServiceEscalations(escalations); setRmaOrders(rmas); setWarrantyRecoveryClaims(recoveryClaims);
    } catch (err: any) { setError(err.message || 'Failed to load enterprise service controls'); }
    finally { setLoading(false); }
  };

  const fetchDispatchBoard = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ticketData, technicianData, capacityData] = await Promise.all([
        apiClient.get<ServiceTicket[]>('/service/tickets'),
        apiClient.get<Technician[]>('/service/technicians'),
        apiClient.get<TechnicianCapacity[]>(`/service/technicians/capacity/day?date=${dispatchDate}`),
      ]);
      setTickets(ticketData);
      setTechnicians(technicianData);
      setTechnicianCapacity(capacityData);
    } catch (err: any) {
      setError(err.message || 'Failed to load the technician dispatch board');
    } finally {
      setLoading(false);
    }
  };

  const fetchChecklistTemplates = async () => {
    setLoading(true);
    setError(null);
    try { setChecklistTemplates(await apiClient.get<ServiceChecklistTemplate[]>('/service/checklist-templates?active_only=false')); }
    catch (err: any) { setError(err.message || 'Failed to load service checklist templates'); }
    finally { setLoading(false); }
  };

  const saveChecklistTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setLoading(true);
      if (editingChecklistTemplateId) await apiClient.put(`/service/checklist-templates/${editingChecklistTemplateId}`, checklistTemplateForm);
      else await apiClient.post('/service/checklist-templates', checklistTemplateForm);
      setShowChecklistTemplateForm(false);
      setEditingChecklistTemplateId(null);
      setChecklistTemplateForm(emptyChecklistTemplateForm);
      await fetchChecklistTemplates();
    } catch (err: any) { alert(err.message || 'Checklist template could not be saved'); }
    finally { setLoading(false); }
  };

  const assignChecklistToTicket = async (ticket: ServiceTicket) => {
    if (!ticketChecklistTemplateId) return alert('Select a checklist template');
    try {
      setLoading(true);
      await apiClient.post(`/service/tickets/${ticket.id}/checklist`, { template_id: ticketChecklistTemplateId });
      const refreshed = await apiClient.get<ServiceTicket>(`/service/tickets/${ticket.id}`);
      setSelectedTicket(refreshed);
      setTicketChecklistTemplateId('');
      await fetchTickets();
    } catch (err: any) { alert(err.message || 'Checklist could not be assigned'); }
    finally { setLoading(false); }
  };

  const updateTicketChecklistItem = async (ticket: ServiceTicket, item: ServiceTicketChecklistItem, status: ServiceTicketChecklistItem['status']) => {
    const remarks = status === 'NOT_APPLICABLE' ? window.prompt('Reason this mandatory step is not applicable:') : (item.remarks || '');
    if (status === 'NOT_APPLICABLE' && !remarks?.trim()) return;
    try {
      setLoading(true);
      await apiClient.put(`/service/tickets/${ticket.id}/checklist/${item.id}`, { status, remarks });
      setSelectedTicket(await apiClient.get<ServiceTicket>(`/service/tickets/${ticket.id}`));
    } catch (err: any) { alert(err.message || 'Checklist item could not be updated'); }
    finally { setLoading(false); }
  };

  const fetchInstalledAssets = async () => {
    setLoading(true); setError(null);
    try { setInstalledAssets(await apiClient.get<InstalledAsset[]>('/service/installed-assets')); }
    catch (err: any) { setError(err.message || 'Failed to fetch installed assets'); }
    finally { setLoading(false); }
  };

  const fetchServiceContracts = async () => {
    setLoading(true); setError(null);
    try { setServiceContracts(await apiClient.get<ServiceContract[]>('/service/contracts')); }
    catch (err: any) { setError(err.message || 'Failed to fetch service contracts'); }
    finally { setLoading(false); }
  };

  const fetchMaintenanceSchedules = async () => {
    setLoading(true); setError(null);
    try { setMaintenanceSchedules(await apiClient.get<MaintenanceSchedule[]>('/service/maintenance-schedules')); }
    catch (err: any) { setError(err.message || 'Failed to fetch maintenance schedules'); }
    finally { setLoading(false); }
  };

  const saveMaintenanceSchedule = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      if (editingMaintenanceId) await apiClient.put(`/service/maintenance-schedules/${editingMaintenanceId}`, maintenanceForm);
      else await apiClient.post('/service/maintenance-schedules', maintenanceForm);
      setShowMaintenanceForm(false); setEditingMaintenanceId(null); setMaintenanceForm(emptyMaintenanceForm); await fetchMaintenanceSchedules();
    } catch (err: any) { setError(err.message || 'Failed to save maintenance schedule'); }
    finally { setLoading(false); }
  };

  const editMaintenanceSchedule = (schedule: MaintenanceSchedule) => {
    setEditingMaintenanceId(schedule.id);
    setMaintenanceForm({ customer_id: schedule.customer_id, uid: schedule.uid, installed_asset_id: schedule.installed_asset_id || '', schedule_name: schedule.schedule_name, trigger_type: (schedule as any).trigger_type || 'CALENDAR', frequency_days: String(schedule.frequency_days), meter_id: (schedule as any).meter_id || '', meter_interval: (schedule as any).meter_interval == null ? '' : String((schedule as any).meter_interval), last_service_meter: (schedule as any).last_service_meter == null ? '' : String((schedule as any).last_service_meter), next_service_meter: (schedule as any).next_service_meter == null ? '' : String((schedule as any).next_service_meter), last_service_date: schedule.last_service_date || '', next_service_date: schedule.next_service_date, notify_before_days: String(schedule.notify_before_days), service_checklist: schedule.service_checklist || '', is_active: schedule.is_active });
    setShowMaintenanceForm(true);
  };

  const deleteMaintenanceSchedule = async (schedule: MaintenanceSchedule) => {
    if (!confirm(`Delete maintenance schedule ${schedule.schedule_name}?`)) return;
    try { await apiClient.delete(`/service/maintenance-schedules/${schedule.id}`); await fetchMaintenanceSchedules(); }
    catch (err: any) { alert(err.message || 'Failed to delete maintenance schedule'); }
  };

  const generateMaintenanceTicket = async (schedule: MaintenanceSchedule) => {
    if (!confirm(`Generate a service ticket for ${schedule.schedule_name}?`)) return;
    setLoading(true); setError(null);
    try { const ticket = await apiClient.post<ServiceTicket>(`/service/maintenance-schedules/${schedule.id}/generate-ticket`, {}); alert(`Service ticket ${ticket.ticket_number} created.`); await Promise.all([fetchMaintenanceSchedules(), fetchTickets()]); }
    catch (err: any) { setError(err.message || 'Maintenance ticket could not be generated'); }
    finally { setLoading(false); }
  };

  const saveInstalledAsset = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      if (editingAssetId) await apiClient.put(`/service/installed-assets/${editingAssetId}`, assetForm);
      else await apiClient.post('/service/installed-assets', assetForm);
      setShowAssetForm(false); setEditingAssetId(null); setAssetForm(emptyAssetForm); await fetchInstalledAssets();
    } catch (err: any) { setError(err.message || 'Failed to save installed asset'); }
    finally { setLoading(false); }
  };

  const saveServiceContract = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      if (renewingContractId) await apiClient.post(`/service/contracts/${renewingContractId}/renew`, contractForm);
      else if (editingContractId) await apiClient.put(`/service/contracts/${editingContractId}`, contractForm);
      else await apiClient.post('/service/contracts', contractForm);
      setShowContractForm(false); setEditingContractId(null); setRenewingContractId(null); setContractForm(emptyContractForm); await fetchServiceContracts();
    } catch (err: any) { setError(err.message || 'Failed to save service contract'); }
    finally { setLoading(false); }
  };

  const editInstalledAsset = (asset: InstalledAsset) => {
    setEditingAssetId(asset.id); setAssetForm({ customer_id: asset.customer_id, item_id: asset.item_id || '', uid: asset.uid || '', serial_number: asset.serial_number || '', asset_name: asset.asset_name, parent_asset_id: (asset as any).parent_asset_id || '', functional_location: (asset as any).functional_location || '', criticality: (asset as any).criticality || 'MEDIUM', manufacturer: (asset as any).manufacturer || '', model_number: (asset as any).model_number || '', installation_date: asset.installation_date || '', warranty_until: asset.warranty_until || '', location: asset.location || '', status: asset.status, notes: asset.notes || '' }); setShowAssetForm(true);
  };

  const openAssetMeters = async (asset: InstalledAsset) => {
    try {
      const meters = await apiClient.get<any[]>(`/service/installed-assets/${asset.id}/meters`);
      setAssetMeters({ asset, meters });
      setMeterForm({ meter_name: '', meter_type: 'RUNNING_HOURS', uom: 'HOUR', initial_reading: '0', rollover_value: '' });
      setMeterReadingForm({});
    } catch (err: any) { alert(err.message || 'Asset meters could not be loaded'); }
  };

  const createAssetMeter = async () => {
    if (!assetMeters || !meterForm.meter_name.trim()) return;
    try {
      await apiClient.post(`/service/installed-assets/${assetMeters.asset.id}/meters`, meterForm);
      await openAssetMeters(assetMeters.asset);
    } catch (err: any) { alert(err.message || 'Meter could not be created'); }
  };

  const recordMeterReading = async (meter: any) => {
    const value = meterReadingForm[meter.id];
    if (value === undefined || value === '') return;
    try {
      await apiClient.post(`/service/asset-meters/${meter.id}/readings`, { reading_value: value, reading_date: todayDate, source: 'MANUAL' });
      await openAssetMeters(assetMeters.asset);
    } catch (err: any) { alert(err.message || 'Meter reading could not be recorded'); }
  };

  const editServiceContract = (contract: ServiceContract) => {
    setRenewingContractId(null); setEditingContractId(contract.id); setContractForm({ customer_id: contract.customer_id, contract_type: contract.contract_type, start_date: contract.start_date, end_date: contract.end_date, status: contract.status, response_hours: String(contract.response_hours), resolution_hours: String(contract.resolution_hours), included_visits: contract.included_visits == null ? '' : String(contract.included_visits), included_labor_hours: contract.included_labor_hours == null ? '' : String(contract.included_labor_hours), contract_value: String(contract.contract_value || 0), tax_percentage: String(contract.tax_percentage ?? regionalProfile.defaultTaxRate), notes: contract.notes || '', asset_ids: (contract.contract_assets || []).map((entry) => entry.asset_id) }); setShowContractForm(true);
  };

  const renewServiceContract = (contract: ServiceContract) => {
    const nextStart = new Date(`${contract.end_date}T00:00:00Z`);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const nextEnd = new Date(nextStart);
    nextEnd.setUTCFullYear(nextEnd.getUTCFullYear() + 1);
    nextEnd.setUTCDate(nextEnd.getUTCDate() - 1);
    setEditingContractId(null);
    setRenewingContractId(contract.id);
    setContractForm({
      customer_id: contract.customer_id, contract_type: contract.contract_type,
      start_date: nextStart.toISOString().slice(0, 10), end_date: nextEnd.toISOString().slice(0, 10), status: 'DRAFT',
      response_hours: String(contract.response_hours), resolution_hours: String(contract.resolution_hours),
      included_visits: contract.included_visits == null ? '' : String(contract.included_visits),
      included_labor_hours: contract.included_labor_hours == null ? '' : String(contract.included_labor_hours),
      contract_value: String(contract.contract_value || 0), tax_percentage: String(contract.tax_percentage ?? regionalProfile.defaultTaxRate),
      notes: contract.notes || '', asset_ids: (contract.contract_assets || []).map((entry) => entry.asset_id),
    });
    setShowContractForm(true);
  };

  const deleteInstalledAsset = async (asset: InstalledAsset) => {
    if (!confirm(`Delete installed asset ${asset.asset_number}?`)) return;
    try { await apiClient.delete(`/service/installed-assets/${asset.id}`); await fetchInstalledAssets(); }
    catch (err: any) { alert(err.message || 'Failed to delete installed asset'); }
  };

  const deleteServiceContract = async (contract: ServiceContract) => {
    if (!confirm(`Delete draft contract ${contract.contract_number}?`)) return;
    try { await apiClient.delete(`/service/contracts/${contract.id}`); await fetchServiceContracts(); }
    catch (err: any) { alert(err.message || 'Failed to delete service contract'); }
  };

  const fetchWarehouses = async () => {
    try {
      const data = await apiClient.get<Warehouse[]>('/inventory/warehouses');
      setWarehouses(data || []);
      if (data?.length) setPartForm((current) => ({ ...current, warehouse_id: current.warehouse_id || data[0].id }));
    } catch (err) {
      setWarehouses([]);
    }
  };

  const fetchServiceInvoices = async () => {
    setLoading(true); setError(null);
    try { setServiceInvoices(await apiClient.get<CustomerServiceInvoice[]>('/service/customer-invoices')); }
    catch (err: any) { setError(err.message || 'Failed to fetch service invoices'); }
    finally { setLoading(false); }
  };

  const openServiceInvoice = async (invoice: CustomerServiceInvoice) => {
    try {
      setViewingServiceInvoice(await apiClient.get<CustomerServiceInvoice>(`/service/customer-invoices/${invoice.id}`));
    } catch (err: any) {
      alert(err.message || 'Failed to load service invoice');
    }
  };

  const emailServiceInvoice = async (invoice: CustomerServiceInvoice) => {
    const recipient = window.prompt('Send service invoice to email:', invoice.customer?.email || '')?.trim();
    if (!recipient) return;
    try {
      const result = await apiClient.post<any>(`/service/customer-invoices/${invoice.id}/send-email`, { to: recipient });
      alert(result.message || `Service invoice ${invoice.invoice_number} emailed successfully.`);
    } catch (err: any) {
      alert(err?.message || 'Service invoice email could not be sent');
    }
  };

  const printServiceInvoice = async (invoice: CustomerServiceInvoice) => {
    // Preserve a writable WindowProxy while branding and invoice details load;
    // noopener can make Chrome return null and strand an about:blank tab.
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing service invoice...</body></html>'); printWindow.document.close(); }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const confirmation = invoice.confirmation || {};
      const billableParts = (invoice.service_parts || []).filter((part: any) => part.charged_to_customer);
      const partRows = billableParts.map((part: any) => `<tr><td>Part: ${escapeHtml(`${part.part_code ? `${part.part_code} - ` : ''}${part.part_name || 'Replacement part'}${part.new_part_uid ? ` / UID ${part.new_part_uid}` : ''}`)} (${money(part.quantity)} × ${money(part.unit_price)})</td><td class="num">${money(part.total_cost)}</td></tr>`).join('');
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(invoice.invoice_number)}</title><style>@page{margin:.5cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db}.meta>div{padding:9px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d1d5db;padding:8px}th{background:#f3f4f6;text-align:left}.num{text-align:right}.total{font-size:14px;font-weight:800}.work{margin-top:18px;border:1px solid #d1d5db;padding:12px}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>CUSTOMER SERVICE INVOICE</h1><div class="meta"><div><div class="label">Invoice No.</div><div class="value">${escapeHtml(invoice.invoice_number)}</div></div><div><div class="label">Invoice Date</div><div class="value">${new Date(invoice.invoice_date).toLocaleDateString(regionalProfile.locale)}</div></div><div><div class="label">Customer</div><div class="value">${escapeHtml(invoice.customer?.customer_name || '-')}</div></div><div><div class="label">Service Ticket</div><div class="value">${escapeHtml(invoice.ticket?.ticket_number || '-')}</div></div><div><div class="label">Confirmation</div><div class="value">${escapeHtml(confirmation.confirmation_number || '-')}</div></div><div><div class="label">Payment Status</div><div class="value">${escapeHtml(invoice.payment_status)}</div></div></div><div class="work"><strong>Service performed</strong><p>${escapeHtml(confirmation.work_performed || '-')}</p></div><table><thead><tr><th>Charge</th><th class="num">Amount</th></tr></thead><tbody><tr><td>Labour (${Number(confirmation.labor_hours || 0)} hrs × ${money(confirmation.labor_rate)})</td><td class="num">${money(Number(confirmation.labor_hours || 0) * Number(confirmation.labor_rate || 0))}</td></tr>${partRows || `<tr><td>Parts</td><td class="num">${money(confirmation.parts_amount)}</td></tr>`}<tr><td>Travel</td><td class="num">${money(confirmation.travel_cost)}</td></tr><tr><td>Other charges</td><td class="num">${money(confirmation.other_amount)}</td></tr><tr><td>Taxable value</td><td class="num">${money(invoice.taxable_amount)}</td></tr><tr><td>${regionalProfile.taxLabel} (${money(confirmation.tax_percentage)}%)</td><td class="num">${money(invoice.tax_amount)}</td></tr><tr class="total"><td>Invoice Total</td><td class="num">${money(invoice.net_amount)}</td></tr><tr><td>Amount Received</td><td class="num">${money(invoice.paid_amount)}</td></tr><tr class="total"><td>Outstanding</td><td class="num">${money(invoice.balance_amount)}</td></tr></tbody></table><div class="sign"><span>Customer Acknowledgement</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this service invoice as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare service invoice'); }
  };

  const downloadServiceInvoicePdf = async (invoice: CustomerServiceInvoice) => {
    try {
      const blob = await apiClient.getBlob(`/service/customer-invoices/${invoice.id}/pdf`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${invoice.invoice_number}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err: any) {
      alert(err?.message || 'Failed to download service invoice PDF');
    }
  };

  const printSiteVisitReport = async (ticket: ServiceTicket, visit: ServiceSiteVisit) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing field service visit report...</body></html>');
      printWindow.document.close();
    }
    try {
      if (!printWindow) throw new Error('Allow popups to print or save the field service visit report as PDF.');
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN') : '-';
      const evidence = [
        ...(visit.before_attachments || []).map((url) => ({ url, stage: 'Before service' })),
        ...(visit.after_attachments || []).map((url) => ({ url, stage: 'After service' })),
      ];
      const evidenceHtml = evidence.map((entry, index) => {
        const absoluteUrl = new URL(entry.url, window.location.origin).href;
        const isImage = getAttachmentKind(entry.url) === 'image';
        return `<div class="evidence"><div class="label">${escapeHtml(entry.stage)} ${index + 1}</div>${isImage ? `<img src="${escapeHtml(absoluteUrl)}" alt="${escapeHtml(entry.stage)} evidence ${index + 1}" />` : `<div class="video">Video evidence</div>`}<a href="${escapeHtml(absoluteUrl)}">${escapeHtml(absoluteUrl)}</a></div>`;
      }).join('');
      const coordinates = visit.check_out_lat != null && visit.check_out_lng != null
        ? `${visit.check_out_lat}, ${visit.check_out_lng}`
        : visit.check_in_lat != null && visit.check_in_lng != null
          ? `${visit.check_in_lat}, ${visit.check_in_lng}`
          : '-';
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(ticket.ticket_number)}-Visit-${visit.visit_number}</title><style>@page{margin:.7cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:18px 0 4px}.subtitle{text-align:center;color:#6b7280;margin-bottom:18px}.status{text-align:center;font-weight:800;color:${visit.status === 'COMPLETED' ? '#166534' : '#92400e'};margin-bottom:16px}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db}.meta>div{padding:9px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280;font-weight:700}.value{font-weight:700;margin-top:3px}.section{margin-top:16px;border:1px solid #d1d5db;padding:12px}.section h2{font-size:12px;text-transform:uppercase;margin:0 0 8px}.evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.evidence{border:1px solid #d1d5db;padding:8px;overflow-wrap:anywhere}.evidence img{display:block;width:100%;height:170px;object-fit:contain;background:#f3f4f6;margin:6px 0}.evidence a{font-size:8px;color:#1d4ed8}.video{height:70px;display:flex;align-items:center;justify-content:center;background:#f3f4f6;font-weight:700;margin:6px 0}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString('en-IN'))}<h1>FIELD SERVICE VISIT REPORT</h1><div class="subtitle">${escapeHtml(ticket.ticket_number)} / Visit ${visit.visit_number}</div><div class="status">${escapeHtml(visit.status.replaceAll('_', ' '))}</div><div class="meta"><div><div class="label">Service Ticket</div><div class="value">${escapeHtml(ticket.ticket_number)}</div></div><div><div class="label">Customer</div><div class="value">${escapeHtml(ticket.customer?.customer_name || '-')}</div></div><div><div class="label">Product / Asset</div><div class="value">${escapeHtml(ticket.product_name || ticket.uid || '-')}</div></div><div><div class="label">Service Person</div><div class="value">${escapeHtml(visit.assignment?.technician?.technician_name || '-')}</div></div><div><div class="label">Client Representative</div><div class="value">${escapeHtml(visit.site_contact_name)}${visit.site_contact_designation ? `, ${escapeHtml(visit.site_contact_designation)}` : ''}</div></div><div><div class="label">Client Contact</div><div class="value">${escapeHtml([visit.site_contact_mobile, visit.site_contact_email].filter(Boolean).join(' / ') || '-')}</div></div><div><div class="label">Check In</div><div class="value">${escapeHtml(dateTime(visit.check_in_at))}</div></div><div><div class="label">Check Out</div><div class="value">${escapeHtml(dateTime(visit.check_out_at))}</div></div><div><div class="label">Site Location</div><div class="value">${escapeHtml(visit.check_out_location || visit.check_in_location || '-')}</div></div><div><div class="label">GPS Coordinates</div><div class="value">${escapeHtml(coordinates)}</div></div></div><div class="section"><h2>Visit Purpose</h2>${escapeHtml(visit.purpose || '-')}</div><div class="section"><h2>Work Performed</h2>${escapeHtml(visit.work_notes || 'Visit is still open; work completion has not been recorded.')}</div><div class="section"><h2>Customer Acknowledgement</h2><strong>${escapeHtml(visit.customer_acknowledgement_name || 'Pending')}</strong>${visit.customer_acknowledged_at ? ` on ${escapeHtml(dateTime(visit.customer_acknowledged_at))}` : ''}</div><div class="section"><h2>Site Evidence</h2>${evidenceHtml ? `<div class="evidence-grid">${evidenceHtml}</div>` : 'No site evidence attached.'}</div><div class="sign"><span>Service Person</span><span>Customer Representative</span></div><script>window.onload=function(){window.focus();setTimeout(function(){window.print();},300);}</script></body></html>`;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) {
      if (printWindow) printWindow.close();
      alert(err?.message || 'Failed to prepare the field service visit report');
    }
  };

  const printServiceCallReport = async (flow: any) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing consolidated service call report...</body></html>');
      printWindow.document.close();
    }
    try {
      if (!printWindow) throw new Error('Allow popups to print or save the service call report as PDF.');
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('en-IN') : '-';
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const ticket = flow.ticket || {};
      const visits = flow.visits || [];
      const confirmations = flow.confirmations || [];
      const parts = flow.parts || [];
      const invoices = (flow.invoices || []).filter((invoice: any) => invoice.billing_status !== 'CANCELLED');
      const technicians = [...new Set([...(flow.assignments || []).map((a: any) => a.technician?.technician_name), ...visits.map((v: any) => v.assignment?.technician?.technician_name)].filter(Boolean))];
      const startDates = [...visits.map((v: any) => v.check_in_at), ...(flow.assignments || []).map((a: any) => a.actual_start_date || a.scheduled_start_date), ticket.complaint_date].filter(Boolean).sort();
      const endDates = [...visits.map((v: any) => v.check_out_at), ticket.actual_completion_date].filter(Boolean).sort();
      const evidence = [...(ticket.attachments || []), ...visits.flatMap((v: any) => [...(v.before_attachments || []), ...(v.after_attachments || [])]), ...confirmations.flatMap((c: any) => c.attachments || [])];
      const warranty = Boolean(ticket.is_under_warranty) || String(ticket.entitlement_status || '').toUpperCase() === 'WARRANTY';
      const row = (label: string, value: unknown) => `<div><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
      const partsHtml = parts.length ? parts.map((p: any) => `<tr><td>${escapeHtml(p.part_code ? `${p.part_code} - ${p.part_name || ''}` : p.part_name || '-')}</td><td>${Number(p.quantity || 0).toLocaleString('en-IN')}</td><td>${p.charged_to_customer ? 'Billable' : 'Warranty / no charge'}</td><td class="num">${money(p.total_cost || Number(p.quantity || 0) * Number(p.unit_price || 0))}</td><td>${escapeHtml(p.old_part_uid || p.new_part_uid || '-')}</td></tr>`).join('') : '<tr><td colspan="5">No service parts issued.</td></tr>';
      const visitsHtml = visits.length ? visits.map((v: any) => `<tr><td>Visit ${escapeHtml(v.visit_number)}</td><td>${escapeHtml(v.assignment?.technician?.technician_name || '-')}</td><td>${escapeHtml(v.site_contact_name || '-')}</td><td>${dateTime(v.check_in_at)}</td><td>${dateTime(v.check_out_at)}</td><td>${escapeHtml(v.work_notes || v.purpose || '-')}</td></tr>`).join('') : '<tr><td colspan="6">No site visits recorded.</td></tr>';
      const confirmationsHtml = confirmations.length ? confirmations.map((c: any) => `<tr><td>${escapeHtml(c.confirmation_number)}</td><td>${dateTime(c.confirmation_date)}</td><td>${escapeHtml(c.work_performed || '-')}</td><td>${escapeHtml(c.status || '-')}</td><td class="num">${money(c.total_amount)}</td></tr>`).join('') : '<tr><td colspan="5">No service confirmation posted.</td></tr>';
      const invoicesHtml = invoices.length ? invoices.map((i: any) => `<tr><td>${escapeHtml(i.invoice_number)}</td><td>${escapeHtml(i.invoice_date)}</td><td>${escapeHtml(i.payment_status || i.billing_status || '-')}</td><td class="num">${money(i.net_amount)}</td><td class="num">${money(i.paid_amount)}</td></tr>`).join('') : '<tr><td colspan="5">No customer service invoice posted.</td></tr>';
      const evidenceHtml = evidence.length ? evidence.map((url: string, index: number) => { const absolute = new URL(url, window.location.origin).href; return `<li><a href="${escapeHtml(absolute)}">Evidence ${index + 1}: ${escapeHtml(absolute)}</a></li>`; }).join('') : '<li>No photos or videos attached.</li>';
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(ticket.ticket_number || 'Service Call Report')}</title><style>@page{margin:.65cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:18px;font-size:10px}h1{text-align:center;font-size:19px;margin:16px 0 3px}.subtitle{text-align:center;color:#6b7280;margin-bottom:14px}.status{text-align:center;font-weight:800;color:#166534;margin-bottom:14px}.meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cbd5e1}.meta div{padding:8px;border-bottom:1px solid #e5e7eb}.label{display:block;font-size:8px;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:3px}.section{margin-top:14px;border:1px solid #cbd5e1;padding:10px}.section h2{font-size:11px;text-transform:uppercase;margin:0 0 7px;color:#374151}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:6px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-size:8px;text-transform:uppercase}.num{text-align:right;white-space:nowrap}.ok{color:#166534;font-weight:800}.evidence{margin:0;padding-left:18px}.evidence a{color:#1d4ed8;overflow-wrap:anywhere}.sign{display:flex;justify-content:space-between;margin-top:52px}.sign span{width:220px;border-top:1px solid #111;padding-top:5px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString('en-IN'))}<h1>CONSOLIDATED SERVICE CALL REPORT</h1><div class="subtitle">${escapeHtml(ticket.ticket_number || '-')} · ${escapeHtml(ticket.service_type || 'Field Service')}</div><div class="status">${escapeHtml(String(ticket.status || '').replaceAll('_', ' '))}</div><div class="meta">${row('Customer', ticket.customer?.customer_name)}${row('Craft / Asset', ticket.product_name || ticket.asset_name || '-')} ${row('Serial / UID', ticket.serial_number || ticket.uid)}${row('Service Type', ticket.service_type)}${row('Technicians', technicians.join(', '))}${row('Service Start', dateTime(startDates[0]))}${row('Service End', dateTime(endDates[endDates.length - 1]))}${row('Warranty', warranty ? 'SERVICE CHARGE WAIVED' : 'Not under warranty')}${row('Customer Contact', visits.map((v: any) => v.site_contact_name).filter(Boolean).join(', '))}</div><div class="section"><h2>Services Done</h2><div>${escapeHtml(confirmations.map((c: any) => c.work_performed).filter(Boolean).join('; ') || visits.map((v: any) => v.work_notes).filter(Boolean).join('; ') || 'Not recorded')}</div></div><div class="section"><h2>Site Visits & Client Attendance</h2><table><thead><tr><th>Visit</th><th>Technician</th><th>Client Contact</th><th>Start</th><th>End</th><th>Work / Location</th></tr></thead><tbody>${visitsHtml}</tbody></table></div><div class="section"><h2>Parts Used & Billing</h2><table><thead><tr><th>Part</th><th>Qty</th><th>Charge</th><th>Value</th><th>UID Trace</th></tr></thead><tbody>${partsHtml}</tbody></table></div><div class="section"><h2>Service Confirmations</h2><table><thead><tr><th>Confirmation</th><th>Date</th><th>Work Performed</th><th>Status</th><th>Value</th></tr></thead><tbody>${confirmationsHtml}</tbody></table></div><div class="section"><h2>Billing & Payments</h2><table><thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Invoice Value</th><th>Paid</th></tr></thead><tbody>${invoicesHtml}</tbody></table><p><strong>Warranty treatment:</strong> ${warranty ? '<span class="ok">Service charge waived under warranty.</span>' : 'Billable service subject to approved commercial terms.'}</p></div><div class="section"><h2>Photos / Videos / Evidence</h2><ul class="evidence">${evidenceHtml}</ul></div><div class="sign"><span>Service Technician</span><span>Customer Representative</span></div><script>window.onload=function(){window.focus();setTimeout(function(){window.print();},300);}</script></body></html>`;
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close(); printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare consolidated service call report'); }
  };

  const downloadServiceReceiptPdf = async (invoice: CustomerServiceInvoice, payment: any) => {
    try {
      const blob = await apiClient.getBlob(`/service/customer-invoices/${invoice.id}/payments/${payment.id}/pdf`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${payment.receipt_number || 'service-receipt'}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err: any) {
      alert(err?.message || 'Failed to download service receipt PDF');
    }
  };

  const emailServiceReceipt = async (invoice: CustomerServiceInvoice, payment: any) => {
    const recipient = window.prompt(`Send service receipt ${payment.receipt_number} to email:`, invoice.customer?.email || '')?.trim();
    if (!recipient) return;
    try {
      const result = await apiClient.post<any>(`/service/customer-invoices/${invoice.id}/payments/${payment.id}/send-email`, { to: recipient });
      alert(result.message || `Service receipt ${payment.receipt_number} emailed successfully.`);
    } catch (err: any) {
      alert(err?.message || 'Service receipt email could not be sent');
    }
  };

  const printServiceReceipt = async (invoice: CustomerServiceInvoice, payment: any) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing service receipt...</body></html>'); printWindow.document.close(); }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString(regionalProfile.locale) : '-';
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(payment.receipt_number)}</title><style>@page{margin:.7cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.status{text-align:center;font-weight:800;color:${payment.reversed_at ? '#b91c1c' : '#166534'};margin-top:-12px;margin-bottom:18px}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db}.meta>div{padding:10px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:4px}.amount{margin:22px 0;border:2px solid #374151;padding:18px;text-align:center}.amount .label{font-size:10px}.amount .value{font-size:24px}.notes{margin-top:18px;border:1px solid #d1d5db;padding:12px}.sign{display:flex;justify-content:space-between;margin-top:60px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>SERVICE RECEIPT VOUCHER</h1><div class="status">${payment.reversed_at ? 'REVERSED' : 'POSTED'}</div><div class="meta"><div><div class="label">Receipt No.</div><div class="value">${escapeHtml(payment.receipt_number)}</div></div><div><div class="label">Receipt Date</div><div class="value">${date(payment.receipt_date)}</div></div><div><div class="label">Received From</div><div class="value">${escapeHtml(invoice.customer?.customer_name || '-')}</div></div><div><div class="label">Customer Code</div><div class="value">${escapeHtml(invoice.customer?.customer_code || '-')}</div></div><div><div class="label">Against Service Invoice</div><div class="value">${escapeHtml(invoice.invoice_number)}</div></div><div><div class="label">Service Ticket</div><div class="value">${escapeHtml(invoice.ticket?.ticket_number || '-')}</div></div><div><div class="label">Payment Method</div><div class="value">${escapeHtml(payment.payment_method || '-')}</div></div><div><div class="label">Transaction Reference</div><div class="value">${escapeHtml(payment.payment_reference || '-')}</div></div></div><div class="amount"><div class="label">Amount Received</div><div class="value">${money(payment.amount)}</div></div><div class="meta"><div><div class="label">Invoice Value</div><div class="value">${money(invoice.net_amount)}</div></div><div><div class="label">Current Outstanding</div><div class="value">${money(invoice.balance_amount)}</div></div></div>${payment.notes || payment.reversal_reason ? `<div class="notes"><strong>${payment.reversed_at ? 'Reversal Reason' : 'Notes'}</strong><br>${escapeHtml(payment.reversal_reason || payment.notes)}</div>` : ''}<div class="sign"><span>Received By</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this service receipt as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
      printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare service receipt'); }
  };

  const openDocumentFlow = async (ticket: ServiceTicket) => {
    try { setDocumentFlow(await apiClient.get(`/service/tickets/${ticket.id}/document-flow`)); }
    catch (err: any) { alert(err.message || 'Failed to load service document flow'); }
  };

  // Keep the field-service handoff printable directly from Dispatch. This uses
  // the same consolidated trail as the ticket details view, so the report
  // always contains the latest technician, visit, evidence, parts and billing
  // data instead of a stale row snapshot.
  const printDispatchCallReport = async (ticket: ServiceTicket) => {
    try {
      const flow = await apiClient.get(`/service/tickets/${ticket.id}/document-flow`);
      await printServiceCallReport(flow);
    } catch (err: any) {
      alert(err.message || 'Failed to prepare the service call report');
    }
  };

  const exportDispatchCsv = () => {
    const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['Ticket', 'Priority', 'Status', 'Schedule', 'Customer', 'Site', 'Technician', 'Client contact', 'Visit', 'Evidence count', 'Acknowledgement', 'SLA'];
    const rows = filteredDispatchRows.map(({ ticket, assignment, visit }) => [
      ticket.ticket_number,
      ticket.priority,
      visit?.status || assignment?.status || 'UNASSIGNED',
      (assignment as any)?.scheduled_start_at || assignment?.scheduled_start_date || ticket.expected_completion_date || '',
      ticket.customer?.customer_name || '',
      ticket.service_location || ticket.location || '',
      assignment?.technician?.technician_name || '',
      visit?.site_contact_name || ticket.reported_by || ticket.customer?.contact_person || '',
      visit ? `Visit ${visit.visit_number} (${visit.status})` : 'Not started',
      (visit?.before_attachments || []).length + (visit?.after_attachments || []).length,
      visit?.customer_acknowledgement_name ? 'Yes' : 'No',
      ticket.sla?.overall_status || 'NOT SET',
    ]);
    const content = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `service-dispatch-${dispatchDate || 'all'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const printDispatchSchedule = () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) { alert('Please allow pop-ups to print the dispatch schedule'); return; }
    const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const rows = filteredDispatchRows.map(({ ticket, assignment, visit }) => {
      const status = visit?.status || assignment?.status || 'UNASSIGNED';
      const schedule = (assignment as any)?.scheduled_start_at || assignment?.scheduled_start_date || ticket.expected_completion_date || '-';
      const sla = ticket.sla?.overall_status || 'NOT SET';
      return `<tr><td>${escapeHtml(schedule)}</td><td><strong>${escapeHtml(ticket.ticket_number)}</strong><br>${escapeHtml(ticket.priority)}</td><td>${escapeHtml(ticket.customer?.customer_name || '-')}<br><small>${escapeHtml(ticket.service_location || ticket.location || '-')}</small></td><td>${escapeHtml(assignment?.technician?.technician_name || 'Unassigned')}</td><td>${escapeHtml(status.replaceAll('_', ' '))}</td><td>${escapeHtml(sla.replaceAll('_', ' '))}</td><td>${visit ? `Visit ${visit.visit_number} · Evidence ${(visit.before_attachments || []).length + (visit.after_attachments || []).length}` : 'Not started'}</td></tr>`;
    }).join('');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Service Dispatch Schedule</title><style>@page{margin:12mm}body{font:12px Arial;color:#2f241d}h1{margin:0 0 4px;font-size:20px}p{color:#6b7280;margin:0 0 16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9c9ad;padding:7px;text-align:left;vertical-align:top}th{background:#f4eadb;font-size:10px;text-transform:uppercase}small{color:#6b7280}</style></head><body><h1>Service Dispatch Schedule</h1><p>${escapeHtml(dispatchDate || 'All dates')} · ${filteredDispatchRows.length} assignment(s)</p><table><thead><tr><th>Schedule</th><th>Ticket / Priority</th><th>Customer / Site</th><th>Technician</th><th>Visit status</th><th>SLA</th><th>Evidence</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No dispatch work matches the selected filters.</td></tr>'}</tbody></table><script>window.onload=()=>{window.focus();setTimeout(()=>window.print(),250)}</script></body></html>`);
    popup.document.close();
  };

  const exportDispatchCalendar = () => {
    const icsEscape = (value: unknown) => String(value ?? '').replace(/[\\,;]/g, (match) => `\\${match}`).replace(/\r?\n/g, '\\n');
    const dateOnly = (value: unknown) => String(value || dispatchDate || todayDate).slice(0, 10).replace(/-/g, '');
    const nextDate = (value: string) => { const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`); date.setDate(date.getDate() + 1); return date.toISOString().slice(0, 10).replace(/-/g, ''); };
    const events = filteredDispatchRows.map(({ ticket, assignment, visit }) => {
      const start = dateOnly((assignment as any)?.scheduled_start_date || ticket.expected_completion_date);
      const summary = `${ticket.ticket_number} · ${ticket.customer?.customer_name || 'Service call'}`;
      const description = [`Priority: ${ticket.priority}`, `Technician: ${assignment?.technician?.technician_name || 'Unassigned'}`, `Site: ${ticket.service_location || ticket.location || '-'}`, `SLA: ${ticket.sla?.overall_status || 'NOT SET'}`, `Visit: ${visit?.status || 'Not started'}`].join('\\n');
      return `BEGIN:VEVENT\nUID:${icsEscape(ticket.id)}-${start}@sak-erp\nDTSTAMP:${dateOnly(new Date().toISOString())}T000000Z\nDTSTART;VALUE=DATE:${start}\nDTEND;VALUE=DATE:${nextDate(start)}\nSUMMARY:${icsEscape(summary)}\nLOCATION:${icsEscape(ticket.service_location || ticket.location || '')}\nDESCRIPTION:${icsEscape(description)}\nEND:VEVENT`;
    }).join('\n');
    const content = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//SAK ERP//Service Dispatch//EN\nCALSCALE:GREGORIAN\n${events}\nEND:VCALENDAR`;
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `service-dispatch-${dispatchDate || 'all'}.ics`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const createCustomerTrackingLink = async (ticket: ServiceTicket) => {
    try {
      const result = await apiClient.post<any>(`/service/tickets/${ticket.id}/customer-portal-link`, {});
      await navigator.clipboard.writeText(result.portal_url);
      alert(`Customer tracking link created and copied to clipboard.\n\n${result.portal_url}\n\nValid until ${new Date(result.expires_at).toLocaleString('en-IN')}.`);
    } catch (err: any) { alert(err.message || 'Customer tracking link could not be created'); }
  };

  const openTicketDetails = async (ticket: ServiceTicket) => {
    try {
      setLoading(true);
      const [detail, templates] = await Promise.all([
        apiClient.get<ServiceTicket>(`/service/tickets/${ticket.id}`),
        apiClient.get<ServiceChecklistTemplate[]>('/service/checklist-templates').catch(() => checklistTemplates),
      ]);
      setSelectedTicket(detail);
      setChecklistTemplates(templates);
      setTicketChecklistTemplateId('');
      setShowTicketDetails(true);
    } catch (err: any) {
      alert(err.message || 'Failed to load ticket details');
    } finally {
      setLoading(false);
    }
  };

  const submitServiceFeedback = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!feedbackTicket) return;
    try {
      setLoading(true);
      await apiClient.post(`/service/tickets/${feedbackTicket.id}/feedback`, {
        ...feedbackForm,
        overall_rating: Number(feedbackForm.overall_rating),
        technician_rating: feedbackForm.technician_rating ? Number(feedbackForm.technician_rating) : null,
        response_time_rating: feedbackForm.response_time_rating ? Number(feedbackForm.response_time_rating) : null,
        quality_rating: feedbackForm.quality_rating ? Number(feedbackForm.quality_rating) : null,
        would_recommend: feedbackForm.would_recommend === '' ? null : feedbackForm.would_recommend === 'YES',
      });
      const refreshed = await apiClient.get<ServiceTicket>(`/service/tickets/${feedbackTicket.id}`);
      setSelectedTicket((current) => current?.id === refreshed.id ? refreshed : current);
      setFeedbackTicket(null);
      setFeedbackForm({ overall_rating: '5', technician_rating: '', response_time_rating: '', quality_rating: '', feedback_text: '', suggestions: '', would_recommend: '' });
      await fetchTickets();
    } catch (err: any) {
      alert(err.message || 'Customer satisfaction feedback could not be saved');
    } finally {
      setLoading(false);
    }
  };

  const progressAssignment = async (assignmentId: string, status: 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED') => {
    if (!selectedTicket) return;
    try {
      setLoading(true);
      const now = new Date().toISOString();
      await apiClient.put(`/service/assignments/${assignmentId}`, {
        status,
        ...(status === 'IN_PROGRESS' ? { actual_start_date: now } : {}),
        ...(status === 'COMPLETED' ? { actual_end_date: now } : {}),
      });
      setSelectedTicket(await apiClient.get<ServiceTicket>(`/service/tickets/${selectedTicket.id}`));
      await fetchTickets();
    } catch (err: any) {
      alert(err.message || 'Failed to progress technician assignment');
    } finally {
      setLoading(false);
    }
  };

  const uploadServiceFiles = async (files: File[]) => {
    if (!files.length) return [] as string[];
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('accessToken') : null;
    const response = await fetch('/api/v1/service/uploads', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
    if (!response.ok) throw new Error((await response.text()) || `Evidence upload failed (${response.status})`);
    const payload = await response.json();
    return Array.isArray(payload?.urls) ? payload.urls : [];
  };

  const captureVisitCoordinates = () => new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });

  const openSiteVisit = (ticket: ServiceTicket) => {
    const visits = ticket.site_visits || [];
    const openVisit = visits.find((visit) => visit.status === 'CHECKED_IN') || null;
    const assignments = (ticket.assignments || []).filter((assignment) => ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(assignment.status));
    if (!openVisit && !assignments.length) {
      alert('Assign an active technician before starting a site visit.');
      return;
    }
    setVisitTicket(ticket);
    setActiveVisit(openVisit);
    setVisitFiles([]);
    setVisitSignatureFile(null);
    setVisitForm({
      service_assignment_id: openVisit?.assignment?.id || assignments[0]?.id || '',
      purpose: '',
      site_contact_name: openVisit?.site_contact_name || ticket.reported_by || ticket.customer?.contact_person || '',
      site_contact_designation: openVisit?.site_contact_designation || '',
      site_contact_mobile: openVisit?.site_contact_mobile || ticket.contact_number || ticket.customer?.mobile || ticket.customer?.phone || '',
      site_contact_email: openVisit?.site_contact_email || ticket.email || ticket.customer?.email || '',
      location: openVisit?.check_in_location || ticket.service_location || ticket.location || '',
      work_notes: '', customer_acknowledgement_name: '', customer_signature_designation: '', signature_declined_reason: '', complete_assignment: false,
    });
  };

  const submitSiteVisit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!visitTicket) return;
    try {
      setLoading(true);
      const [attachments, signatureAttachments, coordinates] = await Promise.all([
        uploadServiceFiles(visitFiles),
        visitSignatureFile ? uploadServiceFiles([visitSignatureFile]) : Promise.resolve([]),
        captureVisitCoordinates(),
      ]);
      if (activeVisit) {
        await apiClient.put(`/service/visits/${activeVisit.id}/check-out`, {
          work_notes: visitForm.work_notes,
          customer_acknowledgement_name: visitForm.customer_acknowledgement_name,
          customer_signature_designation: visitForm.customer_signature_designation,
          customer_signature_url: signatureAttachments[0] || null,
          signature_declined_reason: visitForm.signature_declined_reason || null,
          check_out_location: visitForm.location,
          check_out_lat: coordinates?.lat,
          check_out_lng: coordinates?.lng,
          after_attachments: attachments,
          complete_assignment: visitForm.complete_assignment,
        });
      } else {
        await apiClient.post(`/service/tickets/${visitTicket.id}/visits/check-in`, {
          service_assignment_id: visitForm.service_assignment_id,
          purpose: visitForm.purpose,
          site_contact_name: visitForm.site_contact_name,
          site_contact_designation: visitForm.site_contact_designation,
          site_contact_mobile: visitForm.site_contact_mobile,
          site_contact_email: visitForm.site_contact_email,
          check_in_location: visitForm.location,
          check_in_lat: coordinates?.lat,
          check_in_lng: coordinates?.lng,
          before_attachments: attachments,
        });
      }
      const refreshed = await apiClient.get<ServiceTicket>(`/service/tickets/${visitTicket.id}`);
      setSelectedTicket((current) => current?.id === refreshed.id ? refreshed : current);
      setVisitTicket(null);
      setActiveVisit(null);
      setVisitFiles([]);
      setVisitSignatureFile(null);
      await fetchTickets();
      alert(activeVisit ? 'Site visit checked out and customer acknowledgement recorded.' : 'Site visit checked in successfully.');
    } catch (err: any) {
      alert(err?.message || 'Site visit could not be recorded');
    } finally {
      setLoading(false);
    }
  };

  const openAssignment = async (ticket: ServiceTicket) => {
    if (!technicians.length) await fetchTechnicians();
    setAssignmentTicket(ticket);
    setAssignmentForm({ technician_id: '', scheduled_start_at: '', scheduled_end_at: '', required_skills: '', service_territory: ticket.service_location || '', override_reason: '' });
  };

  const openServiceConfirmation = async (ticket: ServiceTicket) => {
    if (ticket.commercial_approval_required && ticket.commercial_approval_status !== 'APPROVED') {
      alert('Approve the chargeable service estimate before confirming work.');
      return;
    }
    try {
      const [parts, estimates] = await Promise.all([
        apiClient.get<any[]>(`/service/parts/ticket/${ticket.id}`),
        ticket.commercial_approval_required
          ? apiClient.get<ServiceEstimate[]>(`/service/tickets/${ticket.id}/estimates`)
          : Promise.resolve([] as ServiceEstimate[]),
      ]);
      setConfirmationBillablePartsAmount((parts || [])
        .filter((part) => part.charged_to_customer)
        .reduce((sum, part) => sum + Number(part.total_cost || 0), 0));
      const approvedEstimate = (estimates || []).find((estimate) => estimate.id === ticket.approved_estimate_id && estimate.status === 'APPROVED');
      setConfirmationApprovedEstimateAmount(Number(approvedEstimate?.total_amount || 0));
      setConfirmationVarianceFile(null);
      setConfirmationForm((current) => ({ ...current, variance_reason: '', variance_approval_reference: '' }));
      setConfirmationTicket(ticket);
    } catch (err: any) {
      alert(err.message || 'Failed to load service-part charges');
    }
  };

  const openServiceEstimate = async (ticket: ServiceTicket) => {
    try {
      setLoading(true);
      const estimates = await apiClient.get<ServiceEstimate[]>(`/service/tickets/${ticket.id}/estimates`);
      setServiceEstimates(estimates || []);
      setEstimateTicket(ticket);
      setRevisingEstimateId(null);
      setEstimateForm({
        estimate_date: getTodayDateInputValue(), valid_until: '', tax_percentage: String(regionalProfile.defaultTaxRate), terms_and_conditions: '',
        items: [{ description: ticket.complaint_description || 'Service labour and charges', quantity: '1', uom: 'JOB', unit_price: '', discount_percent: '0' }],
      });
    } catch (err: any) { alert(err.message || 'Service estimates could not be loaded'); }
    finally { setLoading(false); }
  };

  const submitServiceEstimate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!estimateTicket) return;
    try {
      setLoading(true);
      const payload = {
        ...estimateForm,
        tax_percentage: Number(estimateForm.tax_percentage || 0),
        items: estimateForm.items.map((row) => ({ ...row, quantity: Number(row.quantity), unit_price: Number(row.unit_price), discount_percent: Number(row.discount_percent || 0) })),
      };
      await apiClient.post(
        revisingEstimateId ? `/service/estimates/${revisingEstimateId}/revise` : `/service/tickets/${estimateTicket.id}/estimates`,
        payload,
      );
      const [estimates, refreshed] = await Promise.all([
        apiClient.get<ServiceEstimate[]>(`/service/tickets/${estimateTicket.id}/estimates`),
        apiClient.get<ServiceTicket>(`/service/tickets/${estimateTicket.id}`),
      ]);
      setServiceEstimates(estimates || []);
      setEstimateTicket(refreshed);
      setRevisingEstimateId(null);
      await fetchTickets();
    } catch (err: any) { alert(err.message || `Service estimate could not be ${revisingEstimateId ? 'revised' : 'created'}`); }
    finally { setLoading(false); }
  };

  const startServiceEstimateRevision = (estimate: ServiceEstimate) => {
    setRevisingEstimateId(estimate.id);
    setEstimateForm({
      estimate_date: getTodayDateInputValue(),
      valid_until: estimate.valid_until ? String(estimate.valid_until).slice(0, 10) : '',
      tax_percentage: String(estimate.tax_percentage ?? regionalProfile.defaultTaxRate),
      terms_and_conditions: estimate.terms_and_conditions || '',
      items: (estimate.items || []).map((row) => ({
        description: row.description || '',
        quantity: String(row.quantity ?? 1),
        uom: row.uom || 'NOS',
        unit_price: String(row.unit_price ?? ''),
        discount_percent: String(row.discount_percent ?? 0),
      })),
    });
  };

  const emailServiceEstimate = async (estimate: ServiceEstimate) => {
    const recipient = window.prompt('Send service estimate to email:', estimateTicket?.email || '')?.trim();
    if (!recipient) return;
    try {
      const result = await apiClient.post<any>(`/service/estimates/${estimate.id}/send-email`, { to: recipient });
      alert(result.message || `Service estimate ${estimate.estimate_number} emailed successfully.`);
      if (estimateTicket) setServiceEstimates(await apiClient.get<ServiceEstimate[]>(`/service/tickets/${estimateTicket.id}/estimates`));
    } catch (err: any) {
      alert(err?.message || 'Service estimate email could not be sent');
    }
  };

  const openEstimateFollowUp = (estimate: ServiceEstimate) => {
    setEstimateFollowUp(estimate);
    setEstimateFollowUpForm({ to: estimateTicket?.email || '', notes: '', next_follow_up_date: '', send_email: true });
  };

  const submitEstimateFollowUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!estimateFollowUp || !estimateTicket) return;
    try {
      setLoading(true);
      if (estimateFollowUpForm.send_email) {
        await apiClient.post(`/service/estimates/${estimateFollowUp.id}/send-email`, {
          to: estimateFollowUpForm.to,
          event_type: 'REMINDER_SENT',
          notes: estimateFollowUpForm.notes,
          next_follow_up_date: estimateFollowUpForm.next_follow_up_date || null,
        });
      } else {
        await apiClient.post(`/service/estimates/${estimateFollowUp.id}/customer-comment`, {
          notes: estimateFollowUpForm.notes,
          next_follow_up_date: estimateFollowUpForm.next_follow_up_date || null,
        });
      }
      setServiceEstimates(await apiClient.get<ServiceEstimate[]>(`/service/tickets/${estimateTicket.id}/estimates`));
      setEstimateFollowUp(null);
      alert(estimateFollowUpForm.send_email ? 'Estimate reminder emailed and logged.' : 'Customer follow-up note logged.');
    } catch (err: any) {
      alert(err?.message || 'Estimate follow-up could not be recorded');
    } finally {
      setLoading(false);
    }
  };

  const printServiceEstimate = async (estimate: ServiceEstimate) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write('<!doctype html><html><body style="font-family:Arial;padding:20px">Preparing service estimate...</body></html>'); printWindow.document.close(); }
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const money = (value: unknown) => formatRegionalCurrency(Number(value || 0), regionalProfile);
      const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString(regionalProfile.locale) : '-';
      const rows = (estimate.items || []).map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.description)}</td><td class="num">${Number(item.quantity || 0).toLocaleString('en-IN')} ${escapeHtml(item.uom)}</td><td class="num">${money(item.unit_price)}</td><td class="num">${Number(item.discount_percent || 0)}%</td><td class="num">${money(item.line_total ?? (Number(item.quantity || 0) * Number(item.unit_price || 0) * (1 - Number(item.discount_percent || 0) / 100)))}</td></tr>`).join('');
      const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(estimate.estimate_number)}</title><style>@page{margin:.6cm}body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:20px;font-size:11px}h1{text-align:center;font-size:20px;margin:20px 0}.meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db}.meta>div{padding:9px;border-bottom:1px solid #e5e7eb}.meta>div:nth-child(odd){border-right:1px solid #e5e7eb}.label{font-size:9px;text-transform:uppercase;color:#6b7280}.value{font-weight:700;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d1d5db;padding:8px}th{background:#f3f4f6;text-align:left}.num{text-align:right}.total{font-size:13px;font-weight:800}.terms{margin-top:18px;border:1px solid #d1d5db;padding:12px;white-space:pre-wrap}.sign{display:flex;justify-content:space-between;margin-top:55px}.sign span{width:220px;border-top:1px solid #111;padding-top:6px}</style></head><body>${renderStandardLetterheadHtml(branding, new Date().toLocaleDateString(regionalProfile.locale))}<h1>SERVICE ESTIMATE</h1><div class="meta"><div><div class="label">Estimate No.</div><div class="value">${escapeHtml(estimate.estimate_number)}</div></div><div><div class="label">Revision</div><div class="value">R${Number(estimate.revision_no || 0)}</div></div><div><div class="label">Customer</div><div class="value">${escapeHtml(estimateTicket?.customer?.customer_name || '-')}</div></div><div><div class="label">Service Ticket</div><div class="value">${escapeHtml(estimateTicket?.ticket_number || '-')}</div></div><div><div class="label">Estimate Date</div><div class="value">${date(estimate.estimate_date)}</div></div><div><div class="label">Valid Until</div><div class="value">${date(estimate.valid_until)}</div></div></div><table><thead><tr><th>No.</th><th>Description</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Discount</th><th class="num">Amount</th></tr></thead><tbody>${rows}<tr><td colspan="5">Taxable Value</td><td class="num">${money(estimate.subtotal)}</td></tr><tr><td colspan="5">GST (${Number(estimate.tax_percentage || 0)}%)</td><td class="num">${money(estimate.tax_amount)}</td></tr><tr class="total"><td colspan="5">Estimate Total</td><td class="num">${money(estimate.total_amount)}</td></tr></tbody></table>${estimate.terms_and_conditions ? `<div class="terms"><strong>Terms &amp; Conditions</strong><br>${escapeHtml(estimate.terms_and_conditions)}</div>` : ''}<div class="sign"><span>Customer Acceptance</span><span>Authorized Signatory</span></div><script>window.onload=function(){window.focus();window.print();}</script></body></html>`;
      if (!printWindow) throw new Error('Allow popups to print or save this service estimate as PDF.');
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close(); printWindow.opener = null;
    } catch (err: any) { if (printWindow) printWindow.close(); alert(err?.message || 'Failed to prepare service estimate'); }
  };

  const downloadServiceEstimatePdf = async (estimate: ServiceEstimate) => {
    try {
      const blob = await apiClient.getBlob(`/service/estimates/${estimate.id}/pdf`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${estimate.estimate_number || 'service-estimate'}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err: any) {
      alert(err?.message || 'Failed to download service estimate PDF');
    }
  };

  const decideServiceEstimate = async (estimate: ServiceEstimate, decision: 'APPROVE' | 'REJECT') => {
    setEstimateDecision({ estimate, decision });
    setEstimateDecisionForm({ customer_comments: '', approval_reference: '' });
    setEstimateDecisionFile(null);
  };

  const submitServiceEstimateDecision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!estimateDecision) return;
    const submittedApprovalReference = String(
      new FormData(event.currentTarget as HTMLFormElement).get('approval_reference') || '',
    ).trim();
    try {
      setLoading(true);
      let approval_attachment_url = '';
      if (estimateDecisionFile) {
        const formData = new FormData();
        formData.append('files', estimateDecisionFile);
        const token = typeof window !== 'undefined' ? window.localStorage.getItem('accessToken') : null;
        const response = await fetch('/api/v1/service/uploads', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: formData });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message || `Authorization document upload failed (HTTP ${response.status})`);
        }
        const uploaded = await response.json();
        approval_attachment_url = uploaded?.urls?.[0] || '';
      }
      await apiClient.post(`/service/estimates/${estimateDecision.estimate.id}/decision`, {
        decision: estimateDecision.decision,
        customer_comments: estimateDecisionForm.customer_comments,
        approval_reference: submittedApprovalReference,
        approval_attachment_url,
      });
      if (estimateTicket) {
        const [estimates, refreshed] = await Promise.all([
          apiClient.get<ServiceEstimate[]>(`/service/tickets/${estimateTicket.id}/estimates`),
          apiClient.get<ServiceTicket>(`/service/tickets/${estimateTicket.id}`),
        ]);
        setServiceEstimates(estimates || []);
        setEstimateTicket(refreshed);
      }
      await fetchTickets();
      setEstimateDecision(null);
      alert(`Customer ${estimateDecision.decision === 'APPROVE' ? 'approval' : 'rejection'} recorded with audit evidence.`);
    } catch (err: any) { alert(err.message || 'Estimate decision could not be recorded'); }
    finally { setLoading(false); }
  };

  const handleAssignTechnician = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assignmentTicket) return;
    try {
      await apiClient.post('/service/assignments', {
        service_ticket_id: assignmentTicket.id,
        technician_id: assignmentForm.technician_id,
        scheduled_start_at: assignmentForm.scheduled_start_at || null,
        scheduled_end_at: assignmentForm.scheduled_end_at || null,
        required_skills: assignmentForm.required_skills,
        service_territory: assignmentForm.service_territory,
        override_reason: assignmentForm.override_reason,
      });
      alert(`Technician assigned to ${assignmentTicket.ticket_number}.`);
      setAssignmentTicket(null);
      await fetchTickets();
    } catch (err: any) { alert(err.message || 'Failed to assign technician'); }
  };

  const handleAddServicePart = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!partTicket) return;
    const item = items.find((entry) => entry.id === partForm.part_id);
    if (!item) { alert('Select a replacement part.'); return; }
    const requestedQuantity = Number(partForm.quantity);
    if (!(requestedQuantity > 0)) { setPartError('Quantity must be greater than zero.'); return; }
    if (partStockAvailable !== null && requestedQuantity > partStockAvailable + 1e-9) {
      setPartError(`Only ${partStockAvailable.toLocaleString('en-IN')} is available in the selected warehouse.`);
      return;
    }
    setPartSubmitting(true);
    setPartError(null);
    try {
      const result = await apiClient.post<any>('/service/parts', {
        service_ticket_id: partTicket.id,
        part_id: item.id,
        part_code: item.code,
        part_name: item.name,
        warehouse_id: partForm.warehouse_id,
        quantity: requestedQuantity,
        unit_price: Number(partForm.unit_price),
        charged_to_customer: partForm.charged_to_customer,
        old_part_uid: partForm.old_part_uid.trim() || null,
        old_part_condition: partForm.old_part_condition || null,
        new_part_uid: partForm.new_part_uid.trim() || null,
        replacement_warranty_start: partForm.replacement_warranty_start,
        replacement_warranty_months: Number(partForm.replacement_warranty_months),
        return_required: partForm.return_required,
        notes: partForm.notes,
      });
      alert(`Part issued on ${result.stock_movement_number} for ${partTicket.ticket_number}.`);
      setPartTicket(null);
      setPartForm({ ...emptyPartForm, warehouse_id: warehouses[0]?.id || '' });
      await fetchTickets();
    } catch (err: any) { setPartError(err.message || 'Failed to issue service part'); }
    finally { setPartSubmitting(false); }
  };

  const handleCreateConfirmation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmationTicket) return;
    try {
      setLoading(true);
      let variance_approval_attachment_url = '';
      if (confirmationVarianceFile) {
        const formData = new FormData();
        formData.append('files', confirmationVarianceFile);
        const token = typeof window !== 'undefined' ? window.localStorage.getItem('accessToken') : null;
        const response = await fetch('/api/v1/service/uploads', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: formData });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message || `Change authorization upload failed (HTTP ${response.status})`);
        }
        const uploaded = await response.json();
        variance_approval_attachment_url = uploaded?.urls?.[0] || '';
      }
      await apiClient.post(`/service/tickets/${confirmationTicket.id}/confirmations`, {
        ...confirmationForm,
        labor_hours: Number(confirmationForm.labor_hours || 0), labor_rate: Number(confirmationForm.labor_rate || 0),
        travel_cost: Number(confirmationForm.travel_cost || 0), other_amount: Number(confirmationForm.other_amount || 0),
        tax_percentage: Number(confirmationForm.tax_percentage || 0),
        variance_approval_attachment_url,
      });
      alert(`Service work confirmed for ${confirmationTicket.ticket_number}.`);
      setConfirmationTicket(null);
      setConfirmationBillablePartsAmount(0);
      setConfirmationApprovedEstimateAmount(0);
      setConfirmationVarianceFile(null);
      setConfirmationForm({ confirmation_date: getTodayDateInputValue(), work_performed: '', technician_remarks: '', failure_code_id: '', failure_category: '', root_cause: '', corrective_action: '', preventive_action: '', labor_hours: '', labor_rate: '', travel_cost: '', other_amount: '', tax_percentage: String(regionalProfile.defaultTaxRate), customer_signoff_name: '', is_final: true, variance_reason: '', variance_approval_reference: '' });
      await fetchTickets();
    } catch (err: any) { alert(err.message || 'Failed to confirm service work'); }
    finally { setLoading(false); }
  };

  const openServiceBillingRelease = (confirmation: any) => {
    const invoiceDate = getTodayDateInputValue();
    setBillingReleaseConfirmation(confirmation);
    setBillingReleaseForm({ invoice_date: invoiceDate, due_date: addCalendarDays(invoiceDate, 30), notes: '' });
  };

  const releaseServiceInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!billingReleaseConfirmation) return;
    try {
      setLoading(true);
      const invoice = await apiClient.post<CustomerServiceInvoice>(`/service/confirmations/${billingReleaseConfirmation.id}/create-invoice`, billingReleaseForm);
      alert(`Service invoice ${invoice.invoice_number} created.`);
      setBillingReleaseConfirmation(null);
      if (documentFlow?.ticket) await openDocumentFlow(documentFlow.ticket);
    } catch (err: any) { alert(err.message || 'Failed to create service invoice'); }
    finally { setLoading(false); }
  };

  const handleServiceReceipt = async (event: React.FormEvent) => {
    event.preventDefault(); if (!serviceReceiptInvoice) return;
    const amount = Number(serviceReceiptForm.amount);
    if (!(amount > 0) || amount > Number(serviceReceiptInvoice.balance_amount || 0)) { alert('Enter a valid amount within the outstanding balance.'); return; }
    try {
      await apiClient.post(`/service/customer-invoices/${serviceReceiptInvoice.id}/payments`, { ...serviceReceiptForm, amount });
      setServiceReceiptInvoice(null); await fetchServiceInvoices();
    } catch (err: any) { alert(err.message || 'Failed to record service receipt'); }
  };

  const handleServiceCollectionFollowUp = async (event: React.FormEvent) => {
    event.preventDefault(); if (!serviceCollectionInvoice) return;
    try {
      await apiClient.post(`/service/customer-invoices/${serviceCollectionInvoice.id}/collection-action`, serviceCollectionForm);
      setServiceCollectionInvoice(null);
      setServiceCollectionForm({ collection_status: 'CONTACTED', next_follow_up_date: '', promise_to_pay_date: '', notes: '' });
      await fetchServiceInvoices();
    } catch (err: any) { alert(err.message || 'Failed to save collection follow-up'); }
  };

  const cancelServiceInvoice = async (invoice: CustomerServiceInvoice) => {
    const reason = window.prompt(`Reason for cancelling ${invoice.invoice_number}:`)?.trim();
    if (!reason) return;
    try { await apiClient.post(`/service/customer-invoices/${invoice.id}/cancel`, { reason }); await fetchServiceInvoices(); }
    catch (err: any) { alert(err.message || 'Failed to cancel service invoice'); }
  };

  const reverseServiceReceipt = async (invoice: any, payment: any) => {
    const reason = window.prompt(`Reason for reversing ${payment.receipt_number}:`)?.trim();
    if (!reason) return;
    try {
      await apiClient.post(`/service/customer-invoices/${invoice.id}/payments/${payment.id}/reverse`, { reason });
      if (documentFlow?.ticket) await openDocumentFlow(documentFlow.ticket);
      if (viewingServiceInvoice?.id === invoice.id) await openServiceInvoice(invoice);
      await fetchServiceInvoices();
    } catch (err: any) { alert(err.message || 'Failed to reverse service receipt'); }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Remove product_id and clean up empty date fields before sending
      const { product_id, ...ticketData } = ticketForm;
      
      // Convert empty string dates to null for PostgreSQL
      const cleanedData = {
        ...ticketData,
        expected_completion_date: ticketData.expected_completion_date || null,
      };
      
      
      // If there are files, upload them first
      let attachmentUrls: string[] = [];
      if (uploadedFiles.length > 0) {
        const formData = new FormData();
        uploadedFiles.forEach(file => {
          formData.append('files', file);
        });
        
        try {
          const token =
            typeof window !== 'undefined'
              ? window.localStorage.getItem('accessToken')
              : null;

          const uploadResponse = await fetch('/api/v1/service/uploads', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: formData,
          });
          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Upload failed (${uploadResponse.status}): ${errorText || uploadResponse.statusText}`);
          }
          const uploadResult = await uploadResponse.json();
          attachmentUrls = uploadResult?.urls || [];
        } catch (uploadError) {
          alert('Warning: File upload failed. Ticket will be created without attachments.');
        }
      }
      
      // Create ticket with attachment URLs
      const ticketDataWithAttachments = {
        ...cleanedData,
        attachments: attachmentUrls,
      };
      
      const response = await apiClient.post('/service/tickets', ticketDataWithAttachments);
      setShowTicketForm(false);
      setTicketForm({
        customer_id: '',
        uid: '',
        ship_name: '',
        location: '',
        complaint_description: '',
        reported_by: '',
        contact_number: '',
        email: '',
        product_id: '',
        product_name: '',
        model_number: '',
        service_location: '',
        priority: 'MEDIUM',
        expected_completion_date: '',
        installed_asset_id: '',
        service_contract_id: '',
      });
      setUploadedFiles([]);
      setUploadPreviews([]);
      setShipNameInput('');
      fetchTickets();
      fetchShipNames(); // Refresh ship names list
    } catch (err: any) {
      setError(err.message || 'Failed to create service ticket');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTechnician = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTechnicianFormError(null);
    try {
      await apiClient.post('/service/technicians', technicianForm);
      setShowTechnicianForm(false);
      setTechnicianForm({
        employee_id: '',
        technician_name: '',
        specialization: '',
        contact_number: '',
        email: '',
        daily_capacity_hours: '8',
        skills: '', territories: '', base_location: '', shift_start: '09:00', shift_end: '18:00', working_days: [1, 2, 3, 4, 5, 6],
        is_active: true,
      });
      fetchTechnicians();
    } catch (err: any) {
      setTechnicianFormError(err.message || 'Failed to create technician');
    } finally {
      setLoading(false);
    }
  };

  const openTechnicianForm = async () => {
    setError(null);
    setTechnicianFormError(null);
    setTechnicianForm({ employee_id: '', technician_name: '', specialization: '', contact_number: '', email: '', daily_capacity_hours: '8', skills: '', territories: '', base_location: '', shift_start: '09:00', shift_end: '18:00', working_days: [1, 2, 3, 4, 5, 6], is_active: true });
    setShowTechnicianForm(true);
    setLoadingTechnicianEmployees(true);
    try {
      const response = await apiClient.get<any>('/service/technicians/eligible-employees');
      setTechnicianEmployees(Array.isArray(response) ? response : response?.data || []);
    } catch (err: any) {
      setTechnicianEmployees([]);
      setTechnicianFormError(err.message || 'Unable to load eligible technician employees. You can still add a technician manually.');
    } finally {
      setLoadingTechnicianEmployees(false);
    }
  };

  const openTechnicianCalendar = async (technician: Technician) => {
    try {
      setLoading(true);
      const from = getTodayDateInputValue();
      const to = addCalendarDays(from, 30);
      const calendar = await apiClient.get<any>(`/service/technicians/${technician.id}/calendar?from=${from}&to=${to}`);
      setTechnicianCalendar(calendar);
      setUnavailabilityForm({ starts_at: '', ends_at: '', reason: 'LEAVE', notes: '' });
    } catch (err: any) { alert(err.message || 'Technician calendar could not be loaded'); }
    finally { setLoading(false); }
  };

  const saveTechnicianUnavailability = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!technicianCalendar?.technician?.id) return;
    try {
      setLoading(true);
      await apiClient.post(`/service/technicians/${technicianCalendar.technician.id}/unavailability`, unavailabilityForm);
      await openTechnicianCalendar(technicianCalendar.technician);
    } catch (err: any) { alert(err.message || 'Availability block could not be saved'); }
    finally { setLoading(false); }
  };

  const selectTechnicianEmployee = (employeeId: string) => {
    const employee = technicianEmployees.find((candidate) => candidate.id === employeeId);
    setTechnicianForm((current) => ({
      ...current,
      employee_id: employeeId,
      technician_name: employee?.employee_name || '',
      contact_number: employee?.contact_number || '',
      email: employee?.email || '',
    }));
    setTechnicianFormError(null);
  };

  const handleWarrantyCheck = async () => {
    if (!warrantyUID.trim()) {
      setError('Please enter a UID');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<WarrantyValidation>(`/service/warranty/validate/${warrantyUID}`);
      setWarrantyResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to validate warranty');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: 'bg-yellow-100 text-yellow-800',
      ASSIGNED: 'bg-blue-100 text-blue-800',
      IN_PROGRESS: 'bg-purple-100 text-purple-800',
      PARTS_PENDING: 'bg-orange-100 text-orange-800',
      COMPLETED: 'bg-green-100 text-green-800',
      CLOSED: 'bg-gray-100 text-gray-800',
      CANCELLED: 'bg-red-100 text-red-800',
      ACTIVE: 'bg-green-100 text-green-800',
      INACTIVE: 'bg-gray-100 text-gray-800',
      DRAFT: 'bg-blue-100 text-blue-800',
      EXPIRED: 'bg-orange-100 text-orange-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      LOW: 'bg-blue-100 text-blue-800',
      MEDIUM: 'bg-yellow-100 text-yellow-800',
      HIGH: 'bg-orange-100 text-orange-800',
      CRITICAL: 'bg-red-100 text-red-800',
    };
    return colors[priority] || 'bg-gray-100 text-gray-800';
  };

  const router = useRouter();

  // Pagination and sorting helpers
  const getPaginatedAndSortedData = <T extends Record<string, any>>(data: T[], sortKey: keyof T = 'created_at' as keyof T) => {
    const normalizedSearch = registerSearch.trim().toLowerCase();
    const filteredData = data.filter((record) => {
      const searchable = JSON.stringify(record).toLowerCase();
      const recordStatus = String(record.maintenance_status ?? record.status ?? record.payment_status ?? record.billing_status ?? (record.is_active === true ? 'ACTIVE' : record.is_active === false ? 'INACTIVE' : '')).toUpperCase();
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
      
      const aNum = typeof aVal === 'number' ? aVal : new Date(aVal as string).getTime();
      const bNum = typeof bVal === 'number' ? bVal : new Date(bVal as string).getTime();
      
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    });
    
    // Paginate
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedData = sortedData.slice(startIndex, endIndex);
    const totalPages = Math.ceil(sortedData.length / itemsPerPage);
    
    return { paginatedData, totalPages, totalItems: sortedData.length };
  };

  const saveFailureCode = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setLoading(true); await apiClient.post('/service/failure-codes', failureCodeForm);
      setShowFailureCodeForm(false); setFailureCodeForm({ code: '', category: '', description: '', default_corrective_action: '', is_active: true });
      await fetchEnterpriseControls();
    } catch (err: any) { alert(err.message || 'Failure code could not be saved'); }
    finally { setLoading(false); }
  };

  const saveEscalation = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setLoading(true);
      await apiClient.post(`/service/tickets/${escalationForm.service_ticket_id}/escalations`, {
        escalation_level: Number(escalationForm.escalation_level), reason: escalationForm.reason,
        due_at: escalationForm.due_at ? new Date(escalationForm.due_at).toISOString() : null,
      });
      setShowEscalationForm(false); setEscalationForm({ service_ticket_id: '', escalation_level: '1', reason: '', due_at: '' });
      await fetchEnterpriseControls();
    } catch (err: any) { alert(err.message || 'Escalation could not be created'); }
    finally { setLoading(false); }
  };

  const resolveEscalation = async (escalation: ServiceEscalation) => {
    const notes = window.prompt('Enter the escalation resolution notes:');
    if (!notes?.trim()) return;
    try { await apiClient.put(`/service/escalations/${escalation.id}`, { status: 'RESOLVED', resolution_notes: notes }); await fetchEnterpriseControls(); }
    catch (err: any) { alert(err.message || 'Escalation could not be resolved'); }
  };

  const saveRmaOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setLoading(true); await apiClient.post('/service/rma-orders', rmaForm);
      setShowRmaForm(false); setRmaForm({ service_ticket_id: '', disposition: 'REPAIR', received_date: '', received_condition: '', repair_location: '', notes: '' });
      await fetchEnterpriseControls();
    } catch (err: any) { alert(err.message || 'RMA order could not be created'); }
    finally { setLoading(false); }
  };

  const advanceRma = async (rma: ServiceRmaOrder) => {
    const nextByStatus: Record<string, string> = { AWAITING_RECEIPT: 'RECEIVED', RECEIVED: 'UNDER_DIAGNOSIS', UNDER_DIAGNOSIS: 'UNDER_REPAIR', UNDER_REPAIR: 'READY_TO_RETURN', READY_TO_RETURN: 'RETURNED' };
    const next = nextByStatus[rma.status];
    if (!next) return;
    const payload: any = { status: next };
    if (next === 'RETURNED') {
      const courier = window.prompt('Enter courier / handover reference:');
      if (!courier?.trim()) return;
      payload.outbound_date = todayDate; payload.courier_reference = courier;
    }
    try { await apiClient.put(`/service/rma-orders/${rma.id}`, payload); await fetchEnterpriseControls(); }
    catch (err: any) { alert(err.message || 'RMA status could not be advanced'); }
  };

  const advancePartReturn = async (part: any) => {
    const nextByStatus: Record<string, string> = { EXPECTED: 'RECEIVED', RECEIVED: 'SENT_TO_VENDOR', SENT_TO_VENDOR: 'CREDIT_RECEIVED' };
    const next = nextByStatus[String(part.return_status || 'EXPECTED').toUpperCase()];
    if (!next) return;
    const returnReference = ['SENT_TO_VENDOR', 'CREDIT_RECEIVED'].includes(next)
      ? window.prompt(next === 'SENT_TO_VENDOR' ? 'Enter dispatch / RMA reference:' : 'Enter vendor credit-note reference:')
      : '';
    if (['SENT_TO_VENDOR', 'CREDIT_RECEIVED'].includes(next) && !returnReference?.trim()) return;
    try {
      await apiClient.put(`/service/parts/${part.id}/return`, { return_status: next, return_reference: returnReference || undefined });
      if (documentFlow?.ticket) await openDocumentFlow(documentFlow.ticket);
    } catch (err: any) { alert(err.message || 'Part return status could not be updated'); }
  };

  const createWarrantyRecovery = async () => {
    const eligibleTickets = tickets.filter((ticket) => ticket.is_under_warranty || String((ticket as any).entitlement_status || '').toUpperCase() === 'WARRANTY');
    if (!eligibleTickets.length) return alert('No warranty-covered service ticket is available.');
    const ticketNumber = window.prompt(`Enter warranty service ticket number:\n${eligibleTickets.slice(0, 12).map((ticket) => ticket.ticket_number).join(', ')}`);
    const ticket = eligibleTickets.find((row) => row.ticket_number.toUpperCase() === String(ticketNumber || '').trim().toUpperCase());
    if (!ticket) return;
    const claimedAmount = window.prompt('Enter recovery amount claimed from OEM / supplier:', '0');
    if (claimedAmount === null) return;
    try {
      await apiClient.post('/service/warranty-recovery-claims', { service_ticket_id: ticket.id, claim_type: 'PART', claimed_amount: Number(claimedAmount || 0) });
      await fetchEnterpriseControls();
    } catch (err: any) { alert(err.message || 'Warranty recovery claim could not be created'); }
  };

  const advanceWarrantyRecovery = async (claim: any) => {
    const nextByStatus: Record<string, string> = { DRAFT: 'SUBMITTED', SUBMITTED: 'UNDER_REVIEW', UNDER_REVIEW: 'APPROVED', APPROVED: 'SETTLED' };
    const next = nextByStatus[String(claim.status || '').toUpperCase()];
    if (!next) return;
    const payload: any = { status: next };
    if (next === 'APPROVED') payload.approved_amount = Number(window.prompt('Enter OEM-approved amount:', String(claim.claimed_amount || 0)) || 0);
    if (next === 'SETTLED') {
      payload.approved_amount = Number(claim.approved_amount || 0);
      payload.vendor_reference = window.prompt('Enter credit note / settlement reference:', claim.vendor_reference || '') || '';
      if (!payload.vendor_reference.trim()) return;
    }
    try { await apiClient.put(`/service/warranty-recovery-claims/${claim.id}`, payload); await fetchEnterpriseControls(); }
    catch (err: any) { alert(err.message || 'Warranty recovery status could not be updated'); }
  };

  const getSlaColor = (status?: string) => {
    const colors: Record<string, string> = {
      MET: 'bg-green-100 text-green-800', ON_TRACK: 'bg-blue-100 text-blue-800',
      PENDING: 'bg-amber-100 text-amber-800', BREACHED: 'bg-red-100 text-red-800',
      CANCELLED: 'bg-gray-100 text-gray-700', NOT_SET: 'bg-gray-100 text-gray-700',
    };
    return colors[status || 'NOT_SET'] || colors.NOT_SET;
  };

  const formatSlaDate = (value?: string) => value
    ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '-';

  const serviceSortKeys: Record<string, string> = {
    'ticket #': 'ticket_number', 'customer': 'customer_name', 'product/uid': 'product_name',
    'type': 'service_type', 'priority': 'priority', 'status': 'status', 'date': 'complaint_date',
    'warranty': 'is_under_warranty', 'code': 'technician_code', 'name': 'technician_name',
    'specialization': 'specialization', 'assignments': 'total_assignments', 'completed': 'completed_services',
    'rating': 'average_rating', 'invoice': 'invoice_number', 'ticket': 'ticket_number',
    'invoice value': 'net_amount', 'received': 'paid_amount', 'outstanding': 'balance_amount',
    'asset': 'asset_number', 'contract': 'contract_number', 'installed': 'installation_date',
    'validity': 'end_date', 'value': 'contract_value', 'sla': 'response_hours',
  };

  const handleRegisterHeaderClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const header = (event.target as HTMLElement).closest('th');
    if (!header) return;
    const label = (header.textContent || '').trim().toLowerCase();
    if (label === 'actions') return;
    const key = serviceSortKeys[label];
    if (!key) return;
    setSortDirection((current) => sortColumn === key ? (current === 'asc' ? 'desc' : 'asc') : 'asc');
    setSortColumn(key);
    setCurrentPage(1);
  };

  const activeRegisterData: Record<string, any[]> = { tickets, 'installed-base': installedAssets, contracts: serviceContracts, maintenance: maintenanceSchedules, technicians, billing: serviceInvoices };
  const registerStatuses = Array.from(new Set((activeRegisterData[activeTab] || []).map((record) =>
    String(record.maintenance_status ?? record.status ?? record.payment_status ?? record.billing_status ?? (record.is_active === true ? 'ACTIVE' : record.is_active === false ? 'INACTIVE' : '')).toUpperCase(),
  ).filter(Boolean))).sort();

  const renderPagination = (totalPages: number, totalItems: number) => {
    if (totalPages <= 1) return null;
    
    return (
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-3 bg-gray-50 border-t">
        <div className="text-sm text-gray-700">
          Showing {Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
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
                className={`px-3 py-1 border rounded ${currentPage === pageNum ? 'bg-amber-600 text-white' : 'hover:bg-gray-100'}`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="ml-2 px-2 py-1 border rounded"
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

  const confirmationIsWarranty = Boolean(confirmationTicket?.is_under_warranty)
    || String(confirmationTicket?.entitlement_status || '').toUpperCase() === 'WARRANTY'
    || String(confirmationTicket?.service_type || '').toUpperCase() === 'WARRANTY';
  const confirmationLaborAmount = confirmationIsWarranty
    ? 0
    : Number(confirmationForm.labor_hours || 0) * Number(confirmationForm.labor_rate || 0);
  const confirmationSubtotalPreview = confirmationLaborAmount
    + confirmationBillablePartsAmount
    + Number(confirmationForm.travel_cost || 0)
    + Number(confirmationForm.other_amount || 0);
  const confirmationTaxPreview = confirmationSubtotalPreview * Number(confirmationForm.tax_percentage || 0) / 100;
  const confirmationTotalPreview = confirmationSubtotalPreview + confirmationTaxPreview;
  const confirmationVariancePreview = confirmationTicket?.commercial_approval_required
    ? Math.max(0, confirmationTotalPreview - confirmationApprovedEstimateAmount)
    : 0;

  const dispatchRows = tickets.flatMap((ticket) => {
    const assignments = ticket.assignments || [];
    if (!assignments.length) return [{ ticket, assignment: null as ServiceAssignment | null, visit: null as ServiceSiteVisit | null }];
    return assignments.map((assignment) => {
      const visits = (ticket.site_visits || [])
        .filter((visit) => visit.service_assignment_id === assignment.id || visit.assignment?.id === assignment.id)
        .sort((a, b) => new Date(b.check_in_at).getTime() - new Date(a.check_in_at).getTime());
      return { ticket, assignment, visit: visits[0] || null };
    });
  });
  const filteredDispatchRows = dispatchRows.filter(({ ticket, assignment, visit }) => {
    const activeTicket = !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status);
    const rowStatus = visit?.status || assignment?.status || 'UNASSIGNED';
    const slaStatus = ticket.sla?.overall_status || 'NOT_SET';
    const workDate = (assignment?.scheduled_start_date || visit?.check_in_at || ticket.expected_completion_date || '').slice(0, 10);
    const searchText = [ticket.ticket_number, ticket.customer?.customer_name, ticket.product_name, ticket.uid,
      ticket.service_location, ticket.location, assignment?.technician?.technician_name, visit?.site_contact_name,
      visit?.site_contact_mobile, rowStatus].filter(Boolean).join(' ').toLowerCase();
    return (!dispatchDate || workDate === dispatchDate || !assignment)
      && (dispatchTechnician === 'ALL' || assignment?.technician?.id === dispatchTechnician || (!assignment && dispatchTechnician === 'UNASSIGNED'))
      && (dispatchStatus === 'ALL' || (dispatchStatus === 'ACTIVE' ? activeTicket : rowStatus === dispatchStatus))
      && (dispatchSlaFilter === 'ALL' || (dispatchSlaFilter === 'AT_RISK' && ['BREACHED', 'PENDING'].includes(slaStatus)) || slaStatus === dispatchSlaFilter)
      && (!dispatchSearch.trim() || searchText.includes(dispatchSearch.trim().toLowerCase()));
  }).sort((a, b) => {
    if (!a.assignment && b.assignment) return -1;
    if (a.assignment && !b.assignment) return 1;
    const priorityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const slaRank: Record<string, number> = { BREACHED: 0, PENDING: 1, NOT_SET: 2, MET: 3 };
    if (dispatchSort === 'priority') {
      const priorityDifference = (priorityRank[a.ticket.priority] ?? 4) - (priorityRank[b.ticket.priority] ?? 4);
      if (priorityDifference) return priorityDifference;
    } else if (dispatchSort === 'sla') {
      const slaDifference = (slaRank[a.ticket.sla?.overall_status || 'NOT_SET'] ?? 4) - (slaRank[b.ticket.sla?.overall_status || 'NOT_SET'] ?? 4);
      if (slaDifference) return slaDifference;
    } else if (dispatchSort === 'customer') {
      const customerDifference = String(a.ticket.customer?.customer_name || '').localeCompare(String(b.ticket.customer?.customer_name || ''));
      if (customerDifference) return customerDifference;
    } else {
      const schedule = String(a.assignment?.scheduled_start_date || a.ticket.expected_completion_date || '').localeCompare(String(b.assignment?.scheduled_start_date || b.ticket.expected_completion_date || ''));
      if (schedule) return schedule;
    }
    const priorityDifference = (priorityRank[a.ticket.priority] ?? 4) - (priorityRank[b.ticket.priority] ?? 4);
    if (priorityDifference) return priorityDifference;
    return String(a.assignment?.scheduled_start_date || a.ticket.expected_completion_date || '').localeCompare(String(b.assignment?.scheduled_start_date || b.ticket.expected_completion_date || ''));
  });
  const dispatchUnassigned = tickets.filter((ticket) => !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && !(ticket.assignments || []).length).length;
  const dispatchCheckedIn = dispatchRows.filter(({ visit }) => visit?.status === 'CHECKED_IN').length;
  const dispatchReportsReady = dispatchRows.filter(({ visit }) => visit?.status === 'COMPLETED'
    && Boolean(visit.customer_acknowledgement_name)
    && Boolean((visit.before_attachments || []).length || (visit.after_attachments || []).length)).length;
  const dispatchSlaAtRisk = tickets.filter((ticket) => !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status)
    && ['BREACHED', 'PENDING'].includes(ticket.sla?.overall_status || '')).length;

  return (
    <div id="service-management-root" onClickCapture={handleRegisterHeaderClick} className="min-h-screen bg-[#FAF9F6] p-6 text-[#2F241D]">
      <style jsx global>{`
        #service-management-root table > thead > tr > th:not(:last-child) { resize: horizontal; overflow: hidden; min-width: 92px; cursor: pointer; user-select: none; }
        #service-management-root table > thead > tr > th:not(:last-child):hover { background-color: #efe3cf; }
      `}</style>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Service & Warranty Management</h1>
        <p className="text-sm text-gray-600 mt-1">
          Manage service tickets, technicians, and warranty validations
        </p>
      </div>

      {['tickets', 'installed-base', 'contracts', 'maintenance', 'technicians', 'billing'].includes(activeTab) && (
        <div className="mb-4 grid gap-3 rounded-md border border-[#E8DCC4] bg-white p-3 md:grid-cols-[minmax(260px,1fr)_220px_auto]">
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
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm"><span><b>Current workspace:</b> {activeTab.replaceAll('-', ' ')}</span><span className="text-xs text-amber-800">Use the Service menu to switch workspaces.</span></div>

      {/* Service Tickets Tab */}
      {activeTab === 'tickets' && (
        <div>
          <div className="mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <h2 className="text-lg font-semibold">Service Tickets</h2>
            {canCreate && (
            <button
              onClick={() => setShowTicketForm(true)}
              className="w-full sm:w-auto px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-center"
            >
              + Create Ticket
            </button>
            )}
          </div>

          {loading ? (
            <p className="text-gray-600">Loading service tickets...</p>
          ) : (
            <>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product/UID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SLA</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Warranty</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(() => {
                    const { paginatedData, totalPages, totalItems } = getPaginatedAndSortedData(tickets, 'complaint_date');
                    return (
                      <>
                        {paginatedData.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {ticket.ticket_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {ticket.customer?.customer_name || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div>{ticket.product_name || '-'}</div>
                        {ticket.uid && <div className="text-xs font-mono text-gray-500">{ticket.uid}</div>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {ticket.service_type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getPriorityColor(ticket.priority)}`}>
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(ticket.status)}`}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getSlaColor(ticket.sla?.overall_status)}`}>
                          {(ticket.sla?.overall_status || 'NOT_SET').replaceAll('_', ' ')}
                        </span>
                        <div className="mt-1 text-[11px] text-gray-500">R: {ticket.sla?.response_status || '-'} / Fix: {ticket.sla?.resolution_status || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(ticket.complaint_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {ticket.is_under_warranty ? (
                          <span className="text-green-600">✓ Valid</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex space-x-2">
                          <button onClick={() => openTicketDetails(ticket)} className="text-blue-600 hover:text-blue-800" title="View Details">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          </button>
                          <button onClick={() => openDocumentFlow(ticket)} className="text-[#6F4E37] hover:text-[#3F2D20]" title="Document Trail">
                            <span className="text-xs font-semibold">Trail</span>
                          </button>
                          {canCreate && <button onClick={() => createCustomerTrackingLink(ticket)} className="text-teal-700 hover:text-teal-900" title="Create customer tracking link"><span className="text-xs font-semibold">Portal</span></button>}
                          {ticket.commercial_approval_required && (
                            <button onClick={() => openServiceEstimate(ticket)} className="text-cyan-700 hover:text-cyan-900" title="Service Estimate / Customer Approval">
                              <span className="text-xs font-semibold">Estimate</span>
                            </button>
                          )}
                          {canCreate && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && (
                            <button onClick={() => openAssignment(ticket)} className="text-indigo-700 hover:text-indigo-900" title="Assign Technician">
                              <span className="text-xs font-semibold">Assign</span>
                            </button>
                          )}
                          {canCreate && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && (
                            <button onClick={() => { setPartError(null); setPartStockAvailable(null); setPartTicket(ticket); }} className="text-purple-700 hover:text-purple-900" title="Issue Service Part">
                              <span className="text-xs font-semibold">Part</span>
                            </button>
                          )}
                          {canCreate && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && (
                            <button disabled={Boolean(ticket.commercial_approval_required && ticket.commercial_approval_status !== 'APPROVED')} onClick={() => openServiceConfirmation(ticket)} className="text-green-700 hover:text-green-900 disabled:cursor-not-allowed disabled:text-gray-300" title={ticket.commercial_approval_required && ticket.commercial_approval_status !== 'APPROVED' ? 'Customer estimate approval required' : 'Confirm Work'}>
                              <span className="text-xs font-semibold">Confirm</span>
                            </button>
                          )}
                          {canEdit && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && <button
                            onClick={() => {
                              setSelectedTicket(ticket);
                              setEditTicketForm({
                                priority: ticket.priority || 'MEDIUM',
                                expected_completion_date: (ticket as any).expected_completion_date || '',
                                ship_name: ticket.ship_name || '',
                                location: ticket.location || '',
                                service_location: (ticket as any).service_location || '',
                                product_name: ticket.product_name || '',
                                model_number: (ticket as any).model_number || '',
                                reported_by: ticket.reported_by || '',
                                contact_number: ticket.contact_number || '',
                                email: ticket.email || '',
                                complaint_description: ticket.complaint_description || '',
                              });
                              setShowEditTicketModal(true);
                            }}
                            className="text-amber-600 hover:text-amber-800"
                            title="Edit"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>}
                          {canEdit && (ticketStatusTransitions[ticket.status] || []).length > 0 && <button onClick={() => { setSelectedTicket(ticket); setShowStatusModal(true); }} className="text-amber-600 hover:text-amber-800" title="Update Status">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          </button>}
                          {ticket.status === 'OPEN' && canDelete && (
                            <button onClick={async () => { if (confirm('Delete this ticket?')) { try { await apiClient.delete(`/service/tickets/${ticket.id}`); fetchTickets(); } catch (err: any) { setError(err.message); } } }} className="text-red-600 hover:text-red-800" title="Delete">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
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
              
              {/* Mobile Card View */}
              <div className="md:hidden space-y-4 p-4">
                {(() => {
                  const { paginatedData } = getPaginatedAndSortedData(tickets, 'complaint_date');
                  return paginatedData.map((ticket) => (
                    <div key={ticket.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-semibold text-amber-600">{ticket.ticket_number}</span>
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(ticket.status)}`}>
                        {ticket.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-900 mb-1">{ticket.customer?.customer_name}</div>
                    <div className="text-xs text-gray-600 space-y-1">
                      {ticket.product_name && <div>📦 {ticket.product_name}</div>}
                      {ticket.uid && <div className="font-mono">🔖 {ticket.uid}</div>}
                      {ticket.ship_name && <div>🚢 {ticket.ship_name}</div>}
                      {ticket.location && <div>📍 {ticket.location}</div>}
                      <div>📅 {new Date(ticket.complaint_date).toLocaleDateString()}</div>
                      <div>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${getPriorityColor(ticket.priority)}`}>
                          {ticket.priority}
                        </span>
                      </div>
                      <div><span className={`px-2 py-0.5 rounded-full text-xs ${getSlaColor(ticket.sla?.overall_status)}`}>SLA {(ticket.sla?.overall_status || 'NOT SET').replaceAll('_', ' ')}</span></div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openTicketDetails(ticket)}
                        className="text-xs px-3 py-2 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                      >
                        View
                      </button>
                      <button
                        onClick={() => openDocumentFlow(ticket)}
                        className="text-xs px-3 py-2 bg-stone-50 text-stone-700 rounded hover:bg-stone-100"
                      >
                        Document Trail
                      </button>
                      {canCreate && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && <button
                        onClick={() => openAssignment(ticket)}
                        className="text-xs px-3 py-2 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100"
                      >
                        Assign Technician
                      </button>}
                      {canCreate && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && <button
                        onClick={() => { setPartError(null); setPartStockAvailable(null); setPartTicket(ticket); }}
                        className="text-xs px-3 py-2 bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                      >
                        Issue Part
                      </button>}
                      {canCreate && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && <button
                        onClick={() => openServiceConfirmation(ticket)}
                        className="text-xs px-3 py-2 bg-green-50 text-green-700 rounded hover:bg-green-100"
                      >
                        Confirm Work
                      </button>}
                      {canEdit && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status) && <button
                        onClick={() => {
                          setSelectedTicket(ticket);
                          setEditTicketForm({
                            priority: ticket.priority || 'MEDIUM',
                            expected_completion_date: (ticket as any).expected_completion_date || '',
                            ship_name: ticket.ship_name || '',
                            location: ticket.location || '',
                            service_location: (ticket as any).service_location || '',
                            product_name: ticket.product_name || '',
                            model_number: (ticket as any).model_number || '',
                            reported_by: ticket.reported_by || '',
                            contact_number: ticket.contact_number || '',
                            email: ticket.email || '',
                            complaint_description: ticket.complaint_description || '',
                          });
                          setShowEditTicketModal(true);
                        }}
                        className="text-xs px-3 py-2 bg-amber-50 text-amber-700 rounded hover:bg-amber-100"
                      >
                        Edit
                      </button>}
                      {canEdit && (ticketStatusTransitions[ticket.status] || []).length > 0 && <button
                        onClick={() => { setSelectedTicket(ticket); setShowStatusModal(true); }}
                        className="text-xs px-3 py-2 bg-amber-50 text-amber-700 rounded hover:bg-amber-100"
                      >
                        Update Status
                      </button>}
                    </div>
                  </div>
                ));
                })()}
              </div>
            </div>
            {(() => {
              const { totalPages, totalItems } = getPaginatedAndSortedData(tickets, 'complaint_date');
              return renderPagination(totalPages, totalItems);
            })()}
            </>
          )}

          {/* Ticket Form Modal */}
          {showTicketForm && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-4 md:p-6 max-w-2xl w-full max-h-[95vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg md:text-xl font-semibold">Create Service Ticket</h3>
                  <button onClick={() => setShowTicketForm(false)} className="text-gray-500 hover:text-gray-700">
                    ✕
                  </button>
                </div>
                <form onSubmit={handleCreateTicket}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Customer ID *</label>
                      <SearchableSelect
                        options={customers.map(c => ({ value: c.id, label: `${c.customer_code} - ${c.customer_name}` }))}
                        value={ticketForm.customer_id}
                        onChange={(value) => setTicketForm({ ...ticketForm, customer_id: value, installed_asset_id: '', service_contract_id: '' })}
                        placeholder="Select Customer"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Installed Asset</label>
                      <select value={ticketForm.installed_asset_id} onChange={(event) => {
                        const asset = installedAssets.find((entry) => entry.id === event.target.value);
                        setTicketForm({ ...ticketForm, installed_asset_id: event.target.value, uid: asset?.uid || ticketForm.uid, product_id: asset?.item_id || ticketForm.product_id, product_name: asset?.asset_name || ticketForm.product_name, service_location: asset?.location || ticketForm.service_location });
                      }} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                        <option value="">Unregistered / not selected</option>
                        {installedAssets.filter((asset) => asset.customer_id === ticketForm.customer_id && asset.status === 'ACTIVE').map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_number} - {asset.asset_name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Service Contract / Entitlement</label>
                      <select value={ticketForm.service_contract_id} onChange={(event) => setTicketForm({ ...ticketForm, service_contract_id: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                        <option value="">Chargeable / warranty lookup</option>
                        {serviceContracts.filter((contract) => contract.customer_id === ticketForm.customer_id && (contract.effective_status || contract.status) === 'ACTIVE').map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} - {contract.contract_type} ({contract.response_hours}h/{contract.resolution_hours}h)</option>)}
                      </select>
                    </div>

                    {/* NEW FIELDS */}
                    <div className="md:col-span-2 relative">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        🚢 Ship Name * 
                        {shipNameInput && !shipNames.includes(shipNameInput) && (
                          <span className="ml-2 text-xs text-amber-600">✨ New ship (will be saved)</span>
                        )}
                      </label>
                      <input
                        type="text"
                        required
                        value={shipNameInput}
                        onChange={(e) => handleShipNameChange(e.target.value)}
                        onFocus={() => {
                          updateShipNameSuggestions(shipNameInput);
                        }}
                        onBlur={() => setTimeout(() => setShowShipNameDropdown(false), 200)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                        placeholder="Enter or select vessel/ship name"
                      />
                      
                      {/* Autocomplete Dropdown */}
                      {showShipNameDropdown && filteredShipNames.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {filteredShipNames.map((name, index) => (
                            <div
                              key={index}
                              onClick={() => selectShipName(name)}
                              className="px-4 py-2 hover:bg-amber-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                            >
                              🚢 {name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">📍 Location *</label>
                      <input
                        type="text"
                        required
                        value={ticketForm.location}
                        onChange={(e) => setTicketForm({ ...ticketForm, location: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                        placeholder="Port, coordinates, or specific location"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                      <SearchableSelect
                        options={items.map(i => ({ value: i.id, label: i.code, subtitle: i.name }))}
                        value={ticketForm.product_id}
                        onChange={(value) => {
                          const selectedItem = items.find(i => i.id === value);
                          setTicketForm({ 
                            ...ticketForm, 
                            product_id: value,
                            product_name: selectedItem?.name || '' 
                          });
                          fetchAvailableUIDs(value);
                        }}
                        placeholder="Select Product"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Search by Product / Part No / UID</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={productLookupInput}
                          onChange={(e) => {
                            setProductLookupInput(e.target.value);
                            setShowProductLookupDropdown(true);
                          }}
                          onFocus={() => {
                            if (productLookupResults.length > 0) setShowProductLookupDropdown(true);
                          }}
                          onBlur={() => setTimeout(() => setShowProductLookupDropdown(false), 200)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                          placeholder="Type product name, part number, or UID"
                        />

                        {showProductLookupDropdown && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                            {productLookupLoading ? (
                              <div className="px-4 py-2 text-sm text-gray-500">Searching...</div>
                            ) : productLookupResults.length === 0 ? (
                              <div className="px-4 py-2 text-sm text-gray-500">No matches found</div>
                            ) : (
                              productLookupResults.map((d) => (
                                <div
                                  key={d.uid_id}
                                  onClick={() => selectDeployment(d)}
                                  className="px-4 py-2 hover:bg-amber-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                                >
                                  <div className="font-medium">
                                    {d.item_name || 'Unknown Product'}
                                    {d.item_code ? <span className="text-gray-500"> ({d.item_code})</span> : null}
                                  </div>
                                  <div className="text-xs text-gray-600 mt-0.5">
                                    <span className="font-mono">UID: {d.uid}</span>
                                    {d.client_part_number ? <span className="ml-2">Part: {d.client_part_number}</span> : null}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Use this when the customer shares a part number</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">UID</label>
                      <input
                        type="text"
                        value={selectedDeployment?.uid || ticketForm.uid}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono"
                        placeholder="Select from search above"
                        disabled
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Part Number</label>
                      <input
                        type="text"
                        value={selectedDeployment?.client_part_number || ''}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                        placeholder="Select from search above"
                        disabled
                      />
                      {selectedDeployment?.warranty_expiry_date ? (
                        <p className="text-xs text-gray-600 mt-1">
                          {getWarrantyStatusText(selectedDeployment.warranty_expiry_date)}
                        </p>
                      ) : selectedDeployment ? (
                        <p className="text-xs text-gray-500 mt-1">Warranty status not available</p>
                      ) : null}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Model Number</label>
                      <input
                        type="text"
                        value={ticketForm.model_number}
                        onChange={(e) => setTicketForm({ ...ticketForm, model_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reported By *</label>
                      <input
                        type="text"
                        required
                        value={ticketForm.reported_by}
                        onChange={(e) => setTicketForm({ ...ticketForm, reported_by: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number *</label>
                      <input
                        type="text"
                        required
                        value={ticketForm.contact_number}
                        onChange={(e) => setTicketForm({ ...ticketForm, contact_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={ticketForm.email}
                        onChange={(e) => setTicketForm({ ...ticketForm, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                      <select
                        value={ticketForm.priority}
                        onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Service Location</label>
                      <textarea
                        value={ticketForm.service_location}
                        onChange={(e) => setTicketForm({ ...ticketForm, service_location: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        rows={2}
                      />
                    </div>
                    <div className="col-span-2 md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Complaint Description *</label>
                      <textarea
                        required
                        value={ticketForm.complaint_description}
                        onChange={(e) => setTicketForm({ ...ticketForm, complaint_description: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                        rows={3}
                        placeholder="Describe the issue in detail"
                      />
                    </div>

                    {/* FILE UPLOAD SECTION */}
                    <div className="col-span-2 md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">📸 Photos & Videos</label>
                      <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-amber-400 transition">
                        <div className="space-y-1 text-center">
                          <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                            <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <div className="flex text-sm text-gray-600">
                            <label className="relative cursor-pointer bg-white rounded-md font-medium text-amber-600 hover:text-amber-500 focus-within:outline-none">
                              <span>Upload files</span>
                              <input
                                type="file"
                                multiple
                                accept="image/*,video/*"
                                onChange={handleFileUpload}
                                className="sr-only"
                              />
                            </label>
                            <p className="pl-1">or drag and drop</p>
                          </div>
                          <p className="text-xs text-gray-500">Photos or videos up to 50MB each</p>
                        </div>
                      </div>
                      
                      {/* File Previews */}
                      {uploadedFiles.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                          {uploadPreviews.map((preview, index) => (
                            <div key={index} className="relative group">
                              {uploadedFiles[index].type.startsWith('image/') ? (
                                <img src={preview} alt={`Preview ${index + 1}`} className="w-full h-24 object-cover rounded-lg" />
                              ) : (
                                <video src={preview} className="w-full h-24 object-cover rounded-lg" />
                              )}
                              <button
                                type="button"
                                onClick={() => removeFile(index)}
                                className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                              <p className="text-xs text-gray-600 mt-1 truncate">{uploadedFiles[index].name}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setShowTicketForm(false)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Creating...' : 'Create Ticket'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Ticket Details Modal */}
          {showTicketDetails && selectedTicket && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Ticket Details - {selectedTicket.ticket_number}</h3>
                  <button onClick={() => setShowTicketDetails(false)} className="text-gray-500 hover:text-gray-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-600">Customer</label><p className="mt-1 text-sm text-gray-900">{selectedTicket.customer?.customer_name || '-'}</p></div>
                  <div><label className="block text-sm font-medium text-gray-600">Status</label><span className={`mt-1 inline-block px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(selectedTicket.status)}`}>{selectedTicket.status}</span></div>
                  <div><label className="block text-sm font-medium text-gray-600">Priority</label><span className={`mt-1 inline-block px-2 py-1 text-xs font-semibold rounded-full ${getPriorityColor(selectedTicket.priority)}`}>{selectedTicket.priority}</span></div>
                  <div><label className="block text-sm font-medium text-gray-600">Service Type</label><p className="mt-1 text-sm text-gray-900">{selectedTicket.service_type}</p></div>
                  <div><label className="block text-sm font-medium text-gray-600">Commercial Approval</label><span className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-semibold ${selectedTicket.commercial_approval_status === 'APPROVED' || selectedTicket.commercial_approval_status === 'NOT_REQUIRED' ? 'bg-green-100 text-green-800' : selectedTicket.commercial_approval_status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{(selectedTicket.commercial_approval_status || 'NOT_REQUIRED').replaceAll('_', ' ')}</span></div>
                  <div><label className="block text-sm font-medium text-gray-600">Product</label><p className="mt-1 text-sm text-gray-900">{selectedTicket.product_name || '-'}</p></div>
                  <div><label className="block text-sm font-medium text-gray-600">UID</label><p className="mt-1 text-sm font-mono text-gray-900">{selectedTicket.uid || '-'}</p></div>
                  <div><label className="block text-sm font-medium text-gray-600">Reported By</label><p className="mt-1 text-sm text-gray-900">{selectedTicket.reported_by || '-'}</p></div>
                  <div><label className="block text-sm font-medium text-gray-600">Contact</label><p className="mt-1 text-sm text-gray-900">{selectedTicket.contact_number || '-'}</p></div>
                  <div><label className="block text-sm font-medium text-gray-600">Complaint Date</label><p className="mt-1 text-sm text-gray-900">{new Date(selectedTicket.complaint_date).toLocaleDateString()}</p></div>
                  <div><span className="font-medium">Warranty:</span> {selectedTicket.is_under_warranty ? <span className="text-green-600">✓ Valid</span> : <span className="text-gray-600">Not Under Warranty</span>}</div>
                  <div className="col-span-2"><span className="font-medium">Complaint Description:</span> <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-3 rounded">{selectedTicket.complaint_description}</p></div>
                </div>

                <div className="mt-6 rounded-lg border border-[#E8DCC4] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><div className="text-sm font-bold text-[#5C4738]">Controlled Service Checklist</div><div className="text-xs text-[#7A6756]">Mandatory quality and safety steps must be cleared before final confirmation.</div></div>
                    {!(selectedTicket.checklist || []).length && canEdit && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(selectedTicket.status) && (
                      <div className="flex gap-2">
                        <select value={ticketChecklistTemplateId} onChange={(event) => setTicketChecklistTemplateId(event.target.value)} className="rounded border border-[#D9C9AD] bg-white px-2 py-1.5 text-sm">
                          <option value="">Select template</option>
                          {checklistTemplates.filter((template) => template.is_active && (!template.service_type || template.service_type === selectedTicket.service_type)).map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}
                        </select>
                        <button type="button" onClick={() => assignChecklistToTicket(selectedTicket)} className="rounded bg-[#8B6F47] px-3 py-1.5 text-sm font-semibold text-white">Assign</button>
                      </div>
                    )}
                  </div>
                  {!!(selectedTicket.checklist || []).length && <div className="mt-3 space-y-2">
                    {[...(selectedTicket.checklist || [])].sort((a, b) => a.sort_order - b.sort_order).map((item) => <div key={item.id} className="flex flex-col gap-2 rounded border border-[#EFE5D2] bg-[#FFFDF7] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm"><span className="mr-2 font-semibold">{item.sort_order}.</span>{item.item_text}{item.is_required && <span className="ml-2 text-xs font-bold text-red-700">REQUIRED</span>}{item.remarks && <div className="ml-6 text-xs text-gray-500">Remarks: {item.remarks}</div>}</div>
                      <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : item.status === 'NOT_APPLICABLE' ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-800'}`}>{item.status.replaceAll('_', ' ')}</span>{canEdit && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(selectedTicket.status) && <>{item.status !== 'COMPLETED' && <button type="button" disabled={loading} onClick={() => updateTicketChecklistItem(selectedTicket, item, 'COMPLETED')} className="rounded border border-green-300 px-2 py-1 text-xs font-semibold text-green-700">Complete</button>}{item.status !== 'NOT_APPLICABLE' && <button type="button" disabled={loading} onClick={() => updateTicketChecklistItem(selectedTicket, item, 'NOT_APPLICABLE')} className="rounded border px-2 py-1 text-xs">N/A</button>}{item.status !== 'PENDING' && <button type="button" disabled={loading} onClick={() => updateTicketChecklistItem(selectedTicket, item, 'PENDING')} className="rounded border px-2 py-1 text-xs">Reset</button>}</>}</div>
                    </div>)}
                    <div className="text-right text-xs font-semibold text-[#6F4E37]">{(selectedTicket.checklist || []).filter((item) => item.status !== 'PENDING').length} of {(selectedTicket.checklist || []).length} cleared</div>
                  </div>}
                  {!(selectedTicket.checklist || []).length && <div className="mt-3 text-sm text-[#7A6756]">No checklist assigned to this ticket.</div>}
                </div>

                <div className="mt-6 rounded-lg border border-[#E8DCC4] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-[#5C4738]">Service Level Agreement</div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getSlaColor(selectedTicket.sla?.overall_status)}`}>
                      {(selectedTicket.sla?.overall_status || 'NOT_SET').replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div><span className="font-medium">Response due:</span> {formatSlaDate(selectedTicket.response_due_at)}<br /><span className={selectedTicket.sla?.response_status === 'BREACHED' ? 'text-red-700' : 'text-[#7A6756]'}>{selectedTicket.sla?.response_status || 'NOT SET'} · responded {formatSlaDate(selectedTicket.response_acknowledged_at)}</span></div>
                    <div><span className="font-medium">Resolution due:</span> {formatSlaDate(selectedTicket.resolution_due_at)}<br /><span className={selectedTicket.sla?.resolution_status === 'BREACHED' ? 'text-red-700' : 'text-[#7A6756]'}>{selectedTicket.sla?.resolution_status || 'NOT SET'} · resolved {formatSlaDate(selectedTicket.resolved_at)}</span></div>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-[#E8DCC4] p-4">
                    <div className="mb-2 text-sm font-bold text-[#5C4738]">Technician Assignments</div>
                    {((selectedTicket as any).assignments || []).map((assignment: any) => (
                      <div key={assignment.id} className="border-t border-[#EFE5D2] py-2 text-sm first:border-0">
                        <div className="font-semibold">{assignment.technician?.technician_name || 'Technician'}</div>
                        <div className="text-xs text-[#7A6756]">{assignment.status} · {assignment.scheduled_start_date || 'Schedule not set'}</div>
                        {canEdit && !['COMPLETED', 'REASSIGNED'].includes(assignment.status) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {assignment.status === 'ASSIGNED' && <button type="button" disabled={loading} onClick={() => progressAssignment(assignment.id, 'ACCEPTED')} className="rounded border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-700 disabled:opacity-50">Accept</button>}
                            {['ASSIGNED', 'ACCEPTED'].includes(assignment.status) && <button type="button" disabled={loading || Boolean(selectedTicket.commercial_approval_required && selectedTicket.commercial_approval_status !== 'APPROVED')} title={selectedTicket.commercial_approval_required && selectedTicket.commercial_approval_status !== 'APPROVED' ? 'Customer estimate approval required' : 'Start technician work'} onClick={() => progressAssignment(assignment.id, 'IN_PROGRESS')} className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50">Start Work</button>}
                            {assignment.status === 'IN_PROGRESS' && <button type="button" disabled={loading} onClick={() => progressAssignment(assignment.id, 'COMPLETED')} className="rounded border border-green-300 px-2 py-1 text-xs font-semibold text-green-700 disabled:opacity-50">Complete Technician Work</button>}
                          </div>
                        )}
                      </div>
                    ))}
                    {!((selectedTicket as any).assignments || []).length && <div className="text-sm text-[#7A6756]">No technician assigned.</div>}
                  </div>
                  <div className="rounded-lg border border-[#E8DCC4] p-4">
                    <div className="mb-2 text-sm font-bold text-[#5C4738]">Parts Consumed</div>
                    {((selectedTicket as any).parts_used || []).map((part: any) => (
                      <div key={part.id} className="flex justify-between border-t border-[#EFE5D2] py-2 text-sm first:border-0">
                        <div><div className="font-semibold">{part.part_code || part.part_name}</div><div className="text-xs text-[#7A6756]">Qty {part.quantity}</div></div>
                        <div className="font-semibold">{serviceAmount(part.total_cost)}</div>
                      </div>
                    ))}
                    {!((selectedTicket as any).parts_used || []).length && <div className="text-sm text-[#7A6756]">No parts consumed.</div>}
                  </div>
                </div>

                <div className="mt-6 rounded-lg border border-[#E8DCC4] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-[#5C4738]">Field Service Visits</div>
                      <div className="text-xs text-[#7A6756]">Technician, client representative, time, location and site evidence.</div>
                    </div>
                    {canEdit && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(selectedTicket.status) && (
                      <button type="button" onClick={() => openSiteVisit(selectedTicket)} className="rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800">
                        {(selectedTicket.site_visits || []).some((visit) => visit.status === 'CHECKED_IN') ? 'Check Out Visit' : 'Start Site Visit'}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 space-y-3">
                    {(selectedTicket.site_visits || []).map((visit) => {
                      const evidence = [...(visit.before_attachments || []), ...(visit.after_attachments || [])];
                      return <div key={visit.id} className="rounded-md border border-[#EFE5D2] bg-[#FFFDF7] p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2"><strong>Visit {visit.visit_number} · {visit.assignment?.technician?.technician_name || 'Technician'}</strong><div className="flex items-center gap-2"><span className={visit.status === 'COMPLETED' ? 'font-semibold text-green-700' : 'font-semibold text-amber-700'}>{visit.status.replaceAll('_', ' ')}</span><button type="button" onClick={() => printSiteVisitReport(selectedTicket, visit)} className="rounded border border-[#D9C9AD] bg-white px-2 py-1 text-xs font-semibold text-[#6F4E37]">Print Report</button></div></div>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <span><strong>Client contact:</strong> {visit.site_contact_name}{visit.site_contact_designation ? `, ${visit.site_contact_designation}` : ''}</span>
                          <span><strong>Mobile:</strong> {visit.site_contact_mobile || '-'}</span>
                          <span><strong>Check-in:</strong> {new Date(visit.check_in_at).toLocaleString('en-IN')}</span>
                          <span><strong>Check-out:</strong> {visit.check_out_at ? new Date(visit.check_out_at).toLocaleString('en-IN') : '-'}</span>
                          <span><strong>Location:</strong> {visit.check_out_location || visit.check_in_location || '-'}</span>
                          <span><strong>Acknowledged by:</strong> {visit.customer_acknowledgement_name || '-'}</span>
                        </div>
                        {visit.work_notes && <div className="mt-2 rounded bg-white p-2"><strong>Work:</strong> {visit.work_notes}</div>}
                        {!!evidence.length && <div className="mt-2 flex flex-wrap gap-2">{evidence.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="rounded border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700">Evidence {index + 1}</a>)}</div>}
                      </div>;
                    })}
                    {!(selectedTicket.site_visits || []).length && <div className="text-sm text-[#7A6756]">No field visit recorded yet.</div>}
                  </div>
                </div>

                <div className="mt-6 rounded-lg border border-[#E8DCC4] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><div className="text-sm font-bold text-[#5C4738]">Customer Satisfaction (CSAT)</div><div className="text-xs text-[#7A6756]">Controlled post-completion customer feedback</div></div>
                    {selectedTicket.feedback
                      ? <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-800">{selectedTicket.feedback.overall_rating} / 5</span>
                      : ['COMPLETED', 'CLOSED'].includes(selectedTicket.status) && canCreate
                        ? <button type="button" onClick={() => setFeedbackTicket(selectedTicket)} className="rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800">Record Feedback</button>
                        : <span className="text-sm text-[#7A6756]">Available after service completion</span>}
                  </div>
                  {selectedTicket.feedback && <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div>Technician: <strong>{selectedTicket.feedback.technician_rating || '-'}/5</strong></div><div>Response: <strong>{selectedTicket.feedback.response_time_rating || '-'}/5</strong></div><div>Quality: <strong>{selectedTicket.feedback.quality_rating || '-'}/5</strong></div><div>Recommend: <strong>{selectedTicket.feedback.would_recommend == null ? '-' : selectedTicket.feedback.would_recommend ? 'Yes' : 'No'}</strong></div>{selectedTicket.feedback.feedback_text && <div className="sm:col-span-2 rounded bg-gray-50 p-2">{selectedTicket.feedback.feedback_text}</div>}</div>}
                </div>

                {/* Attachments */}
                {Array.isArray(selectedTicket.attachments) && selectedTicket.attachments.length > 0 && (
                  <div className="mt-6">
                    <div className="text-sm font-medium text-gray-700 mb-2">Attachments</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {selectedTicket.attachments.map((url, idx) => {
                        const kind = getAttachmentKind(url);
                        return (
                          <a
                            key={`${url}-${idx}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block border border-gray-200 rounded-lg overflow-hidden hover:border-amber-400 transition"
                            title="Open in new tab"
                          >
                            {kind === 'video' ? (
                              <video src={url} className="w-full h-32 object-cover bg-black" controls />
                            ) : kind === 'image' ? (
                              <img src={url} alt={`Attachment ${idx + 1}`} className="w-full h-32 object-cover" />
                            ) : (
                              <div className="w-full h-32 flex items-center justify-center text-sm text-gray-600 bg-gray-50">
                                Open Attachment
                              </div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex justify-end space-x-3">
                  {canEdit && <button
                    onClick={() => {
                      setEditTicketForm({
                        priority: selectedTicket.priority || 'MEDIUM',
                        expected_completion_date: (selectedTicket as any).expected_completion_date || '',
                        ship_name: selectedTicket.ship_name || '',
                        location: selectedTicket.location || '',
                        service_location: (selectedTicket as any).service_location || '',
                        product_name: selectedTicket.product_name || '',
                        model_number: (selectedTicket as any).model_number || '',
                        reported_by: selectedTicket.reported_by || '',
                        contact_number: selectedTicket.contact_number || '',
                        email: selectedTicket.email || '',
                        complaint_description: selectedTicket.complaint_description || '',
                      });
                      setShowEditTicketModal(true);
                    }}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                  >
                    Edit
                  </button>}
                  <button onClick={() => setShowTicketDetails(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Ticket Modal */}
          {showEditTicketModal && selectedTicket && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">Edit Ticket - {selectedTicket.ticket_number}</h3>

                {/* Existing attachments (read-only) */}
                {Array.isArray(selectedTicket.attachments) && selectedTicket.attachments.length > 0 && (
                  <div className="mb-4">
                    <div className="text-sm font-medium text-gray-700 mb-2">Existing Attachments</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {selectedTicket.attachments.map((url, idx) => {
                        const kind = getAttachmentKind(url);
                        return (
                          <a
                            key={`${url}-${idx}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block border border-gray-200 rounded-lg overflow-hidden hover:border-amber-400 transition"
                            title="Open in new tab"
                          >
                            {kind === 'video' ? (
                              <video src={url} className="w-full h-28 object-cover bg-black" controls />
                            ) : kind === 'image' ? (
                              <img src={url} alt={`Attachment ${idx + 1}`} className="w-full h-28 object-cover" />
                            ) : (
                              <div className="w-full h-28 flex items-center justify-center text-sm text-gray-600 bg-gray-50">
                                Open Attachment
                              </div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLoading(true);
                    setError(null);
                    try {
                      const payload = {
                        ...editTicketForm,
                        expected_completion_date:
                          editTicketForm.expected_completion_date || null,
                      };

                      const updated = await apiClient.put<ServiceTicket>(
                        `/service/tickets/${selectedTicket.id}`,
                        payload,
                      );

                      setSelectedTicket(updated);
                      setShowEditTicketModal(false);
                      fetchTickets();
                    } catch (err: any) {
                      setError(err.message || 'Failed to update ticket');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                      <select
                        value={editTicketForm.priority}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            priority: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Expected Completion Date</label>
                      <DateInput
                        min={todayDate}
                        value={editTicketForm.expected_completion_date}
                        onChange={(value) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            expected_completion_date: value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ship Name</label>
                      <input
                        type="text"
                        value={editTicketForm.ship_name}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            ship_name: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                      <input
                        type="text"
                        value={editTicketForm.location}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            location: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Service Location</label>
                      <input
                        type="text"
                        value={editTicketForm.service_location}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            service_location: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                      <input
                        type="text"
                        value={editTicketForm.product_name}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            product_name: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Model Number</label>
                      <input
                        type="text"
                        value={editTicketForm.model_number}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            model_number: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reported By</label>
                      <input
                        type="text"
                        value={editTicketForm.reported_by}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            reported_by: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label>
                      <input
                        type="text"
                        value={editTicketForm.contact_number}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            contact_number: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={editTicketForm.email}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            email: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Complaint Description</label>
                      <textarea
                        value={editTicketForm.complaint_description}
                        onChange={(e) =>
                          setEditTicketForm({
                            ...editTicketForm,
                            complaint_description: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        rows={4}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setShowEditTicketModal(false)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Updating...' : 'Update Ticket'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Update Status Modal */}
          {showStatusModal && selectedTicket && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full">
                <h3 className="text-lg font-semibold mb-4">Update Ticket Status</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Current: <span className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(selectedTicket.status)}`}>{selectedTicket.status}</span></label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg" defaultValue={selectedTicket.status} onChange={async (e) => { try { await apiClient.put(`/service/tickets/${selectedTicket.id}`, { status: e.target.value }); setShowStatusModal(false); setSelectedTicket(null); fetchTickets(); } catch (err: any) { setError(err.message); } }}>
                    <option value={selectedTicket.status}>{selectedTicket.status.replaceAll('_', ' ')}</option>
                    {(ticketStatusTransitions[selectedTicket.status] || []).map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
                  </select>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => { setShowStatusModal(false); setSelectedTicket(null); }} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Checklist Template Master */}
      {activeTab === 'checklists' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Service Checklist Templates</h2><p className="text-sm text-gray-600">Reusable quality and safety controls assigned to service tickets.</p></div>{canCreate && <button type="button" onClick={() => { setEditingChecklistTemplateId(null); setChecklistTemplateForm(emptyChecklistTemplateForm); setShowChecklistTemplateForm(true); }} className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white">+ New Checklist</button>}</div>
          <div className="overflow-hidden rounded-lg border border-[#E8DCC4] bg-white">
            <table className="min-w-full divide-y divide-[#E8DCC4] text-sm"><thead className="bg-[#F5EFE5]"><tr>{['Template', 'Service Type', 'Items', 'Mandatory', 'Status', 'Actions'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase text-[#6F4E37]">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#EEE5D6]">
              {checklistTemplates.map((template) => <tr key={template.id} className="hover:bg-[#FCFAF7]"><td className="px-4 py-3"><div className="font-semibold">{template.template_name}</div><div className="max-w-md text-xs text-gray-500">{template.description || '-'}</div></td><td className="px-4 py-3">{template.service_type || 'All service types'}</td><td className="px-4 py-3">{template.items?.length || 0}</td><td className="px-4 py-3">{(template.items || []).filter((item) => item.is_required).length}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${template.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{template.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td><td className="px-4 py-3"><div className="flex gap-2">{canEdit && <button type="button" onClick={() => { setEditingChecklistTemplateId(template.id); setChecklistTemplateForm({ template_name: template.template_name, service_type: template.service_type || '', description: template.description || '', items: template.items.map((item) => ({ item_text: item.item_text, is_required: item.is_required })) }); setShowChecklistTemplateForm(true); }} className="rounded border px-3 py-1 text-xs font-semibold">Edit</button>}{canDelete && template.is_active && <button type="button" onClick={async () => { if (!confirm(`Deactivate checklist ${template.template_name}? Existing ticket snapshots will remain unchanged.`)) return; try { await apiClient.delete(`/service/checklist-templates/${template.id}`); await fetchChecklistTemplates(); } catch (err: any) { alert(err.message); } }} className="rounded border border-red-200 px-3 py-1 text-xs font-semibold text-red-700">Deactivate</button>}</div></td></tr>)}
              {!checklistTemplates.length && <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">No service checklist templates created.</td></tr>}
            </tbody></table>
          </div>
        </div>
      )}

      {showChecklistTemplateForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><form onSubmit={saveChecklistTemplate} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-lg font-semibold">{editingChecklistTemplateId ? 'Edit' : 'New'} Service Checklist</h3><p className="text-xs text-gray-500">Changes affect future assignments only; existing ticket checklists remain auditable snapshots.</p></div><button type="button" onClick={() => setShowChecklistTemplateForm(false)} className="text-2xl text-gray-500">×</button></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Template Name *<input required value={checklistTemplateForm.template_name} onChange={(event) => setChecklistTemplateForm({ ...checklistTemplateForm, template_name: event.target.value })} className="mt-1 w-full rounded border px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Service Type<input value={checklistTemplateForm.service_type} onChange={(event) => setChecklistTemplateForm({ ...checklistTemplateForm, service_type: event.target.value })} placeholder="Blank applies to all service types" className="mt-1 w-full rounded border px-3 py-2 font-normal" /></label><label className="text-sm font-semibold md:col-span-2">Description<textarea value={checklistTemplateForm.description} onChange={(event) => setChecklistTemplateForm({ ...checklistTemplateForm, description: event.target.value })} rows={2} className="mt-1 w-full rounded border px-3 py-2 font-normal" /></label></div><div className="mt-5"><div className="mb-2 flex items-center justify-between"><h4 className="font-semibold">Checklist Items</h4><button type="button" onClick={() => setChecklistTemplateForm({ ...checklistTemplateForm, items: [...checklistTemplateForm.items, { item_text: '', is_required: true }] })} className="rounded border px-3 py-1 text-sm font-semibold">+ Add Item</button></div><div className="space-y-2">{checklistTemplateForm.items.map((item, index) => <div key={index} className="grid grid-cols-[32px_minmax(0,1fr)_120px_36px] items-center gap-2"><span className="text-center text-sm font-semibold">{index + 1}</span><input required value={item.item_text} onChange={(event) => setChecklistTemplateForm({ ...checklistTemplateForm, items: checklistTemplateForm.items.map((row, rowIndex) => rowIndex === index ? { ...row, item_text: event.target.value } : row) })} placeholder="Inspection or safety step" className="rounded border px-3 py-2 text-sm" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.is_required} onChange={(event) => setChecklistTemplateForm({ ...checklistTemplateForm, items: checklistTemplateForm.items.map((row, rowIndex) => rowIndex === index ? { ...row, is_required: event.target.checked } : row) })} /> Required</label><button type="button" disabled={checklistTemplateForm.items.length === 1} onClick={() => setChecklistTemplateForm({ ...checklistTemplateForm, items: checklistTemplateForm.items.filter((_, rowIndex) => rowIndex !== index) })} className="rounded border border-red-200 py-1 text-red-700 disabled:opacity-30">×</button></div>)}</div></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowChecklistTemplateForm(false)} className="rounded border px-4 py-2">Cancel</button><button type="submit" disabled={loading} className="rounded bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? 'Saving...' : 'Save Checklist'}</button></div></form></div>}

      {/* Technician Dispatch Board */}
      {activeTab === 'dispatch' && (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Technician Dispatch Board</h2>
              <p className="mt-1 text-sm text-gray-600">Daily field-service control for assignments, site contacts, SLA risk, visits, evidence, and reports.</p>
            </div>
            <button type="button" onClick={fetchDispatchBoard} disabled={loading} className="rounded-lg border border-[#D9C9AD] bg-white px-4 py-2 text-sm font-semibold text-[#6F4E37] hover:bg-[#FAF6EF] disabled:opacity-50">
              {loading ? 'Refreshing...' : 'Refresh board'}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['Unassigned active', dispatchUnassigned, dispatchUnassigned ? 'text-red-700' : 'text-green-700'],
              ['Active technicians', technicians.filter((technician) => technician.is_active).length, 'text-[#2F241D]'],
              ['Checked in now', dispatchCheckedIn, dispatchCheckedIn ? 'text-blue-700' : 'text-[#2F241D]'],
              ['SLA attention', dispatchSlaAtRisk, dispatchSlaAtRisk ? 'text-red-700' : 'text-green-700'],
              ['Reports ready', dispatchReportsReady, 'text-green-700'],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-lg border border-[#E8DCC4] bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#7A6756]">{label}</p>
                <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 rounded-lg border border-[#E8DCC4] bg-white p-4 md:grid-cols-2 xl:grid-cols-[170px_220px_200px_180px_minmax(240px,1fr)_auto]">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6756]">Dispatch date</label>
              <DateInput value={dispatchDate} onChange={setDispatchDate} className="w-full rounded-md border border-[#D9C9AD] px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6756]">Technician</label>
              <select value={dispatchTechnician} onChange={(event) => setDispatchTechnician(event.target.value)} className="w-full rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-sm">
                <option value="ALL">All technicians</option>
                <option value="UNASSIGNED">Unassigned only</option>
                {technicians.filter((technician) => technician.is_active).sort((a, b) => a.technician_name.localeCompare(b.technician_name)).map((technician) => (
                  <option key={technician.id} value={technician.id}>{technician.technician_name} ({technician.technician_code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6756]">Work status</label>
              <select value={dispatchStatus} onChange={(event) => setDispatchStatus(event.target.value)} className="w-full rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-sm">
                <option value="ACTIVE">All active tickets</option><option value="ALL">All records</option><option value="UNASSIGNED">Unassigned</option>
                <option value="ASSIGNED">Assigned</option><option value="ACCEPTED">Accepted</option><option value="IN_PROGRESS">In progress</option>
                <option value="CHECKED_IN">Checked in</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6756]">SLA risk</label>
              <select value={dispatchSlaFilter} onChange={(event) => setDispatchSlaFilter(event.target.value)} className="w-full rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-sm">
                <option value="ALL">All SLA states</option><option value="AT_RISK">At risk / breached</option><option value="BREACHED">Breached</option><option value="PENDING">Pending</option><option value="MET">Met</option><option value="NOT_SET">Not configured</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6756]">Sort dispatch</label>
              <select value={dispatchSort} onChange={(event) => setDispatchSort(event.target.value)} className="w-full rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-sm">
                <option value="schedule">Schedule</option><option value="priority">Priority</option><option value="sla">SLA risk</option><option value="customer">Customer</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6756]">Search dispatch</label>
              <input value={dispatchSearch} onChange={(event) => setDispatchSearch(event.target.value)} placeholder="Ticket, customer, product, site, contact..." className="w-full rounded-md border border-[#D9C9AD] px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => setDispatchDate(todayDate)} className="rounded-md border border-[#D9C9AD] px-3 py-2 text-sm font-semibold">Today</button>
              <button type="button" onClick={() => { setDispatchDate(''); setDispatchTechnician('ALL'); setDispatchStatus('ACTIVE'); setDispatchSlaFilter('ALL'); setDispatchSort('schedule'); setDispatchSearch(''); }} className="rounded-md border border-[#D9C9AD] px-3 py-2 text-sm font-semibold">Clear</button>
              <button type="button" onClick={exportDispatchCsv} disabled={!filteredDispatchRows.length} className="rounded-md bg-[#8B6F47] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Export CSV</button>
              <button type="button" onClick={printDispatchSchedule} className="rounded-md border border-[#D9C9AD] px-3 py-2 text-sm font-semibold">Print schedule</button>
              <button type="button" onClick={exportDispatchCalendar} disabled={!filteredDispatchRows.length} className="rounded-md border border-[#D9C9AD] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">Calendar (.ics)</button>
            </div>
          </div>

          {technicianCapacity.length > 0 && <div className="overflow-x-auto rounded-lg border border-[#E8DCC4] bg-white p-3"><div className="mb-2 text-xs font-bold uppercase text-[#7A6756]">Capacity for {dispatchDate}</div><div className="flex min-w-max gap-3">{technicianCapacity.map((row) => <div key={row.id} className={`min-w-52 rounded border p-3 ${row.is_overbooked ? 'border-red-300 bg-red-50' : 'border-[#E8DCC4] bg-[#FCFAF7]'}`}><div className="font-semibold">{row.technician_name}</div><div className="mt-1 text-xs text-gray-600">{row.booked_hours}h booked / {row.daily_capacity_hours || 8}h capacity</div><div className={`mt-1 text-sm font-bold ${row.is_overbooked ? 'text-red-700' : row.utilization_percent >= 80 ? 'text-amber-700' : 'text-green-700'}`}>{row.utilization_percent}% utilized · {row.available_hours}h free</div></div>)}</div></div>}

          <div className="overflow-hidden rounded-lg border border-[#E8DCC4] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-[1250px] w-full divide-y divide-[#E8DCC4] text-sm">
                <thead className="bg-[#F5EFE5] text-left text-xs font-semibold uppercase text-[#6F4E37]">
                  <tr><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Ticket / Priority</th><th className="px-4 py-3">Customer / Site</th><th className="px-4 py-3">Technician</th><th className="px-4 py-3">Client Contact</th><th className="px-4 py-3">SLA</th><th className="px-4 py-3">Visit / Evidence</th><th className="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-[#EEE5D6]">
                  {filteredDispatchRows.map(({ ticket, assignment, visit }) => {
                    const rowStatus = visit?.status || assignment?.status || 'UNASSIGNED';
                    const evidenceCount = (visit?.before_attachments || []).length + (visit?.after_attachments || []).length;
                    const schedule = assignment?.scheduled_start_date || ticket.expected_completion_date;
                    const hasActiveAssignment = Boolean(assignment && ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(assignment.status));
                    return (
                      <tr key={`${ticket.id}-${assignment?.id || 'unassigned'}`} className={rowStatus === 'UNASSIGNED' ? 'bg-red-50/50' : 'hover:bg-[#FCFAF7]'}>
                        <td className="px-4 py-3 align-top"><div className="font-semibold">{schedule ? new Date(schedule).toLocaleDateString('en-IN') : 'Not scheduled'}</div><div className="mt-1 text-xs text-gray-500">{schedule && schedule.includes('T') ? new Date(schedule).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Time not set'}</div></td>
                        <td className="px-4 py-3 align-top"><button type="button" onClick={() => openTicketDetails(ticket)} className="font-semibold text-[#6F4E37] underline-offset-2 hover:underline">{ticket.ticket_number}</button><div className="mt-1 flex gap-1"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getPriorityColor(ticket.priority)}`}>{ticket.priority}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusColor(rowStatus)}`}>{rowStatus.replaceAll('_', ' ')}</span></div></td>
                        <td className="px-4 py-3 align-top"><div className="font-medium">{ticket.customer?.customer_name || '-'}</div><div className="mt-1 max-w-[240px] text-xs text-gray-600">{ticket.service_location || ticket.location || 'Site not recorded'}</div><div className="mt-1 text-xs text-gray-500">{ticket.product_name || ticket.uid || '-'}</div></td>
                        <td className="px-4 py-3 align-top">{assignment?.technician ? <><div className="font-medium">{assignment.technician.technician_name}</div><div className="text-xs text-gray-500">{assignment.technician.technician_code || ''} {assignment.technician.contact_number ? `• ${assignment.technician.contact_number}` : ''}</div></> : <span className="font-semibold text-red-700">Assignment required</span>}</td>
                        <td className="px-4 py-3 align-top"><div className="font-medium">{visit?.site_contact_name || ticket.reported_by || ticket.customer?.contact_person || '-'}</div><div className="text-xs text-gray-500">{visit?.site_contact_mobile || ticket.contact_number || ticket.customer?.mobile || ticket.customer?.phone || '-'}</div></td>
                        <td className="px-4 py-3 align-top"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${getSlaColor(ticket.sla?.overall_status)}`}>{(ticket.sla?.overall_status || 'NOT SET').replaceAll('_', ' ')}</span><div className="mt-2 text-xs text-gray-500">Due {formatSlaDate(ticket.resolution_due_at)}</div></td>
                        <td className="px-4 py-3 align-top"><div className="font-medium">{visit ? `Visit ${visit.visit_number} • ${visit.status.replaceAll('_', ' ')}` : 'Not started'}</div><div className="mt-1 text-xs text-gray-500">Evidence: {evidenceCount} • Acknowledgement: {visit?.customer_acknowledgement_name ? 'Yes' : 'No'}</div></td>
                        <td className="px-4 py-3 align-top"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openTicketDetails(ticket)} className="rounded border border-[#D9C9AD] px-2.5 py-1.5 text-xs font-semibold">View</button><button type="button" onClick={() => openDocumentFlow(ticket)} className="rounded border border-[#D9C9AD] px-2.5 py-1.5 text-xs font-semibold">Trail</button><button type="button" onClick={() => printDispatchCallReport(ticket)} className="rounded border border-[#D9C9AD] px-2.5 py-1.5 text-xs font-semibold">Service report</button>{canEdit && !assignment && <button type="button" onClick={() => openAssignment(ticket)} className="rounded bg-[#8B6F47] px-2.5 py-1.5 text-xs font-semibold text-white">Assign</button>}{canEdit && (visit?.status === 'CHECKED_IN' || hasActiveAssignment) && <button type="button" onClick={() => openSiteVisit(ticket)} className="rounded bg-blue-700 px-2.5 py-1.5 text-xs font-semibold text-white">{visit?.status === 'CHECKED_IN' ? 'Check out' : 'Start visit'}</button>}</div></td>
                      </tr>
                    );
                  })}
                  {!filteredDispatchRows.length && <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500">No dispatch work matches the selected date and filters.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#E8DCC4] px-4 py-3 text-xs text-gray-600">Showing {filteredDispatchRows.length} dispatch rows. Unassigned work is shown first, followed by priority and schedule.</div>
          </div>
        </div>
      )}

      {/* Technicians Tab */}
      {activeTab === 'installed-base' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Installed Equipment Register</h2><p className="text-sm text-gray-600">Customer equipment, UID/serial traceability, location and warranty status.</p></div>{canCreate && <button onClick={() => { setEditingAssetId(null); setAssetForm(emptyAssetForm); setShowAssetForm(true); }} className="rounded-lg bg-amber-600 px-4 py-2 text-white">+ Register Asset</button>}</div>
          <div className="overflow-x-auto rounded-lg border bg-white"><table className="min-w-full"><thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs uppercase">Asset</th><th className="px-4 py-3 text-left text-xs uppercase">Customer</th><th className="px-4 py-3 text-left text-xs uppercase">Equipment / UID</th><th className="px-4 py-3 text-left text-xs uppercase">Functional Location</th><th className="px-4 py-3 text-left text-xs uppercase">Criticality</th><th className="px-4 py-3 text-left text-xs uppercase">Warranty</th><th className="px-4 py-3 text-left text-xs uppercase">Status</th><th className="px-4 py-3 text-left text-xs uppercase">Actions</th></tr></thead><tbody className="divide-y">{getPaginatedAndSortedData(installedAssets, 'asset_number').paginatedData.map((asset) => <tr key={asset.id}><td className="px-4 py-3 font-semibold">{asset.asset_number}</td><td className="px-4 py-3">{asset.customer?.customer_name || '-'}</td><td className="px-4 py-3"><div>{asset.asset_name}</div><div className="text-xs text-gray-500">{asset.uid || asset.serial_number || '-'}</div></td><td className="px-4 py-3">{(asset as any).functional_location || asset.location || '-'}</td><td className="px-4 py-3">{(asset as any).criticality || 'MEDIUM'}</td><td className="px-4 py-3">{asset.warranty_until || '-'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(asset.status)}`}>{asset.status}</span></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button onClick={() => openAssetMeters(asset)} className="rounded border px-3 py-1 text-sm">Meters</button>{canEdit && <button onClick={() => editInstalledAsset(asset)} className="rounded border px-3 py-1 text-sm">Edit</button>}{canDelete && <button onClick={() => deleteInstalledAsset(asset)} className="rounded border border-red-200 px-3 py-1 text-sm text-red-700">Delete</button>}</div></td></tr>)}</tbody></table></div>
          {(() => { const page = getPaginatedAndSortedData(installedAssets, 'asset_number'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {activeTab === 'contracts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Service Contracts & Entitlements</h2><p className="text-sm text-gray-600">AMC, warranty and on-call coverage with customer, equipment and frozen SLA commitments.</p></div>{canCreate && <button onClick={() => { setEditingContractId(null); setRenewingContractId(null); setContractForm(emptyContractForm); setShowContractForm(true); }} className="rounded-lg bg-amber-600 px-4 py-2 text-white">+ New Contract</button>}</div>
          {serviceContracts.some((contract) => contract.entitlement_usage) && (
            <div className="grid gap-3 md:grid-cols-3">
              {serviceContracts.slice(0, 3).map((contract) => (
                <div key={`usage-${contract.id}`} className="rounded-lg border border-[#E8DCC4] bg-white p-4">
                  <div className="text-xs font-bold uppercase text-[#7A6756]">{contract.contract_number} entitlement</div>
                  <div className="mt-2 font-semibold">{contract.entitlement_usage?.visits_used || 0} visits used · {Number(contract.entitlement_usage?.labor_hours_used || 0).toFixed(2)} labor hours</div>
                  <div className="mt-1 text-xs text-gray-600">Remaining: {contract.entitlement_usage?.visits_remaining == null ? 'unlimited visits' : `${contract.entitlement_usage.visits_remaining} visits`} · {contract.entitlement_usage?.labor_hours_remaining == null ? 'unlimited hours' : `${Number(contract.entitlement_usage.labor_hours_remaining).toFixed(2)} hours`}</div>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border bg-white"><table className="min-w-full"><thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs uppercase">Contract</th><th className="px-4 py-3 text-left text-xs uppercase">Customer</th><th className="px-4 py-3 text-left text-xs uppercase">Type</th><th className="px-4 py-3 text-left text-xs uppercase">Validity</th><th className="px-4 py-3 text-left text-xs uppercase">SLA</th><th className="px-4 py-3 text-right text-xs uppercase">Value</th><th className="px-4 py-3 text-left text-xs uppercase">Status</th><th className="px-4 py-3 text-left text-xs uppercase">Actions</th></tr></thead><tbody className="divide-y">{getPaginatedAndSortedData(serviceContracts, 'contract_number').paginatedData.map((contract) => <tr key={contract.id}><td className="px-4 py-3 font-semibold">{contract.contract_number}<div className="text-xs font-normal text-gray-500">{contract.contract_assets?.length || 0} asset(s){contract.renewal_sequence ? ` · Renewal ${contract.renewal_sequence}` : ''}</div></td><td className="px-4 py-3">{contract.customer?.customer_name || '-'}</td><td className="px-4 py-3">{contract.contract_type}</td><td className="px-4 py-3">{contract.start_date} to {contract.end_date}</td><td className="px-4 py-3">{contract.response_hours}h response / {contract.resolution_hours}h resolution</td><td className="px-4 py-3 text-right font-semibold">{serviceAmount(contract.contract_value)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(contract.effective_status || contract.status)}`}>{contract.effective_status || contract.status}</span></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2">{canEdit && <button onClick={() => editServiceContract(contract)} className="rounded border px-3 py-1 text-sm">Edit</button>}{canCreate && ['ACTIVE', 'EXPIRED'].includes(contract.effective_status || contract.status) && <button onClick={() => renewServiceContract(contract)} className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800">Renew</button>}{canDelete && <button disabled={contract.status !== 'DRAFT'} onClick={() => deleteServiceContract(contract)} className="rounded border border-red-200 px-3 py-1 text-sm text-red-700 disabled:opacity-40">Delete</button>}</div></td></tr>)}</tbody></table></div>
          {(() => { const page = getPaginatedAndSortedData(serviceContracts, 'contract_number'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {activeTab === 'maintenance' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Preventive Maintenance Plans</h2><p className="text-sm text-gray-600">Plan recurring equipment service, monitor due dates, and create one controlled service ticket per maintenance cycle.</p></div>{canCreate && <button onClick={() => { setEditingMaintenanceId(null); setMaintenanceForm(emptyMaintenanceForm); setShowMaintenanceForm(true); }} className="rounded-lg bg-amber-600 px-4 py-2 text-white">+ New Schedule</button>}</div>
          <div className="grid gap-3 sm:grid-cols-4">{[
            ['Active Plans', maintenanceSchedules.filter((row) => row.is_active).length, 'text-gray-900'],
            ['Due', maintenanceSchedules.filter((row) => row.maintenance_status === 'DUE').length, 'text-amber-700'],
            ['Overdue', maintenanceSchedules.filter((row) => row.maintenance_status === 'OVERDUE').length, 'text-red-700'],
            ['Open PM Tickets', maintenanceSchedules.filter((row) => row.last_ticket && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(row.last_ticket.status)).length, 'text-blue-700'],
          ].map(([label, value, color]) => <div key={String(label)} className="rounded-lg border bg-white p-4"><div className="text-xs font-bold uppercase text-gray-500">{label}</div><div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div></div>)}</div>
          <div className="overflow-x-auto rounded-lg border bg-white"><table className="min-w-full"><thead className="bg-gray-50"><tr>{['Schedule', 'Customer / Equipment', 'Frequency', 'Last Service', 'Next Due', 'Status', 'Generated Ticket', 'Actions'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs uppercase">{heading}</th>)}</tr></thead><tbody className="divide-y">{getPaginatedAndSortedData(maintenanceSchedules, 'next_service_date').paginatedData.map((schedule) => <tr key={schedule.id} className="hover:bg-gray-50"><td className="px-4 py-3 font-semibold">{schedule.schedule_name}<div className="max-w-xs truncate text-xs font-normal text-gray-500">{schedule.service_checklist || 'No checklist'}</div></td><td className="px-4 py-3"><div>{schedule.customer?.customer_name || '-'}</div><div className="text-xs text-gray-500">{schedule.installed_asset?.asset_number || schedule.uid}</div></td><td className="px-4 py-3">Every {schedule.frequency_days} days<div className="text-xs text-gray-500">Alert {schedule.notify_before_days} days before</div></td><td className="px-4 py-3">{schedule.last_service_date || '-'}</td><td className="px-4 py-3 font-semibold">{schedule.next_service_date}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${schedule.maintenance_status === 'OVERDUE' ? 'bg-red-100 text-red-800' : schedule.maintenance_status === 'DUE' ? 'bg-amber-100 text-amber-800' : schedule.maintenance_status === 'INACTIVE' ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800'}`}>{schedule.maintenance_status}</span></td><td className="px-4 py-3">{schedule.last_ticket ? <div><div className="font-semibold">{schedule.last_ticket.ticket_number}</div><div className="text-xs text-gray-500">{schedule.last_ticket.status}</div></div> : '-'}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-2">{canCreate && ['DUE', 'OVERDUE'].includes(schedule.maintenance_status) && !(schedule.last_ticket && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(schedule.last_ticket.status)) && <button onClick={() => generateMaintenanceTicket(schedule)} className="rounded border border-blue-200 px-3 py-1 text-sm font-semibold text-blue-700">Create Ticket</button>}{canEdit && <button onClick={() => editMaintenanceSchedule(schedule)} className="rounded border px-3 py-1 text-sm">Edit</button>}{canDelete && <button onClick={() => deleteMaintenanceSchedule(schedule)} className="rounded border border-red-200 px-3 py-1 text-sm text-red-700">Delete</button>}</div></td></tr>)}{!maintenanceSchedules.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">No preventive-maintenance plans found.</td></tr>}</tbody></table></div>
          {(() => { const page = getPaginatedAndSortedData(maintenanceSchedules, 'next_service_date'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {activeTab === 'technicians' && (
        <div>
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold">Technicians</h2>
          {canCreate && (
            <button
              onClick={openTechnicianForm}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            >
              + Add Technician
            </button>
          )}
          </div>

          {loading ? (
            <p className="text-gray-600">Loading technicians...</p>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Specialization</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Daily Capacity</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assignments</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rating</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getPaginatedAndSortedData(technicians, 'technician_code').paginatedData.map((tech) => (
                    <tr key={tech.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {tech.technician_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tech.technician_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{tech.specialization || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {tech.contact_number || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tech.daily_capacity_hours || 8}h</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {tech.total_assignments}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {tech.completed_services}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {tech.average_rating > 0 ? tech.average_rating.toFixed(1) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${tech.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {tech.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex space-x-2">
                          <button onClick={() => { setSelectedTechnician(tech); setShowTechnicianDetails(true); }} className="text-blue-600 hover:text-blue-800" title="View Details">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          </button>
                          <button onClick={() => openTechnicianCalendar(tech)} className="text-emerald-700 hover:text-emerald-900" title="Schedule and availability">Calendar</button>
                          {canEdit && (
                          <button onClick={() => { setSelectedTechnician(tech); setTechnicianFormError(null); setTechnicianForm({ employee_id: tech.employee_id || '', technician_name: tech.technician_name, specialization: tech.specialization || '', contact_number: tech.contact_number || '', email: tech.email || '', daily_capacity_hours: String(tech.daily_capacity_hours || 8), skills: (tech.skills || []).join(', '), territories: (tech.territories || []).join(', '), base_location: tech.base_location || '', shift_start: String(tech.shift_start || '09:00').slice(0, 5), shift_end: String(tech.shift_end || '18:00').slice(0, 5), working_days: tech.working_days || [1, 2, 3, 4, 5, 6], is_active: tech.is_active }); setShowEditTechnicianModal(true); }} className="text-amber-600 hover:text-amber-800" title="Edit">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          )}
                          {canDelete && (
                          <button onClick={async () => { if (confirm(`Delete ${tech.technician_name}?`)) { try { await apiClient.delete(`/service/technicians/${tech.id}`); fetchTechnicians(); } catch (err: any) { setError(err.message); } } }} className="text-red-600 hover:text-red-800" title="Delete">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(() => { const page = getPaginatedAndSortedData(technicians, 'technician_code'); return renderPagination(page.totalPages, page.totalItems); })()}

          {/* Technician Form Modal */}
          {showTechnicianForm && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">Add Technician</h3>
                <form onSubmit={handleCreateTechnician}>
                  <div className="space-y-4">
                    {technicianFormError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{technicianFormError}</div>}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Employee technician</label>
                      <select value={technicianForm.employee_id} onChange={(e) => selectTechnicianEmployee(e.target.value)} disabled={loadingTechnicianEmployees} className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100">
                        <option value="">Add a service-only technician manually</option>
                        {technicianEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_code} — {employee.employee_name}{employee.designation ? ` (${employee.designation})` : ''}</option>)}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">{loadingTechnicianEmployees ? 'Loading active employees with a Technician designation…' : technicianEmployees.length ? 'Selecting an employee links this technician to their HR record and fills contact details.' : 'No active employees with a Technician designation are available.'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        type="text"
                        required
                        value={technicianForm.technician_name}
                        onChange={(e) => setTechnicianForm({ ...technicianForm, technician_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Specialization</label>
                      <input
                        type="text"
                        value={technicianForm.specialization}
                        onChange={(e) => setTechnicianForm({ ...technicianForm, specialization: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label>
                      <input
                        type="text"
                        value={technicianForm.contact_number}
                        onChange={(e) => setTechnicianForm({ ...technicianForm, contact_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={technicianForm.email}
                        onChange={(e) => setTechnicianForm({ ...technicianForm, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Daily Capacity (hours) *</label><input type="number" min="0.25" max="24" step="0.25" required value={technicianForm.daily_capacity_hours} onChange={(e) => setTechnicianForm({ ...technicianForm, daily_capacity_hours: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Skills</label><input value={technicianForm.skills} onChange={(e) => setTechnicianForm({ ...technicianForm, skills: e.target.value })} placeholder="Electrical, PLC, Hydraulics" className="w-full rounded-lg border border-gray-300 px-3 py-2" /><p className="mt-1 text-xs text-gray-500">Comma-separated qualifications used for dispatch matching.</p></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Service territories</label><input value={technicianForm.territories} onChange={(e) => setTechnicianForm({ ...technicianForm, territories: e.target.value })} placeholder="Vizag, Kolkata" className="w-full rounded-lg border border-gray-300 px-3 py-2" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Base location</label><input value={technicianForm.base_location} onChange={(e) => setTechnicianForm({ ...technicianForm, base_location: e.target.value })} placeholder="Service centre or city" className="w-full rounded-lg border border-gray-300 px-3 py-2" /></div>
                    <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium text-gray-700">Shift starts<input type="time" value={technicianForm.shift_start} onChange={(e) => setTechnicianForm({ ...technicianForm, shift_start: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label><label className="text-sm font-medium text-gray-700">Shift ends<input type="time" value={technicianForm.shift_end} onChange={(e) => setTechnicianForm({ ...technicianForm, shift_end: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label></div>
                    <div><div className="mb-1 text-sm font-medium text-gray-700">Working days *</div><div className="flex flex-wrap gap-2">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label, day) => <label key={label} className={`cursor-pointer rounded border px-2 py-1 text-xs ${technicianForm.working_days.includes(day) ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-gray-300'}`}><input type="checkbox" className="mr-1" checked={technicianForm.working_days.includes(day)} onChange={() => setTechnicianForm({ ...technicianForm, working_days: technicianForm.working_days.includes(day) ? technicianForm.working_days.filter((value) => value !== day) : [...technicianForm.working_days, day].sort() })} />{label}</label>)}</div></div>
                  </div>
                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setShowTechnicianForm(false)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? 'Adding...' : 'Add Technician'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Technician Details Modal */}
          {showTechnicianDetails && selectedTechnician && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">Technician Details</h3>
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div><span className="font-medium">Code:</span> {selectedTechnician.technician_code}</div>
                    <div><span className="font-medium">Name:</span> {selectedTechnician.technician_name}</div>
                    <div><span className="font-medium">Specialization:</span> {selectedTechnician.specialization || 'N/A'}</div>
                    <div><span className="font-medium">Contact:</span> {selectedTechnician.contact_number || 'N/A'}</div>
                    <div><span className="font-medium">Email:</span> {selectedTechnician.email || 'N/A'}</div>
                    <div><span className="font-medium">Daily Capacity:</span> {selectedTechnician.daily_capacity_hours || 8} hours</div>
                    <div><span className="font-medium">Skills:</span> {(selectedTechnician.skills || []).join(', ') || 'N/A'}</div>
                    <div><span className="font-medium">Territories:</span> {(selectedTechnician.territories || []).join(', ') || 'N/A'}</div>
                    <div><span className="font-medium">Base:</span> {selectedTechnician.base_location || 'N/A'}</div>
                    <div><span className="font-medium">Shift:</span> {String(selectedTechnician.shift_start || '09:00').slice(0, 5)} - {String(selectedTechnician.shift_end || '18:00').slice(0, 5)}</div>
                    <div><span className="font-medium">Status:</span> <span className={`px-2 py-1 text-xs font-semibold rounded-full ${selectedTechnician.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{selectedTechnician.is_active ? 'Active' : 'Inactive'}</span></div>
                    <div><span className="font-medium">Total Assignments:</span> {selectedTechnician.total_assignments || 0}</div>
                    <div><span className="font-medium">Completed Jobs:</span> {selectedTechnician.completed_jobs || 0}</div>
                    <div><span className="font-medium">Average Rating:</span> {selectedTechnician.average_rating ? `${selectedTechnician.average_rating.toFixed(1)} ⭐` : 'N/A'}</div>
                    <div><span className="font-medium">Join Date:</span> {selectedTechnician.created_at ? new Date(selectedTechnician.created_at).toLocaleDateString() : 'N/A'}</div>
                  </div>
                </div>
                <div className="mt-6 flex justify-end"><button onClick={() => setShowTechnicianDetails(false)} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">Close</button></div>
              </div>
            </div>
          )}

          {/* Edit Technician Modal */}
          {showEditTechnicianModal && selectedTechnician && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">Edit Technician</h3>
                <form onSubmit={async (e) => { e.preventDefault(); setLoading(true); setTechnicianFormError(null); try { await apiClient.put(`/service/technicians/${selectedTechnician.id}`, technicianForm); setShowEditTechnicianModal(false); setTechnicianForm({ employee_id: '', technician_name: '', specialization: '', contact_number: '', email: '', daily_capacity_hours: '8', skills: '', territories: '', base_location: '', shift_start: '09:00', shift_end: '18:00', working_days: [1, 2, 3, 4, 5, 6], is_active: true }); fetchTechnicians(); } catch (err: any) { setTechnicianFormError(err.message || 'Failed to update technician'); } finally { setLoading(false); } }} className="space-y-4">
                  {technicianFormError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{technicianFormError}</div>}
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Technician Name *</label><input type="text" value={technicianForm.technician_name} onChange={(e) => setTechnicianForm({ ...technicianForm, technician_name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Specialization</label><input type="text" value={technicianForm.specialization} onChange={(e) => setTechnicianForm({ ...technicianForm, specialization: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label><input type="text" value={technicianForm.contact_number} onChange={(e) => setTechnicianForm({ ...technicianForm, contact_number: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" value={technicianForm.email} onChange={(e) => setTechnicianForm({ ...technicianForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Daily Capacity (hours) *</label><input type="number" min="0.25" max="24" step="0.25" required value={technicianForm.daily_capacity_hours} onChange={(e) => setTechnicianForm({ ...technicianForm, daily_capacity_hours: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Skills</label><input value={technicianForm.skills} onChange={(e) => setTechnicianForm({ ...technicianForm, skills: e.target.value })} placeholder="Electrical, PLC, Hydraulics" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Service territories</label><input value={technicianForm.territories} onChange={(e) => setTechnicianForm({ ...technicianForm, territories: e.target.value })} placeholder="Vizag, Kolkata" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Base location</label><input value={technicianForm.base_location} onChange={(e) => setTechnicianForm({ ...technicianForm, base_location: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
                  <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium text-gray-700">Shift starts<input type="time" value={technicianForm.shift_start} onChange={(e) => setTechnicianForm({ ...technicianForm, shift_start: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" /></label><label className="text-sm font-medium text-gray-700">Shift ends<input type="time" value={technicianForm.shift_end} onChange={(e) => setTechnicianForm({ ...technicianForm, shift_end: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" /></label></div>
                  <div><div className="mb-1 text-sm font-medium text-gray-700">Working days *</div><div className="flex flex-wrap gap-2">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label, day) => <label key={label} className={`cursor-pointer rounded border px-2 py-1 text-xs ${technicianForm.working_days.includes(day) ? 'border-amber-600 bg-amber-50' : 'border-gray-300'}`}><input type="checkbox" className="mr-1" checked={technicianForm.working_days.includes(day)} onChange={() => setTechnicianForm({ ...technicianForm, working_days: technicianForm.working_days.includes(day) ? technicianForm.working_days.filter((value) => value !== day) : [...technicianForm.working_days, day].sort() })} />{label}</label>)}</div></div>
                  <div><label className="flex items-center"><input type="checkbox" checked={technicianForm.is_active} onChange={(e) => setTechnicianForm({ ...technicianForm, is_active: e.target.checked })} className="mr-2" /><span className="text-sm font-medium text-gray-700">Active</span></label></div>
                  <div className="flex justify-end space-x-3"><button type="button" onClick={() => { setShowEditTechnicianModal(false); setTechnicianFormError(null); setTechnicianForm({ employee_id: '', technician_name: '', specialization: '', contact_number: '', email: '', daily_capacity_hours: '8', skills: '', territories: '', base_location: '', shift_start: '09:00', shift_end: '18:00', working_days: [1, 2, 3, 4, 5, 6], is_active: true }); }} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button><button type="submit" disabled={loading} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">{loading ? 'Updating...' : 'Update Technician'}</button></div>
                </form>
              </div>
            </div>
          )}

          {technicianCalendar && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
                <div className="flex items-start justify-between"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Dispatch calendar · next 30 days</div><h3 className="text-xl font-bold">{technicianCalendar.technician.technician_name}</h3><p className="text-sm text-gray-600">{String(technicianCalendar.technician.shift_start || '').slice(0, 5)}–{String(technicianCalendar.technician.shift_end || '').slice(0, 5)} · {(technicianCalendar.technician.territories || []).join(', ') || 'All territories'}</p></div><button type="button" onClick={() => setTechnicianCalendar(null)} className="text-2xl" aria-label="Close calendar">&times;</button></div>
                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <section><h4 className="font-semibold">Scheduled work</h4><div className="mt-2 space-y-2">{(technicianCalendar.assignments || []).map((row: any) => <div key={row.id} className="rounded border border-blue-200 bg-blue-50 p-3 text-sm"><div className="font-semibold">{row.ticket?.ticket_number || 'Service assignment'} · {row.status}</div><div>{row.scheduled_start_at ? new Date(row.scheduled_start_at).toLocaleString('en-IN') : row.scheduled_start_date || 'Unscheduled'}{row.scheduled_end_at ? ` – ${new Date(row.scheduled_end_at).toLocaleString('en-IN')}` : ''}</div><div className="text-gray-600">{row.ticket?.service_location || row.service_territory || '-'}</div></div>)}{!(technicianCalendar.assignments || []).length && <p className="rounded border p-4 text-sm text-gray-500">No scheduled assignments in this period.</p>}</div></section>
                  <section><h4 className="font-semibold">Leave and unavailability</h4><div className="mt-2 space-y-2">{(technicianCalendar.unavailability || []).map((row: any) => <div key={row.id} className="flex items-start justify-between rounded border border-amber-200 bg-amber-50 p-3 text-sm"><div><div className="font-semibold">{row.reason}</div><div>{new Date(row.starts_at).toLocaleString('en-IN')} – {new Date(row.ends_at).toLocaleString('en-IN')}</div><div className="text-gray-600">{row.notes || '-'}</div></div>{canDelete && <button type="button" onClick={async () => { if (!confirm('Remove this availability block?')) return; await apiClient.delete(`/service/technician-unavailability/${row.id}`); await openTechnicianCalendar(technicianCalendar.technician); }} className="text-red-700">Remove</button>}</div>)}{!(technicianCalendar.unavailability || []).length && <p className="rounded border p-4 text-sm text-gray-500">No leave or availability blocks.</p>}</div></section>
                </div>
                {canEdit && <form onSubmit={saveTechnicianUnavailability} className="mt-6 rounded-lg border border-[#E8DCC4] bg-[#FCFAF7] p-4"><h4 className="font-semibold">Block technician availability</h4><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-sm font-medium">Starts *<input required type="datetime-local" value={unavailabilityForm.starts_at} onChange={(e) => setUnavailabilityForm({ ...unavailabilityForm, starts_at: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-medium">Ends *<input required type="datetime-local" min={unavailabilityForm.starts_at} value={unavailabilityForm.ends_at} onChange={(e) => setUnavailabilityForm({ ...unavailabilityForm, ends_at: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-medium">Reason<select value={unavailabilityForm.reason} onChange={(e) => setUnavailabilityForm({ ...unavailabilityForm, reason: e.target.value })} className="mt-1 w-full rounded border px-3 py-2">{['LEAVE','TRAINING','TRAVEL','WEEKLY_OFF','OTHER'].map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="text-sm font-medium">Notes<input value={unavailabilityForm.notes} onChange={(e) => setUnavailabilityForm({ ...unavailabilityForm, notes: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div><div className="mt-3 flex justify-end"><button disabled={loading} className="rounded bg-[#8B6F47] px-4 py-2 font-semibold text-white disabled:opacity-50">Save availability block</button></div></form>}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-[#3F2D20]">Service Billing & Customer Receipts</h2>
            <p className="text-sm text-[#6F4E37]">Invoices released from final service confirmations and their collection status.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{['CURRENT', '1-30', '31-60', '61-90', '90+'].map((bucket) => { const amount = serviceInvoices.filter((invoice) => invoice.ageing_bucket === bucket).reduce((sum, invoice) => sum + Number(invoice.balance_amount || 0), 0); return <div key={bucket} className="rounded-md border border-[#E8DCC4] bg-white p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{bucket === 'CURRENT' ? 'Current' : `${bucket} days`}</div><div className="mt-1 text-lg font-bold">{serviceAmount(amount)}</div></div>; })}</div>
          <div className="overflow-x-auto rounded-lg border border-[#E8DCC4] bg-white">
            <table className="min-w-[1250px] divide-y divide-[#E8DCC4]">
              <thead className="bg-[#F6EFE2]"><tr>
                {['Invoice', 'Ticket', 'Customer', 'Date', 'Due / Ageing', 'Invoice Value', 'Received', 'Outstanding', 'Status', 'Actions'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{heading}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#EFE5D2]">
                {getPaginatedAndSortedData(serviceInvoices, 'invoice_date').paginatedData.map((invoice) => <tr key={invoice.id} className="hover:bg-[#FFFDF7]">
                  <td className="px-4 py-3 text-sm font-semibold text-[#8B6F47]">{invoice.invoice_number}</td>
                  <td className="px-4 py-3 text-sm">{invoice.ticket?.ticket_number || '-'}</td>
                  <td className="px-4 py-3 text-sm">{invoice.customer?.customer_name || '-'}</td>
                  <td className="px-4 py-3 text-sm">{new Date(invoice.invoice_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm"><div>{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-IN') : 'No due date'}</div><div className={`text-xs font-semibold ${Number(invoice.days_overdue || 0) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{invoice.ageing_bucket || 'CURRENT'}{Number(invoice.days_overdue || 0) > 0 ? ` · ${invoice.days_overdue} overdue` : ''}</div></td>
                  <td className="px-4 py-3 text-right text-sm font-semibold">{serviceAmount(invoice.net_amount)}</td>
                  <td className="px-4 py-3 text-right text-sm">{serviceAmount(invoice.paid_amount)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold">{serviceAmount(invoice.balance_amount)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${invoice.payment_status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{invoice.payment_status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2"><button type="button" onClick={() => openServiceInvoice(invoice)} className="rounded-md border border-[#D9C9AD] px-3 py-2 text-xs font-semibold text-[#6F4E37] hover:bg-[#FFF8EC]">View</button>{invoice.billing_status !== 'CANCELLED' && <button type="button" onClick={() => emailServiceInvoice(invoice)} className="rounded-md border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">Email</button>}{canEdit && invoice.billing_status !== 'CANCELLED' && Number(invoice.balance_amount || 0) > 0 && <button type="button" onClick={() => { setServiceReceiptInvoice(invoice); setServiceReceiptForm((current) => ({ ...current, amount: String(invoice.balance_amount) })); }} className="rounded-md border border-green-200 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-50">Record Receipt</button>}{canEdit && invoice.billing_status !== 'CANCELLED' && Number(invoice.balance_amount || 0) > 0 && <button type="button" onClick={() => { setServiceCollectionInvoice(invoice); setServiceCollectionForm({ collection_status: invoice.collection_status && invoice.collection_status !== 'NOT_STARTED' ? invoice.collection_status : 'CONTACTED', next_follow_up_date: invoice.next_follow_up_date || '', promise_to_pay_date: invoice.promise_to_pay_date || '', notes: invoice.collection_notes || '' }); }} className="rounded-md border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800">Follow-up</button>}{canEdit && invoice.billing_status !== 'CANCELLED' && Number(invoice.paid_amount || 0) <= 0 && <button type="button" onClick={() => cancelServiceInvoice(invoice)} className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Cancel</button>}</div>
                  </td>
                </tr>)}
                {!serviceInvoices.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-[#7A6756]">No service invoices have been released.</td></tr>}
              </tbody>
            </table>
          </div>
          {(() => { const page = getPaginatedAndSortedData(serviceInvoices, 'invoice_date'); return renderPagination(page.totalPages, page.totalItems); })()}
        </div>
      )}

      {/* Warranty Check Tab */}
      {activeTab === 'warranty-check' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Warranty Validation</h2>
          <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Enter Product UID</label>
              <div className="flex space-x-3">
                <input
                  type="text"
                  value={warrantyUID}
                  onChange={(e) => setWarrantyUID(e.target.value)}
                  placeholder="Enter UID to check warranty status"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                />
                <button
                  onClick={handleWarrantyCheck}
                  disabled={loading}
                  className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {loading ? 'Checking...' : 'Check Warranty'}
                </button>
              </div>
            </div>

            {warrantyResult && (
              <div className={`mt-6 p-4 rounded-lg border-2 ${
                warrantyResult.is_valid ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'
              }`}>
                <div className="flex items-center mb-3">
                  <div className={`text-2xl mr-3 ${warrantyResult.is_valid ? 'text-green-600' : 'text-red-600'}`}>
                    {warrantyResult.is_valid ? '✓' : '✗'}
                  </div>
                  <div>
                    <h3 className={`text-lg font-semibold ${
                      warrantyResult.is_valid ? 'text-green-900' : 'text-red-900'
                    }`}>
                      {warrantyResult.is_valid ? 'Warranty Valid' : 'Warranty Invalid/Expired'}
                    </h3>
                    <p className={`text-sm ${warrantyResult.is_valid ? 'text-green-700' : 'text-red-700'}`}>
                      {warrantyResult.message}
                    </p>
                  </div>
                </div>

                {warrantyResult.warranty && (
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Warranty Number:</span>
                      <span className="font-medium">{warrantyResult.warranty.warranty_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Start Date:</span>
                      <span className="font-medium">
                        {new Date(warrantyResult.warranty.warranty_start_date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">End Date:</span>
                      <span className="font-medium">
                        {new Date(warrantyResult.warranty.warranty_end_date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Duration:</span>
                      <span className="font-medium">{warrantyResult.warranty.warranty_duration_months} months</span>
                    </div>
                    {warrantyResult.is_valid && warrantyResult.days_remaining && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Days Remaining:</span>
                        <span className="font-medium text-green-600">{warrantyResult.days_remaining} days</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {assignmentTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={handleAssignTechnician} className="w-full max-w-xl space-y-4 rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Technician Assignment</div><h3 className="text-xl font-bold text-[#3F2D20]">{assignmentTicket.ticket_number}</h3></div><button type="button" onClick={() => setAssignmentTicket(null)} className="text-2xl" aria-label="Close assignment">&times;</button></div>
            <label className="block text-sm font-semibold text-[#5C4738]">Technician *<SearchableSelect options={technicians.map((tech) => ({ value: tech.id, label: `${tech.technician_code} - ${tech.technician_name}`, subtitle: [...(tech.skills || []), ...(tech.territories || [])].join(' · ') || tech.specialization }))} value={assignmentForm.technician_id} onChange={(value) => setAssignmentForm({ ...assignmentForm, technician_id: value })} placeholder="Select active technician" required /></label>
            <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold text-[#5C4738]">Scheduled start *<input type="datetime-local" required value={assignmentForm.scheduled_start_at} onChange={(event) => setAssignmentForm({ ...assignmentForm, scheduled_start_at: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm font-semibold text-[#5C4738]">Scheduled end *<input type="datetime-local" required min={assignmentForm.scheduled_start_at} value={assignmentForm.scheduled_end_at} onChange={(event) => setAssignmentForm({ ...assignmentForm, scheduled_end_at: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label></div>
            <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold text-[#5C4738]">Required skills<input value={assignmentForm.required_skills} onChange={(event) => setAssignmentForm({ ...assignmentForm, required_skills: event.target.value })} placeholder="Electrical, PLC" className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm font-semibold text-[#5C4738]">Service territory<input value={assignmentForm.service_territory} onChange={(event) => setAssignmentForm({ ...assignmentForm, service_territory: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label></div>
            <label className="block text-sm font-semibold text-[#5C4738]">Skill override reason<input value={assignmentForm.override_reason} onChange={(event) => setAssignmentForm({ ...assignmentForm, override_reason: event.target.value })} placeholder="Required only when assigned technician lacks a required skill" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setAssignmentTicket(null)} className="rounded-md border px-4 py-2">Cancel</button><button type="submit" className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white">Assign Technician</button></div>
          </form>
        </div>
      )}

      {partTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={handleAddServicePart} className="max-h-[94vh] w-full max-w-3xl space-y-4 overflow-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Spare-Part Issue</div><h3 className="text-xl font-bold text-[#3F2D20]">{partTicket.ticket_number}</h3><p className="mt-1 text-xs text-[#7A6756]">Creates one auditable Service Stock Issue and links the replacement to this ticket.</p></div><button type="button" onClick={() => setPartTicket(null)} className="text-2xl" aria-label="Close part issue">&times;</button></div>
            {partError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{partError}</div>}
            <label className="block text-sm font-semibold text-[#5C4738]">Part *<SearchableSelect options={items.map((item) => ({ value: item.id, label: item.code, subtitle: item.name }))} value={partForm.part_id} onChange={(value) => setPartForm({ ...partForm, part_id: value })} placeholder="Search item code or name" required /></label>
            <label className="block text-sm font-semibold text-[#5C4738]">Issue From Warehouse *<select required value={partForm.warehouse_id} onChange={(event) => setPartForm({ ...partForm, warehouse_id: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2"><option value="">Select warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.warehouse_code} - {warehouse.warehouse_name}</option>)}</select></label>
            <div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-semibold text-[#5C4738]">Quantity *<input type="number" min="0.001" step="0.001" required value={partForm.quantity} onChange={(event) => setPartForm({ ...partForm, quantity: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm font-semibold text-[#5C4738]">Unit Price *<input type="number" min="0" step="0.01" required value={partForm.unit_price} onChange={(event) => setPartForm({ ...partForm, unit_price: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label><div className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] px-3 py-2"><div className="text-xs font-bold uppercase text-[#8B6F47]">Available Stock</div><div className="mt-1 text-lg font-bold text-[#3F2D20]">{partStockLoading ? 'Checking...' : partStockAvailable === null ? '-' : partStockAvailable.toLocaleString('en-IN')}</div></div></div>
            <div className="rounded-md border border-[#E8DCC4] p-4"><div className="mb-3 text-sm font-bold text-[#3F2D20]">Replacement traceability <span className="font-normal text-[#7A6756]">(optional for non-serialized parts)</span></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold text-[#5C4738]">Removed Part UID<input value={partForm.old_part_uid} onChange={(event) => setPartForm({ ...partForm, old_part_uid: event.target.value })} placeholder="Scan or enter existing UID" className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm font-semibold text-[#5C4738]">Removed Part Condition<select value={partForm.old_part_condition} onChange={(event) => setPartForm({ ...partForm, old_part_condition: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2"><option value="">Select condition</option><option value="DEFECTIVE">Defective</option><option value="WORN_OUT">Worn out</option><option value="DAMAGED">Damaged</option><option value="RETURNED">Returned for analysis</option></select></label><label className="text-sm font-semibold text-[#5C4738]">Replacement Part UID<input value={partForm.new_part_uid} onChange={(event) => setPartForm({ ...partForm, new_part_uid: event.target.value })} placeholder="Scan or enter new UID" className="mt-1 w-full rounded-md border px-3 py-2" /></label><div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold text-[#5C4738]">Warranty Start<DateInput max={todayDate} value={partForm.replacement_warranty_start} onChange={(value) => setPartForm({ ...partForm, replacement_warranty_start: value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm font-semibold text-[#5C4738]">Warranty Months<input type="number" min="0" max="120" step="1" value={partForm.replacement_warranty_months} onChange={(event) => setPartForm({ ...partForm, replacement_warranty_months: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label></div></div></div>
            <div className="flex flex-wrap gap-6"><label className="flex items-center gap-2 text-sm font-semibold text-[#5C4738]"><input type="checkbox" checked={partForm.charged_to_customer} onChange={(event) => setPartForm({ ...partForm, charged_to_customer: event.target.checked })} /> Charge this part to the customer</label><label className="flex items-center gap-2 text-sm font-semibold text-[#5C4738]"><input type="checkbox" checked={partForm.return_required} onChange={(event) => setPartForm({ ...partForm, return_required: event.target.checked })} /> Removed part must be returned to depot / OEM</label></div>
            <label className="block text-sm font-semibold text-[#5C4738]">Notes<textarea rows={2} value={partForm.notes} onChange={(event) => setPartForm({ ...partForm, notes: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setPartTicket(null)} className="rounded-md border px-4 py-2">Cancel</button><button type="submit" disabled={partSubmitting || partStockLoading} className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{partSubmitting ? 'Posting...' : 'Post Part Issue'}</button></div>
          </form>
        </div>
      )}

      {estimateTicket && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Chargeable Service Approval</div><h3 className="text-xl font-bold text-[#3F2D20]">{estimateTicket.ticket_number}</h3></div><button type="button" onClick={() => { setRevisingEstimateId(null); setEstimateTicket(null); }} className="text-2xl" aria-label="Close service estimate">&times;</button></div>
            <div className="space-y-5 p-6">
              <div className="grid gap-3 md:grid-cols-3"><div className="rounded border p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Customer</div><div className="font-semibold">{estimateTicket.customer?.customer_name || '-'}</div></div><div className="rounded border p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Commercial Status</div><div className="font-semibold">{(estimateTicket.commercial_approval_status || 'PENDING ESTIMATE').replaceAll('_', ' ')}</div></div><div className="rounded border p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Approved Value</div><div className="font-semibold">{formatRegionalCurrency(Number(estimateTicket.estimated_cost || 0), regionalProfile)}</div></div></div>
              {serviceEstimates.length > 0 && <div className="overflow-x-auto rounded border"><table className="min-w-full"><thead className="bg-[#F6EFE2]"><tr>{['Estimate', 'Revision', 'Date', 'Valid Until', 'Value', 'Status', 'Customer Decision', 'Actions'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-bold uppercase">{h}</th>)}</tr></thead><tbody>{serviceEstimates.map((estimate) => <tr key={estimate.id} className="border-t"><td className="px-3 py-2 font-semibold">{estimate.estimate_number}</td><td className="px-3 py-2">R{estimate.revision_no}</td><td className="px-3 py-2">{estimate.estimate_date}</td><td className="px-3 py-2">{estimate.valid_until || 'No expiry'}</td><td className="px-3 py-2 text-right">Rs. {Number(estimate.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="px-3 py-2">{estimate.status.replaceAll('_', ' ')}{estimate.status === 'EXPIRED' && <div className="mt-1 text-xs font-semibold text-orange-700">Revision required</div>}{Boolean(estimate.engagements?.length) && <div className="mt-1 text-xs text-gray-500">{estimate.engagements?.length} contact event{estimate.engagements?.length === 1 ? '' : 's'}{estimate.engagements?.[0]?.next_follow_up_date ? ` · Next ${estimate.engagements[0].next_follow_up_date}` : ''}</div>}</td><td className="px-3 py-2">{estimate.status === 'PENDING_APPROVAL' && canEdit ? <div className="flex gap-2"><button type="button" onClick={() => decideServiceEstimate(estimate, 'APPROVE')} className="rounded border border-green-300 px-2 py-1 text-xs font-semibold text-green-700">Approve</button><button type="button" onClick={() => decideServiceEstimate(estimate, 'REJECT')} className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700">Reject</button></div> : estimate.customer_comments || '-'}</td><td className="px-3 py-2"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => downloadServiceEstimatePdf(estimate)} className="rounded border px-2 py-1 text-xs font-semibold">Download PDF</button>{!['EXPIRED', 'SUPERSEDED', 'CANCELLED'].includes(estimate.status) && <button type="button" onClick={() => emailServiceEstimate(estimate)} className="rounded border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-700">Email</button>}{canEdit && estimate.status === 'PENDING_APPROVAL' && <button type="button" onClick={() => openEstimateFollowUp(estimate)} className="rounded border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-800">Follow-up</button>}{canEdit && ['PENDING_APPROVAL', 'REJECTED', 'EXPIRED'].includes(estimate.status) && <button type="button" onClick={() => startServiceEstimateRevision(estimate)} className="rounded border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-800">Revise</button>}</div></td></tr>)}</tbody></table></div>}
              {(revisingEstimateId || !serviceEstimates.some((row) => ['PENDING_APPROVAL', 'APPROVED'].includes(row.status))) && canCreate && <form onSubmit={submitServiceEstimate} className="space-y-4 rounded border border-[#E8DCC4] p-4"><div className="flex items-center justify-between"><div className="text-sm font-bold uppercase text-[#8B6F47]">{revisingEstimateId ? 'Service Estimate Revision' : 'New Service Estimate'}</div>{revisingEstimateId && <button type="button" onClick={() => setRevisingEstimateId(null)} className="rounded border px-3 py-1 text-xs font-semibold">Cancel Revision</button>}</div><div className="grid gap-3 md:grid-cols-3"><label className="text-sm font-semibold">Estimate Date *<DateInput max={todayDate} required value={estimateForm.estimate_date} onChange={(value) => setEstimateForm({ ...estimateForm, estimate_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold">Valid Until<DateInput min={estimateForm.estimate_date} value={estimateForm.valid_until} onChange={(value) => setEstimateForm({ ...estimateForm, valid_until: value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold">{regionalProfile.taxLabel} %<input type="number" min="0" max="100" step="0.01" value={estimateForm.tax_percentage} onChange={(e) => setEstimateForm({ ...estimateForm, tax_percentage: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div><div className="overflow-x-auto"><table className="min-w-full"><thead><tr>{['Description', 'Qty', 'UOM', 'Rate', 'Discount %', ''].map((h) => <th key={h} className="px-2 py-2 text-left text-xs font-bold uppercase">{h}</th>)}</tr></thead><tbody>{estimateForm.items.map((row, index) => <tr key={index}><td className="p-1"><input required value={row.description} onChange={(e) => setEstimateForm({ ...estimateForm, items: estimateForm.items.map((item, i) => i === index ? { ...item, description: e.target.value } : item) })} className="w-full rounded border px-2 py-2" /></td><td className="p-1"><input required type="number" min="0.001" step="0.001" value={row.quantity} onChange={(e) => setEstimateForm({ ...estimateForm, items: estimateForm.items.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item) })} className="w-24 rounded border px-2 py-2" /></td><td className="p-1"><input required value={row.uom} onChange={(e) => setEstimateForm({ ...estimateForm, items: estimateForm.items.map((item, i) => i === index ? { ...item, uom: e.target.value } : item) })} className="w-24 rounded border px-2 py-2" /></td><td className="p-1"><input required type="number" min="0" step="0.01" value={row.unit_price} onChange={(e) => setEstimateForm({ ...estimateForm, items: estimateForm.items.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item) })} className="w-32 rounded border px-2 py-2" /></td><td className="p-1"><input type="number" min="0" max="100" step="0.01" value={row.discount_percent} onChange={(e) => setEstimateForm({ ...estimateForm, items: estimateForm.items.map((item, i) => i === index ? { ...item, discount_percent: e.target.value } : item) })} className="w-24 rounded border px-2 py-2" /></td><td className="p-1">{estimateForm.items.length > 1 && <button type="button" onClick={() => setEstimateForm({ ...estimateForm, items: estimateForm.items.filter((_, i) => i !== index) })} className="text-red-600">&times;</button>}</td></tr>)}</tbody></table></div><div className="flex justify-between"><button type="button" onClick={() => setEstimateForm({ ...estimateForm, items: [...estimateForm.items, { description: '', quantity: '1', uom: 'NOS', unit_price: '', discount_percent: '0' }] })} className="rounded border px-3 py-2 text-sm font-semibold">+ Add Line</button><button disabled={loading} type="submit" className="rounded bg-[#8B6F47] px-4 py-2 font-semibold text-white disabled:opacity-50">{revisingEstimateId ? 'Save Revision & Submit' : 'Submit for Customer Approval'}</button></div><label className="block text-sm font-semibold">Terms &amp; Conditions<textarea rows={3} value={estimateForm.terms_and_conditions} onChange={(e) => setEstimateForm({ ...estimateForm, terms_and_conditions: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></form>}
              <div className="flex justify-end"><button type="button" onClick={() => { setRevisingEstimateId(null); setEstimateTicket(null); }} className="rounded border px-4 py-2">Close</button></div>
            </div>
          </div>
        </div>
      )}

      {estimateDecision && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Customer Estimate Decision</div><h3 className="text-xl font-bold text-[#3F2D20]">{estimateDecision.estimate.estimate_number}</h3></div>
              <button type="button" onClick={() => setEstimateDecision(null)} className="text-2xl" aria-label="Close customer decision">&times;</button>
            </div>
            <form onSubmit={submitServiceEstimateDecision} className="space-y-4 p-6">
              <div className={`rounded border p-3 text-sm font-semibold ${estimateDecision.decision === 'APPROVE' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{estimateDecision.decision === 'APPROVE' ? 'Record customer approval and release the ticket for controlled service execution.' : 'Record the customer rejection and retain the reason in the document trail.'}</div>
              {estimateDecision.decision === 'APPROVE' && <label className="block text-sm font-semibold">Approval Reference<input name="approval_reference" defaultValue="" placeholder="Customer PO, email reference, signed estimate number" className="mt-1 w-full rounded border px-3 py-2" /></label>}
              <label className="block text-sm font-semibold">{estimateDecision.decision === 'APPROVE' ? 'Customer Comments' : 'Rejection Reason *'}<textarea required={estimateDecision.decision === 'REJECT'} rows={3} value={estimateDecisionForm.customer_comments} onChange={(event) => setEstimateDecisionForm({ ...estimateDecisionForm, customer_comments: event.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label className="block text-sm font-semibold">Supporting Authorization {estimateDecision.decision === 'APPROVE' ? '(required if no reference)' : '(optional)'}<input type="file" accept="image/*,.pdf,.doc,.docx,.eml" onChange={(event) => setEstimateDecisionFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded border px-3 py-2" /><span className="mt-1 block text-xs font-normal text-gray-500">Signed estimate, customer PO, authorization email, PDF, Word document, or image.</span></label>
              <div className="flex justify-end gap-3 border-t pt-4"><button type="button" onClick={() => setEstimateDecision(null)} className="rounded border px-4 py-2">Cancel</button><button type="submit" disabled={loading} className={`rounded px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${estimateDecision.decision === 'APPROVE' ? 'bg-green-700' : 'bg-red-700'}`}>{loading ? 'Recording...' : `Record ${estimateDecision.decision === 'APPROVE' ? 'Approval' : 'Rejection'}`}</button></div>
            </form>
          </div>
        </div>
      )}

      {estimateFollowUp && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={submitEstimateFollowUp} className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Estimate Follow-up</div><h3 className="text-xl font-bold text-[#3F2D20]">{estimateFollowUp.estimate_number}</h3></div>
              <button type="button" onClick={() => setEstimateFollowUp(null)} className="text-2xl" aria-label="Close estimate follow-up">&times;</button>
            </div>
            <div className="space-y-4 p-6">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={estimateFollowUpForm.send_email} onChange={(event) => setEstimateFollowUpForm({ ...estimateFollowUpForm, send_email: event.target.checked })} />Send response reminder by email</label>
              {estimateFollowUpForm.send_email && <label className="block text-sm font-semibold">Customer Email *<input type="email" required value={estimateFollowUpForm.to} onChange={(event) => setEstimateFollowUpForm({ ...estimateFollowUpForm, to: event.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>}
              <label className="block text-sm font-semibold">{estimateFollowUpForm.send_email ? 'Reminder Note' : 'Customer Comment'} *<textarea required rows={4} value={estimateFollowUpForm.notes} onChange={(event) => setEstimateFollowUpForm({ ...estimateFollowUpForm, notes: event.target.value })} placeholder={estimateFollowUpForm.send_email ? 'Purpose or context for this follow-up' : 'Record the customer response or discussion'} className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label className="block text-sm font-semibold">Next Follow-up Date<DateInput min={todayDate} value={estimateFollowUpForm.next_follow_up_date} onChange={(value) => setEstimateFollowUpForm({ ...estimateFollowUpForm, next_follow_up_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
              {Boolean(estimateFollowUp.engagements?.length) && <div className="rounded border border-[#E8DCC4] bg-[#FFFDF7] p-3"><div className="mb-2 text-xs font-bold uppercase text-[#8B6F47]">Communication History</div><div className="max-h-40 space-y-2 overflow-auto">{estimateFollowUp.engagements?.map((entry) => <div key={entry.id} className="rounded border bg-white p-2 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{entry.event_type.replaceAll('_', ' ')}</span><span className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleString('en-IN')}</span></div>{entry.recipient && <div className="text-xs text-gray-600">To: {entry.recipient}</div>}{entry.notes && <div className="mt-1">{entry.notes}</div>}{entry.next_follow_up_date && <div className="mt-1 text-xs font-semibold text-amber-800">Next follow-up: {entry.next_follow_up_date}</div>}</div>)}</div></div>}
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => setEstimateFollowUp(null)} className="rounded border px-4 py-2">Cancel</button><button type="submit" disabled={loading} className="rounded bg-[#8B6F47] px-4 py-2 font-semibold text-white disabled:opacity-50">{estimateFollowUpForm.send_email ? 'Send & Log Reminder' : 'Save Customer Comment'}</button></div>
          </form>
        </div>
      )}

      {visitTicket && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
          <form onSubmit={submitSiteVisit} className="max-h-[94vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Field Service Visit</div><h3 className="text-xl font-bold text-[#3F2D20]">{visitTicket.ticket_number} · {activeVisit ? 'Check Out' : 'Check In'}</h3></div>
              <button type="button" onClick={() => { setVisitTicket(null); setActiveVisit(null); setVisitFiles([]); }} className="text-2xl text-[#6F4E37]" aria-label="Close site visit">&times;</button>
            </div>
            <div className="space-y-4 p-6">
              {!activeVisit ? <>
                <label className="block text-sm font-semibold text-[#5C4738]">Assigned Service Person *
                  <select required value={visitForm.service_assignment_id} onChange={(event) => setVisitForm({ ...visitForm, service_assignment_id: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2">
                    {(visitTicket.assignments || []).filter((assignment) => ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(assignment.status)).map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.technician?.technician_code ? `${assignment.technician.technician_code} - ` : ''}{assignment.technician?.technician_name || 'Technician'} ({assignment.status.replaceAll('_', ' ')})</option>)}
                  </select>
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-semibold text-[#5C4738]">On-site Client Contact Name *<input required value={visitForm.site_contact_name} onChange={(event) => setVisitForm({ ...visitForm, site_contact_name: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                  <label className="text-sm font-semibold text-[#5C4738]">Designation<input value={visitForm.site_contact_designation} onChange={(event) => setVisitForm({ ...visitForm, site_contact_designation: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                  <label className="text-sm font-semibold text-[#5C4738]">Mobile<input value={visitForm.site_contact_mobile} onChange={(event) => setVisitForm({ ...visitForm, site_contact_mobile: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                  <label className="text-sm font-semibold text-[#5C4738]">Email<input type="email" value={visitForm.site_contact_email} onChange={(event) => setVisitForm({ ...visitForm, site_contact_email: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                </div>
                <label className="block text-sm font-semibold text-[#5C4738]">Visit Purpose<textarea rows={2} value={visitForm.purpose} onChange={(event) => setVisitForm({ ...visitForm, purpose: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
              </> : <div className="grid gap-3 rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-4 md:grid-cols-3">
                <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Person</div><div className="mt-1 font-semibold">{activeVisit.assignment?.technician?.technician_name || '-'}</div></div>
                <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Client Contact</div><div className="mt-1 font-semibold">{activeVisit.site_contact_name}</div></div>
                <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Checked In</div><div className="mt-1 font-semibold">{new Date(activeVisit.check_in_at).toLocaleString('en-IN')}</div></div>
              </div>}
              <label className="block text-sm font-semibold text-[#5C4738]">Site Location<input value={visitForm.location} onChange={(event) => setVisitForm({ ...visitForm, location: event.target.value })} placeholder="Facility, workshop, vessel or site address" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
              {activeVisit && <>
                <label className="block text-sm font-semibold text-[#5C4738]">Work Performed During Visit *<textarea required rows={4} value={visitForm.work_notes} onChange={(event) => setVisitForm({ ...visitForm, work_notes: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="block text-sm font-semibold text-[#5C4738]">Customer Acknowledgement Name *<input required value={visitForm.customer_acknowledgement_name} onChange={(event) => setVisitForm({ ...visitForm, customer_acknowledgement_name: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <div className="grid gap-4 rounded-md border border-[#E8DCC4] p-4 md:grid-cols-2"><label className="block text-sm font-semibold text-[#5C4738]">Customer Designation<input value={visitForm.customer_signature_designation} onChange={(event) => setVisitForm({ ...visitForm, customer_signature_designation: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="block text-sm font-semibold text-[#5C4738]">Customer Signature<input type="file" accept="image/*" capture="environment" onChange={(event) => setVisitSignatureFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm" /></label><label className="block text-sm font-semibold text-[#5C4738] md:col-span-2">If Signature Declined, Record Reason<input value={visitForm.signature_declined_reason} onChange={(event) => setVisitForm({ ...visitForm, signature_declined_reason: event.target.value })} placeholder="Required only when no signature is captured" className="mt-1 w-full rounded-md border px-3 py-2" /></label><div className="text-xs text-[#7A6756] md:col-span-2">A signature image or a documented refusal reason is mandatory for audit-safe checkout.</div></div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#5C4738]"><input type="checkbox" checked={visitForm.complete_assignment} onChange={(event) => setVisitForm({ ...visitForm, complete_assignment: event.target.checked })} /> Technician&apos;s work is complete and ready for final service confirmation</label>
              </>}
              <label className="block text-sm font-semibold text-[#5C4738]">{activeVisit ? 'After-service' : 'Before-service'} Photos / Videos
                <input type="file" multiple accept="image/*,video/*" capture="environment" onChange={(event) => setVisitFiles(Array.from(event.target.files || []))} className="mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs font-normal text-[#7A6756]">Up to 10 files, maximum 50 MB each. Device GPS is captured when permission is available.</span>
              </label>
              {!!visitFiles.length && <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">{visitFiles.length} evidence file(s) selected: {visitFiles.map((file) => file.name).join(', ')}</div>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4"><button type="button" onClick={() => { setVisitTicket(null); setActiveVisit(null); setVisitFiles([]); setVisitSignatureFile(null); }} className="rounded-md border px-4 py-2">Cancel</button><button type="submit" disabled={loading} className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? 'Saving...' : activeVisit ? 'Check Out Visit' : 'Check In Visit'}</button></div>
          </form>
        </div>
      )}

      {confirmationTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[94vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Confirmation</div><h3 className="text-xl font-bold text-[#3F2D20]">{confirmationTicket.ticket_number}</h3></div>
              <button type="button" onClick={() => setConfirmationTicket(null)} className="text-2xl text-[#6F4E37]" aria-label="Close confirmation">&times;</button>
            </div>
            <form onSubmit={handleCreateConfirmation} className="space-y-4 p-6">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="text-sm font-semibold text-[#5C4738]">Confirmation Date *<DateInput max={todayDate} required value={confirmationForm.confirmation_date} onChange={(value) => setConfirmationForm({ ...confirmationForm, confirmation_date: value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">Labor Hours<input type="number" min="0" step="0.25" value={confirmationForm.labor_hours} onChange={(e) => setConfirmationForm({ ...confirmationForm, labor_hours: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">Labor Rate{confirmationIsWarranty ? ' (Waived under warranty)' : ''}<input type="number" min="0" step="0.01" disabled={confirmationIsWarranty} value={confirmationIsWarranty ? '0' : confirmationForm.labor_rate} onChange={(e) => setConfirmationForm({ ...confirmationForm, labor_rate: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-green-50 disabled:text-green-800" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">Travel Cost<input type="number" min="0" step="0.01" value={confirmationForm.travel_cost} onChange={(e) => setConfirmationForm({ ...confirmationForm, travel_cost: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">Other Charges<input type="number" min="0" step="0.01" value={confirmationForm.other_amount} onChange={(e) => setConfirmationForm({ ...confirmationForm, other_amount: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">{regionalProfile.taxLabel} %<input type="number" min="0" step="0.01" value={confirmationForm.tax_percentage} onChange={(e) => setConfirmationForm({ ...confirmationForm, tax_percentage: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
              </div>
              <div className="grid gap-3 rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-4 md:grid-cols-3 lg:grid-cols-6">
                {[['Labour', confirmationLaborAmount], ['Billable Parts', confirmationBillablePartsAmount], ['Taxable Value', confirmationSubtotalPreview], [`Total incl. ${regionalProfile.taxLabel}`, confirmationTotalPreview]].map(([label, value]) => <div key={label as string}><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className="mt-1 text-lg font-bold text-[#3F2D20]">{formatRegionalCurrency(Number(value), regionalProfile)}</div></div>)}
                {confirmationTicket.commercial_approval_required && <><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Approved Estimate</div><div className="mt-1 text-lg font-bold text-green-800">{formatRegionalCurrency(confirmationApprovedEstimateAmount, regionalProfile)}</div></div><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Variance</div><div className={`mt-1 text-lg font-bold ${confirmationVariancePreview > 0.005 ? 'text-red-700' : 'text-green-800'}`}>{formatRegionalCurrency(confirmationVariancePreview, regionalProfile)}</div></div></>}
              </div>
              {confirmationVariancePreview > 0.005 && <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4"><div><div className="text-sm font-bold text-amber-900">Customer change authorization required</div><p className="text-xs text-amber-800">The actual service value exceeds the approved estimate. Record the reason and attach or reference the customer&apos;s authorization before posting.</p></div><label className="block text-sm font-semibold text-[#5C4738]">Variance Reason *<textarea required rows={2} value={confirmationForm.variance_reason} onChange={(e) => setConfirmationForm({ ...confirmationForm, variance_reason: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold text-[#5C4738]">Change Authorization Reference<input value={confirmationForm.variance_approval_reference} onChange={(e) => setConfirmationForm({ ...confirmationForm, variance_approval_reference: e.target.value })} placeholder="Customer PO amendment / email reference" className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm font-semibold text-[#5C4738]">Supporting Authorization<input type="file" accept="image/*,.pdf,.doc,.docx,.eml" onChange={(e) => setConfirmationVarianceFile(e.target.files?.[0] || null)} className="mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm" /></label></div></div>}
              <div className="rounded-md border border-[#E8DCC4] bg-[#FCF9F3] p-4">
                <div className="mb-3"><div className="text-sm font-bold text-[#3F2D20]">Technical Diagnosis &amp; Closure</div><p className="text-xs text-[#7A6756]">Structured RCA/CAPA record retained with the service confirmation and document trail.</p></div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-semibold text-[#5C4738]">Failure Code<select value={confirmationForm.failure_code_id} onChange={(event) => { const code = failureCodes.find((row) => row.id === event.target.value); setConfirmationForm({ ...confirmationForm, failure_code_id: event.target.value, failure_category: code?.category || confirmationForm.failure_category, corrective_action: confirmationForm.corrective_action || code?.default_corrective_action || '' }); }} className="mt-1 w-full rounded-md border px-3 py-2"><option value="">Select controlled code (optional)</option>{failureCodes.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.code} · {row.category} · {row.description}</option>)}</select></label>
                  <label className="text-sm font-semibold text-[#5C4738]">Failure Category {confirmationForm.is_final ? '*' : ''}<select required={confirmationForm.is_final} value={confirmationForm.failure_category} onChange={(event) => setConfirmationForm({ ...confirmationForm, failure_category: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2"><option value="">Select failure category</option><option value="ELECTRICAL">Electrical</option><option value="MECHANICAL">Mechanical</option><option value="SOFTWARE">Software / Firmware</option><option value="INSTALLATION">Installation</option><option value="OPERATOR_ERROR">Operator Error</option><option value="ENVIRONMENTAL">Environmental</option><option value="WEAR_AND_TEAR">Wear &amp; Tear</option><option value="NO_FAULT_FOUND">No Fault Found</option><option value="OTHER">Other</option></select></label>
                  <label className="text-sm font-semibold text-[#5C4738]">Root Cause {confirmationForm.is_final ? '*' : ''}<textarea required={confirmationForm.is_final} rows={2} value={confirmationForm.root_cause} onChange={(event) => setConfirmationForm({ ...confirmationForm, root_cause: event.target.value })} placeholder="Verified technical cause of the failure" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                  <label className="text-sm font-semibold text-[#5C4738]">Corrective Action {confirmationForm.is_final ? '*' : ''}<textarea required={confirmationForm.is_final} rows={2} value={confirmationForm.corrective_action} onChange={(event) => setConfirmationForm({ ...confirmationForm, corrective_action: event.target.value })} placeholder="Repair, replacement or adjustment completed" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                  <label className="text-sm font-semibold text-[#5C4738]">Preventive Action<textarea rows={2} value={confirmationForm.preventive_action} onChange={(event) => setConfirmationForm({ ...confirmationForm, preventive_action: event.target.value })} placeholder="Recommendation to prevent recurrence (optional)" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                </div>
              </div>
              <label className="block text-sm font-semibold text-[#5C4738]">Work Performed *<textarea required rows={4} value={confirmationForm.work_performed} onChange={(e) => setConfirmationForm({ ...confirmationForm, work_performed: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
              <label className="block text-sm font-semibold text-[#5C4738]">Technician Remarks<textarea rows={2} value={confirmationForm.technician_remarks} onChange={(e) => setConfirmationForm({ ...confirmationForm, technician_remarks: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-[#5C4738]">Customer Sign-off Name {confirmationForm.is_final ? '*' : ''}<input required={confirmationForm.is_final} value={confirmationForm.customer_signoff_name} onChange={(e) => setConfirmationForm({ ...confirmationForm, customer_signoff_name: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="flex items-center gap-2 pt-7 text-sm font-semibold text-[#5C4738]"><input type="checkbox" checked={confirmationForm.is_final} onChange={(e) => setConfirmationForm({ ...confirmationForm, is_final: e.target.checked })} /> Final confirmation / complete service</label>
              </div>
              <div className="flex justify-end gap-3"><button type="button" onClick={() => { setConfirmationTicket(null); setConfirmationVarianceFile(null); }} className="rounded-md border px-4 py-2">Cancel</button><button type="submit" disabled={loading || (confirmationVariancePreview > 0.005 && (!confirmationForm.variance_reason.trim() || (!confirmationForm.variance_approval_reference.trim() && !confirmationVarianceFile)))} className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Posting...' : 'Post Confirmation'}</button></div>
            </form>
          </div>
        </div>
      )}

      {documentFlow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[94vh] w-full max-w-6xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Call Log / Document Trail</div><h3 className="text-xl font-bold text-[#3F2D20]">{documentFlow.ticket?.ticket_number}</h3></div>
              <div className="flex items-center gap-2"><button type="button" onClick={() => printServiceCallReport(documentFlow)} className="rounded-md border border-[#D9C9AD] px-3 py-2 text-xs font-semibold text-[#6F4E37]">Print Service Report</button><button type="button" onClick={() => setDocumentFlow(null)} className="text-2xl text-[#6F4E37]" aria-label="Close document trail">&times;</button></div>
            </div>
            <div className="space-y-5 p-6">
              <div className="grid gap-3 md:grid-cols-4">
                {[['Customer', documentFlow.ticket?.customer?.customer_name || '-'], ['Status', documentFlow.ticket?.status || '-'], ['Product / UID', documentFlow.ticket?.product_name || documentFlow.ticket?.uid || '-'], ['Billing', documentFlow.ticket?.billing_status || 'NOT BILLED']].map(([label, value]) => <div key={label} className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className="mt-1 font-semibold">{value}</div></div>)}
              </div>
              {(() => {
                const visits = documentFlow.visits || [];
                const confirmations = documentFlow.confirmations || [];
                const parts = documentFlow.parts || [];
                const invoices = (documentFlow.invoices || []).filter((invoice: any) => invoice.billing_status !== 'CANCELLED');
                const technicians = [...new Set([
                  ...(documentFlow.assignments || []).map((assignment: any) => assignment.technician?.technician_name),
                  ...visits.map((visit: any) => visit.assignment?.technician?.technician_name),
                ].filter(Boolean))];
                const evidence = [
                  ...(documentFlow.ticket?.attachments || []),
                  ...visits.flatMap((visit: any) => [...(visit.before_attachments || []), ...(visit.after_attachments || [])]),
                  ...confirmations.flatMap((confirmation: any) => confirmation.attachments || []),
                ];
                const startAt = visits.map((visit: any) => visit.check_in_at).filter(Boolean).sort()[0]
                  || (documentFlow.assignments || []).map((assignment: any) => assignment.actual_start_date || assignment.scheduled_start_date).filter(Boolean).sort()[0]
                  || documentFlow.ticket?.complaint_date;
                const visitEndDates = visits.map((visit: any) => visit.check_out_at).filter(Boolean).sort();
                const endAt = visitEndDates[visitEndDates.length - 1] || documentFlow.ticket?.actual_completion_date;
                const servicesDone = confirmations.map((confirmation: any) => confirmation.work_performed).filter(Boolean).join('; ')
                  || visits.map((visit: any) => visit.work_notes).filter(Boolean).join('; ')
                  || 'Service work not yet confirmed';
                const partsQuantity = parts.reduce((sum: number, part: any) => sum + Number(part.quantity || 0), 0);
                const billableParts = parts.filter((part: any) => part.charged_to_customer).reduce((sum: number, part: any) => sum + Number(part.total_cost || 0), 0);
                const invoiceTotal = invoices.reduce((sum: number, invoice: any) => sum + Number(invoice.net_amount || 0), 0);
                const paidTotal = invoices.reduce((sum: number, invoice: any) => sum + Number(invoice.paid_amount || 0), 0);
                const warrantyCovered = Boolean(documentFlow.ticket?.is_under_warranty)
                  || String(documentFlow.ticket?.entitlement_status || '').toUpperCase() === 'WARRANTY';
                return <div className="rounded-md border border-[#D9C9AD] bg-[#FCF9F3]">
                  <div className="border-b border-[#E8DCC4] px-4 py-3"><div className="text-sm font-bold text-[#3F2D20]">Service Call Log</div><div className="text-xs text-[#7A6756]">Consolidated craft, execution, evidence, parts and billing record.</div></div>
                  <div className="grid gap-px bg-[#E8DCC4] sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ['Craft Serial No.', documentFlow.ticket?.serial_number || documentFlow.ticket?.uid || '-'],
                      ['Technician Name', technicians.join(', ') || 'Not assigned'],
                      ['Service Start', startAt ? new Date(startAt).toLocaleString('en-IN') : '-'],
                      ['Service End', endAt ? new Date(endAt).toLocaleString('en-IN') : 'In progress'],
                      ['Parts Used', `${parts.length} line(s) / ${partsQuantity.toLocaleString('en-IN')} qty`],
                      ['Parts Billing', formatRegionalCurrency(billableParts, regionalProfile)],
                      ['Invoice / Paid', `${formatRegionalCurrency(invoiceTotal, regionalProfile)} / ${formatRegionalCurrency(paidTotal, regionalProfile)}`],
                      ['Service Charge', warrantyCovered ? 'WAIVED - UNDER WARRANTY' : (documentFlow.ticket?.billing_status || 'NOT BILLED').replaceAll('_', ' ')],
                    ].map(([label, value]) => <div key={label} className="bg-white p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className={`mt-1 text-sm font-semibold ${label === 'Service Charge' && warrantyCovered ? 'text-green-800' : 'text-[#3F2D20]'}`}>{value}</div></div>)}
                  </div>
                  <div className="grid gap-4 border-t border-[#E8DCC4] bg-white p-4 md:grid-cols-[1fr_auto]">
                    <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Services Done</div><div className="mt-1 text-sm text-[#3F2D20]">{servicesDone}</div></div>
                    <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Photos / Videos</div><div className="mt-2 flex max-w-sm flex-wrap gap-1">{evidence.map((url: string, index: number) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="rounded border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700">Evidence {index + 1}</a>)}{!evidence.length && <span className="text-sm text-[#7A6756]">No evidence attached</span>}</div></div>
                  </div>
                </div>;
              })()}
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]"><table className="min-w-full divide-y divide-[#E8DCC4]"><thead className="bg-[#F6EFE2]"><tr>{['Service Estimate', 'Revision', 'Date', 'Validity', 'Value', 'Customer Approval', 'Approval Evidence'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{h}</th>)}</tr></thead><tbody className="divide-y divide-[#EFE5D2]">{(documentFlow.estimates || []).map((estimate: any) => <tr key={estimate.id}><td className="px-4 py-3 text-sm font-semibold">{estimate.estimate_number}</td><td className="px-4 py-3 text-sm">R{estimate.revision_no || 0}</td><td className="px-4 py-3 text-sm">{estimate.estimate_date}</td><td className="px-4 py-3 text-sm">{estimate.valid_until || '-'}</td><td className="px-4 py-3 text-right text-sm">{formatRegionalCurrency(Number(estimate.total_amount || 0), regionalProfile)}</td><td className="px-4 py-3 text-sm">{String(estimate.status || '').replaceAll('_', ' ')}</td><td className="px-4 py-3 text-sm"><div>{estimate.approval_reference || '-'}</div>{estimate.approval_attachment_url && <a href={estimate.approval_attachment_url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-blue-700 underline">View authorization</a>}</td></tr>)}{!(documentFlow.estimates || []).length && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-[#7A6756]">No commercial estimate required or recorded.</td></tr>}</tbody></table></div>
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]">
                <div className="flex items-center justify-between border-b border-[#E8DCC4] bg-[#FFFDF7] px-4 py-3">
                  <div><div className="text-sm font-bold text-[#3F2D20]">Controlled Service Checklist</div><div className="text-xs text-[#7A6756]">Quality steps completed by the service team before final confirmation.</div></div>
                  <span className="rounded-full bg-[#F6EFE2] px-3 py-1 text-xs font-bold text-[#6F4E37]">{(documentFlow.checklist || []).filter((item: ServiceTicketChecklistItem) => item.status === 'COMPLETED' || item.status === 'NOT_APPLICABLE').length} / {(documentFlow.checklist || []).length} cleared</span>
                </div>
                <table className="min-w-full divide-y divide-[#E8DCC4]">
                  <thead className="bg-[#F6EFE2]"><tr>{['Step', 'Requirement', 'Status', 'Remarks', 'Completed At'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{heading}</th>)}</tr></thead>
                  <tbody className="divide-y divide-[#EFE5D2]">
                    {(documentFlow.checklist || []).map((item: ServiceTicketChecklistItem) => <tr key={item.id}><td className="px-4 py-3 text-sm font-semibold">{item.sort_order}. {item.item_text}</td><td className="px-4 py-3 text-sm">{item.is_required ? 'Mandatory' : 'Optional'}</td><td className="px-4 py-3 text-sm"><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : item.status === 'NOT_APPLICABLE' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>{String(item.status || 'PENDING').replaceAll('_', ' ')}</span></td><td className="px-4 py-3 text-sm">{item.remarks || '-'}</td><td className="px-4 py-3 text-sm">{item.completed_at ? new Date(item.completed_at).toLocaleString('en-IN') : '-'}</td></tr>)}
                    {!(documentFlow.checklist || []).length && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-[#7A6756]">No controlled checklist assigned to this ticket.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]">
                <table className="min-w-full divide-y divide-[#E8DCC4]">
                  <thead className="bg-[#F6EFE2]"><tr>{['Site Visit', 'Service Person', 'Client Contact', 'Check In', 'Check Out', 'Location / Work', 'Evidence / Report'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-[#EFE5D2]">
                    {(documentFlow.visits || []).map((visit: ServiceSiteVisit) => {
                      const evidence = [...(visit.before_attachments || []), ...(visit.after_attachments || [])];
                      return <tr key={visit.id}>
                        <td className="px-4 py-3 text-sm font-semibold">Visit {visit.visit_number}<div className="text-xs font-normal text-[#7A6756]">{visit.status.replaceAll('_', ' ')}</div></td>
                        <td className="px-4 py-3 text-sm">{visit.assignment?.technician?.technician_name || '-'}</td>
                        <td className="px-4 py-3 text-sm"><div className="font-semibold">{visit.site_contact_name}</div><div className="text-xs text-[#7A6756]">{visit.site_contact_designation || ''} {visit.site_contact_mobile || ''}</div><div className="text-xs">Acknowledged: {visit.customer_acknowledgement_name || '-'}</div></td>
                        <td className="px-4 py-3 text-sm">{new Date(visit.check_in_at).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-sm">{visit.check_out_at ? new Date(visit.check_out_at).toLocaleString('en-IN') : '-'}</td>
                        <td className="px-4 py-3 text-sm"><div>{visit.check_out_location || visit.check_in_location || '-'}</div><div className="mt-1 text-xs text-[#7A6756]">{visit.work_notes || visit.purpose || '-'}</div></td>
                        <td className="px-4 py-3 text-sm"><div className="flex flex-wrap gap-1">{evidence.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="rounded border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700">Evidence {index + 1}</a>)}<button type="button" onClick={() => printSiteVisitReport(documentFlow.ticket, visit)} className="rounded border border-[#D9C9AD] px-2 py-1 text-xs font-semibold text-[#6F4E37]">Print Report</button></div></td>
                      </tr>;
                    })}
                    {!(documentFlow.visits || []).length && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-[#7A6756]">No field-service site visit recorded.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]"><table className="min-w-full divide-y divide-[#E8DCC4]"><thead className="bg-[#F6EFE2]"><tr>{['Service Stock Issue', 'Part', 'Quantity', 'UID Trace', 'Warranty', 'Value / Charge', 'Return Lifecycle', 'Issued At'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{h}</th>)}</tr></thead><tbody className="divide-y divide-[#EFE5D2]">{(documentFlow.parts || []).map((part: any) => <tr key={part.id}><td className="px-4 py-3 text-sm font-semibold">{part.stock_movement?.movement_number || '-'}</td><td className="px-4 py-3 text-sm">{part.part_code ? `${part.part_code} - ` : ''}{part.part_name || '-'}</td><td className="px-4 py-3 text-right text-sm">{Number(part.quantity || 0).toLocaleString('en-IN')}</td><td className="px-4 py-3 text-xs"><div>Out: {part.old_part_uid || '-'}</div><div>In: {part.new_part_uid || '-'}</div></td><td className="px-4 py-3 text-xs">{part.replacement_warranty_end ? `Until ${new Date(part.replacement_warranty_end).toLocaleDateString('en-IN')}` : '-'}</td><td className="px-4 py-3 text-right text-sm"><div>Rs. {Number(part.total_cost || (Number(part.quantity || 0) * Number(part.unit_price || 0))).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="text-xs text-[#7A6756]">{part.charged_to_customer ? 'Billable' : 'Warranty / no charge'}</div></td><td className="px-4 py-3 text-xs"><div className="font-semibold">{String(part.return_status || 'NOT REQUIRED').replaceAll('_', ' ')}</div>{part.return_reference && <div>{part.return_reference}</div>}{canEdit && part.return_required && !['CREDIT_RECEIVED', 'SCRAPPED'].includes(part.return_status) && <button type="button" onClick={() => advancePartReturn(part)} className="mt-1 rounded border px-2 py-1 font-semibold">Advance return</button>}</td><td className="px-4 py-3 text-sm">{part.issued_at ? new Date(part.issued_at).toLocaleString('en-IN') : '-'}</td></tr>)}{!(documentFlow.parts || []).length && <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-[#7A6756]">No service parts issued.</td></tr>}</tbody></table></div>
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]"><table className="min-w-full divide-y divide-[#E8DCC4]"><thead className="bg-[#F6EFE2]"><tr>{['Confirmation', 'Date', 'Diagnosis / RCA', 'Work Performed', 'Value', 'Estimate Control', 'Status', 'Billing Action'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{h}</th>)}</tr></thead><tbody className="divide-y divide-[#EFE5D2]">{(documentFlow.confirmations || []).map((confirmation: any) => { const billed = (documentFlow.invoices || []).some((invoice: any) => invoice.service_confirmation_id === confirmation.id); return <tr key={confirmation.id}><td className="px-4 py-3 text-sm font-semibold">{confirmation.confirmation_number}</td><td className="px-4 py-3 text-sm">{new Date(confirmation.confirmation_date).toLocaleDateString()}</td><td className="min-w-[260px] px-4 py-3 text-xs"><div className="font-bold">{String(confirmation.failure_category || 'Not captured').replaceAll('_', ' ')}</div><div className="mt-1"><span className="font-semibold">Root cause:</span> {confirmation.root_cause || '-'}</div><div><span className="font-semibold">Corrective:</span> {confirmation.corrective_action || '-'}</div>{confirmation.preventive_action && <div><span className="font-semibold">Preventive:</span> {confirmation.preventive_action}</div>}</td><td className="px-4 py-3 text-sm">{confirmation.work_performed}</td><td className="px-4 py-3 text-right text-sm">Rs. {Number(confirmation.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="px-4 py-3 text-xs"><div>Approved: Rs. {Number(confirmation.approved_estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div><div className={Number(confirmation.estimate_variance_amount || 0) > 0 ? 'font-semibold text-red-700' : 'text-green-700'}>Variance: Rs. {Number(confirmation.estimate_variance_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>{confirmation.variance_reason && <div className="mt-1">{confirmation.variance_reason}</div>}{confirmation.variance_approval_reference && <div>Auth: {confirmation.variance_approval_reference}</div>}{confirmation.variance_approval_attachment_url && <a href={confirmation.variance_approval_attachment_url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">View authorization</a>}</td><td className="px-4 py-3 text-sm">{confirmation.status}</td><td className="px-4 py-3">{confirmation.status === 'COMPLETED' && Number(confirmation.total_amount || 0) > 0 && !billed ? <button type="button" onClick={() => openServiceBillingRelease(confirmation)} disabled={!canCreate} className="rounded-md border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Review &amp; Release</button> : <span className="text-xs text-[#7A6756]">{billed ? 'Invoiced' : 'Not billable'}</span>}</td></tr>; })}</tbody></table></div>
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]"><table className="min-w-full divide-y divide-[#E8DCC4]"><thead className="bg-[#F6EFE2]"><tr>{['Invoice / Receipt', 'Date', 'Document', 'Status', 'Amount', 'Action'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{h}</th>)}</tr></thead><tbody className="divide-y divide-[#EFE5D2]">{(documentFlow.invoices || []).flatMap((invoice: any) => [<tr key={invoice.id}><td className="px-4 py-3 text-sm font-semibold">{invoice.invoice_number}</td><td className="px-4 py-3 text-sm">{invoice.invoice_date}</td><td className="px-4 py-3 text-sm">Customer Invoice</td><td className="px-4 py-3 text-sm">{invoice.billing_status === 'CANCELLED' ? 'CANCELLED' : invoice.payment_status}</td><td className="px-4 py-3 text-right text-sm">Rs. {Number(invoice.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="px-4 py-3">{canEdit && invoice.billing_status !== 'CANCELLED' && Number(invoice.paid_amount || 0) <= 0 && <button type="button" onClick={() => cancelServiceInvoice(invoice)} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700">Cancel Invoice</button>}</td></tr>, ...(invoice.payments || []).map((payment: any) => <tr key={payment.id}><td className="px-4 py-3 text-sm font-semibold">{payment.receipt_number}</td><td className="px-4 py-3 text-sm">{payment.receipt_date}</td><td className="px-4 py-3 text-sm">Customer Receipt</td><td className="px-4 py-3 text-sm">{payment.reversed_at ? 'REVERSED' : 'POSTED'}</td><td className="px-4 py-3 text-right text-sm">Rs. {Number(payment.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="px-4 py-3">{canEdit && !payment.reversed_at && <button type="button" onClick={() => reverseServiceReceipt(invoice, payment)} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700">Reverse</button>}</td></tr>)])}</tbody></table></div>
              <div className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Customer Satisfaction</div><div className="mt-1 text-sm text-[#7A6756]">Final customer response retained in the service document trail.</div></div>{documentFlow.feedback ? <span className="rounded-full bg-green-100 px-3 py-1 font-bold text-green-800">{documentFlow.feedback.overall_rating} / 5</span> : <span className="text-sm font-semibold text-[#7A6756]">Not recorded</span>}</div>{documentFlow.feedback?.feedback_text && <div className="mt-3 text-sm">{documentFlow.feedback.feedback_text}</div>}</div>
              <div className="flex justify-end"><button type="button" onClick={() => setDocumentFlow(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Close</button></div>
            </div>
          </div>
        </div>
      )}

      {billingReleaseConfirmation && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
          <form onSubmit={releaseServiceInvoice} className="w-full max-w-2xl rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Billing Release</div><h3 className="text-xl font-bold text-[#3F2D20]">{billingReleaseConfirmation.confirmation_number}</h3><p className="text-sm text-[#7A6756]">Review the billing document controls before posting the customer invoice.</p></div>
              <button type="button" onClick={() => setBillingReleaseConfirmation(null)} className="text-2xl text-[#6F4E37]" aria-label="Close billing release">&times;</button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Taxable Value</div><div className="mt-1 text-lg font-bold">{serviceAmount(billingReleaseConfirmation.subtotal)}</div></div>
                <div className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{regionalProfile.taxLabel}</div><div className="mt-1 text-lg font-bold">{serviceAmount(billingReleaseConfirmation.tax_amount)}</div></div>
                <div className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">Invoice Value</div><div className="mt-1 text-lg font-bold text-green-800">{serviceAmount(billingReleaseConfirmation.total_amount)}</div></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-[#5C4738]">Invoice Date *<DateInput min={String(billingReleaseConfirmation.confirmation_date || '').slice(0, 10)} max={todayDate} required value={billingReleaseForm.invoice_date} onChange={(value) => setBillingReleaseForm({ ...billingReleaseForm, invoice_date: value, due_date: billingReleaseForm.due_date < value ? addCalendarDays(value, 30) : billingReleaseForm.due_date })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                <label className="text-sm font-semibold text-[#5C4738]">Payment Due Date *<DateInput min={billingReleaseForm.invoice_date} required value={billingReleaseForm.due_date} onChange={(value) => setBillingReleaseForm({ ...billingReleaseForm, due_date: value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
              </div>
              <label className="block text-sm font-semibold text-[#5C4738]">Billing Notes<textarea rows={3} value={billingReleaseForm.notes} onChange={(event) => setBillingReleaseForm({ ...billingReleaseForm, notes: event.target.value })} placeholder="Customer PO, billing milestone, or internal reference" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
              {Number(billingReleaseConfirmation.estimate_variance_amount || 0) > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><strong>Authorized estimate variance:</strong> Rs. {Number(billingReleaseConfirmation.estimate_variance_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} · {billingReleaseConfirmation.variance_approval_reference || 'Supporting authorization attached'}</div>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] px-6 py-4"><button type="button" onClick={() => setBillingReleaseConfirmation(null)} className="rounded-md border px-4 py-2">Cancel</button><button type="submit" disabled={loading || !billingReleaseForm.invoice_date || !billingReleaseForm.due_date} className="rounded-md bg-blue-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Posting Invoice...' : 'Post Customer Invoice'}</button></div>
          </form>
        </div>
      )}

      {viewingServiceInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] px-6 py-4">
              <div><div className="text-xs font-bold uppercase text-[#8B6F47]">Customer Service Invoice</div><h3 className="text-xl font-bold text-[#3F2D20]">{viewingServiceInvoice.invoice_number}</h3></div>
              <button type="button" onClick={() => setViewingServiceInvoice(null)} className="text-2xl text-[#6F4E37]" aria-label="Close service invoice">&times;</button>
            </div>
            <div className="space-y-5 p-6">
              <div className="grid gap-3 md:grid-cols-4">
                {[['Customer', viewingServiceInvoice.customer?.customer_name || '-'], ['Service Ticket', viewingServiceInvoice.ticket?.ticket_number || '-'], ['Invoice Date', new Date(viewingServiceInvoice.invoice_date).toLocaleDateString('en-IN')], ['Status', viewingServiceInvoice.billing_status === 'CANCELLED' ? 'CANCELLED' : viewingServiceInvoice.payment_status]].map(([label, value]) => <div key={label} className="rounded-md border border-[#E8DCC4] bg-[#FFFDF7] p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className="mt-1 font-semibold">{value}</div></div>)}
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {[['Taxable Value', viewingServiceInvoice.taxable_amount], [regionalProfile.taxLabel, viewingServiceInvoice.tax_amount], ['Invoice Total', viewingServiceInvoice.net_amount], ['Outstanding', viewingServiceInvoice.balance_amount]].map(([label, value]) => <div key={label as string} className="rounded-md border border-[#E8DCC4] p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className="mt-1 text-lg font-bold">{formatRegionalCurrency(Number(value || 0), regionalProfile)}</div></div>)}
              </div>
              {viewingServiceInvoice.confirmation && <div className="rounded-md border border-[#E8DCC4] p-4"><div className="mb-2 text-sm font-bold text-[#3F2D20]">Service Confirmation {viewingServiceInvoice.confirmation.confirmation_number}</div><p className="text-sm text-[#5C4738]">{viewingServiceInvoice.confirmation.work_performed || '-'}</p><div className="mt-3 grid gap-2 text-sm md:grid-cols-4"><span>Labor: Rs. {Number(viewingServiceInvoice.confirmation.labor_hours || 0) * Number(viewingServiceInvoice.confirmation.labor_rate || 0)}</span><span>Parts: Rs. {Number(viewingServiceInvoice.confirmation.parts_amount || 0)}</span><span>Travel: Rs. {Number(viewingServiceInvoice.confirmation.travel_cost || 0)}</span><span>Other: Rs. {Number(viewingServiceInvoice.confirmation.other_amount || 0)}</span></div></div>}
              {!!viewingServiceInvoice.service_parts?.length && <div className="overflow-x-auto rounded-md border border-[#E8DCC4]"><div className="border-b border-[#E8DCC4] bg-[#FFFDF7] px-4 py-3 text-sm font-bold text-[#3F2D20]">Replacement Parts</div><table className="min-w-full divide-y divide-[#E8DCC4]"><thead className="bg-[#F6EFE2]"><tr>{['Part', 'Replacement UID', 'Quantity', 'Unit Price', 'Line Value', 'Charge'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#EFE5D2]">{viewingServiceInvoice.service_parts.map((part: any) => <tr key={part.id}><td className="px-4 py-3 text-sm">{part.part_code ? `${part.part_code} - ` : ''}{part.part_name}</td><td className="px-4 py-3 text-sm">{part.new_part_uid || '-'}</td><td className="px-4 py-3 text-right text-sm">{Number(part.quantity || 0).toLocaleString('en-IN')}</td><td className="px-4 py-3 text-right text-sm">Rs. {Number(part.unit_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="px-4 py-3 text-right text-sm">Rs. {Number(part.total_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="px-4 py-3 text-sm">{part.charged_to_customer ? 'Billable' : 'Warranty / no charge'}</td></tr>)}</tbody></table></div>}
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]"><table className="min-w-full divide-y divide-[#E8DCC4]"><thead className="bg-[#F6EFE2]"><tr>{['Receipt', 'Date', 'Method / Reference', 'Amount', 'Status', 'Action'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-[#5C4738]">{h}</th>)}</tr></thead><tbody className="divide-y divide-[#EFE5D2]">{(viewingServiceInvoice.payments || []).map((payment: any) => <tr key={payment.id}><td className="px-4 py-3 text-sm font-semibold">{payment.receipt_number}</td><td className="px-4 py-3 text-sm">{new Date(payment.receipt_date).toLocaleDateString('en-IN')}</td><td className="px-4 py-3 text-sm">{payment.payment_method}{payment.payment_reference ? ` / ${payment.payment_reference}` : ''}</td><td className="px-4 py-3 text-right text-sm">Rs. {Number(payment.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="px-4 py-3 text-sm">{payment.reversed_at ? 'REVERSED' : 'POSTED'}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => downloadServiceReceiptPdf(viewingServiceInvoice, payment)} className="rounded-md border border-[#D9C9AD] px-2 py-1 text-xs font-semibold text-[#6F4E37]">Download PDF</button>{canEdit && !payment.reversed_at && <button type="button" onClick={() => emailServiceReceipt(viewingServiceInvoice, payment)} className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700">Email Receipt</button>}{canEdit && !payment.reversed_at && <button type="button" onClick={() => reverseServiceReceipt(viewingServiceInvoice, payment)} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700">Reverse</button>}</div></td></tr>)}{!(viewingServiceInvoice.payments || []).length && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-[#7A6756]">No customer receipts posted.</td></tr>}</tbody></table></div>
              <div className="flex justify-end gap-3"><button type="button" onClick={() => downloadServiceInvoicePdf(viewingServiceInvoice)} className="rounded-md border border-[#8B6F47] px-4 py-2 font-semibold text-[#6F4E37]">Download PDF</button>{viewingServiceInvoice.billing_status !== 'CANCELLED' && <button type="button" onClick={() => emailServiceInvoice(viewingServiceInvoice)} className="rounded-md border border-blue-300 px-4 py-2 font-semibold text-blue-700">Email Invoice</button>}{canEdit && viewingServiceInvoice.billing_status !== 'CANCELLED' && Number(viewingServiceInvoice.balance_amount || 0) > 0 && <button type="button" onClick={() => { setServiceReceiptInvoice(viewingServiceInvoice); setServiceReceiptForm((current) => ({ ...current, amount: String(viewingServiceInvoice.balance_amount) })); }} className="rounded-md bg-green-700 px-4 py-2 font-semibold text-white">Record Receipt</button>}<button type="button" onClick={() => setViewingServiceInvoice(null)} className="rounded-md border border-[#D9C9AD] px-4 py-2 font-semibold text-[#6F4E37]">Close</button></div>
            </div>
          </div>
        </div>
      )}

      {serviceCollectionInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"><form onSubmit={handleServiceCollectionFollowUp} className="w-full max-w-xl rounded-lg bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Receivable</div><h3 className="text-xl font-bold">Collection Follow-up</h3><p className="text-sm text-[#7A6756]">{serviceCollectionInvoice.invoice_number} · Rs. {Number(serviceCollectionInvoice.balance_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} outstanding</p></div><button type="button" onClick={() => setServiceCollectionInvoice(null)} className="text-2xl" aria-label="Close service collection follow-up">&times;</button></div>
          <div className="grid gap-4 p-6 md:grid-cols-2">
            <label className="text-sm font-semibold">Collection Status *<select required value={serviceCollectionForm.collection_status} onChange={(e) => setServiceCollectionForm({ ...serviceCollectionForm, collection_status: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2"><option value="CONTACTED">Contacted</option><option value="PROMISED">Promise to Pay</option><option value="DISPUTED">Disputed</option><option value="ESCALATED">Escalated</option><option value="NOT_STARTED">Not Started</option></select></label>
            <label className="text-sm font-semibold">Next Follow-up<DateInput value={serviceCollectionForm.next_follow_up_date} onChange={(value) => setServiceCollectionForm({ ...serviceCollectionForm, next_follow_up_date: value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
            {serviceCollectionForm.collection_status === 'PROMISED' && <label className="text-sm font-semibold">Promise-to-pay Date *<DateInput required value={serviceCollectionForm.promise_to_pay_date} onChange={(value) => setServiceCollectionForm({ ...serviceCollectionForm, promise_to_pay_date: value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>}
            <label className="block text-sm font-semibold md:col-span-2">Follow-up Notes *<textarea required rows={3} value={serviceCollectionForm.notes} onChange={(e) => setServiceCollectionForm({ ...serviceCollectionForm, notes: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
          </div><div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => setServiceCollectionInvoice(null)} className="rounded-md border px-4 py-2">Cancel</button><button type="submit" className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white">Save Follow-up</button></div>
        </form></div>
      )}

      {serviceReceiptInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Receivable</div><h3 className="text-xl font-bold">{serviceReceiptInvoice.invoice_number}</h3></div><button type="button" onClick={() => setServiceReceiptInvoice(null)} className="text-2xl" aria-label="Close service receipt">&times;</button></div>
          <form onSubmit={handleServiceReceipt} className="grid gap-4 p-6 md:grid-cols-2">
            <label className="text-sm font-semibold">Amount *<input type="number" min="0.01" step="0.01" required value={serviceReceiptForm.amount} onChange={(e) => setServiceReceiptForm({ ...serviceReceiptForm, amount: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
            <label className="text-sm font-semibold">Receipt Date *<DateInput max={todayDate} required value={serviceReceiptForm.receipt_date} onChange={(value) => setServiceReceiptForm({ ...serviceReceiptForm, receipt_date: value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
            <label className="text-sm font-semibold">Method *<select value={serviceReceiptForm.payment_method} onChange={(e) => setServiceReceiptForm({ ...serviceReceiptForm, payment_method: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2"><option value="NEFT">NEFT / RTGS</option><option value="UPI">UPI</option><option value="CHEQUE">Cheque</option><option value="CASH">Cash</option></select></label>
            <label className="text-sm font-semibold">Reference {serviceReceiptForm.payment_method !== 'CASH' ? '*' : ''}<input required={serviceReceiptForm.payment_method !== 'CASH'} value={serviceReceiptForm.payment_reference} onChange={(e) => setServiceReceiptForm({ ...serviceReceiptForm, payment_reference: e.target.value })} placeholder={serviceReceiptForm.payment_method === 'CASH' ? 'Optional cash receipt reference' : 'Required UTR / cheque / transaction no.'} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
            <div className="col-span-full flex justify-end gap-3"><button type="button" onClick={() => setServiceReceiptInvoice(null)} className="rounded-md border px-4 py-2">Cancel</button><button type="submit" className="rounded-md bg-[#8B6F47] px-4 py-2 font-semibold text-white">Post Receipt</button></div>
          </form>
        </div></div>
      )}

      {showAssetForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"><form onSubmit={saveInstalledAsset} className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Installed Base</div><h3 className="text-xl font-bold">{editingAssetId ? 'Edit Installed Asset' : 'Register Installed Asset'}</h3></div><button type="button" onClick={() => setShowAssetForm(false)} className="text-2xl" aria-label="Close installed asset">&times;</button></div><div className="grid gap-4 p-6 md:grid-cols-2">
          <label className="text-sm font-semibold">Customer *<select required value={assetForm.customer_id} onChange={(e) => setAssetForm({ ...assetForm, customer_id: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_code} - {customer.customer_name}</option>)}</select></label>
          <label className="text-sm font-semibold">Asset Name *<input required value={assetForm.asset_name} onChange={(e) => setAssetForm({ ...assetForm, asset_name: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Item<SearchableSelect options={items.map((item) => ({ value: item.id, label: item.code, subtitle: item.name }))} value={assetForm.item_id} onChange={(value) => { const item = items.find((entry) => entry.id === value); setAssetForm({ ...assetForm, item_id: value, asset_name: assetForm.asset_name || item?.name || '' }); }} placeholder="Search item" /></label>
          <label className="text-sm font-semibold">UID<input value={assetForm.uid} onChange={(e) => setAssetForm({ ...assetForm, uid: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Serial Number<input value={assetForm.serial_number} onChange={(e) => setAssetForm({ ...assetForm, serial_number: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Parent Equipment<select value={assetForm.parent_asset_id} onChange={(e) => setAssetForm({ ...assetForm, parent_asset_id: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Top-level equipment</option>{installedAssets.filter((asset) => asset.customer_id === assetForm.customer_id && asset.id !== editingAssetId).map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_number} - {asset.asset_name}</option>)}</select></label>
          <label className="text-sm font-semibold">Functional Location<input value={assetForm.functional_location} onChange={(e) => setAssetForm({ ...assetForm, functional_location: e.target.value })} placeholder="Plant / vessel / system / position" className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Criticality<select value={assetForm.criticality} onChange={(e) => setAssetForm({ ...assetForm, criticality: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label>
          <label className="text-sm font-semibold">Manufacturer<input value={assetForm.manufacturer} onChange={(e) => setAssetForm({ ...assetForm, manufacturer: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Model Number<input value={assetForm.model_number} onChange={(e) => setAssetForm({ ...assetForm, model_number: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Installation Date<DateInput max={todayDate} value={assetForm.installation_date} onChange={(value) => setAssetForm({ ...assetForm, installation_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Warranty Until<DateInput value={assetForm.warranty_until} onChange={(value) => setAssetForm({ ...assetForm, warranty_until: value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Status<select value={assetForm.status} onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option>ACTIVE</option><option>INACTIVE</option><option>DECOMMISSIONED</option></select></label>
          <label className="text-sm font-semibold md:col-span-2">Location<input value={assetForm.location} onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold md:col-span-2">Notes<textarea rows={3} value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
        </div><div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => setShowAssetForm(false)} className="rounded border px-4 py-2">Cancel</button><button disabled={loading} type="submit" className="rounded bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Save Asset</button></div></form></div>
      )}

      {assetMeters && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Equipment Meter Log</div><h3 className="text-xl font-bold">{assetMeters.asset.asset_number} - {assetMeters.asset.asset_name}</h3></div><button onClick={() => setAssetMeters(null)} className="text-2xl" aria-label="Close meters">&times;</button></div>
          <div className="space-y-4 p-6"><div className="grid gap-3 rounded-md border bg-[#FFFDF7] p-4 md:grid-cols-5"><input value={meterForm.meter_name} onChange={(e) => setMeterForm({ ...meterForm, meter_name: e.target.value })} placeholder="Meter name" className="rounded border px-3 py-2" /><select value={meterForm.meter_type} onChange={(e) => setMeterForm({ ...meterForm, meter_type: e.target.value })} className="rounded border px-3 py-2"><option value="RUNNING_HOURS">Running hours</option><option value="ODOMETER">Odometer</option><option value="CYCLES">Cycles</option><option value="CUSTOM">Custom</option></select><input value={meterForm.uom} onChange={(e) => setMeterForm({ ...meterForm, uom: e.target.value.toUpperCase() })} placeholder="UOM" className="rounded border px-3 py-2" /><input type="number" min="0" step="0.001" value={meterForm.initial_reading} onChange={(e) => setMeterForm({ ...meterForm, initial_reading: e.target.value })} placeholder="Initial reading" className="rounded border px-3 py-2" /><button onClick={createAssetMeter} type="button" className="rounded bg-amber-600 px-4 py-2 font-semibold text-white">Add Meter</button></div>
            <div className="overflow-x-auto rounded-md border"><table className="min-w-full"><thead className="bg-[#F6EFE2]"><tr>{['Meter', 'UOM', 'Latest Reading', 'Reading Date', 'New Reading', 'Action'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase">{heading}</th>)}</tr></thead><tbody className="divide-y">{assetMeters.meters.map((meter: any) => <tr key={meter.id}><td className="px-4 py-3 font-semibold">{meter.meter_name}</td><td className="px-4 py-3">{meter.uom}</td><td className="px-4 py-3">{meter.latest_reading?.reading_value ?? '-'}</td><td className="px-4 py-3">{meter.latest_reading?.reading_at ? new Date(meter.latest_reading.reading_at).toLocaleString('en-IN') : '-'}</td><td className="px-4 py-3"><input type="number" min="0" step="0.001" value={meterReadingForm[meter.id] || ''} onChange={(e) => setMeterReadingForm({ ...meterReadingForm, [meter.id]: e.target.value })} className="w-36 rounded border px-3 py-2" /></td><td className="px-4 py-3"><button onClick={() => recordMeterReading(meter)} className="rounded border px-3 py-1 text-sm">Post Reading</button></td></tr>)}{!assetMeters.meters.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No meters configured.</td></tr>}</tbody></table></div>
          </div><div className="flex justify-end border-t px-6 py-4"><button onClick={() => setAssetMeters(null)} className="rounded border px-4 py-2">Close</button></div>
        </div></div>
      )}

      {showContractForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"><form onSubmit={saveServiceContract} className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Service Entitlement</div><h3 className="text-xl font-bold">{renewingContractId ? 'Renew Service Contract' : editingContractId ? 'Edit Service Contract' : 'New Service Contract'}</h3></div><button type="button" onClick={() => { setShowContractForm(false); setRenewingContractId(null); }} className="text-2xl" aria-label="Close service contract">&times;</button></div><div className="grid gap-4 p-6 md:grid-cols-3">
          <label className="text-sm font-semibold md:col-span-2">Customer *<select disabled={Boolean(renewingContractId)} required value={contractForm.customer_id} onChange={(e) => setContractForm({ ...contractForm, customer_id: e.target.value, asset_ids: [] })} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-gray-100"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_code} - {customer.customer_name}</option>)}</select></label>
          <label className="text-sm font-semibold">Type<select value={contractForm.contract_type} onChange={(e) => setContractForm({ ...contractForm, contract_type: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option>AMC</option><option>WARRANTY</option><option>ON_CALL</option></select></label>
          <label className="text-sm font-semibold">Start Date *<DateInput required value={contractForm.start_date} onChange={(value) => setContractForm({ ...contractForm, start_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">End Date *<DateInput min={contractForm.start_date} required value={contractForm.end_date} onChange={(value) => setContractForm({ ...contractForm, end_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Status<select disabled={Boolean(renewingContractId)} value={contractForm.status} onChange={(e) => setContractForm({ ...contractForm, status: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-gray-100"><option>DRAFT</option><option>ACTIVE</option><option>EXPIRED</option><option>CANCELLED</option></select></label>
          <label className="text-sm font-semibold">Response SLA (hours) *<input type="number" min="0.1" step="0.1" required value={contractForm.response_hours} onChange={(e) => setContractForm({ ...contractForm, response_hours: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Resolution SLA (hours) *<input type="number" min="0.1" step="0.1" required value={contractForm.resolution_hours} onChange={(e) => setContractForm({ ...contractForm, resolution_hours: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Included Visits<input type="number" min="0" value={contractForm.included_visits} onChange={(e) => setContractForm({ ...contractForm, included_visits: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Included Labor Hours<input type="number" min="0" step="0.1" value={contractForm.included_labor_hours} onChange={(e) => setContractForm({ ...contractForm, included_labor_hours: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Contract Value<input type="number" min="0" step="0.01" value={contractForm.contract_value} onChange={(e) => setContractForm({ ...contractForm, contract_value: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">{regionalProfile.taxLabel} %<input type="number" min="0" step="0.01" value={contractForm.tax_percentage} onChange={(e) => setContractForm({ ...contractForm, tax_percentage: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <div className="md:col-span-3"><div className="mb-2 text-sm font-semibold">Covered Installed Assets</div><div className="grid max-h-40 gap-2 overflow-auto rounded border p-3 md:grid-cols-2">{installedAssets.filter((asset) => asset.customer_id === contractForm.customer_id && asset.status === 'ACTIVE').map((asset) => <label key={asset.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contractForm.asset_ids.includes(asset.id)} onChange={(e) => setContractForm({ ...contractForm, asset_ids: e.target.checked ? [...contractForm.asset_ids, asset.id] : contractForm.asset_ids.filter((id) => id !== asset.id) })} />{asset.asset_number} - {asset.asset_name}</label>)}{!installedAssets.some((asset) => asset.customer_id === contractForm.customer_id && asset.status === 'ACTIVE') && <span className="text-sm text-gray-500">No active installed assets for this customer. An empty selection covers the customer generally.</span>}</div></div>
          <label className="text-sm font-semibold md:col-span-3">Notes<textarea rows={3} value={contractForm.notes} onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
        </div><div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => { setShowContractForm(false); setRenewingContractId(null); }} className="rounded border px-4 py-2">Cancel</button><button disabled={loading} type="submit" className="rounded bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{renewingContractId ? 'Create Renewal Draft' : 'Save Contract'}</button></div></form></div>
      )}

      {showMaintenanceForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"><form onSubmit={saveMaintenanceSchedule} className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Preventive Maintenance</div><h3 className="text-xl font-bold">{editingMaintenanceId ? 'Edit Maintenance Schedule' : 'New Maintenance Schedule'}</h3></div><button type="button" onClick={() => setShowMaintenanceForm(false)} className="text-2xl" aria-label="Close maintenance schedule">&times;</button></div><div className="grid gap-4 p-6 md:grid-cols-2">
          <label className="text-sm font-semibold">Customer *<select required value={maintenanceForm.customer_id} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, customer_id: e.target.value, installed_asset_id: '', uid: '' })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_code} - {customer.customer_name}</option>)}</select></label>
          <label className="text-sm font-semibold">Installed Asset<select value={maintenanceForm.installed_asset_id} onChange={(e) => { const asset = installedAssets.find((row) => row.id === e.target.value); setMaintenanceForm({ ...maintenanceForm, installed_asset_id: e.target.value, uid: asset?.uid || maintenanceForm.uid, schedule_name: maintenanceForm.schedule_name || asset?.asset_name || '' }); }} className="mt-1 w-full rounded border px-3 py-2"><option value="">No linked asset</option>{installedAssets.filter((asset) => asset.customer_id === maintenanceForm.customer_id && asset.status === 'ACTIVE').map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_number} - {asset.asset_name}</option>)}</select></label>
          <label className="text-sm font-semibold">Equipment UID *<input required value={maintenanceForm.uid} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, uid: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Schedule Name *<input required value={maintenanceForm.schedule_name} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, schedule_name: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Trigger Basis<select value={maintenanceForm.trigger_type} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, trigger_type: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="CALENDAR">Calendar interval</option><option value="METER">Usage meter</option><option value="WHICHEVER_FIRST">Calendar or meter, whichever first</option></select></label>
          {maintenanceForm.trigger_type !== 'CALENDAR' && <><label className="text-sm font-semibold">Equipment Meter *<select required value={maintenanceForm.meter_id} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, meter_id: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Select meter</option>{maintenanceMeters.map((meter) => <option key={meter.id} value={meter.id}>{meter.meter_name} ({meter.uom}) - latest {meter.latest_reading?.reading_value ?? 0}</option>)}</select></label><label className="text-sm font-semibold">Service Every (meter units) *<input type="number" min="0.001" step="0.001" required value={maintenanceForm.meter_interval} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, meter_interval: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold">Last Service Meter<input type="number" min="0" step="0.001" value={maintenanceForm.last_service_meter} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, last_service_meter: e.target.value, next_service_meter: String(Number(e.target.value || 0) + Number(maintenanceForm.meter_interval || 0)) })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold">Next Service Meter<input type="number" min="0" step="0.001" value={maintenanceForm.next_service_meter} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, next_service_meter: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></>}
          <label className="text-sm font-semibold">Frequency (days) *<input type="number" min="1" step="1" required value={maintenanceForm.frequency_days} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, frequency_days: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Notify Before (days) *<input type="number" min="0" step="1" required value={maintenanceForm.notify_before_days} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, notify_before_days: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Last Service Date<DateInput max={todayDate} value={maintenanceForm.last_service_date} onChange={(value) => setMaintenanceForm({ ...maintenanceForm, last_service_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold">Next Service Date *<DateInput required value={maintenanceForm.next_service_date} onChange={(value) => setMaintenanceForm({ ...maintenanceForm, next_service_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm font-semibold md:col-span-2">Service Checklist<textarea rows={4} value={maintenanceForm.service_checklist} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, service_checklist: e.target.value })} placeholder="Inspection and service tasks for the technician" className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="flex items-center gap-2 text-sm font-semibold md:col-span-2"><input type="checkbox" checked={maintenanceForm.is_active} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, is_active: e.target.checked })} />Active schedule</label>
        </div><div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => setShowMaintenanceForm(false)} className="rounded border px-4 py-2">Cancel</button><button disabled={loading} type="submit" className="rounded bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Save Schedule</button></div></form></div>
      )}

      {activeTab === 'controls' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Enterprise Service Control Centre</h2><p className="text-sm text-gray-600">Controlled escalations, failure master data and customer-equipment RMA lifecycle.</p></div>
            <div className="flex flex-wrap rounded-md border bg-white p-1">{(['escalations', 'failure-codes', 'rma', 'warranty-recovery'] as const).map((section) => <button key={section} onClick={() => setControlSection(section)} className={`rounded px-4 py-2 text-sm font-semibold ${controlSection === section ? 'bg-[#8B6F47] text-white' : 'text-[#5C4738]'}`}>{section === 'failure-codes' ? 'Failure Codes' : section === 'rma' ? 'Repair / RMA' : section === 'warranty-recovery' ? 'Warranty Recovery' : 'Escalations'}</button>)}</div>
          </div>

          {controlSection === 'escalations' && <div className="rounded-lg border bg-white"><div className="flex items-center justify-between border-b p-4"><div><h3 className="font-bold">Escalation Register</h3><p className="text-xs text-gray-500">Open service exceptions with accountable resolution.</p></div>{canEdit && <button onClick={() => setShowEscalationForm(true)} className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white">+ Escalate Ticket</button>}</div><div className="overflow-x-auto"><table className="min-w-full"><thead className="bg-[#F6EFE2]"><tr>{['Ticket', 'Customer', 'Level', 'Reason', 'Due', 'Status', 'Action'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase">{heading}</th>)}</tr></thead><tbody className="divide-y">{serviceEscalations.map((row) => <tr key={row.id}><td className="px-4 py-3 font-semibold">{row.ticket?.ticket_number || '-'}</td><td className="px-4 py-3">{row.ticket?.customer?.customer_name || '-'}</td><td className="px-4 py-3">L{row.escalation_level}</td><td className="max-w-sm px-4 py-3">{row.reason}</td><td className="px-4 py-3">{row.due_at ? new Date(row.due_at).toLocaleString() : '-'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'RESOLVED' ? 'bg-green-100 text-green-800' : row.status === 'OPEN' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{row.status}</span></td><td className="px-4 py-3">{canEdit && !['RESOLVED', 'CANCELLED'].includes(row.status) && <button onClick={() => resolveEscalation(row)} className="rounded border px-3 py-1 text-sm">Resolve</button>}</td></tr>)}{!serviceEscalations.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No service escalations recorded.</td></tr>}</tbody></table></div></div>}

          {controlSection === 'failure-codes' && <div className="rounded-lg border bg-white"><div className="flex items-center justify-between border-b p-4"><div><h3 className="font-bold">Failure / Cause Master</h3><p className="text-xs text-gray-500">Reusable diagnosis codes for consistent RCA analytics.</p></div>{canCreate && <button onClick={() => setShowFailureCodeForm(true)} className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white">+ New Failure Code</button>}</div><div className="overflow-x-auto"><table className="min-w-full"><thead className="bg-[#F6EFE2]"><tr>{['Code', 'Category', 'Description', 'Default Corrective Action', 'Status', 'Action'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase">{heading}</th>)}</tr></thead><tbody className="divide-y">{failureCodes.map((row) => <tr key={row.id}><td className="px-4 py-3 font-semibold">{row.code}</td><td className="px-4 py-3">{row.category.replaceAll('_', ' ')}</td><td className="px-4 py-3">{row.description}</td><td className="px-4 py-3">{row.default_corrective_action || '-'}</td><td className="px-4 py-3">{row.is_active ? 'Active' : 'Inactive'}</td><td className="px-4 py-3">{canDelete && row.is_active && <button onClick={async () => { if (!confirm(`Deactivate or delete failure code ${row.code}?`)) return; try { await apiClient.delete(`/service/failure-codes/${row.id}`); await fetchEnterpriseControls(); } catch (err: any) { alert(err.message); } }} className="rounded border border-red-200 px-3 py-1 text-sm text-red-700">Deactivate</button>}</td></tr>)}{!failureCodes.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No failure codes configured.</td></tr>}</tbody></table></div></div>}

          {controlSection === 'rma' && <div className="rounded-lg border bg-white"><div className="flex items-center justify-between border-b p-4"><div><h3 className="font-bold">Repair / RMA Register</h3><p className="text-xs text-gray-500">Customer equipment receipt, diagnosis, repair and return traceability.</p></div>{canCreate && <button onClick={() => setShowRmaForm(true)} className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white">+ New RMA</button>}</div><div className="overflow-x-auto"><table className="min-w-full"><thead className="bg-[#F6EFE2]"><tr>{['RMA', 'Ticket / Customer', 'Equipment', 'Disposition', 'Location', 'Status', 'Action'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase">{heading}</th>)}</tr></thead><tbody className="divide-y">{rmaOrders.map((row) => <tr key={row.id}><td className="px-4 py-3 font-semibold">{row.rma_number}<div className="text-xs font-normal text-gray-500">{row.received_date || 'Awaiting receipt'}</div></td><td className="px-4 py-3">{row.ticket?.ticket_number}<div className="text-xs text-gray-500">{row.ticket?.customer?.customer_name || '-'}</div></td><td className="px-4 py-3">{row.ticket?.product_name || '-'}<div className="text-xs text-gray-500">{row.ticket?.serial_number || row.ticket?.uid || '-'}</div></td><td className="px-4 py-3">{row.disposition.replaceAll('_', ' ')}</td><td className="px-4 py-3">{row.repair_location || '-'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'RETURNED' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{row.status.replaceAll('_', ' ')}</span></td><td className="px-4 py-3">{canEdit && !['RETURNED', 'CANCELLED'].includes(row.status) && <button onClick={() => advanceRma(row)} className="rounded border px-3 py-1 text-sm">Advance</button>}</td></tr>)}{!rmaOrders.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No RMA orders recorded.</td></tr>}</tbody></table></div></div>}

          {controlSection === 'warranty-recovery' && <div className="rounded-lg border bg-white"><div className="flex items-center justify-between border-b p-4"><div><h3 className="font-bold">OEM / Supplier Warranty Recovery</h3><p className="text-xs text-gray-500">Recover warranty parts, labour and approved credits with an auditable claim lifecycle.</p></div>{canCreate && <button onClick={createWarrantyRecovery} className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white">+ New Recovery Claim</button>}</div><div className="overflow-x-auto"><table className="min-w-full"><thead className="bg-[#F6EFE2]"><tr>{['Claim', 'Ticket / Customer', 'Type', 'Claimed', 'Approved', 'OEM Reference', 'Status', 'Action'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase">{heading}</th>)}</tr></thead><tbody className="divide-y">{warrantyRecoveryClaims.map((row) => <tr key={row.id}><td className="px-4 py-3 font-semibold">{row.claim_number}</td><td className="px-4 py-3">{row.ticket?.ticket_number || '-'}<div className="text-xs text-gray-500">{row.ticket?.customer?.customer_name || '-'}</div></td><td className="px-4 py-3">{row.claim_type}</td><td className="px-4 py-3 text-right">Rs. {Number(row.claimed_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="px-4 py-3 text-right">Rs. {Number(row.approved_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="px-4 py-3">{row.vendor_reference || '-'}</td><td className="px-4 py-3"><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">{String(row.status).replaceAll('_', ' ')}</span></td><td className="px-4 py-3">{canEdit && !['SETTLED', 'REJECTED', 'CANCELLED'].includes(row.status) && <button onClick={() => advanceWarrantyRecovery(row)} className="rounded border px-3 py-1 text-sm">Advance</button>}</td></tr>)}{!warrantyRecoveryClaims.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No warranty recovery claims recorded.</td></tr>}</tbody></table></div></div>}
        </div>
      )}

      {showFailureCodeForm && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><form onSubmit={saveFailureCode} className="w-full max-w-xl rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b p-5"><h3 className="text-lg font-bold">New Failure Code</h3><button type="button" onClick={() => setShowFailureCodeForm(false)} className="text-2xl">&times;</button></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="text-sm font-semibold">Code *<input required value={failureCodeForm.code} onChange={(e) => setFailureCodeForm({ ...failureCodeForm, code: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 uppercase" /></label><label className="text-sm font-semibold">Category *<input required value={failureCodeForm.category} onChange={(e) => setFailureCodeForm({ ...failureCodeForm, category: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 uppercase" /></label><label className="text-sm font-semibold md:col-span-2">Description *<textarea required value={failureCodeForm.description} onChange={(e) => setFailureCodeForm({ ...failureCodeForm, description: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold md:col-span-2">Default Corrective Action<textarea value={failureCodeForm.default_corrective_action} onChange={(e) => setFailureCodeForm({ ...failureCodeForm, default_corrective_action: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div><div className="flex justify-end gap-3 border-t p-4"><button type="button" onClick={() => setShowFailureCodeForm(false)} className="rounded border px-4 py-2">Cancel</button><button disabled={loading} className="rounded bg-amber-600 px-4 py-2 font-semibold text-white">Save Code</button></div></form></div>}

      {showEscalationForm && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><form onSubmit={saveEscalation} className="w-full max-w-xl rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b p-5"><h3 className="text-lg font-bold">Escalate Service Ticket</h3><button type="button" onClick={() => setShowEscalationForm(false)} className="text-2xl">&times;</button></div><div className="space-y-4 p-5"><label className="block text-sm font-semibold">Open Ticket *<select required value={escalationForm.service_ticket_id} onChange={(e) => setEscalationForm({ ...escalationForm, service_ticket_id: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Select ticket</option>{tickets.filter((row) => !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(row.status)).map((row) => <option key={row.id} value={row.id}>{row.ticket_number} · {row.customer?.customer_name || row.product_name}</option>)}</select></label><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Level *<select value={escalationForm.escalation_level} onChange={(e) => setEscalationForm({ ...escalationForm, escalation_level: e.target.value })} className="mt-1 w-full rounded border px-3 py-2">{[1,2,3,4,5].map((level) => <option key={level} value={level}>Level {level}</option>)}</select></label><label className="text-sm font-semibold">Due At<input type="datetime-local" value={escalationForm.due_at} onChange={(e) => setEscalationForm({ ...escalationForm, due_at: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div><label className="block text-sm font-semibold">Reason *<textarea required rows={3} value={escalationForm.reason} onChange={(e) => setEscalationForm({ ...escalationForm, reason: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div><div className="flex justify-end gap-3 border-t p-4"><button type="button" onClick={() => setShowEscalationForm(false)} className="rounded border px-4 py-2">Cancel</button><button disabled={loading} className="rounded bg-amber-600 px-4 py-2 font-semibold text-white">Create Escalation</button></div></form></div>}

      {showRmaForm && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><form onSubmit={saveRmaOrder} className="w-full max-w-2xl rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b p-5"><h3 className="text-lg font-bold">New Repair / RMA Order</h3><button type="button" onClick={() => setShowRmaForm(false)} className="text-2xl">&times;</button></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="text-sm font-semibold md:col-span-2">Service Ticket *<select required value={rmaForm.service_ticket_id} onChange={(e) => setRmaForm({ ...rmaForm, service_ticket_id: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Select ticket</option>{tickets.map((row) => <option key={row.id} value={row.id}>{row.ticket_number} · {row.customer?.customer_name || '-'} · {row.product_name || row.uid || '-'}</option>)}</select></label><label className="text-sm font-semibold">Disposition<select value={rmaForm.disposition} onChange={(e) => setRmaForm({ ...rmaForm, disposition: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option>REPAIR</option><option>REPLACE</option><option>RETURN_UNREPAIRED</option><option>SCRAP</option></select></label><label className="text-sm font-semibold">Received Date<DateInput max={todayDate} value={rmaForm.received_date} onChange={(value) => setRmaForm({ ...rmaForm, received_date: value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold">Repair Location<input value={rmaForm.repair_location} onChange={(e) => setRmaForm({ ...rmaForm, repair_location: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold">Received Condition<input value={rmaForm.received_condition} onChange={(e) => setRmaForm({ ...rmaForm, received_condition: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold md:col-span-2">Notes<textarea rows={3} value={rmaForm.notes} onChange={(e) => setRmaForm({ ...rmaForm, notes: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div><div className="flex justify-end gap-3 border-t p-4"><button type="button" onClick={() => setShowRmaForm(false)} className="rounded border px-4 py-2">Cancel</button><button disabled={loading} className="rounded bg-amber-600 px-4 py-2 font-semibold text-white">Create RMA</button></div></form></div>}

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Service Reports</h2>
          {loading ? (
            <p className="text-gray-600">Loading reports...</p>
          ) : reports ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Ticket Status</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-yellow-600">Open Tickets:</span>
                    <span className="font-bold text-yellow-600">{reports.open_tickets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-600">Closed Tickets:</span>
                    <span className="font-bold text-green-600">{reports.closed_tickets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total:</span>
                    <span className="font-bold">{reports.total_tickets}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Warranty Claims</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Claims Count:</span>
                    <span className="font-bold">{reports.warranty_claims_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Cost:</span>
                    <span className="font-bold">₹{reports.warranty_claims_cost?.toLocaleString() || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Parts Cost:</span>
                    <span className="font-bold">₹{reports.warranty_parts_cost?.toLocaleString() || 0}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Top Issues</h3>
                <div className="space-y-2">
                  {reports.product_reliability?.slice(0, 5).map((item: any, index: number) => (
                    <div key={index} className="flex justify-between text-sm">
                      <span className="truncate">{item.product}</span>
                      <span className="font-medium text-red-600">{item.issue_count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Installed Base & Contracts</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Active Assets:</span><span className="font-bold">{reports.installed_base?.active_assets || 0}</span></div>
                  <div className="flex justify-between"><span>Active Contracts:</span><span className="font-bold">{reports.contracts?.active_contracts || 0}</span></div>
                  <div className="flex justify-between"><span>Expiring in 30 days:</span><span className="font-bold text-orange-700">{reports.contracts?.expiring_within_30_days?.length || 0}</span></div>
                  {reports.contracts?.expiring_within_30_days?.slice(0, 3).map((contract: any) => <div key={contract.contract_number} className="rounded border border-orange-100 bg-orange-50 p-2"><div className="font-semibold">{contract.contract_number}</div><div className="text-xs text-gray-600">{contract.customer_name} · {contract.end_date}</div></div>)}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Customer Satisfaction</h3>
                <div className="space-y-2 text-sm"><div className="flex justify-between"><span>Responses:</span><span className="font-bold">{reports.customer_satisfaction?.responses || 0}</span></div><div className="flex justify-between"><span>Average CSAT:</span><span className="font-bold text-green-700">{reports.customer_satisfaction?.average_rating == null ? '-' : `${reports.customer_satisfaction.average_rating} / 5`}</span></div><div className="flex justify-between"><span>Would recommend:</span><span className="font-bold">{reports.customer_satisfaction?.recommend_percentage == null ? '-' : `${reports.customer_satisfaction.recommend_percentage}%`}</span></div></div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Service Operations</h3>
                <div className="space-y-2 text-sm"><div className="flex justify-between"><span>Mean time to resolve:</span><span className="font-bold">{reports.operational_kpis?.mean_time_to_resolve_hours == null ? '-' : `${reports.operational_kpis.mean_time_to_resolve_hours} hrs`}</span></div><div className="flex justify-between"><span>First-time fix:</span><span className="font-bold text-green-700">{reports.operational_kpis?.first_time_fix_percentage == null ? '-' : `${reports.operational_kpis.first_time_fix_percentage}%`}</span></div><div className="flex justify-between"><span>Repeat-failure assets:</span><span className="font-bold text-red-700">{reports.operational_kpis?.repeat_failure_assets?.length || 0}</span></div></div>
              </div>

              <div className="bg-white rounded-lg shadow p-6 md:col-span-2">
                <h3 className="text-sm font-medium text-gray-600 mb-2">Service Profitability</h3>
                <div className="grid gap-3 text-sm sm:grid-cols-2"><div className="flex justify-between"><span>Revenue:</span><span className="font-bold">Rs. {Number(reports.profitability?.service_revenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div><div className="flex justify-between"><span>Actual cost:</span><span className="font-bold">Rs. {Number(reports.profitability?.actual_service_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div><div className="flex justify-between"><span>Gross margin:</span><span className="font-bold text-green-700">Rs. {Number(reports.profitability?.gross_margin || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div><div className="flex justify-between"><span>Margin %:</span><span className="font-bold">{reports.profitability?.gross_margin_percentage == null ? '-' : `${reports.profitability.gross_margin_percentage}%`}</span></div><div className="flex justify-between sm:col-span-2"><span>Outstanding customer receivables:</span><span className="font-bold text-amber-700">Rs. {Number(reports.profitability?.outstanding_receivables || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div></div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {feedbackTicket && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><form onSubmit={submitServiceFeedback} className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b px-6 py-4"><div><div className="text-xs font-bold uppercase text-[#8B6F47]">Customer Satisfaction</div><h3 className="text-xl font-bold">Feedback - {feedbackTicket.ticket_number}</h3></div><button type="button" onClick={() => setFeedbackTicket(null)} className="text-2xl" aria-label="Close feedback">&times;</button></div><div className="grid gap-4 p-6 sm:grid-cols-2">
          {([['overall_rating', 'Overall Rating *'], ['technician_rating', 'Technician Rating'], ['response_time_rating', 'Response Time Rating'], ['quality_rating', 'Service Quality Rating']] as const).map(([field, label]) => <label key={field} className="text-sm font-semibold">{label}<select required={field === 'overall_rating'} value={feedbackForm[field]} onChange={(e) => setFeedbackForm({ ...feedbackForm, [field]: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Not rated</option>{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} - {rating === 5 ? 'Excellent' : rating === 4 ? 'Good' : rating === 3 ? 'Satisfactory' : rating === 2 ? 'Poor' : 'Very poor'}</option>)}</select></label>)}
          <label className="text-sm font-semibold">Would Recommend?<select value={feedbackForm.would_recommend} onChange={(e) => setFeedbackForm({ ...feedbackForm, would_recommend: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Not answered</option><option value="YES">Yes</option><option value="NO">No</option></select></label>
          <label className="text-sm font-semibold sm:col-span-2">Customer Comments<textarea rows={3} value={feedbackForm.feedback_text} onChange={(e) => setFeedbackForm({ ...feedbackForm, feedback_text: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-semibold sm:col-span-2">Suggestions<textarea rows={2} value={feedbackForm.suggestions} onChange={(e) => setFeedbackForm({ ...feedbackForm, suggestions: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
        </div><div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => setFeedbackTicket(null)} className="rounded border px-4 py-2">Cancel</button><button disabled={loading} type="submit" className="rounded bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Save Feedback</button></div></form></div>
      )}
    </div>
  );
}

export default function ServicePage() {
  return <Suspense fallback={<div className="p-6">Loading Service workspace...</div>}><ServicePageContent /></Suspense>;
}
