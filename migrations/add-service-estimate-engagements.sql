CREATE TABLE IF NOT EXISTS public.service_estimate_engagements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL REFERENCES public.service_estimates(id) ON DELETE CASCADE,
  service_ticket_id UUID NOT NULL REFERENCES public.service_tickets(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  recipient VARCHAR(320),
  notes TEXT,
  next_follow_up_date DATE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_estimate_engagement_event_check
    CHECK (event_type IN ('EMAIL_SENT', 'REMINDER_SENT', 'CUSTOMER_COMMENT'))
);

CREATE INDEX IF NOT EXISTS idx_service_estimate_engagements_estimate
  ON public.service_estimate_engagements(estimate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_estimate_engagements_follow_up
  ON public.service_estimate_engagements(tenant_id, next_follow_up_date)
  WHERE next_follow_up_date IS NOT NULL;

COMMENT ON TABLE public.service_estimate_engagements IS
  'Immutable customer communication and follow-up history for service estimates.';
