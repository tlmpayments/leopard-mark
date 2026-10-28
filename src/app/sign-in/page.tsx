import { redirect } from "next/navigation";
import { Button, Card, Notice } from "@/components/ui";
import { currentActor } from "@/lib/auth/current";
import { googleConfigured } from "@/lib/auth/google";
import { getDb } from "@/lib/db/client";
import { listEmployees } from "@/lib/domain/employees/service";
import { demoModeEnabled, devAuthBypassEnabled } from "@/lib/env";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string; switch?: string }> }) {
  const { reason, switch: switching } = await searchParams;
  const demo = demoModeEnabled();
  const actor = await currentActor();
  if (actor && !(demo && switching === "1")) redirect("/");
  const dev = devAuthBypassEnabled();
  const employees = dev ? await listEmployees(await getDb()) : [];
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">Leopard Mark Ops</h1>
      <p className="mt-1 text-sm text-muted">Familiar Ventures self-distribution operating system. Employees sign in with their company Google account; authorization is internal.</p>
      {demo ? (
        <div className="mt-4">
          <Notice tone="warn" title="DEVELOPMENT DEMO MODE.">
            You are automatically signed in as the demo Owner. Pick another seeded person below to see the portal as that role; internal grants and market scope still apply. Google sign-in is not used in demo mode.
          </Notice>
        </div>
      ) : null}
      {reason && reason !== "session" ? (
        <div className="mt-4">
          <Notice tone="danger" title="Sign-in refused.">{decodeURIComponent(reason).replace(/_/g, " ")}</Notice>
        </div>
      ) : null}
      <div className="mt-6">
        <Card>
          {demo ? (
            <p className="text-sm text-muted">Google OAuth is not exercised in demo mode (the production implementation is unchanged). Configure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and a DATABASE_URL to use it.</p>
          ) : googleConfigured() ? (
            <Button href="/api/auth/google/start">Continue with Google</Button>
          ) : (
            <Notice tone="warn" title="Google sign-in is IMPLEMENTED / NOT CONNECTED.">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see docs/COMMISSIONING.md).</Notice>
          )}
        </Card>
      </div>
      {dev ? (
        <div className="mt-6">
          <Card title={demo ? "Switch demo user" : "Dev fixture sign-in (non-production only)"}>
            <p className="mb-3 text-xs text-muted">Signs in as a seeded employee without Google. Enabled state and grants still apply. Never available in production.</p>
            <form action="/api/auth/dev" method="post" className="space-y-2">
              {employees.map((e) => (
                <button key={e.id} name="employeeId" value={e.id} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-background">
                  <span>
                    {e.displayName}
                    {!e.enabled ? <span className="ml-2 text-xs text-danger">disabled</span> : null}
                  </span>
                  <span className="text-xs text-muted">{e.grants.map((g) => g.role).join(", ") || "no grants"}</span>
                </button>
              ))}
              {employees.length === 0 ? <p className="text-sm text-muted">No employees yet — run <code>npm run seed</code>.</p> : null}
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
