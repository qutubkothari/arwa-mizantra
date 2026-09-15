const fs = require("fs");
const path = require("path");

const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const EXPECTED_DB = "nwkaruzvzwwuftjquypk.supabase.co";
const fail = (message, detail) => {
  throw new Error(
    `${message}${detail === undefined ? "" : `\n${JSON.stringify(detail, null, 2)}`}`,
  );
};

for (const file of ["apps/api/.env", "apps/api/.env.test"]) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, "utf8").replace(/\r/g, "").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

async function body(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function dbCount(table, tenantId) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  const response = await fetch(
    `${base}/rest/v1/${table}?select=id&tenant_id=eq.${tenantId}`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  const data = await body(response);
  if (!response.ok || !Array.isArray(data)) fail(`Unable to count ${table}.`, data);
  return data.length;
}

async function archiveQaConversation(conversationId, tenantId) {
  if (!conversationId) return;
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  const response = await fetch(
    `${base}/rest/v1/active_planner_conversations?id=eq.${conversationId}&tenant_id=eq.${tenantId}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        is_archived: true,
        current_context_token: null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok)
    fail("Unable to archive a universal-gate QA conversation.", {
      conversationId,
      status: response.status,
    });
}

async function main() {
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
  const auth = await body(login);
  if (!login.ok || !auth?.accessToken) fail("Mizantra login failed.", auth);
  const tenantId = auth.user?.tenantId || auth.user?.tenant_id;
  const headers = {
    authorization: `Bearer ${auth.accessToken}`,
    "content-type": "application/json",
  };
  const capabilityResponse = await fetch(
    `${BASE}/api/v1/active-planner/capabilities`,
    { method: "POST", headers, body: "{}" },
  );
  const catalogue = await body(capabilityResponse);
  if (!capabilityResponse.ok || !Array.isArray(catalogue?.capabilities))
    fail("Capability catalogue failed.", catalogue);
  if (catalogue.capabilities.length < 28)
    fail("Capability catalogue is incomplete.", catalogue.capabilities);

  const trackedTables = [
    "active_planner_executions",
    "mizantra_governed_action_requests",
  ];
  const before = Object.fromEntries(
    await Promise.all(
      trackedTables.map(async (table) => [table, await dbCount(table, tenantId)]),
    ),
  );
  const results = [];
  for (const capability of catalogue.capabilities) {
    const prompt = capability.examples?.[0];
    if (!prompt) fail(`${capability.intent} has no demo prompt.`);
    const response = await fetch(`${BASE}/api/v1/active-planner/interpret`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: prompt }),
    });
    const data = await body(response);
    await archiveQaConversation(data?.conversation_id, tenantId);
    if (!response.ok) fail(`${capability.intent} prompt returned ${response.status}.`, data);
    if (data.intent_type !== capability.intent)
      fail(`${capability.intent} routed as ${data.intent_type}.`, { prompt, data });
    if (!data.capability?.route || !data.context_token)
      fail(`${capability.intent} lacks route or governed context.`, data);
    if (
      data.safety?.tenant_scoped !== true ||
      data.safety?.approval_unchanged !== true ||
      data.safety?.external_communication_never_automatic !== true
    )
      fail(`${capability.intent} lacks the safety contract.`, data.safety);
    results.push({
      intent: capability.intent,
      mode: capability.mode,
      prompt,
      status: data.status,
      questions: data.questions?.length || 0,
      provider: data.provider,
    });
  }
  const after = Object.fromEntries(
    await Promise.all(
      trackedTables.map(async (table) => [table, await dbCount(table, tenantId)]),
    ),
  );
  if (JSON.stringify(before) !== JSON.stringify(after))
    fail("Interpretation-only gate changed controlled records.", { before, after });

  const report = {
    pass: true,
    environment: "MIZANTRA ONLY",
    database_host: dbUrl.hostname,
    checked_at: new Date().toISOString(),
    capability_count: results.length,
    interpretation_only: true,
    records_created: 0,
    tracked_before: before,
    tracked_after: after,
    results,
  };
  const output = path.join(
    process.cwd(),
    "artifacts/qa/mizantra-active-planner-universal-release-gate.json",
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
