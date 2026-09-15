-- Transportation control tower over existing dispatch/POD records.
CREATE TABLE IF NOT EXISTS public.transport_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  shipment_number VARCHAR(40) NOT NULL, dispatch_note_id UUID NOT NULL REFERENCES public.dispatch_notes(id) ON DELETE RESTRICT,
  carrier_name VARCHAR(200) NOT NULL, service_level VARCHAR(40) NOT NULL DEFAULT 'STANDARD', tracking_reference VARCHAR(120),
  planned_delivery_date DATE NOT NULL, actual_delivery_date DATE,
  baseline_freight NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (baseline_freight >= 0),
  quoted_freight NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (quoted_freight >= 0),
  actual_freight NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (actual_freight >= 0),
  proof_reference TEXT, status VARCHAR(20) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_TRANSIT','DELIVERED','CLAIM_OPEN','CLOSED','CANCELLED')),
  created_by UUID NOT NULL, started_by UUID, delivered_by UUID,
  started_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, shipment_number), UNIQUE (tenant_id, dispatch_note_id)
);
CREATE TABLE IF NOT EXISTS public.transport_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  shipment_id UUID NOT NULL REFERENCES public.transport_shipments(id) ON DELETE CASCADE,
  exception_type VARCHAR(24) NOT NULL CHECK (exception_type IN ('DELAY','DAMAGE','LOSS','DEMURRAGE','OVERCHARGE','OTHER')),
  description TEXT NOT NULL, evidence_reference TEXT NOT NULL,
  cost_impact NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cost_impact >= 0),
  claim_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (claim_amount >= 0),
  recovered_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SUBMITTED','RECOVERED','REJECTED')),
  recovery_evidence TEXT, created_by UUID NOT NULL, submitted_by UUID, verified_by UUID,
  submitted_at TIMESTAMPTZ, recovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transport_shipments_tenant_status ON public.transport_shipments (tenant_id, status, planned_delivery_date);
CREATE INDEX IF NOT EXISTS idx_transport_exceptions_shipment ON public.transport_exceptions (tenant_id, shipment_id, status);
