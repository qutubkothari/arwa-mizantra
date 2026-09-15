-- Auditable field-service visits. Additive and safe for existing tickets.
CREATE TABLE IF NOT EXISTS public.service_site_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  service_assignment_id UUID NOT NULL REFERENCES public.service_assignments(id) ON DELETE RESTRICT,
  visit_number INTEGER NOT NULL CHECK (visit_number > 0),
  status VARCHAR(30) NOT NULL DEFAULT 'CHECKED_IN'
    CHECK (status IN ('CHECKED_IN', 'COMPLETED', 'CANCELLED')),
  purpose TEXT,
  site_contact_name TEXT NOT NULL,
  site_contact_designation TEXT,
  site_contact_mobile TEXT,
  site_contact_email TEXT,
  check_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_in_lat NUMERIC(10,7),
  check_in_lng NUMERIC(10,7),
  check_in_location TEXT,
  check_out_at TIMESTAMPTZ,
  check_out_lat NUMERIC(10,7),
  check_out_lng NUMERIC(10,7),
  check_out_location TEXT,
  work_notes TEXT,
  customer_acknowledgement_name TEXT,
  customer_acknowledged_at TIMESTAMPTZ,
  before_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  after_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL,
  completed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_site_visits_ticket_number_unique
    UNIQUE (tenant_id, service_ticket_id, visit_number)
);

CREATE INDEX IF NOT EXISTS idx_service_site_visits_ticket
  ON public.service_site_visits(tenant_id, service_ticket_id, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_site_visits_assignment
  ON public.service_site_visits(service_assignment_id, check_in_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_site_visit_open_assignment
  ON public.service_site_visits(service_assignment_id)
  WHERE status = 'CHECKED_IN';

COMMENT ON TABLE public.service_site_visits IS
  'Auditable technician site-call visits with client contact, location, timestamps and before/after evidence.';
