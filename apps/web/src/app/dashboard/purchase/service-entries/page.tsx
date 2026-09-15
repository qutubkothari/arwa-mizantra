'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, FileCheck2, FileText, Plus, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { getTodayDateInputValue } from '@/lib/date';
import DateInput from '../../../../components/ui/DateInput';
import SearchableSelect from '../../../../components/SearchableSelect';
import { ErpButton, ErpPageHeader, ErpStatusBadge } from '../../../../components/ui/ErpPrimitives';

type ServiceLine = {
  id: string;
  item_code: string;
  item_name: string;
  uom?: string;
  ordered_qty: number;
  service_accepted_qty?: number;
  service_remaining_qty?: number;
  rate?: number;
  tax_percent?: number;
};

type ServicePo = {
  id: string;
  po_number: string;
  vendor?: { name?: string };
  delivery_address?: string;
  service_lines: ServiceLine[];
};

type ServiceEntry = {
  id: string;
  ses_number: string;
  status: string;
  completion_date: string;
  service_period_start?: string;
  service_period_end?: string;
  completion_notes?: string;
  rejection_reason?: string;
  vendor?: { name?: string };
  po?: { id?: string; po_number?: string; status?: string };
  items?: Array<{ item_code: string; item_name: string; accepted_qty: number; uom?: string; amount?: number }>;
};

const money = (value: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0));

function ServiceEntriesContent() {
  const [entries, setEntries] = useState<ServiceEntry[]>([]);
  const [servicePos, setServicePos] = useState<ServicePo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [periodStart, setPeriodStart] = useState(getTodayDateInputValue());
  const [periodEnd, setPeriodEnd] = useState(getTodayDateInputValue());
  const [completionDate, setCompletionDate] = useState(getTodayDateInputValue());
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [rejectTarget, setRejectTarget] = useState<ServiceEntry | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const selectedPo = useMemo(() => servicePos.find((po) => po.id === selectedPoId) || null, [servicePos, selectedPoId]);
  const openServicePoNumbers = useMemo(() => new Set(servicePos.map((po) => po.po_number)), [servicePos]);
  const fullyAcceptedServiceEntries = useMemo(() => {
    return entries
      .filter((entry) => String(entry.status || '').toUpperCase() === 'APPROVED')
      .filter((entry) => entry.po?.po_number && !openServicePoNumbers.has(entry.po.po_number))
      .slice(0, 6);
  }, [entries, openServicePoNumbers]);

  const load = async () => {
    setLoading(true);
    try {
      const [nextEntries, nextPos] = await Promise.all([
        apiClient.get<ServiceEntry[]>('/purchase/service-entries'),
        apiClient.get<ServicePo[]>('/purchase/service-entries/eligible-pos'),
      ]);
      setEntries(Array.isArray(nextEntries) ? nextEntries : []);
      setServicePos(Array.isArray(nextPos) ? nextPos : []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load Service Entry Sheets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openCreate = () => {
    setSelectedPoId(''); setQuantities({}); setLocation(''); setNotes(''); setEvidenceText(''); setError('');
    const today = getTodayDateInputValue(); setPeriodStart(today); setPeriodEnd(today); setCompletionDate(today); setShowCreate(true);
  };

  const setPo = (poId: string) => {
    setSelectedPoId(poId);
    const po = servicePos.find((entry) => entry.id === poId);
    setLocation(po?.delivery_address || '');
    setQuantities(Object.fromEntries((po?.service_lines || []).map((line) => [line.id, String(line.service_remaining_qty ?? '')])));
  };

  const createAndSubmit = async () => {
    if (!selectedPo) { setError('Select an approved or partial Service PO with remaining service quantity.'); return; }
    if (!notes.trim()) { setError('Completion/sign-off notes are required.'); return; }
    if (periodEnd < periodStart) { setError('Service period end cannot be before the start date.'); return; }
    const items = selectedPo.service_lines.map((line) => ({
      poItemId: line.id,
      acceptedQty: Number(quantities[line.id] || 0),
      completionNote: notes.trim(),
    })).filter((line) => Number.isFinite(line.acceptedQty) && line.acceptedQty > 0);
    if (!items.length) { setError('Enter the completed quantity for at least one service line.'); return; }
    setSaving(true); setError('');
    try {
      const evidence = evidenceText.split(/\n|,/).map((value) => value.trim()).filter(Boolean).map((value) => ({ name: value, url: value }));
      const created = await apiClient.post<ServiceEntry>('/purchase/service-entries', {
        poId: selectedPo.id, items, servicePeriodStart: periodStart, servicePeriodEnd: periodEnd,
        completionDate, serviceLocation: location, completionNotes: notes, evidence,
      });
      await apiClient.post(`/purchase/service-entries/${created.id}/submit`, {});
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to submit the Service Entry Sheet.');
    } finally { setSaving(false); }
  };

  const approve = async (entry: ServiceEntry) => {
    try { await apiClient.post(`/purchase/service-entries/${entry.id}/approve`, {}); await load(); }
    catch (err: any) { setError(err?.message || 'Unable to accept the Service Entry Sheet.'); }
  };

  const reject = async (entry: ServiceEntry) => {
    setRejectTarget(entry);
    setRejectReason('');
    setError('');
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) { setError('Rejection reason is required.'); return; }
    setSaving(true);
    try {
      await apiClient.post(`/purchase/service-entries/${rejectTarget.id}/reject`, { reason });
      setRejectTarget(null);
      setRejectReason('');
      await load();
    }
    catch (err: any) { setError(err?.message || 'Unable to reject the Service Entry Sheet.'); }
    finally { setSaving(false); }
  };

  return (
    <main className="space-y-5 p-5">
      <ErpPageHeader
        eyebrow="PROCUREMENT · SERVICE ACCEPTANCE"
        title="Service Entry Sheets"
        description="Record completed services against an approved Service PO. No stock or GRN is created. An accepted entry is the Accounts Payable gate."
        actions={<><ErpButton variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</ErpButton><ErpButton variant="primary" onClick={openCreate}><Plus className="h-4 w-4" /> Record Service Entry</ErpButton></>}
      />

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="overflow-hidden rounded-xl border border-[#E8DCC4] bg-white">
        <div className="border-b border-[#E8DCC4] bg-[#FFFCF7] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Industry-standard service purchase control</div>
          <h2 className="mt-1 text-lg font-bold text-[#3D2B1F]">Service PO → Service Entry Sheet → Acceptance → Accounts Payable</h2>
          <p className="mt-1 text-sm text-[#5E4635]">
            Service purchases do not create stock and should not go through GRN. The Service Entry Sheet is the digital sign-off that confirms work completion before supplier invoice/payment.
          </p>
        </div>
        <div className="grid divide-y divide-[#EFE6D7] md:grid-cols-4 md:divide-x md:divide-y-0">
          {[
            ['1', 'Approved Service PO', 'Only service-category PO lines are eligible here. Material lines continue through GRN.', FileText],
            ['2', 'Record completion', 'Requester records completed quantity, period, location and sign-off notes.', ClipboardCheck],
            ['3', 'Attach evidence', 'Use report, certificate, timesheet, email approval or document link when applicable.', FileCheck2],
            ['4', 'Manager acceptance', 'Authorized approver accepts/rejects. Accepted SES becomes the Accounts Payable gate.', ShieldCheck],
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

      <section className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4 text-sm text-[#7A4E0E]">
        <strong className="text-[#B54708]">Control:</strong> the requester records work completed; an authorized manager accepts it. The SES is the digital sign-off. Add a report, certificate, timesheet, or document link where evidence is needed.
      </section>

      <section className="overflow-hidden rounded-xl border border-[#E8DCC4] bg-white">
        <div className="border-b border-[#E8DCC4] px-5 py-4"><h2 className="font-semibold text-[#3D2B1F]">Service acceptance register</h2></div>
        {loading ? <div className="p-8 text-center text-sm text-[#7A6555]">Loading Service Entry Sheets…</div> : entries.length === 0 ? <div className="p-8 text-center text-sm text-[#7A6555]">No Service Entry Sheets recorded yet.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-[#F5EFE3] text-left text-xs uppercase tracking-wide text-[#5E4635]"><tr><th className="px-4 py-3">SES</th><th className="px-4 py-3">PO / Supplier</th><th className="px-4 py-3">Service period</th><th className="px-4 py-3">Completed services</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>
            {entries.map((entry) => <tr key={entry.id} className="border-t border-[#F0E8DA] align-top"><td className="px-4 py-3 font-semibold text-[#4A3426]">{entry.ses_number}<div className="mt-1 text-xs font-normal text-[#7A6555]">Completed {entry.completion_date}</div></td><td className="px-4 py-3"><div>{entry.po?.po_number || '-'}</div><div className="text-xs text-[#7A6555]">{entry.vendor?.name || '-'}</div></td><td className="px-4 py-3 text-[#5E4635]">{entry.service_period_start || '-'} to {entry.service_period_end || '-'}</td><td className="px-4 py-3">{(entry.items || []).map((item) => <div key={`${entry.id}-${item.item_code}`}>{item.item_code}: {item.accepted_qty} {item.uom || ''} <span className="text-xs text-[#7A6555]">({money(item.amount)})</span></div>)}</td><td className="px-4 py-3"><ErpStatusBadge status={entry.status} /></td><td className="px-4 py-3 text-right">{entry.status === 'PENDING_APPROVAL' ? <div className="inline-flex gap-2"><ErpButton size="sm" variant="approve" onClick={() => void approve(entry)}><Check className="h-4 w-4" /> Accept</ErpButton><ErpButton size="sm" variant="danger" onClick={() => void reject(entry)}><X className="h-4 w-4" /> Reject</ErpButton></div> : entry.rejection_reason ? <span className="text-xs text-red-700">{entry.rejection_reason}</span> : '-'}</td></tr>)}
          </tbody></table></div>
        )}
      </section>

      {showCreate ? <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#3B2A1F]/55 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#D8C8AA] bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-[#E8DCC4] bg-[#FAF7F1] px-5 py-4"><div><h2 className="text-lg font-semibold text-[#3D2B1F]">Record Service Entry</h2><p className="mt-1 text-xs text-[#7A6555]">Service completion is accepted through this sheet—not through a GRN.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded p-1 text-[#7A6555] hover:bg-[#EFE7DA]"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-5">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Approved Service PO *</label>
          <SearchableSelect value={selectedPoId} onChange={setPo} options={servicePos.map((po) => ({ value: po.id, label: `${po.po_number} — ${po.vendor?.name || 'Supplier'}`, subtitle: `${po.service_lines.length} service line(s) pending acceptance` }))} placeholder="Search approved Service PO" />
          <p className="mt-1 text-xs text-[#7A6555]">
            Only service POs with remaining/unaccepted service quantity are selectable here.
          </p>
          {fullyAcceptedServiceEntries.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[#D8C8AA] bg-[#FAF7F1] p-3 text-xs text-[#5E4635]">
              <div className="font-semibold uppercase tracking-wide text-[#8B6F47]">Already accepted / not selectable again</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {fullyAcceptedServiceEntries.map((entry) => (
                  <span key={entry.id} className="rounded-full border border-[#CDBA99] bg-white px-3 py-1">
                    {entry.po?.po_number} · {entry.vendor?.name || 'Supplier'} · {entry.ses_number}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Service period start</label><DateInput value={periodStart} onChange={setPeriodStart} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm" /></div><div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Service period end</label><DateInput min={periodStart} value={periodEnd} onChange={setPeriodEnd} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm" /></div><div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Completion date *</label><DateInput value={completionDate} onChange={setCompletionDate} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm" /></div></div>
        {selectedPo ? <div className="overflow-hidden rounded-lg border border-[#E8DCC4]"><table className="w-full text-sm"><thead className="bg-[#F5EFE3] text-left text-xs uppercase text-[#5E4635]"><tr><th className="px-3 py-2">Service</th><th className="px-3 py-2">PO quantity</th><th className="px-3 py-2">Previously accepted</th><th className="px-3 py-2">Completed now *</th></tr></thead><tbody>{selectedPo.service_lines.map((line) => <tr key={line.id} className="border-t border-[#F0E8DA]"><td className="px-3 py-3 font-medium text-[#4A3426]">{line.item_code}<div className="text-xs font-normal text-[#7A6555]">{line.item_name}</div></td><td className="px-3 py-3">{line.ordered_qty} {line.uom || ''}</td><td className="px-3 py-3">{line.service_accepted_qty || 0}</td><td className="px-3 py-3"><input type="number" min="0" step="0.001" value={quantities[line.id] || ''} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} className="w-36 rounded-lg border border-[#D8C8AA] px-3 py-2" /></td></tr>)}</tbody></table></div> : null}
        <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Service location</label><input value={location} onChange={(event) => setLocation(event.target.value)} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm" placeholder="Site, project or department" /></div>
        <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Completion / sign-off notes *</label><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm" placeholder="What was completed, quality/result, and any exceptions" /></div>
        <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Supporting document reference</label><textarea rows={2} value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm" placeholder="Optional: completion certificate, report, timesheet or document link" /></div>
      </div><div className="flex justify-end gap-2 border-t border-[#E8DCC4] bg-[#FAF9F6] px-5 py-4"><ErpButton variant="secondary" onClick={() => setShowCreate(false)}>Cancel</ErpButton><ErpButton variant="approve" disabled={saving} onClick={() => void createAndSubmit()}><Send className="h-4 w-4" /> {saving ? 'Submitting…' : 'Submit for Acceptance'}</ErpButton></div></div></div> : null}
      {rejectTarget ? (
        <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-[#3B2A1F]/55 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[#D8C8AA] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E8DCC4] bg-[#FAF7F1] px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">Service acceptance</p>
                <h2 className="mt-1 text-lg font-semibold text-[#3D2B1F]">Reject {rejectTarget.ses_number}</h2>
                <p className="mt-1 text-xs text-[#7A6555]">Enter the reason so the requester and accounts team can see the audit trail.</p>
              </div>
              <button
                type="button"
                onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                className="rounded p-1 text-[#7A6555] hover:bg-[#EFE7DA]"
                aria-label="Close rejection dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#5E4635]" htmlFor="ses-reject-reason">
                Rejection reason *
              </label>
              <textarea
                id="ses-reject-reason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={4}
                autoFocus
                className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#E8DCC4]"
                placeholder="Example: work incomplete, missing sign-off document, quantity mismatch..."
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E8DCC4] bg-[#FAF9F6] px-5 py-4">
              <ErpButton variant="secondary" onClick={() => { setRejectTarget(null); setRejectReason(''); }} disabled={saving}>
                Cancel
              </ErpButton>
              <ErpButton variant="danger" onClick={() => void submitReject()} disabled={saving || !rejectReason.trim()}>
                <X className="h-4 w-4" />
                Reject SES
              </ErpButton>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function ServiceEntriesPage() { return <ServiceEntriesContent />; }
