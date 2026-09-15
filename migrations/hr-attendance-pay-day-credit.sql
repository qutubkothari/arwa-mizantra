-- HR payroll attendance credit rule
-- 8 to less than 10 hours = 1 paid day
-- 10 to 12 hours = 1.5 paid days
-- above 12 hours = 2 paid days
--
-- Payslips need decimal attendance_days to store 1.5 day credits.

ALTER TABLE IF EXISTS public.payslips
  ALTER COLUMN attendance_days TYPE NUMERIC(6,2)
  USING attendance_days::numeric;
