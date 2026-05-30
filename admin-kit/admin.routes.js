// admin-kit/admin.routes.js
//
// Admin/debug endpoints — protected by the internal secret. Useful from
// Postman for local development and ops scripts.
//
// Endpoints:
//   POST /api/admin/wipe-shop { shopDomain }
//     Hard-deletes everything in our DB belonging to a Shopify shop. Same
//     thing the app/uninstalled webhook does, plus Session cleanup. Use this
//     before reinstalling a dev store so the next install starts from zero.

const express = require('express');
const prisma = require('../utils/prisma');

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    console.error('[admin] INTERNAL_SECRET not set — rejecting request');
    return res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

router.post('/wipe-shop', requireInternalSecret, async (req, res) => {
  try {
    const { shopDomain } = req.body || {};
    if (!shopDomain || typeof shopDomain !== 'string') {
      return res.status(400).json({ success: false, error: 'shopDomain (string) is required' });
    }

    console.log(`[admin/wipe-shop] start | shop: ${shopDomain}`);

    // Sessions are keyed by the raw shop string (no shopId FK), so handle
    // them outside the Shop transaction.
    const sessionsResult = await prisma.session.deleteMany({ where: { shop: shopDomain } });

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!shop) {
      console.log(`[admin/wipe-shop] no Shop row for ${shopDomain}; wiped ${sessionsResult.count} sessions`);
      return res.status(200).json({
        success: true,
        message: `No Shop row found. Cleared ${sessionsResult.count} Session row(s).`,
        counts: { sessions: sessionsResult.count, shop: 0 },
      });
    }

    const counts = { sessions: sessionsResult.count, shop: 1, bookingAttempts: 0 };

    await prisma.$transaction(
      async (tx) => {
      // BookingAttempt.orderId is a String (no FK), and BookingAttempt.fulfillmentId
      // uses SetNull on cascade — so audit rows would linger orphaned. Delete first.
      const orderIds = (
        await tx.order.findMany({ where: { shopId: shop.id }, select: { id: true } })
      ).map((o) => o.id);
      if (orderIds.length > 0) {
        const r = await tx.bookingAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
        counts.bookingAttempts = r.count;
      }

      // Break the Order ↔ AddressMatchLog circular FK before the cascade fires.
      await tx.order.updateMany({
        where: { shopId: shop.id },
        data: { addressMatchLogId: null },
      });

      // Deleting the Shop cascades to:
      //   Order              → Fulfillment → TrackingEvent
      //   ShopCourier
      //   CourierCityStats
      //   WebhookEvent
      //   AddressMatchLog
      //   CustomTab
      //   StoppedOrder
      await tx.shop.delete({ where: { id: shop.id } });
      },
      // Cascade across Order → Fulfillment → TrackingEvent plus sibling tables
      // can blow past the 5s default on busy shops.
      { timeout: 60_000, maxWait: 10_000 },
    );

    console.log(
      `[admin/wipe-shop] done | shop: ${shopDomain} | sessions: ${counts.sessions} | bookingAttempts: ${counts.bookingAttempts}`,
    );

    return res.status(200).json({
      success: true,
      message: `Wiped all data for ${shopDomain}.`,
      counts,
    });
  } catch (error) {
    console.error('[admin/wipe-shop] error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to wipe shop' });
  }
});

module.exports = router;
