# TLM Master File import — dry-run report

Source: TLM Master File (Google Drive, it@theleopardmark.com), read 2026-10-28. Run id `import-tlm-2026-10-28`. 1440 SQL statements.

## Markets

- SOCAL — SoCal (America/Los_Angeles)
- NORCAL-SD — NorCal (Self Distribution) (America/Los_Angeles)
- NORCAL-D — NorCal (Distributed) (America/Los_Angeles)
- CT — Connecticut (America/New_York)
- MA — Massachusetts (America/New_York)

## Warehouses and origins

- East Brother Beer (EBB) → NORCAL-D (primary) — 1001 Canal Blvd, Unit B, Richmond, CA 94804. Brewery and lot facility 01; Matagrano pickup origin
- Beachwood Brewing (brewery, lot facility 02) → SOCAL — 7671 Woodwind Dr, Huntington Beach, CA 92647. Origin code not yet assigned (question 2.2)
- AleSmith Brewing (brewery, lot facility 05) → SOCAL — 9990 AleSmith Ct, San Diego, CA 92126. Origin code not yet assigned (question 2.2)
- SKIPPED Prost Brewing (CO) — no market covers Colorado yet
- Jack's Abby Brewing (brewery, lot facility 06) → MA (primary) — 100 Clinton St, Framingham, MA 01702. Origin code not yet assigned (question 2.2)
- Round Table Brewing (brewery, lot facility 04) → CT — 55 W Railroad Avenue, Bldg 25, Garnerville, NY. ASSUMPTION: placed in Connecticut because NY has no market; move if wrong
- SKIPPED Real Ale Brewing (TX) — no market covers Texas yet
- SC Warehouses (Benicia) → NORCAL-SD (inactive) — 363 Industrial Way, Benecia, CA 94510. Imported inactive pending question 2.3
- Envision Cold Storage (San Francisco) → NORCAL-SD (inactive) — 1600 Donner Ave, San Francisco, CA 94124. Imported inactive pending question 2.3
- Balmuth & Co. (WLA) → SOCAL (primary) — 901 East E Street, Suite 201, Wilmington, CA 90744. SoCal primary warehouse
- Express Wine Delivery (EWD) → NORCAL-SD (primary) — 7970 Cameron Drive, Windsor, CA 95492. North Bay primary warehouse
- Radford Warehouse (RAD) → CT (primary) — address to confirm; not in Location Information

## Active SKUs (8)

- SLG0KHB010 — Sunlight Groove 1/2 bbl keg — 160 lb
- SLG0KSB010 — Sunlight Groove 1/6 bbl keg — 58 lb
- SLG0C1206P — Sunlight Groove 12 oz case (4 × 6-pack, PakTech) — 22 lb
- CNTCKHB010 — Cantinesca 1/2 bbl keg — 160 lb
- CNTCKSB010 — Cantinesca 1/6 bbl keg — 58 lb
- CNTCC1206P — Cantinesca 12 oz case (4 × 6-pack, PakTech) — 22 lb
- CNTCC1206C — Cantinesca 12 oz case (4 × 6-pack, carton) — 22 lb
- CNTCC1212C — Cantinesca 12 oz case (2 × 12-pack, carton) — 22 lb

## Legacy SKUs (archived, mapped)

- SGB1AKHB01 → SLG0KHB010
- SGB1AKSB01 → SLG0KSB010
- SGB1AC1224 → SLG0C1206P
- SGS1AKHB01 → SLG0KHB010
- SGS1AKSB01 → SLG0KSB010
- SGS1AC1224 → SLG0C1206P
- GSP1AKHB01 → archived, no successor
- GSP1AKSB01 → archived, no successor
- GSP1AC1224 → archived, no successor
- CNT1AKHB01 → CNTCKHB010
- CNT1AKSB01 → CNTCKSB010
- CNT1AC1224 → CNTCC1206P
- CNT1AC2412 → archived, no successor
- XHZ1AKHB01 → archived, no successor
- XHZ1AC1224 → archived, no successor
- XHZ1BKHB01 → archived, no successor
- XHZ1BC1224 → archived, no successor
- XHZ1CKHB01 → archived, no successor
- XHZ1CC1224 → archived, no successor
- XHZ1DKHB01 → archived, no successor
- XHZ1DC1224 → archived, no successor
- XVN1AKHB01 → archived, no successor
- XVN1AC1224 → archived, no successor

## SKU rows skipped

- SGB-TAPHANDLE (Tap Handle) — not a beer package; trade item (question 3.6)
- CNT-TAPHANDLE (Tap Handle) — not a beer package; trade item (question 3.6)
- GLW-PT-16-CNT-01 (Case (16oz x24)) — not a beer package; trade item (question 3.6)

## Prices loaded (from SKU Master, retail list)

- NORCAL-SD: CNTCC1206P $31.70
- NORCAL-SD: CNTCKHB010 $192.00
- NORCAL-SD: CNTCKSB010 $96.00
- NORCAL-SD: SLG0C1206P $36.25
- NORCAL-SD: SLG0KHB010 $205.00
- NORCAL-SD: SLG0KSB010 $99.50
- SOCAL: CNTCC1206P $31.70
- SOCAL: CNTCKHB010 $192.00
- SOCAL: CNTCKSB010 $96.00
- SOCAL: SLG0C1206P $36.25
- SOCAL: SLG0KHB010 $205.00
- SOCAL: SLG0KSB010 $99.50
- Not priced (no list price in the workbook): CNTCC1206C, CNTCC1212C in all markets; every SKU in NORCAL-D, CT, MA (question 3.9)

## Accounts by market

- NORCAL-D: 52
- NORCAL-SD: 25
- SOCAL: 62
- Total imported: 139

## Accounts set INACTIVE (retail accounts inside Matagrano's territory; pending question 2.6)

- 1 Hotel SF
- 540 SF
- Argonaut Hotel (Blue Mermaid)
- Barrio - Ghirardelli
- Beauty Bar SF
- Bender's Bar & Grill
- Bistro Boudin (Upstairs)
- Boudin Bakery (Downstairs)
- Bus Stop
- Capo's
- Chowder Hut
- Cioppino's
- Columbus Cafe
- Comstock Saloon, LLC
- Connecticut Yankee
- Cucina sa
- Foghorn Taproom
- Fool's Errand
- Franciscan Crab Restaurant
- Frank Grizzly LLC
- Frankie's
- Guerrero Hill Market
- HiDive
- Howells
- Key Klub
- Madrone Art Bar
- Mario's Bohemian Cigar Store
- Merkado SF
- New England Lobster Market
- Next Door SF
- Nickie's Irish Pub
- Norcina
- Original Joe's
- Press Club
- Red's Java House
- Sam's Chowder House L-Pship
- Sam's Grill and Seafood Restaurant
- Scoma's
- Sens Restaurant
- Southern Pacific Brewing
- Swan Oyster Depot
- The Boardroom
- The Hearth
- The Homestead
- The Irish Times
- The Mucky Duck
- The Old Clam House
- The Showdown
- Tupelo
- Valley Tavern
- Victory Hall and Parlor

## Rows excluded

- Alex Lai — sales rep — sample pulls, not an account
- Balmuth — warehouse (WLA) — imported as an origin, not an account
- East Brother Beer — host brewery (EBB) — imported as an origin, not an account
- Express Wine Delivery — warehouse (EWD) — imported as an origin, not an account
- James — sales rep — sample pulls, not an account
- Orange Courier — no address, no contact, no license — nothing to import
- Ricardo — sales rep — sample pulls, not an account
- The Leopard Mark — Familiar Ventures itself (internal)
- Thomas Gilbert — sales rep — sample pulls, not an account
- (blank) — row with no business name (111 S Grand Ave, Los Angeles) — nothing to import

## Accounts-tab-only rows

- ADDED 19 Broadway (ACC-2) — present only in the Accounts tab
- SKIPPED La Nena Cantina (ACC ACC-46) — the master already has it as separate sites
- SKIPPED La Nena Cantina (ACC ACC-47) — the master already has it as separate sites
- ADDED Ye Olde Kings Head INC (ACC-84) — present only in the Accounts tab
- ADDED Media Wine & Spirits #1 (ACC-85) — present only in the Accounts tab
- ADDED Victoria's Restaurant & Lounge, LLC (ACC-86) — present only in the Accounts tab
- SKIPPED El Pescador (ACC ACC-88) — the master already has it as separate sites
- SKIPPED El Pescador (ACC ACC-89) — the master already has it as separate sites

## Address problems

(none)


## Missing fields (count of accounts)

- payment method: 53
- ordering contact: 19
- license number: 1

## Every imported account

- 1 Hotel SF → NORCAL-D (inactive) · retail in Matagrano territory
- 540 SF → NORCAL-D (inactive) · retail in Matagrano territory
- Alchemy Craft → SOCAL (active)
- Anna's Pizza Joint → SOCAL (active)
- Argonaut Hotel (Blue Mermaid) → NORCAL-D (inactive) · retail in Matagrano territory
- Bar Sin Nombre → SOCAL (active)
- Barrio - Ghirardelli → NORCAL-D (inactive) · retail in Matagrano territory
- Beauty Bar SF → NORCAL-D (inactive) · retail in Matagrano territory
- Beelman's Pub → SOCAL (active)
- Bender's Bar & Grill → NORCAL-D (inactive) · retail in Matagrano territory
- BiergartenLA → SOCAL (active)
- Birds Bar & Cafe, LLC → SOCAL (active)
- Bistro Boudin (Upstairs) → NORCAL-D (inactive) · retail in Matagrano territory
- Blue Palms Brewhouse → SOCAL (active)
- Board & Brew - Anaheim Hills → SOCAL (active)
- Board & Brew - Huntington Beach → SOCAL (active)
- Board & Brew - Irvine → SOCAL (active)
- Board & Brew - La Habra → SOCAL (active)
- Board & Brew - Ladera Ranch → SOCAL (active)
- Board & Brew - Laguna Niguel → SOCAL (active)
- Board & Brew - RSM → SOCAL (active)
- Board & Brew - Tustin → SOCAL (active)
- Boardwalk 11 → SOCAL (active)
- Bottlecraft North Park → SOCAL (active)
- Boudin Bakery (Downstairs) → NORCAL-D (inactive) · retail in Matagrano territory
- Brewport Tap House → SOCAL (active)
- Buffalo Billiards → NORCAL-SD (active)
- Bus Stop → NORCAL-D (inactive) · retail in Matagrano territory
- Capo's → NORCAL-D (inactive) · retail in Matagrano territory
- Chowder Hut → NORCAL-D (inactive) · retail in Matagrano territory
- Cioppino's → NORCAL-D (inactive) · retail in Matagrano territory
- Columbus Cafe → NORCAL-D (inactive) · retail in Matagrano territory
- Comstock Saloon, LLC → NORCAL-D (inactive) · retail in Matagrano territory
- Connecticut Yankee → NORCAL-D (inactive) · retail in Matagrano territory
- Corked - Rehondo Beach → SOCAL (active)
- Creekside Pizzeria → NORCAL-SD (active)
- Cucina sa → NORCAL-D (inactive) · retail in Matagrano territory
- Due West → NORCAL-SD (active)
- El Canton de Patrona → SOCAL (active)
- El Pescador (Downey) → SOCAL (active)
- El Pescador (West Covina) → SOCAL (active)
- El Pescador #16 → SOCAL (active)
- Farmshop Marin → NORCAL-SD (active)
- Foghorn Taproom → NORCAL-D (inactive) · retail in Matagrano territory
- Fool's Errand → NORCAL-D (inactive) · retail in Matagrano territory
- Franciscan Crab Restaurant → NORCAL-D (inactive) · retail in Matagrano territory
- Frank Grizzly LLC → NORCAL-D (inactive) · retail in Matagrano territory
- Frankie's → NORCAL-D (inactive) · retail in Matagrano territory
- Franks's Wine and Spirits → SOCAL (active)
- Gallaghers Pub and Grill → SOCAL (active)
- Gestalt Haus → NORCAL-SD (active)
- Giacos Roadhouse → NORCAL-SD (active)
- Golden Gate Market → NORCAL-SD (active)
- Gott's Roadside - Marin → NORCAL-SD (active)
- Guerrero Hill Market → NORCAL-D (inactive) · retail in Matagrano territory
- Havana House Cigars & Lounge → SOCAL (active)
- HiDive → NORCAL-D (inactive) · retail in Matagrano territory
- Holly Main → SOCAL (active)
- Hook Fish Co. at Proof Lab → NORCAL-SD (active)
- Howells → NORCAL-D (inactive) · retail in Matagrano territory
- Iguana's Chateau Briand → SOCAL (active)
- Irish Times LA → SOCAL (active)
- Joe's Taco Lounge & Salsaria → NORCAL-SD (active)
- Karma → SOCAL (active)
- Key Klub → NORCAL-D (inactive) · retail in Matagrano territory
- La Nena Cantina (Downtown) → SOCAL (active)
- La Nena Cantina (Hollywood) → SOCAL (active)
- La Nena Cantina (Malibu) → SOCAL (active)
- La Sexy Michelada → SOCAL (active)
- Lighthouse Bar & Grill LLC → NORCAL-SD (active)
- Lvjupara / El Viejon Mariscos and Sushi → SOCAL (active)
- Mac's at 19 Broadway → NORCAL-SD (active)
- Madrone Art Bar → NORCAL-D (inactive) · retail in Matagrano territory
- Mario's Bohemian Cigar Store → NORCAL-D (inactive) · retail in Matagrano territory
- Matagrano, Inc → NORCAL-D (active) · distributor
- Matteuccis → NORCAL-SD (active)
- Mayflower Pub → NORCAL-SD (active)
- Merkado SF → NORCAL-D (inactive) · retail in Matagrano territory
- Mulberry Street Pizzeria → NORCAL-SD (active)
- Naves Sports and Spirits Inc → NORCAL-SD (active)
- New England Lobster Market → NORCAL-D (inactive) · retail in Matagrano territory
- Next Door SF → NORCAL-D (inactive) · retail in Matagrano territory
- Nickie's Irish Pub → NORCAL-D (inactive) · retail in Matagrano territory
- Norcina → NORCAL-D (inactive) · retail in Matagrano territory
- Ola Restobar → SOCAL (active)
- OLA Restobar (Downey) → SOCAL (active)
- Original Joe's → NORCAL-D (inactive) · retail in Matagrano territory
- Oshea Brewing Company → SOCAL (active)
- Paper Mill Creek Saloon LLC → NORCAL-SD (active)
- Parkers Lighthouse → SOCAL (active)
- Pint Size Lounge → NORCAL-SD (active)
- Press Club → NORCAL-D (inactive) · retail in Matagrano territory
- R Bar LB → SOCAL (active)
- Red's Java House → NORCAL-D (inactive) · retail in Matagrano territory
- Redondo Beach Grill → SOCAL (active)
- Richmond Bar & Grill → SOCAL (active)
- Riley's on 2nd → SOCAL (active)
- Sabor a Mexico → NORCAL-SD (active)
- Sam's Chowder House L-Pship → NORCAL-D (inactive) · retail in Matagrano territory
- Sam's Grill and Seafood Restaurant → NORCAL-D (inactive) · retail in Matagrano territory
- Schooners Patio Grille II → SOCAL (active)
- Scoma's → NORCAL-D (inactive) · retail in Matagrano territory
- Scratch Billiards Sports → SOCAL (active)
- Selma's Chicago Pizzeria → SOCAL (active)
- Sens Restaurant → NORCAL-D (inactive) · retail in Matagrano territory
- Shenanigans Irish Pub and Grille → SOCAL (active)
- Shore Rider → SOCAL (active)
- Smiley's Saloon & Hotel → NORCAL-SD (active)
- Southern Pacific Brewing → NORCAL-D (inactive) · retail in Matagrano territory
- Swan Oyster Depot → NORCAL-D (inactive) · retail in Matagrano territory
- The 4th Horseman → SOCAL (active)
- The Backroom → NORCAL-SD (active)
- The Black Cat → SOCAL (active)
- The Boardroom → NORCAL-D (inactive) · retail in Matagrano territory
- The Brewhouse Tap Room → SOCAL (active)
- The Courtside Lounge → SOCAL (active)
- The Grog Shop → SOCAL (active)
- The Hearth → NORCAL-D (inactive) · retail in Matagrano territory
- The Homestead → NORCAL-D (inactive) · retail in Matagrano territory
- The Hub → NORCAL-SD (active)
- The Irish Times → NORCAL-D (inactive) · retail in Matagrano territory
- The Junction → NORCAL-SD (active)
- The Lodge → NORCAL-SD (active)
- The Mucky Duck → NORCAL-D (inactive) · retail in Matagrano territory
- The Old Clam House → NORCAL-D (inactive) · retail in Matagrano territory
- The Regal Seagull → SOCAL (active)
- The Showdown → NORCAL-D (inactive) · retail in Matagrano territory
- The Sidecar → SOCAL (active)
- The Standard Station Sports Bar and Grill → SOCAL (active)
- The Tavern on Main Inc. → SOCAL (active)
- Tony Peperoni → SOCAL (active)
- Tupelo → NORCAL-D (inactive) · retail in Matagrano territory
- Valley Tavern → NORCAL-D (inactive) · retail in Matagrano territory
- Victory Hall and Parlor → NORCAL-D (inactive) · retail in Matagrano territory
- Villa Catrina Mexican Restauarant and Cantina → SOCAL (active)
- 19 Broadway → NORCAL-SD (active)
- Ye Olde Kings Head INC → SOCAL (active)
- Media Wine & Spirits #1 → SOCAL (active)
- Victoria's Restaurant & Lounge, LLC → SOCAL (active)

