CREATE TYPE "public"."origin_kind" AS ENUM('brewery', 'warehouse', 'cold_storage');--> statement-breakpoint
CREATE TYPE "public"."account_kind" AS ENUM('retail', 'distributor', 'warehouse', 'host', 'internal', 'individual');--> statement-breakpoint
CREATE TYPE "public"."deposit_mode" AS ENUM('market_default', 'per_keg', 'floating', 'none');--> statement-breakpoint
CREATE TYPE "public"."fulfilment" AS ENUM('delivery', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('scheduled', 'in_progress', 'complete', 'destroyed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('bol', 'picking_ticket', 'pickup_pack', 'pull_sheet', 'invoice');--> statement-breakpoint
CREATE TYPE "public"."invoice_series" AS ENUM('INV', 'NC');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."lot_source" AS ENUM('production_tab', 'bol_log_backfill', 'packaging_report');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('draft', 'confirmed', 'staged', 'out', 'delivered', 'voided');--> statement-breakpoint
CREATE TYPE "public"."shipment_template" AS ENUM('distributor', 'retail', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."shipment_type" AS ENUM('D', 'T', 'S');--> statement-breakpoint
ALTER TYPE "public"."stock_movement_kind" ADD VALUE 'shipment_out';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_kind" ADD VALUE 'count';--> statement-breakpoint
CREATE TABLE "pos_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_item_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "price_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"approved_by_employee_id" uuid,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_alias" (
	"alias" text PRIMARY KEY NOT NULL,
	"sku_id" uuid NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "bol_counter" (
	"origin_warehouse_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bol_counter_origin_warehouse_id_scheduled_date_pk" PRIMARY KEY("origin_warehouse_id","scheduled_date")
);
--> statement-breakpoint
CREATE TABLE "brew_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_warehouse_id" uuid NOT NULL,
	"brand_code" text NOT NULL,
	"batch_number" text NOT NULL,
	"brew_date" date,
	"vessel_size" text,
	"status" "batch_status" DEFAULT 'scheduled' NOT NULL,
	"status_reason" text,
	"status_changed_on" date,
	"brewery_batch_number" text,
	"notes" text,
	"source" text DEFAULT 'entered' NOT NULL,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brew_batch_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text DEFAULT 'Familiar Ventures, LLC' NOT NULL,
	"dba" text DEFAULT 'The Leopard Mark Brewing Company' NOT NULL,
	"office_line1" text,
	"office_line2" text,
	"office_city" text,
	"office_state" text,
	"office_postal_code" text,
	"office_phone" text,
	"ar_email" text DEFAULT 'ar@theleopardmark.com' NOT NULL,
	"retail_footer" text,
	"distributor_footer" text,
	"fixed_lines" text[],
	"nmfc_keg" text,
	"nmfc_can" text,
	"nmfc_status" text DEFAULT 'proposed' NOT NULL,
	"marking_convention" text,
	"print_remit_to" boolean DEFAULT false NOT NULL,
	"remit_to" text,
	"updated_by_employee_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "count_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"lot_code" text,
	"qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "count_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"counted_on" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"counted_by" text,
	"entered_by_employee_id" uuid,
	"applied_at" timestamp with time zone,
	"applied_by_employee_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_counter" (
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_counter_series_year_pk" PRIMARY KEY("series","year")
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'dry_run' NOT NULL,
	"summary" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"requested_by_employee_id" uuid,
	"applied_by_employee_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"series" "invoice_series" DEFAULT 'INV' NOT NULL,
	"location_id" uuid,
	"market_id" uuid,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"legacy_status" text,
	"legacy_payload" jsonb,
	"invoice_date" date,
	"due_date" date,
	"terms_days" integer,
	"fob_wording" text,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"issued_by_employee_id" uuid,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_by_employee_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"shipment_line_id" uuid,
	"sku_id" uuid,
	"description" text NOT NULL,
	"lot_code" text,
	"qty" integer DEFAULT 0 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"line_total_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_shipment" (
	"invoice_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	CONSTRAINT "invoice_shipment_invoice_id_shipment_id_pk" PRIMARY KEY("invoice_id","shipment_id")
);
--> statement-breakpoint
CREATE TABLE "keg_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"shipment_id" uuid,
	"on" date NOT NULL,
	"kind" text NOT NULL,
	"half_out" integer DEFAULT 0 NOT NULL,
	"sixtel_out" integer DEFAULT 0 NOT NULL,
	"half_in" integer DEFAULT 0 NOT NULL,
	"sixtel_in" integer DEFAULT 0 NOT NULL,
	"note" text,
	"recorded_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_code" text NOT NULL,
	"facility_warehouse_id" uuid NOT NULL,
	"brand_code" text NOT NULL,
	"packaging_date" date NOT NULL,
	"run_code" text NOT NULL,
	"batch_id" uuid,
	"quantities_known" boolean DEFAULT true NOT NULL,
	"source" "lot_source" DEFAULT 'packaging_report' NOT NULL,
	"legacy_code" text,
	"notes" text,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lot_lot_code_unique" UNIQUE("lot_code")
);
--> statement-breakpoint
CREATE TABLE "lot_sku_qty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty_packaged" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"type" "shipment_type" NOT NULL,
	"origin_warehouse_id" uuid NOT NULL,
	"destination_location_id" uuid,
	"destination_warehouse_id" uuid,
	"destination_text" text,
	"pickup" boolean DEFAULT false NOT NULL,
	"template" "shipment_template" DEFAULT 'retail' NOT NULL,
	"scheduled_date" date NOT NULL,
	"actual_date" date,
	"status" "shipment_status" DEFAULT 'draft' NOT NULL,
	"po_numbers" text[],
	"appointment" text,
	"carrier" text,
	"carrier_phone" text,
	"seal_number" text,
	"trailer_number" text,
	"pallet_count" integer,
	"pallet_build" text,
	"freight_class" text,
	"delivery_window" text,
	"receiving_instructions" text,
	"notes" text,
	"override_reason" text,
	"driver_employee_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"legacy_payload" jsonb,
	"merged_into_shipment_id" uuid,
	"market_id" uuid,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by_employee_id" uuid,
	"confirmed_at" timestamp with time zone,
	"delivered_by_employee_id" uuid,
	"delivered_at" timestamp with time zone,
	"voided_by_employee_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "shipment_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "shipment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid,
	"invoice_id" uuid,
	"kind" "document_kind" NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"number" text,
	"snapshot" jsonb NOT NULL,
	"pdf" "bytea",
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_keg_pickup" (
	"shipment_id" uuid PRIMARY KEY NOT NULL,
	"half_in" integer DEFAULT 0 NOT NULL,
	"sixtel_in" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid,
	"pos_item_id" uuid,
	"lot_id" uuid,
	"lot_code" text,
	"qty" integer NOT NULL,
	"unit_price_cents" integer,
	"weight_lb" numeric(10, 2),
	"lot_reason" text
);
--> statement-breakpoint
CREATE TABLE "shipment_order" (
	"shipment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	CONSTRAINT "shipment_order_shipment_id_order_id_pk" PRIMARY KEY("shipment_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "shipment_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"received_by_employee_id" uuid,
	"discrepancy_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_receipt_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty_expected" integer NOT NULL,
	"qty_received" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warehouse" ALTER COLUMN "market_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "terms_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "retail_keg_deposit_cents" integer DEFAULT 3500 NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "distributor_keg_deposit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "cod" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "market" ADD COLUMN "region_list" text[];--> statement-breakpoint
ALTER TABLE "sku" ADD COLUMN "upc_case" text;--> statement-breakpoint
ALTER TABLE "sku" ADD COLUMN "upc_retail" text;--> statement-breakpoint
ALTER TABLE "sku" ADD COLUMN "upc_unit" text;--> statement-breakpoint
ALTER TABLE "sku" ADD COLUMN "pallet_fraction" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "sku" ADD COLUMN "recipe_variant" text;--> statement-breakpoint
ALTER TABLE "sku" ADD COLUMN "shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD COLUMN "lot_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD COLUMN "shipment_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "origin_code" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "lot_facility_code" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "kind" "origin_kind" DEFAULT 'warehouse' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "appointment_required" boolean;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "loading_dock" boolean;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "liftgate_required" boolean;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "hours" jsonb;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "shipping_contact_name" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "shipping_contact_email" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "shipping_contact_phone" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "address_city" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "address_state" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "address_postal_code" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "kind" "account_kind" DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "served_by_location_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "legacy_account_id" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "terms_days_override" integer;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "deposit_mode" "deposit_mode" DEFAULT 'market_default' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "deposit_cents_override" integer;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "fulfilment" "fulfilment" DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "appointment_required" boolean;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "pallet_rule" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "receiving_requirements" text;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "first_delivery_on" text;--> statement-breakpoint
ALTER TABLE "price_override" ADD CONSTRAINT "price_override_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_alias" ADD CONSTRAINT "sku_alias_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bol_counter" ADD CONSTRAINT "bol_counter_origin_warehouse_id_warehouse_id_fk" FOREIGN KEY ("origin_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brew_batch" ADD CONSTRAINT "brew_batch_facility_warehouse_id_warehouse_id_fk" FOREIGN KEY ("facility_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_line" ADD CONSTRAINT "count_line_session_id_count_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."count_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_line" ADD CONSTRAINT "count_line_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_session" ADD CONSTRAINT "count_session_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_shipment" ADD CONSTRAINT "invoice_shipment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_shipment" ADD CONSTRAINT "invoice_shipment_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keg_event" ADD CONSTRAINT "keg_event_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keg_event" ADD CONSTRAINT "keg_event_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot" ADD CONSTRAINT "lot_facility_warehouse_id_warehouse_id_fk" FOREIGN KEY ("facility_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot" ADD CONSTRAINT "lot_batch_id_brew_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."brew_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_sku_qty" ADD CONSTRAINT "lot_sku_qty_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_sku_qty" ADD CONSTRAINT "lot_sku_qty_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_origin_warehouse_id_warehouse_id_fk" FOREIGN KEY ("origin_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_destination_location_id_customer_location_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_destination_warehouse_id_warehouse_id_fk" FOREIGN KEY ("destination_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_allocation" ADD CONSTRAINT "shipment_allocation_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_allocation" ADD CONSTRAINT "shipment_allocation_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_allocation" ADD CONSTRAINT "shipment_allocation_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_document" ADD CONSTRAINT "shipment_document_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_keg_pickup" ADD CONSTRAINT "shipment_keg_pickup_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD CONSTRAINT "shipment_line_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD CONSTRAINT "shipment_line_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD CONSTRAINT "shipment_line_pos_item_id_pos_item_id_fk" FOREIGN KEY ("pos_item_id") REFERENCES "public"."pos_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_line" ADD CONSTRAINT "shipment_line_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_order" ADD CONSTRAINT "shipment_order_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_order" ADD CONSTRAINT "shipment_order_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_receipt" ADD CONSTRAINT "shipment_receipt_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_receipt_line" ADD CONSTRAINT "shipment_receipt_line_receipt_id_shipment_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."shipment_receipt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_receipt_line" ADD CONSTRAINT "shipment_receipt_line_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_override_lookup_idx" ON "price_override" USING btree ("location_id","sku_id","effective_from");--> statement-breakpoint
CREATE INDEX "brew_batch_facility_idx" ON "brew_batch" USING btree ("facility_warehouse_id","brew_date");--> statement-breakpoint
CREATE INDEX "count_line_session_idx" ON "count_line" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "invoice_location_idx" ON "invoice" USING btree ("location_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoice_status_idx" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "keg_event_location_idx" ON "keg_event" USING btree ("location_id","on");--> statement-breakpoint
CREATE INDEX "lot_facility_idx" ON "lot" USING btree ("facility_warehouse_id","packaging_date");--> statement-breakpoint
CREATE UNIQUE INDEX "lot_sku_qty_uq" ON "lot_sku_qty" USING btree ("lot_id","sku_id");--> statement-breakpoint
CREATE INDEX "shipment_origin_date_idx" ON "shipment" USING btree ("origin_warehouse_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "shipment_destination_idx" ON "shipment" USING btree ("destination_location_id");--> statement-breakpoint
CREATE INDEX "shipment_status_idx" ON "shipment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipment_market_idx" ON "shipment" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "shipment_allocation_lookup_idx" ON "shipment_allocation" USING btree ("warehouse_id","sku_id","released_at");--> statement-breakpoint
CREATE INDEX "shipment_document_idx" ON "shipment_document" USING btree ("shipment_id","kind","revision");--> statement-breakpoint
CREATE INDEX "shipment_line_shipment_idx" ON "shipment_line" USING btree ("shipment_id");--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_origin_code_unique" UNIQUE("origin_code");