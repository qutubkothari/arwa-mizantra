-- Demand planning and S&OP scenarios from posted sales history.
-- Plans are advisory and never create job orders, requisitions, reservations, or journals.
CREATE TABLE IF NOT EXISTS public.demand_plan_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  cycle_name VARCHAR(160) NOT NULL, history_months INTEGER NOT NULL DEFAULT 12,
  horizon_months INTEGER NOT NULL DEFAULT 6, status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),
  forecast_units NUMERIC(18,3) NOT NULL DEFAULT 0, forecast_revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
  inventory_gap_value NUMERIC(18,2) NOT NULL DEFAULT 0, average_accuracy_pct NUMERIC(7,2),
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), approved_by UUID, approved_at TIMESTAMPTZ,
  approval_evidence TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.demand_plan_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  cycle_id UUID NOT NULL REFERENCES public.demand_plan_cycles(id) ON DELETE CASCADE,
  item_id UUID NOT NULL, item_code VARCHAR(120), item_name VARCHAR(220), demand_pattern VARCHAR(24),
  history_buckets JSONB NOT NULL DEFAULT '[]'::jsonb, statistical_forecast JSONB NOT NULL DEFAULT '[]'::jsonb,
  consensus_forecast JSONB NOT NULL DEFAULT '[]'::jsonb, override_reason TEXT,
  forecast_accuracy_pct NUMERIC(7,2), available_quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  average_unit_value NUMERIC(18,2) NOT NULL DEFAULT 0, inventory_gap_quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  inventory_gap_value NUMERIC(18,2) NOT NULL DEFAULT 0, updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cycle_id,item_id)
);
CREATE TABLE IF NOT EXISTS public.demand_plan_scenarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  cycle_id UUID NOT NULL REFERENCES public.demand_plan_cycles(id) ON DELETE CASCADE,
  scenario_name VARCHAR(160) NOT NULL, demand_change_pct NUMERIC(7,2) NOT NULL DEFAULT 0,
  safety_stock_days INTEGER NOT NULL DEFAULT 0, projected_units NUMERIC(18,3) NOT NULL,
  projected_revenue NUMERIC(18,2) NOT NULL, inventory_gap_quantity NUMERIC(18,3) NOT NULL,
  working_capital_exposure NUMERIC(18,2) NOT NULL, created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demand_cycles_latest ON public.demand_plan_cycles(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demand_lines_cycle ON public.demand_plan_lines(tenant_id,cycle_id,inventory_gap_value DESC);

