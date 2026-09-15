const fs = require("fs");
const path = require("path");
const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
if (!/^https:\/\/(mizantra\.saksolution\.com|mizantra\.ae)\/?$/i.test(BASE))
  throw new Error(`Refusing non-Mizantra URL: ${BASE}`);
for (const file of ["apps/api/.env", "apps/api/.env.test"]) {
  const absolute = path.resolve(process.cwd(), file);
  if (!fs.existsSync(absolute)) continue;
  for (const line of fs.readFileSync(absolute, "utf8").replace(/\r/g, "").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
async function body(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}
(async () => {
  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.QA_USERNAME || "hnoman", password: process.env.QA_PASSWORD || "Password" }),
  });
  const login = await body(loginResponse);
  if (!loginResponse.ok || !login?.accessToken) throw new Error(`Mizantra login failed (${loginResponse.status}).`);
  const response = await fetch(`${BASE}/api/v1/production-standardization/configuration-packs/AC_DUCT_BLUEPRINT/install`, {
    method: "POST",
    headers: { authorization: `Bearer ${login.accessToken}`, "content-type": "application/json" },
    body: "{}",
  });
  const result = await body(response);
  if (!response.ok || result?.status !== "DRAFT") throw new Error(`Draft installation failed (${response.status}): ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ status: "passed", target: BASE, pack: result.pack?.code, installed: result.installed, preserved_existing: result.preserved_existing, lifecycle: result.status }));
})().catch((error) => { console.error(error.message); process.exit(1); });
