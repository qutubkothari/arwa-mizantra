-- Procurement spend intelligence and evidence-backed savings pipeline.
-- Analytics are advisory and never alter purchase orders, vendors, receipts, or accounting.
CREATE TABLE IF NOT EXISTS public.procurement_savings_opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  title VARCHAR(220) NOT NULL, opportunity_type VARCHAR(40) NOT NULL CHECK(opportunity_type IN ('PRICE_VARIANCE','SUPPLIER_CONCENTRATION','VOLUME_CONSOLIDATION','PAYMENT_TERMS','PROCESS_LEAKAGE','OTHER')),
  vendor_id UUID REFERENCES public.vendors(id), item_code VARCHAR(120), baseline_spend NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_savings NUMERIC(18,2) NOT NULL CHECK(expected_savings > 0), realized_savings NUMERIC(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'IDENTIFIED' CHECK(status IN ('IDENTIFIED','VALIDATED','NEGOTIATING','REALIZED','DISMISSED')),
  owner_user_id UUID, target_date DATE, evidence_reference TEXT, notes TEXT,
  created_by UUID NOT NULL, validated_by UUID, validated_at TIMESTAMPTZ, realized_by UUID, realized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_procurement_savings_worklist ON public.procurement_savings_opportunities(tenant_id,status,target_date,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_savings_vendor ON public.procurement_savings_opportunities(tenant_id,vendor_id);
