-- Commissioning is the operational handover point. This records the
-- automatically-created warranty entitlement so it is traceable and idempotent.
ALTER TABLE public.product_deployment_history
  ADD COLUMN IF NOT EXISTS warranty_entitlement_id UUID
    REFERENCES public.service_contracts(id) ON DELETE SET NULL;

ALTER TABLE public.service_contracts
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_contracts_source
  ON public.service_contracts (tenant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deployment_warranty_entitlement
  ON public.product_deployment_history (tenant_id, warranty_entitlement_id)
  WHERE warranty_entitlement_id IS NOT NULL;

COMMENT ON COLUMN public.product_deployment_history.warranty_entitlement_id IS
  'Active WARRANTY service-contract entitlement generated when commissioning is confirmed.';
COMMENT ON COLUMN public.service_contracts.source_type IS
  'Origin of a system-created service entitlement, for example COMMISSIONING_WARRANTY.';
