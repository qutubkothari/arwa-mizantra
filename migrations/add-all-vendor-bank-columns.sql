-- =====================================================
-- SUPABASE SQL MIGRATION: Add all vendor bank columns
-- Run this in Supabase SQL Editor
-- =====================================================

-- Add all bank-related columns to vendors table
ALTER TABLE public.vendors 
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bank_ifsc_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(200),
  ADD COLUMN IF NOT EXISTS bank_account_type VARCHAR(20) DEFAULT 'CURRENT';

-- Verify columns were added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'vendors' 
  AND column_name IN ('bank_name', 'bank_account_number', 'bank_ifsc_code', 'bank_branch', 'bank_account_type')
ORDER BY column_name;
