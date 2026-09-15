-- Mizantra/test: operational controls that complete the accounting workbench.
-- These are additive only. They never post an entry or send a communication by
-- themselves; finance users retain the approval and posting decision.

CREATE TABLE IF NOT EXISTS public.accounting_period_close_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.accounting_periods(id) ON DELETE CASCADE,
  task_code VARCHAR(60) NOT NULL,
  task_name VARCHAR(180) NOT NULL,
  task_group VARCHAR(40) NOT NULL DEFAULT 'CONTROL',
  is_blocking BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','COMPLETE','WAIVED')),
  owner_id UUID,
  completed_by UUID,
  completed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period_id, task_code)
);

CREATE TABLE IF NOT EXISTS public.accounting_payment_remittances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_run_id UUID NOT NULL REFERENCES public.accounting_payment_runs(id) ON DELETE CASCADE,
  payment_run_item_id UUID REFERENCES public.accounting_payment_run_items(id) ON DELETE SET NULL,
  party_id UUID REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  remittance_number VARCHAR(80) NOT NULL,
  recipient_email TEXT,
  subject TEXT,
  message_body TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','SENT','FAILED','CANCELLED')),
  sent_at TIMESTAMPTZ,
  provider_reference VARCHAR(200),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, remittance_number)
);

CREATE TABLE IF NOT EXISTS public.accounting_fx_revaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  revaluation_number VARCHAR(80) NOT NULL,
  as_of_date DATE NOT NULL,
  functional_currency_code VARCHAR(8) NOT NULL DEFAULT 'INR',
  unrealised_gain_account_id UUID REFERENCES public.accounting_accounts(id),
  unrealised_loss_account_id UUID REFERENCES public.accounting_accounts(id),
  journal_id UUID REFERENCES public.accounting_journals(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEWED','POSTED','CANCELLED')),
  total_gain NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_loss NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, revaluation_number)
);

CREATE TABLE IF NOT EXISTS public.accounting_fx_revaluation_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fx_revaluation_id UUID NOT NULL REFERENCES public.accounting_fx_revaluations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounting_accounts(id),
  currency_code VARCHAR(8) NOT NULL,
  foreign_balance NUMERIC(18,2) NOT NULL,
  historic_rate NUMERIC(18,8) NOT NULL,
  closing_rate NUMERIC(18,8) NOT NULL,
  base_balance NUMERIC(18,2) NOT NULL,
  revalued_base_balance NUMERIC(18,2) NOT NULL,
  difference_amount NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_period_close_tasks_period
  ON public.accounting_period_close_tasks (tenant_id, period_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_payment_remittances_run
  ON public.accounting_payment_remittances (tenant_id, payment_run_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_fx_revaluations_date
  ON public.accounting_fx_revaluations (tenant_id, as_of_date DESC, status);

COMMENT ON TABLE public.accounting_period_close_tasks IS 'Auditable period-end checklist. Required system checks remain in the API close checklist.';
COMMENT ON TABLE public.accounting_payment_remittances IS 'Prepared remittance advice register; actual external delivery is explicitly confirmed.';
