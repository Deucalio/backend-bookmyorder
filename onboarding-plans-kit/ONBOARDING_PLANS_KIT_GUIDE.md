# Onboarding + Shopify Plans Kit

A drop-in, 3-step onboarding wizard for **embedded Shopify apps** built on
**Remix + Polaris + Prisma**. It walks a merchant through:

1. **Choose Your Plan** — *required*. Redirects to Shopify's managed pricing
   page; the active subscription is detected on return via GraphQL.
2. **Connect a Courier** — *optional, skippable*. Reuses a bundled courier
   directory and posts to **your project's existing** `/api/couriers/connect`
   route (the kit does not ship one).
3. **Welcome** — *optional*. A polished finish-line page with a "Go to
   Dashboard" button that marks onboarding complete.

It also ships a **cross-page gate**: until a store finishes onboarding, every
`/app/*` route redirects back to the wizard. Completion (and the chosen plan)
is persisted on the store's `meta_data`.

**What it does NOT do:** no billing/charge creation (Shopify managed pricing
owns that), no credits/usage metering, no WhatsApp/template/widget steps, no
courier *tracking* sync — only connecting credentials. It is for embedded
Shopify Remix apps; it is not framework-agnostic.

---

## 🤖 Instructions for Claude (read this first)

You are integrating this kit into a fresh Remix + Shopify + Polaris + Prisma
app. Do this in order:

1. **Copy files.** Put the three shared files in `app/onboarding-kit/`
   (`onboarding.server.js`, `courierCompanies.js`, `actions.js`). Put the two
   route files in `app/routes/`: rename `frontend/onboarding.route.jsx` →
   `app.onboarding.jsx`, and copy `backend/api.onboarding.complete.jsx` as-is.
   If you place the shared files elsewhere, fix the relative
   `../onboarding-kit/...` imports in both route files.

   **Courier connect route:** the kit reuses YOUR existing
   `/api/couriers/connect` — it does not ship one. Make sure that route accepts
   a JSON body `{ storeID, courierCode, meta_data }` and returns a success flag
   (`{ success }` or `{ data: { success } }` — `actions.js` reads both). If your
   route lives at a different path, change `CONNECT_URL` in `actions.js`.

2. **Wire the storage adapter once.** In `app/shopify.server.js`, after the
   prisma import, add:
   ```js
   import prisma from "./db.server";
   import { setStoreAdapter, createPrismaAdapter } from "./onboarding-kit/onboarding.server";
   setStoreAdapter(createPrismaAdapter(prisma));
   ```
   If your store/courier tables aren't named `stores`/`couriers`, pass
   `createPrismaAdapter(prisma, { storeModel: "...", courierModel: "..." })`.

3. **Add the gate to the app layout.** In `app/routes/app.jsx`, call the guard
   inside the loader so every embedded page is protected:
   ```js
   import { requireOnboarded } from "../onboarding-kit/onboarding.server";
   export const loader = async ({ request }) => {
     await requireOnboarded(request, authenticate); // no-op on /app/onboarding
     return { apiKey: process.env.SHOPIFY_API_KEY || "" };
   };
   ```

4. **Set env vars.** Add `SHOPIFY_APP_NAME=your-app-handle` (the app handle used
   in `admin.shopify.com/store/<shop>/charges/<APP_NAME>/pricing_plans`).
   `SHOPIFY_API_KEY` is already required by Shopify Remix.

5. **Ensure the Prisma schema has the two tables** (see *Dependencies* below for
   the minimal models) and run `npx prisma migrate dev`.

6. **Configure plans.** Edit the `PLANS` array at the top of
   `app.onboarding.jsx` to match the plans you defined in the Shopify Partner
   dashboard's managed pricing. The labels are display-only; Shopify's pricing
   page is the source of truth.

7. **Verify.** Install the app on a dev store. You should land on
   `/app/onboarding`, be unable to pass step 1 until you pick a plan on
   Shopify's page, then be able to skip couriers, finish, and reach `/app`.
   Re-visiting any `/app/*` page after finishing should NOT redirect.

**Do NOT change** the public contract: the route path `/api/onboarding/complete`,
the `{ storeID, courierCode, meta_data }` body the kit sends to your courier
connect route, the `{ success, ... } | { success, error }` return shape of
`actions.js`, or the `meta_data.isOnboarded` flag the gate reads. The gate and
the wizard depend on these.

---

## Files in this kit

```
onboarding-plans-kit/
├── ONBOARDING_PLANS_KIT_GUIDE.md      This guide.
├── frontend/
│   ├── onboarding.route.jsx           3-step wizard: loader + Plan/Courier/Welcome UI.
│   ├── courierCompanies.js            Bundled courier directory + name/code matchers.
│   └── actions.js                     Browser fetch helpers (uniform success shape).
└── backend/
    ├── onboarding.server.js           Storage adapter, requireOnboarded gate,
    │                                  getActivePlan, ensureStore, saveOnboarded.
    └── api.onboarding.complete.jsx    POST /api/onboarding/complete (sets isOnboarded + plan).
```

> Courier connecting reuses **your** existing `/api/couriers/connect`; the kit
> deliberately does not include that route.

---

## Architecture

```
                 ┌─────────────────────────────────────────────┐
   any /app/*  → │ app.jsx loader → requireOnboarded()          │
                 │   reads store.meta_data.isOnboarded          │
                 │   not done?  → redirect /app/onboarding      │
                 └─────────────────────────────────────────────┘
                                     │ (done) ↓ render page

  /app/onboarding (onboarding.route.jsx)
     loader: authenticate.admin → getActivePlan(admin)   ── GraphQL activeSubscriptions
                                → ensureStore(session)    ── adapter.getStoreByDomain / createStore
                                → listCouriersForStore()  ── adapter.listCouriers
     │
     ├─ Step 1 Plan  ── Select → window.top.location.replace(Shopify pricing URL)
     │                  (merchant pays on Shopify, returns; plan now active)
     ├─ Step 2 Courier ─ Connect → actions.connectCourier()
     │                            → POST /api/couriers/connect  (YOUR existing route)
     └─ Step 3 Welcome ─ Go to Dashboard → actions.completeOnboarding()
                                         → POST /api/onboarding/complete
                                           → saveOnboarded() → adapter.updateStoreMeta
                                         → navigate /app

  setStoreAdapter(createPrismaAdapter(prisma))  ← wired once in shopify.server.js
```

---

## Dependencies

These come with any Shopify Remix app, so usually nothing new to install:

```bash
# backend + frontend (already present in a Shopify Remix app)
npm i @remix-run/node @remix-run/react @shopify/polaris @shopify/polaris-icons
npm i @prisma/client && npm i -D prisma
```

Minimal Prisma models the default adapter expects:

```prisma
model stores {
  id             Int       @id @default(autoincrement())
  shopify_domain String    @unique @db.VarChar(255)
  store_name     String?   @db.VarChar(255)
  email          String?   @db.VarChar(255)
  meta_data      Json?     // holds isOnboarded + plan
  // (your app may add more columns; the kit only touches meta_data)
}

model couriers {
  id          Int       @id @default(autoincrement())
  name        String    @db.VarChar(100)
  code        String    @db.VarChar(100)
  store_id    Int?
  description String?
  created_at  DateTime? @default(now()) @db.Timestamp(6)
  updated_at  DateTime? @default(now()) @db.Timestamp(6)
  meta_data   Json?
}
```

No heavy deps. Courier credential validation uses the global `fetch` (Node 18+).

---

## Usage

Once wired (steps above), the wizard is just a route. The only code you write is
the one-line adapter registration and the one-line gate:

```js
// app/shopify.server.js
setStoreAdapter(createPrismaAdapter(prisma));

// app/routes/app.jsx loader
await requireOnboarded(request, authenticate);
```

To complete onboarding from your own UI instead of the Welcome step:

```js
import { completeOnboarding } from "../onboarding-kit/actions";
await completeOnboarding(store, "pro"); // store must include { id, meta_data }
```

---

## Input shape

What the wizard's loader returns to the component (and what the api routes
accept):

```jsonc
// loader → component
{
  "store":        { "id": 1, "meta_data": { "isOnboarded": false } }, // store row
  "couriers":     [ { "code": "LCS", "meta_data": { "apiKey": "…" } } ], // already-connected
  "selectedPlan": "pro",            // active Shopify subscription name (lowercased) | null
  "shopName":     "acme",           // myshopify subdomain, used to build pricing URL
  "shopDomain":   "acme.myshopify.com",
  "APP_NAME":     "your-app"        // from SHOPIFY_APP_NAME, used in pricing URL
}

// POST /api/couriers/connect  body
{
  "storeID":     1,
  "courierCode": "LCS",             // matches courier_companies[].courier_code
  "meta_data":   { "apiKey": "…", "apiPassword": "…" } // credential bag
}

// POST /api/onboarding/complete  body
{
  "storeData": { "id": 1, "meta_data": { /* current meta */ } },
  "plan":      "pro"                // optional; stored on meta_data.plan
}
```

Defaults / null-safety: a missing `meta_data` is treated as `{}`; `selectedPlan`
of `null` keeps the Plan step visible and blocks "Continue"; couriers without
`possible_fields` fall back to a free-text `key: value` editor.

---

## Output shape

Every api route and every `actions.js` helper returns one of:

```jsonc
{ "success": true,  "courier": { /* … */ } }   // connect
{ "success": true }                            // complete
{ "success": false, "error": "Invalid API Key or Password" }
```

---

## Customising / extending

**Add a courier provider** — one entry in `courierCompanies.js`:

```js
{
  id: "callcourier",
  name: "Call Courier",
  courier_code: "CC",
  courier_name: "Call Courier",
  possible_matches: ["call courier", "cc"],
  color: "#1a73e8",
  logo: "https://example.com/cc.png",
  possible_fields: [{ name: "API Key", type: "string", save_key: "apiKey" }],
}
```

**Validate that provider's credentials before saving** — do it in your own
`/api/couriers/connect` route (the kit sends `{ storeID, courierCode,
meta_data }` and expects a success flag back). A clean pattern there is a
one-entry-per-provider strategy table, e.g.:

```js
const courierValidators = {
  CC: async (meta) => {
    const res = await fetch("https://api.callcourier.com.pk/ping", {
      headers: { Authorization: meta.apiKey },
    });
    return res.ok ? { ok: true } : { ok: false, error: "Invalid API Key" };
  },
};
// providers with no entry → save without a live check
```

**Change the plans shown** — edit the `PLANS` array at the top of
`app.onboarding.jsx`. The actual prices/charges live in Shopify managed pricing.

**Make couriers required** — flip the courier step from skippable by removing
`optional: true` from its step object and gating `canProceed` on
`connectedCount > 0`.

**Use a non-Prisma store** — implement the adapter interface yourself and pass
it to `setStoreAdapter`:

```js
setStoreAdapter({
  getStoreByDomain, createStore, updateStoreMeta, listCouriers,
});
```

---

## Caveats / gotchas

- **`.server` naming is load-bearing.** `onboarding.server.js` must keep the
  `.server` suffix so Remix strips it from the client bundle (it uses
  `@remix-run/node` `redirect` and server-side `fetch`). The wizard route
  imports its functions only inside the loader.
- **Plan selection happens off-app.** `window.top.location.replace` leaves the
  embedded iframe for Shopify's pricing page. There is no in-app "plan chosen"
  callback — detection relies on `getActivePlan` reading
  `activeSubscriptions` when the merchant returns. A merchant who closes the tab
  mid-checkout simply lands back on the Plan step.
- **The gate re-authenticates.** `requireOnboarded` calls `authenticate.admin`
  itself; that's an extra session check per guarded page. Fine in practice, but
  don't also block the onboarding route or you'll get a redirect loop — the
  guard already no-ops when `pathname === onboardingPath`.
- **Bundled logos point at `trackmyorder.pk`.** They're the original project's
  CDN. Swap the `logo` URLs (or the whole list) for your own assets; the UI
  falls back to a 📦 emoji if an image 404s.
- **Courier connect response shape.** The original project's
  `api.couriers.connect` returned a nested `{ data: { success } }` while the
  client read `res?.data?.success`. Because the kit reuses *your* route, it does
  not control that shape — so `actions.connectCourier` reads both a flat
  `{ success }` and a nested `{ data: { success } }`. If your route returns
  something else, adjust `connectCourier` in `actions.js`.
- **`ensureStore` can create a store with empty fields** if the GraphQL shop
  fetch fails on the final retry. That's intentional (don't block onboarding on
  a transient API hiccup) but means `store_name`/`email` may be `""`.

---

## Underlying packages (reference)

| Package | Role in the kit |
| --- | --- |
| `@remix-run/node` | `json` responses and `redirect` (the gate). |
| `@remix-run/react` | `useLoaderData`, `useNavigate`, `useNavigation` in the wizard. |
| `@shopify/polaris` | All wizard UI (Page, Card, Grid, Banner, Button, …). |
| `@shopify/polaris-icons` | Step + status icons. |
| `@prisma/client` | Default storage adapter (override via `setStoreAdapter`). |
| global `fetch` (Node 18+) | Shop GraphQL fetch + courier credential validation. |
