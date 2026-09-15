-- Period-end inventory valuation evidence and independent finance certification.
CREATE TABLE IF NOT EXISTS public.inventory_valuation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_code VARCHAR(100) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'AED',
  valuation_method VARCHAR(20) NOT NULL DEFAULT 'FIFO' CHECK (valuation_method IN ('FIFO')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CERTIFIED')),
  opening_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  receipt_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  issue_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  closing_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  posted_receipt_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  posted_issue_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  movement_variance NUMERIC(18,4) NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash VARCHAR(64) NOT NULL,
  prepared_by UUID,
  certified_by UUID,
  certification_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  certified_at TIMESTAMPTZ,
  UNIQUE (tenant_id, run_code),
  CHECK (period_end >= period_start),
  CHECK (certified_by IS NULL OR certified_by IS DISTINCT FROM prepared_by)
);
CREATE INDEX IF NOT EXISTS idx_inventory_valuation_runs_tenant_period
  ON public.inventory_valuation_runs (tenant_id, period_end DESC, created_at DESC);
COMMENT ON TABLE public.inventory_valuation_runs IS
  'Immutable FIFO period snapshot tying operational cost events to finance-controlled source journals.';
