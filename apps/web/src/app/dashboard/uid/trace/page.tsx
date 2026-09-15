'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../../lib/api-client';
import { buildDocumentBranding } from '../../../../lib/document-branding';

interface LifecycleEvent {
  stage: string;
  timestamp: string;
  location: string;
  reference: string;
  user: string;
}

interface Component {
  uid: string;
  item_code: string;
  item_name: string;
  batch_number: string;
  vendor_name?: string;
  received_date: string;
  qc_status: string;
}

interface UIDTrace {
  uid: string;
  entity_type: string;
  item: {
    code: string;
    name: string;
    category: string;
  };
  status: string;
  location: string;
  batch_number?: string;
  lifecycle: LifecycleEvent[];
  components: Component[];
  parent_products: Array<{
    uid: string;
    item_code: string;
    item_name: string;
  }>;
  vendor: {
    name: string;
    code: string;
    phone: string;
    gstin: string;
  } | null;
  purchase_order?: {
    id?: string;
    po_number: string;
    order_date: string;
    total_amount: number;
    quotation_ref?: string | null;
  } | null;
  purchase_requisition?: {
    id?: string;
    pr_number: string;
    parent_pr_number?: string | null;
  } | null;
  grn?: {
    id?: string;
    grn_number: string;
    grn_date: string;
    invoice_number?: string | null;
    invoice_date?: string | null;
  } | null;
  job_order?: {
    id?: string;
    job_order_number: string;
    status?: string | null;
    quantity?: number | null;
    start_date?: string | null;
    completion_date?: string | null;
  } | null;
  documents: TraceDocumentLink[];
  quality_checkpoints: Array<{
    stage: string;
    status: string;
    date: string;
    inspector: string;
    notes: string;
  }>;
  customer: {
    name: string;
    location: string;
    delivery_date: string;
    invoice_number: string;
  } | null;
}

interface TraceabilityRow {
  grn_id?: string | null;
  po_id?: string | null;
  pr_id?: string | null;
  parent_pr_id?: string | null;
  job_order_id?: string | null;
  uid: string;
  part_code: string;
  part_name: string;
  product_category: string;
  supplier_name: string | null;
  supplier_code: string | null;
  supplier_gst: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_file_url?: string | null;
  invoice_file_name?: string | null;
  invoice_file_type?: string | null;
  grn_number: string | null;
  grn_date: string | null;
  po_number?: string | null;
  po_date?: string | null;
  po_total_amount?: number | null;
  po_quotation_ref?: string | null;
  po_attachments?: Array<Record<string, any>> | null;
  pr_number?: string | null;
  parent_pr_number?: string | null;
  work_order_number: string | null;
  work_order_status: string | null;
  work_order_quantity: number | null;
  work_order_start_date: string | null;
  work_order_completion_date: string | null;
  assembly_item_code: string | null;
  assembly_name: string | null;
  level: number;
  usage_type: string;
  work_order_path: string[] | null;
  report_generated_at: string;
}

type TraceDocumentLink = {
  id: string;
  label: string;
  name: string;
  href: string;
  type: 'file' | 'api' | 'page';
};

const isExternalUrl = (url: string) => /^(https?:|data:|blob:)/i.test(url);

const normalizeDocumentUrl = (url: string) => {
  if (!url) return '';
  if (isExternalUrl(url) || url.startsWith('/')) return url;
  return `/${url}`;
};

function TraceProductContent() {
  const searchParams = useSearchParams();
  const branding = buildDocumentBranding(null);
  const [searchUID, setSearchUID] = useState(searchParams?.get('uid') || '');
  const [traceData, setTraceData] = useState<UIDTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [traceabilityRows, setTraceabilityRows] = useState<TraceabilityRow[]>([]);

  const buildDocumentLinks = (row: TraceabilityRow): TraceDocumentLink[] => {
    const links: TraceDocumentLink[] = [];
    const seen = new Set<string>();
    const addLink = (link: TraceDocumentLink) => {
      const key = `${link.label}:${link.href}:${link.name}`;
      if (!link.href || seen.has(key)) return;
      seen.add(key);
      links.push(link);
    };

    if (row.po_id && row.po_number) {
      addLink({
        id: `po-pdf-${row.po_id}`,
        label: 'Purchase Order PDF',
        name: row.po_number,
        href: `/api/v1/purchase/orders/${row.po_id}/pdf/world-class`,
        type: 'api',
      });
    }

    if (row.invoice_file_url) {
      addLink({
        id: `invoice-${row.grn_id || row.grn_number || 'file'}`,
        label: 'Vendor Invoice',
        name: row.invoice_file_name || row.invoice_number || 'Invoice file',
        href: normalizeDocumentUrl(row.invoice_file_url),
        type: 'file',
      });
    }

    (row.po_attachments || []).forEach((attachment, index) => {
      const url = String(attachment?.url || attachment?.fileUrl || attachment?.href || '').trim();
      if (!url) return;
      addLink({
        id: `po-attachment-${index}`,
        label: 'PO Attachment',
        name: String(attachment?.name || attachment?.fileName || attachment?.label || `Attachment ${index + 1}`),
        href: normalizeDocumentUrl(url),
        type: 'file',
      });
    });

    if (row.grn_number) {
      addLink({
        id: `grn-page-${row.grn_id || row.grn_number}`,
        label: 'GRN Record',
        name: row.grn_number,
        href: `/dashboard/purchase/grn?search=${encodeURIComponent(row.grn_number)}`,
        type: 'page',
      });
    }

    if (row.pr_number) {
      addLink({
        id: `pr-page-${row.pr_id || row.pr_number}`,
        label: 'PR Record',
        name: row.pr_number,
        href: `/dashboard/purchase/requisitions?search=${encodeURIComponent(row.pr_number)}`,
        type: 'page',
      });
    }

    if (row.work_order_number) {
      addLink({
        id: `job-order-page-${row.job_order_id || row.work_order_number}`,
        label: 'Job Order Record',
        name: row.work_order_number,
        href: `/dashboard/production/job-orders?search=${encodeURIComponent(row.work_order_number)}`,
        type: 'page',
      });
    }

    return links;
  };

  const openDocument = async (document: TraceDocumentLink) => {
    if (document.type !== 'api') {
      window.open(document.href, '_blank', 'noopener,noreferrer');
      return;
    }

    const token = localStorage.getItem('accessToken');
    const response = await fetch(document.href, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error('Unable to open document');
    const blob = await response.blob();
    window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
  };

  const resolveVendorDetails = async (row: TraceabilityRow) => {
    const gstin = row.supplier_gst || '-';
    const fallback = row.supplier_name
      ? {
          name: row.supplier_name,
          code: row.supplier_code || '-',
          phone: '-',
          gstin,
        }
      : null;

    const search = (row.supplier_code || row.supplier_name || '').trim();
    if (!search) return fallback;

    try {
      const vendors = await apiClient.get<any[]>(`/purchase/vendors`, { search });
      const list = Array.isArray(vendors) ? vendors : [];
      const exactByCode = row.supplier_code
        ? list.find((v) => String(v?.code || '').trim() === String(row.supplier_code || '').trim())
        : null;
      const best = exactByCode || list[0];
      if (!best) return fallback;

      return {
        name: String(best?.name || row.supplier_name || '-'),
        code: String(best?.code || row.supplier_code || '-'),
        phone: String(best?.phone || '-'),
        gstin: String(best?.tax_id || best?.taxId || row.supplier_gst || '-'),
      };
    } catch {
      return fallback;
    }
  };

  const searchTrace = async () => {
    if (!searchUID.trim()) {
      setError('Please enter a UID');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = await apiClient.get<any>(`/uid/traceability?uid=${encodeURIComponent(searchUID)}&limit=100&offset=0`);
      const rows: TraceabilityRow[] = payload?.data || [];

      if (!rows.length) {
        throw new Error('UID not found');
      }

      const first = rows[0];
      const lifecycle: LifecycleEvent[] = rows
        .slice()
        .sort((a, b) => a.level - b.level)
        .map((row) => ({
          stage: row.usage_type,
          timestamp: row.report_generated_at,
          location: row.assembly_name || 'Warehouse / Inventory',
          reference: row.work_order_number || row.grn_number || row.uid,
          user: 'SYSTEM',
        }));

      const vendorDetails = await resolveVendorDetails(first);

      const mapped: UIDTrace = {
        uid: first.uid,
        entity_type: 'UID',
        item: {
          code: first.part_code,
          name: first.part_name,
          category: first.product_category,
        },
        status: rows.some((row) => row.level > 0) ? 'CONSUMED' : 'AVAILABLE',
        location: first.assembly_name || first.grn_number || 'Inventory',
        batch_number: undefined,
        lifecycle,
        components: [],
        parent_products: [],
        vendor: vendorDetails,
        purchase_order: first.po_number
          ? {
              id: first.po_id || undefined,
              po_number: first.po_number,
              order_date: first.po_date || first.report_generated_at,
              total_amount: Number(first.po_total_amount || 0),
              quotation_ref: first.po_quotation_ref,
            }
          : null,
        purchase_requisition: first.pr_number
          ? {
              id: first.pr_id || undefined,
              pr_number: first.pr_number,
              parent_pr_number: first.parent_pr_number,
            }
          : null,
        grn: first.grn_number
          ? {
              id: first.grn_id || undefined,
              grn_number: first.grn_number,
              grn_date: first.grn_date || first.report_generated_at,
              invoice_number: first.invoice_number,
              invoice_date: first.invoice_date,
            }
          : null,
        job_order: first.work_order_number
          ? {
              id: first.job_order_id || undefined,
              job_order_number: first.work_order_number,
              status: first.work_order_status,
              quantity: first.work_order_quantity,
              start_date: first.work_order_start_date,
              completion_date: first.work_order_completion_date,
            }
          : null,
        documents: buildDocumentLinks(first),
        quality_checkpoints: [],
        customer: null,
      };

      setTraceabilityRows(rows);
      setTraceData(mapped);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trace data');
      setTraceData(null);
      setTraceabilityRows([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateOnly = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN');
  };

  const getStageIcon = (stage: string) => {
    if (stage.includes('RECEIVED') || stage.includes('RECEIPT')) return '📦';
    if (stage.includes('QC') || stage.includes('QUALITY')) return '🔍';
    if (stage.includes('PRODUCTION') || stage.includes('ASSEMBLY')) return '🏭';
    if (stage.includes('SHIPPED') || stage.includes('DELIVERY')) return '🚚';
    if (stage.includes('DEFECT')) return '⚠️';
    if (stage.includes('REPAIR')) return '🔧';
    return '📍';
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      PASSED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
      PENDING: 'bg-yellow-100 text-yellow-800',
      AVAILABLE: 'bg-blue-100 text-blue-800',
      CONSUMED: 'bg-purple-100 text-purple-800',
      DEFECTIVE: 'bg-red-100 text-red-800',
      IN_REPAIR: 'bg-orange-100 text-orange-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">🔍 Product Traceability</h1>
              <p className="text-gray-600 mt-1">Complete lifecycle tracking from supplier to customer</p>
            </div>

          </div>

          {/* Search Bar */}
          <div className="flex gap-3">
            <input
              type="text"
              value={searchUID}
              onChange={(e) => setSearchUID(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchTrace()}
              placeholder={`Enter UID (e.g., UID-${branding.initials}-KOL-FG-000123-A1)`}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <button
              onClick={searchTrace}
              disabled={loading}
              className="px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-lg font-semibold hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {loading ? 'Searching...' : 'Trace Product'}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}
        </div>

        {traceData && (
          <>
            {/* Product Summary Card */}
            <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 mb-2">Product UID</h3>
                  <p className="text-lg font-mono font-bold text-orange-600">{traceData.uid}</p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 mb-2">Product</h3>
                  <p className="font-bold text-gray-800">{traceData.item.code}</p>
                  <p className="text-sm text-gray-600">{traceData.item.name}</p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 mb-2">Current Status</h3>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(traceData.status)}`}>
                    {traceData.status}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 mb-2">Current Location</h3>
                  <p className="font-bold text-gray-800">📍 {traceData.location}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Visual Timeline */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">📅 Complete Timeline</h2>
                  
                  <div className="relative">
                    {/* Timeline Line */}
                    <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-orange-500 via-amber-400 to-orange-500"></div>
                    
                    {/* Timeline Events */}
                    <div className="space-y-6">
                      {traceData.lifecycle.map((event, index) => (
                        <div key={index} className="relative pl-16">
                          {/* Timeline Dot */}
                          <div className="absolute left-3 w-6 h-6 bg-orange-500 rounded-full border-4 border-white shadow-lg flex items-center justify-center text-white text-xs">
                            {getStageIcon(event.stage)}
                          </div>
                          
                          {/* Event Card */}
                          <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <h3 className="font-bold text-gray-800">{event.stage.replace(/_/g, ' ')}</h3>
                                <p className="text-sm text-gray-600">{event.location}</p>
                              </div>
                              <span className="text-xs text-gray-500">
                                {formatDate(event.timestamp)}
                              </span>
                            </div>
                            
                            <div className="text-sm text-gray-700 mt-2">
                              <p><strong>Reference:</strong> {event.reference}</p>
                              <p><strong>By:</strong> {event.user}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Work Order Hierarchy */}
                {traceabilityRows.length > 0 && (
                  <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">🧩 Work Order Usage Hierarchy</h2>
                    <div className="space-y-3">
                      {traceabilityRows
                        .slice()
                        .sort((a, b) => a.level - b.level)
                        .map((row, index) => (
                          <div key={`${row.uid}-${row.level}-${index}`} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">
                                Level {row.level}
                              </span>
                              <span className="text-sm font-semibold text-gray-800">{row.usage_type}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-gray-500">Work Order</p>
                                <p className="font-semibold text-gray-800">{row.work_order_number || '-'}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">Assembly</p>
                                <p className="font-semibold text-gray-800">{row.assembly_name || '-'}</p>
                              </div>
                              <div className="md:col-span-2">
                                <p className="text-gray-500">Path</p>
                                <p className="font-mono text-xs text-gray-700">
                                  {row.work_order_path?.length ? row.work_order_path.join(' → ') : '-'}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column - Additional Info */}
              <div className="space-y-6">
                {/* Vendor Details */}
                {traceData.vendor && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">🏢 Vendor Details</h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500">Vendor Code</p>
                        <p className="font-bold text-gray-800">{traceData.vendor.code}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Vendor Name</p>
                        <p className="font-bold text-gray-800">{traceData.vendor.name}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Phone</p>
                        <p className="text-gray-700">{traceData.vendor.phone}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">GSTIN</p>
                        <p className="text-gray-700">{traceData.vendor.gstin}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Purchase Order Details */}
                {traceData.purchase_order && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">📋 Purchase Order</h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500">PO Number</p>
                        <p className="font-bold text-gray-800">{traceData.purchase_order.po_number}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Order Date</p>
                        <p className="text-gray-700">{formatDateOnly(traceData.purchase_order.order_date)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Total Amount</p>
                        <p className="text-gray-700">₹{traceData.purchase_order.total_amount.toLocaleString('en-IN')}</p>
                      </div>
                      {traceData.purchase_order.quotation_ref && (
                        <div>
                          <p className="text-sm text-gray-500">Quotation Ref</p>
                          <p className="text-gray-700">{traceData.purchase_order.quotation_ref}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Purchase Requisition Details */}
                {traceData.purchase_requisition && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">📝 Purchase Requisition</h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500">PR Number</p>
                        <p className="font-bold text-gray-800">{traceData.purchase_requisition.pr_number}</p>
                      </div>
                      {traceData.purchase_requisition.parent_pr_number && (
                        <div>
                          <p className="text-sm text-gray-500">Parent PR Number</p>
                          <p className="text-gray-700">{traceData.purchase_requisition.parent_pr_number}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* GRN Details */}
                {traceData.grn && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">📦 Goods Receipt</h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500">GRN Number</p>
                        <p className="font-bold text-gray-800">{traceData.grn.grn_number}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Receipt Date</p>
                        <p className="text-gray-700">{formatDateOnly(traceData.grn.grn_date)}</p>
                      </div>
                      {(traceData.grn.invoice_number || traceData.grn.invoice_date) && (
                        <div>
                          <p className="text-sm text-gray-500">Vendor Invoice</p>
                          <p className="text-gray-700">
                            {traceData.grn.invoice_number || '-'}
                            {traceData.grn.invoice_date ? ` • ${new Date(traceData.grn.invoice_date).toLocaleDateString('en-IN')}` : ''}
                          </p>
                        </div>
                      )}
                      {traceData.batch_number && (
                        <div>
                          <p className="text-sm text-gray-500">Batch Number</p>
                          <p className="text-gray-700">{traceData.batch_number}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Job Order Details */}
                {traceData.job_order && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">🏭 Job Order</h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500">Job Order Number</p>
                        <p className="font-bold text-gray-800">{traceData.job_order.job_order_number}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-sm text-gray-500">Status</p>
                          <p className="text-gray-700">{traceData.job_order.status || '-'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Quantity</p>
                          <p className="text-gray-700">{traceData.job_order.quantity ?? '-'}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Start Date</p>
                        <p className="text-gray-700">{formatDateOnly(traceData.job_order.start_date)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Completion Date</p>
                        <p className="text-gray-700">{formatDateOnly(traceData.job_order.completion_date)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Available Documents */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">🔗 Documents & Records</h2>
                  {traceData.documents.length > 0 ? (
                    <div className="space-y-2">
                      {traceData.documents.map((document) => (
                        <button
                          key={document.id}
                          type="button"
                          onClick={() => openDocument(document).catch((err) => setError(err.message || 'Unable to open document'))}
                          className="w-full text-left border border-gray-200 rounded-lg px-3 py-2 hover:border-orange-300 hover:bg-orange-50 transition-colors"
                        >
                          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{document.label}</span>
                          <span className="block font-semibold text-orange-700 break-words">{document.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No linked documents found</p>
                  )}
                </div>

                {/* Quality Checkpoints */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">✅ Quality Checkpoints</h2>
                  {traceData.quality_checkpoints.length > 0 ? (
                    <div className="space-y-3">
                      {traceData.quality_checkpoints.map((qc, index) => (
                        <div key={index} className="border-l-4 border-orange-500 pl-3 py-2">
                          <div className="flex justify-between items-start mb-1">
                            <p className="font-semibold text-gray-800">{qc.stage}</p>
                            <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(qc.status)}`}>
                              {qc.status}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">{formatDate(qc.date)}</p>
                          <p className="text-sm text-gray-600 mt-1">{qc.inspector}</p>
                          {qc.notes && (
                            <p className="text-sm text-gray-700 mt-1 italic">{qc.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No quality checkpoints recorded</p>
                  )}
                </div>

                {/* Customer Location */}
                {traceData.customer && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">👤 Customer Details</h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500">Customer Name</p>
                        <p className="font-bold text-gray-800">{traceData.customer.name}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Location</p>
                        <p className="text-gray-700">📍 {traceData.customer.location}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Delivery Date</p>
                        <p className="text-gray-700">{formatDate(traceData.customer.delivery_date)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Invoice Number</p>
                        <p className="font-mono text-gray-800">{traceData.customer.invoice_number}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Component Tree Diagram - Enhanced Hierarchical View */}
            {traceData.components.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
                <h2 className="text-xl font-bold mb-4" style={{ color: '#6F4E37' }}>🌳 Component Tree - Hierarchical Structure</h2>
                <p className="text-sm text-gray-600 mb-6">
                  This product was assembled from {traceData.components.length} component(s). Each branch shows the complete traceability.
                </p>
                
                {/* Hierarchical Tree Visualization */}
                <div className="relative">
                  {/* Root Product */}
                  <div className="flex items-center justify-center mb-8">
                    <div className="relative p-4 rounded-lg border-2 shadow-lg text-center min-w-[300px]" 
                         style={{ borderColor: '#8B6F47', backgroundColor: '#FAF8F3' }}>
                      <div className="text-xs font-semibold mb-1" style={{ color: '#6F4E37' }}>FINAL PRODUCT</div>
                      <div className="font-mono text-sm font-bold mb-1" style={{ color: '#8B6F47' }}>{traceData.uid}</div>
                      <div className="text-sm font-semibold">{traceData.item.code}</div>
                      <div className="text-xs text-gray-600">{traceData.item.name}</div>
                      <div className={`inline-block px-2 py-1 rounded text-xs font-bold mt-2 ${getStatusColor(traceData.status)}`}>
                        {traceData.status}
                      </div>
                    </div>
                  </div>
                  
                  {/* Connecting Lines */}
                  {traceData.components.length > 0 && (
                    <div className="flex justify-center mb-4">
                      <div className="w-0.5 h-8" style={{ backgroundColor: '#8B6F47' }}></div>
                    </div>
                  )}
                  
                  {/* Component Branches */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative">
                    {traceData.components.map((component, index) => (
                      <div key={index} className="relative">
                        {/* Branch Line */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-4 -mt-4" 
                             style={{ backgroundColor: '#8B6F47' }}></div>
                        
                        {/* Component Card */}
                        <div className="relative p-4 rounded-lg border-2 hover:shadow-xl transition-all cursor-pointer group"
                             style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                             onClick={() => {
                               setSearchUID(component.uid);
                               searchTrace();
                             }}>
                          
                          {/* Branch Number Badge */}
                          <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm"
                               style={{ backgroundColor: '#8B6F47' }}>
                            {index + 1}
                          </div>
                          
                          {/* UID and Status */}
                          <div className="mb-3 pb-3 border-b" style={{ borderColor: '#E8DCC4' }}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-mono text-xs font-bold" style={{ color: '#8B6F47' }}>
                                {component.uid}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${getStatusColor(component.qc_status)}`}>
                                {component.qc_status}
                              </span>
                            </div>
                          </div>
                          
                          {/* Component Details */}
                          <div className="space-y-2 text-sm">
                            <div>
                              <p className="text-xs text-gray-500 uppercase">Item</p>
                              <p className="font-semibold text-gray-800">{component.item_code}</p>
                              <p className="text-xs text-gray-600">{component.item_name}</p>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 pt-2">
                              <div>
                                <p className="text-xs text-gray-500">Batch</p>
                                <p className="font-mono text-xs font-semibold">{component.batch_number}</p>
                              </div>
                              
                              <div>
                                <p className="text-xs text-gray-500">Received</p>
                                <p className="text-xs">{new Date(component.received_date).toLocaleDateString()}</p>
                              </div>
                            </div>
                            
                            {component.vendor_name && (
                              <div className="pt-2 border-t" style={{ borderColor: '#E8DCC4' }}>
                                <p className="text-xs text-gray-500">Vendor</p>
                                <p className="text-xs font-semibold">{component.vendor_name}</p>
                              </div>
                            )}
                          </div>
                          
                          {/* Hover Action */}
                          <div className="mt-3 pt-3 border-t flex items-center justify-center text-xs font-semibold transition-colors"
                               style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}>
                            <span className="group-hover:underline">→ Click to trace this component</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Tree Legend */}
                  <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: '#FAF8F3' }}>
                    <div className="flex items-center gap-6 text-xs text-gray-600">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#8B6F47' }}></div>
                        <span>Component Level</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-0.5" style={{ backgroundColor: '#8B6F47' }}></div>
                        <span>Assembly Relationship</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold" style={{ color: '#8B6F47' }}>UID</span>
                        <span>Click to drill down</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Parent Products (if this component is used in other products) */}
            {traceData.parent_products.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4">⬆️ Used In Products</h2>
                <p className="text-sm text-gray-600 mb-4">
                  This component/material was used in the following products:
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {traceData.parent_products.map((parent, index) => (
                    <div key={index} className="p-4 border-2 border-orange-200 rounded-lg hover:border-orange-400 transition-colors">
                      <p className="font-mono text-sm font-bold text-orange-600 mb-2">{parent.uid}</p>
                      <p className="font-semibold text-gray-800">{parent.item_code}</p>
                      <p className="text-sm text-gray-600">{parent.item_name}</p>
                      <button
                        onClick={() => {
                          setSearchUID(parent.uid);
                          searchTrace();
                        }}
                        className="mt-2 text-xs text-orange-600 hover:text-orange-800 font-semibold"
                      >
                        → Trace this product
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!traceData && !loading && !error && (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <div className="text-6xl mb-4">🔍</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Search for a Product UID</h2>
            <p className="text-gray-600">
              Enter a UID above to view complete traceability from supplier to customer
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TraceProductPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    }>
      <TraceProductContent />
    </Suspense>
  );
}
