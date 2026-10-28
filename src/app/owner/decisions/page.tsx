import Link from "next/link";
import { Badge, Card, Notice, Page, StatusBadge } from "@/components/ui";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { IMPLEMENTED_DECISIONS } from "@/lib/policy/implemented";
import { listDecisions } from "@/lib/policy/policy";

export default async function DecisionsPage() {
  await requireAction("decision.view");
  const decisions = await listDecisions((await getDb()));
  const groups: Array<["D" | "SD" | "T" | "IG", string]> = [
    ["D", "Owner business decisions D01–D35"],
    ["SD", "Stripe choices SD01–SD10"],
    ["T", "Retained technical/business topics T01–T10"],
    ["IG", "Integrated gates IG01–IG11 (references, not duplicate decisions)"],
  ];
  const unselected = decisions.filter((d) => d.status === "unselected").length;
  return (
    <Page title="Decision register" subtitle={`${unselected} of ${decisions.length} records unselected. "Unselected" is a business meaning — not off, zero, approved or a vendor default.`}>
      <Notice tone="info">A recommendation is not owner approval. A provider feature is not business policy. The application keeps unselected branches inactive and shows this register wherever a behaviour depends on one.</Notice>
      {groups.map(([reg, label]) => (
        <Card key={reg} title={label}>
          <ul className="divide-y divide-line">
            {decisions
              .filter((d) => d.register === reg)
              .map((d) => (
                <li key={d.id} className="py-2">
                  <Link href={`/owner/decisions/${d.id}`} className="flex items-start justify-between gap-2">
                    <span className="text-sm">
                      <strong>{d.id}</strong> — {d.title}
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {IMPLEMENTED_DECISIONS[d.id] ? <Badge tone="info">executed by app</Badge> : null}
                      {d.scheduled ? <Badge tone="warn">scheduled</Badge> : null}
                      {d.testOnly ? <Badge tone="warn">test selection</Badge> : null}
                      <StatusBadge value={d.status} />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </Page>
  );
}
