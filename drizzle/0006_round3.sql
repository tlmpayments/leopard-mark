CREATE TABLE "freight_lane" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"min_cents" integer NOT NULL,
	"tier_2_4_cents" integer NOT NULL,
	"tier_5_8_cents" integer NOT NULL,
	"truckload_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_price" ADD COLUMN "tier" text DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_item" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "pos_item" ADD COLUMN "unit_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "sku" ADD COLUMN "unit_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "order_cutoff" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "lead_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "delivery_days" text[];--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "max_days_on_hand" integer;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "invoice_notes" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "freight_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "freight_lane_code" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "freight_per_unit" jsonb;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "freight_min_pallets" integer;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "deliver_without_signature" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "fuel_surcharge_pct" numeric(5, 2) DEFAULT '43' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "collections_threshold_cents" integer DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "freight_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "printed_notes" text;--> statement-breakpoint
-- Round 3 data (from the item forms, the sample invoices, the transportation rate chart and the owner's answers). Every statement is a no-op on a fresh database.
SELECT 1;--> statement-breakpoint
INSERT INTO "freight_lane" ("code", "name", "min_cents", "tier_2_4_cents", "tier_5_8_cents", "truckload_cents") VALUES
  ('CT', 'To CT distributors (from Radford or Jack''s Abby)', 8900, 7800, 7200, 67500),
  ('MA-EAST', 'To Eastern MA distributors (from Radford or Jack''s Abby)', 7500, 6900, 6500, 51500)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
UPDATE "company_settings" SET "office_line1" = '1300 First Street, Suite 368', "office_city" = 'Napa', "office_state" = 'CA', "office_postal_code" = '94559', "office_phone" = coalesce("office_phone", '(707) 261-0200') WHERE "office_line1" IS NULL;--> statement-breakpoint
UPDATE "market" SET "terms_days" = 15 WHERE "code" = 'CT';--> statement-breakpoint
UPDATE "sku" SET "pallet_fraction" = '0.0500' WHERE "package_kind" = 'keg_sixtel' AND "archived_at" IS NULL;--> statement-breakpoint
UPDATE "sku" SET "weight_lb" = CASE "package_kind" WHEN 'keg_half' THEN 160 WHEN 'keg_sixtel' THEN 58 WHEN 'case_12oz_can' THEN 20 END WHERE "weight_lb" IS NULL AND "archived_at" IS NULL AND "package_kind" IN ('keg_half', 'keg_sixtel', 'case_12oz_can');--> statement-breakpoint
UPDATE "sku" SET "upc_unit" = coalesce("upc_unit", v.unit), "upc_retail" = coalesce("upc_retail", v.retail), "upc_case" = coalesce("upc_case", v.cs)
FROM (VALUES
  ('CNTCKHB010', '850067945109', NULL, NULL),
  ('CNTCKSB010', '850067945147', NULL, NULL),
  ('CNTCC1212C', '850067945093', '850067945161', '10850067945168'),
  ('SLG0KHB010', '850067945086', NULL, NULL),
  ('SLG0KSB010', '850067945208', NULL, NULL),
  ('SLG0C1206P', NULL, NULL, '10850067945038'),
  ('CNTCC1206P', NULL, NULL, '10850067945212')
) AS v(code, unit, retail, cs)
WHERE "sku"."code" = v.code;--> statement-breakpoint
INSERT INTO "market_price" ("market_id", "sku_id", "tier", "price_cents", "effective_from")
SELECT m.id, s.id, 'distributor'::text, v.cents, '2026-10-01 00:00:00-07'::timestamptz
FROM (VALUES
  ('NORCAL-D', 'SLG0KHB010', 14100),
  ('NORCAL-D', 'SLG0KSB010', 6840),
  ('NORCAL-D', 'SLG0C1206P', 2522),
  ('NORCAL-D', 'CNTCC1206P', 2196),
  ('CT', 'CNTCC1212C', 1800),
  ('CT', 'CNTCKSB010', 3750),
  ('CT', 'CNTCKHB010', 10000),
  ('MA', 'CNTCC1212C', 2347),
  ('MA', 'CNTCKSB010', 4435),
  ('MA', 'CNTCKHB010', 10988)
) AS v(market_code, sku_code, cents)
JOIN "market" m ON m.code = v.market_code
JOIN "sku" s ON s.code = v.sku_code
WHERE NOT EXISTS (SELECT 1 FROM "market_price" p WHERE p.market_id = m.id AND p.sku_id = s.id AND p.tier = 'distributor' AND p.effective_to IS NULL);--> statement-breakpoint
UPDATE "customer_location" SET "trade_name" = 'Mancini Beverage', "updated_at" = now() WHERE "id" = 'c31548a2-69c8-2da2-13ad-e68cb2b57b22' AND "trade_name" = 'Dichello Distributors Inc.';--> statement-breakpoint
UPDATE "customer_location" SET "freight_mode" = 'lane', "freight_lane_code" = 'CT', "invoice_notes" = coalesce("invoice_notes", 'Pricing is FOB brewery or designated warehouse per the Connecticut price posting effective 10/01/2026 (Distribution Agreement § 2.1).
Federal excise tax paid by Supplier. Connecticut state excise tax, the Connecticut beverage container deposit, and any other Connecticut taxes or fees are the responsibility of Distributor (§ 2.1).
Freight is billed as a pass-through at carrier cost, including the carrier''s fuel surcharge.
Kegs: no keg deposit is charged. Responsibility for the kegs transfers to Distributor upon delivery. Kegs are MicroStar kegs and remain MicroStar property; Distributor is responsible for returning empties to the MicroStar network and for any kegs lost or not returned.
Terms: due by the 15th day after delivery (§ 2.2), payable by check or EFT. Remit-to and ACH details are on file with Distributor''s AP.') WHERE "id" IN ('354c2740-6f20-124a-da25-6105ed22e7e3', 'c31548a2-69c8-2da2-13ad-e68cb2b57b22') AND "kind" = 'distributor';--> statement-breakpoint
UPDATE "customer_location" SET "freight_mode" = 'per_unit', "freight_per_unit" = '{"keg_half": 1100, "keg_sixtel": 500, "case_12oz_can": 100}'::jsonb, "freight_min_pallets" = 5, "invoice_notes" = coalesce("invoice_notes", 'Pricing is FOB per Supplier''s MA price filing (FOB brewery or designated warehouse).
Federal and MA excise paid by Supplier.
Freight: fixed per-unit delivery charges as stated on the new item form, inclusive of variable fuel surcharge, 5-pallet minimum per shipment.
Kegs: all kegs are MicroStar cooperage. Keg deposits and credits are handled by MicroStar directly with Distributor and do not appear on Supplier''s invoices; empty kegs are returned through the MicroStar network.') WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND "kind" = 'distributor';--> statement-breakpoint
UPDATE "customer_location" SET "fulfilment" = 'pickup', "invoice_notes" = coalesce("invoice_notes", 'Pricing is FOB Richmond, CA, per the price schedule agreed with Matagrano and in effect at the time of the Order (Distribution Agreement § 5.2). CA state excise tax included; federal excise tax paid by supplier.
Kegs are MicroStar-owned. No keg deposit is charged on this invoice; MicroStar bills and refunds keg deposits directly under Distributor''s MicroStar agreement. Return empties to the MicroStar network.
Terms: Net 30 from receipt of Products, payable by check or EFT (Distribution Agreement § 5.3). Remit-to and ACH details are on file with Distributor''s AP.') WHERE "id" = '105dbdab-b759-b7ab-f684-955a64a8e22c' AND "kind" = 'distributor';--> statement-breakpoint
UPDATE "warehouse" SET "order_cutoff" = '14:30', "lead_days" = 1, "delivery_days" = ARRAY['Wed', 'Thu'] WHERE "origin_code" = 'WLA' AND "order_cutoff" IS NULL;--> statement-breakpoint
UPDATE "warehouse" SET "order_cutoff" = '15:30', "lead_days" = 1, "delivery_days" = ARRAY['Tue', 'Thu'] WHERE "origin_code" = 'EWD' AND "order_cutoff" IS NULL;--> statement-breakpoint
UPDATE "warehouse" SET "order_cutoff" = '12:00', "lead_days" = 1 WHERE "origin_code" = 'RAD' AND "order_cutoff" IS NULL;--> statement-breakpoint
UPDATE "warehouse" SET "max_days_on_hand" = 10 WHERE "origin_code" = 'JAB' AND "max_days_on_hand" IS NULL;--> statement-breakpoint
INSERT INTO "warehouse" ("name", "kind", "origin_code", "lot_facility_code", "address_city", "address_state", "address_text")
SELECT 'Real Ale Brewing'::text, 'brewery'::origin_kind, 'REA'::text, '07'::text, 'Blanco'::text, 'TX'::text, 'Blanco, TX'::text
WHERE EXISTS (SELECT 1 FROM "market") AND NOT EXISTS (SELECT 1 FROM "warehouse" WHERE "origin_code" IN ('REA', 'RAL') OR lower("name") LIKE 'real ale%');
