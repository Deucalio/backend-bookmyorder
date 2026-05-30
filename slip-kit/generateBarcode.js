// slip-kit/generateBarcode.js
//
// Node-side Code-128 barcode generation using bwip-js' buffer API. Returns a
// PNG data URL ready to embed in the PDF via <Image src=... />. The browser
// version used a <canvas>; here we render straight to a Buffer.

import bwipjs from 'bwip-js';

/**
 * @param {string|number} text               String to encode.
 * @param {boolean}       [includeText=true]  Render human-readable text under the bars.
 * @returns {Promise<string|null>}            PNG data URL, or null when there is nothing to encode.
 */
export async function generateBarcode(text, includeText = true) {
  const value = String(text ?? '').trim();
  if (!value) return null;

  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: value,
      scale: 3,
      height: 10,
      includetext: includeText,
      textxalign: 'center',
    });
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (err) {
    console.error('generateBarcode failed:', err);
    return null;
  }
}
