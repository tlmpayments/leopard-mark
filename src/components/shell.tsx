import Link from "next/link";
import type { ReactNode } from "react";
import type { Actor } from "@/lib/authz/actor";
import { ROLE_LABEL, actorRoles } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import { appEnv, configurationProblems, demoModeEnabled, devAuthBypassEnabled } from "@/lib/env";
import { NavLinks } from "./client";

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
    { href: "/locations", label: "Accounts", show: can(actor, "location.view") && !isField, frequent: true },
    { href: "/orders", label: "Orders", show: can(actor, "order.view") && !isField, frequent: true },
    { href: "/field", label: "My route", show: roles.includes("driver_service"), frequent: true },
    { href: "/admin", label: "Command center", show: can(actor, "exception.view") && (can(actor, "exception.manage") || can(actor, "allocation.resolve")), frequent: !isSalesOnly },
    { href: "/samples", label: "Samples", show: can(actor, "sample.record") },
    { href: "/products", label: "Products", show: can(actor, "catalog.view") },
    { href: "/admin/exceptions", label: "Exceptions", show: can(actor, "exception.view") && !isSalesOnly },
    { href: "/admin/notices", label: "Notices", show: can(actor, "notice.view") && !isSalesOnly },
    { href: "/admin/intake", label: "Email intake", show: can(actor, "intake.handle") },
    { href: "/admin/markets", label: "Markets & stock", show: can(actor, "stock.record") },
    { href: "/admin/catalog", label: "Catalog & prices", show: can(actor, "catalog.manage") },
    { href: "/admin/employees", label: "Employees & access", show: can(actor, "employee.view") },
    { href: "/finance", label: "Finance", show: can(actor, "finance.view") },
    { href: "/owner/decisions", label: "Decisions", show: can(actor, "decision.view") },
    { href: "/integrations", label: "Integrations", show: can(actor, "integration.view") },
    { href: "/search", label: "Search", show: true, frequent: isSalesOnly || isField },
  ].filter((n) => n.show);
}

export function Shell({ actor, children }: { actor: Actor | null; children: ReactNode }) {
  const nav = actor ? navFor(actor) : [];
  const env = appEnv();
  const demo = demoModeEnabled();
  const problems = configurationProblems();
  const frequent = nav.filter((n) => n.frequent).slice(0, 4);
  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      {actor ? (
        <aside className="hidden w-56 shrink-0 border-r border-line bg-card sm:block">
          <div className="p-4">
            <Link href="/" className="block text-base font-semibold">
              Leopard Mark Ops
            </Link>
            <p className="mt-1 text-xs text-muted">{actor.displayName}</p>
            <p className="text-xs text-muted">{actorRoles(actor).map((r) => ROLE_LABEL[r]).join(" · ")}</p>
          </div>
          <nav aria-label="Main" className="flex flex-col px-2">
            <NavLinks items={nav.map((n) => ({ href: n.href, label: n.label }))} variant="sidebar" />
            {demo ? (
              <Link href="/sign-in?switch=1" className="rounded-lg px-2 py-2 text-sm text-warn hover:bg-background">
                Switch demo user
              </Link>
            ) : null}
            <Link href="/account/pin" className="rounded-lg px-2 py-2 text-sm text-muted hover:bg-background">
              Change PIN
            </Link>
            <form action="/api/auth/sign-out" method="post" className="mt-2">
              <button className="min-h-11 w-full rounded-lg px-2 py-2 text-left text-sm text-muted hover:bg-background">{demo ? "Sign out (back to demo Owner)" : "Sign out"}</button>
            </form>
          </nav>
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {demo ? (
          <div className="border-b-2 border-warn bg-warn-soft px-4 py-2 text-center text-xs text-warn sm:text-sm" role="status">
            <strong className="tracking-wide">DEVELOPMENT DEMO MODE</strong> — embedded local database (.fv-demo/), fictional demo data, auto-signed in as the demo Owner. No Google, Neon, Stripe or other provider is connected; provider screens show their real not-connected state.{" "}
            <Link href="/sign-in?switch=1" className="underline">
              Switch user
            </Link>
          </div>
        ) : env !== "production" ? (
          <div className="bg-warn-soft px-4 py-1 text-center text-xs text-warn" role="status">
            {env.toUpperCase()} environment{devAuthBypassEnabled() ? " · dev fixture sign-in enabled" : ""} — test data is not customer history.
          </div>
        ) : null}
        {problems.length && actor && can(actor, "integration.view") ? (
          <div className="bg-danger-soft px-4 py-1 text-center text-xs text-danger" role="alert">
            Configuration needs attention: {problems[0]}
            {problems.length > 1 ? ` (+${problems.length - 1} more on Integrations)` : ""}
          </div>
        ) : null}
        {actor ? (
          <header className="flex items-center justify-between border-b border-line bg-card px-4 py-3 sm:hidden">
            <Link href="/" className="font-semibold">
              Leopard Mark Ops
            </Link>
            <Link href="/menu" className="text-xs text-muted underline">
              {actor.displayName}
            </Link>
          </header>
        ) : null}
        <main id="main" className="flex-1">
          {children}
        </main>
        {actor ? (
          <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-line bg-card py-1 sm:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <NavLinks items={frequent.map((n) => ({ href: n.href, label: n.label }))} variant="bar" />
            <NavLinks items={[{ href: "/menu", label: "More" }]} variant="bar" />
          </nav>
        ) : null}
      </div>
    </div>
  );
}
