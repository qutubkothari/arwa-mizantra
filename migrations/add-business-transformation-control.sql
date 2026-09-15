-- Closed-loop Business Transformation System control layer.
-- Additive only: no operational document, stock movement, approval or journal is created here.
CREATE TABLE IF NOT EXISTS public.transformation_objectives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  objective_code VARCHAR(40) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  perspective VARCHAR(24) NOT NULL
    CHECK (perspective IN ('SALES','CUSTOMER','DELIVERY','PROCUREMENT','INVENTORY','PRODUCTION','QUALITY','FINANCE','PEOPLE','CUSTOM')),
  owner_user_id UUID,
  owner_reference TEXT NOT NULL,
  baseline_value NUMERIC(20,4) NOT NULL,
  target_value NUMERIC(20,4) NOT NULL,
  unit_of_measure VARCHAR(40) NOT NULL,
  improvement_direction VARCHAR(12) NOT NULL
    CHECK (improvement_direction IN ('INCREASE','DECREASE')),
  baseline_period_from DATE NOT NULL,
  baseline_period_to DATE NOT NULL,
  target_date DATE NOT NULL,
  review_frequency VARCHAR(12) NOT NULL DEFAULT 'MONTHLY'
    CHECK (review_frequency IN ('DAILY','WEEKLY','MONTHLY','QUARTERLY')),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','ACTIVE','AT_RISK','ACHIEVED','CLOSED','CANCELLED')),
  baseline_evidence TEXT NOT NULL,
  created_by UUID NOT NULL,
  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  approval_note TEXT,
  closed_by UUID,
  closed_at TIMESTAMPTZ,
  closure_evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, objective_code),
  CHECK (baseline_period_to >= baseline_period_from),
  CHECK (target_date >= baseline_period_to),
  CHECK (baseline_value <> target_value),
  CHECK (
    (improvement_direction = 'INCREASE' AND target_value > baseline_value) OR
    (improvement_direction = 'DECREASE' AND target_value < baseline_value)
  )
);

CREATE TABLE IF NOT EXISTS public.transformation_kpi_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL REFERENCES public.transformation_objectives(id) ON DELETE CASCADE,
  kpi_code VARCHAR(60) NOT NULL,
  kpi_name VARCHAR(180) NOT NULL,
  source_module VARCHAR(40) NOT NULL,
  calculation_method TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  unit_of_measure VARCHAR(40) NOT NULL,
  improvement_direction VARCHAR(12) NOT NULL
    CHECK (improvement_direction IN ('INCREASE','DECREASE')),
  warning_threshold NUMERIC(20,4),
  critical_threshold NUMERIC(20,4),
  owner_reference TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, kpi_code)
);

CREATE TABLE IF NOT EXISTS public.transformation_kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kpi_id UUID NOT NULL REFERENCES public.transformation_kpi_definitions(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  actual_value NUMERIC(20,4) NOT NULL,
  target_value NUMERIC(20,4) NOT NULL,
  baseline_value NUMERIC(20,4) NOT NULL,
  evidence_reference TEXT NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot_hash VARCHAR(64) NOT NULL,
  captured_by UUID NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, kpi_id, period_from, period_to),
  CHECK (period_to >= period_from)
);

ALTER TABLE public.value_realization_initiatives
  ADD COLUMN IF NOT EXISTS transformation_objective_id UUID REFERENCES public.transformation_objectives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_kpi_id UUID REFERENCES public.transformation_kpi_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_metric_value NUMERIC(20,4),
  ADD COLUMN IF NOT EXISTS expected_direction VARCHAR(12)
    CHECK (expected_direction IS NULL OR expected_direction IN ('INCREASE','DECREASE'));

CREATE TABLE IF NOT EXISTS public.transformation_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL REFERENCES public.transformation_objectives(id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES public.value_realization_initiatives(id) ON DELETE SET NULL,
  exception_id UUID REFERENCES public.mizantra_exception_register(id) ON DELETE SET NULL,
  governed_action_request_id UUID REFERENCES public.mizantra_governed_action_requests(id) ON DELETE SET NULL,
  action_code VARCHAR(50) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  owner_user_id UUID,
  owner_reference TEXT NOT NULL,
  priority VARCHAR(12) NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  due_date DATE NOT NULL,
  expected_operational_impact TEXT NOT NULL,
  expected_benefit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (expected_benefit >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED','ACCEPTED','IN_PROGRESS','COMPLETED','VERIFIED','REJECTED','CANCELLED')),
  created_by UUID NOT NULL,
  accepted_by UUID,
  accepted_at TIMESTAMPTZ,
  completed_by UUID,
  completed_at TIMESTAMPTZ,
  completion_evidence TEXT,
  outcome_value NUMERIC(20,4),
  operational_benefit NUMERIC(18,2) CHECK (operational_benefit IS NULL OR operational_benefit >= 0),
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  verification_evidence TEXT,
  verifier_note TEXT,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  finance_claim_id UUID REFERENCES public.value_realization_claims(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, action_code)
);

CREATE INDEX IF NOT EXISTS idx_transformation_objectives_tenant_status
  ON public.transformation_objectives (tenant_id, status, target_date);
CREATE INDEX IF NOT EXISTS idx_transformation_kpis_objective
  ON public.transformation_kpi_definitions (tenant_id, objective_id, is_active);
CREATE INDEX IF NOT EXISTS idx_transformation_snapshots_kpi
  ON public.transformation_kpi_snapshots (tenant_id, kpi_id, period_to DESC);
CREATE INDEX IF NOT EXISTS idx_transformation_actions_queue
  ON public.transformation_actions (tenant_id, status, priority, due_date);
CREATE INDEX IF NOT EXISTS idx_value_initiatives_transformation_objective
  ON public.value_realization_initiatives (tenant_id, transformation_objective_id, status);

COMMENT ON TABLE public.transformation_objectives IS
  'Approved business outcomes with baseline, target, owner and review cadence.';
COMMENT ON TABLE public.transformation_kpi_snapshots IS
  'Immutable, evidence-linked KPI actuals; never an operational or accounting posting.';
COMMENT ON TABLE public.transformation_actions IS
  'Closed-loop corrective actions whose operational outcome requires independent verification; financial value remains subject to the value-realization finance workflow.';

INSERT INTO public.app_feature_catalogue
  (feature_key, feature_name, module_name, description, screen_route, route_match, api_prefixes, display_order)
VALUES
  ('business-transformation','Business Transformation','Reports','Objectives, KPI baselines, initiatives, corrective actions and verified business outcomes.','/dashboard/transformation','PREFIX',ARRAY['/transformation'],25)
ON CONFLICT (feature_key) DO UPDATE SET
  feature_name = EXCLUDED.feature_name,
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  screen_route = EXCLUDED.screen_route,
  route_match = EXCLUDED.route_match,
  api_prefixes = EXCLUDED.api_prefixes,
  display_order = EXCLUDED.display_order,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO public.tenant_feature_entitlements (tenant_id, feature_key, is_enabled)
SELECT tenant.id, 'business-transformation', TRUE
FROM public.tenants tenant
ON CONFLICT (tenant_id, feature_key) DO NOTHING;
