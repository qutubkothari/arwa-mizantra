-- Approved onboarding data can be applied through native services. Historical
-- transaction imports remain analytical evidence and never post stock or GL.
ALTER TABLE public.mizantra_onboarding_batches ADD COLUMN IF NOT EXISTS application_result JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.mizantra_onboarding_batches ADD COLUMN IF NOT EXISTS applied_by UUID;
ALTER TABLE public.mizantra_onboarding_batches ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.mizantra_historical_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  onboarding_batch_id UUID NOT NULL REFERENCES public.mizantra_onboarding_batches(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('PURCHASE','SALE')),
  document_number TEXT NOT NULL,
  party_code TEXT NOT NULL,
  document_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'AED',
  source_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,direction,document_number)
);
CREATE INDEX IF NOT EXISTS idx_mizantra_history_period ON public.mizantra_historical_transactions(tenant_id,direction,document_date);
ALTER TABLE public.mizantra_historical_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.mizantra_historical_transactions;
CREATE POLICY tenant_isolation ON public.mizantra_historical_transactions
  USING (tenant_id::text = auth.jwt()->>'tenant_id')
  WITH CHECK (tenant_id::text = auth.jwt()->>'tenant_id');
NOTIFY pgrst, 'reload schema';
