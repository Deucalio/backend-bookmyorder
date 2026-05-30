// courier-module-kit/utils/lcs.service.js
//
// Leopards Courier (LCS) implementation.
// Translates the kit's Standardized Payload into Leopards' API format,
// books / cancels parcels, and translates the response back to the
// standardized success/error shape.
//
// Leopards API docs: https://merchantapi.leopardscourier.com

const { BaseCourierService } = require('./base.courier.service');
const { resolveAccessData } = require('./courier.credentials');

class LCSService extends BaseCourierService {
  constructor() {
    super('LCS', process.env.LCS_API_URL || 'https://merchantapi.leopardscourier.com');
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
    const orderNum = payload.order_info?.order_number ?? 'unknown';
    try {
      this.validatePayload(payload);
      const access_data = await resolveAccessData(payload);
      const lcsPayload = this.mapToLCS(payload, access_data);

      console.log(
        `[LCS] Booking | order: ${orderNum} | city_id: ${payload.customer_info?.city_id} | ` +
        `cod: ${payload.order_info?.cod_amount} | weight: ${payload.order_info?.weight} | ` +
        `service: ${lcsPayload.shipment_type}`
      );
      console.log(`[LCS] Payload for ${orderNum}:`, JSON.stringify(lcsPayload, null, 2));

      const response = await this.makeAPICallWithRetry('/api/bookPacket/format/json/', lcsPayload);
      console.log(`[LCS] Raw response for ${orderNum}:`, JSON.stringify(response, null, 2));

      const result = this.processLCSResponse(response);
      console.log(
        `[LCS] Booking SUCCESS | order: ${orderNum} | tracking: ${result.tracking_number}` +
        (result.slip_link ? ` | slip: ${result.slip_link}` : '')
      );
      return result;

    } catch (error) {
      console.error(`[LCS] Booking FAILED | order: ${orderNum} | error: ${error.message}`);
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
    const trackingNumber = payload.tracking_number;
    try {
      const access_data = await resolveAccessData(payload);
      if (!trackingNumber) throw new Error('Missing tracking_number');

      console.log(`[LCS] Cancel | tracking: ${trackingNumber}`);

      const requestData = {
        api_key: access_data.api_key,
        api_password: access_data.api_password,
        cn_numbers: trackingNumber
      };

      const response = await this.makeAPICallWithRetry('/api/cancelBookedPackets/format/json/', requestData);
      console.log(`[LCS] Cancel response for ${trackingNumber}:`, JSON.stringify(response, null, 2));

      if (response.status != 1) {
        throw new Error(response.error || response.message || 'LCS Cancellation Failed');
      }

      console.log(`[LCS] Cancel SUCCESS | tracking: ${trackingNumber}`);
      return this.successResponse({
        message: 'Order cancelled successfully',
        tracking_number: trackingNumber,
        response_data: response
      });

    } catch (error) {
      console.error(`[LCS] Cancel FAILED | tracking: ${trackingNumber ?? 'unknown'} | error: ${error.message}`);
      return this.errorResponse(error);
    }
  }

  /**
   * Lightweight credential validation. Calls /getAllCities — the cheapest
   * authenticated endpoint LCS exposes — and treats `status == 1` as proof
   * the api_key / api_password are valid. Does NOT create any shipment.
   *
   * @param {Object} credentials - { api_key, api_password }
   * @returns {Promise<Object>} standardized success/error response
   */
  async testCredentials(credentials) {
    try {
      if (!credentials?.api_key || !credentials?.api_password) {
        throw new Error('Missing api_key or api_password');
      }

      const response = await this.makeAPICallWithRetry('/api/getAllCities/format/json/', {
        api_key: credentials.api_key,
        api_password: credentials.api_password
      });

      if (response.status != 1) {
        throw new Error(response.error || response.message || 'LCS credentials are invalid');
      }

      return this.successResponse({
        message: 'LCS credentials are valid.',
        cities_count: Array.isArray(response.city_list) ? response.city_list.length : 0
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
    const requiredCustomer = ['name', 'phone', 'address', 'city_id']; // LCS needs a numeric city_id

    requiredOrder.forEach(field => {
      if (payload.order_info?.[field] === undefined) throw new Error(`Missing order_info.${field}`);
    });

    requiredCustomer.forEach(field => {
      if (payload.customer_info?.[field] === undefined) throw new Error(`Missing customer_info.${field}`);
    });
  }

  /** Map the Standardized Payload to Leopards' bookPacket request body. */
  mapToLCS(payload, access_data) {
    const { order_info, customer_info, courier_data = {} } = payload;

    return {
      api_key: access_data.api_key,
      api_password: access_data.api_password,
      booked_packet_no_piece: order_info.pieces || 1,
      booked_packet_weight: Math.max(parseFloat(order_info.weight), 0.1),
      booked_packet_collect_amount: parseFloat(order_info.cod_amount) || 0,
      booked_packet_order_id: String(order_info.order_number).substring(0, 50),
      origin_city: parseInt(courier_data.origin_city_id) || 1, // Default Karachi
      destination_city: parseInt(customer_info.city_id),
      shipment_id: courier_data.shipment_id || access_data.shipment_id || '',
      shipment_name_eng: String(courier_data.shipper_name || access_data.shipment_name || '').substring(0, 100),
      shipment_email: courier_data.shipper_email || access_data.shipment_email || '',
      shipment_phone: this.formatPhoneNumber(courier_data.shipper_phone || access_data.shipment_phone || ''),
      shipment_address: String(courier_data.shipper_address || access_data.shipment_address || '').substring(0, 200),
      consignment_name_eng: String(customer_info.name).substring(0, 100),
      consignment_phone: this.formatPhoneNumber(customer_info.phone),
      consignment_address: String(customer_info.address).substring(0, 200),
      special_instructions: String(courier_data.special_instructions || order_info.product_details || '').substring(0, 500),
      shipment_type: courier_data.service_type || 'OVERNIGHT'
    };
  }

  /** Translate the LCS response into the standardized success response. */
  processLCSResponse(response) {
    if (response.status != 1) {
      throw new Error(response.error || response.message || 'LCS API Error');
    }

    if (!response.track_number) {
      throw new Error('No tracking number returned from LCS');
    }

    return this.successResponse({
      tracking_number: response.track_number,
      slip_link: response.slip_link || null,
      tracking_url: `https://trackmyorder.pk/?tracking_no=${response.track_number}&courier=leopards`,
      courier_reference: response.track_number,
      response_data: response
    });
  }
}

module.exports = new LCSService();
