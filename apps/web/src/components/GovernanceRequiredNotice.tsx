'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ShieldCheck, X } from 'lucide-react';

type GovernanceDetail = { entity_type?: string; operation?: string; target_id?: string | null; proposed_data?: Record<string, unknown> };

export default function GovernanceRequiredNotice() {
  const router = useRouter();
  const [detail, setDetail] = useState<GovernanceDetail | null>(null);

  useEffect(() => {
    const receive = (event: Event) => setDetail((event as CustomEvent<GovernanceDetail>).detail || {});
    window.addEventListener('master-data-governance-required', receive);
    return () => window.removeEventListener('master-data-governance-required', receive);
  }, []);

  if (!detail) return null;
  const entity = String(detail.entity_type || 'master data').replaceAll('_', ' ').toLowerCase();
  return <div className="fixed bottom-5 right-5 z-[100] w-[min(30rem,calc(100vw-2.5rem))] rounded-xl border border-amber-300 bg-white p-4 shadow-2xl">
    <div className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-amber-600" size={22}/><div className="min-w-0 flex-1"><div className="font-semibold text-slate-800">Governed change required</div><p className="mt-1 text-sm text-slate-600">This {entity} change was not saved directly. Prepare it for independent review and approval instead.</p><div className="mt-3 flex gap-2"><button onClick={() => { try { sessionStorage.setItem('master-data-governance-prefill', JSON.stringify(detail)); } catch {} router.push('/dashboard/settings/master-data-governance'); }} className="inline-flex items-center gap-1 rounded-lg bg-[#344C67] px-3 py-2 text-sm font-semibold text-white">Prepare governed change <ArrowRight size={15}/></button><button onClick={() => setDetail(null)} className="rounded-lg border px-3 py-2 text-sm">Dismiss</button></div></div><button aria-label="Dismiss governance notice" onClick={() => setDetail(null)} className="h-fit text-slate-400"><X size={18}/></button></div>
  </div>;
}
