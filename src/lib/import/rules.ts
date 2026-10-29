/**
 * Fixed rules of the TLM Master File import: the five markets, the origin table, the eight active SKUs, the legacy
 * code mapping, the account exclusions, the market inference lists and the people decisions (9.2). These reproduce the
 * normalisation already in production from the October 28 load (tools/import/gen_import.py) plus the decisions that
 * came into force afterwards (served-by, kinds, distributors, people).
 */
import type { OriginKind } from "@/lib/domain/origins/service";
import type { PackageKind } from "./types";

/** Price list date of the October 28 load; part of the price row ids, so it stays fixed. */
export const PRICE_AS_OF = "2026-10-28";

export const MARKETS: ReadonlyArray<{ code: string; name: string; timezone: string }> = [
  { code: "SOCAL", name: "SoCal", timezone: "America/Los_Angeles" },
  { code: "NORCAL-SD", name: "NorCal (Self Distribution)", timezone: "America/Los_Angeles" },
  { code: "NORCAL-D", name: "NorCal (Distributed)", timezone: "America/Los_Angeles" },
  { code: "CT", name: "Connecticut", timezone: "America/New_York" },
  { code: "MA", name: "Massachusetts", timezone: "America/New_York" },
];

export interface OriginRule {
  /** Location Information "Type" value; for rows absent from the tab, the origin code itself. */
  key: string;
  name: string;
  originCode: string | null;
  lotFacilityCode: string | null;
  kind: OriginKind;
  marketCode: string | null;
  isPrimary: boolean;
  active: boolean;
  note: string;
  /** Fixed address for an origin that is not in the tab. */
  address?: { line1: string; line2: string | null; city: string; state: string; postal: string };
}

export const ORIGIN_RULES: ReadonlyArray<OriginRule> = [
  { key: "P_CA_Richmond", name: "East Brother Beer", originCode: "EBB", lotFacilityCode: "01", kind: "brewery", marketCode: "NORCAL-D", isPrimary: true, active: true, note: "Brewery and lot facility 01; Matagrano pickup origin" },
  { key: "P_CA_Huntington Beach", name: "Beachwood Brewing", originCode: "BWD", lotFacilityCode: "02", kind: "brewery", marketCode: "SOCAL", isPrimary: false, active: true, note: "Brewery, lot facility 02" },
  { key: "P_CO_Northglenn", name: "Prost Brewing", originCode: "PRO", lotFacilityCode: "03", kind: "brewery", marketCode: null, isPrimary: false, active: true, note: "Brewery, lot facility 03; no market covers Colorado (2.2)" },
  { key: "P_NY_Garnerville", name: "Round Table Brewing", originCode: "RTB", lotFacilityCode: "04", kind: "brewery", marketCode: "CT", isPrimary: false, active: true, note: "Brewery, lot facility 04; placed in Connecticut (NY has no market)" },
  { key: "P_CA_San Diego", name: "AleSmith Brewing", originCode: "ALE", lotFacilityCode: "05", kind: "brewery", marketCode: "SOCAL", isPrimary: false, active: true, note: "Brewery, lot facility 05" },
  { key: "P_MA_Framingham", name: "Jack's Abby Brewing", originCode: "JAB", lotFacilityCode: "06", kind: "brewery", marketCode: "MA", isPrimary: false, active: true, note: "Brewery, lot facility 06; Radford is the MA primary warehouse (2.3)" },
  { key: "P_TX_Blanco", name: "Real Ale Brewing", originCode: "REA", lotFacilityCode: "07", kind: "brewery", marketCode: null, isPrimary: false, active: true, note: "Brewery, lot facility 07; no market covers Texas (2.2)" },
  { key: "W_CA_Windsor 01", name: "Express Wine Delivery", originCode: "EWD", lotFacilityCode: null, kind: "warehouse", marketCode: "NORCAL-SD", isPrimary: true, active: true, note: "North Bay primary warehouse" },
  { key: "W_CA_Wilmington 01", name: "Balmuth & Co.", originCode: "WLA", lotFacilityCode: null, kind: "warehouse", marketCode: "SOCAL", isPrimary: true, active: true, note: "SoCal primary warehouse" },
  { key: "W_CA_Benecia 01", name: "SC Warehouses (Benicia)", originCode: null, lotFacilityCode: null, kind: "warehouse", marketCode: "NORCAL-SD", isPrimary: false, active: false, note: "Inactive pending question 2.3" },
  { key: "W_CA_San Francisco 01", name: "Envision Cold Storage (San Francisco)", originCode: null, lotFacilityCode: null, kind: "cold_storage", marketCode: "NORCAL-SD", isPrimary: false, active: false, note: "Inactive pending question 2.3" },
  {
    key: "RAD",
    name: "Radford Warehouse",
    originCode: "RAD",
    lotFacilityCode: null,
    kind: "warehouse",
    marketCode: "MA",
    isPrimary: true,
    active: true,
    note: "Massachusetts warehouse serving the MA distributor and both CT distributors (2.3); not in Location Information",
    address: { line1: "31 Plymouth St", line2: null, city: "Mansfield", state: "MA", postal: "02048" },
  },
];

/** Names the BOL log and freight payloads use for origins, matched case-insensitively by inclusion. */
export const ORIGIN_NAME_HINTS: ReadonlyArray<{ contains: string; originCode: string }> = [
  { contains: "east brother", originCode: "EBB" },
  { contains: "express wine", originCode: "EWD" },
  { contains: "balmuth", originCode: "WLA" },
  { contains: "radford", originCode: "RAD" },
  { contains: "beachwood", originCode: "BWD" },
  { contains: "prost", originCode: "PRO" },
  { contains: "round table", originCode: "RTB" },
  { contains: "roundtable", originCode: "RTB" },
  { contains: "alesmith", originCode: "ALE" },
  { contains: "ale smith", originCode: "ALE" },
  { contains: "jack's abby", originCode: "JAB" },
  { contains: "jacks abby", originCode: "JAB" },
  { contains: "real ale", originCode: "REA" },
];

/** Document-number prefixes that are not origin codes but name an origin all the same. */
export const PREFIX_ALIASES: Record<string, { originCode: string; note: string }> = {
  TLM: { originCode: "EBB", note: "TLM prefix carries no origin; East Brother assumed for the San Francisco driver days" },
  "WH-WIL": { originCode: "WLA", note: "WH-WIL read as the Wilmington warehouse (Balmuth)" },
};

export interface ActiveSkuRule {
  code: string;
  name: string;
  brand: string;
  brandCode: string;
  packageKind: PackageKind;
  sellingUnit: string;
  kegsPerUnit: number;
  weightLb: string;
}

export const ACTIVE_SKUS: ReadonlyArray<ActiveSkuRule> = [
  { code: "SLG0KHB010", name: "Sunlight Groove 1/2 bbl keg", brand: "Sunlight Groove", brandCode: "SLG", packageKind: "keg_half", sellingUnit: "1/2 bbl keg", kegsPerUnit: 1, weightLb: "160" },
  { code: "SLG0KSB010", name: "Sunlight Groove 1/6 bbl keg", brand: "Sunlight Groove", brandCode: "SLG", packageKind: "keg_sixtel", sellingUnit: "1/6 bbl keg", kegsPerUnit: 1, weightLb: "58" },
  { code: "SLG0C1206P", name: "Sunlight Groove 12 oz case (4 × 6-pack, PakTech)", brand: "Sunlight Groove", brandCode: "SLG", packageKind: "case_12oz_can", sellingUnit: "case (4 × 6-pack × 12 oz, PakTech)", kegsPerUnit: 0, weightLb: "22" },
  { code: "CNTCKHB010", name: "Cantinesca 1/2 bbl keg", brand: "Cantinesca", brandCode: "CNT", packageKind: "keg_half", sellingUnit: "1/2 bbl keg", kegsPerUnit: 1, weightLb: "160" },
  { code: "CNTCKSB010", name: "Cantinesca 1/6 bbl keg", brand: "Cantinesca", brandCode: "CNT", packageKind: "keg_sixtel", sellingUnit: "1/6 bbl keg", kegsPerUnit: 1, weightLb: "58" },
  { code: "CNTCC1206P", name: "Cantinesca 12 oz case (4 × 6-pack, PakTech)", brand: "Cantinesca", brandCode: "CNT", packageKind: "case_12oz_can", sellingUnit: "case (4 × 6-pack × 12 oz, PakTech)", kegsPerUnit: 0, weightLb: "22" },
  { code: "CNTCC1206C", name: "Cantinesca 12 oz case (4 × 6-pack, carton)", brand: "Cantinesca", brandCode: "CNT", packageKind: "case_12oz_can", sellingUnit: "case (4 × 6-pack × 12 oz, carton)", kegsPerUnit: 0, weightLb: "22" },
  { code: "CNTCC1212C", name: "Cantinesca 12 oz case (2 × 12-pack, carton)", brand: "Cantinesca", brandCode: "CNT", packageKind: "case_12oz_can", sellingUnit: "case (2 × 12-pack × 12 oz, carton)", kegsPerUnit: 0, weightLb: "22" },
];

/** SKU Master PackageType to package kind; anything else on that tab is a trade item (3.6). */
export const PACKAGE_TYPE_MAP: Record<string, PackageKind> = {
  "1/2 bbl Keg": "keg_half",
  "1/6 bbl Keg": "keg_sixtel",
  "Case (12oz x24)": "case_12oz_can",
  "Case (24oz)": "case_24oz_can",
};

/** Legacy ten-character codes with an active successor (3.3). Order matters: the first legacy code supplies the UPCs. */
export const LEGACY_TO_NEW: ReadonlyArray<[legacy: string, active: string]> = [
  ["SGB1AKHB01", "SLG0KHB010"],
  ["SGS1AKHB01", "SLG0KHB010"],
  ["SGB1AKSB01", "SLG0KSB010"],
  ["SGS1AKSB01", "SLG0KSB010"],
  ["SGB1AC1224", "SLG0C1206P"],
  ["SGS1AC1224", "SLG0C1206P"],
  ["CNT1AKHB01", "CNTCKHB010"],
  ["CNT1AKSB01", "CNTCKSB010"],
  ["CNT1AC1224", "CNTCC1206P"],
];

/** Trade-item codes seen on BOL lines and in SKU Master, mapped to POS items (3.6). */
export const POS_CODE_MAP: Record<string, string> = {
  "SGB-TAPHANDLE-STANDARD": "TAPHANDLE-STD",
  "SGB-TAPHANDLE": "TAPHANDLE-STD",
  "CNT-TAPHANDLE-PREMIUM": "TAPHANDLE-PREM",
  "CNT-TAPHANDLE": "TAPHANDLE-PREM",
  "GLW-PT-16-CNT-01": "GLASS-PINT-CASE",
};

/** Brand tokens in dotted codes and product names to the three-letter brand code used in legacy SKU codes. */
export const BRAND_TOKENS: ReadonlyArray<{ match: RegExp; brandCode: string; brandName: string }> = [
  { match: /sunlight groove bay area|^sgb$|sunlight groove ba\b/i, brandCode: "SGB", brandName: "Sunlight Groove Bay Area" },
  { match: /sunlight groove socal|^sgs$|sunlight groove sc\b/i, brandCode: "SGS", brandName: "Sunlight Groove SoCal" },
  { match: /^sunlight groove$|^slg$/i, brandCode: "SLG", brandName: "Sunlight Groove" },
  { match: /cantinesca especial|^cne$/i, brandCode: "CNE", brandName: "Cantinesca Especial" },
  { match: /cantinesca|^cnt$/i, brandCode: "CNT", brandName: "Cantinesca" },
  { match: /giro splendido|^gsp$/i, brandCode: "GSP", brandName: "Giro Splendido" },
  { match: /experimental hazy|^xhz$/i, brandCode: "XHZ", brandName: "Experimental Hazy" },
  { match: /experimental vienna|^xvn$/i, brandCode: "XVN", brandName: "Experimental Vienna" },
  { match: /experimental all|^xal$/i, brandCode: "XAL", brandName: "Experimental ALL" },
];

/** Customer Accounts rows that are not accounts (lower-cased business name to reason). */
export const EXCLUDED_ACCOUNTS: Record<string, string> = {
  "the leopard mark": "Familiar Ventures itself (internal)",
  balmuth: "warehouse (WLA) — imported as an origin, not an account",
  "east brother beer": "host brewery (EBB) — imported as an origin, not an account",
  "express wine delivery": "warehouse (EWD) — imported as an origin, not an account",
  "alex lai": "sales rep — sample pulls, not an account",
  "thomas gilbert": "sales rep — sample pulls, not an account",
  james: "sales rep — sample pulls, not an account",
  ricardo: "sales rep — sample pulls, not an account",
  "orange courier": "no address, no contact, no license — nothing to import",
  "": "row with no business name — nothing to import",
};

/** Accounts-tab or BOL-log spelling to the Customer Accounts spelling (lower case). */
export const NAME_ALIASES: Record<string, string> = {
  "el canton de la patrona": "el canton de patrona",
};

export const SF_REGIONS = new Set(["san francisco", "south san francisco"]);
export const NORTH_REGIONS = new Set(["north bay", "san rafael", "marin", "central coast"]);
export const SOUTH_REGIONS = new Set(["los angeles", "orange county", "long beach", "san diego", "alhambra", "arcadia", "west los angeles"]);
export const SOCAL_CITIES = new Set(["downey", "west covina", "ontario", "covina", "long beach", "santa clarita", "el segundo", "los angeles", "whittier", "huntington beach", "anaheim", "chula vista", "san diego", "pasadena", "torrance", "burbank", "glendale", "hollywood", "malibu", "santa monica", "culver city", "inglewood", "compton", "norwalk", "lakewood", "cerritos", "fullerton", "irvine", "costa mesa", "newport beach", "orange", "santa ana", "azusa", "pomona", "claremont", "montebello", "pico rivera", "south gate", "huntington park", "bell", "san pedro", "wilmington", "redondo beach", "manhattan beach", "hermosa beach", "venice", "studio city", "sherman oaks", "van nuys", "north hollywood", "northridge", "encino", "tarzana", "woodland hills", "calabasas", "la habra", "brea", "placentia", "yorba linda", "tustin", "garden grove", "westminster", "seal beach", "cypress", "buena park", "la mirada", "san clemente", "dana point", "laguna beach", "mission viejo", "oceanside", "carlsbad", "encinitas", "escondido", "la jolla"]);
export const NORCAL_CITIES = new Set(["fairfax", "san rafael", "mill valley", "sausalito", "novato", "petaluma", "santa rosa", "sonoma", "napa", "windsor", "healdsburg", "sebastopol", "bolinas", "stinson beach", "point reyes station", "inverness", "tiburon", "larkspur", "corte madera", "san anselmo", "kentfield", "greenbrae", "olema", "marshall", "tomales", "dillon beach", "bodega bay", "guerneville", "forestville", "cotati", "rohnert park", "vallejo", "benicia", "san quentin", "woodacre", "lagunitas", "nicasio"]);
export const MATAGRANO_CITIES = new Set(["san francisco", "south san francisco", "daly city", "san mateo", "burlingame", "san bruno", "millbrae", "redwood city", "palo alto", "menlo park", "mountain view", "sunnyvale", "san jose", "santa clara", "campbell", "los gatos", "cupertino", "half moon bay", "pacifica", "foster city", "belmont", "san carlos"]);
export const OTHER_KNOWN_CITIES = new Set(["hayward", "richmond", "oakland", "berkeley", "emeryville", "alameda", "fremont", "san leandro", "walnut creek", "concord", "sacramento"]);

export const PAYMENT_CHANNEL: Partial<Record<string, "fintech" | "stripe_ach">> = {
  fintech: "fintech",
  ach: "stripe_ach",
  "ach / stripe ach": "stripe_ach",
  stripe: "stripe_ach",
  "stripe ach": "stripe_ach",
};

/** Distributor accounts not present in the workbook (2.5); Matagrano is in Customer Accounts. */
export const EXTRA_DISTRIBUTORS: ReadonlyArray<{ tradeName: string; marketCode: string; address: { line1: string; city: string; state: string; postal: string } | null; note: string }> = [
  { tradeName: "Hartford Distributors Inc.", marketCode: "CT", address: { line1: "131 Chapel Rd", city: "Manchester", state: "CT", postal: "06042" }, note: "Connecticut distributor; freight from Radford or the brewery" },
  { tradeName: "Dichello Distributors Inc.", marketCode: "CT", address: { line1: "55 Marsh Hill Rd.", city: "Orange", state: "CT", postal: "06477" }, note: "Connecticut distributor; freight from Radford or the brewery" },
  { tradeName: "Quality Beverage (Martignetti)", marketCode: "MA", address: null, note: "Massachusetts distributor; address to supply" },
];

export const MATAGRANO_PREFIX = "matagrano";

export interface PersonRule {
  displayName: string;
  role: "admin" | "sales" | null;
  marketCode: string | null;
  enabled: boolean;
  disableReason: string | null;
  /** Spellings used in the Sheet's Sales Person / Sales Rep columns. */
  sheetNames: string[];
  source: string;
}

/** People per decision 9.2: Reps tab names only, with the corrections; no PINs, no emails, no identities. */
export const PEOPLE: ReadonlyArray<PersonRule> = [
  { displayName: "Thomas Gilbert", role: "sales", marketCode: "NORCAL-SD", enabled: true, disableReason: null, sheetNames: ["T. Gilbert", "Thomas Gilbert"], source: "Reps tab" },
  { displayName: "Max Finnance", role: "sales", marketCode: "CT", enabled: true, disableReason: null, sheetNames: ["Max Finnance", "M. Finnance"], source: "Reps tab" },
  { displayName: "Kellan Hegedus", role: "sales", marketCode: "MA", enabled: true, disableReason: null, sheetNames: ["Kellan Hegedus", "K. Hegedus"], source: "Reps tab" },
  { displayName: "Zack Bone", role: "sales", marketCode: null, enabled: true, disableReason: null, sheetNames: ["Zack Bone", "Z. Bone"], source: "Reps tab; no market grant because Texas has no market" },
  { displayName: "Steve Almaraz", role: "admin", marketCode: null, enabled: true, disableReason: null, sheetNames: ["Steve Almaraz", "S. Almaraz"], source: "Reps tab (Admin)" },
  { displayName: "Daniel O'Sullivan", role: "admin", marketCode: null, enabled: true, disableReason: null, sheetNames: ["Daniel O'Sullivan", "D. O'Sullivan"], source: "Decision 9.2 (not on the Reps tab)" },
  { displayName: "Alex Lai", role: "sales", marketCode: "NORCAL-SD", enabled: true, disableReason: null, sheetNames: ["Alex Lai", "A. Lai"], source: "Decision 9.2: new NorCal rep" },
  { displayName: "Alexander Velazquez", role: "sales", marketCode: "NORCAL-SD", enabled: true, disableReason: null, sheetNames: ["Alexander Velazquez", "A. Velazquez"], source: "Decision 9.2: new NorCal rep" },
  { displayName: "James Williams", role: null, marketCode: null, enabled: false, disableReason: "Left the company (decision 9.2)", sheetNames: ["J. Williams", "James Williams"], source: "Reps tab; kept disabled for originating-rep history" },
  { displayName: "Ricardo Villanueva", role: null, marketCode: null, enabled: false, disableReason: "Left the company (decision 9.2)", sheetNames: ["R. Villanueva", "Ricardo Villanueva"], source: "Reps tab; kept disabled for originating-rep history" },
  { displayName: "S. Sprague", role: null, marketCode: null, enabled: false, disableReason: "Legacy rep (decision 9.2)", sheetNames: ["S. Sprague"], source: "Customer Accounts Sales Person value; kept disabled for originating-rep history" },
  { displayName: "D. Krause", role: null, marketCode: null, enabled: false, disableReason: "Legacy rep (decision 9.2)", sheetNames: ["D. Krause"], source: "Customer Accounts Sales Person value; kept disabled for originating-rep history" },
];

/** Reps-tab names that are never people in fv-ops (9.2). */
export const EXCLUDED_REPS: Record<string, string> = {
  "katie sloan": "never hired (9.2)",
  "jack begley": "left the company (9.2)",
  admin: "shared sign-in, not a person",
};

/** Sales Person / Sales Rep cell values that mean "no rep". */
export const NO_REP_VALUES = new Set(["", "n/a", "na", "none", "distributor", "-"]);
