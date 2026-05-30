// invoice-kit/invoice.routes.js
//
// Server-side customer-invoice generation. The Shopify app proxies a payload
// of orders here; we render the PDF and stream the bytes back. Plain CommonJS
// so it loads before @babel/register hooks the ESM/JSX modules (required
// lazily below, after register runs).

require('./register');

const express = require('express');
const { generateInvoicePdf } = require('./renderInvoice');

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    console.error('[invoices] INTERNAL_SECRET not set — rejecting request');
    return res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// POST /api/invoices/generate
// Body: { orders: [...], stores?: [...], currency?: string, footerNote?: string }
// → application/pdf
router.post('/generate', requireInternalSecret, async (req, res) => {
  try {
    const { orders, stores, currency, footerNote } = req.body || {};
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, error: 'orders array is required' });
    }

    console.log(`[invoices/generate] rendering ${orders.length} order(s)`);
    const pdf = await generateInvoicePdf(orders, Array.isArray(stores) ? stores : [], {
      currency: currency || 'PKR',
      footerNote,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="invoices.pdf"');
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (error) {
    console.error('[invoices/generate] error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Invoice generation failed' });
  }
});

module.exports = router;
