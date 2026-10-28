--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: actor_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.actor_kind AS ENUM (
    'employee',
    'system',
    'provider',
    'dev_fixture'
);


--
-- Name: address_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.address_kind AS ENUM (
    'delivery',
    'billing'
);


--
-- Name: address_provenance; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.address_provenance AS ENUM (
    'customer_provided',
    'customer_confirmed',
    'sales_entered',
    'admin_entered'
);


--
-- Name: decision_register; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.decision_register AS ENUM (
    'D',
    'SD',
    'T',
    'IG'
);


--
-- Name: decision_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.decision_status AS ENUM (
    'unselected',
    'selected'
);


--
-- Name: delivery_visit_outcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.delivery_visit_outcome AS ENUM (
    'planned',
    'accepted',
    'failed',
    'unknown'
);


--
-- Name: exception_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.exception_state AS ENUM (
    'open',
    'acknowledged',
    'assigned',
    'waiting',
    'resolved'
);


--
-- Name: gate_classification; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gate_classification AS ENUM (
    'must_work_before_initial_field_use',
    'can_use_temporary_control',
    'optional_enhancement',
    'scoped_acceptance'
);


--
-- Name: gate_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gate_status AS ENUM (
    'unproven',
    'demonstrated',
    'temporary_control_approved',
    'not_applicable_yet'
);


--
-- Name: hold_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.hold_kind AS ENUM (
    'payment_failure',
    'compliance',
    'readiness',
    'admin_manual'
);


--
-- Name: intake_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.intake_state AS ENUM (
    'received',
    'incomplete',
    'converted',
    'rejected'
);


--
-- Name: integration_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integration_state AS ENUM (
    'not_implemented',
    'implemented_not_connected',
    'connected_test_mode',
    'connected_capability_unverified',
    'accepted_for_live_use',
    'live_degraded_or_disconnected'
);


--
-- Name: job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_status AS ENUM (
    'queued',
    'running',
    'done',
    'failed'
);


--
-- Name: license_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.license_state AS ENUM (
    'unverified',
    'pending_review',
    'verified',
    'rejected',
    'not_applicable'
);


--
-- Name: location_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.location_status AS ENUM (
    'active',
    'inactive',
    'closed'
);


--
-- Name: notice_sender; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notice_sender AS ENUM (
    'unselected',
    'gmail',
    'stripe_native',
    'manual'
);


--
-- Name: notice_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notice_state AS ENUM (
    'intended',
    'manual_pending',
    'sent',
    'failed',
    'unknown',
    'superseded'
);


--
-- Name: order_demand_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_demand_state AS ENUM (
    'submitted',
    'partially_fulfilled',
    'fulfilled',
    'cancelled'
);


--
-- Name: order_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_source AS ENUM (
    'sales',
    'email',
    'standing',
    'customer_link'
);


--
-- Name: package_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.package_kind AS ENUM (
    'case_12oz_can',
    'case_24oz_can',
    'keg_sixtel',
    'keg_half'
);


--
-- Name: payment_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_channel AS ENUM (
    'unselected',
    'stripe_ach',
    'fintech'
);


--
-- Name: payment_setup_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_setup_state AS ENUM (
    'not_requested',
    'requested',
    'pending_verification',
    'method_usable',
    'unusable',
    'revoked',
    'unknown'
);


--
-- Name: provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.provider AS ENUM (
    'stripe',
    'optimoroute',
    'google_identity',
    'gmail',
    'google_address',
    'slack',
    'qbo'
);


--
-- Name: reservation_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reservation_state AS ENUM (
    'reserved',
    'route_committed',
    'fulfilled',
    'released'
);


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'owner',
    'admin',
    'accounting',
    'sales',
    'driver_service'
);


--
-- Name: selection_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.selection_kind AS ENUM (
    'production',
    'test'
);


--
-- Name: standing_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.standing_state AS ENUM (
    'defined',
    'paused',
    'ended'
);


--
-- Name: stock_movement_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.stock_movement_kind AS ENUM (
    'opening',
    'receipt',
    'sample_withdrawal',
    'sample_return',
    'adjustment',
    'transfer_out',
    'transfer_in',
    'damage',
    'load',
    'route_return'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: address; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.address (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    line1 text NOT NULL,
    line2 text,
    city text NOT NULL,
    state text NOT NULL,
    postal_code text NOT NULL,
    country text DEFAULT 'US'::text NOT NULL,
    provenance public.address_provenance NOT NULL,
    confirmed_at timestamp with time zone,
    created_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: address_assessment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.address_assessment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    address_id uuid NOT NULL,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    summary jsonb,
    raw_retained boolean DEFAULT false NOT NULL
);


--
-- Name: audit_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_employee_id uuid,
    action text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    prior jsonb,
    current jsonb,
    reason text,
    correlation_id text,
    market_id uuid
);


--
-- Name: billing_email_change_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_email_change_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    requested_email text NOT NULL,
    prior_email text,
    source text DEFAULT 'sales'::text NOT NULL,
    requested_by_employee_id uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    decided_by_employee_id uuid,
    decided_at timestamp with time zone,
    decision_note text
);


--
-- Name: capability_gate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capability_gate (
    id text NOT NULL,
    provider public.provider,
    name text NOT NULL,
    classification public.gate_classification NOT NULL,
    required_demonstration text NOT NULL,
    permitted_control text,
    phase integer NOT NULL,
    status public.gate_status DEFAULT 'unproven'::public.gate_status NOT NULL,
    evidence text,
    recorded_by_employee_id uuid,
    recorded_at timestamp with time zone
);


--
-- Name: cleaning_obligation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cleaning_obligation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    applicable text DEFAULT 'unknown'::text NOT NULL,
    last_completed_on text,
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_location; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_location (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    trade_name text NOT NULL,
    legal_name text,
    parent_id uuid,
    status public.location_status DEFAULT 'active'::public.location_status NOT NULL,
    delivery_instructions text,
    receiving_restrictions text,
    originating_rep_employee_id uuid,
    current_rep_employee_id uuid,
    warehouse_override_id uuid,
    created_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    close_reason text
);


--
-- Name: customer_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    location_id uuid NOT NULL,
    order_number text NOT NULL,
    source public.order_source NOT NULL,
    demand_state public.order_demand_state DEFAULT 'submitted'::public.order_demand_state NOT NULL,
    requested_date text,
    notes text,
    rep_employee_id uuid,
    submitted_by_employee_id uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    submission_key text,
    standing_occurrence_id uuid,
    intake_request_id uuid,
    warehouse_id uuid,
    abnormal_flag boolean DEFAULT false NOT NULL,
    abnormal_reason text,
    minimum_evaluation jsonb,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    cancelled_by_employee_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_parent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_parent (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision (
    id text NOT NULL,
    register public.decision_register NOT NULL,
    title text NOT NULL,
    question text NOT NULL,
    confirmed_behavior text NOT NULL,
    safe_support text NOT NULL,
    keep_inactive text NOT NULL,
    accountable text NOT NULL,
    status public.decision_status DEFAULT 'unselected'::public.decision_status NOT NULL,
    selection_schema jsonb
);


--
-- Name: decision_selection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_selection (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_id text NOT NULL,
    kind public.selection_kind NOT NULL,
    selection jsonb NOT NULL,
    scope text NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    recorded_by_employee_id uuid,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    superseded_at timestamp with time zone,
    note text,
    market_ids jsonb
);


--
-- Name: delivery_visit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_visit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    delivery_date text,
    outcome public.delivery_visit_outcome DEFAULT 'planned'::public.delivery_visit_outcome NOT NULL,
    accepted_merchandise_cents integer,
    accepted_keg_count integer,
    evidence jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: delivery_visit_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_visit_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    order_id uuid NOT NULL,
    order_line_id uuid NOT NULL,
    planned_qty integer NOT NULL,
    accepted_qty integer,
    refused_qty integer,
    damaged_qty integer,
    not_attempted_qty integer,
    reason text
);


--
-- Name: employee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    disabled_at timestamp with time zone,
    disabled_by_employee_id uuid,
    disable_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_identity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_identity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    google_subject text,
    email text NOT NULL,
    current boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    ended_at timestamp with time zone
);


--
-- Name: exception_case; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exception_case (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    cause text,
    market_id uuid,
    location_id uuid,
    state public.exception_state DEFAULT 'open'::public.exception_state NOT NULL,
    severity text,
    owner_role public.role,
    owner_employee_id uuid,
    next_action text,
    waiting_party text,
    review_at timestamp with time zone,
    parent_case_id uuid,
    dedupe_key text,
    resolution text,
    resolved_at timestamp with time zone,
    resolved_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: exception_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exception_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    relation text
);


--
-- Name: exception_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exception_note (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_employee_id uuid,
    actor_kind public.actor_kind DEFAULT 'employee'::public.actor_kind NOT NULL,
    kind text DEFAULT 'note'::text NOT NULL,
    body text NOT NULL,
    data jsonb
);


--
-- Name: hold; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hold (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    kind public.hold_kind NOT NULL,
    cause text NOT NULL,
    cause_reference_type text,
    cause_reference_id text,
    active boolean DEFAULT true NOT NULL,
    created_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolution text,
    resolved_by_employee_id uuid
);


--
-- Name: hold_override; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hold_override (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    hold_id uuid,
    scope text NOT NULL,
    order_id uuid,
    reason text NOT NULL,
    granted_by_employee_id uuid NOT NULL,
    granted_by_role public.role NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    withdrawn_at timestamp with time zone,
    withdrawn_by_employee_id uuid
);


--
-- Name: invoice_obligation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_obligation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    location_id uuid NOT NULL,
    delivery_date text NOT NULL,
    due_date text NOT NULL,
    merchandise_cents integer NOT NULL,
    deposit_cents integer NOT NULL,
    state text DEFAULT 'pending_issue'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    status public.job_status DEFAULT 'queued'::public.job_status NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    dedupe_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: keg_movement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.keg_movement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    visit_id uuid,
    kind text NOT NULL,
    count integer NOT NULL,
    attributed_count integer,
    at timestamp with time zone DEFAULT now() NOT NULL,
    evidence text
);


--
-- Name: license_verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.license_verification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    license_number text,
    license_type text,
    evidence text,
    state public.license_state DEFAULT 'unverified'::public.license_state NOT NULL,
    current boolean DEFAULT true NOT NULL,
    decided_by_employee_id uuid,
    decided_at timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: location_address; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_address (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    address_id uuid NOT NULL,
    kind public.address_kind NOT NULL,
    current boolean DEFAULT true NOT NULL,
    from_at timestamp with time zone DEFAULT now() NOT NULL,
    to_at timestamp with time zone
);


--
-- Name: location_contact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_contact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    contact_role text NOT NULL,
    may_order boolean DEFAULT false NOT NULL,
    receives_invoices boolean DEFAULT false NOT NULL,
    may_authorize_payment boolean DEFAULT false NOT NULL,
    current boolean DEFAULT true NOT NULL,
    from_at timestamp with time zone DEFAULT now() NOT NULL,
    to_at timestamp with time zone
);


--
-- Name: location_rep_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_rep_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    from_at timestamp with time zone DEFAULT now() NOT NULL,
    to_at timestamp with time zone,
    reason text
);


--
-- Name: market; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    timezone text DEFAULT 'America/Los_Angeles'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    order_seq integer DEFAULT 1 NOT NULL,
    seller_context_status text DEFAULT 'unconfirmed'::text NOT NULL,
    seller_context_note text,
    slack_routing jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_price; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_price (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    sku_id uuid NOT NULL,
    price_cents integer NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    created_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notice (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purpose text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    recipient_email text,
    recipient_contact_id uuid,
    intended_sender public.notice_sender DEFAULT 'unselected'::public.notice_sender NOT NULL,
    state public.notice_state DEFAULT 'intended'::public.notice_state NOT NULL,
    content jsonb,
    evidence jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_intake_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_intake_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid,
    location_id uuid,
    source text DEFAULT 'email'::text NOT NULL,
    source_reference text,
    from_email text,
    subject text,
    body text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    state public.intake_state DEFAULT 'received'::public.intake_state NOT NULL,
    missing_essentials text,
    order_id uuid,
    handled_by_employee_id uuid,
    handled_at timestamp with time zone
);


--
-- Name: order_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    line_no integer NOT NULL,
    sku_id uuid NOT NULL,
    ordered_qty integer NOT NULL,
    current_qty integer NOT NULL,
    cancelled_qty integer DEFAULT 0 NOT NULL,
    delivered_qty integer DEFAULT 0 NOT NULL,
    unit_price_cents_at_submission integer NOT NULL,
    market_price_id_at_submission uuid,
    kegs_per_unit integer DEFAULT 0 NOT NULL
);


--
-- Name: order_line_change; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_line_change (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_line_id uuid NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_employee_id uuid,
    kind text NOT NULL,
    prior_qty integer,
    current_qty integer,
    prior_price_cents integer,
    proposed_price_cents integer,
    reason text,
    policy_status text
);


--
-- Name: payment_relationship; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_relationship (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    channel public.payment_channel DEFAULT 'unselected'::public.payment_channel NOT NULL,
    setup_state public.payment_setup_state DEFAULT 'not_requested'::public.payment_setup_state NOT NULL,
    payer_contact_id uuid,
    shared_payer_authorized boolean DEFAULT false NOT NULL,
    shared_payer_note text,
    setup_requested_at timestamp with time zone,
    last_provider_evidence jsonb,
    last_provider_evidence_at timestamp with time zone,
    direct_revocation_at timestamp with time zone,
    current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: provider_connection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_connection (
    provider public.provider NOT NULL,
    state public.integration_state DEFAULT 'not_implemented'::public.integration_state NOT NULL,
    environment text,
    last_checked_at timestamp with time zone,
    detail jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: provider_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.provider NOT NULL,
    event_id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    occurred_at timestamp with time zone,
    payload jsonb,
    processed_at timestamp with time zone,
    outcome text,
    signature_verified boolean DEFAULT false NOT NULL
);


--
-- Name: provider_reference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_reference (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.provider NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    provider_object text NOT NULL,
    provider_id text,
    environment text DEFAULT 'test'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    evidence jsonb,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reservation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_line_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    sku_id uuid NOT NULL,
    reserved_qty integer NOT NULL,
    unmet_qty integer DEFAULT 0 NOT NULL,
    state public.reservation_state DEFAULT 'reserved'::public.reservation_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    release_reason text,
    released_by_employee_id uuid,
    displacement_note text,
    displaced_at timestamp with time zone
);


--
-- Name: role_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    role public.role NOT NULL,
    market_id uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by_employee_id uuid,
    revoked_at timestamp with time zone,
    revoked_by_employee_id uuid,
    revoke_reason text
);


--
-- Name: sample_withdrawal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    rep_employee_id uuid NOT NULL,
    sku_id uuid NOT NULL,
    qty integer NOT NULL,
    withdrawn_on text NOT NULL,
    notes text,
    state text DEFAULT 'withdrawn'::text NOT NULL,
    corrected_of_id uuid,
    recorded_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sku; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    brand text NOT NULL,
    package_kind public.package_kind NOT NULL,
    selling_unit text NOT NULL,
    kegs_per_unit integer DEFAULT 0 NOT NULL,
    weight_lb numeric(8,2),
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: standing_arrangement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standing_arrangement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    state public.standing_state DEFAULT 'defined'::public.standing_state NOT NULL,
    authorization_note text,
    requested_cadence text,
    created_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    end_reason text
);


--
-- Name: standing_arrangement_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standing_arrangement_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    arrangement_id uuid NOT NULL,
    sku_id uuid NOT NULL,
    qty integer NOT NULL
);


--
-- Name: standing_occurrence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standing_occurrence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    arrangement_id uuid NOT NULL,
    cycle_key text NOT NULL,
    order_id uuid,
    outcome text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    policy_selection_id uuid
);


--
-- Name: stock_movement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    warehouse_id uuid NOT NULL,
    sku_id uuid NOT NULL,
    kind public.stock_movement_kind NOT NULL,
    qty_delta integer NOT NULL,
    reference_type text,
    reference_id text,
    evidence text,
    actor_employee_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_position; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_position (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    warehouse_id uuid NOT NULL,
    sku_id uuid NOT NULL,
    on_hand_qty integer DEFAULT 0 NOT NULL,
    unavailable_qty integer DEFAULT 0 NOT NULL,
    pending_inspection_qty integer DEFAULT 0 NOT NULL,
    in_transit_qty integer DEFAULT 0 NOT NULL,
    evidence_source text,
    evidence_at timestamp with time zone,
    confirmed_by_employee_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: warehouse; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    name text NOT NULL,
    address_text text,
    is_primary boolean DEFAULT false NOT NULL,
    fulfillment_contact text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: -
--

INSERT INTO drizzle.__drizzle_migrations VALUES (1, 'd0e8c8c7ab9a952ebc839ac1be2cb52d16e7dc7bc8c9ed9ade788b768cf4e6e4', 1789636203124);
INSERT INTO drizzle.__drizzle_migrations VALUES (2, '20576608b3f49e62aeb70184a9fdc04441a7a6ac2f4b4249a60eb04a8b937ee4', 1789639416349);


--
-- Data for Name: address; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.address VALUES ('bda927c7-c728-410f-95f3-b2f1793bbfd2', '2400 Mission St', NULL, 'San Francisco', 'CA', '94110', 'US', 'sales_entered', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.490445-07');
INSERT INTO public.address VALUES ('b1ecc534-7d36-4016-be7c-9f74c70fda84', '88 Marina Blvd', NULL, 'San Francisco', 'CA', '94123', 'US', 'sales_entered', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.510274-07');
INSERT INTO public.address VALUES ('e5b90e01-a62b-42fe-ab96-b18d2b8374e1', '1501 Sloat Blvd', NULL, 'San Francisco', 'CA', '94132', 'US', 'sales_entered', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.520341-07');
INSERT INTO public.address VALUES ('6a23d88f-c5a0-43a9-a206-2b6473626b6d', '2200 3rd St', NULL, 'San Francisco', 'CA', '94107', 'US', 'sales_entered', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.530376-07');
INSERT INTO public.address VALUES ('6addf446-b666-4975-9c4d-6897916228fa', '3200 Chestnut St', NULL, 'San Francisco', 'CA', '94123', 'US', 'sales_entered', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.5488-07');
INSERT INTO public.address VALUES ('db012590-360b-4233-95d4-c711ef51a02d', '1300 Judah St', NULL, 'San Francisco', 'CA', '94122', 'US', 'sales_entered', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.562139-07');
INSERT INTO public.address VALUES ('6a3ea787-caa7-444f-8690-1eafbd36925b', '1500 Sunset Blvd', NULL, 'Los Angeles', 'CA', '90026', 'US', 'sales_entered', NULL, '64587a9f-cc18-4d7e-bbb2-773be095cc20', '2026-09-17 06:57:18.576969-07');


--
-- Data for Name: address_assessment; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: audit_event; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.audit_event VALUES ('1afb272b-b333-40e6-b7fe-151df2ecbfc7', '2026-09-17 06:57:18.306433-07', 'system', NULL, 'demo.seed', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', NULL, '{"note": "demo data — not customer history"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('ccecbf70-8d10-40b7-a2f0-00eae24815a9', '2026-09-17 06:57:18.30873-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'market.create', 'market', 'cedd932e-f4e5-4e5d-a871-7b614335f894', NULL, '{"code": "NC", "name": "NorCal / Bay Area"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('cf96c34f-c097-4918-9346-e228383677db', '2026-09-17 06:57:18.310499-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'market.create', 'market', '6c976b6f-a023-4539-bb98-a17a3c33000e', NULL, '{"code": "LA", "name": "Greater Los Angeles"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('697d1afa-5f16-4717-852e-17a58667c27e', '2026-09-17 06:57:18.311987-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'market.create', 'market', '8e476704-ed63-4fb4-adb7-7d0443107190', NULL, '{"code": "MA", "name": "Massachusetts"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('1a1fa5de-c5b8-437a-bedf-bb5c2b3c522a', '2026-09-17 06:57:18.315817-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'warehouse.create', 'warehouse', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', NULL, '{"name": "East Brother Beer Co. (Richmond, CA)", "marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "isPrimary": true, "fulfillmentContact": "host brewery cellar lead"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('b1f24d23-f029-4006-a1e1-88903d06cce8', '2026-09-17 06:57:18.317159-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'warehouse.create', 'warehouse', '7ef1c135-c690-4bc4-ae69-b37efc33e147', NULL, '{"name": "Overflow cold storage (Oakland)", "marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "isPrimary": false, "fulfillmentContact": "3PL desk"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('982f946c-8151-4ede-a56c-b2f8cb7b7202', '2026-09-17 06:57:18.318843-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'warehouse.create', 'warehouse', 'e435c069-e41b-4077-9421-e1779aef343b', NULL, '{"name": "Beachwood (Huntington Beach, CA)", "marketId": "6c976b6f-a023-4539-bb98-a17a3c33000e", "isPrimary": true, "fulfillmentContact": "host brewery"}', NULL, NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('447f3192-aa3f-43fa-9e2e-9b883ee18a49', '2026-09-17 06:57:18.320509-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'warehouse.create', 'warehouse', '762f281f-2d01-443e-8630-e9162ac3ad70', NULL, '{"name": "Jack''s Abby (Framingham, MA)", "marketId": "8e476704-ed63-4fb4-adb7-7d0443107190", "isPrimary": true, "fulfillmentContact": "host brewery"}', NULL, NULL, '8e476704-ed63-4fb4-adb7-7d0443107190');
INSERT INTO public.audit_event VALUES ('3721be9d-89a1-498b-a79e-7eaea0672659', '2026-09-17 06:57:18.328048-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'employee.grant', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', NULL, '{"role": "admin", "marketId": null}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('cdce4ed1-7a78-4e36-a62d-eee090d333be', '2026-09-17 06:57:18.338259-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'employee.grant', 'employee', '54c7b5e9-ab99-448c-9ec0-74354e40ea84', NULL, '{"role": "accounting", "marketId": null}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('db83f38d-a76c-4854-97d8-3d4fba6535b0', '2026-09-17 06:57:18.344389-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'employee.grant', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, '{"role": "sales", "marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('fb985320-9615-4e8d-94dc-761ec0e12071', '2026-09-17 06:57:18.356602-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'employee.grant', 'employee', '64587a9f-cc18-4d7e-bbb2-773be095cc20', NULL, '{"role": "sales", "marketId": "6c976b6f-a023-4539-bb98-a17a3c33000e"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('a1da2a11-f5ae-43ed-adc3-0dcfc9a76b05', '2026-09-17 06:57:18.362807-07', 'employee', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'employee.grant', 'employee', '67ec2967-5872-4cc3-a8c6-c7fdfbf7c8d4', NULL, '{"role": "driver_service", "marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('4a9f05c3-addd-4867-904e-7cc81eee04c3', '2026-09-17 06:57:18.366123-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'sku.create', 'sku', '95f8f51c-c694-4432-8a26-1d10285ad100', NULL, '{"code": "CAN-12C", "name": "12 oz can case"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('7242f99d-e2cf-4e38-870e-32c460119cad', '2026-09-17 06:57:18.367483-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'sku.create', 'sku', '5af594ee-2c50-48bc-a69f-6a4cfe83db1a', NULL, '{"code": "CAN-24C", "name": "24 oz can case"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('fb8f2983-7333-4e3c-a2d8-7238c0f90653', '2026-09-17 06:57:18.368674-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'sku.create', 'sku', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', NULL, '{"code": "CAN-SIX", "name": "1/6 bbl keg"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('d8c8970c-04d5-4f6a-bad7-641315a936da', '2026-09-17 06:57:18.369772-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'sku.create', 'sku', '76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', NULL, '{"code": "CAN-HALF", "name": "1/2 bbl keg"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('4cc85f06-103c-4a72-b708-701191d20539', '2026-09-17 06:57:18.371348-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'sku.create', 'sku', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', NULL, '{"code": "SUN-12C", "name": "12 oz can case"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('57263069-300d-40f4-87f9-7a8eb457e69a', '2026-09-17 06:57:18.372469-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'sku.create', 'sku', 'f7402f85-342b-4cd0-a818-5bacb80c2536', NULL, '{"code": "SUN-SIX", "name": "1/6 bbl keg"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('cfc15bb7-e9b5-47da-8971-e4b0f5dc585f', '2026-09-17 06:57:18.376971-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '11f2b00f-3dec-46bc-850b-ecb8652902fe', NULL, '{"priceCents": 3600, "effectiveFrom": "2026-09-17T13:57:18.372Z"}', 'demo seed SAMPLE price', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('67caf58e-d44c-49fb-b0d1-51b79bd77018', '2026-09-17 06:57:18.379359-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '3d41bb06-9982-4b59-89b3-20f71fa91756', NULL, '{"priceCents": 4200, "effectiveFrom": "2026-09-17T13:57:18.377Z"}', 'demo seed SAMPLE price', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('bf660c3f-c06d-40f0-94c0-1ba2f40c4276', '2026-09-17 06:57:18.381461-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', 'a782b907-0d08-4523-b80a-ddcdbe93d96f', NULL, '{"priceCents": 9500, "effectiveFrom": "2026-09-17T13:57:18.379Z"}', 'demo seed SAMPLE price', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('d8efe586-78ab-4422-98a5-18d6c6153d66', '2026-09-17 06:57:18.38366-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', 'b8d7f947-8ea2-4969-9c1c-b199a529d4e0', NULL, '{"priceCents": 17500, "effectiveFrom": "2026-09-17T13:57:18.381Z"}', 'demo seed SAMPLE price', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('4357f5d9-eaf5-410a-9d01-94decea9c9ee', '2026-09-17 06:57:18.385561-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '5f9345a6-0861-497a-9b97-49ed8dd25769', NULL, '{"priceCents": 3400, "effectiveFrom": "2026-09-17T13:57:18.384Z"}', 'demo seed SAMPLE price', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('1ce30d36-4b71-4bed-a0f0-90ea8b124238', '2026-09-17 06:57:18.387972-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '11c9abfb-9a07-4289-8e78-db67f12fcfbf', NULL, '{"priceCents": 9000, "effectiveFrom": "2026-09-17T13:57:18.385Z"}', 'demo seed SAMPLE price', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('8a3b76bd-45fd-45b5-bdb0-e2940cb4da92', '2026-09-17 06:57:18.389996-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '0f12bb29-485e-4a9d-9291-0701edd3cc68', NULL, '{"priceCents": 3600, "effectiveFrom": "2026-09-17T13:57:18.388Z"}', 'demo seed SAMPLE price', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('4a7764fe-39ad-4966-a645-ac5ce8224eb1', '2026-09-17 06:57:18.391939-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '1d8c4967-9803-4cf5-9452-76d24eb5afa7', NULL, '{"priceCents": 4200, "effectiveFrom": "2026-09-17T13:57:18.390Z"}', 'demo seed SAMPLE price', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('fe0f0b13-cdcd-48a3-917c-8191ba0d3ab7', '2026-09-17 06:57:18.395814-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '56698b80-0aa5-485b-8ce3-119987a0a8d9', NULL, '{"priceCents": 9500, "effectiveFrom": "2026-09-17T13:57:18.392Z"}', 'demo seed SAMPLE price', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('46e9eaa5-3606-4361-be9c-86497e1a38a2', '2026-09-17 06:57:18.398358-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '8ea81902-2a2b-452e-af9c-a267e4c53671', NULL, '{"priceCents": 17500, "effectiveFrom": "2026-09-17T13:57:18.396Z"}', 'demo seed SAMPLE price', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('15c85cf7-cec5-409a-aae4-78b0793a3d76', '2026-09-17 06:57:18.400642-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', '3791fe54-cbe4-4c6e-829a-4c6374b682b3', NULL, '{"priceCents": 3400, "effectiveFrom": "2026-09-17T13:57:18.398Z"}', 'demo seed SAMPLE price', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('810d06eb-301f-47eb-8d4b-98bd1e1ffd1d', '2026-09-17 06:57:18.403015-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', 'fa0ee0f7-64d3-45ee-94df-7689993b421a', NULL, '{"priceCents": 9000, "effectiveFrom": "2026-09-17T13:57:18.401Z"}', 'demo seed SAMPLE price', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('27832186-8ba8-409e-8bc8-987f17b3fd22', '2026-09-17 06:57:18.406247-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', 'afe8e824-892b-4ef3-bd79-6d0ee7f587ca', NULL, '{"priceCents": 3800, "effectiveFrom": "2026-09-17T13:57:18.403Z"}', 'demo seed SAMPLE price', NULL, '8e476704-ed63-4fb4-adb7-7d0443107190');
INSERT INTO public.audit_event VALUES ('67d07bcb-a391-4afc-81bc-32717348e6b8', '2026-09-17 06:57:18.409424-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'price.set', 'market_price', 'ca573441-03e8-43b4-a039-f6146480c0aa', NULL, '{"priceCents": 9900, "effectiveFrom": "2026-09-17T13:57:18.406Z"}', 'demo seed SAMPLE price', NULL, '8e476704-ed63-4fb4-adb7-7d0443107190');
INSERT INTO public.audit_event VALUES ('0e4c9291-4533-431f-8b1e-82e89740ef25', '2026-09-17 06:57:18.414113-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', '4950185a-f187-4591-9d8f-fa590243cfb0', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 40, "onHandQty": 40}', 'demo seed opening count (host brewery cellar sheet)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('985cb79e-72c2-41d5-a2a6-16aa2f004d13', '2026-09-17 06:57:18.4237-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', '3a05b855-e74b-4499-ad5f-be1376b2e07c', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 18, "onHandQty": 18}', 'demo seed opening count (host brewery cellar sheet)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('b5845db3-198a-4688-9f07-88e6eb14a533', '2026-09-17 06:57:18.433987-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', 'cf2f0dcc-ab61-48e1-96c3-cafca93acfe9', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 12, "onHandQty": 12}', 'demo seed opening count (host brewery cellar sheet)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('7fd58ebe-4ce8-49bc-9e45-9b1f2ae79cf4', '2026-09-17 06:57:18.44568-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', '352d9ba5-ca7f-48b1-8b94-d849067211b5', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 6, "onHandQty": 6}', 'demo seed opening count (host brewery cellar sheet)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('175c0327-45a9-42c1-af17-ef850388c4cb', '2026-09-17 06:57:18.452015-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', 'b1b34ff9-9291-400c-82bc-0d629462c3d6', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 24, "onHandQty": 24}', 'demo seed opening count (host brewery cellar sheet)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('948131e8-5dba-4f60-b058-0d9bfe0a4deb', '2026-09-17 06:57:18.459341-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', '79bef6d9-12a5-43ef-8203-16e708675c4a', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 2, "onHandQty": 2}', 'demo seed opening count (host brewery cellar sheet)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('3d928cbf-0027-426c-aeb2-3d2c015ccde6', '2026-09-17 06:57:18.466381-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', 'cb84cd4d-9fc8-4f71-9cef-8ed8b72002c2', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 30, "onHandQty": 30}', 'demo seed opening count', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('298dd190-46f0-4466-879e-a1ec5ef7a60b', '2026-09-17 06:57:18.473862-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', '1bd59661-c9bf-42de-a961-b978ada4d38a', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 8, "onHandQty": 8}', 'demo seed opening count', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('54a5ef86-7178-453a-930b-f2310739b047', '2026-09-17 06:57:18.47982-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stock.movement', 'stock_position', 'e9a2c916-675e-4cdb-ad85-7fc48a72731b', '{"onHandQty": 0}', '{"kind": "opening", "qtyDelta": 12, "onHandQty": 12}', 'demo seed opening count', NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('fabb0fcd-375b-4937-bfc5-83b419f5b6cd', '2026-09-17 06:57:18.490445-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'location.create', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', NULL, '{"marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "parentId": null, "tradeName": "Mission Taproom", "similarNamesWarned": 0}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('415b005c-4834-4482-86cf-7616cf65ef92', '2026-09-17 06:57:18.490445-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', '9dbee0b5-6360-49d1-89d1-685674922f08', NULL, '{"title": "License verification pending — Mission Taproom", "category": "license_unverified", "dedupeKey": "license_unverified:1f1102a1-f0fd-46d0-a671-4fe1e8cbe975"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('21146b91-84ff-44ae-9fa1-94a75cf781b6', '2026-09-17 06:57:18.510274-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'location.create', 'customer_location', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', NULL, '{"marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "parentId": null, "tradeName": "Golden Gate Grill", "similarNamesWarned": 0}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('0e5e900e-e87b-46cf-bbfd-d8be9dc2d79f', '2026-09-17 06:57:18.510274-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', '772bafea-c8be-48bf-8c17-5ebeec8c1eab', NULL, '{"title": "License verification pending — Golden Gate Grill", "category": "license_unverified", "dedupeKey": "license_unverified:66ba05d7-49d3-4791-9fd1-f96572ad50ce"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('95c1cf9d-4e87-409c-bf5a-f2c9c8640312', '2026-09-17 06:57:18.520341-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'location.create', 'customer_location', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', NULL, '{"marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "parentId": null, "tradeName": "Golden Gate Grill", "similarNamesWarned": 1}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('f01c2b93-0bce-4044-a861-9380c996fc29', '2026-09-17 06:57:18.520341-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', 'c3aff6ae-75b9-490c-ab6f-4575b1eadcda', NULL, '{"title": "License verification pending — Golden Gate Grill", "category": "license_unverified", "dedupeKey": "license_unverified:4a8a015d-8d8b-43ed-ad4f-691ea6543fb9"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('22a75933-9d4b-4920-8c6d-e56a82f9e702', '2026-09-17 06:57:18.530376-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'location.create', 'customer_location', '698362f0-149d-4555-bf47-ee15139929d8', NULL, '{"marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "parentId": null, "tradeName": "Dogpatch Bottle Shop", "similarNamesWarned": 0}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('9cffae9b-5761-4984-b330-d44b1a561f67', '2026-09-17 06:57:18.530376-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', '38f1cb7b-d2a2-4b3b-9a39-5b01a6a2881b', NULL, '{"title": "License verification pending — Dogpatch Bottle Shop", "category": "license_unverified", "dedupeKey": "license_unverified:698362f0-149d-4555-bf47-ee15139929d8"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('3c042fed-dd06-4b66-bd8b-71256bf26d24', '2026-09-17 06:57:18.5488-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'location.create', 'customer_location', 'fde86ec2-449b-42e1-a829-97c387141740', NULL, '{"marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "parentId": null, "tradeName": "Marina Wine & Beer", "similarNamesWarned": 0}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('6215b713-9242-42c9-abe6-6f2ac196049d', '2026-09-17 06:57:18.5488-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', 'f18ac6b3-36b2-4b74-b43f-398d20992565', NULL, '{"title": "License verification pending — Marina Wine & Beer", "category": "license_unverified", "dedupeKey": "license_unverified:fde86ec2-449b-42e1-a829-97c387141740"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('6f55c3b0-1ac6-4ad0-b32a-3614bfbcf951', '2026-09-17 06:57:18.562139-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'location.create', 'customer_location', 'eed53303-7015-452f-ae6e-795b4e5e9b99', NULL, '{"marketId": "cedd932e-f4e5-4e5d-a871-7b614335f894", "parentId": null, "tradeName": "Sunset Social Club", "similarNamesWarned": 0}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('b09f26e1-b423-4848-860e-d905f1166053', '2026-09-17 06:57:18.562139-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', '3c8dc440-6b28-40cf-9a90-2869c0a5d313', NULL, '{"title": "License verification pending — Sunset Social Club", "category": "license_unverified", "dedupeKey": "license_unverified:eed53303-7015-452f-ae6e-795b4e5e9b99"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('8fea815a-b2d1-4062-bb49-f5e3687d5929', '2026-09-17 06:57:18.576969-07', 'employee', '64587a9f-cc18-4d7e-bbb2-773be095cc20', 'location.create', 'customer_location', '11d5ce87-8101-47d1-8de3-136bbd527609', NULL, '{"marketId": "6c976b6f-a023-4539-bb98-a17a3c33000e", "parentId": null, "tradeName": "Echo Park Cantina", "similarNamesWarned": 0}', NULL, NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('4903fce2-4fbf-4940-95e7-46399fbef963', '2026-09-17 06:57:18.576969-07', 'employee', '64587a9f-cc18-4d7e-bbb2-773be095cc20', 'exception.open', 'exception_case', '16bb7191-c205-4d3d-8fb7-d4b3de22ac00', NULL, '{"title": "License verification pending — Echo Park Cantina", "category": "license_unverified", "dedupeKey": "license_unverified:11d5ce87-8101-47d1-8de3-136bbd527609"}', NULL, NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('ef95b215-e376-40dd-8863-a227dfb39a96', '2026-09-17 06:57:18.591888-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'license.decision', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '{"state": "unverified", "licenseNumber": null}', '{"state": "verified", "evidence": "ABC license lookup (demo)", "licenseNumber": "ABC-1F1102"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('2bf1f542-9baf-4244-a9d3-fe2269cb8a16', '2026-09-17 06:57:18.596748-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'license.decision', 'customer_location', '698362f0-149d-4555-bf47-ee15139929d8', '{"state": "unverified", "licenseNumber": null}', '{"state": "verified", "evidence": "ABC license lookup (demo)", "licenseNumber": "ABC-698362"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('7f7cb52f-1aae-4072-99ae-910ebc4748ae', '2026-09-17 06:57:18.601849-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'license.decision', 'customer_location', 'fde86ec2-449b-42e1-a829-97c387141740', '{"state": "unverified", "licenseNumber": null}', '{"state": "verified", "evidence": "ABC license lookup (demo)", "licenseNumber": "ABC-FDE86E"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('7ef0f742-b6c8-4f97-ad7b-92d5730e7ca6', '2026-09-17 06:57:18.608534-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'license.decision', 'customer_location', '11d5ce87-8101-47d1-8de3-136bbd527609', '{"state": "unverified", "licenseNumber": null}', '{"state": "verified", "evidence": "ABC license lookup (demo)", "licenseNumber": "ABC-11D5CE"}', NULL, NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('c96b1afb-47bc-48c2-9be0-fef5efb04c71', '2026-09-17 06:57:18.612794-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'order.submit', 'order', 'cb10c225-00e7-41fb-b286-5ce4c934ded3', NULL, '{"lines": [{"qty": 4, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100", "unmet": 0, "reserved": 4, "unitPriceCents": 3600}, {"qty": 1, "skuId": "1e1e97bc-f89b-46ef-8797-e8a1dae400ef", "unmet": 0, "reserved": 1, "unitPriceCents": 9500}], "minimum": "meets", "abnormal": false, "locationId": "1f1102a1-f0fd-46d0-a671-4fe1e8cbe975", "orderNumber": "NC-000001"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('1cf5bcf3-c6f2-4c93-b93a-721c668be394', '2026-09-17 06:57:18.640372-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'order.submit', 'order', '879f3cf7-c4bf-4586-877e-e6c87cd54c53', NULL, '{"lines": [{"qty": 3, "skuId": "c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d", "unmet": 0, "reserved": 3, "unitPriceCents": 3400}, {"qty": 2, "skuId": "5af594ee-2c50-48bc-a69f-6a4cfe83db1a", "unmet": 0, "reserved": 2, "unitPriceCents": 4200}], "minimum": "meets", "abnormal": false, "locationId": "1f1102a1-f0fd-46d0-a671-4fe1e8cbe975", "orderNumber": "NC-000002"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('7ce46d92-2271-43cf-a79a-446fd1d9aa73', '2026-09-17 06:57:18.671808-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'standing.create', 'standing_arrangement', 'efbda932-9dc7-41a0-a480-3b95be685368', NULL, '{"lines": [{"qty": 4, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100"}], "locationId": "1f1102a1-f0fd-46d0-a671-4fe1e8cbe975", "requestedCadence": "every two weeks"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('d327c03d-065a-45b3-b25d-a7c8962a5a98', '2026-09-17 06:57:18.676025-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'stripe.customer.request', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', NULL, '{"job": "queued", "jobId": "f6fdadd8-317f-4de8-956a-bc4c763fe017", "status": "pending", "providerReferenceId": "4dab0c48-f371-4626-b2e1-0daf79fa4ca0"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('2845ceba-3684-4633-99df-2370762590dc', '2026-09-17 06:57:18.676025-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'payment.request_setup', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '{"channel": "unselected", "setupState": "not_requested"}', '{"channel": "stripe_ach", "setupState": "requested", "payerContactId": "2fcddc51-7f77-4e88-916e-d086c62d1afc"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('de7bb1f9-53d0-43f7-8617-dd9f7deb57f3', '2026-09-17 06:57:18.676025-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'exception.open', 'exception_case', '1e7e6769-fd19-4ee4-b659-203c20a2e6b1', NULL, '{"title": "ACH setup pending — Mission Taproom", "category": "payment_setup_pending", "dedupeKey": "payment_setup_pending:1f1102a1-f0fd-46d0-a671-4fe1e8cbe975"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('0593a990-d1b7-4417-acb3-0336015a71c9', '2026-09-17 06:57:18.691249-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'location.billing_email.request', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '{"billingEmail": "ap@missiontaproom.demo"}', '{"state": "pending", "requested": "payables@missiontaproom.demo"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('728c254e-c1f7-4cc7-b53e-35bfa79cc552', '2026-09-17 06:57:18.694766-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', 'b681d02f-ccdf-4f97-861e-c8c8085cea9a', NULL, '{"title": "Billing-email change awaiting Admin approval — Mission Taproom", "category": "billing_email_change", "dedupeKey": "billing_email_change:13b4ef9f-5a40-4597-bb86-76f78b5c8480"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('308407bd-65d9-4c42-973c-19d76262d035', '2026-09-17 06:57:18.695748-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'order.submit', 'order', 'ceeddfa5-1b47-4020-afb0-8417e3e1fe07', NULL, '{"lines": [{"qty": 2, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100", "unmet": 0, "reserved": 2, "unitPriceCents": 3600}], "minimum": "below", "abnormal": false, "locationId": "66ba05d7-49d3-4791-9fd1-f96572ad50ce", "orderNumber": "NC-000003"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('79cc9d84-4953-4d8e-985c-e1ece3f2f82e', '2026-09-17 06:57:18.695748-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', '62d068a7-690d-437d-a894-ebb0ea5b8b56', NULL, '{"title": "NC-000003 is below the $90 minimum — Golden Gate Grill", "category": "below_minimum", "dedupeKey": "below_minimum:ceeddfa5-1b47-4020-afb0-8417e3e1fe07"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('86eb2fc1-47f0-4924-863f-4d124fe4b02a', '2026-09-17 06:57:18.709792-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'order.submit', 'order', 'af9c6654-0a88-4fd8-a914-260eca5620af', NULL, '{"lines": [{"qty": 5, "skuId": "f7402f85-342b-4cd0-a818-5bacb80c2536", "unmet": 3, "reserved": 2, "unitPriceCents": 9000}, {"qty": 2, "skuId": "c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d", "unmet": 0, "reserved": 2, "unitPriceCents": 3400}], "minimum": "meets", "abnormal": false, "locationId": "698362f0-149d-4555-bf47-ee15139929d8", "orderNumber": "NC-000004"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('e033290a-e045-43c4-ac81-1b4af7489ea2', '2026-09-17 06:57:18.709792-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', '3b56294a-fc81-4d48-9861-2f124ccfe3ce', NULL, '{"title": "Shortage on NC-000004 — Dogpatch Bottle Shop", "category": "allocation_shortage", "dedupeKey": "allocation_shortage:af9c6654-0a88-4fd8-a914-260eca5620af"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('75b81153-708f-43b7-9c0e-5ccf09c1b5cd', '2026-09-17 06:57:18.731101-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'order.change_request', 'order', 'af9c6654-0a88-4fd8-a914-260eca5620af', NULL, '{"kind": "amend_qty", "lineId": "490202e4-19ba-4d97-8a85-8c5b794b1406", "requestedQty": 4, "submittedPrice": 3400, "substituteSkuId": null, "currentMarketPrice": 3400}', 'Buyer wants two more cases if available (demo)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('93f32970-4ace-478b-b4bd-22840c9fe559', '2026-09-17 06:57:18.73611-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'exception.open', 'exception_case', '3bd9e580-b08b-41ce-a062-eb0cde80d5f8', NULL, '{"title": "Change requested on NC-000004", "category": "order_change_request", "dedupeKey": "order_change_request:a8ab1ea9-99e1-4934-95d3-588f64325139"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('32c418ad-873a-44e3-9d89-169132ff6a34', '2026-09-17 06:57:18.738652-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'hold.create', 'customer_location', 'fde86ec2-449b-42e1-a829-97c387141740', NULL, '{"kind": "compliance", "cause": "Receiving entrance unconfirmed after remodel (demo)", "holdId": "5844e23a-7d1d-4c23-b9ff-9171899c5ea7"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('bee56372-6a96-42ec-a20b-6bfcfa66024e', '2026-09-17 06:57:18.741016-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'exception.open', 'exception_case', '45220dfa-404a-451d-8b95-5374a151ca58', NULL, '{"title": "Hold (compliance) — Marina Wine & Beer", "category": "hold", "dedupeKey": "hold:5844e23a-7d1d-4c23-b9ff-9171899c5ea7"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('63866580-eee1-46fa-9f01-a91fb248f1fc', '2026-09-17 06:57:18.741931-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'order.submit', 'order', 'd1748184-9fe5-4d56-bff3-80e08d6c7881', NULL, '{"lines": [{"qty": 1, "skuId": "76ed6f7e-8d1a-4eef-be6b-9bdee31c4799", "unmet": 0, "reserved": 1, "unitPriceCents": 17500}], "minimum": "meets", "abnormal": false, "locationId": "fde86ec2-449b-42e1-a829-97c387141740", "orderNumber": "NC-000005"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('5261c0a8-b133-4717-9123-e31273054bce', '2026-09-17 06:57:18.754471-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'order.submit', 'order', '848c18a3-c4b0-46c5-84d4-c9a2a170195e', NULL, '{"lines": [{"qty": 3, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100", "unmet": 0, "reserved": 3, "unitPriceCents": 3600}], "minimum": "meets", "abnormal": false, "locationId": "eed53303-7015-452f-ae6e-795b4e5e9b99", "orderNumber": "NC-000006"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('deee5416-fb3d-4c35-bd0b-b0a250ba8f6f', '2026-09-17 06:57:18.76437-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'location.status', 'customer_location', 'eed53303-7015-452f-ae6e-795b4e5e9b99', '{"status": "active"}', '{"status": "closed"}', 'Venue closed for the season (demo)', NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('0c5227be-1bb1-4835-91e2-b58a755a2397', '2026-09-17 06:57:18.76437-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'exception.open', 'exception_case', '3315f596-a0af-426f-bb76-5904c34cdab2', NULL, '{"title": "Closure run-off review — Sunset Social Club", "category": "closure_review", "dedupeKey": "closure_review:eed53303-7015-452f-ae6e-795b4e5e9b99"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('bfcbd0d5-7994-4c77-b26f-2cb7d7c8af3f', '2026-09-17 06:57:18.769245-07', 'employee', '64587a9f-cc18-4d7e-bbb2-773be095cc20', 'order.submit', 'order', 'd5955b2d-d1ad-49aa-8340-c4bbcfda23cc', NULL, '{"lines": [{"qty": 6, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100", "unmet": 0, "reserved": 6, "unitPriceCents": 3600}, {"qty": 2, "skuId": "1e1e97bc-f89b-46ef-8797-e8a1dae400ef", "unmet": 0, "reserved": 2, "unitPriceCents": 9500}], "minimum": "meets", "abnormal": false, "locationId": "11d5ce87-8101-47d1-8de3-136bbd527609", "orderNumber": "LA-000001"}', NULL, NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('fc1a2bf2-92dc-41ae-b0d5-009ef7666ff8', '2026-09-17 06:57:18.786674-07', 'employee', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'sample.withdraw', 'sample_withdrawal', 'ee201cff-452b-4766-9316-2f9b24d5d29f', NULL, '{"qty": 2, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100", "withdrawnOn": "2026-09-15", "repEmployeeId": "9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');
INSERT INTO public.audit_event VALUES ('da85d92f-5bf6-477a-82ac-04d44bf08f12', '2026-09-17 06:57:18.791693-07', 'employee', '64587a9f-cc18-4d7e-bbb2-773be095cc20', 'sample.withdraw', 'sample_withdrawal', '192aa94e-4c51-4836-ae76-4ee2f1515d8e', NULL, '{"qty": 1, "skuId": "c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d", "withdrawnOn": "2026-09-16", "repEmployeeId": "64587a9f-cc18-4d7e-bbb2-773be095cc20"}', NULL, NULL, '6c976b6f-a023-4539-bb98-a17a3c33000e');
INSERT INTO public.audit_event VALUES ('e50ff2cc-c9f5-47fd-b17b-30f18e53b17f', '2026-09-17 06:57:18.798049-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'intake.record', 'order_intake_request', '766b2956-6628-4100-a97f-3418d3711785', NULL, '{"subject": "Beer order for Friday", "fromEmail": "buyer@northbeachpizza.demo"}', NULL, NULL, NULL);
INSERT INTO public.audit_event VALUES ('4cdab20b-fd48-4642-b31a-492b72b961c0', '2026-09-17 06:57:18.803063-07', 'employee', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'exception.open', 'exception_case', '435c1fb3-f72a-4475-91ab-c4b7bf738db6', NULL, '{"title": "Email order to review — buyer@northbeachpizza.demo", "category": "email_intake", "dedupeKey": "email_intake:766b2956-6628-4100-a97f-3418d3711785"}', NULL, NULL, 'cedd932e-f4e5-4e5d-a871-7b614335f894');


--
-- Data for Name: billing_email_change_request; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.billing_email_change_request VALUES ('13b4ef9f-5a40-4597-bb86-76f78b5c8480', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'payables@missiontaproom.demo', 'ap@missiontaproom.demo', 'sales', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.690312-07', 'pending', NULL, NULL, NULL);


--
-- Data for Name: capability_gate; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.capability_gate VALUES ('ACCESS_STABLE_IDENTITY', 'google_identity', 'Stable identity survives Google rename; reused email is a new person', 'scoped_acceptance', 'AT61: rename keeps history/grants; re-used address inherits nothing.', NULL, 1, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('ACCESS_EFFECTIVE_DISABLE', 'google_identity', 'Effective disablement stops an existing session without re-login', 'scoped_acceptance', 'AT62: disable an already-signed-in employee; next action is refused; stale Google signals cannot restore.', NULL, 1, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('STRIPE_CUSTOMER_ASSOCIATION', 'stripe', 'Location-specific Stripe customer association', 'scoped_acceptance', 'One Stripe customer per licensed location in the company account; no pooling by parent/AP.', NULL, 1, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('STRIPE_HOSTED_SETUP', 'stripe', 'Hosted ACH setup/mandate (no raw bank details internally)', 'scoped_acceptance', 'Hosted setup completes; only masked reference/status evidence retained.', NULL, 3, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('STRIPE_DELIVERY_DAY_INVOICE', 'stripe', 'Delivery-day invoice with delivery+30 due date, no early collection', 'scoped_acceptance', 'AT28/AT29/AT31.', NULL, 3, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('STRIPE_CREDIT_BALANCE', 'stripe', 'Native credit balance / credit notes, U17 application', 'scoped_acceptance', 'AT47/AT49/AT50.', NULL, 4, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('STRIPE_EXTERNAL_PARTIAL', 'stripe', 'External/partial receipt representation without overcollection', 'scoped_acceptance', 'AT37/AT38/AT40 (SD05).', NULL, 3, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_ACTUALS', 'optimoroute', 'Actual SKU accepted quantities per visit', 'must_work_before_initial_field_use', 'Multi-SKU order returns explicit accepted quantities incl. zero, associated with the correct visit.', 'Admin/Driver approved actuals record; never infer from completed stop. Admin accountable.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_PARTIAL_REFUSED', 'optimoroute', 'Partial/refused outcome', 'must_work_before_initial_field_use', 'Partial/refused/missing quantities and reasons preserve fulfilled vs residual demand; no automatic resend.', 'Admin reconciles original/actual/residual from a controlled record.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_MIXED_VISIT', 'optimoroute', 'Failed beer with successful pickup/service', 'must_work_before_initial_field_use', 'Zero beer coexists with genuine keg pickup and service completion.', 'Separate activity evidence for the same visit, reconciled by Admin.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_KEG_COUNTS', 'optimoroute', 'Keg counts and excess pickups', 'must_work_before_initial_field_use', 'Count/context recorded independently of beer status; excess recordable.', 'Driver supplies count; Admin validates attribution.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_CLEANING', 'optimoroute', 'Cleaning completed/skipped/reason/time', 'can_use_temporary_control', 'Independent outcome, time and skip reason; skipped stays due.', 'Simple checkbox/time/reason under Admin/service accountability.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_SIGNATURE', 'optimoroute', 'Normal signature', 'must_work_before_initial_field_use', 'Genuine signer evidence associated with actual receipt and retrievable afterward.', 'Source-supported paper or accepted digital process; no blanket waiver.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_PHOTOS', 'optimoroute', 'Photos', 'can_use_temporary_control', 'Driver captures photos associated with customer/order/visit/time; durable evidence.', 'Approved associated photo capture; Admin preserves custody.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_OFFLINE', 'optimoroute', 'Offline capture', 'can_use_temporary_control', 'Loss of connectivity does not fabricate receipt; later evidence keeps occurrence time.', 'Admin-approved limited outage record under D21.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_URGENT_CHANGE', 'optimoroute', 'Urgent withdrawn/changed stop', 'must_work_before_initial_field_use', 'Admin establishes current instruction, contacts driver, confirms withdrawal/change.', 'Direct driver contact and acknowledgement.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_EVIDENCE_EDITS', 'optimoroute', 'Evidence edits/history', 'must_work_before_initial_field_use', 'Original remains retrievable after edit; actor/time/reason distinguished.', 'Controlled original capture/retention with authorized corrections.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_EXPORT_EXIT', 'optimoroute', 'Historical export/retrieval and provider exit', 'must_work_before_initial_field_use', 'Original and corrected artifacts recoverable after link expiry and provider exit.', 'Company-controlled durable evidence arrangement.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_DRIVER_USABILITY', 'optimoroute', 'Driver usability', 'must_work_before_initial_field_use', 'Realistic mixed visit completed without duplicate entry or lost facts.', 'Narrow temporary missing-field capture.', 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('OR_OPTIONAL_TELEMETRY', 'optimoroute', 'Barcode / live tracking / telemetry', 'optional_enhancement', 'Demonstrate real benefit if later chosen.', NULL, 2, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('NOTICE_SINGLE_SENDER', 'gmail', 'One normal sender per notice purpose with same-obligation fallback', 'scoped_acceptance', 'AT75: for each notice type one selected sender; Gmail send result separate from business audit.', 'Authorized manual single-sender process while D32/IG04 pending.', 1, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('GOOGLE_CONTENT_RIGHTS', 'google_address', 'Permitted retention/onward use of Google-derived content', 'scoped_acceptance', 'IG05: allowed selected use established before relying on restricted content; legitimate customer facts proceed independently.', 'Omit restricted content; use customer-confirmed facts.', 1, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('QBO_MODEL', 'qbo', 'Selected posting model, no-overlap writers, manual adjustment preservation', 'scoped_acceptance', 'AT68/AT69/AT76 under the accountant-selected model (IG06).', 'Explicit interim accounting responsibility (manual/accountant).', 3, 'unproven', NULL, NULL, NULL);
INSERT INTO public.capability_gate VALUES ('SLACK_NO_MUTATION', 'slack', 'Slack cannot mutate business state; outage leaves queue usable', 'scoped_acceptance', 'AT60: delete/edit/react leaves case/audit unchanged.', NULL, 1, 'unproven', NULL, NULL, NULL);


--
-- Data for Name: cleaning_obligation; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.cleaning_obligation VALUES ('3e577c4f-c2c6-43d7-9df7-764448b56066', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'unknown', NULL, NULL, '2026-09-17 06:57:18.490445-07');
INSERT INTO public.cleaning_obligation VALUES ('ba1f900f-2270-4e48-8061-65496c5286c6', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'unknown', NULL, NULL, '2026-09-17 06:57:18.510274-07');
INSERT INTO public.cleaning_obligation VALUES ('77c6c9a3-5a95-4ad7-8865-c699a77ef9a9', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', 'unknown', NULL, NULL, '2026-09-17 06:57:18.520341-07');
INSERT INTO public.cleaning_obligation VALUES ('478d8a8c-25a2-4691-bff8-b119fd05ccd4', '698362f0-149d-4555-bf47-ee15139929d8', 'unknown', NULL, NULL, '2026-09-17 06:57:18.530376-07');
INSERT INTO public.cleaning_obligation VALUES ('892b5744-5288-4d7c-8b3e-0dedbe6307e1', 'fde86ec2-449b-42e1-a829-97c387141740', 'unknown', NULL, NULL, '2026-09-17 06:57:18.5488-07');
INSERT INTO public.cleaning_obligation VALUES ('53cb2dbc-79e6-4822-8c28-23f9b8257001', 'eed53303-7015-452f-ae6e-795b4e5e9b99', 'unknown', NULL, NULL, '2026-09-17 06:57:18.562139-07');
INSERT INTO public.cleaning_obligation VALUES ('90dbafc3-de9b-477a-9897-d86b43632e06', '11d5ce87-8101-47d1-8de3-136bbd527609', 'unknown', NULL, NULL, '2026-09-17 06:57:18.576969-07');


--
-- Data for Name: contact; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.contact VALUES ('34ff3c77-3b00-4ded-9001-8abef0a865e1', 'Jordan Buyer', 'jordan@missiontaproom.demo', NULL, '2026-09-17 06:57:18.490445-07');
INSERT INTO public.contact VALUES ('2fcddc51-7f77-4e88-916e-d086c62d1afc', 'Accounts Payable', 'ap@missiontaproom.demo', NULL, '2026-09-17 06:57:18.490445-07');
INSERT INTO public.contact VALUES ('0d12c1fb-0d32-460e-87fb-de0e898550ea', 'Casey Manager', 'casey@gggrill.demo', NULL, '2026-09-17 06:57:18.510274-07');
INSERT INTO public.contact VALUES ('40dd089c-65b0-4bf2-815a-a5887761eecf', 'Robin Owner', 'robin@gggrill-sloat.demo', NULL, '2026-09-17 06:57:18.520341-07');
INSERT INTO public.contact VALUES ('54d98684-f2d9-475b-a2eb-0f1cb551c878', 'Alex Buyer', 'alex@dogpatchbottles.demo', NULL, '2026-09-17 06:57:18.530376-07');
INSERT INTO public.contact VALUES ('2dfa5227-a111-44ff-b80a-a16750cf6ca1', 'Accounts Payable', 'ap@dogpatchbottles.demo', NULL, '2026-09-17 06:57:18.530376-07');
INSERT INTO public.contact VALUES ('3a6aad3a-7100-43cd-bcc9-2c11ef5d97d5', 'Pat Buyer', 'pat@marinawb.demo', NULL, '2026-09-17 06:57:18.5488-07');
INSERT INTO public.contact VALUES ('370cf5ec-46ac-4e9d-9d6b-a909163aeab0', 'Dana Buyer', 'dana@sunsetsocial.demo', NULL, '2026-09-17 06:57:18.562139-07');
INSERT INTO public.contact VALUES ('1b4fea94-b515-4c28-b544-563f576a5168', 'Maria Buyer', 'maria@echoparkcantina.demo', NULL, '2026-09-17 06:57:18.576969-07');
INSERT INTO public.contact VALUES ('5439ea19-7fe7-417a-9325-e90838e4fcc6', 'Accounts Payable', 'ap@echoparkcantina.demo', NULL, '2026-09-17 06:57:18.576969-07');


--
-- Data for Name: customer_location; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.customer_location VALUES ('1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'Mission Taproom', NULL, NULL, 'active', 'Deliver before 11am; ring the side bell.', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.490445-07', '2026-09-17 06:57:18.490445-07', NULL, NULL);
INSERT INTO public.customer_location VALUES ('66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'Golden Gate Grill', NULL, NULL, 'active', 'Deliver before 11am; ring the side bell.', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.510274-07', '2026-09-17 06:57:18.510274-07', NULL, NULL);
INSERT INTO public.customer_location VALUES ('4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'Golden Gate Grill', NULL, NULL, 'active', 'Deliver before 11am; ring the side bell.', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.520341-07', '2026-09-17 06:57:18.520341-07', NULL, NULL);
INSERT INTO public.customer_location VALUES ('698362f0-149d-4555-bf47-ee15139929d8', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'Dogpatch Bottle Shop', NULL, NULL, 'active', 'Deliver before 11am; ring the side bell.', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.530376-07', '2026-09-17 06:57:18.530376-07', NULL, NULL);
INSERT INTO public.customer_location VALUES ('fde86ec2-449b-42e1-a829-97c387141740', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'Marina Wine & Beer', NULL, NULL, 'active', 'Deliver before 11am; ring the side bell.', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.5488-07', '2026-09-17 06:57:18.5488-07', NULL, NULL);
INSERT INTO public.customer_location VALUES ('11d5ce87-8101-47d1-8de3-136bbd527609', '6c976b6f-a023-4539-bb98-a17a3c33000e', 'Echo Park Cantina', NULL, NULL, 'active', 'Deliver before 11am; ring the side bell.', NULL, '64587a9f-cc18-4d7e-bbb2-773be095cc20', '64587a9f-cc18-4d7e-bbb2-773be095cc20', NULL, '64587a9f-cc18-4d7e-bbb2-773be095cc20', '2026-09-17 06:57:18.576969-07', '2026-09-17 06:57:18.576969-07', NULL, NULL);
INSERT INTO public.customer_location VALUES ('eed53303-7015-452f-ae6e-795b4e5e9b99', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'Sunset Social Club', NULL, NULL, 'closed', 'Deliver before 11am; ring the side bell.', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.562139-07', '2026-09-17 06:57:18.764-07', '2026-09-17 06:57:18.764-07', 'Venue closed for the season (demo)');


--
-- Data for Name: customer_order; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.customer_order VALUES ('cb10c225-00e7-41fb-b286-5ce4c934ded3', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'NC-000001', 'sales', 'submitted', NULL, 'Regular Thursday order (demo)', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.612794-07', NULL, NULL, NULL, '0d4b1fa1-9095-4e20-a22c-458f484fa98a', false, NULL, '{"basis": "unselected", "verdict": "meets", "kegCount": 1, "candidates": {"merchandise_only": 23900, "merchandise_plus_deposits": 27400}, "depositCents": 3500, "thresholdCents": 9000, "merchandiseCents": 23900}', NULL, NULL, NULL, '2026-09-17 06:57:18.612794-07');
INSERT INTO public.customer_order VALUES ('879f3cf7-c4bf-4586-877e-e6c87cd54c53', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'NC-000002', 'sales', 'submitted', NULL, NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.640372-07', NULL, NULL, NULL, '0d4b1fa1-9095-4e20-a22c-458f484fa98a', false, NULL, '{"basis": "unselected", "verdict": "meets", "kegCount": 0, "candidates": {"merchandise_only": 18600, "merchandise_plus_deposits": 18600}, "depositCents": 0, "thresholdCents": 9000, "merchandiseCents": 18600}', NULL, NULL, NULL, '2026-09-17 06:57:18.640372-07');
INSERT INTO public.customer_order VALUES ('ceeddfa5-1b47-4020-afb0-8417e3e1fe07', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'NC-000003', 'sales', 'submitted', '2026-09-19', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.695748-07', NULL, NULL, NULL, '0d4b1fa1-9095-4e20-a22c-458f484fa98a', false, NULL, '{"basis": "unselected", "verdict": "below", "kegCount": 0, "candidates": {"merchandise_only": 7200, "merchandise_plus_deposits": 7200}, "depositCents": 0, "thresholdCents": 9000, "merchandiseCents": 7200}', NULL, NULL, NULL, '2026-09-17 06:57:18.695748-07');
INSERT INTO public.customer_order VALUES ('af9c6654-0a88-4fd8-a914-260eca5620af', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '698362f0-149d-4555-bf47-ee15139929d8', 'NC-000004', 'sales', 'submitted', NULL, NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.709792-07', NULL, NULL, NULL, '0d4b1fa1-9095-4e20-a22c-458f484fa98a', false, NULL, '{"basis": "unselected", "verdict": "meets", "kegCount": 5, "candidates": {"merchandise_only": 51800, "merchandise_plus_deposits": 69300}, "depositCents": 17500, "thresholdCents": 9000, "merchandiseCents": 51800}', NULL, NULL, NULL, '2026-09-17 06:57:18.709792-07');
INSERT INTO public.customer_order VALUES ('d1748184-9fe5-4d56-bff3-80e08d6c7881', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'fde86ec2-449b-42e1-a829-97c387141740', 'NC-000005', 'sales', 'submitted', NULL, NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.741931-07', NULL, NULL, NULL, '0d4b1fa1-9095-4e20-a22c-458f484fa98a', false, NULL, '{"basis": "unselected", "verdict": "meets", "kegCount": 1, "candidates": {"merchandise_only": 17500, "merchandise_plus_deposits": 21000}, "depositCents": 3500, "thresholdCents": 9000, "merchandiseCents": 17500}', NULL, NULL, NULL, '2026-09-17 06:57:18.741931-07');
INSERT INTO public.customer_order VALUES ('848c18a3-c4b0-46c5-84d4-c9a2a170195e', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'eed53303-7015-452f-ae6e-795b4e5e9b99', 'NC-000006', 'sales', 'submitted', NULL, NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.754471-07', NULL, NULL, NULL, '0d4b1fa1-9095-4e20-a22c-458f484fa98a', false, NULL, '{"basis": "unselected", "verdict": "meets", "kegCount": 0, "candidates": {"merchandise_only": 10800, "merchandise_plus_deposits": 10800}, "depositCents": 0, "thresholdCents": 9000, "merchandiseCents": 10800}', NULL, NULL, NULL, '2026-09-17 06:57:18.754471-07');
INSERT INTO public.customer_order VALUES ('d5955b2d-d1ad-49aa-8340-c4bbcfda23cc', '6c976b6f-a023-4539-bb98-a17a3c33000e', '11d5ce87-8101-47d1-8de3-136bbd527609', 'LA-000001', 'sales', 'submitted', NULL, NULL, '64587a9f-cc18-4d7e-bbb2-773be095cc20', '64587a9f-cc18-4d7e-bbb2-773be095cc20', '2026-09-17 06:57:18.769245-07', NULL, NULL, NULL, 'e435c069-e41b-4077-9421-e1779aef343b', false, NULL, '{"basis": "unselected", "verdict": "meets", "kegCount": 2, "candidates": {"merchandise_only": 40600, "merchandise_plus_deposits": 47600}, "depositCents": 7000, "thresholdCents": 9000, "merchandiseCents": 40600}', NULL, NULL, NULL, '2026-09-17 06:57:18.769245-07');


--
-- Data for Name: customer_parent; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: decision; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.decision VALUES ('D01', 'D', 'Second-delivery “established/run” meaning and first-allowance edge cases', 'What does "established/run" mean: valid authorization, initiated debit, or first successful payment? What is FinTech equivalence? How do partial receipt, concurrent orders, failed/cancelled/unknown attempts, remainder visits, false-receipt correction, and later revoked authorization affect the allowance?', 'First-delivery allowance and order capture before setup; second-delivery prerequisite exists.', 'Represent readiness evidence, visits and an unselected release interpretation.', 'Do not release a second delivery using an invented test or auto-consume/restore a first allowance under an unselected edge-case rule.', 'Owner with Accounting. Before affected delivery-release behavior; not account/order capture.', 'unselected', '{"fintech_equivalence": "free text", "readiness_interpretation": "one of: valid_authorization | initiated_debit | first_successful_payment", "partial_receipt_consumes_allowance": "true|false", "zero_receipt_failure_consumes_allowance": "true|false"}');
INSERT INTO public.decision VALUES ('D02', 'D', 'Serviceable location, license verification, refresh and material change', 'What establishes a legitimate serviceable location, what verification is required per market, when is it refreshed, and which identity/license changes require review? Who can resolve exceptions?', 'Company verifies required license before applicable first delivery; no resale-onboarding expansion.', 'Retain supplied/enriched evidence, market applicability and review state.', 'No invented refresh schedule, new compliance requirement or false verified status.', 'Owner with responsible compliance adviser/Admin. Before affected market/delivery verification use; ordinary capture can proceed.', 'unselected', '{"verification_required_markets": "list of market codes needing license verification before first delivery (default: all)"}');
INSERT INTO public.decision VALUES ('D03', 'D', 'Failure blocker resolution and Admin override scope/expiry', 'What resolves a failure blocker, what can Admin override, and for how long? Does a pending retry ever justify a separate override?', 'Definitive-failure causal holds, automatic valid resolution and audited Admin override.', 'Represent cause versus override and support scoped choices without a default.', 'No new named-delivery limit, expiry or mandatory second approval until chosen.', 'Owner. Before proposed override restrictions/new blocker-resolution subchoices; existing powers persist.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D04', 'D', 'Overdue-only hold and unresolved FinTech remittance', 'Does unpaid overdue debt without a definitive failure cause a hold? After what interval? How are unresolved FinTech remittances treated?', 'Confirmed failure holds and legitimate order capture continue.', 'Represent past due separately and owned follow-up.', 'No overdue-only hold from elapsed time or unmatched money alone.', 'Owner with Accounting. Only before additional overdue-hold/unselected remittance branch; ordinary collections need not wait.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D05', 'D', 'Setup/attempt review timing, retry cadence and notices', 'When should setup, missing payment attempts, aged processing, failed attempts, and retries be reviewed? How many retries, at what intervals, with what customer notice?', 'Delivery-derived terms; processing alone is not failure.', 'Track initiation/result/age and explicit review/recovery selection.', 'No invented attempt count, interval, review deadline or native setting.', 'Owner/Accounting. Before relevant collection/review/retry operation; optional recovery automation can wait.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D06', 'D', 'Payer/channel changes, revocation, FinTech readiness and allocation authority', 'Who approves payer/channel changes? What establishes FinTech readiness? How are authorization revocation, unusable methods, pending attempts, unmatched remittance, and reauthorization handled?', 'Reusable authorization, intentional location payer authority, FinTech support and existing Admin/Accounting powers.', 'Track chosen channel, intended scope, old attempts, receipt evidence and pending change.', 'No transfer of in-flight collection, unproved cancellation, cross-location mandate reuse or invented FinTech readiness.', 'Owner with Admin/Accounting. Before affected payer/channel/authorization change or receipt application.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D07', 'D', 'Identity/address/operator change, duplicates, inactivity and closure', 'Which address/identity edits are routine? When is a new location/operator required? How are true duplicates, inactive accounts, closures, and remaining obligations handled?', 'Separate locations, legitimate matching names, retained old obligations and permitted routine edits.', 'Retain identity history, suspected duplicate and lifecycle requests with linked balances.', 'No silent operator merge, debt/credit transfer, standing closure behavior or reopening clearance.', 'Owner/Admin with Accounting where obligations change. Before affected lifecycle change; initial ordinary capture can proceed.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D08', 'D', 'Employee/customer/market visibility and authority boundaries', 'Which people may order, see invoices, view balances, authorize payment, or access several locations? What are regional Sales visibility limits and field edit/approval boundaries?', 'Five roles, current internal authorization, stable identity, shared contact is not broad authority.', 'Build employee grants/market scope and authorized contact associations; preserve deferred customer boundary.', 'No inferred cross-location/customer access or invented role restriction.', 'Owner/Admin. Employee authorization before use; broader customer-access choices deferred to phase 5.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D09', 'D', 'Ambiguous intake, duplicate demand and abnormal-order criteria', 'Who handles unclear order email, which facts are required to accept it, and when should suspected duplicate demand be confirmed? What is the abnormal-order threshold?', 'Minimal 24/7 intake, no name block, receipt is not a date promise.', 'Retain source requests and distinguish identifiable demand from incomplete inquiry.', 'No numeric abnormal threshold, unjustified rejection or guessed duplicate-cancellation decision.', 'Admin under Owner policy. Before affected ambiguous-intake/flagging behavior; technical intake support can proceed.', 'unselected', '{"abnormal_max_line_qty": "integer, absolute per-line quantity above which an order is flagged", "abnormal_max_order_units": "integer, total units above which an order is flagged"}');
INSERT INTO public.decision VALUES ('D10', 'D', 'Order amendment/cancellation and extra/substitute handover authority', 'Who may amend/cancel before scheduling, after commitment, or after loading? Who authorizes additional/substitute handover?', 'Actuals and history retained; Driver has no implicit commercial power.', 'Support staged change requests and consequences.', 'No new cancellation/substitution/overdelivery authority.', 'Owner/Admin. Before the affected amendment or extra/substitute handover branch.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D11', 'D', '$90 minimum value basis, combination, below-minimum and exemptions', 'What value counts toward $90; can orders combine by visit; may below-minimum demand be submitted pending consolidation; what exceptions cover shortages/replacements/service/pickup?', '$90 per location/delivery; no billing undelivered goods; nonsale tasks create no fee.', 'Retain component values and explicit unselected minimum basis/exemption.', 'No merchandise-only/deposit/credit basis, order-combination or below-minimum acceptance default.', 'Owner. Before affected minimum/release behavior, not unrelated account creation.', 'unselected', '{"value_basis": "one of: merchandise_only | merchandise_plus_deposits | merchandise_less_credits", "combine_same_visit": "true|false", "below_minimum_pending": "true|false"}');
INSERT INTO public.decision VALUES ('D12', 'D', 'Price commitment, later changes, standing/substitute/archived commitments', 'When is price committed; how are new quantities, edits, reorders, standing orders, market changes, substitutions, and accepted orders for a later-archived product handled? Is any Admin commercial exception authorized?', 'Fixed SKU/market prices; no Sales override; internal catalog master.', 'Retain price/change context and proposed commitment support.', 'No assumed price lock, repricing, standing/addition/substitution rule or unrestricted Admin override.', 'Owner. Before affected price-commitment/change branch.', 'unselected', '{"price_commitment": "one of: submitted_price_locked | current_price_at_delivery", "added_quantity_pricing": "one of: submitted_price | current_price"}');
INSERT INTO public.decision VALUES ('D13', 'D', 'Standing-order cadence, horizon, pause/skip/end, authorization and notices', 'What standing-order cadence, generation horizon, pause/skip/end, authorization, and price-change notice apply? How do hold/inactivity affect generation?', 'Standing orders required as internal demand; submitted occurrences follow ordinary allocation.', 'Support arrangements and occurrences without an active cadence/horizon.', 'No invented recurrence, pause/skip/end, held-generation or notice policy.', 'Owner/Admin. Before standing generation activates; ordinary orders proceed independently.', 'unselected', '{"cadence_days": "integer days between occurrences (one occurrence per current cycle; never generated ahead)", "generate_when_held": "true|false"}');
INSERT INTO public.decision VALUES ('D14', 'D', 'Reservation release/expiry, reallocation and restored priority', 'How long can blocked/far-future orders reserve stock? Who may reallocate, how is displaced demand informed, and what priority returns after release? What is routine allocation oversight?', 'Submission allocation generally first-come-first-served; Admin exceptions; shortages retained.', 'Track commitments, age, displacement and explicit release choice.', 'No automatic expiry, lost demand or default restored priority.', 'Owner/Admin. Before proposed release/priority behavior; original allocation can operate.', 'unselected', '{"reservation_review_days": "integer days after which a blocked reservation is reviewed (not auto-released)"}');
INSERT INTO public.decision VALUES ('D15', 'D', 'Partial/split/repeated attempts, residual defaults and invoice grouping', 'How are partial/split deliveries, retained shortages, refusals, repeated attempts, and same-visit multi-order invoices handled?', 'Bill accepted actuals/date; retain demand and each attempt.', 'Represent quantities, attempt history, residual options and invoice associations.', 'No automatic refusal reshipment, invented cancellation or multi-date/grouped invoice rule.', 'Owner/Admin/Accounting. Before affected partial/split/residual/grouping branch.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D16', 'D', 'Stock/custody accountability, evidence, cadence and tolerances', 'Who confirms starting stock, receipts, samples, loads, transfers, returns, inspection, adjustments, and route close? What count/reconciliation cadence, tolerances, and stock freshness display apply?', 'Allocation-oriented stock, sample consumption, Admin warehouse override and no damaged sellable stock.', 'Capture credible physical evidence and difference reconciliation.', 'No invented count frequency/tolerance, new fulfillment staff or unsupported stock release.', 'Admin with fulfillment partners. Before relevant live stock/custody operation; unused transfer/inspection branches need not block others.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D17', 'D', 'Keg return validity, foreign/excess/legacy attribution and aging', 'What makes a keg return valid? How are excess/foreign/misattributed/full/sample kegs and legacy opening counts/deposits handled? What aging method and bands apply?', '$35/count-based custody; every pickup recordable; no unsupported credit or unexplained negative balance.', 'Separate observation, receiving custody, location attribution, opening evidence and entitlement.', 'No invented foreign/legacy/sample/full-keg credit validity or aging convention.', 'Owner/Admin with Accounting. Validity before the relevant keg branch; optional aging bands/method can wait.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D18', 'D', 'Credit disputes/errors, used-credit correction and exceptional disposition (timing resolved by U17)', 'Timing resolved by owner U17: available credit applies to the next finalized invoice; no same-return-delivery exclusion. Remaining choices: disputed credit, erroneous posted/used credit, pooled-credit source attribution, unused excess, closure, exceptional refund/transfer/expiry, and legacy entitlement.', 'U17 next-finalized timing already settled; preserve unused value and no ordinary cash refund.', 'Track entitlement, actual Stripe posting/use/reversal and exceptional disposition request.', 'No expiry, transfer, refund, consumed-credit recovery or optional source-attribution convention by default.', 'Owner/Accounting. Before affected exceptional credit/disposition behavior; normal valid U17 application proceeds.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D19', 'D', 'Scheduling delegation, cutoffs, capacity, driver reorder and notifications', 'May routine scheduling occur within Admin-approved rules? What route capacity, cutoff, stop duration, calendar, driver reorder, and notification rules apply?', 'Admin scheduling authority, receiving restrictions and distinct plan/commitment/live assignment.', 'Support tentative/released work, constraints and changed-stop awareness.', 'No independent automatic schedule authority, cutoff or driver-reorder freedom until selected.', 'Owner/Admin. Before affected delegated scheduling/release behavior; unapproved optional tracking can wait.', 'unselected', '{"delegated_scheduling": "true|false"}');
INSERT INTO public.decision VALUES ('D20', 'D', 'Signature combination, missing-signature remedy and photo enforcement', 'Which physical/digital signature combination satisfies receipt? Is photo capture mandatory per stop, and what does missing photography block? Who may authorize a missing-signature exception, and how is actual already-unsigned handover resolved?', 'Normal signature, photo capability, truthful actuals and durable evidence.', 'Record evidence availability/versions and missing-signature exception.', 'No blanket signature waiver, universal photo block or invented paper/digital equivalence.', 'Owner/Admin. Before chosen receipt-evidence path; unusual exception remains unresolved until authorized.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D21', 'D', 'Temporary evidence/actions during unavailable handoffs and outage recovery', 'During unavailable field/billing/payment handoffs, what temporary evidence and actions are allowed, who owns recovery, and when is a repeat action permitted?', 'Unknown is not failure; confirmed facts persist; consequential effects not blindly repeated.', 'Support pending handoff, evidence and restoration reconciliation.', 'No unapproved manual substitute action, second provider or custom offline system.', 'Admin/Accounting under Owner policy. Before relying on a temporary/provider-dependent recovery path; unrelated preparation proceeds.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D22', 'D', 'Instant physical invoices, evidence exceptions and late first issue', 'How are instant physical invoices provided? What invoice-evidence issues pause finalization? What happens when an invoice is first issued after its due date?', 'Stripe delivery-day invoice and original delivery-plus-30 due date.', 'Track readiness/late issue, original dates and physical document demand.', 'No surprise late debit, due-date reset, planned morning invoice or signature bypass.', 'Owner/Accounting/Admin. Before affected instant-paper/late/evidence-exception invoicing branch.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D23', 'D', 'Stage-specific correction completion and late-evidence remedies', 'What closes a correction before billing, after issuance, during collection, after payment/period close, or after a credit was used on a later invoice? How are uncertain cancellation and late contradictory evidence handled?', 'Admin correction authority, preserved history, actual payment stage and one effect.', 'Link affected consequences and show unfinished remedy.', 'No unproved cancellation, unsupported financial reopen or auto-debit for invalidated used credit.', 'Owner/Accounting/Admin. Before affected correction execution; keep established facts while remedy waits.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D24', 'D', 'Product issue/replacement/goodwill remedy components and containment', 'What remedy components are authorized for product issues, replacement, goodwill, or dispute; what deposit/minimum treatment applies; who approves containment and release?', 'Source-authorized credits, no mandatory issue photo, no normal cash refund.', 'Represent physical/financial/remedy components independently.', 'No inferred refund/replacement/deposit/minimum waiver or unapproved containment release.', 'Owner/Admin/Accounting with quality contact. Before relevant product issue/replacement/concession branch.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D25', 'D', 'Partial/disputed/credited/excess/reversed financial treatment', 'How are partial payments, disputes, full credit, zero-payable invoices, excess cash, credit during processing, reversals, late corrections, and closed periods treated? Is disputed collection paused or continued, and on which amount?', 'Exact residual, actual receipt basis, no zero-payable debit, no duplicated collection.', 'Represent disputed/undisputed amounts and conditional supported remedy.', 'No silent dispute pause/continuation, partial/excess allocation, reversal or closed-period treatment.', 'Owner/Accounting and company accountant. Before affected financial branch; accountant selections for accounting effects.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D26', 'D', 'Cleaning baseline, scope, applicability and escalation', 'What starts the location cleaning clock; what normal work is applicable; how are incomplete, skipped, external, or no-longer-applicable work resolved; when do overdue/skip cases escalate?', 'Approximate biweekly simple cleaning, skip remains due, no automatic dedicated trip.', 'Track applicable task, baseline pending, completion/skip/reason/history.', 'No invented baseline/scope/external reset or numeric overdue escalation.', 'Owner/Admin/service lead. Before relevant service clock/remedy operates; unrelated beer work independent.', 'unselected', '{"cleaning_interval_days": "integer"}');
INSERT INTO public.decision VALUES ('D27', 'D', 'Exception severity, review timing, backups and escalation', 'What exception categories/severity, next-action deadlines, backups, escalation, and review cadence are appropriate?', 'One exception model, current business state, meaningful communication and retained history.', 'Support lead/next-action/review/severity choices without numeric defaults.', 'No adopted SLA, escalation deadline or new approval/hire.', 'Owner/Admin/Accounting. During affected module work, settled before reliance on its exception operating rule.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D28', 'D', 'New permission restrictions, thresholds or second approvals', 'Which sensitive actions require evidence, targeted review, or new permission limits? Should source-authorized Admin FinTech confirmation/reconciliation be narrowed in any way?', 'Existing Owner/Admin/Accounting/Sales/Driver powers remain.', 'Apply known permissions and retain audit; support explicit later changes.', 'No narrowing Admin FinTech/credit rights, universal dual approval or new threshold.', 'Owner. Only before a proposed new restriction; can remain unselected.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D29', 'D', 'Reconciliation cadence, tolerance, aggregation and escalation', 'What reconciliation cadence, evidence, tolerance, aggregate accounting method, and unresolved-difference escalation apply?', 'Formal QBO, Stripe financial truth, one writer and transaction drill-through.', 'Support automatic matching, differences and source-to-posting associations.', 'No selected accounting aggregation/classification/cadence/tolerance by implementation.', 'Accounting with Admin and accountant. Before relevant posting/reconciliation/close reliance; no whole-project gate.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D30', 'D', 'Phase live scope, opening balances, cutoff and temporary responsibility', 'Which phases may operate live, with what temporary responsibilities, opening balances, cutover date, and acceptance outcomes?', 'Six phases; preserve history; no duplicate opening economics.', 'Prepare scoped migration inventory, comparisons and reversible technical work.', 'No assumed live cutoff, accepted opening estimates or two competing live processes.', 'Owner with Admin/Accounting. Before each affected live cutover; later phases need not be decided now.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D31', 'D', 'Metric definitions and historical attribution meaning', 'What exactly are sales, active/dormant accounts, lifetime account value, attribution, and automation success? How are corrections, credits, samples, deposits, and dates counted?', 'Reporting/automation measures and historical/current attribution must be supported.', 'Retain event/date/source dimensions and definitions marked unselected.', 'No invented revenue/value/dormancy/automation formula presented as approved.', 'Owner/management with Accounting. Before using the affected metric as an authoritative report.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D32', 'D', 'Notice recipients, sender allocation, essential-failure handling and Slack routing', 'Who receives each order/schedule/invoice/payment/correction notice, which changes warrant notice, and what happens if delivery of an essential notice fails? Which Slack channels own categories?', 'Required receipt/schedule/invoice/payment outcome notices; one normal purpose/sender; Slack not business state.', 'Build notice intent/evidence and the proposed matrix as unselected choices.', 'No activation of section 42''s allocation, recipients, optional ETA or escalation by silence.', 'Owner/Admin/Accounting. Before affected automated notice/alert policy; authorized existing/manual single sender can continue.', 'unselected', '{"sender_allocation": "object purpose -> gmail|stripe_native"}');
INSERT INTO public.decision VALUES ('D33', 'D', 'Global policy vs market configuration, selling entity, local dates and compliance', 'What is global policy versus market configuration, who is the selling/invoicing entity, what local dates/calendars apply, and who approves applicable invoice/compliance treatment?', 'Confirmed global defaults, internal market policy, Stripe issuer/QBO GL.', 'Represent seller/market/date associations and approved applicability.', 'No inferred entity, legal rule, market exception, classification or Connect purchase.', 'Owner with appropriate advisers. Before relevant market/financial activation.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D34', 'D', 'Durable evidence arrangements and retention/access policy changes', 'How are originals/current documents distinguished, access retained after provider exit, and any later retention-policy change approved?', 'Generally indefinite original/corrected business evidence and restricted-provider-content distinction.', 'Implement durable permitted retrieval and role-limited history with ordinary technical choice.', 'No deletion/retention-policy change or assumption temporary URLs satisfy custody.', 'Owner/Admin/Accounting. Custody/rights before evidence reliance; later policy change can remain deferred.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('D35', 'D', 'Timing of capacity analysis, FinTech automation and management controls', 'When should capacity analysis, further FinTech automation, or additional management controls be added?', 'Current scope/low-friction principle; future changes need demonstrated value.', 'Preserve clean boundaries and existing useful event history.', 'No speculative forecasting, new controls or automatic FinTech matching.', 'Owner/management. Safely deferred to justified enhancement decision.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD01', 'SD', 'Day-30 initiation calendar and late invoice treatment', 'Exact day-30 initiation/calendar and late invoice treatment', 'Due date is actual delivery +30; no automatic early collection or date reset.', 'Support separate due/initiation dates and late-issue exception.', 'Do not choose banking-calendar shifts or overdue first-issue notice/debit policy.', 'Owner/Accounting. Before that collection/late-issue branch; D05/D22/D33.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD02', 'SD', 'Native one-off ACH recovery adoption', 'Adoption of native one-off ACH recovery', 'No competing collection, no retry-created debt, existing failure remains until resolved.', 'Expose actual eligible native recovery/attempt state.', 'Do not enable native retries or choose count/cadence from provider defaults.', 'Owner/Accounting. Before recovery automation; D05, not ordinary invoice issue.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD03', 'SD', 'ACH portal scope and customer surface', 'ACH portal scope and customer surface', 'Hosted payment credentials/mandates stay with Stripe; first delivery may precede setup.', 'Build demonstrated necessary transactional hosted setup/document access.', 'No assumed universal ACH portal management or broader customer surface.', 'Admin/Accounting. Setup gate before use; portal/access design deferred; D08/IG10.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD04', 'SD', 'Financial invoice numbering scheme', 'Financial invoice numbering scheme', 'Stripe owns financial invoice number; internal market order number remains distinct.', 'Support native number/reference display and retained financial documents.', 'No second number issuer or assumed business numbering convention.', 'Accounting/Owner. Before selected invoice issuance scheme; Accounting/Owner with D33.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD05', 'SD', 'Partial external payment and bulk-remittance representation', 'Partial external payment and bulk-remittance representation', 'One actual external receipt, exact residual and no overlapping collection.', 'Support receipt evidence/allocation references and capability demonstration.', 'No false fully-paid status/fictitious credit; no residual fallback with stale payable routes.', 'Accounting/Owner. Before affected external partial/bulk application; D06/D25/IG09.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD06', 'SD', 'Credit dispute/error while funds already available or applied', 'Credit dispute/error while funds are already available or applied', 'U17 actual available/application; no erased history or internal credit reservation.', 'Track source entitlement, posting/use and pending dispute/error remedy.', 'No unapproved consumed-credit recovery, source-consumption convention or closure disposition.', 'Owner/Accounting. Before relevant recovery; D18/D23–D25.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD07', 'SD', 'Supported post-payment reopening, unapplication and correction routes', 'Supported post-payment reopening, unapplication and correction routes', 'Preserve original paid/closed financial evidence and actual cash.', 'Represent correction intent/stage and supported linked remedy acceptance.', 'No universal paid reopen, unapplication of real cash to mimic reversal or invented adjustment.', 'Accounting/accountant. Before affected correction; D23/D25; accountant approves treatment.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD08', 'SD', 'Review timing and escalation for unknown/stuck finance', 'Review timing and escalation for unknown/stuck finance', 'Unknown stays owned; expected processing age is not failure.', 'Support last-known evidence, owner and unselected review/escalation points.', 'Do not adopt suggested immediate/same-day/daily/next-business-day windows.', 'Owner with Accounting/Admin. During financial module before reliance on review process; D21/D27/D29. IG08 only for actual temporary control.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD09', 'SD', 'Customer financial notices and collection permissions during disputes', 'Customer financial notices and collection permissions during disputes', 'One intended notice/purpose; operational explanation separate; no guessed dispute collection.', 'Keep section 42 sender matrix explicit and unselected.', 'No broad Stripe-standard-message override of matrix; neither dispute pause nor continuation selected.', 'Owner/Accounting. Before affected automatic sender/dispute branch; D25/D32/IG04.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('SD10', 'SD', 'Financial launch acceptance for account-specific capabilities', 'Financial launch acceptance for account-specific capabilities', 'Financial facts, evidence and one intended effect remain correct.', 'Demonstrate only native/temporary capabilities the launch population uses.', 'No optional portal/retry capability as universal launch requirement; no unproved exception path.', 'Owner/Admin/Accounting. Before affected financial branch; D30/IG09.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T01', 'T', 'Stripe process responsibility and supported collection/setup choices', 'Stripe process responsibility narrowed in S02/S03/S06; exact supported collection/setup choices remain deferred, with day-30 timing and reusable authorization preserved', 'Reusable ACH, delivery-derived terms and native financial boundaries.', 'Choose ordinary supported client/plumbing; preserve readiness and collection distinction.', 'No selection of D01/D05/D06/D25 business answers.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical work during implementation; business gates only before relevant use.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T02', 'T', 'ACH authorization wording and customer authorization experience', 'Exact ACH authorization wording and supported customer authorization experience', 'Stripe hosts genuine authorization; internal does not collect raw bank credentials.', 'Use supported hosted authorization experience and necessary evidence references.', 'No invented mandate scope/wording or customer payer authority.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Before selected authorization path; D01/D06 and setup acceptance.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T03', 'T', 'OptimoRoute plan/capability fit and handoff acceptance', 'Original routing/POD selection question narrowed: OptimoRoute is the current provider; plan/capability fit and business handoff acceptance remain open. Optional live driver location remains optional.', 'OptimoRoute current field/routing provider; internal controls release/actuals.', 'Demonstrate fit and choose ordinary handoff mechanics.', 'No presumed Custom purchase, substitute provider or optional tracking activation.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Affected field capability before reliance; live tracking can defer; D19–D21.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T04', 'T', 'Physical vs digital receipt/signature and instant physical invoice', 'Physical-versus-digital receipt/signature procedure and instant physical invoice arrangement', 'Required signature, no-price physical-capable BOL and Stripe actual invoice.', 'Support physical/digital evidence associations and retained documents.', 'No signature waiver or planned-quantity financial invoice.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Selected receipt/instant-paper path before use; D20/D22.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T05', 'T', 'Allocation presentation, availability display and physical reconciliation', 'Exact automatic-allocation versus Admin-confirmation presentation, salesperson availability display, and physical reconciliation procedure', 'Allocation at submission, generally FCFS; Admin exceptions; customers do not see stock counts.', 'Choose practical display/technical realization within known permissions.', 'No new manual confirmation requirement or changed allocation/cadence policy.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical presentation during implementation; substantive D14/D16 rules before use.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T06', 'T', 'Market numbering syntax and standing-order controls/presentation', 'Final market numbering syntax and standing-order controls/presentation', 'Unique market order reference and internal standing demand.', 'Choose ordinary internal identifier/display syntax consistent with market uniqueness; support unselected recurrence.', 'No invented standing cadence, invoice grouping or commercial numbering requirement.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical syntax during implementation; linked business choices D09/D13/D15 remain scoped.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T07', 'T', 'Detailed role capabilities, regional visibility and parent presentation', 'Detailed role capabilities/field permission matrix, regional visibility, and parent-account presentation', 'Exactly five roles, existing powers and no implicit parent/contact authority.', 'Implement known permissions and ordinary presentation.', 'No new role, visibility grant or restriction answering D07/D08/D28 by default.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Affected access before use; future customer surface deferred.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T08', 'T', 'Secure magic-link and short-link mechanism (deferred)', 'Secure magic-link and short-link mechanism', 'Memorable links are not sole credentials; broader customer access deferred.', 'Preserve boundary; necessary hosted financial documents remain separate.', 'Do not build/select customer magic-link/portal security model now.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Future phase 5; D08/IG10.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T09', 'T', 'QuickBooks detail/aggregation/synchronization and accountant treatment', 'Exact QuickBooks detail/aggregation/synchronization approach and accountant-approved AR, clearing, fee, deposit, settlement, and credit treatment', 'QBO formal GL, accountant treatment, one writer and source detail.', 'Build reasonable source-to-accounting support and demonstration for eventual selection.', 'No summary/detail/connector/divided model or accounting classification by default.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Posting activation requires D25/D29/IG06; technical means alone do not need owner choice.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('T10', 'T', 'Physical data structure and technical realization of corrections', 'Physical data structure and exact exception/interface arrangements; technical realization of approved correction consequences', 'Preserve approved correction consequences, audit and exception ownership.', 'Choose database/interface/identifier/technical representation within this brief.', 'Do not treat technical schema choices as new owner decisions or use them to settle D23/D27.', 'Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical choices during implementation; business branches follow existing gates.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG01', 'IG', 'OptimoRoute capability/plan fit (D19–D21, §49)', 'OptimoRoute capability/plan fit; D19–D21; section 49', 'OptimoRoute executes; internal owns accepted operational facts.', 'Demonstrate applicable section 49 workflows and a narrow permitted capture alternative.', 'Do not rely on unproved actuals/mixed results or choose Custom from assumption.', 'Admin; Owner for actual purchase. Only affected field reliance; D19–D21/T03; Admin demonstrates, Owner purchase if needed.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG02', 'IG', 'POD durable custody and provider-exit arrangement (D20/D34)', 'POD durable custody and provider-exit arrangement; D20/D34', 'Retain durable original/corrected evidence, associations and provider-exit retrieval.', 'Choose technical custody/storage and demonstrate retrieval under stated business rights.', 'No URL-only retention or unestablished original labelled original.', 'Owner/Admin; existing custodian function. Before evidence-path reliance; D20/D34; existing-role custodian assignment, no new role.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG03', 'IG', 'Employee disablement, lifecycle freshness and session/outage policy (D08/D21)', 'Employee disablement, lifecycle freshness and bounded session/outage policy; D08/D21', 'Google authenticates; internal grants/revokes; known disable stops existing-session business use.', 'Implement effective revocation and stable actor identity; choose compliant session mechanics.', 'No invented session duration/stale-access policy or automatic group grants.', 'Owner/Admin access function. Employee access launch; D08/D21; Owner/Admin substantive policy, not technical session approval.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG04', 'IG', 'Single financial/operational sender allocation (D32/SD09)', 'Single financial/operational sender allocation in section 42 and actual sender coverage; D32/SD09', 'Required business notice, one normal sender and retained intent/outcome.', 'Build matrix/transport evidence without selecting policy.', 'Do not activate unapproved duplicate/parallel normal sends.', 'Owner/Admin/Accounting. Affected automated branch; D32/SD09; mailbox mechanics during implementation.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG05', 'IG', 'Permitted retention/onward use of Google-derived content (D02/D07/D34)', 'Permitted retention/onward use of selected Google-derived content; D02/D07/D34', 'Legitimate business facts retained; raw provider rights remain separate.', 'Establish allowed selected use or omit restricted content and use legitimate independent facts.', 'No unrestricted raw retention/coordinate forwarding or data laundering.', 'Owner with appropriate terms advice; Admin. Only affected Google content retention/use; D02/D07/D34.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG06', 'IG', 'QBO posting model, writer assignment and cutover (D25/D29/D30/D33)', 'QBO posting model, writer assignment and accounting treatment/cutover; D25/D29/D30/D33', 'Accountant model/classification, Stripe truth/QBO GL, one accounting writer.', 'Support alternatives/demonstration and opening comparisons.', 'No accounting posting or connector overlap before model/writer selection.', 'Accountant/Owner; Accounting. Posting module activation; D25/D29/D30/D33/T09.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG07', 'IG', 'Slack destinations, coverage, urgency and escalation (D27/D32)', 'Slack destinations, existing-role coverage, meaningful urgency and escalation; D27/D32', 'Actionable Slack/daily summaries; internal queue owns case; direct urgent contact remains possible.', 'Assign practical channels/coverage within existing roles under selected notification scope.', 'No new hold/service rule or complex interaction requirement.', 'Admin/Accounting. During module work before relying on alerts; D27/D32. Interactivity deferred.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG08', 'IG', 'Selected temporary field/outage controls (D20/D21/D27)', 'Selected temporary field/outage controls; D20/D21/D27', 'Temporary controls preserve actual facts/authority and reconcile restoration.', 'Prepare narrow affected control and backlog reconciliation.', 'No use of unapproved workaround or blanket backup system.', 'Admin/Accounting under existing authority. Only before use of that temporary control; D20/D21/D27.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG09', 'IG', 'Account-specific Stripe exceptions/recovery readiness (SD01–SD10)', 'Account-specific Stripe exceptions/recovery readiness; SD01/SD02/SD05/SD06/SD07/SD10', 'Exact financial outcome/residual, one collector, retained correction history.', 'Demonstrate affected timing/retry/partial/note/correction recovery.', 'No financial branch relying on unsupported remedy or unselected commercial policy.', 'Accounting; Owner for business choices. Only relevant financial branch; SD01/SD02/SD05–SD07/SD10.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG10', 'IG', 'Customer portal, magic-link and broader customer-access design (T08/D08/SD03)', 'Customer portal, magic-link and broader customer-access design; T08/D08/SD03', 'Customer access remains future; current hosted setup/documents allowed.', 'Preserve location/contact authority boundaries without broader customer UI.', 'No portal/magic-link choice or build by inclusion.', 'Owner/Admin/Accounting. Safely deferred to phase 5; T08/D08/SD03.', 'unselected', NULL);
INSERT INTO public.decision VALUES ('IG11', 'IG', 'Optional scales/thresholds, Groups, scanning/tracking, dedicated email vendor', 'Optional scales/thresholds, Groups, advanced fields/scanning/tracking, dedicated email vendor', 'Current low-volume/proportionate stack and five roles.', 'Retain enough current history to evaluate actual future need.', 'No automatic threshold/Groups/scanning/tracking/advanced-field/email-vendor adoption.', 'Existing owner for affected function. Safely deferred until demonstrated benefit; D35 and related D27/D32 choices.', 'unselected', NULL);


--
-- Data for Name: decision_selection; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: delivery_visit; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.delivery_visit VALUES ('fcc1d0a8-65c3-4e4d-a39c-04b4853ae28c', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '2026-09-04', 'accepted', 23900, 1, '{"demo": true, "note": "phase-2 skeleton record so D01 shows as unresolved"}', '2026-09-17 06:57:18.637841-07');


--
-- Data for Name: delivery_visit_line; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.delivery_visit_line VALUES ('db3aada0-ca71-4f7b-a9a0-ecf61747abc8', 'fcc1d0a8-65c3-4e4d-a39c-04b4853ae28c', 'cb10c225-00e7-41fb-b286-5ce4c934ded3', 'd3fd8770-7f0d-47f1-a5e6-0f97a97a9c38', 4, 4, NULL, NULL, NULL, NULL);


--
-- Data for Name: employee; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.employee VALUES ('0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'Demo Owner', true, NULL, NULL, NULL, '2026-09-17 06:57:18.29939-07');
INSERT INTO public.employee VALUES ('a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'Ada Admin', true, NULL, NULL, NULL, '2026-09-17 06:57:18.321036-07');
INSERT INTO public.employee VALUES ('54c7b5e9-ab99-448c-9ec0-74354e40ea84', 'Al Accounting', true, NULL, NULL, NULL, '2026-09-17 06:57:18.334756-07');
INSERT INTO public.employee VALUES ('9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'Sam Sales (NC)', true, NULL, NULL, NULL, '2026-09-17 06:57:18.342029-07');
INSERT INTO public.employee VALUES ('64587a9f-cc18-4d7e-bbb2-773be095cc20', 'Lee Sales (LA)', true, NULL, NULL, NULL, '2026-09-17 06:57:18.351499-07');
INSERT INTO public.employee VALUES ('67ec2967-5872-4cc3-a8c6-c7fdfbf7c8d4', 'Dee Driver', true, NULL, NULL, NULL, '2026-09-17 06:57:18.360091-07');


--
-- Data for Name: employee_identity; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.employee_identity VALUES ('01dbd24d-55f1-44c1-a433-a4747c0cd39e', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', NULL, 'owner@demo.local', true, '2026-09-17 06:57:18.300813-07', NULL, NULL);
INSERT INTO public.employee_identity VALUES ('a254ee50-6891-4f92-bbea-bf3abf737fa7', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', NULL, 'admin@demo.local', true, '2026-09-17 06:57:18.32154-07', NULL, NULL);
INSERT INTO public.employee_identity VALUES ('4694c236-2bce-4150-8c94-769b5e985e72', '54c7b5e9-ab99-448c-9ec0-74354e40ea84', NULL, 'accounting@demo.local', true, '2026-09-17 06:57:18.335411-07', NULL, NULL);
INSERT INTO public.employee_identity VALUES ('567f447b-cb36-41cb-bcfc-77a963b7ac53', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', NULL, 'sales-nc@demo.local', true, '2026-09-17 06:57:18.342545-07', NULL, NULL);
INSERT INTO public.employee_identity VALUES ('d1bfe71d-ea25-4296-87f3-456c85fbdeec', '64587a9f-cc18-4d7e-bbb2-773be095cc20', NULL, 'sales-la@demo.local', true, '2026-09-17 06:57:18.35208-07', NULL, NULL);
INSERT INTO public.employee_identity VALUES ('ac637b22-14b9-4c12-b6a8-11f702ce6bb5', '67ec2967-5872-4cc3-a8c6-c7fdfbf7c8d4', NULL, 'driver@demo.local', true, '2026-09-17 06:57:18.360627-07', NULL, NULL);


--
-- Data for Name: exception_case; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.exception_case VALUES ('772bafea-c8be-48bf-8c17-5ebeec8c1eab', 'license_unverified', 'License verification pending — Golden Gate Grill', 'New location created; company verifies license internally before first delivery where applicable (O07).', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'open', NULL, 'admin', NULL, 'Locate and verify the license; record the decision on the location.', NULL, NULL, NULL, 'license_unverified:66ba05d7-49d3-4791-9fd1-f96572ad50ce', NULL, NULL, NULL, '2026-09-17 06:57:18.510274-07', '2026-09-17 06:57:18.510274-07');
INSERT INTO public.exception_case VALUES ('c3aff6ae-75b9-490c-ab6f-4575b1eadcda', 'license_unverified', 'License verification pending — Golden Gate Grill', 'New location created; company verifies license internally before first delivery where applicable (O07).', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', 'open', NULL, 'admin', NULL, 'Locate and verify the license; record the decision on the location.', NULL, NULL, NULL, 'license_unverified:4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', NULL, NULL, NULL, '2026-09-17 06:57:18.520341-07', '2026-09-17 06:57:18.520341-07');
INSERT INTO public.exception_case VALUES ('3c8dc440-6b28-40cf-9a90-2869c0a5d313', 'license_unverified', 'License verification pending — Sunset Social Club', 'New location created; company verifies license internally before first delivery where applicable (O07).', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'eed53303-7015-452f-ae6e-795b4e5e9b99', 'open', NULL, 'admin', NULL, 'Locate and verify the license; record the decision on the location.', NULL, NULL, NULL, 'license_unverified:eed53303-7015-452f-ae6e-795b4e5e9b99', NULL, NULL, NULL, '2026-09-17 06:57:18.562139-07', '2026-09-17 06:57:18.562139-07');
INSERT INTO public.exception_case VALUES ('9dbee0b5-6360-49d1-89d1-685674922f08', 'license_unverified', 'License verification pending — Mission Taproom', 'New location created; company verifies license internally before first delivery where applicable (O07).', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'resolved', NULL, 'admin', NULL, 'Locate and verify the license; record the decision on the location.', NULL, NULL, NULL, 'license_unverified:1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'License verified', '2026-09-17 06:57:18.594-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.490445-07', '2026-09-17 06:57:18.490445-07');
INSERT INTO public.exception_case VALUES ('38f1cb7b-d2a2-4b3b-9a39-5b01a6a2881b', 'license_unverified', 'License verification pending — Dogpatch Bottle Shop', 'New location created; company verifies license internally before first delivery where applicable (O07).', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '698362f0-149d-4555-bf47-ee15139929d8', 'resolved', NULL, 'admin', NULL, 'Locate and verify the license; record the decision on the location.', NULL, NULL, NULL, 'license_unverified:698362f0-149d-4555-bf47-ee15139929d8', 'License verified', '2026-09-17 06:57:18.598-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.530376-07', '2026-09-17 06:57:18.530376-07');
INSERT INTO public.exception_case VALUES ('f18ac6b3-36b2-4b74-b43f-398d20992565', 'license_unverified', 'License verification pending — Marina Wine & Beer', 'New location created; company verifies license internally before first delivery where applicable (O07).', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'fde86ec2-449b-42e1-a829-97c387141740', 'resolved', NULL, 'admin', NULL, 'Locate and verify the license; record the decision on the location.', NULL, NULL, NULL, 'license_unverified:fde86ec2-449b-42e1-a829-97c387141740', 'License verified', '2026-09-17 06:57:18.605-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.5488-07', '2026-09-17 06:57:18.5488-07');
INSERT INTO public.exception_case VALUES ('16bb7191-c205-4d3d-8fb7-d4b3de22ac00', 'license_unverified', 'License verification pending — Echo Park Cantina', 'New location created; company verifies license internally before first delivery where applicable (O07).', '6c976b6f-a023-4539-bb98-a17a3c33000e', '11d5ce87-8101-47d1-8de3-136bbd527609', 'resolved', NULL, 'admin', NULL, 'Locate and verify the license; record the decision on the location.', NULL, NULL, NULL, 'license_unverified:11d5ce87-8101-47d1-8de3-136bbd527609', 'License verified', '2026-09-17 06:57:18.61-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.576969-07', '2026-09-17 06:57:18.576969-07');
INSERT INTO public.exception_case VALUES ('1e7e6769-fd19-4ee4-b659-203c20a2e6b1', 'payment_setup_pending', 'ACH setup pending — Mission Taproom', 'Setup invitation intended; hosted setup not yet completed. First delivery may proceed (O09); second delivery depends on D01.', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'open', NULL, 'admin', NULL, 'Send the invitation through the authorized single-sender process (D32 pending) and follow up with the payer.', NULL, NULL, NULL, 'payment_setup_pending:1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', NULL, NULL, NULL, '2026-09-17 06:57:18.676025-07', '2026-09-17 06:57:18.676025-07');
INSERT INTO public.exception_case VALUES ('b681d02f-ccdf-4f97-861e-c8c8085cea9a', 'billing_email_change', 'Billing-email change awaiting Admin approval — Mission Taproom', 'Requested payables@missiontaproom.demo (was ap@missiontaproom.demo) via sales', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'open', NULL, 'admin', NULL, 'Approve or reject the billing-email change on the location page.', NULL, NULL, NULL, 'billing_email_change:13b4ef9f-5a40-4597-bb86-76f78b5c8480', NULL, NULL, NULL, '2026-09-17 06:57:18.692563-07', '2026-09-17 06:57:18.692563-07');
INSERT INTO public.exception_case VALUES ('62d068a7-690d-437d-a894-ebb0ea5b8b56', 'below_minimum', 'NC-000003 is below the $90 minimum — Golden Gate Grill', 'Merchandise 72.00, deposits 0.00; value basis is D11 (unselected).', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'open', NULL, 'admin', NULL, 'Consolidate with other demand, delay, or approve an exception before release. Never bill undelivered goods to reach the minimum.', NULL, NULL, NULL, 'below_minimum:ceeddfa5-1b47-4020-afb0-8417e3e1fe07', NULL, NULL, NULL, '2026-09-17 06:57:18.695748-07', '2026-09-17 06:57:18.695748-07');
INSERT INTO public.exception_case VALUES ('3b56294a-fc81-4d48-9861-2f124ccfe3ce', 'allocation_shortage', 'Shortage on NC-000004 — Dogpatch Bottle Shop', '1/6 bbl keg: 3 unmet of 5', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '698362f0-149d-4555-bf47-ee15139929d8', 'open', NULL, 'admin', NULL, 'Source, reallocate, delay or agree partial fulfilment (D14/D15 remain unselected).', NULL, NULL, NULL, 'allocation_shortage:af9c6654-0a88-4fd8-a914-260eca5620af', NULL, NULL, NULL, '2026-09-17 06:57:18.709792-07', '2026-09-17 06:57:18.709792-07');
INSERT INTO public.exception_case VALUES ('3bd9e580-b08b-41ce-a062-eb0cde80d5f8', 'order_change_request', 'Change requested on NC-000004', 'amend_qty: Buyer wants two more cases if available (demo). Submitted price 3400¢, current market price 3400¢.', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '698362f0-149d-4555-bf47-ee15139929d8', 'open', NULL, 'admin', NULL, 'D10 (amendment authority by stage) and D12 (price commitment) are unselected. Admin may apply a quantity change before commitment only where no price question arises.', NULL, NULL, NULL, 'order_change_request:a8ab1ea9-99e1-4934-95d3-588f64325139', NULL, NULL, NULL, '2026-09-17 06:57:18.734564-07', '2026-09-17 06:57:18.734564-07');
INSERT INTO public.exception_case VALUES ('45220dfa-404a-451d-8b95-5374a151ca58', 'hold', 'Hold (compliance) — Marina Wine & Beer', 'Receiving entrance unconfirmed after remodel (demo)', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'fde86ec2-449b-42e1-a829-97c387141740', 'open', NULL, 'admin', NULL, 'Resolve the cause; orders remain capturable, merchandise delivery is blocked.', NULL, NULL, NULL, 'hold:5844e23a-7d1d-4c23-b9ff-9171899c5ea7', NULL, NULL, NULL, '2026-09-17 06:57:18.739802-07', '2026-09-17 06:57:18.739802-07');
INSERT INTO public.exception_case VALUES ('3315f596-a0af-426f-bb76-5904c34cdab2', 'closure_review', 'Closure run-off review — Sunset Social Club', 'Venue closed for the season (demo)', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'eed53303-7015-452f-ae6e-795b4e5e9b99', 'open', NULL, 'accounting', NULL, 'Review open demand, reservations, standing arrangements, obligations, credits and keg custody (J24/J29–J31). D07 lifecycle policy is unselected — dispose deliberately.', NULL, NULL, NULL, 'closure_review:eed53303-7015-452f-ae6e-795b4e5e9b99', NULL, NULL, NULL, '2026-09-17 06:57:18.76437-07', '2026-09-17 06:57:18.76437-07');
INSERT INTO public.exception_case VALUES ('435c1fb3-f72a-4475-91ab-c4b7bf738db6', 'email_intake', 'Email order to review — buyer@northbeachpizza.demo', 'Beer order for Friday', 'cedd932e-f4e5-4e5d-a871-7b614335f894', NULL, 'open', NULL, 'admin', NULL, 'Match location, SKU, quantity and intent; convert to an order or mark incomplete and clarify only essentials (R14/D09).', NULL, NULL, NULL, 'email_intake:766b2956-6628-4100-a97f-3418d3711785', NULL, NULL, NULL, '2026-09-17 06:57:18.801734-07', '2026-09-17 06:57:18.801734-07');


--
-- Data for Name: exception_link; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.exception_link VALUES ('99bd0abf-05a9-49ae-8fda-5cbc1aaf53b2', '9dbee0b5-6360-49d1-89d1-685674922f08', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', NULL);
INSERT INTO public.exception_link VALUES ('0d81162d-c67d-4d2d-b1c4-c9f2dc81dd35', '772bafea-c8be-48bf-8c17-5ebeec8c1eab', 'customer_location', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', NULL);
INSERT INTO public.exception_link VALUES ('78cb4440-0df5-487b-b9ba-1ab0068b2a71', 'c3aff6ae-75b9-490c-ab6f-4575b1eadcda', 'customer_location', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', NULL);
INSERT INTO public.exception_link VALUES ('3299a0dd-6c2b-40d6-8651-5227a4a16ca2', '38f1cb7b-d2a2-4b3b-9a39-5b01a6a2881b', 'customer_location', '698362f0-149d-4555-bf47-ee15139929d8', NULL);
INSERT INTO public.exception_link VALUES ('92121a9f-1ed3-4d85-ac23-c6fddb728f52', 'f18ac6b3-36b2-4b74-b43f-398d20992565', 'customer_location', 'fde86ec2-449b-42e1-a829-97c387141740', NULL);
INSERT INTO public.exception_link VALUES ('d8d7e427-96ee-407e-a704-11e9415725f2', '3c8dc440-6b28-40cf-9a90-2869c0a5d313', 'customer_location', 'eed53303-7015-452f-ae6e-795b4e5e9b99', NULL);
INSERT INTO public.exception_link VALUES ('df3d5ad8-84ef-4118-a483-04c90903b7ea', '16bb7191-c205-4d3d-8fb7-d4b3de22ac00', 'customer_location', '11d5ce87-8101-47d1-8de3-136bbd527609', NULL);
INSERT INTO public.exception_link VALUES ('dd10818a-23f3-44c7-8b5c-f19e9c0fb90d', '1e7e6769-fd19-4ee4-b659-203c20a2e6b1', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', NULL);
INSERT INTO public.exception_link VALUES ('13de9b1b-ccf8-4c2f-b05a-58153170a562', 'b681d02f-ccdf-4f97-861e-c8c8085cea9a', 'billing_email_change_request', '13b4ef9f-5a40-4597-bb86-76f78b5c8480', NULL);
INSERT INTO public.exception_link VALUES ('bf4fea82-4978-4d7a-b271-39ac4795f8dc', '62d068a7-690d-437d-a894-ebb0ea5b8b56', 'order', 'ceeddfa5-1b47-4020-afb0-8417e3e1fe07', NULL);
INSERT INTO public.exception_link VALUES ('2339bd4a-7a65-46be-ba8f-2ad1635e66b7', '3b56294a-fc81-4d48-9861-2f124ccfe3ce', 'order', 'af9c6654-0a88-4fd8-a914-260eca5620af', NULL);
INSERT INTO public.exception_link VALUES ('9b9a57c8-a010-40bb-951a-0107c6a57a97', '3bd9e580-b08b-41ce-a062-eb0cde80d5f8', 'order', 'af9c6654-0a88-4fd8-a914-260eca5620af', NULL);
INSERT INTO public.exception_link VALUES ('8ae1d153-046a-4700-b363-11f515fe0cd9', '45220dfa-404a-451d-8b95-5374a151ca58', 'hold', '5844e23a-7d1d-4c23-b9ff-9171899c5ea7', NULL);
INSERT INTO public.exception_link VALUES ('ba9ffd0e-bd14-455d-af85-eed04e3cfa40', '3315f596-a0af-426f-bb76-5904c34cdab2', 'customer_location', 'eed53303-7015-452f-ae6e-795b4e5e9b99', NULL);
INSERT INTO public.exception_link VALUES ('51bf0c88-f932-41fa-ba25-68d6f42174ce', '435c1fb3-f72a-4475-91ab-c4b7bf738db6', 'order_intake_request', '766b2956-6628-4100-a97f-3418d3711785', NULL);


--
-- Data for Name: exception_note; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.exception_note VALUES ('94e71139-dab3-4a97-b167-ba71cf2b828e', '9dbee0b5-6360-49d1-89d1-685674922f08', '2026-09-17 06:57:18.490445-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (license_unverified)', NULL);
INSERT INTO public.exception_note VALUES ('905d4f2a-bca8-4cd9-a92b-ad6c3cf7f826', '772bafea-c8be-48bf-8c17-5ebeec8c1eab', '2026-09-17 06:57:18.510274-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (license_unverified)', NULL);
INSERT INTO public.exception_note VALUES ('ffe4c6c2-e95f-4bb0-b62a-b3de576a81e9', 'c3aff6ae-75b9-490c-ab6f-4575b1eadcda', '2026-09-17 06:57:18.520341-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (license_unverified)', NULL);
INSERT INTO public.exception_note VALUES ('94ff94a2-9207-4d60-a29d-335e43040473', '38f1cb7b-d2a2-4b3b-9a39-5b01a6a2881b', '2026-09-17 06:57:18.530376-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (license_unverified)', NULL);
INSERT INTO public.exception_note VALUES ('979ecb8b-788f-4e33-b534-1c48a49911a0', 'f18ac6b3-36b2-4b74-b43f-398d20992565', '2026-09-17 06:57:18.5488-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (license_unverified)', NULL);
INSERT INTO public.exception_note VALUES ('9f2d27e0-0462-4540-8639-d6808ac3cf23', '3c8dc440-6b28-40cf-9a90-2869c0a5d313', '2026-09-17 06:57:18.562139-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (license_unverified)', NULL);
INSERT INTO public.exception_note VALUES ('95b51ff2-fcd3-4f44-b554-92167683433a', '16bb7191-c205-4d3d-8fb7-d4b3de22ac00', '2026-09-17 06:57:18.576969-07', '64587a9f-cc18-4d7e-bbb2-773be095cc20', 'employee', 'state_change', 'Opened (license_unverified)', NULL);
INSERT INTO public.exception_note VALUES ('9e3597a9-57d7-4d98-91ba-52d9d621d8f9', '1e7e6769-fd19-4ee4-b659-203c20a2e6b1', '2026-09-17 06:57:18.676025-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'employee', 'state_change', 'Opened (payment_setup_pending)', NULL);
INSERT INTO public.exception_note VALUES ('17ae42ba-1c70-48bb-befe-cd15b8f02f8c', 'b681d02f-ccdf-4f97-861e-c8c8085cea9a', '2026-09-17 06:57:18.694304-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (billing_email_change)', NULL);
INSERT INTO public.exception_note VALUES ('9521a865-93ef-4f59-bda2-e7b8c62c0d2a', '62d068a7-690d-437d-a894-ebb0ea5b8b56', '2026-09-17 06:57:18.695748-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (below_minimum)', NULL);
INSERT INTO public.exception_note VALUES ('b8405417-0775-4fb5-b215-892aa4a684c3', '3b56294a-fc81-4d48-9861-2f124ccfe3ce', '2026-09-17 06:57:18.709792-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (allocation_shortage)', NULL);
INSERT INTO public.exception_note VALUES ('d5414569-d1dd-43ea-8417-5352266e6707', '3bd9e580-b08b-41ce-a062-eb0cde80d5f8', '2026-09-17 06:57:18.735591-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'employee', 'state_change', 'Opened (order_change_request)', NULL);
INSERT INTO public.exception_note VALUES ('4c5b111b-67b8-4a50-ad67-22851996c97e', '45220dfa-404a-451d-8b95-5374a151ca58', '2026-09-17 06:57:18.740572-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'employee', 'state_change', 'Opened (hold)', NULL);
INSERT INTO public.exception_note VALUES ('b3948bc4-1e71-45c2-a0b0-97023797a100', '3315f596-a0af-426f-bb76-5904c34cdab2', '2026-09-17 06:57:18.76437-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'employee', 'state_change', 'Opened (closure_review)', NULL);
INSERT INTO public.exception_note VALUES ('20a9f27c-77e9-4c28-9f11-89eb7e2a24d3', '435c1fb3-f72a-4475-91ab-c4b7bf738db6', '2026-09-17 06:57:18.802614-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'employee', 'state_change', 'Opened (email_intake)', NULL);


--
-- Data for Name: hold; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.hold VALUES ('5844e23a-7d1d-4c23-b9ff-9171899c5ea7', 'fde86ec2-449b-42e1-a829-97c387141740', 'compliance', 'Receiving entrance unconfirmed after remodel (demo)', NULL, NULL, true, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.737411-07', NULL, NULL, NULL);


--
-- Data for Name: hold_override; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: invoice_obligation; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: job; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.job VALUES ('f6fdadd8-317f-4de8-956a-bc4c763fe017', 'stripe.customer.ensure', '{"locationId": "1f1102a1-f0fd-46d0-a671-4fe1e8cbe975"}', 'done', '2026-09-17 06:57:18.681-07', 1, 5, NULL, NULL, NULL, 'stripe.customer.ensure:1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '2026-09-17 06:57:18.676025-07', '2026-09-17 06:57:18.807-07');


--
-- Data for Name: keg_movement; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: license_verification; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.license_verification VALUES ('b480bcef-b0fb-4122-9a71-e4a9d1f25520', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', NULL, NULL, NULL, 'unverified', true, NULL, NULL, NULL, '2026-09-17 06:57:18.510274-07');
INSERT INTO public.license_verification VALUES ('e617d8ec-d61d-4e51-81c7-c4bbfdbed99d', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', NULL, NULL, NULL, 'unverified', true, NULL, NULL, NULL, '2026-09-17 06:57:18.520341-07');
INSERT INTO public.license_verification VALUES ('58a9d8bf-c26a-40dc-b397-1202c42ea0f8', 'eed53303-7015-452f-ae6e-795b4e5e9b99', NULL, NULL, NULL, 'unverified', true, NULL, NULL, NULL, '2026-09-17 06:57:18.562139-07');
INSERT INTO public.license_verification VALUES ('36b874ee-9503-4504-8002-44338becdc59', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', NULL, NULL, NULL, 'unverified', false, NULL, NULL, NULL, '2026-09-17 06:57:18.490445-07');
INSERT INTO public.license_verification VALUES ('97029876-d618-4758-a284-1eea096a541b', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'ABC-1F1102', 'ABC Type 47', 'ABC license lookup (demo)', 'verified', true, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.593-07', NULL, '2026-09-17 06:57:18.591888-07');
INSERT INTO public.license_verification VALUES ('2d9a1139-4fcb-4133-a7a8-142506bacf2a', '698362f0-149d-4555-bf47-ee15139929d8', NULL, NULL, NULL, 'unverified', false, NULL, NULL, NULL, '2026-09-17 06:57:18.530376-07');
INSERT INTO public.license_verification VALUES ('1d7383a4-3b67-43cc-8fbf-562c20d4786e', '698362f0-149d-4555-bf47-ee15139929d8', 'ABC-698362', 'ABC Type 47', 'ABC license lookup (demo)', 'verified', true, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.597-07', NULL, '2026-09-17 06:57:18.596748-07');
INSERT INTO public.license_verification VALUES ('ace3c40e-21f2-4e02-afe3-e1dbec7a16c7', 'fde86ec2-449b-42e1-a829-97c387141740', NULL, NULL, NULL, 'unverified', false, NULL, NULL, NULL, '2026-09-17 06:57:18.5488-07');
INSERT INTO public.license_verification VALUES ('a41ebdc1-0e35-4bdf-a931-75ecaeb909a6', 'fde86ec2-449b-42e1-a829-97c387141740', 'ABC-FDE86E', 'ABC Type 47', 'ABC license lookup (demo)', 'verified', true, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.603-07', NULL, '2026-09-17 06:57:18.601849-07');
INSERT INTO public.license_verification VALUES ('00ee8ea3-5c36-408b-a3fc-5a3da0445783', '11d5ce87-8101-47d1-8de3-136bbd527609', NULL, NULL, NULL, 'unverified', false, NULL, NULL, NULL, '2026-09-17 06:57:18.576969-07');
INSERT INTO public.license_verification VALUES ('cab126fb-4b09-45a7-9f3e-3ff3149d4ad3', '11d5ce87-8101-47d1-8de3-136bbd527609', 'ABC-11D5CE', 'ABC Type 47', 'ABC license lookup (demo)', 'verified', true, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.609-07', NULL, '2026-09-17 06:57:18.608534-07');


--
-- Data for Name: location_address; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.location_address VALUES ('f123c9e8-4496-4ceb-b47f-a9fd8683aa5a', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'bda927c7-c728-410f-95f3-b2f1793bbfd2', 'delivery', true, '2026-09-17 06:57:18.490445-07', NULL);
INSERT INTO public.location_address VALUES ('42ddfc64-215a-400f-a715-f5d41199043f', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'bda927c7-c728-410f-95f3-b2f1793bbfd2', 'billing', true, '2026-09-17 06:57:18.490445-07', NULL);
INSERT INTO public.location_address VALUES ('cccb63e4-9609-4fc4-a562-e7092d2d884e', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'b1ecc534-7d36-4016-be7c-9f74c70fda84', 'delivery', true, '2026-09-17 06:57:18.510274-07', NULL);
INSERT INTO public.location_address VALUES ('357e961d-e7e8-4bdf-927d-10e594e3c064', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'b1ecc534-7d36-4016-be7c-9f74c70fda84', 'billing', true, '2026-09-17 06:57:18.510274-07', NULL);
INSERT INTO public.location_address VALUES ('24ca8e78-b054-415f-9a1c-1121d19942c6', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', 'e5b90e01-a62b-42fe-ab96-b18d2b8374e1', 'delivery', true, '2026-09-17 06:57:18.520341-07', NULL);
INSERT INTO public.location_address VALUES ('aa9dcae9-7339-4ebb-901a-dbb05bb1664c', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', 'e5b90e01-a62b-42fe-ab96-b18d2b8374e1', 'billing', true, '2026-09-17 06:57:18.520341-07', NULL);
INSERT INTO public.location_address VALUES ('80a26d30-8be1-4045-884b-678e363af638', '698362f0-149d-4555-bf47-ee15139929d8', '6a23d88f-c5a0-43a9-a206-2b6473626b6d', 'delivery', true, '2026-09-17 06:57:18.530376-07', NULL);
INSERT INTO public.location_address VALUES ('ea8cd058-1d45-4924-b04f-fd6f31d1b5c3', '698362f0-149d-4555-bf47-ee15139929d8', '6a23d88f-c5a0-43a9-a206-2b6473626b6d', 'billing', true, '2026-09-17 06:57:18.530376-07', NULL);
INSERT INTO public.location_address VALUES ('ada6ac4c-38dd-41ef-b245-121299def1e0', 'fde86ec2-449b-42e1-a829-97c387141740', '6addf446-b666-4975-9c4d-6897916228fa', 'delivery', true, '2026-09-17 06:57:18.5488-07', NULL);
INSERT INTO public.location_address VALUES ('7bb635e5-947c-417f-8a09-a5e90eff077c', 'fde86ec2-449b-42e1-a829-97c387141740', '6addf446-b666-4975-9c4d-6897916228fa', 'billing', true, '2026-09-17 06:57:18.5488-07', NULL);
INSERT INTO public.location_address VALUES ('3bf3cf5e-73f7-43d8-b031-76fb9ad176dd', 'eed53303-7015-452f-ae6e-795b4e5e9b99', 'db012590-360b-4233-95d4-c711ef51a02d', 'delivery', true, '2026-09-17 06:57:18.562139-07', NULL);
INSERT INTO public.location_address VALUES ('7a817a56-a8f2-4d4a-940f-71d07402f260', 'eed53303-7015-452f-ae6e-795b4e5e9b99', 'db012590-360b-4233-95d4-c711ef51a02d', 'billing', true, '2026-09-17 06:57:18.562139-07', NULL);
INSERT INTO public.location_address VALUES ('88addc19-701f-412a-a142-bc3ea4009488', '11d5ce87-8101-47d1-8de3-136bbd527609', '6a3ea787-caa7-444f-8690-1eafbd36925b', 'delivery', true, '2026-09-17 06:57:18.576969-07', NULL);
INSERT INTO public.location_address VALUES ('df49ed1f-8f01-448f-9d43-84b466adcd58', '11d5ce87-8101-47d1-8de3-136bbd527609', '6a3ea787-caa7-444f-8690-1eafbd36925b', 'billing', true, '2026-09-17 06:57:18.576969-07', NULL);


--
-- Data for Name: location_contact; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.location_contact VALUES ('5001ed4d-18ac-41a1-b992-f93ac913fd75', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '34ff3c77-3b00-4ded-9001-8abef0a865e1', 'buyer', true, false, false, true, '2026-09-17 06:57:18.490445-07', NULL);
INSERT INTO public.location_contact VALUES ('3d8e7ff6-f24f-4041-8bba-818741173626', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '2fcddc51-7f77-4e88-916e-d086c62d1afc', 'ap', false, true, false, true, '2026-09-17 06:57:18.490445-07', NULL);
INSERT INTO public.location_contact VALUES ('062858b1-2c0b-4ff1-8566-2345997d89a4', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', '0d12c1fb-0d32-460e-87fb-de0e898550ea', 'buyer', true, true, false, true, '2026-09-17 06:57:18.510274-07', NULL);
INSERT INTO public.location_contact VALUES ('97ac5172-c69d-43eb-b1b7-5767a6e03f43', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', '40dd089c-65b0-4bf2-815a-a5887761eecf', 'buyer', true, true, false, true, '2026-09-17 06:57:18.520341-07', NULL);
INSERT INTO public.location_contact VALUES ('cdb128f3-d988-4b83-a62a-804f87179c86', '698362f0-149d-4555-bf47-ee15139929d8', '54d98684-f2d9-475b-a2eb-0f1cb551c878', 'buyer', true, false, false, true, '2026-09-17 06:57:18.530376-07', NULL);
INSERT INTO public.location_contact VALUES ('03bbb9e4-cc16-4b27-acdf-0858ced6a25a', '698362f0-149d-4555-bf47-ee15139929d8', '2dfa5227-a111-44ff-b80a-a16750cf6ca1', 'ap', false, true, false, true, '2026-09-17 06:57:18.530376-07', NULL);
INSERT INTO public.location_contact VALUES ('0ccbf523-d5e1-4beb-bd88-0a836ae01352', 'fde86ec2-449b-42e1-a829-97c387141740', '3a6aad3a-7100-43cd-bcc9-2c11ef5d97d5', 'buyer', true, true, false, true, '2026-09-17 06:57:18.5488-07', NULL);
INSERT INTO public.location_contact VALUES ('b959357a-1a93-456b-8e9f-b5b6e4ad4f41', 'eed53303-7015-452f-ae6e-795b4e5e9b99', '370cf5ec-46ac-4e9d-9d6b-a909163aeab0', 'buyer', true, true, false, true, '2026-09-17 06:57:18.562139-07', NULL);
INSERT INTO public.location_contact VALUES ('bbb3f42c-ebd5-4841-8047-c19445e3667e', '11d5ce87-8101-47d1-8de3-136bbd527609', '1b4fea94-b515-4c28-b544-563f576a5168', 'buyer', true, false, false, true, '2026-09-17 06:57:18.576969-07', NULL);
INSERT INTO public.location_contact VALUES ('c34da63d-ebb5-4178-9710-a40ed30ba98d', '11d5ce87-8101-47d1-8de3-136bbd527609', '5439ea19-7fe7-417a-9325-e90838e4fcc6', 'ap', false, true, false, true, '2026-09-17 06:57:18.576969-07', NULL);


--
-- Data for Name: location_rep_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.location_rep_history VALUES ('4f2b6dd2-81d2-479a-8bc5-ccdc52295c67', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.490445-07', NULL, 'originating');
INSERT INTO public.location_rep_history VALUES ('7ab36a40-83d5-4f34-895e-f1a6860a8a05', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.510274-07', NULL, 'originating');
INSERT INTO public.location_rep_history VALUES ('9a80f5c5-fb69-4ce9-84b0-b5ce1b394ddb', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.520341-07', NULL, 'originating');
INSERT INTO public.location_rep_history VALUES ('cf3e54b7-e250-4672-ac01-55ef59399873', '698362f0-149d-4555-bf47-ee15139929d8', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.530376-07', NULL, 'originating');
INSERT INTO public.location_rep_history VALUES ('da8482c0-bf55-4e5a-af2f-db0a1f97e190', 'fde86ec2-449b-42e1-a829-97c387141740', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.5488-07', NULL, 'originating');
INSERT INTO public.location_rep_history VALUES ('4f46c0e2-6a6c-4ec6-8cfe-9a1ad7bdd541', 'eed53303-7015-452f-ae6e-795b4e5e9b99', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.562139-07', NULL, 'originating');
INSERT INTO public.location_rep_history VALUES ('5fea801d-8fd1-4b92-8c97-d8d93e80344c', '11d5ce87-8101-47d1-8de3-136bbd527609', '64587a9f-cc18-4d7e-bbb2-773be095cc20', '2026-09-17 06:57:18.576969-07', NULL, 'originating');


--
-- Data for Name: market; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.market VALUES ('8e476704-ed63-4fb4-adb7-7d0443107190', 'MA', 'Massachusetts', 'America/New_York', true, 1, 'unconfirmed', NULL, NULL, '2026-09-17 06:57:18.311224-07');
INSERT INTO public.market VALUES ('cedd932e-f4e5-4e5d-a871-7b614335f894', 'NC', 'NorCal / Bay Area', 'America/Los_Angeles', true, 7, 'unconfirmed', NULL, NULL, '2026-09-17 06:57:18.307504-07');
INSERT INTO public.market VALUES ('6c976b6f-a023-4539-bb98-a17a3c33000e', 'LA', 'Greater Los Angeles', 'America/Los_Angeles', true, 2, 'unconfirmed', NULL, NULL, '2026-09-17 06:57:18.309671-07');


--
-- Data for Name: market_price; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.market_price VALUES ('11f2b00f-3dec-46bc-850b-ecb8652902fe', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '95f8f51c-c694-4432-8a26-1d10285ad100', 3600, '2026-09-17 06:57:18.372-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.37508-07');
INSERT INTO public.market_price VALUES ('3d41bb06-9982-4b59-89b3-20f71fa91756', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '5af594ee-2c50-48bc-a69f-6a4cfe83db1a', 4200, '2026-09-17 06:57:18.377-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.378579-07');
INSERT INTO public.market_price VALUES ('a782b907-0d08-4523-b80a-ddcdbe93d96f', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 9500, '2026-09-17 06:57:18.379-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.380757-07');
INSERT INTO public.market_price VALUES ('b8d7f947-8ea2-4969-9c1c-b199a529d4e0', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', 17500, '2026-09-17 06:57:18.381-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.382834-07');
INSERT INTO public.market_price VALUES ('5f9345a6-0861-497a-9b97-49ed8dd25769', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 3400, '2026-09-17 06:57:18.384-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.384904-07');
INSERT INTO public.market_price VALUES ('11c9abfb-9a07-4289-8e78-db67f12fcfbf', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'f7402f85-342b-4cd0-a818-5bacb80c2536', 9000, '2026-09-17 06:57:18.385-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.387186-07');
INSERT INTO public.market_price VALUES ('0f12bb29-485e-4a9d-9291-0701edd3cc68', '6c976b6f-a023-4539-bb98-a17a3c33000e', '95f8f51c-c694-4432-8a26-1d10285ad100', 3600, '2026-09-17 06:57:18.388-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.389317-07');
INSERT INTO public.market_price VALUES ('1d8c4967-9803-4cf5-9452-76d24eb5afa7', '6c976b6f-a023-4539-bb98-a17a3c33000e', '5af594ee-2c50-48bc-a69f-6a4cfe83db1a', 4200, '2026-09-17 06:57:18.39-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.391243-07');
INSERT INTO public.market_price VALUES ('56698b80-0aa5-485b-8ce3-119987a0a8d9', '6c976b6f-a023-4539-bb98-a17a3c33000e', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 9500, '2026-09-17 06:57:18.392-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.394153-07');
INSERT INTO public.market_price VALUES ('8ea81902-2a2b-452e-af9c-a267e4c53671', '6c976b6f-a023-4539-bb98-a17a3c33000e', '76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', 17500, '2026-09-17 06:57:18.396-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.397549-07');
INSERT INTO public.market_price VALUES ('3791fe54-cbe4-4c6e-829a-4c6374b682b3', '6c976b6f-a023-4539-bb98-a17a3c33000e', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 3400, '2026-09-17 06:57:18.398-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.39995-07');
INSERT INTO public.market_price VALUES ('fa0ee0f7-64d3-45ee-94df-7689993b421a', '6c976b6f-a023-4539-bb98-a17a3c33000e', 'f7402f85-342b-4cd0-a818-5bacb80c2536', 9000, '2026-09-17 06:57:18.401-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.402278-07');
INSERT INTO public.market_price VALUES ('afe8e824-892b-4ef3-bd79-6d0ee7f587ca', '8e476704-ed63-4fb4-adb7-7d0443107190', '95f8f51c-c694-4432-8a26-1d10285ad100', 3800, '2026-09-17 06:57:18.403-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.405398-07');
INSERT INTO public.market_price VALUES ('ca573441-03e8-43b4-a039-f6146480c0aa', '8e476704-ed63-4fb4-adb7-7d0443107190', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 9900, '2026-09-17 06:57:18.406-07', NULL, 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.408656-07');


--
-- Data for Name: notice; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.notice VALUES ('b466f3da-01f8-40e8-bcc7-ec1ccc180556', 'order_received', 'order', 'cb10c225-00e7-41fb-b286-5ce4c934ded3', 1, 'jordan@missiontaproom.demo', '34ff3c77-3b00-4ded-9001-8abef0a865e1', 'unselected', 'manual_pending', '{"lines": [{"qty": 4, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100"}, {"qty": 1, "skuId": "1e1e97bc-f89b-46ef-8797-e8a1dae400ef"}], "summary": "Order NC-000001 received for Mission Taproom. This confirms receipt of your order; it is not a delivery date commitment."}', NULL, '2026-09-17 06:57:18.612794-07', '2026-09-17 06:57:18.612794-07');
INSERT INTO public.notice VALUES ('85d72fcc-00c1-4eeb-8b1f-379c003995fd', 'order_received', 'order', '879f3cf7-c4bf-4586-877e-e6c87cd54c53', 1, 'jordan@missiontaproom.demo', '34ff3c77-3b00-4ded-9001-8abef0a865e1', 'unselected', 'manual_pending', '{"lines": [{"qty": 3, "skuId": "c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d"}, {"qty": 2, "skuId": "5af594ee-2c50-48bc-a69f-6a4cfe83db1a"}], "summary": "Order NC-000002 received for Mission Taproom. This confirms receipt of your order; it is not a delivery date commitment."}', NULL, '2026-09-17 06:57:18.640372-07', '2026-09-17 06:57:18.640372-07');
INSERT INTO public.notice VALUES ('cfc49101-2e5b-445f-b0c0-e20a6bbbf42c', 'payment_setup_invitation', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 1, 'ap@missiontaproom.demo', '2fcddc51-7f77-4e88-916e-d086c62d1afc', 'unselected', 'manual_pending', '{"summary": "Invite Mission Taproom''s authorized payer to Stripe-hosted ACH setup. Gmail never collects bank details."}', NULL, '2026-09-17 06:57:18.676025-07', '2026-09-17 06:57:18.676025-07');
INSERT INTO public.notice VALUES ('00caed48-c49e-4216-8d7d-d1c39974bec3', 'order_received', 'order', 'ceeddfa5-1b47-4020-afb0-8417e3e1fe07', 1, 'casey@gggrill.demo', '0d12c1fb-0d32-460e-87fb-de0e898550ea', 'unselected', 'manual_pending', '{"lines": [{"qty": 2, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100"}], "summary": "Order NC-000003 received for Golden Gate Grill. This confirms receipt of your order; it is not a delivery date commitment."}', NULL, '2026-09-17 06:57:18.695748-07', '2026-09-17 06:57:18.695748-07');
INSERT INTO public.notice VALUES ('9bfc4d71-b690-4f7c-89bf-7310cacc9e5c', 'order_received', 'order', 'af9c6654-0a88-4fd8-a914-260eca5620af', 1, 'alex@dogpatchbottles.demo', '54d98684-f2d9-475b-a2eb-0f1cb551c878', 'unselected', 'manual_pending', '{"lines": [{"qty": 5, "skuId": "f7402f85-342b-4cd0-a818-5bacb80c2536"}, {"qty": 2, "skuId": "c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d"}], "summary": "Order NC-000004 received for Dogpatch Bottle Shop. This confirms receipt of your order; it is not a delivery date commitment."}', NULL, '2026-09-17 06:57:18.709792-07', '2026-09-17 06:57:18.709792-07');
INSERT INTO public.notice VALUES ('db990b98-4554-48d3-b9e0-64fa08637aa4', 'order_received', 'order', 'd1748184-9fe5-4d56-bff3-80e08d6c7881', 1, 'pat@marinawb.demo', '3a6aad3a-7100-43cd-bcc9-2c11ef5d97d5', 'unselected', 'manual_pending', '{"lines": [{"qty": 1, "skuId": "76ed6f7e-8d1a-4eef-be6b-9bdee31c4799"}], "summary": "Order NC-000005 received for Marina Wine & Beer. This confirms receipt of your order; it is not a delivery date commitment."}', NULL, '2026-09-17 06:57:18.741931-07', '2026-09-17 06:57:18.741931-07');
INSERT INTO public.notice VALUES ('7ab3ef0a-5877-4ef1-9a8f-e89868570115', 'order_received', 'order', '848c18a3-c4b0-46c5-84d4-c9a2a170195e', 1, 'dana@sunsetsocial.demo', '370cf5ec-46ac-4e9d-9d6b-a909163aeab0', 'unselected', 'manual_pending', '{"lines": [{"qty": 3, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100"}], "summary": "Order NC-000006 received for Sunset Social Club. This confirms receipt of your order; it is not a delivery date commitment."}', NULL, '2026-09-17 06:57:18.754471-07', '2026-09-17 06:57:18.754471-07');
INSERT INTO public.notice VALUES ('abd254f7-e782-466b-9dc5-f0f14e2684c4', 'order_received', 'order', 'd5955b2d-d1ad-49aa-8340-c4bbcfda23cc', 1, 'maria@echoparkcantina.demo', '1b4fea94-b515-4c28-b544-563f576a5168', 'unselected', 'manual_pending', '{"lines": [{"qty": 6, "skuId": "95f8f51c-c694-4432-8a26-1d10285ad100"}, {"qty": 2, "skuId": "1e1e97bc-f89b-46ef-8797-e8a1dae400ef"}], "summary": "Order LA-000001 received for Echo Park Cantina. This confirms receipt of your order; it is not a delivery date commitment."}', NULL, '2026-09-17 06:57:18.769245-07', '2026-09-17 06:57:18.769245-07');


--
-- Data for Name: order_intake_request; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.order_intake_request VALUES ('766b2956-6628-4100-a97f-3418d3711785', 'cedd932e-f4e5-4e5d-a871-7b614335f894', NULL, 'email', NULL, 'buyer@northbeachpizza.demo', 'Beer order for Friday', 'Hi — can we get 3 cases of Cantinesca 12oz and one sixtel of Sunlight for Friday? Thanks, Nico (demo email)', '2026-09-17 06:57:18.79708-07', 'received', NULL, NULL, NULL, NULL);


--
-- Data for Name: order_line; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.order_line VALUES ('d3fd8770-7f0d-47f1-a5e6-0f97a97a9c38', 'cb10c225-00e7-41fb-b286-5ce4c934ded3', 1, '95f8f51c-c694-4432-8a26-1d10285ad100', 4, 4, 0, 0, 3600, '11f2b00f-3dec-46bc-850b-ecb8652902fe', 0);
INSERT INTO public.order_line VALUES ('b3086216-bc19-493e-94e8-35a0d8f17160', 'cb10c225-00e7-41fb-b286-5ce4c934ded3', 2, '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 1, 1, 0, 0, 9500, 'a782b907-0d08-4523-b80a-ddcdbe93d96f', 1);
INSERT INTO public.order_line VALUES ('a702a0f7-480b-4ae8-ae41-57d1b40aef95', '879f3cf7-c4bf-4586-877e-e6c87cd54c53', 1, 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 3, 3, 0, 0, 3400, '5f9345a6-0861-497a-9b97-49ed8dd25769', 0);
INSERT INTO public.order_line VALUES ('bc463f77-a940-48b6-80ae-3d4b87e4cdef', '879f3cf7-c4bf-4586-877e-e6c87cd54c53', 2, '5af594ee-2c50-48bc-a69f-6a4cfe83db1a', 2, 2, 0, 0, 4200, '3d41bb06-9982-4b59-89b3-20f71fa91756', 0);
INSERT INTO public.order_line VALUES ('130f4dc0-f2a0-4775-a56c-b292ef1ef675', 'ceeddfa5-1b47-4020-afb0-8417e3e1fe07', 1, '95f8f51c-c694-4432-8a26-1d10285ad100', 2, 2, 0, 0, 3600, '11f2b00f-3dec-46bc-850b-ecb8652902fe', 0);
INSERT INTO public.order_line VALUES ('82a21cb9-d795-4d5c-b5db-3d09aabde31c', 'af9c6654-0a88-4fd8-a914-260eca5620af', 1, 'f7402f85-342b-4cd0-a818-5bacb80c2536', 5, 5, 0, 0, 9000, '11c9abfb-9a07-4289-8e78-db67f12fcfbf', 1);
INSERT INTO public.order_line VALUES ('490202e4-19ba-4d97-8a85-8c5b794b1406', 'af9c6654-0a88-4fd8-a914-260eca5620af', 2, 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 2, 2, 0, 0, 3400, '5f9345a6-0861-497a-9b97-49ed8dd25769', 0);
INSERT INTO public.order_line VALUES ('adf245fc-96fc-49b6-8c31-fc70f21db370', 'd1748184-9fe5-4d56-bff3-80e08d6c7881', 1, '76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', 1, 1, 0, 0, 17500, 'b8d7f947-8ea2-4969-9c1c-b199a529d4e0', 1);
INSERT INTO public.order_line VALUES ('c488cab3-7e73-4b12-a83d-8d65e63753df', '848c18a3-c4b0-46c5-84d4-c9a2a170195e', 1, '95f8f51c-c694-4432-8a26-1d10285ad100', 3, 3, 0, 0, 3600, '11f2b00f-3dec-46bc-850b-ecb8652902fe', 0);
INSERT INTO public.order_line VALUES ('d5bc125a-86e8-4c1a-b2ee-59544a73f343', 'd5955b2d-d1ad-49aa-8340-c4bbcfda23cc', 1, '95f8f51c-c694-4432-8a26-1d10285ad100', 6, 6, 0, 0, 3600, '0f12bb29-485e-4a9d-9291-0701edd3cc68', 0);
INSERT INTO public.order_line VALUES ('5d2521fa-a052-47a2-b49a-a10abb3dd07d', 'd5955b2d-d1ad-49aa-8340-c4bbcfda23cc', 2, '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 2, 2, 0, 0, 9500, '56698b80-0aa5-485b-8ce3-119987a0a8d9', 1);


--
-- Data for Name: order_line_change; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.order_line_change VALUES ('a8ab1ea9-99e1-4934-95d3-588f64325139', '490202e4-19ba-4d97-8a85-8c5b794b1406', '2026-09-17 06:57:18.730114-07', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'amend_qty', 2, 4, 3400, 3400, 'Buyer wants two more cases if available (demo)', 'recorded_unselected_policy');


--
-- Data for Name: payment_relationship; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.payment_relationship VALUES ('dc9e072d-5a30-4043-ab28-a808d0666227', '66ba05d7-49d3-4791-9fd1-f96572ad50ce', 'unselected', 'not_requested', NULL, false, NULL, NULL, NULL, NULL, NULL, true, '2026-09-17 06:57:18.510274-07', '2026-09-17 06:57:18.510274-07');
INSERT INTO public.payment_relationship VALUES ('f033c0a7-2fd1-4833-931f-8b7d3b3e3e54', '4a8a015d-8d8b-43ed-ad4f-691ea6543fb9', 'unselected', 'not_requested', NULL, false, NULL, NULL, NULL, NULL, NULL, true, '2026-09-17 06:57:18.520341-07', '2026-09-17 06:57:18.520341-07');
INSERT INTO public.payment_relationship VALUES ('3f31c9eb-2028-415b-977a-aba4ab45a152', '698362f0-149d-4555-bf47-ee15139929d8', 'unselected', 'not_requested', '2dfa5227-a111-44ff-b80a-a16750cf6ca1', false, NULL, NULL, NULL, NULL, NULL, true, '2026-09-17 06:57:18.530376-07', '2026-09-17 06:57:18.530376-07');
INSERT INTO public.payment_relationship VALUES ('8747cdab-19f2-405c-9e19-ea48cb094bd6', 'fde86ec2-449b-42e1-a829-97c387141740', 'unselected', 'not_requested', NULL, false, NULL, NULL, NULL, NULL, NULL, true, '2026-09-17 06:57:18.5488-07', '2026-09-17 06:57:18.5488-07');
INSERT INTO public.payment_relationship VALUES ('9e7f6727-e7df-4d78-a1f8-387991bffb2f', 'eed53303-7015-452f-ae6e-795b4e5e9b99', 'unselected', 'not_requested', NULL, false, NULL, NULL, NULL, NULL, NULL, true, '2026-09-17 06:57:18.562139-07', '2026-09-17 06:57:18.562139-07');
INSERT INTO public.payment_relationship VALUES ('79f77ed3-9c8a-4000-b3d2-6bb953657b58', '11d5ce87-8101-47d1-8de3-136bbd527609', 'unselected', 'not_requested', '5439ea19-7fe7-417a-9325-e90838e4fcc6', false, NULL, NULL, NULL, NULL, NULL, true, '2026-09-17 06:57:18.576969-07', '2026-09-17 06:57:18.576969-07');
INSERT INTO public.payment_relationship VALUES ('5df88f88-d8e6-4f06-bb20-206e000f92e7', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'stripe_ach', 'requested', '2fcddc51-7f77-4e88-916e-d086c62d1afc', false, NULL, '2026-09-17 06:57:18.683-07', NULL, NULL, NULL, true, '2026-09-17 06:57:18.490445-07', '2026-09-17 06:57:18.683-07');


--
-- Data for Name: provider_connection; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: provider_event; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: provider_reference; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.provider_reference VALUES ('4dab0c48-f371-4626-b2e1-0daf79fa4ca0', 'stripe', 'customer_location', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'customer', NULL, 'test', 'pending', '{"reason": "Stripe IMPLEMENTED / NOT CONNECTED — will run when STRIPE_SECRET_KEY is configured"}', '2026-09-17 06:57:18.806-07', '2026-09-17 06:57:18.676025-07', '2026-09-17 06:57:18.806-07');


--
-- Data for Name: reservation; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reservation VALUES ('fb13cda2-11ca-4e7a-a62d-0f62a5f20e2a', 'd3fd8770-7f0d-47f1-a5e6-0f97a97a9c38', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '95f8f51c-c694-4432-8a26-1d10285ad100', 4, 0, 'reserved', '2026-09-17 06:57:18.612794-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('b0bfdeb2-433f-455a-905a-d282273a5b4b', 'b3086216-bc19-493e-94e8-35a0d8f17160', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 1, 0, 'reserved', '2026-09-17 06:57:18.612794-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('cfed9792-dd03-42ce-8979-fd20883cbc96', 'a702a0f7-480b-4ae8-ae41-57d1b40aef95', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 3, 0, 'reserved', '2026-09-17 06:57:18.640372-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('2fcf3f15-10ad-4b88-a118-8f96b5649cbf', 'bc463f77-a940-48b6-80ae-3d4b87e4cdef', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '5af594ee-2c50-48bc-a69f-6a4cfe83db1a', 2, 0, 'reserved', '2026-09-17 06:57:18.640372-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('bb191405-ad4d-4f50-ad68-7e69e901263e', '130f4dc0-f2a0-4775-a56c-b292ef1ef675', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '95f8f51c-c694-4432-8a26-1d10285ad100', 2, 0, 'reserved', '2026-09-17 06:57:18.695748-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('19b1a577-7ede-4574-96c4-b059c74e72a0', '82a21cb9-d795-4d5c-b5db-3d09aabde31c', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'f7402f85-342b-4cd0-a818-5bacb80c2536', 2, 3, 'reserved', '2026-09-17 06:57:18.709792-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('2f0e8a18-5d3b-48fe-ab86-be88a07a3819', '490202e4-19ba-4d97-8a85-8c5b794b1406', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 2, 0, 'reserved', '2026-09-17 06:57:18.709792-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('7bb6bf5d-81a5-4d48-8c4e-4ab6a918af27', 'adf245fc-96fc-49b6-8c31-fc70f21db370', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', 1, 0, 'reserved', '2026-09-17 06:57:18.741931-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('eca69f23-3777-4790-922d-750b0579d127', 'c488cab3-7e73-4b12-a83d-8d65e63753df', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '95f8f51c-c694-4432-8a26-1d10285ad100', 3, 0, 'reserved', '2026-09-17 06:57:18.754471-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('e1dc6e6f-520d-41b0-a9a0-9df533572a38', 'd5bc125a-86e8-4c1a-b2ee-59544a73f343', 'e435c069-e41b-4077-9421-e1779aef343b', '95f8f51c-c694-4432-8a26-1d10285ad100', 6, 0, 'reserved', '2026-09-17 06:57:18.769245-07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.reservation VALUES ('8b27de9c-ff5d-4b0e-971b-d52b202dfba3', '5d2521fa-a052-47a2-b49a-a10abb3dd07d', 'e435c069-e41b-4077-9421-e1779aef343b', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 2, 0, 'reserved', '2026-09-17 06:57:18.769245-07', NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: role_grant; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.role_grant VALUES ('a3b19c00-c03a-4ef4-81b2-107aa93c298c', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', 'owner', NULL, '2026-09-17 06:57:18.301888-07', NULL, NULL, NULL, NULL);
INSERT INTO public.role_grant VALUES ('c1e379a5-a2a7-4989-8ebd-4977b43da6ce', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', 'admin', NULL, '2026-09-17 06:57:18.327216-07', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', NULL, NULL, NULL);
INSERT INTO public.role_grant VALUES ('fa443695-4a37-440e-b828-08d32ce00b0f', '54c7b5e9-ab99-448c-9ec0-74354e40ea84', 'accounting', NULL, '2026-09-17 06:57:18.337498-07', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', NULL, NULL, NULL);
INSERT INTO public.role_grant VALUES ('7ea809db-e513-4d43-9058-6c57be36e5d8', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', 'sales', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '2026-09-17 06:57:18.343675-07', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', NULL, NULL, NULL);
INSERT INTO public.role_grant VALUES ('a34cf62e-842d-4a6b-a51a-244e83b3d6c4', '64587a9f-cc18-4d7e-bbb2-773be095cc20', 'sales', '6c976b6f-a023-4539-bb98-a17a3c33000e', '2026-09-17 06:57:18.355793-07', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', NULL, NULL, NULL);
INSERT INTO public.role_grant VALUES ('9f020085-4784-486a-a96d-df4e06cf160f', '67ec2967-5872-4cc3-a8c6-c7fdfbf7c8d4', 'driver_service', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '2026-09-17 06:57:18.36214-07', '0c2bc5b4-ee7d-4915-b263-68f1189ea69c', NULL, NULL, NULL);


--
-- Data for Name: sample_withdrawal; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sample_withdrawal VALUES ('ee201cff-452b-4766-9316-2f9b24d5d29f', 'cedd932e-f4e5-4e5d-a871-7b614335f894', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '95f8f51c-c694-4432-8a26-1d10285ad100', 2, '2026-09-15', 'Tasting at Dogpatch (demo)', 'withdrawn', NULL, '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.786674-07');
INSERT INTO public.sample_withdrawal VALUES ('192aa94e-4c51-4836-ae76-4ee2f1515d8e', '6c976b6f-a023-4539-bb98-a17a3c33000e', 'e435c069-e41b-4077-9421-e1779aef343b', '64587a9f-cc18-4d7e-bbb2-773be095cc20', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 1, '2026-09-16', NULL, 'withdrawn', NULL, '64587a9f-cc18-4d7e-bbb2-773be095cc20', '2026-09-17 06:57:18.791693-07');


--
-- Data for Name: sku; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sku VALUES ('95f8f51c-c694-4432-8a26-1d10285ad100', 'CAN-12C', '12 oz can case', 'Cantinesca', 'case_12oz_can', 'case (24 × 12 oz)', 0, NULL, NULL, '2026-09-17 06:57:18.365056-07');
INSERT INTO public.sku VALUES ('5af594ee-2c50-48bc-a69f-6a4cfe83db1a', 'CAN-24C', '24 oz can case', 'Cantinesca', 'case_24oz_can', 'case (12 × 24 oz)', 0, NULL, NULL, '2026-09-17 06:57:18.366793-07');
INSERT INTO public.sku VALUES ('1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 'CAN-SIX', '1/6 bbl keg', 'Cantinesca', 'keg_sixtel', '1/6 bbl keg', 1, NULL, NULL, '2026-09-17 06:57:18.368129-07');
INSERT INTO public.sku VALUES ('76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', 'CAN-HALF', '1/2 bbl keg', 'Cantinesca', 'keg_half', '1/2 bbl keg', 1, NULL, NULL, '2026-09-17 06:57:18.369233-07');
INSERT INTO public.sku VALUES ('c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 'SUN-12C', '12 oz can case', 'Sunlight Groove', 'case_12oz_can', 'case (24 × 12 oz)', 0, NULL, NULL, '2026-09-17 06:57:18.370727-07');
INSERT INTO public.sku VALUES ('f7402f85-342b-4cd0-a818-5bacb80c2536', 'SUN-SIX', '1/6 bbl keg', 'Sunlight Groove', 'keg_sixtel', '1/6 bbl keg', 1, NULL, NULL, '2026-09-17 06:57:18.371936-07');


--
-- Data for Name: standing_arrangement; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.standing_arrangement VALUES ('efbda932-9dc7-41a0-a480-3b95be685368', '1f1102a1-f0fd-46d0-a671-4fe1e8cbe975', 'defined', 'Buyer asked by email on 9/1 (demo)', 'every two weeks', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.671808-07', NULL, NULL);


--
-- Data for Name: standing_arrangement_line; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.standing_arrangement_line VALUES ('16aca0ef-79f8-431d-860b-33f50a8e0879', 'efbda932-9dc7-41a0-a480-3b95be685368', '95f8f51c-c694-4432-8a26-1d10285ad100', 4);


--
-- Data for Name: standing_occurrence; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: stock_movement; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.stock_movement VALUES ('37a0892a-3ca8-48eb-8577-d2c032306f0f', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '95f8f51c-c694-4432-8a26-1d10285ad100', 'opening', 40, NULL, NULL, 'demo seed opening count (host brewery cellar sheet)', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.414113-07');
INSERT INTO public.stock_movement VALUES ('1e5d07be-3829-4cae-b704-f0f1d2486569', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '5af594ee-2c50-48bc-a69f-6a4cfe83db1a', 'opening', 18, NULL, NULL, 'demo seed opening count (host brewery cellar sheet)', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.4237-07');
INSERT INTO public.stock_movement VALUES ('3cd159a3-5716-432b-ad66-61e481603af1', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 'opening', 12, NULL, NULL, 'demo seed opening count (host brewery cellar sheet)', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.433987-07');
INSERT INTO public.stock_movement VALUES ('75c3486d-09d4-4d09-90ce-98bcc2191038', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', 'opening', 6, NULL, NULL, 'demo seed opening count (host brewery cellar sheet)', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.44568-07');
INSERT INTO public.stock_movement VALUES ('86a7c60f-c257-4607-8522-06fb64fac4e5', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 'opening', 24, NULL, NULL, 'demo seed opening count (host brewery cellar sheet)', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.452015-07');
INSERT INTO public.stock_movement VALUES ('badcdbfc-65aa-4e90-8aa1-8a51483a6440', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'f7402f85-342b-4cd0-a818-5bacb80c2536', 'opening', 2, NULL, NULL, 'demo seed opening count (host brewery cellar sheet)', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.459341-07');
INSERT INTO public.stock_movement VALUES ('23c54253-d675-4ced-87fa-4adf3cc89e21', 'e435c069-e41b-4077-9421-e1779aef343b', '95f8f51c-c694-4432-8a26-1d10285ad100', 'opening', 30, NULL, NULL, 'demo seed opening count', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.466381-07');
INSERT INTO public.stock_movement VALUES ('dc66bc28-5b44-4dab-894a-f9a51e5cfed7', 'e435c069-e41b-4077-9421-e1779aef343b', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 'opening', 8, NULL, NULL, 'demo seed opening count', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.473862-07');
INSERT INTO public.stock_movement VALUES ('91f9f7ff-3afc-4514-94ff-f4552f7d580d', 'e435c069-e41b-4077-9421-e1779aef343b', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 'opening', 12, NULL, NULL, 'demo seed opening count', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.47982-07');
INSERT INTO public.stock_movement VALUES ('3c6c5691-6c7c-4d47-9540-7e7183f1023c', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '95f8f51c-c694-4432-8a26-1d10285ad100', 'sample_withdrawal', -2, 'sample_withdrawal', 'ee201cff-452b-4766-9316-2f9b24d5d29f', 'Sample withdrawal by rep on 2026-09-15', '9f28a54e-dd7f-4e1a-9bbb-25373f6a9e93', '2026-09-17 06:57:18.786674-07');
INSERT INTO public.stock_movement VALUES ('64dcdd5f-3946-4874-abd9-845445bdbff6', 'e435c069-e41b-4077-9421-e1779aef343b', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 'sample_withdrawal', -1, 'sample_withdrawal', '192aa94e-4c51-4836-ae76-4ee2f1515d8e', 'Sample withdrawal by rep on 2026-09-16', '64587a9f-cc18-4d7e-bbb2-773be095cc20', '2026-09-17 06:57:18.791693-07');


--
-- Data for Name: stock_position; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.stock_position VALUES ('3a05b855-e74b-4499-ad5f-be1376b2e07c', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '5af594ee-2c50-48bc-a69f-6a4cfe83db1a', 18, 0, 0, 0, 'demo seed opening count (host brewery cellar sheet)', '2026-09-17 06:57:18.424-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.424-07');
INSERT INTO public.stock_position VALUES ('cf2f0dcc-ab61-48e1-96c3-cafca93acfe9', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 12, 0, 0, 0, 'demo seed opening count (host brewery cellar sheet)', '2026-09-17 06:57:18.438-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.438-07');
INSERT INTO public.stock_position VALUES ('352d9ba5-ca7f-48b1-8b94-d849067211b5', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '76ed6f7e-8d1a-4eef-be6b-9bdee31c4799', 6, 0, 0, 0, 'demo seed opening count (host brewery cellar sheet)', '2026-09-17 06:57:18.446-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.446-07');
INSERT INTO public.stock_position VALUES ('b1b34ff9-9291-400c-82bc-0d629462c3d6', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 24, 0, 0, 0, 'demo seed opening count (host brewery cellar sheet)', '2026-09-17 06:57:18.453-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.453-07');
INSERT INTO public.stock_position VALUES ('79bef6d9-12a5-43ef-8203-16e708675c4a', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'f7402f85-342b-4cd0-a818-5bacb80c2536', 2, 0, 0, 0, 'demo seed opening count (host brewery cellar sheet)', '2026-09-17 06:57:18.46-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.46-07');
INSERT INTO public.stock_position VALUES ('cb84cd4d-9fc8-4f71-9cef-8ed8b72002c2', 'e435c069-e41b-4077-9421-e1779aef343b', '95f8f51c-c694-4432-8a26-1d10285ad100', 30, 0, 0, 0, 'demo seed opening count', '2026-09-17 06:57:18.467-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.467-07');
INSERT INTO public.stock_position VALUES ('1bd59661-c9bf-42de-a961-b978ada4d38a', 'e435c069-e41b-4077-9421-e1779aef343b', '1e1e97bc-f89b-46ef-8797-e8a1dae400ef', 8, 0, 0, 0, 'demo seed opening count', '2026-09-17 06:57:18.474-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.474-07');
INSERT INTO public.stock_position VALUES ('4950185a-f187-4591-9d8f-fa590243cfb0', '0d4b1fa1-9095-4e20-a22c-458f484fa98a', '95f8f51c-c694-4432-8a26-1d10285ad100', 38, 0, 0, 0, 'demo seed opening count (host brewery cellar sheet)', '2026-09-17 06:57:18.416-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.79-07');
INSERT INTO public.stock_position VALUES ('e9a2c916-675e-4cdb-ad85-7fc48a72731b', 'e435c069-e41b-4077-9421-e1779aef343b', 'c5b5ecfc-5ede-4358-9e45-3ba0a5b3bf4d', 11, 0, 0, 0, 'demo seed opening count', '2026-09-17 06:57:18.483-07', 'a2c125fb-8266-4ad3-8218-6bb96eb4c22d', '2026-09-17 06:57:18.795-07');


--
-- Data for Name: warehouse; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.warehouse VALUES ('0d4b1fa1-9095-4e20-a22c-458f484fa98a', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'East Brother Beer Co. (Richmond, CA)', NULL, true, 'host brewery cellar lead', true, '2026-09-17 06:57:18.314854-07');
INSERT INTO public.warehouse VALUES ('7ef1c135-c690-4bc4-ae69-b37efc33e147', 'cedd932e-f4e5-4e5d-a871-7b614335f894', 'Overflow cold storage (Oakland)', NULL, false, '3PL desk', true, '2026-09-17 06:57:18.316466-07');
INSERT INTO public.warehouse VALUES ('e435c069-e41b-4077-9421-e1779aef343b', '6c976b6f-a023-4539-bb98-a17a3c33000e', 'Beachwood (Huntington Beach, CA)', NULL, true, 'host brewery', true, '2026-09-17 06:57:18.31821-07');
INSERT INTO public.warehouse VALUES ('762f281f-2d01-443e-8630-e9162ac3ad70', '8e476704-ed63-4fb4-adb7-7d0443107190', 'Jack''s Abby (Framingham, MA)', NULL, true, 'host brewery', true, '2026-09-17 06:57:18.319911-07');


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: -
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 2, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: address_assessment address_assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_assessment
    ADD CONSTRAINT address_assessment_pkey PRIMARY KEY (id);


--
-- Name: address address_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address
    ADD CONSTRAINT address_pkey PRIMARY KEY (id);


--
-- Name: audit_event audit_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id);


--
-- Name: billing_email_change_request billing_email_change_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_email_change_request
    ADD CONSTRAINT billing_email_change_request_pkey PRIMARY KEY (id);


--
-- Name: capability_gate capability_gate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_gate
    ADD CONSTRAINT capability_gate_pkey PRIMARY KEY (id);


--
-- Name: cleaning_obligation cleaning_obligation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_obligation
    ADD CONSTRAINT cleaning_obligation_pkey PRIMARY KEY (id);


--
-- Name: contact contact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact
    ADD CONSTRAINT contact_pkey PRIMARY KEY (id);


--
-- Name: customer_location customer_location_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_location
    ADD CONSTRAINT customer_location_pkey PRIMARY KEY (id);


--
-- Name: customer_order customer_order_order_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_order
    ADD CONSTRAINT customer_order_order_number_unique UNIQUE (order_number);


--
-- Name: customer_order customer_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_order
    ADD CONSTRAINT customer_order_pkey PRIMARY KEY (id);


--
-- Name: customer_parent customer_parent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_parent
    ADD CONSTRAINT customer_parent_pkey PRIMARY KEY (id);


--
-- Name: decision decision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision
    ADD CONSTRAINT decision_pkey PRIMARY KEY (id);


--
-- Name: decision_selection decision_selection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_selection
    ADD CONSTRAINT decision_selection_pkey PRIMARY KEY (id);


--
-- Name: delivery_visit_line delivery_visit_line_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_visit_line
    ADD CONSTRAINT delivery_visit_line_pkey PRIMARY KEY (id);


--
-- Name: delivery_visit delivery_visit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_visit
    ADD CONSTRAINT delivery_visit_pkey PRIMARY KEY (id);


--
-- Name: employee_identity employee_identity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_identity
    ADD CONSTRAINT employee_identity_pkey PRIMARY KEY (id);


--
-- Name: employee employee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_pkey PRIMARY KEY (id);


--
-- Name: exception_case exception_case_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exception_case
    ADD CONSTRAINT exception_case_pkey PRIMARY KEY (id);


--
-- Name: exception_link exception_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exception_link
    ADD CONSTRAINT exception_link_pkey PRIMARY KEY (id);


--
-- Name: exception_note exception_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exception_note
    ADD CONSTRAINT exception_note_pkey PRIMARY KEY (id);


--
-- Name: hold_override hold_override_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hold_override
    ADD CONSTRAINT hold_override_pkey PRIMARY KEY (id);


--
-- Name: hold hold_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hold
    ADD CONSTRAINT hold_pkey PRIMARY KEY (id);


--
-- Name: invoice_obligation invoice_obligation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_obligation
    ADD CONSTRAINT invoice_obligation_pkey PRIMARY KEY (id);


--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (id);


--
-- Name: keg_movement keg_movement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keg_movement
    ADD CONSTRAINT keg_movement_pkey PRIMARY KEY (id);


--
-- Name: license_verification license_verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license_verification
    ADD CONSTRAINT license_verification_pkey PRIMARY KEY (id);


--
-- Name: location_address location_address_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_address
    ADD CONSTRAINT location_address_pkey PRIMARY KEY (id);


--
-- Name: location_contact location_contact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_contact
    ADD CONSTRAINT location_contact_pkey PRIMARY KEY (id);


--
-- Name: location_rep_history location_rep_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_rep_history
    ADD CONSTRAINT location_rep_history_pkey PRIMARY KEY (id);


--
-- Name: market market_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market
    ADD CONSTRAINT market_code_unique UNIQUE (code);


--
-- Name: market market_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market
    ADD CONSTRAINT market_pkey PRIMARY KEY (id);


--
-- Name: market_price market_price_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price
    ADD CONSTRAINT market_price_pkey PRIMARY KEY (id);


--
-- Name: notice notice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notice
    ADD CONSTRAINT notice_pkey PRIMARY KEY (id);


--
-- Name: order_intake_request order_intake_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_intake_request
    ADD CONSTRAINT order_intake_request_pkey PRIMARY KEY (id);


--
-- Name: order_line_change order_line_change_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line_change
    ADD CONSTRAINT order_line_change_pkey PRIMARY KEY (id);


--
-- Name: order_line order_line_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_pkey PRIMARY KEY (id);


--
-- Name: payment_relationship payment_relationship_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_relationship
    ADD CONSTRAINT payment_relationship_pkey PRIMARY KEY (id);


--
-- Name: provider_connection provider_connection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_connection
    ADD CONSTRAINT provider_connection_pkey PRIMARY KEY (provider);


--
-- Name: provider_event provider_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_event
    ADD CONSTRAINT provider_event_pkey PRIMARY KEY (id);


--
-- Name: provider_reference provider_reference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_reference
    ADD CONSTRAINT provider_reference_pkey PRIMARY KEY (id);


--
-- Name: reservation reservation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_pkey PRIMARY KEY (id);


--
-- Name: role_grant role_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grant
    ADD CONSTRAINT role_grant_pkey PRIMARY KEY (id);


--
-- Name: sample_withdrawal sample_withdrawal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_withdrawal
    ADD CONSTRAINT sample_withdrawal_pkey PRIMARY KEY (id);


--
-- Name: sku sku_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku
    ADD CONSTRAINT sku_code_unique UNIQUE (code);


--
-- Name: sku sku_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku
    ADD CONSTRAINT sku_pkey PRIMARY KEY (id);


--
-- Name: standing_arrangement_line standing_arrangement_line_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standing_arrangement_line
    ADD CONSTRAINT standing_arrangement_line_pkey PRIMARY KEY (id);


--
-- Name: standing_arrangement standing_arrangement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standing_arrangement
    ADD CONSTRAINT standing_arrangement_pkey PRIMARY KEY (id);


--
-- Name: standing_occurrence standing_occurrence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standing_occurrence
    ADD CONSTRAINT standing_occurrence_pkey PRIMARY KEY (id);


--
-- Name: stock_movement stock_movement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_pkey PRIMARY KEY (id);


--
-- Name: stock_position stock_position_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_position
    ADD CONSTRAINT stock_position_pkey PRIMARY KEY (id);


--
-- Name: warehouse warehouse_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT warehouse_pkey PRIMARY KEY (id);


--
-- Name: audit_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_at_idx ON public.audit_event USING btree (at);


--
-- Name: audit_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_subject_idx ON public.audit_event USING btree (subject_type, subject_id);


--
-- Name: contact_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_email_idx ON public.contact USING btree (email);


--
-- Name: customer_location_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_location_market_idx ON public.customer_location USING btree (market_id);


--
-- Name: customer_location_trade_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_location_trade_name_idx ON public.customer_location USING btree (trade_name);


--
-- Name: decision_selection_decision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_selection_decision_idx ON public.decision_selection USING btree (decision_id);


--
-- Name: delivery_visit_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_visit_location_idx ON public.delivery_visit USING btree (location_id);


--
-- Name: employee_identity_current_email_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_identity_current_email_uq ON public.employee_identity USING btree (email) WHERE (current = true);


--
-- Name: employee_identity_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_identity_email_idx ON public.employee_identity USING btree (email);


--
-- Name: employee_identity_subject_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_identity_subject_uq ON public.employee_identity USING btree (google_subject) WHERE (google_subject IS NOT NULL);


--
-- Name: exception_dedupe_open_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exception_dedupe_open_uq ON public.exception_case USING btree (dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND (state <> 'resolved'::public.exception_state));


--
-- Name: exception_link_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exception_link_subject_idx ON public.exception_link USING btree (subject_type, subject_id);


--
-- Name: exception_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exception_location_idx ON public.exception_case USING btree (location_id);


--
-- Name: exception_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exception_state_idx ON public.exception_case USING btree (state);


--
-- Name: hold_location_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hold_location_active_idx ON public.hold USING btree (location_id, active);


--
-- Name: job_dedupe_active_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX job_dedupe_active_uq ON public.job USING btree (dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND (status = ANY (ARRAY['queued'::public.job_status, 'running'::public.job_status])));


--
-- Name: job_status_run_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_status_run_at_idx ON public.job USING btree (status, run_at);


--
-- Name: keg_movement_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX keg_movement_location_idx ON public.keg_movement USING btree (location_id);


--
-- Name: location_address_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_address_idx ON public.location_address USING btree (location_id, kind, current);


--
-- Name: location_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_contact_idx ON public.location_contact USING btree (location_id, current);


--
-- Name: market_price_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_price_lookup_idx ON public.market_price USING btree (market_id, sku_id, effective_from);


--
-- Name: notice_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notice_subject_idx ON public.notice USING btree (subject_type, subject_id);


--
-- Name: order_line_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_line_order_idx ON public.order_line USING btree (order_id);


--
-- Name: order_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_location_idx ON public.customer_order USING btree (location_id, submitted_at);


--
-- Name: order_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_market_idx ON public.customer_order USING btree (market_id, submitted_at);


--
-- Name: order_submission_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_submission_key_uq ON public.customer_order USING btree (location_id, submission_key) WHERE (submission_key IS NOT NULL);


--
-- Name: provider_event_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_event_uq ON public.provider_event USING btree (provider, event_id);


--
-- Name: provider_reference_pending_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_reference_pending_uq ON public.provider_reference USING btree (provider, subject_type, subject_id, provider_object) WHERE (provider_id IS NULL);


--
-- Name: provider_reference_provider_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_reference_provider_id_uq ON public.provider_reference USING btree (provider, provider_object, provider_id);


--
-- Name: provider_reference_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_reference_subject_idx ON public.provider_reference USING btree (subject_type, subject_id);


--
-- Name: reservation_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_line_idx ON public.reservation USING btree (order_line_id);


--
-- Name: reservation_wh_sku_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_wh_sku_state_idx ON public.reservation USING btree (warehouse_id, sku_id, state);


--
-- Name: role_grant_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_grant_employee_idx ON public.role_grant USING btree (employee_id);


--
-- Name: sample_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sample_market_idx ON public.sample_withdrawal USING btree (market_id, withdrawn_on);


--
-- Name: standing_occurrence_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX standing_occurrence_uq ON public.standing_occurrence USING btree (arrangement_id, cycle_key);


--
-- Name: stock_movement_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movement_lookup_idx ON public.stock_movement USING btree (warehouse_id, sku_id, at);


--
-- Name: stock_position_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_position_uq ON public.stock_position USING btree (warehouse_id, sku_id);


--
-- Name: warehouse_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX warehouse_market_idx ON public.warehouse USING btree (market_id);


--
-- Name: address_assessment address_assessment_address_id_address_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_assessment
    ADD CONSTRAINT address_assessment_address_id_address_id_fk FOREIGN KEY (address_id) REFERENCES public.address(id);


--
-- Name: billing_email_change_request billing_email_change_request_location_id_customer_location_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_email_change_request
    ADD CONSTRAINT billing_email_change_request_location_id_customer_location_id_f FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: cleaning_obligation cleaning_obligation_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cleaning_obligation
    ADD CONSTRAINT cleaning_obligation_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: customer_location customer_location_market_id_market_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_location
    ADD CONSTRAINT customer_location_market_id_market_id_fk FOREIGN KEY (market_id) REFERENCES public.market(id);


--
-- Name: customer_location customer_location_parent_id_customer_parent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_location
    ADD CONSTRAINT customer_location_parent_id_customer_parent_id_fk FOREIGN KEY (parent_id) REFERENCES public.customer_parent(id);


--
-- Name: customer_order customer_order_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_order
    ADD CONSTRAINT customer_order_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: customer_order customer_order_market_id_market_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_order
    ADD CONSTRAINT customer_order_market_id_market_id_fk FOREIGN KEY (market_id) REFERENCES public.market(id);


--
-- Name: customer_order customer_order_warehouse_id_warehouse_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_order
    ADD CONSTRAINT customer_order_warehouse_id_warehouse_id_fk FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: decision_selection decision_selection_decision_id_decision_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_selection
    ADD CONSTRAINT decision_selection_decision_id_decision_id_fk FOREIGN KEY (decision_id) REFERENCES public.decision(id);


--
-- Name: delivery_visit_line delivery_visit_line_order_id_customer_order_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_visit_line
    ADD CONSTRAINT delivery_visit_line_order_id_customer_order_id_fk FOREIGN KEY (order_id) REFERENCES public.customer_order(id);


--
-- Name: delivery_visit_line delivery_visit_line_visit_id_delivery_visit_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_visit_line
    ADD CONSTRAINT delivery_visit_line_visit_id_delivery_visit_id_fk FOREIGN KEY (visit_id) REFERENCES public.delivery_visit(id);


--
-- Name: delivery_visit delivery_visit_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_visit
    ADD CONSTRAINT delivery_visit_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: employee_identity employee_identity_employee_id_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_identity
    ADD CONSTRAINT employee_identity_employee_id_employee_id_fk FOREIGN KEY (employee_id) REFERENCES public.employee(id);


--
-- Name: exception_link exception_link_case_id_exception_case_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exception_link
    ADD CONSTRAINT exception_link_case_id_exception_case_id_fk FOREIGN KEY (case_id) REFERENCES public.exception_case(id);


--
-- Name: exception_note exception_note_case_id_exception_case_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exception_note
    ADD CONSTRAINT exception_note_case_id_exception_case_id_fk FOREIGN KEY (case_id) REFERENCES public.exception_case(id);


--
-- Name: hold hold_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hold
    ADD CONSTRAINT hold_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: hold_override hold_override_hold_id_hold_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hold_override
    ADD CONSTRAINT hold_override_hold_id_hold_id_fk FOREIGN KEY (hold_id) REFERENCES public.hold(id);


--
-- Name: hold_override hold_override_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hold_override
    ADD CONSTRAINT hold_override_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: invoice_obligation invoice_obligation_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_obligation
    ADD CONSTRAINT invoice_obligation_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: invoice_obligation invoice_obligation_visit_id_delivery_visit_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_obligation
    ADD CONSTRAINT invoice_obligation_visit_id_delivery_visit_id_fk FOREIGN KEY (visit_id) REFERENCES public.delivery_visit(id);


--
-- Name: keg_movement keg_movement_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keg_movement
    ADD CONSTRAINT keg_movement_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: license_verification license_verification_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license_verification
    ADD CONSTRAINT license_verification_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: location_address location_address_address_id_address_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_address
    ADD CONSTRAINT location_address_address_id_address_id_fk FOREIGN KEY (address_id) REFERENCES public.address(id);


--
-- Name: location_address location_address_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_address
    ADD CONSTRAINT location_address_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: location_contact location_contact_contact_id_contact_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_contact
    ADD CONSTRAINT location_contact_contact_id_contact_id_fk FOREIGN KEY (contact_id) REFERENCES public.contact(id);


--
-- Name: location_contact location_contact_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_contact
    ADD CONSTRAINT location_contact_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: location_rep_history location_rep_history_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_rep_history
    ADD CONSTRAINT location_rep_history_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: market_price market_price_market_id_market_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price
    ADD CONSTRAINT market_price_market_id_market_id_fk FOREIGN KEY (market_id) REFERENCES public.market(id);


--
-- Name: market_price market_price_sku_id_sku_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_price
    ADD CONSTRAINT market_price_sku_id_sku_id_fk FOREIGN KEY (sku_id) REFERENCES public.sku(id);


--
-- Name: order_intake_request order_intake_request_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_intake_request
    ADD CONSTRAINT order_intake_request_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: order_intake_request order_intake_request_market_id_market_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_intake_request
    ADD CONSTRAINT order_intake_request_market_id_market_id_fk FOREIGN KEY (market_id) REFERENCES public.market(id);


--
-- Name: order_line_change order_line_change_order_line_id_order_line_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line_change
    ADD CONSTRAINT order_line_change_order_line_id_order_line_id_fk FOREIGN KEY (order_line_id) REFERENCES public.order_line(id);


--
-- Name: order_line order_line_order_id_customer_order_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_order_id_customer_order_id_fk FOREIGN KEY (order_id) REFERENCES public.customer_order(id);


--
-- Name: order_line order_line_sku_id_sku_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_sku_id_sku_id_fk FOREIGN KEY (sku_id) REFERENCES public.sku(id);


--
-- Name: payment_relationship payment_relationship_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_relationship
    ADD CONSTRAINT payment_relationship_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: reservation reservation_order_line_id_order_line_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_order_line_id_order_line_id_fk FOREIGN KEY (order_line_id) REFERENCES public.order_line(id);


--
-- Name: reservation reservation_sku_id_sku_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_sku_id_sku_id_fk FOREIGN KEY (sku_id) REFERENCES public.sku(id);


--
-- Name: reservation reservation_warehouse_id_warehouse_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_warehouse_id_warehouse_id_fk FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: role_grant role_grant_employee_id_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grant
    ADD CONSTRAINT role_grant_employee_id_employee_id_fk FOREIGN KEY (employee_id) REFERENCES public.employee(id);


--
-- Name: sample_withdrawal sample_withdrawal_market_id_market_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_withdrawal
    ADD CONSTRAINT sample_withdrawal_market_id_market_id_fk FOREIGN KEY (market_id) REFERENCES public.market(id);


--
-- Name: sample_withdrawal sample_withdrawal_sku_id_sku_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_withdrawal
    ADD CONSTRAINT sample_withdrawal_sku_id_sku_id_fk FOREIGN KEY (sku_id) REFERENCES public.sku(id);


--
-- Name: sample_withdrawal sample_withdrawal_warehouse_id_warehouse_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_withdrawal
    ADD CONSTRAINT sample_withdrawal_warehouse_id_warehouse_id_fk FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: standing_arrangement_line standing_arrangement_line_arrangement_id_standing_arrangement_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standing_arrangement_line
    ADD CONSTRAINT standing_arrangement_line_arrangement_id_standing_arrangement_i FOREIGN KEY (arrangement_id) REFERENCES public.standing_arrangement(id);


--
-- Name: standing_arrangement_line standing_arrangement_line_sku_id_sku_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standing_arrangement_line
    ADD CONSTRAINT standing_arrangement_line_sku_id_sku_id_fk FOREIGN KEY (sku_id) REFERENCES public.sku(id);


--
-- Name: standing_arrangement standing_arrangement_location_id_customer_location_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standing_arrangement
    ADD CONSTRAINT standing_arrangement_location_id_customer_location_id_fk FOREIGN KEY (location_id) REFERENCES public.customer_location(id);


--
-- Name: standing_occurrence standing_occurrence_arrangement_id_standing_arrangement_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standing_occurrence
    ADD CONSTRAINT standing_occurrence_arrangement_id_standing_arrangement_id_fk FOREIGN KEY (arrangement_id) REFERENCES public.standing_arrangement(id);


--
-- Name: stock_movement stock_movement_sku_id_sku_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_sku_id_sku_id_fk FOREIGN KEY (sku_id) REFERENCES public.sku(id);


--
-- Name: stock_movement stock_movement_warehouse_id_warehouse_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movement
    ADD CONSTRAINT stock_movement_warehouse_id_warehouse_id_fk FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: stock_position stock_position_sku_id_sku_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_position
    ADD CONSTRAINT stock_position_sku_id_sku_id_fk FOREIGN KEY (sku_id) REFERENCES public.sku(id);


--
-- Name: stock_position stock_position_warehouse_id_warehouse_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_position
    ADD CONSTRAINT stock_position_warehouse_id_warehouse_id_fk FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: warehouse warehouse_market_id_market_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT warehouse_market_id_market_id_fk FOREIGN KEY (market_id) REFERENCES public.market(id);


--
-- PostgreSQL database dump complete
--


