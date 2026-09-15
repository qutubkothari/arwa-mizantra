'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../lib/api-client';
import { buildDocumentBranding, escapeHtml, renderStandardLetterheadHtml } from '@/lib/document-branding';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';
import { ListTable, type ListTableColumn } from '../../../components/ui/ListTable';

interface UIDRecord {
  id: string;
  uid: string;
  entity_type: string;
  entity_id: string;
  parent_uids: string[];
  child_uids: string[];
  assembly_level: number;
  status: string;
  location: string;
  supplier_id: string;
  supplier?: {
    name: string;
    vendor_code: string;
  };
  vendorName?: string;
  vendorCode?: string;
  purchase_order_id: string;
  purchase_order?: {
    po_number: string;
  };
  grn_id: string;
  grn?: {
    grn_number: string;
  };
  grnNumber?: string;
  batch_number: string;
  items?: {
    id: string;
    code: string;
    name: string;
  };
  itemName?: string;
  itemCode?: string;
  quality_status: string;
  client_part_number?: string;
  lifecycle: Array<{
    stage: string;
    timestamp: string;
    location: string;
    reference: string;
    user: string;
  }>;
  created_at: string;
}

const statusColors: Record<string, string> = {
  GENERATED: 'bg-blue-100 text-blue-800',
  ACTIVE: 'bg-green-100 text-green-800',
  IN_PRODUCTION: 'bg-amber-100 text-amber-800',
  IN_TRANSIT: 'bg-yellow-100 text-yellow-800',
  SOLD: 'bg-purple-100 text-purple-800',
  IN_SERVICE: 'bg-orange-100 text-orange-800',
  SCRAPPED: 'bg-red-100 text-red-800',
  RETURNED: 'bg-gray-100 text-gray-800',
};

const UID_FETCH_PAGE_SIZE = 500;
const UID_FETCH_MAX_ROWS = 5000;

export default function UIDTrackingPage() {
  const router = useRouter();
  const canEdit = hasModulePermission(readStoredUser(), 'Inventory', 'edit');
  const [uids, setUids] = useState<UIDRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchUID, setSearchUID] = useState('');
  const [searchResults, setSearchResults] = useState<UIDRecord[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [selectedUID, setSelectedUID] = useState<UIDRecord | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showTraceModal, setShowTraceModal] = useState(false);
  const [showPartNumberModal, setShowPartNumberModal] = useState(false);
  const [editingUID, setEditingUID] = useState<UIDRecord | null>(null);
  const [partNumberInput, setPartNumberInput] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [filters, setFilters] = useState({
    status: '',
    entity_type: '',
    location: '',
    quality_status: '',
    grn: '',
  });

  const fetchUIDs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const baseParams = new URLSearchParams();

      if (filters.status) baseParams.append('status', filters.status);
      if (filters.entity_type) baseParams.append('entity_type', filters.entity_type);
      if (filters.location) baseParams.append('location', filters.location);
      if (filters.quality_status) baseParams.append('quality_status', filters.quality_status);
      baseParams.append('sortBy', 'created_at');
      baseParams.append('sortOrder', 'desc');

      const allRows: UIDRecord[] = [];
      let nextOffset = 0;
      let serverTotal = 0;

      do {
        const queryParams = new URLSearchParams(baseParams);
        queryParams.append('limit', UID_FETCH_PAGE_SIZE.toString());
        queryParams.append('offset', nextOffset.toString());

        const response = await apiClient.get<any>(`/uid?${queryParams}`);
        const data = Array.isArray(response) ? response : response.data || [];
        allRows.push(...data);
        serverTotal = Number(response?.total ?? allRows.length) || allRows.length;

        if (data.length < UID_FETCH_PAGE_SIZE) break;
        nextOffset += UID_FETCH_PAGE_SIZE;
      } while (allRows.length < serverTotal && allRows.length < UID_FETCH_MAX_ROWS);

      setUids(allRows);
      setTotalCount(serverTotal);

      if (serverTotal > UID_FETCH_MAX_ROWS) {
        setError(`Showing first ${UID_FETCH_MAX_ROWS} UIDs. Use filters or search to narrow the list.`);
      }
    } catch (error: any) {
      setError(error?.message || 'Failed to load UID registry');
      setUids([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchUIDs();
  }, [fetchUIDs]);

  // Debounced search - only call API after user stops typing
  useEffect(() => {
    if (searchUID.trim().length > 0) {
      const timeoutId = setTimeout(() => {
        performSearch();
      }, 300); // Wait 300ms after user stops typing
      return () => clearTimeout(timeoutId);
    } else {
      setSearchResults([]);
      setShowSearchDropdown(false);
    }
  }, [searchUID]);

  const performSearch = async () => {
    if (!searchUID.trim()) return;
    
    setSearchLoading(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('search', searchUID.trim());
      queryParams.append('limit', '10'); // Only fetch top 10 results
      
      const response = await apiClient.get<any>(`/uid?${queryParams}`);
      const data = Array.isArray(response) ? response : response.data || [];
      setSearchResults(data);
      setShowSearchDropdown(data.length > 0);
    } catch (error: any) {
      setError(error?.message || 'Failed to search UIDs');
      setSearchResults([]);
      setShowSearchDropdown(false);
    } finally {
      setSearchLoading(false);
    }
  };

  const searchForUID = async (uid: string) => {
    try {
      const data = await apiClient.get<UIDRecord>(`/uid/search/${encodeURIComponent(uid)}`);
      // Parse JSON strings to objects and add vendor/GRN names
      const parsedData: any = {
        ...data,
        lifecycle: typeof data.lifecycle === 'string' ? JSON.parse(data.lifecycle) : data.lifecycle,
        parent_uids: typeof data.parent_uids === 'string' ? JSON.parse(data.parent_uids) : data.parent_uids,
        child_uids: typeof data.child_uids === 'string' ? JSON.parse(data.child_uids) : data.child_uids,
        vendorName: data.supplier?.name || '',
        vendorCode: data.supplier?.vendor_code || '',
        grnNumber: data.grn?.grn_number || '',
      };
      setSelectedUID(parsedData);
      setShowTraceModal(true);
      setShowSearchDropdown(false);
    } catch (error: any) {
      alert(error?.message || 'Error searching for UID');
    }
  };

  const selectSearchResult = (uid: UIDRecord) => {
    setSearchUID(uid.uid);
    searchForUID(uid.uid);
  };

  const openPartNumberModal = (uid: UIDRecord) => {
    setEditingUID(uid);
    setPartNumberInput(uid.client_part_number || '');
    setShowPartNumberModal(true);
  };

  const updatePartNumber = async () => {
    if (!editingUID) return;

    try {
      await apiClient.put(`/uid/${editingUID.uid}/part-number`, {
        client_part_number: partNumberInput.trim() || null,
      });
      
      // Refresh UIDs list
      await fetchUIDs();
      
      setShowPartNumberModal(false);
      setEditingUID(null);
      setPartNumberInput('');
      
      alert('Part number updated successfully!');
    } catch (error: any) {
      alert(error?.message || 'Failed to update part number');
    }
  };

  const generateQRCode = (uid: string) => {
    // Generate QR code URL using a QR code API
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uid)}`;
  };

  const parseUIDRecord = (record: UIDRecord): UIDRecord => ({
    ...record,
    lifecycle: typeof (record as any).lifecycle === 'string' ? JSON.parse((record as any).lifecycle) : record.lifecycle,
    parent_uids: typeof (record as any).parent_uids === 'string' ? JSON.parse((record as any).parent_uids) : record.parent_uids,
    child_uids: typeof (record as any).child_uids === 'string' ? JSON.parse((record as any).child_uids) : record.child_uids,
    vendorName: record.vendorName || record.supplier?.name || '',
    vendorCode: record.vendorCode || record.supplier?.vendor_code || '',
    grnNumber: record.grnNumber || record.grn?.grn_number || '',
  });

  const openTraceForUID = async (record: UIDRecord) => {
    try {
      const data = await apiClient.get<UIDRecord>(`/uid/search/${encodeURIComponent(record.uid)}`);
      setSelectedUID(parseUIDRecord({ ...record, ...data, items: data.items || record.items }));
      setShowTraceModal(true);
    } catch (error: any) {
      alert(error?.message || 'Error loading trace information');
    }
  };

  const openQrForUID = async (record: UIDRecord) => {
    const parsedRowUID = parseUIDRecord(record);

    try {
      const data = await apiClient.get<UIDRecord>(`/uid/search/${encodeURIComponent(record.uid)}`);
      setSelectedUID(parseUIDRecord({ ...parsedRowUID, ...data, items: parsedRowUID.items || data.items }));
    } catch {
      setSelectedUID(parsedRowUID);
    }

    setShowModal(true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isUuid = (value?: string) => {
    if (!value) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
  };

  const getDisplayGrn = (record: UIDRecord) => {
    const directGrn = record.grnNumber || record.grn?.grn_number;
    if (directGrn) return directGrn;

    const lifecycleEvents = Array.isArray(record.lifecycle) ? record.lifecycle : [];
    const lifecycleGrn = lifecycleEvents
      .map((event) => String(event?.reference || '').trim())
      .map((reference) => {
        const explicitGrn = reference.match(/GRN-[A-Z0-9-]+/i);
        if (explicitGrn?.[0]) return explicitGrn[0];
        if (/^GRN\b/i.test(reference)) return reference;
        return '';
      })
      .find(Boolean);
    if (lifecycleGrn) return lifecycleGrn;

    if (record.grn_id && !isUuid(record.grn_id)) return record.grn_id;
    return '';
  };

  const getDisplayPartNumber = (record?: UIDRecord | null) => {
    if (!record) return '';

    const candidates = [
      record.client_part_number,
      record.items?.code,
      record.itemCode,
    ];

    return candidates
      .map((value) => String(value || '').trim())
      .find(Boolean) || '';
  };

  const [selectedUIDIds, setSelectedUIDIds] = useState<string[]>([]);

  const availableGrns = useMemo(() => {
    const grns = Array.from(new Set(uids.map((row) => getDisplayGrn(row)).filter(Boolean)));
    return grns.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [uids]);

  const filteredUids = useMemo(() => {
    if (!filters.grn) return uids;
    return uids.filter((row) => getDisplayGrn(row) === filters.grn);
  }, [filters.grn, uids]);

  const selectedUIDs = useMemo(
    () => uids.filter((row) => selectedUIDIds.includes(row.id || row.uid)),
    [selectedUIDIds, uids],
  );

  const printBulkLabels = (records: UIDRecord[]) => {
    if (records.length === 0) {
      alert('Please select one or more UIDs before printing.');
      return;
    }

    const printWindow = openPrintWindow('UID Labels', 'The print window was blocked. Please allow pop-ups and try again.');
    if (!printWindow) return;

    const labelCards = records.map((record) => {
      const uidValue = escapeHtml(record.uid || '-');
      const partNumber = escapeHtml(getDisplayPartNumber(record) || '-');
      const itemName = escapeHtml(record.items?.name || record.itemName || '-');
      const itemCode = escapeHtml(record.items?.code || record.itemCode || '-');
      const location = escapeHtml(record.location || 'N/A');
      const qrCodeUrl = generateQRCode(record.uid);

      return `
        <div class="label-card">
          <div class="label-grid">
            <img class="qr" src="${qrCodeUrl}" alt="QR for ${uidValue}" />
            <div class="meta">
              <div class="uid">${uidValue}</div>
              <div class="meta-row"><div class="meta-label">Part No</div><div>${partNumber}</div></div>
              <div class="meta-row"><div class="meta-label">Item</div><div>${itemCode}${itemName !== '-' ? ` | ${itemName}` : ''}</div></div>
              <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>window.onload = window.print</script>
          <title>UID Labels</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 16px; color: #111827; }
            .label-card { border: 1px solid #d1d5db; border-radius: 14px; padding: 16px; margin-bottom: 20px; page-break-inside: avoid; }
            .label-grid { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
            .qr { width: 160px; height: 160px; object-fit: contain; border: 1px solid #d1d5db; padding: 10px; border-radius: 12px; background: #fff; }
            .meta { flex: 1; min-width: 220px; }
            .uid { font-size: 22px; font-weight: 800; word-break: break-word; margin-bottom: 12px; }
            .meta-row { margin-top: 10px; font-size: 14px; }
            .meta-label { color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; }
            @media print { body { padding: 8px; } .label-card { margin-bottom: 16px; } }
          </style>
        </head>
        <body>
          ${labelCards}
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  };

  const openPrintWindow = (title: string, fallbackMessage: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert(fallbackMessage);
      return null;
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body style="font-family: Arial, sans-serif; padding: 16px;">Preparing print...</body></html>`);
    printWindow.document.close();
    return printWindow;
  };

  const loadBranding = async () => {
    const company = await apiClient.get<any>('/tenant/current').catch(() => null);
    return buildDocumentBranding(company);
  };

  const downloadQrImage = useCallback(async (record: UIDRecord) => {
    const qrUrl = generateQRCode(record.uid);
    try {
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `QR-${record.uid.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch {
      window.open(qrUrl, '_blank');
    }
  }, []);

  const printQrLabel = useCallback(async (record: UIDRecord) => {
    const printWindow = openPrintWindow(`UID Label - ${record.uid}`, 'The print window was blocked. Please allow pop-ups and try again.');
    if (!printWindow) {
      return;
    }

    const uidValue = escapeHtml(record.uid || '-');
    const partNumber = escapeHtml(getDisplayPartNumber(record) || '-');
    const itemName = escapeHtml(record.items?.name || record.itemName || '-');
    const itemCode = escapeHtml(record.items?.code || record.itemCode || '-');
    const location = escapeHtml(record.location || 'N/A');
    const qrCodeUrl = generateQRCode(record.uid);

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>window.onload = window.print</script>
          <title>UID Label - ${uidValue}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #111827; }
            .page { max-width: 760px; margin: 0 auto; }
            .panel { border: 1px solid #d1d5db; border-radius: 14px; padding: 20px; }
            .title { font-size: 28px; font-weight: 800; }
            .subtitle { color: #4b5563; margin-top: 6px; }
            .label-layout { margin-top: 18px; display: flex; gap: 24px; align-items: center; }
            .qr { width: 180px; height: 180px; object-fit: contain; border: 1px solid #d1d5db; padding: 10px; border-radius: 12px; background: #fff; }
            .meta { flex: 1; min-width: 0; }
            .uid { font-size: 24px; font-weight: 800; word-break: break-word; }
            .meta-row { margin-top: 10px; font-size: 14px; }
            .meta-label { color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; }
            @media print { body { padding: 12px; } }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="panel">
              <div class="title">UID Label</div>
              <div class="subtitle">Print-ready label for traceability and shop-floor use</div>
              <div class="label-layout">
                <img class="qr" src="${qrCodeUrl}" alt="QR for ${uidValue}" />
                <div class="meta">
                  <div class="uid">${uidValue}</div>
                  <div class="meta-row"><div class="meta-label">Part No</div><div>${partNumber}</div></div>
                  <div class="meta-row"><div class="meta-label">Item</div><div>${itemCode}${itemName !== '-' ? ` | ${itemName}` : ''}</div></div>
                  <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
                </div>
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
  }, []);

  const printTraceReport = useCallback(async (record: UIDRecord) => {
    const printWindow = openPrintWindow(`UID Traceability Report - ${record.uid}`, 'The print window was blocked. Please allow pop-ups and try again.');
    if (!printWindow) {
      return;
    }

    const branding = await loadBranding();
    const generatedOn = new Date().toLocaleString();
    const selectedGrn = escapeHtml(getDisplayGrn(record) || '-');
    const partNumber = escapeHtml(getDisplayPartNumber(record) || '-');
    const lifecycleRows = (Array.isArray(record.lifecycle) ? record.lifecycle : [])
      .map((event) => `
        <tr>
          <td>${escapeHtml(event?.timestamp ? new Date(event.timestamp).toLocaleString() : '-')}</td>
          <td>${escapeHtml(event?.stage || '-')}</td>
          <td>${escapeHtml(event?.location || '-')}</td>
          <td>${escapeHtml(event?.reference || '-')}</td>
          <td>${escapeHtml(event?.user || '-')}</td>
        </tr>
      `)
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>window.onload = window.print</script>
          <title>UID Traceability Report - ${escapeHtml(record.uid || '-')}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #111827; }
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
            .page { max-width: 1100px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
            .title { font-size: 28px; font-weight: 800; }
            .subtitle { margin-top: 6px; color: #4b5563; }
            .summary { margin-top: 20px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
            .summary-card { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; }
            .summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
            .summary-value { margin-top: 6px; font-size: 14px; font-weight: 700; word-break: break-word; }
            .section { margin-top: 20px; }
            .section-title { font-size: 16px; font-weight: 700; margin-bottom: 10px; }
            .chips { display: flex; gap: 8px; flex-wrap: wrap; }
            .chip { padding: 6px 10px; border-radius: 999px; font-size: 12px; background: #f3f4f6; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; font-size: 12px; vertical-align: top; }
            th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
            @media print { body { padding: 12px; } }
          </style>
        </head>
        <body>
          <div class="page">
            ${renderStandardLetterheadHtml(branding, generatedOn)}
            <div class="header">
              <div>
                <div class="title">UID Traceability Report</div>
                <div class="subtitle">End-to-end lifecycle snapshot for UID-controlled inventory</div>
              </div>
            </div>

            <div class="summary">
              <div class="summary-card"><div class="summary-label">UID</div><div class="summary-value">${escapeHtml(record.uid || '-')}</div></div>
              <div class="summary-card"><div class="summary-label">Part No</div><div class="summary-value">${partNumber}</div></div>
              <div class="summary-card"><div class="summary-label">Status</div><div class="summary-value">${escapeHtml(record.status || '-')}</div></div>
              <div class="summary-card"><div class="summary-label">Location</div><div class="summary-value">${escapeHtml(record.location || 'N/A')}</div></div>
            </div>

            <div class="summary">
              <div class="summary-card"><div class="summary-label">Entity Type</div><div class="summary-value">${escapeHtml(record.entity_type || '-')}</div></div>
              <div class="summary-card"><div class="summary-label">Assembly Level</div><div class="summary-value">Level ${escapeHtml(String(record.assembly_level ?? '-'))}</div></div>
              <div class="summary-card"><div class="summary-label">Quality</div><div class="summary-value">${escapeHtml(record.quality_status || '-')}</div></div>
              <div class="summary-card"><div class="summary-label">GRN</div><div class="summary-value">${selectedGrn}</div></div>
            </div>

            <div class="section">
              <div class="section-title">Source Traceability</div>
              <table>
                <tbody>
                  <tr><th>Supplier</th><td>${escapeHtml(record.vendorName || record.supplier?.name || '-')}</td><th>Vendor Code</th><td>${escapeHtml(record.vendorCode || record.supplier?.vendor_code || '-')}</td></tr>
                  <tr><th>PO</th><td>${escapeHtml(record.purchase_order?.po_number || record.purchase_order_id || '-')}</td><th>Batch</th><td>${escapeHtml(record.batch_number || '-')}</td></tr>
                  <tr><th>Item</th><td>${escapeHtml(record.items?.code || record.itemCode || '-')} | ${escapeHtml(record.items?.name || record.itemName || '-')}</td><th>Created</th><td>${escapeHtml(record.created_at ? formatDate(record.created_at) : '-')}</td></tr>
                </tbody>
              </table>
            </div>

            ${(record.parent_uids?.length || 0) > 0 || (record.child_uids?.length || 0) > 0 ? `
              <div class="section">
                <div class="section-title">Assembly Hierarchy</div>
                ${(record.parent_uids?.length || 0) > 0 ? `<div><strong>Parent UIDs</strong><div class="chips">${record.parent_uids.map((parentUid) => `<span class="chip">${escapeHtml(parentUid)}</span>`).join('')}</div></div>` : ''}
                ${(record.child_uids?.length || 0) > 0 ? `<div style="margin-top: 12px;"><strong>Child UIDs</strong><div class="chips">${record.child_uids.map((childUid) => `<span class="chip">${escapeHtml(childUid)}</span>`).join('')}</div></div>` : ''}
              </div>
            ` : ''}

            ${(Array.isArray(record.lifecycle) && record.lifecycle.length > 0) ? `
              <div class="section">
                <div class="section-title">Lifecycle Timeline</div>
                <table>
                  <thead>
                    <tr><th>Timestamp</th><th>Stage</th><th>Location</th><th>Reference</th><th>User</th></tr>
                  </thead>
                  <tbody>${lifecycleRows}</tbody>
                </table>
              </div>
            ` : ''}
          </div>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  }, []);

  const selectedGrnDisplay = selectedUID ? getDisplayGrn(selectedUID) : '';
  const selectedPartNumberDisplay = getDisplayPartNumber(selectedUID);

  const selectionToolbar = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="text-sm text-gray-700">{selectedUIDIds.length} selected</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => printBulkLabels(selectedUIDs)}
          disabled={selectedUIDIds.length === 0}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Print selected labels
        </button>
        {selectedUIDIds.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedUIDIds([])}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            Clear selection
          </button>
        )}
      </div>
    </div>
  );

  const getQualityStatusColor = (status?: string) => {
    switch (status) {
      case 'PASSED':
        return 'bg-green-100 text-green-800';
      case 'FAILED':
        return 'bg-red-100 text-red-800';
      case 'ON_HOLD':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const uidTableColumns: Array<ListTableColumn<UIDRecord>> = [
    {
      id: 'uid',
      label: 'UID',
      accessor: (row) => row.uid,
      searchAccessor: (row) => [row.uid, row.batch_number, getDisplayPartNumber(row)].filter(Boolean).join(' '),
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold text-amber-700" title={row.uid}>{row.uid}</div>
          {row.batch_number && <div className="truncate text-[11px] text-gray-500" title={row.batch_number}>Batch: {row.batch_number}</div>}
        </div>
      ),
      hideable: false,
      minWidth: 260,
    },
    {
      id: 'client_part_number',
      label: 'Part No',
      accessor: (row) => getDisplayPartNumber(row),
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          {getDisplayPartNumber(row) ? (
            <span className="truncate rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800" title={getDisplayPartNumber(row)}>
              {getDisplayPartNumber(row)}
            </span>
          ) : (
            <span className="text-xs text-gray-400">Not assigned</span>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => openPartNumberModal(row)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
              title="Edit part number"
            >
              Edit
            </button>
          )}
        </div>
      ),
      minWidth: 160,
    },
    {
      id: 'item',
      label: 'Item',
      accessor: (row) => `${row.items?.code || row.itemCode || ''} ${row.items?.name || row.itemName || ''}`.trim(),
      searchAccessor: (row) => `${row.items?.code || row.itemCode || ''} ${row.items?.name || row.itemName || ''}`.trim(),
      cell: (row) => {
        const code = row.items?.code || row.itemCode || '';
        const name = row.items?.name || row.itemName || '';
        return code || name ? (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-900" title={code}>{code || '-'}</div>
            {name && <div className="truncate text-[11px] text-gray-500" title={name}>{name}</div>}
          </div>
        ) : <span className="text-gray-400">-</span>;
      },
      minWidth: 240,
    },
    {
      id: 'entity_type',
      label: 'Type',
      accessor: (row) => row.entity_type || '-',
      minWidth: 150,
    },
    {
      id: 'status',
      label: 'Status',
      accessor: (row) => row.status || '-',
      cell: (row) => (
        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusColors[row.status] || 'bg-gray-100 text-gray-800'}`}>
          {row.status || '-'}
        </span>
      ),
      align: 'center',
      minWidth: 150,
    },
    {
      id: 'quality_status',
      label: 'QC',
      accessor: (row) => row.quality_status || '-',
      cell: (row) => (
        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getQualityStatusColor(row.quality_status)}`}>
          {row.quality_status || '-'}
        </span>
      ),
      align: 'center',
      defaultVisible: false,
      minWidth: 130,
    },
    {
      id: 'location',
      label: 'Location',
      accessor: (row) => row.location || '',
      cell: (row) => <span className="block truncate" title={row.location || 'N/A'}>{row.location || 'N/A'}</span>,
      minWidth: 180,
    },
    {
      id: 'assembly_level',
      label: 'Level',
      accessor: (row) => row.assembly_level ?? 0,
      cell: (row) => (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span>L{row.assembly_level ?? 0}</span>
          {Array.isArray(row.parent_uids) && row.parent_uids.length > 0 && <span className="text-xs text-amber-600">Up {row.parent_uids.length}</span>}
          {Array.isArray(row.child_uids) && row.child_uids.length > 0 && <span className="text-xs text-green-600">Down {row.child_uids.length}</span>}
        </span>
      ),
      align: 'center',
      minWidth: 140,
    },
    {
      id: 'vendor',
      label: 'Vendor',
      accessor: (row) => row.vendorName || row.supplier?.name || '',
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate text-sm text-gray-900" title={row.vendorName || row.supplier?.name || '-'}>{row.vendorName || row.supplier?.name || '-'}</div>
          {(row.vendorCode || row.supplier?.vendor_code) && <div className="truncate text-[11px] text-gray-500">{row.vendorCode || row.supplier?.vendor_code}</div>}
        </div>
      ),
      defaultVisible: false,
      minWidth: 220,
    },
    {
      id: 'grn',
      label: 'GRN',
      accessor: (row) => getDisplayGrn(row),
      defaultVisible: true,
      minWidth: 180,
    },
    {
      id: 'po',
      label: 'PO',
      accessor: (row) => row.purchase_order?.po_number || row.purchase_order_id || '',
      defaultVisible: false,
      minWidth: 180,
    },
    {
      id: 'batch_number',
      label: 'Batch',
      accessor: (row) => row.batch_number || '',
      defaultVisible: false,
      minWidth: 150,
    },
    {
      id: 'created_at',
      label: 'Created',
      accessor: (row) => row.created_at || '',
      sortAccessor: (row) => (row.created_at ? new Date(row.created_at).getTime() : 0),
      cell: (row) => <span className="whitespace-nowrap text-gray-600">{row.created_at ? formatDate(row.created_at) : '-'}</span>,
      minWidth: 190,
    },
    {
      id: 'actions',
      label: 'Actions',
      sortable: false,
      hideable: false,
      align: 'right',
      minWidth: 150,
      cell: (row) => (
        <div className="flex items-center justify-end gap-2 whitespace-nowrap text-xs">
          <button
            type="button"
            onClick={() => openTraceForUID(row)}
            className="font-medium text-amber-600 hover:text-amber-800"
          >
            Trace
          </button>
          <button
            type="button"
            onClick={() => openQrForUID(row)}
            className="font-medium text-purple-600 hover:text-purple-800"
          >
            QR Code
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading UID registry...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🔍 UID Tracking System
          </h1>
          <p className="text-gray-600">
            Complete traceability from procurement to service - Every part has a story
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/uid/trace')}
          className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-6 py-3 rounded-lg hover:from-orange-600 hover:to-amber-600 transition-colors font-semibold shadow-lg flex items-center gap-2"
        >
          🔍 Trace Product
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Search Bar */}
      <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 p-6 rounded-xl shadow">
        <h2 className="text-lg font-semibold mb-3 text-gray-800">🔎 Track Any UID</h2>
        <div className="relative">
          <input
            type="text"
            placeholder="Start typing UID, Part No, Item, Location..."
            value={searchUID}
            onChange={(e) => setSearchUID(e.target.value)}
            onFocus={() => searchUID && setShowSearchDropdown(true)}
            onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
            className="w-full px-4 py-3 pr-10 border-2 border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
          />
          {searchLoading ? (
            <div className="absolute right-3 top-3.5 h-6 w-6">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600"></div>
            </div>
          ) : (
            <svg className="absolute right-3 top-3.5 h-6 w-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          
          {/* Autocomplete Dropdown */}
          {showSearchDropdown && searchResults.length > 0 && (
            <div className="absolute z-50 w-full mt-2 bg-white border-2 border-amber-300 rounded-lg shadow-xl max-h-96 overflow-y-auto">
              {searchResults.map((uid) => (
                <div
                  key={uid.id}
                  onClick={() => selectSearchResult(uid)}
                  className="px-4 py-3 cursor-pointer hover:bg-amber-50 border-b border-gray-100 last:border-b-0 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">{uid.uid}</div>
                      <div className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                        {uid.itemName && <span>📦 {uid.itemName}</span>}
                        {uid.itemCode && <span className="text-amber-600">({uid.itemCode})</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                        {uid.client_part_number && <span>🔖 {uid.client_part_number}</span>}
                        {uid.location && <span>📍 {uid.location}</span>}
                        {uid.batch_number && <span>🏷️ Batch: {uid.batch_number}</span>}
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[uid.status] || 'bg-gray-100 text-gray-800'}`}>
                      {uid.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {searchUID && searchResults.length === 0 && !showSearchDropdown && !searchLoading && (
            <div className="absolute z-50 w-full mt-2 bg-white border-2 border-amber-300 rounded-lg shadow-xl p-4 text-center text-gray-500">
              No UIDs found matching &quot;{searchUID}&quot;
            </div>
          )}
        </div>
        <p className="text-sm text-gray-600 mt-2">
          💡 Scan QR code or enter UID to view complete history and traceability
        </p>
        <p className="text-xs text-amber-600 mt-1">
          ℹ️ Use the registry table search, column menu, sorting, and page size controls to browse records.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total UIDs', value: totalCount || uids.length, color: 'amber', icon: '🏷️' },
          { label: 'Loaded Rows', value: uids.length, color: 'blue', icon: '📄' },
          { label: 'Active Filters', value: Object.values(filters).filter(Boolean).length, color: 'green', icon: '🔎' },
          { label: 'Table Tools', value: 'On', color: 'orange', icon: '⚙️' },
        ].map((stat, idx) => (
          <div key={idx} className="bg-white p-5 rounded-lg shadow border-l-4 border-amber-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
              <span className="text-4xl">{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <details className="mb-6 rounded-lg bg-white shadow" open={Object.values(filters).some(Boolean)}>
        <summary className="cursor-pointer px-4 py-3 font-semibold text-gray-800">
          Registry filters{Object.values(filters).some(Boolean) ? ` (${Object.values(filters).filter(Boolean).length} active)` : ''}
        </summary>
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-3">
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="IN_PRODUCTION">In Production</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="SOLD">Sold</option>
              <option value="IN_SERVICE">In Service</option>
              <option value="SCRAPPED">Scrapped</option>
            </select>

            <select
              value={filters.entity_type}
              onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            >
              <option value="">All Types</option>
              <option value="RAW_MATERIAL">Raw Material</option>
              <option value="COMPONENT">Component</option>
              <option value="ASSEMBLY">Assembly</option>
              <option value="FINISHED_GOOD">Finished Good</option>
            </select>

            <select
              value={filters.quality_status}
              onChange={(e) => setFilters({ ...filters, quality_status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            >
              <option value="">All QC</option>
              <option value="PASSED">QC PASSED</option>
              <option value="ON_HOLD">QC ON HOLD</option>
              <option value="FAILED">QC FAILED</option>
            </select>

            <select
              value={filters.grn}
              onChange={(e) => setFilters({ ...filters, grn: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            >
              <option value="">All GRNs</option>
              {availableGrns.map((grn) => (
                <option key={grn} value={grn}>
                  {grn}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Filter by location..."
              value={filters.location}
              onChange={(e) => setFilters({ ...filters, location: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>
          
          {(filters.status || filters.entity_type || filters.location || filters.quality_status || filters.grn) && (
            <button
              onClick={() => setFilters({ status: '', entity_type: '', location: '', quality_status: '', grn: '' })}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium flex items-center gap-2"
            >
              ✕ Clear Filters
            </button>
          )}
        </div>
        </div>
      </details>

      {/* UID Table */}
      <ListTable
        storageKey="uidRegistryTable:configurable:v2"
        rows={filteredUids}
        columns={uidTableColumns}
        getRowId={(row) => row.id || row.uid}
        defaultPageSize={25}
        pageSizeOptions={[10, 25, 50, 100]}
        searchPlaceholder="Search UID, part no, item, vendor, GRN, PO, batch, status..."
        exportFilename="uid-registry.csv"
        selectable
        selectedRowIds={selectedUIDIds}
        onSelectionChange={setSelectedUIDIds}
        toolbarRight={selectionToolbar}
        emptyState={
          <div className="p-12 text-center">
            <div className="text-5xl mb-4">🏷️</div>
            <h3 className="mb-2 text-xl font-semibold text-gray-700">No UIDs Found</h3>
            <p className="text-gray-500">UIDs are auto-generated at Goods Receipt.</p>
          </div>
        }
      />

      {/* QR Code Modal */}
      {showModal && selectedUID && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4">QR Code</h2>
            <div className="text-center">
              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <img
                  src={generateQRCode(selectedUID.uid)}
                  alt="QR Code"
                  className="mx-auto"
                />
              </div>
              <p className="font-mono text-sm text-gray-700 mb-2">{selectedUID.uid}</p>
              {selectedPartNumberDisplay && (
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Part No: {selectedPartNumberDisplay}
                </p>
              )}
              <p className="text-sm text-gray-500 mb-4">
                Scan to view complete traceability
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => downloadQrImage(selectedUID)}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-semibold"
                  title="Download QR as PNG – send to phone and print via Phomemo app"
                >
                  ⬇ Download QR (Phomemo)
                </button>
                <button
                  onClick={() => printQrLabel(selectedUID)}
                  className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 text-sm"
                >
                  🖨 Print Label
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300 text-sm"
                >
                  Close
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3">Tip: Download the QR image, share it to your phone, then open it in the Phomemo app to print.</p>
            </div>
          </div>
        </div>
      )}

      {/* Trace Modal */}
      {showTraceModal && selectedUID && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-4xl w-full p-6 my-8">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold">UID Traceability Report</h2>
                <p className="font-mono text-lg text-amber-600 mt-1">{selectedUID.uid}</p>
              </div>
              <button
                onClick={() => setShowTraceModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Entity Type</p>
                <p className="font-medium">{selectedUID.entity_type}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Status</p>
                <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[selectedUID.status]}`}>
                  {selectedUID.status}
                </span>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Current Location</p>
                <p className="font-medium">{selectedUID.location || 'N/A'}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Assembly Level</p>
                <p className="font-medium">Level {selectedUID.assembly_level}</p>
              </div>
            </div>

            {/* Hierarchy */}
            {(selectedUID.parent_uids?.length > 0 || selectedUID.child_uids?.length > 0) && (
              <div className="mb-6">
                <h3 className="font-semibold text-lg mb-3">📊 Assembly Hierarchy</h3>
                {selectedUID.parent_uids && selectedUID.parent_uids.length > 0 && (
                  <div className="mb-3">
                    <p className="text-sm text-gray-600 mb-2">⬆ Parent Components ({selectedUID.parent_uids.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedUID.parent_uids.map((parentUID, idx) => (
                        <span key={idx} className="px-3 py-1 bg-amber-50 text-amber-700 rounded text-sm font-mono">
                          {parentUID}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedUID.child_uids && selectedUID.child_uids.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">⬇ Child Components ({selectedUID.child_uids.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedUID.child_uids.map((childUID, idx) => (
                        <span key={idx} className="px-3 py-1 bg-green-50 text-green-700 rounded text-sm font-mono">
                          {childUID}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Source Traceability */}
            {selectedUID.supplier_id && (
              <div className="bg-yellow-50 p-4 rounded-lg mb-4">
                <h3 className="font-semibold mb-2">📦 Source Traceability</h3>
                <p className="text-sm">
                  Supplier: {selectedUID.vendorName || 'Unknown'}
                  {selectedUID.vendorCode && <span className="text-gray-500 ml-2">({selectedUID.vendorCode})</span>}
                </p>
                {selectedUID.purchase_order_id && (
                  <p className="text-sm">
                    PO: {selectedUID.purchase_order?.po_number || selectedUID.purchase_order_id}
                  </p>
                )}
                {selectedGrnDisplay && (
                  <p className="text-sm">
                    GRN: {selectedGrnDisplay}
                  </p>
                )}
                {selectedUID.batch_number && (
                  <p className="text-sm">Batch: {selectedUID.batch_number}</p>
                )}
              </div>
            )}

            {/* Quality Status */}
            {selectedUID.quality_status && (
              <div className="bg-green-50 p-4 rounded-lg mb-4">
                <h3 className="font-semibold mb-2">✅ Quality Status</h3>
                <p className="text-sm">{selectedUID.quality_status}</p>
              </div>
            )}

            {/* Lifecycle Timeline */}
            {selectedUID.lifecycle && selectedUID.lifecycle.length > 0 && (
              <div className="bg-blue-50 p-4 rounded-lg mb-4">
                <h3 className="font-semibold mb-3">📅 Lifecycle Timeline</h3>
                <div className="space-y-3">
                  {selectedUID.lifecycle.map((event: any, idx: number) => (
                    <div key={idx} className="flex items-start">
                      <div className="flex-shrink-0 w-24 text-xs text-gray-500">
                        {new Date(event.timestamp).toLocaleDateString()}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{event.stage}</p>
                        <p className="text-xs text-gray-600">
                          Location: {event.location}
                          {event.reference && ` | Ref: ${event.reference}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-2">
              <button
                onClick={() => printTraceReport(selectedUID)}
                className="flex-1 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700"
              >
                Print Report
              </button>
              <button
                onClick={() => setShowTraceModal(false)}
                className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Part Number Edit Modal */}
      {showPartNumberModal && editingUID && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">Edit Part Number</h2>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">UID: <span className="font-mono font-semibold">{editingUID.uid}</span></p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Client Part Number
              </label>
              <input
                type="text"
                value={partNumberInput}
                onChange={(e) => setPartNumberInput(e.target.value)}
                placeholder="Enter part number (e.g., 53022)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">Leave empty to remove part number</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={updatePartNumber}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowPartNumberModal(false);
                  setEditingUID(null);
                  setPartNumberInput('');
                }}
                className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
