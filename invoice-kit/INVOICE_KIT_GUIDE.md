# Invoice Kit — PDF customer invoices

A drop-in kit that turns order(s) into a printable / downloadable **A4 PDF
invoice** using `@react-pdf/renderer`. Orders are grouped by store (one invoice
section per store), one PDF page per order.

This is the clean, react-pdf-based counterpart to the legacy "print via
`document.body.innerHTML` swap" approach — no DOM hijacking, no
`window.location.reload()`, and it shares the same PDF dependency as the
[Slip Generation Kit](../slip-generation-kit/SLIP_KIT_GUIDE.md).

---

## 🤖 Instructions for Claude (read this first)

You are being handed this kit to integrate into a project with a **React**
frontend (Next.js / Vite / CRA). Do the following:

1. **Copy the `invoice-kit/frontend/` files** into the project (e.g. under
   `src/lib/invoice/` or `components/invoice/`). Fix relative imports if you
   move them.
2. **Install dependencies** (see **Dependencies**).
3. **Verify the order shape** the consumer hands in matches **Input shape**
   below. If the project's order objects differ, write a thin adapter — do
   **not** edit `mapInvoiceData.js` to chase project-specific fields; keep it
   generic. The mapper is already null-safe (missing billing address, partial
   line items, string amounts all handled).
4. **Wire it from the UI** — replace any existing "Generate Invoice" /
   "Print Invoice" handler with `downloadInvoice(orders, stores)` or, for
   in-tab preview, `previewInvoiceUrl(...)`. See **Usage**.
5. If the project already uses the Slip Kit, both share `@react-pdf/renderer`
   and `file-saver` — don't double-install.

Do **not** change the invoice view-model shape produced by `mapInvoiceData` —
`InvoiceDocument` depends on it.

---

## 📁 Files in this kit

```
invoice-kit/
├── INVOICE_KIT_GUIDE.md          ← this file
└── frontend/
    ├── mapInvoiceData.js         ← orders → null-safe invoice view model (grouped by store)
    ├── InvoiceDocument.jsx       ← A4 PDF document (one page per order)
    └── downloadInvoice.js        ← build blob → download | preview URL
```

---

## Dependencies

```bash
npm i @react-pdf/renderer file-saver
```

`@react-pdf/renderer` is ~2 MB minified. If invoices are generated from one
route, lazy-load:

```js
const { downloadInvoice } = await import('@/invoice-kit/frontend/downloadInvoice.js');
```

---

## Usage

```js
import { downloadInvoice, previewInvoiceUrl } from '@/invoice-kit/frontend/downloadInvoice';

// Download
await downloadInvoice(orders, stores, {
  currency: 'PKR',
  filename: 'invoices-2026-05-29.pdf',
  footerNote: 'Thank you for shopping with us!',
});

// Or preview in a new tab
const url = await previewInvoiceUrl(orders, stores);
window.open(url, '_blank');
// later: URL.revokeObjectURL(url);
```

`orders` is an array — pass one or many. Orders from different stores are
automatically split into separate invoice sections with the right store header
on each page.

If you need to embed a live preview, render the document directly:

```jsx
import { PDFViewer } from '@react-pdf/renderer';
import InvoiceDocument from '@/invoice-kit/frontend/InvoiceDocument';
import { mapInvoiceData } from '@/invoice-kit/frontend/mapInvoiceData';

const invoice = mapInvoiceData(orders, stores, { currency: 'PKR' });
<PDFViewer style={{ width: '100%', height: '90vh' }}>
  <InvoiceDocument invoice={invoice} />
</PDFViewer>
```

---

## Input shape

```jsonc
// orders[]
{
  "id": "order_cuid",
  "store_id": "store_cuid",
  "order_number": "1024",
  "confirmation_number": "CN-9981",     // optional
  "status": "confirmed",                // optional
  "order_date": "2026-05-29T08:00:00Z", // optional ISO

  "payment_method": "COD",              // optional
  "payment_status": "pending",          // optional
  "shipping_method": "Standard",        // optional

  // Either is optional / may be null — the mapper degrades gracefully.
  "billing_address":  { "name": "Jane Doe", "address1": "...", "city": "Karachi", "country": "Pakistan", "phone": "..." },
  "shipping_address": { "first_name": "Jane", "last_name": "Doe", "address1": "...", "address2": "...", "city": "Karachi", "country": "Pakistan", "phone": "..." },

  "order_items": [
    {
      "id": "li_1",
      "image_url": "https://...",
      "name": "Red T-Shirt",
      "sku": "TSHIRT-RED-M",
      "variant_title": "M",             // optional
      "quantity": 1,
      "unit_price": 1500,               // string | number | Decimal
      "total_price": 1500,
      "is_removed": false               // optional; quantity 0 also = removed
    }
  ],

  "subtotal": 1500,
  "tax_amount": 0,
  "shipping_amount": 0,
  "discount_amount": 0,
  "total_amount": 1500
}
```

```jsonc
// stores[]
{ "id": "store_cuid", "name": "Acme Store", "logo_url": "https://...", "address": "...", "phone": "...", "email": "..." }
```

Addresses accept either a combined `name` or `first_name`/`last_name`. Amounts
accept strings, numbers, or Prisma `Decimal` (anything `parseFloat` can read);
non-numeric values become `0` rather than `NaN`.

---

## Caveats / gotchas

- **Remote images need CORS.** `@react-pdf/renderer` fetches `logo_url` and
  product `image_url` at render time. If the host blocks cross-origin image
  fetches, the image is silently omitted (it won't crash the PDF). Proxy
  through your own domain if logos go missing.
- **Fonts.** Uses react-pdf's built-in Helvetica — no external font fetch, so
  it works in locked-down/offline environments. To brand it, register a font
  in `InvoiceDocument.jsx` (see the Slip Kit's TCS label for the pattern).
- **One page per order.** A 50-order invoice = 50-page PDF built in memory.
  Chunk client-side if you routinely exceed ~100 orders.
- **`status` is the order status, not an HTTP code.** If you see "Status: 500"
  on an invoice, your upstream fetch returned an error object instead of an
  order — filter those out before calling the kit (the mapper already drops
  entries without an `id`, but an error object with an `id` field would slip
  through).

---

## Underlying packages (reference)

| Package | Role |
|---|---|
| `@react-pdf/renderer` | PDF document / layout |
| `file-saver`          | Browser "save as" |
