-- Mizantra/test: explicit finance-role assignments and idempotent operational
-- posting register. These controls do not alter historical operational data.

CREATE TABLE IF NOT EXISTS public.accounting_workflow_role_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  workflow_role VARCHAR(30) NOT NULL CHECK (workflow_role IN (
    'JOURNAL_PREPARER', 'JOURNAL_REVIEWER', 'JOURNAL_APPROVER', 'JOURNAL_POSTER',
    'PAYMENT_PREPARER', 'PAYMENT_APPROVER', 'PAYMENT_POSTER'
  )),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, workflow_role)
);

CREATE TABLE IF NOT EXISTS public.accounting_source_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type VARCHAR(60) NOT NULL,
  source_id UUID NOT NULL,
  source_number VARCHAR(100),
  posting_rule_id UUID REFERENCES public.accounting_posting_rules(id) ON DELETE SET NULL,
  journal_id UUID REFERENCES public.accounting_journals(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT_CREATED' CHECK (status IN ('DRAFT_CREATED','POSTED','FAILED','REVERSED')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  error_message TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_type, source_id)
);

ALTER TABLE public.accounting_posting_rules
  DROP CONSTRAINT IF EXISTS accounting_posting_rules_source_type_check;
ALTER TABLE public.accounting_posting_rules
  ADD CONSTRAINT accounting_posting_rules_source_type_check CHECK (source_type IN (
    'SALES_INVOICE', 'SALES_RECEIPT', 'PURCHASE_INVOICE', 'SUPPLIER_PAYMENT',
    'STOCK_RECEIPT', 'STOCK_ISSUE', 'STOCK_ADJUSTMENT', 'PAYROLL', 'PAYROLL_RUN',
    'SERVICE_INVOICE', 'SUBCONTRACT_RECEIPT', 'GRN', 'MANUAL_ADJUSTMENT'
  ));

CREATE INDEX IF NOT EXISTS idx_accounting_workflow_roles_tenant
  ON public.accounting_workflow_role_assignments (tenant_id, workflow_role, is_active);
CREATE INDEX IF NOT EXISTS idx_accounting_source_postings_tenant
  ON public.accounting_source_postings (tenant_id, source_type, status, created_at DESC);

COMMENT ON TABLE public.accounting_workflow_role_assignments IS
  'Explicit role assignments used by the Finance maker-checker workflow. When assignments exist for a stage, that stage is restricted to assigned users.';
COMMENT ON TABLE public.accounting_source_postings IS
  'Idempotent register linking Sales, Purchase, GRN, stock, payroll, service and subcontract sources to their generated GL voucher.';
