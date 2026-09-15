'use client';

import { useState, useEffect } from 'react';
import { Building2, Save } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';

interface Company {
  id: string;
  name: string;
  domain: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  logo_url?: string;
  settings?: Record<string, unknown>;
}

export default function CompanySettings() {
  const canEditSettings = hasModulePermission(readStoredUser(), 'Settings', 'edit');
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchCompany();
  }, []);

  const fetchCompany = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Company>('/tenant/current');
      setCompany(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    if (!canEditSettings) {
      setMessage('You do not have permission to update company settings');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      await apiClient.put('/tenant/current', company);
      setMessage('Company settings saved successfully!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error: any) {
      setMessage(error.message || 'Failed to save company settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12" style={{ color: '#8B6F47' }}>
        Loading company settings...
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-center py-12" style={{ color: '#8B6F47' }}>
        Company information not found
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="bg-white rounded-lg border-2 p-6" style={{ borderColor: '#E8DCC4' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-lg" style={{ backgroundColor: '#E8DCC4' }}>
            <Building2 className="w-6 h-6" style={{ color: '#8B6F47' }} />
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: '#6F4E37' }}>
              Company Information
            </h2>
            <p className="text-sm" style={{ color: '#8B6F47' }}>
              Update your company details and settings
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                Legal / Company Name
              </label>
              <input
                type="text"
                required
                value={company.name}
                onChange={(e) => setCompany({ ...company, name: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                Portal Domain / URL
              </label>
              <input
                type="text"
                required
                value={company.domain}
                onChange={(e) => setCompany({ ...company, domain: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
              Registered Address
            </label>
            <textarea
              rows={3}
              value={company.address || ''}
              onChange={(e) => setCompany({ ...company, address: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80"
              style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
              placeholder="Company address..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                Company Phone
              </label>
              <input
                type="tel"
                value={company.phone || ''}
                onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
                placeholder="+1 234 567 8900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                Official Email
              </label>
              <input
                type="email"
                value={company.email || ''}
                onChange={(e) => setCompany({ ...company, email: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
                placeholder="contact@company.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                GSTIN / Tax Registration
              </label>
              <input
                type="text"
                value={company.tax_id || ''}
                onChange={(e) => setCompany({ ...company, tax_id: e.target.value.toUpperCase() })}
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
                placeholder="27ABCDE1234F1Z5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                Logo URL
              </label>
              <input
                type="url"
                value={company.logo_url || ''}
                onChange={(e) => setCompany({ ...company, logo_url: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border-2 focus:outline-none focus:border-opacity-80"
                style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              ['Document Branding', 'Used on PO, RFQ, GRN, invoices, reports, and print layouts.'],
              ['Regional Setup', 'Timezone, language, and currency remain controlled by tenant defaults.'],
              ['Audit Ownership', 'Changes are protected by Settings permissions and reflected after refresh.'],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-lg border p-4" style={{ borderColor: '#E8DCC4', backgroundColor: '#FEF9F0' }}>
                <p className="text-sm font-semibold" style={{ color: '#6F4E37' }}>{title}</p>
                <p className="mt-1 text-xs leading-5" style={{ color: '#8B6F47' }}>{copy}</p>
              </div>
            ))}
          </div>

          {message && (
            <div
              className={`p-3 rounded-lg text-sm ${
                message.includes('success') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
              }`}
            >
              {message}
            </div>
          )}

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={saving || !canEditSettings}
              className="flex items-center gap-2 px-6 py-2 rounded-lg text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#8B6F47' }}
            >
              <Save className="w-5 h-5" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
