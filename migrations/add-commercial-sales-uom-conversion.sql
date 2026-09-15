-- Commercial sales UOM conversion.
-- Operational quantity remains in the item base UOM; sales_quantity records
-- the quantity entered/printed in the customer's UOM (for example CTN).

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS sales_uom varchar(20),
  ADD COLUMN IF NOT EXISTS sales_uom_factor numeric(24,10),
  ADD COLUMN IF NOT EXISTS sales_whole_uom_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS sales_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS base_uom varchar(20),
  ADD COLUMN IF NOT EXISTS uom_conversion_factor numeric(24,10) NOT NULL DEFAULT 1;

ALTER TABLE public.sales_order_items
  ADD COLUMN IF NOT EXISTS sales_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS base_uom varchar(20),
  ADD COLUMN IF NOT EXISTS uom_conversion_factor numeric(24,10) NOT NULL DEFAULT 1;

ALTER TABLE public.sales_invoice_items
  ADD COLUMN IF NOT EXISTS sales_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS base_uom varchar(20),
  ADD COLUMN IF NOT EXISTS uom_conversion_factor numeric(24,10) NOT NULL DEFAULT 1;

UPDATE public.quotation_items
SET sales_quantity = quantity,
    base_uom = COALESCE(NULLIF(base_uom, ''), ordered_uom, 'PCS'),
    uom_conversion_factor = COALESCE(NULLIF(uom_conversion_factor, 0), 1)
WHERE sales_quantity IS NULL OR base_uom IS NULL;

UPDATE public.sales_order_items
SET sales_quantity = quantity,
    base_uom = COALESCE(NULLIF(base_uom, ''), ordered_uom, 'PCS'),
    uom_conversion_factor = COALESCE(NULLIF(uom_conversion_factor, 0), 1)
WHERE sales_quantity IS NULL OR base_uom IS NULL;

UPDATE public.sales_invoice_items
SET sales_quantity = quantity,
    base_uom = COALESCE(NULLIF(base_uom, ''), ordered_uom, 'PCS'),
    uom_conversion_factor = COALESCE(NULLIF(uom_conversion_factor, 0), 1)
WHERE sales_quantity IS NULL OR base_uom IS NULL;

ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_sales_uom_factor_check;
ALTER TABLE public.items ADD CONSTRAINT items_sales_uom_factor_check
  CHECK (
    (sales_uom IS NULL AND sales_uom_factor IS NULL)
    OR (sales_uom IS NOT NULL AND sales_uom_factor IS NOT NULL AND sales_uom_factor > 0)
  );

ALTER TABLE public.quotation_items DROP CONSTRAINT IF EXISTS quotation_items_uom_conversion_factor_check;
ALTER TABLE public.quotation_items ADD CONSTRAINT quotation_items_uom_conversion_factor_check
  CHECK (uom_conversion_factor > 0);

ALTER TABLE public.sales_order_items DROP CONSTRAINT IF EXISTS sales_order_items_uom_conversion_factor_check;
ALTER TABLE public.sales_order_items ADD CONSTRAINT sales_order_items_uom_conversion_factor_check
  CHECK (uom_conversion_factor > 0);

ALTER TABLE public.sales_invoice_items DROP CONSTRAINT IF EXISTS sales_invoice_items_uom_conversion_factor_check;
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT sales_invoice_items_uom_conversion_factor_check
  CHECK (uom_conversion_factor > 0);
