-- Connect preventive-maintenance plans to the installed base and service flow.
ALTER TABLE preventive_maintenance_schedule
  ADD COLUMN IF NOT EXISTS installed_asset_id UUID REFERENCES service_installed_assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS last_generated_ticket_id UUID REFERENCES service_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_by UUID;

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS pm_schedule_id UUID REFERENCES preventive_maintenance_schedule(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_pm_schedule_asset ON preventive_maintenance_schedule(installed_asset_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedule_last_ticket ON preventive_maintenance_schedule(last_generated_ticket_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_pm_schedule ON service_tickets(pm_schedule_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_pm_open_ticket
  ON service_tickets(tenant_id, pm_schedule_id)
  WHERE pm_schedule_id IS NOT NULL AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PARTS_PENDING');
CREATE UNIQUE INDEX IF NOT EXISTS uq_pm_active_name_uid
  ON preventive_maintenance_schedule(tenant_id, uid, lower(schedule_name))
  WHERE is_active = true;

ALTER TABLE preventive_maintenance_schedule DROP CONSTRAINT IF EXISTS chk_pm_frequency_positive;
ALTER TABLE preventive_maintenance_schedule ADD CONSTRAINT chk_pm_frequency_positive CHECK (frequency_days > 0);
ALTER TABLE preventive_maintenance_schedule DROP CONSTRAINT IF EXISTS chk_pm_notify_nonnegative;
ALTER TABLE preventive_maintenance_schedule ADD CONSTRAINT chk_pm_notify_nonnegative CHECK (notify_before_days >= 0);

-- Final service confirmation automatically advances the linked maintenance plan.
CREATE OR REPLACE FUNCTION advance_preventive_maintenance_schedule()
RETURNS trigger AS $$
BEGIN
  IF NEW.pm_schedule_id IS NOT NULL
     AND NEW.status IN ('COMPLETED', 'CLOSED')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE preventive_maintenance_schedule
       SET last_service_date = COALESCE(NEW.actual_completion_date, CURRENT_DATE),
           next_service_date = COALESCE(NEW.actual_completion_date, CURRENT_DATE) + frequency_days,
           updated_at = NOW()
     WHERE id = NEW.pm_schedule_id
       AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_advance_preventive_maintenance ON service_tickets;
CREATE TRIGGER trg_advance_preventive_maintenance
AFTER UPDATE OF status ON service_tickets
FOR EACH ROW EXECUTE FUNCTION advance_preventive_maintenance_schedule();

NOTIFY pgrst, 'reload schema';
