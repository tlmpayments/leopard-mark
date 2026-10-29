CREATE TYPE "public"."shortfall_decision" AS ENUM('ship_available', 'hold');--> statement-breakpoint
CREATE TYPE "public"."pay_by" AS ENUM('fintech', 'stripe', 'check');--> statement-breakpoint
ALTER TYPE "public"."stock_movement_kind" ADD VALUE 'packaging';--> statement-breakpoint
ALTER TYPE "public"."order_demand_state" ADD VALUE 'held';--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'phone';--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'text';--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'slack';--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'rep';--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'po';--> statement-breakpoint
CREATE TABLE "credit_memo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"location_id" uuid,
	"market_id" uuid,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"memo_date" date NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_by_employee_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_by_employee_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "credit_memo_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "lot_packaging_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"packaged_on" date NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"note" text,
	"recorded_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipment" ALTER COLUMN "scheduled_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "route_days" text[];--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "pull_sheet_email" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "pull_sheet_send_time" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "pay_by" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "invoice_on_receipt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "deposit_taken_cents" integer;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "deposit_taken_on" date;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "deposit_settled_on" date;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "deposit_settlement_note" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "rep_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "samples_house" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "no_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "pickup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "po_numbers" text[];--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "shortfall_decision" "shortfall_decision";--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "shortfall_reason" text;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "shortfall_decided_by_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "shortfall_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brew_batch" ADD COLUMN "barrels" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "auto_send_pull_sheets" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "pay_by" "pay_by";--> statement-breakpoint
ALTER TABLE "shipment_line" ADD COLUMN "delivered_qty" integer;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD COLUMN "refused_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD COLUMN "damaged_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD COLUMN "damage_reason" text;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD COLUMN "order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_memo" ADD CONSTRAINT "credit_memo_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memo" ADD CONSTRAINT "credit_memo_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memo" ADD CONSTRAINT "credit_memo_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_packaging_entry" ADD CONSTRAINT "lot_packaging_entry_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_packaging_entry" ADD CONSTRAINT "lot_packaging_entry_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_memo_invoice_idx" ON "credit_memo" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "lot_packaging_entry_lot_idx" ON "lot_packaging_entry" USING btree ("lot_id","packaged_on");--> statement-breakpoint
-- R2-31: account status is Active or Closed. Rows that were "inactive" become closed with a note; the audit keeps the prior value.
INSERT INTO "audit_event" ("actor_kind", "action", "subject_type", "subject_id", "prior", "current", "reason", "market_id")
SELECT 'system', 'location.lifecycle', 'location', "id"::text, jsonb_build_object('status', 'inactive'), jsonb_build_object('status', 'closed'), 'Migration 0005 (R2-31): the inactive status was retired; closed with a note, nothing deleted', "market_id"
FROM "customer_location" WHERE "status" = 'inactive';--> statement-breakpoint
UPDATE "customer_location"
SET "status" = 'closed', "closed_at" = coalesce("closed_at", now()), "close_reason" = coalesce("close_reason", 'Was inactive; status retired in round 2 (R2-31)'), "updated_at" = now()
WHERE "status" = 'inactive';--> statement-breakpoint
-- R2-14: the credit memo series starts at CM26001.
INSERT INTO "doc_counter" ("series", "year", "last_seq") VALUES ('CM', 2026, 0) ON CONFLICT DO NOTHING;--> statement-breakpoint
-- R2-27: one samples house account per market (kind internal, no license, no terms, no deposit), named after the market.
INSERT INTO "customer_location" ("id", "market_id", "trade_name", "status", "kind", "deposit_mode", "terms_days_override", "samples_house", "created_at", "updated_at")
SELECT md5('location|samples|' || m."code")::uuid, m."id",
  CASE m."code"
    WHEN 'SOCAL' THEN 'Samples, SoCal'
    WHEN 'NORCAL-SD' THEN 'Samples, NorCal'
    WHEN 'NORCAL-D' THEN 'Samples, NorCal (Distributed)'
    WHEN 'CT' THEN 'Samples, Connecticut'
    WHEN 'MA' THEN 'Samples, Massachusetts'
    ELSE 'Samples, ' || m."name"
  END,
  'active', 'internal', 'none', 0, true, now(), now()
FROM "market" m
WHERE NOT EXISTS (SELECT 1 FROM "customer_location" l WHERE l."market_id" = m."id" AND l."samples_house" = true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- R2-21: existing lots get one packaging entry dated their packaging day so the day list starts from today's totals.
INSERT INTO "lot_packaging_entry" ("lot_id", "packaged_on", "sku_id", "qty", "note")
SELECT q."lot_id", l."packaging_date", q."sku_id", q."qty_packaged", 'Backfilled from the lot total (migration 0005)'
FROM "lot_sku_qty" q JOIN "lot" l ON l."id" = q."lot_id"
WHERE q."qty_packaged" > 0 AND NOT EXISTS (SELECT 1 FROM "lot_packaging_entry" e WHERE e."lot_id" = q."lot_id");
