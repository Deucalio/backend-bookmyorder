// invoice-kit/renderInvoice.js
//
// Maps raw orders → invoice view-model → renders the A4 PDF to a Buffer
// using @react-pdf/renderer. Mirrors slip-kit/renderSlips.

import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import InvoiceDocument from './frontend/InvoiceDocument.jsx';
import { mapInvoiceData } from './frontend/mapInvoiceData.js';

/**
 * @param {Array}  orders   Raw orders (see mapInvoiceData input shape).
 * @param {Array}  stores   [{ id, name, logo_url, address, phone, email }]
 * @param {Object} [options]  passed through to mapInvoiceData (e.g. { currency }).
 * @returns {Promise<Buffer>}  The rendered PDF.
 */
export async function generateInvoicePdf(orders, stores = [], options = {}) {
  const invoice = mapInvoiceData(orders, stores, options);
  return renderToBuffer(
    React.createElement(InvoiceDocument, { invoice, footerNote: options.footerNote }),
  );
}
