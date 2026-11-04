import Link from "next/link";
import { Card, Page } from "@/components/ui";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";

/** Reports (Round 4): the ones the office and the CFO asked for, each a plain table with a plain CSV. */
export default async function ReportsPage() {
  const actor = await requireAction("report.view");
  const items = [
    { href: "/reports/ca-sales", title: "California sales by format", text: "Charged beer sold into the California markets by month and package, with barrels, for the state beer return.", show: true },
    { href: "/reports/sample-writeoff", title: "Sample write-off", text: "No-charge goods (samples to the samples house or a rep's address) at unit cost, by month and recipient.", show: true },
    { href: "/reports/microstar", title: "MicroStar report", text: "Kegs out to distributors per facility and month (R2-25).", show: can(actor, "report.export") },
    { href: "/finance", title: "Finance", text: "Receivables ageing, payouts matched to invoices and the monthly export for the CFO.", show: can(actor, "finance.view") },
  ].filter((i) => i.show);
  return (
    <Page title="Reports" subtitle="Plain rows and plain CSVs. Dates are invoice dates; the end of a range is exclusive.">
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <Card key={i.href} title={<Link href={i.href} className="text-navy hover:underline">{i.title}</Link>}>
            <p className="text-sm text-ink-2">{i.text}</p>
          </Card>
        ))}
      </div>
    </Page>
  );
}
