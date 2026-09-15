'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Download, ExternalLink, FileText, Printer, RefreshCw, Search, ShoppingCart } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { getTodayDateInputValue } from '@/lib/date';
import { buildDocumentBranding } from '@/lib/document-branding';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { ErpButton, ErpMetricStrip, ErpPageHeader } from '@/components/ui/ErpPrimitives';
import { smartSearchMatches } from '@/lib/smart-search';

type LowStockRow = {
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  category?: string;
  hsn_code?: string | null;
  available_qty: number;
  avg_daily_consumption?: number | null;
  coverage_days?: number | null;
  forecast_window_days?: number;
  reorder_level: number;
  reorder_qty: number;
  open_pr_qty: number;
  open_po_qty: number;
  open_pr_refs?: ProcurementRef[];
  open_po_refs?: ProcurementRef[];
  suggested_purchase_qty: number;
  preferred_vendor_id?: string | null;
  preferred_vendor_code?: string | null;
  preferred_vendor_name?: string | null;
  preferred_price: number;
  purchasable: boolean;
  block_reason?: string | null;
  ignored?: boolean;
  ignored_at?: string | null;
  ignored_by?: string | null;
  ignored_reason?: string | null;
};

type ProcurementRef = {
  id: string;
  number: string;
  qty: number;
  status?: string | null;
};

type PlanningResponse = {
  generated_at: string;
  items: LowStockRow[];
  ignored_items?: LowStockRow[];
  summary: {
    low_stock: number;
    ignored?: number;
    missing_vendor: number;
    covered_by_open_supply: number;
  };
};

type CreatedPr = {
  id: string;
  pr_number: string;
  vendor_name: string;
  item_count: number;
  status: string;
};

const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const currencyFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function LowStockPlanningPage() {
  const router = useRouter();
  const currentUser = readStoredUser();
  const canCreatePr = hasModulePermission(currentUser, 'Purchase Management', 'create');
  const canManageInventory = hasModulePermission(currentUser, 'Inventory', 'edit') || hasModulePermission(currentUser, 'Inventory', 'approve');
  const [planning, setPlanning] = useState<PlanningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [updatingIgnoreId, setUpdatingIgnoreId] = useState<string | null>(null);
  const [activeList, setActiveList] = useState<'planning' | 'ignored'>('planning');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('ALL');
  const [requiredDate, setRequiredDate] = useState(() => addDays(getTodayDateInputValue(), 7));
  const [priority, setPriority] = useState('MEDIUM');
  const [createdPrs, setCreatedPrs] = useState<CreatedPr[]>([]);

  const loadPlanning = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<PlanningResponse>('/inventory/low-stock-planning');
      setPlanning(response);
      setQuantities((previous) => {
        const next: Record<string, number> = {};
        for (const row of response.items || []) {
          next[row.item_id] = previous[row.item_id] ?? Number(row.suggested_purchase_qty || 0);
        }
        return next;
      });
      setSelectedIds((previous) => new Set([...previous].filter((id) => response.items.some((row) => row.item_id === id))));
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load low-stock planning data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlanning();
  }, []);

  const activeRows = planning?.items || [];
  const ignoredRows = planning?.ignored_items || [];
  const listRows = activeList === 'ignored' ? ignoredRows : activeRows;

  const vendors = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of [...activeRows, ...ignoredRows]) {
      if (row.preferred_vendor_id) map.set(row.preferred_vendor_id, row.preferred_vendor_name || row.preferred_vendor_code || 'Supplier');
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [activeRows, ignoredRows]);

  const filteredRows = useMemo(() => {
    return listRows.filter((row) => {
      const matchesSearch = smartSearchMatches(
        search,
        row.item_code,
        row.item_name,
        row.preferred_vendor_name,
        row.hsn_code,
      );
      const matchesVendor = vendorFilter === 'ALL'
        || (vendorFilter === 'MISSING' ? !row.preferred_vendor_id : row.preferred_vendor_id === vendorFilter);
      return matchesSearch && matchesVendor;
    });
  }, [listRows, search, vendorFilter]);

  const selectableRows = activeList === 'planning'
    ? filteredRows.filter((row) => row.purchasable && Number(quantities[row.item_id] || 0) > 0)
    : [];
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedIds.has(row.item_id));
  const selectedRows = activeRows.filter((row) => selectedIds.has(row.item_id));
  const selectedValue = selectedRows.reduce((sum, row) => sum + Number(quantities[row.item_id] || 0) * Number(row.preferred_price || 0), 0);

  const openProcurementRef = (type: 'PR' | 'PO', ref: ProcurementRef) => {
    if (!ref?.id) return;
    const href = type === 'PR'
      ? `/dashboard/purchase/requisitions?open=${encodeURIComponent(ref.id)}`
      : `/dashboard/purchase/orders?viewId=${encodeURIComponent(ref.id)}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const renderProcurementRefs = (type: 'PR' | 'PO', quantity: number, refs: ProcurementRef[] | undefined, color: 'blue' | 'emerald') => {
    const safeRefs = Array.isArray(refs) ? refs.filter((ref) => ref?.id) : [];
    if (safeRefs.length === 0) return <span>{numberFormat.format(quantity || 0)}</span>;

    const colorClass = color === 'blue'
      ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100';

    return (
      <div className="flex max-w-[160px] flex-col items-end gap-1">
        {safeRefs.map((ref, index) => (
          <button
            key={`${type}-${ref.id}-${index}`}
            type="button"
            onClick={() => openProcurementRef(type, ref)}
            title={`Open ${ref.number || type}; balance ${numberFormat.format(Number(ref.qty || 0))}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${colorClass}`}
          >
            <span>{ref.number || type}</span>
            <span className="font-bold">{numberFormat.format(Number(ref.qty || 0))}</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        ))}
      </div>
    );
  };

  const toggleRow = (row: LowStockRow) => {
    if (!row.purchasable || Number(quantities[row.item_id] || 0) <= 0) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(row.item_id)) next.delete(row.item_id);
      else next.add(row.item_id);
      return next;
    });
  };

  const toggleVisible = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) selectableRows.forEach((row) => next.delete(row.item_id));
      else selectableRows.forEach((row) => next.add(row.item_id));
      return next;
    });
  };

  const ignoreItem = async (row: LowStockRow) => {
    if (!canManageInventory) {
      toast.error('Inventory edit permission is required to ignore low-stock reminders');
      return;
    }
    const reason = window.prompt(`Why should ${row.item_code} be ignored from low-stock reminders?`, 'Not required currently');
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Please enter a short reason');
      return;
    }
    setUpdatingIgnoreId(row.item_id);
    try {
      await apiClient.put(`/inventory/low-stock-planning/${row.item_id}/ignore`, { reason: reason.trim() });
      setSelectedIds((previous) => {
        const next = new Set(previous);
        next.delete(row.item_id);
        return next;
      });
      toast.success(`${row.item_code} moved to Ignore List`);
      await loadPlanning();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to ignore item');
    } finally {
      setUpdatingIgnoreId(null);
    }
  };

  const restoreItem = async (row: LowStockRow) => {
    if (!canManageInventory) {
      toast.error('Inventory edit permission is required to restore low-stock reminders');
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Restore to planning list',
      message: `Restore ${row.item_code} to the active low-stock planning list?`,
      confirmLabel: 'Restore',
      variant: 'info',
    });
    if (!confirmed) return;
    setUpdatingIgnoreId(row.item_id);
    try {
      await apiClient.put(`/inventory/low-stock-planning/${row.item_id}/restore`, { reason: 'Required again' });
      toast.success(`${row.item_code} restored to Low Stock Planning`);
      setActiveList('planning');
      await loadPlanning();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to restore item');
    } finally {
      setUpdatingIgnoreId(null);
    }
  };

  const reportRows = filteredRows.map((row, index) => ({
    'S.No.': index + 1,
    'Item Code': row.item_code,
    'Item Name': row.item_name,
    UOM: row.uom,
    HSN: row.hsn_code || '',
    'System Stock': row.available_qty,
    'Physical Count': '',
    Variance: '',
    'Reorder Level': row.reorder_level,
    'Open PR Qty': row.open_pr_qty,
    'Open PO Qty': row.open_po_qty,
    'Suggested Purchase Qty': row.suggested_purchase_qty,
    'Preferred Supplier': row.preferred_vendor_name || 'Not configured',
    'Preferred Rate': row.preferred_price,
    Remarks: '',
  }));

  const exportExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(reportRows);
    worksheet['!cols'] = [6, 22, 38, 10, 12, 14, 14, 12, 14, 13, 13, 20, 28, 16, 28].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Low Stock');
    XLSX.writeFile(workbook, `Low-Stock-Planning-${getTodayDateInputValue()}.xlsx`);
  };

  const buildPrintableReportHtml = () => {
    const branding = buildDocumentBranding(null);
    const rows = filteredRows.map((row, index) => `
      <tr>
        <td>${index + 1}</td><td>${escapeHtml(row.item_code)}</td><td>${escapeHtml(row.item_name)}</td><td>${escapeHtml(row.uom)}</td><td>${escapeHtml(row.hsn_code || '')}</td>
        <td class="num">${numberFormat.format(row.available_qty)}</td><td class="blank"></td><td class="blank"></td>
        <td class="num">${numberFormat.format(row.reorder_level)}</td><td class="num">${numberFormat.format(row.open_pr_qty)}</td>
        <td class="num">${numberFormat.format(row.open_po_qty)}</td><td class="num">${numberFormat.format(row.suggested_purchase_qty)}</td>
        <td>${escapeHtml(row.preferred_vendor_name || 'Not configured')}</td><td class="blank"></td>
      </tr>`).join('');
    return `<!doctype html><html><head><title>Low Stock Planning</title><style>
      @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#33251c;margin:0}
      .toolbar{position:sticky;top:0;background:#fff7ed;border-bottom:1px solid #cdbdA6;padding:8px;text-align:center}.toolbar button{background:#6f4e37;color:white;border:0;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer}
      .brand{text-align:center;font-size:13px;font-weight:700;color:#6f4e37;margin-top:8px}.title{background:#6f4e37;color:white;text-align:center;padding:8px;font-size:18px;font-weight:700;margin-top:6px}
      .meta{display:flex;justify-content:space-between;font-size:11px;margin:8px 0}table{width:100%;border-collapse:collapse;font-size:9px}
      th{background:#efe6d7;text-transform:uppercase;text-align:left}th,td{border:1px solid #cdbdA6;padding:5px;vertical-align:top}.num{text-align:right}.blank{height:25px;min-width:45px}
      .signatures{display:grid;grid-template-columns:repeat(4,1fr);gap:55px;margin-top:35px;text-align:center;font-size:10px}.line{border-top:1px solid #665247;padding-top:5px}
      .note{font-size:9px;color:#6b5a4c;margin-top:8px}.control{margin:8px 0;padding:8px;border:1px solid #e8dcc4;background:#fffdf8;font-size:10px}
      @media print{.toolbar{display:none}.brand{margin-top:0}}
    </style></head><body>
      <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
      <div class="brand">${escapeHtml(branding.companyName)}</div><div class="title">LOW STOCK PHYSICAL VERIFICATION & PURCHASE PLANNING</div>
      <div class="meta"><span>Generated: ${escapeHtml(new Date().toLocaleString('en-IN'))}</span><span>Total filtered items: ${filteredRows.length}</span><span>Report purpose: Stores verification before purchase</span></div>
      <div class="control"><strong>Stores instruction:</strong> Enter physical count, variance and remarks. Purchase team should use the verified count before creating PRs. R&amp;D temporary items are excluded from this report.</div>
      <table><thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th>HSN</th><th>System Stock</th><th>Physical Count</th><th>Variance</th><th>Reorder Level</th><th>Open PR</th><th>Open PO</th><th>Suggested Purchase</th><th>Preferred Supplier</th><th>Stores Remarks</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="note">System stock is calculated from ledger stock as on report generation. Physical count must be signed before system adjustment or PR generation.</div>
      <div class="signatures"><div class="line">Stores Person</div><div class="line">Stores In-charge</div><div class="line">Purchase</div><div class="line">Authorised Signatory</div></div>
      <script>window.onload=function(){setTimeout(function(){window.print();},300);}</script></body></html>`;
  };

  const downloadPrintableHtml = () => {
    const blob = new Blob([buildPrintableReportHtml()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Low-Stock-Planning-${getTodayDateInputValue()}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1300,height=850');
    if (!popup) {
      downloadPrintableHtml();
      toast.info('Popup was blocked, so a printable report file was downloaded. Open it and choose Print / Save as PDF.');
      return;
    }
    popup.document.write(buildPrintableReportHtml());
    popup.document.close();
  };

  const createPurchaseRequisitions = async () => {
    if (!canCreatePr) {
      toast.error('Purchase Requisition create permission is required');
      return;
    }
    if (selectedRows.length === 0) {
      toast.error('Select at least one item to purchase');
      return;
    }
    const invalid = selectedRows.find((row) => !row.purchasable || Number(quantities[row.item_id] || 0) <= 0);
    if (invalid) {
      toast.error(`${invalid.item_code}: enter a valid quantity and configure an approved preferred supplier`);
      return;
    }
    const supplierCount = new Set(selectedRows.map((row) => row.preferred_vendor_id)).size;
    const confirmed = await confirmDialog({
      title: 'Create supplier-grouped PRs',
      message: `Create ${supplierCount} Purchase Requisition${supplierCount === 1 ? '' : 's'} for ${selectedRows.length} selected item${selectedRows.length === 1 ? '' : 's'} and send them for approval?`,
      confirmLabel: 'Create PRs',
      variant: 'info',
    });
    if (!confirmed) return;

    setPurchasing(true);
    try {
      const result = await apiClient.post<{ message: string; created_prs: CreatedPr[] }>('/inventory/low-stock-planning/purchase', {
        requiredDate,
        priority,
        items: selectedRows.map((row) => ({ itemId: row.item_id, requiredQty: Number(quantities[row.item_id]) })),
      });
      setCreatedPrs(result.created_prs || []);
      setSelectedIds(new Set());
      toast.success(result.message);
      await loadPlanning();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to generate purchase requisitions');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <ErpPageHeader
        eyebrow="INVENTORY PLANNING"
        title="Low Stock Planning"
        description="Verify ledger stock, plan replenishment, and generate supplier-grouped Purchase Requisitions."
        actions={(
          <>
            <ErpButton variant="secondary" onClick={loadPlanning} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</ErpButton>
            <ErpButton variant="secondary" onClick={exportExcel} disabled={!filteredRows.length}><Download className="h-4 w-4" /> Excel</ErpButton>
            <ErpButton variant="secondary" onClick={printReport} disabled={!filteredRows.length}><Printer className="h-4 w-4" /> Print / PDF</ErpButton>
            <ErpButton variant="secondary" onClick={downloadPrintableHtml} disabled={!filteredRows.length}><FileText className="h-4 w-4" /> Print File</ErpButton>
          </>
        )}
      />

      <ErpMetricStrip metrics={[
        { label: 'Low Stock Items', value: planning?.summary.low_stock || 0 },
        { label: 'Ignored Items', value: planning?.summary.ignored || 0 },
        { label: 'Selected to Purchase', value: selectedRows.length },
        { label: 'Missing / Unapproved Supplier', value: planning?.summary.missing_vendor || 0 },
        { label: 'Covered by Open PR / PO', value: planning?.summary.covered_by_open_supply || 0 },
        { label: 'Selected Estimated Value', value: currencyFormat.format(selectedValue) },
      ]} />

      {createdPrs.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold">Purchase Requisitions created and sent for approval</div>
              <div className="mt-1 flex flex-wrap gap-2">{createdPrs.map((pr) => <span key={pr.id} className="rounded-full border border-emerald-300 bg-white px-3 py-1">{pr.pr_number} · {pr.vendor_name} · {pr.item_count} item(s)</span>)}</div>
            </div>
            <ErpButton variant="secondary" onClick={() => router.push('/dashboard/purchase/requisitions')}><FileText className="h-4 w-4" /> View PRs</ErpButton>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-[#D8C8AA] bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E8DCC4] bg-[#FFFDF8] px-4 py-3">
          <label className="min-w-[230px] text-xs font-semibold uppercase tracking-wide text-[#6F4E37]">
            Low-stock workspace
            <select
              value={activeList}
              onChange={(event) => {
                const nextList = event.target.value as typeof activeList;
                setActiveList(nextList);
                if (nextList === 'ignored') setSelectedIds(new Set());
              }}
              className="mt-1 block w-full rounded-lg border border-[#D8C8AA] bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[#4A3526]"
            >
              <option value="planning">Planning List ({planning?.summary.low_stock || 0})</option>
              <option value="ignored">Ignore List ({planning?.summary.ignored || 0})</option>
            </select>
          </label>
          {activeList === 'ignored' && (
            <span className="pb-2 text-xs text-[#7A6555]">Ignored items stay out of reminders and PR creation until restored.</span>
          )}
        </div>
        <div className="grid gap-3 border-b border-[#E8DCC4] bg-[#FFFDF8] p-4 lg:grid-cols-[minmax(260px,1fr)_240px_170px_150px_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8B6F47]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeList === 'ignored' ? 'Search ignored item, HSN or supplier...' : 'Search item, HSN or supplier...'} className="h-10 w-full rounded-lg border border-[#D8C8AA] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#8B6F47]" />
          </label>
          <select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} className="h-10 rounded-lg border border-[#D8C8AA] bg-white px-3 text-sm">
            <option value="ALL">All preferred suppliers</option><option value="MISSING">Missing supplier</option>
            {vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <label className="text-xs font-semibold text-[#6F4E37]">Required date<input type="date" min={getTodayDateInputValue()} value={requiredDate} onChange={(event) => setRequiredDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[#D8C8AA] bg-white px-3 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-[#6F4E37]">Priority<select value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[#D8C8AA] bg-white px-3 text-sm font-normal"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></label>
          <ErpButton variant="primary" onClick={createPurchaseRequisitions} disabled={activeList === 'ignored' || purchasing || !selectedRows.length || !canCreatePr}><ShoppingCart className="h-4 w-4" /> {purchasing ? 'Creating...' : `Purchase (${selectedRows.length})`}</ErpButton>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1450px] w-full text-sm">
            <thead className="bg-[#F5EFE3] text-left text-[11px] uppercase tracking-wide text-[#6F4E37]"><tr>
              <th className="px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select purchasable visible items" /></th>
              <th className="px-3 py-3">Item</th><th className="px-3 py-3">UOM</th><th className="px-3 py-3 text-right">Available</th><th className="px-3 py-3 text-right">Reorder Level</th>
              <th className="px-3 py-3 text-right">Open PR</th><th className="px-3 py-3 text-right">Open PO</th><th className="px-3 py-3 text-right">Avg/day</th><th className="px-3 py-3 text-right">Coverage</th><th className="px-3 py-3 text-right">Suggested</th>
              <th className="px-3 py-3">Required Purchase Qty</th><th className="px-3 py-3">Preferred Supplier</th><th className="px-3 py-3 text-right">Rate</th><th className="px-3 py-3 text-right">Line Value</th><th className="px-3 py-3">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-[#EFE6D7]">
              {loading ? <tr><td colSpan={15} className="p-12 text-center text-[#7A6555]">Loading ledger stock and open procurement...</td></tr>
                : filteredRows.length === 0 ? <tr><td colSpan={15} className="p-12 text-center text-[#7A6555]">{activeList === 'ignored' ? 'No ignored low-stock items match the current filters.' : 'No low-stock items match the current filters.'}</td></tr>
                : filteredRows.map((row) => {
                  const quantity = Number(quantities[row.item_id] || 0);
                  const selected = selectedIds.has(row.item_id);
                  return <tr key={row.item_id} className={selected ? 'bg-amber-50/70' : activeList === 'ignored' ? 'bg-slate-50/60 hover:bg-slate-50' : 'hover:bg-[#FFFDF8]'}>
                    <td className="px-3 py-3 align-top"><input type="checkbox" checked={selected} disabled={activeList === 'ignored' || !row.purchasable || quantity <= 0} onChange={() => toggleRow(row)} /></td>
                    <td className="px-3 py-3 align-top"><div className="font-semibold text-[#3C2A1F]">{row.item_code}</div><div className="mt-0.5 max-w-[320px] text-xs text-[#7A6555]">{row.item_name}</div>{row.hsn_code && <div className="mt-1 text-[10px] text-[#9A8676]">HSN {row.hsn_code}</div>}{activeList === 'ignored' && <div className="mt-2 max-w-[320px] rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">Ignored: {row.ignored_reason || 'No reason recorded'}{row.ignored_at ? ` · ${new Date(row.ignored_at).toLocaleString('en-IN')}` : ''}</div>}</td>
                    <td className="px-3 py-3 align-top">{row.uom || '-'}</td>
                    <td className={`px-3 py-3 text-right align-top font-bold ${row.available_qty <= 0 ? 'text-red-700' : 'text-amber-700'}`}>{numberFormat.format(row.available_qty)}</td>
                    <td className="px-3 py-3 text-right align-top">{numberFormat.format(row.reorder_level)}</td>
                    <td className="px-3 py-3 text-right align-top text-blue-700">{renderProcurementRefs('PR', row.open_pr_qty, row.open_pr_refs, 'blue')}</td>
                    <td className="px-3 py-3 text-right align-top text-emerald-700">{renderProcurementRefs('PO', row.open_po_qty, row.open_po_refs, 'emerald')}</td>
                    <td className="px-3 py-3 text-right align-top">{row.avg_daily_consumption ? numberFormat.format(row.avg_daily_consumption) : '-'}</td>
                    <td className="px-3 py-3 text-right align-top">{row.coverage_days === null || row.coverage_days === undefined ? '-' : `${numberFormat.format(row.coverage_days)} d`}</td>
                    <td className="px-3 py-3 text-right align-top font-semibold">{numberFormat.format(row.suggested_purchase_qty)}</td>
                    <td className="px-3 py-3 align-top"><input type="number" min="0" step="0.001" disabled={activeList === 'ignored' || !row.purchasable} value={quantities[row.item_id] ?? 0} onChange={(event) => { const value = Math.max(0, Number(event.target.value || 0)); setQuantities((previous) => ({ ...previous, [row.item_id]: value })); if (value <= 0) setSelectedIds((previous) => { const next = new Set(previous); next.delete(row.item_id); return next; }); }} className="h-9 w-32 rounded-md border border-[#CDBDA6] px-2 text-right font-semibold disabled:bg-gray-100" /></td>
                    <td className="px-3 py-3 align-top">{row.purchasable ? <><div className="font-semibold text-[#4A3426]">{row.preferred_vendor_name}</div><div className="text-[10px] text-emerald-700">Approved preferred supplier</div></> : <div className="max-w-[230px] rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">{row.block_reason}</div>}</td>
                    <td className="px-3 py-3 text-right align-top">{currencyFormat.format(row.preferred_price || 0)}</td><td className="px-3 py-3 text-right align-top font-semibold">{currencyFormat.format(quantity * Number(row.preferred_price || 0))}</td>
                    <td className="px-3 py-3 align-top">
                      {activeList === 'ignored' ? (
                        <ErpButton variant="secondary" onClick={() => restoreItem(row)} disabled={updatingIgnoreId === row.item_id || !canManageInventory}>Restore</ErpButton>
                      ) : (
                        <ErpButton variant="secondary" onClick={() => ignoreItem(row)} disabled={updatingIgnoreId === row.item_id || !canManageInventory}>Ignore</ErpButton>
                      )}
                    </td>
                  </tr>;
                })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E8DCC4] bg-[#FFFDF8] px-4 py-3 text-xs text-[#6F4E37]">
          <span>Stock is calculated from the inventory ledger. R&amp;D temporary items are excluded.</span>
          <span>Each preferred supplier creates a separate PR and every generated PR is sent for approval.</span>
        </div>
      </section>
    </div>
  );
}
