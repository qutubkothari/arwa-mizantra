'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CreditCard, FileText, RefreshCw, X } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { confirmDialog } from '../../../../components/ui/ConfirmDialog';

type SubcontractPayable = {
  id: string; order_id: string; operation_name?: string; vendor_id?: string;
  processing_amount?: number; tax_amount?: number; deduction_amount?: number;
  payable_amount?: number; paid_amount?: number; invoice_number?: string;
  invoice_date?: string; invoice_status?: string;
  order?: { order_number?: string; route?: { route_number?: string; name?: string } };
  vendor?: { name?: string; vendor_name?: string; vendor_code?: string };
};

const money = (value: unknown) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const statusText = (value?: string) => String(value || 'PENDING_INVOICE').replace(/_/g, ' ');

export default function SubcontractPayablesPage() {
  const [rows, setRows] = useState<SubcontractPayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState<{ row: SubcontractPayable; number: string; date: string; file: File | null } | null>(null);
  const [payment, setPayment] = useState<{ row: SubcontractPayable; amount: string; reference: string } | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { setRows(await apiClient.get<SubcontractPayable[]>('/production/subcontracting/finance')); }
    catch (err: any) { setError(err?.message || 'Unable to load subcontract payables.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((row) => [row.order?.order_number, row.order?.route?.route_number, row.order?.route?.name, row.vendor?.name, row.vendor?.vendor_name, row.vendor?.vendor_code, row.operation_name, row.invoice_number, row.invoice_status].join(' ').toLowerCase().includes(search.toLowerCase())), [rows, search]);
  const totalPayable = rows.reduce((sum, row) => sum + Number(row.payable_amount || 0), 0);
  const totalOutstanding = rows.reduce((sum, row) => sum + Math.max(0, Number(row.payable_amount || 0) - Number(row.paid_amount || 0)), 0);

  async function recordInvoice() {
    if (!invoice) return;
    if (!invoice.number.trim() || !invoice.date) { await confirmDialog({ title: 'Invoice details required', message: 'Enter the supplier invoice number and date.', confirmLabel: 'OK', cancelLabel: 'Close', variant: 'warning' }); return; }
    setSaving(true);
    try {
      let attachmentUrl = '';
      if (invoice.file) {
        const form = new FormData();
        form.append('file', invoice.file); form.append('title', `Vendor invoice ${invoice.number.trim()}`);
        form.append('description', `Subcontracting vendor invoice for ${invoice.row.order?.order_number || 'service order'}`);
        form.append('document_type', 'VENDOR_INVOICE'); form.append('related_entity_type', 'SUBCONTRACT_ORDER'); form.append('related_entity_id', invoice.row.order_id);
        const uploaded: any = await apiClient.postForm('/documents/upload', form);
        attachmentUrl = uploaded?.file_url || uploaded?.url || uploaded?.data?.file_url || uploaded?.data?.url || '';
      }
      await apiClient.post(`/production/subcontracting/orders/${invoice.row.order_id}/steps/${invoice.row.id}/invoice`, { invoice_number: invoice.number.trim(), invoice_date: invoice.date, attachment_url: attachmentUrl || undefined });
      setInvoice(null); await load();
      await confirmDialog({ title: 'Supplier invoice recorded', message: 'The QC-approved subcontract payable is ready for payment.', confirmLabel: 'OK', cancelLabel: 'Close', variant: 'info' });
    } catch (err: any) { await confirmDialog({ title: 'Invoice not recorded', message: err?.message || 'Could not match this invoice.', confirmLabel: 'OK', cancelLabel: 'Close', variant: 'danger' }); }
    finally { setSaving(false); }
  }

  async function postPayment() {
    if (!payment) return;
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) { await confirmDialog({ title: 'Invalid payment amount', message: 'Enter an amount greater than zero.', confirmLabel: 'OK', cancelLabel: 'Close', variant: 'warning' }); return; }
    setSaving(true);
    try {
      await apiClient.post(`/production/subcontracting/orders/${payment.row.order_id}/steps/${payment.row.id}/pay`, { amount, payment_reference: payment.reference.trim() || undefined, payment_date: new Date().toISOString().slice(0, 10) });
      setPayment(null); await load();
      await confirmDialog({ title: 'Payment recorded', message: 'The subcontractor payment has been recorded against this service payable.', confirmLabel: 'OK', cancelLabel: 'Close', variant: 'info' });
    } catch (err: any) { await confirmDialog({ title: 'Payment not recorded', message: err?.message || 'Could not record the payment.', confirmLabel: 'OK', cancelLabel: 'Close', variant: 'danger' }); }
    finally { setSaving(false); }
  }

  return <main className="mx-auto max-w-[1600px] space-y-5 p-3 sm:p-5">
    <section className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-[#4b3928] p-6 text-white"><div><p className="text-xs font-bold uppercase tracking-wider text-[#f4d9a8]">Accounts payable control</p><h1 className="mt-1 text-2xl font-bold">Subcontract Payables</h1><p className="mt-1 text-sm text-[#f7e7ce]">Supplier invoices, QC-approved service charges, tax, deductions and payment settlement for outside processing.</p></div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded border border-[#e5c796] bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh</button></section>
    <section className="grid gap-3 sm:grid-cols-3"><Metric label="Service payables" value={`Rs. ${money(totalPayable)}`} /><Metric label="Outstanding" value={`Rs. ${money(totalOutstanding)}`} /><Metric label="Open operations" value={String(rows.filter((row) => Math.max(0, Number(row.payable_amount || 0) - Number(row.paid_amount || 0)) > 0.009).length)} /></section>
    <section className="border border-[#dfccb0] bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadcc8] p-4"><div><h2 className="font-bold text-[#3f2d20]">Subcontract service invoice register</h2><p className="text-sm text-[#7b6753]">Operational receipt is completed in Production; financial matching and payment are controlled here.</p></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, vendor, invoice..." className="w-full max-w-sm border border-[#d8c6aa] px-3 py-2 text-sm outline-none" /></div>
      {error && <p className="m-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="overflow-auto"><table className="min-w-[1160px] w-full text-sm"><thead className="bg-[#f8f2e8] text-left text-xs uppercase text-[#765a3b]"><tr><th className="px-4 py-3">Order / invoice</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Operation</th><th className="px-4 py-3 text-right">Processing</th><th className="px-4 py-3 text-right">Tax</th><th className="px-4 py-3 text-right">Deduction</th><th className="px-4 py-3 text-right">Payable</th><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={10} className="px-4 py-12 text-center text-[#7b6753]">Loading subcontract payables…</td></tr> : filtered.map((row) => { const outstanding = Math.max(0, Number(row.payable_amount || 0) - Number(row.paid_amount || 0)); const invoiceReady = ['INVOICE_RECEIVED', 'PENDING_PAYMENT'].includes(String(row.invoice_status || '').toUpperCase()); return <tr key={row.id} className="border-t border-[#eadcc8]"><td className="px-4 py-3"><b>{row.order?.order_number || '—'}</b><div className="text-xs text-[#7b6753]">{row.invoice_number || 'Invoice not captured'}{row.invoice_date ? ` · ${new Date(row.invoice_date).toLocaleDateString('en-IN')}` : ''}</div></td><td className="px-4 py-3">{row.vendor?.name || row.vendor?.vendor_name || row.vendor?.vendor_code || '—'}</td><td className="px-4 py-3">{row.operation_name || 'Subcontract processing'}</td><td className="px-4 py-3 text-right">Rs. {money(row.processing_amount)}</td><td className="px-4 py-3 text-right">Rs. {money(row.tax_amount)}</td><td className="px-4 py-3 text-right text-red-700">Rs. {money(row.deduction_amount)}</td><td className="px-4 py-3 text-right font-bold">Rs. {money(row.payable_amount)}</td><td className="px-4 py-3 text-right text-emerald-700">Rs. {money(row.paid_amount)}</td><td className="px-4 py-3"><span className="rounded-full border border-[#d8c6aa] bg-[#fff9ed] px-2 py-1 text-xs font-semibold text-[#765a3b]">{statusText(row.invoice_status)}</span></td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><button onClick={() => setInvoice({ row, number: row.invoice_number || '', date: String(row.invoice_date || new Date().toISOString().slice(0, 10)).slice(0, 10), file: null })} className="inline-flex items-center gap-1 rounded border border-[#cdb994] px-2 py-1 text-xs font-semibold text-[#5b432c]"><FileText className="h-3.5 w-3.5" /> Invoice</button><button disabled={!invoiceReady || outstanding <= 0.009} onClick={() => setPayment({ row, amount: outstanding.toFixed(2), reference: '' })} className="inline-flex items-center gap-1 rounded bg-[#79572f] px-2 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><CreditCard className="h-3.5 w-3.5" /> Pay</button></div></td></tr>; })}
        {!loading && filtered.length === 0 && <tr><td colSpan={10} className="px-4 py-12 text-center text-[#7b6753]">No QC-approved subcontract service payables found.</td></tr>}
      </tbody></table></div></section>
    {invoice && <Modal title="Record subcontract supplier invoice" onClose={() => !saving && setInvoice(null)}><label>Invoice number<input value={invoice.number} onChange={(event) => setInvoice({ ...invoice, number: event.target.value })} /></label><label>Invoice date<input type="date" value={invoice.date} onChange={(event) => setInvoice({ ...invoice, date: event.target.value })} /></label><label>Invoice attachment (optional)<input type="file" onChange={(event) => setInvoice({ ...invoice, file: event.target.files?.[0] || null })} /></label><Actions saving={saving} label="Record invoice" onCancel={() => setInvoice(null)} onSave={() => void recordInvoice()} /></Modal>}
    {payment && <Modal title="Record subcontractor payment" onClose={() => !saving && setPayment(null)}><label>Amount<input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></label><label>Payment reference<input value={payment.reference} onChange={(event) => setPayment({ ...payment, reference: event.target.value })} placeholder="Bank / voucher reference" /></label><Actions saving={saving} label="Record payment" onCancel={() => setPayment(null)} onSave={() => void postPayment()} /></Modal>}
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border border-[#dfccb0] bg-[#fffdf9] p-4"><div className="text-xs font-bold uppercase text-[#8a6d4a]">{label}</div><div className="mt-1 text-xl font-bold text-[#3f2d20]">{value}</div></div>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#eadcc8] p-5"><h2 className="font-bold text-[#3f2d20]">{title}</h2><button onClick={onClose}><X className="h-5 w-5" /></button></div><div className="space-y-4 p-5 [&_label]:block [&_label]:text-sm [&_label]:font-semibold [&_input]:mt-1 [&_input]:w-full [&_input]:border [&_input]:border-[#d8c6aa] [&_input]:px-3 [&_input]:py-2">{children}</div></div></div>; }
function Actions({ saving, label, onCancel, onSave }: { saving: boolean; label: string; onCancel: () => void; onSave: () => void }) { return <div className="flex justify-end gap-3 border-t border-[#eadcc8] pt-4"><button disabled={saving} onClick={onCancel} className="rounded border border-[#cdb994] px-4 py-2 font-semibold">Cancel</button><button disabled={saving} onClick={onSave} className="rounded bg-[#79572f] px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : label}</button></div>; }
