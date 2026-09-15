CREATE TABLE IF NOT EXISTS public.production_machine_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, work_station_id UUID NOT NULL,
 source_event_id VARCHAR(160) NOT NULL, event_type VARCHAR(30) NOT NULL CHECK(event_type IN ('RUN','IDLE','STOP','COUNT','QUALITY','ENERGY','CONDITION')),
 occurred_at TIMESTAMPTZ NOT NULL, cycle_seconds NUMERIC(12,3), good_count NUMERIC(18,3), reject_count NUMERIC(18,3),
 energy_kwh NUMERIC(18,4), temperature_c NUMERIC(10,3), vibration_mm_s NUMERIC(10,3), payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,work_station_id,source_event_id)
);
CREATE TABLE IF NOT EXISTS public.production_machine_states (
 tenant_id UUID NOT NULL, work_station_id UUID NOT NULL, machine_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
 last_event_at TIMESTAMPTZ, last_cycle_seconds NUMERIC(12,3), good_count NUMERIC(18,3) NOT NULL DEFAULT 0, reject_count NUMERIC(18,3) NOT NULL DEFAULT 0,
 energy_kwh NUMERIC(18,4) NOT NULL DEFAULT 0, temperature_c NUMERIC(10,3), vibration_mm_s NUMERIC(10,3), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,work_station_id)
);
CREATE TABLE IF NOT EXISTS public.production_machine_alerts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, work_station_id UUID NOT NULL, event_id UUID REFERENCES public.production_machine_events(id) ON DELETE SET NULL,
 alert_type VARCHAR(40) NOT NULL, severity VARCHAR(12) NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), title TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb,
 status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_machine_events_recent ON public.production_machine_events(tenant_id,work_station_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_machine_alerts_open ON public.production_machine_alerts(tenant_id,status,created_at DESC);
