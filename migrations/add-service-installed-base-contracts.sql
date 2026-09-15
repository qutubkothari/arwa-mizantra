-- SAP-style customer-service master data: installed base and service contracts.
-- Tickets freeze the applicable entitlement and SLA at creation time.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.service_installed_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  asset_number VARCHAR(80) NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  item_id UUID REFERENCES public.items(id) ON DELETE RESTRICT,
  uid VARCHAR(160),
  serial_number VARCHAR(160),
  asset_name TEXT NOT NULL,
  installation_date DATE,
  warranty_until DATE,
  location TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_installed_assets_number_unique UNIQUE (tenant_id, asset_number),
  CONSTRAINT service_installed_assets_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'DECOMMISSIONED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_installed_assets_uid
  ON public.service_installed_assets(tenant_id, uid)
  WHERE uid IS NOT NULL AND btrim(uid) <> '';
CREATE INDEX IF NOT EXISTS idx_service_installed_assets_customer
  ON public.service_installed_assets(tenant_id, customer_id, status);

CREATE TABLE IF NOT EXISTS public.service_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  contract_number VARCHAR(80) NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  contract_type VARCHAR(30) NOT NULL DEFAULT 'AMC',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  response_hours NUMERIC(10,2) NOT NULL DEFAULT 8 CHECK (response_hours > 0),
  resolution_hours NUMERIC(10,2) NOT NULL DEFAULT 48 CHECK (resolution_hours > 0),
  included_visits INTEGER CHECK (included_visits IS NULL OR included_visits >= 0),
  included_labor_hours NUMERIC(12,2) CHECK (included_labor_hours IS NULL OR included_labor_hours >= 0),
  contract_value NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  tax_percentage NUMERIC(7,3) NOT NULL DEFAULT 18 CHECK (tax_percentage >= 0),
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_contracts_number_unique UNIQUE (tenant_id, contract_number),
  CONSTRAINT service_contracts_type_check CHECK (contract_type IN ('AMC', 'WARRANTY', 'ON_CALL')),
  CONSTRAINT service_contracts_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT service_contracts_date_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_service_contracts_customer
  ON public.service_contracts(tenant_id, customer_id, status, end_date);

CREATE TABLE IF NOT EXISTS public.service_contract_assets (
  contract_id UUID NOT NULL REFERENCES public.service_contracts(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.service_installed_assets(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contract_id, asset_id)
);

ALTER TABLE public.service_tickets
  ADD COLUMN IF NOT EXISTS installed_asset_id UUID REFERENCES public.service_installed_assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS service_contract_id UUID REFERENCES public.service_contracts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS entitlement_status VARCHAR(30) NOT NULL DEFAULT 'CHARGEABLE';

CREATE INDEX IF NOT EXISTS idx_service_tickets_entitlement
  ON public.service_tickets(tenant_id, installed_asset_id, service_contract_id);

COMMENT ON TABLE public.service_installed_assets IS 'Customer installed base/equipment register used for service traceability.';
COMMENT ON TABLE public.service_contracts IS 'Warranty, AMC and on-call commercial service entitlement with frozen SLA targets.';

-- Existing installations of this migration may predate the item relationship.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_installed_assets_item_id_fkey'
      AND conrelid = 'public.service_installed_assets'::regclass
  ) THEN
    ALTER TABLE public.service_installed_assets
      ADD CONSTRAINT service_installed_assets_item_id_fkey
      FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE RESTRICT;
  END IF;
END $$;
