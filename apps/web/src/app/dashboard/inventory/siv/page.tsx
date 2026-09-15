'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../../../../lib/api-client';
import SearchableSelect from '../../../../components/SearchableSelect';
import { confirmDialog } from '../../../../components/ui/ConfirmDialog';
import { buildDocumentBranding, escapeHtml, renderStandardLetterheadHtml } from '@/lib/document-branding';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';
import { ErpButton, ErpMetricStrip, ErpPageHeader, ErpStatusBadge } from '../../../../components/ui/ErpPrimitives';
import { AlertTriangle, Check, ClipboardList, GitBranch, History, PackageCheck, Plus, Printer, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';

const AUTO_REFRESH_MS = 30000;
const SIV_VIEW_STORAGE_KEY = 'sak-erp:siv-active-view';

type BomComponent = {
  item_code: string;
  item_name: string;
  quantity: number;
  uom: string;
};

type InventoryItem = {
  id: string;
  code?: string;
  name?: string;
  category?: string;
  type?: string;
  uid_tracking?: boolean;
  uid_strategy?: string;
};

type ManualIssueLine = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  issueQuantity: number;
  notes?: string;
  uids: string[];
};

type StoreIssueEmployee = {
  id: string;
  employeeCode?: string;
  employeeName: string;
  department?: string | null;
  designation?: string | null;
};

type MaterialLine = {
  id: string;
  item_id?: string;
  item_code?: string;
  item_name?: string;
  required_quantity?: number;
  issued_quantity?: number;
  pending_quantity?: number;
  available_quantity?: number;
  status?: string;
};

type MaterialReq = {
  id: string;
  job_order_number?: string;
  item_id?: string;
  item_code?: string;
  item_name?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  status?: string;
  requiredQuantity?: number;
  issuedQuantity?: number;
  pendingQuantity?: number;
  pendingLines?: number;
  materialLines?: MaterialLine[];
};

type SivHistoryRow = {
  id: string;
  job_order_id?: string;
  job_order_number?: string;
  item_id?: string;
  item_code?: string;
  item_name?: string;
  uid?: string;
  quantity?: number;
  from_warehouse_id?: string;
  movement_date?: string;
  moved_by?: string;
  issued_to_employee_id?: string;
  issued_to_employee_code?: string;
  issued_to_employee_name?: string;
  approved_by?: string;
  approved_at?: string;
  notes?: string;
};

async function putJsonViaApiProxy<T = any>(endpoint: string, payload: any): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const response = await fetch(`/api/v1${endpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload ?? {}),
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!response.ok) {
    const message = typeof data?.message === 'string'
      ? data.message
      : Array.isArray(data?.message)
        ? data.message.join('\n')
        : typeof data === 'string' && data.trim()
          ? data.trim()
          : `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(message);
  }

  return data as T;
}

export default function SivPage() {
  const currentUser = readStoredUser();
  const currentUserDisplayName = String(
    (currentUser as any)?.employee_name ||
    [
      (currentUser as any)?.first_name,
      (currentUser as any)?.last_name,
    ].filter(Boolean).join(' ') ||
    [
      (currentUser as any)?.firstName,
      (currentUser as any)?.lastName,
    ].filter(Boolean).join(' ') ||
    (currentUser as any)?.email ||
    '-',
  ).trim() || '-';
  const canCreate = hasModulePermission(currentUser, 'Inventory', 'create');
  const canApprove = hasModulePermission(currentUser, 'Inventory', 'approve');
  const canDelete = hasModulePermission(currentUser, 'Inventory', 'delete');
  const [mounted, setMounted] = useState(false);
  const [focusJobId, setFocusJobId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [materialRequests, setMaterialRequests] = useState<MaterialReq[]>([]);
  const [sivHistory, setSivHistory] = useState<SivHistoryRow[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; displayName: string; employeeCode?: string }>>([]);
  const [storeIssueEmployees, setStoreIssueEmployees] = useState<StoreIssueEmployee[]>([]);
  const [filterAssignedTo, setFilterAssignedTo] = useState<string>('');
  const [activeSivView, setActiveSivView] = useState<'open' | 'history'>('open');
  const [selectedMaterialJobId, setSelectedMaterialJobId] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [issueQtyByLine, setIssueQtyByLine] = useState<Record<string, string>>({});
  const [selectedLineIdsByJob, setSelectedLineIdsByJob] = useState<Record<string, string[]>>({});
  const [uidInputByLine, setUidInputByLine] = useState<Record<string, string>>({});
  const [scannedUidsByLine, setScannedUidsByLine] = useState<Record<string, string[]>>({});
  const [scanInputByJob, setScanInputByJob] = useState<Record<string, string>>({});
  const [scanBusyJobId, setScanBusyJobId] = useState<string | null>(null);
  const [scanStatusByJob, setScanStatusByJob] = useState<Record<string, { type: 'ok' | 'error'; message: string }>>({});
  const [expandedLineIds, setExpandedLineIds] = useState<Record<string, boolean>>({});
  const [lineBomData, setLineBomData] = useState<Record<string, BomComponent[]>>({});
  const [lineBomLoading, setLineBomLoading] = useState<Record<string, boolean>>({});
  // bomSelectedByLine[lineId][componentIndex] = true/false (checkbox state for BOM components)
  const [bomSelectedByLine, setBomSelectedByLine] = useState<Record<string, Record<number, boolean>>>({});
  const [focusJoNumber, setFocusJoNumber] = useState<string>('');
  const [focusHandled, setFocusHandled] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [expandedHistoryJoIds, setExpandedHistoryJoIds] = useState<Record<string, boolean>>({});
  const [selectedHistoryRowIds, setSelectedHistoryRowIds] = useState<string[]>([]);
  // UID picker modal
  const [uidPickerOpen, setUidPickerOpen] = useState(false);
  const [uidPickerLineId, setUidPickerLineId] = useState<string | null>(null);
  const [uidPickerItemCode, setUidPickerItemCode] = useState('');
  const [uidPickerItemId, setUidPickerItemId] = useState<string | null>(null);
  const [uidPickerMaxQty, setUidPickerMaxQty] = useState(0);
  const [uidPickerUids, setUidPickerUids] = useState<any[]>([]);
  const [uidPickerLoading, setUidPickerLoading] = useState(false);
  const [uidPickerSelected, setUidPickerSelected] = useState<string[]>([]);
  const [manualIssueItemId, setManualIssueItemId] = useState('');
  const [manualIssuedToEmployeeId, setManualIssuedToEmployeeId] = useState('');
  const [manualIssueQty, setManualIssueQty] = useState('1');
  const [manualIssueNotes, setManualIssueNotes] = useState('');
  const [manualIssueUidInput, setManualIssueUidInput] = useState('');
  const [manualIssueUids, setManualIssueUids] = useState<string[]>([]);
  const [manualIssueLines, setManualIssueLines] = useState<ManualIssueLine[]>([]);
  const [manualIssueBusy, setManualIssueBusy] = useState(false);

  const switchSivView = useCallback((view: 'open' | 'history') => {
    setActiveSivView(view);
    try {
      window.localStorage.setItem(SIV_VIEW_STORAGE_KEY, view);
    } catch {
      // Ignore storage restrictions; the in-memory tab state still works.
    }
  }, []);

  const openUidPicker = useCallback(async (lineId: string, itemId: string, itemCode: string, maxQty: number) => {
    setUidPickerLineId(lineId);
    setUidPickerItemId(itemId);
    setUidPickerItemCode(itemCode);
    setUidPickerMaxQty(maxQty);
    setUidPickerSelected([]);
    setUidPickerUids([]);
    setUidPickerLoading(true);
    setUidPickerOpen(true);
    try {
      // Fetch all issuable UID statuses in one call
      // Valid enum values: GENERATED (just created), IN_STOCK (received into inventory)
      const r1 = await apiClient.get<any>(`/uid?itemId=${itemId}&status=GENERATED,IN_STOCK&limit=10000`).catch(() => []);
      const l1 = Array.isArray(r1) ? r1 : (r1?.data ?? []);
      const seen = new Set<string>();
      const list = [...l1].filter((u: any) => {
        const id = u.uid || u.id;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setUidPickerUids(list);
    } catch {
      setUidPickerUids([]);
    } finally {
      setUidPickerLoading(false);
    }
  }, []);

  const confirmUidPicker = useCallback(() => {
    if (!uidPickerLineId) return;
    if (uidPickerLineId === 'manual-draft') {
      setManualIssueUids(uidPickerSelected);
    } else {
      setScannedUidsByLine((prev) => ({ ...prev, [uidPickerLineId]: uidPickerSelected }));
    }
    setUidPickerOpen(false);
  }, [uidPickerLineId, uidPickerSelected, setManualIssueUids]);

  const loadAll = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [reqs, sivHist] = await Promise.all([
        apiClient.get<MaterialReq[]>('/job-orders/store/material-requisitions/open'),
        apiClient.get<SivHistoryRow[]>('/job-orders/store/material-requisitions/history'),
      ]);
      setMaterialRequests(reqs || []);
      setSivHistory(sivHist || []);
    } catch (err: any) {
      if (!options?.silent) {
        await confirmDialog({
          title: 'SIV Data Not Loaded',
          message: 'Failed to load SIV data: ' + (err.message || err),
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'danger',
        });
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
        setInitialDataLoaded(true);
      }
    }
  }, []);

  const loadInventoryItems = useCallback(async () => {
    try {
      const rows = await apiClient.get<any[]>('/items');
      const mapped = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        id: String(row?.id || '').trim(),
        code: String(row?.code || '').trim(),
        name: String(row?.name || '').trim(),
        category: String(row?.category || '').trim(),
        type: String(row?.type || '').trim(),
        uid_tracking: Boolean(row?.uid_tracking ?? row?.uidTracking),
        uid_strategy: String((row?.uid_strategy ?? row?.uidStrategy) || '').trim(),
      })).filter((row) => row.id);
      setInventoryItems(mapped);
    } catch {
      setInventoryItems([]);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiClient.get<any[]>('/job-orders/assignable-users');
      const mapped = (Array.isArray(data) ? data : []).map((u: any) => ({
        id: String(u?.id || '').trim(),
        displayName: String(u?.displayName || u?.employee_name || u?.name || u?.email || '').trim(),
        employeeCode: String(u?.employee_code || u?.employeeCode || '').trim(),
      })).filter((u) => u.id && u.displayName);
      setUsers(mapped);
    } catch {
      setUsers([]);
    }
  }, []);

  const loadStoreIssueEmployees = useCallback(async () => {
    try {
      const data = await apiClient.get<StoreIssueEmployee[]>('/job-orders/store/issue-employees');
      setStoreIssueEmployees(Array.isArray(data) ? data : []);
    } catch {
      setStoreIssueEmployees([]);
    }
  }, []);

  const isSubassemblyItem = useCallback((itemId?: string) => {
    const normalizedId = String(itemId || '').trim();
    if (!normalizedId) return false;

    const item = inventoryItems.find((row) => row.id === normalizedId);
    const category = String(item?.category || item?.type || '').trim().toUpperCase();

    return category === 'SUBASSEMBLY' || category === 'SUB_ASSEMBLY' || category === 'WIP';
  }, [inventoryItems]);

  const itemRequiresUid = useCallback((itemId?: string) => {
    const normalizedId = String(itemId || '').trim();
    if (!normalizedId) return false;

    const item = inventoryItems.find((row) => row.id === normalizedId);
    if (!item) return false;

    const strategy = String(item.uid_strategy || '').trim().toUpperCase();
    if (strategy) {
      return strategy !== 'NONE';
    }

    return item.uid_tracking === true;
  }, [inventoryItems]);

  const fetchLineBom = useCallback(async (lineId: string, itemId: string) => {
    // Toggle collapse if already loaded
    if (lineBomData[lineId] !== undefined) {
      setExpandedLineIds((prev) => ({ ...prev, [lineId]: !prev[lineId] }));
      return;
    }
    setExpandedLineIds((prev) => ({ ...prev, [lineId]: true }));
    setLineBomLoading((prev) => ({ ...prev, [lineId]: true }));
    try {
      const boms = await apiClient.get<any[]>(`/bom?itemId=${itemId}`);
      if (boms && boms.length > 0) {
        const bomId = boms[0].id;
        const items = await apiClient.get<any[]>(`/bom/${bomId}/items`);
        setLineBomData((prev) => ({
          ...prev,
          [lineId]: (items || []).map((bi: any) => ({
            item_code: bi.component_code || bi.item_code || '',
            item_name: bi.component_name || bi.item_name || '',
            // Store per-unit quantity; multiply by issue qty at render time
            quantity: Number(bi.quantity) || 0,
            uom: bi.uom || '',
          })),
        }));
      } else {
        setLineBomData((prev) => ({ ...prev, [lineId]: [] }));
      }
    } catch (err) {
      setLineBomData((prev) => ({ ...prev, [lineId]: [] }));
    } finally {
      setLineBomLoading((prev) => ({ ...prev, [lineId]: false }));
    }
  }, [lineBomData]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    loadAll();
    loadInventoryItems();
    loadUsers();
    loadStoreIssueEmployees();
  }, [loadAll, loadInventoryItems, loadStoreIssueEmployees, loadUsers]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIV_VIEW_STORAGE_KEY);
      if (stored === 'open' || stored === 'history') {
        setActiveSivView(stored);
      }
    } catch {
      // Ignore storage restrictions.
    }
  }, []);

  useEffect(() => {
    if (!manualIssueItemId || itemRequiresUid(manualIssueItemId)) return;
    setManualIssueUidInput('');
    setManualIssueUids([]);
  }, [itemRequiresUid, manualIssueItemId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadAll({ silent: true });
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadAll]);

  useEffect(() => {
    // Read jobId / joNumber from URL on client only (avoids Next.js Suspense requirement for useSearchParams).
    try {
      const params = new URLSearchParams(window.location.search);
      setFocusJobId(String(params.get('jobId') || '').trim());
      setFocusJoNumber(String(params.get('joNumber') || '').trim());
    } catch {
      setFocusJobId('');
      setFocusJoNumber('');
    }
  }, []);

  useEffect(() => {
    if (!initialDataLoaded || focusHandled || (!focusJobId && !focusJoNumber)) return;

    // A deep-link may choose Open Requests once, after the initial load only.
    // Mark it handled even if the job is no longer open so polling can never
    // pull a user away from History later.
    const matched = materialRequests.find((row) =>
      (focusJobId && row.id === focusJobId) ||
      (focusJoNumber && row.job_order_number === focusJoNumber),
    );
    setFocusHandled(true);
    if (!matched) return;

    switchSivView('open');
    setSelectedMaterialJobId(matched.id);
    const el = document.getElementById(`siv-job-${matched.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusHandled, focusJobId, focusJoNumber, initialDataLoaded, materialRequests, switchSivView]);

  useEffect(() => {
    const targetJobId = selectedMaterialJobId || focusJobId;
    if (!targetJobId) return;

    const req = materialRequests.find((row) => row.id === targetJobId);
    if (!req?.materialLines?.length) return;

    const printableLineIds = req.materialLines
      .filter((line) => Number(line.pending_quantity || 0) > 0)
      .filter((line) => Number(line.available_quantity || 0) + 1e-9 >= Number(line.pending_quantity || 0))
      .map((line) => line.id);

    if (printableLineIds.length === 0) return;

    setSelectedLineIdsByJob((prev) => {
      const current = prev[targetJobId] || [];
      const next = Array.from(new Set([...current, ...printableLineIds]));
      if (next.length === current.length) return prev;
      return { ...prev, [targetJobId]: next };
    });
  }, [focusJobId, materialRequests, selectedMaterialJobId]);

  // Auto-expand all material lines that are sub-assemblies (have a BOM) when a JO is focused
  useEffect(() => {
    if (!selectedMaterialJobId) return;
    const req = materialRequests.find((r) => r.id === selectedMaterialJobId);
    if (!req?.materialLines?.length) return;

    for (const ln of req.materialLines) {
      if (!ln.item_id || !isSubassemblyItem(ln.item_id)) continue;

      const pending = Number(ln.pending_quantity) || 0;
      const available = Number(ln.available_quantity) || 0;

      if (available >= pending && pending > 0) continue;
      if (lineBomData[ln.id] === undefined && !lineBomLoading[ln.id]) {
        fetchLineBom(ln.id, ln.item_id);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMaterialJobId, materialRequests, inventoryItems]);

  const normalizeUid = useCallback((value: string) => {
    return String(value || '').replace(/\s+/g, '').trim();
  }, []);

  const formatApiErrorMessage = useCallback((error: any) => {
    const responseData = error?.response?.data;
    const directMessage = String(responseData?.errorMessage || responseData?.message || error?.message || error || 'Bad Request').trim();

    if (!directMessage) return 'Bad Request';

    const detailsIndex = directMessage.indexOf('Details:');
    if (detailsIndex > 0) {
      return directMessage.slice(0, detailsIndex).trim();
    }

    if (directMessage.startsWith('{') && directMessage.endsWith('}')) {
      try {
        const parsed = JSON.parse(directMessage);
        return String(parsed?.errorMessage || parsed?.message || directMessage).trim();
      } catch {
        return directMessage;
      }
    }

    return directMessage;
  }, []);

  const addUidToLineCart = useCallback((jobId: string, lineId: string, uidRaw: string) => {
    const uid = normalizeUid(uidRaw);
    if (!uid) return;

    // Auto-select line when scanning.
    setSelectedLineIdsByJob((prev) => {
      const current = prev[jobId] || [];
      if (current.includes(lineId)) return prev;
      return { ...prev, [jobId]: [...current, lineId] };
    });

    setScannedUidsByLine((prev) => {
      const current = prev[lineId] || [];
      if (current.includes(uid)) return prev;
      const next = [...current, uid];
      // Keep Issue Qty in sync with scanned count (backend enforces equality).
      setIssueQtyByLine((qPrev) => ({
        ...qPrev,
        [lineId]: String(next.length),
      }));
      return { ...prev, [lineId]: next };
    });
  }, [normalizeUid]);

  const addScannedUid = useCallback((jobId: string, lineId: string) => {
    const input = normalizeUid(uidInputByLine[lineId] || '');
    if (!input) return;
    addUidToLineCart(jobId, lineId, input);
    setUidInputByLine((prev) => ({ ...prev, [lineId]: '' }));
  }, [addUidToLineCart, normalizeUid, uidInputByLine]);

  const clearScannedUids = useCallback((lineId: string) => {
    setScannedUidsByLine((prev) => ({ ...prev, [lineId]: [] }));
    setIssueQtyByLine((prev) => {
      if (!(lineId in prev)) return prev;
      const { [lineId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const addManualIssueUid = useCallback(() => {
    if (!itemRequiresUid(manualIssueItemId)) return;
    const uid = normalizeUid(manualIssueUidInput);
    if (!uid) return;
    setManualIssueUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
    setManualIssueUidInput('');
  }, [itemRequiresUid, manualIssueItemId, manualIssueUidInput, normalizeUid]);

  const resetManualIssueDraft = useCallback(() => {
    setManualIssueItemId('');
    setManualIssueQty('1');
    setManualIssueNotes('');
    setManualIssueUidInput('');
    setManualIssueUids([]);
  }, []);

  const buildManualIssueDraftLine = useCallback((): ManualIssueLine | null => {
    if (!manualIssueItemId) {
      return null;
    }

    const requiresUid = itemRequiresUid(manualIssueItemId);

    const issueQuantity = Number(manualIssueQty || 0);
    if (!Number.isFinite(issueQuantity) || issueQuantity <= 0) {
      throw new Error('Issue quantity must be greater than 0.');
    }

    if (requiresUid && manualIssueUids.length > 0 && manualIssueUids.length !== issueQuantity) {
      throw new Error('Manual UID count must match the issue quantity.');
    }

    const item = inventoryItems.find((row) => row.id === manualIssueItemId);
    return {
      id: `${manualIssueItemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      itemId: manualIssueItemId,
      itemCode: String(item?.code || '').trim(),
      itemName: String(item?.name || '').trim(),
      issueQuantity,
      notes: String(manualIssueNotes || '').trim() || undefined,
      uids: requiresUid ? [...manualIssueUids] : [],
    };
  }, [inventoryItems, itemRequiresUid, manualIssueItemId, manualIssueNotes, manualIssueQty, manualIssueUids]);

  const addManualIssueLine = useCallback(async () => {
    try {
      const line = buildManualIssueDraftLine();
      if (!line) {
        await confirmDialog({
          title: 'Select Item',
          message: 'Select an item before adding it to the manual SIV.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'warning',
        });
        return;
      }

      setManualIssueLines((prev) => [...prev, line]);
      resetManualIssueDraft();
    } catch (err: any) {
      await confirmDialog({
        title: 'Manual SIV Line Not Added',
        message: String(err?.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
    }
  }, [buildManualIssueDraftLine, resetManualIssueDraft]);

  const removeManualIssueLine = useCallback((lineId: string) => {
    setManualIssueLines((prev) => prev.filter((line) => line.id !== lineId));
  }, []);

  const handleManualIssue = useCallback(async () => {
    if (!manualIssuedToEmployeeId) {
      await confirmDialog({
        title: 'Select Receiving Employee',
        message: 'Select the registered employee receiving this material before creating the manual SIV.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'warning',
      });
      return;
    }

    const linesToSubmit = [...manualIssueLines];

    try {
      const draftLine = buildManualIssueDraftLine();
      if (draftLine) {
        linesToSubmit.push(draftLine);
      }
    } catch (err: any) {
      await confirmDialog({
        title: 'Manual SIV Not Ready',
        message: String(err?.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
      return;
    }

    if (linesToSubmit.length === 0) {
      await confirmDialog({
        title: 'Add Items',
        message: 'Add at least one item for manual SIV.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'warning',
      });
      return;
    }

    setManualIssueBusy(true);
    try {
      const results: any[] = [];
      for (const line of linesToSubmit) {
        const result = await apiClient.post('/job-orders/store/material-requisitions/manual-issue', {
          itemId: line.itemId,
          issueQuantity: line.issueQuantity,
          issuedToEmployeeId: manualIssuedToEmployeeId,
          notes: line.notes || undefined,
          uids: line.uids.length > 0 ? line.uids : undefined,
        });
        results.push(result);
      }

      setManualIssueLines([]);
      resetManualIssueDraft();
      setManualIssuedToEmployeeId('');
      await loadAll();
      const message = results.length === 1
        ? String(results[0]?.message || 'Manual SIV created successfully')
        : `Created ${results.length} manual SIV entries successfully`;
      await confirmDialog({
        title: 'Manual SIV Created',
        message: `${message}. Open the History tab when you want to review or approve the issued entries.`,
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
    } catch (err: any) {
      await confirmDialog({
        title: 'Manual SIV Failed',
        message: 'Failed to create manual SIV: ' + String(err?.response?.data?.message || err?.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
    } finally {
      setManualIssueBusy(false);
    }
  }, [buildManualIssueDraftLine, loadAll, manualIssueLines, manualIssuedToEmployeeId, resetManualIssueDraft]);

  const scanUidForJob = useCallback(async (jobId: string) => {
    const raw = normalizeUid(scanInputByJob[jobId] || '');
    if (!raw) return;

    const req = materialRequests.find((r) => r.id === jobId);
    if (!req || !Array.isArray(req.materialLines) || req.materialLines.length === 0) {
      setScanStatusByJob((prev) => ({ ...prev, [jobId]: { type: 'error', message: 'No material lines found for this job order' } }));
      return;
    }

    // Prevent duplicates across the whole job cart.
    const allScanned = new Set<string>();
    for (const ln of req.materialLines) {
      for (const uid of (scannedUidsByLine[ln.id] || [])) allScanned.add(uid);
    }
    if (allScanned.has(raw)) {
      setScanStatusByJob((prev) => ({ ...prev, [jobId]: { type: 'error', message: `UID already scanned: ${raw}` } }));
      setScanInputByJob((prev) => ({ ...prev, [jobId]: '' }));
      return;
    }

    setScanBusyJobId(jobId);
    try {
      const trace: any = await apiClient.get(`/uid/trace/${encodeURIComponent(raw)}`);
      const itemId = String(trace?.item?.id || '').trim();
      const itemCode = String(trace?.item?.code || '').trim();

      if (!itemId) {
        throw new Error('UID trace did not return item id');
      }

      const candidates = req.materialLines
        .filter((ln) => String(ln.item_id || '').trim() === itemId)
        .map((ln) => ({
          lineId: ln.id,
          pending: Number(ln.pending_quantity || 0),
          scanned: (scannedUidsByLine[ln.id] || []).length,
        }))
        .filter((c) => c.pending > 0);

      if (candidates.length === 0) {
        setScanStatusByJob((prev) => ({
          ...prev,
          [jobId]: {
            type: 'error',
            message: itemCode
              ? `Scanned UID belongs to ${itemCode}, but it is not pending in this SIV`
              : 'Scanned UID item is not pending in this SIV',
          },
        }));
        return;
      }

      // Pick first line that still needs more UIDs.
      const target = candidates.find((c) => c.scanned < c.pending) || candidates[0];
      if (target.scanned >= target.pending) {
        setScanStatusByJob((prev) => ({
          ...prev,
          [jobId]: { type: 'error', message: `Scanned UID exceeds pending quantity for ${itemCode || 'this item'}` },
        }));
        return;
      }

      addUidToLineCart(jobId, target.lineId, raw);
      setScanStatusByJob((prev) => ({
        ...prev,
        [jobId]: { type: 'ok', message: `Added ${raw} to ${itemCode || 'material line'}` },
      }));
      setScanInputByJob((prev) => ({ ...prev, [jobId]: '' }));
    } catch (err: any) {
      const msg = String(err?.response?.data?.message || err?.message || err);
      setScanStatusByJob((prev) => ({ ...prev, [jobId]: { type: 'error', message: msg } }));
    } finally {
      setScanBusyJobId(null);
    }
  }, [addUidToLineCart, materialRequests, normalizeUid, scanInputByJob, scannedUidsByLine]);

  const approveSivHistoryRow = useCallback(async (movementId: string) => {
    const confirmed = await confirmDialog({
      title: 'Approve SIV Entry',
      message: 'Approve this SIV history entry?',
      confirmLabel: 'Approve',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      await apiClient.put(`/job-orders/store/material-requisitions/history/${movementId}/approve`, {});
      await loadAll();
      await confirmDialog({
        title: 'SIV Entry Approved',
        message: 'The selected SIV history row has been approved.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
    } catch (err: any) {
      await confirmDialog({
        title: 'Approval Failed',
        message: 'Failed to approve: ' + (err.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
    }
  }, [loadAll]);

  const approveSivHistoryRows = useCallback(async (movementIds: string[], label = 'selected SIV entries') => {
    const ids = Array.from(new Set(movementIds.map((id) => String(id || '').trim()).filter(Boolean)));
    if (ids.length === 0) {
      await confirmDialog({
        title: 'Nothing To Approve',
        message: 'No pending SIV rows selected for approval.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'warning',
      });
      return;
    }

    const confirmed = await confirmDialog({
      title: 'Approve SIV Voucher',
      message: `Approve ${ids.length} pending row${ids.length === 1 ? '' : 's'} for ${label}?`,
      confirmLabel: 'Approve All',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      await putJsonViaApiProxy('/job-orders/store/material-requisitions/history/approve-bulk', {
        movementIds: ids,
      });
      await loadAll({ silent: true });
      setSelectedHistoryRowIds((prev) => prev.filter((id) => !ids.includes(id)));
      await confirmDialog({
        title: 'SIV Rows Approved',
        message: `Approved ${ids.length} SIV row${ids.length === 1 ? '' : 's'}.`,
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
    } catch (err: any) {
      await confirmDialog({
        title: 'Bulk Approval Failed',
        message: 'Failed to approve SIV rows: ' + (err.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
    }
  }, [loadAll]);

  const deleteSivHistoryRow = useCallback(async (movementId: string) => {
    const confirmedDel = await confirmDialog({
      title: 'Reverse SIV Entry',
      message: 'Reverse this SIV goods issue? Stock and UID movement will be reversed.',
      confirmLabel: 'Reverse',
      variant: 'danger',
    });
    if (!confirmedDel) return;
    try {
      await apiClient.delete(`/job-orders/store/material-requisitions/history/${movementId}`);
      await loadAll();
      await confirmDialog({
        title: 'SIV Reversed',
        message: 'SIV goods issue has been reversed and stock/UID movement has been adjusted.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
    } catch (err: any) {
      await confirmDialog({
        title: 'Reverse Failed',
        message: 'Failed to reverse: ' + (err.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
    }
  }, [loadAll]);

  const issueSelectedLines = useCallback(
    async (jobId: string) => {
      const req = materialRequests.find((r) => r.id === jobId);
      if (!req || !req.materialLines) return;
      const selectedLineIds = selectedLineIdsByJob[jobId] || [];
      if (!selectedLineIds.length) {
        await confirmDialog({
          title: 'Select Material Lines',
          message: 'Select at least one material line to issue.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'warning',
        });
        return;
      }
      setBusyJobId(jobId);
      try {
        // ── Pre-flight: block if any selected line is a sub-assembly with no stock ──
        try {
          const readiness = await apiClient.get<{
            ready: boolean;
            blockers: Array<{ itemCode: string; itemName: string; needed: number; available: number; pendingSubJoNumber: string | null }>;
          }>(`/job-orders/store/material-requisitions/${jobId}/readiness`);

          if (!readiness.ready && readiness.blockers.length > 0) {
            const lines = readiness.blockers.map((b) => {
              const jo = b.pendingSubJoNumber ? ` (JO: ${b.pendingSubJoNumber})` : '';
              return `- ${b.itemCode} - need ${b.needed}, have ${b.available}${jo}`;
            }).join('\n');
            await confirmDialog({
              title: 'Cannot Issue Materials Yet',
              message:
                `The following sub-assemblies are not yet manufactured:\n\n${lines}\n\n` +
                `Complete each sub-assembly Job Order in SRV/QC first, then return here to issue for this JO.`,
              confirmLabel: 'OK',
              cancelLabel: 'Close',
              variant: 'warning',
            });
            return;
          }
        } catch (readinessErr: any) {
          // Fail-safe: if readiness check throws an error, block the issue rather than allowing through
          const errMsg = String((readinessErr as any)?.response?.data?.message || (readinessErr as any)?.message || 'network error');
          await confirmDialog({
            title: 'Readiness Check Failed',
            message: `Sub-assembly readiness check failed (${errMsg}).\n\nIssue blocked - please refresh and try again.`,
            confirmLabel: 'OK',
            cancelLabel: 'Close',
            variant: 'danger',
          });
          setBusyJobId(null);
          return;
        }
        // ── End pre-flight ──

        const successLineIds: string[] = [];
        const failures: Array<{ lineId: string; itemCode?: string; message: string }> = [];

        for (const lineId of selectedLineIds) {
          const line = (req.materialLines || []).find((l) => l.id === lineId);
          if (!line) continue;

          const pending = Number((line as any).pending_quantity || 0);
          const uids = scannedUidsByLine[lineId] || [];

          // Smart defaults:
          // - If UIDs scanned => quantity = scanned count (backend requires exact match)
          // - Else if qty empty => quantity = pending
          // - Else => use entered qty
          const qtyStr = issueQtyByLine[lineId];
          const qtyParsed = Number(qtyStr);
          const issueQty = uids.length > 0
            ? uids.length
            : Number.isFinite(qtyParsed) && qtyParsed > 0
              ? qtyParsed
              : pending;
          const available = Number((line as any).available_quantity || 0);

          if (!Number.isFinite(issueQty) || issueQty <= 0) {
            continue;
          }

          if (uids.length === 0 && available <= 0) {
            failures.push({
              lineId,
              itemCode: (line as any)?.item_code,
              message: `No stock available to issue. Pending ${pending}.`,
            });
            continue;
          }

          try {
            await apiClient.post(`/job-orders/store/material-requisitions/${jobId}/issue-line`, {
              materialId: lineId,
              issueQuantity: issueQty,
              uids: uids.length > 0 ? uids : undefined,
            });
            successLineIds.push(lineId);
          } catch (err: any) {
            const message = formatApiErrorMessage(err);
            failures.push({ lineId, itemCode: (line as any)?.item_code, message });
          }
        }

        if (successLineIds.length > 0) {
          setIssueQtyByLine((prev) => {
            const next = { ...prev };
            for (const id of successLineIds) delete next[id];
            return next;
          });
          setScannedUidsByLine((prev) => {
            const next = { ...prev };
            for (const id of successLineIds) delete next[id];
            return next;
          });
        }

        setSelectedLineIdsByJob((prev) => {
          const current = prev[jobId] || [];
          const next = current.filter((id) => !successLineIds.includes(id));
          return { ...prev, [jobId]: next };
        });

        await loadAll();

        if (failures.length === 0) {
          await confirmDialog({
            title: 'Materials Issued',
            message: 'Selected material lines were issued successfully. Pending approvals can be reviewed in History.',
            confirmLabel: 'OK',
            cancelLabel: 'Close',
          });
        } else {
          const lines = failures
            .slice(0, 6)
            .map((f) => `${f.itemCode || f.lineId}: ${f.message}`)
            .join('\n');
          await confirmDialog({
            title: successLineIds.length > 0 ? 'SIV Partially Issued' : 'SIV Issue Failed',
            message:
              `Issued: ${successLineIds.length}\nFailed: ${failures.length}\n\n` +
              `${lines}${failures.length > 6 ? '\n...' : ''}`,
            confirmLabel: 'OK',
            cancelLabel: 'Close',
            variant: successLineIds.length > 0 ? 'warning' : 'danger',
          });
        }
      } catch (err: any) {
        const msg = formatApiErrorMessage(err);
        await confirmDialog({
          title: 'Issue Failed',
          message: 'Failed to issue materials: ' + msg,
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'danger',
        });
      } finally {
        setBusyJobId(null);
      }
    },
    [formatApiErrorMessage, issueQtyByLine, loadAll, materialRequests, scannedUidsByLine, selectedLineIdsByJob]
  );

  const toggleSelectAllLines = (jobId: string, lineIds: string[], nextChecked: boolean) => {
    setSelectedLineIdsByJob((prev) => ({
      ...prev,
      [jobId]: nextChecked ? Array.from(new Set(lineIds)) : [],
    }));
  };

  const printSiv = useCallback(
    async (jobId: string) => {
      const req = materialRequests.find((r) => r.id === jobId);
      if (!req) return;
      const selectedLineIds = selectedLineIdsByJob[jobId] || [];
      const lines = (req.materialLines || []).filter((ln) => selectedLineIds.includes(ln.id));
      if (!lines.length) {
        await confirmDialog({
          title: 'Select Lines To Print',
          message: 'Select one or more material lines before printing the SIV.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'warning',
        });
        return;
      }
      const _now1 = new Date(); const now = `${_now1.getDate().toString().padStart(2,'0')}/${(_now1.getMonth()+1).toString().padStart(2,'0')}/${_now1.getFullYear()} ${_now1.getHours().toString().padStart(2,'0')}:${_now1.getMinutes().toString().padStart(2,'0')}`;
      const issuedBy = currentUserDisplayName;
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        await confirmDialog({
          title: 'Popup Blocked',
          message: 'Please allow popups for this site to print the SIV.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'warning',
        });
        return;
      }

      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const linesHtml = lines
        .map((ln) => {
          const requiredQty = Number(ln.required_quantity || 0);
          const issuedQty = Number(ln.issued_quantity || 0);
          const issueQtyToPrint = issuedQty > 0 ? issuedQty : requiredQty;

          // Priority 1: UIDs scanned in current session (not yet issued or just issued)
          const sessionUids: string[] = (scannedUidsByLine[ln.id] || []).filter(Boolean);

          // Priority 2: UIDs from issue history (for already-issued lines)
          const historyUids: string[] = sivHistory
            .filter((h) => h.item_code === ln.item_code && h.job_order_id === jobId)
            .map((h) => h.uid)
            .filter(Boolean) as string[];

          const allUids = sessionUids.length > 0 ? sessionUids : historyUids;

          const uidsCell = allUids.length > 0
            ? allUids.map((uid) => `<div style="font-family:monospace; font-size:11px; font-weight:600; margin-bottom:2px;">${escapeHtml(uid)}</div>`).join('')
            : '<span style="color:#999; font-size:10px;">-</span>';

          return `
            <tr>
              <td style="border:1px solid #333; padding:5px; vertical-align:top; white-space:nowrap;">${escapeHtml(ln.item_code || '')}</td>
              <td style="border:1px solid #333; padding:5px; vertical-align:top;">${escapeHtml(ln.item_name || '')}</td>
              <td style="border:1px solid #333; padding:5px; text-align:center; vertical-align:top;">${requiredQty}</td>
              <td style="border:1px solid #333; padding:5px; text-align:center; vertical-align:top;">${issueQtyToPrint}</td>
              <td style="border:1px solid #333; padding:5px; vertical-align:top;">${uidsCell}</td>
            </tr>
          `;
        })
        .join('');
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>SIV - ${escapeHtml(req.job_order_number || jobId)}</title>
        <script>window.onload = function() { window.print(); }</script>
        <style>
          @page { margin: 0.5cm; }
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; color: #111; }
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
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th { border:1px solid #333; padding:6px; text-align: left; background:#f0f0f0; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }
          td { border:1px solid #333; padding:5px; text-align: left; }
          .header { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
          .subheader { font-size: 12px; color: #555; margin-bottom: 12px; }
          .meta { display:flex; gap:40px; margin-bottom:12px; }
          .meta-item { }
          .meta-label { font-size:10px; color:#777; text-transform:uppercase; letter-spacing:0.5px; }
          .meta-value { font-size:13px; font-weight:600; }
          .signatures { display:flex; gap:20px; margin-top:36px; }
          .sig-box { flex:1; border:1px solid #333; padding:8px 12px; min-height:48px; }
          .sig-name { font-size:12px; font-weight:600; margin-top:18px; }
          .sig-label { font-size:10px; color:#555; margin-top:6px; }
          @media print { body { margin: 8px; } }
        </style>
        </head>
        <body>
          ${renderStandardLetterheadHtml(branding, now)}
          <div class="header">Store Issue Voucher (SIV)</div>
          <div class="subheader">Issued materials against the selected production lines</div>
          <div class="meta">
            <div class="meta-item">
              <div class="meta-label">Job Order</div>
              <div class="meta-value">${escapeHtml(req.job_order_number || jobId)}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">Product</div>
              <div class="meta-value">${escapeHtml(req.item_code || '')} - ${escapeHtml(req.item_name || '')}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">Printed By</div>
              <div class="meta-value">${escapeHtml(issuedBy)}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:18%">Item Code</th>
                <th>Item / Description</th>
                <th style="width:9%; text-align:center;">Req. Qty</th>
                <th style="width:9%; text-align:center;">Issue Qty</th>
                <th style="width:26%">Serial / UID Numbers</th>
              </tr>
            </thead>
            <tbody>${linesHtml}</tbody>
          </table>
          <div class="signatures">
            <div class="sig-box"><div class="sig-label">Issued By (Stores)</div></div>
            <div class="sig-box"><div class="sig-label">Received By (Production)</div></div>
          </div>
        </body>
        </html>
      `;

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
    },
    [currentUserDisplayName, materialRequests, selectedLineIdsByJob, sivHistory, scannedUidsByLine]
  );

  const printSivHistory = useCallback(
    async (joId: string, rows: SivHistoryRow[]) => {
      const joNumber = rows[0]?.job_order_number || joId;

      // Open window FIRST (synchronously, before any await) to avoid popup blockers
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        await confirmDialog({
          title: 'Popup Blocked',
          message: 'Please allow popups for this site and try again.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          variant: 'warning',
        });
        return;
      }
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);
      const _now2 = new Date(); const now = `${_now2.getDate().toString().padStart(2,'0')}/${(_now2.getMonth()+1).toString().padStart(2,'0')}/${_now2.getFullYear()} ${_now2.getHours().toString().padStart(2,'0')}:${_now2.getMinutes().toString().padStart(2,'0')}`;

      // Group lines by item to consolidate UIDs per item
      const itemMap = new Map<string, { code: string; name: string; qty: number; uids: string[] }>();
      for (const row of rows) {
        const key = row.item_code || row.item_id || row.id;
        if (!itemMap.has(key)) {
          itemMap.set(key, { code: row.item_code || '', name: row.item_name || '', qty: 0, uids: [] });
        }
        const entry = itemMap.get(key)!;
        entry.qty += Number(row.quantity || 0);
        if (row.uid) entry.uids.push(row.uid);
      }

      const linesHtml = Array.from(itemMap.values()).map((item, idx) => {
        const uidsCell = item.uids.length > 0
          ? item.uids.map((u) => `<div style="font-family:monospace;font-size:11px;font-weight:600;margin-bottom:2px;">${escapeHtml(u)}</div>`).join('')
          : '<span style="color:#999;font-size:10px;">-</span>';
        return `
          <tr>
            <td style="border:1px solid #333;padding:5px;text-align:center;vertical-align:top;">${idx + 1}</td>
            <td style="border:1px solid #333;padding:5px;vertical-align:top;white-space:nowrap;">${escapeHtml(item.code)}</td>
            <td style="border:1px solid #333;padding:5px;vertical-align:top;">${escapeHtml(item.name)}</td>
            <td style="border:1px solid #333;padding:5px;text-align:center;vertical-align:top;">${item.qty}</td>
            <td style="border:1px solid #333;padding:5px;vertical-align:top;">${uidsCell}</td>
          </tr>`;
      }).join('');

      const issuedDate = rows
        .map((r) => r.movement_date)
        .filter(Boolean)
        .sort()
        .at(-1);
      const issuedDateFmt = issuedDate
        ? new Date(issuedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '-';
      const issuedToEmployees = Array.from(new Set(rows
        .map((row) => [row.issued_to_employee_code, row.issued_to_employee_name].filter(Boolean).join(' - '))
        .filter(Boolean)));
      const issuedToLabel = issuedToEmployees.join(', ') || 'Not recorded (legacy SIV)';

      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>SIV - ${escapeHtml(joNumber)}</title>
        <script>setTimeout(function() { window.print(); }, 500);<\/script>
        <style>
          @page { margin: 0.5cm; }
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; color: #111; }
          .letterhead { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1e3a8a; padding-bottom:12px; margin-bottom:16px; }
          .logo-section { display:flex; align-items:center; gap:12px; }
          .logo-box { width:52px;height:52px;background:#1e3a8a;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;border-radius:8px; }
          .logo { width:52px;height:52px;object-fit:contain;border-radius:8px; }
          .company-name { font-size:18px;font-weight:700;margin:0;color:#1e3a8a; }
          .company-meta { font-size:10.5pt;margin:2px 0 0 0;color:#111; }
          .generated-on { text-align:right;font-size:10.5pt;color:#1e3a8a;line-height:1.5; }
          .generated-on-label { font-weight:700;text-transform:uppercase;letter-spacing:0.06em; }
          .generated-on-value { font-weight:700;color:#111827; }
          .doc-title { font-size:18px;font-weight:bold;margin:0 0 4px 0; }
          .doc-sub { font-size:12px;color:#555;margin-bottom:14px; }
          .meta { display:flex;gap:40px;flex-wrap:wrap;margin-bottom:14px; }
          .meta-label { font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.5px; }
          .meta-value { font-size:13px;font-weight:600; }
          table { width:100%;border-collapse:collapse;margin-top:12px; }
          th { border:1px solid #333;padding:6px;text-align:left;background:#f0f0f0;font-size:11px;text-transform:uppercase;letter-spacing:0.5px; }
          td { border:1px solid #333;padding:5px;text-align:left; }
          .signatures { display:flex;gap:20px;margin-top:36px; }
          .sig-box { flex:1;border:1px solid #333;padding:8px 12px;min-height:48px; }
          .sig-label { font-size:10px;color:#555;margin-top:6px; }
          @media print { body { margin:8px; } }
        </style>
        </head>
        <body>
          ${renderStandardLetterheadHtml(branding, now)}
          <div class="doc-title">Store Issue Voucher (SIV)</div>
          <div class="doc-sub">Issued materials to production</div>
          <div class="meta">
            <div><div class="meta-label">Job Order</div><div class="meta-value">${escapeHtml(joNumber)}</div></div>
            <div><div class="meta-label">Issue Date</div><div class="meta-value">${escapeHtml(issuedDateFmt)}</div></div>
            <div><div class="meta-label">Issued To Employee</div><div class="meta-value">${escapeHtml(issuedToLabel)}</div></div>
            <div><div class="meta-label">Total Lines</div><div class="meta-value">${itemMap.size}</div></div>
            <div><div class="meta-label">Printed By</div><div class="meta-value">${escapeHtml(currentUserDisplayName)}</div></div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:5%;text-align:center;">#</th>
                <th style="width:18%;">Item Code</th>
                <th>Item / Description</th>
                <th style="width:9%;text-align:center;">Qty Issued</th>
                <th style="width:26%;">Serial / UID Numbers</th>
              </tr>
            </thead>
            <tbody>${linesHtml}</tbody>
          </table>
          <div class="signatures">
            <div class="sig-box"><div class="sig-label">Issued By (Stores)</div></div>
            <div class="sig-box"><div class="sig-label">Received By: ${escapeHtml(issuedToLabel)}</div></div>
          </div>
        </body>
        </html>`;

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
    },
    [currentUserDisplayName]
  );

  const toggleLineSelection = (jobId: string, lineId: string) => {
    setSelectedLineIdsByJob((prev) => {
      const current = prev[jobId] || [];
      if (current.includes(lineId)) {
        return { ...prev, [jobId]: current.filter((id) => id !== lineId) };
      } else {
        return { ...prev, [jobId]: [...current, lineId] };
      }
    });
  };

  const assignMaterialRequest = async (reqId: string, userId: string) => {
    try {
      await apiClient.put(`/job-orders/store/material-requisitions/${reqId}/assign`, {
        assignedTo: userId || null,
      });
      // Refresh the list
      await loadAll({ silent: true });
    } catch (err: any) {
      await confirmDialog({
        title: 'Assignment Failed',
        message: 'Failed to assign: ' + (err.message || err),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
        variant: 'danger',
      });
    }
  };

  // Display only JOs that still have pending lines to issue. The full materialRequests list
  // (including JOs with pendingLines=0) is kept for sub-JO matching.
  // Also filter by assigned user if filter is set.
  const openMaterialReqs = materialRequests.filter((r) => {
    const hasPending = (r.pendingLines || 0) > 0;
    if (!hasPending) return false;
    if (!filterAssignedTo) return true;
    if (filterAssignedTo === 'unassigned') return !r.assigned_to;
    return r.assigned_to === filterAssignedTo;
  });
  const pendingLineCount = openMaterialReqs.reduce((sum, req) => sum + Number(req.pendingLines || 0), 0);
  const readyLineCount = openMaterialReqs.reduce(
    (sum, req) =>
      sum +
      (req.materialLines || []).filter(
        (line) =>
          Number(line.pending_quantity || 0) > 0 &&
          Number(line.available_quantity || 0) + 1e-9 >= Number(line.pending_quantity || 0),
      ).length,
    0,
  );
  const approvedHistoryCount = sivHistory.filter((row) => row.approved_by).length;
  const awaitingApprovalCount = sivHistory.length - approvedHistoryCount;
  const pendingHistoryRowIds = sivHistory.filter((row) => !row.approved_by).map((row) => row.id);
  const selectedPendingHistoryRowIds = pendingHistoryRowIds.filter((id) => selectedHistoryRowIds.includes(id));
  const blockedLineCount = openMaterialReqs.reduce(
    (sum, req) =>
      sum +
      (req.materialLines || []).filter(
        (line) => Number(line.pending_quantity || 0) > 0 && Number(line.available_quantity || 0) <= 0 && !itemRequiresUid(line.item_id),
      ).length,
    0,
  );
  const getLineStockStatus = (line: MaterialLine) => {
    const pending = Number(line.pending_quantity || 0);
    const available = Number(line.available_quantity || 0);
    if (pending <= 0) return { label: 'Complete', tone: 'success' as const };
    if (available >= pending) return { label: 'Ready to Post', tone: 'success' as const };
    if (available > 0) return { label: 'Partial Stock', tone: 'warning' as const };
    if (itemRequiresUid(line.item_id)) return { label: 'UID Required', tone: 'info' as const };
    return { label: 'Blocked', tone: 'danger' as const };
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[#FAF9F6]" />;
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-4 text-[#2F241D] lg:px-6">
      <div className="flex min-h-[calc(100vh-2rem)] flex-col gap-4">
        <ErpPageHeader
          eyebrow="Inventory"
          title="Store Issue Voucher"
          description="Issue materials to production, scan UID-controlled stock, approve issue rows, and print SIV documents."
          actions={
            <ErpButton
              variant="secondary"
              onClick={() => {
                void loadAll();
              }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </ErpButton>
          }
        />

        <ErpMetricStrip
          loading={loading}
          metrics={[
            { label: 'Open Jobs', value: openMaterialReqs.length, tone: 'warning' },
            { label: 'Pending Lines', value: pendingLineCount, tone: 'warning' },
            { label: 'Ready Lines', value: readyLineCount, tone: 'success' },
            { label: 'Blocked Lines', value: blockedLineCount, tone: blockedLineCount > 0 ? 'danger' : 'success' },
            { label: 'SIV History', value: sivHistory.length },
            { label: 'Awaiting Approval', value: awaitingApprovalCount, tone: awaitingApprovalCount > 0 ? 'warning' : 'success' },
          ]}
        />

        <div className="grid gap-3 lg:grid-cols-4">
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">Movement Type</div>
            <div className="mt-1 text-lg font-bold text-[#4A3426]">261</div>
            <div className="text-xs text-[#7A6555]">Goods issue to production order</div>
          </div>
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">Document Flow</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#4A3426]">
              <GitBranch className="h-4 w-4 text-[#8B6F47]" />
              Job Order {'>'} Reservation {'>'} SIV
            </div>
            <div className="text-xs text-[#7A6555]">Open requests are tied to production demand</div>
          </div>
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">Posting Control</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#4A3426]">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              Stock posts on issue
            </div>
            <div className="text-xs text-[#7A6555]">Approval remains separate from stock movement</div>
          </div>
          <div className="rounded-md border border-[#E8DCC4] bg-white p-3">
            <div className="text-xs font-semibold uppercase text-[#7A6555]">Exception Queue</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#4A3426]">
              <AlertTriangle className={`h-4 w-4 ${blockedLineCount > 0 ? 'text-red-700' : 'text-emerald-700'}`} />
              {blockedLineCount} blocked line{blockedLineCount === 1 ? '' : 's'}
            </div>
            <div className="text-xs text-[#7A6555]">Stock shortage and UID gaps are stopped before issue</div>
          </div>
        </div>

        <div className="rounded-md border border-[#E8DCC4] bg-white">
          <div className="flex flex-col gap-3 border-b border-[#E8DCC4] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => switchSivView('open')}
                className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
                  activeSivView === 'open'
                    ? 'border-[#8B6F47] bg-[#8B6F47] text-white'
                    : 'border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]'
                }`}
              >
                <PackageCheck className="h-4 w-4" />
                Open Requests ({openMaterialReqs.length})
              </button>
              <button
                type="button"
                onClick={() => switchSivView('history')}
                className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
                  activeSivView === 'history'
                    ? 'border-[#8B6F47] bg-[#8B6F47] text-white'
                    : 'border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]'
                }`}
              >
                <History className="h-4 w-4" />
                History ({sivHistory.length})
              </button>
            </div>
            {activeSivView === 'open' && (
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center">
                <label className="text-xs font-semibold uppercase text-[#7A6555]">Assigned</label>
                <select
                  value={filterAssignedTo}
                  onChange={(e) => setFilterAssignedTo(e.target.value)}
                  className="min-h-9 w-full rounded-md border border-[#D8C8AA] bg-white px-3 py-1.5 text-sm text-[#2F241D] focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30 sm:w-56"
                >
                  <option value="">All Users</option>
                  <option value={(currentUser as any)?.id}>Assigned to Me</option>
                  <option value="unassigned">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName}</option>
                  ))}
                </select>
              </div>
            )}
            {activeSivView === 'history' && canApprove && pendingHistoryRowIds.length > 0 && (
              <button
                type="button"
                onClick={() => void approveSivHistoryRows(
                  selectedPendingHistoryRowIds.length > 0 ? selectedPendingHistoryRowIds : pendingHistoryRowIds,
                  selectedPendingHistoryRowIds.length > 0 ? 'selected SIV entries' : 'all pending SIV entries',
                )}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                <Check className="h-4 w-4" />
                {selectedPendingHistoryRowIds.length > 0
                  ? `Approve Selected (${selectedPendingHistoryRowIds.length})`
                  : `Approve All Pending (${pendingHistoryRowIds.length})`}
              </button>
            )}
          </div>
        </div>

        {activeSivView === 'open' && (
          <div className="min-h-0 flex-1 space-y-4">
            <div className="rounded-md border border-[#E8DCC4] bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#4A3426]">Manual Issue</h2>
                  <p className="mt-0.5 text-xs text-[#7A6555]">Issue material directly when no production job order is available.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="xl:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Item</label>
                  <SearchableSelect
                    options={inventoryItems.map((item) => ({
                      value: item.id,
                      label: [item.code, item.name].filter(Boolean).join(' - ') || item.id,
                      subtitle: [item.category, item.type].filter(Boolean).join(' | ') || undefined,
                    }))}
                    value={manualIssueItemId}
                    onChange={(value) => setManualIssueItemId(value)}
                    placeholder={inventoryItems.length > 0 ? 'Search item by code or name...' : 'No items available'}
                    truncateInput={false}
                    disabled={inventoryItems.length === 0}
                  />
                  <p className="mt-1 text-xs text-[#7A6555]">Search by item code or item name.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Issued To Employee *</label>
                  <SearchableSelect
                    options={storeIssueEmployees.map((employee) => ({
                      value: employee.id,
                      label: [employee.employeeCode, employee.employeeName].filter(Boolean).join(' - '),
                      subtitle: [employee.department, employee.designation].filter(Boolean).join(' | ') || undefined,
                    }))}
                    value={manualIssuedToEmployeeId}
                    onChange={setManualIssuedToEmployeeId}
                    placeholder={storeIssueEmployees.length > 0 ? 'Search active employee...' : 'No active employees available'}
                    truncateInput={false}
                    disabled={storeIssueEmployees.length === 0}
                  />
                  <p className="mt-1 text-xs text-[#7A6555]">Required for physical custody and SIV audit tracking.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Issue Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={manualIssueQty}
                    onChange={(e) => setManualIssueQty(e.target.value)}
                    className="min-h-10 w-full rounded-md border border-[#D8C8AA] px-3 py-2 focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                  />
                </div>
                {itemRequiresUid(manualIssueItemId) && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Manual UID Scan</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualIssueUidInput}
                        onChange={(e) => setManualIssueUidInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addManualIssueUid();
                          }
                        }}
                        className="min-h-10 flex-1 rounded-md border border-[#D8C8AA] px-3 py-2 text-sm focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                        placeholder="Scan UID and press Enter"
                      />
                      <button
                        type="button"
                        onClick={addManualIssueUid}
                        className="inline-flex min-h-10 items-center rounded-md border border-[#8B6F47] bg-[#8B6F47] px-3 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                        title="Add scanned UID"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const item = inventoryItems.find((row) => row.id === manualIssueItemId);
                          if (item) {
                            openUidPicker('manual-draft', item.id, item.code || '', Number(manualIssueQty || 0));
                          }
                        }}
                        className="inline-flex min-h-10 items-center rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                        title="Pick UIDs from Inventory"
                      >
                        Pick UID
                      </button>
                    </div>
                    {manualIssueUids.length > 0 ? (
                      <div className="mt-2 text-xs text-gray-700">
                        <span className="font-medium">{manualIssueUids.length} UID(s) selected:</span> {manualIssueUids.join(', ')}{' '}
                        <button
                          type="button"
                          onClick={() => setManualIssueUids([])}
                          className="ml-2 text-red-600 hover:underline"
                        >
                          Clear All
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-gray-500">
                        Tip: Scan UIDs manually or click "Pick UID" to select from available inventory.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Notes</label>
                <textarea
                  value={manualIssueNotes}
                  onChange={(e) => setManualIssueNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-[#D8C8AA] px-3 py-2 focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                  placeholder="Reason / purpose / remarks"
                />
              </div>
              {(manualIssueLines.length > 0 || manualIssueItemId) && (
                <div className="mt-4 rounded-md border border-[#E8DCC4] bg-[#FFFCF5] p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[#4A3426]">Manual SIV Items</h3>
                      <p className="mt-0.5 text-xs text-[#7A6555]">Add multiple items before creating the issue entries.</p>
                    </div>
                    <ErpButton type="button" variant="secondary" size="sm" onClick={addManualIssueLine} disabled={!canCreate || manualIssueBusy}>
                      <Plus className="h-4 w-4" />
                      Add Item
                    </ErpButton>
                  </div>
                  <div className="mt-3 space-y-2">
                    {manualIssueLines.map((line, index) => (
                      <div key={line.id} className="flex flex-col gap-2 rounded-md border border-[#E8DCC4] bg-white p-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="font-medium text-[#36454F]">{index + 1}. {[line.itemCode, line.itemName].filter(Boolean).join(' - ') || line.itemId}</div>
                          <div className="text-sm text-gray-700 mt-1">Qty: {line.issueQuantity}</div>
                          {line.uids.length > 0 && <div className="text-xs text-gray-600 mt-1">UIDs: {line.uids.join(', ')}</div>}
                          {line.notes && <div className="text-xs text-gray-600 mt-1">Notes: {line.notes}</div>}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeManualIssueLine(line.id)}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {manualIssueItemId && (
                      <div className="rounded-md border border-dashed border-[#D8C8AA] p-3 text-sm text-[#7A6555]">
                        Current draft item is ready to add.
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                {manualIssueLines.length > 0 && (
                  <ErpButton
                    type="button"
                    onClick={() => setManualIssueLines([])}
                    disabled={manualIssueBusy}
                  >
                    Clear Items
                  </ErpButton>
                )}
                <ErpButton
                  type="button"
                  variant="primary"
                  onClick={() => void handleManualIssue()}
                  disabled={!canCreate || manualIssueBusy}
                >
                  {manualIssueBusy ? 'Creating...' : 'Create Manual SIV'}
                </ErpButton>
              </div>
            </div>

            {openMaterialReqs.length === 0 && (
              <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center">
                <p className="text-[#7A6555]">No pending material requests.</p>
              </div>
            )}
            {openMaterialReqs.map((req) => {
              const selectedLineIds = selectedLineIdsByJob[req.id] || [];
              const expanded = selectedMaterialJobId === req.id;
              const hasUidLines = (req.materialLines || []).some(
                (line) => itemRequiresUid(line.item_id) && Number(line.pending_quantity || 0) > 0,
              );
              return (
                <div
                  key={req.id}
                  id={`siv-job-${req.id}`}
                  className="rounded-md border border-[#E8DCC4] bg-white p-4"
                >
                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-bold text-[#4A3426]">
                        {req.job_order_number || req.id}
                      </h3>
                        <ErpStatusBadge status={req.status || 'OPEN'} label={req.status || 'OPEN'} />
                      </div>
                      <p className="mt-0.5 truncate text-sm text-[#5E4635]">
                        {req.item_code} - {req.item_name}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase text-[#7A6555]">Assigned</span>
                        <select
                          value={req.assigned_to || ''}
                          onChange={(e) => assignMaterialRequest(req.id, e.target.value)}
                          className="min-h-8 rounded-md border border-[#D8C8AA] bg-white px-2 py-1 text-sm focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                        >
                          <option value="">-- Unassigned --</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>{u.displayName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-[#E8DCC4] bg-[#FAF9F6] px-2 py-1 text-[#5E4635]">Required {req.requiredQuantity || 0}</span>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">Issued {req.issuedQuantity || 0}</span>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">Pending {req.pendingQuantity || 0}</span>
                        {(() => {
                          const readyCount = (req.materialLines || []).filter((line) => Number(line.pending_quantity || 0) > 0 && Number(line.available_quantity || 0) + 1e-9 >= Number(line.pending_quantity || 0)).length;
                          return readyCount > 0 ? (
                            <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-emerald-700">Ready {readyCount}</span>
                          ) : null;
                        })()}
                      </div>
                      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
                        <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                          <div className="font-semibold uppercase text-[#7A6555]">Reference</div>
                          <div className="mt-1 font-medium text-[#4A3426]">JO / Reservation</div>
                        </div>
                        <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                          <div className="font-semibold uppercase text-[#7A6555]">Movement</div>
                          <div className="mt-1 font-medium text-[#4A3426]">261 Goods Issue</div>
                        </div>
                        <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                          <div className="font-semibold uppercase text-[#7A6555]">Stock Check</div>
                          <div className="mt-1 font-medium text-[#4A3426]">
                            {(() => {
                              const blocked = (req.materialLines || []).filter((line) => {
                                const status = getLineStockStatus(line);
                                return status.label === 'Blocked';
                              }).length;
                              return blocked > 0 ? `${blocked} blocked` : 'Ready controlled';
                            })()}
                          </div>
                        </div>
                        <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                          <div className="font-semibold uppercase text-[#7A6555]">Approval Gate</div>
                          <div className="mt-1 font-medium text-[#4A3426]">Manager approval after issue</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ErpButton
                        onClick={() => setSelectedMaterialJobId(expanded ? null : req.id)}
                        size="sm"
                      >
                        {expanded ? 'Collapse' : 'Expand'}
                      </ErpButton>
                      {selectedLineIds.length > 0 && (
                        <>
                          <ErpButton
                            onClick={() => printSiv(req.id)}
                            variant="secondary"
                            size="sm"
                          >
                            <Printer className="h-4 w-4" />
                            Print
                          </ErpButton>
                          {canCreate && (
                          <ErpButton
                            onClick={() => issueSelectedLines(req.id)}
                            disabled={busyJobId === req.id}
                            variant="primary"
                            size="sm"
                          >
                            {busyJobId === req.id ? 'Issuing...' : 'Issue Selected'}
                          </ErpButton>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {expanded && req.materialLines && req.materialLines.length > 0 && (
                    <div className="mt-3 overflow-x-auto rounded-md border border-[#E8DCC4]">
                      {hasUidLines && (
                      <div className="mb-3 flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-semibold text-[#4A3426]">Scan UIDs</div>
                          <input
                            type="text"
                            value={scanInputByJob[req.id] || ''}
                            onChange={(e) => setScanInputByJob((prev) => ({ ...prev, [req.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void scanUidForJob(req.id);
                              }
                            }}
                            disabled={scanBusyJobId === req.id}
                            className="min-h-9 w-72 rounded-md border border-[#D8C8AA] px-3 py-2 text-sm focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30 disabled:opacity-50"
                            placeholder="Scan UID and press Enter"
                          />
                          <button
                            type="button"
                            onClick={() => void scanUidForJob(req.id)}
                            disabled={scanBusyJobId === req.id}
                            className="inline-flex min-h-9 items-center rounded-md border border-[#8B6F47] bg-[#8B6F47] px-3 text-sm font-semibold text-white hover:bg-[#6F4E37] disabled:opacity-50"
                          >
                            {scanBusyJobId === req.id ? 'Scanning...' : 'Add'}
                          </button>
                        </div>
                        {scanStatusByJob[req.id]?.message && (
                          <div
                            className={
                              scanStatusByJob[req.id]?.type === 'ok'
                                ? 'text-xs text-green-700'
                                : 'text-xs text-red-700'
                            }
                          >
                            {scanStatusByJob[req.id]?.message}
                          </div>
                        )}
                      </div>
                      )}
                      <table className="min-w-full divide-y divide-[#E8DCC4]">
                        <thead className="bg-[#F5EFE3]">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const selectable = (req.materialLines || [])
                                    .filter((l) => Number(l.pending_quantity || 0) > 0)
                                    .filter((l) => Number(l.available_quantity || 0) > 0)
                                    .map((l) => l.id);
                                  const allSelected = selectable.length > 0 && selectable.every((id) => selectedLineIds.includes(id));
                                  return (
                                    <input
                                      type="checkbox"
                                      checked={allSelected}
                                      onChange={(e) => toggleSelectAllLines(req.id, selectable, e.target.checked)}
                                      className="w-4 h-4 rounded border-gray-300 text-[#8B6F47] focus:ring-[#8B6F47]"
                                      title="Select all pending lines"
                                    />
                                  );
                                })()}
                                <span>Select</span>
                              </div>
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              Item
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              Required
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              Issued
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              Pending
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              Stock Status
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              Movement
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                              Issue Qty
                            </th>
                            {hasUidLines && (
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">
                                Scan UID
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {req.materialLines.map((ln) => {
                            const isSelected = selectedLineIds.includes(ln.id);
                            const scannedUids = scannedUidsByLine[ln.id] || [];
                            const pending = Number(ln.pending_quantity || 0);
                            const available = Number(ln.available_quantity || 0);
                            const isSubassembly = isSubassemblyItem(ln.item_id);
                            const requiresUid = itemRequiresUid(ln.item_id);
                            // If sufficient stock on hand, issue directly - no need to expand BOM
                            const hasSufficientStock = pending > 0 && available >= pending;
                            const hasNoStock = pending > 0 && available <= 0;
                            const hasPartialStock = pending > 0 && available > 0 && available < pending;
                            // Show BOM only when there are still items pending AND stock is insufficient.
                            // When pending=0 (fully issued), do NOT show BOM even though hasSufficientStock=false.
                            const needsBom = isSubassembly && pending > 0 && available < pending;
                            const disableRow = pending <= 0 || (hasNoStock && !requiresUid);
                            const stockStatus = getLineStockStatus(ln);
                            return (
                              <Fragment key={ln.id}>
                              <tr className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleLineSelection(req.id, ln.id)}
                                    disabled={disableRow}
                                    className="w-4 h-4 rounded border-gray-300 text-[#8B6F47] focus:ring-[#8B6F47] disabled:opacity-50"
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-start gap-1.5">
                                    {ln.item_id && needsBom && (
                                      <button
                                        onClick={() => fetchLineBom(ln.id, ln.item_id!)}
                                        className="mt-0.5 text-[#8B6F47] hover:text-[#6F4E37] flex-shrink-0 text-xs leading-none"
                                        title="View sub-assembly BOM components"
                                      >
                                        {expandedLineIds[ln.id] ? '▼' : '▶'}
                                      </button>
                                    )}
                                    <div>
                                      <div className="font-medium text-gray-900">{ln.item_code}</div>
                                      <div className="text-sm text-gray-600">{ln.item_name}</div>
                                      {hasSufficientStock && (
                                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                                          OK In Stock ({available})
                                        </span>
                                      )}
                                      {hasPartialStock && (
                                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                                          Partial Stock ({available})
                                        </span>
                                      )}
                                      {hasNoStock && !requiresUid && (
                                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                                          No Stock
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-gray-700">{ln.required_quantity || 0}</td>
                                <td className="px-4 py-3 text-gray-700">{ln.issued_quantity || 0}</td>
                                <td className="px-4 py-3 text-[#8B6F47] font-medium">{pending}</td>
                                <td className="px-4 py-3">
                                  <ErpStatusBadge
                                    status={stockStatus.label}
                                    label={stockStatus.label}
                                    tone={stockStatus.tone}
                                  />
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700">
                                  <div className="font-medium text-[#4A3426]">261</div>
                                  <div className="text-xs text-gray-500">Issue to production</div>
                                </td>
                                <td className="px-4 py-3">
                                  {!disableRow && (
                                    <input
                                      type="number"
                                      value={scannedUids.length > 0 ? String(scannedUids.length) : (issueQtyByLine[ln.id] || '')}
                                      onChange={(e) =>
                                        setIssueQtyByLine((prev) => ({
                                          ...prev,
                                          [ln.id]: e.target.value,
                                        }))
                                      }
                                      disabled={scannedUids.length > 0}
                                      className="w-24 border-2 border-[#8B6F47]/30 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#8B6F47] focus:border-transparent disabled:bg-gray-100"
                                      placeholder={pending > 0 ? String(pending) : '0'}
                                    />
                                  )}
                                </td>
                                {hasUidLines && (
                                <td className="px-4 py-3">
                                  {isSelected && requiresUid && (
                                    <div className="space-y-2">
                                      <div className="flex gap-2">
                                        <input
                                          type="text"
                                          value={uidInputByLine[ln.id] || ''}
                                          onChange={(e) =>
                                            setUidInputByLine((prev) => ({
                                              ...prev,
                                              [ln.id]: e.target.value,
                                            }))
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              addScannedUid(req.id, ln.id);
                                            }
                                          }}
                                          className="w-40 border-2 border-[#8B6F47]/30 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#8B6F47] focus:border-transparent"
                                          placeholder="Scan UID"
                                        />
                                        <button
                                          onClick={() => addScannedUid(req.id, ln.id)}
                                          className="px-3 py-2 bg-[#8B6F47] text-white rounded-lg hover:bg-[#6F4E37] text-sm font-medium shadow-sm"
                                        >
                                          +
                                        </button>
                                        {ln.item_id && (
                                          <button
                                            onClick={() => openUidPicker(ln.id, ln.item_id!, ln.item_code || '', Number(issueQtyByLine[ln.id]) || Number(ln.pending_quantity) || 1)}
                                            className="px-3 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 text-sm font-medium shadow-sm"
                                            title="Pick UIDs from available stock"
                                          >
                                            <ClipboardList className="h-4 w-4" />
                                          </button>
                                        )}
                                      </div>
                                      {scannedUids.length > 0 && (
                                        <div className="text-xs text-gray-700">
                                          UIDs: {scannedUids.join(', ')}{' '}
                                          <button
                                            onClick={() => clearScannedUids(ln.id)}
                                            className="ml-2 text-red-600 hover:underline"
                                          >
                                            Clear
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                                )}
                              </tr>
                              {expandedLineIds[ln.id] && needsBom && (
                                <tr className="bg-sky-50/70">
                                  <td colSpan={hasUidLines ? 9 : 8} className="px-10 py-3">
                                    {lineBomLoading[ln.id] ? (
                                      <div className="text-sm text-gray-500 italic py-2">Loading BOM components...</div>
                                    ) : !lineBomData[ln.id] || lineBomData[ln.id].length === 0 ? (
                                      <div className="text-sm text-gray-500 italic py-2">
                                        No BOM found for this item. Select and issue this line directly.
                                      </div>
                                    ) : (
                                      <>
                                        <div className="mb-2 flex items-center justify-between">
                                          <span className="text-xs font-semibold text-sky-800 uppercase tracking-wide">
                                            Sub-Assembly Components - {ln.item_code}
                                          </span>
                                          <div className="flex items-center gap-3">
                                            <button
                                              onClick={() => setBomSelectedByLine((prev) => ({
                                                ...prev,
                                                [ln.id]: Object.fromEntries((lineBomData[ln.id] || []).map((_, i) => [i, true])),
                                              }))}
                                              className="text-xs text-sky-600 hover:underline"
                                            >Select all</button>
                                            <button
                                              onClick={() => setBomSelectedByLine((prev) => ({ ...prev, [ln.id]: {} }))}
                                              className="text-xs text-sky-600 hover:underline"
                                            >Deselect all</button>
                                          </div>
                                        </div>
                                        <table className="min-w-full text-sm">
                                          <thead>
                                            <tr className="text-left text-xs font-semibold text-sky-700 uppercase tracking-wide border-b border-sky-200">
                                              <th className="pb-1 pr-3 w-8"></th>
                                              <th className="pb-1 pr-6">Component</th>
                                              <th className="pb-1 pr-4">Qty / UOM</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-sky-100">
                                            {(lineBomData[ln.id] || []).map((comp, i) => {
                                              const isChecked = bomSelectedByLine[ln.id]?.[i] !== false;
                                              return (
                                                <tr key={i} className="hover:bg-sky-100/50">
                                                  <td className="py-1.5 pr-3">
                                                    <input
                                                      type="checkbox"
                                                      checked={isChecked}
                                                      onChange={() =>
                                                        setBomSelectedByLine((prev) => ({
                                                          ...prev,
                                                          [ln.id]: { ...(prev[ln.id] || {}), [i]: !isChecked },
                                                        }))
                                                      }
                                                      className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                                                    />
                                                  </td>
                                                  <td className="py-1.5 pr-6">
                                                    <span className="font-medium text-gray-800">{comp.item_code}</span>
                                                    {comp.item_name && (
                                                      <span className="ml-2 text-gray-500 text-xs">{comp.item_name}</span>
                                                    )}
                                                  </td>
                                                  <td className="py-1.5 pr-4 text-gray-600">
                                                    {comp.quantity * (Number(issueQtyByLine[ln.id]) || Number(ln.required_quantity) || 1)}{comp.uom ? <span className="ml-1 text-gray-400 text-xs">{comp.uom}</span> : null}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                        <p className="mt-2 text-xs text-sky-600 italic">
                                          Select the parent line above and click Issue to pull {ln.item_code} from stock.
                                        </p>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeSivView === 'history' && (
          <div className="min-h-0 flex-1 space-y-4">
            {sivHistory.length === 0 && (
              <div className="rounded-md border border-[#E8DCC4] bg-white p-8 text-center">
                <p className="text-[#7A6555]">No SIV history.</p>
              </div>
            )}
            {(() => {
              // Group rows by job_order_id
              const groupMap = new Map<string, SivHistoryRow[]>();
              for (const row of sivHistory) {
                const key = row.job_order_id || row.job_order_number || row.id;
                if (!groupMap.has(key)) groupMap.set(key, []);
                groupMap.get(key)!.push(row);
              }
              const getMovementTs = (row: SivHistoryRow) => row.movement_date ? new Date(row.movement_date).getTime() || 0 : 0;
              return Array.from(groupMap.entries())
                .map(([joId, rows]) => {
                  const sortedRows = [...rows].sort((a, b) => getMovementTs(b) - getMovementTs(a));
                  const latestDate = sortedRows[0]?.movement_date || '';
                  return [joId, sortedRows, latestDate] as const;
                })
                .sort((a, b) => {
                  const aTs = a[2] ? new Date(a[2]).getTime() || 0 : 0;
                  const bTs = b[2] ? new Date(b[2]).getTime() || 0 : 0;
                  return bTs - aTs;
                })
                .map(([joId, rows, latestDate]) => {
                const joNumber = rows[0]?.job_order_number || joId;
                const expanded = expandedHistoryJoIds[joId] !== false; // default expanded
                const approvedCount = rows.filter((r) => r.approved_by).length;
                const pendingRowIds = rows.filter((r) => !r.approved_by).map((r) => r.id);
                const selectedPendingRowIds = pendingRowIds.filter((id) => selectedHistoryRowIds.includes(id));
                const allPendingSelected = pendingRowIds.length > 0 && pendingRowIds.every((id) => selectedHistoryRowIds.includes(id));
                return (
                  <div
                    key={joId}
                    className="rounded-md border border-[#E8DCC4] bg-white p-4"
                  >
                    {/* JO header */}
                    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={allPendingSelected}
                          disabled={pendingRowIds.length === 0}
                          title={pendingRowIds.length === 0 ? 'All rows are already approved' : 'Select pending rows'}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedHistoryRowIds((prev) => [...new Set([...prev, ...pendingRowIds])]);
                            } else {
                              setSelectedHistoryRowIds((prev) => prev.filter((id) => !pendingRowIds.includes(id)));
                            }
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-[#8B6F47] focus:ring-[#8B6F47] disabled:cursor-not-allowed disabled:opacity-40"
                        />
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-bold text-[#4A3426]">{joNumber}</h3>
                          <p className="mt-0.5 text-sm text-[#7A6555]">
                            {rows.length} line{rows.length !== 1 ? 's' : ''} - Approved {approvedCount}/{rows.length}
                            {latestDate ? ` · Last issued ${new Date(latestDate).toLocaleDateString()}` : ''}
                          </p>
                          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-5">
                            <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                              <div className="font-semibold uppercase text-[#7A6555]">Document</div>
                              <div className="mt-1 font-medium text-[#4A3426]">SIV / Goods Issue</div>
                            </div>
                            <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                              <div className="font-semibold uppercase text-[#7A6555]">Issued To</div>
                              <div className="mt-1 font-medium text-[#4A3426]">
                                {[rows[0]?.issued_to_employee_code, rows[0]?.issued_to_employee_name].filter(Boolean).join(' - ') || 'Legacy SIV — not recorded'}
                              </div>
                            </div>
                            <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                              <div className="font-semibold uppercase text-[#7A6555]">Movement</div>
                              <div className="mt-1 font-medium text-[#4A3426]">261</div>
                            </div>
                            <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                              <div className="font-semibold uppercase text-[#7A6555]">Stock Posting</div>
                              <div className="mt-1 font-medium text-[#4A3426]">Posted on issue</div>
                            </div>
                            <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2">
                              <div className="font-semibold uppercase text-[#7A6555]">Approval</div>
                              <div className="mt-1 font-medium text-[#4A3426]">{approvedCount === rows.length ? 'Complete' : `${rows.length - approvedCount} pending`}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {pendingRowIds.length > 0 && selectedPendingRowIds.length > 0 && (
                          <span className="inline-flex min-h-8 items-center rounded-md border border-[#D8C8AA] bg-[#FFFCF5] px-3 text-xs font-semibold text-[#5E4635]">
                            {selectedPendingRowIds.length} selected
                          </span>
                        )}
                        {canApprove && pendingRowIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              void approveSivHistoryRows(
                                selectedPendingRowIds.length > 0 ? selectedPendingRowIds : pendingRowIds,
                                joNumber,
                              )
                            }
                            className="inline-flex min-h-8 items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Approve {selectedPendingRowIds.length > 0 ? selectedPendingRowIds.length : `${pendingRowIds.length} Pending`}
                          </button>
                        )}
                        <button
                          onClick={() => printSivHistory(joId, rows)}
                          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-xs font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Print
                        </button>
                        <button
                          onClick={() =>
                            setExpandedHistoryJoIds((prev) => ({ ...prev, [joId]: !expanded }))
                          }
                          className="inline-flex min-h-8 items-center rounded-md border border-[#D8C8AA] bg-white px-3 text-xs font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                        >
                          {expanded ? 'Collapse' : 'Expand'}
                        </button>
                      </div>
                    </div>

                    {/* Material lines */}
                    {expanded && (
                      <div className="mt-2 overflow-x-auto rounded-md border border-[#E8DCC4]">
                        <table className="min-w-full divide-y divide-[#E8DCC4]">
                          <thead className="bg-[#F5EFE3]">
                            <tr>
                              <th className="w-8 px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]"></th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Item</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">UID</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Movement</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Qty</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Issued To</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Issued At</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Status</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-[#5E4635]">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E8DCC4] bg-white">
                            {rows.map((row) => {
                              const isChecked = selectedHistoryRowIds.includes(row.id);
                              const isApproved = Boolean(row.approved_by);
                              return (
                                <tr key={row.id} className="hover:bg-[#FFFCF5]">
                                  <td className="px-3 py-2">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isApproved}
                                      title={isApproved ? 'Already approved' : 'Select for bulk approval'}
                                      onChange={() =>
                                        setSelectedHistoryRowIds((prev) =>
                                          isChecked ? prev.filter((id) => id !== row.id) : [...prev, row.id]
                                        )
                                      }
                                      className="w-4 h-4 rounded border-gray-300 text-[#8B6F47] focus:ring-[#8B6F47] disabled:cursor-not-allowed disabled:opacity-40"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-sm text-[#5E4635]">
                                    <div className="font-medium text-gray-900">{row.item_code}</div>
                                    <div className="text-xs text-gray-500">{row.item_name}</div>
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">{row.uid || '-'}</td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    <div className="font-medium text-[#4A3426]">261</div>
                                    <div className="text-xs text-gray-500">Stock posted</div>
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">{row.quantity ?? 0}</td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    <div className="font-medium text-[#4A3426]">{row.issued_to_employee_name || 'Not recorded'}</div>
                                    {row.issued_to_employee_code && <div className="text-xs text-gray-500">{row.issued_to_employee_code}</div>}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {row.movement_date ? new Date(row.movement_date).toLocaleString() : '-'}
                                  </td>
                                  <td className="px-3 py-2 text-sm">
                                    <ErpStatusBadge
                                      status={row.approved_by ? 'APPROVED' : 'GOODS_ISSUED'}
                                      label={row.approved_by ? 'Approved' : 'Goods Issued'}
                                      tone={row.approved_by ? 'success' : 'info'}
                                      title={row.approved_by ? `Approved by ${row.approved_by}` : 'Issued and awaiting approval'}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex justify-end gap-2">
                                      {canApprove && !row.approved_by && (
                                        <button
                                          type="button"
                                          onClick={() => void approveSivHistoryRow(row.id)}
                                          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-emerald-700 bg-emerald-700 px-2.5 text-xs font-semibold text-white hover:bg-emerald-800"
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                          Approve
                                        </button>
                                      )}
                                      {canDelete && !row.approved_by && (
                                        <button
                                          type="button"
                                          onClick={() => void deleteSivHistoryRow(row.id)}
                                          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" />
                                          Reverse
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
      {/* UID Picker Modal */}
      {uidPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-5 py-4 border-b bg-white">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Pick UIDs - {uidPickerItemCode}</h2>
                <p className="text-xs text-gray-500 mt-0.5">Select up to {uidPickerMaxQty} UID{uidPickerMaxQty !== 1 ? 's' : ''} from available stock</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setUidPickerOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmUidPicker}
                  disabled={uidPickerSelected.length === 0}
                  className="px-4 py-2 bg-[#8B6F47] text-white rounded-lg text-sm font-medium hover:bg-[#6F4E37] disabled:opacity-50"
                >
                  Confirm {uidPickerSelected.length > 0 ? `(${uidPickerSelected.length})` : ''}
                </button>
              </div>
            </div>
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-5 py-2 border-b bg-gray-50">
              <span className="text-sm text-gray-700">{uidPickerSelected.length} / {uidPickerMaxQty} selected</span>
              <button
                onClick={() => setUidPickerSelected(uidPickerUids.slice(0, uidPickerMaxQty).map((u: any) => u.uid || u.id))}
                className="ml-auto text-xs px-3 py-1 bg-sky-600 text-white rounded hover:bg-sky-700"
              >
                Auto-select {uidPickerMaxQty}
              </button>
              <button
                onClick={() => setUidPickerSelected([])}
                className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-100"
              >
                Clear
              </button>
            </div>
            {/* UID list */}
            <div className="overflow-y-auto flex-1 px-5 py-3">
              {uidPickerLoading ? (
                <div className="text-center text-gray-500 py-10">Loading UIDs...</div>
              ) : uidPickerUids.length === 0 ? (
                <div className="text-center text-gray-400 py-10">No available UIDs found for this item.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase border-b">
                      <th className="pb-2 pr-3 w-8"></th>
                      <th className="pb-2 pr-6">UID</th>
                      <th className="pb-2 pr-4">Batch</th>
                      <th className="pb-2">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {uidPickerUids.map((u: any) => {
                      const uid = u.uid || u.id;
                      const checked = uidPickerSelected.includes(uid);
                      return (
                        <tr
                          key={uid}
                          className={`cursor-pointer hover:bg-sky-50 ${checked ? 'bg-sky-50' : ''}`}
                          onClick={() => {
                            if (checked) {
                              setUidPickerSelected((p) => p.filter((x) => x !== uid));
                            } else if (uidPickerSelected.length < uidPickerMaxQty) {
                              setUidPickerSelected((p) => [...p, uid]);
                            }
                          }}
                        >
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              readOnly
                              checked={checked}
                              className="w-4 h-4 rounded border-gray-300 text-sky-600 pointer-events-none"
                            />
                          </td>
                          <td className="py-2 pr-6 font-mono text-xs text-gray-800">{uid}</td>
                          <td className="py-2 pr-4 text-gray-600">{u.batch_number || '-'}</td>
                          <td className="py-2 text-gray-500">{u.received_date ? new Date(u.received_date).toLocaleDateString() : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
