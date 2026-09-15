-- =====================================================
-- Migration: Unify advance payments into single system
-- This allows both PO-specific and blanket (vendor) advances
-- =====================================================

-- 1. Make po_id nullable in po_advance_payments to support blanket advances
ALTER TABLE public.po_advance_payments 
  ALTER COLUMN po_id DROP NOT NULL;

-- 2. Add advance_type column to distinguish between types
ALTER TABLE public.po_advance_payments 
  ADD COLUMN IF NOT EXISTS advance_type TEXT NOT NULL DEFAULT 'PO' 
  CHECK (advance_type IN ('PO', 'BLANKET'));

-- 3. Add utilization tracking columns
ALTER TABLE public.po_advance_payments 
  ADD COLUMN IF NOT EXISTS utilized_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS utilized_against_grn_id UUID REFERENCES public.grns(id);

-- 4. Add comments for clarity
COMMENT ON COLUMN public.po_advance_payments.po_id IS 'NULL for blanket advances, set for PO-specific advances';
COMMENT ON COLUMN public.po_advance_payments.advance_type IS 'PO = against specific PO, BLANKET = general vendor advance';
COMMENT ON COLUMN public.po_advance_payments.utilized_amount IS 'Amount already used against invoices';
COMMENT ON COLUMN public.po_advance_payments.balance_amount IS 'Remaining unutilized amount';

-- 5. Create function to get available advances for a vendor (both blanket and PO-specific)
CREATE OR REPLACE FUNCTION get_vendor_available_advances(
  p_tenant_id UUID,
  p_vendor_id UUID,
  p_po_id UUID DEFAULT NULL
)
RETURNS TABLE (
  advance_id UUID,
  advance_type TEXT,
  po_id UUID,
  po_number TEXT,
  amount NUMERIC,
  utilized_amount NUMERIC,
  balance_amount NUMERIC,
  payment_date DATE,
  payment_notes TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pap.id as advance_id,
    pap.advance_type,
    pap.po_id,
    po.po_number,
    pap.amount,
    pap.utilized_amount,
    pap.balance_amount,
    pap.payment_date,
    pap.payment_notes
  FROM public.po_advance_payments pap
  LEFT JOIN public.purchase_orders po ON po.id = pap.po_id
  WHERE pap.tenant_id = p_tenant_id
    AND pap.vendor_id = p_vendor_id
    AND pap.balance_amount > 0
    AND (
      -- If po_id is provided, show both blanket advances AND advances for this specific PO
      p_po_id IS NULL OR pap.advance_type = 'BLANKET' OR pap.po_id = p_po_id
    )
  ORDER BY 
    CASE WHEN pap.advance_type = 'PO' AND pap.po_id = p_po_id THEN 0 ELSE 1 END,
    pap.payment_date ASC;
END;
$$ LANGUAGE plpgsql;

-- 6. Create function to suggest advance adjustment when GRN is created
CREATE OR REPLACE FUNCTION suggest_advance_adjustment(
  p_tenant_id UUID,
  p_vendor_id UUID,
  p_po_id UUID,
  p_grn_net_amount NUMERIC
)
RETURNS TABLE (
  has_blanket_advance BOOLEAN,
  blanket_balance NUMERIC,
  po_advance_balance NUMERIC,
  suggested_adjustment NUMERIC,
  message TEXT
) AS $$
DECLARE
  v_blanket_balance NUMERIC := 0;
  v_po_balance NUMERIC := 0;
  v_suggested NUMERIC := 0;
BEGIN
  -- Get blanket advance balance
  SELECT COALESCE(SUM(pap.balance_amount), 0)
  INTO v_blanket_balance
  FROM public.po_advance_payments pap
  WHERE pap.tenant_id = p_tenant_id
    AND pap.vendor_id = p_vendor_id
    AND pap.advance_type = 'BLANKET'
    AND pap.balance_amount > 0;

  -- Get PO-specific advance balance
  SELECT COALESCE(SUM(pap.balance_amount), 0)
  INTO v_po_balance
  FROM public.po_advance_payments pap
  WHERE pap.tenant_id = p_tenant_id
    AND pap.vendor_id = p_vendor_id
    AND pap.advance_type = 'PO'
    AND pap.po_id = p_po_id
    AND pap.balance_amount > 0;

  -- Calculate suggested adjustment (minimum of available and GRN amount)
  v_suggested := LEAST(v_blanket_balance + v_po_balance, p_grn_net_amount);

  RETURN QUERY SELECT 
    v_blanket_balance > 0,
    v_blanket_balance,
    v_po_balance,
    v_suggested,
    CASE 
      WHEN v_blanket_balance > 0 AND v_po_balance > 0 THEN 
        'Vendor has both blanket advance (₹' || v_blanket_balance || ') and PO advance (₹' || v_po_balance || ')'
      WHEN v_blanket_balance > 0 THEN 
        'Vendor has blanket advance of ₹' || v_blanket_balance
      WHEN v_po_balance > 0 THEN 
        'PO has advance of ₹' || v_po_balance
      ELSE 
        'No advances available'
    END;
END;
$$ LANGUAGE plpgsql;

-- 7. Create function to utilize advance against GRN
CREATE OR REPLACE FUNCTION utilize_advance_against_grn(
  p_tenant_id UUID,
  p_advance_id UUID,
  p_grn_id UUID,
  p_utilize_amount NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_available NUMERIC;
  v_vendor_id UUID;
BEGIN
  -- Get available balance
  SELECT balance_amount, vendor_id 
  INTO v_available, v_vendor_id
  FROM public.po_advance_payments
  WHERE id = p_advance_id AND tenant_id = p_tenant_id;

  IF v_available IS NULL OR v_available < p_utilize_amount THEN
    RETURN FALSE;
  END IF;

  -- Update the advance record
  UPDATE public.po_advance_payments
  SET 
    utilized_amount = utilized_amount + p_utilize_amount,
    balance_amount = balance_amount - p_utilize_amount,
    utilized_against_grn_id = p_grn_id,
    payment_notes = COALESCE(payment_notes || '; ' || p_notes, p_notes)
  WHERE id = p_advance_id AND tenant_id = p_tenant_id;

  -- Also update vendor advance balance summary
  UPDATE public.vendor_advance_balances
  SET 
    utilized_amount = utilized_amount + p_utilize_amount,
    balance_amount = balance_amount - p_utilize_amount,
    last_utilized_date = now()
  WHERE tenant_id = p_tenant_id AND vendor_id = v_vendor_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 8. Migrate existing data - mark existing records as PO advances
UPDATE public.po_advance_payments 
SET 
  advance_type = 'PO',
  balance_amount = amount,  -- Assume full amount available initially
  utilized_amount = 0
WHERE advance_type IS NULL OR advance_type = 'PO';

-- Verify migration
SELECT 
  'Migration complete' as status,
  COUNT(*) as total_advances,
  SUM(CASE WHEN advance_type = 'PO' THEN 1 ELSE 0 END) as po_advances,
  SUM(CASE WHEN advance_type = 'BLANKET' THEN 1 ELSE 0 END) as blanket_advances,
  SUM(balance_amount) as total_available_balance
FROM public.po_advance_payments
WHERE balance_amount > 0;
