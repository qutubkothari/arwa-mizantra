-- Staged, time-phased production planning. Advisory only: no PR, PO, stock or job-order posting.
CREATE TABLE IF NOT EXISTS public.production_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, program_code VARCHAR(80) NOT NULL,
  program_name TEXT NOT NULL, finished_item_id UUID NOT NULL, target_quantity NUMERIC(18,4) NOT NULL CHECK(target_quantity > 0),
  start_date DATE NOT NULL, due_date DATE NOT NULL, currency_code CHAR(3) NOT NULL DEFAULT 'AED',
  cash_budget NUMERIC(18,2), planning_policy VARCHAR(24) NOT NULL DEFAULT 'BOTTLENECK_PULL'
    CHECK(planning_policy IN('BOTTLENECK_PULL','DUE_DATE','CASH_CONSTRAINED')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PLANNED','APPROVED','RELEASED','CLOSED','CANCELLED')),
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb, created_by UUID NOT NULL, approved_by UUID, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(due_date >= start_date), UNIQUE(tenant_id,program_code)
);
CREATE TABLE IF NOT EXISTS public.production_build_waves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES public.production_programs(id) ON DELETE CASCADE,
  wave_number INTEGER NOT NULL CHECK(wave_number > 0), wave_name TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK(quantity > 0), planned_start DATE, required_by DATE NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 1 AND 100), transfer_batch_quantity NUMERIC(18,4),
  status VARCHAR(20) NOT NULL DEFAULT 'PLANNED' CHECK(status IN('PLANNED','FROZEN','RELEASED','COMPLETED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(program_id,wave_number)
);
CREATE TABLE IF NOT EXISTS public.production_stage_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, routing_id UUID NOT NULL,
  stage_group_code VARCHAR(80), execution_mode VARCHAR(20) NOT NULL DEFAULT 'SEQUENTIAL'
    CHECK(execution_mode IN('SEQUENTIAL','PARALLEL','SYNCHRONIZED')),
  predecessor_routing_ids JSONB NOT NULL DEFAULT '[]'::jsonb, transfer_batch_quantity NUMERIC(18,4),
  buffer_limit_quantity NUMERIC(18,4), queue_minutes INTEGER NOT NULL DEFAULT 0, move_minutes INTEGER NOT NULL DEFAULT 0,
  wait_minutes INTEGER NOT NULL DEFAULT 0, overlap_percent NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK(overlap_percent BETWEEN 0 AND 100),
  efficiency_percent NUMERIC(7,2) NOT NULL DEFAULT 85 CHECK(efficiency_percent > 0 AND efficiency_percent <= 150),
  is_bottleneck BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,routing_id)
);
CREATE TABLE IF NOT EXISTS public.production_planning_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES public.production_programs(id) ON DELETE CASCADE,
  run_number VARCHAR(80) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK(status IN('COMPLETED','FAILED')),
  feasible BOOLEAN NOT NULL DEFAULT FALSE, delivery_confidence_pct NUMERIC(7,2), projected_completion_date DATE,
  bottleneck_station_id UUID, required_overtime_minutes INTEGER NOT NULL DEFAULT 0,
  material_cash_required NUMERIC(18,2) NOT NULL DEFAULT 0, excess_wip_cash_risk NUMERIC(18,2) NOT NULL DEFAULT 0,
  explanation JSONB NOT NULL DEFAULT '{}'::jsonb, evidence_hash CHAR(64) NOT NULL, created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,run_number)
);
CREATE TABLE IF NOT EXISTS public.production_stage_plan_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES public.production_planning_runs(id) ON DELETE CASCADE,
  wave_id UUID NOT NULL REFERENCES public.production_build_waves(id) ON DELETE CASCADE,
  routing_id UUID, bom_id UUID, sequence_no INTEGER NOT NULL, stage_name TEXT NOT NULL, stage_group_code VARCHAR(80),
  execution_mode VARCHAR(20) NOT NULL DEFAULT 'SEQUENTIAL', work_station_id UUID,
  quantity NUMERIC(18,4) NOT NULL, setup_minutes NUMERIC(18,2) NOT NULL DEFAULT 0,
  run_minutes NUMERIC(18,2) NOT NULL DEFAULT 0, queue_move_wait_minutes NUMERIC(18,2) NOT NULL DEFAULT 0,
  required_capacity_minutes NUMERIC(18,2) NOT NULL DEFAULT 0, available_capacity_minutes NUMERIC(18,2) NOT NULL DEFAULT 0,
  planned_start TIMESTAMPTZ, planned_end TIMESTAMPTZ, is_bottleneck BOOLEAN NOT NULL DEFAULT FALSE,
  load_percent NUMERIC(9,2) NOT NULL DEFAULT 0, overtime_minutes NUMERIC(18,2) NOT NULL DEFAULT 0,
  historical_cycle_minutes NUMERIC(18,4), confidence_pct NUMERIC(7,2), recommendation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.production_material_plan_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES public.production_planning_runs(id) ON DELETE CASCADE,
  wave_id UUID NOT NULL REFERENCES public.production_build_waves(id) ON DELETE CASCADE,
  item_id UUID NOT NULL, parent_item_id UUID, bom_level INTEGER NOT NULL DEFAULT 0,
  item_code VARCHAR(120), item_name TEXT, uom VARCHAR(30), required_by DATE NOT NULL, recommended_release_date DATE,
  gross_requirement NUMERIC(18,4) NOT NULL DEFAULT 0, scrap_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  safety_quantity NUMERIC(18,4) NOT NULL DEFAULT 0, available_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  reserved_quantity NUMERIC(18,4) NOT NULL DEFAULT 0, incoming_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  net_requirement NUMERIC(18,4) NOT NULL DEFAULT 0, suggested_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL DEFAULT 0, historical_lead_time_days NUMERIC(9,2), unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  cash_required NUMERIC(18,2) NOT NULL DEFAULT 0, supply_action VARCHAR(24) NOT NULL DEFAULT 'MONITOR'
    CHECK(supply_action IN('MONITOR','RESERVE','BUY_NOW','BUY_LATER','BUILD_NOW','BUILD_LATER','EXPEDITE','DO_NOT_BUY')),
  shortage_risk VARCHAR(12) NOT NULL DEFAULT 'LOW' CHECK(shortage_risk IN('LOW','MEDIUM','HIGH','CRITICAL')),
  pegging JSONB NOT NULL DEFAULT '{}'::jsonb, recommendation TEXT, proposal_status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prod_program_status ON public.production_programs(tenant_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_prod_wave_program ON public.production_build_waves(program_id,wave_number);
CREATE INDEX IF NOT EXISTS idx_prod_plan_latest ON public.production_planning_runs(tenant_id,program_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prod_stage_run ON public.production_stage_plan_lines(run_id,sequence_no);
CREATE INDEX IF NOT EXISTS idx_prod_material_run ON public.production_material_plan_lines(run_id,shortage_risk,required_by);
