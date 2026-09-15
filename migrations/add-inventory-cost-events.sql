-- Immutable FIFO cost evidence. This is an operational valuation register, not a GL posting.
CREATE TABLE IF NOT EXISTS inventory_cost_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('PURCHASE_RECEIPT', 'SALES_ISSUE', 'SALES_RETURN', 'PRODUCTION_ISSUE', 'PRODUCTION_RECEIPT', 'ADJUSTMENT')),
  item_id UUID NOT NULL,
  stock_entry_id UUID,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  reference_type VARCHAR(50),
  reference_number VARCHAR(100),
  movement_id UUID,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, event_type, stock_entry_id, reference_number)
);
CREATE INDEX IF NOT EXISTS idx_inventory_cost_events_tenant_event ON inventory_cost_events(tenant_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_cost_events_reference ON inventory_cost_events(tenant_id, reference_number);

-- Existing test databases may already have the original check constraint.
ALTER TABLE inventory_cost_events DROP CONSTRAINT IF EXISTS inventory_cost_events_event_type_check;
ALTER TABLE inventory_cost_events ADD CONSTRAINT inventory_cost_events_event_type_check
  CHECK (event_type IN ('PURCHASE_RECEIPT', 'SALES_ISSUE', 'SALES_RETURN', 'PRODUCTION_ISSUE', 'PRODUCTION_RECEIPT', 'ADJUSTMENT'));
