const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");

dotenv.config({ path: path.resolve(process.argv[2] || "apps/api/.env"), quiet: true });
const BASE = "https://mizantra.saksolution.com";
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error("DIRECT_URL or DATABASE_URL is required");
const url = new URL(raw);
["sslmode", "sslrootcert", "sslcert", "sslkey"].forEach((key) => url.searchParams.delete(key));

async function body(response) { const text = await response.text(); try { return text ? JSON.parse(text) : null; } catch { return text; } }
function assert(value, message, detail) { if (!value) throw new Error(`${message}: ${JSON.stringify(detail)}`); }

async function main() {
  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.QA_USERNAME || "hnoman", password: process.env.QA_PASSWORD || "Password" }) });
  const login = await body(loginResponse);
  assert(loginResponse.ok && login?.accessToken, "Login failed", login);
  const headers = { authorization: `Bearer ${login.accessToken}`, "content-type": "application/json" };
  const request = async (method, endpoint, payload) => {
    const response = await fetch(`${BASE}/api/v1${endpoint}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const data = await body(response);
    assert(response.ok, `${method} ${endpoint} failed`, data);
    return data;
  };
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ids = [];
  const db = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const inboundPayload = { source: "WEBSITE", source_external_id: `QA-WEB-${suffix}`, company_name: `QA inbound ${suffix}`, contact_person: "QA only", email: `qa-${suffix}@example.test` };
    const first = await request("POST", "/crm/leads/inbound", inboundPayload);
    ids.push(first.lead.id);
    const repeated = await request("POST", "/crm/leads/inbound", inboundPayload);
    assert(first.reused === false && repeated.reused === true && repeated.lead.id === first.lead.id, "Inbound idempotency failed", { first, repeated });

    const importPayload = { rows: [{ source_external_id: `QA-IMPORT-${suffix}`, company_name: `QA import ${suffix}`, email: `qa-import-${suffix}@example.test` }] };
    const imported = await request("POST", "/crm/leads/import", importPayload);
    const importedAgain = await request("POST", "/crm/leads/import", importPayload);
    assert(imported.created.length === 1 && importedAgain.reused.length === 1, "Import idempotency failed", { imported, importedAgain });
    const importedLead = (await db.query("SELECT id FROM crm_leads WHERE tenant_id=$1 AND lead_number=$2", [first.lead.tenant_id, imported.created[0]])).rows[0];
    assert(importedLead?.id, "Imported lead was not stored", imported);
    ids.push(importedLead.id);

    const merged = await request("POST", `/crm/leads/${first.lead.id}/merge`, { target_lead_id: importedLead.id, reason: "Automated QA merge; cleaned after test" });
    assert(merged.id === importedLead.id, "Merge did not retain the requested target", merged);
    const source = (await db.query("SELECT merged_into_lead_id FROM crm_leads WHERE id=$1", [first.lead.id])).rows[0];
    assert(source?.merged_into_lead_id === importedLead.id, "Merged source was not linked", source);
    console.log(JSON.stringify({ status: "PASS", environment: "MIZANTRA ONLY", inbound_idempotency: true, import_idempotency: true, merge: true, cleanup: "PENDING" }));
  } finally {
    if (ids.length) {
      await db.query("DELETE FROM crm_leads WHERE id = ANY($1::uuid[])", [ids]).catch(async () => {
        await db.query("UPDATE crm_leads SET merged_into_lead_id=NULL WHERE id = ANY($1::uuid[])", [ids]);
        await db.query("DELETE FROM crm_leads WHERE id = ANY($1::uuid[])", [ids]);
      });
    }
    await db.end();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
