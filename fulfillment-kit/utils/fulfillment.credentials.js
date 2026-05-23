// fulfillment-kit/utils/fulfillment.credentials.js
//
// Pluggable Shopify store credential resolution.
//
// Two ways to supply credentials per request:
//
//   1. INLINE  — pass `credentials: { platform_store_id, access_token }` directly
//                in the payload. No database needed.
//
//   2. ADAPTER — pass `store_id` (a string key from your DB) in the payload,
//                and register a lookup once at app startup that resolves it
//                to { platform_store_id, access_token }.
//
// Inline always wins if both are present.
//
// ----------------------------------------------------------------------------
// Registering the adapter (once at app bootstrap):
//
//   const { setCredentialLookup } = require('./fulfillment-kit/utils/fulfillment.credentials');
//
//   setCredentialLookup(async (store_id) => {
//     const row = await db.store.findUnique({ where: { id: store_id } });
//     if (!row) return null;
//     return { platform_store_id: row.platform_store_id, access_token: row.access_token };
//   });
// ----------------------------------------------------------------------------

let credentialLookup = null;

/** Register the DB adapter that turns a store_id into { platform_store_id, access_token }. */
function setCredentialLookup(fn) {
  if (typeof fn !== 'function') throw new Error('setCredentialLookup expects a function');
  credentialLookup = fn;
}

/**
 * Resolve Shopify store credentials from a payload.
 *
 * Resolution order:
 *   1. payload.credentials object (inline)
 *   2. payload.store_id string → registered adapter lookup
 *
 * @param {Object} payload
 * @returns {Promise<{ platform_store_id: string, access_token: string }>}
 */
async function resolveStoreCredentials(payload) {
  // 1. Inline credentials — highest priority.
  if (payload.credentials && typeof payload.credentials === 'object') {
    const { platform_store_id, access_token } = payload.credentials;
    if (!platform_store_id || !access_token) {
      throw new Error('Inline credentials must include both platform_store_id and access_token');
    }
    return { platform_store_id, access_token };
  }

  // 2. store_id string — resolve via registered adapter.
  const id = payload.store_id;
  if (id && typeof id === 'string') {
    if (!credentialLookup) {
      throw new Error(
        'No credential lookup adapter registered. Either pass `credentials` inline ' +
        'in the payload, or call setCredentialLookup() at app startup.'
      );
    }
    const store = await credentialLookup(id);
    if (!store?.platform_store_id || !store?.access_token) {
      throw new Error(`Store not found or missing credentials for store_id: ${id}`);
    }
    return { platform_store_id: store.platform_store_id, access_token: store.access_token };
  }

  throw new Error(
    'No store credentials provided. Pass `credentials: { platform_store_id, access_token }` ' +
    'inline, or pass a `store_id` string and register a setCredentialLookup() adapter.'
  );
}

module.exports = {
  setCredentialLookup,
  resolveStoreCredentials,
};
