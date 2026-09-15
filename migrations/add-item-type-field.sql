-- Add item_type field to items table
-- Values: RAW_MATERIAL (default), SUB_ASSEMBLY, FINISHED_GOOD

ALTER TABLE items ADD COLUMN IF NOT EXISTS item_type VARCHAR(30) DEFAULT 'RAW_MATERIAL';

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_item_type_check;
ALTER TABLE items ADD CONSTRAINT items_item_type_check
  CHECK (item_type IN ('RAW_MATERIAL', 'SUB_ASSEMBLY', 'FINISHED_GOOD'));

-- Backfill existing rows that have NULL
UPDATE items SET item_type = 'RAW_MATERIAL' WHERE item_type IS NULL;

COMMENT ON COLUMN items.item_type IS 'Classification of item: RAW_MATERIAL, SUB_ASSEMBLY, or FINISHED_GOOD';
