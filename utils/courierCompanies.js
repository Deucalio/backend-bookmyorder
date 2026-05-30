// utils/courierCompanies.js
//
// CommonJS mirror of book-my-order/utils/courierCompanies.js. Keep the two in
// sync — single source of truth for everything courier-shaped: codes, display
// names, logo URLs, brand colour, and the aliases used by Shopify-side string
// matching (tracking_info.company → our code).

const COURIER_COMPANIES = [
  {
    id: 'leopards',
    name: 'Leopards Courier',
    courier_code: 'LCS',
    courier_name: 'Leopards Courier',
    possible_matches: ['leopards', 'leopards courier services', 'lcs'],
    color: '#FFA500',
    logo: 'https://trackmyorder.pk/leopards-logo.png',
  },
  {
    id: 'tcs',
    name: 'TCS Express',
    courier_code: 'TCS',
    courier_name: 'TCS Express',
    possible_matches: ['tcs', 'tcs (overnight) pesh', 'tcs (overland) pesh', 'tcs express'],
    color: '#FF0000',
    logo: 'https://trackmyorder.pk/TCS.svg',
  },
];

/** Look up a courier entry by any of its known identifiers (case-insensitive). */
function findCourier(identifier) {
  if (!identifier) return null;
  const needle = String(identifier).trim().toLowerCase();
  for (const c of COURIER_COMPANIES) {
    if (
      c.id === needle ||
      c.courier_code.toLowerCase() === needle ||
      c.possible_matches.some((m) => m.toLowerCase() === needle)
    ) {
      return c;
    }
  }
  return null;
}

module.exports = { COURIER_COMPANIES, findCourier };
