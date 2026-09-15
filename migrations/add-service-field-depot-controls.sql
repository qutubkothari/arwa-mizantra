-- Field acknowledgement, returnable spares and supplier/OEM warranty recovery.
ALTER TABLE public.service_site_visits
  ADD COLUMN IF NOT EXISTS customer_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS customer_signature_designation TEXT,
  ADD COLUMN IF NOT EXISTS customer_signature_ip TEXT,
  ADD COLUMN IF NOT EXISTS signature_declined_reason TEXT;

ALTER TABLE public.service_parts_used
  ADD COLUMN IF NOT EXISTS return_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS return_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (return_status IN ('NOT_REQUIRED','EXPECTED','RECEIVED','SENT_TO_VENDOR','CREDIT_RECEIVED','SCRAPPED')),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_reference TEXT;

CREATE TABLE IF NOT EXISTS public.service_warranty_recovery_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  claim_number VARCHAR(80) NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  service_part_used_id UUID REFERENCES public.service_parts_used(id) ON DELETE RESTRICT,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE RESTRICT,
  claim_type VARCHAR(30) NOT NULL DEFAULT 'PART'
    CHECK (claim_type IN ('PART','LABOUR','TRAVEL','OTHER')),
  claimed_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
  approved_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (approved_amount >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','SETTLED','CANCELLED')),
  vendor_reference TEXT,
  rejection_reason TEXT,
  notes TEXT,
  submitted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, claim_number)
);

CREATE INDEX IF NOT EXISTS idx_service_warranty_recovery_ticket
  ON public.service_warranty_recovery_claims(tenant_id, service_ticket_id, status);

NOTIFY pgrst, 'reload schema';
