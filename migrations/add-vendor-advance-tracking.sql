-- =====================================================
-- Migration: Add vendor advance tracking for Accounts Payable
-- This enables tracking unutilized advance payments per vendor
-- Run this in Supabase SQL Editor
-- =====================================================

-- Table to track vendor advance balances (unutilized amounts)
CREATE TABLE IF NOT EXISTS public.vendor_advance_balances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  vendor_id       UUID NOT NULL REFERENCES public.vendors(id),
  
  -- Advance tracking
  total_advance   NUMERIC(15,2) NOT NULL DEFAULT 0,    -- Total advance ever paid
  utilized_amount NUMERIC(15,2) NOT NULL DEFAULT 0,    -- Amount already used against invoices
  balance_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,      -- Unutilized balance available
  
  -- Metadata
  last_advance_date TIMESTAMPTZ,
  last_utilized_date TIMESTAMPTZ,
  notes             TEXT,
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vendor_advance_balances_tenant ON public.vendor_advance_balances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_advance_balances_vendor ON public.vendor_advance_balances(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_advance_balances_balance ON public.vendor_advance_balances(balance_amount) WHERE balance_amount > 0;

-- Enable RLS
ALTER TABLE public.vendor_advance_balances ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY vendor_advance_balances_tenant_isolation ON public.vendor_advance_balances
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_vendor_advance_balances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_vendor_advance_balances_updated_at ON public.vendor_advance_balances;
CREATE TRIGGER trigger_vendor_advance_balances_updated_at
  BEFORE UPDATE ON public.vendor_advance_balances
  FOR EACH ROW EXECUTE FUNCTION update_vendor_advance_balances_updated_at();

-- Function to get vendor advance summary for Accounts Payable
CREATE OR REPLACE FUNCTION get_vendor_advance_summary(p_tenant_id UUID)
RETURNS TABLE (
  vendor_id UUID,
  vendor_name VARCHAR,
  vendor_code VARCHAR,
  total_advance NUMERIC,
  utilized_amount NUMERIC,
  balance_amount NUMERIC,
  last_advance_date TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.name AS vendor_name,
    v.code AS vendor_code,
    COALESCE(vab.total_advance, 0) AS total_advance,
    COALESCE(vab.utilized_amount, 0) AS utilized_amount,
    COALESCE(vab.balance_amount, 0) AS balance_amount,
    vab.last_advance_date
  FROM public.vendors v
  LEFT JOIN public.vendor_advance_balances vab 
    ON vab.vendor_id = v.id AND vab.tenant_id = v.tenant_id
  WHERE v.tenant_id = p_tenant_id
    AND (vab.balance_amount > 0 OR vab.total_advance > 0)
  ORDER BY COALESCE(vab.balance_amount, 0) DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to add advance to vendor balance
CREATE OR REPLACE FUNCTION add_vendor_advance(
  p_tenant_id UUID,
  p_vendor_id UUID,
  p_amount NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_record_id UUID;
BEGIN
  -- Try to update existing record
  UPDATE public.vendor_advance_balances
  SET 
    total_advance = total_advance + p_amount,
    balance_amount = balance_amount + p_amount,
    last_advance_date = now(),
    notes = COALESCE(p_notes, notes)
  WHERE tenant_id = p_tenant_id AND vendor_id = p_vendor_id
  RETURNING id INTO v_record_id;
  
  -- If no record exists, insert new
  IF v_record_id IS NULL THEN
    INSERT INTO public.vendor_advance_balances (
      tenant_id, vendor_id, total_advance, utilized_amount, balance_amount, 
      last_advance_date, notes
    ) VALUES (
      p_tenant_id, p_vendor_id, p_amount, 0, p_amount, now(), p_notes
    )
    RETURNING id INTO v_record_id;
  END IF;
  
  RETURN v_record_id;
END;
$$ LANGUAGE plpgsql;

-- Function to utilize vendor advance against invoice
CREATE OR REPLACE FUNCTION utilize_vendor_advance(
  p_tenant_id UUID,
  p_vendor_id UUID,
  p_amount NUMERIC,
  p_grn_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_available NUMERIC;
BEGIN
  -- Check available balance
  SELECT balance_amount INTO v_available
  FROM public.vendor_advance_balances
  WHERE tenant_id = p_tenant_id AND vendor_id = p_vendor_id;
  
  IF v_available IS NULL OR v_available < p_amount THEN
    RETURN FALSE;
  END IF;
  
  -- Update the balance
  UPDATE public.vendor_advance_balances
  SET 
    utilized_amount = utilized_amount + p_amount,
    balance_amount = balance_amount - p_amount,
    last_utilized_date = now(),
    notes = COALESCE(p_notes, notes)
  WHERE tenant_id = p_tenant_id AND vendor_id = p_vendor_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Migration: Migrate existing PO advance payments to vendor advance balances
-- This populates the new table with data from existing po_advance_payments
INSERT INTO public.vendor_advance_balances (
  tenant_id, vendor_id, total_advance, utilized_amount, balance_amount, last_advance_date
)
SELECT 
  pap.tenant_id,
  pap.vendor_id,
  SUM(pap.amount) AS total_advance,
  0 AS utilized_amount,
  SUM(pap.amount) AS balance_amount,
  MAX(pap.payment_date) AS last_advance_date
FROM public.po_advance_payments pap
WHERE NOT EXISTS (
  SELECT 1 FROM public.vendor_advance_balances vab 
  WHERE vab.vendor_id = pap.vendor_id AND vab.tenant_id = pap.tenant_id
)
GROUP BY pap.tenant_id, pap.vendor_id;

-- Verify the migration
SELECT 
  'Vendor advance balances created' as message,
  COUNT(*) as record_count,
  SUM(total_advance) as total_advance_amount,
  SUM(balance_amount) as total_available_balance
FROM public.vendor_advance_balances;
