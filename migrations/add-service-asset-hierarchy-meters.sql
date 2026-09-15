-- Installed-base hierarchy and usage-meter maintenance controls.
ALTER TABLE public.service_installed_assets
  ADD COLUMN IF NOT EXISTS parent_asset_id UUID REFERENCES public.service_installed_assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS functional_location TEXT,
  ADD COLUMN IF NOT EXISTS criticality VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
    CHECK (criticality IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS model_number TEXT;

CREATE INDEX IF NOT EXISTS idx_service_installed_assets_parent
  ON public.service_installed_assets(tenant_id, parent_asset_id);

CREATE TABLE IF NOT EXISTS public.service_asset_meters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  installed_asset_id UUID NOT NULL REFERENCES public.service_installed_assets(id) ON DELETE CASCADE,
  meter_name TEXT NOT NULL,
  uom VARCHAR(30) NOT NULL,
  rollover_value NUMERIC(18,3),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, installed_asset_id, meter_name)
);

CREATE TABLE IF NOT EXISTS public.service_asset_meter_readings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  meter_id UUID NOT NULL REFERENCES public.service_asset_meters(id) ON DELETE RESTRICT,
  reading_value NUMERIC(18,3) NOT NULL CHECK (reading_value >= 0),
  reading_at TIMESTAMPTZ NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('MANUAL','SERVICE_VISIT','IOT','IMPORT')),
  service_ticket_id UUID REFERENCES public.service_tickets(id) ON DELETE SET NULL,
  notes TEXT,
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (meter_id, reading_at)
);

CREATE INDEX IF NOT EXISTS idx_service_asset_meter_readings_latest
  ON public.service_asset_meter_readings(tenant_id, meter_id, reading_at DESC);

ALTER TABLE public.preventive_maintenance_schedule
  ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(20) NOT NULL DEFAULT 'CALENDAR'
    CHECK (trigger_type IN ('CALENDAR','METER','WHICHEVER_FIRST')),
  ADD COLUMN IF NOT EXISTS meter_id UUID REFERENCES public.service_asset_meters(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS meter_interval NUMERIC(18,3) CHECK (meter_interval IS NULL OR meter_interval > 0),
  ADD COLUMN IF NOT EXISTS last_service_meter NUMERIC(18,3),
  ADD COLUMN IF NOT EXISTS next_service_meter NUMERIC(18,3);

NOTIFY pgrst, 'reload schema';
