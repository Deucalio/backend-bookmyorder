// fulfillment-kit/utils/shopify.fulfillment.js
//
// Core Shopify fulfillment GraphQL operations.
// All functions accept a payload; credentials are resolved via
// fulfillment.credentials.js (inline or DB adapter).
//
// Functions exported:
//   markFulfillment(payload)             — mark a fulfillment order as fulfilled
//   cancelFulfillment(payload)           — cancel a Shopify fulfillment
//   getOpenFulfillmentOrders(payload)    — fetch open/on-hold fulfillment orders for an order
//   tagOrder(payload)                    — add tags to a Shopify order

const { resolveStoreCredentials } = require('./fulfillment.credentials');
const { waitForCredits } = require('./shopify.throttle');

const SHOPIFY_API_VERSION = '2024-04';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toGid(type, id) {
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/${type}/${s}`;
}

async function shopifyGraphQL(platform_store_id, access_token, query, variables = {}, max_retries = 3) {
  const url = `https://${platform_store_id}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': access_token,
  };

  let attempt = 0;
  while (attempt < max_retries) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      attempt++;
      await new Promise(r => setTimeout(r, 1000 * attempt));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Shopify responded with HTTP ${response.status}`);
    }

    const json = await response.json();
    const { data, extensions, errors } = json;

    if (errors?.length) {
      throw new Error(errors.map(e => e.message).join(', '));
    }

    const cost = extensions?.cost;
    if (cost?.throttleStatus) {
      await waitForCredits(cost.throttleStatus, cost.requestedQueryCost || 50);
    }

    return data;
  }

  throw new Error('Shopify GraphQL: max retries reached');
}

// ---------------------------------------------------------------------------
// markFulfillment
// ---------------------------------------------------------------------------

/**
 * Mark a Shopify fulfillment order as fulfilled with tracking info.
 *
 * Payload:
 *   store_id | credentials         — store auth (see fulfillment.credentials.js)
 *   fulfillment_order_id  {string} — Shopify FulfillmentOrder ID (numeric or full GID)
 *   tracking_number       {string} — courier tracking / CN number  (REQUIRED)
 *   tracking_url          {string} — tracking URL (optional)
 *   courier               {string} — courier company name (optional)
 *   notify_customer       {bool}   — default true
 *
 * Returns:
 *   { status: 'success', data: { id, status, trackingInfo: { number, url, company } } }
 *   { status: 'failed',  error: string }
 */
async function markFulfillment(payload, max_retries = 3) {
  try {
    const { platform_store_id, access_token } = await resolveStoreCredentials(payload);
    const {
      fulfillment_order_id,
      tracking_number,
      tracking_url = null,
      courier = null,
      notify_customer = true,
    } = payload;

    if (!fulfillment_order_id) throw new Error('fulfillment_order_id is required');
    if (!tracking_number) throw new Error('tracking_number is required');

    const mutation = `
      mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment {
            id
            status
            trackingInfo {
              number
              url
              company
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          { fulfillmentOrderId: toGid('FulfillmentOrder', fulfillment_order_id) }
        ],
        notifyCustomer: notify_customer,
        trackingInfo: {
          company: courier,
          number: tracking_number,
          url: tracking_url,
        },
      },
    };

    const data = await shopifyGraphQL(platform_store_id, access_token, mutation, variables, max_retries);
    const result = data?.fulfillmentCreateV2 || {};
    const userErrors = result.userErrors || [];

    if (userErrors.length > 0) {
      return { status: 'failed', error: userErrors.map(e => `${e.field}: ${e.message}`).join('; ') };
    }

    return { status: 'success', data: result.fulfillment };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

// ---------------------------------------------------------------------------
// cancelFulfillment
// ---------------------------------------------------------------------------

/**
 * Cancel a Shopify fulfillment.
 *
 * Payload:
 *   store_id | credentials  — store auth
 *   fulfillment_id {string} — Shopify Fulfillment GID (the `data.id` from markFulfillment)
 *
 * Returns:
 *   { status: 'success', data: { id, status } }
 *   { status: 'failed',  error: string }
 */
async function cancelFulfillment(payload, max_retries = 3) {
  try {
    const { platform_store_id, access_token } = await resolveStoreCredentials(payload);
    const { fulfillment_id } = payload;

    if (!fulfillment_id) throw new Error('fulfillment_id is required');

    const mutation = `
      mutation fulfillmentCancel($id: ID!) {
        fulfillmentCancel(id: $id) {
          fulfillment {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await shopifyGraphQL(
      platform_store_id, access_token, mutation, { id: fulfillment_id }, max_retries
    );
    const result = data?.fulfillmentCancel || {};
    const userErrors = result.userErrors || [];

    if (userErrors.length > 0) {
      return { status: 'failed', error: userErrors.map(e => `${e.field}: ${e.message}`).join('; ') };
    }

    return { status: 'success', data: result.fulfillment };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

// ---------------------------------------------------------------------------
// getOpenFulfillmentOrders
// ---------------------------------------------------------------------------

/**
 * Fetch open / on-hold fulfillment orders for a single Shopify order.
 * Call this to get fulfillment_order_id(s) when you only have the order ID.
 *
 * Payload:
 *   store_id | credentials    — store auth
 *   platform_order_id {string} — numeric Shopify order ID
 *
 * Returns:
 *   { status: 'success', fulfillment_orders: [ { fulfillment_order_id, fulfillment_order_gid, status, line_items[] } ] }
 *   { status: 'no_fulfillment_orders', message: string }
 *   { status: 'failed', error: string }
 */
async function getOpenFulfillmentOrders(payload, max_retries = 3) {
  try {
    const { platform_store_id, access_token } = await resolveStoreCredentials(payload);
    const { platform_order_id } = payload;

    if (!platform_order_id) throw new Error('platform_order_id is required');

    const query = `
      query getFulfillmentOrders($orderId: ID!) {
        order(id: $orderId) {
          id
          fulfillmentOrders(first: 10, query: "status:OPEN OR status:ON_HOLD") {
            edges {
              node {
                id
                status
                lineItems(first: 100) {
                  edges {
                    node {
                      id
                      totalQuantity
                      lineItem {
                        id
                        sku
                        title
                        quantity
                        variant { id }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(
      platform_store_id,
      access_token,
      query,
      { orderId: toGid('Order', platform_order_id) },
      max_retries
    );

    const edges = data?.order?.fulfillmentOrders?.edges || [];

    if (!edges.length) {
      return { status: 'no_fulfillment_orders', message: 'No open fulfillment orders found' };
    }

    const fulfillment_orders = edges.map(({ node }) => ({
      fulfillment_order_id: node.id.split('/').pop(),
      fulfillment_order_gid: node.id,
      status: node.status,
      line_items: (node.lineItems?.edges || []).map(({ node: itemNode }) => ({
        fulfillment_order_line_item_id: itemNode.id.split('/').pop(),
        fulfillment_order_quantity: itemNode.totalQuantity,
        line_item_id: itemNode.lineItem?.id?.split('/').pop(),
        variant_id: itemNode.lineItem?.variant?.id?.split('/').pop(),
        sku: itemNode.lineItem?.sku || null,
        title: itemNode.lineItem?.title || null,
      })),
    }));

    return { status: 'success', fulfillment_orders };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

// ---------------------------------------------------------------------------
// tagOrder
// ---------------------------------------------------------------------------

/**
 * Add tags to a Shopify order.
 *
 * Payload:
 *   store_id | credentials      — store auth
 *   platform_order_id {string}  — numeric Shopify order ID
 *   tags {string | string[]}    — one or more tags to add
 *
 * Returns:
 *   { status: 'success' }
 *   { status: 'failed', error: string }
 */
async function tagOrder(payload) {
  try {
    const { platform_store_id, access_token } = await resolveStoreCredentials(payload);
    const { platform_order_id, tags } = payload;

    if (!platform_order_id) throw new Error('platform_order_id is required');

    const tagArray = Array.isArray(tags) ? tags : [tags].filter(Boolean);
    if (!tagArray.length) throw new Error('tags must be a non-empty string or array');

    const mutation = `
      mutation addTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node { id }
          userErrors { message }
        }
      }
    `;

    const data = await shopifyGraphQL(platform_store_id, access_token, mutation, {
      id: toGid('Order', platform_order_id),
      tags: tagArray,
    });

    const userErrors = data?.tagsAdd?.userErrors || [];
    if (userErrors.length > 0) {
      return { status: 'failed', error: userErrors.map(e => e.message).join('; ') };
    }

    return { status: 'success' };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

module.exports = {
  markFulfillment,
  cancelFulfillment,
  getOpenFulfillmentOrders,
  tagOrder,
};
