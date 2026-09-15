-- Order-level subcontract quantity and service-cost reconciliation.
CREATE TABLE IF NOT EXISTS public.subcontract_reconciliations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE RESTRICT,
  issued_input_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  consumed_input_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  scrap_input_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  returned_input_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  approved_loss_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  vendor_balance_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  input_reconciliation_variance NUMERIC(18,4) NOT NULL DEFAULT 0,
  standard_output_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  actual_accepted_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  actual_rejected_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  yield_variance_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  standard_service_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_service_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  service_cost_variance NUMERIC(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','RECONCILED','EXCEPTION')),
  calculated_by UUID,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_subcontract_reconciliation_status
  ON public.subcontract_reconciliations (tenant_id, status, calculated_at DESC);

COMMENT ON TABLE public.subcontract_reconciliations IS
  'System-calculated subcontract input, yield and service-cost variance from MOC, QC-approved GRNs and service-order rates.';
