// courier-module-kit/utils/courier.credentials.js
//
// Pluggable credential resolution for the courier kit.
//
// There are TWO supported ways to supply courier API keys:
//
//   1. INLINE  — pass a `credentials` object directly inside the booking /
//                cancel payload. No database required. Best for simple apps
//                or single-account setups.
//
//   2. ADAPTER — pass a `courier_account_id` string in the payload, and
//                register a lookup function ONCE at app startup that resolves
//                that id to an `access_data` object from your own database.
//                Keeps secrets out of the request body.
//
// Inline credentials always win if both are present.
//
// ----------------------------------------------------------------------------
// Registering the adapters (do this once in your app bootstrap):
//
//   const { setCredentialLookup, setCityLookup } = require('./utils/courier.credentials');
//
//   setCredentialLookup(async (id) => {
//     const row = await db.courier.findUnique({ where: { id } });
//     if (!row) return null;
//     return { access_data: row.access_data };   // see "credential shapes" in the guide
//   });
//
//   // Optional — only needed if you want TCS to resolve a city id -> city name.
//   setCityLookup(async (id) => {
//     return db.courierCity.findUnique({ where: { id } });
//   });
// ----------------------------------------------------------------------------

let credentialLookup = null;
let cityLookup = null;

/** Register the DB adapter that turns a courier_account_id into access_data. */
function setCredentialLookup(fn) {
  if (typeof fn !== 'function') throw new Error('setCredentialLookup expects a function');
  credentialLookup = fn;
}

/** Register the optional adapter that turns a city id into a city name (TCS). */
function setCityLookup(fn) {
  if (typeof fn !== 'function') throw new Error('setCityLookup expects a function');
  cityLookup = fn;
}

/**
 * Resolve courier access_data (API keys) for a booking/cancel payload.
 *
 * Resolution order:
 *   1. payload.credentials                       -> used directly (inline mode)
 *   2. payload.courier_account_id is an object   -> its .access_data (or itself)
 *   3. payload.courier_account_id is a string    -> registered adapter lookup
 *
 * @param {Object} payload - standardized booking or cancel payload
 * @returns {Promise<Object>} access_data object
 */
async function resolveAccessData(payload) {
  // 1. Inline credentials — highest priority.
  if (payload.credentials && typeof payload.credentials === 'object') {
    return payload.credentials;
  }

  const id = payload.courier_account_id;

  // 2. courier_account_id passed as an object that already carries access_data
  //    (used by the verify-courier flow, or when the caller already has it).
  if (id && typeof id === 'object') {
    return id.access_data || id;
  }

  // 3. courier_account_id is a string — resolve via the registered adapter.
  if (id && typeof id === 'string') {
    if (!credentialLookup) {
      throw new Error(
        'No credential lookup adapter registered. Either pass `credentials` inline ' +
        'in the payload, or call setCredentialLookup() at app startup.'
      );
    }
    const courier = await credentialLookup(id);
    const access_data = courier?.access_data || courier;
    if (!access_data) throw new Error('Courier account not found or missing access data');
    return access_data;
  }

  throw new Error('No credentials provided: pass `credentials` inline or a `courier_account_id`.');
}

/**
 * Optional city resolver. TCS books with a city *name*; if the caller only has
 * an internal city id, this turns it into a name. Returns null when no adapter
 * is registered (the courier service then falls back to customer_info.city).
 *
 * @param {string|number} cityId
 * @returns {Promise<string|null>}
 */
async function resolveCityName(cityId) {
  if (!cityId || !cityLookup) return null;
  try {
    const city = await cityLookup(cityId);
    return city?.metadata?.cityName || city?.meta_data?.cityName || city?.city_name || city?.name || null;
  } catch (err) {
    console.warn('[courier.credentials] city lookup failed:', err.message);
    return null;
  }
}

module.exports = {
  setCredentialLookup,
  setCityLookup,
  resolveAccessData,
  resolveCityName,
};
