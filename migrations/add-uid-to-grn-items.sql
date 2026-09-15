-- Migration: Add UID column to grn_items table
-- Description: Enable automatic UID tracking for received goods at GRN stage
-- Date: 2025-11-27

-- Add uid column to grn_items
ALTER TABLE grn_items 
ADD COLUMN IF NOT EXISTS uid VARCHAR(100);

-- Add index for faster UID lookups
CREATE INDEX IF NOT EXISTS idx_grn_items_uid ON grn_items(uid);

-- Add comment
COMMENT ON COLUMN grn_items.uid IS 'Auto-generated Unique Identification Number for complete traceability from vendor to customer';
