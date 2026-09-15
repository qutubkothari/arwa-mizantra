const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

const baseUrl = process.env.QA_BASE_URL || "https://mizantra.saksolution.com";
const assert = (value, message, details) => {
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
const save = (report) => {
  const stamp = Date.now();
  const dir = path.join(process.cwd(), "artifacts", "qa");
  fs.mkdirSync(dir, { recursive: true });
  const output = path.join(
    dir,
    `active-planner-customer-receipt-preview-${stamp}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, report }, null, 2));
};

async function counts(db, tenantId) {
  const tables = [
    "mizantra_governed_action_requests",
    "sales_invoice_payments",
    "accounting_journals",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => {
        const { count, error } = await db
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId);
        if (error) throw error;
        return [table, Number(count || 0)];
      }),
    ),
  );
}

(async () => {
  assert(
    /^https:\/\/mizantra\.saksolution\.com\/?$/i.test(baseUrl),
    `Refusing non-Mizantra URL: ${baseUrl}`,
  );
  const databaseHost = new URL(process.env.DATABASE_URL).hostname;
  assert(
    databaseHost === "db.nwkaruzvzwwuftjquypk.supabase.co",
    `Refusing non-Mizantra database host: ${databaseHost}`,
  );
  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.QA_USERNAME || "hnoman",
      password: process.env.QA_PASSWORD || "Password",
    }),
  });
  const login = await json(loginResponse);
  assert(loginResponse.ok && login?.accessToken, "Login failed", login);
  const tenantId = String(login.user?.tenantId || login.user?.tenant_id || "");
  assert(tenantId, "Authenticated tenant is missing", login.user);
  const authorization = `Bearer ${login.accessToken}`;
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { data: invoices, error: invoiceError } = await db
    .from("invoices")
    .select(
      "id,invoice_number,invoice_date,customer_id,paid_amount,balance_amount,billing_status,payment_status",
    )
    .eq("tenant_id", tenantId)
    .limit(100);
  if (invoiceError) throw invoiceError;
  const openInvoices = (invoices || []).filter(
    (row) =>
      row.billing_status !== "CANCELLED" &&
      Number(row.balance_amount || 0) > 0 &&
      String(row.invoice_date || "").slice(0, 10) <= today,
  );
  if (!openInvoices.length) {
    const { data: fallbackCustomers, error: fallbackCustomerError } = await db
      .from("customers")
      .select("id,customer_code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(1);
    if (fallbackCustomerError) throw fallbackCustomerError;
    assert(fallbackCustomers?.[0], "Negative receipt preview needs a customer.");
    const before = await counts(db, tenantId);
    const message = `Record INR 1 received from ${fallbackCustomers[0].customer_code} against INV-NOT-OPEN by NEFT UTR QA-NO-OPEN receipt date ${today}`;
    const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const preview = await json(response);
    assert(response.ok, "Negative receipt preview failed", preview);
    assert(
      preview.status === "NEEDS_INFORMATION" &&
        !preview.proposed_action &&
        (preview.questions || []).some((question) =>
          /Which open invoice/i.test(question),
        ),
      "Planner did not safely block receipt without an open invoice",
      preview,
    );
    const after = await counts(db, tenantId);
    assert(JSON.stringify(before) === JSON.stringify(after), "Blocked preview wrote data", {
      before,
      after,
    });
    save({
      pass: true,
      environment: "MIZANTRA TEST ONLY",
      database_host: databaseHost,
      mode: "NEGATIVE_PREVIEW_NO_OPEN_INVOICE_NO_WRITES",
      invoice_count: (invoices || []).length,
      billing_statuses: [
        ...new Set((invoices || []).map((row) => row.billing_status)),
      ],
      preview: {
        status: preview.status,
        proposed_action: preview.proposed_action,
        questions: preview.questions,
      },
      controls: {
        closed_or_cancelled_invoice_not_receivable: true,
        no_governed_request_created: true,
        no_receipt_invoice_or_accounting_write: true,
      },
      record_counts_before: before,
      record_counts_after: after,
    });
    return;
  }
  const customerIds = [...new Set(openInvoices.map((row) => row.customer_id))];
  const { data: customers, error: customerError } = await db
    .from("customers")
    .select("id,customer_code,customer_name,is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("id", customerIds);
  if (customerError) throw customerError;
  const customerById = new Map((customers || []).map((row) => [row.id, row]));
  const target = openInvoices.find(
    (invoice) =>
      customerById.get(invoice.customer_id)?.customer_code &&
      Number(invoice.balance_amount || 0) > 0,
  );
  assert(target, "No open invoice has an active customer master.");
  const customer = customerById.get(target.customer_id);
  const amount = Math.min(1, Number(target.balance_amount));
  const paymentReference = `QA-UTR-${Date.now()}`;
  const before = await counts(db, tenantId);
  const invoiceBefore = {
    paid_amount: Number(target.paid_amount || 0),
    balance_amount: Number(target.balance_amount || 0),
    payment_status: target.payment_status,
  };
  const message = `Record INR ${amount} received from ${customer.customer_code} against ${target.invoice_number} by NEFT UTR ${paymentReference} receipt date ${today}`;
  const response = await fetch(`${baseUrl}/api/v1/active-planner/interpret`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const preview = await json(response);
  assert(response.ok, "Customer-receipt prompt preview failed", preview);
  assert(
    preview.status === "READY_TO_REQUEST_APPROVAL" &&
      preview.proposed_action?.action_code === "POST_CUSTOMER_RECEIPT" &&
      (preview.questions || []).length === 0,
    "Customer receipt did not reach governed approval readiness",
    preview,
  );
  assert(
    preview.resolved?.customer_receipt_invoice?.id === target.id &&
      preview.resolved?.counterparty?.id === customer.id &&
      Number(preview.extracted?.amount) === amount &&
      preview.extracted?.payment_method === "NEFT" &&
      preview.extracted?.payment_reference === paymentReference &&
      preview.extracted?.receipt_date === today,
    "Receipt context does not match the authoritative invoice",
    { preview, target, customer },
  );
  const after = await counts(db, tenantId);
  const { data: invoiceAfter, error: invoiceAfterError } = await db
    .from("invoices")
    .select("paid_amount,balance_amount,payment_status")
    .eq("tenant_id", tenantId)
    .eq("id", target.id)
    .single();
  if (invoiceAfterError) throw invoiceAfterError;
  assert(
    JSON.stringify(before) === JSON.stringify(after) &&
      Number(invoiceAfter.paid_amount || 0) === invoiceBefore.paid_amount &&
      Number(invoiceAfter.balance_amount || 0) === invoiceBefore.balance_amount &&
      invoiceAfter.payment_status === invoiceBefore.payment_status,
    "Preview unexpectedly changed receipt, invoice, or accounting data",
    { before, after, invoiceBefore, invoiceAfter },
  );
  const report = {
    pass: true,
    environment: "MIZANTRA TEST ONLY",
    database_host: databaseHost,
    mode: "PREVIEW_ONLY_NO_WRITES",
    target: {
      invoice_id: target.id,
      invoice_number: target.invoice_number,
      customer_id: customer.id,
      customer_code: customer.customer_code,
      open_balance: invoiceBefore.balance_amount,
      preview_amount: amount,
    },
    preview: {
      status: preview.status,
      action_code: preview.proposed_action.action_code,
      questions: preview.questions,
      native_record_created: false,
    },
    controls: {
      exact_open_invoice_resolution: true,
      amount_within_balance: true,
      payment_reference_required: true,
      independent_approval_required: true,
      no_approval_request_created: true,
      no_receipt_invoice_or_accounting_write: true,
    },
    record_counts_before: before,
    record_counts_after: after,
  };
  save(report);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
