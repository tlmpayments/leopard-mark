# Provider Commissioning Checklist

Every external item Familiar Ventures must supply or authorize, who supplies it, and the state it puts the
integration in. States follow the brief's build-versus-activate model: NOT IMPLEMENTED → IMPLEMENTED / NOT
CONNECTED → CONNECTED / TEST MODE → CONNECTED / CAPABILITY UNVERIFIED → ACCEPTED FOR LIVE USE → LIVE /
DEGRADED OR DISCONNECTED. The live view is **Integrations** in the application.

**A successful API request is not "integration complete."** Capability gates (brief §49) are recorded by a
person with evidence on the Integrations page; the code never marks a gate demonstrated.

The Integrations page keeps **five facts apart** for every provider, and each must be established on its own:

| Fact | Established by | What it does *not* mean |
|---|---|---|
| **Built** | the adapter exists in this repository (`built` / `boundary_only` / `not_implemented`) | nothing about the company account |
| **Credentials present** | the named environment variable is set (its value is never shown or stored) | not a connection — a dummy or wrong-account key looks the same here |
| **Connection verified** | a person runs *Check connectivity*; the verified account id and a fingerprint of the credential are recorded (`untested` / `ok` / `failed` / `stale` after a key change) | not a demonstrated capability |
| **Capability demonstrated** | a person records the §49 gate with evidence after performing the real workflow in the company's test account | not authorization to use it live |
| **Authorized for live use** | a person with authority records the activation (mode, date, who) after the ACTIVATION_CHECKLIST items for that branch are done | — |

Provider references (e.g. a Stripe customer id) are stored with the provider **account and mode** they were
created in. A key for a different account or mode never reuses them; work that needs an unavailable provider
**waits** and resumes after a verified connection.

## Employee sign-in — company email + PIN (phase 1, no provider needed)

| Item | Who supplies | Where it goes |
|---|---|---|
| First Owner email and temporary PIN | Owner | `OWNER_EMAIL`, `OWNER_PIN` on the one-time `npm run bootstrap` command |
| Every employee's company email, role, market scope and a temporary PIN handed over in person | Owner/Admin in the app | Admin → Employees & access (the PIN is never shown again) |
| Lost-PIN handling | Owner/Admin (*Reset PIN*); `npm run set-pin` from a trusted machine for the only Owner | — |
| Offboarding | Owner/Admin: disable, then offboard (PIN ended, identity retired, grants revoked) | — |
| Test people for the access gates | Admin | gates `ACCESS_STABLE_IDENTITY`, `ACCESS_EFFECTIVE_DISABLE` — proven automatically (journeys 7 and 10), **not yet with real staff** |

## Google Workspace / Google Identity — OPTIONAL second sign-in method

| Item | Who supplies | Where it goes |
|---|---|---|
| Google Cloud project | Owner/Admin (Workspace admin) | — |
| OAuth 2.0 Web client (client id/secret) | Workspace admin | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Allowed Workspace domain | Owner | `GOOGLE_ALLOWED_HD` (e.g. `theleopardmark.com`) |
| Authorized redirect URI | Workspace admin registers | `https://<domain>/api/auth/google/callback` |
| Scopes | fixed | `openid email profile` |
| Authorized employee identity setup | Owner/Admin provisions by email in the app (same records as PIN sign-in; the first Google sign-in binds the account) | Admin → Employees & access |
| Account lifecycle/offboarding | Owner/Admin disable in app **and** suspend in Workspace (related, distinct) | — |
| Test users for access and revocation acceptance (rename, offboard + reuse of the address, disable while signed in) | Admin | gates `ACCESS_STABLE_IDENTITY`, `ACCESS_EFFECTIVE_DISABLE` — proven with the local fixture and browser journey 7, **not yet with real Google accounts** |

## Stripe — customer association now; invoices/collections in phase 3

| Item | Who supplies | Where it goes |
|---|---|---|
| Account / environment being used | Owner/Accounting | test account first; live only after activation |
| Restricted API key (customers read/write now; invoices/credit notes/payment methods later) | Owner | `STRIPE_SECRET_KEY` |
| Webhook endpoint | Accounting/Admin registers | `https://<domain>/api/webhooks/stripe` |
| Webhook signing secret | from Stripe dashboard | `STRIPE_WEBHOOK_SECRET` |
| ACH capability/configuration (US bank account debits) | Owner enables in Stripe | gate `STRIPE_HOSTED_SETUP` |
| Hosted setup/payment configuration (Checkout setup mode, us_bank_account) | Stripe dashboard | — |
| Invoice configuration relevant to the approved process (branding, numbering scheme SD04, no Tax U21) | Owner/Accounting | phase 3 |
| Credit-note / customer-credit capabilities used | Accounting | phase 4, gate `STRIPE_CREDIT_BALANCE` |
| Enabled provider email/customer notification settings | Owner/Accounting — must fit the single-sender allocation once D32/IG04 is selected | phase 3 |
| Test-mode and production-mode separation | Owner | separate keys per Vercel environment; the app binds references to the verified account + mode and refuses to reuse them under another |
| Connection verification in the company test account (*Check connectivity*), then the customer-association and hosted-setup demonstrations | Accounting | `provider_connection` record; gates `STRIPE_CUSTOMER_ASSOCIATION`, `STRIPE_HOSTED_SETUP` |
| Account-specific capability gates still requiring demonstration | Accounting records | `STRIPE_*` gates |
| No Connect (U25), no Subscriptions (U22), no Tax (U21) | design constraint | enforced by not building them |

## OptimoRoute — phase 2 (boundary only in this revision)

| Item | Who supplies |
|---|---|
| Account/API access and purchased plan/API entitlement (no assumed Custom purchase) | Owner |
| Driver accounts | Admin |
| Route/order integration configuration; actual field/form/POD configuration; evidence retrieval/export settings | Admin with OptimoRoute |
| Customer-notification settings that must remain disabled unless approved under the single-sender policy | Admin |
| Field demonstrations for gates `OR_*` (§49 table) before initial field use | Admin |
| Env var reserved | `OPTIMOROUTE_API_KEY` |

## Gmail — customer notice transport (boundary only; notices run through the manual process)

Until D32/IG04 is selected the application sends nothing. The **manual single-sender process** is fully
supported in the app: each business event records one notice intent (recipient, content, version) in the
Notices queue; the authorized person sends it from the company mailbox and records **Sent / Failed /
Unknown** with how and with evidence; failures and missing recipients open owned cases; re-issue creates a
new version and keeps the old one. Recording "sent" is staff evidence, not provider confirmation.

| Item | Who supplies |
|---|---|
| Approved company sender/mailbox | Owner/Admin |
| Authorization method (OAuth client for a service or delegated user) and scope `gmail.send` | Workspace admin |
| Sender identity configuration and actual mailbox coverage (existing roles; no new mailbox role) | Admin |
| Provider send/bounce evidence available to the implementation | Workspace admin |
| Selected customer-notice branches once D32/IG04 is approved (the recorded intents are the migration path: the same intents would be handed to the selected sender) | Owner |
| Env vars reserved | `GMAIL_SENDER_ADDRESS`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` |

## Google Address / Maps — advisory (boundary only)

| Item | Who supplies |
|---|---|
| Google Cloud project, enabled Address Validation API, API key with restrictions, billing | Workspace admin |
| Confirmation that intended storage/onward use satisfies IG05 before restricted content is relied upon | Owner with terms advice |
| Env var reserved | `GOOGLE_MAPS_API_KEY` |

## Slack — communication only (boundary only)

| Item | Who supplies |
|---|---|
| Workspace, app/bot with `chat:write`, signing secret | Owner/Admin |
| Approved channels/destinations once IG07 is selected; test channels | Admin |
| Confirmation that Slack cannot mutate business state (the app exposes no Slack-driven action) | design; gate `SLACK_NO_MUTATION` |
| Env vars reserved | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_DEFAULT_CHANNEL` |

## QuickBooks Online — phase 3 (NOT IMPLEMENTED)

| Item | Who supplies |
|---|---|
| Intuit developer app (client id/secret), OAuth redirect `https://<domain>/api/oauth/qbo/callback`, selected QBO company (realm), sandbox connection | Accountant/Owner |
| Accountant-approved posting model (market summary / detailed mirror / proven connector / divided writers) **before** any live posting; writer assignment by economic effect; account/class/location mappings; cutover/opening positions | Accountant/Owner (IG06/D25/D29/D30/D33) |
| Env vars reserved | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REALM_ID` |

## Application-level items

| Item | Who supplies |
|---|---|
| `SESSION_SECRET`, `CRON_SECRET`, `APP_BASE_URL`, `DATABASE_URL` | Owner/Admin (Vercel + Neon) |
| First Owner email for bootstrap (`OWNER_EMAIL`) | Owner |
| Markets, primary warehouses, catalog, real market prices | Owner/Admin in the app (dev seed prices are samples) |
| Seller/invoicing context per market (D33) confirmed before financial activation | Owner |
| Decision selections with scope and effective date (D/SD/T/IG) | Owner (production); Admin/Accounting may record labelled test selections outside production |

## Credential handling rules (enforced)

Secrets are read only from the environment; they never appear in database fields, audit notes, logs or
screens (the Integrations page shows presence/absence by variable name only; a connection check stores a
one-way fingerprint of the credential, never the credential). Keys can be rotated without rewriting business
records because provider objects are referenced by provider id + account + mode, never by key: a rotation
within the same verified account keeps every association; a different account or mode starts clean.
