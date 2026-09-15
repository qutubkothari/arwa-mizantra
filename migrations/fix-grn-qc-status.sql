-- =====================================================
-- SUPABASE SQL MIGRATION: Fix GRN status for QC-completed GRNs
-- Run this in Supabase SQL Editor
-- =====================================================

-- Update all GRNs that have QC completed but status is still DRAFT
UPDATE public.grns
SET status = 'COMPLETED',
    updated_at = NOW()
WHERE qc_completed = true 
  AND status = 'DRAFT';

-- Show how many were updated
SELECT 
    COUNT(*) as total_grns,
    COUNT(*) FILTER (WHERE qc_completed = true AND status = 'COMPLETED') as qc_completed_and_completed,
    COUNT(*) FILTER (WHERE qc_completed = true AND status = 'DRAFT') as qc_completed_but_draft,
    COUNT(*) FILTER (WHERE status = 'COMPLETED') as total_completed
FROM public.grns;
