// tracking-sync/statusMap.js
//
// Maps the normalized `status` string from trackmyorder.pk into our
// Fulfillment.deliveryOutcome bucket. Anything not explicitly mapped is
// treated as in-flight ("pending").

const TERMINAL_STATUSES = new Set(['DELIVERED', 'RETURNED', 'FAILED']);

function deliveryOutcomeFor(apiStatus) {
  switch (apiStatus) {
    case 'DELIVERED':
      return 'delivered';
    case 'RETURNED':
      return 'returned';
    case 'FAILED':
      return 'failed';
    default:
      return 'pending';
  }
}

function isTerminal(apiStatus) {
  return TERMINAL_STATUSES.has(apiStatus);
}

module.exports = { deliveryOutcomeFor, isTerminal, TERMINAL_STATUSES };
