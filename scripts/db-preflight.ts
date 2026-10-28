import { scriptDb } from "./_db";
import { sql } from "drizzle-orm";

/**
 * Lists rows that would violate the invariants added by migration
 * 0002_hardening (the same checks the migration's preflight block runs).
 * Read-only. Use it BEFORE upgrading a populated database; repair each row
 * deliberately from evidence (docs/OPERATOR_GUIDE.md → Upgrading), never by
 * deleting history.
 *
 *   DATABASE_URL=postgres://… npm run db:preflight
 */
const CHECKS: Array<{ name: string; query: string }> = [
  { name: "employees with more than one current identity", query: `select employee_id, array_agg(email) as emails from employee_identity where current = true group by employee_id having count(*) > 1` },
  { name: "google subjects bound to more than one current identity", query: `select google_subject, array_agg(email) as emails from employee_identity where current = true and google_subject is not null group by google_subject having count(*) > 1` },
  { name: "locations with more than one current license verification", query: `select location_id, count(*) from license_verification where current = true group by location_id having count(*) > 1` },
  { name: "locations with more than one current payment relationship", query: `select location_id, count(*) from payment_relationship where current = true group by location_id having count(*) > 1` },
  { name: "email intakes converted into more than one order", query: `select intake_request_id, array_agg(order_number) as orders from customer_order where intake_request_id is not null group by intake_request_id having count(*) > 1` },
  { name: "stock positions with a negative quantity", query: `select id, warehouse_id, sku_id, on_hand_qty, unavailable_qty, pending_inspection_qty, in_transit_qty from stock_position where on_hand_qty < 0 or unavailable_qty < 0 or pending_inspection_qty < 0 or in_transit_qty < 0` },
  { name: "order lines with inconsistent quantities", query: `select id, order_id, ordered_qty, current_qty, cancelled_qty, delivered_qty from order_line where not (ordered_qty > 0 and current_qty >= 0 and cancelled_qty >= 0 and delivered_qty >= 0 and delivered_qty <= current_qty)` },
  { name: "reservations with a negative quantity", query: `select id, order_line_id, reserved_qty, unmet_qty from reservation where reserved_qty < 0 or unmet_qty < 0` },
  { name: "samples with a negative quantity", query: `select id, qty from sample_withdrawal where qty < 0` },
];

async function main() {
  const { db, pool } = scriptDb();
  let problems = 0;
  for (const c of CHECKS) {
    const res = await db.execute(sql.raw(c.query));
    const rows = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    if (rows.length) {
      problems += rows.length;
      console.log(`\n✗ ${c.name}: ${rows.length}`);
      for (const r of rows) console.log("   ", JSON.stringify(r));
    } else {
      console.log(`✓ ${c.name}: none`);
    }
  }
  await pool.end();
  console.log(problems ? `\n${problems} row(s) need a deliberate repair before migrating.` : "\nPreflight clean — the hardening migration can be applied.");
  process.exit(problems ? 2 : 0);
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
