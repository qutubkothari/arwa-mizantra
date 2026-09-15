-- Narrow compatibility amendment for the multi-currency rollout.
-- Posted vouchers remain immutable. The only permitted non-reversal update is
-- the one-time addition/correction of transaction-currency audit metadata.
CREATE OR REPLACE FUNCTION public.accounting_guard_journal_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('POSTED', 'REVERSED') THEN
    -- The only business-state transition allowed is POSTED -> REVERSED.
    IF NOT (OLD.status = 'POSTED' AND NEW.status = 'REVERSED') AND (
      NEW.journal_number IS DISTINCT FROM OLD.journal_number
      OR NEW.journal_date IS DISTINCT FROM OLD.journal_date
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.source_id IS DISTINCT FROM OLD.source_id
      OR NEW.narration IS DISTINCT FROM OLD.narration
      OR NEW.total_debit IS DISTINCT FROM OLD.total_debit
      OR NEW.total_credit IS DISTINCT FROM OLD.total_credit
      OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
      OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.adjustment_type IS DISTINCT FROM OLD.adjustment_type
      OR NEW.reversal_of_id IS DISTINCT FROM OLD.reversal_of_id
      OR NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'Posted journals are immutable; create a reversal instead.';
    END IF;
  END IF;
  -- A reversed voucher may receive only the same transaction-currency
  -- metadata update above; all voucher and accounting values remain frozen.
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_guard_journal_line_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_journal_id uuid;
  voucher_status text;
BEGIN
  target_journal_id := COALESCE(NEW.journal_id, OLD.journal_id);
  SELECT status INTO voucher_status FROM public.accounting_journals WHERE id = target_journal_id;
  IF voucher_status IN ('POSTED', 'REVERSED') THEN
    IF TG_OP = 'UPDATE'
      AND NEW.journal_id IS NOT DISTINCT FROM OLD.journal_id
      AND NEW.line_number IS NOT DISTINCT FROM OLD.line_number
      AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
      AND NEW.description IS NOT DISTINCT FROM OLD.description
      AND NEW.debit IS NOT DISTINCT FROM OLD.debit
      AND NEW.credit IS NOT DISTINCT FROM OLD.credit
      AND NEW.party_type IS NOT DISTINCT FROM OLD.party_type
      AND NEW.party_id IS NOT DISTINCT FROM OLD.party_id
      AND NEW.cost_center IS NOT DISTINCT FROM OLD.cost_center
      AND NEW.tax_code IS NOT DISTINCT FROM OLD.tax_code THEN
      -- Only foreign_debit / foreign_credit metadata can change here.
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Lines on posted or reversed journals are immutable.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
