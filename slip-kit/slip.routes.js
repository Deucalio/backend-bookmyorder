// slip-kit/slip.routes.js
//
// Server-side shipping-slip generation. The Shopify app proxies a booked-order
// payload here; we render the PDF with @react-pdf/renderer and stream the bytes
// back. Plain CommonJS so it loads before @babel/register hooks the slip-kit
// ESM/JSX modules (required lazily below, after register runs).

require('./register');

const express = require('express');
const { generateSlipsPdf } = require('./renderSlips');

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    console.error('[slips] INTERNAL_SECRET not set — rejecting request');
    return res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// POST /api/slips/generate
// Body: { slipOrders: [...] }  → application/pdf
router.post('/generate', requireInternalSecret, async (req, res) => {
  try {
    const { slipOrders, stores } = req.body || {};
    if (!Array.isArray(slipOrders) || slipOrders.length === 0) {
      return res.status(400).json({ success: false, error: 'slipOrders array is required' });
    }

    console.log(`[slips/generate] rendering ${slipOrders.length} order(s)`);
    const pdf = await generateSlipsPdf(slipOrders, Array.isArray(stores) ? stores : []);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="slips.pdf"');
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (error) {
    console.error('[slips/generate] error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Slip generation failed' });
  }
});

module.exports = router;
