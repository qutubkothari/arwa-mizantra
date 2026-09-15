-- Fix GRNs that have NULL gst_percentage by backfilling from PO items
-- This corrects GRNs where GST was assumed 18% but the PO has 0% GST

-- Step 1: Set gst_percentage from PO items (max tax_percent across all PO items)
UPDATE public.grns g
SET gst_percentage = COALESCE(
  (
    SELECT MAX(COALESCE(poi.tax_percent, 0))
    FROM public.purchase_order_items poi
    WHERE poi.po_id = g.po_id
  ),
  0
)
WHERE g.gst_percentage IS NULL
  AND g.po_id IS NOT NULL;

-- Step 2: Recalculate tax_amount and net_payable_amount for all GRNs
-- where gst_percentage = 0 but tax_amount > 0 (incorrectly applied GST)
UPDATE public.grns
SET
  tax_amount = ROUND(gross_amount * (gst_percentage / 100), 2),
  net_payable_amount = COALESCE(gross_amount, 0)
    + ROUND(gross_amount * (gst_percentage / 100), 2)
    + COALESCE(freight_amount, 0)
    + COALESCE(freight_gst_amount, 0)
    - COALESCE(debit_note_amount, 0)
WHERE gst_percentage = 0
  AND tax_amount > 0;

-- Show summary
SELECT
  gst_percentage,
  COUNT(*) as grn_count,
  SUM(tax_amount) as total_tax
FROM public.grns
WHERE status = 'COMPLETED'
GROUP BY gst_percentage
ORDER BY gst_percentage;
