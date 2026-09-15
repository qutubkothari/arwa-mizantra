'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { apiClient } from '../../../../../lib/api-client';
import { confirmDialog } from '../../../../components/ui/ConfirmDialog';
import { getTodayDateInputValue } from '@/lib/date';
import { buildDocumentBranding, renderStandardLetterheadHtml } from '@/lib/document-branding';
import { hasModulePermission, hasScreenPermission, readStoredUser } from '@/lib/rbac';
import SearchableSelect from '../../../../components/SearchableSelect';
import DateInput from '../../../../components/ui/DateInput';
import { ErpButton, ErpMetricStrip, ErpPageHeader, ErpStatusBadge } from '../../../../components/ui/ErpPrimitives';
import { Check, ClipboardCheck, GitBranch, History, PackageCheck, Plus, Printer, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';

const AUTO_REFRESH_MS = 30000;
const SRV_VIEW_STORAGE_KEY = 'sak-erp:srv-active-view';

function getApiV1BaseUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  if (!raw) return null;
  const normalized = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  return normalized.endsWith('/api/v1') ? normalized : `${normalized}/api/v1`;
}

type ReceiptVoucherRow = {
  id: string;
  entry_id?: string | null;
  job_order_id?: string;
  job_order_number?: string;
  item_id?: string;
  item_code?: string;
  item_name?: string;
  uid?: string;
  quantity?: number;
  to_warehouse_id?: string;
  movement_date?: string;
  received_by?: string;
  received_by_name?: string;
  received_by_phone?: string;
  approved_by?: string;
  approved_at?: string;
  notes?: string;
};
type User = {
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
};

type Warehouse = {
  id: string;
  code?: string;
  name?: string;
};

type QcApproveResponse = {
  jobOrderId?: string;
  jobOrderNumber?: string;
  itemCode?: string;
  itemName?: string;
  stockAdded?: number;
  stockAvailable?: number;
  generatedUids?: string[];
  message?: string;
};

type GeneratedUidPrintPayload = {
  jobOrderNumber: string;
  itemCode: string;
  itemName: string;
  generatedUids: string[];
  qcDate: string;
  qcBy: string;
};

function escapePrintHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getSrvRowIdentity(row: ReceiptVoucherRow | null | undefined): string {
  if (!row) return '';
  return String(row.entry_id || row.id || '').trim();
}

export default function SrvPage() {
  const [currentUser, setCurrentUser] = useState<ReturnType<typeof readStoredUser>>(null);
  const canCreate = hasModulePermission(currentUser, 'Inventory', 'create');
  const canApprove = hasModulePermission(currentUser, 'Inventory', 'approve');
  const canDelete = hasModulePermission(currentUser, 'Inventory', 'delete');
  const todayDate = getTodayDateInputValue();
  const [loading, setLoading] = useState(false);
  const [openSrvs, setOpenSrvs] = useState<ReceiptVoucherRow[]>([]);
  const [srvHistory, setSrvHistory] = useState<ReceiptVoucherRow[]>([]);
  const [activeSrvView, setActiveSrvView] = useState<'open' | 'history'>('open');
  const [bulkApproving, setBulkApproving] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [qcSummary, setQcSummary] = useState<any | null>(null);
  const [qcSummaryLoading, setQcSummaryLoading] = useState(false);

  // Manual SRV creation
  const [showManualSrvModal, setShowManualSrvModal] = useState(false);
  const [manualSrvItems, setManualSrvItems] = useState<Array<{id: string; code: string; name: string}>>([]);
  const [manualSrvForm, setManualSrvForm] = useState({ itemId: '', quantity: '', warehouseId: '', receiverName: '', receiverPhone: '', notes: '', movementDate: '' });
  const [manualSrvSaving, setManualSrvSaving] = useState(false);
  const [manualSrvAlert, setManualSrvAlert] = useState<{type: 'error'|'success'; message: string} | null>(null);

  const switchSrvView = useCallback((view: 'open' | 'history') => {
    setActiveSrvView(view);
    try {
      window.localStorage.setItem(SRV_VIEW_STORAGE_KEY, view);
    } catch {
      // Ignore storage restrictions; in-memory state remains active.
    }
  }, []);

  useEffect(() => {
    setCurrentUser(readStoredUser());
  }, []);

  // View SRV Details (GRN-like)
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedRow, setSelectedRow] = useState<ReceiptVoucherRow | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [receivedQty, setReceivedQty] = useState<number>(0);

  // QC Accept (GRN-like)
  const [showQcModal, setShowQcModal] = useState(false);
  const [qcFormData, setQcFormData] = useState<Array<{
    itemId: string;
    itemCode: string;
    itemName: string;
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
  }>>([]);
  const [qcMetadata, setQcMetadata] = useState<{ invoiceNumber: string; qcDate: string; qcBy: string }>({
    invoiceNumber: '',
    qcDate: getTodayDateInputValue(),
    qcBy: '',
  });

  const normalizeEmail = useCallback((value: unknown) => String(value || '').trim().toLowerCase(), []);
  const normalizeName = useCallback(
    (value: unknown) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    [],
  );

  const hasQualityInspectionAccess = useCallback((user: User) => {
    const actions: Array<'view' | 'create' | 'edit' | 'delete' | 'approve'> = ['view', 'create', 'edit', 'delete', 'approve'];
    return actions.some(
      (action) =>
        hasModulePermission(user as any, 'Quality Control', action) ||
        hasScreenPermission(user as any, '/dashboard/quality', action),
    );
  }, []);

  const loadAll = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [open, hist] = await Promise.all([
        apiClient.get<ReceiptVoucherRow[]>('/job-orders/store/receipt-vouchers/open'),
        apiClient.get<ReceiptVoucherRow[]>('/job-orders/store/receipt-vouchers/history'),
      ]);
      setOpenSrvs(open || []);
      setSrvHistory(hist || []);
    } catch (err: any) {
      if (!options?.silent) {
        await confirmDialog({
          title: 'SRV Data Not Loaded',
          message: 'Failed to load SRV data: ' + (err?.message || err),
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'danger',
        });
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SRV_VIEW_STORAGE_KEY);
      if (stored === 'open' || stored === 'history') {
        setActiveSrvView(stored);
      }
    } catch {
      // Ignore storage restrictions.
    }
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadAll({ silent: true });
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadAll]);

  const fetchUsers = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const [employeesResponse, usersResponse] = await Promise.all([
        fetch('/api/v1/hr/employees', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
        fetch('/api/v1/users', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      ]);

      if (!employeesResponse.ok || !usersResponse.ok) {
        setUsers([]);
        return;
      }

      const [employeesData, usersData] = await Promise.all([employeesResponse.json(), usersResponse.json()]);
      const employees = Array.isArray(employeesData) ? (employeesData as User[]) : [];
      const usersWithQualityAccess = Array.isArray(usersData)
        ? (usersData as User[]).filter(hasQualityInspectionAccess)
        : [];
      const allowedEmails = new Set(
        usersWithQualityAccess.map((user) => normalizeEmail(user.email)).filter(Boolean),
      );
      const allowedNames = new Set(
        usersWithQualityAccess
          .map((user) => normalizeName([user.first_name, user.last_name].filter(Boolean).join(' ')))
          .filter(Boolean),
      );

      setUsers(
        employees.filter((employee) => {
          const email = normalizeEmail(employee.email);
          const name = normalizeName(employee.employee_name);
          return (email && allowedEmails.has(email)) || (name && allowedNames.has(name));
        }),
      );
    } catch {
      setUsers([]);
    }
  }, [hasQualityInspectionAccess, normalizeEmail, normalizeName]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const fetchWarehouses = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('/api/v1/inventory/warehouses', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        setWarehouses([]);
        return;
      }

      const data = await response.json();
      setWarehouses(Array.isArray(data) ? data : []);
    } catch {
      setWarehouses([]);
    }
  }, []);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  const resolveWarehouseLabel = useCallback(
    (warehouseId?: string | null) => {
      const id = String(warehouseId || '').trim();
      if (!id) return '-';

      const wh = warehouses.find((w) => String(w?.id || '').trim() === id);
      if (!wh) return id;

      const code = String(wh.code || '').trim();
      const name = String(wh.name || '').trim();

      if (code && name) return `${code} - ${name}`;
      return name || code || id;
    },
    [warehouses],
  );

  const resolveEmployeeLabel = useCallback(
    (value?: string | null) => {
      const raw = String(value || '').trim();
      if (!raw) return '-';

      if (!isUuidLike(raw)) return raw;

      const user = users.find((u) => String(u?.id || '').trim() === raw);
      if (!user) return '-';

      const code = String(user.employee_code || '').trim();
      return `${user.employee_name}${code ? ` (${code})` : ''}`;
    },
    [users],
  );

  const fetchQcSummary = useCallback(async (jobOrderId: string) => {
    const id = String(jobOrderId || '').trim();
    if (!id) {
      setQcSummary(null);
      return;
    }
    setQcSummaryLoading(true);
    try {
      const summary = await apiClient.get(`/job-orders/${id}/qc-summary`);
      setQcSummary(summary || null);
    } catch {
      setQcSummary(null);
    } finally {
      setQcSummaryLoading(false);
    }
  }, []);

  const handleViewInvoice = useCallback((invoiceFileUrl: string, invoiceFileName?: string) => {
    if (!invoiceFileUrl) return;

    if (invoiceFileUrl.startsWith('data:')) {
      const base64Data = invoiceFileUrl.split(',')[1];
      const mimeType = invoiceFileUrl.split(':')[1].split(';')[0];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const newWindow = window.open(url, '_blank');
      if (newWindow) {
        newWindow.onload = () => {
          URL.revokeObjectURL(url);
        };
      }
      return;
    }

    window.open(invoiceFileUrl, '_blank');
  }, []);

  const handleQCFileSelect = useCallback(
    async (file: File, index: number) => {
      const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
      if (!validTypes.includes(file.type)) {
        await confirmDialog({
          title: 'Invalid QC File',
          message: 'Please upload PNG, JPG, or PDF files only.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'warning',
        });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        await confirmDialog({
          title: 'QC File Too Large',
          message: 'File size must be less than 10MB.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'warning',
        });
        return;
      }

      try {
        const token = localStorage.getItem('accessToken');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('bucket', 'qc');
        fd.append('folder', 'srv-qc');

        const apiBase = getApiV1BaseUrl();
        const uploadUrl = apiBase ? `${apiBase}/upload` : '/api/v1/upload';

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          await confirmDialog({
            title: 'QC Upload Failed',
            message: `QC upload failed: ${errorData.message || response.statusText}`,
            confirmLabel: 'OK',
            cancelLabel: 'Close',
            variant: 'danger',
          });
          return;
        }

        const data = await response.json();
        const url = String(data?.url || '').trim();
        if (!url) {
          await confirmDialog({
            title: 'QC Upload Failed',
            message: 'QC upload failed: no URL returned.',
            confirmLabel: 'OK',
            cancelLabel: 'Close',
            variant: 'danger',
          });
          return;
        }

        const newFile = {
          url: url,
          name: String(file.name),
          type: String(file.type),
          size: Number(file.size) || 0,
        };

        setQcFormData((prev) => {
          const next = [...prev];
          const existingFiles = next[index].qcFiles || [];
          next[index] = {
            ...next[index],
            qcFiles: [...existingFiles, newFile],
            // Update legacy fields to point to first file for backward compatibility
            qcFileUrl: existingFiles.length === 0 ? url : next[index].qcFileUrl,
            qcFileName: existingFiles.length === 0 ? newFile.name : next[index].qcFileName,
            qcFileType: existingFiles.length === 0 ? newFile.type : next[index].qcFileType,
            qcFileSize: existingFiles.length === 0 ? newFile.size : next[index].qcFileSize,
          };
          return next;
        });
      } catch (e) {
        await confirmDialog({
          title: 'QC Upload Failed',
          message: 'QC upload failed. Please try again.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'danger',
        });
      }
    },
    [],
  );

  const handleRemoveQCFile = useCallback((itemIndex: number, fileIndex: number) => {
    setQcFormData((prev) => {
      const next = [...prev];
      const files = next[itemIndex].qcFiles || [];
      const updatedFiles = files.filter((_, idx) => idx !== fileIndex);
      
      next[itemIndex] = {
        ...next[itemIndex],
        qcFiles: updatedFiles,
        // Update legacy fields to point to first file
        qcFileUrl: updatedFiles.length > 0 ? updatedFiles[0].url : '',
        qcFileName: updatedFiles.length > 0 ? updatedFiles[0].name : '',
        qcFileType: updatedFiles.length > 0 ? updatedFiles[0].type : '',
        qcFileSize: updatedFiles.length > 0 ? updatedFiles[0].size : 0,
      };
      return next;
    });
  }, []);

  const openView = useCallback(
    async (row: ReceiptVoucherRow) => {
      const rowIdentity = getSrvRowIdentity(row);
      const receiptRow =
        openSrvs.find((o) => getSrvRowIdentity(o) === rowIdentity) ||
        srvHistory.find((h) => getSrvRowIdentity(h) === rowIdentity) ||
        row;
      setSelectedRow(receiptRow);

      const jobOrderId = String(receiptRow.job_order_id || '').trim();
      const isManualSrv = !receiptRow.job_order_id;

      setQcSummary(null);
      if (!isManualSrv) fetchQcSummary(jobOrderId);

      const prefillQty = Number(receiptRow.quantity ?? 0) || 0;
      setReceivedQty(prefillQty);
      const receivedByNameRaw = String(
        (receiptRow as any)?.received_by_name ||
          receiptRow.received_by_name ||
          (receiptRow as any)?.received_by ||
          receiptRow.received_by ||
          '',
      ).trim();
      const receiverNamePrefill = receivedByNameRaw && isUuidLike(receivedByNameRaw) ? '' : receivedByNameRaw;
      setReceiverName(receiverNamePrefill);
      setReceiverPhone(String((receiptRow as any)?.received_by_phone || receiptRow.received_by_phone || '') || '');

      // Initialize QC modal state (single-item SRV, but same QC screen as GRN)
      setQcFormData([
        {
          itemId: String(row.item_id || row.id || '').trim() || String(row.id),
          itemCode: String(row.item_code || '').trim() || '-',
          itemName: String(row.item_name || '').trim() || '-',
          receivedQty: prefillQty,
          acceptedQty: prefillQty,
          rejectedQty: 0,
          qcNotes: '',
          rejectionReason: '',
          qcFileUrl: '',
          qcFileName: '',
          qcFileType: '',
          qcFileSize: 0,
          checked_by: '',
        },
      ]);
      setQcMetadata({
        invoiceNumber: '',
        qcDate: getTodayDateInputValue(),
        qcBy: '',
      });
      setShowQcModal(false);
      setShowViewModal(true);
    },
    [openSrvs, srvHistory, fetchQcSummary]
  );

  const receiveSrv = useCallback(
    async (row: ReceiptVoucherRow, qty: number) => {
      const jobOrderId = String(row.job_order_id || row.id || '').trim();
      await apiClient.post(`/job-orders/store/receipt-vouchers/${jobOrderId}/receive`, {
        receiverName,
        receiverPhone,
        receivedQuantity: qty,
      });
    },
    [receiverName, receiverPhone],
  );

  const approveSrv = useCallback(async (row: ReceiptVoucherRow) => {
    const entryOrJobOrderId = String(row.entry_id || row.id || '').trim();
    await apiClient.put(`/job-orders/store/receipt-vouchers/${entryOrJobOrderId}/approve`, {});
  }, []);

  const approveSrvWithFeedback = useCallback(async (row: ReceiptVoucherRow) => {
    const confirmed = await confirmDialog({
      title: 'Approve SRV',
      message: `Approve SRV for ${row.job_order_number || row.item_code || 'this receipt'}?`,
      confirmLabel: 'Approve',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      await approveSrv(row);
      await loadAll();
      await confirmDialog({
        title: 'SRV Approved',
        message: 'The selected SRV receipt has been approved.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
    } catch (err: any) {
      await confirmDialog({
        title: 'Approval Failed',
        message: 'Failed to approve SRV: ' + (err?.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
    }
  }, [approveSrv, loadAll]);

  const approveAllPending = useCallback(async () => {
    const pending = srvHistory.filter((r) => !r.approved_by);
    if (pending.length === 0) {
      await confirmDialog({
        title: 'Nothing To Approve',
        message: 'No pending SRVs to approve.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'warning',
      });
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Bulk Approve SRVs',
      message: `Approve all ${pending.length} pending SRV(s)?`,
      confirmLabel: 'Approve All',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      setBulkApproving(true);
      let succeeded = 0;
      let failed = 0;
      for (const row of pending) {
        try {
          await apiClient.put(`/job-orders/store/receipt-vouchers/${String(row.entry_id || row.id || '').trim()}/approve`, {});
          succeeded++;
        } catch {
          failed++;
        }
      }
      await loadAll();
      await confirmDialog({
        title: 'Bulk Approval Complete',
        message: `Bulk approve done: ${succeeded} approved${failed > 0 ? `, ${failed} failed` : ''}.`,
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: failed > 0 ? 'warning' : undefined,
      });
    } finally {
      setBulkApproving(false);
    }
  }, [srvHistory, loadAll]);

  const qcAcceptSrv = useCallback(
    async (jobOrderId: string, acceptedQuantity: number, rejectedQuantity: number, extra?: any) => {
      return apiClient.post<QcApproveResponse>(`/job-orders/${jobOrderId}/qc-approve`, {
        acceptedQuantity,
        rejectedQuantity,
        ...(extra || {}),
      });
    },
    [],
  );

  const deleteSrv = useCallback(
    async (movementId: string) => {
      const confirmed = await confirmDialog({
        title: 'Reverse SRV Entry',
        message: 'Reverse this SRV goods receipt? Stock and UID movement will be reversed.',
        confirmLabel: 'Reverse',
        variant: 'danger',
      });
      if (!confirmed) return;
      try {
        await apiClient.delete(`/job-orders/store/receipt-vouchers/${movementId}`);
        await loadAll();
        await confirmDialog({
          title: 'SRV Reversed',
          message: 'SRV goods receipt has been reversed and stock/UID movement has been adjusted.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
        });
      } catch (err: any) {
        await confirmDialog({
          title: 'Reverse Failed',
          message: 'Failed to reverse SRV: ' + (err.message || err),
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'danger',
        });
      }
    },
    [loadAll]
  );

  const printSrv = useCallback(async (row: ReceiptVoucherRow) => {
    const receivedAt = row.movement_date ? new Date(row.movement_date).toLocaleString() : '-';
    const approvedAt = row.approved_at ? new Date(row.approved_at).toLocaleString() : '-';
    const statusLabel = row.approved_by ? 'APPROVED' : 'PENDING';

    const warehouseLabel = resolveWarehouseLabel(row.to_warehouse_id);
    const receivedByLabel = resolveEmployeeLabel(row.received_by_name || row.received_by);
    const generatedOn = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      await confirmDialog({
        title: 'Popup Blocked',
        message: 'Please allow popups for this site to print the SRV.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'warning',
      });
      return;
    }

    printWindow.document.open();
    printWindow.document.write('<!doctype html><html><head><title>Preparing SRV...</title></head><body style="font-family: Arial, sans-serif; padding: 16px;">Preparing SRV...</body></html>');
    printWindow.document.close();

    const company = await apiClient.get<any>('/tenant/current').catch(() => null);
    const branding = buildDocumentBranding(company);
    const html = `
      <!DOCTYPE html>
      <html>
      <head><script>window.onload = window.print</script><title>SRV - ${escapePrintHtml(row.job_order_number || row.id || '-')}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; color: #111; }
        .page { max-width: 900px; margin: 0 auto; }
        .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .title { font-size: 18px; font-weight: 800; margin-top: 6px; }
        .subtitle { color: #444; margin-top: 2px; }
        .meta { text-align: right; }
        .meta .kv { margin: 0; line-height: 1.4; }
        .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid #ddd; }
        .pill.ok { background: #e7f7ee; border-color: #bfe7cf; color: #1b6b3a; }
        .pill.pending { background: #fff7e6; border-color: #ffe1a6; color: #7a4a00; }
        .hr { height: 1px; background: #ddd; margin: 14px 0; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
        .field { padding: 8px 10px; border: 1px solid #e3e3e3; border-radius: 8px; }
        .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #555; }
        .value { margin-top: 4px; font-size: 12px; font-weight: 700; color: #111; }
        table { width: 100%; border-collapse: collapse; margin-top: 14px; }
        thead th { background: #f6f6f6; border: 1px solid #e3e3e3; padding: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #333; }
        tbody td { border: 1px solid #e3e3e3; padding: 8px; vertical-align: top; }
        .right { text-align: right; }
        .muted { color: #666; font-weight: 400; }
        .footer { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        .sign { border: 1px solid #e3e3e3; border-radius: 10px; padding: 10px; min-height: 74px; }
        .sign .who { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #555; }
        .line { margin-top: 32px; height: 1px; background: #bbb; }
        .notes { margin-top: 14px; padding: 10px; border: 1px dashed #d0d0d0; border-radius: 10px; }
        @media print { body { margin: 0; } .page { max-width: none; margin: 0; padding: 18px; } }
      </style>
      </head>
      <body>
        <div class="page">
          ${renderStandardLetterheadHtml(branding, generatedOn)}

          <div class="topbar">
            <div>
              <div class="title">Store Receipt Voucher (SRV)</div>
              <div class="subtitle">Receipt of finished goods from production</div>
            </div>
            <div class="meta">
              <p class="kv"><span class="pill ${row.approved_by ? 'ok' : 'pending'}">${statusLabel}</span></p>
              <p class="kv"><strong>Received At:</strong> <span class="muted">${escapePrintHtml(receivedAt)}</span></p>
            </div>
          </div>

          <div class="hr"></div>

          <div class="grid">
            <div class="field">
              <div class="label">Job Order</div>
              <div class="value">${escapePrintHtml(row.job_order_number || row.job_order_id || '-')}</div>
            </div>
            <div class="field">
              <div class="label">To Warehouse</div>
              <div class="value">${escapePrintHtml(warehouseLabel || '-')}</div>
            </div>
            <div class="field">
              <div class="label">Received By</div>
              <div class="value">${escapePrintHtml(receivedByLabel || '-')}</div>
            </div>
            <div class="field">
              <div class="label">Approved By</div>
              <div class="value">${escapePrintHtml(row.approved_by || '-')}</div>
              <div class="muted" style="margin-top:4px;"><strong>Approved At:</strong> ${escapePrintHtml(approvedAt)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width:44px;">#</th>
                <th style="width:140px;">Item Code</th>
                <th>Item Name</th>
                <th style="width:180px;">UID</th>
                <th class="right" style="width:90px;">Qty</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td><strong>${escapePrintHtml(row.item_code || '-')}</strong></td>
                <td>${escapePrintHtml(row.item_name || '-')}</td>
                <td>${escapePrintHtml(row.uid || '-')}</td>
                <td class="right"><strong>${row.quantity ?? 0}</strong></td>
              </tr>
            </tbody>
          </table>

          ${row.notes ? `<div class="notes"><div class="label">Notes</div><div style="margin-top:6px;">${escapePrintHtml(row.notes)}</div></div>` : ''}

          <div class="footer">
            <div class="sign">
              <div class="who">Received By (Stores)</div>
              <div class="line"></div>
            </div>
            <div class="sign">
              <div class="who">Verified By (Production)</div>
              <div class="line"></div>
            </div>
            <div class="sign">
              <div class="who">Approved By (Manager)</div>
              <div class="line"></div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  }, [resolveEmployeeLabel, resolveWarehouseLabel]);

  const printGeneratedUids = useCallback(async (payload: GeneratedUidPrintPayload, preOpenedWindow?: Window | null) => {
    const generatedUids = Array.isArray(payload.generatedUids)
      ? payload.generatedUids.map((uid) => String(uid || '').trim()).filter(Boolean)
      : [];

    if (generatedUids.length === 0) {
      preOpenedWindow?.close();
      return;
    }

    const printWindow = preOpenedWindow || window.open('', '_blank');
    if (!printWindow) {
      await confirmDialog({
        title: 'UID Print Blocked',
        message: `QC completed, but the UID print window was blocked. Generated UIDs: ${generatedUids.join(', ')}`,
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'warning',
      });
      return;
    }

    printWindow.document.open();
    printWindow.document.write('<!doctype html><html><head><title>Preparing UID print...</title></head><body style="font-family: Arial, sans-serif; padding: 16px;">Preparing UID print...</body></html>');
    printWindow.document.close();

    const jobOrderNumber = escapePrintHtml(payload.jobOrderNumber || '-');
    const itemCode = escapePrintHtml(payload.itemCode || '-');
    const itemName = escapePrintHtml(payload.itemName || '-');
    const qcDate = escapePrintHtml(
      payload.qcDate ? new Date(payload.qcDate).toLocaleDateString() : new Date().toLocaleDateString(),
    );
    const qcBy = escapePrintHtml(payload.qcBy || '-');
    const printedAt = escapePrintHtml(new Date().toLocaleString());
    const company = await apiClient.get<any>('/tenant/current').catch(() => null);
    const branding = buildDocumentBranding(company);
    const qrCodes = await Promise.all(
      generatedUids.map(async (uid) => ({
        uid,
        dataUrl: await QRCode.toDataURL(uid, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 120,
        }),
      })),
    );
    const uidCards = generatedUids
      .map(
        (uid, index) => `
          <div class="uid-card">
            <div class="uid-card-head">
              <div>
                <div class="uid-card-title">UID Label</div>
                <div class="uid-card-subtitle">${itemCode} | ${itemName}</div>
              </div>
              <div class="uid-card-seq">${index + 1}/${generatedUids.length}</div>
            </div>
            <div class="uid-card-body">
              <div class="uid-layout">
                <div class="uid-copy">
                  <div class="uid-value">${escapePrintHtml(uid)}</div>
                  <div class="uid-meta">JO: ${jobOrderNumber}</div>
                  <div class="uid-meta">QC Date: ${qcDate}</div>
                </div>
                <img class="uid-qr" src="${qrCodes[index]?.dataUrl || ''}" alt="QR for ${escapePrintHtml(uid)}" />
              </div>
            </div>
          </div>
        `,
      )
      .join('');
    const uidRows = generatedUids
      .map(
        (uid, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapePrintHtml(uid)}</td>
            <td>${itemCode}</td>
            <td>${itemName}</td>
            <td>${jobOrderNumber}</td>
          </tr>
        `,
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script>window.onload = window.print</script>
        <title>UID Print - ${jobOrderNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; color: #111; }
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
          .uid-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
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
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; font-size: 12px; }
          th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
          .footer-note { margin-top: 14px; font-size: 11px; color: #6b7280; }
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
              <div class="subtitle">Printed immediately after SRV QC acceptance</div>
            </div>
            <div class="meta">
              <div><strong>Printed At:</strong> ${printedAt}</div>
              <div><strong>QC By:</strong> ${qcBy}</div>
              <div><strong>Total UIDs:</strong> ${generatedUids.length}</div>
            </div>
          </div>

          <div class="summary">
            <div class="summary-card">
              <div class="summary-label">Job Order</div>
              <div class="summary-value">${jobOrderNumber}</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">Item Code</div>
              <div class="summary-value">${itemCode}</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">Item Name</div>
              <div class="summary-value">${itemName}</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">QC Date</div>
              <div class="summary-value">${qcDate}</div>
            </div>
          </div>

          <div class="uid-grid">${uidCards}</div>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>UID</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Job Order</th>
              </tr>
            </thead>
            <tbody>${uidRows}</tbody>
          </table>

          <div class="footer-note">Keep this print with the accepted production batch for UID traceability.</div>
        </div>
      </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  }, []);

  const openManualSrv = useCallback(async () => {
    setManualSrvAlert(null);
    setManualSrvForm({ itemId: '', quantity: '', warehouseId: '', receiverName: '', receiverPhone: '', notes: '', movementDate: todayDate });
    if (manualSrvItems.length === 0) {
      const token = localStorage.getItem('accessToken');
      try {
        const res = await fetch('/api/v1/inventory/items', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setManualSrvItems(Array.isArray(data) ? data.map((i: any) => ({ id: i.id, code: i.code, name: i.name })).sort((a: any, b: any) => a.code.localeCompare(b.code)) : []);
      } catch {}
    }
    setShowManualSrvModal(true);
  }, [manualSrvItems.length, todayDate]);

  const pendingApprovalCount = srvHistory.filter((row) => !row.approved_by).length;
  const approvedCount = srvHistory.length - pendingApprovalCount;
  const uidTrackedCount = [...openSrvs, ...srvHistory].filter((row) => String(row.uid || '').trim()).length;
  const qcPendingCount = openSrvs.length;
  const totalReceivedQty = srvHistory.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-4 text-[#2F241D] lg:px-6">
      <div className="flex min-h-[calc(100vh-2rem)] flex-col gap-4">
        <ErpPageHeader
          eyebrow="Inventory"
          title="Store Receipt Voucher"
          description="Receive finished goods from production, complete QC, post stock, and generate UID traceability."
          actions={
            <div className="flex flex-wrap gap-2">
              {canCreate && (
                <ErpButton variant="primary" onClick={() => void openManualSrv()}>
                  <Plus className="h-4 w-4" />
                  Manual SRV
                </ErpButton>
              )}
              <ErpButton
                variant="secondary"
                onClick={() => { void loadAll(); }}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </ErpButton>
            </div>
          }
        />

        <ErpMetricStrip
          loading={loading}
          metrics={[
            { label: 'QC Pending', value: qcPendingCount, tone: qcPendingCount > 0 ? 'warning' : 'success' },
            { label: 'Posted Receipts', value: srvHistory.length, tone: 'success' },
            { label: 'Received Qty', value: totalReceivedQty },
            { label: 'UID Tracked', value: uidTrackedCount, tone: uidTrackedCount > 0 ? 'success' : 'neutral' },
            { label: 'Awaiting Approval', value: pendingApprovalCount, tone: pendingApprovalCount > 0 ? 'warning' : 'success' },
          ]}
        />

        <div className="grid gap-3 lg:grid-cols-4">
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">Movement Type</div>
            <div className="mt-1 text-lg font-bold text-[#4A3426]">101</div>
            <div className="text-xs text-[#7A6555]">Goods receipt from production</div>
          </div>
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">Document Flow</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#4A3426]">
              <GitBranch className="h-4 w-4 text-[#8B6F47]" />
              Job Order {'>'} SRV {'>'} QC {'>'} Stock
            </div>
            <div className="text-xs text-[#7A6555]">Production receipts move through QC before final acceptance</div>
          </div>
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">QC Gate</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#4A3426]">
              <ClipboardCheck className="h-4 w-4 text-[#8B6F47]" />
              {qcPendingCount} pending receipt{qcPendingCount === 1 ? '' : 's'}
            </div>
            <div className="text-xs text-[#7A6555]">Accepted quantity controls stock and UID generation</div>
          </div>
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">Posting Control</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#4A3426]">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              Stock posts after QC accept
            </div>
            <div className="text-xs text-[#7A6555]">Reversal restores stock and UID movement</div>
          </div>
        </div>

        <div className="rounded-md border border-[#E8DCC4] bg-white">
          <div className="flex flex-col gap-3 border-b border-[#E8DCC4] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => switchSrvView('open')}
              className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
                activeSrvView === 'open'
                  ? 'border-[#8B6F47] bg-[#8B6F47] text-white'
                  : 'border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]'
              }`}
            >
              <PackageCheck className="h-4 w-4" />
              QC Pending ({openSrvs.length})
            </button>
            <button
              type="button"
              onClick={() => switchSrvView('history')}
              className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
                activeSrvView === 'history'
                  ? 'border-[#8B6F47] bg-[#8B6F47] text-white'
                  : 'border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]'
              }`}
            >
              <History className="h-4 w-4" />
              Posted Receipts ({srvHistory.length})
            </button>
            </div>
            {activeSrvView === 'history' && canApprove && (
              <ErpButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void approveAllPending()}
                disabled={bulkApproving || pendingApprovalCount === 0}
              >
                <Check className="h-4 w-4" />
                {bulkApproving ? 'Approving...' : `Approve Pending (${pendingApprovalCount})`}
              </ErpButton>
            )}
          </div>
        </div>

        {activeSrvView === 'open' && (
          <div className="min-h-0 flex-1 rounded-md border border-[#E8DCC4] bg-white">
            <div className="border-b border-[#E8DCC4] px-4 py-3">
              <h2 className="text-base font-bold text-[#4A3426]">Receipts Awaiting QC</h2>
              <p className="mt-0.5 text-xs text-[#7A6555]">Complete QC acceptance before final stock/UID posting.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E8DCC4]">
                <thead className="bg-[#F5EFE3]">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Job Order
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Item
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      UID
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Qty
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Movement
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      QC / Posting
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Received By
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Received At
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-[#5E4635]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DCC4] bg-white">
                  {openSrvs.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-[#7A6555]">
                        No pending SRVs.
                      </td>
                    </tr>
                  )}
                  {openSrvs.map((row) => (
                    <tr key={getSrvRowIdentity(row)} className="hover:bg-[#FFFCF5]">
                      <td className="px-4 py-3 text-sm font-semibold text-[#4A3426]">
                        {row.job_order_number || row.job_order_id}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#5E4635]">
                        <div className="font-medium text-gray-900">{row.item_code}</div>
                        <div className="text-xs text-gray-500">{row.item_name}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.uid || '-'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-[#4A3426]">{row.quantity || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="font-medium text-[#4A3426]">101</div>
                        <div className="text-xs text-gray-500">Receipt from production</div>
                      </td>
                      <td className="px-4 py-3">
                        <ErpStatusBadge status="QC_PENDING" label="QC Pending" tone="warning" />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{resolveEmployeeLabel(row.received_by_name || row.received_by)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {row.movement_date
                          ? new Date(row.movement_date).toLocaleString()
                          : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <ErpButton
                            onClick={() => printSrv(row)}
                            variant="secondary"
                            size="sm"
                          >
                            <Printer className="h-4 w-4" />
                            Print
                          </ErpButton>
                          <ErpButton
                            onClick={() => openView(row)}
                            size="sm"
                          >
                            View
                          </ErpButton>
                          {canDelete && (
                          <ErpButton
                            onClick={() => deleteSrv(String(row.entry_id || row.id || '').trim())}
                            variant="danger"
                            size="sm"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Reverse
                          </ErpButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeSrvView === 'history' && (
          <div className="min-h-0 flex-1 rounded-md border border-[#E8DCC4] bg-white">
            <div className="border-b border-[#E8DCC4] px-4 py-3">
              <h2 className="text-base font-bold text-[#4A3426]">Posted SRV History</h2>
              <p className="mt-0.5 text-xs text-[#7A6555]">Posted receipts, approvals, UID traceability, and reversal controls.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E8DCC4]">
                <thead className="bg-[#F5EFE3]">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Job Order
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Item
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      UID
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Qty
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Movement
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Status
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Received By
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                      Received At
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-[#5E4635]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DCC4] bg-white">
                  {srvHistory.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-[#7A6555]">
                        No SRV history.
                      </td>
                    </tr>
                  )}
                  {[...srvHistory]
                    .sort((a, b) => {
                      const aTs = a.movement_date ? new Date(a.movement_date).getTime() || 0 : 0;
                      const bTs = b.movement_date ? new Date(b.movement_date).getTime() || 0 : 0;
                      return bTs - aTs;
                    })
                    .map((row) => (
                    <tr key={getSrvRowIdentity(row)} className="hover:bg-[#FFFCF5]">
                      <td className="px-4 py-3 text-sm font-semibold text-[#4A3426]">
                        {row.job_order_number || row.job_order_id}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#5E4635]">
                        <div className="font-medium text-gray-900">{row.item_code}</div>
                        <div className="text-xs text-gray-500">{row.item_name}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.uid || '-'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-[#4A3426]">{row.quantity || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="font-medium text-[#4A3426]">101</div>
                        <div className="text-xs text-gray-500">Stock posted</div>
                      </td>
                      <td className="px-4 py-3">
                        <ErpStatusBadge
                          status={row.approved_by ? 'APPROVED' : 'POSTED'}
                          label={row.approved_by ? 'Approved' : 'Posted'}
                          tone={row.approved_by ? 'success' : 'info'}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{resolveEmployeeLabel(row.received_by_name || row.received_by)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {row.movement_date
                          ? new Date(row.movement_date).toLocaleString()
                          : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <ErpButton
                            onClick={() => openView(row)}
                            size="sm"
                          >
                            View
                          </ErpButton>
                          <ErpButton
                            onClick={() => printSrv(row)}
                            variant="secondary"
                            size="sm"
                          >
                            <Printer className="h-4 w-4" />
                            Print
                          </ErpButton>
                          {canApprove && !row.approved_by && (
                          <ErpButton
                            onClick={() => void approveSrvWithFeedback(row)}
                            variant="primary"
                            size="sm"
                          >
                            <Check className="h-4 w-4" />
                            Approve
                          </ErpButton>
                          )}
                          {canDelete && (
                          <ErpButton
                            onClick={() => deleteSrv(String(row.entry_id || row.id || '').trim())}
                            variant="danger"
                            size="sm"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Reverse
                          </ErpButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showViewModal && selectedRow && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-[95vw] max-w-7xl max-h-[92vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">View SRV Details</h2>
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedRow(null);
                    setShowQcModal(false);
                  }}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  x
                </button>
              </div>

              {(() => {
                const jobOrderId = String(selectedRow.job_order_id || '').trim();
                const isManualSrv = !selectedRow.job_order_id;
                const receiptRow =
                  openSrvs.find((o) => o.id === selectedRow.id) ||
                  srvHistory.find((h) => h.id === selectedRow.id) ||
                  selectedRow;

                const statusLabel = isManualSrv ? 'AUTO-APPROVED' : (receiptRow?.approved_by ? 'APPROVED' : 'DRAFT');
                const receivedAt = (receiptRow as any)?.received_at || receiptRow?.movement_date || null;
                const approvedAt = receiptRow?.approved_at || null;

                const receivedQtyDisplay = Number(receiptRow?.quantity ?? 0) || 0;
                const availableQtyDisplay = Number((receiptRow as any)?.available_quantity ?? 0) || 0;

                const qcCompleted =
                  Number(qcSummary?.passedUidsCount || 0) > 0 ||
                  Number(qcSummary?.approvedUidsCount || 0) > 0 ||
                  Number(qcSummary?.stockAdded || 0) > 0;

                const srvApproved = Boolean(receiptRow?.approved_by);
                const qcActionsDisabled = qcSummaryLoading || qcCompleted;

                return (
                  <>
                    <div className="p-6 space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">{isManualSrv ? 'Source' : 'Job Order'}</label>
                          <p className="mt-1 text-gray-900 font-semibold">
                            {isManualSrv ? 'Manual SRV' : (selectedRow.job_order_number || selectedRow.job_order_id || selectedRow.id)}
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Status</label>
                          <span
                            className={`inline-block mt-1 px-3 py-1 text-xs font-semibold rounded-full ${
                              statusLabel === 'APPROVED'
                                ? 'bg-green-100 text-green-800'
                                : statusLabel === 'AUTO-APPROVED'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Received At</label>
                          <p className="mt-1 text-gray-900">
                            {receivedAt ? new Date(receivedAt).toLocaleString() : '-'}
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Approved At</label>
                          <p className="mt-1 text-gray-900">
                            {approvedAt ? new Date(approvedAt).toLocaleString() : '-'}
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Item</label>
                          <p className="mt-1 text-gray-900">
                            {selectedRow.item_code} - {selectedRow.item_name}
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Warehouse</label>
                          <p className="mt-1 text-gray-900">
                            {resolveWarehouseLabel(receiptRow?.to_warehouse_id || selectedRow.to_warehouse_id)}
                          </p>
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="min-w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">S.No</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Item Code</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Item Name</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">UOM</th>
                              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Received</th>
                              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Accepted</th>
                              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Rejected</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t">
                              <td className="px-4 py-2 text-sm text-gray-700">1</td>
                              <td className="px-4 py-2 text-sm text-gray-700">{selectedRow.item_code || '-'}</td>
                              <td className="px-4 py-2 text-sm text-gray-700">{selectedRow.item_name || '-'}</td>
                              <td className="px-4 py-2 text-sm text-gray-700">-</td>
                              <td className="px-4 py-2 text-sm text-gray-700 text-center">{receivedQtyDisplay}</td>
                              <td className="px-4 py-2 text-sm text-green-700 text-center">{availableQtyDisplay}</td>
                              <td className="px-4 py-2 text-sm text-red-700 text-center">-</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {isManualSrv ? (
                        <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
                          OK: This is a <strong>Manual SRV</strong> - stock and UIDs were auto-approved at creation. No QC step required.
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Receive Qty *</label>
                              <input
                                type="number"
                                min={0}
                                value={receivedQty}
                                onChange={(e) => setReceivedQty(Number(e.target.value || 0))}
                                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Received By (Name)</label>
                              <input
                                type="text"
                                value={receiverName}
                                onChange={(e) => setReceiverName(e.target.value)}
                                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                                placeholder="Store keeper name"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Received By (Phone)</label>
                              <input
                                type="text"
                                value={receiverPhone}
                                onChange={(e) => setReceiverPhone(e.target.value)}
                                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                                placeholder="Phone"
                              />
                            </div>
                          </div>
                          <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                            UIDs will NOT be generated at SRV receipt. UIDs will be generated only after QC is completed.
                          </div>
                        </>
                      )}
                    </div>

                    <div className="p-6 border-t border-gray-200 flex justify-between items-center">
                      <div className="flex gap-3">
                        {!isManualSrv && <button
                          onClick={async () => {
                            if (qcSummaryLoading) return;
                            if (qcCompleted) {
                              await confirmDialog({
                                title: 'QC Already Completed',
                                message: 'QC is already completed for this SRV.',
                                confirmLabel: 'OK',
                                cancelLabel: 'Close',
                                variant: 'info',
                              });
                              return;
                            }
                            if (srvApproved) {
                              await confirmDialog({
                                title: 'SRV Already Approved',
                                message: 'This SRV is already approved.',
                                confirmLabel: 'OK',
                                cancelLabel: 'Close',
                                variant: 'info',
                              });
                              return;
                            }

                            const qty = Number(receivedQty || 0);
                            if (!Number.isFinite(qty) || qty <= 0) {
                              await confirmDialog({
                                title: 'Invalid Receive Quantity',
                                message: 'Receive Qty must be greater than 0.',
                                confirmLabel: 'OK',
                                cancelLabel: 'Close',
                                variant: 'warning',
                              });
                              return;
                            }

                            try {
                              // Ensure SRV receipt exists (QC happens AFTER receipt).
                              const hasReceipt = Boolean((receiptRow as any)?.received_at || receiptRow?.movement_date);
                              if (!hasReceipt) {
                                await receiveSrv(selectedRow, qty);
                                await loadAll();
                              }

                              setQcFormData([
                                {
                                  itemId: String(selectedRow?.item_id || selectedRow?.id || '').trim() || String(selectedRow?.id),
                                  itemCode: String(selectedRow?.item_code || '').trim() || '-',
                                  itemName: String(selectedRow?.item_name || '').trim() || '-',
                                  receivedQty: Number(receivedQtyDisplay || qty) || qty,
                                  acceptedQty: Number(receivedQtyDisplay || qty) || qty,
                                  rejectedQty: 0,
                                  qcNotes: '',
                                  rejectionReason: '',
                                  qcFileUrl: '',
                                  qcFileName: '',
                                  qcFileType: '',
                                  qcFileSize: 0,
                                  checked_by: '',
                                },
                              ]);
                              setQcMetadata({
                                invoiceNumber: '',
                                qcDate: getTodayDateInputValue(),
                                qcBy: '',
                              });
                              setShowQcModal(true);
                            } catch (err: any) {
                              await confirmDialog({
                                title: 'QC Not Started',
                                message: 'Failed to start QC: ' + (err?.response?.data?.message || err.message || err),
                                confirmLabel: 'OK',
                                cancelLabel: 'Close',
                                variant: 'danger',
                              });
                            }
                          }}
                          className={`inline-flex items-center gap-2 px-6 py-2 text-white rounded-lg ${!qcActionsDisabled ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'}`}
                          disabled={qcActionsDisabled}
                          title={qcSummaryLoading ? 'Checking QC status...' : qcCompleted ? 'QC already completed' : undefined}
                        >
                          <ClipboardCheck className="h-4 w-4" />
                          QC Accept
                        </button>}
                      </div>
                      <button
                        onClick={() => {
                          setShowViewModal(false);
                          setSelectedRow(null);
                          setShowQcModal(false);
                        }}
                        className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                      >
                        Close
                      </button>
                    </div>

                    {showQcModal && (
                      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden">
                          <div className="sticky top-0 z-10 p-6 border-b border-gray-200 flex justify-between items-center gap-4 bg-blue-50">
                            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                              <ClipboardCheck className="h-6 w-6 text-blue-700" />
                              QC Inspection
                            </h2>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setShowQcModal(false)}
                                className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={async () => {
                                  // Declare outside try so catch block can close it on error
                                  let uidPrintWindow: Window | null = null;
                                  try {
                                    const hasRejectedWithoutReason = qcFormData.some(
                                      (it) => it.rejectedQty > 0 && !it.rejectionReason?.trim(),
                                    );
                                    if (hasRejectedWithoutReason) {
                                      await confirmDialog({
                                        title: 'Rejection Reason Required',
                                        message: 'Please provide rejection reason for all rejected items.',
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                        variant: 'warning',
                                      });
                                      return;
                                    }

                                    if (!qcMetadata.qcDate) {
                                      await confirmDialog({
                                        title: 'QC Date Required',
                                        message: 'QC Date is required.',
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                        variant: 'warning',
                                      });
                                      return;
                                    }

                                    const jobOrderId = String(selectedRow?.job_order_id || selectedRow?.id || '').trim();
                                    if (!jobOrderId) {
                                      await confirmDialog({
                                        title: 'Missing Job Order',
                                        message: 'Missing Job Order ID.',
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                        variant: 'danger',
                                      });
                                      return;
                                    }

                                    const accepted = qcFormData.reduce((sum, it) => sum + (Number(it.acceptedQty) || 0), 0);
                                    const rejected = qcFormData.reduce((sum, it) => sum + (Number(it.rejectedQty) || 0), 0);
                                    const received = qcFormData.reduce((sum, it) => sum + (Number(it.receivedQty) || 0), 0);

                                    if (!Number.isFinite(accepted) || accepted <= 0) {
                                      await confirmDialog({
                                        title: 'Invalid Accepted Quantity',
                                        message: 'Accepted Qty must be greater than 0.',
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                        variant: 'warning',
                                      });
                                      return;
                                    }
                                    if (!Number.isFinite(rejected) || rejected < 0) {
                                      await confirmDialog({
                                        title: 'Invalid Rejected Quantity',
                                        message: 'Rejected Qty must be greater than or equal to 0.',
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                        variant: 'warning',
                                      });
                                      return;
                                    }
                                    if (accepted + rejected > received) {
                                      await confirmDialog({
                                        title: 'Quantity Mismatch',
                                        message: `Accepted + Rejected cannot exceed Received (${received}).`,
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                        variant: 'warning',
                                      });
                                      return;
                                    }

                                    // Open print window now (synchronous user-gesture context) to avoid popup blocker
                                    uidPrintWindow = window.open('', '_blank');
                                    if (uidPrintWindow) {
                                      uidPrintWindow.document.write('<!doctype html><html><head><title>Preparing UID print...</title></head><body style="font-family:Arial,sans-serif;padding:16px">Preparing UID print...</body></html>');
                                      uidPrintWindow.document.close();
                                    }

                                    const qcResult = await qcAcceptSrv(jobOrderId, accepted, rejected, {
                                      metadata: { ...qcMetadata, source: 'SRV' },
                                      items: qcFormData,
                                      checkedBy: qcFormData.reduce((acc, it) => {
                                        const key = String(it.itemCode || it.itemId || '').trim();
                                        if (key) acc[key] = String(it.checked_by || '').trim();
                                        return acc;
                                      }, {} as Record<string, string>),
                                    });

                                    await loadAll();
                                    await fetchQcSummary(jobOrderId);
                                    setShowQcModal(false);

                                    const generatedUids = Array.isArray(qcResult?.generatedUids)
                                      ? qcResult.generatedUids.map((uid) => String(uid || '').trim()).filter(Boolean)
                                      : [];

                                    if (generatedUids.length > 0) {
                                      await printGeneratedUids({
                                        jobOrderNumber:
                                          String(qcResult?.jobOrderNumber || selectedRow?.job_order_number || jobOrderId).trim() ||
                                          '-',
                                        itemCode:
                                          String(qcResult?.itemCode || selectedRow?.item_code || qcFormData[0]?.itemCode || '').trim() ||
                                          '-',
                                        itemName:
                                          String(qcResult?.itemName || selectedRow?.item_name || qcFormData[0]?.itemName || '').trim() ||
                                          '-',
                                        generatedUids,
                                        qcDate: qcMetadata.qcDate,
                                        qcBy:
                                          resolveEmployeeLabel(qcMetadata.qcBy) !== '-'
                                            ? resolveEmployeeLabel(qcMetadata.qcBy)
                                            : String(
                                                [
                                                  currentUser?.first_name,
                                                  currentUser?.last_name,
                                                  currentUser?.firstName,
                                                  currentUser?.lastName,
                                                ]
                                                  .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index)
                                                  .join(' '),
                                              ).trim() || '-',
                                      }, uidPrintWindow);
                                      await confirmDialog({
                                        title: 'QC Completed',
                                        message: `QC completed successfully. ${generatedUids.length} UID(s) were generated and opened for print.`,
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                      });
                                    } else {
                                      // No UIDs generated - close the pre-opened window
                                      uidPrintWindow?.close();
                                      await confirmDialog({
                                        title: 'QC Completed',
                                        message: qcResult?.message || 'QC completed successfully.',
                                        confirmLabel: 'OK',
                                        cancelLabel: 'Close',
                                      });
                                    }
                                  } catch (err: any) {
                                    uidPrintWindow?.close();
                                    await confirmDialog({
                                      title: 'QC Accept Failed',
                                      message: 'Failed to QC Accept: ' + (err?.response?.data?.message || err.message || err),
                                      confirmLabel: 'OK',
                                      cancelLabel: 'Close',
                                      variant: 'danger',
                                    });
                                  }
                                }}
                                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                              >
                                OK Complete QC Inspection
                              </button>
                            </div>
                          </div>

                          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                              <h3 className="text-lg font-semibold text-gray-900 mb-4">QC Information</h3>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number</label>
                                  <input
                                    type="text"
                                    value={qcMetadata.invoiceNumber}
                                    onChange={(e) => setQcMetadata({ ...qcMetadata, invoiceNumber: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="Invoice #"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">QC Date *</label>
                                  <DateInput
                                    max={todayDate}
                                    value={qcMetadata.qcDate}
                                    onChange={(value) => setQcMetadata({ ...qcMetadata, qcDate: value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                              </div>
                            </div>


                            <div className="space-y-4">
                              {qcFormData.map((item, index) => (
                                <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                                  <div className="flex justify-between items-start mb-3">
                                    <div>
                                      <div className="font-semibold text-gray-900">{item.itemName}</div>
                                      <div className="text-sm text-gray-600">Code: {item.itemCode}</div>
                                    </div>
                                    <div className="text-sm text-gray-600">
                                      Received: <span className="font-semibold">{item.receivedQty}</span>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Accepted Quantity *</label>
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
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Rejected Quantity</label>
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
                                      <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason *</label>
                                      <input
                                        type="text"
                                        value={item.rejectionReason}
                                        onChange={(e) => {
                                          const newData = [...qcFormData];
                                          newData[index] = { ...item, rejectionReason: e.target.value };
                                          setQcFormData(newData);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder="Enter reason for rejection"
                                      />
                                    </div>
                                  )}

                                  <div className="mt-3">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">QC Notes</label>
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
                                      capture="environment"
                                      onChange={(e) => {
                                        const files = Array.from(e.target.files || []);
                                        files.forEach(file => handleQCFileSelect(file, index));
                                        // Clear the input so the same file can be uploaded again if needed
                                        e.target.value = '';
                                      }}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                    />
                                    {item.qcFiles && item.qcFiles.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        <div className="text-xs font-medium text-gray-700">
                                          Uploaded Files ({item.qcFiles.length}):
                                        </div>
                                        {item.qcFiles.map((file, fileIndex) => (
                                          <div key={fileIndex} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded">
                                            <span className="flex-1 truncate">
                                              📎 {file.name}
                                            </span>
                                            <div className="flex gap-2 ml-2">
                                              <button
                                                type="button"
                                                onClick={() => handleViewInvoice(file.url, file.name)}
                                                className="text-blue-600 hover:text-blue-800 underline"
                                              >
                                                View
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleRemoveQCFile(index, fileIndex)}
                                                className="text-red-600 hover:text-red-800 font-bold"
                                                title="Remove file"
                                              >
                                                x
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

                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Manual SRV Modal */}
      {showManualSrvModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-xl font-bold text-gray-900">Create Manual SRV</h2>
              <button onClick={() => setShowManualSrvModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-4">
              {manualSrvAlert && (
                <div className={`rounded-lg px-4 py-3 text-sm font-medium ${manualSrvAlert.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
                  {manualSrvAlert.message}
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Item <span className="text-red-500">*</span></label>
                <SearchableSelect
                  value={manualSrvForm.itemId}
                  onChange={(value) => setManualSrvForm({ ...manualSrvForm, itemId: String(value || '') })}
                  options={manualSrvItems.map(i => ({ value: i.id, label: i.code, subtitle: i.name }))}
                  placeholder="Search item by code or name..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Quantity <span className="text-red-500">*</span></label>
                  <input type="number" min="0.01" step="any"
                    value={manualSrvForm.quantity}
                    onChange={(e) => setManualSrvForm({ ...manualSrvForm, quantity: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                    placeholder="e.g. 10" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                  <DateInput
                    value={manualSrvForm.movementDate}
                    onChange={(value) => setManualSrvForm({ ...manualSrvForm, movementDate: value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>
              {warehouses.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Warehouse</label>
                  <select
                    value={manualSrvForm.warehouseId}
                    onChange={(e) => setManualSrvForm({ ...manualSrvForm, warehouseId: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Default warehouse</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.code ? `${w.code} - ` : ''}{w.name || w.id}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Received By</label>
                  <input type="text"
                    value={manualSrvForm.receiverName}
                    onChange={(e) => setManualSrvForm({ ...manualSrvForm, receiverName: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                    placeholder="Name" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
                  <input type="text"
                    value={manualSrvForm.receiverPhone}
                    onChange={(e) => setManualSrvForm({ ...manualSrvForm, receiverPhone: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                    placeholder="Phone number" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes / Reason</label>
                <textarea rows={2}
                  value={manualSrvForm.notes}
                  onChange={(e) => setManualSrvForm({ ...manualSrvForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                  placeholder="Reason for manual receipt..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setShowManualSrvModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                disabled={manualSrvSaving || !manualSrvForm.itemId || !manualSrvForm.quantity}
                onClick={async () => {
                  setManualSrvAlert(null);
                  setManualSrvSaving(true);
                  try {
                    // Open print window now (in sync user-gesture context) to avoid popup blocker
                    const uidPrintWin = window.open('', '_blank');
                    if (uidPrintWin) {
                      uidPrintWin.document.write('<!doctype html><html><head><title>Preparing UID print...</title></head><body style="font-family:Arial,sans-serif;padding:16px">Preparing UID print...</body></html>');
                      uidPrintWin.document.close();
                    }

                    const token = localStorage.getItem('accessToken');
                    const res = await fetch('/api/v1/job-orders/store/receipt-vouchers/manual', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({
                        itemId: manualSrvForm.itemId,
                        quantity: parseFloat(manualSrvForm.quantity),
                        warehouseId: manualSrvForm.warehouseId || undefined,
                        receiverName: manualSrvForm.receiverName || undefined,
                        receiverPhone: manualSrvForm.receiverPhone || undefined,
                        notes: manualSrvForm.notes || undefined,
                        movementDate: manualSrvForm.movementDate || undefined,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) { uidPrintWin?.close(); throw new Error(data?.message || 'Failed to create manual SRV'); }

                    const generatedUids: string[] = Array.isArray(data?.uids) ? data.uids.map((u: any) => String(u || '').trim()).filter(Boolean) : [];
                    const selectedItem = manualSrvItems.find(i => i.id === manualSrvForm.itemId);

                    if (generatedUids.length > 0) {
                      await printGeneratedUids({
                        jobOrderNumber: `MANUAL-SRV / ${data?.entryId?.slice(0, 8) ?? 'NEW'}`,
                        itemCode: selectedItem?.code ?? data?.itemCode ?? '',
                        itemName: selectedItem?.name ?? data?.itemName ?? '',
                        generatedUids,
                        qcDate: manualSrvForm.movementDate || new Date().toISOString(),
                        qcBy: manualSrvForm.receiverName || 'Store',
                      }, uidPrintWin);
                      setManualSrvAlert({ type: 'success', message: `${data.message || 'Manual SRV created!'} ${generatedUids.length} UID label(s) sent to print.` });
                    } else {
                      uidPrintWin?.close();
                      setManualSrvAlert({ type: 'success', message: data.message || 'Manual SRV created successfully!' });
                    }
                    void loadAll();
                    setTimeout(() => setShowManualSrvModal(false), 1500);
                  } catch (err: any) {
                    setManualSrvAlert({ type: 'error', message: err?.message || 'Failed to create manual SRV' });
                  } finally {
                    setManualSrvSaving(false);
                  }
                }}
                className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
              >
                {manualSrvSaving ? 'Creating...' : 'Create SRV'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
