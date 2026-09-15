/*
 * Idempotently prepares the Mizantra accounting control plane for test use.
 * It is hard-blocked from any other host.  It creates no operational
 * transaction: only the open FY period and finance-approved default mapping.
 */
const baseUrl = process.env.SMOKE_BASE_URL || 'https://mizantra.saksolution.com';
const username = process.env.SMOKE_USER || 'hnoman';
const password = process.env.SMOKE_PASSWORD || 'Password';

if (!/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(baseUrl)) {
  throw new Error('This setup script is restricted to Mizantra/test.');
}

let token = '';
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

(async () => {
  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const auth = await login.json();
  if (!login.ok || !auth.accessToken) throw new Error(`Login failed: ${login.status}`);
  token = auth.accessToken;

  await request('/accounting/accounts/seed-defaults', { method: 'POST' });
  const accounts = await request('/accounting/accounts');
  const account = (code) => {
    const row = accounts.find((entry) => entry.account_code === code);
    if (!row) throw new Error(`Required chart account ${code} is not available.`);
    return row.id;
  };

  const today = new Date().toISOString().slice(0, 10);
  const periods = await request('/accounting/periods');
  let hasOpenPeriod = periods.some((period) => period.status === 'OPEN' && period.start_date <= today && period.end_date >= today);
  if (!hasOpenPeriod) {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const startYear = month >= 4 ? year : year - 1;
    await request('/accounting/periods', { method: 'POST', body: JSON.stringify({
      period_name: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
      start_date: `${startYear}-04-01`, end_date: `${startYear + 1}-03-31`,
    }) });
    hasOpenPeriod = true;
  }

  const definitions = [
    ['AUTO-SALES-INVOICE', 'Sales invoice to receivables', 'SALES_INVOICE', '1100', '4000'],
    ['AUTO-SALES-RECEIPT', 'Customer receipt to bank', 'SALES_RECEIPT', '1000', '1100'],
    ['AUTO-PURCHASE-INVOICE', 'Purchase invoice to supplier payable', 'PURCHASE_INVOICE', '5100', '2000'],
    ['AUTO-SERVICE-INVOICE', 'Service invoice to receivables', 'SERVICE_INVOICE', '1100', '4100'],
    ['AUTO-SUBCONTRACT', 'Subcontract receipt to supplier payable', 'SUBCONTRACT_RECEIPT', '5100', '2000'],
    ['AUTO-PAYROLL', 'Payroll run accrual', 'PAYROLL_RUN', '5200', '2200'],
    ['AUTO-STOCK-ADJUSTMENT', 'Stock adjustment to suspense', 'STOCK_ADJUSTMENT', '1200', '2300'],
  ];
  const rules = await request('/accounting/posting-rules');
  for (const [rule_code, rule_name, source_type, debit, credit] of definitions) {
    const existing = rules.find((rule) => rule.source_type === source_type);
    const payload = { rule_code, rule_name, source_type, debit_account_id: account(debit), credit_account_id: account(credit), is_active: true,
      narration_template: `${rule_name}: {{document_number}}` };
    if (existing) await request(`/accounting/posting-rules/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    else await request('/accounting/posting-rules', { method: 'POST', body: JSON.stringify(payload) });
  }
  console.log(JSON.stringify({ status: 'READY', baseUrl, open_period: hasOpenPeriod, active_source_rules: definitions.map((rule) => rule[2]) }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
