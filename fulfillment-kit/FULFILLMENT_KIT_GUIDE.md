# Shopify Fulfillment Kit

A drop-in, framework-light kit for marking Shopify orders as fulfilled the
moment a courier booking succeeds.

It mirrors the **courier-module-kit** pattern: build a standardized payload,
call one function, get a consistent response shape. No Prisma, no Shopify SDK,
no framework lock-in — just Node 18+ global `fetch` and Express for the router.

---

## Instructions for Claude (read this first)

You are being handed this kit to integrate into an **Express** project. Do the
following:

1. **Copy the files** (see the file list below) into the project — keep the
   `fulfillment-kit/` folder, or move them wherever the project keeps modules.
   If you move them, fix the relative `import` paths accordingly.
2. **Mount the router.** Add `app.use('/api/fulfillment', fulfillmentRoutes)`
   to the app's entrypoint. The app must be ESM (`"type": "module"` in
   `package.json`) — every file uses `import`/`export`.
3. **Wire auth.** `fulfillment.routes.js` ships no-op `authenticateToken` /
   `requirePermission` placeholders. Replace them with the project's real
   middleware if it has any; otherwise leave the no-ops.
4. **Wire credentials.** Decide per the project:
   - If callers will send store credentials inline in each request → nothing to do.
   - If the project stores Shopify tokens in a DB → register an adapter at
     startup with `setCredentialLookup(...)` (see **Credentials** below).
5. **Call `markFulfillment` after a successful courier booking.** This is the
   primary integration point — see **Courier + Fulfillment together** below.

Do **not** change the payload field names or response shapes — they are
referenced throughout this doc and kept consistent with the courier-module-kit.

---

## Files in this kit

```
fulfillment-kit/
├── FULFILLMENT_KIT_GUIDE.md            ← this file
├── fulfillment.routes.js               ← Express router (5 endpoints)
└── utils/
    ├── shopify.fulfillment.js          ← core GraphQL ops: mark, cancel, fetch, tag
    ├── fulfillment.credentials.js      ← pluggable store credential resolution
    ├── batch.fulfillment.service.js    ← parallel batch mark / cancel
    └── shopify.throttle.js             ← Shopify API rate-limit helper
```

**Requirements:** Node 18+ (global `fetch`), ESM modules, Express.  
No database and no extra npm packages are required by the kit itself.

---

## Architecture

```
HTTP request
   │
   ▼
fulfillment.routes.js ──────────────► batch.fulfillment.service.js  (batch endpoints)
   │                                            │
   │ (single endpoints)                         │ runs payloads in parallel
   ▼                                            ▼
shopify.fulfillment.js  ◄────────────────────────
   │  markFulfillment()
   │  cancelFulfillment()
   │  getOpenFulfillmentOrders()
   │  tagOrder()
   │
   ├──► fulfillment.credentials.js   (resolve platform_store_id + access_token)
   └──► shopify.throttle.js          (waitForCredits — Shopify bucket throttle)
```

---

## The Standardized Payloads

### FulfillmentMarkPayload — `POST /mark` and each element of `POST /batch-mark`

```jsonc
{
  // Credentials — supply ONE of these two (see "Credentials" section):
  "credentials": {
    "platform_store_id": "mystore.myshopify.com",   // the Shopify store domain
    "access_token": "shpat_xxxxxxxxxxxxxxxxxxxx"
  },
  // ...OR pass a store_id string that your DB adapter resolves:
  "store_id": "internal-db-id",

  "fulfillment_order_id": "1234567890",   // REQUIRED — Shopify FulfillmentOrder ID
                                          // numeric string or full GID both accepted
  "tracking_number":  "HD75XXXXXXXXXX",   // REQUIRED — courier CN/tracking number
  "tracking_url":     "https://...",      // optional — deeplink to tracking page
  "courier":          "Leopards",         // optional — courier company name
  "notify_customer":  true                // optional — default true
}
```

### FulfillmentCancelPayload — `POST /cancel`

```jsonc
{
  "credentials": { ... },     // OR "store_id": "..."
  "fulfillment_id": "gid://shopify/Fulfillment/9876543210"
  // The fulfillment GID is returned in the `data.id` field of a successful markFulfillment.
}
```

### FetchOrdersPayload — `POST /fetch-orders`

```jsonc
{
  "credentials": { ... },     // OR "store_id": "..."
  "platform_order_id": "5551234567890"   // numeric Shopify order ID
}
```

Use this endpoint when you only have a Shopify order ID and need to discover
which `fulfillment_order_id`(s) exist (there may be more than one if the order
has multiple locations).

### TagOrderPayload — `POST /tag-order`

```jsonc
{
  "credentials": { ... },     // OR "store_id": "..."
  "platform_order_id": "5551234567890",
  "tags": "Packed"            // string or array of strings
}
```

---

## API Endpoints

All paths are relative to wherever you mount the router (this doc assumes
`/api/fulfillment`).

### 1. Mark Single — `POST /api/fulfillment/mark`

**Body:** FulfillmentMarkPayload.

**Success (200):**
```json
{
  "success": true,
  "status": "success",
  "data": {
    "id": "gid://shopify/Fulfillment/9876543210",
    "status": "SUCCESS",
    "trackingInfo": {
      "number": "HD75XXXXXXXXXX",
      "url": "https://...",
      "company": "Leopards"
    }
  }
}
```

**Failure (400):**
```json
{
  "success": false,
  "status": "failed",
  "error": "null: Fulfillment order is already fulfilled"
}
```

### 2. Batch Mark — `POST /api/fulfillment/batch-mark`

Accepts an array and processes every payload **in parallel**. One failure never
blocks the others.

**Body:**
```json
{
  "payloads": [
    { "credentials": { ... }, "fulfillment_order_id": "111", "tracking_number": "HD001" },
    { "store_id": "store-abc", "fulfillment_order_id": "222", "tracking_number": "HD002" }
  ]
}
```

**Response — `200` all ok · `207` partial success · `400` all failed:**
```json
{
  "success": true,
  "successful": [
    { "fulfillment_order_id": "111", "status": "success", "data": { ... } }
  ],
  "failed": [
    { "fulfillment_order_id": "222", "error": "null: Fulfillment order is already fulfilled" }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1 }
}
```

### 3. Cancel — `POST /api/fulfillment/cancel`

**Body:** FulfillmentCancelPayload.

**Success (200):**
```json
{
  "success": true,
  "status": "success",
  "data": { "id": "gid://shopify/Fulfillment/9876543210", "status": "CANCELLED" }
}
```

### 4. Fetch Open Orders — `POST /api/fulfillment/fetch-orders`

Returns all open/on-hold fulfillment orders for a given Shopify order ID.
Use this before calling `/mark` when you don't already have the
`fulfillment_order_id`.

**Body:** FetchOrdersPayload.

**Success (200):**
```json
{
  "success": true,
  "status": "success",
  "fulfillment_orders": [
    {
      "fulfillment_order_id": "1234567890",
      "fulfillment_order_gid": "gid://shopify/FulfillmentOrder/1234567890",
      "status": "OPEN",
      "line_items": [
        {
          "fulfillment_order_line_item_id": "9876543210",
          "fulfillment_order_quantity": 2,
          "line_item_id": "1111111111",
          "variant_id": "2222222222",
          "sku": "PROD-SKU-001",
          "title": "Blue T-Shirt"
        }
      ]
    }
  ]
}
```

**Not found (404):**
```json
{ "success": false, "status": "no_fulfillment_orders", "message": "No open fulfillment orders found" }
```

### 5. Tag Order — `POST /api/fulfillment/tag-order`

**Body:** TagOrderPayload.

**Success (200):**
```json
{ "success": true, "status": "success" }
```

---

## Credentials — two ways to supply Shopify tokens

Every request needs the Shopify store's `platform_store_id` (the `.myshopify.com`
domain) and `access_token`. Supply them either way; **inline always wins**.

### Option A — Inline (no database)

Put the tokens straight in the payload under `credentials`:

```json
{
  "credentials": {
    "platform_store_id": "mystore.myshopify.com",
    "access_token": "shpat_xxxxxxxxxxxxxxxxxxxx"
  },
  "fulfillment_order_id": "1234567890",
  "tracking_number": "HD75XXXXXXXXXX"
}
```

Nothing to configure — `resolveStoreCredentials()` uses them directly.

### Option B — DB adapter

Send `store_id` (your internal ID string) and register a lookup once at app
startup:

```js
// app bootstrap (e.g. server.js / app.js)
import { setCredentialLookup } from './fulfillment-kit/utils/fulfillment.credentials.js';

setCredentialLookup(async (store_id) => {
  const row = await db.store.findUnique({ where: { id: store_id } });
  if (!row) return null;
  return {
    platform_store_id: row.platform_store_id,   // "mystore.myshopify.com"
    access_token: row.access_token              // "shpat_..."
  };
});
```

Then payloads only need:
```json
{ "store_id": "internal-db-id", "fulfillment_order_id": "...", "tracking_number": "..." }
```

If `store_id` is sent but no adapter is registered, the kit throws a clear error
telling the caller to register one or send `credentials` inline.

---

## Courier + Fulfillment together

The most common pattern — call `markFulfillment` immediately after the courier
booking succeeds, using the tracking number returned by the courier:

```js
import courierFactory from './courier-module-kit/utils/courier.factory.js';
import { markFulfillment } from './fulfillment-kit/utils/shopify.fulfillment.js';

async function bookAndFulfill(orderPayload, storeCredentials) {
  // 1. Book with courier (LCS / TCS)
  const courierService = courierFactory.getService(orderPayload.courier);
  const bookingResult = await courierService.bookOrder(orderPayload);

  if (!bookingResult.success) {
    return { success: false, error: bookingResult.error };
  }

  // 2. Mark fulfilled on Shopify immediately
  const fulfillmentResult = await markFulfillment({
    credentials: storeCredentials,           // { platform_store_id, access_token }
    fulfillment_order_id: orderPayload.order_info.fulfillment_order_id,
    tracking_number: bookingResult.tracking_number,
    tracking_url: bookingResult.tracking_url,
    courier: bookingResult.courier_name,
    notify_customer: true,
  });

  return {
    success: fulfillmentResult.status === 'success',
    booking: bookingResult,
    fulfillment: fulfillmentResult,
  };
}
```

---

## fulfillment_order_id vs fulfillment_id — what's what

These are two different Shopify concepts and are easy to confuse:

| Field                  | What it is                                   | Where you get it                  | Used by                |
|------------------------|----------------------------------------------|-----------------------------------|------------------------|
| `fulfillment_order_id` | The **work order** Shopify creates for an order (what to ship, from where) | `GET /fetch-orders`, or stored when order synced | `markFulfillment`      |
| `fulfillment_id`       | The **shipment record** created when you mark fulfilled | Returned in `markFulfillment` → `data.id` | `cancelFulfillment`    |

**In short:** you *mark* a `fulfillment_order`, and that creates a `fulfillment`.
If you need to cancel, you cancel the `fulfillment` (not the order).

---

## Shopify API version

The kit targets `2024-04`. To bump it, edit the one constant at the top of
`utils/shopify.fulfillment.js`:

```js
const SHOPIFY_API_VERSION = '2024-04';
```

---

## GID handling

Shopify uses Global IDs like `gid://shopify/FulfillmentOrder/1234567890`.
The kit accepts both numeric strings (`"1234567890"`) and full GIDs —
`toGid()` normalizes them transparently. Returned IDs in responses are always
full GIDs; the kit also exposes the numeric `fulfillment_order_id` field
alongside `fulfillment_order_gid` in `getOpenFulfillmentOrders` responses for
convenience.

---

## Rate limiting

Shopify's GraphQL API uses a **bucket throttle** (default 1000 points,
restores at 50/second). After each response, `shopify.throttle.js` checks
`extensions.cost.throttleStatus` and sleeps automatically if the bucket is
running low. No manual retry logic needed — all four operations use this
transparently.

---

## Error shapes

Every function in `shopify.fulfillment.js` returns either:

```json
{ "status": "success", "data": { ... } }
```
or
```json
{ "status": "failed",  "error": "descriptive message" }
```

The routes translate this to HTTP status codes:
- `200` — success
- `207` — partial success (batch only)
- `400` — Shopify userError or validation failure
- `404` — no fulfillment orders found (`/fetch-orders` only)
- `500` — unexpected exception

---

## Adding a post-fulfillment hook (e.g. tagging)

After `markFulfillment` succeeds you might want to tag the order. Use `tagOrder`
directly — it takes the same credentials shape:

```js
if (fulfillmentResult.status === 'success') {
  await tagOrder({
    credentials: storeCredentials,
    platform_order_id: order.platform_order_id,
    tags: ['Packed'],
  });
}
```

Or call `POST /api/fulfillment/tag-order` from the client side.
