# Staff usability session — script (to be run with real staff; not yet performed)

The nine browser journeys in `tests/ui/journeys.mjs` are **automated** validation with fictional data. They
prove the flows work and measure machine time; they do not tell us where a person hesitates. This script is
for a later session with actual Sales, Admin, Accounting and Owner staff. Nothing in this document reports a
session that has happened.

## Setup (10 minutes, facilitator)
* A laptop and a phone, both on `npm run demo` after `npm run demo:reset` (fresh fictional data). Use
  *Switch demo user* to hand each participant their role.
* Tell participants: the data is fictional; nothing they do reaches a customer or a provider; we measure the
  product, not them. Ask them to think aloud. Do not help unless they are stuck for more than 60 seconds;
  note every intervention.
* Record per task: start/stop time, number of wrong turns (pages opened that were not needed), whether the
  participant could say afterwards *what the system did* in their own words, and the quote that best
  captures their reaction.

## Tasks (one participant per role; ~40 minutes each)

### Sales (phone first, then laptop)
1. "A new bar, *Golden Gate Grill* on Journey Ave, wants to order. Create the account with just what you
   know: buyer Jo, AP desk email. Then place their first order — three sixtels and a case." Expected: the
   same-name warning is read as a warning; the readiness line is understood ("license needed before
   delivery, order captured anyway"); the stock note ("some units are waiting for stock") is understood.
2. "Dogpatch wants the same as last time." Expected: finds *Repeat*, notices the price-changed badge and the
   product not carried over, changes a quantity, submits once.
3. "The buyer at Golden Gate now wants four sixtels instead of three." Expected: finds *Request change* and
   understands that Admin applies it.
4. Ask: "What is waiting on you for this account?" Expected: reads it from the *Waiting on* list.

### Admin (laptop)
5. "Ten Sunlight sixtels arrived at East Brother — the transfer sheet is #J4." Expected: records a receipt
   with evidence; sees the waiting order refilled; sees the shortage case gone from the command center and
   the below-minimum case still there — and can say why.
6. "Two cases arrived damaged." Expected: records damage as a count of damaged units; understands it can
   never add stock.
7. "The bar cancelled the second order." Expected: cancels remaining demand; understands what happened to
   the reserved units and to the unsent notice.
8. "Lee has left the company; a new person, also called Lee, starts Monday with the same email." Expected:
   disables, offboards, provisions the new Lee with only the intended grant; can explain that history stayed.

### Accounting (laptop)
9. "Set up ACH for Golden Gate Grill." Expected: notices that setup needs a payer; assigns payer authority
   deliberately (not the AP desk unless they say so and note why); requests setup; finds the invitation in
   Notices; records the manual send with evidence; understands "staff evidence, not provider confirmation".
10. Ask: "Is Stripe connected?" Expected: reads the five facts on Integrations and answers "no — the adapter
    is built, no key, nothing verified".

### Owner (phone)
11. "Decide that the $90 minimum counts merchandise only, everywhere, from next Monday; NC keeps deposits
    counted." Expected: records an all-markets selection with the typed field and date, then an NC-only
    selection; reads the matrix; withdraws one selection and sees the other survive.
12. "Find every place you can go from your phone and sign out." Expected: bottom bar + *More* lists every
    permitted destination; sign-out works.

## Measures to report afterwards
* Task time and wrong turns per task; interventions.
* The three most common hesitations (verbatim quotes) and which screen caused them.
* Any state the participant could not explain in their own words → candidate for UX-04 wording.
* Anything the participant expected to exist that is later-phase or an unselected decision → confirm the
  screen said so honestly; if not, that is a defect.

## What this session must not do
* Use real customer data, real employee emails or a real Stripe/Google account.
* Change any decision selection in a production environment.
* Be reported as acceptance for AT61/AT62, provider capability gates or production readiness — those need
  the real accounts named in `ACTIVATION_CHECKLIST.md`.
