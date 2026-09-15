-- Migration: Fix existing items table to match expected schema
-- This handles the case where items table already exists with different column names

-- Check if items table exists and alter it if needed
DO $$
BEGIN
    -- Check if item_code column exists (old schema)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'items' AND column_name = 'item_code'
    ) THEN
        -- Rename old columns to new schema
        ALTER TABLE items RENAME COLUMN item_code TO code;
        ALTER TABLE items RENAME COLUMN item_name TO name;
        RAISE NOTICE 'Renamed items.item_code to items.code and items.item_name to items.name';
    END IF;

    -- Check if warehouse_code column exists (old schema)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'warehouses' AND column_name = 'warehouse_code'
    ) THEN
        -- Rename old columns to new schema
        ALTER TABLE warehouses RENAME COLUMN warehouse_code TO code;
        ALTER TABLE warehouses RENAME COLUMN warehouse_name TO name;
        RAISE NOTICE 'Renamed warehouses columns to match new schema';
    END IF;
END $$;
