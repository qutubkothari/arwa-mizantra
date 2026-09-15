'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, CreditCard, Plus, RefreshCw, X } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { getTodayDateInputValue } from '@/lib/date';
import DateInput from '../../../../components/ui/DateInput';
import SearchableSelect from '../../../../components/SearchableSelect';
import { ErpButton, ErpStatusBadge } from '../../../../components/ui/ErpPrimitives';

type Ses = {
  id: string;
  ses_number: string;
  completion_date: string;
  vendor?: { name?: string };
  po?: { po_number?: string };
  accepted_amount: number;
};

type Payment = {
  id: string;
  amount: number;
  payment_reference?: string;
  payment_date?: string;
  notes?: string;
  reversed_at?: string;
  reversal_reason?: string;
};

type Invoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_amount: number;
  paid_amount: number;
  status: string;
  notes?: string;
  payments?: Payment[];
  ses?: { ses_number?: string; vendor?: { name?: string }; po?: { po_number?: string } };
};

const money = (amount: unknown) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount || 0));

export default function ServiceInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [eligible, setEligible] = useState<Ses[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [sesId, setSesId] = useState('');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(getTodayDateInputValue());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = useMemo(() => eligible.find((entry) => entry.id === sesId), [eligible, sesId]);

  const load = async () => {
    setLoading(true);
    try {
      const [records, entries] = await Promise.all([
        apiClient.get<Invoice[]>('/purchase/service-entries/invoices/list'),
        apiClient.get<Ses[]>('/purchase/service-entries/invoices/eligible-ses'),
      ]);
      setInvoices(Array.isArray(records) ? records : []);
      setEligible(Array.isArray(entries) ? entries : []);
    } catch (e: any) {
      setError(e?.message || 'Unable to load service invoices.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (window.location.pathname.endsWith('/accounts/service-invoices')) {
      window.location.replace('/dashboard/accounts/supplier-invoices?type=service');
      return;
    }
    void load();
  }, []);

  const openAdd = () => {
    setSesId('');
    setNumber('');
    setDate(getTodayDateInputValue());
    setAmount('');
    setNotes('');
    setError('');
    setShowAdd(true);
  };

  const save = async () => {
    if (!sesId || !number.trim() || Number(amount) <= 0) {
      setError('SES, invoice number and amount are required.');
      return;
    }
    setBusy(true);
    try {
      await apiClient.post('/purchase/service-entries/invoices', {
        serviceEntrySheetId: sesId,
        invoiceNumber: number,
        invoiceDate: date,
        invoiceAmount: Number(amount),
        notes,
      });
      setShowAdd(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Unable to record service invoice.');
    } finally {
      setBusy(false);
    }
  };

  const sanction = async (invoice: Invoice) => {
    try {
      await apiClient.post(`/purchase/service-entries/invoices/${invoice.id}/sanction`, {});
      await load();
    } catch (e: any) {
      setError(e?.message || 'Unable to sanction invoice.');
    }
  };

  const pay = async (invoice: Invoice) => {
    const remaining = Number(invoice.invoice_amount) - Number(invoice.paid_amount);
    const value = window.prompt(`Record payment for ${invoice.invoice_number}. Remaining: ${money(remaining)}`, remaining.toFixed(2));
    if (!value) return;
    const reference = window.prompt('Payment reference (NEFT / cheque / transaction ID)') || '';
    const paymentNotes = window.prompt('Accounts intimation note / payment remarks (optional)', '') || '';
    try {
      await apiClient.post(`/purchase/service-entries/invoices/${invoice.id}/pay`, {
        amount: Number(value),
        reference,
        notes: paymentNotes.trim() || undefined,
      });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Unable to record payment.');
    }
  };

  const reverse = async (invoice: Invoice, payment: Payment) => {
    const reason = window.prompt(`Reverse ${money(payment.amount)} payment${payment.payment_reference ? ` (${payment.payment_reference})` : ''}: enter reason`);
    if (!reason?.trim()) return;
    try {
      await apiClient.post(`/purchase/service-entries/invoices/${invoice.id}/payments/${payment.id}/reverse`, { reason });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Unable to reverse payment.');
    }
  };

  return (
    <main className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E8DCC4] bg-white p-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Service procurement</div>
            <h2 className="mt-1 text-xl font-bold text-[#3F2D20]">Service invoice register</h2>
            <p className="mt-1 text-sm text-[#6F4E37]">Record supplier invoices only against accepted Service Entry Sheets.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ErpButton variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh</ErpButton>
            <ErpButton variant="primary" onClick={openAdd}><Plus className="h-4 w-4" />Record service invoice</ErpButton>
          </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-[#E8DCC4] bg-[#FFFCF7] p-4 text-sm text-[#5E4635]">
        <strong className="text-[#3D2B1F]">Three-way service control:</strong> approved PO → accepted Service Entry Sheet → sanctioned supplier invoice.
        Payment notes are stored in the service payment trail for accounts follow-up.
      </section>

      <section className="overflow-hidden rounded-xl border border-[#E8DCC4] bg-white">
        <div className="border-b border-[#E8DCC4] px-5 py-4">
          <h2 className="font-semibold text-[#3D2B1F]">Service invoice register</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#7A6555]">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#7A6555]">No service invoices recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-[#F5EFE3] text-left text-xs uppercase text-[#5E4635]">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">SES / PO</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Amount & payment trail</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-[#F0E8DA]">
                    <td className="px-4 py-3 font-medium">
                      {invoice.invoice_number}
                      <div className="text-xs font-normal text-[#7A6555]">{invoice.invoice_date}</div>
                    </td>
                    <td className="px-4 py-3">
                      {invoice.ses?.ses_number}
                      <div className="text-xs text-[#7A6555]">{invoice.ses?.po?.po_number}</div>
                    </td>
                    <td className="px-4 py-3">{invoice.ses?.vendor?.name || '-'}</td>
                    <td className="px-4 py-3">
                      {money(invoice.invoice_amount)}
                      <div className="text-xs text-[#7A6555]">Paid {money(invoice.paid_amount)}</div>
                      {(invoice.payments || []).map((payment) => (
                        <div key={payment.id} className={`mt-1 text-xs ${payment.reversed_at ? 'text-red-600 line-through' : 'text-[#5E4635]'}`}>
                          {payment.payment_date || 'Payment'} · {money(payment.amount)}
                          {payment.payment_reference ? ` · ${payment.payment_reference}` : ''}
                          {payment.notes ? <div className="mt-0.5 text-[#7A6555]">Note: {payment.notes}</div> : null}
                          {!payment.reversed_at ? (
                            <button className="ml-2 text-red-700 underline" onClick={() => void reverse(invoice, payment)}>
                              Reverse
                            </button>
                          ) : (
                            <span className="no-underline"> · reversed: {payment.reversal_reason}</span>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3">
                      <ErpStatusBadge status={invoice.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {invoice.status === 'PENDING_APPROVAL' ? (
                        <ErpButton size="sm" variant="approve" onClick={() => void sanction(invoice)}>
                          <Check className="h-4 w-4" />
                          Sanction
                        </ErpButton>
                      ) : ['SANCTIONED', 'PARTIALLY_PAID'].includes(invoice.status) ? (
                        <ErpButton size="sm" variant="primary" onClick={() => void pay(invoice)}>
                          <CreditCard className="h-4 w-4" />
                          Pay
                        </ErpButton>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showAdd && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#3B2A1F]/55 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex justify-between border-b border-[#E8DCC4] p-5">
              <div>
                <h2 className="font-semibold text-[#3D2B1F]">Record service supplier invoice</h2>
                <p className="mt-1 text-xs text-[#7A6555]">Only accepted SES records are available.</p>
              </div>
              <button onClick={() => setShowAdd(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase">Accepted Service Entry Sheet *</label>
                <SearchableSelect
                  value={sesId}
                  onChange={(id) => {
                    setSesId(id);
                    const next = eligible.find((entry) => entry.id === id);
                    setAmount(next ? String(next.accepted_amount) : '');
                  }}
                  options={eligible.map((entry) => ({
                    value: entry.id,
                    label: `${entry.ses_number} — ${entry.vendor?.name || 'Supplier'}`,
                    subtitle: `${entry.po?.po_number || '-'} · accepted ${money(entry.accepted_amount)}`,
                  }))}
                  placeholder="Search accepted Service Entry Sheet"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase">Invoice number *</label>
                  <input value={number} onChange={(event) => setNumber(event.target.value)} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase">Invoice date *</label>
                  <DateInput value={date} onChange={setDate} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase">Invoice amount *</label>
                <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2" />
                {chosen && <p className="mt-1 text-xs text-[#7A6555]">Accepted SES value: {money(chosen.accepted_amount)}</p>}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase">Notes</label>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E8DCC4] p-4">
              <ErpButton variant="secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </ErpButton>
              <ErpButton variant="primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving...' : 'Record for sanction'}
              </ErpButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
