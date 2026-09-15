export interface TenantCompanyProfile {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  logo_url?: string;
  domain?: string;
}

export interface WebDocumentBranding {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logoUrl: string;
  initials: string;
  addressLines: string[];
  contactLine: string;
}

function getStandardBrandAssetUrl(fileName: string): string {
  const assetPath = `/branding/${fileName}`;

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${assetPath}`;
  }

  return assetPath;
}

type BrandingCompanyInput = TenantCompanyProfile & {
  companyName?: string;
  company_name?: string;
  phoneNumber?: string;
  taxId?: string;
  logoUrl?: string;
  website?: string;
  subdomain?: string;
  settings?: { letterhead?: Record<string, unknown> } | string | null;
};

function getLetterheadSettings(company?: BrandingCompanyInput | null): Record<string, unknown> {
  const settings = company?.settings;
  const parsed = typeof settings === 'string'
    ? (() => { try { return JSON.parse(settings); } catch { return null; } })()
    : settings;
  const letterhead = parsed && typeof parsed === 'object' && 'letterhead' in parsed
    ? (parsed as { letterhead?: unknown }).letterhead
    : null;
  return letterhead && typeof letterhead === 'object' && !Array.isArray(letterhead)
    ? letterhead as Record<string, unknown>
    : {};
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDefaultBrandingValue(nextPublicKey: string, serverKey: string, fallback: string): string {
  return String(process.env[nextPublicKey] || process.env[serverKey] || fallback).trim();
}

function getFirstNonEmptyValue(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

/** If a name is ALL CAPS (or MOSTLY CAPS), convert to Title Case. Leaves mixed-case names alone. */
function normalizeCompanyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  // Consider it ALL-CAPS if >70% of alpha chars are uppercase
  const alpha = trimmed.replace(/[^a-zA-Z]/g, '');
  if (alpha.length === 0) return trimmed;
  const upperCount = (alpha.match(/[A-Z]/g) || []).length;
  if (upperCount / alpha.length > 0.7) {
    // Title-case: capitalise first letter of each word, lowercase the rest
    return trimmed
      .toLowerCase()
      .replace(/(?:^|\s|-)([a-z])/g, (m, ch) => m.slice(0, -1) + ch.toUpperCase());
  }
  return trimmed;
}

function hasStructuredBranding(company?: BrandingCompanyInput | null): boolean {
  return Boolean(
    getFirstNonEmptyValue(
      company?.address,
      company?.phone,
      company?.phoneNumber,
      company?.email,
      company?.tax_id,
      company?.taxId,
      company?.logo_url,
      company?.logoUrl,
      company?.website,
    ),
  );
}

export function buildDocumentBranding(company?: TenantCompanyProfile | null): WebDocumentBranding {
  const companyInput = company as BrandingCompanyInput | null | undefined;
  const letterhead = getLetterheadSettings(companyInput);
  const useCompanyBranding = hasStructuredBranding(companyInput) || Object.keys(letterhead).length > 0 || Boolean(companyInput?.name);
  const companyName = normalizeCompanyName(getFirstNonEmptyValue(
    letterhead.companyName,
    letterhead.company_name,
    letterhead.legalName,
    useCompanyBranding ? companyInput?.companyName : '',
    useCompanyBranding ? companyInput?.company_name : '',
    useCompanyBranding ? companyInput?.name : '',
    getDefaultBrandingValue('NEXT_PUBLIC_COMPANY_NAME', 'COMPANY_NAME', 'SAK Solutions'),
  ));
  const address = getFirstNonEmptyValue(
    letterhead.address,
    useCompanyBranding ? companyInput?.address : '',
    getDefaultBrandingValue(
      'NEXT_PUBLIC_COMPANY_ADDRESS',
      'COMPANY_ADDRESS',
      '1st Floor, Sunrise Incubation Hub, Hill No. 3, Rushikonda, Visakhapatnam - 530045',
    ),
  );
  const phone = getFirstNonEmptyValue(
    letterhead.phone,
    useCompanyBranding ? companyInput?.phone : '',
    useCompanyBranding ? companyInput?.phoneNumber : '',
    getDefaultBrandingValue('NEXT_PUBLIC_COMPANY_PHONE', 'COMPANY_PHONE', '0891-6662153'),
  );
  const email = getFirstNonEmptyValue(
    letterhead.email,
    useCompanyBranding ? companyInput?.email : '',
    getDefaultBrandingValue('NEXT_PUBLIC_COMPANY_EMAIL', 'COMPANY_EMAIL', 'info@mizantra.ae'),
  );
  const websiteSource = getFirstNonEmptyValue(
    letterhead.website,
    useCompanyBranding ? companyInput?.website : '',
    useCompanyBranding ? companyInput?.domain : '',
    useCompanyBranding ? companyInput?.subdomain : '',
    getDefaultBrandingValue('NEXT_PUBLIC_COMPANY_WEBSITE', 'COMPANY_WEBSITE', ''),
  );
  const website = websiteSource
    ? /^https?:\/\//i.test(websiteSource)
      ? websiteSource
      : websiteSource.includes('.')
        ? `https://${websiteSource}`
        : websiteSource
    : '';
  const taxId = getFirstNonEmptyValue(
    letterhead.taxId,
    letterhead.tax_id,
    useCompanyBranding ? companyInput?.tax_id : '',
    useCompanyBranding ? companyInput?.taxId : '',
    getDefaultBrandingValue('NEXT_PUBLIC_COMPANY_TAX_ID', 'COMPANY_TAX_ID', ''),
  );
  const logoUrl = getFirstNonEmptyValue(
    letterhead.logoUrl,
    letterhead.logo_url,
    useCompanyBranding ? companyInput?.logo_url : '',
    useCompanyBranding ? companyInput?.logoUrl : '',
    getDefaultBrandingValue('NEXT_PUBLIC_COMPANY_LOGO_URL', 'COMPANY_LOGO_URL', ''),
  );
  const addressLines = address
    .split(/\r?\n|,(?=\s*[A-Za-z0-9])/)
    .map((part) => part.trim())
    .filter(Boolean);
  const contactLine = [phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : '', website || '']
    .filter(Boolean)
    .join(' • ');
  const initials = companyName
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'CO';

  return {
    companyName,
    address,
    phone,
    email,
    website,
    taxId,
    logoUrl,
    initials,
    addressLines,
    contactLine,
  };
}

export function renderStandardLetterheadHtml(branding: WebDocumentBranding, generatedOn: string): string {
  const brandLogoUrl = getStandardBrandAssetUrl('sak-solutions-mark.png');
  const headerAddressLines = branding.addressLines.length > 3
    ? [branding.addressLines.slice(0, 3).join(', '), branding.addressLines.slice(3).join(', ')]
    : branding.addressLines;
  const addressMarkup = headerAddressLines.length > 0
    ? headerAddressLines.map((line) => `<div style="font-size:11px; line-height:1.15;">${escapeHtml(line)}</div>`).join('')
    : (branding.address ? `<div style="font-size:11px; line-height:1.15;">${escapeHtml(branding.address)}</div>` : '');

  return `
    <div class="letterhead" style="display:flex; justify-content:space-between; align-items:flex-start; gap:18px; padding:0 0 12px 0; margin:0 0 16px 0; border-bottom:1.5px solid #2d4f95;">
      <div class="logo-section" style="display:flex; align-items:center; gap:12px; min-width:0; padding-top:6px;">
        <img
          class="brand-logo"
          src="${escapeHtml(brandLogoUrl)}"
          alt="SAK Solutions logo"
          style="height:54px; width:58px; object-fit:contain; flex:none;"
        />
      </div>
      <div class="letterhead-address" style="display:flex; flex-direction:column; align-items:flex-end; text-align:right; color:#111827; min-width:290px; padding-top:2px;">
        <div style="font-size:18px; font-weight:500; line-height:1.1;">${escapeHtml(branding.companyName)}</div>
        <div style="margin-top:3px;">${addressMarkup}</div>
        ${branding.email ? `<div style="font-size:11px; line-height:1.15; margin-top:3px;">Email : ${escapeHtml(branding.email)}</div>` : ''}
      </div>
    </div>
  `;
}
