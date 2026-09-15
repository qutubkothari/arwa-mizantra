-- Makes subcontracting a PO-style procure-to-pay flow without changing any
-- posted material, QC, invoice or payment transaction.
ALTER TABLE public.subcontract_orders
  ADD COLUMN IF NOT EXISTS requisition_number VARCHAR(60),
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'LEGACY_APPROVED',
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE public.subcontract_orders
SET approval_status = CASE
  WHEN status IN ('OPEN', 'READY', 'IN_PROCESS', 'PARTIALLY_RECEIVED', 'RM_BALANCE_PENDING', 'COMPLETED') THEN 'APPROVED'
  WHEN status = 'DRAFT' THEN 'DRAFT'
  ELSE COALESCE(NULLIF(approval_status, ''), 'LEGACY_APPROVED')
END
WHERE approval_status = 'LEGACY_APPROVED' OR approval_status IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_orders_tenant_requisition_number
  ON public.subcontract_orders (tenant_id, requisition_number)
  WHERE requisition_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.subcontract_order_approval_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.subcontract_orders(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL CHECK (action IN ('CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason TEXT,
  action_by UUID,
  action_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontract_order_approval_history_order
  ON public.subcontract_order_approval_history (tenant_id, order_id, action_at DESC);
