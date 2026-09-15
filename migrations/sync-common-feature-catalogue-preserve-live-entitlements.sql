BEGIN;

-- These screens exist in the common application release but were absent from
-- the older live feature catalogue. Register them without granting access.
INSERT INTO public.app_feature_catalogue
  (feature_key, feature_name, module_name, description, screen_route, route_match, api_prefixes, display_order)
VALUES
  ('business-transformation','Business Transformation','Reports','Objectives, KPI baselines, initiatives, corrective actions and verified business outcomes.','/dashboard/transformation','PREFIX',ARRAY['/transformation'],25),
  ('production-shop-floor','Shop Floor','Production','Controlled operator queue, WIP transfer, pause/resume and completion evidence.','/dashboard/shop-floor','EXACT',ARRAY['/production/completions'],415),
  ('production-work-stations','Work Stations','Production','Production work-station master data.','/dashboard/work-stations','EXACT',ARRAY['/production/work-stations'],416),
  ('quality-inspection-plans','Inspection Plans','Quality','Revision-controlled incoming, in-process and final inspection plans.','/dashboard/quality/inspection-plans','PREFIX',ARRAY['/quality/plans'],1005)
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO public.tenant_feature_entitlements (tenant_id, feature_key, is_enabled)
SELECT tenant.id, feature.feature_key, FALSE
FROM public.tenants tenant
CROSS JOIN public.app_feature_catalogue feature
WHERE feature.feature_key IN (
  'business-transformation',
  'production-shop-floor',
  'production-work-stations',
  'quality-inspection-plans'
)
ON CONFLICT (tenant_id, feature_key) DO NOTHING;

COMMIT;
