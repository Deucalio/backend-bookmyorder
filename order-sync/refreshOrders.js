const prisma = require('../utils/prisma');
const { shopifyGraphQL, mapOrderToRecord, syncFulfillmentsForOrders, ORDER_NODE_FIELDS } = require('./orderMapper');

const BATCH_SIZE = 50;

const NODES_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        ${ORDER_NODE_FIELDS}
      }
    }
  }
`;

async function refreshOrders(shopDomain, accessToken) {
  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shopRecord) throw new Error(`Shop not found: ${shopDomain}`);

  const dbOrders = await prisma.order.findMany({
    where: { shopId: shopRecord.id },
    select: {
      shopifyOrderId: true,
      shopifyOrderGid: true,
      shopifyFulfillmentOrderId: true,
      rawCity: true,
      addressLine1: true,
      addressLine2: true,
      provinceId: true,
      cityId: true,
      areaId: true,
      addressMatchLogId: true,
    },
  });

  if (dbOrders.length === 0) {
    console.log(`[order-refresh] No existing orders for ${shopDomain}`);
    return { refreshed: 0, failed: 0 };
  }

  const existingByOrderId = new Map(dbOrders.map((o) => [o.shopifyOrderId.toString(), o]));
  const gids = dbOrders.map((o) => o.shopifyOrderGid ?? `gid://shopify/Order/${o.shopifyOrderId}`);

  console.log(`[order-refresh] Starting refresh of ${gids.length} orders for ${shopDomain}`);

  const allNodes = [];
  let batchFailed = 0;

  for (let i = 0; i < gids.length; i += BATCH_SIZE) {
    const batch = gids.slice(i, i + BATCH_SIZE);

    const data = await shopifyGraphQL(shopDomain, accessToken, NODES_QUERY, { ids: batch });

    if (data.errors) {
      console.error(`[order-refresh] GraphQL errors for batch ${i}–${i + batch.length}:`, data.errors);
      batchFailed += batch.length;
      continue;
    }

    const nodes = (data.data?.nodes ?? []).filter(Boolean);
    allNodes.push(...nodes);
  }

  const orderIdMap = new Map();
  let upsertFailed = 0;

  for (const order of allNodes) {
    if (!order?.id) continue;
    const orderId = BigInt(order.id.split('/').pop()).toString();
    const existing = existingByOrderId.get(orderId);

    try {
      const record = await mapOrderToRecord(shopRecord.id, order, existing);
      const upserted = await prisma.order.upsert({
        where: { shopId_shopifyOrderId: { shopId: record.shopId, shopifyOrderId: record.shopifyOrderId } },
        update: record,
        create: record,
      });
      orderIdMap.set(record.shopifyOrderId.toString(), upserted.id);
    } catch (err) {
      console.error(`[order-refresh] Failed to upsert order ${order.id}:`, err.message);
      upsertFailed++;
    }
  }

  await syncFulfillmentsForOrders(allNodes, orderIdMap);

  await prisma.shop.update({
    where: { id: shopRecord.id },
    data: { lastOrderSyncAt: new Date(), lastSyncError: null },
  }).catch(() => {});

  const refreshed = allNodes.length - upsertFailed;
  const failed = batchFailed + upsertFailed;
  console.log(`[order-refresh] Done for ${shopDomain}: ${refreshed} refreshed, ${failed} failed`);
  return { refreshed, failed };
}

module.exports = { refreshOrders };
