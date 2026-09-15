-- Preserve approved quotations and create traceable draft revisions.

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS revised_from_quotation_id UUID
    REFERENCES public.quotations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_quotations_revised_from
  ON public.quotations(revised_from_quotation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotations_single_direct_revision
  ON public.quotations(revised_from_quotation_id)
  WHERE revised_from_quotation_id IS NOT NULL;

COMMENT ON COLUMN public.quotations.revised_from_quotation_id IS
  'Immutable predecessor quotation from which this commercial revision was created.';
