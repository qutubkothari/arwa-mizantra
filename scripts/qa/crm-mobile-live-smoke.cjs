const { chromium, devices } = require("playwright");

const BASE = "https://mizantra.saksolution.com";

async function main() {
  const loginResponse = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.QA_USERNAME || "hnoman", password: process.env.QA_PASSWORD || "Password" }),
  });
  if (!loginResponse.ok) throw new Error(`Login failed: ${loginResponse.status}`);
  const auth = await loginResponse.json();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...devices["iPhone 12"] });
    await context.addInitScript((session) => {
      localStorage.setItem("accessToken", session.accessToken);
      localStorage.setItem("refreshToken", session.refreshToken);
      localStorage.setItem("user", JSON.stringify(session.user));
      localStorage.setItem("userId", session.user.id);
    }, auth);
    const page = await context.newPage();
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(`${BASE}/dashboard/crm`, { waitUntil: "networkidle", timeout: 60000 });
    const heading = page.getByRole("heading", { name: "Intelligent CRM" });
    if (!(await heading.isVisible().catch(() => false))) {
      throw new Error(`CRM page did not open. URL=${page.url()} text=${(await page.locator("body").innerText()).slice(0, 500)}`);
    }
    const result = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      verticalScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }));
    result.newLead = await page.getByRole("button", { name: /New lead/i }).isVisible();
    result.importCsv = await page.getByText("Import CSV", { exact: true }).isVisible();
    result.pipeline = await page.getByRole("button", { name: /Pipeline/i }).isVisible();
    await page.getByRole("button", { name: /Assignment rules/i }).click();
    result.secureIntake = await page.getByRole("heading", { name: /Website, email and API lead channels/i }).isVisible();
    result.readinessChecklist = await page.getByRole("heading", { name: /CRM readiness checklist/i }).isVisible();
    result.ownerSearch = await page.getByPlaceholder(/Search owner name or email/i).isVisible();
    const rulesWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth }));
    result.browserErrors = browserErrors;
    if (result.documentWidth > result.viewport + 2) throw new Error(`CRM has horizontal mobile overflow: ${JSON.stringify(result)}`);
    if (rulesWidth.documentWidth > rulesWidth.viewport + 2) throw new Error(`CRM rules have horizontal mobile overflow: ${JSON.stringify(rulesWidth)}`);
    if (!result.newLead || !result.importCsv || !result.pipeline || !result.secureIntake || !result.readinessChecklist || !result.ownerSearch || browserErrors.length) throw new Error(`CRM mobile controls failed: ${JSON.stringify(result)}`);
    console.log(JSON.stringify({ status: "PASS", environment: "MIZANTRA ONLY", ...result }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
