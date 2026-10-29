#!/usr/bin/env python3
"""Compact production load: JSON staged into temp tables, expanded by a fixed set of SQL statements.

Ids are deterministic (md5 of a natural key cast to uuid) so the load is idempotent.
Outputs: import/prod.sql (psql, one transaction) and import/prod_statements.json (Neon connector).
"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gen_import as G  # noqa: E402  (runs the dry-run generator and exposes the records)

OUT = pathlib.Path(__file__).resolve().parent
RUN = G.RUN
AS_OF = G.AS_OF
SOURCE = G.SOURCE

def dq(obj):
    """Dollar-quoted JSON literal."""
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    assert "$j$" not in s
    return "$j$" + s + "$j$::jsonb"

ref = {
    "market": [{"code": c, "name": n, "tz": tz} for c, n, tz in G.MARKETS],
    "warehouse": G.WH_RECORDS,
    "sku": G.SKU_RECORDS,
    "price": G.PRICE_RECORDS,
}
DROP_KEYS = {"contact", "phone", "email", "instructions", "window", "days", "billing_email", "billing_address", "last_cleaning"}
acct = [{k: v for k, v in r.items() if k not in DROP_KEYS and v not in (None, "", [], {})} for r in G.ACCT_RECORDS]

S = []
S.append("create temp table imp_ref (kind text, j jsonb)")
S.append("create temp table imp_acct (j jsonb)")
for kind, arr in ref.items():
    S.append(f"insert into imp_ref select '{kind}', x from jsonb_array_elements({dq(arr)}) x")
S.append(f"insert into imp_acct select x from jsonb_array_elements({dq(acct)}) x")

# helper expressions
LID = "md5('location|' || lower(j->>'name'))::uuid"
MKT = "md5('market|' || (j->>'market'))::uuid"

S.append(f"""insert into market (id, code, name, timezone, active, seller_context_note)
select md5('market|' || (j->>'code'))::uuid, j->>'code', j->>'name', j->>'tz', true, 'Created by {RUN}; seller/invoicing entity (D33) still to confirm'
from imp_ref where kind = 'market' on conflict (id) do nothing""")

S.append(f"""insert into warehouse (id, market_id, name, address_text, is_primary, fulfillment_contact, active)
select md5('warehouse|' || (j->>'key'))::uuid, {MKT}, j->>'name', j->>'address', (j->>'primary')::boolean, j->>'contact', (j->>'active')::boolean
from imp_ref where kind = 'warehouse' on conflict (id) do nothing""")

S.append("""insert into sku (id, code, name, brand, package_kind, selling_unit, kegs_per_unit, weight_lb, archived_at)
select md5('sku|' || (j->>'code'))::uuid, j->>'code', j->>'name', j->>'brand', (j->>'pk')::package_kind, j->>'unit', (j->>'kegs')::int, (j->>'wt')::numeric,
       case when (j->>'archived')::boolean then now() end
from imp_ref where kind = 'sku' on conflict (id) do nothing""")

S.append(f"""insert into market_price (id, market_id, sku_id, price_cents, effective_from)
select md5('price|' || (j->>'market') || '|' || (j->>'sku') || '|{AS_OF}')::uuid, {MKT}, md5('sku|' || (j->>'sku'))::uuid, (j->>'cents')::int, '{AS_OF}'::timestamptz
from imp_ref where kind = 'price' on conflict (id) do nothing""")

S.append(f"""insert into customer_location (id, market_id, trade_name, legal_name, status, delivery_instructions, receiving_restrictions)
select {LID}, {MKT}, j->>'name', j->>'legal', (j->>'status')::location_status, j->>'instructions_out', j->>'restrictions_out'
from imp_acct on conflict (id) do nothing""")

S.append(f"""insert into address (id, line1, city, state, postal_code, provenance)
select md5('address|' || {LID}::text || '|delivery')::uuid, j->'addr'->>'line1', j->'addr'->>'city', coalesce(nullif(j->'addr'->>'state',''),'CA'), coalesce(j->'addr'->>'postal',''), 'admin_entered'
from imp_acct where j->'addr' is not null and jsonb_typeof(j->'addr') = 'object' on conflict (id) do nothing""")

S.append(f"""insert into location_address (id, location_id, address_id, kind)
select md5('locaddr|' || {LID}::text || '|delivery')::uuid, {LID}, md5('address|' || {LID}::text || '|delivery')::uuid, 'delivery'
from imp_acct where j->'addr' is not null and jsonb_typeof(j->'addr') = 'object' on conflict (id) do nothing""")

S.append(f"""insert into address (id, line1, city, state, postal_code, provenance)
select md5('address|' || {LID}::text || '|billing')::uuid, j->'baddr'->>'line1', j->'baddr'->>'city', coalesce(nullif(j->'baddr'->>'state',''),'CA'), coalesce(j->'baddr'->>'postal',''), 'admin_entered'
from imp_acct where j->'baddr' is not null and jsonb_typeof(j->'baddr') = 'object' on conflict (id) do nothing""")

S.append(f"""insert into location_address (id, location_id, address_id, kind)
select md5('locaddr|' || {LID}::text || '|billing')::uuid, {LID},
       case when j->'baddr' is not null and jsonb_typeof(j->'baddr') = 'object' then md5('address|' || {LID}::text || '|billing')::uuid else md5('address|' || {LID}::text || '|delivery')::uuid end, 'billing'
from imp_acct where j->'addr' is not null and jsonb_typeof(j->'addr') = 'object' on conflict (id) do nothing""")

S.append(f"""insert into contact (id, name, email, phone)
select md5('contact|' || {LID}::text || '|buyer')::uuid, j->'buyer'->>'name', j->'buyer'->>'email', j->'buyer'->>'phone'
from imp_acct where j->'buyer' is not null and jsonb_typeof(j->'buyer') = 'object' on conflict (id) do nothing""")

S.append(f"""insert into location_contact (id, location_id, contact_id, contact_role, may_order, receives_invoices, may_authorize_payment)
select md5('loccontact|' || {LID}::text || '|buyer')::uuid, {LID}, md5('contact|' || {LID}::text || '|buyer')::uuid, 'buyer', true, (j->>'ap_email') is null, false
from imp_acct where j->'buyer' is not null and jsonb_typeof(j->'buyer') = 'object' on conflict (id) do nothing""")

S.append(f"""insert into contact (id, name, email, phone)
select md5('contact|' || {LID}::text || '|ap')::uuid, 'Accounts payable', j->>'ap_email', null
from imp_acct where (j->>'ap_email') is not null on conflict (id) do nothing""")

S.append(f"""insert into location_contact (id, location_id, contact_id, contact_role, may_order, receives_invoices, may_authorize_payment)
select md5('loccontact|' || {LID}::text || '|ap')::uuid, {LID}, md5('contact|' || {LID}::text || '|ap')::uuid, 'ap', false, true, false
from imp_acct where (j->>'ap_email') is not null on conflict (id) do nothing""")

S.append(f"""insert into license_verification (id, location_id, license_number, state, note)
select md5('license|' || {LID}::text)::uuid, {LID}, j->>'license_out', 'unverified', 'Imported from the ' || coalesce(j->>'source_tab','Customer Accounts') || ' tab; not yet verified'
from imp_acct on conflict (id) do nothing""")

S.append(f"""insert into payment_relationship (id, location_id, channel, setup_state, shared_payer_note)
select md5('payment|' || {LID}::text)::uuid, {LID}, (j->>'channel')::payment_channel, (j->>'setup')::payment_setup_state, j->>'pay_note'
from imp_acct on conflict (id) do nothing""")

S.append(f"""insert into cleaning_obligation (id, location_id, applicable, last_completed_on)
select md5('cleaning|' || {LID}::text)::uuid, {LID}, 'unknown', j->>'last_cleaning_out'
from imp_acct on conflict (id) do nothing""")

S.append(f"""insert into audit_event (id, actor_kind, action, subject_type, subject_id, current, reason, correlation_id, market_id)
select md5('audit|' || {LID}::text)::uuid, 'system', 'import.location', 'customer_location', {LID}::text, j, 'Reference-data import from the TLM Master File', '{RUN}', {MKT}
from imp_acct on conflict (id) do nothing""")

summary = {"source": SOURCE, "markets": len(ref["market"]), "warehouses": len(ref["warehouse"]), "skus_active": sum(1 for s in ref["sku"] if not s["archived"]), "skus_archived": sum(1 for s in ref["sku"] if s["archived"]), "prices": len(ref["price"]), "accounts": len(acct)}
S.append(f"""insert into audit_event (id, actor_kind, action, subject_type, subject_id, current, reason, correlation_id)
values (md5('audit|{RUN}')::uuid, 'system', 'import.run', 'import', '{RUN}', {dq(summary)}, 'Reference-data import from the TLM Master File (markets, origins, SKUs, retail prices, accounts)', '{RUN}') on conflict (id) do nothing""")

S.append("drop table imp_ref")
S.append("drop table imp_acct")

(OUT / "prod.sql").write_text("begin;\n" + ";\n".join(S) + ";\ncommit;\n")
(OUT / "prod_statements.json").write_text(json.dumps(S))
# Batched account loads for the connector: each batch is self-contained (temp table, its slice of accounts, all account statements).
acct_stmts = S[11:24]  # customer_location .. import.location audit (13 statements)
assert acct_stmts[0].startswith("insert into customer_location") and acct_stmts[-1].startswith("insert into audit_event")
run_audit = S[24]
assert run_audit.startswith("insert into audit_event") and "import.run" in run_audit
n = 3
size = (len(acct) + n - 1) // n
for b in range(n):
    part = acct[b * size:(b + 1) * size]
    batch = ["create temp table imp_acct (j jsonb)", f"insert into imp_acct select x from jsonb_array_elements({dq(part)}) x"] + acct_stmts + ([run_audit] if b == n - 1 else []) + ["drop table imp_acct"]
    (OUT / f"batch{b + 1}.json").write_text(json.dumps(batch))
    print(f"batch{b + 1}: {len(part)} accounts, {sum(len(x) for x in batch)} chars")
sizes = [len(s) for s in S]
print(f"{len(S)} statements, {sum(sizes)} chars total; largest {max(sizes)} chars; accounts {len(acct)}")
