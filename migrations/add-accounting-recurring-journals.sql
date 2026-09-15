-- Mizantra/test: controlled recurring-journal templates.
-- Templates create reviewable DRAFT vouchers only; nothing is auto-posted.
CREATE TABLE IF NOT EXISTS public.accounting_recurring_journals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_code VARCHAR(60) NOT NULL,
  template_name VARCHAR(180) NOT NULL,
  frequency VARCHAR(16) NOT NULL DEFAULT 'MONTHLY' CHECK (frequency IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),
  next_run_date DATE NOT NULL,
  transaction_currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  narration TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_generated_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, template_code),
  CHECK (jsonb_typeof(lines) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_accounting_recurring_journals_due
  ON public.accounting_recurring_journals (tenant_id, is_active, next_run_date);

COMMENT ON TABLE public.accounting_recurring_journals IS
  'Reusable balanced journal templates. Generating a template creates a DRAFT voucher for finance review and never auto-posts.';
