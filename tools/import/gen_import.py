#!/usr/bin/env python3
"""Generate idempotent SQL that loads TLM Master File reference data into fv-ops.

Inputs : CSV exports of the workbook tabs (sheet/csv/*.csv)
Outputs: import/import.sql  (one statement per line block, for psql)
         import/statements.json (list of statements, for the Neon connector)
         import/report.md  (dry-run report for the owner)
"""
import csv, json, re, uuid, collections, datetime, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CSV = ROOT / "sheet" / "csv"
OUT = ROOT / "import"
NS = uuid.UUID("7d2c9c1e-5a0b-4d0e-9d3a-1f0b1a2c3d4e")  # import namespace (fixed)
RUN = "import-tlm-2026-10-28"
AS_OF = "2026-10-28"
SOURCE = "TLM Master File (Google Drive, it@theleopardmark.com), read 2026-10-28"

def uid(*parts):
    return str(uuid.uuid5(NS, "|".join(str(p) for p in parts)))

def q(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def qj(obj):
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'::jsonb"

def rows(name):
    with open(CSV / f"{name}.csv", newline="") as f:
        return list(csv.reader(f))

def clean(v):
    v = (v or "").replace("\xa0", " ").strip()
    if v.endswith(".0") and v[:-2].isdigit():
        v = v[:-2]
    return v

def phone(v):
    v = clean(v)
    d = re.sub(r"\D", "", v)
    if len(d) == 10:
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return v or None

STMTS = []
REPORT = collections.OrderedDict()

def emit(sql):
    STMTS.append(sql)

# ---------------------------------------------------------------- markets
MARKETS = [
    ("SOCAL", "SoCal", "America/Los_Angeles"),
    ("NORCAL-SD", "NorCal (Self Distribution)", "America/Los_Angeles"),
    ("NORCAL-D", "NorCal (Distributed)", "America/Los_Angeles"),
    ("CT", "Connecticut", "America/New_York"),
    ("MA", "Massachusetts", "America/New_York"),
]
MID = {code: uid("market", code) for code, _, _ in MARKETS}
for code, name, tz in MARKETS:
    emit(f"insert into market (id, code, name, timezone, active, seller_context_note) values ({q(MID[code])}, {q(code)}, {q(name)}, {q(tz)}, true, {q('Created by ' + RUN + '; seller/invoicing entity (D33) still to confirm')}) on conflict (id) do nothing")
REPORT["Markets"] = [f"{c} — {n} ({tz})" for c, n, tz in MARKETS]

# ---------------------------------------------------------------- warehouses / origins
loc_rows = rows("Location_Information")
lh = [c.strip() for c in loc_rows[0]]
li = {k: i for i, k in enumerate(lh)}
def lg(r, k):
    i = li[k]
    return clean(r[i]) if i < len(r) else ""

STATE_ABBR = {"california": "CA", "colorado": "CO", "massachusetts": "MA", "new york": "NY", "texas": "TX"}
def norm_state(s):
    s = clean(s)
    return STATE_ABBR.get(s.lower(), s.upper()[:2]) if s else ""
def norm_zip(z, state):
    z = clean(z)
    if z.isdigit() and len(z) == 4 and state == "MA":
        z = "0" + z
    return z

WH_MAP = {
    # Type -> (market, display name, primary, active, note)
    "P_CA_Richmond": ("NORCAL-D", "East Brother Beer (EBB)", True, True, "Brewery and lot facility 01; Matagrano pickup origin"),
    "P_CA_Huntington Beach": ("SOCAL", "Beachwood Brewing (brewery, lot facility 02)", False, True, "Origin code not yet assigned (question 2.2)"),
    "P_CA_San Diego": ("SOCAL", "AleSmith Brewing (brewery, lot facility 05)", False, True, "Origin code not yet assigned (question 2.2)"),
    "P_MA_Framingham": ("MA", "Jack's Abby Brewing (brewery, lot facility 06)", True, True, "Origin code not yet assigned (question 2.2)"),
    "P_NY_Garnerville": ("CT", "Round Table Brewing (brewery, lot facility 04)", False, True, "ASSUMPTION: placed in Connecticut because NY has no market; move if wrong"),
    "W_CA_Benecia 01": ("NORCAL-SD", "SC Warehouses (Benicia)", False, False, "Imported inactive pending question 2.3"),
    "W_CA_San Francisco 01": ("NORCAL-SD", "Envision Cold Storage (San Francisco)", False, False, "Imported inactive pending question 2.3"),
    "W_CA_Wilmington 01": ("SOCAL", "Balmuth & Co. (WLA)", True, True, "SoCal primary warehouse"),
    "W_CA_Windsor 01": ("NORCAL-SD", "Express Wine Delivery (EWD)", True, True, "North Bay primary warehouse"),
}
SKIPPED_WH = {"P_CO_Northglenn": "Prost Brewing (CO) — no market covers Colorado yet", "P_TX_Blanco": "Real Ale Brewing (TX) — no market covers Texas yet"}
wh_report = []
WHID = {}
WH_RECORDS = []
for r in loc_rows[1:]:
    t = lg(r, "Type")
    if not t:
        continue
    if t in SKIPPED_WH:
        wh_report.append(f"SKIPPED {SKIPPED_WH[t]}")
        continue
    mk, name, primary, active, note = WH_MAP[t]
    st = norm_state(lg(r, "Shipping State"))
    parts = [lg(r, "Shipping Address"), lg(r, "Shipping Address Line #2")]
    line = ", ".join(p for p in parts if p)
    city = lg(r, "Shipping City")
    zipc = norm_zip(lg(r, "Shipping Zip Code"), st)
    addr = f"{line}, {city}, {st} {zipc}".strip().rstrip(",")
    contact = " / ".join(x for x in [lg(r, "Shipping Contact Email"), phone(lg(r, "Shipping Contact Phone")) or ""] if x) or None
    wid = uid("warehouse", t)
    WHID[t] = wid
    emit(f"insert into warehouse (id, market_id, name, address_text, is_primary, fulfillment_contact, active) values ({q(wid)}, {q(MID[mk])}, {q(name)}, {q(addr)}, {str(primary).lower()}, {q(contact)}, {str(active).lower()}) on conflict (id) do nothing")
    WH_RECORDS.append({"key": t, "market": mk, "name": name, "address": addr, "primary": primary, "contact": contact, "active": active})
    wh_report.append(f"{name} → {mk}{' (primary)' if primary else ''}{'' if active else ' (inactive)'} — {addr}. {note}")
# Radford
wid = uid("warehouse", "RAD")
emit(f"insert into warehouse (id, market_id, name, address_text, is_primary, fulfillment_contact, active) values ({q(wid)}, {q(MID['CT'])}, 'Radford Warehouse (RAD)', 'Address to confirm (not in the workbook)', true, NULL, true) on conflict (id) do nothing")
wh_report.append("Radford Warehouse (RAD) → CT (primary) — address to confirm; not in Location Information")
WH_RECORDS.append({"key": "RAD", "market": "CT", "name": "Radford Warehouse (RAD)", "address": "Address to confirm (not in the workbook)", "primary": True, "contact": None, "active": True})
REPORT["Warehouses and origins"] = wh_report

# ---------------------------------------------------------------- SKUs
ACTIVE_SKUS = [
    ("SLG0KHB010", "Sunlight Groove 1/2 bbl keg", "Sunlight Groove", "keg_half", "1/2 bbl keg", 1, "160"),
    ("SLG0KSB010", "Sunlight Groove 1/6 bbl keg", "Sunlight Groove", "keg_sixtel", "1/6 bbl keg", 1, "58"),
    ("SLG0C1206P", "Sunlight Groove 12 oz case (4 × 6-pack, PakTech)", "Sunlight Groove", "case_12oz_can", "case (4 × 6-pack × 12 oz, PakTech)", 0, "22"),
    ("CNTCKHB010", "Cantinesca 1/2 bbl keg", "Cantinesca", "keg_half", "1/2 bbl keg", 1, "160"),
    ("CNTCKSB010", "Cantinesca 1/6 bbl keg", "Cantinesca", "keg_sixtel", "1/6 bbl keg", 1, "58"),
    ("CNTCC1206P", "Cantinesca 12 oz case (4 × 6-pack, PakTech)", "Cantinesca", "case_12oz_can", "case (4 × 6-pack × 12 oz, PakTech)", 0, "22"),
    ("CNTCC1206C", "Cantinesca 12 oz case (4 × 6-pack, carton)", "Cantinesca", "case_12oz_can", "case (4 × 6-pack × 12 oz, carton)", 0, "22"),
    ("CNTCC1212C", "Cantinesca 12 oz case (2 × 12-pack, carton)", "Cantinesca", "case_12oz_can", "case (2 × 12-pack × 12 oz, carton)", 0, "22"),
]
SKUID = {}
SKU_RECORDS = []
for code, name, brand, pk, unit, kegs, wt in ACTIVE_SKUS:
    SKU_RECORDS.append({"code": code, "name": name, "brand": brand, "pk": pk, "unit": unit, "kegs": kegs, "wt": wt, "archived": False})
    sid = uid("sku", code)
    SKUID[code] = sid
    emit(f"insert into sku (id, code, name, brand, package_kind, selling_unit, kegs_per_unit, weight_lb) values ({q(sid)}, {q(code)}, {q(name)}, {q(brand)}, {q(pk)}, {q(unit)}, {kegs}, {wt}) on conflict (id) do nothing")

PK_MAP = {"1/2 bbl Keg": "keg_half", "1/6 bbl Keg": "keg_sixtel", "Case (12oz x24)": "case_12oz_can", "Case (24oz)": "case_24oz_can"}
LEGACY_TO_NEW = {
    "SGB1AKHB01": "SLG0KHB010", "SGS1AKHB01": "SLG0KHB010",
    "SGB1AKSB01": "SLG0KSB010", "SGS1AKSB01": "SLG0KSB010",
    "SGB1AC1224": "SLG0C1206P", "SGS1AC1224": "SLG0C1206P",
    "CNT1AKHB01": "CNTCKHB010", "CNT1AKSB01": "CNTCKSB010", "CNT1AC1224": "CNTCC1206P",
}
sku_rows = rows("SKU_Master")
sh = [c.strip() for c in sku_rows[0]]
si = {k: i for i, k in enumerate(sh)}
legacy_report = []
skipped_sku = []
legacy_price = {}
for r in sku_rows[1:]:
    def sg(k):
        i = si[k]
        return clean(r[i]) if i < len(r) else ""
    code = sg("SKU")
    if not code:
        continue
    pkg = sg("PackageType")
    if pkg not in PK_MAP:
        skipped_sku.append(f"{code} ({pkg}) — not a beer package; trade item (question 3.6)")
        continue
    name = f"{sg('Product')} {pkg} (legacy)"
    brand = sg("Product")
    wt = sg("WeightPerUnit") or "NULL"
    kegs = 1 if sg("IsKeg").lower() == "true" else 0
    sid = uid("sku", code)
    SKUID[code] = sid
    emit(f"insert into sku (id, code, name, brand, package_kind, selling_unit, kegs_per_unit, weight_lb, archived_at) values ({q(sid)}, {q(code)}, {q(name)}, {q(brand)}, {q(PK_MAP[pkg])}, {q(pkg)}, {kegs}, {wt}, now()) on conflict (id) do nothing")
    SKU_RECORDS.append({"code": code, "name": name, "brand": brand, "pk": PK_MAP[pkg], "unit": pkg, "kegs": kegs, "wt": None if wt == "NULL" else wt, "archived": True})
    price = sg("Price")
    if price:
        legacy_price[code] = price
    legacy_report.append(f"{code} → {LEGACY_TO_NEW.get(code, 'archived, no successor')}")
REPORT["Active SKUs (8)"] = [f"{c} — {n} — {w} lb" for c, n, _, _, _, _, w in ACTIVE_SKUS]
REPORT["Legacy SKUs (archived, mapped)"] = legacy_report
REPORT["SKU rows skipped"] = skipped_sku

# ---------------------------------------------------------------- prices (retail list, self-distribution markets)
price_report = []
PRICE_RECORDS = []
new_price = {}
for legacy, newc in LEGACY_TO_NEW.items():
    if legacy in legacy_price and newc not in new_price:
        new_price[newc] = legacy_price[legacy]
for mk in ("NORCAL-SD", "SOCAL"):
    for code, dollars in sorted(new_price.items()):
        cents = int(round(float(dollars) * 100))
        pid = uid("price", mk, code, AS_OF)
        emit(f"insert into market_price (id, market_id, sku_id, price_cents, effective_from) values ({q(pid)}, {q(MID[mk])}, {q(SKUID[code])}, {cents}, {q(AS_OF)}) on conflict (id) do nothing")
        PRICE_RECORDS.append({"market": mk, "sku": code, "cents": cents})
        price_report.append(f"{mk}: {code} ${float(dollars):.2f}")
price_report.append("Not priced (no list price in the workbook): CNTCC1206C, CNTCC1212C in all markets; every SKU in NORCAL-D, CT, MA (question 3.9)")
REPORT["Prices loaded (from SKU Master, retail list)"] = price_report

# ---------------------------------------------------------------- accounts
ca = rows("Customer_Accounts")
ch = [c.split("\n")[0].strip() for c in ca[0]]
ci = {k: i for i, k in enumerate(ch)}
def cg(r, k):
    i = ci[k]
    return clean(r[i]) if i < len(r) else ""
acc = rows("Accounts")
ah = [c.strip() for c in acc[0]]
ai = {k: i for i, k in enumerate(ah)}
def ag(r, k):
    i = ai[k]
    return clean(r[i]) if i < len(r) else ""
acc_by_name = {ag(r, "BusinessName").lower(): r for r in acc[1:]}

def norm_master(r):
    return {
        "name": cg(r, "Business Name"), "rep": cg(r, "Sales Person"), "region": cg(r, "Region"),
        "license": cg(r, "Alc."), "legal": cg(r, "Legal Name"), "contact": cg(r, "Ordering Contact"),
        "phone": cg(r, "Phone Number"), "email": cg(r, "Ordering Contact Email"), "address": cg(r, "Delivery Address"),
        "instructions": cg(r, "Delivery Instructions"), "window": cg(r, "Delivery WIndow"),
        "days": {d: cg(r, f"{d} Delivery Window") for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]},
        "last_cleaning": cg(r, "Date of Last Line Cleaning"), "payment": cg(r, "Payment Method"),
        "on_fintech": cg(r, "Added on Fintech /  Stripe ACH"), "billing_email": cg(r, "Billing Contact Email"),
        "billing_instructions": cg(r, "Billing Instructions"), "terms": cg(r, "Terms"), "billing_address": cg(r, "Billing Address"),
        "priority": cg(r, "Priority"), "ekos": cg(r, "Imported to Ekos"), "tap_handles": cg(r, "Tap Handles?"),
        "lat": cg(r, "Latitude"), "lng": cg(r, "Longitude") or cg(r, "Longtitude"), "source_tab": "Customer Accounts",
    }
def norm_accounts(r):
    return {
        "name": ag(r, "BusinessName"), "rep": ag(r, "SalesPerson"), "region": ag(r, "Region"),
        "license": ag(r, "LicenseNumber"), "legal": ag(r, "LegalName"), "contact": ag(r, "OrderingContact"),
        "phone": ag(r, "Phone"), "email": ag(r, "Email"), "address": ag(r, "DeliveryAddress"),
        "instructions": ag(r, "DeliveryInstructions"), "window": ag(r, "DeliveryWindowNote"),
        "days": {d: ag(r, f"{d}Window") for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]},
        "last_cleaning": "", "payment": ag(r, "PaymentMethod"), "on_fintech": "", "billing_email": ag(r, "BillingContactEmail"),
        "billing_instructions": ag(r, "BillingInstructions"), "terms": ag(r, "Terms"), "billing_address": ag(r, "BillingAddress"),
        "priority": ag(r, "Priority"), "ekos": "", "tap_handles": "", "lat": "", "lng": "", "source_tab": "Accounts",
        "legacy_id": ag(r, "AccountID"),
    }

EXCLUDE = {
    "the leopard mark": "Familiar Ventures itself (internal)",
    "balmuth": "warehouse (WLA) — imported as an origin, not an account",
    "east brother beer": "host brewery (EBB) — imported as an origin, not an account",
    "express wine delivery": "warehouse (EWD) — imported as an origin, not an account",
    "alex lai": "sales rep — sample pulls, not an account",
    "thomas gilbert": "sales rep — sample pulls, not an account",
    "james": "sales rep — sample pulls, not an account",
    "ricardo": "sales rep — sample pulls, not an account",
    "orange courier": "no address, no contact, no license — nothing to import",
    "": "row with no business name (111 S Grand Ave, Los Angeles) — nothing to import",
}
ALIAS = {"el canton de la patrona": "el canton de patrona"}  # Accounts-tab name -> master name

SF = {"san francisco", "south san francisco"}
NORTH = {"north bay", "san rafael", "marin", "central coast"}
SOUTH = {"los angeles", "orange county", "long beach", "san diego", "alhambra", "arcadia", "west los angeles"}
SOCAL_CITIES = {"downey", "west covina", "ontario", "covina", "long beach", "santa clarita", "el segundo", "los angeles", "whittier", "huntington beach", "anaheim", "chula vista", "san diego", "pasadena", "torrance", "burbank", "glendale", "hollywood", "malibu", "santa monica", "culver city", "inglewood", "compton", "norwalk", "lakewood", "cerritos", "fullerton", "irvine", "costa mesa", "newport beach", "orange", "santa ana", "azusa", "pomona", "claremont", "montebello", "pico rivera", "south gate", "huntington park", "bell", "san pedro", "wilmington", "redondo beach", "manhattan beach", "hermosa beach", "venice", "studio city", "sherman oaks", "van nuys", "north hollywood", "northridge", "encino", "tarzana", "woodland hills", "calabasas", "la habra", "brea", "placentia", "yorba linda", "tustin", "garden grove", "westminster", "seal beach", "cypress", "buena park", "la mirada", "san clemente", "dana point", "laguna beach", "mission viejo", "oceanside", "carlsbad", "encinitas", "escondido", "la jolla"}
NORCAL_CITIES = {"fairfax", "san rafael", "mill valley", "sausalito", "novato", "petaluma", "santa rosa", "sonoma", "napa", "windsor", "healdsburg", "sebastopol", "bolinas", "stinson beach", "point reyes station", "inverness", "tiburon", "larkspur", "corte madera", "san anselmo", "kentfield", "greenbrae", "olema", "marshall", "tomales", "dillon beach", "bodega bay", "guerneville", "forestville", "cotati", "rohnert park", "vallejo", "benicia", "san quentin", "woodacre", "lagunitas", "nicasio"}
MATAGRANO_CITIES = {"san francisco", "south san francisco", "daly city", "san mateo", "burlingame", "san bruno", "millbrae", "redwood city", "palo alto", "menlo park", "mountain view", "sunnyvale", "san jose", "santa clara", "campbell", "los gatos", "cupertino", "half moon bay", "pacifica", "foster city", "belmont", "san carlos"}

CITY_RE = re.compile(r"^(?P<line>.+?)[,\s]+(?P<city>[A-Za-z .'#/-]+?),?\s+(?P<st>CA|California|OR|NV|AZ|TX|MA|CT|NY)\.?\s*,?\s*(?P<zip>\d{5})?(?:-\d{4})?\s*$", re.I)
KNOWN_CITIES = sorted(SOCAL_CITIES | NORCAL_CITIES | MATAGRANO_CITIES | {"hayward", "richmond", "oakland", "berkeley", "emeryville", "alameda", "fremont", "san leandro", "walnut creek", "concord", "sacramento"}, key=len, reverse=True)

def parse_address(a):
    a = clean(a)
    if not a or a.upper() == "N/A":
        return None
    m = CITY_RE.match(a)
    if not m:
        return None
    line, city, st, zipc = m.group("line").strip(" ,"), m.group("city").strip(" ,"), m.group("st"), m.group("zip") or ""
    st = norm_state(st)
    # When the street and city were not comma separated the regex greedily puts the city in `line`.
    low = (line + " " + city).lower()
    for kc in KNOWN_CITIES:
        if low.endswith(" " + kc) or city.lower() == kc:
            if city.lower() != kc:
                # city is part of line's tail
                full = (line + " " + city).strip()
                idx = full.lower().rfind(kc)
                line, city = full[:idx].strip(" ,"), full[idx:].strip()
            break
    city = " ".join(w if (w.isupper() and len(w) <= 2) else w.capitalize() for w in city.split())
    return {"line1": line, "city": city, "state": st, "postal": zipc}

def market_for(acct):
    region = acct["region"].lower()
    addr = parse_address(acct["address"]) or {}
    city = (addr.get("city") or "").lower()
    if acct["name"].lower().startswith("matagrano"):
        return "NORCAL-D", "distributor"
    if region in SF or city in MATAGRANO_CITIES:
        return "NORCAL-D", "retail in Matagrano territory"
    if region in NORTH or city in NORCAL_CITIES:
        return "NORCAL-SD", "region/city"
    if region in SOUTH or city in SOCAL_CITIES:
        return "SOCAL", "region/city"
    if acct["rep"] in ("J. Williams", "R. Villanueva", "S. Sprague", "D. Krause"):
        return "SOCAL", "inferred from rep"
    if acct["rep"] == "T. Gilbert":
        return "NORCAL-SD", "inferred from rep"
    return "NORCAL-SD", "DEFAULT — could not infer"

CHANNEL = {"fintech": "fintech", "ach": "stripe_ach", "ach / stripe ach": "stripe_ach", "stripe": "stripe_ach", "stripe ach": "stripe_ach"}

accounts = []
excluded = []
seen = set()
for r in ca[1:]:
    a = norm_master(r)
    key = a["name"].lower()
    if key in EXCLUDE:
        msg = f"{a['name'] or '(blank)'} — {EXCLUDE[key]}"
        if msg not in excluded:
            excluded.append(msg)
        continue
    # supplement from Accounts tab
    sup = acc_by_name.get(key) or acc_by_name.get({v: k for k, v in ALIAS.items()}.get(key, ""))
    if sup is not None:
        s = norm_accounts(sup)
        a["legacy_id"] = s.get("legacy_id")
        for f in ["license", "legal", "contact", "phone", "email", "address", "instructions", "window", "payment", "billing_email", "billing_instructions", "terms", "billing_address", "priority", "region", "rep"]:
            if not a[f] and s[f]:
                a[f] = s[f]
                a.setdefault("supplemented", []).append(f)
        for d, v in s["days"].items():
            if not a["days"][d] and v:
                a["days"][d] = v
                a.setdefault("supplemented", []).append(d)
    accounts.append(a)
    seen.add(key)
only_accounts = []
for r in acc[1:]:
    s = norm_accounts(r)
    key = s["name"].lower()
    key2 = ALIAS.get(key, key)
    if key2 in seen or key in EXCLUDE:
        continue
    # names that are site-less versions of master rows (El Pescador, La Nena Cantina) are skipped as duplicates
    base = re.sub(r"\s*\(.*\)$", "", key)
    if any(m.startswith(base + " (") or m.startswith(base + " #") for m in seen):
        only_accounts.append(f"SKIPPED {s['name']} (ACC {s['legacy_id']}) — the master already has it as separate sites")
        continue
    accounts.append(s)
    seen.add(key)
    only_accounts.append(f"ADDED {s['name']} ({s['legacy_id']}) — present only in the Accounts tab")

acct_report = []
ACCT_RECORDS = []
addr_fail = []
by_market = collections.Counter()
inactive = []
missing = collections.Counter()
DAY_ABBR = {"Monday": "Mon", "Tuesday": "Tue", "Wednesday": "Wed", "Thursday": "Thu", "Friday": "Fri"}
for a in accounts:
    mk, why = market_for(a)
    status = "active"
    if mk == "NORCAL-D" and not a["name"].lower().startswith("matagrano"):
        status = "inactive"
        inactive.append(a["name"])
    by_market[mk] += 1
    lid = uid("location", a["name"].lower())
    windows = "; ".join(f"{DAY_ABBR[d]} {v}" for d, v in a["days"].items() if v)
    restr = "; ".join(x for x in [f"Delivery window: {a['window']}" if a["window"] else "", f"Weekday windows: {windows}" if windows else ""] if x) or None
    instr = a["instructions"] or None
    if a["name"].lower().startswith("matagrano"):
        instr = "Distributor account." + (f" {instr}" if instr else "")
    emit(f"insert into customer_location (id, market_id, trade_name, legal_name, status, delivery_instructions, receiving_restrictions) values ({q(lid)}, {q(MID[mk])}, {q(a['name'])}, {q(a['legal'] or None)}, {q(status)}, {q(instr)}, {q(restr)}) on conflict (id) do nothing")
    # addresses
    pa = parse_address(a["address"])
    if pa:
        aid = uid("address", lid, "delivery")
        emit(f"insert into address (id, line1, city, state, postal_code, provenance) values ({q(aid)}, {q(pa['line1'])}, {q(pa['city'])}, {q(pa['state'] or 'CA')}, {q(pa['postal'])}, 'admin_entered') on conflict (id) do nothing")
        emit(f"insert into location_address (id, location_id, address_id, kind) values ({q(uid('locaddr', lid, 'delivery'))}, {q(lid)}, {q(aid)}, 'delivery') on conflict (id) do nothing")
        if not pa["postal"]:
            addr_fail.append(f"{a['name']}: no ZIP in '{a['address']}'")
        bid = aid
        if a["billing_address"] and a["billing_address"].lower() not in ("same", "same as delivery", "same as shipping"):
            pb = parse_address(a["billing_address"])
            if pb:
                bid = uid("address", lid, "billing")
                emit(f"insert into address (id, line1, city, state, postal_code, provenance) values ({q(bid)}, {q(pb['line1'])}, {q(pb['city'])}, {q(pb['state'] or 'CA')}, {q(pb['postal'])}, 'admin_entered') on conflict (id) do nothing")
            else:
                addr_fail.append(f"{a['name']}: billing address not parsed '{a['billing_address']}' (delivery address used for billing)")
        emit(f"insert into location_address (id, location_id, address_id, kind) values ({q(uid('locaddr', lid, 'billing'))}, {q(lid)}, {q(bid)}, 'billing') on conflict (id) do nothing")
    else:
        addr_fail.append(f"{a['name']}: delivery address missing or not parsed '{a['address']}' — no address row created")
        missing["address"] += 1
    # contacts
    has_ap = bool(a["billing_email"])
    cname = a["contact"] or ("Ordering contact" if (a["email"] or a["phone"]) else "")
    if cname:
        cid = uid("contact", lid, "buyer")
        emit(f"insert into contact (id, name, email, phone) values ({q(cid)}, {q(cname)}, {q(a['email'].lower() or None)}, {q(phone(a['phone']))}) on conflict (id) do nothing")
        emit(f"insert into location_contact (id, location_id, contact_id, contact_role, may_order, receives_invoices, may_authorize_payment) values ({q(uid('loccontact', lid, 'buyer'))}, {q(lid)}, {q(cid)}, 'buyer', true, {str(not has_ap).lower()}, false) on conflict (id) do nothing")
    else:
        missing["ordering contact"] += 1
    if has_ap:
        apid = uid("contact", lid, "ap")
        emit(f"insert into contact (id, name, email, phone) values ({q(apid)}, 'Accounts payable', {q(a['billing_email'].lower())}, NULL) on conflict (id) do nothing")
        emit(f"insert into location_contact (id, location_id, contact_id, contact_role, may_order, receives_invoices, may_authorize_payment) values ({q(uid('loccontact', lid, 'ap'))}, {q(lid)}, {q(apid)}, 'ap', false, true, false) on conflict (id) do nothing")
    # license
    lic = a["license"]
    if lic.upper() in ("N/A", "NA", "NONE"):
        lic = ""
    if not lic:
        missing["license number"] += 1
    emit(f"insert into license_verification (id, location_id, license_number, state, note) values ({q(uid('license', lid))}, {q(lid)}, {q(lic or None)}, 'unverified', {q('Imported from ' + a['source_tab'] + ' tab; not yet verified')}) on conflict (id) do nothing")
    # payment
    ch = CHANNEL.get(a["payment"].lower(), "unselected")
    setup = "unknown" if ch != "unselected" else "not_requested"
    if ch == "unselected":
        missing["payment method"] += 1
    emit(f"insert into payment_relationship (id, location_id, channel, setup_state, shared_payer_note) values ({q(uid('payment', lid))}, {q(lid)}, {q(ch)}, {q(setup)}, {q(('Sheet: ' + a['payment']) if a['payment'] else None)}) on conflict (id) do nothing")
    # cleaning obligation
    emit(f"insert into cleaning_obligation (id, location_id, applicable, last_completed_on) values ({q(uid('cleaning', lid))}, {q(lid)}, 'unknown', {q(a['last_cleaning'][:10] or None)}) on conflict (id) do nothing")
    # audit with full source row
    src = {k: v for k, v in a.items() if v and k != "days"}
    src["days"] = {k: v for k, v in a["days"].items() if v}
    rec = dict(src)
    rec.update({"market": mk, "market_reason": why, "status": status, "instructions_out": instr, "restrictions_out": restr,
                "addr": pa, "baddr": (pb if (pa and a["billing_address"] and a["billing_address"].lower() not in ("same", "same as delivery", "same as shipping") and parse_address(a["billing_address"])) else None),
                "buyer": ({"name": cname, "email": a["email"].lower() or None, "phone": phone(a["phone"])} if cname else None),
                "ap_email": (a["billing_email"].lower() if has_ap else None),
                "license_out": lic or None, "channel": ch, "setup": setup, "pay_note": (("Sheet: " + a["payment"]) if a["payment"] else None),
                "last_cleaning_out": (a["last_cleaning"][:10] or None)})
    ACCT_RECORDS.append(rec)
    emit(f"insert into audit_event (id, actor_kind, action, subject_type, subject_id, current, reason, correlation_id, market_id) values ({q(uid('audit', lid))}, 'system', 'import.location', 'customer_location', {q(lid)}, {qj({'source': SOURCE, 'market': mk, 'market_reason': why, 'status': status, 'row': src})}, {q('Reference-data import from the TLM Master File')}, {q(RUN)}, {q(MID[mk])}) on conflict (id) do nothing")
    acct_report.append(f"{a['name']} → {mk} ({status}){' · ' + why if why not in ('region/city',) else ''}")

emit(f"insert into audit_event (id, actor_kind, action, subject_type, subject_id, current, reason, correlation_id) values ({q(uid('audit', RUN))}, 'system', 'import.run', 'import', {q(RUN)}, {qj({'source': SOURCE, 'markets': len(MARKETS), 'warehouses': len(WHID) + 1, 'skus_active': len(ACTIVE_SKUS), 'skus_archived': len(legacy_report), 'accounts': len(accounts), 'excluded': len(excluded)})}, 'Reference-data import from the TLM Master File (markets, origins, SKUs, retail prices, accounts)', {q(RUN)}) on conflict (id) do nothing")

REPORT["Accounts by market"] = [f"{k}: {v}" for k, v in sorted(by_market.items())] + [f"Total imported: {len(accounts)}"]
REPORT["Accounts set INACTIVE (retail accounts inside Matagrano's territory; pending question 2.6)"] = sorted(inactive)
REPORT["Rows excluded"] = excluded
REPORT["Accounts-tab-only rows"] = only_accounts
REPORT["Address problems"] = addr_fail
REPORT["Missing fields (count of accounts)"] = [f"{k}: {v}" for k, v in missing.items()]
REPORT["Every imported account"] = acct_report

OUT.mkdir(exist_ok=True)
(OUT / "import.sql").write_text("begin;\n" + ";\n".join(STMTS) + ";\ncommit;\n")
(OUT / "statements.json").write_text(json.dumps(STMTS))
with open(OUT / "report.md", "w") as f:
    f.write(f"# TLM Master File import — dry-run report\n\nSource: {SOURCE}. Run id `{RUN}`. {len(STMTS)} SQL statements.\n\n")
    for k, v in REPORT.items():
        f.write(f"## {k}\n\n")
        if not v:
            f.write("(none)\n\n")
        for line in v:
            f.write(f"- {line}\n")
        f.write("\n")
print(f"{len(STMTS)} statements; accounts {len(accounts)}; excluded {len(excluded)}; address problems {len(addr_fail)}")
