-- =====================================================
-- SUPABASE SQL MIGRATION: Add bank_account_type to vendors
-- Run this in Supabase SQL Editor
-- =====================================================

-- Add bank_account_type column to vendors table
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS bank_account_type VARCHAR(20) DEFAULT 'CURRENT';

-- Add comment for the column
COMMENT ON COLUMN public.vendors.bank_account_type IS 'Bank account type: CURRENT, SAVINGS, etc.';

-- Verify column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'vendors' AND column_name = 'bank_account_type';
