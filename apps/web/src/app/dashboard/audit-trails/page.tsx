'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Calendar, ChevronLeft, ChevronRight, Filter, History, RefreshCw, Search, ShieldCheck, User } from 'lucide-react';
import DateInput from '../../../components/ui/DateInput';

type AuditUser = {
  id: string;
  name: string;
  email?: string;
};

type AuditLog = {
  id: string;
  user_id?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  resource_code?: string | null;
  resource_name?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, any> | null;
  old_value?: any;
  new_value?: any;
  created_at: string;
  user?: AuditUser | null;
};

type AuditResponse = {
  data: AuditLog[];
  total: number;
  limit: number;
  offset: number;
};

type FilterOptions = {
  actions: string[];
  resourceTypes: string[];
};

const PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  UPDATE_STATUS: 'Status Changed',
  DELETE: 'Deleted',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  CANCEL: 'Cancelled',
  SUBMIT: 'Submitted',
  SEND: 'Sent',
  UPLOAD: 'Uploaded',
  IMPORT: 'Imported',
  EXPORT: 'Exported',
  GENERATE: 'Generated',
  VERIFY: 'Verified',
};

const RESOURCE_LABELS: Record<string, string> = {
  purchase_order: 'Purchase Order',
  purchase_requisition: 'Purchase Requisition',
  purchase_vendor: 'Vendor',
  purchase_grn: 'GRN',
  purchase_debit_note: 'Debit Note',
  inventory_item: 'Stock Item',
  inventory_siv: 'SIV',
  inventory_srv: 'SRV',
  sales_order: 'Sales Order',
  document: 'Document',
  document_category: 'Document Category',
  user: 'User',
  role: 'Role',
};

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLabel(value?: string | null): string {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function isUuid(value?: string | null): boolean {
  return UUID_PATTERN.test(String(value || '').trim());
}

function isReadableValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return !!trimmed && !isUuid(trimmed) && !trimmed.startsWith('http') && trimmed !== '[REDACTED]';
}

function getNestedValue(source: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], source);
}

function firstReadable(source: any, paths: string[]): string {
  for (const path of paths) {
    const value = getNestedValue(source, path);
    if (isReadableValue(value)) return value.trim();
  }
  return '';
}

function formatAction(value?: string | null): string {
  const action = String(value || '').toUpperCase();
  if (action.startsWith('FAILED_')) {
    const base = action.replace('FAILED_', '');
    return `${ACTION_LABELS[base] || formatLabel(base)} Failed`;
  }
  return ACTION_LABELS[action] || formatLabel(action);
}

function formatResourceType(value?: string | null): string {
  const key = String(value || '').toLowerCase();
  return RESOURCE_LABELS[key] || formatLabel(value);
}

function getRequestPayload(log: AuditLog): any {
  return log.new_value?.request || log.metadata?.request || {};
}

function getResponsePayload(log: AuditLog): any {
  return log.new_value?.response || {};
}

function getDocumentReference(log: AuditLog): string {
  const request = getRequestPayload(log);
  const response = getResponsePayload(log);
  const direct = [log.resource_code, log.resource_name].find((value) => isReadableValue(value));
  if (direct) return direct.trim();

  return firstReadable({ request, response }, [
    'response.po_number',
    'response.pr_number',
    'response.grn_number',
    'response.so_number',
    'response.quotation_number',
    'response.item_code',
    'response.code',
    'response.name',
    'response.item_name',
    'request.poNumber',
    'request.po_number',
    'request.prNumber',
    'request.grnNumber',
    'request.itemCode',
    'request.itemName',
    'request.name',
    'request.projectName',
  ]);
}

function getAreaName(log: AuditLog): string {
  const path = String(log.metadata?.path || '');
  if (path.includes('/purchase/orders')) return 'Purchase Orders';
  if (path.includes('/purchase/requisitions')) return 'Purchase Requisitions';
  if (path.includes('/purchase/grn')) return 'GRN';
  if (path.includes('/purchase/vendors')) return 'Vendors';
  if (path.includes('/inventory/items')) return 'Stock Master';
  if (path.includes('/inventory')) return 'Inventory';
  if (path.includes('/sales')) return 'Sales';
  if (path.includes('/hr')) return 'HR';
  if (path.includes('/documents')) return 'Documents';
  return formatResourceType(log.resource_type);
}

function formatCurrency(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return '';
  return amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
}

function getLogAmount(log: AuditLog): string {
  const request = getRequestPayload(log);
  const response = getResponsePayload(log);
  return formatCurrency(request.grandTotal || request.totalAmount || response.grand_total || response.grandTotal || response.total_amount);
}

function getItemCount(log: AuditLog): string {
  const request = getRequestPayload(log);
  const response = getResponsePayload(log);
  const items = Array.isArray(request.items) ? request.items : Array.isArray(response.items) ? response.items : [];
  if (items.length === 0) return '';
  return `${items.length} item${items.length === 1 ? '' : 's'}`;
}

function getAttachmentNames(log: AuditLog): string[] {
  const request = getRequestPayload(log);
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  return attachments
    .map((entry: any) => String(entry?.name || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function getUserName(log: AuditLog): string {
  const name = log.user?.name || log.user?.email;
  return isReadableValue(name) ? name : 'System User';
}

function toIsoFromDateInput(value: string, endOfDay = false): string {
  if (!value) return '';
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function summarizeChange(log: AuditLog): string {
  const documentRef = getDocumentReference(log);
  const amount = getLogAmount(log);
  const itemCount = getItemCount(log);
  const bits = [documentRef, amount, itemCount].filter(Boolean);
  return bits.length > 0 ? bits.join(' | ') : getAreaName(log);
}

function getPlainDetails(log: AuditLog): Array<{ label: string; value: string }> {
  const request = getRequestPayload(log);
  const details = [
    { label: 'Area', value: getAreaName(log) },
    { label: 'Document', value: getDocumentReference(log) || formatResourceType(log.resource_type) },
    { label: 'Action', value: formatAction(log.action) },
    { label: 'Status', value: String(log.metadata?.status_code || '').startsWith('2') ? 'Successful' : log.action?.startsWith('FAILED_') ? 'Failed' : 'Completed' },
    { label: 'Amount', value: getLogAmount(log) },
    { label: 'Items', value: getItemCount(log) },
    { label: 'Remarks', value: isReadableValue(request.remarks) ? request.remarks : '' },
    { label: 'Project', value: isReadableValue(request.projectName) ? request.projectName : '' },
    { label: 'Attachments', value: getAttachmentNames(log).join(', ') },
    { label: 'IP Address', value: log.ip_address || '' },
  ];

  return details.filter((detail) => !!detail.value && detail.value !== '-');
}

export default function AuditTrailsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filters, setFilters] = useState<FilterOptions>({ actions: [], resourceTypes: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (search.trim()) params.set('search', search.trim());
    if (action) params.set('action', action);
    if (resourceType) params.set('resourceType', resourceType);

    const fromIso = toIsoFromDateInput(fromDate);
    const toIso = toIsoFromDateInput(toDate, true);
    if (fromIso) params.set('from', fromIso);
    if (toIso) params.set('to', toIso);
    return params.toString();
  }, [action, fromDate, offset, resourceType, search, toDate]);

  const loadFilters = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    const response = await fetch('/api/v1/audit/activity-logs/filters', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const data = await response.json();
      setFilters({
        actions: Array.isArray(data.actions) ? data.actions : [],
        resourceTypes: Array.isArray(data.resourceTypes) ? data.resourceTypes : [],
      });
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/audit/activity-logs?${queryString}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to load audit trails');
      }

      const data: AuditResponse = await response.json();
      setLogs(Array.isArray(data.data) ? data.data : []);
      setTotal(Number(data.total || 0));
    } catch (err: any) {
      setError(err?.message || 'Failed to load audit trails');
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const resetFilters = () => {
    setSearch('');
    setAction('');
    setResourceType('');
    setFromDate('');
    setToDate('');
    setOffset(0);
  };

  const changePage = (direction: 'prev' | 'next') => {
    setExpandedId(null);
    setOffset((current) => {
      if (direction === 'prev') return Math.max(0, current - PAGE_SIZE);
      return current + PAGE_SIZE >= total ? current : current + PAGE_SIZE;
    });
  };

  const todayCount = logs.filter((log) => {
    const created = new Date(log.created_at);
    const now = new Date();
    return created.toDateString() === now.toDateString();
  }).length;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <History className="h-6 w-6 text-[#8B6F47]" />
            Audit Trails
          </h1>
          <p className="mt-1 text-sm text-gray-600">Review who changed key ERP records, when it happened, and what business document was affected.</p>
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-[#8B6F47]/30 bg-white px-3 py-2 text-sm font-medium text-[#6F4E37] hover:bg-[#F5EFE3] disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-500"><Activity className="h-4 w-4" />Current Result</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{total}</div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-500"><Calendar className="h-4 w-4" />Shown Today</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{todayCount}</div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-500"><ShieldCheck className="h-4 w-4" />Page</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{page} / {pageCount}</div>
        </div>
      </div>

      <details className="rounded-md border border-gray-200 bg-white" open={Boolean(search || action || resourceType || fromDate || toDate)}>
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-800">
          <Filter className="h-4 w-4" />
          Filters{search || action || resourceType || fromDate || toDate ? ' (active)' : ''}
        </summary>
        <div className="space-y-3 border-t border-gray-100 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="block xl:col-span-2">
            <span className="text-xs font-medium text-gray-600">Search</span>
            <div className="mt-1 flex items-center rounded-md border border-gray-300 bg-white px-2">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setOffset(0); }}
                placeholder="PO number, document, user, action"
                className="w-full px-2 py-2 text-sm outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Action</span>
            <select value={action} onChange={(event) => { setAction(event.target.value); setOffset(0); }} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm">
              <option value="">All Actions</option>
              {filters.actions.map((item) => <option key={item} value={item}>{formatAction(item)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Resource</span>
            <select value={resourceType} onChange={(event) => { setResourceType(event.target.value); setOffset(0); }} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm">
              <option value="">All Resources</option>
              {filters.resourceTypes.map((item) => <option key={item} value={item}>{formatResourceType(item)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">From</span>
            <DateInput value={fromDate} onChange={(value) => { setFromDate(value); setOffset(0); }} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">To</span>
            <DateInput value={toDate} onChange={(value) => { setToDate(value); setOffset(0); }} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm" />
          </label>
          </div>
          <button onClick={resetFilters} className="text-sm font-medium text-[#6F4E37] hover:underline">Clear filters</button>
        </div>
      </details>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-md border border-gray-200 bg-white">
        <div className="grid grid-cols-[120px_150px_170px_minmax(220px,1fr)_160px] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-500 max-lg:hidden">
          <div>Time</div>
          <div>Action</div>
          <div>User</div>
          <div>Document / Area</div>
          <div>Source</div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading audit trails...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No audit trails found.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => {
              const expanded = expandedId === log.id;
              return (
                <div key={log.id} className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : log.id)}
                    className="grid w-full grid-cols-1 gap-2 text-left lg:grid-cols-[120px_150px_170px_minmax(220px,1fr)_160px] lg:gap-3"
                  >
                    <div className="text-xs font-medium text-gray-600">{formatDate(log.created_at)}</div>
                    <div><span className="inline-flex break-words rounded bg-[#F5EFE3] px-2 py-1 text-xs font-semibold text-[#6F4E37]">{formatAction(log.action)}</span></div>
                    <div className="min-w-0 text-sm text-gray-800">
                      <div className="flex items-center gap-1 font-medium"><User className="h-3.5 w-3.5 text-gray-400" />{getUserName(log)}</div>
                      <div className="break-words text-xs text-gray-500">{log.user?.email && log.user.email !== getUserName(log) ? log.user.email : 'Authenticated user'}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold text-gray-900">{formatResourceType(log.resource_type)}</div>
                      <div className="break-words text-xs text-gray-500">{summarizeChange(log)}</div>
                    </div>
                    <div className="break-words text-xs text-gray-500">{getAreaName(log)}</div>
                  </button>

                  {expanded && (
                    <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                      <div className="mb-2 font-semibold text-gray-900">Activity Details</div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {getPlainDetails(log).map((detail) => (
                          <div key={detail.label} className="rounded border border-gray-200 bg-white px-3 py-2">
                            <div className="text-[11px] font-semibold uppercase text-gray-500">{detail.label}</div>
                            <div className="mt-1 break-words text-sm font-medium text-gray-900">{detail.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-gray-600">Showing {logs.length ? offset + 1 : 0}-{offset + logs.length} of {total}</div>
          <div className="flex gap-2">
            <button onClick={() => changePage('prev')} disabled={offset === 0 || loading} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button onClick={() => changePage('next')} disabled={offset + PAGE_SIZE >= total || loading} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
