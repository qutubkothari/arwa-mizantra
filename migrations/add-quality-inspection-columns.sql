-- Add missing columns to quality_inspections table
-- These columns are required for the complete inspection functionality

ALTER TABLE quality_inspections 
ADD COLUMN IF NOT EXISTS on_hold_quantity DECIMAL(12,2) DEFAULT 0;

ALTER TABLE quality_inspections 
ADD COLUMN IF NOT EXISTS completion_date DATE;

ALTER TABLE quality_inspections 
ADD COLUMN IF NOT EXISTS completed_by UUID;

ALTER TABLE quality_inspections 
ADD COLUMN IF NOT EXISTS inspector_remarks TEXT;

-- Update comment
COMMENT ON COLUMN quality_inspections.on_hold_quantity IS 'Quantity placed on hold pending further review';
COMMENT ON COLUMN quality_inspections.completion_date IS 'Date when inspection was completed';
COMMENT ON COLUMN quality_inspections.completed_by IS 'User who completed the inspection';
COMMENT ON COLUMN quality_inspections.inspector_remarks IS 'Inspector remarks after completion';
