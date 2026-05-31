-- normalize-courier-codes.sql
--
-- One-time cleanup of historical drift in courierCode values across the DB.
-- After this runs, every Fulfillment.courierCode and ShopCourier.courierCode
-- contains the canonical internal id from utils/courierCompanies.js (e.g.
-- 'leopards', 'tcs') instead of API codes ('LCS', 'TCS') or slugged display
-- names ('leopards_courier').
--
-- Idempotent — safe to re-run. Wrapped in a transaction so a partial
-- failure rolls back cleanly.
--
-- Run from any machine with prod DATABASE_URL access:
--   psql "$DATABASE_URL" -f backend-bookmyorder/scripts/normalize-courier-codes.sql
--
-- Adding a courier? Extend the CASE statements below to include any
-- alternate strings that might be sitting in the column.

BEGIN;

-- Fulfillment.courierCode
UPDATE "Fulfillment"
SET "courierCode" = CASE
  WHEN LOWER("courierCode") IN ('lcs', 'leopards_courier', 'leopards courier', 'leopards courier services', 'leopards') THEN 'leopards'
  WHEN LOWER("courierCode") IN ('tcs', 'tcs_express', 'tcs express', 'tcs (overnight) pesh', 'tcs (overland) pesh') THEN 'tcs'
  WHEN LOWER("courierCode") IN ('mnp', 'mnp_courier', 'mnp courier', 'm&p', 'm&p courier', 'm-p-logistic') THEN 'mnp'
  WHEN LOWER("courierCode") IN ('pst', 'postex', 'post ex', 'warsak - postex') THEN 'postex'
  WHEN LOWER("courierCode") IN ('spd', 'speedaf', 'speedaf express', 'speedaf courier services') THEN 'speedaf'
  WHEN LOWER("courierCode") IN ('trx', 'trax', 'trax express', 'trax courier') THEN 'trax'
  ELSE "courierCode"  -- leave anything we don't recognize untouched
END
WHERE "courierCode" IS NOT NULL;

-- ShopCourier.courierCode
UPDATE "ShopCourier"
SET "courierCode" = CASE
  WHEN LOWER("courierCode") IN ('lcs', 'leopards_courier', 'leopards courier', 'leopards courier services', 'leopards') THEN 'leopards'
  WHEN LOWER("courierCode") IN ('tcs', 'tcs_express', 'tcs express', 'tcs (overnight) pesh', 'tcs (overland) pesh') THEN 'tcs'
  WHEN LOWER("courierCode") IN ('mnp', 'mnp_courier', 'mnp courier', 'm&p', 'm&p courier', 'm-p-logistic') THEN 'mnp'
  WHEN LOWER("courierCode") IN ('pst', 'postex', 'post ex', 'warsak - postex') THEN 'postex'
  WHEN LOWER("courierCode") IN ('spd', 'speedaf', 'speedaf express', 'speedaf courier services') THEN 'speedaf'
  WHEN LOWER("courierCode") IN ('trx', 'trax', 'trax express', 'trax courier') THEN 'trax'
  ELSE "courierCode"
END
WHERE "courierCode" IS NOT NULL;

-- Sanity check — surface anything that didn't match a known courier.
-- If this returns rows, investigate before assuming the migration is clean.
SELECT DISTINCT "courierCode" AS unmapped_courier_code, 'Fulfillment' AS source
FROM "Fulfillment"
WHERE "courierCode" NOT IN ('leopards', 'tcs', 'mnp', 'postex', 'speedaf', 'trax', 'manual')
  AND "courierCode" IS NOT NULL
UNION ALL
SELECT DISTINCT "courierCode", 'ShopCourier'
FROM "ShopCourier"
WHERE "courierCode" NOT IN ('leopards', 'tcs', 'mnp', 'postex', 'speedaf', 'trax')
  AND "courierCode" IS NOT NULL;

COMMIT;
