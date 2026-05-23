# Courier Booking Kit — Leopards (LCS) & TCS

A drop-in, framework-light kit for booking and cancelling parcels with
**Leopards Courier (LCS)** and **TCS** in Pakistan, behind a single
**standardized payload** so your app never talks a courier's native API directly.

It uses a **Factory pattern**: your code builds one standard payload, the factory
picks the right courier service, and that service maps to/from the courier's API.

---

## 🤖 Instructions for Claude (read this first)

You are being handed this kit to integrate into an **Express** project. Do the
following:

1. **Copy the files** (see the file list below) into the project — keep the
   `courier-module-kit/` folder, or move the files wherever the project keeps
   modules. If you move them, fix the relative `import` paths accordingly.
2. **Mount the router.** Add `app.use('/api/courier', courierRoutes)` to the
   app's entrypoint. Confirm the app is ESM (`"type": "module"` in
   `package.json`) — every file uses `import`/`export`. If the project is
   CommonJS, convert the files to `require`/`module.exports`.
3. **Wire auth.** `courier.routes.js` ships no-op `authenticateToken` /
   `requirePermission` placeholders. Replace them with the project's real
   middleware if it has any; otherwise leave the no-ops.
4. **Wire credentials.** Decide per the project:
   - If callers will send API keys inline in each request → nothing to do.
   - If the project stores courier accounts in a DB → register an adapter at
     startup with `setCredentialLookup(...)` (see **Credentials** below).
5. **Set env vars** if needed (see **Environment Variables**).
6. **Verify** with the `POST /api/courier/verify-courier` endpoint using real
   sandbox/live credentials — it books a test parcel and cancels it.

Do **not** change the standardized payload field names or the response shapes —
other parts of the app (and this doc) depend on them.

---

## 📁 Files in this kit

```
courier-module-kit/
├── COURIER_KIT_GUIDE.md            ← this file
├── courier.routes.js               ← Express router (4 endpoints)
└── utils/
    ├── base.courier.service.js     ← shared base class (HTTP, retry, response shapes)
    ├── courier.credentials.js      ← pluggable credential + city resolution
    ├── courier.factory.js          ← name → service dispatch
    ├── lcs.service.js              ← Leopards implementation
    ├── tcs.service.js              ← TCS implementation
    └── batch.booking.service.js    ← parallel batch booking / cancellation
```

**Requirements:** Node 18+ (uses the global `fetch`), ESM modules, Express.
No database and no other npm packages are required by the kit itself.

---

## Architecture

```
HTTP request
   │
   ▼
courier.routes.js ──────────────► batch.booking.service.js   (batch endpoints)
   │                                       │
   │ (single endpoint)                     │ runs payloads in parallel
   ▼                                       ▼
courier.factory.js  ──── getService("LCS"|"TCS") ────►  lcs.service.js
   │                                                    tcs.service.js
   │                                                       │
   │                                  both extend          ▼
   └──────────────────────────►  base.courier.service.js  (fetch + retry + shapes)
                                            │
                                            ▼
                                 courier.credentials.js   (resolve API keys)
```

- **One payload format** for every courier — see below.
- **One response shape** for success and for error — see below.
- Adding a courier = one new service file + one line in the factory.

---

## The Standardized Payload

### Booking payload

This is the body for `POST /book-standardized`, and each element of the
`payloads` array for `POST /batch-book-standardized`.

```jsonc
{
  "courier": "LCS",                  // "LCS" | "TCS" | "LEOPARDS"

  // Credentials — supply ONE of these two (see "Credentials" section):
  "credentials": { /* access_data */ },   // inline keys, OR…
  "courier_account_id": "string",         // …an id resolved by your DB adapter

  "order_info": {
    "order_number": "string",        // required
    "cod_amount": 0,                 // required — number, PKR
    "weight": 0.5,                   // required — number, KG
    "pieces": 1,                     // optional — defaults to 1
    "product_details": "string"      // optional — item description
  },

  "customer_info": {
    "name": "string",                // required
    "phone": "string",               // required — any format, auto-normalized
    "address": "string",             // required
    "city": "string",                // city name (used by TCS)
    "city_name": "string",           // optional explicit TCS city name
    "city_id": 0,                    // required for LCS — numeric Leopards city id
    "email": "string"                // optional
  },

  "courier_data": {
    "service_type": "OVERNIGHT",     // LCS: "OVERNIGHT" | "OVERLAND"
    "service_code": "O",             // TCS: "O" = Overnight (TCS service code)
    "fragile": false,                // TCS only
    "special_instructions": "string",
    "origin_city_id": 1,             // LCS origin city id (default 1 = Karachi)
    "shipment_id": "string",         // LCS shipper id (optional, can come from access_data)
    "shipper_name": "string",        // pickup contact (optional — see access_data)
    "shipper_email": "string",
    "shipper_phone": "string",
    "shipper_address": "string"
  }
}
```

**Field requirements differ slightly per courier:**

| Field                   | LCS                    | TCS                         |
|-------------------------|------------------------|-----------------------------|
| `customer_info.city_id` | **required** (numeric) | not used                    |
| `customer_info.city` / `city_name` | not used    | **required** (name string)  |
| `courier_data.service_type` | `OVERNIGHT`/`OVERLAND` | not used               |
| `courier_data.service_code` | not used           | `O` (Overnight)             |

### Cancellation payload

Body element for `POST /batch-cancel` (one object per parcel):

```jsonc
{
  "courier": "LCS",                  // "LCS" | "TCS"
  "tracking_number": "string",       // required — the courier consignment / CN number
  "credentials": { /* access_data */ },   // OR "courier_account_id": "string"
  "reason": "string"                 // optional — informational
}
```

---

## API Endpoints

All paths are relative to wherever you mount the router (this doc assumes
`/api/courier`).

### 1. Single Booking — `POST /api/courier/book-standardized`

**Body:** one Standardized Booking Payload.

**Success (200):**
```json
{
  "success": true,
  "courier_name": "LCS",
  "courier_company": "LCS",
  "tracking_number": "HD75...",
  "tracking_url": "https://trackmyorder.pk/?tracking_no=HD75...&courier=leopards",
  "slip_link": "https://...",
  "courier_reference": "HD75...",
  "response_data": { /* raw courier response */ }
}
```

**Failure (400):**
```json
{
  "success": false,
  "courier_name": "LCS",
  "courier_company": "LCS",
  "error": "Missing customer_info.city_id"
}
```

### 2. Batch Booking — `POST /api/courier/batch-book-standardized`

Accepts an array and processes every payload **in parallel**. One failing parcel
never blocks the others.

**Body:**
```json
{
  "payloads": [
    { "courier": "LCS", "order_info": { }, "customer_info": { }, "courier_data": { } },
    { "courier": "TCS", "order_info": { }, "customer_info": { }, "courier_data": { } }
  ]
}
```

**Response — `200` all ok · `207` partial success · `400` all failed:**
```json
{
  "success": true,
  "successful": [
    { "order_number": "#101", "tracking_number": "HD75...", "success": true }
  ],
  "failed": [
    { "order_number": "#102", "error": "Invalid City ID" }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1 }
}
```

### 3. Batch Cancellation — `POST /api/courier/batch-cancel`

**Body:**
```json
{
  "payloads": [
    { "courier": "LCS", "tracking_number": "HD75...", "credentials": { } },
    { "courier": "TCS", "tracking_number": "07640...", "credentials": { } }
  ]
}
```

**Response — `200` / `207` / `400`** (same partial-success shape as batch booking),
with `tracking_number` instead of `order_number` in each entry.

### 4. Verify Courier — `POST /api/courier/verify-courier`

Validates a set of credentials end-to-end: it **books a real test parcel and
then cancels it**. Use it when a user adds/edits a courier account.

**Body:**
```json
{
  "courier": "LCS",
  "credentials": { "api_key": "...", "api_password": "..." }
}
```

**Success (200):**
```json
{
  "success": true,
  "message": "API Credentials verified successfully! Test parcel was booked and successfully cancelled.",
  "tracking_number": "HD75...",
  "booking_result": { },
  "cancellation_result": { }
}
```

> ⚠️ This creates a genuine booking on the courier's system before cancelling
> it. Run it against sandbox credentials where possible.

---

## Credentials — two ways to supply API keys

Every booking/cancel needs the courier's API keys (`access_data`). Supply them
either way; **inline always wins** if both are present.

### Option A — Inline (no database)

Put the keys straight in the payload under `credentials`:

```json
{
  "courier": "LCS",
  "credentials": { "api_key": "ABC123", "api_password": "secret" },
  "order_info": { },
  "customer_info": { },
  "courier_data": { }
}
```

Nothing to configure — `resolveAccessData()` uses `credentials` directly.

### Option B — DB adapter

Send a `courier_account_id` string instead, and register a lookup once at app
startup. The kit calls your function to fetch `access_data` from your database:

```js
// app bootstrap (e.g. server.js / app.js)
import { setCredentialLookup, setCityLookup } from './courier-module-kit/utils/courier.credentials.js';

setCredentialLookup(async (id) => {
  const row = await db.courierAccount.findUnique({ where: { id } });
  if (!row) return null;
  return { access_data: row.access_data };   // shape must match "Credential shapes" below
});

// Optional — only if you store TCS cities by id and want id → name resolution:
setCityLookup(async (id) => {
  return db.courierCity.findUnique({ where: { id } });
  // any of these keys is read: metadata.cityName | meta_data.cityName | city_name | name
});
```

Then:
```json
{ "courier": "LCS", "courier_account_id": "ckxyz...", "order_info": { } }
```

If a string `courier_account_id` is sent but no adapter is registered, the kit
throws a clear error telling the caller to register one or send `credentials`.

---

## Credential shapes (`access_data`) per courier

What the `credentials` object (or your adapter's `access_data`) must contain.

### LCS (Leopards)
```jsonc
{
  "api_key": "string",            // required
  "api_password": "string",       // required
  // optional pickup/shipper defaults (used if not in courier_data):
  "shipment_id": "string",
  "shipment_name": "string",
  "shipment_email": "string",
  "shipment_phone": "string",
  "shipment_address": "string"
}
```

### TCS
```jsonc
{
  "bearertoken": "string",        // required — Authorization: Bearer <token>
  "accesstoken": "string",        // required — sent in the request body
  "account_number": "string",     // TCS account / cost-center number
  "shipper_details": {            // pickup origin info
    "name": "string",
    "address": "string",
    "phone": "string",
    "cityName": "Karachi",
    "cityCode": "KHI",
    "cost_center_code": "034",
    "tcs_origin": {               // optional nested override — checked first
      "tcs_account": "704576",
      "cityName": "Karachi",
      "cityCode": "KHI",
      "cost_center_code": "034"
    }
  }
}
```

---

## Environment Variables

All optional — the kit has sensible defaults.

| Variable           | Used by | Default                                          |
|--------------------|---------|--------------------------------------------------|
| `LCS_API_URL`      | LCS     | `https://merchantapi.leopardscourier.com`        |
| `TCS_API_URL`      | TCS     | `https://ociconnect.tcscourier.com/ecom`         |
| `TCS_BEARER_TOKEN` | TCS     | empty — fallback Bearer token if not in `access_data` |

---

## Courier-specific notes

- **Phone numbers** are auto-normalized to Pakistan local format (`03XXXXXXXXX`)
  by `BaseCourierService.formatPhoneNumber()` — callers can send any format.
- **Weight:** LCS minimum 0.1 KG, TCS minimum 0.5 KG (enforced in mapping).
- **Retries:** non-4xx HTTP failures retry up to 3× with exponential backoff;
  4xx responses fail fast (see `base.courier.service.js`).
- **LCS city ids** are numeric and Leopards-specific — the caller must supply
  `customer_info.city_id`. TCS instead needs the city *name*.
- **TCS** names are split into first/middle/last automatically from
  `customer_info.name`.

---

## Underlying courier APIs (reference)

What the kit calls under the hood — useful for debugging.

| Courier | Action | Method & Endpoint                                  |
|---------|--------|----------------------------------------------------|
| LCS     | Book   | `POST {LCS_API_URL}/api/bookPacket/format/json/`   |
| LCS     | Cancel | `POST {LCS_API_URL}/api/cancelBookedPackets/format/json/` |
| TCS     | Book   | `POST {TCS_API_URL}/api/booking/create`            |
| TCS     | Cancel | `POST {TCS_API_URL}/api/booking/cancel`            |

- **LCS** authenticates via `api_key` + `api_password` in the JSON body.
  Success = `status == 1`; tracking number is `track_number`.
- **TCS** authenticates via `Authorization: Bearer <bearertoken>` header **and**
  `accesstoken` in the body. Success = no `returnStatus.status` of `FAIL`/`ERROR`;
  tracking number is `consignmentNo`.

---

## Adding a new courier

1. Create `utils/<name>.service.js` extending `BaseCourierService`.
2. Implement exactly two public methods:
   - `async bookOrder(payload)` — validate → `resolveAccessData(payload)` →
     map to the courier's format → `makeAPICallWithRetry(...)` → return
     `this.successResponse({ tracking_number, tracking_url, ... })` or
     `this.errorResponse(error)`.
   - `async cancelOrder(payload)` — same pattern, using
     `payload.tracking_number`.
3. Register it in `courier.factory.js`:
   ```js
   import newService from './newcourier.service.js';
   this.services = { ...this.services, 'NEWCOURIER': newService };
   ```
4. Nothing in the routes or batch service changes — they dispatch by name.
