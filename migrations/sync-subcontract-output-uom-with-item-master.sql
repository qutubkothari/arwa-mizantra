-- Keep subcontract output UOM aligned with the authoritative Stock Master item UOM.
-- Safe to run repeatedly; only mismatched rows are changed.

UPDATE public.subcontract_route_steps AS step
SET output_uom = UPPER(TRIM(item.uom))
FROM public.items AS item
WHERE step.output_item_id = item.id
  AND step.tenant_id = item.tenant_id
  AND NULLIF(TRIM(item.uom), '') IS NOT NULL
  AND COALESCE(UPPER(TRIM(step.output_uom)), '') IS DISTINCT FROM UPPER(TRIM(item.uom));

UPDATE public.subcontract_order_steps AS step
SET output_uom = UPPER(TRIM(item.uom)),
    updated_at = NOW()
FROM public.items AS item
WHERE step.output_item_id = item.id
  AND step.tenant_id = item.tenant_id
  AND NULLIF(TRIM(item.uom), '') IS NOT NULL
  AND COALESCE(UPPER(TRIM(step.output_uom)), '') IS DISTINCT FROM UPPER(TRIM(item.uom));
