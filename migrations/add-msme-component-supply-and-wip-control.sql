-- MSME production: component sourcing, parent/child supply pegging and operation WIP.
-- Additive and rerunnable. Existing BOMs retain AUTO behaviour and historical
-- job/completion rows are not rewritten.

ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS supply_policy VARCHAR(24) NOT NULL DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS transfer_batch_quantity NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS planner_choice_note TEXT;

ALTER TABLE public.bom_items
  DROP CONSTRAINT IF EXISTS bom_items_supply_policy_check,
  ADD CONSTRAINT bom_items_supply_policy_check CHECK (
    supply_policy IN (
      'AUTO','MAKE','BUY','SUBCONTRACT','DIRECT','PHANTOM','PLANNER_CHOICE'
    )
  ) NOT VALID,
  DROP CONSTRAINT IF EXISTS bom_items_transfer_batch_quantity_check,
  ADD CONSTRAINT bom_items_transfer_batch_quantity_check CHECK (
    transfer_batch_quantity IS NULL OR transfer_batch_quantity > 0
  ) NOT VALID;

COMMENT ON COLUMN public.bom_items.supply_policy IS
  'How this component is fulfilled in this BOM. AUTO preserves legacy behaviour; PHANTOM explodes children without a child job order.';
COMMENT ON COLUMN public.bom_items.transfer_batch_quantity IS
  'Optional quantity that may move to the consuming operation before the full lot is complete.';

ALTER TABLE public.production_item_planning_policies
  DROP CONSTRAINT IF EXISTS production_item_planning_policies_procurement_type_check;
ALTER TABLE public.production_item_planning_policies
  ADD CONSTRAINT production_item_planning_policies_procurement_type_check
  CHECK (procurement_type IN (
    'AUTO','BUY','MAKE','TRANSFER','SUBCONTRACT','DIRECT','PLANNER_CHOICE'
  )) NOT VALID;

ALTER TABLE public.production_job_orders
  ADD COLUMN IF NOT EXISTS parent_job_order_id UUID REFERENCES public.production_job_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS root_job_order_id UUID REFERENCES public.production_job_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_bom_item_id UUID REFERENCES public.bom_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS demand_pegging JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_job_orders_parent
  ON public.production_job_orders(tenant_id,parent_job_order_id);
CREATE INDEX IF NOT EXISTS idx_job_orders_root
  ON public.production_job_orders(tenant_id,root_job_order_id);

CREATE TABLE IF NOT EXISTS public.production_supply_pegging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_job_order_id UUID NOT NULL REFERENCES public.production_job_orders(id) ON DELETE CASCADE,
  child_job_order_id UUID REFERENCES public.production_job_orders(id) ON DELETE SET NULL,
  bom_item_id UUID REFERENCES public.bom_items(id) ON DELETE SET NULL,
  item_id UUID NOT NULL REFERENCES public.items(id),
  supply_policy VARCHAR(24) NOT NULL,
  required_quantity NUMERIC(18,4) NOT NULL CHECK (required_quantity >= 0),
  stock_allocated_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (stock_allocated_quantity >= 0),
  scheduled_supply_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (scheduled_supply_quantity >= 0),
  planned_supply_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (planned_supply_quantity >= 0),
  received_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  reserved_for_parent_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (reserved_for_parent_quantity >= 0),
  required_by_date DATE,
  status VARCHAR(24) NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','RELEASED','PARTIALLY_AVAILABLE','AVAILABLE','CONSUMED','CANCELLED')),
  source_reference JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,parent_job_order_id,child_job_order_id,item_id)
);

CREATE INDEX IF NOT EXISTS idx_production_supply_pegging_parent
  ON public.production_supply_pegging(tenant_id,parent_job_order_id,status);
CREATE INDEX IF NOT EXISTS idx_production_supply_pegging_child
  ON public.production_supply_pegging(tenant_id,child_job_order_id,status);

CREATE TABLE IF NOT EXISTS public.production_operation_wip (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  production_order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  routing_id UUID NOT NULL REFERENCES public.production_routing(id) ON DELETE RESTRICT,
  predecessor_routing_id UUID REFERENCES public.production_routing(id) ON DELETE SET NULL,
  item_id UUID REFERENCES public.items(id),
  batch_number VARCHAR(100),
  event_type VARCHAR(24) NOT NULL
    CHECK (event_type IN ('GOOD_OUTPUT','REJECTED','REWORK','TRANSFER','CONSUMPTION','REVERSAL')),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  uom VARCHAR(30),
  from_work_station_id UUID,
  to_work_station_id UUID,
  station_completion_id UUID REFERENCES public.station_completions(id) ON DELETE SET NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_operation_wip_available
  ON public.production_operation_wip(tenant_id,production_order_id,routing_id,created_at);

CREATE OR REPLACE VIEW public.production_operation_wip_balance AS
SELECT
  tenant_id,
  production_order_id,
  routing_id,
  item_id,
  batch_number,
  SUM(
    CASE
      WHEN event_type IN ('GOOD_OUTPUT','REWORK') THEN quantity
      WHEN event_type IN ('TRANSFER','CONSUMPTION','REVERSAL') THEN -quantity
      ELSE 0
    END
  )::NUMERIC(18,4) AS available_quantity,
  MAX(created_at) AS last_movement_at
FROM public.production_operation_wip
GROUP BY tenant_id,production_order_id,routing_id,item_id,batch_number;
