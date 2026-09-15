-- One-time confirmation ledger for prompt-created ERP drafts.
-- It prevents retries or double-clicks from creating duplicate native records.
CREATE TABLE IF NOT EXISTS public.active_planner_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  context_id UUID NOT NULL,
  intent_type VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('EXECUTING','COMPLETED','FAILED')),
  prompt_hash VARCHAR(64) NOT NULL,
  resource_type VARCHAR(60),
  resource_id UUID,
  failure_reason VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, context_id)
);

CREATE INDEX IF NOT EXISTS idx_active_planner_executions_tenant_user
  ON public.active_planner_executions (tenant_id, user_id, created_at DESC);

COMMENT ON TABLE public.active_planner_executions IS
  'Tenant-scoped one-time execution ledger for Active Planner draft confirmations; contains hashes and result references, never prompt text.';
