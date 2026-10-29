import Link from "next/link";
import type { ReactNode } from "react";
import type { Actor } from "@/lib/authz/actor";
import { ROLE_LABEL, actorRoles } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import { appEnv, configurationProblems, demoModeEnabled, devAuthBypassEnabled } from "@/lib/env";
import { GroupNav, NavLinks, PrimaryNav } from "./client";

interface NavItem {
  href: string;
  label: string;
  show: boolean;
  /** Frequent mobile destinations appear in the bottom bar; everything else is under More. */
  frequent?: boolean;
  /** Primary items stand in the shell's one line; the rest sit under Admin on a second line. */
  primary?: boolean;
}

export function navFor(actor: Actor): NavItem[] {
  const roles = actorRoles(actor);
  const isField = roles.length === 1 && roles[0] === "driver_service";
  const isSalesOnly = roles.every((r) => r === "sales");
  return [
    { href: "/", label: "Home", show: true, frequent: true },
    { href: "/shipments", label: "Shipments", show: can(actor, "shipment.view"), frequent: !isSalesOnly, primary: true },
    { href: "/lots", label: "Lots", show: can(actor, "lot.view") && !isField, primary: true },
    { href: "/invoices", label: "Invoices", show: can(actor, "invoice.view") && !isField, primary: true },
    { href: "/kegs", label: "Kegs", show: can(actor, "keg.view") && !isField, primary: true },
    { href: "/field", label: "My route", show: roles.includes("driver_service"), frequent: true, primary: true },
    { href: "/locations", label: "Accounts", show: can(actor, "location.view") && !isField, frequent: true },
    { href: "/orders", label: "Orders", show: can(actor, "order.view") && !isField, frequent: true },
    { href: "/admin", label: "Command center", show: can(actor, "exception.view") && (can(actor, "exception.manage") || can(actor, "allocation.resolve")), frequent: !isSalesOnly },
    { href: "/samples", label: "Samples", show: can(actor, "sample.record") },
    { href: "/products", label: "Products", show: can(actor, "catalog.view") },
    { href: "/admin/exceptions", label: "Exceptions", show: can(actor, "exception.view") && !isSalesOnly },
    { href: "/admin/notices", label: "Notices", show: can(actor, "notice.view") && !isSalesOnly },
    { href: "/admin/intake", label: "Email intake", show: can(actor, "intake.handle") },
    { href: "/admin/markets", label: "Markets & stock", show: can(actor, "stock.record") },
    { href: "/admin/catalog", label: "Catalog & prices", show: can(actor, "catalog.manage") },
    { href: "/admin/counts", label: "Stock counts", show: can(actor, "count.record") },
    { href: "/admin/settings", label: "Company settings", show: can(actor, "settings.manage") },
    { href: "/admin/import", label: "Import from workbook", show: can(actor, "import.dry_run") },
    { href: "/admin/employees", label: "Employees & access", show: can(actor, "employee.view") },
    { href: "/finance", label: "Finance", show: can(actor, "finance.view") },
    { href: "/owner/decisions", label: "Decisions", show: can(actor, "decision.view") },
    { href: "/integrations", label: "Integrations", show: can(actor, "integration.view") },
    { href: "/reports/microstar", label: "Reports", show: can(actor, "report.export"), primary: true },
    { href: "/search", label: "Search", show: true, frequent: isSalesOnly || isField },
  ].filter((n) => n.show);
}

/**
 * The lockup: crest, then the wordmark, both the source SVG files untouched, with clear space between them
 * equal to the height of the word "THE" (30 percent of the wordmark's height; the shell's bar leaves the same
 * above and below). Under the sm breakpoint only the crest shows, as the brand rule asks for anything small.
 */
function Marks() {
  const H = 44; // wordmark height in px; the crest is set to the same height
  const clear = Math.round(H * 0.3);
  return (
    <Link href="/" className="flex shrink-0 items-center" style={{ gap: clear }} aria-label="The Leopard Mark, home">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVGs, never optimised or recoloured */}
      <img src="/brand/tlm-crest-navy.svg" alt="" width={Math.round((H * 108.96) / 150.72)} height={H} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/tlm-wordmark-navy.svg" alt="The Leopard Mark" width={Math.round((H * 229.01) / 122.16)} height={H} className="hidden sm:block" />
    </Link>
  );
}

export function Shell({ actor, children }: { actor: Actor | null; children: ReactNode }) {
  const nav = actor ? navFor(actor) : [];
  const env = appEnv();
  const demo = demoModeEnabled();
  const problems = configurationProblems();
  const frequent = nav.filter((n) => n.frequent).slice(0, 4);
  const primary = nav.filter((n) => n.primary && n.href !== "/reports/microstar");
  const reports = nav.find((n) => n.href === "/reports/microstar");
  const adminItems = nav.filter((n) => !n.primary && n.href !== "/" && n.href !== "/search");
  const line: Array<{ href: string; label: string; also?: string[] }> = [...primary.map((n) => ({ href: n.href, label: n.label }))];
  if (adminItems.length) line.push({ href: adminItems[0].href, label: "Admin", also: adminItems.map((n) => n.href) });
  if (reports) line.push({ href: reports.href, label: reports.label });
  const groups = adminItems.length ? [{ href: adminItems[0].href, label: "Admin", items: adminItems.map((n) => ({ href: n.href, label: n.label })) }] : [];
  const roleLabel = actor ? actorRoles(actor).map((r) => ROLE_LABEL[r]).join(", ") : "";

  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:bg-paper focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-rule">
        <div className="mx-auto flex h-[70px] max-w-[1400px] items-center gap-12 px-4 sm:px-8">
          <Marks />
          {actor ? <PrimaryNav items={line} /> : null}
          {actor ? (
            <div className="ml-auto flex items-center gap-5 text-xs">
              <Link href="/search" className="hidden text-ink-2 hover:text-navy sm:inline">
                Search
              </Link>
              <div className="text-right leading-tight">
                <Link href="/menu" className="block text-sm text-ink sm:pointer-events-none">
                  {actor.displayName}
                </Link>
                <span className="text-ink-3">{roleLabel}</span>
              </div>
              <form action="/api/auth/sign-out" method="post" className="hidden sm:block">
                <button className="text-ink-2 hover:text-navy">Sign out</button>
              </form>
            </div>
          ) : null}
        </div>
        {actor ? <GroupNav groups={groups} /> : null}
      </header>
      {demo ? (
        <div className="border-b border-rule-soft px-4 py-1.5 text-center text-xs text-ink-2 sm:px-8" role="status">
          <strong className="font-semibold text-ink">DEVELOPMENT DEMO MODE</strong>: embedded local database (.fv-demo/), fictional demo data, auto-signed in as the demo Owner. No Google, Neon, Stripe or other provider is connected.{" "}
          <Link href="/sign-in?switch=1" className="underline">
            Switch user
          </Link>
          {actor ? (
            <>
              {" "}
              <Link href="/account/pin" className="underline">
                Change PIN
              </Link>
            </>
          ) : null}
        </div>
      ) : env !== "production" ? (
        <div className="border-b border-rule-soft px-4 py-1 text-center text-xs text-ink-2" role="status">
          {env.toUpperCase()} environment{devAuthBypassEnabled() ? ", dev fixture sign-in enabled" : ""}: test data is not customer history.
        </div>
      ) : null}
      {problems.length && actor && can(actor, "integration.view") ? (
        <div className="border-b border-rule px-4 py-1 text-center text-xs text-ink" role="alert">
          Configuration needs attention: {problems[0]}
          {problems.length > 1 ? ` (${problems.length - 1} more on Integrations)` : ""}
        </div>
      ) : null}
      <main id="main" className="flex-1">
        {children}
      </main>
      {actor ? (
        <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-rule bg-ground py-1 sm:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <NavLinks items={frequent.map((n) => ({ href: n.href, label: n.label }))} variant="bar" />
          <NavLinks items={[{ href: "/menu", label: "More" }]} variant="bar" />
        </nav>
      ) : null}
    </div>
  );
}
