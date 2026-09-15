ALTER TABLE grns ADD COLUMN IF NOT EXISTS additional_invoice_files JSONB DEFAULT '[]'::jsonb;
