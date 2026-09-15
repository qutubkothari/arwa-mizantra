-- Controlled exception task queue for tenant-scoped automation. Tasks are
-- intentionally separate from communications so operational ownership and
-- completion can be tracked without changing delivery evidence.
CREATE TABLE IF NOT EXISTS public.automation_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  automation_rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  module VARCHAR(40) NOT NULL,
  document_type VARCHAR(60),
  document_id UUID,
  document_number VARCHAR(100),
  title TEXT NOT NULL,
  description TEXT,
  priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  owner_user_id UUID,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_tasks_tenant_status
  ON public.automation_tasks (tenant_id, status, priority, due_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_tasks_document
  ON public.automation_tasks (tenant_id, document_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_open_task_per_document
  ON public.automation_tasks (tenant_id, automation_rule_id, document_id)
  WHERE status IN ('OPEN', 'IN_PROGRESS');

NOTIFY pgrst, 'reload schema';
