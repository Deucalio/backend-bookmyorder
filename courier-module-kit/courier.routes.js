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

const router = express.Router();

// ----------------------------------------------------------------------------
// AUTH / PERMISSIONS
// These are no-op placeholders so the kit runs out of the box. Replace them
// with your project's real middleware, e.g.:
//
//   const { authenticateToken } = require('../middleware/auth');
//   const requirePermission = require('../middleware/requirePermission');
//
// then swap the two consts below for those imports.
// ----------------------------------------------------------------------------
const authenticateToken = (req, res, next) => next();
const requirePermission = () => (req, res, next) => next();

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
router.post('/batch-book-standardized', authenticateToken, requirePermission('orders:book'), async (req, res) => {
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
router.post('/batch-cancel', authenticateToken, requirePermission('orders:cancel'), async (req, res) => {
  try {
    const { payloads } = req.body;

    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ success: false, message: 'Payloads array is required' });
    }

    const results = await batchBookingService.processBatchCancellation(payloads);

    const allFailed = results.summary.success === 0;
    const hasFailures = results.summary.failed > 0;

    res.status(allFailed ? 400 : (hasFailures ? 207 : 200)).json({
      success: !allFailed,
      ...results
    });

  } catch (error) {
    console.error('Batch cancellation failed:', error);
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
router.post('/test-credentials', authenticateToken, async (req, res) => {
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

module.exports = router;
