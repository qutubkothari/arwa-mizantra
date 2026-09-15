'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '../../../../../lib/api-client';

export default function ServiceTrackingPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const load = async () => {
    try { setData(await apiClient.get(`/service-portal/${params.token}`)); setError(''); }
    catch (err: any) { setError(err.message || 'Service tracking details could not be loaded'); }
  };
  useEffect(() => { load(); }, [params.token]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSending(true);
    try { await apiClient.post(`/service-portal/${params.token}/updates`, { customer_name: name, message, update_type: 'COMMENT' }); setMessage(''); await load(); }
    catch (err: any) { setError(err.message || 'Your update could not be submitted'); }
    finally { setSending(false); }
  };
  if (error && !data) return <main className="mx-auto max-w-3xl p-8"><div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div></main>;
  if (!data) return <main className="p-8 text-center">Loading service status...</main>;
  const ticket = data.ticket;
  return <main className="min-h-screen bg-[#F7F2E8] p-4 text-[#3F2D20] sm:p-8"><div className="mx-auto max-w-4xl space-y-5">
    <header className="rounded-xl border border-[#D9C9AD] bg-white p-6"><div className="text-xs font-bold uppercase text-[#8B6F47]">Customer Service Portal</div><h1 className="mt-1 text-2xl font-bold">{ticket.ticket_number}</h1><p className="mt-2 text-sm text-[#7A6756]">{ticket.customer?.customer_name} · {ticket.product_name || ticket.uid || 'Service request'}</p></header>
    <section className="grid gap-3 sm:grid-cols-4">{[['Status', ticket.status], ['Priority', ticket.priority], ['Opened', ticket.complaint_date ? new Date(ticket.complaint_date).toLocaleDateString('en-IN') : '-'], ['Expected completion', ticket.expected_completion_date || '-']].map(([label, value]) => <div key={label} className="rounded-lg border border-[#D9C9AD] bg-white p-4"><div className="text-xs font-bold uppercase text-[#8B6F47]">{label}</div><div className="mt-1 font-semibold">{String(value || '-').replaceAll('_', ' ')}</div></div>)}</section>
    <section className="rounded-xl border border-[#D9C9AD] bg-white p-5"><h2 className="font-bold">Service progress</h2><div className="mt-4 space-y-3">{(data.assignments || []).map((row: any, index: number) => <div key={index} className="rounded border p-3"><div className="font-semibold">Assigned to {row.technician?.technician_name || 'service team'}</div><div className="text-sm text-[#7A6756]">{String(row.status || '').replaceAll('_', ' ')} · {row.scheduled_start_at ? new Date(row.scheduled_start_at).toLocaleString('en-IN') : 'Schedule pending'}</div></div>)}{(data.visits || []).map((row: any, index: number) => <div key={`visit-${index}`} className="rounded border p-3"><div className="font-semibold">Site visit · {String(row.status).replaceAll('_', ' ')}</div><div className="text-sm text-[#7A6756]">{row.checked_in_at ? new Date(row.checked_in_at).toLocaleString('en-IN') : '-'}{row.checked_out_at ? ` to ${new Date(row.checked_out_at).toLocaleString('en-IN')}` : ''}</div>{row.work_summary && <div className="mt-1 text-sm">{row.work_summary}</div>}</div>)}</div></section>
    <section className="rounded-xl border border-[#D9C9AD] bg-white p-5"><h2 className="font-bold">Send an update or query</h2><form onSubmit={submit} className="mt-4 space-y-3"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded border px-3 py-2" /><textarea required value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Add your comment, question or site instruction" className="w-full rounded border px-3 py-2" /><button disabled={sending} className="rounded bg-[#6F4E37] px-5 py-2 font-semibold text-white disabled:opacity-50">{sending ? 'Sending...' : 'Send update'}</button></form>{(data.customer_updates || []).length > 0 && <div className="mt-5 space-y-2 border-t pt-4">{data.customer_updates.map((row: any, index: number) => <div key={index} className="rounded bg-[#FFFDF7] p-3"><div className="text-xs font-bold uppercase text-[#8B6F47]">{row.update_type} · {new Date(row.created_at).toLocaleString('en-IN')}</div><div className="mt-1 text-sm">{row.message}</div></div>)}</div>}</section>
  </div></main>;
}
