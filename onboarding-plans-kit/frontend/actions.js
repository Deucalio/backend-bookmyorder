// Browser-side fetch helpers for the onboarding wizard. Every function returns
// a uniform { success, ...data } | { success: false, error } shape so the UI
// never has to know about HTTP status codes.

// Marks the store as onboarded and persists the chosen plan. Hits the
// api.onboarding.complete route shipped in backend/.
export async function completeOnboarding(storeData, plan) {
  try {
    const res = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeData, plan }),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || "Failed to complete onboarding" };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || "Network error" };
  }
}

// Connects a single courier by POSTing to YOUR project's existing
// /api/couriers/connect route — this kit does not ship one. The body sent is
// { storeID, courierCode, meta_data }. The response is read tolerantly so it
// works whether your route returns a flat `{ success }` or a nested
// `{ data: { success } }` (the shape the original project used). Point
// CONNECT_URL elsewhere if your route lives at a different path.
const CONNECT_URL = "/api/couriers/connect";

export async function connectCourier({ storeID, courierCode, meta_data }) {
  try {
    const res = await fetch(CONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeID, courierCode, meta_data }),
    });
    const body = await res.json();
    const payload = body?.data ?? body; // unwrap nested { data: ... } if present
    const ok = payload?.success ?? body?.success;
    if (!ok) {
      return { success: false, error: payload?.message || payload?.error || "Failed to connect courier" };
    }
    return { success: true, courier: payload?.courier };
  } catch (e) {
    return { success: false, error: e.message || "Network error" };
  }
}
