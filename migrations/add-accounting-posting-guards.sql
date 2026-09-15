-- Accounting posting safeguards for Mizantra/test.
-- These guards sit below the API so posted journals remain auditable even if a
-- future integration talks directly to Supabase.

CREATE OR REPLACE FUNCTION public.accounting_guard_journal_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A draft may be posted. A posted voucher may only move to REVERSED.
  IF OLD.status = 'POSTED' AND NEW.status <> 'REVERSED' THEN
    RAISE EXCEPTION 'Posted journals are immutable; create a reversal instead.';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'Reversed journals are immutable.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_guard_journal_update ON public.accounting_journals;
CREATE TRIGGER trg_accounting_guard_journal_update
  BEFORE UPDATE ON public.accounting_journals
  FOR EACH ROW EXECUTE FUNCTION public.accounting_guard_journal_update();

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
    RAISE EXCEPTION 'Lines on posted or reversed journals are immutable.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_guard_journal_line_change ON public.accounting_journal_lines;
CREATE TRIGGER trg_accounting_guard_journal_line_change
  BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.accounting_guard_journal_line_change();

CREATE OR REPLACE FUNCTION public.accounting_validate_posting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_total numeric(18,2);
  credit_total numeric(18,2);
  line_count integer;
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'POSTED' THEN
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

DROP TRIGGER IF EXISTS trg_accounting_validate_posting ON public.accounting_journals;
CREATE TRIGGER trg_accounting_validate_posting
  BEFORE UPDATE OF status ON public.accounting_journals
  FOR EACH ROW EXECUTE FUNCTION public.accounting_validate_posting();

