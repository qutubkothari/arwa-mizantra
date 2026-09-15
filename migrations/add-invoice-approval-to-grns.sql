-- Add invoice approval fields to grns table
ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS invoice_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS invoice_approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS invoice_approved_gross_amount DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS invoice_approved_tax_amount DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS invoice_approved_net_payable DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS invoice_approval_notes TEXT;
