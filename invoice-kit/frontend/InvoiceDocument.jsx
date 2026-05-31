// InvoiceDocument.jsx
//
// A4 invoice rendered with @react-pdf/renderer. One PDF page per order
// (page-break per order is automatic since each order is its own <Page>).
// Consumes the view model from mapInvoiceData.js.
//
// Install:  npm i @react-pdf/renderer

import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';

const c = {
  ink: '#1f2937',
  sub: '#6b7280',
  line: '#e5e7eb',
  faint: '#f8fafc',
  blue: '#3b82f6',
  green: '#16a34a',
  warnBg: '#fef3c7',
  warnEdge: '#f59e0b',
  warnText: '#92400e',
  removed: '#9ca3af',
};

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, color: c.ink, fontFamily: 'Helvetica' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 2, borderBottomColor: c.line, paddingBottom: 12, marginBottom: 14 },
  storeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  storeLogo: { width: 48, height: 48, objectFit: 'contain', borderWidth: 1, borderColor: c.line, borderRadius: 6, marginRight: 10 },
  storeName: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  storeContact: { fontSize: 8, color: c.sub, lineHeight: 1.4 },
  invoiceTitleWrap: { alignItems: 'flex-end' },
  invoiceTitle: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: c.blue },
  invoiceDate: { fontSize: 8, color: c.sub, marginTop: 2 },

  orderHeader: { backgroundColor: c.faint, borderRadius: 5, padding: 10, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between' },
  orderNumber: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  orderMeta: { fontSize: 8, color: c.sub, marginTop: 3 },
  orderTotal: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: c.green, textAlign: 'right' },

  addresses: { flexDirection: 'row', gap: 24, marginBottom: 14 },
  addressCol: { flex: 1 },
  addressTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 5 },
  addressName: { fontFamily: 'Helvetica-Bold' },
  addressLine: { color: c.sub, lineHeight: 1.4 },

  table: { borderWidth: 1, borderColor: c.line, borderRadius: 4, marginBottom: 12 },
  th: { flexDirection: 'row', backgroundColor: c.faint, borderBottomWidth: 1, borderBottomColor: c.line },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.line, alignItems: 'center' },
  trLast: { borderBottomWidth: 0 },
  cell: { padding: 6 },
  cellImg: { width: '12%', alignItems: 'center' },
  cellName: { width: '46%' },
  cellQty: { width: '10%', textAlign: 'center' },
  cellPrice: { width: '16%', textAlign: 'right' },
  cellTotal: { width: '16%', textAlign: 'right' },
  thText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#374151' },
  itemImg: { width: 28, height: 28, objectFit: 'cover', borderRadius: 3 },
  itemName: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  itemSku: { fontSize: 7, color: c.sub, marginTop: 1 },
  removed: { color: c.removed, textDecoration: 'line-through' },
  removedTag: { fontSize: 7, color: '#ef4444', fontFamily: 'Helvetica-Bold', marginTop: 1 },

  totals: { backgroundColor: c.faint, borderRadius: 5, padding: 12, alignSelf: 'flex-end', width: '45%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalLabel: { color: c.sub },
  grandRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: c.line, paddingTop: 6, marginTop: 6 },
  grandText: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  discount: { color: c.green },

  payment: { marginTop: 14, backgroundColor: c.warnBg, borderLeftWidth: 4, borderLeftColor: c.warnEdge, borderRadius: 4, padding: 10 },
  paymentTitle: { fontFamily: 'Helvetica-Bold', color: c.warnText, marginBottom: 3 },
  paymentLine: { color: c.warnText, lineHeight: 1.5 },

  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, textAlign: 'center', fontSize: 7, color: c.sub, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 6 },
});

const InvoiceDocument = ({ invoice, footerNote }) => {
  const { sections = [], currency = 'PKR' } = invoice || {};

  if (sections.length === 0) {
    return (
      <Document>
        <Page size="A4" style={styles.page}>
          <Text>No invoice data available.</Text>
        </Page>
      </Document>
    );
  }

  // Display whole-number currency only — round to nearest integer so unit
  // prices and totals don't show decimals.
  const money = (n) => `${currency} ${Math.round(Number(n || 0)).toLocaleString()}`;

  return (
    <Document>
      {sections.flatMap((section) =>
        section.orders.map((order) => (
          <Page key={order.id} size="A4" style={styles.page} wrap>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.storeRow}>
                {section.store.logo_url ? (
                  <Image style={styles.storeLogo} src={section.store.logo_url} />
                ) : null}
                <View>
                  <Text style={styles.storeName}>{section.store.name}</Text>
                  <View style={styles.storeContact}>
                    {section.store.address ? <Text>{section.store.address}</Text> : null}
                    {section.store.phone ? <Text>{section.store.phone}</Text> : null}
                    {section.store.email ? <Text>{section.store.email}</Text> : null}
                  </View>
                </View>
              </View>
              <View style={styles.invoiceTitleWrap}>
                <Text style={styles.invoiceTitle}>INVOICE</Text>
                <Text style={styles.invoiceDate}>
                  {formatDate(invoice.generatedAt)}
                </Text>
              </View>
            </View>

            {/* Order header */}
            <View style={styles.orderHeader}>
              <View>
                <Text style={styles.orderNumber}>Order #{order.order_number}</Text>
                <Text style={styles.orderMeta}>
                  {order.confirmation_number ? `Confirmation: ${order.confirmation_number}   ` : ''}
                  {order.status ? `Status: ${order.status}   ` : ''}
                  {order.payment_method ? `Payment: ${order.payment_method}` : ''}
                </Text>
              </View>
              <View>
                <Text style={styles.orderTotal}>{money(order.total_amount)}</Text>
                {order.order_date ? (
                  <Text style={[styles.orderMeta, { textAlign: 'right' }]}>{formatDate(order.order_date)}</Text>
                ) : null}
              </View>
            </View>

            {/* Addresses */}
            <View style={styles.addresses}>
              <Address title="Billing Address" addr={order.billing_address} />
              <Address title="Shipping Address" addr={order.shipping_address} />
            </View>

            {/* Items */}
            <View style={styles.table}>
              <View style={styles.th}>
                <Text style={[styles.cell, styles.cellImg, styles.thText]}>Image</Text>
                <Text style={[styles.cell, styles.cellName, styles.thText]}>Product</Text>
                <Text style={[styles.cell, styles.cellQty, styles.thText]}>Qty</Text>
                <Text style={[styles.cell, styles.cellPrice, styles.thText]}>Unit</Text>
                <Text style={[styles.cell, styles.cellTotal, styles.thText]}>Total</Text>
              </View>
              {order.items.map((item, i) => (
                <View key={item.id || i} style={[styles.tr, i === order.items.length - 1 ? styles.trLast : null]}>
                  <View style={[styles.cell, styles.cellImg]}>
                    {item.image_url ? <Image style={styles.itemImg} src={item.image_url} /> : null}
                  </View>
                  <View style={[styles.cell, styles.cellName]}>
                    <Text style={[styles.itemName, item.is_removed ? styles.removed : null]}>{item.name}</Text>
                    <Text style={styles.itemSku}>
                      SKU: {item.sku}{item.variant_title ? ` • ${item.variant_title}` : ''}
                    </Text>
                    {item.is_removed ? <Text style={styles.removedTag}>Removed from order</Text> : null}
                  </View>
                  <Text style={[styles.cell, styles.cellQty, item.is_removed ? styles.removed : null]}>{item.quantity}</Text>
                  <Text style={[styles.cell, styles.cellPrice, item.is_removed ? styles.removed : null]}>{money(item.unit_price)}</Text>
                  <Text style={[styles.cell, styles.cellTotal, item.is_removed ? styles.removed : null]}>{money(item.total_price)}</Text>
                </View>
              ))}
            </View>

            {/* Totals */}
            <View style={styles.totals}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal:</Text>
                <Text>{money(order.subtotal)}</Text>
              </View>
              {order.tax_amount > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Tax (GST):</Text>
                  <Text>{money(order.tax_amount)}</Text>
                </View>
              ) : null}
              {order.shipping_amount > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Shipping:</Text>
                  <Text>{money(order.shipping_amount)}</Text>
                </View>
              ) : null}
              {order.discount_amount > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, styles.discount]}>Discount:</Text>
                  <Text style={styles.discount}>-{money(order.discount_amount)}</Text>
                </View>
              ) : null}
              <View style={styles.grandRow}>
                <Text style={styles.grandText}>Total:</Text>
                <Text style={styles.grandText}>{money(order.total_amount)}</Text>
              </View>
            </View>

            {/* Payment info */}
            {(order.payment_method || order.payment_status || order.shipping_method) ? (
              <View style={styles.payment}>
                <Text style={styles.paymentTitle}>Payment Information</Text>
                {order.payment_method ? <Text style={styles.paymentLine}>Payment Method: {order.payment_method}</Text> : null}
                {order.payment_status ? <Text style={styles.paymentLine}>Payment Status: {order.payment_status}</Text> : null}
                {order.shipping_method ? <Text style={styles.paymentLine}>Shipping Method: {order.shipping_method}</Text> : null}
              </View>
            ) : null}

            <Text style={styles.footer} fixed>
              {footerNote || 'This is a computer-generated invoice.'}
            </Text>
          </Page>
        ))
      )}
    </Document>
  );
};

function Address({ title, addr }) {
  return (
    <View style={styles.addressCol}>
      <Text style={styles.addressTitle}>{title}</Text>
      <View style={styles.addressLine}>
        {addr.name ? <Text style={styles.addressName}>{addr.name}</Text> : null}
        {addr.address1 ? <Text>{addr.address1}</Text> : null}
        {addr.address2 ? <Text>{addr.address2}</Text> : null}
        {addr.cityLine ? <Text>{addr.cityLine}</Text> : null}
        {addr.phone ? <Text>Phone: {addr.phone}</Text> : null}
      </View>
    </View>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export default InvoiceDocument;
