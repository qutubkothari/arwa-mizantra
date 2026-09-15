'use client';

import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../../../../../lib/api-client';
import { ListTable, type ListTableColumn } from '../../../../components/ui/ListTable';
import { confirmDialog } from '../../../../components/ui/ConfirmDialog';
import { buildDocumentBranding, renderStandardLetterheadHtml } from '@/lib/document-branding';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';

interface DebitNote {
  id: string;
  debit_note_number: string;
  debit_note_date: string;
  gross_amount?: number;
  gst_percentage?: number;
  tax_amount?: number;
  total_amount: number;
  status: string;
  reason: string;
  notes?: string;
  grn: { id: string; grn_number: string; receipt_date?: string };
  vendor: { id: string; name: string; code: string; contact_person?: string; email?: string };
  creator: { name: string };
  approver?: { name: string };
  approval_date?: string;
  debit_note_items?: DebitNoteItem[];
}

interface DebitNoteItem {
  id: string;
  rejected_qty: number;
  unit_price: number;
  amount: number;
  gst_percentage?: number;
  tax_amount?: number;
  rejection_reason: string;
  return_status: string;
  return_date?: string;
  disposal_notes?: string;
  item: { id: string; code: string; name: string; unit?: string; uom?: string };
}

export default function DebitNotesPage() {
  const currentUser = readStoredUser();
  const canApproveDebitNotes = hasModulePermission(currentUser, 'Purchase Management', 'approve');
  const canEditDebitNotes = hasModulePermission(currentUser, 'Purchase Management', 'edit');
  const [debitNotes, setDebitNotes] = useState<DebitNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDebitNote, setSelectedDebitNote] = useState<DebitNote | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>('debit_note_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const debitNoteSummary = useMemo(() => {
    return debitNotes.reduce((summary, note) => {
      summary.total += 1;
      summary.amount += Number(note.total_amount || 0);
      if (note.status === 'DRAFT') summary.draft += 1;
      if (note.status === 'APPROVED') summary.approved += 1;
      if (note.status === 'SENT') summary.sent += 1;
      if (note.status === 'ACKNOWLEDGED' || note.status === 'CLOSED') summary.closed += 1;
      return summary;
    }, { total: 0, draft: 0, approved: 0, sent: 0, closed: 0, amount: 0 });
  }, [debitNotes]);

  useEffect(() => {
    fetchDebitNotes();
  }, [filterStatus]);

  const fetchDebitNotes = async () => {
    try {
      setLoading(true);
      const params = filterStatus ? `?status=${filterStatus}` : '';
      const data = await apiClient.get<DebitNote[]>(`/purchase/debit-notes${params}`);
      setDebitNotes(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const viewDebitNote = async (id: string) => {
    try {
      const data = await apiClient.get<DebitNote>(`/purchase/debit-notes/${id}`);
      setSelectedDebitNote(data);
      setShowViewModal(true);
    } catch (error) {
    }
  };

  const approveDebitNote = async (id: string) => {
    if (!canApproveDebitNotes) {
      alert('You do not have permission to approve debit notes');
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Approve Debit Note',
      message: 'Are you sure you want to approve this debit note? This will update the GRN payable amount.',
      confirmLabel: 'Approve',
      variant: 'warning',
    });
    if (!confirmed) return;
    
    try {
      await apiClient.post(`/purchase/debit-notes/${id}/approve`, {});
      alert('Debit note approved successfully!');
      setShowViewModal(false);
      fetchDebitNotes();
    } catch (error: any) {
      alert(`Failed to approve: ${error.message || 'Unknown error'}`);
    }
  };

  const sendEmailToSupplier = async (id: string) => {
    if (!canEditDebitNotes) {
      alert('You do not have permission to send debit notes');
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Send Debit Note',
      message: 'Send this debit note to the supplier via email?',
      confirmLabel: 'Send Email',
      variant: 'info',
    });
    if (!confirmed) return;
    
    try {
      await apiClient.post(`/purchase/debit-notes/${id}/send-email`, {});
      alert('Debit note sent to supplier successfully!');
      setShowViewModal(false);
      fetchDebitNotes();
    } catch (error: any) {
      alert(`Failed to send email: ${error.message || 'Unknown error'}`);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    if (!canEditDebitNotes) {
      alert('You do not have permission to update debit note status');
      return;
    }
    try {
      await apiClient.put(`/purchase/debit-notes/${id}/status`, { status });
      alert(`Debit note status updated to ${status}`);
      setShowViewModal(false);
      fetchDebitNotes();
    } catch (error: any) {
      alert(`Failed to update: ${error.message || 'Unknown error'}`);
    }
  };

  const updateReturnStatus = async (debitNoteId: string, itemId: string, returnStatus: string) => {
    if (!canEditDebitNotes) {
      alert('You do not have permission to update return status');
      return;
    }
    const disposalNotes = prompt('Enter disposal notes (optional):');
    
    try {
      await apiClient.put(`/purchase/debit-notes/${debitNoteId}/items/${itemId}/return-status`, {
        returnStatus,
        disposalNotes,
      });
      alert('Return status updated successfully!');
      viewDebitNote(debitNoteId); // Refresh
    } catch (error: any) {
      alert(`Failed to update: ${error.message || 'Unknown error'}`);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'bg-gray-100 text-gray-800';
      case 'APPROVED': return 'bg-green-100 text-green-800';
      case 'SENT': return 'bg-blue-100 text-blue-800';
      case 'ACKNOWLEDGED': return 'bg-purple-100 text-purple-800';
      case 'CLOSED': return 'bg-gray-400 text-white';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getReturnStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'RETURNED': return 'bg-green-100 text-green-800';
      case 'DESTROYED': return 'bg-red-100 text-red-800';
      case 'REWORKED': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatCurrency = (value?: number) => {
    return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const escapeHtml = (value: unknown) => {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const handlePrintDebitNote = async (debitNote: DebitNote) => {
    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('title', `Print ${debitNote.debit_note_number}`);
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.style.visibility = 'hidden';
    document.body.appendChild(printFrame);

    const printWindow = printFrame.contentWindow;
    if (!printWindow) {
      document.body.removeChild(printFrame);
      alert('Unable to prepare the print layout. Please try again.');
      return;
    }

    let branding = buildDocumentBranding(null);
    try {
      const company = await apiClient.get<any>('/tenant/current').catch(() => null);
      branding = buildDocumentBranding(company);
    } catch {
      branding = buildDocumentBranding(null);
    }

    const rows = (debitNote.debit_note_items || []).map((item, index) => {
      const gstPercentage = Number(item.gst_percentage ?? debitNote.gst_percentage ?? 0);
      const taxAmount = Number(item.tax_amount || 0);
      const totalAmount = Number(item.amount || 0) + taxAmount;
      const unitLabel = item.item?.unit || item.item?.uom || '';

      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="item-name">${escapeHtml(item.item?.name || '-')}</div>
            <div class="item-code">${escapeHtml(item.item?.code || '')}</div>
          </td>
          <td class="num">${escapeHtml(item.rejected_qty)} ${escapeHtml(unitLabel)}</td>
          <td class="num">${formatCurrency(item.unit_price)}</td>
          <td class="num">${formatCurrency(item.amount)}</td>
          <td class="num">${escapeHtml(gstPercentage)}%</td>
          <td class="num">${formatCurrency(taxAmount)}</td>
          <td class="num strong">${formatCurrency(totalAmount)}</td>
          <td>${escapeHtml(item.rejection_reason || '-')}</td>
        </tr>
      `;
    }).join('');

    const grossAmount = Number(debitNote.gross_amount ?? debitNote.total_amount ?? 0);
    const gstPercentage = Number(debitNote.gst_percentage ?? 0);
    const taxAmount = Number(debitNote.tax_amount ?? 0);
    const generatedOn = new Date().toLocaleDateString('en-IN');

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(debitNote.debit_note_number)} - Print</title>
          <style>
            :root { color-scheme: light; }
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 20px; color: #1f2937; background: #fff; }
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
              width: 52px;
              height: 52px;
              background: #1e3a8a;
              color: white;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: 700;
              border-radius: 8px;
            }
            .logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; }
            .company-name { font-size: 18px; font-weight: 700; margin: 0; color: #1e3a8a; }
            .company-meta { font-size: 10.5pt; margin: 2px 0 0 0; color: #111; }
            .generated-on { text-align:right; font-size:10.5pt; color:#1e3a8a; line-height:1.5; }
            .generated-on-label { font-weight:700; text-transform:uppercase; letter-spacing:0.06em; }
            .generated-on-value { font-weight:700; color:#111827; }
            .page { padding: 28px 32px 40px; }
            .doc-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 3px solid #b91c1c; padding-bottom: 18px; }
            .doc-title { max-width: 48%; }
            .doc-title h1 { margin: 0; font-size: 28px; letter-spacing: 0.04em; color: #b91c1c; }
            .doc-title p { margin: 6px 0 0; color: #6b7280; }
            .meta { min-width: 280px; }
            .meta-grid { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; font-size: 13px; }
            .label { color: #6b7280; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; }
            .section { margin-top: 20px; }
            .section h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #374151; }
            .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 14px; min-height: 112px; }
            .card p { margin: 0; line-height: 1.55; }
            .reason { border-left: 4px solid #dc2626; background: #fef2f2; padding: 12px 14px; border-radius: 8px; line-height: 1.6; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #d1d5db; padding: 10px 8px; vertical-align: top; font-size: 12px; }
            th { background: #f3f4f6; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #374151; }
            .num { text-align: right; white-space: nowrap; }
            .strong { font-weight: 700; }
            .item-name { font-weight: 700; }
            .item-code { color: #6b7280; font-size: 11px; margin-top: 2px; }
            .totals { margin-top: 16px; margin-left: auto; width: 320px; border: 1px solid #d1d5db; border-radius: 10px; overflow: hidden; }
            .totals-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
            .totals-row:last-child { border-bottom: 0; background: #fef2f2; font-weight: 700; color: #991b1b; }
            .status { display: inline-block; padding: 5px 10px; border-radius: 999px; background: #fee2e2; color: #991b1b; font-weight: 700; font-size: 11px; letter-spacing: 0.04em; }
            .footer { margin-top: 28px; display: flex; justify-content: space-between; gap: 24px; font-size: 12px; color: #6b7280; }
            .signature { min-width: 240px; }
            .signature-line { border-top: 1px solid #9ca3af; margin-top: 36px; padding-top: 8px; color: #374151; }
            @media print {
              body { margin: 0; }
              .page { padding: 18px 20px 24px; }
            }
          </style>
        </head>
        <body>
          <div class="page">
            ${renderStandardLetterheadHtml(branding, generatedOn)}

            <div class="doc-header">
              <div class="doc-title">
                <h1>Debit Note</h1>
                <p>Supplier debit note for rejected materials</p>
              </div>
              <div class="meta">
                <div class="meta-grid">
                  <div class="label">DN Number</div><div>${escapeHtml(debitNote.debit_note_number)}</div>
                  <div class="label">DN Date</div><div>${escapeHtml(new Date(debitNote.debit_note_date).toLocaleDateString())}</div>
                  <div class="label">GRN</div><div>${escapeHtml(debitNote.grn?.grn_number || '-')}</div>
                  <div class="label">Status</div><div><span class="status">${escapeHtml(debitNote.status || '-')}</span></div>
                </div>
              </div>
            </div>

            <div class="section card-grid">
              <div class="card">
                <h2>Vendor</h2>
                <p>
                  <strong>${escapeHtml(debitNote.vendor?.name || '-')}</strong><br />
                  ${escapeHtml(debitNote.vendor?.code || '')}<br />
                  ${escapeHtml(debitNote.vendor?.contact_person || '')}<br />
                  ${escapeHtml(debitNote.vendor?.email || '')}
                </p>
              </div>
              <div class="card">
                <h2>Document Info</h2>
                <p>
                  Created by: <strong>${escapeHtml(debitNote.creator?.name || '-')}</strong><br />
                  ${debitNote.approver?.name ? `Approved by: <strong>${escapeHtml(debitNote.approver.name)}</strong><br />` : ''}
                  ${debitNote.approval_date ? `Approval date: ${escapeHtml(new Date(debitNote.approval_date).toLocaleDateString())}<br />` : ''}
                  ${debitNote.grn?.receipt_date ? `GRN date: ${escapeHtml(new Date(debitNote.grn.receipt_date).toLocaleDateString())}` : ''}
                </p>
              </div>
            </div>

            <div class="section">
              <h2>Reason</h2>
              <div class="reason">${escapeHtml(debitNote.reason || '-')}</div>
            </div>

            ${debitNote.notes ? `
              <div class="section">
                <h2>Notes</h2>
                <div class="reason" style="border-left-color:#9ca3af;background:#f9fafb;">${escapeHtml(debitNote.notes)}</div>
              </div>
            ` : ''}

            <div class="section">
              <h2>Rejected Items</h2>
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>Item</th>
                    <th class="num">Rejected Qty</th>
                    <th class="num">Unit Price</th>
                    <th class="num">Amount</th>
                    <th class="num">GST %</th>
                    <th class="num">Tax</th>
                    <th class="num">Total</th>
                    <th>Rejection Reason</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="9" style="text-align:center;color:#6b7280;">No rejected items</td></tr>'}
                </tbody>
              </table>
            </div>

            <div class="totals">
              <div class="totals-row"><span>Gross Amount</span><span>${formatCurrency(grossAmount)}</span></div>
              <div class="totals-row"><span>GST (${escapeHtml(gstPercentage)}%)</span><span>${formatCurrency(taxAmount)}</span></div>
              <div class="totals-row"><span>Total Debit Amount</span><span>${formatCurrency(debitNote.total_amount)}</span></div>
            </div>

            <div class="footer">
              <div>
                This document records rejected material against the referenced GRN and may be adjusted against supplier payment as per agreed commercial terms.
              </div>
              <div class="signature">
                <div class="signature-line">Authorized Signatory</div>
              </div>
            </div>
          </div>
          <script>
            window.onload = function () {
              setTimeout(function () {
                try { window.print(); } catch (e) {}
              }, 150);
            };
          </script>
        </body>
      </html>
    `;

    const cleanup = () => {
      window.setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 1000);
    };

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.onafterprint = cleanup;
    printWindow.focus();
  };

  const tableColumns: Array<ListTableColumn<DebitNote>> = [
    {
      id: 'debit_note_number',
      label: 'DN Number',
      accessor: (dn) => dn.debit_note_number,
      cell: (dn) => <div className="font-semibold text-gray-900">{dn.debit_note_number}</div>,
    },
    {
      id: 'debit_note_date',
      label: 'Date',
      accessor: (dn) => dn.debit_note_date,
      sortAccessor: (dn) => new Date(dn.debit_note_date).getTime(),
      cell: (dn) => <span className="text-sm text-gray-600">{new Date(dn.debit_note_date).toLocaleDateString()}</span>,
    },
    {
      id: 'grn',
      label: 'GRN',
      accessor: (dn) => dn.grn?.grn_number || '',
      cell: (dn) => <span className="text-sm text-gray-900">{dn.grn?.grn_number || '-'}</span>,
    },
    {
      id: 'vendor',
      label: 'Vendor',
      accessor: (dn) => `${dn.vendor?.name || ''} ${dn.vendor?.code || ''}`,
      cell: (dn) => (
        <div>
          <div className="text-sm text-gray-900">{dn.vendor?.name || '-'}</div>
          <div className="text-xs text-gray-500">{dn.vendor?.code || ''}</div>
        </div>
      ),
    },
    {
      id: 'total_amount',
      label: 'Amount',
      align: 'right',
      accessor: (dn) => dn.total_amount,
      cell: (dn) => (
        <div className="text-lg font-bold text-red-600">
          ₹{dn.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </div>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      accessor: (dn) => dn.status,
      cell: (dn) => (
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(dn.status)}`}>
          {dn.status}
        </span>
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      sortable: false,
      hideable: false,
      cell: (dn) => (
        <button
          onClick={() => viewDebitNote(dn.id)}
          className="rounded-md border border-[#D8C7AA] px-3 py-1.5 text-sm font-semibold text-[#5E4635] hover:bg-[#FAF9F6]"
        >
          View Details →
        </button>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-[#F7F3EA]">
      <div className="mx-auto max-w-[calc(100vw-2rem)] px-6 py-6">
        {/* Header */}
        <div className="mb-5">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">📄 Debit Notes</h1>
          <p className="text-gray-600">Manage supplier debit notes for rejected materials</p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#D8C7AA] bg-[#D8C7AA] md:grid-cols-5">
          {[
            ['Total', debitNoteSummary.total],
            ['Draft', debitNoteSummary.draft],
            ['Approved', debitNoteSummary.approved],
            ['Sent', debitNoteSummary.sent],
            ['Closed', debitNoteSummary.closed],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-white px-4 py-3">
              <div className="text-xs font-semibold uppercase text-[#7A6555]">{label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-[#3F2D20]">{value}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="overflow-hidden rounded-md border border-[#D8C7AA] bg-white">
            <div className="p-8 text-center text-[#7A6555]">Loading debit notes...</div>
          </div>
        ) : (
          <ListTable
            storageKey="debitNotesTable"
            rows={debitNotes}
            columns={tableColumns}
            getRowId={(dn) => dn.id}
            defaultPageSize={10}
            pageSizeOptions={[10, 25, 50, 100]}
            searchPlaceholder="Search by DN number, vendor, or GRN…"
            toolbarRight={
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-md border border-[#D8C7AA] bg-white px-3 py-2 text-sm text-[#3F2D20] focus:outline-none focus:ring-2 focus:ring-[#A78B62]"
              >
                <option value="">All Status</option>
                <option value="DRAFT">Draft</option>
                <option value="APPROVED">Approved</option>
                <option value="SENT">Sent</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="CLOSED">Closed</option>
              </select>
            }
            emptyState={
              <div className="p-12 text-center">
                <div className="text-6xl mb-4">📄</div>
                <h3 className="mb-2 text-xl font-semibold text-[#3F2D20]">No Debit Notes Found</h3>
                <p className="text-[#7A6555]">Debit notes will be created when rejected material or supplier deductions are posted.</p>
              </div>
            }
          />
        )}
      </div>

      {/* View Debit Note Modal */}
      {showViewModal && selectedDebitNote && (
        <div className="fixed inset-0 z-50 bg-white">
          <div className="flex h-screen flex-col">
            <div className="flex items-center justify-between border-b border-[#D8C7AA] bg-[#FAF9F6] px-6 py-4">
              <div>
                <h2 className="text-2xl font-bold text-[#3F2D20]">{selectedDebitNote.debit_note_number}</h2>
                <p className="mt-1 text-sm text-[#7A6555]">
                  Created by {selectedDebitNote.creator?.name} on {new Date(selectedDebitNote.debit_note_date).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => setShowViewModal(false)}
                className="rounded-md border border-[#D8C7AA] px-3 py-2 text-sm font-semibold text-[#5E4635] hover:bg-white"
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto bg-[#F7F3EA] p-6">
              {/* Header Information */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GRN Number</label>
                  <p className="text-gray-900 font-semibold">{selectedDebitNote.grn?.grn_number}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(selectedDebitNote.status)}`}>
                    {selectedDebitNote.status}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                  <p className="text-gray-900">{selectedDebitNote.vendor?.name}</p>
                  <p className="text-sm text-gray-500">{selectedDebitNote.vendor?.code}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
                  <p className="text-2xl font-bold text-red-600">
                    ₹{selectedDebitNote.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <p className="text-gray-900 bg-gray-50 p-3 rounded-lg">{selectedDebitNote.reason}</p>
              </div>

              {selectedDebitNote.notes && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <p className="text-gray-900 bg-gray-50 p-3 rounded-lg">{selectedDebitNote.notes}</p>
                </div>
              )}

              {/* Approval Info */}
              {selectedDebitNote.approver && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800">
                    ✓ Approved by <strong>{selectedDebitNote.approver.name}</strong> on{' '}
                    {new Date(selectedDebitNote.approval_date!).toLocaleDateString()}
                  </p>
                </div>
              )}

              {/* Line Items */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Rejected Items</h3>
                <div className="space-y-3">
                  {selectedDebitNote.debit_note_items?.map((item) => (
                    <div key={item.id} className="border border-red-200 rounded-lg p-4 bg-red-50">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="font-semibold text-gray-900">
                            {item.item.name} ({item.item.code})
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            Quantity: <span className="font-bold">{item.rejected_qty} {item.item.unit}</span>
                            <span className="mx-2">×</span>
                            ₹{item.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            <span className="mx-2">=</span>
                            <span className="font-bold text-red-600">
                              ₹{item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${getReturnStatusColor(item.return_status)}`}>
                          {item.return_status}
                        </span>
                      </div>
                      
                      <div className="text-sm text-gray-700 bg-white border-l-4 border-red-400 p-2 rounded mb-2">
                        <span className="font-medium">Rejection Reason:</span> {item.rejection_reason}
                      </div>

                      {item.disposal_notes && (
                        <div className="text-sm text-gray-600 bg-white p-2 rounded">
                          <span className="font-medium">Disposal Notes:</span> {item.disposal_notes}
                        </div>
                      )}

                      {/* Return Status Actions */}
                      {item.return_status === 'PENDING' && selectedDebitNote.status !== 'CLOSED' && canEditDebitNotes && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => updateReturnStatus(selectedDebitNote.id, item.id, 'RETURNED')}
                            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Mark Returned
                          </button>
                          <button
                            onClick={() => updateReturnStatus(selectedDebitNote.id, item.id, 'DESTROYED')}
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                          >
                            Mark Destroyed
                          </button>
                          <button
                            onClick={() => updateReturnStatus(selectedDebitNote.id, item.id, 'REWORKED')}
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Mark Reworked
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between border-t border-[#D8C7AA] bg-[#FAF9F6] px-6 py-4">
              <button
                onClick={() => setShowViewModal(false)}
                className="rounded-md border border-[#D8C7AA] px-5 py-2 text-sm font-semibold text-[#5E4635] hover:bg-white"
              >
                Close
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => handlePrintDebitNote(selectedDebitNote)}
                  className="rounded-md border border-[#D8C7AA] bg-white px-5 py-2 text-sm font-semibold text-[#5E4635] hover:bg-[#F7F3EA]"
                >
                  Print Debit Note
                </button>
                {selectedDebitNote.status === 'DRAFT' && canApproveDebitNotes && (
                  <button
                    onClick={() => approveDebitNote(selectedDebitNote.id)}
                    className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    ✓ Approve Debit Note
                  </button>
                )}
                {selectedDebitNote.status === 'APPROVED' && canEditDebitNotes && (
                  <button
                    onClick={() => sendEmailToSupplier(selectedDebitNote.id)}
                    className="rounded-md bg-[#8B6F47] px-5 py-2 text-sm font-semibold text-white hover:bg-[#745A37]"
                  >
                    📧 Send Email to Supplier
                  </button>
                )}
                {selectedDebitNote.status === 'SENT' && canEditDebitNotes && (
                  <button
                    onClick={() => updateStatus(selectedDebitNote.id, 'ACKNOWLEDGED')}
                    className="rounded-md bg-[#8B6F47] px-5 py-2 text-sm font-semibold text-white hover:bg-[#745A37]"
                  >
                    ✓ Mark as Acknowledged
                  </button>
                )}
                {selectedDebitNote.status === 'ACKNOWLEDGED' && canEditDebitNotes && (
                  <button
                    onClick={() => updateStatus(selectedDebitNote.id, 'CLOSED')}
                    className="rounded-md bg-[#3F2D20] px-5 py-2 text-sm font-semibold text-white hover:bg-[#2E2118]"
                  >
                    🔒 Close Debit Note
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
