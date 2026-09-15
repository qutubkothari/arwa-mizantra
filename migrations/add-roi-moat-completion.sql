-- Production-grade value calculation, delivery and renewal controls.
ALTER TABLE public.value_source_benefits ADD COLUMN IF NOT EXISTS baseline_id UUID REFERENCES public.value_baselines(id) ON DELETE SET NULL;
ALTER TABLE public.value_source_benefits ADD COLUMN IF NOT EXISTS outcome_volume NUMERIC(18,4);
ALTER TABLE public.value_source_benefits ADD COLUMN IF NOT EXISTS outcome_date DATE;

CREATE TABLE IF NOT EXISTS public.value_renewal_profiles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL UNIQUE,
 renewal_date DATE NOT NULL, contracted_arr NUMERIC(18,2) NOT NULL DEFAULT 0, adoption_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(adoption_score BETWEEN 0 AND 100),
 account_owner_id UUID, account_owner_reference TEXT, action_plan TEXT, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','AT_RISK','RENEWED','CHURNED')),
 created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.value_client_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, statement_id UUID NOT NULL REFERENCES public.value_roi_statements(id) ON DELETE CASCADE,
 delivery_channel VARCHAR(20) NOT NULL CHECK(delivery_channel IN ('PORTAL','EMAIL','EXPORT')), recipient_reference TEXT NOT NULL,
 scheduled_for TIMESTAMPTZ NOT NULL, delivered_at TIMESTAMPTZ, status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','DELIVERED','FAILED','CANCELLED')),
 created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.value_country_rule_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, rule_code VARCHAR(50) NOT NULL, period_from DATE NOT NULL, period_to DATE NOT NULL,
 value_amount NUMERIC(18,2) NOT NULL DEFAULT 0, currency VARCHAR(3) NOT NULL, evidence JSONB NOT NULL DEFAULT '{}'::jsonb, status VARCHAR(20) NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','NO_DATA','REVIEW')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,rule_code,period_from,period_to)
);
CREATE INDEX IF NOT EXISTS idx_value_client_deliveries_due ON public.value_client_deliveries(tenant_id,status,scheduled_for);
