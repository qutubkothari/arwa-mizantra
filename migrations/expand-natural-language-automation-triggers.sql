-- Additional deterministic targets understood by the governed natural-language
-- rule compiler. New rules are always created disabled and require activation.
ALTER TABLE public.automation_rules DROP CONSTRAINT IF EXISTS automation_rules_trigger_type_check;
ALTER TABLE public.automation_rules ADD CONSTRAINT automation_rules_trigger_type_check CHECK (trigger_type IN (
  'QUOTATION_EXPIRING','RECEIVABLE_OVERDUE','SERVICE_SLA_RISK','SERVICE_CONTRACT_EXPIRING','WARRANTY_EXPIRING',
  'PREVENTIVE_MAINTENANCE_DUE','SERVICE_ESTIMATE_EXPIRING','LOW_STOCK','PO_OVERDUE','QUALITY_REJECTION_RATE',
  'CUSTOMER_CREDIT_EXPOSURE','MANUAL'
));
