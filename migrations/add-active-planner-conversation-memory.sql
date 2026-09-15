-- Persistent, tenant/user-scoped Active Planner conversations and controlled
-- language learning. Learning examples classify phrasing only; they never
-- contain operational answers or authorize ERP actions.
CREATE TABLE IF NOT EXISTS public.active_planner_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title VARCHAR(180) NOT NULL DEFAULT 'New conversation',
  current_context_token TEXT,
  last_result JSONB,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.active_planner_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.active_planner_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(12) NOT NULL CHECK (role IN ('USER','PLANNER')),
  content TEXT NOT NULL CHECK (btrim(content) <> '' AND length(content) <= 8000),
  intent_type VARCHAR(40),
  analytics_kind VARCHAR(40),
  provider VARCHAR(40),
  response_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.active_planner_learning_examples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  utterance TEXT NOT NULL CHECK (btrim(utterance) <> '' AND length(utterance) <= 2000),
  utterance_hash VARCHAR(64) NOT NULL,
  intent_type VARCHAR(40) NOT NULL,
  analytics_kind VARCHAR(40),
  language_code VARCHAR(16),
  source VARCHAR(20) NOT NULL DEFAULT 'SYSTEM_SUCCESS'
    CHECK (source IN ('SYSTEM_SUCCESS','USER_FEEDBACK','OWNER_REVIEW')),
  status VARCHAR(16) NOT NULL DEFAULT 'CANDIDATE'
    CHECK (status IN ('CANDIDATE','VERIFIED','REJECTED')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  positive_count INTEGER NOT NULL DEFAULT 0 CHECK (positive_count >= 0),
  negative_count INTEGER NOT NULL DEFAULT 0 CHECK (negative_count >= 0),
  first_seen_by UUID,
  last_seen_by UUID,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_active_planner_conversations_owner
  ON public.active_planner_conversations (tenant_id, user_id, last_message_at DESC)
  WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_active_planner_messages_conversation
  ON public.active_planner_messages (tenant_id, conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_active_planner_learning_verified
  ON public.active_planner_learning_examples (tenant_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_planner_learning_mapping
  ON public.active_planner_learning_examples
    (tenant_id, utterance_hash, intent_type, COALESCE(analytics_kind, ''));

COMMENT ON TABLE public.active_planner_conversations IS
  'Persistent Active Planner chat state scoped to one tenant and one user.';
COMMENT ON TABLE public.active_planner_messages IS
  'Auditable user/planner chat history; audio is never stored.';
COMMENT ON TABLE public.active_planner_learning_examples IS
  'Controlled tenant language examples for intent classification only; never operational values, approvals or postings.';
