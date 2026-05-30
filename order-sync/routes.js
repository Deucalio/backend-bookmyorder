const express = require('express');
const { syncOrders } = require('./syncOrders');
const { refreshOrders } = require('./refreshOrders');

const router = express.Router();

const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

function requireInternalSecret(req, res, next) {
  if (!INTERNAL_SECRET) {
    console.warn('[order-sync] INTERNAL_SECRET not set — endpoint is unprotected');
    return next();
  }
  const provided = req.headers['x-internal-secret'];
  if (provided !== INTERNAL_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// POST /api/orders/sync
// Body: { shopDomain, accessToken, daysBack? }
// Responds 202 immediately; sync runs in background.
router.post('/sync', requireInternalSecret, (req, res) => {
  const { shopDomain, accessToken, daysBack = 60 } = req.body;

  if (!shopDomain || !accessToken) {
    return res.status(400).json({ success: false, error: 'shopDomain and accessToken are required' });
  }

  // Respond immediately — caller should not wait for the sync to complete.
  res.status(202).json({ success: true, message: 'Order sync started in background' });

  // Run in next tick so the response is flushed before we start the heavy work.
  setImmediate(() => {
    syncOrders(shopDomain, accessToken, daysBack).catch((err) => {
      console.error(`[order-sync] Background sync failed for ${shopDomain}:`, err);
    });
  });
});

// POST /api/orders/refresh
// Refreshes all orders already in the database from Shopify by GID.
// Use this for the manual sync button. Responds 202 immediately.
router.post('/refresh', requireInternalSecret, (req, res) => {
  const { shopDomain, accessToken } = req.body;

  if (!shopDomain || !accessToken) {
    return res.status(400).json({ success: false, error: 'shopDomain and accessToken are required' });
  }

  res.status(202).json({ success: true, message: 'Order refresh started in background' });

  setImmediate(() => {
    refreshOrders(shopDomain, accessToken).catch((err) => {
      console.error(`[order-refresh] Background refresh failed for ${shopDomain}:`, err);
    });
  });
});

module.exports = router;
