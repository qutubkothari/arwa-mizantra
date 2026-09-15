'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../../../../lib/api-client';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';
import SearchableSelect from '../../../../components/SearchableSelect';
import DateInput from '../../../../components/ui/DateInput';
import { buildDocumentBranding, escapeHtml } from '@/lib/document-branding';
import { ErpButton, ErpPageHeader } from '../../../../components/ui/ErpPrimitives';
import { ClipboardCheck, FileText, GitBranch, Printer, RefreshCw, ShieldCheck } from 'lucide-react';

type InventoryItem = {
  id: string;
  code?: string;
  name?: string;
  category?: string;
  uom?: string;
  uid_tracking?: boolean;
  uid_strategy?: string;
  batch_quantity?: number | null;
  batch_uom?: string | null;
};

type Warehouse = {
  id: string;
  code?: string;
  name?: string;
};

type StockLevel = {
  id: string;
  item_id: string;
  warehouse_id: string;
  available_quantity?: number;
  quantity?: number;
  items?: {
    code?: string;
    name?: string;
    uom?: string;
  };
  warehouses?: {
    code?: string;
    name?: string;
  };
};

type StockMovement = {
  id: string;
  movement_number: string;
  movement_type: string;
  quantity: number;
  movement_date: string;
  notes?: string;
  items?: {
    code?: string;
    name?: string;
  };
  from_warehouse?: {
    code?: string;
    name?: string;
  } | null;
  to_warehouse?: {
    code?: string;
    name?: string;
  } | null;
};

type AvailableUid = {
  uid: string;
  status?: string;
  location?: string;
  quality_status?: string;
  created_at?: string;
};

type PreparedAdjustment = {
  parsed: number;
  delta: number;
  absoluteQuantity: number;
  payload: Record<string, unknown>;
};

type UidDialogState = {
  open: boolean;
  action: 'increase' | 'decrease';
  loading: boolean;
  availableUids: AvailableUid[];
  selectedUids: string[];
  generateUids: boolean;
  error: string | null;
  quantity: number;
  requiredCount: number;
  strategy: 'SERIALIZED' | 'BATCHED' | 'NONE';
  qtyPerUid: number;
  itemLabel: string;
  warehouseLabel: string;
};

type AdjustmentMode = 'increase' | 'decrease' | 'set';

const EMPTY_UID_DIALOG: UidDialogState = {
  open: false,
  action: 'increase',
  loading: false,
  availableUids: [],
  selectedUids: [],
  generateUids: true,
  error: null,
  quantity: 0,
  requiredCount: 0,
  strategy: 'NONE',
  qtyPerUid: 1,
  itemLabel: '',
  warehouseLabel: '',
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0';

  const formatNumberParts = (num: number) => {
    const absValue = Math.abs(num);
    const integerPart = Math.trunc(absValue).toString();
    const decimalPart = absValue.toFixed(3).replace(/\.?(?:0)+$/, '');
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (num < 0 ? '-' : '') + (decimalPart.includes('.') ? `${formattedInteger}${decimalPart.slice(integerPart.length)}` : formattedInteger);
  };

  try {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
  } catch {
    return formatNumberParts(value);
  }
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  // Treat as UTC if no timezone indicator — DB stores UTC but TIMESTAMP columns return without 'Z'
  const normalized = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (num: number) => String(num).padStart(2, '0');
  const day = pad(date.getDate());
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${day} ${month} ${year}, ${hours}:${minutes}`;
};

const toDateTimeLocalValue = (date = new Date()) => {
  const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60 * 1000));
  return localDate.toISOString().slice(0, 16);
};

const normalizeDateTimeLocalValue = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T${toDateTimeLocalValue().slice(11, 16)}`;
  }

  return trimmed;
};

const getUidStrategy = (item: InventoryItem | null): 'SERIALIZED' | 'BATCHED' | 'NONE' => {
  if (!item?.uid_tracking) return 'NONE';

  const normalized = String(item.uid_strategy || 'SERIALIZED').trim().toUpperCase();
  if (normalized === 'BATCHED') return 'BATCHED';
  if (normalized === 'NONE') return 'NONE';
  return 'SERIALIZED';
};

function normalizeResponseArray<T>(response: any): T[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  return [];
}

const parseUidResponse = (response: any): AvailableUid[] => {
  return normalizeResponseArray<AvailableUid>(response);
};

export default function StockAdjustmentsPage() {
  const [currentUser, setCurrentUser] = useState<ReturnType<typeof readStoredUser>>(null);
  const canCreate = hasModulePermission(currentUser, 'Inventory', 'create');

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [adjustments, setAdjustments] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [mode, setMode] = useState<AdjustmentMode>('increase');
  const [quantityInput, setQuantityInput] = useState('');
  const [notes, setNotes] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [uidDialogState, setUidDialogState] = useState<UidDialogState>(EMPTY_UID_DIALOG);
  const [printDialog, setPrintDialog] = useState({ open: false, fromDate: '', toDate: '', category: '', itemId: '', printing: false });

  useEffect(() => {
    setCurrentUser(readStoredUser());
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setWarningMessage(null);
    try {
      const [itemsResult, warehousesResult, movementsResult] = await Promise.allSettled([
        apiClient.get<any[]>('/items'),
        apiClient.get<any[]>('/inventory/warehouses'),
        apiClient.get<any[]>('/inventory/movements', { movement_type: 'ADJUSTMENT', limit: 100 }),
      ]);

      const itemsRes = itemsResult.status === 'fulfilled' ? itemsResult.value : [];
      const warehousesRes = warehousesResult.status === 'fulfilled' ? warehousesResult.value : [];
      const movementRes = movementsResult.status === 'fulfilled' ? movementsResult.value : [];

      const itemsArray = normalizeResponseArray<InventoryItem>(itemsRes);
      const warehouseArray = normalizeResponseArray<Warehouse>(warehousesRes);
      const movementArray = normalizeResponseArray<StockMovement>(movementRes);

      setItems(itemsArray);
      setWarehouses(warehouseArray);
      setAdjustments(movementArray);

      const warnings: string[] = [];
      const failures = [itemsResult, warehousesResult, movementsResult].filter(
        (result) => result.status === 'rejected',
      ) as PromiseRejectedResult[];

      if (failures.length > 0) {
        const firstFailure = failures[0]?.reason;
        warnings.push('Some stock adjustment data could not be loaded: ' + String(firstFailure?.message || firstFailure || 'Unknown error'));
      }

      if (Array.isArray(warehousesRes) && warehousesRes.length === 0) {
        warnings.push('No warehouses are available for this tenant yet. Refresh once more or create a warehouse from Inventory setup.');
      }

      setWarningMessage(warnings.length > 0 ? warnings.join(' ') : null);

      if (!itemId && Array.isArray(itemsRes) && itemsRes[0]?.id) {
        setItemId(String(itemsRes[0].id));
      }

      if (!warehouseId && Array.isArray(warehousesRes) && warehousesRes[0]?.id) {
        setWarehouseId(String(warehousesRes[0].id));
      }
    } finally {
      setLoading(false);
    }
  }, [itemId, warehouseId]);

  const loadSelectedStock = useCallback(async () => {
    if (!itemId || !warehouseId) {
      setStockLevels([]);
      return;
    }

    setStockLoading(true);
    try {
      const stockRes = await apiClient.get<any[]>('/inventory/stock', {
        item_id: itemId,
        warehouse_id: warehouseId,
      });

      setStockLevels(normalizeResponseArray<StockLevel>(stockRes));
    } catch (error: any) {
      setStockLevels([]);
      setWarningMessage('Some stock adjustment data could not be loaded: ' + String(error?.message || error || 'Unknown error'));
    } finally {
      setStockLoading(false);
    }
  }, [itemId, warehouseId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadSelectedStock();
  }, [loadSelectedStock]);

  const selectedItem = useMemo(
    () => items.find((entry) => String(entry.id) === itemId) || null,
    [itemId, items],
  );

  const itemOptions = useMemo(() => {
    return items.map((item) => ({
      value: String(item.id),
      label: item.code || item.name || String(item.id),
      subtitle: [item.name, item.category, item.uom].filter(Boolean).join(' | '),
    }));
  }, [items]);

  const selectedWarehouse = useMemo(
    () => warehouses.find((entry) => String(entry.id) === warehouseId) || null,
    [warehouseId, warehouses],
  );

  const selectedItemUidStrategy = useMemo(() => getUidStrategy(selectedItem), [selectedItem]);
  const selectedItemIsUidTracked = selectedItemUidStrategy !== 'NONE';

  const categories = useMemo(() => {
    return [...new Set(items.map(i => i.category).filter(Boolean) as string[])].sort();
  }, [items]);

  const printAdjustments = useCallback(async () => {
    setPrintDialog(prev => ({ ...prev, printing: true }));
    try {
      const formatReportDate = (value: string) => {
        const date = new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime())
          ? value
          : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      };

      const params: Record<string, any> = { movement_type: 'ADJUSTMENT', limit: 5000 };
      if (printDialog.fromDate) params.from_date = new Date(`${printDialog.fromDate}T00:00:00`).toISOString();
      if (printDialog.toDate) {
        const to = new Date(`${printDialog.toDate}T23:59:59`);
        params.to_date = to.toISOString();
      }
      if (printDialog.itemId) params.item_id = printDialog.itemId;

      const result = await apiClient.get<any[]>('/inventory/movements', params);
      let movements = normalizeResponseArray<StockMovement>(result);

      if (printDialog.category) {
        const catItemIds = new Set(items.filter(i => i.category === printDialog.category).map(i => String(i.id)));
        movements = movements.filter(m => catItemIds.has(String((m as any).item_id || '')));
      }

      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      const branding = buildDocumentBranding(company);

      const filterParts = [
        printDialog.fromDate ? `From: ${formatReportDate(printDialog.fromDate)}` : '',
        printDialog.toDate ? `To: ${formatReportDate(printDialog.toDate)}` : '',
        printDialog.category ? `Category: ${printDialog.category}` : '',
        printDialog.itemId ? `Item: ${items.find(i => String(i.id) === printDialog.itemId)?.code || ''}` : '',
      ].filter(Boolean).join(' | ') || 'All Records';

      const tableRows = movements.map(m => {
        const isDecrease = !!(m as any).from_warehouse && !(m as any).to_warehouse;
        const isIncrease = !!(m as any).to_warehouse && !(m as any).from_warehouse;
        const warehouseName = isIncrease
          ? ((m as any).to_warehouse?.name || (m as any).to_warehouse?.code || '-')
          : isDecrease
            ? ((m as any).from_warehouse?.name || (m as any).from_warehouse?.code || '-')
            : 'Transfer';
        const qty = Number((m as any).quantity || 0);
        const qtyColor = isDecrease ? '#b91c1c' : '#065f46';
        const qtySign = isDecrease ? '-' : '+';
        const itemLabel = [m.items?.code, m.items?.name].filter(Boolean).join(' - ') || '-';
        return `<tr>
          <td>${escapeHtml(m.movement_number || '-')}</td>
          <td>${escapeHtml(itemLabel)}</td>
          <td>${escapeHtml(warehouseName)}</td>
          <td style="text-align:center;color:${qtyColor};font-weight:600;">${qtySign}${formatNumber(qty)}</td>
          <td style="white-space:nowrap;">${escapeHtml(formatDateTime(m.movement_date))}</td>
          <td>${escapeHtml(m.notes || '-')}</td>
        </tr>`;
      }).join('');

      const printedAt = new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const html = `<!DOCTYPE html><html><head><title>Stock Adjustments Report</title>
      <script>window.onload=function(){window.print();}</script>
      <style>
        @page{margin:1cm;}
        body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:0;padding:16px;}
        .header{border-bottom:2px solid #1e3a8a;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start;}
        .co-name{font-size:17px;font-weight:bold;color:#1e3a8a;}
        .doc-title{font-size:14px;font-weight:bold;margin-bottom:4px;}
        .filter-line{font-size:10px;color:#555;margin-bottom:12px;}
        table{width:100%;border-collapse:collapse;}
        th{background:#1e3a8a;color:#fff;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;}
        td{padding:5px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
        tr:nth-child(even) td{background:#f9fafb;}
        .footer{margin-top:14px;text-align:center;font-size:9px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:6px;}
      </style>
      </head><body>
      <div class="header">
        <div class="co-name">${escapeHtml(branding.companyName)}</div>
        <div style="font-size:10px;color:#555;text-align:right;">Printed: ${escapeHtml(printedAt)}</div>
      </div>
      <div class="doc-title">Stock Adjustments Report</div>
      <div class="filter-line">${escapeHtml(filterParts)} &nbsp;|&nbsp; ${movements.length} record(s)</div>
      <table>
        <thead><tr><th>Movement No.</th><th>Item</th><th>Warehouse</th><th style="text-align:center;">Qty</th><th>Date / Time</th><th>Notes</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="6" style="text-align:center;padding:12px;color:#9ca3af;">No records found for the selected filters.</td></tr>'}</tbody>
      </table>
      <div class="footer">${escapeHtml(branding.companyName)} &mdash; Stock Adjustments Report &mdash; ${new Date().getFullYear()}</div>
      </body></html>`;

      const pw = window.open('', '_blank');
      if (!pw) { alert('Popup blocked — please allow popups to print.'); return; }
      pw.document.open();
      pw.document.write(html);
      pw.document.close();
      setPrintDialog({ open: false, fromDate: '', toDate: '', category: '', itemId: '', printing: false });
    } catch (err: any) {
      alert('Failed to generate report: ' + String(err?.message || err));
    } finally {
      setPrintDialog(prev => ({ ...prev, printing: false }));
    }
  }, [printDialog, items]);

  const currentAvailable = useMemo(() => {
    return stockLevels
      .filter((entry) => String(entry.item_id) === itemId && String(entry.warehouse_id) === warehouseId)
      .reduce((sum, entry) => sum + Number(entry.available_quantity ?? entry.quantity ?? 0), 0);
  }, [itemId, stockLevels, warehouseId]);

  const draftSummary = useMemo(() => {
    const parsed = Number(quantityInput || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    if (mode === 'increase') {
      return { delta: parsed, result: currentAvailable + parsed };
    }

    if (mode === 'decrease') {
      return { delta: -parsed, result: currentAvailable - parsed };
    }

    return { delta: parsed - currentAvailable, result: parsed };
  }, [currentAvailable, mode, quantityInput]);

  const increaseCount = useMemo(
    () => adjustments.filter((movement) => !!movement.to_warehouse && !movement.from_warehouse).length,
    [adjustments],
  );
  const decreaseCount = useMemo(
    () => adjustments.filter((movement) => !!movement.from_warehouse && !movement.to_warehouse).length,
    [adjustments],
  );
  const selectedMovementType = mode === 'increase' ? '701' : mode === 'decrease' ? '702' : '709';
  const selectedMovementLabel =
    mode === 'increase'
      ? 'Inventory gain / found stock'
      : mode === 'decrease'
        ? 'Inventory loss / write-off'
        : 'Physical count correction';

  const resolveUidRequirement = useCallback((quantity: number) => {
    if (!selectedItemIsUidTracked) {
      return {
        count: 0,
        strategy: 'NONE' as const,
        qtyPerUid: 1,
        error: null,
      };
    }

    if (selectedItemUidStrategy === 'BATCHED') {
      const batchQuantity = Number(selectedItem?.batch_quantity || 0);

      if (!Number.isFinite(batchQuantity) || batchQuantity <= 0) {
        return {
          count: 0,
          strategy: 'BATCHED' as const,
          qtyPerUid: batchQuantity,
          error: 'This item uses batched UID tracking but batch quantity is missing in Item Master.',
        };
      }

      const ratio = quantity / batchQuantity;
      if (!Number.isFinite(ratio) || Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        return {
          count: 0,
          strategy: 'BATCHED' as const,
          qtyPerUid: batchQuantity,
          error: `Adjustment quantity must be a multiple of ${formatNumber(batchQuantity)} ${selectedItem?.batch_uom || selectedItem?.uom || ''}`.trim(),
        };
      }

      return {
        count: Math.round(ratio),
        strategy: 'BATCHED' as const,
        qtyPerUid: batchQuantity,
        error: null,
      };
    }

    if (Math.abs(quantity - Math.round(quantity)) > 1e-9) {
      return {
        count: 0,
        strategy: 'SERIALIZED' as const,
        qtyPerUid: 1,
        error: 'Adjustment quantity must be a whole number for serialized UID-tracked items.',
      };
    }

    return {
      count: Math.round(quantity),
      strategy: 'SERIALIZED' as const,
      qtyPerUid: 1,
      error: null,
    };
  }, [selectedItem?.batch_quantity, selectedItem?.batch_uom, selectedItem?.uom, selectedItemIsUidTracked, selectedItemUidStrategy]);

  const prepareAdjustmentSubmission = useCallback((): { error?: string; prepared?: PreparedAdjustment } => {
    if (!canCreate) {
      return { error: 'You do not have permission to create stock adjustments.' };
    }

    if (!itemId || !warehouseId) {
      return { error: 'Select both item and warehouse.' };
    }

    const parsed = Number(quantityInput || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: mode === 'set' ? 'Enter the final stock quantity.' : 'Enter an adjustment quantity greater than 0.' };
    }

    let delta = 0;
    if (mode === 'increase') delta = parsed;
    if (mode === 'decrease') delta = -parsed;
    if (mode === 'set') delta = parsed - currentAvailable;

    if (Math.abs(delta) < 1e-9) {
      return { error: 'No stock change detected.' };
    }

    if (mode === 'decrease' && parsed - currentAvailable > 1e-9) {
      return { error: 'Adjustment quantity cannot exceed available stock in the selected warehouse.' };
    }

    if (mode === 'set' && parsed < 0) {
      return { error: 'Final stock cannot be negative.' };
    }

    return {
      prepared: {
        parsed,
        delta,
        absoluteQuantity: Math.abs(delta),
        payload: {
          movement_type: 'ADJUSTMENT',
          item_id: itemId,
          quantity: Math.abs(delta),
          from_warehouse_id: delta < 0 ? warehouseId : undefined,
          to_warehouse_id: delta > 0 ? warehouseId : undefined,
          movement_date: effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
          reference_type: 'STOCK_ADJUSTMENT',
          notes: String(notes || '').trim() || (mode === 'set'
            ? `Stock count adjustment to ${formatNumber(parsed)}`
            : mode === 'increase'
              ? 'Stock increased by manual adjustment'
              : 'Stock decreased by manual adjustment'),
          category: selectedItem?.category,
        },
      },
    };
  }, [canCreate, currentAvailable, effectiveAt, itemId, mode, notes, quantityInput, selectedItem?.category, warehouseId]);

  const closeUidDialog = useCallback(() => {
    setUidDialogState(EMPTY_UID_DIALOG);
  }, []);

  const savePreparedAdjustment = useCallback(async (prepared: PreparedAdjustment, options?: { generate_uids?: boolean; selected_uids?: string[] }) => {
    setSaving(true);
    try {
      const result = await apiClient.post<any>('/inventory/movements', {
        ...prepared.payload,
        ...options,
      });

      const generatedCount = Array.isArray(result?.generated_uids) ? result.generated_uids.length : 0;
      const consumedCount = Array.isArray(result?.consumed_uids) ? result.consumed_uids.length : 0;
      const messages = ['Stock adjustment saved successfully.'];

      if (generatedCount > 0) messages.push(`${generatedCount} UID(s) generated.`);
      if (consumedCount > 0) messages.push(`${consumedCount} UID(s) removed from stock.`);

      setStatusMessage(messages.join(' '));
      setQuantityInput('');
      setNotes('');
      setEffectiveAt('');
      closeUidDialog();
      await loadData();
      await loadSelectedStock();
    } catch (error: any) {
      alert('Failed to save stock adjustment: ' + String(error?.response?.data?.message || error?.message || error));
    } finally {
      setSaving(false);
    }
  }, [closeUidDialog, loadData, loadSelectedStock]);

  const openDecreaseUidDialog = useCallback(async (prepared: PreparedAdjustment) => {
    const requirement = resolveUidRequirement(prepared.absoluteQuantity);
    if (requirement.error) {
      alert(requirement.error);
      return;
    }

    const itemLabel = [selectedItem?.code, selectedItem?.name].filter(Boolean).join(' - ') || selectedItem?.id || 'Selected item';
    const warehouseLabel = [selectedWarehouse?.code, selectedWarehouse?.name].filter(Boolean).join(' - ') || selectedWarehouse?.id || 'Selected warehouse';

    setUidDialogState({
      open: true,
      action: 'decrease',
      loading: true,
      availableUids: [],
      selectedUids: [],
      generateUids: false,
      error: null,
      quantity: prepared.absoluteQuantity,
      requiredCount: requirement.count,
      strategy: requirement.strategy,
      qtyPerUid: requirement.qtyPerUid,
      itemLabel,
      warehouseLabel,
    });

    try {
      const response = await apiClient.get<any>('/uid', {
        item_id: itemId,
        limit: 5000,
        sortBy: 'created_at',
        sortOrder: 'asc',
      });

      const allowedStatuses = new Set(['ACTIVE', 'GENERATED', 'IN_STOCK']);
      const availableUids = parseUidResponse(response).filter((entry) => allowedStatuses.has(String(entry.status || '').toUpperCase()));
      const selectedUids = availableUids.slice(0, requirement.count).map((entry) => entry.uid);

      setUidDialogState((prev) => ({
        ...prev,
        loading: false,
        availableUids,
        selectedUids,
        error: availableUids.length < requirement.count
          ? `Only ${availableUids.length} eligible UID(s) are available for removal, but ${requirement.count} are required.`
          : null,
      }));
    } catch (error: any) {
      setUidDialogState((prev) => ({
        ...prev,
        loading: false,
        error: 'Failed to load available UIDs: ' + String(error?.message || error || 'Unknown error'),
      }));
    }
  }, [itemId, resolveUidRequirement, selectedItem?.code, selectedItem?.id, selectedItem?.name, selectedWarehouse?.code, selectedWarehouse?.id, selectedWarehouse?.name]);

  const requestSubmitAdjustment = useCallback(async () => {
    setStatusMessage(null);
    const { error, prepared } = prepareAdjustmentSubmission();

    if (error || !prepared) {
      alert(error || 'Unable to prepare stock adjustment.');
      return;
    }

    if (!selectedItemIsUidTracked) {
      await savePreparedAdjustment(prepared);
      return;
    }

    const requirement = resolveUidRequirement(prepared.absoluteQuantity);
    if (requirement.error) {
      alert(requirement.error);
      return;
    }

    const itemLabel = [selectedItem?.code, selectedItem?.name].filter(Boolean).join(' - ') || selectedItem?.id || 'Selected item';
    const warehouseLabel = [selectedWarehouse?.code, selectedWarehouse?.name].filter(Boolean).join(' - ') || selectedWarehouse?.id || 'Selected warehouse';

    if (prepared.delta > 0) {
      setUidDialogState({
        open: true,
        action: 'increase',
        loading: false,
        availableUids: [],
        selectedUids: [],
        generateUids: true,
        error: null,
        quantity: prepared.absoluteQuantity,
        requiredCount: requirement.count,
        strategy: requirement.strategy,
        qtyPerUid: requirement.qtyPerUid,
        itemLabel,
        warehouseLabel,
      });
      return;
    }

    await openDecreaseUidDialog(prepared);
  }, [openDecreaseUidDialog, prepareAdjustmentSubmission, resolveUidRequirement, savePreparedAdjustment, selectedItem?.code, selectedItem?.id, selectedItem?.name, selectedItemIsUidTracked, selectedWarehouse?.code, selectedWarehouse?.id, selectedWarehouse?.name]);

  const confirmUidDialog = useCallback(async () => {
    const { error, prepared } = prepareAdjustmentSubmission();

    if (error || !prepared) {
      alert(error || 'Unable to prepare stock adjustment.');
      return;
    }

    if (uidDialogState.action === 'increase') {
      await savePreparedAdjustment(prepared, {
        generate_uids: uidDialogState.generateUids,
      });
      return;
    }

    if (uidDialogState.selectedUids.length !== uidDialogState.requiredCount) {
      alert(`Select exactly ${uidDialogState.requiredCount} UID(s) before continuing.`);
      return;
    }

    await savePreparedAdjustment(prepared, {
      selected_uids: uidDialogState.selectedUids,
    });
  }, [prepareAdjustmentSubmission, savePreparedAdjustment, uidDialogState.action, uidDialogState.generateUids, uidDialogState.requiredCount, uidDialogState.selectedUids]);

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-4 text-[#2F241D] lg:px-6">
      <div className="flex min-h-[calc(100vh-2rem)] flex-col gap-4">
        <ErpPageHeader
          eyebrow="Inventory"
          title="Stock Adjustments"
          description="Post physical count corrections, write-offs, gains, and UID-controlled stock movements."
          actions={
            <ErpButton
              variant="secondary"
              onClick={() => {
                void loadData();
              }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </ErpButton>
          }
        />

        <section className="overflow-hidden rounded-md border border-[#E8DCC4] bg-white">
          <div className="grid divide-y divide-[#E8DCC4] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            <div className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">Movement Type</div>
              <div className="mt-2 text-2xl font-bold text-[#4A3426]">{selectedMovementType}</div>
              <div className="mt-1 text-sm text-[#7A6555]">{selectedMovementLabel}</div>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">Selected Stock</div>
              <div className="mt-2 text-2xl font-bold text-[#4A3426]">
                {formatNumber(currentAvailable)} {selectedItem?.uom || ''}
              </div>
              <div className="mt-1 text-sm text-[#7A6555]">{selectedWarehouse ? 'Warehouse stock available now' : 'Select item and warehouse'}</div>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">Adjustment Register</div>
              <div className="mt-2 flex items-baseline gap-4">
                <span className="text-2xl font-bold text-[#4A3426]">{adjustments.length}</span>
                <span className="text-sm font-semibold text-emerald-700">+{increaseCount}</span>
                <span className="text-sm font-semibold text-red-700">-{decreaseCount}</span>
              </div>
              <div className="mt-1 text-sm text-[#7A6555]">{loading ? 'Refreshing movements...' : 'Total, increases, decreases'}</div>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">Posting Control</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-bold text-[#4A3426]">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                Immediate stock posting
              </div>
              <div className="mt-1 text-sm text-[#7A6555]">
                {selectedItemIsUidTracked ? `UID tracked: ${selectedItemUidStrategy}` : 'UID not tracked for selected item'}
              </div>
            </div>
          </div>
        </section>

        {statusMessage && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {statusMessage}
          </div>
        )}

        {warningMessage && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {warningMessage}
          </div>
        )}

        <div className="space-y-4">
          <section className="grid gap-4 rounded-md border border-[#E8DCC4] bg-white p-5 lg:grid-cols-2 xl:grid-cols-3">
            <div className="border-b border-[#E8DCC4] pb-4 lg:col-span-2 xl:col-span-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[#4A3426]">Post Stock Adjustment</h2>
                  <p className="mt-1 text-sm text-[#7A6555]">Create a controlled inventory movement after physical count, write-off, or found stock review.</p>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-[#5E4635]">
                  <span className="inline-flex items-center gap-2 rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2 font-semibold">
                    <GitBranch className="h-4 w-4 text-[#8B6F47]" />
                    Count &gt; Adjustment &gt; Stock
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-3 py-2 font-semibold">
                    <ClipboardCheck className="h-4 w-4 text-[#8B6F47]" />
                    Reason required
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Item</label>
              <SearchableSelect
                options={itemOptions}
                value={itemId}
                onChange={(value) => setItemId(value)}
                placeholder={loading ? 'Loading items...' : 'Search item by code or name...'}
                truncateInput={false}
                disabled={loading || items.length === 0}
              />
              <p className="mt-1 text-xs text-[#7A6555]">Type part code or item name to filter the list.</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Warehouse</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="min-h-10 w-full rounded-md border border-[#D8C8AA] bg-white px-3 py-2 text-sm focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
              >
                <option value="">Select warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {[warehouse.code, warehouse.name].filter(Boolean).join(' - ') || warehouse.id}
                  </option>
                ))}
              </select>
              {warehouses.length === 0 && !loading && (
                <p className="mt-2 text-xs text-amber-700">No warehouses are configured for this tenant yet.</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Adjustment Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['increase', 'Increase'],
                  ['decrease', 'Decrease'],
                  ['set', 'Set Final'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`min-h-9 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                      mode === value
                        ? 'border-[#8B6F47] bg-[#8B6F47] text-white'
                        : 'border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">
                {mode === 'set' ? 'Final Stock Quantity' : 'Adjustment Quantity'}
              </label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={quantityInput}
                onChange={(e) => setQuantityInput(e.target.value)}
                className="min-h-10 w-full rounded-md border border-[#D8C8AA] px-3 py-2 focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                placeholder={mode === 'set' ? 'Enter final counted stock' : 'Enter quantity'}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="block text-xs font-semibold uppercase text-[#7A6555]">Effective Date / Time</label>
                <button
                  type="button"
                  onClick={() => setEffectiveAt(toDateTimeLocalValue())}
                  className="text-xs font-semibold uppercase text-[#8B6F47] hover:text-[#6F4E37]"
                >
                  Use now
                </button>
              </div>
              <input
                type="datetime-local"
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(normalizeDateTimeLocalValue(e.target.value))}
                onFocus={() => {
                  if (!effectiveAt) {
                    setEffectiveAt(toDateTimeLocalValue());
                  }
                }}
                step={60}
                className="min-h-10 w-full rounded-md border border-[#D8C8AA] px-3 py-2 focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
              />
            </div>

            <div className="lg:col-span-2 xl:col-span-3">
              <label className="mb-1 block text-xs font-semibold uppercase text-[#7A6555]">Adjustment Reason / Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-[#D8C8AA] px-3 py-2 focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30 resize-y"
                placeholder="Physical count correction / write-off / found stock reason"
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-[#E8DCC4] pt-4 lg:col-span-2 lg:flex-row lg:items-center lg:justify-end xl:col-span-3">
              {!canCreate && (
                <p className="mr-auto rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Your current role can view this screen but cannot create stock adjustments.
                </p>
              )}
              <ErpButton
                onClick={() => {
                  void requestSubmitAdjustment();
                }}
                disabled={saving || loading || !canCreate}
                variant="primary"
                className="min-w-[220px]"
              >
                <FileText className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save Adjustment'}
              </ErpButton>
            </div>
          </section>

          <div className="space-y-4">
            <div className="rounded-md border border-[#E8DCC4] bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#4A3426]">Current Stock Snapshot</h2>
                  <p className="mt-0.5 text-xs text-[#7A6555]">Review the selected item and warehouse before posting the adjustment.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
                  <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Item</div>
                    <div className="mt-1 font-semibold text-[#4A3426]">{selectedItem ? ([selectedItem.code, selectedItem.name].filter(Boolean).join(' - ')) : '-'}</div>
                    {selectedItemIsUidTracked && (
                      <div className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold uppercase text-amber-800">
                        UID tracked: {selectedItemUidStrategy}
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Warehouse</div>
                    <div className="mt-1 font-semibold text-[#4A3426]">{selectedWarehouse ? ([selectedWarehouse.code, selectedWarehouse.name].filter(Boolean).join(' - ')) : '-'}</div>
                  </div>
                  <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Available Now</div>
                    <div className="mt-1 font-semibold text-[#4A3426]">{formatNumber(currentAvailable)} {selectedItem?.uom || ''}</div>
                    {stockLoading && <div className="mt-1 text-xs text-gray-500">Refreshing stock...</div>}
                  </div>
                </div>
              </div>

              {draftSummary && (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-4 py-3 text-sm">
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Movement</div>
                    <div className="mt-1 font-bold text-[#4A3426]">{selectedMovementType}</div>
                    <div className="text-xs text-[#7A6555]">{selectedMovementLabel}</div>
                  </div>
                  <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-4 py-3 text-sm">
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Stock Change</div>
                    <div className={`mt-1 font-bold ${draftSummary.delta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {draftSummary.delta >= 0 ? '+' : ''}{formatNumber(draftSummary.delta)}
                    </div>
                  </div>
                  <div className="rounded-md border border-[#E8DCC4] bg-[#FFFCF5] px-4 py-3 text-sm">
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Resulting Stock</div>
                    <div className="mt-1 font-bold text-[#4A3426]">{formatNumber(draftSummary.result)} {selectedItem?.uom || ''}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-md border border-[#E8DCC4] bg-white">
              <div className="border-b border-[#E8DCC4] bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-[#4A3426]">Recent Adjustments</h2>
                    <p className="mt-0.5 text-xs text-[#7A6555]">Latest ADJUSTMENT movements across warehouses.</p>
                  </div>
                  <ErpButton
                    type="button"
                    onClick={() => setPrintDialog(prev => ({ ...prev, open: true }))}
                    variant="secondary"
                    size="sm"
                  >
                    <Printer className="h-4 w-4" />
                    Print Report
                  </ErpButton>
                </div>
              </div>

              {loading ? (
                <div className="p-6 text-gray-600">Loading adjustments...</div>
              ) : adjustments.length === 0 ? (
                <div className="p-6 text-gray-600">No stock adjustments found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[#E8DCC4]">
                    <thead className="bg-[#F5EFE3]">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Movement</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Item</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Direction</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Quantity</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Date</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-[#5E4635]">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8DCC4] bg-white">
                      {adjustments.map((movement) => {
                        const isIncrease = !!movement.to_warehouse && !movement.from_warehouse;
                        const isDecrease = !!movement.from_warehouse && !movement.to_warehouse;
                        const directionLabel = isIncrease
                          ? `Increase → ${movement.to_warehouse?.name || movement.to_warehouse?.code || '-'}`
                          : isDecrease
                            ? `Decrease ← ${movement.from_warehouse?.name || movement.from_warehouse?.code || '-'}`
                            : 'Warehouse transfer';

                        return (
                          <tr key={movement.id}>
                            <td className="px-6 py-4 text-sm font-medium text-[#36454F] whitespace-nowrap">{movement.movement_number}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">
                              {[movement.items?.code, movement.items?.name].filter(Boolean).join(' - ') || '-'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-700">{directionLabel}</td>
                            <td className={`px-6 py-4 text-sm font-semibold ${isDecrease ? 'text-red-700' : 'text-emerald-700'}`}>
                              {isDecrease ? '-' : '+'}{formatNumber(Number(movement.quantity || 0))}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-700 whitespace-nowrap">{formatDateTime(movement.movement_date)}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{movement.notes || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {printDialog.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#8B6F47]/20 bg-white shadow-2xl">
              <div className="border-b border-[#8B6F47]/15 bg-[#F7F1E6] px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-[#36454F]">Print Stock Adjustments</h2>
                  <button
                    type="button"
                    onClick={() => setPrintDialog({ open: false, fromDate: '', toDate: '', category: '', itemId: '', printing: false })}
                    className="rounded-md px-2 py-1 text-sm font-semibold text-gray-500 hover:bg-white hover:text-gray-700"
                  >
                    Close
                  </button>
                </div>
                <p className="mt-1 text-sm text-[#6F4E37]">Leave filters blank to print all adjustments.</p>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold tracking-wide uppercase text-gray-600 mb-1">From Date</label>
                    <DateInput
                      value={printDialog.fromDate}
                      onChange={(value) => setPrintDialog(prev => ({ ...prev, fromDate: value }))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold tracking-wide uppercase text-gray-600 mb-1">To Date</label>
                    <DateInput
                      value={printDialog.toDate}
                      onChange={(value) => setPrintDialog(prev => ({ ...prev, toDate: value }))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold tracking-wide uppercase text-gray-600 mb-1">Category</label>
                  <select
                    value={printDialog.category}
                    onChange={e => setPrintDialog(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">All Categories</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold tracking-wide uppercase text-gray-600 mb-1">Part Number / Item</label>
                  <SearchableSelect
                    options={[
                      { value: '', label: 'All Items', subtitle: '' },
                      ...itemOptions,
                    ]}
                    value={printDialog.itemId}
                    onChange={val => setPrintDialog(prev => ({ ...prev, itemId: val }))}
                    placeholder="All Items"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-[#8B6F47]/15 bg-white px-6 py-4">
                <button
                  type="button"
                  onClick={() => setPrintDialog({ open: false, fromDate: '', toDate: '', category: '', itemId: '', printing: false })}
                  className="rounded-lg border border-gray-200 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={printDialog.printing}
                  onClick={() => { void printAdjustments(); }}
                  className="rounded-lg bg-[#8B6F47] px-6 py-2 font-semibold text-white hover:bg-[#6F4E37] disabled:opacity-50"
                >
                  {printDialog.printing ? 'Generating...' : 'Print'}
                </button>
              </div>
            </div>
          </div>
        )}

        {uidDialogState.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-[#8B6F47]/20 bg-white shadow-2xl">
              <div className="border-b border-[#8B6F47]/15 bg-[#F7F1E6] px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-[#36454F]">
                      {uidDialogState.action === 'increase' ? 'Generate UIDs for Stock Increase' : 'Select UIDs to Remove'}
                    </h2>
                    <p className="mt-1 text-sm text-[#6F4E37]">
                      {uidDialogState.itemLabel} in {uidDialogState.warehouseLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeUidDialog}
                    className="rounded-md px-2 py-1 text-sm font-semibold text-gray-500 hover:bg-white hover:text-gray-700"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="rounded-xl border border-[#8B6F47]/15 bg-[#FFF9F0] px-4 py-3 text-sm text-[#6F4E37]">
                  <div><span className="font-semibold">Adjustment quantity:</span> {formatNumber(uidDialogState.quantity)} {selectedItem?.uom || ''}</div>
                  <div><span className="font-semibold">UID strategy:</span> {uidDialogState.strategy}</div>
                  <div><span className="font-semibold">Required UID count:</span> {uidDialogState.requiredCount}</div>
                  {uidDialogState.strategy === 'BATCHED' && (
                    <div><span className="font-semibold">Batch quantity per UID:</span> {formatNumber(uidDialogState.qtyPerUid)} {selectedItem?.batch_uom || selectedItem?.uom || ''}</div>
                  )}
                </div>

                {uidDialogState.error && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {uidDialogState.error}
                  </div>
                )}

                {uidDialogState.action === 'increase' ? (
                  <div className="space-y-4">
                    <label className="flex items-start gap-3 rounded-xl border border-[#8B6F47]/15 bg-white px-4 py-4">
                      <input
                        type="checkbox"
                        checked={uidDialogState.generateUids}
                        onChange={(e) => setUidDialogState((prev) => ({ ...prev, generateUids: e.target.checked }))}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-[#8B6F47] focus:ring-[#8B6F47]"
                      />
                      <div>
                        <div className="font-semibold text-[#36454F]">Generate {uidDialogState.requiredCount} UID(s) with this increase</div>
                        <div className="mt-1 text-sm text-gray-600">
                          Leave this checked to create UID records immediately after stock is increased.
                        </div>
                      </div>
                    </label>

                    {!uidDialogState.generateUids && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Stock will increase without creating matching UIDs. Use this only if you plan to reconcile UIDs separately.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-gray-600">
                        Select exactly {uidDialogState.requiredCount} UID(s) to remove from stock.
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setUidDialogState((prev) => ({
                            ...prev,
                            selectedUids: prev.availableUids.slice(0, prev.requiredCount).map((entry) => entry.uid),
                          }))}
                          className="rounded-lg border border-[#8B6F47]/20 px-3 py-2 text-sm font-semibold text-[#6F4E37] hover:bg-[#F7F1E6]"
                        >
                          Auto-select
                        </button>
                        <button
                          type="button"
                          onClick={() => setUidDialogState((prev) => ({ ...prev, selectedUids: [] }))}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
                      Selected: {uidDialogState.selectedUids.length} / {uidDialogState.requiredCount}
                    </div>

                    <div className="max-h-[360px] overflow-y-auto rounded-xl border border-gray-200">
                      {uidDialogState.loading ? (
                        <div className="p-4 text-sm text-gray-600">Loading eligible UIDs...</div>
                      ) : uidDialogState.availableUids.length === 0 ? (
                        <div className="p-4 text-sm text-gray-600">No eligible UIDs found for this item.</div>
                      ) : (
                        <div className="divide-y divide-gray-200">
                          {uidDialogState.availableUids.map((entry) => {
                            const checked = uidDialogState.selectedUids.includes(entry.uid);
                            const selectionLimitReached = !checked && uidDialogState.selectedUids.length >= uidDialogState.requiredCount;

                            return (
                              <label key={entry.uid} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-[#FFF9F0]">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={selectionLimitReached}
                                  onChange={(e) => {
                                    const nextChecked = e.target.checked;
                                    setUidDialogState((prev) => ({
                                      ...prev,
                                      selectedUids: nextChecked
                                        ? [...prev.selectedUids, entry.uid]
                                        : prev.selectedUids.filter((uid) => uid !== entry.uid),
                                    }));
                                  }}
                                  className="mt-1 h-4 w-4 rounded border-gray-300 text-[#8B6F47] focus:ring-[#8B6F47]"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-[#36454F]">{entry.uid}</div>
                                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                                    <span>Status: {entry.status || '-'}</span>
                                    <span>Location: {entry.location || '-'}</span>
                                    <span>Created: {formatDateTime(entry.created_at)}</span>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-[#8B6F47]/15 bg-white px-6 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeUidDialog}
                  className="rounded-lg border border-gray-200 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void confirmUidDialog();
                  }}
                  disabled={saving || uidDialogState.loading || !!uidDialogState.error || (uidDialogState.action === 'decrease' && uidDialogState.selectedUids.length !== uidDialogState.requiredCount)}
                  className="rounded-lg bg-[#8B6F47] px-4 py-2 font-semibold text-white hover:bg-[#6F4E37] disabled:opacity-50"
                >
                  {saving
                    ? 'Saving...'
                    : uidDialogState.action === 'increase'
                      ? 'Apply Increase'
                      : 'Remove Selected UIDs'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
