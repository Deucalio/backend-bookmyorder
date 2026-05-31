// utils/pdfWarmup.js
//
// First call into @react-pdf/renderer's renderToBuffer is ~5-10s slower than
// subsequent ones — the library lazily wires up its layout engine, font
// cache, and image pipeline on first use. Without this warm-up the very
// first /api/slips/generate or /api/invoices/generate after process start
// often blows past Nginx's proxy_read_timeout and the merchant sees a 503
// (next click works because the pipeline is now cached).
//
// Called from index.js after app.listen — failures are non-fatal so the
// server still serves the rest of the API even if warm-up trips.

async function warmupPdfPipeline() {
  const startedAt = Date.now();
  try {
    // Trigger the JSX/ESM compilation hooks the kits depend on.
    require('../slip-kit/register');
    require('../invoice-kit/register');

    const React = require('react');
    const { renderToBuffer, Document, Page, Text } = require('@react-pdf/renderer');

    await renderToBuffer(
      React.createElement(
        Document,
        null,
        React.createElement(
          Page,
          { size: 'A4' },
          React.createElement(Text, null, 'warmup'),
        ),
      ),
    );

    console.log(`[pdf-warmup] react-pdf pipeline ready in ${Date.now() - startedAt}ms`);
  } catch (err) {
    console.warn('[pdf-warmup] failed (non-fatal):', err.message);
  }
}

module.exports = { warmupPdfPipeline };
