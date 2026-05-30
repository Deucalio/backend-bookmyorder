// courier-module-kit/courier.routes.js
//
// Express router exposing the courier booking API.
// Mount it in your app, e.g.:
//
//   const courierRoutes = require('./courier-module-kit/courier.routes');
//   app.use('/api/courier', courierRoutes);
//
// Endpoints:
//   POST /book-standardized        - book a single parcel
//   POST /batch-book-standardized  - book many parcels (partial success -> 207)
//   POST /batch-cancel             - cancel many parcels (partial success -> 207)
//   POST /verify-courier           - validate credentials (books + cancels a test parcel)
//   POST /test-credentials         - lightweight credential check (no booking made)
//   POST /tcs/auth-token           - fetch a fresh TCS access token

const express = require('express');
const courierFactory = require('./utils/courier.factory');
const batchBookingService = require('./utils/batch.booking.service');
const {
  markFulfillment,
  tagOrder,
} = require('../fulfillment-kit/utils/shopify.fulfillment');

const router = express.Router();

// ----------------------------------------------------------------------------
// AUTH / PERMISSIONS
// ----------------------------------------------------------------------------
const authenticateToken = (req, res, next) => next();
const requirePermission = () => (req, res, next) => next();

function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    console.error('[courier] INTERNAL_SECRET not set — rejecting request');
    return res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// ----------------------------------------------------------------------------
// Shared helper: book one parcel and (if booking succeeded) mark it fulfilled
// on Shopify, plus optional order tagging. Used by both the single
// /book-and-fulfill endpoint and the parallel /batch-book-and-fulfill endpoint.
//
// Throws on validation failure (missing courier / Shopify fields).
// Returns:
//   {
//     booking:     <standardized courier response>,            // .success === true/false
//     fulfillment: <markFulfillment response> | null,           // null iff booking failed
//     tag:         <tagOrder response> | null                   // null iff not requested or skipped
//   }
//
// Fulfillment / tag failures are LOGGED but do not throw — the booking is
// the primary outcome and is always returned to the caller intact.
// ----------------------------------------------------------------------------
async function bookAndFulfillOne(payload) {
  const shopify = payload?.shopify || {};
  const orderNum = payload?.order_info?.order_number ?? 'unknown';
  const courier  = String(payload?.courier || '').toUpperCase();
  const foId     = shopify.fulfillment_order_id;
  const shop     = shopify.platform_store_id;

  if (!payload?.courier) throw new Error('courier is required');
  if (!shopify.platform_store_id || !shopify.access_token) {
    throw new Error('shopify.platform_store_id and shopify.access_token are required');
  }
  if (!shopify.fulfillment_order_id) {
    throw new Error('shopify.fulfillment_order_id is required');
  }

  console.log(
    `[book-and-fulfill] START | order: ${orderNum} | courier: ${courier} | ` +
    `fo_id: ${foId} | shop: ${shop} | ` +
    `cod: ${payload.order_info?.cod_amount} | weight: ${payload.order_info?.weight} | ` +
    `service: ${payload.courier_data?.service_type ?? payload.courier_data?.service_code ?? 'n/a'} | ` +
    `city: ${payload.customer_info?.city_name ?? payload.customer_info?.city ?? 'n/a'}`
  );

  // 1. Book the parcel.
  const courierService = courierFactory.getService(payload.courier);
  const bookResult = await courierService.bookOrder(payload);

  if (!bookResult.success) {
    console.error(
      `[book-and-fulfill] COURIER FAILED | order: ${orderNum} | courier: ${courier} | ` +
      `error: ${bookResult.error}`
    );
    return { booking: bookResult, fulfillment: null, tag: null };
  }

  console.log(
    `[book-and-fulfill] COURIER OK | order: ${orderNum} | tracking: ${bookResult.tracking_number}` +
    (bookResult.slip_link ? ` | slip: ${bookResult.slip_link}` : '')
  );

  // 2. Booking succeeded — mark fulfilled on Shopify (non-fatal on failure).
  const storeCreds = {
    platform_store_id: shopify.platform_store_id,
    access_token:      shopify.access_token,
  };

  const markResult = await markFulfillment({
    credentials:          storeCreds,
    fulfillment_order_id: shopify.fulfillment_order_id,
    tracking_number:      bookResult.tracking_number,
    tracking_url:         bookResult.tracking_url,
    courier:              bookResult.courier_name,
    notify_customer:      shopify.notify_customer !== false,
  });

  if (markResult.status !== 'success') {
    console.error(
      `[book-and-fulfill] SHOPIFY FULFILL FAILED | order: ${orderNum} | fo_id: ${foId} | ` +
      `error: ${markResult.error}`
    );
  } else {
    console.log(
      `[book-and-fulfill] SHOPIFY FULFILL OK | order: ${orderNum} | fo_id: ${foId}`
    );
  }

  // 3. Optional tag (only if mark succeeded and the caller asked for it).
  let tagResult = null;
  if (
    markResult.status === 'success'
    && shopify.tags
    && shopify.platform_order_id
  ) {
    tagResult = await tagOrder({
      credentials:       storeCreds,
      platform_order_id: shopify.platform_order_id,
      tags:              shopify.tags,
    });
    if (tagResult.status !== 'success') {
      console.error(`[book-and-fulfill] tagOrder FAILED | order: ${orderNum} | error: ${tagResult.error}`);
    }
  }

  console.log(
    `[book-and-fulfill] DONE | order: ${orderNum} | courier: ${courier} | ` +
    `tracking: ${bookResult.tracking_number} | ` +
    `shopify_fulfill: ${markResult.status === 'success' ? 'ok' : 'FAILED'} | ` +
    `tagged: ${tagResult ? (tagResult.status === 'success' ? 'ok' : 'FAILED') : 'n/a'}`
  );

  return { booking: bookResult, fulfillment: markResult, tag: tagResult };
}

/**
 * 1. Single standardized booking.
 * Body: Standardized Booking Payload  ->  { courier, ...order/customer/courier_data }
 */
router.post('/book-standardized', authenticateToken, requirePermission('orders:book'), async (req, res) => {
  try {
    const payload = req.body;

    if (!payload?.courier) {
      return res.status(400).json({ success: false, message: 'Courier is required' });
    }

    const courierService = courierFactory.getService(payload.courier);
    const result = await courierService.bookOrder(payload);

    res.status(result.success ? 200 : 400).json(result);

  } catch (error) {
    console.error('Standardized booking failed:', error);
    res.status(500).json({ success: false, message: 'Booking failed', error: error.message });
  }
});

/**
 * 2. Batch standardized booking.
 * Body: { payloads: [ StandardizedBookingPayload, ... ] }
 * Status: 200 all ok | 207 partial | 400 all failed
 */
router.post('/batch-book-standardized', requireInternalSecret, requirePermission('orders:book'), async (req, res) => {
  try {
    const { payloads } = req.body;

    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ success: false, message: 'Payloads array is required' });
    }

    const results = await batchBookingService.processBatchBooking(payloads);

    const allFailed = results.summary.success === 0;
    const hasFailures = results.summary.failed > 0;

    res.status(allFailed ? 400 : (hasFailures ? 207 : 200)).json({
      success: !allFailed,
      ...results
    });

  } catch (error) {
    console.error('Batch standardized booking failed:', error);
    res.status(500).json({ success: false, message: 'Batch booking failed', error: error.message });
  }
});

/**
 * 3. Batch cancellation.
 * Body: { payloads: [ { courier, tracking_number, credentials|courier_account_id, reason? }, ... ] }
 * Status: 200 all ok | 207 partial | 400 all failed
 */
router.post('/batch-cancel', requireInternalSecret, requirePermission('orders:cancel'), async (req, res) => {
  try {
    const { payloads } = req.body;

    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ success: false, message: 'Payloads array is required' });
    }

    const trackingNums = payloads.map(p => p?.tracking_number ?? '?').join(', ');
    console.log(`[batch-cancel] START | count: ${payloads.length} | tracking: ${trackingNums}`);

    const results = await batchBookingService.processBatchCancellation(payloads);

    console.log(
      `[batch-cancel] DONE | success: ${results.summary.success} | failed: ${results.summary.failed}`
    );

    const allFailed = results.summary.success === 0;
    const hasFailures = results.summary.failed > 0;

    res.status(allFailed ? 400 : (hasFailures ? 207 : 200)).json({
      success: !allFailed,
      ...results
    });

  } catch (error) {
    console.error('[batch-cancel] unhandled error:', error);
    res.status(500).json({ success: false, message: 'Batch cancellation failed', error: error.message });
  }
});

/**
 * 4. Verify courier credentials (HEAVY check).
 * Books a test parcel with the supplied credentials, then immediately cancels it.
 * Body: { courier: "LCS"|"TCS", credentials: { ...access_data } }
 */
router.post('/verify-courier', authenticateToken, async (req, res) => {
  const { courier, credentials } = req.body;

  if (!courier || !credentials) {
    return res.status(400).json({ success: false, error: 'courier and credentials are required for verification' });
  }

  try {
    const courierService = courierFactory.getService(courier);
    const isLCS = String(courier).toUpperCase() === 'LCS' || String(courier).toUpperCase() === 'LEOPARDS';
    const mockOrderNo = 'TEST-' + Math.floor(Math.random() * 1000000);

    const mockPayload = {
      courier,
      credentials,
      order_info: {
        order_id: 'verify_' + Date.now(),
        order_number: mockOrderNo,
        cod_amount: 500,
        weight: 0.5,
        pieces: 1,
        product_details: 'API Verification Test Parcel'
      },
      customer_info: {
        name: 'Test User',
        phone: '03001234567',
        email: 'test@example.com',
        address: 'Test Address 123, Clifton, Karachi',
        city: 'Karachi',
        city_name: 'Karachi',
        city_id: isLCS ? 1 : undefined // LCS needs a numeric city id
      },
      courier_data: {
        service_type: isLCS ? 'OVERNIGHT' : 'EXPRESS',
        service_code: 'O',
        origin_city_id: 1,
        shipper_name: 'Verification Store',
        shipper_phone: '03001234567',
        shipper_address: 'Verification Warehouse, Karachi',
        special_instructions: 'API Verification Test'
      }
    };

    console.log(`[Verification] Booking test parcel for ${courier}...`);
    const bookResult = await courierService.bookOrder(mockPayload);
    console.log('[Verification] Book result:', bookResult);

    if (!bookResult.success || !bookResult.tracking_number) {
      return res.status(400).json({
        success: false,
        error: bookResult.error || 'Failed to book test parcel with provided credentials.',
        details: bookResult
      });
    }

    const trackingNumber = bookResult.tracking_number;
    console.log(`[Verification] Test parcel booked (${trackingNumber}). Cancelling now...`);

    const cancelResult = await courierService.cancelOrder({
      courier,
      credentials,
      tracking_number: trackingNumber,
      reason: 'API Verification Test'
    });
    console.log('[Verification] Cancel result:', cancelResult);

    return res.status(200).json({
      success: true,
      message: 'API Credentials verified successfully! Test parcel was booked and successfully cancelled.',
      tracking_number: trackingNumber,
      booking_result: bookResult,
      cancellation_result: cancelResult
    });

  } catch (error) {
    console.error('[Verification] Error during courier verification:', error);
    return res.status(500).json({ success: false, error: 'Verification failed: ' + error.message });
  }
});

/**
 * 5. Lightweight credential test (NO booking created).
 *
 *  - LCS: hits /getAllCities/format/json/ — if status==1, creds are valid.
 *  - TCS: hits /api/authentication/token when username+password are present;
 *         otherwise does a shape check on the credential object.
 *
 * Body: { courier: "LCS"|"TCS"|"LEOPARDS", credentials: { ... } }
 */
router.post('/test-credentials', requireInternalSecret, async (req, res) => {
  const { courier, credentials } = req.body;

  if (!courier || !credentials) {
    return res.status(400).json({ success: false, error: 'courier and credentials are required' });
  }

  try {
    const courierService = courierFactory.getService(courier);

    if (typeof courierService.testCredentials !== 'function') {
      return res.status(400).json({
        success: false,
        error: `Lightweight credential testing is not supported for courier "${courier}".`
      });
    }

    const result = await courierService.testCredentials(credentials);
    return res.status(result.success ? 200 : 400).json(result);

  } catch (error) {
    console.error('[test-credentials] failed:', error);
    return res.status(500).json({ success: false, error: 'Credential test failed: ' + error.message });
  }
});

/**
 * 6. Fetch a fresh TCS access token.
 *
 * TCS' /api/authentication/token endpoint takes username + password as query
 * params, authenticated with a long-lived bearer token in the Authorization
 * header, and returns the short-lived `accesstoken` you then use in booking
 * calls.
 *
 * Body: { bearertoken: "...", username: "...", password: "..." }
 */
router.post('/tcs/auth-token', authenticateToken, async (req, res) => {
  const { bearertoken, username, password } = req.body || {};

  if (!bearertoken || !username || !password) {
    return res.status(400).json({
      success: false,
      error: 'bearertoken, username, and password are all required'
    });
  }

  try {
    const tcsService = courierFactory.getService('TCS');
    const result = await tcsService.getAuthToken({ bearertoken, username, password });
    return res.status(result.success ? 200 : 400).json(result);

  } catch (error) {
    console.error('[tcs/auth-token] failed:', error);
    return res.status(500).json({ success: false, error: 'TCS auth-token request failed: ' + error.message });
  }
});

/**
 * 7. Combined book + mark-fulfilled in a single round trip.
 *
 *  - Books the parcel with the chosen courier (same logic as /book-standardized).
 *  - On booking success, marks the Shopify fulfillment order as fulfilled with
 *    the returned tracking info. Fulfillment failure is logged but does NOT
 *    fail the request — the booking is the primary outcome and is preserved.
 *  - If `shopify.tags` and `shopify.platform_order_id` are present and the
 *    fulfillment succeeded, the order is also tagged.
 *
 * Body shape:
 *   {
 *     // ── courier fields (identical to /book-standardized) ──
 *     courier: "LCS" | "TCS" | "LEOPARDS",
 *     credentials | courier_account_id,
 *     order_info, customer_info, courier_data,
 *
 *     // ── shopify fields ──
 *     shopify: {
 *       platform_store_id:    "mystore.myshopify.com",
 *       access_token:         "shpat_...",
 *       fulfillment_order_id: "1234567890",   // REQUIRED, explicit
 *       notify_customer:      true,            // optional, default true
 *       platform_order_id:    "5551234567890", // optional — only needed if tagging
 *       tags:                 ["Packed"]       // optional
 *     }
 *   }
 *
 * Status codes:
 *   200 — booking succeeded (fulfillment may or may not have succeeded).
 *   400 — booking failed, or the request body was missing required fields.
 *   500 — unexpected exception.
 */
router.post('/book-and-fulfill', authenticateToken, requirePermission('orders:book'), async (req, res) => {
  try {
    const result = await bookAndFulfillOne(req.body || {});
    const ok = result.booking?.success === true;
    return res.status(ok ? 200 : 400).json({ success: ok, ...result });
  } catch (error) {
    // Thrown only for validation failures (missing courier / shopify fields)
    // or unexpected exceptions.
    console.error('[book-and-fulfill] error:', error);
    const isValidation = /required/i.test(error.message || '');
    return res.status(isValidation ? 400 : 500).json({ success: false, error: error.message });
  }
});

/**
 * 8. Bulk version of /book-and-fulfill.
 *
 *  - Accepts an array of payloads (each identical in shape to /book-and-fulfill).
 *  - Books and marks each in PARALLEL. One failure never blocks the rest.
 *  - Per-payload semantics match the single endpoint: booking is the primary
 *    outcome; a fulfillment-mark failure is logged but the order is still
 *    counted as successful in the response.
 *
 *  Body:
 *    {
 *      "payloads": [
 *        { courier, credentials|courier_account_id, order_info, customer_info,
 *          courier_data, shopify: { platform_store_id, access_token,
 *                                    fulfillment_order_id, notify_customer?,
 *                                    platform_order_id?, tags? } },
 *        ...
 *      ]
 *    }
 *
 *  Status codes:
 *    200 — every booking succeeded.
 *    207 — partial: some bookings succeeded, some failed.
 *    400 — every booking failed (or `payloads` was missing/empty).
 *
 *  Response body:
 *    {
 *      success: bool,
 *      successful: [
 *        { order_number, booking, fulfillment, tag }
 *      ],
 *      failed: [
 *        { order_number, error, booking?: { ... } }     // booking present iff the courier rejected
 *      ],
 *      summary: { total, success, failed, fulfillment_failed }
 *      //                                  ^^ orders whose booking succeeded
 *      //                                     but whose Shopify mark failed.
 *    }
 */
router.post('/batch-book-and-fulfill', requireInternalSecret, requirePermission('orders:book'), async (req, res) => {
  try {
    const { payloads } = req.body || {};

    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ success: false, message: 'payloads array is required' });
    }

    const orderNums = payloads.map(p => p?.order_info?.order_number ?? '?').join(', ');
    console.log(`[batch-book-and-fulfill] START | total: ${payloads.length} | orders: ${orderNums}`);

    const settled = await Promise.allSettled(payloads.map(p => bookAndFulfillOne(p)));

    const out = {
      successful: [],
      failed: [],
      summary: { total: payloads.length, success: 0, failed: 0, fulfillment_failed: 0 },
    };

    settled.forEach((res, i) => {
      const payload = payloads[i];
      const order_number = payload?.order_info?.order_number;

      if (res.status === 'rejected') {
        out.failed.push({ order_number, error: res.reason?.message || 'Unknown error' });
        out.summary.failed++;
        return;
      }

      const value = res.value;

      if (!value.booking?.success) {
        out.failed.push({
          order_number,
          error:   value.booking?.error || 'Booking failed',
          booking: value.booking,
        });
        out.summary.failed++;
        return;
      }

      out.successful.push({
        order_number,
        booking:     value.booking,
        fulfillment: value.fulfillment,
        tag:         value.tag,
      });
      out.summary.success++;
      if (value.fulfillment?.status !== 'success') out.summary.fulfillment_failed++;
    });

    // Summary log
    console.log(
      `[batch-book-and-fulfill] DONE | total: ${out.summary.total} | ` +
      `success: ${out.summary.success} | failed: ${out.summary.failed} | ` +
      `fulfillment_failed: ${out.summary.fulfillment_failed}`
    );
    out.successful.forEach(s =>
      console.log(
        `  ✓ ${s.order_number} | tracking: ${s.booking?.tracking_number ?? 'n/a'} | ` +
        `slip: ${s.booking?.slip_link ?? 'n/a'} | ` +
        `shopify_fulfill: ${s.fulfillment?.status === 'success' ? 'ok' : 'FAILED'}`
      )
    );
    out.failed.forEach(f =>
      console.error(`  ✗ ${f.order_number} | error: ${f.error}`)
    );

    const allFailed   = out.summary.success === 0;
    const hasFailures = out.summary.failed > 0;

    return res.status(allFailed ? 400 : hasFailures ? 207 : 200).json({
      success: !allFailed,
      ...out,
    });

  } catch (error) {
    console.error('[batch-book-and-fulfill] unhandled error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
