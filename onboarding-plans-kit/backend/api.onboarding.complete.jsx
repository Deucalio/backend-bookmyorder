// Remix action route: POST /api/onboarding/complete
// Flips the store's isOnboarded flag (and records the chosen plan) so the
// requireOnboarded gate stops redirecting. Returns { success } | { success: false, error }.

import { json } from "@remix-run/node";
import { saveOnboarded } from "../onboarding-kit/onboarding.server";

export async function action({ request }) {
  const { storeData, plan } = await request.json();

  if (!storeData?.id) {
    return json({ success: false, error: "Missing storeData.id" }, { status: 400 });
  }

  try {
    await saveOnboarded(storeData, plan);
    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: e.message || "Error saving onboarding state" }, { status: 500 });
  }
}
