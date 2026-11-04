CREATE TYPE "public"."production_arrangement" AS ENUM('alternating_proprietorship', 'contract');--> statement-breakpoint
ALTER TYPE "public"."pay_by" ADD VALUE 'eft';--> statement-breakpoint
ALTER TABLE "company_settings" ALTER COLUMN "dba" SET DEFAULT 'The Leopard Mark Beverage Group';--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "production_arrangement" "production_arrangement";--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "orders_email" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "operations_email" text;--> statement-breakpoint
-- Owner, Nov 4 2026: East Brother, Beachwood, Prost, Round Table and Jack's Abby are alternating proprietorships
-- (Massachusetts approved); AleSmith (San Diego) and Real Ale (Texas) are contract brewed.
UPDATE "warehouse" SET "production_arrangement" = 'alternating_proprietorship'::production_arrangement
WHERE "kind" = 'brewery' AND "origin_code" IN ('EBB', 'BWD', 'PRO', 'RTB', 'JAB') AND "production_arrangement" IS NULL;--> statement-breakpoint
UPDATE "warehouse" SET "production_arrangement" = 'contract'::production_arrangement
WHERE "kind" = 'brewery' AND "origin_code" IN ('ALE', 'REA') AND "production_arrangement" IS NULL;--> statement-breakpoint
-- Prost (Northglenn, Colorado; lot facility 03) was in the confirmed code list but never created. No Colorado sales, so no market.
INSERT INTO "warehouse" ("name", "kind", "origin_code", "lot_facility_code", "address_line1", "address_line2", "address_city", "address_state", "address_postal_code", "address_text", "production_arrangement")
SELECT 'Prost Brewing'::text, 'brewery'::origin_kind, 'PRO'::text, '03'::text, '351 W 104th Ave'::text, 'Unit A'::text, 'Northglenn'::text, 'CO'::text, '80234'::text, '351 W 104th Ave, Unit A, Northglenn, CO 80234'::text, 'alternating_proprietorship'::production_arrangement
WHERE EXISTS (SELECT 1 FROM "market") AND NOT EXISTS (SELECT 1 FROM "warehouse" WHERE "origin_code" = 'PRO' OR lower("name") LIKE 'prost%');--> statement-breakpoint
UPDATE "warehouse" SET "address_line1" = '351 W 104th Ave', "address_line2" = 'Unit A', "address_city" = 'Northglenn', "address_state" = 'CO', "address_postal_code" = '80234', "address_text" = '351 W 104th Ave, Unit A, Northglenn, CO 80234'
WHERE "origin_code" = 'PRO' AND "address_line1" IS NULL;--> statement-breakpoint
-- Round Table: limited New York production, no New York sales; it can supply MA or CT but is never a market default.
UPDATE "warehouse" SET "market_id" = NULL, "is_primary" = false WHERE "origin_code" = 'RTB';--> statement-breakpoint
-- Connecticut distributors are served from Radford by default (Jack's Abby direct when chosen on the shipment).
UPDATE "customer_location" SET "warehouse_override_id" = (SELECT "id" FROM "warehouse" WHERE "origin_code" = 'RAD'), "updated_at" = now()
WHERE "kind" = 'distributor'
  AND "market_id" = (SELECT "id" FROM "market" WHERE "code" = 'CT')
  AND "warehouse_override_id" IS NULL
  AND EXISTS (SELECT 1 FROM "warehouse" WHERE "origin_code" = 'RAD' AND "active");--> statement-breakpoint
-- Company settings (owner, Nov 4 2026): The Leopard Mark Beverage Group; invoices print ar@ for billing and orders@ for
-- reorders; every BOL and shipment document prints operations@. The internal note leaves the distributor footer, and
-- the freight class codes (never used on our BOLs) stop printing.
UPDATE "company_settings" SET
  "dba" = 'The Leopard Mark Beverage Group',
  "orders_email" = coalesce("orders_email", 'orders@theleopardmark.com'),
  "operations_email" = coalesce("operations_email", 'operations@theleopardmark.com'),
  "distributor_footer" = replace("distributor_footer", ' Wording to be confirmed against the current distributor document (question 6.4).', ''),
  "nmfc_keg" = CASE WHEN "nmfc_keg" LIKE '88900%proposed%' THEN NULL ELSE "nmfc_keg" END,
  "nmfc_can" = CASE WHEN "nmfc_can" LIKE '88900%proposed%' THEN NULL ELSE "nmfc_can" END,
  "updated_at" = now();--> statement-breakpoint
-- 24-oz cans keep the 12-oz shelf life (180 days).
UPDATE "sku" SET "shelf_life_days" = 180 WHERE "package_kind" = 'case_24oz_can' AND "shelf_life_days" IS NULL;--> statement-breakpoint
-- How each account pays, from the master workbook's payment column (Fintech, Stripe ACH). Accounts served by a
-- distributor (the Matagrano territory) buy through it and are not billed by us, so they get no pay-by.
UPDATE "customer_location" AS l SET "pay_by" = 'fintech', "updated_at" = now()
FROM "payment_relationship" AS p WHERE p."location_id" = l."id" AND p."channel" = 'fintech' AND l."pay_by" IS NULL AND l."served_by_location_id" IS NULL;--> statement-breakpoint
UPDATE "customer_location" AS l SET "pay_by" = 'stripe', "updated_at" = now()
FROM "payment_relationship" AS p WHERE p."location_id" = l."id" AND p."channel" = 'stripe_ach' AND l."pay_by" IS NULL AND l."served_by_location_id" IS NULL;--> statement-breakpoint
-- Matagrano is the one account that pays by check; HDI, Mancini, Martignetti and The Black Cat (MarginEdge) send EFT.
UPDATE "customer_location" SET "pay_by" = 'check', "updated_at" = now() WHERE "id" = '105dbdab-b759-b7ab-f684-955a64a8e22c' AND "pay_by" IS NULL;--> statement-breakpoint
UPDATE "customer_location" SET "pay_by" = 'eft', "updated_at" = now()
WHERE "id" IN ('354c2740-6f20-124a-da25-6105ed22e7e3', 'c31548a2-69c8-2da2-13ad-e68cb2b57b22', 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', '061bd94b-86ea-9627-b397-e9bf3952c927') AND "pay_by" IS NULL;--> statement-breakpoint
-- The Black Cat holds one floating $35 keg deposit (received with the INV26329 payment); no per-keg deposit.
UPDATE "customer_location" SET "deposit_mode" = 'floating', "deposit_taken_cents" = 3500, "updated_at" = now()
WHERE "id" = '061bd94b-86ea-9627-b397-e9bf3952c927' AND "deposit_mode" = 'market_default';
