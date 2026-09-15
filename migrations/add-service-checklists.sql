-- Controlled field-service checklists. Additive and safe for existing tickets.
CREATE TABLE IF NOT EXISTS public.service_checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  template_name TEXT NOT NULL,
  service_type TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_checklist_template_name_unique UNIQUE (tenant_id, template_name)
);

CREATE TABLE IF NOT EXISTS public.service_checklist_template_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES public.service_checklist_templates(id) ON DELETE CASCADE,
  item_text TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_checklist_template_item_order_unique UNIQUE (template_id, sort_order)
);

CREATE TABLE IF NOT EXISTS public.service_ticket_checklist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE RESTRICT,
  template_id UUID REFERENCES public.service_checklist_templates(id) ON DELETE SET NULL,
  template_item_id UUID REFERENCES public.service_checklist_template_items(id) ON DELETE SET NULL,
  item_text TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'NOT_APPLICABLE')),
  remarks TEXT,
  completed_by UUID,
  completed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_ticket_checklist_item_unique UNIQUE (service_ticket_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_service_checklist_templates_tenant
  ON public.service_checklist_templates(tenant_id, is_active, template_name);
CREATE INDEX IF NOT EXISTS idx_service_ticket_checklist_ticket
  ON public.service_ticket_checklist_items(tenant_id, service_ticket_id, sort_order);

COMMENT ON TABLE public.service_checklist_templates IS
  'Reusable tenant-specific quality and safety checklists for field service.';
COMMENT ON TABLE public.service_ticket_checklist_items IS
  'Immutable checklist snapshot assigned to a service ticket and completed by technicians.';
