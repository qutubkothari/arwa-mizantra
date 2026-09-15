-- Governed, revision-controlled quality inspection plans.
-- Additive only: existing inspections remain valid and are not reclassified.
CREATE TABLE IF NOT EXISTS public.quality_inspection_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_code VARCHAR(50) NOT NULL,
  plan_name VARCHAR(180) NOT NULL,
  inspection_type VARCHAR(20) NOT NULL
    CHECK (inspection_type IN ('INCOMING','IN_PROCESS','FINAL')),
  item_id UUID REFERENCES public.items(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  sampling_method VARCHAR(24) NOT NULL DEFAULT 'FIXED'
    CHECK (sampling_method IN ('FIXED','PERCENTAGE','FULL','AQL')),
  sample_size NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (sample_size > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  approval_note TEXT,
  created_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  retired_by UUID,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, plan_code, revision),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS public.quality_inspection_plan_parameters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.quality_inspection_plans(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  parameter_name VARCHAR(180) NOT NULL,
  data_type VARCHAR(16) NOT NULL DEFAULT 'NUMERIC'
    CHECK (data_type IN ('NUMERIC','TEXT','PASS_FAIL')),
  specification TEXT NOT NULL,
  unit_of_measure VARCHAR(40),
  tolerance_min NUMERIC(18,6),
  tolerance_max NUMERIC(18,6),
  criticality VARCHAR(16) NOT NULL DEFAULT 'MAJOR'
    CHECK (criticality IN ('MINOR','MAJOR','CRITICAL')),
  is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, plan_id, sequence_number),
  CHECK (tolerance_min IS NULL OR tolerance_max IS NULL OR tolerance_max >= tolerance_min)
);

ALTER TABLE public.quality_inspections
  ADD COLUMN IF NOT EXISTS inspection_plan_id UUID REFERENCES public.quality_inspection_plans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inspection_plan_revision INTEGER,
  ADD COLUMN IF NOT EXISTS inspection_plan_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_quality_plans_effective
  ON public.quality_inspection_plans (tenant_id, inspection_type, item_id, status, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_quality_plan_parameters
  ON public.quality_inspection_plan_parameters (tenant_id, plan_id, sequence_number);

COMMENT ON TABLE public.quality_inspection_plans IS
  'Approved, effective-dated inspection-plan revisions. Approval freezes the revision; changes require a new revision.';
COMMENT ON COLUMN public.quality_inspections.inspection_plan_snapshot IS
  'Immutable plan and parameter evidence captured when an inspection is created.';

INSERT INTO public.app_feature_catalogue
  (feature_key, feature_name, module_name, description, screen_route, route_match, api_prefixes, display_order)
VALUES
  ('quality-inspection-plans','Inspection Plans','Quality','Revision-controlled incoming, in-process and final inspection plans.','/dashboard/quality/inspection-plans','PREFIX',ARRAY['/quality/plans'],1005)
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
SELECT id, 'quality-inspection-plans', TRUE FROM public.tenants
ON CONFLICT (tenant_id, feature_key) DO NOTHING;
