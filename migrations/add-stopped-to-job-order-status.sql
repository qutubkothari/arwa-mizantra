-- ============================================
-- MIGRATION: Add STOPPED to job_order_status enum
-- Run this in Supabase SQL Editor for existing databases
-- ============================================

-- Add STOPPED value to job_order_status enum
ALTER TYPE job_order_status ADD VALUE IF NOT EXISTS 'STOPPED';
