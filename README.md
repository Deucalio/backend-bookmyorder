# backend-bookmyorder — API Reference

Express backend exposing a unified **courier booking** + **Shopify fulfillment**
API on top of **Leopards (LCS)** and **TCS** (couriers) and the **Shopify Admin
GraphQL API** (fulfillment). Every endpoint speaks one standardized payload —
callers never talk to a courier's or Shopify's native API directly.

This file is the single source of truth for everything an integrator (or another
Claude session) needs. You should not have to read the kit source.

- Stack: Node 18+ (uses global `fetch`), Express 4, CommonJS.
- Source layout: [`courier-module-kit/`](./courier-module-kit/) and
  [`fulfillment-kit/`](./fulfillment-kit/).
- Mount points: `/api/courier`, `/api/fulfillment`.

---

## Quick start

```powershell
cd "d:\vscode\ofce\bookmyorder - shopify\backend-bookmyorder"
npm install
Copy-Item .env.example .env   # edit values if needed
npm run dev                   # node --watch index.js
```

Server listens on `http://localhost:3000` by default. Verify with:

```bash
curl http://localhost:3000/health
# { "ok": true, "service": "backend-bookmyorder", "uptime": 0.42 }
```

---

## Endpoint index

### Courier (`/api/courier/*`)

| # | Method | Path | Purpose | Couriers |
|---|---|---|---|---|
| 0 | GET  | `/health` | Liveness check | — |
| 1 | POST | `/api/courier/book-standardized` | Book a single parcel | LCS, TCS |
| 2 | POST | `/api/courier/batch-book-standardized` | Book many parcels in parallel | LCS, TCS |
| 3 | POST | `/api/courier/batch-cancel` | Cancel many parcels in parallel | LCS, TCS |
| 4 | POST | `/api/courier/verify-courier` | Heavy creds check — books + cancels a real parcel | LCS, TCS |
| 5 | POST | `/api/courier/test-credentials` | Light creds check — no booking made | LCS, TCS |
| 6 | POST | `/api/courier/tcs/auth-token` | Fetch a fresh TCS `accesstoken` from `bearertoken + username + password` | TCS |
| 7 | POST | `/api/courier/book-and-fulfill` | Book a parcel AND mark the Shopify fulfillment order fulfilled in one round trip | LCS, TCS |
| 8 | POST | `/api/courier/batch-book-and-fulfill` | Bulk book + mark fulfilled (parallel, partial-success 207) | LCS, TCS |

### Shopify fulfillment (`/api/fulfillment/*`)

| # | Method | Path | Purpose |
|---|---|---|---|
| F1 | POST | `/api/fulfillment/mark` | Mark a single Shopify fulfillment order as fulfilled with tracking info |
| F2 | POST | `/api/fulfillment/batch-mark` | Mark many fulfillment orders in parallel |
| F3 | POST | `/api/fulfillment/cancel` | Cancel a Shopify fulfillment |
| F4 | POST | `/api/fulfillment/fetch-orders` | Look up open / on-hold fulfillment orders for a Shopify order |
| F5 | POST | `/api/fulfillment/tag-order` | Add tags to a Shopify order |

---

## 0. `GET /health`

Liveness probe. No auth, no body.

**Response 200**
```json
{ "ok": true, "service": "backend-bookmyorder", "uptime": 12.34 }
```

---

## 1. `POST /api/courier/book-standardized`

Book a single parcel through any supported courier.

**Body** — the [Standardized Booking Payload](#standardized-booking-payload).

**Response 200 — success**
```json
{
  "success": true,
  "courier_name": "LCS",
  "courier_company": "LCS",
  "tracking_number": "HD7512345678",
  "tracking_url": "https://trackmyorder.pk/?tracking_no=HD7512345678&courier=leopards",
  "slip_link": "https://merchantapi.leopardscourier.com/slip/HD7512345678",
  "courier_reference": "HD7512345678",
  "response_data": { /* raw courier response */ }
}
```

**Response 400 — failure**
```json
{
  "success": false,
  "courier_name": "LCS",
  "courier_company": "LCS",
  "error": "Missing customer_info.city_id"
}
```

**Response 500** — internal error (`error.message` populated).

**Example**
```bash
curl -X POST http://localhost:3000/api/courier/book-standardized \
  -H "Content-Type: application/json" \
  -d '{
    "courier": "LCS",
    "credentials": { "api_key": "...", "api_password": "..." },
    "order_info":    { "order_number": "ORD-101", "cod_amount": 1500, "weight": 0.5 },
    "customer_info": { "name": "John Doe", "phone": "03001234567",
                       "address": "456 Side St, Lahore", "city_id": 789 },
    "courier_data":  { "service_type": "OVERNIGHT", "origin_city_id": 1 }
  }'
```

---

## 2. `POST /api/courier/batch-book-standardized`

Book many parcels concurrently. One bad parcel never blocks the rest.

**Body**
```json
{
  "payloads": [
    { "courier": "LCS", "credentials": { /*...*/ }, "order_info": {/*...*/}, "customer_info": {/*...*/}, "courier_data": {/*...*/} },
    { "courier": "TCS", "credentials": { /*...*/ }, "order_info": {/*...*/}, "customer_info": {/*...*/}, "courier_data": {/*...*/} }
  ]
}
```

Each element follows the [Standardized Booking Payload](#standardized-booking-payload).

**Status codes**
- `200` — all parcels booked.
- `207` — partial success (some failed).
- `400` — every parcel failed, or `payloads` was missing/empty.

**Response body**
```json
{
  "success": true,
  "successful": [
    { "order_number": "ORD-101", "success": true, "tracking_number": "HD75...",
      "courier_name": "LCS", "tracking_url": "...", "response_data": {} }
  ],
  "failed": [
    { "order_number": "ORD-102", "error": "Invalid City ID" }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1 }
}
```

---

## 3. `POST /api/courier/batch-cancel`

Cancel many parcels concurrently.

**Body**
```json
{
  "payloads": [
    { "courier": "LCS", "tracking_number": "HD7512345678", "credentials": { /*...*/ }, "reason": "optional" },
    { "courier": "TCS", "tracking_number": "07641122334",  "credentials": { /*...*/ }, "reason": "optional" }
  ]
}
```

**Status codes** — same as batch booking: `200` / `207` / `400`.

**Response body** — same shape as batch booking, but each entry keys on `tracking_number` instead of `order_number`.

```json
{
  "success": true,
  "successful": [
    { "tracking_number": "HD7512345678", "success": true, "courier_name": "LCS",
      "message": "Order cancelled successfully", "response_data": {} }
  ],
  "failed": [
    { "tracking_number": "07641122334", "error": "CN already cancelled or not found" }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1 }
}
```

---

## 4. `POST /api/courier/verify-courier`

**Heavy** credential check. Books a real test parcel with the supplied
credentials and then cancels it immediately. Run this when a user adds or
edits a courier account. Prefer sandbox creds where available — this creates
a genuine consignment on the courier's system before cancelling.

**Body**
```json
{
  "courier": "LCS",
  "credentials": { "api_key": "...", "api_password": "..." }
}
```

For TCS:
```json
{
  "courier": "TCS",
  "credentials": {
    "bearertoken": "...",
    "accesstoken": "...",
    "account_number": "704576",
    "shipper_details": { "name": "Verification Store", "address": "...", "phone": "03001234567",
                         "cityName": "Karachi", "cityCode": "KHI", "cost_center_code": "034" }
  }
}
```

**Response 200**
```json
{
  "success": true,
  "message": "API Credentials verified successfully! Test parcel was booked and successfully cancelled.",
  "tracking_number": "HD7512345678",
  "booking_result": { /*...*/ },
  "cancellation_result": { /*...*/ }
}
```

**Response 400** — booking failed (creds invalid, missing fields, courier API rejected).
**Response 500** — internal/server error.

---

## 5. `POST /api/courier/test-credentials`

**Light** credential check. **No parcel is created.** Use this for everyday
"are these keys still valid?" checks.

| Courier | What gets called |
|---|---|
| LCS | `POST /getAllCities/format/json/` — needs `api_key` + `api_password`. Valid if `status == 1`. |
| TCS | `GET /api/authentication/token?username=&password=` (with `Authorization: Bearer <bearertoken>`) if all three of `bearertoken + username + password` are supplied. Otherwise a shape check on `bearertoken` + `accesstoken`. |

**Body — LCS**
```json
{
  "courier": "LCS",
  "credentials": { "api_key": "...", "api_password": "..." }
}
```

**Body — TCS (live check)**
```json
{
  "courier": "TCS",
  "credentials": { "bearertoken": "...", "username": "...", "password": "..." }
}
```

**Body — TCS (shape-only check)**
```json
{
  "courier": "TCS",
  "credentials": { "bearertoken": "...", "accesstoken": "..." }
}
```

**Response 200 — LCS success**
```json
{
  "success": true,
  "courier_name": "LCS",
  "courier_company": "LCS",
  "message": "LCS credentials are valid.",
  "cities_count": 142
}
```

**Response 200 — TCS success (live)**
```json
{
  "success": true,
  "courier_name": "TCS",
  "courier_company": "TCS",
  "message": "TCS credentials are valid — fresh access token obtained.",
  "accesstoken": "eyJhbGciOi..."
}
```

**Response 400 — failure**
```json
{
  "success": false,
  "courier_name": "LCS",
  "courier_company": "LCS",
  "error": "Authentication failed"
}
```

---

## 6. `POST /api/courier/tcs/auth-token`

Fetch a fresh short-lived TCS `accesstoken`. Wraps TCS' native
`GET /api/authentication/token?username=&password=`, which itself requires a
long-lived `Authorization: Bearer <bearertoken>` header — so all three fields
are required.

**Body**
```json
{
  "bearertoken": "long-lived-bearer-token",
  "username":    "tcs-username",
  "password":    "tcs-password"
}
```

**Response 200** — real example from TCS production:
```json
{
  "success": true,
  "courier_name": "TCS",
  "courier_company": "TCS",
  "message": "TCS access token retrieved successfully.",
  "accesstoken": "zIhp3fihZtm%2FMFdWmgTu%2BlG1QiJG2nyLo7ThzEGNPx5jit0THlPIcJ9JGWXd1WrbuvxmZHmRKgJSeSq1IvUe%2BqtC1O8LmwuZR8oLe8D8MLdOaI7L%2B%2Bn0WhvcKhG5h%2BFHQGGAQrMP%2BX%2F8sNhO3lVla3ovUGDPirWa5cIo8ar39EI%3D",
  "response_data": {
    "accesstoken": "zIhp3fihZtm%2FMFdWmgTu%2BlG1QiJG2nyLo7ThzEGNPx5jit0THlPIcJ9JGWXd1WrbuvxmZHmRKgJSeSq1IvUe%2BqtC1O8LmwuZR8oLe8D8MLdOaI7L%2B%2Bn0WhvcKhG5h%2BFHQGGAQrMP%2BX%2F8sNhO3lVla3ovUGDPirWa5cIo8ar39EI%3D",
    "expiry":      "2029-02-16T17:32:47.0115689Z",
    "message":     "success",
    "traceid":     "212f8137-23f3-4da9-8178-10e81e63ab3f"
  }
}
```

Things to know from the real response:

- **The token is URL-encoded.** Characters like `%2F`, `%2B`, `%3D` are
  `/`, `+`, `=`. Pass the string straight through to downstream TCS calls —
  don't decode it. The kit stores and forwards it verbatim.
- **`expiry`** is an ISO-8601 UTC timestamp telling you when the token stops
  working. Cache the token until then; refresh shortly before.
- **`traceid`** is TCS' correlation id for the auth call. Keep it in logs
  when you open a support ticket with them.
- **`message: "success"`** is TCS' own success flag — independent of the
  `success: true` the kit wraps around it.

**Response 400**
```json
{
  "success": false,
  "courier_name": "TCS",
  "courier_company": "TCS",
  "error": "bearertoken, username, and password are all required"
}
```

> The kit looks for the access token in the TCS response under
> `accesstoken | accessToken | access_token | token | data.accesstoken | data.accessToken | data.token`.
> If TCS returns the token under a different key, the error message includes
> the full raw response so you can adjust [tcs.service.js:97-141](courier-module-kit/utils/tcs.service.js#L97-L141).

---

## 7. `POST /api/courier/book-and-fulfill`

The combined endpoint — book a parcel and immediately mark the Shopify
fulfillment order as fulfilled in a single round trip. **Fulfillment failure
is non-fatal**: if the courier booking succeeds but the Shopify mark fails,
the response is still `200` with `success: true`, the booking is preserved,
and the fulfillment field carries the error so the caller can decide what to
do.

Optional: if `shopify.tags` and `shopify.platform_order_id` are supplied and
the fulfillment succeeded, the order is also tagged in the same request.

**Body**
```jsonc
{
  // ── courier fields (identical to /book-standardized) ──
  "courier": "LCS",                          // "LCS" | "TCS" | "LEOPARDS"
  "credentials":          { /*...*/ },        // OR "courier_account_id": "..."
  "order_info":    { "order_number": "ORD-101", "cod_amount": 1500, "weight": 0.5 },
  "customer_info": { "name": "John Doe", "phone": "03001234567",
                     "address": "456 Side St, Lahore", "city_id": 789 },
  "courier_data":  { "service_type": "OVERNIGHT", "origin_city_id": 1 },

  // ── shopify fields ──
  "shopify": {
    "platform_store_id":    "mystore.myshopify.com",   // REQUIRED
    "access_token":         "shpat_xxxxxxxxxxxxxxxx",  // REQUIRED
    "fulfillment_order_id": "1234567890",              // REQUIRED, explicit
    "notify_customer":      true,                       // optional, default true
    "platform_order_id":    "5551234567890",            // optional — needed only if `tags` is set
    "tags":                 ["Packed"]                  // optional — string or array
  }
}
```

**Response 200 — booking succeeded (fulfillment may or may not have)**
```jsonc
{
  "success": true,
  "booking": {
    "success": true,
    "courier_name": "LCS",
    "tracking_number": "HD7512345678",
    "tracking_url": "https://trackmyorder.pk/?tracking_no=HD7512345678&courier=leopards",
    "slip_link": "https://...",
    "response_data": { /*...*/ }
  },
  "fulfillment": {
    "status": "success",
    "data": {
      "id": "gid://shopify/Fulfillment/9876543210",
      "status": "SUCCESS",
      "trackingInfo": { "number": "HD7512345678", "url": "...", "company": "LCS" }
    }
  },
  "tag": { "status": "success" }   // or null if no tags requested
}
```

**Response 200 — booking succeeded, Shopify mark failed (non-fatal)**
```jsonc
{
  "success": true,
  "booking":     { "success": true, "tracking_number": "HD7512345678", /*...*/ },
  "fulfillment": { "status": "failed", "error": "null: Fulfillment order is already fulfilled" },
  "tag":         null
}
```

**Response 400 — booking failed (fulfillment not attempted)**
```jsonc
{
  "success": false,
  "booking":     { "success": false, "error": "Missing customer_info.city_id" },
  "fulfillment": null,
  "tag":         null
}
```

**Response 500** — unexpected exception.

> **When to call this vs the two-step flow?** Use `/book-and-fulfill` when you
> already have the Shopify `fulfillment_order_id` ready on the Remix side
> (e.g. you store it on the order, or you fetched it earlier via
> `/api/fulfillment/fetch-orders`). Use the two-step flow
> (`/book-standardized` then `/api/fulfillment/mark`) when you want full
> control over what happens between booking and marking, or when you need to
> handle the booking result before deciding whether to mark.

---

## 8. `POST /api/courier/batch-book-and-fulfill`

Bulk version of [section 7](#7-post-apicourierbook-and-fulfill). Books and
marks many orders in parallel. **One failure never blocks the rest**, and
per-order semantics match the single endpoint exactly: a fulfillment-mark
failure is non-fatal — the booking is still recorded as successful, with the
mark error surfaced in the response.

**Body**
```json
{
  "payloads": [
    {
      "courier": "LCS",
      "credentials":   { "api_key": "...", "api_password": "..." },
      "order_info":    { "order_number": "ORD-101", "cod_amount": 1500, "weight": 0.5 },
      "customer_info": { "name": "John Doe", "phone": "03001234567",
                         "address": "456 Side St, Lahore", "city_id": 789 },
      "courier_data":  { "service_type": "OVERNIGHT", "origin_city_id": 1 },
      "shopify": {
        "platform_store_id":    "mystore.myshopify.com",
        "access_token":         "shpat_xxxxxxxxxxxxxxxx",
        "fulfillment_order_id": "1234567890",
        "notify_customer":      true,
        "platform_order_id":    "5551234567890",
        "tags":                 ["Packed"]
      }
    },
    {
      "courier": "TCS",
      "credentials":   { "bearertoken": "...", "accesstoken": "...", "account_number": "...", "shipper_details": { /*...*/ } },
      "order_info":    { "order_number": "ORD-102", "cod_amount": 2200, "weight": 1.0 },
      "customer_info": { "name": "Jane Doe", "phone": "03111234567",
                         "address": "789 North Ave, Karachi", "city_name": "Karachi" },
      "courier_data":  { "service_code": "O" },
      "shopify": {
        "platform_store_id":    "mystore.myshopify.com",
        "access_token":         "shpat_xxxxxxxxxxxxxxxx",
        "fulfillment_order_id": "2345678901"
      }
    }
  ]
}
```

Each payload element is identical in shape to a [`/book-and-fulfill`](#7-post-apicourierbook-and-fulfill) request.

**Status codes**
- `200` — every order booked.
- `207` — partial success (some bookings failed). Note: orders whose *booking*
  succeeded but whose *Shopify mark* failed still count as success — see
  `summary.fulfillment_failed` for that breakdown.
- `400` — every order failed to book, or `payloads` missing/empty.

**Response body**
```json
{
  "success": true,
  "successful": [
    {
      "order_number": "ORD-101",
      "booking":     { "success": true, "tracking_number": "HD7512345678", "courier_name": "LCS", "tracking_url": "...", "slip_link": "..." },
      "fulfillment": { "status": "success", "data": { "id": "gid://shopify/Fulfillment/9876543210", "status": "SUCCESS", "trackingInfo": { /*...*/ } } },
      "tag":         { "status": "success" }
    },
    {
      "order_number": "ORD-102",
      "booking":     { "success": true, "tracking_number": "07641122334", "courier_name": "TCS", "tracking_url": "..." },
      "fulfillment": { "status": "failed",  "error": "null: Fulfillment order is already fulfilled" },
      "tag":         null
    }
  ],
  "failed": [
    {
      "order_number": "ORD-103",
      "error":   "Missing customer_info.city_id",
      "booking": { "success": false, "courier_name": "LCS", "error": "Missing customer_info.city_id" }
    }
  ],
  "summary": {
    "total": 3,
    "success": 2,
    "failed":  1,
    "fulfillment_failed": 1
  }
}
```

> **Reading `summary`**: `success` counts orders whose booking succeeded
> (whether or not Shopify marking succeeded). `fulfillment_failed` is a
> *subset* of `success` — it's the count of orders that ended up booked but
> not marked. Use this if you want to retry the mark separately via
> `/api/fulfillment/batch-mark` for the orders in `successful[]` whose
> `fulfillment.status === 'failed'`.

---

## Which endpoint should I call?

| Scenario | Endpoint |
|---|---|
| Book one order, auto-mark fulfilled (typical "Book" button) | `POST /api/courier/book-and-fulfill` |
| Bulk book + auto-mark fulfilled (bulk action on many orders) | `POST /api/courier/batch-book-and-fulfill` |
| Book one order, don't touch Shopify | `POST /api/courier/book-standardized` |
| Bulk book, don't auto-mark (operator marks later) | `POST /api/courier/batch-book-standardized` |
| Cancel one booking | `POST /api/courier/batch-cancel` (1-element array) |
| Cancel many bookings | `POST /api/courier/batch-cancel` |
| Mark a single Shopify fulfillment order separately | `POST /api/fulfillment/mark` |
| Bulk-mark many fulfillment orders separately | `POST /api/fulfillment/batch-mark` |
| Cancel a Shopify fulfillment | `POST /api/fulfillment/cancel` |
| Resolve `fulfillment_order_id` from `platform_order_id` | `POST /api/fulfillment/fetch-orders` |

---

## Fulfillment endpoints

All Shopify fulfillment routes accept credentials either inline
(`credentials: { platform_store_id, access_token }`) or by `store_id` string
with a registered DB adapter. **Inline always wins.** Since this backend is
stateless (no DB), inline is the expected mode — the Shopify-app frontend
sends `access_token` + `platform_store_id` on each request.

### F1. `POST /api/fulfillment/mark`

Mark a single Shopify fulfillment order as fulfilled with courier tracking
info.

**Body**
```jsonc
{
  "credentials": {
    "platform_store_id": "mystore.myshopify.com",
    "access_token":      "shpat_xxxxxxxxxxxxxxxx"
  },
  "fulfillment_order_id": "1234567890",   // REQUIRED — numeric Shopify FulfillmentOrder ID,
                                           // or full GID. Both accepted.
  "tracking_number":      "HD7512345678", // REQUIRED — courier CN / tracking number
  "tracking_url":         "https://...",  // optional — tracking deeplink
  "courier":              "Leopards",     // optional — courier company name
  "notify_customer":      true             // optional — default true
}
```

**Response 200**
```json
{
  "success": true,
  "status": "success",
  "data": {
    "id": "gid://shopify/Fulfillment/9876543210",
    "status": "SUCCESS",
    "trackingInfo": { "number": "HD7512345678", "url": "https://...", "company": "Leopards" }
  }
}
```

**Response 400**
```json
{
  "success": false,
  "status": "failed",
  "error": "null: Fulfillment order is already fulfilled"
}
```

**Response 500** — unexpected exception.

---

### F2. `POST /api/fulfillment/batch-mark`

Mark many fulfillment orders concurrently. One failure never blocks the rest.

**Body**
```json
{
  "payloads": [
    { "credentials": { /*...*/ }, "fulfillment_order_id": "111", "tracking_number": "HD001" },
    { "credentials": { /*...*/ }, "fulfillment_order_id": "222", "tracking_number": "HD002" }
  ]
}
```

**Status codes** — `200` all ok · `207` partial · `400` all failed.

**Response body**
```json
{
  "success": true,
  "successful": [
    { "fulfillment_order_id": "111", "status": "success", "data": { /*...*/ } }
  ],
  "failed": [
    { "fulfillment_order_id": "222", "error": "null: Fulfillment order is already fulfilled" }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1 }
}
```

---

### F3. `POST /api/fulfillment/cancel`

Cancel a Shopify fulfillment (the shipment record — **not** the fulfillment
order). The `fulfillment_id` is the `data.id` returned by a successful mark.

**Body**
```json
{
  "credentials": { "platform_store_id": "...", "access_token": "..." },
  "fulfillment_id": "gid://shopify/Fulfillment/9876543210"
}
```

**Response 200**
```json
{
  "success": true,
  "status": "success",
  "data": { "id": "gid://shopify/Fulfillment/9876543210", "status": "CANCELLED" }
}
```

---

### F4. `POST /api/fulfillment/fetch-orders`

Discover the `fulfillment_order_id`(s) for a given Shopify order ID — useful
when you have only a `platform_order_id`. Returns all open / on-hold
fulfillment orders for that order.

**Body**
```json
{
  "credentials": { "platform_store_id": "...", "access_token": "..." },
  "platform_order_id": "5551234567890"
}
```

**Response 200**
```json
{
  "success": true,
  "status": "success",
  "fulfillment_orders": [
    {
      "fulfillment_order_id":  "1234567890",
      "fulfillment_order_gid": "gid://shopify/FulfillmentOrder/1234567890",
      "status": "OPEN",
      "line_items": [
        {
          "fulfillment_order_line_item_id": "9876543210",
          "fulfillment_order_quantity": 2,
          "line_item_id": "1111111111",
          "variant_id":   "2222222222",
          "sku":   "PROD-SKU-001",
          "title": "Blue T-Shirt"
        }
      ]
    }
  ]
}
```

**Response 404** — no open fulfillment orders for that order.
```json
{
  "success": false,
  "status":  "no_fulfillment_orders",
  "message": "No open fulfillment orders found"
}
```

---

### F5. `POST /api/fulfillment/tag-order`

Add tags to a Shopify order (e.g. `"Packed"`, `"Booked"`).

**Body**
```json
{
  "credentials": { "platform_store_id": "...", "access_token": "..." },
  "platform_order_id": "5551234567890",
  "tags": ["Packed", "Booked"]
}
```

`tags` can be a single string or a string array.

**Response 200**
```json
{ "success": true, "status": "success" }
```

---

## `fulfillment_order_id` vs `fulfillment_id` — what's what

Easy to confuse. Two different Shopify concepts:

| Field                  | What it is                                                          | Where you get it                                | Used by                |
|------------------------|---------------------------------------------------------------------|-------------------------------------------------|------------------------|
| `fulfillment_order_id` | The **work order** Shopify creates for an order (what to ship)      | `POST /api/fulfillment/fetch-orders`, or stored | `mark`, `book-and-fulfill` |
| `fulfillment_id`       | The **shipment record** created when you mark a fulfillment order   | Returned in `mark`'s `data.id`                  | `cancel`               |

In short: you *mark* a `fulfillment_order` and Shopify creates a `fulfillment`.
To undo, you cancel the `fulfillment` (not the order).

---

## Standardized Booking Payload

Used by [1. book-standardized](#1-post-apicourierbook-standardized) and
each element of [2. batch-book-standardized](#2-post-apicourierbatch-book-standardized).

```jsonc
{
  "courier": "LCS",                       // "LCS" | "TCS" | "LEOPARDS"

  // Provide ONE of these two credential sources:
  "credentials":          { /* see Credential shapes below */ },
  "courier_account_id":   "string-id",    // resolved via a DB adapter (see "Credentials")

  "order_info": {
    "order_number":    "ORD-101",         // required
    "cod_amount":      1500,              // required — number, PKR
    "weight":          0.5,                // required — number, KG
    "pieces":          1,                  // optional — defaults to 1
    "product_details": "Cotton t-shirt"   // optional — item description
  },

  "customer_info": {
    "name":      "John Doe",              // required
    "phone":     "03001234567",            // required — any format; auto-normalized
    "address":   "456 Side St, Lahore",   // required
    "city":      "Lahore",                 // used by TCS as fallback
    "city_name": "Lahore",                 // optional explicit TCS city name
    "city_id":   789,                      // REQUIRED for LCS (numeric Leopards city id)
    "email":     "john@example.com"        // optional
  },

  "courier_data": {
    "service_type":         "OVERNIGHT",   // LCS: "OVERNIGHT" | "OVERLAND"
    "service_code":         "O",            // TCS: "O" = Overnight
    "fragile":              false,          // TCS only
    "special_instructions": "Handle with care",
    "origin_city_id":       1,              // LCS origin city id (default 1 = Karachi)
    "shipment_id":          "shipper-id",   // LCS shipper id (or from access_data.shipment_id)
    "shipper_name":         "My Store",     // optional pickup contact
    "shipper_email":        "store@example.com",
    "shipper_phone":        "03001234567",
    "shipper_address":      "123 Main St, Karachi"
  }
}
```

### Per-courier field differences

| Field | LCS | TCS |
|---|---|---|
| `customer_info.city_id`         | **required** (numeric Leopards city id) | not used |
| `customer_info.city` / `city_name` | not used | **required** (city name) |
| `courier_data.service_type`     | `OVERNIGHT` / `OVERLAND` | not used |
| `courier_data.service_code`     | not used | `O` (Overnight) |
| `courier_data.fragile`          | not used | optional boolean |

### Standardized cancellation payload

Each element of [3. batch-cancel](#3-post-apicourierbatch-cancel):

```jsonc
{
  "courier":         "LCS",                  // "LCS" | "TCS"
  "tracking_number": "HD7512345678",         // required — courier CN number
  "credentials":     { /*...*/ },            // OR "courier_account_id": "..."
  "reason":          "Customer cancelled"    // optional, informational
}
```

---

## Credentials — two ways to supply API keys

Every booking / cancel needs courier API keys (`access_data`). Pick one
mode; **inline always wins** if both are present.

### A. Inline (no database)

Put the keys straight into the payload under `credentials`. Nothing to wire.

```json
{
  "courier": "LCS",
  "credentials": { "api_key": "ABC123", "api_password": "secret" },
  "order_info": {/*...*/}, "customer_info": {/*...*/}, "courier_data": {/*...*/}
}
```

### B. DB adapter

Send a `courier_account_id` string, register a lookup once at startup:

```js
// index.js (right after `require('dotenv').config()`)
const { setCredentialLookup, setCityLookup } =
  require('./courier-module-kit/utils/courier.credentials');

setCredentialLookup(async (id) => {
  const row = await db.courierAccount.findUnique({ where: { id } });
  if (!row) return null;
  return { access_data: row.access_data };
});

// Optional — only if you want TCS city_id -> city name resolution:
setCityLookup(async (id) => db.courierCity.findUnique({ where: { id } }));
```

If a string `courier_account_id` is sent but no adapter is registered, the
kit throws a clear error.

---

## Credential shapes

Shape of the `credentials` object (or your adapter's `access_data`).

### LCS (Leopards)
```jsonc
{
  "api_key":       "string",   // required
  "api_password":  "string",   // required

  // Optional pickup/shipper defaults — used when courier_data omits them:
  "shipment_id":      "string",
  "shipment_name":    "string",
  "shipment_email":   "string",
  "shipment_phone":   "string",
  "shipment_address": "string"
}
```

### TCS
```jsonc
{
  "bearertoken":    "string",     // required (long-lived) — sent as Authorization: Bearer <…>
  "accesstoken":    "string",     // required (short-lived) — sent in request body

  // Used by /tcs/auth-token to mint a fresh accesstoken:
  "username":       "string",
  "password":       "string",

  "account_number": "string",     // TCS account / cost-center number
  "shipper_details": {            // pickup origin
    "name":     "Verification Store",
    "address":  "Verification Warehouse, Karachi",
    "phone":    "03001234567",
    "cityName": "Karachi",
    "cityCode": "KHI",
    "cost_center_code": "034",

    // Optional nested override — checked first if present:
    "tcs_origin": {
      "tcs_account": "704576",
      "cityName":    "Karachi",
      "cityCode":    "KHI",
      "cost_center_code": "034"
    }
  }
}
```

---

## Environment variables

All optional — the kit ships with sensible defaults.

| Variable           | Used by | Default                                         |
|--------------------|---------|-------------------------------------------------|
| `PORT`             | server  | `3000`                                          |
| `LCS_API_URL`      | LCS     | `https://merchantapi.leopardscourier.com`       |
| `TCS_API_URL`      | TCS     | `https://ociconnect.tcscourier.com/ecom`        |
| `TCS_BEARER_TOKEN` | TCS     | empty — fallback Bearer if not in `access_data` |

---

## Behavior notes

- **Phone numbers** auto-normalize to Pakistan local format (`03XXXXXXXXX`) via
  `BaseCourierService.formatPhoneNumber()`. Callers may send any format.
- **Weight floors**: LCS min `0.1` KG, TCS min `0.5` KG (enforced in mapping).
- **Retries**: non-4xx HTTP failures retry up to 3× with exponential backoff;
  4xx fail fast.
- **LCS city ids** are Leopards-specific numeric ids — callers must supply
  `customer_info.city_id`. TCS instead needs the city *name*.
- **TCS names** are split into first / middle / last automatically from
  `customer_info.name`.
- **Auth middleware** in [courier.routes.js](courier-module-kit/courier.routes.js)
  is currently a no-op (`authenticateToken`, `requirePermission`). Swap in
  your real middleware before going to production.

---

## Shopify API version

The fulfillment kit targets Shopify Admin GraphQL API version **`2024-04`**.
To bump it, edit the constant at the top of
[shopify.fulfillment.js](fulfillment-kit/utils/shopify.fulfillment.js):

```js
const SHOPIFY_API_VERSION = '2024-04';
```

GIDs (`gid://shopify/FulfillmentOrder/1234567890`) and numeric strings
(`"1234567890"`) are both accepted everywhere — `toGid()` normalizes them.
Shopify's GraphQL bucket throttle is handled automatically by
[shopify.throttle.js](fulfillment-kit/utils/shopify.throttle.js) after every
response.

---

## Underlying courier endpoints (reference)

What the kit hits under the hood — useful for debugging.

| Courier | Action            | Method & path                                          |
|---------|-------------------|--------------------------------------------------------|
| LCS     | Book              | `POST {LCS_API_URL}/api/bookPacket/format/json/`       |
| LCS     | Cancel            | `POST {LCS_API_URL}/api/cancelBookedPackets/format/json/` |
| LCS     | Light creds check | `POST {LCS_API_URL}/api/getAllCities/format/json/`     |
| TCS     | Auth token        | `GET  {TCS_API_URL}/api/authentication/token?username=&password=` |
| TCS     | Book              | `POST {TCS_API_URL}/api/booking/create`                |
| TCS     | Cancel            | `POST {TCS_API_URL}/api/booking/cancel`                |

- **LCS** auth: `api_key` + `api_password` in the JSON body. Success = `status == 1`. Tracking number = `track_number`.
- **TCS** auth: `Authorization: Bearer <bearertoken>` header **and**
  `accesstoken` in the body. Success = no `returnStatus.status` of `FAIL`/`ERROR`. Tracking number = `consignmentNo`.

---

## Adding a new courier

1. Create `courier-module-kit/utils/<name>.service.js` extending `BaseCourierService`.
2. Implement `async bookOrder(payload)`, `async cancelOrder(payload)`, and
   optionally `async testCredentials(credentials)`.
3. Register it in [courier.factory.js](courier-module-kit/utils/courier.factory.js):
   ```js
   const newService = require('./newcourier.service');
   this.services = { ...this.services, 'NEWCOURIER': newService };
   ```
4. Nothing in the routes or batch service changes — they dispatch by name.

---

## Files

```
backend-bookmyorder/
├── README.md                              ← you are here
├── index.js                               ← Express bootstrap (mounts both routers)
├── package.json
├── .env.example
├── courier-module-kit/
│   ├── COURIER_KIT_GUIDE.md               ← original courier kit guide
│   ├── courier.routes.js                  ← Express router (8 endpoints incl. book-and-fulfill + batch)
│   ├── lcs.md                             ← raw Leopards API docs
│   ├── tcs.json                           ← raw TCS OpenAPI spec
│   └── utils/
│       ├── base.courier.service.js        ← HTTP + retry + response shapes
│       ├── courier.credentials.js         ← credential & city resolution
│       ├── courier.factory.js             ← name -> service dispatch
│       ├── lcs.service.js                 ← Leopards implementation
│       ├── tcs.service.js                 ← TCS implementation
│       └── batch.booking.service.js       ← parallel batch booking/cancel
└── fulfillment-kit/
    ├── FULFILLMENT_KIT_GUIDE.md           ← original fulfillment kit guide
    ├── fulfillment.routes.js              ← Express router (5 endpoints)
    └── utils/
        ├── shopify.fulfillment.js         ← markFulfillment, cancelFulfillment, getOpenFulfillmentOrders, tagOrder
        ├── fulfillment.credentials.js     ← store credential resolution
        ├── batch.fulfillment.service.js   ← parallel batch mark / cancel
        └── shopify.throttle.js            ← Shopify GraphQL bucket-throttle helper
```

> The `book-and-fulfill` endpoint in [courier.routes.js](courier-module-kit/courier.routes.js)
> directly requires `markFulfillment` and `tagOrder` from the fulfillment kit
> — that's the one place the two kits couple. Everything else stays separate.
