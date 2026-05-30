// Shopify REST API client with per-shop rate limiting and 429 retry.
//
// Shopify REST rate limit: 40-bucket leaky bucket, ~2 req/s restore rate per shop.
// We enforce 500ms minimum between calls to the same shop (= 2 req/s max).
// On 429 we honour the Retry-After header and retry up to MAX_RETRIES times.

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const MIN_INTERVAL_MS = 500;
const MAX_RETRIES = 4;

const lastRequestAt = new Map(); // shopDomain -> timestamp

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET a Shopify REST endpoint. Returns parsed JSON body.
 *
 * @param {string} shopDomain  e.g. "mystore.myshopify.com"
 * @param {string} accessToken  offline access token
 * @param {string} path  e.g. "/orders/123/fulfillment_orders.json"
 */
async function shopifyRestGet(shopDomain, accessToken, path) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Throttle: enforce min interval per shop across concurrent calls
    const now = Date.now();
    const last = lastRequestAt.get(shopDomain) || 0;
    const wait = Math.max(0, MIN_INTERVAL_MS - (now - last));
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(shopDomain, Date.now());

    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('Retry-After') || '1');
      console.log(
        `[shopify-api] 429 for ${shopDomain} ${path} — waiting ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Shopify REST ${res.status} ${res.statusText}: ${path}`);
    }

    return res.json();
  }

  throw new Error(`[shopify-api] Max retries exceeded for ${shopDomain} ${path}`);
}

module.exports = { shopifyRestGet };
