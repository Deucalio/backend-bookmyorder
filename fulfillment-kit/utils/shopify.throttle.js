// fulfillment-kit/utils/shopify.throttle.js
//
// Shopify GraphQL uses a bucket throttle. Each response's `extensions.cost`
// tells you how many credits were used and how many are left.
// If the bucket is low, we sleep until it refills enough to proceed.

async function waitForCredits(throttleStatus, requiredCredits) {
  const { currentlyAvailable, restoreRate } = throttleStatus;
  if (currentlyAvailable >= requiredCredits) return;

  const deficit = requiredCredits - currentlyAvailable;
  const waitMs = Math.ceil((deficit / restoreRate) * 1000);

  console.log(
    `[shopify.throttle] Need ${requiredCredits} credits, have ${currentlyAvailable}. ` +
    `Waiting ${waitMs}ms to refill...`
  );

  await new Promise(r => setTimeout(r, waitMs));
}

module.exports = { waitForCredits };
