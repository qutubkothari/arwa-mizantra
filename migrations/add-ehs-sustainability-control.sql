-- EHS incidents, corrective controls and evidence-backed sustainability ledger.
-- Emission factors are user-supplied and retained with evidence; this is not regulatory certification.
CREATE TABLE IF NOT EXISTS public.ehs_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  incident_number VARCHAR(40) NOT NULL, incident_date DATE NOT NULL, site VARCHAR(160) NOT NULL,
  incident_type VARCHAR(30) NOT NULL CHECK (incident_type IN ('NEAR_MISS','FIRST_AID','RECORDABLE','LOST_TIME','ENVIRONMENTAL')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  description TEXT NOT NULL, immediate_control TEXT NOT NULL, root_cause TEXT,
  lost_days NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (lost_days >= 0),
  direct_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (direct_cost >= 0),
  potential_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (potential_cost >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATED','ACTIONED','VERIFIED','CANCELLED')),
  created_by UUID NOT NULL, investigated_by UUID, verified_by UUID,
  investigated_at TIMESTAMPTZ, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, incident_number)
);

CREATE TABLE IF NOT EXISTS public.ehs_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  incident_id UUID REFERENCES public.ehs_incidents(id) ON DELETE CASCADE,
  action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('CORRECTIVE','PREVENTIVE','TRAINING','ENGINEERING','PPE','ENVIRONMENTAL')),
  action_title VARCHAR(240) NOT NULL, owner_user_id UUID NOT NULL, due_date DATE NOT NULL,
  target_annual_savings NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_annual_savings >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','VERIFIED')),
  completion_evidence TEXT, verification_evidence TEXT,
  realized_annual_savings NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (realized_annual_savings >= 0),
  created_by UUID NOT NULL, completed_by UUID, verified_by UUID,
  completed_at TIMESTAMPTZ, verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sustainability_activity_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  activity_date DATE NOT NULL, site VARCHAR(160) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('SCOPE_1','SCOPE_2','SCOPE_3','WATER','WASTE')),
  activity_type VARCHAR(160) NOT NULL, quantity NUMERIC(20,6) NOT NULL CHECK (quantity >= 0), unit VARCHAR(30) NOT NULL,
  emission_factor NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (emission_factor >= 0),
  emissions_kgco2e NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (emissions_kgco2e >= 0),
  baseline_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (baseline_quantity >= 0),
  activity_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (activity_cost >= 0), evidence_reference TEXT NOT NULL,
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehs_incidents_tenant_status ON public.ehs_incidents (tenant_id, status, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_ehs_actions_tenant_due ON public.ehs_actions (tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_sustainability_activity_tenant_date ON public.sustainability_activity_records (tenant_id, activity_date DESC, category);
