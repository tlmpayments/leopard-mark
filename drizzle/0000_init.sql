CREATE TYPE "public"."actor_kind" AS ENUM('employee', 'system', 'provider', 'dev_fixture');--> statement-breakpoint
CREATE TYPE "public"."decision_register" AS ENUM('D', 'SD', 'T', 'IG');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('unselected', 'selected');--> statement-breakpoint
CREATE TYPE "public"."exception_state" AS ENUM('open', 'acknowledged', 'assigned', 'waiting', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."gate_classification" AS ENUM('must_work_before_initial_field_use', 'can_use_temporary_control', 'optional_enhancement', 'scoped_acceptance');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('unproven', 'demonstrated', 'temporary_control_approved', 'not_applicable_yet');--> statement-breakpoint
CREATE TYPE "public"."integration_state" AS ENUM('not_implemented', 'implemented_not_connected', 'connected_test_mode', 'connected_capability_unverified', 'accepted_for_live_use', 'live_degraded_or_disconnected');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notice_sender" AS ENUM('unselected', 'gmail', 'stripe_native', 'manual');--> statement-breakpoint
CREATE TYPE "public"."notice_state" AS ENUM('intended', 'manual_pending', 'sent', 'failed', 'unknown', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('stripe', 'optimoroute', 'google_identity', 'gmail', 'google_address', 'slack', 'qbo');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'accounting', 'sales', 'driver_service');--> statement-breakpoint
CREATE TYPE "public"."selection_kind" AS ENUM('production', 'test');--> statement-breakpoint
CREATE TYPE "public"."package_kind" AS ENUM('case_12oz_can', 'case_24oz_can', 'keg_sixtel', 'keg_half');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('opening', 'receipt', 'sample_withdrawal', 'sample_return', 'adjustment', 'transfer_out', 'transfer_in', 'damage', 'load', 'route_return');--> statement-breakpoint
CREATE TYPE "public"."address_kind" AS ENUM('delivery', 'billing');--> statement-breakpoint
CREATE TYPE "public"."address_provenance" AS ENUM('customer_provided', 'customer_confirmed', 'sales_entered', 'admin_entered');--> statement-breakpoint
CREATE TYPE "public"."hold_kind" AS ENUM('payment_failure', 'compliance', 'readiness', 'admin_manual');--> statement-breakpoint
CREATE TYPE "public"."license_state" AS ENUM('unverified', 'pending_review', 'verified', 'rejected', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."location_status" AS ENUM('active', 'inactive', 'closed');--> statement-breakpoint
CREATE TYPE "public"."payment_channel" AS ENUM('unselected', 'stripe_ach', 'fintech');--> statement-breakpoint
CREATE TYPE "public"."payment_setup_state" AS ENUM('not_requested', 'requested', 'pending_verification', 'method_usable', 'unusable', 'revoked', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."intake_state" AS ENUM('received', 'incomplete', 'converted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."order_demand_state" AS ENUM('submitted', 'partially_fulfilled', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('sales', 'email', 'standing', 'customer_link');--> statement-breakpoint
CREATE TYPE "public"."reservation_state" AS ENUM('reserved', 'route_committed', 'fulfilled', 'released');--> statement-breakpoint
CREATE TYPE "public"."standing_state" AS ENUM('defined', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."delivery_visit_outcome" AS ENUM('planned', 'accepted', 'failed', 'unknown');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_employee_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"prior" jsonb,
	"current" jsonb,
	"reason" text,
	"correlation_id" text,
	"market_id" uuid
);
--> statement-breakpoint
CREATE TABLE "capability_gate" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "provider",
	"name" text NOT NULL,
	"classification" "gate_classification" NOT NULL,
	"required_demonstration" text NOT NULL,
	"permitted_control" text,
	"phase" integer NOT NULL,
	"status" "gate_status" DEFAULT 'unproven' NOT NULL,
	"evidence" text,
	"recorded_by_employee_id" uuid,
	"recorded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" text PRIMARY KEY NOT NULL,
	"register" "decision_register" NOT NULL,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"confirmed_behavior" text NOT NULL,
	"safe_support" text NOT NULL,
	"keep_inactive" text NOT NULL,
	"accountable" text NOT NULL,
	"status" "decision_status" DEFAULT 'unselected' NOT NULL,
	"selection_schema" jsonb
);
--> statement-breakpoint
CREATE TABLE "decision_selection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" text NOT NULL,
	"kind" "selection_kind" NOT NULL,
	"selection" jsonb NOT NULL,
	"scope" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"recorded_by_employee_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by_employee_id" uuid,
	"disable_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"google_subject" text,
	"email" text NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "exception_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"cause" text,
	"market_id" uuid,
	"location_id" uuid,
	"state" "exception_state" DEFAULT 'open' NOT NULL,
	"severity" text,
	"owner_role" "role",
	"owner_employee_id" uuid,
	"next_action" text,
	"waiting_party" text,
	"review_at" timestamp with time zone,
	"parent_case_id" uuid,
	"dedupe_key" text,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exception_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"relation" text
);
--> statement-breakpoint
CREATE TABLE "exception_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_employee_id" uuid,
	"actor_kind" "actor_kind" DEFAULT 'employee' NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"recipient_email" text,
	"recipient_contact_id" uuid,
	"intended_sender" "notice_sender" DEFAULT 'unselected' NOT NULL,
	"state" "notice_state" DEFAULT 'intended' NOT NULL,
	"content" jsonb,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connection" (
	"provider" "provider" PRIMARY KEY NOT NULL,
	"state" "integration_state" DEFAULT 'not_implemented' NOT NULL,
	"environment" text,
	"last_checked_at" timestamp with time zone,
	"detail" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurred_at" timestamp with time zone,
	"payload" jsonb,
	"processed_at" timestamp with time zone,
	"outcome" text,
	"signature_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"provider_object" text NOT NULL,
	"provider_id" text,
	"environment" text DEFAULT 'test' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"market_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_employee_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_employee_id" uuid,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "market" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"order_seq" integer DEFAULT 1 NOT NULL,
	"seller_context_status" text DEFAULT 'unconfirmed' NOT NULL,
	"seller_context_note" text,
	"slack_routing" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "market_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"package_kind" "package_kind" NOT NULL,
	"selling_unit" text NOT NULL,
	"kegs_per_unit" integer DEFAULT 0 NOT NULL,
	"weight_lb" numeric(8, 2),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"qty_delta" integer NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"evidence" text,
	"actor_employee_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"on_hand_qty" integer DEFAULT 0 NOT NULL,
	"unavailable_qty" integer DEFAULT 0 NOT NULL,
	"pending_inspection_qty" integer DEFAULT 0 NOT NULL,
	"in_transit_qty" integer DEFAULT 0 NOT NULL,
	"evidence_source" text,
	"evidence_at" timestamp with time zone,
	"confirmed_by_employee_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_text" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"fulfillment_contact" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"provenance" "address_provenance" NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "address_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address_id" uuid NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb,
	"raw_retained" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_email_change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"requested_email" text NOT NULL,
	"prior_email" text,
	"source" text DEFAULT 'sales' NOT NULL,
	"requested_by_employee_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"trade_name" text NOT NULL,
	"legal_name" text,
	"parent_id" uuid,
	"status" "location_status" DEFAULT 'active' NOT NULL,
	"delivery_instructions" text,
	"receiving_restrictions" text,
	"originating_rep_employee_id" uuid,
	"current_rep_employee_id" uuid,
	"warehouse_override_id" uuid,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text
);
--> statement-breakpoint
CREATE TABLE "customer_parent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" "hold_kind" NOT NULL,
	"cause" text NOT NULL,
	"cause_reference_type" text,
	"cause_reference_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"resolved_by_employee_id" uuid
);
--> statement-breakpoint
CREATE TABLE "hold_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"hold_id" uuid,
	"scope" text NOT NULL,
	"order_id" uuid,
	"reason" text NOT NULL,
	"granted_by_employee_id" uuid NOT NULL,
	"granted_by_role" "role" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_employee_id" uuid
);
--> statement-breakpoint
CREATE TABLE "license_verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"license_number" text,
	"license_type" text,
	"evidence" text,
	"state" "license_state" DEFAULT 'unverified' NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"kind" "address_kind" NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"from_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "location_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"contact_role" text NOT NULL,
	"may_order" boolean DEFAULT false NOT NULL,
	"receives_invoices" boolean DEFAULT false NOT NULL,
	"may_authorize_payment" boolean DEFAULT false NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"from_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "location_rep_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"from_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "payment_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"channel" "payment_channel" DEFAULT 'unselected' NOT NULL,
	"setup_state" "payment_setup_state" DEFAULT 'not_requested' NOT NULL,
	"payer_contact_id" uuid,
	"shared_payer_authorized" boolean DEFAULT false NOT NULL,
	"shared_payer_note" text,
	"setup_requested_at" timestamp with time zone,
	"last_provider_evidence" jsonb,
	"last_provider_evidence_at" timestamp with time zone,
	"direct_revocation_at" timestamp with time zone,
	"current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"source" "order_source" NOT NULL,
	"demand_state" "order_demand_state" DEFAULT 'submitted' NOT NULL,
	"requested_date" text,
	"notes" text,
	"rep_employee_id" uuid,
	"submitted_by_employee_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_key" text,
	"standing_occurrence_id" uuid,
	"intake_request_id" uuid,
	"warehouse_id" uuid,
	"abnormal_flag" boolean DEFAULT false NOT NULL,
	"abnormal_reason" text,
	"minimum_evaluation" jsonb,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by_employee_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_order_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "order_intake_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid,
	"location_id" uuid,
	"source" text DEFAULT 'email' NOT NULL,
	"source_reference" text,
	"from_email" text,
	"subject" text,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "intake_state" DEFAULT 'received' NOT NULL,
	"missing_essentials" text,
	"order_id" uuid,
	"handled_by_employee_id" uuid,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid NOT NULL,
	"ordered_qty" integer NOT NULL,
	"current_qty" integer NOT NULL,
	"cancelled_qty" integer DEFAULT 0 NOT NULL,
	"delivered_qty" integer DEFAULT 0 NOT NULL,
	"unit_price_cents_at_submission" integer NOT NULL,
	"market_price_id_at_submission" uuid,
	"kegs_per_unit" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_employee_id" uuid,
	"kind" text NOT NULL,
	"prior_qty" integer,
	"current_qty" integer,
	"prior_price_cents" integer,
	"proposed_price_cents" integer,
	"reason" text,
	"policy_status" text
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"reserved_qty" integer NOT NULL,
	"unmet_qty" integer DEFAULT 0 NOT NULL,
	"state" "reservation_state" DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"released_by_employee_id" uuid,
	"displacement_note" text
);
--> statement-breakpoint
CREATE TABLE "sample_withdrawal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"rep_employee_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"withdrawn_on" text NOT NULL,
	"notes" text,
	"state" text DEFAULT 'withdrawn' NOT NULL,
	"corrected_of_id" uuid,
	"recorded_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_arrangement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"state" "standing_state" DEFAULT 'defined' NOT NULL,
	"authorization_note" text,
	"requested_cadence" text,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "standing_arrangement_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"cycle_key" text NOT NULL,
	"order_id" uuid,
	"outcome" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy_selection_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cleaning_obligation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"applicable" text DEFAULT 'unknown' NOT NULL,
	"last_completed_on" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"delivery_date" text,
	"outcome" "delivery_visit_outcome" DEFAULT 'planned' NOT NULL,
	"accepted_merchandise_cents" integer,
	"accepted_keg_count" integer,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_visit_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"planned_qty" integer NOT NULL,
	"accepted_qty" integer,
	"refused_qty" integer,
	"damaged_qty" integer,
	"not_attempted_qty" integer,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "invoice_obligation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"delivery_date" text NOT NULL,
	"due_date" text NOT NULL,
	"merchandise_cents" integer NOT NULL,
	"deposit_cents" integer NOT NULL,
	"state" text DEFAULT 'pending_issue' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keg_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"visit_id" uuid,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	"attributed_count" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence" text
);
--> statement-breakpoint
ALTER TABLE "decision_selection" ADD CONSTRAINT "decision_selection_decision_id_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_identity" ADD CONSTRAINT "employee_identity_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_link" ADD CONSTRAINT "exception_link_case_id_exception_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."exception_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_note" ADD CONSTRAINT "exception_note_case_id_exception_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."exception_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_position" ADD CONSTRAINT "stock_position_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_position" ADD CONSTRAINT "stock_position_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_assessment" ADD CONSTRAINT "address_assessment_address_id_address_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."address"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_email_change_request" ADD CONSTRAINT "billing_email_change_request_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_location" ADD CONSTRAINT "customer_location_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_location" ADD CONSTRAINT "customer_location_parent_id_customer_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."customer_parent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold" ADD CONSTRAINT "hold_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_override" ADD CONSTRAINT "hold_override_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_override" ADD CONSTRAINT "hold_override_hold_id_hold_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."hold"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_verification" ADD CONSTRAINT "license_verification_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_address" ADD CONSTRAINT "location_address_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_address" ADD CONSTRAINT "location_address_address_id_address_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."address"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_contact" ADD CONSTRAINT "location_contact_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_contact" ADD CONSTRAINT "location_contact_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_rep_history" ADD CONSTRAINT "location_rep_history_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_relationship" ADD CONSTRAINT "payment_relationship_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intake_request" ADD CONSTRAINT "order_intake_request_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intake_request" ADD CONSTRAINT "order_intake_request_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_change" ADD CONSTRAINT "order_line_change_order_line_id_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_order_line_id_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_withdrawal" ADD CONSTRAINT "sample_withdrawal_market_id_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_withdrawal" ADD CONSTRAINT "sample_withdrawal_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_withdrawal" ADD CONSTRAINT "sample_withdrawal_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_arrangement" ADD CONSTRAINT "standing_arrangement_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_arrangement_line" ADD CONSTRAINT "standing_arrangement_line_arrangement_id_standing_arrangement_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."standing_arrangement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_arrangement_line" ADD CONSTRAINT "standing_arrangement_line_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_occurrence" ADD CONSTRAINT "standing_occurrence_arrangement_id_standing_arrangement_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."standing_arrangement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_obligation" ADD CONSTRAINT "cleaning_obligation_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_visit" ADD CONSTRAINT "delivery_visit_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_visit_line" ADD CONSTRAINT "delivery_visit_line_visit_id_delivery_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."delivery_visit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_visit_line" ADD CONSTRAINT "delivery_visit_line_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_obligation" ADD CONSTRAINT "invoice_obligation_visit_id_delivery_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."delivery_visit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_obligation" ADD CONSTRAINT "invoice_obligation_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keg_movement" ADD CONSTRAINT "keg_movement_location_id_customer_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_subject_idx" ON "audit_event" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "decision_selection_decision_idx" ON "decision_selection" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_identity_subject_uq" ON "employee_identity" USING btree ("google_subject") WHERE google_subject is not null;--> statement-breakpoint
CREATE INDEX "employee_identity_email_idx" ON "employee_identity" USING btree ("email");--> statement-breakpoint
CREATE INDEX "exception_state_idx" ON "exception_case" USING btree ("state");--> statement-breakpoint
CREATE INDEX "exception_location_idx" ON "exception_case" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exception_dedupe_open_uq" ON "exception_case" USING btree ("dedupe_key") WHERE dedupe_key is not null and state <> 'resolved';--> statement-breakpoint
CREATE INDEX "exception_link_subject_idx" ON "exception_link" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "job_status_run_at_idx" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedupe_uq" ON "job" USING btree ("dedupe_key") WHERE dedupe_key is not null;--> statement-breakpoint
CREATE INDEX "notice_subject_idx" ON "notice" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_event_uq" ON "provider_event" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "provider_reference_subject_idx" ON "provider_reference" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_reference_provider_id_uq" ON "provider_reference" USING btree ("provider","provider_object","provider_id");--> statement-breakpoint
CREATE INDEX "role_grant_employee_idx" ON "role_grant" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "market_price_lookup_idx" ON "market_price" USING btree ("market_id","sku_id","effective_from");--> statement-breakpoint
CREATE INDEX "stock_movement_lookup_idx" ON "stock_movement" USING btree ("warehouse_id","sku_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_position_uq" ON "stock_position" USING btree ("warehouse_id","sku_id");--> statement-breakpoint
CREATE INDEX "warehouse_market_idx" ON "warehouse" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "contact_email_idx" ON "contact" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customer_location_market_idx" ON "customer_location" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "customer_location_trade_name_idx" ON "customer_location" USING btree ("trade_name");--> statement-breakpoint
CREATE INDEX "hold_location_active_idx" ON "hold" USING btree ("location_id","active");--> statement-breakpoint
CREATE INDEX "location_address_idx" ON "location_address" USING btree ("location_id","kind","current");--> statement-breakpoint
CREATE INDEX "location_contact_idx" ON "location_contact" USING btree ("location_id","current");--> statement-breakpoint
CREATE INDEX "order_location_idx" ON "customer_order" USING btree ("location_id","submitted_at");--> statement-breakpoint
CREATE INDEX "order_market_idx" ON "customer_order" USING btree ("market_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_submission_key_uq" ON "customer_order" USING btree ("location_id","submission_key") WHERE submission_key is not null;--> statement-breakpoint
CREATE INDEX "order_line_order_idx" ON "order_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reservation_wh_sku_state_idx" ON "reservation" USING btree ("warehouse_id","sku_id","state");--> statement-breakpoint
CREATE INDEX "reservation_line_idx" ON "reservation" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "sample_market_idx" ON "sample_withdrawal" USING btree ("market_id","withdrawn_on");--> statement-breakpoint
CREATE UNIQUE INDEX "standing_occurrence_uq" ON "standing_occurrence" USING btree ("arrangement_id","cycle_key");--> statement-breakpoint
CREATE INDEX "delivery_visit_location_idx" ON "delivery_visit" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "keg_movement_location_idx" ON "keg_movement" USING btree ("location_id");