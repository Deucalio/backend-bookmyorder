// index.js
//
// Express entry point. Loads .env, mounts the courier kit router under
// /api/courier, and starts the HTTP server.

require('dotenv').config();

const express = require('express');
const courierRoutes = require('./courier-module-kit/courier.routes');
const fulfillmentRoutes = require('./fulfillment-kit/fulfillment.routes');
const orderSyncRoutes = require('./order-sync/routes');
const webhookProcessorRoutes = require('./webhook-processor/routes');
const slipRoutes = require('./slip-kit/slip.routes');
const invoiceRoutes = require('./invoice-kit/invoice.routes');
const adminRoutes = require('./admin-kit/admin.routes');
const { startTrackingSyncCron } = require('./tracking-sync/cron');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'backend-bookmyorder', uptime: process.uptime() });
});

app.use('/api/courier', courierRoutes);
app.use('/api/fulfillment', fulfillmentRoutes);
app.use('/api/orders', orderSyncRoutes);
app.use('/api/webhooks', webhookProcessorRoutes);
app.use('/api/slips', slipRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/admin', adminRoutes);

// Generic 404 / error handlers
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`backend-bookmyorder listening on http://localhost:${PORT}`);
  console.log(`Courier      API mounted at /api/courier`);
  console.log(`Fulfillment  API mounted at /api/fulfillment`);
  console.log(`Order Sync   API mounted at /api/orders`);
  console.log(`Webhooks     API mounted at /api/webhooks`);
  console.log(`Slips        API mounted at /api/slips`);
  console.log(`Invoices     API mounted at /api/invoices`);
  console.log(`Admin        API mounted at /api/admin`);
  startTrackingSyncCron();
});
