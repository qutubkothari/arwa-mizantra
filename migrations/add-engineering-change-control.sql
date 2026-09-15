-- SAP-class engineering change control with cost/obsolescence exposure.
-- This control plane never mutates released BOMs or item masters automatically.
CREATE TABLE IF NOT EXISTS public.engineering_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  change_number VARCHAR(40) NOT NULL,
  title VARCHAR(240) NOT NULL,
  change_type VARCHAR(30) NOT NULL CHECK (change_type IN ('DESIGN','MATERIAL','PROCESS','SUPPLIER','QUALITY','COMPLIANCE','COST')),
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  reason TEXT NOT NULL,
  proposed_solution TEXT,
  affected_item_id UUID,
  affected_bom_id UUID,
  effective_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ASSESSED','SUBMITTED','APPROVED','REJECTED','IMPLEMENTED','VERIFIED','CANCELLED')),
  risk_score INTEGER NOT NULL DEFAULT 1 CHECK (risk_score BETWEEN 1 AND 25),
  estimated_change_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (estimated_change_cost >= 0),
  estimated_avoidance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (estimated_avoidance >= 0),
  approval_note TEXT,
  implementation_evidence TEXT,
  verification_evidence TEXT,
  realized_avoidance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (realized_avoidance >= 0),
  created_by UUID NOT NULL,
  submitted_by UUID,
  approved_by UUID,
  implemented_by UUID,
  verified_by UUID,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  implemented_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, change_number)
);

CREATE TABLE IF NOT EXISTS public.engineering_change_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  change_request_id UUID NOT NULL REFERENCES public.engineering_change_requests(id) ON DELETE CASCADE,
  impact_type VARCHAR(30) NOT NULL CHECK (impact_type IN ('INVENTORY','BOM_WHERE_USED','WORK_ORDER','SUPPLIER','CUSTOMER','QUALITY','COMPLIANCE','OTHER')),
  reference_id UUID,
  reference_label VARCHAR(240) NOT NULL,
  quantity_at_risk NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (quantity_at_risk >= 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  exposure_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (exposure_value >= 0),
  disposition VARCHAR(30) NOT NULL DEFAULT 'REVIEW' CHECK (disposition IN ('REVIEW','USE_AS_IS','REWORK','RETURN','SCRAP','PHASE_OUT','NOT_APPLICABLE')),
  source VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('AUTO','MANUAL')),
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engineering_changes_tenant_status ON public.engineering_change_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engineering_changes_item ON public.engineering_change_requests (tenant_id, affected_item_id);
CREATE INDEX IF NOT EXISTS idx_engineering_impacts_change ON public.engineering_change_impacts (tenant_id, change_request_id);
