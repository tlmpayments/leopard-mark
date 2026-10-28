-- Preflight: detect pre-existing data that would violate the invariants this
-- migration adds. Nothing is repaired silently; the migration stops with a
-- diagnostic and `npm run db:preflight` lists the offending rows so an
-- operator can decide the evidence-based repair (docs/OPERATOR_GUIDE.md).
DO $$
DECLARE
  problems text := '';
  n int;
BEGIN
  SELECT count(*) INTO n FROM (SELECT employee_id FROM employee_identity WHERE current = true GROUP BY employee_id HAVING count(*) > 1) x;
  IF n > 0 THEN problems := problems || n || ' employee(s) with more than one current identity; ';
  END IF;
  SELECT count(*) INTO n FROM (SELECT google_subject FROM employee_identity WHERE current = true AND google_subject IS NOT NULL GROUP BY google_subject HAVING count(*) > 1) x;
  IF n > 0 THEN problems := problems || n || ' Google subject(s) bound to more than one current identity; ';
  END IF;
  SELECT count(*) INTO n FROM (SELECT location_id FROM license_verification WHERE current = true GROUP BY location_id HAVING count(*) > 1) x;
  IF n > 0 THEN problems := problems || n || ' location(s) with more than one current license verification; ';
  END IF;
  SELECT count(*) INTO n FROM (SELECT location_id FROM payment_relationship WHERE current = true GROUP BY location_id HAVING count(*) > 1) x;
  IF n > 0 THEN problems := problems || n || ' location(s) with more than one current payment relationship; ';
  END IF;
  SELECT count(*) INTO n FROM (SELECT intake_request_id FROM customer_order WHERE intake_request_id IS NOT NULL GROUP BY intake_request_id HAVING count(*) > 1) x;
  IF n > 0 THEN problems := problems || n || ' email intake(s) converted into more than one order; ';
  END IF;
  SELECT count(*) INTO n FROM stock_position WHERE on_hand_qty < 0 OR unavailable_qty < 0 OR pending_inspection_qty < 0 OR in_transit_qty < 0;
  IF n > 0 THEN problems := problems || n || ' stock position(s) with a negative quantity; ';
  END IF;
  SELECT count(*) INTO n FROM order_line WHERE NOT (ordered_qty > 0 AND current_qty >= 0 AND cancelled_qty >= 0 AND delivered_qty >= 0 AND delivered_qty <= current_qty);
  IF n > 0 THEN problems := problems || n || ' order line(s) with inconsistent quantities; ';
  END IF;
  SELECT count(*) INTO n FROM reservation WHERE reserved_qty < 0 OR unmet_qty < 0;
  IF n > 0 THEN problems := problems || n || ' reservation(s) with a negative quantity; ';
  END IF;
  SELECT count(*) INTO n FROM sample_withdrawal WHERE qty < 0;
  IF n > 0 THEN problems := problems || n || ' sample(s) with a negative quantity; ';
  END IF;
  IF problems <> '' THEN
    RAISE EXCEPTION 'fv-ops migration 0002_hardening preflight: % Run `npm run db:preflight` for the rows and repair deliberately before migrating.', problems;
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "employee_identity_subject_uq";--> statement-breakpoint
DROP INDEX "job_dedupe_active_uq";--> statement-breakpoint
DROP INDEX "provider_reference_provider_id_uq";--> statement-breakpoint
DROP INDEX "provider_reference_pending_uq";--> statement-breakpoint
ALTER TABLE "job" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "job" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "job" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_status_chk" CHECK (status in ('queued','running','done','failed','waiting'));--> statement-breakpoint
ALTER TABLE "decision_selection" ADD COLUMN "withdrawn_by_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "decision_selection" ADD COLUMN "withdrawn_reason" text;--> statement-breakpoint
ALTER TABLE "employee_identity" ADD COLUMN "ended_reason" text;--> statement-breakpoint
ALTER TABLE "employee_identity" ADD COLUMN "ended_by_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "waiting_reason" text;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "outcome_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "outcome_recorded_by_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "sent_via" text;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "outcome_note" text;--> statement-breakpoint
ALTER TABLE "notice" ADD COLUMN "supersedes_notice_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "credential_fingerprint" text;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_reference" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
-- Established references recorded before account binding existed cannot be attributed to a verified account:
-- they are kept as history and marked stale so that lookups fail closed until re-verified (REV-13).
UPDATE "provider_reference" SET "status" = 'stale', "evidence" = coalesce("evidence", '{}'::jsonb) || '{"migration_0002": "established before provider account binding; re-verify against the connected account"}'::jsonb WHERE "provider_id" IS NOT NULL AND "provider_account_id" IS NULL;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "payer_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD COLUMN "payer_assigned_by_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "submission_payload_hash" text;--> statement-breakpoint
ALTER TABLE "standing_occurrence" ADD COLUMN "detail" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_identity_current_employee_uq" ON "employee_identity" USING btree ("employee_id") WHERE current = true;--> statement-breakpoint
CREATE INDEX "notice_state_idx" ON "notice" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "notice_pending_dedupe_uq" ON "notice" USING btree ("dedupe_key") WHERE dedupe_key is not null and state in ('intended','manual_pending');--> statement-breakpoint
CREATE UNIQUE INDEX "license_verification_current_uq" ON "license_verification" USING btree ("location_id") WHERE current = true;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_relationship_current_uq" ON "payment_relationship" USING btree ("location_id") WHERE current = true;--> statement-breakpoint
CREATE UNIQUE INDEX "order_intake_request_uq" ON "customer_order" USING btree ("intake_request_id") WHERE intake_request_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_identity_subject_uq" ON "employee_identity" USING btree ("google_subject") WHERE google_subject is not null and current = true;--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedupe_active_uq" ON "job" USING btree ("dedupe_key") WHERE dedupe_key is not null and status in ('queued','running','waiting');--> statement-breakpoint
CREATE UNIQUE INDEX "provider_reference_provider_id_uq" ON "provider_reference" USING btree ("provider","environment","provider_account_id","provider_object","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_reference_pending_uq" ON "provider_reference" USING btree ("provider","environment","subject_type","subject_id","provider_object") WHERE provider_id is null;--> statement-breakpoint
ALTER TABLE "stock_position" ADD CONSTRAINT "stock_position_qty_chk" CHECK (on_hand_qty >= 0 and unavailable_qty >= 0 and pending_inspection_qty >= 0 and in_transit_qty >= 0);--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_qty_chk" CHECK (ordered_qty > 0 and current_qty >= 0 and cancelled_qty >= 0 and delivered_qty >= 0 and delivered_qty <= current_qty);--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_qty_chk" CHECK (reserved_qty >= 0 and unmet_qty >= 0);--> statement-breakpoint
ALTER TABLE "sample_withdrawal" ADD CONSTRAINT "sample_qty_chk" CHECK (qty >= 0);--> statement-breakpoint
DROP TYPE "public"."job_status";