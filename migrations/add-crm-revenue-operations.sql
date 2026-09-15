-- Mizantra CRM revenue operations
-- Additive only: preserves every existing lead, account, contact, opportunity and ERP document.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.crm_territories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  territory_code VARCHAR(40) NOT NULL,
  territory_name VARCHAR(160) NOT NULL,
  manager_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  member_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  country_filter VARCHAR(120),
  state_filter VARCHAR(120),
  city_filter VARCHAR(120),
  industry_filter VARCHAR(160),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, territory_code)
);

CREATE TABLE IF NOT EXISTS public.crm_sales_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_month DATE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  territory_id UUID REFERENCES public.crm_territories(id) ON DELETE CASCADE,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'INR',
  target_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  target_wins INTEGER NOT NULL DEFAULT 0 CHECK (target_wins >= 0),
  target_new_leads INTEGER NOT NULL DEFAULT 0 CHECK (target_new_leads >= 0),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR territory_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_target_user_month
  ON public.crm_sales_targets (tenant_id, target_month, user_id)
  WHERE user_id IS NOT NULL AND territory_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_target_territory_month
  ON public.crm_sales_targets (tenant_id, target_month, territory_id)
  WHERE territory_id IS NOT NULL AND user_id IS NULL;

CREATE TABLE IF NOT EXISTS public.crm_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_code VARCHAR(40) NOT NULL,
  campaign_name VARCHAR(200) NOT NULL,
  campaign_type VARCHAR(30) NOT NULL DEFAULT 'OTHER'
    CHECK (campaign_type IN ('EMAIL','WHATSAPP','EVENT','WEB','REFERRAL','PARTNER','OTHER')),
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  start_date DATE,
  end_date DATE,
  budget NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  expected_revenue NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (expected_revenue >= 0),
  currency_code VARCHAR(10) NOT NULL DEFAULT 'INR',
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, campaign_code)
);

CREATE TABLE IF NOT EXISTS public.crm_campaign_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  member_status VARCHAR(30) NOT NULL DEFAULT 'SELECTED'
    CHECK (member_status IN ('SELECTED','SENT','DELIVERED','RESPONDED','CONVERTED','OPTED_OUT','FAILED')),
  response_at TIMESTAMPTZ,
  revenue_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lead_id IS NOT NULL OR contact_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_campaign_lead
  ON public.crm_campaign_members (campaign_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_campaign_contact
  ON public.crm_campaign_members (campaign_id, contact_id) WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_name VARCHAR(160) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP')),
  subject VARCHAR(300),
  body TEXT NOT NULL,
  category VARCHAR(80),
  approved_external_use BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, template_name, channel)
);

CREATE TABLE IF NOT EXISTS public.crm_cadences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cadence_name VARCHAR(180) NOT NULL,
  description TEXT,
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cadence_name)
);

CREATE TABLE IF NOT EXISTS public.crm_cadence_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cadence_id UUID NOT NULL REFERENCES public.crm_cadences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL CHECK (step_order > 0),
  wait_days INTEGER NOT NULL DEFAULT 0 CHECK (wait_days >= 0),
  action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('TASK','CALL','EMAIL','WHATSAPP')),
  template_id UUID REFERENCES public.crm_message_templates(id) ON DELETE SET NULL,
  instructions TEXT,
  automatic_execution BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cadence_id, step_order)
);

CREATE TABLE IF NOT EXISTS public.crm_cadence_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cadence_id UUID NOT NULL REFERENCES public.crm_cadences(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','STOPPED')),
  current_step INTEGER NOT NULL DEFAULT 0,
  next_action_at TIMESTAMPTZ,
  stop_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
  enrolled_by UUID,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lead_id IS NOT NULL OR contact_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_active_lead_cadence
  ON public.crm_cadence_enrollments (tenant_id, cadence_id, lead_id)
  WHERE lead_id IS NOT NULL AND status IN ('ACTIVE','PAUSED');

CREATE TABLE IF NOT EXISTS public.crm_workflow_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_name VARCHAR(180) NOT NULL,
  entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('LEAD','ACCOUNT','CONTACT','OPPORTUNITY','ACTIVITY')),
  trigger_event VARCHAR(40) NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (approval_status IN ('DRAFT','APPROVED','REJECTED')),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, rule_name)
);

ALTER TABLE public.crm_opportunities
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_activity_at TIMESTAMPTZ;

DO $$
BEGIN
  IF to_regclass('public.communication_log') IS NOT NULL THEN
    ALTER TABLE public.communication_log
      ADD COLUMN IF NOT EXISTS crm_lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS crm_account_id UUID REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS crm_contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS crm_opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_targets_month
  ON public.crm_sales_targets (tenant_id, target_month, user_id, territory_id);
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_status
  ON public.crm_campaigns (tenant_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_cadence_due
  ON public.crm_cadence_enrollments (tenant_id, status, next_action_at);
CREATE INDEX IF NOT EXISTS idx_crm_workflows_active
  ON public.crm_workflow_rules (tenant_id, entity_type, trigger_event, is_active);

COMMENT ON TABLE public.crm_cadence_enrollments IS
  'Governed follow-up sequences. External messages require an approved template and explicit execution control.';
COMMENT ON TABLE public.crm_sales_targets IS
  'Monthly salesperson or territory targets used by CRM forecast-versus-target reporting.';
COMMENT ON TABLE public.crm_workflow_rules IS
  'Tenant-scoped CRM automation definitions; rules remain inert until approved and activated.';

COMMIT;
