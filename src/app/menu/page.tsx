import Link from "next/link";
import { Card, Page } from "@/components/ui";
import { navFor } from "@/components/shell";
import { requireActor } from "@/lib/auth/current";
import { ROLE_LABEL, actorRoles } from "@/lib/authz/actor";
import { demoModeEnabled } from "@/lib/env";

/** Every permitted destination plus sign-out — the mobile "More" menu (UX-09). Nothing is truncated away. */
export default async function MenuPage() {
  const actor = await requireActor();
  const nav = navFor(actor);
  const demo = demoModeEnabled();
  return (
    <Page title="Menu" subtitle={`${actor.displayName} · ${actorRoles(actor).map((r) => ROLE_LABEL[r]).join(" · ")}`}>
      <Card title="Go to">
        <ul className="divide-y divide-line">
          {nav.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="flex min-h-12 items-center justify-between py-2 text-sm">
                <span>{n.label}</span>
                <span aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Account">
        {demo ? (
          <Link href="/sign-in?switch=1" className="block min-h-12 py-2 text-sm text-warn underline">
            Switch demo user
          </Link>
        ) : null}
        <Link href="/account/pin" className="mb-2 block min-h-12 rounded-lg border border-line px-3 py-2 text-sm">
          Change PIN
        </Link>
        <form action="/api/auth/sign-out" method="post">
          <button className="min-h-12 w-full rounded-lg border border-line px-3 py-2 text-left text-sm">{demo ? "Sign out (back to demo Owner)" : "Sign out"}</button>
        </form>
      </Card>
    </Page>
  );
}
