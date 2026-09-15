const fs = require("fs");
const path = require("path");

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

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function parameterIdentity(parameter) {
  return JSON.stringify([
    clean(parameter.parameter_name).toUpperCase(),
    clean(parameter.parameter_type).toUpperCase(),
    clean(parameter.specification),
    clean(parameter.unit_of_measure).toUpperCase(),
    parameter.tolerance_min ?? null,
    parameter.tolerance_max ?? null,
  ]);
}

async function main() {
  loadEnv();
  const dbUrl = new URL(process.env.SUPABASE_URL || "");
  assert(
    dbUrl.hostname === EXPECTED_DB,
    `Refusing non-Mizantra database: ${dbUrl.hostname}`,
  );
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  assert(key, "Mizantra service key is unavailable.");

  const loginResponse = await fetch(
    "https://mizantra.saksolution.com/api/v1/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: process.env.QA_USERNAME || "hnoman",
        password: process.env.QA_PASSWORD || "Password",
      }),
    },
  );
  const login = await readJson(loginResponse);
  assert(
    loginResponse.ok && login?.accessToken,
    `Mizantra login failed (${loginResponse.status}).`,
  );
  const tenantId = login.user?.tenantId || login.user?.tenant_id;
  assert(tenantId, "Authenticated tenant identity is missing.");

  const select = [
    "id",
    "item_id",
    "item_code",
    "item_name",
    "inspection_type",
    "inspection_date",
    "status",
    "overall_result",
    "parameters:inspection_parameters(parameter_name,parameter_type,specification,unit_of_measure,tolerance_min,tolerance_max,result,criticality,is_mandatory)",
  ].join(",");
  const params = new URLSearchParams({
    select,
    tenant_id: `eq.${tenantId}`,
    order: "inspection_date.desc",
    limit: "1000",
  });
  const response = await fetch(
    `${dbUrl.origin}/rest/v1/quality_inspections?${params}`,
    {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    },
  );
  const inspections = await readJson(response);
  assert(
    response.ok && Array.isArray(inspections),
    `Unable to read QC history (${response.status}).`,
  );

  const itemMap = new Map();
  for (const inspection of inspections) {
    const itemKey =
      clean(inspection.item_id) ||
      `${clean(inspection.item_code)}:${clean(inspection.item_name)}`;
    if (!itemMap.has(itemKey)) {
      itemMap.set(itemKey, {
        item_id: inspection.item_id || null,
        item_code: clean(inspection.item_code),
        item_name: clean(inspection.item_name),
        inspection_count: 0,
        latest_inspection_date: null,
        inspection_types: new Set(),
        parameters: new Map(),
      });
    }
    const item = itemMap.get(itemKey);
    item.inspection_count += 1;
    item.latest_inspection_date =
      item.latest_inspection_date || inspection.inspection_date || null;
    item.inspection_types.add(clean(inspection.inspection_type));
    for (const parameter of inspection.parameters || []) {
      if (!clean(parameter.parameter_name) || !clean(parameter.specification))
        continue;
      const identity = parameterIdentity(parameter);
      if (!item.parameters.has(identity)) {
        item.parameters.set(identity, {
          parameter_name: clean(parameter.parameter_name),
          parameter_type: clean(parameter.parameter_type),
          specification: clean(parameter.specification),
          unit_of_measure: clean(parameter.unit_of_measure) || null,
          tolerance_min: parameter.tolerance_min ?? null,
          tolerance_max: parameter.tolerance_max ?? null,
          criticality: clean(parameter.criticality) || "MAJOR",
          is_mandatory: parameter.is_mandatory !== false,
          occurrences: 0,
          pass_results: 0,
          fail_results: 0,
        });
      }
      const evidence = item.parameters.get(identity);
      evidence.occurrences += 1;
      if (clean(parameter.result).toUpperCase() === "PASS")
        evidence.pass_results += 1;
      if (clean(parameter.result).toUpperCase() === "FAIL")
        evidence.fail_results += 1;
    }
  }

  const candidates = [...itemMap.values()]
    .map((item) => ({
      item_id: item.item_id,
      item_code: item.item_code,
      item_name: item.item_name,
      inspection_count: item.inspection_count,
      latest_inspection_date: item.latest_inspection_date,
      inspection_types: [...item.inspection_types].filter(Boolean),
      evidenced_parameters: [...item.parameters.values()].sort(
        (a, b) => b.occurrences - a.occurrences,
      ),
    }))
    .filter((item) => item.evidenced_parameters.length > 0)
    .sort((a, b) => {
      const repeatedA = a.evidenced_parameters.filter(
        (parameter) => parameter.occurrences >= 2,
      ).length;
      const repeatedB = b.evidenced_parameters.filter(
        (parameter) => parameter.occurrences >= 2,
      ).length;
      return repeatedB - repeatedA || b.inspection_count - a.inspection_count;
    })
    .slice(0, 10);

  const recommended = candidates.find((candidate) =>
    candidate.evidenced_parameters.some(
      (parameter) => parameter.occurrences >= 2,
    ),
  );
  const report = {
    pass: Boolean(recommended),
    mode: "READ_ONLY",
    environment: "MIZANTRA TEST ONLY",
    database_host: dbUrl.hostname,
    tenant_id: tenantId,
    checked_at: new Date().toISOString(),
    inspections_reviewed: inspections.length,
    items_with_parameter_evidence: candidates.length,
    recommended_candidate: recommended || null,
    candidates,
    decision: recommended
      ? "Historical repeated specifications were found. They may be copied into a DRAFT inspection plan for business review, but must not be approved without the quality owner's confirmation."
      : "No repeated historical specification evidence exists. Obtain the quality owner's parameters before creating a plan.",
    invariants: {
      no_quality_plan_created: true,
      no_quality_plan_approved: true,
      no_business_record_changed: true,
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
    `mizantra-quality-history-plan-evidence-${stamp}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
