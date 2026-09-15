-- Controlled outbound-delivery preparation between Sales Order release and PGI.
-- Additive and backward compatible: existing direct dispatch documents remain valid.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO public.sales_document_sequences(document_type, last_number)
VALUES ('FULFILMENT_TASK', 0), ('DUNNING_NOTICE', 0)
ON CONFLICT (document_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_sales_document_number(p_document_type TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number BIGINT;
BEGIN
  IF p_document_type NOT IN ('QUOTATION', 'SALES_ORDER', 'DISPATCH', 'INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'SALES_RETURN', 'DUNNING_NOTICE', 'FULFILMENT_TASK') THEN
    RAISE EXCEPTION 'Unsupported sales document type: %', p_document_type;
  END IF;
  INSERT INTO public.sales_document_sequences(document_type, last_number)
  VALUES (p_document_type, 1)
  ON CONFLICT (document_type) DO UPDATE
    SET last_number = public.sales_document_sequences.last_number + 1,
        updated_at = NOW()
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sales_fulfilment_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  task_number VARCHAR(60) NOT NULL,
  sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE RESTRICT,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  planned_dispatch_date DATE NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
  assigned_to UUID,
  picking_started_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ,
  packed_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancellation_reason TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sales_fulfilment_task_number UNIQUE (tenant_id, task_number),
  CONSTRAINT chk_sales_fulfilment_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  CONSTRAINT chk_sales_fulfilment_status CHECK (status IN ('PLANNED', 'PICKING', 'PICKED', 'PACKED', 'READY_TO_DISPATCH', 'DISPATCHED', 'CANCELLED'))
);

CREATE TABLE IF NOT EXISTS public.sales_fulfilment_task_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES public.sales_fulfilment_tasks(id) ON DELETE CASCADE,
  sales_order_item_id UUID NOT NULL REFERENCES public.sales_order_items(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  planned_quantity NUMERIC(15,3) NOT NULL,
  picked_quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  packed_quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  batch_number VARCHAR(120),
  storage_bin VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sales_fulfilment_task_line UNIQUE (task_id, sales_order_item_id),
  CONSTRAINT chk_sales_fulfilment_quantities CHECK (
    planned_quantity > 0 AND picked_quantity >= 0 AND packed_quantity >= 0
    AND picked_quantity <= planned_quantity AND packed_quantity <= picked_quantity
  )
);

ALTER TABLE public.dispatch_notes
  ADD COLUMN IF NOT EXISTS fulfilment_task_id UUID REFERENCES public.sales_fulfilment_tasks(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS proof_of_delivery_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_of_delivery_name TEXT,
  ADD COLUMN IF NOT EXISTS delivered_to_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS delivered_to_mobile VARCHAR(30);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_dispatch_fulfilment_active
  ON public.dispatch_notes(tenant_id, fulfilment_task_id)
  WHERE fulfilment_task_id IS NOT NULL AND COALESCE(status, 'PGI_POSTED') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS idx_sales_fulfilment_worklist
  ON public.sales_fulfilment_tasks(tenant_id, status, planned_dispatch_date, priority);
CREATE INDEX IF NOT EXISTS idx_sales_fulfilment_order
  ON public.sales_fulfilment_tasks(tenant_id, sales_order_id, created_at DESC);

ALTER TABLE public.sales_fulfilment_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_fulfilment_task_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_fulfilment_tasks_tenant_access ON public.sales_fulfilment_tasks;
CREATE POLICY sales_fulfilment_tasks_tenant_access ON public.sales_fulfilment_tasks
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS sales_fulfilment_task_items_tenant_access ON public.sales_fulfilment_task_items;
CREATE POLICY sales_fulfilment_task_items_tenant_access ON public.sales_fulfilment_task_items
  USING (EXISTS (
    SELECT 1 FROM public.sales_fulfilment_tasks task
    WHERE task.id = sales_fulfilment_task_items.task_id
      AND task.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sales_fulfilment_tasks task
    WHERE task.id = sales_fulfilment_task_items.task_id
      AND task.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ));

COMMENT ON TABLE public.sales_fulfilment_tasks IS
  'Outbound-delivery preparation worklist controlling pick, pack, dispatch readiness and PGI traceability.';
