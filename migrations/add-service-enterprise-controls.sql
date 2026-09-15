-- Enterprise service controls: master failure codes, escalations, capacity,
-- contract consumption and repair/RMA traceability. Additive only.

CREATE TABLE IF NOT EXISTS public.service_failure_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  code VARCHAR(40) NOT NULL,
  category VARCHAR(40) NOT NULL,
  description TEXT NOT NULL,
  default_corrective_action TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS public.service_escalations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  escalation_level INTEGER NOT NULL CHECK (escalation_level BETWEEN 1 AND 5),
  reason TEXT NOT NULL,
  owner_user_id UUID,
  due_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','CANCELLED')),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_escalations_ticket
  ON public.service_escalations(tenant_id, service_ticket_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.service_contract_consumption (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  service_contract_id UUID NOT NULL REFERENCES public.service_contracts(id) ON DELETE RESTRICT,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  service_confirmation_id UUID REFERENCES public.service_confirmations(id) ON DELETE RESTRICT,
  visits_used NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (visits_used >= 0),
  labor_hours_used NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (labor_hours_used >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, service_confirmation_id)
);

CREATE INDEX IF NOT EXISTS idx_service_contract_consumption_contract
  ON public.service_contract_consumption(tenant_id, service_contract_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.service_rma_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  rma_number VARCHAR(80) NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  installed_asset_id UUID REFERENCES public.service_installed_assets(id) ON DELETE RESTRICT,
  received_date DATE,
  received_condition TEXT,
  repair_location TEXT,
  disposition VARCHAR(30) NOT NULL DEFAULT 'REPAIR' CHECK (disposition IN ('REPAIR','REPLACE','RETURN_UNREPAIRED','SCRAP')),
  status VARCHAR(30) NOT NULL DEFAULT 'AWAITING_RECEIPT' CHECK (status IN ('AWAITING_RECEIPT','RECEIVED','UNDER_DIAGNOSIS','UNDER_REPAIR','READY_TO_RETURN','RETURNED','CANCELLED')),
  outbound_date DATE,
  courier_reference TEXT,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, rma_number)
);

CREATE INDEX IF NOT EXISTS idx_service_rma_ticket
  ON public.service_rma_orders(tenant_id, service_ticket_id, status, created_at DESC);

ALTER TABLE public.service_confirmations
  ADD COLUMN IF NOT EXISTS failure_code_id UUID REFERENCES public.service_failure_codes(id) ON DELETE RESTRICT;

ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS daily_capacity_hours NUMERIC(6,2) NOT NULL DEFAULT 8 CHECK (daily_capacity_hours > 0 AND daily_capacity_hours <= 24);

COMMENT ON TABLE public.service_failure_codes IS 'Tenant-controlled service failure and diagnosis code catalogue.';
COMMENT ON TABLE public.service_escalations IS 'Controlled service-ticket escalation and resolution trail.';
COMMENT ON TABLE public.service_contract_consumption IS 'Frozen AMC/warranty entitlement usage posted by final service confirmations.';
COMMENT ON TABLE public.service_rma_orders IS 'Customer equipment return, workshop repair, and return-to-customer lifecycle.';
