// fulfillment-kit/fulfillment.routes.js
//
// Express router for Shopify fulfillment operations.
// Mount it in your app, e.g.:
//
//   const fulfillmentRoutes = require('./fulfillment-kit/fulfillment.routes');
//   app.use('/api/fulfillment', fulfillmentRoutes);
//
// Endpoints:
//   POST /mark          — mark a single fulfillment order as fulfilled
//   POST /batch-mark    — mark many fulfillment orders (parallel, partial-success 207)
//   POST /cancel        — cancel a Shopify fulfillment
//   POST /fetch-orders  — get open fulfillment orders for a Shopify order
//   POST /tag-order     — add tags to a Shopify order

const express = require('express');
const {
  markFulfillment,
  cancelFulfillment,
  getOpenFulfillmentOrders,
  tagOrder,
} = require('./utils/shopify.fulfillment');
const batchFulfillmentService = require('./utils/batch.fulfillment.service');

const router = express.Router();

// ----------------------------------------------------------------------------
// AUTH / PERMISSIONS
// No-op placeholders so the kit runs out of the box. Swap them for the
// project's real middleware when ready.
// ----------------------------------------------------------------------------
const authenticateToken = (req, res, next) => next();
const requirePermission = () => (req, res, next) => next();

// ----------------------------------------------------------------------------
// 1. Mark a single fulfillment order as fulfilled.
//
//    Body: FulfillmentMarkPayload (see guide)
//    200 — success
//    400 — validation error or Shopify userError
//    500 — unexpected exception
// ----------------------------------------------------------------------------
router.post('/mark', authenticateToken, requirePermission('orders:fulfill'), async (req, res) => {
  try {
    const payload = req.body;

    if (!payload?.fulfillment_order_id) {
      return res.status(400).json({ success: false, message: 'fulfillment_order_id is required' });
    }
    if (!payload?.tracking_number) {
      return res.status(400).json({ success: false, message: 'tracking_number is required' });
    }

    const result = await markFulfillment(payload);
    res.status(result.status === 'success' ? 200 : 400).json({
      success: result.status === 'success',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 2. Batch mark many fulfillment orders.
//
//    Body: { payloads: [ FulfillmentMarkPayload, ... ] }
//    200 — all succeeded
//    207 — partial success
//    400 — all failed
// ----------------------------------------------------------------------------
router.post('/batch-mark', authenticateToken, requirePermission('orders:fulfill'), async (req, res) => {
  try {
    const { payloads } = req.body;

    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ success: false, message: 'payloads array is required' });
    }

    const results = await batchFulfillmentService.processBatchMark(payloads);
    const allFailed = results.summary.success === 0;
    const hasFailures = results.summary.failed > 0;

    res.status(allFailed ? 400 : hasFailures ? 207 : 200).json({
      success: !allFailed,
      ...results,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 3. Cancel a Shopify fulfillment.
//
//    Body: FulfillmentCancelPayload (see guide)
//    200 — cancelled
//    400 — validation error or Shopify userError
// ----------------------------------------------------------------------------
router.post('/cancel', authenticateToken, requirePermission('orders:fulfill'), async (req, res) => {
  try {
    const payload = req.body;

    if (!payload?.fulfillment_id) {
      return res.status(400).json({ success: false, message: 'fulfillment_id is required' });
    }

    const result = await cancelFulfillment(payload);
    res.status(result.status === 'success' ? 200 : 400).json({
      success: result.status === 'success',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 4. Fetch open fulfillment orders for a Shopify order.
//    Use this first when you only have a Shopify order ID and need to
//    know what fulfillment_order_id(s) to mark.
//
//    Body: { store_id? | credentials?, platform_order_id }
//    200 — fulfillment orders found
//    404 — no open fulfillment orders
//    400 — error
// ----------------------------------------------------------------------------
router.post('/fetch-orders', authenticateToken, async (req, res) => {
  try {
    const payload = req.body;

    if (!payload?.platform_order_id) {
      return res.status(400).json({ success: false, message: 'platform_order_id is required' });
    }

    const result = await getOpenFulfillmentOrders(payload);

    const statusCode =
      result.status === 'success' ? 200 :
      result.status === 'no_fulfillment_orders' ? 404 : 400;

    res.status(statusCode).json({
      success: result.status === 'success',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 5. Add tags to a Shopify order.
//
//    Body: { store_id? | credentials?, platform_order_id, tags: string | string[] }
//    200 — tags added
//    400 — error
// ----------------------------------------------------------------------------
router.post('/tag-order', authenticateToken, async (req, res) => {
  try {
    const payload = req.body;

    if (!payload?.platform_order_id) {
      return res.status(400).json({ success: false, message: 'platform_order_id is required' });
    }
    if (!payload?.tags) {
      return res.status(400).json({ success: false, message: 'tags is required' });
    }

    const result = await tagOrder(payload);
    res.status(result.status === 'success' ? 200 : 400).json({
      success: result.status === 'success',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
