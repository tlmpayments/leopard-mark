import Link from "next/link";
import { Badge, Button, Card, Input, Page } from "@/components/ui";
import { requireActor } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { search } from "@/lib/domain/search/service";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor();
  const { q } = await searchParams;
  const hits = q ? await search(await getDb(), actor, q) : [];
  return (
    <Page title="Search" subtitle="Trade name, address, email, order number, product — within your role and market authority.">
      <form className="flex gap-2" role="search">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search…" autoFocus aria-label="Search" />
        <Button variant="secondary">Go</Button>
      </form>
      <Card>
        {q && hits.length === 0 ? <p className="text-sm text-muted">No matches within what you may see.</p> : null}
        {!q ? <p className="text-sm text-muted">Type at least two characters.</p> : null}
        <ul className="divide-y divide-line">
          {hits.map((h) => (
            <li key={`${h.kind}:${h.id}:${h.title}`}>
              <Link href={h.href} className="flex min-h-12 items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block">{h.title}</span>
                  <span className="block text-xs text-muted">{h.subtitle}</span>
                </span>
                <Badge>{h.kind === "sku" ? "product" : h.kind}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
