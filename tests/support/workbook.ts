/**
 * A small SYNTHETIC "TLM Master File" workbook for the import tests: the same tab names and header rows as the real
 * export, a dozen invented accounts and documents, fake PINs. Nothing in here is real customer or staff data; the real
 * export is read only through TLM_WORKBOOK_PATH and never enters the repository.
 */
import ExcelJS from "exceljs";

type Cell = string | number | boolean | Date | null;

function sheet(wb: ExcelJS.Workbook, name: string, rows: Cell[][]) {
  const ws = wb.addWorksheet(name);
  for (const r of rows) ws.addRow(r.map((c) => (c === null ? undefined : c)));
  return ws;
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const CUSTOMER_ACCOUNTS_HEADER = [
  "Business Name",
  "Sales Person",
  "Region",
  "Alc.\nLicense #",
  "Legal Name",
  "Ordering Contact",
  "Phone Number",
  "Ordering Contact Email",
  "Delivery Address",
  "Latitude",
  "Longtitude",
  "Tap Handles?",
  "Delivery Instructions",
  "Delivery WIndow",
  "Monday Delivery Window",
  "Tuesday Delivery Window",
  "Wednesday Delivery Window",
  "Thursday Delivery Window",
  "Friday Delivery Window",
  "Date of Last Line Cleaning",
  "Payment Method",
  "Added on Fintech /  Stripe ACH",
  "Billing Contact Email",
  "Billing Instructions",
  "Terms",
  "Billing Address\n(If not the same as shipping)",
  "Priority",
  "Google Link",
  "Date of First Delivery",
  "Imported to Ekos",
  "Longitude",
];

function account(over: Partial<Record<(typeof CUSTOMER_ACCOUNTS_HEADER)[number], Cell>>): Cell[] {
  return CUSTOMER_ACCOUNTS_HEADER.map((h) => over[h] ?? null);
}

const ACCOUNTS_HEADER = ["AccountID", "BusinessName", "LegalName", "Region", "SalesPerson", "LicenseNumber", "OrderingContact", "Phone", "Email", "DeliveryAddress", "DeliveryInstructions", "DeliveryWindowNote", "MondayWindow", "TuesdayWindow", "WednesdayWindow", "ThursdayWindow", "FridayWindow", "PaymentMethod", "Terms", "BillingContactEmail", "BillingInstructions", "BillingAddress", "Priority", "Active"];

function supplement(over: Partial<Record<(typeof ACCOUNTS_HEADER)[number], Cell>>): Cell[] {
  return ACCOUNTS_HEADER.map((h) => over[h] ?? null);
}

function payload(p: Record<string, unknown>): string {
  return JSON.stringify(p);
}

const LOC_HEADER = ["Type", "Facility Number", "Company Name", "Shipping Address", "Shipping Address Line #2", "Shipping City", "Shipping State", "Shipping Zip Code", "Shipping Contact Phone", "Shipping Contact Email", "Billing Address", "Billing Address #2", "Billing City", "Billing State", "Billing Zip Code", "Billing Contact Email", "Billing Contact Phone", "Appointment Required?", "Loading Dock?", "Shipping Hours - Sunday", "Shipping Hours - Monday", "Shipping Hours - Tuesday", "Shipping Hours Wednesday", "Shipping Hours - Thursday", "Shipping Hours - Friday", "Shipping Hours - Saturday"];

const SALES_HEADER = ["Invoice #", "Customer", "License Number", "PO Date", "Delivery (Invoice) Date", "Product Name", "Packaging Format", "Product Code", "Lot #", "Qty", "Price (ea)", "Line Total", "Expected Empty Kegs", "Inventory Source", "BOL #", "Created by Order Form", "Sales Rep", "Payment Method", "ACH Invoice\nREF #", "Delivered", "Invoice Status", "TLM Tap Handle", "SGB Tap Handle", "CNT Tap Handle", "MicroStar 1/2 Empty", "MicroStar 1/6 Empty", "Notes", "", "Slack Channel", "Slack Thread TS"];

function sale(over: Partial<Record<(typeof SALES_HEADER)[number], Cell>>): Cell[] {
  return SALES_HEADER.map((h) => (h ? over[h] ?? null : null));
}

/** Build the synthetic workbook and return its bytes. */
export async function buildSyntheticWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // Ignored tabs exist too, so the parser proves it skips them.
  sheet(wb, "Marketing Orders", [["Order", "Item"], ["M1", "Coasters"]]);
  sheet(wb, "Customer Accounts", [
    CUSTOMER_ACCOUNTS_HEADER,
    account({ "Business Name": "Blue Heron Tavern", "Sales Person": "T. Gilbert", Region: "North Bay", "Alc.\nLicense #": 542804, "Legal Name": "Heron Hospitality LLC", "Ordering Contact": "Pat Example", "Phone Number": "4155550101", "Ordering Contact Email": "Orders@BlueHeron.example", "Delivery Address": "12 Harbor Way, Sausalito, CA 94965", "Delivery WIndow": "Mon-Fri 10am-2pm", "Monday Delivery Window": "10-2", "Date of Last Line Cleaning": d("2026-05-29"), "Payment Method": "Fintech", "Billing Contact Email": "ap@blueheron.example", Terms: "Net 30", "Imported to Ekos": true, "Tap Handles?": "Yes" }),
    account({ "Business Name": "Fog City Oyster Bar", "Sales Person": "T. Gilbert", Region: "San Francisco", "Alc.\nLicense #": "611200", "Legal Name": "Fog City Shellfish Inc.", "Ordering Contact": "Sam Example", "Phone Number": "(415) 555-0102", "Delivery Address": "900 Embarcadero, San Francisco, CA 94111", "Payment Method": "ACH", Terms: "Net 0" }),
    account({ "Business Name": "Matagrano, Inc", "Sales Person": "", Region: "", "Legal Name": "Matagrano, Inc.", "Delivery Address": "1 Distributor Rd, South San Francisco, CA 94080", "Delivery Instructions": "Pickup at the brewery" }),
    account({ "Business Name": "Sunset Sports Grill", "Sales Person": "J. Williams", Region: "Los Angeles", "Alc.\nLicense #": "700100", "Ordering Contact": "Lee Example", "Delivery Address": "4400 Sunset Blvd, Los Angeles, CA 90027", "Payment Method": "Stripe ACH" }),
    account({ "Business Name": "Harbor Light Cantina", "Sales Person": "R. Villanueva", Region: "Long Beach", "Alc.\nLicense #": "700200", "Legal Name": "Harbor Light LLC", "Delivery Address": "77 Pine Ave, Long Beach, CA 90802", "Billing Address\n(If not the same as shipping)": "PO Box 10, Long Beach, CA 90801", Terms: "Net 30", "Payment Method": "Fintech" }),
    account({ "Business Name": "The Leopard Mark", "Delivery Address": "1 Office Plaza, Napa, CA 94559" }),
    account({ "Business Name": "Balmuth", "Delivery Address": "901 East E Street, Wilmington, CA 90744" }),
    account({ "Business Name": "Dock & Dine (Downtown)", "Sales Person": "S. Sprague", Region: "Los Angeles", "Alc.\nLicense #": "700300", "Delivery Address": "1 Main St, Los Angeles, CA 90012" }),
    account({ "Business Name": "Dock & Dine (Marina)", "Sales Person": "S. Sprague", Region: "Los Angeles", "Alc.\nLicense #": "700301", "Delivery Address": "2 Marina Way, Los Angeles, CA" }),
    account({ "Business Name": "", "Delivery Address": "111 S Grand Ave, Los Angeles, CA 90012" }),
  ]);
  sheet(wb, "Accounts", [
    ACCOUNTS_HEADER,
    supplement({ AccountID: "ACC-1", BusinessName: "Blue Heron Tavern", Region: "North Bay", SalesPerson: "T. Gilbert", Active: true }),
    supplement({ AccountID: "ACC-2", BusinessName: "Fog City Oyster Bar", Region: "San Francisco", SalesPerson: "T. Gilbert", Email: "buyer@fogcity.example", Active: true }),
    supplement({ AccountID: "ACC-3", BusinessName: "Sunset Sports Grill", Region: "Los Angeles", SalesPerson: "J. Williams", Active: true }),
    supplement({ AccountID: "ACC-4", BusinessName: "Harbor Light Cantina", Region: "Long Beach", SalesPerson: "R. Villanueva", Active: true }),
    supplement({ AccountID: "ACC-5", BusinessName: "Dock & Dine", Region: "Los Angeles", SalesPerson: "S. Sprague", Active: true }),
    supplement({ AccountID: "ACC-6", BusinessName: "Pier Nine Bistro", LegalName: "Pier Nine LLC", Region: "Orange County", SalesPerson: "J. Williams", LicenseNumber: "800100", OrderingContact: "Jo Example", Phone: "9495550103", DeliveryAddress: "9 Pier Rd, Newport Beach, CA 92663", PaymentMethod: "Fintech", Terms: "Net 30", Active: true }),
  ]);
  sheet(wb, "Location Information", [
    LOC_HEADER,
    ["P_CA_Richmond", "01", "East Brother Beer", "100 Brewery Ln", "Unit B", "Richmond", "California", 94804, null, "dock@ebb.example"],
    ["P_CA_Huntington Beach", "02", "Beachwood Brewing", "200 Brewery Ln", null, "Huntington Beach", "CA", 92647],
    ["P_CA_San Diego", "05", "Ale Smith", "500 Brewery Ln", null, "San Diego", "California", 92126],
    ["P_CO_Northglenn", "03", "Prost Brewing Company ", "300 Brewery Ln", "Unit B", "Northglenn", "Colorado", 80234],
    ["P_MA_Framingham", "06", "Jack's Abby Brewing", "600 Brewery Ln", null, "Framingham", "Massachusetts", 1702, null, null, null, null, null, null, null, null, null, "Yes"],
    ["P_NY_Garnerville", "04", "Roundtable Brewing", "400 Brewery Ln", "Bldg 25", "Garnerville", "New York"],
    ["P_TX_Blanco", "07", "Real Ale Brewing", "700 Brewery Ln", null, "Blanco", "Texas", 78606],
    ["W_CA_Benecia 01", null, "Sc Warehouses, LLC", "10 Industrial Way", null, "Benecia", "California", 94510],
    ["W_CA_San Francisco 01", null, "Envision Cold Storage", "20 Donner Ave", null, "San Francisco", "California", 94124],
    ["W_CA_Wilmington 01", null, "Balmuth & Co. ", "30 East E Street", "Suite 201", "Wilmington", "California", 90744],
    ["W_CA_Windsor 01", null, "Express Wine Delivery", "40 Cameron Drive", null, "Windsor", "California ", 95492],
  ]);
  sheet(wb, "SKU Master", [
    ["SKU", "Brand", "Product", "PackageType", "IsKeg", "Deposit", "ReorderThreshold", "Active", "Price", "WeightPerUnit"],
    ["SGB1AKHB01", "SGB", "Sunlight Groove Bay Area", "1/2 bbl Keg", true, null, null, true, 205, 160],
    ["SGB1AKSB01", "SGB", "Sunlight Groove Bay Area", "1/6 bbl Keg", true, null, null, true, 99.5, 58],
    ["SGB1AC1224", "SGB", "Sunlight Groove Bay Area", "Case (12oz x24)", false, null, null, true, 36.25, 22],
    ["SGB-TAPHANDLE", "SGB", "Sunlight Groove Bay Area", "Tap Handle", false, null, null, true, null, 0],
    ["SGS1AKHB01", "SGS", "Sunlight Groove SoCal", "1/2 bbl Keg", true, null, null, true, 205, 160],
    ["CNT1AKHB01", "CNT", "Cantinesca", "1/2 bbl Keg", true, null, null, true, 192, 160],
    ["CNT1AKSB01", "CNT", "Cantinesca", "1/6 bbl Keg", true, null, null, true, 96, 58],
    ["CNT1AC1224", "CNT", "Cantinesca", "Case (12oz x24)", false, null, null, true, 31.7, 22],
    ["CNT1AC2412", "CNT", "Cantinesca", "Case (24oz)", false, null, null, false],
    ["CNT-TAPHANDLE", "CNT", "Cantinesca", "Tap Handle", false, null, null, true, null, 0],
    ["GSP1AKHB01", "GSP", "Giro Splendido", "1/2 bbl Keg", true, null, null, true, 205, 160],
    ["GSP1AKSB01", "GSP", "Giro Splendido", "1/6 bbl Keg", true, null, null, true, 115, 58],
    ["GSP1AC1224", "GSP", "Giro Splendido", "Case (12oz x24)", false, null, null, true, 36.25, 22],
    ["XHZ1AKHB01", "XHZ", "Experimental Hazy IPA V1 VarA (retired)", "1/2 bbl Keg", true, null, null, false, null, 160],
    ["XHZ1AC1224", "XHZ", "Experimental Hazy IPA V1 VarA (retired)", "Case (12oz x24)", false, null, null, false, null, 22],
    ["GLW-PT-16-CNT-01", "CNT", "Cantinesca Pint Glass", "Case (16oz x24)", false, null, null, true, 1],
  ]);
  sheet(wb, "Product Information", [
    ["Product Information and Codes"],
    ["Product", "Product\nCode", "Type", "Status", "SKU Description", "Packaging Format", "Supplier Code (Sales)", "Inventory SKU", "U/M", "Weight / \nUnit", "Price", "Case UPC", "Retail Pack UPC", "Unit UPC", "Pallet Format", "Lot #/Batch #"],
    ["Sunlight Groove Bay Area", "SGB", "Commercial", "Active", "SGB 1/2 bbl", "1/2 BBL Keg", "SGB1AKHB01", "TLM-SGB1AKHB01-M", "Keg", 160, 205, null, null, 850000000001, 0.125, "01SGB2601301"],
    ["Sunlight Groove Bay Area", "SGB", "Commercial", "Active", "SGB case", "4/6/12oz Case", "SGB1AC1224", "TLM-SGB1AC1224-6PK", "Case", 22, 36.25, 10850000000002, 850000000003, 850000000004, 0.01, "01SGB2601301"],
    ["Cantinesca", "CNT", "Commercial", "Active", "CNT case", "4/6/12oz Case", "CNT1AC1224", "TLM-CNT1AC1224-6PK", "Case", 22, 31.7, 10850000000005, 850000000006, 850000000007, { formula: "1/100", result: 0.01 } as unknown as Cell, "03CNT2604031"],
    ["Cantinesca Especial", "CNE", "Commercial", "Anticipated", null, "1/2 BBL Keg", "CNE1AKHB01", "TLM-CNE1AKHB01", "Keg"],
    [null, null, null, "Archived", "Sunlight Groove BA 1/2 BBL Keg", "1/2 BBL Keg", "TLM.EBB.SGB-KEG.1/2", "TLM.EBB.SGB-KEG.1/2", "Keg", null, 205, null, null, null, 0.125],
    [null, null, null, "Archived", "Giro Splendido 1/2 BBL Keg", "1/2 BBL Keg", "TLM.PRO.GSP-KEG.1/2", "TLM.PRO.GSP-KEG.1/2", "Keg", null, 205],
  ]);
  sheet(wb, "Commodities", [["CommodityCode", "Name", "NMFCNumber", "Notes"], ["BEER-CAN", "Packaged Beer — Cans", null, "Verify NMFC # before use"], ["BEER-KEG", "Packaged Beer — Kegs", null, "Verify NMFC # before use"]]);
  sheet(wb, "Reps", [
    ["Reps:"],
    ["Name", "PIN", "Active", "Admin"],
    ["Max Finnance", "0000", true],
    ["Katie Sloan", "0000", true],
    ["Thomas Gilbert", "0000", true],
    ["James Williams", "0000", true],
    ["Jack Begley", "0000", true, "Admin"],
    ["Kellan Hegedus", "0000", true],
    ["Ricardo Villanueva", "0000", true],
    ["Zack Bone", "0000", true],
    ["Admin", "0000", true, "Admin"],
    ["Steve Almaraz", "0000", true, "Admin"],
  ]);
  sheet(wb, "Production", [
    ["Brew Date", "Batch #", "Product", "Location", "Status", "Vessel / Tank Size", "Run # / \nVariation", "Actual Package Date", "Lot #", "1/2 Kegs Packaged", "1/6 Kegs Packaged", "4/6/12oz Cases Packaged", "4/3/24oz Cases Packaged", "Brewery Batch Number", "Notes"],
    [d("2026-06-12"), "B01CNT26001", "Cantinesca", "01_CA_Richmond", "Complete", "20 BBL", null, d("2026-07-15"), "01CNT2607151", 22, 20, 50],
    [d("2025-12-12"), "B01SGB26001", "Sunlight Groove Bay Area", "01_CA_Richmond", "Complete", "20 BBL", null, d("2026-01-30"), "TLM.EBB.SGB.001", 24, 0, 94, 0, "FV001"],
    [d("2026-03-06"), "B01SGB26002", "Sunlight Groove Bay Area", "01_CA_Richmond", "Destroyed", "20 BBL", null, "N/A", "TLM.EBB.SGB.002", 0, 0, 0, 0, "FV002", "Grain blended during milling"],
    [d("2026-04-17"), "B01SGB26006", "Sunlight Groove Bay Area", "01_CA_Richmond", "Complete", "40 BBL", null, d("2026-06-02"), "01SGB2606021", null, null, null, null, "FV006"],
    [d("2026-01-15"), "B03GSP26001", "Giro Splendido", "03_CO_Northglenn", "Complete", "50 BBL", null, d("2026-03-25"), "03GSP2603251", null, null, null, null, "FAM.IT.PILS"],
    [d("2026-02-13"), "B02XHZ26001", "Experimental Hazy", "02_CA_Huntington Beach", "Complete", "10 BBL", "A", d("2026-03-12"), "02XHZ260312A", 8, 0, 5.25, 0],
    [d("2026-07-28"), "B01CNT26003", "Cantinesca", "01_CA_Richmond", "In Progress", "30 BBL", null, "8/31 - 9/1", "TBD"],
    [d("2026-09-14"), "B06CNT26002", "Cantinesca", "06_MA_Framingham", "Scheduled", "120 BBL", null, null, "TBD"],
    [d("2026-06-08"), "B01GSP26001", "Giro Splendido", "01_CA_Richmond", "Cancelled", "20 BBL", null, null, "N/A"],
  ]);
  sheet(wb, "Packaged Products", [
    [null, "Packaged Products"],
    ["Brew Date", "Packaged Date", "Product", "Manufacturer", "Product Code", "Batch #", "Lot #", "Qty", "U/M"],
    [d("2026-01-15"), d("2026-03-25"), "Giro Splendido", "Prost Brewing", "TLM.PRO.GSP-KEG.1/2", null, "TLM.PRO.GSP.001", 56, "KEG"],
    [d("2026-01-15"), d("2026-03-25"), "Giro Splendido", "Prost Brewing", "TLM-GSP1AKSB01-M", null, "TLM.PRO.GSP.001", 20, "KEG"],
    [d("2026-01-15"), d("2026-03-25"), "Giro Splendido", "Prost Brewing", "TLM-GSP1AC1224-6PK", null, "TLM.PRO.GSP.001", 172, "CASE"],
    [d("2026-04-17"), d("2026-06-02"), "Sunlight Groove Bay Area", "East Brother Beer", "TLM-SGB1AKHB01-M", null, "01GSB2606021", 66, "KEG"],
    [d("2026-04-17"), d("2026-06-02"), "Sunlight Groove Bay Area", "East Brother Beer", "TLM-SGB1AKSB01-M", null, "01GSB2606021", 40, "KEG"],
    [d("2026-04-17"), d("2026-06-02"), "Sunlight Groove Bay Area", "East Brother Beer", "TLM-SGB1AC1224-6PK", null, "01GSB2606021", 0, "CASE"],
  ]);
  const delivery = (bol: string, date: string, business: string, lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
    payload({ docType: "delivery", bolNumber: bol, invoiceNumber: "", date: `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`, dateIso: date, toAccount: { AccountID: "ACC-000", BusinessName: business, DeliveryAddress: "" }, deliveryWindow: "", receivingInstructions: "", lines, refNote: "", notes: "", ...extra });
  const line = (sku: string, lot: string | null, qty: number, extra: Record<string, unknown> = {}) => ({ sku, lot, qty, ...(lot ? { lotFacility: lot.slice(0, 2), lotPkgDate: `20${lot.slice(5, 7)}-${lot.slice(7, 9)}-${lot.slice(9, 11)}`, lotRun: lot.slice(11) } : {}), weightPerUnit: sku.includes("KHB") ? 160 : sku.includes("KSB") ? 58 : 22, isKeg: /K[HS]B/.test(sku), ...extra });
  const ebbLoc = { LocationID: "P_CA_Richmond", Name: "East Brother Beer", Type: "Brewery", City: "Richmond", State: "California" };
  sheet(wb, "BOL Maker Log", [
    ["DocNumber", "DocType", "Date", "Summary", "PayloadJSON", "CreatedAt", "UpdatedAt"],
    ["WLA-090326-01", "delivery", d("2026-09-03"), "Delivery Receipt — WLA-090326-01", delivery("WLA-090326-01", "2026-09-03", "Harbor Light Cantina", [line("CNT1AKHB01", "01CNT2607151", 1)], { invoiceNumber: "INV26278" }), "2026-09-02T19:40:48.270Z", ""],
    ["WLA-090326-1", "delivery", d("2026-09-03"), "Delivery Receipt — WLA-090326-1", delivery("WLA-090326-1", "2026-09-03", "Harbor Light Cantina", [line("CNT1AKHB01", "01CNT2607151", 1)], { invoiceNumber: "INV26278" }), "2026-09-02T19:41:48.270Z", ""],
    ["EWD-D-260910-01", "delivery", d("2026-09-10"), "Delivery Receipt — EWD-D-260910-01", delivery("EWD-D-260910-01", "2026-09-10", "Blue Heron Tavern", [line("SGB1AKHB01", "01SGB2608031", 2), line("SGB-TAPHANDLE-STANDARD", null, 1)], { invoiceNumber: "INV26300", emptyPickups: { halfBbl: 1, sixthBbl: 0 }, deliveryWindow: "10am-2pm" }), "2026-09-10T15:00:00.000Z", ""],
    ["WLA-P-260930", "delivery", d("2026-09-30"), "Delivery Receipt — WLA-P-260930", delivery("WLA-P-260930", "2026-09-30", "The Leopard Mark", [line("CNT1AKSB01", "05CNT2609021", 2)]), "2026-09-30T15:00:00.000Z", ""],
    ["WLA-P-261001-01", "delivery", d("2026-10-01"), "Delivery Receipt — WLA-P-261001-01", delivery("WLA-P-261001-01", "2026-10-01", "Sunset Sports Grill", [line("CNT1AC1224", "01CNT2607151", 4)]), "2026-10-01T15:00:00.000Z", ""],
    ["EWD-S-261006-01", "delivery", d("2026-10-06"), "Delivery Receipt — EWD-S-261006-01", delivery("EWD-S-261006-01", "2026-10-06", "Thomas Gilbert", [line("CNT1AC1224", "01CNT2607151", 4)]), "2026-10-06T15:00:00.000Z", ""],
    ["EWD-T-260917-01", "delivery", d("2026-09-17"), "Delivery Receipt — EWD-T-260917-01", delivery("EWD-T-260917-01", "2026-09-17", "Express Wine Delivery", [line("SGB1AKHB01", "01SGB2608031", 16)]), "2026-09-17T15:00:00.000Z", ""],
    ["BOL-T-260929-01", "freight", d("2026-09-29"), "Freight BOL — BOL-T-260929-01", payload({ docType: "freight", bolNumber: "BOL-T-260929-01", date: "09/29/2026", dateIso: "2026-09-29", eventType: "TRANSFER", actor: "Office", fromLoc: null, toLoc: null, fromName: "Jack's Abby Brewing", fromAddress: "600 Brewery Ln, Framingham, MA 01702", toName: "Radford Warehouse, Inc.", toAddress: "31 Plymouth St, Mansfield, MA 02048", carrier: "Example Freight LLC", carrierPhone: "(555) 555-0199", weight: "9000", handlingUnitCount: "4", handlingUnitType: "Pallets", freightClass: "", nmfcNumber: "", originAppointment: "", destinationAppointment: "Call ahead", lines: [{ sku: "CNT1AKHB01", description: "Cantinesca", package: "1/2 bbl Keg", qty: 54 }], refNote: "", notes: "" }), "2026-09-29T15:00:00.000Z", ""],
    ["BOL-260926-01", "freight", d("2026-09-25"), "Freight BOL — BOL-260926-01", payload({ docType: "freight", bolNumber: "BOL-260926-01", date: "09/25/2026", dateIso: "2026-09-25", eventType: "TRANSFER", actor: "Office", fromLoc: ebbLoc, toLoc: null, fromName: "", fromAddress: "", toName: "Hartford Distributors Inc.", toAddress: "131 Chapel Rd, Manchester, CT 06042", carrier: "Example Freight LLC", carrierPhone: "", weight: "4080", handlingUnitCount: "2", handlingUnitType: "Pallets", freightClass: "", nmfcNumber: "", originAppointment: "", destinationAppointment: "", lines: [{ sku: "CNT1AC1224", description: "Cantinesca", package: "Case (12oz x24)", qty: 200 }], refNote: "PO 4471", notes: "" }), "2026-09-26T21:31:00.720Z", ""],
    ["TLM-D-260909-02", "delivery", d("2026-09-09"), "Delivery Receipt — TLM-D-260909-02", delivery("TLM-D-260909-02", "2026-09-09", "Fog City Oyster Bar", [line("SGB1AKHB01", "01SGB2608031", 1)], { invoiceNumber: "INV26301" }), "2026-09-09T15:00:00.000Z", ""],
    ["WLA-D-261005-01", "delivery", d("2026-10-05"), "Delivery Receipt — WLA-D-261005-01", delivery("WLA-D-261005-01", "2026-10-05", "Dock & Dine", [line("CNT1AKSB01", "01CNT2607151", 1)], { toAccount: { AccountID: "ACC-5", BusinessName: "Dock & Dine", DeliveryAddress: "1 Main St, Los Angeles, CA 90012" } }), "2026-10-05T15:00:00.000Z", ""],
    ["EWD-D-261010-01", "delivery", d("2026-10-10"), "Delivery Receipt — EWD-D-261010-01", delivery("EWD-D-261010-01", "2026-10-10", "Unknown Bar", [line("CNT1AKSB01", "01CNT2607151", 1)]), "2026-10-10T15:00:00.000Z", ""],
  ]);
  sheet(wb, "Sales", [
    ["M2", "Sales"],
    SALES_HEADER,
    sale({ "Invoice #": "INV26278", Customer: "Harbor Light LLC / Harbor Light Cantina", "License Number": "700200", "PO Date": d("2026-09-02"), "Delivery (Invoice) Date": d("2026-09-03"), "Product Code": "CNT1AKHB01", "Lot #": "01CNT2607151", Qty: 1, "Price (ea)": 192, "Line Total": 192, "Inventory Source": "WLA Warehouse", "BOL #": "WLA-090326-01", "Sales Rep": "R. Villanueva", "Payment Method": "Fintech", "Invoice Status": "Paid" }),
    sale({ "Invoice #": "INV26300", Customer: "Heron Hospitality LLC / Blue Heron Tavern", "PO Date": d("2026-09-09"), "Delivery (Invoice) Date": d("2026-09-10"), "Product Name": "Sunlight Groove Bay Area", "Packaging Format": "1/2 Barrel Keg (15.5 gal)", Qty: 2, "Price (ea)": 205, "Line Total": 410, "Inventory Source": "EWD", "BOL #": "EWD-D-260910-01", "Sales Rep": "T. Gilbert", "Invoice Status": "Invoiced", "SGB Tap Handle": 1, "MicroStar 1/2 Empty": 1 }),
    sale({ "Invoice #": "INV26300", Customer: "Heron Hospitality LLC / Blue Heron Tavern", "PO Date": d("2026-09-09"), "Delivery (Invoice) Date": d("2026-09-10"), "Product Code": "TLM-SGB1AC1224-6PK", "Lot #": "01SGB2606021", Qty: 1, "Price (ea)": 36.25, "Line Total": 36.25, "Inventory Source": "EWD", "BOL #": "EWD-D-260910-01", "Sales Rep": "T. Gilbert", "Invoice Status": "Invoiced" }),
    sale({ "Invoice #": "INV26301", Customer: "Fog City Oyster Bar", "PO Date": d("2026-09-08"), "Delivery (Invoice) Date": d("2026-09-09"), "Product Code": "TLM.EBB.SGB-KEG.1/2", "Lot #": "EBB.SGB.001", Qty: 1, "Price (ea)": 205, "Line Total": 205, "BOL #": "TLM-D-260909-02", "Sales Rep": "T. Gilbert", "Invoice Status": "VOID", Notes: "Voided: wrong account" }),
    sale({ "Invoice #": "INV26302", Customer: "Some Event LLC", "PO Date": d("2026-09-12"), "Delivery (Invoice) Date": d("2026-09-12"), "Product Code": "N/A", Qty: 1, "Sales Rep": "N/A", "Invoice Status": "Not Created" }),
    sale({ "Invoice #": "NC26001", Customer: "Sunset Sports Grill", "PO Date": d("2026-10-01"), "Delivery (Invoice) Date": d("2026-10-01"), "Product Code": "CNT1AC1224", "Lot #": "01CNT2607151", Qty: 4, "Price (ea)": 0, "Line Total": 0, "BOL #": "WLA-P-261001-01", "Sales Rep": "J. Williams", "Invoice Status": "Invoiced" }),
    sale({ "Invoice #": "INV26303", Customer: "Matagrano, Inc.", "PO Date": d("2026-10-27"), "Delivery (Invoice) Date": d("2026-10-28"), "Product Name": "Cantinesca", "Packaging Format": "4/6/12 Case (4 six-packs of 12oz cans)", Qty: 98, "Price (ea)": 31.65, "Line Total": 3101.7, "BOL #": "EBB-D-261028-01", "Sales Rep": "Distributor", "Invoice Status": "Not Created" }),
  ]);
  sheet(wb, "Routes", [["Route", "Stop"], ["R1", "x"]]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
