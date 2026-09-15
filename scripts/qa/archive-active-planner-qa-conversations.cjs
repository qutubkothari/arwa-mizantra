const fs = require("fs");
const path = require("path");

for (const name of ["apps/api/.env", "apps/api/.env.test"]) {
  const file = path.resolve(name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const expectedDb = "nwkaruzvzwwuftjquypk.supabase.co";
const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const since = process.env.QA_SINCE;
const apply = process.argv.includes("--apply");

async function body(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return raw; }
}

async function main() {
  if (new URL(base).hostname !== expectedDb)
    throw new Error("Refusing outside the Mizantra database.");
  if (!since || Number.isNaN(Date.parse(since)))
    throw new Error("Set QA_SINCE to the exact beginning of the QA run.");
  const login = await fetch("https://mizantra.saksolution.com/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const auth = await body(login);
  if (!login.ok || !auth?.accessToken) throw new Error("QA login failed.");
  const tenantId = auth.user?.tenantId || auth.user?.tenant_id;
  const userId = auth.user?.id || auth.user?.userId;
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const query = new URLSearchParams({
    select: "id,title,created_at,message_count",
    tenant_id: `eq.${tenantId}`,
    user_id: `eq.${userId}`,
    is_archived: "eq.false",
    created_at: `gte.${new Date(since).toISOString()}`,
    order: "created_at.asc",
  });
  const response = await fetch(
    `${base}/rest/v1/active_planner_conversations?${query}`,
    { headers },
  );
  const rows = await body(response);
  if (!response.ok || !Array.isArray(rows))
    throw new Error(`Conversation inspection failed: ${JSON.stringify(rows)}`);
  const qaTitles = new Set([
    "Create a lead for Acme Marine",
    "Raise a PR for 50 bearings needed next Friday",
    "Create a PO for Asons with 100 cartons of 8x80",
    "Receive 25 chargers against PO-210 invoice G26-0216",
    "Record transport service completion against PO-100",
    "Quote MOD for 100 drones at 10 lakhs each",
    "Create an order for MOD for 100 drones",
    "Invoice MOD for 100 drones at 10 lakhs each",
    "Record 5 lakhs received from MOD against INV-10",
    "Dispatch 20 drones against SO-100",
    "Issue 20 bearings to job JO-10",
    "Return 5 unused bearings from JO-10",
    "Adjust item X down by 3 after cycle count",
    "Plan 100 drones for SO-100 by 30 September",
    "Create a job for 100 impellers by Monday",
    "Send 100 castings to Vendor X for machining",
    "Inspect GRN-100 and sample 10 pieces",
    "Raise NCR for 5 rejected impellers",
    "Create urgent breakdown work order for CNC-2",
    "Open a breakdown ticket for customer ABC",
    "Create project Alpha for customer MOD",
    "Accrue 2 lakhs audit fees for August",
    "Prepare Friday payment run for approved invoices",
    "Add a new production engineer joining Monday",
    "Apply casual leave next Monday",
    "Correct yesterday checkout to 6:30 PM",
    "Prepare August payroll",
    "Show overdue POs by supplier",
    "Remind purchase manager when PO is overdue by 3 days",
    "What were sales to Coast Guard over the last 3 months?",
    "What are customer dues for Coast Guard?",
    "Show low stock items",
    "Show open sales order status",
    "Show production progress",
    "Give me an owner business summary",
    "Now show last quarter",
    "Do we have Super8 Antenna in stock?",
  ]);
  const qaPrefixes = [
    "What are the supplier dues for ",
    "Compare prices between supplier ",
  ];
  const targets = rows.filter(
    (row) =>
      qaTitles.has(row.title) ||
      qaPrefixes.some((prefix) => String(row.title).startsWith(prefix)),
  );
  if (apply && targets.length) {
    const ids = targets.map((row) => row.id).join(",");
    const archived = await fetch(
      `${base}/rest/v1/active_planner_conversations?id=in.(${ids})&tenant_id=eq.${tenantId}&user_id=eq.${userId}`,
      {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          is_archived: true,
          current_context_token: null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!archived.ok) throw new Error(`Archiving failed with HTTP ${archived.status}.`);
  }
  console.log(JSON.stringify({
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    mode: apply ? "ARCHIVED" : "DRY_RUN",
    inspected: rows.length,
    matched_qa_conversations: targets.length,
    targets: targets.map(({ title, created_at, message_count }) => ({ title, created_at, message_count })),
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
