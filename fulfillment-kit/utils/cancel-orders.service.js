// Batch-cancel booked shipments for a set of internal order IDs.
//
// For each active fulfillment this:
//   1. Cancels the parcel with the courier (LCS/TCS) by tracking number.
//   2. Cancels the Shopify fulfillment (returns the order to unfulfilled).
//   3. Marks the DB fulfillment 'cancelled' and the order UNFULFILLED.
//
// Only fulfillments that are still active are touched — already-cancelled or
// failed ones are skipped. A "fulfilled" status just means it was marked
// fulfilled on Shopify; the parcel can still be recalled, so it stays
// cancellable. Cancellations run sequentially per shop to avoid GraphQL burst
// throttling.

const prisma = require('../../utils/prisma');
const { cancelFulfillment } = require('./shopify.fulfillment');
const courierFactory = require('../../courier-module-kit/utils/courier.factory');

async function getAccessToken(shopDomain) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    select: { accessToken: true },
    orderBy: { expires: 'desc' },
  });
  return session?.accessToken ?? null;
}

// Fulfillment.courierCode is 'lcs'/'tcs'; ShopCourier.courierCode is 'leopards'/'tcs'.
function shopCourierCodeFor(courierCode) {
  const v = (courierCode || '').toLowerCase();
  if (v === 'lcs' || v === 'leopards') return 'leopards';
  if (v === 'tcs') return 'tcs';
  return v;
}

function courierApiNameFor(courierCode) {
  const v = (courierCode || '').toLowerCase();
  if (v === 'lcs' || v === 'leopards') return 'LCS';
  if (v === 'tcs') return 'TCS';
  return courierCode;
}

// Map the stored ShopCourier credentials (camelCase) to the access_data shape
// the courier services expect (snake_case).
function buildAccessData(shopCourierCode, creds) {
  creds = creds || {};
  if (shopCourierCode === 'leopards') {
    return { api_key: creds.apiKey || '', api_password: creds.apiPassword || '' };
  }
  if (shopCourierCode === 'tcs') {
    return {
      bearertoken: creds.bearerToken || '',
      username: creds.username || '',
      password: creds.password || '',
      account_number: creds.accountNumber || '',
      cost_center_code: creds.costCenterCode || '',
    };
  }
  return {};
}

/**
 * Cancel all active fulfillments (courier parcel + Shopify) for the given orders.
 *
 * @param {string}   shopDomain  e.g. "mystore.myshopify.com"
 * @param {string[]} orderIds    internal DB order IDs (cuid)
 * @returns {Promise<{ summary, successful, failed }>}
 */
async function batchCancelOrders(shopDomain, orderIds) {
  const results = {
    successful: [],
    failed: [],
    summary: { total: 0, success: 0, failed: 0 },
  };

  if (!orderIds?.length) return results;

  const fulfillments = await prisma.fulfillment.findMany({
    where: {
      orderId: { in: orderIds },
      order: { shop: { shopDomain } },
      // Anything not already cancelled/failed is cancellable. We intentionally
      // do NOT gate on deliveryOutcome: the sync marks Shopify-fulfilled orders
      // as deliveryOutcome='delivered' even though the parcel isn't delivered yet.
      status: { notIn: ['cancelled', 'failed'] },
    },
    select: {
      id: true,
      orderId: true,
      status: true,
      shopifyFulfillmentGid: true,
      trackingNumber: true,
      courierCode: true,
    },
  });

  results.summary.total = fulfillments.length;
  if (!fulfillments.length) return results;

  const accessToken = await getAccessToken(shopDomain);
  const credentials = accessToken ? { platform_store_id: shopDomain, access_token: accessToken } : null;

  // Load this shop's courier credentials once, keyed by ShopCourier.courierCode.
  const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  const shopCouriers = shop
    ? await prisma.shopCourier.findMany({
        where: { shopId: shop.id },
        select: { courierCode: true, credentials: true },
      })
    : [];
  const credByCode = new Map(shopCouriers.map((c) => [c.courierCode, c.credentials]));

  for (const f of fulfillments) {
    const errors = [];

    // 1. Cancel the courier parcel (best-effort: only when we have a tracking
    //    number and stored credentials for that courier).
    const scCode = shopCourierCodeFor(f.courierCode);
    if (f.trackingNumber && credByCode.has(scCode)) {
      try {
        const service = courierFactory.getService(courierApiNameFor(f.courierCode));
        const access_data = buildAccessData(scCode, credByCode.get(scCode));
        const courierRes = await service.cancelOrder({
          courier: courierApiNameFor(f.courierCode),
          tracking_number: f.trackingNumber,
          credentials: access_data,
        });
        if (!courierRes.success) errors.push(`courier: ${courierRes.error || 'cancel failed'}`);
      } catch (err) {
        errors.push(`courier: ${err.message}`);
      }
    }

    // 2. Cancel the Shopify fulfillment (returns items to unfulfilled).
    if (f.shopifyFulfillmentGid) {
      if (!credentials) {
        errors.push(`shopify: no access token found for ${shopDomain}`);
      } else {
        const shopifyRes = await cancelFulfillment({ credentials, fulfillment_id: f.shopifyFulfillmentGid });
        if (shopifyRes.status !== 'success') errors.push(`shopify: ${shopifyRes.error || 'cancel failed'}`);
      }
    }

    if (errors.length === 0) {
      await prisma.fulfillment.update({ where: { id: f.id }, data: { status: 'cancelled' } });
      results.successful.push({
        fulfillmentId: f.id,
        orderId: f.orderId,
        trackingNumber: f.trackingNumber,
        courierCode: f.courierCode,
      });
      results.summary.success++;
    } else {
      results.failed.push({ fulfillmentId: f.id, orderId: f.orderId, error: errors.join('; ') });
      results.summary.failed++;
    }
  }

  // Mark orders UNFULFILLED once they have no remaining active fulfillments.
  const affectedOrderIds = [...new Set(fulfillments.map((f) => f.orderId))];
  for (const orderId of affectedOrderIds) {
    const activeCount = await prisma.fulfillment.count({
      where: { orderId, status: { notIn: ['cancelled', 'failed'] } },
    });
    if (activeCount === 0) {
      await prisma.order.update({
        where: { id: orderId },
        data: { fulfillmentStatus: 'UNFULFILLED' },
      });
    }
  }

  return results;
}

module.exports = { batchCancelOrders };
