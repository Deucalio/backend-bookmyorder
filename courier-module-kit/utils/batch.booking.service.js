// courier-module-kit/utils/batch.booking.service.js
//
// Orchestrates batch booking & batch cancellation across couriers.
// Runs every payload in parallel and never lets one failure abort the rest —
// it returns a partial-success report (successful[] / failed[] / summary).
//
// This is framework- and database-agnostic. It only knows about the
// Standardized Payload and the courier factory.

const courierFactory = require('./courier.factory');

class BatchBookingService {
  /**
   * Book a single standardized payload.
   * @param {Object} payload - Standardized Booking Payload
   * @returns {Promise<Object>} standardized success/error response
   */
  async bookOne(payload) {
    const service = courierFactory.getService(payload.courier);
    return service.bookOrder(payload);
  }

  /**
   * Cancel a single standardized payload.
   * @param {Object} payload - Standardized Cancellation Payload
   * @returns {Promise<Object>} standardized success/error response
   */
  async cancelOne(payload) {
    const service = courierFactory.getService(payload.courier);
    return service.cancelOrder(payload);
  }

  /**
   * Book many parcels in parallel.
   * @param {Array<Object>} payloads - array of Standardized Booking Payloads
   * @returns {Promise<{successful: Array, failed: Array, summary: Object}>}
   */
  async processBatchBooking(payloads) {
    const results = {
      successful: [],
      failed: [],
      summary: { total: payloads?.length || 0, success: 0, failed: 0 }
    };
    if (!payloads || payloads.length === 0) return results;

    const batch = await Promise.allSettled(payloads.map(p => this.bookOne(p)));

    batch.forEach((res, i) => {
      const payload = payloads[i];
      const order_number = payload?.order_info?.order_number;

      if (res.status === 'fulfilled' && res.value?.success) {
        results.successful.push({ order_number, ...res.value });
        results.summary.success++;
      } else {
        const error = res.status === 'fulfilled'
          ? (res.value?.error || 'Booking failed')
          : (res.reason?.message || 'Unknown error occurred');
        results.failed.push({ order_number, error });
        results.summary.failed++;
      }
    });

    return results;
  }

  /**
   * Cancel many parcels in parallel.
   * @param {Array<Object>} payloads - array of Standardized Cancellation Payloads
   * @returns {Promise<{successful: Array, failed: Array, summary: Object}>}
   */
  async processBatchCancellation(payloads) {
    const results = {
      successful: [],
      failed: [],
      summary: { total: payloads?.length || 0, success: 0, failed: 0 }
    };
    if (!payloads || payloads.length === 0) return results;

    const batch = await Promise.allSettled(payloads.map(p => this.cancelOne(p)));

    batch.forEach((res, i) => {
      const payload = payloads[i];
      const tracking_number = payload?.tracking_number;

      if (res.status === 'fulfilled' && res.value?.success) {
        results.successful.push({ tracking_number, ...res.value });
        results.summary.success++;
      } else {
        const error = res.status === 'fulfilled'
          ? (res.value?.error || 'Cancellation failed')
          : (res.reason?.message || 'Unknown error occurred');
        results.failed.push({ tracking_number, error });
        results.summary.failed++;
      }
    });

    return results;
  }
}

module.exports = new BatchBookingService();
module.exports.BatchBookingService = BatchBookingService;
