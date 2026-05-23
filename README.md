# backend-bookmyorder — API Reference

Express backend exposing a unified courier booking API on top of **Leopards (LCS)**
and **TCS**. Every endpoint speaks one standardized payload — callers never talk
to a courier's native API directly.

This file is the single source of truth for everything an integrator (or another
Claude session) needs. You should not have to read the kit source.

- Stack: Node 18+ (uses global `fetch`), Express 4, CommonJS.
- Source layout: kit lives under [`courier-module-kit/`](./courier-module-kit/).
- Mount point: `/api/courier`.

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

| # | Method | Path | Purpose | Couriers |
|---|---|---|---|---|
| 0 | GET  | `/health` | Liveness check | — |
| 1 | POST | `/api/courier/book-standardized` | Book a single parcel | LCS, TCS |
| 2 | POST | `/api/courier/batch-book-standardized` | Book many parcels in parallel | LCS, TCS |
| 3 | POST | `/api/courier/batch-cancel` | Cancel many parcels in parallel | LCS, TCS |
| 4 | POST | `/api/courier/verify-courier` | Heavy creds check — books + cancels a real parcel | LCS, TCS |
| 5 | POST | `/api/courier/test-credentials` | Light creds check — no booking made | LCS, TCS |
| 6 | POST | `/api/courier/tcs/auth-token` | Fetch a fresh TCS `accesstoken` from `bearertoken + username + password` | TCS |

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
├── index.js                               ← Express bootstrap
├── package.json
├── .env.example
└── courier-module-kit/
    ├── COURIER_KIT_GUIDE.md               ← original kit guide (long-form)
    ├── courier.routes.js                  ← Express router (6 endpoints)
    ├── lcs.md                             ← raw Leopards API docs
    ├── tcs.json                           ← raw TCS OpenAPI spec
    └── utils/
        ├── base.courier.service.js        ← HTTP + retry + response shapes
        ├── courier.credentials.js         ← credential & city resolution
        ├── courier.factory.js             ← name -> service dispatch
        ├── lcs.service.js                 ← Leopards implementation
        ├── tcs.service.js                 ← TCS implementation
        └── batch.booking.service.js       ← parallel batch booking/cancel
```
