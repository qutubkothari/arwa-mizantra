-- Connected ROI ledger: immutable operational evidence, finance attribution and client statements.
CREATE TABLE IF NOT EXISTS public.value_source_benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_module VARCHAR(60) NOT NULL,
  source_table VARCHAR(100) NOT NULL,
  source_record_id UUID NOT NULL,
  source_benefit_key VARCHAR(60) NOT NULL,
  source_reference TEXT NOT NULL,
  benefit_title TEXT NOT NULL,
  benefit_class VARCHAR(30) NOT NULL CHECK (benefit_class IN ('CASH_RELEASE','ACCOUNTING_SAVING','REVENUE_UPLIFT','WORKING_CAPITAL','RISK_AVOIDANCE')),
  realization_basis VARCHAR(20) NOT NULL CHECK (realization_basis IN ('ONE_TIME','ANNUALIZED','PERIODIC')),
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  baseline_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (baseline_amount >= 0),
  baseline_evidence TEXT NOT NULL,
  gross_amount NUMERIC(18,2) NOT NULL CHECK (gross_amount > 0),
  outcome_evidence TEXT NOT NULL,
  source_verified_by UUID,
  source_verified_at TIMESTAMPTZ NOT NULL,
  source_snapshot_hash VARCHAR(64) NOT NULL,
  drift_detected BOOLEAN NOT NULL DEFAULT FALSE,
  drift_details JSONB,
  finance_status VARCHAR(24) NOT NULL DEFAULT 'SOURCE_VERIFIED' CHECK (finance_status IN ('SOURCE_VERIFIED','FINANCE_VERIFIED','REJECTED')),
  finance_verified_amount NUMERIC(18,2) CHECK (finance_verified_amount IS NULL OR finance_verified_amount > 0),
  finance_evidence TEXT,
  finance_note TEXT,
  finance_verified_by UUID,
  finance_verified_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  first_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_table, source_record_id, source_benefit_key),
  CHECK (finance_verified_amount IS NULL OR finance_verified_amount <= gross_amount)
);

CREATE TABLE IF NOT EXISTS public.value_benefit_overlaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  primary_benefit_id UUID NOT NULL REFERENCES public.value_source_benefits(id) ON DELETE RESTRICT,
  overlapping_benefit_id UUID NOT NULL REFERENCES public.value_source_benefits(id) ON DELETE RESTRICT,
  overlap_amount NUMERIC(18,2) NOT NULL CHECK (overlap_amount > 0),
  rationale TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  proposed_by UUID NOT NULL, approved_by UUID, approved_at TIMESTAMPTZ, rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (primary_benefit_id <> overlapping_benefit_id),
  UNIQUE (tenant_id, primary_benefit_id, overlapping_benefit_id)
);

CREATE TABLE IF NOT EXISTS public.value_commercial_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  contract_reference TEXT NOT NULL, currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  service_start_date DATE NOT NULL, implementation_investment NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (implementation_investment >= 0),
  monthly_subscription_value NUMERIC(18,2) NOT NULL CHECK (monthly_subscription_value > 0),
  commercial_evidence TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','SUPERSEDED')),
  created_by UUID NOT NULL, approved_by UUID, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_value_commercial_approved ON public.value_commercial_profiles (tenant_id) WHERE status = 'APPROVED';

CREATE TABLE IF NOT EXISTS public.value_roi_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  period_from DATE NOT NULL, period_to DATE NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED', gross_benefit NUMERIC(18,2) NOT NULL DEFAULT 0,
  overlap_deduction NUMERIC(18,2) NOT NULL DEFAULT 0, net_benefit NUMERIC(18,2) NOT NULL DEFAULT 0,
  subscription_value NUMERIC(18,2) NOT NULL DEFAULT 0, cumulative_client_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  cumulative_net_benefit NUMERIC(18,2) NOT NULL DEFAULT 0, net_value_created NUMERIC(18,2) NOT NULL DEFAULT 0,
  roi_pct NUMERIC(12,3), payback_achieved BOOLEAN NOT NULL DEFAULT FALSE, payback_period_end DATE,
  benefit_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb, statement_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED')),
  generated_by UUID NOT NULL, issued_by UUID, issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period_from, period_to), CHECK (period_from <= period_to)
);

CREATE INDEX IF NOT EXISTS idx_value_source_benefits_status ON public.value_source_benefits (tenant_id, finance_status, source_verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_value_overlaps_status ON public.value_benefit_overlaps (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_value_roi_statements_period ON public.value_roi_statements (tenant_id, period_from DESC);
