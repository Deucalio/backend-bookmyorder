const prisma = require('../utils/prisma');
const { matchLocation } = require('../utils/location-matcher');
const { matchArea } = require('../utils/area-matcher');
const { logMatchAttempt } = require('../utils/address-match-log');
const { shopifyRestGet } = require('../utils/shopify-api');
const { consumeCreditForNewOrder, recordStoppedOrder } = require('../utils/credits');
const { findCourier } = require('../utils/courierCompanies');

// REST order webhooks send fulfillment_status as null/'fulfilled'/'partial'/
// 'restocked'. The DB column stores the GraphQL displayFulfillmentStatus enum,
// so map the REST values onto the GraphQL form to keep filtering consistent.
const REST_TO_GRAPHQL_FULFILLMENT = {
  fulfilled: 'FULFILLED',
  partial: 'PARTIALLY_FULFILLED',
  restocked: 'UNFULFILLED',
};
function normalizeWebhookFulfillmentStatus(raw) {
  if (!raw) return 'UNFULFILLED';
  return REST_TO_GRAPHQL_FULFILLMENT[String(raw).toLowerCase()] || 'UNFULFILLED';
}

// ─── Access token helper ────────────────────────────────────────────────────
// The backend reads the offline session from the shared DB rather than having
// the Remix app pass the token on every webhook forward.

async function getAccessToken(shopDomain) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    select: { accessToken: true },
    orderBy: { expires: 'desc' },
  });
  return session?.accessToken ?? null;
}

// ─── Idempotency wrapper ─────────────────────────────────────────────────────
// Mirrors the processWebhook logic from the Remix app.
// Shopify retries for ~48h — we dedupe on (shopId, shopifyId, topic).

async function processWebhook({ shopDomain, webhookId, topic, payload, handler }) {
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shopRecord) {
    console.warn(`[webhook-processor] Unknown shop ${shopDomain} for ${topic} — acking`);
    return;
  }

  const existing = await prisma.webhookEvent.findUnique({
    where: { shopId_shopifyId_topic: { shopId: shopRecord.id, shopifyId: webhookId, topic } },
    select: { id: true, processed: true },
  });
  if (existing?.processed) return; // already handled

  const event = await prisma.webhookEvent.upsert({
    where: { shopId_shopifyId_topic: { shopId: shopRecord.id, shopifyId: webhookId, topic } },
    create: { shopId: shopRecord.id, shopifyId: webhookId, topic, payload, attempts: 1 },
    update: { attempts: { increment: 1 }, payload },
  });

  try {
    await handler(shopRecord.id);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date(), error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook-processor] ${topic} (${webhookId}) failed:`, err);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { error: message },
    });
    throw err;
  }
}

// ─── Status maps ─────────────────────────────────────────────────────────────

const FULFILLMENT_STATUS_MAP = {
  pending: 'pending',
  open: 'booked',
  success: 'fulfilled',
  cancelled: 'cancelled',
  error: 'failed',
  failure: 'failed',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toFloat = (v, fallback = 0) => {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
};

const truncate = (v, len) => (v ? v.substring(0, len) : null);

// ─── Fetch and store fulfillment order ID from Shopify REST ──────────────────
// Called after an order is saved. The orders/create payload doesn't carry
// fulfillment order data; we fetch it proactively so the order is immediately
// bookable without waiting for fulfillment_orders/order_routing_complete.

async function tryFetchAndStoreFulfillmentOrder(shopDomain, shopId, shopifyOrderId) {
  try {
    const accessToken = await getAccessToken(shopDomain);
    if (!accessToken) return;

    const data = await shopifyRestGet(
      shopDomain,
      accessToken,
      `/orders/${shopifyOrderId}/fulfillment_orders.json`,
    );

    const fos = data?.fulfillment_orders ?? [];
    if (fos.length === 0) return;

    // Pick the first OPEN fulfillment order, or the first one overall
    const fo = fos.find((f) => f.status === 'open') ?? fos[0];

    await prisma.order.update({
      where: { shopId_shopifyOrderId: { shopId, shopifyOrderId: BigInt(shopifyOrderId) } },
      data: {
        shopifyFulfillmentOrderId: BigInt(fo.id),
        shopifyFulfillmentOrderStatus: fo.status.toUpperCase(),
        shopifyFulfillmentOrderUpdatedAt: fo.updated_at ? new Date(fo.updated_at) : new Date(),
      },
    });
  } catch (err) {
    // Best-effort — don't fail the webhook if this step fails.
    // fulfillment_orders/order_routing_complete will cover it anyway.
    console.error(`[webhook-processor] Could not fetch fulfillment order for order ${shopifyOrderId}:`, err.message);
  }
}

// ─── Order handler ────────────────────────────────────────────────────────────

async function upsertOrderFromWebhook(shopId, shopDomain, order) {
  const shipping = order.shipping_address || {};
  const customer = order.customer || {};

  const customerName =
    shipping.name ||
    `${shipping.first_name ?? customer.first_name ?? ''} ${shipping.last_name ?? customer.last_name ?? ''}`.trim() ||
    'No Name';
  const customerPhone = shipping.phone || customer.phone || order.phone || null;
  const shopifyOrderId = BigInt(order.id);
  const total = toFloat(order.total_price);

  const incomingRawCity = shipping.city ?? null;
  const incomingAddr1 = shipping.address1 ?? null;
  const incomingAddr2 = shipping.address2 ?? null;

  const existing = await prisma.order.findUnique({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    select: {
      rawCity: true,
      addressLine1: true,
      addressLine2: true,
      provinceId: true,
      cityId: true,
      areaId: true,
      addressMatchLogId: true,
    },
  });

  // Credit gate — applies only to NET-NEW orders received over webhook. Updates
  // (`existing != null`) and the initial backfill (which goes through the sync
  // path, not this function) are exempt.
  if (existing == null) {
    const gate = await consumeCreditForNewOrder(shopId);
    if (!gate.allowed) {
      await recordStoppedOrder(shopId, order);
      console.log(
        `[credits] ${order.name} stopped for ${shopDomain} — credits exhausted (plan: ${gate.plan})`,
      );
      return;
    }
    console.log(
      `[credits] ${order.name} accepted for ${shopDomain} — ${gate.remaining === Infinity ? 'unlimited' : `${gate.remaining} left`}`,
    );
  }

  const addressUnchanged =
    existing != null &&
    existing.cityId != null &&
    existing.addressMatchLogId != null &&
    existing.rawCity === incomingRawCity &&
    existing.addressLine1 === incomingAddr1 &&
    existing.addressLine2 === incomingAddr2;

  let provinceId, cityId, resolvedAreaId, addressMatchLogId;

  if (addressUnchanged) {
    provinceId = existing.provinceId;
    cityId = existing.cityId;
    resolvedAreaId = existing.areaId;
    addressMatchLogId = existing.addressMatchLogId;
  } else {
    const location = await matchLocation({
      province: shipping.province,
      city: shipping.city,
      address1: shipping.address1,
      address2: shipping.address2,
    }).catch(() => ({ provinceId: null, cityId: null, areaId: null }));

    let areaMatch = null;
    if (location.cityId) {
      areaMatch = await matchArea(location.cityId, shipping.address1, shipping.address2);
    }
    // Always log — even unmatched orders (outcome='unmatched') so the matcher
    // review queue catches them.
    const newLogId = await logMatchAttempt({
      shopId,
      orderId: shopifyOrderId.toString(),
      rawAddress1: shipping.address1 ?? '',
      rawAddress2: shipping.address2 ?? null,
      rawCity: shipping.city ?? null,
      matchedCityId: location.cityId,
      match: areaMatch,
    });

    provinceId = location.provinceId;
    cityId = location.cityId;
    resolvedAreaId = areaMatch && areaMatch.areaId ? areaMatch.areaId : location.areaId;
    addressMatchLogId = newLogId;
  }

  const data = {
    shopId,
    shopifyOrderId,
    shopifyOrderGid: order.admin_graphql_api_id ?? `gid://shopify/Order/${order.id}`,
    orderName: order.name,
    customerName,
    customerEmail: customer.email || order.email || null,
    customerPhone: truncate(customerPhone, 20),
    provinceId,
    cityId,
    areaId: resolvedAreaId,
    addressMatchLogId,
    rawProvince: shipping.province || null,
    rawCity: shipping.city || null,
    addressLine1: shipping.address1 || null,
    addressLine2: shipping.address2 || null,
    postalCode: shipping.zip || null,
    subtotal: toFloat(order.subtotal_price),
    totalAmount: total,
    codAmount: total,
    currency: order.currency || 'PKR',
    financialStatus: (order.financial_status || 'PENDING').toUpperCase(),
    fulfillmentStatus: normalizeWebhookFulfillmentStatus(order.fulfillment_status),
    orderStatus: order.cancelled_at ? 'Cancelled' : order.closed_at ? 'Closed' : 'Open',
    cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : null,
    closedAt: order.closed_at ? new Date(order.closed_at) : null,
    tags: order.tags || null,
    lineItems: order.line_items ?? [],
    shopifyCreatedAt: new Date(order.created_at),
    shopifyUpdatedAt: new Date(order.updated_at),
  };

  await prisma.order.upsert({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    create: data,
    update: data,
  });

  console.log(`[webhook] Order ${order.name} upserted for ${shopDomain} at ${new Date().toISOString()}`);

  // Proactively fetch fulfillment order ID. Best-effort — don't await in the
  // calling code; handled internally with try/catch.
  await tryFetchAndStoreFulfillmentOrder(shopDomain, shopId, order.id);
}

// ─── Fulfillment handler ──────────────────────────────────────────────────────

async function upsertFulfillmentFromWebhook(shopId, fulfillment) {
  const shopifyOrderId = BigInt(fulfillment.order_id);
  const order = await prisma.order.findUnique({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    select: { id: true, fulfillmentStatus: true },
  });
  if (!order) {
    throw new Error(
      `Order not found for fulfillment ${fulfillment.id} (order_id=${fulfillment.order_id})`,
    );
  }

  const shopifyFulfillmentId = String(fulfillment.id);
  const trackingUrl =
    fulfillment.tracking_url ||
    (Array.isArray(fulfillment.tracking_urls) ? fulfillment.tracking_urls[0] : null) ||
    null;

  const rawStatus = (fulfillment.status || '').toLowerCase();
  const mappedStatus = FULFILLMENT_STATUS_MAP[rawStatus] ?? 'pending';
  const fulfilledAt =
    mappedStatus === 'fulfilled'
      ? new Date(fulfillment.updated_at ?? fulfillment.created_at ?? Date.now())
      : null;

  const courierName = fulfillment.tracking_company || 'manual';
  // Store the external courier code (e.g. "Leopards Courier" → "LCS") via the
  // single-source courierCompanies file, matching what bookOrders.server.ts
  // writes onto the per-order Fulfillment record.
  const matched = findCourier(courierName);
  const courierCode = matched ? matched.courier_code : courierName.toLowerCase().replace(/\s+/g, '_');

  const existing = await prisma.fulfillment.findFirst({
    where: { orderId: order.id, shopifyFulfillmentId },
    select: { id: true },
  });

  const data = {
    shopifyFulfillmentId,
    shopifyFulfillmentGid: fulfillment.admin_graphql_api_id ?? `gid://shopify/Fulfillment/${fulfillment.id}`,
    courierCode,
    courierName,
    trackingNumber: fulfillment.tracking_number || null,
    trackingUrl,
    status: mappedStatus,
    lastTrackingStatus: fulfillment.shipment_status || null,
    lastTrackingAt: fulfillment.shipment_status ? new Date() : null,
    // deliveryOutcome stays 'pending' (or 'failed' when Shopify says so).
    // Only the tracking-sync cron — backed by real courier data from
    // trackmyorder.pk — is allowed to mark a parcel 'delivered'/'returned'.
    deliveryOutcome: mappedStatus === 'failed' ? 'failed' : 'pending',
    fulfilledOnShopifyAt: fulfilledAt,
    items: fulfillment.line_items ?? [],
  };

  if (existing) {
    await prisma.fulfillment.update({ where: { id: existing.id }, data });
  } else {
    await prisma.fulfillment.create({ data: { ...data, orderId: order.id } });
  }

  if (mappedStatus === 'fulfilled' && order.fulfillmentStatus !== 'FULFILLED') {
    await prisma.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: 'FULFILLED' },
    });
  }

  console.log(`[webhook] Fulfillment ${shopifyFulfillmentId} (${mappedStatus}) synced for order_id=${fulfillment.order_id} at ${new Date().toISOString()}`);
}

// ─── Fulfillment order handler ────────────────────────────────────────────────

async function upsertFulfillmentOrderFromWebhook(shopId, payload) {
  // For 'moved', track the destination order; for others, the main one.
  const fo = payload.moved_to_fulfillment_order ?? payload.fulfillment_order;
  if (!fo) return;

  const shopifyOrderId = BigInt(fo.order_id);
  const order = await prisma.order.findUnique({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    select: { id: true },
  });
  if (!order) {
    throw new Error(`Order not found for fulfillment_order ${fo.id} (order_id=${fo.order_id})`);
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      shopifyFulfillmentOrderId: BigInt(fo.id),
      shopifyFulfillmentOrderStatus: fo.status.toUpperCase(),
      shopifyFulfillmentOrderUpdatedAt: fo.updated_at ? new Date(fo.updated_at) : new Date(),
    },
  });

  console.log(`[webhook] FulfillmentOrder ${fo.id} (${fo.status}) updated for order_id=${fo.order_id} at ${new Date().toISOString()}`);
}

// ─── App uninstalled handler ──────────────────────────────────────────────────
// Deletes all merchant data.  Order.addressMatchLogId → AddressMatchLog has
// SET NULL semantics, so we null it first inside a transaction to avoid a
// circular-cascade conflict before deleting the shop (which cascades to
// everything else via onDelete: Cascade).

async function handleAppUninstalled(shopDomain) {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) return; // already gone / never installed

  await prisma.$transaction(
    async (tx) => {
    // BookingAttempt.orderId is a String (no FK), and BookingAttempt.fulfillmentId
    // uses SetNull on cascade. So if we just delete the Shop, the BookingAttempt
    // audit rows would linger orphaned. Clear them explicitly first.
    const orderIds = (
      await tx.order.findMany({ where: { shopId: shop.id }, select: { id: true } })
    ).map((o) => o.id);
    if (orderIds.length > 0) {
      await tx.bookingAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
    }

    // Break the Order ↔ AddressMatchLog circular FK before cascade fires
    await tx.order.updateMany({
      where: { shopId: shop.id },
      data: { addressMatchLogId: null },
    });

    // Deleting the shop cascades to:
    //   Order              → Fulfillment → TrackingEvent
    //   ShopCourier
    //   CourierCityStats
    //   WebhookEvent
    //   AddressMatchLog
    //   CustomTab
    //   StoppedOrder
    // Session rows are deleted by the Remix uninstall route (it owns those).
    await tx.shop.delete({ where: { id: shop.id } });
    },
    // Cascade across Order → Fulfillment → TrackingEvent plus sibling tables
    // can blow past the 5s default on busy shops.
    { timeout: 60_000, maxWait: 10_000 },
  );

  console.log(`[webhook-processor] Shop ${shopDomain} uninstalled — all data deleted`);
}

// ─── Topic dispatcher ─────────────────────────────────────────────────────────

// Shopify's Remix library uses GraphQL-registered webhooks, which deliver topics
// in SCREAMING_SNAKE_CASE (e.g. ORDERS_UPDATED).  Normalize to the REST-style
// lowercase/slash format used by the handler map below.
const TOPIC_MAP = {
  'ORDERS_CREATE':                              'orders/create',
  'ORDERS_UPDATED':                             'orders/updated',
  'FULFILLMENTS_CREATE':                        'fulfillments/create',
  'FULFILLMENTS_UPDATE':                        'fulfillments/update',
  'FULFILLMENT_ORDERS_ORDER_ROUTING_COMPLETE':  'fulfillment_orders/order_routing_complete',
  'FULFILLMENT_ORDERS_CANCELLED':               'fulfillment_orders/cancelled',
  'FULFILLMENT_ORDERS_MOVED':                   'fulfillment_orders/moved',
  'APP_UNINSTALLED':                            'app/uninstalled',
};

async function dispatch(shopDomain, webhookId, topic, payload) {
  const normalizedTopic = TOPIC_MAP[topic] ?? topic;

  // app/uninstalled deletes the shop record (and all cascading data), so it
  // cannot go through processWebhook — the WebhookEvent created there would be
  // cascade-deleted before processWebhook tries to mark it processed.
  if (normalizedTopic === 'app/uninstalled') {
    await handleAppUninstalled(shopDomain);
    return;
  }

  const handlerMap = {
    'orders/create': (shopId) => upsertOrderFromWebhook(shopId, shopDomain, payload),
    'orders/updated': (shopId) => upsertOrderFromWebhook(shopId, shopDomain, payload),
    'fulfillments/create': (shopId) => upsertFulfillmentFromWebhook(shopId, payload),
    'fulfillments/update': (shopId) => upsertFulfillmentFromWebhook(shopId, payload),
    'fulfillment_orders/order_routing_complete': (shopId) => upsertFulfillmentOrderFromWebhook(shopId, payload),
    'fulfillment_orders/cancelled': (shopId) => upsertFulfillmentOrderFromWebhook(shopId, payload),
    'fulfillment_orders/moved': (shopId) => upsertFulfillmentOrderFromWebhook(shopId, payload),
  };

  const handler = handlerMap[normalizedTopic];
  if (!handler) {
    console.warn(`[webhook-processor] No handler for topic: ${topic} (normalized: ${normalizedTopic})`);
    return;
  }

  await processWebhook({ shopDomain, webhookId, topic: normalizedTopic, payload, handler });
}

module.exports = { dispatch };
