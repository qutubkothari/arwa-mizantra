-- SAP-style subcontracting accountability: each receipt is posted against one
-- material outward challan and the raw-material balance stays open until it is
-- fully accounted for as finished goods consumption, return, scrap or loss.
ALTER TABLE public.subcontract_movements
  ADD COLUMN IF NOT EXISTS issue_movement_id UUID REFERENCES public.subcontract_movements(id),
  ADD COLUMN IF NOT EXISTS remaining_qty NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS balance_status VARCHAR(30) DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS qc_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS qc_approved_qty NUMERIC(18, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qc_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_approved_by UUID,
  ADD COLUMN IF NOT EXISTS qc_notes TEXT,
  ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) DEFAULT 'NOT_RECEIVED';

CREATE TABLE IF NOT EXISTS public.subcontract_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  receipt_movement_id UUID NOT NULL REFERENCES public.subcontract_movements(id) ON DELETE CASCADE,
  issue_movement_id UUID NOT NULL REFERENCES public.subcontract_movements(id),
  line_type VARCHAR(30) NOT NULL, -- FINISHED_GOOD, UNUSED_RETURN, SCRAP, LOSS
  item_id UUID,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  raw_material_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  warehouse_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontract_movements_issue ON public.subcontract_movements(issue_movement_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_receipt_lines_issue ON public.subcontract_receipt_lines(issue_movement_id);
