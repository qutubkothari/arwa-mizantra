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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

async function json(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}
function ok(value, message, details) {
  if (!value) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

(async () => {
  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const login = await json(loginResponse);
  ok(loginResponse.ok && login?.accessToken, `Login failed (${loginResponse.status}).`, login);
  const headers = { authorization: `Bearer ${login.accessToken}` };
  const [packsResponse, overviewResponse] = await Promise.all([
    fetch(`${BASE}/api/v1/production-standardization/configuration-packs`, { headers }),
    fetch(`${BASE}/api/v1/production-standardization/overview`, { headers }),
  ]);
  const packs = await json(packsResponse);
  const overview = await json(overviewResponse);
  ok(packsResponse.ok, `Configuration packs failed (${packsResponse.status}).`, packs);
  ok(overviewResponse.ok, `Production overview failed (${overviewResponse.status}).`, overview);
  const acDuct = (packs || []).find((row) => row.code === "AC_DUCT_BLUEPRINT");
  ok(acDuct, "AC duct configuration pack is missing.", packs);
  ok(Array.isArray(overview.work_stations), "Work-centre mapping data is unavailable.");
  ok(Array.isArray(overview.uom_conversions), "UOM conversion register is unavailable.");
  ok(Array.isArray(overview.configuration_mappings), "Configuration mapping register is unavailable.");
  console.log(JSON.stringify({
    status: "passed",
    target: BASE,
    pack: acDuct.code,
    counts: acDuct.counts,
    work_stations: overview.work_stations.length,
    uom_conversions: overview.uom_conversions.length,
    mappings: overview.configuration_mappings.length,
  }));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
