-- Complete maker/checker decision metadata for sales quotations.

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS rejected_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quotations_rejected_by
  ON public.quotations(rejected_by)
  WHERE rejected_by IS NOT NULL;

COMMENT ON COLUMN public.quotations.rejected_by IS
  'User who formally rejected the quotation under maker/checker control.';
COMMENT ON COLUMN public.quotations.rejected_at IS
  'Timestamp of the formal quotation rejection decision.';
