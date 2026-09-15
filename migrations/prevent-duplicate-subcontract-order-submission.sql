-- A new subcontract order must be created once even if a browser retries the
-- same save request. Existing historical orders have a null request ID and are
-- unaffected.
ALTER TABLE public.subcontract_orders
  ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_orders_tenant_client_request
  ON public.subcontract_orders(tenant_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
