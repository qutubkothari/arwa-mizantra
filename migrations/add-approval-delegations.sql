CREATE TABLE IF NOT EXISTS public.workflow_delegations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  delegator_user_id UUID NOT NULL, delegate_user_id UUID NOT NULL, workflow_role VARCHAR(40) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, reason TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
  created_by UUID NOT NULL, revoked_by UUID, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(delegator_user_id <> delegate_user_id), CHECK(ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_workflow_delegations_active ON public.workflow_delegations(tenant_id, workflow_role, status, starts_at, ends_at);
COMMENT ON TABLE public.workflow_delegations IS 'Time-bound approval delegation. Approval actions must record the acting delegate and retain the original role holder in evidence.';
