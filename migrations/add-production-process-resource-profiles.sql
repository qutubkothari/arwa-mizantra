-- One reusable machine/process definition per product routing and eligible machine.
-- Job orders continue to obtain materials from the approved BOM; these profiles
-- provide the capacity and planned-loss inputs needed by MRP/APS.

CREATE TABLE IF NOT EXISTS public.production_process_resource_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  routing_id UUID NOT NULL REFERENCES public.production_routing(id) ON DELETE CASCADE,
  work_station_id UUID NOT NULL REFERENCES public.work_stations(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority > 0),
  rate_value NUMERIC(18,6) NOT NULL CHECK (rate_value > 0),
  rate_unit VARCHAR(24) NOT NULL CHECK (
    rate_unit IN ('PCS_PER_MINUTE','PCS_PER_HOUR','SHOTS_PER_MINUTE','KG_PER_HOUR')
  ),
  cavities INTEGER NOT NULL DEFAULT 1 CHECK (cavities > 0),
  efficiency_percent NUMERIC(7,2) NOT NULL DEFAULT 100
    CHECK (efficiency_percent > 0 AND efficiency_percent <= 150),
  minimum_length_mm NUMERIC(12,3),
  maximum_length_mm NUMERIC(12,3),
  maximum_material_diameter_mm NUMERIC(12,3),
  input_item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  container_quantity NUMERIC(18,6),
  container_uom VARCHAR(12),
  consumption_per_unit NUMERIC(18,9),
  consumption_uom VARCHAR(12),
  recurring_change_minutes NUMERIC(12,3) NOT NULL DEFAULT 0
    CHECK (recurring_change_minutes >= 0),
  first_load_required BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  updated_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, routing_id, work_station_id),
  CHECK (minimum_length_mm IS NULL OR minimum_length_mm >= 0),
  CHECK (maximum_length_mm IS NULL OR maximum_length_mm >= 0),
  CHECK (
    minimum_length_mm IS NULL OR maximum_length_mm IS NULL OR
    maximum_length_mm >= minimum_length_mm
  ),
  CHECK (maximum_material_diameter_mm IS NULL OR maximum_material_diameter_mm >= 0),
  CHECK (container_quantity IS NULL OR container_quantity > 0),
  CHECK (consumption_per_unit IS NULL OR consumption_per_unit > 0)
);

CREATE INDEX IF NOT EXISTS idx_process_resource_profile_routing
  ON public.production_process_resource_profiles (tenant_id, routing_id, priority);
CREATE INDEX IF NOT EXISTS idx_process_resource_profile_station
  ON public.production_process_resource_profiles (tenant_id, work_station_id);

COMMENT ON TABLE public.production_process_resource_profiles IS
  'Product-operation-machine rates, capability limits and recurring material/container change losses used by production planning.';
