// slip-kit/courierLogos.js
//
// Returns the courier logo URL straight from utils/courierCompanies — the
// single source of truth for everything courier-shaped (name, code, colour,
// aliases, logo). react-pdf fetches the remote image at render time; if it
// fails, the slip still renders without the logo (silent skip).

import { findCourier } from '../utils/courierCompanies.js';

const cache = new Map();

export function getCourierLogo(courierName) {
  const key = String(courierName || '').toUpperCase();
  if (cache.has(key)) return cache.get(key);

  const courier = findCourier(courierName);
  const url = courier?.logo || '';
  if (url) cache.set(key, url);
  return url;
}
