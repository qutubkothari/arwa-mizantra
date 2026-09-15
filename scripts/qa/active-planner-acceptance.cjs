const BASE = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
if (!/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE))
  throw new Error("Refusing outside Mizantra TEST.");
const ok = (v, m, d) => {
  if (!v)
    throw new Error(
      `${m}${d === undefined ? "" : `\n${JSON.stringify(d, null, 2)}`}`,
    );
};
async function call(path, options = {}) {
  const r = await fetch(`${BASE}${path}`, options),
    t = await r.text();
  let d;
  try {
    d = t ? JSON.parse(t) : null;
  } catch {
    d = t;
  }
  return { r, d };
}
(async () => {
  const login = await call("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  ok(login.r.ok && login.d.accessToken, "Login failed", login.d);
  const headers = {
    authorization: `Bearer ${login.d.accessToken}`,
    "content-type": "application/json",
  };
  const features = await call("/api/v1/features/me", { headers });
  ok(
    features.r.ok && features.d?.enabled_features?.includes("active-planner"),
    "Active Planner feature entitlement is not enabled.",
    features.d,
  );
  const capabilities = await call("/api/v1/active-planner/capabilities", {
    method: "POST",
    headers,
    body: "{}",
  });
  ok(
    capabilities.r.ok && capabilities.d?.capabilities?.length >= 28,
    "Universal capability catalogue is incomplete.",
    capabilities.d,
  );
  const po = await call("/api/v1/active-planner/interpret", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: "create a PO for Asons with 100 ctns 8x80",
    }),
  });
  ok(po.r.ok, "PO prompt failed", po.d);
  ok(
    po.d.intent_type === "PURCHASE_ORDER" &&
      Number(po.d.extracted.quantity) === 100 &&
      po.d.extracted.uom === "CTN",
    "PO extraction failed",
    po.d,
  );
  ok(
    po.d.safety?.creates_draft_only && po.d.safety?.approval_unchanged,
    "PO safety boundary missing",
    po.d,
  );
  const invoice = await call("/api/v1/active-planner/interpret", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: "create an invoice for MOD for 100 drones for 10lacs each",
    }),
  });
  ok(invoice.r.ok, "Invoice prompt failed", invoice.d);
  ok(
    invoice.d.intent_type === "SALES_INVOICE" &&
      Number(invoice.d.extracted.quantity) === 100 &&
      Number(invoice.d.extracted.unit_price) === 1000000,
    "Invoice extraction failed",
    invoice.d,
  );
  ok(
    invoice.d.safety?.invoice_requires_sales_dispatch_chain,
    "Invoice chain guard missing",
    invoice.d,
  );
  const cases = [
    ["Plan 100 drones for SO-100 by 30-09-2026", "PRODUCTION_PLAN"],
    ["Raise NCR for 5 rejected impellers", "QUALITY_NCR"],
    ["Prepare August payroll", "PAYROLL_RUN"],
    ["Show overdue POs by supplier", "REPORT"],
  ];
  for (const [message, intent] of cases) {
    const value = await call("/api/v1/active-planner/interpret", {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
    });
    ok(
      value.r.ok && value.d.intent_type === intent,
      `${intent} routing failed`,
      value.d,
    );
    ok(
      value.d.capability?.route && value.d.safety?.approval_unchanged,
      `${intent} governance metadata missing`,
      value.d,
    );
  }
  const page = await fetch(`${BASE}/dashboard/active-planner`);
  ok(page.ok, `Active Planner page returned ${page.status}`);
  console.log(
    JSON.stringify(
      {
        pass: true,
        environment: "MIZANTRA TEST ONLY",
        capability_count: capabilities.d.capabilities.length,
        po: {
          status: po.d.status,
          questions: po.d.questions,
          resolved_vendor: po.d.resolved?.counterparty?.name || null,
          resolved_item: po.d.resolved?.item?.code || null,
        },
        invoice: {
          status: invoice.d.status,
          questions: invoice.d.questions,
          readiness: invoice.d.resolved?.invoice_readiness || null,
        },
        universal_intents: cases.map((x) => x[1]),
        page_status: page.status,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
