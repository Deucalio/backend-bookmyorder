// fulfillment-kit/utils/batch.fulfillment.service.js
//
// Runs multiple mark / cancel operations in parallel (Promise.allSettled).
// One failure never blocks the rest — returns a partial-success report.

const { markFulfillment, cancelFulfillment } = require('./shopify.fulfillment');

class BatchFulfillmentService {
  /**
   * Mark many fulfillment orders in parallel.
   * @param {Array<Object>} payloads — array of FulfillmentMarkPayloads
   * @returns {Promise<{ successful, failed, summary }>}
   */
  async processBatchMark(payloads) {
    const results = {
      successful: [],
      failed: [],
      summary: { total: payloads?.length || 0, success: 0, failed: 0 },
    };
    if (!payloads?.length) return results;

    const batch = await Promise.allSettled(payloads.map(p => markFulfillment(p)));

    batch.forEach((res, i) => {
      const ref = payloads[i]?.fulfillment_order_id;

      if (res.status === 'fulfilled' && res.value?.status === 'success') {
        results.successful.push({ fulfillment_order_id: ref, ...res.value });
        results.summary.success++;
      } else {
        const error = res.status === 'fulfilled'
          ? (res.value?.error || 'Mark fulfillment failed')
          : (res.reason?.message || 'Unknown error');
        results.failed.push({ fulfillment_order_id: ref, error });
        results.summary.failed++;
      }
    });

    return results;
  }

  /**
   * Cancel many fulfillments in parallel.
   * @param {Array<Object>} payloads — array of FulfillmentCancelPayloads
   * @returns {Promise<{ successful, failed, summary }>}
   */
  async processBatchCancel(payloads) {
    const results = {
      successful: [],
      failed: [],
      summary: { total: payloads?.length || 0, success: 0, failed: 0 },
    };
    if (!payloads?.length) return results;

    const batch = await Promise.allSettled(payloads.map(p => cancelFulfillment(p)));

    batch.forEach((res, i) => {
      const ref = payloads[i]?.fulfillment_id;

      if (res.status === 'fulfilled' && res.value?.status === 'success') {
        results.successful.push({ fulfillment_id: ref, ...res.value });
        results.summary.success++;
      } else {
        const error = res.status === 'fulfilled'
          ? (res.value?.error || 'Cancel failed')
          : (res.reason?.message || 'Unknown error');
        results.failed.push({ fulfillment_id: ref, error });
        results.summary.failed++;
      }
    });

    return results;
  }
}

module.exports = new BatchFulfillmentService();
module.exports.BatchFulfillmentService = BatchFulfillmentService;
