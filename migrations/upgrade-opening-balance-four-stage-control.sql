BEGIN;

ALTER TABLE public.accounting_opening_balance_batches
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

ALTER TABLE public.accounting_opening_balance_batches
  DROP CONSTRAINT IF EXISTS accounting_opening_balance_batches_status_check;

ALTER TABLE public.accounting_opening_balance_batches
  ADD CONSTRAINT accounting_opening_balance_batches_status_check
  CHECK (status IN ('DRAFT', 'VALIDATED', 'APPROVED', 'POSTED', 'CANCELLED'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_opening_balance_journal_source
  ON public.accounting_journals (tenant_id, source_id)
  WHERE source_type = 'OPENING_BALANCE' AND source_id IS NOT NULL;

COMMIT;
