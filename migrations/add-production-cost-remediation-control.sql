-- Governed remediation queue for production-cost readiness exceptions.
-- This table tracks ownership and evidence only; it never changes item costs,
-- routings, job orders, inventory valuation or accounting records.
CREATE TABLE IF NOT EXISTS public.production_cost_remediation_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES public.production_job_orders(id) ON DELETE CASCADE,
  exception_code VARCHAR(60) NOT NULL,
  title VARCHAR(240) NOT NULL,
  recommended_action TEXT NOT NULL,
  target_route VARCHAR(240),
  severity VARCHAR(12) NOT NULL DEFAULT 'MEDIUM'
    CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','DISMISSED')),
  assigned_to UUID,
  due_date DATE,
  owner_note TEXT,
  resolution_evidence TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, job_order_id, exception_code)
);

CREATE INDEX IF NOT EXISTS idx_production_cost_remediation_worklist
  ON public.production_cost_remediation_actions (tenant_id, status, severity, due_date);

COMMENT ON TABLE public.production_cost_remediation_actions IS
  'Owner-assigned remediation evidence for manufacturing-cost readiness; no master, operational or accounting record is changed automatically.';
