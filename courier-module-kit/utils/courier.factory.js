// courier-module-kit/utils/courier.factory.js
//
// Factory that maps a courier name (string) to its service instance.
// This is the single place new couriers get registered.

const lcsService = require('./lcs.service');
const tcsService = require('./tcs.service');

class CourierFactory {
  constructor() {
    this.services = {
      'LCS': lcsService,
      'TCS': tcsService,
      'LEOPARDS': lcsService, // Alias for LCS
    };
  }

  /**
   * Get a courier service instance by name (case-insensitive).
   * @param {string} name - "LCS" | "TCS" | "LEOPARDS"
   * @returns {BaseCourierService}
   */
  getService(name) {
    if (!name) throw new Error('Courier name is required');
    const service = this.services[String(name).toUpperCase()];
    if (!service) {
      throw new Error(`Courier service not found for: ${name}`);
    }
    return service;
  }

  /** List the courier names this factory can dispatch to. */
  supportedCouriers() {
    return Object.keys(this.services);
  }
}

module.exports = new CourierFactory();
