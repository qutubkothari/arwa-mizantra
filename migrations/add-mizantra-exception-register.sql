CREATE TABLE IF NOT EXISTS public.mizantra_exception_register (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_key VARCHAR(180) NOT NULL, source_type VARCHAR(80) NOT NULL, source_route TEXT,
  title TEXT NOT NULL, explanation TEXT, recommendation TEXT, severity VARCHAR(12) NOT NULL,
  priority_score INTEGER NOT NULL, confidence VARCHAR(12) NOT NULL DEFAULT 'MEDIUM', evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL, acknowledged_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ, resolution_evidence TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_mizantra_exception_open ON public.mizantra_exception_register(tenant_id,status,priority_score DESC,last_seen_at DESC);
NOTIFY pgrst, 'reload schema';
