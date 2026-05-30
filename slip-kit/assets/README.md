# Slip logo assets

Drop courier logo image files here. They are embedded into generated shipping
slips as base64 data URLs by `courierLogos.js`.

| Courier            | File name        |
|--------------------|------------------|
| Leopards (LCS)     | `lcs.png`        |
| TCS                | `tcs.png`        |

- PNG (or JPG) work. Recommended: a transparent PNG, roughly 200×100 px.
- If a file is missing, the slip still renders — just without that logo.
- After adding/replacing a file, no rebuild is needed; new slip requests pick it
  up immediately (only successfully-loaded logos are cached).

The store logo is handled separately (fetched from Shopify and passed in per
request), not from this folder.
