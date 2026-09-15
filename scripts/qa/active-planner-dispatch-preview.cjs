const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const baseUrl = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const assert = (value, message, details) => {
  if (!value)
    throw new Error(`${message}\n${JSON.stringify(details || {}, null, 2)}`);
};
const json = async (response) => {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
};
const save = (report) => {
  const stamp = Date.now();
  const dir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `active-planner-dispatch-preview-${stamp}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
};

async function counts(db, tenantId) {
  const scopedTables = [
    "mizantra_governed_action_requests",
    "dispatch_notes",
    "stock_movements",
  ];
  const entries = await Promise.all(
    scopedTables.map(async (table) => {
      const { count, error } = await db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return [table, Number(count || 0)];
    }),
  );
  const { count: itemCount, error: itemError } = await db
    .from("dispatch_items")
    .select("id", { count: "exact", head: true });
  if (itemError) throw itemError;
  entries.push(["dispatch_items", Number(itemCount || 0)]);
  return Object.fromEntries(entries);
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
  const login = await json(loginResponse);
  assert(loginResponse.ok && login?.accessToken, "Login failed", login);
  const tenantId = String(login.user?.tenantId || login.user?.tenant_id || "");
  assert(tenantId, "Authenticated tenant is missing", login.user);
  const authorization = `Bearer ${login.accessToken}`;
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { data: orders, error: orderError } = await db
    .from("sales_orders")
    .select(
      "id,so_number,status,release_status,credit_status,delivery_block,block_reason,customer_id,customer:customers(delivery_blocked,shipping_address),items:sales_order_items(id,item_id,item_description,quantity,dispatched_quantity)",
    )
    .eq("tenant_id", tenantId)
    .limit(200);
  if (orderError) throw orderError;
  const { data: uids, error: uidError } = await db
    .from("uid_registry")
    .select("uid,status,quality_status,entity_id")
    .eq("tenant_id", tenantId)
    .eq("status", "IN_STOCK")
    .eq("quality_status", "PASSED")
    .limit(1000);
  if (uidError) throw uidError;
  const uidByItem = new Map();
  for (const row of uids || []) {
    const list = uidByItem.get(row.entity_id) || [];
    list.push(row);
    uidByItem.set(row.entity_id, list);
  }
  let target = null;
  for (const order of orders || []) {
    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
    if (
      order.release_status !== "RELEASED" ||
      String(order.credit_status || "CLEAR") !== "CLEAR" ||
      order.delivery_block ||
      customer?.delivery_blocked ||
      ["CANCELLED", "COMPLETED", "DELIVERED"].includes(order.status)
    )
      continue;
    const line = (order.items || []).find(
      (row) =>
        Number(row.quantity || 0) - Number(row.dispatched_quantity || 0) >= 1 &&
        uidByItem.get(row.item_id)?.length,
    );
    if (line) {
      target = { order, line, uid: uidByItem.get(line.item_id)[0], customer };
      break;
    }
  }

  const before = await counts(db, tenantId);
  if (!target) {
    const order = (orders || []).find((row) => row.so_number && row.items?.[0]);
    assert(order, "No Sales Order exists for negative dispatch preview.");
    const line = order.items[0];
    const message = `Dispatch 1 nos ${line.item_description} against ${order.so_number} dispatch date ${today} delivery address QA preview customer dock`;
    const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const preview = await json(response);
    assert(response.ok, "Negative dispatch preview failed", preview);
    assert(
      preview.status === "NEEDS_INFORMATION" &&
        !preview.proposed_action &&
        (preview.questions || []).some((question) =>
          /exact comma-separated UIDs/i.test(question),
        ),
      "Planner did not block dispatch without exact UIDs",
      preview,
    );
    const after = await counts(db, tenantId);
    assert(JSON.stringify(before) === JSON.stringify(after), "Blocked preview wrote data", {
      before,
      after,
    });
    save({
      pass: true,
      environment: "MIZANTRA TEST ONLY",
      database_host: databaseHost,
      mode: "NEGATIVE_PREVIEW_NO_DISPATCHABLE_UID_CHAIN_NO_WRITES",
      preview: {
        status: preview.status,
        proposed_action: preview.proposed_action,
        questions: preview.questions,
      },
      controls: {
        exact_uid_selection_required: true,
        uid_selection_not_automatic: true,
        no_governed_request_created: true,
        no_dispatch_stock_or_uid_write: true,
      },
      record_counts_before: before,
      record_counts_after: after,
    });
    return;
  }

  const { data: item, error: itemError } = await db
    .from("items")
    .select("id,code,name,uom")
    .eq("tenant_id", tenantId)
    .eq("id", target.line.item_id)
    .single();
  if (itemError) throw itemError;
  const address = target.customer?.shipping_address || "QA preview customer dock";
  const message = `Dispatch 1 ${item.uom || "nos"} ${item.code} against ${target.order.so_number} UIDs ${target.uid.uid} dispatch date ${today} delivery address ${address}`;
  const lineBefore = Number(target.line.dispatched_quantity || 0);
  const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const preview = await json(response);
  assert(response.ok, "Dispatch prompt preview failed", preview);
  assert(
    preview.status === "READY_TO_REQUEST_APPROVAL" &&
      preview.proposed_action?.action_code === "POST_SALES_DISPATCH" &&
      (preview.questions || []).length === 0,
    "Dispatch did not reach governed approval readiness",
    preview,
  );
  assert(
    preview.resolved?.sales_order?.id === target.order.id &&
      preview.resolved?.sales_order_line?.id === target.line.id &&
      preview.resolved?.item?.id === item.id &&
      preview.resolved?.dispatch_uids?.[0]?.uid === target.uid.uid,
    "Dispatch context does not match the authoritative SO/UID chain",
    { preview, target, item },
  );
  const after = await counts(db, tenantId);
  const [{ data: lineAfter }, { data: uidAfter }] = await Promise.all([
    db
      .from("sales_order_items")
      .select("dispatched_quantity")
      .eq("id", target.line.id)
      .single(),
    db
      .from("uid_registry")
      .select("status,quality_status")
      .eq("tenant_id", tenantId)
      .eq("uid", target.uid.uid)
      .single(),
  ]);
  assert(
    JSON.stringify(before) === JSON.stringify(after) &&
      Number(lineAfter.dispatched_quantity || 0) === lineBefore &&
      uidAfter.status === "IN_STOCK" &&
      uidAfter.quality_status === "PASSED",
    "Preview unexpectedly changed dispatch, stock, SO or UID data",
    { before, after, lineBefore, lineAfter, uidAfter },
  );
  save({
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    database_host: databaseHost,
    mode: "PREVIEW_ONLY_NO_WRITES",
    target: {
      sales_order_id: target.order.id,
      so_number: target.order.so_number,
      sales_order_item_id: target.line.id,
      item_id: item.id,
      item_code: item.code,
      uid: target.uid.uid,
    },
    preview: {
      status: preview.status,
      action_code: preview.proposed_action.action_code,
      questions: preview.questions,
      native_record_created: false,
    },
    controls: {
      released_clear_unblocked_order: true,
      exact_saleable_uid: true,
      independent_approval_required: true,
      no_approval_request_created: true,
      no_dispatch_stock_so_or_uid_write: true,
    },
    record_counts_before: before,
    record_counts_after: after,
  });
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
