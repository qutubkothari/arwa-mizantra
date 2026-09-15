-- Procurement contracts, price ceilings, consumption and off-contract controls.
-- Contract linkage validates POs but never creates, approves or posts them.
CREATE TABLE IF NOT EXISTS public.procurement_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  contract_number VARCHAR(80) NOT NULL, title VARCHAR(220) NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id), contract_type VARCHAR(24) NOT NULL DEFAULT 'VALUE' CHECK(contract_type IN ('VALUE','QUANTITY','FRAMEWORK')),
  start_date DATE NOT NULL, end_date DATE NOT NULL, currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  committed_value NUMERIC(18,2) NOT NULL CHECK(committed_value > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','SUSPENDED','CLOSED')),
  owner_user_id UUID, terms_reference TEXT, created_by UUID NOT NULL,
  activated_by UUID, activated_at TIMESTAMPTZ, activation_evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,contract_number), CHECK(end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS public.procurement_contract_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL REFERENCES public.procurement_contracts(id) ON DELETE CASCADE,
  item_code VARCHAR(120) NOT NULL, item_name VARCHAR(220), uom VARCHAR(30),
  ceiling_unit_price NUMERIC(18,2) NOT NULL CHECK(ceiling_unit_price > 0), committed_quantity NUMERIC(18,3),
  source_award_id UUID REFERENCES public.sourcing_award_decisions(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contract_id,item_code)
);
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS procurement_contract_id UUID REFERENCES public.procurement_contracts(id),
  ADD COLUMN IF NOT EXISTS contract_compliance_status VARCHAR(24) NOT NULL DEFAULT 'NOT_LINKED',
  ADD COLUMN IF NOT EXISTS contract_exception_reason TEXT,
  ADD COLUMN IF NOT EXISTS contract_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_checked_by UUID;
CREATE INDEX IF NOT EXISTS idx_procurement_contracts_active ON public.procurement_contracts(tenant_id,status,end_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_contract ON public.purchase_orders(tenant_id,procurement_contract_id,po_date);

