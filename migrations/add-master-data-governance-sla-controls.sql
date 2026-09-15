-- Tenant-scoped SLA, reminder and escalation evidence for master-data governance.
CREATE TABLE IF NOT EXISTS public.master_data_governance_sla_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stage VARCHAR(16) NOT NULL CHECK (stage IN ('PREPARE','REVIEW','APPROVE','POST')),
  target_hours NUMERIC(10,2) NOT NULL CHECK (target_hours > 0),
  reminder_before_hours NUMERIC(10,2) NOT NULL DEFAULT 4 CHECK (reminder_before_hours >= 0),
  escalation_after_hours NUMERIC(10,2) NOT NULL DEFAULT 4 CHECK (escalation_after_hours >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, stage)
);

CREATE TABLE IF NOT EXISTS public.master_data_governance_sla_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.master_data_change_requests(id) ON DELETE CASCADE,
  stage VARCHAR(16) NOT NULL CHECK (stage IN ('PREPARE','REVIEW','APPROVE','POST')),
  notification_type VARCHAR(16) NOT NULL CHECK (notification_type IN ('REMINDER','ESCALATION')),
  recipient_role VARCHAR(40) NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, request_id, stage, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_mdg_sla_notifications_inbox
  ON public.master_data_governance_sla_notifications(tenant_id, recipient_role, acknowledged_at, due_at DESC);

COMMENT ON TABLE public.master_data_governance_sla_policies IS 'Per-company stage SLAs for master-data governance; no external messages are sent without an approved channel.';
COMMENT ON TABLE public.master_data_governance_sla_notifications IS 'Idempotent reminder and escalation evidence generated for overdue governance stages.';
