-- Allow purchase orders to show a true receipt lifecycle:
-- APPROVED -> PARTIAL -> CLOSED.
-- Older schemas created pr_po_status without PARTIAL even though the UI had a
-- Partial filter. This migration is intentionally idempotent for Supabase/Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pr_po_status') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'pr_po_status'
        AND e.enumlabel = 'PARTIAL'
    ) THEN
      ALTER TYPE pr_po_status ADD VALUE 'PARTIAL' AFTER 'APPROVED';
    END IF;
  END IF;
END $$;
