-- Planning-grade MRP controls. Additive and safe: approvals remain advisory and
-- do not create PRs, POs, job orders, reservations, stock or accounting entries.
ALTER TABLE public.mrp_planning_lines
  ADD COLUMN IF NOT EXISTS scheduled_receipt_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safety_stock_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommended_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_by_date DATE,
  ADD COLUMN IF NOT EXISTS release_by_date DATE,
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planning_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exception_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.mrp_planner_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES public.mrp_planning_runs(id) ON DELETE CASCADE,
  line_id UUID NOT NULL REFERENCES public.mrp_planning_lines(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (decision IN ('PENDING','APPROVED','CHANGED','DEFERRED','REJECTED')),
  adjusted_quantity NUMERIC(18,4) CHECK (adjusted_quantity IS NULL OR adjusted_quantity >= 0),
  adjusted_required_by_date DATE,
  preferred_supplier_id UUID,
  preferred_work_centre_id UUID,
  reason TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, line_id)
);

CREATE INDEX IF NOT EXISTS idx_mrp_decisions_run
  ON public.mrp_planner_decisions (tenant_id, run_id, decision);

COMMENT ON TABLE public.mrp_planner_decisions IS
  'Planner review of MRP recommendations; never an operational purchasing, production, stock or accounting posting.';
