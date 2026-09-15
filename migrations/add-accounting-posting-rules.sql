-- Mizantra/test: Finance-controlled source posting templates.
-- Rules are deliberately inactive by default. They define a reviewed debit and
-- credit mapping before any future operational auto-posting is enabled.
CREATE TABLE IF NOT EXISTS public.accounting_posting_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_code VARCHAR(80) NOT NULL,
  rule_name VARCHAR(180) NOT NULL,
  source_type VARCHAR(60) NOT NULL CHECK (source_type IN (
    'SALES_INVOICE', 'SALES_RECEIPT', 'PURCHASE_INVOICE', 'SUPPLIER_PAYMENT',
    'STOCK_RECEIPT', 'STOCK_ISSUE', 'PAYROLL', 'MANUAL_ADJUSTMENT'
  )),
  debit_account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  credit_account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  tax_account_id UUID REFERENCES public.accounting_accounts(id),
  narration_template TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, rule_code),
  CHECK (debit_account_id <> credit_account_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_posting_rules_tenant
  ON public.accounting_posting_rules (tenant_id, source_type, is_active);

COMMENT ON TABLE public.accounting_posting_rules IS
  'Finance-approved debit/credit mappings for operational source documents. Rules start inactive and must be explicitly enabled after review.';
