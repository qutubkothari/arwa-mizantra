-- Mizantra-only AC duct demonstration catalogue.
-- Values are illustrative demo masters and must be replaced by approved client
-- drawings, gauges, take-offs, loss factors and commercial rates before live use.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.items
    WHERE tenant_id = 'f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  ) THEN
    RAISE EXCEPTION 'Mizantra tenant guard failed';
  END IF;
END $$;

CREATE TEMP TABLE duct_demo_items (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  uom text NOT NULL,
  enum_type text NOT NULL,
  item_type text NOT NULL,
  standard_cost numeric,
  selling_price numeric,
  hsn_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;

INSERT INTO duct_demo_items VALUES
  ('100-0024', 'GI Sheet Coil - 0.8 mm Galvanized',
   'Galvanized steel coil consumed by weight for duct fabrication.',
   'RAW_MATERIAL', 'KG', 'RAW_MATERIAL', 'RAW_MATERIAL', 92, NULL, '7210',
   '{"demoPack":"AC_DUCT_DEMO_V1","gaugeMm":0.8,"densityKgM3":7850}'::jsonb),
  ('DCT-RM-FLANGE20', 'TDF Flange Section - 20 mm',
   'Formed flange section for rectangular duct joints.',
   'RAW_MATERIAL', 'MTR', 'RAW_MATERIAL', 'RAW_MATERIAL', 145, NULL, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1","profile":"TDF 20 mm"}'::jsonb),
  ('DCT-RM-CORNER20', 'TDF Corner Cleat - 20 mm',
   'Corner cleat used with TDF flange joints.',
   'RAW_MATERIAL', 'PCS', 'RAW_MATERIAL', 'RAW_MATERIAL', 18, NULL, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1"}'::jsonb),
  ('DCT-RM-GASKET', 'EPDM Duct Gasket - 5 x 20 mm',
   'Closed-cell gasket for sealed duct joints.',
   'CONSUMABLE', 'MTR', 'CONSUMABLE', 'RAW_MATERIAL', 22, NULL, '4016',
   '{"demoPack":"AC_DUCT_DEMO_V1"}'::jsonb),
  ('DCT-RM-SEALANT', 'HVAC Duct Sealant',
   'Joint sealant issued by weight.',
   'CONSUMABLE', 'KG', 'CONSUMABLE', 'RAW_MATERIAL', 280, NULL, '3214',
   '{"demoPack":"AC_DUCT_DEMO_V1"}'::jsonb),
  ('DCT-RM-ANGLE20', 'GI Reinforcement Angle - 20 x 20 mm',
   'Internal or external reinforcement for larger duct fittings.',
   'RAW_MATERIAL', 'MTR', 'RAW_MATERIAL', 'RAW_MATERIAL', 85, NULL, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1"}'::jsonb),
  ('DCT-RM-INS25', 'Nitrile Rubber Insulation - 25 mm',
   'Closed-cell thermal insulation issued by area.',
   'RAW_MATERIAL', 'SQM', 'RAW_MATERIAL', 'RAW_MATERIAL', 480, NULL, '4008',
   '{"demoPack":"AC_DUCT_DEMO_V1","thicknessMm":25}'::jsonb),
  ('DCT-RM-INTAPE', 'Insulation Joint Tape',
   'Self-adhesive insulation joint tape issued by length.',
   'CONSUMABLE', 'MTR', 'CONSUMABLE', 'RAW_MATERIAL', 12, NULL, '3919',
   '{"demoPack":"AC_DUCT_DEMO_V1"}'::jsonb),
  ('700-0002', 'Rectangular GI Duct Section',
   'Demo straight rectangular duct section, nominal 600 x 300 x 1200 mm, 0.8 mm GI.',
   'FINISHED_GOODS', 'PCS', 'FINISHED_GOODS', 'FINISHED_GOOD', 1750, 2350, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1","ductType":"RECTANGULAR_STRAIGHT","widthMm":600,"heightMm":300,"lengthMm":1200,"gaugeMm":0.8}'::jsonb),
  ('700-0101', 'Rectangular GI Duct 900 x 450 x 1200 mm',
   'Demo large rectangular straight duct section, 0.8 mm GI.',
   'FINISHED_GOODS', 'PCS', 'FINISHED_GOODS', 'FINISHED_GOOD', 2600, 3500, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1","ductType":"RECTANGULAR_STRAIGHT","widthMm":900,"heightMm":450,"lengthMm":1200,"gaugeMm":0.8}'::jsonb),
  ('700-0102', 'Rectangular GI Elbow 600 x 300 mm - 90 Degree',
   'Demo rectangular 90 degree elbow, 0.8 mm GI.',
   'FINISHED_GOODS', 'PCS', 'FINISHED_GOODS', 'FINISHED_GOOD', 1450, 2050, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1","ductType":"RECTANGULAR_ELBOW","widthMm":600,"heightMm":300,"angleDeg":90,"gaugeMm":0.8}'::jsonb),
  ('700-0103', 'Rectangular GI Reducer 600 x 300 to 450 x 250 mm',
   'Demo concentric rectangular reducer, 0.8 mm GI.',
   'FINISHED_GOODS', 'PCS', 'FINISHED_GOODS', 'FINISHED_GOOD', 1200, 1750, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1","ductType":"RECTANGULAR_REDUCER","inletWidthMm":600,"inletHeightMm":300,"outletWidthMm":450,"outletHeightMm":250,"lengthMm":600,"gaugeMm":0.8}'::jsonb),
  ('700-0104', 'Rectangular GI Tee 600 x 300 / 300 x 200 mm',
   'Demo rectangular branch tee with reinforcement, 0.8 mm GI.',
   'FINISHED_GOODS', 'PCS', 'FINISHED_GOODS', 'FINISHED_GOOD', 2250, 3100, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1","ductType":"RECTANGULAR_TEE","mainWidthMm":600,"mainHeightMm":300,"branchWidthMm":300,"branchHeightMm":200,"gaugeMm":0.8}'::jsonb),
  ('700-0105', 'Insulated Rectangular GI Duct 600 x 300 x 1200 mm',
   'Demo straight rectangular duct with 25 mm nitrile insulation.',
   'FINISHED_GOODS', 'PCS', 'FINISHED_GOODS', 'FINISHED_GOOD', 3000, 4150, '7308',
   '{"demoPack":"AC_DUCT_DEMO_V1","ductType":"INSULATED_RECTANGULAR","widthMm":600,"heightMm":300,"lengthMm":1200,"gaugeMm":0.8,"insulationMm":25}'::jsonb);

INSERT INTO public.items (
  tenant_id, code, name, description, category, uom, standard_cost,
  selling_price, hsn_code, type, item_type, is_active, is_verified,
  approval_status, approved_at, metadata, uid_tracking, uid_strategy
)
SELECT
  'f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid,
  d.code, d.name, d.description, d.category, d.uom, d.standard_cost,
  d.selling_price, d.hsn_code, d.enum_type::item_type, d.item_type,
  true, true, 'APPROVED', now(),
  d.metadata || jsonb_build_object(
    'itemApproval', jsonb_build_object(
      'status', 'APPROVED', 'approvedAt', now(), 'source', 'AC_DUCT_DEMO_V1'
    )
  ),
  false, 'NONE'::uid_strategy_enum
FROM duct_demo_items d
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  uom = EXCLUDED.uom,
  standard_cost = EXCLUDED.standard_cost,
  selling_price = EXCLUDED.selling_price,
  hsn_code = EXCLUDED.hsn_code,
  type = EXCLUDED.type,
  item_type = EXCLUDED.item_type,
  is_active = true,
  is_verified = true,
  approval_status = 'APPROVED',
  approved_at = COALESCE(public.items.approved_at, now()),
  metadata = COALESCE(public.items.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  uid_tracking = false,
  uid_strategy = 'NONE'::uid_strategy_enum,
  updated_at = now();

CREATE TEMP TABLE duct_demo_products (code text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO duct_demo_products VALUES
  ('700-0002'), ('700-0101'), ('700-0102'), ('700-0103'), ('700-0104'), ('700-0105');

INSERT INTO public.bom_headers (
  tenant_id, item_id, version, is_active, effective_from, notes,
  lifecycle_status, approved_at, approval_note, output_quantity,
  output_uom, source_pack_code, revision_reason
)
SELECT
  i.tenant_id, i.id, 1, true, CURRENT_DATE,
  'Illustrative AC duct demo BOM. Validate against approved project take-off before production.',
  'APPROVED', now(), 'Approved demo master for Mizantra walkthrough.',
  1, 'PCS', 'AC_DUCT_DEMO_V1', 'Initial controlled demo product family'
FROM duct_demo_products p
JOIN public.items i ON i.code=p.code
WHERE i.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.bom_headers bh
    WHERE bh.tenant_id=i.tenant_id AND bh.item_id=i.id AND bh.version=1
  );

UPDATE public.bom_headers bh
SET is_active=true,
    lifecycle_status='APPROVED',
    effective_from=COALESCE(bh.effective_from, CURRENT_DATE),
    effective_to=NULL,
    approved_at=COALESCE(bh.approved_at, now()),
    approval_note=COALESCE(bh.approval_note, 'Approved demo master for Mizantra walkthrough.'),
    output_quantity=1,
    output_uom='PCS',
    source_pack_code='AC_DUCT_DEMO_V1',
    notes='Illustrative AC duct demo BOM. Validate against approved project take-off before production.',
    updated_at=now()
FROM public.items i
JOIN duct_demo_products p ON p.code=i.code
WHERE bh.item_id=i.id
  AND bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND bh.version=1;

CREATE TEMP TABLE duct_demo_components (
  parent_code text NOT NULL,
  component_code text NOT NULL,
  quantity numeric NOT NULL,
  scrap_percentage numeric NOT NULL,
  sequence integer NOT NULL,
  consumption_uom text NOT NULL,
  PRIMARY KEY (parent_code, component_code)
) ON COMMIT DROP;

INSERT INTO duct_demo_components VALUES
  ('700-0002','100-0024',13.56,8,10,'KG'),
  ('700-0002','DCT-RM-FLANGE20',3.60,3,20,'MTR'),
  ('700-0002','DCT-RM-CORNER20',8,0,30,'PCS'),
  ('700-0002','DCT-RM-GASKET',3.80,2,40,'MTR'),
  ('700-0002','DCT-RM-SEALANT',0.18,5,50,'KG'),
  ('700-0101','100-0024',20.35,8,10,'KG'),
  ('700-0101','DCT-RM-FLANGE20',5.40,3,20,'MTR'),
  ('700-0101','DCT-RM-CORNER20',8,0,30,'PCS'),
  ('700-0101','DCT-RM-GASKET',5.60,2,40,'MTR'),
  ('700-0101','DCT-RM-SEALANT',0.25,5,50,'KG'),
  ('700-0101','DCT-RM-ANGLE20',2.70,3,60,'MTR'),
  ('700-0102','100-0024',9.80,10,10,'KG'),
  ('700-0102','DCT-RM-FLANGE20',3.60,3,20,'MTR'),
  ('700-0102','DCT-RM-CORNER20',8,0,30,'PCS'),
  ('700-0102','DCT-RM-GASKET',3.80,2,40,'MTR'),
  ('700-0102','DCT-RM-SEALANT',0.22,5,50,'KG'),
  ('700-0103','100-0024',7.40,10,10,'KG'),
  ('700-0103','DCT-RM-FLANGE20',3.10,3,20,'MTR'),
  ('700-0103','DCT-RM-CORNER20',8,0,30,'PCS'),
  ('700-0103','DCT-RM-GASKET',3.30,2,40,'MTR'),
  ('700-0103','DCT-RM-SEALANT',0.16,5,50,'KG'),
  ('700-0104','100-0024',13.80,10,10,'KG'),
  ('700-0104','DCT-RM-FLANGE20',4.60,3,20,'MTR'),
  ('700-0104','DCT-RM-CORNER20',12,0,30,'PCS'),
  ('700-0104','DCT-RM-GASKET',5.00,2,40,'MTR'),
  ('700-0104','DCT-RM-SEALANT',0.30,5,50,'KG'),
  ('700-0104','DCT-RM-ANGLE20',1.80,3,60,'MTR'),
  ('700-0105','100-0024',13.56,8,10,'KG'),
  ('700-0105','DCT-RM-FLANGE20',3.60,3,20,'MTR'),
  ('700-0105','DCT-RM-CORNER20',8,0,30,'PCS'),
  ('700-0105','DCT-RM-GASKET',3.80,2,40,'MTR'),
  ('700-0105','DCT-RM-SEALANT',0.18,5,50,'KG'),
  ('700-0105','DCT-RM-INS25',2.30,5,60,'SQM'),
  ('700-0105','DCT-RM-INTAPE',5.00,5,70,'MTR');

UPDATE public.bom_items bi
SET quantity=d.quantity,
    scrap_percentage=d.scrap_percentage,
    sequence=d.sequence,
    consumption_uom=d.consumption_uom,
    component_type='ITEM',
    quantity_basis='PER_OUTPUT',
    rounding_rule=CASE WHEN d.consumption_uom='PCS' THEN 'UP' ELSE 'NONE' END,
    notes='Illustrative demo consumption; validate against approved take-off.'
FROM duct_demo_components d
JOIN public.items parent ON parent.code=d.parent_code
JOIN public.items component ON component.code=d.component_code
JOIN public.bom_headers bh ON bh.item_id=parent.id AND bh.version=1
WHERE bi.bom_id=bh.id AND bi.item_id=component.id
  AND bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid;

INSERT INTO public.bom_items (
  bom_id, item_id, quantity, scrap_percentage, sequence, notes,
  component_type, issue_method, consumption_uom, quantity_basis, rounding_rule
)
SELECT
  bh.id, component.id, d.quantity, d.scrap_percentage, d.sequence,
  'Illustrative demo consumption; validate against approved take-off.',
  'ITEM', 'MANUAL', d.consumption_uom, 'PER_OUTPUT',
  CASE WHEN d.consumption_uom='PCS' THEN 'UP' ELSE 'NONE' END
FROM duct_demo_components d
JOIN public.items parent ON parent.code=d.parent_code
JOIN public.items component ON component.code=d.component_code
JOIN public.bom_headers bh ON bh.item_id=parent.id AND bh.version=1
WHERE bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.bom_items bi
    WHERE bi.bom_id=bh.id AND bi.item_id=component.id
  );

CREATE TEMP TABLE duct_demo_routes (
  parent_code text NOT NULL,
  operation_sequence integer NOT NULL,
  operation_name text NOT NULL,
  station_code text NOT NULL,
  cycle_time numeric NOT NULL,
  setup_time numeric NOT NULL,
  PRIMARY KEY (parent_code, operation_sequence)
) ON COMMIT DROP;

INSERT INTO duct_demo_routes
SELECT p.code, r.operation_sequence, r.operation_name, r.station_code,
       r.cycle_time + CASE
         WHEN p.code='700-0101' THEN 5
         WHEN p.code='700-0104' THEN 8
         ELSE 0 END,
       r.setup_time
FROM duct_demo_products p
CROSS JOIN (VALUES
  (10,'Shearing / CNC Cutting','CUT-01',12::numeric,10::numeric),
  (20,'Beading / Grooving','FORM-01',8,5),
  (30,'TDF / TDC Flange Forming','FLANGE-01',8,5),
  (40,'Corner / Cleat Fitting','ASSEMBLY-01',6,2),
  (50,'Sealant / Gasket Application','SEAL-01',6,2),
  (60,'Final Assembly','ASSEMBLY-01',8,2),
  (80,'Quality Inspection','QC-01',5,0),
  (90,'Packing / Dispatch Readiness','PACK-01',4,0)
) AS r(operation_sequence, operation_name, station_code, cycle_time, setup_time);

INSERT INTO duct_demo_routes VALUES
  ('700-0105',70,'Thermal Insulation','INSUL-01',12,3)
ON CONFLICT DO NOTHING;

UPDATE public.bom_routing br
SET operation_name=d.operation_name,
    workstation_id=ws.id,
    cycle_time=d.cycle_time,
    setup_time=d.setup_time,
    notes='Controlled demo route; times are illustrative and editable.',
    updated_at=now()
FROM duct_demo_routes d
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
SELECT
  bh.tenant_id, bh.id, d.operation_sequence, d.operation_name, ws.id,
  d.cycle_time, d.setup_time,
  'Controlled demo route; times are illustrative and editable.'
FROM duct_demo_routes d
JOIN public.items parent ON parent.code=d.parent_code
JOIN public.bom_headers bh ON bh.item_id=parent.id AND bh.version=1
JOIN public.work_stations ws
  ON ws.tenant_id=bh.tenant_id AND ws.station_code=d.station_code AND ws.is_active=true
WHERE bh.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.bom_routing br
    WHERE br.bom_id=bh.id AND br.operation_sequence=d.operation_sequence
  );

DO $$
DECLARE
  product_count integer;
  component_count integer;
  route_count integer;
BEGIN
  SELECT COUNT(DISTINCT i.id), COUNT(DISTINCT bi.id), COUNT(DISTINCT br.id)
  INTO product_count, component_count, route_count
  FROM public.items i
  JOIN public.bom_headers bh ON bh.item_id=i.id AND bh.version=1
  LEFT JOIN public.bom_items bi ON bi.bom_id=bh.id
  LEFT JOIN public.bom_routing br ON br.bom_id=bh.id
  WHERE i.tenant_id='f87a5ab0-0619-4f1c-bab9-e78ca750e56c'::uuid
    AND i.code IN ('700-0002','700-0101','700-0102','700-0103','700-0104','700-0105')
    AND i.item_type='FINISHED_GOOD'
    AND i.is_active=true AND i.is_verified=true
    AND bh.is_active=true AND bh.lifecycle_status='APPROVED';

  IF product_count <> 6 OR component_count < 34 OR route_count < 49 THEN
    RAISE EXCEPTION 'Duct demo verification failed: products %, components %, routes %',
      product_count, component_count, route_count;
  END IF;
END $$;

COMMIT;
