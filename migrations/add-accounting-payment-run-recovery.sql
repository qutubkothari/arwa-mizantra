-- A payment run can be partially posted only when an individual bank payment
-- fails after earlier payments have already been posted.  This preserves the
-- audit trail and lets finance correct/retry the failed line without issuing
-- duplicate supplier payments.
ALTER TABLE public.accounting_payment_runs
  DROP CONSTRAINT IF EXISTS accounting_payment_runs_status_check;

ALTER TABLE public.accounting_payment_runs
  ADD CONSTRAINT accounting_payment_runs_status_check
  CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'PARTIALLY_POSTED', 'CANCELLED'));
