-- Egypt tenant profile and Arabic/EGP regional defaults.
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_market_profile_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_market_profile_check
  CHECK (market_profile IN ('INDIA', 'UAE', 'EGYPT'));

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_market_currency_check;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_market_profile_currency_check;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_currency_profile_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_market_currency_check
  CHECK (
    (market_profile = 'INDIA' AND default_currency = 'INR') OR
    (market_profile = 'UAE' AND default_currency = 'AED') OR
    (market_profile = 'EGYPT' AND default_currency = 'EGP')
  );

COMMENT ON COLUMN public.tenants.market_profile IS
  'Regional ERP profile: INDIA, UAE or EGYPT. Egypt defaults to Arabic, EGP and Africa/Cairo.';
