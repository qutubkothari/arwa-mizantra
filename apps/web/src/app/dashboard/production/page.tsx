'use client';

import Link from 'next/link';
import { ArrowRight, BarChart3, ClipboardList, Factory, Layers3, PackageCheck, Settings2, ShieldCheck } from 'lucide-react';

const dailyWorkspaces = [
  { title: 'Create job order', detail: 'Start a production order from demand, BOM, and routing requirements.', href: '/dashboard/production/job-orders/smart-items', icon: ClipboardList },
  { title: 'Job order register', detail: 'Release, track, and close active production work.', href: '/dashboard/production/job-orders', icon: Factory },
  { title: 'Shop floor', detail: 'Run the day-to-day production execution workspace.', href: '/dashboard/shop-floor', icon: PackageCheck },
  { title: 'Subcontracting', detail: 'Manage outside processing, material issue, receipt, and QC.', href: '/dashboard/production/subcontracting', icon: ShieldCheck },
  { title: 'Production results', detail: 'Review planned versus actual output, time, loss, and cost.', href: '/dashboard/production/reports', icon: BarChart3 },
  { title: 'BOM & routing', detail: 'Define the material structure and production sequence.', href: '/dashboard/bom', icon: Layers3 },
  { title: 'Product production setup', detail: 'Maintain machines, processes, capacity, downtime, and tooling in one place.', href: '/dashboard/settings/production-setup', icon: Settings2 },
];

export default function ProductionPage() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <header className="rounded-xl border border-[#E8DCC4] bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Production workspace</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div><h1 className="text-2xl font-bold text-[#2F241B]">Production</h1><p className="mt-1 text-sm text-[#6F5A45]">Run the daily production cycle from planning to execution, receipt, and quality.</p></div>
            <Link href="/dashboard/production/job-orders/smart-items" className="inline-flex items-center gap-2 rounded-lg bg-[#4A3426] px-4 py-2 text-sm font-bold text-white hover:bg-[#5E4635]"><ClipboardList className="h-4 w-4" /> Create job order</Link>
          </div>
        </header>

        <section className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
          <div className="mb-4"><h2 className="font-bold text-[#4A3426]">Daily production</h2><p className="text-xs text-[#7A6555]">Use these workspaces for the normal manufacturing day.</p></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dailyWorkspaces.map((workspace) => {
              const Icon = workspace.icon;
              return <Link key={workspace.href} href={workspace.href} className="group rounded-lg border border-[#E8DCC4] bg-[#FFFCF5] p-4 transition hover:-translate-y-0.5 hover:border-[#B9975B] hover:bg-white hover:shadow-md"><span className="inline-flex rounded-lg bg-[#4A3426] p-2 text-white"><Icon className="h-5 w-5" /></span><h3 className="mt-3 font-bold text-[#2F241B]">{workspace.title}</h3><p className="mt-1 min-h-10 text-sm text-[#7A6555]">{workspace.detail}</p><span className="mt-3 inline-flex items-center text-sm font-bold text-[#8B6F47]">Open workspace <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" /></span></Link>;
            })}
          </div>
        </section>

        <section className="rounded-xl border border-[#E8DCC4] bg-[#F5EFE3] px-4 py-3 text-sm text-[#5E4635]"><b>Simple workflow:</b> set up the product once, create a job order, run it on the shop floor, and review the result.</section>
      </div>
    </main>
  );
}
