-- Manual Store Issue Vouchers must identify the registered employee who
-- physically receives the material. Name/code snapshots preserve the audit
-- trail even if the Employee Master is changed later.
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS issued_to_employee_id UUID,
  ADD COLUMN IF NOT EXISTS issued_to_employee_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS issued_to_employee_name VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_stock_movements_siv_issued_to_employee
  ON public.stock_movements (tenant_id, issued_to_employee_id, movement_date DESC)
  WHERE reference_type = 'SIV' AND issued_to_employee_id IS NOT NULL;
