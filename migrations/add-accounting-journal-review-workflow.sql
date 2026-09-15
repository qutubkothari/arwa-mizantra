-- Mizantra/test: maker-checker status for manual and recurring vouchers.
-- Operational subledger postings can still post directly from a controlled
-- source; manually prepared and recurring vouchers must be reviewed first.

ALTER TABLE public.accounting_journals
  DROP CONSTRAINT IF EXISTS accounting_journals_status_check;

ALTER TABLE public.accounting_journals
  ADD CONSTRAINT accounting_journals_status_check
  CHECK (status IN ('DRAFT', 'REVIEWED', 'POSTED', 'REVERSED'));

CREATE OR REPLACE FUNCTION public.accounting_guard_journal_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' THEN
      RAISE EXCEPTION 'Posted journals are immutable; create a reversal instead.';
    END IF;
  ELSIF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'Reversed journals are immutable.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_validate_posting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_total numeric(18,2);
  credit_total numeric(18,2);
  line_count integer;
BEGIN
  IF OLD.status IN ('DRAFT', 'REVIEWED') AND NEW.status = 'POSTED' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
      INTO debit_total, credit_total, line_count
      FROM public.accounting_journal_lines
     WHERE journal_id = NEW.id;
    IF line_count < 2 OR debit_total <= 0 OR ROUND(debit_total, 2) <> ROUND(credit_total, 2) THEN
      RAISE EXCEPTION 'A journal cannot be posted unless it has at least two balanced, positive lines.';
    END IF;
    NEW.total_debit := debit_total;
    NEW.total_credit := credit_total;
  END IF;
  RETURN NEW;
END;
$$;
