-- ISO-style CAPA, SCAR and supplier recovery control.
CREATE TABLE IF NOT EXISTS public.quality_capa_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  capa_number VARCHAR(40) NOT NULL,
  title VARCHAR(240) NOT NULL,
  source VARCHAR(30) NOT NULL CHECK (source IN ('INTERNAL','SUPPLIER','CUSTOMER','AUDIT','REGULATORY')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  ncr_id UUID,
  vendor_id UUID,
  problem_statement TEXT NOT NULL,
  immediate_containment TEXT NOT NULL,
  root_cause_method VARCHAR(40),
  root_cause TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATED','SUBMITTED','APPROVED','EFFECTIVE','PARTIAL','INEFFECTIVE','CANCELLED')),
  due_date DATE NOT NULL,
  failure_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (failure_cost >= 0),
  estimated_annual_avoidance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (estimated_annual_avoidance >= 0),
  supplier_claim_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (supplier_claim_amount >= 0),
  supplier_recovered_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (supplier_recovered_amount >= 0),
  realized_annual_avoidance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (realized_annual_avoidance >= 0),
  approval_note TEXT,
  effectiveness_result TEXT,
  verification_evidence TEXT,
  created_by UUID NOT NULL,
  investigated_by UUID,
  submitted_by UUID,
  approved_by UUID,
  verified_by UUID,
  investigated_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, capa_number)
);

CREATE TABLE IF NOT EXISTS public.quality_capa_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  capa_id UUID NOT NULL REFERENCES public.quality_capa_cases(id) ON DELETE CASCADE,
  action_type VARCHAR(24) NOT NULL CHECK (action_type IN ('CONTAINMENT','CORRECTIVE','PREVENTIVE','SCAR')),
  action_description TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED')),
  completion_evidence TEXT,
  completed_by UUID,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_capa_tenant_status ON public.quality_capa_cases (tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_quality_capa_vendor ON public.quality_capa_cases (tenant_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_quality_capa_actions_case ON public.quality_capa_actions (tenant_id, capa_id, status, due_date);
