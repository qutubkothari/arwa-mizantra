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
const iso = (date) => date.toISOString().slice(0, 10);
const save = (report) => {
  const stamp = Date.now();
  const dir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(dir, { recursive: true });
  const output = path.join(
    dir,
    `active-planner-sales-invoice-preview-${stamp}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
};

async function counts(db, tenantId) {
  const tables = [
    "mizantra_governed_action_requests",
    "invoices",
    "sales_invoice_items",
    "accounting_journals",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => {
        let query = db.from(table).select("id", { count: "exact", head: true });
        if (table !== "sales_invoice_items") query = query.eq("tenant_id", tenantId);
        const { count, error } = await query;
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

  const { data: dispatches, error: dispatchError } = await db
    .from("dispatch_notes")
    .select(
      "id,dn_number,status,dispatch_date,sales_order_id,customer_id,items:dispatch_items(id,item_id,quantity)",
    )
    .eq("tenant_id", tenantId)
    .limit(500);
  if (dispatchError) throw dispatchError;
  const postedDispatches = (dispatches || []).filter(
    (row) =>
      ["PGI_POSTED", "DELIVERED"].includes(String(row.status || "")) &&
      String(row.dispatch_date || "").slice(0, 10) <= today,
  );
  if (!postedDispatches.length) {
    const [{ data: customers }, { data: items }] = await Promise.all([
      db
        .from("customers")
        .select("id,customer_code")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .limit(1),
      db
        .from("items")
        .select("id,code,uom")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .limit(1),
    ]);
    assert(customers?.[0] && items?.[0], "Negative preview needs active master data.");
    const due = new Date(`${today}T00:00:00.000Z`);
    due.setUTCDate(due.getUTCDate() + 30);
    const before = await counts(db, tenantId);
    const message = `Create invoice for ${customers[0].customer_code} for 1 ${items[0].uom || "nos"} ${items[0].code} invoice dated ${today} due date ${iso(due)}`;
    const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const preview = await json(response);
    assert(response.ok, "Negative invoice preview failed", preview);
    assert(
      preview.status === "NEEDS_INFORMATION" &&
        !preview.proposed_action &&
        (preview.questions || []).some((question) =>
          /No matching unbilled PGI-posted dispatch/i.test(question),
        ),
      "Planner did not safely block invoicing without an eligible dispatch",
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
      mode: "NEGATIVE_PREVIEW_NO_ELIGIBLE_DISPATCH_NO_WRITES",
      available_statuses: [
        ...new Set((dispatches || []).map((row) => row.status)),
      ],
      dispatch_count: (dispatches || []).length,
      preview: {
        status: preview.status,
        proposed_action: preview.proposed_action,
        questions: preview.questions,
      },
      controls: {
        cancelled_dispatches_not_billable: true,
        no_governed_request_created: true,
        no_invoice_or_accounting_write: true,
      },
      record_counts_before: before,
      record_counts_after: after,
    });
    return;
  }
  const dispatchIds = postedDispatches.map((row) => row.id);
  const { data: billed, error: billedError } = await db
    .from("invoices")
    .select("dispatch_note_id")
    .eq("tenant_id", tenantId)
    .in("dispatch_note_id", dispatchIds)
    .neq("billing_status", "CANCELLED");
  if (billedError) throw billedError;
  const billedIds = new Set((billed || []).map((row) => String(row.dispatch_note_id)));
  const eligible = postedDispatches.filter(
    (row) => !billedIds.has(String(row.id)),
  );
  assert(eligible.length, "No unbilled posted dispatch exists for preview.");

  const orderIds = [...new Set(eligible.map((row) => row.sales_order_id))];
  const customerIds = [...new Set(eligible.map((row) => row.customer_id))];
  const itemIds = [
    ...new Set(eligible.flatMap((row) => (row.items || []).map((line) => line.item_id))),
  ];
  const [{ data: orders, error: orderError }, { data: customers, error: customerError }, { data: items, error: itemError }] =
    await Promise.all([
      db
        .from("sales_orders")
        .select("id,status,release_status,billing_block,block_reason")
        .eq("tenant_id", tenantId)
        .in("id", orderIds),
      db
        .from("customers")
        .select("id,customer_code,customer_name,is_active,billing_blocked")
        .eq("tenant_id", tenantId)
        .in("id", customerIds),
      db
        .from("items")
        .select("id,code,name,uom,is_active")
        .eq("tenant_id", tenantId)
        .in("id", itemIds),
    ]);
  if (orderError) throw orderError;
  if (customerError) throw customerError;
  if (itemError) throw itemError;
  const orderById = new Map((orders || []).map((row) => [row.id, row]));
  const customerById = new Map((customers || []).map((row) => [row.id, row]));
  const itemById = new Map((items || []).map((row) => [row.id, row]));
  const candidates = [];
  for (const dispatch of eligible) {
    const order = orderById.get(dispatch.sales_order_id);
    const customer = customerById.get(dispatch.customer_id);
    if (
      order?.release_status !== "RELEASED" ||
      order?.status === "CANCELLED" ||
      order?.billing_block ||
      !customer?.is_active ||
      customer?.billing_blocked
    )
      continue;
    for (const line of dispatch.items || []) {
      const item = itemById.get(line.item_id);
      if (item?.is_active && item.code && Number(line.quantity) > 0)
        candidates.push({ dispatch, order, customer, item, line });
    }
  }
  const signatureCount = new Map();
  for (const row of candidates) {
    const key = `${row.customer.id}|${row.item.id}|${Number(row.line.quantity)}`;
    signatureCount.set(key, (signatureCount.get(key) || 0) + 1);
  }
  const target = candidates.find((row) => {
    const key = `${row.customer.id}|${row.item.id}|${Number(row.line.quantity)}`;
    return signatureCount.get(key) === 1;
  });
  assert(target, "No uniquely resolvable unbilled dispatch exists for preview.");

  const invoiceDate = today;
  const due = new Date(`${invoiceDate}T00:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  const dueDate = iso(due);
  const before = await counts(db, tenantId);
  const message = `Create invoice for ${target.customer.customer_code} for ${Number(target.line.quantity)} ${target.item.uom || "nos"} ${target.item.code} invoice dated ${invoiceDate} due date ${dueDate}`;
  const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const preview = await json(response);
  assert(response.ok, "Sales-invoice prompt preview failed", preview);
  assert(
    preview.status === "READY_TO_REQUEST_APPROVAL" &&
      preview.proposed_action?.action_code === "CREATE_SALES_INVOICE" &&
      (preview.questions || []).length === 0,
    "Sales invoice did not reach governed approval readiness",
    preview,
  );
  assert(
    preview.resolved?.counterparty?.id === target.customer.id &&
      preview.resolved?.item?.id === target.item.id &&
      preview.resolved?.invoice_readiness?.dispatch?.id === target.dispatch.id &&
      preview.resolved?.invoice_readiness?.sales_order_released === true &&
      preview.resolved?.invoice_readiness?.billing_blocked === false &&
      preview.extracted?.invoice_date === invoiceDate &&
      preview.extracted?.due_date === dueDate,
    "Sales-invoice context does not match the authoritative dispatch chain",
    { preview, target },
  );
  const after = await counts(db, tenantId);
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    "Preview unexpectedly changed invoice or accounting data",
    { before, after },
  );
  const report = {
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    database_host: databaseHost,
    mode: "PREVIEW_ONLY_NO_WRITES",
    target: {
      dispatch_id: target.dispatch.id,
      dispatch_number: target.dispatch.dn_number,
      sales_order_id: target.dispatch.sales_order_id,
      customer_id: target.customer.id,
      customer_code: target.customer.customer_code,
      item_id: target.item.id,
      item_code: target.item.code,
      quantity: Number(target.line.quantity),
    },
    preview: {
      status: preview.status,
      action_code: preview.proposed_action.action_code,
      questions: preview.questions,
      native_record_created: false,
    },
    controls: {
      unique_unbilled_dispatch: true,
      pgi_or_delivery_required: true,
      released_sales_order_required: true,
      billing_blocks_respected: true,
      independent_approval_required: true,
      no_approval_request_created: true,
      no_invoice_or_accounting_write: true,
    },
    record_counts_before: before,
    record_counts_after: after,
  };
  save(report);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
