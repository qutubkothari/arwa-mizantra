CREATE TABLE IF NOT EXISTS public.grn_payment_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  grn_id UUID NOT NULL REFERENCES public.grns(id) ON DELETE CASCADE,
  payment_entry_id UUID NOT NULL,
  original_payment_date DATE,
  original_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  original_tds_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  original_short_payment_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  original_payment_method VARCHAR(50),
  original_payment_reference VARCHAR(200),
  reversal_reason TEXT NOT NULL,
  reversed_by UUID,
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_entry JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_grn_payment_reversals_grn
  ON public.grn_payment_reversals(tenant_id, grn_id, reversed_at DESC);

CREATE INDEX IF NOT EXISTS idx_grn_payment_reversals_payment_entry
  ON public.grn_payment_reversals(tenant_id, payment_entry_id);

COMMENT ON TABLE public.grn_payment_reversals IS 'Audit trail for AP payment reversals against supplier GRN invoices.';
