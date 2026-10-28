import { Button, Page, Notice } from "@/components/ui";

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const { action } = await searchParams;
  return (
    <Page title="Not permitted">
      <Notice tone="danger">
        Your current role/market grants do not include <code>{action ?? "this action"}</code>. Authority is internal (Owner/Admin access function); signing in alone grants nothing.
      </Notice>
      <Button href="/" variant="secondary">Back to home</Button>
    </Page>
  );
}
