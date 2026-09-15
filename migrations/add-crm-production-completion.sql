BEGIN;

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS source_external_id TEXT,
  ADD COLUMN IF NOT EXISTS source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conversion_status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (conversion_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','FAILED')),
  ADD COLUMN IF NOT EXISTS conversion_key UUID,
  ADD COLUMN IF NOT EXISTS conversion_error TEXT,
  ADD COLUMN IF NOT EXISTS merged_into_lead_id UUID REFERENCES public.crm_leads(id),
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_by UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_lead_external_source
  ON public.crm_leads (tenant_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL AND merged_into_lead_id IS NULL;

CREATE TABLE IF NOT EXISTS public.crm_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  owner_user_id UUID,
  notification_type VARCHAR(30) NOT NULL
    CHECK (notification_type IN ('FOLLOW_UP_REMINDER','FOLLOW_UP_ESCALATION')),
  notification_date DATE NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','READ','RESOLVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE (tenant_id, lead_id, notification_type, notification_date)
);

CREATE INDEX IF NOT EXISTS idx_crm_notifications_owner
  ON public.crm_notifications (tenant_id, owner_user_id, status, created_at DESC);

INSERT INTO public.app_feature_catalogue
  (feature_key, feature_name, module_name, description, screen_route, route_match, api_prefixes, display_order, is_active)
VALUES
  ('crm-overview', 'Intelligent CRM', 'Sales Management',
   'Lead capture, intelligent assignment, pipeline, follow-ups and Customer 360.',
   '/dashboard/crm', 'PREFIX', ARRAY['/crm'], 505, TRUE)
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
SELECT id, 'crm-overview', TRUE FROM public.tenants
ON CONFLICT (tenant_id, feature_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_sync_sales_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_id UUID;
  v_lead_id UUID;
  v_from_stage UUID;
  v_actor UUID;
  v_code TEXT;
  v_probability NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'quotations' THEN
    v_code := 'QUOTATION';
    v_actor := COALESCE(
      NULLIF(to_jsonb(NEW)->>'approved_by', '')::UUID,
      NULLIF(to_jsonb(NEW)->>'created_by', '')::UUID
    );
    SELECT l.id, l.stage_id INTO v_lead_id, v_from_stage
      FROM public.crm_leads l
      JOIN public.crm_pipeline_stages s ON s.id = l.stage_id
     WHERE l.tenant_id = NEW.tenant_id
       AND l.customer_id = NEW.customer_id
       AND l.merged_into_lead_id IS NULL
       AND NOT s.is_closed
       AND (l.quotation_id IS NULL OR l.quotation_id = NEW.id)
     ORDER BY CASE WHEN l.quotation_id = NEW.id THEN 0 ELSE 1 END, l.updated_at DESC
     LIMIT 1;
  ELSIF TG_TABLE_NAME = 'sales_orders' THEN
    v_code := 'WON';
    v_actor := COALESCE(
      NULLIF(to_jsonb(NEW)->>'release_requested_by', '')::UUID,
      NULLIF(to_jsonb(NEW)->>'created_by', '')::UUID
    );
    SELECT l.id, l.stage_id INTO v_lead_id, v_from_stage
      FROM public.crm_leads l
      JOIN public.crm_pipeline_stages s ON s.id = l.stage_id
     WHERE l.tenant_id = NEW.tenant_id
       AND l.customer_id = NEW.customer_id
       AND l.merged_into_lead_id IS NULL
       AND NOT s.is_closed
       AND (NEW.quotation_id IS NULL OR l.quotation_id = NEW.quotation_id OR l.quotation_id IS NULL)
     ORDER BY CASE WHEN NEW.quotation_id IS NOT NULL AND l.quotation_id = NEW.quotation_id THEN 0 ELSE 1 END, l.updated_at DESC
     LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, probability INTO v_stage_id, v_probability FROM public.crm_pipeline_stages
   WHERE tenant_id = NEW.tenant_id AND stage_code = v_code AND is_active = TRUE
   LIMIT 1;
  IF v_stage_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.crm_leads
     SET stage_id = v_stage_id,
         probability = COALESCE(v_probability, CASE WHEN v_code = 'WON' THEN 100 ELSE probability END),
         quotation_id = CASE WHEN TG_TABLE_NAME = 'quotations' THEN NEW.id ELSE quotation_id END,
         updated_at = NOW()
   WHERE id = v_lead_id;

  IF v_from_stage IS DISTINCT FROM v_stage_id THEN
    INSERT INTO public.crm_lead_stage_history
      (tenant_id, lead_id, from_stage_id, to_stage_id, changed_by, reason)
    VALUES
      (NEW.tenant_id, v_lead_id, v_from_stage, v_stage_id, v_actor,
       CASE WHEN v_code = 'WON'
         THEN 'Automatically marked Won when the Sales Order was created.'
         ELSE 'Automatically moved to Quotation when a quotation was created.' END);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_sync_quotation ON public.quotations;
CREATE TRIGGER trg_crm_sync_quotation
AFTER INSERT OR UPDATE OF status ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.crm_sync_sales_lifecycle();

DROP TRIGGER IF EXISTS trg_crm_sync_sales_order ON public.sales_orders;
CREATE TRIGGER trg_crm_sync_sales_order
AFTER INSERT ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.crm_sync_sales_lifecycle();

COMMIT;
