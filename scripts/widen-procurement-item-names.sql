-- Allow detailed OEM/R&D item descriptions to flow through Item -> PR -> PO.
-- Existing values are preserved; VARCHAR(200) is widened to unbounded TEXT.

ALTER TABLE public.items
  ALTER COLUMN name TYPE TEXT;

ALTER TABLE public.purchase_requisition_items
  ALTER COLUMN item_name TYPE TEXT;

ALTER TABLE public.purchase_order_items
  ALTER COLUMN item_name TYPE TEXT;

COMMENT ON COLUMN public.items.name IS
  'Item display name; supports complete OEM and R&D descriptions.';
COMMENT ON COLUMN public.purchase_requisition_items.item_name IS
  'Item name snapshot retained without truncating the material description.';
COMMENT ON COLUMN public.purchase_order_items.item_name IS
  'Item name snapshot retained without truncating the material description.';

NOTIFY pgrst, 'reload schema';
