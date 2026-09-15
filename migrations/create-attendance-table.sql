-- ============================================
-- MIGRATION: Create Attendance Table with Geo-tagging
-- Run this in Supabase SQL Editor
-- ============================================

-- Create AttendanceStatus enum
DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'WFH', 'ON_DUTY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create attendance table
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Check-in details
  check_in_time TIMESTAMPTZ,
  check_in_lat DECIMAL(10, 8),
  check_in_lng DECIMAL(11, 8),
  check_in_location VARCHAR(255),
  check_in_photo_url VARCHAR(500),
  check_in_notes TEXT,
  
  -- Check-out details
  check_out_time TIMESTAMPTZ,
  check_out_lat DECIMAL(10, 8),
  check_out_lng DECIMAL(11, 8),
  check_out_location VARCHAR(500),
  check_out_photo_url VARCHAR(500),
  check_out_notes TEXT,
  
  -- Status tracking
  status "AttendanceStatus" DEFAULT 'ABSENT',
  work_hours DECIMAL(5, 2),
  is_outside_zone BOOLEAN DEFAULT FALSE,
  outside_zone_reason TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  CONSTRAINT unique_employee_daily_attendance UNIQUE (tenant_id, employee_id, attendance_date)
);

-- Create indexes (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_tenant_date') THEN
    CREATE INDEX idx_attendance_tenant_date ON attendance(tenant_id, attendance_date);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_user') THEN
    CREATE INDEX idx_attendance_user ON attendance(user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_status') THEN
    CREATE INDEX idx_attendance_status ON attendance(status);
  END IF;
END $$;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_attendance_updated_at ON attendance;
CREATE TRIGGER update_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
