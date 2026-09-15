-- IFRS 16 lease-accounting control. Calculates schedules and journal previews only; never posts GL entries.
CREATE TABLE IF NOT EXISTS lease_accounting_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  lease_code VARCHAR(50) NOT NULL, lease_type VARCHAR(20) NOT NULL CHECK (lease_type IN ('PROPERTY','EQUIPMENT','VEHICLE','OTHER')),
  lessor_name VARCHAR(180) NOT NULL, asset_description TEXT NOT NULL, commencement_date DATE NOT NULL, end_date DATE NOT NULL,
  payment_frequency VARCHAR(12) NOT NULL CHECK (payment_frequency IN ('MONTHLY','QUARTERLY','ANNUAL')),
  periodic_payment NUMERIC(18,2) NOT NULL CHECK (periodic_payment > 0), discount_rate_pct NUMERIC(9,4) NOT NULL CHECK (discount_rate_pct BETWEEN 0 AND 100),
  initial_direct_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (initial_direct_cost >= 0), lease_incentives NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (lease_incentives >= 0),
  initial_lease_liability NUMERIC(18,2) NOT NULL, initial_rou_asset NUMERIC(18,2) NOT NULL,
  renewal_notice_date DATE, contract_evidence TEXT NOT NULL,
  rou_asset_account_id UUID REFERENCES accounting_accounts(id), lease_liability_account_id UUID REFERENCES accounting_accounts(id),
  interest_expense_account_id UUID REFERENCES accounting_accounts(id), depreciation_expense_account_id UUID REFERENCES accounting_accounts(id),
  accumulated_depreciation_account_id UUID REFERENCES accounting_accounts(id),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  terminated_by UUID, termination_evidence TEXT, terminated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, lease_code), CHECK (end_date > commencement_date)
);
CREATE TABLE IF NOT EXISTS lease_accounting_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  lease_id UUID NOT NULL REFERENCES lease_accounting_contracts(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL CHECK (period_number > 0), due_date DATE NOT NULL,
  opening_liability NUMERIC(18,2) NOT NULL, interest_expense NUMERIC(18,2) NOT NULL,
  lease_payment NUMERIC(18,2) NOT NULL, principal_reduction NUMERIC(18,2) NOT NULL,
  closing_liability NUMERIC(18,2) NOT NULL, rou_depreciation NUMERIC(18,2) NOT NULL,
  UNIQUE (lease_id, period_number)
);
CREATE TABLE IF NOT EXISTS lease_accounting_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  lease_id UUID NOT NULL REFERENCES lease_accounting_contracts(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('MODIFICATION','RENEWAL','IMPAIRMENT','TERMINATION')),
  effective_date DATE NOT NULL, financial_impact NUMERIC(18,2) NOT NULL DEFAULT 0,
  event_description TEXT NOT NULL, event_evidence TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  created_by UUID NOT NULL, approved_by UUID, approval_note TEXT, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lease_contract_tenant_status ON lease_accounting_contracts (tenant_id, status, end_date);
CREATE INDEX IF NOT EXISTS idx_lease_schedule_tenant_due ON lease_accounting_schedule (tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_lease_events_tenant_status ON lease_accounting_events (tenant_id, status, effective_date);
