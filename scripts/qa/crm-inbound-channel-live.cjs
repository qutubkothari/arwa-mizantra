#!/usr/bin/env node

const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.argv[2] || "apps/api/.env"), quiet: true });
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4001/api/v1";
const marker = `QA-CRM-INBOUND-${Date.now()}`;

const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
};
async function read(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return { raw: text.slice(0, 300) }; }
}

async function main() {
  const rawUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
  assert(rawUrl, "Database URL missing");
  const db = new Client({
    connectionString: rawUrl.replace(/([?&])sslmode=require(&|$)/, (_m, p, s) => s ? p : ""),
    ssl: { rejectUnauthorized: false },
  });
  let channelId;
  let leadId;
  let customerId;
  await db.connect();
  try {
    const loginResponse = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.QA_USERNAME || "hnoman", password: process.env.QA_PASSWORD || "Password" }) });
    const login = await read(loginResponse);
    assert(loginResponse.ok && login?.accessToken, "Login failed", login);
    const auth = { authorization: `Bearer ${login.accessToken}`, "content-type": "application/json" };
    const createResponse = await fetch(`${BASE}/crm/inbound-channels`, { method: "POST", headers: auth, body: JSON.stringify({ channel_code: "WEBSITE", channel_name: marker }) });
    const channel = await read(createResponse);
    assert(createResponse.ok && channel?.id && channel?.token, "Channel creation failed", channel);
    channelId = channel.id;
    const badResponse = await fetch(`${BASE}/crm/inbound/${channelId}`, { method: "POST", headers: { "content-type": "application/json", "x-mizantra-channel-token": "wrong" }, body: JSON.stringify({ external_id: marker, company_name: marker }) });
    assert(badResponse.status === 404, "Invalid channel token was not rejected", { status: badResponse.status });
    const payload = { external_id: marker, company_name: `${marker} Industries`, contact_name: "QA Contact", email: `${marker.toLowerCase()}@example.invalid`, message: "Need a governed product demonstration", product: "Mizantra ERP" };
    const firstResponse = await fetch(`${BASE}/crm/inbound/${channelId}`, { method: "POST", headers: { "content-type": "application/json", "x-mizantra-channel-token": channel.token }, body: JSON.stringify(payload) });
    const first = await read(firstResponse);
    assert(firstResponse.ok && first?.accepted && first?.lead_id && !first?.reused, "First inbound capture failed", first);
    leadId = first.lead_id;
    const repeatResponse = await fetch(`${BASE}/crm/inbound/${channelId}`, { method: "POST", headers: { "content-type": "application/json", "x-mizantra-channel-token": channel.token }, body: JSON.stringify(payload) });
    const repeat = await read(repeatResponse);
    assert(repeatResponse.ok && repeat?.reused && repeat?.lead_id === leadId, "Inbound idempotency failed", repeat);
    const rows = await db.query("SELECT l.owner_user_id, e.status FROM crm_leads l JOIN crm_inbound_events e ON e.lead_id=l.id WHERE l.id=$1 AND l.tenant_id=e.tenant_id", [leadId]);
    assert(rows.rowCount === 1 && rows.rows[0].owner_user_id, "Lead was not tenant-mapped and auto-assigned", rows.rows);
    const convertResponse = await fetch(`${BASE}/crm/leads/${leadId}/convert`, { method: "POST", headers: auth, body: "{}" });
    const converted = await read(convertResponse);
    assert(convertResponse.ok && converted?.customer?.id, "Lead conversion failed", converted);
    customerId = converted.customer.id;
    const viewResponse = await fetch(`${BASE}/crm/customers/${customerId}/360`, { headers: auth });
    const view = await read(viewResponse);
    assert(viewResponse.ok && view?.customer?.id === customerId, "Customer 360 failed", view);
    assert(view.crm?.leads?.some((lead) => lead.id === leadId), "Converted lead is absent from Customer 360", view.crm);
    assert(view.crm?.activities?.length > 0 && view.crm.activities.every((activity) => activity.customer_id === customerId), "CRM activity history was not linked to Customer 360", view.crm);
    const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='whatsapp_connections' AND column_name IN ('crm_capture_enabled','crm_capture_owner_id')");
    assert(columns.rowCount === 2, "WhatsApp CRM capture controls are missing");
    console.log(JSON.stringify({ status: "PASS", environment: "MIZANTRA ONLY", invalid_token_rejected: true, inbound_created: true, duplicate_reused: true, auto_assigned: true, conversion: true, customer_360_history: true, whatsapp_capture_controls: true }));
  } finally {
    if (channelId) {
      await db.query("DELETE FROM crm_inbound_events WHERE channel_id=$1", [channelId]).catch(() => undefined);
      if (leadId) await db.query("DELETE FROM crm_leads WHERE id=$1", [leadId]).catch(() => undefined);
      await db.query("DELETE FROM crm_inbound_channels WHERE id=$1", [channelId]).catch(() => undefined);
    }
    if (customerId) await db.query("DELETE FROM customers WHERE id=$1", [customerId]).catch(() => undefined);
    await db.end();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
