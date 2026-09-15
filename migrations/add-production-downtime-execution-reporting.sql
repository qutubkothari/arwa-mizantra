-- Structured production downtime captured once at the shop floor and reused by
-- OEE, APS and production reports. Additive and tenant scoped.

ALTER TABLE public.station_completions
  ADD COLUMN IF NOT EXISTS pause_loss_category VARCHAR(30),
  ADD COLUMN IF NOT EXISTS pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS pause_evidence_reference TEXT,
  ADD COLUMN IF NOT EXISTS pause_source VARCHAR(20);

ALTER TABLE public.manufacturing_downtime_events
  ALTER COLUMN shift_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS station_completion_id UUID REFERENCES public.station_completions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_order_id UUID REFERENCES public.production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_id UUID REFERENCES public.production_routing(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_station_id UUID REFERENCES public.work_stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE public.manufacturing_downtime_events
  DROP CONSTRAINT IF EXISTS manufacturing_downtime_events_loss_category_check;
ALTER TABLE public.manufacturing_downtime_events
  ADD CONSTRAINT manufacturing_downtime_events_loss_category_check
  CHECK (loss_category IN (
    'BREAKDOWN','ROLL_CHANGE','MOLD_CHANGE','CHANGEOVER','POWER','MATERIAL',
    'QUALITY','LABOUR','PLANNED','MAINTENANCE','OTHER'
  ));

ALTER TABLE public.manufacturing_downtime_events
  DROP CONSTRAINT IF EXISTS manufacturing_downtime_events_source_check;
ALTER TABLE public.manufacturing_downtime_events
  ADD CONSTRAINT manufacturing_downtime_events_source_check
  CHECK (source IN ('MANUAL','IOT','SYSTEM'));

CREATE INDEX IF NOT EXISTS idx_mfg_downtime_execution
  ON public.manufacturing_downtime_events
  (tenant_id, work_station_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfg_downtime_completion
  ON public.manufacturing_downtime_events
  (tenant_id, station_completion_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mfg_downtime_shopfloor_pause
  ON public.manufacturing_downtime_events
  (tenant_id, station_completion_id, started_at)
  WHERE station_completion_id IS NOT NULL AND started_at IS NOT NULL;

COMMENT ON COLUMN public.manufacturing_downtime_events.station_completion_id IS
  'Shop-floor execution that generated this loss event; manual and IoT events use the same ledger.';
