CREATE TYPE "public"."production_arrangement" AS ENUM('alternating_proprietorship', 'contract');--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "production_arrangement" "production_arrangement";--> statement-breakpoint
-- Owner, Nov 4 2026: East Brother, Beachwood, Prost, Round Table and Jack's Abby are alternating proprietorships
-- (Massachusetts approved); AleSmith (San Diego) and Real Ale (Texas) are contract brewed.
UPDATE "warehouse" SET "production_arrangement" = 'alternating_proprietorship'::production_arrangement
WHERE "kind" = 'brewery' AND "origin_code" IN ('EBB', 'BWD', 'PRO', 'RTB', 'JAB') AND "production_arrangement" IS NULL;--> statement-breakpoint
UPDATE "warehouse" SET "production_arrangement" = 'contract'::production_arrangement
WHERE "kind" = 'brewery' AND "origin_code" IN ('ALE', 'REA') AND "production_arrangement" IS NULL;--> statement-breakpoint
-- Prost (Northglenn, Colorado; lot facility 03) was in the confirmed code list but never created. No Colorado sales, so no market.
INSERT INTO "warehouse" ("name", "kind", "origin_code", "lot_facility_code", "address_city", "address_state", "address_text", "production_arrangement")
SELECT 'Prost Brewing'::text, 'brewery'::origin_kind, 'PRO'::text, '03'::text, 'Northglenn'::text, 'CO'::text, 'Northglenn, CO'::text, 'alternating_proprietorship'::production_arrangement
WHERE EXISTS (SELECT 1 FROM "market") AND NOT EXISTS (SELECT 1 FROM "warehouse" WHERE "origin_code" = 'PRO' OR lower("name") LIKE 'prost%');--> statement-breakpoint
-- Round Table: limited New York production, no New York sales; it can supply MA or CT but is never a market default.
UPDATE "warehouse" SET "market_id" = NULL, "is_primary" = false WHERE "origin_code" = 'RTB';--> statement-breakpoint
-- Connecticut distributors are served from Radford by default (Jack's Abby direct when chosen on the shipment).
UPDATE "customer_location" SET "warehouse_override_id" = (SELECT "id" FROM "warehouse" WHERE "origin_code" = 'RAD'), "updated_at" = now()
WHERE "kind" = 'distributor'
  AND "market_id" = (SELECT "id" FROM "market" WHERE "code" = 'CT')
  AND "warehouse_override_id" IS NULL
  AND EXISTS (SELECT 1 FROM "warehouse" WHERE "origin_code" = 'RAD' AND "active");
