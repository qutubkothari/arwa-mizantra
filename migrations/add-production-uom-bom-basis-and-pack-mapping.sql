-- Governed production UOM conversions, BOM output basis, and industry-pack mapping.
-- Additive and safe to rerun. No operational production, stock, or finance rows are created.

CREATE TABLE IF NOT EXISTS public.production_uom_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.items(id) ON DELETE CASCADE,
  from_uom VARCHAR(20) NOT NULL,
  to_uom VARCHAR(20) NOT NULL,
  factor NUMERIC(24,10) NOT NULL CHECK (factor > 0),
  rounding_mode VARCHAR(16) NOT NULL DEFAULT 'HALF_UP'
    CHECK (rounding_mode IN ('NONE','UP','DOWN','HALF_UP')),
  decimal_places INTEGER NOT NULL DEFAULT 4 CHECK (decimal_places BETWEEN 0 AND 8),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT','SUBMITTED','APPROVED','RETIRED')),
  effective_from DATE,
  effective_to DATE,
  created_by UUID REFERENCES public.users(id),
  approved_by UUID REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, item_id, from_uom, to_uom, version),
  CHECK (from_uom <> to_uom),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_production_uom_conversion_effective
  ON public.production_uom_conversions
  (tenant_id, item_id, from_uom, to_uom, lifecycle_status, effective_from, effective_to);

ALTER TABLE public.bom_headers
  ADD COLUMN IF NOT EXISTS output_quantity NUMERIC(18,6) NOT NULL DEFAULT 1
    CHECK (output_quantity > 0),
  ADD COLUMN IF NOT EXISTS output_uom VARCHAR(20),
  ADD COLUMN IF NOT EXISTS source_pack_code VARCHAR(80);

ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS consumption_uom VARCHAR(20),
  ADD COLUMN IF NOT EXISTS quantity_basis VARCHAR(20) NOT NULL DEFAULT 'PER_OUTPUT'
    CHECK (quantity_basis IN ('PER_OUTPUT','PER_BATCH','FIXED_SETUP','FORMULA')),
  ADD COLUMN IF NOT EXISTS rounding_rule VARCHAR(16) NOT NULL DEFAULT 'NONE'
    CHECK (rounding_rule IN ('NONE','UP','DOWN','HALF_UP'));

CREATE TABLE IF NOT EXISTS public.production_configuration_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pack_code VARCHAR(80) NOT NULL,
  pack_version INTEGER NOT NULL DEFAULT 1,
  finished_item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES public.bom_headers(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','VALIDATED','APPLIED','RETIRED')),
  mapping_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id),
  updated_by UUID REFERENCES public.users(id),
  applied_by UUID REFERENCES public.users(id),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, pack_code, finished_item_id, bom_id)
);

CREATE INDEX IF NOT EXISTS idx_production_configuration_mappings
  ON public.production_configuration_mappings (tenant_id, pack_code, status, updated_at DESC);

COMMENT ON TABLE public.production_uom_conversions IS
  'Revision-controlled item-specific or generic production UOM conversions. Only approved effective rows may drive transactions.';
COMMENT ON COLUMN public.bom_headers.output_quantity IS
  'Finished quantity represented by the component quantities on this BOM revision.';
COMMENT ON COLUMN public.bom_items.quantity_basis IS
  'How the BOM line quantity scales: per BOM output, per run/batch, fixed setup, or governed formula.';
COMMENT ON TABLE public.production_configuration_mappings IS
  'Auditable draft mapping of an industry configuration pack to a real item, BOM, work centres, QC, costing and planning parameters.';

NOTIFY pgrst, 'reload schema';
