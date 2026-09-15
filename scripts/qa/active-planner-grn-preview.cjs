const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const baseUrl = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const assert = (value, message, details) => {
  if (!value)
    throw new Error(`${message}\n${JSON.stringify(details || {}, null, 2)}`);
};
const readJson = async (response) => {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
};

async function counts(db, tenantId) {
  const tables = [
    "mizantra_governed_action_requests",
    "grns",
    "grn_items",
    "grn_invoice_locks",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => {
        const { count, error } = await db
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId);
        if (error) throw error;
        return [table, Number(count || 0)];
      }),
    ),
  );
}

(async () => {
  assert(
    /^https:\/\/mizantra\.saksolution\.com\/?$/i.test(baseUrl),
    `Refusing non-Mizantra URL: ${baseUrl}`,
  );
  const databaseHost = new URL(process.env.DATABASE_URL).hostname;
  assert(
    databaseHost === "db.nwkaruzvzwwuftjquypk.supabase.co",
    `Refusing non-Mizantra database host: ${databaseHost}`,
  );

  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const login = await readJson(loginResponse);
  assert(loginResponse.ok && login?.accessToken, "Login failed", login);
  const tenantId = String(login.user?.tenantId || login.user?.tenant_id || "");
  const userId = String(login.user?.id || login.user?.userId || "");
  assert(tenantId && userId, "Authenticated identity is incomplete", login.user);
  const authorization = `Bearer ${login.accessToken}`;
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  const { data: purchaseOrders, error: poError } = await db
    .from("purchase_orders")
    .select(
      "id,po_number,vendor_id,status,purchase_order_items(id,item_id,item_code,item_name,description,uom,ordered_qty,received_qty,rate,discount_percent,item:items(category,is_active))",
    )
    .eq("tenant_id", tenantId)
    .in("status", ["APPROVED", "PARTIAL"])
    .limit(100);
  if (poError) throw poError;
  let target;
  for (const po of purchaseOrders || []) {
    const lines = (po.purchase_order_items || []).filter((line) => {
      const item = Array.isArray(line.item) ? line.item[0] : line.item;
      return (
        item?.is_active !== false &&
        String(item?.category || "").toUpperCase() !== "SERVICES" &&
        Number(line.ordered_qty || 0) - Number(line.received_qty || 0) >= 1
      );
    });
    if (po.vendor_id && lines.length === 1) {
      target = { po, line: lines[0] };
      break;
    }
  }
  assert(target, "No approved single-line material PO with open quantity exists.");

  const { data: warehouses, error: warehouseError } = await db
    .from("warehouses")
    .select("id,code,name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .limit(20);
  if (warehouseError) throw warehouseError;
  const warehouse = (warehouses || []).find((row) => row.code);
  assert(warehouse, "No active receiving warehouse exists.");

  const before = await counts(db, tenantId);
  const originalReceived = Number(target.line.received_qty || 0);
  const form = new FormData();
  form.append(
    "file",
    new Blob(["%PDF-1.4\n% Mizantra governed GRN preview\n%%EOF\n"], {
      type: "application/pdf",
    }),
    "qa-governed-grn-invoice.pdf",
  );
  const uploadResponse = await fetch(
    `${baseUrl}/api/v1/purchase/grn/invoice/upload`,
    { method: "POST", headers: { authorization }, body: form },
  );
  const upload = await readJson(uploadResponse);
  assert(uploadResponse.ok && upload?.url, "Secured upload failed", upload);
  assert(
    String(upload.url).includes(`/${tenantId}/${userId}/`),
    "Upload is not tenant/user bound",
    upload,
  );

  const stamp = Date.now();
  const invoiceNumber = `QA-GRN-${stamp}`;
  const message = `Create GRN for 1 ${target.line.uom || "nos"} ${target.line.item_code} against ${target.po.po_number} invoice number ${invoiceNumber} invoice dated 29-08-2026 receipt date 30-08-2026 warehouse ${warehouse.code}`;
  const previewResponse = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ message, attachments: [upload] }),
  });
  const preview = await readJson(previewResponse);
  assert(previewResponse.ok, "GRN prompt preview failed", preview);
  assert(
    preview.status === "READY_TO_REQUEST_APPROVAL" &&
      preview.proposed_action?.action_code === "CREATE_GRN_DRAFT" &&
      (preview.questions || []).length === 0,
    "GRN prompt did not reach governed approval readiness",
    preview,
  );
  assert(
    preview.extracted?.invoice_date === "2026-08-29" &&
      preview.extracted?.receipt_date === "2026-08-30" &&
      preview.resolved?.purchase_order?.id === target.po.id &&
      preview.resolved?.purchase_order?.vendor_id === target.po.vendor_id &&
      preview.resolved?.purchase_order_line?.id === target.line.id &&
      preview.resolved?.item?.id === target.line.item_id &&
      preview.resolved?.warehouse?.id === warehouse.id,
    "Governed GRN context does not match authoritative master data",
    { preview, target, warehouse },
  );

  const after = await counts(db, tenantId);
  const { data: lineAfter, error: lineAfterError } = await db
    .from("purchase_order_items")
    .select("received_qty")
    .eq("id", target.line.id)
    .single();
  if (lineAfterError) throw lineAfterError;
  assert(
    JSON.stringify(before) === JSON.stringify(after) &&
      Number(lineAfter.received_qty || 0) === originalReceived,
    "Preview unexpectedly changed operational data",
    { before, after, originalReceived, lineAfter },
  );

  const report = {
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    database_host: databaseHost,
    mode: "PREVIEW_ONLY_NO_WRITES",
    target: {
      po_id: target.po.id,
      po_number: target.po.po_number,
      po_item_id: target.line.id,
      item_id: target.line.item_id,
      item_code: target.line.item_code,
      warehouse_id: warehouse.id,
      warehouse_code: warehouse.code,
    },
    preview: {
      status: preview.status,
      action_code: preview.proposed_action.action_code,
      questions: preview.questions,
      native_record_created: false,
    },
    controls: {
      secured_invoice_attachment: true,
      exact_po_line_resolution: true,
      authoritative_vendor_and_warehouse: true,
      independent_approval_required: true,
      no_approval_request_created: true,
      no_grn_or_invoice_lock_created: true,
      po_received_quantity_unchanged: true,
    },
    record_counts_before: before,
    record_counts_after: after,
  };
  const outputDir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `active-planner-grn-preview-${stamp}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
