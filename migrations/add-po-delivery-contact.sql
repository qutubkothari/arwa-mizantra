-- Migration: Add delivery contact person and phone to purchase_orders
-- Run this in Supabase SQL Editor

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS delivery_contact_person TEXT,
  ADD COLUMN IF NOT EXISTS delivery_contact_phone TEXT;
