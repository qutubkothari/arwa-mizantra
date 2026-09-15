-- Auditable customer engagement against sales quotations.

CREATE TABLE IF NOT EXISTS public.sales_quotation_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  activity_type VARCHAR(40) NOT NULL,
  subject TEXT,
  comments TEXT,
  recipient_email TEXT,
  reminder_due_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sales_quotation_activity_type CHECK (
    activity_type IN ('CUSTOMER_COMMENT', 'QUOTATION_EMAIL', 'RESPONSE_REMINDER', 'REVISION_CREATED')
  )
);

CREATE INDEX IF NOT EXISTS idx_sales_quotation_activities_lookup
  ON public.sales_quotation_activities(tenant_id, quotation_id, created_at DESC);

ALTER TABLE public.sales_quotation_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_quotation_activities_tenant_access ON public.sales_quotation_activities;
CREATE POLICY sales_quotation_activities_tenant_access
  ON public.sales_quotation_activities
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMENT ON TABLE public.sales_quotation_activities IS
  'Immutable quotation comments, outbound quotation emails, response reminders and revision audit events.';
