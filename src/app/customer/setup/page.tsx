import { Card, Page } from "@/components/ui";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { getDb } from "@/lib/db/client";
import { getCompanySettings } from "@/lib/domain/settings/service";

/**
 * Where Stripe's hosted bank setup page sends the payer afterwards (Round 4, B1). Public, carries no account data: it
 * only says whether the setup finished or was cancelled. The portal learns the outcome from Stripe's webhook.
 */
export default async function CustomerSetupReturnPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const state = param(sp, "setup");
  const settings = await getCompanySettings(await getDb());
  const done = state === "complete";
  return (
    <Page title={done ? "Thank you" : "Setup not finished"} subtitle={settings.dba} wide={false}>
      <Card>
        {done ? (
          <>
            <p className="text-sm">Your bank account is connected for ACH payments to {settings.dba}. If your bank asked for two small test deposits, please confirm their amounts on the Stripe page in the next few days; nothing is debited until then.</p>
            <p className="mt-2 text-sm text-ink-2">Invoices are debited on their due date, as shown on each invoice. Questions: {settings.customerSenderAddress}.</p>
          </>
        ) : (
          <>
            <p className="text-sm">The bank setup was cancelled before it finished. Nothing was saved.</p>
            <p className="mt-2 text-sm text-ink-2">Use the link in our email to try again, or write to {settings.customerSenderAddress} and we will send a fresh one.</p>
          </>
        )}
      </Card>
    </Page>
  );
}
