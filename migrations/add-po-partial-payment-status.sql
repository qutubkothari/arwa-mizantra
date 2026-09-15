DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'payment_status_enum'
        AND e.enumlabel = 'PARTIAL'
    ) THEN
      ALTER TYPE payment_status_enum ADD VALUE 'PARTIAL';
    END IF;
  END IF;
END $$;
