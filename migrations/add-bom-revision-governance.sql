-- Govern BOM revisions before they can influence MRP.
-- Existing active BOMs are preserved as approved revisions; new revisions
-- start as drafts and require an independent approver.
BEGIN;

ALTER TABLE public.bom_headers
  ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS revision_reason TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT,
  ADD COLUMN IF NOT EXISTS retired_by UUID,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retirement_note TEXT;

UPDATE public.bom_headers
SET lifecycle_status = CASE WHEN is_active THEN 'APPROVED' ELSE 'RETIRED' END,
    approved_at = CASE WHEN is_active THEN COALESCE(updated_at, created_at, NOW()) ELSE approved_at END,
    approval_note = CASE WHEN is_active THEN COALESCE(approval_note, 'Existing active BOM approved during governance migration.') ELSE approval_note END
WHERE lifecycle_status = 'DRAFT'
  AND created_by IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bom_headers_lifecycle_status_check'
      AND conrelid = 'public.bom_headers'::regclass
  ) THEN
    ALTER TABLE public.bom_headers
      ADD CONSTRAINT bom_headers_lifecycle_status_check
      CHECK (lifecycle_status IN ('DRAFT','SUBMITTED','APPROVED','RETIRED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.bom_revision_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES public.bom_headers(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL
    CHECK (event_type IN ('CREATED','UPDATED','SUBMITTED','APPROVED','RETIRED')),
  from_status VARCHAR(16),
  to_status VARCHAR(16) NOT NULL,
  note TEXT,
  acted_by UUID,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_revision_events_tenant_bom
  ON public.bom_revision_events (tenant_id, bom_id, acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_bom_headers_planning_effectivity
  ON public.bom_headers
  (tenant_id, item_id, lifecycle_status, is_active, effective_from, effective_to, version DESC);

COMMENT ON TABLE public.bom_revision_events IS
  'Immutable maker-checker history for BOM revision lifecycle changes.';

COMMIT;
