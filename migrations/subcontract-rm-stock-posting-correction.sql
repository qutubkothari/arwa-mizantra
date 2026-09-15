BEGIN;

-- Subcontract RM is deducted once when the Material Outward Challan is posted.
-- Vendor WIP is maintained in subcontract_movements, not inventory_stock.
WITH corrections AS (
  SELECT tenant_id,
         item_id,
         to_warehouse_id AS warehouse_id,
         -SUM(quantity)::numeric AS quantity_delta
  FROM public.stock_movements
  WHERE reference_type = 'SUBCONTRACTING'
    AND notes ILIKE 'Material Outward Challan%route-level issue to subcontractor%'
    AND from_warehouse_id IS NOT NULL
    AND to_warehouse_id IS NOT NULL
  GROUP BY tenant_id, item_id, to_warehouse_id

  UNION ALL

  SELECT tenant_id,
         item_id,
         from_warehouse_id AS warehouse_id,
         SUM(quantity)::numeric AS quantity_delta
  FROM public.stock_movements
  WHERE reference_type = 'SUBCONTRACTING'
    AND notes ILIKE 'Subcontract receipt%consumed vendor-held WIP%'
    AND from_warehouse_id IS NOT NULL
    AND to_warehouse_id IS NULL
  GROUP BY tenant_id, item_id, from_warehouse_id
), totals AS (
  SELECT tenant_id, item_id, warehouse_id, SUM(quantity_delta) AS quantity_delta
  FROM corrections
  GROUP BY tenant_id, item_id, warehouse_id
)
UPDATE public.inventory_stock stock
SET quantity = CASE
      WHEN ABS(COALESCE(stock.quantity, 0) + totals.quantity_delta) < 0.02 THEN 0
      ELSE COALESCE(stock.quantity, 0) + totals.quantity_delta
    END,
    updated_at = NOW()
FROM totals
WHERE stock.item_id = totals.item_id
  AND stock.tenant_id = totals.tenant_id
  AND stock.warehouse_id = totals.warehouse_id;

UPDATE public.stock_movements
SET to_warehouse_id = NULL,
    notes = regexp_replace(notes, ' - route-level issue to subcontractor$', ' - raw material issued to subcontractor')
WHERE reference_type = 'SUBCONTRACTING'
  AND notes ILIKE 'Material Outward Challan%route-level issue to subcontractor%'
  AND from_warehouse_id IS NOT NULL
  AND to_warehouse_id IS NOT NULL;

-- Consumption remains recorded on subcontract_movements / receipt lines for
-- reconciliation, but must not exist as a second inventory transaction.
DELETE FROM public.stock_movements
WHERE reference_type = 'SUBCONTRACTING'
  AND notes ILIKE 'Subcontract receipt%consumed vendor-held WIP%'
  AND from_warehouse_id IS NOT NULL
  AND to_warehouse_id IS NULL;

COMMIT;
