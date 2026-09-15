'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, FileText, Printer, Save, Eye, RotateCcw, Upload, X } from 'lucide-react';
import { apiClient } from '../../../../../lib/api-client';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';

type LetterheadTemplate = {
  companyName: string;
  legalName: string;
  headerSubtitle: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logoUrl: string;
  headerImageUrl: string;
  footerImageUrl: string;
  footerText: string;
  footerContactLine: string;
  showLogo: boolean;
  showTaxId: boolean;
  showContact: boolean;
};

type Company = {
  id: string;
  name: string;
  domain?: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  logo_url?: string;
  settings?: Record<string, any>;
};

const defaultTemplate: LetterheadTemplate = {
  companyName: '',
  legalName: '',
  headerSubtitle: 'Manufacturing ERP System',
  address: '',
  phone: '',
  email: '',
  website: '',
  taxId: '',
  logoUrl: '',
  headerImageUrl: '',
  footerImageUrl: '',
  footerText: 'Computer-generated document. No physical signature required.',
  footerContactLine: '',
  showLogo: true,
  showTaxId: true,
  showContact: true,
};

function toTemplate(company: Company): LetterheadTemplate {
  const saved = (company.settings?.letterhead || {}) as Partial<LetterheadTemplate>;
  const contactLine = [
    company.phone ? `Phone: ${company.phone}` : '',
    company.email ? `Email: ${company.email}` : '',
    company.domain ? company.domain : '',
  ].filter(Boolean).join(' | ');

  return {
    ...defaultTemplate,
    companyName: company.name || '',
    legalName: company.name || '',
    address: company.address || '',
    phone: company.phone || '',
    email: company.email || '',
    website: company.domain || '',
    taxId: company.tax_id || '',
    logoUrl: company.logo_url || '',
    footerContactLine: contactLine,
    ...saved,
  };
}

export default function LetterheadSettings() {
  const canEditSettings = hasModulePermission(readStoredUser(), 'Settings', 'edit');
  const [company, setCompany] = useState<Company | null>(null);
  const [template, setTemplate] = useState<LetterheadTemplate>(defaultTemplate);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'header' | 'footer' | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchCompany();
  }, []);

  const addressPreview = useMemo(
    () => template.address.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    [template.address],
  );

  const readiness = useMemo(() => {
    const items = [
      { label: 'Company name', done: Boolean(template.companyName.trim()) },
      { label: 'Registered address', done: Boolean(template.address.trim()) },
      { label: 'Contact details', done: Boolean(template.phone.trim() || template.email.trim()) },
      { label: 'GST / Tax ID', done: Boolean(template.taxId.trim()) },
      { label: 'Header identity', done: Boolean(template.headerImageUrl.trim() || template.logoUrl.trim() || template.companyName.trim()) },
      { label: 'Footer instruction', done: Boolean(template.footerImageUrl.trim() || template.footerText.trim() || template.footerContactLine.trim()) },
    ];
    const completed = items.filter((item) => item.done).length;
    return {
      items,
      completed,
      total: items.length,
      percentage: Math.round((completed / items.length) * 100),
    };
  }, [template]);

  const fetchCompany = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Company>('/tenant/current');
      setCompany(data);
      setTemplate(toTemplate(data));
    } finally {
      setLoading(false);
    }
  };

  const resetFromCompany = () => {
    if (!company) return;
    setTemplate(toTemplate({ ...company, settings: { ...company.settings, letterhead: {} } }));
    setMessage('Template reset from company information. Save to apply.');
  };

  const openPrintablePreview = () => {
    const previewWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
    if (!previewWindow) {
      setMessage('Popup blocked. Please allow popups to open the printable letterhead preview.');
      return;
    }

    previewWindow.document.write(renderLetterheadPreviewDocument(template, addressPreview));
    previewWindow.document.close();
    previewWindow.focus();
  };

  const updateField = <K extends keyof LetterheadTemplate>(key: K, value: LetterheadTemplate[K]) => {
    setTemplate((current) => ({ ...current, [key]: value }));
  };

  const uploadArtwork = async (type: 'header' | 'footer', file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('Please upload PNG or JPG image artwork.');
      return;
    }

    setUploading(type);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bucket', 'documents');
      formData.append('folder', `letterhead/${type}`);
      const upload = await apiClient.postForm<{ url: string }>('/upload', formData);
      updateField(type === 'header' ? 'headerImageUrl' : 'footerImageUrl', upload.url);
      setMessage(`${type === 'header' ? 'Header' : 'Footer'} artwork uploaded. Save template to apply.`);
    } catch (error: any) {
      setMessage(error.message || 'Failed to upload artwork');
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!company) return;
    if (!canEditSettings) {
      setMessage('You do not have permission to update letterhead templates');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const nextSettings = {
        ...(company.settings || {}),
        letterhead: template,
      };

      const updated = await apiClient.put<Company>('/tenant/current', {
        ...company,
        settings: nextSettings,
      });

      setCompany(updated);
      setTemplate(toTemplate(updated));
      setMessage('Letterhead template saved successfully.');
      setTimeout(() => setMessage(''), 3000);
    } catch (error: any) {
      setMessage(error.message || 'Failed to save letterhead template');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-[#8B6F47]">Loading letterhead settings...</div>;
  }

  return (
    <div className="grid max-w-7xl grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
      <form onSubmit={handleSubmit} className="rounded-lg border-2 bg-white" style={{ borderColor: '#E8DCC4' }}>
        <div className="border-b p-5" style={{ borderColor: '#E8DCC4' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-3" style={{ backgroundColor: '#E8DCC4' }}>
                <FileText className="h-6 w-6" style={{ color: '#8B6F47' }} />
              </div>
              <div>
                <h2 className="text-xl font-semibold" style={{ color: '#6F4E37' }}>Letterhead Templates</h2>
                <p className="text-sm" style={{ color: '#8B6F47' }}>Control the header, footer, contact details, logo and GST display used across generated documents.</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={openPrintablePreview}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: '#D7C29E', color: '#6F4E37' }}
              >
                <Printer className="h-4 w-4" />
                Printable Preview
              </button>
              <button
                type="button"
                onClick={resetFromCompany}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: '#D7C29E', color: '#6F4E37' }}
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5">
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-lg border p-4" style={{ borderColor: '#D7C29E', backgroundColor: '#FFFCF7' }}>
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide" style={{ color: '#6F4E37' }}>
                <ClipboardCheck className="h-4 w-4" />
                Template Coverage
              </div>
              <p className="mt-2 text-sm" style={{ color: '#8B6F47' }}>
                This template is used by printable purchase and inward documents such as PO, GRN, service entries, quotations, and supplier-facing PDFs.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2" style={{ color: '#6F4E37' }}>
                <div className="rounded border bg-white px-3 py-2" style={{ borderColor: '#E8DCC4' }}>PO / RFQ documents</div>
                <div className="rounded border bg-white px-3 py-2" style={{ borderColor: '#E8DCC4' }}>GRN / service acceptance</div>
                <div className="rounded border bg-white px-3 py-2" style={{ borderColor: '#E8DCC4' }}>Accounts attachments</div>
                <div className="rounded border bg-white px-3 py-2" style={{ borderColor: '#E8DCC4' }}>Audit copy / print output</div>
              </div>
            </div>
            <div className="rounded-lg border p-4" style={{ borderColor: readiness.percentage === 100 ? '#86EFAC' : '#FCD34D', backgroundColor: readiness.percentage === 100 ? '#F0FDF4' : '#FFFBEB' }}>
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6F4E37' }}>Readiness</div>
              <div className="mt-1 text-2xl font-bold" style={{ color: readiness.percentage === 100 ? '#047857' : '#92400E' }}>{readiness.percentage}%</div>
              <div className="mt-1 text-xs" style={{ color: '#8B6F47' }}>{readiness.completed} of {readiness.total} letterhead checks complete</div>
              <div className="mt-3 space-y-1">
                {readiness.items.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 text-xs" style={{ color: item.done ? '#047857' : '#92400E' }}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: '#6F4E37' }}>Header And Footer Artwork</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ArtworkUpload
                label="Header Design Image"
                helper="Upload a full-width header strip. PNG/JPG recommended."
                value={template.headerImageUrl}
                uploading={uploading === 'header'}
                onUpload={(file) => uploadArtwork('header', file)}
                onClear={() => updateField('headerImageUrl', '')}
              />
              <ArtworkUpload
                label="Footer Design Image"
                helper="Upload a footer strip for terms/contact/signature area."
                value={template.footerImageUrl}
                uploading={uploading === 'footer'}
                onUpload={(file) => uploadArtwork('footer', file)}
                onClear={() => updateField('footerImageUrl', '')}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: '#6F4E37' }}>Header Identity</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="Company Name" value={template.companyName} onChange={(value) => updateField('companyName', value)} required />
              <TextField label="Legal Name" value={template.legalName} onChange={(value) => updateField('legalName', value)} />
              <TextField label="Header Subtitle" value={template.headerSubtitle} onChange={(value) => updateField('headerSubtitle', value)} />
              <TextField label="Logo URL" value={template.logoUrl} onChange={(value) => updateField('logoUrl', value)} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: '#6F4E37' }}>Contact And Tax</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="Phone / Contact Numbers" value={template.phone} onChange={(value) => updateField('phone', value)} />
              <TextField label="Official Email" value={template.email} onChange={(value) => updateField('email', value)} />
              <TextField label="Website" value={template.website} onChange={(value) => updateField('website', value)} />
              <TextField label="GSTIN / Tax ID" value={template.taxId} onChange={(value) => updateField('taxId', value.toUpperCase())} />
            </div>
            <label className="mt-4 block text-sm font-medium" style={{ color: '#6F4E37' }}>
              Registered Address
              <textarea
                rows={3}
                value={template.address}
                onChange={(event) => updateField('address', event.target.value)}
                className="mt-2 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[#8B6F47]"
                style={{ borderColor: '#D7C29E', color: '#4A3525' }}
              />
            </label>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: '#6F4E37' }}>Footer</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="Footer Text" value={template.footerText} onChange={(value) => updateField('footerText', value)} />
              <TextField label="Footer Contact Line" value={template.footerContactLine} onChange={(value) => updateField('footerContactLine', value)} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: '#6F4E37' }}>Display Rules</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Toggle label="Show Logo" checked={template.showLogo} onChange={(value) => updateField('showLogo', value)} />
              <Toggle label="Show Contact" checked={template.showContact} onChange={(value) => updateField('showContact', value)} />
              <Toggle label="Show GST / Tax ID" checked={template.showTaxId} onChange={(value) => updateField('showTaxId', value)} />
            </div>
          </section>

          {message && (
            <div className={`rounded-md p-3 text-sm ${message.includes('success') ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>
              {message}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t p-4" style={{ borderColor: '#E8DCC4' }}>
          <button
            type="button"
            onClick={openPrintablePreview}
            className="mr-3 inline-flex items-center gap-2 rounded-md border px-5 py-2 text-sm font-semibold"
            style={{ borderColor: '#D7C29E', color: '#6F4E37' }}
          >
            <Printer className="h-4 w-4" />
            Test Print
          </button>
          <button
            type="submit"
            disabled={saving || !canEditSettings}
            className="inline-flex items-center gap-2 rounded-md px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#8B6F47' }}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </form>

      <aside className="rounded-lg border-2 bg-white" style={{ borderColor: '#E8DCC4' }}>
        <div className="flex items-center gap-2 border-b p-4" style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}>
          <Eye className="h-5 w-5" />
          <h3 className="font-semibold">Document Preview</h3>
        </div>
        <div className="p-5">
          <div className="min-h-[560px] rounded border bg-white p-6 shadow-sm" style={{ borderColor: '#D7C29E' }}>
            <div className="border-b pb-4 text-right" style={{ borderColor: '#8B6F47' }}>
              {template.headerImageUrl ? (
                <img src={template.headerImageUrl} alt="Header artwork preview" className="h-24 w-full object-cover" />
              ) : (
                <div className="flex items-start justify-between gap-4 text-left">
                  {template.showLogo ? (
                    <div className="flex h-14 w-14 items-center justify-center rounded border text-lg font-bold" style={{ borderColor: '#D7C29E', color: '#8B6F47' }}>
                      {(template.companyName || 'CO').slice(0, 2).toUpperCase()}
                    </div>
                  ) : <div />}
                  <div className="min-w-0 text-right">
                    <div className="text-lg font-bold" style={{ color: '#3B2A1E' }}>{template.companyName || 'Company Name'}</div>
                    {template.headerSubtitle && <div className="text-xs" style={{ color: '#8B6F47' }}>{template.headerSubtitle}</div>}
                    {addressPreview.slice(0, 3).map((line) => (
                      <div key={line} className="text-xs" style={{ color: '#6F4E37' }}>{line}</div>
                    ))}
                    {template.showContact && <div className="mt-1 text-xs" style={{ color: '#6F4E37' }}>{[template.phone, template.email].filter(Boolean).join(' | ')}</div>}
                    {template.showTaxId && template.taxId && <div className="text-xs" style={{ color: '#6F4E37' }}>GSTIN: {template.taxId}</div>}
                  </div>
                </div>
              )}
            </div>
            <div className="my-4 rounded-sm px-3 py-2 text-center text-sm font-bold text-white" style={{ backgroundColor: '#8B6F47' }}>
              PURCHASE ORDER
            </div>
            <div className="space-y-3 text-sm" style={{ color: '#3B2A1E' }}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border p-3" style={{ borderColor: '#E8DCC4' }}>
                  <div className="text-xs font-semibold uppercase">Document No.</div>
                  <div>PO-2026-0001</div>
                </div>
                <div className="rounded border p-3" style={{ borderColor: '#E8DCC4' }}>
                  <div className="text-xs font-semibold uppercase">Date</div>
                  <div>09/07/26</div>
                </div>
              </div>
              <div className="h-40 rounded border p-3" style={{ borderColor: '#E8DCC4' }}>Document body preview</div>
            </div>
            <div className="mt-6 border-t pt-3 text-xs" style={{ borderColor: '#D7C29E', color: '#8B6F47' }}>
              {template.footerImageUrl ? (
                <img src={template.footerImageUrl} alt="Footer artwork preview" className="h-14 w-full object-cover" />
              ) : (
                <>
                  <div>{template.footerText}</div>
                  {template.footerContactLine && <div>{template.footerContactLine}</div>}
                </>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function renderLetterheadPreviewDocument(template: LetterheadTemplate, addressLines: string[]) {
  const contactLine = [template.phone, template.email, template.website].filter(Boolean).join(' | ');
  const headerHtml = template.headerImageUrl
    ? `<img src="${escapeHtml(template.headerImageUrl)}" style="width:100%; max-height:110px; object-fit:cover;" alt="Header artwork" />`
    : `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:24px; border-bottom:2px solid #8B6F47; padding-bottom:16px;">
        ${template.showLogo ? `
          <div style="width:76px; height:76px; border:1px solid #D7C29E; border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden; color:#8B6F47; font-weight:700;">
            ${template.logoUrl ? `<img src="${escapeHtml(template.logoUrl)}" style="width:100%; height:100%; object-fit:contain;" alt="Logo" />` : escapeHtml((template.companyName || 'CO').slice(0, 2).toUpperCase())}
          </div>
        ` : '<div></div>'}
        <div style="text-align:right;">
          <div style="font-size:24px; font-weight:700; color:#3B2A1E;">${escapeHtml(template.companyName || 'Company Name')}</div>
          ${template.legalName ? `<div style="font-size:13px; color:#6F4E37;">${escapeHtml(template.legalName)}</div>` : ''}
          ${template.headerSubtitle ? `<div style="font-size:12px; color:#8B6F47; margin-top:4px;">${escapeHtml(template.headerSubtitle)}</div>` : ''}
          ${addressLines.map((line) => `<div style="font-size:11px; color:#4A3525;">${escapeHtml(line)}</div>`).join('')}
          ${template.showContact && contactLine ? `<div style="font-size:11px; color:#4A3525; margin-top:4px;">${escapeHtml(contactLine)}</div>` : ''}
          ${template.showTaxId && template.taxId ? `<div style="font-size:11px; color:#4A3525;">GSTIN / Tax ID: ${escapeHtml(template.taxId)}</div>` : ''}
        </div>
      </div>
    `;
  const footerHtml = template.footerImageUrl
    ? `<img src="${escapeHtml(template.footerImageUrl)}" style="width:100%; max-height:70px; object-fit:cover;" alt="Footer artwork" />`
    : `
      <div style="border-top:1px solid #D7C29E; padding-top:10px; color:#8B6F47; font-size:11px;">
        <div>${escapeHtml(template.footerText)}</div>
        ${template.footerContactLine ? `<div>${escapeHtml(template.footerContactLine)}</div>` : ''}
      </div>
    `;

  return `<!doctype html>
    <html>
      <head>
        <title>Letterhead Preview</title>
        <style>
          body { margin: 0; background: #f5efe4; font-family: Arial, sans-serif; color: #3B2A1E; }
          .page { width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 24px auto; background: white; padding: 18mm; box-shadow: 0 14px 40px rgba(0,0,0,.12); }
          .bar { margin: 18px 0; background: #8B6F47; color: white; text-align: center; padding: 10px; font-weight: 700; letter-spacing: .08em; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
          th, td { border: 1px solid #E8DCC4; padding: 9px; text-align: left; }
          th { background: #F7F1E8; color: #6F4E37; }
          @media print {
            body { background: white; }
            .page { margin: 0; box-shadow: none; width: auto; min-height: auto; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="text-align:center; padding:12px;">
          <button onclick="window.print()" style="background:#8B6F47;color:white;border:0;border-radius:6px;padding:10px 18px;font-weight:700;cursor:pointer;">Print / Save PDF</button>
        </div>
        <main class="page">
          ${headerHtml}
          <div class="bar">SAMPLE DOCUMENT</div>
          <section style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:12px;">
            <div><strong>Document No.</strong><br/>PO-SAMPLE-0001</div>
            <div><strong>Date</strong><br/>${new Date().toLocaleDateString('en-GB')}</div>
            <div><strong>Supplier</strong><br/>Sample Supplier Pvt. Ltd.</div>
            <div><strong>Prepared By</strong><br/>SAK ERP</div>
          </section>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
            <tbody>
              <tr><td>Sample material / service line</td><td>10</td><td>₹100.00</td><td>₹1,000.00</td></tr>
              <tr><td>Freight / additional charges</td><td>1</td><td>₹100.00</td><td>₹100.00</td></tr>
            </tbody>
          </table>
          <div style="height:430px;"></div>
          ${footerHtml}
        </main>
      </body>
    </html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ArtworkUpload({
  label,
  helper,
  value,
  uploading,
  onUpload,
  onClear,
}: {
  label: string;
  helper: string;
  value: string;
  uploading: boolean;
  onUpload: (file?: File | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-md border p-4" style={{ borderColor: '#D7C29E', backgroundColor: '#FFFCF7' }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: '#6F4E37' }}>{label}</div>
          <div className="text-xs" style={{ color: '#8B6F47' }}>{helper}</div>
        </div>
        {value && (
          <button type="button" onClick={onClear} className="rounded border p-2" style={{ borderColor: '#FCA5A5', color: '#B91C1C' }} title="Remove artwork">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {value && (
        <img src={value} alt={`${label} preview`} className="mb-3 h-20 w-full rounded border object-cover" style={{ borderColor: '#E8DCC4' }} />
      )}
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold" style={{ borderColor: '#D7C29E', color: '#6F4E37' }}>
        <Upload className="h-4 w-4" />
        {uploading ? 'Uploading...' : value ? 'Replace Image' : 'Upload Image'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          className="hidden"
          disabled={uploading}
          onChange={(event) => {
            onUpload(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
    </div>
  );
}

function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="block text-sm font-medium" style={{ color: '#6F4E37' }}>
      {label}{required ? ' *' : ''}
      <input
        type="text"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[#8B6F47]"
        style={{ borderColor: '#D7C29E', color: '#4A3525' }}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: '#D7C29E', color: '#6F4E37' }}>
      {label}
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#8B6F47]" />
    </label>
  );
}
