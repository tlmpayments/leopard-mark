CREATE TABLE "employee_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"must_change" boolean DEFAULT true NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"set_by_employee_id" uuid,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"ended_by_employee_id" uuid
);
--> statement-breakpoint
ALTER TABLE "employee_credential" ADD CONSTRAINT "employee_credential_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_credential_current_uq" ON "employee_credential" USING btree ("employee_id") WHERE current = true;--> statement-breakpoint
CREATE INDEX "employee_credential_employee_idx" ON "employee_credential" USING btree ("employee_id");