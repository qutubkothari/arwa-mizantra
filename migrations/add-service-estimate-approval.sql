-- Chargeable service estimate and customer-approval workflow.
-- Additive and safe for existing tickets: legacy rows remain NOT_REQUIRED.

CREATE TABLE IF NOT EXISTS service_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  estimate_number VARCHAR(50) NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES service_tickets(id) ON DELETE RESTRICT,
  revision_no INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL',
  estimate_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_percentage NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  terms_and_conditions TEXT,
  customer_comments TEXT,
  approval_reference VARCHAR(255),
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  rejected_at TIMESTAMPTZ,
  rejected_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_estimates_status_check CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','SUPERSEDED','CANCELLED')),
  CONSTRAINT service_estimates_tax_check CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
  CONSTRAINT service_estimates_amount_check CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0),
  UNIQUE (tenant_id, estimate_number)
);

CREATE TABLE IF NOT EXISTS service_estimate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES service_estimates(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL,
  uom VARCHAR(30) NOT NULL DEFAULT 'NOS',
  unit_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  line_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_estimate_items_qty_check CHECK (quantity > 0),
  CONSTRAINT service_estimate_items_discount_check CHECK (discount_percent >= 0 AND discount_percent <= 100),
  UNIQUE (estimate_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_service_estimates_ticket ON service_estimates(service_ticket_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_service_estimates_tenant_status ON service_estimates(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_service_estimate_items_estimate ON service_estimate_items(estimate_id, line_no);

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS commercial_approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commercial_approval_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS approved_estimate_id UUID REFERENCES service_estimates(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'service_document_sequences') THEN
    INSERT INTO service_document_sequences (document_type, last_number)
    VALUES ('SERVICE_ESTIMATE', 0)
    ON CONFLICT (document_type) DO NOTHING;
  END IF;
END $$;

-- The atomic allocator predates estimates. Recreate it here so an environment
-- that applies this migration can allocate estimate numbers immediately.
CREATE OR REPLACE FUNCTION public.next_service_document_number(p_document_type TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number BIGINT;
BEGIN
  IF p_document_type NOT IN (
    'SERVICE_TICKET',
    'TECHNICIAN',
    'INSTALLED_ASSET',
    'SERVICE_CONTRACT',
    'SERVICE_CONFIRMATION',
    'SERVICE_ESTIMATE',
    'SERVICE_INVOICE',
    'SERVICE_RECEIPT'
  ) THEN
    RAISE EXCEPTION 'Unsupported service document type: %', p_document_type;
  END IF;

  INSERT INTO public.service_document_sequences(document_type, last_number)
  VALUES (p_document_type, 1)
  ON CONFLICT (document_type) DO UPDATE
    SET last_number = public.service_document_sequences.last_number + 1,
        updated_at = NOW()
  RETURNING last_number INTO v_number;

  RETURN v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.next_service_document_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_service_document_number(TEXT) TO service_role;
