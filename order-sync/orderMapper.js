const prisma = require('../utils/prisma');
const { matchLocation } = require('../utils/location-matcher');
const { matchArea } = require('../utils/area-matcher');
const { logMatchAttempt } = require('../utils/address-match-log');
const { waitForCredits } = require('../fulfillment-kit/utils/shopify.throttle');
const { findCourier } = require('../utils/courierCompanies');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

const FULFILLMENT_STATUS_MAP = {
  pending: 'pending',
  open: 'booked',
  success: 'fulfilled',
  cancelled: 'cancelled',
  error: 'failed',
  failure: 'failed',
};

// Shared field set used by both the paginated sync query and the nodes refresh query.
const ORDER_NODE_FIELDS = `
  id
  name
  tags
  createdAt
  updatedAt
  cancelledAt
  closedAt
  displayFinancialStatus
  displayFulfillmentStatus
  subtotalPriceSet { shopMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } }
  currencyCode
  customer { email phone firstName lastName }
  shippingAddress {
    address1 address2 city province zip phone firstName lastName name
  }
  lineItems(first: 50) {
    edges {
      node {
        id title quantity
        sku
        image { url }
        variant { id title price }
      }
    }
  }
  fulfillmentOrders(first: 5) {
    edges {
      node { id status updatedAt }
    }
  }
  fulfillments {
    id status
    trackingInfo { number url company }
    createdAt updatedAt
  }
`;

async function shopifyGraphQL(shopDomain, accessToken, query, variables = {}, maxRetries = 4) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken,
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });

    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
      console.log(`[shopifyGraphQL] 429 for ${shopDomain} — waiting ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}: ${res.statusText}`);

    const json = await res.json();

    if (json.errors?.length) {
      const throttled = json.errors.find(e => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < maxRetries - 1) {
        const needed = throttled.extensions?.cost ?? 50;
        const waitSec = Math.max(2, Math.ceil(needed / 50));
        console.log(`[shopifyGraphQL] THROTTLED — waiting ${waitSec}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      return json;
    }

    const cost = json.extensions?.cost;
    if (cost?.throttleStatus) {
      await waitForCredits(cost.throttleStatus, cost.requestedQueryCost || 50);
    }

    return json;
  }

  throw new Error(`[shopifyGraphQL] Max retries exceeded for ${shopDomain}`);
}

async function mapOrderToRecord(shopId, o, existing) {
  const orderId = BigInt(o.id.split('/').pop());
  const shipping = o.shippingAddress || {};
  const customer = o.customer || {};

  const customerName =
    shipping.name ||
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
    'No Name';
  const customerPhone = shipping.phone || customer.phone || null;

  const incomingRawCity = shipping.city ?? null;
  const incomingAddr1 = shipping.address1 ?? null;
  const incomingAddr2 = shipping.address2 ?? null;

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
    let newLogId = null;
    if (location.cityId) {
      areaMatch = await matchArea(location.cityId, shipping.address1, shipping.address2);
      newLogId = await logMatchAttempt({
        shopId,
        orderId: orderId.toString(),
        rawAddress1: shipping.address1 ?? '',
        rawAddress2: shipping.address2 ?? null,
        rawCity: shipping.city ?? null,
        matchedCityId: location.cityId,
        match: areaMatch,
      });
    }

    provinceId = location.provinceId;
    cityId = location.cityId;
    resolvedAreaId = areaMatch && areaMatch.areaId ? areaMatch.areaId : location.areaId;
    addressMatchLogId = newLogId;
  }

  const foEdges = o.fulfillmentOrders?.edges ?? [];
  const foNode =
    foEdges.find((e) => e.node.status === 'OPEN')?.node ??
    foEdges[0]?.node ??
    null;
  const shopifyFulfillmentOrderId = foNode
    ? BigInt(foNode.id.split('/').pop())
    : (existing?.shopifyFulfillmentOrderId ?? null);
  const shopifyFulfillmentOrderStatus = foNode?.status ?? null;
  const shopifyFulfillmentOrderUpdatedAt = foNode?.updatedAt ? new Date(foNode.updatedAt) : null;

  return {
    shopId,
    shopifyOrderId: orderId,
    shopifyOrderGid: o.id,
    orderName: o.name,
    customerName,
    customerEmail: customer.email || null,
    customerPhone: customerPhone ? customerPhone.substring(0, 20) : null,
    provinceId,
    cityId,
    areaId: resolvedAreaId,
    addressMatchLogId,
    rawProvince: shipping.province || null,
    rawCity: shipping.city || null,
    addressLine1: shipping.address1 || null,
    addressLine2: shipping.address2 || null,
    postalCode: shipping.zip || null,
    subtotal: parseFloat(o.subtotalPriceSet?.shopMoney?.amount || 0),
    totalAmount: parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),
    codAmount: parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),
    currency: o.currencyCode || 'PKR',
    financialStatus: o.displayFinancialStatus || 'PENDING',
    fulfillmentStatus: o.displayFulfillmentStatus || 'UNFULFILLED',
    orderStatus: o.cancelledAt ? 'Cancelled' : o.closedAt ? 'Closed' : 'Open',
    cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
    closedAt: o.closedAt ? new Date(o.closedAt) : null,
    tags: Array.isArray(o.tags) ? (o.tags.length ? o.tags.join(', ') : null) : (o.tags || null),
    lineItems: o.lineItems?.edges?.map((e) => {
      const n = e.node;
      return {
        id: n.id,
        title: n.title,
        quantity: n.quantity,
        sku: n.sku || null,
        image_url: n.image?.url || null,
        variant: n.variant ? {
          id: n.variant.id,
          title: n.variant.title,
          price: n.variant.price,
          weight: 0,
          weightUnit: 'kg',
        } : null,
      };
    }) || [],
    shopifyFulfillmentOrderId,
    shopifyFulfillmentOrderStatus,
    shopifyFulfillmentOrderUpdatedAt,
    shopifyCreatedAt: new Date(o.createdAt),
    shopifyUpdatedAt: new Date(o.updatedAt),
  };
}

async function syncFulfillmentsForOrders(orders, orderIdMap) {
  for (const o of orders) {
    const shopifyOrderIdStr = BigInt(o.id.split('/').pop()).toString();
    const internalOrderId = orderIdMap.get(shopifyOrderIdStr);
    if (!internalOrderId) continue;

    for (const fulfillment of o.fulfillments ?? []) {
      const rawStatus = (fulfillment.status || '').toLowerCase();
      if (rawStatus === 'cancelled') continue;

      const mappedStatus = FULFILLMENT_STATUS_MAP[rawStatus] ?? 'pending';
      const isFulfilled = mappedStatus === 'fulfilled';
      const shopifyFulfillmentId = fulfillment.id.split('/').pop();
      const tracking = fulfillment.trackingInfo?.[0] ?? {};
      const courierName = tracking.company || 'manual';
      // Normalize to our internal id (e.g. "Leopards Courier" → "leopards")
      // via the single-source courierCompanies file, matching what
      // bookOrders.server.ts writes. Translation to the external API code
      // (LCS/TCS) only happens at the API boundary via findCourier().
      const matched = findCourier(courierName);
      const courierCode = matched ? matched.id : courierName.toLowerCase().replace(/\s+/g, '_');

      const sharedData = {
        shopifyFulfillmentId,
        shopifyFulfillmentGid: fulfillment.id,
        courierCode,
        courierName,
        trackingNumber: tracking.number || null,
        trackingUrl: tracking.url || null,
        status: mappedStatus,
        // deliveryOutcome stays 'pending' on import — only the tracking-sync
        // cron (sources: trackmyorder.pk DELIVERED/RETURNED/FAILED) is allowed
        // to flip it. Shopify being marked fulfilled doesn't mean the parcel
        // was delivered.
        deliveryOutcome: 'pending',
        fulfilledOnShopifyAt: isFulfilled
          ? new Date(fulfillment.updatedAt ?? fulfillment.createdAt)
          : null,
        items: [],
      };

      const existing = await prisma.fulfillment.findFirst({
        where: { orderId: internalOrderId, shopifyFulfillmentId },
        select: { id: true },
      });

      if (existing) {
        await prisma.fulfillment.update({ where: { id: existing.id }, data: sharedData });
      } else {
        await prisma.fulfillment.create({
          data: { ...sharedData, orderId: internalOrderId, source: 'shopify' },
        });
      }
    }
  }
}

module.exports = { shopifyGraphQL, mapOrderToRecord, syncFulfillmentsForOrders, ORDER_NODE_FIELDS };
