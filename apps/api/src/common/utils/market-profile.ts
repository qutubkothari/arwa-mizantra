export type MarketProfile = 'INDIA' | 'UAE';

export type RegionalDefaults = {
  marketProfile: MarketProfile;
  currency: 'INR' | 'AED';
  taxRegime: 'GST' | 'UAE_VAT';
  defaultTaxRate: number;
  locale: string;
  timezone: string;
};

export const INDIA_DEFAULTS: RegionalDefaults = {
  marketProfile: 'INDIA',
  currency: 'INR',
  taxRegime: 'GST',
  defaultTaxRate: 18,
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
};

export const UAE_DEFAULTS: RegionalDefaults = {
  marketProfile: 'UAE',
  currency: 'AED',
  taxRegime: 'UAE_VAT',
  defaultTaxRate: 5,
  locale: 'en-AE',
  timezone: 'Asia/Dubai',
};

export function regionalDefaults(value?: unknown): RegionalDefaults {
  return String(value || '').trim().toUpperCase() === 'UAE' ? UAE_DEFAULTS : INDIA_DEFAULTS;
}
