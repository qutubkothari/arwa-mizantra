-- Mizantra Intelligent CRM
-- Additive front-office layer linked to existing customers, quotations and users.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  stage_code VARCHAR(40) NOT NULL,
  stage_name VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  probability NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  colour VARCHAR(20),
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  is_won BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, stage_code)
);

CREATE TABLE IF NOT EXISTS public.crm_assignment_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  rule_name VARCHAR(150) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  strategy VARCHAR(30) NOT NULL DEFAULT 'LOAD_BALANCED'
    CHECK (strategy IN ('LOAD_BALANCED','ROUND_ROBIN','FIXED_OWNER')),
  source_filter VARCHAR(80),
  territory_filter VARCHAR(120),
  industry_filter VARCHAR(120),
  product_filter VARCHAR(180),
  assignee_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_assignee_index INTEGER NOT NULL DEFAULT -1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  lead_number VARCHAR(40) NOT NULL,
  company_name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(160),
  email VARCHAR(200),
  phone VARCHAR(50),
  alternate_phone VARCHAR(50),
  source VARCHAR(80) NOT NULL DEFAULT 'MANUAL',
  campaign VARCHAR(160),
  territory VARCHAR(120),
  industry VARCHAR(120),
  product_interest VARCHAR(240),
  requirement TEXT,
  expected_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (expected_value >= 0),
  currency_code VARCHAR(10) NOT NULL DEFAULT 'INR',
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  stage_id UUID REFERENCES public.crm_pipeline_stages(id),
  probability NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  lead_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (lead_score BETWEEN 0 AND 100),
  score_explanation JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_user_id UUID,
  assigned_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  expected_close_date DATE,
  customer_id UUID REFERENCES public.customers(id),
  quotation_id UUID REFERENCES public.quotations(id),
  lost_reason TEXT,
  conversion_notes TEXT,
  converted_at TIMESTAMPTZ,
  converted_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, lead_number)
);

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS lead_score NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (lead_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_explanation JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  activity_type VARCHAR(30) NOT NULL
    CHECK (activity_type IN ('CALL','EMAIL','WHATSAPP','MEETING','SITE_VISIT','TASK','NOTE','DEMO','FOLLOW_UP')),
  direction VARCHAR(20) NOT NULL DEFAULT 'INTERNAL'
    CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL')),
  subject VARCHAR(220) NOT NULL,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  owner_user_id UUID,
  outcome VARCHAR(240),
  next_action_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lead_id IS NOT NULL OR customer_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.crm_lead_stage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES public.crm_pipeline_stages(id),
  to_stage_id UUID NOT NULL REFERENCES public.crm_pipeline_stages(id),
  changed_by UUID,
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_pipeline
  ON public.crm_leads (tenant_id, stage_id, owner_user_id, expected_close_date);
CREATE INDEX IF NOT EXISTS idx_crm_leads_follow_up
  ON public.crm_leads (tenant_id, next_follow_up_at) WHERE converted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_leads_identity
  ON public.crm_leads (tenant_id, lower(email), phone);
CREATE INDEX IF NOT EXISTS idx_crm_activities_worklist
  ON public.crm_activities (tenant_id, owner_user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_crm_activities_lead
  ON public.crm_activities (tenant_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_stage_history_lead
  ON public.crm_lead_stage_history (tenant_id, lead_id, changed_at DESC);

INSERT INTO public.crm_pipeline_stages (
  tenant_id, stage_code, stage_name, sort_order, probability, colour,
  is_closed, is_won, is_active
)
SELECT
  tenant.id, stage.stage_code, stage.stage_name, stage.sort_order,
  stage.probability, stage.colour, stage.is_closed, stage.is_won, TRUE
FROM public.tenants AS tenant
CROSS JOIN (
  VALUES
    ('NEW', 'New', 10, 10::NUMERIC, '#64748B', FALSE, FALSE),
    ('ASSIGNED', 'Assigned', 20, 20::NUMERIC, '#2563EB', FALSE, FALSE),
    ('CONTACTED', 'Contacted', 30, 30::NUMERIC, '#7C3AED', FALSE, FALSE),
    ('QUALIFIED', 'Qualified', 40, 50::NUMERIC, '#0891B2', FALSE, FALSE),
    ('REQUIREMENT', 'Requirement Confirmed', 50, 60::NUMERIC, '#0F766E', FALSE, FALSE),
    ('QUOTATION', 'Quotation', 60, 70::NUMERIC, '#CA8A04', FALSE, FALSE),
    ('NEGOTIATION', 'Negotiation', 70, 85::NUMERIC, '#EA580C', FALSE, FALSE),
    ('WON', 'Won', 80, 100::NUMERIC, '#15803D', TRUE, TRUE),
    ('LOST', 'Lost', 90, 0::NUMERIC, '#B91C1C', TRUE, FALSE),
    ('ON_HOLD', 'On Hold', 100, 25::NUMERIC, '#475569', FALSE, FALSE)
) AS stage(stage_code, stage_name, sort_order, probability, colour, is_closed, is_won)
ON CONFLICT (tenant_id, stage_code) DO NOTHING;

COMMENT ON TABLE public.crm_leads IS
  'Tenant-scoped lead and opportunity record feeding the existing customer and quotation workflows.';
COMMENT ON TABLE public.crm_assignment_rules IS
  'Explainable lead routing rules; assignment never grants approval or posting permissions.';

COMMIT;
