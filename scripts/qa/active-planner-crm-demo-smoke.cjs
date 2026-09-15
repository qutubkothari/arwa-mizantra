#!/usr/bin/env node

const BASE = (process.env.QA_BASE_URL || "https://mizantra.saksolution.com").replace(/\/$/, "");

function fail(message, detail) {
  console.error(JSON.stringify({ status: "FAIL", message, detail }, null, 2));
  process.exit(1);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    fail("Endpoint did not return JSON.", { status: response.status, body: text.slice(0, 500) });
  }
}

function metric(answer, label) {
  return answer?.metrics?.find((entry) => entry.label === label)?.value;
}

async function main() {
  if (BASE !== "https://mizantra.saksolution.com") {
    fail("This smoke test is restricted to the Mizantra environment.", { base: BASE });
  }

  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const login = await readJson(loginResponse);
  if (!loginResponse.ok || !login?.accessToken) fail("Mizantra login failed.", login);

  const ask = async (message) => {
    const response = await fetch(`${BASE}/api/v1/active-planner/interpret`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message }),
    });
    const data = await readJson(response);
    if (!response.ok) fail(`Prompt failed: ${message}`, data);
    return data;
  };

  const cases = [
    {
      prompt: "Show me our CRM pipeline and weighted sales forecast",
      kind: "CRM_PIPELINE",
      assertions: (analytics) =>
        Number(metric(analytics, "Open leads")) === 7 &&
        Number(metric(analytics, "Pipeline value")) === 15150000 &&
        Number(metric(analytics, "Weighted forecast")) === 9417500,
    },
    {
      prompt: "Which prospects need a follow up today?",
      kind: "CRM_FOLLOWUPS",
      assertions: (analytics) =>
        Number(metric(analytics, "Follow-ups due")) === 3 && analytics?.rows?.length === 3,
    },
  ];

  const results = [];
  for (const testCase of cases) {
    const data = await ask(testCase.prompt);
    if (data.status !== "READY_WITH_ANALYTICS" || data.analytics?.kind !== testCase.kind) {
      fail(`${testCase.kind} was not routed to CRM analytics.`, data);
    }
    if (data.analytics?.read_only !== true || !data.analytics?.sources?.length) {
      fail(`${testCase.kind} violated the governed analytics contract.`, data.analytics);
    }
    if (!testCase.assertions(data.analytics)) {
      fail(`${testCase.kind} returned unexpected demo figures.`, data.analytics);
    }
    results.push({
      prompt: testCase.prompt,
      provider: data.provider,
      kind: data.analytics.kind,
      headline: data.analytics.headline,
      metrics: data.analytics.metrics,
      rows: data.analytics.rows.length,
    });
  }

  console.log(JSON.stringify({ status: "PASS", environment: "MIZANTRA ONLY", results }, null, 2));
}

main().catch((error) => fail(error.message, error.stack));
