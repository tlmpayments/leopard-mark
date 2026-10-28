DROP INDEX "job_dedupe_uq";--> statement-breakpoint
ALTER TABLE "decision_selection" ADD COLUMN "market_ids" jsonb;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "displaced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_identity_current_email_uq" ON "employee_identity" USING btree ("email") WHERE current = true;--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedupe_active_uq" ON "job" USING btree ("dedupe_key") WHERE dedupe_key is not null and status in ('queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX "provider_reference_pending_uq" ON "provider_reference" USING btree ("provider","subject_type","subject_id","provider_object") WHERE provider_id is null;