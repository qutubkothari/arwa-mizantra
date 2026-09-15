'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, FileText, Link2, Plus, RefreshCw, Upload, WalletCards } from 'lucide-react';
import { apiClient } from '../../../../../../lib/api-client';
import { ErpButton, ErpMetricStrip, ErpPageHeader, ErpStatusBadge } from '../../../../../components/ui/ErpPrimitives';

type Vendor = { id: string; name?: string; code?: string };
type Grn = { id: string; grn_number?: string; purchase_order_id?: string; po_id?: string; status?: string; vendor?: Vendor };
type ImportFile = {
  id: string;
  import_number: string;
  status: string;
  currency: string;
  customs_exchange_rate?: number;
  bill_of_entry_number?: string;
  bill_of_entry_date?: string;
  port_of_entry?: string;
  commercial_invoice_number?: string;
  commercial_invoice_date?: string;
  assessable_value_inr?: number;
  vendor?: Vendor;
  po?: { po_number?: string };
  po_id?: string;
  final_landed_cost?: number;
  bcd_amount?: number;
  sws_amount?: number;
  import_igst_amount?: number;
  recoverable_igst?: boolean;
  costs?: any[];
  documents?: any[];
  grns?: any[];
  allocations?: any[];
  assessment_lines?: any[];
  assessmentSourceLines?: any[];
  payments?: any[];
  events?: any[];
};

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: any) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ImportFileDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const [data, setData] = useState<ImportFile | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cost, setCost] = useState<any>({ costType: 'FREIGHT', currency: 'INR', exchangeRate: 1, costDate: today(), allocationBasis: 'VALUE' });
  const [payment, setPayment] = useState<any>({ paymentCategory: 'FOREIGN_SUPPLIER', currency: 'INR', exchangeRate: 1, paymentDate: today() });
  const [grnLink, setGrnLink] = useState<any>({ allocationBasis: 'VALUE' });
  const [assessmentHeader, setAssessmentHeader] = useState<any>({ billOfEntryDate: today(), customsExchangeRate: 1 });
  const [assessmentRows, setAssessmentRows] = useState<any[]>([]);
  const [docType, setDocType] = useState('COMMERCIAL_INVOICE');
  const [file, setFile] = useState<File | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [fileRow, vendorRows, grnRows] = await Promise.all([
        apiClient.get<ImportFile>(`/purchase/import-files/${id}`),
        apiClient.get<Vendor[]>('/purchase/vendors', { isActive: true }),
        apiClient.get<Grn[]>('/purchase/grn'),
      ]);
      setData(fileRow);
      setVendors(vendorRows || []);
      setGrns(grnRows || []);
    } catch (e: any) {
      setError(e?.message || 'Unable to load import file.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) void load();
  }, [id]);

  useEffect(() => {
    if (!data) return;
    const existingByGrnItem = new Map((data.assessment_lines || []).map((row: any) => [String(row.grn_item_id || row.id), row]));
    const source = data.assessmentSourceLines || [];
    setAssessmentHeader({
      billOfEntryNumber: data.bill_of_entry_number || '',
      billOfEntryDate: String(data.bill_of_entry_date || '').slice(0, 10) || today(),
      portOfEntry: data.port_of_entry || '',
      customsExchangeRate: data.customs_exchange_rate || 1,
      commercialInvoiceNumber: data.commercial_invoice_number || '',
      commercialInvoiceDate: String(data.commercial_invoice_date || '').slice(0, 10) || '',
    });
    setAssessmentRows(source.map((line: any) => {
      const existing = existingByGrnItem.get(String(line.id)) || {};
      const qty = Number(line.accepted_qty ?? line.received_qty ?? line.quantity ?? 0) || 0;
      const rate = Number(line.rate ?? line.unit_price ?? 0) || 0;
      const assessed = Number(existing.assessed_value_inr ?? (qty * rate)) || 0;
      const duty = Number(existing.customs_duty_amount ?? 0) || 0;
      const cess = Number(existing.cess_amount ?? 0) || 0;
      const gstRate = Number(existing.gst_rate ?? 0) || 0;
      const taxBase = assessed + duty + cess;
      return {
        grnId: line.grn_id,
        grnItemId: line.id,
        itemId: line.item_id,
        itemCode: line.item_code || '',
        itemName: line.item_name || '',
        quantity: qty,
        foreignAmount: Number(existing.foreign_amount ?? 0) || 0,
        exchangeRate: Number(existing.exchange_rate ?? data.customs_exchange_rate ?? 1) || 1,
        assessedValueInr: assessed,
        customsDutyAmount: duty,
        cessAmount: cess,
        gstRate,
        gstAmount: Number(existing.gst_amount ?? ((taxBase * gstRate) / 100)) || 0,
        notes: existing.notes || '',
      };
    }));
  }, [data]);

  const filteredGrns = useMemo(() => {
    const linked = new Set((data?.grns || []).map((row: any) => String(row.grn_id)));
    return (grns || []).filter((grn) => {
      if (linked.has(String(grn.id))) return false;
      const poId = String(grn.purchase_order_id || grn.po_id || '');
      return !data?.po_id || poId === String(data.po_id);
    });
  }, [data, grns]);

  const metrics = useMemo(() => {
    const duty = Number(data?.bcd_amount || 0) + Number(data?.sws_amount || 0) + (data?.recoverable_igst ? 0 : Number(data?.import_igst_amount || 0));
    const inward = (data?.costs || []).reduce((sum: number, row: any) => sum + Number(row.inr_amount || 0) - Number(row.recoverable_tax_amount || 0), 0);
    const paid = (data?.payments || []).filter((row: any) => row.status === 'PAID').reduce((sum: number, row: any) => sum + Number(row.inr_amount || 0), 0);
    return [
      { label: 'Non-recoverable duty', value: `Rs. ${money(duty)}` },
      { label: 'Inward cost pool', value: `Rs. ${money(inward)}` },
      { label: 'Allocated landed cost', value: `Rs. ${money(data?.final_landed_cost)}` },
      { label: 'Import payments paid', value: `Rs. ${money(paid)}` },
    ];
  }, [data]);

  const post = async (fn: () => Promise<any>) => {
    try {
      setError('');
      const next = await fn();
      setData(next);
    } catch (e: any) {
      setError(e?.message || 'Action failed.');
    }
  };

  const addCost = () => post(async () => {
    const next = await apiClient.post<ImportFile>(`/purchase/import-files/${id}/costs`, cost);
    setCost({ costType: 'FREIGHT', currency: 'INR', exchangeRate: 1, costDate: today(), allocationBasis: 'VALUE' });
    return next;
  });

  const linkGrn = () => post(async () => {
    const next = await apiClient.post<ImportFile>(`/purchase/import-files/${id}/grns`, grnLink);
    setGrnLink({ allocationBasis: 'VALUE' });
    return next;
  });

  const updateAssessmentRow = (index: number, key: string, value: any) => {
    setAssessmentRows((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, [key]: value };
      const assessed = Number(next.assessedValueInr || 0) || 0;
      const duty = Number(next.customsDutyAmount || 0) || 0;
      const cess = Number(next.cessAmount || 0) || 0;
      const gstRate = Number(next.gstRate || 0) || 0;
      next.gstAmount = Number((((assessed + duty + cess) * gstRate) / 100).toFixed(2));
      return next;
    }));
  };

  const saveAssessment = () => post(async () => apiClient.post<ImportFile>(`/purchase/import-files/${id}/assessment`, {
    ...assessmentHeader,
    lines: assessmentRows,
  }));

  const addPayment = () => post(async () => {
    const next = await apiClient.post<ImportFile>(`/purchase/import-files/${id}/payments`, payment);
    setPayment({ paymentCategory: 'FOREIGN_SUPPLIER', currency: 'INR', exchangeRate: 1, paymentDate: today() });
    return next;
  });

  const upload = async () => {
    if (!file) {
      setError('Choose a document to upload.');
      return;
    }
    await post(async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('documentType', docType);
      const next = await apiClient.postForm<ImportFile>(`/purchase/import-files/${id}/documents/upload`, form);
      setFile(null);
      return next;
    });
  };

  return (
    <main className="space-y-5 p-5">
      <ErpPageHeader
        eyebrow="Procurement / Import File"
        title={data?.import_number || 'Import File'}
        description={data ? `${data.vendor?.name || 'Supplier pending'}${data.po?.po_number ? ` / ${data.po.po_number}` : ''}` : 'Loading import control file'}
        actions={
          <>
            <Link href="/dashboard/purchase/import-files"><ErpButton variant="secondary"><ArrowLeft className="h-4 w-4" />Back</ErpButton></Link>
            {data?.po_id ? <Link href={`/dashboard/purchase/orders?viewId=${data.po_id}`}><ErpButton variant="secondary"><ExternalLink className="h-4 w-4" />Open PO</ErpButton></Link> : null}
            <ErpButton variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh</ErpButton>
            {data ? <ErpStatusBadge status={data.status} /> : null}
          </>
        }
      />

      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <ErpMetricStrip metrics={metrics} loading={loading} />

      <section className="grid gap-4 rounded-md border border-[#E8DCC4] bg-[#FFFCF7] p-4 lg:grid-cols-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Valuation rule</div>
          <p className="mt-1 text-sm leading-6 text-[#5E4635]">
            Landed cost should include non-recoverable customs duty and inward charges. Recoverable IGST stays as input credit and should not inflate stock value.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Document storage</div>
          <p className="mt-1 text-sm leading-6 text-[#5E4635]">
            Keep commercial invoice, packing list, BL/AWB, bill of entry, duty challan, freight/insurance bills and CHA documents in this file.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Trail retrieval</div>
          <p className="mt-1 text-sm leading-6 text-[#5E4635]">
            GRNs, allocations, costs, supplier/agency payments and events are intentionally kept together so the full supplier/import history is one click away.
          </p>
        </div>
      </section>

      <section className="rounded-md border border-[#E8DCC4] bg-white">
        <div className="border-b border-[#E8DCC4] px-5 py-4">
          <h2 className="font-semibold text-[#3D2B1F]">Import Document Chain</h2>
          <p className="text-xs text-[#7A6555]">One-click status of the foreign PO, import documents, GRN receipt, landed cost and payment trail.</p>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-5">
          {[
            {
              label: 'Foreign PO',
              value: data?.po?.po_number || 'Not linked',
              tone: data?.po_id ? 'success' : 'warning',
              href: data?.po_id ? `/dashboard/purchase/orders?viewId=${data.po_id}` : '',
            },
            {
              label: 'Documents',
              value: `${data?.documents?.length || 0} stored`,
              tone: (data?.documents?.length || 0) > 0 ? 'success' : 'warning',
              href: '',
            },
            {
              label: 'GRN Links',
              value: `${data?.grns?.length || 0} linked`,
              tone: (data?.grns?.length || 0) > 0 ? 'success' : 'warning',
              href: '',
            },
            {
              label: 'Landed Cost',
              value: data?.final_landed_cost ? `Rs. ${money(data.final_landed_cost)}` : 'Not posted',
              tone: data?.final_landed_cost ? 'success' : 'warning',
              href: '',
            },
            {
              label: 'Payments',
              value: `${data?.payments?.length || 0} requests`,
              tone: (data?.payments?.length || 0) > 0 ? 'success' : 'neutral',
              href: '',
            },
          ].map((step) => (
            <div key={step.label} className="rounded-lg border border-[#E8DCC4] bg-[#FAF9F6] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">{step.label}</div>
                  <div className="mt-1 font-bold text-[#3D2B1F]">{step.value}</div>
                </div>
                <ErpStatusBadge status={step.tone === 'success' ? 'APPROVED' : step.tone === 'warning' ? 'PENDING' : 'DRAFT'} />
              </div>
              {step.href ? <Link href={step.href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#7A542F] underline">Open <ExternalLink className="h-3 w-3" /></Link> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-[#E8DCC4] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#E8DCC4] px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-semibold text-[#3D2B1F]">Accounts BOE Assessment</h2>
            <p className="text-xs text-[#7A6555]">
              Stores posts the GRN for physical stock. Accounts records BOE/customs valuation here; GST is calculated on assessed value + custom duty + cess.
            </p>
          </div>
          <ErpButton variant="primary" onClick={saveAssessment}><CheckCircle2 className="h-4 w-4" />Save BOE Assessment</ErpButton>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['billOfEntryNumber', 'BOE Number', 'text'],
            ['billOfEntryDate', 'BOE Date', 'date'],
            ['portOfEntry', 'Port of Discharge', 'text'],
            ['customsExchangeRate', `${data?.currency || 'FCY'} → INR Rate`, 'number'],
            ['commercialInvoiceNumber', 'Supplier Invoice No.', 'text'],
            ['commercialInvoiceDate', 'Supplier Invoice Date', 'date'],
          ].map(([key, label, type]) => (
            <label key={key} className="text-xs font-semibold uppercase text-[#5E4635]">
              {label}
              <input
                type={type}
                step={type === 'number' ? '0.000001' : undefined}
                value={assessmentHeader[key] || ''}
                onChange={(e) => setAssessmentHeader({ ...assessmentHeader, [key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal"
              />
            </label>
          ))}
        </div>
        <div className="overflow-x-auto border-t border-[#E8DCC4]">
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="bg-[#F5EFE3] text-left text-xs uppercase text-[#5E4635]">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Foreign Value</th>
                <th className="p-3 text-right">FX Rate</th>
                <th className="p-3 text-right">Assessed INR</th>
                <th className="p-3 text-right">Custom Duty</th>
                <th className="p-3 text-right">Cess</th>
                <th className="p-3 text-right">GST %</th>
                <th className="p-3 text-right">GST Amount</th>
                <th className="p-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {assessmentRows.map((row, index) => (
                <tr key={row.grnItemId || index} className="border-t border-[#F0E8DA] align-top">
                  <td className="p-3">
                    <div className="font-semibold text-[#3D2B1F]">{row.itemCode || '-'}</div>
                    <div className="text-xs text-[#7A6555]">{row.itemName || '-'}</div>
                  </td>
                  <td className="p-3 text-right">{row.quantity}</td>
                  {[
                    ['foreignAmount', '0.01'],
                    ['exchangeRate', '0.000001'],
                    ['assessedValueInr', '0.01'],
                    ['customsDutyAmount', '0.01'],
                    ['cessAmount', '0.01'],
                    ['gstRate', '0.01'],
                  ].map(([key, step]) => (
                    <td key={key} className="p-3">
                      <input
                        type="number"
                        step={step}
                        value={row[key] || ''}
                        onChange={(e) => updateAssessmentRow(index, key, e.target.value)}
                        className="w-28 rounded-md border border-[#D8C8AA] px-2 py-1 text-right"
                      />
                    </td>
                  ))}
                  <td className="p-3 text-right font-semibold text-[#3D2B1F]">Rs. {money(row.gstAmount)}</td>
                  <td className="p-3">
                    <input
                      value={row.notes || ''}
                      onChange={(e) => updateAssessmentRow(index, 'notes', e.target.value)}
                      className="w-48 rounded-md border border-[#D8C8AA] px-2 py-1"
                      placeholder="BOE line remark"
                    />
                  </td>
                </tr>
              ))}
              {!assessmentRows.length ? (
                <tr className="border-t border-[#F0E8DA]">
                  <td colSpan={10} className="p-5 text-center text-sm text-[#7A6555]">
                    Link a GRN to this import file first. Accounts assessment lines will appear from the linked GRN items.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {assessmentRows.length ? (
              <tfoot className="border-t border-[#E8DCC4] bg-[#FFFCF7] font-semibold text-[#3D2B1F]">
                <tr>
                  <td className="p-3" colSpan={4}>Totals</td>
                  <td className="p-3 text-right">Rs. {money(assessmentRows.reduce((sum, row) => sum + Number(row.assessedValueInr || 0), 0))}</td>
                  <td className="p-3 text-right">Rs. {money(assessmentRows.reduce((sum, row) => sum + Number(row.customsDutyAmount || 0), 0))}</td>
                  <td className="p-3 text-right">Rs. {money(assessmentRows.reduce((sum, row) => sum + Number(row.cessAmount || 0), 0))}</td>
                  <td className="p-3"></td>
                  <td className="p-3 text-right">Rs. {money(assessmentRows.reduce((sum, row) => sum + Number(row.gstAmount || 0), 0))}</td>
                  <td className="p-3"></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-md border border-[#E8DCC4] bg-white">
          <div className="border-b border-[#E8DCC4] px-5 py-4">
            <h2 className="font-semibold text-[#3D2B1F]">Inward Costs</h2>
            <p className="text-xs text-[#7A6555]">Freight, insurance, CHA, customs duty and other charges that affect landed valuation.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {[
              ['costType', 'Cost type'],
              ['documentNumber', 'Invoice / document no.'],
              ['currency', 'Currency'],
              ['exchangeRate', 'Exchange rate'],
              ['foreignAmount', 'Foreign amount'],
              ['inrAmount', 'INR amount'],
              ['recoverableTaxAmount', 'Recoverable tax'],
              ['costDate', 'Cost date'],
            ].map(([key, label]) => (
              <label key={key} className="text-xs font-semibold uppercase text-[#5E4635]">
                {label}
                <input type={key === 'costDate' ? 'date' : 'text'} value={cost[key] || ''} onChange={(e) => setCost({ ...cost, [key]: e.target.value })} className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal" />
              </label>
            ))}
            <label className="text-xs font-semibold uppercase text-[#5E4635]">
              Local supplier / agency
              <select value={cost.supplierId || ''} onChange={(e) => setCost({ ...cost, supplierId: e.target.value })} className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal">
                <option value="">Optional</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name || vendor.code}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase text-[#5E4635]">
              Allocation basis
              <select value={cost.allocationBasis || 'VALUE'} onChange={(e) => setCost({ ...cost, allocationBasis: e.target.value })} className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal">
                <option value="VALUE">Value</option>
                <option value="QTY">Quantity</option>
              </select>
            </label>
            <label className="col-span-2 text-xs font-semibold uppercase text-[#5E4635]">
              Note
              <input value={cost.notes || ''} onChange={(e) => setCost({ ...cost, notes: e.target.value })} className="mt-1 w-full rounded-md border border-[#D8C8AA] px-3 py-2 text-sm font-normal" />
            </label>
            <div className="col-span-2 flex justify-end"><ErpButton variant="primary" onClick={addCost}><Plus className="h-4 w-4" />Add Cost</ErpButton></div>
          </div>
          <SimpleTable headers={['Type', 'Supplier', 'Document', 'INR', 'Recoverable Tax']}>
            {(data?.costs || []).map((row: any) => (
              <tr key={row.id} className="border-t border-[#F0E8DA]">
                <td className="p-3">{row.cost_type}</td><td className="p-3">{row.supplier?.name || '-'}</td><td className="p-3">{row.document_number || '-'}</td><td className="p-3 text-right">Rs. {money(row.inr_amount)}</td><td className="p-3 text-right">Rs. {money(row.recoverable_tax_amount)}</td>
              </tr>
            ))}
            {!(data?.costs || []).length ? (
              <tr className="border-t border-[#F0E8DA]">
                <td colSpan={5} className="p-5 text-center text-sm text-[#7A6555]">
                  No inward costs recorded yet. Add freight, CHA, insurance, duty or other charges before posting landed cost.
                </td>
              </tr>
            ) : null}
          </SimpleTable>
        </section>

        <section className="space-y-5">
          <Panel title="Documents" icon={<Upload className="h-4 w-4" />}>
            <div className="grid gap-3">
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm">
                <option value="COMMERCIAL_INVOICE">Commercial Invoice</option><option value="PACKING_LIST">Packing List</option><option value="BILL_OF_LADING">Bill of Lading / AWB</option><option value="BILL_OF_ENTRY">Bill of Entry</option><option value="DUTY_CHALLAN">Duty Challan</option><option value="FREIGHT_INVOICE">Freight Invoice</option><option value="INSURANCE">Insurance</option><option value="OTHER">Other</option>
              </select>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
              <ErpButton variant="primary" onClick={() => void upload()}><Upload className="h-4 w-4" />Upload Document</ErpButton>
              <div className="divide-y divide-[#F0E8DA] text-sm">
                {(data?.documents || []).map((doc: any) => <a key={doc.id} href={doc.file_url} target="_blank" className="flex items-center gap-2 py-2 text-[#7A542F] underline"><FileText className="h-4 w-4" />{doc.document_type}: {doc.file_name}</a>)}
                {!(data?.documents || []).length ? <div className="py-3 text-[#7A6555]">No import documents uploaded yet.</div> : null}
              </div>
            </div>
          </Panel>

          <Panel title="GRN Link & Allocation" icon={<Link2 className="h-4 w-4" />}>
            <div className="grid gap-3">
              <select value={grnLink.grnId || ''} onChange={(e) => setGrnLink({ ...grnLink, grnId: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm">
                <option value="">Select GRN...</option>
                {filteredGrns.map((grn) => <option key={grn.id} value={grn.id}>{grn.grn_number || grn.id} / {grn.status || '-'}</option>)}
              </select>
              <select value={grnLink.allocationBasis || 'VALUE'} onChange={(e) => setGrnLink({ ...grnLink, allocationBasis: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm">
                <option value="VALUE">Allocate by value</option><option value="QTY">Allocate by quantity</option>
              </select>
              <div className="flex gap-2"><ErpButton variant="secondary" onClick={linkGrn}><Link2 className="h-4 w-4" />Link GRN</ErpButton><ErpButton variant="approve" onClick={() => post(() => apiClient.post(`/purchase/import-files/${id}/landed-cost/post`))}><CheckCircle2 className="h-4 w-4" />Post Landed Cost</ErpButton></div>
              <div className="divide-y divide-[#F0E8DA] text-sm">
                {(data?.grns || []).map((row: any) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/dashboard/purchase/grn?viewId=${row.grn_id}`} className="text-[#7A542F] underline">
                      {row.grn?.grn_number || row.grn_id}
                    </Link>
                    <ErpStatusBadge status={row.status} />
                  </div>
                ))}
                {!(data?.grns || []).length ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    No GRN linked yet. Link the received GRN before landed cost allocation can be posted.
                  </div>
                ) : null}
              </div>
            </div>
          </Panel>
        </section>
      </div>

      <section className="rounded-md border border-[#E8DCC4] bg-white">
        <div className="border-b border-[#E8DCC4] px-5 py-4">
          <h2 className="font-semibold text-[#3D2B1F]">Import Payments</h2>
          <p className="text-xs text-[#7A6555]">Foreign supplier, customs, CHA, freight, insurance and bank charges with approval trail.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <select value={payment.paymentCategory || ''} onChange={(e) => setPayment({ ...payment, paymentCategory: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm">
            <option value="FOREIGN_SUPPLIER">Foreign Supplier</option><option value="CUSTOMS">Customs</option><option value="CHA">CHA</option><option value="FREIGHT">Freight</option><option value="INSURANCE">Insurance</option><option value="BANK_CHARGES">Bank Charges</option><option value="OTHER">Other</option>
          </select>
          <select value={payment.supplierId || ''} onChange={(e) => setPayment({ ...payment, supplierId: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm">
            <option value="">Select payee...</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name || vendor.code}</option>)}
          </select>
          <input placeholder="Document no." value={payment.documentNumber || ''} onChange={(e) => setPayment({ ...payment, documentNumber: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm" />
          <input placeholder="INR amount" value={payment.inrAmount || ''} onChange={(e) => setPayment({ ...payment, inrAmount: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm" />
          <input placeholder="Payment ref" value={payment.paymentReference || ''} onChange={(e) => setPayment({ ...payment, paymentReference: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm" />
          <input type="date" value={payment.paymentDate || today()} onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm" />
          <input placeholder="Note / reason" value={payment.notes || ''} onChange={(e) => setPayment({ ...payment, notes: e.target.value })} className="rounded-md border border-[#D8C8AA] px-3 py-2 text-sm md:col-span-2" />
          <div className="md:col-span-4"><ErpButton variant="primary" onClick={addPayment}><WalletCards className="h-4 w-4" />Record Payment Request</ErpButton></div>
        </div>
        <SimpleTable headers={['Category', 'Payee', 'Document', 'Amount', 'Status', 'Actions']}>
          {(data?.payments || []).map((row: any) => (
            <tr key={row.id} className="border-t border-[#F0E8DA]">
              <td className="p-3">{row.payment_category}</td><td className="p-3">{row.supplier?.name || '-'}</td><td className="p-3">{row.document_number || '-'}</td><td className="p-3 text-right">Rs. {money(row.inr_amount)}</td><td className="p-3"><ErpStatusBadge status={row.status} /></td>
              <td className="p-3 text-right"><PaymentActions id={id} row={row} onDone={setData} setError={setError} /></td>
            </tr>
          ))}
          {!(data?.payments || []).length ? (
            <tr className="border-t border-[#F0E8DA]">
              <td colSpan={6} className="p-5 text-center text-sm text-[#7A6555]">
                No payment requests yet. Record foreign supplier, customs, freight, CHA, insurance or bank charge payment requests here.
              </td>
            </tr>
          ) : null}
        </SimpleTable>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Landed Cost Allocation Trail" icon={<CheckCircle2 className="h-4 w-4" />}>
          <div className="max-h-80 overflow-auto text-sm">
            {(data?.allocations || []).map((row: any) => <div key={row.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-[#F0E8DA] py-2"><span>{row.item_code || row.item_name}<br /><span className="text-xs text-[#7A6555]">Qty {row.received_qty} / Unit landed Rs. {money(row.landed_unit_cost)} / <Link href={`/dashboard/purchase/grn?viewId=${row.grn_id}`} className="text-[#7A542F] underline">Open GRN</Link></span></span><strong>Rs. {money(row.allocated_landed_cost)}</strong></div>)}
            {!(data?.allocations || []).length ? <div className="rounded-md border border-[#E8DCC4] bg-[#FAF9F6] p-4 text-[#7A6555]">No landed cost allocation posted yet.</div> : null}
          </div>
        </Panel>
        <Panel title="Event Trail" icon={<FileText className="h-4 w-4" />}>
          <div className="max-h-80 overflow-auto text-sm">
            {(data?.events || []).map((row: any) => <div key={row.id} className="border-b border-[#F0E8DA] py-2"><strong>{row.event_type}</strong><p className="text-[#5E4635]">{row.description}</p><p className="text-xs text-[#7A6555]">{new Date(row.created_at).toLocaleString('en-IN')}</p></div>)}
            {!(data?.events || []).length ? <div className="rounded-md border border-[#E8DCC4] bg-[#FAF9F6] p-4 text-[#7A6555]">No import events recorded yet.</div> : null}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-md border border-[#E8DCC4] bg-white"><div className="flex items-center gap-2 border-b border-[#E8DCC4] px-5 py-4 font-semibold text-[#3D2B1F]">{icon}{title}</div><div className="p-4">{children}</div></section>;
}

function SimpleTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto border-t border-[#E8DCC4]"><table className="w-full min-w-[720px] text-sm"><thead className="bg-[#F5EFE3] text-left text-xs uppercase text-[#5E4635]"><tr>{headers.map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function PaymentActions({ id, row, onDone, setError }: { id: string; row: any; onDone: (value: any) => void; setError: (value: string) => void }) {
  const move = async (status: string) => {
    try {
      setError('');
      const next = await apiClient.post(`/purchase/import-files/${id}/payments/${row.id}/status`, { status, paymentReference: row.payment_reference, paymentDate: row.payment_date });
      onDone(next);
    } catch (e: any) {
      setError(e?.message || 'Payment update failed.');
    }
  };
  return <div className="flex justify-end gap-2">{row.status === 'PENDING_APPROVAL' ? <ErpButton size="sm" variant="approve" onClick={() => void move('APPROVED')}>Approve</ErpButton> : null}{row.status === 'APPROVED' ? <ErpButton size="sm" variant="primary" onClick={() => void move('PAID')}>Mark Paid</ErpButton> : null}{row.status !== 'REVERSED' ? <ErpButton size="sm" variant="danger" onClick={() => void move('REVERSED')}>Reverse</ErpButton> : null}</div>;
}
