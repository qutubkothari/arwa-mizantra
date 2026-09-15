export type ProductionPackAttribute = {
  family_code: string;
  attribute_code: string;
  attribute_name: string;
  data_type: "NUMBER" | "TEXT" | "OPTION" | "BOOLEAN" | "DATE" | "MEASUREMENT";
  unit_code?: string;
  required?: boolean;
  allowed_values?: string[];
  identity_sequence?: number;
};

export type ProductionPackFormula = {
  formula_code: string;
  formula_name: string;
  version: number;
  expression: string;
  input_schema: Record<string, { type: "NUMBER"; default: number }>;
  output_target:
    | "BOM_QUANTITY"
    | "SCRAP_PERCENT"
    | "YIELD_PERCENT"
    | "OPERATION_TIME"
    | "COST_DRIVER";
  output_uom: string;
  rounding_mode: "HALF_UP" | "UP" | "DOWN";
  decimal_places: number;
  test_cases: Array<{
    case_name: string;
    input_values: Record<string, number>;
    expected_result: number;
    tolerance: number;
  }>;
};

export type ProductionConfigurationPack = {
  code: string;
  name: string;
  industry: string;
  version: number;
  status: "STARTER";
  source: string;
  description: string;
  guardrails: string[];
  attributes: ProductionPackAttribute[];
  formulas: ProductionPackFormula[];
  operation_templates: Array<{
    sequence: number;
    operation: string;
    suggested_resource: string;
    evidence: string[];
  }>;
  quality_templates: Array<{ stage: string; characteristics: string[] }>;
  cost_elements: string[];
  demo_baseline?: {
    label: string;
    disclaimer: string;
    reference_profile: Record<string, string | number>;
    calculated_example: Record<string, string | number>;
    operation_benchmarks: Array<{
      sequence: number;
      enabled: boolean;
      setup_time_minutes: number;
      cycle_time_minutes: number;
      note: string;
    }>;
    quality_specifications: Record<string, Record<string, string>>;
    cost_benchmarks: Record<string, number>;
    cost_currency: string;
    mrp_parameters: Record<string, string | number>;
  };
  required_client_data: string[];
};

const acDuct: ProductionConfigurationPack = {
  code: "AC_DUCT_BLUEPRINT",
  name: "AC Duct Manufacturing Starter Pack",
  industry: "HVAC / sheet-metal manufacturing",
  version: 2,
  status: "STARTER",
  source: "Mizantra AC Duct Manufacturing Implementation Blueprint",
  description:
    "Draft configuration for project-led duct manufacturing. It uses the canonical BOM, routing, resource, MRP, shop-floor, quality and costing services.",
  guardrails: [
    "Installation creates draft engineering configuration only.",
    "It never creates items, BOMs, routings, jobs, inventory or finance postings.",
    "A different authorized user must approve definitions before planning can use them.",
    "Dimensions, formulas, machines, process order and QC tolerances must be validated during client discovery.",
    "Values marked DEMO BENCHMARK are illustrative and must not be approved until replaced by drawings, quotations or a factory time study.",
  ],
  attributes: [
    {
      family_code: "AC_DUCT",
      attribute_code: "duct_type",
      attribute_name: "Duct type",
      data_type: "OPTION",
      required: true,
      allowed_values: [
        "RECTANGULAR",
        "SQUARE",
        "ROUND",
        "SPIRAL",
        "FLEXIBLE",
        "FITTING",
      ],
      identity_sequence: 1,
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "width_mm",
      attribute_name: "Width",
      data_type: "MEASUREMENT",
      unit_code: "MM",
      identity_sequence: 2,
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "height_mm",
      attribute_name: "Height",
      data_type: "MEASUREMENT",
      unit_code: "MM",
      identity_sequence: 3,
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "diameter_mm",
      attribute_name: "Diameter",
      data_type: "MEASUREMENT",
      unit_code: "MM",
      identity_sequence: 4,
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "length_mm",
      attribute_name: "Length",
      data_type: "MEASUREMENT",
      unit_code: "MM",
      required: true,
      identity_sequence: 5,
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "thickness_mm",
      attribute_name: "Sheet thickness / gauge",
      data_type: "MEASUREMENT",
      unit_code: "MM",
      required: true,
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "material_grade",
      attribute_name: "Material and grade",
      data_type: "TEXT",
      required: true,
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "joint_type",
      attribute_name: "Joint type",
      data_type: "TEXT",
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "flange_type",
      attribute_name: "Flange type",
      data_type: "TEXT",
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "insulation_type",
      attribute_name: "Insulation type",
      data_type: "TEXT",
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "insulation_thickness_mm",
      attribute_name: "Insulation thickness",
      data_type: "MEASUREMENT",
      unit_code: "MM",
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "reinforcement_type",
      attribute_name: "Reinforcement",
      data_type: "TEXT",
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "liner_type",
      attribute_name: "Liner",
      data_type: "TEXT",
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "sealant_type",
      attribute_name: "Sealant",
      data_type: "TEXT",
    },
    {
      family_code: "AC_DUCT",
      attribute_code: "project_location_ref",
      attribute_name: "Area / floor / zone",
      data_type: "TEXT",
    },
  ],
  formulas: [
    {
      formula_code: "ACD_RECT_SURFACE_AREA_M2",
      formula_name: "Rectangular duct developed surface area",
      version: 1,
      expression: "2*(width_mm+height_mm)*length_mm*quantity/1000000",
      input_schema: {
        width_mm: { type: "NUMBER", default: 1200 },
        height_mm: { type: "NUMBER", default: 600 },
        length_mm: { type: "NUMBER", default: 1500 },
        quantity: { type: "NUMBER", default: 1 },
      },
      output_target: "BOM_QUANTITY",
      output_uom: "M2",
      rounding_mode: "UP",
      decimal_places: 4,
      test_cases: [
        {
          case_name: "1200 x 600 x 1500 mm duct",
          input_values: {
            width_mm: 1200,
            height_mm: 600,
            length_mm: 1500,
            quantity: 1,
          },
          expected_result: 5.4,
          tolerance: 0.0001,
        },
      ],
    },
    {
      formula_code: "ACD_SHEET_QTY",
      formula_name: "Sheets required from approved developed area and yield",
      version: 1,
      expression: "ceil(developed_area_m2/sheet_area_m2/(yield_pct/100))",
      input_schema: {
        developed_area_m2: { type: "NUMBER", default: 5.4 },
        sheet_area_m2: { type: "NUMBER", default: 3 },
        yield_pct: { type: "NUMBER", default: 90 },
      },
      output_target: "BOM_QUANTITY",
      output_uom: "SHEET",
      rounding_mode: "UP",
      decimal_places: 0,
      test_cases: [
        {
          case_name: "Two sheets at 90 percent yield",
          input_values: {
            developed_area_m2: 5.4,
            sheet_area_m2: 3,
            yield_pct: 90,
          },
          expected_result: 2,
          tolerance: 0,
        },
      ],
    },
    {
      formula_code: "ACD_OPERATION_MINUTES",
      formula_name: "Setup plus run-time standard",
      version: 1,
      expression: "setup_minutes+(quantity*cycle_minutes)",
      input_schema: {
        setup_minutes: { type: "NUMBER", default: 20 },
        quantity: { type: "NUMBER", default: 10 },
        cycle_minutes: { type: "NUMBER", default: 3 },
      },
      output_target: "OPERATION_TIME",
      output_uom: "MIN",
      rounding_mode: "UP",
      decimal_places: 2,
      test_cases: [
        {
          case_name: "Ten pieces plus setup",
          input_values: { setup_minutes: 20, quantity: 10, cycle_minutes: 3 },
          expected_result: 50,
          tolerance: 0,
        },
      ],
    },
    {
      formula_code: "ACD_RECT_METAL_WEIGHT_KG",
      formula_name: "Rectangular duct sheet weight including fabrication allowance",
      version: 1,
      expression:
        "2*(width_mm+height_mm)*length_mm/1000000*thickness_mm/1000*material_density_kg_m3*quantity*(1+fabrication_allowance_pct/100)",
      input_schema: {
        width_mm: { type: "NUMBER", default: 600 },
        height_mm: { type: "NUMBER", default: 400 },
        length_mm: { type: "NUMBER", default: 1200 },
        thickness_mm: { type: "NUMBER", default: 0.8 },
        material_density_kg_m3: { type: "NUMBER", default: 7850 },
        quantity: { type: "NUMBER", default: 1 },
        fabrication_allowance_pct: { type: "NUMBER", default: 8 },
      },
      output_target: "BOM_QUANTITY",
      output_uom: "KG",
      rounding_mode: "UP",
      decimal_places: 3,
      test_cases: [
        {
          case_name: "600 x 400 x 1200 mm, 0.8 mm GI demo duct",
          input_values: {
            width_mm: 600,
            height_mm: 400,
            length_mm: 1200,
            thickness_mm: 0.8,
            material_density_kg_m3: 7850,
            quantity: 1,
            fabrication_allowance_pct: 8,
          },
          expected_result: 16.278,
          tolerance: 0.001,
        },
      ],
    },
    {
      formula_code: "ACD_RECT_JOINT_PERIMETER_M",
      formula_name: "Rectangular duct joint perimeter",
      version: 1,
      expression: "2*(width_mm+height_mm)*joint_count*quantity/1000",
      input_schema: {
        width_mm: { type: "NUMBER", default: 600 },
        height_mm: { type: "NUMBER", default: 400 },
        joint_count: { type: "NUMBER", default: 1 },
        quantity: { type: "NUMBER", default: 1 },
      },
      output_target: "BOM_QUANTITY",
      output_uom: "M",
      rounding_mode: "UP",
      decimal_places: 3,
      test_cases: [
        {
          case_name: "One 600 x 400 mm joint",
          input_values: {
            width_mm: 600,
            height_mm: 400,
            joint_count: 1,
            quantity: 1,
          },
          expected_result: 2,
          tolerance: 0,
        },
      ],
    },
  ],
  operation_templates: [
    [
      10,
      "Shearing / CNC cutting",
      "CNC cutting or shearing",
      ["setup", "cycle time", "sheet utilization"],
    ],
    [
      20,
      "Beading / grooving",
      "Beading work centre",
      ["cycle time", "operator"],
    ],
    [30, "Pittsburgh lock forming", "Lock former", ["setup", "run time"]],
    [40, "TDF/TDC / flange forming", "Flange machine", ["setup", "rate"]],
    [50, "Corner / cleat fitting", "Assembly station", ["labour", "quantity"]],
    [60, "Reinforcement", "Reinforcement station", ["material", "labour"]],
    [70, "Insulation", "Insulation station", ["material", "labour"]],
    [80, "Sealant / gasket", "Sealing station", ["material consumption"]],
    [90, "Assembly", "Final assembly", ["labour", "good output", "rejection"]],
    [
      100,
      "Quality inspection",
      "QC station",
      ["inspection result", "NCR", "rework"],
    ],
    [
      110,
      "Packing",
      "Packing station",
      ["packaging consumption", "package reference"],
    ],
    [
      120,
      "Dispatch readiness",
      "Dispatch staging",
      ["project", "site", "work package"],
    ],
  ].map(([sequence, operation, suggested_resource, evidence]) => ({
    sequence: sequence as number,
    operation: operation as string,
    suggested_resource: suggested_resource as string,
    evidence: evidence as string[],
  })),
  quality_templates: [
    {
      stage: "INCOMING",
      characteristics: [
        "sheet thickness",
        "grade",
        "dimensions",
        "surface",
        "material specification",
      ],
    },
    {
      stage: "IN_PROCESS",
      characteristics: [
        "dimensions",
        "diagonal",
        "joint",
        "flange alignment",
        "reinforcement",
        "insulation",
        "sealing",
      ],
    },
    {
      stage: "FINAL",
      characteristics: [
        "drawing compliance",
        "dimensions",
        "flange",
        "insulation",
        "finish",
        "identification",
        "quantity",
      ],
    },
  ],
  cost_elements: [
    "material",
    "labour",
    "machine",
    "outside processing",
    "overhead",
    "scrap",
    "rework",
    "recoverable scrap value",
    "packing",
    "delivery",
  ],
  demo_baseline: {
    label: "DEMO BENCHMARK - RECTANGULAR GI DUCT",
    disclaimer:
      "Illustrative demo data only. Validate sheet gauge and reinforcement against the licensed SMACNA table and approved project pressure class; replace rates and times after a client factory time study.",
    reference_profile: {
      product: "Rectangular GI duct",
      width_mm: 600,
      height_mm: 400,
      length_mm: 1200,
      nominal_thickness_mm: 0.8,
      pressure_class_pa: 500,
      material: "Lock-forming galvanized steel to approved ASTM A653/A653M project specification",
      density_kg_m3: 7850,
      flange: "TDF/TDC",
      fabrication_allowance_pct: 8,
      standard_sheet_width_mm: 1220,
      standard_sheet_length_mm: 2440,
    },
    calculated_example: {
      developed_area_net_m2: 2.4,
      developed_area_with_allowance_m2: 2.592,
      metal_weight_net_kg: 15.072,
      metal_weight_with_allowance_kg: 16.278,
      joint_perimeter_m: 2,
      note: "Allowance is a demo benchmark, not an industry-mandated percentage.",
    },
    operation_benchmarks: [
      { sequence: 10, enabled: true, setup_time_minutes: 15, cycle_time_minutes: 4, note: "CNC/shearing demo time" },
      { sequence: 20, enabled: true, setup_time_minutes: 10, cycle_time_minutes: 2, note: "Beading demo time" },
      { sequence: 30, enabled: true, setup_time_minutes: 10, cycle_time_minutes: 3, note: "Pittsburgh lock demo time" },
      { sequence: 40, enabled: true, setup_time_minutes: 15, cycle_time_minutes: 4, note: "TDF/TDC forming demo time" },
      { sequence: 50, enabled: true, setup_time_minutes: 5, cycle_time_minutes: 4, note: "Corner and cleat fitting demo time" },
      { sequence: 60, enabled: false, setup_time_minutes: 0, cycle_time_minutes: 0, note: "Not used in demo; select only when approved construction table requires reinforcement" },
      { sequence: 70, enabled: false, setup_time_minutes: 0, cycle_time_minutes: 0, note: "Uninsulated demo product" },
      { sequence: 80, enabled: true, setup_time_minutes: 5, cycle_time_minutes: 3, note: "Sealant and gasket demo time" },
      { sequence: 90, enabled: true, setup_time_minutes: 5, cycle_time_minutes: 6, note: "Assembly demo time" },
      { sequence: 100, enabled: true, setup_time_minutes: 0, cycle_time_minutes: 5, note: "Final inspection demo time" },
      { sequence: 110, enabled: true, setup_time_minutes: 3, cycle_time_minutes: 4, note: "Packing demo time" },
      { sequence: 120, enabled: true, setup_time_minutes: 0, cycle_time_minutes: 2, note: "Dispatch staging demo time" },
    ],
    quality_specifications: {
      INCOMING: {
        "sheet thickness": "0.80 mm nominal; tolerance per approved mill certificate/project specification",
        grade: "ASTM A653/A653M galvanized lock-forming steel; verify MTC/COC",
        dimensions: "1220 x 2440 mm reference stock sheet; verify purchase specification",
        surface: "No red rust, oil contamination, dents or coating damage - visual PASS/FAIL",
        "material specification": "Approved grade and coating designation match PO and project submittal",
      },
      IN_PROCESS: {
        dimensions: "600 x 400 x 1200 mm demo drawing; shop tolerance +/- 2 mm",
        diagonal: "Difference <= 3 mm - demo inspection tolerance",
        joint: "Pittsburgh lock fully formed and closed - PASS/FAIL",
        "flange alignment": "TDF/TDC flange alignment <= 2 mm - demo tolerance",
        reinforcement: "Not applicable to demo; determine from approved size/pressure construction table",
        insulation: "Not applicable - uninsulated demo product",
        sealing: "Continuous sealant/gasket with no visible gaps - PASS/FAIL",
      },
      FINAL: {
        "drawing compliance": "Approved drawing revision, duct tag and pressure class match traveller",
        dimensions: "600 x 400 x 1200 mm; verify against approved drawing",
        flange: "Square, aligned and undamaged - PASS/FAIL",
        insulation: "Not applicable - uninsulated demo product",
        finish: "Clean, burr-free and without sharp exposed edges - PASS/FAIL",
        identification: "Project, area, duct tag and drawing revision present",
        quantity: "Count equals traveller quantity",
      },
    },
    cost_benchmarks: {
      material: 8.5,
      labour: 22,
      machine: 35,
      "outside processing": 0,
      overhead: 12,
      scrap: 8,
      rework: 2,
      "recoverable scrap value": 1.5,
      packing: 4,
      delivery: 0,
    },
    cost_currency: "AED",
    mrp_parameters: {
      procurement_type: "MAKE",
      planning_method: "MRP",
      safety_stock_days: 2,
      purchase_lead_time_days: 7,
      manufacturing_lead_time_days: 1,
      minimum_order_quantity: 1,
      lot_sizing: "LOT_FOR_LOT",
    },
  },
  required_client_data: [
    "approved drawings and revisions",
    "duct and fitting scope",
    "sheet sizes and grades",
    "actual operation sequence",
    "machines and practical capacities",
    "shift calendars",
    "yield and scrap standards",
    "QC tolerances",
    "subcontract operations and rates",
    "labour, machine and overhead rates",
  ],
};

export const productionConfigurationPacks: ProductionConfigurationPack[] = [
  acDuct,
];

export function findProductionConfigurationPack(code: string) {
  return productionConfigurationPacks.find(
    (pack) =>
      pack.code ===
      String(code || "")
        .trim()
        .toUpperCase(),
  );
}

export function summarizeProductionConfigurationPack(
  pack: ProductionConfigurationPack,
) {
  return {
    code: pack.code,
    name: pack.name,
    industry: pack.industry,
    version: pack.version,
    status: pack.status,
    description: pack.description,
    source: pack.source,
    counts: {
      attributes: pack.attributes.length,
      formulas: pack.formulas.length,
      operations: pack.operation_templates.length,
      quality_stages: pack.quality_templates.length,
      cost_elements: pack.cost_elements.length,
    },
    guardrails: pack.guardrails,
  };
}
