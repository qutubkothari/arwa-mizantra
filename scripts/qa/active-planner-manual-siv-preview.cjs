const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const baseUrl = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const assert = (value, message, details) => {
  if (!value)
    throw new Error(`${message}\n${JSON.stringify(details || {}, null, 2)}`);
};
const readJson = async (response) => {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return raw; }
};

async function counts(db, tenantId) {
  const result = {};
  for (const table of ["mizantra_governed_action_requests", "stock_movements"]) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (error) throw error;
    result[table] = Number(count || 0);
  }
  return result;
}

(async () => {
  assert(/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(baseUrl), `Refusing non-Mizantra URL: ${baseUrl}`);
  const databaseHost = new URL(process.env.DATABASE_URL).hostname;
  assert(databaseHost === "db.nwkaruzvzwwuftjquypk.supabase.co", `Refusing non-Mizantra database host: ${databaseHost}`);
  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.QA_USERNAME || "hnoman", password: process.env.QA_PASSWORD || "Password" }),
  });
  const login = await readJson(loginResponse);
  assert(loginResponse.ok && login?.accessToken, "Login failed", login);
  const tenantId = String(login.user?.tenantId || login.user?.tenant_id || "");
  const authorization = `Bearer ${login.accessToken}`;
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const [{ data: employees, error: employeeError }, { data: entries, error: entryError }] = await Promise.all([
    db.from("employees").select("id,employee_code,employee_name,status").eq("tenant_id", tenantId).eq("status", "ACTIVE").limit(100),
    db.from("stock_entries").select("item_id,available_quantity").eq("tenant_id", tenantId).gt("available_quantity", 0).limit(2000),
  ]);
  if (employeeError) throw employeeError;
  if (entryError) throw entryError;
  const totals = new Map();
  for (const row of entries || []) totals.set(row.item_id, (totals.get(row.item_id) || 0) + Number(row.available_quantity || 0));
  const itemIds = [...totals.keys()];
  const { data: items, error: itemError } = itemIds.length
    ? await db.from("items").select("id,code,name,uom,uid_tracking,uid_strategy,batch_quantity").eq("tenant_id", tenantId).in("id", itemIds.slice(0, 100))
    : { data: [], error: null };
  if (itemError) throw itemError;
  const employee = (employees || [])[0];
  const item = (items || []).find((row) => row.uid_tracking !== true || String(row.uid_strategy || "NONE").toUpperCase() === "NONE");
  assert(employee, "No active employee exists for manual SIV preview.");
  const beforeCounts = await counts(db, tenantId);
  const beforeBalances = JSON.stringify([...totals.entries()].sort());
  let message;
  let mode;
  if (item && totals.get(item.id) >= 1) {
    message = `Issue 1 ${item.uom || "nos"} ${item.code} to employee ${employee.employee_code || employee.employee_name} because QA custody preview`;
    mode = "POSITIVE_PREVIEW_NO_WRITES";
  } else {
    const fallback = (items || [])[0];
    assert(fallback, "No stocked item exists for manual SIV negative preview.");
    message = `Issue 1 ${fallback.uom || "nos"} ${fallback.code} to employee ${employee.employee_code || employee.employee_name} because QA custody preview`;
    mode = "NEGATIVE_UID_PREVIEW_NO_WRITES";
  }
  const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const preview = await readJson(response);
  assert(response.ok, "Manual SIV preview failed", preview);
  if (mode === "POSITIVE_PREVIEW_NO_WRITES") {
    assert(preview.status === "READY_TO_REQUEST_APPROVAL" && preview.proposed_action?.action_code === "CREATE_MANUAL_SIV" && !(preview.questions || []).length, "Manual SIV did not reach approval readiness", preview);
  } else {
    assert(preview.status === "NEEDS_INFORMATION" && !preview.proposed_action && (preview.questions || []).some((q) => /exact comma-separated UIDs/i.test(q)), "UID-tracked SIV was not safely blocked", preview);
  }
  const afterCounts = await counts(db, tenantId);
  const { data: afterEntries, error: afterEntryError } = await db.from("stock_entries").select("item_id,available_quantity").eq("tenant_id", tenantId).gt("available_quantity", 0).limit(2000);
  if (afterEntryError) throw afterEntryError;
  const afterTotals = new Map();
  for (const row of afterEntries || []) afterTotals.set(row.item_id, (afterTotals.get(row.item_id) || 0) + Number(row.available_quantity || 0));
  assert(JSON.stringify(beforeCounts) === JSON.stringify(afterCounts) && beforeBalances === JSON.stringify([...afterTotals.entries()].sort()), "Preview unexpectedly wrote SIV or stock data", { beforeCounts, afterCounts });
  const report = { pass: true, environment: "MIZANTRA TEST ONLY", database_host: databaseHost, mode, prompt: message, preview: { status: preview.status, action_code: preview.proposed_action?.action_code || null, questions: preview.questions }, controls: { independent_approval_required: true, exact_uid_input_required_when_tracked: true, no_governed_request_created: true, no_stock_or_siv_write: true }, record_counts_before: beforeCounts, record_counts_after: afterCounts };
  const output = path.join(process.cwd(), "artifacts", "qa", `active-planner-manual-siv-preview-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
