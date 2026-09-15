-- Create attendance table (step by step)
-- Step 1: Create enum type if not exists
DO $$ BEGIN
    CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'WFH', 'ON_DUTY');
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'AttendanceStatus enum already exists';
END $$;

-- Step 2: Create table if not exists
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    user_id UUID NOT NULL,
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in_time TIMESTAMPTZ,
    check_in_lat DECIMAL(10, 8),
    check_in_lng DECIMAL(11, 8),
    check_in_location VARCHAR(255),
    check_in_photo_url VARCHAR(500),
    check_in_notes TEXT,
    check_out_time TIMESTAMPTZ,
    check_out_lat DECIMAL(10, 8),
    check_out_lng DECIMAL(11, 8),
    check_out_location VARCHAR(500),
    check_out_photo_url VARCHAR(500),
    check_out_notes TEXT,
    status "AttendanceStatus" DEFAULT 'ABSENT',
    work_hours DECIMAL(5, 2),
    is_outside_zone BOOLEAN DEFAULT FALSE,
    outside_zone_reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Add unique constraint
DO $$ BEGIN
    ALTER TABLE attendance ADD CONSTRAINT unique_employee_daily_attendance 
    UNIQUE (tenant_id, employee_id, attendance_date);
EXCEPTION WHEN duplicate_table THEN
    RAISE NOTICE 'Constraint already exists';
END $$;

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON attendance(tenant_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

-- Step 5: Add foreign key constraints (optional - can be added later)
-- ALTER TABLE attendance ADD CONSTRAINT fk_attendance_tenant 
-- FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
-- ALTER TABLE attendance ADD CONSTRAINT fk_attendance_user 
-- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
