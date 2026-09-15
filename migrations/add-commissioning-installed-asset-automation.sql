-- A confirmed commissioning creates the customer installed-base record.
-- Dispatch records remain shipment traceability only: no asset is created until
-- an authorised user confirms that the UID has been installed/commissioned.
ALTER TABLE public.product_deployment_history
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commissioning_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commissioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commissioned_by UUID,
  ADD COLUMN IF NOT EXISTS installed_asset_id UUID REFERENCES public.service_installed_assets(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_deployment_commissioning
  ON public.product_deployment_history (tenant_id, commissioning_confirmed, customer_id, deployment_date DESC);

CREATE INDEX IF NOT EXISTS idx_deployment_installed_asset
  ON public.product_deployment_history (tenant_id, installed_asset_id)
  WHERE installed_asset_id IS NOT NULL;

COMMENT ON COLUMN public.product_deployment_history.commissioning_confirmed IS
  'Explicit confirmation that the UID is installed/commissioned. Only this event may create an installed-base asset.';
