-- Four-stage maker/checker workflow for manual and recurring journals.
-- Operational source journals continue to be posted by their controlled source
-- process; manual and recurring vouchers must follow Draft -> Reviewed -> Approved -> Posted.

ALTER TABLE public.accounting_journals
  DROP CONSTRAINT IF EXISTS accounting_journals_status_check;

ALTER TABLE public.accounting_journals
  ADD CONSTRAINT accounting_journals_status_check
  CHECK (status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'POSTED', 'REVERSED'));

CREATE TABLE IF NOT EXISTS public.accounting_journal_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES public.accounting_journals(id) ON DELETE CASCADE,
  approval_status VARCHAR(12) NOT NULL CHECK (approval_status IN ('APPROVED', 'RETURNED')),
  approval_note TEXT,
  approved_by UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, journal_id)
);

CREATE TABLE IF NOT EXISTS public.accounting_journal_workflow_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES public.accounting_journals(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('PREPARED', 'REVIEWED', 'RETURNED', 'APPROVED', 'POSTED', 'REVERSED')),
  from_status VARCHAR(12),
  to_status VARCHAR(12) NOT NULL,
  note TEXT,
  performed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_approvals_tenant
  ON public.accounting_journal_approvals (tenant_id, journal_id);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_events_tenant
  ON public.accounting_journal_workflow_events (tenant_id, journal_id, created_at DESC);

COMMENT ON TABLE public.accounting_journal_approvals IS 'Independent approver record for manual and recurring journal vouchers.';
COMMENT ON TABLE public.accounting_journal_workflow_events IS 'Immutable workflow evidence for preparation, review, approval, posting and reversal.';
