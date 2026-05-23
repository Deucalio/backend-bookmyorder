// courier-module-kit/utils/base.courier.service.js
//
// Abstract base class every courier service inherits from.
// Provides: phone formatting, HTTP calls with retry + timeout, and the
// standardized success/error response shapes. Framework-agnostic — no
// database, no Express, no project-specific imports.

class BaseCourierService {
  constructor(name, baseURL, timeout = 30000) {
    this.name = name;
    this.baseURL = baseURL;
    this.timeout = timeout;
  }

  /**
   * Standardized phone number formatting (Pakistan).
   * Normalizes to a leading-zero 11-digit local format.
   * @param {string} phone
   * @returns {string}
   */
  formatPhoneNumber(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('92') && cleaned.length === 12) return `0${cleaned.substring(2)}`;
    if (cleaned.startsWith('0')) return cleaned;
    return `0${cleaned}`;
  }

  /**
   * API call with retry logic (exponential backoff).
   * Does NOT retry on 4xx validation errors — those fail fast.
   */
  async makeAPICallWithRetry(endpoint, data, headers = {}, maxRetries = 3, method = 'POST') {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.makeAPICall(endpoint, data, headers, method);
      } catch (error) {
        lastError = error;
        console.warn(`[${this.name}] API attempt ${attempt} failed:`, error.message);

        // Don't retry on client errors (4xx) — they won't fix themselves.
        if (error.message.includes('400') || error.message.includes('401') ||
            error.message.includes('403') || error.message.includes('422')) {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`[${this.name}] API failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  async makeAPICall(endpoint, data, headers = {}, method = 'POST') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: method === 'GET' ? undefined : JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout - ${this.name} API did not respond within ${this.timeout / 1000}s`);
      }
      throw error;
    }
  }

  /** Standardized success response — every courier returns this shape. */
  successResponse(data) {
    return {
      success: true,
      courier_name: this.name,
      courier_company: this.name,
      ...data
    };
  }

  /** Standardized error response — every courier returns this shape. */
  errorResponse(error) {
    return {
      success: false,
      courier_name: this.name,
      courier_company: this.name,
      error: error.message || error
    };
  }
}

module.exports = { BaseCourierService };
