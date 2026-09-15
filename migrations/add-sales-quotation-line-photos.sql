BEGIN;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS terms_conditions TEXT;

ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
