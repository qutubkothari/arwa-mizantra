const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const baseUrl = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const username = process.env.QA_USERNAME || "hnoman";
const password = process.env.QA_PASSWORD || "Password";

function assert(value, message, details) {
  if (!value) {
    throw new Error(
      `${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`,
    );
  }
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

  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const login = await loginResponse.json();
  assert(
    loginResponse.ok && login.accessToken,
    "Mizantra test login failed.",
    login,
  );

  const tenantId = login.user?.tenantId || login.user?.tenant_id;
  assert(tenantId, "Login response did not contain a tenant.", login.user);

  const dashboardResponse = await fetch(
    `${baseUrl}/api/v1/transformation/dashboard`,
    { headers: { authorization: `Bearer ${login.accessToken}` } },
  );
  const dashboard = await dashboardResponse.json();
  assert(
    dashboardResponse.ok,
    "Transformation dashboard API failed.",
    dashboard,
  );
  assert(
    Array.isArray(dashboard.objectives),
    "Objectives must be an array.",
    dashboard,
  );
  assert(
    Array.isArray(dashboard.actions),
    "Actions must be an array.",
    dashboard,
  );
  assert(
    Array.isArray(dashboard.initiatives),
    "Initiatives must be an array.",
    dashboard,
  );
  assert(
    dashboard.safety?.operational_documents_unchanged === true &&
      dashboard.safety?.accounting_posting_unchanged === true &&
      dashboard.safety?.action_outcomes_independently_verified === true &&
      dashboard.safety?.financial_benefits_require_finance_verification ===
        true &&
      dashboard.safety?.ai_advisory_only === true,
    "Transformation safety contract is incomplete.",
    dashboard.safety,
  );

  const advisorResponse = await fetch(
    `${baseUrl}/api/v1/transformation/advisor`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        question:
          "What should management prioritize next based only on current evidence?",
      }),
    },
  );
  const advisor = await advisorResponse.json();
  assert(advisorResponse.ok, "Transformation advisor API failed.", advisor);
  assert(
    advisor.advisory_only === true &&
      advisor.records_created === 0 &&
      advisor.records_modified === 0 &&
      Array.isArray(advisor.priorities) &&
      Array.isArray(advisor.missing_evidence) &&
      ["OPENAI", "DETERMINISTIC_FALLBACK"].includes(advisor.provider),
    "Transformation advisor safety contract failed.",
    advisor,
  );
  assert(
    advisor.priorities.every(
      (priority) => priority.requires_human_approval === true,
    ),
    "An advisor priority omitted human approval.",
    advisor.priorities,
  );

  const pageResponse = await fetch(`${baseUrl}/dashboard/transformation`);
  assert(pageResponse.ok, `Transformation page failed: ${pageResponse.status}`);

  databaseUrl.searchParams.set("sslmode", "no-verify");
  const db = new Client({ connectionString: databaseUrl.toString() });
  await db.connect();
  let database;
  try {
    const result = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM information_schema.tables
          WHERE table_schema='public' AND table_name IN
            ('transformation_objectives','transformation_kpi_definitions','transformation_kpi_snapshots','transformation_actions')) AS control_tables,
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='value_realization_initiatives'
            AND column_name IN ('transformation_objective_id','primary_kpi_id','target_metric_value','expected_direction')) AS initiative_link_columns,
        (SELECT COUNT(*)::int FROM public.app_feature_catalogue
          WHERE feature_key='business-transformation' AND is_active=TRUE) AS feature_rows,
        (SELECT COUNT(*)::int FROM public.tenant_feature_entitlements
          WHERE tenant_id=$1 AND feature_key='business-transformation' AND is_enabled=TRUE) AS tenant_entitlement`,
      [tenantId],
    );
    database = result.rows[0];
  } finally {
    await db.end();
  }
  assert(
    database.control_tables === 4 &&
      database.initiative_link_columns === 4 &&
      database.feature_rows === 1 &&
      database.tenant_entitlement === 1,
    "Transformation database acceptance failed.",
    database,
  );

  const report = {
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    base_url: baseUrl,
    database_host: databaseUrl.hostname,
    tenant_id: tenantId,
    checks: {
      authenticated_dashboard: true,
      authenticated_advisor: true,
      page_available: true,
      schema_complete: true,
      feature_entitled: true,
      read_only_acceptance: true,
      operational_documents_unchanged: true,
      accounting_posting_unchanged: true,
    },
    counts: {
      objectives: dashboard.objectives.length,
      actions: dashboard.actions.length,
      initiatives: dashboard.initiatives.length,
    },
    database,
    advisor: {
      provider: advisor.provider,
      model: advisor.model,
      fallback_used: advisor.fallback_used,
      business_health: advisor.business_health,
      priorities: advisor.priorities.length,
      advisory_only: advisor.advisory_only,
      records_created: advisor.records_created,
      records_modified: advisor.records_modified,
    },
  };
  const outputDir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const output = path.join(
    outputDir,
    `business-transformation-readonly-${stamp}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
