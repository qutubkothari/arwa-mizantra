-- Required by the current two-UOM subcontract work-order and backflush flow.
ALTER TABLE public.subcontract_orders
  ADD COLUMN IF NOT EXISTS input_uom VARCHAR(30),
  ADD COLUMN IF NOT EXISTS secondary_input_qty NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS secondary_input_uom VARCHAR(30),
  ADD COLUMN IF NOT EXISTS remaining_secondary_input_qty NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS total_input_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS remaining_raw_material_weight NUMERIC(18,6);

ALTER TABLE public.subcontract_order_steps
  ADD COLUMN IF NOT EXISTS output_uom VARCHAR(30),
  ADD COLUMN IF NOT EXISTS output_size NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(8,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(18,2) DEFAULT 0;

ALTER TABLE public.subcontract_movements
  ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30);

NOTIFY pgrst, 'reload schema';
