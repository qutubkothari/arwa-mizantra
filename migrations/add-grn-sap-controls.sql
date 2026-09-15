-- SAP-style GRN control layer.
-- This is intentionally additive: it does not change the existing GRN, QC, stock, UID,
-- partial receipt, or supplier invoice tables.

CREATE TABLE IF NOT EXISTS grn_sap_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  grn_id UUID NOT NULL,
  movement_type VARCHAR(10) NOT NULL DEFAULT '101',
  movement_text VARCHAR(120) NOT NULL DEFAULT 'Goods receipt for purchase order',
  material_document_number VARCHAR(80) NOT NULL,
  fiscal_year INTEGER NOT NULL,
  inspection_lot_number VARCHAR(80) NOT NULL,
  gr_ir_status VARCHAR(40) NOT NULL DEFAULT 'PENDING_INVOICE_APPROVAL',
  qc_gate_status VARCHAR(40) NOT NULL DEFAULT 'PENDING_INSPECTION',
  three_way_match_status VARCHAR(20) NOT NULL DEFAULT 'OK',
  tolerance_status VARCHAR(20) NOT NULL DEFAULT 'OK',
  reversal_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REVERSED',
  stock_posting_policy VARCHAR(40) NOT NULL DEFAULT 'POST_ACCEPTED_ONLY',
  created_by UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT grn_sap_controls_tenant_grn_unique UNIQUE (tenant_id, grn_id),
  CONSTRAINT grn_sap_controls_tenant_material_doc_unique UNIQUE (tenant_id, material_document_number)
);

CREATE INDEX IF NOT EXISTS idx_grn_sap_controls_tenant_grn
  ON grn_sap_controls (tenant_id, grn_id);

CREATE INDEX IF NOT EXISTS idx_grn_sap_controls_tolerance
  ON grn_sap_controls (tenant_id, tolerance_status, qc_gate_status);

CREATE TABLE IF NOT EXISTS grn_sap_control_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  grn_sap_control_id UUID NOT NULL REFERENCES grn_sap_controls(id) ON DELETE CASCADE,
  grn_id UUID NOT NULL,
  grn_item_id UUID NULL,
  po_item_id UUID NULL,
  item_id UUID NULL,
  item_code VARCHAR(120) NULL,
  movement_type VARCHAR(10) NOT NULL DEFAULT '101',
  stock_type VARCHAR(30) NOT NULL DEFAULT 'QUALITY_INSPECTION',
  ordered_qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  previous_received_qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  received_qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  accepted_qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  rejected_qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  po_rate NUMERIC(18, 6) NOT NULL DEFAULT 0,
  grn_rate NUMERIC(18, 6) NOT NULL DEFAULT 0,
  qty_variance NUMERIC(18, 6) NOT NULL DEFAULT 0,
  price_variance_percent NUMERIC(12, 4) NOT NULL DEFAULT 0,
  tolerance_status VARCHAR(20) NOT NULL DEFAULT 'OK',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grn_sap_control_items_control
  ON grn_sap_control_items (tenant_id, grn_sap_control_id);

CREATE INDEX IF NOT EXISTS idx_grn_sap_control_items_grn_item
  ON grn_sap_control_items (tenant_id, grn_item_id);

CREATE INDEX IF NOT EXISTS idx_grn_sap_control_items_item
  ON grn_sap_control_items (tenant_id, item_id);
