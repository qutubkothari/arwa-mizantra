const baseUrl = process.env.SMOKE_BASE_URL || 'https://mizantra.saksolution.com';
const username = process.env.SMOKE_USER || 'hnoman';
const password = process.env.SMOKE_PASSWORD || 'Password';
const tag = `Automated sales full smoke ${Date.now()}`;

function rows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['data', 'items', 'results', 'records']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

async function request(path, options = {}) {
  const method = options.method || 'GET';
  console.log(`[sales-finance-smoke] ${method} ${path}`);
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${request.token}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

(async () => {
  const result = { baseUrl, tag, status: 'pending' };
  let seededUid;
  let seedItem;
  let seedWarehouse;
  let dispatch;
  let stockSeeded = false;
  let stockRemoved = false;
  try {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const auth = await login.json();
    if (!login.ok || !auth.accessToken) throw new Error(`Login failed: ${login.status}`);
    request.token = auth.accessToken;

    const [customersResponse, itemsResponse, warehousesResponse] = await Promise.all([
      request('/sales/customers'),
      request('/items?limit=1000'),
      request('/inventory/warehouses'),
    ]);
    const customer = rows(customersResponse)[0];
    seedItem = rows(itemsResponse).find((item) => item.uid_tracking === true && String(item.uid_strategy || '').toUpperCase() === 'SERIALIZED');
    seedWarehouse = rows(warehousesResponse).find((warehouse) => warehouse.code === 'MAIN_WAREHOUSE') || rows(warehousesResponse)[0];
    if (!customer || !seedItem || !seedWarehouse) throw new Error('Customer, serialized item and warehouse master data are required');

    const beforeRows = rows(await request(`/inventory/stock?item_id=${seedItem.id}&warehouse_id=${seedWarehouse.id}`));
    const beforeStock = Number(beforeRows[0]?.available_quantity || 0);
    const seed = await request('/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({
        movement_type: 'ADJUSTMENT', item_id: seedItem.id, to_warehouse_id: seedWarehouse.id,
        quantity: 1, generate_uids: true, reference_type: 'AUTOMATED_SALES_STOCK_SEED',
        reference_number: tag, notes: tag,
      }),
    });
    seededUid = rows(seed.generated_uids)[0] || seed.generated_uids?.[0];
    if (!seededUid) throw new Error('Serialized stock seed did not generate a UID');
    stockSeeded = true;
    await request(`/uid/${encodeURIComponent(seededUid)}/quality-status`, { method: 'PUT', body: JSON.stringify({ quality_status: 'PASSED', notes: tag }) });

    const order = await request('/sales/orders', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customer.id, order_date: new Date().toISOString().slice(0, 10),
        expected_delivery_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        payment_terms: 'Net 30 Days', delivery_terms: 'Ex Works', notes: tag,
        items: [{ item_id: seedItem.id, item_description: `${seedItem.code} ${seedItem.name}`, quantity: 1, unit_price: 1000, discount_percentage: 10, tax_percentage: 18, notes: tag }],
      }),
    });
    const orderDetail = await request(`/sales/orders/${order.id}`);
    const orderLine = rows(orderDetail.sales_order_items)[0];
    if (!orderLine) throw new Error('Sales-order line was not returned');

    const availability = await request(`/sales/orders/${order.id}/availability`);
    if (availability.status !== 'FULLY_CONFIRMED' || Number(availability.lines?.[0]?.confirmed_quantity || 0) !== 1) {
      throw new Error(`Sales-order ATP did not confirm the seeded unit (${availability.status || 'unknown'})`);
    }
    const release = await request(`/sales/orders/${order.id}/release`, {
      method: 'POST',
      body: JSON.stringify({ remarks: tag }),
    });
    if (release.release_status !== 'RELEASED' || release.credit_status !== 'CLEAR' || release.availability_status !== 'FULLY_CONFIRMED') {
      throw new Error('Sales-order commercial release did not persist credit and ATP controls');
    }

    dispatch = await request('/sales/dispatch', {
      method: 'POST',
      body: JSON.stringify({
        sales_order_id: order.id, dispatch_date: new Date().toISOString().slice(0, 10),
        delivery_address: 'Automated QA delivery address', notes: tag,
        items: [{ sales_order_item_id: orderLine.id, item_id: seedItem.id, quantity: 1, uid: [seededUid] }],
      }),
    });
    if (dispatch.status !== 'PGI_POSTED') throw new Error(`Unexpected dispatch status ${dispatch.status}`);

    const afterPgiRows = rows(await request(`/inventory/stock?item_id=${seedItem.id}&warehouse_id=${seedWarehouse.id}`));
    const afterPgi = Number(afterPgiRows[0]?.available_quantity || 0);
    if (Math.abs(afterPgi - beforeStock) > 0.000001) throw new Error(`PGI stock mismatch: baseline=${beforeStock}, after=${afterPgi}`);

    const invoice = await request(`/sales/dispatch/${dispatch.id}/create-invoice`, { method: 'POST', body: JSON.stringify({ notes: tag }) });
    if (Number(invoice.net_amount) !== 1062) throw new Error(`Unexpected sales invoice total ${invoice.net_amount}`);
    const payment = await request(`/sales/invoices/${invoice.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: 1062, payment_method: 'NEFT', payment_reference: tag }) });
    if (payment.payment_status !== 'PAID') throw new Error('Full customer receipt did not mark the invoice paid');
    const flow = await request(`/sales/orders/${order.id}/document-flow`);
    if (rows(flow.dispatches).length !== 1 || rows(flow.invoices).length !== 1 || rows(flow.invoices[0].payments).length !== 1) throw new Error('Sales document flow is incomplete');

    await request(`/sales/invoices/${invoice.id}/payments/${payment.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: tag }) });
    await request(`/sales/invoices/${invoice.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: tag }) });
    await request(`/sales/dispatch/${dispatch.id}`, { method: 'DELETE' });
    await request('/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({
        movement_type: 'ADJUSTMENT', item_id: seedItem.id, from_warehouse_id: seedWarehouse.id,
        quantity: 1, selected_uids: [seededUid], reference_type: 'AUTOMATED_SALES_STOCK_CLEANUP',
        reference_number: tag, notes: tag,
      }),
    });
    stockRemoved = true;
    const restoredRows = rows(await request(`/inventory/stock?item_id=${seedItem.id}&warehouse_id=${seedWarehouse.id}`));
    const restoredStock = Number(restoredRows[0]?.available_quantity || 0);
    if (Math.abs(restoredStock - beforeStock) > 0.000001) throw new Error(`Sales QA stock did not restore: before=${beforeStock}, restored=${restoredStock}`);

    result.status = 'passed';
    result.salesOrder = order.so_number;
    result.dispatch = dispatch.dn_number;
    result.invoice = invoice.invoice_number;
    result.receipt = payment.receipt_number;
    result.commercialRelease = { credit: release.credit_status, atp: release.availability_status };
    result.documentFlow = 'complete';
    result.stock = { item: seedItem.code, before: beforeStock, afterPgi, restored: restoredStock };
  } catch (error) {
    result.status = `failed: ${error.message}`;
    if (stockSeeded && !stockRemoved && seededUid && seedItem?.id && seedWarehouse?.id) {
      try {
        if (dispatch?.id) await request(`/sales/dispatch/${dispatch.id}`, { method: 'DELETE' });
        await request('/inventory/movements', {
          method: 'POST',
          body: JSON.stringify({
            movement_type: 'ADJUSTMENT', item_id: seedItem.id, from_warehouse_id: seedWarehouse.id,
            quantity: 1, selected_uids: [seededUid], reference_type: 'AUTOMATED_SALES_STOCK_CLEANUP',
            reference_number: tag, notes: `${tag} automatic failure recovery`,
          }),
        });
        stockRemoved = true;
      } catch (recoveryError) {
        result.stockRecoveryError = recoveryError.message;
      }
    }
    result.recovery = { stockSeeded, stockRemoved, seededUid: seededUid || null, itemId: seedItem?.id || null, warehouseId: seedWarehouse?.id || null };
    process.exitCode = 1;
  }
  console.log(JSON.stringify(result, null, 2));
})();
