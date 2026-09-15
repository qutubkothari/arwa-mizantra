-- Upgrade the existing item drawing store into a controlled engineering revision register.

ALTER TABLE public.item_drawings
  ADD COLUMN IF NOT EXISTS drawing_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS revision_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(40) NOT NULL DEFAULT 'DRAWING',
  ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to DATE,
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.item_drawings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checksum VARCHAR(128),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.item_drawings
SET drawing_number = COALESCE(NULLIF(drawing_number, ''), 'DRW-' || version::text),
    revision_code = COALESCE(NULLIF(revision_code, ''), 'R' || version::text),
    lifecycle_status = CASE WHEN is_active THEN 'APPROVED' ELSE 'SUPERSEDED' END,
    effective_from = CASE WHEN is_active THEN COALESCE(effective_from, created_at::date) ELSE effective_from END,
    approved_at = CASE WHEN is_active THEN COALESCE(approved_at, created_at) ELSE approved_at END
WHERE drawing_number IS NULL OR revision_code IS NULL;

-- Historical uploads can contain the same numeric version more than once due
-- to the old client-side upload race. Preserve every row and make only the
-- duplicate revision labels deterministic before enforcing uniqueness.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, item_id, drawing_number, revision_code
           ORDER BY created_at, id
         ) AS duplicate_rank
  FROM public.item_drawings
), duplicates AS (
  SELECT id, duplicate_rank FROM ranked WHERE duplicate_rank > 1
)
UPDATE public.item_drawings d
SET revision_code = d.revision_code || '-' || duplicates.duplicate_rank::text
FROM duplicates
WHERE d.id = duplicates.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_drawing_revision
  ON public.item_drawings (tenant_id, item_id, drawing_number, revision_code);
CREATE INDEX IF NOT EXISTS idx_item_drawing_lifecycle
  ON public.item_drawings (tenant_id, item_id, lifecycle_status, effective_from DESC);

ALTER TABLE public.project_work_packages
  ADD COLUMN IF NOT EXISTS drawing_revision_id UUID REFERENCES public.item_drawings(id) ON DELETE SET NULL;
ALTER TABLE public.project_work_package_lines
  ADD COLUMN IF NOT EXISTS drawing_revision_id UUID REFERENCES public.item_drawings(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
