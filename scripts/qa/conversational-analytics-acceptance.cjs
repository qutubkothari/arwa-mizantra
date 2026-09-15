const fs = require("fs");
const path = require("path");

const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const EXPECTED_DB = "nwkaruzvzwwuftjquypk.supabase.co";

function fail(message, detail) {
  throw new Error(
    `${message}${detail === undefined ? "" : `\n${JSON.stringify(detail, null, 2)}`}`,
  );
}

function loadEnv() {
  for (const file of ["apps/api/.env", "apps/api/.env.test"]) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs
      .readFileSync(full, "utf8")
      .replace(/\r/g, "")
      .split("\n")) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

async function json(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function db(table, query) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const data = await json(response);
  if (!response.ok || !Array.isArray(data))
    fail(`Unable to read ${table}.`, data);
  return data;
}

async function main() {
  loadEnv();
  if (!/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE))
    fail(`Refusing non-Mizantra URL: ${BASE}`);
  const dbUrl = new URL(process.env.SUPABASE_URL || "");
  if (dbUrl.hostname !== EXPECTED_DB)
    fail(`Refusing non-Mizantra database: ${dbUrl.hostname}`);

  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const auth = await json(login);
  if (!login.ok || !auth?.accessToken) fail("Mizantra login failed.", auth);
  const token = auth.accessToken;
  const tenantId = auth.user?.tenantId || auth.user?.tenant_id;

  const call = async (message, contextToken) => {
    const response = await fetch(`${BASE}/api/v1/active-planner/interpret`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message,
        context_token: contextToken || undefined,
      }),
    });
    const data = await json(response);
    if (!response.ok) fail(`Prompt failed: ${message}`, data);
    return data;
  };

  const before = await db(
    "active_planner_executions",
    `select=id&tenant_id=eq.${tenantId}`,
  );
  const salesPrompt = "What were sales to Coast Guard over the last 3 months?";

  const openPayables = await db(
    "accounting_open_items",
    `select=party:accounting_parties(party_id,party_name,party_code)&tenant_id=eq.${tenantId}&direction=eq.PAYABLE&status=in.(OPEN,PARTIAL)&limit=1`,
  );
  let supplierName = openPayables[0]?.party?.party_name;
  if (!supplierName) {
    const grns = await db(
      "grns",
      `select=vendor:vendors(name)&tenant_id=eq.${tenantId}&invoice_approved=eq.true&limit=1`,
    );
    supplierName = grns[0]?.vendor?.name;
  }
  if (!supplierName) {
    const vendors = await db(
      "vendors",
      `select=name&tenant_id=eq.${tenantId}&is_active=eq.true&limit=1`,
    );
    supplierName = vendors[0]?.name;
  }
  if (!supplierName) fail("No supplier is available for analytics acceptance.");

  const orders = await db(
    "purchase_orders",
    `select=id,vendor_id,status,po_date,vendor:vendors(name),purchase_order_items(item_id,item_code,item_name)&tenant_id=eq.${tenantId}&order=po_date.desc&limit=1000`,
  );
  const grouped = new Map();
  for (const order of orders.filter(
    (row) =>
      !["DRAFT", "REJECTED", "CANCELLED"].includes(
        String(row.status).toUpperCase(),
      ),
  )) {
    for (const line of order.purchase_order_items || []) {
      const key =
        line.item_id || String(line.item_code || line.item_name).toUpperCase();
      if (!key || !order.vendor_id || !order.vendor?.name) continue;
      const group = grouped.get(key) || { item: line, vendors: new Map() };
      group.vendors.set(order.vendor_id, order.vendor.name);
      grouped.set(key, group);
    }
  }
  const comparison = [...grouped.values()].find(
    (group) => group.vendors.size >= 2,
  );
  if (!comparison) fail("No item with two-supplier PO history is available.");
  const vendorNames = [...comparison.vendors.values()].slice(0, 2);
  const itemQuery = comparison.item.item_code || comparison.item.item_name;
  const pricePrompt = `Compare prices between supplier ${vendorNames[0]} and supplier ${vendorNames[1]} for item ${itemQuery} over the last 12 months.`;
  const duePrompt = `What are the supplier dues for ${supplierName}?`;

  const results = [];
  let salesContext = "";
  for (const [kind, prompt] of [
    ["CUSTOMER_SALES", salesPrompt],
    ["CUSTOMER_RECEIVABLES", "What are customer dues for Coast Guard?"],
    ["SUPPLIER_DUES", duePrompt],
    ["SUPPLIER_PRICE_COMPARISON", pricePrompt],
    ["INVENTORY_POSITION", "Show low stock items"],
    ["SALES_ORDER_STATUS", "Show open sales order status"],
    ["PRODUCTION_STATUS", "Show production progress"],
    ["MANAGEMENT_SUMMARY", "Give me an owner business summary"],
  ]) {
    const data = await call(prompt);
    if (data.status !== "READY_WITH_ANALYTICS")
      fail(`${kind} did not return an analytical answer.`, data);
    if (data.analytics?.kind !== kind || data.analytics?.read_only !== true)
      fail(`${kind} answer failed its safety contract.`, data.analytics);
    if (!data.analytics?.definition || !data.analytics?.sources?.length)
      fail(`${kind} answer lacks calculation provenance.`, data.analytics);
    if (kind === "CUSTOMER_SALES") salesContext = data.context_token;
    results.push({
      prompt,
      kind,
      status: data.status,
      provider: data.provider,
      headline: data.analytics.headline,
      metrics: data.analytics.metrics,
      source_count: data.analytics.sources.reduce(
        (sum, source) => sum + Number(source.record_count || 0),
        0,
      ),
      warnings: data.analytics.warnings,
    });
  }
  const followUp = await call("Now show last quarter", salesContext);
  if (
    followUp.status !== "READY_WITH_ANALYTICS" ||
    followUp.analytics?.kind !== "CUSTOMER_SALES" ||
    !/^Q[1-4] 20\d{2}$/.test(followUp.analytics?.period?.label || "")
  )
    fail("Analytical follow-up did not preserve subject and change period.", followUp);
  results.push({
    prompt: "Now show last quarter",
    kind: "CUSTOMER_SALES_FOLLOW_UP",
    status: followUp.status,
    provider: followUp.provider,
    headline: followUp.analytics.headline,
    period: followUp.analytics.period,
    source_count: followUp.analytics.sources.reduce(
      (sum, source) => sum + Number(source.record_count || 0),
      0,
    ),
    warnings: followUp.analytics.warnings,
  });
  const after = await db(
    "active_planner_executions",
    `select=id&tenant_id=eq.${tenantId}`,
  );
  if (after.length !== before.length)
    fail("Interpret-only analytics created an execution record.", {
      before: before.length,
      after: after.length,
    });

  const report = {
    pass: true,
    environment: "MIZANTRA ONLY",
    database_host: dbUrl.hostname,
    tenant_id: tenantId,
    checked_at: new Date().toISOString(),
    read_only: true,
    records_created: 0,
    results,
  };
  const output = path.join(
    process.cwd(),
    "artifacts/qa/mizantra-conversational-analytics-acceptance.json",
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
