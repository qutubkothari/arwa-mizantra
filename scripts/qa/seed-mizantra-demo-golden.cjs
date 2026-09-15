const fs = require("fs");
const path = require("path");

const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const EXPECTED_DB = "nwkaruzvzwwuftjquypk.supabase.co";
const TAG = "[MIZANTRA-DEMO-GOLDEN-V1]";
const PLAN_CODE = "DEMO-DRONE-FINAL";
const PROGRAM_CODE = "DEMO-SO-PLANNER-001";
const STOCK_REFERENCE = "MIZ-DEMO-STOCK-001";
const UID_STOCK_REFERENCE = "MIZ-DEMO-UID-REGISTER-001";
const BATCH_NUMBER = "MIZ-DEMO-BATCH-001";

function assert(value, message, details) {
  if (!value) {
    throw new Error(
      `${message}${details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`}`,
    );
  }
}

function loadEnv() {
  for (const file of [
    path.join(process.cwd(), "apps/api/.env.test"),
    path.join(process.cwd(), "apps/api/.env"),
  ]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs
      .readFileSync(file, "utf8")
      .replace(/\r/g, "")
      .split("\n")) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

async function readJson(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    return body;
  }
}

async function login(username) {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const data = await readJson(response);
  assert(
    response.ok && data?.accessToken,
    `Login failed for ${username}.`,
    data,
  );
  return data;
}

async function api(token, method, endpoint, body, allowed = [200, 201]) {
  const response = await fetch(`${BASE}/api/v1${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(response);
  assert(
    allowed.includes(response.status),
    `${method} ${endpoint} returned ${response.status}.`,
    data,
  );
  return data;
}

async function dbRows(table, params) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  const response = await fetch(`${base}/rest/v1/${table}?${params}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const data = await readJson(response);
  assert(response.ok && Array.isArray(data), `Unable to read ${table}.`, data);
  return data;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "items", "results", "records"])
    if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function main() {
  loadEnv();
  assert(
    /^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE),
    `Refusing non-Mizantra URL: ${BASE}`,
  );
  const dbUrl = new URL(process.env.SUPABASE_URL || "");
  assert(
    dbUrl.hostname === EXPECTED_DB,
    `Refusing non-Mizantra database: ${dbUrl.hostname}`,
  );
  assert(
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY,
    "Mizantra database key is unavailable.",
  );

  const [maker, checker, mdgMaker, mdgReviewer, mdgApprover, mdgPoster] =
    await Promise.all([
      login(process.env.QA_USERNAME || "hnoman"),
      login(process.env.QA_CHECKER_USERNAME || "qa_roi_finance"),
      login("qa_roi_maker"),
      login("qa_roi_checker"),
      login("qa_roi_finance"),
      login("qa_roi_poster"),
    ]);
  const makerToken = maker.accessToken;
  const checkerToken = checker.accessToken;
  const mdgTokens = {
    maker: mdgMaker.accessToken,
    reviewer: mdgReviewer.accessToken,
    approver: mdgApprover.accessToken,
    poster: mdgPoster.accessToken,
  };
  const tenantId = maker.user?.tenantId || maker.user?.tenant_id;
  assert(tenantId, "Authenticated Mizantra tenant is unavailable.");
  assert(
    String(checker.user?.tenantId || checker.user?.tenant_id) ===
      String(tenantId),
    "Maker and checker are not in the same Mizantra tenant.",
  );

  const [programs, itemsResponse, customersResponse, warehousesResponse] =
    await Promise.all([
      dbRows(
        "production_programs",
        `select=id,program_code,finished_item_id,status,created_at&tenant_id=eq.${tenantId}&program_code=like.QA-APS-*&order=created_at.desc&limit=20`,
      ),
      api(makerToken, "GET", "/items?limit=2000"),
      api(makerToken, "GET", "/sales/customers"),
      api(makerToken, "GET", "/inventory/warehouses"),
    ]);
  const sourceProgram = programs.find((program) => program.finished_item_id);
  const allItems = rows(itemsResponse);
  let item = allItems.find(
    (candidate) =>
      String(candidate.id) === String(sourceProgram?.finished_item_id),
  );
  const customer = rows(customersResponse).find(
    (candidate) => candidate.id && candidate.is_active !== false,
  );
  const warehouse = rows(warehousesResponse).find(
    (candidate) => candidate.id && candidate.is_active !== false,
  );
  assert(
    sourceProgram && item,
    "No mature QA production product is available.",
  );
  assert(customer, "No active customer is available for the demo order.");
  assert(warehouse, "No active warehouse is available for the demo flow.");

  const created = [];
  const reused = [];

  let plans = await api(makerToken, "GET", "/quality/plans");
  let inspectionPlan = rows(plans).find((plan) => plan.plan_code === PLAN_CODE);
  if (!inspectionPlan) {
    inspectionPlan = await api(makerToken, "POST", "/quality/plans", {
      plan_code: PLAN_CODE,
      plan_name: "Mizantra Demo Drone Final Inspection",
      inspection_type: "FINAL",
      item_id: item.id,
      revision: 1,
      effective_from: isoDate(0),
      effective_to: null,
      sampling_method: "FIXED",
      sample_size: 5,
      parameters: [
        {
          parameter_name: "Visual workmanship",
          data_type: "PASS_FAIL",
          specification:
            "No visible damage, loose fasteners or exposed wiring (DEMO)",
          criticality: "MAJOR",
          is_mandatory: true,
        },
        {
          parameter_name: "Finished unit mass",
          data_type: "NUMERIC",
          specification: "Finished demo unit mass between 1.80 and 2.20 kg",
          unit_of_measure: "KG",
          tolerance_min: 1.8,
          tolerance_max: 2.2,
          criticality: "MAJOR",
          is_mandatory: true,
        },
        {
          parameter_name: "Power-on functional test",
          data_type: "PASS_FAIL",
          specification:
            "Controller, motors and safety interlock pass demo functional test",
          criticality: "CRITICAL",
          is_mandatory: true,
        },
      ],
    });
    created.push("inspection_plan_draft");
  } else {
    reused.push("inspection_plan");
  }
  if (inspectionPlan.status === "DRAFT") {
    inspectionPlan = await api(
      checkerToken,
      "POST",
      `/quality/plans/${inspectionPlan.id}/approve`,
      {
        approval_note:
          "Approved for the isolated Mizantra client-demo scenario only; synthetic limits are clearly labelled DEMO.",
      },
    );
    created.push("inspection_plan_approval");
  }
  assert(
    inspectionPlan.status === "APPROVED",
    "Demo inspection plan is not approved.",
  );

  const existingInspections = await dbRows(
    "quality_inspections",
    `select=id,inspection_number,status,batch_number&tenant_id=eq.${tenantId}&batch_number=eq.${BATCH_NUMBER}&limit=1`,
  );
  let inspection = existingInspections[0];
  if (!inspection) {
    inspection = await api(makerToken, "POST", "/quality/inspections", {
      inspection_type: "FINAL",
      inspection_date: isoDate(0),
      inspection_plan_id: inspectionPlan.id,
      item_id: item.id,
      item_name: item.name,
      item_code: item.code,
      batch_number: BATCH_NUMBER,
      lot_number: BATCH_NUMBER,
      inspected_quantity: 10,
      inspector_name: "Mizantra Demo Quality Inspector",
      inspection_checklist: { demo: true, source: TAG },
    });
    const detail = await api(
      makerToken,
      "GET",
      `/quality/inspections/${inspection.id}`,
    );
    const parameterResults = rows(detail.parameters).map((parameter) => ({
      id: parameter.id,
      measured_value:
        String(
          parameter.data_type || parameter.parameter_type,
        ).toUpperCase() === "NUMERIC"
          ? "2.00"
          : "PASS",
      result: "PASS",
      remarks: `${TAG} synthetic passing evidence`,
    }));
    inspection = await api(
      makerToken,
      "POST",
      `/quality/inspections/${inspection.id}/complete`,
      {
        inspection_status: "PASSED",
        quantity_accepted: 10,
        quantity_rejected: 0,
        quantity_on_hold: 0,
        inspector_remarks: `${TAG} final inspection passed for client demonstration`,
        parameter_results: parameterResults,
      },
    );
    created.push("completed_quality_inspection");
  } else {
    reused.push("completed_quality_inspection");
  }

  const stockMovements = await dbRows(
    "stock_movements",
    `select=id,movement_number,reference_number&tenant_id=eq.${tenantId}&reference_number=eq.${STOCK_REFERENCE}&limit=1`,
  );
  let stockMovement = stockMovements[0];
  if (!stockMovement) {
    stockMovement = await api(makerToken, "POST", "/inventory/movements", {
      movement_type: "ADJUSTMENT",
      item_id: item.id,
      to_warehouse_id: warehouse.id,
      quantity: 10,
      reference_type: "MIZANTRA_DEMO_OPENING_STOCK",
      reference_number: STOCK_REFERENCE,
      category: item.category || "FINISHED_GOOD",
      notes: `${TAG} isolated demo opening stock`,
      movement_date: `${isoDate(0)}T00:00:00.000Z`,
    });
    created.push("demo_finished_stock");
  } else {
    reused.push("demo_finished_stock");
  }

  // The mature QA fixture predates mandatory serial-controlled PGI. Register
  // serial identities against its existing isolated stock without changing
  // quantity (the released demo order may already hold an ATP reservation).
  if (
    item.uid_tracking !== true ||
    String(item.uid_strategy || "NONE").toUpperCase() !== "SERIALIZED"
  ) {
    const mdgIdempotencyKey = `mizantra-demo-serialized-${item.id}`;
    const existingRequests = await dbRows(
      "master_data_change_requests",
      `select=id,status,target_id,idempotency_key&tenant_id=eq.${tenantId}&idempotency_key=eq.${mdgIdempotencyKey}&limit=1`,
    );
    let request = existingRequests[0];
    if (!request) {
      request = await api(
        mdgTokens.maker,
        "POST",
        "/master-data-governance/requests",
        {
          entity_type: "ITEM",
          operation: "UPDATE",
          target_id: item.id,
          idempotency_key: mdgIdempotencyKey,
          proposed_data: {
            uid_tracking: true,
            uid_strategy: "SERIALIZED",
          },
          note: `${TAG} enable governed serialized demo dispatch`,
        },
      );
      created.push("serialized_item_change_request");
    }
    if (request.status === "DRAFT") {
      request = await api(
        mdgTokens.maker,
        "PATCH",
        `/master-data-governance/requests/${request.id}/submit`,
        { note: `${TAG} submit serial-control change` },
      );
    }
    if (request.status === "SUBMITTED") {
      request = await api(
        mdgTokens.reviewer,
        "PATCH",
        `/master-data-governance/requests/${request.id}/review`,
        { note: `${TAG} reviewed against isolated demo stock` },
      );
    }
    if (request.status === "REVIEWED") {
      request = await api(
        mdgTokens.approver,
        "PATCH",
        `/master-data-governance/requests/${request.id}/approve`,
        { note: `${TAG} approved for Mizantra demo tenant` },
      );
    }
    if (request.status === "APPROVED") {
      request = await api(
        mdgTokens.poster,
        "PATCH",
        `/master-data-governance/requests/${request.id}/apply`,
        { note: `${TAG} applied with four-person control` },
      );
    }
    assert(
      request.status === "APPLIED",
      "The serialized item governance request was not applied.",
      request,
    );
    item = await api(makerToken, "GET", `/items/${item.id}`);
    created.push("serialized_demo_item_control");
  } else {
    reused.push("serialized_demo_item_control");
  }
  if (
    item.is_verified !== true ||
    String(item.approval_status || "").toUpperCase() !== "APPROVED"
  ) {
    item = await api(checkerToken, "PUT", `/items/${item.id}/verify`, {});
    created.push("serialized_demo_item_reapproval");
  } else {
    reused.push("serialized_demo_item_reapproval");
  }

  let uidRows = await dbRows(
    "uid_registry",
    `select=uid,status,quality_status,metadata&tenant_id=eq.${tenantId}&entity_id=eq.${item.id}&limit=1000`,
  );
  let persistedDemoUids = uidRows.filter(
    (row) =>
      String(row.metadata?.demo_uid_register || "") === UID_STOCK_REFERENCE,
  );
  for (
    let sequence = persistedDemoUids.length + 1;
    sequence <= 10;
    sequence++
  ) {
    await api(makerToken, "POST", "/uid", {
      plantCode: "MFG",
      entityType: "FG",
      entity_type: "FG",
      entity_id: item.id,
      item_id: item.id,
      status: "GENERATED",
      location: warehouse.name || warehouse.code,
      reference: STOCK_REFERENCE,
      description: item.name,
      metadata: {
        source: "MIZANTRA_DEMO_STOCK_RECONCILIATION",
        demo_uid_register: UID_STOCK_REFERENCE,
        stock_reference: STOCK_REFERENCE,
        sequence,
        item_code: item.code,
        warehouse_id: warehouse.id,
      },
    });
    created.push(`demo_uid_${sequence}`);
  }
  uidRows = await dbRows(
    "uid_registry",
    `select=uid,status,quality_status,metadata&tenant_id=eq.${tenantId}&entity_id=eq.${item.id}&limit=1000`,
  );
  persistedDemoUids = uidRows.filter(
    (row) =>
      String(row.metadata?.demo_uid_register || "") === UID_STOCK_REFERENCE,
  );
  const demoUids = persistedDemoUids
    .sort(
      (left, right) =>
        Number(left.metadata?.sequence || 0) -
        Number(right.metadata?.sequence || 0),
    )
    .map((row) => row.uid);
  assert(
    demoUids.length === 10,
    "The serialized demo stock does not contain exactly 10 UIDs.",
    { demoUids, persistedDemoUids },
  );
  if (created.some((entry) => entry.startsWith("demo_uid_"))) {
    created.push("uid_backed_demo_stock_registration");
  } else {
    reused.push("uid_backed_demo_stock_registration");
  }
  for (const uid of demoUids) {
    const state = uidRows.find((row) => row.uid === uid);
    if (String(state?.quality_status || "").toUpperCase() !== "PASSED") {
      await api(
        makerToken,
        "PUT",
        `/uid/${encodeURIComponent(uid)}/quality-status`,
        { quality_status: "PASSED", notes: `${TAG} demo QC release` },
      );
    }
  }

  const demoOrders = await dbRows(
    "sales_orders",
    `select=id,so_number,status,release_status,credit_status,notes&tenant_id=eq.${tenantId}&notes=like.*MIZANTRA-DEMO-GOLDEN-V1*&order=created_at.desc&limit=1`,
  );
  let order = demoOrders[0];
  if (!order) {
    order = await api(makerToken, "POST", "/sales/orders", {
      customer_id: customer.id,
      order_date: isoDate(0),
      expected_delivery_date: isoDate(30),
      currency_code: "INR",
      payment_terms: "Net 30 Days",
      delivery_terms: "Ex Works",
      notes: `${TAG} Sales-order-to-production-to-cash demonstration`,
      items: [
        {
          item_id: item.id,
          item_description: `${item.code} ${item.name} - Mizantra Demo`,
          quantity: 10,
          unit_price: 100000,
          discount_percentage: 0,
          tax_percentage: 18,
          promised_date: isoDate(30),
          notes: TAG,
        },
      ],
    });
    created.push("sales_order");
  } else {
    reused.push("sales_order");
  }
  let orderDetail = await api(makerToken, "GET", `/sales/orders/${order.id}`);
  let orderLine = rows(orderDetail.sales_order_items)[0];
  assert(orderLine?.id, "Demo sales-order line is unavailable.", orderDetail);
  if (String(orderDetail.release_status || "").toUpperCase() !== "RELEASED") {
    const availability = await api(
      makerToken,
      "GET",
      `/sales/orders/${order.id}/availability`,
    );
    assert(
      availability.status === "FULLY_CONFIRMED",
      "Demo stock did not fully confirm the sales order.",
      availability,
    );
    orderDetail = await api(
      makerToken,
      "POST",
      `/sales/orders/${order.id}/release`,
      { remarks: `${TAG} controlled demo release` },
    );
    created.push("sales_order_release");
  }

  const demoPrograms = await dbRows(
    "production_programs",
    `select=id,program_code,status,sales_order_id,sales_order_item_id&tenant_id=eq.${tenantId}&program_code=eq.${PROGRAM_CODE}&limit=1`,
  );
  let productionProgram = demoPrograms[0];
  if (!productionProgram) {
    productionProgram = await api(
      makerToken,
      "POST",
      "/production-planning/programs",
      {
        program_code: PROGRAM_CODE,
        program_name: "Mizantra Demo - Sales Order Linked Drone Plan",
        demand_source: "SALES_ORDER",
        sales_order_id: order.id,
        sales_order_item_id: orderLine.id,
        start_date: isoDate(1),
        due_date: isoDate(30),
        currency_code: "INR",
        planning_policy: "BOTTLENECK_PULL",
        default_efficiency_pct: 85,
        default_daily_minutes: 480,
        safety_pct: 2,
        waves: [
          {
            wave_name: "Pilot",
            quantity: 2,
            required_by: isoDate(10),
            priority: 90,
          },
          {
            wave_name: "Ramp",
            quantity: 3,
            required_by: isoDate(20),
            priority: 70,
          },
          {
            wave_name: "Balance",
            quantity: 5,
            required_by: isoDate(30),
            priority: 50,
          },
        ],
      },
    );
    created.push("sales_order_linked_production_program");
  } else {
    reused.push("sales_order_linked_production_program");
  }
  let programDetail = await api(
    makerToken,
    "GET",
    `/production-planning/programs/${productionProgram.id}`,
  );
  if (!programDetail.run?.id) {
    programDetail = await api(
      makerToken,
      "POST",
      `/production-planning/programs/${productionProgram.id}/run`,
      {},
    );
    created.push("production_plan_run");
  } else {
    reused.push("production_plan_run");
  }

  const demoDispatches = await dbRows(
    "dispatch_notes",
    `select=id,dn_number,status,sales_order_id,notes&tenant_id=eq.${tenantId}&notes=like.*MIZANTRA-DEMO-GOLDEN-V1*&order=created_at.desc&limit=1`,
  );
  let dispatch = demoDispatches[0];
  if (!dispatch) {
    dispatch = await api(makerToken, "POST", "/sales/dispatch", {
      sales_order_id: order.id,
      dispatch_date: isoDate(0),
      delivery_address: "Mizantra Demo Customer Site",
      transporter_name: "Mizantra Demo Logistics",
      vehicle_number: "DEMO-01",
      notes: `${TAG} partial dispatch of 5 units`,
      items: [
        {
          sales_order_item_id: orderLine.id,
          item_id: item.id,
          quantity: 5,
          uid: demoUids.slice(0, 5),
        },
      ],
    });
    created.push("pgi_dispatch");
  } else {
    reused.push("pgi_dispatch");
  }
  assert(
    dispatch.status === "PGI_POSTED",
    "Demo dispatch is not PGI posted.",
    dispatch,
  );

  const demoInvoices = await dbRows(
    "invoices",
    `select=id,invoice_number,net_amount,payment_status,billing_status,dispatch_note_id&tenant_id=eq.${tenantId}&dispatch_note_id=eq.${dispatch.id}&limit=1`,
  );
  let invoice = demoInvoices[0];
  if (!invoice) {
    invoice = await api(
      makerToken,
      "POST",
      `/sales/dispatch/${dispatch.id}/create-invoice`,
      {
        invoice_date: isoDate(0),
        due_date: isoDate(30),
        notes: `${TAG} invoice from governed PGI dispatch`,
      },
    );
    created.push("sales_invoice");
  } else {
    reused.push("sales_invoice");
  }

  const payments = await dbRows(
    "sales_invoice_payments",
    `select=id,receipt_number,amount,payment_reference&tenant_id=eq.${tenantId}&invoice_id=eq.${invoice.id}&payment_reference=eq.MIZ-DEMO-RECEIPT-001&limit=1`,
  );
  let payment = payments[0];
  if (!payment) {
    payment = await api(
      makerToken,
      "POST",
      `/sales/invoices/${invoice.id}/payments`,
      {
        amount: Number(invoice.net_amount),
        payment_method: "NEFT",
        payment_reference: "MIZ-DEMO-RECEIPT-001",
        receipt_date: isoDate(0),
        notes: `${TAG} fully allocated demo receipt`,
      },
    );
    created.push("customer_receipt");
  } else {
    reused.push("customer_receipt");
  }

  const documentFlow = await api(
    makerToken,
    "GET",
    `/sales/orders/${order.id}/document-flow`,
  );
  assert(
    rows(documentFlow.dispatches).length >= 1,
    "Demo dispatch is absent from document flow.",
  );
  assert(
    rows(documentFlow.invoices).length >= 1,
    "Demo invoice is absent from document flow.",
  );

  const manifest = {
    pass: true,
    environment: "MIZANTRA ONLY",
    database_host: dbUrl.hostname,
    tenant_id: tenantId,
    generated_at: new Date().toISOString(),
    tag: TAG,
    created,
    reused,
    master_data: {
      source_program: sourceProgram.program_code,
      item: { id: item.id, code: item.code, name: item.name },
      customer: {
        id: customer.id,
        code: customer.customer_code,
        name: customer.customer_name,
      },
      warehouse: {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
      },
      serialized_demo_uids: demoUids,
    },
    quality: {
      plan_id: inspectionPlan.id,
      plan_code: PLAN_CODE,
      plan_status: inspectionPlan.status,
      inspection_id: inspection.id,
      inspection_number: inspection.inspection_number,
      inspection_status: inspection.status,
    },
    planning: {
      program_id: productionProgram.id,
      program_code: PROGRAM_CODE,
      run_id: programDetail.run?.id,
      feasible: programDetail.run?.feasible,
      confidence_pct: programDetail.run?.delivery_confidence_pct,
      stage_count: rows(programDetail.stages).length,
      material_count: rows(programDetail.materials).length,
    },
    order_to_cash: {
      sales_order_id: order.id,
      sales_order_number: order.so_number || orderDetail.so_number,
      dispatch_id: dispatch.id,
      dispatch_number: dispatch.dn_number,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_value: Number(invoice.net_amount),
      receipt_id: payment.id,
      receipt_number: payment.receipt_number,
    },
    demo_prompts: [
      `Show the production plan for ${PROGRAM_CODE}`,
      `Inspect batch ${BATCH_NUMBER} for ${item.code}`,
      `Show document flow for ${order.so_number || orderDetail.so_number}`,
      `Show the invoice and payment for ${invoice.invoice_number}`,
    ],
  };
  const outDir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, "mizantra-demo-golden-manifest.json");
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ output, manifest }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
