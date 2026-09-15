-- A purchase order may contain one commercial line per item.  Prevent
-- duplicate item rows from being inserted by any client or legacy endpoint.
-- Existing duplicate rows must be reconciled before applying this migration.
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_items_po_item
  ON public.purchase_order_items (po_id, item_id)
  WHERE item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_items_po_code
  ON public.purchase_order_items (po_id, item_code)
  WHERE item_id IS NULL AND NULLIF(BTRIM(item_code), '') IS NOT NULL;
