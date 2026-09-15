-- Mizantra/test: independent review evidence for draft journal vouchers.
-- This does not auto-post or alter historical journals.
CREATE TABLE IF NOT EXISTS public.accounting_journal_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES public.accounting_journals(id) ON DELETE CASCADE,
  review_status VARCHAR(16) NOT NULL DEFAULT 'APPROVED'
    CHECK (review_status IN ('APPROVED', 'RETURNED')),
  review_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, journal_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_reviews_tenant
  ON public.accounting_journal_reviews (tenant_id, reviewed_at DESC);

COMMENT ON TABLE public.accounting_journal_reviews IS
  'Finance review evidence for draft journals; posting remains a separate controlled action.';
