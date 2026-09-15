CREATE TABLE IF NOT EXISTS public.mizantra_factory_health_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  forecast_date DATE NOT NULL,
  target_date DATE NOT NULL,
  predicted_score NUMERIC(7,2) NOT NULL CHECK (predicted_score BETWEEN 0 AND 100),
  actual_score NUMERIC(7,2) CHECK (actual_score BETWEEN 0 AND 100),
  absolute_error NUMERIC(7,2) CHECK (absolute_error >= 0),
  data_classification TEXT NOT NULL DEFAULT 'OPERATING_HISTORY'
    CHECK (data_classification IN ('OPERATING_HISTORY', 'TEST_SIMULATION')),
  methodology TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, forecast_date, target_date)
);

CREATE INDEX IF NOT EXISTS idx_mizantra_factory_health_forecasts_tenant_target
  ON public.mizantra_factory_health_forecasts (tenant_id, target_date DESC);

ALTER TABLE public.mizantra_factory_health_forecasts ENABLE ROW LEVEL SECURITY;
