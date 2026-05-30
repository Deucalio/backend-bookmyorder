// slip-kit/renderSlips.js
//
// Maps booked-order payloads into label data (generating barcodes/QR codes as
// data URLs) and renders the multi-page shipping-label PDF to a Buffer.

import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import LabelDocument from './LabelDocument.jsx';
import { mapShippingLabelData } from './mapShippingLabelData.js';
import { getCourierLogo } from './courierLogos.js';

/**
 * @param {Array} slipOrders  Booked orders in the shape mapShippingLabelData expects.
 * @param {Array} stores      Optional [{ id, logo_url }] for the store logo.
 * @returns {Promise<Buffer>} The rendered PDF.
 */
export async function generateSlipsPdf(slipOrders, stores = []) {
  const labels = await mapShippingLabelData(slipOrders, stores, { getCourierLogo });
  return renderToBuffer(React.createElement(LabelDocument, { orders: labels }));
}
