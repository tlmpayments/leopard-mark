import Link from "next/link";
import { Badge, Card, Flash, Notice, Page } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { getDb } from "@/lib/db/client";
import { setupStatus } from "@/lib/setup/service";
import { migrateAction, ownerAction } from "./actions";
import { MigrateForm, OwnerForm } from "./setup-forms";

export const dynamic = "force-dynamic";

/**
 * First-run setup and later migration runs from a browser. Needs no sign-in
 * (there is nobody to sign in before the first Owner exists); every action
 * needs the deployment's setup token. Shows state only — never secrets.
 */
export default async function SetupPage({ searchParams }: { searchParams: SearchParams }) {
  const flash = await flashFrom(searchParams);
  let status;
  let dbError: string | null = null;
  try {
    status = await setupStatus(await getDb());
  } catch (err) {
    dbError = err instanceof Error ? err.message.split("\n")[0] : "database not reachable";
    status = await setupStatus(null);
  }
  const ready = status.databaseConfigured && !dbError && status.pending.length === 0 && status.ownerExists;
  return (
    <Page title="Setup" subtitle="Apply database migrations and provision the first Owner. Each action needs the deployment's setup token.">
      <Flash {...flash} />
      <Card title="State">
        <ul className="space-y-1 text-sm">
          <li>
            Database: {status.databaseConfigured ? dbError ? <Badge tone="danger">configured, not reachable</Badge> : <Badge tone="good">reachable</Badge> : <Badge tone="danger">DATABASE_URL not configured</Badge>}
          </li>
          <li>
            Migrations: {status.applied === null ? <Badge tone="warn">none applied yet</Badge> : status.pending.length ? <Badge tone="warn">{status.applied} of {status.journal.length} applied</Badge> : <Badge tone="good">all {status.journal.length} applied</Badge>}
            {status.pending.length ? <span className="ml-2 text-xs text-muted">pending: {status.pending.join(", ")}</span> : null}
          </li>
          <li>
            Owner: {status.ownerExists ? <Badge tone="good">{status.ownerEmail ?? "provisioned"}</Badge> : <Badge tone="warn">not provisioned</Badge>}
          </li>
          <li>Setup token: {status.tokenConfigured ? <Badge tone="good">configured (CRON_SECRET)</Badge> : <Badge tone="danger">CRON_SECRET missing or shorter than 16 characters</Badge>}</li>
        </ul>
        {ready ? (
          <p className="mt-3 text-sm">
            Setup is complete. <Link href="/sign-in" className="text-accent underline">Go to sign-in</Link>.
          </p>
        ) : null}
      </Card>
      {!status.databaseConfigured || dbError ? (
        <Notice tone="danger" title="Fix the database connection first.">
          Set DATABASE_URL (Neon: the pooled connection string) in the deployment&apos;s environment variables and redeploy.{dbError ? ` Last error: ${dbError}` : ""}
        </Notice>
      ) : null}
      {!status.tokenConfigured ? (
        <Notice tone="danger" title="Set CRON_SECRET first.">
          CRON_SECRET (at least 16 random characters) protects this page and the job runner. Add it in the deployment&apos;s environment variables and redeploy.
        </Notice>
      ) : null}
      <Card title="1. Migrations">
        <p className="mb-3 text-xs text-muted">Applies the SQL migrations in order (safe to re-run), then seeds the decision register (every decision unselected) and the capability gates (every gate unproven). Migration 0002 refuses with a diagnostic if existing data violates an invariant — nothing is changed in that case.</p>
        <MigrateForm action={migrateAction} pending={status.pending} />
      </Card>
      <Card title="2. First Owner">
        {status.ownerExists ? (
          <p className="text-sm text-muted">An Owner exists ({status.ownerEmail ?? "email retired"}). Everyone else is provisioned by the Owner under Employees &amp; access; a lost Owner PIN is reset there by another Owner, or with <code>npm run set-pin</code>.</p>
        ) : status.pending.length ? (
          <p className="text-sm text-muted">Apply the migrations first.</p>
        ) : (
          <OwnerForm action={ownerAction} />
        )}
      </Card>
    </Page>
  );
}
