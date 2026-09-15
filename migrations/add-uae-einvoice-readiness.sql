-- UAE eInvoicing readiness and structured payload evidence.
-- No Peppol/ASP transmission occurs from these tables.
ALTER TABLE uae_tax_compliance_profiles
  ADD COLUMN IF NOT EXISTS annual_revenue_band VARCHAR(20),
  ADD COLUMN IF NOT EXISTS asp_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS peppol_participant_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS mandatory_go_live_date DATE;

CREATE TABLE IF NOT EXISTS uae_einvoice_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  source_type VARCHAR(30) NOT NULL CHECK(source_type IN ('SALES_INVOICE','SALES_CREDIT_NOTE','SERVICE_INVOICE','SUPPLIER_INVOICE')),
  source_id UUID NOT NULL, source_number VARCHAR(120) NOT NULL,
  transaction_scope VARCHAR(10) NOT NULL DEFAULT 'B2B' CHECK(transaction_scope IN ('B2B','B2G','G2G','EXCLUDED')),
  document_type VARCHAR(30) NOT NULL DEFAULT 'TAX_INVOICE' CHECK(document_type IN ('TAX_INVOICE','CREDIT_NOTE','DEBIT_NOTE')),
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','READY','EXPORTED','ACKNOWLEDGED','REJECTED')),
  payload_version VARCHAR(30) NOT NULL DEFAULT 'PINT_AE_READINESS_V1', structured_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb, payload_hash VARCHAR(64),
  prepared_by UUID, prepared_at TIMESTAMPTZ, exported_at TIMESTAMPTZ, provider_reference VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,source_type,source_id)
);
CREATE INDEX IF NOT EXISTS idx_uae_einvoice_status ON uae_einvoice_documents(tenant_id,status,created_at DESC);
