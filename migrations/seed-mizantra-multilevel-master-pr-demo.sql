-- Mizantra-only, idempotent multi-level BOM demonstration pack.
-- No existing client item, BOM, routing or stock record is deleted or altered.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  ) THEN
    RAISE EXCEPTION 'Mizantra tenant guard failed';
  END IF;
END $$;

CREATE TEMP TABLE demo_items (
  code text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  enum_type text NOT NULL,
  item_type text NOT NULL,
  standard_cost numeric NOT NULL,
  stock_qty numeric NOT NULL DEFAULT 0
) ON COMMIT DROP;

INSERT INTO demo_items VALUES
  ('DEMO-ML-FG-001', 'DEMO - Multi-Level Pump Skid Assembly', 'FINISHED_GOODS', 'FINISHED_GOODS', 'FINISHED_GOOD', 12500, 0),
  ('DEMO-ML-SA-01', 'DEMO SA1 - Fabricated Base Frame', 'SUB_ASSEMBLY', 'FINISHED_GOODS', 'SUB_ASSEMBLY', 1800, 2),
  ('DEMO-ML-SA-02', 'DEMO SA2 - Electrical Control Box', 'SUB_ASSEMBLY', 'FINISHED_GOODS', 'SUB_ASSEMBLY', 2400, 10),
  ('DEMO-ML-SA-03', 'DEMO SA3 - Drive Module', 'SUB_ASSEMBLY', 'FINISHED_GOODS', 'SUB_ASSEMBLY', 3100, 0),
  ('DEMO-ML-SA-04', 'DEMO SA4 - Purchased Pump Module', 'SUB_ASSEMBLY', 'FINISHED_GOODS', 'SUB_ASSEMBLY', 3900, 2),
  ('DEMO-ML-SA-05', 'DEMO SA5 - Ready Guard Assembly', 'SUB_ASSEMBLY', 'FINISHED_GOODS', 'SUB_ASSEMBLY', 950, 10),
  ('DEMO-ML-DIR-01', 'DEMO Direct - Flexible Hose', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 220, 10),
  ('DEMO-ML-DIR-02', 'DEMO Direct - Pressure Gauge', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 480, 10),
  ('DEMO-ML-DIR-03', 'DEMO Direct - Cable Harness', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 135, 0),
  ('DEMO-ML-DIR-04', 'DEMO Direct - Nameplate Set', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 45, 20),
  ('DEMO-ML-RM-COMMON', 'DEMO RM - Common M8 Fastener', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 6, 20),
  ('DEMO-ML-RM-FRAME', 'DEMO RM - Frame Plate Blank', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 190, 0),
  ('DEMO-ML-RM-WIRE', 'DEMO RM - Control Wire Set', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 80, 30),
  ('DEMO-ML-RM-CONTACTOR', 'DEMO RM - Contactor', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 260, 10),
  ('DEMO-ML-RM-BEARING', 'DEMO RM - Drive Bearing', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 320, 4),
  ('DEMO-ML-RM-SHAFT', 'DEMO RM - Machined Shaft', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 620, 10),
  ('DEMO-ML-RM-PUMP-BODY', 'DEMO RM - Pump Body Casting', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 1800, 0),
  ('DEMO-ML-RM-IMPELLER', 'DEMO RM - Pump Impeller', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 850, 0),
  ('DEMO-ML-RM-GUARD', 'DEMO RM - Guard Mesh', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 110, 10),
  ('DEMO-ML-RM-BRACKET', 'DEMO RM - Guard Bracket', 'RAW_MATERIAL', 'RAW_MATERIAL', 'RAW_MATERIAL', 55, 20);

INSERT INTO public.items (
  tenant_id, code, name, description, category, uom, standard_cost,
  type, item_type, is_active, is_verified, approval_status, approved_at,
  metadata, uid_tracking, uid_strategy
)
SELECT
  'f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid,
  d.code, d.name,
  'Controlled Mizantra multi-level BOM demo master. Not a client production specification.',
  d.category, 'PCS', d.standard_cost, d.enum_type::item_type, d.item_type,
  true, true, 'APPROVED', now(),
  jsonb_build_object(
    'demoPack', 'MIZANTRA_MULTI_LEVEL_MASTER_PR_V1',
    'purpose', 'Load BOM and master shortage PR verification'
  ),
  false, 'NONE'::uid_strategy_enum
FROM demo_items d
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  category=EXCLUDED.category,
  uom=EXCLUDED.uom,
  standard_cost=EXCLUDED.standard_cost,
  type=EXCLUDED.type,
  item_type=EXCLUDED.item_type,
  is_active=true,
  is_verified=true,
  approval_status='APPROVED',
  approved_at=COALESCE(public.items.approved_at, now()),
  metadata=COALESCE(public.items.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  uid_tracking=false,
  uid_strategy='NONE'::uid_strategy_enum,
  updated_at=now();

CREATE TEMP TABLE demo_bom_parents (code text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO demo_bom_parents VALUES
  ('DEMO-ML-FG-001'), ('DEMO-ML-SA-01'), ('DEMO-ML-SA-02'),
  ('DEMO-ML-SA-03'), ('DEMO-ML-SA-04'), ('DEMO-ML-SA-05');

INSERT INTO public.bom_headers (
  tenant_id, item_id, version, is_active, effective_from, notes,
  lifecycle_status, approved_at, approval_note, output_quantity, output_uom,
  source_pack_code, revision_reason
)
SELECT
  i.tenant_id, i.id, 1, true, CURRENT_DATE,
  'Controlled multi-level demonstration BOM; not a client production specification.',
  'APPROVED', now(), 'Approved for Mizantra workflow demonstration.',
  1, 'PCS', 'MIZANTRA_MULTI_LEVEL_MASTER_PR_V1',
  'Initial multi-level Load BOM and master PR demonstration'
FROM demo_bom_parents p
JOIN public.items i ON i.code=p.code
WHERE i.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.bom_headers bh
    WHERE bh.tenant_id=i.tenant_id AND bh.item_id=i.id AND bh.version=1
  );

UPDATE public.bom_headers bh
SET is_active=true, lifecycle_status='APPROVED', effective_from=CURRENT_DATE,
    effective_to=NULL, approved_at=COALESCE(bh.approved_at, now()),
    approval_note='Approved for Mizantra workflow demonstration.',
    output_quantity=1, output_uom='PCS',
    source_pack_code='MIZANTRA_MULTI_LEVEL_MASTER_PR_V1',
    notes='Controlled multi-level demonstration BOM; not a client production specification.',
    updated_at=now()
FROM public.items i
JOIN demo_bom_parents p ON p.code=i.code
WHERE bh.tenant_id=i.tenant_id AND bh.item_id=i.id AND bh.version=1
  AND bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid;

CREATE TEMP TABLE demo_bom_lines (
  parent_code text NOT NULL,
  component_code text NOT NULL,
  quantity numeric NOT NULL,
  sequence integer NOT NULL,
  component_kind text NOT NULL,
  supply_policy text NOT NULL,
  PRIMARY KEY(parent_code, component_code)
) ON COMMIT DROP;

INSERT INTO demo_bom_lines VALUES
  ('DEMO-ML-FG-001','DEMO-ML-SA-01',1,10,'BOM','MAKE'),
  ('DEMO-ML-FG-001','DEMO-ML-SA-02',1,20,'BOM','MAKE'),
  ('DEMO-ML-FG-001','DEMO-ML-SA-03',1,30,'BOM','MAKE'),
  ('DEMO-ML-FG-001','DEMO-ML-SA-04',1,40,'BOM','BUY'),
  ('DEMO-ML-FG-001','DEMO-ML-SA-05',1,50,'BOM','DIRECT'),
  ('DEMO-ML-FG-001','DEMO-ML-DIR-01',2,60,'ITEM','BUY'),
  ('DEMO-ML-FG-001','DEMO-ML-DIR-02',1,70,'ITEM','BUY'),
  ('DEMO-ML-FG-001','DEMO-ML-DIR-03',3,80,'ITEM','BUY'),
  ('DEMO-ML-FG-001','DEMO-ML-DIR-04',0.5,90,'ITEM','DIRECT'),
  ('DEMO-ML-SA-01','DEMO-ML-RM-COMMON',4,10,'ITEM','BUY'),
  ('DEMO-ML-SA-01','DEMO-ML-RM-FRAME',1,20,'ITEM','BUY'),
  ('DEMO-ML-SA-02','DEMO-ML-RM-WIRE',3,10,'ITEM','BUY'),
  ('DEMO-ML-SA-02','DEMO-ML-RM-CONTACTOR',1,20,'ITEM','BUY'),
  ('DEMO-ML-SA-03','DEMO-ML-RM-COMMON',2,10,'ITEM','BUY'),
  ('DEMO-ML-SA-03','DEMO-ML-RM-BEARING',1,20,'ITEM','BUY'),
  ('DEMO-ML-SA-03','DEMO-ML-RM-SHAFT',1,30,'ITEM','BUY'),
  ('DEMO-ML-SA-04','DEMO-ML-RM-PUMP-BODY',1,10,'ITEM','BUY'),
  ('DEMO-ML-SA-04','DEMO-ML-RM-IMPELLER',1,20,'ITEM','BUY'),
  ('DEMO-ML-SA-05','DEMO-ML-RM-GUARD',1,10,'ITEM','BUY'),
  ('DEMO-ML-SA-05','DEMO-ML-RM-BRACKET',2,20,'ITEM','BUY');

-- Update existing demo rows if this seed is reapplied.
UPDATE public.bom_items bi
SET quantity=d.quantity, sequence=d.sequence, scrap_percentage=0,
    component_type=d.component_kind, issue_method='MANUAL',
    consumption_uom='PCS', quantity_basis='PER_OUTPUT', rounding_rule='NONE',
    supply_policy=d.supply_policy,
    notes='Mizantra multi-level demo component.'
FROM demo_bom_lines d
JOIN public.items parent ON parent.code=d.parent_code
JOIN public.bom_headers parent_bom
  ON parent_bom.item_id=parent.id AND parent_bom.version=1
JOIN public.items component ON component.code=d.component_code
LEFT JOIN public.bom_headers child_bom
  ON child_bom.item_id=component.id AND child_bom.version=1
WHERE bi.bom_id=parent_bom.id
  AND parent_bom.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND (
    (d.component_kind='ITEM' AND bi.item_id=component.id) OR
    (d.component_kind='BOM' AND bi.child_bom_id=child_bom.id)
  );

INSERT INTO public.bom_items (
  bom_id, item_id, child_bom_id, quantity, scrap_percentage, sequence, notes,
  component_type, issue_method, consumption_uom, quantity_basis,
  rounding_rule, supply_policy
)
SELECT
  parent_bom.id,
  CASE WHEN d.component_kind='ITEM' THEN component.id ELSE NULL END,
  CASE WHEN d.component_kind='BOM' THEN child_bom.id ELSE NULL END,
  d.quantity, 0, d.sequence, 'Mizantra multi-level demo component.',
  d.component_kind, 'MANUAL', 'PCS', 'PER_OUTPUT', 'NONE', d.supply_policy
FROM demo_bom_lines d
JOIN public.items parent ON parent.code=d.parent_code
JOIN public.bom_headers parent_bom
  ON parent_bom.item_id=parent.id AND parent_bom.version=1
JOIN public.items component ON component.code=d.component_code
LEFT JOIN public.bom_headers child_bom
  ON child_bom.item_id=component.id AND child_bom.version=1
WHERE parent_bom.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.bom_items bi
    WHERE bi.bom_id=parent_bom.id
      AND (
        (d.component_kind='ITEM' AND bi.item_id=component.id) OR
        (d.component_kind='BOM' AND bi.child_bom_id=child_bom.id)
      )
  );

CREATE TEMP TABLE demo_routes (
  parent_code text NOT NULL,
  operation_sequence integer NOT NULL,
  operation_name text NOT NULL,
  station_code text NOT NULL,
  cycle_time numeric NOT NULL,
  setup_time numeric NOT NULL,
  PRIMARY KEY(parent_code, operation_sequence)
) ON COMMIT DROP;

INSERT INTO demo_routes
SELECT p.code, r.operation_sequence, r.operation_name, r.station_code,
       r.cycle_time, r.setup_time
FROM demo_bom_parents p
CROSS JOIN (VALUES
  (10, 'Component Preparation', 'CUT-01', 8::numeric, 3::numeric),
  (20, 'Assembly', 'ASSEMBLY-01', 12::numeric, 2::numeric),
  (30, 'Quality Inspection', 'QC-01', 5::numeric, 0::numeric)
) AS r(operation_sequence, operation_name, station_code, cycle_time, setup_time);

UPDATE public.bom_routing br
SET operation_name=d.operation_name, workstation_id=ws.id,
    cycle_time=d.cycle_time, setup_time=d.setup_time,
    notes='Mizantra multi-level demo routing.', updated_at=now()
FROM demo_routes d
JOIN public.items parent ON parent.code=d.parent_code
JOIN public.bom_headers bh ON bh.item_id=parent.id AND bh.version=1
JOIN public.work_stations ws
  ON ws.tenant_id=bh.tenant_id AND ws.station_code=d.station_code AND ws.is_active=true
WHERE br.bom_id=bh.id AND br.operation_sequence=d.operation_sequence
  AND bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid;

INSERT INTO public.bom_routing (
  tenant_id, bom_id, operation_sequence, operation_name, workstation_id,
  cycle_time, setup_time, notes
)
SELECT bh.tenant_id, bh.id, d.operation_sequence, d.operation_name, ws.id,
       d.cycle_time, d.setup_time, 'Mizantra multi-level demo routing.'
FROM demo_routes d
JOIN public.items parent ON parent.code=d.parent_code
JOIN public.bom_headers bh ON bh.item_id=parent.id AND bh.version=1
JOIN public.work_stations ws
  ON ws.tenant_id=bh.tenant_id AND ws.station_code=d.station_code AND ws.is_active=true
WHERE bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.bom_routing br
    WHERE br.bom_id=bh.id AND br.operation_sequence=d.operation_sequence
  );

-- Reset only stock rows owned by this named demo pack, then seed a controlled
-- availability mix. Existing client stock is never selected by this delete.
DELETE FROM public.stock_entries se
USING public.items i
WHERE se.item_id=i.id
  AND se.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND i.tenant_id=se.tenant_id
  AND i.metadata->>'demoPack'='MIZANTRA_MULTI_LEVEL_MASTER_PR_V1'
  AND se.metadata->>'demoPack'='MIZANTRA_MULTI_LEVEL_MASTER_PR_V1';

INSERT INTO public.stock_entries (
  tenant_id, item_id, warehouse_id, quantity, available_quantity,
  allocated_quantity, unit_price, metadata
)
SELECT i.tenant_id, i.id, w.id, d.stock_qty, d.stock_qty, 0,
       d.standard_cost,
       jsonb_build_object(
         'demoPack','MIZANTRA_MULTI_LEVEL_MASTER_PR_V1',
         'purpose','Controlled stock mix for Load BOM'
       )
FROM demo_items d
JOIN public.items i ON i.code=d.code
JOIN public.warehouses w
  ON w.tenant_id=i.tenant_id AND w.code='MAIN_WAREHOUSE' AND w.is_active=true
WHERE i.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND d.stock_qty > 0;

DO $$
DECLARE
  v_top_lines integer;
  v_child_lines integer;
  v_routes integer;
BEGIN
  SELECT count(*) INTO v_top_lines
  FROM public.bom_items bi
  JOIN public.bom_headers bh ON bh.id=bi.bom_id
  JOIN public.items i ON i.id=bh.item_id
  WHERE bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
    AND i.code='DEMO-ML-FG-001';

  SELECT count(*) INTO v_child_lines
  FROM public.bom_items bi
  JOIN public.bom_headers bh ON bh.id=bi.bom_id
  JOIN public.items i ON i.id=bh.item_id
  WHERE bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
    AND i.code LIKE 'DEMO-ML-SA-%';

  SELECT count(*) INTO v_routes
  FROM public.bom_routing br
  JOIN public.bom_headers bh ON bh.id=br.bom_id
  JOIN public.items i ON i.id=bh.item_id
  WHERE bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
    AND (i.code='DEMO-ML-FG-001' OR i.code LIKE 'DEMO-ML-SA-%');

  IF v_top_lines <> 9 OR v_child_lines <> 11 OR v_routes <> 18 THEN
    RAISE EXCEPTION 'Demo verification failed: top %, child %, routes %',
      v_top_lines, v_child_lines, v_routes;
  END IF;
END $$;

COMMIT;
