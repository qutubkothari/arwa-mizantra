-- Tenant-scoped master-data governance: controlled change requests and immutable evidence.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.master_data_change_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_number VARCHAR(80) NOT NULL,
  entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('CUSTOMER','SUPPLIER','ITEM','BANK_ACCOUNT','TAX_CODE','GL_ACCOUNT')),
  operation VARCHAR(16) NOT NULL CHECK (operation IN ('CREATE','UPDATE','DEACTIVATE')),
  target_id UUID,
  current_snapshot JSONB,
  proposed_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  duplicate_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact_analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','REVIEWED','APPROVED','APPLIED','REJECTED','FAILED')),
  idempotency_key VARCHAR(140),
  prepared_by UUID NOT NULL,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  applied_by UUID,
  applied_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  decision_note TEXT,
  failure_reason TEXT,
  evidence_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, request_number),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.master_data_change_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.master_data_change_requests(id) ON DELETE RESTRICT,
  action VARCHAR(24) NOT NULL,
  from_status VARCHAR(16),
  to_status VARCHAR(16) NOT NULL,
  actor_id UUID NOT NULL,
  note TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash CHAR(64),
  evidence_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdg_requests_tenant_status ON public.master_data_change_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdg_requests_target ON public.master_data_change_requests (tenant_id, entity_type, target_id);
CREATE INDEX IF NOT EXISTS idx_mdg_events_request ON public.master_data_change_events (tenant_id, request_id, created_at);

CREATE OR REPLACE FUNCTION public.prevent_master_data_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Master-data evidence events are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_master_data_events_immutable ON public.master_data_change_events;
CREATE TRIGGER trg_master_data_events_immutable
BEFORE UPDATE OR DELETE ON public.master_data_change_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_event_mutation();

COMMENT ON TABLE public.master_data_change_requests IS 'Four-stage, tenant-scoped governance for sensitive master-data changes.';
COMMENT ON TABLE public.master_data_change_events IS 'Append-only hash-chained evidence for master-data decisions.';

CREATE TABLE IF NOT EXISTS public.master_data_governance_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_by UUID,
  enabled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.master_data_bypass_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id UUID,
  entity_type VARCHAR(30) NOT NULL,
  method VARCHAR(12) NOT NULL,
  route TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  source_ip VARCHAR(80),
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdg_bypass_tenant ON public.master_data_bypass_attempts (tenant_id, blocked_at DESC);
COMMENT ON TABLE public.master_data_bypass_attempts IS 'Evidence of direct master writes blocked by enforced governance.';
