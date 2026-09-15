const fs = require("fs");
const path = require("path");

const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const EXPECTED_DB = "nwkaruzvzwwuftjquypk.supabase.co";
const CAMPAIGN = "MIZANTRA_CRM_DEMO_V1";
const RULE_NAME = "Mizantra Demo Default Sales Queue";

function assert(value, message, details) {
  if (!value) throw new Error(`${message}${details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`}`);
}

function loadEnv() {
  for (const file of [
    path.join(process.cwd(), "apps/api/.env.test"),
    path.join(process.cwd(), "apps/api/.env"),
    path.join(process.cwd(), ".env"),
  ]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n")) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function login() {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const data = await readJson(response);
  assert(response.ok && data?.accessToken, "Mizantra CRM demo login failed.", data);
  return data;
}

async function api(token, method, endpoint, body, allowed = [200, 201]) {
  const response = await fetch(`${BASE}/api/v1${endpoint}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(response);
  assert(allowed.includes(response.status), `${method} ${endpoint} returned ${response.status}.`, data);
  return data;
}

function isoDateTime(offsetDays, hour = 10) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  date.setUTCHours(hour, 30, 0, 0);
  return date.toISOString();
}

function isoDate(offsetDays) {
  return isoDateTime(offsetDays).slice(0, 10);
}

const prospects = [
  {
    company_name: "AquaSense Marine Systems [DEMO]",
    contact_person: "Arif Merchant",
    email: "arif.aquasense@example.test",
    phone: "+91 90000 11001",
    source: "WEBSITE",
    territory: "Mumbai",
    industry: "Marine Equipment",
    product_interest: "Smart pump monitoring and preventive service",
    requirement: "Monitor pumps across three vessels and alert the maintenance team before failures.",
    expected_value: 1850000,
    priority: "HIGH",
    next_follow_up_at: isoDateTime(-1),
    expected_close_date: isoDate(24),
    stage: "QUALIFIED",
  },
  {
    company_name: "DesertLine Components India [DEMO]",
    contact_person: "Neha Shah",
    email: "neha.desertline@example.test",
    phone: "+91 90000 11002",
    source: "EXHIBITION",
    territory: "Pune",
    industry: "Industrial Components",
    product_interest: "Production planning and supplier quality",
    requirement: "Replace spreadsheet planning and connect supplier inspection with production release.",
    expected_value: 2400000,
    priority: "URGENT",
    next_follow_up_at: isoDateTime(0),
    expected_close_date: isoDate(18),
    stage: "REQUIREMENT",
  },
  {
    company_name: "GreenForge Precision Works [DEMO]",
    contact_person: "Rohan Kulkarni",
    email: "rohan.greenforge@example.test",
    phone: "+91 90000 11003",
    source: "REFERRAL",
    territory: "Ahmedabad",
    industry: "Precision Manufacturing",
    product_interest: "Complete MRP and job-order execution",
    requirement: "Plan made-to-order components with material, machine and subcontracting visibility.",
    expected_value: 3200000,
    priority: "HIGH",
    next_follow_up_at: isoDateTime(2),
    expected_close_date: isoDate(30),
    stage: "QUOTATION",
  },
  {
    company_name: "NovaGrid Energy Solutions [DEMO]",
    contact_person: "Fatema Contractor",
    email: "fatema.novagrid@example.test",
    phone: "+91 90000 11004",
    source: "CAMPAIGN",
    territory: "Hyderabad",
    industry: "Energy Systems",
    product_interest: "ERP, CRM and field service transformation",
    requirement: "Unify sales, project production, UID deployment, warranty and field service.",
    expected_value: 4800000,
    priority: "HIGH",
    next_follow_up_at: isoDateTime(3),
    expected_close_date: isoDate(15),
    stage: "NEGOTIATION",
  },
  {
    company_name: "CoastGuard Fabrication Lab [DEMO]",
    contact_person: "Sameer Qureshi",
    email: "sameer.coastguard@example.test",
    phone: "+91 90000 11005",
    source: "EMAIL",
    territory: "Visakhapatnam",
    industry: "Marine Fabrication",
    product_interest: "Subcontracting and inspection control",
    requirement: "Control outside processing material, receipts, quality and vendor payable traceability.",
    expected_value: 900000,
    priority: "MEDIUM",
    next_follow_up_at: isoDateTime(-2),
    expected_close_date: isoDate(40),
    stage: "CONTACTED",
  },
  {
    company_name: "Apex Motion Controls [DEMO]",
    contact_person: "Jignesh Mehta",
    email: "jignesh.apex@example.test",
    phone: "+91 90000 11006",
    source: "PHONE",
    territory: "Rajkot",
    industry: "Automation",
    product_interest: "Inventory and purchase automation",
    requirement: "Improve reorder planning, purchase approvals and supplier price visibility.",
    expected_value: 750000,
    priority: "MEDIUM",
    next_follow_up_at: isoDateTime(1),
    expected_close_date: isoDate(45),
    stage: "ASSIGNED",
  },
  {
    company_name: "BlueHarbor Industrial Services [DEMO]",
    contact_person: "Mariam Ali",
    email: "mariam.blueharbor@example.test",
    phone: "+91 90000 11007",
    source: "WHATSAPP",
    territory: "Kochi",
    industry: "Industrial Service",
    product_interest: "Installed assets, warranty and AMC",
    requirement: "Track commissioned equipment and automate warranty or contract entitlement at ticket creation.",
    expected_value: 1250000,
    priority: "LOW",
    next_follow_up_at: isoDateTime(7),
    expected_close_date: isoDate(60),
    stage: "ON_HOLD",
  },
];

async function main() {
  loadEnv();
  assert(/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE), `Refusing non-Mizantra URL: ${BASE}`);
  const databaseHost = new URL(process.env.SUPABASE_URL || "").hostname;
  assert(databaseHost === EXPECTED_DB, `Refusing non-Mizantra database: ${databaseHost}`);

  const session = await login();
  const token = session.accessToken;
  const tenantId = session.user?.tenantId || session.user?.tenant_id;
  const userId = session.user?.id || session.user?.userId;
  assert(tenantId && userId, "Authenticated tenant or user is unavailable.", session.user);

  let metadata = await api(token, "GET", "/crm/metadata");
  if (!(metadata.assignment_rules || []).some((rule) => rule.rule_name === RULE_NAME)) {
    await api(token, "POST", "/crm/assignment-rules", {
      rule_name: RULE_NAME,
      priority: 100,
      strategy: "LOAD_BALANCED",
      assignee_user_ids: [userId],
      is_active: true,
    });
  }
  metadata = await api(token, "GET", "/crm/metadata");
  const stages = new Map((metadata.stages || []).map((stage) => [stage.stage_code, stage]));
  for (const code of prospects.map((prospect) => prospect.stage)) assert(stages.has(code), `CRM stage ${code} is missing.`);

  const existing = await api(token, "GET", "/crm/leads");
  const byCompany = new Map(existing.filter((lead) => lead.campaign === CAMPAIGN).map((lead) => [lead.company_name, lead]));
  const created = [];
  const reused = [];

  for (const prospect of prospects) {
    let lead = byCompany.get(prospect.company_name);
    if (!lead) {
      lead = await api(token, "POST", "/crm/leads", {
        ...prospect,
        stage: undefined,
        campaign: CAMPAIGN,
        currency_code: "INR",
      });
      created.push(lead.lead_number);
    } else {
      reused.push(lead.lead_number);
    }
    const desired = stages.get(prospect.stage);
    if (String(lead.stage_id) !== String(desired.id)) {
      lead = await api(token, "POST", `/crm/leads/${lead.id}/stage`, {
        stage_id: desired.id,
        reason: "Mizantra CRM client-demo pipeline scenario.",
      });
    }
    const details = await api(token, "GET", `/crm/leads/${lead.id}`);
    const activitySubject = `${CAMPAIGN}: discovery and next action`;
    if (!(details.activities || []).some((activity) => activity.subject === activitySubject)) {
      await api(token, "POST", `/crm/leads/${lead.id}/activities`, {
        activity_type: prospect.stage === "QUOTATION" ? "DEMO" : "FOLLOW_UP",
        direction: "OUTBOUND",
        subject: activitySubject,
        notes: "Synthetic demonstration activity. Confirm requirement, decision process, timeline and next action.",
        scheduled_at: prospect.next_follow_up_at,
        owner_user_id: lead.owner_user_id || userId,
      });
    }
  }

  const dashboard = await api(token, "GET", "/crm/dashboard");
  const demoLeads = dashboard.leads.filter((lead) => lead.campaign === CAMPAIGN);
  assert(demoLeads.length === prospects.length, `Expected ${prospects.length} demo leads, found ${demoLeads.length}.`);
  assert(demoLeads.every((lead) => Number(lead.lead_score) > 0), "One or more demo leads has no explainable score.");
  assert(demoLeads.every((lead) => lead.owner_user_id), "One or more demo leads is unassigned.");

  console.log(JSON.stringify({
    status: "PASS",
    environment: "MIZANTRA ONLY",
    tenant_id: tenantId,
    campaign: CAMPAIGN,
    created,
    reused,
    demo_leads: demoLeads.length,
    stages_represented: [...new Set(demoLeads.map((lead) => lead.stage?.stage_code))],
    scores: demoLeads.map((lead) => ({ lead: lead.lead_number, score: Number(lead.lead_score) })),
    dashboard: dashboard.kpis,
    follow_up_actions: dashboard.recommended_actions.length,
    assignment_rule: RULE_NAME,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
