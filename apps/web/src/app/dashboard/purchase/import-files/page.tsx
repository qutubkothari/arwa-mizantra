'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Calculator, Eye, FileText, PackageCheck, Plus, RefreshCw, Ship, Upload, WalletCards } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { ErpButton, ErpMetricStrip, ErpPageHeader, ErpStatusBadge } from '../../../../components/ui/ErpPrimitives';

type Vendor = { id: string; name?: string; code?: string };
type PurchaseOrder = { id: string; po_number?: string; poNumber?: string; vendor_id?: string; vendor?: Vendor; terms_and_conditions?: any };
type ImportFile = {
  id: string;
  import_number: string;
  status: string;
  currency: string;
  incoterm?: string;
  shipment_reference?: string;
  port_of_entry?: string;
  final_landed_cost?: number;
  vendor?: Vendor;
  po?: { po_number?: string };
  costs?: any[];
  documents?: any[];
  grns?: any[];
  payments?: any[];
};

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: any) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ImportFilesPage() {
  const [rows, setRows] = useState<ImportFile[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [uploadFor, setUploadFor] = useState<ImportFile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('COMMERCIAL_INVOICE');
  const [form, setForm] = useState<any>({ currency: 'USD', incoterm: 'FOB', expectedArrivalDate: today(), recoverableIgst: true });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [importRows, vendorRows, poRows] = await Promise.all([
        apiClient.get<ImportFile[]>('/purchase/import-files'),
        apiClient.get<Vendor[]>('/purchase/vendors', { isActive: true }),
        apiClient.get<PurchaseOrder[]>('/purchase/orders'),
      ]);
      setRows(importRows || []);
      setVendors(vendorRows || []);
      setOrders(poRows || []);
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const shouldCreate = params.get('create') === '1';
        const poId = params.get('poId') || '';
        if (shouldCreate) {
          const selectedPo = (poRows || []).find((po) => po.id === poId);
          let commercial: any = {};
          try {
            const tc = selectedPo?.terms_and_conditions;
            if (tc && typeof tc === 'string' && tc.startsWith('{')) commercial = JSON.parse(tc);
            else if (tc && typeof tc === 'object') commercial = tc;
          } catch {}
          setForm((current: any) => ({
            ...current,
            vendorId: selectedPo?.vendor_id || selectedPo?.vendor?.id || current.vendorId || '',
            poId: poId || current.poId || '',
            currency: commercial.supplierCurrency || current.currency || 'USD',
            customsExchangeRate: commercial.customsExchangeRate || current.customsExchangeRate || '',
            incoterm: commercial.incoterm || current.incoterm || 'FOB',
            shipmentReference: commercial.importNotes || current.shipmentReference || '',
          }));
          setShow(true);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to load Import Files.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const metrics = useMemo(() => {
    const open = rows.filter((row) => !['CLOSED', 'CANCELLED'].includes(String(row.status).toUpperCase())).length;
    const linkedGrns = rows.reduce((sum, row) => sum + (row.grns?.length || 0), 0);
    const pendingCost = rows.filter((row) => String(row.status).toUpperCase() === 'LANDED_COST_PENDING').length;
    const docs = rows.reduce((sum, row) => sum + (row.documents?.length || 0), 0);
    return [
      { label: 'Open import files', value: open },
      { label: 'Linked GRNs', value: linkedGrns },
      { label: 'Cost pending', value: pendingCost, tone: pendingCost ? 'warning' as const : 'neutral' as const },
      { label: 'Documents stored', value: docs },
    ];
  }, [rows]);

  const vendorName = (id: string) => vendors.find((vendor) => vendor.id === id)?.name || '';
  const poLabel = (po: PurchaseOrder) => `${po.po_number || po.poNumber || 'PO'}${po.vendor?.name ? ` - ${po.vendor.name}` : ''}`;

  const create = async () => {
    try {
      setError('');
      await apiClient.post('/purchase/import-files', form);
      setShow(false);
      setForm({ currency: 'USD', incoterm: 'FOB', expectedArrivalDate: today(), recoverableIgst: true });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Unable to create Import File.');
    }
  };

  const upload = async () => {
    if (!uploadFor || !file) {
      setError('Choose a file to upload.');
      return;
    }
    try {
      setError('');
      const data = new FormData();
      data.append('file', file);
      data.append('documentType', docType);
      await apiClient.postForm(`/purchase/import-files/${uploadFor.id}/documents/upload`, data);
      setUploadFor(null);
      setFile(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Document upload failed.');
    }
  };

  return (
    <main className="space-y-5 p-5">
      <ErpPageHeader
        eyebrow="Procurement / Import Control"
        title="Import Files & Landed Cost"
        description="Foreign PO control with customs documents, inward costs, GRNs, valuation allocation, and supplier payment trace."
        actions={
          <>
            <ErpButton variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh</ErpButton>
            <ErpButton variant="primary" onClick={() => setShow(true)}><Plus className="h-4 w-4" />New Import File</ErpButton>
          </>
        }
      />

      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <ErpMetricStrip metrics={metrics} loading={loading} />

      <section className="overflow-hidden rounded-md border border-[#E8DCC4] bg-white">
        <div className="border-b border-[#E8DCC4] bg-[#FFFCF7] px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">SAP-style import purchase control</div>
          <h2 className="mt-1 text-lg font-bold text-[#3D2B1F]">Import file lifecycle</h2>
          <p className="mt-1 text-sm text-[#5E4635]">
            One import file ties the foreign supplier, customs valuation, documents, GRNs, landed cost allocation, and supplier/agency payments into a single trail.
          </p>
        </div>
        <div className="grid divide-y divide-[#EFE6D7] md:grid-cols-6 md:divide-x md:divide-y-0">
          {[
            ['1', 'Foreign PO', 'Create or link the foreign supplier PO with currency and incoterm.', Ship],
            ['2', 'Documents', 'Store invoice, packing list, BL/AWB, bill of entry, duty challan and freight documents.', FileText],
            ['3', 'Customs valuation', 'Capture customs exchange rate, assessable value, duty, SWS and import IGST.', Calculator],
            ['4', 'GRN link', 'Link received GRNs so stock and receipt history remain connected.', PackageCheck],
            ['5', 'Landed cost', 'Allocate non-recoverable duties and inward costs to stock valuation.', Upload],
            ['6', 'Payments & trail', 'Track supplier, customs, CHA, freight, insurance and bank payments.', WalletCards],
          ].map(([step, title, body, Icon]) => (
            <div key={String(step)} className="p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F5EFE3] text-xs font-bold text-[#6F4E37]">{String(step)}</span>
                <Icon className="h-4 w-4 text-[#8B6F47]" />
              </div>
              <div className="mt-3 font-bold text-[#3D2B1F]">{String(title)}</div>
              <p className="mt-1 text-xs leading-5 text-[#6F5A49]">{String(body)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-[#E8DCC4] bg-white">
        <div className="flex items-center justify-between border-b border-[#E8DCC4] px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#3D2B1F]">Import Register</h2>
            <p className="text-xs text-[#7A6555]">Shipment, customs, GRN, cost and payment status in one trail.</p>
          </div>
          <Ship className="h-5 w-5 text-[#8B6F47]" />
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#7A6555]">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#7A6555]">No import files yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-[#F5EFE3] text-left text-xs uppercase text-[#5E4635]">
                <tr>
                  <th className="p-3">Import File</th>
                  <th className="p-3">Supplier / PO</th>
                  <th className="p-3">Shipment</th>
                  <th className="p-3 text-right">Landed Cost</th>
                  <th className="p-3">Documents</th>
                  <th className="p-3">GRNs</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#F0E8DA] align-top">
                    <td className="p-3 font-semibold text-[#3D2B1F]">
                      {row.import_number}
                      <div className="text-xs font-normal text-[#7A6555]">{row.currency} / {row.incoterm || 'Incoterm pending'}</div>
                    </td>
                    <td className="p-3">
                      {row.vendor?.name || '-'}
                      <div className="text-xs text-[#7A6555]">{row.po?.po_number || 'PO not linked'}</div>
                    </td>
                    <td className="p-3">
                      {row.shipment_reference || '-'}
                      <div className="text-xs text-[#7A6555]">{row.port_of_entry || '-'}</div>
                    </td>
                    <td className="p-3 text-right font-semibold">Rs. {money(row.final_landed_cost)}</td>
                    <td className="p-3">
                      <button onClick={() => setUploadFor(row)} className="inline-flex items-center gap-1 text-[#7A542F] underline">
                        <Upload className="h-3.5 w-3.5" />{row.documents?.length || 0} file(s)
                      </button>
                    </td>
                    <td className="p-3">{row.grns?.length || 0}</td>
                    <td className="p-3"><ErpStatusBadge status={row.status} /></td>
                    <td className="p-3 text-right">
                      <Link href={`/dashboard/purchase/import-files/${row.id}`}>
                        <ErpButton variant="secondary" size="sm"><Eye className="h-3.5 w-3.5" />Open</ErpButton>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {uploadFor ? (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#3B2A1F]/55 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl">
            <h2 className="font-semibold text-[#3D2B1F]">Upload Import Document</h2>
            <p className="mt-1 text-xs text-[#7A6555]">{uploadFor.import_number}</p>
            <label className="mt-4 block text-xs font-semibold uppercase text-[#5E4635]">
              Document type
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className="mt-1 w-full rounded-md border border-[#D8C8AA] p-2 text-sm">
                <option value="COMMERCIAL_INVOICE">Commercial Invoice</option>
                <option value="PACKING_LIST">Packing List</option>
                <option value="BILL_OF_LADING">Bill of Lading / AWB</option>
                <option value="BILL_OF_ENTRY">Bill of Entry</option>
                <option value="DUTY_CHALLAN">Duty Challan</option>
                <option value="FREIGHT_INVOICE">Freight Invoice</option>
                <option value="INSURANCE">Insurance</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-4 w-full text-sm" />
            <div className="mt-5 flex justify-end gap-2">
              <ErpButton variant="secondary" onClick={() => setUploadFor(null)}>Cancel</ErpButton>
              <ErpButton variant="primary" onClick={() => void upload()}><Upload className="h-4 w-4" />Upload</ErpButton>
            </div>
          </div>
        </div>
      ) : null}

      {show ? (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#3B2A1F]/55 p-4">
          <div className="w-full max-w-3xl rounded-md bg-white shadow-2xl">
            <div className="border-b border-[#E8DCC4] p-5">
              <h2 className="font-semibold text-[#3D2B1F]">Create Import File</h2>
              <p className="mt-1 text-xs text-[#7A6555]">Create the parent record before customs, landed cost and GRN allocation.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase text-[#5E4635]">
                Foreign supplier *
                <select value={form.vendorId || ''} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal">
                  <option value="">Select supplier...</option>
                  {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name || vendor.code}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase text-[#5E4635]">
                Linked foreign PO
                <select value={form.poId || ''} onChange={(e) => setForm({ ...form, poId: e.target.value })} className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal">
                  <option value="">Optional</option>
                  {orders.map((po) => <option key={po.id} value={po.id}>{poLabel(po)}</option>)}
                </select>
              </label>
              {[
                ['currency', 'Currency'],
                ['incoterm', 'Incoterm'],
                ['shipmentReference', 'Shipment / container reference'],
                ['portOfEntry', 'Port of entry'],
                ['customsExchangeRate', 'Customs exchange rate'],
                ['expectedArrivalDate', 'Expected arrival'],
                ['billOfEntryNumber', 'Bill of Entry number'],
                ['commercialInvoiceNumber', 'Commercial invoice number'],
                ['assessableValueInr', 'Assessable value INR'],
                ['bcdAmount', 'BCD amount'],
                ['swsAmount', 'SWS amount'],
                ['importIgstAmount', 'Import IGST amount'],
              ].map(([key, label]) => (
                <label key={key} className="text-xs font-semibold uppercase text-[#5E4635]">
                  {label}
                  <input
                    type={key.toLowerCase().includes('date') || key === 'expectedArrivalDate' ? 'date' : 'text'}
                    value={form[key] || ''}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-[#5E4635] md:col-span-2">
                <input type="checkbox" checked={form.recoverableIgst !== false} onChange={(e) => setForm({ ...form, recoverableIgst: e.target.checked })} />
                Import IGST is recoverable input credit
              </label>
              <div className="text-xs text-[#7A6555] md:col-span-2">
                Selected supplier: {form.vendorId ? vendorName(form.vendorId) || 'Supplier selected' : 'None'}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E8DCC4] p-4">
              <ErpButton variant="secondary" onClick={() => setShow(false)}>Cancel</ErpButton>
              <ErpButton variant="primary" onClick={() => void create()}><FileText className="h-4 w-4" />Create Import File</ErpButton>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
