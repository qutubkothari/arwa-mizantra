const fs = require("fs");
const path = require("path");

const BASE = (process.env.QA_BASE_URL || "https://mizantra.ae").replace(
  /\/$/,
  "",
);
const ENV_FILE = process.env.QA_API_ENV_FILE || "apps/api/.env.test";

function loadEnv(file) {
  for (const line of fs
    .readFileSync(path.resolve(file), "utf8")
    .replace(/\r/g, "")
    .split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
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

function assert(condition, message, detail) {
  if (!condition)
    throw new Error(`${message}\n${JSON.stringify(detail, null, 2)}`);
}

const cases = [
  {
    area: "inventory",
    prompt: "stk of 700-0002?",
    intent: "REPORT",
    kind: "INVENTORY_POSITION",
  },
  {
    area: "inventory",
    prompt: "700-0002 ka maal kitna bacha hai",
    intent: "REPORT",
    kind: "INVENTORY_POSITION",
  },
  {
    area: "inventory",
    prompt: "show low stok items",
    intent: "REPORT",
    kind: "INVENTORY_POSITION",
  },
  {
    area: "documents",
    prompt: "print todays job card for me",
    intent: "REPORT",
  },
  { area: "production", prompt: "list all job orders", intent: "REPORT" },
  {
    area: "production",
    prompt: "create JO 100 pcs 700-0002 by 30-09-2026",
    intent: "JOB_ORDER",
  },
  {
    area: "production",
    prompt: "creat a job oder for 25 pcs of 700-0002 needed 25-09-2026",
    intent: "JOB_ORDER",
  },
  {
    area: "procurement",
    prompt: "raise PR for 10 pcs 700-0002 required 20-09-2026 for Production",
    intent: "PURCHASE_REQUISITION",
  },
  {
    area: "procurement",
    prompt: "creat pur req for 5 nos 700-0002 by 22-09-2026 production dept",
    intent: "PURCHASE_REQUISITION",
  },
  {
    area: "procurement",
    prompt: "create a PO for Asons with 100 ctns 8x80",
    intent: "PURCHASE_ORDER",
  },
  { area: "procurement", prompt: "show GRNs received today", intent: "REPORT" },
  {
    area: "finance",
    prompt: "which supplier has highest AP?",
    intent: "REPORT",
    kind: "SUPPLIER_DUES",
  },
  {
    area: "finance",
    prompt: "supplier advances?",
    intent: "REPORT",
    kind: "SUPPLIER_ADVANCES",
  },
  {
    area: "finance",
    prompt: "what was the latest supplier payment?",
    intent: "REPORT",
    kind: "SUPPLIER_PAYMENTS",
  },
  {
    area: "finance",
    prompt: "show accounts payable ageing",
    intent: "REPORT",
    kind: "SUPPLIER_DUES",
  },
  {
    area: "finance",
    prompt: "download accounts payable report",
    intent: "REPORT",
    kind: "SUPPLIER_DUES",
  },
  {
    area: "crm",
    prompt: "show latest CRM enquiries",
    intent: "REPORT",
    kind: "CRM_PIPELINE",
  },
  {
    area: "crm",
    prompt: "who has CRM follow ups due today",
    intent: "REPORT",
    kind: "CRM_FOLLOWUPS",
  },
  {
    area: "production",
    prompt: "how is production floor today",
    intent: "REPORT",
    kind: "PRODUCTION_STATUS",
  },
  {
    area: "production",
    prompt: "production output and rejection report today",
    intent: "REPORT",
    kind: "PRODUCTION_REPORT",
  },
  {
    area: "hr",
    prompt: "who came late today",
    intent: "REPORT",
    kind: "EMPLOYEE_ATTENDANCE",
  },
  {
    area: "management",
    prompt: "give me an owner business summary",
    intent: "REPORT",
    kind: "MANAGEMENT_SUMMARY",
  },
  {
    area: "crm",
    prompt: "create a lead for Acme Marine contact ali@acme.example",
    intent: "CRM_ACTION",
  },
  {
    area: "inventory",
    prompt: "receive 10 pcs against PO-2026-09-001 invoice INV-55",
    intent: "GOODS_RECEIPT",
  },
  {
    area: "inventory",
    prompt: "isssue 5 pcs 700-0002 to JO-2026-09-0001",
    intent: "STOCK_ISSUE",
  },
  {
    area: "inventory",
    prompt: "return 2 unused pcs 700-0002 from JO-2026-09-0001",
    intent: "STOCK_RETURN",
  },
  {
    area: "quality",
    prompt: "raise NCR for 3 rejected duct sections",
    intent: "QUALITY_NCR",
  },
  {
    area: "maintenance",
    prompt: "schedule preventive maintenance for Cutting Machine 1 tomorrow",
    intent: "MAINTENANCE_WORK_ORDER",
  },
  { area: "hr", prompt: "prepare September payroll", intent: "PAYROLL_RUN" },
  {
    area: "hr",
    prompt: "apply leave for tomorrow because medical appointment",
    intent: "LEAVE_REQUEST",
  },
];

async function main() {
  loadEnv(ENV_FILE);
  assert(
    /^https:\/\/mizantra\.(ae|saksolution\.com)$/i.test(BASE),
    "Refusing non-Mizantra target",
    BASE,
  );
  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const auth = await json(loginResponse);
  assert(loginResponse.ok && auth?.accessToken, "Mizantra login failed", auth);
  const headers = {
    authorization: `Bearer ${auth.accessToken}`,
    "content-type": "application/json",
  };
  const tenantId = auth.user?.tenantId || auth.user?.tenant_id;
  const conversationIds = [];
  const results = [];

  try {
    for (const test of cases) {
      const started = Date.now();
      const response = await fetch(`${BASE}/api/v1/active-planner/interpret`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: test.prompt }),
      });
      const data = await json(response);
      if (data?.conversation_id) conversationIds.push(data.conversation_id);
      const actualKind = data?.analytics?.kind || data?.analytics_kind || null;
      const pass =
        response.ok &&
        data?.intent_type === test.intent &&
        (!test.kind || actualKind === test.kind) &&
        data?.safety?.approval_unchanged !== false;
      const row = {
        ...test,
        pass,
        http: response.status,
        actualIntent: data?.intent_type || null,
        actualKind,
        status: data?.status || null,
        questions: data?.questions || [],
        answer: String(data?.assistant_message || "").slice(0, 180),
        ms: Date.now() - started,
      };
      results.push(row);
      console.log(
        `${pass ? "PASS" : "FAIL"} [${test.area}] ${test.prompt} -> ${row.actualIntent}/${row.actualKind || "-"} ${row.status}`,
      );
    }
  } finally {
    const serviceKey =
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (serviceKey && tenantId && conversationIds.length) {
      await fetch(
        `${String(process.env.SUPABASE_URL).replace(/\/$/, "")}/rest/v1/active_planner_conversations?tenant_id=eq.${tenantId}&id=in.(${conversationIds.join(",")})`,
        {
          method: "PATCH",
          headers: {
            apikey: serviceKey,
            authorization: `Bearer ${serviceKey}`,
            "content-type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            is_archived: true,
            updated_at: new Date().toISOString(),
          }),
        },
      );
    }
  }

  const failures = results.filter((row) => !row.pass);
  console.log(
    JSON.stringify(
      {
        total: results.length,
        passed: results.length - failures.length,
        failed: failures.length,
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
