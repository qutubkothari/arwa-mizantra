-- Align the live schema with the R&D item editor and R&D PR workflow.
-- This migration is additive except for widening PR item names from varchar(200)
-- to text, which preserves all existing values.

BEGIN;

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS sales_uom VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sales_uom_factor NUMERIC(24,10),
  ADD COLUMN IF NOT EXISTS sales_whole_uom_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_sales_uom_factor_check;

ALTER TABLE public.items
  ADD CONSTRAINT items_sales_uom_factor_check
  CHECK (
    (sales_uom IS NULL AND sales_uom_factor IS NULL)
    OR (
      sales_uom IS NOT NULL
      AND sales_uom_factor IS NOT NULL
      AND sales_uom_factor > 0
    )
  );

DROP VIEW IF EXISTS public.v_pr_items_with_po_status;

ALTER TABLE public.purchase_requisition_items
  ALTER COLUMN item_name TYPE TEXT;

CREATE VIEW public.v_pr_items_with_po_status AS
SELECT
  pri.id,
  pri.pr_id,
  pri.item_code,
  pri.item_name,
  pri.description,
  pri.uom,
  pri.requested_qty,
  pri.estimated_rate,
  pri.required_date,
  pri.remarks,
  pri.created_at,
  pri.vendor_id,
  pri.payment_terms,
  pri.delivery_terms,
  pri.serial_no,
  pri.updated_at,
  pri.updated_by,
  pri.total_ordered_qty,
  pri.remaining_qty,
  pri.po_conversion_status,
  pr.pr_number,
  pr.department,
  pr.status AS pr_status,
  COALESCE(pri.total_ordered_qty, 0::numeric) AS ordered_qty,
  COALESCE(pri.remaining_qty, pri.requested_qty) AS pending_qty,
  CASE
    WHEN COALESCE(pri.total_ordered_qty, 0::numeric) >= pri.requested_qty THEN 'FULLY_ORDERED'::text
    WHEN COALESCE(pri.total_ordered_qty, 0::numeric) > 0::numeric THEN 'PARTIALLY_ORDERED'::text
    ELSE 'NOT_ORDERED'::text
  END AS order_status,
  i.code AS items_master_code,
  i.name AS items_master_name,
  i.preferred_vendor_id,
  v.name AS preferred_vendor_name,
  v.code AS preferred_vendor_code
FROM public.purchase_requisition_items pri
JOIN public.purchase_requisitions pr ON pri.pr_id = pr.id
LEFT JOIN public.items i ON pri.item_code::text = i.code::text
LEFT JOIN public.vendors v ON i.preferred_vendor_id = v.id
ORDER BY pr.pr_number, pri.serial_no;

GRANT ALL ON public.v_pr_items_with_po_status TO anon, authenticated, service_role;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS site_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS site_address TEXT,
  ADD COLUMN IF NOT EXISTS project_type VARCHAR(40) NOT NULL DEFAULT 'MANUFACTURING',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_projects_customer_delivery
  ON public.projects (tenant_id, customer_id, committed_delivery_date);

NOTIFY pgrst, 'reload schema';

COMMIT;
