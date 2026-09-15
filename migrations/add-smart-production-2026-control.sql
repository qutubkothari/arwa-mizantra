-- Mizantra 2026 smart-production control plane. Safe to rerun.

ALTER TABLE public.production_programs
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS frozen_by UUID,
  ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS freeze_horizon_date DATE,
  ADD COLUMN IF NOT EXISTS auto_replan_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS replan_interval_minutes INTEGER NOT NULL DEFAULT 60
    CHECK(replan_interval_minutes BETWEEN 15 AND 10080);

ALTER TABLE public.production_stage_plan_lines
  ADD COLUMN IF NOT EXISTS item_id UUID,
  ADD COLUMN IF NOT EXISTS parent_item_id UUID,
  ADD COLUMN IF NOT EXISTS bom_level INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS yield_pct NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS skill_coverage_pct NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS selected_resource_reason TEXT,
  ADD COLUMN IF NOT EXISTS scenario_code VARCHAR(40) NOT NULL DEFAULT 'BASE';

CREATE TABLE IF NOT EXISTS public.production_item_planning_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, item_id UUID NOT NULL,
  procurement_type VARCHAR(16) NOT NULL DEFAULT 'AUTO' CHECK(procurement_type IN('AUTO','BUY','MAKE','TRANSFER')),
  minimum_order_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK(minimum_order_quantity >= 0),
  order_multiple NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK(order_multiple >= 0),
  pack_size NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK(pack_size >= 0),
  minimum_stock NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK(minimum_stock >= 0),
  maximum_stock NUMERIC(18,4) CHECK(maximum_stock IS NULL OR maximum_stock >= 0),
  shelf_life_days INTEGER CHECK(shelf_life_days IS NULL OR shelf_life_days > 0),
  minimum_remaining_shelf_life_days INTEGER NOT NULL DEFAULT 0 CHECK(minimum_remaining_shelf_life_days >= 0),
  batch_constraint VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK(batch_constraint IN('NONE','SINGLE_BATCH','FEFO','FIFO')),
  alternate_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  substitution_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  safety_stock_method VARCHAR(20) NOT NULL DEFAULT 'PERCENT' CHECK(safety_stock_method IN('PERCENT','FIXED','SERVICE_LEVEL')),
  safety_stock_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,item_id)
);

CREATE TABLE IF NOT EXISTS public.production_routing_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, routing_id UUID NOT NULL,
  required_skill_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_tool_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  minimum_qualified_people INTEGER NOT NULL DEFAULT 0 CHECK(minimum_qualified_people >= 0),
  campaign_code VARCHAR(80), campaign_min_quantity NUMERIC(18,4), campaign_max_quantity NUMERIC(18,4),
  setup_family VARCHAR(80), preferred_resource_id UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,routing_id)
);

CREATE TABLE IF NOT EXISTS public.production_resource_alternatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, routing_id UUID NOT NULL,
  work_station_id UUID NOT NULL, priority INTEGER NOT NULL DEFAULT 100 CHECK(priority > 0),
  efficiency_percent NUMERIC(7,2) NOT NULL DEFAULT 100 CHECK(efficiency_percent > 0),
  additional_setup_minutes NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(additional_setup_minutes >= 0),
  cost_per_hour NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(cost_per_hour >= 0), is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(tenant_id,routing_id,work_station_id)
);

CREATE TABLE IF NOT EXISTS public.production_changeover_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, work_station_id UUID NOT NULL,
  from_setup_family VARCHAR(80) NOT NULL, to_setup_family VARCHAR(80) NOT NULL,
  changeover_minutes NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(changeover_minutes >= 0),
  changeover_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(changeover_cost >= 0),
  UNIQUE(tenant_id,work_station_id,from_setup_family,to_setup_family)
);

CREATE TABLE IF NOT EXISTS public.production_employee_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, employee_id UUID NOT NULL,
  skill_code VARCHAR(80) NOT NULL, proficiency_level INTEGER NOT NULL DEFAULT 1 CHECK(proficiency_level BETWEEN 1 AND 5),
  valid_from DATE, valid_until DATE, active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(tenant_id,employee_id,skill_code)
);

CREATE TABLE IF NOT EXISTS public.production_tool_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, tool_code VARCHAR(80) NOT NULL,
  tool_name TEXT NOT NULL, work_station_id UUID, available_quantity INTEGER NOT NULL DEFAULT 1 CHECK(available_quantity >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','IN_USE','MAINTENANCE','BLOCKED')),
  valid_until DATE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,tool_code,work_station_id)
);

CREATE TABLE IF NOT EXISTS public.production_plan_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES public.production_programs(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.production_planning_runs(id) ON DELETE SET NULL,
  action VARCHAR(24) NOT NULL CHECK(action IN('SUBMITTED','APPROVED','REJECTED','FROZEN','UNFROZEN','REPLAN_QUEUED','REPLAN_COMPLETED')),
  action_by UUID NOT NULL, reason TEXT, evidence_hash CHAR(64), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.production_execution_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES public.production_programs(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.production_planning_runs(id) ON DELETE RESTRICT,
  wave_id UUID NOT NULL REFERENCES public.production_build_waves(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL, bom_id UUID NOT NULL, bom_level INTEGER NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(140) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'PROPOSED'
    CHECK(status IN('PROPOSED','CREATING','DRAFT_CREATED','FAILED')),
  job_order_id UUID, job_order_number VARCHAR(80), created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,idempotency_key), UNIQUE(tenant_id,run_id,wave_id,bom_id)
);

CREATE TABLE IF NOT EXISTS public.production_replan_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES public.production_programs(id) ON DELETE CASCADE,
  source_run_id UUID REFERENCES public.production_planning_runs(id) ON DELETE SET NULL,
  reason VARCHAR(80) NOT NULL, source_state_hash CHAR(64), status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK(status IN('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')),
  requested_by UUID, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
  resulting_run_id UUID REFERENCES public.production_planning_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.production_shift_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES public.production_programs(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.production_planning_runs(id) ON DELETE RESTRICT,
  work_station_id UUID NOT NULL, work_date DATE NOT NULL, shift_code VARCHAR(30) NOT NULL DEFAULT 'APS-DRAFT',
  planned_production_minutes INTEGER NOT NULL CHECK(planned_production_minutes > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','CANCELLED')),
  evidence_hash CHAR(64) NOT NULL, created_by UUID NOT NULL,
  approved_by UUID, approved_at TIMESTAMPTZ, published_shift_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,run_id,work_station_id,work_date)
);

ALTER TABLE public.production_shift_proposals ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE public.production_shift_proposals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.production_shift_proposals ADD COLUMN IF NOT EXISTS published_shift_id UUID;

-- Align legacy station-completion installations with the current MES/OEE services.
ALTER TABLE public.station_completions ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE public.station_completions ADD COLUMN IF NOT EXISTS quantity_rejected NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.station_completions ADD COLUMN IF NOT EXISTS actual_time_minutes NUMERIC(18,2);
ALTER TABLE public.station_completions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE public.station_completions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE public.station_completions AS completion SET tenant_id=production.tenant_id
FROM public.production_orders AS production
WHERE completion.production_order_id=production.id AND completion.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_station_completions_tenant_routing ON public.station_completions(tenant_id,routing_id,end_time DESC);

CREATE INDEX IF NOT EXISTS idx_prod_stage_item ON public.production_stage_plan_lines(run_id,bom_level,item_id);
CREATE INDEX IF NOT EXISTS idx_prod_plan_actions ON public.production_plan_actions(tenant_id,program_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prod_replan_queue ON public.production_replan_queue(tenant_id,status,requested_at);
CREATE INDEX IF NOT EXISTS idx_prod_execution_conversion ON public.production_execution_conversions(tenant_id,program_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prod_shift_proposals ON public.production_shift_proposals(tenant_id,program_id,status,work_date);
