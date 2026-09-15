#!/usr/bin/env node

const BASE = "https://mizantra.saksolution.com";

async function json(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { throw new Error(`Non-JSON response ${response.status}: ${text.slice(0, 200)}`); }
}

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ""}`);
}

async function main() {
  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.QA_USERNAME || "hnoman", password: process.env.QA_PASSWORD || "Password" }),
  });
  const login = await json(loginResponse);
  assert(loginResponse.ok && login?.accessToken, "Mizantra login failed.", login);
  const headers = { authorization: `Bearer ${login.accessToken}`, "content-type": "application/json" };

  const dashboardResponse = await fetch(`${BASE}/api/v1/crm/dashboard`, { headers });
  const dashboard = await json(dashboardResponse);
  assert(dashboardResponse.ok, "CRM dashboard failed.", dashboard);
  assert(Array.isArray(dashboard.notifications), "CRM reminders were not returned.", dashboard);
  assert(Array.isArray(dashboard.metadata?.users), "CRM user metadata is missing.", dashboard);
  assert(dashboard.readiness && typeof dashboard.readiness.ready === "boolean", "CRM readiness is missing.", dashboard);
  assert(Array.isArray(dashboard.readiness.warnings), "CRM readiness warnings are missing.", dashboard.readiness);

  const prompts = [
    "Please capture Bluewater Navigation as a new prospect, contact is Sameer and phone is 9000012345",
    "Schedule a follow up with AquaSense Marine Systems next Friday to discuss the proposal",
    "Move DesertLine Components India into negotiation stage",
  ];
  const results = [];
  for (const message of prompts) {
    const response = await fetch(`${BASE}/api/v1/active-planner/interpret`, {
      method: "POST", headers, body: JSON.stringify({ message }),
    });
    const data = await json(response);
    assert(response.ok, `Planner failed for: ${message}`, data);
    assert(data.intent_type === "CRM_ACTION", `Planner did not understand the CRM action: ${message}`, data);
    assert(["READY_TO_CREATE_DRAFT", "NEEDS_INFORMATION"].includes(data.status), "Planner returned an unsafe CRM state.", data);
    results.push({ message, status: data.status, action: data.extracted?.crm_action, extracted: data.extracted, questions: data.questions || [] });
  }

  const converted = dashboard.leads.find((lead) => lead.customer_id);
  let customer360 = "NO_CONVERTED_DEMO_LEAD";
  if (converted) {
    const response = await fetch(`${BASE}/api/v1/crm/customers/${converted.customer_id}/360`, { headers });
    const data = await json(response);
    assert(response.ok && data?.customer?.id === converted.customer_id, "Customer 360 failed.", data);
    customer360 = "PASS";
  }

  console.log(JSON.stringify({
    status: "PASS",
    environment: "MIZANTRA ONLY",
    leads: dashboard.leads.length,
    reminders: dashboard.notifications.length,
    customer360,
    readiness: dashboard.readiness,
    prompts: results,
  }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
