-- Enterprise field-service workforce planning.
-- Adds structured technician qualifications, territory/shift availability and
-- timestamp-level dispatch controls without changing historical assignments.

ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS territories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS base_location TEXT,
  ADD COLUMN IF NOT EXISTS shift_start TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS shift_end TIME NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS working_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6}';

ALTER TABLE public.technicians DROP CONSTRAINT IF EXISTS chk_technician_shift;
ALTER TABLE public.technicians ADD CONSTRAINT chk_technician_shift
  CHECK (shift_end > shift_start);

ALTER TABLE public.technicians DROP CONSTRAINT IF EXISTS chk_technician_working_days;
ALTER TABLE public.technicians ADD CONSTRAINT chk_technician_working_days
  CHECK (working_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);

ALTER TABLE public.service_assignments
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS required_skills TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_territory TEXT,
  ADD COLUMN IF NOT EXISTS scheduling_override_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_service_assignments_dispatch_window
  ON public.service_assignments(technician_id, scheduled_start_at, scheduled_end_at)
  WHERE status NOT IN ('COMPLETED', 'REASSIGNED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS public.service_technician_unavailability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  technician_id UUID NOT NULL REFERENCES public.technicians(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(40) NOT NULL DEFAULT 'LEAVE'
    CHECK (reason IN ('LEAVE','TRAINING','TRAVEL','WEEKLY_OFF','OTHER')),
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_service_technician_unavailability_window CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_service_technician_unavailability_window
  ON public.service_technician_unavailability(tenant_id, technician_id, starts_at, ends_at);

COMMENT ON COLUMN public.technicians.skills IS
  'Structured technician skills used for service dispatch recommendations.';
COMMENT ON COLUMN public.technicians.territories IS
  'Service areas, cities or regions normally covered by the technician.';
COMMENT ON TABLE public.service_technician_unavailability IS
  'Auditable technician leave, training and travel blocks used by service scheduling.';
