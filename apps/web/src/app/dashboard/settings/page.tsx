'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Users, Shield, Building2, Bell, Database, Mail, CheckCircle2, Clock, Link2, FileText } from 'lucide-react';
import UserManagement from './components/UserManagement';
import RoleManagement from './components/RoleManagement';
import CompanySettings from './components/CompanySettings';
import EmailSettings from './components/EmailSettings';
import LetterheadSettings from './components/LetterheadSettings';

type TabType = 'users' | 'roles' | 'company' | 'letterhead' | 'email' | 'notifications' | 'integrations';

function SettingsPageContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>('users');
  useEffect(() => {
    const requested = searchParams.get('tab') as TabType | null;
    if (requested && ['users', 'roles', 'company', 'letterhead', 'email', 'notifications', 'integrations'].includes(requested)) setActiveTab(requested);
  }, [searchParams]);

  const tabs = [
    { id: 'users' as TabType, label: 'Employee Access', icon: Users },
    { id: 'roles' as TabType, label: 'Roles & Permissions', icon: Shield },
    { id: 'company' as TabType, label: 'Company Settings', icon: Building2 },
    { id: 'letterhead' as TabType, label: 'Letterhead Templates', icon: FileText },
    { id: 'email' as TabType, label: 'Email Configuration', icon: Mail },
    { id: 'notifications' as TabType, label: 'Notifications', icon: Bell },
    { id: 'integrations' as TabType, label: 'Integrations', icon: Database },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold" style={{ color: '#6F4E37' }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8B6F47' }}>
          Manage your company settings, employee access, and permissions
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-[#FFFDF8] p-4" style={{ borderColor: '#E8DCC4' }}>
        <div>
          <p className="font-semibold" style={{ color: '#6F4E37' }}>Settings workspace</p>
          <p className="mt-1 text-xs" style={{ color: '#8B6F47' }}>Use the administration-area selector to switch between employee access, roles and company controls.</p>
        </div>
        <label className="min-w-[250px] text-xs font-semibold uppercase tracking-wide" style={{ color: '#6F4E37' }}>
          Administration area
          <select value={activeTab} onChange={(event) => setActiveTab(event.target.value as TabType)} className="mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal" style={{ borderColor: '#D8C8AA', color: '#6F4E37' }}>
            {tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </select>
        </label>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'roles' && <RoleManagement />}
        {activeTab === 'company' && <CompanySettings />}
        {activeTab === 'letterhead' && <LetterheadSettings />}
        {activeTab === 'email' && <EmailSettings />}
        {activeTab === 'notifications' && <NotificationSettingsPanel />}
        {activeTab === 'integrations' && <IntegrationSettingsPanel />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={<div className="p-6">Loading Settings workspace...</div>}><SettingsPageContent /></Suspense>;
}

function NotificationSettingsPanel() {
  const rows = [
    ['Approvals', 'PR, PO, vendor master, invoice sanction and payment approvals', 'Enabled'],
    ['Procurement Exceptions', 'Overdue RFQ, delayed PO, pending GRN and pending QC reminders', 'Enabled'],
    ['Inventory Alerts', 'Low stock, unverified item master, UID generation and adjustment exceptions', 'Enabled'],
    ['Accounts Alerts', 'Due invoices, advances available, payment reversal and short-pay review', 'Enabled'],
  ];

  return (
    <div className="max-w-5xl rounded-lg border bg-white" style={{ borderColor: '#E8DCC4' }}>
      <div className="border-b p-5" style={{ borderColor: '#E8DCC4' }}>
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6" style={{ color: '#8B6F47' }} />
          <div>
            <h2 className="text-xl font-semibold" style={{ color: '#6F4E37' }}>Notification Control</h2>
            <p className="text-sm" style={{ color: '#8B6F47' }}>Operational reminders used by dashboard action queues and approval worklists.</p>
          </div>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: '#E8DCC4' }}>
        {rows.map(([name, description, status]) => (
          <div key={name} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[220px_1fr_140px] md:items-center">
            <div className="font-semibold" style={{ color: '#6F4E37' }}>{name}</div>
            <div className="text-sm" style={{ color: '#7A6555' }}>{description}</div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium" style={{ borderColor: '#A7F3D0', color: '#047857', backgroundColor: '#ECFDF5' }}>
              <CheckCircle2 className="h-4 w-4" />
              {status}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegrationSettingsPanel() {
  const rows = [
    ['Email Delivery', 'Department sender addresses and RFQ/PO document emails', 'Configured in Email Configuration'],
    ['GST / PAN Verification', 'Local GSTIN checksum, PAN extraction, and supplier document checklist', 'Available'],
    ['IFSC Verification', 'Bank IFSC format and public bank directory verification', 'Available'],
    ['External Connectors', 'Live email, payment gateway, e-invoice and WhatsApp connectors', 'Planned'],
  ];

  return (
    <div className="max-w-5xl rounded-lg border bg-white" style={{ borderColor: '#E8DCC4' }}>
      <div className="border-b p-5" style={{ borderColor: '#E8DCC4' }}>
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6" style={{ color: '#8B6F47' }} />
          <div>
            <h2 className="text-xl font-semibold" style={{ color: '#6F4E37' }}>Integration Control</h2>
            <p className="text-sm" style={{ color: '#8B6F47' }}>Connection points used by procurement, vendor onboarding, documents, and payments.</p>
          </div>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: '#E8DCC4' }}>
        {rows.map(([name, description, status]) => (
          <div key={name} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[220px_1fr_240px] md:items-center">
            <div className="flex items-center gap-2 font-semibold" style={{ color: '#6F4E37' }}>
              <Link2 className="h-4 w-4" />
              {name}
            </div>
            <div className="text-sm" style={{ color: '#7A6555' }}>{description}</div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium" style={{ borderColor: status === 'Planned' ? '#FCD9A8' : '#A7F3D0', color: status === 'Planned' ? '#9A5A00' : '#047857', backgroundColor: status === 'Planned' ? '#FFF7ED' : '#ECFDF5' }}>
              {status === 'Planned' ? <Clock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {status}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
