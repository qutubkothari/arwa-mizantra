-- GRN payment entries: multiple payments per GRN with TDS/short-payment support
CREATE TABLE IF NOT EXISTS grn_payment_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  grn_id         UUID NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
  payment_date   DATE NOT NULL,
  amount         DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(50) NOT NULL DEFAULT 'NEFT',
  payment_reference VARCHAR(200),
  tds_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  short_payment_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  short_payment_reason TEXT,
  payment_notes  TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grn_payment_entries_grn ON grn_payment_entries(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_payment_entries_tenant ON grn_payment_entries(tenant_id);

-- Add tds_amount and short_payment_amount columns to grns for aggregate tracking
ALTER TABLE grns ADD COLUMN IF NOT EXISTS tds_amount DECIMAL(15,2) DEFAULT 0;
ALTER TABLE grns ADD COLUMN IF NOT EXISTS short_payment_amount DECIMAL(15,2) DEFAULT 0;
