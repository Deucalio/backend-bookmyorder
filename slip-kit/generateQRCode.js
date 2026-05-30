// slip-kit/generateQRCode.js
//
// QR code generation using the `qrcode` npm package (Node-compatible). Returns
// a PNG data URL ready to embed in the PDF via <Image src=... />.

import QRCode from 'qrcode';

/**
 * @param {string} text  Payload to encode.
 * @returns {Promise<string|undefined>}  data URL (image/png) or undefined on error.
 */
export async function generateQRCode(text) {
  try {
    return await QRCode.toDataURL(String(text ?? ''), {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.error('generateQRCode failed:', err);
    return undefined;
  }
}
