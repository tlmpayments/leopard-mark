-- Distributor details from the sample invoices (HDI, Mancini, Matagrano) and Martignetti's first PO 10072645 and its email thread. Every statement is a no-op on a fresh database.
SELECT 1;
--> statement-breakpoint
UPDATE "customer_location" SET "legal_name" = 'Hartford Distributors, Inc.', "updated_at" = now() WHERE "id" = '354c2740-6f20-124a-da25-6105ed22e7e3' AND "legal_name" IS NULL;
--> statement-breakpoint
UPDATE "location_address" SET "current" = false, "to_at" = now() WHERE "location_id" = '354c2740-6f20-124a-da25-6105ed22e7e3' AND "kind" = 'billing' AND "current" AND NOT EXISTS (SELECT 1 FROM "location_address" la JOIN "address" a ON a."id" = la."address_id" WHERE la."location_id" = '354c2740-6f20-124a-da25-6105ed22e7e3' AND la."kind" = 'billing' AND la."current" AND a."line1" = 'PO Box 8400');
--> statement-breakpoint
WITH a AS (
  INSERT INTO "address" ("line1", "city", "state", "postal_code", "provenance", "confirmed_at")
  SELECT 'PO Box 8400', 'Manchester', 'CT', '06040', 'admin_entered'::address_provenance, now()
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = '354c2740-6f20-124a-da25-6105ed22e7e3') AND NOT EXISTS (SELECT 1 FROM "location_address" la JOIN "address" a ON a."id" = la."address_id" WHERE la."location_id" = '354c2740-6f20-124a-da25-6105ed22e7e3' AND la."kind" = 'billing' AND la."current" AND a."line1" = 'PO Box 8400')
  RETURNING "id")
INSERT INTO "location_address" ("location_id", "address_id", "kind") SELECT '354c2740-6f20-124a-da25-6105ed22e7e3', "id", 'billing'::address_kind FROM a;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Chris Engel (Accounts Payable)', 'accounts_payable@hdibeer.com', NULL
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = '354c2740-6f20-124a-da25-6105ed22e7e3')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = '354c2740-6f20-124a-da25-6105ed22e7e3' AND lc."current" AND lower(k."email") = lower('accounts_payable@hdibeer.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT '354c2740-6f20-124a-da25-6105ed22e7e3', "id", 'ap', true, false FROM c;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'John Keuhn', 'john.k@hdibeer.com', '(860) 268-2543'
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = '354c2740-6f20-124a-da25-6105ed22e7e3')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = '354c2740-6f20-124a-da25-6105ed22e7e3' AND lc."current" AND lower(k."email") = lower('john.k@hdibeer.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT '354c2740-6f20-124a-da25-6105ed22e7e3', "id", 'receiving', false, false FROM c;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Kate Iannarone (Accounts Payable)', 'ciannarone@mancinibeverage.com', NULL
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'c31548a2-69c8-2da2-13ad-e68cb2b57b22')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = 'c31548a2-69c8-2da2-13ad-e68cb2b57b22' AND lc."current" AND lower(k."email") = lower('ciannarone@mancinibeverage.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT 'c31548a2-69c8-2da2-13ad-e68cb2b57b22', "id", 'ap', true, false FROM c;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Vicki Pelham', 'vicki@dichello.com', '(203) 891-2100 ext 1170'
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'c31548a2-69c8-2da2-13ad-e68cb2b57b22')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = 'c31548a2-69c8-2da2-13ad-e68cb2b57b22' AND lc."current" AND lower(k."email") = lower('vicki@dichello.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT 'c31548a2-69c8-2da2-13ad-e68cb2b57b22', "id", 'receiving', false, false FROM c;
--> statement-breakpoint
UPDATE "customer_location" SET "legal_name" = 'Matagrano Inc.', "updated_at" = now() WHERE "id" = '105dbdab-b759-b7ab-f684-955a64a8e22c' AND "legal_name" IS NULL;
--> statement-breakpoint
UPDATE "location_contact" SET "receives_invoices" = false WHERE "location_id" = '105dbdab-b759-b7ab-f684-955a64a8e22c' AND "contact_id" IN (SELECT "id" FROM "contact" WHERE "name" = 'Ordering contact' AND "email" IS NULL);
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Joe Lee (Accounts Payable)', 'joelee@matagrano.com', NULL
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = '105dbdab-b759-b7ab-f684-955a64a8e22c')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = '105dbdab-b759-b7ab-f684-955a64a8e22c' AND lc."current" AND lower(k."email") = lower('joelee@matagrano.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT '105dbdab-b759-b7ab-f684-955a64a8e22c', "id", 'ap', true, false FROM c;
--> statement-breakpoint
UPDATE "customer_location" SET "legal_name" = 'Martignetti Companies', "appointment_required" = false,
  "delivery_instructions" = 'Quality Taunton warehouse receives first come, first served; no appointment. Send delivery notices to QualityTauntonWarehouse@martignetti.com. PO number required on the BOL and the invoice.',
  "invoice_notes" = CASE WHEN "invoice_notes" IS NULL THEN 'Martignetti vendor number: 234647.' WHEN "invoice_notes" LIKE '%234647%' THEN "invoice_notes" ELSE "invoice_notes" || E'\nMartignetti vendor number: 234647.' END,
  "updated_at" = now()
WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND "kind" = 'distributor';
--> statement-breakpoint
UPDATE "location_address" SET "current" = false, "to_at" = now() WHERE "location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND "kind" = 'billing' AND "current" AND NOT EXISTS (SELECT 1 FROM "location_address" la JOIN "address" a ON a."id" = la."address_id" WHERE la."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND la."kind" = 'billing' AND la."current" AND a."line1" = '200 Charles F Colton Road');
--> statement-breakpoint
WITH a AS (
  INSERT INTO "address" ("line1", "city", "state", "postal_code", "provenance", "confirmed_at")
  SELECT '200 Charles F Colton Road', 'Taunton', 'MA', '02780-7379', 'admin_entered'::address_provenance, now()
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9') AND NOT EXISTS (SELECT 1 FROM "location_address" la JOIN "address" a ON a."id" = la."address_id" WHERE la."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND la."kind" = 'billing' AND la."current" AND a."line1" = '200 Charles F Colton Road')
  RETURNING "id")
INSERT INTO "location_address" ("location_id", "address_id", "kind") SELECT 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', "id", 'billing'::address_kind FROM a;
--> statement-breakpoint
UPDATE "location_address" SET "current" = false, "to_at" = now() WHERE "location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND "kind" = 'delivery' AND "current" AND NOT EXISTS (SELECT 1 FROM "location_address" la JOIN "address" a ON a."id" = la."address_id" WHERE la."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND la."kind" = 'delivery' AND la."current" AND a."line1" = '300 Charles F Colton Road');
--> statement-breakpoint
WITH a AS (
  INSERT INTO "address" ("line1", "city", "state", "postal_code", "provenance", "confirmed_at")
  SELECT '300 Charles F Colton Road', 'Taunton', 'MA', '02780', 'admin_entered'::address_provenance, now()
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9') AND NOT EXISTS (SELECT 1 FROM "location_address" la JOIN "address" a ON a."id" = la."address_id" WHERE la."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND la."kind" = 'delivery' AND la."current" AND a."line1" = '300 Charles F Colton Road')
  RETURNING "id")
INSERT INTO "location_address" ("location_id", "address_id", "kind") SELECT 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', "id", 'delivery'::address_kind FROM a;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Accounts Payable', 'ap@martignetti.com', NULL
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND lc."current" AND lower(k."email") = lower('ap@martignetti.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', "id", 'ap', true, false FROM c;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Dan Laing', 'dlaing@martignetti.com', '413-885-2033'
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND lc."current" AND lower(k."email") = lower('dlaing@martignetti.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', "id", 'buyer', false, true FROM c;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Manny Inacio (Warehouse Manager)', 'minacio@martignetti.com', '(508) 822-6200 ext 0315; mobile (508) 802-2925'
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND lc."current" AND lower(k."email") = lower('minacio@martignetti.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', "id", 'receiving', false, false FROM c;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Quality Taunton Warehouse', 'QualityTauntonWarehouse@martignetti.com', NULL
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND lc."current" AND lower(k."email") = lower('QualityTauntonWarehouse@martignetti.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', "id", 'receiving', false, false FROM c;
--> statement-breakpoint
WITH c AS (
  INSERT INTO "contact" ("name", "email", "phone")
  SELECT 'Kevin Bagge (Portfolio Manager)', 'kbagge@martignetti.com', NULL
  WHERE EXISTS (SELECT 1 FROM "customer_location" WHERE "id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9')
    AND NOT EXISTS (SELECT 1 FROM "location_contact" lc JOIN "contact" k ON k."id" = lc."contact_id" WHERE lc."location_id" = 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9' AND lc."current" AND lower(k."email") = lower('kbagge@martignetti.com'))
  RETURNING "id")
INSERT INTO "location_contact" ("location_id", "contact_id", "contact_role", "receives_invoices", "may_order")
SELECT 'd5f8a78e-8d32-2f71-7b26-af7aacb7edb9', "id", 'other', false, false FROM c;
--> statement-breakpoint
INSERT INTO "sku_alias" ("alias", "sku_id", "note")
SELECT v.alias, s."id", 'Martignetti item number' FROM (VALUES ('7799101', 'CNTCKHB010'), ('7799102', 'CNTCKSB010'), ('7799103', 'CNTCC1212C')) AS v(alias, code)
JOIN "sku" s ON s."code" = v.code
ON CONFLICT ("alias") DO NOTHING;
--> statement-breakpoint
UPDATE "sku" SET "weight_lb" = 20 WHERE "code" = 'CNTCC1212C' AND "weight_lb" = 22;
