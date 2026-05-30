// Server-side core for the onboarding + Shopify-plans kit: a pluggable storage
// adapter, the cross-page "must finish onboarding" gate, Shopify plan
// detection, and store bootstrapping. No direct DB or host imports — wire your
// own persistence via setStoreAdapter() (a Prisma factory is provided).

import { redirect } from "@remix-run/node";

// ---------------------------------------------------------------------------
// Storage adapter (pluggable — Prisma, raw SQL, in-memory, anything)
// ---------------------------------------------------------------------------
let adapter = null;

export function setStoreAdapter(a) {
  adapter = a;
}

function getAdapter() {
  if (!adapter) {
    throw new Error(
      "onboarding-plans-kit: no store adapter set. Call setStoreAdapter(createPrismaAdapter(prisma)) once at startup.",
    );
  }
  return adapter;
}

// Default adapter for a Prisma schema with `stores` and `couriers` tables.
// Override model names if yours differ.
export function createPrismaAdapter(prisma, { storeModel = "stores", courierModel = "couriers" } = {}) {
  return {
    getStoreByDomain: (shop) =>
      prisma[storeModel].findFirst({ where: { shopify_domain: shop } }),
    createStore: (data) => prisma[storeModel].create({ data }),
    updateStoreMeta: (storeId, meta_data) =>
      prisma[storeModel].update({
        where: { id: storeId },
        data: { meta_data },
        select: { id: true },
      }),
    listCouriers: (storeId) =>
      prisma[courierModel].findMany({
        where: { store_id: Number(storeId) },
        select: {
          id: true,
          name: true,
          code: true,
          store_id: true,
          description: true,
          meta_data: true,
        },
      }),
  };
}

// ---------------------------------------------------------------------------
// Shop data (minimal GraphQL fetch — used only to seed a new store row)
// ---------------------------------------------------------------------------
export async function fetchShopData(session) {
  try {
    const res = await fetch(`https://${session.shop}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `#graphql
          query getShop {
            shop { id name email currencyCode primaryDomain { host url } }
          }`,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.errors) return null;
    return data.data?.shop ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store bootstrapping (find-or-create with retry/backoff)
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ensureStore(session, { maxRetries = 3 } = {}) {
  const store = getAdapter();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const existing = await store.getStoreByDomain(session.shop);
    if (existing) return existing;

    if (attempt === maxRetries) {
      const shopData = await fetchShopData(session);
      return store.createStore({
        shopify_domain: session.shop,
        email: shopData?.email || "",
        meta_data: shopData || {},
        store_name: shopData?.name || "",
      });
    }
    await wait(attempt * 500);
  }
}

// ---------------------------------------------------------------------------
// Shopify plan detection
// ---------------------------------------------------------------------------
// Returns the active subscription name (lowercased) or null. `admin` is the
// authenticated admin GraphQL client from authenticate.admin(request).
export async function getActivePlan(admin) {
  const query = `#graphql
    query {
      currentAppInstallation {
        activeSubscriptions { id name status currentPeriodEnd }
      }
    }`;
  try {
    const res = await admin.graphql(query);
    const data = await res.json();
    const subs = data.data?.currentAppInstallation?.activeSubscriptions || [];
    return subs[0]?.name?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The gate: redirect to onboarding until the store has finished it.
// ---------------------------------------------------------------------------
// Call this from your app layout loader (app.jsx) so every embedded page is
// guarded. It is a no-op on the onboarding route itself to avoid a redirect
// loop. Returns the store record when onboarded.
export async function requireOnboarded(request, authenticate, { onboardingPath = "/app/onboarding" } = {}) {
  const { session } = await authenticate.admin(request);
  const pathname = new URL(request.url).pathname;
  if (pathname === onboardingPath) return null;

  const store = await getAdapter().getStoreByDomain(session.shop);
  if (!store?.meta_data?.isOnboarded) {
    throw redirect(onboardingPath);
  }
  return store;
}

// ---------------------------------------------------------------------------
// Persistence used by the api.* routes (kept here so routes stay thin).
// ---------------------------------------------------------------------------
export async function saveOnboarded(storeData, plan) {
  const meta_data = { ...(storeData.meta_data || {}) };
  meta_data.isOnboarded = true;
  if (plan) meta_data.plan = plan;
  await getAdapter().updateStoreMeta(storeData.id, meta_data);
  return { success: true };
}

export async function listCouriersForStore(storeId) {
  return getAdapter().listCouriers(storeId);
}
