const express = require('express');
const { dispatch } = require('./handlers');

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    console.error('[webhook-processor] INTERNAL_SECRET not set — rejecting request');
    return res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// POST /api/webhooks/process
// Body: { shopDomain, webhookId, topic, payload }
// Called by the Remix app after HMAC verification. Responds 200 immediately;
// processing happens synchronously so Shopify gets an ack within its timeout.
router.post('/process', requireInternalSecret, async (req, res) => {
  const { shopDomain, webhookId, topic, payload } = req.body;

  if (!shopDomain || !webhookId || !topic) {
    return res.status(400).json({ success: false, error: 'Missing shopDomain, webhookId, or topic' });
  }

  try {
    await dispatch(shopDomain, webhookId, topic, payload ?? {});
    return res.json({ success: true });
  } catch (err) {
    console.error('[webhook-processor] Unhandled error in /process:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

module.exports = router;
