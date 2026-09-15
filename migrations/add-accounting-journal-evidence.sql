-- Mizantra/test: evidence is retained independently of an accounting voucher.
-- This deliberately allows evidence to be added after a voucher is posted while
-- keeping the posted voucher and its debit/credit lines immutable.
CREATE TABLE IF NOT EXISTS public.accounting_journal_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES public.accounting_journals(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(120),
  file_size BIGINT,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_attachments_journal
  ON public.accounting_journal_attachments (tenant_id, journal_id, created_at DESC);

COMMENT ON TABLE public.accounting_journal_attachments IS
  'Append-only supporting evidence for accounting vouchers; retained separately so posted vouchers remain immutable.';
