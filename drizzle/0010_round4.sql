ALTER TYPE "public"."invoice_status" ADD VALUE 'processing' BEFORE 'paid';--> statement-breakpoint
CREATE TABLE "approval_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"sender" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"payload" jsonb NOT NULL,
	"amount_cents" integer,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"market_id" uuid,
	"location_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"transport" text,
	"dedupe_key" text,
	"requested_by_employee_id" uuid,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"last_error" text,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"data" "bytea",
	"text_extract" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_connection" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"scopes" text[] NOT NULL,
	"refresh_token_enc" text,
	"connected_by_employee_id" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_error" text,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_sync" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"history_id" text,
	"last_polled_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_error" text,
	"messages_seen" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid,
	"location_id" uuid,
	"market_id" uuid,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"state" text NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"stripe_refund_id" text,
	"failure_code" text,
	"failure_message" text,
	"reference" text,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"recorded_by_employee_id" uuid,
	"approval_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_balance_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bt_id" text NOT NULL,
	"environment" text DEFAULT 'live' NOT NULL,
	"payout_id" text,
	"type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer NOT NULL,
	"source_id" text,
	"charge_id" text,
	"stripe_invoice_id" text,
	"invoice_id" uuid,
	"description" text,
	"stripe_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_customer_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"environment" text DEFAULT 'live' NOT NULL,
	"name" text,
	"email" text,
	"stripe_created_at" timestamp with time zone,
	"bank_name" text,
	"bank_last4" text,
	"has_default_bank" boolean DEFAULT false NOT NULL,
	"suggested_location_id" uuid,
	"suggested_by" text,
	"state" text DEFAULT 'suggested' NOT NULL,
	"confirmed_location_id" uuid,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_invoice_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"environment" text DEFAULT 'live' NOT NULL,
	"stripe_number" text,
	"stripe_customer_id" text,
	"customer_name" text,
	"status" text NOT NULL,
	"total_cents" integer NOT NULL,
	"amount_remaining_cents" integer NOT NULL,
	"due_date" date,
	"stripe_created_at" timestamp with time zone,
	"hosted_invoice_url" text,
	"location_id" uuid,
	"suggested_invoice_id" uuid,
	"suggested_by" text,
	"state" text DEFAULT 'suggested' NOT NULL,
	"linked_invoice_id" uuid,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" text NOT NULL,
	"environment" text DEFAULT 'live' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text NOT NULL,
	"arrival_date" date,
	"stripe_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "card_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_location" ADD COLUMN "auto_debit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "bank_last4" text;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "payment_method_id" text;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "mandate_id" text;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "mandate_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "verification_state" text;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "method_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "default_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "setup_link_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_intake_request" ADD COLUMN "mailbox" text;--> statement-breakpoint
ALTER TABLE "order_intake_request" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "order_intake_request" ADD COLUMN "parsed" jsonb;--> statement-breakpoint
ALTER TABLE "order_intake_request" ADD COLUMN "parse_note" text;--> statement-breakpoint
ALTER TABLE "order_intake_request" ADD COLUMN "attachment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "stripe_mirror_invoices" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "auto_approve_stripe_invoices" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "auto_approve_credit_notes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "auto_approve_emails" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "send_email_automatically" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "intake_mailbox_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "intake_mailbox_address" text DEFAULT 'orders@theleopardmark.com' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "customer_sender_address" text DEFAULT 'orders@theleopardmark.com' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "operations_sender_address" text DEFAULT 'operations@theleopardmark.com' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_memo" ADD COLUMN "stripe_credit_note_id" text;--> statement-breakpoint
ALTER TABLE "credit_memo" ADD COLUMN "stripe_credit_note_number" text;--> statement-breakpoint
ALTER TABLE "credit_memo" ADD COLUMN "stripe_applied" text;--> statement-breakpoint
ALTER TABLE "credit_memo" ADD COLUMN "mirrored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "stripe_invoice_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "stripe_number" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "stripe_status" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "hosted_invoice_url" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "stripe_pdf_url" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "mirrored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "mirror_error" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "collection_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "debit_scheduled_on" date;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "paid_via" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "paid_reference" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "failure_message" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_item" ADD CONSTRAINT "approval_item_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_item" ADD CONSTRAINT "approval_item_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_attachment" ADD CONSTRAINT "intake_attachment_intake_id_order_intake_request_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."order_intake_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_balance_transaction" ADD CONSTRAINT "stripe_balance_transaction_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_item_state_idx" ON "approval_item" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "approval_item_subject_idx" ON "approval_item" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_item_active_dedupe_uq" ON "approval_item" USING btree ("dedupe_key") WHERE dedupe_key is not null and state in ('pending','approved','executing');--> statement-breakpoint
CREATE INDEX "intake_attachment_intake_idx" ON "intake_attachment" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX "payment_invoice_idx" ON "payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_location_idx" ON "payment" USING btree ("location_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intent_uq" ON "payment" USING btree ("stripe_payment_intent_id") WHERE stripe_payment_intent_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_balance_transaction_uq" ON "stripe_balance_transaction" USING btree ("environment","bt_id");--> statement-breakpoint
CREATE INDEX "stripe_balance_transaction_payout_idx" ON "stripe_balance_transaction" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customer_match_uq" ON "stripe_customer_match" USING btree ("environment","stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_invoice_match_uq" ON "stripe_invoice_match" USING btree ("environment","stripe_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_payout_uq" ON "stripe_payout" USING btree ("environment","payout_id");--> statement-breakpoint
CREATE INDEX "invoice_stripe_idx" ON "invoice" USING btree ("stripe_invoice_id");--> statement-breakpoint
-- Round 4 data. Invoices paid before Stripe held a copy were paid outside Stripe.
UPDATE "invoice" SET "collection_state" = 'out_of_band' WHERE "status" = 'paid' AND "collection_state" = 'none';
--> statement-breakpoint
INSERT INTO "audit_event" ("actor_kind", "action", "subject_type", "subject_id", "current", "reason")
VALUES ('system', 'migration.0010_round4', 'company_settings', '00000000-0000-0000-0000-000000000001', '{"added":["approval_item","payment","stripe_customer_match","stripe_invoice_match","stripe_payout","stripe_balance_transaction","mailbox_sync","mailbox_connection","intake_attachment"],"invoice_status":"processing added"}'::jsonb, 'Round 4: approval queue, Stripe as the money ledger, orders@ intake, split shipments, reports');
