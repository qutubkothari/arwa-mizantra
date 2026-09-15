const fs = require("fs");
const path = require("path");

const base = (process.env.QA_BASE_URL || "https://mizantra.ae").replace(
  /\/$/,
  "",
);
const prompt = process.argv.slice(2).join(" ");
if (!prompt) throw new Error("Provide a prompt to inspect");

for (const line of fs
  .readFileSync(path.resolve("apps/api/.env.test"), "utf8")
  .replace(/\r/g, "")
  .split("\n")) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]])
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}

async function body(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function main() {
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const auth = await body(login);
  if (!login.ok || !auth?.accessToken) throw new Error("Login failed");
  const response = await fetch(`${base}/api/v1/active-planner/interpret`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ message: prompt }),
  });
  const data = await body(response);
  console.log(
    JSON.stringify(
      {
        http: response.status,
        prompt,
        conversation_id: data?.conversation_id,
        intent_type: data?.intent_type,
        status: data?.status,
        questions: data?.questions,
        assistant_message: data?.assistant_message,
        extracted: data?.extracted,
        resolved: data?.resolved,
        analytics: data?.analytics,
      },
      null,
      2,
    ),
  );

  const tenantId = auth.user?.tenantId || auth.user?.tenant_id;
  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (data?.conversation_id && tenantId && serviceKey) {
    await fetch(
      `${String(process.env.SUPABASE_URL).replace(/\/$/, "")}/rest/v1/active_planner_conversations?tenant_id=eq.${tenantId}&id=eq.${data.conversation_id}`,
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

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
