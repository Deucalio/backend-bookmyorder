// downloadInvoice.js
//
// Renders the invoice view model to a PDF and saves it. Also exposes a
// blob/url helper for in-browser preview (e.g. open in a new tab) without
// forcing a download.
//
// Install:  npm i @react-pdf/renderer file-saver

import { pdf } from '@react-pdf/renderer';
import { saveAs } from 'file-saver';
import React from 'react';
import InvoiceDocument from './InvoiceDocument.jsx';
import { mapInvoiceData } from './mapInvoiceData.js';

/**
 * Build a PDF Blob from raw orders.
 * @param {Array} orders
 * @param {Array} stores
 * @param {Object} [options]  passed to mapInvoiceData (e.g. { currency })
 * @param {string} [options.footerNote]
 * @returns {Promise<Blob>}
 */
export async function buildInvoiceBlob(orders, stores = [], options = {}) {
  const invoice = mapInvoiceData(orders, stores, options);
  return pdf(
    <InvoiceDocument invoice={invoice} footerNote={options.footerNote} />
  ).toBlob();
}

/**
 * Build + trigger a browser download.
 * @returns {Promise<void>}
 */
export async function downloadInvoice(orders, stores = [], options = {}) {
  const valid = (orders || []).filter((o) => o && o.id);
  if (valid.length === 0) throw new Error('No orders to invoice');

  const blob = await buildInvoiceBlob(valid, stores, options);
  const filename = options.filename || `invoice-${Date.now()}.pdf`;
  saveAs(blob, filename);
}

/**
 * Build + return an object URL for preview (open in a new tab / <iframe>).
 * Caller is responsible for URL.revokeObjectURL when done.
 * @returns {Promise<string>}
 */
export async function previewInvoiceUrl(orders, stores = [], options = {}) {
  const blob = await buildInvoiceBlob(orders, stores, options);
  return URL.createObjectURL(blob);
}
