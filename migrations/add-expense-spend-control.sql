-- Employee expense and corporate-spend control plane.
-- Approval creates posting readiness only; it never posts a journal or initiates payment.
CREATE TABLE IF NOT EXISTS public.expense_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  category VARCHAR(60) NOT NULL, max_item_amount NUMERIC(18,2), receipt_required_above NUMERIC(18,2) NOT NULL DEFAULT 0,
  requires_business_purpose BOOLEAN NOT NULL DEFAULT TRUE, enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, category)
);

CREATE TABLE IF NOT EXISTS public.expense_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL, claim_number VARCHAR(80) NOT NULL,
  claimant_user_id UUID NOT NULL, title VARCHAR(200) NOT NULL, currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','REIMBURSED')),
  total_claimed NUMERIC(18,2) NOT NULL DEFAULT 0, total_approved NUMERIC(18,2) NOT NULL DEFAULT 0,
  exception_amount NUMERIC(18,2) NOT NULL DEFAULT 0, avoided_leakage NUMERIC(18,2) NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ, reviewed_by UUID, reviewed_at TIMESTAMPTZ, review_notes TEXT,
  payment_reference VARCHAR(160), reimbursed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, claim_number)
);

CREATE TABLE IF NOT EXISTS public.expense_claim_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL, claim_id UUID NOT NULL REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL, category VARCHAR(60) NOT NULL, merchant VARCHAR(180) NOT NULL,
  business_purpose TEXT, claimed_amount NUMERIC(18,2) NOT NULL CHECK(claimed_amount > 0),
  approved_amount NUMERIC(18,2) NOT NULL DEFAULT 0, tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  receipt_reference TEXT, policy_status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK(policy_status IN ('PENDING','PASS','EXCEPTION','DUPLICATE')),
  policy_findings JSONB NOT NULL DEFAULT '[]'::jsonb, duplicate_of UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_claim_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL, claim_id UUID NOT NULL REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL, actor_user_id UUID, notes TEXT, event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_claim_worklist ON public.expense_claims(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_duplicate_scan ON public.expense_claim_items(tenant_id,expense_date,merchant,claimed_amount);
CREATE INDEX IF NOT EXISTS idx_expense_events ON public.expense_claim_events(tenant_id,claim_id,created_at DESC);

