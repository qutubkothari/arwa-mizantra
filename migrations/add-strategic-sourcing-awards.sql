-- Strategic sourcing evaluation and line-level award controls over existing RFQs.
-- Approved awards are evidence only and never create or amend a purchase order.
CREATE TABLE IF NOT EXISTS public.sourcing_bid_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  rfq_id UUID NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  technical_score NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK(technical_score BETWEEN 0 AND 100),
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK(risk_score BETWEEN 0 AND 100),
  evaluation_notes TEXT, evaluated_by UUID NOT NULL, evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,rfq_id)
);

CREATE TABLE IF NOT EXISTS public.sourcing_award_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL,
  pr_id UUID NOT NULL REFERENCES public.purchase_requisitions(id),
  pr_item_id UUID NOT NULL REFERENCES public.purchase_requisition_items(id),
  rfq_id UUID NOT NULL REFERENCES public.rfqs(id), vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  requested_qty NUMERIC(18,3) NOT NULL DEFAULT 0, selected_unit_price NUMERIC(18,2) NOT NULL,
  baseline_unit_price NUMERIC(18,2) NOT NULL, expected_savings NUMERIC(18,2) NOT NULL DEFAULT 0,
  weighted_score NUMERIC(7,3) NOT NULL, recommended_vendor_id UUID REFERENCES public.vendors(id),
  scoring_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, deviation_reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED')),
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID, approved_at TIMESTAMPTZ, evidence_reference TEXT, approval_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,pr_item_id)
);
CREATE INDEX IF NOT EXISTS idx_sourcing_awards_status ON public.sourcing_award_decisions(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_evaluations_rfq ON public.sourcing_bid_evaluations(tenant_id,rfq_id);

