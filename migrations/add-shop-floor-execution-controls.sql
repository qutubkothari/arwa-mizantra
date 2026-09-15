-- Controlled shop-floor time and quantity evidence.
-- Additive only; NOT VALID constraints protect new/changed rows without making
-- deployment depend on the quality of historical completion records.
ALTER TABLE public.station_completions
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_paused_minutes NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_by UUID;

ALTER TABLE public.station_completions
  DROP CONSTRAINT IF EXISTS station_completion_nonnegative_quantities,
  ADD CONSTRAINT station_completion_nonnegative_quantities
    CHECK (quantity_completed >= 0 AND quantity_rejected >= 0) NOT VALID,
  DROP CONSTRAINT IF EXISTS station_completion_nonnegative_time,
  ADD CONSTRAINT station_completion_nonnegative_time
    CHECK (total_paused_minutes >= 0 AND (actual_time_minutes IS NULL OR actual_time_minutes >= 0)) NOT VALID,
  DROP CONSTRAINT IF EXISTS station_completion_completed_evidence,
  ADD CONSTRAINT station_completion_completed_evidence
    CHECK (
      status <> 'COMPLETED'
      OR (
        end_time IS NOT NULL
        AND completed_by IS NOT NULL
        AND quantity_completed + quantity_rejected > 0
      )
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_station_completions_active_operator
  ON public.station_completions (tenant_id, operator_id, status)
  WHERE status IN ('IN_PROGRESS', 'PAUSED');

COMMENT ON COLUMN public.station_completions.total_paused_minutes IS
  'Accumulated paused duration excluded from actual operation time.';
COMMENT ON COLUMN public.station_completions.completed_by IS
  'Operator identity captured when the completion quantity is finalized.';

INSERT INTO public.app_feature_catalogue
  (feature_key, feature_name, module_name, description, screen_route, route_match, api_prefixes, display_order)
VALUES
  ('production-shop-floor','Shop Floor','Production','Controlled operator queue, WIP transfer, pause/resume and completion evidence.','/dashboard/shop-floor','EXACT',ARRAY['/production/completions'],415),
  ('production-work-stations','Work Stations','Production','Production work-station master data.','/dashboard/work-stations','EXACT',ARRAY['/production/work-stations'],416)
ON CONFLICT (feature_key) DO UPDATE SET
  feature_name = EXCLUDED.feature_name,
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  screen_route = EXCLUDED.screen_route,
  route_match = EXCLUDED.route_match,
  api_prefixes = EXCLUDED.api_prefixes,
  display_order = EXCLUDED.display_order,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO public.tenant_feature_entitlements (tenant_id, feature_key, is_enabled)
SELECT tenant.id, feature.feature_key, TRUE
FROM public.tenants tenant
CROSS JOIN public.app_feature_catalogue feature
WHERE feature.feature_key IN ('production-shop-floor','production-work-stations')
ON CONFLICT (tenant_id, feature_key) DO NOTHING;
