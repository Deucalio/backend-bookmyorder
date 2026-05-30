// utils/credits.js
//
// Plan + credit accounting for orders/create webhooks. Only the orders/create
// path consumes credits — updates, deletes, and the initial backfill all flow
// through other code paths and stay free.
//
// Free plan: 300 new orders per refresh cycle. Pro: unlimited (no decrement).
// Refresh cycle is the install anniversary day, advanced monthly.

const prisma = require('./prisma');

// Single source of truth for plan tiers. Mirror in book-my-order/app/utils/plans.ts
// when you change these.
const PLANS = {
  free: { label: 'Free', creditsPerCycle: 300 },
  pro:  { label: 'Pro',  creditsPerCycle: Infinity },
};

function planFor(planCode) {
  return PLANS[(planCode || 'free').toLowerCase()] || PLANS.free;
}

/** Add N calendar months to a date, clamping when the target month is shorter. */
function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  // setMonth overflows when the target month doesn't have `day` (Jan 31 → Mar 3).
  // Clamp by walking back to the last day of the intended month.
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

/** Anchor for the next refresh = (last renewal OR install) + 1 month. */
function nextRefreshAt(shop) {
  const anchor = shop.creditsRenewedAt || shop.installedAt;
  return addMonths(anchor, 1);
}

/**
 * Refresh the shop's credit balance if its cycle has elapsed. Idempotent — safe
 * to call on every webhook. Returns the (possibly refreshed) shop snapshot.
 */
async function ensureCreditRefresh(shopId) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, plan: true, credits: true, creditsRenewedAt: true, installedAt: true },
  });
  if (!shop) return null;

  // Pro is unlimited — credit field is meaningless; don't churn the row.
  if (planFor(shop.plan).creditsPerCycle === Infinity) return shop;

  const next = nextRefreshAt(shop);
  if (Date.now() < next.getTime()) return shop;

  const limit = planFor(shop.plan).creditsPerCycle;
  const refreshedAt = new Date();
  await prisma.shop.update({
    where: { id: shopId },
    data: { credits: limit, creditsRenewedAt: refreshedAt },
  });
  console.log(`[credits] refreshed shop ${shopId} → ${limit} (${shop.plan})`);
  return { ...shop, credits: limit, creditsRenewedAt: refreshedAt };
}

/**
 * Attempt to spend one credit for a net-new order. Atomic via Prisma
 * updateMany so two concurrent webhooks can't both decrement past zero.
 *
 * @returns {Promise<{ allowed: boolean, plan: string, remaining: number }>}
 */
async function consumeCreditForNewOrder(shopId) {
  const shop = await ensureCreditRefresh(shopId);
  if (!shop) return { allowed: false, plan: 'free', remaining: 0 };

  // Pro shops: never decrement.
  if (planFor(shop.plan).creditsPerCycle === Infinity) {
    return { allowed: true, plan: shop.plan, remaining: Infinity };
  }

  // Atomic gate: only decrement when credits are still > 0.
  const result = await prisma.shop.updateMany({
    where: { id: shopId, credits: { gt: 0 } },
    data:  { credits: { decrement: 1 } },
  });

  if (result.count === 1) {
    return { allowed: true, plan: shop.plan, remaining: Math.max(0, shop.credits - 1) };
  }
  return { allowed: false, plan: shop.plan, remaining: 0 };
}

/**
 * Write the order payload into StoppedOrder when credits are exhausted. The
 * unique(shopId, shopifyOrderId) constraint dedupes — a replayed webhook is a
 * no-op rather than an error.
 */
async function recordStoppedOrder(shopId, order) {
  const shopifyOrderId = BigInt(order.id);
  const customerName =
    order.shipping_address?.name ||
    `${order.shipping_address?.first_name ?? ''} ${order.shipping_address?.last_name ?? ''}`.trim() ||
    null;
  await prisma.stoppedOrder.upsert({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    create: {
      shopId,
      shopifyOrderId,
      orderName: order.name ?? null,
      customerName,
      totalAmount: parseFloat(order.total_price) || 0,
      payload: order,
    },
    update: { payload: order }, // refresh payload if Shopify retries with newer fields
  });
}

module.exports = {
  PLANS,
  planFor,
  addMonths,
  nextRefreshAt,
  ensureCreditRefresh,
  consumeCreditForNewOrder,
  recordStoppedOrder,
};
