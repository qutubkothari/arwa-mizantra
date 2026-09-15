-- Governed document-to-transaction intake. Extracted data is staged and matched;
-- it never posts inventory, AP or GL entries without the native approval flow.
CREATE TABLE IF NOT EXISTS public.mizantra_document_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  document_type TEXT NOT NULL,
  classification_confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  matched_vendor_id UUID,
  matched_purchase_order_id UUID,
  matched_grn_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ANALYSED' CHECK (status IN ('ANALYSED','REVIEW_REQUIRED','VALIDATED','APPROVED','DRAFT_READY','REJECTED')),
  created_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_mizantra_document_intake_queue ON public.mizantra_document_intakes(tenant_id,status,created_at DESC);
ALTER TABLE public.mizantra_document_intakes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.mizantra_document_intakes;
CREATE POLICY tenant_isolation ON public.mizantra_document_intakes
  USING (tenant_id::text = auth.jwt()->>'tenant_id')
  WITH CHECK (tenant_id::text = auth.jwt()->>'tenant_id');
NOTIFY pgrst, 'reload schema';
