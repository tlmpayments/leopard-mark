import Link from "next/link";
import { Card, fmtDate } from "@/components/ui";
import type { TimelineResult } from "@/lib/domain/timeline/service";

/**
 * Activity timeline card (UX-05): plain text per entry, actor, time (market
 * timezone), reason, link to the source record; filters and "older" cursor
 * navigation via query parameters so history is always reachable.
 */
const KINDS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "orders", label: "Orders & stock" },
  { key: "readiness", label: "Readiness & holds" },
  { key: "contacts", label: "Contacts & account" },
  { key: "notices", label: "Notices" },
  { key: "cases", label: "Cases" },
  { key: "payment", label: "Payment" },
];

export function TimelineCard({ result, basePath, kind, tz, title = "Activity" }: { result: TimelineResult; basePath: string; kind?: string; tz: string; title?: string }) {
  if (!result.allowed) return null;
  const withParams = (params: Record<string, string | undefined>) => {
    const u = new URL(basePath, "http://local");
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return `${u.pathname}${u.search}#activity`;
  };
  return (
    <Card id="activity" title={title}>
      <nav aria-label="Activity filter" className="mb-2 flex flex-wrap gap-1 text-xs">
        {KINDS.map((k) => (
          <Link key={k.key} href={withParams({ kind: k.key || undefined })} aria-current={(kind ?? "") === k.key ? "page" : undefined} className={`rounded-full px-2 py-1 ${(kind ?? "") === k.key ? "bg-accent text-white" : "bg-line/60"}`}>
            {k.label}
          </Link>
        ))}
      </nav>
      {result.entries.length === 0 ? <p className="text-sm text-muted">Nothing recorded for this filter yet.</p> : null}
      <ol className="divide-y divide-line text-sm">
        {result.entries.map((e) => (
          <li key={e.id} className="py-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span>
                {e.href ? (
                  <Link href={e.href} className="hover:underline">
                    {e.text}
                  </Link>
                ) : (
                  e.text
                )}
              </span>
              <span className="text-xs text-muted">
                {fmtDate(e.at, tz)} · {e.actorName ?? e.actorKind}
              </span>
            </div>
            {e.reason ? <div className="text-xs text-muted">— {e.reason}</div> : null}
            {e.detail && (e.detail as { prior?: unknown; current?: unknown }).current ? (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">details</summary>
                <pre className="overflow-x-auto rounded bg-background p-1">{JSON.stringify(e.detail, null, 1)}</pre>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
      {result.nextCursor ? (
        <div className="mt-2 text-right">
          <Link href={withParams({ kind, before: result.nextCursor })} className="text-sm text-accent hover:underline">
            Older activity →
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
