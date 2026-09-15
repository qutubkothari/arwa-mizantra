-- Client-query completion pack (13-Sep-2026).
-- Additive and data-preserving: existing employee, attendance and payroll rows
-- are not rewritten.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_eligible BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.hr_attendance_policies
  ADD COLUMN IF NOT EXISTS overtime_calculation_mode TEXT NOT NULL DEFAULT 'DAY_CREDIT',
  ADD COLUMN IF NOT EXISTS overtime_half_day_after_hours NUMERIC(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS overtime_full_day_after_hours NUMERIC(5,2) NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS holiday_overtime_min_hours NUMERIC(5,2) NOT NULL DEFAULT 6;

DO $$ BEGIN
  ALTER TABLE public.hr_attendance_policies
    ADD CONSTRAINT hr_attendance_overtime_mode_check
    CHECK (overtime_calculation_mode IN ('HOURLY', 'DAY_CREDIT'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.salary_component_type ADD VALUE IF NOT EXISTS 'PF_EMPLOYER';
  ALTER TYPE public.salary_component_type ADD VALUE IF NOT EXISTS 'ESI_EMPLOYER';
END $$;

COMMENT ON COLUMN public.employees.overtime_eligible IS
  'Employee-level Allow/Disallow switch for overtime earnings.';
COMMENT ON COLUMN public.hr_attendance_policies.overtime_calculation_mode IS
  'HOURLY pays excess hours; DAY_CREDIT pays 0.5/1 wage day according to configured thresholds.';

NOTIFY pgrst, 'reload schema';
