-- Governed intercompany matching and group elimination ledger.
ALTER TABLE public.enterprise_intercompany_register
  ADD COLUMN IF NOT EXISTS counterparty_reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS counterparty_amount NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS match_variance NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reporting_amount NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS matched_by UUID,
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS match_note TEXT;

ALTER TABLE public.enterprise_consolidation_runs
  ADD COLUMN IF NOT EXISTS run_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS validated_by UUID,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_by UUID,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_hash VARCHAR(64);
UPDATE public.enterprise_consolidation_runs SET run_code = 'LEGACY-' || id::text WHERE run_code IS NULL;
ALTER TABLE public.enterprise_consolidation_runs ALTER COLUMN run_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_consolidation_run_code ON public.enterprise_consolidation_runs(tenant_id,run_code);
ALTER TABLE public.enterprise_consolidation_runs DROP CONSTRAINT IF EXISTS enterprise_consolidation_runs_status_check;
ALTER TABLE public.enterprise_consolidation_runs ADD CONSTRAINT enterprise_consolidation_runs_status_check CHECK(status IN ('DRAFT','VALIDATED','APPROVED','POSTED'));

CREATE TABLE IF NOT EXISTS public.enterprise_elimination_journals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  consolidation_run_id UUID NOT NULL REFERENCES public.enterprise_consolidation_runs(id) ON DELETE CASCADE,
  journal_number VARCHAR(100) NOT NULL,
  journal_date DATE NOT NULL,
  reporting_currency CHAR(3) NOT NULL DEFAULT 'AED',
  total_debit NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18,4) NOT NULL DEFAULT 0,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','POSTED')),
  prepared_by UUID, approved_by UUID, posted_by UUID,
  approved_at TIMESTAMPTZ, posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,journal_number), CHECK(total_debit = total_credit)
);
CREATE INDEX IF NOT EXISTS idx_elimination_journal_run ON public.enterprise_elimination_journals(tenant_id,consolidation_run_id,status);
