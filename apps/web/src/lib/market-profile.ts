export type MarketProfile = 'INDIA' | 'UAE';

export type RegionalProfile = {
  marketProfile: MarketProfile;
  currency: 'INR' | 'AED';
  taxRegime: 'GST' | 'UAE_VAT';
  defaultTaxRate: number;
  locale: string;
  timezone: string;
  taxLabel: string;
  taxRegistrationLabel: string;
};

export const INDIA_PROFILE: RegionalProfile = {
  marketProfile: 'INDIA',
  currency: 'INR',
  taxRegime: 'GST',
  defaultTaxRate: 18,
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  taxLabel: 'GST',
  taxRegistrationLabel: 'GSTIN / Tax ID',
};

export const UAE_PROFILE: RegionalProfile = {
  marketProfile: 'UAE',
  currency: 'AED',
  taxRegime: 'UAE_VAT',
  defaultTaxRate: 5,
  locale: 'en-AE',
  timezone: 'Asia/Dubai',
  taxLabel: 'VAT',
  taxRegistrationLabel: 'TRN / Tax ID',
};

export function resolveRegionalProfile(value?: Partial<RegionalProfile> | string | null): RegionalProfile {
  if (typeof value === 'string') return value.toUpperCase() === 'UAE' ? UAE_PROFILE : INDIA_PROFILE;
  return value?.marketProfile === 'UAE' ? UAE_PROFILE : INDIA_PROFILE;
}

export function formatRegionalCurrency(amount: number | null | undefined, profile?: Partial<RegionalProfile> | string | null): string {
  const regional = resolveRegionalProfile(profile);
  return new Intl.NumberFormat(regional.locale, {
    style: 'currency',
    currency: regional.currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}
