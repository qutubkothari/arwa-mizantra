-- Link governed production programs to the customer demand that created them.
-- Existing programs remain MANUAL and are not changed operationally.
ALTER TABLE public.production_programs
  ADD COLUMN IF NOT EXISTS demand_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sales_order_item_id UUID REFERENCES public.sales_order_items(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_programs_demand_source_check'
  ) THEN
    ALTER TABLE public.production_programs
      ADD CONSTRAINT production_programs_demand_source_check
      CHECK (
        demand_source IN ('MANUAL', 'SALES_ORDER')
        AND (
          demand_source = 'MANUAL'
          OR (sales_order_id IS NOT NULL AND sales_order_item_id IS NOT NULL)
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_program_sales_order_line
  ON public.production_programs (tenant_id, sales_order_item_id)
  WHERE demand_source = 'SALES_ORDER'
    AND sales_order_item_id IS NOT NULL
    AND status NOT IN ('CANCELLED', 'CLOSED');

CREATE INDEX IF NOT EXISTS idx_production_program_sales_order
  ON public.production_programs (tenant_id, sales_order_id, due_date);

COMMENT ON COLUMN public.production_programs.demand_source IS
  'MANUAL or SALES_ORDER; sales-linked target item, open quantity and due date are validated server-side.';
