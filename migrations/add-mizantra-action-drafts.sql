CREATE TABLE IF NOT EXISTS public.mizantra_action_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instruction TEXT NOT NULL,
  insight_id VARCHAR(200) NOT NULL,
  action_code VARCHAR(60) NOT NULL,
  proposed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','EXECUTED','CANCELLED','EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mizantra_action_drafts_owner ON public.mizantra_action_drafts (tenant_id, created_by, status, expires_at DESC);
NOTIFY pgrst, 'reload schema';
