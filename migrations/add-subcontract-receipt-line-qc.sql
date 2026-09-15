-- QC is captured against each finished-goods line on a subcontract GRN.
ALTER TABLE public.subcontract_receipt_lines
  ADD COLUMN IF NOT EXISTS qc_status VARCHAR(30) NOT NULL DEFAULT 'PENDING_QC',
  ADD COLUMN IF NOT EXISTS qc_approved_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qc_rejected_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qc_disposition VARCHAR(30),
  ADD COLUMN IF NOT EXISTS qc_scrap_item_id UUID REFERENCES public.items(id),
  ADD COLUMN IF NOT EXISTS qc_notes TEXT,
  ADD COLUMN IF NOT EXISTS qc_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_approved_by UUID;

-- Settlement lines are not finished goods and do not need QC inspection.
UPDATE public.subcontract_receipt_lines
SET qc_status = 'NOT_APPLICABLE'
WHERE line_type <> 'FINISHED_GOOD' AND qc_status = 'PENDING_QC';
