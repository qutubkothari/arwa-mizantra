const fs = require("fs");
const path = require("path");

const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const EXPECTED_DB = "nwkaruzvzwwuftjquypk.supabase.co";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadEnv() {
  for (const file of [
    path.join(process.cwd(), "apps/api/.env"),
    path.join(process.cwd(), "apps/api/.env.test"),
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
      )
        value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}

async function parse(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    return body;
  }
}

function contentRangeCount(value) {
  const match = String(value || "").match(/\/(\d+|\*)$/);
  return match && match[1] !== "*" ? Number(match[1]) : 0;
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
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  assert(key, "Mizantra service key is unavailable.");

  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const login = await parse(loginResponse);
  assert(
    loginResponse.ok && login?.accessToken,
    `Mizantra login failed (${loginResponse.status}).`,
  );
  const tenantId = login.user?.tenantId || login.user?.tenant_id;
  assert(tenantId, "Authenticated Mizantra tenant is unavailable.");

  async function count(table, filters = {}, select = "id") {
    const params = new URLSearchParams({
      select,
      limit: "1",
      tenant_id: `eq.${tenantId}`,
    });
    for (const [field, value] of Object.entries(filters))
      params.set(field, value);
    const response = await fetch(`${dbUrl.origin}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: "count=exact",
        range: "0-0",
      },
    });
    const data = await parse(response);
    if (!response.ok)
      return {
        count: 0,
        error:
          typeof data === "string"
            ? data
            : data?.message || `HTTP ${response.status}`,
      };
    return {
      count: contentRangeCount(response.headers.get("content-range")),
      error: null,
    };
  }

  const definitions = [
    {
      key: "customers",
      label: "Customer master",
      table: "customers",
      filters: { is_active: "eq.true" },
      minimum: 1,
      required: true,
      action: "Create or activate at least one UAT customer.",
    },
    {
      key: "items",
      label: "Item master",
      table: "items",
      filters: { is_active: "eq.true" },
      minimum: 2,
      required: true,
      action: "Configure a finished product and at least one component.",
    },
    {
      key: "approved_boms",
      label: "Approved BOM revisions",
      table: "bom_headers",
      filters: { is_active: "eq.true", lifecycle_status: "eq.APPROVED" },
      minimum: 1,
      required: true,
      action: "Approve an effective BOM revision for the UAT finished product.",
    },
    {
      key: "warehouses",
      label: "Active warehouses",
      table: "warehouses",
      filters: { is_active: "eq.true" },
      minimum: 1,
      required: true,
      action:
        "Activate a warehouse for material issue and finished-goods receipt.",
    },
    {
      key: "work_stations",
      label: "Active work stations",
      table: "work_stations",
      filters: { is_active: "eq.true" },
      minimum: 1,
      required: true,
      action: "Configure an active station and its capacity calendar.",
    },
    {
      key: "inspection_plans",
      label: "Approved inspection plans",
      table: "quality_inspection_plans",
      filters: { status: "eq.APPROVED" },
      minimum: 1,
      required: true,
      action: "Approve an effective in-process or final inspection plan.",
    },
    {
      key: "accounts",
      label: "Active ledger accounts",
      table: "accounting_accounts",
      filters: { is_active: "eq.true" },
      minimum: 2,
      required: true,
      action:
        "Configure the required inventory, WIP, revenue and cost accounts.",
    },
    {
      key: "open_periods",
      label: "Open accounting periods",
      table: "accounting_periods",
      filters: { status: "eq.OPEN" },
      minimum: 1,
      required: true,
      action: "Open the UAT accounting period.",
    },
    {
      key: "entitlements",
      label: "Enabled tenant features",
      table: "tenant_feature_entitlements",
      filters: { is_enabled: "eq.true" },
      select: "feature_key",
      minimum: 1,
      required: true,
      action: "Enable the required UAT screens in Feature Access.",
    },
    {
      key: "planning_policies",
      label: "Item planning policies",
      table: "production_item_planning_policies",
      minimum: 1,
      required: false,
      action:
        "Set lead-time, safety-stock, MOQ and make/buy policy for representative items.",
    },
    {
      key: "stock",
      label: "Opening stock rows",
      table: "stock_entries",
      minimum: 1,
      required: false,
      action:
        "Load representative component stock before the execution scenario.",
    },
    {
      key: "sales_orders",
      label: "Existing sales-order examples",
      table: "sales_orders",
      minimum: 1,
      required: false,
      action:
        "Create the controlled UAT sales order during execution if no reusable test order exists.",
    },
  ];

  const checks = [];
  for (const definition of definitions) {
    const result = await count(
      definition.table,
      definition.filters,
      definition.select,
    );
    checks.push({
      key: definition.key,
      label: definition.label,
      required: definition.required,
      minimum: definition.minimum,
      count: result.count,
      pass: !result.error && result.count >= definition.minimum,
      error: result.error,
      action: definition.action,
    });
  }

  const required = checks.filter((check) => check.required);
  const blockers = required.filter((check) => !check.pass);
  const recommendations = checks.filter(
    (check) => !check.required && !check.pass,
  );
  const report = {
    pass: blockers.length === 0,
    mode: "READ_ONLY",
    environment: "MIZANTRA TEST ONLY",
    base_url: BASE,
    database_host: dbUrl.hostname,
    tenant_id: tenantId,
    checked_at: new Date().toISOString(),
    readiness_percent: Math.round(
      (required.filter((check) => check.pass).length / required.length) * 100,
    ),
    checks,
    blockers,
    recommendations,
    next_action: blockers.length
      ? blockers[0].action
      : "Run the controlled end-to-end UAT scenario.",
    invariants: {
      no_business_record_created: true,
      no_business_record_updated: true,
      no_business_record_deleted: true,
      no_live_customer_environment_touched: true,
    },
  };

  const outputDir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const output = path.join(
    outputDir,
    `mizantra-uat-readiness-readonly-${stamp}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
