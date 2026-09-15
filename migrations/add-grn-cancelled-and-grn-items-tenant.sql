-- Add CANCELLED value to grn_status enum if it does not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'grn_status'
      AND e.enumlabel = 'CANCELLED'
  ) THEN
    ALTER TYPE grn_status ADD VALUE 'CANCELLED';
  END IF;
END $$;

-- Add tenant_id column to grn_items if it does not exist
ALTER TABLE grn_items ADD COLUMN IF NOT EXISTS tenant_id UUID;
