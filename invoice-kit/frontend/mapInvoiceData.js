// mapInvoiceData.js
//
// Turns raw order(s) into a normalized, null-safe invoice view model that the
// PDF renderer consumes directly. The mapper does all the defensive work
// (missing billing address, partial line items, string-vs-number amounts) so
// the renderer stays dumb.
//
// Orders are grouped by store: one invoice "section" per store, with that
// store's orders inside. This mirrors how a multi-store cart is invoiced.

/**
 * @param {Array} orders  Raw orders. Each may include:
 *   - id, store_id, order_number, confirmation_number, status
 *   - order_date (ISO string)
 *   - payment_method, payment_status, shipping_method
 *   - billing_address / shipping_address: { name?, first_name?, last_name?,
 *       address1?, address2?, city?, country?, phone? }
 *   - order_items: [{ id, image_url, name, sku, variant_title, quantity,
 *       unit_price, total_price, is_removed? }]
 *   - subtotal, tax_amount, shipping_amount, discount_amount, total_amount
 *
 * @param {Array} stores  [{ id, name, logo_url, address, phone, email }]
 *
 * @param {Object} [options]
 * @param {string} [options.currency='PKR']
 *
 * @returns {{ sections: Array, currency: string, grandTotal: number,
 *             orderCount: number, generatedAt: string }}
 */
export function mapInvoiceData(orders, stores = [], options = {}) {
  const currency = options.currency || 'PKR';
  const validOrders = (orders || []).filter((o) => o && o.id);

  const storesMap = new Map();

  for (const order of validOrders) {
    const storeId = order.store_id;
    if (!storesMap.has(storeId)) {
      const store = stores.find((s) => s.id === storeId) || {};
      storesMap.set(storeId, {
        store: {
          id: store.id || storeId,
          name: store.name || '',
          logo_url: store.logo_url || '',
          address: store.address || '',
          phone: store.phone || '',
          email: store.email || '',
        },
        orders: [],
      });
    }
    storesMap.get(storeId).orders.push(mapOrder(order));
  }

  const sections = Array.from(storesMap.values());
  const grandTotal = validOrders.reduce(
    (sum, o) => sum + num(o.total_amount),
    0
  );

  return {
    sections,
    currency,
    grandTotal,
    orderCount: validOrders.length,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function mapOrder(order) {
  return {
    id: order.id,
    order_number: order.order_number || '',
    confirmation_number: order.confirmation_number || '',
    status: order.status || '',
    order_date: order.order_date || null,

    payment_method: order.payment_method || '',
    payment_status: order.payment_status || '',
    shipping_method: order.shipping_method || '',

    billing_address: mapAddress(order.billing_address),
    shipping_address: mapAddress(order.shipping_address),

    items: (order.order_items || []).map(mapItem),

    subtotal: num(order.subtotal),
    tax_amount: num(order.tax_amount),
    shipping_amount: num(order.shipping_amount),
    discount_amount: num(order.discount_amount),
    total_amount: num(order.total_amount),
  };
}

function mapAddress(addr) {
  const a = addr || {};
  const name = a.name || [a.first_name, a.last_name].filter(Boolean).join(' ');
  const cityLine = [a.city, a.country].filter(Boolean).join(', ');
  return {
    name,
    address1: a.address1 || '',
    address2: a.address2 || '',
    cityLine,
    phone: a.phone || '',
  };
}

function mapItem(item) {
  const isRemoved = item.is_removed || item.quantity === 0;
  return {
    id: item.id,
    image_url: item.image_url || '',
    name: item.name || 'Unknown Item',
    sku: item.sku || 'N/A',
    variant_title: item.variant_title || '',
    quantity: item.quantity || 0,
    unit_price: num(item.unit_price),
    total_price: num(item.total_price),
    is_removed: isRemoved,
  };
}

// Coerce string/Decimal/number/null into a finite number.
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
