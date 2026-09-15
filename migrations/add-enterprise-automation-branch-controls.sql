-- Mizantra P1 enterprise control plane. All records are tenant-scoped and
-- deliberately start disabled; no email or workflow is fired by a migration.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.company_branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_code VARCHAR(40) NOT NULL,
  branch_name VARCHAR(180) NOT NULL,
  market_profile VARCHAR(12) NOT NULL DEFAULT 'INDIA' CHECK (market_profile IN ('INDIA', 'UAE')),
  currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  tax_regime VARCHAR(30) NOT NULL DEFAULT 'GST',
  timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_code)
);

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_code VARCHAR(80) NOT NULL,
  rule_name VARCHAR(180) NOT NULL,
  module VARCHAR(40) NOT NULL CHECK (module IN ('SALES', 'SERVICE', 'PURCHASE', 'INVENTORY', 'FINANCE', 'OPERATIONS')),
  trigger_type VARCHAR(60) NOT NULL CHECK (trigger_type IN ('QUOTATION_EXPIRING', 'RECEIVABLE_OVERDUE', 'SERVICE_SLA_RISK', 'LOW_STOCK', 'PO_OVERDUE', 'MANUAL')),
  action_type VARCHAR(40) NOT NULL DEFAULT 'NOTIFY' CHECK (action_type IN ('NOTIFY', 'EMAIL', 'WHATSAPP', 'CREATE_TASK', 'ESCALATE')),
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_subject TEXT,
  template_body TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, rule_code)
);

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  automation_rule_id UUID REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  run_type VARCHAR(20) NOT NULL DEFAULT 'PREVIEW' CHECK (run_type IN ('PREVIEW', 'EXECUTE')),
  status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED', 'SKIPPED')),
  target_count INTEGER NOT NULL DEFAULT 0,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  run_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.communication_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.company_branches(id) ON DELETE SET NULL,
  module VARCHAR(40) NOT NULL,
  document_type VARCHAR(60),
  document_id UUID,
  document_number VARCHAR(100),
  channel VARCHAR(20) NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL', 'WHATSAPP', 'SMS', 'PORTAL', 'IN_APP')),
  direction VARCHAR(12) NOT NULL DEFAULT 'OUTBOUND' CHECK (direction IN ('OUTBOUND', 'INBOUND')),
  recipient TEXT,
  subject TEXT,
  message_preview TEXT,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (delivery_status IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ')),
  provider_reference VARCHAR(200),
  -- Stable idempotency key for a rule/document/day execution. Keeping this
  -- nullable preserves compatibility with historical/manual communications.
  dedupe_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.communication_log
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE INDEX IF NOT EXISTS idx_company_branches_tenant ON public.company_branches (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_automation_rules_tenant ON public.automation_rules (tenant_id, module, is_active);
CREATE INDEX IF NOT EXISTS idx_automation_runs_tenant ON public.automation_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communication_log_tenant ON public.communication_log (tenant_id, module, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_communication_log_dedupe
  ON public.communication_log (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON TABLE public.automation_rules IS 'Tenant-scoped, auditable automation rules. Rules are disabled until explicitly enabled.';
COMMENT ON TABLE public.communication_log IS 'Central delivery/audit register for ERP generated customer and supplier communications.';
