-- Allow the commercial quantity UOM and the price basis UOM to differ.
-- Example: order 100 CTN, price at INR 2 per PCS.
ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS price_uom varchar(20),
  ADD COLUMN IF NOT EXISTS price_uom_factor numeric(24,10) NOT NULL DEFAULT 1;
ALTER TABLE public.sales_order_items
  ADD COLUMN IF NOT EXISTS price_uom varchar(20),
  ADD COLUMN IF NOT EXISTS price_uom_factor numeric(24,10) NOT NULL DEFAULT 1;
ALTER TABLE public.sales_invoice_items
  ADD COLUMN IF NOT EXISTS price_uom varchar(20),
  ADD COLUMN IF NOT EXISTS price_uom_factor numeric(24,10) NOT NULL DEFAULT 1;

UPDATE public.quotation_items
SET price_uom = COALESCE(NULLIF(price_uom, ''), ordered_uom, base_uom, 'PCS')
WHERE price_uom IS NULL;
UPDATE public.quotation_items
SET price_uom_factor = CASE
  WHEN upper(price_uom) = upper(COALESCE(base_uom, price_uom)) THEN 1
  ELSE COALESCE(NULLIF(uom_conversion_factor, 0), 1)
END;

ALTER TABLE public.quotation_items DROP CONSTRAINT IF EXISTS quotation_items_price_uom_factor_check;
ALTER TABLE public.quotation_items ADD CONSTRAINT quotation_items_price_uom_factor_check CHECK (price_uom_factor > 0);
ALTER TABLE public.sales_order_items DROP CONSTRAINT IF EXISTS sales_order_items_price_uom_factor_check;
ALTER TABLE public.sales_order_items ADD CONSTRAINT sales_order_items_price_uom_factor_check CHECK (price_uom_factor > 0);
ALTER TABLE public.sales_invoice_items DROP CONSTRAINT IF EXISTS sales_invoice_items_price_uom_factor_check;
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT sales_invoice_items_price_uom_factor_check CHECK (price_uom_factor > 0);
UPDATE public.sales_order_items
SET price_uom = COALESCE(NULLIF(price_uom, ''), ordered_uom, base_uom, 'PCS')
WHERE price_uom IS NULL;
UPDATE public.sales_order_items
SET price_uom_factor = CASE
  WHEN upper(price_uom) = upper(COALESCE(base_uom, price_uom)) THEN 1
  ELSE COALESCE(NULLIF(uom_conversion_factor, 0), 1)
END;
UPDATE public.sales_invoice_items
SET price_uom = COALESCE(NULLIF(price_uom, ''), ordered_uom, base_uom, 'PCS')
WHERE price_uom IS NULL;
UPDATE public.sales_invoice_items
SET price_uom_factor = CASE
  WHEN upper(price_uom) = upper(COALESCE(base_uom, price_uom)) THEN 1
  ELSE COALESCE(NULLIF(uom_conversion_factor, 0), 1)
END;
