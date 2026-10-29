import Link from "next/link";
import type { ReactNode } from "react";
import type { Actor } from "@/lib/authz/actor";
import { ROLE_LABEL, actorRoles } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import { appEnv, configurationProblems, demoModeEnabled, devAuthBypassEnabled } from "@/lib/env";
import { GroupNav, NavLinks, PrimaryNav, type NavSection } from "./client";

interface NavItem {
  href: string;
  label: string;
  show: boolean;
  /** Frequent mobile destinations appear in the bottom bar; everything else is under More. */
  frequent?: boolean;
}

export function navFor(actor: Actor): NavItem[] {
  const roles = actorRoles(actor);
  const isField = roles.length === 1 && roles[0] === "driver_service";
  const isSalesOnly = roles.every((r) => r === "sales");
  return [
    { href: "/", label: "Home", show: true, frequent: true },
    { href: "/shipments", label: "Shipments", show: can(actor, "shipment.view"), frequent: !isSalesOnly },
    { href: "/lots", label: "Lots", show: can(actor, "lot.view") && !isField },
    { href: "/invoices", label: "Invoices", show: can(actor, "invoice.view") && !isField },
    { href: "/kegs", label: "Kegs", show: can(actor, "keg.view") && !isField },
    { href: "/field", label: "My route", show: roles.includes("driver_service"), frequent: true },
    { href: "/locations", label: "Accounts", show: can(actor, "location.view") && !isField, frequent: true },
    { href: "/orders", label: "Orders", show: can(actor, "order.view") && !isField, frequent: true },
    { href: "/products", label: "Products", show: can(actor, "catalog.view") },
    { href: "/admin/exceptions", label: "Exceptions", show: can(actor, "exception.view") && !isSalesOnly, frequent: !isSalesOnly },
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
    { href: "/reports/microstar", label: "MicroStar report", show: can(actor, "report.export") },
    { href: "/search", label: "Search", show: true, frequent: isSalesOnly || isField },
  ].filter((n) => n.show);
}

/**
 * The primary row. The rule: what Sales or the back office opens most days stands in the row; what is set up
 * once and rarely revisited sits under Admin. Each section lists its pages in order; a page appears only when
 * navFor (the person's permissions) already shows it, and a section appears only when it holds at least one
 * page. `also` lists other path prefixes that belong to a page, so its section stays current there.
 */
const SECTIONS: Array<{ key: string; label: string; pages: Array<{ href: string; also?: string[] }> }> = [
  { key: "accounts", label: "Accounts", pages: [{ href: "/locations" }] },
  { key: "orders", label: "Orders", pages: [{ href: "/orders", also: ["/samples"] }, { href: "/admin/intake" }] },
  { key: "shipments", label: "Shipments", pages: [{ href: "/shipments" }] },
  { key: "stock", label: "Stock", pages: [{ href: "/lots", also: ["/batches"] }, { href: "/admin/counts" }, { href: "/admin/markets" }] },
  { key: "invoices", label: "Invoices", pages: [{ href: "/invoices" }, { href: "/finance" }] },
  { key: "kegs", label: "Kegs", pages: [{ href: "/kegs" }, { href: "/reports/microstar", also: ["/reports"] }] },
  { key: "exceptions", label: "Exceptions", pages: [{ href: "/admin/exceptions", also: ["/admin"] }, { href: "/admin/notices" }] },
  {
    key: "admin",
    label: "Admin",
    pages: [{ href: "/admin/employees" }, { href: "/admin/settings" }, { href: "/admin/catalog" }, { href: "/products" }, { href: "/owner/decisions" }, { href: "/integrations" }, { href: "/admin/import" }],
  },
];

/**
 * The sections this person sees in the row. Permissions decide the pages (navFor); on top of that a Sales-only
 * person sees the selling sections and no Stock or Admin, and a Driver/Service-only person sees Shipments (their
 * assigned stops) only. Every permitted page stays reachable by its URL and from the More menu.
 */
export function sectionsFor(actor: Actor): NavSection[] {
  const roles = actorRoles(actor);
  const isField = roles.length === 1 && roles[0] === "driver_service";
  const isSalesOnly = roles.every((r) => r === "sales");
  const label = new Map(navFor(actor).map((n) => [n.href, n.label]));
  return SECTIONS.filter((s) => (isField ? s.key === "shipments" : isSalesOnly ? s.key !== "stock" && s.key !== "admin" : true))
    .map((s) => ({ key: s.key, label: s.label, pages: s.pages.filter((p) => label.has(p.href)).map((p) => ({ href: p.href, label: label.get(p.href)!, also: p.also })) }))
    .filter((s) => s.pages.length > 0);
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
  const sections = actor ? sectionsFor(actor) : [];
  const roleLabel = actor ? actorRoles(actor).map((r) => ROLE_LABEL[r]).join(", ") : "";

  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:bg-paper focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-rule">
        <div className="mx-auto flex h-[70px] max-w-[1400px] items-center gap-8 px-4 sm:px-8 xl:gap-12">
          <Marks />
          {actor ? <PrimaryNav sections={sections} /> : null}
          {actor ? (
            <div className="ml-auto flex shrink-0 items-center gap-5 text-xs">
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
        {actor ? <GroupNav sections={sections} /> : null}
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
