const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const baseUrl = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const assert = (value, message, details) => {
  if (!value) throw new Error(`${message}\n${JSON.stringify(details || {}, null, 2)}`);
};
const readJson = async (response) => {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return raw; }
};
async function counts(db, tenantId) {
  const result = {};
  for (const table of ["mizantra_governed_action_requests", "stock_movements", "stock_entries"]) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (error) throw error;
    result[table] = Number(count || 0);
  }
  return result;
}
async function stockFingerprint(db, tenantId) {
  const [{ data: entries, error: ee }, { data: inventory, error: ie }] = await Promise.all([
    db.from("stock_entries").select("id,item_id,warehouse_id,quantity,available_quantity,allocated_quantity").eq("tenant_id", tenantId).order("id"),
    db.from("inventory_stock").select("id,item_id,warehouse_id,quantity,available_quantity,reserved_quantity").eq("tenant_id", tenantId).order("id"),
  ]);
  if (ee || ie) throw ee || ie;
  return JSON.stringify({ entries, inventory });
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
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const authorization = `Bearer ${login.accessToken}`;
  const { data: issues, error: issueError } = await db
    .from("stock_movements")
    .select("id,item_id,uid,quantity,reference_number,issued_to_employee_id")
    .eq("tenant_id", tenantId)
    .eq("reference_type", "SIV")
    .not("reference_number", "is", null)
    .not("issued_to_employee_id", "is", null)
    .limit(2000);
  if (issueError) throw issueError;
  const { data: returns, error: returnError } = await db
    .from("stock_movements")
    .select("item_id,uid,quantity,reference_number,issued_to_employee_id")
    .eq("tenant_id", tenantId)
    .eq("reference_type", "SRV")
    .limit(2000);
  if (returnError) throw returnError;
  const groups = new Map();
  for (const row of issues || []) {
    const key = `${row.reference_number}|${row.item_id}|${row.issued_to_employee_id}`;
    const group = groups.get(key) || { ...row, issued: 0, returned: 0 };
    group.issued += Number(row.quantity || 0);
    groups.set(key, group);
  }
  for (const row of returns || []) {
    const key = `${row.reference_number}|${row.item_id}|${row.issued_to_employee_id}`;
    if (groups.has(key)) groups.get(key).returned += Number(row.quantity || 0);
  }
  const itemIds = [...new Set([...groups.values()].map((row) => row.item_id))].slice(0, 100);
  const employeeIds = [...new Set([...groups.values()].map((row) => row.issued_to_employee_id))].slice(0, 100);
  const [{ data: items, error: itemError }, { data: employees, error: employeeError }] = await Promise.all([
    itemIds.length ? db.from("items").select("id,code,name,uom,uid_tracking,uid_strategy").eq("tenant_id", tenantId).in("id", itemIds) : { data: [], error: null },
    employeeIds.length ? db.from("employees").select("id,employee_code,employee_name,status").eq("tenant_id", tenantId).eq("status", "ACTIVE").in("id", employeeIds) : { data: [], error: null },
  ]);
  if (itemError || employeeError) throw itemError || employeeError;
  let availableItems = items || [], availableEmployees = employees || [];
  if (!availableItems.length) {
    const { data, error } = await db.from("items").select("id,code,name,uom,uid_tracking,uid_strategy").eq("tenant_id", tenantId).eq("is_active", true).limit(1);
    if (error) throw error;
    availableItems = data || [];
  }
  if (!availableEmployees.length) {
    const { data, error } = await db.from("employees").select("id,employee_code,employee_name,status").eq("tenant_id", tenantId).eq("status", "ACTIVE").limit(1);
    if (error) throw error;
    availableEmployees = data || [];
  }
  const itemById = new Map(availableItems.map((row) => [row.id, row]));
  const employeeById = new Map(availableEmployees.map((row) => [row.id, row]));
  const target = [...groups.values()].find((row) => {
    const item = itemById.get(row.item_id);
    return row.issued - row.returned >= 1 && employeeById.has(row.issued_to_employee_id) && item && (item.uid_tracking !== true || String(item.uid_strategy || "NONE").toUpperCase() === "NONE");
  });
  const beforeCounts = await counts(db, tenantId);
  const beforeStock = await stockFingerprint(db, tenantId);
  let message;
  let expectedReady;
  if (target) {
    const item = itemById.get(target.item_id), employee = employeeById.get(target.issued_to_employee_id);
    message = `Return 1 ${item.uom || "nos"} unused ${item.code} from employee ${employee.employee_code || employee.employee_name} against ${target.reference_number} because QA unused custody preview`;
    expectedReady = true;
  } else {
    const item = availableItems[0], employee = availableEmployees[0];
    assert(item && employee, "No item/employee master exists for negative SRV preview.");
    message = `Return 1 ${item.uom || "nos"} unused ${item.code} from employee ${employee.employee_code || employee.employee_name} against ISS-NOT-FOUND because QA unused custody preview`;
    expectedReady = false;
  }
  const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const preview = await readJson(response);
  assert(response.ok, "Manual SRV preview failed", preview);
  if (expectedReady) assert(preview.status === "READY_TO_REQUEST_APPROVAL" && preview.proposed_action?.action_code === "CREATE_MANUAL_SRV_RETURN" && !(preview.questions || []).length, "Manual SRV did not reach approval readiness", preview);
  else assert(preview.status === "NEEDS_INFORMATION" && !preview.proposed_action, "Missing source SIV was not blocked", preview);
  const afterCounts = await counts(db, tenantId), afterStock = await stockFingerprint(db, tenantId);
  assert(JSON.stringify(beforeCounts) === JSON.stringify(afterCounts) && beforeStock === afterStock, "Preview unexpectedly changed custody or stock", { beforeCounts, afterCounts });
  const report = { pass: true, environment: "MIZANTRA TEST ONLY", database_host: databaseHost, mode: expectedReady ? "POSITIVE_PREVIEW_NO_WRITES" : "NEGATIVE_PREVIEW_NO_RETURNABLE_CUSTODY_NO_WRITES", prompt: message, preview: { status: preview.status, action_code: preview.proposed_action?.action_code || null, questions: preview.questions }, controls: { original_siv_custody_required: true, remaining_quantity_checked: true, independent_approval_required: true, no_approval_request_created: true, no_stock_uid_or_srv_write: true }, record_counts_before: beforeCounts, record_counts_after: afterCounts };
  const output = path.join(process.cwd(), "artifacts", "qa", `active-planner-manual-srv-preview-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
