'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiClient } from '../../../../../lib/api-client';
import { ListTable, type ListTableColumn } from '../../../../components/ui/ListTable';
import { getTodayDateInputValue } from '@/lib/date';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';
import { buildDocumentBranding } from '@/lib/document-branding';
import { useEscapeKey } from '../../../../hooks/useEscapeKey';
import DateInput from '../../../../components/ui/DateInput';

interface VendorPayable {
  vendor_id: string;
  vendor_name: string;
  vendor_code: string;
  total_gross: number;
  total_debit: number;
  total_payable: number;
  total_paid: number;
  total_outstanding: number;
  grn_count: number;
  subcontract_count?: number;
}

interface GRNPayable {
  id: string;
  source_type?: string | null;
  source_id?: string | null;
  grn_number: string;
  grn_date: string;
  receipt_date: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  purchase_order?: { id?: string; po_number?: string; po_date?: string } | null;
  gross_amount: number;
  tax_amount: number;
  freight_amount?: number;
  freight_gst_amount?: number;
  debit_note_amount: number;
  net_payable_amount: number;
  paid_amount: number;
  tds_amount?: number;
  short_payment_amount?: number;
  payment_status?: string;
  status: string;
  outstanding_amount?: number;
  net?: number;
  settled?: number;
  poAdvance?: number;
  po_id?: string | null;
  vendor?: { id?: string; name?: string; code?: string } | null;
}

interface PaymentEntry {
  id: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  payment_reference?: string | null;
  tds_amount: number;
  short_payment_amount: number;
  short_payment_reason?: string | null;
  payment_notes?: string | null;
  entry_type?: string;
}

interface PaymentReversal {
  id: string;
  payment_entry_id: string;
  original_payment_date?: string | null;
  original_amount: number;
  original_tds_amount?: number;
  original_short_payment_amount?: number;
  original_payment_method?: string | null;
  original_payment_reference?: string | null;
  reversal_reason: string;
  reversed_by?: string | null;
  reversed_at: string;
}

interface FreightAdjustment {
  id: string;
  adjusted_by?: string | null;
  adjusted_by_name: string;
  adjusted_at: string;
  reason: string;
  old_freight_amount: number;
  new_freight_amount: number;
  old_freight_gst_amount: number;
  new_freight_gst_amount: number;
  old_net_payable_amount: number;
  new_net_payable_amount: number;
}

interface GRNDetail extends GRNPayable {
  computed_paid: number;
  computed_tds: number;
  computed_short: number;
  computed_advance?: number;
  available_po_advance?: number;
  available_vendor_advance?: number;
  outstanding_amount: number;
  payment_entries: PaymentEntry[];
  payment_reversals?: PaymentReversal[];
  freight_adjustments?: FreightAdjustment[];
}

const fmtINR = (n: number | null | undefined) =>
  (+(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 });

const toPaisa = (value: number | string | null | undefined) => {
  const amount = Number.parseFloat(String(value ?? '0'));
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
};

const fromPaisa = (value: number) => value / 100;

const paymentStatusBadge = (status?: string) => {
  if (status === 'PAID') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">Paid</span>;
  if (status === 'PARTIAL') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">Partial</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">Unpaid</span>;
};

const hydratePayableGrn = (grn: any) => {
  const calc = grn?._payment_calculation || {};
  const gross = +(grn?.gross_amount || 0);
  const tax = +(grn?.tax_amount || 0);
  const debit = +(grn?.debit_note_amount || 0);
  const net = calc.net_payable ?? grn?.net_payable_amount ?? Math.max(0, gross + tax - debit);
  const settled = calc.total_settled ?? (+(grn?.paid_amount || 0) + +(grn?.tds_amount || 0) + +(grn?.short_payment_amount || 0));
  const outstanding = calc.outstanding ?? Math.max(0, +net - +settled);

  return {
    ...grn,
    net,
    settled,
    poAdvance: calc.po_advance_applied || 0,
    outstanding,
    outstanding_amount: outstanding,
    payment_status: calc.payment_status || grn?.payment_status || (outstanding <= 0.009 ? 'PAID' : settled > 0 ? 'PARTIAL' : 'UNPAID'),
  };
};

const getPayableNet = (grn: any) => +(grn?.net ?? grn?.net_payable_amount ?? 0);
const getPayableSettled = (grn: any) => +(grn?.settled ?? 0);
const getPayableOutstanding = (grn: any) => +(grn?.outstanding ?? grn?.outstanding_amount ?? Math.max(0, getPayableNet(grn) - getPayableSettled(grn)));
const isSubcontractPayable = (row?: any) =>
  String(row?.source_type || '').toUpperCase() === 'SUBCONTRACT' || String(row?.id || '').startsWith('subcontract:');
const isSystemPaymentEntry = (entry?: PaymentEntry | null) =>
  ['ADVANCE', 'ADVANCE_APPLIED', 'VENDOR_ADVANCE'].includes(String(entry?.entry_type || '').toUpperCase());
const getAvailableAdvance = (detail?: GRNDetail | null) =>
  +(detail?.available_po_advance || 0) + +(detail?.available_vendor_advance || 0);
const moneyInput = (value: number) => fromPaisa(Math.max(0, toPaisa(value))).toFixed(2);
const moneyInputFromPaisa = (value: number) => fromPaisa(Math.max(0, value)).toFixed(2);

const BLANK_FORM = {
  amount: '',
  advance_adjustment_amount: '',
  tds_amount: '',
  short_payment_amount: '',
  short_payment_reason: '',
  payment_method: 'NEFT',
  payment_reference: '',
  payment_date: getTodayDateInputValue(),
  payment_notes: '',
  close_invoice: false,
};

export default function AccountsPayablePage() {
  const todayDate = getTodayDateInputValue();
  const [canRecordPayment, setCanRecordPayment] = useState(false);
  const [canAdjustFreight, setCanAdjustFreight] = useState(false);
  useEffect(() => {
    const user = readStoredUser();
    setCanRecordPayment(hasModulePermission(user, 'Purchase Management', 'create'));
    setCanAdjustFreight(
      hasModulePermission(user, 'Purchase Management', 'edit')
      || hasModulePermission(user, 'Purchase Management', 'approve'),
    );
  }, []);

  const [vendorPayables, setVendorPayables] = useState<VendorPayable[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedVendor, setSelectedVendor] = useState<VendorPayable | null>(null);
  const [vendorGRNs, setVendorGRNs] = useState<GRNPayable[]>([]);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [loadingGRNs, setLoadingGRNs] = useState(false);

  const [selectedGRNDetail, setSelectedGRNDetail] = useState<GRNDetail | null>(null);
  const [showGRNDetailModal, setShowGRNDetailModal] = useState(false);
  const [loadingGRNDetail, setLoadingGRNDetail] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ ...BLANK_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<{ title: string; message: string; type?: 'info' | 'warning' | 'error' } | null>(null);
  const [selectedGRNIds, setSelectedGRNIds] = useState<Set<string>>(new Set());

  const [showFreightAdjustmentModal, setShowFreightAdjustmentModal] = useState(false);
  const [freightAdjustmentForm, setFreightAdjustmentForm] = useState({
    freight_amount: '',
    freight_gst_amount: '',
    reason: '',
  });
  const [freightAdjustmentError, setFreightAdjustmentError] = useState<string | null>(null);
  const [freightAdjustmentSubmitting, setFreightAdjustmentSubmitting] = useState(false);

  // Edit payment state
  const [editingPayment, setEditingPayment] = useState<PaymentEntry | null>(null);
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false);
  const [editPaymentForm, setEditPaymentForm] = useState({ ...BLANK_FORM });
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [editPaymentError, setEditPaymentError] = useState<string | null>(null);
  const [reversePaymentTarget, setReversePaymentTarget] = useState<PaymentEntry | null>(null);
  const [reversePaymentReason, setReversePaymentReason] = useState('');
  const [reversePaymentError, setReversePaymentError] = useState<string | null>(null);
  const [reversePaymentSubmitting, setReversePaymentSubmitting] = useState(false);

  // Paid invoices state
  const [paidInvoices, setPaidInvoices] = useState<any[]>([]);
  const [loadingPaid, setLoadingPaid] = useState(false);

  // Pending invoices (all invoice_approved GRNs with any outstanding)
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);

  // Unified Advances state (replaces separate Advance Payments and Vendor Advances)
  const [activeTab, setActiveTab] = useState<'payables' | 'pending' | 'paid' | 'advances'>('payables');
  const [advances, setAdvances] = useState<any[]>([]);
  const [advanceFilter, setAdvanceFilter] = useState<'ALL' | 'PO' | 'BLANKET'>('ALL');
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState<any | null>(null);
  const [showAdvanceDetailModal, setShowAdvanceDetailModal] = useState(false);
  // Unified advance form with type selection
  const [advanceForm, setAdvanceForm] = useState({
    advance_type: 'PO' as 'PO' | 'BLANKET',
    po_id: '',
    vendor_id: '',
    amount: '',
    payment_method: 'NEFT',
    payment_reference: '',
    payment_date: getTodayDateInputValue(),
    payment_notes: ''
  });
  const [advancePOs, setAdvancePOs] = useState<any[]>([]);
  const [advanceVendors, setAdvanceVendors] = useState<any[]>([]);
  const [poSearch, setPoSearch] = useState('');
  const [poDropdownOpen, setPoDropdownOpen] = useState(false);
  const poSearchRef = useRef<HTMLDivElement>(null);
  const [submittingAdvance, setSubmittingAdvance] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // Unified fetch for all advances (PO and BLANKET)
  const fetchAdvances = useCallback(async () => {
    try {
      setLoadingAdvances(true);
      const data = await apiClient.get<any[]>(`/purchase/debit-notes/advances?type=${advanceFilter}`);
      setAdvances(Array.isArray(data) ? data : []);
    } catch { } finally { setLoadingAdvances(false); }
  }, [advanceFilter]);

  const fetchPOsForAdvance = async () => {
    try {
      const [pos, allGRNs, allAdvances] = await Promise.all([
        apiClient.get<any[]>('/purchase/orders?status=APPROVED'),
        apiClient.get<any[]>('/purchase/grn').catch(() => [] as any[]),
        apiClient.get<any[]>('/purchase/debit-notes/po-advances').catch(() => [] as any[]),
      ]);
      // Compute total advance already paid per PO
      const advanceByPo = new Map<string, number>();
      (allAdvances || []).forEach((a: any) => {
        if (a.po_id) advanceByPo.set(a.po_id, (advanceByPo.get(a.po_id) || 0) + +(a.amount || 0));
      });
      // Compute total net payable and paid per PO from GRNs
      const netByPo = new Map<string, number>();
      const paidByPo = new Map<string, number>();
      (allGRNs || []).forEach((grn: any) => {
        if (!grn.po_id) return;
        const payableGrn = hydratePayableGrn(grn);
        const net = getPayableNet(payableGrn);
        const paid = getPayableSettled(payableGrn);
        netByPo.set(grn.po_id, (netByPo.get(grn.po_id) || 0) + net);
        paidByPo.set(grn.po_id, (paidByPo.get(grn.po_id) || 0) + paid);
      });
      // Filter to POs with outstanding > 0
      const withOutstanding = (pos || []).filter((po: any) => {
        const net = netByPo.get(po.id) || +(po.grand_total || 0);
        const paid = paidByPo.get(po.id) || 0;
        const advance = advanceByPo.get(po.id) || 0;
        return (net - paid - advance) > 0.009;
      });
      setAdvancePOs(withOutstanding);
    } catch { setAdvancePOs([]); }
  };

  // Unified submit function for both PO and BLANKET advances
  const submitAdvancePayment = async () => {
    setAdvanceError(null);
    const amount = parseFloat(advanceForm.amount);
    
    // Validation based on advance type
    if (advanceForm.advance_type === 'PO' && !advanceForm.po_id) { 
      setAdvanceError('Select a Purchase Order'); return; 
    }
    if (advanceForm.advance_type === 'BLANKET' && !advanceForm.vendor_id) { 
      setAdvanceError('Select a Vendor'); return; 
    }
    if (!amount || amount <= 0) { setAdvanceError('Enter a valid amount'); return; }
    
    try {
      setSubmittingAdvance(true);
      await apiClient.post(`/purchase/debit-notes/advance-payment`, {
        advance_type: advanceForm.advance_type,
        po_id: advanceForm.advance_type === 'PO' ? advanceForm.po_id : undefined,
        vendor_id: advanceForm.advance_type === 'BLANKET' ? advanceForm.vendor_id : undefined,
        amount,
        payment_method: advanceForm.payment_method,
        payment_reference: advanceForm.payment_reference || undefined,
        payment_date: advanceForm.payment_date,
        payment_notes: advanceForm.payment_notes || undefined,
      });
      setShowAdvanceModal(false);
      // Reset form
      setAdvanceForm({
        advance_type: 'PO',
        po_id: '',
        vendor_id: '',
        amount: '',
        payment_method: 'NEFT',
        payment_reference: '',
        payment_date: getTodayDateInputValue(),
        payment_notes: ''
      });
      fetchAdvances();
    } catch (e: any) {
      setAdvanceError(e.message || 'Failed to record advance payment');
    } finally {
      setSubmittingAdvance(false);
    }
  };

  const filteredPOs = useMemo(() => {
    if (!poSearch.trim()) return advancePOs;
    const q = poSearch.toLowerCase();
    return advancePOs.filter((po: any) =>
      (po.po_number || '').toLowerCase().includes(q) ||
      (po.vendor?.name || po.vendor_name || '').toLowerCase().includes(q)
    );
  }, [advancePOs, poSearch]);

  const selectedPODisplay = useMemo(() => {
    if (!advanceForm.po_id) return '';
    const po = advancePOs.find((p: any) => p.id === advanceForm.po_id);
    return po ? `${po.po_number} · ${po.vendor?.name || po.vendor_name || ''}` : '';
  }, [advanceForm.po_id, advancePOs]);

  // Fetch vendors for blanket advance selection
  const fetchVendorsForAdvance = async () => {
    try {
      const vendors = await apiClient.get<any[]>('/purchase/vendors');
      setAdvanceVendors(vendors || []);
    } catch { setAdvanceVendors([]); }
  };

  // Vendor advance balances state (for use in payment calculations)
  const [vendorAdvanceBalances, setVendorAdvanceBalances] = useState<Map<string, number>>(new Map());

  const fetchVendorPayables = useCallback(async () => {
    try {
      setLoading(true);
      setLoadingPaid(true);
      setLoadingPending(true);
      const [allGRNs, vendorAdvances] = await Promise.all([
        apiClient.get<any[]>('/purchase/debit-notes/grns-with-payment-status'),
        apiClient.get<any[]>('/purchase/debit-notes/vendor-advances').catch(() => [] as any[]),
      ]);
      const payableGRNs = (allGRNs || []).map(hydratePayableGrn);

      // Build vendor-level advance total per vendor
      const vendorAdvanceMap = new Map<string, number>();
      (vendorAdvances || []).forEach((a: any) => {
        const vid = a.vendor_id;
        if (vid) vendorAdvanceMap.set(vid, +(a.balance_amount || 0));
      });
      setVendorAdvanceBalances(vendorAdvanceMap);

      const relevant = payableGRNs
        .filter((grn: any) => {
          const st = (grn.status || '').toUpperCase();
          if (st === 'REJECTED' || st === 'CANCELLED' || st === 'DRAFT') return false;
          if (!grn.invoice_approved) return false;
          return getPayableNet(grn) > 0.009 && getPayableOutstanding(grn) > 0.009;
        })
        .sort((a: any, b: any) => new Date(a.created_at || a.receipt_date || 0).getTime() - new Date(b.created_at || b.receipt_date || 0).getTime());

      const vendorMap = new Map<string, VendorPayable>();
      relevant.forEach((grn: any) => {
        const vid = grn.vendor?.id || grn.vendor_id;
        const vname = grn.vendor?.name || 'Unknown';
        const vcode = grn.vendor?.code || '';
        if (!vid) return;
        if (!vendorMap.has(vid)) {
          vendorMap.set(vid, { vendor_id: vid, vendor_name: vname, vendor_code: vcode, total_gross: 0, total_debit: 0, total_payable: 0, total_paid: 0, total_outstanding: 0, grn_count: 0 });
        }
        const v = vendorMap.get(vid)!;
        v.total_gross += +(grn.gross_amount || 0);
        v.total_debit += +(grn.debit_note_amount || 0);
        v.total_payable += getPayableNet(grn);
        v.total_paid += getPayableSettled(grn);
        v.total_outstanding += getPayableOutstanding(grn);
        v.grn_count += 1;
      });

      const summary = Array.from(vendorMap.values())
        .filter((v) => Math.max(0, v.total_outstanding - (vendorAdvanceMap.get(v.vendor_id) || 0)) > 0.009);
      setVendorPayables(summary);

      setPaidInvoices(payableGRNs.filter((grn: any) => {
        const st = (grn.status || '').toUpperCase();
        if (st === 'REJECTED' || st === 'CANCELLED') return false;
        const calc = grn._payment_calculation || {};
        return calc.is_fully_paid === true || getPayableOutstanding(grn) <= 0.009;
      }));

      setPendingInvoices(payableGRNs.filter((grn: any) => {
        const st = (grn.status || '').toUpperCase();
        if (st === 'REJECTED' || st === 'CANCELLED') return false;
        if (!grn.invoice_approved) return false; // Must be sanctioned first
        return getPayableOutstanding(grn) > 0.009;
      }));
    } catch (e) {
      console.error('[AP] fetchVendorPayables error:', e);
      setPageNotice({
        title: 'Payables could not be refreshed',
        message: e instanceof Error ? e.message : 'Please refresh the page and try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
      setLoadingPaid(false);
      setLoadingPending(false);
    }
  }, []);

  // Close modals on Escape key
  useEscapeKey(showDetailsModal, () => setShowDetailsModal(false));
  useEscapeKey(showGRNDetailModal, () => setShowGRNDetailModal(false));
  useEscapeKey(showPaymentModal, () => setShowPaymentModal(false));
  useEscapeKey(showFreightAdjustmentModal, () => setShowFreightAdjustmentModal(false));
  useEscapeKey(showEditPaymentModal, () => setShowEditPaymentModal(false));
  useEscapeKey(!!reversePaymentTarget, () => {
    setReversePaymentTarget(null);
    setReversePaymentReason('');
    setReversePaymentError(null);
  });
  useEscapeKey(showAdvanceModal, () => setShowAdvanceModal(false));
  useEscapeKey(showAdvanceDetailModal, () => setShowAdvanceDetailModal(false));

  useEffect(() => { 
    fetchVendorPayables(); 
    fetchAdvances(); 
  }, [fetchVendorPayables, fetchAdvances]);

  const viewVendorDetails = async (vendor: VendorPayable) => {
    try {
      setLoadingGRNs(true);
      setSelectedVendor(vendor);
      setSelectedGRNIds(new Set());
      setShowDetailsModal(true);
      const allGRNs = await apiClient.get<any[]>(`/purchase/debit-notes/grns-with-payment-status?vendorId=${vendor.vendor_id}`);
      const relevant = (allGRNs || []).map(hydratePayableGrn).filter((grn: any) => {
        const st = (grn.status || '').toUpperCase();
        if (st === 'REJECTED' || st === 'CANCELLED' || st === 'DRAFT') return false;
        if (!grn.invoice_approved) return false;
        return getPayableNet(grn) > 0.009 && getPayableOutstanding(grn) > 0.009;
      });
      setVendorGRNs(relevant);
    } catch {
      setVendorGRNs([]);
    } finally {
      setLoadingGRNs(false);
    }
  };

  const viewGRNDetail = async (grn: GRNPayable) => {
    if (isSubcontractPayable(grn)) {
      setPageNotice({
        title: 'Subcontract payable',
        message: `This is a subcontract service liability. Its invoice, outstanding balance and payment are controlled directly in this Accounts Payable workspace; the operational document trail remains on the linked Subcontract PO.`,
        type: 'info',
      });
      return;
    }
    try {
      setLoadingGRNDetail(true);
      setShowGRNDetailModal(true);
      const detail = await apiClient.get<GRNDetail>(`/purchase/debit-notes/grn/${grn.id}/payable-detail`);
      setSelectedGRNDetail(detail);
    } catch (e: any) {
      console.error('[viewGRNDetail] error:', e?.message || e);
      setSelectedGRNDetail(null);
    } finally {
      setLoadingGRNDetail(false);
    }
  };

  const recordSubcontractPayment = async (payable: GRNPayable) => {
    if (!canRecordPayment) {
      setPageNotice({ title: 'Permission required', message: 'You do not have permission to record payments.', type: 'error' });
      return;
    }
    const outstanding = getPayableOutstanding(payable);
    const orderId = payable.purchase_order?.id || payable.po_id;
    const stepId = payable.source_id || String(payable.id || '').replace(/^subcontract:/, '');
    if (!orderId || !stepId || outstanding <= 0.009) {
      setPageNotice({ title: 'Payment unavailable', message: 'The linked Subcontract PO or payable line could not be identified.', type: 'error' });
      return;
    }
    const confirmed = window.confirm(`Record payment of Rs. ${fmtINR(outstanding)} against subcontract invoice ${payable.invoice_number || payable.grn_number}?`);
    if (!confirmed) return;
    try {
      await apiClient.post(`/production/subcontracting/orders/${orderId}/steps/${stepId}/pay`, {
        amount: outstanding,
        payment_date: getTodayDateInputValue(),
      });
      await fetchVendorPayables();
      setPageNotice({ title: 'Payment recorded', message: 'The subcontract supplier payment was posted from Accounts Payable and remains linked to its Subcontract PO and GRN.', type: 'info' });
    } catch (e: any) {
      setPageNotice({ title: 'Payment unavailable', message: e?.message || 'Could not record the subcontract supplier payment.', type: 'error' });
    }
  };

  const openPaymentModal = async (grn: GRNPayable) => {
    if (!canRecordPayment) { setPageNotice({ title: 'Permission required', message: 'You do not have permission to record payments.', type: 'error' }); return; }
    if (isSubcontractPayable(grn)) {
      await recordSubcontractPayment(grn);
      return;
    }
    try {
      setLoadingGRNDetail(true);
      setShowGRNDetailModal(false);
      setPaymentError(null);
      setSelectedGRNDetail(null);

      const detail = await apiClient.get<GRNDetail>(`/purchase/debit-notes/grn/${grn.id}/payable-detail`);
      const payableDetail = hydratePayableGrn(detail) as GRNDetail;
      const outstanding = getPayableOutstanding(payableDetail);

      setSelectedGRNDetail({
        ...payableDetail,
        outstanding_amount: outstanding,
      });
      setPaymentForm({ ...BLANK_FORM, amount: moneyInput(outstanding) });
      setShowPaymentModal(true);
    } catch (e: any) {
      console.error('[openPaymentModal] error:', e?.message || e);
      setPaymentError(e?.message || 'Unable to load payable detail for payment');
      setPageNotice({
        title: 'Payment unavailable',
        message: e?.message || 'Unable to load payable detail for payment.',
        type: 'error',
      });
    } finally {
      setLoadingGRNDetail(false);
    }
  };

  const openPaymentModalFromDetail = (detail: GRNDetail) => {
    if (!canRecordPayment) { setPaymentError('You do not have permission to record payments'); return; }
    if (isSubcontractPayable(detail)) {
      void recordSubcontractPayment(detail);
      return;
    }
    setPaymentError(null);
    setPaymentForm({ ...BLANK_FORM, amount: moneyInput(detail.outstanding_amount) });
    setShowPaymentModal(true);
  };

  const openFreightAdjustmentModal = (detail: GRNDetail) => {
    if (!canAdjustFreight) {
      setPageNotice({ title: 'Permission required', message: 'You do not have permission to adjust invoice freight.', type: 'error' });
      return;
    }
    setFreightAdjustmentError(null);
    setFreightAdjustmentForm({
      freight_amount: moneyInput(detail.freight_amount || 0),
      freight_gst_amount: moneyInput(detail.freight_gst_amount || 0),
      reason: '',
    });
    setShowFreightAdjustmentModal(true);
  };

  const submitFreightAdjustment = async () => {
    if (!selectedGRNDetail) return;
    const freightAmount = Number.parseFloat(freightAdjustmentForm.freight_amount);
    const freightGstAmount = Number.parseFloat(freightAdjustmentForm.freight_gst_amount || '0');
    const reason = freightAdjustmentForm.reason.trim();

    if (!Number.isFinite(freightAmount) || freightAmount < 0) {
      setFreightAdjustmentError('Enter a valid non-negative freight amount');
      return;
    }
    if (!Number.isFinite(freightGstAmount) || freightGstAmount < 0) {
      setFreightAdjustmentError('Enter a valid non-negative freight GST amount');
      return;
    }
    if (!reason) {
      setFreightAdjustmentError('Reason for freight adjustment is required');
      return;
    }

    try {
      setFreightAdjustmentSubmitting(true);
      setFreightAdjustmentError(null);
      const updated = await apiClient.put<GRNDetail>(
        `/purchase/debit-notes/grn/${selectedGRNDetail.id}/freight-adjustment`,
        {
          freight_amount: freightAmount,
          freight_gst_amount: freightGstAmount,
          reason,
        },
      );
      setSelectedGRNDetail(updated);
      setShowFreightAdjustmentModal(false);
      await fetchVendorPayables();
      if (selectedVendor) await viewVendorDetails(selectedVendor);
    } catch (error: any) {
      setFreightAdjustmentError(error?.message || 'Failed to update invoice freight');
    } finally {
      setFreightAdjustmentSubmitting(false);
    }
  };

  const updatePaymentBalance = (changes: Partial<typeof BLANK_FORM>) => {
    setPaymentForm((current) => {
      const next = { ...current, ...changes };
      const shouldRecalculate =
        Object.prototype.hasOwnProperty.call(changes, 'advance_adjustment_amount') ||
        (parseFloat(String(next.advance_adjustment_amount || '0')) || 0) > 0;
      if (!selectedGRNDetail || !shouldRecalculate) {
        return next;
      }

      const availableAdvancePaisa = toPaisa(getAvailableAdvance(selectedGRNDetail));
      const outstandingPaisa = toPaisa(selectedGRNDetail.outstanding_amount);
      const requestedAdvancePaisa = toPaisa(next.advance_adjustment_amount);
      const clampedAdvancePaisa = Math.min(Math.max(0, requestedAdvancePaisa), availableAdvancePaisa, outstandingPaisa);
      const tdsPaisa = Math.max(0, toPaisa(next.tds_amount));
      const shortPaisa = Math.max(0, toPaisa(next.short_payment_amount));
      const cashBalancePaisa = Math.max(0, outstandingPaisa - clampedAdvancePaisa - tdsPaisa - shortPaisa);

      return {
        ...next,
        // Keep this field exactly as typed while the user is entering it.
        // Formatting/clamping on every keypress makes typing "200000" turn
        // into "2.00" after the first digit.
        advance_adjustment_amount: next.advance_adjustment_amount,
        amount: moneyInputFromPaisa(cashBalancePaisa),
      };
    });
  };

  const clampAdvanceAdjustment = () => {
    if (!selectedGRNDetail) return;
    setPaymentForm((current) => {
      const requestedAdvancePaisa = toPaisa(current.advance_adjustment_amount);
      const limitPaisa = Math.min(
        toPaisa(getAvailableAdvance(selectedGRNDetail)),
        toPaisa(selectedGRNDetail.outstanding_amount),
      );
      if (requestedAdvancePaisa <= 0) {
        return { ...current, advance_adjustment_amount: '' };
      }
      if (requestedAdvancePaisa <= limitPaisa) {
        return current;
      }
      const clampedAdvancePaisa = Math.max(0, limitPaisa);
      const tdsPaisa = Math.max(0, toPaisa(current.tds_amount));
      const shortPaisa = Math.max(0, toPaisa(current.short_payment_amount));
      const cashBalancePaisa = Math.max(0, toPaisa(selectedGRNDetail.outstanding_amount) - clampedAdvancePaisa - tdsPaisa - shortPaisa);
      return {
        ...current,
        advance_adjustment_amount: moneyInputFromPaisa(clampedAdvancePaisa),
        amount: moneyInputFromPaisa(cashBalancePaisa),
      };
    });
  };

  const recordPayment = async () => {
    if (!selectedGRNDetail) return;
    setPaymentError(null);

    const amountPaisa = toPaisa(paymentForm.amount);
    const advanceAdjustmentPaisa = toPaisa(paymentForm.advance_adjustment_amount);
    const tdsPaisa = toPaisa(paymentForm.tds_amount);
    const shortPaisa = toPaisa(paymentForm.short_payment_amount);
    const outstandingPaisa = toPaisa(selectedGRNDetail.outstanding_amount);
    const availableAdvancePaisa = toPaisa(getAvailableAdvance(selectedGRNDetail));
    const amount = fromPaisa(amountPaisa);
    const advanceAdjustment = fromPaisa(advanceAdjustmentPaisa);
    const tds = fromPaisa(tdsPaisa);
    const short = fromPaisa(shortPaisa);
    const outstanding = selectedGRNDetail.outstanding_amount;
    const availableAdvance = getAvailableAdvance(selectedGRNDetail);
    const settlementTotalPaisa = amountPaisa + advanceAdjustmentPaisa + tdsPaisa + shortPaisa;
    const settlementTotal = fromPaisa(settlementTotalPaisa);

    if (amountPaisa < 0) { setPaymentError('Payment amount cannot be negative'); return; }
    if (advanceAdjustmentPaisa < 0) { setPaymentError('Advance adjustment cannot be negative'); return; }
    if (settlementTotalPaisa <= 0) { setPaymentError('Please enter a payment, advance adjustment, TDS, or short payment amount'); return; }
    if (advanceAdjustmentPaisa > availableAdvancePaisa) {
      setPaymentError(`Advance adjustment exceeds available advance Rs. ${moneyInput(availableAdvance)}`);
      return;
    }
    if (tdsPaisa < 0 || shortPaisa < 0) { setPaymentError('TDS and short payment cannot be negative'); return; }
    if (short > 0 && !paymentForm.short_payment_reason.trim()) {
      setPaymentError('Short payment reason is required');
      return;
    }
    if (paymentForm.close_invoice && settlementTotalPaisa < outstandingPaisa) {
      setPaymentError('Short payment amount must cover the remaining balance before closing the invoice');
      return;
    }
    if (settlementTotalPaisa > outstandingPaisa) {
      setPaymentError(`Total settlement Rs. ${moneyInput(settlementTotal)} exceeds outstanding Rs. ${moneyInput(outstanding)}`);
      return;
    }

    try {
      setSubmitting(true);
      await apiClient.post(`/purchase/debit-notes/grn/${selectedGRNDetail.id}/payment`, {
        amount,
        tds_amount: tds,
        short_payment_amount: short,
        short_payment_reason: paymentForm.short_payment_reason || undefined,
        advance_adjustment_amount: advanceAdjustment,
        payment_method: paymentForm.payment_method,
        payment_reference: paymentForm.payment_reference || undefined,
        payment_date: paymentForm.payment_date,
        payment_notes: paymentForm.payment_notes || undefined,
        close_invoice: paymentForm.close_invoice,
      });
      setShowPaymentModal(false);
      setShowGRNDetailModal(false);
      setShowDetailsModal(false);
      setPaymentForm({ ...BLANK_FORM });
      await Promise.all([fetchVendorPayables(), fetchAdvances()]);
    } catch (e: any) {
      setPaymentError(e.message || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  // Open edit payment modal
  const openEditPayment = (entry: PaymentEntry) => {
    if (!canRecordPayment) { setEditPaymentError('You do not have permission to edit payments'); return; }
    setEditingPayment(entry);
    setEditPaymentError(null);
    setEditPaymentForm({
      amount: entry.amount.toString(),
      advance_adjustment_amount: '',
      tds_amount: (entry.tds_amount || 0).toString(),
      short_payment_amount: (entry.short_payment_amount || 0).toString(),
      short_payment_reason: entry.short_payment_reason || '',
      payment_method: entry.payment_method || 'NEFT',
      payment_reference: entry.payment_reference || '',
      payment_date: entry.payment_date ? entry.payment_date.split('T')[0] : getTodayDateInputValue(),
      payment_notes: entry.payment_notes || '',
      close_invoice: false,
    });
    setShowEditPaymentModal(true);
  };

  // Handle update payment
  const handleUpdatePayment = async () => {
    if (!selectedGRNDetail || !editingPayment) return;

    const amount = parseFloat(editPaymentForm.amount);
    const tds = parseFloat(editPaymentForm.tds_amount || '0') || 0;
    const short = parseFloat(editPaymentForm.short_payment_amount || '0') || 0;

    // Calculate what the new outstanding would be (original outstanding + old payment amount - new payment)
    const originalOutstanding = selectedGRNDetail.outstanding_amount + editingPayment.amount + (editingPayment.tds_amount || 0) + (editingPayment.short_payment_amount || 0);
    const otherPayments = selectedGRNDetail.payment_entries
      .filter(e => e.id !== editingPayment.id && !isSystemPaymentEntry(e))
      .reduce((sum, e) => sum + e.amount + (e.tds_amount || 0) + (e.short_payment_amount || 0), 0);
    const newSettlement = amount + tds + short + otherPayments;

    if (isNaN(amount) || amount < 0) { setEditPaymentError('Please enter a valid payment amount'); return; }
    if (tds < 0 || short < 0) { setEditPaymentError('TDS and short payment cannot be negative'); return; }
    if (short > 0 && !editPaymentForm.short_payment_reason.trim()) {
      setEditPaymentError('Short payment reason is required');
      return;
    }
    if (newSettlement > originalOutstanding + 0.009) {
      setEditPaymentError(`Total settlement ₹${newSettlement.toFixed(2)} exceeds net payable ₹${originalOutstanding.toFixed(2)}`);
      return;
    }

    try {
      setEditingSubmitting(true);
      const endpoint = `/purchase/debit-notes/grn/${selectedGRNDetail.id}/payment/${editingPayment.id}`;
      await apiClient.put(endpoint, {
        amount,
        tds_amount: tds,
        short_payment_amount: short,
        short_payment_reason: editPaymentForm.short_payment_reason || undefined,
        payment_method: editPaymentForm.payment_method,
        payment_reference: editPaymentForm.payment_reference || undefined,
        payment_date: editPaymentForm.payment_date,
        payment_notes: editPaymentForm.payment_notes || undefined,
      });
      setShowEditPaymentModal(false);
      setEditingPayment(null);
      setEditPaymentForm({ ...BLANK_FORM });
      // Refresh data
      await viewGRNDetail(selectedGRNDetail);
      await Promise.all([fetchVendorPayables(), fetchAdvances()]);
    } catch (e: any) {
      setEditPaymentError(e.message || 'Failed to update payment');
    } finally {
      setEditingSubmitting(false);
    }
  };

  // Handle payment reversal
  const openReversePaymentModal = (entry: PaymentEntry) => {
    if (!canRecordPayment) {
      setEditPaymentError('You do not have permission to reverse payments');
      return;
    }
    if (!selectedGRNDetail) return;
    setReversePaymentTarget(entry);
    setReversePaymentReason('');
    setReversePaymentError(null);
  };

  const handleReversePayment = async () => {
    if (!canRecordPayment) {
      setReversePaymentError('You do not have permission to reverse payments');
      return;
    }
    if (!selectedGRNDetail || !reversePaymentTarget) return;
    const reason = reversePaymentReason.trim();
    if (!reason) {
      setReversePaymentError('Payment reversal reason is required');
      return;
    }

    try {
      setReversePaymentSubmitting(true);
      setReversePaymentError(null);
      await apiClient.post(`/purchase/debit-notes/grn/${selectedGRNDetail.id}/payment/${reversePaymentTarget.id}/reverse`, {
        reason,
      });
      setReversePaymentTarget(null);
      setReversePaymentReason('');
      // Refresh data
      await viewGRNDetail(selectedGRNDetail);
      await Promise.all([fetchVendorPayables(), fetchAdvances()]);
    } catch (e: any) {
      setReversePaymentError(e.message || 'Failed to reverse payment');
    } finally {
      setReversePaymentSubmitting(false);
    }
  };

  // Bulk Settlement
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  useEscapeKey(showSettlementModal, () => setShowSettlementModal(false));
  const [settlementForm, setSettlementForm] = useState({ amount: '', payment_method: 'NEFT', payment_reference: '', payment_date: getTodayDateInputValue(), payment_notes: '', tds_amount: '', short_payment_amount: '' });
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [settlementSubmitting, setSettlementSubmitting] = useState(false);
  const [settlementResult, setSettlementResult] = useState<{ settled: number; failed: number; messages: string[] } | null>(null);

  const openSettlementModal = () => {
    const allSelected = vendorGRNs.filter(g => selectedGRNIds.has(g.id));
    const selected = allSelected.filter(g => !isSubcontractPayable(g));
    const subcontractSelected = allSelected.length - selected.length;
    if (!selected.length) { setPageNotice({ title: 'No invoice selected', message: 'Select at least one GRN invoice to settle.', type: 'warning' }); return; }
    if (subcontractSelected > 0) {
      setPageNotice({
        title: 'Subcontracting rows skipped',
        message: 'Subcontracting rows are paid individually from this Accounts Payable screen so that the service receipt, QC and invoice controls remain visible.',
        type: 'info',
      });
    }
    const totalOut = selected.reduce((s, g) => s + getPayableOutstanding(g), 0);
    setSettlementError(null);
    setSettlementResult(null);
    setSettlementForm({ amount: totalOut.toFixed(2), payment_method: 'NEFT', payment_reference: '', payment_date: getTodayDateInputValue(), payment_notes: '', tds_amount: '', short_payment_amount: '' });
    setShowSettlementModal(true);
  };

  const submitSettlement = async () => {
    const selected = vendorGRNs.filter(g => selectedGRNIds.has(g.id) && !isSubcontractPayable(g));
    if (!selected.length) return;
    const totalPayment = parseFloat(settlementForm.amount || '0') || 0;
    const totalTds = parseFloat(settlementForm.tds_amount || '0') || 0;
    const totalShort = parseFloat(settlementForm.short_payment_amount || '0') || 0;
    const grandTotal = totalPayment + totalTds + totalShort;
    if (grandTotal <= 0) { setSettlementError('Enter a valid total amount'); return; }
    const grnOutstandings = selected
      .map(g => ({ grn: g, outstanding: getPayableOutstanding(g) }))
      .filter(x => x.outstanding > 0.009);
    const totalOutstanding = grnOutstandings.reduce((s, x) => s + x.outstanding, 0);
    if (grandTotal > totalOutstanding + 0.01) {
      setSettlementError(`Settlement total ₹${fmtINR(grandTotal)} exceeds total outstanding ₹${fmtINR(totalOutstanding)}`);
      return;
    }
    setSettlementSubmitting(true);
    setSettlementError(null);
    let settled = 0, failed = 0;
    const messages: string[] = [];
    let remainingPayment = totalPayment;
    let remainingTds = totalTds;
    let remainingShort = totalShort;
    for (const { grn, outstanding } of grnOutstandings) {
      const ratio = totalOutstanding > 0 ? outstanding / totalOutstanding : 1 / grnOutstandings.length;
      const grnPayment = Math.min(remainingPayment, parseFloat((totalPayment * ratio).toFixed(2)));
      const grnTds = Math.min(remainingTds, parseFloat((totalTds * ratio).toFixed(2)));
      const grnShort = Math.min(remainingShort, parseFloat((totalShort * ratio).toFixed(2)));
      const grnSettled = grnPayment + grnTds + grnShort;
      if (grnSettled < 0.01) continue;
      try {
        await apiClient.post(`/purchase/debit-notes/grn/${grn.id}/payment`, {
          amount: grnPayment,
          tds_amount: grnTds,
          short_payment_amount: grnShort,
          short_payment_reason: grnShort > 0 ? settlementForm.payment_notes || 'Bulk short payment settlement' : undefined,
          payment_method: settlementForm.payment_method,
          payment_reference: settlementForm.payment_reference || undefined,
          payment_date: settlementForm.payment_date,
          payment_notes: settlementForm.payment_notes || undefined,
          close_invoice: Math.abs(grnSettled - outstanding) < 0.01,
        });
        remainingPayment = Math.max(0, remainingPayment - grnPayment);
        remainingTds = Math.max(0, remainingTds - grnTds);
        remainingShort = Math.max(0, remainingShort - grnShort);
        settled++;
        messages.push(`✅ ${grn.grn_number}: ₹${fmtINR(grnSettled)} settled`);
      } catch (e: any) {
        failed++;
        messages.push(`❌ ${grn.grn_number}: ${e?.message || 'Failed'}`);
      }
    }
    setSettlementResult({ settled, failed, messages });
    setSettlementSubmitting(false);
    if (settled > 0) {
      await Promise.all([fetchVendorPayables(), fetchAdvances()]);
      setSelectedGRNIds(new Set());
      // Refresh vendor GRN list
      if (selectedVendor) await viewVendorDetails(selectedVendor);
    }
  };

  const printPaymentRequest = () => {
    const selected = vendorGRNs.filter(g => selectedGRNIds.has(g.id));
    if (!selected.length) { setPageNotice({ title: 'No invoice selected', message: 'Select at least one invoice to print.', type: 'warning' }); return; }
    const totalOutstandingSelected = selected.reduce((s, g) => s + getPayableOutstanding(g), 0);

    const rows = selected.map((grn, idx) => {
      const net = getPayableNet(grn);
      const paid = getPayableSettled(grn);
      const outstanding = getPayableOutstanding(grn);
      const gross = +(grn.gross_amount || 0) + +(grn.tax_amount || 0);
      return `<tr>
        <td>${idx + 1}</td>
        <td>${grn.purchase_order?.po_number || '—'}</td>
        <td>${grn.invoice_number || '—'}</td>
        <td>${grn.invoice_date ? new Date(grn.invoice_date).toLocaleDateString('en-IN') : '—'}</td>
        <td>${grn.grn_number}</td>
        <td style="text-align:right">₹${fmtINR(gross)}</td>
        <td style="text-align:right">₹${fmtINR(net)}</td>
        <td style="text-align:right;color:#16a34a">₹${fmtINR(paid)}</td>
        <td style="text-align:right;font-weight:700;color:#ea580c">₹${fmtINR(outstanding)}</td>
      </tr>`;
    }).join('');

    const _now = new Date();
    const printedAt = `${_now.getDate().toString().padStart(2,'0')}-${(_now.getMonth()+1).toString().padStart(2,'0')}-${_now.getFullYear()} ${_now.getHours().toString().padStart(2,'0')}:${_now.getMinutes().toString().padStart(2,'0')}`;
    const branding = buildDocumentBranding();
    const html = `<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Payment Request - ${selectedVendor?.vendor_name || ''}</title>
      <script>window.onload = window.print<\/script>
      <style>
        @page { margin: 1cm; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 16px; }
        .title-bar { background: #1e3a8a; color: #fff; text-align: center; padding: 8px; font-size: 14px; font-weight: bold; margin: 10px 0; }
        .meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11px; }
        .meta-block strong { display: block; font-size: 10px; text-transform: uppercase; color: #555; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1e3a8a; color: #fff; padding: 5px 8px; font-size: 10px; text-align: left; }
        td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; }
        tr:nth-child(even) td { background: #f9fafb; }
        .total-row td { font-weight: bold; background: #fff7ed; border-top: 2px solid #ea580c; }
        .footer { margin-top: 28px; display: flex; justify-content: space-around; }
        .sig { text-align: center; border-top: 1px solid #333; padding-top: 6px; min-width: 140px; font-size: 10px; }
        .note { margin-top: 16px; font-size: 10px; color: #555; border: 1px solid #e5e7eb; padding: 8px; border-radius: 4px; }
      </style>
    </head><body>
      <div style="text-align:center;font-size:15px;font-weight:bold;color:#1e3a8a;">${branding.companyName}</div>
      <div style="text-align:center;font-size:10px;color:#555;margin-bottom:4px;">${branding.address}</div>
      <div class="title-bar">PAYMENT REQUEST / APPROVAL NOTE</div>
      <div class="meta">
        <div class="meta-block"><strong>Vendor</strong>${selectedVendor?.vendor_name || '—'} (${selectedVendor?.vendor_code || '—'})</div>
        <div class="meta-block" style="text-align:right"><strong>Date</strong>${printedAt}</div>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>PO No.</th><th>Invoice No.</th><th>Invoice Date</th><th>GRN No.</th>
          <th style="text-align:right">Gross</th><th style="text-align:right">Net Payable</th>
          <th style="text-align:right">Paid</th><th style="text-align:right">Outstanding</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="8" style="text-align:right">Total Outstanding (${selected.length} invoice${selected.length > 1 ? 's' : ''})</td>
            <td style="text-align:right;color:#ea580c">₹${fmtINR(totalOutstandingSelected)}</td>
          </tr>
        </tbody>
      </table>
      <div class="note">
        <strong>Note:</strong> This payment request has been prepared for approval. Please arrange payment for the above listed invoices at the earliest.
      </div>
      <div class="footer">
        <div class="sig">Prepared By (Accounts)</div>
        <div class="sig">Approved By (Manager)</div>
        <div class="sig">Authorized Signatory</div>
      </div>
    </body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const vendorPayablesColumns: ListTableColumn<VendorPayable>[] = [
    {
      id: 'vendor',
      label: 'Vendor',
      cell: (v) => (
        <div>
          <div className="font-semibold text-gray-900">{v.vendor_name}</div>
          <div className="text-sm text-gray-500">{v.vendor_code}</div>
        </div>
      ),
      sortAccessor: (v) => v.vendor_name,
      searchAccessor: (v) => `${v.vendor_name} ${v.vendor_code}`,
    },
    {
      id: 'total_gross',
      label: 'Invoice Value',
      accessor: (v) => v.total_gross,
      cell: (v) => `₹${fmtINR(v.total_gross)}`,
      sortAccessor: (v) => v.total_gross,
      align: 'right',
    },
    {
      id: 'total_paid',
      label: 'Paid So Far',
      accessor: (v) => v.total_paid,
      cell: (v) => <span className="text-green-700 font-semibold">₹{fmtINR(v.total_paid)}</span>,
      sortAccessor: (v) => v.total_paid,
      align: 'right',
    },
    {
      id: 'advance_balance',
      label: 'Advance Available',
      accessor: (v) => vendorAdvanceBalances.get(v.vendor_id) || 0,
      cell: (v) => {
        const balance = vendorAdvanceBalances.get(v.vendor_id) || 0;
        return balance > 0 ? (
          <div className="text-sm font-semibold text-blue-600">₹{fmtINR(balance)}</div>
        ) : (
          <div className="text-sm text-gray-400">—</div>
        );
      },
      sortAccessor: (v) => vendorAdvanceBalances.get(v.vendor_id) || 0,
      align: 'right',
    },
    {
      id: 'total_outstanding',
      label: 'Net Outstanding',
      accessor: (v) => {
        const advance = vendorAdvanceBalances.get(v.vendor_id) || 0;
        return Math.max(0, v.total_outstanding - advance);
      },
      cell: (v) => {
        const advance = vendorAdvanceBalances.get(v.vendor_id) || 0;
        const netOutstanding = Math.max(0, v.total_outstanding - advance);
        return (
          <div className="text-lg font-bold text-orange-600">
            ₹{fmtINR(netOutstanding)}
            {advance > 0 && (
              <div className="text-xs font-normal text-blue-600">
                (after ₹{fmtINR(advance)} advance)
              </div>
            )}
          </div>
        );
      },
      sortAccessor: (v) => {
        const advance = vendorAdvanceBalances.get(v.vendor_id) || 0;
        return Math.max(0, v.total_outstanding - advance);
      },
      align: 'right',
    },
    {
      id: 'grn_count',
      label: 'Invoices',
      accessor: (v) => v.grn_count,
      cell: (v) => (
        <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-semibold">{v.grn_count}</span>
      ),
      sortAccessor: (v) => v.grn_count,
      align: 'center',
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (vendor) => (
        <div className="flex gap-2">
          <button type="button" onClick={() => viewVendorDetails(vendor)}
            className="text-orange-600 hover:text-orange-800 font-medium transition-colors">
            View Invoices →
          </button>
          {canRecordPayment && (
            <button 
              onClick={() => {
                // Open unified advance modal with BLANKET type pre-selected
                setAdvanceForm(prev => ({ 
                  ...prev, 
                  advance_type: 'BLANKET',
                  vendor_id: vendor.vendor_id 
                }));
                setPoSearch('');
                setPoDropdownOpen(false);
                fetchVendorsForAdvance();
                setShowAdvanceModal(true);
              }}
              className="text-blue-600 hover:text-blue-800 font-medium text-xs px-2 py-1 bg-blue-50 rounded transition-colors"
              title="Add blanket advance payment for this vendor"
            >
              + Advance
            </button>
          )}
        </div>
      ),
      sortable: false,
      hideable: false,
    },
  ];

  const pendingInvoiceColumns: ListTableColumn<any>[] = [
    { id: 'grn_number', label: 'GRN No.', accessor: (g) => g.grn_number, sortAccessor: (g) => g.grn_number, searchAccessor: (g) => g.grn_number, cell: (g) => <a href={`/dashboard/purchase/grn?viewId=${g.id}`} target="_blank" className="font-semibold text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.grn_number}</a>, minWidth: 150 },
    { id: 'invoice_number', label: 'Invoice No.', accessor: (g) => g.invoice_number || '—', sortAccessor: (g) => g.invoice_number || '', searchAccessor: (g) => g.invoice_number || '', cell: (g) => g.invoice_number ? <a href={`/dashboard/purchase/grn?viewId=${g.id}`} target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.invoice_number}</a> : '—', minWidth: 140 },
    { id: 'vendor', label: 'Vendor', accessor: (g) => g.vendor?.name || '—', sortAccessor: (g) => g.vendor?.name || '', searchAccessor: (g) => `${g.vendor?.name || ''} ${g.vendor?.code || ''}`, minWidth: 190 },
    { id: 'po_number', label: 'PO No.', accessor: (g) => g.purchase_order?.po_number || '—', sortAccessor: (g) => g.purchase_order?.po_number || '', searchAccessor: (g) => g.purchase_order?.po_number || '', cell: (g) => g.purchase_order?.po_number ? <a href={`/dashboard/purchase/orders?viewId=${g.purchase_order.id || g.po_id}`} target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.purchase_order.po_number}</a> : '—', minWidth: 150 },
    { id: 'receipt_date', label: 'Receipt Date', accessor: (g) => g.receipt_date ? new Date(g.receipt_date).toLocaleDateString('en-IN') : '—', sortAccessor: (g) => g.receipt_date || '', minWidth: 130 },
    { id: 'net', label: 'Net Payable', accessor: (g) => getPayableNet(g), cell: (g) => `Rs. ${fmtINR(getPayableNet(g))}`, sortAccessor: (g) => getPayableNet(g), align: 'right', minWidth: 140 },
    { id: 'settled', label: 'Settled', accessor: (g) => getPayableSettled(g), cell: (g) => <span className="font-semibold text-green-700">Rs. {fmtINR(getPayableSettled(g))}</span>, sortAccessor: (g) => getPayableSettled(g), align: 'right', minWidth: 130 },
    { id: 'outstanding', label: 'Outstanding', accessor: (g) => getPayableOutstanding(g), cell: (g) => <span className="font-bold text-orange-600">Rs. {fmtINR(getPayableOutstanding(g))}</span>, sortAccessor: (g) => getPayableOutstanding(g), align: 'right', minWidth: 140 },
    { id: 'status', label: 'Status', accessor: (g) => g.payment_status || 'UNPAID', cell: (g) => paymentStatusBadge(g.payment_status), sortAccessor: (g) => g.payment_status || '', minWidth: 120 },
    { id: 'actions', label: 'Actions', accessor: () => '', cell: (g) => <button type="button" onClick={() => viewGRNDetail(g)} className="rounded-md border border-[#D8C8AA] px-3 py-1.5 text-xs font-semibold text-[#5E4635] hover:bg-[#F7F0E4]">History</button>, sortable: false, hideable: false, minWidth: 120 },
  ];

  const paidInvoiceColumns: ListTableColumn<any>[] = [
    { id: 'grn_number', label: 'GRN No.', accessor: (g) => g.grn_number, sortAccessor: (g) => g.grn_number, searchAccessor: (g) => g.grn_number, cell: (g) => <a href={`/dashboard/purchase/grn?viewId=${g.id}`} target="_blank" className="font-semibold text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.grn_number}</a>, minWidth: 150 },
    { id: 'invoice_number', label: 'Invoice No.', accessor: (g) => g.invoice_number || '—', sortAccessor: (g) => g.invoice_number || '', searchAccessor: (g) => g.invoice_number || '', cell: (g) => g.invoice_number ? <a href={`/dashboard/purchase/grn?viewId=${g.id}`} target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.invoice_number}</a> : '—', minWidth: 140 },
    { id: 'vendor', label: 'Vendor', accessor: (g) => g.vendor?.name || '—', sortAccessor: (g) => g.vendor?.name || '', searchAccessor: (g) => `${g.vendor?.name || ''} ${g.vendor?.code || ''}`, minWidth: 190 },
    { id: 'po_number', label: 'PO No.', accessor: (g) => g.purchase_order?.po_number || '—', sortAccessor: (g) => g.purchase_order?.po_number || '', searchAccessor: (g) => g.purchase_order?.po_number || '', cell: (g) => g.purchase_order?.po_number ? <a href={`/dashboard/purchase/orders?viewId=${g.purchase_order.id || g.po_id}`} target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.purchase_order.po_number}</a> : '—', minWidth: 150 },
    { id: 'invoice_date', label: 'Invoice Date', accessor: (g) => g.invoice_date ? new Date(g.invoice_date).toLocaleDateString('en-IN') : '—', sortAccessor: (g) => g.invoice_date || '', minWidth: 130 },
    { id: 'net', label: 'Net Payable', accessor: (g) => getPayableNet(g), cell: (g) => <span className="tabular-nums">Rs. {fmtINR(getPayableNet(g))}</span>, sortAccessor: (g) => getPayableNet(g), align: 'right', minWidth: 160 },
    { id: 'settled', label: 'Total Paid', accessor: (g) => getPayableSettled(g), cell: (g) => <span className="font-bold text-green-700 tabular-nums">Rs. {fmtINR(getPayableSettled(g))}</span>, sortAccessor: (g) => getPayableSettled(g), align: 'right', minWidth: 160 },
    { id: 'payment_method', label: 'Method', accessor: (g) => g.payment_method || '—', sortAccessor: (g) => g.payment_method || '', minWidth: 120 },
    { id: 'payment_reference', label: 'Reference', accessor: (g) => g.payment_reference || '—', searchAccessor: (g) => g.payment_reference || '', minWidth: 180 },
    { id: 'payment_date', label: 'Payment Date', accessor: (g) => g.payment_date ? new Date(g.payment_date).toLocaleDateString('en-IN') : '—', sortAccessor: (g) => g.payment_date || '', minWidth: 130 },
    { id: 'actions', label: 'Actions', accessor: () => '', cell: (g) => <button type="button" onClick={() => viewGRNDetail(g)} className="rounded-md border border-[#D8C8AA] px-3 py-1.5 text-xs font-semibold text-[#5E4635] hover:bg-[#F7F0E4]">History</button>, sortable: false, hideable: false, minWidth: 120 },
  ];

  const advanceColumns: ListTableColumn<any>[] = [
    { id: 'payment_date', label: 'Date', accessor: (a) => a.payment_date ? new Date(a.payment_date).toLocaleDateString('en-IN') : '—', sortAccessor: (a) => a.payment_date || '', minWidth: 130 },
    { id: 'advance_type', label: 'Type', accessor: (a) => a.advance_type, sortAccessor: (a) => a.advance_type, cell: (a) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.advance_type === 'PO' ? 'bg-blue-100 text-blue-800' : 'bg-teal-100 text-teal-800'}`}>{a.advance_type === 'PO' ? 'PO' : 'Blanket'}</span>, minWidth: 110 },
    { id: 'po_number', label: 'PO Number', accessor: (a) => a.purchase_order?.po_number || '—', sortAccessor: (a) => a.purchase_order?.po_number || '', searchAccessor: (a) => a.purchase_order?.po_number || '', minWidth: 160 },
    { id: 'vendor', label: 'Vendor', accessor: (a) => a.vendor?.name || '—', sortAccessor: (a) => a.vendor?.name || '', searchAccessor: (a) => `${a.vendor?.name || ''} ${a.vendor?.code || ''}`, minWidth: 190 },
    { id: 'amount', label: 'Total', accessor: (a) => a.amount || 0, cell: (a) => `₹${fmtINR(a.amount || 0)}`, sortAccessor: (a) => a.amount || 0, align: 'right', minWidth: 130 },
    { id: 'utilized_amount', label: 'Used', accessor: (a) => a.utilized_amount || 0, cell: (a) => <span className="text-amber-600">₹{fmtINR(a.utilized_amount || 0)}</span>, sortAccessor: (a) => a.utilized_amount || 0, align: 'right', minWidth: 130 },
    { id: 'balance_amount', label: 'Balance', accessor: (a) => a.balance_amount || 0, cell: (a) => <span className="font-bold text-green-700">₹{fmtINR(a.balance_amount || 0)}</span>, sortAccessor: (a) => a.balance_amount || 0, align: 'right', minWidth: 130 },
    { id: 'status', label: 'Status', accessor: (a) => (a.balance_amount || 0) > 0.009 ? 'Available' : 'Fully Used', cell: (a) => (a.balance_amount || 0) > 0.009 ? <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Available</span> : <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Fully Used</span>, minWidth: 130 },
    {
      id: 'actions', label: 'Actions', accessor: () => '', sortable: false, hideable: false, minWidth: 120,
      cell: (a) => (
        <button
          type="button"
          onClick={() => { setSelectedAdvance(a); setShowAdvanceDetailModal(true); }}
          className="rounded-md border border-[#D8C8AA] px-3 py-1.5 text-xs font-semibold text-[#5E4635] hover:bg-[#F7F0E4]"
        >
          View details
        </button>
      ),
    },
  ];

  const vendorInvoiceColumns: ListTableColumn<GRNPayable>[] = [
    { id: 'source', label: 'Source', accessor: (g) => isSubcontractPayable(g) ? 'Subcontract' : 'GRN', sortAccessor: (g) => isSubcontractPayable(g) ? 'SUBCONTRACT' : 'GRN', cell: (g) => isSubcontractPayable(g)
      ? <span className="px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">Subcontract</span>
      : <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">GRN</span>, minWidth: 120 },
    { id: 'po_number', label: 'PO Number', accessor: (g) => g.purchase_order?.po_number || '—', sortAccessor: (g) => g.purchase_order?.po_number || '', searchAccessor: (g) => g.purchase_order?.po_number || '', cell: (g) => g.purchase_order?.po_number ? <a href={`/dashboard/purchase/orders?viewId=${g.purchase_order.id || g.po_id}`} target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.purchase_order.po_number}</a> : '—', minWidth: 150 },
    { id: 'invoice_number', label: 'Supplier Invoice No.', accessor: (g) => g.invoice_number || '—', sortAccessor: (g) => g.invoice_number || '', searchAccessor: (g) => g.invoice_number || '', cell: (g) => g.invoice_number ? <a href={`/dashboard/purchase/grn?viewId=${g.id}`} target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.invoice_number}</a> : '—', minWidth: 170 },
    { id: 'invoice_date', label: 'Invoice Date', accessor: (g) => g.invoice_date ? new Date(g.invoice_date).toLocaleDateString('en-IN') : '—', sortAccessor: (g) => g.invoice_date || '', minWidth: 130 },
    { id: 'grn_number', label: 'GRN Number', accessor: (g) => g.grn_number, sortAccessor: (g) => g.grn_number, searchAccessor: (g) => g.grn_number, cell: (g) => <a href={`/dashboard/purchase/grn?viewId=${g.id}`} target="_blank" className="font-semibold text-blue-600 hover:text-blue-800 hover:underline" onClick={(e) => e.stopPropagation()}>{g.grn_number}</a>, minWidth: 150 },
    { id: 'receipt_date', label: 'Receipt Date', accessor: (g) => g.receipt_date ? new Date(g.receipt_date).toLocaleDateString('en-IN') : '—', sortAccessor: (g) => g.receipt_date || '', minWidth: 130 },
    { id: 'gross', label: 'Gross', accessor: (g) => +(g.gross_amount || 0) + +(g.freight_amount || 0) + +(g.freight_gst_amount || 0), cell: (g) => <span title={((g.freight_amount || 0) > 0 || (g.freight_gst_amount || 0) > 0) ? `Items: ₹${fmtINR(g.gross_amount)} + Freight: ₹${fmtINR((g.freight_amount || 0) + (g.freight_gst_amount || 0))}` : undefined}>₹{fmtINR(+(g.gross_amount || 0) + +(g.freight_amount || 0) + +(g.freight_gst_amount || 0))}</span>, sortAccessor: (g) => +(g.gross_amount || 0) + +(g.freight_amount || 0) + +(g.freight_gst_amount || 0), align: 'right', minWidth: 130 },
    { id: 'debit', label: 'Debit', accessor: (g) => g.debit_note_amount || 0, cell: (g) => <span className="text-red-600">-₹{fmtINR(g.debit_note_amount)}</span>, sortAccessor: (g) => g.debit_note_amount || 0, align: 'right', minWidth: 120 },
    { id: 'net', label: 'Net Invoice', accessor: (g) => getPayableNet(g), cell: (g) => <span className="font-semibold">Rs. {fmtINR(getPayableNet(g))}</span>, sortAccessor: (g) => getPayableNet(g), align: 'right', minWidth: 140 },
    { id: 'paid', label: 'Settled', accessor: (g) => getPayableSettled(g), cell: (g) => <span className="text-green-700">Rs. {fmtINR(getPayableSettled(g))}</span>, sortAccessor: (g) => getPayableSettled(g), align: 'right', minWidth: 120 },
    { id: 'outstanding', label: 'Outstanding', accessor: (g) => getPayableOutstanding(g), cell: (g) => <span className="font-bold text-orange-600">Rs. {fmtINR(getPayableOutstanding(g))}</span>, sortAccessor: (g) => getPayableOutstanding(g), align: 'right', minWidth: 150 },
    { id: 'status', label: 'Status', accessor: (g) => g.payment_status || 'UNPAID', cell: (g) => paymentStatusBadge(g.payment_status), sortAccessor: (g) => g.payment_status || '', minWidth: 120 },
    { id: 'actions', label: 'Actions', hideable: false, sortable: false, cell: (g) => {
      const outstanding = getPayableOutstanding(g);
      if (isSubcontractPayable(g)) {
        return (
          <div className="flex gap-1">
            <button onClick={() => viewGRNDetail(g)} className="px-2 py-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100">Linked PO</button>
            {canRecordPayment && outstanding > 0.009 && <button onClick={() => void recordSubcontractPayment(g)} className="px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700">+ Payment</button>}
          </div>
        );
      }
      return (
        <div className="flex gap-1">
          <button onClick={() => viewGRNDetail(g)} className="px-2 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100">History</button>
          {canRecordPayment && outstanding > 0.009 && <button onClick={() => openPaymentModal(g)} className="px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700">+ Payment</button>}
        </div>
      );
    }, minWidth: 160 },
  ];

  const totalOutstanding = vendorPayables.reduce((s, v) => s + (v.total_outstanding || 0), 0);
  const totalPaid = vendorPayables.reduce((s, v) => s + (v.total_paid || 0), 0);

  return (
    <div className="min-h-screen bg-[#FAF9F6] p-6 text-[#2F241D]">
      <div className="w-full max-w-none space-y-5">
        <div className="bg-white rounded-md border border-[#E8DCC4] p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47] mb-1">Accounts</div>
            <h1 className="text-3xl font-bold text-[#3F2D20]">Accounts Payable</h1>
            <p className="text-[#6F4E37] text-sm mt-1">Vendor liability register with invoice approval, advances, settlement, and payment audit trail.</p>
          </div>
          {canRecordPayment && (
            <button onClick={() => { 
              fetchPOsForAdvance(); 
              fetchVendorsForAdvance();
              setPoSearch('');
              setPoDropdownOpen(false);
              setShowAdvanceModal(true); 
              setAdvanceError(null); 
            }}
              className="px-4 py-2 bg-[#8B6F47] text-white rounded-md text-sm font-semibold hover:bg-[#745A37]">
              + Advance Payment
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E8DCC4] bg-white px-4 py-3"><label className="text-xs font-bold uppercase tracking-wide text-[#7A6756]">Payables workspace</label><select value={activeTab} onChange={(event) => setActiveTab(event.target.value as typeof activeTab)} className="rounded-md border border-[#D8C8AA] bg-white px-3 py-2 text-sm font-semibold text-[#3F2D20]"><option value="payables">Outstanding payables</option><option value="pending">Pending invoices ({pendingInvoices.length})</option><option value="paid">Paid invoices ({paidInvoices.length})</option><option value="advances">Advances ({advances.filter(a => (a.balance_amount || 0) > 0).length})</option></select></div>

        {activeTab === 'payables' && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 rounded-md border border-[#E8DCC4] bg-white overflow-hidden">
          <div className="p-4 border-r border-[#E8DCC4]">
            <div className="text-xs text-amber-700 font-semibold mb-1">Total Vendors</div>
            <div className="text-2xl font-bold text-amber-900">{vendorPayables.length}</div>
          </div>
          <div className="p-4 border-r border-[#E8DCC4]">
            <div className="text-xs text-amber-700 font-semibold mb-1">Total Invoices</div>
            <div className="text-2xl font-bold text-amber-600">{vendorPayables.reduce((s, v) => s + v.grn_count, 0)}</div>
          </div>
          <div className="p-4 border-r border-[#E8DCC4]">
            <div className="text-xs text-green-700 font-semibold mb-1">Total Paid</div>
            <div className="text-xl font-bold text-green-600">₹{fmtINR(totalPaid)}</div>
          </div>
          <div className="p-4">
            <div className="text-xs text-red-700 font-semibold mb-1">Outstanding</div>
            <div className="text-xl font-bold text-red-600">₹{fmtINR(totalOutstanding)}</div>
          </div>
        </div>

        <div className="bg-white rounded-md border border-[#E8DCC4] overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading payables...</div>
          ) : vendorPayables.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-5xl mb-3">💰</div>
              <h3 className="text-lg font-semibold text-gray-700">No Outstanding Payables</h3>
              <p className="text-gray-500 text-sm">All vendor payments are settled</p>
            </div>
          ) : (
            <ListTable storageKey="accountsPayablesVendorsTable" rows={vendorPayables}
              columns={vendorPayablesColumns} getRowId={(r) => r.vendor_id}
              defaultPageSize={10} pageSizeOptions={[10, 25, 50, 100]}
              searchPlaceholder="Search vendor name/code…" />
          )}
        </div>
        </>)}

        {activeTab === 'pending' && (
          <div className="bg-white rounded-md border border-[#E8DCC4] overflow-hidden">
            <div className="p-4 border-b border-[#E8DCC4]"><h3 className="font-semibold text-[#3F2D20]">All Pending Invoices</h3><p className="text-xs text-[#7A6756] mt-0.5">Approved GRN invoices with open liability after payments, TDS, short-pay, and advances.</p></div>
            {loadingPending ? <div className="p-8 text-center text-gray-400">Loading...</div> : pendingInvoices.length === 0 ? (
              <div className="p-10 text-center text-gray-400"><div className="text-4xl mb-2">✅</div><p>No pending invoices</p></div>
            ) : (
              <ListTable storageKey="accountsPayablesPendingInvoicesTable" rows={pendingInvoices}
                columns={pendingInvoiceColumns} getRowId={(r) => r.id}
                defaultPageSize={25} pageSizeOptions={[10, 25, 50, 100]}
                searchPlaceholder="Search GRN, invoice, vendor, PO…" exportFilename="pending-invoices.csv" />
            )}
          </div>
        )}

        {activeTab === 'paid' && (
          <div className="bg-white rounded-md border border-[#E8DCC4] overflow-hidden">
            <div className="p-4 border-b border-[#E8DCC4] flex justify-between items-center">
              <div><h3 className="font-semibold text-[#3F2D20]">Paid Invoices</h3><p className="text-xs text-[#7A6756] mt-0.5">Fully settled GRN invoices</p></div>
              <div className="text-sm font-bold text-green-700">Total Paid: ₹{fmtINR(paidInvoices.reduce((s: number, g: any) => s + g.settled, 0))}</div>
            </div>
            {loadingPaid ? <div className="p-8 text-center text-gray-400">Loading...</div> : paidInvoices.length === 0 ? (
              <div className="p-10 text-center text-gray-400"><div className="text-4xl mb-2">💳</div><p>No paid invoices yet</p></div>
            ) : (
              <ListTable storageKey="accountsPayablesPaidInvoicesTable" rows={paidInvoices}
                columns={paidInvoiceColumns} getRowId={(r) => r.id}
                defaultPageSize={25} pageSizeOptions={[10, 25, 50, 100]}
                searchPlaceholder="Search paid invoices…" exportFilename="paid-invoices.csv" />
            )}
          </div>
        )}

        {activeTab === 'advances' && (
          <div className="space-y-4">
            {/* Filter buttons */}
            <div className="flex gap-2">
              {(['ALL', 'PO', 'BLANKET'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAdvanceFilter(type)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    advanceFilter === type
                      ? 'bg-[#8B6F47] text-white'
                      : 'bg-white border border-[#E8DCC4] text-[#6F4E37] hover:bg-[#F6EFE2]'
                  }`}
                >
                  {type === 'ALL' ? 'All Advances' : type === 'PO' ? 'PO Advances' : 'Blanket Advances'}
                </button>
              ))}
            </div>
            
            <div className="bg-white rounded-md border border-[#E8DCC4] overflow-hidden">
              <div className="p-4 border-b border-[#E8DCC4] flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-[#3F2D20]">Vendor Advances</h3>
                  <p className="text-xs text-[#7A6756] mt-0.5">PO-specific and blanket advances available for invoice settlement</p>
                </div>
                <div className="text-sm font-bold text-[#6F4E37]">
                  Total Available: ₹{fmtINR(advances.reduce((s: number, a: any) => s + (a.balance_amount || 0), 0))}
                </div>
              </div>
              {loadingAdvances ? (
                <div className="p-8 text-center text-gray-400">Loading...</div>
              ) : advances.length === 0 ? (
                <div className="p-10 text-center text-gray-400">
                  <div className="text-4xl mb-2">💳</div>
                  <p>No advance payments recorded yet</p>
                </div>
              ) : (
                <ListTable storageKey="accountsPayablesAdvancesTable" rows={advances}
                  columns={advanceColumns} getRowId={(r) => r.id}
                  defaultPageSize={25} pageSizeOptions={[10, 25, 50, 100]}
                  searchPlaceholder="Search vendor, PO, advance type…" exportFilename="vendor-advances.csv" />
              )}
            </div>
          </div>
        )}

      </div>

      {/* Vendor Invoices Modal */}
      {showDetailsModal && selectedVendor && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
          <div className="bg-white w-full h-full flex flex-col">
            <div className="p-5 border-b border-[#E8DCC4] bg-[#FAF9F6] flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selectedVendor.vendor_name}</h2>
                <p className="text-xs text-gray-500">{selectedVendor.vendor_code} · Outstanding: <strong className="text-orange-600">₹{fmtINR(selectedVendor.total_outstanding)}</strong></p>
              </div>
              <div className="flex items-center gap-3">
                {selectedGRNIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-1 rounded-full">{selectedGRNIds.size} selected</span>
                    <button onClick={printPaymentRequest}
                      className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold">
                      🖨 Print Payment Request
                    </button>
                  </div>
                )}
                <button onClick={() => setShowDetailsModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
              </div>
            </div>
            <div className="overflow-auto flex-1 p-5 bg-white">
              {loadingGRNs ? (
                <div className="p-8 text-center text-gray-500">Loading invoices…</div>
              ) : vendorGRNs.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No outstanding invoices found</div>
              ) : (
                <ListTable storageKey="accountsPayablesVendorInvoicesModalTable" rows={vendorGRNs}
                  columns={vendorInvoiceColumns} getRowId={(r) => r.id}
                  defaultPageSize={25} pageSizeOptions={[10, 25, 50, 100]}
                  searchPlaceholder="Search vendor invoices…"
                  selectable selectedRowIds={Array.from(selectedGRNIds)}
                  onSelectionChange={(ids) => setSelectedGRNIds(new Set(ids))} />
              )}
            </div>
            <div className="p-4 border-t border-[#E8DCC4] bg-[#FAF9F6] flex justify-between items-center">
              <div className="flex items-center gap-3">
                {selectedGRNIds.size > 0 ? (
                  <>
                    <span className="text-sm text-gray-600">{selectedGRNIds.size} invoice{selectedGRNIds.size > 1 ? 's' : ''} selected</span>
                    {canRecordPayment && (
                      <button onClick={openSettlementModal}
                        className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-semibold">
                        💳 Settle Selected
                      </button>
                    )}
                    <button onClick={printPaymentRequest}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-semibold">
                      🖨 Print Payment Request
                    </button>
                    <button onClick={() => setSelectedGRNIds(new Set())}
                      className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-600">
                      Clear
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">☑ Select invoices to settle or print a Payment Request</span>
                )}
              </div>
              <button onClick={() => setShowDetailsModal(false)} className="px-5 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* GRN / Invoice Detail + Payment History Modal */}
      {showGRNDetailModal && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
          <div className="bg-white w-full h-full flex flex-col">
            <div className="p-5 border-b border-[#E8DCC4] bg-[#FAF9F6] flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Invoice Payment History</h2>
                {selectedGRNDetail && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    GRN: <strong>{selectedGRNDetail.grn_number}</strong>
                    {selectedGRNDetail.invoice_number && <> · Invoice: <strong>{selectedGRNDetail.invoice_number}</strong></>}
                  </p>
                )}
              </div>
              <button onClick={() => setShowGRNDetailModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>

            <div className="overflow-auto flex-1 p-5 space-y-5 bg-white">
              {loadingGRNDetail ? (
                <div className="text-center text-gray-500 py-8">Loading…</div>
              ) : selectedGRNDetail ? (
                <>
                  {/* Amount breakdown */}
                  <div className={`grid gap-3 ${(selectedGRNDetail.computed_advance || 0) > 0 ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
                    {[
                      { label: 'Items (Gross)', val: selectedGRNDetail.gross_amount, cls: 'text-gray-800' },
                      { label: 'Net Payable', val: selectedGRNDetail.net_payable_amount, cls: 'font-bold text-gray-900' },
                      ((selectedGRNDetail.computed_advance || 0) > 0 && { label: 'Advance', val: selectedGRNDetail.computed_advance, cls: 'text-blue-600 font-semibold' }),
                      { label: 'Total Paid', val: selectedGRNDetail.computed_paid, cls: 'text-green-700 font-semibold' },
                      { label: 'Outstanding', val: selectedGRNDetail.outstanding_amount, cls: `font-bold ${selectedGRNDetail.outstanding_amount > 0 ? 'text-orange-600' : 'text-green-600'}` },
                    ].filter(Boolean).map(({ label, val, cls }: any) => (
                      <div key={label} className="bg-gray-50 rounded-lg p-3 border">
                        <div className="text-xs text-gray-500 mb-0.5">{label}</div>
                        <div className={`text-base ${cls}`}>₹{fmtINR(val)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-blue-700">Freight / Transportation Charges</div>
                        <div className="mt-0.5 text-[11px] text-blue-600">Invoice freight only. The original PO freight remains unchanged.</div>
                      </div>
                      {canAdjustFreight && selectedGRNDetail.outstanding_amount > 0.009 && (
                        <button
                          type="button"
                          onClick={() => openFreightAdjustmentModal(selectedGRNDetail)}
                          className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                        >
                          Update Freight
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Freight:</span>
                          <span className="ml-1 font-semibold text-gray-800">₹{fmtINR(selectedGRNDetail.freight_amount || 0)}</span>
                        </div>
                        {(selectedGRNDetail.freight_gst_amount || 0) > 0 && (
                          <div>
                            <span className="text-gray-500">Freight GST:</span>
                            <span className="ml-1 font-semibold text-gray-800">₹{fmtINR(selectedGRNDetail.freight_gst_amount || 0)}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">Total Freight:</span>
                          <span className="ml-1 font-bold text-blue-800">₹{fmtINR((selectedGRNDetail.freight_amount || 0) + (selectedGRNDetail.freight_gst_amount || 0))}</span>
                        </div>
                    </div>
                  </div>

                  {(selectedGRNDetail.freight_adjustments || []).length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-bold text-gray-700">
                        Freight Adjustment Trail ({selectedGRNDetail.freight_adjustments?.length || 0})
                      </h3>
                      <div className="overflow-x-auto rounded-lg border border-blue-100">
                        <table className="w-full text-sm">
                          <thead className="bg-blue-50">
                            <tr>
                              {['Updated On', 'Updated By', 'Freight', 'Freight GST', 'Net Payable', 'Reason'].map((heading) => (
                                <th key={heading} className="px-3 py-2 text-left text-xs font-semibold text-blue-800">{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-blue-100">
                            {(selectedGRNDetail.freight_adjustments || []).map((adjustment) => (
                              <tr key={adjustment.id} className="bg-white">
                                <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(adjustment.adjusted_at).toLocaleString('en-IN')}</td>
                                <td className="px-3 py-2 text-xs font-medium">{adjustment.adjusted_by_name}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs">₹{fmtINR(adjustment.old_freight_amount)} → ₹{fmtINR(adjustment.new_freight_amount)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs">₹{fmtINR(adjustment.old_freight_gst_amount)} → ₹{fmtINR(adjustment.new_freight_gst_amount)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs font-semibold">₹{fmtINR(adjustment.old_net_payable_amount)} → ₹{fmtINR(adjustment.new_net_payable_amount)}</td>
                                <td className="min-w-48 px-3 py-2 text-xs text-gray-600">{adjustment.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {(selectedGRNDetail.computed_tds > 0 || selectedGRNDetail.computed_short > 0) && (
                    <div className="flex gap-3">
                      {selectedGRNDetail.computed_tds > 0 && (
                        <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 flex-1">
                          <div className="text-xs text-sky-600">TDS Deducted</div>
                          <div className="font-semibold text-sky-800">₹{fmtINR(selectedGRNDetail.computed_tds)}</div>
                        </div>
                      )}
                      {selectedGRNDetail.computed_short > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex-1">
                          <div className="text-xs text-amber-600">Short Payment</div>
                          <div className="font-semibold text-amber-800">₹{fmtINR(selectedGRNDetail.computed_short)}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Payment history */}
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 mb-2">Payment History ({selectedGRNDetail.payment_entries.length})</h3>
                    {selectedGRNDetail.payment_entries.length === 0 ? (
                      <div className="text-sm text-gray-400 italic">No payments recorded yet</div>
                    ) : (
                      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                        <thead className="bg-gray-50">
                          <tr>
                            {['Date','Method','Ref','Amount','TDS','Short Pmt','Notes','Actions'].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {selectedGRNDetail.payment_entries.map((e) => (
                            <tr key={e.id} className={isSystemPaymentEntry(e) ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}>
                              <td className="px-3 py-2 whitespace-nowrap">{new Date(e.payment_date).toLocaleDateString('en-IN')}</td>
                              <td className="px-3 py-2">
                                {e.entry_type === 'ADVANCE' || e.entry_type === 'ADVANCE_APPLIED'
                                  ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">PO Advance</span>
                                  : e.entry_type === 'VENDOR_ADVANCE'
                                  ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-teal-100 text-teal-800">Vendor Advance</span>
                                  : e.payment_method}
                              </td>
                              <td className="px-3 py-2 text-gray-500 text-xs">{e.payment_reference || '—'}</td>
                              <td className="px-3 py-2 font-semibold text-green-700">₹{fmtINR(e.amount)}</td>
                              <td className="px-3 py-2 text-sky-700">{(e.tds_amount || 0) > 0 ? `₹${fmtINR(e.tds_amount)}` : '—'}</td>
                              <td className="px-3 py-2 text-amber-700">{(e.short_payment_amount || 0) > 0 ? `₹${fmtINR(e.short_payment_amount)}` : '—'}</td>
                              <td className="px-3 py-2 text-xs text-gray-500">{e.payment_notes || (e.short_payment_reason ? `Short: ${e.short_payment_reason}` : '—')}</td>
                              <td className="px-3 py-2">
                                {!isSystemPaymentEntry(e) && canRecordPayment && (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => openEditPayment(e)}
                                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                      title="Edit payment"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => openReversePaymentModal(e)}
                                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                                      title="Reverse payment"
                                    >
                                      Reverse
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {(selectedGRNDetail.payment_reversals || []).length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-gray-700 mb-2">
                        Reversal History ({selectedGRNDetail.payment_reversals?.length || 0})
                      </h3>
                      <table className="w-full text-sm border border-red-100 rounded-lg overflow-hidden">
                        <thead className="bg-red-50">
                          <tr>
                            {['Reversed On','Original Date','Method','Ref','Amount','Reason'].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-red-700">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-100">
                          {(selectedGRNDetail.payment_reversals || []).map((reversal) => (
                            <tr key={reversal.id} className="bg-white hover:bg-red-50">
                              <td className="px-3 py-2 whitespace-nowrap">
                                {new Date(reversal.reversed_at).toLocaleString('en-IN')}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {reversal.original_payment_date ? new Date(reversal.original_payment_date).toLocaleDateString('en-IN') : '—'}
                              </td>
                              <td className="px-3 py-2">{reversal.original_payment_method || '—'}</td>
                              <td className="px-3 py-2 text-gray-500 text-xs">{reversal.original_payment_reference || '—'}</td>
                              <td className="px-3 py-2 font-semibold text-red-700">
                                -₹{fmtINR(
                                  +(reversal.original_amount || 0) +
                                  +(reversal.original_tds_amount || 0) +
                                  +(reversal.original_short_payment_amount || 0)
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-600">{reversal.reversal_reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-gray-400">Could not load details</div>
              )}
            </div>

            <div className="p-4 border-t border-[#E8DCC4] bg-[#FAF9F6] flex justify-between items-center">
              {canRecordPayment && selectedGRNDetail && selectedGRNDetail.outstanding_amount > 0.009 ? (
                <button onClick={() => openPaymentModalFromDetail(selectedGRNDetail)}
                  className="px-5 py-2 bg-[#8B6F47] text-white rounded-md hover:bg-[#745A37] text-sm font-semibold">
                  + Record Payment
                </button>
              ) : <div />}
              <button onClick={() => setShowGRNDetailModal(false)} className="px-5 py-2 border border-[#D9C9AD] rounded-md hover:bg-white text-sm text-[#3F2D20]">Close</button>
            </div>
          </div>
        </div>
      )}

      {showFreightAdjustmentModal && selectedGRNDetail && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E8DCC4] bg-[#FAF9F6] p-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Accounts Payable Control</div>
                <h2 className="mt-1 text-lg font-bold text-gray-900">Update Invoice Freight</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {selectedGRNDetail.grn_number}
                  {selectedGRNDetail.invoice_number ? ` · Invoice ${selectedGRNDetail.invoice_number}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFreightAdjustmentModal(false)}
                disabled={freightAdjustmentSubmitting}
                className="text-2xl text-gray-400 hover:text-gray-700 disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                This updates the supplier invoice liability only. It does not modify the approved Purchase Order freight. No adjustment is allowed after a payment or settlement entry has been posted.
              </div>

              {freightAdjustmentError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{freightAdjustmentError}</div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-700">Revised Freight Amount (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={freightAdjustmentForm.freight_amount}
                    onChange={(event) => setFreightAdjustmentForm((form) => ({ ...form, freight_amount: event.target.value }))}
                    className="w-full rounded-md border border-[#D9C9AD] px-3 py-2 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                  <p className="mt-1 text-xs text-gray-500">Current: Rs. {fmtINR(selectedGRNDetail.freight_amount || 0)}</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-700">Revised Freight GST (Rs.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={freightAdjustmentForm.freight_gst_amount}
                    onChange={(event) => setFreightAdjustmentForm((form) => ({ ...form, freight_gst_amount: event.target.value }))}
                    className="w-full rounded-md border border-[#D9C9AD] px-3 py-2 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                  <p className="mt-1 text-xs text-gray-500">Current: Rs. {fmtINR(selectedGRNDetail.freight_gst_amount || 0)}</p>
                </div>
              </div>

              <div className="grid gap-3 rounded-md border border-[#E8DCC4] bg-[#FAF9F6] p-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-gray-500">Current Net Payable</div>
                  <div className="mt-1 font-semibold">Rs. {fmtINR(selectedGRNDetail.net_payable_amount)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Revised Freight Total</div>
                  <div className="mt-1 font-semibold text-blue-800">
                    Rs. {fmtINR((Number.parseFloat(freightAdjustmentForm.freight_amount) || 0) + (Number.parseFloat(freightAdjustmentForm.freight_gst_amount) || 0))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Revised Net Payable</div>
                  <div className="mt-1 font-bold text-[#8B4A00]">
                    Rs. {fmtINR(Math.round(
                      Number(selectedGRNDetail.gross_amount || 0)
                      + Number(selectedGRNDetail.tax_amount || 0)
                      + (Number.parseFloat(freightAdjustmentForm.freight_amount) || 0)
                      + (Number.parseFloat(freightAdjustmentForm.freight_gst_amount) || 0)
                      - Number(selectedGRNDetail.debit_note_amount || 0),
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">
                  Reason for Update <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={4}
                  value={freightAdjustmentForm.reason}
                  onChange={(event) => setFreightAdjustmentForm((form) => ({ ...form, reason: event.target.value }))}
                  placeholder="Example: Supplier invoice includes revised transport charge supported by invoice reference..."
                  className="w-full rounded-md border border-[#D9C9AD] px-3 py-2 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#E8DCC4]"
                />
                <p className="mt-1 text-xs text-gray-500">The reason, old and new values, user, and timestamp will be retained in the invoice trail.</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-[#E8DCC4] bg-[#FAF9F6] p-4">
              <button
                type="button"
                onClick={() => setShowFreightAdjustmentModal(false)}
                disabled={freightAdjustmentSubmitting}
                className="rounded-md border border-[#D9C9AD] px-4 py-2 text-sm font-semibold text-[#3F2D20] hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitFreightAdjustment}
                disabled={freightAdjustmentSubmitting}
                className="rounded-md bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#745A37] disabled:opacity-50"
              >
                {freightAdjustmentSubmitting ? 'Updating…' : 'Update Freight & Recalculate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Recording Modal */}
      {showPaymentModal && selectedGRNDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col">
            <div className="p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900">Record Payment</h2>
              <p className="text-xs text-gray-600 mt-1">
                {selectedGRNDetail.grn_number}
                {selectedGRNDetail.invoice_number && <> · Invoice <strong>{selectedGRNDetail.invoice_number}</strong></>}
                {' '}· Outstanding: <strong className="text-orange-600">₹{fmtINR(selectedGRNDetail.outstanding_amount)}</strong>
              </p>
            </div>

            <div className="overflow-auto flex-1 p-5 space-y-4">
              {paymentError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{paymentError}</div>
              )}

              {canAdjustFreight && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div>
                  <div className="text-xs font-semibold text-blue-800">Invoice Freight: Rs. {fmtINR((selectedGRNDetail.freight_amount || 0) + (selectedGRNDetail.freight_gst_amount || 0))}</div>
                  <div className="mt-0.5 text-[11px] text-blue-700">If the supplier invoice freight differs, update it before posting payment.</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPaymentModal(false);
                    openFreightAdjustmentModal(selectedGRNDetail);
                  }}
                  className="shrink-0 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                >
                  Update Freight
                </button>
              </div>
              )}

              {/* Advance Payment Info */}
              {(selectedGRNDetail.computed_advance || 0) > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-green-800 mb-1">Advance Payment Applied</div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Net Payable:</span>
                    <span className="font-medium">₹{fmtINR(selectedGRNDetail.net_payable_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-green-700">
                    <span>Less: Advance Paid:</span>
                    <span className="font-medium">-₹{fmtINR(selectedGRNDetail.computed_advance || 0)}</span>
                  </div>
                  <div className="border-t border-green-200 mt-1 pt-1 flex justify-between text-sm font-bold">
                    <span className="text-gray-800">Outstanding:</span>
                    <span className="text-orange-600">₹{fmtINR(selectedGRNDetail.outstanding_amount)}</span>
                  </div>
                </div>
              )}

              {getAvailableAdvance(selectedGRNDetail) > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                  <div className="text-xs font-semibold text-green-800">Supplier Advance Available</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-white border border-green-100 px-3 py-2">
                      <div className="text-xs text-gray-500">PO advance</div>
                      <div className="font-semibold text-green-800">Rs. {fmtINR(selectedGRNDetail.available_po_advance || 0)}</div>
                    </div>
                    <div className="rounded-md bg-white border border-green-100 px-3 py-2">
                      <div className="text-xs text-gray-500">Vendor advance</div>
                      <div className="font-semibold text-green-800">Rs. {fmtINR(selectedGRNDetail.available_vendor_advance || 0)}</div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Advance to Adjust</label>
                    <input type="number" step="0.01" min="0" max={Math.min(getAvailableAdvance(selectedGRNDetail), selectedGRNDetail.outstanding_amount)}
                      value={paymentForm.advance_adjustment_amount}
                      onChange={(e) => updatePaymentBalance({ advance_adjustment_amount: e.target.value })}
                      onBlur={clampAdvanceAdjustment}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg text-sm focus:ring-2 focus:ring-green-400"
                      placeholder="0.00" />
                    <p className="text-xs text-gray-500 mt-1">Advance is applied only when you enter an adjustment amount here.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Amount <span className="text-red-500">*</span></label>
                  <input type="number" step="0.01" max={selectedGRNDetail.outstanding_amount}
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400"
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Method <span className="text-red-500">*</span></label>
                  <select value={paymentForm.payment_method}
                    onChange={(e) => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400">
                    {['NEFT','RTGS','UPI','CHEQUE','CASH','IMPS','OTHER'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Reference</label>
                  <input type="text" value={paymentForm.payment_reference}
                    onChange={(e) => setPaymentForm(f => ({ ...f, payment_reference: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Transaction ID / Cheque No." />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
                  <DateInput max={todayDate} value={paymentForm.payment_date}
                    onChange={(value) => setPaymentForm(f => ({ ...f, payment_date: value }))}
                    className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm" />
                </div>
              </div>

              {/* TDS and Short Payment */}
              <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 space-y-3">
                <div className="text-xs font-bold text-blue-800 uppercase tracking-wide">Deductions (TDS / Short Payment)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-blue-700 mb-1">TDS Amount</label>
                    <input type="number" step="0.01" min="0" value={paymentForm.tds_amount}
                      onChange={(e) => updatePaymentBalance({ tds_amount: e.target.value })}
                      className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm"
                      placeholder="0.00" />
                    <p className="text-xs text-blue-500 mt-0.5">Tax deducted at source</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-amber-700 mb-1">Short Payment</label>
                    <input type="number" step="0.01" min="0" value={paymentForm.short_payment_amount}
                      onChange={(e) => updatePaymentBalance({ short_payment_amount: e.target.value })}
                      className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm"
                      placeholder="0.00" />
                    <p className="text-xs text-amber-500 mt-0.5">Amount deducted for other reason</p>
                  </div>
                </div>
                {(parseFloat(paymentForm.short_payment_amount || '0') > 0) && (
                  <div>
                    <label className="block text-xs font-semibold text-amber-700 mb-1">Short Payment Reason</label>
                    <input type="text" value={paymentForm.short_payment_reason}
                      onChange={(e) => setPaymentForm(f => ({ ...f, short_payment_reason: e.target.value }))}
                      className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm"
                      placeholder="Reason for short payment" />
                  </div>
                )}
                {/* Settlement preview */}
                {(() => {
                  const aPaisa = toPaisa(paymentForm.amount);
                  const advPaisa = toPaisa(paymentForm.advance_adjustment_amount);
                  const tPaisa = toPaisa(paymentForm.tds_amount);
                  const sPaisa = toPaisa(paymentForm.short_payment_amount);
                  const totalPaisa = aPaisa + advPaisa + tPaisa + sPaisa;
                  const remPaisa = Math.max(0, toPaisa(selectedGRNDetail.outstanding_amount) - totalPaisa);
                  const a = fromPaisa(aPaisa);
                  const adv = fromPaisa(advPaisa);
                  const t = fromPaisa(tPaisa);
                  const s = fromPaisa(sPaisa);
                  const total = fromPaisa(totalPaisa);
                  const rem = fromPaisa(remPaisa);
                  return total > 0 ? (
                    <div className="text-xs text-gray-700 bg-white rounded border border-gray-200 p-2">
                      <span className="font-semibold">Settlement preview:</span> Cash Rs. {fmtINR(a)} + Advance Rs. {fmtINR(adv)} + TDS Rs. {fmtINR(t)} + Short Rs. {fmtINR(s)} = <strong>Rs. {fmtINR(total)}</strong> - Remaining: <strong className={remPaisa > 0 ? 'text-orange-600' : 'text-green-600'}>Rs. {fmtINR(rem)}</strong>
                    </div>
                  ) : null;
                })()}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Accounts Intimation Note / Payment Remarks</label>
                <textarea value={paymentForm.payment_notes}
                  onChange={(e) => setPaymentForm(f => ({ ...f, payment_notes: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g. informed accounts to release NEFT, hold due to invoice mismatch, advance adjusted, TDS note..." />
                <p className="mt-1 text-xs text-gray-500">
                  This note is stored in the payment trail and visible later from invoice history / PO trail.
                </p>
              </div>

              {/* Close Invoice toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={paymentForm.close_invoice}
                  onChange={(e) => setPaymentForm(f => ({ ...f, close_invoice: e.target.checked }))}
                  className="w-4 h-4 accent-orange-600" />
                <span className="text-sm font-medium text-gray-700">Mark invoice as fully paid / closed after this entry</span>
              </label>
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowPaymentModal(false)} disabled={submitting}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={recordPayment} disabled={submitting || !canRecordPayment}
                className="px-5 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-60">
                {submitting ? 'Saving…' : '💳 Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Payment Modal */}
      {showEditPaymentModal && selectedGRNDetail && editingPayment && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col">
            <div className="p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900">Edit Payment</h2>
              <p className="text-xs text-gray-600 mt-1">
                {selectedGRNDetail.grn_number}
                {selectedGRNDetail.invoice_number && <> · Invoice <strong>{selectedGRNDetail.invoice_number}</strong></>}
              </p>
            </div>

            <div className="overflow-auto flex-1 p-5 space-y-4">
              {editPaymentError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{editPaymentError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Amount <span className="text-red-500">*</span></label>
                  <input type="number" step="0.01"
                    value={editPaymentForm.amount}
                    onChange={(e) => setEditPaymentForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400"
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Method <span className="text-red-500">*</span></label>
                  <select value={editPaymentForm.payment_method}
                    onChange={(e) => setEditPaymentForm(f => ({ ...f, payment_method: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="IMPS">IMPS</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Reference</label>
                  <input type="text" value={editPaymentForm.payment_reference}
                    onChange={(e) => setEditPaymentForm(f => ({ ...f, payment_reference: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="UTR / Cheque No / Ref" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
                  <DateInput max={todayDate} value={editPaymentForm.payment_date}
                    onChange={(value) => setEditPaymentForm(f => ({ ...f, payment_date: value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-sky-700 mb-1">TDS Deducted</label>
                  <input type="number" step="0.01" min={0}
                    value={editPaymentForm.tds_amount}
                    onChange={(e) => setEditPaymentForm(f => ({ ...f, tds_amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-sky-200 rounded-lg text-sm"
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-amber-700 mb-1">Short Payment</label>
                  <input type="number" step="0.01" min={0}
                    value={editPaymentForm.short_payment_amount}
                    onChange={(e) => setEditPaymentForm(f => ({ ...f, short_payment_amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm"
                    placeholder="0.00" />
                  <p className="text-xs text-amber-500 mt-0.5">Amount deducted for other reason</p>
                </div>
              </div>
              {(parseFloat(editPaymentForm.short_payment_amount || '0') > 0) && (
                <div>
                  <label className="block text-xs font-semibold text-amber-700 mb-1">Short Payment Reason</label>
                  <input type="text" value={editPaymentForm.short_payment_reason}
                    onChange={(e) => setEditPaymentForm(f => ({ ...f, short_payment_reason: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm"
                    placeholder="Reason for short payment" />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Accounts Intimation Note / Payment Remarks</label>
                <textarea value={editPaymentForm.payment_notes}
                  onChange={(e) => setEditPaymentForm(f => ({ ...f, payment_notes: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="Update the payment trail note / accounts intimation" />
              </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowEditPaymentModal(false)} disabled={editingSubmitting}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleUpdatePayment} disabled={editingSubmitting || !canRecordPayment}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">
                {editingSubmitting ? 'Saving…' : '💾 Update Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Notice Modal */}
      {pageNotice && (
        <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[90] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-[#E8DCC4]">
            <div className="p-5 border-b">
              <p className={`text-xs font-semibold uppercase tracking-wide ${
                pageNotice.type === 'error' ? 'text-red-700' :
                pageNotice.type === 'warning' ? 'text-amber-700' :
                'text-blue-700'
              }`}>
                {pageNotice.type === 'error' ? 'Action blocked' : pageNotice.type === 'warning' ? 'Attention required' : 'Information'}
              </p>
              <h2 className="mt-1 text-lg font-bold text-gray-900">{pageNotice.title}</h2>
            </div>
            <div className="p-5 text-sm leading-6 text-gray-700 whitespace-pre-line">
              {pageNotice.message}
            </div>
            <div className="p-4 border-t flex justify-end">
              <button
                onClick={() => setPageNotice(null)}
                className="px-5 py-2 bg-[#8B6F47] text-white rounded-lg text-sm font-semibold hover:bg-[#6F4E37]"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Reversal Modal */}
      {reversePaymentTarget && selectedGRNDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[75] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
            <div className="p-5 border-b flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Payment reversal</p>
                <h2 className="mt-1 text-lg font-bold text-gray-900">Reverse payment entry</h2>
                <p className="mt-1 text-xs text-gray-600">
                  {selectedGRNDetail.grn_number}
                  {selectedGRNDetail.invoice_number ? <> - Invoice <strong>{selectedGRNDetail.invoice_number}</strong></> : null}
                </p>
              </div>
              <button
                onClick={() => {
                  setReversePaymentTarget(null);
                  setReversePaymentReason('');
                  setReversePaymentError(null);
                }}
                disabled={reversePaymentSubmitting}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                aria-label="Close payment reversal"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
                <div className="font-semibold">Audit control</div>
                <div className="mt-1">
                  This will reverse Rs. {fmtINR(reversePaymentTarget.amount)} from the payment trail and recalculate outstanding/advance balances.
                </div>
              </div>

              {reversePaymentError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {reversePaymentError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Reversal reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reversePaymentReason}
                  onChange={(event) => setReversePaymentReason(event.target.value)}
                  rows={4}
                  autoFocus
                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400"
                  placeholder="Example: wrong supplier, duplicate payment, incorrect amount, bank transaction failed..."
                />
              </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setReversePaymentTarget(null);
                  setReversePaymentReason('');
                  setReversePaymentError(null);
                }}
                disabled={reversePaymentSubmitting}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleReversePayment}
                disabled={reversePaymentSubmitting || !reversePaymentReason.trim()}
                className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {reversePaymentSubmitting ? 'Reversing...' : 'Reverse Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Settlement Modal */}
      {showSettlementModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Settle Selected Invoices</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedGRNIds.size} invoice{selectedGRNIds.size !== 1 ? 's' : ''} · Vendor: {selectedVendor?.vendor_name}
                </p>
              </div>
              <button onClick={() => { setShowSettlementModal(false); setSettlementResult(null); }} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>

            <div className="overflow-auto flex-1 p-5 space-y-4">
              {/* Selected invoices summary */}
              <div className="bg-amber-50 rounded-lg border border-amber-200 p-3">
                <div className="text-xs font-bold text-amber-800 mb-2 uppercase tracking-wide">Invoices to Settle</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {vendorGRNs.filter(g => selectedGRNIds.has(g.id)).map(g => {
                    const out = getPayableOutstanding(g);
                    return (
                      <div key={g.id} className="flex justify-between text-xs text-amber-900">
                        <span>{g.grn_number}{g.invoice_number ? ` · ${g.invoice_number}` : ''}</span>
                        <span className="font-semibold">₹{fmtINR(out)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-amber-300 mt-2 pt-2 flex justify-between text-sm font-bold text-amber-900">
                  <span>Total Outstanding</span>
                  <span>₹{fmtINR(vendorGRNs.filter(g => selectedGRNIds.has(g.id)).reduce((s, g) => {
                    return s + getPayableOutstanding(g);
                  }, 0))}</span>
                </div>
              </div>

              {settlementError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{settlementError}</div>
              )}

              {settlementResult ? (
                <div className="space-y-2">
                  <div className={`rounded-lg px-4 py-3 text-sm font-semibold ${settlementResult.failed === 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                    {settlementResult.settled} invoice{settlementResult.settled !== 1 ? 's' : ''} settled{settlementResult.failed > 0 ? `, ${settlementResult.failed} failed` : ' successfully'}.
                  </div>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-1 max-h-40 overflow-y-auto">
                    {settlementResult.messages.map((m, i) => (
                      <div key={i} className="text-xs text-gray-700">{m}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Total Payment Amount <span className="text-red-500">*</span></label>
                      <input type="number" step="0.01" min="0.01"
                        value={settlementForm.amount}
                        onChange={(e) => setSettlementForm(f => ({ ...f, amount: e.target.value }))}
                        className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400"
                        placeholder="0.00" />
                      <p className="text-xs text-gray-400 mt-0.5">Will be split proportionally</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Method <span className="text-red-500">*</span></label>
                      <select value={settlementForm.payment_method}
                        onChange={(e) => setSettlementForm(f => ({ ...f, payment_method: e.target.value }))}
                        className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm">
                        {['NEFT','RTGS','UPI','CHEQUE','CASH','IMPS','OTHER'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Reference</label>
                      <input type="text" value={settlementForm.payment_reference}
                        onChange={(e) => setSettlementForm(f => ({ ...f, payment_reference: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="Transaction ID / Cheque No." />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
                      <DateInput max={todayDate} value={settlementForm.payment_date}
                        onChange={(value) => setSettlementForm(f => ({ ...f, payment_date: value }))}
                        className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-sky-700 mb-1">TDS Amount (total)</label>
                      <input type="number" step="0.01" min="0" value={settlementForm.tds_amount}
                        onChange={(e) => setSettlementForm(f => ({ ...f, tds_amount: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-amber-700 mb-1">Short Payment (total)</label>
                      <input type="number" step="0.01" min="0" value={settlementForm.short_payment_amount}
                        onChange={(e) => setSettlementForm(f => ({ ...f, short_payment_amount: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="0.00" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Accounts Intimation Note / Payment Remarks</label>
                    <textarea rows={2} value={settlementForm.payment_notes}
                      onChange={(e) => setSettlementForm(f => ({ ...f, payment_notes: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="Settlement reference, bank transfer details, or intimation note copied to selected payments..." />
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => { setShowSettlementModal(false); setSettlementResult(null); }}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                {settlementResult ? 'Close' : 'Cancel'}
              </button>
              {!settlementResult && (
                <button onClick={submitSettlement} disabled={settlementSubmitting}
                  className="px-5 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-60">
                  {settlementSubmitting ? 'Processing…' : `💳 Settle ${selectedGRNIds.size} Invoice${selectedGRNIds.size !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Advance payment audit detail */}
      {showAdvanceDetailModal && selectedAdvance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="advance-detail-title">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#E8DCC4] bg-white p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Advance payment</p>
                <h2 id="advance-detail-title" className="text-xl font-bold text-[#3F2D20]">
                  {selectedAdvance.advance_type === 'PO' ? 'Purchase Order Advance Details' : 'Blanket Vendor Advance Details'}
                </h2>
              </div>
              <button type="button" onClick={() => setShowAdvanceDetailModal(false)} aria-label="Close advance details" className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Advance paid', value: `₹${fmtINR(selectedAdvance.amount || 0)}`, tone: 'text-[#3F2D20]' },
                  { label: 'Applied to invoices', value: `₹${fmtINR(selectedAdvance.utilized_amount || 0)}`, tone: 'text-amber-700' },
                  { label: 'Available balance', value: `₹${fmtINR(selectedAdvance.balance_amount || 0)}`, tone: 'text-green-700' },
                ].map((summary) => (
                  <div key={summary.label} className="rounded-lg border border-[#E8DCC4] bg-[#FAF9F6] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#7A6756]">{summary.label}</p>
                    <p className={`mt-1 text-lg font-bold ${summary.tone}`}>{summary.value}</p>
                  </div>
                ))}
              </div>

              <section className="overflow-hidden rounded-lg border border-[#E8DCC4]">
                <div className="border-b border-[#E8DCC4] bg-[#FAF9F6] px-4 py-3 text-sm font-semibold text-[#3F2D20]">Payment information</div>
                <dl className="grid grid-cols-1 divide-y divide-[#F0E8DA] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                  <div className="p-4"><dt className="text-xs font-semibold uppercase text-[#7A6756]">Vendor</dt><dd className="mt-1 font-medium">{selectedAdvance.vendor?.name || '—'} {selectedAdvance.vendor?.code ? `(${selectedAdvance.vendor.code})` : ''}</dd></div>
                  <div className="p-4"><dt className="text-xs font-semibold uppercase text-[#7A6756]">Advance type</dt><dd className="mt-1 font-medium">{selectedAdvance.advance_type === 'PO' ? 'PO-specific advance' : 'Blanket vendor advance'}</dd></div>
                  <div className="p-4"><dt className="text-xs font-semibold uppercase text-[#7A6756]">Payment date</dt><dd className="mt-1 font-medium">{selectedAdvance.payment_date ? new Date(selectedAdvance.payment_date).toLocaleDateString('en-IN') : '—'}</dd></div>
                  <div className="p-4"><dt className="text-xs font-semibold uppercase text-[#7A6756]">Method / reference</dt><dd className="mt-1 font-medium">{selectedAdvance.payment_method || '—'}{selectedAdvance.payment_reference ? ` · ${selectedAdvance.payment_reference}` : ''}</dd></div>
                </dl>
              </section>

              <section className="overflow-hidden rounded-lg border border-[#E8DCC4]">
                <div className="border-b border-[#E8DCC4] bg-[#FAF9F6] px-4 py-3 text-sm font-semibold text-[#3F2D20]">Related documents</div>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[#7A6756]">Purchase Order</span>
                    {selectedAdvance.purchase_order?.id ? (
                      <a href={`/dashboard/purchase/orders?viewId=${selectedAdvance.purchase_order.id}`} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">{selectedAdvance.purchase_order.po_number || 'Open PO'}</a>
                    ) : <span className="font-medium">Not applicable — blanket advance</span>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[#7A6756]">Invoice / GRN currently linked</span>
                    {selectedAdvance.utilized_grn?.id ? (
                      <a href={`/dashboard/purchase/grn?viewId=${selectedAdvance.utilized_grn.id}`} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">{selectedAdvance.utilized_grn.grn_number || 'Open GRN'}</a>
                    ) : <span className="font-medium">No linked GRN recorded yet</span>}
                  </div>
                </div>
              </section>

              {selectedAdvance.payment_notes && (
                <section className="rounded-lg border border-[#E8DCC4] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7A6756]">Payment notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[#3F2D20]">{selectedAdvance.payment_notes}</p>
                </section>
              )}
            </div>
            <div className="sticky bottom-0 flex justify-end border-t border-[#E8DCC4] bg-white p-4">
              <button type="button" onClick={() => setShowAdvanceDetailModal(false)} className="rounded-lg border border-[#D8C8AA] px-5 py-2 text-sm font-semibold text-[#5E4635] hover:bg-[#F7F0E4]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Advance Payment Modal */}
      {showAdvanceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full">
            <div className="p-5 border-b flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Record Advance Payment</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {advanceForm.advance_type === 'PO' 
                    ? 'Payment against a specific Purchase Order' 
                    : 'General advance payment to vendor'}
                </p>
              </div>
              <button onClick={() => setShowAdvanceModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              {advanceError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{advanceError}</div>
              )}
              
              {/* Advance Type Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Advance Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setAdvanceForm(f => ({ ...f, advance_type: 'PO', vendor_id: '', po_id: '' })); setPoSearch(''); setPoDropdownOpen(false); }}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      advanceForm.advance_type === 'PO'
                        ? 'bg-blue-100 text-blue-800 border-2 border-blue-500'
                        : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                    }`}
                  >
                    📋 PO Advance
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAdvanceForm(f => ({ ...f, advance_type: 'BLANKET', po_id: '' })); setPoSearch(''); setPoDropdownOpen(false); }}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      advanceForm.advance_type === 'BLANKET'
                        ? 'bg-teal-100 text-teal-800 border-2 border-teal-500'
                        : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                    }`}
                  >
                    🏢 Blanket Advance
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {advanceForm.advance_type === 'PO' 
                    ? 'Linked to a specific Purchase Order' 
                    : 'General advance not linked to any PO'}
                </p>
              </div>

              {/* Conditional: PO Selection for PO advances */}
              {advanceForm.advance_type === 'PO' && (
                <div className="relative" ref={poSearchRef}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Purchase Order *</label>
                  <input
                    type="text"
                    value={poDropdownOpen ? poSearch : selectedPODisplay}
                    onChange={(e) => { setPoSearch(e.target.value); setPoDropdownOpen(true); }}
                    onFocus={() => { setPoSearch(''); setPoDropdownOpen(true); }}
                    onBlur={() => setTimeout(() => setPoDropdownOpen(false), 150)}
                    placeholder="Search PO number or vendor..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {poDropdownOpen && (
                    <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-300 rounded-lg shadow-lg">
                      {filteredPOs.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">No POs found</div>
                      ) : (
                        filteredPOs.map((po: any) => (
                          <div
                            key={po.id}
                            onMouseDown={(e) => { e.preventDefault(); setAdvanceForm(f => ({ ...f, po_id: po.id })); setPoSearch(''); setPoDropdownOpen(false); }}
                            className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${advanceForm.po_id === po.id ? 'bg-blue-100' : ''}`}
                          >
                            <div className="font-medium">{po.po_number}</div>
                            <div className="text-xs text-gray-500">{po.vendor?.name || po.vendor_name || ''}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Conditional: Vendor Selection for Blanket advances */}
              {advanceForm.advance_type === 'BLANKET' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Vendor *</label>
                  <select value={advanceForm.vendor_id} onChange={(e) => setAdvanceForm(f => ({ ...f, vendor_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— Select Vendor —</option>
                    {advanceVendors.map((v: any) => (
                      <option key={v.id} value={v.id}>{v.name} · {v.code || ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount (₹) *</label>
                  <input type="number" min="0.01" step="0.01" value={advanceForm.amount}
                    onChange={(e) => setAdvanceForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Date *</label>
                  <DateInput max={todayDate} value={advanceForm.payment_date}
                    onChange={(value) => setAdvanceForm(f => ({ ...f, payment_date: value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Method</label>
                  <select value={advanceForm.payment_method} onChange={(e) => setAdvanceForm(f => ({ ...f, payment_method: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {['NEFT','RTGS','IMPS','CHEQUE','CASH','UPI','DD'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Reference / UTR</label>
                  <input type="text" value={advanceForm.payment_reference}
                    onChange={(e) => setAdvanceForm(f => ({ ...f, payment_reference: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="UTR / Cheque No." />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                <textarea value={advanceForm.payment_notes} rows={2}
                  onChange={(e) => setAdvanceForm(f => ({ ...f, payment_notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional notes..." />
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowAdvanceModal(false)} disabled={submittingAdvance}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={submitAdvancePayment} disabled={submittingAdvance}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                {submittingAdvance ? 'Saving…' : '💳 Record Advance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
