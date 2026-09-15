-- CFO-grade Value Graph: financially provable, durable and country-aware ROI.
CREATE TABLE IF NOT EXISTS public.value_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  baseline_key TEXT NOT NULL, title TEXT NOT NULL, metric_type VARCHAR(40) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'AED', currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  period_from DATE NOT NULL, period_to DATE NOT NULL, baseline_value NUMERIC(18,4) NOT NULL,
  volume_value NUMERIC(18,4), normalization_method VARCHAR(40) NOT NULL DEFAULT 'NONE',
  seasonality_factor NUMERIC(12,6) NOT NULL DEFAULT 1, fx_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  inflation_factor NUMERIC(12,6) NOT NULL DEFAULT 1, comparison_basis TEXT NOT NULL,
  evidence_reference TEXT NOT NULL, version_no INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED')),
  created_by UUID NOT NULL, approved_by UUID, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, baseline_key, version_no), CHECK (period_from <= period_to)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_value_baseline_approved ON public.value_baselines (tenant_id, baseline_key) WHERE status = 'APPROVED';

CREATE TABLE IF NOT EXISTS public.value_proof_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  benefit_id UUID NOT NULL REFERENCES public.value_source_benefits(id) ON DELETE CASCADE,
  proof_type VARCHAR(30) NOT NULL CHECK (proof_type IN ('BANK_TRANSACTION','JOURNAL','SETTLEMENT','PAYMENT_RUN','INVENTORY_MOVEMENT','PAYROLL','EXTERNAL_EVIDENCE')),
  proof_table VARCHAR(100) NOT NULL, proof_record_id UUID, proof_reference TEXT NOT NULL,
  expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0, proven_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED', proof_date DATE, match_method VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  confidence_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (confidence_pct BETWEEN 0 AND 100),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','MATCHED','PARTIAL','MISMATCH','EXCLUDED')),
  match_details JSONB NOT NULL DEFAULT '{}'::jsonb, linked_by UUID, linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID, reviewed_at TIMESTAMPTZ, review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, benefit_id, proof_type, proof_reference)
);
CREATE INDEX IF NOT EXISTS idx_value_proof_links_benefit ON public.value_proof_links (tenant_id, benefit_id, status);

CREATE TABLE IF NOT EXISTS public.value_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  from_type VARCHAR(40) NOT NULL, from_id UUID NOT NULL, to_type VARCHAR(40) NOT NULL, to_id UUID NOT NULL,
  relationship_type VARCHAR(40) NOT NULL CHECK (relationship_type IN ('CAUSES','REALIZES','PROVES','ATTRIBUTES_TO','DUPLICATES','CONTRIBUTES_TO')),
  allocation_pct NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  rationale TEXT NOT NULL, confidence_pct NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (confidence_pct BETWEEN 0 AND 100),
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  created_by UUID NOT NULL, approved_by UUID, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, from_type, from_id, to_type, to_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS public.value_benefit_cadence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  benefit_id UUID NOT NULL REFERENCES public.value_source_benefits(id) ON DELETE CASCADE,
  owner_id UUID, review_frequency_days INTEGER NOT NULL DEFAULT 30 CHECK (review_frequency_days BETWEEN 7 AND 365),
  next_review_date DATE NOT NULL, expiry_date DATE, last_confirmed_date DATE,
  realized_to_date NUMERIC(18,2) NOT NULL DEFAULT 0, forecast_to_date NUMERIC(18,2) NOT NULL DEFAULT 0,
  durability_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (durability_status IN ('PENDING','SUSTAINED','TAPERING','REVERSED','EXPIRED')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','CLOSED')),
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, benefit_id)
);

CREATE TABLE IF NOT EXISTS public.value_commercial_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  commercial_profile_id UUID REFERENCES public.value_commercial_profiles(id) ON DELETE CASCADE,
  cost_type VARCHAR(30) NOT NULL CHECK (cost_type IN ('IMPLEMENTATION','SUBSCRIPTION','INTEGRATION','INTERNAL_LABOUR','PARTNER','CREDIT','OTHER')),
  title TEXT NOT NULL, amount NUMERIC(18,2) NOT NULL, currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  effective_from DATE NOT NULL, effective_to DATE, recurring_frequency VARCHAR(20) NOT NULL DEFAULT 'ONE_TIME' CHECK (recurring_frequency IN ('ONE_TIME','MONTHLY','ANNUAL')),
  evidence_reference TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','CANCELLED')),
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.value_country_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL UNIQUE,
  market VARCHAR(10) NOT NULL CHECK (market IN ('UAE','INDIA','GLOBAL')), currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  benchmarking_consent BOOLEAN NOT NULL DEFAULT FALSE, benchmark_segment TEXT, client_display_name TEXT,
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS cash_benefit NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS accounting_benefit NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS risk_benefit NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS proof_matched_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS proof_mismatch_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS client_narrative TEXT;
ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS client_approved_by UUID;
ALTER TABLE public.value_roi_statements ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMPTZ;
