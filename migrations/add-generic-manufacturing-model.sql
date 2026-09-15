-- Versioned, tenant-isolated production definitions. Product examples are data, never code.
CREATE TABLE IF NOT EXISTS public.production_manufacturing_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_code VARCHAR(80) NOT NULL,
  model_name TEXT NOT NULL,
  finished_item_id UUID NOT NULL REFERENCES public.items(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  -- Configuration contains product attributes, a directed stage graph, resource options,
  -- capability rules, unit/cycle/weight rate formulas, batching and sourcing alternatives.
  configuration JSONB NOT NULL DEFAULT '{"attributes":{},"stages":[]}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES public.users(id),
  approved_by UUID REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, model_code, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_active_model_per_item
  ON public.production_manufacturing_models(tenant_id, finished_item_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_production_models_tenant_status
  ON public.production_manufacturing_models(tenant_id, status, model_code);

ALTER TABLE public.production_programs
  ADD COLUMN IF NOT EXISTS manufacturing_model_id UUID
    REFERENCES public.production_manufacturing_models(id),
  ADD COLUMN IF NOT EXISTS planning_mode VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
    CHECK (planning_mode IN ('MANUAL','AUTO'));

COMMENT ON TABLE public.production_manufacturing_models IS
  'Reusable versioned manufacturing definitions; one engine supports arbitrary products, routings, machines and sourcing scenarios.';
