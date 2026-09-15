-- Complete the engineering revision digital thread and freeze it at job release.

ALTER TABLE public.bom_headers
  ADD COLUMN IF NOT EXISTS drawing_revision_id UUID REFERENCES public.item_drawings(id) ON DELETE SET NULL;
ALTER TABLE public.bom_routing
  ADD COLUMN IF NOT EXISTS drawing_revision_id UUID REFERENCES public.item_drawings(id) ON DELETE SET NULL;
ALTER TABLE public.production_job_orders
  ADD COLUMN IF NOT EXISTS drawing_revision_id UUID REFERENCES public.item_drawings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS drawing_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS drawing_revision_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS drawing_file_url TEXT,
  ADD COLUMN IF NOT EXISTS engineering_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS definition_frozen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_job_orders_drawing_revision
  ON public.production_job_orders(tenant_id, drawing_revision_id, status);

CREATE OR REPLACE FUNCTION public.freeze_job_order_engineering_definition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_required TEXT;
  v_drawing public.item_drawings%ROWTYPE;
  v_bom public.bom_headers%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.definition_frozen_at IS NOT NULL THEN
    IF NEW.engineering_snapshot IS DISTINCT FROM OLD.engineering_snapshot
       OR NEW.drawing_revision_id IS DISTINCT FROM OLD.drawing_revision_id
       OR NEW.bom_id IS DISTINCT FROM OLD.bom_id THEN
      RAISE EXCEPTION 'Released job engineering definition is frozen and cannot be changed';
    END IF;
    RETURN NEW;
  END IF;

  IF UPPER(COALESCE(NEW.status::text, 'DRAFT')) NOT IN ('SCHEDULED','IN_PROGRESS','STORE_ISSUED') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(drawing_required, 'OPTIONAL') INTO v_required
  FROM public.items WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id;

  SELECT * INTO v_drawing
  FROM public.item_drawings
  WHERE tenant_id = NEW.tenant_id AND item_id = NEW.item_id
    AND lifecycle_status = 'APPROVED' AND is_active = TRUE
    AND effective_from <= CURRENT_DATE
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
  ORDER BY approved_at DESC NULLS LAST, version DESC LIMIT 1;

  IF v_required = 'COMPULSORY' AND v_drawing.id IS NULL THEN
    RAISE EXCEPTION 'Approved effective drawing revision is required before job release';
  END IF;

  IF NEW.bom_id IS NOT NULL THEN
    SELECT * INTO v_bom FROM public.bom_headers
    WHERE tenant_id = NEW.tenant_id AND id = NEW.bom_id;
    IF v_bom.id IS NULL OR COALESCE(v_bom.lifecycle_status, '') <> 'APPROVED'
       OR (v_bom.effective_from IS NOT NULL AND v_bom.effective_from > CURRENT_DATE)
       OR (v_bom.effective_to IS NOT NULL AND v_bom.effective_to < CURRENT_DATE) THEN
      RAISE EXCEPTION 'Approved effective BOM revision is required before job release';
    END IF;
  END IF;

  NEW.drawing_revision_id := v_drawing.id;
  NEW.drawing_number := v_drawing.drawing_number;
  NEW.drawing_revision_code := v_drawing.revision_code;
  NEW.drawing_file_url := v_drawing.file_url;
  NEW.engineering_snapshot := jsonb_build_object(
    'frozen_at', NOW(),
    'item_id', NEW.item_id,
    'drawing', CASE WHEN v_drawing.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_drawing.id, 'number', v_drawing.drawing_number, 'revision', v_drawing.revision_code,
      'file_url', v_drawing.file_url, 'approved_at', v_drawing.approved_at, 'effective_from', v_drawing.effective_from
    ) END,
    'bom', CASE WHEN v_bom.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_bom.id, 'version', v_bom.version, 'approved_at', v_bom.approved_at,
      'effective_from', v_bom.effective_from, 'effective_to', v_bom.effective_to
    ) END
  );
  NEW.definition_frozen_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_job_order_engineering_definition ON public.production_job_orders;
CREATE TRIGGER trg_freeze_job_order_engineering_definition
BEFORE INSERT OR UPDATE OF status, bom_id, engineering_snapshot, drawing_revision_id
ON public.production_job_orders
FOR EACH ROW EXECUTE FUNCTION public.freeze_job_order_engineering_definition();

NOTIFY pgrst, 'reload schema';
