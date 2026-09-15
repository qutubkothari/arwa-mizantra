ALTER TABLE public.items ADD COLUMN IF NOT EXISTS product_size NUMERIC(18,4);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS product_size_uom VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'items_product_size_non_negative'
      AND conrelid = 'public.items'::regclass
  ) THEN
    ALTER TABLE public.items ADD CONSTRAINT items_product_size_non_negative
      CHECK (product_size IS NULL OR product_size > 0) NOT VALID;
  END IF;
END $$;
