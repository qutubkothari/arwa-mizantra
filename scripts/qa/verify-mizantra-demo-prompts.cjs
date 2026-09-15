const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";

if (!/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE)) {
  throw new Error(`Refusing non-Mizantra URL: ${BASE}`);
}

async function json(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function main() {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const auth = await json(login);
  if (!login.ok || !auth?.accessToken)
    throw new Error("Mizantra login failed.");

  const prompts = [
    "Show the production plan for DEMO-SO-PLANNER-001",
    "Inspect batch MIZ-DEMO-BATCH-001 for QA-DRONE-27125043",
    "Show document flow for SO-000031",
    "Show the invoice and payment for INV-2026-000013",
  ];
  const results = [];
  for (const message of prompts) {
    const response = await fetch(`${BASE}/api/v1/active-planner/interpret`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message }),
    });
    const data = await json(response);
    if (!response.ok) {
      throw new Error(`${message}: ${JSON.stringify(data)}`);
    }
    results.push({
      prompt: message,
      provider: data?.provider,
      intent: data?.intent_type,
      status: data?.status,
      missing_fields: data?.missing_fields || [],
      follow_up_questions: data?.follow_up_questions || [],
    });
  }
  console.log(
    JSON.stringify(
      {
        pass: true,
        environment: "MIZANTRA ONLY",
        interpretation_only: true,
        records_created: 0,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
