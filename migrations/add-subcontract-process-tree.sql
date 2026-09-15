-- SAP-style subcontracting process tree: one input can split into multiple
-- outputs, and each output may feed one or more subsequent operations.
ALTER TABLE public.subcontract_route_steps
  ADD COLUMN IF NOT EXISTS node_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS parent_node_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS branch_no INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_input_qty NUMERIC(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_output_qty NUMERIC(18,4) DEFAULT 0;

ALTER TABLE public.subcontract_order_steps
  ADD COLUMN IF NOT EXISTS node_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS parent_node_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS parent_order_step_id UUID,
  ADD COLUMN IF NOT EXISTS branch_no INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_subcontract_route_steps_parent
  ON public.subcontract_route_steps(route_id, parent_node_key);
CREATE INDEX IF NOT EXISTS idx_subcontract_order_steps_parent
  ON public.subcontract_order_steps(order_id, parent_order_step_id);

-- Calculated physical material flow.  Quantities remain in the item's UOM
-- (for example PCS downstream); all mass is stored separately in KG.
ALTER TABLE public.subcontract_routes
  ADD COLUMN IF NOT EXISTS piece_size NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS size_uom VARCHAR(20),
  ADD COLUMN IF NOT EXISTS input_weight_per_piece NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS output_weight_per_piece NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS total_input_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS total_output_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS calculated_scrap_weight NUMERIC(18,6);

ALTER TABLE public.subcontract_route_steps
  ADD COLUMN IF NOT EXISTS input_weight_per_piece NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS output_weight_per_piece NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS planned_input_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS planned_output_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS calculated_scrap_weight NUMERIC(18,6);

ALTER TABLE public.subcontract_orders
  ADD COLUMN IF NOT EXISTS total_input_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS remaining_raw_material_weight NUMERIC(18,6);

ALTER TABLE public.subcontract_order_steps
  ADD COLUMN IF NOT EXISTS input_weight_per_piece NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS output_weight_per_piece NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS planned_input_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS planned_output_weight NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS consumed_input_weight NUMERIC(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculated_scrap_weight NUMERIC(18,6) DEFAULT 0;
