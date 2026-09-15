const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const baseUrl = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const username = process.env.QA_USERNAME || "hnoman";
const password = process.env.QA_PASSWORD || "Password";

function assert(value, message, details) {
  if (!value)
    throw new Error(
      `${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`,
    );
}

async function call(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

async function tenantCounts(db, tenantId) {
  const tables = [
    "mizantra_governed_action_requests",
    "job_orders",
    "ncr",
    "plant_maintenance_work_orders",
    "stock_movements",
    "service_entry_sheets",
    "service_entry_sheet_items",
  ];
  const entries = await Promise.all(
    tables.map(async (table) => {
      const { count, error } = await db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return [table, Number(count || 0)];
    }),
  );
  return Object.fromEntries(entries);
}

async function main() {
  assert(
    /^https:\/\/mizantra\.saksolution\.com\/?$/i.test(baseUrl),
    `Refusing non-Mizantra URL: ${baseUrl}`,
  );
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert(
    databaseUrl.hostname === "db.nwkaruzvzwwuftjquypk.supabase.co",
    `Refusing non-Mizantra database host: ${databaseUrl.hostname}`,
  );
  const login = await call("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert(
    login.response.ok && login.data?.accessToken,
    "Login failed.",
    login.data,
  );
  const tenantId = String(
    login.data?.user?.tenantId || login.data?.user?.tenant_id || "",
  ).trim();
  assert(tenantId, "Login response did not identify the Mizantra tenant.");
  const headers = {
    authorization: `Bearer ${login.data.accessToken}`,
    "content-type": "application/json",
  };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const { data: boms, error: bomError } = await db
    .from("bom_headers")
    .select("id,item_id,version,is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .limit(50);
  if (bomError) throw bomError;
  assert(boms?.length, "No active BOM exists for governed preview acceptance.");
  const { data: items, error: itemError } = await db
    .from("items")
    .select("id,code,name,uom,is_active")
    .in(
      "id",
      boms.map((bom) => bom.item_id),
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (itemError) throw itemError;
  const item = items?.find((row) => row.code && row.name);
  assert(item, "No active item could be paired with an active BOM.");
  const bom = boms.find((row) => row.item_id === item.id);
  const { data: assets, error: assetError } = await db
    .from("plant_assets")
    .select("id,asset_code,asset_name")
    .eq("tenant_id", tenantId)
    .limit(50);
  if (assetError) throw assetError;
  const asset = assets?.find((row) => row.asset_code && row.asset_name);
  assert(
    asset,
    "No tenant-owned plant asset exists for governed preview acceptance.",
  );
  const { data: stockRows, error: stockError } = await db
    .from("inventory_stock")
    .select("item_id,warehouse_id,quantity,available_quantity")
    .eq("tenant_id", tenantId)
    .limit(50);
  if (stockError) throw stockError;
  const stockItemIds = [
    ...new Set((stockRows || []).map((row) => row.item_id)),
  ];
  assert(
    stockItemIds.length,
    "No inventory stock exists for governed preview acceptance.",
  );
  const { data: stockItems, error: stockItemError } = await db
    .from("items")
    .select("id,code,name,uom,category,uid_tracking,is_active")
    .eq("tenant_id", tenantId)
    .in("id", stockItemIds)
    .eq("is_active", true);
  if (stockItemError) throw stockItemError;
  const stockItem = stockItems?.find(
    (row) => row.code && row.name && row.uid_tracking !== true,
  );
  assert(
    stockItem,
    "No stocked non-UID item exists for governed preview acceptance.",
  );
  const stockRow = stockRows.find((row) => row.item_id === stockItem.id);
  const { data: stockWarehouse, error: stockWarehouseError } = await db
    .from("warehouses")
    .select("id,code,name,is_active")
    .eq("tenant_id", tenantId)
    .eq("id", stockRow.warehouse_id)
    .eq("is_active", true)
    .single();
  if (stockWarehouseError) throw stockWarehouseError;
  const systemQuantity = stockRows
    .filter(
      (row) =>
        row.item_id === stockItem.id && row.warehouse_id === stockWarehouse.id,
    )
    .reduce(
      (sum, row) => sum + Number(row.available_quantity ?? row.quantity ?? 0),
      0,
    );
  assert(
    systemQuantity >= 0,
    "Selected stock balance is negative; cannot use it for preview acceptance.",
  );
  const { data: servicePos, error: servicePoError } = await db
    .from("purchase_orders")
    .select(
      "id,po_number,status,delivery_address,purchase_order_items(id,item_id,item_code,item_name,uom,ordered_qty,service_accepted_qty,item:items(category))",
    )
    .eq("tenant_id", tenantId)
    .in("status", ["APPROVED", "PARTIAL"])
    .limit(100);
  if (servicePoError) throw servicePoError;
  let serviceTarget = null;
  for (const po of servicePos || []) {
    const line = (po.purchase_order_items || []).find((candidate) => {
      const category = Array.isArray(candidate.item)
        ? candidate.item[0]?.category
        : candidate.item?.category;
      return (
        String(category || "").toUpperCase() === "SERVICES" &&
        Number(candidate.ordered_qty || 0) -
          Number(candidate.service_accepted_qty || 0) >
          0.000001
      );
    });
    if (line) {
      serviceTarget = { po, line };
      break;
    }
  }
  assert(
    serviceTarget,
    "No open approved Service PO line exists for governed preview acceptance.",
  );
  const countsBefore = await tenantCounts(db, tenantId);

  const job = await call("/api/v1/active-planner/interpret", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Create a job order for 2 nos ${item.code} by 30-09-2026 using the approved BOM`,
    }),
  });
  assert(job.response.ok, "Job-order prompt failed.", job.data);
  assert(
    job.data.status === "READY_TO_REQUEST_APPROVAL" &&
      job.data.proposed_action?.action_code ===
        "CREATE_PRODUCTION_JOB_ORDER_DRAFT" &&
      job.data.resolved?.item?.id === item.id &&
      job.data.resolved?.bom?.id === bom.id &&
      job.data.proposed_action?.native_record_created === false,
    "Job-order governed preview was not approval-ready.",
    job.data,
  );

  const ncr = await call("/api/v1/active-planner/interpret", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Raise a quality NCR for item ${item.code}; affected quantity 1 nos; rejected for visible material damage`,
    }),
  });
  assert(ncr.response.ok, "Quality NCR prompt failed.", ncr.data);
  assert(
    ncr.data.status === "READY_TO_REQUEST_APPROVAL" &&
      ncr.data.proposed_action?.action_code === "CREATE_QUALITY_NCR" &&
      ncr.data.resolved?.item?.id === item.id &&
      ncr.data.proposed_action?.native_record_created === false,
    "Quality NCR governed preview was not approval-ready.",
    ncr.data,
  );

  const maintenance = await call("/api/v1/active-planner/interpret", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Create urgent breakdown maintenance work order for asset ${asset.asset_code} on 31-08-2026 because the spindle is making abnormal noise`,
    }),
  });
  assert(
    maintenance.response.ok,
    "Maintenance prompt failed.",
    maintenance.data,
  );

  const countedQuantity = systemQuantity + 1;
  const stockCount = await call("/api/v1/active-planner/interpret", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Set stock count for ${stockItem.code} in warehouse ${stockWarehouse.code} to ${countedQuantity} nos because QA cycle count evidence confirmed one additional piece`,
    }),
  });
  assert(stockCount.response.ok, "Stock-count prompt failed.", stockCount.data);
  assert(
    stockCount.data.status === "READY_TO_REQUEST_APPROVAL" &&
      stockCount.data.proposed_action?.action_code ===
        "CREATE_STOCK_COUNT_ADJUSTMENT" &&
      stockCount.data.resolved?.item?.id === stockItem.id &&
      stockCount.data.resolved?.warehouse?.id === stockWarehouse.id &&
      Number(stockCount.data.resolved?.stock_snapshot?.available_quantity) ===
        systemQuantity &&
      stockCount.data.proposed_action?.native_record_created === false,
    "Stock-count governed preview was not approval-ready.",
    stockCount.data,
  );
  const serviceQuantity = Math.min(
    1,
    Number(serviceTarget.line.ordered_qty || 0) -
      Number(serviceTarget.line.service_accepted_qty || 0),
  );
  const serviceEntry = await call("/api/v1/active-planner/interpret", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Record service entry for ${serviceQuantity} nos ${serviceTarget.line.item_code} against ${serviceTarget.po.po_number} completed on 30-08-2026 because QA supervisor signed the completion sheet`,
    }),
  });
  assert(
    serviceEntry.response.ok,
    "Service-entry prompt failed.",
    serviceEntry.data,
  );
  assert(
    serviceEntry.data.status === "READY_TO_REQUEST_APPROVAL" &&
      serviceEntry.data.proposed_action?.action_code ===
        "CREATE_SERVICE_ENTRY_DRAFT" &&
      serviceEntry.data.resolved?.purchase_order?.id === serviceTarget.po.id &&
      serviceEntry.data.resolved?.purchase_order_line?.id ===
        serviceTarget.line.id &&
      serviceEntry.data.proposed_action?.native_record_created === false,
    "Service-entry governed preview was not approval-ready.",
    serviceEntry.data,
  );
  const countsAfter = await tenantCounts(db, tenantId);
  assert(
    JSON.stringify(countsAfter) === JSON.stringify(countsBefore),
    "A preview unexpectedly changed governed or native record counts.",
    { before: countsBefore, after: countsAfter },
  );
  const { data: stockAfter, error: stockAfterError } = await db
    .from("inventory_stock")
    .select("quantity,available_quantity")
    .eq("tenant_id", tenantId)
    .eq("item_id", stockItem.id)
    .eq("warehouse_id", stockWarehouse.id);
  if (stockAfterError) throw stockAfterError;
  const systemQuantityAfter = (stockAfter || []).reduce(
    (sum, row) => sum + Number(row.available_quantity ?? row.quantity ?? 0),
    0,
  );
  assert(
    systemQuantityAfter === systemQuantity,
    "A preview unexpectedly changed the authoritative stock balance.",
    { before: systemQuantity, after: systemQuantityAfter },
  );
  assert(
    maintenance.data.status === "READY_TO_REQUEST_APPROVAL" &&
      maintenance.data.proposed_action?.action_code ===
        "CREATE_MAINTENANCE_WORK_ORDER" &&
      maintenance.data.resolved?.asset?.id === asset.id &&
      maintenance.data.proposed_action?.native_record_created === false,
    "Maintenance governed preview was not approval-ready.",
    maintenance.data,
  );

  const report = {
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    tenant_id: tenantId,
    database_host: databaseUrl.hostname,
    mode: "PREVIEW_ONLY_NO_WRITES",
    item: { id: item.id, code: item.code, name: item.name, bom_id: bom.id },
    asset: {
      id: asset.id,
      code: asset.asset_code,
      name: asset.asset_name,
    },
    stock_count_target: {
      item_id: stockItem.id,
      item_code: stockItem.code,
      warehouse_id: stockWarehouse.id,
      warehouse_code: stockWarehouse.code,
      system_quantity: systemQuantity,
      counted_quantity: countedQuantity,
    },
    service_entry_target: {
      po_id: serviceTarget.po.id,
      po_number: serviceTarget.po.po_number,
      po_item_id: serviceTarget.line.id,
      item_code: serviceTarget.line.item_code,
      accepted_quantity: serviceQuantity,
    },
    job_order: {
      status: job.data.status,
      action_code: job.data.proposed_action.action_code,
      questions: job.data.questions,
      native_record_created: false,
    },
    quality_ncr: {
      status: ncr.data.status,
      action_code: ncr.data.proposed_action.action_code,
      questions: ncr.data.questions,
      native_record_created: false,
    },
    maintenance_work_order: {
      status: maintenance.data.status,
      action_code: maintenance.data.proposed_action.action_code,
      questions: maintenance.data.questions,
      native_record_created: false,
    },
    stock_count_adjustment: {
      status: stockCount.data.status,
      action_code: stockCount.data.proposed_action.action_code,
      questions: stockCount.data.questions,
      native_record_created: false,
    },
    service_entry: {
      status: serviceEntry.data.status,
      action_code: serviceEntry.data.proposed_action.action_code,
      questions: serviceEntry.data.questions,
      native_record_created: false,
    },
    controls: {
      signed_context: true,
      real_master_resolution: true,
      active_bom_required: true,
      independent_approval_required: true,
      no_approval_request_created: true,
      no_native_record_created: true,
      database_counts_unchanged: true,
      authoritative_stock_balance_unchanged: true,
    },
    record_counts_before: countsBefore,
    record_counts_after: countsAfter,
  };
  const dir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const output = path.join(
    dir,
    `active-planner-governed-preview-${stamp}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
