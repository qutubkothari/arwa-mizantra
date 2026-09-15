-- Tenant-governed intelligent CRM intake for WhatsApp, email, website and API.
-- Additive only: existing CRM, messages, customers and business documents are preserved.
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.crm_intake_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  auto_assign_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  assignment_strategy VARCHAR(30) NOT NULL DEFAULT 'ROUND_ROBIN'
    CHECK (assignment_strategy IN ('ROUND_ROBIN','MANUAL')),
  auto_create_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.720
    CHECK (auto_create_confidence BETWEEN 0.500 AND 0.990),
  email_intake_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_intake_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_round_robin_user_id UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_sales_pool_members (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.crm_email_receipt_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email_address VARCHAR(320) NOT NULL,
  route_name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  last_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_intake_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL
    CHECK (channel IN ('WHATSAPP','EMAIL','WEBSITE','API','CAMPAIGN')),
  external_id VARCHAR(500) NOT NULL,
  conversation_key VARCHAR(500),
  sender_name VARCHAR(255),
  sender_address VARCHAR(320),
  subject TEXT,
  body_preview TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  classification VARCHAR(30) NOT NULL
    CHECK (classification IN (
      'NEW_ENQUIRY','CONTINUATION','ORDER_INTENT','SERVICE_SUPPORT',
      'SUPPLIER_PROCUREMENT','FINANCE','IRRELEVANT','SPAM','OTHER'
    )),
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  rationale TEXT,
  provider VARCHAR(40),
  model VARCHAR(100),
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  decision VARCHAR(30) NOT NULL DEFAULT 'REVIEW'
    CHECK (decision IN ('LEAD_CREATED','ACTIVITY_LINKED','REVIEW','IGNORED')),
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_intake_review
  ON public.crm_intake_messages (tenant_id, decision, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_intake_conversation
  ON public.crm_intake_messages (tenant_id, channel, conversation_key, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_sales_pool_active
  ON public.crm_sales_pool_members (tenant_id, is_active, user_id);
CREATE INDEX IF NOT EXISTS idx_crm_email_routes_active
  ON public.crm_email_receipt_routes (is_active, lower(email_address));
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_email_receipt_address
  ON public.crm_email_receipt_routes (lower(email_address));

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS crm_classification VARCHAR(30),
  ADD COLUMN IF NOT EXISTS crm_classification_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS crm_intake_message_id UUID REFERENCES public.crm_intake_messages(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF to_regclass('public.email_inbox') IS NOT NULL THEN
    ALTER TABLE public.email_inbox
      ADD COLUMN IF NOT EXISTS crm_intake_processed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS crm_intake_message_id UUID REFERENCES public.crm_intake_messages(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS crm_intake_error TEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.crm_claim_round_robin_owner(p_tenant_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous UUID;
  v_owner UUID;
BEGIN
  INSERT INTO public.crm_intake_settings (tenant_id)
  VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT last_round_robin_user_id
    INTO v_previous
    FROM public.crm_intake_settings
   WHERE tenant_id = p_tenant_id
   FOR UPDATE;

  SELECT member.user_id
    INTO v_owner
    FROM public.crm_sales_pool_members AS member
    JOIN public.users AS app_user
      ON app_user.id = member.user_id
     AND app_user.tenant_id = member.tenant_id
     AND app_user.is_active = TRUE
   WHERE member.tenant_id = p_tenant_id
     AND member.is_active = TRUE
     AND (v_previous IS NULL OR member.user_id > v_previous)
   ORDER BY member.user_id
   LIMIT 1;

  IF v_owner IS NULL THEN
    SELECT member.user_id
      INTO v_owner
      FROM public.crm_sales_pool_members AS member
      JOIN public.users AS app_user
        ON app_user.id = member.user_id
       AND app_user.tenant_id = member.tenant_id
       AND app_user.is_active = TRUE
     WHERE member.tenant_id = p_tenant_id
       AND member.is_active = TRUE
     ORDER BY member.user_id
     LIMIT 1;
  END IF;

  IF v_owner IS NOT NULL THEN
    UPDATE public.crm_intake_settings
       SET last_round_robin_user_id = v_owner,
           updated_at = NOW()
     WHERE tenant_id = p_tenant_id;
  END IF;
  RETURN v_owner;
END;
$$;

COMMENT ON TABLE public.crm_intake_messages IS
  'Auditable omnichannel classification decisions. A message becomes a lead only after the governed decision gate.';
COMMENT ON TABLE public.crm_sales_pool_members IS
  'Users explicitly marked as eligible salespeople for automatic CRM assignment.';
COMMENT ON FUNCTION public.crm_claim_round_robin_owner(UUID) IS
  'Atomically claims the next active salesperson for a tenant to avoid duplicate concurrent assignment.';

COMMIT;
