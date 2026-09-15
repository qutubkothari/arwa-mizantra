-- Mizantra CRM commercial foundation
-- Additive only: preserves existing leads, customers, quotations and activities.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.crm_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  account_number VARCHAR(40) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  account_type VARCHAR(30) NOT NULL DEFAULT 'PROSPECT'
    CHECK (account_type IN ('PROSPECT','CUSTOMER','PARTNER','DISTRIBUTOR','GOVERNMENT','OTHER')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  owner_user_id UUID,
  website VARCHAR(320),
  domain VARCHAR(255),
  industry VARCHAR(160),
  territory VARCHAR(160),
  tax_registration_number VARCHAR(80),
  email VARCHAR(320),
  phone VARCHAR(80),
  billing_address TEXT,
  shipping_address TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, account_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_accounts_customer
  ON public.crm_accounts (tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_accounts_name
  ON public.crm_accounts (tenant_id, lower(account_name));

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  account_id UUID REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  salutation VARCHAR(20),
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120),
  job_title VARCHAR(160),
  department VARCHAR(160),
  email VARCHAR(320),
  phone VARCHAR(80),
  mobile VARCHAR(80),
  whatsapp VARCHAR(80),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  email_consent VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (email_consent IN ('UNKNOWN','OPTED_IN','OPTED_OUT')),
  whatsapp_consent VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (whatsapp_consent IN ('UNKNOWN','OPTED_IN','OPTED_OUT')),
  do_not_call BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (account_id IS NOT NULL OR customer_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_account
  ON public.crm_contacts (tenant_id, account_id, is_primary DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_identity
  ON public.crm_contacts (tenant_id, lower(email), mobile);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_primary_contact
  ON public.crm_contacts (tenant_id, account_id)
  WHERE is_primary = TRUE;

CREATE TABLE IF NOT EXISTS public.crm_opportunity_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  stage_code VARCHAR(40) NOT NULL,
  stage_name VARCHAR(120) NOT NULL,
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

CREATE TABLE IF NOT EXISTS public.crm_opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  opportunity_number VARCHAR(40) NOT NULL,
  opportunity_name VARCHAR(240) NOT NULL,
  account_id UUID NOT NULL REFERENCES public.crm_accounts(id),
  primary_contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  source_lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  quotation_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  sales_order_id UUID,
  owner_user_id UUID,
  stage_id UUID NOT NULL REFERENCES public.crm_opportunity_stages(id),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','WON','LOST','ON_HOLD')),
  amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency_code VARCHAR(10) NOT NULL DEFAULT 'INR',
  probability NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  next_step VARCHAR(500),
  product_interest VARCHAR(500),
  requirement TEXT,
  competitors TEXT,
  loss_reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, opportunity_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_opportunity_source_lead
  ON public.crm_opportunities (tenant_id, source_lead_id)
  WHERE source_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_opportunity_pipeline
  ON public.crm_opportunities (tenant_id, stage_id, owner_user_id, expected_close_date);
CREATE INDEX IF NOT EXISTS idx_crm_opportunity_account
  ON public.crm_opportunities (tenant_id, account_id, updated_at DESC);

INSERT INTO public.crm_opportunity_stages
  (tenant_id, stage_code, stage_name, sort_order, probability, colour, is_closed, is_won)
SELECT tenant.id, stage.code, stage.name, stage.sort_order, stage.probability,
       stage.colour, stage.is_closed, stage.is_won
FROM public.tenants tenant
CROSS JOIN (
  VALUES
    ('PROSPECTING','Prospecting',10,10::NUMERIC,'#64748B',FALSE,FALSE),
    ('QUALIFICATION','Qualification',20,25::NUMERIC,'#2563EB',FALSE,FALSE),
    ('NEEDS_ANALYSIS','Needs Analysis',30,40::NUMERIC,'#0891B2',FALSE,FALSE),
    ('PROPOSAL','Proposal / Quotation',40,60::NUMERIC,'#CA8A04',FALSE,FALSE),
    ('NEGOTIATION','Negotiation',50,80::NUMERIC,'#EA580C',FALSE,FALSE),
    ('COMMIT','Commit',60,90::NUMERIC,'#7C3AED',FALSE,FALSE),
    ('WON','Won',70,100::NUMERIC,'#15803D',TRUE,TRUE),
    ('LOST','Lost',80,0::NUMERIC,'#B91C1C',TRUE,FALSE),
    ('ON_HOLD','On Hold',90,25::NUMERIC,'#475569',FALSE,FALSE)
) AS stage(code,name,sort_order,probability,colour,is_closed,is_won)
ON CONFLICT (tenant_id, stage_code) DO NOTHING;

-- Give every existing customer one CRM account without changing the customer row.
INSERT INTO public.crm_accounts (
  tenant_id, account_number, account_name, account_type, customer_id,
  email, phone, billing_address, shipping_address, status, created_at, updated_at
)
SELECT
  c.tenant_id,
  'ACC-' || SUBSTRING(REPLACE(c.id::TEXT, '-', '') FROM 1 FOR 12),
  c.customer_name,
  'CUSTOMER',
  c.id,
  NULLIF(to_jsonb(c)->>'email',''),
  COALESCE(NULLIF(to_jsonb(c)->>'mobile',''), NULLIF(to_jsonb(c)->>'phone','')),
  NULLIF(to_jsonb(c)->>'billing_address',''),
  NULLIF(to_jsonb(c)->>'shipping_address',''),
  CASE WHEN COALESCE((to_jsonb(c)->>'is_active')::BOOLEAN, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END,
  COALESCE((to_jsonb(c)->>'created_at')::TIMESTAMPTZ, NOW()),
  NOW()
FROM public.customers c
ON CONFLICT (tenant_id, customer_id) WHERE customer_id IS NOT NULL DO NOTHING;

-- Preserve the primary person captured on converted leads as an account contact.
INSERT INTO public.crm_contacts (
  tenant_id, account_id, customer_id, first_name, email, mobile, whatsapp,
  is_primary, owner_user_id, created_by, created_at, updated_at
)
SELECT
  l.tenant_id,
  a.id,
  l.customer_id,
  COALESCE(NULLIF(l.contact_person,''), l.company_name),
  l.email,
  l.phone,
  l.phone,
  NOT EXISTS (
    SELECT 1 FROM public.crm_contacts existing
    WHERE existing.tenant_id = l.tenant_id AND existing.account_id = a.id AND existing.is_primary
  ) AND ROW_NUMBER() OVER (
    PARTITION BY l.tenant_id, a.id
    ORDER BY l.created_at ASC, l.id ASC
  ) = 1,
  l.owner_user_id,
  l.created_by,
  l.created_at,
  NOW()
FROM public.crm_leads l
JOIN public.crm_accounts a
  ON a.tenant_id = l.tenant_id AND a.customer_id = l.customer_id
WHERE l.customer_id IS NOT NULL
  AND (NULLIF(l.contact_person,'') IS NOT NULL OR NULLIF(l.email,'') IS NOT NULL OR NULLIF(l.phone,'') IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_contacts existing
    WHERE existing.tenant_id = l.tenant_id
      AND existing.account_id = a.id
      AND (
        (l.email IS NOT NULL AND lower(existing.email) = lower(l.email)) OR
        (l.phone IS NOT NULL AND existing.mobile = l.phone)
      )
  );

-- Converted leads become opportunities, retaining the original source linkage.
INSERT INTO public.crm_opportunities (
  tenant_id, opportunity_number, opportunity_name, account_id, primary_contact_id,
  source_lead_id, customer_id, quotation_id, owner_user_id, stage_id, status,
  amount, currency_code, probability, expected_close_date, next_step,
  product_interest, requirement, loss_reason, created_by, created_at, updated_at, closed_at
)
SELECT
  l.tenant_id,
  'OPP-' || SUBSTRING(REPLACE(l.id::TEXT, '-', '') FROM 1 FOR 12),
  l.company_name || COALESCE(' - ' || NULLIF(l.product_interest,''), ' opportunity'),
  a.id,
  contact.id,
  l.id,
  l.customer_id,
  l.quotation_id,
  l.owner_user_id,
  os.id,
  CASE WHEN ls.stage_code = 'WON' THEN 'WON'
       WHEN ls.stage_code = 'LOST' THEN 'LOST'
       WHEN ls.stage_code = 'ON_HOLD' THEN 'ON_HOLD'
       ELSE 'OPEN' END,
  l.expected_value,
  l.currency_code,
  os.probability,
  l.expected_close_date,
  CASE WHEN l.next_follow_up_at IS NOT NULL THEN 'Follow up scheduled ' || l.next_follow_up_at::TEXT ELSE NULL END,
  l.product_interest,
  l.requirement,
  l.lost_reason,
  l.created_by,
  l.created_at,
  NOW(),
  CASE WHEN ls.is_closed THEN COALESCE(l.converted_at, NOW()) ELSE NULL END
FROM public.crm_leads l
JOIN public.crm_pipeline_stages ls ON ls.id = l.stage_id
JOIN public.crm_accounts a ON a.tenant_id = l.tenant_id AND a.customer_id = l.customer_id
JOIN public.crm_opportunity_stages os
  ON os.tenant_id = l.tenant_id
 AND os.stage_code = CASE
   WHEN ls.stage_code IN ('WON','LOST','ON_HOLD','NEGOTIATION') THEN ls.stage_code
   WHEN ls.stage_code = 'QUOTATION' THEN 'PROPOSAL'
   WHEN ls.stage_code IN ('QUALIFIED','REQUIREMENT') THEN 'NEEDS_ANALYSIS'
   ELSE 'QUALIFICATION' END
LEFT JOIN LATERAL (
  SELECT cc.id FROM public.crm_contacts cc
  WHERE cc.tenant_id = l.tenant_id AND cc.account_id = a.id
  ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1
) contact ON TRUE
WHERE l.customer_id IS NOT NULL
ON CONFLICT (tenant_id, source_lead_id) WHERE source_lead_id IS NOT NULL DO NOTHING;

COMMENT ON TABLE public.crm_accounts IS 'Commercial organization record linked optionally to the ERP customer master.';
COMMENT ON TABLE public.crm_contacts IS 'People and consent preferences belonging to CRM accounts or ERP customers.';
COMMENT ON TABLE public.crm_opportunities IS 'Repeatable commercial deals separated from initial lead qualification and linked to ERP quotations/orders.';

COMMIT;
