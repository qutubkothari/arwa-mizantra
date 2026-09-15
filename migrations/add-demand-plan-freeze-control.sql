-- Freeze approved S&OP demand snapshots used by MRP.
-- Additive and data-safe: existing approved cycles are protected immediately;
-- fingerprints are populated when a cycle is approved through the application.
ALTER TABLE public.demand_plan_cycles
  ADD COLUMN IF NOT EXISTS snapshot_hash VARCHAR(64);

COMMENT ON COLUMN public.demand_plan_cycles.snapshot_hash IS
  'SHA-256 fingerprint of the ordered consensus demand lines at approval time.';

CREATE OR REPLACE FUNCTION public.guard_approved_demand_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved demand cycle % is frozen and cannot be changed or deleted.', OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_approved_demand_cycle ON public.demand_plan_cycles;
CREATE TRIGGER trg_guard_approved_demand_cycle
BEFORE UPDATE OR DELETE ON public.demand_plan_cycles
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_demand_cycle();

CREATE OR REPLACE FUNCTION public.guard_approved_demand_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE protected_cycle_id UUID;
BEGIN
  protected_cycle_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.cycle_id ELSE OLD.cycle_id END;
  IF EXISTS (
    SELECT 1 FROM public.demand_plan_cycles c
    WHERE c.id = protected_cycle_id AND c.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Demand lines for approved cycle % are frozen.', protected_cycle_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_approved_demand_line ON public.demand_plan_lines;
CREATE TRIGGER trg_guard_approved_demand_line
BEFORE INSERT OR UPDATE OR DELETE ON public.demand_plan_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_demand_line();
