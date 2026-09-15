-- Complete the tenant migration for historical GRN line items.
-- The tenant is authoritative on the parent GRN.

UPDATE public.grn_items AS item
SET tenant_id = receipt.tenant_id
FROM public.grns AS receipt
WHERE item.grn_id = receipt.id
  AND item.tenant_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.grn_items
    WHERE tenant_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce grn_items tenant: unresolved rows remain';
  END IF;
END $$;

ALTER TABLE public.grn_items
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.grn_items
  DROP CONSTRAINT IF EXISTS grn_items_tenant_id_fkey;

ALTER TABLE public.grn_items
  ADD CONSTRAINT grn_items_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_grn_items_tenant
  ON public.grn_items(tenant_id);

