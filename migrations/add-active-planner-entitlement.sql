-- Register the prompt-based Active Planner in the client feature catalogue.
-- Existing tenants on this database remain enabled; the Master Admin may
-- disable it per client from Feature Access without changing role permissions.
INSERT INTO public.app_feature_catalogue
  (feature_key, feature_name, module_name, description, screen_route, route_match, api_prefixes, display_order, is_active)
VALUES
  ('active-planner', 'Active Planner', 'Intelligence',
   'Prompt-based preparation of validated ERP drafts with native approval controls preserved.',
   '/dashboard/active-planner', 'PREFIX', ARRAY['/active-planner'], 25, TRUE)
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
SELECT id, 'active-planner', TRUE FROM public.tenants
ON CONFLICT (tenant_id, feature_key) DO NOTHING;
