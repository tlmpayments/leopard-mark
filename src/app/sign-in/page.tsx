import { redirect } from "next/navigation";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { currentActor } from "@/lib/auth/current";
import { googleConfigured } from "@/lib/auth/google";
import { getDb } from "@/lib/db/client";
import { DEMO_PIN } from "@/lib/demo/constants";
import { listEmployees } from "@/lib/domain/employees/service";
import { demoModeEnabled, devAuthBypassEnabled } from "@/lib/env";

/**
 * Sign-in: company email + PIN. Authorization stays internal (employee record,
 * current identity, grants) and is re-read on every request. Google sign-in is
 * optional and offered only when its credentials are configured.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string; switch?: string; email?: string }> }) {
  const { reason, switch: switching, email } = await searchParams;
  const demo = demoModeEnabled();
  const actor = await currentActor();
  // Demo mode auto-signs the local user in as the demo Owner; the page still shows when they ask to switch or a sign-in was just refused.
  if (actor && !(demo && (switching === "1" || (reason && reason !== "session")))) redirect("/");
  const dev = devAuthBypassEnabled();
  const employees = dev ? await listEmployees(await getDb()) : [];
  const refused = reason && reason !== "session" ? decodeURIComponent(reason).replace(/_/g, " ") : null;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <h1 className="font-display text-[22px] font-bold">Sign in</h1>
      <p className="mt-1 text-sm text-ink-2">Sign in with your company email and PIN; what you may do is decided by your internal role and market grants.</p>
      {demo ? (
        <div className="mt-4">
          <Notice tone="warn" title="DEVELOPMENT DEMO MODE.">
            You are automatically signed in as the demo Owner. Try the real sign-in with any seeded email and the demo PIN <strong>{DEMO_PIN}</strong>, or pick a seeded person below to switch without a PIN; internal grants and market scope still apply either way.
          </Notice>
        </div>
      ) : null}
      {reason === "session" ? (
        <div className="mt-4">
          <Notice tone="info">Please sign in to continue.</Notice>
        </div>
      ) : refused ? (
        <div className="mt-4">
          <Notice tone="danger" title="Sign-in refused.">{refused}</Notice>
        </div>
      ) : null}
      <div className="mt-6">
        <Card title="Sign in">
          <form action="/api/auth/pin" method="post" className="space-y-3">
            <Field label="Company email" htmlFor="signin-email">
              <Input id="signin-email" name="email" type="email" autoComplete="username" required defaultValue={email ?? ""} inputMode="email" />
            </Field>
            <Field label="PIN" htmlFor="signin-pin">
              <Input id="signin-pin" name="pin" type="password" autoComplete="current-password" inputMode="numeric" required pattern="[0-9]{6,12}" />
            </Field>
            <Button>Sign in</Button>
          </form>
          <p className="mt-3 text-xs text-muted">Forgot your PIN? An Owner or Admin sets a temporary one under Employees &amp; access; you choose your own at the next sign-in. Five wrong attempts lock the PIN for 15 minutes.</p>
          {googleConfigured() && !demo ? (
            <div className="mt-4 border-t border-line pt-3">
              <Button href="/api/auth/google/start" variant="secondary">
                Continue with Google instead
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
      {dev ? (
        <div className="mt-6">
          <Card title={demo ? "Switch demo user" : "Dev fixture sign-in (non-production only)"}>
            <p className="mb-3 text-xs text-muted">Signs in as a seeded employee without a PIN. Enabled state and grants still apply. Never available on a deployment.</p>
            <form action="/api/auth/dev" method="post" className="space-y-2">
              {employees.map((e) => (
                <button key={e.id} name="employeeId" value={e.id} className="flex w-full items-center justify-between border-b border-rule-soft py-2 text-left text-sm hover:bg-background">
                  <span>
                    {e.displayName}
                    {!e.enabled ? <span className="ml-2 text-xs text-danger">disabled</span> : null}
                  </span>
                  <span className="text-xs text-muted">{e.grants.map((g) => g.role).join(", ") || "no grants"}</span>
                </button>
              ))}
              {employees.length === 0 ? <p className="text-sm text-muted">No employees yet — run <code>npm run seed:dev</code>.</p> : null}
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
