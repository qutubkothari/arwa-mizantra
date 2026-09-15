-- Explicit country-market boundary. Existing tenants remain INDIA.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS market_profile text NOT NULL DEFAULT 'INDIA',
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS tax_regime text NOT NULL DEFAULT 'GST',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-IN',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_market_profile_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_market_profile_check
      CHECK (market_profile IN ('INDIA', 'UAE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_currency_profile_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_currency_profile_check
      CHECK ((market_profile = 'INDIA' AND default_currency = 'INR') OR
             (market_profile = 'UAE' AND default_currency = 'AED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_market_profile ON public.tenants (market_profile);
