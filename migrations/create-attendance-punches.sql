-- Multiple attendance movements for lunch/official visits.
CREATE TABLE IF NOT EXISTS public.attendance_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  attendance_id UUID NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  employee_id UUID,
  punch_type VARCHAR(3) NOT NULL CHECK (punch_type IN ('IN', 'OUT')),
  punch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat NUMERIC(10, 7),
  lng NUMERIC(10, 7),
  accuracy NUMERIC(10, 2),
  location TEXT,
  notes TEXT,
  is_outside_zone BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_punches_attendance_time
  ON public.attendance_punches(attendance_id, punch_at);
CREATE INDEX IF NOT EXISTS idx_attendance_punches_user_time
  ON public.attendance_punches(user_id, punch_at);
