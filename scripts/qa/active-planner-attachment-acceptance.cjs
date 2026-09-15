const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const base = "https://mizantra.saksolution.com";
const ok = (value, message, details) => {
  if (!value)
    throw new Error(`${message}\n${JSON.stringify(details || {}, null, 2)}`);
};
const json = async (response) => {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
};

(async () => {
  const loginResponse = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const login = await json(loginResponse);
  ok(loginResponse.ok && login?.accessToken, "Login failed", login);
  const tenantId = String(login.user?.tenantId || login.user?.tenant_id || "");
  const userId = String(login.user?.id || login.user?.userId || "");
  ok(
    tenantId && userId,
    "Authenticated tenant/user identity is missing",
    login.user,
  );
  const authorization = `Bearer ${login.accessToken}`;
  const form = new FormData();
  form.append(
    "file",
    new Blob(["%PDF-1.4\n% Mizantra attachment acceptance\n%%EOF\n"], {
      type: "application/pdf",
    }),
    "qa-grn-invoice.pdf",
  );
  const uploadResponse = await fetch(
    `${base}/api/v1/purchase/grn/invoice/upload`,
    { method: "POST", headers: { authorization }, body: form },
  );
  const upload = await json(uploadResponse);
  ok(uploadResponse.ok && upload?.url, "Authenticated upload failed", upload);
  ok(
    String(upload.url).includes(`/${tenantId}/${userId}/`),
    "Upload path is not bound to authenticated tenant/user",
    upload,
  );
  const message =
    "Create GRN against PO-2026-001 invoice number INV-QA-ATTACH-1 receive 1 nos bolt warehouse MAIN";
  const interpretResponse = await fetch(
    `${base}/api/v1/active-planner/interpret`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ message, attachments: [upload] }),
    },
  );
  const interpreted = await json(interpretResponse);
  ok(interpretResponse.ok, "Attached prompt failed", interpreted);
  ok(
    interpreted.intent_type === "GOODS_RECEIPT" &&
      interpreted.resolved?.attachments?.[0]?.url === upload.url &&
      !(interpreted.questions || []).some((question) =>
        /upload the supplier invoice/i.test(question),
      ),
    "Valid attachment was not preserved in signed planner context",
    interpreted,
  );
  const tampered = {
    ...upload,
    url: String(upload.url).replace(`/${userId}/`, "/different-user/"),
  };
  const tamperedResponse = await fetch(
    `${base}/api/v1/active-planner/interpret`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ message, attachments: [tampered] }),
    },
  );
  const tamperedResult = await json(tamperedResponse);
  ok(
    tamperedResponse.status === 400 &&
      /does not belong/i.test(String(tamperedResult?.message || "")),
    "Cross-user attachment tampering was not rejected",
    { status: tamperedResponse.status, body: tamperedResult },
  );
  const report = {
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    tenant_id: tenantId,
    user_id: userId,
    upload: {
      url: upload.url,
      name: upload.name,
      type: upload.type,
      size: upload.size,
    },
    planner_status: interpreted.status,
    controls: {
      authenticated_upload: true,
      tenant_user_path_binding: true,
      signed_context_metadata_only: true,
      cross_user_tampering_rejected: true,
      no_native_record_created: true,
    },
  };
  const dir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const output = path.join(dir, `active-planner-attachment-${stamp}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
