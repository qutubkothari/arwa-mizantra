-- UAE compliance evidence foundation. No FTA submission or accounting posting.
CREATE TABLE IF NOT EXISTS uae_tax_compliance_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL UNIQUE,
  trn VARCHAR(30), corporate_tax_registration_number VARCHAR(40),
  tax_period_reference VARCHAR(80), record_retention_years INTEGER NOT NULL DEFAULT 5 CHECK (record_retention_years >= 5),
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS uae_tax_evidence_register (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  evidence_type VARCHAR(40) NOT NULL CHECK (evidence_type IN ('VAT_INVOICE','VAT_CREDIT_NOTE','VAT_RETURN','CORPORATE_TAX','TRANSFER_PRICING','WPS')),
  reference_number VARCHAR(120) NOT NULL, period_from DATE, period_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEWED','APPROVED','FILED')),
  storage_reference TEXT, reviewed_by UUID, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,evidence_type,reference_number)
);
CREATE INDEX IF NOT EXISTS idx_uae_tax_evidence_tenant_status ON uae_tax_evidence_register(tenant_id,status,created_at DESC);
