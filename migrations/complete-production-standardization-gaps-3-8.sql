-- Reusable production standardization controls for product specifications,
-- formulas, operation material staging, costing, project delivery and
-- approved specialist engineering results. Safe to rerun.

CREATE TABLE IF NOT EXISTS public.production_attribute_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  family_code VARCHAR(80) NOT NULL,
  attribute_code VARCHAR(80) NOT NULL,
  attribute_name VARCHAR(160) NOT NULL,
  data_type VARCHAR(20) NOT NULL CHECK (data_type IN ('NUMBER','TEXT','OPTION','BOOLEAN','DATE','MEASUREMENT')),
  unit_code VARCHAR(20), required BOOLEAN NOT NULL DEFAULT FALSE,
  default_value JSONB, allowed_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  minimum_value NUMERIC, maximum_value NUMERIC,
  identity_sequence INTEGER, is_searchable BOOLEAN NOT NULL DEFAULT TRUE,
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','APPROVED','RETIRED')),
  effective_from DATE, effective_to DATE, created_by UUID REFERENCES public.users(id),
  approved_by UUID REFERENCES public.users(id), approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,family_code,attribute_code)
);
CREATE INDEX IF NOT EXISTS idx_prod_attributes_family ON public.production_attribute_definitions(tenant_id,family_code,lifecycle_status);

CREATE TABLE IF NOT EXISTS public.production_item_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE, family_code VARCHAR(80) NOT NULL,
  specification_values JSONB NOT NULL DEFAULT '{}'::jsonb, variant_identity VARCHAR(240), version INTEGER NOT NULL DEFAULT 1,
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','SUBMITTED','APPROVED','RETIRED')),
  effective_from DATE, effective_to DATE, created_by UUID REFERENCES public.users(id), approved_by UUID REFERENCES public.users(id),
  approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,item_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_active_item_spec ON public.production_item_specifications(tenant_id,item_id)
  WHERE lifecycle_status='APPROVED' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_prod_spec_values ON public.production_item_specifications USING gin(specification_values);

CREATE TABLE IF NOT EXISTS public.production_formula_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  formula_code VARCHAR(80) NOT NULL, formula_name VARCHAR(180) NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  expression TEXT NOT NULL, input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_target VARCHAR(30) NOT NULL CHECK (output_target IN ('BOM_QUANTITY','SCRAP_PERCENT','YIELD_PERCENT','OPERATION_TIME','COST_DRIVER')),
  output_uom VARCHAR(20), rounding_mode VARCHAR(12) NOT NULL DEFAULT 'HALF_UP' CHECK (rounding_mode IN ('HALF_UP','UP','DOWN')),
  decimal_places INTEGER NOT NULL DEFAULT 4 CHECK (decimal_places BETWEEN 0 AND 8),
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','SUBMITTED','APPROVED','RETIRED')),
  effective_from DATE, effective_to DATE, created_by UUID REFERENCES public.users(id), approved_by UUID REFERENCES public.users(id),
  approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,formula_code,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_active_formula ON public.production_formula_definitions(tenant_id,formula_code)
  WHERE lifecycle_status='APPROVED' AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS public.production_formula_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  formula_id UUID NOT NULL REFERENCES public.production_formula_definitions(id) ON DELETE CASCADE,
  case_name VARCHAR(160) NOT NULL, input_values JSONB NOT NULL, expected_result NUMERIC NOT NULL,
  tolerance NUMERIC NOT NULL DEFAULT 0, last_result NUMERIC, last_passed BOOLEAN, last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.production_formula_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  formula_id UUID NOT NULL REFERENCES public.production_formula_definitions(id) ON DELETE RESTRICT,
  item_id UUID REFERENCES public.items(id), job_order_id UUID REFERENCES public.production_job_orders(id),
  source_type VARCHAR(30), source_id UUID, input_values JSONB NOT NULL, raw_result NUMERIC NOT NULL,
  rounded_result NUMERIC NOT NULL, calculation_trace JSONB NOT NULL, evaluated_by UUID REFERENCES public.users(id),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS route_operation_id UUID REFERENCES public.production_routing(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issue_method VARCHAR(24) NOT NULL DEFAULT 'MANUAL'
    CHECK (issue_method IN ('MANUAL','PRE_STAGE','BACKFLUSH','SUBCONTRACT_OUTWARD')),
  ADD COLUMN IF NOT EXISTS input_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity_formula_id UUID REFERENCES public.production_formula_definitions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bom_items_operation ON public.bom_items(route_operation_id,issue_method);

ALTER TABLE public.job_order_materials
  ADD COLUMN IF NOT EXISTS route_operation_id UUID REFERENCES public.production_routing(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issue_method VARCHAR(24) NOT NULL DEFAULT 'MANUAL'
    CHECK (issue_method IN ('MANUAL','PRE_STAGE','BACKFLUSH','SUBCONTRACT_OUTWARD')),
  ADD COLUMN IF NOT EXISTS input_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.production_job_cost_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES public.production_job_orders(id) ON DELETE RESTRICT,
  statement_version INTEGER NOT NULL DEFAULT 1, currency_code VARCHAR(3) NOT NULL DEFAULT 'INR',
  planned_cost JSONB NOT NULL DEFAULT '{}'::jsonb, actual_cost JSONB NOT NULL DEFAULT '{}'::jsonb,
  variance JSONB NOT NULL DEFAULT '{}'::jsonb, evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  good_quantity NUMERIC NOT NULL DEFAULT 0, planned_total NUMERIC NOT NULL DEFAULT 0,
  actual_total NUMERIC NOT NULL DEFAULT 0, actual_cost_per_good_unit NUMERIC,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEWED','CERTIFIED')),
  created_by UUID REFERENCES public.users(id), reviewed_by UUID REFERENCES public.users(id), certified_by UUID REFERENCES public.users(id),
  reviewed_at TIMESTAMPTZ, certified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,job_order_id,statement_version)
);

CREATE TABLE IF NOT EXISTS public.project_delivery_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  work_package_line_id UUID REFERENCES public.project_work_package_lines(id) ON DELETE SET NULL,
  job_order_id UUID REFERENCES public.production_job_orders(id) ON DELETE SET NULL,
  dispatch_note_id UUID REFERENCES public.dispatch_notes(id) ON DELETE SET NULL,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  accepted_quantity NUMERIC NOT NULL DEFAULT 0, allocated_quantity NUMERIC NOT NULL CHECK (allocated_quantity > 0),
  dispatched_quantity NUMERIC NOT NULL DEFAULT 0, delivered_quantity NUMERIC NOT NULL DEFAULT 0,
  pod_url TEXT, site_reference TEXT, package_reference TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ALLOCATED' CHECK (status IN ('ALLOCATED','PACKED','DISPATCHED','DELIVERED','CANCELLED')),
  created_by UUID REFERENCES public.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_delivery_thread ON public.project_delivery_allocations(tenant_id,project_id,work_package_line_id,status);

CREATE TABLE IF NOT EXISTS public.production_engineering_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  result_number VARCHAR(80) NOT NULL, result_type VARCHAR(30) NOT NULL CHECK (result_type IN ('NESTING','CAD','CAM','CUT_LIST','ENGINEERING_CALCULATION')),
  version INTEGER NOT NULL DEFAULT 1, project_id UUID REFERENCES public.projects(id),
  work_package_id UUID REFERENCES public.project_work_packages(id), bom_id UUID REFERENCES public.bom_headers(id),
  route_operation_id UUID REFERENCES public.production_routing(id), source_file_url TEXT NOT NULL,
  source_file_name TEXT, source_checksum VARCHAR(128), source_system VARCHAR(80),
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb, output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','SUBMITTED','APPROVED','RETIRED','REJECTED')),
  created_by UUID REFERENCES public.users(id), approved_by UUID REFERENCES public.users(id), approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,result_number,version)
);
CREATE TABLE IF NOT EXISTS public.production_engineering_result_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  result_id UUID NOT NULL REFERENCES public.production_engineering_results(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.items(id), material_code VARCHAR(120), source_size JSONB NOT NULL DEFAULT '{}'::jsonb,
  developed_quantity NUMERIC NOT NULL DEFAULT 0, planned_usage NUMERIC NOT NULL DEFAULT 0,
  expected_output NUMERIC NOT NULL DEFAULT 0, expected_scrap NUMERIC NOT NULL DEFAULT 0,
  uom VARCHAR(20) NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.production_job_orders
  ADD COLUMN IF NOT EXISTS engineering_result_id UUID REFERENCES public.production_engineering_results(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.prevent_approved_production_definition_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.lifecycle_status='APPROVED' AND NEW.lifecycle_status='RETIRED' THEN
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_status IN ('APPROVED','RETIRED') THEN
    RAISE EXCEPTION 'Approved production definitions are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_formula_definition_immutable ON public.production_formula_definitions;
CREATE TRIGGER trg_formula_definition_immutable BEFORE UPDATE OR DELETE ON public.production_formula_definitions
FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_production_definition_mutation();
DROP TRIGGER IF EXISTS trg_engineering_result_immutable ON public.production_engineering_results;
CREATE TRIGGER trg_engineering_result_immutable BEFORE UPDATE OR DELETE ON public.production_engineering_results
FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_production_definition_mutation();

CREATE OR REPLACE FUNCTION public.freeze_job_order_engineering_result()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_result public.production_engineering_results%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND OLD.definition_frozen_at IS NOT NULL
     AND NEW.engineering_result_id IS DISTINCT FROM OLD.engineering_result_id THEN
    RAISE EXCEPTION 'Released job engineering result is frozen and cannot be changed';
  END IF;
  IF UPPER(COALESCE(NEW.status::text,'DRAFT')) NOT IN ('SCHEDULED','IN_PROGRESS','STORE_ISSUED')
     OR NEW.engineering_result_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_result FROM public.production_engineering_results
  WHERE tenant_id=NEW.tenant_id AND id=NEW.engineering_result_id AND lifecycle_status='APPROVED';
  IF v_result.id IS NULL THEN RAISE EXCEPTION 'Approved engineering/nesting result is required before job release'; END IF;
  NEW.engineering_snapshot := COALESCE(NEW.engineering_snapshot,'{}'::jsonb) || jsonb_build_object(
    'engineering_result',jsonb_build_object('id',v_result.id,'number',v_result.result_number,
      'version',v_result.version,'type',v_result.result_type,'source_file_url',v_result.source_file_url,
      'source_checksum',v_result.source_checksum,'approved_at',v_result.approved_at));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_freeze_job_order_engineering_result ON public.production_job_orders;
CREATE TRIGGER trg_freeze_job_order_engineering_result
BEFORE INSERT OR UPDATE OF status,engineering_result_id ON public.production_job_orders
FOR EACH ROW EXECUTE FUNCTION public.freeze_job_order_engineering_result();

NOTIFY pgrst, 'reload schema';
