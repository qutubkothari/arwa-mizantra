CREATE TABLE IF NOT EXISTS public.production_cost_sheet_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  finished_item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'INR',
  output_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (output_quantity > 0),
  cost_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculated_total_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  calculated_unit_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id),
  updated_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, finished_item_id, template_name)
);

CREATE INDEX IF NOT EXISTS idx_production_cost_sheet_templates_item
  ON public.production_cost_sheet_templates (tenant_id, finished_item_id, is_active);

COMMENT ON TABLE public.production_cost_sheet_templates IS
  'Reusable, tenant-scoped planned production cost sheets with dynamic cost elements and calculation bases.';
