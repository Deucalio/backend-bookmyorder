// courier-module-kit/utils/tcs.service.js
//
// TCS Courier implementation.
// Translates the kit's Standardized Payload into TCS' API format,
// books / cancels parcels, and translates the response back to the
// standardized success/error shape.
//
// TCS API base: https://ociconnect.tcscourier.com/ecom

const { BaseCourierService } = require('./base.courier.service');
const { resolveAccessData, resolveCityName } = require('./courier.credentials');

class TCSService extends BaseCourierService {
  constructor() {
    super('TCS', process.env.TCS_API_URL || 'https://ociconnect.tcscourier.com/ecom');
  }

  // ===========================================================================
  // Public API — every courier service exposes exactly bookOrder + cancelOrder.
  // ===========================================================================

  /**
   * Book a single parcel.
   * @param {Object} payload - Standardized Booking Payload (see the kit guide)
   * @returns {Promise<Object>} standardized success/error response
   */
  async bookOrder(payload) {
    try {
      this.validatePayload(payload);

      const access_data = await resolveAccessData(payload);

      // TCS books with a city NAME. If only an internal city_id was supplied,
      // try to resolve it via the optional city-lookup adapter.
      if (payload.customer_info.city_id && !payload.customer_info.city_name) {
        const cityName = await resolveCityName(payload.customer_info.city_id);
        payload.customer_info.city_name = cityName || payload.customer_info.city;
      }

      const tcsPayload = this.mapToTCS(payload, access_data);
      const headers = {
        'Authorization': `Bearer ${access_data.bearertoken || process.env.TCS_BEARER_TOKEN || ''}`
      };

      console.log(`[TCS] Booking Payload for ${payload.order_info?.order_number}:`, JSON.stringify(tcsPayload, null, 2));
      const response = await this.makeAPICallWithRetry('/api/booking/create', tcsPayload, headers);
      console.log(`[TCS] Raw Response for ${payload.order_info?.order_number}:`, JSON.stringify(response, null, 2));

      return this.processTCSResponse(response);

    } catch (error) {
      console.error('[TCS] Booking failed:', error.message);
      return this.errorResponse(error);
    }
  }

  /**
   * Cancel a booked parcel.
   * @param {Object} payload - Standardized Cancellation Payload:
   *        { courier, tracking_number, credentials | courier_account_id, reason? }
   * @returns {Promise<Object>} standardized success/error response
   */
  async cancelOrder(payload) {
    try {
      const access_data = await resolveAccessData(payload);
      const accessToken = access_data?.accesstoken || access_data?.bearertoken || process.env.TCS_BEARER_TOKEN || '';
      if (!accessToken) throw new Error('Missing TCS access token');
      if (!payload.tracking_number) throw new Error('Missing tracking_number');

      const headers = {
        'Authorization': `Bearer ${access_data?.bearertoken || process.env.TCS_BEARER_TOKEN || accessToken}`
      };

      const requestData = {
        consignmentnumber: payload.tracking_number,
        accesstoken: accessToken
      };

      const response = await this.makeAPICallWithRetry('/api/booking/cancel', requestData, headers);

      if (response.message === 'SUCCESS' || response.success === true) {
        return this.successResponse({
          message: 'Order cancelled successfully with TCS',
          tracking_number: payload.tracking_number,
          response_data: response
        });
      }

      throw new Error(response.message || response.error || 'TCS Cancellation Failed');

    } catch (error) {
      return this.errorResponse(error);
    }
  }

  /**
   * Fetch a fresh TCS access token.
   *
   * TCS exposes GET /api/authentication/token?username=X&password=Y secured
   * by a long-lived `Authorization: Bearer <bearertoken>`. The response
   * carries a short-lived `accesstoken` used in subsequent booking calls.
   *
   * @param {Object} args - { bearertoken, username, password }
   * @returns {Promise<Object>} standardized response with `accesstoken`
   */
  async getAuthToken({ bearertoken, username, password } = {}) {
    try {
      if (!bearertoken) throw new Error('Missing bearertoken');
      if (!username)    throw new Error('Missing username');
      if (!password)    throw new Error('Missing password');

      const endpoint = `/api/authentication/token?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      const headers = { 'Authorization': `Bearer ${bearertoken}` };

      const response = await this.makeAPICall(endpoint, null, headers, 'GET');

      // The token field name varies across TCS environments — check the
      // common variants before giving up.
      const accesstoken = response?.accesstoken
        || response?.accessToken
        || response?.access_token
        || response?.token
        || response?.data?.accesstoken
        || response?.data?.accessToken
        || response?.data?.token;

      if (!accesstoken) {
        throw new Error('TCS auth response did not contain an access token: ' + JSON.stringify(response));
      }

      return this.successResponse({
        message: 'TCS access token retrieved successfully.',
        accesstoken,
        response_data: response
      });

    } catch (error) {
      return this.errorResponse(error);
    }
  }

  /**
   * Lightweight credential validation. If the caller supplies
   * `bearertoken + username + password`, we hit /api/authentication/token —
   * success there proves the keys are real. Otherwise we fall back to a
   * shape check (TCS exposes no read-only ping endpoint).
   *
   * @param {Object} credentials
   * @returns {Promise<Object>} standardized success/error response
   */
  async testCredentials(credentials) {
    try {
      if (!credentials || typeof credentials !== 'object') {
        throw new Error('Missing credentials');
      }

      if (credentials.bearertoken && credentials.username && credentials.password) {
        const result = await this.getAuthToken({
          bearertoken: credentials.bearertoken,
          username:    credentials.username,
          password:    credentials.password,
        });
        if (!result.success) {
          throw new Error(result.error || 'TCS credential check failed');
        }
        return this.successResponse({
          message: 'TCS credentials are valid — fresh access token obtained.',
          accesstoken: result.accesstoken,
        });
      }

      // No username/password to do a live check — fall back to shape only.
      const missing = ['bearertoken', 'accesstoken'].filter(k => !credentials[k]);
      if (missing.length) {
        throw new Error('Missing TCS credentials: ' + missing.join(', '));
      }

      return this.successResponse({
        message: 'TCS credentials present (shape check only — supply username + password for a live check).'
      });

    } catch (error) {
      return this.errorResponse(error);
    }
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  /** Throws if a required field is missing from the standardized payload. */
  validatePayload(payload) {
    const requiredOrder = ['order_number', 'cod_amount', 'weight'];
    const requiredCustomer = ['name', 'phone', 'address']; // TCS resolves city by name

    requiredOrder.forEach(field => {
      if (payload.order_info?.[field] === undefined) throw new Error(`Missing order_info.${field}`);
    });

    requiredCustomer.forEach(field => {
      if (payload.customer_info?.[field] === undefined) throw new Error(`Missing customer_info.${field}`);
    });
  }

  /** Map the Standardized Payload to TCS' booking/create request body. */
  mapToTCS(payload, access_data) {
    const { order_info, customer_info, courier_data = {} } = payload;
    const { first, middle, last } = this.splitName(customer_info.name);

    // TCS requires specific shipper info. `shipper_details` may nest
    // TCS-specific origin fields (cityName/cityCode/tcs_account/cost_center_code)
    // inside `tcs_origin`, so resolve from there first and fall back to
    // top-level keys.
    const shipper = access_data.shipper_details || {};
    const tcsOrigin = shipper.tcs_origin || {};
    const tcsAccount = (tcsOrigin.tcs_account && String(tcsOrigin.tcs_account).trim())
      || access_data.account_number || access_data.costCenter || access_data.cost_center
      || access_data.userName || '704576';
    const originCityName = tcsOrigin.cityName || shipper.cityName || shipper.city || 'Karachi';
    const originCityCode = tcsOrigin.cityCode || shipper.cityCode || 'KHI';
    const costCenterCode = tcsOrigin.cost_center_code || shipper.cost_center_code || tcsAccount || '034';

    return {
      accesstoken: access_data.accesstoken || access_data.bearertoken || process.env.TCS_BEARER_TOKEN || '',
      shipperinfo: {
        tcsaccount:  String(tcsAccount).substring(0, 12),
        shippername: String(shipper.name || courier_data.shipper_name || 'Verification Store').substring(0, 50),
        address1:    String(shipper.address || courier_data.shipper_address || 'Verification Warehouse, Karachi').substring(0, 120),
        address2:    null,
        address3:    null,
        zip:         null,
        countrycode: 'PK',
        countryname: 'Pakistan',
        citycode:    originCityCode,
        cityname:    String(originCityName).substring(0, 50),
        mobile:      this.formatPhoneNumber(shipper.phone || courier_data.shipper_phone || '03001234567'),
      },
      consigneeinfo: {
        firstname:   String(first).substring(0, 50),
        middlename:  middle ? String(middle).substring(0, 50) : null,
        lastname:    last   ? String(last).substring(0, 50)   : null,
        address1:    String(customer_info.address).substring(0, 120),
        countrycode: 'PK',
        countryname: 'Pakistan',
        cityname:    String(customer_info.city_name || customer_info.city).trim().substring(0, 50),
        mobile:      this.formatPhoneNumber(customer_info.phone),
      },
      shipmentinfo: {
        costcentercode: String(costCenterCode).substring(0, 20) || null,
        referenceno:    String(order_info.order_number).substring(0, 50),
        contentdesc:    String(order_info.product_details || 'General Items').substring(0, 999),
        servicecode:    courier_data.service_code || 'O', // O = Overnight
        shipmentdate:   this.formatShipmentDate(new Date()),
        currency:       'PKR',
        codamount:      Math.round(parseFloat(order_info.cod_amount) || 0),
        weightinkg:     Math.max(parseFloat(order_info.weight), 0.5),
        pieces:         Math.max(parseInt(order_info.pieces) || 1, 1),
        fragile:        !!courier_data.fragile,
        remarks:        String(courier_data.special_instructions || '').substring(0, 500) || null,
      },
    };
  }

  /** Translate the TCS response into the standardized success response. */
  processTCSResponse(response) {
    if (response.success === false || response.returnStatus?.status === 'FAIL' || response.returnStatus?.status === 'ERROR') {
      throw new Error(response.returnStatus?.message || response.message || response.error || JSON.stringify(response));
    }

    const trackingNumber = response.consignmentNo || response.consignmentNumber
      || response.trackingNumber || response.consignment_number;
    if (!trackingNumber) {
      throw new Error('Consignment number not found in TCS response: ' + JSON.stringify(response));
    }

    return this.successResponse({
      tracking_number: trackingNumber,
      tracking_url: `https://trackmyorder.pk/?tracking_no=${trackingNumber}&courier=tcs`,
      courier_reference: trackingNumber,
      response_data: response
    });
  }

  /** Split a full name into first / middle / last for TCS' consignee fields. */
  splitName(fullName = '') {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
    if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
    return {
      first: parts[0],
      middle: parts.slice(1, -1).join(' '),
      last: parts[parts.length - 1],
    };
  }

  /** TCS expects shipmentdate as "dd/mm/yyyy HH:MM:SS". */
  formatShipmentDate(date = new Date()) {
    const dd   = String(date.getDate()).padStart(2, '0');
    const mm   = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const HH   = String(date.getHours()).padStart(2, '0');
    const min  = String(date.getMinutes()).padStart(2, '0');
    const ss   = String(date.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${HH}:${min}:${ss}`;
  }
}

module.exports = new TCSService();
