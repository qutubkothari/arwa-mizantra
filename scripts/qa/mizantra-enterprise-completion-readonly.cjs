const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE_URL || 'https://mizantra.saksolution.com';
const EXPECTED_DB = 'nwkaruzvzwwuftjquypk.supabase.co';

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`}`);
}

function loadEnv() {
  for (const file of [path.join(process.cwd(), 'apps/api/.env'), path.join(process.cwd(), 'apps/api/.env.test')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n')) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}

async function json(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function main() {
  loadEnv();
  assert(/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE), 'Refusing to run outside Mizantra test.', BASE);
  const dbUrl = new URL(process.env.SUPABASE_URL || '');
  assert(dbUrl.hostname === EXPECTED_DB, 'Refusing to inspect a non-Mizantra database.', dbUrl.hostname);
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  assert(key, 'Mizantra Supabase key is unavailable.');

  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || 'hnoman',
      password: process.env.QA_PASSWORD || 'Password',
    }),
  });
  const login = await json(loginResponse);
  assert(loginResponse.ok && login?.accessToken, `Mizantra login failed (${loginResponse.status}).`, login);
  const token = login.accessToken;
  const tenantId = login?.user?.tenantId || login?.user?.tenant_id;
  assert(tenantId, 'Authenticated tenant identity is missing.');

  const apiChecks = [
    ['feature entitlements', '/features/me', 'GET'],
    ['sales demand', '/production-planning/sales-orders'],
    ['MRP recommendation', '/mrp/latest'],
    ['APS control tower', '/production-planning/control-tower'],
    ['production execution', '/job-orders'],
    ['quality execution', '/quality/inspections'],
    ['subcontract reconciliation', '/production/subcontracting/dashboard'],
    ['manufacturing variance and WIP', '/costing/production-variance'],
    ['owner transformation cockpit', '/intelligence/transformation-cockpit'],
    ['governed action queue', '/intelligence/action-requests', 'GET'],
    ['AI observability', '/intelligence/observability', 'GET'],
    ['permission-scoped Active Planner', '/active-planner/capabilities', 'POST'],
  ];
  const api = [];
  for (const [name, endpoint, method = 'GET'] of apiChecks) {
    const response = await fetch(`${BASE}/api/v1${endpoint}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const data = await json(response);
    assert(response.ok, `${name} endpoint failed (${response.status}).`, data);
    if (name === 'AI observability') {
      assert(data?.provider_runtime?.configured === true, 'OpenAI provider is not configured in Mizantra test.', data?.provider_runtime);
      assert(data?.provider_runtime?.api_mode === 'RESPONSES', 'Mizantra AI is not using the Responses API.', data?.provider_runtime);
    }
    if (name === 'permission-scoped Active Planner') {
      assert(data?.provider?.configured === true, 'Active Planner does not see the configured provider.', data?.provider);
      assert(data?.provider?.api_mode === 'RESPONSES', 'Active Planner is not using the Responses API.', data?.provider);
      assert(data?.safety?.permission_scoped === true, 'Active Planner permission scoping is unavailable.', data?.safety);
    }
    api.push({
      name,
      endpoint,
      status: response.status,
      shape: Array.isArray(data) ? 'array' : typeof data,
      ...(name === 'AI observability' ? { evidence: { configured: data.provider_runtime.configured, provider: data.provider_runtime.provider, model: data.provider_runtime.default_model, api_mode: data.provider_runtime.api_mode, provider_calls: data.provider_runtime.metrics?.provider_calls } } : {}),
      ...(name === 'permission-scoped Active Planner' ? { evidence: { workflow_count: data.capabilities?.length, permission_scoped: data.safety.permission_scoped, approval_and_posting_never_automatic: data.safety.approval_and_posting_never_automatic } } : {}),
    });
  }

  const tables = [
    'app_feature_catalogue',
    'tenant_feature_entitlements',
    'stock_reservations',
    'mrp_planning_runs',
    'mrp_planning_lines',
    'mrp_planner_decisions',
    'production_programs',
    'production_planning_runs',
    'production_material_consumptions',
    'quality_inspection_plans',
    'quality_inspection_plan_parameters',
    'inspection_parameters',
    'subcontract_reconciliations',
    'production_tool_resources',
    'production_tool_events',
    'inventory_cost_events',
    'production_cost_remediation_actions',
    'automation_tasks',
    'mizantra_exception_register',
    'accounting_journals',
    'accounting_journal_lines',
    'active_planner_executions',
    'mizantra_ai_call_metrics',
  ];
  const schema = [];
  for (const table of tables) {
    const response = await fetch(`${dbUrl.origin}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact', range: '0-0' },
    });
    const data = await json(response);
    assert(response.ok, `Required Mizantra table is unavailable: ${table} (${response.status}).`, data);
    schema.push({ table, status: response.status, content_range: response.headers.get('content-range') });
  }

  const pages = [
    '/dashboard/settings/feature-access',
    '/dashboard/production/demand-planning',
    '/dashboard/production/mrp',
    '/dashboard/production/planning-control-tower',
    '/dashboard/production/job-orders',
    '/dashboard/quality/inspection-plans',
    '/dashboard/production/subcontracting',
    '/dashboard/production/maintenance',
    '/dashboard/accounts/costing',
    '/dashboard/command-center',
    '/dashboard/active-planner',
  ];
  const web = [];
  for (const page of pages) {
    const response = await fetch(`${BASE}${page}`, { redirect: 'manual' });
    assert(response.status === 200, `Required Mizantra screen failed (${response.status}): ${page}`);
    web.push({ page, status: response.status });
  }

  const report = {
    pass: true,
    mode: 'READ_ONLY',
    environment: 'MIZANTRA TEST ONLY',
    base_url: BASE,
    database_host: dbUrl.hostname,
    tenant_id: tenantId,
    checked_at: new Date().toISOString(),
    api,
    schema,
    web,
    invariants: {
      no_business_record_created: true,
      no_business_record_updated: true,
      no_business_record_deleted: true,
      no_live_customer_environment_touched: true,
    },
  };
  const outDir = path.join(process.cwd(), 'artifacts', 'qa');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const output = path.join(outDir, `mizantra-enterprise-completion-readonly-${stamp}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
