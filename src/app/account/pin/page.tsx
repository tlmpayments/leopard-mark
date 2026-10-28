import { redirect } from "next/navigation";
import { Notice, Page } from "@/components/ui";
import { currentActor } from "@/lib/auth/current";
import { readSession } from "@/lib/auth/session";
import { changePinAction } from "./actions";
import { PinForm } from "./pin-form";

/**
 * Own-PIN page. Uses currentActor (not requireActor) on purpose: a person
 * holding a temporary PIN is sent here by every other page and must be able
 * to reach this one.
 */
export default async function PinPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const { first } = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?reason=session");
  const session = await readSession();
  const forced = Boolean(session?.mustChangePin) || first === "1";
  return (
    <Page title={forced ? "Choose your PIN" : "Your PIN"} subtitle={`${actor.displayName}${actor.email ? ` · ${actor.email}` : ""}`}>
      {forced ? (
        <Notice tone="warn" title="A temporary PIN was set for you.">
          Choose your own PIN before using the system. Only you will know it; an Owner or Admin can only set a new temporary one.
        </Notice>
      ) : (
        <Notice tone="info">Changing your PIN signs out every other session for your account.</Notice>
      )}
      <div className="mt-4 max-w-md">
        <PinForm action={changePinAction} first={forced} />
      </div>
    </Page>
  );
}
