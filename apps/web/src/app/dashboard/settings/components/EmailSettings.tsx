'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Building2,
  CheckCircle2,
  CreditCard,
  Factory,
  FileText,
  Headphones,
  Mail,
  RefreshCw,
  Save,
  Send,
  Settings,
  Shield,
  ShoppingCart,
  ToggleLeft,
  ToggleRight,
  Users,
} from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';

interface EmailConfig {
  id?: number;
  email_type: string;
  email_address: string;
  display_name?: string;
  description?: string;
  is_active?: boolean;
}

type SenderDefinition = {
  type: string;
  title: string;
  module: string;
  purpose: string;
  examples: string;
  icon: React.ComponentType<{ className?: string }>;
};

const senderDefinitions: SenderDefinition[] = [
  {
    type: 'sales',
    title: 'Sales Sender',
    module: 'Sales',
    purpose: 'Quotations, sales orders, customer dispatch documents and commercial follow-up.',
    examples: 'Quotes, sales confirmations, customer reminders',
    icon: Send,
  },
  {
    type: 'purchase',
    title: 'Purchase Sender',
    module: 'Procurement',
    purpose: 'RFQs, purchase orders, vendor communication and procurement follow-up.',
    examples: 'RFQ, PO PDF, vendor clarification, delivery follow-up',
    icon: ShoppingCart,
  },
  {
    type: 'production',
    title: 'Production Sender',
    module: 'Production',
    purpose: 'Job orders, subcontracting, shop-floor coordination and outside processing alerts.',
    examples: 'Job order, subcontracting issue, operation update',
    icon: Factory,
  },
  {
    type: 'accounts',
    title: 'Accounts Sender',
    module: 'Accounts',
    purpose: 'Supplier invoices, payment advice, advances, debit notes and account statements.',
    examples: 'Payment advice, supplier statement, debit note',
    icon: CreditCard,
  },
  {
    type: 'reminders',
    title: 'Reminder Sender',
    module: 'Automation',
    purpose: 'Automated due-date reminders, pending approvals and exception escalations.',
    examples: 'Pending approval, overdue GRN, due invoice reminder',
    icon: Bell,
  },
  {
    type: 'quality',
    title: 'Quality Sender',
    module: 'Quality',
    purpose: 'QC inspection, rejected material, deviation notes and quality communication.',
    examples: 'QC hold, rejection note, inspection report',
    icon: Shield,
  },
  {
    type: 'documents',
    title: 'Document Sender',
    module: 'Documents',
    purpose: 'Document dispatch, controlled PDFs, drawings and letterhead-based communication.',
    examples: 'PDF dispatch, drawing issue, document acknowledgement',
    icon: FileText,
  },
  {
    type: 'support',
    title: 'Support Sender',
    module: 'Service',
    purpose: 'Customer support requests, service tickets and service communication.',
    examples: 'Ticket updates, service acknowledgement',
    icon: Headphones,
  },
  {
    type: 'technical',
    title: 'Technical Sender',
    module: 'Engineering',
    purpose: 'Engineering questions, product specifications and technical clarification.',
    examples: 'Drawing clarification, product spec reply',
    icon: Settings,
  },
  {
    type: 'hr',
    title: 'HR Sender',
    module: 'HR',
    purpose: 'Employee notifications, payroll, attendance, leave and HR communication.',
    examples: 'Leave approval, payroll note, employee document',
    icon: Users,
  },
  {
    type: 'admin',
    title: 'Admin Sender',
    module: 'System',
    purpose: 'System notifications, critical alerts, user access and administrative messages.',
    examples: 'Access alerts, system health, security message',
    icon: Building2,
  },
  {
    type: 'noreply',
    title: 'No Reply Sender',
    module: 'System',
    purpose: 'Automated notifications where users should not reply.',
    examples: 'OTP-style alerts, automated status updates',
    icon: Mail,
  },
];

const fieldClass =
  'h-11 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4] disabled:bg-[#F8F3EA] disabled:text-[#8B6F47]';

function normalizeConfig(configs: EmailConfig[]): EmailConfig[] {
  const byType = new Map(configs.map((config) => [config.email_type, config]));
  return senderDefinitions.map((definition) => ({
    email_type: definition.type,
    email_address: '',
    display_name: definition.title.replace(' Sender', ''),
    description: definition.purpose,
    is_active: true,
    ...byType.get(definition.type),
  }));
}

export default function EmailSettings() {
  const canEditSettings = hasModulePermission(readStoredUser(), 'Settings', 'edit');
  const [emailConfigs, setEmailConfigs] = useState<EmailConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchEmailConfig();
  }, []);

  const activeCount = useMemo(
    () => emailConfigs.filter((config) => config.is_active !== false).length,
    [emailConfigs],
  );

  const uniqueEmailCount = useMemo(() => {
    const unique = new Set(
      emailConfigs
        .map((config) => config.email_address.trim().toLowerCase())
        .filter(Boolean),
    );
    return unique.size;
  }, [emailConfigs]);

  const fetchEmailConfig = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<EmailConfig[]>('/emails/config');
      setEmailConfigs(normalizeConfig(data));
      setMessage('');
    } catch {
      setMessage('Failed to load email configuration');
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (emailType: string, patch: Partial<EmailConfig>) => {
    setEmailConfigs((current) =>
      current.map((config) =>
        config.email_type === emailType ? { ...config, ...patch } : config,
      ),
    );
  };

  const handleFillEmptyFromDefault = () => {
    const fallback =
      emailConfigs.find((config) => config.email_type === 'noreply')?.email_address ||
      emailConfigs.find((config) => config.email_address.trim())?.email_address ||
      '';

    if (!fallback) {
      setMessage('Enter at least one email address before copying to empty rows.');
      return;
    }

    setEmailConfigs((current) =>
      current.map((config) => ({
        ...config,
        email_address: config.email_address.trim() ? config.email_address : fallback,
      })),
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEditSettings) {
      setMessage('You do not have permission to update email configuration');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const payload = emailConfigs.map((config) => ({
        email_type: config.email_type,
        email_address: config.email_address.trim(),
        display_name: config.display_name?.trim(),
        description: config.description?.trim(),
        is_active: config.is_active !== false,
      }));

      await apiClient.put('/emails/config', payload);
      setMessage('Email configuration saved successfully.');
      setTimeout(() => setMessage(''), 3000);
    } catch (error: any) {
      setMessage(error.message || 'Failed to save email configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center" style={{ color: '#8B6F47' }}>
        <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin" />
        Loading email configuration...
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-96px)] bg-[#F8F3EA] p-5">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-end md:justify-between" style={{ borderColor: '#E8DCC4' }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#8B6F47' }}>Settings</p>
            <h1 className="text-2xl font-bold" style={{ color: '#3B2A1E' }}>Email Configuration</h1>
            <p className="mt-1 text-sm" style={{ color: '#6F4E37' }}>
              Maintain module-wise sender identities for sales, purchase, production, accounts, reminders and system emails.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleFillEmptyFromDefault}
              disabled={!canEditSettings}
              className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: '#CDBA96', color: '#6F4E37', backgroundColor: '#FFFDF8' }}
            >
              Copy Default to Empty
            </button>
            <button
              type="submit"
              disabled={saving || !canEditSettings}
              className="inline-flex items-center gap-2 rounded-md px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#8B6F47' }}
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <SummaryTile label="Configured Senders" value={emailConfigs.length} />
          <SummaryTile label="Active Senders" value={activeCount} positive />
          <SummaryTile label="Unique Mailboxes" value={uniqueEmailCount} />
          <SummaryTile label="Fallback Sender" value={emailConfigs.find((item) => item.email_type === 'noreply')?.email_address || '-'} compact />
        </div>

        {message && (
          <div
            className="rounded-md border px-4 py-3 text-sm font-medium"
            style={{
              borderColor: message.includes('success') ? '#A7F3D0' : '#FECACA',
              backgroundColor: message.includes('success') ? '#ECFDF5' : '#FEF2F2',
              color: message.includes('success') ? '#047857' : '#B91C1C',
            }}
          >
            {message}
          </div>
        )}

        <div className="rounded-md border bg-white" style={{ borderColor: '#E8DCC4' }}>
          <div className="grid grid-cols-[170px_1fr_1fr_120px] gap-3 border-b px-4 py-3 text-xs font-bold uppercase" style={{ borderColor: '#E8DCC4', color: '#6F4E37', backgroundColor: '#F5EFE3' }}>
            <div>Function</div>
            <div>Sender Email</div>
            <div>Usage</div>
            <div className="text-center">Active</div>
          </div>
          <div className="divide-y" style={{ borderColor: '#E8DCC4' }}>
            {senderDefinitions.map((definition) => {
              const config = emailConfigs.find((item) => item.email_type === definition.type);
              const Icon = definition.icon;

              if (!config) return null;

              return (
                <div key={definition.type} className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[170px_1fr_1fr_120px] xl:items-start">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md border p-2" style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFCF7', color: '#8B6F47' }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold" style={{ color: '#3B2A1E' }}>{config.display_name || definition.title}</p>
                      <p className="text-xs uppercase" style={{ color: '#8B6F47' }}>{definition.module}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <input
                      type="email"
                      required
                      disabled={!canEditSettings}
                      value={config.email_address}
                      onChange={(event) => updateConfig(definition.type, { email_address: event.target.value })}
                      className={fieldClass}
                      style={{ borderColor: '#D8C8AA', color: '#3B2A1E' }}
                      placeholder={`${definition.type}@company.com`}
                    />
                    <input
                      type="text"
                      disabled={!canEditSettings}
                      value={config.display_name || ''}
                      onChange={(event) => updateConfig(definition.type, { display_name: event.target.value })}
                      className={fieldClass}
                      style={{ borderColor: '#D8C8AA', color: '#3B2A1E' }}
                      placeholder="Display name"
                    />
                  </div>

                  <div className="space-y-2">
                    <textarea
                      disabled={!canEditSettings}
                      value={config.description || definition.purpose}
                      onChange={(event) => updateConfig(definition.type, { description: event.target.value })}
                      className="min-h-[86px] w-full resize-y rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4] disabled:bg-[#F8F3EA]"
                      style={{ borderColor: '#D8C8AA', color: '#3B2A1E' }}
                    />
                    <p className="text-xs" style={{ color: '#8B6F47' }}>
                      Used for: {definition.examples}
                    </p>
                  </div>

                  <div className="flex xl:justify-center">
                    <button
                      type="button"
                      disabled={!canEditSettings}
                      onClick={() => updateConfig(definition.type, { is_active: config.is_active === false })}
                      className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                      style={{
                        borderColor: config.is_active === false ? '#FECACA' : '#A7F3D0',
                        backgroundColor: config.is_active === false ? '#FEF2F2' : '#ECFDF5',
                        color: config.is_active === false ? '#B91C1C' : '#047857',
                      }}
                    >
                      {config.is_active === false ? <ToggleLeft className="h-5 w-5" /> : <ToggleRight className="h-5 w-5" />}
                      {config.is_active === false ? 'Off' : 'On'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-md border p-4" style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFDF8' }}>
          <div className="mb-2 flex items-center gap-2 font-semibold" style={{ color: '#3B2A1E' }}>
            <CheckCircle2 className="h-5 w-5" style={{ color: '#047857' }} />
            How this works
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3" style={{ color: '#6F4E37' }}>
            <p>Each module can send documents from its configured sender identity.</p>
            <p>If SMTP does not allow that address as From, the app uses the SMTP account as From and sets this mailbox as Reply-To.</p>
            <p>The No Reply sender remains the fallback for automated status messages and system alerts.</p>
          </div>
        </div>
      </form>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  positive,
  compact,
}: {
  label: string;
  value: string | number;
  positive?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="rounded-md border bg-white px-4 py-3" style={{ borderColor: '#E8DCC4' }}>
      <p className="text-xs font-bold uppercase" style={{ color: '#8B6F47' }}>{label}</p>
      <p className={`${compact ? 'truncate text-base' : 'text-2xl'} mt-1 font-bold`} style={{ color: positive ? '#047857' : '#3B2A1E' }}>
        {value}
      </p>
    </div>
  );
}
