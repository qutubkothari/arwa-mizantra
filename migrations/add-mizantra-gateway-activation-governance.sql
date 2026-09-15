-- A physical gateway can receive test telemetry immediately, but it must not
-- become a live transaction source until a separate authorised user approves
-- its field mapping.  Existing gateways remain in safe test mode on upgrade.
ALTER TABLE public.production_device_gateways
  ADD COLUMN IF NOT EXISTS mapping_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mapping_approval_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS mapping_submitted_by UUID,
  ADD COLUMN IF NOT EXISTS mapping_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mapping_approved_by UUID,
  ADD COLUMN IF NOT EXISTS mapping_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activation_note TEXT;

ALTER TABLE public.production_device_gateways
  DROP CONSTRAINT IF EXISTS production_device_gateways_mapping_approval_status_check;
ALTER TABLE public.production_device_gateways
  ADD CONSTRAINT production_device_gateways_mapping_approval_status_check
  CHECK (mapping_approval_status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','REVOKED'));

UPDATE public.production_device_gateways
SET is_test_mode = TRUE,
    status = CASE WHEN status = 'ACTIVE' THEN 'TESTING' ELSE status END,
    mapping_approval_status = CASE
      WHEN mapping_approval_status = 'DRAFT' THEN 'DRAFT'
      ELSE mapping_approval_status
    END
WHERE mapping_approved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_production_gateway_mapping_approval
  ON public.production_device_gateways(tenant_id, mapping_approval_status, updated_at DESC);

COMMENT ON COLUMN public.production_device_gateways.mapping_approval_status IS
  'Maker-checker activation control. APPROVED is required for any live, transaction-producing gateway mapping.';
