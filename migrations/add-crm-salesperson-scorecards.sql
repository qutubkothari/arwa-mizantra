-- CRM salesperson scorecards
-- Additive extension of monthly targets. Existing target rows and live ERP data are preserved.

BEGIN;

ALTER TABLE public.crm_sales_targets
  ADD COLUMN IF NOT EXISTS target_calls INTEGER NOT NULL DEFAULT 0 CHECK (target_calls >= 0),
  ADD COLUMN IF NOT EXISTS target_visits INTEGER NOT NULL DEFAULT 0 CHECK (target_visits >= 0),
  ADD COLUMN IF NOT EXISTS target_quotations INTEGER NOT NULL DEFAULT 0 CHECK (target_quotations >= 0),
  ADD COLUMN IF NOT EXISTS target_collections NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_collections >= 0);

CREATE TABLE IF NOT EXISTS public.crm_sales_target_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES public.crm_sales_targets(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  target_quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (target_quantity >= 0),
  target_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_value >= 0),
  uom VARCHAR(40),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_target_products_tenant
  ON public.crm_sales_target_products (tenant_id, target_id);

CREATE INDEX IF NOT EXISTS idx_crm_sales_target_products_item
  ON public.crm_sales_target_products (tenant_id, item_id);

COMMENT ON TABLE public.crm_sales_target_products IS
  'Monthly product quantity/value targets for a salesperson or territory; actuals are attributed through posted sales invoices and their source sales order owner.';

COMMIT;
