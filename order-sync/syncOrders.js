const prisma = require('../utils/prisma');
const { shopifyGraphQL, mapOrderToRecord, syncFulfillmentsForOrders, ORDER_NODE_FIELDS } = require('./orderMapper');

const ORDERS_QUERY = `
  query($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          ${ORDER_NODE_FIELDS}
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function fetchOrdersFromShopify(shopDomain, accessToken, fromDateStr) {
  const all = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await shopifyGraphQL(shopDomain, accessToken, ORDERS_QUERY, {
      cursor,
      query: `created_at:>=${fromDateStr}`,
    });

    if (data.errors) {
      console.error('GraphQL errors during order fetch:', data.errors);
      break;
    }

    const ordersData = data.data?.orders;
    if (!ordersData) break;

    const orders = ordersData.edges.map((e) => e.node);
    if (orders.length === 0) break;

    all.push(...orders);
    hasNextPage = ordersData.pageInfo.hasNextPage;
    cursor = ordersData.pageInfo.endCursor;
  }

  return all;
}

async function syncOrders(shopDomain, accessToken, daysBack = 60) {
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  if (!shopRecord) {
    throw new Error(`Shop record not found for ${shopDomain}`);
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);
  const fromDateStr = fromDate.toISOString().split('T')[0];

  console.log(`[order-sync] Starting sync for ${shopDomain} from ${fromDateStr}`);

  try {
    const orders = await fetchOrdersFromShopify(shopDomain, accessToken, fromDateStr);
    console.log(`[order-sync] Fetched ${orders.length} orders from Shopify`);

    const ids = orders.map((o) => BigInt(o.id.split('/').pop()));
    const existing = ids.length
      ? await prisma.order.findMany({
          where: { shopId: shopRecord.id, shopifyOrderId: { in: ids } },
          select: {
            shopifyOrderId: true,
            shopifyFulfillmentOrderId: true,
            rawCity: true,
            addressLine1: true,
            addressLine2: true,
            provinceId: true,
            cityId: true,
            areaId: true,
            addressMatchLogId: true,
          },
        })
      : [];

    const existingIds = new Set(existing.map((e) => e.shopifyOrderId.toString()));
    const existingByOrderId = new Map(existing.map((e) => [e.shopifyOrderId.toString(), e]));

    const records = await Promise.all(
      orders.map((o) => {
        const orderId = BigInt(o.id.split('/').pop()).toString();
        return mapOrderToRecord(shopRecord.id, o, existingByOrderId.get(orderId));
      }),
    );

    let newCount = 0;
    const orderIdMap = new Map();

    for (const record of records) {
      const isNew = !existingIds.has(record.shopifyOrderId.toString());
      if (isNew) newCount++;

      const upserted = await prisma.order.upsert({
        where: { shopId_shopifyOrderId: { shopId: record.shopId, shopifyOrderId: record.shopifyOrderId } },
        update: record,
        create: record,
      });
      orderIdMap.set(record.shopifyOrderId.toString(), upserted.id);
    }

    await syncFulfillmentsForOrders(orders, orderIdMap);

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        lastOrderSyncAt: new Date(),
        ordersBackfilledCount: { increment: newCount },
        initialSyncCompletedAt: shopRecord.initialSyncCompletedAt ?? new Date(),
        lastSyncError: null,
      },
    });

    const result = {
      fetched: orders.length,
      newCount,
      updatedCount: orders.length - newCount,
    };
    console.log(`[order-sync] Done for ${shopDomain}: ${result.fetched} fetched, ${result.newCount} new, ${result.updatedCount} updated`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { lastSyncError: message },
    }).catch(() => {});
    throw err;
  }
}

module.exports = { syncOrders };
